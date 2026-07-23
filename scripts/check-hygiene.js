#!/usr/bin/env node
/*
 * scripts/check-hygiene.js -- repository hygiene gate.
 *
 *   node scripts/check-hygiene.js
 *
 * Fails (exit 1) if any tracked file reintroduces content this repository must stay
 * free of: customer/proprietary terms, the removed in-app assistant / translation code,
 * hardcoded personal filesystem paths, secrets, external CDN <script> loads in shipping
 * HTML, or committed course-content data files.
 *
 * Pure Node, no dependencies (matches the app's constraints). Runs in CI (via the test
 * suite) and locally (via the pre-commit hook + `node tests/run.js`).
 *
 * The customer/assistant denylist terms below are assembled from fragments on purpose,
 * so this control file does not itself put those literals into the public repository.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var ROOT = path.join(__dirname, "..");

// Assemble denylist literals from fragments (keeps the literal strings out of this file).
var CUSTOMER = new RegExp(
  ["C" + "UAS", "C-" + "UAS", "Rf" + "Patrol", "Rf Pat" + "rol",
   "Drone" + "Shield", "Drone" + "Sentry", "Drone" + "Gun", "Drone" + "OptID",
   "com\\." + "droneshield", "counter-" + "drone"].join("|"), "i");
var ASSISTANT = new RegExp(
  ["Verso" + "Agent", "agent-" + "host", "Verso" + "I18n",
   "@anthropic", "claude-" + "agent-sdk", "CLAUDE_CODE_" + "OAUTH"].join("|"), "");

var GROUPS = [
  { name: "customer / proprietary term", re: CUSTOMER },
  { name: "removed assistant / translation code", re: ASSISTANT },
  { name: "colleague name", re: /\b(Denis|Evie)\b/ },
  { name: "personal filesystem path", re: /\/Users\/[a-z][a-z0-9._-]+\// },
  { name: "hardcoded secret", re: /sk-ant-[A-Za-z0-9-]{16}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20}|xox[baprs]-[A-Za-z0-9-]{10}|-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
// External CDN <script>/<link> loads are only forbidden in shipping HTML.
var CDN_IN_HTML = /<(?:script|link)\b[^>]*\b(?:src|href)=["']https?:\/\//i;
// Course-content data files must never be committed (they belong in the private fork).
var COURSE_FILE = /\.versopub\.json$|\.scorm$|_SCORM\.zip$|(?:^|\/)(?:DRO-|course-data-)/i;

var TEXT = /\.(?:js|mjs|jsx|ts|css|html?|md|json|ya?ml|swift|sh|command|csv|txt)$/i;
// Skip this control file and the test suite (both legitimately contain the patterns).
var SKIP = /^(?:scripts\/check-hygiene\.js|tests\/run\.js)$/;

function tracked() {
  var r = cp.spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) { console.error("check-hygiene: `git ls-files` failed"); process.exit(2); }
  return r.stdout.split("\n").filter(Boolean);
}

var files = tracked();
var violations = [];

files.forEach(function (f) {
  if (COURSE_FILE.test(f)) violations.push({ file: f, group: "committed course-content file", match: f });
  if (SKIP.test(f) || !TEXT.test(f)) return;
  var txt;
  try { txt = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch (e) { return; }
  GROUPS.forEach(function (g) {
    var m = g.re.exec(txt);
    if (m) violations.push({ file: f, group: g.name, match: m[0], line: lineOf(txt, m.index) });
  });
  if (/\.html?$/i.test(f)) {
    var c = CDN_IN_HTML.exec(txt);
    if (c) violations.push({ file: f, group: "external CDN load in shipping HTML", match: c[0].slice(0, 60), line: lineOf(txt, c.index) });
  }
});

function lineOf(txt, idx) { return txt.slice(0, idx).split("\n").length; }

if (violations.length) {
  console.error("\nHYGIENE GATE FAILED — " + violations.length + " violation(s):\n");
  violations.slice(0, 50).forEach(function (v) {
    console.error("  [" + v.group + "] " + v.file + (v.line ? ":" + v.line : "") + "  -> '" + v.match + "'");
  });
  if (violations.length > 50) console.error("  ... and " + (violations.length - 50) + " more");
  console.error("\nThese must not enter this repository. Customer content belongs in the private");
  console.error("internal fork; the assistant/translation code stays out until re-authorized.\n");
  process.exit(1);
}
console.log("hygiene gate: clean (" + files.length + " tracked files scanned)");
process.exit(0);
