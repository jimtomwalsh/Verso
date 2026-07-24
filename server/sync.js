/*
 * server/sync.js -- the live-collaboration spine (platform-pivot 08/31, Collaboration).
 * SERVER-MODE ONLY; fully DORMANT in local mode. Sits on top of the Foundation block
 * store + change log. This module is the single authoritative sequencer + fan-out and
 * the typed message envelope; the wire transports (hand-rolled wss:// + long-poll) live
 * in server/sync-wire.js behind the Transport interface so this core never knows which
 * pipe is live.
 *
 * 04 == 05 (load-bearing): the sync stream IS the storage change log. A block.change is
 * PERSISTED to the store BEFORE fan-out (the append IS the autosave), and the seq it is
 * fanned out with is Foundation's SAME global append-log seq -- we do NOT invent a
 * second per-doc counter (AC4: no second event model for the wire). "Per-doc seq" is a
 * doc's monotonic SUBSEQUENCE of that one global seq; sync.hello {sinceSeq} replays via
 * Foundation's changesSince(sinceSeq, docId).
 *
 * Scope of THIS ticket (08): transport interface + envelope + sequencer + fan-out for
 * block.change and sync.hello (catchup). Recognized-but-deferred to later tickets:
 * real lock enforcement (10 -- an injectable lockManager plugs in here), presence/cursor
 * state (11), full reconnect resnapshot + client buffer (09/13). Presence/cursor
 * envelopes are EPHEMERAL: fanned out, never seq-stamped, never logged.
 *
 * Dependency-free: no requires. render() is never involved.
 */
"use strict";

// The ONE collaboration envelope shape, shared with the lock manager (server/envelope.js)
// so the wire contract can never drift between them.
var envelope = require("./envelope").envelope;

// In-memory transport for tests + the primary seam. Real wss/long-poll transports (in
// server/sync-wire.js) satisfy the same interface: send / onMessage / onDrop / close.
function FakeTransport() {
  var self = { sent: [], _msg: null, _drop: null };
  self.send = function (env) { self.sent.push(env); };
  self.onMessage = function (cb) { self._msg = cb; };
  self.onDrop = function (cb) { self._drop = cb; };
  self.close = function () { if (self._drop) self._drop(); };
  // test helper: simulate the client pushing an inbound envelope to the server
  self.receive = function (env) { if (self._msg) self._msg(env); };
  return self;
}

