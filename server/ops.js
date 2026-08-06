/*
 * server/ops.js -- what IT needs to run this thing (platform-pivot 31, Ops).
 *
 * THREE THINGS, and one rule that governs all of them.
 *
 * THE RULE: NOTHING LEAVES THE BOX. No telemetry, no crash reporting, no update check, no
 * external log sink. This deployment is expected to sit on an air-gapped or tightly-egressed
 * network, and a monitoring feature that phones home is the one thing that would make Verso
 * un-deployable there. Structured logs go to a file the site's own collector can read; the
 * health endpoint is pulled, never pushed.
 *
 *   1. HEALTH -- one endpoint that answers "is this server actually alright", with enough
 *      substance to be worth alerting on. A health check that only proves the process is
 *      listening tells you nothing you did not already know from the port being open.
 *   2. A STRUCTURED LOG of the events an admin is ever asked about after the fact: errors,
 *      authentication events, and promotions. One JSON object per line, because that is what
 *      every collector on a Windows box can already read without a parser.
 *   3. ALERTS as thresholds evaluated here and reported in the health payload, rather than as
 *      a notification system. Verso does not know the site's paging setup and should not guess;
 *      it states the condition and lets the site's monitoring decide.
 *
 * Dependency-free: node: builtins only. Never renders.
 */
"use strict";

var fs = require("node:fs");
var path = require("node:path");

// ---- thresholds (pure) -----------------------------------------------------
// Defaults an IT admin can override in the config file. They are deliberately conservative:
// the point of an alert is that somebody acts on it, and a threshold that fires weekly is one
// people learn to ignore.
var DEFAULTS = {
  diskFreeWarnPct: 15,      // below this, the volume holding the store is getting tight
  diskFreeCritPct: 5,
  changeLogWarn: 500000,    // rows in the append log before a compaction is worth scheduling
  lockRegistryWarn: 200     // simultaneous held locks; far above a real team, so this means stuck
};

// Evaluate every threshold against a reading. PURE: reading in, conditions out, so the whole
// alert table is testable without a disk or a server. Returns the WORST level plus the list, so
// a monitoring system can alert on one field and a human can read the rest.
function evaluate(reading, cfg) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  var out = [];
  var r = reading || {};
  if (typeof r.diskFreePct === "number") {
    if (r.diskFreePct <= cfg.diskFreeCritPct) {
      out.push({ id: "disk", level: "critical", message: "The volume holding the Verso store is " + r.diskFreePct + "% free. Writes will start failing." });
    } else if (r.diskFreePct <= cfg.diskFreeWarnPct) {
      out.push({ id: "disk", level: "warning", message: "The volume holding the Verso store is " + r.diskFreePct + "% free." });
    }
  }
  if (typeof r.changeLogRows === "number" && r.changeLogRows >= cfg.changeLogWarn) {
    out.push({ id: "changeLog", level: "warning", message: "The change log holds " + r.changeLogRows + " rows. Schedule a compaction." });
  }
  if (typeof r.heldLocks === "number" && r.heldLocks >= cfg.lockRegistryWarn) {
    // Far above what a real team produces, so this reads as "locks are not being released"
    // rather than "the team is busy".
    out.push({ id: "locks", level: "warning", message: r.heldLocks + " block locks are held at once. Locks may not be releasing." });
  }
  var level = out.reduce(function (worst, a) {
    if (a.level === "critical") return "critical";
    return worst === "critical" ? worst : "warning";
  }, "ok");
  return { level: level, alerts: out };
}

// ---- the structured log ----------------------------------------------------
// One JSON object per line. A file, not a socket: a collector reads it, and nothing here opens
// an outbound connection. Failing to write a log line must never take the server down, so every
// path swallows -- an admin losing a log line is bad, an admin losing the server is worse.
function createLog(opts) {
  opts = opts || {};
  var file = opts.file || null;
  var now = opts.now || function () { return Date.now(); };
  var sink = opts.sink || null;   // tests inject this instead of a file
  var lines = [];                 // kept for the tail the health endpoint can expose

  function write(kind, event, detail) {
    var rec = { ts: new Date(now()).toISOString(), kind: kind, event: event };
    if (detail && typeof detail === "object") {
      Object.keys(detail).forEach(function (k) {
        // Never log a credential, a token or a session cookie. This file is read by people who
        // are not necessarily allowed to hold those, and a log is exactly where a secret goes
        // to be copied into a ticket.
        if (/password|secret|token|cookie|authorization/i.test(k)) return;
        rec[k] = detail[k];
      });
    }
    var line = JSON.stringify(rec);
    lines.push(line);
    if (lines.length > 200) lines.shift();
    try {
      if (sink) sink(line);
      else if (file) fs.appendFileSync(file, line + "\n");
    } catch (e) { /* a log write must never take the server down */ }
    return rec;
  }
  return {
    error: function (event, detail) { return write("error", event, detail); },
    auth: function (event, detail) { return write("auth", event, detail); },
    promotion: function (event, detail) { return write("promotion", event, detail); },
    tail: function (n) { return lines.slice(-(n || 20)); },
    _lines: function () { return lines.slice(); }
  };
}

// ---- readings --------------------------------------------------------------
// Free space on the volume holding the store. node:fs statfs is a builtin (Node 18.15+); a
// platform that does not answer reports null rather than a guess, and a null reading simply
// produces no disk alert -- an invented number is worse than a missing one.
function diskReading(dir) {
  try {
    if (!fs.statfsSync) return null;
    var s = fs.statfsSync(dir);
    var total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    if (!total) return null;
    return { diskFreeBytes: free, diskTotalBytes: total, diskFreePct: Math.round((free / total) * 100) };
  } catch (e) { return null; }
}
// The two store readings, each defensive: an ops endpoint must not be the thing that throws.
function storeReading(blockStore, lockManager) {
  var out = {};
  try { if (blockStore && blockStore.maxSeq) out.changeLogRows = blockStore.maxSeq(); } catch (e) {}
  try { if (lockManager && lockManager.allLocks) out.heldLocks = lockManager.allLocks().length; } catch (e) {}
  return out;
}

// The health payload. `deep` adds the readings and the alert evaluation; the shallow form stays
// cheap enough for a load balancer to poll every few seconds without touching the disk.
function health(deps, deep) {
  deps = deps || {};
  var base = {
    ok: true,
    service: "verso-server",
    mode: deps.mode || "local",
    renders: false,
    version: deps.version,
    schemaVersion: deps.schemaVersion
  };
  if (!deep) return base;
  var reading = Object.assign({}, diskReading(deps.dataDir || "."), storeReading(deps.blockStore, deps.lockManager));
  var ev = evaluate(reading, deps.thresholds);
  base.uptimeSec = typeof deps.uptimeSec === "number" ? deps.uptimeSec : undefined;
  base.reading = reading;
  base.level = ev.level;
  base.alerts = ev.alerts;
  // A critical condition makes the endpoint itself report not-ok, so a monitor that only looks
  // at ok/HTTP status still catches it. A warning does not: a server that is 12% free is
  // healthy and needs attention, and conflating those trains people to ignore the page.
  base.ok = ev.level !== "critical";
  return base;
}

module.exports = {
  DEFAULTS: DEFAULTS, evaluate: evaluate, createLog: createLog,
  diskReading: diskReading, storeReading: storeReading, health: health
};
