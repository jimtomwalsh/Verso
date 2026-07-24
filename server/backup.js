/*
 * server/backup.js -- backup + restore subsystem (platform-pivot 28/31, Ops). The whole
 * SQLite store is ONE file (block rows + append-only change log + checkpoints + users +
 * review links + comments), so a backup is a CONSISTENT snapshot of that file taken with
 * SQLite's `VACUUM INTO` (a transactionally-consistent copy -- not a raw byte copy that
 * could catch a half-written WAL). Snapshots go to a SEPARATE on-prem volume on three
 * triggers: nightly, automatic pre-promotion, and admin on-demand. The append log covers
 * between-snapshot durability; snapshots are the disk-loss disaster-recovery floor.
 *
 * Restore drill: stop -> replace the store file with a snapshot -> start -> verify. The
 * verify (health green + tables present + integrity_check ok) is exercised as a test, not
 * just documented.
 *
 * Dependency-free: node:sqlite + node:fs/path builtins. On-prem only; never network.
 */
"use strict";

var fs = require("node:fs");
var path = require("node:path");
var DatabaseSync = require("node:sqlite").DatabaseSync;

// Take a consistent snapshot of the store at dbPath into backupDir. Returns the snapshot
// path. tsLabel is injected (the runtime has no Date in this codebase's test seam).
function snapshot(dbPath, backupDir, tsLabel) {
  fs.mkdirSync(backupDir, { recursive: true });
  var out = path.join(backupDir, "verso-" + (tsLabel || "snapshot") + ".sqlite");
  var db = new DatabaseSync(dbPath);
  try { db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'"); } finally { db.close(); }
  return out;
}

// List snapshots in a backup dir, newest-name first.
function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter(function (f) { return /^verso-.*\.sqlite$/.test(f); }).sort().reverse();
}

// Prune to the newest `keep` snapshots (configurable retention). Returns the removed names.
function prune(backupDir, keep) {
  var all = listBackups(backupDir), removed = [];
  all.slice(keep).forEach(function (f) { try { fs.rmSync(path.join(backupDir, f)); removed.push(f); } catch (e) {} });
  return removed;
}

// Restore: replace the store file with a snapshot (the stop/start around it is the ops
// sequence). Copies the snapshot over dbPath. Returns { ok }.
function restore(snapshotPath, dbPath) {
  if (!fs.existsSync(snapshotPath)) return { ok: false, error: "no such snapshot" };
  // clear any stale WAL/SHM sidecars so the restored file is authoritative
  [dbPath + "-wal", dbPath + "-shm"].forEach(function (p) { try { if (fs.existsSync(p)) fs.rmSync(p); } catch (e) {} });
  fs.copyFileSync(snapshotPath, dbPath);
  return { ok: true, restoredFrom: snapshotPath };
}

// Verify a restored store is internally consistent: opens, PRAGMA integrity_check passes,
// and the expected tables exist. Extra checks (health green + checkpoint integrity) are
// layered by the caller against the reopened block store.
function verifyStore(dbPath, expectTables) {
  var db = new DatabaseSync(dbPath);
  try {
    var integ = db.prepare("PRAGMA integrity_check").get();
    var okInteg = integ && (integ.integrity_check === "ok" || Object.values(integ)[0] === "ok");
    var names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(function (r) { return r.name; });
    var missing = (expectTables || []).filter(function (t) { return names.indexOf(t) < 0; });
    return { ok: !!okInteg && missing.length === 0, integrity: okInteg, tables: names, missing: missing };
  } finally { db.close(); }
}

module.exports = { snapshot: snapshot, listBackups: listBackups, prune: prune, restore: restore, verifyStore: verifyStore };
