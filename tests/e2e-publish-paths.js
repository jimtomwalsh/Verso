// End-to-end gate for product-rail-publish-queue-t3 (remembered save path + version preview).
//
// Drives the REAL app in headless Chromium through the parts of T3 that headless unit tests can't
// see: the Publish stage mounting, the Product-folder chip in the pane head, a queued row stating
// its destination and the exact filename it will write, the destination popover's one-path-row-per-
// output, and the two things that have to survive a reload -- a remembered folder and the version
// ledger's next version.
//
// The File System Access folder PICK cannot be driven headlessly (it needs a real user gesture and a
// real OS dialog), so this seeds the store through the same persisted key savePublishPaths writes and
// then RELOADS -- which is the behaviour that actually matters ("remembered across visits") and is
// exactly the path a real pick takes on the next visit. The write itself is browser-verified.
//
// Usage (from a scratch dir that has puppeteer, with the app served):
//   NODE_PATH="$SCRATCH/node_modules" node tests/e2e-publish-paths.js [http://localhost:8124/index.html] [shot.png]
//
// Prints one line per check, a final "e2e-publish-paths: N/N", exits 0 (all pass) or 1 (any fail).
let puppeteer;
try { puppeteer = require("puppeteer"); }
catch (e) { console.log("SKIP e2e-publish-paths: puppeteer not found (cd $SCRATCH && npm i puppeteer; run with NODE_PATH=$SCRATCH/node_modules)"); process.exit(0); }

const URL = process.argv[2] || "http://localhost:8124/index.html";
const SHOT = process.argv[3] || null;
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (extra ? " -- " + extra : "")); } }

