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
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

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

  // Same read-back gate as verifyRegistries, but for the shared component library (#18):
  // { components: { key: def } } instead of { courseCode: doc }. A library is optional (a
  // fresh install has none), so callers only run this when there was source JSON to migrate.
  function verifyLibrary(writtenJson, readBackJson) {
    if (!readBackJson) return { ok: false, reason: "file store read back empty" };
    var a, b;
    try { a = JSON.parse(writtenJson); } catch (e) { return { ok: false, reason: "source unparseable" }; }
    try { b = JSON.parse(readBackJson); } catch (e) { return { ok: false, reason: "read-back unparseable" }; }
    var ca = (a && a.components) || {}, cb = (b && b.components) || {};
    var ka = Object.keys(ca).sort(), kb = Object.keys(cb).sort();
    if (ka.length !== kb.length) return { ok: false, reason: "component count mismatch: wrote " + ka.length + ", read " + kb.length };
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return { ok: false, reason: "component key mismatch: " + ka[i] + " vs " + kb[i] };
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

  // ---- 3. browser -> SERVER cutover (platform-pivot 33) ---------------------
  //
  // James made this a condition of moving any real data: "I'm happy to move forward with
  // some of the cutover items provided we have backups of all of the files in flight or
  // make backups of files in flight." He also confirmed every install must be treated as
  // holding real work.
  //
  // The server side of that already exists -- server/backup.js takes transactionally
  // consistent snapshots on three triggers with a REHEARSED restore. The client side did
  // not exist at all: nothing anywhere exported an author's local work before a storage
  // flip.
  //
  // WHY THIS IS NOT run() WITH A DIFFERENT TARGET. Three things differ, and each one
  // matters:
  //
  //  1. THREE FACETS, not one. platform-pivot-32 put the library and products on the
  //     server too. A migration that carried only the registry would silently strand
  //     every source document and every Product on the author's machine -- the very hole
  //     32 closed, reopened at the moment of cutover.
  //  2. NO FILESYSTEM. run()'s backup writes .verso files through the desktop shell's
  //     Swift bridge. Server mode is a browser tab; there is no such sink. The archive
  //     goes to the author as a download AND to the server as a stashed copy, because a
  //     backup that exists only on the machine being migrated is not much of a backup.
  //  3. VERIFIABILITY, honestly bounded. A page CANNOT confirm that a downloaded file
  //     reached the disk -- no API reports that. So "verified" here means two things it
  //     genuinely can prove: the archive PARSES BACK to the same content it was built
  //     from, and the server's stashed copy READS BACK byte-identical. What it does not
  //     prove is stated rather than implied, so nobody reads more into a green run than
  //     is there.
  //
  // Everything below is pure and dependency-injected, like the rest of this file.

  // Build the pre-flight archive: the three facets verbatim, plus a manifest of what it
  // should contain, so verification compares against a written-down expectation rather
  // than against itself.
  function buildClientBackup(facets, meta) {
    var f = facets || {};
    function parse(json, fallback) {
      if (json == null) return fallback;
      try { return JSON.parse(json); } catch (e) { return fallback; }
    }
    var registry = parse(f.registry, {});
    var library = parse(f.library, { components: {} });
    var products = parse(f.products, {});
    return JSON.stringify({
      kind: "verso-preflight-backup",
      version: 1,
      createdLabel: (meta && meta.tsLabel) || "unknown",
      from: (meta && meta.from) || "browser",
      to: (meta && meta.to) || "http",
      manifest: {
        courses: Object.keys(registry).sort(),
        components: Object.keys((library && library.components) || {}).sort(),
        products: Object.keys(products).sort()
      },
      registry: registry,
      library: library,
      products: products
    });
  }

  // Re-read the archive and prove it carries everything it claims AND everything the
  // live stores actually held. Both directions on purpose: comparing an archive only
  // against its own manifest would pass an archive that was built from nothing.
  function verifyClientBackup(archiveJson, facets) {
    var a;
    try { a = JSON.parse(archiveJson); } catch (e) { return { ok: false, reason: "archive unparseable" }; }
    if (!a || a.kind !== "verso-preflight-backup") return { ok: false, reason: "not a pre-flight backup archive" };
    function parse(json, fallback) {
      if (json == null) return fallback;
      try { return JSON.parse(json); } catch (e) { return fallback; }
    }
    var f = facets || {};
    var want = {
      courses: Object.keys(parse(f.registry, {})).sort(),
      components: Object.keys((parse(f.library, { components: {} }).components) || {}).sort(),
      products: Object.keys(parse(f.products, {})).sort()
    };
    var got = {
      courses: Object.keys(a.registry || {}).sort(),
      components: Object.keys((a.library && a.library.components) || {}).sort(),
      products: Object.keys(a.products || {}).sort()
    };
    var kinds = ["courses", "components", "products"];
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i];
      if (want[k].join(" ") !== got[k].join(" ")) {
        return { ok: false, reason: k + " in the archive do not match what is on this machine (" + got[k].length + " archived, " + want[k].length + " live)" };
      }
      if ((a.manifest && a.manifest[k] || []).join(" ") !== got[k].join(" ")) {
        return { ok: false, reason: k + " do not match the archive's own manifest" };
      }
    }
    // A course present by name but empty is the failure this catches: the key survives,
    // the work does not.
    for (var j = 0; j < got.courses.length; j++) {
      var d = a.registry[got.courses[j]];
      if (!d || typeof d !== "object") return { ok: false, reason: "course archived empty: " + got.courses[j] };
    }
    return { ok: true, courses: got.courses.length, components: got.components.length, products: got.products.length };
  }

  // The staged cutover. Returns { ok, flip, stage, error?, counts? }. The caller flips
  // authoring.storageBackend through commitBackend -- the ONE writer -- and reloads, only
  // when ok && flip. On ANY failed stage the browser store has not been mutated and the
  // backend flag has not moved, so rollback is doing nothing.
  //
  //   browser: { readRegistry(), readLibrary(), readProducts() }        (authoritative)
  //   server:  { writeRegistry(json), writeLibrary(json), writeProducts(json),
  //              readRegistry(), readLibrary(), readProducts() }
  //   opts:    { deliver(name, json) -> {ok,error?}    hand the archive to the author
  //              stash(json) -> {ok,error?}            put a copy on the server
  //              readStash() -> json|null              read that copy back
  //              tsLabel, suppress(), resume(), log(msg), dryRun }
  //
  // dryRun performs every stage INCLUDING the server write and read-back verification,
  // then reports without asking the caller to flip. That is the rehearsal: it proves the
  // whole path against the real server before anything becomes irreversible.
  function runToServer(browser, server, opts) {
    opts = opts || {};
    var log = opts.log || function () {};
    var doSuppress = opts.suppress || suppress;
    var doResume = opts.resume || resume;
    function fail(stage, error) {
      log("[cutover] FAIL at " + stage + ": " + error);
      return { ok: false, flip: false, stage: stage, error: error };
    }

    // 1. READ all three facets. The registry may not be empty; the other two may.
    var facets = {};
    try {
      facets.registry = browser.readRegistry();
      facets.library = browser.readLibrary ? browser.readLibrary() : null;
      facets.products = browser.readProducts ? browser.readProducts() : null;
    } catch (e) { return fail("read", "reading local storage threw: " + (e && e.message || e)); }
    if (!facets.registry) return fail("read", "there is nothing on this machine to migrate");
    var reg;
    try { reg = JSON.parse(facets.registry); } catch (e) { return fail("read", "the local registry is unreadable; export a backup by hand before going further"); }
    if (!Object.keys(reg).length) return fail("read", "there are no courses on this machine to migrate");

    // 2. BACKUP — build, then prove it, BEFORE anything else happens.
    var archive;
    try { archive = buildClientBackup(facets, { tsLabel: opts.tsLabel, to: "http" }); }
    catch (e) { return fail("backup", "could not build the backup: " + (e && e.message || e)); }
    var v = verifyClientBackup(archive, facets);
    if (!v.ok) return fail("backup", v.reason);
    log("[cutover] backup built and checked: " + v.courses + " course(s), " + v.components + " component(s), " + v.products + " product(s)");

    // 3. DELIVER to the author. A page cannot confirm the file reached the disk, so this
    //    stage fails only on a sink that reports failure -- and the limit is logged
    //    rather than glossed.
    if (opts.deliver) {
      var name = "verso-preflight-backup-" + (opts.tsLabel || "unknown") + ".json";
      var d;
      try { d = opts.deliver(name, archive); } catch (e) { return fail("deliver", "could not hand you the backup file: " + (e && e.message || e)); }
      if (!d || !d.ok) return fail("deliver", (d && d.error) || "could not hand you the backup file");
      log("[cutover] backup delivered as " + name + " (a browser cannot confirm it reached your disk -- keep it somewhere safe)");
    }

    // 4. STASH a copy on the server and READ IT BACK. This is the half that IS provable
    //    end to end, and it is why the backup is not only a download.
    if (opts.stash) {
      var s;
      try { s = opts.stash(archive); } catch (e) { return fail("stash", "could not store a backup copy on the server: " + (e && e.message || e)); }
      if (!s || !s.ok) return fail("stash", (s && s.error) || "could not store a backup copy on the server");
      if (opts.readStash) {
        var back;
        try { back = opts.readStash(); } catch (e) { return fail("stash", "could not read the server's backup copy back: " + (e && e.message || e)); }
        if (back !== archive) return fail("stash", "the server's backup copy does not match what was sent");
        log("[cutover] backup copy stored on the server and read back identical");
      }
    }

    // 5. SUPPRESS SAVES. From here until the reload nothing can flush, which is the
    //    2026-07-12 clobber fix -- see the head of this file.
    doSuppress();
    log("[cutover] saves suppressed");

    // 6. WRITE every facet. A facet with nothing in it is skipped rather than written as
    //    "{}", so a fresh library never overwrites one already on the server.
    var wrote = {};
    var plan = [
      { key: "registry", json: facets.registry, write: "writeRegistry", read: "readRegistry" },
      { key: "library", json: facets.library, write: "writeLibrary", read: "readLibrary" },
      { key: "products", json: facets.products, write: "writeProducts", read: "readProducts" }
    ];
    for (var i = 0; i < plan.length; i++) {
      var p = plan[i];
      if (p.json == null) { log("[cutover] nothing local to migrate for " + p.key); continue; }
      var w;
      try { w = server[p.write](p.json); } catch (e) { doResume(); return fail("write", "writing " + p.key + " to the server threw: " + (e && e.message || e)); }
      if (!w || !w.ok) { doResume(); return fail("write", "writing " + p.key + " to the server failed: " + ((w && w.error) || "unknown")); }
      wrote[p.key] = true;
    }

    // 7. VERIFY every facet by reading it back off the server.
    for (var k = 0; k < plan.length; k++) {
      var q = plan[k];
      if (!wrote[q.key]) continue;
      var got;
      try { got = server[q.read](); } catch (e) { doResume(); return fail("verify", "reading " + q.key + " back threw: " + (e && e.message || e)); }
      var chk = (q.key === "library") ? verifyLibrary(q.json, got) : verifyFacet(q.json, got, q.key);
      if (!chk.ok) { doResume(); return fail("verify", q.key + ": " + chk.reason); }
      log("[cutover] verified " + q.key + " on the server");
    }

    // 8. A DRY RUN stops here, having proved the whole path, and resumes saves. Nothing
    //    is irreversible until the caller flips the flag.
    if (opts.dryRun) {
      doResume();
      log("[cutover] dry run complete -- nothing was switched over");
      return { ok: true, flip: false, stage: "dry-run", counts: v };
    }

    // 9. SUCCESS. Saves stay suppressed through the flip + reload; a fresh boot resets
    //    the guard, so no stale flush can land under the new backend.
    return { ok: true, flip: true, stage: "done", counts: v };
  }

  // The registry/products read-back gate: same set of top-level keys, none of them empty.
  // verifyRegistries above is registry-shaped by name; this is the same rule stated once
  // for any "{ id: object }" facet, so products get a real check rather than none.
  function verifyFacet(writtenJson, readBackJson, label) {
    if (!readBackJson) return { ok: false, reason: (label || "facet") + " read back empty from the server" };
    var a, b;
    try { a = JSON.parse(writtenJson); } catch (e) { return { ok: false, reason: "source unparseable" }; }
    try { b = JSON.parse(readBackJson); } catch (e) { return { ok: false, reason: "read-back unparseable" }; }
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return { ok: false, reason: "count mismatch: wrote " + ka.length + ", read " + kb.length };
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return { ok: false, reason: "key mismatch: " + ka[i] + " vs " + kb[i] };
      if (!b[ka[i]]) return { ok: false, reason: "missing after read-back: " + ka[i] };
    }
    return { ok: true, count: ka.length };
  }

  // ---- 3. The terminal drain of the legacy asset blob (platform-pivot 07) ----
  // Media used to persist as ONE base64 map under the localStorage key "authoring.assets".
  // That writer is gone: persist.js now keeps media in IndexedDB, and a doc whose media
  // cannot be hoisted there simply keeps its inline data: URLs, so the registry's own
  // quota reporting owns the failure instead of a second store failing on its own.
  //
  // A machine that last ran the old build still HAS that key, and its media is only there.
  // This drains it once -- read every record into the live store, then delete the key -- so
  // no author's images are stranded by the retirement. It is deliberately here rather than
  // in persist.js: the storage path itself must carry no legacy reader, and one-way
  // legacy migrations are what this module is for.
  //
  // PURE (every dependency injected) so tests/run.js exercises it with plain objects.
  // env = { read() -> raw json|null, remove(), has(id) -> bool, put(id, rec) }
  function drainLegacyAssetBlob(env) {
    env = env || {};
    var raw = null;
    try { raw = env.read ? env.read() : null; } catch (e) { return { ok: false, reason: "read failed", moved: 0, removed: false }; }
    if (!raw) return { ok: true, moved: 0, removed: false, reason: "nothing to drain" };
    var old;
    try { old = JSON.parse(raw) || {}; } catch (e) { return { ok: false, reason: "unparseable", moved: 0, removed: false }; }
    var moved = 0;
    var ids = Object.keys(old);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var already = false;
      try { already = !!(env.has && env.has(id)); } catch (e) { already = false; }
      if (already) continue;
      try { env.put(id, old[id]); moved++; }
      catch (e) { return { ok: false, reason: "put failed for " + id, moved: moved, removed: false }; }
    }
    // Only drop the source once every record it held is somewhere else.
    try { if (env.remove) env.remove(); } catch (e) { return { ok: true, moved: moved, removed: false, reason: "drained but could not remove the old key" }; }
    return { ok: true, moved: moved, removed: true, seen: ids.length };
  }

  window.Migration = {
    savesSuppressed: savesSuppressed,
    suppress: suppress,
    resume: resume,
    verifyRegistries: verifyRegistries,
    verifyLibrary: verifyLibrary,
    makeBackupFn: makeBackupFn,
    runBackupsAsync: runBackupsAsync,
    run: run,
    // platform-pivot 33 — browser -> server
    buildClientBackup: buildClientBackup,
    verifyClientBackup: verifyClientBackup,
    verifyFacet: verifyFacet,
    runToServer: runToServer,
    // platform-pivot 07 — the last reader of the retired localStorage asset blob
    LEGACY_ASSET_KEY: "authoring.assets",
    drainLegacyAssetBlob: drainLegacyAssetBlob
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
