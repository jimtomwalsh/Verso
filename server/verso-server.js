/*
 * server/verso-server.js -- the ONE server-of-one artifact (platform-pivot 02/31).
 *
 * Responsibilities are STRICTLY storage + transport (+ auth + presence/locking in
 * later phases). It NEVER renders: render() stays a pure client-side library in both
 * postures. This module serves the StorageBackend contract (registry / kv / media)
 * over HTTP against the SQLite/WAL store on local disk.
 *
 * ONE artifact, two postures -- the mode flag is the ONLY difference:
 *   - local  : bundled inside the desktop shell, binds 127.0.0.1 only, auth dormant.
 *   - server : same file on-prem (Windows Service behind IIS+ARR), binds host, auth
 *              hooks live (Phase 3 fills them; here they default-allow).
 *
 * Dependency-free: node: builtins only. No external network calls / CDN loads.
 * Secrets come from the config FILE (see index.js), never from code.
 */
"use strict";

var http = require("node:http");
var createStore = require("./store").createStore;
var createBlockStore = require("./block-store").createBlockStore;
var createSyncHub = require("./sync").createSyncHub;
var createSyncRoutes = require("./sync-wire").createSyncRoutes;
var createLockManager = require("./lock-manager").createLockManager;

var API = "/api/";
var MAX_BODY = 512 * 1024 * 1024; // 512MB hard guard (a large course with inline media)

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, cb) {
  var chunks = [], size = 0, tooBig = false;
  req.on("data", function (c) {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; try { req.destroy(); } catch (e) {} return; }
    chunks.push(c);
  });
  req.on("end", function () { cb(tooBig ? null : Buffer.concat(chunks)); });
  req.on("error", function () { cb(null); });
}
// Read a raw body, replying 413 on an over-size/read failure; else hand the buffer to cb.
function withBody(req, res, cb) {
  readBody(req, function (buf) {
    if (buf === null) return sendJson(res, 413, { ok: false, error: "body too large or read error" });
    cb(buf);
  });
}
// As withBody, but parse the body as JSON, replying 400 on malformed JSON.
function withJsonBody(req, res, cb) {
  withBody(req, res, function (buf) {
    var obj; try { obj = JSON.parse(buf.toString("utf8")); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad json" }); }
    cb(obj, buf);
  });
}

// Auth boundary (Phase 3 issue 02/08 fills this). In local mode and until identity
// lands, it default-ALLOWS. It exists now so every route already flows through one
// authorize() choke point -- SSO/JIT/break-glass attach here, not scattered.
function authorize(req, config) {
  if (config && config.mode === "server" && typeof config.authorize === "function") {
    return config.authorize(req); // injected by the identity phase; may return false
  }
  return true;
}

// Build the request handler around a store + config. Exported separately so tests can
// drive it without binding a socket. An optional blockStore (ticket 03) mounts the
// block-addressable /api/doc/* routes below the same API -- the boundary Phase-2 sync
// fans out from. When absent, only the ticket-02 blob routes are served.
function makeHandler(store, config, blockStore, sync) {
  config = config || {};
  return function handler(req, res) {
    var raw = req.url || "";
    var qi = raw.indexOf("?");
    var query = qi >= 0 ? raw.slice(qi + 1) : "";
    var url = qi >= 0 ? raw.slice(0, qi) : raw;
    var method = req.method || "GET";

    if (url === "/api/health") {
      return sendJson(res, 200, { ok: true, mode: config.mode || "local", service: "verso-server", renders: false });
    }
    if (url.indexOf(API) !== 0) {
      return sendJson(res, 404, { ok: false, error: "not an API route (this backend never serves the app or renders)" });
    }
    if (!authorize(req, config)) {
      return sendJson(res, 401, { ok: false, error: "unauthorized" });
    }

    var rest = url.slice(API.length); // e.g. "registry", "kv/authoring.activeDocId", "media/<id>"

    // --- registry (doc-of-record; blob-level v1) ---
    if (rest === "registry") {
      if (method === "GET") return sendJson(res, 200, { ok: true, registry: store.getRegistry() });
      if (method === "PUT") return withBody(req, res, function (buf) {
        store.setRegistry(buf.toString("utf8"));
        return sendJson(res, 200, { ok: true });
      });
      return sendJson(res, 405, { ok: false, error: "method not allowed" });
    }

    // --- key/value (doc-session keys: active doc, open docs) ---
    if (rest.indexOf("kv/") === 0) {
      var key = decodeURIComponent(rest.slice(3));
      if (!key) return sendJson(res, 400, { ok: false, error: "missing key" });
      if (method === "GET") return sendJson(res, 200, { ok: true, value: store.getKv(key) });
      if (method === "DELETE") { store.deleteKv(key); return sendJson(res, 200, { ok: true }); }
      if (method === "PUT") return withBody(req, res, function (buf) {
        store.setKv(key, buf.toString("utf8"));
        return sendJson(res, 200, { ok: true });
      });
      return sendJson(res, 405, { ok: false, error: "method not allowed" });
    }

    // --- media (heavy assets) ---
    if (rest === "media/sweep") {
      if (method !== "POST") return sendJson(res, 405, { ok: false, error: "method not allowed" });
      return readBody(req, function (buf) {
        var keep = [];
        try { var p = JSON.parse((buf || Buffer.from("{}")).toString("utf8")); keep = (p && p.keep) || []; } catch (e) {}
        return sendJson(res, 200, store.sweepMedia(keep));
      });
    }
    if (rest.indexOf("media/") === 0) {
      var id = decodeURIComponent(rest.slice(6));
      if (!id) return sendJson(res, 400, { ok: false, error: "missing media id" });
      if (method === "HEAD") { res.writeHead(store.hasMedia(id) ? 200 : 404); return res.end(); }
      if (method === "GET") {
        var m = store.getMedia(id);
        if (!m) return sendJson(res, 404, { ok: false, error: "no such media" });
        return sendJson(res, 200, { ok: true, data: m.data, mime: m.mime });
      }
      if (method === "PUT") return withBody(req, res, function (buf) {
        var data = buf.toString("utf8"), mime = null;
        // Accept either a raw data: URL body or a {data,mime} JSON envelope.
        if (data.charAt(0) === "{") { try { var p = JSON.parse(data); data = p.data; mime = p.mime || null; } catch (e) {} }
        store.putMedia(id, data, mime);
        return sendJson(res, 200, { ok: true });
      });
      return sendJson(res, 405, { ok: false, error: "method not allowed" });
    }

    // --- block-addressable doc routes (ticket 03; mounted only when a block store is
    //     wired). The change log crossing here IS the seq-stamped stream Phase 2 fans
    //     out; GET /changes?since=N is the reconnect-replay contract. ---
    if (rest.indexOf("doc/") === 0 && blockStore) {
      var tail = rest.slice(4); // "<id>" | "<id>/change" | "<id>/changes" | "<id>/import" | "<id>/snapshot"
      var slash = tail.indexOf("/");
      var docId = decodeURIComponent(slash >= 0 ? tail.slice(0, slash) : tail);
      var op = slash >= 0 ? tail.slice(slash + 1) : "";
      if (!docId) return sendJson(res, 400, { ok: false, error: "missing doc id" });
      if (op === "" && method === "GET") {
        var mat = blockStore.materializeDoc(docId);
        return mat ? sendJson(res, 200, { ok: true, doc: mat }) : sendJson(res, 404, { ok: false, error: "no such doc" });
      }
      if (op === "import" && method === "POST") return withJsonBody(req, res, function (body) {
        return sendJson(res, 200, { ok: true, result: blockStore.importDoc(docId, body.doc || body, body.author) });
      });
      if (op === "change" && method === "POST") return withJsonBody(req, res, function (body) {
        if (!body.blockId) return sendJson(res, 400, { ok: false, error: "missing blockId" });
        var ch = blockStore.applyChange(docId, body.blockId, body.patch, body.author);
        if (!ch.ok) return sendJson(res, 404, ch); // unknown block -> not silently dropped
        return sendJson(res, 200, { ok: true, change: ch });
      });
      if (op === "changes" && method === "GET") {
        var since = 0;
        (query.split("&")).forEach(function (kv) { var p = kv.split("="); if (p[0] === "since") since = parseInt(decodeURIComponent(p[1] || "0"), 10) || 0; });
        return sendJson(res, 200, { ok: true, since: since, changes: blockStore.changesSince(since, docId) });
      }
      if (op === "snapshot" && method === "POST") return readBody(req, function (buf) {
        var author = null; try { author = (JSON.parse((buf || Buffer.from("{}")).toString("utf8")) || {}).author; } catch (e) {}
        return sendJson(res, 200, { ok: true, snapshot: blockStore.takeSnapshot(docId, author) });
      });
      // --- checkpoints + rollback time-axis (ticket 04) ---
      if (op === "checkpoints" && method === "GET") {
        return sendJson(res, 200, { ok: true, checkpoints: blockStore.listCheckpoints(docId) });
      }
      if (op === "checkpoint" && method === "POST") return withJsonBody(req, res, function (body) {
        var cp = blockStore.createCheckpoint(docId, body.name, body.author);
        return cp.ok ? sendJson(res, 200, { ok: true, checkpoint: cp }) : sendJson(res, 400, cp);
      });
      if (op === "restore" && method === "POST") return withJsonBody(req, res, function (body) {
        var rr = blockStore.restoreCheckpoint(docId, body.checkpointId, body.author);
        return rr.ok ? sendJson(res, 200, { ok: true, restore: rr }) : sendJson(res, 404, rr);
      });
      // --- single-block history + revert-in-place (ticket 04) ---
      // "block/<blockId>/history" (GET) | "block/<blockId>/revert" (POST)
      if (op.indexOf("block/") === 0) {
        var bparts = op.slice(6).split("/");
        var blockId = decodeURIComponent(bparts[0] || "");
        var baction = bparts[1] || "";
        if (!blockId) return sendJson(res, 400, { ok: false, error: "missing block id" });
        if (baction === "history" && method === "GET") {
          return sendJson(res, 200, { ok: true, history: blockStore.blockHistory(docId, blockId) });
        }
        if (baction === "revert" && method === "POST") return withJsonBody(req, res, function (body) {
          var rv = blockStore.revertBlock(docId, blockId, body.toSeq, body.author);
          return rv.ok ? sendJson(res, 200, { ok: true, revert: rv }) : sendJson(res, 404, rv);
        });
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }
      return sendJson(res, 405, { ok: false, error: "method not allowed" });
    }

    // --- live-collaboration long-poll fallback (ticket 08; server mode only) ---
    // The wss:// pipe is handled on the http 'upgrade' event (see createServer). These
    // are the mandated long-poll endpoints for proxies/networks without WebSockets.
    if (url === "/sync/send" && method === "POST" && sync) return withJsonBody(req, res, function (body) {
      sync.handleSend(body.clientId, body.envelope, body.author, function (r) { return sendJson(res, r.ok ? 200 : 409, r); });
    });
    if (url === "/sync/poll" && method === "GET" && sync) {
      var clientId = "", author = null;
      (query.split("&")).forEach(function (kv) { var p = kv.split("="); if (p[0] === "clientId") clientId = decodeURIComponent(p[1] || ""); if (p[0] === "author") author = decodeURIComponent(p[1] || ""); });
      return sync.handlePoll(clientId, author, function (r) { return sendJson(res, 200, r); });
    }

    return sendJson(res, 404, { ok: false, error: "unknown API route" });
  };
}

// Create an http.Server. opts: { store? , blockStore? , dbPath? , config }. When a
// dbPath is given the block-addressable store (ticket 03) is opened on the SAME file,
// mounting the /api/doc/* routes below the API. Pass blockStore:null to opt out.
function createServer(opts) {
  opts = opts || {};
  var config = opts.config || { mode: "local" };
  var store = opts.store || createStore(opts.dbPath);
  var blockStore = opts.hasOwnProperty("blockStore")
    ? opts.blockStore
    : (opts.dbPath ? createBlockStore(opts.dbPath, {}) : null);
  // Live-collaboration hub (ticket 08). Created always, but DORMANT unless mode==="server":
  // the hub fans out nothing in local mode, and createSyncRoutes returns an inert object
  // with no 'upgrade' handler -- so the desktop app never grows a collaboration surface.
  // Locks (ticket 10) are authoritative only in server mode; in local mode there is one
  // user, so the hub auto-grants (no lockManager) -- the solo experience is unchanged.
  var lockManager = (blockStore && config.mode === "server") ? createLockManager({ now: opts.now }) : null;
  var hub = blockStore ? createSyncHub(blockStore, { mode: config.mode, now: opts.now, lockManager: lockManager }) : null;
  var sync = hub ? createSyncRoutes(hub, config) : null;
  var server = http.createServer(makeHandler(store, config, blockStore, sync));
  if (sync && !sync.dormant) server.on("upgrade", sync.upgrade); // wss:// only in server mode
  server.__store = store;
  server.__blockStore = blockStore;
  server.__hub = hub;
  server.__sync = sync;
  server.__config = config;
  return server;
}

// Start listening. In local mode bind loopback only; in server mode bind the
// configured host. The mode flag is the ONLY behavioural difference.
function startServer(config, cb) {
  var server = createServer({ dbPath: config.dbPath, config: config });
  var host = config.mode === "server" ? (config.host || "0.0.0.0") : "127.0.0.1";
  // Honour port 0 (ephemeral, used by tests) -- `|| 4790` would wrongly treat 0 as unset.
  var port = config.port != null ? config.port : 4790;
  server.listen(port, host, function () { if (cb) cb(server, host, port); });
  return server;
}

module.exports = { createServer: createServer, makeHandler: makeHandler, startServer: startServer };
