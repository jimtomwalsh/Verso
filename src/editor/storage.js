// editor/storage.js -- every durable read and write the editor makes (arch-P3-01).
//
// The seam was already named. `editor.js:168` read "storage seam (#66) -- the doc-registry Store
// behind a swappable adapter", and it was right: the adapter swap, the three-facet StorageBackend,
// the durable-write core and the quota classifier were all deliberate, all correct, and all at
// line 168 of a 27,000-line closure. Nothing could call in. No test could cross it. The suite
// reached them by string-slicing the source back into life through three separate fences.
//
// This module is that seam given a door. It owns:
//
//   1. THE KEYS. Six of them, in one place, so "what does this app persist" is a list.
//   2. THE DURABLE-WRITE CORE. writeStore never swallows: a failed setItem comes back as
//      { ok:false, quota } so the caller can tell "disk is full" from "something else broke".
//      Silently swallowing a QuotaExceededError is the #1 data-loss landmine (XX) -- the write
//      fails, the stale registry is faithfully restored next boot, and the author's day is gone.
//   3. THE ADAPTER SWAP (#66/#68/#18). At the "browser" default every facet is exactly today's
//      localStorage. Flip the flag and an injected window.__storageAdapter (store-native.js's
//      file store, store-http.js's server-of-one) takes over -- per facet, see below.
//   4. THE STORAGE BACKEND (platform-pivot 01). Registry + doc-session keys + media behind one
//      interface, so a server posture can replace all three at once.
//
// FACET-AWARE SELECTION, and the bug it fixes. The old selector was all-or-nothing: flag flipped
// plus an adapter present meant that adapter served the registry, the library AND the products
// store. store-http.js implements the registry facet only. On the "http" backend every library
// read therefore called an undefined readLibrary, threw into a catch, and returned the seeded
// demo library -- and every save threw into a catch and vanished. A silent, total loss of the
// shared component library, with a green suite. pickFacetAdapter now asks the injected adapter
// whether it implements the facet being read, and falls back to the browser store when it does
// not. Same rule the "flag flipped, no adapter" case has always followed: never strand a save.
//
// THE CUTOVER FOOTGUN. authoring.storageBackend must never be flipped by hand -- a live flip lets
// the reload's pagehide flush write the in-memory registry to the *new* backend, which is exactly
// the 2026-07-12 clobber. The flag is readable from anywhere and writable through exactly one
// function, commitBackend, called by the one guarded migration (#69) after it has backed up,
// suppressed saves, written and verified. A ratchet in tests/run.js fails any other writer.
//
// NO DOM. Not one line here touches the document. A failed write comes back as a value; the
// chrome that turns it into the red data-loss banner stays in editor.js. That is what makes the
// whole thing testable: makeMemoryAdapter() gives a test a complete storage stack with no
// browser, and the suite exercises the real code rather than a slice of its text.
(function () {
  "use strict";
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so `window.X = ...`
  // below publishes globally exactly as before. Under `require` there is no window, so it binds
  // to a local stand-in and the footer hands that namespace to module.exports.
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- 1. the keys ---------------------------------------------------------
  var KEYS = {
    registry: "authoring.registry",       // the doc-of-record: every course, by code
    activeDoc: "authoring.activeDocId",   // doc-session: which tab is in front
    openDocs: "authoring.openDocIds",     // doc-session: which tabs are open
    backend: "authoring.storageBackend",  // "browser" | "file" | "http" -- see commitBackend
    library: "authoring.library",         // shared component library (#18)
    products: "authoring.products"        // Product containers (Product Rail #1)
  };

  // ---- 2. the durable-write core (pure) ------------------------------------
  // Quota is classified rather than inferred: browsers disagree on how they report a full store,
  // so all four spellings are one condition here instead of a guess at each call site.
  function isQuotaExceeded(e) {
    if (!e) return false;
    return e.name === "QuotaExceededError" ||
           e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
           e.code === 22 || e.code === 1014;
  }
  function writeStore(storage, key, value) {
    try { storage.setItem(key, value); return { ok: true }; }
    catch (e) { return { ok: false, quota: isQuotaExceeded(e), error: e }; }
  }

  // ---- 2b. document identity (pure) ----------------------------------------
  // A document has ONE name. The registry key is it: tabs, the active-doc pointer, publish rows
  // and every menu action hold the key, never doc.meta.code. But meta.code is a second copy of
  // that name, written into every .verso export and every SCORM package, and nothing kept the two
  // in step -- so a registry could hold an entry keyed "ACME-101x" whose meta.code said
  // "ACME-101", and both were "the code" depending on which surface you asked.
  //
  // THE BUG THAT COMES OF IT, reproduced in the browser before this was written: re-import that
  // document's own .verso backup and the collision check looks up registry["ACME-101"], finds
  // nothing, and writes a SECOND entry -- no overwrite prompt, no warning. The author now has two
  // rows with one title. The new tab holds one of them; the file picker lists the other; edits go
  // to whichever the surface they used resolved. That is the "imported backups don't stay
  // consistent in the picker or in tabs" report, and it is still sitting in a real registry.
  //
  // Two functions, both pure, both DOM-free and store-free.
  function docCodeOf(d) {
    return (d && d.meta && typeof d.meta.code === "string") ? d.meta.code : null;
  }
  // Make meta.code agree with the key it is filed under. The KEY wins, always: it is what every
  // reference in the app already holds, so rewriting keys to match codes would orphan open tabs,
  // the active-doc pointer and every publish row at once. Returns the ids it repaired so a caller
  // can decide whether the registry needs writing back.
  function reconcileRegistryCodes(registry) {
    var repaired = [];
    if (!registry || typeof registry !== "object") return { repaired: repaired };
    Object.keys(registry).forEach(function (id) {
      var d = registry[id];
      if (!d || typeof d !== "object") return;
      if (!d.meta || typeof d.meta !== "object") d.meta = {};
      if (d.meta.code !== id) { d.meta.code = id; repaired.push(id); }
    });
    return { repaired: repaired };
  }
  // Which existing entry does an incoming code refer to? Answers with a registry KEY or null.
  // Four passes, most exact first, because an import has to find the entry it is a backup OF even
  // when that entry's key drifted from its code, and macOS filenames make a case-only difference
  // an easy way to get there. Null means genuinely new -- and only then may an import mint a key.
  function findRegistryId(registry, code) {
    if (!registry || typeof registry !== "object" || typeof code !== "string" || !code) return null;
    var ids = Object.keys(registry);
    if (Object.prototype.hasOwnProperty.call(registry, code)) return code;
    var byCode = null, lowered = code.toLowerCase(), byKeyCI = null, byCodeCI = null;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], c = docCodeOf(registry[id]);
      if (byCode === null && c === code) byCode = id;
      if (byKeyCI === null && id.toLowerCase() === lowered) byKeyCI = id;
      if (byCodeCI === null && typeof c === "string" && c.toLowerCase() === lowered) byCodeCI = id;
    }
    return byCode || byKeyCI || byCodeCI || null;
  }
  // The open-tab set is a list of registry keys held in a SEPARATE store (localStorage, even when
  // the registry itself lives on disk), so the two drift apart on their own: delete a course in
  // one place, abandon an import halfway, restore an older registry file, and the strip is left
  // holding a key nothing answers to. renderTabs skips such an id, which makes it invisible rather
  // than harmless -- it still counts toward "is this the last tab?", and activateDoc() will hand
  // `undefined` to the live-doc pair-write if the close logic ever lands on one. Drop them at boot,
  // dedupe, and guarantee the active id is a real document.
  function reconcileOpenDocIds(openDocIds, registry, activeDocId, fallbackId) {
    var reg = (registry && typeof registry === "object") ? registry : {};
    var seen = Object.create(null), ids = [], dropped = [];
    (Array.isArray(openDocIds) ? openDocIds : []).forEach(function (id) {
      if (typeof id !== "string" || seen[id]) { if (typeof id === "string") dropped.push(id); return; }
      seen[id] = true;
      if (Object.prototype.hasOwnProperty.call(reg, id)) ids.push(id); else dropped.push(id);
    });
    var activeId = activeDocId;
    if (!Object.prototype.hasOwnProperty.call(reg, activeId)) {
      activeId = ids[0] || (Object.prototype.hasOwnProperty.call(reg, fallbackId) ? fallbackId : Object.keys(reg)[0]) || fallbackId;
    }
    if (typeof activeId === "string" && ids.indexOf(activeId) === -1) ids.push(activeId);
    return { ids: ids, activeId: activeId, dropped: dropped };
  }

  // ---- 3. the adapter swap -------------------------------------------------
  // A facet is one content type with its own key and its own read/write pair. Three of them, and
  // an adapter may implement any subset (store-http.js implements only the registry).
  var FACETS = {
    registry: { key: KEYS.registry, read: "readRegistry", write: "writeRegistry" },
    library: { key: KEYS.library, read: "readLibrary", write: "writeLibrary" },
    products: { key: KEYS.products, read: "readProducts", write: "writeProducts" }
  };

  // Pure selector: flag value + injected adapter -> chosen adapter. A flipped flag with NO
  // injected adapter falls back to the browser store -- never strands a save.
  function pickStorageAdapter(backend, injected, fallback) {
    return (backend && backend !== "browser" && injected) ? injected : fallback;
  }
  // The same rule, one facet at a time: an injected adapter that cannot serve this facet does not
  // get to swallow it. (See "FACET-AWARE SELECTION" above -- this is the store-http library bug.)
  function pickFacetAdapter(backend, injected, fallback, facet) {
    var chosen = pickStorageAdapter(backend, injected, fallback);
    if (chosen === fallback) return fallback;
    var f = FACETS[facet];
    if (!f) return fallback;
    return (typeof chosen[f.read] === "function" && typeof chosen[f.write] === "function") ? chosen : fallback;
  }

  // The browser adapter: all three facets over one localStorage-shaped store. Reads are
  // fault-tolerant (a locked-down origin throws on getItem) and writes report their outcome.
  function makeBrowserAdapter(storage) {
    var a = { name: "browser" };
    Object.keys(FACETS).forEach(function (facet) {
      var f = FACETS[facet];
      a[f.read] = function () { try { return storage.getItem(f.key); } catch (e) { return null; } };
      a[f.write] = function (json) { return writeStore(storage, f.key, json); };
    });
    return a;
  }

  // The in-memory adapter: a complete storage stack with no browser, for tests. It is a browser
  // adapter over a plain object, so it exercises the SAME code path the app ships -- plus the
  // localStorage-shaped `storage` a store needs for its key/value facet, and `data` to look at.
  function makeMemoryAdapter(seed) {
    var mem = {};
    if (seed) Object.keys(seed).forEach(function (k) { mem[k] = String(seed[k]); });
    var storage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
    var a = makeBrowserAdapter(storage);
    a.name = "memory";
    a.storage = storage;
    a.data = mem;
    return a;
  }

  // ---- 4. the storage backend (platform-pivot 01) --------------------------
  // Registry, doc-session keys and media behind ONE interface. Scope is deliberate: only the
  // DOC-OF-RECORD routes through here. Editor UI prefs (theme mode, grid, layout, tour) stay
  // browser-local in every posture, so server mode never syncs one author's chrome onto another.
  // PURE factory (all deps injected) so the three-facet routing is testable on its own.
  function makeStorageBackend(deps) {
    return {
      // reflects the live registry adapter ("browser" | "file" | "http" | "memory")
      get name() { return deps.registryAdapter().name; },
      // --- registry (doc-of-record) -> the adapter swap ---
      readRegistry: function () { return deps.registryAdapter().readRegistry(); },
      writeRegistry: function (json) { return deps.registryAdapter().writeRegistry(json); },
      // --- low-level key/value (doc-session keys: active doc, open docs) ---
      readKey: function (key) { try { return deps.storage.getItem(key); } catch (e) { return null; } },
      writeKey: function (key, value) { return deps.writeStore(deps.storage, key, value); },
      removeKey: function (key) { try { deps.storage.removeItem(key); return { ok: true }; } catch (e) { return { ok: false, error: e }; } },
      // --- media (heavy assets) -- IS the AssetStore (put/url/get/has/sweep) ---
      get media() { return deps.assetStore(); }
    };
  }

  // ---- 5. a live store -----------------------------------------------------
  // Drain inline base64 media (images / video / SVG / fonts) and raw interaction HTML out to the
  // uncapped IndexedDB store BEFORE the registry is stringified. migrateAllAssets only runs at
  // boot, so a doc imported AFTER boot (a 147MB course with 133MB of inline images) would
  // otherwise hit localStorage's ~5MB cap on its first save -- "Storage full", write fails, doc
  // lost on reload. Hoisting at the write choke point covers BOTH write paths (the editor's
  // debounced save and persist.js's autosave). Content-hashed, so it is idempotent across saves,
  // and non-destructive: an un-hoistable block is left as raw markup.
  function defaultHoist(registry) {
    if (!window.AssetStore) return;
    try {
      Object.keys(registry).forEach(function (id) {
        var d = registry[id];
        if (!d) return;
        if (window.migrateDocMedia) window.migrateDocMedia(d, function (dataUrl) {
          return window.AssetStore.put(dataUrl, {});
        });
        if (window.migrateDocEmbedHtml) window.migrateDocEmbedHtml(d, function (dataUrl) {
          return window.AssetStore.put(dataUrl, { mime: "text/html" });
        });
      });
    } catch (e) { if (window.console && console.warn) console.warn("[save] media hoist failed:", e); }
  }

  // env = {
  //   storage    a localStorage-shaped key/value store (defaults to the real localStorage)
  //   adapter    the browser-default adapter (defaults to one over `storage`)
  //   injected   () -> the swapped-in adapter, if any (defaults to window.__storageAdapter)
  //   assetStore () -> the media store (defaults to window.AssetStore)
  //   suppressed () -> true while a backend migration is in flight (defaults to window.Migration)
  //   hoist      (registry) -> drains heavy media out before serialisation
  // }
  function createStore(env) {
    env = env || {};
    var storage = env.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var browserAdapter = env.adapter || makeBrowserAdapter(storage);
    var injected = env.injected || function () { return window.__storageAdapter; };
    var assetStore = env.assetStore || function () { return window.AssetStore || null; };
    var hoist = env.hoist || defaultHoist;
    // Save suppression (#69, the clobber-proof cutover): while a browser->file migration is
    // switching backends EVERY durable write must be a no-op, so a stale in-memory registry can
    // never be flushed under the new backend. saveRegistry is the single choke point.
    var suppressed = env.suppressed || function () {
      return !!(window.Migration && window.Migration.savesSuppressed && window.Migration.savesSuppressed());
    };

    function backend() { try { return storage.getItem(KEYS.backend) || "browser"; } catch (e) { return "browser"; } }
    function adapterFor(facet) { return pickFacetAdapter(backend(), injected(), browserAdapter, facet); }

    var StorageBackend = makeStorageBackend({
      registryAdapter: function () { return adapterFor("registry"); },
      writeStore: writeStore,
      storage: storage,
      assetStore: assetStore
    });

    // The ONE writer of the backend flag. Named so it is greppable and ratcheted: a hand-rolled
    // localStorage.setItem("authoring.storageBackend", ...) anywhere else fails the suite.
    function commitBackend(value) { return writeStore(storage, KEYS.backend, value); }

    // --- the registry (doc of record) ---
    function getRegistry(makeDefault) {
      try {
        var raw = StorageBackend.readRegistry();
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return makeDefault ? makeDefault() : {};
    }
    // The single choke point for every durable registry write (setDoc, saveActiveDoc, autosave,
    // component saves). Returns the outcome as a value -- { ok, stage, quota?, error?, bytes? }
    // with stage one of "suppressed" | "serialise" | "write" -- so the caller decides what the
    // author sees. Never throws, never swallows.
    function saveRegistry(registry) {
      if (suppressed()) return { ok: false, stage: "suppressed" };
      hoist(registry);
      var json;
      try { json = JSON.stringify(registry); }
      catch (e) { return { ok: false, stage: "serialise", error: e }; }
      var res = StorageBackend.writeRegistry(json) || { ok: false };
      return { ok: !!res.ok, stage: "write", quota: !!res.quota, error: res.error, bytes: json.length };
    }

    // --- doc-session keys (which tabs are open, which is in front) ---
    function readJson(key, fallback) {
      try {
        var v = StorageBackend.readKey(key);
        if (v) return JSON.parse(v);
      } catch (e) {}
      return fallback;
    }
    function writeJson(key, value) {
      try { return StorageBackend.writeKey(key, JSON.stringify(value)); }
      catch (e) { return { ok: false, error: e }; }
    }

    // --- the shared component library (#18) and the Product containers (Product Rail #1) ---
    // Both take their fresh-install seed from the caller: this module knows how to persist them,
    // not what a demo component or a sample Product should contain.
    function loadLibrary(seed) {
      var lib = { components: {} };
      try {
        var raw = adapterFor("library").readLibrary();
        if (raw) { var p = JSON.parse(raw); if (p && p.components) lib = p; }
      } catch (e) {}
      if (!lib.components) lib.components = {};
      if (!Object.keys(lib.components).length && seed) seed(lib);
      return lib;
    }
    function saveLibrary(lib) {
      try { return adapterFor("library").writeLibrary(JSON.stringify(lib)); }
      catch (e) { return { ok: false, error: e }; }
    }
    function loadProducts(seed) {
      var prods = {};
      try {
        var raw = adapterFor("products").readProducts();
        if (raw) { var p = JSON.parse(raw); if (p && typeof p === "object") prods = p; }
      } catch (e) {}
      if (!Object.keys(prods).length && seed) prods = seed();
      return prods;
    }
    function saveProducts(products) {
      try { return adapterFor("products").writeProducts(JSON.stringify(products)); }
      catch (e) { return { ok: false, error: e }; }
    }

    return {
      KEYS: KEYS,
      StorageBackend: StorageBackend,
      browserAdapter: browserAdapter,
      backend: backend,
      commitBackend: commitBackend,
      adapterFor: adapterFor,
      suppressed: suppressed,
      getRegistry: getRegistry,
      saveRegistry: saveRegistry,
      readKey: function (key) { return StorageBackend.readKey(key); },
      writeKey: function (key, value) { return StorageBackend.writeKey(key, value); },
      removeKey: function (key) { return StorageBackend.removeKey(key); },
      readJson: readJson,
      writeJson: writeJson,
      getOpenDocIds: function (fallback) { return readJson(KEYS.openDocs, fallback); },
      saveOpenDocIds: function (ids) { return writeJson(KEYS.openDocs, ids); },
      getActiveDocId: function (fallback) { return readJson(KEYS.activeDoc, fallback); },
      saveActiveDocId: function (id) { return writeJson(KEYS.activeDoc, id); },
      loadLibrary: loadLibrary,
      saveLibrary: saveLibrary,
      loadProducts: loadProducts,
      saveProducts: saveProducts
    };
  }

  var VersoStorage = {
    KEYS: KEYS,
    FACETS: FACETS,
    isQuotaExceeded: isQuotaExceeded,
    writeStore: writeStore,
    docCodeOf: docCodeOf,
    reconcileRegistryCodes: reconcileRegistryCodes,
    findRegistryId: findRegistryId,
    reconcileOpenDocIds: reconcileOpenDocIds,
    pickStorageAdapter: pickStorageAdapter,
    pickFacetAdapter: pickFacetAdapter,
    makeBrowserAdapter: makeBrowserAdapter,
    makeMemoryAdapter: makeMemoryAdapter,
    makeStorageBackend: makeStorageBackend,
    create: createStore
  };

  window.VersoStorage = VersoStorage;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoStorage;
})();
