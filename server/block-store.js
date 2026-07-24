/*
 * server/block-store.js -- block-addressable, event-sourced store BELOW the HTTP API
 * (platform-pivot 03/31, Foundation). This is the load-bearing storage model: the
 * append-only change log here IS the same seq-stamped block.change stream Phase 2's
 * sync layer fans out (04 == 05) and reconnect replays ("give me events since seq N").
 *
 * Decomposition. A master is no longer one blob: doc-level metadata + each PAGE as a
 * row + each top-level BLOCK as a row keyed by its stable id (the id already minted
 * for comment-anchoring / snapshots). The top-level block is the unit of save,
 * history, and (Phase 2) locking; nested children travel inside the block's content.
 *
 * Two distinct sequence concepts (spec build-note -- do NOT overload `seq`):
 *   - blocks.ver  : a PER-BLOCK version marker, bumped each time that block changes.
 *   - changes.seq : the SINGLE global monotonic append-log sequence (one sequencer),
 *                   used for replay + Phase-2 fan-out. AUTOINCREMENT across all docs.
 *
 * Current doc = a MATERIALIZED projection (the block rows). The change log is the
 * never-lose + rollback history; periodic snapshots bound replay length. Replaying the
 * log from the latest snapshot must reproduce the materialized rows exactly (AC2).
 *
 * Dependency-free: node:sqlite + node:crypto builtins only. Never renders.
 */
"use strict";

var DatabaseSync = require("node:sqlite").DatabaseSync;
var crypto = require("node:crypto");

// ---- pure helpers (headless-testable; no db, no io) -----------------------
/* @block-pure-start */
// Decompose a whole doc into { docMeta, pages:[{pageMeta, blockIds}], blocks:{id:content} }.
// Every top-level block is ensured to carry a stable id (minted via mintId if absent);
// the id is written back into the content so it persists across reloads. mintId is
// injected so tests are deterministic.
function decomposeDoc(doc, mintId) {
  var pagesIn = (doc && doc.pages) || [];
  var docMeta = {}; for (var k in doc) if (k !== "pages") docMeta[k] = doc[k];
  var pages = [], blocks = {};
  for (var pi = 0; pi < pagesIn.length; pi++) {
    var p = pagesIn[pi];
    var pageMeta = {}; for (var pk in p) if (pk !== "blocks") pageMeta[pk] = p[pk];
    if (pageMeta.id == null) pageMeta.id = mintId();
    var blockIds = [];
    var bl = p.blocks || [];
    for (var bi = 0; bi < bl.length; bi++) {
      var b = bl[bi];
      if (b.id == null) b.id = mintId();
      blocks[b.id] = b;
      blockIds.push(b.id);
    }
    pages.push({ meta: pageMeta, blockIds: blockIds });
  }
  return { docMeta: docMeta, pages: pages, blocks: blocks };
}

// Reassemble a whole doc from the decomposed shape. Inverse of decomposeDoc; pure.
function assembleDoc(docMeta, pages, blocks) {
  var doc = {}; for (var k in docMeta) doc[k] = docMeta[k];
  doc.pages = pages.map(function (p) {
    var page = {}; for (var pk in p.meta) page[pk] = p.meta[pk];
    page.blocks = p.blockIds.map(function (id) { return blocks[id]; });
    return page;
  });
  return doc;
}

// Debounce-coalesce (AC3): collapse a burst of consecutive same-block events that land
// within windowMs into ONE event (the latest patch wins). Different block, or a gap
// wider than the window, starts a fresh event. Pure fold over a timestamped list.
function coalesceChanges(events, windowMs) {
  var out = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i], prev = out[out.length - 1];
    if (prev && prev.blockId === e.blockId && (e.ts - prev.ts) <= windowMs) out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}
/* @block-pure-end */

