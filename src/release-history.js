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

  // uio-P-C03 (PUB-10): the one-line summary a release row states -- how many documents went out,
  // under which preset(s), to where, and whether any of it failed. Entries carry a status only from
  // this ticket onward; an older record has none, so an entry with no status counts as published.
  function releaseSummary(rel) {
    var entries = (rel && rel.entries) || [];
    var docs = {}, presets = [], dests = [], failed = 0;
    entries.forEach(function (e) {
      if (!e) return;
      docs[e.docId || e.title || ""] = 1;
      if (e.status === "error") failed++;
      if (e.preset && presets.indexOf(e.preset) === -1) presets.push(e.preset);
      if (e.destination && dests.indexOf(e.destination) === -1) dests.push(e.destination);
    });
    var n = Object.keys(docs).length;
    function oneOrCount(arr, plural) {
      return !arr.length ? "" : arr.length === 1 ? arr[0] : (arr.length + " " + plural);
    }
    return {
      docCount: n,
      docLabel: n + " document" + (n === 1 ? "" : "s"),
      presets: presets,
      presetLabel: oneOrCount(presets, "presets"),
      destinations: dests,
      destinationLabel: oneOrCount(dests, "destinations"),
      failed: failed,
      published: entries.length - failed,
      outcome: failed ? (failed + " failed") : "Published",
      ok: !failed
    };
  }
  // uio-P-C03 (PUB-10): "when did this document last actually go out, and as what version" -- the
  // question that decides whether a re-publish is needed at all. Newest successful entry wins; a
  // failed entry is not a publication. Returns null when the document has never been published.
  function lastPublishedFor(store, docId) {
    var rels = list(store);
    for (var i = 0; i < rels.length; i++) {
      var es = rels[i].entries || [];
      for (var j = 0; j < es.length; j++) {
        if (es[j] && es[j].docId === docId && es[j].status !== "error") {
          return { at: rels[i].createdAt || 0, version: es[j].version || "", releaseId: rels[i].releaseId };
        }
      }
    }
    return null;
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

  var ReleaseHistory = { create: create, append: append, list: list, releaseSummary: releaseSummary,
    lastPublishedFor: lastPublishedFor, toJSON: toJSON, fromJSON: fromJSON, SCHEMA: SCHEMA };
  ReleaseHistory._pure = ReleaseHistory;
  if (typeof module !== "undefined" && module.exports) module.exports = ReleaseHistory;
  if (typeof window !== "undefined") window.ReleaseHistory = ReleaseHistory;
})();
