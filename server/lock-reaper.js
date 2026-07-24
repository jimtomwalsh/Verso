/*
 * server/lock-reaper.js -- heartbeat-lease reaper (platform-pivot 12/31, Collaboration).
 * A vanished holder (crash / disconnect / sleep) must never permanently strand a block.
 * Each lock carries a heartbeat-refreshed lastSeen; the reaper reclaims any lock whose
 * lease has gone stale (older than a configurable grace window, ~2-3 missed beats) and
 * lets the server broadcast the freed state so peers can re-acquire.
 *
 * Reclaim rule (spec): acked changes are durable in the log (safe) and a reclaimed block
 * therefore starts from the last ACKED state -- a vanished client's UNACKED in-flight
 * edits were client-local and are gone (no half-merged fragments; block locks serialized
 * the writes, so no merge). A late stale change from the ex-holder is rejected by the
 * baseSeq guard in the hub (see sync.js onBlockChange). The EXACT grace window + the
 * takeover/handoff *feel* is the owed /verso-frontend prototype -- the window is
 * configurable here and defaults conservatively.
 *
 * Dependency-free. Never renders. Timer-based sweep is opt-in + unref'd so it never keeps
 * a process alive; sweep() is exposed directly so it is unit-testable with an injected clock.
 */
"use strict";

function createReaper(lockManager, opts) {
  opts = opts || {};
  var now = opts.now || function () { return 0; };
  // ~3 missed 15s heartbeats. Configurable (AC4); the felt takeover UX is the owed prototype.
  var graceMs = opts.graceMs != null ? opts.graceMs : 45000;
  var onReclaim = opts.onReclaim || function () {};

  // Reclaim every lock whose lease is older than the grace window. Returns the freed
  // locks; the caller broadcasts the new lock.state so peers can re-acquire.
  function sweep() {
    var reclaimed = [];
    lockManager.allLocks().forEach(function (l) {
      if (now() - l.lastSeen > graceMs) {
        lockManager._forceRelease(l.docId, l.resourceId, l.class);
        reclaimed.push({ docId: l.docId, resourceId: l.resourceId, class: l.class, author: l.author });
      }
    });
    if (reclaimed.length) { try { onReclaim(reclaimed); } catch (e) {} }
    return reclaimed;
  }

  var timer = null;
  return {
    sweep: sweep,
    graceMs: graceMs,
    start: function (intervalMs) {
      if (timer) return;
      timer = setInterval(sweep, intervalMs || 15000);
      if (timer.unref) timer.unref(); // never keep the process alive just to reap
    },
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
}

module.exports = { createReaper: createReaper };
