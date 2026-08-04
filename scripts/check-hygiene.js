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
 * It also enforces the repository boundary: every top-level entry must carry a declared
 * role in the ROLES table below, which mirrors the table in README.md. A new top-level
 * file or folder fails until it is classified, and nothing under the gitignored role may
 * be staged. Runtime dependencies are rejected the same way.
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

// ---- Repository boundary -------------------------------------------------
// One declared role per top-level entry. Mirrors the table in README.md; keep the two
// in step. Directories carry a trailing slash. Adding an entry here is a deliberate act:
// state which role it belongs to and why in the PR.
var ROLES = {
  // The product. Present in every install; the app runs from these alone.
  ships: ["index.html", "styles/", "src/", "export/", "assets/", "fonts/",
          "serve.command", "course_schema_template.csv"],
  // Real surfaces for one posture each. The app runs without them.
  optional: ["server/", "desktop/"],
  // Authoring-time and CI material. Never loaded by the running app.
  dev: ["tools/", "scripts/", "tests/", "design-system/", "docs/", "viewer/",
        "kit.html", "kit-gallery.js", ".github/"],
  // Repository documentation and the manifest.
  meta: ["README.md", "CONTRIBUTING.md", "LICENSE", "NOTICE", "SECURITY.md",
         "THIRD-PARTY-NOTICES.md", "SCHEMA-TEMPLATE-GUIDE.md", "roadmap.html",
         "package.json", ".gitignore"],
  // Working material — local only, must never be staged.
  ignored: ["workbench/"],
};

function declared() {
  var m = Object.create(null);
  Object.keys(ROLES).forEach(function (role) {
    ROLES[role].forEach(function (entry) { m[entry] = role; });
  });
  return m;
}

// The app is dependency-free: package.json may declare no third-party packages.
var DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

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

// ---- Repository boundary: every top-level entry has a declared role ------
var ROLE_OF = declared();
var seen = Object.create(null);

files.forEach(function (f) {
  var i = f.indexOf("/");
  var top = i === -1 ? f : f.slice(0, i + 1);
  if (seen[top]) return;
  seen[top] = true;
  var role = ROLE_OF[top];
  if (!role) {
    violations.push({ file: f, group: "undeclared top-level entry",
      match: top + " — classify it in ROLES (scripts/check-hygiene.js) and the README boundary table" });
  } else if (role === "ignored") {
    violations.push({ file: f, group: "staged working material",
      match: top + " — this role is gitignored and must stay local" });
  }
});

// A declared entry that no longer exists means the table has drifted from the tree.
Object.keys(ROLE_OF).forEach(function (entry) {
  if (ROLE_OF[entry] === "ignored") return;   // gitignored by design; never tracked
  if (!seen[entry]) {
    violations.push({ file: entry, group: "stale boundary entry",
      match: entry + " — declared in ROLES but no tracked file lives there" });
  }
});

// ---- Zero runtime dependencies ------------------------------------------
try {
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  DEP_FIELDS.forEach(function (field) {
    var names = Object.keys(pkg[field] || {});
    if (names.length) {
      violations.push({ file: "package.json", group: "third-party dependency",
        match: field + ": " + names.join(", ") + " — Verso ships with none" });
    }
  });
} catch (e) {
  violations.push({ file: "package.json", group: "missing or unreadable manifest", match: String(e.message) });
}

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
