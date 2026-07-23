// migration.js — clobber-proof browser -> file store cutover core (#69).
//
// This is the safety-critical piece the 2026-07-12 incident demands. The incident:
// a LIVE `authoring.storageBackend` flip let the reload's `pagehide` flush write the
// in-memory (demo-only) registry to the *new* backend, clobbering real courses. See
// the native-storage migration notes and docs/adr/0001-...
//
// Two responsibilities, both here so the coordination lives in one place:
//   1. SAVE SUPPRESSION — a guard editor.js's save choke points honour, so that
//      across the migrate+flip+reload window NO save can land (kills the pagehide/
//      beforeunload/autosave/scheduleSave flush that caused the clobber).
//   2. MIGRATE-THEN-FLIP — a PURE (DOM-free) orchestration that reads the browser
//      registry (authoritative), gates on a verified backup, suppresses saves, writes
//      the target file store, VERIFIES the read-back, and only THEN tells the caller
//      it is safe to flip the flag + reload. On ANY failure the browser store is left
//      authoritative and saves resume (rollback = do nothing but flip the flag back).
//
// The core takes injected store objects + hooks so tests/run.js can exercise it with
// fakes: seed a fake browser registry, run migrate into a fake file store, assert
// counts + refs, assert a re-run is a no-op, and assert a forced mid-way failure
// leaves the browser store authoritative (no flip). NOTHING here reads the real
// localStorage or flips any flag — the live wiring (a guarded menu action) is a
// separate, supervised step per HANDOFF section 7 and is intentionally not built yet.
(function () {
  "use strict";

  // ---- 1. Save-suppression guard -------------------------------------------
  // editor.js checks window.Migration.savesSuppressed() at the TOP of saveRegistry,
  // scheduleSave and flushSave. While true, every durable-write path is a no-op, so
  // a stale in-memory registry can never be flushed across a backend switch.
  var _suppressed = false;
  function savesSuppressed() { return _suppressed; }
  function suppress() { _suppressed = true; }
  function resume() { _suppressed = false; }

  // ---- 2a. Verify (pure) ----------------------------------------------------
  // The read-back gate: what we wrote to the file store must come back with the
  // SAME set of course codes and the same count, and every doc must be present.
  // Catches a truncated / partial / corrupt write before the file store is ever
  // made authoritative. Registry-only (phase-1a); asset-ref resolution is added
  // with phase-1b assets-on-disk.
  function verifyRegistries(writtenJson, readBackJson) {
    if (!readBackJson) return { ok: false, reason: "file store read back empty" };
    var a, b;
    try { a = JSON.parse(writtenJson); } catch (e) { return { ok: false, reason: "source unparseable" }; }
    try { b = JSON.parse(readBackJson); } catch (e) { return { ok: false, reason: "read-back unparseable" }; }
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return { ok: false, reason: "course count mismatch: wrote " + ka.length + ", read " + kb.length };
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return { ok: false, reason: "course code mismatch: " + ka[i] + " vs " + kb[i] };
      if (!b[ka[i]]) return { ok: false, reason: "missing course after read-back: " + ka[i] };
    }
    return { ok: true, count: ka.length };
  }

  // ---- 2b. Backup builder (the HARD gate) -----------------------------------
  // Before a single write to the target store, every course is written to a
  // `store/backups/pre-cutover-<ts>/` directory as a `.verso` (#64) and each is
  // VERIFIED written (re-check the on-disk size is non-trivial). This is blocking:
  // makeBackupFn returns a function matching run()'s opts.backup contract
  // (`(registryObj) -> {ok, count, dir?, error?}`) whose count MUST equal the course
  // count, else run() aborts before touching the target store.
  //
  // Pure + dependency-injected so tests exercise it with in-memory fakes and the live
  // path supplies the real VersoFormat + Swift-bridge file ops. `deps`:
  //   collectAssets(doc) -> { id: {dataUrl, mime} }   (the doc's asset:<id> media)
  //   versoFormat        -> window.VersoFormat        (buildPackage)
  //   writeFile(path, bytes) -> { ok, error? }         (durable write; bridge or fake)
  //   verifySize(path)   -> number                     (bytes on disk; 0/undefined = absent)
  //   tsLabel            -> string                     (caller-supplied; no Date in here)
  //   safeName(code)     -> string  (optional)         (filesystem-safe course code)
  // Normalise deps + build the ONE artifact per course, shared by the sync gate
  // (makeBackupFn, headless-tested) and the async live path (runBackupsAsync).
  function backupDeps(deps) {
    deps = deps || {};
    return {
      vf: deps.versoFormat,
      collect: deps.collectAssets || function () { return {}; },
      writeFile: deps.writeFile,
      verifySize: deps.verifySize || function () { return 1; },
      safeName: deps.safeName || function (c) { return String(c).replace(/[^\w.-]+/g, "_"); },
      dir: "backups/pre-cutover-" + (deps.tsLabel || "unknown") + "/"
    };
  }
  // Pure per-course: build the .verso bytes + target path (throws on any failure).
  function backupArtifact(code, doc, d) {
    var assets = d.collect(doc) || {};
    var bytes = d.vf.buildPackage(doc, assets, { code: code });
    if (!bytes || !bytes.length) throw new Error("empty backup for " + code);
    return { path: d.dir + d.safeName(code) + ".verso", bytes: bytes };
  }

  // SYNC backup gate (fakes/headless). Returns run()'s opts.backup contract.
  function makeBackupFn(rawDeps) {
    var d = backupDeps(rawDeps);
    return function backup(registryObj) {
      if (!d.vf || !d.vf.buildPackage) return { ok: false, count: 0, error: "VersoFormat not available for backup" };
      if (!d.writeFile) return { ok: false, count: 0, error: "no backup write sink" };
      var codes = Object.keys(registryObj || {}), written = 0;
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i], doc = registryObj[code];
        if (!doc) return { ok: false, count: written, error: "empty course in registry: " + code };
        var art;
        try { art = backupArtifact(code, doc, d); } catch (e) { return { ok: false, count: written, error: "backup build failed for " + code + ": " + (e && e.message || e) }; }
        var w;
        try { w = d.writeFile(art.path, art.bytes); } catch (e2) { return { ok: false, count: written, error: "backup write threw for " + code + ": " + (e2 && e2.message || e2) }; }
        if (!w || !w.ok) return { ok: false, count: written, error: "backup write failed for " + code + ": " + ((w && w.error) || "unknown") };
        var sz = 0; try { sz = d.verifySize(art.path); } catch (e3) { sz = 0; }
        if (!(sz > 0)) return { ok: false, count: written, error: "backup verify failed (not on disk) for " + code };
        written++;
      }
      return { ok: true, count: written, dir: d.dir };
    };
  }

  // ASYNC backup gate (LIVE path): same logic, but AWAITS the sinks so a WKWebView
  // bridge write/size (reply via __versoBackupReply) can be confirmed. `writeFile`
  // and `verifySize` may return a Promise or a plain value (await passes both). This
  // runs UP FRONT, before the sync run() suppress/flip window (HANDOFF section 5a #2).
  async function runBackupsAsync(registryObj, rawDeps) {
    var d = backupDeps(rawDeps);
    if (!d.vf || !d.vf.buildPackage) return { ok: false, count: 0, error: "VersoFormat not available for backup" };
    if (!d.writeFile) return { ok: false, count: 0, error: "no backup write sink" };
    var codes = Object.keys(registryObj || {}), written = 0;
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i], doc = registryObj[code];
      if (!doc) return { ok: false, count: written, error: "empty course in registry: " + code };
      var art;
      try { art = backupArtifact(code, doc, d); } catch (e) { return { ok: false, count: written, error: "backup build failed for " + code + ": " + (e && e.message || e) }; }
      var w;
      try { w = await d.writeFile(art.path, art.bytes); } catch (e2) { return { ok: false, count: written, error: "backup write threw for " + code + ": " + (e2 && e2.message || e2) }; }
      if (!w || !w.ok) return { ok: false, count: written, error: "backup write failed for " + code + ": " + ((w && w.error) || "unknown") };
      var sz = 0; try { sz = await d.verifySize(art.path); } catch (e3) { sz = 0; }
      if (!(sz > 0)) return { ok: false, count: written, error: "backup verify failed (not on disk) for " + code };
      written++;
    }
    return { ok: true, count: written, dir: d.dir };
  }

  // ---- 2c. Migrate-then-flip (pure orchestration) ---------------------------
  // Returns { ok, flip, stage, error?, codes? }. The caller flips the flag and
  // reloads ONLY when ok && flip. On any failure ok:false and flip:false — the
  // browser store was never mutated, so rollback is a no-op.
  //
  //   browser: { readRegistry() -> json|null }                (authoritative source)
  //   file:    { writeRegistry(json) -> {ok,error?}, readRegistry() -> json|null }
  //   opts:    { backup(registryObj) -> {ok,count,error?},     (the HARD backup gate)
  //             suppress(), resume(), log(msg) }               (default to the guard above)
  function run(browser, file, opts) {
    opts = opts || {};
    var log = opts.log || function () {};
    var doSuppress = opts.suppress || suppress;
    var doResume = opts.resume || resume;
    function fail(stage, error) { log("[migrate] FAIL at " + stage + ": " + error); return { ok: false, flip: false, stage: stage, error: error }; }

    // 1. READ browser registry — the authoritative source, never mutated here.
    var srcJson;
    try { srcJson = browser.readRegistry(); } catch (e) { return fail("read", "browser read threw: " + (e && e.message || e)); }
    if (!srcJson) return fail("read", "browser registry is empty");
    var src;
    try { src = JSON.parse(srcJson); } catch (e) { return fail("read", "browser registry unparseable"); }
    var codes = Object.keys(src);
    if (!codes.length) return fail("read", "no courses in browser registry");
    log("[migrate] source has " + codes.length + " course(s): " + codes.join(", "));

    // 2. BACKUP GATE — full verified backup of every course BEFORE any target write
    //    or browser-store deletion. Blocking, not best-effort (HANDOFF section 3).
    if (opts.backup) {
      var bk;
      try { bk = opts.backup(src); } catch (e) { return fail("backup", "backup threw: " + (e && e.message || e)); }
      if (!bk || !bk.ok) return fail("backup", (bk && bk.error) || "backup failed");
      if (bk.count !== codes.length) return fail("backup", "backup incomplete: " + bk.count + "/" + codes.length + " courses");
      log("[migrate] backup verified: " + bk.count + " course(s)");
    }

    // 3. SUPPRESS SAVES — from here until the caller's reload, no flush can land.
    doSuppress();
    log("[migrate] saves suppressed");

    // 4. WRITE TARGET — push the CURRENT in-memory browser registry to the file store.
    var w;
    try { w = file.writeRegistry(srcJson); } catch (e) { doResume(); return fail("write", "file write threw: " + (e && e.message || e)); }
    if (!w || !w.ok) { doResume(); return fail("write", (w && w.error) || "file store write failed"); }

    // 5. VERIFY — read the file store back; abort (and resume browser saves) on any drift.
    var back;
    try { back = file.readRegistry(); } catch (e) { doResume(); return fail("verify", "file read-back threw: " + (e && e.message || e)); }
    var v = verifyRegistries(srcJson, back);
    if (!v.ok) { doResume(); return fail("verify", v.reason); }
    log("[migrate] verified " + v.count + " course(s) on file store");

    // 6. SUCCESS — caller flips authoring.storageBackend = "file" then reloads.
    //    Saves STAY suppressed through the flip+reload (fresh boot resets the guard),
    //    so no stale flush lands under the new backend. This is the incident fix.
    return { ok: true, flip: true, stage: "done", codes: codes };
  }

  window.Migration = {
    savesSuppressed: savesSuppressed,
    suppress: suppress,
    resume: resume,
    verifyRegistries: verifyRegistries,
    makeBackupFn: makeBackupFn,
    runBackupsAsync: runBackupsAsync,
    run: run
  };
})();
