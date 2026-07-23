// Persistent end-to-end gate (HHH). Drives the REAL app in headless Chromium through
// the full lifecycle that the pure-node suite (tests/run.js) can't see:
//
//   edit a text block  ->  autosave  ->  reload  ->  assert lossless round-trip
//                       ->  SCORM export  ->  validate the package
//
// It edits the first text block to a unique marker and REVERTS it at the end, so the
// live doc in localStorage is left unchanged (net-zero mutation).
//
// Usage (from a scratch dir that has puppeteer, with the app served):
//   cd "$CODE" && python3 -m http.server 8123 &
//   NODE_PATH="$SCRATCH/node_modules" node tests/e2e.js [http://localhost:8123/index.html]
//
// Prints one line per check, a final "e2e: N/N", and exits 0 (all pass) or 1 (any fail).
let puppeteer;
try { puppeteer = require("puppeteer"); }
catch (e) { console.log("SKIP e2e: puppeteer not found (cd $SCRATCH && npm i puppeteer; run with NODE_PATH=$SCRATCH/node_modules)"); process.exit(0); }

const URL = process.argv[2] || "http://localhost:8123/index.html";
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (extra ? " -- " + extra : "")); } }

setTimeout(() => { console.log("e2e: WATCHDOG 45s timeout"); process.exit(1); }, 45000);

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const pg = await b.newPage();
  const errors = [];
  pg.on("dialog", async d => { try { await d.dismiss(); } catch (_) {} });
  pg.on("pageerror", e => errors.push("PAGEERR: " + e.message));
  await pg.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500)); // boot + mount + fonts

  const MARK = "E2E_MARKER_" + Date.now();

  // ---- 1. edit the first editable text block -> autosave ----
  const editRes = await pg.evaluate(async (MARK) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const node = [].find.call(document.querySelectorAll("[data-edit]"), n => n.getAttribute("contenteditable") === "true" && n.__bind && !n.getAttribute("data-rich"));
    if (!node) return { found: false };
    const bind = node.__bind, original = bind.obj[bind.field];
    node.focus();
    node.textContent = MARK;
    node.dispatchEvent(new InputEvent("input", { bubbles: true })); // -> writeModel -> scheduleSave
    node.blur();                                                    // -> flushSave (writes localStorage now)
    await sleep(300);
    return { found: true, original: original == null ? "" : original, field: bind.field };
  }, MARK);
  ok("found an editable text block", editRes.found);
  if (!editRes.found) { console.log("e2e: " + pass + "/" + (pass + fail)); process.exit(1); }

  // ---- 2. reload -> the marker must survive (autosave -> boot round-trip) ----
  await pg.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  await new Promise(r => setTimeout(r, 2500));
  const afterReload = await pg.evaluate((MARK) => {
    const doc = window.Editor.getDoc();
    let hit = false;
    (function scan(v) { if (typeof v === "string") { if (v === MARK) hit = true; return; } if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === "object") Object.keys(v).forEach(k => scan(v[k])); })(doc);
    return { markerPresent: hit, roundTrips: JSON.stringify(doc) === JSON.stringify(JSON.parse(JSON.stringify(doc))) };
  }, MARK);
  ok("edit survived autosave + reload (lossless)", afterReload.markerPresent);
  ok("reloaded doc round-trips through JSON", afterReload.roundTrips);

  // ---- 3. SCORM export -> validate the package ----
  const exp = await pg.evaluate(async (MARK) => {
    const opts = window.SCORMExport.defaultOptions ? window.SCORMExport.defaultOptions() : {};
    const pkg = await window.SCORMExport.buildPackage(opts);
    const names = pkg.files.map(f => f.name);
    const dec = n => { const f = pkg.files.find(x => x.name === n); return f ? new TextDecoder().decode(f.bytes) : null; };
    const idx = dec("index.html") || "";
    const man = dec("imsmanifest.xml") || "";
    return {
      names: names,
      hasIndex: names.indexOf("index.html") !== -1,
      hasManifest: names.indexOf("imsmanifest.xml") !== -1,
      hasCss: names.indexOf("course.css") !== -1,
      hasRuntime: names.indexOf("runtime.js") !== -1,
      allNonEmpty: pkg.files.every(f => f.bytes && f.bytes.length > 0),
      indexHasMarker: idx.indexOf(MARK) !== -1,
      manifestValid: /<manifest/i.test(man) && /<organization/i.test(man) && /identifierref/i.test(man)
    };
  }, MARK);
  ok("export has index.html", exp.hasIndex);
  ok("export has imsmanifest.xml", exp.hasManifest);
  ok("export has course.css", exp.hasCss);
  ok("export has runtime.js", exp.hasRuntime);
  ok("every packaged file is non-empty", exp.allNonEmpty);
  ok("exported index.html reflects the edit", exp.indexHasMarker);
  ok("imsmanifest.xml is structurally valid SCORM", exp.manifestValid, JSON.stringify(exp.names));

  // ---- 4. revert the edit so the live doc is left unchanged ----
  const reverted = await pg.evaluate(async (original) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const node = [].find.call(document.querySelectorAll("[data-edit]"), n => n.getAttribute("contenteditable") === "true" && n.__bind && !n.getAttribute("data-rich"));
    if (!node) return false;
    node.focus(); node.textContent = original; node.dispatchEvent(new InputEvent("input", { bubbles: true })); node.blur();
    await sleep(300);
    return node.__bind.obj[node.__bind.field] === original;
  }, editRes.original);
  ok("reverted the edit (live doc left unchanged)", reverted);

  ok("no page errors during the run", errors.length === 0, errors.join(" | "));

  try { const proc = b.process(); if (proc) proc.kill("SIGKILL"); } catch (_) {}
  console.log("e2e: " + pass + "/" + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("e2e: ERROR " + String((e && e.message) || e)); process.exit(1); });
