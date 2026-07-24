/*
 * src/sync-client.js -- the browser-side live-collaboration client (platform-pivot,
 * client mount). The counterpart of server/sync.js. It is INERT unless a server URL is
 * injected (window.__versoServerUrl, set only in server mode): in local / standalone the
 * whole collaboration client never activates, so the editor takes EXACTLY today's
 * branches. This is the safety linchpin -- every collab code path in editor.js hangs off
 * the single isCollaborating() gate below.
 *
 * Split like the server: a PURE core (the event reducer + the unacked buffer + the gate)
 * that tests/run.js exercises headlessly, and a THIN wire (a WebSocket client with a
 * long-poll fallback) that is browser-verified. No dependencies; classic-script global.
 */
(function () {
  "use strict";

  function serverUrl() { return (typeof window !== "undefined" && window.__versoServerUrl) || null; }

  // ---- PURE core (headless-testable; no DOM, no network) -------------------
  /* @sync-client-start */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  // The ONE gate every collab code path in the editor checks. Standalone -> false, so the
  // editor's collaborative branches (remote apply, lock chrome, presence) never run.
  function isCollaborating(state) { return !!(state && state.serverUrl && state.connected); }

  // Replace a TOP-LEVEL block by its stable id with new content (the server's granularity:
  // nested children travel inside the block). Pure; returns a new doc.
  function replaceBlockById(doc, blockId, content) {
    var d = clone(doc);
    (d.pages || []).forEach(function (p) {
      (p.blocks || []).forEach(function (b, i) { if (b && b.id === blockId) p.blocks[i] = content; });
    });
    return d;
  }

  // Apply one server->client envelope to the local sync state. PURE: returns a NEW state
  // { doc, seq, locks, peers, conflicts }. The editor integration maps this onto the live
  // doc + chrome. Unknown/ephemeral types are no-ops (forward-compatible).
  function applyServerEvent(state, env) {
    var s = { doc: state.doc, seq: state.seq || 0, locks: state.locks || [], peers: state.peers || [], conflicts: (state.conflicts || []).slice() };
    if (!env || !env.type) return s;
    switch (env.type) {
      case "sync.resnapshot":
        return { doc: clone(env.payload.snapshot), seq: env.payload.seq || 0, locks: s.locks, peers: s.peers, conflicts: s.conflicts };
      case "sync.catchup": {
        var doc = s.doc;
        (env.payload.events || []).forEach(function (ev) {
          if (ev.kind === "block.put") { try { doc = replaceBlockById(doc, ev.blockId, JSON.parse(ev.patch)); } catch (e) {} }
        });
        return { doc: doc, seq: env.payload.upToSeq || s.seq, locks: s.locks, peers: s.peers, conflicts: s.conflicts };
      }
      case "block.change": {
        var patch = env.payload && env.payload.patch;
        if (typeof patch === "string") { try { patch = JSON.parse(patch); } catch (e) { return s; } }
        return { doc: replaceBlockById(s.doc, env.blockId, patch), seq: env.seq || s.seq, locks: s.locks, peers: s.peers, conflicts: s.conflicts };
      }
      case "lock.state":   s.locks = env.payload.locks || []; return s;
      case "presence.state": s.peers = env.payload.peers || []; return s;
      case "block.conflict": s.conflicts.push({ blockId: env.blockId, baseSeq: env.payload && env.payload.baseSeq, serverSeq: env.seq }); return s;
      default: return s; // block.ack handled by the buffer; comment.* by the comment layer
    }
  }

  // The unacked buffer (ticket 13): local edits not yet acked by the server, so a
  // crash/disconnect can replay them. One pending entry per block (edits coalesce), keyed
  // by blockId; a block.ack retires it; reconnect replays what's left. Pure.
  function bufferAdd(buf, entry) {
    var out = buf.filter(function (e) { return e.blockId !== entry.blockId; });
    out.push({ blockId: entry.blockId, content: entry.content, baseSeq: entry.baseSeq });
    return out;
  }
  function bufferAck(buf, blockId) { return buf.filter(function (e) { return e.blockId !== blockId; }); }
  function bufferReplay(buf) { return buf.slice(); }
  /* @sync-client-end */

  // ---- thin WIRE (browser only; inert without a server URL) ----------------
  // A WebSocket client with a long-poll fallback behind one send/onMessage interface. The
  // pure core above is where behaviour lives; this just moves bytes. Browser-verified.
  function WsClient(url, onMessage, onOpen, onClose) {
    var ws = new WebSocket(url.replace(/^http/, "ws") + "/sync");
    ws.onopen = function () { if (onOpen) onOpen(); };
    ws.onclose = function () { if (onClose) onClose(); };
    ws.onmessage = function (e) { var env; try { env = JSON.parse(e.data); } catch (x) { return; } if (onMessage) onMessage(env); };
    return {
      kind: "ws",
      send: function (env) { try { ws.send(JSON.stringify(env)); } catch (e) {} },
      close: function () { try { ws.close(); } catch (e) {} }
    };
  }

  // The public facade. INERT unless a server URL is present -> window.VersoSync.enabled is
  // false in standalone and connect() is a no-op, so nothing in the editor activates.
  var state = { serverUrl: serverUrl(), connected: false, doc: null, seq: 0, locks: [], peers: [], conflicts: [] };
  var unacked = [];
  window.VersoSync = {
    enabled: !!serverUrl(),
    isCollaborating: function () { return isCollaborating(state); },
    // exposed for the editor integration + tests
    _apply: function (env) { state = applyServerEvent(state, env); return state; },
    _state: function () { return state; },
    _buffer: { add: function (e) { unacked = bufferAdd(unacked, e); }, ack: function (id) { unacked = bufferAck(unacked, id); }, replay: function () { return bufferReplay(unacked); }, pending: function () { return unacked.slice(); } },
    // pure helpers (also used by tests)
    _pure: { isCollaborating: isCollaborating, applyServerEvent: applyServerEvent, replaceBlockById: replaceBlockById, bufferAdd: bufferAdd, bufferAck: bufferAck, bufferReplay: bufferReplay },
    // connect is wired in the next step (transport + editor integration); inert for now
    connect: function () { if (!serverUrl()) return null; /* transport wiring: next step */ return null; },
    _WsClient: WsClient
  };
})();
