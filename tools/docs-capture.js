/*
 * #27 Docs capture runner — reads a declarative SCENE and emits a deterministic still.
 *
 * A scene is DATA (JSON), not imperative JS: a header + an ordered step-list drawn from a
 * small vocabulary. The runner drives the REAL editor in Chromium via Puppeteer, in docs
 * capture mode (#26, deterministic clock/RNG/freeze), on the SYNTHETIC demo doc only
 * (window.SAMPLE_DOC — never the user's stored doc, never real course content: export-control),
 * and screenshots to docs/assets/ as a size-budgeted WebP. Re-running an unchanged scene
 * reproduces byte-identical output (capture mode freezes everything -> identical pixels ->
 * identical WebP), so a no-op scene makes a no-op commit. See ADR 0004.
 *
 * This slice ships STILLS only (Chrome-native WebP). Motion (shootMotion + a vendored
 * animated-WebP encoder) is #28; #30 adds `--stale`.
 *
 * Usage (from a scratch dir that has puppeteer, with the app served):
 *   cd "$CODE" && python3 -m http.server 8123 &
 *   NODE_PATH="$SCRATCH/node_modules" node tools/docs-capture.js docs/scenes/<scene>.json \
 *     [--url http://localhost:8123/index.html]
 *
 * The pure core (schema, budget, validateScene, resolveOut) is module.exports-ed with NO
 * puppeteer dependency, so tests/run.js can unit-test it headlessly; puppeteer is required
 * only when the file is run as a CLI.
 */
"use strict";
var fs = require("fs");
var path = require("path");

// ---- Pure core (no puppeteer; unit-tested in tests/run.js) -------------------------------

// Size budgets (ADR 0004): a still stays lean so the docs panel opens fast and the repo
// doesn't bloat. Motion (#28) gets its own larger budget.
var STILL_BUDGET = 200 * 1024; // ~200 KB
var MOTION_BUDGET = 500 * 1024; // ~500 KB (animated WebP, #28)

// The scene step vocabulary. goto/select/click resolve a CSS target and click it; hover
// hovers; type types text into a target; wait pauses; shoot screenshots a still WebP;
// shootMotion (#28) captures a sequence of frames -> one animated WebP + a poster still.
var STEP_VERBS = ["goto", "select", "hover", "click", "type", "wait", "shoot", "shootMotion",
  "highlight", "callout", "pointer", "clearAnnotations"];
var SCENE_KINDS = ["still", "motion"]; // motion arrived with #28

function isPlainObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