function createBlockStore(dbPath, opts) {
  opts = opts || {};
  var mintId = opts.mintId || function () { return "b_" + crypto.randomUUID(); };
  var db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, meta TEXT NOT NULL, page_order TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS pages (doc_id TEXT, id TEXT, meta TEXT NOT NULL, block_order TEXT NOT NULL, ord INTEGER, PRIMARY KEY (doc_id, id));" +
    "CREATE TABLE IF NOT EXISTS blocks (doc_id TEXT, id TEXT, page_id TEXT, content TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (doc_id, id));" +
    // The single global append-only change log. seq = the one monotonic sequence.
    "CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, block_id TEXT, kind TEXT, patch TEXT, author TEXT, ts INTEGER);" +
    // Snapshots bound replay length. A snapshot with a non-null `label` is a NAMED
    // CHECKPOINT (ticket 04) -- a milestone/publish point an author can browse + restore
    // to. Unlabelled snapshots are the periodic materialisation baselines.
    "CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, at_seq INTEGER, state TEXT, label TEXT, author TEXT, ts INTEGER);"
  );
  // Defensive migration for a store created before `label`/`author` existed (dev dbs).
  try { db.exec("ALTER TABLE snapshots ADD COLUMN label TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE snapshots ADD COLUMN author TEXT"); } catch (e) {}

  var qPutDoc     = db.prepare("INSERT INTO docs (id, meta, page_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, page_order = excluded.page_order");
  var qGetDoc     = db.prepare("SELECT meta, page_order FROM docs WHERE id = ?");
  var qPutPage    = db.prepare("INSERT INTO pages (doc_id, id, meta, block_order, ord) VALUES (?, ?, ?, ?, ?) ON CONFLICT(doc_id, id) DO UPDATE SET meta = excluded.meta, block_order = excluded.block_order, ord = excluded.ord");
  var qGetPage    = db.prepare("SELECT id, meta, block_order FROM pages WHERE doc_id = ? ORDER BY ord");
  var qPutBlock   = db.prepare("INSERT INTO blocks (doc_id, id, page_id, content, ver) VALUES (?, ?, ?, ?, 1) ON CONFLICT(doc_id, id) DO UPDATE SET page_id = excluded.page_id, content = excluded.content, ver = blocks.ver + 1");
  var qGetBlock   = db.prepare("SELECT content, ver FROM blocks WHERE doc_id = ? AND id = ?");
  var qDelBlock   = db.prepare("DELETE FROM blocks WHERE doc_id = ? AND id = ?");
  var qAppend     = db.prepare("INSERT INTO changes (doc_id, block_id, kind, patch, author, ts) VALUES (?, ?, ?, ?, ?, ?)");
  var qSince      = db.prepare("SELECT seq, doc_id, block_id, kind, patch, author, ts FROM changes WHERE seq > ? ORDER BY seq");
  var qSinceDoc   = db.prepare("SELECT seq, doc_id, block_id, kind, patch, author, ts FROM changes WHERE seq > ? AND doc_id = ? ORDER BY seq");
  var qMaxSeq     = db.prepare("SELECT MAX(seq) AS m FROM changes");
  var qPutSnap    = db.prepare("INSERT INTO snapshots (doc_id, at_seq, state, label, author, ts) VALUES (?, ?, ?, ?, ?, ?)");
  var qLastSnap   = db.prepare("SELECT at_seq, state FROM snapshots WHERE doc_id = ? ORDER BY at_seq DESC, id DESC LIMIT 1");
  var qGetSnap    = db.prepare("SELECT id, doc_id, at_seq, state, label, author, ts FROM snapshots WHERE id = ?");
  var qCheckpoints = db.prepare("SELECT id, at_seq, label, author, ts FROM snapshots WHERE doc_id = ? AND label IS NOT NULL ORDER BY id");
  var qBlockHist  = db.prepare("SELECT seq, block_id, kind, patch, author, ts FROM changes WHERE doc_id = ? AND block_id = ? ORDER BY seq");
  var qBlockMax   = db.prepare("SELECT MAX(seq) AS m FROM changes WHERE doc_id = ? AND block_id = ? AND kind = 'block.put'");
  var qSetOrder   = db.prepare("UPDATE pages SET block_order = ? WHERE doc_id = ? AND id = ?");

  var now = opts.now || function () { return 0; }; // injectable clock (Date.now() in prod)

  function maxSeq() { var r = qMaxSeq.get(); return (r && r.m) || 0; }

  // The page a block lives on, per the structural source of truth (block_order), or
  // null if the block is not part of the doc's structure. A block edit must target a
  // block that is actually IN the doc -- otherwise it would log an event + insert a
  // page-less row that materializeDoc never surfaces (a silent-drop; see applyChange).
  function pageOfBlock(docId, blockId) {
    var pages = qGetPage.all(docId);
    for (var i = 0; i < pages.length; i++) {
      if (JSON.parse(pages[i].block_order).indexOf(blockId) >= 0) return pages[i].id;
    }
    return null;
  }

  // Write a decomposed doc into the doc/page/block rows (fresh, ver reset to 1). Shared
  // by import (mints ids) and checkpoint restore (ids already present). Idempotent.
  function putDecomposed(docId, d) {
    qPutDoc.run(docId, JSON.stringify(d.docMeta), JSON.stringify(d.pages.map(function (p) { return p.meta.id; })));
    d.pages.forEach(function (p, ord) {
      qPutPage.run(docId, p.meta.id, JSON.stringify(p.meta), JSON.stringify(p.blockIds), ord);
      p.blockIds.forEach(function (bid) {
        qDelBlock.run(docId, bid); // fresh write -> insert at ver 1
        qPutBlock.run(docId, bid, p.meta.id, JSON.stringify(d.blocks[bid]));
      });
    });
  }

  // Import a whole doc: decompose into rows + seed an "imported" named checkpoint so
  // replay has a clean, bounded starting point AND the doc starts restorable. This ONE
  // path also serves .verso import + local->server publish + migration (ticket 05).
  function importDoc(docId, doc, author) {
    var d = decomposeDoc(doc, mintId);
    putDecomposed(docId, d);
    createCheckpoint(docId, "imported", author); // baseline named checkpoint (ticket 05)
    return { docId: docId, pages: d.pages.length, blocks: Object.keys(d.blocks).length };
  }

  // Export the portable doc-of-record: the materialized current state, ready to be
  // wrapped as a .verso package (ticket 05). .verso stays the portable EXPORT, never
  // the live doc-of-record -- the store rows are the source of truth once imported.
  // Import is the inverse (importDoc): ONE path serving .verso import, local->server
  // publish, and legacy-course migration.
  function exportDoc(docId) { return materializeDoc(docId); }

  // Materialized current-state read: assemble the doc from the block/page rows.
  function materializeDoc(docId) {
    var dr = qGetDoc.get(docId);
    if (!dr) return null;
    var docMeta = JSON.parse(dr.meta);
    var pages = qGetPage.all(docId).map(function (pr) {
      var meta = JSON.parse(pr.meta);
      var blockIds = JSON.parse(pr.block_order);
      return { meta: meta, blockIds: blockIds };
    });
    var blocks = {};
    pages.forEach(function (p) {
      p.blockIds.forEach(function (bid) {
        var br = qGetBlock.get(docId, bid);
        blocks[bid] = br ? JSON.parse(br.content) : null;
      });
    });
    return assembleDoc(docMeta, pages, blocks);
  }

  // Apply ONE block.change: append exactly one seq-stamped event AND update the
  // materialized block row (content = patch, per-block ver bumped). Returns the new
  // global seq + the per-block ver (AC1). patch = the block's new full content (v1
  // coarse per-block put; finer patches are a later optimization).
  //
  // The block MUST already be part of the doc's structure (in some page's block_order).
  // A content put does not add blocks -- adding/removing/reordering blocks is a
  // structural change that goes through import (full re-decompose + fresh snapshot) in
  // v1; incremental structural events are Phase 2. Rejecting an unknown block here
  // prevents a logged-but-invisible orphan row (the silent-drop the review caught).
  function applyChange(docId, blockId, patch, author) {
    var pageId = pageOfBlock(docId, blockId);
    if (pageId === null) return { ok: false, error: "unknown block (not in this doc's structure)", blockId: blockId };
    var content = (typeof patch === "string") ? patch : JSON.stringify(patch);
    qAppend.run(docId, blockId, "block.put", content, author || null, now());
    var seq = maxSeq();
    qPutBlock.run(docId, blockId, pageId, content);
    var after = qGetBlock.get(docId, blockId);
    return { ok: true, seq: seq, blockId: blockId, ver: after ? after.ver : 1, author: author || null };
  }

  // The global seq at which a block was last changed (0 if never). The collab layer's
  // baseSeq staleness guard (ticket 12) compares an incoming edit's baseSeq against this
  // to reject a late write from an ex-holder whose block was reclaimed + advanced.
  function blockLatestSeq(docId, blockId) { var r = qBlockMax.get(docId, blockId); return (r && r.m) || 0; }

  // Reconnect/rollback replay contract: events with seq > N (optionally one doc).
  function changesSince(seq, docId) {
    var rows = docId ? qSinceDoc.all(seq, docId) : qSince.all(seq);
    return rows.map(function (r) {
      return { seq: r.seq, docId: r.doc_id, blockId: r.block_id, kind: r.kind, patch: r.patch, author: r.author, ts: r.ts };
    });
  }

  // Snapshot: record the materialized state + the seq it captures, so replay can start
  // here instead of seq 0 (bounds replay length + log-driven load time). A non-null
  // `label` promotes it to a NAMED CHECKPOINT (ticket 04) an author can browse + restore.
  function takeSnapshot(docId, author, label) {
    var state = materializeDoc(docId);
    var atSeq = maxSeq();
    qPutSnap.run(docId, atSeq, JSON.stringify(state), label || null, author || null, now());
    var id = qMaxSeq && db.prepare("SELECT last_insert_rowid() AS id").get().id;
    return { docId: docId, id: id, atSeq: atSeq, label: label || null };
  }

  // Rebuild the doc by REPLAYING the log from the latest snapshot forward. Must equal
  // materializeDoc(docId) (AC2). Folds each block.put patch over the snapshot's blocks.
  function replayDoc(docId) {
    var snap = qLastSnap.get(docId);
    var baseSeq = snap ? snap.at_seq : 0;
    var state = snap ? JSON.parse(snap.state) : materializeDoc(docId);
    if (!state) return null;
    // index the snapshot's blocks by id (walk its pages)
    var blocks = {};
    (state.pages || []).forEach(function (p) { (p.blocks || []).forEach(function (b) { if (b && b.id != null) blocks[b.id] = b; }); });
    // fold forward
    changesSince(baseSeq, docId).forEach(function (ev) {
      if (ev.kind === "block.put") { try { blocks[ev.blockId] = JSON.parse(ev.patch); } catch (e) {} }
    });
    // reassemble using the snapshot's structure (page/block order) + folded contents
    var docMeta = {}; for (var k in state) if (k !== "pages") docMeta[k] = state[k];
    var pages = (state.pages || []).map(function (p) {
      var meta = {}; for (var pk in p) if (pk !== "blocks") meta[pk] = p[pk];
      var blockIds = (p.blocks || []).map(function (b) { return b && b.id; });
      return { meta: meta, blockIds: blockIds };
    });
    return assembleDoc(docMeta, pages, blocks);
  }

  // ---- Structural ops (ticket 14) -------------------------------------------
  // Structure changes (reorder / delete) mutate a page's block_order (and, for delete,
  // drop the block row), append a structural event to the log, and take a fresh baseline
  // snapshot so replayDoc === materializeDoc stays true (structure lives in the snapshot,
  // not folded from block.put events). The collab layer's conflict rule (never delete a
  // block another user holds a content lock on) is enforced in the hub BEFORE calling here.
  function pageRow(docId, pageId) { return qGetPage.all(docId).filter(function (p) { return p.id === pageId; })[0] || null; }

  // Reorder a page's blocks. newOrder must be a permutation of the page's current blocks
  // (positions only; block CONTENT is untouched -- so a reorder never conflicts with a
  // content lock, AC2). Returns { ok, seq }.
  function reorderBlocks(docId, pageId, newOrder, author) {
    var pr = pageRow(docId, pageId);
    if (!pr) return { ok: false, error: "no such page" };
    var cur = JSON.parse(pr.block_order);
    if (!Array.isArray(newOrder) || newOrder.length !== cur.length || !newOrder.every(function (id) { return cur.indexOf(id) >= 0; })) {
      return { ok: false, error: "reorder must be a permutation of the page's blocks" };
    }
    qSetOrder.run(JSON.stringify(newOrder), docId, pageId);
    qAppend.run(docId, null, "structure.reorder", JSON.stringify({ pageId: pageId, order: newOrder }), author || null, now());
    takeSnapshot(docId, author);
    return { ok: true, seq: maxSeq(), pageId: pageId, order: newOrder };
  }

  // Delete a block: drop it from its page's block_order + delete the row. Returns {ok,seq}.
  function deleteBlock(docId, blockId, author) {
    var pageId = pageOfBlock(docId, blockId);
    if (pageId === null) return { ok: false, error: "unknown block" };
    var pr = pageRow(docId, pageId);
    var order = JSON.parse(pr.block_order).filter(function (id) { return id !== blockId; });
    qSetOrder.run(JSON.stringify(order), docId, pageId);
    qDelBlock.run(docId, blockId);
    qAppend.run(docId, blockId, "structure.delete", JSON.stringify({ pageId: pageId }), author || null, now());
    takeSnapshot(docId, author);
    return { ok: true, seq: maxSeq(), pageId: pageId, blockId: blockId };
  }

  // ---- Named checkpoints + rollback TIME-axis (ticket 04) -------------------
  // A checkpoint is a named snapshot at a milestone/publish point. Because the block
  // store only ever holds BASE content (the editor's variant-preview wrapper __vbase is
  // non-enumerable and never serialises), a checkpoint captures the BASE doc, and a
  // restore rewrites the BASE doc -- the version-clone footgun is avoided by
  // construction. Rollback is thus a distinct TIME axis, orthogonal to the authored
  // variant / version / software-version axes (which live inside block content and are
  // carried through a restore unchanged, not re-selected).

  // Create a named checkpoint an author can browse + restore to.
  function createCheckpoint(docId, name, author) {
    if (!name) return { ok: false, error: "checkpoint needs a name" };
    var s = takeSnapshot(docId, author, name);
    return { ok: true, id: s.id, name: name, atSeq: s.atSeq };
  }
  // Browse checkpoints for a master (newest concept first is the UI's job; return in
  // creation order here).
  function listCheckpoints(docId) {
    return qCheckpoints.all(docId).map(function (r) {
      return { id: r.id, name: r.label, atSeq: r.at_seq, author: r.author, ts: r.ts };
    });
  }
  // Restore the whole doc to a named checkpoint: rewrite the BASE-doc rows to the
  // checkpoint's captured state, append a durable `doc.restore` marker to the log (the
  // restore is itself never-lose history), then take a fresh baseline so replay stays
  // consistent. Forward-only: the log is never rewritten.
  function restoreCheckpoint(docId, checkpointId, author) {
    var snap = qGetSnap.get(checkpointId);
    if (!snap || snap.doc_id !== docId) return { ok: false, error: "no such checkpoint for this doc" };
    var state = JSON.parse(snap.state);
    // state already carries stable ids -> decompose without minting (guard against it).
    var d = decomposeDoc(state, function () { throw new Error("restore must not mint ids"); });
    putDecomposed(docId, d);
    qAppend.run(docId, null, "doc.restore", JSON.stringify({ toCheckpoint: checkpointId, atSeq: snap.at_seq }), author || null, now());
    takeSnapshot(docId, author); // fresh baseline so replayDoc === materializeDoc
    return { ok: true, docId: docId, restoredTo: checkpointId, atSeq: snap.at_seq, seq: maxSeq() };
  }

  // ---- Single-block history + revert-in-place (ticket 04 substrate) ---------
  // Per-block history: every change event for one block, in seq order. The substrate
  // Phase 2's single-block-revert restore mode acts on.
  function blockHistory(docId, blockId) {
    return qBlockHist.all(docId, blockId).map(function (r) {
      return { seq: r.seq, blockId: r.block_id, kind: r.kind, patch: r.patch, author: r.author, ts: r.ts };
    });
  }
  // Revert ONE block in place to its content as of seq <= toSeq, appending a NEW event
  // (forward-only -- the log is never rewritten). Returns the applyChange result. If the
  // block had no event at/before toSeq, falls back to its content in the newest snapshot
  // at/before toSeq (the import baseline).
  function revertBlock(docId, blockId, toSeq, author) {
    var hist = blockHistory(docId, blockId).filter(function (e) { return e.kind === "block.put" && e.seq <= toSeq; });
    var content = null;
    if (hist.length) content = hist[hist.length - 1].patch; // last put at/before toSeq (a JSON string)
    else {
      // no put yet -> recover from the newest snapshot at/before toSeq
      var snaps = db.prepare("SELECT state FROM snapshots WHERE doc_id = ? AND at_seq <= ? ORDER BY at_seq DESC, id DESC LIMIT 1").get(docId, toSeq);
      if (snaps) {
        var st = JSON.parse(snaps.state);
        (st.pages || []).forEach(function (p) { (p.blocks || []).forEach(function (b) { if (b && b.id === blockId) content = JSON.stringify(b); }); });
      }
    }
    if (content === null) return { ok: false, error: "no history for this block at/before seq " + toSeq, blockId: blockId };
    var res = applyChange(docId, blockId, content, author);
    if (res.ok) res.content = content; // the reverted-to content, for the hub to fan out
    return res;
  }

  return {
    importDoc: importDoc,
    exportDoc: exportDoc,
    materializeDoc: materializeDoc,
    applyChange: applyChange,
    blockLatestSeq: blockLatestSeq,
    reorderBlocks: reorderBlocks,
    deleteBlock: deleteBlock,
    changesSince: changesSince,
    takeSnapshot: takeSnapshot,
    replayDoc: replayDoc,
    maxSeq: maxSeq,
    createCheckpoint: createCheckpoint,
    listCheckpoints: listCheckpoints,
    restoreCheckpoint: restoreCheckpoint,
    blockHistory: blockHistory,
    revertBlock: revertBlock,
    close: function () { db.close(); },
    _db: db
  };
}

module.exports = {
  createBlockStore: createBlockStore,
  decomposeDoc: decomposeDoc,
  assembleDoc: assembleDoc,
  coalesceChanges: coalesceChanges
};
