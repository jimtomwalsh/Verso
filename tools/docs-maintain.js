/*
 * #8 Docs auto-maintenance — keep the User Guide tracking the feature set (code is truth).
 *
 * The guide is hand-written prose (rich per-feature detail we do NOT want to auto-overwrite),
 * so this tool does NOT regenerate the guide. It DETECTS DRIFT: it introspects the app's
 * author-facing surfaces from source (today: the block palette `LIBRARY` in src/editor.js,
 * grouped by category) and checks that `docs/USER-GUIDE.md` documents each one — so adding a
 * feature without documenting it is caught, in the same session, before it ships.
 *
 * This is the runnable, author-facing form of the `#91` anti-drift test gate (which enforces
 * the same block-coverage invariant inside tests/run.js). The pure core is module.exports-ed
 * and shared with that gate so there is ONE source of the coverage logic.
 *
 * Usage:
 *   node tools/docs-maintain.js            # --check (default): exit 1 if anything is undocumented
 *   node tools/docs-maintain.js --check
 *   node tools/docs-maintain.js --report   # print the feature inventory + coverage, exit 0
 *
 * Extensible: add more surfaces (shortcuts, settings, toolbar) as they gain a clean registry.
 */
"use strict";
var fs = require("fs");
var path = require("path");

// ---- Pure core (no IO; shared with the tests/run.js #91 gate) ----------------------------

// Extract the top-level block palette from src/editor.js source -> [{ group, label }].
// Matches only top-level LIBRARY entries (`group:"..", icon:"..", label:".."`), skipping
// nested labels inside make() bodies (checkbox default, quiz retry, ...), same as the gate.
function extractLibrary(editorSrc) {
  var start = editorSrc.indexOf("var LIBRARY = [");
  if (start === -1) return [];
  var lib = editorSrc.slice(start, editorSrc.indexOf("];", start));
  var out = [], re = /group:\s*"([^"]+)",\s*icon:\s*"[^"]*",\s*label:\s*"([^"]+)"/g, m;
  while ((m = re.exec(lib))) out.push({ group: m[1], label: m[2] });
  return out;
}

// A block is documented if its label (or its label minus a trailing "(qualifier)") appears
// verbatim in the guide text. Same rule the #91 gate uses.
function coreLabel(label) { return label.replace(/\s*\(.*\)/, "").trim(); }
function isDocumented(label, guideText) {
  return guideText.indexOf(label) !== -1 || guideText.indexOf(coreLabel(label)) !== -1;
}

// Full coverage report over the block palette.
function blockCoverage(editorSrc, guideText) {
  var blocks = extractLibrary(editorSrc);
  var documented = [], undocumented = [];
  blocks.forEach(function (b) {
    (isDocumented(b.label, guideText) ? documented : undocumented).push(b);
  });
  var groups = {};
  blocks.forEach(function (b) { (groups[b.group] = groups[b.group] || []).push(b); });
  return { total: blocks.length, documented: documented, undocumented: undocumented, groups: groups };
}

module.exports = {
  extractLibrary: extractLibrary,
  coreLabel: coreLabel,
  isDocumented: isDocumented,
  blockCoverage: blockCoverage
};

// ---- CLI ---------------------------------------------------------------------------------
if (require.main === module) {
  var ROOT = path.resolve(__dirname, "..");
  var mode = process.argv.indexOf("--report") !== -1 ? "report" : "check";
  var editorSrc = fs.readFileSync(path.join(ROOT, "src/editor.js"), "utf8");
  var guide = fs.readFileSync(path.join(ROOT, "docs/USER-GUIDE.md"), "utf8");
  var cov = blockCoverage(editorSrc, guide);

  if (mode === "report") {
    console.log("Verso feature inventory — block palette (" + cov.total + " blocks, code is truth)\n");
    Object.keys(cov.groups).forEach(function (g) {
      console.log(g);
      cov.groups[g].forEach(function (b) {
        var ok = isDocumented(b.label, guide);
        console.log("  " + (ok ? "[documented] " : "[MISSING]    ") + b.label);
      });
      console.log("");
    });
    console.log("Coverage: " + cov.documented.length + "/" + cov.total + " blocks documented in docs/USER-GUIDE.md");
    process.exit(0);
  }

  // --check (default)
  if (cov.undocumented.length === 0) {
    console.log("docs-maintain: OK — all " + cov.total + " palette blocks are documented in docs/USER-GUIDE.md");
    process.exit(0);
  }
  console.error("docs-maintain: DRIFT — " + cov.undocumented.length + " block(s) not documented in docs/USER-GUIDE.md:");
  cov.undocumented.forEach(function (b) { console.error("  - " + b.label + "  (group: " + b.group + ")"); });
  console.error("\nDocument each in docs/USER-GUIDE.md (§ 5 — the block catalogue), then re-run.");
  process.exit(1);
}
