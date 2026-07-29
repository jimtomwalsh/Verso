// publish-queue.js -- the persistent Publish-stage queue model (Product Rail Epic 6, T1).
//
// Design of record: verso-product-rail/specs/6-deliver-stage-publishing.spec.md +
// product-rail-publish-stage-pick-configure-queue. The Publish stage is a persistent queue of jobs
// (After Effects render-queue / DaVinci Deliver model): a solo export is a queue-of-one, a whole-
// product publish is the same queue with more rows. This module is the STATE only -- pure add /
// remove / run / complete transitions on a plain object -- so it is headlessly testable and the
// editor chrome (the pane UI + the buildPackage run loop) mounts on top of it.
//
// ONE ROW PER DOCUMENT (spec: rows are per-doc, expandable to per-file later). A row carries its
// docId, a display title, frozen-at-add-time settings (just a preset id for now; T2 adds real
// presets, T3 a save path), and a live status (pending -> running -> done|error) + the last result
// {to, path}. Re-adding a document that is already queued re-arms its row rather than duplicating it.
//
// DOM-free by design (no window/document/Date.now/Math.random): ids are a monotonic counter on the
// queue so transitions are reproducible and the whole thing round-trips through toJSON/fromJSON.
//
// window.PublishQueue.*        -> the store + transitions
// window.PublishQueue._pure.*  -> same, for the headless guard in tests/run.js
(function () {
  "use strict";

  var STATUSES = ["pending", "running", "done", "error"];

  function nextId(q) { q._seq = (q._seq || 0) + 1; return "row-" + q._seq; }

  function create() { return { version: 1, _seq: 0, rows: [] }; }

  function rowById(q, rowId) {
    var rs = (q && q.rows) || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].id === rowId) return rs[i];
    return null;
  }
  function rowByDoc(q, docId) {
    var rs = (q && q.rows) || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].docId === docId) return rs[i];
    return null;
  }

  // Queue a document. One row per document: an existing row for the same docId is RE-ARMED (status
  // back to pending, result cleared, title refreshed) rather than duplicated, so re-queueing an
  // already-published doc just makes it run again. Returns the row.
  function addDoc(q, docId, meta) {
    if (!q || docId == null) return null;
    meta = meta || {};
    var existing = rowByDoc(q, docId);
    if (existing) {
      existing.status = "pending";
      existing.result = null;
      if (meta.title != null) existing.title = String(meta.title);
      if (meta.preset != null) existing.preset = meta.preset;
      return existing;
    }
    var row = {
      id: nextId(q),
      docId: docId,
      title: meta.title != null ? String(meta.title) : String(docId),
      preset: meta.preset != null ? meta.preset : "master", // T2 turns this into real named presets
      status: "pending",
      result: null
    };
    q.rows.push(row);
    return row;
  }

  function removeRow(q, rowId) {
    if (!q || !q.rows) return q;
    q.rows = q.rows.filter(function (r) { return r.id !== rowId; });
    return q;
  }

  // Set a row's status (+ optional result {to, path}). An unknown status is ignored (never writes a
  // stray state); done/error carry the result, pending/running clear it so a re-run starts clean.
  function setStatus(q, rowId, status, result) {
    var row = rowById(q, rowId);
    if (!row || STATUSES.indexOf(status) === -1) return row;
    row.status = status;
    if (status === "done" || status === "error") { if (result !== undefined) row.result = result; }
    else row.result = null;
    return row;
  }

  function pendingRows(q) { return ((q && q.rows) || []).filter(function (r) { return r.status === "pending"; }); }
  function hasPending(q) { return pendingRows(q).length > 0; }

  // Persisted form = the whole queue (rows carry only serialisable data). Restore is tolerant of a
  // malformed / older blob so a corrupt store never strands the stage -- it just starts empty.
  function toJSON(q) { return { version: (q && q.version) || 1, _seq: (q && q._seq) || 0, rows: clone((q && q.rows) || []) }; }
  function fromJSON(obj) {
    var q = create();
    if (!obj || typeof obj !== "object") return q;
    q.version = obj.version || 1;
    q._seq = obj._seq || 0;
    q.rows = (Array.isArray(obj.rows) ? obj.rows : []).map(function (r) {
      r = r || {};
      return {
        id: r.id || null,
        docId: r.docId != null ? r.docId : null,
        title: r.title != null ? String(r.title) : String(r.docId != null ? r.docId : "Document"),
        preset: r.preset != null ? r.preset : "master",
        status: STATUSES.indexOf(r.status) === -1 ? "pending" : r.status,
        result: r.result || null
      };
    }).filter(function (r) { return r.docId != null; });
    // a row can't be left mid-run across a reload -- a "running" row reverts to pending
    q.rows.forEach(function (r) { if (r.status === "running") r.status = "pending"; });
    return q;
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  var _pure = {
    create: create, addDoc: addDoc, removeRow: removeRow, setStatus: setStatus,
    pendingRows: pendingRows, hasPending: hasPending, rowById: rowById, rowByDoc: rowByDoc,
    toJSON: toJSON, fromJSON: fromJSON, STATUSES: STATUSES
  };

  var PublishQueue = {
    create: create, addDoc: addDoc, removeRow: removeRow, setStatus: setStatus,
    pendingRows: pendingRows, hasPending: hasPending, rowById: rowById, rowByDoc: rowByDoc,
    toJSON: toJSON, fromJSON: fromJSON, _pure: _pure
  };

  if (typeof window !== "undefined") window.PublishQueue = PublishQueue;
  if (typeof module !== "undefined" && module.exports) module.exports = PublishQueue;
})();
