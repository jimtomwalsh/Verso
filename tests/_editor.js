// tests/_editor.js -- boot the REAL editor.js in the VM tier, and hand back the window it built
// (arch-P3b-01).
//
// WHY THIS EXISTS. P3 moved nine regions' decisions out of editor.js and left every one of their
// DOM halves behind, on the belief that a panel renderer cannot be tested until its logic is
// filleted out of it. That belief was wrong, and this file is the proof: _load.js already runs a
// classic script in a node vm against a stub window, and editor.js loads under it whole -- all
// 26,000 lines, through its real boot, publishing its real window.Editor seam.
//
// So a moved region does not need a pure core to earn a test. Boot the editor, drive the region's
// published entry points, assert what comes back. That is the standard test for every P3b move.
//
// THE ONE THING THAT MADE IT WORK. _load.js's document returns null from getElementById, and
// editor.js's boot threads through dozens of `var el = document.getElementById(...); if (el)`
// guards. Returning a fresh node for every id asked for gets further, and lies: boot then walks
// paths the real page never walks, and a test can pass on a branch that cannot execute in a
// browser. So the id set is parsed out of the PAGE -- 78 of them in index.html -- and an id that
// is not in the markup returns null here exactly as it would there. The stub can be shallow; it
// must not be untrue.
//
// WHAT THIS IS NOT. Still not a DOM. Nodes have no layout, no events, no parent chain, and
// querySelector finds nothing. It proves a region LOADS, WIRES and COMPUTES. Anything about what
// the author actually sees belongs in the browser harness (tests/e2e.js), diffed against staging.
"use strict";
var fs = require("fs");
var path = require("path");
var load = require("./_load.js");

var ROOT = path.join(__dirname, "..");

// Every <script> a page runs, in document order: a src as its path, an inline block as its code.
// The page is the source of truth for load order, so a script added to index.html and forgotten
// here cannot happen -- and the inline ones count. kit.html sets window.__KIT_MODE inline, and a
// boot that skipped it would run the full init against a page that has none of init's elements.
function scripts(page) {
  var html = fs.readFileSync(path.join(ROOT, page), "utf8");
  var re = /<script([^>]*)>([\s\S]*?)<\/script>/g, m, out = [];
  while ((m = re.exec(html))) {
    var src = /\ssrc="([^"]+)"/.exec(m[1]);
    if (src) out.push(src[1]);
    else if (m[2].trim()) out.push({ code: m[2], filename: page + " (inline)" });
  }
  return out;
}
function isFile(entry, rel) { return typeof entry === "string" && entry === rel; }

// The ids the page actually declares. Anything else resolves to null, as it would in a browser.
function idsIn(page) {
  var html = fs.readFileSync(path.join(ROOT, page), "utf8");
  var re = /\sid="([^"]+)"/g, m, set = Object.create(null);
  while ((m = re.exec(html))) set[m[1]] = true;
  return set;
}

// boot(opts) -> the stub window after editor.js and everything before it has run.
//
//   opts.page     which page's script list and ids to use (default index.html; kit.html is the
//                 other one that loads editor.js, and it boots in __KIT_MODE).
//   opts.window   seeded onto the stub before anything runs -- a flag, a fake bridge, a spy.
//   opts.quiet    swallow console output (default true). Whatever was logged comes back on
//                 win.__log, so a test can assert the boot was clean instead of reading scrollback.
//
// Everything that loads AFTER editor.js on the page (persist, export, csv, the codecs) is left
// out: those register into window.Editor at runtime and none of the editor's own boot depends on
// them. Pass them in opts.also if a test needs one.
function boot(opts) {
  opts = opts || {};
  var page = opts.page || "index.html";
  var all = scripts(page);
  var at = -1;
  all.forEach(function (e, i) { if (at < 0 && isFile(e, "src/editor.js")) at = i; });
  if (at < 0) throw new Error("_editor.boot: " + page + " does not load src/editor.js");
  var before = all.slice(0, at).concat(opts.also || []);

  var ids = idsIn(page);
  var doc = load.makeDocument();
  var byId = Object.create(null);
  // Same node every time for a given id: editor.js caches element references at boot and compares
  // them later, so handing back a new object per call would break identity in a way a browser
  // never does.
  doc.getElementById = function (id) {
    if (!ids[id]) return null;
    return byId[id] || (byId[id] = load.makeNode("div"));
  };

  var log = [];
  var quiet = opts.quiet !== false;
  var console_ = {
    log: rec("log"), info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug")
  };
  function rec(level) {
    return function () {
      log.push({ level: level, args: Array.prototype.slice.call(arguments) });
      if (!quiet) console[level].apply(console, arguments);
    };
  }

  var seed = { document: doc, console: console_ };
  Object.keys(opts.window || {}).forEach(function (k) { seed[k] = opts.window[k]; });

  var win = load.load("src/editor.js", { also: before, window: seed });
  win.__log = log;
  win.__docStub = doc;
  return win;
}

// Load, and report the failure rather than throwing, so a broken boot reads as one failed
// assertion instead of taking the suite down.
function tryBoot(opts) {
  try { return { win: boot(opts), error: null }; }
  catch (e) { return { win: null, error: (e && e.stack) || String(e) }; }
}

module.exports = { boot: boot, tryBoot: tryBoot, scripts: scripts, idsIn: idsIn };
