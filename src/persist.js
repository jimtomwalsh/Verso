/*
 * persist.js — Backlog E: save / load the whole course
 * document. Talks to the editor ONLY via window.Editor (getDoc / setDoc).
 *
 *   - Save: JSON.stringify(window.Editor.getDoc()) -> download a .json file.
 *   - Load: pick a .json file -> window.Editor.setDoc(parsed) (rebuilds canvas).
 *   - Autosave: every few seconds the live doc is flushed to the document
 *     registry via window.Editor.saveActiveDoc(), which persists it and IS
 *     auto-restored on boot (editor.js: doc = registry[activeDocId]). The
 *     durable write + its save-state indicator live behind that seam, so a
 *     failed write (e.g. quota) is surfaced, never swallowed (XX).
 *
 * Do NOT edit editor.js / render.js / index.html.
 */
(function () {
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  var AUTOSAVE_MS = 4000;

  // --- shared toolbar button styling (injected once by whichever pipeline
  //     module loads first — persist.js/csv.js/export.js all call this) --------
  window.__pipelineEnsureStyle = window.__pipelineEnsureStyle || function () {
    if (document.getElementById("pipeline-btn-style")) return;
    var s = document.createElement("style");
    s.id = "pipeline-btn-style";
    s.textContent =
      ".pipeline-btn{font:inherit;font-size:12px;font-weight:500;line-height:1;color:#e6e6e6;" +
      "background:#2c2c2c;border:1px solid #3a3a3a;border-radius:6px;padding:6px 10px;cursor:pointer;}" +
      ".pipeline-btn:hover{background:#383838;}" +
      ".pipeline-btn--accent{background:#0d99ff;border-color:#0d99ff;color:#fff;}" +
      ".pipeline-btn--accent:hover{background:#2aa5ff;}" +
      ".pipeline-btn:disabled{opacity:.5;cursor:default;}";
    document.head.appendChild(s);
  };
  window.__pipelineButton = window.__pipelineButton || function (label, onClick, accent) {
    window.__pipelineEnsureStyle();
    var b = document.createElement("button");
    b.className = "pipeline-btn" + (accent ? " pipeline-btn--accent" : "");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  function ts() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function save() {
    var doc = window.Editor.getDoc();
    var json = JSON.stringify(doc, null, 2);
    var code = (doc.meta && doc.meta.code) || "course";
    downloadBlob(new Blob([json], { type: "application/json" }), code + "_" + ts() + ".json");
  }

  // CCC: does a parsed JSON blob look like a real course document? Returns null
  // if OK, else a human reason. Kept strict-but-shallow so a genuine course
  // always passes but garbage/other-JSON is rejected BEFORE it overwrites work.
  function validateImportedDoc(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return "not a course object";
    if (!Array.isArray(d.pages)) return "`pages` is missing or not a list";
    if (!d.pages.length) return "the course has no pages";
    for (var i = 0; i < d.pages.length; i++) {
      var p = d.pages[i];
      if (!p || typeof p !== "object") return "page " + (i + 1) + " is not an object";
      if (p.blocks != null && !Array.isArray(p.blocks)) return "page " + (i + 1) + " has a malformed `blocks` list";
    }
    return null;
  }
  window.__validateImportedDoc = validateImportedDoc; // headless test hook

  function load() {
    var input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onerror = function () { alert("Could not read that file."); };
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(reader.result); }
        catch (e) { alert("Could not read that file — not valid JSON.\n\n" + e.message + "\n\nYour current work was NOT changed."); return; }
        // CCC: validate the SHAPE before committing, so a malformed import can
        // never overwrite the good doc in memory (setDoc is destructive).
        var err = validateImportedDoc(parsed);
        if (err) { alert("That file does not look like a valid course document (" + err + ").\n\nYour current work was NOT changed."); return; }
        try { window.Editor.setDoc(parsed); }
        catch (e) {
          alert("Could not load that course: " + (e && e.message || e) + "\n\nYour current work was NOT changed.");
          if (window.console && console.error) console.error("[load] setDoc failed", e);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // --- asset blob store (YY / SPEC-production-hardening §4) ------------------
  // Media moves OUT of the doc into an id-keyed store; the doc carries lean
  // "asset:<id>" refs. Ids are a content hash of the data URL, so identical
  // uploads (the many identical menu SVGs) dedupe to one record. Metadata lives
  // here, NOT in the doc ref.
  //
  // NOTE (deviation from the frozen §4 signature, flagged for James): the seam
  // is SYNC and dataURL-based (putAsset(dataUrl, meta) -> id) rather than the
  // async blob signature, because a sync seam keeps boot / migration / mount
  // sync (no async refactor of the boot path in this large slice).
  var PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'>" +
    "<rect width='120' height='80' fill='#cccccc'/>" +
    "<text x='60' y='44' font-size='10' text-anchor='middle' fill='#666666'>missing asset</text></svg>");

  var assets = {};       // id -> { data, mime, name, w, h }
  var objectUrls = {};   // id -> objectURL (raster/video only; SVG uses data:)

  // Fast, sync content hash (cyrb53) — dedupe key, not cryptographic.
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  function mimeOf(dataUrl) { var m = /^data:([^;,]+)/.exec(dataUrl); return m ? m[1] : ""; }
  function dataURLtoBlob(dataUrl) {
    var comma = dataUrl.indexOf(","), meta = dataUrl.slice(0, comma), body = dataUrl.slice(comma + 1);
    var mime = mimeOf(dataUrl) || "application/octet-stream";
    if (/;base64/i.test(meta)) {
      var bin = atob(body), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  }

  // ---- backend: IndexedDB (no ~5MB cap) + sync in-memory cache (ZZ / YYY) ---
  // localStorage is capped at ~5MB/origin, so one base64 image tipped the whole
  // store over and then EVERY write failed silently -> lost work (YYY). Move the
  // blobs to IndexedDB (GB-scale). The in-memory `assets` map stays the SYNC
  // source of truth (render/upload read it synchronously); IndexedDB is the async
  // durable backer, written per-record (not one giant key).
  //
  // ONE MEDIA STORE, ONE FAILURE SURFACE (platform-pivot 07). There used to be a
  // second one underneath: with IndexedDB unavailable, the whole asset map was
  // written back as a single base64 localStorage blob. That is the per-origin
  // blob path the pivot retires, and it bought little -- it shared the same ~5MB
  // cap as the registry it was trying to relieve, and failed on its own instead
  // of through the registry's quota reporting. Without IndexedDB, putAsset now
  // declines: migrateDocMedia leaves the field as its inline data: URL (it is
  // documented non-destructive), the media still renders, and durability becomes
  // the registry write's problem -- which already classifies quota and drives the
  // save-state indicator. The old key is drained once by Migration, not read here.
  // GH #331: the asset database follows the SAME environment rule the storage keys do, read from
  // VersoStorage (loaded first) so there is one rule and not two that can disagree. This is the
  // half that matters most: namespacing the registry while sharing the blobs would let a sweep in
  // staging -- which walks its own registry and deletes everything not referenced by it -- delete
  // every image production owns. A local fallback keeps this file loadable on its own; under
  // `require` there is no shared window, which is the footgun dnd.js documents.
  var IDB_ENV = (function () {
    try {
      var VS = (typeof window !== "undefined") && window.VersoStorage;
      if (VS && typeof VS.environment === "function") return VS.environment();
    } catch (e) {}
    return "";
  })();
  var IDB_NAME = IDB_ENV ? ("authoring-" + IDB_ENV.replace(/\.$/, "")) : "authoring", IDB_STORE = "assets";
  var idb = null, idbReady = false;

  function openDB(cb) {
    var done = false; function finish() { if (done) return; done = true; cb && cb(); }
    try {
      if (!window.indexedDB) return finish();
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { try { req.result.createObjectStore(IDB_STORE); } catch (e) {} };
      req.onsuccess = function () { idb = req.result; idbReady = true; finish(); };
      req.onerror = function () { finish(); };
      req.onblocked = function () { finish(); };
    } catch (e) { finish(); }
  }
  function idbPut(id, rec) {
    if (!idb) return;
    try {
      var tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(rec, id);
      tx.onerror = function () {
        if (window.Editor && window.Editor.reportSaveFailure) window.Editor.reportSaveFailure("A media file could not be saved to storage. Export JSON now to avoid losing work.");
      };
    } catch (e) {}
  }
  function idbDelete(id) {
    if (!idb) return;
    try { idb.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).delete(id); } catch (e) {}
  }
  // Async: open IDB, load every stored record into the sync map, then hand the
  // retired localStorage asset key to Migration to drain once. Calls done() when
  // the map is ready so the editor can re-mount + resolve media.
  function hydrateAssets(done) {
    openDB(function () {
      function loadIDB(next) {
        if (!idb) return next();
        try {
          var req = idb.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).openCursor();
          req.onsuccess = function () { var c = req.result; if (c) { assets[c.key] = c.value; c.continue(); } else next(); };
          req.onerror = function () { next(); };
        } catch (e) { next(); }
      }
      // The one-way drain of the pre-platform-pivot-07 blob. Only runs where there is
      // somewhere to drain TO: with no IndexedDB the old key is still the only copy of
      // that media, so it is left alone rather than deleted out from under the author.
      function drainLegacy(next) {
        if (!idbReady || !window.Migration || !window.Migration.drainLegacyAssetBlob) return next();
        var KEY = window.Migration.LEGACY_ASSET_KEY;
        window.Migration.drainLegacyAssetBlob({
          read: function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
          remove: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
          has: function (id) { return !!assets[id]; },
          put: function (id, rec) { assets[id] = rec; idbPut(id, rec); }
        });
        next();
      }
      loadIDB(function () { drainLegacy(function () { done && done(); }); });
    });
  }

  function putAsset(dataUrl, meta) {
    if (typeof dataUrl !== "string" || dataUrl.slice(0, 5) !== "data:") return null;
    var id = cyrb53(dataUrl);
    if (!assets[id]) {
      // No IndexedDB means no durable media store. Decline rather than accept a ref
      // this store cannot honour after a reload -- the caller keeps the inline data:
      // URL, which the registry write persists and reports on.
      if (!idbReady) return null;
      var rec = { data: dataUrl, mime: (meta && meta.mime) || mimeOf(dataUrl), name: (meta && meta.name) || null, w: null, h: null };
      assets[id] = rec;
      idbPut(id, rec);                                            // async durable write, no cap
    }
    return id;
  }
  function assetUrl(id) {
    var rec = assets[id];
    if (!rec) return PLACEHOLDER;
    // Keep SVG as a data: URL so render.js's inline + palette-recolour path
    // (which tests for data:image/svg+xml) still fires; raster/video -> objectURL.
    // HTML interactions (htmlEmbed.html) are ALSO kept as a decodable data: URL so
    // render.js's resolveEmbedHtml() can recover the raw markup for the srcdoc iframe
    // (an objectURL is opaque and could not be decoded back to source).
    if (/svg|text\/html/i.test(rec.mime)) return rec.data;
    if (!objectUrls[id]) {
      try { objectUrls[id] = URL.createObjectURL(dataURLtoBlob(rec.data)); }
      catch (e) { return rec.data; }
    }
    return objectUrls[id];
  }
  function getAsset(id) {
    var r = assets[id];
    return r ? { dataUrl: r.data, mime: r.mime, name: r.name, w: r.w, h: r.h } : null;
  }
  // Mark-sweep: delete every stored asset NOT in refIds. Caller MUST pass the
  // union of refs across ALL open docs (the store is shared by the registry).
  function sweepAssets(refIds) {
    var keep = {}; (refIds || []).forEach(function (id) { keep[id] = true; });
    Object.keys(assets).forEach(function (id) {
      if (keep[id]) return;
      delete assets[id];
      idbDelete(id);   // per-record; there is no whole-map write left to follow it
      if (objectUrls[id]) { try { URL.revokeObjectURL(objectUrls[id]); } catch (e) {} delete objectUrls[id]; }
    });
  }

  // Store methods are SYNC (they read/write the in-memory map); hydrateAssets()
  // runs async at the end of this module and re-mounts once the map is loaded.
  window.AssetStore = {
    put: putAsset, url: assetUrl, get: getAsset, sweep: sweepAssets,
    has: function (id) { return !!assets[id]; }, placeholder: PLACEHOLDER,
    // The boot block below calls this; it is published so the suite can drive the REAL
    // hydrate -> drain -> put path against a fake IndexedDB rather than assert on source text.
    hydrate: hydrateAssets,
    idbReady: function () { return idbReady; }
  };

  // GGG: storage-environment advisory. IndexedDB + localStorage are per-ORIGIN, so
  // each way of opening the tool (a browser at http://localhost:8123, the Verso
  // app, or a raw file:// path) is a SEPARATE storage box -- work saved in one does
  // not appear in another (the documented Verso-vs-browser footgun). Worse, under
  // file:// IndexedDB is commonly disabled/partitioned, silently dropping the app
  // back to the ~5MB localStorage cap = data-loss on the first video/large image.
  // Returns a { level, msg } advisory or null. Pure (env injected) so it is
  // headless-testable; storageAdvisory() reads the live environment.
  function storageAdvisory(env) {
    env = env || {};
    if (env.protocol === "file:") {
      return { level: "warn", msg: "Opened from a file:// path. Storage here is unreliable and is a SEPARATE box from the served app, so your work may not save or may not match what you see elsewhere. Run ./serve.command and use http://localhost:8123 (or the Verso app) so saves are durable and stay in one place." };
    }
    if (!env.hasIndexedDB) {
      return { level: "warn", msg: "Large-media storage (IndexedDB) is unavailable here, so saving falls back to a ~5MB limit -- large images or video may fail to save. Use the served app at http://localhost:8123 in a modern browser, or the Verso app." };
    }
    return null;
  }
  window.__storageAdvisory = storageAdvisory; // test seam
  window.storageAdvisory = function () {
    var loc = (typeof location !== "undefined") ? location : {};
    return storageAdvisory({ protocol: loc.protocol || "", hasIndexedDB: (typeof window !== "undefined" && !!window.indexedDB) });
  };

  // --- autosave (registry sync) ---------------------------------------------
  var lastSaved = "";
  function autosave() {
    var d, json;
    // Reading + serialising the doc can throw (e.g. a circular ref); do NOT
    // swallow it silently — surface it in the shared save-state indicator (XX).
    try {
      d = window.Editor.getDoc();
      json = JSON.stringify(d);
    } catch (e) {
      if (window.Editor.reportSaveFailure) {
        window.Editor.reportSaveFailure("Autosave failed to read the document (" +
          (e && e.message || e) + "). Export JSON now to avoid losing work.");
      }
      if (window.console && console.error) console.error("[autosave] serialise failed:", e);
      return;
    }
    if (json === lastSaved) return;
    lastSaved = json;
    // saveActiveDoc() does the durable write and drives the save-state indicator.
    window.Editor.saveActiveDoc(d);
  }
  // Reset used to clear the three doc-of-record keys out of localStorage by hand. That was
  // the last call site bypassing the storage seam, and on the "file" or "http" backend it
  // reset nothing at all: the registry lives on disk or on the server, so the reload put
  // every course straight back and the author was told their workspace had been cleared.
  // The editor owns it now, and it goes through the same StorageBackend every other write
  // does, so it means the same thing in all three postures (platform-pivot 07).
  function resetWorkspace() {
    if (!confirm("Are you sure you want to reset the workspace?\nThis will clear all course tabs and restore the default sample.")) return;
    var res = window.Editor && window.Editor.resetWorkspace ? window.Editor.resetWorkspace() : { ok: false, error: "unavailable" };
    if (!res || !res.ok) {
      alert("The workspace could not be reset" + (res && res.error ? " (" + res.error + ")" : "") + ".\nNothing was changed.");
      return;
    }
    location.reload();
  }

  // --- boot: pipeline buttons, the autosave poll, asset hydration --------------
  // All of this needs a live editor and a real browser, so it is skipped when the file is
  // loaded on its own (arch-P2's node test seam) -- otherwise the autosave interval would
  // keep a bare `require` alive forever. The pure persistence logic above is unaffected.
  if (window.Editor && window.Editor.registerPipelineButton) {
    window.Editor.registerPipelineButton("Export JSON", save);
    window.Editor.registerPipelineButton("Reset Workspace", resetWorkspace);

    // Power (#179): the 4s autosave poll fires forever, even when the window is occluded /
    // minimised -- a constant CPU wake that helps defeat macOS App Nap. Expose a governor so
    // the editor's visibilitychange handler can PAUSE it while hidden (flushing first, so a
    // hidden-then-killed app never loses the latest edit) and RESUME on return.
    var _autosaveTimer = setInterval(autosave, AUTOSAVE_MS);
    window.__autosaveGov = {
      pause: function () { if (_autosaveTimer) { autosave(); clearInterval(_autosaveTimer); _autosaveTimer = 0; } },
      resume: function () { if (!_autosaveTimer) _autosaveTimer = setInterval(autosave, AUTOSAVE_MS); },
      running: function () { return !!_autosaveTimer; }
    };
    window.addEventListener("beforeunload", autosave);

    // Hydrate the asset store from IndexedDB (async), THEN hoist any legacy inline
    // base64 media in the registry into it and re-mount so media resolves. Done in
    // the callback because IndexedDB open/load is async -- migrating/mounting before
    // the map is populated would render assets blank.
    hydrateAssets(function () {
      if (window.Editor.migrateAssets) window.Editor.migrateAssets();
    });
    // Mark-sweep orphaned blobs on the way out (union of all open docs' refs).
    window.addEventListener("beforeunload", function () {
      if (window.Editor.sweepAssets) window.Editor.sweepAssets();
    });
  }

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