// Validate a scene object -> { ok, errors:[...] }. Pure: no IO, no puppeteer. This is the
// schema gate the runner (and tests) share, so a malformed scene fails loudly, not silently.
function validateScene(scene) {
  var errors = [];
  if (!isPlainObject(scene)) return { ok: false, errors: ["scene must be an object"] };
  if (!scene.id || typeof scene.id !== "string") errors.push("scene.id (string) is required");
  if (!Array.isArray(scene.covers) || scene.covers.length === 0) errors.push("scene.covers (non-empty array of src surfaces) is required");
  var kind = scene.kind || "still";
  if (SCENE_KINDS.indexOf(kind) === -1) errors.push("scene.kind must be one of " + SCENE_KINDS.join("/"));
  if (scene.viewport != null) {
    var vp = scene.viewport;
    if (!isPlainObject(vp) || !(vp.width > 0) || !(vp.height > 0)) errors.push("scene.viewport must be { width>0, height>0, dpr? }");
  }
  if (scene.theme != null && scene.theme !== "dark" && scene.theme !== "light") errors.push("scene.theme must be 'dark' or 'light'");
  if (!Array.isArray(scene.steps) || scene.steps.length === 0) { errors.push("scene.steps (non-empty array) is required"); return { ok: false, errors: errors }; }
  var stills = 0, motions = 0;
  scene.steps.forEach(function (st, i) {
    if (!isPlainObject(st) || typeof st.do !== "string") { errors.push("step[" + i + "] must be { do: <verb>, ... }"); return; }
    if (STEP_VERBS.indexOf(st.do) === -1) { errors.push("step[" + i + "] unknown verb '" + st.do + "' (expected " + STEP_VERBS.join("/") + ")"); return; }
    if (st.do === "wait" && !(st.ms >= 0)) errors.push("step[" + i + "] wait needs ms>=0");
    if ((st.do === "goto" || st.do === "select" || st.do === "hover" || st.do === "click") && !st.target) errors.push("step[" + i + "] " + st.do + " needs a target selector");
    if (st.do === "type" && (!st.target || typeof st.text !== "string")) errors.push("step[" + i + "] type needs target + text");
    // #29 annotation verbs (capture-only overlay): highlight/callout/pointer need a target;
    // callout needs a number; clearAnnotations takes nothing.
    if ((st.do === "highlight" || st.do === "pointer") && !st.target) errors.push("step[" + i + "] " + st.do + " needs a target selector");
    if (st.do === "callout" && (!st.target || !(st.n >= 0))) errors.push("step[" + i + "] callout needs target + n (number)");
    if (st.do === "shoot") { stills++; if (!st.out || !/\.webp$/.test(st.out)) errors.push("step[" + i + "] shoot needs out ending in .webp"); }
    if (st.do === "shootMotion") {
      motions++;
      if (!st.out || !/\.webp$/.test(st.out)) errors.push("step[" + i + "] shootMotion needs out ending in .webp");
      if (!st.poster || !/\.webp$/.test(st.poster)) errors.push("step[" + i + "] shootMotion needs a poster still ending in .webp (reduced-motion fallback)");
      if (!Array.isArray(st.frames) || st.frames.length < 2) errors.push("step[" + i + "] shootMotion needs frames[] (>=2)");
      else st.frames.forEach(function (fr, j) {
        if (!isPlainObject(fr) || !(fr.duration > 0)) errors.push("step[" + i + "] frame[" + j + "] needs duration>0 (ms)");
        if (fr.before != null && !Array.isArray(fr.before)) errors.push("step[" + i + "] frame[" + j + "] before must be an array of steps");
      });
    }
  });
  if (kind === "motion" && motions === 0) errors.push("a motion scene needs at least one shootMotion step");
  if (kind === "still" && motions > 0) errors.push("a still scene cannot contain shootMotion (set kind: 'motion')");
  if (stills === 0 && motions === 0) errors.push("scene needs at least one shoot or shootMotion step");
  return { ok: errors.length === 0, errors: errors };
}

// A scene's shoot outputs land in docs/assets/. resolveOut keeps them inside that dir
// (no path traversal) so a scene can never write elsewhere in the repo.
function resolveOut(assetsDir, out) {
  var base = path.basename(out); // strip any dir components
  return path.join(assetsDir, base);
}