// The hub: connection registry + per-doc subscription sets + the sequencer/fan-out.
// blockStore = Foundation's store (applyChange / changesSince / maxSeq). opts:
//   { mode: "local"|"server", now, lockManager? }.
function createSyncHub(blockStore, opts) {
  opts = opts || {};
  var mode = opts.mode || "local";
  var now = opts.now || function () { return 0; };
  var lockManager = opts.lockManager || null; // ticket 10 plugs in here; absent -> auto-grant
  var presence = opts.presence || null;       // ticket 11 plugs in here; absent -> plain relay
  var review = opts.review || null;           // ticket 23 plugs in here; absent -> plain relay
  var roleOf = opts.roleOf || function (c) { return (c && c.role) || "author"; }; // real roles = ticket 17
  var catchupWindow = opts.catchupWindow != null ? opts.catchupWindow : 500; // low-water mark for catchup vs resnapshot (ticket 09)
  var docs = {};     // docId -> array of subscribed clients
  var clients = [];  // all connected clients

  function subs(docId) { return docs[docId] || (docs[docId] = []); }

  // Fan out to every client subscribed to docId EXCEPT the origin. DORMANT in local mode.
  function fanOut(docId, env, except) {
    if (mode !== "server") return;
    subs(docId).forEach(function (c) { if (c !== except) { try { c.transport.send(env); } catch (e) {} } });
  }

  function connect(transport, author, role) {
    // role comes from the RESOLVED session/token (never self-declared) so the hub's
    // capability gates (edit/lock via roleOf -> client.role) are authoritative.
    var client = { transport: transport, author: author || null, role: role || null, docId: null };
    clients.push(client);
    transport.onMessage(function (env) { handle(client, env); });
    transport.onDrop(function () { disconnect(client); });
    return client;
  }

  function disconnect(client) {
    var docId = client.docId;
    if (docId) { var a = subs(docId); var i = a.indexOf(client); if (i >= 0) a.splice(i, 1); }
    var j = clients.indexOf(client); if (j >= 0) clients.splice(j, 1);
    if (lockManager && lockManager.releaseAll) lockManager.releaseAll(client);
    if (presence) { presence.drop(client); if (docId) fanOut(docId, envelope("presence.state", docId, null, null, null, now(), { peers: presence.peersFor(docId) }), null); }
  }

  // Ephemeral presence/cursor: update the (optional) presence table + broadcast the fresh
  // presence.state, else just relay. Never seq-stamped, never logged.
  function onPresence(client, env) {
    if (presence) {
      if (env.type === "cursor.update") presence.cursor(client, env.docId, env.payload);
      else presence.heartbeat(client, env.docId, env.payload);
      if (lockManager && lockManager.heartbeat && env.payload && env.payload.editingBlockId) {
        lockManager.heartbeat(client, env.docId, env.payload.editingBlockId, "content"); // presence refreshes the edit lease
      }
      return fanOut(env.docId, envelope("presence.state", env.docId, null, null, null, now(), { peers: presence.peersFor(env.docId) }), null);
    }
    return fanOut(env.docId, env, client);
  }
  // Human path out of a stuck lock (ticket 13 server relay): request-handoff pings the
  // holder; notify-when-free is registered and fired on release. Ephemeral relay here;
  // the client buffer + soft-conflict UI is client-side (ticket 13).
  function onHandoff(client, env) { return fanOut(env.docId, env, client); }

  // Review comments over sync (ticket 23): store + fan out to EVERYONE on the doc so an
  // author's editor and a reviewer's link stay in sync BOTH ways. Anchored to stable ids.
  function onComment(client, env) {
    var p = env.payload || {};
    if (!review) return fanOut(env.docId, env, client);
    var out;
    if (env.type === "comment.add") {
      var r = review.addComment(env.docId, env.blockId, client, p.body, p.threadId);
      out = envelope("comment.added", env.docId, env.blockId, null, r.author, now(), { id: r.id, threadId: r.threadId, body: p.body, kind: r.kind });
    } else { // comment.resolve
      review.resolveThread(p.threadId, p.resolved !== false);
      out = envelope("comment.resolved", env.docId, env.blockId, null, client && client.author, now(), { threadId: p.threadId, resolved: p.resolved !== false });
    }
    subs(env.docId).forEach(function (c) { if (mode === "server") try { c.transport.send(out); } catch (e) {} }); // incl. origin (both-ways convergence)
  }

  // One dispatch table keyed by envelope type -- a new message type adds a row here, it
  // does not grow an if-cascade.
  var HANDLERS = {
    "sync.hello": onHello,
    "block.change": onBlockChange,
    "lock.acquire": onLock,
    "lock.release": onLock,
    "structure.op": onStructure,   // ticket 14
    "doc.restore": onRestore,      // ticket 14 (admin)
    "block.revert": onRevert,      // ticket 14 (author)
    "presence.heartbeat": onPresence,  // ticket 11
    "cursor.update": onPresence,       // ticket 11
    "lock.requestHandoff": onHandoff,  // ticket 13 (relay)
    "lock.notifyWhenFree": onHandoff,  // ticket 13 (relay)
    "comment.add": onComment,          // ticket 23
    "comment.resolve": onComment       // ticket 23
  };
  function handle(client, env) {
    if (!env || !env.type) return;
    var h = HANDLERS[env.type];
    if (h) h(client, env); // unknown types are ignored (forward-compatible envelope)
  }

  // Connect / reconnect handshake -- transport-invisible (ticket 09). Everything funnels
  // through sync.hello {sinceSeq}:
  //   - a RECENT reconnect (sinceSeq in-buffer) gets a bounded sync.catchup DELTA of the
  //     events since sinceSeq (Foundation's changesSince -- one model);
  //   - a FRESH client (sinceSeq<=0, which has no base -- imported blocks carry no
  //     block.put events) OR one BELOW the low-water mark (too far behind to replay) gets
  //     a full sync.resnapshot of the materialized doc.
  function onHello(client, env) {
    client.docId = env.docId;
    var a = subs(env.docId); if (a.indexOf(client) < 0) a.push(client);
    var since = (env.payload && env.payload.sinceSeq) || 0;
    var upTo = blockStore ? blockStore.maxSeq() : 0;
    // send the current lock registry too (empty until a lockManager is wired / after restart)
    if (lockManager && lockManager.stateFor) {
      client.transport.send(envelope("lock.state", env.docId, null, null, null, now(), { locks: lockManager.stateFor(env.docId) }));
    }
    if (blockStore && since > 0 && (upTo - since) <= catchupWindow) {
      client.transport.send(envelope("sync.catchup", env.docId, null, upTo, null, now(), { events: blockStore.changesSince(since, env.docId), upToSeq: upTo }));
    } else {
      client.transport.send(envelope("sync.resnapshot", env.docId, null, upTo, null, now(), { snapshot: blockStore ? blockStore.materializeDoc(env.docId) : null, seq: upTo }));
    }
  }

  // A block edit: (optionally) check the holder's lock, persist to the store BEFORE
  // fan-out, then fan out seq-stamped + ack the sender with the stamped seq.
  function onBlockChange(client, env) {
    var p = env.payload || {};
    // Lock rule (ticket 10): a block.change is accepted ONLY from the current content-lock
    // holder. Implicit acquisition on edit-intent (spec: focus / FIRST KEYSTROKE) -- a
    // change on a block nobody holds AUTO-ACQUIRES the lock for this editor, so the server
    // enforces holder-only without a separate claim step. Absent a lockManager (08 alone /
    // local mode) all changes are accepted.
    if (lockManager && lockManager.holder) {
      var held = lockManager.holder(env.docId, env.blockId);
      if (held && held !== client) {
        return client.transport.send(envelope("block.denied", env.docId, env.blockId, null, null, now(), { reason: "locked by another editor" }));
      }
      if (!held) {
        var acq = lockManager.acquire(client, env.docId, env.blockId, {});
        if (acq && acq.reply && acq.reply.type === "lock.denied") {
          return client.transport.send(acq.reply); // e.g. a non-edit role
        }
        if (acq && acq.broadcast) fanOut(env.docId, acq.broadcast, client); // announce the implicit lock
      }
    }
    // baseSeq staleness guard (ticket 12): reject a late write based on a version the
    // block has already moved past (e.g. an ex-holder's edit after the reaper reclaimed
    // the block and a new holder advanced it). A soft conflict -- never a silent drop.
    if (p.baseSeq != null && blockStore && blockStore.blockLatestSeq &&
        blockStore.blockLatestSeq(env.docId, env.blockId) > p.baseSeq) {
      return client.transport.send(envelope("block.conflict", env.docId, env.blockId, blockStore.blockLatestSeq(env.docId, env.blockId), null, now(), { reason: "stale baseSeq", baseSeq: p.baseSeq }));
    }
    var content = (p.patch != null) ? p.patch : p.content;
    // Idempotent replay (ticket 09): a duplicate/replayed edit that sets the value the
    // block already holds appends NO event -- ack it as a harmless no-op. Makes reconnect
    // replay safe even when the buffered edit was actually acked before the drop.
    if (blockStore && blockStore.blockContent) {
      var contentStr = (typeof content === "string") ? content : JSON.stringify(content);
      if (blockStore.blockContent(env.docId, env.blockId) === contentStr) {
        return client.transport.send(envelope("block.ack", env.docId, env.blockId, blockStore.blockLatestSeq(env.docId, env.blockId), env.author, now(), { baseSeq: p.baseSeq, noop: true }));
      }
    }
    var res = blockStore ? blockStore.applyChange(env.docId, env.blockId, content, env.author) : { ok: true, seq: 0 };
    if (!res.ok) {
      return client.transport.send(envelope("block.denied", env.docId, env.blockId, null, null, now(), { reason: res.error }));
    }
    // an accepted edit is activity -> refresh the holder's lease (keeps the reaper away)
    if (lockManager && lockManager.heartbeat) lockManager.heartbeat(client, env.docId, env.blockId, "content");
    // fan out to the OTHER clients, seq-stamped with Foundation's global seq
    fanOut(env.docId, envelope("block.change", env.docId, env.blockId, res.seq, env.author, now(), { patch: content, baseSeq: p.baseSeq }), client);
    // ack the sender so it can retire its unacked buffer (ticket 13)
    client.transport.send(envelope("block.ack", env.docId, env.blockId, res.seq, env.author, now(), { baseSeq: p.baseSeq }));
  }

  // Lock acquire/release. Real enforcement + registry is ticket 10 (an injected
  // lockManager); absent one, acquisition auto-grants (also the local-mode posture).
  function onLock(client, env) {
    if (!lockManager) {
      return client.transport.send(envelope(env.type === "lock.acquire" ? "lock.granted" : "lock.released", env.docId, env.blockId, null, client.author, now(), { holder: client.author }));
    }
    var r = env.type === "lock.acquire"
      ? lockManager.acquire(client, env.docId, env.blockId, env.payload)
      : lockManager.release(client, env.docId, env.blockId, env.payload && env.payload.class);
    if (r && r.broadcast) fanOut(env.docId, r.broadcast, null);
    if (r && r.reply) client.transport.send(r.reply);
  }

  var EDIT_ROLES = { admin: true, author: true };
  function canEdit(client) { return !!EDIT_ROLES[roleOf(client)]; }

  // Structural op (ticket 14). The ONE real conflict: a delete/move-out touching a block
  // another user holds a CONTENT lock on is REFUSED -- never evicts the editor. A reorder
  // is always allowed (content applies by block id regardless of position, AC2).
  function onStructure(client, env) {
    if (!canEdit(client)) return client.transport.send(envelope("structure.denied", env.docId, null, null, null, now(), { reason: "role may not edit" }));
    var p = env.payload || {};
    if (!blockStore) return;
    var deny = function (blockId, extra) { client.transport.send(envelope("structure.denied", env.docId, blockId, null, null, now(), extra)); };

    // Take a brief, coarse STRUCTURE lock on the container for the op's duration (spec
    // model B: momentary; serializes near-simultaneous reorders, AC21). Separate from
    // content locks, so colleagues keep editing block content while structure changes.
    var containerId = p.pageId || (p.op === "delete" ? "delete:" + env.docId : "structure");
    if (lockManager) {
      var sl = lockManager.acquire(client, env.docId, containerId, { class: "structure" });
      if (sl && sl.reply && sl.reply.type === "lock.denied") {
        return deny(null, { reason: "another structural op is in progress -- retry", holder: sl.reply.payload.holder, op: p.op });
      }
    }
    function releaseStructureLock() { if (lockManager) lockManager.release(client, env.docId, containerId, "structure"); }

    if (p.op === "delete") {
      var h = lockManager && lockManager.holder && lockManager.holder(env.docId, env.blockId);
      if (h && h !== client) { releaseStructureLock(); return deny(env.blockId, { reason: "someone is editing this block -- can't remove", holder: h.author, op: "delete" }); }
      var rd = blockStore.deleteBlock(env.docId, env.blockId, env.author);
      if (!rd.ok) { releaseStructureLock(); return deny(env.blockId, { reason: rd.error }); }
      // the deleter may have held the block's own content lock -> release it (the block is gone)
      if (lockManager && h === client) lockManager.release(client, env.docId, env.blockId, "content");
      fanOut(env.docId, envelope("structure.applied", env.docId, env.blockId, rd.seq, env.author, now(), { op: "delete", pageId: rd.pageId }), null);
      return releaseStructureLock();
    }
    if (p.op === "reorder") {
      var rr = blockStore.reorderBlocks(env.docId, p.pageId, p.order, env.author);
      if (!rr.ok) { releaseStructureLock(); return deny(null, { reason: rr.error }); }
      fanOut(env.docId, envelope("structure.applied", env.docId, null, rr.seq, env.author, now(), { op: "reorder", pageId: rr.pageId, order: rr.order }), null);
      return releaseStructureLock();
    }
    releaseStructureLock();
    return deny(null, { reason: "unknown structural op" });
  }

  // Admin file-checkpoint restore (ticket 14). Requires others idle, OR an explicit
  // force-evict (with a warning) that releases others' locks first. Broadcasts
  // sync.resnapshot so EVERY client (incl. origin) discards local state and converges.
  // A client holding buffered unacked edits at this moment surfaces a soft conflict
  // client-side (ticket 13) -- never a silent loss; the resnapshot carries the seq.
  function onRestore(client, env) {
    if (roleOf(client) !== "admin") return client.transport.send(envelope("restore.denied", env.docId, null, null, null, now(), { reason: "admin only" }));
    var p = env.payload || {};
    var others = lockManager ? lockManager.othersHold(env.docId, client) : [];
    if (others.length && !p.force) {
      return client.transport.send(envelope("restore.denied", env.docId, null, null, null, now(), { reason: "others are editing -- restore needs everyone idle or a force-evict", needsForce: true, holders: others.map(function (l) { return l.author; }) }));
    }
    if (others.length && p.force && lockManager) {
      lockManager.forceReleaseDoc(env.docId, client);
      fanOut(env.docId, envelope("lock.state", env.docId, null, null, null, now(), { locks: lockManager.stateFor(env.docId), forceEvicted: true }), null);
    }
    var rr = blockStore.restoreCheckpoint(env.docId, p.checkpointId, env.author);
    if (!rr.ok) return client.transport.send(envelope("restore.denied", env.docId, null, null, null, now(), { reason: rr.error }));
    // broadcast to ALL clients on the doc (origin included) so everyone converges
    var snap = envelope("sync.resnapshot", env.docId, null, rr.seq, env.author, now(), { snapshot: blockStore.materializeDoc(env.docId), seq: rr.seq, restoredTo: p.checkpointId });
    subs(env.docId).forEach(function (c) { if (mode === "server") try { c.transport.send(snap); } catch (e) {} });
  }

  // Author single-block revert (ticket 14): revert a block in place to a prior logged
  // state; others sync it live as a NORMAL block.change.
  function onRevert(client, env) {
    if (!canEdit(client)) return client.transport.send(envelope("block.denied", env.docId, env.blockId, null, null, now(), { reason: "role may not edit" }));
    var p = env.payload || {};
    var rv = blockStore ? blockStore.revertBlock(env.docId, env.blockId, p.toSeq, env.author) : { ok: false };
    if (!rv.ok) return client.transport.send(envelope("block.denied", env.docId, env.blockId, null, null, now(), { reason: rv.error }));
    var out = envelope("block.change", env.docId, env.blockId, rv.seq, env.author, now(), { patch: rv.content, baseSeq: rv.seq, revert: true });
    fanOut(env.docId, out, client);
    client.transport.send(envelope("block.ack", env.docId, env.blockId, rv.seq, env.author, now(), { revert: true }));
  }

  return {
    connect: connect,
    disconnect: disconnect,
    fanOut: fanOut,
    envelope: envelope,
    mode: mode,
    _subs: subs,
    _clients: function () { return clients; }
  };
}

module.exports = { createSyncHub: createSyncHub, FakeTransport: FakeTransport, envelope: envelope };
