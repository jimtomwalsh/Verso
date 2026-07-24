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

  // Ticket 13: the UI join for a soft-conflict prompt -- "my buffered edits vs current",
  // never a silent drop. The reducer above records WHICH block conflicted (block.conflict /
  // a resnapshot landing on a buffered block); the unacked buffer holds MY content; server
  // state holds CURRENT. These PURE helpers join them so the (chrome) prompt can show both
  // sides. pendingFor -> my buffered entry for a block (or null); conflictView -> one row per
  // recorded conflict enriched with my buffered content + whether I still hold it.
  function pendingFor(buf, blockId) { for (var i = 0; i < buf.length; i++) if (buf[i].blockId === blockId) return buf[i]; return null; }
  function conflictView(state, buf) {
    buf = buf || [];
    return ((state && state.conflicts) || []).map(function (c) {
      var p = pendingFor(buf, c.blockId);
      return { blockId: c.blockId, baseSeq: c.baseSeq, serverSeq: c.serverSeq, mine: p ? p.content : null, hasMine: !!p };
    });
  }

  // Build the typed client->server envelopes (pure; the wire just serialises these). Mirror
  // of the server's envelope shape { type, docId, blockId, seq, author, ts, payload }.
  function mkEnvelope(type, docId, blockId, payload) {
    return { type: type, docId: docId, blockId: blockId != null ? blockId : null, seq: null, author: null, ts: 0, payload: payload || {} };
  }
  function helloMsg(docId, sinceSeq) { return mkEnvelope("sync.hello", docId, null, { sinceSeq: sinceSeq || 0 }); }
  function changeMsg(docId, blockId, content, baseSeq) { return mkEnvelope("block.change", docId, blockId, { patch: content, baseSeq: baseSeq }); }
  function lockMsg(acquire, docId, blockId) { return mkEnvelope(acquire ? "lock.acquire" : "lock.release", docId, blockId, {}); }
  function heartbeatMsg(docId, viewingBlockId, editingBlockId) { return mkEnvelope("presence.heartbeat", docId, null, { viewingBlockId: viewingBlockId || null, editingBlockId: editingBlockId || null }); }
  function commentMsg(docId, blockId, body, threadId) { return mkEnvelope("comment.add", docId, blockId, { body: body, threadId: threadId }); }
  // Ticket 13: the human path out of a stuck lock (the server relays both over the presence
  // channel). requestHandoff nudges the current holder; notifyWhenFree fires on release.
  function handoffMsg(docId, blockId) { return mkEnvelope("lock.requestHandoff", docId, blockId, {}); }
  function notifyMsg(docId, blockId, on) { return mkEnvelope("lock.notifyWhenFree", docId, blockId, { on: on !== false }); }
  // Ticket 11 AC2: the local caret/selection within a block, so peers see a live cursor. Ephemeral
  // (not seq-stamped, not logged) -- carries a character offset into the block's text.
  function cursorMsg(docId, blockId, selection) { return mkEnvelope("cursor.update", docId, blockId, { selection: selection || null }); }
  /* @sync-client-end */

  // ---- thin WIRE (browser only; inert without a server URL) ----------------
  // A WebSocket client with a long-poll fallback behind one send/onMessage interface. The
  // pure core above is where behaviour lives; this just moves bytes. Browser-verified.
  function WsClient(base, onMessage, onOpen, onClose) {
    var ws = new WebSocket(base.replace(/^http/, "ws") + "/sync");
    ws.onopen = function () { if (onOpen) onOpen(); };
    ws.onclose = function () { if (onClose) onClose(); };
    ws.onmessage = function (e) { var env; try { env = JSON.parse(e.data); } catch (x) { return; } if (onMessage) onMessage(env); };
    return { kind: "ws", send: function (env) { try { ws.send(JSON.stringify(env)); } catch (e) {} }, close: function () { try { ws.close(); } catch (e) {} } };
  }
  // Long-poll fallback: POST /sync/send, and a self-rescheduling GET /sync/poll loop.
  function LongPollClient(base, clientId, onMessage, onOpen) {
    var open = true;
    function loop() {
      if (!open) return;
      fetch(base + "/sync/poll?clientId=" + encodeURIComponent(clientId), { credentials: "include" })
        .then(function (r) { return r.json(); })
        .then(function (j) { (j.events || []).forEach(function (env) { if (onMessage) onMessage(env); }); if (open) loop(); })
        .catch(function () { if (open) setTimeout(loop, 1000); });
    }
    if (onOpen) onOpen();
    loop();
    return {
      kind: "longpoll",
      send: function (env) { fetch(base + "/sync/send", { method: "POST", credentials: "include", body: JSON.stringify({ clientId: clientId, envelope: env }) }); },
      close: function () { open = false; }
    };
  }

  // ---- durable unacked buffer (ticket 13; browser-only IndexedDB) ----------
  // The in-memory `unacked` buffer survives a RECONNECT (replayed on open). This persists it
  // across a CRASH / laptop-sleep / tab-close too, so in-progress edits are NEVER lost -- they
  // rehydrate on the next connect and replay. Keyed by docId. INERT (every method resolves to a
  // no-op) when IndexedDB is unavailable (headless tests / private mode) so the client still runs.
  function DurableBuffer(dbName) {
    var HAS = (typeof indexedDB !== "undefined");
    function open() { return new Promise(function (res, rej) { var r = indexedDB.open(dbName, 1); r.onupgradeneeded = function () { r.result.createObjectStore("buf"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
    return {
      enabled: HAS,
      load: function (docId) { if (!HAS || !docId) return Promise.resolve([]); return open().then(function (db) { return new Promise(function (res) { var g = db.transaction("buf", "readonly").objectStore("buf").get(docId); g.onsuccess = function () { res(g.result || []); }; g.onerror = function () { res([]); }; }); }).catch(function () { return []; }); },
      save: function (docId, entries) { if (!HAS || !docId) return Promise.resolve(); return open().then(function (db) { return new Promise(function (res) { var tx = db.transaction("buf", "readwrite"); tx.objectStore("buf").put((entries || []).slice(), docId); tx.oncomplete = res; tx.onerror = res; }); }).catch(function () {}); }
    };
  }

  // The public facade. INERT unless a server URL is present -> window.VersoSync.enabled is
  // false in standalone and connect() is a no-op, so nothing in the editor activates.
  var state = { serverUrl: serverUrl(), connected: false, doc: null, seq: 0, locks: [], peers: [], conflicts: [] };
  var unacked = [];
  var transport = null, listeners = [];
  var durable = DurableBuffer("verso-sync-buffer");
  var hydrated = Promise.resolve();
  // persist the current buffer for the active doc (fire-and-forget; never blocks the edit path)
  function persistBuffer() { if (state.docId) durable.save(state.docId, unacked); }
  function emit(env) { state = applyServerEvent(state, env); if (env && env.type === "block.ack") { unacked = bufferAck(unacked, env.blockId); persistBuffer(); } listeners.forEach(function (cb) { try { cb(env, state); } catch (e) {} }); }

  window.VersoSync = {
    enabled: !!serverUrl(),
    isCollaborating: function () { return isCollaborating(state); },
    // The editor subscribes here to apply remote events onto the live doc + chrome.
    onEvent: function (cb) { listeners.push(cb); },
    // Open a live connection for a doc. WS primary, long-poll fallback. No-op in standalone.
    connect: function (docId, opts) {
      if (!serverUrl()) return null;
      opts = opts || {};
      var base = serverUrl();
      var clientId = "c_" + Math.random().toString(36).slice(2) + Date.now();
      state.docId = docId;
      // Rehydrate any edits durably buffered before a crash/sleep, coalesced into the in-memory
      // buffer, BEFORE the first replay -- so onOpen resends them even after a full restart.
      hydrated = durable.load(docId).then(function (entries) { (entries || []).forEach(function (e) { unacked = bufferAdd(unacked, e); }); });
      // Replay waits for hydration so a fast socket-open can't race past the persisted buffer.
      function onOpen() { state.connected = true; transport.send(helloMsg(docId, state.seq)); hydrated.then(function () { bufferReplay(unacked).forEach(function (e) { transport.send(changeMsg(docId, e.blockId, e.content, e.baseSeq)); }); }); }
      function onClose() { state.connected = false; }
      try { transport = WsClient(base, emit, onOpen, onClose); }
      catch (e) { transport = LongPollClient(base, clientId, emit, onOpen); } // WS unavailable -> fallback
      return {
        sendChange: function (blockId, content, baseSeq) { unacked = bufferAdd(unacked, { blockId: blockId, content: content, baseSeq: baseSeq }); persistBuffer(); transport.send(changeMsg(docId, blockId, content, baseSeq)); },
        acquireLock: function (blockId) { transport.send(lockMsg(true, docId, blockId)); },
        releaseLock: function (blockId) { transport.send(lockMsg(false, docId, blockId)); },
        heartbeat: function (viewing, editing) { transport.send(heartbeatMsg(docId, viewing, editing)); },
        comment: function (blockId, body, threadId) { transport.send(commentMsg(docId, blockId, body, threadId)); },
        requestHandoff: function (blockId) { transport.send(handoffMsg(docId, blockId)); },
        notifyWhenFree: function (blockId, on) { transport.send(notifyMsg(docId, blockId, on)); },
        cursorUpdate: function (blockId, selection) { transport.send(cursorMsg(docId, blockId, selection)); },
        disconnect: function () { if (transport) transport.close(); state.connected = false; }
      };
    },
    // exposed for the editor integration + tests
    _apply: function (env) { emit(env); return state; },
    _state: function () { return state; },
    _buffer: { add: function (e) { unacked = bufferAdd(unacked, e); persistBuffer(); }, ack: function (id) { unacked = bufferAck(unacked, id); persistBuffer(); }, replay: function () { return bufferReplay(unacked); }, pending: function () { return unacked.slice(); } },
    // the soft-conflict UI join (ticket 13): one row per recorded conflict, my buffered content
    // vs the block that advanced. Never a silent drop -- the reducer already recorded the block.
    conflictView: function () { return conflictView(state, unacked); },
    // the durable buffer (ticket 13): survives crash/sleep, rehydrated + replayed on reconnect.
    _durable: durable,
    // pure helpers (also used by tests)
    _pure: { isCollaborating: isCollaborating, applyServerEvent: applyServerEvent, replaceBlockById: replaceBlockById, bufferAdd: bufferAdd, bufferAck: bufferAck, bufferReplay: bufferReplay,
      pendingFor: pendingFor, conflictView: conflictView,
      helloMsg: helloMsg, changeMsg: changeMsg, lockMsg: lockMsg, heartbeatMsg: heartbeatMsg, commentMsg: commentMsg, handoffMsg: handoffMsg, notifyMsg: notifyMsg, cursorMsg: cursorMsg },
    _WsClient: WsClient, _LongPollClient: LongPollClient, _DurableBuffer: DurableBuffer
  };
})();
