/*
 * src/store-native.js -- native-file adapter for the 'file' storage backend (#68, phase-1a
 * of the local-first re-home). Loaded BEFORE editor.js so the storage seam (pickStorageAdapter)
 * can select it at editor's synchronous boot read.
 *
 * The registry (all docs; media stays as asset:<id> refs) persists to a real file on disk
 * via the Swift versoBackup bridge -- NO localStorage ~5MB cap (the ADR-0001 data-loss root).
 * The shared component library (#18) gets the identical treatment as a SEPARATE file
 * (library.json), so a course-only .verso restore never touches it. The shell injects each
 * on-disk file at document-start (window.__versoDiskRegistryB64 / __versoDiskLibraryB64), so
 * readRegistry()/readLibrary() are synchronous. The write* methods update the in-page cache
 * synchronously and post the durable disk write asynchronously, but now CONFIRM the write via
 * the bridge reply (window.__versoBackupReply) -- a failed disk write surfaces through the
 * shared save-state (Editor.reportSaveFailure) instead of being lost fire-and-forget.
 *
 * PHASE-1a BOUNDARY: only the registry + library move to disk here; media assets stay in the
 * uncapped IndexedDB AssetStore. Asset-on-disk + the guarded backup-file writes used by the
 * #69/#18 cutovers (store/backups/pre-cutover-<ts>/) are phase-1b/Swift follow-ups (async
 * bridge ops).
 *
 * Inert unless the native bridge is present; and even then pickStorageAdapter only USES this
 * when authoring.storageBackend == 'file', so under the default 'browser' backend nothing changes.
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
  function bridge() { return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.versoBackup) || null; }
  if (!bridge()) return; // plain browser (no Verso shell) -> no native adapter, browser backend only

  var dec = new TextDecoder(), enc = new TextEncoder();
  function b64ToText(b64) {
    if (!b64) return null;
    try { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return dec.decode(a) || null; }
    catch (e) { return null; }
  }
  function textToB64(text) { return bytesToB64(enc.encode(text)); }
  function bytesToB64(bytes) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  // ---- Bridge reply routing (write-confirmation) ---------------------------
  // The Swift shell replies to every op via window.__versoBackupReply(reqId, obj).
  // Other bridge callers (project-backup) may already own that global, so CHAIN it
  // rather than clobber: our reqIds are namespaced "storeReg:<n>" and we forward
  // anything else to the previous handler. Each pending write registers a callback.
  var pending = {}, seq = 0;
  var prevReply = window.__versoBackupReply;
  window.__versoBackupReply = function (reqId, obj) {
    if (reqId && pending[reqId]) { var cb = pending[reqId]; delete pending[reqId]; try { cb(obj || {}); } catch (e) {} return; }
    if (typeof prevReply === "function") return prevReply(reqId, obj);
  };

  // Seed the in-page cache from the shell's document-start injection (the on-disk registry).
  var cache = b64ToText(window.__versoDiskRegistryB64);
  // #18: same seeding for the shared component library, a SEPARATE on-disk file
  // (store/library.json) injected as window.__versoDiskLibraryB64.
  var libCache = b64ToText(window.__versoDiskLibraryB64);
  // Product Rail #1: same seeding again for ProductsStore, a THIRD on-disk file
  // (store/products.json) injected as window.__versoDiskProductsB64.
  var productsCache = b64ToText(window.__versoDiskProductsB64);

  window.__storageAdapter = {
    name: "file",
    readRegistry: function () { return cache; },   // synchronous (the seam's contract)
    writeRegistry: function (json) {
      cache = json;                                // in-page truth updates synchronously
      var br = bridge(); if (!br) return { ok: false, quota: false, error: new Error("no bridge") };
      var reqId = "storeReg:" + (++seq);
      // Confirm the durable write: on a disk failure, surface it through the shared
      // save-state so it is NOT lost fire-and-forget (the handoff's open weakness).
      pending[reqId] = function (res) {
        if (res && res.ok) return; // durable write confirmed
        var msg = "The registry could not be saved to disk" + (res && res.error ? " (" + res.error + ")" : "") +
          ". Your latest changes are NOT durably saved -- export a .verso now to avoid losing work.";
        if (window.Editor && window.Editor.reportSaveFailure) window.Editor.reportSaveFailure(msg);
        else if (window.console && console.error) console.error("[store-native] " + msg);
      };
      try { br.postMessage({ op: "storePutRegistry", reqId: reqId, text: json }); } // durable, async + confirmed
      catch (e) { delete pending[reqId]; return { ok: false, quota: false, error: e }; }
      return { ok: true }; // the synchronous cache write succeeded; disk write is confirmed via the reply
    },
    // #18: same read/write/confirm shape as the registry above, targeting library.json.
    readLibrary: function () { return libCache; },
    writeLibrary: function (json) {
      libCache = json;
      var br = bridge(); if (!br) return { ok: false, quota: false, error: new Error("no bridge") };
      var reqId = "storeLib:" + (++seq);
      pending[reqId] = function (res) {
        if (res && res.ok) return;
        var msg = "The shared component library could not be saved to disk" + (res && res.error ? " (" + res.error + ")" : "") +
          ". Your latest library changes are NOT durably saved.";
        if (window.Editor && window.Editor.reportSaveFailure) window.Editor.reportSaveFailure(msg);
        else if (window.console && console.error) console.error("[store-native] " + msg);
      };
      try { br.postMessage({ op: "storePutLibrary", reqId: reqId, text: json }); }
      catch (e) { delete pending[reqId]; return { ok: false, quota: false, error: e }; }
      return { ok: true };
    },
    // Product Rail #1: same read/write/confirm shape again, targeting products.json.
    readProducts: function () { return productsCache; },
    writeProducts: function (json) {
      productsCache = json;
      var br = bridge(); if (!br) return { ok: false, quota: false, error: new Error("no bridge") };
      var reqId = "storeProd:" + (++seq);
      pending[reqId] = function (res) {
        if (res && res.ok) return;
        var msg = "The Products store could not be saved to disk" + (res && res.error ? " (" + res.error + ")" : "") +
          ". Your latest Product changes are NOT durably saved.";
        if (window.Editor && window.Editor.reportSaveFailure) window.Editor.reportSaveFailure(msg);
        else if (window.console && console.error) console.error("[store-native] " + msg);
      };
      try { br.postMessage({ op: "storePutProducts", reqId: reqId, text: json }); }
      catch (e) { delete pending[reqId]; return { ok: false, quota: false, error: e }; }
      return { ok: true };
    }
  };
  window.__storeNativeTextCodec = { toB64: textToB64, fromB64: b64ToText }; // test seam

  // ---- Async native-store glue for the #69 guarded cutover ------------------
  // Promise wrapper over the bridge reply plumbing above. These back
  // Editor.migrateToFileBackend's live deps (window.__nativeStore). Each op posts with
  // a namespaced reqId and resolves on window.__versoBackupReply. Swift ops required
  // (extend handleBackup): storePutRegistry, storeGetRegistry, storePutBackupB64
  // (base64 -> store/<path>, atomic, mkdir -p), storeFileSize, storeReload.
  function request(op, extra) {
    return new Promise(function (resolve) {
      var br = bridge(); if (!br) { resolve({ ok: false, error: "no bridge" }); return; }
      var reqId = "ns:" + (++seq);
      pending[reqId] = function (res) { resolve(res || {}); };
      var msg = { op: op, reqId: reqId };
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) msg[k] = extra[k];
      try { br.postMessage(msg); } catch (e) { delete pending[reqId]; resolve({ ok: false, error: (e && e.message) || String(e) }); }
    });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  window.__nativeStore = {
    // durable registry write (awaited confirmation) — the migration's step 3.
    putRegistry: function (json) { return request("storePutRegistry", { text: json }); },
    // read the registry back FROM DISK (not the in-page cache) — the migration's verify.
    getRegistry: function () { return request("storeGetRegistry").then(function (r) { return r && r.ok ? (r.text != null ? r.text : null) : null; }); },
    // #18: same durable-write + read-back-from-disk pair, for the shared component library.
    putLibrary: function (json) { return request("storePutLibrary", { text: json }); },
    getLibrary: function () { return request("storeGetLibrary").then(function (r) { return r && r.ok ? (r.text != null ? r.text : null) : null; }); },
    // write one backup artifact (bytes) under store/<path>; returns { ok, size }.
    writeFile: function (path, bytes) { return request("storePutBackupB64", { path: path, b64: bytesToB64(bytes) }); },
    // on-disk size of store/<path> (0 if absent) — the backup "verified written" gate.
    verifySize: function (path) { return request("storeFileSize", { path: path }).then(function (r) { return r && r.ok ? (r.size || 0) : 0; }); },
    // controlled reload under the migrated store (refreshes the document-start injection).
    reload: function () { var p = request("storeReload"); return p; },
    // filesystem-safe run label for the backups/pre-cutover-<ts>/ directory.
    tsLabel: function () { var d = new Date(); return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
