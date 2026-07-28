// source-doc.js -- the continuous rich-text node model + owned undo for the Source stage.
//
// Epic 2b (spec: verso-product-rail/specs/2b-source-stage-continuous-marks-rewrite.spec.md).
// This is the FOUNDATION of the Source-stage rewrite: it replaces the section-object +
// markdown-lite storage (#75/#78/#83) with ONE continuous rich-text document per topic,
// stored as a structured node tree, plus the "owned model + undo" the prototype proved we
// need (native contentEditable undo restores text but NOT the separate mark objects; Ctrl+Z
// left marks permanently broken -- see spec 1.3).
//
// The load-bearing production decision (differs from the throwaway prototype, which held
// live DOM Ranges as truth): THE MODEL IS TRUTH. A mark anchors to a MODEL offset
// {nodeKey, start, len} into a node's canonical plain text -- never to a live Range. The
// editor projects the model to a contentEditable and paints marks by recomputing DOM Ranges
// from those offsets on each render. Consequences that make the whole rewrite tractable:
//   * Undo just restores a {nodes, marks} snapshot; the mark's offsets point back into the
//     restored node text, so re-anchoring is automatic -- no Range resurrection.
//   * Round-trip + edit-shift logic is a PURE function of strings, testable with no DOM
//     (tests/run.js has no jsdom -- it slices pure cores out of src/*.js).
//   * Boundaries "ride edits" through one pure text-diff -> position-map, so typing inside a
//     span grows it and editing around it holds it (start-inclusive / end-exclusive default).
//
// DOM-free by design: this file never touches document/window state; the DOM projection
// (mount to contentEditable, CSS Custom Highlight API painting) lives in the editor chrome,
// built on this model in the range-mark-engine + lock-toolbars tickets.
//
// window.SourceDoc.*        -> the model + undo + mark API
// window.SourceDoc._pure.*  -> DOM-free logic, guarded in tests/run.js
(function () {
  "use strict";

  var NODE_TYPES = ["heading", "paragraph", "list", "table", "image", "callout"];
  var MARK_TYPES = ["link", "alternate", "comment"];

  // ---- ids -----------------------------------------------------------------
  // Deterministic within a model instance (a monotonic counter on the model), so key
  // assignment is reproducible and headlessly testable -- no Math.random / Date.now (both
  // are unavailable in tests/run.js and would break reproducibility anyway).
  function nextId(model, prefix) {
    model._seq = (model._seq || 0) + 1;
    return prefix + "-" + model._seq;
  }

  // ---- canonical node text -------------------------------------------------
  // The linear plain-text a text mark anchors into. One definition, used by both the model
  // and (later) the DOM projection, so an offset means the same thing everywhere. Object
  // nodes (image) carry no text and are marked whole-node (anchor = {nodeKey} only).
  function nodeText(node) {
    if (!node) return "";
    switch (node.type) {
      case "heading":
      case "paragraph":
      case "callout":
        return String(node.text == null ? "" : node.text);
      case "list":
        return (node.items || []).join("\n");
      case "table":
        return (node.rows || []).map(function (r) { return (r || []).join("\t"); }).join("\n");
      default:
        return "";
    }
  }
  function isTextNode(node) { return node && node.type !== "image"; }

  // Write edited plain text back into a node's typed shape (inverse of nodeText for the
  // single-text kinds; list/table keep their structure -- an edit to their joined text
  // re-splits on the same separators). Keeps the model canonical after a contentEditable edit.
  function setNodeText(node, text) {
    switch (node.type) {
      case "heading":
      case "paragraph":
      case "callout":
        node.text = text; break;
      case "list":
        node.items = text.split("\n"); break;
      case "table":
        node.rows = text.split("\n").map(function (line) { return line.split("\t"); }); break;
    }
    return node;
  }

  // ---- text diff (single contiguous replaced region) -----------------------
  // oldText -> newText as one edit: {start, removed, inserted}. A contentEditable keystroke
  // is a single-region change; a batched change collapses to the one region between the
  // common prefix and common suffix (a conservative superset -- correct for shifting marks).
  function diffText(oldT, newT) {
    oldT = String(oldT == null ? "" : oldT);
    newT = String(newT == null ? "" : newT);
    if (oldT === newT) return { start: oldT.length, removed: 0, inserted: 0 };
    var oldLen = oldT.length, newLen = newT.length;
    var start = 0, maxStart = Math.min(oldLen, newLen);
    while (start < maxStart && oldT.charCodeAt(start) === newT.charCodeAt(start)) start++;
    var endOld = oldLen, endNew = newLen;
    while (endOld > start && endNew > start && oldT.charCodeAt(endOld - 1) === newT.charCodeAt(endNew - 1)) {
      endOld--; endNew--;
    }
    return { start: start, removed: endOld - start, inserted: endNew - start };
  }

  // Map an old-text position to its new-text position under an edit, given the boundary's
  // gravity. Both span boundaries EXCLUDE text inserted exactly at their position (the span
  // holds its edges), but they exclude it in opposite directions: the START has right gravity
  // (an insertion at start lands before the span, so start slides right past it), the END has
  // left gravity (an insertion at end stays outside, so end holds). An insertion strictly
  // inside the span therefore grows it; editing around it holds it (start-inclusive /
  // end-exclusive). A position inside a deleted region collapses so a straddling delete clips
  // the span and a span wholly inside a delete empties (-> broken).
  function mapPos(p, e, gravity) {
    var eEnd = e.start + e.removed, delta = e.inserted - e.removed;
    if (p < e.start) return p;       // strictly before the edit: unchanged
    if (p > eEnd) return p + delta;  // strictly after the removed region: shift by delta
    if (e.removed === 0) return gravity === "right" ? p + e.inserted : p; // pure insertion at p
    if (p === e.start) return e.start;                 // at the delete's left edge
    if (p === eEnd) return e.start + e.inserted;       // at the delete's right edge (past any insert)
    return e.start + (gravity === "right" ? e.inserted : 0); // strictly inside the delete: collapse
  }

  // Shift a text anchor {start,len} through an edit. Start uses right gravity, end uses left
  // gravity (see mapPos). Returns the new {start,len}; caller decides broken-ness (len<=0, or
  // >75% of a long span gone -- see refreshMark).
  function shiftAnchor(anchor, e) {
    var s = mapPos(anchor.start, e, "right");
    var end = mapPos(anchor.start + anchor.len, e, "left");
    return { nodeKey: anchor.nodeKey, start: s, len: Math.max(0, end - s) };
  }

  // ---- model construction --------------------------------------------------
  function makeModel() {
    return { version: 1, _seq: 0, nodes: [], marks: [], history: [], undo: [], redo: [] };
  }
  // Give every node a stable key; headings especially drive the TOC + re-import reconcile.
  function ensureKeys(model) {
    (model.nodes || []).forEach(function (n) { if (!n.key) n.key = nextId(model, "n"); });
    return model;
  }
  function create(nodes) {
    var model = makeModel();
    model.nodes = (nodes || []).map(function (n) {
      var c = clone(n);
      if (NODE_TYPES.indexOf(c.type) === -1) c.type = "paragraph";
      return c;
    });
    ensureKeys(model);
    return model;
  }
  function nodeByKey(model, key) {
    var ns = model.nodes || [];
    for (var i = 0; i < ns.length; i++) if (ns[i].key === key) return ns[i];
    return null;
  }
  function markById(model, id) {
    var ms = model.marks || [];
    for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i];
    return null;
  }
  function headings(model) {
    return (model.nodes || []).filter(function (n) { return n.type === "heading"; })
      .map(function (n) { return { key: n.key, level: n.level || 2, text: nodeText(n) }; });
  }

  // ---- marks ---------------------------------------------------------------
  // A text mark: {id,type,anchor:{nodeKey,start,len},variant,baseText,alt,comments,locations,stale,broken}.
  // An object mark (image/whole node): anchor:{nodeKey} (no start/len), kind inferred by absence of len.
  function addMark(model, spec) {
    pushUndo(model);
    var m = {
      id: spec.id || nextId(model, "m"),
      type: MARK_TYPES.indexOf(spec.type) === -1 ? "alternate" : spec.type,
      anchor: clone(spec.anchor) || { nodeKey: null, start: 0, len: 0 },
      variant: spec.variant || "",
      tag: spec.tag != null ? spec.tag : "", // what an alternate is "appropriate for" (detail/doc-type/purpose)
      baseText: spec.baseText != null ? spec.baseText : anchorText(model, spec.anchor),
      alt: spec.alt != null ? spec.alt : null,
      comments: spec.comments ? clone(spec.comments) : [],
      locations: spec.locations ? clone(spec.locations) : null,
      stale: false, broken: false
    };
    model.marks.push(m);
    return m;
  }
  function isObjectMark(m) { return m && m.anchor && m.anchor.len == null; }
  // The live text a text mark currently covers, read from the model (never the DOM).
  function anchorText(model, anchor) {
    if (!anchor || anchor.len == null) return "";
    var n = nodeByKey(model, anchor.nodeKey);
    if (!n) return "";
    return nodeText(n).substr(anchor.start, anchor.len);
  }
  // Re-evaluate a mark's broken/stale flags against the current model text. Broken = the
  // anchored span emptied, or a long span lost >75% of its characters (a destructive delete,
  // matching the prototype's threshold). Stale = an alternate whose base span drifted from
  // the text it was written against (the sharpest provenance signal; spec 3.2).
  function refreshMark(model, m) {
    if (isObjectMark(m)) { m.broken = !nodeByKey(model, m.anchor.nodeKey); return m; }
    var cur = anchorText(model, m.anchor);
    var wasBroken = m.broken;
    m.broken = m.anchor.len <= 0 || cur.trim() === "";
    if (!m.broken && m.baseText && m.baseText.length > 40 && cur.length < m.baseText.length * 0.25) m.broken = true;
    var wasStale = m.stale;
    if (!m.broken && m.type === "alternate" && m.alt != null) m.stale = (cur !== m.baseText);
    m._brokeNow = m.broken && !wasBroken;
    m._staleNow = m.stale && !wasStale;
    return m;
  }

  // ---- editing: apply a plain-text edit to a node, riding every mark on it ----
  // The editor reads the edited node's new plain text out of the contentEditable and calls
  // this. We diff old->new, write the node, and shift every text mark anchored to that node.
  // Pushes ONE undo entry (coalescing of rapid keystrokes is the editor's job via
  // beginTransaction/endTransaction; a bare call is one discrete step).
  //
  // The diff is minimal (one contiguous region), which is exactly right for a live editor
  // driving one keystroke per call. If a batched change coincides at its edges with a span's
  // boundary char (e.g. inserting text that starts with the span's own first letter), the
  // minimal diff can't tell "typed before" from "typed inside" and may grow the span; the
  // editor avoids this by calling with per-keystroke edits (and can pass the caret offset in
  // a future editHint). This is an accepted, documented limit of text-only anchor shifting.
  function applyTextEdit(model, nodeKey, newText, opts) {
    opts = opts || {};
    var node = nodeByKey(model, nodeKey);
    if (!node) return { model: model, edit: null };
    var oldText = nodeText(node);
    var edit = diffText(oldText, newText);
    if (edit.removed === 0 && edit.inserted === 0) return { model: model, edit: edit };
    if (!opts.noUndo) pushUndo(model);
    setNodeText(node, newText);
    (model.marks || []).forEach(function (m) {
      if (isObjectMark(m) || m.anchor.nodeKey !== nodeKey) return;
      m.anchor = shiftAnchor(m.anchor, edit);
      refreshMark(model, m);
      // A span breaking is a structural provenance event (spec 3.2 / 5), so it earns a
      // discrete History entry even though the surrounding prose edit collapses to a commit.
      if (m._brokeNow) { logHistory(model, { type: "mark-broken", markId: m.id, markType: m.type }); m._brokeNow = false; }
      // An alternate going stale (its base drifted) is the sharpest provenance signal (spec 3.2);
      // it earns its own discrete History entry so "needs re-sync" is discoverable, not just a dot.
      else if (m._staleNow) { logHistory(model, { type: "mark-stale", markId: m.id, markType: m.type }); m._staleNow = false; }
    });
    return { model: model, edit: edit };
  }

  // ---- range-mark engine: status, update-with-appended-copy, relationships ----
  // The colour-dot status a mark shows (spec 3): red broken / yellow stale / green in-sync.
  function markStatus(m) {
    if (m.broken) return { dot: "red", label: "Broken -- the anchored text was deleted; downstream copies are orphaned" };
    if (m.stale) return { dot: "yellow", label: "Stale -- the base changed since this alternate was written; needs re-sync" };
    return { dot: "green", label: "In sync" };
  }
  // The permanent-id + type metadata a mark carries (spec 1.2): its distinct visual class and label.
  function markMeta(m) {
    return {
      link: { cls: "sd-mark-link", label: "Linked" },
      alternate: { cls: "sd-mark-alt", label: "Alternate" },
      comment: { cls: "sd-mark-comment", label: "Comment" }
    }[m.type] || { cls: "sd-mark-alt", label: "Mark" };
  }
  // The alternate marks anchored on exactly a given span (spec 3.2: 0..N tagged alternates).
  function alternatesFor(model, nodeKey, start, len) {
    return (model.marks || []).filter(function (m) {
      return m.type === "alternate" && !isObjectMark(m) && m.anchor.nodeKey === nodeKey
        && m.anchor.start === start && m.anchor.len === len;
    });
  }
  // Pure alternate resolution (spec 3.2): from a span's alternates, pick the one appropriate for
  // `tag` (an untagged alternate is the catch-all). Returns the alternate mark, or null meaning
  // "use the base". Deterministic: an exact tag match wins, else the first untagged alternate.
  function pickAlternate(alternates, tag) {
    if (!alternates || !alternates.length) return null;
    var exact = null, untagged = null;
    alternates.forEach(function (m) {
      if (tag && m.tag && m.tag === tag && !exact) exact = m;
      if (!m.tag && !untagged) untagged = m;
    });
    return exact || untagged || null;
  }
  // Update-with-appended-copy (the "⟳ update" affordance, spec 3.1): a selection that extends
  // PAST an existing mark's span captures the appended text into that mark, so the extension
  // propagates downstream. End-exclusive is the default (typing after a span never auto-joins);
  // this is the deliberate opt-in. Pushes undo; refreshes baseText so it's no longer stale/broken.
  function updateMark(model, markId, anchor) {
    var m = markById(model, markId);
    if (!m) return null;
    pushUndo(model);
    m.anchor = { nodeKey: anchor.nodeKey, start: anchor.start, len: anchor.len };
    m.baseText = anchorText(model, m.anchor);
    m.stale = false; m.broken = false;
    logHistory(model, { type: "mark-updated", markId: m.id, markType: m.type });
    return m;
  }
  // Find the text mark (if any) that the given selection anchor EXTENDS -- i.e. the selection
  // fully contains the mark's span in the same node and is strictly longer. Drives whether the
  // selection toolbar shows "create" or flips to "⟳ update <existing>".
  function markExtendedBy(model, anchor) {
    if (!anchor || anchor.len == null) return null;
    var selEnd = anchor.start + anchor.len;
    var found = null;
    (model.marks || []).forEach(function (m) {
      if (isObjectMark(m) || m.broken || m.anchor.nodeKey !== anchor.nodeKey) return;
      var mEnd = m.anchor.start + m.anchor.len;
      if (anchor.start <= m.anchor.start && selEnd >= mEnd && anchor.len > m.anchor.len) {
        if (!found || m.anchor.len > found.anchor.len) found = m; // prefer the largest contained mark
      }
    });
    return found;
  }
  // Marks whose span overlaps a given range in a node (for hit-testing a click/selection).
  function marksOverlapping(model, nodeKey, start, len) {
    var end = start + len;
    return (model.marks || []).filter(function (m) {
      if (isObjectMark(m)) return m.anchor.nodeKey === nodeKey;
      if (m.anchor.nodeKey !== nodeKey) return false;
      var mEnd = m.anchor.start + m.anchor.len;
      return m.anchor.start < end && mEnd > start; // strict overlap
    });
  }
  function logHistory(model, entry) {
    model.history = model.history || [];
    model.history.unshift(entry);
    return entry;
  }

  // ---- owned undo / redo ---------------------------------------------------
  // A snapshot is the whole authored state (nodes + marks); restoring it re-anchors marks
  // for free because their offsets point into the restored node text. _seq/version/history
  // are structural bookkeeping and ride along so ids never collide after an undo.
  function snapshot(model) {
    return { nodes: clone(model.nodes), marks: clone(model.marks), _seq: model._seq };
  }
  function restore(model, snap) {
    model.nodes = clone(snap.nodes);
    model.marks = clone(snap.marks);
    model._seq = snap._seq;
  }
  function pushUndo(model) {
    model.undo = model.undo || [];
    model.undo.push(snapshot(model));
    if (model.undo.length > 200) model.undo.shift(); // bound the stack; oldest step drops
    model.redo = []; // a fresh edit invalidates the redo branch
  }
  function canUndo(model) { return !!(model.undo && model.undo.length); }
  function canRedo(model) { return !!(model.redo && model.redo.length); }
  function undo(model) {
    if (!canUndo(model)) return model;
    model.redo = model.redo || [];
    model.redo.push(snapshot(model));
    restore(model, model.undo.pop());
    return model;
  }
  function redo(model) {
    if (!canRedo(model)) return model;
    model.undo = model.undo || [];
    model.undo.push(snapshot(model));
    restore(model, model.redo.pop());
    return model;
  }

  // ---- serialize / round-trip ----------------------------------------------
  // The persisted form is the authored content only (nodes + marks + history + _seq); the
  // undo/redo stacks are session state, never stored, so setDoc round-trips cleanly and the
  // pure-render invariant holds (nothing editor-only leaks into stored data).
  function toJSON(model) {
    return { version: model.version || 1, _seq: model._seq || 0, nodes: clone(model.nodes), marks: clone(model.marks), history: clone(model.history || []) };
  }
  function fromJSON(obj) {
    var model = makeModel();
    if (!obj) return model;
    model.version = obj.version || 1;
    model._seq = obj._seq || 0;
    model.nodes = clone(obj.nodes || []);
    model.marks = clone(obj.marks || []);
    model.history = clone(obj.history || []);
    ensureKeys(model);
    return model;
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  // ---- migration seam: shipped topic.sections[] -> node tree --------------
  // The bridge from the retiring section-object model (facets map per section) to the
  // continuous node tree. Deliberately light: a section's heading becomes a stable-keyed
  // heading node, its resolved base (technical) text splits into paragraph/list nodes. Full
  // block fidelity (tables, callouts, images, nested lists) is the reconcile-rekey + render
  // ticket's job; this is enough to seed real content and give downstream tickets the seam.
  function blocksFromText(text) {
    var lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").split("\n");
    var nodes = [], para = [], list = [];
    function flushP() { if (para.length) { nodes.push({ type: "paragraph", text: para.join(" ") }); para = []; } }
    function flushL() { if (list.length) { nodes.push({ type: "list", ordered: false, items: list.slice() }); list = []; } }
    lines.forEach(function (line) {
      var b = /^-\s+(.*)$/.exec(line);
      if (b) { flushP(); list.push(b[1]); }
      else if (line.trim() === "") { flushP(); flushL(); }
      else { flushL(); para.push(line.trim()); }
    });
    flushP(); flushL();
    return nodes;
  }
  function fromSections(topic, resolveFacet) {
    var model = makeModel();
    ((topic && topic.sections) || []).forEach(function (sec) {
      if (sec.heading) model.nodes.push({ type: "heading", level: 2, text: sec.heading, key: sec.id ? "n-" + sec.id : undefined });
      var text = resolveFacet ? resolveFacet(sec) : ((sec.facets && sec.facets.technical) || "");
      blocksFromText(text).forEach(function (n) { model.nodes.push(n); });
    });
    ensureKeys(model);
    return model;
  }

  // ---- full-text search (toc-search-drawer) ---------------------------------
  // Every searchable word on a topic: its name + all node text (continuous doc) or,
  // for a legacy section topic, each section heading + every facet string. The Source
  // nav search matches this instead of the title only (spec 2.3).
  function searchText(topic) {
    if (!topic) return "";
    var parts = [topic.name || ""];
    if (topic.doc && topic.doc.nodes && topic.doc.nodes.length) {
      topic.doc.nodes.forEach(function (n) { parts.push(nodeText(n)); });
    } else {
      (topic.sections || []).forEach(function (sec) {
        if (sec.heading) parts.push(sec.heading);
        var f = sec.facets || {};
        Object.keys(f).forEach(function (k) { if (typeof f[k] === "string") parts.push(f[k]); });
      });
    }
    return parts.join(" ");
  }
  // Fuzzy subsequence match: every char of `needle` appears in `hay` in order (case-
  // insensitive). An empty needle matches everything; this is the standard "fuzzy" feel
  // (typing "flsh" finds "flush") while still matching plain substrings.
  function fuzzyMatch(hay, needle) {
    var n = String(needle == null ? "" : needle).toLowerCase();
    if (!n) return true;
    var h = String(hay == null ? "" : hay).toLowerCase();
    var i = 0;
    for (var j = 0; j < h.length && i < n.length; j++) if (h[j] === n[i]) i++;
    return i === n.length;
  }

  var _pure = {
    nodeText: nodeText, setNodeText: setNodeText, isTextNode: isTextNode,
    searchText: searchText, fuzzyMatch: fuzzyMatch,
    diffText: diffText, mapPos: mapPos, shiftAnchor: shiftAnchor,
    create: create, ensureKeys: ensureKeys, headings: headings,
    addMark: addMark, anchorText: anchorText, refreshMark: refreshMark, isObjectMark: isObjectMark,
    applyTextEdit: applyTextEdit,
    snapshot: snapshot, pushUndo: pushUndo, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    toJSON: toJSON, fromJSON: fromJSON,
    nodeByKey: nodeByKey, markById: markById, NODE_TYPES: NODE_TYPES, MARK_TYPES: MARK_TYPES,
    blocksFromText: blocksFromText, fromSections: fromSections,
    markStatus: markStatus, markMeta: markMeta, updateMark: updateMark,
    alternatesFor: alternatesFor, pickAlternate: pickAlternate,
    markExtendedBy: markExtendedBy, marksOverlapping: marksOverlapping, logHistory: logHistory
  };

  var SourceDoc = {
    create: create, ensureKeys: ensureKeys, headings: headings, fromSections: fromSections,
    nodeText: nodeText, nodeByKey: nodeByKey, markById: markById,
    addMark: addMark, anchorText: anchorText, refreshMark: refreshMark, isObjectMark: isObjectMark,
    applyTextEdit: applyTextEdit,
    undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo, pushUndo: pushUndo,
    markStatus: markStatus, markMeta: markMeta, updateMark: updateMark,
    alternatesFor: alternatesFor, pickAlternate: pickAlternate,
    markExtendedBy: markExtendedBy, marksOverlapping: marksOverlapping,
    searchText: searchText, fuzzyMatch: fuzzyMatch,
    toJSON: toJSON, fromJSON: fromJSON,
    _pure: _pure
  };

  if (typeof window !== "undefined") window.SourceDoc = SourceDoc;
  if (typeof module !== "undefined" && module.exports) module.exports = SourceDoc;
})();
