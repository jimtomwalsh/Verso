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

// The collaboration envelope. The server stamps `seq` on anything it fans out from the
// log; ephemeral traffic (presence/cursor) carries no seq.
function envelope(type, docId, blockId, seq, author, ts, payload) {
  return { type: type, docId: docId, blockId: blockId != null ? blockId : null, seq: seq != null ? seq : null, author: author != null ? author : null, ts: ts != null ? ts : 0, payload: payload || {} };
}

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
  var roleOf = opts.roleOf || function (c) { return (c && c.role) || "author"; }; // real roles = ticket 17
  var docs = {};     // docId -> array of subscribed clients
  var clients = [];  // all connected clients

  function subs(docId) { return docs[docId] || (docs[docId] = []); }

  // Fan out to every client subscribed to docId EXCEPT the origin. DORMANT in local mode.
  function fanOut(docId, env, except) {
    if (mode !== "server") return;
    subs(docId).forEach(function (c) { if (c !== except) { try { c.transport.send(env); } catch (e) {} } });
  }

  function connect(transport, author) {
    var client = { transport: transport, author: author || null, docId: null };
    clients.push(client);
    transport.onMessage(function (env) { handle(client, env); });
    transport.onDrop(function () { disconnect(client); });
    return client;
  }

  function disconnect(client) {
    if (client.docId) { var a = subs(client.docId); var i = a.indexOf(client); if (i >= 0) a.splice(i, 1); }
    var j = clients.indexOf(client); if (j >= 0) clients.splice(j, 1);
    if (lockManager && lockManager.releaseAll) lockManager.releaseAll(client);
  }

  function handle(client, env) {
    if (!env || !env.type) return;
    if (env.type === "sync.hello") return onHello(client, env);
    if (env.type === "block.change") return onBlockChange(client, env);
    if (env.type === "lock.acquire" || env.type === "lock.release") return onLock(client, env);
    if (env.type === "structure.op") return onStructure(client, env);   // ticket 14
    if (env.type === "doc.restore") return onRestore(client, env);      // ticket 14 (admin)
    if (env.type === "block.revert") return onRevert(client, env);      // ticket 14 (author)
    if (env.type === "presence.heartbeat" || env.type === "cursor.update") {
      // ephemeral: fan out as-is, never seq-stamped, never logged (presence/cursor state
      // is ticket 11; here we just relay so peers see live activity).
      return fanOut(env.docId, env, client);
    }
    // unknown types are ignored (forward-compatible envelope)
  }

  // Connect / reconnect handshake: subscribe + replay the doc's events since sinceSeq
  // (Foundation's changesSince -- one model). Full resnapshot decision is ticket 09.
  function onHello(client, env) {
    client.docId = env.docId;
    var a = subs(env.docId); if (a.indexOf(client) < 0) a.push(client);
    var since = (env.payload && env.payload.sinceSeq) || 0;
    var events = blockStore ? blockStore.changesSince(since, env.docId) : [];
    var upTo = blockStore ? blockStore.maxSeq() : 0;
    // send the current lock registry too (empty until ticket 10 wires a lockManager)
    if (lockManager && lockManager.stateFor) {
      client.transport.send(envelope("lock.state", env.docId, null, null, null, now(), { locks: lockManager.stateFor(env.docId) }));
    }
    client.transport.send(envelope("sync.catchup", env.docId, null, upTo, null, now(), { events: events, upToSeq: upTo }));
  }

  // A block edit: (optionally) check the holder's lock, persist to the store BEFORE
  // fan-out, then fan out seq-stamped + ack the sender with the stamped seq.
  function onBlockChange(client, env) {
    var p = env.payload || {};
    // lock rule (ticket 10): a block.change is accepted ONLY from the current holder.
    // Absent a lockManager (08 alone / local), all changes are accepted.
    if (lockManager && lockManager.holder && lockManager.holder(env.docId, env.blockId) &&
        lockManager.holder(env.docId, env.blockId) !== client) {
      return client.transport.send(envelope("block.denied", env.docId, env.blockId, null, null, now(), { reason: "locked by another editor" }));
    }
    // baseSeq staleness guard (ticket 12): reject a late write based on a version the
    // block has already moved past (e.g. an ex-holder's edit after the reaper reclaimed
    // the block and a new holder advanced it). A soft conflict -- never a silent drop.
    if (p.baseSeq != null && blockStore && blockStore.blockLatestSeq &&
        blockStore.blockLatestSeq(env.docId, env.blockId) > p.baseSeq) {
      return client.transport.send(envelope("block.conflict", env.docId, env.blockId, blockStore.blockLatestSeq(env.docId, env.blockId), null, now(), { reason: "stale baseSeq", baseSeq: p.baseSeq }));
    }
    var content = (p.patch != null) ? p.patch : p.content;
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
    if (p.op === "delete") {
      var h = lockManager && lockManager.holder && lockManager.holder(env.docId, env.blockId);
      if (h && h !== client) {
        return client.transport.send(envelope("structure.denied", env.docId, env.blockId, null, null, now(), { reason: "someone is editing this block -- can't remove", holder: h.author, op: "delete" }));
      }
      var rd = blockStore.deleteBlock(env.docId, env.blockId, env.author);
      if (!rd.ok) return client.transport.send(envelope("structure.denied", env.docId, env.blockId, null, null, now(), { reason: rd.error }));
      return fanOut(env.docId, envelope("structure.applied", env.docId, env.blockId, rd.seq, env.author, now(), { op: "delete", pageId: rd.pageId }), null);
    }
    if (p.op === "reorder") {
      var rr = blockStore.reorderBlocks(env.docId, p.pageId, p.order, env.author);
      if (!rr.ok) return client.transport.send(envelope("structure.denied", env.docId, null, null, null, now(), { reason: rr.error }));
      return fanOut(env.docId, envelope("structure.applied", env.docId, null, rr.seq, env.author, now(), { op: "reorder", pageId: rr.pageId, order: rr.order }), null);
    }
    return client.transport.send(envelope("structure.denied", env.docId, null, null, null, now(), { reason: "unknown structural op" }));
  }

  // Admin file-checkpoint restore (ticket 14). Requires others idle, OR an explicit
  // force-evict (with a warning) that releases others' locks first. Broadcasts
  // sync.resnapshot so EVERY client (incl. origin) discards local state and converges.
  // A client holding buffered unacked edits at this moment surfaces a soft conflict
  // client-side (ticket 13) -- never a silent loss; the resnapshot carries the seq.
  function onRestore(client, env) {
    if (roleOf(client) !== "admin") return client.transport.send(envelope("restore.denied", env.docId, null, null, null, now(), { reason: "admin only" }));
    var p = env.payload || {};
    var othersHold = lockManager ? lockManager.allLocks().filter(function (l) { return l.docId === env.docId && l.holder !== client; }) : [];
    if (othersHold.length && !p.force) {
      return client.transport.send(envelope("restore.denied", env.docId, null, null, null, now(), { reason: "others are editing -- restore needs everyone idle or a force-evict", needsForce: true, holders: othersHold.map(function (l) { return l.author; }) }));
    }
    if (othersHold.length && p.force && lockManager) {
      othersHold.forEach(function (l) { lockManager._forceRelease(l.docId, l.resourceId, l.class); });
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