// ---- #30 staleness coverage --------------------------------------------------------------
// A scene's `covers` lists the src surfaces it illustrates: FILE surfaces (a repo path, or
// path#anchor, e.g. "src/editor.js" / "editor.css") and/or human tags ("block-palette").
// File surfaces drive staleness — `--stale <changed-files>` lists which scenes a diff touches,
// so the same-session docs-alignment rule can be applied (re-run a touched scene). Hash-ratchet
// / CI auto-regeneration is deliberately deferred (ADR 0004): this is a procedural aid, not a gate.
function norm(p) { return String(p).replace(/^\.\//, "").replace(/^\/+/, ""); }
function coverFile(cover) { return norm(String(cover).split("#")[0]); }
function isFileSurface(cover) { var f = coverFile(cover); return /\.(js|css|html|json)$/.test(f) || f.indexOf("/") !== -1; }
function coverMatchesFile(cover, changed) {
  if (!isFileSurface(cover)) return false; // human tags never match a file path
  var cf = coverFile(cover), f = norm(changed);
  return cf === f || f.endsWith("/" + cf) || cf.endsWith("/" + f) || f.endsWith(cf) || cf.endsWith(f);
}
// scenes: [{ id, covers, _file? }], changedFiles: string[] -> [{ id, matched:[changedFile...] }]
function staleScenes(scenes, changedFiles) {
  var out = [];
  (scenes || []).forEach(function (sc) {
    var covers = (sc && sc.covers) || [];
    var matched = (changedFiles || []).filter(function (f) {
      return covers.some(function (c) { return coverMatchesFile(c, f); });
    });
    if (matched.length) out.push({ id: sc.id, file: sc._file, matched: matched });
  });
  return out;
}

module.exports = {
  STILL_BUDGET: STILL_BUDGET,
  MOTION_BUDGET: MOTION_BUDGET,
  STEP_VERBS: STEP_VERBS,
  SCENE_KINDS: SCENE_KINDS,
  validateScene: validateScene,
  resolveOut: resolveOut,
  staleScenes: staleScenes,
  coverMatchesFile: coverMatchesFile,
  isFileSurface: isFileSurface
};

// ---- CLI (puppeteer only loaded here) ----------------------------------------------------
if (require.main === module) {
  (async function main() {
    var args = process.argv.slice(2);
    var ROOT = path.resolve(__dirname, "..");
    var SCENES = path.join(ROOT, "docs", "scenes");
    var ASSETS = path.join(ROOT, "docs", "assets");

    // #30 --stale <changed-files...>: list which committed scenes a code change touches (so a
    // UI change to a covered surface can be re-captured in the same session). No puppeteer.
    var staleIdx = args.indexOf("--stale");
    if (staleIdx !== -1) {
      var changed = args.slice(staleIdx + 1).filter(function (a) { return !a.startsWith("--"); });
      if (!changed.length) { console.error("usage: node tools/docs-capture.js --stale <changed-file> [more...]"); process.exit(2); }
      var scenes = fs.readdirSync(SCENES).filter(function (f) { return /\.json$/.test(f); }).map(function (f) {
        var sc = JSON.parse(fs.readFileSync(path.join(SCENES, f), "utf8")); sc._file = "docs/scenes/" + f; return sc;
      });
      var stale = staleScenes(scenes, changed);
      if (!stale.length) { console.log("no scenes cover " + changed.join(", ") + " — nothing to re-capture."); process.exit(0); }
      console.log(stale.length + " scene(s) to re-run for [" + changed.join(", ") + "]:");
      stale.forEach(function (s) { console.log("  " + s.file + "  (covers: " + s.matched.join(", ") + ")\n    -> node tools/docs-capture.js " + s.file); });
      process.exit(0);
    }

    var scenePath = args.find(function (a) { return !a.startsWith("--"); });
    var urlIdx = args.indexOf("--url");
    var URL = urlIdx !== -1 ? args[urlIdx + 1] : "http://localhost:8123/index.html";
    if (!scenePath) { console.error("usage: node tools/docs-capture.js <scene.json> [--url <app>]  |  --stale <changed-files>"); process.exit(2); }

    var scene = JSON.parse(fs.readFileSync(path.resolve(scenePath), "utf8"));
    var v = validateScene(scene);
    if (!v.ok) { console.error("INVALID scene " + scenePath + ":\n  - " + v.errors.join("\n  - ")); process.exit(2); }
    fs.mkdirSync(ASSETS, { recursive: true });

    var puppeteer;
    try { puppeteer = require("puppeteer"); }
    catch (e) { console.error("puppeteer not found (cd $SCRATCH && npm i puppeteer; run with NODE_PATH=$SCRATCH/node_modules)"); process.exit(1); }
    var webpAnim = require("./webp-anim.js"); // #28 animated-WebP muxer (dependency-free)

    var vp = scene.viewport || { width: 1440, height: 900, dpr: 2 };
    var browser = await puppeteer.launch({ headless: true, protocolTimeout: 180000, args: ["--no-sandbox", "--force-color-profile=srgb", "--hide-scrollbars"] });
    var pg = await browser.newPage();
    await pg.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr || 2 });
    // Activate capture mode (#26) BEFORE any app script runs.
    await pg.evaluateOnNewDocument(function () { window.__captureMode = true; });
    pg.on("dialog", async function (d) { try { await d.dismiss(); } catch (e) {} });
    var pageErrors = [];
    pg.on("pageerror", function (e) { pageErrors.push(e.message); });

    await pg.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(1500); // initial boot

    // Start every capture from an IDENTICAL clean state: clear persisted UI prefs (outliner
    // collapse, panel folds, palette view, theme pref, ...) then reload. Without this, a
    // toggle driven inside one scene persists and flips the NEXT run's starting state, so an
    // unchanged scene would not reproduce byte-identically. (Course data lives in IndexedDB /
    // file storage, not these prefs; the demo doc is set in-memory below regardless.)
    await pg.evaluate(async function () {
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
      try {
        if (indexedDB.databases) {
          var dbs = await indexedDB.databases();
          await Promise.all(dbs.map(function (d) { return new Promise(function (r) { var q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = function () { r(); }; }); }));
        }
      } catch (e) {}
    });
    await pg.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2200); // re-boot + mount + fonts

    // Load the SYNTHETIC demo doc ONLY (export-control). Never touch the stored doc.
    var loaded = await pg.evaluate(function (themeName) {
      if (!window.SAMPLE_DOC || !window.Editor || !window.Editor.setDoc) return { ok: false, why: "no SAMPLE_DOC / Editor.setDoc" };
      var demo = JSON.parse(JSON.stringify(window.SAMPLE_DOC));
      window.Editor.setDoc(demo);
      return { ok: true, title: demo.meta && demo.meta.title };
    }, scene.theme || "dark");
    if (!loaded.ok) { console.error("scene load failed: " + loaded.why); await browser.close(); process.exit(1); }
    await settle(pg); // fonts + frames barrier so the post-setDoc paint is fully settled

    var dpr = vp.dpr || 2;
    var written = [];
    for (var i = 0; i < scene.steps.length; i++) {
      var st = scene.steps[i];
      if (["wait", "hover", "type", "goto", "select", "click", "highlight", "callout", "pointer", "clearAnnotations"].indexOf(st.do) !== -1) { await runInteractive(pg, st); continue; }

      if (st.do === "shoot") {
        await settle(pg);
        var clip = await resolveClip(pg, st.clip);
        var outPath = resolveOut(ASSETS, st.out);
        await pg.screenshot(shotOpts(clip, outPath));
        var bytes = fs.statSync(outPath).size;
        report(written, outPath, bytes, STILL_BUDGET, "still");
      }

      if (st.do === "shootMotion") {
        // Capture each frame: run its before-steps, settle, grab a WebP buffer. Motion under
        // capture mode comes from discrete STATE changes between frames (animations are
        // frozen), so each frame is itself deterministic -> the muxed WebP reproduces exactly.
        var buffers = [], durations = [], mclip = null;
        for (var fi = 0; fi < st.frames.length; fi++) {
          var fr = st.frames[fi];
          if (Array.isArray(fr.before)) { for (var bi = 0; bi < fr.before.length; bi++) await runInteractive(pg, fr.before[bi]); }
          await settle(pg);
          if (fi === 0) mclip = await resolveClip(pg, st.clip); // clip fixed by the first frame
          var buf = await pg.screenshot(shotOpts(mclip, null)); // no path -> returns a Buffer
          buffers.push(Buffer.from(buf));
          durations.push(fr.duration | 0);
        }
        // poster still = the first frame (reduced-motion fallback via the #25 {poster=} slot)
        var posterPath = resolveOut(ASSETS, st.poster);
        fs.writeFileSync(posterPath, buffers[0]);
        report(written, posterPath, fs.statSync(posterPath).size, STILL_BUDGET, "poster");
        // mux the frames into one animated WebP
        var w = mclip ? Math.round(mclip.width * dpr) : Math.round(vp.width * dpr);
        var hpx = mclip ? Math.round(mclip.height * dpr) : Math.round(vp.height * dpr);
        var anim = webpAnim.muxAnimatedWebP({ width: w, height: hpx, loopCount: st.loop || 0, frames: buffers.map(function (b, k) { return { webp: b, duration: durations[k] }; }) });
        var motionPath = resolveOut(ASSETS, st.out);
        fs.writeFileSync(motionPath, anim);
        report(written, motionPath, anim.length, MOTION_BUDGET, "motion(" + buffers.length + "f)");
      }
    }

    await browser.close();
    if (pageErrors.length) console.warn("page errors:\n  " + pageErrors.join("\n  "));
    var over = written.filter(function (w) { return w.overBudget; });
    if (!written.length) { console.error("scene produced no output"); process.exit(1); }
    console.log("scene '" + scene.id + "': " + written.length + " asset(s) written to docs/assets/");
    process.exit(over.length ? 1 : 0);

    // ---- CLI helpers ----
    function shotOpts(clip, outPath) {
      var o = { type: "webp", quality: 90, captureBeyondViewport: false, optimizeForSpeed: false };
      if (outPath) o.path = outPath;
      if (clip) o.clip = clip;
      return o;
    }
    async function resolveBox(pg, target) {
      try { return await pg.$eval(target, function (el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }); }
      catch (e) { return null; }
    }
    async function resolveClip(pg, spec) {
      if (spec && typeof spec === "object") return { x: spec.x, y: spec.y, width: spec.width, height: spec.height };
      if (spec) {
        try { return await pg.$eval(spec, function (el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }); }
        catch (e) { console.warn("clip miss (full-page): " + spec); }
      }
      return null;
    }
    function report(list, outPath, bytes, budget, label) {
      var over = bytes > budget;
      list.push({ out: outPath, bytes: bytes, overBudget: over });
      console.log((over ? "OVER-BUDGET " : "ok ") + path.relative(ROOT, outPath) + " " + (bytes / 1024).toFixed(1) + "KB [" + label + ", budget " + (budget / 1024) + "KB]");
    }
    async function runInteractive(pg, st) {
      if (st.do === "wait") { await sleep(st.ms || 0); return; }
      if (st.do === "hover") { try { await pg.hover(st.target); } catch (e) { console.warn("hover miss: " + st.target); } return; }
      if (st.do === "type") { try { await pg.type(st.target, st.text, { delay: 0 }); } catch (e) { console.warn("type miss: " + st.target); } return; }
      if (st.do === "goto" || st.do === "select" || st.do === "click") {
        try { await pg.click(st.target); } catch (e) { console.warn(st.do + " miss: " + st.target); }
        return;
      }
      // #29 annotation overlay verbs -> the capture-only CaptureMode.annotate API. The runner
      // resolves the target box (so scenes can use ::-p-text / nth selectors) and passes it in.
      if (st.do === "highlight" || st.do === "callout" || st.do === "pointer") {
        var abox = await resolveBox(pg, st.target);
        if (!abox) { console.warn(st.do + " miss: " + st.target); return; }
        await pg.evaluate(function (spec) { window.CaptureMode && window.CaptureMode.annotate(spec); },
          { type: st.do, box: abox, n: st.n, side: st.side || "tl", from: st.from || "left" });
        return;
      }
      if (st.do === "clearAnnotations") { await pg.evaluate(function () { window.CaptureMode && window.CaptureMode.clearAnnotations(); }); return; }
    }
  })();

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Deterministic settle barrier: freeze media (#26), wait for all web fonts to finish
  // loading, then wait two animation frames so the post-change paint has flushed. This
  // collapses the async-font/paint races that otherwise make two runs differ, so an
  // unchanged scene reproduces byte-identical pixels.
  async function settle(pg) {
    await pg.evaluate(async function () {
      if (window.CaptureMode) window.CaptureMode.settle();
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
      // wait for every image to finish loading AND decoding — async image decode is the
      // main residual pixel-race after fonts, so this collapses runs to identical bytes.
      var imgs = Array.prototype.slice.call(document.images || []);
      await Promise.all(imgs.map(function (im) {
        if (im.complete) { return im.decode ? im.decode().catch(function () {}) : null; }
        return new Promise(function (r) { im.addEventListener("load", r, { once: true }); im.addEventListener("error", r, { once: true }); });
      }));
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    });
    await sleep(200);
  }
}
