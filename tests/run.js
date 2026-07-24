/*
 * tests/run.js -- headless regression suite (OO slice HHH).
 *
 * Run before every ship:   node tests/run.js
 *
 * No deps, no build, no npm -- plain node + fs (matches the app's constraints).
 * Each section extracts the relevant PURE core from src/*.js by string-slicing
 * (the app is one classic-script IIFE per file, so there is nothing to import)
 * and exercises it against fixtures. This is the same technique the ad-hoc
 * per-change smokes used; HHH just makes them permanent + aggregated so a
 * regression (e.g. the YY "images blank on canvas" one) is caught before ship.
 *
 * Sections: node --check on every src file, XX durable-write core, YY asset
 * seam (resolve/migrate/collect + store dedupe/url/sweep), assetSrc resolver
 * hook, QQQ quiz-export wiring, EEE pre-export validation.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");

var ROOT = path.join(__dirname, "..");
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

var total = 0, failed = 0, warnings = 0;
// Async assertions (awaited bridge/backup paths) register their promise here; the
// final report waits on all of them before exiting so nothing resolves post-exit.
var __async = [];
var sectionName = "";
function section(name) { sectionName = name; }
function ok(name, cond) {
  total++;
  if (!cond) { failed++; console.error("  FAIL [" + sectionName + "] " + name); }
}
// A non-failing signal (UI kit ticket 4 conformance gate, warn-only phase).
function warn(msg) { warnings++; console.warn("  WARN [" + sectionName + "] " + msg); }
function slice(txt, from, to) { var a = txt.indexOf(from), b = txt.indexOf(to, a + 1); return txt.slice(a, b); }

// ---- node --check on every src file --------------------------------------
section("syntax");
["src/render.js", "src/editor.js", "src/persist.js", "src/export.js",
 "src/csv.js", "src/schema.js", "src/theme.js", "src/model.js",
 "src/components.js", "src/runtime.js", "src/quiz-runtime.js",
 "src/ui-kit.js", "src/icons.js", "src/verso-format.js", "src/migration.js", "src/store-native.js",
 "src/store-http.js", "server/store.js", "server/verso-server.js", "server/index.js"
].forEach(function (f) {
  var r = cp.spawnSync(process.execPath, ["--check", path.join(ROOT, f)], { encoding: "utf8" });
  ok("node --check " + f, r.status === 0);
  if (r.status !== 0) console.error(r.stderr);
});

// ---- XX: durable-write core ----------------------------------------------
section("XX durable-write");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/\/\* @pure-start \*\/([\s\S]*?)\/\* @pure-end \*\//);
  if (!m) { ok("locate @pure fence", false); return; }
  var g = new Function(m[1] + "\nreturn { isQuotaExceeded: isQuotaExceeded, writeStore: writeStore };")();
  ok("QuotaExceededError name", g.isQuotaExceeded({ name: "QuotaExceededError" }) === true);
  ok("code 22", g.isQuotaExceeded({ code: 22 }) === true);
  ok("code 1014", g.isQuotaExceeded({ code: 1014 }) === true);
  ok("unrelated -> false", g.isQuotaExceeded({ name: "TypeError" }) === false);
  ok("null -> false", g.isQuotaExceeded(null) === false);
  var store = {}, good = { setItem: function (k, v) { store[k] = v; } };
  ok("writeStore ok", g.writeStore(good, "k", "v").ok === true && store.k === "v");
  var quota = { setItem: function () { var e = new Error("full"); e.name = "QuotaExceededError"; throw e; } };
  var r = g.writeStore(quota, "k", "v");
  ok("writeStore quota flagged", r.ok === false && r.quota === true);
  var gen = { setItem: function () { throw new Error("boom"); } };
  r = g.writeStore(gen, "k", "v");
  ok("writeStore generic not quota", r.ok === false && r.quota === false);
})();

// ---- #66: storage seam (registry adapter selection) ----------------------
section("#66 storage seam");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/\/\* @store-seam-start \*\/([\s\S]*?)\/\* @store-seam-end \*\//);
  if (!m) { ok("locate @store-seam fence", false); return; }
  var g = new Function(m[1] + "\nreturn { pickStorageAdapter: pickStorageAdapter };")();
  var browser = { name: "browser" }, injected = { name: "file" };
  // Default backend is always the browser adapter -> behaviour-preserving.
  ok("default 'browser' -> browser adapter", g.pickStorageAdapter("browser", injected, browser) === browser);
  ok("unset backend -> browser adapter", g.pickStorageAdapter(null, injected, browser) === browser);
  ok("empty backend -> browser adapter", g.pickStorageAdapter("", injected, browser) === browser);
  // Injection point is wired for the future native-file adapter (#68)...
  ok("flag flipped + adapter injected -> injected", g.pickStorageAdapter("file", injected, browser) === injected);
  // ...but a flipped flag with no adapter present must NEVER strand a save.
  ok("flag flipped, no adapter -> browser fallback", g.pickStorageAdapter("file", null, browser) === browser);
})();

// ---- platform-pivot 01: StorageBackend seam (EXPAND, browser conformance) ----
// The single interface unifying the 3 storage choke points. At the browser default
// each facet must route to EXACTLY today's behaviour: registry -> the registry
// adapter, k/v -> writeStore over localStorage, media -> the AssetStore. Zero
// behaviour change is the whole point of EXPAND, so this pins it.
section("platform-pivot 01 StorageBackend seam");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/\/\* @storage-backend-start \*\/([\s\S]*?)\/\* @storage-backend-end \*\//);
  if (!m) { ok("locate @storage-backend fence", false); return; }
  var g = new Function(m[1] + "\nreturn { makeStorageBackend: makeStorageBackend };")();

  // Spy deps that mimic the real ones exactly (writeStore is the durable helper).
  function writeStore(storage, key, value) {
    try { storage.setItem(key, value); return { ok: true }; }
    catch (e) { return { ok: false, error: e }; }
  }
  var kv = {}, calls = [];
  var storage = {
    getItem: function (k) { calls.push(["get", k]); return (k in kv) ? kv[k] : null; },
    setItem: function (k, v) { calls.push(["set", k, v]); kv[k] = v; },
    removeItem: function (k) { calls.push(["rm", k]); delete kv[k]; }
  };
  var adapter = {
    name: "browser",
    readRegistry: function () { return kv["reg"] || null; },
    writeRegistry: function (json) { kv["reg"] = json; return { ok: true, via: "adapter" }; }
  };
  var media = { put: function () {}, url: function () {}, get: function () {}, has: function () {}, sweep: function () {}, placeholder: "P" };
  var be = g.makeStorageBackend({
    registryAdapter: function () { return adapter; },
    writeStore: writeStore,
    storage: storage,
    assetStore: function () { return media; }
  });

  // name reflects the live adapter
  ok("name reflects registry adapter", be.name === "browser");
  // registry facet routes through the adapter (the #66/#68 swap point)
  ok("writeRegistry -> adapter", be.writeRegistry('{"C-1":{}}').via === "adapter" && kv["reg"] === '{"C-1":{}}');
  ok("readRegistry -> adapter", be.readRegistry() === '{"C-1":{}}');
  // k/v facet routes through writeStore over the injected localStorage-shaped store
  var wr = be.writeKey("authoring.activeDocId", '"C-1"');
  ok("writeKey ok via writeStore", wr.ok === true && kv["authoring.activeDocId"] === '"C-1"');
  ok("readKey reads back", be.readKey("authoring.activeDocId") === '"C-1"');
  ok("readKey missing -> null", be.readKey("nope") === null);
  ok("removeKey clears", be.removeKey("authoring.activeDocId").ok === true && !("authoring.activeDocId" in kv));
  // media facet IS the AssetStore (put/url/get/has/sweep + placeholder)
  ok("media facet is the AssetStore", be.media === media);
  ["put", "url", "get", "has", "sweep"].forEach(function (fn) {
    ok("media exposes " + fn, typeof be.media[fn] === "function");
  });
  // a throwing k/v store never strands (matches today's swallowed writes)
  var boom = { setItem: function () { throw new Error("full"); }, getItem: function () { throw new Error("x"); }, removeItem: function () { throw new Error("x"); } };
  var be2 = g.makeStorageBackend({ registryAdapter: function () { return adapter; }, writeStore: writeStore, storage: boom, assetStore: function () { return media; } });
  ok("writeKey on failing store -> {ok:false}", be2.writeKey("k", "v").ok === false);
  ok("readKey on failing store -> null", be2.readKey("k") === null);
  ok("removeKey on failing store -> {ok:false}", be2.removeKey("k").ok === false);
  // media absent -> null (never throws)
  var be3 = g.makeStorageBackend({ registryAdapter: function () { return adapter; }, writeStore: writeStore, storage: storage, assetStore: function () { return null; } });
  ok("media absent -> null", be3.media === null);
})();

// ---- platform-pivot 02: server-of-one HTTP storage API + SQLite round-trip ----
// The one backend artifact. Exercises the REAL HTTP endpoints against the REAL
// SQLite/WAL store on a temp disk path: whole-doc blob round-trip (AC1), kv + media,
// sweep, WAL durability across reopen, and that a non-API path is NEVER served (no
// server-side render). node:sqlite is built into the bundled runtime; on an older
// CI Node it is absent -> we WARN + skip rather than hard-fail.
section("platform-pivot 02 server-of-one");
(function () {
  try { require("node:sqlite"); }
  catch (e) { warn("node:sqlite unavailable (Node < 22.5) -> server round-trip skipped"); return; }
  var os = require("os");
  var srv = require(path.join(ROOT, "server/verso-server.js"));
  var createStore = require(path.join(ROOT, "server/store.js")).createStore;
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verso-srv-test-"));
  var dbPath = path.join(tmp, "verso.sqlite");
  __async.push((async function () {
    var server, base;
    await new Promise(function (resolve) {
      server = srv.startServer({ mode: "local", port: 0, host: "127.0.0.1", dbPath: dbPath }, function (s) {
        base = "http://127.0.0.1:" + s.address().port; resolve();
      });
    });
    try {
      var doc = { "C-1": { meta: { code: "C-1", title: "Sample" }, chapters: [{ id: "ch1", blocks: [{ id: "b1", type: "text", html: "<p>hi</p>" }] }] } };
      var regJson = JSON.stringify(doc);
      var r, j;
      r = await fetch(base + "/api/health"); j = await r.json();
      ok("health: ok + local mode + renders:false", j.ok === true && j.mode === "local" && j.renders === false);
      // AC1: whole-doc blob round-trip
      r = await fetch(base + "/api/registry", { method: "PUT", body: regJson }); j = await r.json();
      ok("PUT registry -> ok", j.ok === true);
      r = await fetch(base + "/api/registry"); j = await r.json();
      ok("GET registry -> faithful whole-doc round-trip", j.registry === regJson);
      // kv (doc-session keys)
      await (await fetch(base + "/api/kv/authoring.activeDocId", { method: "PUT", body: '"C-1"' })).json();
      r = await fetch(base + "/api/kv/authoring.activeDocId"); j = await r.json();
      ok("kv round-trip", j.value === '"C-1"');
      r = await fetch(base + "/api/kv/absent"); j = await r.json();
      ok("kv missing -> null", j.value === null);
      await (await fetch(base + "/api/kv/authoring.activeDocId", { method: "DELETE" })).json();
      r = await fetch(base + "/api/kv/authoring.activeDocId"); j = await r.json();
      ok("kv delete clears", j.value === null);
      // media
      await (await fetch(base + "/api/media/m1", { method: "PUT", body: JSON.stringify({ data: "data:image/png;base64,AAA", mime: "image/png" }) })).json();
      r = await fetch(base + "/api/media/m1", { method: "HEAD" });
      ok("media HEAD present -> 200", r.status === 200);
      r = await fetch(base + "/api/media/m1"); j = await r.json();
      ok("media GET round-trip", j.data === "data:image/png;base64,AAA" && j.mime === "image/png");
      r = await fetch(base + "/api/media/absent", { method: "HEAD" });
      ok("media HEAD absent -> 404", r.status === 404);
      await (await fetch(base + "/api/media/m2", { method: "PUT", body: "data:image/png;base64,BBB" })).json();
      r = await fetch(base + "/api/media/sweep", { method: "POST", body: JSON.stringify({ keep: ["m2"] }) }); j = await r.json();
      ok("media sweep removes unreferenced (m1), keeps m2", j.removed === 1);
      ok("media sweep: m2 survives", (await fetch(base + "/api/media/m2", { method: "HEAD" })).status === 200);
      ok("media sweep: m1 gone", (await fetch(base + "/api/media/m1", { method: "HEAD" })).status === 404);
      // AC3: never serves the app / never renders — non-API path 404s
      r = await fetch(base + "/index.html");
      ok("non-API path 404 (backend never serves app or renders)", r.status === 404);
      // WAL durability: close server, reopen the store on disk, registry persists
      server.__store.close();
      var s2 = createStore(dbPath);
      ok("registry persists across reopen (SQLite/WAL on local disk)", s2.getRegistry() === regJson);
      s2.close();
    } finally {
      try { server.close(); } catch (e) {}
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  })());
})();

// ---- platform-pivot 02: server source-shape invariants (never renders / no deps) ----
section("platform-pivot 02 server invariants");
(function () {
  var s = src("server/verso-server.js") + src("server/store.js") + src("server/index.js");
  // Dependency-free: only node: builtins may be required (bundled runtime is the sole exception).
  var reqs = s.match(/require\(("|')([^"')]+)\1\)/g) || [];
  var badDep = reqs.filter(function (m) {
    var mod = m.replace(/require\(("|')/, "").replace(/("|')\)/, "");
    return mod.indexOf("node:") !== 0 && mod.charAt(0) !== "."; // node: builtin or relative only
  });
  ok("server requires node: builtins or relative only (no third-party deps)", badDep.length === 0);
  // Never renders: no import of the render engine, no HTML/app serving.
  ok("server never requires render/editor engine", !/require\([^)]*(render|editor|export|runtime)[^)]*\)/.test(s));
  ok("server declares renders:false on health", /renders:\s*false/.test(s));
  // One authorize() choke point exists (identity phase attaches here).
  ok("server routes through one authorize() choke point", /function authorize\(/.test(s) && /if \(!authorize\(/.test(s));
  // SQLite/WAL on disk, sole writer posture documented.
  ok("store uses WAL journal", /journal_mode = WAL/.test(src("server/store.js")));
})();

// ---- platform-pivot 02: client HTTP adapter (pure URL builder + inert guard) ----
section("platform-pivot 02 http adapter");
(function () {
  var t = src("src/store-http.js");
  var m = t.match(/\/\* @http-api-start \*\/([\s\S]*?)\/\* @http-api-end \*\//);
  if (!m) { ok("locate @http-api fence", false); return; }
  var g = new Function(m[1] + "\nreturn { apiUrl: apiUrl };")();
  ok("apiUrl registry", g.apiUrl("http://h:4790", "registry") === "http://h:4790/api/registry");
  ok("apiUrl tolerates trailing slash", g.apiUrl("http://h:4790/", "registry") === "http://h:4790/api/registry");
  ok("apiUrl kv encodes the key", g.apiUrl("http://h", "kv", "authoring.activeDocId") === "http://h/api/kv/authoring.activeDocId");
  ok("apiUrl media encodes odd ids", g.apiUrl("http://h", "media", "a/b c") === "http://h/api/media/a%2Fb%20c");
  // Inert-by-default: the module returns early (installs nothing) with no server URL.
  ok("store-http returns early when no __versoServerUrl", /if \(!serverUrl\(\)\) return;/.test(t));
  ok("store-http installs 'http' adapter only after the guard", t.indexOf("if (!serverUrl()) return;") < t.indexOf('name: "http"'));
  // Never renders / no third-party deps: relies on built-in fetch only.
  ok("store-http uses built-in fetch (no deps)", /fetch\(/.test(t) && !/require\(/.test(t));
})();

// ---- #81: in-app Help guide markdown renderer -----------------------------
section("#81 Help markdown renderer");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/\/\* @md-start \*\/([\s\S]*?)\/\* @md-end \*\//);
  if (!m) { ok("locate @md fence", false); return; }
  var g = new Function(m[1] + "\nreturn { mdToHtml: mdToHtml };")();
  var md = g.mdToHtml;
  ok("heading levels", md("# A\n## B") === "<h1 id=\"a\">A</h1>\n<h2 id=\"b\">B</h2>");
  // #8 heading IDs (docs anchors): slugified, deterministic, unique per doc
  ok("#8 heading emits a slug id", md("## Adding & editing blocks").indexOf("<h2 id=\"adding-editing-blocks\">") !== -1);
  ok("#8 duplicate headings get unique ids", md("## Setup\n## Setup").indexOf("id=\"setup-2\"") !== -1);
  ok("#8 heading id strips inline code/punctuation", md("## The `render()` step").indexOf("id=\"the-step\"") !== -1);
  ok("paragraph joins wrapped lines", md("one\ntwo") === "<p>one two</p>");
  ok("inline bold", md("a **b** c").indexOf("<strong>b</strong>") !== -1);
  ok("inline code", md("use `x` here").indexOf("<code>x</code>") !== -1);
  ok("unordered list", md("- a\n- b") === "<ul><li>a</li><li>b</li></ul>");
  ok("ordered list", md("1. a\n2. b") === "<ol><li>a</li><li>b</li></ol>");
  // #8 lazy continuation: a wrapped bullet joins into one item so inline spans don't break
  ok("#8 wrapped bullet joins (bold not split)", md("- a **Comment\n  mode** b").indexOf("<li>a <strong>Comment mode</strong> b</li>") !== -1);
  ok("#8 continuation stops at next bullet", md("- one\n  wrapped\n- two") === "<ul><li>one wrapped</li><li>two</li></ul>");
  ok("#8 continuation stops at a blank line", md("- one\n\npara").indexOf("<li>one</li></ul>") !== -1 && md("- one\n\npara").indexOf("<p>para</p>") !== -1);
  ok("horizontal rule", md("---") === "<hr>");
  ok("blockquote wraps", md("> hi").indexOf("<blockquote>") === 0);
  // HTML in the source is escaped (defensive — trusted content, still no injection)
  ok("escapes angle brackets", md("a <script> b").indexOf("&lt;script&gt;") !== -1);
  ok("no live tag leaks", md("<img onerror=x>").indexOf("<img") === -1);
  // fenced code preserves content verbatim (escaped), not parsed as blocks
  var fence = md("```\n# not a heading\n```");
  ok("fenced code block", fence.indexOf("<pre><code>") === 0 && fence.indexOf("# not a heading") !== -1);
  ok("fence content not a heading", fence.indexOf("<h1>") === -1);
  // pipe table -> table markup; a bare --- rule is NOT a table separator
  var tbl = md("| H1 | H2 |\n|---|---|\n| a | b |");
  ok("table head", tbl.indexOf("<th>H1</th>") !== -1 && tbl.indexOf("<th>H2</th>") !== -1);
  ok("table body", tbl.indexOf("<td>a</td>") !== -1 && tbl.indexOf("<td>b</td>") !== -1);
  ok("standalone --- stays an hr", md("x\n\n---\n\ny").indexOf("<hr>") !== -1);
  // #25 figure directive: markdown image + optional "caption" + {poster=..} attr -> <figure>
  var figFull = md('![The block palette](docs/assets/palette.webp "Add blocks from here"){poster=docs/assets/palette-still.webp}');
  ok("#25 figure emits <figure><img>", figFull.indexOf("<figure class=\"doc-figure\">") === 0 && figFull.indexOf("<img class=\"doc-figure__img\"") !== -1);
  ok("#25 figure src + alt emitted", figFull.indexOf("src=\"docs/assets/palette.webp\"") !== -1 && figFull.indexOf("alt=\"The block palette\"") !== -1);
  ok("#25 figure caption -> figcaption", figFull.indexOf("<figcaption class=\"doc-figure__cap\">Add blocks from here</figcaption>") !== -1);
  ok("#25 poster carried as data-poster (unused for stills)", figFull.indexOf("data-poster=\"docs/assets/palette-still.webp\"") !== -1);
  // minimal form: no caption, no poster
  var figMin = md("![alt only](docs/assets/x.webp)");
  ok("#25 figure minimal (no caption/poster)", figMin.indexOf("<figure") === 0 && figMin.indexOf("<figcaption") === -1 && figMin.indexOf("data-poster") === -1);
  ok("#25 figure alt-only still emits alt", figMin.indexOf("alt=\"alt only\"") !== -1);
  // a figure line is NOT swallowed into a paragraph when surrounded by prose
  var figProse = md("intro\n\n![cap](docs/assets/y.webp)\n\noutro");
  ok("#25 figure not wrapped in <p>", figProse.indexOf("<p>intro</p>") !== -1 && figProse.indexOf("<figure") !== -1 && figProse.indexOf("<p><figure") === -1);
  // lazy-loaded so the docs panel opens fast; escaped attrs (no injection via alt/caption)
  ok("#25 figure img lazy-loads", figMin.indexOf("loading=\"lazy\"") !== -1);
  var figInj = md('![a"b](docs/assets/z.webp)');
  ok("#25 figure escapes quotes in attrs", figInj.indexOf("alt=\"a&quot;b\"") !== -1 && figInj.indexOf("alt=\"a\"b\"") === -1);
})();

// WIRING: broken figure assets degrade gracefully (impure onerror wiring, not the pure renderer)
(function () {
  var ed = src("src/editor.js");
  ok("#25 openHelpModal wires figure onerror -> --missing", /doc-figure__img[\s\S]{0,220}addEventListener\("error"[\s\S]{0,120}doc-figure--missing/.test(ed));
})();

// WIRING: the Help button opens the in-app modal, not a (no-op) new tab.
(function () {
  var ed = src("src/editor.js");
  ok("#81 help-btn wired to openHelpModal", /getElementById\("help-btn"\)[\s\S]{0,80}openHelpModal/.test(ed));
  ok("#81 no stale window.open to USER-GUIDE.md", ed.indexOf("window.open(\"docs/USER-GUIDE.md\"") === -1);
  ok("#81 help modal fetches the guide", /fetch\("docs\/USER-GUIDE\.md"/.test(ed));
})();

// ---- #8: two-pane docs reader — sidebar TOC + search built from the guide's headings ----
// The reader is a two-pane surface (search + TOC nav | reading pane). The TOC is built from
// the guide's own heading IDs, so nav + scroll-spy track the content and never drift.
section("#8 docs reader (TOC + search)");
(function () {
  var ed = src("src/editor.js");
  ok("#8 reader builds the two-pane split (nav + reading pane)", /modal-box--docs/.test(ed) && /docs-split/.test(ed) && /docs-nav/.test(ed));
  ok("#8 sidebar has a search input", /docs-search__input/.test(ed) && /Search the guide/.test(ed));
  ok("#8 TOC built from the guide's h2/h3 heading ids", /function buildDocsNav[\s\S]{0,400}querySelectorAll\("h2\[id\], h3\[id\]"\)/.test(ed));
  ok("#8 TOC item scrolls the reading pane to its heading", /docs-toc__item[\s\S]{0,400}addEventListener\("click"[\s\S]{0,80}scrollToHead/.test(ed));
  ok("#8 scroll-spy highlights the active section", /body\.addEventListener\("scroll"[\s\S]{0,600}is-active/.test(ed));
  ok("#8 search filters the TOC + shows a no-match state", /function runSearch[\s\S]{0,400}is-hidden[\s\S]{0,200}docs-toc__empty|noHits\.style\.display/.test(ed));
  ok("#8 Escape clears a live search before closing", /activeElement === search && search\.value[\s\S]{0,80}runSearch\(""\)/.test(ed));
  ok("#8 CSS: TOC active item reuses the accent-quiet/accent token pair", /\.docs-toc__item\.is-active\s*\{[^}]*var\(--accent-quiet\)[^}]*var\(--accent\)/.test(src("editor.css")));
  ok("#8 CSS: search converges to the ring-wrapper focus-within pattern", /\.docs-search:focus-within\s*\{[^}]*var\(--accent\)/.test(src("editor.css")));
})();

// ---- #8 docs auto-maintenance — the drift checker tool (code is truth) -----------------
// tools/docs-maintain.js introspects the block palette and verifies the guide documents each
// block. This is the runnable, author-facing form of the #91 anti-drift gate; the test shares
// its pure core so there is ONE coverage rule, and proves the drift-bite.
section("#8 docs auto-maintenance");
(function () {
  var dm = require(path.join(ROOT, "tools/docs-maintain.js"));
  var ed = src("src/editor.js"), guide = src("docs/USER-GUIDE.md");
  var blocks = dm.extractLibrary(ed);
  ok("#8 maintain: parses the block palette from source (>= 20)", blocks.length >= 20 && blocks.every(function (b) { return b.group && b.label; }));
  var cov = dm.blockCoverage(ed, guide);
  ok("#8 maintain: every palette block is documented (no drift)"
    + (cov.undocumented.length ? " -- MISSING: " + cov.undocumented.map(function (b) { return b.label; }).join(" | ") : ""), cov.undocumented.length === 0);
  ok("#8 maintain: coverage groups the inventory by category", Object.keys(cov.groups).length >= 3);
  // the checker BITES: a hypothetical undocumented block is caught
  ok("#8 maintain: drift-bite — an undocumented block fails coverage", dm.isDocumented("Zorptron 9000", guide) === false);
  ok("#8 maintain: core-label rule strips a trailing qualifier", dm.coreLabel("Card (container)") === "Card");
})();

// ---- #26: docs capture mode — deterministic clock + RNG, freeze, off-by-default -------
// Two captures of the same scene must be byte-identical: the flag installs a monotonic
// clock and a seeded RNG so timestamp-/random-suffixed ids reproduce across runs.
section("#26 docs capture mode");
(function () {
  var srcTxt = src("src/capture-mode.js");
  var realRandom = Math.random;
  function runCapture(win, loc) {
    var htmlAttrs = {}, injected = [];
    var fakeDoc = {
      readyState: "complete",
      documentElement: { setAttribute: function (k, v) { htmlAttrs[k] = v; } },
      head: { appendChild: function (n) { injected.push(n); } },
      getElementById: function (id) { return injected.filter(function (n) { return n.id === id; })[0] || null; },
      createElement: function () { return {}; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    };
    var fakePerf = { now: function () { return 0; } };
    var fn = new Function("window", "document", "location", "performance", "URLSearchParams", srcTxt);
    fn(win, fakeDoc, loc, fakePerf, URLSearchParams);
    var randomSeq = [], nowSeq = [];
    for (var i = 0; i < 5; i++) randomSeq.push(Math.random());
    for (var j = 0; j < 5; j++) nowSeq.push(win.Date ? win.Date.now() : NaN);
    return { htmlAttrs: htmlAttrs, injected: injected, CaptureMode: win.CaptureMode, randomSeq: randomSeq, nowSeq: nowSeq, capDate: win.Date };
  }
  // ON via window.__captureMode
  var r1 = runCapture({ __captureMode: true }, { search: "" });
  var r2 = runCapture({ __captureMode: true }, { search: "" });
  ok("#26 sets data-capture=on", r1.htmlAttrs["data-capture"] === "on");
  ok("#26 injects exactly one freeze stylesheet", r1.injected.length === 1 && r1.injected[0].id === "capture-freeze-css");
  ok("#26 freeze CSS kills transition/animation + hides caret", /transition:\s*none/.test(r1.injected[0].textContent) && /animation:\s*none/.test(r1.injected[0].textContent) && /caret-color:\s*transparent/.test(r1.injected[0].textContent));
  ok("#26 exposes window.CaptureMode.active + settle()", r1.CaptureMode && r1.CaptureMode.active === true && typeof r1.CaptureMode.settle === "function");
  ok("#26 clock monotonic from a fixed epoch", r1.nowSeq[0] >= 1700000000000 && r1.nowSeq[1] === r1.nowSeq[0] + 1);
  ok("#26 random values in [0,1)", r1.randomSeq.every(function (x) { return x >= 0 && x < 1; }));
  ok("#26 RNG deterministic across two captures (byte-identical)", JSON.stringify(r1.randomSeq) === JSON.stringify(r2.randomSeq));
  ok("#26 clock deterministic across two captures", JSON.stringify(r1.nowSeq) === JSON.stringify(r2.nowSeq));
  ok("#26 argless new Date() is deterministic", new r1.capDate().getTime() >= 1700000000000);
  Math.random = realRandom;
  // OFF by default: no flag, no ?capture -> the IIFE returns early, patches nothing
  var off = runCapture({}, { search: "" });
  ok("#26 OFF by default: no data-capture, no CaptureMode, no injection", off.htmlAttrs["data-capture"] === undefined && !off.CaptureMode && off.injected.length === 0);
  ok("#26 OFF by default: Math.random left untouched", Math.random === realRandom);
  // ON via ?capture=1
  Math.random = realRandom;
  var byQuery = runCapture({}, { search: "?capture=1" });
  ok("#26 ?capture=1 activates", byQuery.CaptureMode && byQuery.CaptureMode.active === true);
  // capture=0 must NOT activate
  Math.random = realRandom;
  var q0 = runCapture({}, { search: "?capture=0" });
  ok("#26 ?capture=0 does not activate", !q0.CaptureMode);
  Math.random = realRandom;
})();

// WIRING: capture-mode.js loads first; never bundled into the SCORM export (invariant intact)
(function () {
  var html = src("index.html");
  var cap = html.indexOf("src/capture-mode.js"), theme = html.indexOf("src/theme.js"), ed = html.indexOf("src/editor.js");
  ok("#26 capture-mode.js loads before theme.js + editor.js", cap !== -1 && cap < theme && cap < ed);
  ok("#26 capture-mode.js NOT bundled into SCORM export", src("src/export.js").indexOf("capture-mode") === -1);
})();

// ---- #27: docs capture scene DSL — pure schema/validation core ------------------------
// The scene is data; validateScene is the shared gate the runner and this test both use so
// a malformed scene fails loudly. (The puppeteer-driven capture itself is browser-verified.)
section("#27 docs capture scene DSL");
(function () {
  var dc = require(path.join(ROOT, "tools/docs-capture.js"));
  ok("#27 still budget is ~200KB", dc.STILL_BUDGET === 200 * 1024);
  ok("#27 step vocabulary is the fixed set", JSON.stringify(dc.STEP_VERBS) === JSON.stringify(["goto", "select", "hover", "click", "type", "wait", "shoot", "shootMotion", "highlight", "callout", "pointer", "clearAnnotations"]));
  // a valid still scene passes
  var good = { id: "s1", covers: ["editor-workspace"], kind: "still", viewport: { width: 1440, height: 900, dpr: 2 }, theme: "dark", steps: [{ do: "wait", ms: 300 }, { do: "shoot", out: "s1.webp" }] };
  ok("#27 valid scene passes", dc.validateScene(good).ok === true);
  // missing id / covers / steps / shoot each fail
  ok("#27 requires id", dc.validateScene({ covers: ["x"], steps: [{ do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#27 requires non-empty covers (staleness #30)", dc.validateScene({ id: "s", covers: [], steps: [{ do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#27 requires at least one shoot", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "wait", ms: 1 }] }).ok === false);
  ok("#27 shoot out must end .webp", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "shoot", out: "a.png" }] }).ok === false);
  ok("#27 unknown verb fails", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "teleport" }, { do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#27 click/goto need a target", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "click" }, { do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#27 type needs target + text", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "type", target: "#x" }, { do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#27 a motion scene needs a shootMotion step (a plain shoot is not enough)", dc.validateScene({ id: "s", covers: ["x"], kind: "motion", steps: [{ do: "shoot", out: "a.webp" }] }).ok === false);
  // resolveOut confines output to docs/assets (no traversal)
  ok("#27 resolveOut strips path traversal", dc.resolveOut("/repo/docs/assets", "../../evil.webp") === path.join("/repo/docs/assets", "evil.webp"));
  // the shipped scene is valid and uses the synthetic demo (never real content)
  var shipped = JSON.parse(src("docs/scenes/structure-panel.json"));
  ok("#27 shipped structure-panel scene is valid", dc.validateScene(shipped).ok === true);
  ok("#27 runner loads SAMPLE_DOC only, never reads a stored doc (export-control)", src("tools/docs-capture.js").indexOf("window.SAMPLE_DOC") !== -1 && src("tools/docs-capture.js").indexOf("localStorage.getItem") === -1 && src("tools/docs-capture.js").indexOf("getDoc()") === -1);
  // the shipped still figure is wired into the guide + the committed asset exists
  ok("#27 USER-GUIDE references the committed still", src("docs/USER-GUIDE.md").indexOf("docs/assets/structure-panel.webp") !== -1);
  ok("#27 committed still exists + within budget", (function () { try { return fs.statSync(path.join(ROOT, "docs/assets/structure-panel.webp")).size <= dc.STILL_BUDGET; } catch (e) { return false; } })());
})();

// ---- #28: animated-WebP muxer + motion scenes -----------------------------------------
// The muxer assembles Chrome-native per-frame WebP bitstreams into one animated WebP. It is
// deterministic (same frames in -> same bytes out), backing the no-op-commit promise.
section("#28 animated-WebP muxer + motion");
(function () {
  var wa = require(path.join(ROOT, "tools/webp-anim.js"));
  var dc = require(path.join(ROOT, "tools/docs-capture.js"));
  // read two committed stills as frame inputs (real Chrome WebP buffers)
  function readBuf(rel) { return fs.readFileSync(path.join(ROOT, rel)); }
  function parseChunks(buf) {
    var out = [], off = 12;
    while (off + 8 <= buf.length) { var f = buf.toString("latin1", off, off + 4); var s = buf.readUInt32LE(off + 4); out.push({ fourcc: f, size: s }); off += 8 + s + (s & 1); }
    return out;
  }
  var A = readBuf("docs/assets/structure-panel.webp");
  // parseWebP extracts the image chunk(s) from a Chrome WebP
  var parsed = wa.parseWebP(A);
  ok("#28 parseWebP extracts image bytes", parsed.imageBytes && parsed.imageBytes.length > 0);
  ok("#28 parseWebP rejects non-WEBP", (function () { try { wa.parseWebP(Buffer.from("not a webp")); return false; } catch (e) { return true; } })());
  // mux two frames -> valid animated WebP container
  var anim = wa.muxAnimatedWebP({ width: 100, height: 60, loopCount: 0, frames: [{ webp: A, duration: 800 }, { webp: A, duration: 400 }] });
  ok("#28 muxed buffer is RIFF/WEBP", anim.toString("latin1", 0, 4) === "RIFF" && anim.toString("latin1", 8, 12) === "WEBP");
  var ch = parseChunks(anim);
  ok("#28 has VP8X (extended) first", ch[0].fourcc === "VP8X" && ch[0].size === 10);
  ok("#28 VP8X animation flag set", (anim[12 + 8] & 0x02) === 0x02); // first payload byte of VP8X
  ok("#28 has ANIM chunk", ch[1].fourcc === "ANIM");
  ok("#28 one ANMF per frame", ch.filter(function (c) { return c.fourcc === "ANMF"; }).length === 2);
  // canvas dims encoded as width-1/height-1 (24-bit LE) in VP8X payload bytes 4..9
  var vp8xOff = 12 + 8;
  var cw = (anim[vp8xOff + 4] | (anim[vp8xOff + 5] << 8) | (anim[vp8xOff + 6] << 16)) + 1;
  var chh = (anim[vp8xOff + 7] | (anim[vp8xOff + 8] << 8) | (anim[vp8xOff + 9] << 16)) + 1;
  ok("#28 VP8X canvas size = requested", cw === 100 && chh === 60);
  // RIFF size field = filesize - 8
  ok("#28 RIFF size field correct", anim.readUInt32LE(4) === anim.length - 8);
  // determinism: same frames -> identical bytes
  var anim2 = wa.muxAnimatedWebP({ width: 100, height: 60, loopCount: 0, frames: [{ webp: A, duration: 800 }, { webp: A, duration: 400 }] });
  ok("#28 muxer deterministic (byte-identical)", Buffer.compare(anim, anim2) === 0);
  // budget + shootMotion schema
  ok("#28 motion budget ~500KB", dc.MOTION_BUDGET === 500 * 1024);
  ok("#28 shootMotion is in the vocabulary", dc.STEP_VERBS.indexOf("shootMotion") !== -1);
  var goodMotion = { id: "m", covers: ["x"], kind: "motion", steps: [{ do: "shootMotion", out: "m.webp", poster: "m-still.webp", frames: [{ duration: 800 }, { before: [{ do: "click", target: "#x" }], duration: 800 }] }] };
  ok("#28 valid motion scene passes", dc.validateScene(goodMotion).ok === true);
  ok("#28 shootMotion needs a poster (reduced-motion)", dc.validateScene({ id: "m", covers: ["x"], kind: "motion", steps: [{ do: "shootMotion", out: "m.webp", frames: [{ duration: 1 }, { duration: 1 }] }] }).ok === false);
  ok("#28 shootMotion needs >=2 frames", dc.validateScene({ id: "m", covers: ["x"], kind: "motion", steps: [{ do: "shootMotion", out: "m.webp", poster: "p.webp", frames: [{ duration: 1 }] }] }).ok === false);
  ok("#28 shootMotion frame needs duration>0", dc.validateScene({ id: "m", covers: ["x"], kind: "motion", steps: [{ do: "shootMotion", out: "m.webp", poster: "p.webp", frames: [{ duration: 0 }, { duration: 1 }] }] }).ok === false);
  // shipped motion scene + committed assets
  var mscene = JSON.parse(src("docs/scenes/outliner-navigate.json"));
  ok("#28 shipped outliner-navigate motion scene valid", dc.validateScene(mscene).ok === true);
  ok("#28 committed motion within budget", (function () { try { return fs.statSync(path.join(ROOT, "docs/assets/outliner-navigate.webp")).size <= dc.MOTION_BUDGET; } catch (e) { return false; } })());
  ok("#28 committed poster within still budget", (function () { try { return fs.statSync(path.join(ROOT, "docs/assets/outliner-navigate-still.webp")).size <= dc.STILL_BUDGET; } catch (e) { return false; } })());
  ok("#28 committed motion is a real animated WebP (VP8X+ANIM+2 ANMF)", (function () { try { var m = readBuf("docs/assets/outliner-navigate.webp"); var c = parseChunks(m); return c[0].fourcc === "VP8X" && c.some(function (x) { return x.fourcc === "ANIM"; }) && c.filter(function (x) { return x.fourcc === "ANMF"; }).length === 2; } catch (e) { return false; } })());
  ok("#28 USER-GUIDE references the motion figure + poster", src("docs/USER-GUIDE.md").indexOf("docs/assets/outliner-navigate.webp") !== -1 && src("docs/USER-GUIDE.md").indexOf("poster=docs/assets/outliner-navigate-still.webp") !== -1);
  ok("#28 webp-anim.js logged in THIRD-PARTY-NOTICES audit", src("THIRD-PARTY-NOTICES.md").indexOf("tools/webp-anim.js") !== -1);
})();

// WIRING: reduced-motion swaps a motion figure to its poster still (impure docs-panel wiring)
(function () {
  var ed = src("src/editor.js");
  ok("#28 openHelpModal swaps to poster under prefers-reduced-motion", /prefers-reduced-motion[\s\S]{0,220}data-poster[\s\S]{0,80}img\.src\s*=\s*img\.getAttribute\("data-poster"\)/.test(ed) || /reduce\s*&&\s*img\.getAttribute\("data-poster"\)[\s\S]{0,60}img\.src/.test(ed));
})();

// ---- #29: in-editor annotation overlay (capture-only) ---------------------------------
// Highlight ring / numbered callout / pointer drawn OVER the editor for docs figures.
// Verso-UI-only: rendered into a body-level layer, styled in editor.css, NEVER in course
// output (render()/course.css/SCORM export). Tests: the annotate API draws the right DOM,
// scene DSL validates the verbs, and the invariant holds (absent from export).
section("#29 annotation overlay");
(function () {
  // -- headless annotate() unit test via a minimal fake DOM --
  var srcTxt = src("src/capture-mode.js");
  var realRandom = Math.random;
  function makeEl(tag) {
    var el = { tagName: tag, children: [], style: {}, className: "", _text: "", _html: "", parentNode: null,
      setAttribute: function (k, v) { this["_a_" + k] = v; if (k === "id") this.id = v; },
      getAttribute: function (k) { return this["_a_" + k]; },
      appendChild: function (c) { this.children.push(c); c.parentNode = el; return c; },
      classList: { add: function () {}, contains: function () { return false; } } };
    Object.defineProperty(el, "textContent", { get: function () { return el._text; }, set: function (v) { el._text = v; el.children = []; } });
    Object.defineProperty(el, "innerHTML", { get: function () { return el._html; }, set: function (v) { el._html = v; } });
    return el;
  }
  var body = makeEl("body");
  function findById(n, id) { if (n.id === id) return n; for (var i = 0; i < n.children.length; i++) { var r = findById(n.children[i], id); if (r) return r; } return null; }
  var fakeDoc = {
    readyState: "complete",
    documentElement: { setAttribute: function () {} },
    head: { appendChild: function () {} }, body: body,
    getElementById: function (id) { return findById(body, id); },
    createElement: function (t) { return makeEl(t); },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
  var win = { __captureMode: true };
  new Function("window", "document", "location", "performance", "URLSearchParams", srcTxt)(win, fakeDoc, { search: "" }, { now: function () { return 0; } }, URLSearchParams);
  Math.random = realRandom;
  var CM = win.CaptureMode;
  ok("#29 CaptureMode exposes annotate + clearAnnotations", CM && typeof CM.annotate === "function" && typeof CM.clearAnnotations === "function");
  // highlight ring: box{x,y,w,h}, pad 4 -> left x-4, size w+8/h+8
  CM.annotate({ type: "highlight", box: { x: 10, y: 20, w: 100, h: 40 } });
  var layer = fakeDoc.getElementById("capture-annotate-layer");
  ok("#29 highlight draws a ring into the annotate layer", layer && layer.children.length === 1 && layer.children[0].className.indexOf("capture-annot--ring") !== -1);
  ok("#29 ring positioned at target box (with pad)", layer.children[0].style.left === "6px" && layer.children[0].style.width === "108px");
  // numbered callout chip
  CM.annotate({ type: "callout", box: { x: 10, y: 20, w: 100, h: 40 }, n: 3, side: "tr" });
  var chip = layer.children[1];
  ok("#29 callout draws a numbered chip", chip.className.indexOf("capture-annot--chip") !== -1 && chip.textContent === "3");
  ok("#29 callout side 'tr' anchors to top-right corner", chip.style.left === "110px" && chip.style.top === "20px");
  // pointer
  CM.annotate({ type: "pointer", box: { x: 10, y: 20, w: 100, h: 40 }, from: "left" });
  var ptr = layer.children[2];
  ok("#29 pointer draws an arrow glyph", ptr.className.indexOf("capture-annot--pointer-left") !== -1 && ptr.innerHTML.indexOf("<svg") !== -1);
  // clearAnnotations empties the layer
  CM.clearAnnotations();
  ok("#29 clearAnnotations empties the layer", layer.children.length === 0);
  // annotate returns false for a missing/unresolvable target
  ok("#29 annotate no-ops on a missing target", CM.annotate({ type: "highlight", target: ".nope-xyz" }) === false);

  // -- scene DSL validation for the annotation verbs --
  var dc = require(path.join(ROOT, "tools/docs-capture.js"));
  ["highlight", "callout", "pointer", "clearAnnotations"].forEach(function (v) {
    ok("#29 '" + v + "' is in the step vocabulary", dc.STEP_VERBS.indexOf(v) !== -1);
  });
  ok("#29 highlight needs a target", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "highlight" }, { do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#29 callout needs target + n", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "callout", target: "#x" }, { do: "shoot", out: "a.webp" }] }).ok === false);
  ok("#29 a valid annotated scene passes", dc.validateScene({ id: "s", covers: ["x"], steps: [{ do: "highlight", target: "#x" }, { do: "callout", target: "#x", n: 1 }, { do: "pointer", target: "#x" }, { do: "clearAnnotations" }, { do: "shoot", out: "a.webp" }] }).ok === true);

  // -- INVARIANT: annotation overlay is editor chrome only, never course output --
  ok("#29 annotation classes live in editor.css (chrome), NOT course.css (ships)", src("editor.css").indexOf("capture-annot") !== -1 && src("src/course.css").indexOf("capture-annot") === -1);
  ok("#29 render.js + export.js never emit annotation classes", src("src/render.js").indexOf("capture-annot") === -1 && src("src/export.js").indexOf("capture-annot") === -1);
  ok("#29 overlay uses the DS accent token (theme-inherited)", /\.capture-annot--ring\s*\{[^}]*var\(--accent\)/.test(src("editor.css")) && /\.capture-annot--chip\s*\{[\s\S]*?var\(--accent\)/.test(src("editor.css")));

  // -- shipped annotated scenes + committed assets --
  ok("#29 annotated still scene valid", dc.validateScene(JSON.parse(src("docs/scenes/annotated-structure.json"))).ok === true);
  ok("#29 annotated motion scene valid", dc.validateScene(JSON.parse(src("docs/scenes/annotated-navigate.json"))).ok === true);
  ok("#29 annotated still committed within budget", (function () { try { return fs.statSync(path.join(ROOT, "docs/assets/annotated-structure.webp")).size <= dc.STILL_BUDGET; } catch (e) { return false; } })());
  ok("#29 annotated motion committed within budget", (function () { try { return fs.statSync(path.join(ROOT, "docs/assets/annotated-navigate.webp")).size <= dc.MOTION_BUDGET; } catch (e) { return false; } })());
  ok("#29 USER-GUIDE references both annotated figures", src("docs/USER-GUIDE.md").indexOf("docs/assets/annotated-structure.webp") !== -1 && src("docs/USER-GUIDE.md").indexOf("docs/assets/annotated-navigate.webp") !== -1);
})();

// ---- #30: staleness coverage mapping --------------------------------------------------
// A scene's covers lists the src surfaces it illustrates; --stale maps a diff -> scenes to
// re-run so the same-session docs-alignment rule can be applied (procedural, not a CI gate).
section("#30 staleness coverage");
(function () {
  var dc = require(path.join(ROOT, "tools/docs-capture.js"));
  // file surfaces vs human tags
  ok("#30 file surfaces recognised", dc.isFileSurface("src/editor.js") && dc.isFileSurface("editor.css") && dc.isFileSurface("src/editor.js#LIBRARY"));
  ok("#30 human tags are not file surfaces", !dc.isFileSurface("block-palette") && !dc.isFileSurface("pages-outliner"));
  // matching: exact, suffix (absolute path), and the #anchor is stripped
  ok("#30 exact file match", dc.coverMatchesFile("src/editor.js", "src/editor.js"));
  ok("#30 absolute-path suffix match", dc.coverMatchesFile("src/editor.js", "/Users/x/verso/src/editor.js"));
  ok("#30 anchor stripped before match", dc.coverMatchesFile("src/editor.js#LIBRARY", "src/editor.js"));
  ok("#30 human tag never matches a file", !dc.coverMatchesFile("block-palette", "src/editor.js"));
  ok("#30 unrelated file does not match", !dc.coverMatchesFile("editor.css", "src/render.js"));
  // staleScenes over a synthetic scene set
  var scenes = [
    { id: "a", covers: ["src/editor.js", "editor.css", "pages-outliner"] },
    { id: "b", covers: ["src/capture-mode.js", "annotation-overlay"] },
    { id: "c", covers: ["only-a-tag"] }
  ];
  var s1 = dc.staleScenes(scenes, ["editor.css"]);
  ok("#30 editor.css -> only scene a", s1.length === 1 && s1[0].id === "a" && s1[0].matched[0] === "editor.css");
  var s2 = dc.staleScenes(scenes, ["src/editor.js", "src/capture-mode.js"]);
  ok("#30 two files -> scenes a + b", s2.map(function (x) { return x.id; }).sort().join(",") === "a,b");
  var s3 = dc.staleScenes(scenes, ["src/render.js"]);
  ok("#30 course-output file -> no scenes (chrome only)", s3.length === 0);
  var s4 = dc.staleScenes(scenes, ["some-other.js"]);
  ok("#30 unrelated change -> no scenes", s4.length === 0);
  // every shipped scene has covers with >= 1 file surface (so staleness can map to it)
  var files = fs.readdirSync(path.join(ROOT, "docs/scenes")).filter(function (f) { return /\.json$/.test(f); });
  ok("#30 shipped scenes exist", files.length >= 2);
  var allHaveFileSurface = files.every(function (f) {
    var sc = JSON.parse(src("docs/scenes/" + f));
    return (sc.covers || []).some(function (c) { return dc.isFileSurface(c); });
  });
  ok("#30 every shipped scene covers >= 1 file surface", allHaveFileSurface);
  // real coverage: an editor.css change re-runs every shipped scene
  var real = fs.readdirSync(path.join(ROOT, "docs/scenes")).filter(function (f) { return /\.json$/.test(f); }).map(function (f) { return JSON.parse(src("docs/scenes/" + f)); });
  ok("#30 editor.css change maps to all shipped scenes", dc.staleScenes(real, ["editor.css"]).length === real.length);
  // documented: the staleness aid is referenced in the scene README + ADR (deferral noted)
  ok("#30 scene README documents --stale + covers schema", /--stale/.test(src("docs/scenes/README.md")) && /covers/.test(src("docs/scenes/README.md")));
  ok("#30 hash-ratchet/CI regeneration noted as deferred", /defer/i.test(src("docs/adr/0004-user-docs-markdown-single-source-runtime-reader.md")));
})();

// ---- #91: docs anti-drift gate — the User Guide must document every palette block ----
// "Code is truth, docs drift." The block palette (LIBRARY, editor.js) is the single source of
// truth for what a user can add. This gate extracts every top-level LIBRARY block and asserts
// docs/USER-GUIDE.md documents it — so adding a block to the palette WITHOUT documenting it
// fails CI here. Directly enforces James's "nothing diverges" (#91). Extend to shortcuts/settings
// as those docs sections firm up.
section("#91 docs anti-drift — block catalogue coverage");
(function () {
  var e = src("src/editor.js");
  var guide = src("docs/USER-GUIDE.md");
  // Extract ONLY top-level LIBRARY entries — each begins `{ group: "..", icon: "..", label: ".." `
  // (nested labels inside make() bodies, e.g. the checkbox default / quiz retry, are skipped).
  var lib = e.slice(e.indexOf("var LIBRARY = ["), e.indexOf("];", e.indexOf("var LIBRARY = [")));
  var labels = [], re = /group:\s*"[^"]+",\s*icon:\s*"[^"]*",\s*label:\s*"([^"]+)"/g, m;
  while ((m = re.exec(lib))) labels.push(m[1]);
  ok("#91 LIBRARY palette parsed from source (>= 20 blocks)", labels.length >= 20);
  var coreOf = function (l) { return l.replace(/\s*\(.*\)/, "").trim(); };
  var documented = function (l) { return guide.indexOf(l) !== -1 || guide.indexOf(coreOf(l)) !== -1; };
  var undoc = labels.filter(function (l) { return !documented(l); });
  ok("#91 every palette block is documented in docs/USER-GUIDE.md (nothing diverges)"
    + (undoc.length ? " -- UNDOCUMENTED: " + undoc.join(" | ") : ""), undoc.length === 0);
  // prove the gate BITES: a hypothetical new palette block with no guide entry must fail
  var fake = labels.concat(["Zorptron 9000"]).filter(function (l) { return !documented(l); });
  ok("#91 gate trips: a new undocumented block fails coverage", fake.length === 1 && fake[0] === "Zorptron 9000");
})();

// ---- #71: recents timestamps (stamp + sort comparator) --------------------
section("#71 recents");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/\/\* @pure-recents-start \*\/([\s\S]*?)\/\* @pure-recents-end \*\//);
  if (!m) { ok("locate @pure-recents fence", false); return; }
  var g = new Function(m[1] +
    "\nreturn { stampDocUpdatedAt: stampDocUpdatedAt, stampDocOpenedAt: stampDocOpenedAt, recentsCompare: recentsCompare," +
    " courseMatchesQuery: courseMatchesQuery, formatRelativeTime: formatRelativeTime };")();

  // stampers: write the scalar onto meta, create meta if absent, never touch media.
  var d = { meta: { title: "A", code: "A" }, pages: [{ blocks: [{ type: "image", src: "data:image/png;base64,AAA" }] }] };
  g.stampDocUpdatedAt(d, 1000);
  ok("stamp sets updatedAt", d.meta.updatedAt === 1000);
  ok("stamp leaves media untouched (no re-inline)", d.pages[0].blocks[0].src === "data:image/png;base64,AAA");
  var bare = {}; g.stampDocUpdatedAt(bare, 5); ok("stamp creates meta when absent", bare.meta && bare.meta.updatedAt === 5);
  ok("stamp null-safe", g.stampDocUpdatedAt(null, 1) === null);
  var o = { meta: {} }; g.stampDocOpenedAt(o, 42); ok("stampOpened sets lastOpenedAt", o.meta.lastOpenedAt === 42);
  ok("stampUpdated does not set lastOpenedAt", d.meta.lastOpenedAt === undefined);

  // stamping the active doc must NOT bump a sibling doc (the "changed doc only" guard).
  var other = { meta: { title: "B", code: "B", updatedAt: 200 } };
  g.stampDocUpdatedAt(d, 999);
  ok("sibling doc untouched by a stamp", other.meta.updatedAt === 200);

  // comparator: newest first; absent updatedAt last; title tiebreak; stable + total order.
  var recent = { meta: { title: "recent", updatedAt: 300 } };
  var older  = { meta: { title: "older",  updatedAt: 100 } };
  var none1  = { meta: { title: "zeta" } };
  var none2  = { meta: { title: "alpha" } };
  var arr = [none1, older, recent, none2].slice();
  arr.sort(g.recentsCompare);
  ok("newest updatedAt first", arr[0] === recent);
  ok("older next", arr[1] === older);
  ok("no-timestamp docs sort last", arr[2] === none2 && arr[3] === none1); // alpha < zeta
  ok("compare is symmetric-sign", g.recentsCompare(recent, older) < 0 && g.recentsCompare(older, recent) > 0);
  ok("equal updatedAt + equal title -> 0", g.recentsCompare({ meta: { title: "x", updatedAt: 1 } }, { meta: { title: "x", updatedAt: 1 } }) === 0);
  ok("both missing -> title order", g.recentsCompare(none2, none1) < 0);

  // #73 search predicate: title OR code, case-insensitive; empty query -> all.
  var sd = { meta: { title: "Getting started", code: "COURSE-101" } };
  ok("empty query matches all", g.courseMatchesQuery(sd, "") === true && g.courseMatchesQuery(sd, null) === true);
  ok("matches title (case-insensitive)", g.courseMatchesQuery(sd, "getting") === true);
  ok("matches code (case-insensitive)", g.courseMatchesQuery(sd, "course") === true);
  ok("non-match -> false", g.courseMatchesQuery(sd, "radar") === false);
  ok("query on doc with no meta -> false (non-empty query)", g.courseMatchesQuery({}, "x") === false);

  // #73 relative-time label: absent/invalid -> em dash; buckets for a fixed now.
  var NOW = 1000000000000;
  ok("absent updatedAt -> em dash", g.formatRelativeTime(undefined, NOW) === "—");
  ok("NaN -> em dash", g.formatRelativeTime(NaN, NOW) === "—");
  ok("recent -> just now", g.formatRelativeTime(NOW - 10 * 1000, NOW) === "just now");
  ok("minutes", g.formatRelativeTime(NOW - 5 * 60 * 1000, NOW) === "5 minutes ago");
  ok("one hour singular", g.formatRelativeTime(NOW - 60 * 60 * 1000, NOW) === "1 hour ago");
  ok("days", g.formatRelativeTime(NOW - 3 * 24 * 3600 * 1000, NOW) === "3 days ago");
  ok("future clamps to just now", g.formatRelativeTime(NOW + 5000, NOW) === "just now");
})();

// ---- #67: .verso portable package (zip codec + round-trip) ----------------
section("#67 .verso format");
(function () {
  var t = src("src/verso-format.js");
  var win = {};
  new Function("window", t)(win);
  var VF = win.VersoFormat;
  if (!VF || !VF.buildPackage || !VF.readPackage) { ok("VersoFormat loaded", false); return; }
  ok("VersoFormat loaded", true);

  var b64Url = "data:image/png;base64," + Buffer.from([1, 2, 3, 4, 250, 251, 252, 253]).toString("base64");
  var rawUrl = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>";
  var doc = { meta: { code: "C-1", title: "Fire Safety" }, pages: [{ blocks: [{ type: "image", src: "asset:aaa" }, { type: "image", src: "asset:bbb" }] }] };
  var assets = { aaa: { dataUrl: b64Url, mime: "image/png" }, bbb: { dataUrl: rawUrl, mime: "image/svg+xml" } };

  var pkg = VF.buildPackage(doc, assets, {});
  ok("buildPackage -> non-empty bytes", pkg instanceof Uint8Array && pkg.length > 0);

  var back = VF.readPackage(pkg);
  ok("manifest formatVersion", back.manifest.formatVersion === VF.FORMAT_VERSION);
  ok("manifest code+title", back.manifest.code === "C-1" && back.manifest.title === "Fire Safety");
  ok("doc round-trips deep-equal", JSON.stringify(back.doc) === JSON.stringify(doc));
  // CRITICAL: dataURLs must round-trip byte-identical, else content-hash ids drift + refs break.
  ok("base64 asset dataURL identical (stable id)", back.assets.aaa.dataUrl === b64Url);
  ok("raw (svg) asset dataURL identical (stable id)", back.assets.bbb.dataUrl === rawUrl);
  ok("asset mimes preserved", back.assets.aaa.mime === "image/png" && back.assets.bbb.mime === "image/svg+xml");

  // The package must be a STANDARD-COMPLIANT zip (external tools can open it).
  var os = require("os");
  var tmp = path.join(os.tmpdir(), "verso-fmt-test-" + process.pid + ".verso");
  fs.writeFileSync(tmp, Buffer.from(pkg));
  var uz = cp.spawnSync("unzip", ["-t", tmp], { encoding: "utf8" });
  ok("system `unzip -t` validates the package", uz.status === 0);
  try { fs.unlinkSync(tmp); } catch (e) {}

  var threw = false; try { VF.readPackage(new Uint8Array([1, 2, 3])); } catch (e) { threw = true; }
  ok("non-zip input rejected", threw);
})();

// ---- #69: clobber-proof migration core (browser -> file cutover) ----------
section("#69 migration cutover");
(function () {
  var t = src("src/migration.js");
  var win = {};
  new Function("window", t)(win);
  var M = win.Migration;
  if (!M || !M.run || !M.verifyRegistries) { ok("Migration loaded", false); return; }
  ok("Migration loaded", true);

  // verifyRegistries (pure read-back gate) --------------------------------
  var reg3 = JSON.stringify({ "C-1": { meta: { code: "C-1" } }, "C-2": { meta: { code: "C-2" } }, "C-3": { meta: { code: "C-3" } } });
  ok("verify identical -> ok", M.verifyRegistries(reg3, reg3).ok === true);
  ok("verify empty read-back -> fail", M.verifyRegistries(reg3, null).ok === false);
  ok("verify count mismatch -> fail", M.verifyRegistries(reg3, JSON.stringify({ "C-1": {}, "C-2": {} })).ok === false);
  ok("verify code mismatch -> fail", M.verifyRegistries(reg3, JSON.stringify({ "C-1": {}, "C-2": {}, "C-9": {} })).ok === false);
  ok("verify missing doc -> fail", M.verifyRegistries(reg3, JSON.stringify({ "C-1": {}, "C-2": {}, "C-3": null })).ok === false);
  ok("verify unparseable read-back -> fail", M.verifyRegistries(reg3, "{not json").ok === false);

  // Fakes: a browser source + a file store, with injectable failure hooks.
  function fakeBrowser(json) { return { readRegistry: function () { return json; } }; }
  function fakeFile(opts) {
    opts = opts || {};
    var stored = null, writes = 0;
    return {
      writeRegistry: function (json) { writes++; if (opts.failWrite) return { ok: false, error: "disk full" }; stored = json; return { ok: true }; },
      readRegistry: function () { return opts.corruptRead ? JSON.stringify({ "C-1": {} }) : stored; },
      _writes: function () { return writes; },
      _stored: function () { return stored; }
    };
  }
  // Independent suppression spy (don't rely on the module global across cases).
  function spySuppress() {
    var s = { on: false, suppressed: 0, resumed: 0 };
    return { s: s, suppress: function () { s.on = true; s.suppressed++; }, resume: function () { s.on = false; s.resumed++; } };
  }
  function goodBackup(reg) { return { ok: true, count: Object.keys(reg).length }; }

  // HAPPY PATH: read -> backup -> suppress -> write -> verify -> flip.
  (function () {
    var file = fakeFile(); var sp = spySuppress();
    var r = M.run(fakeBrowser(reg3), file, { backup: goodBackup, suppress: sp.suppress, resume: sp.resume });
    ok("happy: ok+flip", r.ok === true && r.flip === true);
    ok("happy: all 3 codes returned", r.codes.length === 3);
    ok("happy: target written with source json", file._stored() === reg3);
    ok("happy: saves SUPPRESSED and NOT resumed (stay off through reload)", sp.s.on === true && sp.s.resumed === 0);
  })();

  // BACKUP GATE: a failed backup aborts BEFORE any target write or suppression.
  (function () {
    var file = fakeFile(); var sp = spySuppress();
    var r = M.run(fakeBrowser(reg3), file, { backup: function () { return { ok: false, error: "backup dir unwritable" }; }, suppress: sp.suppress, resume: sp.resume });
    ok("backup fail: not ok, no flip", r.ok === false && r.flip === false && r.stage === "backup");
    ok("backup fail: target NEVER written", file._writes() === 0);
    ok("backup fail: saves never suppressed (browser stays live)", sp.s.on === false && sp.s.suppressed === 0);
  })();
  (function () {
    var file = fakeFile(); var sp = spySuppress();
    var r = M.run(fakeBrowser(reg3), file, { backup: function (reg) { return { ok: true, count: 1 }; }, suppress: sp.suppress, resume: sp.resume });
    ok("incomplete backup (1/3): abort, no write", r.ok === false && r.stage === "backup" && file._writes() === 0);
  })();

  // WRITE FAILURE: file store write fails -> abort, saves RESUMED (browser authoritative).
  (function () {
    var file = fakeFile({ failWrite: true }); var sp = spySuppress();
    var r = M.run(fakeBrowser(reg3), file, { backup: goodBackup, suppress: sp.suppress, resume: sp.resume });
    ok("write fail: not ok, no flip, stage=write", r.ok === false && r.flip === false && r.stage === "write");
    ok("write fail: saves RESUMED (rollback to browser)", sp.s.on === false && sp.s.resumed === 1);
  })();

  // VERIFY FAILURE: read-back drifts -> abort, saves RESUMED, no flip.
  (function () {
    var file = fakeFile({ corruptRead: true }); var sp = spySuppress();
    var r = M.run(fakeBrowser(reg3), file, { backup: goodBackup, suppress: sp.suppress, resume: sp.resume });
    ok("verify fail: not ok, no flip, stage=verify", r.ok === false && r.flip === false && r.stage === "verify");
    ok("verify fail: saves RESUMED (browser stays authoritative)", sp.s.on === false && sp.s.resumed === 1);
  })();

  // EMPTY SOURCE: nothing to migrate -> abort before backup/suppress.
  (function () {
    var file = fakeFile(); var sp = spySuppress();
    var r = M.run(fakeBrowser(null), file, { backup: goodBackup, suppress: sp.suppress, resume: sp.resume });
    ok("empty source: abort at read, nothing touched", r.ok === false && r.stage === "read" && file._writes() === 0 && sp.s.suppressed === 0);
  })();

  // IDEMPOTENT: a re-run into an already-migrated file store is a safe no-op-equivalent.
  (function () {
    var file = fakeFile(); var sp = spySuppress();
    M.run(fakeBrowser(reg3), file, { backup: goodBackup, suppress: sp.suppress, resume: sp.resume });
    var first = file._stored();
    var r2 = M.run(fakeBrowser(reg3), file, { backup: goodBackup, suppress: sp.suppress, resume: sp.resume });
    ok("re-run: still ok, store byte-identical", r2.ok === true && file._stored() === first);
  })();

  // DEFAULT GUARD: run() with no suppress/resume hooks toggles the real module guard;
  // on success it stays suppressed (fresh boot resets it).
  (function () {
    M.resume();
    ok("guard starts off", M.savesSuppressed() === false);
    M.run(fakeBrowser(reg3), fakeFile(), { backup: goodBackup });
    ok("guard on after successful run (until reload)", M.savesSuppressed() === true);
    M.resume();
  })();

  // ---- makeBackupFn: the HARD backup gate (pure, dep-injected) -----------
  (function () {
    // Fake VersoFormat: builds a non-empty package unless told to throw.
    var fakeVF = { buildPackage: function (d, a, m) { if (d && d.__boom) throw new Error("pack boom"); return new Uint8Array([1, 2, 3, 4]); } };
    function reg(n) { var r = {}; for (var i = 1; i <= n; i++) r["C-" + i] = { meta: { code: "C-" + i } }; return r; }
    function sink(opts) {
      opts = opts || {}; var files = {};
      return {
        files: files,
        writeFile: function (path, bytes) { if (opts.failAt && path.indexOf(opts.failAt) !== -1) return { ok: false, error: "disk full" }; files[path] = bytes; return { ok: true }; },
        verifySize: function (path) { return opts.corruptAt && path.indexOf(opts.corruptAt) !== -1 ? 0 : (files[path] ? files[path].length : 0); }
      };
    }
    // Happy path: 3 courses -> 3 verified .verso backups.
    var s = sink();
    var bf = M.makeBackupFn({ versoFormat: fakeVF, writeFile: s.writeFile, verifySize: s.verifySize, tsLabel: "T", collectAssets: function () { return {}; } });
    var r = bf(reg(3));
    ok("backup happy: ok + count 3", r.ok === true && r.count === 3);
    ok("backup happy: dir is pre-cutover-<ts>", r.dir === "backups/pre-cutover-T/");
    ok("backup happy: one .verso per course", Object.keys(s.files).length === 3 && !!s.files["backups/pre-cutover-T/C-2.verso"]);
    // Write failure mid-way -> abort with partial count, browser untouched (caller aborts).
    var s2 = sink({ failAt: "C-2" });
    var r2 = M.makeBackupFn({ versoFormat: fakeVF, writeFile: s2.writeFile, verifySize: s2.verifySize, tsLabel: "T" })(reg(3));
    ok("backup write fail: not ok, count 1", r2.ok === false && r2.count === 1);
    // Verify failure (0 bytes on disk) -> not ok (the 'verified written' gate).
    var s3 = sink({ corruptAt: "C-1" });
    var r3 = M.makeBackupFn({ versoFormat: fakeVF, writeFile: s3.writeFile, verifySize: s3.verifySize, tsLabel: "T" })(reg(2));
    ok("backup verify fail (0 bytes): not ok", r3.ok === false);
    // buildPackage throws -> not ok.
    var s4 = sink();
    var r4 = M.makeBackupFn({ versoFormat: fakeVF, writeFile: s4.writeFile, verifySize: s4.verifySize, tsLabel: "T" })({ "C-1": { __boom: true } });
    ok("backup build throw: not ok", r4.ok === false);
    // No sink / no VersoFormat -> not ok (never silently 'succeeds').
    ok("backup no sink: not ok", M.makeBackupFn({ versoFormat: fakeVF, tsLabel: "T" })(reg(1)).ok === false);
    ok("backup no VersoFormat: not ok", M.makeBackupFn({ writeFile: sink().writeFile, tsLabel: "T" })(reg(1)).ok === false);
    // End-to-end: makeBackupFn result feeds run()'s gate (count must match course count).
    var s5 = sink(); var sp = spySuppress();
    var rr = M.run(fakeBrowser(reg3), fakeFile(), {
      backup: M.makeBackupFn({ versoFormat: fakeVF, writeFile: s5.writeFile, verifySize: s5.verifySize, tsLabel: "T" }),
      suppress: sp.suppress, resume: sp.resume
    });
    ok("run + real makeBackupFn: ok + flip", rr.ok === true && rr.flip === true && Object.keys(s5.files).length === 3);

    // ASYNC backup gate (live path): awaits Promise-returning sinks.
    __async.push((async function () {
      var files = {};
      var okDeps = { versoFormat: fakeVF, tsLabel: "T",
        writeFile: function (p, b) { return Promise.resolve().then(function () { files[p] = b; return { ok: true }; }); },
        verifySize: function (p) { return Promise.resolve(files[p] ? files[p].length : 0); } };
      var ra = await M.runBackupsAsync(reg(3), okDeps);
      ok("runBackupsAsync happy: ok + count 3 + 3 files", ra.ok === true && ra.count === 3 && Object.keys(files).length === 3);
      var rb = await M.runBackupsAsync(reg(2), { versoFormat: fakeVF, tsLabel: "T",
        writeFile: function () { return Promise.resolve({ ok: false, error: "disk full" }); }, verifySize: function () { return Promise.resolve(9); } });
      ok("runBackupsAsync write fail: not ok", rb.ok === false && rb.count === 0);
      var rc = await M.runBackupsAsync(reg(1), { versoFormat: fakeVF, tsLabel: "T",
        writeFile: function () { return Promise.resolve({ ok: true }); }, verifySize: function () { return Promise.resolve(0); } });
      ok("runBackupsAsync verify fail (0 bytes): not ok", rc.ok === false);
    })());
  })();

  // WIRING: editor.js honours the guard at every save choke point; index.html loads it first.
  var ed = src("src/editor.js");
  ok("editor.js defines savesSuppressed via window.Migration", /function savesSuppressed\(\)\s*\{[\s\S]{0,160}window\.Migration[\s\S]{0,120}savesSuppressed\(\)/.test(ed));
  ok("saveRegistry early-returns when suppressed", /function saveRegistry\(r\)\s*\{\s*if \(savesSuppressed\(\)\) return false;/.test(ed));
  ok("scheduleSave early-returns when suppressed", /function scheduleSave\(\)\s*\{\s*if \(savesSuppressed\(\)\) return;/.test(ed));
  ok("flushSave early-returns when suppressed", /function flushSave\(\)\s*\{\s*if \(savesSuppressed\(\)\) return;/.test(ed));
  // WIRING: the guarded cutover orchestrator -- async, preconditions, backup-gate,
  // suppress, disk write+verify, flip-only-after-verify.
  ok("migrateToFileBackend is async", /async function migrateToFileBackend\(opts\)/.test(ed));
  ok("migrateToFileBackend requires the browser backend", /async function migrateToFileBackend\(opts\)[\s\S]{0,700}backend !== "browser"[\s\S]{0,80}return fail\("precondition"/.test(ed));
  ok("migrateToFileBackend requires the native store glue", /if \(!ns\) return fail\("precondition", "native file storage is not available/.test(ed));
  ok("migrateToFileBackend backup-gates before suppress", /window\.Migration\.runBackupsAsync\(src[\s\S]{0,700}bk\.count !== codes\.length[\s\S]{0,300}window\.Migration\.suppress\(\)/.test(ed));
  ok("migrateToFileBackend writes then verifies from disk", /await putRegistry\(srcJson\)[\s\S]{0,400}await getRegistry\(\)[\s\S]{0,200}window\.Migration\.verifyRegistries\(srcJson, back\)/.test(ed));
  ok("migrateToFileBackend flips flag ONLY after verify passes", /if \(!v\.ok\) \{ window\.Migration\.resume\(\); return fail\("verify"[\s\S]{0,500}setFlag\("file"\)/.test(ed));
  ok("migrateToFileBackend resumes saves on write/verify failure", /window\.Migration\.resume\(\); return fail\("write"[\s\S]{0,600}window\.Migration\.resume\(\); return fail\("verify"/.test(ed));
  ok("Editor exposes migrateToFileBackend", /migrateToFileBackend: migrateToFileBackend/.test(ed));
  // WIRING: the guarded menu item -- DS confirmModal, registered ONLY with the native store.
  ok("migrate prompt uses the DS confirmModal (not bespoke chrome)", /function migrateToFileBackendPrompt\(\)[\s\S]{0,200}confirmModal\("Migrate to file storage"/.test(ed));
  ok("migrate button registered only when __nativeStore present", /if \(window\.__nativeStore\) window\.Editor\.registerPipelineButton\("Migrate to file storage \(beta\)", migrateToFileBackendPrompt/.test(ed));
  // WIRING: the Swift bridge grew the ops the native store glue posts.
  var swift = src("desktop/AuthoringTool.swift");
  ["storePutRegistry", "storeGetRegistry", "storePutBackupB64", "storeFileSize", "storeReload"].forEach(function (op) {
    ok("Swift handleBackup handles op " + op, swift.indexOf('op == "' + op + '"') !== -1);
  });
  ok("Swift injects the on-disk registry at document-start", /addUserScript\(registryInjectionScript\(\)\)/.test(swift) && /window\.__versoDiskRegistryB64/.test(swift));
  ok("Swift reload refreshes the registry injection", /@objc func reload\(\) \{ refreshRegistryInjection\(\)/.test(swift));
  ok("Swift storePath rejects absolute / parent-escape paths", /func storePath[\s\S]{0,160}hasPrefix\("\/"\)[\s\S]{0,40}contains\("\.\."\)/.test(swift));
  // REGRESSION: editor.js's __versoBackupReply must CHAIN store-native's, not clobber it.
  ok("editor.js chains a prior __versoBackupReply owner", /__prevBackupReply = window\.__versoBackupReply[\s\S]{0,320}typeof __prevBackupReply === "function"\) __prevBackupReply\(id, result\)/.test(ed));
  var html = src("index.html");
  ok("index.html loads migration.js before editor.js", html.indexOf("src/migration.js") !== -1 && html.indexOf("src/migration.js") < html.indexOf("src/editor.js"));
  ok("index.html loads store-native.js before editor.js", html.indexOf("src/store-native.js") !== -1 && html.indexOf("src/store-native.js") < html.indexOf("src/editor.js"));

  // ---- store-native.js: inert without bridge; confirmed writes with it ---
  (function () {
    // No bridge -> the adapter is never installed (browser backend only).
    var w1 = {};
    new Function("window", src("src/store-native.js"))(w1);
    ok("store-native inert without bridge (no __storageAdapter)", !w1.__storageAdapter);
    // With a fake bridge -> a 'file' adapter that posts storePutRegistry + confirms.
    var posted = [];
    var w2 = {
      webkit: { messageHandlers: { versoBackup: { postMessage: function (m) { posted.push(m); } } } },
      __versoDiskRegistryB64: null,
      TextDecoder: TextDecoder, TextEncoder: TextEncoder, atob: function (b) { return Buffer.from(b, "base64").toString("binary"); }, btoa: function (s) { return Buffer.from(s, "binary").toString("base64"); }
    };
    new Function("window", src("src/store-native.js"))(w2);
    ok("store-native installs a 'file' adapter with a bridge", !!w2.__storageAdapter && w2.__storageAdapter.name === "file");
    // REGRESSION (real load order): editor.js installs its OWN __versoBackupReply AFTER
    // store-native. It MUST chain, not clobber, or every native-store reply is lost and the
    // #69 migration hangs. Simulate editor's chaining wrapper; all replies below route through it.
    (function installEditorReplyChain() {
      var editorPending = {}; var prev = w2.__versoBackupReply;
      w2.__versoBackupReply = function (id, r) { var p = editorPending[id]; if (p) { delete editorPending[id]; p(r); return; } if (typeof prev === "function") prev(id, r); };
    })();
    var wr = w2.__storageAdapter.writeRegistry('{"C-1":{}}');
    ok("writeRegistry returns ok + caches synchronously", wr.ok === true && w2.__storageAdapter.readRegistry() === '{"C-1":{}}');
    ok("writeRegistry posts storePutRegistry with a reqId", posted.length === 1 && posted[0].op === "storePutRegistry" && typeof posted[0].reqId === "string");
    // A failed disk reply surfaces via Editor.reportSaveFailure (not lost fire-and-forget).
    var failMsg = null; w2.Editor = { reportSaveFailure: function (m) { failMsg = m; } };
    w2.__versoBackupReply(posted[0].reqId, { ok: false, error: "disk full" });
    ok("failed disk write surfaces through reportSaveFailure", !!failMsg && /NOT durably saved/.test(failMsg));
    // A prior __versoBackupReply owner is chained, not clobbered.
    var w3 = {
      webkit: { messageHandlers: { versoBackup: { postMessage: function () {} } } },
      __versoBackupReply: function (id, o) { w3.__seen = id; },
      TextDecoder: TextDecoder, TextEncoder: TextEncoder, atob: w2.atob, btoa: w2.btoa
    };
    new Function("window", src("src/store-native.js"))(w3);
    w3.__versoBackupReply("someOtherOp:1", { ok: true });
    ok("store-native chains a prior __versoBackupReply owner", w3.__seen === "someOtherOp:1");

    // __nativeStore async glue: the live deps for Editor.migrateToFileBackend. Driven
    // LAST so its request()->reply posts don't perturb the sync writeRegistry checks above.
    var ns = w2.__nativeStore;
    ok("store-native exposes __nativeStore with the live deps", !!ns && ["putRegistry", "getRegistry", "writeFile", "verifySize", "reload", "tsLabel"].every(function (k) { return typeof ns[k] === "function"; }));
    ok("tsLabel is a filesystem-safe timestamp", /^\d{8}-\d{6}$/.test(ns.tsLabel()));
    __async.push((async function () {
      var pv = ns.verifySize("backups/pre-cutover-T/C-1.verso");
      var lv = posted[posted.length - 1];
      ok("verifySize posts storeFileSize with a store-relative path", lv.op === "storeFileSize" && lv.path === "backups/pre-cutover-T/C-1.verso");
      w2.__versoBackupReply(lv.reqId, { ok: true, size: 42 });
      ok("verifySize resolves the on-disk size", (await pv) === 42);
      var pw = ns.writeFile("backups/pre-cutover-T/C-1.verso", new Uint8Array([1, 2, 3, 250]));
      var lw = posted[posted.length - 1];
      ok("writeFile posts storePutBackupB64 with base64 bytes", lw.op === "storePutBackupB64" && typeof lw.b64 === "string" && lw.b64.length > 0);
      w2.__versoBackupReply(lw.reqId, { ok: true, size: 4 });
      ok("writeFile resolves { ok, size }", (function (r) { return r.ok === true && r.size === 4; })(await pw));
      var pg = ns.getRegistry();
      var lg = posted[posted.length - 1];
      w2.__versoBackupReply(lg.reqId, { ok: true, text: '{"A":{}}' });
      ok("getRegistry resolves the on-disk text", (await pg) === '{"A":{}}');
    })());
  })();
})();

// ---- YY: asset walk helpers + store --------------------------------------
section("YY asset-seam");
(function () {
  var rtxt = src("src/render.js");
  var block = rtxt.slice(rtxt.indexOf("var ASSET_RE"), rtxt.lastIndexOf("})();"));
  var rw = {};
  new Function("window", block)(rw);
  var doc = {
    chrome: { header: { logo: "asset:LOGO" } },
    pages: [{ blocks: [
      { type: "image", src: "asset:IMG1", alt: "keep" },
      { type: "group", children: [{ src: "asset:IMG2" }] },
      { type: "columns", columns: [[{ srcLight: "asset:L", srcDark: "asset:D" }]] },
      { hotspots: [{ screen: "asset:HS" }, { screen: "https://x/a.png" }] },
      { localVideo: "asset:VID" }
    ] }]
  };
  var restore = rw.resolveMedia(doc, function (id) { return "URL:" + id; });
  ok("resolve logo", doc.chrome.header.logo === "URL:LOGO");
  ok("resolve deep child", doc.pages[0].blocks[1].children[0].src === "URL:IMG2");
  ok("resolve columns", doc.pages[0].blocks[2].columns[0][0].srcDark === "URL:D");
  ok("resolve hotspot", doc.pages[0].blocks[3].hotspots[0].screen === "URL:HS");
  ok("http untouched", doc.pages[0].blocks[3].hotspots[1].screen === "https://x/a.png");
  restore();
  ok("restore refs", doc.chrome.header.logo === "asset:LOGO" && doc.pages[0].blocks[4].localVideo === "asset:VID");
  ok("collectAssetRefs", rw.collectAssetRefs(doc).sort().join(",") === "D,HS,IMG1,IMG2,L,LOGO,VID");
  var md = { pages: [{ blocks: [{ src: "data:image/png;base64,AAA" }, { src: "data:img,FAILME" }, { src: "asset:x" }] }] };
  var mr = rw.migrateDocMedia(md, function (d) { return d.indexOf("FAILME") !== -1 ? null : "hoisted"; });
  ok("migrate count", mr.migrated === 1 && mr.failed === 1);
  ok("migrate success->ref", md.pages[0].blocks[0].src === "asset:hoisted");
  ok("migrate fail keeps data:", md.pages[0].blocks[1].src === "data:img,FAILME");

  // embed-html hoist (quota/data-loss reroute): raw htmlEmbed markup must leave
  // the doc JSON as an "asset:<id>" ref; already-ref/URL html + non-embeds untouched;
  // a failed put is left raw (non-destructive); round-trips back to raw via resolveEmbedHtml.
  var ed = { pages: [{ blocks: [
    { type: "htmlEmbed", html: "<b>hi</b>" },
    { type: "htmlEmbed", html: "asset:existing" },
    { type: "htmlEmbed", html: "https://x/a.html" },
    { type: "htmlEmbed", html: "<b>FAILME</b>" },
    { type: "text", html: "<p>not an embed</p>" }
  ] }] };
  var puts = [];
  var er = rw.migrateDocEmbedHtml(ed, function (d) { puts.push(d); return d.indexOf("FAILME") !== -1 ? null : "hoisted"; });
  ok("embed hoist count", er.migrated === 1 && er.failed === 1);
  ok("embed raw -> asset ref", ed.pages[0].blocks[0].html === "asset:hoisted");
  ok("embed put got data:text/html", puts[0].slice(0, 15) === "data:text/html;");
  ok("embed asset ref untouched", ed.pages[0].blocks[1].html === "asset:existing");
  ok("embed url untouched", ed.pages[0].blocks[2].html === "https://x/a.html");
  ok("embed fail keeps raw", ed.pages[0].blocks[3].html === "<b>FAILME</b>");
  ok("non-embed html untouched", ed.pages[0].blocks[4].html === "<p>not an embed</p>");
  ok("embed hoist round-trips", decodeURIComponent(puts[0].slice(puts[0].indexOf(",") + 1)) === "<b>hi</b>");

  // store
  var ptxt = src("src/persist.js");
  var pe = ptxt.indexOf("placeholder: PLACEHOLDER"); pe = ptxt.indexOf("};", pe) + 2;
  var pblock = ptxt.slice(ptxt.indexOf("var ASSET_KEY"), pe);
  var lsStore = {}, failNext = false;
  var fakeLS = { getItem: function (k) { return k in lsStore ? lsStore[k] : null; }, setItem: function (k, v) { if (failNext) { var e = new Error("full"); e.name = "QuotaExceededError"; throw e; } lsStore[k] = v; } };
  var n = 0, fakeURL = { createObjectURL: function () { return "blob:" + (++n); }, revokeObjectURL: function () {} };
  var pw = { Editor: { reportSaveFailure: function () {} }, console: console };
  new Function("window", "localStorage", "URL", "Blob", "atob", pblock)(pw, fakeLS, fakeURL, function () {}, function (s) { return Buffer.from(s, "base64").toString("binary"); });
  var AS = pw.AssetStore;
  var id = AS.put("data:image/png;base64,AAAA", { mime: "image/png" });
  ok("put id + dedupe", !!id && AS.put("data:image/png;base64,AAAA", {}) === id);
  var svg = AS.put("data:image/svg+xml;utf8,<svg/>", { mime: "image/svg+xml" });
  ok("svg url -> data:", AS.url(svg).slice(0, 5) === "data:");
  ok("raster url -> blob:", AS.url(id).slice(0, 5) === "blob:");
  failNext = true;
  var realErr = console.error; console.error = function () {}; // expected quota log
  ok("quota put -> null", AS.put("data:image/png;base64,BBBB", {}) === null);
  console.error = realErr;
  failNext = false;
  AS.sweep([svg]);
  ok("sweep removes unref", !AS.has(id) && AS.has(svg));
})();

// ---- assetSrc resolver hook ----------------------------------------------
section("assetSrc hook");
(function () {
  var t = src("src/render.js");
  var m = t.match(/function assetSrc\(v\)\s*\{[\s\S]*?\n  \}/);
  var win = {};
  var fn = new Function("window", m[0] + "\nreturn assetSrc;")(win);
  ok("no resolver -> ref unchanged", fn("asset:ABC") === "asset:ABC");
  win.__assetResolver = function (id) { return "URL:" + id; };
  ok("maps asset:id", fn("asset:ABC") === "URL:ABC");
  ok("http passthrough", fn("https://x/y.png") === "https://x/y.png");
  ok("undefined safe", fn(undefined) === undefined);
  win.__assetResolver = function () { return null; };
  ok("null result keeps ref", fn("asset:X") === "asset:X");
})();

// ---- custom marker: HTML-animation sanitiser ------------------------------
section("hotspot marker html sanitise");
(function () {
  var t = src("src/render.js");
  var m = t.match(/function sanitizeMarkerHtml\(html\)\s*\{[\s\S]*?\n  \}/);
  var fn = new Function(m[0] + "\nreturn sanitizeMarkerHtml;")();
  var dirty = '<!doctype html><head><style>.a{color:red}</style>'
    + '<link rel="stylesheet" href="x.css"></head><body>'
    + '<svg onload="hack()"><rect onclick=\'bad()\'/></svg>'
    + '<script src="https://unpkg.com/react.js"></script>'
    + '<script type="text/babel">ReactDOM.render()<\/script></body>';
  var clean = fn(dirty);
  ok("drops <script> (external + inline)", clean.indexOf("<script") === -1 && clean.indexOf("unpkg") === -1);
  ok("drops external <link>", clean.indexOf("<link") === -1);
  ok("drops on* handlers (dq/sq/unquoted)", !/\son\w+\s*=/i.test(clean));
  ok("keeps <style> + <svg> markup", clean.indexOf("<style>") !== -1 && clean.indexOf("<svg") !== -1 && clean.indexOf("<rect") !== -1);
  ok("non-string -> empty", fn(null) === "" && fn(undefined) === "");
  // render wires an HTML marker into a sandboxed, script-less srcdoc iframe
  ok("marker iframe is sandboxed no-scripts", /setAttribute\("sandbox", "allow-same-origin"\)/.test(t) && /setAttribute\("srcdoc", markerSrcdoc\(block\.markerHtml\)\)/.test(t));
  // markerSrcdoc appends a transparency reset so opaque author backgrounds don't
  // paint a white box behind the animated-SVG icon over the course art.
  var mSd = t.match(/function markerSrcdoc\(html\)\s*\{[\s\S]*?\n  \}/);
  var srcdoc = new Function(mSd[0] + m[0] + "\nreturn markerSrcdoc;")();
  var out = srcdoc('<body style="background:#fff"><svg><rect fill="orange"/></svg></body>');
  ok("srcdoc forces html/body/svg transparent (kills white box)", /html,body\{background:transparent !important/.test(out) && /svg\{background:transparent !important/.test(out) && out.indexOf("<svg>") !== -1);
  ok("srcdoc reset appended LAST (wins cascade)", out.lastIndexOf("<style>") > out.indexOf("<svg>"));
  ok("srcdoc empty in -> empty out", srcdoc(null) === "" && srcdoc("") === "");
  // selective viewed-recolour: only KEY (saturated) paints tagged; neutrals excluded
  ok("markerSvgNode tags key paints (not neutrals)", /markerAddClass\(n, "hs-key-fill"\)/.test(t) && /markerAddClass\(n, "hs-key-stroke"\)/.test(t) && /!isNeutralColor\(f\)/.test(t) && /!isNeutralColor\(s\)/.test(t));
  // markerSvgNode neutralises a baked-in full-canvas backplate (usually white) so the
  // lone animated-SVG marker sits transparent over the course image. Geometric detection
  // (fullCanvasBgEls) + NEUTRAL-only guard (a saturated full-bleed disc is spared).
  var mNode = t.match(/function markerSvgNode\(ref\)\s*\{[\s\S]*?\n  \}/);
  ok("markerSvgNode strips neutral full-canvas backplate", /fullCanvasBgEls\(svg\)\.forEach/.test(mNode[0]) && /isNeutralColor\(f\)/.test(mNode[0]) && /el\.setAttribute\("fill", "none"\)/.test(mNode[0]));
  ok("backplate strip is neutral-scoped (saturated disc kept)", /if \(!f \|\| !isNeutralColor\(f\)\) return;/.test(mNode[0]));
})();

// ---- custom marker: HTML-animation key-colour green (runtime accent flip) --
section("hotspot marker viewed recolour");
(function () {
  var rt = src("src/runtime.js");
  ok("tintMarkerViewed defined", /function tintMarkerViewed\(mk\)/.test(rt));
  ok("recolours only saturated paints to --hotspot-viewed", /function markerIsSaturated\(c\)/.test(rt) && /getComputedStyle\(mk\)\.getPropertyValue\("--hotspot-viewed"\)/.test(rt) && /if \(markerIsSaturated\(cs\.fill\)\) n\.style\.setProperty\("fill", green, "important"\)/.test(rt) && /markerIsSaturated\(cs\.stroke\)/.test(rt));
  ok("neutral threshold matches render (0.18)", /s >= 0\.18/.test(rt));
  ok("retries on frame load", /fr\.addEventListener\("load", apply\)/.test(rt));
  ok("called at both viewed sites (popover + screen)", (rt.match(/tintMarkerViewed\(m\w*\)/g) || []).length >= 2);
  // export bundles runtime.js (so the accent-flip ships in SCORM)
  var ex = src("src/export.js");
  ok("export bundles runtime.js", /fetchText\("src\/runtime\.js"\)[\s\S]*?textFile\("runtime\.js"/.test(ex));
  // course.css no longer hue-tints the whole frame; recolours via .hs-key + var-flip
  var css = src("src/course.css");
  ok("svg viewed targets .hs-key-fill/.hs-key-stroke", /\.hotspot-marker--custom\.is-viewed \.hs-key-fill/.test(css) && /\.hotspot-marker--custom\.is-viewed \.hs-key-stroke/.test(css));
  ok("no whole-frame hue filter on viewed", css.indexOf("hue-rotate(75deg)") === -1);
})();

// ---- #146: base-image sizing + full-width stage + margin-aware popover -------
section("#146 hotspot base-image size + margin popover");
(function () {
  var r = src("src/render.js");
  // Stage stays full width; image + markers move into a sized, centred .hotspot-frame.
  ok("render: introduces a .hotspot-frame inside the stage", /var frame = el\("div", "hotspot-frame"\);[\s\S]*?stage\.appendChild\(frame\);/.test(r));
  ok("render: imgWidth -> --hotspot-img-width on the frame", /var imgW = \(block\.imgWidth == null \? 100 : block\.imgWidth\);[\s\S]*?frame\.style\.setProperty\("--hotspot-img-width", imgW \+ "%"\)/.test(r));
  ok("render: base image appended to the FRAME (not the stage)", /frame\.appendChild\(visualNode\(entry, "hotspot-image", true\)\);/.test(r) && /img\.className = cls;[\s\S]*?img\.src = assetSrc\(scr\.visual\)/.test(r)); // #217: shared visualNode(scr, cls, recolor) emits img/svg/<video>
  ok("render: markers appended to their screen container (frame or panel)", /container\.appendChild\(mk\);/.test(r)); // #216: shared renderMarkers(scr, container)
  ok("render: popover appended to the STAGE (can open into the margin)", /stage\.appendChild\(pop\);/.test(r));
  ok("render: back (in nav) wrapped in .hotspot-nav, placed in the chrome band (#52)", /nav\.appendChild\(back\);[\s\S]*?chrome\.appendChild\(nav\);/.test(r) && /topbar\.appendChild\(counter\);/.test(r)); // #216 wrap; nav below, counter in the top band above

  var css = src("src/course.css");
  ok("css: .hotspot-frame sizes via --hotspot-img-width and centres", /\.hotspot-frame \{[^}]*max-width: var\(--hotspot-img-width, 100%\);[^}]*margin-inline: auto;/.test(css));
  ok("css: stage overflow visible (margin popover not clipped)", /\.hotspot-stage \{[^}]*overflow: visible;/.test(css));

  var rt = src("src/runtime.js");
  ok("runtime: positionPopover anchors in layout coords (zoom-safe, frame offset + marker %)", /var frame = marker\.closest \? marker\.closest\("\.hotspot-frame"\) : null;[\s\S]*?var ax = fx \+ mx \/ 100 \* fw;/.test(rt));
  ok("runtime: does NOT mix getBoundingClientRect with clientWidth for the anchor", !/mrect\.left/.test(rt));
  ok("runtime: auto placement prefers the empty margin beside the image", /var leftMargin = fx, rightMargin = sw - \(fx \+ fw\);[\s\S]*?marginFits \? toward/.test(rt));

  var e = src("src/editor.js");
  ok("editor: marker drag is relative to the frame (correct at any width)", /mk\.closest && mk\.closest\("\.hotspot-frame"\) \|\| stage\)\.getBoundingClientRect\(\)/.test(e));
  ok("editor: inspector exposes a base-image width control writing block.imgWidth", /if \(isNaN\(n\) \|\| n >= 100\) delete block\.imgWidth; else block\.imgWidth = Math\.max\(20, n\)/.test(e));
})();

section("#48 box (region) hotspot marker");
(function () {
  var r = src("src/render.js"), css = src("src/course.css"), e = src("src/editor.js"), ecss = src("editor.css");
  // render: a box marker renders as a sized region (transparent, no glyph), not a point badge.
  ok("render: shape==box adds .hotspot-marker--box + inline w/h %", /if \(hs\.shape === "box"\) \{[\s\S]*?mk\.classList\.add\("hotspot-marker--box"\);[\s\S]*?mk\.style\.width = \(hs\.w == null \? 20 : hs\.w\) \+ "%";[\s\S]*?mk\.style\.height = \(hs\.h == null \? 12 : hs\.h\) \+ "%";/.test(r));
  ok("render: box branch bypasses the glyph/custom marker path (else-if)", /if \(hs\.shape === "box"\) \{[\s\S]*?mk\.classList\.add\("hotspot-marker--box"\);[\s\S]*?\} else if \(block\.markerHtml\)/.test(r));
  ok("render: shared hotspotMarkerEl builds the learner marker + is exposed", /function hotspotMarkerEl\(block, hs, i, loopById\)[\s\S]*?return mk;\s*\}\s*window\.hotspotMarkerEl = hotspotMarkerEl;/.test(r) && /var mk = hotspotMarkerEl\(block, hs, i, loopById\);/.test(r));
  // css: transparent fill, accent outline, keeps the pulse ring, never adds a fill when viewed.
  ok("css: .hotspot-marker--box is transparent with an accent border", /\.hotspot-marker--box \{[^}]*border: 2px solid var\(--hotspot-color\);[^}]*background: transparent;/.test(css));
  ok("css: box viewed recolours the outline only (no fill)", /\.hotspot-marker--box\.is-viewed \{ background: transparent; border-color: var\(--hotspot-viewed/.test(css));
  // editor: inspector Shape control + W/H fields; box seeds default 20x12.
  ok("editor: inspector Shape control writes marker.shape=box + seeds w/h", /segmentedLive\("Shape", \[\["Point", "point"\], \["Box \(region\)", "box"\]\][\s\S]*?active\.shape = "box"; if \(active\.w == null\) active\.w = 20; if \(active\.h == null\) active\.h = 12;/.test(e));
  // editor: both resize surfaces write m.w/m.h (tour board) and hs.w/hs.h (canvas), doubled from centre.
  ok("editor: tour-board box resize sets m.w/m.h from centre", /function tourBeginPinResize[\s\S]*?m\.w = Math\.max\(2, Math\.min\(100, Math\.round\(\(px - cx\) \* 2\)\)\);/.test(e));
  ok("editor: on-canvas box resize handle sets hs.w/hs.h", /hs\.shape === "box" && !mk\.querySelector\("\.hotspot-resize"\)[\s\S]*?hs\.w = Math\.max\(2, Math\.min\(100, Math\.round\(\(px - cx\) \* 2\)\)\);/.test(e));
  ok("editor.css: box pin + resize handles styled (chrome only)", /\.tourb-pin--box \{/.test(ecss) && /\.tourb-pin__resize \{/.test(ecss) && /\.hotspot-resize \{/.test(ecss));
})();

section("#49 mix card + navigate hotspots (per-marker action)");
(function () {
  var e = src("src/editor.js");
  // per-hotspot Action toggle in the Selected-hotspot inspector (the real truth).
  ok("editor: per-hotspot Action segmented control sets marker.action", /segmentedLive\("Action", \[\["Card popover", "card"\], \["Navigate", "navigate"\]\][\s\S]*?active\.action = \(v === "navigate"\) \? "navigate" : "card";/.test(e));
  // block.mode demoted to a default-only hint: switching it must NOT bulk-rewrite markers.
  ok("editor: mode is 'Default for new hotspots' (relabelled)", /insp-row__label--stacked", "Default for new hotspots"/.test(e));
  ok("editor: switching the default no longer rewrites every marker.action", !/if \(v === "screen"\) block\.mode = "screen"; else delete block\.mode;\s*\n\s*curScreen\.markers\.forEach\(function \(m\) \{ if \(m\) m\.action =/.test(e));
  // nav chrome + card appearance show for a MIXED tour (any nav marker / any card marker),
  // not only when the block default matches.
  ok("editor: nav chrome shows when any hotspot navigates", /var hasNavMarker = \(block\.screens[\s\S]*?if \(block\.mode === "screen" \|\| hasNavMarker\) \{/.test(e));
  ok("editor: overlay-card appearance shows when any hotspot is a card", /var hasCardMarker = \(block\.screens[\s\S]*?if \(block\.mode !== "screen" \|\| hasCardMarker\) \{/.test(e));
  // render + runtime already honour per-marker action (no block.mode read) -> mixing works live.
  var r = src("src/render.js");
  ok("render: marker data-action comes from the marker, not block.mode", /mk\.setAttribute\("data-action", hs\.action === "navigate" \? "navigate" : "card"\)/.test(r));
})();

section("#52 tour nav + progress outside the screen frame");
(function () {
  var r = src("src/render.js"), css = src("src/course.css");
  // render: a .hotspot-chrome band is appended to the STAGE (below the frame); nav + counter go IN it.
  ok("render: chrome band appended to the stage after the frame", /stage\.appendChild\(frame\);[\s\S]*?var chrome = el\("div", "hotspot-chrome"\);\s*stage\.appendChild\(chrome\);/.test(r));
  ok("render: nav goes in the chrome band; neither nav nor counter is in the frame", /chrome\.appendChild\(nav\)/.test(r) && !/frame\.appendChild\(nav\)/.test(r) && !/frame\.appendChild\(counter\)/.test(r));
  // css: band is a below-frame flex row; nav + counter are NO LONGER absolutely positioned.
  ok("css: .hotspot-chrome is a below-frame flex band that collapses when empty", /\.hotspot-chrome \{[^}]*display: flex;[^}]*margin-top: 10px;/.test(css) && /\.hotspot-chrome:empty \{ display: none; \}/.test(css));
  ok("css: .hotspot-nav no longer position:absolute", /\.hotspot-nav \{ display: flex; gap: 8px; \}/.test(css));
  ok("css: .hotspot-counter flows (no absolute), pushed right", /\.hotspot-counter \{\s*margin-left: auto;/.test(css) && !/\.hotspot-counter \{\s*position: absolute/.test(css));
})();

section("#53 reveal hotspots after a play-once video ends");
(function () {
  var r = src("src/render.js"), css = src("src/course.css"), rt = src("src/runtime.js"), e = src("src/editor.js");
  // render: markers on a video+once+revealAfterEnd screen start gated (hidden).
  ok("render: gates markers on a play-once reveal-after-end screen", /scr\.kind === "video" && scr\.playback === "once" && scr\.revealAfterEnd[\s\S]*?mk\.classList\.add\("hotspot-marker--gated"\);/.test(r));
  ok("css: gated marker hidden until .is-revealed", /\.hotspot-marker--gated \{ opacity: 0; pointer-events: none;[\s\S]*?\.hotspot-marker--gated\.is-revealed \{ opacity: 1; pointer-events: auto; \}/.test(css));
  // runtime: reveal on video ended; reduced-motion reveals up front (no stranding).
  ok("runtime: video 'ended' reveals gated markers in the video's host", /function hsRevealGated\(\)[\s\S]*?qsAll\(host, "\.hotspot-marker--gated"\)\.forEach\(function \(m\) \{ m\.classList\.add\("is-revealed"\); \}\)/.test(rt));
  ok("runtime: reveals gated markers on 'ended' AND up front for reduced motion", /v\.addEventListener\("ended", function \(\) \{[\s\S]*?hsRevealGated\(\);[\s\S]*?if \(hsReduce\(\)\) hsRevealGated\(\);/.test(rt));
  // editor: inspector toggle (once-only) + poster seeks to the LAST frame.
  ok("editor: inspector offers a reveal-after-end toggle for play-once video", /switchRow\("Reveal hotspots after it ends", function \(\) \{ return !!curScreen\.revealAfterEnd;/.test(e));
  ok("editor: tour poster seeks to the last frame before capture", /var last = Math\.max\(0, dur - 0\.05\);[\s\S]*?v\.currentTime = last;/.test(e));
  // authoring visibility: gated markers are opacity:0 at runtime but must be visible (dimmed) on
  // the editing canvas so the author can place them -- scoped to #canvas-viewport so it does not
  // leak into Demo / the tour Preview (which show the true reveal-after-video behaviour).
  var ecss = src("editor.css");
  ok("editor.css: gated markers shown dimmed on the editing canvas only", /#canvas-viewport \.hotspot-marker--gated \{ opacity: 0\.5;[^}]*outline: 1px dashed/.test(ecss));
})();

section("#55 video vs image tour-node badge");
(function () {
  var e = src("src/editor.js"), ecss = src("editor.css");
  ok("editor: renderTourNodes adds a video badge for kind==video", /if \(s\.kind === "video"\) \{ var vbadge = h\("span", "tourb-node__badge tourb-node__badge--video"\)[\s\S]*?window\.Icon\("play"\)/.test(e));
  ok("editor.css: .tourb-node__badge--video styled at a free corner", /\.tourb-node__badge--video \{[^}]*bottom: var\(--space-2\);[^}]*left: var\(--space-2\);/.test(ecss));
})();

section("#54 hover a video tour-node to scrub");
(function () {
  var e = src("src/editor.js");
  ok("editor: video board branch wires hover-scrub", /thumb\.appendChild\(v\); tourWireHoverScrub\(thumb, src\);/.test(e));
  ok("editor: hover brings a live video back and scrubs X->currentTime", /function tourWireHoverScrub\(thumb, src\)[\s\S]*?thumb\.replaceChild\(v, poster\);[\s\S]*?var frac = Math\.max\(0, Math\.min\(1, \(e\.clientX - r\.left\) \/ r\.width\)\);[\s\S]*?v\.currentTime = frac \* dur;/.test(e));
  ok("editor: only one node scrubs at a time (restore previous on enter)", /if \(tourScrubNode && tourScrubNode !== thumb\) tourRestoreScrub\(tourScrubNode\);/.test(e));
  ok("editor: leave restores the cached poster", /thumb\.addEventListener\("pointerleave", function \(\) \{ tourRestoreScrub\(thumb\); \}\)/.test(e) && /if \(thumb\.__scrubPoster\) thumb\.replaceChild\(thumb\.__scrubPoster, v\)/.test(e));
  ok("editor: board rebuild drops the stale scrub reference", /tourScrubNode = null; \/\/ #54/.test(e));
})();

section("WYSIWYG: tour board renders the REAL learner marker");
(function () {
  var e = src("src/editor.js"), r = src("src/render.js");
  // board markers = the shared render.js builder (identical to the learner), not abstract pins.
  ok("editor: board markers built via window.hotspotMarkerEl (real learner marker)", /var pin = window\.hotspotMarkerEl\(tourBlock, m, mi, loopById\);/.test(e));
  ok("editor: course theme applied to the thumb so markers resolve real colours", /window\.applyTheme\(thumb, activeTheme\(\)\); thumb\.setAttribute\("data-mode", activeMode\);/.test(e));
  ok("editor: fixed-px point markers scaled to the thumb; boxes are %-sized (unscaled)", /if \(!isBox\) pin\.style\.setProperty\("--hotspot-size", \(\(tourBlock\.markerSize \|\| 34\) \* TOUR_NODE_W \/ TOUR_NOMINAL_W\)/.test(e));
  ok("editor: board marker carries .tourb-marker + selection + data-pin (drag/resize/connect intact)", /pin\.classList\.add\("tourb-marker"\);[\s\S]*?if \(hotspotEditId === m\.id\) pin\.classList\.add\("is-selected"\);[\s\S]*?pin\.setAttribute\("data-pin", m\.id\);/.test(e));
  // the shared builder is the single source of the marker DOM (editor == learner).
  ok("render: hotspotMarkerEl is the shared marker builder used by renderMarkers", /window\.hotspotMarkerEl = hotspotMarkerEl;/.test(r) && /var mk = hotspotMarkerEl\(block, hs, i, loopById\);/.test(r));
})();

section("hotspot chrome: caption + video progress + nav toggle + counter placement");
(function () {
  var r = src("src/render.js"), css = src("src/course.css"), rt = src("src/runtime.js"), e = src("src/editor.js");
  // caption: an updating below-screen line; per-screen text rides the DOM; runtime syncs on nav.
  ok("render: caption emitted (entry text) when any screen has one", /screens\.some\(function \(s\) \{ return s && s\.caption; \}\)[\s\S]*?el\("div", "hotspot-caption", entry\.caption \|\| ""\)/.test(r));
  ok("render: per-screen caption rides the DOM (panel + entry attrs)", /panel\.setAttribute\("data-screen-caption", s\.caption\)/.test(r) && /stage\.setAttribute\("data-hotspot-entry-caption", entry\.caption\)/.test(r));
  ok("runtime: caption synced to the current screen on every nav", /function hsUpdateCaption\(stage, curSid\)[\s\S]*?cap\.textContent = text;/.test(rt) && /hsUpdateCaption\(stage, curSid\);/.test(rt));
  ok("css: caption is a centred line below the screen, collapses when empty", /\.hotspot-caption \{[^}]*text-align: center;/.test(css) && /\.hotspot-caption:empty \{ display: none; \}/.test(css));
  // video progress: 1px bar along the screen bottom; runtime sets its width from the current video.
  ok("render: 1px video-progress bar emitted for video tours", /screens\.some\(function \(s\) \{ return s && s\.kind === "video"; \}\)[\s\S]*?el\("div", "hotspot-video-progress"\)[\s\S]*?frame\.appendChild\(vprog\)/.test(r));
  ok("runtime: progress bar sampled every animation frame while playing (smooth, not jumpy)", /function progressTick\(\)[\s\S]*?bar\.style\.width = \(v\.currentTime \/ v\.duration \* 100\) \+ "%";[\s\S]*?v\.__hsRaf = raf\(progressTick\);/.test(rt) && /v\.addEventListener\("play", function \(\) \{ if \(!v\.__hsRaf\) v\.__hsRaf = raf\(progressTick\); \}\);/.test(rt));
  ok("runtime: progress bar pins to 100% on a clean finish", /v\.addEventListener\("ended"[\s\S]*?bar\.style\.width = "100%";/.test(rt));
  ok("runtime: progress bar reset on screen sync", /\.hotspot-video-progress"\); if \(pbar\) pbar\.style\.width = "0%";/.test(rt));
  ok("css: .hotspot-video-progress is a 1px accent bar at the screen bottom", /\.hotspot-video-progress \{ position: absolute; left: 0; bottom: 0; height: 1px;[^}]*background: var\(--color-accent\)/.test(css));
  // nav toggle: external Back/Home suppressible; counter anchors top-right ABOVE the screen.
  ok("render: external nav suppressed when block.hideNav", /if \(screenMode && !block\.hideNav\) \{/.test(r));
  ok("render: counter goes in the top band (above the screen), not the chrome band", /topbar\.appendChild\(counter\)/.test(r) && !/chrome\.appendChild\(counter\)/.test(r));
  ok("css: .hotspot-topbar right-aligns above the screen", /\.hotspot-topbar \{ display: flex; justify-content: flex-end;/.test(css));
  // editor: nav toggle + per-screen caption fields (inspector + board node).
  ok("editor: External nav buttons toggle writes block.hideNav", /switchRow\("External nav buttons", function \(\) \{ return !block\.hideNav;/.test(e));
  ok("editor: Caption field (inspector) writes curScreen.caption", /textLine\("Caption", function \(\) \{ return curScreen\.caption;/.test(e));
  ok("editor: board node has a secondary caption field writing s.caption", /h\("input", "tourb-node__caption"\)[\s\S]*?if \(capIn\.value\) s\.caption = capIn\.value; else delete s\.caption;/.test(e));
  // restart glyph: centred, hidden, shown when the interaction finishes; click restarts.
  ok("render: hidden restart glyph emitted for tours + play-once video screens", /screenMode \|\| screens\.some\(function \(s\) \{ return s && s\.kind === "video" && s\.playback === "once"; \}\)[\s\S]*?el\("button", "hotspot-restart"\)[\s\S]*?frame\.appendChild\(rstb\)/.test(r));
  // restart shows ONLY when finished: every reachable screen visited AND every watched play-once
  // video ended; a degenerate one-screen tour never counts (no mid-authoring show); reactive.
  ok("runtime: restart requires all reachable screens visited (real multi-screen tour)", /function hsAllContentDone\(stage\)[\s\S]*?if \(reach\.length < 2\) return false;[\s\S]*?if \(!reach\.every\(function \(id\) \{ return vis\[id\]; \}\)\) return false;/.test(rt));
  ok("runtime: restart requires every watched play-once video to have ended (content)", /if \(\(!screenMode \|\| vis\[sid\]\) && !v\.ended\) ok = false;/.test(rt));
  ok("runtime: restart re-evaluated reactively on nav + video end", /hsUpdateRestart\(stage\); \/\/ reactively/.test(rt) && /if \(st\) hsUpdateRestart\(st\);/.test(rt));
  ok("runtime: restart gated on a TERMINAL screen (completion screen or dead-end), so it can't ride along", /function hsIsTerminal\(stage\)[\s\S]*?if \(cs\) return hsCurrentScreenId\(stage\) === cs;[\s\S]*?return !onward;/.test(rt) && /rb\.hidden = !\(hsAllContentDone\(stage\) && hsIsTerminal\(stage\)\)/.test(rt));
  ok("runtime: restart click resets + replays; wired in the delegate", /function hsRestart\(stage\) \{\s*stage\.__hsVisited = \{\}; stage\.__hsComplete = false;[\s\S]*?data-hotspot-restart\]"\)\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); hsRestart\(stage\); return; \}/.test(rt));
  ok("css: restart glyph centred + white on a translucent disc", /\.hotspot-restart \{[^}]*left: 50%; top: 50%; transform: translate\(-50%, -50%\)[^}]*color: #ffffff;/.test(css));
  ok("css: restart [hidden] beats the display:flex base (glyph truly hides)", /\.hotspot-restart\[hidden\] \{ display: none; \}/.test(css));
  // canvas video screens pin to the final frame (editor only) so marker targeting isn't blind.
  ok("editor: canvas hotspot videos pinned to the final frame (not grey)", /v\.__canvasPinned = true;[\s\S]*?function pinLast\(\) \{ var d = v\.duration; if \(d && isFinite\(d\) && d > 0\) \{ try \{ v\.currentTime = Math\.max\(0, d - 0\.05\);/.test(e));
  // canvas screen cycler (editor chrome): prev/next buttons flank a multi-screen hotspot.
  ok("editor: hsCanvasCycle steps hotspotEditScreenId + re-shows + re-renders", /function hsCanvasCycle\(node, block, dir\)[\s\S]*?hotspotEditScreenId = next\.id; hotspotEditId = null;\s*renderInspector\(\);\s*showEditScreen\(node, next\.id\);/.test(e));
  ok("editor: wireHotspotNode injects the prev/next canvas nav for multi-screen only", /\(block\.screens \|\| \[\]\)\.filter\(Boolean\)\.length > 1 && !node\.querySelector\("\.hotspot-canvas-nav"\)[\s\S]*?hsCanvasCycle\(node, block, d\[1\]\)/.test(e));
  ok("editor.css: .hotspot-canvas-nav flanks the interaction (left/right, centred)", /\.hotspot-canvas-nav--prev \{ left: 8px; \}/.test(src("editor.css")) && /\.hotspot-canvas-nav--next \{ right: 8px; \}/.test(src("editor.css")));
})();

// Split-page (slice) tool lives in the two-level inspector's Actions row (the floating
// toolbar that used to host it was retired in the ui-kit migration). blockChromeHandlers
// exposes `split` only when canSplitAtBlock; renderContainerChrome renders it Move/Dup <->
// Delete. Guards the regression where migrated blocks lost Split entirely.
section("split-page tool wired into the two-level Actions row");
(function () {
  var t = src("src/editor.js");
  ok("blockChromeHandlers exposes split gated on canSplitAtBlock",
    /split:\s*canSplitAtBlock\(block\)\s*\?\s*function\s*\(\)\s*\{\s*splitPageAtBlock\(block\);\s*\}\s*:\s*null/.test(t));
  ok("Actions row adds the slice button when handlers.split is a function",
    /if \(typeof handlers\.split === "function"\) acts\.push\(\["slice", "Split page here", handlers\.split, false\]\)/.test(t));
  ok("split button sits before Delete in the Actions row",
    /acts\.push\(\["slice"[\s\S]*?acts\.push\(\["trash", "Delete"/.test(t));
})();

// Outliner exposes items[]-based container contents (cardDeck / cardReveal / accordion /
// sequence) so nested blocks (e.g. an empty group tucked in a card) are reachable, selectable
// and deletable from the structure tree — not just columns/group/frame.
section("outliner: items[] containers expose their nested blocks");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/function containerChildGroups\(block\)\s*\{[\s\S]*?\n  \}/);
  if (!m) { ok("locate containerChildGroups", false); return; }
  var ccg = new Function(m[0] + "\nreturn containerChildGroups;")();
  var emptyGroup = { type: "group", children: [] };
  var deck = { type: "cardDeck", items: [{ label: "Alpha", children: [emptyGroup] }, { children: [] }] };
  var g = ccg(deck);
  // #134: EVERY card now exposes a group (empty ones too, so they're droppable)
  ok("cardDeck exposes a group per card (incl. the empty one)", g && g.length === 2);
  ok("group uses the card label", g && g[0].label === "Alpha");
  ok("group exposes the nested (empty) block", g && g[0].blocks[0] === emptyGroup);
  ok("empty card now contributes a droppable group with a lazy ref", g && g[1].arrayKey === "children" && g[1].arrayOwner === deck.items[1] && g[1].blocks.length === 0);
  // accordion/sequence nouns + title fallback
  var acc = ccg({ type: "accordion", items: [{ children: [{ type: "paragraph" }] }] });
  ok("accordion falls back to 'Section N'", acc && acc[0].label === "Section 1");
  var seq = ccg({ type: "sequence", items: [{ title: "Boot", children: [{ type: "paragraph" }] }] });
  ok("sequence uses item.title, noun 'Step'", seq && seq[0].label === "Boot");
  // flip cardReveal exposes both faces
  var flip = ccg({ type: "cardReveal", items: [{ label: "F1", front: [{ type: "heading" }], children: [{ type: "paragraph" }] }] });
  ok("flip card exposes front + back groups", flip && flip.length === 2 && flip[0].label === "F1 (front)" && flip[1].label === "F1 (back)");
  // #134: all-empty items now DO produce groups (each card is a drop target, empty or not)
  var allEmpty = ccg({ type: "cardDeck", items: [{ children: [] }] });
  ok("all-empty items expose a droppable group each", allEmpty && allEmpty.length === 1 && allEmpty[0].arrayKey === "children" && allEmpty[0].blocks.length === 0);
  ok("non-items block still null", ccg({ type: "paragraph" }) === null);
  // friendly outliner labels for the items[] containers (were showing the raw type)
  var lm = t.match(/function blockLabel\(b\)\s*\{[\s\S]*?\n  \}/);
  var bl = new Function(lm[0] + "\nreturn blockLabel;")();
  ok("cardDeck label", bl({ type: "cardDeck", items: [1, 2] }) === "Card deck (2)");
  ok("cardReveal label", bl({ type: "cardReveal", items: [1] }) === "Card reveal (1)");
  ok("accordion label", bl({ type: "accordion", items: [1, 2, 3] }) === "Accordion (3)");
  ok("accordion tabs label", bl({ type: "accordion", mode: "tabs", items: [1] }) === "Tabs (1)");
  ok("sequence label", bl({ type: "sequence", items: [] }) === "Sequence (0)");
})();

// #45: hotspot inspector consolidates marker styling with the per-hotspot list —
// the Markers section is rendered directly ABOVE the Hotspots list (not up top).
section("hotspot inspector: markers consolidated with the list (#45)");
(function () {
  var e = src("src/editor.js");
  ok("renderMarkersSection is defined", /function renderMarkersSection\(\) \{/.test(e));
  // #160: Markers is an Appearance sectionGroup and the hotspot list a Content sectionGroup;
  // the Markers call site still sits beside the Hotspots section (marker + list config together).
  ok("Markers is an Appearance sectionGroup wrapping renderMarkersSection", /sectionGroup\("Appearance", "Markers", function \(_msb\)[\s\S]{0,200}renderMarkersSection\(\);/.test(e));
  ok("Hotspots list is a Content sectionGroup rendered right after Markers", (function () {
    var markers = e.indexOf('sectionGroup("Appearance", "Markers"');
    var list = e.indexOf('sectionGroup("Content", "Hotspots"');
    return markers !== -1 && list !== -1 && list > markers; // list section immediately follows the markers section
  })());
})();

// #94: a dedicated Columns palette block — place an EMPTY multi-column container, then
// drop content into each column. Additive: the implicit side-by-side wrap is untouched.
section("columns palette block (#94)");
(function () {
  var e = src("src/editor.js"), rn = src("src/render.js");
  ok("Columns palette entry makes an EXPLICIT empty 2-column block", /label: "Columns", make: function \(\) \{ return \{ type: "columns", explicit: true, columns: \[\[\], \[\]\] \}/.test(e));
  // an explicit palette Columns block must NOT be collapsed/unwrapped by cleanupColumns
  ok("cleanupColumns preserves an explicit Columns block", /if \(b\.explicit\) continue;/.test(e));
  (function () {
    // reconstruct cleanupColumns (self-contained) and prove an explicit 2-col block with
    // one filled + one empty column survives intact (regression for the browser-caught collapse)
    var cleanupColumns = new Function("blocks", [
      'function cc(blocks){',
      '  for (var i = blocks.length - 1; i >= 0; i--) {',
      '    var b = blocks[i];',
      '    if (b.type === "columns" && b.columns) {',
      '      for (var c = 0; c < b.columns.length; c++) cc(b.columns[c]);',
      '      if (b.explicit) continue;',
      '      b.columns = b.columns.filter(function (col) { return col.length > 0; });',
      '      if (b.columns.length === 0) blocks.splice(i, 1);',
      '      else if (b.columns.length === 1) blocks.splice.apply(blocks, [i, 1].concat(b.columns[0]));',
      '    }',
      '  }',
      '} cc(blocks);'
    ].join("\n"));
    var explicitBlocks = [{ type: "columns", explicit: true, columns: [[], [{ type: "heading" }]] }];
    cleanupColumns(explicitBlocks);
    ok("explicit columns keeps its empty column (no collapse)", explicitBlocks.length === 1 && explicitBlocks[0].type === "columns" && explicitBlocks[0].columns.length === 2 && explicitBlocks[0].columns[0].length === 0);
    var implicitBlocks = [{ type: "columns", columns: [[], [{ type: "heading" }]] }];
    cleanupColumns(implicitBlocks);
    ok("implicit columns still collapses an emptied column (unchanged)", implicitBlocks.length === 1 && implicitBlocks[0].type === "heading");
  })();
  ok("appendIntoColumn targets a specific column", /function appendIntoColumn\(cont, ci, blk\)[\s\S]*?cont\.columns\[ci\]\.push\(blk\)/.test(e));
  ok("handleDrop routes intoColumn to appendIntoColumn", /target\.intoColumn\) \{\s*appendIntoColumn\(target\.intoColumn\.block, target\.intoColumn\.index, draggedBlock\)/.test(e));
  ok("empty columns wired as drop targets", /function attachEmptyColumnDrops[\s\S]*?intoColumn: \{ block: b, index: i \}/.test(e) && /attachEmptyColumnDrops\(node, block\)/.test(e));
  ok("cycle guard also covers an intoColumn move", /target\.intoColumn && target\.intoColumn\.block/.test(e));
  ok("render emits a targetable empty-column placeholder (pure)", /if \(!colBlocks\.length\) col\.appendChild\(el\("div", "layout-column__empty"/.test(rn));
  // BOTH paths still produce a valid columns model:
  ok("implicit side-by-side wrap still produces columns", /type: "columns",\s*columns: \[ \[draggedBlock\], \[target\.targetBlock\] \]/.test(e));
  // behavioural: a targeted drop lands in the right column only, and the palette make() is valid
  (function () {
    var appendIntoColumn = new Function("cont", "ci", "blk",
      'if (!cont || cont.type !== "columns") return; cont.columns = cont.columns || []; cont.columns[ci] = cont.columns[ci] || []; cont.columns[ci].push(blk);');
    var col = { type: "columns", columns: [[], []] };            // the palette make() shape
    appendIntoColumn(col, 1, { type: "paragraph", text: "x" });
    ok("drop into column 1 lands only in that column", col.columns.length === 2 && col.columns[0].length === 0 && col.columns[1].length === 1 && col.columns[1][0].type === "paragraph");
    appendIntoColumn(col, 0, { type: "image" });
    ok("drop into column 0 is independent", col.columns[0].length === 1 && col.columns[1].length === 1);
  })();
})();

// #95: a group is one content chunk — a left/right drop on a direct group child wraps
// the WHOLE group into columns, not the individual child.
section("group as a single side-by-side target (#95)");
(function () {
  var e = src("src/editor.js");
  var a = e.indexOf("/* @groupparent-start */"), b = e.indexOf("/* @groupparent-end */");
  if (a < 0 || b < 0) { ok("locate @groupparent fence", false); return; }
  var groupParentOf = new Function(e.slice(a, b) + "\nreturn groupParentOf;")();
  var child = { type: "image" };
  var grp = { type: "group", children: [{ type: "heading" }, child] };
  ok("resolves the group holding a direct child", groupParentOf([grp], child) === grp);
  var cardChild = { type: "paragraph" };
  ok("a Card (frame) child is NOT retargeted (preserves #55)", groupParentOf([{ type: "frame", children: [cardChild] }], cardChild) === null);
  var deep = { type: "note" };
  ok("a columns-nested block under a group is not a direct child", groupParentOf([{ type: "group", children: [{ type: "columns", columns: [[deep]] }] }], deep) === null);
  var innerChild = { type: "image" };
  var inner = { type: "group", children: [innerChild] };
  ok("innermost group wins for nested groups", groupParentOf([{ type: "group", children: [inner] }], innerChild) === inner);
  ok("handleDrop retargets a left/right group-child drop to the group", /groupParentOf\(activePage\.blocks, target\.targetBlock\)[\s\S]*?target = \{ targetBlock: grp \}/.test(e));
  // #141: a targetBlock drop resolves the target's OWN page (findPageOfBlock), not the
  // selected page — else a cross-page drop no-ops (findBlockParent null). currentPage follows.
  ok("handleDrop #141 resolves the target block's own page, not currentPage", /var destPi141 = findPageOfBlock\(target\.targetBlock\);\s*var activePage = destPi141 >= 0 \? doc\.pages\[destPi141\] : doc\.pages\[currentPage\];/.test(e));
  ok("handleDrop #141 follows the drop to the resolved page", /if \(destLoc\) \{\s*if \(destPi141 >= 0\) currentPage = destPi141;/.test(e));
})();

// #42: author-editable pixel dimensions behind the desktop/tablet/mobile preview buttons.
section("customisable preview preset sizes (#42)");
(function () {
  var e = src("src/editor.js");
  var bpClampDim = new Function("v", "def", "min", "max",
    'var n = parseInt(v,10); if (isNaN(n)) return def; return Math.max(min, Math.min(max, n));');
  ok("clamp: a valid dimension passes through", bpClampDim(800, 1200, 240, 4000) === 800);
  ok("clamp: NaN falls back to the default", bpClampDim("abc", 1200, 240, 4000) === 1200);
  ok("clamp: below min pins to min", bpClampDim(10, 1200, 240, 4000) === 240);
  ok("clamp: above max pins to max", bpClampDim(99999, 1200, 240, 4000) === 4000);
  ok("preview sizes are merged on boot BEFORE applyBp", /loadBpSizes\(\); loadBp\(\); applyBp\(\)/.test(e));
  ok("loadBpSizes validates + clamps stored dims against defaults", /function loadBpSizes\(\)[\s\S]*?bpClampDim\(s\[k\]\.w, BP_DEFAULTS\[k\]\.w\)/.test(e));
  ok("setBpSize clamps, persists, and re-mounts to resize the frame", /function setBpSize\(bp, dim, val\)[\s\S]*?bpClampDim\(val[\s\S]*?saveBpSizes\(\);[\s\S]*?mount\(\)/.test(e));
  ok("Preview sizes is a System settings section", /\{ key: "preview", title: "Preview sizes", build: buildPreviewSizesBody \}/.test(e));
  ok("BP_DEFAULTS snapshots the shipped defaults for Reset", /var BP_DEFAULTS = JSON\.parse\(JSON\.stringify\(BREAKPOINTS\)\)/.test(e));
  // A forced device renders at its EXACT breakpoint pixels (a floating window in the black
  // stage), not fit-scaled to the monitor: zoom is cleared and demoFitScale is no longer used.
  ok("forced-device preview is exact pixels, not fit-scaled", !/demoDevice\.style\.zoom = demoFitScale/.test(e));
  ok("forced device sets exact w/h then clears zoom",
     /demoDevice\.style\.width = dw \+ "px"[\s\S]{0,160}demoDevice\.style\.zoom = "";/.test(e));
  ok("forced device is framed (inline nav, no ghost pill without the zoom containing block)",
     /demoDevice\.classList\.add\("demo__device--framed"\)/.test(e));
})();

// #100: exiting preview lands the canvas on the page the preview was showing (demoPage),
// using the canonical page-focus triple (focus frame + active-page + select).
section("exit preview focuses the demo's page (#100)");
(function () {
  var e = src("src/editor.js");
  var body = e.slice(e.indexOf("function exitDemo()"), e.indexOf("function wireDemo()"));
  ok("exitDemo clamps demoPage to a valid page index", /var __exitPage = clamp\(demoPage, 0, doc\.pages\.length - 1\)/.test(body));
  ok("exitDemo focuses + activates + selects that page", /focusFrame\(__exitPage\); setActivePage\(__exitPage\); setSelection\("page", __exitPage\);/.test(body));
  ok("exitDemo guards against a page-less doc", /if \(doc\.pages && doc\.pages\.length\) \{/.test(body));
})();

// #90: native Table block — 4-file contract wiring (render / course.css / editor).
section("table block (#90)");
(function () {
  var rn = src("src/render.js"), css = src("src/course.css"), e = src("src/editor.js"), ic = src("src/icons.js");
  // render.js: pure renderer — editable cells (th/td by header), scroll wrapper, borders/zebra/pad/align
  ok("render defines a table renderer", /table: function \(block\) \{/.test(rn));
  ok("table cells are editable() rich fields bound to cell.t", /editable\(isHead \? "th" : "td", "table-block__cell", cell, "t", true\)/.test(rn));
  ok("table has a horizontal-scroll wrapper (page-width safe)", /el\("div", "table-block__scroll"\)/.test(rn));
  ok("table maps borders/zebra/cellPad/align to pure attrs", /data-borders[\s\S]*?data-zebra[\s\S]*?--table-cell-pad[\s\S]*?textAlign/.test(rn));
  // course.css: on-token styling only (no ad-hoc hex in the table rules)
  ok("course.css styles the table block on tokens", /\.table-block__table \{[\s\S]*?border-collapse: collapse/.test(css) && /\.table-block__cell \{[\s\S]*?border: 1px solid var\(--color-hair\)/.test(css));
  ok("table header + zebra use theme tokens (no ad-hoc colour)", /th\.table-block__cell \{[\s\S]*?background: var\(--color-surface\)/.test(css) && /\[data-zebra\][\s\S]*?background: var\(--color-surface-alt\)/.test(css));
  // editor.js: palette entry, block-selection type, inspector dispatch, BLOCK_LUCIDE glyph
  ok("Table is in the block palette (Layout group)", /label: "Table", make: function \(\) \{ return \{ type: "table"/.test(e));
  ok("table selects as a block (not an inline field)", /=== "table"\) return "block"/.test(e));
  ok("table dispatches to renderTableInspector via two-level", /block\.type === "table"\) \{ renderBlockTwoLevel\(node, "Table", CONTENT_DECL, renderTableInspector\)/.test(e));
  ok("table inspector adds/removes rows + columns", /function renderTableInspector[\s\S]*?block\.rows\.push\(newRow\(ncols\(\)\)\)[\s\S]*?r\.push\(\{ t: "" \}\)/.test(e));
  ok("table has a Lucide glyph", /table: "table"/.test(e) && /"table":/.test(ic));
  // F&R parity: cells wired into the enumerator
  ok("frTargets enumerates table cells", /b\.type === "table" && Array\.isArray\(b\.rows\)[\s\S]*?host: cell, key: "t"/.test(e));
})();

// ---- #111 course-completion / exit splash --------------------------------
section("#111 completion screen");
(function () {
  var rn = src("src/render.js"), ex = src("src/export.js"), ed = src("src/editor.js"), cs = src("src/course.css");
  // render.js — pure render, default-on, defaults published for the editor
  ok("render exposes VERSO_ENDSCREEN_DEFAULTS", /window\.VERSO_ENDSCREEN_DEFAULTS = ENDSCREEN_DEFAULTS/.test(rn));
  ok("endScreenOn is default-on (off only on explicit on===false)", /function endScreenOn\(doc\) \{ return !\(doc && doc\.endScreen && doc\.endScreen\.on === false\); \}/.test(rn));
  ok("renderEndScreen wraps in a themed course-root host", /"course-root course-end-host"/.test(rn) && /window\.renderEndScreen = renderEndScreen/.test(rn));
  ok("renderEndScreen bakes the module total", /host\.setAttribute\("data-modules-total"/.test(rn));
  ok("renderEndScreen emits meta chips only when showMeta opted in (off by default)", /es\.showMeta === true/.test(rn) && /data-end-chip/.test(rn));
  ok("renderEndScreen copy falls back to defaults", /function endCopy\(es, key\)[\s\S]*?ENDSCREEN_DEFAULTS\[key\]/.test(rn));
  // export.js — ships the splash + wires Exit to it (commit, no LMSFinish)
  ok("export ships the splash when on", /window\.endScreenOn\(doc\)[\s\S]{0,120}window\.renderEndScreen\(doc\)\.outerHTML/.test(ex));
  ok("export injects endMarkup into the page container", /pagesMarkup,\s*\n\s*endMarkup,/.test(ex));
  ok("export wires onExit to the splash", /onComplete:markComplete, onExit:exitCourse/.test(ex));
  ok("exitCourse reveals the splash + commits completion", /function exitCourse\(\)\{[\s\S]*?SCORM\.setStatus\('completed'\); SCORM\.save\(\);[\s\S]*?classList\.add\('is-shown'\)/.test(ex));
  ok("exitCourse forces SCORM.init() before finalizing (closes the deferred-init race)", /if\(window\.SCORM\)\{ try\{ SCORM\.init\(\); SCORM\.setStatus\('completed'\)/.test(ex));
  ok("exitCourse finalizes with an EMPTY exit (records completion, stays on the SCO)", /classList\.add\('is-shown'\);[\s\S]*?SCORM\.quit\(''\)/.test(ex));
  ok("exitCourse uses logout+close only in the no-splash fallback", /if\(!host\)\{ if\(window\.SCORM\)\{ try\{SCORM\.init\(\); SCORM\.quit\('logout'\)/.test(ex));
  ok("export fills meta (modules + date) from state", /function fillEndMeta\(host\)\{[\s\S]*?data-modules-map[\s\S]*?toLocaleDateString/.test(ex));
  // editor.js — inspector + demo preview
  ok("editor adds a Completion screen settings section", /\{ key: "endScreen", title: "Completion screen", build: buildEndScreenBody \}/.test(ed));
  ok("editor builds the end-screen inspector body", /function buildEndScreenBody\(host\)/.test(ed) && /Show completion screen/.test(ed));
  ok("editor demo previews the real splash on Exit", /function previewEndScreen\(\)/.test(ed) && /onExit: function \(\) \{ previewEndScreen\(\); \}/.test(ed));
  // course.css — hidden until revealed; reduced-motion honoured
  ok("course.css hides the splash until .is-shown", /\.course-end \{[\s\S]*?display: none;[\s\S]*?\}\s*\.course-end\.is-shown \{ display: flex; \}/.test(cs));
  ok("course.css gates the check draw on prefers-reduced-motion", /prefers-reduced-motion: reduce[\s\S]*?course-end__badge-check \{ animation: none/.test(cs));
})();

// ---- QQQ: quiz export wiring ---------------------------------------------
section("QQQ quiz-export");
(function () {
  var t = src("src/export.js");
  ok("bundles quiz-runtime.js", /fetchText\("src\/quiz-runtime\.js"\)[\s\S]*?textFile\("quiz-runtime\.js"/.test(t));
  ok("shell links quiz-runtime.js", t.indexOf('<script src="quiz-runtime.js"></script>') !== -1);
  var arrStart = t.indexOf("[", t.indexOf("var RUNTIME_JS = ["));
  var arr = eval("(" + t.slice(arrStart, t.indexOf("].join(", arrStart) + 1) + ")");
  var joined = arr.join("\n");
  var parseErr = null; try { new Function(joined); } catch (e) { parseErr = e.message; }
  ok("inline runtime parses", parseErr === null);
  ok("QuizRuntime.init called (scoped to the active version, or whole doc when <2 versions)", joined.indexOf("QuizRuntime.init(vscope)") !== -1);
  ok("reports SCORM.setScore", joined.indexOf("SCORM.setScore") !== -1);
  // Every page starts at the top: show() must reset scroll on a page swap. (Fix 2026-07-08.)
  ok("export show() resets scroll to top on nav", /pages\.forEach\(function\(p,idx\)\{ p\.classList\.toggle\('is-current'[\s\S]*?window\.scrollTo\(0,0\)/.test(joined) && joined.indexOf("scrollingElement") !== -1);
  // Defensive init: SCORM.init + applyMode/applyBp are guarded so nothing halts before
  // show(0) — the course must always render page 1 + be navigable. (Hardening 2026-07-08.)
  ok("export init is defensive (SCORM.init + applyMode try/catch, show(0) runs)", /try\{ if\(window\.SCORM\) SCORM\.init\(\)/.test(joined) && /try\{ applyMode\(\)/.test(joined) && /try\{ applyBp\(\)/.test(joined));
  // Start-button responsiveness: SCORM.init() is DEFERRED off the startup critical path so a
  // slow LMS LMSInitialize never sits ahead of wiring the nav / showing page 1 (slide 1's Start
  // renders from static HTML but its handler is JS). Assert it's in __scormInit, scheduled via
  // requestIdleCallback, and scheduled AFTER show(0). (Fix 2026-07-08.)
  ok("SCORM.init deferred off startup (requestIdleCallback, after show(0))", /function __scormInit\(\)\{[\s\S]*?SCORM\.init\(\)/.test(joined) && /requestIdleCallback\(__scormInit/.test(joined) && joined.indexOf("__scormInit") > joined.indexOf("show(0)"));
  // §55: serializePages must emit column-major (outline order), not raw doc.pages[] order,
  // so a drifted array can't ship chapter-skips into the runtime's data-index play walk.
  ok("§55 serializePages emits resortColumnMajor order", /window\.resortColumnMajor\s*\?\s*window\.resortColumnMajor\(doc\.pages, doc\.chapters\)/.test(t) && /orderedPages\.map\(function \(page, i\)/.test(t));
  // Force-dark: the learner's OS/browser appearance (prefers-color-scheme) must NOT
  // decide the course mode. A light-mode Chrome opened a course in light before this.
  ok("effective() defaults DARK, never keys off prefers-color-scheme", /function effective\(\)\{ return window\.__SCORM_FIXED_MODE\|\| override\|\| 'dark'; \}/.test(joined) && joined.indexOf("mq&&mq.matches?'dark':'light'") === -1);
  ok("themeCss has NO prefers-color-scheme fallback (no OS-preference leak)", t.indexOf("prefers-color-scheme") === -1);
  ok("themeCss no-JS/pre-JS floor is DARK", /":root\{color-scheme:dark;\}"[\s\S]*?"\.course-root:not\(\[data-mode\]\)\{" \+ dark \+ "\}"/.test(t));
  ok("toggle-off ships forced dark (not author's active mode)", /var fixed = \(opts && !opts\.learnerTheme\) \? "dark" : null;/.test(t));
  ok("export default omits the learner toggle (learnerTheme:false)", /learnerTheme: false, webVideo: "link"/.test(t));
})();

// ---- EEE: pre-export validation ------------------------------------------
section("EEE validate-export");
(function () {
  var t = src("src/export.js");
  var body = t.slice(t.indexOf("function estimateCourseBytes(doc)"), t.indexOf("window.__validateExport"));
  var win = { collectAssetRefs: function (d) { return d.__refs || []; }, AssetStore: { has: function (id) { return id !== "MISSING"; } },
    FONT_LIST: ["Exo 2", "Inter", "System", "Georgia", "Courier"], EMBEDDABLE_FONTS: ["Exo 2", "System", "Georgia", "Courier"] };
  var validate = new Function("window", body + "\nreturn validateExport;")(win);
  var lv = function (iss, l) { return iss.filter(function (i) { return i.level === l; }).length; };
  ok("clean -> 0", validate({ pages: [{ id: "p1" }, { id: "p2", blocks: [{ type: "navButton", action: { goto: "p1" } }] }] }).length === 0);
  ok("dangling button -> error", lv(validate({ pages: [{ id: "p1", blocks: [{ type: "navButton", action: { goto: "ghost" } }] }] }), "error") === 1);
  ok("no target -> warn", lv(validate({ pages: [{ id: "p1", blocks: [{ type: "navButton", text: "d" }] }] }), "warn") === 1);
  ok("exit-course button -> no warn (intentional: no page target)", validate({ pages: [{ id: "p1", blocks: [{ type: "navButton", text: "Exit", action: { exit: true } }] }] }).length === 0);
  ok("courseNav missing -> error", lv(validate({ pages: [{ id: "p1", blocks: [{ type: "courseNav", sections: [{ pageIds: ["gone"] }] }] }] }), "error") === 1);
  ok("empty image -> warn", lv(validate({ pages: [{ id: "p1", blocks: [{ type: "image" }] }] }), "warn") === 1);
  ok("unresolved asset -> error", validate({ __refs: ["MISSING"], pages: [{ id: "p1", blocks: [{ type: "image", src: "asset:MISSING" }] }] }).some(function (i) { return i.level === "error"; }));
  ok("nested columns dangling", lv(validate({ pages: [{ id: "p1", blocks: [{ type: "columns", columns: [[{ type: "navButton", action: { goto: "no" } }]] }] }] }), "error") === 1);
  ok("dedup same id -> 1", lv(validate({ pages: [{ id: "p1", blocks: [{ type: "navButton", action: { goto: "z" } }, { type: "navButton", action: { goto: "z" } }] }] }), "error") === 1);
  ok("non-embeddable font (Inter) -> warn", validate({ pages: [{ id: "p1", blocks: [{ type: "paragraph", style: { font: "Inter" } }] }] }).some(function (i) { return i.level === "warn" && /Inter/.test(i.msg); }));
  ok("embeddable font (Exo 2) -> no font warn", !validate({ pages: [{ id: "p1", blocks: [{ style: { font: "Exo 2" } }] }] }).some(function (i) { return /not embedded/.test(i.msg); }));
})();

// ---- CCC: safe-import validation -----------------------------------------
section("CCC safe-import");
(function () {
  var t = src("src/persist.js");
  var body = t.slice(t.indexOf("function validateImportedDoc(d)"), t.indexOf("window.__validateImportedDoc"));
  var validate = new Function(body + "\nreturn validateImportedDoc;")();
  ok("valid doc -> null", validate({ pages: [{ id: "p1", blocks: [] }] }) === null);
  ok("blocks absent -> null (allowed)", validate({ pages: [{ id: "p1" }] }) === null);
  ok("non-object -> reason", typeof validate(42) === "string");
  ok("array -> reason", typeof validate([]) === "string");
  ok("pages missing -> reason", typeof validate({}) === "string");
  ok("pages not array -> reason", typeof validate({ pages: {} }) === "string");
  ok("empty pages -> reason", typeof validate({ pages: [] }) === "string");
  ok("page not object -> reason", typeof validate({ pages: [null] }) === "string");
  ok("malformed blocks -> reason", typeof validate({ pages: [{ id: "p", blocks: "nope" }] }) === "string");
})();

// ---- BBB: setDoc round-trip lossless + deep-clone audit (OO slice 5/11) ----
// The doc is the COMPLETE serialisable state: per-doc runtime state (__block/
// __bind) lives on DOM nodes (render.js), never on the model, so a JSON round-trip
// of the real course must lose nothing. This guards against any future
// non-serialisable model addition (a function, Date, or a leaked __runtime key)
// that would silently corrupt save->load->save. Also audits duplicate/undo's
// clone() (JSON round-trip) for shared refs + remintIds id-freshness.
section("BBB round-trip + clone");
(function () {
  var win = {};
  new Function("window", src("src/model.js"))(win);
  var doc = win.SAMPLE_DOC;
  var clone = new Function("o", "return JSON.parse(JSON.stringify(o));");
  // remintIds (editor.js) with a deterministic unique mintId
  var rtxt = src("src/editor.js");
  var rStart = rtxt.indexOf("function remintIds(node)");
  var rbody = rtxt.slice(rStart, rtxt.indexOf("\n  }", rStart) + 4);
  var seq = 0;
  var remintIds = new Function("mintId", rbody + "\nreturn remintIds;")(function () { return "b_" + (++seq); });

  ok("SAMPLE_DOC loaded", !!doc && Array.isArray(doc.pages) && doc.pages.length > 0);
  // (a) lossless JSON round-trip on the real course
  ok("round-trip stable (no data lost)", JSON.stringify(clone(doc)) === JSON.stringify(doc));
  // (b) the model carries NO non-serialisable value or leaked runtime key
  var bad = [];
  (function walk(v, p) {
    if (!v || typeof v !== "object") { if (typeof v === "function") bad.push(p + " = function"); return; }
    Object.keys(v).forEach(function (k) {
      if (k.indexOf("__") === 0) bad.push(p + "." + k + " (runtime key)");
      var val = v[k];
      if (typeof val === "function") bad.push(p + "." + k + " = function");
      else if (val && typeof val === "object") walk(val, p + "." + k);
    });
  })(doc, "doc");
  ok("model has no functions / __runtime keys", bad.length === 0);
  // (c) clone() shares no references (mutating the clone never touches the source)
  var blk = { type: "frame", id: "b_x", children: [{ type: "text", id: "b_y", text: "hi" }] };
  var c = clone(blk);
  c.children[0].text = "changed";
  ok("clone is deeply independent", blk.children[0].text === "hi");
  // (d) remintIds freshens every b_ id (nested children + columns) + preserves non-b_ ids
  var tree = clone({ type: "columns", id: "b_a", columns: [[{ type: "text", id: "b_b" }], [{ type: "frame", id: "b_c", children: [{ type: "image", id: "b_d" }] }]], keepId: "ch01" });
  remintIds(tree);
  var ids = [tree.id, tree.columns[0][0].id, tree.columns[1][0].id, tree.columns[1][0].children[0].id];
  ok("remintIds freshens all b_ ids", ids.every(function (x) { return /^b_\d+$/.test(x); }));
  ok("remintIds ids are unique", new Set(ids).size === ids.length);
  ok("remintIds leaves non-b_ ids alone", tree.keepId === "ch01");
})();

// ---- GGG: storage-environment advisory (fragile origin / no IndexedDB) -----
section("GGG storage advisory");
(function () {
  var t = src("src/persist.js");
  var body = t.slice(t.indexOf("function storageAdvisory(env)"), t.indexOf("window.__storageAdvisory"));
  var advise = new Function(body + "\nreturn storageAdvisory;")();
  ok("file:// -> warn about a separate/unreliable box", (function () { var a = advise({ protocol: "file:", hasIndexedDB: true }); return a && a.level === "warn" && /file:\/\//.test(a.msg); })());
  ok("http + no IndexedDB -> warn about the ~5MB cap", (function () { var a = advise({ protocol: "http:", hasIndexedDB: false }); return a && a.level === "warn" && /IndexedDB|5MB/.test(a.msg); })());
  ok("http + IndexedDB -> no advisory", advise({ protocol: "http:", hasIndexedDB: true }) === null);
  ok("https + IndexedDB -> no advisory", advise({ protocol: "https:", hasIndexedDB: true }) === null);
  ok("file:// wins over the idb check", /file:\/\//.test(advise({ protocol: "file:", hasIndexedDB: false }).msg));
})();

// ---- AAA: versioned doc-migration harness --------------------------------
section("AAA doc-migration");
(function () {
  var t = src("src/editor.js");
  // start at the sanitize helpers so normalizeDoc's sanitizeDeep(d) call resolves
  var body = t.slice(t.indexOf("var INVISIBLE_RE ="), t.indexOf("window.__migrateDoc"));
  // normalizeDoc now delegates to window.migrateToChapters (KKKK); build the real
  // one from render.js into a window stub so the harness exercises the wiring.
  var rtxt2 = src("src/render.js");
  var mbody = rtxt2.slice(rtxt2.indexOf("window.migrateToChapters ="), rtxt2.indexOf("// ---- Asset-reference resolution"));
  var winStub = {};
  new Function("window", mbody).call(null, winStub);
  // §55: normalizeDoc self-heals doc.pages[] via window.resortColumnMajor on load — wire
  // the real one into the stub so the harness exercises that heal (not just skips it).
  var rsBody = rtxt2.slice(rtxt2.indexOf("window.resortColumnMajor ="), rtxt2.indexOf("window.chapterInsertIndex ="));
  new Function("window", rsBody).call(null, winStub);
  // #124: normalizeDoc now seeds doc.theme via window.makeDocTheme/defaultDocTheme/
  // normalizeDocTheme (theme.js). Eval the real theme.js against the stub so the harness
  // exercises the real per-doc theme migration wiring, not a fake.
  new Function("window", src("src/theme.js")).call(null, winStub);
  var migrate = new Function("window", body + "\nreturn normalizeDoc;").call(null, winStub);
  var d1 = migrate({ chrome: { header: { on: true } }, pages: [{ id: "p1" }, { id: "p2" }] });
  ok("v0 chrome -> headerFooter", d1.headerFooter && d1.headerFooter.header && d1.headerFooter.header.on === true);
  ok("old chrome key removed", !("chrome" in d1));
  ok("stamps schemaVersion (4)", d1.schemaVersion === 4);
  ok("v1->v2 adds a default chapter", Array.isArray(d1.chapters) && d1.chapters.length === 1);
  ok("v1->v2 assigns all pages to it", d1.pages[0].chapterId === d1.chapters[0].id && d1.pages[1].chapterId === d1.chapters[0].id);
  var dm = migrate({ schemaVersion: 1, pages: [
    { id: "menu", name: "Menu", blocks: [{ type: "componentGrid", instances: [{ action: { goto: "ch01" }, slots: { title: "Overview" } }] }] },
    { id: "ch01", name: "01 Overview", blocks: [] } ] });
  ok("v1->v2 runs menu migration when a menu is present", dm.chapters.length === 1 && dm.pages.length === 1 && dm.pages[0].id === "ch01" && dm.pages[0].chapterId === dm.chapters[0].id);
  var d2 = migrate({ headerFooter: { header: { on: false } }, chrome: { header: { on: true } }, pages: [] });
  ok("existing headerFooter wins (no clobber)", d2.headerFooter.header.on === false);
  var d3 = migrate({ schemaVersion: 2, chrome: { legacy: true }, pages: [], chapters: [{ id: "c", name: "X", order: 0 }] });
  ok("version-gated: v2 doc skips v0 + v1 migrations", d3.chrome && !d3.headerFooter && d3.chapters.length === 1 && d3.chapters[0].name === "X");
  ok("stamps schemaVersion (4)", d3.schemaVersion === 4);
  // P2 auto page-naming migration (v3->v4, CORRECTED): does NOT seed page.title from page.name
  // (names are auto-generated + suppress the first-copy title); instead STRIPS any auto-seeded
  // override (title === the page's name) so the title derives from copy, while KEEPING genuine
  // renames (title != name).
  var pn = migrate({ schemaVersion: 2, chapters: [{ id: "c", name: "X", order: 0 }], pages: [
    { id: "p1", chapterId: "c", name: "Intro to RF" }, { id: "p2", chapterId: "c", name: "New Page" } ] });
  ok("P2 migrate: page.name NOT seeded into title (derives from copy)", pn.pages[0].title == null && pn.pages[1].title == null);
  var pnStrip = migrate({ schemaVersion: 3, chapters: [{ id: "c", name: "X", order: 0 }], pages: [
    { id: "p1", chapterId: "c", name: "01 · Overview", title: "01 · Overview" },   // auto-seeded -> strip
    { id: "p2", chapterId: "c", name: "Body", title: "My custom name" },            // genuine rename -> keep
    { id: "p3", chapterId: "c", name: "Trim me", title: "  Trim me  " } ] });       // seeded (trimmed match) -> strip
  ok("P2 migrate: strips auto-seeded override (title == name)", pnStrip.pages[0].title == null);
  ok("P2 migrate: keeps a genuine rename (title != name)", pnStrip.pages[1].title === "My custom name");
  ok("P2 migrate: strips seeded override matching trimmed name", pnStrip.pages[2].title == null);
  var pnV4 = migrate({ schemaVersion: 4, chapters: [{ id: "c", name: "X", order: 0 }], pages: [{ id: "p1", chapterId: "c", name: "Same", title: "Same" }] });
  ok("P2 migrate: version-gated (v4 doc not re-stripped)", pnV4.pages[0].title === "Same");
  ok("null-safe", migrate(null) === null);
  // Sequence block (FLAGSHIP) field-defaults: new type, no legacy migration — normalizeDoc
  // defaults the three toggles when absent and coerces items to an array so an agent/hand-built
  // doc can't crash render. Idempotent + never clobbers an authored value.
  var sq = migrate({ schemaVersion: 4, chapters: [{ id: "c", name: "X", order: 0 }], pages: [{ id: "p", chapterId: "c", blocks: [
    { type: "sequence", items: [{ title: "A", children: [{ type: "paragraph", text: "x" }] }] },  // missing toggles
    { type: "sequence" } ] }] });                                                                   // missing items entirely
  ok("sequence: defaults spine/orient/reveal", sq.pages[0].blocks[0].spine === "numbered" && sq.pages[0].blocks[0].orient === "vertical" && sq.pages[0].blocks[0].reveal === "scroll");
  ok("sequence: coerces missing items to an array", Array.isArray(sq.pages[0].blocks[1].items) && sq.pages[0].blocks[1].items.length === 0);
  ok("sequence: nested item child is preserved through normalize", sq.pages[0].blocks[0].items[0].children[0].text === "x");
  var sqAuthored = migrate({ schemaVersion: 4, chapters: [{ id: "c", name: "X", order: 0 }], pages: [{ id: "p", chapterId: "c", blocks: [
    { type: "sequence", spine: "plain", orient: "horizontal", reveal: "click", items: [] } ] }] });
  ok("sequence: never overwrites an authored toggle", sqAuthored.pages[0].blocks[0].spine === "plain" && sqAuthored.pages[0].blocks[0].orient === "horizontal" && sqAuthored.pages[0].blocks[0].reveal === "click");
  // §55: normalizeDoc heals a drifted doc.pages[] on load (column-major re-sort) so the
  // stored order can never carry chapter-skips into the export. Idempotent on sorted input.
  var drifted = migrate({ schemaVersion: 2, chapters: [{ id: "c1", name: "One", order: 0 }, { id: "c2", name: "Two", order: 1 }],
    pages: [{ id: "b", chapterId: "c2" }, { id: "a", chapterId: "c1" }, { id: "c", chapterId: "c2" }] });
  ok("§55 self-heal: drifted pages re-sorted column-major on load", drifted.pages.map(function (p) { return p.id; }).join(",") === "a,b,c");
  ok("§55 self-heal: source calls resortColumnMajor", /d\.pages = window\.resortColumnMajor\(d\.pages, d\.chapters\)/.test(t));
  // REGRESSION (2026-07-08 ch2-skip): reorderChapter swaps c.order VALUES but not array
  // position, so the chapters array drifts out of c.order sync. normalizeDoc must canonicalize
  // (sort the array by order + re-index) so array-index == c.order and Next can't skip a chapter.
  var chDriftDoc = migrate({ schemaVersion: 2,
    chapters: [{ id: "c1", name: "One", order: 0 }, { id: "c3", name: "Three", order: 2 }, { id: "c2", name: "Two", order: 1 }],
    pages: [{ id: "p1", chapterId: "c1" }, { id: "p3", chapterId: "c3" }, { id: "p2", chapterId: "c2" }] });
  ok("canonicalize: chapters array sorted by order + re-indexed", chDriftDoc.chapters.map(function (c) { return c.id + ":" + c.order; }).join(",") === "c1:0,c2:1,c3:2");
  ok("canonicalize: pages resort in chapter order on load (no skip)", chDriftDoc.pages.map(function (p) { return p.id; }).join(",") === "p1,p2,p3");
  // §12 slice 0: every block gets a stable, persisted `cid`
  var dc = migrate({ schemaVersion: 2, chapters: [{ id: "c", name: "X", order: 0 }], pages: [{ id: "p", chapterId: "c", blocks: [
    { type: "heading", text: "H" },
    { type: "frame", children: [{ type: "paragraph", text: "n" }] },
    { type: "columns", columns: [[{ type: "note", text: "a" }], [{ type: "image" }]] },
    { type: "cardReveal", items: [{ children: [{ type: "heading", text: "c1" }] }] }
  ] }] });
  var b0 = dc.pages[0].blocks;
  ok("cid stamped on a top-level block", /^c_/.test(b0[0].cid));
  ok("cid stamped on a nested frame child", /^c_/.test(b0[1].children[0].cid));
  ok("cid stamped on a columns child", /^c_/.test(b0[2].columns[0][0].cid) && /^c_/.test(b0[2].columns[1][0].cid));
  ok("cid stamped on a cardReveal item child", /^c_/.test(b0[3].items[0].children[0].cid));
  ok("container blocks themselves get a cid", /^c_/.test(b0[1].cid) && /^c_/.test(b0[2].cid));
  // flip dual-face migration: a flip card without a front gets Side 1 seeded from the
  // block hint (old label look preserved as editable content); front blocks get cids;
  // an existing front and non-flip cards are left alone (idempotent).
  var df = migrate({ schemaVersion: 4, chapters: [{ id: "c", name: "X", order: 0 }], pages: [{ id: "p", chapterId: "c", blocks: [
    { type: "cardReveal", revealStyle: "flip", hint: "Turn me", items: [
      { children: [{ type: "paragraph", text: "back" }] },
      { front: [{ type: "heading", text: "custom front" }], children: [] }
    ] },
    { type: "cardReveal", items: [{ children: [] }] }
  ] }] });
  var fb = df.pages[0].blocks;
  ok("flip migrate: front seeded from hint", Array.isArray(fb[0].items[0].front) && fb[0].items[0].front[0].type === "heading" && fb[0].items[0].front[0].text === "Turn me");
  ok("flip migrate: seeded front block gets a cid", /^c_/.test(fb[0].items[0].front[0].cid));
  ok("flip migrate: an existing front is untouched", fb[0].items[1].front.length === 1 && fb[0].items[1].front[0].text === "custom front");
  ok("flip migrate: reveal-mode cards never get a front", fb[1].items[0].front === undefined);
  // idempotent: an existing cid is preserved
  var keep = migrate({ schemaVersion: 2, chapters: [{ id: "c", name: "X", order: 0 }], pages: [{ id: "p", chapterId: "c", blocks: [{ type: "heading", cid: "c_keep99", text: "H" }] }] });
  ok("existing cid preserved (idempotent)", keep.pages[0].blocks[0].cid === "c_keep99");
  // export-clean: render.js must NOT stamp data-cid nor read block.cid (so the
  // comment-anchor id never ships in the SCORM export — byte-unaffected).
  var rsrc = src("src/render.js");
  ok("render.js never stamps data-cid", rsrc.indexOf("data-cid") === -1 && rsrc.indexOf("block.cid") === -1);
  // §12 slice 1: doc.comments store initialised + idempotent
  ok("normalizeDoc initialises doc.comments = []", Array.isArray(migrate({ schemaVersion: 2, chapters: [{ id: "c", name: "X", order: 0 }], pages: [] }).comments));
  var kc = migrate({ schemaVersion: 2, chapters: [{ id: "c", name: "X", order: 0 }], pages: [], comments: [{ id: "cm_1", body: "hi" }] });
  ok("existing doc.comments preserved (idempotent)", kc.comments.length === 1 && kc.comments[0].id === "cm_1");
  // factory shape (schema carries author/colour/replies for the additive slice 5)
  var et = src("src/editor.js");
  ok("makeComment mints the full schema", /function makeComment\(anchor, body\)[\s\S]*?id: "cm_"[\s\S]*?done: false[\s\S]*?author: id\.name[\s\S]*?colour: id\.colour[\s\S]*?replies: \[\]/.test(et));

  // ---- #196 pin taxonomy (task vs receipt pins) — additive, no migration ----
  ok("__commentModel exposed for the list UIs", /window\.__commentModel = \{/.test(et));
  // Pure classifiers: extract the self-contained block and exercise it against synthetic comments.
  (function () {
    var m = et.match(/function commentIsReceipt\(c\)[\s\S]*?window\.__commentModel = \{[^}]*\};/);
    ok("#196 classifier block present for eval", !!m);
    if (m) {
      var win = {};
      new Function("window", m[0]).call(null, win);
      var CM = win.__commentModel;
      var doc = { comments: [
        { id: "cm_legacy", body: "old" },                                  // no kind -> task (back-compat)
        { id: "cm_t1", kind: "task", body: "fix quiz", done: false },
        { id: "cm_t2", kind: "task", body: "done one", done: true },
        { id: "cm_r1", kind: "receipt", parentId: "cm_t1", original: "A", changed: "B" },
        { id: "cm_r2", kind: "receipt", parentId: "cm_t1", original: "C", changed: "D" },
        { id: "cm_r3", kind: "receipt", parentId: "cm_t2", original: "E", changed: "F" }
      ] };
      ok("#196 legacy comment (no kind) classifies as a task", CM.isTask(doc.comments[0]) === true && CM.isReceipt(doc.comments[0]) === false);
      ok("#196 receipt classifies as receipt, not task", CM.isReceipt(doc.comments[3]) === true && CM.isTask(doc.comments[3]) === false);
      ok("#196 tasks() excludes receipts (queue = tasks only)", CM.tasks(doc).length === 3 && CM.tasks(doc).every(function (c) { return c.kind !== "receipt"; }));
      ok("#196 receiptsFor() groups receipts under their task", CM.receiptsFor(doc, "cm_t1").length === 2 && CM.receiptsFor(doc, "cm_t2").length === 1 && CM.receiptsFor(doc, "cm_none").length === 0);
      ok("#196 openTasks vs doneTasks split on .done", CM.openTasks(doc).length === 2 && CM.doneTasks(doc).length === 1 && CM.doneTasks(doc)[0].id === "cm_t2");
      ok("#196 empty/undefined doc is safe", CM.tasks(undefined).length === 0 && CM.openTasks({}).length === 0);
    }
  })();

  // ---- #197 proximity capture (pin point -> nearby blocks, nearest-first) ----
  (function () {
    var m = et.match(/function rectPointDistance\(r, p\)[\s\S]*?window\.__resolveProximity = resolveProximity;/);
    ok("#197 resolveProximity block present for eval", !!m);
    if (m) {
      var win = {};
      new Function("window", m[0]).call(null, win);
      var RP = win.__resolveProximity;
      // Three blocks stacked vertically on page p1; a fourth far away on p2.
      var items = [
        { cid: "c_a", blockId: "b_a", pageId: "p1", rect: { left: 100, top: 0,   width: 200, height: 80 } },
        { cid: "c_b", blockId: "b_b", pageId: "p1", rect: { left: 100, top: 100, width: 200, height: 80 } },
        { cid: "c_c", blockId: "b_c", pageId: "p1", rect: { left: 100, top: 200, width: 200, height: 80 } },
        { cid: "c_z", blockId: "b_z", pageId: "p2", rect: { left: 900, top: 900, width: 100, height: 100 } }
      ];
      // Point inside block b_b -> distance 0, nearest-first puts b_b first.
      var inside = RP(items, { x: 150, y: 140 }, 120);
      ok("#197 point inside a block -> that block first, distance 0", inside[0].blockId === "b_b" && inside[0].d === 0);
      // A point BESIDE b_b (to its right, 40px gap) still captures it within radius 120.
      var beside = RP(items, { x: 340, y: 140 }, 120);
      ok("#197 point beside a block still captured within radius", beside.some(function (h) { return h.blockId === "b_b"; }));
      // radius 0 -> only a direct hit; the beside point captures nothing.
      ok("#197 radius 0 -> only direct hits", RP(items, { x: 340, y: 140 }, 0).length === 0 && RP(items, { x: 150, y: 140 }, 0).length === 1);
      // nearest-first ordering: a point just above b_a is nearest b_a, then b_b, then b_c.
      var top = RP(items, { x: 150, y: -10 }, 400).map(function (h) { return h.blockId; });
      ok("#197 results sorted nearest-first", top[0] === "b_a" && top.indexOf("b_b") < top.indexOf("b_c"));
      // the far page-2 block is excluded at a tight radius, and pageId of the nearest is p1.
      ok("#197 far block excluded by radius; nearest carries its pageId", !RP(items, { x: 150, y: 140 }, 120).some(function (h) { return h.pageId === "p2"; }) && inside[0].pageId === "p1");
      ok("#197 empty items is safe", RP([], { x: 0, y: 0 }, 100).length === 0 && RP(undefined, { x: 0, y: 0 }, 100).length === 0);
    }
    // wiring: the DOM reader is exposed for the agent surface (#199).
    ok("#197 resolvePinContext DOM reader exposed", /window\.__resolvePinContext = resolvePinContext;/.test(et) && /querySelectorAll\("\.canvas-block\[data-cid\]"\)/.test(et));
  })();
})();

// ---- #124: theme moves onto doc.theme (versioned schema + migration) --------
section("#124 doc.theme (per-course theme)");
(function () {
  // Real theme.js against a bare stub — exercises the actual helpers, not fakes.
  var tw = {};
  new Function("window", src("src/theme.js")).call(null, tw);
  ok("THEME_SCHEMA_VERSION exposed", tw.THEME_SCHEMA_VERSION === 1);

  // normalizeDocTheme: backfills every group + stamps the schema version, idempotently.
  var nd = tw.normalizeDocTheme({});
  ok("normalize: seeds per-mode colour (dark+light)", nd.color && nd.color.dark && nd.color.light && nd.color.dark.bg && nd.color.light.bg);
  ok("normalize: seeds shared groups (font/space/radius/size/button)", nd.font && nd.space && nd.radius && nd.size && nd.button);
  ok("normalize: seeds textStyles + blockStyles", nd.textStyles && typeof nd.textStyles === "object" && nd.blockStyles && typeof nd.blockStyles === "object");
  ok("normalize: stamps schemaVersion", nd.schemaVersion === 1);
  var nd2 = tw.normalizeDocTheme(nd);
  ok("normalize: idempotent (same object, still valid)", nd2 === nd && nd2.schemaVersion === 1 && nd2.color.dark.bg === nd.color.dark.bg);
  // a legacy FLAT colour map (no per-mode split) is promoted to both modes, not crashed.
  var flatPromote = tw.normalizeDocTheme({ color: { bg: "#000", ink: "#fff" } });
  ok("normalize: promotes a legacy flat colour map to both modes", flatPromote.color.dark.bg === "#000" && flatPromote.color.light.bg === "#000" && flatPromote.color.dark !== flatPromote.color.light);
  // backfills a MISSING colour key from the baseline (partial theme can't leave a hole).
  var partial = tw.normalizeDocTheme({ color: { dark: { bg: "#111" }, light: { bg: "#eee" } } });
  ok("normalize: backfills a missing colour key from baseline", partial.color.dark.accent === tw.THEMES.dark.color.accent);
  ok("normalize: preserves an authored colour key", partial.color.dark.bg === "#111");

  // docThemeToModes: projects to the FLAT { dark, light } render/export shape; colour is
  // per-mode; the shared groups are shared BY REFERENCE across modes + with the doc.
  var modes = tw.docThemeToModes(nd);
  ok("toModes: dark + light flat themes", modes.dark && modes.light && modes.dark.color && modes.light.color);
  ok("toModes: colour differs per mode (own object)", modes.dark.color !== modes.light.color);
  ok("toModes: shared button object shared across modes", modes.dark.button === modes.light.button);
  ok("toModes: flat shape carries font/space/radius/size/button", modes.dark.font && modes.dark.space && modes.dark.radius && modes.dark.size && modes.dark.button);
  // editing a shared group through the projection mutates the doc + both modes at once.
  modes.dark.button.bg = "#abcdef";
  ok("toModes: shared-group edit reaches the doc (reference, not copy)", nd.button.bg === "#abcdef" && modes.light.button.bg === "#abcdef");
  // editing a per-mode colour reaches ONLY that mode on the doc.
  modes.dark.color.bg = "#123456";
  ok("toModes: per-mode colour edit is mode-isolated", nd.color.dark.bg === "#123456" && nd.color.light.bg !== "#123456");

  // makeDocTheme: the one-time migration from the old editor-global { dark, light } pair.
  var mig = tw.makeDocTheme({
    dark: { color: { bg: "#0a0a0a", ink: "#fafafa" }, button: { bg: "#f00" } },
    light: { color: { bg: "#f0f0f0", ink: "#0a0a0a" } }
  });
  ok("makeDocTheme: carries the migrated per-mode palette", mig.color.dark.bg === "#0a0a0a" && mig.color.light.bg === "#f0f0f0");
  ok("makeDocTheme: takes the shared button from the dark set", mig.button.bg === "#f00");
  ok("makeDocTheme: is a valid, versioned doc.theme", mig.schemaVersion === 1 && mig.color.dark.accent && mig.color.light.accent);
  ok("defaultDocTheme: a valid doc.theme from built-in THEMES", tw.defaultDocTheme().color.dark.bg === tw.THEMES.dark.color.bg);

  // Per-course independence (the whole point of #124): two docs run through the SAME
  // normalizeDoc get INDEPENDENT theme objects — editing A's theme never touches B.
  var t = src("src/editor.js");
  var body = t.slice(t.indexOf("var INVISIBLE_RE ="), t.indexOf("window.__migrateDoc"));
  var rtxt = src("src/render.js");
  var win = {};
  new Function("window", rtxt.slice(rtxt.indexOf("window.migrateToChapters ="), rtxt.indexOf("// ---- Asset-reference resolution"))).call(null, win);
  new Function("window", rtxt.slice(rtxt.indexOf("window.resortColumnMajor ="), rtxt.indexOf("window.chapterInsertIndex ="))).call(null, win);
  new Function("window", src("src/theme.js")).call(null, win);
  var normalize = new Function("window", body + "\nreturn normalizeDoc;").call(null, win);
  var docA = normalize({ pages: [], chapters: [{ id: "c", name: "X", order: 0 }] });
  var docB = normalize({ pages: [], chapters: [{ id: "c", name: "X", order: 0 }] });
  ok("seed: every doc gets its own doc.theme", docA.theme && docB.theme && docA.theme !== docB.theme);
  docA.theme.color.dark.accent = "#deadbe";
  ok("seed: editing course A's theme does NOT touch course B (per-course)", docB.theme.color.dark.accent !== "#deadbe");
  // idempotent: a doc that already HAS a theme is left alone (only re-normalised), never reseeded.
  var withTheme = { pages: [], chapters: [{ id: "c", name: "X", order: 0 }], theme: tw.makeDocTheme({ dark: { color: { bg: "#020202" } }, light: { color: { bg: "#fefefe" } } }) };
  var kept = normalize(withTheme);
  ok("seed: an existing doc.theme is preserved (not reseeded)", kept.theme.color.dark.bg === "#020202" && kept.theme.color.light.bg === "#fefefe");
})();

// ---- #125: full-token editing in Settings (font/space/radius/size) -----------
section("#125 full-token theme editing");
(function () {
  // fontNameFromStack (render.js) is the pure reverse of fontStackFor -- it drives the
  // font-family picker's preselect from a stored doc.theme.font stack. Exercise the REAL
  // pair against a stub (no fakes), covering roundtrip + the seeded defaults + custom.
  var rw = {};
  var rtxt = src("src/render.js");
  new Function("window", rtxt.slice(rtxt.indexOf("var FONT_STACKS ="), rtxt.indexOf("// Block-level text style"))).call(null, rw);
  var stackFor = rw.fontStackFor, nameFrom = rw.fontNameFromStack;
  ok("roundtrip: name -> stack -> name is stable for every FONT_LIST family",
    rw.FONT_LIST.every(function (n) { return nameFrom(stackFor(n)) === n; }));
  // the SEEDED theme defaults (theme.js BASE.font) resolve to a real family, not "".
  var tw = {};
  new Function("window", src("src/theme.js")).call(null, tw);
  var baseFont = tw.defaultDocTheme().font;
  ok("seeded default heading stack resolves to Exo 2", nameFrom(baseFont.heading) === "Exo 2");
  ok("seeded default body stack resolves to System", nameFrom(baseFont.body) === "System");
  ok("empty stack -> '' (picker shows Default)", nameFrom("") === "" && nameFrom(null) === "");
  ok("a custom/uploaded family passes through by name", nameFrom("'Roboto Slab', sans-serif") === "Roboto Slab");

  // Editing a SHARED group through the working-theme projection must reach doc.theme AND
  // both modes (the reference invariant setSharedToken relies on). docThemeToModes proves it.
  var dt = tw.defaultDocTheme();
  var modes = tw.docThemeToModes(dt);
  modes.dark.space.md = "999px";
  ok("shared space edit reaches doc.theme + both modes (reference, not copy)",
    dt.space.md === "999px" && modes.light.space.md === "999px");
  modes.dark.size.pageTitle = "72px";
  ok("shared size edit reaches the doc", dt.size.pageTitle === "72px");
  modes.dark.font.heading = "'X', serif";
  ok("shared font edit reaches the doc", dt.font.heading === "'X', serif");

  // Wiring guards: the editor exposes the shared-token setter + the four new panel groups,
  // and the font control writes a resolved STACK (fontStackFor), never a bare name (which
  // would emit an unquoted --font-heading and break the family).
  var e = src("src/editor.js");
  ok("editor: setSharedToken helper present", /function setSharedToken\(group, key, val\)/.test(e));
  ok("editor: Typography section wired to font picker + fontStackFor",
    /panelSection\(c, "Typography"\)/.test(e) && /setSharedToken\("font", key, name \? window\.fontStackFor\(name\)/.test(e));
  ok("editor: Spacing/Radius/Text-size groups wired via sharedPx",
    /panelSection\(c, "Spacing"\)/.test(e) && /panelSection\(c, "Radius"\)/.test(e) && /panelSection\(c, "Text sizes"\)/.test(e) && /function sharedPx\(group, key, glyph, title\)/.test(e));
  ok("editor: Reset restores the shared groups too", /doc\.theme\.space = clone\(window\.THEMES\[nm\]\.space\)/.test(e));
})();

// ---- #126: cross-course theme presets (copy-on-apply + merge-by-name) --------
section("#126 theme presets (copy-on-apply)");
(function () {
  var tw = {};
  new Function("window", src("src/theme.js")).call(null, tw);
  // Extract the two PURE preset helpers from editor.js and exercise them for real.
  var t = src("src/editor.js");
  var slice = t.slice(t.indexOf("function mergeTextStyles"), t.indexOf("function snapshotThemePreset"));
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var helpers = new Function("window", "clone", slice + "\nreturn { mergeTextStyles: mergeTextStyles, applyThemePresetToDoc: applyThemePresetToDoc };").call(null, tw, clone);
  var mergeTextStyles = helpers.mergeTextStyles, applyThemePresetToDoc = helpers.applyThemePresetToDoc;

  // merge-by-name: preset overwrites a same-named style, keeps doc-only styles, and COPIES.
  var docStyles = { "Body 1": { size: 15 }, "MyDocOnly": { size: 99, weight: "700" } };
  var presetStyles = { "Body 1": { size: 17 }, "Callout": { size: 14 } };
  var merged = mergeTextStyles(docStyles, presetStyles);
  ok("merge: preset overwrites a same-named style", merged["Body 1"].size === 17);
  ok("merge: doc-only style is KEPT (never orphaned)", merged["MyDocOnly"] && merged["MyDocOnly"].size === 99);
  ok("merge: preset-added style present", merged["Callout"] && merged["Callout"].size === 14);
  presetStyles["Callout"].size = 999;
  ok("merge: preset styles are COPIES (source mutation does not leak)", merged["Callout"].size === 14);

  // copy-on-apply: a preset stamps a DEEP COPY of theme onto the doc — no live link.
  var preset = { theme: tw.makeDocTheme({ dark: { color: { bg: "#0a0a0a", accent: "#a1b2c3" } }, light: { color: { bg: "#fafafa", accent: "#005577" } } }), textStyles: { "H1": { size: 40 } } };
  var docB = { theme: tw.defaultDocTheme(), styles: { "KeepMe": { size: 12 }, "H1": { size: 20 } } };
  // KeepMe is referenced by a block styleRef -> must survive the apply.
  applyThemePresetToDoc(docB, preset);
  ok("apply: course B takes the preset's palette (B looks like A)", docB.theme.color.dark.accent === "#a1b2c3" && docB.theme.color.light.accent === "#005577");
  ok("apply: result is a valid versioned doc.theme", docB.theme.schemaVersion === 1);
  ok("apply: preset text style merged (overwrites same-named)", docB.styles["H1"].size === 40);
  ok("apply: referenced doc-only style survives the apply", docB.styles["KeepMe"] && docB.styles["KeepMe"].size === 12);
  // COPY-ON-APPLY: editing the preset AFTER apply never retro-changes course B.
  preset.theme.color.dark.accent = "#ffffff";
  preset.textStyles["H1"].size = 1;
  ok("apply: copy-on-apply — editing the preset does NOT change course B's theme", docB.theme.color.dark.accent === "#a1b2c3");
  ok("apply: copy-on-apply — editing the preset does NOT change course B's styles", docB.styles["H1"].size === 40);

  // The Editor exposes the preset library API (browser-verify + automation hook).
  ok("Editor.themePresets API exposed", /themePresets:\s*\{[\s\S]*?save:[\s\S]*?apply:[\s\S]*?rename:[\s\S]*?remove:/.test(t));
  ok("presets live in cross-course localStorage (not the per-doc registry)", /THEME_PRESETS_KEY\s*=\s*"authoring\.themePresets"/.test(t));
  ok("applyThemePreset is undoable (pushHistory) + repaints (mount)", /function applyThemePreset\(name\)[\s\S]*?pushHistory\(\)[\s\S]*?applyThemePresetToDoc\(doc, p\)[\s\S]*?syncWorkingFromDoc\(\)[\s\S]*?mount\(\)/.test(t));
  // Picker dropdown fixes (James report): the placeholder option must NOT echo the selected
  // name (else the chosen theme rendered twice), and the per-course selection must reset on a
  // course switch (copy-on-apply keeps no live link, so it must not bleed across courses).
  ok("picker placeholder is neutral (no duplicate option)", /placeholder: names\.length \? "Saved themes…" : "No saved themes yet"/.test(t));
  ok("switchDoc resets themePresetSel (no cross-course bleed)", /function switchDoc\(id\)[\s\S]*?themePresetSel = null;/.test(t));
  ok("closeTab resets themePresetSel on active-doc change", /doc = registry\[activeDocId\];\s*\n\s*themePresetSel = null;[\s\S]*?mount\(\);/.test(t));
})();

// ---- #127: blockStyles per type + capture-from-block + render/export cascade --
section("#127 blockStyles (per-type default appearance cascade)");
(function () {
  // resolveBlockBox (render.js) is the PURE cascade core: theme.blockStyles[type] is the
  // baseline, block.box overrides key-by-key. Exercise the REAL function against a stub.
  var rw = {};
  var rtxt = src("src/render.js");
  new Function("window", rtxt.slice(rtxt.indexOf("function resolveBlockBox"), rtxt.indexOf("function pageHasAutoSpacer")) + "\nwindow.resolveBlockBox = resolveBlockBox;").call(null, rw);
  var resolve = rw.resolveBlockBox;
  ok("cascade: null + null -> null (nothing to apply)", resolve(null, null) === null);
  ok("cascade: type default alone applies as the baseline", (function () { var e = resolve({ fill: "#111", radius: 8 }, null); return e.fill === "#111" && e.radius === 8; })());
  ok("cascade: per-block box alone applies (back-compat, no type default)", (function () { var e = resolve(null, { fill: "#abc" }); return e.fill === "#abc"; })());
  ok("cascade: per-block box OVERRIDES the type default key-by-key", (function () { var e = resolve({ fill: "#111", radius: 8, border: true }, { fill: "#222" }); return e.fill === "#222" && e.radius === 8 && e.border === true; })());
  ok("cascade: block can suppress an inherited border (border:false wins)", (function () { var e = resolve({ border: true, borderColor: "#f00" }, { border: false }); return e.border === false; })());
  var td = { fill: "#111" }; var mergedE = resolve(td, { radius: 4 });
  ok("cascade: does not mutate the source type default", td.fill === "#111" && !("radius" in td) && mergedE.radius === 4);

  // render.js applies the resolved box: the type default reaches the DOM via __blockStyles.
  ok("render: applyBlockAppearance resolves via __blockStyles + resolveBlockBox",
    /var typeDef = \(block && block\.type && window\.__blockStyles && window\.__blockStyles\[block\.type\]\)/.test(rtxt) &&
    /var b = resolveBlockBox\(typeDef, block && block\.box\)/.test(rtxt));

  // The __blockStyles per-pass hook is set on EVERY render surface (editor canvas + preview
  // + export) so editor == export -- never editor state; always from doc.theme.blockStyles.
  var e = src("src/editor.js"), ex = src("src/export.js");
  ok("hook: editor canvas render sets __blockStyles from renderDoc.theme", /window\.__blockStyles = \(renderDoc\.theme && renderDoc\.theme\.blockStyles\) \|\| null;/.test(e));
  ok("hook: editor preview sets __blockStyles from doc.theme", /window\.__blockStyles = \(doc\.theme && doc\.theme\.blockStyles\) \|\| null;.*preview/.test(e));
  ok("hook: export bakes __blockStyles from doc.theme (editor == export)", /window\.__blockStyles = \(doc\.theme && doc\.theme\.blockStyles\) \|\| null;.*export/.test(ex));

  // Editor: capture-from-block writes doc.theme.blockStyles[type] via getBlockStyles, and
  // the theme panel edits captured defaults.
  ok("editor: getBlockStyles ensures doc.theme.blockStyles exists", /function getBlockStyles\(\)[\s\S]*?doc\.theme\.blockStyles = \{\};[\s\S]*?return doc\.theme\.blockStyles;/.test(e));
  ok("editor: Capture look saves the EFFECTIVE box to the type default", /getBlockStyles\(\)\[type\] = clone\(eff\);/.test(e) && /var eff = window\.resolveBlockBox\(bs && bs\[type\], block\.box\);/.test(e));
  ok("editor: theme panel has a Block styles editor", /panelSection\(c, "Block styles"\)/.test(e) && /function blockStylesEditor\(c\)/.test(e));
})();

// ---- #128: document + version the doc.theme design-spec contract (ADR 0002) --
section("#128 doc.theme contract (ADR 0002)");
(function () {
  var adr;
  try { adr = src("docs/adr/0002-doc-theme-design-spec-contract.md"); }
  catch (e) { ok("ADR 0002 exists", false); return; }
  ok("ADR 0002 exists + non-trivial", adr.length > 2000);
  // The contract's schemaVersion is machine-checked against the code so the doc can't
  // silently drift from window.THEME_SCHEMA_VERSION (the whole point of #128).
  var m = adr.match(/<!--\s*SCHEMA_VERSION:\s*(\d+)\s*-->/);
  ok("ADR carries a machine-readable SCHEMA_VERSION marker", !!m);
  var tw = {};
  new Function("window", src("src/theme.js")).call(null, tw);
  ok("ADR SCHEMA_VERSION matches window.THEME_SCHEMA_VERSION (no drift)", !!m && Number(m[1]) === tw.THEME_SCHEMA_VERSION);
  // Completeness: every group + resolution hook the implemented shape uses is named.
  ["schemaVersion", "color", "font", "space", "radius", "size", "button", "textStyles",
   "blockStyles", "styleRef", "textRoles", "resolveBlockBox", "__blockStyles",
   "__docStyles", "normalizeDocTheme", "docThemeToModes"].forEach(function (k) {
    ok("ADR documents `" + k + "`", adr.indexOf(k) !== -1);
  });
})();

// ---- #159/#163: front-end conformance gate (panel/control/label laws) --------------
// Encodes the front-end design laws as machine checks over the editor chrome. Two phases per
// metric: a WARN-RATCHET (existing debt TOLERATED + surfaced; a wrong-way move FAILS) until
// its convergence slices land, then an ENFORCING hard-fail (#163) — the debt is closed, the
// floor is locked, only the allowlist gets past it. This is the anti-regression backstop for
// the #158 programme (the 12 raw modals regressed precisely because nothing guarded them).
// ALL FOUR checks now ENFORCING (#163 complete): taxonomy-adoption (sectionGroup/subHeader/
// disclosure + the adoption ratio, #155+#160+#161+#162), raw-dialog (#156 — zero native
// prompt/confirm), label-parity (#157 — bgLabel at its sanctioned floor + strokeLabel 0), and
// canonical-control (rawSelect 0 — every dropdown is VersoUI.Select). Any wrong-way move
// hard-fails CI; the allowlist is the only sanctioned exception. Governs src/editor.js only.
section("#159/#163 frontend conformance gate");
(function () {
  // Comment-strip so counts reflect CODE, not commented-out examples (naive // -> EOL;
  // adequate for this source — no // inside strings/regex on the counted constructs).
  function stripComments(raw) {
    return raw.split("\n").map(function (l) { var i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); }).join("\n");
  }
  function n(re, s) { var m = s.match(re); return m ? m.length : 0; }
  // Pure measurement of the editor chrome against the four laws. Returns the raw counts;
  // the ratchet + self-tests below consume it (so a mutated source proves the gate trips).
  function measure(raw) {
    var c = stripComments(raw);
    return {
      // panel-ia §3: canonical section engine vs ad-hoc headers.
      sectionGroup: n(/sectionGroup\("/g, c),          // canonical taxonomy sections (want UP)
      subHeader: n(/[^_.]sub\("/g, c),                 // raw sub("...") headers (want DOWN)
      disclosure: n(/disclosure\("/g, c),              // ad-hoc collapsibles (want DOWN)
      // interaction-feel §2,§4: no native dialogs.
      rawDialog: n(/(?:^|[^\w.])(?:prompt|confirm)\s*\(/g, c), // raw prompt()/confirm() (want DOWN)
      // panel-ia §4: canonical controls, not hand-rolled.
      rawSelect: n(/h\("select"/g, c) + n(/createElement\("select"\)/g, c), // raw <select> (want DOWN)
      // panel-ia §2: one word per concept. "Background" should mean only the canvas backdrop
      // (the 4 legit uses: canvas inspector x2 + the theme bg token + its token-picker option).
      bgLabel: n(/"Background"/g, c),                  // "Background" label literals (floor = 4 legit)
      // panel-ia §2: the box outline is "Stroke" everywhere (#157) — never "Border"/"Outline".
      strokeLabel: n(/"(?:Border|Border colour|Outline)"/g, c) // divergent outline labels (want 0)
    };
  }
  // Baselines: the converged floor per metric. `dir` = which way is improvement.
  // `enforce` (#163): a check FLIPS from a warn-ratchet to an ENFORCING hard-fail once its
  // precondition lands (its debt is closed through the convergence slices). An enforcing
  // metric no longer warns as "debt to improve" — it is a locked law: a wrong-way move
  // hard-fails, and the only sanctioned way past it is the documented allowlist below.
  var BASE = {
    // Re-anchored 2026-07-15: #155 (sectionGroup 1->4, disclosure 10->7); #160 (quiz/image/hotspot
    // Level-2 -> sectionGroup 4->17, subHeader 93->84, disclosure 7->5); #161 (accordion/cardReveal/
    // embed/navButton/multiSelect -> sectionGroup 17->34, subHeader 84->75, adoption ->30%); #162
    // (settings/doc/page panels adopt panelSection + page/doc sectionGroups -> sectionGroup 34->37,
    // subHeader 75->29, adoption ->52%). #37 (sequence inspector -> Behaviour/Appearance/Content
    // sectionGroups, dropping the flat sub("Spine") header -> sectionGroup 37->40, subHeader 29->28,
    // adoption ->54.8%; it was the last flat item-list panel, siblings accordion/cardReveal already
    // converged). #163: the taxonomy-adoption check is now ENFORCING —
    // #155+#160+#161+#162 all landed, so sectionGroup/subHeader/disclosure + the adoption ratio
    // are locked. The residual 28 subHeaders are LEGITIMATE minor labels INSIDE section bodies
    // (panel-ia §3: sub() is allowed as an in-section label, never as a section header) — that
    // is why the floor is 28, not 0. The other three checks stay warn-ratchets until their
    // gating tickets land (raw-dialog #156, label-parity #157, canonical-control rawSelect review).
    sectionGroup: { base: 41, dir: "up",   enforce: true,  ticket: "#163 (taxonomy adoption — ENFORCED; +1 = #216 hotspot Screens)" },
    subHeader:    { base: 28, dir: "down", enforce: true,  ticket: "#163 (residual = legit in-section sub-labels)" },
    disclosure:   { base: 5,  dir: "down", enforce: true,  ticket: "#163 (ad-hoc collapsibles capped)" },
    rawDialog:    { base: 0,  dir: "down", enforce: true,  ticket: "#163 (#156 landed — no native dialogs)" },
    // rawSelect review landed: every editor dropdown routes through VersoUI.Select (the dsSelect
    // helper). VersoUI.Select's own h("select") lives in ui-kit.js, which this gate does not
    // measure — so the editor-chrome floor is 0 and a new raw <select> here hard-fails.
    rawSelect:    { base: 0,  dir: "down", enforce: true,  ticket: "#163 (canonical control — VersoUI.Select)" },
    // #157 landed: the label-parity check is ENFORCING. bgLabel floor is 4 (the sanctioned
    // canvas/theme backdrop uses — debt is zero, those are correct); strokeLabel floor is 0
    // (every box outline now reads "Stroke", never "Border"/"Outline").
    bgLabel:      { base: 4,  dir: "down", enforce: true,  ticket: "#163 (#157 — 4 sanctioned backdrop uses)" },
    strokeLabel:  { base: 0,  dir: "down", enforce: true,  ticket: "#163 (#157 — outline = Stroke)" }
  };
  // #163: the taxonomy-adoption check enforces a hard floor on the canonical-section RATIO
  // (sectionGroup / all section headers). At 52.1% today; locked at 50% so a regression that
  // dilutes adoption below half hard-fails, while genuine further improvement is still allowed.
  var ADOPTION_TARGET = 0.5;
  // Deliberate, documented exceptions — the ONLY sanctioned route past an enforcing check
  // (e.g. a genuinely native import-merge confirm). Empty today; when one is sanctioned,
  // record it here so the count target accounts for it. This is the single escape hatch.
  var DIALOG_ALLOWLIST = [];

  var e = src("src/editor.js");
  var m = measure(e);
  function passes(key, val) { var b = BASE[key]; return b.dir === "up" ? val >= b.base : val <= b.base; }

  // ENFORCING metrics (#163) hard-fail on a wrong-way move and no longer warn (their debt is
  // closed). Warn-ratchet metrics still surface standing debt + fail only on a wrong-way move.
  Object.keys(BASE).forEach(function (key) {
    var b = BASE[key], val = m[key];
    if (b.enforce) {
      ok("ENFORCED (#163): " + key + " holds at its converged floor (" + b.dir + " " + b.base + ")", passes(key, val));
    } else {
      if (b.dir === "down" ? val > 0 : val < 999) {
        warn("conformance debt: " + key + " = " + val + " (baseline " + b.base + ", improve " + b.dir + " via " + b.ticket + ")");
      }
      ok("ratchet: " + key + " not worse than baseline (" + b.dir + " " + b.base + ")", passes(key, val));
    }
  });
  // Taxonomy-adoption check — ENFORCING (#163): the canonical-section ratio must hold >= target.
  var ratio = m.sectionGroup / (m.sectionGroup + m.subHeader + m.disclosure);
  ok("ENFORCED (#163): taxonomy adoption >= " + (ADOPTION_TARGET * 100) + "% (" + (ratio * 100).toFixed(1) + "% — " + m.sectionGroup + " sectionGroup vs " + m.subHeader + " sub + " + m.disclosure + " disclosure)", ratio >= ADOPTION_TARGET);

  // Self-tests: PROVE each check trips when the source regresses (mutate the real source,
  // re-measure, assert the predicate now fails). This is the gate's own verification — no
  // app runtime surface to browser-verify, so these stand in for it.
  var addDialog = measure(e + '\nfoo = confirm("x");');
  ok("gate trips (ENFORCED): adding a raw confirm() hard-fails the rawDialog check", !passes("rawDialog", addDialog.rawDialog) && addDialog.rawDialog === m.rawDialog + 1);
  var addSub = measure(e + '\nbody.appendChild(sub("New section"));');
  ok("gate trips (ENFORCED): adding a raw sub() header hard-fails the subHeader check", !passes("subHeader", addSub.subHeader) && addSub.subHeader === m.subHeader + 1);
  var addSelect = measure(e + '\nvar x = h("select", "prop-select");');
  ok("gate trips (ENFORCED): adding a raw <select> hard-fails the rawSelect check", !passes("rawSelect", addSelect.rawSelect) && addSelect.rawSelect === m.rawSelect + 1);
  var addBg = measure(e + '\ncolourControl("Background", v, fn, host);');
  ok("gate trips (ENFORCED): adding a 5th \"Background\" label hard-fails the bgLabel check", !passes("bgLabel", addBg.bgLabel));
  var addStroke = measure(e + '\ncolorFieldFlat("Border colour", v, fn);');
  ok("gate trips (ENFORCED): re-introducing a \"Border\"/\"Outline\" label hard-fails the strokeLabel check", !passes("strokeLabel", addStroke.strokeLabel) && addStroke.strokeLabel === m.strokeLabel + 1);
  var loseSection = measure(e.replace('sectionGroup("', 'XXXGroup("')); // remove the lone adopter
  ok("gate trips (ENFORCED): removing a sectionGroup hard-fails the adoption floor", !passes("sectionGroup", loseSection.sectionGroup) && loseSection.sectionGroup === m.sectionGroup - 1);
  // #163: PROVE the enforced adoption RATIO trips — flood the source with raw sub() headers
  // so canonical adoption dilutes below the target, then assert the ratio check now fails.
  var flood = ""; for (var _f = 0; _f < 40; _f++) flood += '\nx.appendChild(sub("Flood ' + _f + '"));';
  var lowAdopt = measure(e + flood);
  var lowRatio = lowAdopt.sectionGroup / (lowAdopt.sectionGroup + lowAdopt.subHeader + lowAdopt.disclosure);
  ok("gate trips (ENFORCED): adoption diluted below " + (ADOPTION_TARGET * 100) + "% hard-fails the taxonomy check", lowRatio < ADOPTION_TARGET);
  // Allowlist mechanism exists (the single documented escape hatch past an enforcing check).
  ok("dialog allowlist mechanism present", Array.isArray(DIALOG_ALLOWLIST));
})();

// ---- §12 slice 2: canvas comment mode (drop / anchor / render / resolve) -----
section("comment mode (canvas)");
(function () {
  var t = src("src/editor.js");
  ok("setCommentMode toggles the canvas class + persists", /function setCommentMode\(on\)[\s\S]*?setItem\(COMMENT_MODE_KEY[\s\S]*?canvas\.classList\.toggle\("is-comment-mode", commentMode\)/.test(t));
  // 3-tier anchor resolution (block > page > world)
  ok("makeAnchorFromPoint resolves block > page > world", /function makeAnchorFromPoint[\s\S]*?closest\("\.canvas-block\[data-cid\]"\)[\s\S]*?blockId:[\s\S]*?closest\("\.page\[data-page-id\]"\)[\s\S]*?pageId:[\s\S]*?worldX:/.test(t));
  ok("anchorToScreen re-projects all three tiers", /function anchorToScreen[\s\S]*?a\.blockId[\s\S]*?a\.pageId[\s\S]*?a\.worldX != null/.test(t));
  // #181: pin measurement is robust to the #150 content-visibility cull -- force the
  // culled ancestor frame to render while measuring, then restore, so a block/page rect
  // is its REAL position (not the collapsed reserved-box origin) for both anchor tiers.
  ok("rectUnculled forces the frame--cull ancestor visible while measuring", /function rectUnculled\(n\) \{\s*var culled = n\.closest \? n\.closest\("\.frame--cull"\) : null;[\s\S]{0,220}culled\.style\.contentVisibility = "visible";\s*var r = n\.getBoundingClientRect\(\);\s*culled\.style\.contentVisibility = prev;/.test(t));
  ok("anchorToScreen #181 measures both block + page anchors via rectUnculled", /a\.blockId[\s\S]{0,160}var r = rectUnculled\(n\);[\s\S]{0,220}a\.pageId[\s\S]{0,160}var pr = rectUnculled\(pe\);/.test(t));
  // drop = pushHistory + makeComment + push to doc.comments (capture phase, comment-mode only)
  ok("drop handler creates + stores a comment", /if \(!commentMode\) return;[\s\S]*?makeAnchorFromPoint\(e\.clientX, e\.clientY, e\.target\)[\s\S]*?pushHistory\(\);[\s\S]*?makeComment\(anchor, ""\)[\s\S]*?doc\.comments\.push\(c\)/.test(t));
  ok("first outside click closes the open note (positive exit), next click drops", /if \(openCommentId\) \{ closeCommentPopover\(\); renderCommentPins\(\); return; \}/.test(t));
  // popover: body input, resolve checkbox, delete
  ok("popover edits body / resolve / delete", /function openCommentPopover[\s\S]*?c\.body = ta\.value[\s\S]*?c\.done = v; scheduleSave\(\); renderCommentPins\(\); refreshCommentPanel\(\)[\s\S]*?doc\.comments\.splice\(i, 1\)/.test(t));
  // pins re-projected from mount + applyView (canvas.innerHTML is cleared on mount)
  ok("mount re-renders pins", /refreshCanvasSelection\(\);\s*if \(interactMode\) decorateInteractHandle\(\);[\s\S]{0,400}renderCommentPins\(\);/.test(t));
  ok("applyView re-projects pins (pan/zoom)", /persistView\(\);\s*if \(typeof renderCommentPins === "function"\) renderCommentPins\(\)/.test(t));
  // mode bails: drill + C shortcut
  ok("drill handler bails in comment mode", /if \(interactMode \|\| commentMode\) return;/.test(t));
  ok("C toggles comment mode", /\(e\.key === "c" \|\| e\.key === "C"\) && !meta && !e\.shiftKey[\s\S]*?setCommentMode\(!commentMode\)/.test(t));
  // export-strip: comment pins/store are editor.js chrome only — render.js knows nothing
  var r = src("src/render.js");
  ok("render.js has no comment/pin code", r.indexOf("comment") === -1 && r.indexOf("comment-pin") === -1 && r.indexOf("doc.comments") === -1);
})();

// ---- §12 slice 3: right-panel comment list -------------------------------
section("comment list (panel)");
(function () {
  var t = src("src/editor.js");
  ok("renderInspector routes to the comment list in comment mode", /if \(commentMode\) \{ renderCommentList\(\); return; \}/.test(t));
  ok("comment mode + interact mode are mutually exclusive", /if \(commentMode\) \{ if \(interactMode\) setInteractMode\(false\)/.test(t));
  ok("list filters Open vs Resolved", /function renderCommentList[\s\S]*?commentFilter === "resolved" \? c\.done : !c\.done/.test(t));
  ok("row = colour-dot + snippet + done checkbox", /comment-row__dot[\s\S]*?comment-row__snip[\s\S]*?comment-row__done/.test(t));
  ok("resolve from the list syncs the pin", /c\.done = v; scheduleSave\(\); renderCommentPins\(\); renderCommentList\(\)/.test(t));
  ok("click a row pans to the pin (jumpToComment)", /function jumpToComment[\s\S]*?view\.x \+= \(cr\.width \/ 2 - pos\.px\)[\s\S]*?applyView\(\)[\s\S]*?openCommentPopover\(c\)/.test(t));
})();

// ---- §12 slice 4: preview comment mode (same store, surface abstraction) ----
section("comment mode (preview)");
(function () {
  var t = src("src/editor.js");
  // surface abstraction: canvas vs demo, one shared store
  ok("activeSurf picks demo while the preview is open", /function activeSurf\(\) \{ return \(demo && !demo\.hidden\) \? demoSurf\(\) : canvasSurf\(\); \}/.test(t));
  ok("demoSurf disallows world anchors (canvas-only)", /function demoSurf\(\)[\s\S]*?allowWorld: false/.test(t));
  ok("makeAnchorFromPoint is surface-scoped + drops world in preview", /var s = activeSurf\(\);[\s\S]*?s\.root\.contains\(blockEl\)[\s\S]*?if \(!s\.allowWorld\) return null;/.test(t));
  ok("anchorToScreen resolves against the active surface root", /function anchorToScreen[\s\S]*?var s = activeSurf\(\);[\s\S]*?s\.root\.querySelector/.test(t));
  // demo DOM gets data-cid (renderPage is pure -> stamp here) + pins re-projected
  ok("renderDemo stamps cids + renders pins", /stampDemoCids\(cr\);[\s\S]*?renderCommentPins\(\);/.test(t));
  ok("stampDemoCids stamps data-cid from __block.cid", /function stampDemoCids[\s\S]*?n\.setAttribute\("data-cid", n\.__block\.cid\)/.test(t));
  // preview drop: block/page only (bails on a null anchor), shared store
  ok("preview drop uses the shared store + skips null anchors", /if \(!demoCommentMode \|\| e\.button !== 0\) return;[\s\S]*?if \(!anchor\) return;[\s\S]*?doc\.comments\.push\(c\)/.test(t));
  // C routes to the demo in preview; canvas C is guarded by demo.hidden
  ok("canvas C is guarded by demo.hidden", /setCommentMode\(!commentMode\)[\s\S]{0,80}demo has its own C/.test(t) || /&& demo\.hidden\) \{\s*e\.preventDefault\(\);\s*setCommentMode/.test(t));
  ok("preview C toggles demo comment mode", /setDemoCommentMode\(!demoCommentMode\)/.test(t));
  // exit re-projects onto the canvas surface (the round-trip)
  ok("exitDemo re-projects pins onto the canvas", /function exitDemo[\s\S]*?demo\.hidden = true;[\s\S]{0,140}renderCommentPins\(\)/.test(t));
  // #76: authoring-only chrome must not float over the learner preview.
  // enterDemo/exitDemo toggle body.demo-open.
  ok("enterDemo adds body.demo-open", /function enterDemo[\s\S]*?document\.body\.classList\.add\("demo-open"\)/.test(t));
  ok("exitDemo removes body.demo-open", /function exitDemo[\s\S]*?document\.body\.classList\.remove\("demo-open"\)/.test(t));
})();

// ---- §12 slice 5: transport primitives (identity / sidecar / threading) -----
section("comment transport (slice 5)");
(function () {
  var t = src("src/editor.js");
  ok("author identity is stored + colour is deterministic", /function commentIdentity\(\)[\s\S]*?COMMENT_AUTHOR_KEY/.test(t) && /function colourForName/.test(t));
  ok("makeComment stamps the current identity", /var id = \(typeof commentIdentity === "function"\)[\s\S]*?author: id\.name \|\| null/.test(t));
  ok("sidecar export writes a typed payload, never into the course", /type: "verso-comments"[\s\S]*?comments: doc\.comments/.test(t));
  ok("import merges (never replaces) the store", /function importComments[\s\S]*?mergeComments\(list\)/.test(t));
  ok("replies are threaded via makeReply", /function makeReply[\s\S]*?rp_[\s\S]*?c\.replies\.push\(makeReply/.test(t));
  ok("a note with replies is not discarded as empty", /!\(editingComment\.replies \|\| \[\]\)\.length/.test(t));
  ok("export is a sidecar — render/export never see doc.comments", src("src/render.js").indexOf("comments") === -1 && src("src/export.js").indexOf("doc.comments") === -1);
  // functional: mergeComments is conflict-free (union by id, union replies, resolve wins)
  var mStart = t.indexOf("function mergeComments(incoming)");
  var mBody = t.slice(mStart, t.indexOf("\n  }", mStart) + 4);
  var docStub = { comments: [ { id: "cm_a", body: "A", done: false, replies: [{ id: "rp_1" }] }, { id: "cm_b", body: "B", done: false, replies: [] } ] };
  var mergeComments = new Function("doc", mBody + "\nreturn mergeComments;")(docStub);
  var r = mergeComments([
    { id: "cm_b", done: true, replies: [{ id: "rp_2", body: "reply" }] }, // existing: adopt resolve + new reply
    { id: "cm_c", body: "C", replies: [] }                                  // new comment
  ]);
  ok("merge adds new comments", docStub.comments.length === 3 && docStub.comments[2].id === "cm_c" && r.added === 1);
  ok("merge unions replies onto an existing comment", docStub.comments[1].replies.length === 1 && docStub.comments[1].replies[0].id === "rp_2");
  ok("merge adopts a resolve (done wins)", docStub.comments[1].done === true);
  ok("merge does NOT duplicate an existing reply", (function () { var r2 = mergeComments([{ id: "cm_a", replies: [{ id: "rp_1" }] }]); return docStub.comments[0].replies.length === 1; })());
})();

// ---- JJJJ: groupPagesByChapter -------------------------------------------
section("JJJJ chapters");
(function () {
  var rtxt = src("src/render.js");
  var body = rtxt.slice(rtxt.indexOf("window.groupPagesByChapter"), rtxt.indexOf("// ---- Asset-reference resolution"));
  var win = {};
  new Function("window", body)(win);
  var g = win.groupPagesByChapter;
  // no chapter model -> one implicit chapter with all pages
  var r0 = g({ pages: [{ id: "a" }, { id: "b" }] });
  ok("no chapters -> 1 implicit", r0.length === 1 && r0[0].pages.length === 2);
  // grouped by chapterId, chapters in order, pages in doc order (column-major)
  var doc = { chapters: [{ id: "c2", name: "Two", order: 1 }, { id: "c1", name: "One", order: 0 }],
    pages: [{ id: "p1", chapterId: "c1" }, { id: "p2", chapterId: "c1" }, { id: "p3", chapterId: "c2" }] };
  var r = g(doc);
  ok("ordered by chapter.order", r[0].name === "One" && r[1].name === "Two");
  ok("c1 has its 2 pages", r[0].pages.map(function (p) { return p.id; }).join(",") === "p1,p2");
  ok("c2 has its page", r[1].pages.length === 1 && r[1].pages[0].id === "p3");
  // page with unknown/missing chapterId -> falls into the first chapter
  var r2 = g({ chapters: [{ id: "c1", name: "One", order: 0 }], pages: [{ id: "x" }, { id: "y", chapterId: "ghost" }] });
  ok("orphan pages -> first chapter", r2[0].pages.length === 2);
  // resortColumnMajor: page reassigned to a chapter -> pages regrouped contiguous
  var rs = win.resortColumnMajor;
  var chapters = [{ id: "c1", order: 0 }, { id: "c2", order: 1 }];
  var pages = [{ id: "a", chapterId: "c2" }, { id: "b", chapterId: "c1" }, { id: "c", chapterId: "c2" }, { id: "d", chapterId: "c1" }];
  ok("resort column-major (c1 pages then c2, order kept)", rs(pages, chapters).map(function (p) { return p.id; }).join(",") === "b,d,a,c");
  ok("resort: orphan chapterId -> last", rs([{ id: "x", chapterId: "ghost" }, { id: "y", chapterId: "c1" }], chapters).map(function (p) { return p.id; }).join(",") === "y,x");
  // REGRESSION (2026-07-08 nav-skip): chapters ARRAY out of c.order sync must still resort
  // by c.order (== the outline / groupPagesByChapter), NOT array index — else Next skips a
  // chapter. Array = [c1, c3, c2] but order says c1<c2<c3, so play-order must be c1,c2,c3.
  var chDrift = [{ id: "c1", order: 0 }, { id: "c3", order: 2 }, { id: "c2", order: 1 }];
  var pgDrift = [{ id: "p1", chapterId: "c1" }, { id: "p3", chapterId: "c3" }, { id: "p2", chapterId: "c2" }];
  ok("resort ranks by c.order not array index (nav can't skip a chapter)", rs(pgDrift, chDrift).map(function (p) { return p.id; }).join(",") === "p1,p2,p3");
  ok("resort order == outline order (groupPagesByChapter) under array drift", rs(pgDrift, chDrift).map(function (p) { return p.chapterId; }).join(",") === win.groupPagesByChapter({ pages: pgDrift, chapters: chDrift }).map(function (g) { return g.id; }).join(","));
  // chapterInsertIndex: a moved page appends to the END of its chapter (addition order)
  var cii = win.chapterInsertIndex;
  ok("first into empty chapter -> after earlier chapters", cii([{ id: "a", chapterId: "c1" }], "c2", chapters) === 1);
  ok("next into chapter -> after existing (stays in add order)", cii([{ id: "a", chapterId: "c1" }, { id: "b", chapterId: "c2" }], "c2", chapters) === 2);
  ok("into an earlier chapter -> before the later block", cii([{ id: "a", chapterId: "c1" }, { id: "b", chapterId: "c2" }], "c1", chapters) === 1);
  // chaptersToNavSections: chapters -> learner nav sections {id,label,pages:[pageId]}
  var c2n = win.chaptersToNavSections;
  var ns = c2n(doc); // doc from above: c1(One)=p1,p2 ; c2(Two)=p3
  ok("nav sections in chapter order", ns.map(function (s) { return s.label; }).join(",") === "One,Two");
  ok("nav section carries chapter page ids", ns[0].pages.join(",") === "p1,p2" && ns[1].pages.join(",") === "p3");
  ok("nav section id = chapter id", ns[0].id === "c1" && ns[1].id === "c2");
  // §55 play-order guard: export emits resortColumnMajor(pages) and the runtime walks
  // that data-index sequence, so for a DELIBERATELY DRIFTED doc.pages[] the export order
  // MUST equal the outline (chaptersToNavSections flattened) order — else SCORM prev/next
  // skips chapters. Assert the two agree even when the array is shuffled out of chapter order.
  var drift = { chapters: [{ id: "c1", name: "One", order: 0 }, { id: "c2", name: "Two", order: 1 }, { id: "c3", name: "Three", order: 2 }],
    pages: [{ id: "p3a", chapterId: "c3" }, { id: "p1a", chapterId: "c1" }, { id: "p2a", chapterId: "c2" }, { id: "p1b", chapterId: "c1" }, { id: "p3b", chapterId: "c3" }] };
  var exportOrder = rs(drift.pages, drift.chapters).map(function (p) { return p.id; }).join(",");
  var outlineOrder = c2n(drift).reduce(function (a, s) { return a.concat(s.pages); }, []).join(",");
  ok("§55 drifted array: export order == outline order", exportOrder === outlineOrder && exportOrder === "p1a,p1b,p2a,p3a,p3b");
  // migrateToChapters (KKKK / module E): legacy menu page -> explicit chapters, menu removed
  var mig = win.migrateToChapters;
  var legacy = { pages: [
    { id: "menu", name: "Course Menu", blocks: [
      { type: "heading", text: "Demo" },
      { type: "componentGrid", component: "chapter-card", instances: [
        { action: { goto: "ch01" }, slots: { number: "01", title: "Overview" } },
        { action: { goto: "ch03" }, slots: { number: "02", title: "Threats" } } ] } ] },
    { id: "ch01", name: "01 Overview", blocks: [{ type: "heading", text: "A" }] },
    { id: "ch02", name: "Overview detail", blocks: [{ type: "paragraph", text: "b" }] },
    { id: "ch03", name: "02 Threats", blocks: [{ type: "navButton", action: { goto: "menu" } }] } ] };
  var mr = mig(legacy);
  ok("menu migration reports changed", mr.changed === true && mr.removedMenuId === "menu");
  ok("menu page removed", legacy.pages.map(function (p) { return p.id; }).join(",") === "ch01,ch02,ch03");
  ok("two chapters from grid instances", legacy.chapters.length === 2 && legacy.chapters[0].name === "01 · Overview");
  ok("ch01+ch02 in chapter 1, ch03 in chapter 2", legacy.pages[0].chapterId === legacy.pages[1].chapterId && legacy.pages[2].chapterId !== legacy.pages[0].chapterId);
  ok("dangling menu link flagged", mr.flags.some(function (f) { return /point to the removed Course Menu/.test(f); }));
  ok("idempotent when chapters exist", mig(legacy).changed === false);
  // naming-implied fallback (no menu grid)
  var named = { pages: [
    { id: "a", name: "01 Intro", blocks: [] }, { id: "b", name: "01 Intro cont", blocks: [] },
    { id: "c", name: "02 Body", blocks: [] } ] };
  var nr = mig(named);
  ok("naming fallback makes 2 chapters", nr.changed === true && named.chapters.length === 2);
  ok("naming fallback groups by number prefix", named.pages[0].chapterId === named.pages[1].chapterId && named.pages[2].chapterId !== named.pages[0].chapterId);
  ok("no menu, no chapters recognisable -> unchanged", mig({ pages: [{ id: "x", name: "Page", blocks: [] }] }).changed === false);
})();

// ---- P2: auto page-naming helpers (derived number + overridable/derived title) --------
section("P2 auto page-naming");
(function () {
  var etxt = src("src/editor.js");
  var body = etxt.slice(etxt.indexOf("// >>> P2 auto page-naming helpers"), etxt.indexOf("// <<< P2 auto page-naming helpers"));
  var rtxt = src("src/render.js");
  var gbody = rtxt.slice(rtxt.indexOf("window.groupPagesByChapter ="), rtxt.indexOf("// Re-sort a pages array"));
  var win = {};
  new Function("window", gbody).call(null, win);
  new Function("window", body).call(null, win); // helpers read window.groupPagesByChapter
  var displayName = win.__pageDisplayName, firstCopy = win.__firstCopyOf, setTitle = win.__setPageTitle;
  // firstCopyOf: first text block, tags stripped, recurses columns/frames
  ok("firstCopy: first heading text, tags stripped", firstCopy({ blocks: [{ type: "spacer" }, { type: "heading", text: "<b>RF</b> basics" }, { type: "paragraph", text: "later" }] }) === "RF basics");
  ok("firstCopy: recurses into columns", firstCopy({ blocks: [{ type: "columns", columns: [[{ type: "image" }], [{ type: "paragraph", text: "in a column" }]] }] }) === "in a column");
  ok("firstCopy: skips non-copy (navButton/image)", firstCopy({ blocks: [{ type: "navButton", text: "Next" }, { type: "image" }, { type: "note", text: "the note" }] }) === "the note");
  ok("firstCopy: none -> empty", firstCopy({ blocks: [{ type: "image" }, { type: "spacer" }] }) === "");
  // pageDisplayName: derived chapter.page number + title (override wins over first copy)
  var doc = { chapters: [{ id: "c1", name: "One", order: 0 }, { id: "c2", name: "Two", order: 1 }],
    pages: [] };
  var pA = { id: "a", chapterId: "c1", blocks: [{ type: "heading", text: "Intro" }] };
  var pB = { id: "b", chapterId: "c1", blocks: [{ type: "paragraph", text: "Body copy here" }] };
  var pC = { id: "c", chapterId: "c2", title: "Manual name", blocks: [{ type: "heading", text: "ignored" }] };
  doc.pages = [pA, pB, pC];
  ok("displayName: 1.1 from first copy", displayName(pA, doc) === "1.1 Intro");
  ok("displayName: 1.2 second page in chapter", displayName(pB, doc) === "1.2 Body copy here");
  ok("displayName: 2.1 override title wins over copy", displayName(pC, doc) === "2.1 Manual name");
  // number reflows when a page moves chapter / order changes (derived, not stored)
  pB.chapterId = "c2";
  doc.pages = win.groupPagesByChapter ? [pA, pC, pB] : doc.pages; // simulate a resort
  ok("displayName: number reflows after chapter move", displayName(pB, doc) === "2.2 Body copy here" && displayName(pC, doc) === "2.1 Manual name");
  // empty-copy page -> "Page" fallback; truncation ~40ch with ellipsis
  var pEmpty = { id: "e", chapterId: "c1", blocks: [] };
  doc.pages = [pEmpty]; doc.chapters = [{ id: "c1", name: "One", order: 0 }];
  ok("displayName: empty page -> 'Page' fallback", displayName(pEmpty, doc) === "1.1 Page");
  // copy-less page with an auto-numbered name -> falls back to the DE-NUMBERED name (no double number)
  var pMedia = { id: "m", chapterId: "c1", name: "03 · Sensor coverage", blocks: [{ type: "image" }] };
  doc.pages = [pMedia];
  ok("displayName: copy-less page falls back to de-numbered name", displayName(pMedia, doc) === "1.1 Sensor coverage");
  var pNewPage = { id: "n", chapterId: "c1", name: "New Page", blocks: [] };
  doc.pages = [pNewPage];
  ok("displayName: 'New Page' default not used as fallback -> 'Page'", displayName(pNewPage, doc) === "1.1 Page");
  // real-course shape: name carries its OWN number + a heading of copy -> copy wins (no double number)
  var pReal = { id: "r", chapterId: "c1", name: "01 · Course Overview", blocks: [{ type: "heading", text: "Course Overview" }] };
  doc.pages = [pReal];
  ok("displayName: real page shows first copy, not the numbered name", displayName(pReal, doc) === "1.1 Course Overview");
  var longTitle = firstCopy({ blocks: [{ type: "heading", text: "This heading is definitely much longer than forty characters total" }] });
  var pLong = { id: "L", chapterId: "c1", blocks: [{ type: "heading", text: "This heading is definitely much longer than forty characters total" }] };
  ok("displayName: long title truncated with ellipsis", /…$/.test(displayName(pLong, doc)) && displayName(pLong, doc).length <= 44);
  // setPageTitle: empty or ==first-copy clears override; anything else sets it
  var pS = { id: "s", chapterId: "c1", blocks: [{ type: "heading", text: "Auto" }], title: "Custom" };
  setTitle(pS, "");        ok("setTitle: empty clears override", pS.title === undefined);
  setTitle(pS, "New one"); ok("setTitle: sets override", pS.title === "New one");
  setTitle(pS, "Auto");    ok("setTitle: value == first copy clears override (stays auto)", pS.title === undefined);
  // wiring guards: display routes through the helper; rename writes page.title, not page.name
  ok("frame-label uses pageDisplayName", /frame-label__name", pageDisplayName\(page, doc\)/.test(etxt));
  ok("outliner tree name uses pageDisplayName", /tree-page__name"[\s\S]{0,120}pageDisplayName\(page, doc\)/.test(etxt));
  ok("inline rename writes via setPageTitle", /setPageTitle\(page, v\)/.test(etxt));
})();

// ---- page-dup: duplicatePage core (deep clone + remint + chapter/section sync)
section("page-dup");
(function () {
  var etxt = src("src/editor.js");
  var clone = new Function("o", "return JSON.parse(JSON.stringify(o));");
  // remint with a deterministic unique b_ mintId
  var rStart = etxt.indexOf("function remintIds(node)");
  var rbody = etxt.slice(rStart, etxt.indexOf("\n  }", rStart) + 4);
  var seq = 0, cseq = 0;
  var remintIds = new Function("mintId", "mintCid", rbody + "\nreturn remintIds;")(function () { return "b_" + (100 + ++seq); }, function () { return "c_" + (900 + ++cseq); });
  // §12 slice 0: a duplicated subtree re-mints cids (no two blocks share one)
  var cdup = remintIds({ type: "frame", cid: "c_orig", children: [{ type: "paragraph", cid: "c_child" }], items: [{ children: [{ type: "note", cid: "c_item" }] }] });
  ok("remintIds re-mints the block's cid", cdup.cid !== "c_orig" && /^c_9/.test(cdup.cid));
  ok("remintIds re-mints a nested child cid", cdup.children[0].cid !== "c_child" && /^c_9/.test(cdup.children[0].cid));
  ok("remintIds re-mints an item-child cid", cdup.items[0].children[0].cid !== "c_item" && /^c_9/.test(cdup.items[0].children[0].cid));
  // extract duplicatePage, injecting its closure deps
  var dStart = etxt.indexOf("function duplicatePage(pi)");
  var dbody = etxt.slice(dStart, etxt.indexOf("\n  }", dStart) + 4);
  var doc = {
    pages: [
      { id: "src1", name: "Intro", chapterId: "c1", padX: 40, blocks: [
        { type: "text", id: "b_1", text: "hi" },
        { type: "frame", id: "b_2", children: [{ type: "text", id: "b_3", text: "n" }] } ] },
      { id: "p2", name: "Other", chapterId: "c2", blocks: [] } ],
    headerFooter: { footer: { children: [
      { type: "courseNav", sections: [{ name: "S", pageIds: ["src1", "p2"] }] } ] } }
  };
  var eachCourseNav = function (fn) {
    var hf = doc.headerFooter || {};
    [hf.header, hf.footer].forEach(function (r) {
      if (r && r.children) r.children.forEach(function (b) { if (b.type === "courseNav") fn(b); });
    });
  };
  var noop = function () {};
  // P2: duplicatePage now derives a " copy" title override via firstCopyOf — inject the real one.
  var hWin = {};
  new Function("window", etxt.slice(etxt.indexOf("// >>> P2 auto page-naming helpers"), etxt.indexOf("// <<< P2 auto page-naming helpers"))).call(null, hWin);
  var firstCopyOf = hWin.__firstCopyOf;
  var duplicatePage = new Function(
    "doc", "clone", "remintIds", "eachCourseNav", "pushHistory", "mount", "setActivePage", "focusFrame", "setSelection", "firstCopyOf",
    "var currentPage=0;\n" + dbody + "\nreturn duplicatePage;"
  )(doc, clone, remintIds, eachCourseNav, noop, noop, noop, noop, noop, firstCopyOf);

  duplicatePage(0);
  ok("page inserted right after source", doc.pages.length === 3 && doc.pages[2].id === "p2");
  var copy = doc.pages[1];
  ok("copy is a fresh page id", typeof copy.id === "string" && copy.id.indexOf("page-") === 0 && copy.id !== "src1");
  ok("copy name suffixed", copy.name === "Intro copy");
  ok("copy stays in source chapter", copy.chapterId === "c1");
  ok("copy carries page props", copy.padX === 40);
  ok("source untouched", doc.pages[0].id === "src1" && doc.pages[0].blocks[0].id === "b_1");
  var cids = [copy.blocks[0].id, copy.blocks[1].id, copy.blocks[1].children[0].id];
  ok("copy block ids reminted (fresh b_)", cids.every(function (x) { return /^b_\d+$/.test(x); }));
  ok("copy block ids differ from source", cids.indexOf("b_1") === -1 && cids.indexOf("b_2") === -1 && cids.indexOf("b_3") === -1);
  ok("copy block ids unique", new Set(cids).size === cids.length);
  var pids = doc.headerFooter.footer.children[0].sections[0].pageIds;
  ok("courseNav section synced (copy after source)", pids.join(",") === "src1," + copy.id + ",p2");
  // P2: no source title + no copy-type block -> copy title stays undefined (keeps auto-deriving)
  ok("P2 dup: no source title -> copy title undefined", copy.title === undefined);
  doc.pages[0].title = "Intro deck";
  duplicatePage(0);
  ok("P2 dup: source title -> ' copy' override", doc.pages[1].title === "Intro deck copy");

  // Regression: setSelection("page", 0) must NOT collapse index 0 to null (falsy-zero
  // bug -> renderPageInspector(null).id threw when selecting the FIRST page).
  var setSelStart = etxt.indexOf("function setSelection(type, node)");
  var setSelHead = etxt.slice(setSelStart, etxt.indexOf("if (node != null) {", setSelStart) + 20);
  ok("setSelection preserves index 0 (node != null guard)", setSelHead.indexOf("node != null ? node : null") !== -1 && setSelHead.indexOf("node || null") === -1);
})();

// ---- page-merge: mergePageWithNext (concat blocks, same-chapter guard, nav sync)
section("page-merge");
(function () {
  var etxt = src("src/editor.js");
  var s = etxt.indexOf("function mergePageWithNext(pi)");
  var body = etxt.slice(s, etxt.indexOf("\n  }", s) + 4);
  var doc = {
    pages: [
      { id: "a", chapterId: "c1", blocks: [{ type: "heading", id: "b_1" }] },
      { id: "b", chapterId: "c1", blocks: [{ type: "paragraph", id: "b_2" }, { type: "note", id: "b_3" }] },
      { id: "c", chapterId: "c2", blocks: [{ type: "quote", id: "b_4" }] }
    ],
    headerFooter: { footer: { children: [{ type: "courseNav", sections: [{ pageIds: ["a", "b", "c"] }] }] } }
  };
  var eachCourseNav = function (fn) {
    var hf = doc.headerFooter || {};
    [hf.header, hf.footer].forEach(function (r) { if (r && r.children) r.children.forEach(function (bl) { if (bl.type === "courseNav") fn(bl); }); });
  };
  var alerts = [], noop = function () {};
  var merge = new Function("doc", "eachCourseNav", "pushHistory", "mount", "setActivePage", "focusFrame", "setSelection", "window",
    "var currentPage=1;\n" + body + "\nreturn mergePageWithNext;")(doc, eachCourseNav, noop, noop, noop, noop, noop, { alert: function (m) { alerts.push(m); } });
  merge(0); // a + b (same chapter)
  ok("merge: pages reduced to 2", doc.pages.length === 2);
  ok("merge: blocks concatenated in order", doc.pages[0].blocks.map(function (x) { return x.id; }).join(",") === "b_1,b_2,b_3");
  ok("merge: second page removed", doc.pages[1].id === "c");
  ok("merge: courseNav pageIds cleaned", doc.headerFooter.footer.children[0].sections[0].pageIds.join(",") === "a,c");
  ok("merge: no alert on same-chapter merge", alerts.length === 0);
  merge(0); // a(c1) + c(c2) differ -> guarded
  ok("merge: cross-chapter blocked (alert, no change)", alerts.length === 1 && doc.pages.length === 2 && doc.pages[0].blocks.length === 3);
})();

// ---- outliner-name: blockLabel honours an author-given block.name ----------
section("outliner-name");
(function () {
  var etxt = src("src/editor.js");
  var s = etxt.indexOf("function blockLabel(b)");
  var body = etxt.slice(s, etxt.indexOf("return b.type;", s) + "return b.type;".length + 4);
  var blockLabel = new Function("COMPONENTS", body + "\nreturn blockLabel;")({});
  ok("author name wins over derived label", blockLabel({ name: "My Intro", type: "heading", text: "Heading text" }) === "My Intro");
  ok("no name -> derived label unchanged", blockLabel({ type: "heading", text: "Heading text" }) === "Heading text");
  ok("empty/absent name falls through", blockLabel({ name: "", type: "divider" }) === "Divider");
})();

// ---- MMMM: sanitizeText strips invisible / .notdef / control chars ---------
section("MMMM sanitize");
(function () {
  var etxt = src("src/editor.js");
  var s = etxt.indexOf("var INVISIBLE_RE =");
  var body = etxt.slice(s, etxt.indexOf("function sanitizeDeep", s));
  // repairMojibake delegates to window.__repairMojibake (render.js); stub it to identity
  // here so this section isolates the invisible/.notdef stripping.
  var sanitizeText = new Function("var window = {};" + body + "\nreturn sanitizeText;")();
  ok("strips zero-width space U+200B", sanitizeText("a​b") === "ab");
  ok("strips ZWNJ/ZWJ U+200C-200D", sanitizeText("a‌b‍c") === "abc");
  ok("strips soft hyphen U+00AD", sanitizeText("soft­hyphen") === "softhyphen");
  ok("strips BOM U+FEFF", sanitizeText("﻿hi") === "hi");
  ok("strips object/replacement U+FFFC/U+FFFD", sanitizeText("x￼y�z") === "xyz");
  ok("leaves normal text + accents/dashes untouched", sanitizeText("Hello — café!") === "Hello — café!");
  ok("non-string values pass through", sanitizeText(42) === 42 && sanitizeText(null) === null && sanitizeText(undefined) === undefined);
})();

// ---- Mojibake repair: ftfy-style legacy-decode round-trip (render.js) -------------
section("mojibake repair");
(function () {
  var rtxt = src("src/render.js");
  var etxt = src("src/editor.js");
  // extract the self-contained repair block from render.js (marker-delimited) and expose
  // its charset tables so the test can FORWARD-encode true mojibake (intended text ->
  // UTF-8 bytes -> legacy charset) and assert repair() is the exact inverse. This can't
  // drift from a hand-transcribed table (the old fixed table had a wrong ellipsis byte).
  var body = rtxt.slice(rtxt.indexOf("// [MOJIBAKE-REPAIR-START]"), rtxt.indexOf("// [MOJIBAKE-REPAIR-END]"));
  var M = new Function(body + "\nreturn { repairMojibake: repairMojibake, MACROMAN: MACROMAN, WIN1252: WIN1252 };")();
  var repair = M.repairMojibake;
  function utf8Bytes(s) { // JS string -> UTF-8 byte array
    var b = [], u = unescape(encodeURIComponent(s));
    for (var i = 0; i < u.length; i++) b.push(u.charCodeAt(i));
    return b;
  }
  function garble(intended, table) { // what a UTF-8-as-<table> bad decode produces
    var bytes = utf8Bytes(intended), out = "";
    for (var i = 0; i < bytes.length; i++) {
      var by = bytes[i];
      if (by < 0x80) out += String.fromCharCode(by);
      else { var cp = table[by - 0x80]; if (cp == null) return null; out += String.fromCharCode(cp); }
    }
    return out;
  }
  function roundtrips(intended, table) { var g = garble(intended, table); return g != null && g !== intended && repair(g) === intended; }
  // Mac-Roman (James's CONFIRMED sample: UTF-8 bytes decoded as Mac OS Roman)
  ok("Mac-Roman em dash — round-trips", roundtrips("a — b", M.MACROMAN));
  ok("Mac-Roman en dash – round-trips", roundtrips("x – y", M.MACROMAN));
  ok("Mac-Roman curly quotes “ ” ’ round-trip", roundtrips("“it’s” fine", M.MACROMAN));
  ok("Mac-Roman ellipsis … + bullet • round-trip", roundtrips("wait… • item", M.MACROMAN));
  ok("Mac-Roman arrows ↑ ↓ round-trip", roundtrips("go ↑ or ↓", M.MACROMAN));
  ok("Mac-Roman accented word café round-trips", roundtrips("un café", M.MACROMAN));
  // Windows-1252 (follow-up b -- landed in the SAME pass)
  ok("Win-1252 accented café round-trips", roundtrips("un café", M.WIN1252));
  ok("Win-1252 em dash — round-trips", roundtrips("a — b", M.WIN1252));
  // NB: U+201D (”) maps to byte 0x9D which is UNDEFINED in Win-1252, so it can't round-trip
  // through that charset (Mac-Roman covers it); use chars in defined Win-1252 slots here.
  ok("Win-1252 left-quote + apostrophe round-trip", roundtrips("“it’s fine", M.WIN1252));
  ok("Win-1252 euro € round-trips", roundtrips("costs €5", M.WIN1252));
  // Safety: correctly-encoded text is never corrupted (a lone high byte = invalid UTF-8)
  ok("plain ASCII untouched (no false positives)", repair("plain, ascii - text") === "plain, ascii - text");
  ok("legit accents + dashes untouched", repair("Hello — café naïve ½ résumé") === "Hello — café naïve ½ résumé");
  ok("empty / non-string pass through", repair("") === "" && repair(42) === 42 && repair(null) === null);
  ok("idempotent (already-clean text is a no-op)", repair(repair(garble("a — b", M.MACROMAN))) === "a — b");
  ok("exposed as window.__repairMojibake", /window\.__repairMojibake = repairMojibake;/.test(rtxt));
  // editor.js now delegates to the single render.js implementation (no fixed table)
  ok("editor repairMojibake delegates to window.__repairMojibake", /function repairMojibake\(s\) \{\s*return \(typeof s === "string" && typeof window\.__repairMojibake === "function"\) \? window\.__repairMojibake\(s\) : s;/.test(etxt));
  ok("editor sanitizeText still folds the repair in (via sanitizeDeep on load)", /function sanitizeText\(s\) \{ return typeof s === "string" \? repairMojibake\(s\)\.replace\(INVISIBLE_RE, ""\)/.test(etxt));
})();

// ---- htmlEmbed: bundled-src (block.src) interactions are decoded + repaired too ----
section("mojibake repair — bundled-src path");
(function () {
  var rtxt = src("src/render.js");
  // wiring: block.src is resolved to raw markup + mojibake-repaired, then rendered via
  // srcdoc (so it gets the theme shim + repair), falling back to src= only if undecodable.
  ok("block.src decoded via resolveEmbedHtml + repairMojibake", /var __srcHtml = block\.src \? repairMojibake\(resolveEmbedHtml\(block\.src\)\) : "";/.test(rtxt));
  ok("block.html path also repaired", /var __embedHtml = repairMojibake\(resolveEmbedHtml\(block\.html\)\);/.test(rtxt));
  ok("either markup renders via srcdoc with the theme shim", /if \(__html\) frame\.setAttribute\("srcdoc", __html \+ "\\n<script>" \+ EMBED_THEME_SHIM/.test(rtxt));
  ok("falls back to plain src= only when undecodable", /else frame\.setAttribute\("src", assetSrc\(block\.src\)\);/.test(rtxt));
  // functional: a bundled data:text/html file carrying Mac-Roman mojibake, decoded exactly
  // as resolveEmbedHtml does, then repaired -> clean markup ready for srcdoc.
  var body = rtxt.slice(rtxt.indexOf("// [MOJIBAKE-REPAIR-START]"), rtxt.indexOf("// [MOJIBAKE-REPAIR-END]"));
  var repair = new Function(body + "\nreturn repairMojibake;")();
  var reBody = rtxt.slice(rtxt.indexOf("function resolveEmbedHtml"), rtxt.indexOf("window.resolveEmbedHtml"));
  var resolveEmbedHtml = new Function("var window={};" + reBody + "\nreturn resolveEmbedHtml;")();
  function utf8Bytes(s) { var b = [], u = unescape(encodeURIComponent(s)); for (var i = 0; i < u.length; i++) b.push(u.charCodeAt(i)); return b; }
  var MAC = new Function(body + "\nreturn MACROMAN;")();
  function garble(s) { var by = utf8Bytes(s), o = ""; for (var i = 0; i < by.length; i++) o += by[i] < 0x80 ? String.fromCharCode(by[i]) : String.fromCharCode(MAC[by[i] - 0x80]); return o; }
  var mojibakeMarkup = garble("<p>press — then • go</p>");
  var dataUrl = "data:text/html," + encodeURIComponent(mojibakeMarkup); // what a bundled asset resolves to
  ok("bundled data:text/html decodes (resolveEmbedHtml) + repairs to clean copy",
    repair(resolveEmbedHtml(dataUrl)) === "<p>press — then • go</p>");
})();

// ---- editor-chrome sanitiser: drag-handle + pasted-block chrome never persists ----
section("field-html sanitiser");
(function () {
  var etxt = src("src/editor.js");
  var body = etxt.slice(etxt.indexOf("var CHROME_SIG ="), etxt.indexOf("function sanitizeDeep(v)"));
  var clean = new Function(body + "\nreturn sanitizeFieldHtml;")();
  var Q = String.fromCharCode(38) + "quot;"; // &quot;
  // drag-handle overlay captured into innerHTML -> removed, text kept
  ok("removes the drag-handle div + gripper", clean('Course Nav<div class="canvas-drag-handle" draggable="true" contenteditable="false" title="Drag to reorder">⠿</div>') === "Course Nav");
  ok("removes a bare gripper char in plain text", clean("Heading⠿") === "Heading");
  // pasted canvas block: strip is-selected + selection outline (the frozen blue box)
  var pasted = '<ul class="body-list canvas-block is-editable is-selected" data-edit="text" data-rich="1" spellcheck="false" style="outline: 1.5px solid var(--ui-accent); caret-color: rgb(1,2,3); margin: 4px 0; font-size: 11px;" contenteditable="true"><li>x</li></ul>';
  var out = clean(pasted);
  ok("drops is-selected + editor classes, keeps render class", /class="body-list"/.test(out) && !/is-selected|canvas-block|is-editable/.test(out));
  ok("drops the --ui-accent selection outline (the blue box)", !/--ui-accent|outline/.test(out));
  ok("drops caret-color but keeps author styles", !/caret-color/.test(out) && /margin: 4px 0/.test(out) && /font-size: 11px/.test(out));
  ok("strips contenteditable/data-edit/data-rich/spellcheck attrs", !/contenteditable|data-edit|data-rich|spellcheck/.test(out));
  // must NOT corrupt an entity-bearing font-family (a &quot; ends in a semicolon)
  ok("preserves &quot; entities in style values", clean('<span style="caret-color: red; font-family: -apple-system, ' + Q + 'Segoe UI' + Q + ', Roboto;">t</span>').indexOf(Q + "Segoe UI" + Q) !== -1);
  // signature-gated: clean content + author interaction HTML untouched (idempotent)
  ok("no-op on clean text", clean("Just a heading") === "Just a heading");
  ok("leaves author HTML-interaction markup (no chrome signature) untouched", clean('<div class="widget" data-x="1" style="color:red">Hi</div>') === '<div class="widget" data-x="1" style="color:red">Hi</div>');
  ok("idempotent", clean(out) === out);
  // wired at BOTH the commit chokepoint and the on-load deep clean
  ok("writeModel runs it on commit", /writeModel\(node, value\)[\s\S]*?sanitizeText\(sanitizeFieldHtml\(value\)\)/.test(etxt));
  ok("sanitizeDeep heals existing docs on load", /if \(typeof v === "string"\) return sanitizeText\(sanitizeFieldHtml\(v\)\)/.test(etxt));
  // plain-text paste (§3 P1): editable fields strip a rich paste to text/plain so it
  // inherits the target's style — and never re-imports foreign chrome at the source.
  var pasteBody = etxt.slice(etxt.indexOf('addEventListener("paste"'), etxt.indexOf('// rich fields allow line breaks'));
  ok("editable fields bind a paste handler", pasteBody.length > 0);
  ok("paste prevents the default rich paste", /e\.preventDefault\(\)/.test(pasteBody));
  ok("paste reads text/plain only", /getData\("text\/plain"\)/.test(pasteBody));
  ok("paste sanitises then inserts as plain text", /__sanitizeText\(text\)[\s\S]*execCommand\("insertText", false, text\)/.test(pasteBody));
})();

// ---- WWW: applying a saved text style strips inline colour so the style colour WINS ----
section("WWW apply-style colour");
(function () {
  var etxt = src("src/editor.js");
  var body = etxt.slice(etxt.indexOf("function stripInlineColor("), etxt.indexOf("window.__stripInlineColor"));
  var strip = new Function(body + "\nreturn stripInlineColor;")();
  // the core symptom: a baked colour span survives font/size apply -> must be removed
  ok("strips inline color from a span (trailing ;)", strip('<span style="color: red;">x</span>') === '<span>x</span>');
  ok("removes color-only style attr entirely", strip('<span style="color:#ff0000">Hi</span>') === '<span>Hi</span>');
  ok("keeps other decls, drops only color (leading)", strip('<span style="color: red; font-size: 11px">t</span>') === '<span style="font-size: 11px">t</span>');
  ok("keeps other decls, drops only color (trailing)", strip('<b style="font-weight:700;color:#123">t</b>') === '<b style="font-weight:700">t</b>');
  // must NOT touch background-color (the (?:^|;) anchor guards it) — highlights survive
  ok("preserves background-color highlight", strip('<mark style="background-color: yellow">h</mark>') === '<mark style="background-color: yellow">h</mark>');
  ok("drops color but keeps background-color when both present", strip('<span style="background-color: yellow; color: red">h</span>') === '<span style="background-color: yellow">h</span>');
  // safe / pure
  ok("no-op when no colour present", strip("<p>plain paragraph</p>") === "<p>plain paragraph</p>");
  ok("non-string passes through", strip(42) === 42 && strip(null) === null);
  ok("idempotent", strip(strip('<span style="color: red; margin: 2px">t</span>')) === strip('<span style="color: red; margin: 2px">t</span>'));
  // wired into the apply-style handler (styleRef set -> strip the field HTML + push history)
  ok("apply-style handler strips the field HTML", /host\.styleRef = v;[\s\S]*?stripInlineColor\(obj\[field\]\)/.test(etxt));
  ok("apply-style pushes history (undoable)", /pushHistory\(\);\s*\n\s*host\.styleRef = v;/.test(etxt));
})();

// ---- §4 theme-aware saved-text-style colour: bind to a theme token (flips light/dark) ----
section("theme-aware style colour");
(function () {
  var rtxt = src("src/render.js");
  var body = rtxt.slice(rtxt.indexOf("function applyTextStyle("), rtxt.indexOf("window.applyTextStyle"));
  var applyTextStyle = new Function("FONT_STACKS", body + "\nreturn applyTextStyle;")({});
  var n1 = { style: {} }; applyTextStyle(n1, { colorToken: "ink" });
  ok("token -> var(--color-ink)", n1.style.color === "var(--color-ink)");
  var n2 = { style: {} }; applyTextStyle(n2, { colorToken: "ink-soft" });
  ok("kebab token preserved", n2.style.color === "var(--color-ink-soft)");
  var n3 = { style: {} }; applyTextStyle(n3, { color: "#ff0000" });
  ok("raw hex still applies when no token", n3.style.color === "#ff0000");
  var n4 = { style: {} }; applyTextStyle(n4, { colorToken: "accent", color: "#ff0000" });
  ok("token wins over hex when both on one style", n4.style.color === "var(--color-accent)");
  var n5 = { style: {} }; applyTextStyle(n5, {});
  ok("no colour -> empty (inherits theme)", n5.style.color === "");
  // MM: InDesign options — case (text-transform) + first-line indent
  var n6 = { style: {} }; applyTextStyle(n6, { textTransform: "uppercase", textIndent: 24 });
  ok("MM: case emits text-transform", n6.style.textTransform === "uppercase");
  ok("MM: indent emits text-indent px", n6.style.textIndent === "24px");
  var n7 = { style: {} }; applyTextStyle(n7, {});
  ok("MM: unset case/indent -> empty", n7.style.textTransform === "" && n7.style.textIndent === "");
  // Per-mode text colour (colorField Per-mode tab): applyTextStyle emits color:var(--tc-c)
  var nPM = { style: {} }; applyTextStyle(nPM, { colorLight: "#111111", colorDark: "#eeeeee" });
  ok("per-mode text colour → color:var(--tc-c)", nPM.style.color === "var(--tc-c)");
  ok("course.css switches --tc-c by data-mode", /\[style\*="--tc-light"\] \{ --tc-c: var\(--tc-light\); \}/.test(src("src/course.css")) && /\.course-root\[data-mode="dark"\] \[style\*="--tc-light"\] \{ --tc-c: var\(--tc-dark\); \}/.test(src("src/course.css")));
  // MM: justify (4th align) + word-spacing
  var n8 = { style: {} }; applyTextStyle(n8, { align: "justify", wordSpacing: 4 });
  ok("MM: justify emits text-align:justify", n8.style.textAlign === "justify");
  ok("MM: word-spacing emits px", n8.style.wordSpacing === "4px");
  ok("MM: unset word-spacing -> empty", n7.style.wordSpacing === "");
  ok("Edit-style dialog offers a Justify align option", /\[Icon\("align-right"\), "right", "Right"\], \[Icon\("align-justify"\), "justify", "Justify"\]/.test(src("src/editor.js")));
  ok("Edit-style dialog saves word-spacing", /if \(draft\.wordSpacing == null \|\| isNaN\(draft\.wordSpacing\)\) delete s\.wordSpacing; else s\.wordSpacing = draft\.wordSpacing/.test(src("src/editor.js")));
  // resolveBlockStyle: a per-block override of ONE colour form drops the named style's OTHER form
  ok("resolveBlockStyle: hex override drops the style's token", /if \(ov\.color != null && ov\.color !== ""\) delete merged\.colorToken/.test(rtxt));
  ok("resolveBlockStyle: token override drops the style's hex", /else if \(ov\.colorToken\) delete merged\.color/.test(rtxt));
  // editor dialog: token XOR hex on save + specimen resolves the var
  var etxt = src("src/editor.js");
  ok("Edit-style dialog saves colorToken (token clears hex)", /s\.colorToken = draft\.colorToken; delete s\.color/.test(etxt));
  ok("Edit-style dialog offers theme-token options", /COLOUR_TOKENS = \[\["Ink", "ink"\]/.test(etxt));
  ok("specimen seeds theme vars so a token resolves in preview", /applyTheme\(specimen, activeTheme\(\)\); window\.applyTextStyle\(specimen, draft\)/.test(etxt));
  ok("MM: Edit-style dialog exposes a Case control + Indent field", /segmentedLive\("Case"/.test(etxt) && /"First-line indent"/.test(etxt));
  ok("MM: Edit-style dialog saves textTransform + textIndent", /s\.textTransform = draft\.textTransform;[\s\S]*?s\.textIndent = draft\.textIndent/.test(etxt));
  // body paragraphs default to full ink (matching .body-list), not ink-soft — else a
  // colourless text style leaves paragraphs a shade lighter than lists (James's mismatch).
  var ccss = src("src/course.css");
  var bcStart = ccss.indexOf(".body-copy {");
  var bodyCopy = ccss.slice(bcStart, ccss.indexOf("}", bcStart));
  ok(".body-copy default colour is --color-ink (not ink-soft)", /color:\s*var\(--color-ink\)\s*;/.test(bodyCopy) && !/color:\s*var\(--color-ink-soft\)\s*;/.test(bodyCopy));
})();

// ---- WWW retroactive: existing styleRef blocks get inline colour stripped on load ----
section("WWW retroactive auto-clean");
(function () {
  var etxt = src("src/editor.js");
  var body = etxt.slice(etxt.indexOf("function stripInlineColor("), etxt.indexOf("function normalizeDoc("));
  var strip = new Function("window", body + "\nreturn stripStyledColorsDeep;")({});
  var block = { type: "text", styleRef: "Heading", text: '<p><span style="color:red">Hi</span></p>' };
  strip(block);
  ok("strips colour from a styleRef block's field", block.text === "<p><span>Hi</span></p>");
  // "override always wins": strip even WITHOUT a styleRef (no in-app colour command ->
  // any inline colour is foreign paste residue). This is the white-note case James hit.
  var free = { type: "note", text: '<span style="color: rgb(255, 255, 255)">Hi</span>' };
  strip(free);
  ok("strips inline colour even with NO styleRef (the white-note bug)", free.text === "<span>Hi</span>");
  var nested = { pages: [{ blocks: [{ type: "columns", cols: [[{ type: "text", text: '<b style="color:#123">x</b>' }]] }] }] };
  strip(nested);
  ok("reaches nested blocks (no styleRef needed)", nested.pages[0].blocks[0].cols[0][0].text === "<b>x</b>");
  // embeds / interaction markup keep their colours: skip the html/svg/src fields + full docs
  var embed = { type: "htmlEmbed", html: '<!DOCTYPE html><html><body><span style="color:red">x</span></body></html>' };
  strip(embed);
  ok("preserves colour inside an embed html field", /color:red/.test(embed.html));
  var svg = { svg: '<svg><text style="color:red">x</text></svg>' };
  strip(svg);
  ok("skips the svg field", /color:red/.test(svg.svg));
  var fullDoc = { text: '<!DOCTYPE html><html><span style="color:red">x</span></html>' };
  strip(fullDoc);
  ok("skips a full-HTML-document string even in a text field", /color:red/.test(fullDoc.text));
  var keep = { styleRef: "Heading", text: "plain" };
  strip(keep);
  ok("plain non-HTML strings untouched", keep.text === "plain" && keep.styleRef === "Heading");
  var b2 = { text: '<i style="color:red">y</i>' }; strip(b2); var once = b2.text; strip(b2);
  ok("idempotent", b2.text === once && once === "<i>y</i>");
  ok("normalizeDoc runs the retroactive clean", /stripStyledColorsDeep\(d\);/.test(etxt));
})();

// ---- §10b shared component library slice 2: "Shared Library" palette insert ----
section("shared-library palette insert");
(function () {
  var etxt = src("src/editor.js");
  var reg = etxt.indexOf("SHARED component library (cross-course");
  ok("renderAssets adds a Shared Library palette section", reg > -1);
  var body = etxt.slice(reg, reg + 2200);
  ok("sources it from the cross-course libComponents(), not doc components", /var lib = libComponents\(\)/.test(body));
  ok("only surfaces composed defs (slot-def render fns aren't serialisable)", /kind === "composed" && lib\[k\]\.template/.test(body));
  ok("titles the section \"Shared Library\"", /"asset-group__title", "Shared Library"/.test(body));
  ok("insert drops a COPY of the template via insertBlock", /insertBlock\(clone\(comp\.template\)\)/.test(body));
  ok("collapse state persists like other palette groups", /setGroupCollapsed\("Shared Library"/.test(body));
})();

// ---- outliner multi-select spans columns / containers / pages (Shift + Cmd) ----
section("outliner multi-select any-scope");
(function () {
  var etxt = src("src/editor.js");
  ok("flatOutlineBlocks walks nested containers (recurses on openContainers)", /function flatOutlineBlocks[\s\S]*?openContainers\.has\(b\)[\s\S]*?walkBlocks\(grp\.blocks/.test(etxt));
  ok("flatOutlineBlocks spans pages + chapters", /function flatOutlineBlocks[\s\S]*?groupPagesByChapter[\s\S]*?walkPage/.test(etxt));
  var h = etxt.slice(etxt.indexOf("function handleBlockRowClick"), etxt.indexOf("function handleBlockRowClick") + 1400);
  ok("shift-range uses the flat cross-scope order (not one page's blocks)", /e\.shiftKey[\s\S]*?flatOutlineBlocks\(\)[\s\S]*?multiSel\.push\(flat\[k\]\.block\)/.test(h));
  ok("cmd/ctrl toggles multi at any depth", /e\.metaKey \|\| e\.ctrlKey[\s\S]*?toggleMulti\(block\)/.test(h));
  ok("BOTH top-level AND nested rows use the shared handler", (etxt.match(/handleBlockRowClick\(e, pi, block, bi, 0\)/) && etxt.match(/handleBlockRowClick\(e, pi, block, bi, depth\)/)) != null);
  // the pre-existing filter that dropped nested blocks on re-render is now nesting-aware
  ok("renderStructure keeps nested selections (findBlockParent, not top-level-only)", /multiSel = multiSel\.filter\(function \(b\) \{\s*\n\s*for \(var pi = 0; pi < doc\.pages\.length; pi\+\+\) if \(findBlockParent/.test(etxt));
  // actions on the whole set: delete + group resolve nested via findBlockParent
  var del = etxt.slice(etxt.indexOf("function deleteSelection"), etxt.indexOf("function deleteSelection") + 900);
  ok("multi-delete removes NESTED blocks too (findBlockParent)", /if \(multiSel\.length\)[\s\S]*?findBlockParent\(doc\.pages\[pi\]\.blocks, b\)[\s\S]*?parentArray\.splice/.test(del));
  var grp = etxt.slice(etxt.indexOf("function groupMulti"), etxt.indexOf("function groupMulti") + 1100);
  ok("groupMulti resolves by ref + needs one shared parent", /findBlockParent[\s\S]*?parentArray !== pa/.test(grp));
  // selection must persist through PAN (middle-click / space+left) — the deselect handler
  // returns early for pan gestures, but a plain left-click on empty canvas still deselects.
  ok("pan gestures don't clear the selection", /A PAN gesture[\s\S]*?if \(e\.button === 1 \|\| \(spaceHeld && e\.button === 0\)\) return;/.test(etxt));
})();

// ---- §105 batch-apply a text style / colour / align to a multi-selection ----
section("multi-selection batch style");
(function () {
  var etxt = src("src/editor.js");
  ok("renderInspector routes a >=2 multi-selection to the batch inspector", /if \(multiSel\.length >= 2\) \{ renderMultiInspector\(\)/.test(etxt));
  var m = etxt.slice(etxt.indexOf("function renderMultiInspector"), etxt.indexOf("function renderMultiInspector") + 3600);
  ok("filters the selection to text blocks (TEXT_STYLE_TYPES)", /multiSel\.filter\(function \(b\) \{ return TEXT_STYLE_TYPES\[b\.type\]/.test(m));
  ok("batch loops over EVERY selected text block", /function batch\(mut\) \{ pushHistory\(\); textBlocks\.forEach\(function \(b\) \{ mut\(b\)/.test(m));
  ok("offers a Text style picker applied to all", /customSelectRow\("Text style"[\s\S]*?applyStyleToBlock\(b, v\)/.test(m));
  ok("offers a batch Colour (token or custom)", /b\.style\.colorToken = v[\s\S]*?colourControl\("Custom colour"/.test(m) || /colourControl\("Custom colour"[\s\S]*?b\.style\.colorToken = v/.test(m));
  ok("offers a batch Align", /segmentedIconLive\("Align"[\s\S]*?b\.style\.align = v/.test(m));
  var a = etxt.slice(etxt.indexOf("function applyStyleToBlock"), etxt.indexOf("function applyStyleToBlock") + 300);
  ok("applyStyleToBlock references the style, clears overrides, strips colour", /block\.styleRef = styleName;\s*\n\s*block\.style = \{\};\s*\n\s*stripStyledColorsDeep\(block\)/.test(a));
  // multi-select mutation points refresh the inspector so the panel appears immediately
  ok("outliner multi-select refreshes the inspector", /refreshCanvasSelection\(\); renderInspector\(\); return;/.test(etxt));
})();

// ---- DDD: undo coverage — structural mutators push history, redo invalidates
section("DDD undo-coverage");
(function () {
  var t = src("src/editor.js");
  function bodyOf(name) { var s = t.indexOf("function " + name + "("); return s < 0 ? "" : t.slice(s, t.indexOf("\n  }", s) + 4); }
  ok("duplicateBlock pushes history", /pushHistory\(\)/.test(bodyOf("duplicateBlock")));
  ok("moveBlock pushes history", /pushHistory\(\)/.test(bodyOf("moveBlock")));
  ok("insertBlock pushes history", /pushHistory\(\)/.test(bodyOf("insertBlock")));
  ok("deleteBlockByRef pushes history", /pushHistory\(\)/.test(bodyOf("deleteBlockByRef")));
  // redo-invalidation: pushHistory must clear redoStack
  ok("pushHistory clears redoStack (redo-invalidation)", /function pushHistory\(\)[\s\S]*?redoStack = \[\]/.test(t));
})();

// ---- §2 chapter progression: gated wiring present (opt-in, ungated unchanged)
section("chapter-progression");
(function () {
  var rt = src("src/runtime.js");
  ok("gated detected on root OR a descendant", /getAttribute\("data-gated-progression"\)[\s\S]*?querySelector\("\[data-gated-progression\]"\)/.test(rt));
  ok("kc-complete listener sets kcPassed + changed", /addEventListener\("kc-complete"[\s\S]*?state\.kcPassed\[c\] = true; state\.kcHold\[c\] = true; changed\(\)/.test(rt));
  ok("chapterAdvanceOk hard-blocks at a chapter's last page", /function kcGateAllows\([\s\S]*?pages\[pages\.length - 1\] === pid/.test(rt));
  // #87: post-KC-pass hold delays the Next-ENABLE (kcPassed still flips at once)
  ok("kcHold state initialised", /state\.kcHold = \{\}/.test(rt));
  ok("kc-complete arms the hold then clears it on a timer", /state\.kcHold\[c\] = true; changed\(\);[\s\S]*?setTimeout\(function \(\) \{ delete state\.kcHold\[c\]; changed\(\); \}, KC_UNLOCK_MS\)/.test(rt));
  ok("KC_UNLOCK_MS is the 3s standard beat", /var KC_UNLOCK_MS = 3000;/.test(rt));
  // behavioural guard on the pure gate: a held pass is still blocked at the last page
  (function () {
    var a = rt.indexOf("/* @kcgate-start */"), b = rt.indexOf("/* @kcgate-end */");
    if (a < 0 || b < 0) { ok("locate @kcgate fence", false); return; }
    var g = new Function(rt.slice(a, b) + "\nreturn kcGateAllows;")();
    var chapMap = [{ id: "c1", pages: ["p1", "p2"] }];             // p2 = last page of c1
    var cop = { p1: "c1", p2: "c1" };
    ok("kcGate: ungated always advances", g(false, {}, {}, cop, chapMap, "p2") === true);
    ok("kcGate: unpassed blocks the last page", g(true, {}, {}, cop, chapMap, "p2") === false);
    ok("kcGate: unpassed is free within the chapter", g(true, {}, {}, cop, chapMap, "p1") === true);
    ok("kcGate: passed + HELD is still blocked at the last page (#87 delay)", g(true, { c1: true }, { c1: true }, cop, chapMap, "p2") === false);
    ok("kcGate: passed + hold cleared unlocks the last page", g(true, { c1: true }, {}, cop, chapMap, "p2") === true);
  })();
  ok("Next button gated by chapterAdvanceOk (visible disable)", /pass = pass && chapterAdvanceOk\(\)/.test(rt));
  ok("jump menu unlocks by KC-pass when gated", /if \(state\.__gated\)[\s\S]*?state\.kcPassed\[map\[gi - 1\]\.id\]/.test(rt));
  ok("no-quiz chapter auto-passes", /if \(!chapterHasQuiz\[c\.id\]\) state\.kcPassed\[c\.id\] = true/.test(rt));
  ok("completion gated on all chapter KCs", /var kcOk = !gated \|\| chapMap\.every/.test(rt));
  var qr = src("src/quiz-runtime.js");
  ok("quiz dispatches kc-complete on pass", /dispatchEvent\(new CustomEvent\("kc-complete", \{ bubbles: true \}\)\)/.test(qr));
  var rn = src("src/render.js");
  // §64: chapter summary moved INTO the quiz completion panel; per-block recap retired
  // #82: summary renders AS the list <ul> primitive (was a plain <div> — an empty <div> had
  // no list affordance so a fresh quiz couldn't start a summary). Seeds one <li> when empty.
  ok("kc-done panel renders the Chapter summary as an editable <ul>", /editable\("ul", "kc-done__summary", block\.done, "summary", true, "summaryStyle"\)/.test(rn));
  ok("empty summary is seeded with one clickable bullet", /if \(!\/<li\/i\.test\(sum\.innerHTML\)\) sum\.innerHTML = "<li><\/li>"/.test(rn));
  var _ed64s = src("src/editor.js");
  // #82: migration now stores BARE <li> items (no wrapping <ul>) so feeding them into the
  // <ul> tag doesn't nest a list-in-a-list.
  ok("normalizeDoc flattens summary to bare <li> items (no <ul> wrap)", /function normalizeSummary\(html\)[\s\S]*?return lines\.length \? lines\.map[\s\S]*?join\(""\) : ""/.test(_ed64s));
  ok("normalizeDoc no longer wraps summary in <ul>", !/normalizeSummary[\s\S]*?"<ul>" \+ lines\.map/.test(_ed64s));
  ok("render no longer stamps data-recap (recap retired)", !/setAttribute\("data-recap"/.test(rn));
  var _css64 = src("src/course.css");
  ok("kc-done summary hidden at runtime when it has no non-empty bullet", /\.kc-done__summary-wrap:has\(\.kc-done__summary:not\(:has\(li:not\(:empty\)\)\)\)\s*\{\s*display:\s*none/.test(_css64));
  // #82 behavioural guard: the migration core, in isolation. Empty stays empty (render seeds
  // a bullet), plain text is untouched, a legacy <ul>-wrapped list flattens to bare <li>s, and
  // it is idempotent (bare <li> in -> same bare <li> out, never re-wrapped).
  (function () {
    function normalizeSummary(html) {
      if (html == null) return html;
      var str = String(html);
      if (!/<li/i.test(str)) return str;
      var t = str.replace(/<(ul|ol|li|div|p)[^>]*>/gi, "\n").replace(/<\/(ul|ol|li|div|p)\s*>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
      var lines = t.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
      return lines.length ? lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") : "";
    }
    ok("summary: empty stays empty", normalizeSummary("") === "");
    ok("summary: plain text untouched", normalizeSummary("just a note") === "just a note");
    ok("summary: legacy <ul>-wrapped -> bare <li>s", normalizeSummary("<ul><li>a</li><li>b</li></ul>") === "<li>a</li><li>b</li>");
    ok("summary: bare <li> is idempotent", normalizeSummary("<li>a</li><li>b</li>") === "<li>a</li><li>b</li>");
    ok("summary: never nests <ul> in the result", normalizeSummary("<ul><li>x</li></ul>").indexOf("<ul>") === -1);
  })();
  var _ed64 = src("src/editor.js");
  ok("per-block Chapter recap toggle removed", !/switchRow\("Chapter recap"/.test(_ed64));
  ok("normalizeDoc migrates away block.recap", /function stripRecap\(blocks\)[\s\S]*?if \(b\.recap\) delete b\.recap/.test(_ed64));
  var _rt64 = src("src/runtime.js");
  ok("runtime recap reveal path removed", !/applyRecaps\(\)/.test(_rt64));
})();

// ---- §5 auto-gate ALL interactions: one course switch requires every DETECTABLE
// interaction (quiz/hotspot/video/checkbox/card) before Next; opaque HTML embeds excluded
section("auto-gate all interactions");
(function () {
  var rt = src("src/runtime.js"), rn = src("src/render.js"), ed = src("src/editor.js");
  // setting -> per-pass hook -> render flag
  ok("editor sets __gateAllInteractions on export", /window\.__gateAllInteractions = renderDoc\.gateAllInteractions \|\| null/.test(ed));
  ok("editor sets __gateAllInteractions on preview", /window\.__gateAllInteractions = doc\.gateAllInteractions \|\| null/.test(ed));
  ok("render stamps data-gate-all from the hook", /if \(window\.__gateAllInteractions\) root\.setAttribute\("data-gate-all", "1"\)/.test(rn));
  ok("inspector writes doc.gateAllInteractions (default off)", /switchRow\("Require all interactions before Next", function \(\) \{ return !!doc\.gateAllInteractions;[\s\S]*?doc\.gateAllInteractions = true; else delete doc\.gateAllInteractions/.test(ed));
  // state buckets for the new signals
  ok("runtime adds viewed/revealed/quizDone/sequenceDone/accordionDone buckets", /var state = \{ visited: \{\}, watched: \{\}, checked: \{\}, viewed: \{\}, revealed: \{\}, quizDone: \{\}, sequenceDone: \{\}, accordionDone: \{\} \}/.test(rt));
  // completion emitters (decoupled, bubbling)
  ok("hotspot emits hotspot-complete when all markers viewed", /viewed >= total\) \{ try \{ stage\.dispatchEvent\(new CustomEvent\("hotspot-complete", \{ bubbles: true \}\)\)/.test(rt));
  ok("card grid emits card-reveal-complete when all cards revealed", /function maybeCardComplete\(grid\)[\s\S]*?every\(function \(c\) \{ return c\.classList\.contains\("is-revealed"\)[\s\S]*?dispatchEvent\(new CustomEvent\("card-reveal-complete"/.test(rt));
  ok("maybeCardComplete called after each reveal", (rt.match(/maybeCardComplete\(grid\)/g) || []).length >= 5); // def + 4 handlers
  ok("kc-complete -> quizDone, hotspot-complete -> viewed, card-reveal-complete -> revealed", /addEventListener\("kc-complete", function \(e\) \{ markDone\("quizDone"[\s\S]*?addEventListener\("hotspot-complete", function \(e\) \{ markDone\("viewed"[\s\S]*?addEventListener\("card-reveal-complete", function \(e\) \{ markDone\("revealed"/.test(rt));
  ok("markDone sets the bucket for the block id + changed()", /function markDone\(bucket, target\)[\s\S]*?state\[bucket\]\[id\] = true; changed\(\)/.test(rt));
  // target derivation covers every chosen type, opaque embeds omitted
  ok("autoGateTargets enumerates video/vimeo/hotspot/card/seq/accordion/quiz", /function autoGateTargets\(pageEl\)[\s\S]*?"video"[\s\S]*?vimeo\.com[\s\S]*?"watched"[\s\S]*?hotspot-stage[\s\S]*?"viewed"[\s\S]*?card-reveal[\s\S]*?"revealed"[\s\S]*?\.seq[\s\S]*?"sequenceDone"[\s\S]*?data-accordion[\s\S]*?"accordionDone"[\s\S]*?data-quiz[\s\S]*?"quizDone"/.test(rt));
  ok("autoGateTargets stamps a transient id on un-authored hosts (ensureGateId)", /function ensureGateId\(el\)[\s\S]*?"rtg_" \+ \(\+\+gateIdCtr\)/.test(rt) && /var id = ensureGateId\(el\); if \(!id\) return;/.test(rt));
  ok("opaque HTML embeds are NOT auto-gated (no signal)", !/autoGateTargets[\s\S]*?embed--html|autoGateTargets[\s\S]*?data-embed="html"/.test(rt));
  ok("untracked hotspot (data-track-viewed=0) excluded", /data-track-viewed"\)\s*=== "0"\) return;/.test(rt));
  ok("hotspot without markers excluded", /if \(!qsAll\(st, "\.hotspot-marker"\)\.length\) return;/.test(rt));
  // enforcement: Next gate + completion both require the auto-gates
  ok("pageGates keys off the PER-PAGE data-gate-page=1 (not course root)", /function pageGates\(pageEl\) \{ return !!\(pageEl && pageEl\.getAttribute && pageEl\.getAttribute\("data-gate-page"\) === "1"\)/.test(rt));
  ok("render stamps data-gate-page per page (course default + per-page override)", /if \(__gp === true \|\| \(__gp == null && window\.__gateAllInteractions\)\) section\.setAttribute\("data-gate-page", "1"\)/.test(rn));
  ok("autoGatePass fail-OPEN when the page isn't gated", /function autoGatePass\(pageEl\) \{\s*if \(!pageGates\(pageEl\)\) return true;/.test(rt));
  ok("gateFooterNav also requires autoGatePass", /var autoOk = autoGatePass\(pageEl\);[\s\S]*?pass = pass && autoOk;/.test(rt));
  // checkbox gates are LIVE (not sticky): re-locks Next when a box reads unchecked on return
  ok("evalCondition checkbox reads the LIVE box, not the bucket", /if \(c\.is === "checked"\) \{[\s\S]*?querySelector\('input\[type="checkbox"\]'\)[\s\S]*?return !!box\.checked;/.test(rt));
  ok("autoGatePass live-evaluates ALL checkboxes (every ticked)", /var boxesOk = qsAll\(pageEl, 'input\[type="checkbox"\]'\)\.every[\s\S]*?return host \? !!cb\.checked : true;[\s\S]*?if \(!boxesOk\) return false;/.test(rt));
  ok("autoGatePass leaves non-checkbox targets sticky", /return t\.is === "checked" \? true : evalCondition\(t\);/.test(rt));
  ok("checkComplete requires all gated pages' interactions (last-page hole)", /var autoOk = qsAll\(root, "\.page\[data-page-id\]"\)\.every[\s\S]*?autoGatePass\(pageEl\)[\s\S]*?allVisited && reqOk && kcOk && autoOk/.test(rt));
  // #108: the footer Next is HIDDEN on the last page (no page after it -> a dead control).
  ok("gateFooterNav derives isLast from nav.pageIds()/currentPageId", /var isLast = ids\.length > 0 && pid != null && ids\[ids\.length - 1\] === pid/.test(rt));
  ok("gateFooterNav hides Next on the last page", /qsAll\(cr, "\.course-nav__next"\)\.forEach\(function \(btn\) \{\s*btn\.hidden = isLast;/.test(rt));
  // pure core of the hide rule: last page -> hidden, any earlier page -> shown.
  var lastPageHidesNext = function (ids, pid) { return ids.length > 0 && pid != null && ids[ids.length - 1] === pid; };
  ok("last-page predicate: true only on the final page id", lastPageHidesNext(["a", "b", "c"], "c") === true &&
     lastPageHidesNext(["a", "b", "c"], "b") === false && lastPageHidesNext(["a", "b", "c"], "a") === false);
  ok("last-page predicate: single-page course hides Next", lastPageHidesNext(["only"], "only") === true);
  ok("last-page predicate: no pages / no current -> shown (fail open)", lastPageHidesNext([], "x") === false && lastPageHidesNext(["a"], null) === false);
})();

// Interaction-gate: the blocked Next must be VISIBLE + EXPLAINED (grey + reminder), not a
// dead disabled button (the reason page-gating never stuck). Plus per-page authoring,
// sequence/accordion emitters, and the author-overridable reminder copy.
section("interaction-gate: visible + explained (grey Next + reminder)");
(function () {
  var rt = src("src/runtime.js"), rn = src("src/render.js"), css = src("src/course.css"), ed = src("src/editor.js"), ex = src("src/export.js");
  // no longer self-disables (a disabled button fires no click -> no reminder possible)
  ok("gateFooterNav does NOT set btn.disabled", !/btn\.disabled = !pass/.test(rt));
  ok("gateFooterNav marks aria-disabled + .is-nav-gated instead", /btn\.classList\.toggle\("is-nav-gated", !pass\)[\s\S]*?setAttribute\("aria-disabled", "true"\)/.test(rt));
  ok("gateFooterNav toggles the reminder hint on interaction-block", /qsAll\(cr, "\[data-gate-hint\]"\)\.forEach\(function \(hint\) \{\s*hint\.hidden = !\(interactionsBlock && !isLast\);/.test(rt));
  // click intercept: gated Next is swallowed + nudged, never navigates
  ok("click handler intercepts a gated Next (nudge, no advance)", /if \(act === "next" && na\.classList\.contains\("is-nav-gated"\)\) \{ e\.preventDefault\(\); nudgeGatedNext\(na\); return; \}/.test(rt));
  ok("nudgeGatedNext shakes the button + flashes the hint", /function nudgeGatedNext\(btn\)[\s\S]*?is-nudge[\s\S]*?data-gate-hint[\s\S]*?is-flash/.test(rt));
  // render emits the hidden reminder element (pure; runtime only toggles it)
  ok("render emits the gate-hint element with default copy", /course-nav__gate-hint[\s\S]*?data-gate-hint[\s\S]*?Complete the interactions on this page to continue/.test(rn));
  ok("gate-hint copy is author-overridable via __gateMessage", /window\.__gateMessage \|\| "Complete the interactions on this page to continue\."/.test(rn));
  // CSS makes the gated Next grey but STILL clickable (overriding aria-disabled's pointer-events:none)
  ok("gated Next is greyed but pointer-events:auto (clickable to intercept)", /\.course-nav__next\.is-nav-gated \{ opacity: 0\.45; cursor: not-allowed; pointer-events: auto; \}/.test(css));
  ok("gate-hint + nudge honour prefers-reduced-motion", /prefers-reduced-motion: reduce\) \{ \.course-nav__next\.is-nudge, \.course-nav__gate-hint\.is-flash \{ animation: none; \}/.test(css));
  // new completion emitters: sequence + accordion
  ok("sequence emits sequence-complete at end / all revealed", /function seqComplete\(\)[\s\S]*?dispatchEvent\(new CustomEvent\("sequence-complete", \{ bubbles: true \}\)\)/.test(rt));
  ok("accordion emits accordion-complete once every section opened", /dispatchEvent\(new CustomEvent\("accordion-complete", \{ bubbles: true \}\)\)/.test(rt) && /Object\.keys\(opened\)\.length >= count/.test(rt));
  ok("engine listens for sequence-complete/accordion-complete", /addEventListener\("sequence-complete", function \(e\) \{ markDone\("sequenceDone"[\s\S]*?addEventListener\("accordion-complete", function \(e\) \{ markDone\("accordionDone"/.test(rt));
  ok("gate ids pre-stamped before binders (bind-time completion isn't lost)", /qsAll\(root, "video, iframe\[src\*='vimeo\.com'\], \.hotspot-stage, \.card-reveal, \.seq, \[data-accordion\], \[data-quiz\]"\)\.forEach\(function \(el\) \{\s*ensureGateId/.test(rt));
  // export ships the flags (was relying on a stale editor global) + the message
  ok("export sets __gateAllInteractions (no longer stale-global)", /window\.__gateAllInteractions = doc\.gateAllInteractions \|\| null/.test(ex));
  ok("export sets __gateMessage", /window\.__gateMessage = doc\.gateMessage \|\| null/.test(ex));
  // authoring: per-page override in the page inspector + course-level message field
  ok("page inspector writes tri-state page.gateInteractions", /if \(v === "on"\) page\.gateInteractions = true;\s*else if \(v === "off"\) page\.gateInteractions = false;\s*else delete page\.gateInteractions;/.test(ed));
  ok("progression panel exposes the reminder-message field", /gmIn\.value = doc\.gateMessage \|\| "";[\s\S]*?if \(v\) doc\.gateMessage = v; else delete doc\.gateMessage/.test(ed));
})();

// ---- footer nav pin: framed forced-device preview pins prev/next to the device
//      corners (absolute), matching the runtime export's fixed pin. Guards the
//      regression where the framed preview dropped the buttons back to inline
//      (static) gutters, so they no longer stuck to the corners at smaller sizes.
section("footer nav corner-pin: framed preview matches export");
(function () {
  var ec = src("editor.css");
  // runtime pin (course.css) is unchanged: fixed to the viewport at 24/12/16px.
  var cc = src("src/course.css");
  ok("runtime: pin uses position:fixed (viewport corners)", /\.course-root\[data-env="runtime"\] \.course-nav--pin \.course-nav__prev,\s*\.course-root\[data-env="runtime"\] \.course-nav--pin \.course-nav__next \{\s*position: fixed;/.test(cc));
  // framed preview: prev/next are ABSOLUTE-pinned (contained by the device, no ghost),
  // NOT reverted to static inline gutters.
  ok("framed preview: nav buttons pin position:absolute (not static)", /\.demo__device--framed \.course-root\[data-env="runtime"\] \.course-nav--pin \.course-nav__prev,\s*\.demo__device--framed \.course-root\[data-env="runtime"\] \.course-nav--pin \.course-nav__next \{ position: absolute;/.test(ec));
  ok("framed preview: does NOT revert prev/next to static gutters", !/\.course-nav--pin \.course-nav__next \{ position: static;/.test(ec));
  ok("framed preview: prev/next hug the same corners as runtime (24px / 12px mobile)", /\.demo__device--framed[^\n]*\.course-nav__prev \{ left: 24px; \}/.test(ec) && /\.demo__device--framed[^\n]*\[data-bp="mobile"\][^\n]*\.course-nav__prev \{ left: 12px; \}/.test(ec));
  ok("framed preview: course-root is the positioned anchor + fills the fold", /\.demo__device--framed \.course-root\[data-env="runtime"\] \{ position: relative; min-height: 100%; \}/.test(ec));
})();

// ---- named text styles: rename repoints styleRef + blocks collisions -------
section("named-styles rename");
(function () {
  var t = src("src/editor.js");
  var body = t.slice(t.indexOf("function renameTextStyle(oldName, newName)"), t.indexOf("window.__renameTextStyle"));
  ok("blocks a rename that collides with an existing style", /if \(styles\[newName\]\)[\s\S]*?return false/.test(body));
  ok("no-op on empty/same name", /if \(!newName \|\| newName === oldName\) return false/.test(body));
  ok("repoints every styleRef to the new name (deep walk)", /v\.styleRef === oldName\) v\.styleRef = newName/.test(body));
})();

// ---- Glossary: structured term/def model (table + CSV), searchable popover ---
section("glossary");
(function () {
  var etxt = src("src/editor.js");
  // glossaryTerms(d): cleans doc.glossary.terms -> [{term,def}] (or null when empty).
  var s = etxt.indexOf("function glossaryTerms(d)");
  var e = etxt.indexOf("window.__glossaryTermsFn = glossaryTerms;") + "window.__glossaryTermsFn = glossaryTerms;".length;
  var win = {};
  new Function("window", etxt.slice(s, e))(win);
  var g = win.__glossaryTermsFn;
  ok("null when no terms", g({}) === null && g({ glossary: {} }) === null && g({ glossary: { terms: [] } }) === null && g(null) === null);
  ok("drops wholly-empty rows, keeps rows with any text", JSON.stringify(g({ glossary: { terms: [{ term: "RF", def: "radio" }, { term: "", def: "" }, { term: "UAS", def: "" }] } })) === JSON.stringify([{ term: "RF", def: "radio" }, { term: "UAS", def: "" }]));
  ok("coerces term/def to strings", JSON.stringify(g({ glossary: { terms: [{ term: 12, def: null }] } })) === JSON.stringify([{ term: "12", def: "" }]));

  // parseGlossaryCsv(text): header-skip + trim + empty-drop over CSVBind.parseCSV rows.
  var s2 = etxt.indexOf("function parseGlossaryCsv(text)");
  var e2 = etxt.indexOf("window.parseGlossaryCsv = parseGlossaryCsv;") + "window.parseGlossaryCsv = parseGlossaryCsv;".length;
  var win2 = { CSVBind: { parseCSV: function (t) { return String(t).replace(/\r/g, "").split("\n").filter(function (l) { return l.trim() !== ""; }).map(function (l) { return l.split(","); }); } } };
  new Function("window", etxt.slice(s2, e2))(win2);
  var pg = win2.parseGlossaryCsv;
  ok("skips a Term,Definition header row", JSON.stringify(pg("Term,Definition\nRF, radio frequency\nUAS, drone")) === JSON.stringify([{ term: "RF", def: "radio frequency" }, { term: "UAS", def: "drone" }]));
  ok("keeps the first row when it is NOT a header", JSON.stringify(pg("RF,radio\nUAS,drone")) === JSON.stringify([{ term: "RF", def: "radio" }, { term: "UAS", def: "drone" }]));
  ok("empty csv -> []", JSON.stringify(pg("")) === "[]");

  // render: the glossary button + a static, searchable term/def popover (no image path).
  var rsrc = src("src/render.js");
  ok("render reads window.__glossaryTerms (not the old image hook)", /var gterms = window\.__glossaryTerms;/.test(rsrc) && !/window\.__glossary\b(?!Terms)/.test(rsrc));
  ok("render emits the glossary popover with a live filter input", /el\("div", "glossary-pop"\)/.test(rsrc) && /data-glossary-filter/.test(rsrc));
  ok("each term row carries a lowercased term+def haystack for the filter", /grow\.setAttribute\("data-term", \(trm \+ " " \+ def\)\.toLowerCase\(\)\)/.test(rsrc));
  ok("render emits the empty state", /el\("div", "glossary-pop__empty", "No matching terms\."\)/.test(rsrc));

  // runtime: the filter hides non-matching rows + toggles the empty state.
  var rt = src("src/runtime.js");
  ok("runtime filters rows by substring over data-term", /\(r\.getAttribute\("data-term"\) \|\| ""\)\.indexOf\(q\) !== -1/.test(rt));
  ok("runtime shows the empty state only when nothing matches", /empty\.hidden = shown !== 0/.test(rt));

  // wiring: editor (render + preview) and export all ship the terms list.
  ok("editor sets window.__glossaryTerms on render + preview", (etxt.match(/window\.__glossaryTerms = glossaryTerms\(/g) || []).length === 2);
  ok("export ships window.__glossaryTerms", /window\.__glossaryTerms = \(window\.__glossaryTermsFn && window\.__glossaryTermsFn\(doc\)\) \|\| null/.test(src("src/export.js")));

  // settings: canonical repeatedList table + CSV import (no image upload left).
  ok("glossary settings build the canonical repeatedList term table", /repeatedList\(c, "Terms", \{/.test(etxt));
  ok("glossary settings offer CSV import + drop the old image upload", /Import CSV \(Term, Definition\)/.test(etxt) && !/Upload glossary image/.test(etxt));

  // merge/dedup by term (case-insensitive): later def wins, first casing + position kept.
  var s3 = etxt.indexOf("function mergeGlossaryTerms(existing, incoming)");
  var e3 = etxt.indexOf("window.mergeGlossaryTerms = mergeGlossaryTerms;") + "window.mergeGlossaryTerms = mergeGlossaryTerms;".length;
  var win3 = {};
  new Function("window", etxt.slice(s3, e3))(win3);
  var mg = win3.mergeGlossaryTerms;
  ok("import de-dupes by term (case-insensitive) — later def wins, position kept", JSON.stringify(mg([{ term: "RF", def: "old" }, { term: "UAS", def: "drone" }], [{ term: "rf", def: "new" }, { term: "CNI", def: "infra" }])) === JSON.stringify([{ term: "RF", def: "new" }, { term: "UAS", def: "drone" }, { term: "CNI", def: "infra" }]));
  ok("merge keeps empty-term rows (not de-duped)", JSON.stringify(mg([{ term: "", def: "a" }], [{ term: "", def: "b" }])) === JSON.stringify([{ term: "", def: "a" }, { term: "", def: "b" }]));
  ok("CSV import path MERGES (de-dupes), not concat", /doc\.glossary\.terms = mergeGlossaryTerms\(doc\.glossary\.terms, added\)/.test(etxt) && !/doc\.glossary\.terms = doc\.glossary\.terms\.concat\(added\)/.test(etxt));
  ok("glossary settings offer a guarded Clear all", /Clear all terms/.test(etxt) && /doc\.glossary\.terms = \[\];/.test(etxt) && /confirm\(/.test(etxt));
})();

// ---- §1 P2: nav-pill cleanup (title above bar, bar centred, glyphs +~20%) ---
// ---- chapter menu: viewport-centred at runtime + close box + outside-click ----
section("chapter menu dismiss");
(function () {
  var css = src("src/course.css");
  var r = src("src/render.js");
  var rt = src("src/runtime.js");
  ok("render emits a top-right close box", /course-nav__modal-close/.test(r) && /data-modal-close/.test(r));
  ok("runtime dismisses on the close box", /e\.target\.closest\("\[data-modal-close\]"\)\) \{ e\.stopPropagation\(\); modal\.hidden = true;/.test(rt));
  ok("runtime dismisses on outside click", /if \(e\.target\.closest && e\.target\.closest\("\.course-nav"\)\) return;\s*closeModals\(null\);/.test(rt));
  ok("chapter menu spans + centres on the pill (absolute, left:0/right:0)", /\.course-nav__modal \{[^}]*position: absolute;[^}]*left: 0; right: 0;/.test(css));
  ok("glossary popover matches the menu: spans + centres on the pill (left:0/right:0)", /\.glossary-pop \{[^}]*position: absolute;[^}]*left: 0; right: 0;/.test(css));
  ok("the LIST scrolls (close box stays pinned), not the modal", /\.course-nav__modal-list \{[^}]*overflow-y: auto;/.test(css) && /\.course-nav__modal \{[^}]*overflow: hidden;/.test(css));
})();

// ---- #168 Nav settings single-source: Settings 'Learner nav' targets the canonical footer nav ----
section("#168 learner-nav single source");
(function () {
  var e = src("src/editor.js");
  // The Settings 'Learner nav' tab must resolve the CANONICAL footer nav (footerCourseNav),
  // not the FIRST courseNav eachCourseNav yields (header -> footer -> pages), which drifts to
  // a legacy/header stray away from the footer nav the author edits on the canvas.
  ok("Settings 'Learner nav' tab uses footerCourseNav (not first-found)", /key: "nav", title: "Learner nav", build: function \(host\) \{ var n = footerCourseNav\(\);/.test(e));
  ok("old first-found pattern is gone from the nav tab", !/title: "Learner nav"[\s\S]{0,120}eachCourseNav\(function \(x\) \{ if \(!n\) n = x; \}\)/.test(e));
  // footerCourseNav resolves ONLY the footer region's courseNav (the single creatable instance).
  var fn = slice(e, "function footerCourseNav()", "\n  }");
  ok("footerCourseNav reads doc.headerFooter.footer", /doc\.headerFooter && doc\.headerFooter\.footer/.test(fn));
  ok("footerCourseNav walks the footer children for a courseNav", /walkPageBlocks\(f\.children, function \(b\) \{ if \(b\.type === "courseNav" && !found\) found = b; \}\)/.test(fn));
  // The canvas side panel still edits the SELECTED nav (direct manipulation) — when the footer
  // nav is selected that is the SAME object footerCourseNav returns, so the two surfaces mirror.
  ok("side-panel nav inspector edits the selected node", /function renderCourseNavInspector\(node\) \{[\s\S]{0,160}courseNavControls\(block, inspector\)/.test(e));
})();

// ---- #169 Pin-to-gutters: runtime fixed-pin ships; the authoring canvas previews it ----
section("#169 pin-to-gutters preview");
(function () {
  var r = src("src/render.js");
  var course = src("src/course.css");
  var chrome = src("editor.css");
  // render: pinning is the GLOBAL DEFAULT (#169b) — course-nav--pin unless pinButtons === false.
  ok("render pins by default (opt-out via pinButtons === false)", /var pinned = block\.pinButtons !== false;/.test(r) && /pinned \? " course-nav--pin" : ""/.test(r));
  // runtime: prev/next pin fixed to the viewport gutters, scoped to [data-env="runtime"] (ships)
  ok("course.css pins prev/next fixed at runtime", /\[data-env="runtime"\] \.course-nav--pin \.course-nav__prev,[\s\S]*?position: fixed; bottom: 16px/.test(course));
  // #169b: FIXED-px gutters (not 5%) so the pinned corners are identical in every course,
  // independent of page side padding / content width (position:fixed = viewport-anchored).
  ok("course.css uses a fixed-px desktop gutter (was 5%)", /\[data-env="runtime"\] \.course-nav--pin \.course-nav__prev \{ left: 24px; \}/.test(course) && /\.course-nav--pin \.course-nav__next \{ right: 24px; \}/.test(course));
  ok("course.css no longer uses a proportional 5% pin gutter", !/\.course-nav--pin \.course-nav__(?:prev|next) \{ (?:left|right): 5%; \}/.test(course));
  ok("course.css keeps the nav position:relative anchor (gate reminder / tour dots)", /\.course-nav \{[\s\S]*?position: relative;/.test(course));
  // canvas preview (#169): editor.css mirrors the pin on the authoring canvas so toggling is
  // WYSIWYG — scoped to #canvas-viewport so it NEVER ships in SCORM (no viewport there).
  ok("editor.css previews the pin on the canvas, absolute at the frame gutters", /#canvas-viewport \.course-nav--pin \.course-nav__prev,\s*#canvas-viewport \.course-nav--pin \.course-nav__next \{ position: absolute; bottom: 16px/.test(chrome));
  ok("canvas preview anchors buttons to the bounded page frame", /#canvas-viewport \.course-root--fill \{ position: relative; \}/.test(chrome) && /#canvas-viewport \.course-nav--pin \{ position: static; \}/.test(chrome));
  ok("canvas preview matches the runtime fixed-px gutter", /#canvas-viewport \.course-nav--pin \.course-nav__prev \{ left: 24px; \}/.test(chrome) && /#canvas-viewport \.course-nav--pin \.course-nav__next \{ right: 24px; \}/.test(chrome));
  // invariant: the canvas-preview affordance is chrome-only — course.css (the shipped file)
  // must NOT carry a #canvas-viewport rule, so it can never leak into the exported course.
  ok("preview never ships: no #canvas-viewport in course.css", course.indexOf("#canvas-viewport") === -1);
})();

section("nav pill cleanup");
(function () {
  var css = src("src/course.css");
  var r = src("src/render.js");
  var e = src("src/editor.js");
  // (1)+(2) title + bar are a GROUP centred as one unit on the pill midline: progress-main is
  // a centred column, title rendered BEFORE the bar (on top), label in normal flow (not absolute).
  ok("progress-main is a centred column group", /\.course-nav__progress-main \{[^}]*flex-direction: column;[^}]*align-items: center;[^}]*justify-content: center;/.test(css));
  ok("label is in normal flow (not absolute)", !/\.course-nav__label \{[^}]*position: absolute/.test(css));
  ok("render puts the title ABOVE the bar (label appended before track)", /course-nav__label", block\.menuLabel \|\| "Menu"\)[\s\S]{0,80}\);\s*main\.appendChild\(track\);/.test(r));
  // (3) side glyphs bumped ~20%, tap targets unchanged
  ok("mode-toggle glyph bumped to 19px", /\.mode-toggle__glyph svg \{ width: 19px; height: 19px;/.test(css));
  ok("glossary glyph 20px base, scales with pill", /\.course-nav__glossary--icon svg \{ width: calc\(20px \* var\(--pill-scale, 1\)\); height: calc\(20px \* var\(--pill-scale, 1\)\);/.test(css));
  ok("mode-toggle tap target still 34x30", /\.mode-toggle--icon \{[^}]*width: 34px; height: 30px;/.test(css));
  // author pill OPACITY: surface-only via color-mix (keeps text/glyphs crisp), default 100%
  ok("css pill bg uses color-mix with --nav-pill-opacity", /background: color-mix\(in srgb, var\(--nav-pill-fill[^)]*\)[^,]*\) var\(--nav-pill-opacity, 100%\), transparent\);/.test(css));
  ok("render sets --nav-pill-opacity from block.pillOpacity", /block\.pillOpacity != null\) wrap\.style\.setProperty\("--nav-pill-opacity", block\.pillOpacity \+ "%"\)/.test(r));
  ok("editor has an Opacity iconField writing pillOpacity (clamped 0-100)", /child\.pillOpacity = Math\.max\(0, Math\.min\(100, n\)\)/.test(e));
  ok("pillOpacity in NAV_PILL_KEYS (override-dot/reset)", /NAV_PILL_KEYS = \[[^\]]*"pillOpacity"/.test(e));
  // author pill LAYER BLUR: backdrop-filter behind the pill, default 0
  ok("css pill has backdrop-filter blur var (default 0)", /backdrop-filter: blur\(var\(--nav-pill-blur, 0px\)\);/.test(css) && /-webkit-backdrop-filter: blur\(var\(--nav-pill-blur, 0px\)\);/.test(css));
  ok("render sets --nav-pill-blur from block.pillBlur", /block\.pillBlur != null\) wrap\.style\.setProperty\("--nav-pill-blur", block\.pillBlur \+ "px"\)/.test(r));
  ok("editor has a Blur iconField writing pillBlur (clamped 0-40)", /child\.pillBlur = Math\.max\(0, Math\.min\(40, n\)\)/.test(e));
  ok("pillBlur in NAV_PILL_KEYS", /NAV_PILL_KEYS = \[[^\]]*"pillBlur"/.test(e));
})();

// ---- global motion: light/dark fade + chapter-change fade ------------------
section("global motion");
(function () {
  var css = src("src/course.css");
  var r = src("src/render.js");
  var rt = src("src/runtime.js");
  var e = src("src/editor.js");
  // config plumbed via the __motion per-pass hook at all 3 render entry points
  ok("__motion hook set in export + editor render + preview", (src("src/export.js").match(/window\.__motion =/g) || []).length === 1 && (e.match(/window\.__motion =/g) || []).length === 2);
  // render stamps the fade-duration vars + data-chapter-id
  ok("render stamps --motion-mode-fade from __motion", /window\.__motion\.modeMs != null\) root\.style\.setProperty\("--motion-mode-fade", window\.__motion\.modeMs \+ "ms"\)/.test(r));
  ok("render stamps --motion-chapter-fade from __motion", /window\.__motion\.chapterMs != null\) root\.style\.setProperty\("--motion-chapter-fade", window\.__motion\.chapterMs \+ "ms"\)/.test(r));
  ok("render stamps data-chapter-id from page.chapterId", /page\.chapterId\) root\.setAttribute\("data-chapter-id", page\.chapterId\)/.test(r));
  // CSS: mode fade is the var-driven [data-mode] transition (shared with the crossfade section);
  // chapter-enter is a separate keyframe animation under prefers-reduced-motion:no-preference.
  ok("css mode fade is --motion-mode-fade var driven", /transition: background-color var\(--motion-mode-fade, 300ms\) ease/.test(css));
  ok("css chapter-enter animation + keyframe", /\.is-chapter-enter[\s\S]*?animation: motion-chapter-enter var\(--motion-chapter-fade, 450ms\)/.test(css) && /@keyframes motion-chapter-enter \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/.test(css));
  // runtime: chapter-boundary fade in afterNav, initial chapter seeded (no fade on init)
  ok("runtime afterNav triggers the chapter fade", /function afterNav\(\)[\s\S]*?maybeChapterFade\(\);/.test(rt));
  ok("runtime adds .is-chapter-enter on a chapter change", /ch !== lastChapter[\s\S]*?classList\.add\("is-chapter-enter"\)/.test(rt));
  ok("runtime seeds lastChapter (no fade on init)", /lastChapter = chapterOfCurrent\(\);/.test(rt));
  // editor: Motion disclosure + clamped setMotion
  ok("editor has a Motion document panel", /\{ key: "motion", title: "Motion", build: buildMotionBody \}/.test(e));
  ok("editor setMotion clamps 0-2000 + prunes empty", /doc\.motion\[key\] = Math\.max\(0, Math\.min\(2000, n\)\)/.test(e) && /if \(!Object\.keys\(doc\.motion\)\.length\) delete doc\.motion;/.test(e));
  // export cleanRoot must KEEP the root-level --motion-* override vars (not strip them as theme tokens)
  ok("export keeps --motion-* root vars", /indexOf\("--page-"\) !== 0 && p\.indexOf\("--motion-"\) !== 0/.test(src("src/export.js")));
})();

// ---- §74: select-first (progressive drill) is now the DEFAULT --------------
section("select-first / progressive drill");
(function () {
  var t = src("src/editor.js");
  // rule 6: the flag is reused, flipped -> select-first ON unless an explicit "0".
  ok("select-first is always on (toggle removed, hard-wired true)", /function twoStateText\(\) \{ return true; \}/.test(t) && !/segmentedLive\("Text editing"/.test(t));
  ok("enableEditing still branches on twoStateText()", /if \(twoStateText\(\)\) \{[\s\S]*?dblclick[\s\S]*?enterTextEdit/.test(t));
  ok("click-to-edit mode still sets contenteditable true", /\} else \{[\s\S]*?setAttribute\("contenteditable", "true"\)/.test(t));
  ok("deleteSelection handles a selected (non-editing) text field", /selection\.type === "field"[\s\S]*?getAttribute\("contenteditable"\) !== "true"[\s\S]*?deleteBlockByRef/.test(t));
  // drill engine
  ok("buildDrillLevels resolves outermost->innermost levels", /function buildDrillLevels\(target\)[\s\S]*?inner\.reverse\(\)/.test(t));
  ok("terminal editable field becomes an \"edit\" step (replaces the field-select)", /leaf\.kind === "field" && leaf\.node\.classList\.contains\("is-editable"\)[\s\S]*?levels\[levels\.length - 1\] = \{ kind: "edit"/.test(t));
  ok("dual-role node yields BOTH block + field drill levels (progressive disclosure)", /if \(n\.matches\("\[data-edit\]"\)\) inner\.push\(\{ kind: "field"[\s\S]*?if \(n\.classList\.contains\("canvas-block"\) && n\.__block\)[\s\S]*?inner\.push\(\{ kind: "block"/.test(t));
  ok("extra block tier gated to plain text blocks (navButton keeps bespoke inspector)", /!n\.matches\("\[data-edit\]"\) \|\| getSelectionTypeForBlock\(n\.__block\) === "field"\) inner\.push\(\{ kind: "block"/.test(t));
  ok("edit drill step selects the field AND enters the caret", /l\.kind === "edit"\) \{ selectFieldNode\(l\.node\); enterTextEdit\(l\.node\)/.test(t));
  ok("block drill tier forces a block selection for a data-edit text node", /getAttribute\("data-edit"\) != null && l\.node\.__block\) \{ blurActiveText\(\); setSelection\("block", l\.node\)/.test(t));
  ok("field/type inspector ends with a back-to-block affordance not the block footer", /insp-backlink[\s\S]*?reselectBlockNode\(selection\.block, "block"\)/.test(t) && !/\/\/ Shared footer \(Spacing \+ Block actions\)/.test(t));
  ok("capture handler bails out in click-to-edit mode", /if \(!twoStateText\(\)\) return;\s*\/\/ click-to-edit/.test(t));
  // LEAF-FIRST (James 2026-07-12): a plain click selects the INNERMOST non-edit level
  // (the element under the cursor), not the outermost container; Escape steps outward.
  // leafSelectIndex is NODE-AWARE: it steps back over the innermost node's own caret
  // level but never past it into an ancestor (else a navButton, whose only level is
  // editable, would select the card it sits in).
  ok("leafSelectIndex steps back over the innermost node's edit level only (never into an ancestor)", /function leafSelectIndex\(levels\) \{[\s\S]*?var leafNode = levels\[levels\.length - 1\]\.node;\s*\n\s*var i = levels\.length - 1;\s*\n\s*while \(i > 0 && levels\[i\]\.kind === "edit" && levels\[i - 1\]\.node === leafNode\) i--;/.test(t));
  ok("plain click selects the leaf directly (leaf-first, not the container)", /var leafIndex = leafSelectIndex\(levels\);[\s\S]*?clearAllMulti\(\);\s*\n\s*drill\.levels = levels; drill\.index = leafIndex;/.test(t));
  // An "edit"-kind leaf (navButton-like) SELECTS without a caret on single click, so it
  // becomes draggable and doesn't jump into text edit; other leaves select normally.
  ok("an edit-kind leaf single-click selects without the caret (navButton draggable, no auto-edit)", /if \(leaf\.kind === "edit"\) \{ blurActiveText\(\); selectFieldNode\(leaf\.node\); \}\s*\n\s*else applyDrillLevel\(leaf\);/.test(t));
  // press-drag defer is keyed on the NODE (press is on the currently-selected, draggable
  // block) not selection.block -- setSelection leaves selection.block null for some types
  // (navButton), so a block-ref check would drop them out of the drag path.
  ok("onSelectedLeaf is keyed on the selected+draggable host node, not selection.block", /var leafHost = leaf\.node && leaf\.node\.closest && leaf\.node\.closest\("\.canvas-block"\);[\s\S]*?var onSelectedLeaf = leafBlock && !multiSel\.length && leafHost && leafHost === selHost &&\s*\n\s*leafHost\.getAttribute\("draggable"\) === "true";/.test(t));
  // ONE multi-select handler owns Shift/Cmd (registered before the leaf click handler, which bails on modifiers).
  ok("leaf-first click handler bails on Shift/Cmd (the multi-select handler owns them)", /if \(e\.button !== 0 \|\| e\.shiftKey \|\| e\.metaKey \|\| spaceHeld\) return;/.test(t));
  ok("Shift/Cmd click multi-selects the LEAF element (not canvasTopBlock), seeded from the single selection", /if \(e\.shiftKey \|\| e\.metaKey\) \{[\s\S]*?var node = levels\.length \? levels\[leafSelectIndex\(levels\)\]\.node : null;[\s\S]*?if \(!multiSel\.length && selection && selection\.block && selection\.block !== node\.__block\) multiSel\.push\(selection\.block\);[\s\S]*?toggleMulti\(node\.__block\)/.test(t));
  ok("multi-select no longer keys off canvasTopBlock (would collapse siblings to the container)", !/if \(e\.shiftKey \|\| e\.metaKey\) \{\s*\n\s*var node = canvasTopBlock/.test(t));
  ok("a 2+ multi-selection strips the stray single is-selected highlight", /if \(multiSel\.length >= 2\) Array\.prototype\.forEach\.call\(world\.querySelectorAll\("\.is-selected"\)/.test(t));
  ok("Escape steps OUT one drill level (rule 3)", /twoStateText\(\) && drill\.levels && drill\.index > 0[\s\S]*?drill\.index--; applyDrillLevel/.test(t));
  ok("a non-drill setSelection resets the drill chain", /if \(!applyingDrill\) resetDrill\(\)/.test(t));
  // isTextTarget must NOT count a checkbox/radio input as a text target, else clicking
  // one bails the drill handler (no select) AND the dragstart guard prevents the drag,
  // leaving the block stuck ("can't be picked up"). Only text-ENTRY inputs are text targets.
  ok("isTextTarget whitelists text-entry inputs only (checkbox/radio stay draggable)", /function isTextTarget\(t\) \{[\s\S]*?if \(t\.tagName !== "INPUT"\) return false;[\s\S]*?ty === "text" \|\| ty === "search"[\s\S]*?ty === "number";/.test(t));
})();

// ---- §74 PHASE 2: grab handle removed; selected block IS the drag surface -----
section("select-first / grab-handle removal (phase 2)");
(function () {
  var t = src("src/editor.js");
  // select-first branch: block body is draggable, gated on the draggable attr + not editing
  ok("select-first block dragstart is gated on draggable + not editing", /if \(node\.getAttribute\("draggable"\) !== "true"\) \{ e\.preventDefault\(\); return; \}[\s\S]*?if \(isTextTarget\(e\.target\)\) \{ e\.preventDefault\(\); return; \}/.test(t));
  // the gripper handle now ONLY exists in the click-to-edit escape-hatch branch
  ok("gripper handle only in the click-to-edit (else) branch", /Click-to-edit escape hatch keeps the gripper[\s\S]*?canvas-drag-handle/.test(t));
  ok("select-first branch does NOT create a handle", !/if \(twoStateText\(\)\) \{[\s\S]{0,400}canvas-drag-handle/.test(t));
  // updateDragAffordance: only the selected block, never group/columns/locked/editing
  ok("updateDragAffordance skips group/columns/locked/editing", /b\.type !== "group" && b\.type !== "columns" &&\s*!\(editing && host\.contains\(editing\)\)/.test(t));
  ok("updateDragAffordance sets draggable on the selected block", /if \(sel\) sel\.setAttribute\("draggable", "true"\)/.test(t));
  ok("refreshCanvasSelection updates the drag affordance", /drawContainerOutline\(selection\.block\);\s*updateDragAffordance\(\);/.test(t));
  // a press-drag on the selected leaf defers to mouseup so a native MOVE wins over edit
  ok("press-drag on the selected leaf defers to mouseup (move wins over dbl-click edit)", /if \(onSelectedLeaf\) \{/.test(t) && /window\.addEventListener\("mouseup", onUp, true\)/.test(t) && /if \(!moved && e\.detail >= 2 && editLevel\.kind === "edit"\)/.test(t));
})();

// ---- leaf-first pure core: which level a plain click selects ----------------
// Mirrors leafSelectIndex in the capture handler (deepest level whose kind != "edit",
// floored at 0) without a DOM. Leaf-first = click selects the element under the
// cursor, not the outermost container.
section("leaf-first select index");
(function () {
  // node-aware: step back over the innermost node's OWN caret level, never past it.
  function leafSelectIndex(levels) {
    var leafNode = levels[levels.length - 1].node;
    var i = levels.length - 1;
    while (i > 0 && levels[i].kind === "edit" && levels[i - 1].node === leafNode) i--;
    return i;
  }
  // L(kind, node) builds levels; nodes are simple string tags standing in for DOM nodes.
  var L = function (pairs) { return pairs.map(function (p) { return { kind: p[0], node: p[1] }; }); };
  // bare paragraph: block + edit on the SAME node -> selects the block (idx 0), not the caret
  ok("bare text block selects the block, not the caret", leafSelectIndex(L([["block", "P"], ["edit", "P"]])) === 0);
  // heading inside a card: [card, heading-block, heading-edit] (last two share node H) -> heading (idx 1)
  ok("nested text selects the innermost block (element, not container)", leafSelectIndex(L([["block", "C"], ["block", "H"], ["edit", "H"]])) === 1);
  // image inside a card -> the image (idx 1)
  ok("nested non-text selects the innermost block", leafSelectIndex(L([["block", "C"], ["block", "I"]])) === 1);
  // navButton inside a card: [card, navBtn-edit] — the edit level's node (N) != the card (C),
  // so we must NOT step back into the card; select the navButton itself (idx 1).
  ok("edit-only leaf inside a container selects ITSELF, not the container (navButton fix)", leafSelectIndex(L([["block", "C"], ["edit", "N"]])) === 1);
  // top-level navButton: a lone edit level floors at 0 (selects the navButton)
  ok("a lone edit level floors at 0", leafSelectIndex(L([["edit", "N"]])) === 0);
  // padding click resolving to just the container -> the container
  ok("a single container level selects that container", leafSelectIndex(L([["block", "C"]])) === 0);
})();

// ---- isTextTarget: only text-ENTRY inputs count (checkbox/radio must stay draggable) ----
section("isTextTarget text-entry only");
(function () {
  function isTextTarget(t) {
    if (!t) return false;
    if (t.isContentEditable || t.tagName === "TEXTAREA") return true;
    if (t.tagName !== "INPUT") return false;
    var ty = (t.getAttribute("type") || "text").toLowerCase();
    return ty === "text" || ty === "search" || ty === "email" || ty === "url" ||
           ty === "tel" || ty === "password" || ty === "number";
  }
  var inp = function (type) { return { tagName: "INPUT", getAttribute: function () { return type; } }; };
  // the bug: a checkbox input read as a text target -> clicking it never selects/drags the block
  ok("checkbox input is NOT a text target (block stays selectable + draggable)", isTextTarget(inp("checkbox")) === false);
  ok("radio input is NOT a text target", isTextTarget(inp("radio")) === false);
  ok("range input is NOT a text target", isTextTarget(inp("range")) === false);
  ok("text input IS a text target", isTextTarget(inp("text")) === true);
  ok("number input IS a text target (inspector fields keep native keyboard)", isTextTarget(inp("number")) === true);
  ok("typeless input defaults to text (text target)", isTextTarget({ tagName: "INPUT", getAttribute: function () { return null; } }) === true);
  ok("textarea IS a text target", isTextTarget({ tagName: "TEXTAREA" }) === true);
  ok("contenteditable IS a text target", isTextTarget({ isContentEditable: true, tagName: "DIV" }) === true);
})();

// ---- §5: quiz rich sub-fields carry PER-FIELD styles (no title<->body bleed) ----
section("quiz correct = brand green");
(function () {
  var css = src("src/course.css");
  // correct answer pill + its letter = --color-success (green), NOT the amber accent
  ok("correct pill uses --color-success", /\.kc-pill\.correct \{ border-color: var\(--color-success\);[\s\S]*?color-mix\(in srgb, var\(--color-success\) 12%/.test(css));
  ok("correct pill letter uses --color-success", /\.kc-pill\.correct \.kc-pill__letter \{ border-color: var\(--color-success\); color: var\(--color-success\); \}/.test(css));
  // good feedback icon + the pass/done badge follow suit
  ok("good feedback icon uses --color-success", /\.kc-fb-icon\.good \{ border: 1\.5px solid var\(--color-success\); color: var\(--color-success\); \}/.test(css));
  ok("kc-done pass badge uses --color-success", /\.kc-done__badge \{[\s\S]*?border: 2px solid var\(--color-success\); color: var\(--color-success\)/.test(css));
  // incorrect stays danger; the progress bar keeps the accent (not a correctness signal)
  ok("incorrect pill stays --color-danger", /\.kc-pill\.incorrect \{ border-color: var\(--color-danger\)/.test(css));
  ok("quiz progress bar keeps --color-accent", /\.kc-seg i \{[\s\S]*?background: var\(--color-accent\)/.test(css));
})();

section("quiz per-field styles");
(function () {
  var r = src("src/render.js");
  var e = src("src/editor.js");
  // render: editable takes a styleKey and resolves a per-field style host
  ok("editable() accepts a styleKey param", /function editable\(tag, className, obj, field, rich, styleKey\)/.test(r));
  ok("editable resolves a per-field style host", /var host = styleKey \? obj\[styleKey\] : obj/.test(r));
  ok("__bind records the styleKey", /__bind = \{ obj: obj, field: field, styleKey: styleKey \|\| null \}/.test(r));
  // the colliding quiz fields each pass their own key
  ok("done.title -> titleStyle", /kc-done__title", block\.done, "title", true, "titleStyle"/.test(r));
  ok("done.body -> bodyStyle", /kc-done__body", block\.done, "body", true, "bodyStyle"/.test(r));
  ok("question prompt -> promptStyle", /"kc-qtext", q, "prompt", true, "promptStyle"/.test(r));
  ok("feedbackCorrect -> feedbackCorrectStyle", /q, "feedbackCorrect", true, "feedbackCorrectStyle"/.test(r));
  ok("feedbackIncorrect -> feedbackIncorrectStyle", /q, "feedbackIncorrect", true, "feedbackIncorrectStyle"/.test(r));
  // inspector edits the per-field host, not the shared obj
  ok("renderFieldInspector resolves the style host from styleKey", /var host = styleKey \? \(obj\[styleKey\] \|\| \(obj\[styleKey\] = \{\}\)\) : obj/.test(e));
  ok("rich style reads/writes host.style", /var s = host\.style \|\| \(host\.style = \{\}\)/.test(e));
  // migration: shared style copied to each per-field key, idempotent
  ok("migration wraps done.style into per-field {style} hosts", /b\.done\.titleStyle = \{ style: clone\(b\.done\.style\) \}; b\.done\.bodyStyle = \{ style: clone\(b\.done\.style\) \}; delete b\.done\.style/.test(e));
  ok("migration wraps q.style into per-field {style} hosts", /q\.promptStyle = \{ style: clone\(q\.style\) \}; q\.feedbackCorrectStyle = \{ style: clone\(q\.style\) \}; q\.feedbackIncorrectStyle = \{ style: clone\(q\.style\) \}; delete q\.style/.test(e));
  ok("migration only fires on a NON-EMPTY shared style", /function nonEmpty\(o\) \{ return o && typeof o === "object" && Object\.keys\(o\)\.length > 0; \}/.test(e));
  // course header title + subtitle (same shared-obj collision) get per-field styles too
  ok("header title -> titleStyle", /course-header__title", config, "title", true, "titleStyle"/.test(src("src/render.js")));
  ok("header subtitle -> subtitleStyle", /course-header__sub", config, "subtitle", true, "subtitleStyle"/.test(src("src/render.js")));
  ok("migration wraps a legacy header.style into per-field hosts", /hdr\.titleStyle = \{ style: clone\(hdr\.style\) \}; hdr\.subtitleStyle = \{ style: clone\(hdr\.style\) \}; delete hdr\.style/.test(e));
})();

// ---- SVG colour switching: a detected colour can be switched to a fixed custom colour ----
section("svg colour switching");
(function () {
  var r = src("src/render.js");
  var e = src("src/editor.js");
  // isColorLiteral distinguishes a literal colour from a theme-token key
  var body = r.slice(r.indexOf("function isColorLiteral(v)"), r.indexOf("function toCssColor"));
  var isLit = new Function(body + "\nreturn isColorLiteral;")();
  ok("hex + rgb() read as literal colours", isLit("#00ff00") && isLit("#abc") && isLit("rgb(1,2,3)") && isLit("rgba(1,2,3,.5)"));
  ok("token keys are NOT literals", !isLit("surface") && !isLit("ink") && !isLit("accent") && !isLit("keep"));
  // render: a token -> var(--color-…); a literal -> applied as-is
  ok("toCssColor maps token->var and literal->as-is", /function toCssColor\(tok\) \{ return isColorLiteral\(tok\) \? tok\.trim\(\) : "var\(--color-" \+ kebabToken\(tok\) \+ "\)"; \}/.test(r));
  ok("recolorNode uses toCssColor for both attr + inline forms", /setStyleProp\(style, attr, toCssColor\(tok\)\)/.test(r) && /prop \+ ":" \+ toCssColor\(tok\)/.test(r));
  // editor: a per-colour "Switch to colour" picker writes a fixed hex into colorMap
  ok("inspector exposes a Switch-to-colour picker", /colourControl\("Switch to colour", isHexMap \? explicit : null/.test(e));
  ok("custom hex round-trips: reflected as a Custom-colour select option", /if \(isHexMap\) selOpts\.unshift\(\["Custom colour", "__custom"\]\)/.test(e) && /if \(v === "__custom"\) return;/.test(e));
})();

// ---- Inline hyperlinks in text (external URL, new tab, theme-aware) ---------------
section("inline links");
(function () {
  var e = src("src/editor.js");
  var css = src("src/course.css");
  ok("text inspector has a Link button using createLink", /var linkB = h\("button"[\s\S]*?execCommand\("createLink", false, url\)/.test(e));
  ok("created anchor gets target=_blank + rel=noopener", /setAttribute\("target", "_blank"\); el\.setAttribute\("rel", "noopener noreferrer"\)/.test(e));
  ok("empty URL removes the link (unlink)", /if \(!url\) \{ document\.execCommand\("unlink", false, null\)/.test(e));
  ok("link/BIU commits are sanitised so the drag-handle can't ride in", /obj\[field\] = sanitizeFieldHtml\(node\.innerHTML\)/.test(e));
  ok("theme-aware link style (accent + underline, excludes nav buttons)", /\.page a:not\(\.nav-button\):not\(\.course-nav__btn\) \{[\s\S]*?color: var\(--color-accent\);[\s\S]*?text-decoration: underline/.test(css));
})();

// ---- Vimeo: the unlisted privacy HASH is captured + shipped in the player src -----
// ---- Tab moves between fields in the design panel (survives the commit rebuild) -----
// ---- Canvas block context menu: Copy + Paste (reuse the keyboard clipboard) --------
// ---- Copy Style / Paste Style: lift presentation keys, never content -----------
section("copy/paste style");
(function () {
  var e = src("src/editor.js");
  var _sk = (e.match(/var STYLE_KEYS = (\[[^\]]*\]);/) || [])[1] || "";
  ok("copyBlockStyle lifts only presentation keys from STYLE_KEYS", /"box"/.test(_sk) && /"styleRef"/.test(_sk) && /"colorMap"/.test(_sk) && /function copyBlockStyle\(block\)[\s\S]*?STYLE_KEYS\.forEach\(function \(k\) \{ if \(block\[k\] !== undefined\) out\[k\] = clone\(block\[k\]\)/.test(e));
  ok("STYLE_KEYS excludes content/identity", !/STYLE_KEYS = \[[^\]]*"(text|html|src|children|items|type|id|questions)"/.test(e));
  ok("pasteBlockStyle writes the clipboard keys onto the target + mounts", /function pasteBlockStyle\(block\)[\s\S]*?Object\.keys\(styleClipboard\)\.forEach\(function \(k\) \{ block\[k\] = clone\(styleClipboard\[k\]\); \}\);[\s\S]*?mount\(\)/.test(e));
  ok("context menu has Copy style + Paste style (Paste only when a style is copied)", /label: "Copy style", onClick: function \(\) \{ copyBlockStyle\(target\.block\); \}/.test(e) && /if \(styleClipboard\) items\.push\(\{ label: "Paste style", onClick: function \(\) \{ pasteBlockStyle\(target\.block\); \}/.test(e));
})();

section("ctx copy/paste");
(function () {
  var e = src("src/editor.js");
  ok("block context menu has Copy", /items\.push\(\{ label: "Copy", onClick: function \(\) \{ copySelection\(\); \} \}\)/.test(e));
  ok("block menu offers Paste when the clipboard has blocks", /if \(clipboard\.length\) \{\s*\n\s*items\.push\(\{ label: "Paste", onClick: function \(\) \{ pasteClipboard\(\); \} \}\);/.test(e));
  ok("empty-canvas menu offers Paste when the clipboard has blocks", /if \(clipboard\.length\) \{ items\.push\(\{ label: "Paste", onClick: function \(\) \{ pasteClipboard\(\); \} \}\);/.test(e));
  // §84 paste-without-formatting
  ok("both menus offer Paste without formatting", (e.match(/label: "Paste without formatting", onClick: function \(\) \{ pasteClipboard\(true\); \}/g) || []).length >= 2);
  ok("Cmd+Shift+V passes the strip flag to pasteClipboard", /if \(pasteClipboard\(e\.shiftKey\)\) e\.preventDefault\(\)/.test(e));
  ok("pasteClipboard strips formatting when asked", /clipboard\.map\(function \(b\) \{ var c = remintIds\(clone\(b\)\); if \(strip\) stripFormattingDeep\(c\)/.test(e));
  // stripFormattingDeep: clears style/styleRef + inline formatting, keeps structural tags, skips embeds
  var body = e.slice(e.indexOf("function stripFormattingDeep("), e.indexOf("window.__stripFormattingDeep"));
  var strip = new Function("window", body + "\nreturn stripFormattingDeep;")({});
  var blk = { type: "paragraph", styleRef: "Body 1", style: { color: "#f00" }, text: '<span style="color:red"><b>Hi</b></span> there', children: [{ type: "note", styleRef: "Callout", text: '<i>x</i>' }] };
  strip(blk);
  ok("strips block style + styleRef (top-level + nested)", blk.styleRef === undefined && blk.style === undefined && blk.children[0].styleRef === undefined);
  ok("removes inline formatting tags + style attrs, keeps text", blk.text === "Hi there");
  ok("recurses into nested children", blk.children[0].text === "x");
  var emb = { type: "htmlEmbed", html: '<!DOCTYPE html><html><span style="color:red"><b>keep</b></span></html>' };
  strip(emb);
  ok("leaves embed html untouched", /<b>keep<\/b>/.test(emb.html) && /color:red/.test(emb.html));
})();

section("panel tab-next");
(function () {
  var e = src("src/editor.js");
  ok("inspector has a Tab keydown handler", /inspector\.addEventListener\("keydown", function \(e\) \{[\s\S]*?e\.key !== "Tab"/.test(e));
  ok("Tab commits the field then focuses the next/prev control", /t\.blur\(\);[\s\S]*?var list2 = fields\(\), target = list2\[next\];[\s\S]*?target\.focus\(\)/.test(e));
  ok("Shift+Tab goes back a field", /var next = idx \+ \(e\.shiftKey \? -1 : 1\)/.test(e));
})();

section("vimeo hash");
(function () {
  var r = src("src/render.js");
  var body = r.slice(r.indexOf("function parseVideo(url)"), r.indexOf("window.parseVideo"));
  var parseVideo = new Function(body + "\nreturn parseVideo;")();
  ok("captures hash from the /HASH path (unlisted)", parseVideo("https://vimeo.com/123/abcdef1234").hash === "abcdef1234");
  ok("captures hash from the ?h= query", parseVideo("https://player.vimeo.com/video/123?h=abcdef1234").hash === "abcdef1234");
  ok("public video -> no hash", parseVideo("https://vimeo.com/76979871").hash === "" && parseVideo("https://vimeo.com/76979871").id === "76979871");
  ok("youtube still parses", parseVideo("https://youtu.be/dQw4w9WgXcQ").provider === "youtube");
  // Pasted embed CODE (Microsoft Forms + any provider's <iframe> snippet): src is extracted.
  var msf = parseVideo('<iframe width="640px" height="480px" src="https://forms.office.com/Pages/ResponsePage.aspx?id=ABC&embed=true" frameborder="0"></iframe>');
  ok("MS Forms iframe embed -> generic w/ extracted src", msf.provider === "generic" && msf.url === "https://forms.office.com/Pages/ResponsePage.aspx?id=ABC&embed=true");
  ok("iframe src &amp; decoded to &", parseVideo('<iframe src="https://x.test/a?b=1&amp;c=2"></iframe>').url === "https://x.test/a?b=1&c=2");
  ok("iframe-wrapped vimeo still classifies as vimeo", parseVideo('<iframe src="https://player.vimeo.com/video/76979871"></iframe>').provider === "vimeo");
  ok("bare URL falls through unchanged (no iframe)", parseVideo("https://forms.office.com/r/abc").url === "https://forms.office.com/r/abc" && parseVideo("https://forms.office.com/r/abc").provider === "generic");
  ok("player src builds ...video/ID?h=HASH&…app_id (unlisted plays)", /"https:\/\/player\.vimeo\.com\/video\/" \+ info\.id \+ "\?" \+ \(info\.hash \? "h=" \+ info\.hash \+ "&" : ""\) \+ "badge=0[^"]*app_id=58479"/.test(r));
  // no black bars: the iframe is sized 16:9 (video fills it) + the wrapper fills the
  // sides with the THEME bg (tracks light/dark) instead of black.
  var css = src("src/course.css");
  // #176/#180: EVERY web embed (generic included) gets the .embed--filled wrapper so
  // the surround is a managed colour on ALL providers; the video SIZING concern
  // (.embed--video: centre + forced 16:9) is decoupled and gated to real media ONLY,
  // so a generic form embed (Microsoft Forms) is NOT collapsed to width:auto/contain.
  var webBody = r.slice(r.indexOf("webEmbed: function"), r.indexOf("// Image hotspots"));
  ok("every web embed gets the embed--filled wrapper (managed bg, generic included)", /el\("div", "embed embed--web embed--filled"\)/.test(webBody));
  ok("#180: embed--video (video sizing) gated to real media only — generic keeps full width", /if \(info\.provider === "vimeo" \|\| info\.provider === "youtube"\) \{\s*\n\s*wrap\.classList\.add\("embed--video"\);/.test(webBody));
  ok("vimeo/youtube keep the forced 16:9 iframe", /provider === "vimeo" \|\| info\.provider === "youtube"\) \{[\s\S]*?aspectRatio = "16 \/ 9"/.test(webBody));
  ok("embed--filled fills with the theme bg only (var(--color-bg), tracks light/dark)", /\.embed--filled \{ background: var\(--color-bg\); \}/.test(css));
  ok("#180: embed--video is centre-only (no width forced on the wrapper's non-video child)", /\.embed--video \{ display: flex; align-items: center; justify-content: center; \}/.test(css));
  // #176: author-settable letterbox colour — embedBg paints the wrapper + media bg,
  // absent falls back to the CSS theme var. embedBg is a copyable style key.
  ok("embedBg paints the embed--video wrapper when set", /block\.embedBg\) wrap\.style\.background = block\.embedBg/.test(webBody));
  ok("applyEmbedStyle applies embedBg to the media element", /if \(block\.embedBg\) node\.style\.background = block\.embedBg/.test(r));
  ok("embedBg is a copyable style key", /"embedColorMap", "embedBg"/.test(src("src/editor.js")));
})();

// ---- HTML-interaction palette linking (Phase 2): map an interaction's own vars to theme ----
section("embed palette linking");
(function () {
  var r = src("src/render.js");
  var e = src("src/editor.js");
  var x = src("src/export.js");
  // functional: detect declared colour vars + resolve the map (inject the two tiny deps)
  var helpers = 'var window={};var isColorLiteral=function(v){return typeof v==="string"&&/^(#[0-9a-f]{3}([0-9a-f]{3})?|rgba?\\(|hsla?\\()/i.test(v.trim());};var kebabToken=function(s){return s.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();};';
  var slice = r.slice(r.indexOf("function detectEmbedColorVars"), r.indexOf("window.resolveEmbedColorMap"));
  var api = new Function(helpers + slice + "\nreturn { detect: detectEmbedColorVars, resolve: resolveEmbedColorMap };")();
  var vars = api.detect(":root{--bg:#212121;--orange:#FFA726;--font-ui:Arial;--panel:rgb(40,40,40);}");
  ok("detects colour vars, skips fonts", vars.length === 3 && vars.map(function (v) { return v.name; }).join(",") === "--bg,--orange,--panel");
  var resolved = api.resolve({ embedColorMap: { "--bg": "bg", "--orange": "#00ffff", "--panel": "keep" } });
  ok("token -> var(--color-*), literal -> as-is, keep -> omitted", resolved["--bg"] === "var(--color-bg)" && resolved["--orange"] === "#00ffff" && !("--panel" in resolved));
  // render bakes the resolved map + the shim applies it in-iframe
  ok("htmlEmbed bakes data-embed-colormap", /data-embed-colormap", JSON\.stringify\(__em\)/.test(r));
  ok("theme shim applies the interaction-var map", /if\(m\.map\)\{for\(var mk in m\.map\)/.test(r));
  ok("pushEmbedTheme forwards the map in the message + direct apply", /var msg = \{ type: "theme"[^}]*map: map, fadeMs: fadeMs \}/.test(r) && /if \(map\) Object\.keys\(map\)\.forEach/.test(r));
  // §34 LINKED mode fade: recoloured SVGs + HTML interactions must ease with the bg (one --motion-mode-fade)
  ok("SVG fill/stroke transition off --motion-mode-fade (vector art fades with the bg)", /\[data-mode\] svg \*\s*\{\s*transition: fill var\(--motion-mode-fade, 300ms\) ease, stroke var\(--motion-mode-fade, 300ms\) ease/.test(src("src/course.css")));
  ok("reduced-motion disables the svg fade too", /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-mode\] svg \*\s*\{ transition: none;/.test(src("src/course.css")));
  ok("pushEmbedTheme reads the fade duration off the themed root", /getComputedStyle\(themed\)\.getPropertyValue\("--motion-mode-fade"\)/.test(r));
  ok("embed shim eases its bg/color over m.fadeMs (skips on reduced-motion)", /m\.fadeMs>0&&!rm[\s\S]*?transition:background-color '\+m\.fadeMs\+'ms ease,color '\+m\.fadeMs\+'ms ease/.test(r));
  // exported runtime forwards + applies the map too
  ok("exported runtime forwards data-embed-colormap", /getAttribute\('data-embed-colormap'\)/.test(x) && /if\(mp\)\{ for\(var mk in mp\)/.test(x));
  // inspector exposes the per-var palette control
  ok("embed inspector has an Interaction colours palette (detects inline OR bundled src)", /disclosure\("embedPalette", "Interaction colours"/.test(e) && /detectEmbedColorVars\(embedHtmlForInspect\(block\)\)/.test(e));
  ok("bundled-file interactions decode their HTML for detection", /function embedHtmlForInspect\(block\)[\s\S]*?atob\(m\[2\]\)/.test(e));
  // palette writes must persist NOW (scheduleSave), not only on the 4s autosave tick —
  // else a colour mapping made just before a hard refresh is lost (WKWebView skips
  // beforeunload on Cmd+R). One choke for embed / SVG-image / glossary palettes.
  ok("paletteColorRow persists the map on every write (scheduleSave)", /function apply\(\) \{ o\.refresh\(\); scheduleSave\(\); \}/.test(e));
  // #85: opening the inspector + every palette re-render decoded + regex-parsed the
  // full interaction markup with no caching (a 2-3s freeze). Detection is now cached
  // per block, keyed on its html/src, and the palette reads through the cache.
  ok("#85 embed colour-var detection is cached per block (keyed on html/src)",
    /function embedColorVarsCached\(block\)[\s\S]*?_embedVarCache\.get\(block\)[\s\S]*?_embedVarCache\.set\(block, \{ sig: sig, vars: vars \}\)/.test(e));
  ok("#85 the palette reads detection through the cache (no per-render decode)",
    /var embedVars = embedColorVarsCached\(block\);/.test(e));
  // #85: a colour-map change must recolour the iframe LIVE (push the theme), NOT
  // tear it down + reload it (the per-click 2-3s freeze). embedRefresh rewrites the
  // baked data-embed-colormap covering every var (Keep -> authored literal, so a
  // revert applies live too) and re-pushes the theme, with NO reRenderBlockNode.
  var erBody = e.slice(e.indexOf("var embedRefresh = function"), e.indexOf("embedVars.forEach(function (v)"));
  ok("#85 colour-map change recolours live via pushEmbedTheme (no iframe reload)",
    erBody.indexOf("reRenderBlockNode") === -1 && /pushEmbedTheme\(canvas/.test(erBody) && /data-embed-colormap/.test(erBody));
  ok("#85 live recolour covers Keep/absent vars with their authored literal (reverts apply live)",
    /resolved\.hasOwnProperty\(ev\.name\) \? resolved\[ev\.name\] : ev\.value/.test(erBody));
})();

// ---- §6: Card Reveal cover = real frosted glass (translucent) + author control ----
section("card-reveal flip / off modes");
(function () {
  var r = src("src/render.js"), css = src("src/course.css"), rt = src("src/runtime.js"), e = src("src/editor.js");
  // render: revealStyle -> data-reveal-style, face suppressed for off
  ok("render stamps data-reveal-style (reveal|flip|off)", /var revealStyle = block\.revealStyle === "flip" \? "flip" : block\.revealStyle === "off" \? "off" : "reveal";\s*root\.setAttribute\("data-reveal-style", revealStyle\)/.test(r));
  ok("render shows a face for reveal+flip, none for off", /var showFace = revealStyle === "off" \? false : \(revealStyle === "flip" \? true : !block\.noCover\)/.test(r));
  // css: 3D flip mechanic, reduced-motion aware
  ok("flip uses preserve-3d + rotateY on is-revealed", /data-reveal-style="flip"\] \.card-reveal__card \{[\s\S]*?transform-style: preserve-3d/.test(css) && /data-reveal-style="flip"\] \.card-reveal__card\.is-revealed \{ transform: rotateY\(180deg\)/.test(css));
  // REGRESSION (James 2026-07-09, flipped card showed MIRRORED front content): the base
  // card's isolation:isolate is a grouping property that forces used transform-style to
  // FLAT — preserve-3d dies and NO face is backface-culled. The flip override must reset
  // isolation (and keep overflow visible, the other grouping property on the base card).
  ok("flip card resets isolation (grouping prop kills preserve-3d)", /data-reveal-style="flip"\] \.card-reveal__card \{[\s\S]*?overflow: visible; isolation: auto;/.test(css));
  // Face DESCENDANTS are culled explicitly: a child that layer-promotes (own stacking
  // context, e.g. the authored front's blocks) escapes the parent face's backface cull.
  ok("flip face descendants carry their own backface cull", /data-reveal-style="flip"\] \.card-reveal__cover \*,\s*\.card-reveal\[data-reveal-style="flip"\] \.card-reveal__content \* \{\s*backface-visibility: hidden/.test(css));
  // .card-reveal__front must NOT create a stacking context (position/z-index) — that is
  // the layer-promotion that painted the front mirrored over the back.
  ok("front face declares no position/z-index", (function () { var m = css.match(/\.card-reveal__front \{([\s\S]*?)\}/); return !!m && m[1].indexOf("z-index") === -1 && m[1].indexOf("position") === -1; })());
  ok("flip faces hide their backface; content pre-rotated", /data-reveal-style="flip"\][\s\S]*?backface-visibility: hidden/.test(css) && /data-reveal-style="flip"\] \.card-reveal__content \{ transform: rotateY\(180deg\)/.test(css));
  ok("flip animation honours prefers-reduced-motion", /@media \(prefers-reduced-motion: reduce\) \{\s*\.card-reveal\[data-reveal-style="flip"\] \.card-reveal__card \{ transition: none; \}/.test(css));
  // runtime: flip cards flip on full-card click (guarded against interactive children)
  ok("runtime flips on card click in flip mode (toggle)", /if \(isFlip\) \{[\s\S]*?card\.addEventListener\("click", function \(e\) \{[\s\S]*?toggle\("is-revealed"\)/.test(rt));
  // The flip front face IS .card-reveal__cover, so the click guard must NOT exclude it
  // (excluding it swallowed every front-face click and the card never flipped).
  ok("flip click guard excludes only a,button — NOT the cover", /if \(isFlip\) \{[\s\S]*?e\.target\.closest\("a, button"\) return;[\s\S]*?toggle\("is-revealed"\)/.test(rt.replace(/&&\s*/g, "")) || /if \(isFlip\) \{[\s\S]*?closest\("a, button"\)\) return;[\s\S]*?toggle\("is-revealed"\)/.test(rt));
  // Frost "hold to reveal": a CLICK must LATCH the card open (add, not toggle) so it stays
  // revealed indefinitely, bound on the card (fires through the cleared cover). (Fix 2026-07-08.)
  ok("frost card click LATCHES open (add is-revealed, not toggle)", /\} else \{[\s\S]*?card\.addEventListener\("click", function \(e\) \{[\s\S]*?classList\.add\("is-revealed"\)/.test(rt) && !/cover\.addEventListener\("click"/.test(rt));
  // editor: the mode segment
  ok("editor has a Reveal style segment (Reveal|Flip|Off)", /segmentedLive\("Reveal style", \[\["Reveal", "reveal"\], \["Flip", "flip"\], \["Off", "off"\]\]/.test(e));
})();

section("card-reveal cover glass");
(function () {
  var css = src("src/course.css");
  var r = src("src/render.js");
  var e = src("src/editor.js");
  // the fill must be TRANSLUCENT (color-mix w/ transparent) or the backdrop-blur is defeated
  ok("cover fill is a translucent color-mix over the per-mode card fill (blur reads through)", /\.card-reveal__cover\b[\s\S]*?background:\s*color-mix\(in srgb, var\(--cr-cover-color, var\(--cr-card-fill, #2a2a2a\)\) var\(--cr-cover-opacity, 48%\), transparent\)/.test(css));
  ok("card fill is per-mode: dark default #2a2a2a, light #fff (switches on data-mode)", /data-mode="dark"\] \.card-reveal \{ --cr-card-fill: var\(--cr-fill-dark, #2a2a2a\)/.test(css) && /data-mode="light"\] \.card-reveal \{ --cr-card-fill: var\(--cr-fill-light, #ffffff\)/.test(css));
  ok("blur is author-tunable via --cr-cover-blur", /backdrop-filter:\s*blur\(var\(--cr-cover-blur, 16px\)\)/.test(css));
  // render pipes the author's colour/opacity/blur onto the grid root
  ok("render sets --cr-cover-color from block.coverColor", /block\.coverColor\) root\.style\.setProperty\("--cr-cover-color", block\.coverColor\)/.test(r));
  ok("render sets --cr-cover-opacity from block.coverOpacity", /--cr-cover-opacity", block\.coverOpacity \+ "%"/.test(r));
  ok("render sets --cr-cover-blur from block.coverBlur", /--cr-cover-blur", block\.coverBlur \+ "px"/.test(r));
  // inspector exposes the controls (only when the cover is on)
  ok("inspector has a Cover colour control (colorFieldFlat)", /colorFieldFlat\("Cover colour", block\.coverColor/.test(e));
  ok("inspector has Cover opacity + blur iconFields", /title: "Cover opacity"[\s\S]*?block\.coverOpacity[\s\S]*?title: "Cover blur"[\s\S]*?block\.coverBlur/.test(e));
})();

// ---- §6: Accordion/Tabs beautified to the Card-Reveal visual standard ------
section("accordion card-reveal standard");
(function () {
  var css = src("src/course.css");
  // accordion/tabs use the SAME per-mode solid fill as the cards (dark #2a2a2a / light #fff)
  ok("acc per-mode fill dark = #2a2a2a", /\.course-root\[data-mode="dark"\] \.acc\s*\{[\s\S]*?--acc-fill:\s*var\(--acc-fill-dark, #2a2a2a\)/.test(css));
  ok("acc per-mode fill light = #ffffff", /\.course-root\[data-mode="light"\] \.acc\s*\{[\s\S]*?--acc-fill:\s*var\(--acc-fill-light, #ffffff\)/.test(css));
  ok("acc__item background is the per-mode fill var", /\.acc__item\s*\{[\s\S]*?background:\s*var\(--acc-fill, #2a2a2a\)/.test(css));
  ok("acc--tabs background is the per-mode fill var", /\.acc--tabs\s*\{[\s\S]*?background:\s*var\(--acc-fill, #2a2a2a\)/.test(css));
  ok("acc__item lifts + shadows on hover", /\.acc__item:hover\s*\{[\s\S]*?translateY\(-2px\)[\s\S]*?box-shadow:\s*0 24px 48px -20px/.test(css));
  // no focus-within lift (would jar the canvas while editing panel text)
  ok("acc__item hover-lift is NOT gated on focus-within", !/\.acc__item:focus-within/.test(css));
  // hairline rule-divider echoing the card title rule; tabs panel drops it
  ok("acc__panel has the header/panel rule-divider", /\.acc__panel\s*\{[\s\S]*?border-top:\s*1px solid var\(--color-hair\)/.test(css));
  ok("acc--tabs panel drops the divider", /\.acc--tabs \.acc__panel\s*\{[\s\S]*?border-top:\s*none/.test(css));
})();

// ---- §6: author-selectable surface pattern (grid / dots / none) + colour ----
// Shared across card-reveal + accordion/tabs. Pure block data -> data-pattern + --tex-color.
section("surface pattern controls");
(function () {
  var css = src("src/course.css");
  var r = src("src/render.js");
  var e = src("src/editor.js");
  // texture colour is parametrised (--tex-color) on BOTH blocks, defaulting to the hairline
  ok("card grid texture uses --tex-color", /\.card-reveal__card::before\s*\{[\s\S]*?var\(--tex-color, var\(--color-hair\)\)/.test(css));
  ok("acc grid texture uses --tex-color", /\.acc__item::before\s*\{[\s\S]*?var\(--tex-color, var\(--color-hair\)\)/.test(css));
  // dots variant (radial-gradient) + none variant (display:none) on each block
  ok("card dots variant", /\.card-reveal\[data-pattern="dots"\] \.card-reveal__card::before\s*\{[\s\S]*?radial-gradient/.test(css));
  ok("card none variant hides the texture", /\.card-reveal\[data-pattern="none"\] \.card-reveal__card::before\s*\{[\s\S]*?display:\s*none/.test(css));
  ok("acc dots variant", /\.acc\[data-pattern="dots"\] \.acc__item::before[\s\S]*?radial-gradient/.test(css));
  ok("acc none variant hides the texture", /\.acc\[data-pattern="none"\] \.acc__item::before[\s\S]*?display:\s*none/.test(css));
  ok("acc--tabs dots + none variants", /\.acc--tabs\[data-pattern="dots"\]::before/.test(css) && /\.acc--tabs\[data-pattern="none"\]::before/.test(css));
  // render stamps data-pattern + --tex-color on both roots
  ok("cardReveal render stamps data-pattern", /root\.setAttribute\("data-pattern", block\.pattern === "dots" \|\| block\.pattern === "none" \? block\.pattern : "grid"\)/.test(r));
  ok("cardReveal render pipes --tex-color", /block\.patternColor\) root\.style\.setProperty\("--tex-color", block\.patternColor\)/.test(r));
  ok("accordion render stamps data-pattern + --tex-color", (r.match(/root\.setAttribute\("data-pattern"/g) || []).length >= 2 && (r.match(/setProperty\("--tex-color", block\.patternColor\)/g) || []).length >= 2);
  // inspector: shared control on both block types (segmented Grid/Dots/None + colour)
  ok("patternControls helper exists", /function patternControls\(block, refresh, target\)/.test(e));
  ok("patternControls offers Grid/Dots/None", /segmentedLive\("Pattern", \[\["Grid", "grid"\], \["Dots", "dots"\], \["None", "none"\]\]/.test(e));
  ok("patternControls has a colour control (colorFieldFlat)", /colorFieldFlat\("Pattern colour", block\.patternColor/.test(e));
  ok("both inspectors call patternControls", (e.match(/patternControls\(block, refresh\)/g) || []).length >= 2);
})();

// ---- accordion/cardReveal children are first-class in the block tree --------
// Regression: items[].children must be walked by the delete/drop/traversal paths,
// else deleting a nested child no-ops and a dropped block silently disappears.
section("nested items[].children traversal");
(function () {
  var e = src("src/editor.js");
  var r = src("src/render.js");
  // findBlockParent recurses into items[].children (fixes delete + drag-move + drop)
  ok("findBlockParent walks items[].children", /function findBlockParent[\s\S]*?Array\.isArray\(b\.items\)[\s\S]*?b\.items\[it\]\s*&&\s*b\.items\[it\]\.children[\s\S]*?findBlockParent\(kids, targetBlock\)/.test(e));
  // walkPageBlocks (cycle-detection + full-tree ops) walks items[].children
  ok("walkPageBlocks walks items[].children", /function walkPageBlocks[\s\S]*?b\.items\.forEach\(function \(item\) \{ if \(!item\) return; if \(item\.children\) walkPageBlocks\(item\.children, fn\)/.test(e));
  // render walkBlocks (interaction map) walks items[].children so interactive blocks
  // inside an accordion still get their interaction/gate entry
  ok("render walkBlocks walks items[].children", /function walkBlocks[\s\S]*?Array\.isArray\(b\.items\)[\s\S]*?item\.children[\s\S]*?walkBlocks\(item\.children, fn\)/.test(r));
  // flip fronts (items[].front) are a first-class block list in the same traversals —
  // missing any of these re-opens the nested-children silent-data-loss class for Side 1.
  ok("findBlockParent walks items[].front", /function findBlockParent[\s\S]*?b\.items\[it\]\s*&&\s*b\.items\[it\]\.front[\s\S]*?findBlockParent\(fkids, targetBlock\)/.test(e));
  ok("walkPageBlocks walks items[].front", /function walkPageBlocks[\s\S]*?if \(Array\.isArray\(item\.front\)\) walkPageBlocks\(item\.front, fn\)/.test(e));
  ok("render walkBlocks walks items[].front", /function walkBlocks[\s\S]*?Array\.isArray\(item\.front\)\) walkBlocks\(item\.front, fn\)/.test(r));
  ok("remintIds walks items[].front (duplicate never shares ids)", /function remintIds[\s\S]*?Array\.isArray\(it\.front\)\) it\.front\.forEach\(remintIds\)/.test(e));
  ok("export validation walk covers items children + fronts", /if \(Array\.isArray\(it\.children\)\) walk\(it\.children\); if \(Array\.isArray\(it\.front\)\) walk\(it\.front\)/.test(src("src/export.js")));
})();

// ---- FLAGSHIP "Sequence" block — slice 1 tracer (Numbered · Vertical · Static) --------
// One block, spine-mode toggle, rich per-step body (items[].children). Structurally an
// accordion + spine, so it inherits the generic items[].children traversal guarded above —
// these guards lock the tracer render + registration + token-driven styling.
section("sequence block tracer");
(function () {
  var r = src("src/render.js");
  var e = src("src/editor.js");
  var css = src("src/course.css");
  // render function is registered in the BLOCKS map
  ok("render registers a sequence block", /\n    sequence: function \(block\) \{/.test(r));
  // node numbering is DERIVED from the index at render (index+1), never read from a stored field
  ok("sequence numbers are derived (index+1), not stored", /if \(spine === "numbered"\) marker\.textContent = String\(i \+ 1\)/.test(r));
  // Dated spine uses per-step free-text item.date, falling back to the number when empty
  ok("sequence dated spine uses free-text item.date with number fallback", /spine === "dated"[\s\S]*?item\.date[\s\S]*?String\(i \+ 1\)/.test(r));
  // rich body: each step renders its item.children through renderBlock (the moat over fixed-field steps)
  ok("sequence renders item.children via renderBlock", /\(item\.children \|\| \[\]\)\.forEach\(function \(child\) \{ var n = renderBlock\(child\); n\.__block = child;/.test(r));
  // forward hooks stamped now so editor toggles / reveal engine / appearance wire onto stable DOM
  ok("sequence stamps spine/orient/reveal data-* hooks", /setAttribute\("data-seq-spine", spine\)[\s\S]*?setAttribute\("data-seq-orient", orient\)[\s\S]*?setAttribute\("data-seq-reveal", reveal\)/.test(r));
  // shared surface-texture shape (data-pattern + --tex-color), like accordion / card-reveal
  ok("sequence stamps data-pattern + --tex-color", /root\.setAttribute\("data-pattern", block\.pattern === "dots" \|\| block\.pattern === "none" \? block\.pattern : "grid"\)/.test(r) && /block\.patternColor\) root\.style\.setProperty\("--tex-color", block\.patternColor\)/.test(r.slice(r.indexOf("sequence: function"))));
  // registration: container-classifier treats it as a "block", palette entry exists in Layout
  ok("sequence is a container 'block' in the selection classifier", /block\.type === "cardReveal" \|\| block\.type === "sequence"/.test(e));
  ok("sequence has a Layout palette entry seeding 3 steps", /label: "Sequence[\s\S]*?type: "sequence", spine: "numbered", orient: "vertical", reveal: "scroll", items: \[1, 2, 3\]/.test(e));
  // token-driven styling only (design-gate: no bespoke per-element colour): connector = hairline,
  // node surface = per-mode card fill, marker text = accent
  ok("seq connector is token-driven (hairline default)", /--seq-connector, var\(--color-hair\)/.test(css));
  ok("seq node surface switches per-mode (dark/light) like the cards", /data-mode="dark"\] \.seq \{ --seq-node/.test(css) && /data-mode="light"\] \.seq \{ --seq-node/.test(css));
  ok("seq marker text defaults to the accent token", /\.seq__marker \{[\s\S]*?color: var\(--seq-node-text, var\(--color-accent\)\)/.test(css));
  ok("seq plain spine renders a dot (no number/date label)", /\.seq\[data-seq-spine="plain"\] \.seq__marker/.test(css));
})();

// ---- Card Deck block — paged "carousel" of full-frame cards -------------------------
// One card shown at a time at runtime (‹ › paging + counter); editor shows all cards
// stacked so each body is a drop target. Same items[].children shape as card-reveal /
// sequence -> nested delete/drag/drop/traversal inherited. Numbers DERIVED at render.
section("card deck block");
(function () {
  var r = src("src/render.js");
  var e = src("src/editor.js");
  var css = src("src/course.css");
  var rt = src("src/runtime.js");
  ok("render registers a cardDeck block", /\n    cardDeck: function \(block\) \{/.test(r));
  var cd = r.slice(r.indexOf("cardDeck: function"), r.indexOf("accordion: function"));
  // card numbers are DERIVED from index at render (pad2(i+1) / total), never stored
  ok("cardDeck numbers are derived (index+1 / total), not stored", /pad2\(i \+ 1\)/.test(cd) && /pad2\(total\)/.test(cd));
  // rich body: each card renders its item.children through renderBlock (droppable body)
  ok("cardDeck renders item.children via renderBlock", /\(item\.children \|\| \[\]\)\.forEach\(function \(child\) \{ var n = renderBlock\(child\); n\.__block = child;/.test(cd));
  // optional per-card author label (section tag), rendered only when non-empty
  ok("cardDeck renders optional per-card label", /item\.label != null && String\(item\.label\)\.trim\(\) !== ""/.test(cd));
  // paging chrome: prev/next nav buttons + counter, emitted static (runtime binds them)
  ok("cardDeck emits ‹ › nav buttons + counter", /card-deck__prev/.test(cd) && /card-deck__next/.test(cd) && /card-deck__count/.test(cd));
  // shared surface-texture shape (data-pattern + --tex-color), like sequence/card-reveal
  ok("cardDeck stamps data-pattern + --tex-color", /root\.setAttribute\("data-pattern", block\.pattern === "dots" \|\| block\.pattern === "none" \? block\.pattern : "grid"\)/.test(cd) && /block\.patternColor\) root\.style\.setProperty\("--tex-color", block\.patternColor\)/.test(cd));
  // per-mode fill switches light/dark (author override via cardBox.fillDark/fillLight)
  ok("cardDeck fill switches per-mode", /--cd-fill-dark/.test(cd) && /--cd-fill-light/.test(cd));
  // registration: container-classifier treats it as a "block"; TWO_LEVEL; Layout palette
  ok("cardDeck is a container 'block' in the selection classifier", /block\.type === "cardDeck" \|\| block\.type === "courseNav"/.test(e));
  ok("cardDeck is a two-level type", /cardReveal: 1, cardDeck: 1/.test(e));
  ok("cardDeck has a Layout palette entry", /label: "Card Deck \(carousel\)"[\s\S]*?type: "cardDeck", items:/.test(e));
  ok("block inspector dispatches cardDeck -> two-level shell (renderCardDeckInspector)", /block\.type === "cardDeck"\) \{ renderBlockTwoLevel\(node, "Card deck", CONTENT_DECL, renderCardDeckInspector\); return; \}/.test(e));
  ok("renderCardDeckInspector exists + reuses repeatedList + patternControls", /function renderCardDeckInspector\(node\)/.test(e) && /repeatedList\(inspector, "Cards"/.test(e) && /patternControls\(block, refresh\)/.test(e.slice(e.indexOf("function renderCardDeckInspector"))));
  // runtime paging engine wired into create(), armed so the editor still shows all cards
  ok("runtime defines bindCardDeck + create() calls it", /function bindCardDeck\(root\)/.test(rt) && /bindCardDeck\(root\); \/\/ Card Deck paging/.test(rt));
  ok("cardDeck paging is runtime-gated (is-armed), clamped (no wrap)", /deck\.classList\.add\("is-armed"\)/.test(rt) && /active > 0/.test(rt) && /active < cards\.length - 1/.test(rt));
  // CSS: token-driven, per-mode fill, is-armed shows only the active card
  ok("cardDeck css: per-mode fill + is-armed active-only paging", /data-mode="dark"\] \.card-deck \{ --cd-card-fill: var\(--cd-fill-dark/.test(css) && /\.card-deck\.is-armed \.card-deck__card \{ display: none; \}/.test(css) && /\.card-deck\.is-armed \.card-deck__card\.is-active \{ display: flex; \}/.test(css));
  ok("cardDeck meta 'CARD NN' is accent, counter is muted (token-driven)", /\.card-deck__meta-card, \.card-deck__meta-num \{ color: var\(--color-accent\)/.test(css));
  // normalize: new type, coerce items to an array so a hand/agent-built doc can't crash
  ok("normalizeDoc coerces cardDeck items to an array", /b\.type === "cardDeck" && !Array\.isArray\(b\.items\)\) b\.items = \[\]/.test(e));
  // Issue #55: a left/right drop wraps the target into a columns row IN PLACE via
  // destLoc.parentArray[destLoc.index] -- so a block inside a card body (or any
  // container: accordion / card-reveal / group / hotspot) becomes multi-column. The
  // OLD path keyed off activePage.blocks.indexOf(target.targetBlock), which is -1 for
  // any nested target -> silent no-op. Guard: the wrap must use parentArray/index and
  // must NOT reintroduce the indexOf lookup.
  ok("left/right column-wrap uses destLoc.parentArray[destLoc.index] (works in containers, #55)",
    /destLoc\.ownerBlock === null\) \{[\s\S]*?destLoc\.parentArray\[destLoc\.index\] = \{\s*\n\s*type: "columns",\s*\n\s*columns: \[ \[draggedBlock\], \[target\.targetBlock\] \]/.test(e) &&
    /destLoc\.parentArray\[destLoc\.index\] = \{\s*\n\s*type: "columns",\s*\n\s*columns: \[ \[target\.targetBlock\], \[draggedBlock\] \]/.test(e));
  ok("left/right column-wrap no longer keys off activePage.blocks.indexOf (the nested no-op, #55)",
    !/activePage\.blocks\.indexOf\(target\.targetBlock\)/.test(e));
})();

// ---- Sequence block — slice 2: Steps inspector + Spine/Orientation toggles ----------
// Clones the accordion Steps pattern: segmented Spine (Numbered/Dated/Plain) + Orientation
// (V/H), a Steps section with per-step title (+ free-text date in Dated), reorder, delete,
// "+ block" escape-hatch. Horizontal renders fit/wrap (NOT a sideways filmstrip).
section("sequence inspector + toggles");
(function () {
  var e = src("src/editor.js");
  var css = src("src/course.css");
  // dedicated inspector, dispatched like accordion / cardReveal
  ok("renderSequenceInspector exists", /function renderSequenceInspector\(node\)/.test(e));
  ok("block inspector dispatches sequence -> two-level shell (Content = renderSequenceInspector)", /block\.type === "sequence"\) \{ renderBlockTwoLevel\(node, "Sequence", CONTENT_DECL, renderSequenceInspector\); return; \}/.test(e));
  var insp = e.slice(e.indexOf("function renderSequenceInspector"), e.indexOf("// TTTT: Card Reveal inspector"));
  // Spine segmented toggle (Numbered / Dated / Plain) writes block.spine
  ok("spine toggle offers Numbered/Dated/Plain", /segmentedLive\("Marker", \[\["Numbered", "numbered"\], \["Dated", "dated"\], \["Plain", "plain"\]\]/.test(insp) && /block\.spine = v;/.test(insp));
  // Orientation segmented toggle (Vertical / Horizontal) writes block.orient
  ok("orientation toggle offers Vertical/Horizontal", /segmentedLive\("Orientation", \[\["Vertical", "vertical"\], \["Horizontal", "horizontal"\]\]/.test(insp) && /block\.orient = v;/.test(insp));
  // Steps section: add (propHeader), per-step title field, reorder (swap), delete, +block
  ok("Steps use the repeatedList primitive with an Add step header", /repeatedList\(inspector, "Steps", \{[\s\S]*?addLabel: "Add step"/.test(insp));
  ok("per-step title = repeatedList value/setValue on item.title", /value: function \(it\) \{ return it\.title; \}[\s\S]*?setValue: function \(it, v\) \{ it\.title = v;/.test(insp));
  ok("Dated spine shows a free-text date field (rowExtras)", /if \(spine === "dated"\) \{[\s\S]*?rep-row__extra-field[\s\S]*?item\.date = dateIn\.value/.test(insp));
  ok("reorder = repeatedList move (splice from -> to)", /move: function \(from, to\) \{ var m = block\.items\.splice\(from, 1\)\[0\]; block\.items\.splice\(to, 0, m\);/.test(insp));
  ok("delete = repeatedList remove (splice i)", /remove: function \(i\) \{ block\.items\.splice\(i, 1\)/.test(insp));
  ok("+ block escape-hatch pushes a paragraph into the step (rowExtras)", /Add a text block to this step[\s\S]*?item\.children\.push\(\{ type: "paragraph"/.test(insp));
  // reuses the shared surface-texture control (like accordion / cardReveal)
  ok("sequence inspector reuses patternControls", /patternControls\(block, refresh\)/.test(insp));
  // #37: sequence adopts the canonical taxonomy (Behaviour/Appearance/Content sectionGroups),
  // no longer a flat panel — the last item-list straggler now matches accordion/cardReveal.
  ok("#37: sequence wraps its body in beginSections()/endSections()", /beginSections\(\);/.test(insp) && /endSections\(inspector\);/.test(insp));
  ok("#37: sequence has Behaviour + Appearance + Content sectionGroups", /sectionGroup\("Behaviour", "Behaviour"/.test(insp) && /sectionGroup\("Appearance", "Appearance"/.test(insp) && /sectionGroup\("Content", "Steps"/.test(insp));
  ok("#37: sequence dropped the flat sub(\"Spine\") header (Behaviour title carries it)", !/sub\("Spine"\)/.test(insp));
  // Horizontal orientation CSS: fit/wrap row, overflow-x reachability only, horizontal connector
  ok("horizontal orientation lays steps in a wrapping row", /\.seq\[data-seq-orient="horizontal"\] \{[\s\S]*?flex-direction: row; flex-wrap: wrap/.test(css));
  ok("horizontal is fit/wrap with overflow-x for reachability only", /\.seq\[data-seq-orient="horizontal"\] \{[\s\S]*?overflow-x: auto/.test(css));
  ok("horizontal connector runs between markers", /\.seq\[data-seq-orient="horizontal"\] \.seq__step:not\(:last-child\)::before/.test(css));
})();

// ---- Sequence block — slice 3: reveal engine (Scroll / Click / Static) ---------------
// ONE DOM-bound engine (bindSequence), three author modes read from data-seq-reveal, wired
// into the runtime create() so it ships in the exported SCORM. Reduced-motion -> static.
section("sequence reveal engine");
(function () {
  var rt = src("src/runtime.js");
  var r = src("src/render.js");
  var css = src("src/course.css");
  var e = src("src/editor.js");
  // one bind function, registered in the engine + exported like the other binds
  ok("bindSequence exists in the runtime", /function bindSequence\(root\)/.test(rt));
  ok("create() calls bindSequence(root)", /bindSequence\(root\); \/\/ FLAGSHIP sequence reveal engine/.test(rt));
  ok("bindSequence is exported on CourseRuntime", /bindSequence: bindSequence/.test(rt));
  var bs = rt.slice(rt.indexOf("function bindSequence"), rt.indexOf("// ---- the engine"));
  // reads the author mode off the DOM hook
  ok("reveal reads data-seq-reveal", /seq\.getAttribute\("data-seq-reveal"\)/.test(bs));
  // scroll: a dedicated IntersectionObserver adds .is-in on entry (element reveal, not the
  // page-completion gate)
  ok("scroll uses an IntersectionObserver adding .is-in", /mode === "scroll"[\s\S]*?new win\.IntersectionObserver[\s\S]*?classList\.add\("is-in"\)/.test(bs));
  // hiding is runtime-gated via .is-armed (never a bare selector) so the editor shows all steps
  ok("scroll arms the block at runtime (editor never hides)", /seq\.classList\.add\("is-armed"\)/.test(bs));
  // click: cumulative wizard advances an active index, hiding future steps
  ok("click wizard advances an active index (cumulative)", /mode === "click"[\s\S]*?classList\.toggle\("is-future", i > active\)[\s\S]*?active\+\+/.test(bs));
  // reduced-motion OR no-IO OR static -> reveal everything up front (never trap a step hidden)
  ok("reduced-motion / static falls back to show-all", /var reduce = !!\(win\.matchMedia[\s\S]*?"\(prefers-reduced-motion: reduce\)"/.test(bs) && /steps\.forEach\(function \(s\) \{ s\.classList\.add\("is-in"\); \}\)/.test(bs));
  // render emits the ‹ counter › wizard ONLY for click (so editor == export; inert otherwise)
  ok("render emits the click wizard only for reveal==click", /if \(reveal === "click"\) \{[\s\S]*?seq__wizard[\s\S]*?seq__counter[\s\S]*?navArrow\("right"\)/.test(r));
  // CSS: scroll hides-then-reveals via .is-in; connector fills on the passed step; wizard shown
  // only in click; future steps hidden by the runtime class; reduced-motion shows all
  ok("armed steps start hidden and reveal on .is-in", /\.seq\.is-armed \.seq__step \{[\s\S]*?opacity: 0/.test(css) && /\.seq\.is-armed \.seq__step\.is-in \{ opacity: 1/.test(css));
  ok("hiding is gated on .is-armed, never a bare data-seq-reveal selector", !/\.seq\[data-seq-reveal="scroll"\] \.seq__step \{[\s\S]*?opacity: 0/.test(css));
  ok("connector progress-fill on the passed step uses the accent token", /\.seq\.is-armed \.seq__step\.is-in:not\(:last-child\)::before \{ background: var\(--seq-fill, var\(--color-accent\)\)/.test(css));
  ok("wizard is hidden unless click mode", /\.seq__wizard \{ display: none; \}/.test(css) && /\.seq\[data-seq-reveal="click"\] \.seq__wizard \{/.test(css));
  ok("click hides future steps via the runtime class", /\.seq\[data-seq-reveal="click"\] \.seq__step\.is-future \{ display: none; \}/.test(css));
  ok("reduced-motion forces armed steps to show statically", /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.seq\.is-armed \.seq__step \{ opacity: 1; transform: none/.test(css));
  // inspector: Reveal segmented toggle writes block.reveal
  ok("inspector has a Reveal toggle (Scroll/Click/Static)", /segmentedLive\("Reveal", \[\["Scroll", "scroll"\], \["Click", "click"\], \["Static", "static"\]\]/.test(e) && /block\.reveal = v;/.test(e));
})();

// ---- Sequence block — slice 4: appearance (token-driven + surface texture) ------------
// Universal appearance (applyBlockAppearance / renderAppearanceSection) already reaches the
// block via renderBlockActionsSection; slice 4 adds the shared grid/dots/none surface texture
// (data-pattern) so the patternControls toggle (added in slice 2) actually renders.
section("sequence appearance + texture");
(function () {
  var css = src("src/course.css");
  var r = src("src/render.js");
  var e = src("src/editor.js");
  // texture ::before on the .seq root, keyed by data-pattern + --tex-color (shape shared with
  // accordion / card-reveal), sitting behind the lifted step content
  ok("seq grid texture uses --tex-color", /\.seq::before \{[\s\S]*?var\(--tex-color, var\(--color-hair\)\)/.test(css));
  ok("seq dots variant (radial-gradient)", /\.seq\[data-pattern="dots"\]::before \{[\s\S]*?radial-gradient/.test(css));
  ok("seq none variant hides the texture", /\.seq\[data-pattern="none"\]::before \{ display: none; \}/.test(css));
  ok("seq texture follows the author corner radius", /\.seq::before \{[\s\S]*?border-radius: inherit/.test(css));
  ok("seq lifts step + wizard content above the texture", /\.seq > \.seq__step, \.seq > \.seq__wizard \{ position: relative; z-index: 1; \}/.test(css));
  // render stamps data-pattern (grid default) + pipes --tex-color, like the sibling blocks
  ok("sequence render stamps data-pattern + --tex-color", /root\.setAttribute\("data-pattern", block\.pattern === "dots" \|\| block\.pattern === "none" \? block\.pattern : "grid"\)/.test(r.slice(r.indexOf("sequence: function"))));
  // universal appearance panel reaches the block via renderBlockActionsSection (not suppressed)
  ok("sequence inspector runs the universal renderBlockActionsSection (appearance not suppressed)", /function renderSequenceInspector[\s\S]*?renderBlockActionsSection\(block\);\n  \}/.test(e));
})();

// ---- Sequence block — slice 5: per-step icons ----------------------------------------
// item.icon replaces the number/dot marker in every spine (recoloured via inlineSvg for SVG
// data-URLs; raster falls back to <img>); Dated keeps its date beside the icon; absent -> number.
section("sequence per-step icons");
(function () {
  var r = src("src/render.js");
  var e = src("src/editor.js");
  var css = src("src/course.css");
  var seqFn = r.slice(r.indexOf("sequence: function"), r.indexOf("// Item FF"));
  // icon REPLACES the marker; SVG data-URL is inlined + recoloured, raster falls back to <img>
  ok("icon replaces the marker (inlineSvg mono, else <img>)", /if \(item\.icon\) \{[\s\S]*?inlineSvg\(\{ src: item\.icon, mono: true \}\)[\s\S]*?el\("img", "seq__icon-img"\); iimg\.src = assetSrc\(item\.icon\)/.test(seqFn));
  // absent icon -> the derived number is still the marker (no regression to slice 1)
  ok("absent icon falls back to the derived number", /else if \(spine === "numbered"\) marker\.textContent = String\(i \+ 1\)/.test(seqFn));
  // Dated + icon: the date moves beside the icon as a caption (icon took the marker slot)
  ok("dated + icon keeps the date beside the icon", /if \(item\.icon && spine === "dated" && hasDate\) body\.appendChild\(el\("div", "seq__date", String\(item\.date\)\)\)/.test(seqFn));
  // editor: per-step icon slot uploads via assetRef and a Remove control clears it
  var insp = e.slice(e.indexOf("function renderSequenceInspector"), e.indexOf("// TTTT: Card Reveal inspector"));
  ok("inspector step row has an icon upload (assetRef, rowExtras)", /iconBtn\("image"[\s\S]*?item\.icon = assetRef\(rd\.result, f\)/.test(insp));
  ok("inspector shows a Remove icon control when set (rowExtras)", /if \(item\.icon\) \{ var rm = iconBtn\("minus"[\s\S]*?delete item\.icon/.test(insp));
  // CSS: icon fills the node; plain-dot shrink excludes icon markers so the icon keeps full size
  ok("icon marker sizes the glyph within the node", /\.seq__marker--icon svg, \.seq__marker--icon \.seq__icon-img \{[\s\S]*?width: 62%/.test(css));
  ok("plain-spine dot shrink excludes icon markers", /\.seq\[data-seq-spine="plain"\] \.seq__marker:not\(\.seq__marker--icon\)/.test(css));
  ok("date caption styling exists for dated+icon", /\.seq__date \{[\s\S]*?color: var\(--color-accent\)/.test(css));
})();

// ---- #174: Clear content — recursive subtree blank (keep skeleton) --------------------
// Extract the PURE clearBlockContent (+ its TEXT_CONTENT_TYPES table) from editor.js and
// exercise it directly: it must wipe copy/images/embeds/interactive-copy while keeping every
// sub-block, column, item and question (the skeleton), and recurse the canonical subtree shape.
section("clear content #174");
(function () {
  var e = src("src/editor.js");
  var s = e.indexOf("var TEXT_CONTENT_TYPES = {");
  var end = e.indexOf("window.__clearBlockContent");
  ok("#174 clearBlockContent + TEXT_CONTENT_TYPES present in editor.js", s >= 0 && end > s);
  var clearBlockContent = new Function(e.slice(s, end) + "\nreturn clearBlockContent;")();

  // text-style blocks -> empty .text
  var tb = { type: "paragraph", text: "hello" }; clearBlockContent(tb);
  ok("text block .text emptied", tb.text === "");
  // image -> asset + copy refs cleared
  var img = { type: "image", src: "asset:1", srcLight: "asset:2", srcDark: "asset:3", alt: "a", caption: "c" }; clearBlockContent(img);
  ok("image src/srcLight/srcDark/alt/caption cleared", !("src" in img) && !("srcLight" in img) && !("srcDark" in img) && !("alt" in img) && !("caption" in img));
  // htmlEmbed -> html + src cleared
  var em = { type: "htmlEmbed", html: "<b>x</b>", src: "asset:9" }; clearBlockContent(em);
  ok("htmlEmbed html+src cleared", !("html" in em) && !("src" in em));
  // container (group children) -> child content cleared, child KEPT
  var grp = { type: "group", children: [{ type: "heading", text: "H" }, { type: "image", src: "asset:x" }] }; clearBlockContent(grp);
  ok("group children kept (skeleton) + cleared", grp.children.length === 2 && grp.children[0].text === "" && !("src" in grp.children[1]));
  // columns[] recursion
  var cols = { type: "columns", columns: [[{ type: "paragraph", text: "p" }], [{ type: "paragraph", text: "q" }]] }; clearBlockContent(cols);
  ok("columns recursion clears each column's blocks (kept)", cols.columns.length === 2 && cols.columns[0][0].text === "" && cols.columns[1][0].text === "");
  // items[] (accordion) — title + nested children cleared, item KEPT
  var acc = { type: "accordion", items: [{ title: "Sec", children: [{ type: "paragraph", text: "body" }] }] }; clearBlockContent(acc);
  ok("accordion item title emptied + child cleared, item kept", acc.items.length === 1 && acc.items[0].title === "" && acc.items[0].children[0].text === "");
  // cardReveal flip fronts (items[].front) + label/date
  var cr = { type: "cardReveal", hint: "flip me", items: [{ label: "L", front: [{ type: "heading", text: "F" }], children: [{ type: "paragraph", text: "b" }] }] }; clearBlockContent(cr);
  ok("cardReveal hint + item label cleared, front + children recursed", !("hint" in cr) && !("label" in cr.items[0]) && cr.items[0].front[0].text === "" && cr.items[0].children[0].text === "");
  // quiz — prompt/options/feedback cleared, questions + options KEPT
  var qz = { type: "quiz", questions: [{ prompt: "Q?", feedbackCorrect: "yes", feedbackIncorrect: "no", options: [{ text: "A", correct: true }, { text: "B" }] }] }; clearBlockContent(qz);
  ok("quiz prompt/feedback/option text cleared, structure kept", qz.questions.length === 1 && qz.questions[0].prompt === "" && !("feedbackCorrect" in qz.questions[0]) && qz.questions[0].options.length === 2 && qz.questions[0].options[0].text === "" && qz.questions[0].options[0].correct === true);
  // hotspot (#215 unified screen-graph) — screen visuals/alt + marker labels cleared;
  // markers keep position/action/target skeleton, card blocks recursed + KEPT
  var hs = { type: "hotspot", markerSvg: "asset:m", entry: "scr-entry", screens: [
    { id: "scr-entry", visual: "asset:i", kind: "image", alt: "img", markers: [{ id: "hs_a", label: "L", x: 10, y: 20, action: "card", blocks: [{ type: "paragraph", text: "t" }] }] }
  ] }; clearBlockContent(hs);
  ok("hotspot visuals+marker labels cleared, marker kept (x/y intact) + blocks recursed", !("markerSvg" in hs) && !("visual" in hs.screens[0]) && !("alt" in hs.screens[0]) && hs.screens[0].markers.length === 1 && !("label" in hs.screens[0].markers[0]) && hs.screens[0].markers[0].x === 10 && hs.screens[0].markers[0].blocks[0].text === "");
  // idempotent + safe on junk
  ok("clearBlockContent is safe on null/non-object", (function () { try { clearBlockContent(null); clearBlockContent(undefined); clearBlockContent(5); return true; } catch (_) { return false; } })());

  // wiring guards: exposed on both surfaces + gated
  ok("#174 outliner context menu offers 'Clear content'", /label: "Clear content", onClick: function \(\) \{ clearBlockContentAction\(multi \? multiSel\.slice\(\) : block\); \}/.test(e));
  ok("#174 canvas right-click menu offers 'Clear content' (parity)", /label: "Clear content", onClick: function \(\) \{ clearBlockContentAction\(\[target\.block\]\); \}/.test(e));
  ok("#174 canvas block toolbar (showBlockToolbar) has the eraser Clear content button", /iconBtn\("eraser", "Clear content \(keep structure\)"\)[\s\S]{0,120}clearBlockContentAction\(\[block\]\)/.test(e));
  // container/two-level blocks (accordion/columns/group/image/quiz...) render the toolbar via
  // renderContainerChrome's acts[] — the eraser must be there too (shared handlers.clearContent).
  ok("#174 container-chrome acts[] includes the eraser via handlers.clearContent", /handlers\.clearContent === "function"\) acts\.push\(\["eraser", "Clear content \(keep structure\)", handlers\.clearContent, false\]\)/.test(e));
  ok("#174 blockChromeHandlers exposes clearContent -> clearBlockContentAction([block])", /clearContent: function \(\) \{ clearBlockContentAction\(\[block\]\); \}/.test(e));
  ok("#174 clear action is confirm-gated + pushes history (destructive, undoable)", /confirmModal\("Clear content",[\s\S]{0,220}pushHistory\(\);[\s\S]{0,120}list\.forEach\(clearBlockContent\)/.test(e));
  ok("#174 eraser glyph vendored in icons.js", /"eraser":/.test(src("src/icons.js")));
})();

// ---- PPPP: spacer/block droppable at the TOP of a column -------------------
// The columns TOP edge-band must sit ENTIRELY ABOVE the column content so it no
// longer steals the first block's "before" zone (which forced a page-level insert
// instead of column index 0). Guard the geometry: top:-16px + height:16px = [-16,0].
section("columns top-band clears content");
(function () {
  var css = src("editor.css");
  ok("top edge-band lifted above content (top:-16px)", /\.columns-edge-band--top\s*\{[^}]*top:\s*-16px/.test(css));
  ok("top edge-band height 16px (bottom edge = node top)", /\.columns-edge-band--top\s*\{[^}]*height:\s*16px/.test(css));
  // bottom band untouched (it works today)
  ok("bottom edge-band unchanged (bottom:-4px)", /\.columns-edge-band--bottom\s*\{[^}]*bottom:\s*-4px/.test(css));
})();

// ---- Cmd+\ maximise: canvas must span the row when panels are hidden -----------
// REGRESSION: `.panel { display:none }` removes the panels as grid items, so the lone
// canvas auto-places into column 1 (the 0px track) -> width:0 -> whole window looks
// dark. The canvas must be pinned to span every track. (Layout is the browser seam;
// this guards the CSS rule so the fix can't silently regress.)
section("Cmd+backslash canvas spans row");
(function () {
  var css = src("editor.css");
  ok("panels-hidden pins the canvas across all grid tracks", /\.workspace\.is-panels-hidden \.canvas\s*\{[^}]*grid-column:\s*1 \/ -1/.test(css));
})();

// ---- richer bullet lists: marker style/colour + nesting + paste-clean --------
section("richer bullet lists");
(function () {
  var r = src("src/render.js");
  var css = src("src/course.css");
  var e = src("src/editor.js");
  ok("editable stamps data-list-marker", /obj\.listMarker\) node\.setAttribute\("data-list-marker", obj\.listMarker\)/.test(r));
  ok("editable pipes --li-marker-color", /obj\.listMarkerColor\) node\.style\.setProperty\("--li-marker-color", obj\.listMarkerColor\)/.test(r));
  ok("editable pipes custom glyph + size", /obj\.listMarker === "custom" && obj\.listMarkerChar/.test(r) && /obj\.listMarkerSize[\s\S]*?--li-marker-size/.test(r));
  ok("css marker colour via ::marker", /\[data-list-marker\] li::marker \{ color: var\(--li-marker-color/.test(css));
  ok("css native marker types keyed on data-list-marker", /\[data-list-marker="square"\] li \{ list-style-type: square/.test(css) && /\[data-list-marker="decimal"\] li/.test(css));
  ok("css custom-glyph ::before markers", /\[data-list-marker="custom"\] li::before \{ content: var\(--li-marker/.test(css));
  ok("css applies to inline lists in any field", /\.body-copy ul, \.body-copy ol/.test(css));
  ok("css nested levels distinct markers", /\.body-list ul ul, \.body-copy ul ul ul \{ list-style-type: square/.test(css));
  ok("editor list is a single on/off switch (no doubled ul/ol pair)", /switchRow\("List", listOn,/.test(e) && !/\["• List", "insertUnorderedList"\], \["1\. List", "insertOrderedList"\]/.test(e));
  ok("editor list marker controls only render when the list is on", /if \(listOn\(\)\) \{[\s\S]*?customSelectRow\("Bullet style"/.test(e));
  ok("editor list off-branch clears both ul and ol", /queryCommandState\("insertOrderedList"\)\) document\.execCommand\("insertOrderedList"[\s\S]*?queryCommandState\("insertUnorderedList"\)\) document\.execCommand\("insertUnorderedList"/.test(e));
  ok("editor Tab nests when caret in a list", /if \(e\.key === "Tab" && caretInList\(node\)\)/.test(e));
  ok("editor Bullet style rides on obj.listMarker", /customSelectRow\("Bullet style", markerOpts, \(obj\.listMarker \|\| "disc"\)/.test(e));
  ok("editor Bullet style options preview the marker glyph", /MARK_GLYPH\s*=\s*\{[\s\S]*?markerOpts\s*=\s*MARKERS\.map/.test(e));
  ok("customSelect exposes .value get\/set + change event", /function customSelect\([\s\S]*?dispatchEvent\(new Event\("change"\)\)[\s\S]*?Object\.defineProperty\(wrap, "value"/.test(e));
  // ⚙ settings modal (System / Project tabs) — James 2026-07-08
  ok("settings glyph (left rail) is wired to open the modal", /getElementById\("rail-settings-btn"\)[\s\S]*?openSettingsModal\(/.test(e));
  var ecss = src("editor.css");
  ok("doc inspector is lean (Canvas + pointer to the ⚙ modal)", /function renderDocumentInspector\(\)[\s\S]*?openSettingsModal\("project"\)/.test(e) && (e.match(/disclosure\("headerFooter"/g) || []).length === 0);
  ok("settings SYSTEM tab = Canvas + Component Library sections", /tab === "system"\) return \[[\s\S]*?key: "canvas"[\s\S]*?colourControl\("Background"[\s\S]*?key: "library", title: "Component Library", build: buildLibraryBody/.test(e));
  ok("settings PROJECT tab = the document sections (rail order)", /key: "headerFooter", title: "Header & Footer", build: buildHeaderFooterBody[\s\S]*?key: "glossary"[\s\S]*?key: "pipeline", title: "Review \(Viewer\)"/.test(e));
  ok("settings dialog = left rail + content pane (one section at a time)", /function renderSettingsBody\(\)[\s\S]*?settingsModal\.nav\.innerHTML = ""[\s\S]*?settings-nav__item[\s\S]*?section\.build\(settingsModal\.content\)/.test(e));
  ok("open modal stays in sync via refreshSettingsPanes in renderInspector", /function renderInspector\(\)[\s\S]*?refreshSettingsPanes\(\)/.test(e) && /function refreshSettingsPanes\(\) \{ if \(settingsModal && settingsModal\.active\) renderSettingsBody/.test(e));
  ok("settings dialog is fixed-size (no resize on tab switch)", /\.modal-box\.modal-box--settings \{[\s\S]*?height: min\(88vh, 800px\)/.test(ecss) && /\.settings-content \{ flex: 1 1 auto; overflow-y: auto/.test(ecss));
  ok("settings overlay hides via [hidden] override (css)", /\.modal-overlay\[hidden\] \{ display: none; \}/.test(ecss));
  ok("settings surface re-skinned to the DS (VersoUI tabs+button, surface-selected rail)", /window\.VersoUI\.Tabs\(\{/.test(e) && /window\.VersoUI\.Button\(\{ variant: "primary", label: "Done"/.test(e) && /\.settings-nav__item\.is-active \{ background: var\(--surface-selected\)/.test(ecss));
  // Contextual sidebar: selecting the footer nav bar surfaces its Learner-nav controls
  ok("courseNav selection has its own inspector (Learner nav controls inline)", /if \(block\.type === "courseNav"\) \{ renderCourseNavInspector\(node\); return; \}/.test(e) && /function renderCourseNavInspector\(node\)[\s\S]*?courseNavControls\(block, inspector\)/.test(e));
  ok("courseNav is treated as a block selection", /block\.type === "courseNav"\) return "block"/.test(e));
  ok("clicking the nav-bar background selects it (not its buttons/toggle)", /var navBar = e\.target\.closest\("\.course-nav\.canvas-block"\)[\s\S]*?!e\.target\.closest\("\[data-edit\], \.course-nav__btn, \.mode-toggle, button, a"\)[\s\S]*?setSelection\("block", navBar\)/.test(e));
  // PERF: incremental single-page render — James 2026-07-08
  ok("reapplyPage rebuilds ONE frame's content (renderPage + fold), not the world", /function reapplyPage\(i\)[\s\S]*?frameDescs\[i\][\s\S]*?window\.renderPage\(page[\s\S]*?enableEditing\(frame\)/.test(e));
  ok("reapplyPage falls back to full rebuild for variants\/language\/missing frame", /function reapplyPage\(i\) \{[\s\S]*?if \(!fd \|\| isPreview\(\)\) \{ reapplyWorld\(\); return; \}/.test(e));
  ok("reapplyBlock resolves the block's page then rebuilds just it", /function reapplyBlock\(block\) \{[\s\S]*?findPageOfBlock\(block\)[\s\S]*?reapplyPage\(pi\)/.test(e));
  ok("block Spacing edits use the incremental page rebuild", /var onSpace  = opts\.onSpace  \|\| function \(\) \{ reapplyBlock\(block\)/.test(e));
  ok("block Align\/Vertical edits use the incremental page rebuild", (e.match(/reapplyBlock\(block\); reselectBlockNode\(block, getSelectionTypeForBlock\(block\)\);/g) || []).length >= 2);
  ok("header\/footer padding pokes live on .course-header\/.course-footer", /function pokeHeaderFooterLive\(cfg, key\)[\s\S]*?cfg === hf\.header\) \? "\.course-header"[\s\S]*?cfg === hf\.footer\) \? "\.course-footer"/.test(e));
  ok("headerFooterNum tries the live poke before a full rebuild", /if \(!pokeHeaderFooterLive\(cfg, key\)\) reapplyHeaderFooter\(\)/.test(e));
  // nav progress pill: author Width + Height (BACKLOG §pill P2, James 2026-07-08)
  var rjs = src("src/render.js"), ccss = src("src/course.css");
  ok("render pipes pillWidth/pillHeight -> --nav-pill-width/-height + --pill-scale", /block\.pillWidth != null\) wrap\.style\.setProperty\("--nav-pill-width", block\.pillWidth \+ "px"\)[\s\S]*?block\.pillHeight != null\) \{[\s\S]*?setProperty\("--nav-pill-height", block\.pillHeight \+ "px"\)[\s\S]*?setProperty\("--pill-scale"/.test(rjs));
  ok("css pill forces width + height from the vars (border-box)", /box-sizing: border-box[\s\S]*?width: var\(--nav-pill-width, auto\); max-width: var\(--nav-pill-width, 460px\)[\s\S]*?height: var\(--nav-pill-height, auto\)/.test(ccss));
  ok("pill Width + Height iconFields in the Progress-pill nest", /iconField\("W", \{ value: child\.pillWidth/.test(e) && /iconField\("H", \{ value: child\.pillHeight/.test(e));
  ok("pillWidth/pillHeight in NAV_PILL_KEYS (override-dot + reset)", /NAV_PILL_KEYS = \[[^\]]*"pillWidth", "pillHeight"/.test(e));
  // nav pill drop shadow (James 2026-07-08)
  ok("render composes --nav-pill-shadow (off -> none, else offset/blur/spread/colour+opacity)", /block\.pillShadow === false\) wrap\.style\.setProperty\("--nav-pill-shadow", "none"\)[\s\S]*?color-mix\(in srgb, " \+ _scol \+ " " \+ _sop \+ "%, transparent\)/.test(rjs));
  ok("pill box-shadow reads the author var (base rule, single source)", /box-shadow: var\(--nav-pill-shadow, 0 10px 30px rgba\(0, 0, 0, 0\.35\)\)/.test(ccss));
  ok("Drop shadow controls in the Progress-pill nest", /panelSection\(h0, "Drop shadow"\)[\s\S]*?switchRow\("Drop shadow"[\s\S]*?child\.pillShadowX[\s\S]*?child\.pillShadowOpacity/.test(e));
  ok("shadow keys in NAV_PILL_KEYS", /"pillShadow", "pillShadowX", "pillShadowY", "pillShadowBlur", "pillShadowSpread", "pillShadowColor", "pillShadowOpacity"/.test(e));
})();


// ---- bullet-list discoverability: toggle on any text box + spacing promoted ----
section("list discoverability + spacing");
(function () {
  var e = src("src/editor.js");
  ok("line/letter spacing live in the field inspector's typeCluster (v2)", /typeCluster\(inspector, s, apply/.test(e) && /Icon\("line-height"\)[\s\S]*?model\.lineHeight/.test(e));
  ok("Advanced text disclosure removed", !/disclosure\("textAdvanced"/.test(e));
  ok("List folded into the Type section (sub) drives inline lists", /inspector\.appendChild\(sub\("List"\)\);[\s\S]*?insertUnorderedList/.test(e));
  ok("no paragraph<->list block-type conversion", !/textBlockToList/.test(e) && !/function listToTextBlock/.test(e));
  ok("caretInList helper drives list gestures", /function caretInList\(fieldNode\)/.test(e));
})();


// ---- multi-select + Delete removes BLOCKS, not a character (data-risk) --------
section("multi-select delete");
(function () {
  var e = src("src/editor.js");
  ok("Delete/Backspace fires deleteSelection when multiSel active", /\(e\.key === "Delete" \|\| e\.key === "Backspace"\) && \(!isTextTarget\(e\.target\) \|\| multiSel\.length\)/.test(e));
  ok("building a multi-selection blurs the caret", /function blurActiveText\(\)/.test(e) && /if \(multiSel\.length\) blurActiveText\(\)/.test(e));
  ok("range-select also blurs the caret", /for \(var k = a; k <= z; k\+\+\) multiSel\.push\([^)]*\);\s*\n\s*blurActiveText\(\)/.test(e));
})();

// ---- HTML embed Center align actually centres (fit offset) --------------------
section("embed align centering");
(function () {
  var e = src("src/editor.js");
  var x = src("src/export.js");
  var css = src("src/course.css");
  // unified responsive model: fit-to-width capped at natural (no fitFill), centred default
  ok("fitEmbedsIn scales fit-to-width capped at natural", /var s = Math\.min\(1, avail \/ dw\); \/\/ .174 unified/.test(e));
  ok("no Fit/Fill toggle in embed inspector", !/segmentedLive\("Width", \[\["Fit", "fit"\], \["Fill", "fill"\]\]/.test(e));
  ok("editor offsets frame per align (default start; embeds carry explicit center)", /var al = block\.align \|\| "start"; var off = al === "center" \? gap \/ 2 : \(al === "end" \? gap : 0\);[\s\S]*?frame\.style\.marginLeft/.test(e));
  ok("export runtime fit is fit-to-width (no data-fit-fill)", /var avail=f\.clientWidth\|\|dw; var s=Math\.min\(1, avail\/dw\);/.test(x) && !/data-fit-fill/.test(x));
  ok("export runtime aligns (default start)", /al=wrap\.getAttribute\('data-align'\)\|\|'start';[\s\S]*?frame\.style\.marginLeft=\(off>0\?off:0\)/.test(x));
  ok("migration drops fitFill + centres interactions", /if \(b\.type === "htmlEmbed"\) \{ if \(b\.fitFill != null\) delete b\.fitFill; if \(b\.align == null\) b\.align = "center"; \}/.test(e));
  ok("new interactions default centred", /\{ type: "htmlEmbed", height: 420, align: "center" \}/.test(e));
  ok("block-flow align centres a sized top-level block (embeds excluded)", /\.page > \[data-align="center"\]:not\(\[data-embed\]\) \{ margin-inline: auto/.test(css));
  ok("embeds skip wrap-level alignSelf (align via internal offset)", /if \(block\.type !== "htmlEmbed"\) node\.style\.alignSelf/.test(src("src/render.js")));
})();


// ---- font preview picker (Part B) ----------------------------
section("font preview picker");
(function () {
  var r = src("src/render.js"), e = src("src/editor.js"), css = src("editor.css");
  ok("render exposes fontStackFor (known stack or quoted family)", /window\.fontStackFor = function \(name\) \{ return name \? \(FONT_STACKS\[name\] \|\| \("'" \+ name \+ "', sans-serif"\)\) : ""; \}/.test(r));
  // the picker renders each option in its own font + exposes .value + fires change (attachFontWarn stays compatible)
  ok("buildFontPicker renders each option in its own font", /function buildFontPicker\(current, onPick\)[\s\S]*?row\.style\.fontFamily = stackFor\(v\)/.test(e));
  ok("picker exposes .value + dispatches change", /Object\.defineProperty\(wrap, "value"[\s\S]*?wrap\.dispatchEvent\(new Event\("change"\)\)/.test(e) || /wrap\.dispatchEvent\(new Event\("change"\)\)[\s\S]*?Object\.defineProperty\(wrap, "value"/.test(e));
  // all 3 plain <select> font pickers replaced by the shared component
  ok("all 3 font selects use buildFontPicker", (e.match(/buildFontPicker\(/g) || []).length >= 3);
  ok("no plain <select> font list remains", !/h\("select"[\s\S]{0,80}FONT_LIST\.map/.test(e));
  ok("picker CSS: popup listbox present", /\.font-picker__pop \{[\s\S]*?position: absolute/.test(css) && /\.font-picker__opt \{/.test(css));
})();

// ---- Google Fonts source + Arial -----------------------------------------
section("google fonts + arial");
(function () {
  var r = src("src/render.js"), e = src("src/editor.js");
  // Arial is a directly-pickable, air-gap-safe system font
  ok("Arial in FONT_STACKS", /"Arial": "Arial, Helvetica, sans-serif"/.test(r));
  ok("Arial in the air-gap-safe (embeddable) set", /EMBEDDABLE_FONTS = \["Exo 2", "System", "Arial"/.test(r));
  // curated Google set incl. popular families
  ok("curated Google set defined (popular families)", /var CURATED_GOOGLE_FONTS = \[[\s\S]*?"Roboto", "Open Sans", "Lato", "Montserrat", "Poppins"/.test(e));
  // fetch-at-author-time -> embed via the existing doc.fonts pipeline (no runtime CDN link ships)
  ok("Google font fetch embeds woff2(s) into doc.fonts (source:google)", /function fetchAndEmbedGoogleFont\(family\)[\s\S]*?fonts\.googleapis\.com\/css2[\s\S]*?\.woff2[\s\S]*?doc\.fonts\.push\(\{ family: family, src: assetRef\(f\.dataUrl[\s\S]*?format: "woff2", weight: parseInt\(f\.weight, 10\), source: "google"/.test(e));
  // multi-weight: pick one woff2 per weight (400 + 700) so bold is a real cut
  ok("Google fetch embeds a real cut per weight (400 + 700)", /byWeight\[w\][\s\S]*?wanted = weights\.filter\(function \(w\) \{ return w === "400" \|\| w === "700"; \}\)/.test(e));
  ok("buildFontFaceCss emits font-weight when present", /var wt = f\.weight \? "font-weight:" \+ f\.weight \+ ";" : "";/.test(e));
  // in-app Help: a toolbar button opens the User Guide (#81 — in-app modal, not a
  // new-tab window.open that no-ops in the desktop shell).
  ok("toolbar has a Help button", /id="help-btn"/.test(src("index.html")));
  ok("Help opens the in-app guide modal", /getElementById\("help-btn"\)[\s\S]{0,80}openHelpModal/.test(e));
  ok("fetch is overridable for tests + air-gap note in the UI", /var doFetch = window\.__fontFetch \|\| window\.fetch/.test(e) && /downloaded and EMBEDDED now/.test(e));
})();

// ---- KKK: buildFontFaceCss for uploaded custom fonts -----------------------
section("KKK custom-fonts");
(function () {
  var etxt = src("src/editor.js");
  var s = etxt.indexOf("function resolveFontDataUrl(src)");
  var e = etxt.indexOf("};", etxt.indexOf("window.buildFontFaceCss = function")) + 2;
  var win = {};
  new Function("window", etxt.slice(s, e))(win);
  var f = win.buildFontFaceCss;
  ok("builds @font-face for a data: font", /@font-face\{font-family:'Foo';src:url\('data:font\/ttf;base64,AA'\) format\('woff2'\);font-display:swap;\}/.test(f({ fonts: [{ family: "Foo", src: "data:font/ttf;base64,AA", format: "woff2" }] })));
  ok("empty CSS when no custom fonts", f({}) === "" && f({ fonts: [] }) === "");
  ok("defaults format to truetype", /format\('truetype'\)/.test(f({ fonts: [{ family: "Bar", src: "data:x,AA" }] })));
  ok("strips quotes/backslash from family name", f({ fonts: [{ family: "A'B\\C", src: "data:x,AA" }] }).indexOf("font-family:'ABC'") !== -1);
  ok("skips a font with an unresolvable (non-data) src", f({ fonts: [{ family: "Ghost", src: "asset:missing", format: "woff" }] }) === "");
})();

// ---- TTT: appendIntoContainer (drop a block into a group/frame/columns) -----
section("TTT into-container");
(function () {
  var etxt = src("src/editor.js");
  var body = etxt.slice(etxt.indexOf("function appendIntoContainer(cont, blk)"), etxt.indexOf("\n  }", etxt.indexOf("function appendIntoContainer(cont, blk)")) + 4);
  var appendIntoContainer = new Function(body + "\nreturn appendIntoContainer;")();
  var blk = { type: "heading", text: "x" };
  var frame = { type: "frame", children: [{ type: "paragraph" }] };
  appendIntoContainer(frame, blk);
  ok("frame: appended to children (end)", frame.children.length === 2 && frame.children[1] === blk);
  var group = { type: "group" }; // no children yet
  appendIntoContainer(group, blk);
  ok("group: creates children + appends", group.children && group.children.length === 1 && group.children[0] === blk);
  var cols = { type: "columns", columns: [[{ type: "note" }], [{ type: "quote" }]] };
  appendIntoContainer(cols, blk);
  ok("columns: appended to the FIRST column", cols.columns[0].length === 2 && cols.columns[0][1] === blk && cols.columns[1].length === 1);
  var empty = { type: "columns" }; // no columns
  appendIntoContainer(empty, blk);
  ok("columns: empty -> creates a first column", empty.columns.length === 1 && empty.columns[0][0] === blk);
})();

// ---- QQ: colour math (colour picker) --------------------------------------
section("QQ colour-math");
(function () {
  var t = src("src/editor.js");
  var body = t.slice(t.indexOf("function hexToRgb(hex)"), t.indexOf("window.__colourMath"));
  var m = new Function(body + "\nreturn { hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb, hsvToHex: hsvToHex };")();
  var eq = function (a, b) { return Math.abs(a - b) < 0.5; };
  ok("hexToRgb 6-digit", JSON.stringify(m.hexToRgb("#ff0000")) === JSON.stringify({ r: 255, g: 0, b: 0 }));
  ok("hexToRgb 3-digit", JSON.stringify(m.hexToRgb("#0f0")) === JSON.stringify({ r: 0, g: 255, b: 0 }));
  ok("hexToRgb invalid -> null", m.hexToRgb("nope") === null);
  ok("rgbToHex", m.rgbToHex(0, 0, 255) === "#0000ff");
  ok("rgbToHex clamps", m.rgbToHex(300, -5, 128) === "#ff0080");
  var hsv = m.rgbToHsv(255, 0, 0);
  ok("rgbToHsv red", eq(hsv.h, 0) && eq(hsv.s, 1) && eq(hsv.v, 1));
  var rgb = m.hsvToRgb(120, 1, 1);
  ok("hsvToRgb green", eq(rgb.r, 0) && eq(rgb.g, 255) && eq(rgb.b, 0));
  ok("hsvToHex", m.hsvToHex(240, 1, 1) === "#0000ff");
  ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef", "#808080"].forEach(function (hex) {
    var c = m.hexToRgb(hex), h = m.rgbToHsv(c.r, c.g, c.b);
    ok("round-trip " + hex, m.hsvToHex(h.h, h.s, h.v) === hex);
  });
})();

// ---- validateExport additions (OO-B: empty-course / oversized / dup-id) ----
// (small-fix agent; export.js was cold; folded in once run.js freed up.)
section("validateExport additions (OO-B)");
(function () {
  var t = src("src/export.js");
  // Slice from estimateCourseBytes so both it AND validateExport (which calls it) are in scope.
  var body = t.slice(t.indexOf("function estimateCourseBytes(doc)"), t.indexOf("window.__validateExport"));
  var assets = {};
  var win = {
    collectAssetRefs: function () { return Object.keys(assets); },
    AssetStore: { has: function (id) { return !!assets[id]; }, get: function (id) { return assets[id] ? { dataUrl: assets[id] } : null; } },
    FONT_LIST: ["Exo 2"], EMBEDDABLE_FONTS: ["Exo 2"]
  };
  var exp = new Function("window", "ENC", body + "\nreturn { validateExport: validateExport, estimateCourseBytes: estimateCourseBytes };")(win, new TextEncoder());
  var validate = exp.validateExport;
  // §308 course-weight estimator guards (same math the oversize guard uses).
  assets = {};
  var emptyDoc = { pages: [{ id: "p1" }] };
  ok("estimateCourseBytes ~= doc JSON bytes when no assets",
    exp.estimateCourseBytes(emptyDoc) === new TextEncoder().encode(JSON.stringify(emptyDoc)).length);
  assets = { img: "data:image/png;base64," + "A".repeat(4000) };
  ok("estimateCourseBytes counts asset payload (base64 ~0.75x)",
    exp.estimateCourseBytes({ pages: [{ id: "p1", blocks: [{ type: "image", src: "asset:img" }] }] }) >= 3000);
  assets = {};
  function has(iss, lv, sub) { return iss.some(function (i) { return i.level === lv && i.msg.indexOf(sub) !== -1; }); }
  ok("empty course -> error", has(validate({ pages: [] }), "error", "no content to export"));
  ok("blank+good mix -> 0 (clean shape)", validate({ pages: [{ id: "p1" }, { id: "p2", blocks: [{ type: "navButton", action: { goto: "p1" } }] }] }).length === 0);
  ok("duplicate page id -> error", has(validate({ pages: [{ id: "d", blocks: [{ type: "heading", text: "a" }] }, { id: "d", blocks: [{ type: "heading", text: "b" }] }] }), "error", 'Two pages share the id "d"'));
  assets = { big: "data:image/png;base64," + "A".repeat(190 * 1024 * 1024) };
  ok("oversized package -> warn", has(validate({ pages: [{ id: "p1", blocks: [{ type: "image", src: "asset:big" }] }] }), "warn", "may exceed Moodle"));
  assets = {};
  ok("small package -> no oversize warn", !has(validate({ pages: [{ id: "p1", blocks: [{ type: "heading", text: "hi" }] }] }), "warn", "may exceed Moodle"));
  // quiz completion guards (empty required fields)
  ok("quiz no correct answer -> error", has(validate({ pages: [{ id: "p1", blocks: [{ type: "quiz", questions: [{ type: "multipleChoice", options: [{ text: "a" }, { text: "b" }] }] }] }] }), "error", "no correct answer marked"));
  ok("quiz with a correct answer -> ok", !has(validate({ pages: [{ id: "p1", blocks: [{ type: "quiz", questions: [{ options: [{ text: "a", correct: true }, { text: "b" }] }] }] }] }), "error", "no correct answer marked"));
  ok("quiz no questions -> warn", has(validate({ pages: [{ id: "p1", blocks: [{ type: "quiz", questions: [] }] }] }), "warn", "no questions"));
  ok("cardSort missing categories -> warn", has(validate({ pages: [{ id: "p1", blocks: [{ type: "quiz", questions: [{ type: "cardSort", cards: [{ text: "x" }], categories: [] }] }] }] }), "warn", "missing its cards or categories"));
})();

// ---- PPP: chromeHasBlockType (drop redundant scorm-bar) --------------------
// The exported shell drops the scorm-bar's prev/next/theme when the chrome
// (header/footer) already carries a courseNav / modeToggle. Guard the detector:
// direct children AND nested (frame children / columns array-of-arrays), null-safe.
section("PPP chromeHasBlockType");
(function () {
  var t = src("src/export.js");
  var body = t.slice(t.indexOf("function chromeHasBlockType(doc, type)"), t.indexOf("// ---- runtime shell"));
  var chromeHas = new Function(body + "\nreturn chromeHasBlockType;")();
  var navDoc = { headerFooter: { footer: { children: [{ type: "courseNav" }] } } };
  ok("footer courseNav -> hasNav", chromeHas(navDoc, "courseNav") === true);
  ok("footer courseNav -> no modeToggle", chromeHas(navDoc, "modeToggle") === false);
  ok("header modeToggle detected", chromeHas({ headerFooter: { header: { children: [{ type: "modeToggle" }] } } }, "modeToggle") === true);
  ok("nested in frame children", chromeHas({ headerFooter: { footer: { children: [{ type: "frame", children: [{ type: "courseNav" }] }] } } }, "courseNav") === true);
  ok("nested in columns (array-of-arrays)", chromeHas({ headerFooter: { footer: { children: [{ type: "columns", columns: [[{ type: "text" }], [{ type: "modeToggle" }]] }] } } }, "modeToggle") === true);
  ok("no chrome -> false, null-safe", chromeHas({}, "courseNav") === false && chromeHas({ headerFooter: {} }, "courseNav") === false);
  ok("empty children -> false", chromeHas({ headerFooter: { footer: { children: [] } } }, "courseNav") === false);
})();

// ---- KKK: pre-export air-gap font warning (imported/unknown fonts too) -----
// The warning must flag ANY used font outside the embeddable set -- including a
// font an IMPORTED course carries that isn't in this session's FONT_LIST -- since
// that is the silent wrong-font-on-air-gapped-Moodle failure.
section("KKK font air-gap warning");
(function () {
  var t = src("src/export.js");
  var body = t.slice(t.indexOf("function estimateCourseBytes(doc)"), t.indexOf("window.__validateExport"));
  var win = {
    collectAssetRefs: function () { return []; },
    AssetStore: { has: function () { return true; }, get: function () { return null; } },
    FONT_LIST: ["Exo 2"], // deliberately does NOT list Inter/Helvetica -> the "imported font" case
    EMBEDDABLE_FONTS: ["Exo 2", "System", "Georgia", "Courier"]
  };
  var validate = new Function("window", "ENC", body + "\nreturn validateExport;")(win, new TextEncoder());
  function warned(doc, font) { return validate(doc).some(function (i) { return i.level === "warn" && i.msg.indexOf('Font "' + font + '"') !== -1; }); }
  ok("imported unknown font (Inter) still warns", warned({ pages: [{ id: "p", blocks: [{ type: "paragraph", text: "x", style: { font: "Inter" } }] }] }, "Inter"));
  ok("totally-unknown nested font warns (deep walk)", warned({ pages: [{ id: "p", blocks: [{ type: "frame", children: [{ type: "heading", text: "h", style: { font: "Helvetica Neue" } }] }] }] }, "Helvetica Neue"));
  ok("font in chrome/theme table warns", warned({ pages: [{ id: "p", blocks: [{ type: "heading", text: "h" }] }], headerFooter: { footer: { text: "x", style: { font: "Roboto" } } } }, "Roboto"));
  ok("Exo 2 (bundled) -> no font warn", !warned({ pages: [{ id: "p", blocks: [{ type: "heading", text: "h", style: { font: "Exo 2" } }] }] }, "Exo 2"));
  ok("System (ubiquitous) -> no font warn", !warned({ pages: [{ id: "p", blocks: [{ type: "heading", text: "h", style: { font: "System" } }] }] }, "System"));
  ok("empty font -> no warn", validate({ pages: [{ id: "p", blocks: [{ type: "heading", text: "h", style: { font: "" } }] }] }).every(function (i) { return i.msg.indexOf("is used but is not embedded") === -1; }));
})();

// ---- LLL: resolveBlockStyle (named text style = reference, overrides win) ----
section("LLL resolveBlockStyle");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("function resolveBlockStyle(obj)"), t.indexOf("window.resolveBlockStyle ="));
  var win = {};
  var resolve = new Function("window", body + "\nreturn resolveBlockStyle;")(win);
  win.__docStyles = { H1: { font: "Exo 2", size: 40, weight: "700" } };
  ok("no styleRef -> obj.style unchanged", JSON.stringify(resolve({ style: { size: 12 } })) === JSON.stringify({ size: 12 }));
  ok("styleRef -> named style", (function () { var r = resolve({ styleRef: "H1", style: {} }); return r.size === 40 && r.font === "Exo 2"; })());
  ok("override wins over named", resolve({ styleRef: "H1", style: { size: 12 } }).size === 12);
  ok("named props kept alongside override", (function () { var r = resolve({ styleRef: "H1", style: { size: 12 } }); return r.size === 12 && r.weight === "700"; })());
  ok("unknown styleRef -> falls back to obj.style", JSON.stringify(resolve({ styleRef: "NOPE", style: { size: 9 } })) === JSON.stringify({ size: 9 }));
  win.__docStyles = null;
  ok("no __docStyles -> obj.style", JSON.stringify(resolve({ styleRef: "H1", style: { size: 5 } })) === JSON.stringify({ size: 5 }));
  ok("nothing -> null", resolve({}) === null);
})();

// ---- resolveVariant: the anti-contamination mechanism (flagship, kills V002) --
// One hero doc -> N clean variant docs. Content overrides bake per-variant without
// bleeding, variantVis drops the right pages/blocks/instances, and resolving must
// NEVER mutate the base doc (else switching variants corrupts the hero = the V002
// contamination class). Pure fn, no prior test.
section("resolveVariant (variants)");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("var VARIANT_AXIS"), t.indexOf("window.getVariants"));
  var win = {};
  new Function("window", body)(win);
  var resolve = win.resolveVariant;
  function makeDoc() {
    return {
      heroVariant: "hero", variants: ["standard", "wideband"],
      pages: [
        { id: "p1", blocks: [
          { type: "heading", text: "Base heading", overrides: { wideband: { text: "Wideband heading" } } },
          { type: "note", text: "standard-only", variantVis: { only: ["standard"] } },
          { type: "note", text: "not-in-wideband", variantVis: { hide: ["wideband"] } },
          { type: "componentGrid", component: "card", instances: [
            { slots: { title: "A" }, overrides: { wideband: { slots: { title: "A-wide" } } } },
            { slots: { title: "B" }, variantVis: { only: ["wideband"] } }
          ] }
        ] },
        { id: "p2", variantVis: { only: ["wideband"] }, blocks: [{ type: "heading", text: "wb page" }] }
      ]
    };
  }
  var doc = makeDoc();
  var before = JSON.stringify(doc);
  var wb = resolve(doc, "wideband");
  var st = resolve(doc, "standard");
  function grid(p) { return p.blocks.filter(function (b) { return b.type === "componentGrid"; })[0]; }
  // content override bakes per-variant, no bleed
  ok("wideband bakes its heading override", wb.pages[0].blocks[0].text === "Wideband heading");
  ok("standard keeps base heading (no bleed)", st.pages[0].blocks[0].text === "Base heading");
  ok("wideband bakes instance slot override", grid(wb.pages[0]).instances[0].slots.title === "A-wide");
  ok("standard keeps base instance slot", grid(st.pages[0]).instances[0].slots.title === "A");
  // variantVis drops the right nodes
  ok("standard-only note dropped in wideband", !wb.pages[0].blocks.some(function (b) { return b.text === "standard-only"; }));
  ok("standard-only note kept in standard", st.pages[0].blocks.some(function (b) { return b.text === "standard-only"; }));
  ok("hide:[wideband] note dropped in wideband", !wb.pages[0].blocks.some(function (b) { return b.text === "not-in-wideband"; }));
  ok("wideband-only instance kept in wideband", grid(wb.pages[0]).instances.length === 2);
  ok("wideband-only instance dropped in standard", grid(st.pages[0]).instances.length === 1);
  ok("wideband-only page kept in wideband", wb.pages.some(function (p) { return p.id === "p2"; }));
  ok("wideband-only page dropped in standard", !st.pages.some(function (p) { return p.id === "p2"; }));
  // THE contamination guard: base doc untouched after resolving BOTH variants
  ok("base doc NOT mutated by resolve (V002 guard)", JSON.stringify(doc) === before);
  ok("base heading text still base after resolves", doc.pages[0].blocks[0].text === "Base heading");
  // hero identity: an untagged doc resolves to the SAME page refs (stays editable)
  var plain = { pages: [{ id: "x", blocks: [{ type: "heading", text: "h" }] }] };
  ok("untagged hero keeps page refs (editable)", resolve(plain).pages[0] === plain.pages[0]);
  // #148: a per-variant IMAGE version (overrides[<variant>].src) bakes the variant's own
  // image; the flagship/other variants keep the base src (no bleed) — proving editor==export.
  var imgDoc = { heroVariant: "hero", variants: ["standard", "wideband"], pages: [{ id: "pi", blocks: [
    { type: "image", src: "asset:BASE", alt: "base", overrides: { wideband: { src: "asset:WIDE" } } }
  ] }] };
  var imgBefore = JSON.stringify(imgDoc);
  ok("#148: variant with its own version swaps the image src", resolve(imgDoc, "wideband").pages[0].blocks[0].src === "asset:WIDE");
  ok("#148: variant WITHOUT a version inherits the flagship image", resolve(imgDoc, "standard").pages[0].blocks[0].src === "asset:BASE");
  ok("#148: flagship keeps the base image", resolve(imgDoc, "hero").pages[0].blocks[0].src === "asset:BASE");
  ok("#148: other fields (alt) inherit unless overridden", resolve(imgDoc, "wideband").pages[0].blocks[0].alt === "base");
  ok("#148: per-variant image resolve does NOT mutate the base doc", JSON.stringify(imgDoc) === imgBefore);
})();

// ---- #148: image variant-version authoring helpers (editor) ------------------
section("#148 per-variant image versions (authoring)");
(function () {
  var e = src("src/editor.js");
  // extract the two pure helpers and exercise the round-trip + prune.
  var s = e.slice(e.indexOf("function imgVariantSrc(block, variant)"), e.indexOf("function uploadImageVariant"));
  var api = new Function(s + "\nreturn { imgVariantSrc: imgVariantSrc, setImgVariantSrc: setImgVariantSrc };")();
  var b = { type: "image", src: "asset:BASE" };
  api.setImgVariantSrc(b, "wideband", "asset:WIDE");
  ok("set writes overrides[variant].src", b.overrides.wideband.src === "asset:WIDE");
  ok("read returns the variant's own src", api.imgVariantSrc(b, "wideband") === "asset:WIDE");
  ok("read returns null when a variant inherits", api.imgVariantSrc(b, "standard") === null);
  api.setImgVariantSrc(b, "wideband", null);
  ok("clearing prunes the empty override map entirely", !b.overrides);
  // the section only renders when the course has variants (guarded by variantNames().length)
  ok("inspector section gated on variants + rendered for images", /renderImageVariantVersions\(block\)/.test(e) && /function renderImageVariantVersions\(block\) \{\s*var names = variantNames\(\);\s*if \(!names\.length\) return;/.test(e));
  ok("upload writes via the pure asset ref channel (hoist-safe)", /setImgVariantSrc\(block, variant, assetRef\(r\.result, f\)\)/.test(e));
  // slice 2: right-click "Upload image for <variant>" (direct file picker) + on-canvas
  // version-cycle badge (author-only transient <img>.src swap, WeakMap, never doc state).
  ok("right-click offers per-variant image upload for image/hotspot blocks", /IMG_VERSION_TYPES\[target\.block\.type\] && vs\.length[\s\S]{0,240}"Upload image for "\) \+ v[\s\S]{0,120}uploadImageVariant\(target\.block, v/.test(e));
  ok("on-canvas version-cycle badge decorates image blocks with versions", /function decorateVariantVersionBadges\(scope\)[\s\S]*?hasImageVersions\(block\)[\s\S]*?"variant-cycle"/.test(e));
  ok("cycle preview is author-only + never mutates the doc (WeakMap base-el swap)", /var imgVersionPreview = new WeakMap\(\);/.test(e) && /function applyImageVersionPreview\(node, block\)[\s\S]*?imgVariantSrc\(block, v\) \|\| baseImgSrc\(block\)[\s\S]*?replaceChild\(next, cur\)/.test(e)); // #215: hotspot base = entry.visual via baseImgSrc
  // #148 cleanup: an inline-SVG base (image OR hotspot) must swap too, not just a raster
  // <img> — the badge selector spans both tags, and an SVG version re-inlines with the
  // flagship mono/colorMap (mirrors resolveVariant overriding only src).
  ok("version badge swaps BOTH raster + inline-SVG bases (image/hotspot)", /node\.querySelector\("img\.block-image__img, img\.hotspot-image, svg\.block-image__img, svg\.hotspot-image"\)/.test(e));
  ok("SVG version re-inlines with flagship mono/colorMap via inlineSvg", /window\.inlineSvg\(\{ src: dataUrl, mono: block\.mono, colorMap: block\.colorMap \}\)/.test(e));
  ok("cycle back to Flagship restores the stashed original base element", /node\.__imgVerBase = \{ el: cur\.cloneNode\(true\)[\s\S]*?if \(!v\) \{ cur\.parentNode && cur\.parentNode\.replaceChild\(node\.__imgVerBase\.el\.cloneNode\(true\), cur\)/.test(e));
  ok("badge skipped while previewing a variant\\/language (canvas read-only)", /function decorateVariantVersionBadges\(scope\) \{\s*if \(isPreview\(\)\) return;/.test(e));
  ok("badge wired into mount (whole canvas)", (e.match(/decorateVariantVersionBadges\(\);/g) || []).length >= 2);
  // slice 3: the SAME mechanism generalises to the hotspot base image (block.src) —
  // one type gate (IMG_VERSION_TYPES = image + hotspot) drives all three UI surfaces.
  ok("slice 3: image + hotspot both carry per-variant base-image versions", /var IMG_VERSION_TYPES = \{ image: 1, hotspot: 1 \};/.test(e));
  ok("slice 3: hotspot inspector renders the variant-versions section", /#148 slice 3[\s\S]{0,460}if \(isEntryScreen && entry\.visual\) renderImageVariantVersions\(block\);/.test(e)); // #215/#216: base = entry.visual, entry screen only
  ok("slice 3: canvas cycle swaps the hotspot base image too (.hotspot-image)", /versionBaseEl[\s\S]*?querySelector\("img\.block-image__img, img\.hotspot-image/.test(e));
})();

// ---- #145: text-role auto-styling (type -> named style) --------------------
// The predictable CSV-import pattern (heading->Heading 1, paragraph->Body 1, ...)
// auto-linked so styleRef is set for the author. Pure core extracted + exercised:
// resolve a role only when the style exists; stamp UNSTYLED text blocks (deep) only.
section("#145 text-role auto-styling");
(function () {
  var e = src("src/editor.js");
  var slice = e.slice(e.indexOf("function getTextRoles()"), e.indexOf("// Multi-selection (>=2) batch inspector"));
  var doc = { textRoles: { heading: "Heading 1", paragraph: "Body 1", note: "Warnings" }, styles: { "Heading 1": {}, "Body 1": {} }, pages: [] };
  var win = { TEXT_ROLES: { heading: "Heading 1" } };
  var api = new Function("doc", "clone", "getTextStyles", "TEXT_STYLE_TYPES", "applyStyleToBlock", "window",
    slice + "\nreturn { roleStyleFor: roleStyleFor, isUnstyledText: isUnstyledText, stampRoleStyle: stampRoleStyle, applyTextRolesByType: applyTextRolesByType };")(
    doc,
    function (o) { return JSON.parse(JSON.stringify(o)); },
    function () { return doc.styles; },
    { heading: 1, subheading: 1, paragraph: 1, quote: 1, list: 1, note: 1 },
    function (b, name) { b.styleRef = name; b.style = {}; },
    win);
  // roleStyleFor: resolves only when the mapped style EXISTS in the doc's store
  ok("roleStyleFor maps a type to its existing style", api.roleStyleFor("heading") === "Heading 1");
  ok("roleStyleFor skips a dangling role (style missing)", api.roleStyleFor("note") === null); // "Warnings" not in styles
  ok("roleStyleFor null for an unmapped type", api.roleStyleFor("subheading") === null);
  // isUnstyledText: text + no resolvable styleRef
  ok("unstyled text block detected", api.isUnstyledText({ type: "paragraph", text: "x" }) === true);
  ok("styled text block not flagged", api.isUnstyledText({ type: "paragraph", styleRef: "Body 1" }) === false);
  ok("dangling styleRef counts as unstyled", api.isUnstyledText({ type: "paragraph", styleRef: "Ghost" }) === true);
  ok("non-text block never flagged", api.isUnstyledText({ type: "image", src: "x" }) === false);
  // applyTextRolesByType: deep, unstyled-only, skips unresolvable roles
  doc.pages = [{ blocks: [
    { type: "heading", text: "H" },                                  // -> Heading 1
    { type: "paragraph", text: "P", styleRef: "Body 1" },            // already styled -> untouched
    { type: "note", text: "N" },                                     // role dangling -> stays unstyled
    { type: "subheading", text: "S" },                              // unmapped -> stays unstyled
    { type: "columns", columns: [[ { type: "paragraph", text: "C" } ]] }, // nested -> Body 1
    { type: "hotspot", entry: "scr-entry", screens: [ { id: "scr-entry", markers: [ { id: "hs_a", action: "card", blocks: [ { type: "heading", text: "HH" } ] } ] } ] } // nested card -> Heading 1 (#215 shape)
  ] }];
  var n = api.applyTextRolesByType();
  var B = doc.pages[0].blocks;
  ok("applyTextRolesByType stamps only resolvable unstyled blocks", n === 3);
  ok("top-level heading linked to its role", B[0].styleRef === "Heading 1");
  ok("already-styled paragraph is preserved", B[1].styleRef === "Body 1");
  ok("dangling-role note left unstyled", !B[2].styleRef);
  ok("unmapped subheading left unstyled", !B[3].styleRef);
  ok("nested column paragraph linked", B[4].columns[0][0].styleRef === "Body 1");
  ok("nested hotspot-card heading linked", B[5].screens[0].markers[0].blocks[0].styleRef === "Heading 1");
  ok("re-running stamps nothing new (idempotent)", api.applyTextRolesByType() === 0);

  // Wiring (source guards): auto-stamp on drop, auto-apply on import, rename repoints the
  // role map, exposed API, audit toggle + decorator, render() untouched.
  ok("insertBlock auto-stamps a dropped block's role style", /stampRoleStyle\(block\); \/\/ #145/.test(e));
  ok("schema import auto-applies roles after setDoc", /window\.Editor\.applyTextRolesByType\(\);/.test(src("src/schema.js")));
  ok("renameTextStyle repoints the role map", /doc\.textRoles\[t\] === oldName\) doc\.textRoles\[t\] = newName/.test(e));
  ok("Editor exposes applyTextRolesByType", /applyTextRolesByType: function \(\)/.test(e));
  ok("audit decorator wired into mount + per-page", (e.match(/decorateStyleAudit\(/g) || []).length >= 3);
  ok("audit marks unstyled canvas blocks red (editor-only class)", /node\.classList\.add\("is-unstyled-audit"\)/.test(e) && /\.canvas-block\.is-unstyled-audit/.test(src("editor.css")));
  ok("render.js has NO styleRole leak (pure render unchanged)", !/textRoles|roleStyleFor|is-unstyled-audit/.test(src("src/render.js")));
})();

// ---- #152: image/GIF blend mode (mix-blend-mode) ---------------------------
// block.blendMode -> --img-blend on the figure (render.js, pure) -> mix-blend-mode
// on .block-image__img (course.css). Unset/normal = no blend. Editor writes/prunes
// block.blendMode. Data on the block, so it round-trips through export unchanged.
section("#152 image blend mode");
(function () {
  var r = src("src/render.js");
  var c = src("src/course.css");
  var e = src("src/editor.js");
  // render is PURE: reads block.blendMode, sets the --img-blend var on the figure,
  // and skips it when unset or "normal" (so the default stays untouched).
  ok("render sets --img-blend from block.blendMode", /block\.blendMode && block\.blendMode !== "normal"\) fig\.style\.setProperty\("--img-blend", block\.blendMode\)/.test(r));
  // the var reaches BOTH <img> and inlined <svg> via the shared .block-image__img class.
  ok("course.css applies mix-blend-mode from the var (default normal = no blend)", /\.block-image__img \{[^}]*mix-blend-mode: var\(--img-blend, normal\)/.test(c));
  // inspector exposes a Blend dropdown that writes block.blendMode (Normal prunes it).
  ok("editor exposes a Blend select in the image inspector", /blendSel = dsSelect\(/.test(e) && /\["Lighten", "lighten"\], \["Screen", "screen"\]/.test(e));
  ok("Blend Normal prunes block.blendMode; else writes it (round-trips as data)", /if \(v === "normal"\) delete block\.blendMode; else block\.blendMode = v/.test(e));
  // behavioural guard: replicate the exact render predicate against a setProperty spy.
  function blendVar(block) {
    var props = {}; var fig = { style: { setProperty: function (k, v) { props[k] = v; } } };
    if (block.blendMode && block.blendMode !== "normal") fig.style.setProperty("--img-blend", block.blendMode);
    return props["--img-blend"];
  }
  ok("blendMode=lighten -> --img-blend:lighten", blendVar({ blendMode: "lighten" }) === "lighten");
  ok("unset blendMode -> no --img-blend (no blend)", blendVar({}) === undefined);
  ok("blendMode=normal -> no --img-blend (treated as default)", blendVar({ blendMode: "normal" }) === undefined);

  // #178a: blend was SILENTLY DEFEATED for images inside cards — the card content wrapper
  // had `z-index:1` which made it a stacking context, trapping the child's mix-blend-mode
  // against a transparent group backdrop. The fix drops the z-index (position:relative alone
  // is NOT a stacking context) so the image composites against the card surface.
  function cssRule(sel) { var i = c.indexOf(sel + " {"); return i < 0 ? "" : c.slice(i, c.indexOf("}", i)).replace(/\/\*[\s\S]*?\*\//g, ""); } // strip comments (they may mention z-index)
  var cdRule = cssRule(".card-deck__content"), crRule = cssRule(".card-reveal__content");
  ok("card-deck content wrapper is NOT a stacking context (no z-index)", /position: relative/.test(cdRule) && !/z-index/.test(cdRule));
  ok("card-reveal content wrapper is NOT a stacking context (no z-index)", /position: relative/.test(crRule) && !/z-index/.test(crRule));

  // #178b: hotspot BASE image gains the same blend — render sets --img-blend on the frame,
  // .hotspot-image reads it, and the inspector exposes the same canonical Blend select.
  ok("hotspot render sets --img-blend on the frame from block.blendMode", /block\.blendMode && block\.blendMode !== "normal"\) frame\.style\.setProperty\("--img-blend", block\.blendMode\)/.test(r));
  ok("course.css applies mix-blend-mode to .hotspot-image", /\.hotspot-image \{[^}]*mix-blend-mode: var\(--img-blend, normal\)/.test(c));
  ok("hotspot inspector exposes the canonical Blend select writing block.blendMode", /hsBlend = dsSelect\(/.test(e) && /hsBlend\.title = "Blend the base image/.test(e));
})();

// ---- SCORM manifest (imsmanifest.xml — Moodle's first gate) ----------------
// A malformed manifest = the whole package rejected; a mismatch between the
// resource identifier and the item identifierref = Moodle can't launch the SCO.
section("SCORM manifest");
(function () {
  var t = src("src/export.js");
  var escapeXml = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  var body = t.slice(t.indexOf("function manifest(doc, fileNames)"), t.indexOf("function collectInteractionSrcs"));
  var manifest = new Function("escapeXml", body + "\nreturn manifest;")(escapeXml);
  var xml = manifest({ meta: { code: "DEMO-WSE-101", title: "Demo & <Ops>" } }, ["index.html", "course.css", "fonts/Exo2-Regular.ttf"]);
  ok("identifier sanitised (hyphens -> _)", xml.indexOf('identifier="DEMO_WSE_101"') !== -1);
  ok("title XML-escaped", xml.indexOf("Demo &amp; &lt;Ops&gt;") !== -1);
  ok("SCORM 1.2 schema markers", /<schema>ADL SCORM<\/schema>/.test(xml) && /<schemaversion>1\.2/.test(xml));
  ok('launches index.html as a sco', xml.indexOf('href="index.html"') !== -1 && xml.indexOf('adlcp:scormtype="sco"') !== -1);
  ok("org default matches org identifier", xml.indexOf('default="DEMO_WSE_101_ORG"') !== -1 && xml.indexOf('<organization identifier="DEMO_WSE_101_ORG"') !== -1);
  ok("item identifierref matches resource identifier", xml.indexOf('identifierref="DEMO_WSE_101_RES"') !== -1 && xml.indexOf('<resource identifier="DEMO_WSE_101_RES"') !== -1);
  ok("every packaged file listed", xml.indexOf('<file href="fonts/Exo2-Regular.ttf"/>') !== -1 && xml.indexOf('<file href="course.css"/>') !== -1);
  ok("missing meta -> Course fallback id", manifest({}, []).indexOf('identifier="Course"') !== -1);
})();

// ---- resolveHeaderFooter: per-page chrome (drives whether footer nav shows) --
section("resolveHeaderFooter");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("window.resolveHeaderFooter = function (doc, page)"), t.indexOf("window.render = function (doc, theme)"));
  var win = {};
  new Function("window", body)(win);
  var resolve = win.resolveHeaderFooter;
  var doc = { headerFooter: { header: { on: true, title: "H" }, footer: { on: true, text: "F" } } };
  ok("both on, page hides neither -> both", (function () { var r = resolve(doc, {}); return r.header && r.footer; })());
  ok("header.on false -> header null", resolve({ headerFooter: { header: { on: false }, footer: { on: true } } }, {}).header === null);
  ok("page.hideHeader -> header null, footer kept", (function () { var r = resolve(doc, { hideHeader: true }); return r.header === null && !!r.footer; })());
  ok("page.hideFooter -> footer null (loses nav), header kept", (function () { var r = resolve(doc, { hideFooter: true }); return r.footer === null && !!r.header; })());
  ok("no headerFooter -> both null", (function () { var r = resolve({}, {}); return r.header === null && r.footer === null; })());
})();

// ---- cardReveal render: reference-aligned block (auto-index, cards, cardBox) --
// Guards the "Assessment Tiles" rebuild: N cards render (esp. the 4-card case that
// used to break), auto-numbered 2-digit index, cover/index opt-outs, per-card
// appearance (block.cardBox) applied to EACH card, and the cols knob -> CSS var.
section("cardReveal render");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("cardReveal: function (block) {"), t.indexOf("accordion: function (block) {"));
  function mknode(tag, cls, text) {
    return { tag: tag, cls: cls || "", text: text, kids: [], attrs: {},
      style: { _p: {}, setProperty: function (k, v) { this._p[k] = v; } },
      classList: { add: function () {} },
      setAttribute: function (k, v) { this.attrs[k] = v; },
      appendChild: function (c) { this.kids.push(c); return c; } };
  }
  var el = function (tag, cls, text) { return mknode(tag, cls, text); };
  var renderBlock = function (child) { return mknode("div", "child-" + (child.type || "")); };
  var applyBlockAppearance = function (node, blk) {
    var b = blk && blk.box; if (!b) return;
    if (b.fill) node.style.background = b.fill;
    if (b.radius != null && b.radius !== "") node.style._p.radius = b.radius;
  };
  var cardReveal = new Function("el", "renderBlock", "applyBlockAppearance",
    "var BLOCKS={" + body + "dummy:0}; return BLOCKS.cardReveal;")(el, renderBlock, applyBlockAppearance);
  function cards(root) { return root.kids.filter(function (k) { return k.cls === "card-reveal__card"; }); }
  function kid(card, cls) { return card.kids.filter(function (k) { return k.cls === cls; })[0]; }
  var four = { cols: 4, gap: 24, items: [1, 2, 3, 4].map(function () { return { children: [{ type: "heading" }] }; }) };
  var r4 = cardReveal(four);
  ok("4 items -> 4 cards render (the old crash case)", cards(r4).length === 4);
  ok("cols knob -> --cr-cols var", r4.style._p["--cr-cols"] === 4);
  ok("auto index is 2-digit, per position", kid(cards(r4)[0], "card-reveal__index").text === "01" && kid(cards(r4)[3], "card-reveal__index").text === "04");
  ok("cover present by default", !!kid(cards(r4)[0], "card-reveal__cover"));
  ok("noCover -> no cover", !kid(cards(cardReveal({ items: [{ children: [] }], noCover: true }))[0], "card-reveal__cover"));
  ok("noIndex -> no index", !kid(cards(cardReveal({ items: [{ children: [] }], noIndex: true }))[0], "card-reveal__index"));
  ok("empty card -> placeholder", !!kid(cards(cardReveal({ items: [{ children: [] }] }))[0], "card-reveal__content"));
  var boxed = cardReveal({ items: [{ children: [] }, { children: [] }], cardBox: { fillDark: "#123456", fillLight: "#eeeeee" } });
  ok("cardBox per-mode fill -> grid --cr-fill-* vars (so it switches), NOT a fixed per-card background", boxed.style._p["--cr-fill-dark"] === "#123456" && boxed.style._p["--cr-fill-light"] === "#eeeeee" && cards(boxed)[0].style.background === undefined);
  ok("no items -> empty grid message", cardReveal({ items: [] }).kids.filter(function (k) { return k.cls === "card-reveal__empty"; }).length === 1);
  // ---- flip: BOTH faces authorable (item.front = Side 1, item.children = Side 2) ----
  var fBlock = { type: "heading", text: "Front heading" };
  var flip = cardReveal({ revealStyle: "flip", items: [{ front: [fBlock], children: [{ type: "paragraph" }] }] });
  var fCover = kid(cards(flip)[0], "card-reveal__cover");
  var fFront = fCover.kids.filter(function (k) { return k.cls === "card-reveal__front"; })[0];
  ok("flip + item.front -> front face renders authored blocks (no hint label)", !!fFront && fFront.kids.length === 1 && fCover.kids.filter(function (k) { return k.cls === "card-reveal__hint"; }).length === 0);
  ok("front child carries the __block back-ref (editable on canvas)", fFront.kids[0].__block === fBlock);
  var flipLegacy = cardReveal({ revealStyle: "flip", hint: "Turn", items: [{ children: [] }] });
  var lCover = kid(cards(flipLegacy)[0], "card-reveal__cover");
  ok("flip WITHOUT front falls back to the hint label (legacy docs unchanged)", lCover.kids.filter(function (k) { return k.cls === "card-reveal__hint"; })[0].text === "Turn");
  var flipEmpty = cardReveal({ revealStyle: "flip", items: [{ front: [], children: [] }] });
  var eFront = kid(cards(flipEmpty)[0], "card-reveal__cover").kids[0];
  ok("empty front array -> placeholder (face stays a drop/author target)", eFront.kids.filter(function (k) { return k.cls === "card-reveal__card-empty"; }).length === 1);
  var revealFront = cardReveal({ items: [{ front: [{ type: "heading" }], children: [] }] });
  ok("reveal mode ignores item.front (cover keeps the hint)", kid(cards(revealFront)[0], "card-reveal__cover").kids.filter(function (k) { return k.cls === "card-reveal__hint"; }).length === 1);
})();

// ---- columns per-column width (colWidths -> flex ratios; equal fallback) ----
// The pure render invariant: block.colWidths maps 1:1 to each layout-column's
// flex-grow. Absent or short -> that column falls back to "1" (equal split), so a
// doc with no colWidths renders exactly as before. Drag handles are editor chrome
// only; this guards the data->render half that ALSO drives the SCORM export.
section("columns colWidths render");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("columns: function (block) {"), t.indexOf("navButton: function (block) {"));
  function mknode(tag, cls, text) {
    return { tag: tag, cls: cls || "", text: text, kids: [], attrs: {},
      style: { _p: {}, setProperty: function (k, v) { this._p[k] = v; } },
      classList: { add: function () {} },
      setAttribute: function (k, v) { this.attrs[k] = v; },
      appendChild: function (c) { this.kids.push(c); return c; } };
  }
  var el = function (tag, cls, text) { return mknode(tag, cls, text); };
  var renderBlock = function (child) { return mknode("div", "child-" + (child.type || "")); };
  var columns = new Function("el", "renderBlock",
    "var BLOCKS={" + body + "dummy:0}; return BLOCKS.columns;")(el, renderBlock);
  function colsOf(root) { return root.kids.filter(function (k) { return k.cls === "layout-column"; }); }
  var three = [[{ type: "text" }], [{ type: "text" }], [{ type: "text" }]];
  var eq = colsOf(columns({ columns: three }));
  ok("no colWidths -> every column flex '1' (equal, zero regression)", eq.length === 3 && eq.every(function (c) { return c.style.flex === "1"; }));
  var custom = colsOf(columns({ columns: three, colWidths: [2, 1, 1] }));
  ok("colWidths -> flex ratios applied per column", custom[0].style.flex === "2" && custom[1].style.flex === "1" && custom[2].style.flex === "1");
  var frac = colsOf(columns({ columns: three, colWidths: [320, 180, 100] }));
  ok("pixel-derived ratios pass through as flex strings", frac[0].style.flex === "320" && frac[2].style.flex === "100");
  var short = colsOf(columns({ columns: three, colWidths: [3] }));
  ok("short colWidths -> missing indices fall back to '1'", short[0].style.flex === "3" && short[1].style.flex === "1" && short[2].style.flex === "1");
})();

// ---- columns colWidths self-heal + resize-handle chrome ----------------------
section("columns colWidths guards");
(function () {
  var e = src("src/editor.js");
  ok("cleanup drops colWidths on column-count mismatch", /b\.colWidths && b\.colWidths\.length !== b\.columns\.length\) delete b\.colWidths/.test(e));
  ok("adding a column reverts to equal (delete colWidths)", (e.match(/delete destLoc\.ownerBlock\.colWidths/g) || []).length === 2);
  ok("resize drag redistributes only the adjacent pair (total held)", /var nj = drag\.total - ni/.test(e) && /COL_MIN_PX/.test(e));
  ok("resize handle attached in the columns decorate branch", /attachColumnResizers\(node, block\)/.test(e));
  var css = src("editor.css");
  ok("col-resize handle uses col-resize cursor", /\.col-resize-handle\s*\{[^}]*cursor:\s*col-resize/.test(css));
  ok("handle line uses the accent token + hover reveal", /\.col-resize-handle__line\s*\{[^}]*var\(--accent\)/.test(css) && /:hover \.col-resize-handle__line/.test(css));
  ok("handles yield to edge bands while a block is dragged", /body\.is-dragging-block \.col-resize-handle\s*\{\s*pointer-events:\s*none/.test(css));
})();

// ---- Enter commits + blurs a single-line inspector field (not textarea) --------
section("inspector Enter-to-blur");
(function () {
  var e = src("src/editor.js");
  ok("Enter branch blurs INPUT/SELECT + preventDefault", /if \(e\.key === "Enter" && !e\.altKey && !e\.metaKey && !e\.ctrlKey\)[\s\S]{0,220}\/\^\(INPUT\|SELECT\)\$\/\.test\(et\.tagName\)\) \{ e\.preventDefault\(\); et\.blur\(\); \}/.test(e));
  ok("Enter branch excludes TEXTAREA (newline preserved)", /Enter = newline[\s\S]{0,400}\/\^\(INPUT\|SELECT\)\$\//.test(e));
  ok("Tab behaviour still intact after the Enter branch", /if \(e\.key !== "Tab" \|\| e\.altKey \|\| e\.metaKey \|\| e\.ctrlKey\) return;/.test(e));
})();

// ---- project auto-backup (P0 data-safety) -------------
section("project auto-backup");
(function () {
  var e = src("src/editor.js");
  ok("backup .json is SELF-CONTAINED (assets baked via resolveMedia)", /function selfContainedDocText\(\)[\s\S]{0,300}window\.resolveMedia\(frozen[\s\S]{0,300}return JSON\.stringify\(frozen/.test(e));
  ok("backupFilesFor composes live json + schema csv (skip-unchanged) + snapshot", /function backupFilesFor[\s\S]{0,400}slug \+ "\.json"[\s\S]{0,160}__schemaCsv[\s\S]{0,200}slug \+ "-backup-" \+ backupTs\(\)/.test(e) && /jsonText === backupLastText/.test(e));
  ok("two transports: native app bridge (WKWebView) + browser FSA", /function nativeBackupBridge\(\)[\s\S]{0,120}messageHandlers\.versoBackup/.test(e) && /function backupMode\(\) \{ if \(nativeBackupBridge\(\)\) return "native"; if \(window\.showDirectoryPicker\) return "fsa"/.test(e));
  ok("native write goes through the bridge (web side)", /nativeBackupCall\("write", \{ folder: doc\.backup\.folderPath, files: b\.files \}\)/.test(e) && /nativeBackupCall\("pickFolder"\)/.test(e));
  ok("Swift shell registers + handles the versoBackup bridge", (function () { var s = src("desktop/AuthoringTool.swift"); return /userContentController\.add\(self, name: "versoBackup"\)/.test(s) && /message\.name == "versoBackup" \{ handleBackup/.test(s) && /func handleBackup/.test(s) && /NSOpenPanel\(\)[\s\S]{0,300}canChooseDirectories = true/.test(s) && /__versoBackupReply/.test(s); })());
  ok("auto-backup hooked into the save choke point", /if \(res\.ok\) \{ setSaveState\("saved"\);[\s\S]{0,60}scheduleBackup\(\)/.test(e));
  ok("folder reconnects on boot + doc switch", /window\.addEventListener\("load", function \(\) \{ initReviewAutoIngest\(\); connectBackupFolder\(\)/.test(e) && /connectBackupFolder\(\); \/\/ re-point auto-backup/.test(e));
  ok("handle persisted per-doc in IndexedDB (verso-backup)", /indexedDB\.open\("verso-backup", 1\)/.test(e) && /saveBackupHandle\(activeDocId, h\)/.test(e));
  ok("LOUD banner covers both states (reconnect if bound, choose folder if not)", /function showBackupBanner/.test(e) && /Backup OFF — this course is NOT being saved/.test(e) && /No backup folder — this course is NOT being saved anywhere/.test(e) && /\? "Reconnect folder" : "Choose folder"/.test(e));
  ok("Slice 2: new docs require a backup folder + auto-prompt the picker", /backupRequired: true/.test(e) && /createBlankDoc\(title, code\);\s*modal\.remove\(\);[\s\S]{0,400}bindProjectFolder\(\);/.test(e) && /showBackupBanner\(!!\(doc && doc\.backupRequired\)\)/.test(e));
  ok("Backup section registered at the top of Project settings", /\{ key: "backup", title: "Backup", build: buildBackupBody \}/.test(e));
  ok("schema CSV has a pure text builder for reuse", /window\.__schemaCsv = schemaCsvText/.test(src("src/schema.js")));
  ok("backup-off banner styled (loud, [hidden]-toggled)", /#backup-off-banner\s*\{[\s\S]{0,320}position: fixed/.test(src("editor.css")) && /#backup-off-banner\[hidden\] \{ display: none; \}/.test(src("editor.css")));
})();

// ---- desktop image file-drop onto an image block ------------------------------
section("image file drop");
(function () {
  var e = src("src/editor.js");
  ok("image blocks get attachImageFileDrop in the decoration loop", /block\.type === "image"\) attachImageFileDrop\(node, block\)/.test(e));
  ok("only EXTERNAL file drags (no dragPayload) + Files present", /function externalImageDrag[\s\S]{0,220}if \(dragPayload\) return false;[\s\S]{0,220}indexOf\.call\(dt\.types \|\| \[\], "Files"\)/.test(e));
  ok("drop accepts image/* files only", /!f \|\| !\/\^image\\\/\/\.test\(f\.type\)/.test(e));
  ok("drop reuses the assetRef upload path", /block\.src = assetRef\(r\.result, f\); reapplyStructural\(findPageOfBlock\(block\)\); reselectBlockNode\(block, "block"\)/.test(e));
  ok("drop guarded against internal moves (dragPayload)", /node\.addEventListener\("drop", function \(e\) \{\s*if \(dragPayload\) return;/.test(e));
  ok("file-drop highlight styled", /\.canvas-block\.is-file-drop\s*\{[^}]*dashed var\(--(?:ui-)?accent\)/.test(src("editor.css")));
})();

// ---- learner keyboard scroll: Arrow / Page keys scroll the current page --------
section("learner keyboard scroll");
(function () {
  var rt = src("src/runtime.js");
  ok("bindKeyboardScroll wired into create() after the scroll gate", /bindKeyboardScroll\(root, nav\)/.test(rt));
  ok("maps ArrowDown/Up + PageDown/Up to a scroll delta", /e\.key === "ArrowDown"[\s\S]{0,120}e\.key === "ArrowUp"[\s\S]{0,120}e\.key === "PageDown"[\s\S]{0,120}e\.key === "PageUp"/.test(rt));
  ok("scrolls the CURRENT page's real overflow owner (scrollerFor walk)", /function curScroller\(\)[\s\S]{0,420}scrollerFor\(box\)/.test(rt));
  ok("guarded against fields / quiz / open modals + modifier keys", /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;[\s\S]{0,80}if \(blocked\(e\.target\)\) return;/.test(rt) && /INPUT\|TEXTAREA\|SELECT/.test(rt) && /\.quiz, \.kc/.test(rt) && /glossary-pop:not\(\[hidden\]\), \.image-lightbox:not\(\[hidden\]\), \.hotspot-popover:not\(\[hidden\]\)/.test(rt));
  ok("preventDefault + scrollBy on the owner", /e\.preventDefault\(\);\s*if \(sc\.scrollBy\) sc\.scrollBy\(0, dy\)/.test(rt));
})();

// ---- glossary mono: full-canvas background detection (svgBgFill) --------------
// The mono recolour forces neutrals -> ink and the FULL-CANVAS BACKGROUND -> bg.
// The bug (reopened): svgBgFill only found a `<rect>` sized in px against the viewBox,
// so a `width="100%"` rect on a viewBox-less svg, or a background drawn as a path /
// polygon, went undetected -> the neutral bg fell through to the ink token = INVERTED
// vs the theme in dark mode. This guards that all those shapes now resolve as the bg.
section("glossary mono svgBgFill");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("function svgBgFill(svg) {"), t.indexOf("function svgBgLum"));
  // stub normColor: reject falsy/"none", else lowercase-trim (enough for hex fixtures)
  var svgBgFill = new Function("normColor", body + "\nreturn svgBgFill;")(function (c) {
    if (!c) return null; c = String(c).trim().toLowerCase(); return c === "none" ? null : c;
  });
  function mkEl(tag, attrs) { return { tag: tag, getAttribute: function (k) { return attrs[k] == null ? null : attrs[k]; } }; }
  function mkSvg(attrs, shapes) {
    var els = shapes.map(function (s) { return mkEl(s.tag, s); });
    return {
      getAttribute: function (k) { return attrs[k] == null ? null : attrs[k]; },
      querySelectorAll: function (sel) {
        var tags = sel.split(",").map(function (s) { return s.trim(); });
        return els.filter(function (e) { return tags.indexOf(e.tag) !== -1; });
      }
    };
  }
  // A: well-formed rect + viewBox (already worked) -> bg is the white rect
  ok("rect + viewBox -> bg detected", svgBgFill(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "rect", width: "200", height: "120", fill: "#ffffff" }, { tag: "rect", x: "20", y: "20", width: "60", height: "8", fill: "#111" }])) === "#ffffff");
  // B: width/height="100%" with NO viewBox (was undetected -> inverted) -> now bg
  ok("100% rect, no viewBox -> bg detected (was the bug)", svgBgFill(mkSvg({ width: "200", height: "120" }, [
    { tag: "rect", width: "100%", height: "100%", fill: "#ffffff" }, { tag: "rect", x: "20", y: "20", width: "60", height: "8", fill: "#111" }])) === "#ffffff");
  // C: background as a path (was undetected) -> now bg
  ok("path background -> bg detected", svgBgFill(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "path", d: "M0 0h200v120H0z", fill: "#ffffff" }, { tag: "rect", x: "20", y: "20", width: "60", height: "8", fill: "#111" }])) === "#ffffff");
  // E: background as a polygon -> now bg
  ok("polygon background -> bg detected", svgBgFill(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "polygon", points: "0,0 200,0 200,120 0,120", fill: "#fafafa" }, { tag: "rect", x: "20", y: "20", width: "60", height: "8", fill: "#111" }])) === "#fafafa");
  // No false positives: a centred content shape is NOT a background (origin + area guards)
  ok("small centred rect -> NO bg invented", svgBgFill(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "rect", x: "70", y: "50", width: "60", height: "20", fill: "#111" }])) === null);
  ok("no bg shapes (only a circle) -> null", svgBgFill(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "circle", fill: "#111" }])) === null);
})();

// ---- glossary mono: geometric full-canvas bg ELEMENT detection (fullCanvasBgEls) --
// The reopened bug kept recurring because colour/attribute matching missed real assets
// (bg sized via style, transformed, nested). The fix detects the background ELEMENT
// geometrically (getBBox in the browser) and paints it with the bg token directly. In
// the browser getBBox does the heavy lifting; this guards the attribute FALLBACK used
// when getBBox is unavailable (headless), and the origin/coverage guards.
section("glossary mono fullCanvasBgEls (fallback)");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("function fullCanvasBgEls(svg) {"), t.indexOf("// Memoised SVG-inline cache"));
  var fullCanvasBgEls = new Function("normColor", body + "\nreturn fullCanvasBgEls;")(function (c) {
    if (!c) return null; c = String(c).trim().toLowerCase(); return c === "none" ? null : c;
  });
  function mkEl(tag, attrs) { return { tagName: tag, getAttribute: function (k) { return attrs[k] == null ? null : attrs[k]; } }; }
  function mkSvg(attrs, shapes) {
    var els = shapes.map(function (s) { return mkEl(s.tag, s); });
    return {
      isConnected: true, // skip the offscreen-attach branch in the headless mock
      getAttribute: function (k) { return attrs[k] == null ? null : attrs[k]; },
      querySelectorAll: function (sel) { var tags = sel.split(",").map(function (s) { return s.trim(); }); return els.filter(function (e) { return tags.indexOf(e.tagName) !== -1; }); }
    };
  }
  function tagList(list) { return list.map(function (e) { return e.tagName; }).join(","); }
  // full-canvas rect via attributes -> detected as the (only) bg element
  ok("attr rect bg -> detected", tagList(fullCanvasBgEls(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "rect", width: "200", height: "120", fill: "#161616" }, { tag: "rect", x: "20", y: "20", width: "60", height: "8", fill: "#eee" }]))) === "rect");
  // path background -> detected via coordinate bbox
  ok("path bg -> detected", fullCanvasBgEls(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "path", d: "M0 0h200v120H0z", fill: "#161616" }])).length === 1);
  // content-only (no full-canvas shape) -> none painted
  ok("content-only -> no bg element", fullCanvasBgEls(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "rect", x: "20", y: "20", width: "60", height: "8", fill: "#111" }])).length === 0);
  // large but OFFSET from origin -> not a background (a centred graphic)
  ok("offset large rect -> not bg (origin guard)", fullCanvasBgEls(mkSvg({ viewBox: "0 0 200 120" }, [
    { tag: "rect", x: "80", y: "60", width: "180", height: "100", fill: "#111" }])).length === 0);
})();

// ---- inlineSvg memoisation (#150): decode/build once per asset, serve clones --------
// Big inline SVGs were re-parsed + re-recoloured on EVERY render/reapplyPage. The memo
// decodes+detects each asset once, builds one recoloured template per (mono,colorMap)
// variant, and returns cloneNode(true) of it. Guard: the expensive decode runs once per
// asset src, buildInlineSvg runs once per variant, and repeat calls only clone.
section("inlineSvg memoisation (#150)");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("var _svgMemo = new Map();"), t.indexOf("window.inlineSvg = inlineSvg;"));
  var parses = 0, builds = 0, clones = 0;
  var win = {};
  var mk = new Function("assetSrc", "decodeSvgDataUrl", "detectSvgColors", "buildInlineSvg", "window",
    body + "\nreturn { inlineSvg: inlineSvg, colorCount: window.__svgColorCount };");
  var api = mk(
    function (v) { return v; },                                   // block.src is already the data: URL
    function (s) { parses++; return "markup:" + s; },             // decode (the expensive parse proxy)
    function (m) { return ["#111111", "#eeeeee"]; },              // detect -> 2 colours
    function (block, markup, colors) { builds++; var id = builds; return { id: id, cloneNode: function () { clones++; return { clonedFrom: id }; } }; },
    win);
  var A = { src: "data:image/svg+xml;base64,AAAA" };
  var A2 = { src: "data:image/svg+xml;base64,AAAA", mono: true };  // same asset, different variant
  var B = { src: "data:image/svg+xml;base64,BBBB" };
  var r1 = api.inlineSvg(A), r2 = api.inlineSvg(A), r3 = api.inlineSvg(A);
  ok("decode runs once per asset across repeat inlineSvg calls", parses === 1);
  ok("template built once per variant", builds === 1);
  ok("every call returns a fresh clone (not the shared template)", clones === 3 && r1.clonedFrom === 1 && r3.clonedFrom === 1 && r1 !== r2);
  ok("__svgColorCount reads the memo without another decode", api.colorCount(A) === 2 && parses === 1);
  api.inlineSvg(A2);
  ok("a new (mono) variant builds a second template but does NOT re-decode the asset", builds === 2 && parses === 1);
  api.inlineSvg(B);
  ok("a different asset decodes once more", parses === 2);
  ok("non-SVG src memoises to null (no decode)", api.inlineSvg({ src: "data:image/png;base64,ZZ" }) === null && parses === 2);
})();

// ---- pan/zoom perf wiring (#150): no per-frame localStorage; empty-comment fast path -
// applyView() runs on every wheel/drag tick; persistView must be debounced and the pin
// rebuild must bail when the course has no comments. These are wiring (browser-verified
// too) so guard the shape of the source.
section("pan/zoom perf wiring (#150)");
(function () {
  var e = src("src/editor.js");
  var persist = e.slice(e.indexOf("function persistView()"), e.indexOf("function persistView()") + 260);
  ok("persistView debounces the localStorage write (setTimeout + clearTimeout)",
    /clearTimeout\(_viewSaveT\)/.test(persist) && /setTimeout\(/.test(persist) && /localStorage\.setItem/.test(persist));
  var pins = e.slice(e.indexOf("function renderCommentPins()"), e.indexOf("function renderCommentPins()") + 700);
  ok("renderCommentPins has a no-comments fast path that skips the rebuild",
    /if \(!\(doc\.comments && doc\.comments\.length\)\)\s*\{[\s\S]*?return;/.test(pins));
  var img = src("src/render.js");
  ok("image path uses the memo colour count, not a redundant detectSvgColorsFromSrc parse",
    /window\.__svgColorCount\(block\) > 1/.test(img));
  // low-detail-while-moving: markNavigating tags the world nav-lod during a gesture and
  // clears it after a settle timer; CSS stops painting heavy leaf content under nav-lod.
  ok("markNavigating adds nav-lod + clears it on a settle timer",
    /function markNavigating\(\)[\s\S]*?classList\.add\("nav-lod"\)[\s\S]*?setTimeout\([\s\S]*?classList\.remove\("nav-lod"\)/.test(e));
  ok("markNavigating is wired into zoomStep, wheel-pan and drag-pan",
    (e.match(/markNavigating\(\);/g) || []).length >= 3);
  var css2 = src("editor.css");
  ok("nav-lod stops painting heavy leaf content (img/svg/embed/video)",
    /\.world\.nav-lod img,[\s\S]*?\.world\.nav-lod \.embed__video \{ visibility: hidden; \}/.test(css2));
})();

// ---- zoomed-out plain-page LOD (#172): drop page content paint while moving at far zoom --
// nav-lod only hides heavy LEAF media; an asset-light course has none, so plain text pages
// still re-rasterise every pan/zoom frame when the whole world is on-screen. applyView tags
// the world .world--far below FAR_ZOOM; the .nav-lod.world--far CSS then collapses each page
// to its frame box WHILE moving, snapping back on settle. Editor chrome only.
section("zoomed-out plain-page LOD (#172)");
(function () {
  var e = src("src/editor.js");
  ok("FAR_ZOOM threshold constant exists", /var FAR_ZOOM = [0-9.]+;/.test(e));
  ok("applyView toggles .world--far off the current zoom vs FAR_ZOOM",
    /world\.classList\.toggle\("world--far", view\.zoom < FAR_ZOOM\)/.test(e));
  var css = src("editor.css");
  ok("far-zoom LOD is gated on BOTH nav-lod (in motion) AND world--far (zoomed out)",
    /\.world\.nav-lod\.world--far \.course-root \{ visibility: hidden; \}/.test(css));
  ok("far-zoom LOD hides page CONTENT (.course-root), not the frame box",
    /world--far \.course-root/.test(css) && !/world--far \.frame \{ visibility: hidden/.test(css));
  // Invariant: this is editor chrome only -- render()/course.css never learn about it.
  ok("world--far / FAR_ZOOM never leak into render() or course output",
    src("src/render.js").indexOf("world--far") === -1 &&
    src("src/render.js").indexOf("FAR_ZOOM") === -1 &&
    src("src/course.css").indexOf("world--far") === -1);
})();

// ---- background-pause power governor (#179): stop forever-timers while occluded -----------
// The autosave (4s) + review (60s) polls fire forever, even when the window is hidden -- a
// constant CPU wake that defeats macOS App Nap. A visibilitychange handler pauses both while
// hidden (autosave FLUSHES first so a hidden-then-killed app never loses an edit) and resumes
// on return; the world's GPU promotion is dropped while unseen. Guard the shape.
section("background-pause power governor (#179)");
(function () {
  var p = src("src/persist.js");
  ok("autosave exposes a pause/resume governor",
    /window\.__autosaveGov = \{/.test(p) && /pause: function \(\) \{ if \(_autosaveTimer\) \{ autosave\(\);/.test(p));
  ok("pause FLUSHES (calls autosave) before clearing the interval -- no lost edit",
    /pause: function \(\)[\s\S]*?autosave\(\);[\s\S]*?clearInterval\(_autosaveTimer\)/.test(p));
  var e = src("src/editor.js");
  ok("editor pauses both polls + drops will-change when document.hidden",
    /visibilitychange[\s\S]*?document\.hidden[\s\S]*?__autosaveGov\.pause\(\)[\s\S]*?stopReviewPoll\(\)[\s\S]*?willChange = "auto"/.test(e));
  ok("editor resumes autosave + (conditionally) the review poll + restores will-change on return",
    /__autosaveGov\.resume\(\)[\s\S]*?_reviewPollWasOn[\s\S]*?startReviewPoll\(\)[\s\S]*?willChange = ""/.test(e));
  ok("review poll only resumes if it was actually running (folder-permission courses only)",
    /_reviewPollWasOn = !!reviewPollTimer/.test(e));
  // Invariant: a power tweak, never course output.
  ok("__autosaveGov / visibilitychange pause never leak into render()/course.css",
    src("src/render.js").indexOf("__autosaveGov") === -1 &&
    src("src/course.css").indexOf("visibilitychange") === -1);
})();

// ---- native-snapshot gesture proxy (#151): real bitmap instead of blanking while moving -----
// Replaces the disappearing-content LOD with a cached WKWebView takeSnapshot bitmap shown over
// the viewport while pan/zooming (compositor scales one texture), swapped back to the live DOM
// on settle. Feature-detected: no native bridge (a plain browser) -> the CSS LOD still runs.
section("native-snapshot gesture proxy (#151)");
(function () {
  var e = src("src/editor.js");
  ok("feature-detects the native bridge (webkit.messageHandlers.nativeSnapshot)",
    /window\.webkit && window\.webkit\.messageHandlers && window\.webkit\.messageHandlers\.nativeSnapshot/.test(e));
  ok("nativeSnapshot returns a Promise and resolves null when the bridge is absent",
    /function nativeSnapshot\(rect\) \{\s*if \(!hasNativeSnapshot\(\)\) return Promise\.resolve\(null\);/.test(e));
  ok("reply pump + pending map wired (window.__nativeSnapshotReply)",
    /window\.__nativeSnapshotReply = function \(reqId, dataUrl\)/.test(e) && /_snapPending\[reqId\]/.test(e));
  ok("proxy is DEFAULT OFF (takeSnapshot proved flaky) behind a console toggle",
    /var CANVAS_PROXY = false;/.test(e) && /window\.__canvasProxy = function \(on\)/.test(e));
  ok("proxyBegin gated on the flag + far zoom + the native bridge, with a re-entrancy guard",
    /if \(!CANVAS_PROXY \|\| proxyActive\(\) \|\| _proxy\.pending[\s\S]*?if \(!\(view\.zoom < FAR_ZOOM\) \|\| !hasNativeSnapshot\(\)\) return;/.test(e));
  ok("the live world is hidden only on img.onload (never before the bitmap paints -> no flicker)",
    /img\.onload = function \(\) \{[\s\S]*?if \(!img\.naturalWidth \|\| !img\.naturalHeight\) return;[\s\S]*?world\.style\.visibility = "hidden";/.test(e));
  ok("proxy is wired into markNavigating (begin) + the settle timer (end) + applyView (track)",
    /proxyBegin\(\);/.test(e) && /proxyEnd\(\);/.test(e) && /if \(proxyActive\(\)\) proxyTrackView\(\)/.test(e));
  ok("affine track maps the bitmap by A=zoom/startZoom, B=view.xy - startXY*A",
    /var A = view\.zoom \/ \(_proxy\.sz \|\| 1\);[\s\S]*?var bx = view\.x - _proxy\.sx \* A/.test(e));
  ok("failed/late snapshot leaves the live DOM up so the CSS LOD stays the fallback",
    /if \(epoch !== _proxy\.epoch\) \{ _proxy\.pending = false; return; \}[\s\S]*?if \(!dataUrl\) return;/.test(e));
  // Native side: the Swift bridge rasterises via takeSnapshot and replies to the pump.
  var sw = src("desktop/AuthoringTool.swift");
  ok("Swift registers the nativeSnapshot handler + rasterises via takeSnapshot -> PNG data URL",
    /name: "nativeSnapshot"/.test(sw) && /webView\.takeSnapshot\(with: cfg\)/.test(sw) &&
    /__nativeSnapshotReply/.test(sw) && /data:image\/png;base64,/.test(sw));
  ok("Swift uses afterScreenUpdates=true (afterScreenUpdates=false returns a black frame)",
    /cfg\.afterScreenUpdates = true/.test(sw));
  // Invariant: editor chrome only.
  ok("snapshot proxy never leaks into render()/course.css",
    src("src/render.js").indexOf("nativeSnapshot") === -1 &&
    src("src/render.js").indexOf("canvas-proxy") === -1 &&
    src("src/course.css").indexOf("canvas-proxy") === -1);
})();

// ---- native-scroll pan (#151 lever 1): pan by native scrolling, no re-raster, no blanking ----
// The world lives in an overflow:auto sizer; panning is native scroll (GPU tiles move) so content
// never blanks. Mapping view.x = SCROLL_PAD - scrollLeft keeps every screen<->world read valid;
// only writers (pan/zoom/fit) reroute to scroll. Default OFF behind a flag + console toggle.
section("native-scroll pan (#151 lever 1)");
(function () {
  var e = src("src/editor.js");
  ok("NATIVE_SCROLL flag default OFF + SCROLL_PAD + console toggle",
    /var NATIVE_SCROLL = false;/.test(e) && /var SCROLL_PAD = \d+;/.test(e) && /window\.__nativeScroll = function \(on\)/.test(e));
  ok("attachWorld wraps the world in the overflow sizer when native, plain append otherwise",
    /function attachWorld\(\)[\s\S]*?scrollSizer\.appendChild\(world\)[\s\S]*?canvas\.classList\.add\("native-scroll"\)[\s\S]*?canvas\.appendChild\(world\)[\s\S]*?canvas\.classList\.remove\("native-scroll"\)/.test(e));
  ok("every world mount routes through attachWorld (no raw canvas.appendChild(world) mount left)",
    (e.match(/attachWorld\(\)/g) || []).length >= 4 && !/\n\s*canvas\.appendChild\(world\);/.test(e.replace(/canvas\.appendChild\(world\);\n\s*canvas\.classList\.remove/,'')));
  ok("applyView drives pan via scroll (scale-only transform, sizer sized, view reconciled from clamped scroll)",
    /if \(NATIVE_SCROLL && scrollSizer\)[\s\S]*?world\.style\.transform = "scale\("[\s\S]*?canvas\.scrollLeft = SCROLL_PAD - view\.x[\s\S]*?view\.x = SCROLL_PAD - canvas\.scrollLeft/.test(e));
  var scrollBody = e.slice(e.indexOf('canvas.addEventListener("scroll"'), e.indexOf('}, { passive: true });') + 22);
  ok("scroll listener syncs view from scroll, reprojects pins, and does NOT re-raster (no nav-lod/applyView)",
    /view\.x = SCROLL_PAD - canvas\.scrollLeft[\s\S]*?renderCommentPins\(\)/.test(scrollBody) &&
    scrollBody.indexOf("markNavigating") === -1 && scrollBody.indexOf("applyView") === -1);
  ok("wheel + drag pan use native scroll under the flag (no transform pan when NATIVE_SCROLL)",
    /\} else if \(NATIVE_SCROLL\) \{\s*return;/.test(e) && /if \(NATIVE_SCROLL && scrollSizer\) \{[\s\S]*?canvas\.scrollLeft -= dx; canvas\.scrollTop -= dy;/.test(e));
  var css = src("editor.css");
  ok("native-scroll CSS: viewport scrolls + scrollbars hidden + sizer positioned",
    /\.canvas\.native-scroll \{ overflow: auto;/.test(css) && /\.canvas\.native-scroll::-webkit-scrollbar \{ width: 0; height: 0; \}/.test(css) && /\.canvas-scroll \{ position: relative; \}/.test(css));
  ok("native-scroll never leaks into render()/course.css",
    src("src/render.js").indexOf("NATIVE_SCROLL") === -1 &&
    src("src/course.css").indexOf("native-scroll") === -1);
  ok("under native-scroll, markNavigating skips the blanking classes (zoom paints LIVE, not black)",
    /function markNavigating\(\) \{[\s\S]*?if \(NATIVE_SCROLL\) return;[\s\S]*?classList\.add\("nav-lod"\)/.test(e));
  ok("the native-scroll flag persists across reload (localStorage) + no-arg query",
    /localStorage\.getItem\(NS_KEY\) === "1"/.test(e) && /\(on == null\) \? NATIVE_SCROLL : !!on/.test(e));
  // Compositor zoom (#151 lever 2, done right): all zoom entry points route through startZoom;
  // native mode animates the world transform via a CSS transition (browser scales the painted
  // layer -> smooth at any page count) then bakes to a crisp scale-only transform + scroll.
  ok("every zoom entry point routes through startZoom (no raw zoomStep kick left outside it)",
    (e.match(/startZoom\(\);/g) || []).length >= 3);
  ok("native zoom uses a CSS transition on the transform (compositor scales the cached layer)",
    /function startZoom\(\)[\s\S]*?world\.style\.transition = "transform " \+ _zoomDur \+ "ms linear";[\s\S]*?world\.style\.transform = "translate\(/.test(e));
  ok("zoom bakes to a crisp scale-only transform + folds the transient translate into scroll (no jump)",
    /function bakeZoom\(z, a\)[\s\S]*?view\.x = SCROLL_PAD - \(sl - tx\)[\s\S]*?applyView\(\)/.test(e));
  ok("trackpad zoom sensitivity bumped (ZOOM_SENS raised from 0.004) + live tuning hook",
    /var ZOOM_SENS = 0\.00[5-9]\d?;/.test(e) && /window\.__zoomTune = function/.test(e));
  ok("compositor zoom uses linear easing + a single tight settle (no double-phase)",
    /"transform " \+ _zoomDur \+ "ms linear"/.test(e) && /var _zoomDur = \d+, _zoomSettle = \d+;/.test(e));
})();

// ---- offscreen-frame culling (#150 slice B): content-visibility on offscreen pages ----
// After layoutColumns measures TRUE heights + stacks, each frame gets a contain-intrinsic
// -size seeded from its measured height and content-visibility:auto, so offscreen pages
// skip paint+layout without moving the stack. Guard: the seed is applied AFTER the world
// height is set (i.e. after measuring), from f.h, gated by the FRAME_CULL feature switch.
section("offscreen-frame culling (#150 slice B)");
(function () {
  var e = src("src/editor.js");
  ok("FRAME_CULL is a content-visibility feature-detect switch",
    /var FRAME_CULL = \("contentVisibility" in/.test(e));
  var lc = e.slice(e.indexOf("function layoutColumns()"), e.indexOf("function layoutColumns()") + 2600);
  ok("culling is applied AFTER the world height is set (heights already measured)",
    lc.indexOf("world.style.height = worldH") < lc.indexOf("frame--cull"));
  ok("contain-intrinsic-size is seeded from the measured height f.h",
    /containIntrinsicSize = FRAME_W \+ "px " \+ Math\.round\(f\.h/.test(lc));
  ok("the cull pass is gated by FRAME_CULL and adds frame--cull",
    /if \(FRAME_CULL\) frameDescs\.forEach/.test(lc) && /classList\.add\("frame--cull"\)/.test(lc));
  var css = src("editor.css");
  ok("CSS enables content-visibility:auto only on culled frames",
    /\.frame\.frame--cull \{ content-visibility: auto; \}/.test(css));
})();

// ---- block vertical align (block.valign -> auto margins on the flex main axis) --
// Pure render mapping: center -> top+bottom margin auto (native "spacer above+
// below"), bottom -> top margin auto, top/absent -> no auto margins. htmlEmbed is
// skipped (positions via its internal fit). data-valign stamped for center/bottom.
section("block valign render mapping");
(function () {
  var t = src("src/render.js");
  var slice = t.slice(t.indexOf("if (block.valign && block.valign !== \"top\")"), t.indexOf("// Interaction identity"));
  var run = new Function("block", "node", slice);
  function mknode() {
    return { attrs: {}, style: {},
      setAttribute: function (k, v) { this.attrs[k] = v; } };
  }
  var mid = mknode(); run({ type: "paragraph", valign: "center" }, mid);
  ok("center -> marginTop+marginBottom auto + data-valign", mid.style.marginTop === "auto" && mid.style.marginBottom === "auto" && mid.attrs["data-valign"] === "center");
  var bot = mknode(); run({ type: "paragraph", valign: "bottom" }, bot);
  ok("bottom -> marginTop auto only", bot.style.marginTop === "auto" && bot.style.marginBottom === undefined && bot.attrs["data-valign"] === "bottom");
  var top = mknode(); run({ type: "paragraph", valign: "top" }, top);
  ok("top -> no auto margins, no data-valign (zero regression default)", top.style.marginTop === undefined && top.attrs["data-valign"] === undefined);
  var none = mknode(); run({ type: "paragraph" }, none);
  ok("absent valign -> untouched", none.style.marginTop === undefined && none.attrs["data-valign"] === undefined);
  // htmlEmbed IS vertically aligned (auto margins on the outer wrap) — the fit
  // runtime owns only the inner iframe's scale + horizontal offset, a different axis.
  var emb = mknode(); run({ type: "htmlEmbed", valign: "center" }, emb);
  ok("htmlEmbed center -> data-valign + top+bottom auto margins on the wrap", emb.attrs["data-valign"] === "center" && emb.style.marginTop === "auto" && emb.style.marginBottom === "auto");
  var embB = mknode(); run({ type: "htmlEmbed", valign: "bottom" }, embB);
  ok("htmlEmbed bottom -> marginTop auto (anchors to column bottom)", embB.style.marginTop === "auto" && embB.style.marginBottom === undefined);

  // A group is display:contents (no box) so align/valign are ignored -> promote it
  // to a real flex-column item ONLY when aligned (plain groups stay contents).
  var gslice = t.slice(t.indexOf("if (block.type === \"group\" && (block.align"), t.indexOf("// Item D — universal per-element alignment"));
  var grun = new Function("block", "node", gslice);
  var gv = mknode(); grun({ type: "group", valign: "center" }, gv);
  ok("group + valign -> promoted to flex column (box for the auto margins)", gv.style.display === "flex" && gv.style.flexDirection === "column");
  var ga = mknode(); grun({ type: "group", align: "center" }, ga);
  ok("group + align -> promoted to flex column too", ga.style.display === "flex");
  var gp = mknode(); grun({ type: "group" }, gp);
  ok("plain group -> untouched (keeps display:contents, zero regression)", gp.style.display === undefined);
  var ng = mknode(); grun({ type: "paragraph", valign: "center" }, ng);
  ok("non-group -> not promoted by this rule", ng.style.display === undefined);
})();

// ---- block valign: editor control + vertical glyphs --------------------------
section("block valign controls");
(function () {
  var e = src("src/editor.js");
  ok("Vertical segmented control writes block.valign", /segmentedIconLive\("Vertical",[\s\S]{0,400}block\.valign = v/.test(e));
  ok("valign 'top' deletes the key (equal/default)", /if \(v === "top"\) delete block\.valign/.test(e));
  ok("vertical glyphs defined (Top/Middle/Bottom)", /"align-start-horizontal":/.test(src("src/icons.js")) && /"align-center-horizontal":/.test(src("src/icons.js")) && /"align-end-horizontal":/.test(src("src/icons.js")));
  ok("Vertical row references the vertical glyphs", /Icon\("align-start-horizontal"\), "top"[\s\S]{0,80}Icon\("align-center-horizontal"\), "center"[\s\S]{0,80}Icon\("align-end-horizontal"\), "bottom"/.test(e));
})();

// ---- CSVBind: M8 single-source content binding (flagship reuse feature) -----
// The CSV overlay auto-detects flat vs transposed orientation and ranks field->
// slot matches so a specific column (ChapterTitle) wins over a generic alias
// (Name). Untested before; this is the headline content-reuse differentiator.
section("CSVBind (M8)");
(function () {
  var win = { Editor: { registerPipelineButton: function () {} } };
  new Function("window", src("src/csv.js"))(win);
  var CB = win.CSVBind;
  var slots = [{ key: "number", label: "Number" }, { key: "title", label: "Title" }, { key: "objective", label: "Objective" }];
  // parseCSV
  ok("parseCSV basic", JSON.stringify(CB.parseCSV("a,b\n1,2")) === JSON.stringify([["a", "b"], ["1", "2"]]));
  ok("parseCSV quoted comma", JSON.stringify(CB.parseCSV('x,"a,b",y')) === JSON.stringify([["x", "a,b", "y"]]));
  // match strength / ranking
  ok("exact key matches (strength 3)", CB.fieldMatchesSlot("Title", slots[1]) && CB.fieldMatchesSlot("ChapterTitle", slots[1]));
  ok("generic alias matches (Name -> title)", CB.fieldMatchesSlot("Name", slots[1]));
  ok("non-matching field", !CB.fieldMatchesSlot("Foobar", slots[1]));
  // flat orientation
  var flat = CB.buildRecords([["Number", "Title", "Objective"], ["01", "Overview", "Learn X"], ["02", "Types", "Learn Y"]], slots);
  ok("flat orientation detected", flat.orientation === "flat" && flat.records.length === 2);
  ok("flat record -> slots", JSON.stringify(CB.recordToSlots(flat.records[0], slots)) === JSON.stringify({ number: "01", title: "Overview", objective: "Learn X" }));
  // transposed orientation (chapter_cards.csv shape: field names in column 0)
  var trans = CB.buildRecords([["Field", "C1", "C2"], ["ChapterTitle", "Overview", "Types"], ["ChapterNumber", "01", "02"], ["ChapterObjective", "Learn X", "Learn Y"]], slots);
  ok("transposed orientation detected", trans.orientation === "transposed" && trans.records.length === 2);
  ok("transposed record -> slots", CB.recordToSlots(trans.records[1], slots).title === "Types" && CB.recordToSlots(trans.records[1], slots).number === "02");
  // ranking: a specific field beats a generic alias for the same slot (the documented shadow fix)
  ok("specific field beats generic alias", CB.recordToSlots({ Name: "Generic", ChapterTitle: "Real" }, slots).title === "Real");
})();

// ---- buildInteractionMap (feeds Moodle completion via the runtime engine) ---
// The exported course's completion/gating is driven by this map; a wrong map = a
// course that never marks complete in Moodle. Pure fn (+ normalizeInteractions,
// walkBlocks). Untested before.
section("buildInteractionMap");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("window.normalizeInteractions = function (block)"), t.indexOf("// ---- Chapters (JJJJ)"));
  var win = {};
  new Function("window", body)(win);
  var build = win.buildInteractionMap;
  var doc = { pages: [{ id: "p1", blocks: [
    { id: "b1", type: "navButton", action: { goto: "p2" } },                                            // legacy -> interactions
    { id: "b2", type: "button", interactions: [{ trigger: { type: "click" }, action: { type: "goto", target: "p3" } }] },
    { id: "b3", type: "quiz", gate: { required: true } },                                                 // gate only
    { type: "note", text: "no id", action: { goto: "p2" } },                                              // no id -> excluded
    { id: "b4", type: "heading", text: "plain" },                                                         // no interactions/gate -> excluded
    { id: "fr", type: "frame", children: [{ id: "nested", type: "navButton", action: { goto: "p4" } }] }, // nested reached
    { id: "cols", type: "columns", columns: [[{ id: "cnav", type: "navButton", action: { goto: "p5" } }]] }
  ] }] };
  var map = build(doc);
  ok("legacy action.goto normalised into interactions", map.b1 && map.b1.interactions[0].action.target === "p2");
  ok("modern interactions kept", map.b2 && map.b2.interactions[0].action.target === "p3");
  ok("gate-only block included", !!map.b3 && !!map.b3.gate);
  ok("id-less interactive block excluded", Object.keys(map).indexOf("undefined") === -1 && !map[""]);
  ok("plain block (no ix/gate) excluded", !map.b4);
  ok("nested-in-children block reached", map.nested && map.nested.interactions[0].action.target === "p4");
  ok("nested-in-columns block reached", map.cnav && map.cnav.interactions[0].action.target === "p5");
  ok("only participating ids present", Object.keys(map).sort().join(",") === "b1,b2,b3,cnav,nested");
})();

// ---- Schema round-trip losslessness (Feature 2, SPEC-variants-schema §4) ----
// exportSchema(walk)->CSV->importSchema(setPath) must rebuild the doc losslessly
// (structure AND typed copy). No prior functional test existed for schema.js.
section("schema round-trip");
(function () {
  var t = src("src/schema.js");
  var writeSide = t.slice(t.indexOf("function csvCell"), t.indexOf("function exportSchema"));
  var readSide = t.slice(t.indexOf("function castValue"), t.indexOf("function importSchema"));
  var api = new Function(writeSide + readSide + "\nreturn { toCSV:toCSV, parseCSV:parseCSV, walk:walk, castValue:castValue, setPath:setPath };")();
  function rebuild(rows) {
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var pi = head.indexOf("path"), ti = head.indexOf("type"), vi = head.indexOf("value");
    var root = {};
    for (var r = 1; r < rows.length; r++) {
      var path = String(rows[r][pi] == null ? "" : rows[r][pi]).trim();
      if (!path) continue;
      api.setPath(root, path, api.castValue(String(rows[r][ti] || "string").trim(), rows[r][vi] == null ? "" : rows[r][vi]));
    }
    return root;
  }
  function roundtrip(doc) {
    var rows = [["Page", "Location", "Path", "Field", "Type", "Value"]];
    api.walk(doc, "", [], "", rows);
    return rebuild(api.parseCSV(api.toCSV(rows)));
  }
  // typed + nested + CSV-hostile edge cases
  var edge = { meta: { code: "X" }, pages: [{ id: "p1", name: "One, Two", blocks: [
    { type: "heading", text: 'He said "hi"\nline2', keep: "01", n: 34, flag: false, gone: null },
    { type: "columns", columns: [[{ type: "text", text: "a" }], [{ type: "frame", children: [{ type: "text", text: "b" }] }]] }
  ] }] };
  var rt = roundtrip(edge);
  ok("edge doc round-trips lossless", JSON.stringify(rt) === JSON.stringify(edge));
  ok('string "01" stays a string (not number)', rt.pages[0].blocks[0].keep === "01");
  ok("number stays a number", rt.pages[0].blocks[0].n === 34);
  ok("boolean false preserved", rt.pages[0].blocks[0].flag === false);
  ok("null preserved", rt.pages[0].blocks[0].gone === null);
  ok("comma/quote/newline in values survive CSV", rt.pages[0].blocks[0].text === 'He said "hi"\nline2' && rt.pages[0].name === "One, Two");
  ok("nested columns/children rebuilt", rt.pages[0].blocks[1].columns[1][0].children[0].text === "b");
  // the real course
  var w = {}; new Function("window", src("src/model.js"))(w);
  ok("SAMPLE_DOC round-trips lossless", JSON.stringify(roundtrip(w.SAMPLE_DOC)) === JSON.stringify(w.SAMPLE_DOC));
})();

// ---- EEE: validate CHROME nav targets (footer courseNav is the primary nav) --
section("EEE chrome nav validation");
(function () {
  var t = src("src/export.js");
  var body = t.slice(t.indexOf("function estimateCourseBytes(doc)"), t.indexOf("window.__validateExport"));
  var win = { collectAssetRefs: function () { return []; }, AssetStore: { has: function () { return true; }, get: function () { return null; } }, EMBEDDABLE_FONTS: ["Exo 2"] };
  var validate = new Function("window", "ENC", body + "\nreturn validateExport;")(win, new TextEncoder());
  function errs(iss, sub) { return iss.some(function (i) { return i.level === "error" && i.msg.indexOf(sub) !== -1; }); }
  var pages = [{ id: "ch01", blocks: [{ type: "heading", text: "a" }] }, { id: "ch02", blocks: [{ type: "heading", text: "b" }] }];
  // footer courseNav referencing a MISSING page -> error (the new coverage)
  var bad = { pages: pages, headerFooter: { footer: { children: [{ type: "courseNav", sections: [{ id: "s1", label: "One", pageIds: ["ch01"] }, { id: "s2", label: "Gone", pageIds: ["ch99"] }] }] } } };
  ok("footer courseNav -> missing page errors", errs(validate(bad), 'missing page (id "ch99")'));
  // all-valid footer courseNav -> no missing-page error
  var good = { pages: pages, headerFooter: { footer: { children: [{ type: "courseNav", sections: [{ id: "s1", label: "One", pageIds: ["ch01"] }, { id: "s2", label: "Two", pageIds: ["ch02"] }] }] } } };
  ok("valid footer courseNav -> no nav error", !errs(validate(good), "missing page"));
  // a nav button placed in the HEADER chrome with a bad goto -> error
  var hdr = { pages: pages, headerFooter: { header: { children: [{ type: "navButton", text: "Home", action: { goto: "nope" } }] } } };
  ok("header nav button -> bad goto errors", errs(validate(hdr), 'missing page (id "nope")'));
})();

// ---- zip central-dir offset regression guard (OO-B / SPEC A-slice-4) --------
// The central-dir offset bug bit once; parse the REAL bytes makeZip emits and
// assert every central entry's local-header offset lands on a PK\x03\x04 sig.
section("zip central-dir guard");
(function () {
  var t = src("src/export.js");
  var body = t.slice(t.indexOf("var CRC_TABLE"), t.indexOf("// ---- fetch helpers"));
  var ENC = new TextEncoder();
  function BlobStub(parts) { this.parts = parts; }
  var makeZip = new Function("ENC", "Blob", body + "\nreturn makeZip;")(ENC, BlobStub);
  function flatten(blob) { var n = 0; blob.parts.forEach(function (p) { n += p.length; }); var out = new Uint8Array(n), o = 0; blob.parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out; }
  function check(files, tag) {
    var buf = flatten(makeZip(files)), dv = new DataView(buf.buffer, buf.byteOffset, buf.length), eocd = buf.length - 22;
    ok(tag + ": EOCD sig", dv.getUint32(eocd, true) === 0x06054b50);
    ok(tag + ": count == files", dv.getUint16(eocd + 10, true) === files.length);
    var cStart = dv.getUint32(eocd + 16, true), cSize = dv.getUint32(eocd + 12, true);
    ok(tag + ": start+size+22 == len", cStart + cSize + 22 === buf.length);
    var cur = cStart, good = true, names = [];
    for (var i = 0; i < files.length; i++) {
      if (dv.getUint32(cur, true) !== 0x02014b50) { good = false; break; }
      var nl = dv.getUint16(cur + 28, true), off = dv.getUint32(cur + 42, true);
      if (dv.getUint32(off, true) !== 0x04034b50) { good = false; break; }
      names.push(new TextDecoder().decode(buf.subarray(cur + 46, cur + 46 + nl)));
      cur += 46 + nl;
    }
    ok(tag + ": every central offset -> local header", good);
    ok(tag + ": names round-trip", JSON.stringify(names) === JSON.stringify(files.map(function (f) { return f.name; })));
  }
  check([
    { name: "imsmanifest.xml", bytes: ENC.encode("<manifest/>") },
    { name: "index.html", bytes: ENC.encode("<html>" + "x".repeat(5000) + "</html>") },
    { name: "assets/a/very/deep/path/course.css", bytes: ENC.encode(".x{}") },
    { name: "empty.js", bytes: new Uint8Array(0) }
  ], "multi");
  check([{ name: "only.txt", bytes: ENC.encode("hello") }], "single");
})();

// ---- SVG auto-colour polarity classifier (render.js classifySvgColor) ------
// Regression guard for the "SVG auto-colour inverted by default" fix: a
// dark-authored graphic's dark bg must map to "surface" (tracks the page), not
// "ink". Pure classifier extracted from render.js (background luminance passed in).
section("SVG polarity classifier");
(function () {
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("function normColor"), t.indexOf("window.classifySvgColor"));
  var m = new Function("window", body + "\nreturn { classify: classifySvgColor, lum: colorLum };")({});
  var tok = function (c, bg) { var r = m.classify(c, bg); return r ? r.token : null; };
  var darkBg = m.lum("#111111"), lightBg = m.lum("#ffffff");
  // background role -> `bg` (the theme's actual page background), so a recoloured SVG
  // background matches the off-white page rather than pure-white `surface`.
  ok("dark-authored: dark bg -> bg", tok("#111111", darkBg) === "bg");
  ok("dark-authored: light text -> ink", tok("#eeeeee", darkBg) === "ink");
  ok("dark-authored: accent kept (null)", tok("#f59e0b", darkBg) === null);
  ok("dark-authored: muted grey -> inkSoft", tok("#555555", darkBg) === "inkSoft");
  ok("light-authored: light bg -> bg", tok("#ffffff", lightBg) === "bg");
  ok("light-authored: dark text -> ink", tok("#111111", lightBg) === "ink");
  ok("fallback (no bg): dark -> ink", tok("#111111", null) === "ink");
  ok("fallback (no bg): light -> bg", tok("#eeeeee", null) === "bg");
  ok("regression: dark bg NOT ink when polarity known", tok("#111111", darkBg) !== "ink");
})();

// ---- panel-standards guardrail (SPEC-panel-cleanup) ----------------------
// Positive space lives in UX-STYLE-GUIDE.md; here we machine-enforce the NEGATIVE
// space (retired patterns). Slice 1 = WARNING (Header & Footer clean; other panels
// still use the old pattern). Slice 3 flips the app-wide count to a hard failure.
section("panel-standards");
(function () {
  var t = src("src/editor.js");
  // canonical primitives exist
  ["function subDisclosure", "function switchEl", "function switchRow", "function eyeRow",
   "function segmentedIconLive", "function nestOverridden", "function nestReset"
  ].forEach(function (sig) { ok("primitive present: " + sig, t.indexOf(sig) !== -1); });
  // open-state persisted (decision 2)
  ok("openSections persisted to localStorage", /authoring\.panels-open/.test(t) && /function saveOpenSections/.test(t));
  // Header & Footer is converted: nests + switch + icon-align + eye, NO word-boolean segments
  var region = slice(t, "function buildHeaderFooterBody", "// Page layout = per-breakpoint");
  ok("HF: header nest", /subDisclosure\("hf\.header"/.test(region));
  ok("HF: footer nest", /subDisclosure\("hf\.footer"/.test(region));
  ok("HF: switch rows (Underline/Top rule/Pin)", /switchRow\("Underline"/.test(region) && /switchRow\("Top rule"/.test(region) && /switchRow\("Pin to top"/.test(region));
  ok("HF: alignment as icon segments", /segmentedIconLive\("Align"/.test(region));
  ok("HF: disclaimer as eye", /eyeRow\("Disclaimer"/.test(region));
  ok("HF: no [Off|On] word booleans", !/\["Off"/.test(region) && !/\["On"/.test(region));
  ok("HF: no Show/Hide word booleans", !/\["Show"/.test(region) && !/\["Hide"/.test(region));
  // Slice 3: HARD-FAIL on any word-boolean segmented option app-wide. A generic on/off
  // label (off/on/show/hide/yes/no) paired with a boolean value must be a switch/eye.
  // Named-mode booleans (e.g. "Click to edit"/"Select first", "hug"/"full") are allowed
  // -- their labels convey meaning, so they don't match this pattern.
  var residuals = (t.match(/\["(off|on|show|hide|yes|no)",\s*(true|false)\]/gi) || []);
  ok("no word-boolean segmentedLive remains (app-wide)", residuals.length === 0);
  if (residuals.length) console.error("    offenders: " + residuals.join(" · "));
  // nav (slice 2) converted to nests
  var navRegion = slice(t, "function courseNavControls", "function navButtonsNest");
  ok("Nav: nested (Buttons/Pill/Progression/Sections)", /subDisclosure\("nav\.buttons"/.test(t) && /subDisclosure\("nav\.pill"/.test(t) && /subDisclosure\("nav\.sections"/.test(t));
  ok("Nav: no word booleans in courseNavControls", !/\["(off|on|show|hide)",\s*(true|false)\]/i.test(navRegion));
  // nav promoted to a TOP-LEVEL disclosure (keeps its nests at level 2, not 3-deep under Footer)
  ok("Nav: 'Learner nav' is a settings section", /key: "nav", title: "Learner nav"/.test(t));
  var hfChildren = slice(t, "function headerFooterChildrenEditor", "function makeCourseNav");
  ok("Nav: not rendered inline in header/footer children editor", hfChildren.indexOf("courseNavControls(") === -1);
  // issue #11 DS-conformance (panel scope): the converted Header & Footer body
  // builds from the canonical primitives + the Icon accessor. No inline <svg>
  // in the panel body, and every container-chrome section is gate-ok (Header/
  // Footer styling, not a hand-rolled block frame).
  ok("HF: no inline <svg> in the panel body (icons via the accessor)", region.indexOf("<svg") === -1);
  var hfChrome = region.split("\n").filter(function (line) {
    return /sub\("(Appearance|Layout)"\)/.test(line) && !/gate-ok/.test(line);
  });
  ok("HF: no hand-rolled Appearance/Layout chrome (all gate-ok styling)", hfChrome.length === 0);
})();

// ---- LeftPanel re-skinned to the DS (issue #13, parent #22) ---------------
// The Structure outliner + Blocks palette are re-grounded on the vendored Design
// System (design-system/ui_kits/editor/LeftPanel.jsx): rows carry Lucide glyphs via
// the Icon accessor, the chapter count is a canonical Badge, and the palette is
// built from the canonical BlockTile / BlockGrid / BlockPaletteItem + a grid/list
// SegmentedControl. Re-skin only — the wiring hook classes (tree-page__name /
// tree-block / asset-group__title) are preserved, so selection/DnD/rename don't move.
section("LeftPanel DS re-skin (issue #13)");
(function () {
  var e = src("src/editor.js");
  var css = src("editor.css");
  var icons = src("src/icons.js");
  // Outliner: block-type icons are Lucide (a map, resolved through the accessor) —
  // no text glyphs. Pages get file-text; carets are the Lucide chevron.
  ok("outliner block icons map to Lucide (BLOCK_LUCIDE)", /var BLOCK_LUCIDE = \{/.test(e) && /blockIcon\(b\) \{ return BLOCK_LUCIDE/.test(e));
  ok("block rows render the Lucide icon via the accessor", /outlineIcon\("tree-block__icon", blockIcon\(block\)\)/.test(e));
  ok("page rows carry the DS file-text icon", /outlineIcon\("tree-page__icon", "file-text"\)/.test(e));
  ok("outliner carets are the Lucide chevron (accessor, no triangle markup)", /window\.Icon\("chevron-right"\)/.test(e) && /\.tree-caret\.is-open svg \{ transform: rotate\(90deg\)/.test(css));
  // Chapter count is the canonical Badge; names stay upper-cased (in the skin).
  ok("chapter count is the canonical VersoUI.Badge", /window\.VersoUI\.Badge\(\{ children: String\(\(ch\.pages/.test(e));
  ok("chapter names stay upper-cased (CSS text-transform)", /\.tree-chapter__name \{[^}]*text-transform: uppercase/.test(css));
  // Palette is built from the canonical control set with a persisted grid/list view.
  ok("palette entries build from BlockTile / BlockPaletteItem", /U\.BlockTile\(\{/.test(e) && /U\.BlockPaletteItem\(\{/.test(e));
  // #105: grid view uses a WIDTH-ADAPTIVE BlockGrid (auto-fill), not a fixed 3-col
  // grid — the resizable dock would otherwise balloon the tiles as it widens.
  ok("grid view lays out via the canonical BlockGrid (width-adaptive)", /U\.BlockGrid\(\{ minColWidth: \d+ \}\)/.test(e));
  ok("grid/list view is a canonical SegmentedControl (Lucide icons)", /U\.SegmentedControl\(\{[\s\S]*layout-grid[\s\S]*list/.test(e));
  // #105: BlockGrid honours minColWidth with an auto-fill track (stable tile size,
  // flexing column count); tiles are single-line + ellipsised for uniform row height;
  // the tile glyph is the DS default 16px scale, not 20px.
  var uiKitSrc = src("src/ui-kit.js");
  ok("BlockGrid emits an auto-fill track for minColWidth", /repeat\(auto-fill, minmax\("\s*\+\s*props\.minColWidth\s*\+\s*"px, 1fr\)\)/.test(uiKitSrc));
  ok("BlockTile carries a title tooltip (labels truncate in grid)", /tile\.title = String\(props\.label\)/.test(uiKitSrc));
  ok("palette tile label is single-line + ellipsised (uniform height)", /\.vds-tile__label \{[^}]*white-space: nowrap/.test(css) && /\.vds-tile__label \{[^}]*text-overflow: ellipsis/.test(css));
  ok("palette tile glyph is the DS 16px scale", /\.vds-tile__icon svg \{ width: 16px; height: 16px; \}/.test(css));
  ok("palette view is persisted", /PALETTE_VIEW_KEY = "authoring\.palette\.view"/.test(e));
  // Wiring hooks preserved (re-skin, never re-wire): the tests/queries that key off
  // these class names keep matching.
  ok("wiring hooks preserved (tree-page__name / tree-block / asset-group__title)",
     /tree-page__name"/.test(e) && /"tree-block"/.test(e) && /"asset-group__title", "Shared Library"/.test(e));
  // The DS Lucide glyphs the LeftPanel uses are inlined offline in the accessor.
  ["file-text", "heading", "type", "list-checks", "layout-grid", "component", "target"].forEach(function (n) {
    ok("icons.js provides the DS glyph: " + n, new RegExp('"' + n + '":').test(icons));
  });
  // Selection is DS-grounded (surface-selected wash), not raw blue.
  ok("outliner selection uses the DS surface-selected token", /\.tree-block\.is-selected \{[^}]*var\(--surface-selected\)/.test(css));
})();

// ---- note callout is a container, not a <p> (left-accent stub bug) --------
// A <p class="body-note"> auto-closes at the first block-level child, so a note holding
// multiple paragraphs / a <ul> (or effectively empty) collapsed the orange accent to a
// 1-line stub with the copy escaping outside the border (seen in the LMS/SCORM export).
// The note must render as a DIV so the accent legally wraps + spans the full height.
section("note callout container");
(function () {
  var r = src("src/render.js");
  var noteFn = slice(r, "note: function (block)", "},");
  ok("note renders as a div (not a p)", /editable\("div",\s*"body-note"/.test(noteFn));
  ok("note is NOT a <p> callout", !/editable\("p",\s*"body-note"/.test(noteFn));
  var css = src("src/course.css");
  ok("course.css keeps the .body-note accent", /\.body-note\s*\{[^}]*border-left:/.test(css));
  ok("nested block margins collapse inside the callout", /\.body-note\s*>\s*:first-child/.test(css) && /\.body-note\s*>\s*:last-child/.test(css));
})();

// ---- §12 Verso Viewer: V1 publish snapshot + the standalone app -----------
section("Verso Viewer (V1 + app)");
(function () {
  var t = src("src/editor.js");
  ok("snapshot freezes a verso-pub with comments stripped", /function snapshotBlob\(versionOverride\)[\s\S]*?delete frozen\.comments[\s\S]*?type: "verso-pub"/.test(t));
  // §12a: the frozen snapshot bakes AssetStore refs into self-contained base64 (the Viewer has no AssetStore)
  ok("snapshot resolves asset refs into base64 data-URIs (renders standalone in the Viewer)", /function snapshotBlob\(versionOverride\)[\s\S]*?window\.resolveMedia\(frozen, function \(id\) \{\s*var a = window\.AssetStore\.get\(id\);\s*return a \? a\.dataUrl : window\.AssetStore\.placeholder;/.test(t));
  // SCORM export modal "Also publish review file" toggle
  var ex = src("src/export.js");
  ok("export defaultOptions has reviewFile", /defaultOptions[\s\S]*?reviewFile: false/.test(ex));
  ok("export modal offers the review-file toggle", /toggle\("Also publish review file", "reviewFile"\)/.test(ex));
  ok("export emits the review snapshot when toggled (same version)", /function alsoPublishReview[\s\S]*?window\.Editor\.publishReviewFile\(opts\.version\)/.test(ex));
  ok("editor exposes publishReviewFile on window.Editor", /publishReviewFile: function \(version\) \{ return publishToViewer\(version, true\); \}/.test(t));
  ok("Publish writes to the review folder (FSA) with a download fallback", /async function publishToViewer[\s\S]*?ensureReviewFolder\(\)[\s\S]*?getFileHandle\(f\.name[\s\S]*?createWritable/.test(t));
  ok("scanAndMerge reads review-*.json + merges (conflict-free)", /async function scanAndMerge\(dir\)[\s\S]*?review-.*\\\.json[\s\S]*?mergeComments\(list\)/.test(t));
  ok("folder handle is persisted in IndexedDB (survives restart)", /function saveReviewDir[\s\S]*?objectStore\("h"\)\.put\(handle, "dir"\)/.test(t) && /function loadReviewDir/.test(t));
  ok("auto-ingest runs on boot + polls, silently (no prompt)", /function initReviewAutoIngest[\s\S]*?dirPermission\(saved, true\)[\s\S]*?autoIngestReviews\(\)/.test(t) && /setInterval\(function \(\) \{ autoIngestReviews\(\); \}, 60000\)/.test(t));
  ok("auto-ingest only notifies when something new arrived", /async function autoIngestReviews[\s\S]*?if \(r\.added > 0 \|\| r\.updated > 0\)/.test(t));
  var exists = require("fs").existsSync(require("path").join(__dirname, "..", "viewer/viewer.html"));
  ok("viewer/viewer.html exists", exists);
  if (exists) {
    var v = src("viewer/viewer.html");
    ok("viewer renders via render.js (renderPage)", /window\.renderPage\(page, theme, window\.resolveHeaderFooter/.test(v));
    ok("viewer stamps data-cid on the read-only DOM", /n\.setAttribute\("data-cid", n\.__block\.cid\)/.test(v));
    ok("viewer 3-tier anchor (block > page)", /function anchorFromPoint[\s\S]*?blockId:[\s\S]*?pageId:/.test(v));
    ok("viewer submits the shared verso-comments sidecar", /type:"verso-comments"/.test(v));
    ok("viewer save-to-folder (FSA) + download fallback", /getFileHandle\(fname[\s\S]*?createWritable/.test(v) && /showDirectoryPicker/.test(v));
    ok("viewer runs ONE page at a time via the real runtime", /window\.CourseRuntime\.create\(\{ root:root/.test(v) && /window\.QuizRuntime\.init\(root\)/.test(v));
  }
  // V3: the bundler + a self-contained distributable
  var vfs = require("fs"), vpath = require("path");
  ok("viewer/build.js bundler exists", vfs.existsSync(vpath.join(__dirname, "..", "viewer/build.js")));
  var distPath = vpath.join(__dirname, "..", "viewer/verso-viewer.html");
  if (vfs.existsSync(distPath)) {
    var dist = vfs.readFileSync(distPath, "utf8");
    ok("verso-viewer.html is self-contained (no ../src refs)", dist.indexOf("../src/") === -1);
    ok("verso-viewer.html inlines the runtime + render", /window\.renderPage/.test(dist) && /window\.CourseRuntime/.test(dist));
  }
})();

// ---- §1: light/dark mode crossfade ---------------------------------------
section("mode crossfade");
(function () {
  var css = src("src/course.css");
  // reading surfaces ease their palette; scoped to [data-mode] so no-JS first paint doesn't animate
  ok("root+text reading surfaces transition on mode flip (var-driven)", /\.course-root\[data-mode\],\s*\[data-mode\] \.course-root,\s*\[data-mode\] \.page,[\s\S]*?transition: background-color var\(--motion-mode-fade, 300ms\) ease, color var\(--motion-mode-fade, 300ms\) ease, border-color var\(--motion-mode-fade, 300ms\) ease/.test(css));
  // matches BOTH self ([data-mode] ON the root, editor canvas) AND ancestor ([data-mode] .page, preview/export where html/body carry it)
  ok("crossfade matches data-mode on the root OR an ancestor (editor + preview/export)", /\.course-root\[data-mode\],/.test(css) && /\[data-mode\] \.course-root,/.test(css) && /\[data-mode\] \.page,/.test(css));
  // gated to [data-mode] present (a real toggle), never the no-JS default
  ok("crossfade is scoped to [data-mode] present, not :not([data-mode])", /\[data-mode\] \.body-list \{[\s\S]*?transition: background-color var\(--motion-mode-fade/.test(css) && !/course-root:not\(\[data-mode\]\)[\s\S]{0,80}transition: background-color var\(--motion-mode-fade/.test(css));
  // reduced-motion disables it
  ok("crossfade honours prefers-reduced-motion", /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\[data-mode\] \.body-list \{ transition: none; \}/.test(css));
  // the DEMO/preview mode-toggle must re-theme the EXISTING root in place (applyTheme +
  // data-mode), NOT renderDemo() -- a rebuild recreates the DOM already in the new mode
  // so the crossfade has no old->new value to animate (the hard cut James saw in preview).
  var e = src("src/editor.js");
  ok("demo mode-toggle re-themes in place (applyTheme on existing root), not a rebuild", /closest\("\[data-mode-toggle\]"\)[\s\S]*?demoDevice\.querySelectorAll\("\.course-root"\)[\s\S]*?window\.applyTheme\(r, __t\); r\.setAttribute\("data-mode", activeMode\)/.test(e));
  ok("demo mode-toggle only falls back to renderDemo when nothing is mounted", /if \(__roots\.length\) \{[\s\S]*?\} else \{\s*renderDemo\(\);/.test(e));
})();

// ---- image lightbox (click-to-zoom overlay) ------------------------------
section("image lightbox");
(function () {
  var r = src("src/render.js"), rt = src("src/runtime.js"), css = src("src/course.css"), e = src("src/editor.js");
  // render: standard-on zoomable + caption carried on the figure, opt-out via noZoom
  ok("render marks images zoomable unless noZoom", /if \(block\.noZoom !== true\) \{\s*fig\.classList\.add\("block-image--zoomable"\)/.test(r));
  // Author image corner radius: block.radius -> --img-radius on the figure (0 = square),
  // and the CSS reads that var with --radius-card as the default when unset.
  ok("render sets --img-radius from block.radius", /block\.radius != null && block\.radius !== ""\) fig\.style\.setProperty\("--img-radius", block\.radius \+ "px"\)/.test(r));
  ok("css: image radius reads --img-radius with --radius-card default", /\.block-image__img \{[^}]*border-radius: var\(--img-radius, var\(--radius-card\)\)/.test(css));
  // Master image radius: doc.imageRadius -> --img-radius on the ROOT (per-pass hook); the
  // per-image figure var overrides it via CSS specificity. 0 must be a valid value.
  ok("render sets root --img-radius from the __imageRadius master hook", /window\.__imageRadius != null\) root\.style\.setProperty\("--img-radius", window\.__imageRadius \+ "px"\)/.test(r));
  ok("editor: settings write doc.imageRadius (master control)", /doc\.imageRadius = n; mount\(\); scheduleSave\(\)/.test(e) || /delete doc\.imageRadius; else doc\.imageRadius = n/.test(e));
  ok("editor: __imageRadius hook keeps 0 (not ||null)", /window\.__imageRadius = \(renderDoc\.imageRadius != null \? renderDoc\.imageRadius : null\)/.test(e));
  ok("render carries the caption (falls back to alt) on the figure", /var capText = block\.caption \|\| block\.alt \|\| "";\s*if \(capText\) fig\.setAttribute\("data-caption", capText\)/.test(r));
  // runtime: bind fn exists, clones media, wires close, and is called in create (export + demo)
  ok("runtime defines bindImageLightbox cloning media into a shared overlay", /function bindImageLightbox\(root\)[\s\S]*?qsAll\(fig, "img, svg"\)[\s\S]*?cloneNode\(true\)/.test(rt));
  ok("lightbox closes on X/backdrop and Esc", /\[data-lightbox-close\]/.test(rt) && /if \(e\.key === "Escape"\) overlay\.hidden = true/.test(rt));
  ok("create() binds the lightbox (runs in export + demo)", /bindImageLightbox\(root\); \/\/ click-to-zoom/.test(rt));
  ok("runtime stamps is-lightbox-bound so the cursor only shows where clickable", /fig\.classList\.add\("is-lightbox-bound"\)/.test(rt));
  // css: fixed overlay + zoom cursor keyed on the bound class (not the raw authoring canvas)
  ok("css: zoom cursor keyed on .is-lightbox-bound", /\.block-image--zoomable\.is-lightbox-bound \{ cursor: zoom-in; \}/.test(css));
  ok("css: near-fullscreen overlay + contained media", /\.image-lightbox \{[\s\S]*?position: fixed; inset: 0/.test(css) && /\.image-lightbox__media \{[\s\S]*?object-fit: contain/.test(css));
  // editor: caption field + zoom opt-out control
  ok("editor exposes a Caption field", /fieldRow\("Caption", block\.caption/.test(e));
  ok("editor exposes a Click-to-zoom opt-out", /segmentedLive\("Click to zoom"[\s\S]*?block\.noZoom = true/.test(e));
})();

// ---- onboarding tour RETIRED (#215): settings-driven tour fully removed -----
section("onboarding tour retired");
(function () {
  var r = src("src/render.js"), rt = src("src/runtime.js"), css = src("src/course.css"), e = src("src/editor.js"), ex = src("src/export.js");
  // The retired feature is the doc-level onboarding OVERLAY (doc.tour + window.__tour hook +
  // bindTour + .tour-ring/.tour-bubble/.tour-layer + a "Guided tour" settings TAB). The later
  // footer coach-mark tour (block.tour -> data-tour-page/-key, no __tour hook) is a SEPARATE
  // feature and is allowed; guard the specific old markers, not the generic "tour" substring.
  ok("render no longer uses the old __tour overlay hook", r.indexOf("__tour") === -1);
  ok("runtime bindTour removed", rt.indexOf("function bindTour") === -1 && rt.indexOf("bindTour(root)") === -1 && rt.indexOf("bindTour: bindTour") === -1);
  ok("export no longer stamps __tour", ex.indexOf("__tour") === -1);
  ok("editor __tour hooks + buildTourBody removed", e.indexOf("__tour") === -1 && e.indexOf("buildTourBody") === -1);
  ok("no Guided tour settings tab", e.indexOf('key: "tour"') === -1 && e.indexOf('title: "Guided tour"') === -1);
  ok("course.css tour styles removed", css.indexOf(".tour-ring") === -1 && css.indexOf(".tour-bubble") === -1 && css.indexOf(".tour-layer") === -1);
  ok("normalizeDoc strips a stale doc.tour blob", /if \(d\.tour != null\) delete d\.tour;/.test(e));
})();

// ---- confetti on quiz pass (author opt-in) -------------------------------
section("quiz confetti");
(function () {
  var r = src("src/render.js"), qr = src("src/quiz-runtime.js"), e = src("src/editor.js");
  ok("render stamps data-confetti from settings", /root\.setAttribute\("data-confetti", s\.confetti \? "1" : "0"\)/.test(r));
  ok("quiz-runtime reads the confetti flag", /confetti: quiz\.getAttribute\("data-confetti"\) === "1"/.test(qr));
  ok("finish() fires confetti when enabled", /if \(cfg\.confetti\) burstConfetti\(\);/.test(qr));
  ok("confetti is self-contained (canvas) + reduced-motion aware", /function burstConfetti\(\)[\s\S]*?prefers-reduced-motion: reduce[\s\S]*?document\.createElement\("canvas"\)/.test(qr));
  ok("burstConfetti exposed on the API", /burstConfetti: burstConfetti/.test(qr));
  // orange-only palette: no green (#6bbe46) / yellow-gold (#ffcc4d), oranges kept
  ok("confetti palette is orange-only (no green/yellow-gold)", /var colors = \["#f5a623", "#ff7a00", "#e2653b", "#ff9f0a"\];/.test(qr) && qr.indexOf("#6bbe46") === -1 && qr.indexOf("#ffcc4d") === -1);
  ok("editor exposes a Celebrate-on-pass toggle", /switchRow\("Celebrate on pass \(confetti\)", function \(\) \{ return !!s\.confetti; \}/.test(e));
})();

// ---- outliner collapse-all-to-chapters -----------------------------------
section("outliner collapse-all");
(function () {
  var e = src("src/editor.js");
  var html = src("index.html");
  ok("Structure header has a collapse-all button", /id="collapse-tree-btn"/.test(html));
  ok("collapse toggles all chapters + tidies page twirls", /function collapseTreeToChapters\(\)[\s\S]*?groups\.some\(function \(ch\) \{ return openChapters\[ch\.id\] !== false; \}\)[\s\S]*?openChapters\[ch\.id\] = anyOpen \? false : true;/.test(e));
  ok("collapse falls back to page twirls when there are no chapters", /var anyPageOpen = doc\.pages\.some\(function \(p\) \{ return !!openPages\[p\.id\]; \}\)/.test(e));
  ok("collapse button wired + glyphed", /collapseTreeBtn\.innerHTML = Icon\("list-collapse"\)[\s\S]*?addEventListener\("click", collapseTreeToChapters\)/.test(e));
})();

// ---- neon-pink empty placeholders (authoring build aid) ------------------
section("neon-pink empty placeholders");
(function () {
  var css = src("src/course.css");
  // scoped to the authoring canvas (:not([data-env])) so it never ships / never shows in preview
  ok("empty image/embed placeholders glare neon pink on the authoring canvas", /\.course-root:not\(\[data-env\]\) \.block-image--empty,[\s\S]*?\.course-root:not\(\[data-env\]\) \.embed--empty \.embed__iframe \{\s*border: 2px dashed #ff2bd6/.test(css));
  ok("neon-pink text on empty titles/subs/frame", /\.course-root:not\(\[data-env\]\) \.block-frame__empty \{ color: #ff2bd6; \}/.test(css));
  // guarded to authoring-only: the neon pink must NOT appear under a runtime env
  ok("neon pink is NOT applied under data-env=runtime", !/\[data-env="runtime"\][^\n]*#ff2bd6/.test(css));
})();

// ---- Panel System v2: panelLayout engine (Phase 1) -----------------------
section("panel system v2 — layout engine");
(function () {
  var e = src("src/editor.js");
  ok("PanelLayout engine defined (localStorage, editor-chrome)", /window\.PanelLayout = \(function \(\) \{[\s\S]*?var KEY = "verso\.panelLayout"/.test(e));
  ok("8-type taxonomy (Type first)", /var TAXONOMY = \["Type", "Content", "Appearance", "Layout", "Spacing", "Behaviour", "Light\/Dark", "Advanced"\]/.test(e));
  ok("load() self-heals unknown + appends new taxonomy types", /var known = raw\.order\.filter\(function \(t\) \{ return TAXONOMY\.indexOf\(t\) !== -1; \}\);[\s\S]*?TAXONOMY\.forEach\(function \(t\) \{ if \(known\.indexOf\(t\) === -1\) known\.push\(t\); \}\)/.test(e));
  ok("orderSections stable-sorts by global rank", /function orderSections\(sections\)[\s\S]*?\.sort\(function \(a, b\) \{ return a\.r - b\.r \|\| a\.i - b\.i; \}\)/.test(e));
  ok("exposes order/collapse/reset API", /return \{ TAXONOMY: TAXONOMY, load: load, save: save, reset: reset, rank: rank, orderSections: orderSections, isCollapsed: isCollapsed, setCollapsed: setCollapsed, reorder: reorder, move: move \}/.test(e));
  // #164: default-collapse advanced section types. Extract + RUN the PanelLayout IIFE against a
  // fake localStorage so the collapse defaults are exercised, not just pattern-matched.
  (function () {
    var pm = e.match(/window\.PanelLayout = (\(function \(\) \{[\s\S]*?move: move \};\s*\}\)\(\));/);
    ok("#164: PanelLayout IIFE extractable for functional test", !!pm);
    if (!pm) return;
    var fakeLS = (function () { var s = {}; return { getItem: function (k) { return s[k] == null ? null : s[k]; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } }; })();
    var PL = new Function("localStorage", "return " + pm[1] + ";")(fakeLS);
    ok("#164: Light/Dark + Advanced default-collapsed on first paint", PL.isCollapsed("Light/Dark") === true && PL.isCollapsed("Advanced") === true);
    ok("#164: core types (Content/Appearance/Layout) default-open", PL.isCollapsed("Content") === false && PL.isCollapsed("Appearance") === false && PL.isCollapsed("Layout") === false);
    PL.setCollapsed("Light/Dark", false);
    ok("#164: an author's explicit OPEN of a default-collapsed type sticks", PL.isCollapsed("Light/Dark") === false);
    PL.setCollapsed("Appearance", true);
    ok("#164: an author's explicit COLLAPSE of a core type sticks", PL.isCollapsed("Appearance") === true);
    PL.reset();
    ok("#164: reset restores the collapsed defaults", PL.isCollapsed("Light/Dark") === true && PL.isCollapsed("Appearance") === false);
  })();
  // Phase 1b: sectionGroup wrapper + buffer emit in ranked order; edit-mode drag; layout bar
  ok("sectionGroup tags section type + collapse from PanelLayout", /function sectionGroup\(type, title, buildFn\)[\s\S]*?setAttribute\("data-section-type", type\)[\s\S]*?window\.PanelLayout\.isCollapsed\(type\)/.test(e));
  ok("endSections emits in PanelLayout order", /function endSections\(container\)[\s\S]*?window\.PanelLayout\.orderSections\(_sectionBuf\)\.forEach/.test(e));
  ok("collapse toggle persists via setCollapsed", /window\.PanelLayout\.setCollapsed\(type, nowCollapsed\)/.test(e));
  ok("edit-mode wires section drag → PanelLayout.move + re-render", /function wireSectionDrag\(container\)[\s\S]*?window\.PanelLayout\.move\(dragged, order\.indexOf\(target\)\);\s*renderInspector\(\)/.test(e));
  ok("Edit-layout bar only shows on panels with v2 sections (data-section-type)", /function maybeRenderLayoutBar\(\) \{ if \(inspector\.querySelector\("\.insp-section\[data-section-type\]"\)\) renderPanelLayoutBar\(\)/.test(e));
  ok("layout bar has Edit + Reset (reset → PanelLayout.reset)", /reset\.addEventListener\("click", function \(\) \{ window\.PanelLayout\.reset\(\); renderInspector\(\); \}\)/.test(e));
  // Phase 2a: unified colorField (D5) — normalized value + resolver + token/custom/per-mode + recents
  ok("resolveColorField: token→var, per-mode→mode value, else hex", /window\.resolveColorField = function \(v, mode\) \{[\s\S]*?if \(v\.token\) return "var\(--color-" \+ v\.token \+ "\)";[\s\S]*?if \(v\.light \|\| v\.dark\) return \(mode === "dark" \? v\.dark : v\.light\)/.test(e));
  ok("normColorField coerces legacy flat hex → {hex}", /function normColorField\(v\)[\s\S]*?if \(typeof v === "string"\) return isHex\(v\) \? \{ hex: v \} : null;/.test(e));
  ok("colorField opens a 3-tab popover (Token/Custom/Per-mode; Per-mode hidden when noPerMode)", /var TABS = opts\.noPerMode \? \[\["Token", "token"\], \["Custom", "custom"\]\] : \[\["Token", "token"\], \["Custom", "custom"\], \["Per-mode", "per"\]\]/.test(e));
  ok("colorFieldFlat: CSS-string adapter for element colour sites (token→var, hex→hex)", /function colorFieldFlat\(labelText, cssVal, onPick, target, fopts\)[\s\S]*?if \(v\.token\) return onPick\("var\(--color-" \+ v\.token \+ "\)"\);[\s\S]*?if \(v\.hex\) return onPick\(v\.hex\)/.test(e));
  // Phase 3 Batch 1: frame/box appearance migrated to colorFieldFlat
  ok("frame/box Fill+Text+Stroke use colorFieldFlat", /colorFieldFlat\("Fill", box\.fill/.test(e) && /colorFieldFlat\("Text", box\.textColor/.test(e) && /colorFieldFlat\("Stroke colour", box\.borderColor/.test(e));
  // Phase 3 Batches 2-8: 25 element colour sites migrated (block inspectors + nav + header/footer)
  ok("card-reveal + hotspot + nav colour sites use colorFieldFlat", /colorFieldFlat\("Cover colour", block\.coverColor/.test(e) && /colorOpt\("Fill"/.test(e) && /colorFieldFlat\("Pill fill"/.test(e));
  ok("theme-TOKEN editors stay RAW colourControl (define what tokens resolve to; no self-reference)", /colourControl\(t\[1\], themeEdit\(\)\.color\[key\]/.test(e));
  ok("Phase 4: button-style colours migrated to colorFieldFlat (noHistory — theme edits off the doc undo stack)", /colorFieldFlat\("Fill", btn\.bg[\s\S]*?\{ noHistory: true \}\)/.test(e) && /colorFieldFlat\("Hover text", btn\.hoverFg/.test(e));
  ok("SVG colorMap + per-mode card fills stay raw colourControl", /colourControl\("Switch to colour"/.test(e) && /colourControl\("Fill \(dark/.test(e));
  // Phase 5 (D6): Export = primary top-bar button; secondary IO in a ⋯ overflow
  ok("renderToolbarPipeline: primary Export (accent button) + ⋯ overflow into #pipeline-actions", /function renderToolbarPipeline\(\)[\s\S]*?getElementById\("pipeline-actions"\)[\s\S]*?pipelineButtons\.filter\(function \(b\) \{ return b\.accent; \}\)\[0\][\s\S]*?primary\.textContent = "Export"/.test(e));
  ok("overflow menu = non-accent pipeline actions + Publish to Viewer", /pipelineButtons\.filter\(function \(b\) \{ return !b\.accent; \}\)\.forEach[\s\S]*?showContextMenu\(r\.right/.test(e));
  ok("toolbar pipeline stays in sync on registerPipelineButton", /if \(mount\) renderPipelineButtons\(mount\);\s*renderToolbarPipeline\(\)/.test(e));
  // Phase 6 (D7): raw window.prompt/confirm replaced by shared in-app modals
  ok("promptModal + confirmModal route through the DS modal shell (VersoUI.Modal via dsModalShell)", /function dsModalShell\(opts\)[\s\S]*?window\.VersoUI\.Modal\([\s\S]*?function promptModal\(title, label, initial, onOk, subtitle\)[\s\S]*?dsModalShell\(\{[\s\S]*?function confirmModal\(title, message, onOk, opts\)[\s\S]*?dsModalShell\(\{/.test(e));
  ok("modals: Enter submits, Escape closes", /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); primary\.click\(\); \}[\s\S]*?else if \(e\.key === "Escape"\)/.test(e));
  ok("chapter/page/font/style/link/library sites use the modals (not window.prompt/confirm)", /promptModal\("New chapter"/.test(e) && /promptModal\("Rename chapter"/.test(e) && /confirmModal\("Delete page"/.test(e) && /promptModal\("Link"/.test(e) && /confirmModal\("Remove component"/.test(e));
  ok("only the 2-mode import-merge stays raw confirm (semantics don't map to OK/Cancel)", (e.match(/window\.(prompt|confirm)\(/g) || []).length === 1);
  // Phase 7 (D3): the flagship field inspector adopts the sectionGroup taxonomy (Type + Content)
  ok("field inspector wraps a Type section (List folded in) via the panelLayout engine", /beginSections\(\);\s*sectionGroup\("Type", "Type", function \(secBody\)[\s\S]*?typeCluster\(inspector, s, apply[\s\S]*?endSections\(inspector\)/.test(e));
  // #155: the universal Level-1 container sections adopt the sectionGroup taxonomy. renderBlockActionsSection
  // wraps them in beginSections()/endSections(inspector); each is sectionGroup(type,...) not disclosure().
  ok("#155: Appearance is a sectionGroup (was disclosure block-appearance)", /sectionGroup\("Appearance", "Appearance", function \(body\)/.test(e) && !/disclosure\("block-appearance"/.test(e));
  ok("#155: Layout + Spacing are sectionGroups (was disclosure block-layout/spacing)", /sectionGroup\("Layout", "Layout", function \(body\)/.test(e) && /sectionGroup\("Spacing", "Spacing", function \(body\)/.test(e) && !/disclosure\("block-layout"/.test(e) && !/disclosure\("spacing"/.test(e));
  ok("#155/#165: renderBlockActionsSection buffers container sections, self-managing the buffer only when the caller has none", /function renderBlockActionsSection\(block, opts\)[\s\S]*?var ownBuffer = _sectionBuf === null;\s*if \(ownBuffer\) beginSections\(\);\s*sectionGroup\("Layout"[\s\S]*?if \(opts\.appearance !== false\) renderAppearanceSection\(block\);\s*[\s\S]*?if \(ownBuffer\) endSections\(inspector\);/.test(e));
  // #160: the three high-traffic Level-2 content inspectors emit their sections as canonical
  // sectionGroups (Content/Appearance/Behaviour/Layout/Light-Dark), each wrapped in begin/endSections.
  ok("#160 quiz content: Behaviour + Appearance(Colours) + Content(Questions) sectionGroups, no raw sub headers", /function renderQuizInspector\(node\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Behaviour", "Behaviour"[\s\S]*?sectionGroup\("Appearance", "Colours"[\s\S]*?sectionGroup\("Content", "Questions"[\s\S]*?endSections\(inspector\);/.test(e) && !/sub\("Intro page"\)/.test(e) && !/sub\("Questions"\)/.test(e));
  ok("#160 image content: Content/Layout/Appearance/Behaviour/Light-Dark sectionGroups", /function renderImageContent\(block\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Content", "Image"[\s\S]*?sectionGroup\("Layout", "Layout"[\s\S]*?sectionGroup\("Appearance", "Appearance"[\s\S]*?sectionGroup\("Behaviour", "Behaviour"[\s\S]*?sectionGroup\("Light\/Dark", "Light & dark"[\s\S]*?endSections\(inspector\);/.test(e));
  ok("#160 hotspot content: Content(Base/Screen image)/Behaviour(Interaction)/Appearance(Overlay card+Markers)/Content(Screens+Hotspots) sectionGroups", /function renderHotspotInspector\(block\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Content", isEntryScreen \? "Base image" : "Screen image"[\s\S]*?sectionGroup\("Behaviour", "Interaction"[\s\S]*?sectionGroup\("Appearance", "Overlay card"[\s\S]*?sectionGroup\("Appearance", "Markers"[\s\S]*?sectionGroup\("Content", "Screens"[\s\S]*?sectionGroup\("Content", "Hotspots"[\s\S]*?endSections\(inspector\);/.test(e)); // #216: + Screens
  // #161: the remaining Level-2 + single-level inspectors adopt the canonical sectionGroup taxonomy.
  ok("#161 accordion: Behaviour(Display)/Appearance/Content(Sections) sectionGroups", /function renderAccordionInspector\(node\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Behaviour", "Display"[\s\S]*?sectionGroup\("Appearance", "Appearance"[\s\S]*?sectionGroup\("Content", "Sections"[\s\S]*?endSections\(inspector\);/.test(e));
  ok("#161 cardReveal: Behaviour(Reveal)/Layout(Grid)/Appearance/Content(Cards) sectionGroups", /function renderCardRevealInspector\(node\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Behaviour", "Reveal"[\s\S]*?sectionGroup\("Layout", "Grid"[\s\S]*?sectionGroup\("Appearance", "Appearance"[\s\S]*?sectionGroup\("Content", "Cards"[\s\S]*?endSections\(inspector\);/.test(e));
  ok("#161 embed: Content(HTML code)/Layout/Light-Dark/Appearance sectionGroups; loadSource targets secBody", /function renderEmbedInspector\(node\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Content", "HTML code"[\s\S]*?secBody\.appendChild\(codeIn\)[\s\S]*?sectionGroup\("Layout", "Layout"[\s\S]*?sectionGroup\("Light\/Dark", "On light & dark"[\s\S]*?sectionGroup\("Appearance", "Appearance"[\s\S]*?endSections\(inspector\);/.test(e));
  // #165: the shared footer is buffered INTO the nav inspector's open cycle, then flushed once —
  // one PanelLayout-sorted stream (Behaviour after Layout/Spacing), not two independent sorts.
  ok("#161/#165 navButton: Content(Label)/Appearance(Style)/Behaviour(On click) then renderBlockActionsSection buffered, endSections once", /function renderNavButtonInspector\(node\)[\s\S]*?beginSections\(\);[\s\S]*?sectionGroup\("Content", "Label"[\s\S]*?sectionGroup\("Appearance", "Style"[\s\S]*?sectionGroup\("Behaviour", "On click"[\s\S]*?renderBlockActionsSection\(block\);\s*endSections\(inspector\);/.test(e));
  ok("#161 multiSelect batch: one canonical Type sectionGroup", /function renderMultiInspector\(\)[\s\S]*?beginSections\(\);\s*sectionGroup\("Type", "Text — applies to all "[\s\S]*?endSections\(inspector\);/.test(e));
  // RETIRED 2026-07-08 (James): iconField wheel scroll-to-fine-tune removed (accidental value
  // changes while scrolling the panel). Assert the wheel-to-change handler is GONE; the glyph
  // drag-scrub (makeScrubbable) remains the deliberate quick-adjust.
  ok("iconField no longer changes value on wheel (retired)", !/wrap\.addEventListener\("wheel"/.test(e) && /makeScrubbable\(g, i,/.test(e));
  ok("token pane stores {token}; custom stores {hex}+recents; per stores {light,dark}", /doPick\(\{ token: t\[1\] \}\)/.test(e) && /doPick\(\{ hex: hx \}\); colorRecents\(hx\)/.test(e) && /doPick\(\{ light: lightV, dark: darkV \}\)/.test(e));
  ok("colorField pushes undo history once per open (debounced; skipped when noHistory)", /function doPick\(v\) \{ if \(!pushed\) \{ if \(!opts\.noHistory\) \{ try \{ pushHistory\(\); \} catch \(e\) \{\} \} pushed = true; \} onPick\(v\); \}/.test(e));
  ok("colorField has eyedropper (reuses eyeDropperAvailable/pickScreenColor)", /if \(eyeDropperAvailable\(\)\) \{ var ed[\s\S]*?pickScreenColor\(\)/.test(e));
  ok("recents persisted to localStorage (max 8)", /function colorRecents\(add\)[\s\S]*?verso\.colorRecents[\s\S]*?\.slice\(0, 8\)/.test(e));
  // Phase 2b: the reusable typeCluster (D4) — one Type control body writing to a model
  ok("typeCluster renders font(buildFontPicker) + colorField + type controls", /function typeCluster\(container, model, onChange, opts\)[\s\S]*?buildFontPicker\(model\.font[\s\S]*?colorField\("Colour", tcVal\(\)/.test(e));
  ok("typeCluster colour adapter maps token/hex/per-mode onto the model", /if \(v && v\.token\) model\.colorToken = v\.token;[\s\S]*?else if \(v && \(v\.light \|\| v\.dark\)\) \{ model\.colorLight = v\.light; model\.colorDark = v\.dark; \}[\s\S]*?else if \(v && v\.hex\) model\.color = v\.hex;/.test(e));
  ok("typeCluster has size/weight/leading/tracking/word-sp/indent/case/justify-align", /model\.size = isNaN[\s\S]*?model\.weight = weight[\s\S]*?model\.lineHeight[\s\S]*?model\.letterSpacing[\s\S]*?model\.wordSpacing[\s\S]*?model\.textIndent[\s\S]*?model\.textTransform[\s\S]*?Icon\("align-justify"\), "justify"/.test(e));
  // Phase 2c: the SAME typeCluster mounted in BOTH the field inspector and the style dialog
  ok("field inspector mounts typeCluster (reference adopter)", /typeCluster\(inspector, s, apply/.test(e));
  ok("Edit-Text-Style dialog mounts the SAME typeCluster", /typeCluster\(box, draft, syncSpecimen\)/.test(e));
  ok("field inspector no longer hand-rolls a colour row (colorField via typeCluster)", !/colourControl\("Colour", s\.color/.test(e));
  ok("dialog persists per-mode text colour (forward-compat)", /else if \(draft\.colorLight \|\| draft\.colorDark\) \{ s\.colorLight = draft\.colorLight; s\.colorDark = draft\.colorDark;/.test(e));
})();
// ---- "Exit course" DO-action (SCORM LMS exit) ----------------------------
// A navButton with action.exit ends the SCORM session instead of navigating.
// Single-source chain: render emits data-nav-action="exit"; the runtime engine
// routes it (delegated handler + runAction) to onExit; default onExit ends the
// SCORM session (window.SCORM.quit -> LMSFinish). Authoring exposes it as the
// last option of the "On click" dropdown. Demo overrides onExit (no real exit).
section("exit-course action");
(function () {
  var r = src("src/render.js"), rt = src("src/runtime.js"), e = src("src/editor.js");
  // render: exit -> data-nav-action="exit" (NOT data-goto), href stays "#"
  var nb = slice(r, "navButton: function (block) {", "modeToggle: function (block) {");
  ok("render: action.exit -> data-nav-action=exit", /if \(act\.exit\)[\s\S]{0,120}setAttribute\("data-nav-action", "exit"\)/.test(nb));
  ok("render: exit branch sets no data-goto", nb.indexOf('setAttribute("data-nav-action", "exit")') < nb.indexOf('setAttribute("data-goto", goto)'));
  // runtime: opt + runAction case + delegated [data-nav-action] routing + default
  ok("runtime: onExit opt defaults to defaultExit", /var onExit = opts\.onExit \|\| defaultExit;/.test(rt));
  ok("runtime: runAction has an exit case -> onExit()", /case "exit": onExit\(\); break;/.test(rt));
  ok("runtime: delegated [data-nav-action] routes exit", /if \(act === "exit"\) \{ runAction\(\{ type: "exit" \}\); e\.preventDefault\(\); return; \}/.test(rt));
  ok("runtime: defaultExit ends the SCORM session with a logout exit", /function defaultExit\(\)[\s\S]{0,320}window\.SCORM\.quit\("logout"\)/.test(rt));
  // scorm-api: quit forwards the exit reason to cmi.core.exit ("logout" returns the
  // learner in Moodle; "" for an incidental unload). Empty/normal exit left the SCO open.
  var sa = src("export/scorm-api.js");
  ok("scorm-api: quit(exitType) sets cmi.core.exit from the arg", /function quit\(exitType\)[\s\S]{0,200}set\("cmi\.core\.exit", exitType \|\| ""\)/.test(sa));
  // authoring: Exit option in the On-click dropdown + non-destructive demo override
  ok("editor: EXIT_ACTION sentinel + setExitAction writes action.exit", /var EXIT_ACTION = "__exit";/.test(e) && /function setExitAction\(host\) \{ pushHistory\(\); host\.action = \{ exit: true \}; \}/.test(e));
  ok("editor: On-click dropdown offers Exit course", /\["Exit course \(end SCORM session\)", EXIT_ACTION\]/.test(e));
  ok("editor: demo passes a non-destructive onExit (#111 splash preview, no real SCORM/close)", /onExit: function \(\) \{ previewEndScreen\(\); \}/.test(e) && /function previewEndScreen\(\)[\s\S]{0,400}flashDemoNotice\(/.test(e));
  // Interact-mode action picker (the "On click -> Do" list): exit is an option + targetless
  ok("editor: Interact ACTION_TYPES includes Exit course", /var ACTION_TYPES = \[[\s\S]*?\["Exit course", "exit"\][\s\S]*?\];/.test(e));
  ok("editor: exit is targetless (NAV_ACTIONS -> no target picker)", /var NAV_ACTIONS = \{ next: 1, prev: 1, exit: 1 \};/.test(e));
})();

// ---- Interact-mode contextual connectors ---------------------------------
// Connectors are contextual to the selection by default: only links touching the
// selected component(s) draw, unless "Show all connections" is on. Redrawn on
// every selection change via refreshCanvasSelection (interact-mode only).
section("interact contextual connectors");
(function () {
  var e = src("src/editor.js");
  ok("showAllConnectors state defaults OFF + persisted", /var showAllConnectors = false;/.test(e) && /var SHOW_ALL_CONNECTORS_KEY = "authoring\.showAllConnectors";/.test(e) && /showAllConnectors = localStorage\.getItem\(SHOW_ALL_CONNECTORS_KEY\) === "1"/.test(e));
  ok("drawConnectors has a blockInSelection helper (single + multi)", /function blockInSelection\(b\)[\s\S]{0,220}multiSel\.indexOf\(b\) !== -1/.test(e));
  ok("action-links skip non-selected links unless Show all", /if \(!showAllConnectors && !\(selection\.node === lk\.elm \|\| blockInSelection\(lk\.block\)\)\) return;/.test(e));
  ok("gate-links skip unless gated/source selected or Show all", /if \(!showAllConnectors && !gatedSel && !srcSel\) return;/.test(e));
  ok("connectors redraw on selection change (refreshCanvasSelection, interact-only)", /function refreshCanvasSelection\(\)[\s\S]*?if \(interactMode\) drawConnectors\(\);\s*\}/.test(e));
  ok("Interact inspector exposes a Show all connections toggle", /switchRow\("Show all connections", function \(\) \{ return showAllConnectors; \}/.test(e));
})();

// ---- per-hotspot popover-card size ---------------------------------------
// Each hotspot may override the block-level "Card width" with its own width, and
// set a card min-height. Blank inherits the block default. Ships in SCORM.
section("hotspot per-card size");
(function () {
  var e = src("src/editor.js");
  var r = src("src/render.js");
  ok("render: per-hotspot cardW -> width, cardH -> min-height (after applyPopoverStyle)", /applyPopoverStyle\(pop, block\.cardStyle\);[\s\S]{0,300}if \(hs\.cardW\) pop\.style\.width = hs\.cardW \+ "px";[\s\S]{0,120}if \(hs\.cardH\) pop\.style\.minHeight = hs\.cardH \+ "px";/.test(r));
  ok("editor: Selected-hotspot section adds per-card Width + Height (popover mode only)", /iconField\("W", \{ value: active\.cardW[\s\S]{0,200}delete active\.cardW; else active\.cardW = n;/.test(e) && /iconField\("H", \{ value: active\.cardH[\s\S]{0,200}delete active\.cardH; else active\.cardH = n;/.test(e));
  ok("editor: per-card size guarded to card markers (#215 action !== 'navigate')", /if \(active\.action !== "navigate"\) \{\s*\/\/ Per-hotspot popover-card size\./.test(e));
  // centre-overlay placement: card centred on the image, arrow hidden, X/outside/Esc close
  var rt = src("src/runtime.js");
  var css = src("src/course.css");
  ok("runtime: place='center' centres the card in the stage + data-side=center (no arrow anchor)", /if \(place === "center"\) \{[\s\S]{0,200}left = \(sw - pw\) \/ 2;[\s\S]{0,120}top = \(sh - ph\) \/ 2;[\s\S]{0,260}pop\.setAttribute\("data-side", "center"\);/.test(rt));
  ok("css: centre overlay hides the pointer arrow", /\.hotspot-popover\[data-side="center"\]::after \{ display: none; \}/.test(css));
  ok("editor: placement segmented offers Centre -> 'center'", /\["Centre", "center"\]/.test(e));
  // drag/paste INTO the popover card: hotspots[].blocks must be a first-class child
  // list in every tree walker + the insert-location resolver (else drops/paste no-op
  // or land at page bottom). Mirrors the accordion/cardReveal items[].children fix.
  ok("editor: walkPageBlocks descends hotspot card blocks (#215 screens[].markers[].blocks)", /hotspotCardArrays\(b\)\.forEach\(function \(arr\) \{ walkPageBlocks\(arr, fn\); \}\);/.test(e));
  ok("editor: findBlockParent resolves hotspot card-block children (#215)", /var hArrs = hotspotCardArrays\(b\);[\s\S]{0,160}findBlockParent\(hArrs\[hz\], targetBlock\)/.test(e));
  ok("editor: remintIds descends hotspot card blocks (#215)", /if \(Array\.isArray\(node\.screens\)\) node\.screens\.forEach\(function \(s\) \{\s*\n\s*if \(s && Array\.isArray\(s\.markers\)\) s\.markers\.forEach\(function \(m\) \{ if \(m && Array\.isArray\(m\.blocks\)\) m\.blocks\.forEach\(remintIds\); \}\);/.test(e));
  ok("editor: insertLoc resolves the selected block's own container via findBlockParent", /function insertLoc\(\) \{[\s\S]{0,200}var loc = findBlockParent\(page\.blocks, selection\.block\);[\s\S]{0,120}return \{ array: loc\.parentArray, index: loc\.index \+ 1 \};/.test(e));
  ok("editor: insertBlock + pasteClipboard use insertLoc (not top-level-only)", /var L = insertLoc\(\);\s*L\.array\.splice\(L\.index, 0, block\);/.test(e) && /var L = insertLoc\(\);[\s\S]{0,260}L\.array\.splice\(L\.index \+ i, 0, c\);/.test(e));
  ok("render: walkBlocks descends hotspot card blocks (#215 screens[].markers[].blocks)", /if \(Array\.isArray\(b\.screens\)\) b\.screens\.forEach\(function \(s\) \{ if \(s && Array\.isArray\(s\.markers\)\) s\.markers\.forEach\(function \(m\) \{ if \(m && Array\.isArray\(m\.blocks\)\) walkBlocks\(m\.blocks, fn\); \}\); \}\);/.test(r));
  // the old inPopover exclusion (children not drop targets / not draggable) is GONE
  // — popover cards are full editing containers now.
  ok("editor: popover children are unconditionally drop targets (no inPopover skip)", !/inPopover/.test(e) && /Hotspot popover-card content is a FULL editing container/.test(e));
  // the open card must survive edits: mount re-reveals it when the selection/paste
  // lands inside a card, and delete reselects the owning hotspot block.
  ok("editor: mount() re-reveals an open hotspot card (keepHotspotCardOpen)", /requestAnimationFrame\(keepHotspotCardOpen\);/.test(e) && /function keepHotspotCardOpen\(\)[\s\S]{0,400}hotspotOwnerOf\(candidates\[i\]\)[\s\S]{0,320}revealHotspot\(canvasNodeForBlock\(owner\.block\), owner\.block, owner\.hs\.id\);/.test(e));
  ok("editor: hotspotOwnerOf resolves the card a block lives in (#215 marker)", /function hotspotOwnerOf\(target\)[\s\S]{0,420}Array\.isArray\(b\.screens\)[\s\S]{0,560}found = \{ block: b, hs: m \};/.test(e));
  ok("editor: deleting a card child keeps the card open (reselect owner hotspot block)", /var hsOwner = hotspotOwnerOf\(block\);[\s\S]{0,520}if \(hsOwner\) \{ hotspotEditId = hsOwner\.hs\.id; clearSelection\(\); mount\(\); reselectBlockNode\(hsOwner\.block, "block"\); \}/.test(e));
  // PERF: a plain (non-hotspot) block delete rebuilds only its page, not the world.
  ok("editor: plain block delete uses reapplyStructural(pi), not mount", /else \{ clearSelection\(\); reapplyStructural\(pi\); \}/.test(e));
})();

// ---- FR: Find & replace pure core + variant routing ----------------------
section("FR find/replace");
(function () {
  var e = src("src/editor.js");
  var a = e.indexOf("/* @fr-start */"), b = e.indexOf("/* @fr-end */");
  if (a < 0 || b < 0) { ok("locate @fr fence", false); return; }
  var body = e.slice(a, b);
  var fr = new Function(body +
    "\nreturn { count: frCount, replaceAll: frReplaceAll, targets: frTargets, valueOf: frValueOf, write: frWrite, total: frTotal, next: frNext, words: frWords };")();

  // #78: word count strips inline HTML + folds entities, counts whitespace runs
  ok("words counts plain copy", fr.words("A drone is a drone.") === 5);
  ok("words strips inline HTML tags", fr.words("<li>one</li><li>two three</li>") === 3);
  ok("words treats &nbsp; as a break, glues other entities", fr.words("a&nbsp;b R&amp;D") === 3);
  ok("words is 0 for empty/whitespace/null", fr.words("") === 0 && fr.words("   \n\t ") === 0 && fr.words(null) === 0);
  // total-copy word sum over frTargets (the F&R metric's synchronous half)
  ok("words sums across every doc target", (function () {
    var d = mkDoc();
    return fr.targets(d, null).reduce(function (n, t) { return n + fr.words(fr.valueOf(t, null)); }, 0) === 15;
  })());
  // #90: Find & Replace enumerates + edits table cell copy (each cell is a { t } field)
  (function () {
    var td = { pages: [{ id: "p0", blocks: [{ type: "table", rows: [[{ t: "one two" }, { t: "three" }], [{ t: "four" }, { t: "" }]] }] }] };
    var cellTargets = fr.targets(td, null).filter(function (t) { return t.key === "t"; });
    ok("F&R enumerates every non-empty is fine; all cells surfaced", cellTargets.length === 4 && cellTargets.every(function (t) { return t.host && typeof t.host.t === "string"; }));
    ok("F&R counts words across table cells", cellTargets.reduce(function (n, t) { return n + fr.words(fr.valueOf(t, null)); }, 0) === 4);
    // a replace routes into the exact cell object
    var target = cellTargets[0];
    fr.write(target, null, fr.replaceAll(fr.valueOf(target, null), "two", "2"));
    ok("F&R replace edits the cell in place", td.pages[0].blocks[0].rows[0][0].t === "one 2");
  })();

  // case-SENSITIVE, EXACT count + replace
  ok("count is case-sensitive", fr.count("Drone drone drone", "drone") === 2);
  ok("count empty needle -> 0", fr.count("abc", "") === 0);
  ok("replaceAll case-sensitive", fr.replaceAll("A drone is a drone.", "drone", "UAV") === "A UAV is a UAV.");
  ok("replaceAll leaves capitalised untouched", fr.replaceAll("Drone drone", "drone", "x") === "Drone x");

  function mkDoc() {
    return { variants: ["V1"], pages: [{ blocks: [
      { type: "heading", text: "Drone threat" },
      { type: "paragraph", text: "A drone is a drone." },
      { type: "componentGrid", instances: [{ slots: { title: "Drone card", body: "info" } }] },
      { type: "quiz", title: "Quiz", questions: [{ prompt: "Which drone?", options: [{ text: "drone A" }] }] }
    ] }] };
  }

  // enumeration: flagship sees everything; a variant sees ONLY overridable targets
  var docF = mkDoc();
  var flag = fr.targets(docF, null);
  var vary = fr.targets(docF, "V1");
  ok("flagship enumerates all 7 copy fields", flag.length === 7);
  ok("variant enumerates only the 5 overridable fields", vary.length === 5);
  ok("variant EXCLUDES nested quiz prompt/option copy", vary.every(function (t) { return t.overridable; }) && flag.some(function (t) { return !t.overridable; }));

  function paraTarget(ts) { return ts.filter(function (t) { return t.host.type === "paragraph" && t.key === "text"; })[0]; }

  // flagship replace edits the BASE, no overrides created
  var d1 = mkDoc(); var t1 = paraTarget(fr.targets(d1, null));
  fr.write(t1, null, fr.replaceAll(fr.valueOf(t1, null), "drone", "UAV"));
  ok("flagship write edits base copy", d1.pages[0].blocks[1].text === "A UAV is a UAV.");
  ok("flagship write creates NO overrides", !d1.pages[0].blocks[1].overrides);

  // variant replace writes an OVERRIDE and leaves the base (Flagship) untouched
  var d2 = mkDoc(); var t2 = paraTarget(fr.targets(d2, "V1"));
  ok("variant reads the inherited base value", fr.valueOf(t2, "V1") === "A drone is a drone.");
  fr.write(t2, "V1", fr.replaceAll(fr.valueOf(t2, "V1"), "drone", "UAV"));
  ok("variant write does NOT touch base copy", d2.pages[0].blocks[1].text === "A drone is a drone.");
  ok("variant write stores block.overrides[V1].text", d2.pages[0].blocks[1].overrides && d2.pages[0].blocks[1].overrides.V1.text === "A UAV is a UAV.");
  ok("variant valueOf now returns the override", fr.valueOf(t2, "V1") === "A UAV is a UAV.");

  // instance slot override routes through overrides[v].slots
  var d3 = mkDoc(); var slotT = fr.targets(d3, "V1").filter(function (t) { return t.isSlot && t.key === "title"; })[0];
  fr.write(slotT, "V1", "UAV card");
  ok("variant slot write -> instance.overrides[V1].slots.title", d3.pages[0].blocks[2].instances[0].overrides.V1.slots.title === "UAV card");
  ok("variant slot write leaves the base slot intact", d3.pages[0].blocks[2].instances[0].slots.title === "Drone card");

  // total + next (ordered, with the paragraph carrying the first hit at offset 2)
  var d4 = mkDoc(); var ts4 = fr.targets(d4, null);
  ok("total counts every occurrence (2 para + prompt + option)", fr.total(ts4, null, "drone") === 4);
  var nx = fr.next(ts4, null, "drone", { tIndex: 0, pos: 0 });
  ok("next finds the paragraph's first hit", nx && ts4[nx.tIndex].host.type === "paragraph" && nx.start === 2);
})();

// ---- PERF: block edits rebuild one page, not the whole world -------------
section("PERF one-page re-render");
(function () {
  var e = src("src/editor.js");
  ok("reapplyStructural = reapplyPage + cheap chrome (no all-pages rebuild)",
    /function reapplyStructural\(pi\) \{[\s\S]{0,220}if \(!ok \|\| isPreview\(\)\) \{ mount\(\); return; \}[\s\S]{0,120}reapplyPage\(i\);[\s\S]{0,600}renderStructure\(\);[\s\S]{0,60}renderModelView\(\);[\s\S]{0,60}renderCommentPins\(\);/.test(e));
  ok("reapplyStructural accepts one index OR an array (drag = source+dest pages)", /var list = Array\.isArray\(pi\) \? pi : \[pi\];/.test(e));
  ok("undo/redo restore reapplies only the changed pages (isolatedPageChanges), full mount otherwise", /function isolatedPageChanges\(prev, next\)[\s\S]{0,400}return null;[\s\S]{0,400}changed\.push\(j\)/.test(e) && /function restoreSnapshot\(next\)[\s\S]{0,220}reapplyStructural\(changed\)/.test(e));
  ok("handleDrop rebuilds source+dest pages, not the world", /var destPi = findPageOfBlock\(draggedBlock\);[\s\S]{0,320}reapplyStructural\(affected\.length \? affected : -1\);/.test(e));
  // #171: deletePage re-anchors the viewport by page IDENTITY (keepId -> pageIndexById),
  // so deleting a page BEFORE the active one no longer jumps the view to a random page.
  ok("deletePage #171 re-anchors by page identity, not raw index", /var keepId = pi === currentPage[\s\S]{0,200}doc\.pages\.splice\(pi, 1\);\s*var ni = keepId \? pageIndexById\(keepId\) : -1;\s*currentPage = ni >= 0 \? ni : Math\.min\(currentPage, doc\.pages\.length - 1\);/.test(e));
  ok("duplicateBlock + moveBlock rebuild one page", /reapplyStructural\(pi\); \/\/ PERF: one page/.test(e));
  ok("insertBlock rebuilds only the block's page", /L\.array\.splice\(L\.index, 0, block\);\s*reapplyStructural\(findPageOfBlock\(block\)\);/.test(e));
  ok("pasteClipboard rebuilds only the paste page", /reapplyStructural\(findPageOfBlock\(news\[0\]\)\); return true;/.test(e));
  ok("image max-width edit uses reapplyBlock (not mount)", /block\.maxWidth = n; reapplyBlock\(block\); reselectBlockNode/.test(e));
  ok("image light/dark contrast toggle uses reapplyBlock (not mount)", /delete block\.autoTint; \/\/ auto\s*reapplyBlock\(block\); reselectBlockNode\(block, "block"\);/.test(e));
})();

// ---- UI kit gallery seam ----------------------
section("UI kit seam");
(function () {
  var e = src("src/editor.js");
  // window.__kit exposes the canonical primitives so kit.html renders from real source.
  ok("editor.js exposes window.__kit", /window\.__kit\s*=\s*\{/.test(e));
  ["Icon", "iconField", "colourControl", "colorField", "segmentedLive", "switchRow",
   "subDisclosure", "customSelectRow", "twoUp", "fieldRow"].forEach(function (name) {
    ok("__kit exposes " + name, new RegExp("window\\.__kit[\\s\\S]{0,900}\\b" + name + "\\s*:").test(e));
  });
  // The boot is gated so kit mode defines primitives without booting the editor.
  ok("editor boot gated by !__KIT_MODE", /if \(!window\.__KIT_MODE\) \{[\s\S]{0,80}loadTheme\(\);/.test(e));
  // Regression (HTML-embed colours reverting on hard reload): boot MUST push the theme
  // into embed iframes after the initial mount — reapplyTheme is the only boot-reachable
  // caller of pushEmbedTheme (+ binds the theme-shim-ready re-push for late iframes).
  // Without it a fresh load leaves each interaction on its own default palette, so an
  // author's block.embedColorMap never applies until the mode toggle fires.
  ok("boot pushes theme into embeds (reapplyTheme after boot mount)", /\bmount\(\);[\s\S]{0,900}\breapplyTheme\(\);/.test(e) && /function reapplyTheme[\s\S]{0,600}pushEmbedTheme\(canvas/.test(e));
  // Regression (same family): entering PREVIEW / navigating in demo rebuilds fresh embed
  // iframes; renderDemo must push the theme (tokens + embedColorMap) into demoDevice or
  // the interaction shows its own default palette (colours "change" on entering preview).
  ok("renderDemo pushes theme into preview embeds", /fitEmbedsIn\(demoDevice\); renderCommentPins\(\);[\s\S]{0,160}pushEmbedTheme\(demoDevice, activeMode, activeTheme\(\)\.color\)/.test(e));
  ok("pushHistory no-ops with no doc (kit / pre-boot)", /function pushHistory\(\) \{\s*if \(doc == null\) return;/.test(e));
  ok("renderInspector no-ops in kit mode (gallery owns #inspector)", /function renderInspector\(\) \{\s*if \(window\.__KIT_MODE\) return;/.test(e));
  // The gallery files exist and pull from the real primitives.
  var html = "", gal = "";
  try { html = src("kit.html"); } catch (_) {}
  try { gal = src("kit-gallery.js"); } catch (_) {}
  ok("kit.html exists + sets __KIT_MODE before editor.js", /window\.__KIT_MODE\s*=\s*true/.test(html) && /src\/editor\.js/.test(html));
  ok("kit.html hosts the gallery in #inspector", /id="inspector"/.test(html));
  ok("kit-gallery.js renders from window.__kit (not copied markup)", /window\.__kit/.test(gal) && /K\.Icon/.test(gal));

  // Ticket 2 — collapsed-optional row primitive.
  ok("optionalRow primitive defined", /function optionalRow\(host, title, opts\) \{/.test(e));
  ok("optionalRow OFF = greyed row + add that enables + repaints", /opt-sec__off[\s\S]{0,700}opts\.set\(true\); paint\(\);/.test(e));
  ok("optionalRow ON = header + remove that disables + repaints", /opt-sec__remove[\s\S]{0,600}opts\.set\(false\); paint\(\);/.test(e));
  ok("optionalRow repaints in place (no mount/renderInspector)", /function optionalRow[\s\S]{0,1200}\}/.test(e) && !/function optionalRow[\s\S]{0,1200}(mount\(\)|renderInspector\(\))/.test(e));
  ok("__kit exposes optionalRow", /window\.__kit[\s\S]{0,900}\boptionalRow\s*:/.test(e));
  ok("kit-gallery demos optionalRow (collapsed + expanded)", /K\.optionalRow\(/.test(gal));

  // Ticket 3 — repeated-item row primitive.
  ok("repeatedList primitive defined", /function repeatedList\(host, title, opts\) \{/.test(e));
  ok("repeatedList row = grip + full-width field + trash (reuses iconBtn)", /rep-row__grip[\s\S]{0,1600}rep-row__field[\s\S]{0,800}iconBtn\("trash"/.test(e));
  ok("repeatedList + above adds via propHeader", /propHeader\(title, function \(\) \{ commit\(function \(\) \{ opts\.add\(\); \}\); \}/.test(e));
  ok("repeatedList grip drag reorders via opts.move", /dragstart[\s\S]{0,1000}drop[\s\S]{0,300}opts\.move\(from, i\)/.test(e));
  ok("repeatedList trash removes via opts.remove", /iconBtn\("trash"[\s\S]{0,200}opts\.remove\(i\)/.test(e));
  ok("repeatedList field edit is live, no repaint (keeps focus)", /field\.addEventListener\("change", function \(\) \{ if \(!opts\.noHistory\) pushHistory\(\); opts\.setValue\(item, field\.value\);/.test(e));
  ok("grip glyph is canonical (Lucide grip-vertical via ICON_ALIAS, not inline one-off)", /grip: "grip-vertical"/.test(e) && /"grip-vertical":/.test(src("src/icons.js")));
  ok("__kit exposes repeatedList", /window\.__kit[\s\S]{0,900}\brepeatedList\s*:/.test(e));
  ok("kit-gallery demos repeatedList", /K\.repeatedList\(/.test(gal));

  // Ticket 4 — renderContainerChrome (invariant Block-level chrome).
  ok("renderContainerChrome defined", /function renderContainerChrome\(host, decl, io, handlers\) \{/.test(e));
  ok("container row order is fixed + declared", /var CONTAINER_ROW_ORDER = \["align", "width", "padding", "gap", "fill", "stroke", "radius", "spacing", "actions"\]/.test(e));
  ok("chrome uses collapsed-optional fill/stroke + iconField dims + iconBtn actions", /optionalRow\(ap, "Fill"[\s\S]{0,1200}optionalRow\(ap, "Stroke"[\s\S]{0,2600}iconBtn\(a\[0\], a\[1\], a\[3\]\)/.test(e));
  ok("chrome hides omitted rows behind want() (never reorders)", /function want\(k, def\) \{ return decl\[k\] === undefined \? def : !!decl\[k\]; \}/.test(e));
  ok("colourControl omits an empty label (single-line appearance)", /if \(labelText\) host\.appendChild\(h\("div", "insp-row__label insp-row__label--stacked", labelText\)\);/.test(e));
  ok("__kit exposes renderContainerChrome", /window\.__kit[\s\S]{0,900}\brenderContainerChrome\s*:/.test(e));
  ok("kit-gallery demos renderContainerChrome (full frame + minimal spacer)", (gal.match(/K\.renderContainerChrome\(/g) || []).length >= 2);

  // ---- issue #14 (parent #22): Inspector re-skin to the DS mockup -----------
  // The two-level inspector's shared chrome + breadcrumb now build from the
  // canonical VersoUI controls (PanelSection / FieldRow / SegmentedControl /
  // Breadcrumb), matching design-system/ui_kits/editor/Inspector.jsx. Re-skin
  // only — the io.get/set + pushHistory + optionalRow wiring is unchanged.
  ok("#14: panelSection helper delegates to VersoUI.PanelSection (returns the section body)",
     /function panelSection\(host, title, opts\)[\s\S]{0,400}window\.VersoUI\.PanelSection\(\{ title: title[\s\S]{0,220}sec\.querySelector\("\.insp-section__body"\)/.test(e));
  ok("#14: alignSeg builds a DS FieldRow + VersoUI.SegmentedControl (inline-labelled align)",
     /function alignSeg\(label, current, options, onPick\)[\s\S]{0,260}window\.VersoUI\.SegmentedControl\(\{[\s\S]{0,180}window\.VersoUI\.FieldRow\(\{ label: label/.test(e));
  ok("#14: container chrome emits sections via panelSection (not the flat sub/insp-sub header)",
     /function section\(title, opts\) \{[\s\S]{0,220}return panelSection\(host, title, opts\)/.test(e) && !/function sectionHead\(/.test(e));
  ok("#14: container chrome Position uses alignSeg for horizontal + vertical",
     /var pos = section\("Position"\)[\s\S]{0,600}alignSeg\("Horizontal"[\s\S]{0,600}alignSeg\("Vertical"/.test(e));
  ok("#14: container chrome hosts Layout/Appearance rows into section bodies; Actions render into the canvas overlay bar",
     /var lay = section\("Layout"\)/.test(e) && /var ap = section\("Appearance"\)/.test(e) && /if \(want\("actions", true\)\) \{\s*var bar = ensureBlockToolbar\(\)/.test(e));
  // Split-page (+ move/duplicate/delete) reinstated onto the canvas overlay bar after the
  // left-rail/top-bar reorg dropped them: ensureBlockToolbar mounts a contextual segment
  // inside #canvas-overlay, and the container-chrome Actions build the split button there.
  ok("block actions mount into the canvas overlay bar segment",
     /function ensureBlockToolbar\(\) \{[\s\S]{0,320}canvas-overlay-bar__inner[\s\S]{0,240}"canvas-overlay-bar__actions"/.test(e));
  ok("split page action is built into the canvas bar (not a panel section)",
     /if \(typeof handlers\.split === "function"\) acts\.push\(\["slice", "Split page here", handlers\.split/.test(e) &&
     /acts\.forEach\(function \(a\) \{[\s\S]{0,180}bar\.appendChild\(btn\)/.test(e));
  ok("#14: layer breadcrumb routes through the canonical VersoUI.Breadcrumb",
     /if \(window\.VersoUI && window\.VersoUI\.Breadcrumb\) \{[\s\S]{0,320}window\.VersoUI\.Breadcrumb\(\{ items: items \}\)/.test(e));
  ok("#14: DS PanelSection wrappers stay OUT of the PanelLayout drag set (no data-section-type)",
     /inspector\.querySelector\("\.insp-section\[data-section-type\]"\)/.test(e));
  ok("chrome not yet wired into a real block inspector (no user-visible change)", !/render(Block|Field|Instance|Embed|NavButton|Page)Inspector[\s\S]{0,4000}renderContainerChrome\(/.test(e));
  // P0 code-review fixes.
  ok("plus/minus glyphs are canonical Lucide (icons.js, not inline one-offs)", /"plus":/.test(src("src/icons.js")) && /"minus":/.test(src("src/icons.js")));
  ok("propHeader/optionalRow reuse Icon(\"plus\") / Icon(\"minus\") (no inline glyph)", /add\.innerHTML = Icon\("plus"\)/.test(e) && /rm\.innerHTML = Icon\("minus"\)/.test(e));
  ok("CONTAINER_IO_KEYS io contract defined + exposed", /var CONTAINER_IO_KEYS = \["align", "width", "padX"/.test(e) && /window\.__kit[\s\S]{0,900}\bCONTAINER_IO_KEYS\s*:/.test(e));
  ok("kit-gallery shows the Icon glyph set", /K\.Icon\.names\(\)/.test(gal));

  // Ticket 5 (foundation) — inspector breadcrumb.
  ok("breadcrumb primitive defined", /function breadcrumb\(host, trail, onNavigate\) \{/.test(e));
  ok("breadcrumb last crumb = current (non-button), others navigate", /insp-crumbs__cur[\s\S]{0,300}insp-crumbs__crumb[\s\S]{0,200}onNavigate\(level\)/.test(e));
  ok("breadcrumb separator uses canonical Icon(\"chevron-right\") (not inline)", /insp-crumbs__sep[\s\S]{0,160}Icon\("chevron-right"\)/.test(e) && /"chevron-right":/.test(src("src/icons.js")));
  ok("__kit exposes breadcrumb", /window\.__kit[\s\S]{0,900}\bbreadcrumb\s*:/.test(e));
  ok("kit-gallery demos breadcrumb", /K\.breadcrumb\(/.test(gal));

  // Tickets 5-6 — two-level inspector: a generic shell, proven on hotspots + sequence.
  ok("generic two-level shell defined (renderBlockTwoLevel)", /function renderBlockTwoLevel\(node, label, decl, renderContent, io, handlers\) \{/.test(e));
  ok("hotspot + sequence dispatched to the two-level shell (#160: hotspot depth-pure)", /renderBlockTwoLevel\(node, "Image hotspots", CONTENT_PURE_DECL/.test(e) && /renderBlockTwoLevel\(node, "Sequence", CONTENT_DECL, renderSequenceInspector\)/.test(e));
  ok("shell: crumbs, container chrome (actions-only at content level for a pureContent block), then specific content when entered (#160 depth-pure)",
    /renderLayerCrumbs\(block, label\);[\s\S]{0,400}var chromeDecl = \(atContent && decl && decl\.pureContent\) \? ACTIONS_ONLY_DECL : decl;\s*renderContainerChrome\(inspector, chromeDecl[\s\S]{0,200}if \(atContent\) \{\s*renderContent\(node\);[\s\S]{0,200}Edit " \+ \(label/.test(e));
  // #160: the depth-pure decls + actions-only swap exist.
  ok("#160 depth-pure decls (CONTENT_PURE_DECL / IMAGE_PURE_DECL / ACTIONS_ONLY_DECL)", /var CONTENT_PURE_DECL = \{ fill: false, stroke: false, radius: false, pureContent: true \};/.test(e) && /var IMAGE_PURE_DECL = \{ fill: false, stroke: true, radius: false, pureContent: true \};/.test(e) && /var ACTIONS_ONLY_DECL = \{ align: false, valign: false, width: false, padding: false, gap: false, spacing: false, fill: false, stroke: false, radius: false, actions: true \};/.test(e));
  ok("layer breadcrumb: page + container ancestry, each crumb selects that layer", /function blockAncestry\(block\)/.test(e) && /function renderLayerCrumbs\(block, label\)/.test(e) && /kind: "page"/.test(e));
  ok("container actions wired to real ops (move/duplicate/delete)", /function blockChromeHandlers[\s\S]{0,200}moveBlock\(block, -1\)[\s\S]{0,200}duplicateBlock\(block\)[\s\S]{0,120}deleteBlockByRef\(block\)/.test(e));
  ok("enteredBlock content-level state + exit-on-reselect", /var enteredBlock = null;/.test(e) && /if \(enteredBlock && selection\.block !== enteredBlock\) enteredBlock = null;/.test(e));
  ok("hotspot asset: handle hidden (internal ref not author-facing)", /var isAssetSrc = typeof curScreen\.visual === "string" && curScreen\.visual\.indexOf\("asset:"\) === 0;/.test(e)); // #216: base = current screen visual
  // Ticket 6 (2/2) — sequence steps on repeatedList + the rowExtras extension.
  ok("repeatedList supports optional compact rowExtras (icons between field + trash)", /if \(opts\.rowExtras\) \{[\s\S]{0,220}row\.appendChild\(n\)/.test(e) && /row\.appendChild\(grip\); row\.appendChild\(field\);/.test(e));
  ok("image glyph is canonical Lucide (icons.js, for the step marker upload)", /"image":/.test(src("src/icons.js")) && /image: "image"/.test(e));
  ok("sequence Content has no duplicate footer (spacing+actions at Block level)", /no renderBlockActionsSection here/.test(e));
  // Ticket 8 (1/n) — frame/group two-level via renderContainerChrome.
  ok("frame/group dispatched to the two-level shell", /if \(block\.type === "frame" \|\| block\.type === "group"\) \{ renderFrameOrGroupTwoLevel\(node\); return; \}/.test(e));
  ok("renderContainerChrome supports stroke:\"switch\" (on/off, no dead colour/width)", /if \(decl\.stroke === "switch"\) \{\s*switchRow\("Stroke"/.test(e));
  ok("frame Block level = container decl (padding/gap/radius/fill/stroke-switch)", /renderBlockTwoLevel\(node, "Card", \{ padding: true, gap: true, radius: true, fill: true, stroke: "switch" \}/.test(e));
  ok("group Block level = CONTENT_DECL (invisible, spacing+actions)", /renderBlockTwoLevel\(node, "Group", CONTENT_DECL, renderFrameContent\)/.test(e));
  ok("frame io maps padding/background/border to the real fields", /if \(k === "padX"\)[\s\S]{0,80}block\.padding[\s\S]{0,400}block\.background[\s\S]{0,200}block\.border = true/.test(e));
  ok("frame Content = children (Inside) + actions (renderFrameContent)", /function renderFrameContent\(node\) \{[\s\S]{0,400}sub\("Inside"\)[\s\S]{0,2200}Convert to group/.test(e));
  // Ticket 7 (1/n) — image two-level (image params = content). #88: the box STROKE is
  // exposed (IMAGE_DECL) with an io mapping it to block.box so a border can be removed.
  ok("image dispatched to the two-level shell (IMAGE_PURE_DECL + imageChromeIo; #160 depth-pure)", /if \(block\.type === "image"\) \{ renderBlockTwoLevel\(node, "Image", IMAGE_PURE_DECL, function \(n\) \{ renderImageContent\(n\.__block\); \}, imageChromeIo\(block\), blockChromeHandlers\(block\)\); return; \}/.test(e));
  ok("#88 IMAGE_DECL exposes the box stroke (fill/radius stay off)", /var IMAGE_DECL = \{ fill: false, stroke: true, radius: false \};/.test(e));
  ok("#88 imageChromeIo maps hasStroke/colour/width to block.box + clears legacy border", /function imageChromeIo\(block\)[\s\S]{0,400}return !!\(block\.box && block\.box\.border\)[\s\S]{0,900}block\.box\.border = true;[\s\S]{0,200}delete block\.box\.border; delete block\.box\.borderColor; delete block\.box\.borderWidth;[\s\S]{0,120}delete block\.border;/.test(e));
  ok("renderImageContent holds the image params in a canonical Content section (url/upload/alt)", /function renderImageContent\(block\) \{[\s\S]{0,900}sectionGroup\("Content", "Image"[\s\S]{0,400}Image URL[\s\S]{0,300}Upload image/.test(e));
  // Ticket 7 (2/n) — text blocks (heading/paragraph/note) two-level.
  ok("text blocks dispatched to the two-level shell (type-name breadcrumb)", /if \(block\.type === "heading" \|\| block\.type === "paragraph" \|\| block\.type === "note"\) \{ renderBlockTwoLevel\(node, block\.type\.charAt\(0\)\.toUpperCase\(\) \+ block\.type\.slice\(1\), CONTENT_DECL, renderTextContent\); return; \}/.test(e));
  ok("renderTextContent = the copy textarea (writes block.text)", /function renderTextContent\(node\) \{[\s\S]{0,200}sub\("Content"\)[\s\S]{0,200}h\("textarea"[\s\S]{0,200}block\.text = textIn\.value/.test(e));
  // Ticket 7 (3/n) — content-less blocks (spacer, divider).
  ok("renderContentlessBlock delegates to the all-in-one shell (body = specific)", /function renderContentlessBlock\(node, label, renderBody\) \{[\s\S]{0,200}renderBlockTwoLevel\(node, label, BOX_ONLY_DECL, function \(n\) \{ if \(renderBody\) renderBody\(n\); \}\)/.test(e));
  ok("spacer + divider dispatched as content-less", /if \(block\.type === "spacer"\) \{ renderContentlessBlock\(node, "Spacer", renderSpacerBody\); return; \}/.test(e) && /if \(block\.type === "divider"\) \{ renderContentlessBlock\(node, "Divider"/.test(e));
  // Ticket 8 (2/n) — columns (container; children canvas-edited -> single-level).
  ok("columns dispatched as single-level (renderColumnsBody)", /if \(block\.type === "columns"\) \{ renderContentlessBlock\(node, "Columns", renderColumnsBody\); return; \}/.test(e));
  ok("renderColumnsBody = column gap / row gap layout", /function renderColumnsBody\(node\)/.test(e) && /title: "Column gap \(horizontal\)"/.test(e) && /title: "Row gap \(vertical/.test(e));
  // Ticket 8 (3/n) — specialized inspectors (accordion, quiz) wrapped in two-level.
  ok("accordion wrapped in the two-level shell (#161 depth-pure)", /if \(block\.type === "accordion"\) \{ renderBlockTwoLevel\(node, "Accordion", CONTENT_PURE_DECL, renderAccordionInspector\); return; \}/.test(e));
  ok("quiz wrapped in the two-level shell (#160 depth-pure)", /if \(block\.type === "quiz"\) \{ renderBlockTwoLevel\(node, "Quiz", CONTENT_PURE_DECL, renderQuizInspector\); return; \}/.test(e));
  ok("specialized inspectors omit their own head + footer (shell provides them)", (e.match(/head omitted \(two-level breadcrumb/g) || []).length >= 1 && (e.match(/footer omitted \(spacing \+ actions at Block level\)/g) || []).length >= 2);
  // Ticket 8 (4/n) — componentGrid single-level.
  ok("componentGrid dispatched single-level (renderComponentGridBody)", /if \(block\.type === "componentGrid"\) \{ renderContentlessBlock\(node, "Component grid", renderComponentGridBody\); return; \}/.test(e));
  ok("renderComponentGridBody = grid layout (template/instances)", /function renderComponentGridBody\(node\)/.test(e) && /sub\("Grid Layout"\)/.test(e) && /Component Template/.test(e));
  // Ticket 8 (5/n) — checkbox single-level.
  ok("checkbox dispatched single-level (renderCheckboxBody)", /if \(block\.type === "checkbox"\) \{ renderContentlessBlock\(node, "Checkbox", renderCheckboxBody\); return; \}/.test(e));
  ok("renderCheckboxBody = acknowledgement + require-to-continue gate", /function renderCheckboxBody\(node\)/.test(e) && /sub\("Acknowledgement"\)/.test(e) && /Require to continue/.test(e));
  // Ticket 8 (6/n) — cardReveal wrapped in two-level.
  ok("cardReveal wrapped in the two-level shell (#161 depth-pure)", /if \(block\.type === "cardReveal"\) \{ renderBlockTwoLevel\(node, "Card reveal", CONTENT_PURE_DECL, renderCardRevealInspector\); return; \}/.test(e));
  // Ticket 8 (7/n) — embed (htmlEmbed/webEmbed) wrapped in two-level.
  ok("embed wrapped in the two-level shell (type-aware label; #161 depth-pure)", /selection\.type === "embed"\) renderBlockTwoLevel\(selection\.node, selection\.node\.__block\.type === "htmlEmbed" \? "HTML Interaction" : "Web Embed", CONTENT_PURE_DECL, renderEmbedInspector\)/.test(e));
  // PERF: a large interaction's source (MBs of inlined base64) is NOT eagerly injected into
  // the inspector <textarea> — a multi-MB editable node made the whole panel chug. It is
  // deferred behind a "Load HTML to edit" button above a threshold; small ones stay inline.
  ok("embed source deferred above a size threshold", /var HTML_INLINE_MAX = \d+;[\s\S]*?var deferSource = rawHtml\.length > HTML_INLINE_MAX;/.test(e));
  ok("large source is NOT put in the textarea until requested", /if \(!deferSource\) codeIn\.value = rawHtml;/.test(e) && /function loadSource\(\)/.test(e));
  ok("deferred source shows a Load button instead of the giant field", /if \(deferSource\) \{[\s\S]*?"Load HTML to edit"[\s\S]*?\} else \{\s*inspector\.appendChild\(codeIn\);/.test(e));
  ok("paste reveals the deferred field first", /if \(!codeIn\.parentNode\) loadSource\(\); \/\/ reveal the deferred/.test(e));
})();

// ---- Icon accessor (issue #9 — Lucide adopted offline) -------------------
// Regression guard for src/icons.js: name -> inline SVG resolves, unknown name
// is handled gracefully (no throw, neutral placeholder), the accessor is fully
// offline (no CDN reference), and it covers every glyph the retired GLYPHS set
// and the legacy ICONS keys used.
section("Icon accessor (Lucide offline)");
(function () {
  var Icon = require(path.join(ROOT, "src/icons.js"));
  var isrc = src("src/icons.js");

  // Resolution: a known Lucide name returns a full inline <svg> with real geometry.
  var eye = Icon("eye");
  ok("Icon(name) returns a full inline <svg>", typeof eye === "string" && /^<svg\b/.test(eye) && /<\/svg>$/.test(eye));
  ok("Icon(name) carries the Lucide geometry (not empty)", /<circle|<path|<rect|<line|<polyline/.test(eye));
  ok("Icon svg is on the Lucide 24-grid, currentColor stroke", /viewBox="0 0 24 24"/.test(eye) && /stroke="currentColor"/.test(eye));

  // Unknown name: no throw, neutral placeholder box (never collapses layout).
  var missing;
  var threw = false;
  try { missing = Icon("definitely-not-an-icon"); } catch (_) { threw = true; }
  ok("Icon(unknown) does not throw", threw === false);
  ok("Icon(unknown) returns a placeholder <svg> (never empty)", typeof missing === "string" && /^<svg\b/.test(missing) && /opacity="0.35"/.test(missing));
  ok("Icon.has() distinguishes known from unknown", Icon.has("eye") === true && Icon.has("definitely-not-an-icon") === false);

  // Offline: no CDN / network reference anywhere in the bundle.
  ok("Icon bundle is offline (no CDN / unpkg / http reference)", !/https?:|unpkg|cdn|jsdelivr|createIcons|window\.lucide/i.test(isrc));

  // Coverage: every Lucide name the mapped call sites use is present.
  var need = ["align-left", "align-center", "align-right", "align-justify",
    "align-horizontal-space-between", "align-start-horizontal", "align-center-horizontal",
    "align-end-horizontal", "eye", "eye-off", "monitor", "tablet", "smartphone",
    "contrast", "columns-2", "list-collapse", "indent-increase", "unfold-horizontal",
    "arrow-up-to-line", "arrow-down-to-line", "copy", "trash-2", "grip-vertical",
    "plus", "minus", "chevron-right", "image", "refresh-cw", "upload", "unlink",
    "arrow-up", "arrow-down", "lock", "lock-open", "scissors", "grid-2x2", "sparkles"];
  var absent = need.filter(function (n) { return !Icon.has(n); });
  ok("Icon covers every mapped Lucide glyph (" + (need.length - absent.length) + "/" + need.length + ")", absent.length === 0);
  if (absent.length) console.error("    missing: " + absent.join(", "));

  // Flagged Verso-custom set (no clean Lucide match) resolves too.
  var custom = ["padding", "pad-x", "pad-y", "radius", "border-weight", "blur",
    "line-height", "letter-spacing", "word-spacing"];
  var missingCustom = custom.filter(function (n) { return !Icon.has(n); });
  ok("Icon resolves the flagged Verso-custom field marks", missingCustom.length === 0 && Object.keys(Icon.CUSTOM).length === custom.length);

  // Every registered icon renders to a valid, non-empty svg.
  var bad = Icon.names().filter(function (n) { var s = Icon(n); return !/^<svg\b[\s\S]*<\/svg>$/.test(s) || !/<(path|circle|rect|line|polyline)\b/.test(s); });
  ok("every registered Icon renders valid non-empty svg (" + (Icon.names().length - bad.length) + "/" + Icon.names().length + ")", bad.length === 0);
})();

// ---- UI kit conformance gate (ticket 4 — WARN-ONLY phase) --
// Warns (does not fail) on blocks that still hand-append container chrome instead
// of calling renderContainerChrome. Blocks migrate in tickets 8-9; ticket 9 flips
// this to a hard fail. The warn helper never touches the pass/fail count, so the
// suite stays green through the migration.
// SPEC-ui-kit ticket 9: the gate now HARD-FAILS. Every block inspector renders its
// container chrome through renderContainerChrome, so the three violation classes must
// be 0 — a NEW hand-rolled section / inline glyph / labelled dimension fails the suite.
// The remaining legitimate Appearance/Layout sites (embed interaction fit + border,
// Header/Footer styling) are marked `gate-ok` and excluded.
section("UI kit conformance gate (ticket 9 — HARD FAIL)");
(function () {
  var e = src("src/editor.js");
  // Class 1 — hand-appended block container chrome: sub("Appearance"|"Layout") NOT
  // marked gate-ok.
  var handRolled = e.split("\n").filter(function (line) {
    return /sub\("(Appearance|Layout)"\)/.test(line) && !/gate-ok/.test(line);
  });
  ok("class 1: no hand-appended block container chrome (all via renderContainerChrome)", handRolled.length === 0);
  if (handRolled.length) handRolled.forEach(function (l) { console.error("    chrome: " + l.trim()); });
  // Class 2 — inline one-off glyphs: a hardcoded <svg> shape in control code instead
  // of resolving through the Icon accessor (src/icons.js).
  var inlineGlyphs = (e.match(/innerHTML = ['"]<svg[^;]*?<(?:path|circle|rect|polygon|g)\b/g) || []);
  ok("class 2: no inline one-off glyphs (all via the Icon accessor)", inlineGlyphs.length === 0);
  // Class 3 — labelled dimensional controls: the deprecated numRow/labeledRow instead
  // of the glyph-led iconField.
  var labelledDims = (e.match(/\b(numRow|labeledRow)\(/g) || []);
  ok("class 3: no labelled dimensional controls (numRow/labeledRow deleted)", labelledDims.length === 0);

  // ---- issue #11 (parent #22): DS-conformance gate (SOFT during migration) --
  // Re-grounding the chrome on the vendored Design System. HARD invariants below
  // already hold post-#6..10; the migration counters (raw hex, --ui-* aliases)
  // run SOFT via warn() because the --ui-* alias layer (#7) is intentionally
  // still present. The flip to a hard --ui-* fail lands with the alias teardown
  // (#21) — do not hard-fail on it here.
  var css = src("editor.css");
  var courseCss11 = src("src/course.css");
  var icons = src("src/icons.js");
  var uiKit = src("src/ui-kit.js");

  // (item 4) DS token files present + imported by the editor entry CSS.
  var TOKEN_FILES = ["colors.css", "typography.css", "spacing.css", "effects.css", "fonts.css"];
  TOKEN_FILES.forEach(function (f) {
    ok("DS token file present: design-system/tokens/" + f,
       fs.existsSync(path.join(ROOT, "design-system/tokens", f)));
    ok("editor.css imports design-system/tokens/" + f,
       new RegExp('@import\\s+"design-system/tokens/' + f.replace(".", "\\.") + '"').test(css));
  });
  // #21 teardown: the legacy ui-alias layer is DELETED. No alias definitions
  // (`--ui-x: ...`) may remain in the editor entry CSS — the chrome references
  // DS tokens directly now.
  ok("editor.css ui-alias layer deleted (no alias definitions remain)",
     !/--ui-[a-z-]+\s*:/.test(css));

  // (item 4, invariant guard) course.css is the ship path (SCORM export) — it
  // must carry NO chrome tokens: the --ui-* alias names, the chrome-only surface
  // /border tokens, or vds-* control classes. A leak would ship in the package.
  var chromeTokenLeak = (courseCss11.match(/--ui-[a-z-]+|--surface-(?:canvas|panel|raised)|--border-(?:strong|subtle)|\bvds-[a-z-]+/g) || []);
  ok("course.css carries no chrome tokens (--ui-* / chrome surface+border / vds-*)", chromeTokenLeak.length === 0);
  if (chromeTokenLeak.length) console.error("    leak: " + chromeTokenLeak.slice(0, 8).join(" · "));

  // (item 2) Icons resolve only through the Lucide Icon accessor (src/icons.js);
  // no stray inline <svg> in chrome source (editor.css / editor.js / control lib).
  // icons.js is the sole home of the inlined Lucide glyph geometry.
  ok("Icon accessor exposed by src/icons.js (window.Icon)", /window\.Icon\s*=\s*Icon/.test(icons));
  ok("src/icons.js IS the Lucide glyph home (inlined <svg> lives here)", icons.indexOf("<svg") !== -1);
  ok("chrome CSS has no inline <svg> (icons via the accessor)", css.indexOf("<svg") === -1);
  ok("chrome control library (src/ui-kit.js) has no inline <svg>", uiKit.indexOf("<svg") === -1);
  var chromeSvg = (e.match(/<svg/g) || []);
  ok("chrome JS (editor.js) has no inline <svg> outside the Icon accessor", chromeSvg.length === 0);

  // (item 3, extends class 1/2/3) Chrome controls come from the canonical set
  // (window.VersoUI, src/ui-kit.js). The class 1/2/3 checks above already fail a
  // NEW hand-rolled container / inline glyph / labelled dimension; here we assert
  // the canonical control set is defined and is the chrome's control source.
  ok("canonical control set defined (window.VersoUI in src/ui-kit.js)", /window\.VersoUI\s*=/.test(uiKit));
  ok("chrome sources controls from the canonical set (editor.js references VersoUI)", e.indexOf("window.VersoUI") !== -1);

  // (item 1) No raw hex colours in chrome CSS/JS. SOFT (P2, #21): a residual of
  // off-token hex remains (one-off overlays, alpha washes, shadows with no clean
  // DS equivalent), so report the count via warn() rather than fail. design-system/
  // vendored files + non-chrome are exempt.
  var HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
  var cssHex = (css.match(HEX) || []).length;
  var jsHex = (e.match(HEX) || []).length;
  if (cssHex) warn("raw hex in editor.css: " + cssHex + " residual literals (SOFT — no clean DS equivalent)");
  if (jsHex) warn("raw hex in chrome JS (editor.js): " + jsHex + " residual literals (SOFT)");

  // (item 1 / ui-alias) HARD-FAIL (#21 teardown): the legacy ui-alias layer is
  // deleted and every chrome surface references DS tokens directly — so ZERO
  // ui-alias references may remain in ANY chrome file (entry CSS + all chrome JS).
  // render.js / course.css are the SHIP path and are excluded by construction.
  var UI_ALIAS = /--ui-[a-z][a-z-]*/g;
  var chromeFiles = ["editor.css", "src/editor.js", "src/csv.js", "src/ui-kit.js", "src/icons.js"];
  var uiRefs = chromeFiles.reduce(function (n, f) {
    return n + ((src(f).match(UI_ALIAS) || []).length);
  }, 0);
  ok("no ui-alias references remain in chrome (alias layer torn down, #21)", uiRefs === 0);
  if (uiRefs) chromeFiles.forEach(function (f) {
    var hits = src(f).match(UI_ALIAS) || [];
    if (hits.length) console.error("    " + f + ": " + hits.slice(0, 8).join(" · "));
  });
})();

// ---- HFDEF: shared header/footer default for new courses -----------------
section("HFDEF header-footer default");
(function () {
  var e = src("src/editor.js");
  var a = e.indexOf("/* @hfdefault-start */"), b = e.indexOf("/* @hfdefault-end */");
  if (a < 0 || b < 0) { ok("locate @hfdefault fence", false); return; }
  var hf = new Function(e.slice(a, b) + "\nreturn { sanitize: sanitizeHeaderFooterDefault, fromDefault: headerFooterFromDefault };")();

  var source = {
    header: { on: true, title: "Sample Fundamentals", subtitle: "Getting Started", logo: "asset:abc", padX: 40, color: "#123456" },
    footer: { on: true, text: "Export-controlled.", padY: 20, children: [
      { type: "courseNav", menuLabel: "Menu", prevLabel: "Back", nextLabel: "Next", sections: [{ id: "s1", label: "Ch1", pageIds: ["p1", "p2"] }] }
    ] }
  };
  var clean = hf.sanitize(source);
  ok("sanitize drops the per-course header title", clean.header.title === undefined);
  ok("sanitize keeps header styling + subtitle + logo", clean.header.subtitle === "Getting Started" && clean.header.padX === 40 && clean.header.logo === "asset:abc" && clean.header.color === "#123456");
  ok("sanitize clears courseNav sections (nav is chapter-derived)", clean.footer.children[0].sections.length === 0);
  ok("sanitize keeps courseNav styling/labels", clean.footer.children[0].menuLabel === "Menu" && clean.footer.children[0].prevLabel === "Back");
  ok("sanitize keeps footer disclaimer + styling", clean.footer.text === "Export-controlled." && clean.footer.padY === 20);
  ok("sanitize does not mutate the source", source.header.title === "Sample Fundamentals" && source.footer.children[0].sections.length === 1);
  ok("sanitize of null -> null", hf.sanitize(null) === null);

  var applied = hf.fromDefault(clean, "New Drone Course");
  ok("fromDefault sets the NEW course's own title", applied.header.title === "New Drone Course");
  ok("fromDefault carries the saved subtitle/logo/footer", applied.header.subtitle === "Getting Started" && applied.header.logo === "asset:abc" && applied.footer.text === "Export-controlled.");
  ok("fromDefault does not mutate the saved default", clean.header.title === undefined);
  ok("fromDefault of null -> null (caller falls back to built-in)", hf.fromDefault(null, "X") === null);

  ok("createBlankDoc applies the saved default with a built-in fallback",
    /headerFooter: headerFooterFromDefault\(getHeaderFooterDefault\(\), title\) \|\| \{/.test(e));
  ok("saveHeaderFooterDefault bakes the logo asset ref to a data URI", /a\.dataUrl\) clean\.header\.logo = a\.dataUrl;/.test(e));

  // saved-course rows have a confirm-gated delete (trash) that removes from the registry
  ok("new-doc saved-course row has a trash delete button", /var del = iconBtn\("trash", "Delete this saved course", true\);/.test(e));
  ok("delete is confirm-gated + removes the course from the registry + refreshes the list",
    /confirmModal\("Delete course\?"[\s\S]{0,340}delete registry\[id\];\s*saveRegistry\(registry\);[\s\S]{0,220}modal\.remove\(\); showNewDocDialog\(\);/.test(e));
})();

// ---- ui-kit (#10): DS canonical control set — pure logic + wiring guards ----
// The vanilla DS control library (src/ui-kit.js) is DOM-free at module load
// (factories aren't called), so require it directly and exercise VersoUI._pure.
section("ui-kit #10 DS control set");
(function () {
  var U;
  try { U = require(path.join(ROOT, "src/ui-kit.js")); } catch (e) { ok("require src/ui-kit.js", false); return; }
  ok("require src/ui-kit.js", !!U && !!U._pure);
  if (!U || !U._pure) return;
  var P = U._pure;

  // All 23 named DS primitives (+ BlockGrid) are exported as factories.
  var NAMES = ["Icon", "Button", "IconButton", "IconField", "TextField", "FieldRow", "TwoUp",
    "SegmentedControl", "Switch", "SwitchRow", "Select", "Checkbox", "ColorField",
    "Panel", "PanelSection", "Breadcrumb", "Tabs", "DocumentTab",
    "TreeItem", "BlockPaletteItem", "BlockTile", "BlockGrid", "Badge",
    "Modal", "ContextMenu", "Tooltip"];
  NAMES.forEach(function (n) { ok("VersoUI exports " + n + "()", typeof U[n] === "function"); });

  // normOptions: string | {value,label,icon,title} -> normalized 4-field shape.
  var no = P.normOptions(["left", { value: "c", label: "Centre", icon: "align-center", title: "Centre" }]);
  ok("normOptions coerces a bare string", no[0].value === "left" && no[0].label === "left" && no[0].icon === null);
  ok("normOptions keeps object icon/label/title", no[1].value === "c" && no[1].label === "Centre" && no[1].icon === "align-center" && no[1].title === "Centre");
  ok("segHasIcon true when any option has an icon", P.segHasIcon([{ value: "a", icon: "x" }]) === true);
  ok("segHasIcon false for plain string options", P.segHasIcon(["a", "b"]) === false);

  // normMenuItems: "-" / {divider} -> sep; heads; normalized items.
  var mi = P.normMenuItems(["-", { head: "Actions" }, { label: "Delete", danger: true, value: "del" }, { label: "Nope", disabled: true }]);
  ok("normMenuItems maps '-' to a separator", mi[0].sep === true);
  ok("normMenuItems keeps a head row", mi[1].head === "Actions");
  ok("normMenuItems normalizes danger + value", mi[2].danger === true && mi[2].value === "del");
  ok("normMenuItems defaults value to label + carries disabled", mi[3].value === "Nope" && mi[3].disabled === true);

  // normCrumbs: last item is the current selection (view builds it as emphasised).
  var cr = P.normCrumbs(["Page 49", { label: "Image hotspots", onClick: function () {} }]);
  ok("normCrumbs coerces strings + preserves onClick", cr[0].label === "Page 49" && cr[0].onClick === null && typeof cr[1].onClick === "function");

  // Class builders — deterministic, token-class output (drives the CSS re-skin).
  ok("btnClass defaults to secondary/md", P.btnClass() === "vds-btn vds-btn--secondary vds-btn--md");
  ok("btnClass primary/sm/full", P.btnClass("primary", "sm", true) === "vds-btn vds-btn--primary vds-btn--sm vds-btn--full");
  ok("btnClass rejects an unknown variant", P.btnClass("weird") === "vds-btn vds-btn--secondary vds-btn--md");
  ok("iconBtnClass md default", P.iconBtnClass() === "vds-iconbtn vds-iconbtn--md");
  ok("iconBtnClass lg/active/danger", P.iconBtnClass("lg", true, true) === "vds-iconbtn vds-iconbtn--lg is-active is-danger");
  ok("badgeClass neutral/md default", P.badgeClass() === "vds-badge vds-badge--neutral vds-badge--md");
  ok("badgeClass component/sm", P.badgeClass("component", "sm") === "vds-badge vds-badge--component vds-badge--sm");

  // Tri-state checkbox aria + tree indent maths.
  ok("checkAria mixed wins over checked", P.checkAria(true, true) === "mixed");
  ok("checkAria checked -> true", P.checkAria(true, false) === "true");
  ok("checkAria unchecked -> false", P.checkAria(false, false) === "false");
  ok("treeIndent depth 0 -> 8", P.treeIndent(0) === 8);
  ok("treeIndent depth 3 -> 44", P.treeIndent(3) === 44);
  ok("treeIndent clamps negatives", P.treeIndent(-5) === 8);

  // Drop-in wiring: editor.js switchEl delegates to VersoUI.Switch (identical
  // uiswitch DOM) so the 27 switchRow sites re-skin onto the DS automatically.
  var ed = src("src/editor.js");
  ok("switchEl drops in onto VersoUI.Switch", /window\.VersoUI && window\.VersoUI\.Switch\)\s*\{\s*return window\.VersoUI\.Switch\(\{ checked: !!on, onChange: onToggle \}\);/.test(ed));
  ok("switchEl keeps a local fallback (library-absent safety)", /b\.appendChild\(h\("span", "uiswitch__knob"\)\);/.test(ed));

  // Chrome-only invariant: the DS control set never leaks into the ship path.
  var courseCss = src("src/course.css");
  ok("course.css carries no vds-* chrome classes", courseCss.indexOf("vds-") === -1);
  var renderJs = src("src/render.js");
  ok("render() never imports the chrome control library", renderJs.indexOf("VersoUI") === -1);
  ok("ui-kit.js declares itself chrome-only", src("src/ui-kit.js").indexOf("CHROME ONLY") !== -1);

  // index.html loads the library before editor.js (so switchEl can find it).
  var idx = src("index.html");
  ok("index.html loads ui-kit.js before editor.js", idx.indexOf("src/ui-kit.js") !== -1 && idx.indexOf("src/ui-kit.js") < idx.indexOf("src/editor.js"));
})();

// resolveVariant must recurse into NESTED containers (columns / frame-group children /
// cardReveal-accordion-sequence items / componentGrid instances) — a text override on a
// nested block was previously dropped (variant preview showed the flagship copy).
(function () {
  section("variant nesting (resolveVariant)");
  var rtxt = src("src/render.js");
  var slice = rtxt.slice(rtxt.indexOf("var VARIANT_AXIS"), rtxt.indexOf("window.getVariants ="));
  var stub = {};
  var resolveVariant = new Function("window", slice + "\nreturn window.resolveVariant;")(stub);

  var ov = function (t) { return { V: { text: t } }; };
  var doc = { variants: ["V"], pages: [{ id: "p", blocks: [
    { type: "heading", text: "BASE_TOP", overrides: ov("OVR_TOP") },
    { type: "columns", columns: [ [ { type: "paragraph", text: "BASE_COL", overrides: ov("OVR_COL") } ] ] },
    { type: "frame", children: [ { type: "paragraph", text: "BASE_FR", overrides: ov("OVR_FR") } ] },
    { type: "cardReveal", items: [ { children: [ { type: "paragraph", text: "BASE_CARD", overrides: ov("OVR_CARD") } ] } ] },
    { type: "componentGrid", component: "c", instances: [ { slots: { title: "BASE_SLOT" }, overrides: { V: { slots: { title: "OVR_SLOT" } } } } ] }
  ] }] };
  var b = resolveVariant(doc, "V").pages[0].blocks;
  ok("top-level override applies", b[0].text === "OVR_TOP");
  ok("override inside columns applies", b[1].columns[0][0].text === "OVR_COL");
  ok("override inside frame/group children applies", b[2].children[0].text === "OVR_FR");
  ok("override inside cardReveal item applies", b[3].items[0].children[0].text === "OVR_CARD");
  ok("componentGrid instance slot override still applies", b[4].instances[0].slots.title === "OVR_SLOT");

  // Hotspot popover-card blocks (#215 screens[].markers[].blocks): a per-variant
  // override on a block INSIDE a card must resolve (same marker, different info per
  // variant), and a per-variant override ON a Screen node (the migrated #148 entry
  // visual channel) must swap the visual.
  var hsDoc = { variants: ["V"], pages: [{ id: "p", blocks: [
    { type: "hotspot", entry: "scr-entry", screens: [
      { id: "scr-entry", visual: "asset:BASE", overrides: { V: { visual: "asset:VVIS" } }, markers: [
        { id: "h1", action: "card", blocks: [ { type: "paragraph", text: "BASE_HS", overrides: ov("OVR_HS") } ] },
        { id: "h2", action: "card", blocks: [ { type: "paragraph", text: "UNTOUCHED_HS" } ] }
      ] }
    ] }
  ] }] };
  var hsBefore = JSON.stringify(hsDoc);
  var hsB = resolveVariant(hsDoc, "V").pages[0].blocks[0];
  ok("override inside a hotspot card applies", hsB.screens[0].markers[0].blocks[0].text === "OVR_HS");
  ok("per-variant Screen visual override applies (#148 migrated channel)", hsB.screens[0].visual === "asset:VVIS");
  ok("hotspot resolve does NOT mutate the base doc", JSON.stringify(hsDoc) === hsBefore);
  // a card block hidden in the variant is dropped from that marker's blocks.
  var hsVisDoc = { variants: ["V"], pages: [{ id: "p", blocks: [
    { type: "hotspot", entry: "scr-entry", screens: [
      { id: "scr-entry", visual: "asset:BASE", markers: [
        { id: "h1", action: "card", blocks: [ { type: "paragraph", text: "KEEP_HS" }, { type: "paragraph", text: "GONE_HS", variantVis: { hide: ["V"] } } ] }
      ] }
    ] }
  ] }] };
  var hsCard = resolveVariant(hsVisDoc, "V").pages[0].blocks[0].screens[0].markers[0].blocks;
  ok("hotspot card block hidden in a variant is dropped", hsCard.length === 1 && hsCard[0].text === "KEEP_HS");

  // Nested VISIBILITY: a child hidden in the variant is dropped from its container.
  var visDoc = { variants: ["V"], pages: [{ id: "p", blocks: [
    { type: "columns", columns: [ [
      { type: "paragraph", text: "KEEP" },
      { type: "paragraph", text: "GONE", variantVis: { hide: ["V"] } }
    ] ] }
  ] }] };
  var col = resolveVariant(visDoc, "V").pages[0].blocks[0].columns[0];
  ok("nested block hidden in a variant is dropped", col.length === 1 && col[0].text === "KEEP");

  // IDENTITY: hero returns the SAME page ref; an untouched subtree keeps its refs so
  // live hero editing stays bound to the real model objects.
  var heroDoc = { variants: ["V"], pages: [{ id: "p", blocks: [ { type: "frame", children: [ { type: "paragraph", text: "X" } ] } ] }] };
  ok("hero variant returns identity (same page ref)", resolveVariant(heroDoc, "hero").pages[0] === heroDoc.pages[0]);
  var mixDoc = { variants: ["V"], pages: [{ id: "p", blocks: [
    { type: "paragraph", text: "A", overrides: ov("A2") },
    { type: "paragraph", text: "B" } // untouched
  ] }] };
  var mix = resolveVariant(mixDoc, "V").pages[0].blocks;
  ok("untouched sibling keeps its ref (no needless clone)", mix[1] === mixDoc.pages[0].blocks[1]);

  // DEEP nesting: a frame inside a column.
  var deepDoc = { variants: ["V"], pages: [{ id: "p", blocks: [
    { type: "columns", columns: [ [ { type: "frame", children: [ { type: "paragraph", text: "BASE", overrides: ov("DEEP") } ] } ] ] }
  ] }] };
  ok("deeply nested override (frame in column) applies", resolveVariant(deepDoc, "V").pages[0].blocks[0].columns[0][0].children[0].text === "DEEP");
})();

// #205 software-version axis: pure resolveVersion mirrors resolveVariant on a PARALLEL,
// independent node surface (versions / versionVis / versionOverrides) and NESTS on top of a
// product-resolved doc. Base = doc.versions[0] is the identity anchor (same-ref preserved);
// default = latest = last-created.
(function () {
  section("#205 resolveVersion (software-version axis)");
  var rtxt = src("src/render.js");
  var slice = rtxt.slice(rtxt.indexOf("var VARIANT_AXIS"), rtxt.indexOf("// ---- interaction model normalisation"));
  var stub = {};
  new Function("window", slice)(stub);
  var resolveVersion = stub.resolveVersion, resolveVariant = stub.resolveVariant;

  // base = first-created (v1), default = latest = last-created (v3).
  var versions = ["v1", "v2", "v3"];
  ok("getVersionBase = first-created", stub.getVersionBase({ versions: versions }) === "v1");
  ok("getVersionDefault = latest (last-created)", stub.getVersionDefault({ versions: versions }) === "v3");
  ok("getVersions returns a copy", (function () { var d = { versions: versions }; return stub.getVersions(d) !== versions && stub.getVersions(d).length === 3; })());

  // HIDE: a page/block hidden for a version is dropped from that version only.
  var vdoc = { versions: versions, pages: [{ id: "p", blocks: [
    { type: "paragraph", text: "ALL" },
    { type: "paragraph", text: "V3_ONLY", versionVis: { only: ["v3"] } },
    { type: "paragraph", text: "NOT_V2", versionVis: { hide: ["v2"] } }
  ] }] };
  var v2 = resolveVersion(vdoc, "v2").pages[0].blocks;
  ok("version hide+only drops nodes (v2 sees 1)", v2.length === 1 && v2[0].text === "ALL");
  var v3 = resolveVersion(vdoc, "v3").pages[0].blocks;
  ok("version only:[v3] shows in v3", v3.some(function (b) { return b.text === "V3_ONLY"; }));

  // OVERRIDE: versionOverrides bakes a field per version; nested too.
  var odoc = { versions: versions, pages: [{ id: "p", blocks: [
    { type: "heading", text: "BASE_TXT", versionOverrides: { v2: { text: "V2_TXT" } } },
    { type: "frame", children: [ { type: "paragraph", text: "BASE_CH", versionOverrides: { v2: { text: "V2_CH" } } } ] }
  ] }] };
  var ob = resolveVersion(odoc, "v2").pages[0].blocks;
  ok("versionOverride bakes top-level field", ob[0].text === "V2_TXT");
  ok("versionOverride bakes nested child field", ob[1].children[0].text === "V2_CH");

  // BASE identity: resolving the base version (v1) returns the SAME page ref (base editing stays bound).
  var bdoc = { versions: versions, pages: [{ id: "p", blocks: [ { type: "paragraph", text: "X" } ] }] };
  ok("base version returns identity (same page ref)", resolveVersion(bdoc, "v1").pages[0] === bdoc.pages[0]);
  ok("null version defaults to base identity (same page ref)", resolveVersion(bdoc, null).pages[0] === bdoc.pages[0]);
  var novdoc = { pages: [{ id: "p", blocks: [ { type: "paragraph", text: "X" } ] }] };
  ok("doc with NO version axis resolves to identity (no-op, same page ref)", resolveVersion(novdoc, null).pages[0] === novdoc.pages[0]);

  // NESTING: the two axes are INDEPENDENT namespaces and compose. Product resolves first, then
  // version resolves on top of the already-product-resolved doc (SPEC section 2).
  var ndoc = { variants: ["PROD"], versions: versions, pages: [{ id: "p", blocks: [
    { type: "paragraph", text: "BASE", overrides: { PROD: { text: "PROD_TXT" } }, versionOverrides: { v2: { text: "V2_TXT" } } },
    { type: "paragraph", text: "PROD_ONLY", variantVis: { only: ["PROD"] }, versionVis: { hide: ["v2"] } }
  ] }] };
  var nested = resolveVersion(resolveVariant(ndoc, "PROD"), "v2").pages[0].blocks;
  // product baked first (PROD_TXT), then version override lands on top (V2_TXT wins).
  ok("nesting: version override applies on top of product-resolved doc", nested[0].text === "V2_TXT");
  // second block is product-visible but version-hidden -> dropped by the version pass.
  ok("nesting: version-hidden node dropped after product resolve", nested.length === 1);
  // the reverse combo (PROD + v3) keeps the version-hidden block.
  var nested3 = resolveVersion(resolveVariant(ndoc, "PROD"), "v3").pages[0].blocks;
  ok("nesting: PROD+v3 keeps the block hidden only in v2", nested3.length === 2 && nested3[0].text === "PROD_TXT");

  // NAMESPACE isolation: a versionOverride must NOT leak into the variant axis and vice-versa.
  var iso = { variants: ["PROD"], versions: versions, pages: [{ id: "p", blocks: [
    { type: "paragraph", text: "BASE", versionOverrides: { v2: { text: "V2_ONLY" } } }
  ] }] };
  ok("variant axis ignores versionOverrides", resolveVariant(iso, "PROD").pages[0].blocks[0].text === "BASE");
  var iso2 = { variants: ["PROD"], versions: versions, pages: [{ id: "p", blocks: [
    { type: "paragraph", text: "BASE", overrides: { PROD: { text: "PROD_ONLY" } } }
  ] }] };
  ok("version axis ignores variant overrides", resolveVersion(iso2, "v2").pages[0].blocks[0].text === "BASE");

  // PURITY: resolveVersion must not mutate the base doc.
  var pdoc = { versions: versions, pages: [{ id: "p", blocks: [ { type: "heading", text: "B", versionOverrides: { v2: { text: "O" } } } ] }] };
  var before = JSON.stringify(pdoc);
  resolveVersion(pdoc, "v2");
  ok("resolveVersion does NOT mutate the base doc", JSON.stringify(pdoc) === before);
})();

// #50 data-loss guard: a STRUCTURAL tour-graph edit (hotspot screens/markers) made on the
// BASE node -- which openTourBuilder guarantees by unwrapping the version display clone via
// versionBaseNode -- must survive re-resolution of a software-version display clone (both the
// editor edit-tree and the pure export path). Regression guard for GH #50, where pressing the
// tour-builder Preview in flagship read as wiping the whole hotspot block.
(function () {
  section("#50 tour-graph structural edit survives version re-resolution");
  var rtxt = src("src/render.js");
  var slice = rtxt.slice(rtxt.indexOf("var VARIANT_AXIS"), rtxt.indexOf("// ---- interaction model normalisation"));
  var stub = {}; new Function("window", slice)(stub);
  var rfe = stub.resolveVersionForEdit, rv = stub.resolveVersion;
  var versions = ["Flagship", "V2"];
  function mk() { return { versions: versions, pages: [{ id: "p", blocks: [
    { id: "hb", type: "hotspot", entry: "s1", screens: [{ id: "s1", visual: "", kind: "image", markers: [] }] }
  ] }] }; }
  function hb(d) { return d.pages[0].blocks[0]; }

  // The edit-tree clone carries a non-enumerable __vbase back-link -> openTourBuilder unwraps
  // to that base, so a structural graph edit lands on base, never on the disposable clone.
  var doc = mk();
  var clone = hb(rfe(doc, "V2"));
  ok("#50 version edit-clone carries __vbase back-link", !!clone.__vbase);
  clone.__vbase.screens.push({ id: "s2", visual: "x", kind: "image", markers: [{ id: "m1", x: 50, y: 50, action: "card", blocks: [] }] });
  ok("#50 base structural edit survives edit-tree re-resolution (V2 active)", hb(rfe(doc, "V2")).screens.length === 2);
  ok("#50 base structural edit survives pure export resolution (V2)", hb(rv(doc, "V2")).screens.length === 2);

  // Same guarantee for the anchor version (Flagship == versions[0]): the anchor's own
  // versionOverrides are ignored (base is the data anchor), so base edits are always visible.
  var doc2 = mk();
  (hb(rfe(doc2, "Flagship")).__vbase || hb(doc2)).screens.push({ id: "s2", visual: "x", kind: "image", markers: [] });
  ok("#50 base structural edit survives in the anchor version (Flagship)",
    hb(rfe(doc2, "Flagship")).screens.length === 2 && hb(rv(doc2, "Flagship")).screens.length === 2);
})();

// Version RENAME: name a software version (base included) so it can be identified. The pure
// core rewrites doc.versions PLUS every per-node key ref (versionVis only/hide + versionOverrides)
// across pages / nested blocks / componentGrid instances, so a renamed key still resolves.
(function () {
  section("version rename (name a version so it can be identified)");
  var e = src("src/editor.js");
  var m = e.match(/function renameVersion\(d, oldName, newName\)\s*\{[\s\S]*?\n  \}/);
  if (!m) { ok("locate renameVersion", false); return; }
  var renameVersion = new Function(m[0] + "\nreturn renameVersion;")();
  function mk() {
    return { versions: ["v1", "v2"], pages: [{ id: "p", versionVis: { hide: ["v2"] }, blocks: [
      { type: "heading", text: "H", versionOverrides: { v2: { text: "H2" } }, versionVis: { only: ["v1", "v2"] } },
      { type: "frame", children: [ { type: "paragraph", versionOverrides: { v2: { text: "C2" } } } ] },
      { type: "columns", columns: [ [ { type: "paragraph", versionVis: { hide: ["v2"] } } ] ] },
      { type: "accordion", items: [ { children: [ { type: "paragraph", versionOverrides: { v2: { text: "A2" } } } ] } ] },
      { type: "hotspot", entry: "scr-entry", screens: [ { id: "scr-entry", versionOverrides: { v2: { visual: "asset:V2" } }, markers: [ { id: "h1", action: "card", blocks: [ { type: "paragraph", versionVis: { only: ["v2"] } } ] } ] } ] }, // #215 shape; screen node carries its own channel
      { type: "componentGrid", instances: [ { versionOverrides: { v2: { text: "I2" } } } ] }
    ] }] };
  }
  // rename a non-base version end-to-end
  var d = mk();
  ok("rename returns true on a real rename", renameVersion(d, "v2", "v2.5") === true);
  ok("doc.versions entry renamed (order kept)", d.versions[0] === "v1" && d.versions[1] === "v2.5");
  ok("page versionVis key migrated", d.pages[0].versionVis.hide[0] === "v2.5");
  var b = d.pages[0].blocks;
  ok("block versionOverrides key migrated", b[0].versionOverrides["v2.5"].text === "H2" && !b[0].versionOverrides.v2);
  ok("block versionVis only migrated", b[0].versionVis.only.join() === "v1,v2.5");
  ok("nested frame child override migrated", b[1].children[0].versionOverrides["v2.5"].text === "C2");
  ok("columns child versionVis migrated", b[2].columns[0][0].versionVis.hide[0] === "v2.5");
  ok("accordion item child override migrated", b[3].items[0].children[0].versionOverrides["v2.5"].text === "A2");
  ok("hotspot card block versionVis migrated", b[4].screens[0].markers[0].blocks[0].versionVis.only[0] === "v2.5");
  ok("hotspot Screen-node versionOverrides key migrated (#215)", b[4].screens[0].versionOverrides["v2.5"].visual === "asset:V2" && !b[4].screens[0].versionOverrides.v2);
  ok("componentGrid instance override migrated", b[5].instances[0].versionOverrides["v2.5"].text === "I2");
  // renaming the BASE (index 0) is an ordinary key rename; identity stays at index 0
  var d2 = mk();
  ok("rename base keeps it at index 0", renameVersion(d2, "v1", "v1.0") === true && d2.versions[0] === "v1.0");
  ok("base rename migrates a base-keyed visKey", d2.pages[0].blocks[0].versionVis.only[0] === "v1.0");
  // guards: no-op / invalid inputs return false and change nothing
  var d3 = mk(); var snap = JSON.stringify(d3);
  ok("same-name is a no-op (false)", renameVersion(d3, "v2", "v2") === false && JSON.stringify(d3) === snap);
  ok("empty new name rejected (false)", renameVersion(d3, "v2", "  ") === false && JSON.stringify(d3) === snap);
  ok("unknown old name rejected (false)", renameVersion(d3, "vX", "vY") === false && JSON.stringify(d3) === snap);
  ok("clash with an existing version rejected (false)", renameVersion(d3, "v2", "v1") === false && JSON.stringify(d3) === snap);
  // wiring: the switcher surfaces the base name + offers a rename, and the base badge exists
  ok("menu labels base with its name", /"Base · " \+ base/.test(e));
  ok("menu excludes base from the pickable list", /vs\.slice\(\)\.reverse\(\)\.forEach\(function \(v\) \{\s*if \(v === base\) return;/.test(e));
  ok("menu offers a rename action", /renameVersionPrompt\(activeVersion \|\| null\)/.test(e));
  ok("base badge identifies the current version", /"Editing base · " \+ baseName/.test(e));
})();

// #206 editor version switcher: a SECOND top-bar glyph, parallel to the variant pill, that
// previews any product x version combo read-only (edit-in-place is #207). Wiring guards on the
// real editor source (headless can't boot the DOM; the switcher is DOM-bound).
(function () {
  section("#206 version switcher (editor wiring)");
  var e = src("src/editor.js");
  ok("activeVersion state exists (null = editable base)", /var activeVersion = null;/.test(e));
  ok("versionNames() reads doc.versions", /function versionNames\(\) \{ return \(doc\.versions \|\| \[\]\)\.slice\(\); \}/.test(e));
  // NESTING: currentDoc resolves variant (product) FIRST, then version on top (#207 routes an
  // editable version through resolveVersionForEdit; a variant-composed version stays read-only).
  ok("currentDoc nests variant then version (product resolves first)",
    /function currentDoc\(\) \{\s*var d = doc;\s*if \(activeVariant\) d = window\.resolveVariant\(d, activeVariant\);\s*if \(activeVersion\) \{/.test(e));
  ok("isPreview() stays the conservative read-only gate (both axes)", /function isPreview\(\) \{ return !!activeVariant \|\| !!activeVersion; \}/.test(e));
  ok("setDoc drops a stale activeVersion the new doc lacks", /if \(activeVersion && \(doc\.versions \|\| \[\]\)\.indexOf\(activeVersion\) === -1\) activeVersion = null;/.test(e));
  // SWITCHER: glyph, menu, newest = default, Base entry, order after the variant glyph.
  ok("version glyph uses the 'history' icon", /versionWrapEl\.innerHTML = Ic \? Ic\("history"\)/.test(e));
  ok("newest version = the shipping default (last-created)", /var def = vs\.length \? vs\[vs\.length - 1\] : null;/.test(e));
  ok("newest version is tagged '· default' in the menu", /v === def \? "  · default" : ""/.test(e));
  ok("menu offers Base as the editable anchor (null activeVersion)", /active: !activeVersion, onClick: function \(\) \{ onVersionPick\(""\); \}/.test(e));
  ok("menu lists versions newest-first", /vs\.slice\(\)\.reverse\(\)\.forEach/.test(e));
  ok("+ New version prompt writes doc.versions (append = moving default)", /function newVersionPrompt\(then\)[\s\S]*?doc\.versions\.push\(name\)/.test(e));
  // FIX 4a: order encodes nesting — version glyph inserted AFTER the variant glyph.
  ok("version glyph inserts after the variant glyph (outer->inner order)", /host\.insertBefore\(versionWrapEl, variantWrapEl\.nextSibling\)/.test(e));
  ok("renderVersionSwitch wired into init + setDoc", (e.match(/renderVersionSwitch\(\)/g) || []).length >= 2);
  // PREVIEW: read-only badge + right-click nav back to Base.
  ok("previewVersion sets activeVersion + re-mounts (flushing in-flight edits)", /function previewVersion\(v\) \{ flushSave\(\); activeVersion = v; syncVersionSwitch\(\); mount\(\); \}/.test(e));
  ok("version badge distinguishes editing vs read-only (#207)", /label = editable \? \("Editing version · " \+ activeVersion\) : \("Previewing version · " \+ activeVersion \+ " · read-only"\)/.test(e));
  ok("composed badge offsets below the variant pill (FIX 4b)", /badge\.classList\.toggle\("is-composed", !!activeVariant\)/.test(e));
  ok("variant badge gates on the variant axis ONLY (no null badge in a version-only preview)", /var badge = document\.getElementById\("variant-preview-badge"\);\s*if \(!activeVariant\)/.test(e));
  ok("version menu offers 'Back to Base' as the editable-anchor return", /openVersionMenu[\s\S]{0,800}"Base \(edit\)"/.test(e));
  // canvas rings: teal version ring, split from the purple variant ring.
  ok("canvas toggles a distinct is-version-preview ring", /canvas\.classList\.toggle\("is-version-preview", !!activeVersion\)/.test(e));
  var css = src("editor.css");
  ok("editor.css defines the teal version preview ring + badge (DSLMS --preview-version)", /\.canvas\.is-version-preview \{ box-shadow: inset 0 0 0 3px #0e9384/.test(css) && /\.version-preview-badge \{/.test(css));
  var ds = src("design-system/tokens/colors.css");
  ok("DSLMS anchors the version-axis hue (--preview-version)", /--preview-version: var\(--teal-500\);/.test(ds));
})();

// #207 edit-in-active-version ("dynamic flagship"): an active non-base version is the EDITABLE
// flagship — inline canvas edits capture into base.versionOverrides[version] (diffed against
// base), base stays untouched, render/resolveVersion stay pure so editor==export holds.
(function () {
  section("#207 edit-in-version (pure resolveVersionForEdit + capture)");
  var rtxt = src("src/render.js");
  var slice = rtxt.slice(rtxt.indexOf("var VARIANT_AXIS"), rtxt.indexOf("// ---- interaction model normalisation"));
  var stub = {}; new Function("window", slice)(stub);
  var forEdit = stub.resolveVersionForEdit, pure = stub.resolveVersion;

  var mk = function () {
    return { versions: ["v1", "v2"], pages: [{ id: "p", blocks: [
      { type: "heading", text: "BASE_H", versionOverrides: { v2: { text: "V2_H" } } },
      { type: "frame", children: [ { type: "paragraph", text: "BASE_C" } ] }
    ] }] };
  };
  // 1) the edit tree carries the SAME rendered values as pure resolveVersion (editor==export).
  var doc = mk();
  var fe = forEdit(doc, "v2"), pv = pure(doc, "v2");
  ok("edit tree bakes the same top-level value as pure resolve", fe.pages[0].blocks[0].text === "V2_H" && pv.pages[0].blocks[0].text === "V2_H");
  // 2) EVERY node is a fresh clone (never a same-ref base node) carrying a __vbase back-link.
  ok("edit tree clones every block (never same-ref base)", fe.pages[0].blocks[1] !== doc.pages[0].blocks[1]);
  ok("edit-tree block carries a __vbase back-link to its base node", fe.pages[0].blocks[0].__vbase === doc.pages[0].blocks[0]);
  ok("edit-tree nested child carries __vbase too", fe.pages[0].blocks[1].children[0].__vbase === doc.pages[0].blocks[1].children[0]);
  ok("edit-tree page carries __vbase", fe.pages[0].__vbase === doc.pages[0]);
  // 3) __vbase is NON-ENUMERABLE (never serialises into storage/export).
  ok("__vbase is non-enumerable (won't serialise)", Object.keys(fe.pages[0].blocks[0]).indexOf("__vbase") === -1 && JSON.stringify(fe.pages[0].blocks[0]).indexOf("__vbase") === -1);
  // 4) editing the tree never mutates the base doc (values unchanged after a resolve).
  var before = JSON.stringify(doc); forEdit(doc, "v2");
  ok("resolveVersionForEdit does NOT mutate the base doc", JSON.stringify(doc) === before);

  // 5) setVersionOverrideField (the capture core) — extract + exercise diff + prune.
  var e = src("src/editor.js");
  var cap = e.slice(e.indexOf("function setVersionOverrideField(baseNode, version, field, value)"), e.indexOf("function writeModel(node, value)"));
  var setOv = new Function(cap + "\nreturn setVersionOverrideField;")();
  var node = { text: "BASE" };
  setOv(node, "v2", "text", "V2TXT");
  ok("capture writes versionOverrides[version][field]", node.versionOverrides.v2.text === "V2TXT");
  setOv(node, "v2", "text", "BASE"); // edit back to the base value
  ok("capture pruned when the edit equals base (no dead override)", !node.versionOverrides);
  setOv(node, "v2", "text", "X"); setOv(node, "v3", "text", "Y");
  ok("captures for different versions are independent", node.versionOverrides.v2.text === "X" && node.versionOverrides.v3.text === "Y");

  // 6) after a real capture, a pure resolve of BASE (v1) is unchanged; v2 bakes the captured edit.
  var live = mk();
  var baseBlock = live.pages[0].blocks[0];
  setOv(baseBlock, "v2", "text", "EDITED_IN_V2");
  ok("base (v1) resolve unaffected by a v2 capture", pure(live, "v1").pages[0].blocks[0].text === "BASE_H");
  ok("v2 resolve bakes the captured edit (export parity)", pure(live, "v2").pages[0].blocks[0].text === "EDITED_IN_V2");
})();

// #208 export bake: each product package bakes EVERY software version's DOM (resolveVersion per
// version on the product-resolved doc), booting to latest; media dedups across versions via the
// shared opts map; a 0-1 version course is byte-identical to before (no wrapper).
(function () {
  section("#208 export bakes all versions");
  var ex = src("src/export.js");
  var s = ex.slice(ex.indexOf("function serializeVersionedPages"), ex.indexOf("function escapeXml"));
  var win = { getVersions: function (d) { return d.versions || []; }, resolveVersion: function (d, v) { return { __v: v }; } };
  var calls = [], optsSeen = [];
  function serializePages(vdoc, ctx, opts) { calls.push(vdoc.__v); optsSeen.push(opts); opts._mediaUrlMap = opts._mediaUrlMap || {}; return "PAGES[" + vdoc.__v + "]"; }
  function escapeAttr(x) { return String(x); }
  var fn = new Function("window", "serializePages", "escapeAttr", s + "\nreturn serializeVersionedPages;")(win, serializePages, escapeAttr);

  var opts = {};
  var out = fn({ versions: ["v1", "v2", "v3"] }, {}, opts);
  ok("bakes ONE wrapper per version (3 versions -> 3)", (out.match(/class="scorm-version/g) || []).length === 3);
  ok("resolveVersion ran once per version", calls.join(",") === "v1,v2,v3");
  ok("latest (last-created) is the default/current, not hidden", /data-version="v3"[^>]*is-version-current[\s\S]*?data-default="1"/.test(out) || /class="scorm-version is-version-current" data-version="v3" data-default="1"/.test(out));
  ok("non-latest versions ship hidden", /data-version="v1"[^>]*hidden/.test(out) && /data-version="v2"[^>]*hidden/.test(out));
  ok("only the latest is current (single boot target)", (out.match(/is-version-current/g) || []).length === 1);
  ok("media dedups across versions: the SAME opts (with _mediaUrlMap) threads every version", optsSeen.every(function (o) { return o === opts; }) && !!opts._mediaUrlMap);
  // 0-1 versions => unchanged (no wrapper, exactly today's single-DOM markup).
  calls = [];
  var single = fn({ versions: ["only"] }, {}, {});
  ok("a single-version course emits NO version wrapper (byte-identical to before)", single.indexOf("scorm-version") === -1);
  var none = fn({}, {}, {});
  ok("a no-version course emits NO version wrapper", none.indexOf("scorm-version") === -1);
  // wired into the real assembly path.
  ok("assemblePackage serialises via serializeVersionedPages", /var pagesMarkup = serializeVersionedPages\(doc, ctx, opts\);/.test(ex));
})();

// #210 resume + per-version progress + course-level completion: the chosen version + per-version
// page progress persist to SCORM suspend_data; on relaunch the learner resumes into their version;
// completion is course-level (any single version's full pass; never un-completed by sampling).
(function () {
  section("#210 resume + per-version progress + course completion");
  var ex = src("src/export.js");
  ok("per-version progress state (progByVer)", /var __hasVers=__vwraps\.length>1, activeVersion=null, progByVer=\{\};/.test(ex));
  ok("show() records page-viewed progress PER VERSION", /if\(__hasVers\)\{ var __pv=progByVer\[activeVersion\]\|\|\(progByVer\[activeVersion\]=\{\}\); if\(pageIdList\[cur\]!=null\) __pv\[pageIdList\[cur\]\]=1;/.test(ex));
  ok("completion is course-level: a full per-version pass marks complete (guarded markComplete)", /if\(Object\.keys\(__pv\)\.length>=pages\.length\) markComplete\(\);/.test(ex));
  ok("markComplete is idempotent (sampling another version never un-completes)", /function markComplete\(\)\{ if\(completed\|\|!window\.SCORM\)return; completed=true;/.test(ex));
  ok("chosen version + progress persist to suspend_data", /function __persistState\(\)\{ if\(!__hasVers\|\|!window\.SCORM\) return; try\{ SCORM\.set\('cmi\.suspend_data', JSON\.stringify\(\{ v:activeVersion, prog:progByVer \}\)\);/.test(ex));
  ok("resume restores progress + keeps a recorded completion + drops into the chosen version", /function __resumeState\(\)\{[\s\S]{0,200}if\(st==='completed'\|\|st==='passed'\) completed=true;[\s\S]{0,220}if\(o\.v&&__wrapFor\(o\.v\)&&o\.v!==activeVersion\) selectVersion\(o\.v\);/.test(ex));
  ok("resume runs AFTER the deferred SCORM.init (preserves the LMS-freeze boot fix)", /function __scormInit\(\)\{ try\{ if\(window\.SCORM\) SCORM\.init\(\);[\s\S]{0,120}try\{ __resumeState\(\);/.test(ex));
  ok("state layer is gated on __hasVers (0-1 version courses unchanged, no suspend_data writes)", /function __persistState\(\)\{ if\(!__hasVers\|\|!window\.SCORM\) return;/.test(ex) && /function __resumeState\(\)\{ if\(!__hasVers\|\|!window\.SCORM\) return;/.test(ex));
})();

// #209 learner runtime: a system-injected title-page selector picks + LOCKS a software version;
// the runtime shows one version wrapper at a time, scoping nav + engine + quizzes to it; boots to
// latest. Guards on the exported RUNTIME_JS + SHELL_CSS (the real learner shell).
(function () {
  section("#209 learner version selector + runtime toggle + lock");
  var ex = src("src/export.js");
  ok("runtime detects version wrappers (multi only)", /var __vwraps=\[\]\.slice\.call\(document\.querySelectorAll\('\.scorm-version'\)\);/.test(ex) && /var __hasVers=__vwraps\.length>1/.test(ex));
  ok("boots to the default (latest) wrapper", /function __defWrap\(\)\{[\s\S]{0,220}getAttribute\('data-default'\)[\s\S]{0,120}__vwraps\[__vwraps\.length-1\]/.test(ex));
  ok("only the active version wrapper is shown; the rest hidden", /function __showWrap\(w\)\{ __vwraps\.forEach\(function\(x\)\{ var on=\(x===w\); x\.hidden=!on;/.test(ex));
  ok("pages are scoped to the active version wrapper (vscope)", /var pages=\[\]\.slice\.call\(vscope\.querySelectorAll\('\.scorm-page'\)\);/.test(ex));
  ok("nav id maps recompute per scope (__rescope)", /function __rescope\(\)\{ pages=\[\]\.slice\.call\(vscope\.querySelectorAll\('\.scorm-page'\)\)/.test(ex));
  ok("the engine is scoped to the active version wrapper (no cross-version id collision)", /window\.CourseRuntime\.create\(\{ root:vscope,/.test(ex));
  ok("quizzes init within the active version scope", /QuizRuntime\.init\(vscope\)/.test(ex));
  ok("selectVersion reveals + re-scopes + resets to the version's title page", /function selectVersion\(v\)\{ var w=__wrapFor\(v\); if\(!w\|\|v===activeVersion\) return; __showWrap\(w\); __rescope\(\); __makeEngine\(\);[\s\S]{0,120}cur=0; show\(0\);/.test(ex));
  ok("selector is injected on the title page (page 1) only -> locked per session (no mid-course control)", /function __injectSelector\(\)\{ if\(!__hasVers\) return; var title=pages\[0\];/.test(ex));
  ok("selector lists every version as a pill, active one marked", /className='scorm-version-opt'\+\(v===activeVersion\?' is-active':''\)[\s\S]{0,220}selectVersion\(v\)/.test(ex));
  ok("selector injected at boot after show(0)", /"  show\(0\);",\s*"  __injectSelector\(\);"/.test(ex));
  ok("SHELL_CSS styles the injected selector (teal, DSLMS --preview-version hue)", /\.scorm-version-select\{/.test(ex) && /\.scorm-version-opt\.is-active\{background:#0e9384/.test(ex));
  ok("hidden version wrappers do not display", /\.scorm-version\[hidden\]\{display:none;\}/.test(ex));
  ok("0-1 version course is unchanged: vscope=document, no selector", /var vscope=__hasVers\?\(__defWrap\(\)\|\|document\):document;/.test(ex));
})();

// #207 editor wiring: version becomes the editable flagship; capture routes through writeModel;
// versionVis tagging + a disabled inspector notice (no dead controls) while editing a version.
(function () {
  section("#207 edit-in-version (editor wiring)");
  var e = src("src/editor.js");
  ok("versionEditable(): a version is editable only when no variant preview is layered", /function versionEditable\(\) \{ return !!activeVersion && !activeVariant; \}/.test(e));
  ok("editable version uses the resolveVersionForEdit tree", /versionEditable\(\) && window\.resolveVersionForEdit\)\s*\? window\.resolveVersionForEdit\(d, activeVersion\)/.test(e));
  ok("enableEditing gate keys off !activeVariant (version = editable flagship)", (e.match(/if \(!activeVariant\) enableEditing\(world\);/g) || []).length >= 2);
  ok("writeModel captures into versionOverrides via __vbase when editing a version", /if \(versionEditable\(\) && obj && obj\.__vbase\) setVersionOverrideField\(obj\.__vbase, activeVersion, field, value\);\s*else obj\[field\] = value;/.test(e));
  ok("capture is undoable — the input handler pushHistory precedes writeModel", /pushHistory\(\);[\s\S]{0,120}hasPushedForFocus = true;[\s\S]{0,200}writeModel\(node,/.test(e));
  ok("versionVis show/hide tagging mirrors the variant Hide-in family", /function toggleHiddenInVersion\(node, version\)[\s\S]*?b\.versionVis/.test(e));
  ok("version tagging targets the BASE node (__vbase) not the display clone", /function versionBaseNode\(node\) \{ return \(node && node\.__vbase\) \|\| node; \}/.test(e));
  ok("block context menu adds a Software version show/hide section", /var versAll = versionNames\(\);[\s\S]{0,700}toggleHiddenInVersion\(host, v\)/.test(e));
  ok("FIX 2: editing a version disables inert block controls with a reason", /function applyVersionEditGuard\(\)[\s\S]*?is-version-readonly-panel[\s\S]*?version-edit-notice/.test(e));
  ok("FIX 2: the field (inline text) inspector stays live — only block/instance/embed are disabled", /\["block", "instance", "embed"\]\.indexOf\(selection\.type\) === -1\) return;/.test(e));
  ok("FIX 3: switching version flushes an in-flight edit", (e.match(/flushSave\(\);/g) || []).length >= 3 && /function onVersionPick\(v\) \{\s*flushSave\(\);/.test(e));
  ok("editable badge uses the 'type' glyph (editing this version's text)", /Ic\("type"\)/.test(e));
  var css = src("editor.css");
  ok("editor.css disables the version-readonly inspector + styles the notice", /#inspector\.is-version-readonly-panel > \*:not\(\.version-edit-notice\)/.test(css) && /\.version-edit-notice \{/.test(css));
})();

// §96 cross-file paste dependency carry — collect referenced custom styles/components,
// merge add-if-missing into the target doc.
(function () {
  section("§96 cross-file paste deps");
  var ed = src("src/editor.js");
  var css = src("editor.css");
  var m = ed.match(/\/\* @pastedeps-start \*\/([\s\S]*?)\/\* @pastedeps-end \*\//);
  ok("pastedeps region is extractable", !!m);
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var api = new Function("clone", m[1] + "\nreturn { collect: collectPasteDeps, merge: mergePasteDeps };")(clone);

  // A copied subtree: a text block with a CUSTOM styleRef + a componentGrid + a nested
  // per-field styleRef host + a STANDARD styleRef the source doc doesn't own.
  var blocks = [
    { type: "heading", styleRef: "BrandHeading", titleStyle: { styleRef: "BrandSub" } },
    { type: "componentGrid", component: "threatCard", instances: [{}] },
    { type: "paragraph", styleRef: "Body" } // standard — not in srcStyles -> NOT carried
  ];
  var srcStyles = { BrandHeading: { size: 40 }, BrandSub: { size: 12 } };
  var srcComponents = { threatCard: { root: { type: "frame" } } };
  var deps = api.collect(blocks, srcStyles, srcComponents);
  ok("collect grabs custom styleRef", deps.styles.BrandHeading && deps.styles.BrandHeading.size === 40);
  ok("collect walks nested per-field styleRef host", !!deps.styles.BrandSub);
  ok("collect skips standard styleRef absent from source", deps.styles.Body === undefined);
  ok("collect grabs componentGrid component def", deps.components.threatCard && deps.components.threatCard.root.type === "frame");

  // Merge into a target that has NEITHER -> both added.
  var tS = {}, tC = {};
  var added = api.merge(deps, tS, tC);
  ok("merge adds missing style", tS.BrandHeading && tS.BrandHeading.size === 40 && added.styles.indexOf("BrandHeading") >= 0);
  ok("merge adds missing component", tC.threatCard && added.components.indexOf("threatCard") >= 0);
  ok("merge is a deep copy (no shared ref with source)", tS.BrandHeading !== deps.styles.BrandHeading);

  // Merge must NOT clobber a same-named def the target already owns (adopt target's).
  var tS2 = { BrandHeading: { size: 99 } }, tC2 = {};
  var added2 = api.merge(deps, tS2, tC2);
  ok("merge never overwrites an existing target style", tS2.BrandHeading.size === 99 && added2.styles.indexOf("BrandHeading") === -1);
  ok("merge still adds the other missing style", tS2.BrandSub && added2.styles.indexOf("BrandSub") >= 0);

  // slice 2 wiring: a held PAGE routes Cmd+V to pastePage; block copy clears the page hold.
  ok("copySelection copies a whole page on a page selection", /selection\.type === "page"[\s\S]*pageClipboard = \{ page: clone\(pg\)/.test(ed));
  ok("pasteClipboard routes to pastePage when a page is held", /if \(pageClipboard && !clipboard\.length\) return pastePage\(\);/.test(ed));
  ok("pastePage re-homes the page into the anchor's chapter", /copy\.chapterId = anchor \?/.test(ed));
  ok("pastePage carries custom styles\/components (add-if-missing)", /function pastePage[\s\S]*mergePasteDeps\(pageClipboard\.deps/.test(ed));

  // CSV-import HF fix: the house header/footer default wins over the CSV's HF; but only
  // when a default exists (forNewDoc returns null otherwise, leaving the CSV HF alone).
  var sc = src("src/schema.js");
  ok("importSchema keeps the house header/footer on import", /window\.__hfDefault\.forNewDoc\(root\.meta[\s\S]*if \(hf\) root\.headerFooter = hf;[\s\S]*setDoc\(root\)/.test(sc));
  ok("forNewDoc returns null when no house default is set", /forNewDoc = function[\s\S]*return saved \? headerFooterFromDefault\(saved, title\) : null;/.test(ed));

  // switchDoc must drop the outgoing doc's selection/page cursor (else a stale page
  // index crashes renderPageInspector on the new doc — hit via cross-file page paste).
  ok("switchDoc resets selection + page cursor before mount", /function switchDoc[\s\S]*clearSelection\(\); clearMultiPages\(\); multiSel = \[\]; currentPage = 0;[\s\S]*mount\(\);/.test(ed));
  ok("renderPageInspector guards a stale/out-of-range page index", /function renderPageInspector\(pi\) \{\s*var page = doc\.pages\[pi\];\s*if \(!page\) return;/.test(ed));

  // Variant UX: switchDoc must refresh the top-bar variant pill + drop a stale variant;
  // the variant-text field placeholder shows the flagship copy with tags stripped.
  ok("switchDoc rebuilds the top-bar variant pill for the new doc", /function switchDoc[\s\S]*mount\(\);\s*renderTabs\(\);\s*renderVariantSwitch\(\);/.test(ed));
  ok("switchDoc drops a variant the new doc doesn't have", /if \(activeVariant && \(doc\.variants \|\| \[\]\)\.indexOf\(activeVariant\) === -1\) activeVariant = null;/.test(ed));
  ok("variant-text placeholder strips flagship HTML tags", /input\.placeholder = stripToText\(baseFieldValue\(t\.host, f\)\);/.test(ed));
  ok("variant text-bearing field is an auto-growing textarea", /var multiline = !f\.isSlot \|\| \/obj\|desc\|body\|summary\|para\|text\/i\.test\(f\.key\);[\s\S]*multiline \? h\("textarea", "prop-input prop-input--grow"\)/.test(ed));
  ok("autoGrowVariant measures with a hidden mirror (never mutates the live field)", /function autoGrowVariant\(ta\)[\s\S]*autoGrowVariant\._mirror[\s\S]*m\.textContent = \(ta\.value \|\| ta\.placeholder \|\| ""\)/.test(ed) && !/ta\.value = ta\.placeholder/.test(ed));
  ok("autoGrowVariant caps the height at 320px", /Math\.min\(Math\.max\(m\.scrollHeight, 32\), 320\)/.test(ed));

  // Find & replace: a variant target selector routes replacements to overrides for the
  // chosen variant (and previews it); the core is scoped on frVariant, not activeVariant.
  ok("F&R dialog targets a chosen frVariant", /var frVariant = activeVariant \|\| "";/.test(ed) && /frCore\.write\(t, frVariant/.test(ed) && /frCore\.targets\(doc, frVariant\)/.test(ed));
  ok("F&R variant selector previews the chosen layer on the canvas", /var vsel = dsSelect\([\s\S]*previewVariant\(frVariant \|\| null\)/.test(ed));
  ok("no stray activeVariant in the F&R replace ops", !/frCore\.write\(t, activeVariant/.test(ed));

  // Obvious variant-preview highlight: an inset ring + a floating badge naming the variant.
  ok("updateVariantBadge shows a canvas badge while previewing a variant", /function updateVariantBadge\(\)[\s\S]*variant-preview-badge[\s\S]*"Previewing variant · " \+ activeVariant/.test(ed));
  ok("updateVariantBadge is called at the variant-preview toggle", /canvas\.classList\.toggle\("is-variant-preview"[\s\S]*updateVariantBadge\(\);/.test(ed));
  ok("editor.css styles the variant badge + bold preview ring", /\.variant-preview-badge\b/.test(css) && /\.canvas\.is-variant-preview \{ box-shadow:/.test(css));
})();

// §101 alignment-grid overlay — editor chrome only, view pref, active-page only.
(function () {
  section("§101 alignment grid overlay");
  var ed = src("src/editor.js");
  var css = src("editor.css");
  var idx = src("index.html");
  var courseCss = src("src/course.css");
  ok("grid mode is a localStorage VIEW pref (GRID_KEY)", /GRID_KEY\s*=\s*"authoring\.gridMode"/.test(ed));
  ok("cycle order off->thirds->quarters->columns->fine", /GRID_MODES\s*=\s*\[\s*"off",\s*"thirds",\s*"quarters",\s*"columns",\s*"fine"\s*\]/.test(ed));
  ok("cycleGrid wraps modulo the mode list", /gridMode\s*=\s*GRID_MODES\[\(GRID_MODES\.indexOf\(gridMode\)\s*\+\s*1\)\s*%\s*GRID_MODES\.length\]/.test(ed));
  ok("overlay seeded on the ACTIVE page only", /i === currentPage && gridMode !== "off"\) frame\.appendChild\(makeGridOverlay\(\)\)/.test(ed));
  ok("active-page change re-places the overlay", /function setActivePage[\s\S]*refreshGridOverlay\(\);/.test(ed));
  ok("grid-toggle button present with an offline Lucide glyph", /id="grid-toggle"[^>]*data-lucide="grid-2x2"/.test(idx));
  ok("editor.css defines all 4 preset overlays", /\.grid-overlay--thirds/.test(css) && /\.grid-overlay--quarters/.test(css) && /\.grid-overlay--columns/.test(css) && /\.grid-overlay--fine/.test(css));
  ok("overlay is click-through (pointer-events:none)", /\.grid-overlay\s*\{[^}]*pointer-events:\s*none/.test(css));
  ok("grid overlay NEVER ships in SCORM (course.css clean)", courseCss.indexOf("grid-overlay") === -1);
})();

// ---- §286 media auto-optimise (pure decision logic) ----------------------
(function () {
  section("§286 media-optimise helpers");
  var M = require(path.join(ROOT, "src/media-optim.js"));
  var p = M.parseDataUrl("data:image/png;base64,AAAA");
  ok("parseDataUrl reads mime + base64 flag", p && p.mime === "image/png" && p.base64 === true);
  ok("parseDataUrl null for non-data string", M.parseDataUrl("asset:x") === null);
  ok("png/jpeg/webp/gif are optimisable-mime", M.isOptimisableMime("image/png") && M.isOptimisableMime("image/jpeg") && M.isOptimisableMime("image/webp") && M.isOptimisableMime("image/gif"));
  ok("svg/video NOT optimisable", !M.isOptimisableMime("image/svg+xml") && !M.isOptimisableMime("video/mp4"));
  // GIF frame walker: static (1 frame) vs animated (2 frames)
  var gifStatic = new Uint8Array([71,73,70,56,57,97, 1,0,1,0,0,0,0, 44,0,0,0,0,1,0,1,0,0, 2, 1,0, 0, 59]);
  var gifAnim = new Uint8Array([71,73,70,56,57,97, 1,0,1,0,0,0,0, 44,0,0,0,0,1,0,1,0,0, 2, 1,0, 0, 44,0,0,0,0,1,0,1,0,0, 2, 1,0, 0, 59]);
  ok("gifFrameCount static gif = 1", M.gifFrameCount(gifStatic) === 1);
  ok("gifFrameCount animated gif >= 2", M.gifFrameCount(gifAnim) >= 2);
  ok("isAnimatedGif static = false", M.isAnimatedGif(gifStatic) === false);
  ok("isAnimatedGif animated = true", M.isAnimatedGif(gifAnim) === true);
  ok("gifFrameCount non-gif = 0", M.gifFrameCount(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13])) === 0);
  ok("targetFormat gif -> webp", M.targetFormat("image/gif") === "image/webp");
  var f = M.fitWithin(4000, 3000, 2000);
  ok("fitWithin caps longest edge to maxDim", f.w === 2000 && f.h === 1500);
  ok("fitWithin never upscales a small image", (function () { var r = M.fitWithin(800, 600, 2000); return r.w === 800 && r.h === 600; })());
  ok("fitWithin off (maxDim 0) leaves size untouched", (function () { var r = M.fitWithin(4000, 3000, 0); return r.w === 4000 && r.h === 3000; })());
  ok("fitWithin caps a portrait by its height edge", (function () { var r = M.fitWithin(1000, 4000, 2000); return r.w === 500 && r.h === 2000; })());
  ok("targetFormat jpeg stays jpeg", M.targetFormat("image/jpeg") === "image/jpeg");
  ok("targetFormat png -> webp", M.targetFormat("image/png") === "image/webp");
  ok("worthTaking accepts a real saving", M.worthTaking(1000000, 800000) === true);
  ok("worthTaking rejects a tiny (<10KB) saving", M.worthTaking(1000000, 995000) === false);
  ok("worthTaking rejects an inflation", M.worthTaking(100000, 120000) === false);
  var ex = src("src/export.js");
  ok("buildPackage runs the optimise pre-pass before assembling", /window\.MediaOptim\.buildOptimMap\(doc,/.test(ex) && /opts\._optimMap = res/.test(ex));
  ok("serializePages prefers the optimised dataUrl", /var dataUrl = \(optimMap && optimMap\[id\]\) \|\|/.test(ex));
  ok("defaultOptions ships optimiseMedia on with caps", /optimiseMedia: true, maxImageDim: 2000, imageQuality: 0\.85/.test(ex));

  // ---- #193 externalise media: heavy binary media -> files in the same zip -------
  ok("defaultOptions ships externalizeMedia on", /externalizeMedia: true/.test(ex));
  ok("resolver externalises only binary media (svg/html stay inline)", /if \(!isExternalizableMime\(dataUrlMime\(dataUrl\)\)\) return dataUrl/.test(ex));
  ok("isExternalizableMime = raster image / video / audio (NOT svg/html)", /function isExternalizableMime\(mime\)[\s\S]*?image\\\/\(png\|jpe\?g\|gif\|webp\|avif\)[\s\S]*?video\\\/[\s\S]*?audio\\\//.test(ex));
  ok("externalised ref becomes a relative media/<id>.<ext> URL", /var name = "media\/" \+ safeAssetName\(id\) \+ "\." \+ mediaExt\(dataUrlMime\(dataUrl\)\)/.test(ex));
  ok("media files pushed into the SAME zip before the manifest names", /\(opts\._mediaFiles \|\| \[\]\)\.forEach\(function \(f\) \{ files\.push\(f\); \}\);[\s\S]*?var names = files\.map/.test(ex));
  ok("decode failure keeps media inline (never lose media)", /var bytes = dataUrlToBytes\(dataUrl\);\s*if \(!bytes\) return dataUrl;/.test(ex));
  ok("asset reused across pages is written once (dedup)", /if \(mediaUrlMap\[id\]\) return mediaUrlMap\[id\];/.test(ex));
  ok("media-optim.js loaded before export.js", /src\/media-optim\.js[\s\S]*src\/export\.js/.test(src("index.html")));
  var mo = src("src/media-optim.js");
  ok("buildOptimMap reads assets via getAsset (non-destructive)", /getAsset\(id\)/.test(mo) && !/AssetStore\.\w+\s*=[^=]/.test(mo));

  // ---- animated-GIF re-encode: pure helpers + vendored codec round-trip ----
  // (the DOM canvas path optimiseAnimatedGif is browser-verified; these guard the
  // decision logic + the omggif read/write wiring headlessly.)
  ok("q>=0.9 -> 256 colours, every frame", JSON.stringify(M.gifParamsForQuality(0.92)) === JSON.stringify({ colors: 256, frameStep: 1 }));
  ok("q>=0.8 -> 128 colours, every frame", JSON.stringify(M.gifParamsForQuality(0.85)) === JSON.stringify({ colors: 128, frameStep: 1 }));
  ok("q small -> 64 colours, every OTHER frame", JSON.stringify(M.gifParamsForQuality(0.7)) === JSON.stringify({ colors: 64, frameStep: 2 }));
  // decimation preserves total duration (dropped delays merge into the kept frame)
  var dec = M.decimatedFrames([10, 10, 20, 5], 2);
  ok("decimate halves frame count (ceil)", dec.length === 2 && dec[0].index === 0 && dec[1].index === 2);
  ok("decimate merges dropped delays (duration kept)", dec[0].delay === 20 && dec[1].delay === 25);
  ok("decimate step 1 keeps every frame + delay", (function () { var d = M.decimatedFrames([10, 20, 30], 1); return d.length === 3 && d[2].delay === 30; })());
  // median-cut: exact power-of-2 palette length; captures the source colours
  var rgb = []; for (var i = 0; i < 40; i++) rgb.push(255, 0, 0); for (var i = 0; i < 40; i++) rgb.push(0, 255, 0);
  var pal = M.medianCutPalette(rgb, 64);
  ok("medianCutPalette returns exactly maxColors entries", pal.length === 64);
  ok("medianCutPalette captures red + green", pal.some(function (c) { return ((c >> 16) & 255) > 200 && ((c >> 8) & 255) < 60; }) && pal.some(function (c) { return ((c >> 8) & 255) > 200 && ((c >> 16) & 255) < 60; }));
  // LUT maps a colour to its nearest palette entry
  var lut = M.buildPaletteLut(pal);
  ok("palette LUT maps red -> a red entry", (function () { var c = pal[M.lutIndex(lut, 255, 0, 0)]; return ((c >> 16) & 255) > 200 && ((c >> 8) & 255) < 60; })());
  ok("palette LUT maps green -> a green entry", (function () { var c = pal[M.lutIndex(lut, 0, 255, 0)]; return ((c >> 8) & 255) > 200 && ((c >> 16) & 255) < 60; })());
  // vendored codec (omggif) round-trips frames / delays / loop losslessly
  var GC = require(path.join(ROOT, "src/gif-codec.js"));
  ok("gif-codec exposes GifReader + GifWriter", typeof GC.GifReader === "function" && typeof GC.GifWriter === "function");
  var wbuf = [], gw = new GC.GifWriter(wbuf, 2, 2, { loop: 0, palette: [0xff0000, 0x00ff00, 0x0000ff, 0x000000] });
  gw.addFrame(0, 0, 2, 2, [0, 0, 0, 0], { delay: 5, disposal: 1 });
  gw.addFrame(0, 0, 2, 2, [1, 1, 1, 1], { delay: 7, disposal: 1 });
  gw.addFrame(0, 0, 2, 2, [2, 2, 2, 2], { delay: 9, disposal: 1 });
  var glen = gw.end(), gr = new GC.GifReader(Uint8Array.from(wbuf.slice(0, glen)));
  ok("codec preserves frame count", gr.numFrames() === 3);
  ok("codec preserves per-frame delays", gr.frameInfo(0).delay === 5 && gr.frameInfo(2).delay === 9);
  ok("codec preserves loop count", gr.loopCount() === 0);
  ok("codec preserves frame pixel colour (green f1)", (function () { var px = new Uint8Array(16); gr.decodeAndBlitFrameRGBA(1, px); return px[0] === 0 && px[1] === 255 && px[2] === 0; })());
  // wiring: animated GIF now routes to the GIF re-encoder (was an unconditional skip)
  ok("optimiseImage routes animated GIF to optimiseAnimatedGif when codec present", /if \(gb && isAnimatedGif\(gb\)\) \{[\s\S]*?window\.GifCodec[\s\S]*?optimiseAnimatedGif\(dataUrl, opts\)/.test(mo));
  ok("optimiseAnimatedGif verifies frame count of the re-encode before accepting", /check\.numFrames\(\) !== kept\.length/.test(mo));
  ok("gif-codec.js loaded before media-optim.js", /src\/gif-codec\.js[\s\S]*src\/media-optim\.js/.test(src("index.html")));
})();

// ---- per-breakpoint page side padding (applyPagePadding) ------------------
(function () {
  section("per-breakpoint page side padding");
  var t = src("src/render.js");
  var body = t.slice(t.indexOf("function applyPagePadding(root, page)"), t.indexOf("window.applyPagePadding"));
  var applyPagePadding = new Function("return (" + body + ")")();
  function run(page) {
    var vars = {};
    var root = { style: { setProperty: function (k, v) { vars[k] = v; } } };
    applyPagePadding(root, page);
    return vars;
  }
  // padX only -> all three breakpoints inherit desktop (unchanged legacy behaviour)
  var a = run({ padX: 20 });
  ok("padX only sets desktop var", a["--page-pad-x"] === "20%");
  ok("padX only -> tablet inherits desktop", a["--page-pad-x-tablet"] === "20%");
  ok("padX only -> mobile inherits desktop", a["--page-pad-x-mobile"] === "20%");
  // per-breakpoint overrides
  var b = run({ padX: 20, padXTablet: 8, padXMobile: 4 });
  ok("padXTablet overrides tablet var", b["--page-pad-x-tablet"] === "8%");
  ok("padXMobile overrides mobile var", b["--page-pad-x-mobile"] === "4%");
  ok("desktop stays padX with overrides present", b["--page-pad-x"] === "20%");
  // tablet set, mobile falls back to desktop
  var c = run({ padX: 20, padXTablet: 8 });
  ok("mobile falls back to desktop when unset", c["--page-pad-x-mobile"] === "20%");
  ok("tablet uses its own value", c["--page-pad-x-tablet"] === "8%");
  // nothing set -> no vars emitted (course.css defaults apply)
  var d = run({});
  ok("no padding fields -> no side-pad vars set", d["--page-pad-x"] === undefined && d["--page-pad-x-tablet"] === undefined && d["--page-pad-x-mobile"] === undefined);
  // padY still single-value
  ok("padY sets the vertical var", run({ padY: 40 })["--page-pad-y"] === "40px");
  // editor inspector wiring + split-page inheritance
  var ed = src("src/editor.js");
  ok("inspector writes per-breakpoint padX keys", /pagePadX\("padX"/.test(ed) && /pagePadX\("padXTablet"/.test(ed) && /pagePadX\("padXMobile"/.test(ed));
  ok("split-page carries padXTablet/padXMobile", /newPage\.padXTablet = P\.padXTablet/.test(ed) && /newPage\.padXMobile = P\.padXMobile/.test(ed));
})();

// ---- #62 canvas gap affordance (add / merge between stacked pages) --------
(function () {
  section("#62 page-gap affordance");
  var e = src("src/editor.js"), css = src("editor.css"), ic = src("src/icons.js");
  ok("buildGapAffordances only spans same-column adjacent pages", /function buildGapAffordances[\s\S]*?framePos\[i\]\.col !== framePos\[i \+ 1\]\.col\) continue/.test(e));
  ok("gap Add wired to addPageAfter(pi)", /addBtn\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); addPageAfter\(pi\); \}\)/.test(e));
  ok("gap Merge wired to mergePageWithNext(pi)", /mergeBtn\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); mergePageWithNext\(pi\); \}\)/.test(e));
  ok("gap affordances suppressed in variant/language preview", /function buildGapAffordances[\s\S]*?if \(isPreview\(\)\) return;/.test(e));
  ok("gap affordances build in BOTH modes (before the Interact-only return)", /layoutColumns\(\);[\s\S]*?buildGapAffordances\(\);[\s\S]*?if \(!interactMode\) return;/.test(e));
  ok("addPageAfter inherits the reference page's chapter", /function addPageAfter\(pi\)[\s\S]*?if \(ref && ref\.chapterId != null\) newPage\.chapterId = ref\.chapterId/.test(e));
  ok("addPageAfterCurrent delegates to addPageAfter", /function addPageAfterCurrent\(\) \{ addPageAfter\(currentPage\); \}/.test(e));
  ok("page-gap css: hidden tools revealed on hover", /\.page-gap__tools \{[\s\S]*?opacity: 0;[\s\S]*?\}\s*\.page-gap:hover \.page-gap__tools \{ opacity: 1;/.test(css));
  ok("fold-vertical merge glyph present", /"fold-vertical":/.test(ic));
  // spacing consistency: per-frame ResizeObserver re-stacks the column on height change
  ok("observeFrames wires a ResizeObserver to every frame", /function observeFrames\(\)[\s\S]*?new ResizeObserver\(scheduleRestack\)[\s\S]*?frameDescs\.forEach\(function \(f\) \{ if \(f\.frame\) frameRO\.observe\(f\.frame\)/.test(e));
  ok("restack is coalesced to one animation frame", /function scheduleRestack\(\)[\s\S]*?if \(restackRaf\) return;[\s\S]*?requestAnimationFrame\(function \(\) \{[\s\S]*?drawConnectors\(\)/.test(e));
  ok("buildWorld observes frames after building them", /observeFrames\(\); \/\/ re-stack the column/.test(e));
  ok("mount re-stacks after fitEmbeds (embed heights change post-measure)", /fitEmbeds\(\);[\s\S]*?re-stack so the pages[\s\S]*?drawConnectors\(\);\s*\n\s*renderStructure\(\);/.test(e));
})();

// ---- #101 follow-on: footer guided tour (coach-marks) --------------------
(function () {
  section("guided tour (coach-marks)");
  var rsrc = src("src/render.js");
  // pure copy resolver: extract TOUR_DEFAULTS + tourItemCopy and exercise the fallback
  var mDef = rsrc.match(/var TOUR_DEFAULTS = \{[\s\S]*?\n  \};/);
  var mFn = rsrc.match(/function tourItemCopy\(tour, key\) \{[\s\S]*?\n  \}/);
  ok("render.js exposes TOUR_DEFAULTS + tourItemCopy", !!mDef && !!mFn);
  if (mDef && mFn) {
    var tourCopy = new Function(mDef[0] + "\n" + mFn[0] + "\nreturn tourItemCopy;")();
    ok("default copy when no override", tourCopy(null, "menu").title === "Menu & tools" && /progress/i.test(tourCopy(null, "menu").desc));
    ok("author override wins for the set field", tourCopy({ items: { menu: { title: "Hi" } } }, "menu").title === "Hi");
    ok("unset sibling field still falls back", tourCopy({ items: { menu: { title: "Hi" } } }, "menu").desc === tourCopy(null, "menu").desc);
    ok("empty-string override ignored (falls back)", tourCopy({ items: { menu: { title: "" } } }, "menu").title === "Menu & tools");
    ok("unknown key -> blank, no throw", tourCopy(null, "nope").title === "" && tourCopy(null, "nope").desc === "");
  }
  // render emission: gated on block.tour.on, one marker per present control, trigger page stamped
  ok("render gates markers on block.tour.on", /if \(block\.tour && block\.tour\.on\)/.test(rsrc));
  ok("render stamps data-tour-page trigger", /setAttribute\("data-tour-page", block\.tour\.page \|\| ""\)/.test(rsrc));
  ok("render targets all five footer controls", /course-nav__prev[\s\S]{0,160}course-nav__mode[\s\S]{0,160}course-nav__progress-main[\s\S]{0,160}course-nav__glossary[\s\S]{0,160}course-nav__next/.test(rsrc));
  ok("render marker DOM is a .course-tour with dot/conn/label", /el\("span", "course-tour"\)/.test(rsrc) && /course-tour__dot/.test(rsrc) && /course-tour__conn/.test(rsrc) && /course-tour__label/.test(rsrc));
  ok("tour copy stamped for translation (stampChrome)", /stampChrome\(el\("span", "course-tour__title"/.test(rsrc));
  // runtime wiring: reveal on trigger page (every visit) + accordion dot interactions
  var run = src("src/runtime.js");
  ok("runtime reads the trigger page", /var tourPage = bar\.getAttribute\("data-tour-page"\)/.test(run));
  ok("runtime toggles .is-tour-live per visit", /classList\.toggle\("is-tour-live", live\)/.test(run));
  ok("runtime binds accordion dot clicks", /course-tour__dot[\s\S]{0,600}closeTour\(open \? m : null\)/.test(run));
  // course.css: hidden until live, tokens-only (no raw accent hex)
  var css = src("src/course.css");
  ok("css hides markers until .is-tour-live", /\.course-tour \{[\s\S]{0,200}visibility: hidden/.test(css) && /\.course-nav\.is-tour-live \.course-tour \{ visibility: visible/.test(css));
  ok("css tour colours are theme tokens (no raw hex)", /\.course-tour__core \{[\s\S]{0,120}var\(--color-accent\)/.test(css) && !/course-tour[\s\S]*?#[0-9a-fA-F]{3,6}/.test(css.slice(css.indexOf(".course-tour"), css.indexOf("/* disclaimer footer"))));
  ok("css label is LEFT-aligned with Exo title / body copy", /\.course-tour__inner \{[\s\S]{0,240}text-align: left/.test(css) && /\.course-tour__title \{[\s\S]{0,160}var\(--font-heading\)/.test(css) && /\.course-tour__desc \{[\s\S]{0,160}var\(--font-body\)/.test(css));
  ok("css label surface mirrors the sibling popovers (nav-surface token)", /\.course-tour__inner \{[\s\S]{0,240}var\(--nav-surface-default/.test(css));
  ok("css label honours the runtime clamp shift var", /\.course-tour__label \{[\s\S]{0,200}translateX\(calc\(-50% \+ var\(--tour-shift/.test(css));
  // A CLOSED label must be OUT of layout (display:none), else its 300px box on a
  // right-gutter control spills past the page edge -> a constant horizontal-scroll
  // gutter on every tour page. It only lays out (display:block) once .is-open.
  ok("closed tour label is display:none (no h-scroll gutter); opens on .is-open", /display: none;\s*\}\s*\.course-tour__label\.is-open \{ display: block;/.test(css));
  ok("runtime clamps the tour label inside the frame", /function clampTourLabel\(label\)/.test(run) && /setProperty\("--tour-shift"/.test(run) && /getBoundingClientRect\(\)/.test(run));
  ok("runtime re-clamps open labels on resize", /addEventListener\("resize", function \(\) \{ qsAll\(bar, "\.course-tour__label\.is-open"\)\.forEach\(clampTourLabel\)/.test(run));
  // editor wiring: the Guided tour nest (enable toggle + page picker + per-marker copy)
  var ed = src("src/editor.js");
  ok("editor adds the Guided tour sub-disclosure", /subDisclosure\("nav\.tour", "Guided tour"/.test(ed));
  ok("editor tour toggle seeds child.tour on enable", /child\.tour\.on = true;[\s\S]{0,160}child\.tour\.page = /.test(ed));
  ok("editor tour nest has a page picker + per-marker copy", /function navTourNest\(child, host\)/.test(ed) && /Show on page/.test(ed) && /headerFooterTextRow\("Title", it, "title"/.test(ed));
})();

// ---- #131: merge stacked text boxes (pure gate + join) --------------------
section("#131 merge text boxes");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/\/\* @merge-text-start \*\/([\s\S]*?)\/\* @merge-text-end \*\//);
  if (!m) { ok("locate @merge-text fence", false); return; }
  var g = new Function(m[1] + "\nreturn { canMergeTextBoxes: canMergeTextBoxes, mergeTextValues: mergeTextValues, TEXT_STYLE_TYPES: TEXT_STYLE_TYPES };")();
  var can = g.canMergeTextBoxes, join = g.mergeTextValues;
  // gate: needs >=2 blocks, and EVERY block a text-style type
  ok("gate: two paragraphs -> mergeable", can([{ type: "paragraph" }, { type: "paragraph" }]) === true);
  ok("gate: mixed text types -> mergeable", can([{ type: "heading" }, { type: "quote" }, { type: "list" }]) === true);
  ok("gate: one block -> not mergeable", can([{ type: "paragraph" }]) === false);
  ok("gate: empty selection -> not mergeable", can([]) === false && can(null) === false);
  ok("gate: any non-text block -> not mergeable", can([{ type: "paragraph" }, { type: "image" }]) === false);
  ok("gate: every text style type is eligible", Object.keys(g.TEXT_STYLE_TYPES).every(function (ty) { return can([{ type: ty }, { type: ty }]); }));
  // #143 join: fold bodies with a DOUBLE <br> (blank line between former boxes), skipping
  // empties; pure (round-trippable HTML string)
  ok("#143 join: two bodies joined by a blank line (<br><br>)", join(["one", "two"]) === "one<br><br>two");
  ok("#143 join: preserves inline rich HTML verbatim", join(["<strong>a</strong>", "b <em>c</em>"]) === "<strong>a</strong><br><br>b <em>c</em>");
  ok("#143 join: empty bodies dropped (no stray break)", join(["a", "", "b"]) === "a<br><br>b");
  ok("#143 join: null/undefined bodies dropped", join(["a", null, undefined, "b"]) === "a<br><br>b");
  ok("join: single body -> itself", join(["only"]) === "only");
  ok("join: all empty -> empty string", join(["", ""]) === "");
  ok("join: null input null-safe", join(null) === "" && join(undefined) === "");
  // wiring: exposed in the floating bar, canvas context menu, and outline multi menu
  ok("wiring: floating multi toolbar shows Merge (gated)", /function showMultiToolbar\(\)[\s\S]{0,260}canMergeTextBoxes\(multiSel\)[\s\S]{0,140}iconBtn\("merge", "Merge text boxes"\)/.test(t));
  ok("wiring: renderInspector multi branch shows the bar", /multiSel\.length >= 2\) \{ renderMultiInspector\(\); renderVariantOverrides\(\); showMultiToolbar\(\);/.test(t));
  ok("wiring: canvas context menu multi branch offers Merge", /inMulti\(target\.block\) && multiSel\.length >= 2[\s\S]{0,220}canMergeTextBoxes\(multiSel\)[\s\S]{0,80}"Merge text boxes"/.test(t));
  ok("wiring: outline multi menu offers Merge", /multi && canMergeTextBoxes\(multiSel\)[\s\S]{0,80}"Merge text boxes"/.test(t));
  // action: writes the join into the survivor + shared-parent guard (mirrors groupMulti)
  ok("action: mergeTextBoxes folds into the survivor via mergeTextValues", /survivor\.text = mergeTextValues\(locs\.map\(function \(l\) \{ return l\.block\.text; \}\)\);/.test(t));
  ok("action: mergeTextBoxes gates on canMergeTextBoxes + pushHistory", /function mergeTextBoxes\(\) \{\s*if \(!canMergeTextBoxes\(multiSel\)\) return;/.test(t) && /function mergeTextBoxes\(\)[\s\S]{0,900}pushHistory\(\);/.test(t));
})();

// ---- #120: inline styles (1/4) — render resolves data-style-ref spans -----
section("#120 inline styles: render + sanitize");
(function () {
  var r = src("src/render.js");
  var m = r.match(/\/\* @inline-style-start \*\/([\s\S]*?)\/\* @inline-style-end \*\//);
  if (!m) { ok("locate @inline-style fence", false); return; }
  // prelude: the two fns close over FONT_STACKS + window.__docStyles — inject stubs.
  var prelude = "var FONT_STACKS = { 'Exo 2': \"'Exo 2', sans-serif\" };\n" +
    "var window = { __docStyles: null };\n";
  var g = new Function(prelude + m[1] + "\nreturn { applyInlineTextStyle: applyInlineTextStyle, resolveInlineStyles: resolveInlineStyles, setDocStyles: function (s) { window.__docStyles = s; } };")();
  function makeStyle() { var s = {}; s.removeProperty = function (k) { delete s[k]; }; s.setProperty = function (k, v) { s[k] = v; }; return s; }
  function fakeNode() { return { style: makeStyle() }; }
  var apply = g.applyInlineTextStyle;
  // text-only subset APPLIED, layout props DROPPED
  var n = fakeNode();
  apply(n, { font: "Exo 2", size: 20, weight: "700", italic: true, colorToken: "accent", textTransform: "uppercase", letterSpacing: 2, wordSpacing: 3, align: "center", lineHeight: 1.5, textIndent: 12 });
  ok("inline sets font-family", n.style.fontFamily === "'Exo 2', sans-serif");
  ok("inline sets size px", n.style.fontSize === "20px");
  ok("inline sets weight", n.style.fontWeight === "700");
  ok("inline sets italic", n.style.fontStyle === "italic");
  ok("inline sets colour token", n.style.color === "var(--color-accent)");
  ok("inline sets transform", n.style.textTransform === "uppercase");
  ok("inline sets letter/word spacing px", n.style.letterSpacing === "2px" && n.style.wordSpacing === "3px");
  ok("inline DROPS text-align (layout)", n.style.textAlign === undefined);
  ok("inline DROPS line-height (layout)", n.style.lineHeight === undefined);
  ok("inline DROPS text-indent (layout)", n.style.textIndent === undefined);
  // colour precedence mirrors the block resolver: token > per-mode > hex
  var n2 = fakeNode(); apply(n2, { colorLight: "#111", colorDark: "#eee" });
  ok("inline per-mode sets --tc vars + var(--tc-c)", n2.style["--tc-light"] === "#111" && n2.style["--tc-dark"] === "#eee" && n2.style.color === "var(--tc-c)");
  var n3 = fakeNode(); apply(n3, { color: "#abc123" });
  ok("inline raw hex", n3.style.color === "#abc123");
  var n4 = fakeNode(); apply(n4, {});
  ok("inline empty clears to inherit (empty strings)", n4.style.fontFamily === "" && n4.style.fontWeight === "" && n4.style.color === "" && n4.style.textTransform === "");
  // resolveInlineStyles: only KNOWN refs styled; cascade = span overrides its own props
  var spans = [
    { _r: "Heading", style: makeStyle(), getAttribute: function (k) { return k === "data-style-ref" ? this._r : null; } },
    { _r: "Nope", style: makeStyle(), getAttribute: function (k) { return k === "data-style-ref" ? this._r : null; } }
  ];
  var node = { querySelectorAll: function () { return spans; } };
  g.setDocStyles({ Heading: { weight: "700", size: 24 } });
  g.resolveInlineStyles(node);
  ok("resolve styles a KNOWN span ref", spans[0].style.fontWeight === "700" && spans[0].style.fontSize === "24px");
  ok("resolve leaves an UNKNOWN span ref untouched", spans[1].style.fontWeight === undefined && spans[1].style.fontSize === undefined);
  g.setDocStyles(null);
  var solo = { style: makeStyle(), getAttribute: function () { return "Heading"; } };
  g.resolveInlineStyles({ querySelectorAll: function () { return [solo]; } });
  ok("resolve is a no-op with no __docStyles", solo.style.fontWeight === undefined);
  // wiring: editable() resolves inline spans AFTER the block style
  ok("wiring: editable applies block style then resolveInlineStyles", /if \(st\) applyTextStyle\(node, st\);[\s\S]{0,300}resolveInlineStyles\(node\);/.test(r));
  ok("wiring: inline apply omits layout props", !/node\.style\.textAlign|node\.style\.lineHeight|node\.style\.textIndent/.test(m[1]));
  // sanitizeFieldHtml preserves data-style-ref through a chrome-signature commit
  var t = src("src/editor.js");
  var sm = t.match(/\/\* @sanitize-field-start \*\/([\s\S]*?)\/\* @sanitize-field-end \*\//);
  if (!sm) { ok("locate @sanitize-field fence", false); return; }
  var sg = new Function(sm[1] + "\nreturn { sanitizeFieldHtml: sanitizeFieldHtml };")();
  var san = sg.sanitizeFieldHtml;
  var chromey = '<div class="canvas-drag-handle">⠿</div><span data-style-ref="Heading" data-edit="text" class="is-selected">Hi</span>';
  var out = san(chromey);
  ok("sanitize KEEPS data-style-ref", out.indexOf('data-style-ref="Heading"') !== -1);
  ok("sanitize strips data-edit", out.indexOf("data-edit") === -1);
  ok("sanitize strips editor class is-selected", out.indexOf("is-selected") === -1);
  ok("sanitize drops the drag handle", out.indexOf("canvas-drag-handle") === -1);
  var clean = '<span data-style-ref="Body">x</span>';
  ok("sanitize no-op leaves a clean span verbatim", san(clean) === clean);
})();

// ---- inline WEIGHT on selection (James: mixed weights in one heading) ------
section("inline weight on selection");
(function () {
  var t = src("src/editor.js");
  // The crux of editor == export: a raw font-weight span in obj.text must survive the
  // save/commit sanitizer (so it round-trips render + SCORM). Reuse the sanitize fence.
  var sm = t.match(/\/\* @sanitize-field-start \*\/([\s\S]*?)\/\* @sanitize-field-end \*\//);
  if (!sm) { ok("locate @sanitize-field fence", false); return; }
  var san = new Function(sm[1] + "\nreturn sanitizeFieldHtml;")();
  // chrome-signature commit (data-edit present) keeps font-weight, strips editor attrs
  var committed = san('Rf<span style="font-weight: 600" data-edit="text">Patrol</span>');
  ok("weight span survives a chrome-sig commit", /font-weight:\s*600/.test(committed) && committed.indexOf("data-edit") === -1);
  // a clean weight span (no chrome sig) is returned verbatim -> exact round-trip
  var cleanW = 'Rf<span style="font-weight:600">Patrol</span>';
  ok("clean weight span round-trips verbatim", san(cleanW) === cleanW);
  ok("caret-color still stripped but font-weight kept", /font-weight:600/.test(san('<span style="caret-color:#fff;font-weight:600" data-rich="1">x</span>')) === true && san('<span style="caret-color:#fff;font-weight:600" data-rich="1">x</span>').indexOf("caret-color") === -1);
  // wiring: ONE selection-aware Weight control (the old separate "Weight (selection)" row
  // is merged away) — highlighted text is weighted inline, no selection sets the whole field.
  ok("wiring: no separate 'Weight (selection)' row (merged into the type-cluster Weight)", t.indexOf('"Weight (selection)"') === -1 && /\["Semibold", "600"\]/.test(t));
  ok("wiring: selection-aware only when a fieldNode is passed (style dialog stays whole-model)", /if \(opts && opts\.fieldNode\)/.test(t) && /applyWeightToSelection: function \(weight, range\)/.test(t));
  ok("wiring: wraps selection in a font-weight span", /span\.style\.fontWeight = weight;[\s\S]{0,160}r\.surroundContents\(span\)/.test(t));
  ok("wiring: captures the field range on the Weight select mousedown", /wt\.addEventListener\("mousedown"[\s\S]{0,300}cloneRange\(\)/.test(t));
  ok("wiring: empty weight on a live selection is a no-op (does not clear the whole field)", /if \(!weight\) return; \/\/ empty on a live selection/.test(t));
  ok("wiring: no live selection falls back to whole-field / model weight", /model\.weight = weight; onChange\(\); \/\/ no selection/.test(t));
  ok("wiring: selection commit routes through sanitizeFieldHtml (editor == export)", /obj\[field\] = sanitizeFieldHtml\(node\.innerHTML\); renderModelView\(\); scheduleSave\(\);\s*return true;/.test(t));
})();

// ---- #116 copy-editor view-state (fullscreen alternate view shell) --------
section("#116 copy-editor shell");
(function () {
  var t = src("src/editor.js");
  // Extract the PURE view-state core (the single source of open/closed logic) and eval it.
  var block = slice(t, "window.copyEditorNextState = function", "// ===== end #116 copy-editor view-state");
  var host = {};
  new Function("window", block)(host);
  var next = host.copyEditorNextState;
  var opened = next({ open: false }, "enter");
  ok("enter opens the view", opened.open === true && opened.hidden === false && opened.bodyOpen === true);
  ok("enter does not signal a canvas restore", opened.restoreCanvas === false);
  var closed = next({ open: true }, "exit");
  ok("exit closes the view", closed.open === false && closed.hidden === true && closed.bodyOpen === false);
  ok("exit restores the layout canvas", closed.restoreCanvas === true);
  ok("toggle from closed opens", next({ open: false }, "toggle").open === true);
  ok("toggle from open closes + restores", next({ open: true }, "toggle").open === false && next({ open: true }, "toggle").restoreCanvas === true);
  ok("exit while already closed is a no-op (no restore)", next({ open: false }, "exit").restoreCanvas === false);
  ok("null current defaults to closed", next(null, "toggle").open === true);
  // wiring: rail glyph opens, Close/Esc exits, boot wires it, hidden overlay markup exists
  ok("wiring: rail glyph opens the view", /getElementById\("copy-editor-btn"\)[\s\S]{0,80}addEventListener\("click", enterCopyEditor\)/.test(t));
  ok("wiring: Close button exits", /getElementById\("copyedit-exit"\)[\s\S]{0,80}addEventListener\("click", exitCopyEditor\)/.test(t));
  ok("wiring: Escape exits when open", /if \(!copyEditorIsOpen\(\)\) return;[\s\S]{0,120}exitCopyEditor\(\)/.test(t));
  ok("wiring: exit re-focuses the active page (canvas restore)", /function exitCopyEditor\(\)[\s\S]{0,700}focusFrame\(p\); setActivePage\(p\); setSelection\("page", p\)/.test(t));
  ok("wiring: wireCopyEditor called at boot", t.indexOf("wireCopyEditor();") !== -1);
  var html = src("index.html");
  ok("markup: copy-editor overlay is hidden by default", /<div id="copy-editor" class="copyedit" hidden>/.test(html));
  ok("markup: rail glyph present", /id="copy-editor-btn"[\s\S]{0,60}data-lucide="file-text"/.test(html));
  ok("markup: empty doc container for slices 2-4", /<div class="copyedit__doc" id="copyedit-doc"><\/div>/.test(html));
  // pure-render invariant: the copy editor is Verso UI only — render.js / course.css untouched
  ok("invariant: no copy-editor leak into render.js", src("src/render.js").indexOf("copyedit") === -1 && src("src/render.js").indexOf("copy-editor") === -1);
  ok("invariant: no copy-editor leak into course.css", src("src/course.css").indexOf("copyedit") === -1);
})();

// ---- #175 copy-editor inline rich-format toolbar (B/I/U + inline weight on variant text) ----
section("#175 copy-editor format toolbar");
(function () {
  var e = src("src/editor.js");
  var bar = slice(e, "function buildCopyFormatBar()", "return bar;\n  }");
  ok("toolbar built once + injected into the copy-editor bar", /getElementById\("copyedit-format"\)[\s\S]*?insertBefore\(bar, host\)/.test(bar));
  ok("toolbar wires canonical B/I/U prop-toggles via execCommand", /\["B", "bold"\], \["I", "italic"\], \["U", "underline"\][\s\S]*?document\.execCommand\(o\[1\]/.test(bar));
  ok("B/I/U commits through commitCopyRow (-> frWrite override layer)", /document\.execCommand\(o\[1\][\s\S]*?commitCopyRow\(_activeCopyRow\.t, _activeCopyRow\.tx, _activeCopyRow\.variant\)/.test(bar));
  ok("toolbar uses the shared dsSelect weight picker (no bespoke control)", /dsSelect\(\[\["Weight", ""\], \["Regular", "400"\][\s\S]*?applyCopyWeight/.test(bar));
  ok("weight captures the live row range on mousedown (select steals focus)", /mousedown[\s\S]*?savedRange = \(r && _activeCopyRow/.test(bar));
  // applyCopyWeight: an inline font-weight span (survives sanitizeFieldHtml) committed through commitCopyRow
  var acw = slice(e, "function applyCopyWeight(", "\n  }\n  function buildCopyFormatBar");
  ok("applyCopyWeight wraps the selection in a font-weight span", /span\.style\.fontWeight = weight[\s\S]*?surroundContents\(span\)/.test(acw));
  ok("applyCopyWeight falls back to whole-row when nothing is selected", /r\.selectNodeContents\(tx\)/.test(acw));
  ok("applyCopyWeight commits via commitCopyRow (variant-aware frWrite)", /commitCopyRow\(t, tx, _activeCopyRow\.variant\)/.test(acw));
  // seed-from-flagship: frValueOf falls back to the base value when a variant has no override,
  // so a first variant edit starts from the flagship's rich HTML (inline weight spans intact).
  var fr = slice(e, "function frValueOf(t, variant)", "function frWrite");
  ok("frValueOf falls back to the flagship base value (seeds variant rich text)", /return t\.host\[t\.key\] != null \? String\(t\.host\[t\.key\]\) : ""/.test(fr));
  // active-row tracking + teardown
  ok("active row tracked on focus", /addEventListener\("focus", function \(\) \{ _activeCopyRow = \{ tx: tx, t: t, variant: variant == null \? activeVariant : variant \};/.test(e));
  ok("active row dropped when rows rebuild + on exit", /_activeCopyRow = null; refreshCopyFormatState\(\)/.test(e) && /_activeCopyRow = null; \/\/ #175/.test(e));
  ok("invariant: toolbar is Verso UI only — no render.js leak", src("src/render.js").indexOf("copyedit__format") === -1 && src("src/render.js").indexOf("applyCopyWeight") === -1);
})();

// ---- #117 copy-editor read-only document (frTargets + roles + page groups) ----
section("#117 copy-editor read-only doc");
(function () {
  var e = src("src/editor.js");
  // real frTargets + frValueOf (the writable spine) from the F&R fence
  var a = e.indexOf("/* @fr-start */"), b = e.indexOf("/* @fr-end */");
  var fr = new Function(e.slice(a, b) + "\nreturn { targets: frTargets, valueOf: frValueOf };")();
  // pure view core (role tag + per-page grouping) from the copy-editor marker block
  var block = slice(e, "window.copyEditorNextState = function", "// ===== end #116 copy-editor view-state");
  var host = {}; new Function("window", block)(host);
  var role = host.copyEditorRole, model = host.copyEditorModel;

  // role tag derivation
  ok("role: heading", role("heading · text") === "heading");
  ok("role: paragraph", role("paragraph · text") === "paragraph");
  ok("role: caption", role("image · caption") === "caption");
  ok("role: kicker", role("callout · kicker") === "kicker");
  ok("role: option", role("option") === "option");
  ok("role: card slot", role("card · frontTitle") === "card");
  ok("role: table cell", role("table cell") === "table cell");
  ok("role: quiz stem", role("question · prompt") === "quiz stem" && role("question · stemBefore") === "quiz stem");
  ok("role: quiz feedback", role("question · feedbackCorrect") === "feedback");

  // full pipeline over a fixture doc: one row per NON-EMPTY frTargets entry, grouped by page
  var d = {
    chapters: [{ id: "c1", name: "Intro", order: 0 }],
    pages: [
      { id: "p0", chapterId: "c1", blocks: [
        { type: "heading", text: "Welcome" },
        { type: "paragraph", text: "Body <strong>copy</strong> here." },
        { type: "image", text: "", caption: "A photo" },      // empty text skipped; caption kept
        { type: "paragraph", text: "   " }                    // whitespace-only skipped
      ] },
      { id: "p1", chapterId: "c1", blocks: [
        { type: "callout", title: "Note", kicker: "" },       // title kept; empty kicker skipped
        { questions: [{ prompt: "What is X?", options: [{ text: "A" }, { text: "" }] }] }
      ] }
    ]
  };
  var list = fr.targets(d, null).map(function (t) { return { pageIndex: t.pageIndex, label: t.label, value: fr.valueOf(t, null) }; });
  var groups = model(list);
  ok("grouped into 2 pages in order", groups.length === 2 && groups[0].pageIndex === 0 && groups[1].pageIndex === 1);
  ok("page 0: 3 non-empty rows (empties skipped)", groups[0].rows.length === 3);
  ok("page 0: roles in reading order", groups[0].rows.map(function (r) { return r.role; }).join(",") === "heading,paragraph,caption");
  ok("page 0: inline HTML preserved verbatim", groups[0].rows[1].html === "Body <strong>copy</strong> here.");
  ok("page 1: 3 non-empty rows (empty kicker + empty option skipped)", groups[1].rows.length === 3);
  ok("page 1: roles include quiz stem + option", groups[1].rows.map(function (r) { return r.role; }).join(",") === "title,quiz stem,option");
  // exactly the non-empty subset of frTargets survived
  var nonEmpty = list.filter(function (it) { return String(it.value).replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim(); }).length;
  ok("one row per non-empty target (nothing lost, nothing extra)", groups.reduce(function (n, g) { return n + g.rows.length; }, 0) === nonEmpty && nonEmpty === 6);

  // wiring: enter paints the doc; a VIEW over frValueOf, never a store
  ok("wiring: enterCopyEditor renders the doc", /function enterCopyEditor\(\)[\s\S]{0,320}renderCopyEditorDoc\(\)/.test(e));
  ok("wiring: builder reads frTargets + frValueOf (model, not store)", /frTargets\(doc, listVariant\)\.map[\s\S]{0,140}frValueOf\(t, listVariant\)/.test(e));
  ok("wiring: rows carry a role tag + preserved inline HTML", /copyedit-row__role[\s\S]{0,220}tx\.innerHTML = row\.html/.test(e));
  ok("wiring: read-only chapter/page location header", /copyedit-loc__chapter[\s\S]{0,160}pageDisplayName\(page, doc\)/.test(e));
})();

// ---- #118 copy-editor two-way editing (write-back + rich-preserving + variant) ----
section("#118 copy-editor two-way editing");
(function () {
  var e = src("src/editor.js");
  var a = e.indexOf("/* @fr-start */"), b = e.indexOf("/* @fr-end */");
  var fr = new Function(e.slice(a, b) + "\nreturn { targets: frTargets, valueOf: frValueOf, write: frWrite };")();
  var sm = e.match(/\/\* @sanitize-field-start \*\/([\s\S]*?)\/\* @sanitize-field-end \*\//);
  var san = new Function(sm[1] + "\nreturn sanitizeFieldHtml;")();

  // BASE write-back: an edit writes host[key] on the ONE doc (no parallel store)
  var d = { pages: [{ id: "p", blocks: [{ type: "heading", text: "Old" }] }] };
  var t0 = fr.targets(d, null)[0];
  fr.write(t0, null, san("New title"));
  ok("base edit writes host[key]", d.pages[0].blocks[0].text === "New title");

  // RICH-PRESERVING: inline markup survives the commit — NEVER flattened to plain (ADR 0001)
  var rich = 'Rf<span style="font-weight:600">Patrol</span>';
  fr.write(t0, null, san(rich));
  ok("inline weight span preserved (no flatten)", d.pages[0].blocks[0].text === rich);
  var linkRich = 'See <a href="https://x">docs</a> now';
  fr.write(t0, null, san(linkRich));
  ok("inline link preserved", d.pages[0].blocks[0].text === linkRich);
  ok("commit strips editor chrome, keeps author markup",
     san('<b>Bold</b><div class="canvas-drag-handle">x</div>').indexOf("canvas-drag-handle") === -1 &&
     san('<b>Bold</b>').indexOf("<b>Bold</b>") !== -1);

  // VARIANT routing (F&R's rule): an active-variant edit lands in the override layer, base untouched
  var dv = { variants: ["V1"], pages: [{ id: "p", blocks: [{ type: "heading", text: "Base" }] }] };
  var tv = fr.targets(dv, "V1")[0];
  fr.write(tv, "V1", san("Variant title"));
  ok("variant edit routes to override layer", !!(dv.pages[0].blocks[0].overrides && dv.pages[0].blocks[0].overrides.V1 && dv.pages[0].blocks[0].overrides.V1.text === "Variant title"));
  ok("variant edit leaves base untouched", dv.pages[0].blocks[0].text === "Base");
  ok("valueOf reads override for active variant, base otherwise", fr.valueOf(tv, "V1") === "Variant title" && fr.valueOf(tv, null) === "Base");

  // wiring: editable rows commit through frWrite (variant-aware) + sanitize; dirty -> mount on exit
  ok("wiring: rows bound editable via bindCopyRow", /if \(row\.ref\) bindCopyRow\(tx, row\.ref\)/.test(e));
  ok("wiring: commit routes through frWrite + sanitize (rich-preserving)", /function commitCopyRow[\s\S]{0,200}frWrite\(t, variant == null \? activeVariant : variant, sanitizeText\(sanitizeFieldHtml\(tx\.innerHTML\)\)\)/.test(e));
  ok("wiring: contenteditable rows, not plain flatten", /tx\.setAttribute\("contenteditable", "true"\)/.test(e) && /tx\.innerHTML = row\.html/.test(e));
  ok("wiring: paste is plain-text (no rich pollution)", /tx\.addEventListener\("paste"[\s\S]{0,300}execCommand\("insertText", false, text\)/.test(e));
  ok("wiring: edit schedules a save", /function commitCopyRow[\s\S]{0,200}scheduleSave\(\)/.test(e));
  ok("wiring: dirty edit rebuilds the canvas on exit (setDoc round-trip)", /if \(copyEditDirty\) \{ copyEditDirty = false; mount\(\); \}/.test(e));
})();

// ---- #119 copy-editor tools (word count + spellcheck + F&R reuse) ---------
section("#119 copy-editor tools");
(function () {
  var e = src("src/editor.js");
  var a = e.indexOf("/* @fr-start */"), b = e.indexOf("/* @fr-end */");
  var fr = new Function(e.slice(a, b) + "\nreturn { targets: frTargets, valueOf: frValueOf, words: frWords };")();
  // the header count reuses the SAME base-scope formula the F&R panel shows (#78)
  var d = { pages: [{ id: "p", blocks: [{ type: "heading", text: "One two three" }, { type: "paragraph", text: "four five" }] }] };
  var frTotal = fr.targets(d, "").reduce(function (n, t) { return n + fr.words(fr.valueOf(t, "")); }, 0);
  ok("fixture F&R word total is 5", frTotal === 5);
  ok("wiring: word count reuses frWords over frTargets base scope (matches F&R)", /function copyEditorWordTotal\(\) \{\s*return frTargets\(doc, ""\)\.reduce\(function \(n, t\) \{ return n \+ frWords\(frValueOf\(t, ""\)\); \}, 0\);/.test(e));
  ok("wiring: header shows word count + Find & replace", /copyedit-wordcount[\s\S]{0,1800}"Find & replace"/.test(e)); // #104: the Single|Side-by-side toggle now sits between them
  ok("wiring: native spellcheck ON for editable rows", /tx\.setAttribute\("spellcheck", "true"\)/.test(e));
  ok("wiring: Find & replace opens the EXISTING modal (reuse)", /find\.addEventListener\("click", function \(\) \{ openFindReplace\(\); \}\)/.test(e));
  ok("wiring: enter renders the tools header", /renderCopyEditorDoc\(\);[\s\S]{0,90}renderCopyEditorTools\(\)/.test(e));
  ok("wiring: F&R replace refreshes the open copy view (both replaceOne + replaceAll)", (e.match(/if \(copyEditorIsOpen\(\)\) \{ renderCopyEditorDoc\(\); renderCopyEditorTools\(\); \}/g) || []).length >= 2);
  ok("wiring: edit blur refreshes the word count", /tx\.addEventListener\("blur", function \(\) \{ flushSave\(\); renderCopyEditorTools\(\); \}\)/.test(e));
})();

// ---- #104 copy-editor Side-by-side variant columns -----------------------
section("#104 copy-editor variant columns");
(function () {
  var e = src("src/editor.js");
  var css = src("editor.css");
  // real frTargets/frValueOf/frWrite + the new frHasOverride from the F&R fence
  var a = e.indexOf("/* @fr-start */"), b = e.indexOf("/* @fr-end */");
  var fr = new Function(e.slice(a, b) + "\nreturn { targets: frTargets, valueOf: frValueOf, write: frWrite, hasOverride: frHasOverride };")();
  // pure column spine from the copy-editor marker block
  var block = slice(e, "window.copyEditorNextState = function", "// ===== end #116 copy-editor view-state");
  var host = {}; new Function("window", block)(host);
  var cols = host.copyEditorSbsColumns;

  // column spine: flagship first, then variants in order; empty when no variants (toggle hidden)
  ok("no variants -> no columns (toggle stays hidden)", cols({ variants: [] }).length === 0 && cols({}).length === 0);
  ok("columns = flagship + variants in order", JSON.stringify(cols({ variants: ["Concise", "Legacy"] })) === JSON.stringify(["", "Concise", "Legacy"]));

  // frHasOverride mirrors the override layer exactly (drives held-vs-empty cells)
  var d = { variants: ["V1", "V2"], pages: [{ id: "p", blocks: [
    { type: "heading", text: "Base" },
    { type: "table", rows: [[{ t: "cell" }]] }   // non-overridable target
  ] }] };
  var tHead = fr.targets(d, "")[0];
  var tCell = fr.targets(d, "").filter(function (t) { return t.label === "table cell"; })[0];
  ok("overridable target with no override -> not held", fr.hasOverride(tHead, "V1") === false);
  fr.write(tHead, "V1", "Beside");
  ok("after a write -> held for that variant only", fr.hasOverride(tHead, "V1") === true && fr.hasOverride(tHead, "V2") === false);
  ok("held value resolves via frValueOf", fr.valueOf(tHead, "V1") === "Beside" && fr.valueOf(tHead, "") === "Base");
  ok("non-overridable target is never held (nothing beside)", fr.hasOverride(tCell, "V1") === false);
  ok("no variant -> never held", fr.hasOverride(tHead, "") === false && fr.hasOverride(tHead, null) === false);

  // create-from-flagship seeds the override with the flagship copy
  var d2 = { variants: ["V1"], pages: [{ id: "p", blocks: [{ type: "heading", text: "Flagship copy" }] }] };
  var t2 = fr.targets(d2, "")[0];
  fr.write(t2, "V1", fr.valueOf(t2, ""));
  ok("create-from-flagship seeds the override from base", fr.valueOf(t2, "V1") === "Flagship copy" && d2.pages[0].blocks[0].text === "Flagship copy");

  // wiring: gated toggle, sbs render branch, per-cell lock + create, transient unlock
  ok("wiring: Single|Side-by-side toggle gated on doc.variants", /if \(\(doc\.variants \|\| \[\]\)\.length\) \{[\s\S]{0,260}\["Single", false\], \["Side by side", true\]/.test(e));
  ok("wiring: toggle uses the canonical prop-toggle-row (SegmentedControl)", /h\("div", "prop-toggle-row copyedit-modeseg"\)/.test(e));
  ok("wiring: render branches to side-by-side when on + course has variants", /var sbs = copyEditSbs && cols\.length;/.test(e) && /if \(sbs\) \{ host\.appendChild\(buildSbsRow\(row, cols, tmpl\)\); return; \}/.test(e));
  ok("wiring: one column header, not per page group", (e.match(/h\("div", "copyedit-colhead"\)/g) || []).length === 1);
  ok("wiring: flagship cell edits base ('')", /if \(t\) bindCopyRow\(fx, t, ""\);/.test(e));
  ok("wiring: non-overridable target -> empty NA cell (nothing beside)", /if \(!t \|\| !t\.overridable\) \{ cell\.classList\.add\("copyedit-cell--na"\); r\.appendChild\(cell\); return; \}/.test(e));
  ok("wiring: held variant cell is read-only until unlocked", /if \(unlocked\) bindCopyRow\(vx, t, v\); else vx\.classList\.add\("copyedit-cell--locked"\);/.test(e));
  ok("wiring: lock/unlock glyphs (Lucide lock/lock-open) with tooltips", /copyGlyphBtn\(unlocked \? "lock-open" : "lock", "copyedit-lock",\s*unlocked \? "Lock" : "Unlock to edit"/.test(e));
  ok("wiring: empty variant cell offers create-from-flagship (+ glyph)", /copyGlyphBtn\("plus", "copyedit-create", "Create variant copy from flagship"/.test(e));
  ok("wiring: create seeds override from flagship + pushes history (undoable)", /pushHistory\(\);\s*frWrite\(t, v, frValueOf\(t, ""\)\); \/\/ seed the override from the flagship copy/.test(e));
  ok("wiring: unlock state is transient (never persisted to the doc)", /var _unlockedCells = \[\];/.test(e) && /copyEditSbs = false; _unlockedCells = \[\];/.test(e));
  ok("wiring: icon buttons carry aria-label + preventDefault (keep caret)", /b\.title = title; b\.setAttribute\("aria-label", title\);/.test(e));

  // CSS: the columns widen the doc; locked cells muted; create button quiet
  ok("css: sbs doc widens to fit columns", /\.copyedit__doc--sbs \{ max-width:/.test(css));
  ok("css: sbs row is a grid (overrides the single flex row)", /\.copyedit-row--sbs \{ display: grid;/.test(css));
  ok("css: locked cell is muted (read-only look)", /\.copyedit-cell--locked \{ color:/.test(css));
  ok("css: create affordance is quiet by default", /\.copyedit-create \{ opacity: 0\.5; \}/.test(css));

  // invariant: still editor chrome only — no leak into render/course output
  ok("invariant: no side-by-side leak into render.js", src("src/render.js").indexOf("copyedit-cell") === -1 && src("src/render.js").indexOf("copyEditSbs") === -1);
  ok("invariant: no side-by-side leak into course.css", src("src/course.css").indexOf("copyedit-cell") === -1);
})();

// ---- #44 light mode for the tool's own UI (editor chrome) -----------------
section("#44 editor-chrome light mode");
(function () {
  var e = src("src/editor.js");
  var css = src("editor.css");
  var colors = src("design-system/tokens/colors.css");
  // applyUiTheme toggles .theme-light on <html> and persists; boot restores it
  ok("applyUiTheme toggles .theme-light on the root + persists", /function applyUiTheme\(light\) \{\s*document\.documentElement\.classList\.toggle\("theme-light", !!light\);\s*try \{ localStorage\.setItem\("verso\.uiTheme", light \? "light" : "dark"\); \}/.test(e));
  ok("uiThemeIsLight reads the persisted flag", /function uiThemeIsLight\(\) \{ try \{ return localStorage\.getItem\("verso\.uiTheme"\) === "light"; \}/.test(e));
  ok("boot restores the saved chrome theme", /applyUiTheme\(uiThemeIsLight\(\)\);/.test(e));
  ok("Settings exposes a Light interface switch", /switchRow\("Light interface", function \(\) \{ return uiThemeIsLight\(\); \}, function \(v\) \{ applyUiTheme\(v\); \}/.test(e));
  // the DS token layer ships the light override the chrome reads via var(--...)
  ok("DS colors.css defines the .theme-light token override", /\.theme-light\s*\{[\s\S]{0,600}--surface-app:\s*#ffffff/.test(colors));
  ok("DS light override remaps ink + surfaces", /\.theme-light[\s\S]{0,900}--text-primary:\s*#1e1e1e/.test(colors));
  // the flippable chrome one-offs are now token-driven (flip with the theme), not hardcoded dark
  ok("prop-field focus bg is tokenised (flips)", /\.prop-field:focus-within \{ border-color: var\(--accent\); background: var\(--surface-input\); \}/.test(css));
  ok("prop-toggle-row bg is tokenised (flips)", /\.prop-toggle-row \{[^}]*background: var\(--surface-input\);/.test(css));
  ok("prop-btn hover bg is tokenised (flips)", /\.prop-btn:hover \{ border-color: var\(--border-strong\); background: var\(--surface-active\); \}/.test(css));
  ok("rich-text toolbar is tokenised (flips)", /\.rt-toolbar \{[\s\S]{0,200}background: var\(--surface-raised\); border: 1px solid var\(--border-strong\);/.test(css));
  ok("no hardcoded #2f2f2f focus backgrounds remain in the shell", css.indexOf("background: #2f2f2f") === -1);
  // invariant: chrome theme never leaks into the course output (course.css owns its own tokens)
  ok("course.css does not define the DS chrome surface token", src("src/course.css").indexOf("--surface-app:") === -1);
  ok("render.js never reads the chrome theme class", src("src/render.js").indexOf("theme-light") === -1);
})();

// ---- P0 spellcheck: pure checker + hash contract + chrome-only invariant --
section("P0 spellcheck");
(function () {
  var sc = src("src/spellcheck.js");
  var m = sc.match(/\/\* @spell-core-start \*\/([\s\S]*?)\/\* @spell-core-end \*\//);
  if (!m) { ok("locate @spell-core fence", false); return; }
  var core = new Function(m[1] + "\nreturn { isMisspelled: isMisspelled, tokenize: tokenize, check: check };")();
  var DICT = { the:1, quick:1, brown:1, fox:1, receive:1, separate:1, world:1, heading:1, patrol:1,
    hazard:1, cover:1, demonstrate:1, risk:1, start:1, color:1, organize:1, center:1, happy:1 };
  function has(w) { return !!DICT[w]; }
  function allow(w) { return w === "acmeco"; }
  // tokenize offsets
  var toks = core.tokenize("the fox");
  ok("tokenize finds words + offsets", toks.length === 2 && toks[0].word === "the" && toks[0].start === 0 && toks[1].start === 4);
  // correct words never flagged (case-insensitive)
  ok("dictionary word not flagged", core.isMisspelled("receive", has, allow) === false);
  ok("capitalised dictionary word not flagged", core.isMisspelled("The", has, allow) === false);
  // obvious typos flagged
  ok("typo flagged (recieve)", core.isMisspelled("recieve", has, allow) === true);
  ok("typo flagged (seperate)", core.isMisspelled("seperate", has, allow) === true);
  // deliberate skips (avoid false positives on non-prose)
  ok("ALL-CAPS acronym skipped", core.isMisspelled("SCORM", has, allow) === false);
  ok("word with a digit skipped", core.isMisspelled("mp3file", has, allow) === false);
  ok("short word skipped", core.isMisspelled("no", has, allow) === false);
  ok("allow-listed jargon skipped", core.isMisspelled("AcmeCo", has, allow) === false);
  // possessive + hyphen handling
  ok("possessive checks the base word", core.isMisspelled("fox's", has, allow) === false && core.isMisspelled("recieve's", has, allow) === true);
  ok("hyphenated checks each part", core.isMisspelled("brown-fox", has, allow) === false && core.isMisspelled("brown-fxo", has, allow) === true);
  // morphology: inflected forms of a known root are NOT flagged (kills web2's plural/tense gaps)
  ok("plural not flagged (hazards->hazard)", core.isMisspelled("hazards", has, allow) === false);
  ok("3rd person not flagged (covers->cover)", core.isMisspelled("covers", has, allow) === false);
  ok("gerund not flagged (demonstrating->demonstrate)", core.isMisspelled("demonstrating", has, allow) === false);
  ok("past tense not flagged (started->start)", core.isMisspelled("started", has, allow) === false);
  ok("comparative not flagged (happier->happy)", core.isMisspelled("happier", has, allow) === false);
  // British spellings not flagged
  ok("British -ise not flagged (organise->organize)", core.isMisspelled("organise", has, allow) === false);
  ok("British -our not flagged (colour->color)", core.isMisspelled("colour", has, allow) === false);
  ok("British -re not flagged (centre->center)", core.isMisspelled("centre", has, allow) === false);
  // morphology must NOT rescue a real typo (no valid root exists)
  ok("morphology does not mask a typo (recieve)", core.isMisspelled("recieve", has, allow) === true);
  ok("morphology does not mask a typo (hazrads)", core.isMisspelled("hazrads", has, allow) === true);
  // check() returns positioned hits only for typos
  var hits = core.check("the recieve fox", has, allow);
  ok("check returns positioned misspellings", hits.length === 1 && hits[0].word === "recieve" && hits[0].start === 4);

  // hash contract: the runtime + the build tool MUST hash identically (or the bloom lookups
  // land on the wrong bits and every word looks misspelled).
  var rtF = new Function(sc.slice(sc.indexOf("function fnv1a"), sc.indexOf("var M = 0")) + "\nreturn fnv1a;")();
  var bt = src("scripts/build-dict.js");
  var btF = new Function(bt.slice(bt.indexOf("function fnv1a"), bt.indexOf("function positions")) + "\nreturn fnv1a;")();
  ok("build + runtime fnv1a agree", rtF("receive", 0x811c9dc5) === btF("receive", 0x811c9dc5) && rtF("Patrol", 123) === btF("Patrol", 123));
  // generated dictionary shape
  ok("generated dict exposes VersoSpellDict {n,m,k,bits}", /window\.VersoSpellDict = \{ n: \d+, m: \d+, k: \d+, bits: "[A-Za-z0-9+/=]+" \};/.test(src("src/spellcheck-dict.js")));

  // invariant: spellcheck is editor chrome only — never read by render() / never exported.
  ok("spellcheck not read by render.js", src("src/render.js").indexOf("VersoSpell") === -1 && src("src/render.js").indexOf("verso-spelling") === -1);
  ok("marking is CSS.highlights (zero DOM mutation)", /CSS\.highlights\.set\(SPELL_HL_NAME, hl\)/.test(src("src/editor.js")));
  ok("checker + dict load before editor.js", (function () { var html = src("index.html"); return html.indexOf("spellcheck-dict.js") < html.indexOf("src/spellcheck.js") && html.indexOf("src/spellcheck.js") < html.indexOf("src/editor.js"); })());
  ok("re-checks after canvas render + copy-editor render + edits", /scheduleSpellcheck\(\); \/\/ P0: \(re\)mark/.test(src("src/editor.js")) && /scheduleSpellcheck\(\); \/\/ P0: re-check typos as the author types/.test(src("src/editor.js")));
  // #133 add-to-dictionary: API + right-click affordance
  ok("VersoSpell exposes addWord (persists an allow-list)", /addWord: addWord/.test(sc) && /localStorage\.setItem\(IGNORE_KEY, JSON\.stringify\(list\)\)/.test(sc));
  ok("allow-list is consulted by the checker", /function allow\(lower\) \{ return !!\(CONTRACT\[lower\] \|\| ignore\[lower\]\); \}/.test(sc));
  var ed = src("src/editor.js");
  ok("#133: right-click resolves the word under the caret in an editable field", /function spellWordAtPoint\(x, y\)[\s\S]{0,400}closest\("#canvas-viewport \[data-edit\], \.copyedit-row__text"\)/.test(ed));
  ok("#133: contextmenu (capture) offers Add to dictionary + re-checks", /addEventListener\("contextmenu", function \(e\)[\s\S]{0,400}VersoSpell\.addWord\(word\); runSpellcheck\(\)[\s\S]{0,40}\}, true\)/.test(ed));
})();

// ---- #134 every card/side is a drop-target container ----------------------
section("#134 cards as drop containers");
(function () {
  var e = src("src/editor.js");
  var body = e.slice(e.indexOf("function containerChildGroups(block)"), e.indexOf("// DD: select a nested block by REF"));
  var ccg = new Function(body + "\nreturn containerChildGroups;")();
  // an EMPTY cardDeck exposes a droppable group per card (previously invisible -> undroppable)
  var deck = { type: "cardDeck", items: [{}, {}, {}] };
  var g = ccg(deck);
  ok("empty cardDeck exposes a group per card", !!g && g.length === 3);
  ok("empty card group carries a lazy ref to items[i].children", g[0].arrayOwner === deck.items[0] && g[0].arrayKey === "children" && Array.isArray(g[0].blocks) && g[0].blocks.length === 0);
  // resolving the ref (as the drop does) appends into the EXACT item array, others untouched
  var it = g[1].arrayOwner; var arr = (it[g[1].arrayKey] = it[g[1].arrayKey] || []); arr.push({ type: "heading" });
  ok("append lands in items[i].children", deck.items[1].children.length === 1 && deck.items[1].children[0].type === "heading");
  ok("sibling cards untouched", !deck.items[0].children && !deck.items[2].children);
  // a flip cardReveal exposes BOTH sides per item, both droppable when empty
  var flip = { type: "cardReveal", revealStyle: "flip", items: [{ front: [], children: [] }] };
  var gf = ccg(flip);
  ok("flip card exposes front + back groups", gf.length === 2 && gf[0].arrayKey === "front" && gf[1].arrayKey === "children");
  ok("front group targets items[i].front", gf[0].arrayOwner === flip.items[0]);
  // a non-flip reveal card exposes just its children body
  var rev = ccg({ type: "cardReveal", items: [{}] });
  ok("non-flip card exposes a children group", rev.length === 1 && rev[0].arrayKey === "children");
  // wiring
  ok("handleDrop pushes into the card body array", /target\.intoBlocks && target\.intoBlocks\.arrayRef[\s\S]{0,80}target\.intoBlocks\.arrayRef\.push\(draggedBlock\)/.test(e));
  ok("cycle guard covers the intoBlocks owner", /target\.intoBlocks && target\.intoBlocks\.ownerBlock/.test(e));
  ok("canvas wires each card/side body (incl. front) as a drop target", /function wireItemBodyDrops\(root\)[\s\S]{0,900}card-reveal__front[\s\S]{0,120}"front"/.test(e));
  ok("canvas wiring is called from enableEditing", /wireItemBodyDrops\(root\); \/\/ #134/.test(e));
  ok("outliner cap rows drop into the item array", /if \(g\.arrayOwner\) \{[\s\S]{0,240}intoBlocks: \{ arrayRef: arr, ownerBlock: blk \}/.test(e));
  ok("outliner block-row drop for items containers routes to the first item", /if \(isItems\) \{[\s\S]{0,260}it0\.children = it0\.children \|\| \[\]/.test(e));
})();

// ---- #154: multi-select variant export (plan + orchestration) ------------
// Execute export.js in a fake window so we can drive the real buildExportPlan /
// runExportPlan (both exposed as headless hooks). Guards: N ticked rows -> N
// build calls with the right opts.variant; each mapped to its own dir handle;
// unticked rows never built. See export.js doExportSelected.
section("#154 multi-select variant export");
(function () {
  var win = { Editor: {
    registerPipelineButton: function () {},
    getDoc: function () { return { meta: { code: "acme" }, variants: ["A", "B"] }; },
    getThemes: function () { return {}; }, getTheme: function () { return {}; }
  } };
  new Function("window", src("src/export.js"))(win);
  var buildExportPlan = win.__buildExportPlan, runExportPlan = win.__runExportPlan;
  ok("export exposes plan + orchestration hooks", typeof buildExportPlan === "function" && typeof runExportPlan === "function");

  var dirA = { name: "folderA" };
  var rows = [
    { variant: null, selected: true, dir: null },     // flagship, download fallback
    { variant: "A", selected: true, dir: dirA },       // -> its own folder
    { variant: "B", selected: false, dir: { name: "folderB" } } // unticked -> skipped
  ];
  var plan = buildExportPlan(rows, { version: "V001" });
  ok("only ticked rows survive (2 of 3)", plan.length === 2);
  ok("flagship entry: variant null + untagged name + no dir", plan[0].variant === null && plan[0].name === "acme_V001_SCORM.zip" && plan[0].dir === null);
  ok("variant A entry: variant + tagged name + its own dir handle", plan[1].variant === "A" && plan[1].name === "acme_V001_A_SCORM.zip" && plan[1].dir === dirA);
  ok("unticked variant B never appears in the plan", !plan.some(function (p) { return p.variant === "B"; }));

  __async.push((async function () {
    var built = [], delivered = [];
    var results = await runExportPlan(plan,
      function (entry) { built.push(entry.variant); return Promise.resolve({ name: entry.name, blob: {} }); },
      function (pkg, entry) { delivered.push({ name: pkg.name, dir: entry.dir }); return Promise.resolve({ to: entry.dir ? "folder" : "download" }); }
    );
    ok("build called once per ticked entry, right variant order", built.length === 2 && built[0] === null && built[1] === "A");
    ok("deliver maps each pkg to its own dir handle", delivered.length === 2 && delivered[0].dir === null && delivered[1].dir === dirA);
    ok("results carry name + variant + delivery target", results.length === 2 && results[0].variant === null && results[0].to === "download" && results[1].to === "folder");
    // empty selection -> empty plan -> zero builds (nothing exported)
    var none = buildExportPlan([{ variant: null, selected: false }], { version: "V001" });
    var n = 0;
    await runExportPlan(none, function () { n++; return Promise.resolve({ name: "x", blob: {} }); }, function () { return Promise.resolve({}); });
    ok("no ticked rows -> no build calls", none.length === 0 && n === 0);
  })());
})();

// ---- #212 comment popover clamps into the viewport -----------------------
section("#212 comment popover clamp");
(function () {
  var t = src("src/editor.js");
  var m = t.match(/function clampPopover\(pos, vw, vh, pw, ph, m\)\s*\{[\s\S]*?\n  \}/);
  ok("clampPopover pure helper present", !!m);
  var fn = new Function(m[0] + "\nreturn clampPopover;")();
  var VW = 1000, VH = 800, PW = 240, PH = 216, M = 8;
  // roomy drop near top-left: default position, offset to the right of the pin, no clamp
  var a = fn({ px: 100, py: 100 }, VW, VH, PW, PH, M);
  ok("roomy drop keeps default offset (px+16, py)", a.left === 116 && a.top === 100);
  // near the RIGHT edge: flips to the left of the pin so it never overflows
  var b = fn({ px: 960, py: 100 }, VW, VH, PW, PH, M);
  ok("right-edge drop flips left of pin", b.left === 960 - PW - 16 && b.left + PW <= VW - M);
  // near the BOTTOM edge: top is lifted so the whole popover fits above the fold
  var c = fn({ px: 100, py: 780 }, VW, VH, PW, PH, M);
  ok("bottom-edge drop lifts top so bottom fits", c.top === VH - PH - M && c.top + PH <= VH - M);
  // bottom-right corner: both axes clamped, fully on-screen (the #212 repro)
  var d = fn({ px: 990, py: 790 }, VW, VH, PW, PH, M);
  ok("corner drop fully on-screen (x)", d.left >= M && d.left + PW <= VW - M);
  ok("corner drop fully on-screen (y)", d.top >= M && d.top + PH <= VH - M);
  // drop hard against the top edge: top is clamped up to the margin (never < m)
  var e = fn({ px: 5, py: 5 }, VW, VH, PW, PH, M);
  ok("top-edge drop clamps top to margin", e.left === 21 && e.top === M);
  var z = fn({ px: 990, py: 790 }, 0, 0, PW, PH, M);
  ok("zero viewport disables clamp (uses raw offset)", z.left === 990 + 16 && z.top === 790);
  // placePopover delegates to clampPopover with the surface viewport + measured size
  ok("placePopover uses clampPopover with layerParent size", /clampPopover\(pos, vw, vh, pop\.offsetWidth \|\| 240, pop\.offsetHeight \|\| 0, 8\)/.test(t));
  // both position sites route through placePopover (open + re-project on pan/zoom)
  ok("open popover + pan/zoom re-project both call placePopover", (t.match(/placePopover\(/g) || []).length >= 3);
  // WIRING (#212 follow-up): the pin layer cancels the layer parent's scroll so pins stay
  // glued to the viewport under native-scroll pan (#151) / the scrollable demo stage,
  // instead of drifting off-screen with the scrolled content.
  ok("renderCommentPins compensates layer parent scroll",
    /layer\.style\.transform = \(_sx \|\| _sy\) \? \("translate\(" \+ _sx \+ "px," \+ _sy \+ "px\)"\) : "";/.test(t)
    && /_sx = s\.layerParent\.scrollLeft/.test(t) && /_sy = s\.layerParent\.scrollTop/.test(t));
})();

// ---- interaction-gate reminder pins above the pinned Next button ---------
section("gate-hint pins above pinned Next");
(function () {
  var css = src("src/course.css");
  // default (unpinned): floats above the footer bar, right-aligned
  ok("gate-hint floats above the bar by default",
    /\.course-nav__gate-hint \{[\s\S]*?position: absolute; bottom: calc\(100% \+ 10px\); right: 0;/.test(css));
  // pinned nav: the reminder is re-pinned to the viewport corner, just above the Next button
  // (else it stays anchored to the .course-nav bar and detaches from the fixed Next button).
  ok("pinned nav re-pins the gate-hint above the Next button",
    /\.course-nav--pin \.course-nav__gate-hint \{[\s\S]*?position: fixed;[\s\S]*?right: 24px; bottom: calc\(16px \+ 34px \+ 10px\);/.test(css));
  ok("pinned gate-hint sits above the pinned Next (z beats the pinned button z:50)",
    /\.course-nav--pin \.course-nav__gate-hint \{[\s\S]*?z-index: 51;/.test(css));
  ok("pinned gate-hint hugs the 12px gutter on mobile",
    /\[data-bp="mobile"\] \.course-nav--pin \.course-nav__gate-hint \{ right: 12px; \}/.test(css));
  // Demo-preview parity: the framed device has no zoom containing block, so a position:fixed
  // hint escapes to the app viewport (ghost pill). editor.css must remap it to absolute inside
  // the device, mirroring how the pinned prev/next are remapped -- so preview stays WYSIWYG.
  var ecss = src("editor.css");
  ok("framed demo remaps the gate-hint to absolute inside the device",
    /\.demo__device--framed \.course-root\[data-env="runtime"\] \.course-nav--pin \.course-nav__gate-hint \{[\s\S]*?position: absolute; bottom: calc\(16px \+ 34px \+ 10px\); right: 24px;/.test(ecss));
  ok("framed demo gate-hint hugs the 12px gutter on mobile",
    /\.demo__device--framed \.course-root\[data-env="runtime"\]\[data-bp="mobile"\] \.course-nav--pin \.course-nav__gate-hint \{ right: 12px; \}/.test(ecss));
})();

// ---- #215: hotspot unified screen-graph (migrate-on-load + render parity) ----
// The one architectural seam of the hotspot-tour redesign (ADR-0003): a pure
// migrateHotspotBlock(block) transforms both legacy shapes into block.screens[]/
// block.entry, and the SINGLE unified render path must emit the exact learner DOM
// the legacy renderer produced. The EXPECT_* strings below are the legacy hotspot
// renderer's serialized output, captured BEFORE the rewrite — the frozen contract
// that protects shipped courses ("don't disrupt existing content").
section("#215 hotspot unified screen-graph");
(function () {
  var r = src("src/render.js");

  // -- migrateHotspotBlock: slice the pure fn out of render.js --
  var ms = r.indexOf("window.migrateHotspotBlock = function (block) {");
  var me = r.indexOf("// Every distinct asset id referenced by a doc");
  ok("locate migrateHotspotBlock", ms >= 0 && me > ms);
  var winStub = {};
  new Function("window", r.slice(ms, me))(winStub);
  var migrate = winStub.migrateHotspotBlock;

  function popFixture() {
    return { type: "hotspot", src: "https://x/base.png", alt: "Base",
      markerColor: "#f00", markerSize: 40, viewedColor: "#0f0",
      hotspots: [
        { id: "hs_a", x: 10, y: 20, label: "First", blocks: [{ type: "subheading", text: "T" }, { type: "paragraph", text: "P" }] },
        { id: "hs_b", x: 70, y: 80, cardW: 300, cardH: 120, blocks: [{ type: "paragraph", text: "Q" }] }
      ] };
  }
  function scrFixture() {
    return { type: "hotspot", mode: "screen", src: "https://x/menu.png", alt: "Menu",
      backLabel: "Return", imgWidth: 80,
      hotspots: [
        { id: "hs_1", x: 15, y: 25, label: "Go", screen: "https://x/s1.png", screenAlt: "S1" },
        { id: "hs_2", x: 55, y: 65 }
      ] };
  }

  // (a) old popover block -> one entry screen, all markers card, child blocks intact
  var p = migrate(popFixture());
  ok("popover: one entry screen", Array.isArray(p.screens) && p.screens.length === 1 && p.entry === p.screens[0].id);
  ok("popover: base image moved to entry.visual/alt", p.screens[0].visual === "https://x/base.png" && p.screens[0].alt === "Base" && !("src" in p) && !("alt" in p));
  ok("popover: all markers action=card", p.screens[0].markers.length === 2 && p.screens[0].markers.every(function (m) { return m.action === "card"; }));
  ok("popover: child blocks intact (same objects)", p.screens[0].markers[0].blocks.length === 2 && p.screens[0].markers[0].blocks[0].text === "T" && p.screens[0].markers[1].blocks[0].text === "Q");
  ok("popover: per-marker card size carried", p.screens[0].markers[1].cardW === 300 && p.screens[0].markers[1].cardH === 120);
  ok("popover: legacy hotspots[] removed", !("hotspots" in p));

  // (b) old screen block -> entry + one synthesized screen per hs.screen, markers navigate
  var s = migrate(scrFixture());
  ok("screen: entry + one screen per destination", s.screens.length === 2 && s.entry === s.screens[0].id);
  ok("screen: markers action=navigate", s.screens[0].markers.every(function (m) { return m.action === "navigate"; }));
  ok("screen: destination becomes a Screen node", s.screens[1].visual === "https://x/s1.png" && s.screens[1].alt === "S1" && s.screens[0].markers[0].target === s.screens[1].id);
  ok("screen: marker without a destination has no target", !("target" in s.screens[0].markers[1]));
  ok("screen: authoring hint mode kept, block chrome fields kept", s.mode === "screen" && s.backLabel === "Return" && s.imgWidth === 80);

  // (c) idempotency — re-running on a migrated block is a no-op
  var snap = JSON.stringify(p);
  ok("idempotent: re-run is a no-op", JSON.stringify(migrate(p)) === snap);
  var snap2 = JSON.stringify(s);
  ok("idempotent: re-run is a no-op (screen)", JSON.stringify(migrate(s)) === snap2);

  // (d) the #148 variant/version base-image channels follow the visual onto the entry screen
  var vb = popFixture();
  vb.overrides = { V: { src: "asset:VAR" } };
  vb.versionOverrides = { v2: { src: "asset:VER", other: 1 } };
  migrate(vb);
  ok("#148 variant src override -> entry overrides.visual", vb.screens[0].overrides.V.visual === "asset:VAR" && !vb.overrides);
  ok("#148 version src override -> entry versionOverrides.visual (other keys stay)", vb.screens[0].versionOverrides.v2.visual === "asset:VER" && vb.versionOverrides.v2.other === 1 && !("src" in vb.versionOverrides.v2));

  // -- render parity: mini-DOM harness over the LIVE hotspot renderer --
  function FakeNode(tag) {
    this.tagName = tag; this.attrs = {}; this.styleProps = {}; this.children = [];
    this.textContent = ""; this.hidden = false; this._className = "";
    var self = this;
    this.style = { setProperty: function (k, v) { self.styleProps[k] = String(v); }, removeProperty: function (k) { delete self.styleProps[k]; } };
    ["left", "top", "width", "minHeight", "background", "color"].forEach(function (pn) {
      Object.defineProperty(self.style, pn, { get: function () { return self.styleProps[pn] || ""; }, set: function (v) { self.styleProps[pn] = String(v); } });
    });
    this.classList = { add: function () { Array.prototype.forEach.call(arguments, function (c) { var l = self._className ? self._className.split(/\s+/) : []; if (l.indexOf(c) === -1) l.push(c); self._className = l.join(" "); }); }, remove: function () {}, toggle: function () {}, contains: function () { return false; } };
  }
  Object.defineProperty(FakeNode.prototype, "className", { get: function () { return this._className; }, set: function (v) { this._className = String(v); } });
  Object.defineProperty(FakeNode.prototype, "innerHTML", { get: function () { return this._innerHTML || ""; }, set: function (v) { this._innerHTML = String(v); this.children = []; } });
  FakeNode.prototype.setAttribute = function (k, v) { if (k === "class") this._className = String(v); else this.attrs[k] = String(v); };
  FakeNode.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
  FakeNode.prototype.appendChild = function (c) { this.children.push(c); return c; };
  ["src", "alt", "type", "title"].forEach(function (pn) {
    Object.defineProperty(FakeNode.prototype, pn, { get: function () { return this.attrs[pn]; }, set: function (v) { this.attrs[pn] = String(v); } });
  });
  var fdoc = { createElement: function (t) { return new FakeNode(t); } };
  function ser(n) {
    if (!n || !n.tagName) return "?";
    var out = n.tagName + "." + (n._className || "");
    var ak = Object.keys(n.attrs).sort();
    if (n.hidden) ak.push("@hidden");
    out += "{" + ak.map(function (k) { return k === "@hidden" ? "hidden" : k + "=" + n.attrs[k]; }).join(";") + "}";
    var sk = Object.keys(n.styleProps).sort();
    if (sk.length) out += "(" + sk.map(function (k) { return k + ":" + n.styleProps[k]; }).join(";") + ")";
    if (n.textContent) out += "'" + n.textContent + "'";
    if (n._innerHTML) out += "~" + n._innerHTML + "~";
    return out + "[" + n.children.map(ser).join(",") + "]";
  }
  function fel(tag, className, text) { var n = new FakeNode(tag); if (className) n._className = className; if (text != null) n.textContent = text; return n; }
  var hb = slice(r, "hotspot: function (block) {", "componentGrid: function");
  // renderMarkers now delegates to the module-scope hotspotMarkerEl (shared with the editor board);
  // include its source in the isolated eval so the sliced renderer can call it.
  var hmSrc = slice(r, "function hotspotMarkerEl(block, hs, i, loopById) {", "window.hotspotMarkerEl = hotspotMarkerEl;");
  var makeHotspot = new Function(
    "el", "assetSrc", "inlineSvg", "markerSrcdoc", "markerSvgNode", "applyPopoverStyle", "renderBlock", "document",
    hmSrc + " var o = {" + hb + "}; return o.hotspot;"
  )(fel, function (v) { return v; }, function () { return null; }, function (h2) { return "srcdoc:" + h2; }, function () { return null; },
    function () {}, function (child) { return fel("div", "stub-" + child.type, child.text || ""); }, fdoc);

  // frozen legacy outputs (captured from the pre-#215 renderer on the fixtures above)
  // #216 unified graph render (captured post-rewrite). Same learner surface as the
  // legacy DOM (base image + markers + destination image + Back) plus the graph
  // model's stable hooks: markers carry data-action (+data-target for navigate); each
  // destination is a .hotspot-screen PANEL keyed by data-screen-id holding its own
  // .hotspot-screen__img (+ its own markers, see the depth-2 case below); Back lives in
  // a .hotspot-nav wrapper. Popover-only blocks emit no panels/nav (no navigate marker).
  var EXPECT_POP = "div.block-hotspot{data-hotspot-block=1;data-mode=popover;data-track-viewed=1}[div.hotspot-stage{data-hotspot-entry=scr-entry;data-hotspot-entry-name=Home;data-popover-place=auto}[div.hotspot-topbar{}[div.hotspot-counter{aria-live=polite;data-hotspot-counter=1}'0 of 2 viewed'[]],div.hotspot-frame{}[img.hotspot-image{alt=Base;src=https://x/base.png}[],button.hotspot-marker{aria-label=First;data-action=card;data-hotspot=hs_a;title=First;type=button}(--hotspot-color:#f00;--hotspot-size:40px;--hotspot-viewed:#0f0;left:10%;top:20%)[span.hotspot-marker__glyph{}'i'[]],button.hotspot-marker{aria-label=Open hotspot 2;data-action=card;data-hotspot=hs_b;type=button}(--hotspot-color:#f00;--hotspot-size:40px;--hotspot-viewed:#0f0;left:70%;top:80%)[span.hotspot-marker__glyph{}'i'[]]],div.hotspot-chrome{}[],div.hotspot-popover{data-hotspot-panel=hs_a;hidden}[button.hotspot-popover__close{aria-label=Close;type=button}~&times;~[],div.hotspot-popover__content{}[div.stub-subheading{}'T'[],div.stub-paragraph{}'P'[]]],div.hotspot-popover{data-hotspot-panel=hs_b;hidden}(minHeight:120px;width:300px)[button.hotspot-popover__close{aria-label=Close;type=button}~&times;~[],div.hotspot-popover__content{}[div.stub-paragraph{}'Q'[]]]]]";
  var EXPECT_SCR = "div.block-hotspot{data-hotspot-block=1;data-mode=screen;data-track-viewed=1}[div.hotspot-stage{data-hotspot-entry=scr-entry;data-hotspot-entry-name=Home;data-popover-place=auto}[div.hotspot-topbar{}[div.hotspot-counter{aria-live=polite;data-hotspot-counter=1}'0 of 2 screens visited'[]],div.hotspot-frame{}(--hotspot-img-width:80%)[img.hotspot-image{alt=Menu;src=https://x/menu.png}[],div.hotspot-screen{data-screen-id=scr-hs_1;data-screen-name=Screen 1;hidden}[img.hotspot-screen__img{alt=S1;src=https://x/s1.png}[]],button.hotspot-marker{aria-label=Go;data-action=navigate;data-hotspot=hs_1;data-target=scr-hs_1;title=Go;type=button}(left:15%;top:25%)[span.hotspot-marker__glyph{}'i'[]],button.hotspot-marker{aria-label=Go to screen 2;data-action=navigate;data-hotspot=hs_2;type=button}(left:55%;top:65%)[span.hotspot-marker__glyph{}'i'[]],button.hotspot-restart{aria-label=Restart;data-hotspot-restart=1;type=button;hidden}~<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/></svg>~[]],div.hotspot-chrome{}[div.hotspot-nav{}[button.hotspot-back{data-hotspot-back=1;type=button;hidden}'Return'[]]]]]";

  ok("render parity: migrated popover block == legacy learner DOM", ser(makeHotspot(migrate(popFixture()))) === EXPECT_POP);
  ok("render parity: migrated screen block == legacy learner DOM", ser(makeHotspot(migrate(scrFixture()))) === EXPECT_SCR);

  // (e) #216 graph DEPTH: a navigate marker on a NON-entry screen renders that screen's
  // OWN markers inside its panel, and a deep tour emits a Home control. Depth authoring
  // is what the panel-per-screen model unlocks over the one-level legacy shape.
  function graphFixture() {
    return { type: "hotspot", entry: "s0",
      screens: [
        { id: "s0", visual: "a.png", kind: "image", markers: [ { id: "m0", x: 10, y: 10, action: "navigate", target: "s1" } ] },
        { id: "s1", visual: "b.png", kind: "image", markers: [ { id: "m1", x: 20, y: 20, action: "navigate", target: "s2" }, { id: "m1c", x: 30, y: 30, action: "card", blocks: [ { type: "paragraph", text: "deep card" } ] } ] },
        { id: "s2", visual: "c.png", kind: "image", markers: [] }
      ] };
  }
  var gser = ser(makeHotspot(graphFixture()));
  ok("depth: non-entry screen s1 renders as a panel with its OWN markers", /div\.hotspot-screen\{data-screen-id=s1;data-screen-name=[^;]*;hidden\}\[img\.hotspot-screen__img\{[^}]*src=b\.png\}\[\],button\.hotspot-marker\{[^}]*data-target=s2[^}]*\}/.test(gser));
  ok("depth: a deep card marker's popover is emitted on the stage", /div\.hotspot-popover\{data-hotspot-panel=m1c;hidden\}/.test(gser) && /'deep card'/.test(gser));
  ok("depth: a deep navigate (s1->s2) emits a Home control", /button\.hotspot-home\{data-hotspot-home=1;type=button;hidden\}'Home'/.test(gser));
  ok("one-level: no Home when the graph never goes past depth 1", !/hotspot-home/.test(ser(makeHotspot(migrate(scrFixture())))));

  // (f) #217 video screen visual: kind="video" emits a static <video> (muted,
  // playsinline, preload); play-once carries data-hotspot-video=once and NO loop attr;
  // loop mode carries the loop attr. Playback itself is runtime-driven (not tested here).
  var vidOnce = ser(makeHotspot({ type: "hotspot", entry: "s0", trackViewed: false, screens: [ { id: "s0", visual: "rec.mp4", kind: "video", playback: "once", markers: [] } ] }));
  ok("video: play-once emits <video> (data-hotspot-video=once, muted, no loop)", vidOnce.indexOf("hotspot-video{") >= 0 && vidOnce.indexOf("data-hotspot-video=once") >= 0 && vidOnce.indexOf("muted=") >= 0 && vidOnce.indexOf("src=rec.mp4") >= 0 && vidOnce.indexOf(";loop=") < 0);
  var vidLoop = ser(makeHotspot({ type: "hotspot", entry: "s0", trackViewed: false, screens: [ { id: "s0", visual: "idle.webm", kind: "video", markers: [] } ] }));
  ok("video: loop mode carries loop attr + data-hotspot-video=loop", vidLoop.indexOf("data-hotspot-video=loop") >= 0 && vidLoop.indexOf("loop=") >= 0);
  ok("video: an image screen still emits <img> (no <video>)", ser(makeHotspot({ type: "hotspot", entry: "s0", trackViewed: false, screens: [ { id: "s0", visual: "a.png", kind: "image", markers: [] } ] })).indexOf("hotspot-video") < 0);

  // (g) #218 completion + Navigation trail render hooks (runtime drives the behaviour;
  // gating/trail interaction is browser-verified). Completion screen id + trail landmark
  // + screen-name labels + screens-visited counter are the pure, stable DOM contract.
  var t4 = ser(makeHotspot({ type: "hotspot", entry: "s0", trail: true, completionScreen: "s1", screens: [ { id: "s0", visual: "a.png", markers: [ { id: "m0", x: 1, y: 1, action: "navigate", target: "s1" } ] }, { id: "s1", visual: "b.png", name: "Done", markers: [] } ] }));
  ok("completion: stage carries data-hotspot-complete-screen", t4.indexOf("data-hotspot-complete-screen=s1") >= 0);
  ok("completion: screen-mode counter counts screens visited", t4.indexOf("'0 of 2 screens visited'") >= 0);
  ok("trail: an empty <nav.hotspot-trail> landmark when block.trail is on", /nav\.hotspot-trail\{aria-label=Tour path;data-hotspot-trail=1;hidden\}/.test(t4));
  ok("trail: a named screen carries data-screen-name (crumb label source)", t4.indexOf("data-screen-name=Done") >= 0);
  ok("trail: no trail nav when block.trail is off", ser(makeHotspot(migrate(scrFixture()))).indexOf("hotspot-trail") < 0);
  // render is a pure fn of the migrated doc — rendering twice is identical
  var again = migrate(popFixture());
  ok("render parity: stable across repeat renders", ser(makeHotspot(again)) === ser(makeHotspot(again)));

  // ---- #224 T6: loop (screen-carousel) membership normalization + render purity ----
  section("#224 hotspot loops (T6)");
  var normLoops = winStub.normalizeHotspotLoops;
  ok("locate normalizeHotspotLoops", typeof normLoops === "function");
  // (a) no loops key -> untouched (render-pure default; no noise added)
  var nl0 = { type: "hotspot", entry: "s0", screens: [{ id: "s0", markers: [] }] };
  normLoops(nl0); ok("loops: absent stays absent", !("loops" in nl0));
  // (b) a non-array loops value is dropped (defensive)
  var nl1 = { type: "hotspot", screens: [], loops: { bad: 1 } };
  normLoops(nl1); ok("loops: non-array dropped", !("loops" in nl1));
  // (c) membership pruned to existing screens, deduped, a screen belongs to at most one loop
  var nl2 = { type: "hotspot", screens: [{ id: "s0" }, { id: "s1" }, { id: "s2" }],
    loops: [{ id: "L1", screens: ["s0", "s1", "s1", "ghost"] }, { id: "L2", screens: ["s1", "s2"] }] };
  normLoops(nl2);
  ok("loops: L1 pruned+deduped (ghost gone)", nl2.loops[0].screens.join(",") === "s0,s1");
  ok("loops: L2 loses s1 (claimed by L1), keeps s2", nl2.loops[1].screens.join(",") === "s2");
  // (d) a loop missing an id gets one; idempotent thereafter
  var nl3 = { type: "hotspot", screens: [{ id: "s0" }], loops: [{ screens: ["s0"] }] };
  normLoops(nl3); ok("loops: missing id assigned", typeof nl3.loops[0].id === "string" && nl3.loops[0].id.length > 0);
  var nl3snap = JSON.stringify(nl3); normLoops(nl3);
  ok("loops: idempotent re-run", JSON.stringify(nl3) === nl3snap);
  // (e) T6b render: a navigate marker targeting a loop emits hidden membership metadata +
  // the shared loop MODAL (dialog); render READS membership/order/wrap but IGNORES the
  // loop's editor-only board coords (bx/by/bw/bh), so it stays a pure fn of the doc.
  var lbase = { type: "hotspot", entry: "s0", screens: [
    { id: "s0", visual: "a.png", markers: [{ id: "m0", x: 1, y: 1, action: "navigate", target: "loopA" }] },
    { id: "s1", visual: "b.png", markers: [] },
    { id: "s2", visual: "c.png", markers: [] }] };
  function withLoop(coords) { var d = JSON.parse(JSON.stringify(lbase)); d.loops = [Object.assign({ id: "loopA", name: "States", screens: ["s1", "s2"], wrap: true }, coords)]; return d; }
  ok("loops: render ignores loop board coords (bx/by/bw/bh)",
    ser(makeHotspot(withLoop({ bx: 10, by: 20, bw: 200, bh: 100 }))) === ser(makeHotspot(withLoop({ bx: 999, by: 40, bw: 300, bh: 500 }))));
  var lser = ser(makeHotspot(withLoop({ bx: 0, by: 0 })));
  ok("loops: emits .hotspot-loop metadata with ordered members + wrap", /hotspot-loop\{[^}]*data-loop-screens=s1,s2[^}]*data-loop-wrap=1/.test(lser));
  ok("loops: emits the loop modal (dialog + prev/next/close)", lser.indexOf("hotspot-loop-modal") >= 0 && lser.indexOf("data-loop-prev") >= 0 && lser.indexOf("data-loop-next") >= 0 && lser.indexOf("data-loop-close") >= 0);
  // GATING: loops present but NOT targeted -> no modal (frozen no-loop DOM stays byte-identical)
  ok("loops: no modal when no marker targets a loop", ser(makeHotspot({ type: "hotspot", entry: "s0",
    screens: [{ id: "s0", visual: "a.png", markers: [{ id: "m0", x: 1, y: 1, action: "navigate", target: "s1" }] }, { id: "s1", visual: "b.png", markers: [] }],
    loops: [{ id: "loopA", screens: ["s1"] }] })).indexOf("hotspot-loop-modal") < 0);
})();

// ---- Repository hygiene gate (HARD FAIL) ---------------------------------
// Keeps the public repo free of customer/proprietary content, the removed in-app
// assistant/translation code, personal paths, secrets, external CDN loads, and
// committed course content. Delegates to the standalone scanner so the same check
// runs in CI (here) and in the pre-commit hook. See scripts/check-hygiene.js.
section("repository hygiene gate (HARD FAIL)");
(function () {
  var r = cp.spawnSync(process.execPath, [path.join(ROOT, "scripts/check-hygiene.js")], { encoding: "utf8" });
  if (r.status !== 0 && r.stderr) console.error(r.stderr.replace(/^/gm, "  "));
  ok("repo hygiene: no proprietary/assistant/secret/CDN/course-content violations", r.status === 0);
})();

// ---- report (await any async sections first) -----------------------------
Promise.all(__async).then(function () {
  console.log("\n=== regression suite: " + (total - failed) + "/" + total + (warnings ? " (" + warnings + " warn)" : "") + " ===");
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.error("  FAIL [async] unhandled: " + (e && e.stack || e));
  process.exit(1);
});
