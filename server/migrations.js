/*
 * server/migrations.js -- forward-only master-store migration runner (platform-pivot
 * 27/31, Ops). A release is one versioned artifact; promoting it to prod runs its pending
 * migrations FORWARD only. Down-migrations are never authored: app rollback = redeploy the
 * previous artifact; data rollback (a bad migration) = restore the pre-migration backup
 * (ticket 28). The promotion sequence is stop -> backup -> forward-migrate -> start,
 * admin-only, in a maintenance window (an ops procedure; this is the migrate step's code).
 *
 * Dependency-free: node:sqlite only. Never renders.
 */
"use strict";

// The running artifact's version -- always identifiable (reported on /api/health).
var SERVER_VERSION = "0.1.0";
// The store's schema version target this artifact expects (bump when adding a migration).
var SCHEMA_VERSION = 1;

// migrations: [{ version, up(db) }] applied in ascending order, each exactly once.
function createMigrator(db, migrations) {
  migrations = (migrations || []).slice().sort(function (a, b) { return a.version - b.version; });
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);");
  if (!db.prepare("SELECT version FROM schema_version WHERE id = 1").get()) {
    db.prepare("INSERT INTO schema_version (id, version) VALUES (1, 0)").run();
  }
  var qGet = db.prepare("SELECT version FROM schema_version WHERE id = 1");
  var qSet = db.prepare("UPDATE schema_version SET version = ? WHERE id = 1");

  function currentVersion() { return qGet.get().version; }

  // Apply every pending FORWARD migration (version > current), in order, once. Idempotent:
  // re-running applies nothing. A migration that throws aborts the run (the caller restores
  // the pre-migration backup) -- state never advances past a failed step.
  function migrate() {
    var applied = [];
    for (var i = 0; i < migrations.length; i++) {
      var m = migrations[i];
      if (m.version <= currentVersion()) continue;
      m.up(db);               // throws -> abort; version not bumped -> restore backup
      qSet.run(m.version);
      applied.push(m.version);
    }
    return { ok: true, version: currentVersion(), applied: applied };
  }

  return { currentVersion: currentVersion, migrate: migrate };
}

module.exports = { createMigrator: createMigrator, SERVER_VERSION: SERVER_VERSION, SCHEMA_VERSION: SCHEMA_VERSION };
