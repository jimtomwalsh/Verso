// release-history.js -- the append-only release log for whole-family exports (Product Rail Epic 6).
//
// Design of record: verso-product-rail/specs/6-deliver-stage-publishing.spec.md +
// product-rail-whole-family-export-release-record. Every time a Publish run finishes, ONE immutable
// release record is written capturing what was published together -- a light, timestamped provenance
// log (NOT release-branching, NOT versioned artefacts). It answers "what went out, when, from which
// source versions" for a whole product family.
//
// A release record:
//   { type:"verso-release", schema, releaseId, productId, createdAt,
//     entries:[{ docId, code, stage, title, exportFormat, variant, version, groundTruthVersions }] }
// groundTruthVersions is the {masterId: version-stamp} map for the doc's linked source at export time
// (the same snapshot the staleness baseline records), so a release is auditable against source drift.
//
// DOM-free by design (no window/document/Date.now/Math.random): the caller supplies createdAt + the
// entries; this module mints the releaseId (a monotonic counter on the store), freezes a deep clone,
// and appends. APPEND-ONLY -- there is no update or remove. Round-trips through toJSON/fromJSON.
//
// window.ReleaseHistory.*       -> the store + append/list
// window.ReleaseHistory._pure.* -> same, for the headless guard in tests/run.js
(function () {
  "use strict";

  var SCHEMA = 1;

  function create() { return { version: 1, _seq: 0, releases: [] }; }
  function nextReleaseId(store) { store._seq = (store._seq || 0) + 1; return "rel-" + store._seq; }

  // Append an immutable release record. The caller supplies { productId?, createdAt, entries }.
  // Returns the frozen record (with its minted releaseId), or null on a bad store/record.
  function append(store, rec) {
    if (!store || !rec || !Array.isArray(rec.entries)) return null;
    var release = {
      type: "verso-release",
      schema: SCHEMA,
      releaseId: nextReleaseId(store),
      productId: rec.productId || "",
      createdAt: typeof rec.createdAt === "number" ? rec.createdAt : 0,
      entries: clone(rec.entries)
    };
    store.releases.push(release);
    return release;
  }

  // Reverse-chronological (newest first). Ties (same createdAt) break by releaseId descending, so the
  // most recently minted record still sorts first.
  function list(store) {
    return ((store && store.releases) || []).slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0) || (a.releaseId < b.releaseId ? 1 : a.releaseId > b.releaseId ? -1 : 0);
    });
  }

  function toJSON(store) {
    return { version: (store && store.version) || 1, _seq: (store && store._seq) || 0, releases: clone((store && store.releases) || []) };
  }
  function fromJSON(obj) {
    var s = create();
    if (obj && typeof obj === "object") {
      s._seq = obj._seq || 0;
      s.releases = (Array.isArray(obj.releases) ? obj.releases : [])
        .map(function (r) { return clone(r); })
        .filter(function (r) { return r && Array.isArray(r.entries); });
    }
    return s;
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  var ReleaseHistory = { create: create, append: append, list: list, toJSON: toJSON, fromJSON: fromJSON, SCHEMA: SCHEMA };
  ReleaseHistory._pure = ReleaseHistory;
  if (typeof module !== "undefined" && module.exports) module.exports = ReleaseHistory;
  if (typeof window !== "undefined") window.ReleaseHistory = ReleaseHistory;
})();
