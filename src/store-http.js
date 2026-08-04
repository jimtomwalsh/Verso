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

  // Seed the in-page cache from the bootstrap script's page-load injection (ticket 34,
  // GET /api/bootstrap.js -- the on-ramp that sets serverUrl() in the first place).
  var base = serverUrl();
  var cache = b64ToText(window.__versoServerRegistryB64);

  // Signed out of a server we can nonetheless see (ticket 34). The bootstrap route is
  // served in FRONT of the identity boundary precisely so this state is knowable: it
  // reports the mode and withholds the data, rather than 401ing into silence.
  var authRequired = !!window.__versoServerAuthRequired;
  var SIGNED_OUT = "You are signed out of the Verso server, so nothing can be saved. Sign in, then reload.";

  function reportFailure(msg) {
    if (window.Editor && window.Editor.reportSaveFailure) window.Editor.reportSaveFailure(msg);
    if (window.console && console.error) console.error("[store-http] " + msg);
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