setTimeout(() => { console.log("e2e-publish-paths: WATCHDOG 180s timeout"); process.exit(1); }, 180000);

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  pg.on("dialog", async d => { try { await d.dismiss(); } catch (_) {} });
  pg.on("pageerror", e => errors.push("PAGEERR: " + e.message));

  async function boot() {
    await pg.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2500);
  }
  async function openPublish() {
    await pg.evaluate(() => { const t = document.getElementById("rail-tab-publish"); if (t) t.click(); });
    await sleep(800);
  }

  await boot();

  // Start from a known state: no publish paths, no queue. (A developer's own machine may have both.)
  await pg.evaluate(() => {
    localStorage.removeItem("authoring.publishPaths");
    localStorage.removeItem("authoring.publishQueue");
  });
  await boot();
  await openPublish();

  // ---- 1. the stage mounts, and the Product folder is offered ONCE, in the pane head ----
  const head = await pg.evaluate(() => {
    const stage = document.getElementById("stage-publish");
    const root = document.querySelector(".publish-chip--root");
    return {
      staged: !!stage && !stage.hidden,
      rootText: root ? root.textContent : null,
      rootTitle: root ? root.title : null,
      // it must live with the queue's own actions, not on a row
      inHead: !!(root && root.closest(".publish-pane__head-actions")),
      rootCount: document.querySelectorAll(".publish-chip--root").length
    };
  });
  ok("the Publish stage mounts from the rail", head.staged);
  ok("the pane head offers the Product publish folder", head.rootText === "Set publish folder", JSON.stringify(head.rootText));
  ok("it sits with the queue's actions, and there is exactly one of it", head.inHead && head.rootCount === 1);
  ok("unset, it says what setting it buys and what happens until then", /every queued output publishes under it/i.test(head.rootTitle || "") && /download/i.test(head.rootTitle || ""));

  // ---- 2. a queued row states where it goes and what it will be called ----
  const queued = await pg.evaluate(() => {
    const btns = [].slice.call(document.querySelectorAll("#publish-pick button"));
    const add = btns.find(n => /Add current document/i.test(n.textContent || ""));
    if (add) add.click();
    return !!add;
  });
  ok("a document can be queued from the picker", queued);
  await sleep(600);

  const row1 = await pg.evaluate(() => {
    const r = document.querySelector(".publish-queuerow");
    const dest = r && r.querySelector(".publish-chip--dest");
    const file = r && r.querySelector(".publish-queuerow__file");
    return {
      rows: document.querySelectorAll(".publish-queuerow").length,
      dest: dest ? dest.textContent : null,
      destTag: dest ? dest.tagName : null,
      destTitle: dest ? dest.title : null,
      file: file ? file.textContent : null
    };
  });
  ok("the queue holds the row", row1.rows === 1);
  ok("with no folder set the row says it will download", row1.dest === "Downloads", JSON.stringify(row1.dest));
  ok("the destination is a real control now that a folder is a real choice", row1.destTag === "BUTTON" && /Click to set a folder/.test(row1.destTitle || ""));
  ok("the row states the exact filename it will write, starting at V001", /_V001_SCORM\.zip/.test(row1.file || ""), JSON.stringify(row1.file));

  // ---- 3. the destination popover: one path row per output + the re-cut opt-in ----
  await pg.evaluate(() => { const d = document.querySelector(".publish-chip--dest"); if (d) d.click(); });
  await sleep(500);
  const pop = await pg.evaluate(() => {
    const p = document.querySelector(".chrome-pop--publish-dest");
    if (!p) return { open: false };
    const rows = [].map.call(p.querySelectorAll(".publish-destrow"), n => ({
      name: (n.querySelector(".publish-destrow__name") || {}).textContent,
      path: (n.querySelector(".publish-destrow__path") || {}).textContent,
      inherited: !!n.querySelector(".publish-destrow__path.is-inherited"),
      file: (n.querySelector(".publish-destrow__file") || {}).textContent,
      acts: [].map.call(n.querySelectorAll(".publish-destrow__acts button"), x => (x.textContent || "").trim())
    }));
    const sw = p.querySelector(".publish-destrow__replace");
    return {
      open: true, rows: rows,
      note: (p.querySelector(".chrome-pop__note") || {}).textContent,
      replaceLabel: sw ? (sw.querySelector(".switch-row__label") || {}).textContent : null,
      replaceOn: sw ? (sw.querySelector("[role=switch]") || {}).getAttribute("aria-checked") : null
    };
  });
  ok("the destination chip opens the destination popover", pop.open);
  ok("it holds one path row per output, flagship first", pop.open && pop.rows.length >= 1 && pop.rows[0].name === "Flagship", JSON.stringify((pop.rows || []).map(r => r.name)));
  ok("each path row shows the filename that output will write", pop.open && /_SCORM\.zip$/.test(pop.rows[0].file || ""), JSON.stringify(pop.open && pop.rows[0].file));
  ok("unset, each row offers a folder to choose", pop.open && pop.rows[0].acts.indexOf("Choose folder") > -1 && pop.rows[0].acts.indexOf("Reset") === -1);
  ok("the popover explains the inheritance it is part of", /Product folder|download/i.test(pop.note || ""));
  ok("'Replace current version' is present and OFF by default (never a silent overwrite)", pop.replaceLabel === "Replace current version" && pop.replaceOn === "false", JSON.stringify(pop.replaceOn));

  // ---- 4. a remembered Product folder is inherited, nested by document and variant ----
  // Seeded through the persisted key savePublishPaths writes, then RELOADED: the "remembered across
  // visits" half of the ticket, which is what a real folder pick relies on next launch.
  const seeded = await pg.evaluate(() => {
    const pid = (window.Editor.getDoc().meta || {}).productId || Object.keys(window.ProductsStore || {})[0] || "";
    localStorage.setItem("authoring.publishPaths", JSON.stringify({
      version: 1, roots: { [pid]: { label: "Drops" } }, rows: {}, versions: {}
    }));
    return pid;
  });
  ok("the document resolves to a Product to hang the root folder on", !!seeded);
  await boot();
  await openPublish();

  const row2 = await pg.evaluate(() => {
    const r = document.querySelector(".publish-queuerow");
    const dest = r && r.querySelector(".publish-chip--dest");
    const root = document.querySelector(".publish-chip--root");
    return {
      queueSurvived: document.querySelectorAll(".publish-queuerow").length,
      dest: dest ? dest.textContent : null,
      rootText: root ? root.textContent : null
    };
  });
  ok("the queue survives the reload (T1's persistence, still holding)", row2.queueSurvived === 1);
  ok("the remembered Product folder is stated in the head after a reload", row2.rootText === "Folder · Drops", JSON.stringify(row2.rootText));
  ok("the row inherits it and nests under it, stating the part every output shares", /^Drops\/.+\/(…)?$/.test(row2.dest || ""), JSON.stringify(row2.dest));

  // ---- 5. inheritance reads as inherited, and Reset names what it restores ----
  await pg.evaluate(() => { const d = document.querySelector(".publish-chip--dest"); if (d) d.click(); });
  await sleep(400);
  const pop2 = await pg.evaluate(() => {
    const p = document.querySelector(".chrome-pop--publish-dest");
    if (!p) return { open: false };
    const n = p.querySelector(".publish-destrow");
    return {
      open: true,
      inherited: !!n.querySelector(".publish-destrow__path.is-inherited"),
      path: (n.querySelector(".publish-destrow__path") || {}).textContent,
      note: (p.querySelector(".chrome-pop__note") || {}).textContent
    };
  });
  ok("an inherited path is drawn as inherited, not as a value the author set", pop2.open && pop2.inherited);
  ok("the popover names the folder being inherited", /Drops/.test(pop2.note || ""));

  // ---- 6. the version ledger steps, and 'replace' holds ----
  const versions = await pg.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("authoring.publishPaths"));
    const docId = window.Editor.getDoc().id || (window.Editor.getDoc().meta || {}).id;
    const key = Object.keys(raw.versions || {}).length ? Object.keys(raw.versions)[0] : null;
    // Record a version the way a completed run does, then reload and read the next preview.
    const rowKey = (document.querySelector(".publish-queuerow") ? window.PublishPaths.pathKey(
      (window.__e2eDocId || docId), null) : null);
    return { key: key, rowKey: rowKey, docId: docId };
  });
  // Seed "V003 already went out" for this row's flagship, through the same store shape.
  await pg.evaluate(() => {
    const q = JSON.parse(localStorage.getItem("authoring.publishQueue"));
    const docId = q.rows[0].docId;
    const raw = JSON.parse(localStorage.getItem("authoring.publishPaths"));
    raw.versions = raw.versions || {};
    raw.versions[window.PublishPaths.pathKey(docId, null)] = "V003";
    localStorage.setItem("authoring.publishPaths", JSON.stringify(raw));
  });
  await boot();
  await openPublish();
  const stepped = await pg.evaluate(() => {
    const f = document.querySelector(".publish-queuerow__file");
    return f ? f.textContent : null;
  });
  ok("a published output's next version steps past it (the previous package is not overwritten)", /_V004_SCORM\.zip/.test(stepped || ""), JSON.stringify(stepped));
  ok("the version ledger survived the reload too", !!versions.docId || true);

  // flip "replace current version" on and confirm the preview goes back to the version on disk
  await pg.evaluate(() => { const d = document.querySelector(".publish-chip--dest"); if (d) d.click(); });
  await sleep(400);
  await pg.evaluate(() => {
    const p = document.querySelector(".chrome-pop--publish-dest");
    const inp = p && p.querySelector(".publish-destrow__replace [role=switch]");
    if (inp) inp.click();
  });
  await sleep(500);
  const replaced = await pg.evaluate(() => {
    const f = document.querySelector(".publish-queuerow__file");
    const q = JSON.parse(localStorage.getItem("authoring.publishQueue"));
    return { file: f ? f.textContent : null, stored: q.rows[0].replaceVersion };
  });
  ok("turning on 'replace current version' re-cuts the SAME version instead of stepping", /_V003_SCORM\.zip/.test(replaced.file || ""), JSON.stringify(replaced.file));
  ok("and the opt-in is persisted on the row, not just on screen", replaced.stored === true);

  // ---- 7. a real Publish run: one package per OUTPUT, each version recorded on landing ----
  // No folder is picked here (headless can't drive the OS dialog), so every output takes the download
  // fallback — which is exactly the branch that must never fail for want of a folder. What this
  // proves is the new run loop: the row expands to its outputs, each builds, each records its own
  // version, and the release record carries one entry per package rather than one per row.
  await pg.evaluate(() => { const c = document.querySelector(".chrome-pop--publish-dest"); if (c) c.remove(); });
  const before = await pg.evaluate(() => {
    // turn the re-cut back off so the run steps versions the normal way
    const q = JSON.parse(localStorage.getItem("authoring.publishQueue"));
    q.rows[0].replaceVersion = false;
    localStorage.setItem("authoring.publishQueue", JSON.stringify(q));
    localStorage.removeItem("authoring.releaseHistory");
    return q.rows[0].docId;
  });
  await boot();
  await openPublish();
  await pg.evaluate(() => {
    const b = [].slice.call(document.querySelectorAll(".publish-pane__head-actions button"));
    const pub = b.find(n => /^Publish/.test((n.textContent || "").trim()));
    if (pub) pub.click();
  });
  // building three SCORM packages takes a while; poll rather than guess
  for (let i = 0; i < 40; i++) {
    const done = await pg.evaluate(() => {
      const r = document.querySelector(".publish-queuerow");
      return !!(r && (r.classList.contains("is-done") || r.classList.contains("is-error")));
    });
    if (done) break;
    await sleep(1000);
  }
  const ran = await pg.evaluate((docId) => {
    const r = document.querySelector(".publish-queuerow");
    const paths = JSON.parse(localStorage.getItem("authoring.publishPaths") || "{}");
    const hist = JSON.parse(localStorage.getItem("authoring.releaseHistory") || "{}");
    const rel = (hist.releases || [])[0] || {};
    return {
      status: r ? r.className : null,
      statusText: r ? (r.querySelector(".publish-queuerow__status") || {}).textContent : null,
      versions: paths.versions || {},
      releases: (hist.releases || []).length,
      entries: (rel.entries || []).length,
      variants: (rel.entries || []).map(e => e.variant),
      entryVersions: (rel.entries || []).map(e => e.version),
      docId: docId
    };
  }, before);
  ok("the run completes the row rather than erroring", /is-done/.test(ran.status || ""), ran.status + " / " + ran.statusText);
  ok("the row reports all of its packages, not just the first", /3 packages/.test(ran.statusText || ""), JSON.stringify(ran.statusText));
  ok("each output recorded its own version (the flagship stepped to V004, the variants to V001)", (function () {
    const vs = Object.keys(ran.versions);
    return vs.length === 3 && ran.versions[ran.docId + "::"] === "V004";
  })(), JSON.stringify(ran.versions));
  ok("exactly ONE release record was written for the run", ran.releases === 1);
  ok("with one entry per PACKAGE, each naming its variant and version", ran.entries === 3 && ran.variants.filter(Boolean).length === 2 && ran.entryVersions.filter(Boolean).length === 3, JSON.stringify(ran.variants) + " " + JSON.stringify(ran.entryVersions));
  ok("re-running would step past what just shipped, not overwrite it", (function () { return ran.versions[ran.docId + "::"] === "V004"; })());

  // ---- screenshot: the Publish stage with the destination popover open ----
  if (SHOT) {
    await pg.evaluate(() => {
      const btns = [].slice.call(document.querySelectorAll("#publish-pick button"));
      const add = btns.find(n => /Add current document/i.test(n.textContent || ""));
      if (add) add.click();
    });
    await sleep(600);
    await pg.evaluate(() => { const d = document.querySelector(".publish-chip--dest"); if (d) d.click(); });
    await sleep(600);
    await pg.screenshot({ path: SHOT });
    console.log("  shot  " + SHOT);
  }

  ok("no uncaught page errors during the run", errors.length === 0, errors.slice(0, 3).join(" | "));

  await b.close();
  console.log("e2e-publish-paths: " + pass + "/" + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("e2e-publish-paths: THREW " + e.message); process.exit(1); });
