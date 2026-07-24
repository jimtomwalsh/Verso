/*
 * server/sync-wire.js -- the real wire transports for the collaboration hub
 * (platform-pivot 08/31). SERVER-MODE ONLY; never attached in local mode.
 *
 * Two interchangeable Transport impls behind the same interface the hub consumes
 * (send / onMessage / onDrop / close):
 *   - WsTransport       : a HAND-ROLLED wss:// connection (no Socket.IO, no ws dep) --
 *                         node:http 'upgrade' + the RFC6455 handshake + minimal frame
 *                         encode/decode. The primary pipe.
 *   - LongPollTransport : the MANDATED fallback -- GET /sync/poll (hangs until an event
 *                         or a timeout) + POST /sync/send. For proxies/networks that
 *                         won't carry WebSockets.
 *
 * [UNKNOWN -> Ops/deploy gate, carried from spec 08]: IIS+ARR must be configured to
 * proxy BOTH wss:// AND the long-poll endpoints (ARR WebSocket proxying is OFF by
 * default). Flagged here so it is not lost; resolved per-environment at ticket 30/31.
 *
 * Dependency-free: node:crypto (builtin) for the WS accept hash only. Never renders.
 */
"use strict";

var crypto = require("node:crypto");

var WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ---- WebSocket (hand-rolled, minimal text-frame subset) -------------------
function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}
// Encode a server->client text frame (unmasked, per RFC6455 server rule).
function wsEncodeText(str) {
  var payload = Buffer.from(str, "utf8");
  var len = payload.length, header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.from([0x81, 126, (len >> 8) & 255, len & 255]); }
  else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2); header.writeUInt32BE(len >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}
// Encode a control frame (pong=0xA) -- unmasked, small payload echoed back.
function wsEncodeControl(opcode, payload) {
  payload = payload || Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length & 0x7f]), payload]);
}
// Decode client->server frames from a buffer; returns { messages:[str], rest:Buffer,
// closed:bool, pings:[Buffer] }. Client frames are masked (RFC6455). Handles text(1) +
// close(8) + ping(9) [-> caller must pong]; pong(10) is ignored.
function wsDecode(buf) {
  var messages = [], pings = [], closed = false, off = 0;
  while (off + 2 <= buf.length) {
    var b0 = buf[off], b1 = buf[off + 1];
    var opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0, len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = buf.readUInt32BE(p) * 4294967296 + buf.readUInt32BE(p + 4); p += 8; }
    var maskKey = null;
    if (masked) { if (p + 4 > buf.length) break; maskKey = buf.slice(p, p + 4); p += 4; }
    if (p + len > buf.length) break; // incomplete frame -> wait for more
    var data = buf.slice(p, p + len);
    if (masked) { var un = Buffer.alloc(len); for (var i = 0; i < len; i++) un[i] = data[i] ^ maskKey[i & 3]; data = un; }
    if (opcode === 0x8) { closed = true; off = p + len; break; }
    else if (opcode === 0x1) messages.push(data.toString("utf8"));
    else if (opcode === 0x9) pings.push(data); // ping -> the transport replies with a pong
    off = p + len;
  }
  return { messages: messages, rest: buf.slice(off), closed: closed, pings: pings };
}

// Build a WsTransport around an upgraded socket. Emits parsed envelopes to onMessage.
function WsTransport(socket) {
  var onMsg = null, onDrop = null, buf = Buffer.alloc(0), open = true;
  socket.on("data", function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    var d = wsDecode(buf); buf = d.rest;
    d.pings.forEach(function (payload) { if (open) try { socket.write(wsEncodeControl(0xA, payload)); } catch (e) {} }); // pong keepalive
    d.messages.forEach(function (m) { var env; try { env = JSON.parse(m); } catch (e) { return; } if (onMsg) onMsg(env); });
    if (d.closed) drop();
  });
  socket.on("close", drop);
  socket.on("error", drop);
  function drop() { if (!open) return; open = false; if (onDrop) onDrop(); }
  return {
    kind: "ws",
    send: function (env) { if (open) try { socket.write(wsEncodeText(JSON.stringify(env))); } catch (e) {} },
    onMessage: function (cb) { onMsg = cb; },
    onDrop: function (cb) { onDrop = cb; },
    close: function () { try { socket.end(); } catch (e) {} drop(); }
  };
}

