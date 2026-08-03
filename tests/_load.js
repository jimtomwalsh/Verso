// tests/_load.js -- run one of the app's classic scripts in a real node:vm context, with a stub
// window/document, and hand back what it published (arch-P2, tier 2).
//
// WHY THIS EXISTS. The suite's original premise was "the app is one classic-script IIFE per file,
// so there is nothing to import", and it compensated by reading source text and string-slicing
// pure cores back into life. That made the harness the thing forbidding a restructure: you could
// not move a line without the tests noticing the wrong thing.
//
// Tier 1 is the better answer where it fits -- a file that publishes onto `window` gets a
// dual-mode footer and a plain `require` returns its real interface. This is tier 2, for the
// files a bare `require` cannot reach:
//
//   * files that touch document/localStorage/fetch as they load, and
//   * files that are ACTIVATION-GATED and return early unless something is already on window
//     (store-http needs `__versoServerUrl`, store-native needs the Verso shell's webkit bridge,
//     capture-mode needs the capture flag). A `require` cannot seed those -- it runs the IIFE
//     before you can reach it. Here you pass them in `opts.window` and the gate opens.
//
// What this is NOT: a DOM. The stub is deliberately shallow -- enough for a file to LOAD and
// publish its interface, not enough to render into. Anything that needs real layout or real
// events belongs in the browser-verify harness, not here.
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");

// A DOM node stub: attributes, classes, style and children, with no layout and no events.
// Enough for load-time construction; deliberately not enough to assert rendered markup on.
function makeNode(tag) {
  var node = {
    tagName: String(tag || "div").toUpperCase(),
    nodeType: 1,
    childNodes: [],
    attributes: {},
    dataset: {},
    innerHTML: "",
    textContent: "",
    hidden: false,
    style: makeStyle(),
    classList: makeClassList(),
    appendChild: function (c) { node.childNodes.push(c); return c; },
    removeChild: function (c) { var i = node.childNodes.indexOf(c); if (i !== -1) node.childNodes.splice(i, 1); return c; },
    insertBefore: function (c) { node.childNodes.unshift(c); return c; },
    setAttribute: function (k, v) { node.attributes[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(node.attributes, k) ? node.attributes[k] : null; },
    removeAttribute: function (k) { delete node.attributes[k]; },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(node.attributes, k); },
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    contains: function () { return false; },
    focus: function () {},
    click: function () {},
    remove: function () {},
    getBoundingClientRect: function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
  return node;
}

function makeStyle() {
  var s = { cssText: "", length: 0 };
  s.setProperty = function (k, v) { s[k] = String(v); };
  s.getPropertyValue = function (k) { return s[k] == null ? "" : s[k]; };
  s.removeProperty = function (k) { delete s[k]; };
  return s;
}

function makeClassList() {
  var set = {};
  return {
    add: function () { for (var i = 0; i < arguments.length; i++) set[arguments[i]] = 1; },
    remove: function () { for (var i = 0; i < arguments.length; i++) delete set[arguments[i]]; },
    toggle: function (c, on) { if (on === undefined) { if (set[c]) delete set[c]; else set[c] = 1; } else if (on) set[c] = 1; else delete set[c]; },
    contains: function (c) { return !!set[c]; }
  };
}

function makeDocument() {
  var doc = makeNode("html");
  doc.body = makeNode("body");
  doc.head = makeNode("head");
  doc.documentElement = makeNode("html");
  doc.createElement = function (tag) { return makeNode(tag); };
  doc.createElementNS = function (ns, tag) { return makeNode(tag); };
  doc.createTextNode = function (t) { var n = makeNode("#text"); n.textContent = String(t); return n; };
  doc.createDocumentFragment = function () { return makeNode("#fragment"); };
  doc.getElementById = function () { return null; };
  doc.getElementsByTagName = function () { return []; };
  doc.readyState = "complete";
  return doc;
}

// An in-memory Storage, so a file that reads/writes localStorage at load does not explode.
function makeStorage() {
  var map = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; },
    clear: function () { map = {}; },
    key: function (i) { return Object.keys(map)[i] || null; },
    get length() { return Object.keys(map).length; }
  };
}

