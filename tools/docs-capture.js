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

// The scene step vocabulary. goto/select/click resolve a CSS target and click it; hover
// hovers; type types text into a target; wait pauses; shoot screenshots to a WebP.
var STEP_VERBS = ["goto", "select", "hover", "click", "type", "wait", "shoot"];
var SCENE_KINDS = ["still"]; // "motion" arrives with #28

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
  var shoots = 0;
  scene.steps.forEach(function (st, i) {
    if (!isPlainObject(st) || typeof st.do !== "string") { errors.push("step[" + i + "] must be { do: <verb>, ... }"); return; }
    if (STEP_VERBS.indexOf(st.do) === -1) { errors.push("step[" + i + "] unknown verb '" + st.do + "' (expected " + STEP_VERBS.join("/") + ")"); return; }
    if (st.do === "wait" && !(st.ms >= 0)) errors.push("step[" + i + "] wait needs ms>=0");
    if ((st.do === "goto" || st.do === "select" || st.do === "hover" || st.do === "click") && !st.target) errors.push("step[" + i + "] " + st.do + " needs a target selector");
    if (st.do === "type" && (!st.target || typeof st.text !== "string")) errors.push("step[" + i + "] type needs target + text");
    if (st.do === "shoot") { shoots++; if (!st.out || !/\.webp$/.test(st.out)) errors.push("step[" + i + "] shoot needs out ending in .webp"); }
  });
  if (shoots === 0) errors.push("scene needs at least one shoot step");
  return { ok: errors.length === 0, errors: errors };
}

// A scene's shoot outputs land in docs/assets/. resolveOut keeps them inside that dir
// (no path traversal) so a scene can never write elsewhere in the repo.
function resolveOut(assetsDir, out) {
  var base = path.basename(out); // strip any dir components
  return path.join(assetsDir, base);
}

module.exports = {
  STILL_BUDGET: STILL_BUDGET,
  STEP_VERBS: STEP_VERBS,
  SCENE_KINDS: SCENE_KINDS,
  validateScene: validateScene,
  resolveOut: resolveOut
};

// ---- CLI (puppeteer only loaded here) ----------------------------------------------------
if (require.main === module) {
  (async function main() {
    var args = process.argv.slice(2);
    var scenePath = args.find(function (a) { return !a.startsWith("--"); });
    var urlIdx = args.indexOf("--url");
    var URL = urlIdx !== -1 ? args[urlIdx + 1] : "http://localhost:8123/index.html";
    if (!scenePath) { console.error("usage: node tools/docs-capture.js <scene.json> [--url <app>]"); process.exit(2); }

    var ROOT = path.resolve(__dirname, "..");
    var ASSETS = path.join(ROOT, "docs", "assets");
    var scene = JSON.parse(fs.readFileSync(path.resolve(scenePath), "utf8"));
    var v = validateScene(scene);
    if (!v.ok) { console.error("INVALID scene " + scenePath + ":\n  - " + v.errors.join("\n  - ")); process.exit(2); }
    fs.mkdirSync(ASSETS, { recursive: true });

    var puppeteer;
    try { puppeteer = require("puppeteer"); }
    catch (e) { console.error("puppeteer not found (cd $SCRATCH && npm i puppeteer; run with NODE_PATH=$SCRATCH/node_modules)"); process.exit(1); }

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
    await sleep(2200); // boot + mount + fonts

    // Load the SYNTHETIC demo doc ONLY (export-control). Never touch the stored doc.
    var loaded = await pg.evaluate(function (themeName) {
      if (!window.SAMPLE_DOC || !window.Editor || !window.Editor.setDoc) return { ok: false, why: "no SAMPLE_DOC / Editor.setDoc" };
      var demo = JSON.parse(JSON.stringify(window.SAMPLE_DOC));
      window.Editor.setDoc(demo);
      return { ok: true, title: demo.meta && demo.meta.title };
    }, scene.theme || "dark");
    if (!loaded.ok) { console.error("scene load failed: " + loaded.why); await browser.close(); process.exit(1); }
    await settle(pg); // fonts + frames barrier so the post-setDoc paint is fully settled

    var written = [];
    for (var i = 0; i < scene.steps.length; i++) {
      var st = scene.steps[i];
      if (st.do === "wait") { await sleep(st.ms || 0); continue; }
      if (st.do === "hover") { try { await pg.hover(st.target); } catch (e) { console.warn("hover miss: " + st.target); } continue; }
      if (st.do === "type") { try { await pg.type(st.target, st.text, { delay: 0 }); } catch (e) { console.warn("type miss: " + st.target); } continue; }
      if (st.do === "goto" || st.do === "select" || st.do === "click") {
        try { await pg.click(st.target); } catch (e) { console.warn(st.do + " miss: " + st.target); }
        continue;
      }
      if (st.do === "shoot") {
        await settle(pg);
        var outPath = resolveOut(ASSETS, st.out);
        var clip = null;
        if (st.clip && typeof st.clip === "object") {
          // explicit rect { x, y, width, height } — stable, layout-independent
          clip = { x: st.clip.x, y: st.clip.y, width: st.clip.width, height: st.clip.height };
        } else if (st.clip) {
          // CSS selector -> crop to that element's box (rounded to whole px for determinism)
          try { clip = await pg.$eval(st.clip, function (el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }); }
          catch (e) { console.warn("clip miss (full-page): " + st.clip); }
        }
        var shotOpts = { path: outPath, type: "webp", quality: 90, captureBeyondViewport: false, optimizeForSpeed: false };
        if (clip) shotOpts.clip = clip;
        await pg.screenshot(shotOpts);
        var bytes = fs.statSync(outPath).size;
        var overBudget = bytes > STILL_BUDGET;
        written.push({ out: outPath, bytes: bytes, overBudget: overBudget });
        console.log((overBudget ? "OVER-BUDGET " : "ok ") + path.relative(ROOT, outPath) + " " + (bytes / 1024).toFixed(1) + "KB (budget " + (STILL_BUDGET / 1024) + "KB)");
      }
    }

    await browser.close();
    if (pageErrors.length) console.warn("page errors:\n  " + pageErrors.join("\n  "));
    var over = written.filter(function (w) { return w.overBudget; });
    if (!written.length) { console.error("scene produced no output"); process.exit(1); }
    console.log("scene '" + scene.id + "': " + written.length + " still(s) written to docs/assets/");
    process.exit(over.length ? 1 : 0);
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
