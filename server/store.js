/*
 * server/store.js -- the SQLite/WAL storage layer for the server-of-one backend
 * (platform-pivot 02/31, Foundation). LOCAL DISK ONLY; the server process is the
 * SOLE writer (never SMB/NFS -- the runtime survey's silent-oplock-corruption trap).
 *
 * v1 is BLOB-LEVEL: the registry is one JSON blob under a reserved kv key, exactly
 * mirroring today's browser StorageBackend contract (registry + doc-session keys +
 * media). Ticket 03 replaces the registry blob with block-addressable rows + an
 * append-only change log UNDER this same seam -- callers above the store don't move.
 *
 * Dependency-free: uses node:sqlite (built into the bundled Node runtime -- the one
 * consciously-accepted runtime, NOT a third-party npm dep). No external network.
 */
"use strict";

var sqlite = require("node:sqlite");
var DatabaseSync = sqlite.DatabaseSync;

var REGISTRY_KEY = "authoring.registry";

// Create (or open) a store at an on-disk SQLite file. WAL journal so a crash
// mid-write never corrupts the db and readers never block the single writer.
function createStore(dbPath) {
  var db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;"); // WAL-safe durability without fsync-per-write
  db.exec(
    "CREATE TABLE IF NOT EXISTS kv (" +
    "  key   TEXT PRIMARY KEY," +
    "  value TEXT NOT NULL" +
    ");" +
    "CREATE TABLE IF NOT EXISTS media (" +
    "  id   TEXT PRIMARY KEY," +
    "  data TEXT NOT NULL," +
    "  mime TEXT" +
    ");"
  );

  var qGetKv    = db.prepare("SELECT value FROM kv WHERE key = ?");
  var qSetKv    = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  var qDelKv    = db.prepare("DELETE FROM kv WHERE key = ?");
  var qGetMedia = db.prepare("SELECT data, mime FROM media WHERE id = ?");
  var qHasMedia = db.prepare("SELECT 1 AS one FROM media WHERE id = ?");
  var qPutMedia = db.prepare("INSERT INTO media (id, data, mime) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, mime = excluded.mime");
  var qAllMedia = db.prepare("SELECT id FROM media");
  var qDelMedia = db.prepare("DELETE FROM media WHERE id = ?");

  return {
    // --- key/value (doc-session keys) ---
    getKv: function (key) { var r = qGetKv.get(key); return r ? r.value : null; },
    setKv: function (key, value) { qSetKv.run(key, String(value)); return { ok: true }; },
    deleteKv: function (key) { qDelKv.run(key); return { ok: true }; },
    // --- registry (doc-of-record; blob-level in v1) ---
    getRegistry: function () { return this.getKv(REGISTRY_KEY); },
    setRegistry: function (json) { return this.setKv(REGISTRY_KEY, json); },
    // --- media (heavy assets) ---
    getMedia: function (id) { var r = qGetMedia.get(id); return r ? { data: r.data, mime: r.mime } : null; },
    hasMedia: function (id) { return !!qHasMedia.get(id); },
    putMedia: function (id, data, mime) { qPutMedia.run(id, String(data), mime || null); return { ok: true }; },
    // Mark-sweep: keep only ids referenced by the live doc set (union across docs).
    sweepMedia: function (keepIds) {
      var keep = {}; (keepIds || []).forEach(function (id) { keep[id] = true; });
      var ids = qAllMedia.all().map(function (r) { return r.id; });
      var removed = 0;
      ids.forEach(function (id) { if (!keep[id]) { qDelMedia.run(id); removed++; } });
      return { ok: true, removed: removed };
    },
    close: function () { db.close(); },
    // test/inspection seam only
    _db: db,
    _registryKey: REGISTRY_KEY
  };
}

module.exports = { createStore: createStore, REGISTRY_KEY: REGISTRY_KEY };