// ---- Long-poll fallback ----------------------------------------------------
// A LongPollTransport queues server->client envelopes; a hanging GET /sync/poll drains
// them (or returns empty after a timeout), and POST /sync/send feeds inbound envelopes.
function LongPollTransport() {
  var onMsg = null, onDrop = null, queue = [], waiter = null, open = true;
  return {
    kind: "longpoll",
    send: function (env) { if (!open) return; queue.push(env); if (waiter) { var w = waiter; waiter = null; w(drain()); } },
    onMessage: function (cb) { onMsg = cb; },
    onDrop: function (cb) { onDrop = cb; },
    close: function () { if (!open) return; open = false; if (onDrop) onDrop(); },
    // server plumbing:
    inbound: function (env) { if (onMsg) onMsg(env); },      // POST /sync/send
    poll: function (cb) { if (queue.length) return cb(drain()); waiter = cb; }, // GET /sync/poll
    _drain: drain
  };
  function drain() { var q = queue; queue = []; return q; }
}

// Build the wire routes for a hub. SERVER MODE ONLY -- in local mode this returns an
// inert object (dormant:true, no upgrade handler, no-op long-poll), so the whole
// collaboration layer stays dormant on the desktop app. verso-server calls upgrade() on
// its http 'upgrade' event and routes /sync/send + /sync/poll to handleSend/handlePoll.
// resolvePrincipal(req) -> { name/email, role } | null resolves the session cookie / guest
// token so a sync connection carries the RESOLVED identity, never a self-declared author.
// An unauthenticated connection is REJECTED -- the collab write path flows through the same
// identity boundary as the /api routes (no bypass).
function createSyncRoutes(hub, config, resolvePrincipal) {
  if (!config || config.mode !== "server") {
    return {
      dormant: true,
      upgrade: function (req, socket) { try { socket.destroy(); } catch (e) {} },
      handleSend: function (id, env, principal, cb) { cb({ ok: false, error: "sync dormant (local mode)" }); },
      handlePoll: function (id, principal, cb) { cb({ ok: true, events: [] }); }
    };
  }
  resolvePrincipal = resolvePrincipal || function () { return null; };
  var polls = {}; // clientId -> LongPollTransport
  function nameOf(p) { return (p && (p.name || p.email || p.principal)) || null; }
  function lpFor(clientId, principal) {
    return polls[clientId] || (polls[clientId] = (function () { var t = LongPollTransport(); hub.connect(t, nameOf(principal), principal && principal.role); return t; })());
  }
  return {
    dormant: false,
    // wss:// upgrade handshake -> a WsTransport joined to the hub, ONLY for a resolved
    // principal (session cookie / guest token). Anonymous upgrades are dropped.
    upgrade: function (req, socket) {
      var key = req.headers["sec-websocket-key"];
      var principal = resolvePrincipal(req);
      if (!key || !principal || (req.url || "").indexOf("/sync") !== 0) { try { socket.destroy(); } catch (e) {} return; }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
      );
      hub.connect(WsTransport(socket), nameOf(principal), principal.role);
    },
    // principal is resolved by verso-server (from the same boundary) and passed in; a null
    // principal is rejected before any envelope reaches the hub.
    handleSend: function (clientId, env, principal, cb) {
      if (!principal) return cb({ ok: false, error: "authentication required" });
      lpFor(clientId, principal).inbound(env); cb({ ok: true });
    },
    handlePoll: function (clientId, principal, cb) {
      if (!principal) return cb({ ok: false, error: "authentication required" });
      lpFor(clientId, principal).poll(function (events) { cb({ ok: true, events: events }); });
    }
  };
}

module.exports = {
  WsTransport: WsTransport, LongPollTransport: LongPollTransport, createSyncRoutes: createSyncRoutes,
  wsAccept: wsAccept, wsEncodeText: wsEncodeText, wsEncodeControl: wsEncodeControl, wsDecode: wsDecode
};
