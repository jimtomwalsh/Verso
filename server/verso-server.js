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
// drive it without binding a socket.
function makeHandler(store, config) {
  config = config || {};
  return function handler(req, res) {
    var url = req.url || "";
    var qi = url.indexOf("?"); if (qi >= 0) url = url.slice(0, qi);
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
      if (method === "PUT") return readBody(req, function (buf) {
        if (buf === null) return sendJson(res, 413, { ok: false, error: "body too large or read error" });
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
      if (method === "PUT") return readBody(req, function (buf) {
        if (buf === null) return sendJson(res, 413, { ok: false, error: "body too large or read error" });
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
      if (method === "PUT") return readBody(req, function (buf) {
        if (buf === null) return sendJson(res, 413, { ok: false, error: "body too large or read error" });
        var data = buf.toString("utf8"), mime = null;
        // Accept either a raw data: URL body or a {data,mime} JSON envelope.
        if (data.charAt(0) === "{") { try { var p = JSON.parse(data); data = p.data; mime = p.mime || null; } catch (e) {} }
        store.putMedia(id, data, mime);
        return sendJson(res, 200, { ok: true });
      });
      return sendJson(res, 405, { ok: false, error: "method not allowed" });
    }

    return sendJson(res, 404, { ok: false, error: "unknown API route" });
  };
}

// Create an http.Server. opts: { store? , dbPath? , config }.
function createServer(opts) {
  opts = opts || {};
  var config = opts.config || { mode: "local" };
  var store = opts.store || createStore(opts.dbPath);
  var server = http.createServer(makeHandler(store, config));
  server.__store = store;
  server.__config = config;
  return server;
}

// Start listening. In local mode bind loopback only; in server mode bind the
// configured host. The mode flag is the ONLY behavioural difference.
function startServer(config, cb) {
  var server = createServer({ dbPath: config.dbPath, config: config });
  var host = config.mode === "server" ? (config.host || "0.0.0.0") : "127.0.0.1";
  var port = config.port || 4790;
  server.listen(port, host, function () { if (cb) cb(server, host, port); });
  return server;
}

module.exports = { createServer: createServer, makeHandler: makeHandler, startServer: startServer };
