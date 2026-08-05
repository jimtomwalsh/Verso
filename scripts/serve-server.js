#!/usr/bin/env node
/*
 * scripts/serve-server.js -- run Verso in SERVER MODE on this machine, for trying it out.
 *
 * WHY THIS EXISTS. The backend deliberately never serves the app (see server/verso-server.js:
 * "it NEVER renders"), so in a real deployment IIS+ARR sits in front, serves the static files
 * and proxies /api, /auth and /sync to Node. That means there was no way to open Verso in
 * server mode on a laptop without standing up IIS -- which made every server-mode surface
 * (first run, sign-in, the account menu, People, the cutover) unreachable in development.
 *
 * This is that missing piece, and nothing more: one origin, static files, three proxied route
 * prefixes, and the websocket upgrade piped through so live collaboration actually works.
 *
 * DEVELOPMENT ONLY. It binds loopback, it is not hardened, and it is not what you deploy --
 * server/install/RUNBOOK.md is. It is the companion to serve.command, which serves the same
 * files with no backend at all.
 *
 * Dependency-free: node: builtins only. No external network.
 */
"use strict";

var http = require("node:http");
var net = require("node:net");
var fs = require("node:fs");
var path = require("node:path");

var ROOT = path.resolve(__dirname, "..");
var APP_PORT = parseInt(process.env.VERSO_APP_PORT || "8123", 10);
var API_PORT = parseInt(process.env.VERSO_API_PORT || "8124", 10);
var DATA_DIR = process.env.VERSO_DATA_DIR || path.join(ROOT, "_server-data");
// The three prefixes IIS+ARR forwards in the real deployment. Everything else is a static file.
var PROXIED = /^\/(api|auth|sync)(\/|$|\?)/;

var MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".ico": "image/x-icon", ".map": "application/json"
};

function fail(msg) { console.error("\n  " + msg + "\n"); process.exit(1); }

// node:sqlite arrived in 22.5, and the store needs it. Say so here rather than letting the
// require throw something that reads like a Verso bug.
var major = parseInt(process.versions.node.split(".")[0], 10);
var minor = parseInt(process.versions.node.split(".")[1], 10);
if (major < 22 || (major === 22 && minor < 5)) {
  fail("Verso's server needs Node 22.5 or newer (node:sqlite). You have " + process.version + ".");
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// A port already in use is the likeliest way to run this wrongly, and the likeliest CAUSE is
// Verso.app -- which binds 8123 and reuses whatever is already there. Saying so beats an
// EADDRINUSE stack trace, because the fix is "quit the app", not "read node:net".
function portInUse(port, which) {
  fail("Port " + port + " (" + which + ") is already in use.\n" +
       "  If Verso.app is open, quit it first -- it binds 8123 and will otherwise talk to THIS\n" +
       "  server instead of its own, which makes it look signed out.\n" +
       "  Or pick other ports:  VERSO_APP_PORT=8300 VERSO_API_PORT=8301 ./serve-server.command");
}

var startServer = require(path.join(ROOT, "server/verso-server.js")).startServer;
var api = startServer({
  mode: "server",
  host: "127.0.0.1",
  port: API_PORT,
  dbPath: path.join(DATA_DIR, "verso.sqlite"),
  logFile: path.join(DATA_DIR, "verso-server.log"),
  // Local development is plain http, so the session cookie cannot carry Secure or the browser
  // will refuse to store it and every sign-in would silently do nothing. Never set this in a
  // real deployment -- see the RUNBOOK.
  insecureCookie: true,
  linkSecret: "dev-only-link-secret"
}, function () {
  startAppServer();
});
api.on("error", function (e) { if (e && e.code === "EADDRINUSE") portInUse(API_PORT, "backend"); throw e; });

function serveStatic(req, res, urlPath) {
  var rel = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  var file = path.join(ROOT, rel);
  // Stay inside the repo: a served path that escapes it is a bug even in a dev tool.
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}

function startAppServer() {
  var app = http.createServer(function (req, res) {
    var urlPath = String(req.url || "/").split("?")[0];
    if (!PROXIED.test(req.url || "")) return serveStatic(req, res, urlPath);
    var p = http.request({ host: "127.0.0.1", port: API_PORT, path: req.url, method: req.method, headers: req.headers }, function (r) {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    // The backend going away must not take this process with it -- an unhandled proxy error
    // is how a dev server dies mid-click with a stack trace nobody can act on.
    p.on("error", function (e) { try { res.writeHead(502, { "Content-Type": "text/plain" }); res.end("backend unreachable: " + e.message); } catch (_) {} });
    req.on("error", function () {});
    req.pipe(p);
  });

  // The websocket upgrade, piped raw. This is the half IIS+ARR most often gets wrong in a real
  // deployment (proxying only the long-poll leaves collaboration working but slow, with no error
  // to explain it), so it is worth having it genuinely work here.
  app.on("upgrade", function (req, socket, head) {
    if (!PROXIED.test(req.url || "")) { try { socket.destroy(); } catch (_) {} return; }
    var up = net.connect(API_PORT, "127.0.0.1", function () {
      up.write(req.method + " " + req.url + " HTTP/1.1\r\n" +
        Object.keys(req.headers).map(function (k) { return k + ": " + req.headers[k]; }).join("\r\n") + "\r\n\r\n");
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", function () { try { socket.destroy(); } catch (_) {} });
    socket.on("error", function () { try { up.destroy(); } catch (_) {} });
  });

  app.on("clientError", function (e, sock) { try { sock.destroy(); } catch (_) {} });
  app.on("error", function (e) { if (e && e.code === "EADDRINUSE") portInUse(APP_PORT, "app"); throw e; });
  app.listen(APP_PORT, "127.0.0.1", function () {
    var url = "http://localhost:" + APP_PORT + "/index.html";
    console.log("");
    console.log("  Verso is running in SERVER MODE (development only).");
    console.log("");
    console.log("    open      " + url);
    console.log("    data      " + DATA_DIR);
    console.log("    health    http://localhost:" + APP_PORT + "/api/health?deep=1");
    console.log("");
    console.log("  First visit lands on the setup wizard. It creates the local admin account,");
    console.log("  which is also the break-glass account you sign in with afterwards.");
    console.log("");
    console.log("  To start over, stop this (Ctrl-C), delete the data folder, and run it again.");
    console.log("  Ctrl-C to stop.");
    console.log("");
  });
  process.on("SIGINT", function () { try { api.close(); } catch (_) {} process.exit(0); });
}
