// publish-paths.js -- where a published package lands, and what it is called (Product Rail Epic 6, T3).
//
// Design of record: verso-product-rail/specs/6-deliver-stage-publishing.spec.md +
// product-rail-publish-queue-t3-save-path (grilled with James 2026-07-29). Two decisions from that
// grill shape this module:
//
//   Q1 -- a whole-family publish should cost ONE folder pick, not one per row. So a Product carries a
//         ROOT folder, and every output inherits it, nesting into a tidy `Product/<doc-variant>/`
//         tree. A per-output path still OVERRIDES the root for the exceptions.
//   Q2 -- the default is always a new auto-incremented version; never a silent overwrite. Deliberate
//         re-cuts opt in per row ("replace current version"), which reuses the last version instead
//         of stepping past it.
//
// A destination has three kinds, resolved in that order of specificity: an OVERRIDE picked for this
// one output, the Product ROOT it otherwise inherits, or DOWNLOAD when neither is set (the existing
// fallback -- a blank path is the starting state, never a convention invented for the author).
//
// File System Access directory handles are not serialisable, so this module stores only the folder's
// LABEL and computes the key its handle lives under; the editor keeps the handle itself in IndexedDB
// (the `backupIdb` keyed-handle pattern) and hands it back at write time. That keeps this module
// DOM-free -- no window, no Date.now, no Math.random -- so the whole thing is headlessly testable and
// round-trips through toJSON/fromJSON.
//
// window.PublishPaths.*        -> the store + resolution
// window.PublishPaths._pure.*  -> same, for the headless guard in tests/run.js
(function () {
  "use strict";

  var DOWNLOAD_LABEL = "Downloads";

  // One output = one document + one variant (null/"" = flagship). Format is stamped into the
  // filename by the exporter's packageName, so one folder per doc+variant holds all of its formats.
  function pathKey(docId, variant) {
    return String(docId == null ? "" : docId) + "::" + String(variant == null ? "" : variant);
  }
  // Where the editor keeps each directory handle. Namespaced so the publish handles never collide
  // with the backup/review handles already living in that store.
  function rootHandleKey(productId) { return "publish:root:" + String(productId == null ? "" : productId); }
  function rowHandleKey(key) { return "publish:row:" + String(key == null ? "" : key); }

  // A folder-name analogue of the exporter's fileSafe: keep it to characters every filesystem
  // accepts, collapse runs, and never yield an empty segment.
  function folderSafe(s) {
    var out = String(s == null ? "" : s).trim().replace(/[^A-Za-z0-9 _.-]/g, "-").replace(/[-\s]+/g, "-").replace(/^-+|-+$/g, "");
    return out;
  }
  // The tidy tree an inherited root nests into: `<Product>/<doc-variant>/`. A blank product name
  // contributes no segment rather than a folder called "-".
  function folderSegments(productName, docCode, variant) {
    var segs = [];
    var p = folderSafe(productName); if (p) segs.push(p);
    var leaf = folderSafe(docCode) || "document";
    var v = folderSafe(variant); if (v) leaf += "-" + v;
    segs.push(leaf);
    return segs;
  }

  function create() { return { version: 1, roots: {}, rows: {}, versions: {}, dests: {}, rowDest: {} }; }

  // ---- uio-P-M02: NAMED destinations -----------------------------------------------------------
  // A folder label alone answers "where", never "which one". A team publishes the same document to
  // more than one place -- the LMS it runs on, the share a client collects from -- and a raw path
  // makes the author re-recognise a folder string every time and re-pick it per row. A destination
  // is that folder given a NAME once ("LMS drop . production"), so a row can say which destination
  // it is going to rather than restating a path, and re-pointing every row that uses it is one edit
  // in one place.
  //
  // It sits BETWEEN the per-output override and the Product root in specificity: a row that names a
  // destination overrides the inherited root, and an explicit folder picked for this one output
  // still beats both. Same three-kind vocabulary, one more rung.
  function destHandleKey(id) { return "publish:dest:" + String(id == null ? "" : id); }
  function setDestination(store, id, name, label) {
    if (!store || id == null || String(id) === "") return store;
    store.dests = store.dests || {};
    store.dests[String(id)] = { name: String(name == null ? "" : name), label: String(label == null ? "" : label) };
    return store;
  }
  // Removing a destination un-points every row that used it, rather than leaving rows aimed at a
  // name that no longer resolves -- a dangling reference would silently fall back to the root and
  // publish somewhere nobody chose.
  function removeDestination(store, id) {
    if (!store) return store;
    if (store.dests) delete store.dests[String(id)];
    if (store.rowDest) Object.keys(store.rowDest).forEach(function (k) {
      if (String(store.rowDest[k]) === String(id)) delete store.rowDest[k];
    });
    return store;
  }
  function destination(store, id) {
    var d = store && store.dests && store.dests[String(id)];
    return d ? { id: String(id), name: d.name, label: d.label } : null;
  }
  function destinations(store) {
    var ds = (store && store.dests) || {};
    return Object.keys(ds).map(function (id) { return { id: id, name: ds[id].name, label: ds[id].label }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }
  // Point one output at a named destination (or clear it back to inheriting).
  function setRowDestination(store, key, id) {
    if (!store || !key) return store;
    store.rowDest = store.rowDest || {};
    if (id == null || String(id) === "") delete store.rowDest[key];
    else store.rowDest[key] = String(id);
    return store;
  }
  function rowDestinationId(store, key) {
    var v = store && store.rowDest && store.rowDest[key];
    return v == null ? null : String(v);
  }

  // ---- the Product root (set once, inherited by every output) ----
  function setRoot(store, productId, label) {
    if (!store || productId == null) return store;
    store.roots = store.roots || {};
    store.roots[String(productId)] = { label: String(label == null ? "" : label) };
    return store;
  }
  function clearRoot(store, productId) {
    if (store && store.roots) delete store.roots[String(productId)];
    return store;
  }
  function rootLabel(store, productId) {
    var r = store && store.roots && store.roots[String(productId)];
    return r ? r.label : null;
  }

  // ---- the per-output override (remembered by doc+variant, so it survives the row) ----
  function setRowPath(store, key, label) {
    if (!store || !key) return store;
    store.rows = store.rows || {};
    store.rows[key] = { label: String(label == null ? "" : label) };
    return store;
  }
  function clearRowPath(store, key) {
    if (store && store.rows) delete store.rows[key];
    return store;
  }
  function rowLabel(store, key) {
    var r = store && store.rows && store.rows[key];
    return r ? r.label : null;
  }

  // Resolve one output's destination. ctx = { productId, productName, docId, docCode, variant }.
  // Returns everything a row needs to STATE where it will write and everything the run needs to
  // actually write there -- one call, so the promise on the row and the file that lands agree.
  function resolve(store, ctx) {
    ctx = ctx || {};
    var key = pathKey(ctx.docId, ctx.variant);
    var over = rowLabel(store, key);
    if (over != null) {
      return { key: key, kind: "row", label: over, segments: [], chip: over + "/",
               handleKey: rowHandleKey(key), inherited: false,
               hint: "Publishes to the folder chosen for this output." };
    }
    // uio-P-M02: a row pointed at a NAMED destination goes there, nested the same tidy way an
    // inherited root nests -- one destination can hold many documents without them colliding.
    var namedId = rowDestinationId(store, key);
    var named = namedId ? destination(store, namedId) : null;
    if (named) {
      var nsegs = folderSegments(ctx.productName, ctx.docCode, ctx.variant);
      return { key: key, kind: "named", label: named.label, name: named.name, destId: named.id, segments: nsegs,
               chip: named.name, handleKey: destHandleKey(named.id), inherited: false,
               hint: "Publishes to the “" + named.name + "” destination, nested by document and variant." };
    }
    var root = ctx.productId != null ? rootLabel(store, ctx.productId) : null;
    if (root != null) {
      var segs = folderSegments(ctx.productName, ctx.docCode, ctx.variant);
      return { key: key, kind: "root", label: root, segments: segs,
               chip: [root].concat(segs).join("/") + "/",
               handleKey: rootHandleKey(ctx.productId), inherited: true,
               hint: "Inherits the Product publish folder, nested by document and variant." };
    }
    return { key: key, kind: "download", label: DOWNLOAD_LABEL, segments: [], chip: DOWNLOAD_LABEL,
             handleKey: null, inherited: false,
             hint: "No folder set, so this output downloads to your browser's downloads folder." };
  }

  // ---- the version ledger (per output, so a variant versions independently of its flagship) ----
  function lastVersion(store, key) {
    var v = store && store.versions && store.versions[key];
    return v == null ? null : String(v);
  }
  function recordVersion(store, key, version) {
    if (!store || !key || version == null || String(version) === "") return store;
    store.versions = store.versions || {};
    store.versions[key] = String(version);
    return store;
  }
  // What this output will be called next. `suggest` is the exporter's OWN suggestVersion, injected
  // rather than reimplemented, so the increment rule has one home. `replace: true` is the deliberate
  // re-cut -- it reuses the last version and therefore overwrites in place. Nothing published yet
  // starts at V001 either way.
  function nextVersion(store, key, opts) {
    opts = opts || {};
    var last = lastVersion(store, key);
    if (opts.replace && last) return last;
    if (typeof opts.suggest === "function") { try { return String(opts.suggest(last) || "V001"); } catch (e) { return last || "V001"; } }
    return last || "V001";
  }

  // Persisted form. Handles are NOT here (they live in IndexedDB under handleKey) -- only labels,
  // which are what the UI states. A malformed blob starts empty rather than stranding the stage.
  function toJSON(store) {
    return { version: (store && store.version) || 1, roots: clone((store && store.roots) || {}),
             rows: clone((store && store.rows) || {}), versions: clone((store && store.versions) || {}),
             dests: clone((store && store.dests) || {}), rowDest: clone((store && store.rowDest) || {}) };
  }
  function fromJSON(obj) {
    var s = create();
    if (!obj || typeof obj !== "object") return s;
    s.version = obj.version || 1;
    s.roots = labelMap(obj.roots);
    s.rows = labelMap(obj.rows);
    var vs = (obj.versions && typeof obj.versions === "object") ? obj.versions : {};
    Object.keys(vs).forEach(function (k) { if (vs[k] != null) s.versions[k] = String(vs[k]); });
    // uio-P-M02: named destinations + which output points at which. A destination with no name is
    // dropped rather than kept as an unnameable row in the picker.
    var ds = (obj.dests && typeof obj.dests === "object") ? obj.dests : {};
    Object.keys(ds).forEach(function (k) {
      var d = ds[k]; if (!d || typeof d !== "object") return;
      var nm = String(d.name == null ? "" : d.name); if (!nm) return;
      s.dests[k] = { name: nm, label: String(d.label == null ? "" : d.label) };
    });
    var rd = (obj.rowDest && typeof obj.rowDest === "object") ? obj.rowDest : {};
    // A pointer at a destination that did not survive the load is dropped, for the same reason
    // removeDestination un-points rows: a dangling name would publish somewhere nobody chose.
    Object.keys(rd).forEach(function (k) { if (rd[k] != null && s.dests[String(rd[k])]) s.rowDest[k] = String(rd[k]); });
    return s;
  }
  function labelMap(src) {
    var out = {};
    if (!src || typeof src !== "object") return out;
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === "object" && v.label != null) out[k] = { label: String(v.label) };
    });
    return out;
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  var api = {
    create: create, pathKey: pathKey, rootHandleKey: rootHandleKey, rowHandleKey: rowHandleKey,
    folderSafe: folderSafe, folderSegments: folderSegments,
    setRoot: setRoot, clearRoot: clearRoot, rootLabel: rootLabel,
    setRowPath: setRowPath, clearRowPath: clearRowPath, rowLabel: rowLabel,
    // uio-P-M02: named destinations
    destHandleKey: destHandleKey, setDestination: setDestination, removeDestination: removeDestination,
    destination: destination, destinations: destinations,
    setRowDestination: setRowDestination, rowDestinationId: rowDestinationId,
    resolve: resolve, lastVersion: lastVersion, recordVersion: recordVersion, nextVersion: nextVersion,
    toJSON: toJSON, fromJSON: fromJSON, DOWNLOAD_LABEL: DOWNLOAD_LABEL
  };
  var PublishPaths = {};
  for (var k in api) if (api.hasOwnProperty(k)) PublishPaths[k] = api[k];
  PublishPaths._pure = api;

  if (typeof window !== "undefined") window.PublishPaths = PublishPaths;
  if (typeof module !== "undefined" && module.exports) module.exports = PublishPaths;
})();