// load(rel, opts) -> the stub window, carrying everything the file published.
//
//   opts.window   properties seeded onto the stub BEFORE the file runs. This is how you open an
//                 activation gate, or supply a dependency the file expects another script to have
//                 published first.
//   opts.also     other src files to run into the SAME context first, in order, when the file
//                 genuinely depends on an earlier script (e.g. render.js needs theme.js).
//
// Returns the window object itself, so a test reads the real published interface:
//   var win = load("src/theme.js"); win.THEMES.dark ...
function load(rel, opts) {
  opts = opts || {};
  var win = {};
  win.window = win;
  win.globalThis = win;
  win.self = win;
  win.document = makeDocument();
  win.navigator = { userAgent: "node", language: "en", languages: ["en"], onLine: true, clipboard: { writeText: function () { return Promise.resolve(); } } };
  win.location = { href: "http://localhost/index.html", search: "", hash: "", pathname: "/index.html", origin: "http://localhost", reload: function () {} };
  win.localStorage = makeStorage();
  win.sessionStorage = makeStorage();
  win.addEventListener = function () {};
  win.removeEventListener = function () {};
  win.dispatchEvent = function () { return true; };
  win.matchMedia = function () { return { matches: false, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} }; };
  win.requestAnimationFrame = function (fn) { return setTimeout(function () { fn(0); }, 0); };
  win.cancelAnimationFrame = function (id) { clearTimeout(id); };
  win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  win.setInterval = setInterval; win.clearInterval = clearInterval;
  win.console = console;
  win.fetch = function () { return Promise.reject(new Error("fetch is not available in the load stub")); };
  win.getComputedStyle = function () { return { getPropertyValue: function () { return ""; } }; };
  win.URL = URL; win.Blob = typeof Blob !== "undefined" ? Blob : function () {};
  win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder;
  win.JSON = JSON; win.Math = Math; win.Date = Date; win.Promise = Promise;
  // A vm context gets its own copies of the built-ins, so a Uint8Array made inside it fails
  // `instanceof Uint8Array` outside it. Hand in the host's binary types, which are the ones that
  // actually cross the boundary here (zip bytes, encoders), so tests can assert on them normally.
  win.ArrayBuffer = ArrayBuffer; win.DataView = DataView;
  win.Uint8Array = Uint8Array; win.Uint16Array = Uint16Array; win.Uint32Array = Uint32Array;
  win.Int8Array = Int8Array; win.Int16Array = Int16Array; win.Int32Array = Int32Array;
  win.Float32Array = Float32Array; win.Float64Array = Float64Array;
  win.CSS = { highlights: null, supports: function () { return false; } };
  // A vm context is isolated, so the browser globals the app reaches for have to be handed in.
  // These are the real node implementations where one exists, and an inert stub where it does not.
  win.atob = typeof atob !== "undefined" ? atob : function (s) { return Buffer.from(s, "base64").toString("binary"); };
  win.btoa = typeof btoa !== "undefined" ? btoa : function (s) { return Buffer.from(s, "binary").toString("base64"); };
  win.URLSearchParams = URLSearchParams;
  win.performance = { now: function () { return 0; } };
  win.structuredClone = typeof structuredClone === "function" ? structuredClone : function (v) { return JSON.parse(JSON.stringify(v)); };
  win.crypto = typeof crypto !== "undefined" ? crypto : { getRandomValues: function (a) { return a; } };
  win.alert = function () {}; win.confirm = function () { return false; }; win.prompt = function () { return null; };
  win.Event = typeof Event !== "undefined" ? Event : function () {};
  win.CustomEvent = typeof CustomEvent !== "undefined" ? CustomEvent : function () {};
  function Observer() { return { observe: function () {}, unobserve: function () {}, disconnect: function () {}, takeRecords: function () { return []; } }; }
  win.MutationObserver = Observer; win.ResizeObserver = Observer; win.IntersectionObserver = Observer;

  Object.keys(opts.window || {}).forEach(function (k) { win[k] = opts.window[k]; });

  var ctx = vm.createContext(win);
  (opts.also || []).concat([rel]).forEach(function (f) {
    var code = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInContext(code, ctx, { filename: f });
  });
  return win;
}

// Try to load, and report the failure instead of throwing, so one unloadable file cannot take
// the whole suite down with it.
function tryLoad(rel, opts) {
  try { return { win: load(rel, opts), error: null }; }
  catch (e) { return { win: null, error: (e && e.message) || String(e) }; }
}

module.exports = { load: load, tryLoad: tryLoad, makeNode: makeNode, makeDocument: makeDocument, makeStorage: makeStorage };
