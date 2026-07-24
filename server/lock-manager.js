/*
 * server/lock-manager.js -- block-level locking, concurrency model B (platform-pivot
 * 10/31, Collaboration). No CRDT. The authoritative lock registry the sync hub consults:
 * a block.change is accepted ONLY from the current content-lock holder.
 *
 * Two independent lock namespaces (spec model B):
 *   - content   : per LEAF block, fine-grained. Acquired implicitly on edit-intent
 *                 (focus / first keystroke), auto-released on blur / idle / save.
 *   - structure : per CONTAINER id, coarse + momentary -- held only for the duration of a
 *                 structural op (add/move/delete/reorder). SEPARATE from content locks so
 *                 colleagues keep editing block content on a page while structure changes.
 *
 * Each lock carries acquiredAt + heartbeat-refreshed lastSeen; the reaper (ticket 12)
 * reclaims a vanished holder's lock after a grace window. The one real conflict
 * (structure op vs a held content lock) is ticket 14. Role gating (AC5: only edit-capable
 * roles acquire) is honoured via an injected roleOf(); identity itself is Phase 3 (17).
 *
 * Dependency-free. Never renders. Plugs into createSyncHub via opts.lockManager.
 */
"use strict";

var EDIT_ROLES = { admin: true, author: true }; // reviewer/viewer/guest are never offered a lock

function createLockManager(opts) {
  opts = opts || {};
  var now = opts.now || function () { return 0; };
  // Until identity (ticket 17) provides roles, default every connected editor to "author"
  // (edit-capable). When identity lands, roleOf reads the real role -> AC5 is enforced.
  var roleOf = opts.roleOf || function (client) { return (client && client.role) || "author"; };
  // registry[docId][class][resourceId] = { holder(client), author, acquiredAt, lastSeen }
  var registry = {};

  function docReg(docId) { return registry[docId] || (registry[docId] = { content: {}, structure: {} }); }
  function ns(docId, cls) { var d = docReg(docId); return d[cls === "structure" ? "structure" : "content"]; }
  function canEdit(client) { return !!EDIT_ROLES[roleOf(client)]; }

  function envelope(type, docId, blockId, payload) {
    return { type: type, docId: docId, blockId: blockId != null ? blockId : null, seq: null, author: null, ts: now(), payload: payload || {} };
  }

  // The client currently holding a CONTENT lock on a block (or null). The hub's
  // block.change gate calls this: a change is accepted only from this holder.
  function holder(docId, blockId) {
    var e = ns(docId, "content")[blockId];
    return e ? e.holder : null;
  }

  // Acquire a lock. resourceId = block id (content) or container id (structure). Implicit
  // on edit-intent; a re-acquire by the same holder just refreshes the lease.
  function acquire(client, docId, resourceId, payload) {
    payload = payload || {};
    var cls = payload.class === "structure" ? "structure" : "content";
    if (!resourceId) return { reply: envelope("lock.denied", docId, resourceId, { reason: "no resource" }) };
    if (!canEdit(client)) return { reply: envelope("lock.denied", docId, resourceId, { reason: "role may not edit", role: roleOf(client) }) };
    var table = ns(docId, cls), existing = table[resourceId];
    if (existing && existing.holder !== client) {
      return { reply: envelope("lock.denied", docId, resourceId, { holder: existing.author, class: cls }) };
    }
    table[resourceId] = { holder: client, author: client && client.author, acquiredAt: existing ? existing.acquiredAt : now(), lastSeen: now(), class: cls };
    return {
      reply: envelope("lock.granted", docId, resourceId, { holder: client && client.author, class: cls }),
      broadcast: envelope("lock.state", docId, null, { locks: stateFor(docId) })
    };
  }

  // Release a lock the client holds. blur / idle / save / explicit. No-op if not held by it.
  function release(client, docId, resourceId, cls) {
    cls = cls === "structure" ? "structure" : "content";
    var table = ns(docId, cls), e = table[resourceId];
    if (e && e.holder === client) {
      delete table[resourceId];
      return {
        reply: envelope("lock.released", docId, resourceId, { class: cls }),
        broadcast: envelope("lock.state", docId, null, { locks: stateFor(docId) })
      };
    }
    return { reply: envelope("lock.released", docId, resourceId, { class: cls, noop: true }) };
  }

  // Heartbeat: refresh a held lock's lease so the reaper (ticket 12) doesn't reclaim it.
  function heartbeat(client, docId, resourceId, cls) {
    var e = ns(docId, cls === "structure" ? "structure" : "content")[resourceId];
    if (e && e.holder === client) { e.lastSeen = now(); return true; }
    return false;
  }

  // Release every lock a client holds (on disconnect). Returns the freed resource ids.
  function releaseAll(client) {
    var freed = [];
    Object.keys(registry).forEach(function (docId) {
      ["content", "structure"].forEach(function (cls) {
        var table = registry[docId][cls];
        Object.keys(table).forEach(function (rid) { if (table[rid].holder === client) { delete table[rid]; freed.push({ docId: docId, resourceId: rid, class: cls }); } });
      });
    });
    return freed;
  }

  // Full registry for a doc (sent on sync.hello as lock.state). Holder is by author name.
  function stateFor(docId) {
    var d = docReg(docId), out = [];
    ["content", "structure"].forEach(function (cls) {
      Object.keys(d[cls]).forEach(function (rid) { var e = d[cls][rid]; out.push({ resourceId: rid, class: cls, holder: e.author, acquiredAt: e.acquiredAt, lastSeen: e.lastSeen }); });
    });
    return out;
  }

  // Inspection seam for the reaper (ticket 12): every lock with its lease timestamps.
  function allLocks() {
    var out = [];
    Object.keys(registry).forEach(function (docId) {
      ["content", "structure"].forEach(function (cls) {
        var table = registry[docId][cls];
        Object.keys(table).forEach(function (rid) { var e = table[rid]; out.push({ docId: docId, resourceId: rid, class: cls, holder: e.holder, author: e.author, acquiredAt: e.acquiredAt, lastSeen: e.lastSeen }); });
      });
    });
    return out;
  }

  return {
    holder: holder, acquire: acquire, release: release, heartbeat: heartbeat,
    releaseAll: releaseAll, stateFor: stateFor, allLocks: allLocks, canEdit: canEdit,
    _forceRelease: function (docId, resourceId, cls) { delete ns(docId, cls)[resourceId]; } // reaper hook
  };
}

module.exports = { createLockManager: createLockManager, EDIT_ROLES: EDIT_ROLES };
