/*
 * server/index.js -- entrypoint for the server-of-one backend (platform-pivot 02/31).
 *
 * Loads config from server/verso-server.config.json (gitignored) or the example,
 * overlays a few env vars, then starts the storage API. Secrets live in the config
 * FILE only -- never in code, never fetched from the network.
 *
 * Run local:   node server/index.js
 * Run server:  set mode:"server" (+ host/port/secrets) in the config file, then the
 *              same command runs behind IIS+ARR as a Windows Service (Ops phase).
 */
"use strict";

var fs = require("node:fs");
var path = require("node:path");
var startServer = require("./verso-server").startServer;

var HERE = __dirname;

function loadConfig() {
  var real = path.join(HERE, "verso-server.config.json");
  var example = path.join(HERE, "verso-server.config.example.json");
  var file = fs.existsSync(real) ? real : example;
  var config = {};
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("[verso-server] could not read config " + file + ":", e.message); }
  // Env overlay (deployment convenience; still no secrets in code).
  if (process.env.VERSO_MODE) config.mode = process.env.VERSO_MODE;
  if (process.env.VERSO_PORT) config.port = parseInt(process.env.VERSO_PORT, 10);
  if (process.env.VERSO_HOST) config.host = process.env.VERSO_HOST;
  if (process.env.VERSO_DATA_DIR) config.dataDir = process.env.VERSO_DATA_DIR;
  config.mode = config.mode || "local";
  config.port = config.port || 4790;
  config.dataDir = config.dataDir || path.join(HERE, "data");
  return config;
}

function resolveDbPath(config) {
  var dir = path.isAbsolute(config.dataDir) ? config.dataDir : path.join(HERE, config.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "verso.sqlite");
}

if (require.main === module) {
  var config = loadConfig();
  config.dbPath = resolveDbPath(config);
  startServer(config, function (server, host, port) {
    console.log("[verso-server] " + config.mode + " mode -> http://" + host + ":" + port +
      "  (store: " + config.dbPath + ", renders: false)");
  });
}

module.exports = { loadConfig: loadConfig, resolveDbPath: resolveDbPath };
