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
    "CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, at_seq INTEGER, state TEXT, ts INTEGER);"
  );

  var qPutDoc     = db.prepare("INSERT INTO docs (id, meta, page_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, page_order = excluded.page_order");
  var qGetDoc     = db.prepare("SELECT meta, page_order FROM docs WHERE id = ?");
  var qPutPage    = db.prepare("INSERT INTO pages (doc_id, id, meta, block_order, ord) VALUES (?, ?, ?, ?, ?) ON CONFLICT(doc_id, id) DO UPDATE SET meta = excluded.meta, block_order = excluded.block_order, ord = excluded.ord");
  var qGetPage    = db.prepare("SELECT id, meta, block_order FROM pages WHERE doc_id = ? ORDER BY ord");
  var qPutBlock   = db.prepare("INSERT INTO blocks (doc_id, id, page_id, content, ver) VALUES (?, ?, ?, ?, 1) ON CONFLICT(doc_id, id) DO UPDATE SET page_id = excluded.page_id, content = excluded.content, ver = blocks.ver + 1");
  var qGetBlock   = db.prepare("SELECT content, ver FROM blocks WHERE doc_id = ? AND id = ?");
  var qAppend     = db.prepare("INSERT INTO changes (doc_id, block_id, kind, patch, author, ts) VALUES (?, ?, ?, ?, ?, ?)");
  var qSince      = db.prepare("SELECT seq, doc_id, block_id, kind, patch, author, ts FROM changes WHERE seq > ? ORDER BY seq");
  var qSinceDoc   = db.prepare("SELECT seq, doc_id, block_id, kind, patch, author, ts FROM changes WHERE seq > ? AND doc_id = ? ORDER BY seq");
  var qMaxSeq     = db.prepare("SELECT MAX(seq) AS m FROM changes");
  var qPutSnap    = db.prepare("INSERT INTO snapshots (doc_id, at_seq, state, ts) VALUES (?, ?, ?, ?)");
  var qLastSnap   = db.prepare("SELECT at_seq, state FROM snapshots WHERE doc_id = ? ORDER BY at_seq DESC, id DESC LIMIT 1");

  var now = opts.now || function () { return 0; }; // injectable clock (Date.now() in prod)

  function maxSeq() { var r = qMaxSeq.get(); return (r && r.m) || 0; }

  // Import a whole doc: decompose into rows + take an "imported" baseline snapshot so
  // replay has a clean, bounded starting point. This ONE path also serves .verso
  // import + local->server publish + migration (ticket 05 hardens round-trip fidelity).
  function importDoc(docId, doc, author) {
    var d = decomposeDoc(doc, mintId);
    qPutDoc.run(docId, JSON.stringify(d.docMeta), JSON.stringify(d.pages.map(function (p) { return p.meta.id; })));
    d.pages.forEach(function (p, ord) {
      qPutPage.run(docId, p.meta.id, JSON.stringify(p.meta), JSON.stringify(p.blockIds), ord);
      p.blockIds.forEach(function (bid) {
        // fresh import -> insert at ver 1 (delete any stale prior rows first for idempotency)
        db.prepare("DELETE FROM blocks WHERE doc_id = ? AND id = ?").run(docId, bid);
        qPutBlock.run(docId, bid, p.meta.id, JSON.stringify(d.blocks[bid]));
      });
    });
    takeSnapshot(docId, author); // baseline
    return { docId: docId, pages: d.pages.length, blocks: Object.keys(d.blocks).length };
  }

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
  function applyChange(docId, blockId, patch, author) {
    var content = (typeof patch === "string") ? patch : JSON.stringify(patch);
    qAppend.run(docId, blockId, "block.put", content, author || null, now());
    var seq = maxSeq();
    // materialize: find the page this block lives on (keep it where it is)
    var existing = qGetBlock.get(docId, blockId);
    var pageId = null;
    if (existing) {
      var pr = qGetPage.all(docId).filter(function (p) { return JSON.parse(p.block_order).indexOf(blockId) >= 0; })[0];
      pageId = pr ? pr.id : null;
    }
    qPutBlock.run(docId, blockId, pageId, content);
    var after = qGetBlock.get(docId, blockId);
    return { seq: seq, blockId: blockId, ver: after ? after.ver : 1, author: author || null };
  }

  // Reconnect/rollback replay contract: events with seq > N (optionally one doc).
  function changesSince(seq, docId) {
    var rows = docId ? qSinceDoc.all(seq, docId) : qSince.all(seq);
    return rows.map(function (r) {
      return { seq: r.seq, docId: r.doc_id, blockId: r.block_id, kind: r.kind, patch: r.patch, author: r.author, ts: r.ts };
    });
  }

  // Periodic snapshot: record the materialized state + the seq it captures, so replay
  // can start here instead of seq 0 (bounds replay length + log-driven load time).
  function takeSnapshot(docId, author) {
    var state = materializeDoc(docId);
    var atSeq = maxSeq();
    qPutSnap.run(docId, atSeq, JSON.stringify(state), now());
    return { docId: docId, atSeq: atSeq };
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

  return {
    importDoc: importDoc,
    materializeDoc: materializeDoc,
    applyChange: applyChange,
    changesSince: changesSince,
    takeSnapshot: takeSnapshot,
    replayDoc: replayDoc,
    maxSeq: maxSeq,
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
