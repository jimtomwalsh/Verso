/*
 * server/presence.js -- live presence table (platform-pivot 11/31, Collaboration).
 * SERVER-MODE ONLY; ephemeral (never seq-stamped, never logged). Tracks who is in a doc,
 * who is viewing vs editing which block, and each peer's cursor/selection. A heartbeat
 * refreshes a TTL'd entry; a missed-heartbeat window drops the peer. Who-holds-which-block
 * comes from the lock registry (ticket 10); this adds the "who is here / watching" layer.
 *
 * Author colours are DETERMINISTIC and MUST match editor.js `colourForName` (the
 * comment-review palette) so presence + comments agree on each author's colour (AC1).
 * The rendering (avatars, cursors, chrome) is client-side collab chrome (ticket 11/16);
 * this is the server-side state + broadcast. Solo/local mode shows no presence chrome
 * because the hub only broadcasts in server mode.
 *
 * Dependency-free. Never renders.
 */
"use strict";

// KEEP IN SYNC with editor.js colourForName / COMMENT_COLOURS (a drift guard test asserts
// the two produce identical colours for the same name).
var PALETTE = ["#f5a623", "#4d7cad", "#e0563f", "#2ea36b", "#9b59b6", "#e91e8c", "#0d99ff", "#d4a017"];
function authorColour(name) {
  var x = 0; name = name || "";
  for (var i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[x % PALETTE.length];
}

function createPresence(opts) {
  opts = opts || {};
  var now = opts.now || function () { return 0; };
  var ttlMs = opts.ttlMs != null ? opts.ttlMs : 30000; // ~2 missed heartbeats
  var table = {}; // docId -> array of entries { client, author, viewingBlockId, editingBlockId, cursor, lastSeen }

  function doc(docId) { return table[docId] || (table[docId] = []); }
  function find(docId, client) { var a = doc(docId); for (var i = 0; i < a.length; i++) if (a[i].client === client) return a[i]; return null; }

  // Record/refresh a peer's presence from a heartbeat. viewing vs editing is explicit.
  function heartbeat(client, docId, payload) {
    payload = payload || {};
    var e = find(docId, client);
    if (!e) { e = { client: client, author: client && client.author, cursor: null }; doc(docId).push(e); }
    e.author = client && client.author;
    e.viewingBlockId = payload.viewingBlockId != null ? payload.viewingBlockId : null;
    e.editingBlockId = payload.editingBlockId != null ? payload.editingBlockId : null;
    if (payload.cursor !== undefined) e.cursor = payload.cursor;
    e.lastSeen = now();
    return e;
  }
  // Record just a cursor/selection update (ephemeral).
  function cursor(client, docId, payload) {
    var e = find(docId, client) || heartbeat(client, docId, {});
    e.cursor = (payload && payload.selection) || (payload && payload.cursor) || null;
    e.lastSeen = now();
    return e;
  }

  // Active peers in a doc (lastSeen within TTL), each with its deterministic colour.
  function peersFor(docId) {
    var cut = now() - ttlMs;
    return doc(docId).filter(function (e) { return e.lastSeen > cut; }).map(function (e) {
      return { author: e.author, colour: authorColour(e.author), viewingBlockId: e.viewingBlockId, editingBlockId: e.editingBlockId, cursor: e.cursor };
    });
  }

  // Drop a peer (on disconnect). Returns the docIds it was present in.
  function drop(client) {
    var affected = [];
    Object.keys(table).forEach(function (docId) {
      var a = table[docId], i = a.findIndex(function (e) { return e.client === client; });
      if (i >= 0) { a.splice(i, 1); affected.push(docId); }
    });
    return affected;
  }
  // Sweep expired peers (missed heartbeats). Returns the docIds that changed.
  function sweep() {
    var cut = now() - ttlMs, affected = [];
    Object.keys(table).forEach(function (docId) {
      var a = table[docId], before = a.length;
      table[docId] = a.filter(function (e) { return e.lastSeen > cut; });
      if (table[docId].length !== before) affected.push(docId);
    });
    return affected;
  }

  return { heartbeat: heartbeat, cursor: cursor, peersFor: peersFor, drop: drop, sweep: sweep, authorColour: authorColour, ttlMs: ttlMs };
}

module.exports = { createPresence: createPresence, authorColour: authorColour, PALETTE: PALETTE };
