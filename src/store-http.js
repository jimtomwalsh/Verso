/*
 * src/store-http.js -- HTTP registry adapter for the 'http' storage backend
 * (platform-pivot 02/31). The client-side counterpart of server/verso-server.js:
 * it lets the StorageBackend seam (ticket 01) point at the server-of-one instead of
 * browser storage. Loaded BEFORE editor.js so the seam can select it at boot.
 *
 * INERT BY DEFAULT. It installs window.__storageAdapter (name "http") ONLY when a
 * server URL is present (window.__versoServerUrl, set by GET /api/bootstrap.js --
 * ticket 34's on-ramp, a blocking classic <script src> that index.html loads immediately
 * before this file). In a plain browser or the local desktop shell that script 404s, no
 * server URL exists -> nothing installs and the default 'browser' backend is untouched.
 * Mutually exclusive with the native 'file' adapter (store-native.js installs only under
 * the WKWebView bridge).
 *
 * Sync-read contract: readRegistry() must be synchronous (editor reads it at boot), and
 * a blocking script tag is what makes that possible without the backend rendering a page
 * (it never does) -- the bootstrap injects the current registry blob as
 * window.__versoServerRegistryB64 before this file runs; writeRegistry() updates that in-page
 * cache synchronously and POSTs the durable write, surfacing a failed write through
 * the shared save-state (Editor.reportSaveFailure) rather than losing it silently --
 * exactly the store-native.js posture.
 *
 * Dependency-free: uses the browser's built-in fetch. No external network beyond the
 * configured same-origin/on-prem server. render() is never involved.
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

  // PURE URL builder (headless-testable): base + facet -> endpoint. Trailing slash on
  // base is tolerated; keys/ids are encoded so "authoring.activeDocId" etc. are safe.
  /* @http-api-start */
  function apiUrl(base, facet, keyOrId) {
    var b = String(base || "").replace(/\/+$/, "");
    var p = b + "/api/" + facet;
    if (keyOrId != null && keyOrId !== "") p += "/" + encodeURIComponent(keyOrId);
    return p;
  }
  /* @http-api-end */

  function serverUrl() {
    return (typeof window !== "undefined" && window.__versoServerUrl) || null;
  }
  if (!serverUrl()) return; // no server configured -> inert; browser backend only

  var dec = (typeof TextDecoder !== "undefined") ? new TextDecoder() : null;
  function b64ToText(b64) {
    if (!b64) return null;
    try {
      var bin = atob(b64), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return dec ? dec.decode(a) : bin;
    } catch (e) { return null; }
  }

  // Seed the in-page caches from the bootstrap script's page-load injection (ticket 34,
  // GET /api/bootstrap.js -- the on-ramp that sets serverUrl() in the first place). One
  // per facet the StorageBackend declares (platform-pivot 32): before that ticket only
  // the registry was served here, so on a shared server two authors shared their courses
  // and each kept a PRIVATE local copy of every source document and every product.
  var base = serverUrl();
  var cache = b64ToText(window.__versoServerRegistryB64);
  var productsCache = b64ToText(window.__versoServerProductsB64);
  var libraryCache = b64ToText(window.__versoServerLibraryB64);

  // Signed out of a server we can nonetheless see (ticket 34). The bootstrap route is
  // served in FRONT of the identity boundary precisely so this state is knowable: it
  // reports the mode and withholds the data, rather than 401ing into silence.
  var authRequired = !!window.__versoServerAuthRequired;
  var SIGNED_OUT = "You are signed out of the Verso server, so nothing can be saved. Sign in, then reload.";

  function reportFailure(msg) {
    if (window.Editor && window.Editor.reportSaveFailure) window.Editor.reportSaveFailure(msg);
    if (window.console && console.error) console.error("[store-http] " + msg);
  }

  // Report a durable write's outcome without duplicating the four branches per facet.
  function settle(promise, what) {
    return promise
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { authRequired = true; return { ok: false, auth: true }; }
        return r.ok ? r.json() : { ok: false };
      })
      .then(function (j) {
        if (j && j.auth) return reportFailure(SIGNED_OUT);
        if (!j || !j.ok) reportFailure("Saving " + what + " to the Verso server failed. Export JSON now to avoid losing work.");
      })
      .catch(function () { reportFailure("Could not reach the Verso server to save " + what + ". Check your connection; export JSON now to avoid losing work."); });
  }
  function putJson(url, body) {
    return fetch(url, { method: "PUT", body: body, headers: { "Content-Type": "application/json" } });
  }
  function postJson(url, obj) {
    return fetch(url, { method: "POST", body: JSON.stringify(obj), headers: { "Content-Type": "application/json" } });
  }

  // ---- the library, DECOMPOSED (platform-pivot 32) --------------------------
  //
  // THE PROBLEM. saveLibrary() hands this adapter the ENTIRE LibraryStore as one JSON
  // blob on every write, and source documents live inside it as kind:"topic" masters
  // carrying a `doc`. Shipping that blob straight to the server would make the library
  // shared -- and would also mean two authors in two DIFFERENT source documents overwrite
  // each other, because each save rewrites everything. That is the exact bug uio-W17
  // called out, and the workspace epic routes MORE concurrent authors into source
  // documents.
  //
  // THE FIX, and where it lives. The caller does not change: it still hands over the
  // whole blob, because that is the seam's contract and rewriting every call site would
  // be a far larger change for no gain. The ADAPTER absorbs the granularity -- it diffs
  // the incoming blob against what it last saw and writes only what actually moved:
  //
  //   - a topic's body      -> block-addressable rows under doc id "src:<masterId>",
  //                            per NODE, using the same toBlockDoc shape W17 proved
  //   - everything else     -> one components blob under the kv key
  //
  // So an author editing topic A appends changes to topic A's rows and touches nothing
  // of topic B. Model-B block locking, presence and the lease reaper already operate on
  // block rows, so source documents come under them with no new merge model.
  function libDocUrl(masterId, op) {
    return apiUrl(base, "doc", "src:" + masterId) + (op ? "/" + op : "");
  }
  // Split a library blob into { shell, topics }: the shell is the blob with every topic's
  // body removed (small, and what the kv key holds), topics maps id -> source-doc JSON.
  function splitLibrary(lib) {
    var shell = { components: {} }, topics = {};
    var comps = (lib && lib.components) || {};
    Object.keys(comps).forEach(function (id) {
      var m = comps[id];
      if (!m || typeof m !== "object") { shell.components[id] = m; return; }
      var copy = {}, k;
      for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) copy[k] = m[k];
      if (m.kind === "topic" && m.doc) { topics[id] = m.doc; delete copy.doc; }
      shell.components[id] = copy;
    });
    Object.keys(lib || {}).forEach(function (k) { if (k !== "components") shell[k] = lib[k]; });
    return { shell: shell, topics: topics };
  }
  // Which nodes of a source document changed, given the previous and next persisted JSON?
  // Returns null when the change is STRUCTURAL (a node added, removed or reordered) --
  // block-store's applyChange is a content put and explicitly refuses to add blocks, so a
  // structural change goes through import, which re-decomposes and takes a fresh snapshot.
  // That is the store's own v1 contract, not a shortcut taken here.
  function changedNodes(prevJson, nextJson) {
    var SD = window.SourceDoc;
    if (!SD || !prevJson) return null;
    var prev, next;
    try { prev = SD.fromJSON(prevJson); next = SD.fromJSON(nextJson); } catch (e) { return null; }
    var pn = prev.nodes || [], nn = next.nodes || [];
    if (pn.length !== nn.length) return null;
    var byKey = {}, i;
    for (i = 0; i < pn.length; i++) {
      if (pn[i].key !== nn[i].key) return null;   // reorder or re-key -> structural
      byKey[pn[i].key] = JSON.stringify(pn[i]);
    }
    // Metadata that is NOT a node (marks, history, _seq) rides the doc row, which import
    // owns. A metadata-only change therefore has to go through import too, or a mark
    // would be written nowhere.
    var metaMoved = JSON.stringify(SD.toBlockDoc(prev).meta) !== JSON.stringify(SD.toBlockDoc(next).meta);
    if (metaMoved) return null;
    var out = [];
    for (i = 0; i < nn.length; i++) {
      if (byKey[nn[i].key] !== JSON.stringify(nn[i])) out.push(nn[i]);
    }
    return out;
  }
  function writeTopic(id, prevJson, nextJson) {
    var SD = window.SourceDoc;
    if (!SD) return; // no source-doc module -> the shell blob carried the body; nothing to do
    var changed = changedNodes(prevJson, nextJson);
    if (changed && !changed.length) return;        // genuinely unchanged: write nothing
    if (changed) {
      // per-NODE puts: this is what stops two authors in different documents -- and in
      // different paragraphs of the SAME document -- from overwriting one another
      changed.forEach(function (n) {
        var block = {}, k;
        for (k in n) if (Object.prototype.hasOwnProperty.call(n, k)) block[k] = n[k];
        block.id = n.key;                          // the key it already had; never a second identifier
        settle(postJson(libDocUrl(id, "change"), { blockId: n.key, patch: block }), "a source document");
      });
      return;
    }
    var model;
    try { model = SD.fromJSON(nextJson); } catch (e) { return; }
    settle(postJson(libDocUrl(id, "import"), { doc: SD.toBlockDoc(model) }), "a source document");
  }

  window.__storageAdapter = {
    name: "http",
    readRegistry: function () { return cache; }, // synchronous (the seam's contract)
    writeRegistry: function (json) {
      // Signed out: fail HERE, as a value, before touching the in-page cache. The adapter
      // stays installed on purpose -- withdrawing it would let pickFacetAdapter fall back
      // to the browser store, and the author would go on editing into localStorage while
      // believing they were on the shared server. A loud refusal beats a silent strand.
      if (authRequired) { reportFailure(SIGNED_OUT); return { ok: false, quota: false, authRequired: true }; }
      cache = json; // in-page truth updates synchronously (optimistic)
      try {
        fetch(apiUrl(base, "registry"), { method: "PUT", body: json, headers: { "Content-Type": "application/json" } })
          .then(function (r) {
            if (r.status === 401 || r.status === 403) { authRequired = true; return { ok: false, auth: true }; }
            return r.ok ? r.json() : { ok: false };
          })
          .then(function (j) {
            if (j && j.auth) return reportFailure(SIGNED_OUT);
            if (!j || !j.ok) reportFailure("Save to the Verso server failed. Export JSON now to avoid losing work.");
          })
          .catch(function () { reportFailure("Could not reach the Verso server to save. Check your connection; export JSON now to avoid losing work."); });
      } catch (e) { return { ok: false, quota: false, error: e }; }
      return { ok: true }; // optimistic; durable failure surfaces via reportFailure
    },

    // --- products (platform-pivot 32) ---
    // Small and bounded, so it takes the registry's posture exactly: inlined at page
    // load, served synchronously from the in-page cache, written as one blob.
    readProducts: function () { return productsCache; },
    writeProducts: function (json) {
      if (authRequired) { reportFailure(SIGNED_OUT); return { ok: false, quota: false, authRequired: true }; }
      productsCache = json;
      try { settle(putJson(apiUrl(base, "kv", "authoring.products"), json), "products"); }
      catch (e) { return { ok: false, quota: false, error: e }; }
      return { ok: true };
    },

    // --- the shared component library, and the source documents inside it ---
    // Read is synchronous from the cache the bootstrap seeded (the server reassembles the
    // decomposed form on its way out). Write decomposes -- see splitLibrary/writeTopic.
    readLibrary: function () { return libraryCache; },
    writeLibrary: function (json) {
      if (authRequired) { reportFailure(SIGNED_OUT); return { ok: false, quota: false, authRequired: true }; }
      var next, prev = null;
      try { next = JSON.parse(json); } catch (e) { return { ok: false, quota: false, error: e }; }
      try { prev = libraryCache ? JSON.parse(libraryCache) : null; } catch (e) { prev = null; }
      libraryCache = json;                      // in-page truth updates synchronously
      try {
        var nextSplit = splitLibrary(next);
        var prevSplit = prev ? splitLibrary(prev) : { shell: null, topics: {} };
        // each source document, per node, only where it moved
        Object.keys(nextSplit.topics).forEach(function (id) {
          writeTopic(id, prevSplit.topics[id] || null, nextSplit.topics[id]);
        });
        // the rest of the library, as one small blob -- but only when it actually changed,
        // so an edit inside one source document does not rewrite every author's shell
        var shellJson = JSON.stringify(nextSplit.shell);
        if (!prevSplit.shell || JSON.stringify(prevSplit.shell) !== shellJson) {
          settle(putJson(apiUrl(base, "kv", "authoring.library"), shellJson), "the shared library");
        }
      } catch (e) { return { ok: false, quota: false, error: e }; }
      return { ok: true };
    }
  };

  // Say it once at boot too, not only on the first save attempt: an author who opens a
  // signed-out server sees an empty world, and an empty world is indistinguishable from
  // a fresh one unless something says otherwise.
  if (authRequired) reportFailure(SIGNED_OUT);

  // Async API surface for later phases (transport #08, migration #05). Not wired into
  // the sync media facet yet -- that async rework is Phase 2, not this ticket.
  window.__versoHttpApi = {
    base: base,
    url: apiUrl,
    getRegistry: function () { return fetch(apiUrl(base, "registry")).then(function (r) { return r.json(); }).then(function (j) { return j.registry; }); },
    putRegistry: function (json) { return fetch(apiUrl(base, "registry"), { method: "PUT", body: json }).then(function (r) { return r.json(); }); },
    getKv: function (k) { return fetch(apiUrl(base, "kv", k)).then(function (r) { return r.json(); }).then(function (j) { return j.value; }); },
    putKv: function (k, v) { return fetch(apiUrl(base, "kv", k), { method: "PUT", body: v }).then(function (r) { return r.json(); }); },
    getMedia: function (id) { return fetch(apiUrl(base, "media", id)).then(function (r) { return r.ok ? r.json() : null; }); },
    putMedia: function (id, data, mime) { return fetch(apiUrl(base, "media", id), { method: "PUT", body: JSON.stringify({ data: data, mime: mime }) }).then(function (r) { return r.json(); }); }
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
