// publish-presets.js -- app-global output presets for the Publish stage (Product Rail Epic 6, T2).
//
// A PRESET is a named, reusable bundle of export-option overrides (applied on top of the exporter's
// defaultOptions at publish time): format + SCORM options + variant scope. Three built-ins ship;
// authors save/rename/delete their own; each document remembers the preset it last used so it can
// fast-track (T4). This module is the pure STATE + resolution only -- no DOM, no export.js coupling
// (it stores option OVERRIDES; the editor merges them onto SCORMExport.defaultOptions() at run time),
// so it is headlessly testable and round-trips through toJSON/fromJSON.
//
// window.PublishPresets.*        -> the store + resolution
// window.PublishPresets._pure.*  -> same, for the headless guard in tests/run.js
(function () {
  "use strict";

  // The built-ins are option OVERRIDES onto defaultOptions() (real SCORM params: reviewFile,
  // learnerTheme, optimiseMedia, maxImageDim, imageQuality...). Master = defaults (no override).
  var BUILTINS = [
    { id: "master", name: "Master", builtin: true, options: {} },
    { id: "review", name: "Review copy", builtin: true, options: { reviewFile: true, learnerTheme: false } },
    { id: "lightweight", name: "Lightweight", builtin: true, options: { optimiseMedia: true, maxImageDim: 1200, imageQuality: 0.7 } }
  ];
  function builtins() { return clone(BUILTINS); }
  function isBuiltin(id) { for (var i = 0; i < BUILTINS.length; i++) if (BUILTINS[i].id === id) return true; return false; }

  function create() { return { version: 1, _seq: 0, custom: [], lastByDoc: {} }; }
  function nextId(store) { store._seq = (store._seq || 0) + 1; return "preset-" + store._seq; }

  // Built-ins first, then the author's custom presets in creation order.
  function allPresets(store) { return builtins().concat(clone((store && store.custom) || [])); }
  function presetById(store, id) {
    var all = allPresets(store);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return all[0]; // unknown id -> Master (never strands a row without a resolvable preset)
  }
  // The option-override object a preset applies. Always a fresh object; unknown id -> {} (Master).
  function optionsFor(store, id) { var p = presetById(store, id); return clone((p && p.options) || {}); }
  function presetName(store, id) { var p = presetById(store, id); return (p && p.name) || "Master"; }

  // Save a NEW custom preset from an options-override bundle. Returns the new preset. Names are not
  // forced unique (built-ins are reserved by id, not name); a blank name falls back to "Preset N".
  function saveCustom(store, name, options) {
    if (!store) return null;
    store.custom = store.custom || [];
    var id = nextId(store);
    var preset = { id: id, name: (name != null && String(name).trim()) ? String(name).trim() : ("Preset " + store._seq), builtin: false, options: clone(options || {}) };
    store.custom.push(preset);
    return preset;
  }
  function renameCustom(store, id, name) {
    if (isBuiltin(id)) return null; // built-ins are fixed
    var c = customById(store, id); if (!c) return null;
    if (name != null && String(name).trim()) c.name = String(name).trim();
    return c;
  }
  // Delete a custom preset; every document that pointed at it falls back to Master on next resolve.
  function deleteCustom(store, id) {
    if (!store || isBuiltin(id)) return store;
    store.custom = (store.custom || []).filter(function (p) { return p.id !== id; });
    Object.keys(store.lastByDoc || {}).forEach(function (docId) { if (store.lastByDoc[docId] === id) delete store.lastByDoc[docId]; });
    return store;
  }
  function customById(store, id) {
    var cs = (store && store.custom) || [];
    for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
    return null;
  }

  // A document's last-used preset (so it re-queues with zero config -- T4). Defaults to Master.
  function setLastForDoc(store, docId, presetId) {
    if (!store || docId == null) return store;
    store.lastByDoc = store.lastByDoc || {};
    store.lastByDoc[docId] = presetId;
    return store;
  }
  function lastForDoc(store, docId) {
    var id = store && store.lastByDoc && store.lastByDoc[docId];
    return (id && presetById(store, id).id === id) ? id : "master"; // a deleted preset -> Master
  }

  function toJSON(store) {
    return { version: (store && store.version) || 1, _seq: (store && store._seq) || 0, custom: clone((store && store.custom) || []), lastByDoc: clone((store && store.lastByDoc) || {}) };
  }
  function fromJSON(obj) {
    var s = create();
    if (!obj || typeof obj !== "object") return s;
    s.version = obj.version || 1;
    s._seq = obj._seq || 0;
    s.custom = (Array.isArray(obj.custom) ? obj.custom : []).filter(function (p) { return p && p.id && !isBuiltin(p.id); })
      .map(function (p) { return { id: p.id, name: p.name != null ? String(p.name) : "Preset", builtin: false, options: (p.options && typeof p.options === "object") ? clone(p.options) : {} }; });
    s.lastByDoc = (obj.lastByDoc && typeof obj.lastByDoc === "object") ? clone(obj.lastByDoc) : {};
    return s;
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  var api = {
    builtins: builtins, isBuiltin: isBuiltin, create: create, allPresets: allPresets, presetById: presetById,
    optionsFor: optionsFor, presetName: presetName, saveCustom: saveCustom, renameCustom: renameCustom,
    deleteCustom: deleteCustom, setLastForDoc: setLastForDoc, lastForDoc: lastForDoc, toJSON: toJSON, fromJSON: fromJSON
  };
  var PublishPresets = {};
  for (var k in api) if (api.hasOwnProperty(k)) PublishPresets[k] = api[k];
  PublishPresets._pure = api;

  if (typeof window !== "undefined") window.PublishPresets = PublishPresets;
  if (typeof module !== "undefined" && module.exports) module.exports = PublishPresets;
})();
