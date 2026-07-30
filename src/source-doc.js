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

  // "row" (A3) is a layout container holding 2-3 image children side by side. It carries no text
  // and is not itself markable; its image children keep their own keys + marks (nesting must not
  // change a key, or object marks orphan). Walkers that resolve a node by key descend into rows.
  var NODE_TYPES = ["heading", "paragraph", "list", "table", "image", "callout", "row"];
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
  function isTextNode(node) { return node && node.type !== "image" && node.type !== "row"; }

  // ---- offset-preserving inline tokeniser (source-rich-render) -------------
  // Splits a node's canonical text into runs, tagging bold (**..**) and inline code (`..`) using
  // the SAME grammar as MarkdownLite.INLINE_RE (bold + code, no nesting). The delimiter runs are
  // kept as their own runs flagged `marker:true`. The invariant that makes rich rendering safe:
  //   runs.map(r => r.text).join("") === input, character for character.
  // So a DOM projection that emits every run's text (the markers merely hidden by CSS) keeps the
  // plain-text offsets the range-marks + applyTextEdit math anchor to completely unchanged -- the
  // rich layer is purely visual, never a re-indexing of the model.
  var INLINE_RUN_RE = /\*\*([^*]+?)\*\*|`([^`]+?)`/g;
  function inlineRuns(text) {
    var s = String(text == null ? "" : text);
    var runs = [], last = 0, m;
    INLINE_RUN_RE.lastIndex = 0;
    while ((m = INLINE_RUN_RE.exec(s))) {
      if (m.index > last) runs.push({ text: s.slice(last, m.index), kind: "text" });
      var kind = m[1] != null ? "bold" : "code";
      var delim = kind === "bold" ? "**" : "`";
      runs.push({ text: delim, kind: kind, marker: true });
      runs.push({ text: m[1] != null ? m[1] : m[2], kind: kind });
      runs.push({ text: delim, kind: kind, marker: true });
      last = INLINE_RUN_RE.lastIndex;
    }
    if (last < s.length) runs.push({ text: s.slice(last), kind: "text" });
    if (!runs.length) runs.push({ text: "", kind: "text" });
    return runs;
  }

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
    for (var i = 0; i < ns.length; i++) {
      if (ns[i].key === key) return ns[i];
      // A3: descend one level into a row so a nested image resolves by key (marks anchor by key).
      if (ns[i].type === "row" && ns[i].children) {
        for (var j = 0; j < ns[i].children.length; j++) if (ns[i].children[j].key === key) return ns[i].children[j];
      }
    }
    return null;
  }
  // A3: locate the row that owns a child image (by key) -> { row, rowIndex, childIndex } or null.
  function rowOf(model, childKey) {
    var ns = model.nodes || [];
    for (var i = 0; i < ns.length; i++) {
      if (ns[i].type === "row" && ns[i].children) {
        for (var j = 0; j < ns[i].children.length; j++) if (ns[i].children[j].key === childKey) return { row: ns[i], rowIndex: i, childIndex: j };
      }
    }
    return null;
  }
  // A3: "place beside next" -- wrap a top-level image and the adjacent image into a row (2-3 max).
  // If the next node is already a row with room, the selected image joins it. Keys are preserved so
  // marks stay attached. Returns true when something combined. No-op (false) if there's nothing to
  // place beside, so the caller can toast.
  function combineIntoRow(model, nodeKey) {
    var ns = model.nodes || [];
    // Case 1: a top-level image combines with the node right after it.
    for (var i = 0; i < ns.length; i++) {
      if (ns[i].key === nodeKey && ns[i].type === "image") {
        var next = ns[i + 1];
        if (!next) return false;
        if (next.type === "image") {
          var rk; do { rk = nextId(model, "n"); } while (nodeByKey(model, rk));
          ns.splice(i, 2, { type: "row", key: rk, children: [ns[i], next] });
          return true;
        }
        if (next.type === "row" && next.children && next.children.length < 3) { next.children.unshift(ns[i]); ns.splice(i, 1); return true; }
        return false;
      }
    }
    // Case 2: the LAST image in a row pulls in the following top-level image (grow to 3).
    var loc = rowOf(model, nodeKey);
    if (loc && loc.childIndex === loc.row.children.length - 1 && loc.row.children.length < 3) {
      var after = ns[loc.rowIndex + 1];
      if (after && after.type === "image") { loc.row.children.push(after); ns.splice(loc.rowIndex + 1, 1); return true; }
    }
    return false;
  }
  // A3: take a child image out of its row and drop it back as a top-level node just after the row.
  // If the row falls to a single child, the row dissolves back into that lone image. Keys preserved.
  // Returns the freed child's key (for reselect) or null.
  function removeFromRow(model, childKey) {
    var loc = rowOf(model, childKey); if (!loc) return null;
    var ns = model.nodes || [], child = loc.row.children.splice(loc.childIndex, 1)[0];
    ns.splice(loc.rowIndex + 1, 0, child);
    if (loc.row.children.length === 1) {
      // dissolve: replace the row with its remaining lone image, in place
      var lone = loc.row.children[0];
      var ri = ns.indexOf(loc.row); if (ri >= 0) ns.splice(ri, 1, lone);
    }
    return child.key;
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
  // uio-S-C01 (SRC-01): where a mark SITS in the document, as a heading path ("Operation - Detection
  // overview"). A mark row that carries its own location identifies itself without relying on a
  // truncated snippet. Walk backwards from the marked node collecting the nearest heading of each
  // ascending level, so a level-3 mark reports its h2 and h1 ancestors too. Pure -> testable.
  function markPath(model, mark) {
    if (!model || !mark || !mark.anchor) return "";
    var nodes = model.nodes || [], key = mark.anchor.nodeKey, at = -1;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].key === key) { at = i; break; }
      // a row wraps child nodes (A3 image rows) -- a mark inside one reports the row's position
      if (nodes[i].type === "row" && (nodes[i].children || []).some(function (c) { return c.key === key; })) { at = i; break; }
    }
    if (at === -1) return "";
    var seen = [], best = 99;
    for (var j = at; j >= 0; j--) {
      var n = nodes[j];
      if (n.type !== "heading") continue;
      var lvl = n.level || 2;
      if (lvl >= best) continue;          // already have a heading at or above this depth
      best = lvl;
      var t = String(nodeText(n) || "").trim();
      if (t) seen.unshift(t);
      if (lvl <= 1) break;                // reached the chapter -- nothing above it
    }
    return seen.join(" · ");
  }
  // uio-S-C01 (SRC-06): the live per-type counts the labelled mark filter carries ("All 6 / Alt 1 /
  // Linked 2 / Notes 2"). One pass over the marks, so the segments can never disagree with the list.
  function markCounts(model) {
    var out = { all: 0, alternate: 0, link: 0, comment: 0 };
    (model && model.marks || []).forEach(function (m) {
      out.all++;
      if (out[m.type] != null) out[m.type]++;
    });
    return out;
  }
  // Insert a node immediately AFTER the node keyed blockKey (or at the end when blockKey is null /
  // not found -- the toolbar-insert decision: drop the new block after the selected one). The new
  // node gets a fresh unique key; existing keys, marks (anchored by key) and variants ride along
  // untouched. Pushes ONE undo. Returns the inserted node. Pure -> headlessly testable.
  function insertNodeAfter(model, blockKey, node) {
    if (!model) return null;
    pushUndo(model);
    var c = clone(node) || {};
    if (NODE_TYPES.indexOf(c.type) === -1) c.type = "paragraph";
    var k; do { k = nextId(model, "n"); } while (nodeByKey(model, k)); c.key = k;
    model.nodes = model.nodes || [];
    var at = model.nodes.length;
    if (blockKey != null) { for (var i = 0; i < model.nodes.length; i++) { if (model.nodes[i].key === blockKey) { at = i + 1; break; } } }
    model.nodes.splice(at, 0, c);
    return c;
  }

  // ---- marks ---------------------------------------------------------------
  // A text mark: {id,type,anchor:{nodeKey,start,len},variant,baseText,alt,comments,locations,stale,broken}.
  // An object mark (image/whole node): anchor:{nodeKey} (no start/len), kind inferred by absence of len.
  function addMark(model, spec) {
    pushUndo(model);
    var a = spec.anchor || { nodeKey: null, start: 0, len: 0 };
    // Store a CLEAN anchor -- the selection descriptor from SourceMarks.selectionAnchor() carries a
    // nested endAnchor + a `multi` flag that must not leak into the persisted anchor.
    var m = {
      id: spec.id || nextId(model, "m"),
      type: MARK_TYPES.indexOf(spec.type) === -1 ? "alternate" : spec.type,
      anchor: a.len == null ? { nodeKey: a.nodeKey } : { nodeKey: a.nodeKey, start: a.start, len: a.len },
      variant: spec.variant || "",
      tag: spec.tag != null ? spec.tag : "", // what an alternate is "appropriate for" (detail/doc-type/purpose)
      baseText: null,
      alt: spec.alt != null ? spec.alt : null,
      comments: spec.comments ? clone(spec.comments) : [],
      locations: spec.locations ? clone(spec.locations) : null,
      stale: false, broken: false
    };
    // A selection spanning 2+ nodes carries an endAnchor (the LAST covered node, start always 0);
    // the mark then covers from anchor (the first node, to its end) through endAnchor, with every
    // node between them covered whole and derived from document order (see markSpans). A same-node
    // or object anchor stays single-block. This is the one word -> whole document range (D1). The
    // endAnchor can arrive at spec.endAnchor OR nested on spec.anchor (the selection descriptor).
    var end = spec.endAnchor || a.endAnchor;
    if (end && end.nodeKey && a.len != null && end.nodeKey !== a.nodeKey) {
      m.endAnchor = { nodeKey: end.nodeKey, start: 0, len: end.len || 0 };
    }
    m.baseText = spec.baseText != null ? spec.baseText : markText(model, m);
    model.marks.push(m);
    return m;
  }
  function isObjectMark(m) { return m && m.anchor && m.anchor.len == null; }

  // ---- source-link 05: format-split planner (pure) --------------------------
  // Split a link range into one block-spec per CONTIGUOUS same-format run, in document order, so a
  // cross-format drop (a heading through a paragraph) becomes a heading block then a body block,
  // each styled to the destination doc's matching preset. Consecutive same-format nodes stay in ONE
  // run (rendered as one block, its covered nodes joined by line breaks). A format change starts a
  // new run. Pure -> the editor's multi-block placement is testable headlessly.
  //   in:  a range descriptor { anchor:{nodeKey,start,len}, endAnchor?:{...} }
  //   out: [{ format:"h1"|"h2"|"body", anchor, endAnchor? }, ...] over each run's sub-range
  function nodeFormat(n) {
    if (n && n.type === "heading") return isChapterNode(n) ? "h1" : "h2";
    return "body";
  }
  function planLinkedBlocks(model, descriptor) {
    if (!descriptor || !descriptor.anchor) return [];
    var spans = markSpans(model, { anchor: descriptor.anchor, endAnchor: descriptor.endAnchor });
    var runs = [], cur = null;
    spans.forEach(function (sp) {
      var fmt = nodeFormat(nodeByKey(model, sp.nodeKey));
      if (!cur || cur.format !== fmt) { cur = { format: fmt, spans: [] }; runs.push(cur); }
      cur.spans.push(sp);
    });
    return runs.map(function (run) {
      var first = run.spans[0], last = run.spans[run.spans.length - 1];
      var d = { format: run.format, anchor: { nodeKey: first.nodeKey, start: first.start, len: first.len } };
      if (last.nodeKey !== first.nodeKey) d.endAnchor = { nodeKey: last.nodeKey, start: 0, len: last.len };
      return d;
    });
  }
  // The live text a text mark currently covers, read from the model (never the DOM).
  function anchorText(model, anchor) {
    if (!anchor || anchor.len == null) return "";
    var n = nodeByKey(model, anchor.nodeKey);
    if (!n) return "";
    return nodeText(n).substr(anchor.start, anchor.len);
  }

  // ---- multi-block marks: one word to the whole document (D1) ----------------
  // A single-block mark anchors to one node (anchor {nodeKey,start,len}). A mark covering 2+ nodes
  // ALSO carries endAnchor {nodeKey,start,len} for the LAST covered node (start always 0); anchor
  // then describes the FIRST covered node (start..node end). Every node strictly between the two is
  // covered whole, derived from document order -- so interior text stays fully covered however it is
  // edited, and only the two endpoint offsets ride edits. Object marks (no len) are never multi-block.
  function isMultiBlock(m) {
    return !!(m && m.endAnchor && m.anchor && m.anchor.len != null && m.endAnchor.nodeKey && m.endAnchor.nodeKey !== m.anchor.nodeKey);
  }
  function nodeIndex(model, key) {
    var ns = (model && model.nodes) || [];
    for (var i = 0; i < ns.length; i++) if (ns[i].key === key) return i;
    return -1;
  }
  // The ordered per-node sub-spans a mark covers: {nodeKey,start,len,whole}. Single-block -> the one
  // anchor. Multi-block -> first node [anchor.start..end], interior nodes whole, last node
  // [0..endAnchor.len]. Empty when an endpoint node is missing or the endpoints are out of document
  // order (the mark is broken). Pure -> the painting engine and the text ops share one definition.
  function markSpans(model, m) {
    if (isObjectMark(m)) return [];
    if (!isMultiBlock(m)) return [{ nodeKey: m.anchor.nodeKey, start: m.anchor.start, len: m.anchor.len, whole: false }];
    var si = nodeIndex(model, m.anchor.nodeKey), ei = nodeIndex(model, m.endAnchor.nodeKey);
    if (si < 0 || ei < 0 || ei < si) return [];
    var out = [], ns = model.nodes;
    for (var i = si; i <= ei; i++) {
      var n = ns[i], full = nodeText(n).length;
      if (i === si) out.push({ nodeKey: n.key, start: m.anchor.start, len: Math.max(0, full - m.anchor.start), whole: m.anchor.start === 0 });
      else if (i === ei) out.push({ nodeKey: n.key, start: 0, len: Math.min(m.endAnchor.len, full), whole: false });
      else out.push({ nodeKey: n.key, start: 0, len: full, whole: true });
    }
    return out;
  }
  // The live text a mark currently covers, read from the model (never the DOM): one node for a
  // single-block mark, the covered slice of every node joined by newlines for a multi-block one.
  // This is the canonical string baseText is set from and staleness is compared against.
  function markText(model, m) {
    if (isObjectMark(m)) return "";
    if (!isMultiBlock(m)) return anchorText(model, m.anchor);
    return markSpans(model, m).map(function (s) {
      var n = nodeByKey(model, s.nodeKey); return n ? nodeText(n).substr(s.start, s.len) : "";
    }).join("\n");
  }
  // Is `nodeKey` one of the interior (fully covered) nodes of a multi-block mark -- strictly between
  // its first and last covered node in document order? Interior nodes carry no stored offsets (their
  // coverage is derived), so an edit to one shifts nothing but still re-evaluates broken/stale.
  function multiCoversInterior(model, m, nodeKey) {
    var si = nodeIndex(model, m.anchor.nodeKey), ei = nodeIndex(model, m.endAnchor.nodeKey), k = nodeIndex(model, nodeKey);
    return si >= 0 && ei >= 0 && k > si && k < ei;
  }
  // Re-evaluate a mark's broken/stale flags against the current model text. Broken = the
  // anchored span emptied, or a long span lost >75% of its characters (a destructive delete,
  // matching the prototype's threshold). Stale = an alternate whose base span drifted from
  // the text it was written against (the sharpest provenance signal; spec 3.2).
  function refreshMark(model, m) {
    if (isObjectMark(m)) { m.broken = !nodeByKey(model, m.anchor.nodeKey); return m; }
    var multi = isMultiBlock(m);
    var cur = markText(model, m); // single node, or every covered node joined (multi-block)
    var wasBroken = m.broken;
    // Broken = the covered text emptied: for a single-block mark its span went to zero; for a
    // multi-block one an endpoint node vanished (markSpans []) or the whole covered text trimmed away.
    m.broken = multi ? (markSpans(model, m).length === 0 || cur.trim() === "") : (m.anchor.len <= 0 || cur.trim() === "");
    if (!m.broken && m.baseText && m.baseText.length > 40 && cur.length < m.baseText.length * 0.25) m.broken = true;
    var wasStale = m.stale;
    if (!m.broken && m.type === "alternate" && m.alt != null) m.stale = (cur !== m.baseText);
    m._brokeNow = m.broken && !wasBroken;
    m._staleNow = m.stale && !wasStale;
    // a mark that was broken or stale and is now fully in sync again (the author edited the
    // text back toward the base) -- the inverse provenance signal to _brokeNow / _staleNow.
    m._restoredNow = (wasBroken || wasStale) && !m.broken && !m.stale;
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
    // Inline-format runs (from Markdown import) are offsets over the OLD text; once the base text is
    // edited they'd point at the wrong characters, so drop them rather than paint stale bold. Base
    // text is normally locked, so this is a rare, safe fallback (the edited node just reads as plain).
    if (node.formats) delete node.formats;
    var editedLen = nodeText(node).length; // the node now holds newText
    (model.marks || []).forEach(function (m) {
      if (isObjectMark(m)) return;
      if (isMultiBlock(m)) {
        // Shift only the two endpoint offsets; interior nodes are covered whole and derived, so an
        // edit to one needs no offset bookkeeping (only a broken/stale re-check). Skip marks whose
        // covered range does not touch the edited node at all.
        var atStart = m.anchor.nodeKey === nodeKey, atEnd = m.endAnchor.nodeKey === nodeKey;
        if (!atStart && !atEnd && !multiCoversInterior(model, m, nodeKey)) return;
        if (atStart) { m.anchor.start = mapPos(m.anchor.start, edit, "right"); m.anchor.len = Math.max(0, editedLen - m.anchor.start); }
        // the last node's coverage always begins at 0, so only its END offset rides the edit (end-exclusive, left gravity)
        if (atEnd) { m.endAnchor.len = Math.min(mapPos(m.endAnchor.len, edit, "left"), editedLen); }
      } else {
        if (m.anchor.nodeKey !== nodeKey) return;
        m.anchor = shiftAnchor(m.anchor, edit);
      }
      refreshMark(model, m);
      // A span breaking is a structural provenance event (spec 3.2 / 5), so it earns a
      // discrete History entry even though the surrounding prose edit collapses to a commit.
      if (m._brokeNow) { logHistory(model, { type: "mark-broken", markId: m.id, markType: m.type }); m._brokeNow = false; }
      // An alternate going stale (its base drifted) is the sharpest provenance signal (spec 3.2);
      // it earns its own discrete History entry so "needs re-sync" is discoverable, not just a dot.
      else if (m._staleNow) { logHistory(model, { type: "mark-stale", markId: m.id, markType: m.type }); m._staleNow = false; }
      // The recovery is provenance too -- editing the text back in sync clears the flag with a
      // discrete "restored" entry, so the timeline shows the break AND the fix, not just the break.
      else if (m._restoredNow) { logHistory(model, { type: "mark-restored", markId: m.id, markType: m.type }); }
      m._restoredNow = false;
    });
    return { model: model, edit: edit };
  }

  // Replace the text covered by a selection ANCHOR (single- or multi-block) with `text` (empty for a
  // delete). This is the model side of editing ACROSS paragraphs: with one contentEditable host a drag
  // can now span blocks, so Backspace / Delete / typing over a multi-paragraph selection must merge and
  // remove blocks through the model rather than let the browser mangle the DOM.
  //   single-block -> reuse applyTextEdit (proven single-node mark shifting).
  //   multi-block   -> the FIRST node keeps its head, the LAST node's tail merges onto it, every
  //                    INTERIOR node is removed (standard "delete across paragraphs"). Marks in the
  //                    surviving head/tail re-anchor onto the merged node; marks whose text was removed
  //                    break (same as a single-block delete). One owned-undo step; multi-block mark
  //                    interiors are re-derived. Returns { model, mergedKey, caret:{nodeKey,offset} }.
  // Source find-and-replace: replace every case-insensitive occurrence of `needle` with `replacement`
  // across the document's text nodes (heading/paragraph/callout/list/table -- the same scope
  // findMatches covers). Each edit rides applyTextEdit, so range-marks shift with the text; the whole
  // pass is ONE owned-undo step. Returns the number of occurrences replaced. Case-insensitive to match
  // the find (findMatches lowercases both sides).
  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function replaceAll(model, needle, replacement) {
    needle = String(needle == null ? "" : needle);
    if (!needle || !model) return 0;
    replacement = String(replacement == null ? "" : replacement);
    var re = new RegExp(escapeRegExp(needle), "gi");
    var count = 0, undone = false;
    ((model.nodes) || []).slice().forEach(function (n) {
      if (!isTextNode(n)) return;
      var t = nodeText(n); re.lastIndex = 0;
      var m = t.match(re); if (!m || !m.length) return;
      count += m.length;
      if (!undone) { pushUndo(model); undone = true; }
      applyTextEdit(model, n.key, t.replace(re, function () { return replacement; }), { noUndo: true });
    });
    return count;
  }
  function replaceRange(model, anchor, text) {
    text = text == null ? "" : String(text);
    if (!anchor || anchor.nodeKey == null) return { model: model, mergedKey: null, caret: null };
    // single-block (no endAnchor, or both ends in one node)
    if (!anchor.endAnchor || anchor.endAnchor.nodeKey === anchor.nodeKey) {
      var n0 = nodeByKey(model, anchor.nodeKey);
      if (!n0) return { model: model, mergedKey: null, caret: null };
      var t0 = nodeText(n0);
      var s0 = Math.max(0, Math.min(anchor.start, t0.length));
      var e0 = Math.max(s0, Math.min(anchor.start + (anchor.len || 0), t0.length));
      applyTextEdit(model, anchor.nodeKey, t0.slice(0, s0) + text + t0.slice(e0));
      return { model: model, mergedKey: anchor.nodeKey, caret: { nodeKey: anchor.nodeKey, offset: s0 + text.length } };
    }
    var first = nodeByKey(model, anchor.nodeKey), last = nodeByKey(model, anchor.endAnchor.nodeKey);
    if (!first || !last) return { model: model, mergedKey: null, caret: null };
    var ns = model.nodes || [];
    var firstIdx = ns.indexOf(first), lastIdx = ns.indexOf(last);
    if (firstIdx < 0 || lastIdx <= firstIdx) { // out of order / degenerate -> single-block on the first node
      return replaceRange(model, { nodeKey: anchor.nodeKey, start: anchor.start, len: anchor.len || 0 }, text);
    }
    pushUndo(model);
    var firstText = nodeText(first), lastText = nodeText(last);
    var headLen = Math.max(0, Math.min(anchor.start, firstText.length));
    var tailStart = Math.max(0, Math.min((anchor.endAnchor.start || 0) + (anchor.endAnchor.len || 0), lastText.length));
    var merged = firstText.slice(0, headLen) + text + lastText.slice(tailStart);
    var mergePoint = headLen + text.length; // offset in the merged node where the tail begins
    var firstKey = first.key, lastKey = last.key, removed = {};
    for (var i = firstIdx + 1; i <= lastIdx; i++) removed[ns[i].key] = true;
    // Map a (nodeKey, offset) point through the merge. null -> the node is untouched (before/after).
    function remap(nodeKey, off) {
      if (nodeKey === firstKey) return { key: firstKey, off: off <= headLen ? off : mergePoint };
      if (nodeKey === lastKey) return { key: firstKey, off: off <= tailStart ? mergePoint : mergePoint + (off - tailStart) };
      if (removed[nodeKey]) return { key: firstKey, off: mergePoint }; // interior node -> collapsed to the seam
      return null;
    }
    (model.marks || []).forEach(function (m) {
      if (isObjectMark(m)) return; // whole-node marks re-check via refreshMark (removed node -> broken)
      if (isMultiBlock(m)) {
        var s = remap(m.anchor.nodeKey, m.anchor.start);
        var e = remap(m.endAnchor.nodeKey, (m.endAnchor.start || 0) + (m.endAnchor.len || 0));
        if (s === null && e === null) return; // wholly outside the edit
        if (s === null) s = { key: m.anchor.nodeKey, off: m.anchor.start };
        if (e === null) e = { key: m.endAnchor.nodeKey, off: (m.endAnchor.start || 0) + (m.endAnchor.len || 0) };
        if (s.key === e.key) { m.anchor = { nodeKey: s.key, start: Math.min(s.off, e.off), len: Math.abs(e.off - s.off) }; delete m.endAnchor; }
        else { m.anchor = { nodeKey: s.key, start: s.off, len: Math.max(0, merged.length - s.off) }; m.endAnchor = { nodeKey: e.key, start: 0, len: e.off }; }
      } else {
        var rs = remap(m.anchor.nodeKey, m.anchor.start);
        if (rs === null) return;
        var re = remap(m.anchor.nodeKey, m.anchor.start + m.anchor.len);
        m.anchor = { nodeKey: rs.key, start: Math.min(rs.off, re.off), len: Math.abs(re.off - rs.off) };
      }
    });
    setNodeText(first, merged);
    model.nodes = ns.filter(function (n, idx) { return !(idx > firstIdx && idx <= lastIdx); });
    (model.marks || []).forEach(function (m) {
      refreshMark(model, m);
      if (m._brokeNow) { logHistory(model, { type: "mark-broken", markId: m.id, markType: m.type }); }
      m._brokeNow = false; m._staleNow = false; m._restoredNow = false;
    });
    logHistory(model, { type: "range-replaced", nodeKey: firstKey });
    return { model: model, mergedKey: firstKey, caret: { nodeKey: firstKey, offset: mergePoint } };
  }

  // Split a text block at a caret offset into two blocks -- the INVERSE of replaceRange's merge, so
  // pressing Enter in the continuous doc makes a new paragraph. The head keeps [0,offset); a new
  // paragraph node inserted right after holds [offset,end). Marks re-anchor: a mark entirely before
  // the split stays; one entirely after moves to the new node (offset-shifted); one straddling the
  // split becomes a two-block mark. A non-text block (list/table/image) just gets a new empty
  // paragraph after it. One owned-undo step. Returns { model, newKey, caret:{nodeKey,offset} }.
  var SPLITTABLE = { paragraph: 1, heading: 1, callout: 1 };
  // Block-format reassignment (source-selbar-block-formats): change a text node's block type IN
  // PLACE, keeping its key (marks stay anchored), its text (node.text is shared by heading/
  // paragraph/callout) and its inline formats. Only heading/paragraph/callout reassign; structural
  // nodes (list/table/image/row) are left untouched (returns null). Sets/clears the type-specific
  // fields: heading.level (1/2/3), callout.tag. Owned undo so the change is a single undo step.
  var BLOCK_FORMAT_TYPES = { heading: 1, paragraph: 1, callout: 1 };
  function setNodeType(model, nodeKey, spec) {
    spec = spec || {};
    if (!BLOCK_FORMAT_TYPES[spec.type]) return null;
    var node = nodeByKey(model, nodeKey);
    if (!node || !(node.type === "heading" || node.type === "paragraph" || node.type === "callout")) return null;
    if (node.type === spec.type) {
      // same type -- only a heading level or a callout tag change actually mutates
      if (spec.type === "heading" && node.level === (spec.level || 1)) return null;
      if (spec.type === "paragraph") return null;
      if (spec.type === "callout" && spec.tag == null) return null;
    }
    pushUndo(model);
    node.type = spec.type;
    if (spec.type === "heading") { node.level = (spec.level === 3) ? 3 : (spec.level === 2) ? 2 : 1; delete node.tag; }
    else if (spec.type === "callout") { node.tag = (spec.tag != null) ? String(spec.tag) : (node.tag || "Caution"); delete node.level; }
    else { delete node.level; delete node.tag; }
    logHistory(model, { type: "node-reformat", nodeKey: nodeKey, to: spec.type });
    return node;
  }
  // The keys of every node a selection anchor covers (first..last in document order); a single-node
  // anchor yields one key. Lets a block-format action apply across a multi-paragraph selection.
  function nodesInAnchor(model, anchor) {
    if (!anchor || !anchor.nodeKey) return [];
    if (!anchor.endAnchor || !anchor.endAnchor.nodeKey || anchor.endAnchor.nodeKey === anchor.nodeKey) return [anchor.nodeKey];
    var ns = (model && model.nodes) || [], i0 = -1, i1 = -1;
    for (var i = 0; i < ns.length; i++) { if (ns[i].key === anchor.nodeKey) i0 = i; if (ns[i].key === anchor.endAnchor.nodeKey) i1 = i; }
    if (i0 < 0 || i1 < 0) return [anchor.nodeKey];
    if (i1 < i0) { var t = i0; i0 = i1; i1 = t; }
    var keys = [];
    for (var j = i0; j <= i1; j++) keys.push(ns[j].key);
    return keys;
  }
  function splitNode(model, nodeKey, offset) {
    var node = nodeByKey(model, nodeKey);
    if (!node) return { model: model, newKey: null, caret: null };
    pushUndo(model);
    var k; do { k = nextId(model, "n"); } while (nodeByKey(model, k));
    var idx = (model.nodes || []).indexOf(node);
    if (!SPLITTABLE[node.type]) { // Enter after a list/table/image drops a fresh paragraph below it
      model.nodes.splice(idx + 1, 0, { type: "paragraph", key: k, text: "" });
      logHistory(model, { type: "node-split", nodeKey: nodeKey });
      return { model: model, newKey: k, caret: { nodeKey: k, offset: 0 } };
    }
    var t = nodeText(node);
    offset = Math.max(0, Math.min(offset | 0, t.length));
    setNodeText(node, t.slice(0, offset));
    model.nodes.splice(idx + 1, 0, { type: "paragraph", key: k, text: t.slice(offset) });
    (model.marks || []).forEach(function (m) {
      if (isObjectMark(m)) return;
      if (isMultiBlock(m)) {
        // an endpoint on the split node rides the split; interior nodes stay covered (order-derived)
        if (m.anchor.nodeKey === nodeKey && m.anchor.start >= offset) { m.anchor.nodeKey = k; m.anchor.start -= offset; }
        if (m.endAnchor.nodeKey === nodeKey && (m.endAnchor.len || 0) > offset) { m.endAnchor.nodeKey = k; m.endAnchor.len = (m.endAnchor.len || 0) - offset; }
        refreshMark(model, m);
        return;
      }
      if (m.anchor.nodeKey !== nodeKey) return;
      var s = m.anchor.start, e = s + (m.anchor.len || 0);
      if (e <= offset) { /* entirely before -> unchanged */ }
      else if (s >= offset) { m.anchor.nodeKey = k; m.anchor.start = s - offset; } // entirely after -> new node
      else { // straddles -> a two-block mark: head [s, offset) + tail [0, e-offset) on the new node
        m.anchor = { nodeKey: nodeKey, start: s, len: offset - s };
        m.endAnchor = { nodeKey: k, start: 0, len: e - offset };
      }
      refreshMark(model, m);
    });
    logHistory(model, { type: "node-split", nodeKey: nodeKey });
    return { model: model, newKey: k, caret: { nodeKey: k, offset: 0 } };
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
  // ---- objects: image/table as first-class markable nodes (spec 6) ----------
  // Which node types are annotatable AS A WHOLE OBJECT (a node-id mark, no text span). v1 = the
  // nodes with no editable text region of their own -- an image or a table. Callouts/lists carry
  // editable text, so text-span marks cover them; object selection would fight click-into-edit.
  function isMarkableObjectNode(node) { return !!node && (node.type === "image" || node.type === "table"); }
  // The object alternates on a node (the object twin of alternatesFor -- keyed by node id only).
  function objectAlternatesFor(model, nodeKey) {
    return (model.marks || []).filter(function (m) {
      return m.type === "alternate" && isObjectMark(m) && m.anchor.nodeKey === nodeKey;
    });
  }
  // Where-used (spec 3.1): the destinations a LINK mark points at, normalised into breadcrumb
  // rows {doc, section, location, docCode, blockId}. Source only DISPLAYS these; the Edit stage is
  // what populates mark.locations (a course pins to this span/alternate). Tolerant of missing
  // fields so a partial location still renders a crumb. Returns [] for a non-link or unlinked mark.
  function whereUsedForMark(mark) {
    if (!mark || mark.type !== "link") return [];
    return (mark.locations || []).map(function (loc) {
      loc = loc || {};
      return {
        doc: loc.docTitle || loc.docCode || "Document",
        section: loc.sectionTitle || loc.section || null,
        location: loc.locationLabel || loc.location || null,
        docCode: loc.docCode || null,
        blockId: loc.blockId || null
      };
    });
  }
  // ---- variants: per-node divergence (spec 4) -------------------------------
  // Variants are a TOP-LEVEL structural layer, orthogonal to marks. A node carries three
  // divergence types against the base (Flagship): SHARED (no override -> every variant shows the
  // base), DIVERGED WORDING (node.variants[v] = {text}), and PRESENCE/ABSENCE (node.variants[v] =
  // {absent:true} removes it from v; node.baseAbsent = true means it's ADDED-ONLY -- not in
  // Flagship, present only for the variants that override it). Persistence is automatic: nodes are
  // deep-cloned in toJSON/fromJSON, so `variants` + `baseAbsent` ride along with no schema change.
  var FLAGSHIP = "Flagship";
  function isFlagship(variant) { return !variant || variant === FLAGSHIP; }
  // Resolve a node for ONE variant column -> { present, text, diverged, source }. source is one of
  // "flagship" | "override" | "inherited" | "absent". `diverged` = the wording differs from the
  // Flagship base (a real split, not an add-only or an inherit).
  function nodeForVariant(node, variant) {
    if (!node) return { present: false, text: "", diverged: false, source: "absent" };
    var base = nodeText(node);
    var ov = node.variants && node.variants[variant];
    if (isFlagship(variant)) {
      if (node.baseAbsent) return { present: false, text: "", diverged: false, source: "absent" };
      return { present: true, text: base, diverged: false, source: "flagship" };
    }
    if (ov) {
      if (ov.absent) return { present: false, text: "", diverged: false, source: "absent" };
      if (ov.text != null) return { present: true, text: ov.text, diverged: !node.baseAbsent && ov.text !== base, source: "override" };
    }
    if (node.baseAbsent) return { present: false, text: "", diverged: false, source: "absent" }; // added-only: only overriding variants show it
    return { present: true, text: base, diverged: false, source: "inherited" };
  }
  // Group the shown variants into columns for rendering. mode "shared" when every shown variant
  // resolves to the SAME present+text (single column); else "split" (one column per shown variant,
  // each carrying its own present/text/source so the UI can draw diverged text or an absent state).
  function variantView(node, shownVariants) {
    var shown = (shownVariants && shownVariants.length) ? shownVariants.slice() : [FLAGSHIP];
    var cols = shown.map(function (v) {
      var r = nodeForVariant(node, v);
      return { variant: v, present: r.present, text: r.text, diverged: r.diverged, source: r.source };
    });
    var first = cols[0];
    var allSame = cols.every(function (c) { return c.present === first.present && c.text === first.text; });
    if (allSame && first.present) return { mode: "shared", text: first.text, cols: cols };
    return { mode: "split", cols: cols };
  }
  // B2: the image twin of nodeForVariant -> { present, src, alt, caption, source }. Mirrors the
  // presence/absence rules (absent / baseAbsent) but resolves src/alt/caption: a variant with its
  // own src overrides ("override"); otherwise it inherits the Flagship image ("inherited"). This is
  // how a variant can carry a different picture (info is often locked inside an image).
  function imageForVariant(node, variant) {
    var bSrc = node && node.src, bAlt = node && node.alt, bCap = node && node.caption;
    var ov = node && node.variants && node.variants[variant];
    if (isFlagship(variant)) {
      if (node.baseAbsent) return { present: false, src: null, alt: null, caption: null, source: "absent" };
      return { present: true, src: bSrc, alt: bAlt, caption: bCap, source: "flagship" };
    }
    if (ov) {
      if (ov.absent) return { present: false, src: null, alt: null, caption: null, source: "absent" };
      if (ov.src != null) return { present: true, src: ov.src, alt: ov.alt != null ? ov.alt : bAlt, caption: ov.caption != null ? ov.caption : bCap, source: "override" };
    }
    if (node.baseAbsent) return { present: false, src: null, alt: null, caption: null, source: "absent" };
    return { present: true, src: bSrc, alt: bAlt, caption: bCap, source: "inherited" };
  }
  // B2: give a variant its own image src (and optionally alt/caption). Flagship writes the base
  // image; a named variant writes an override (and clears any absent flag). Pushes undo. Presence/
  // absence reuse removeNodeFromVariant / restoreNodeToVariant, which already generalise to any node.
  function setVariantImage(model, nodeKey, variant, src, opts) {
    var node = nodeByKey(model, nodeKey); if (!node || node.type !== "image") return null;
    opts = opts || {};
    pushUndo(model);
    if (isFlagship(variant)) {
      node.src = src;
      if ("alt" in opts) node.alt = opts.alt;
      if ("caption" in opts) node.caption = opts.caption;
      node.baseAbsent = false;
    } else {
      var ov = ensureVariants(node)[variant] || {};
      ov.src = src;
      if ("alt" in opts) ov.alt = opts.alt;
      if ("caption" in opts) ov.caption = opts.caption;
      delete ov.absent;
      ensureVariants(node)[variant] = ov;
    }
    return node;
  }
  function ensureVariants(node) { if (!node.variants) node.variants = {}; return node.variants; }
  // Diverge (or set) a variant's wording. Flagship writes the base text; a named variant writes an
  // override. Pushes undo. This is divergence type 2 (diverged wording).
  function setVariantText(model, nodeKey, variant, text) {
    var node = nodeByKey(model, nodeKey); if (!node) return null;
    pushUndo(model);
    if (isFlagship(variant)) { setNodeText(node, text); node.baseAbsent = false; }
    else ensureVariants(node)[variant] = { text: text };
    return node;
  }
  // Remove the node from a variant (presence/absence, type 3). Flagship removal sets baseAbsent
  // (the node becomes added-only for whichever variants still override it). Pushes undo.
  function removeNodeFromVariant(model, nodeKey, variant) {
    var node = nodeByKey(model, nodeKey); if (!node) return null;
    pushUndo(model);
    if (isFlagship(variant)) node.baseAbsent = true;
    else ensureVariants(node)[variant] = { absent: true };
    return node;
  }
  // Restore the node to a variant: clear its absent/override so it inherits the base again (or, for
  // Flagship, re-present it). The inverse of removeNodeFromVariant / setVariantText. Pushes undo.
  function restoreNodeToVariant(model, nodeKey, variant) {
    var node = nodeByKey(model, nodeKey); if (!node) return null;
    pushUndo(model);
    if (isFlagship(variant)) node.baseAbsent = false;
    else if (node.variants) delete node.variants[variant];
    return node;
  }
  // Every variant key referenced anywhere in the doc (so the UI can offer columns even before the
  // product's declared-variant list is wired). Sorted, unique, Flagship excluded (it's the base).
  function variantsInDoc(model) {
    var set = {};
    (model.nodes || []).forEach(function (n) { if (n.variants) Object.keys(n.variants).forEach(function (v) { if (!isFlagship(v)) set[v] = true; }); });
    return Object.keys(set).sort();
  }
  // A short human label for an object node -- the "base" line an object mark's panel/drawer shows
  // in place of the span text a text mark would carry.
  function objectNodeLabel(node) {
    if (!node) return "Object";
    if (node.type === "image") return node.caption ? ("Image — " + node.caption) : (node.alt ? ("Image — " + node.alt) : "Image");
    if (node.type === "table") return "Table (" + ((node.rows && node.rows.length) || 0) + " rows)";
    if (node.type === "callout") return node.tag ? ("Callout — " + node.tag) : "Callout";
    if (node.type === "list") return "List (" + ((node.items && node.items.length) || 0) + " items)";
    return node.type ? (node.type.charAt(0).toUpperCase() + node.type.slice(1)) : "Object";
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
    // A new endAnchor re-spans the mark; its absence PRESERVES any existing one (the "reviewed"
    // re-baseline passes only the first-node anchor of a multi-block mark and must keep its span).
    if (anchor.endAnchor && anchor.endAnchor.nodeKey && anchor.endAnchor.nodeKey !== anchor.nodeKey) {
      m.endAnchor = { nodeKey: anchor.endAnchor.nodeKey, start: 0, len: anchor.endAnchor.len || 0 };
    }
    m.baseText = markText(model, m);
    m.stale = false; m.broken = false;
    logHistory(model, { type: "mark-updated", markId: m.id, markType: m.type });
    return m;
  }
  // Find the text mark (if any) that the given selection anchor EXTENDS -- i.e. the selection
  // fully contains the mark's span in the same node and is strictly longer. Drives whether the
  // selection toolbar shows "create" or flips to "⟳ update <existing>".
  function markExtendedBy(model, anchor) {
    if (!anchor || anchor.len == null || anchor.endAnchor) return null; // ⟳ update is single-block only
    var selEnd = anchor.start + anchor.len;
    var found = null;
    (model.marks || []).forEach(function (m) {
      if (isObjectMark(m) || isMultiBlock(m) || m.broken || m.anchor.nodeKey !== anchor.nodeKey) return;
      var mEnd = m.anchor.start + m.anchor.len;
      if (anchor.start <= m.anchor.start && selEnd >= mEnd && anchor.len > m.anchor.len) {
        if (!found || m.anchor.len > found.anchor.len) found = m; // prefer the largest contained mark
      }
    });
    return found;
  }
  // Pure visibility decision for the Source contextual selbar. Given the current selection anchor
  // (null when there is no usable selection), the mark this selection extends (from markExtendedBy,
  // single-block only), and whether the source is unlocked, decide which affordances the bar shows.
  // No DOM, no positioning -- the caller still does the rect check + placement. Kept pure so the
  // rule "a multi-paragraph selection still offers comment + alternate" is regression-guarded.
  function selbarDecision(anchor, updateTarget, unlocked) {
    if (!anchor) return { showBar: false, showRT: false, showUpdate: false, showAlt: false, showComment: false };
    var upd = !!updateTarget; // extending an existing single-block mark -> offer update instead of create
    return { showBar: true, showRT: !!unlocked, showUpdate: upd, showAlt: !upd, showComment: !upd };
  }
  // Marks whose span overlaps a given range in a node (for hit-testing a click/selection).
  // source-link 09: which linked LOCATIONS a base-edit session changed. A link mark counts as
  // "edited" when its current covered text differs from the wording snapshotted before the edit
  // session (oldTextByMark[markId]); an edited mark's locations that show BASE (no altId) are
  // affected (they'll change under the edit), alternate-pinned ones are not. Pure -> the editor
  // supplies the pre-edit snapshot + the where-used locations; this decides the blast radius.
  //   oldTextByMark: { markId: "<wording before the edit>" }
  //   locations:     [{ markId, altId, docCode, blockId, kind }]
  //   -> { affected:[base-showing, edited], pinned:[alt-pinned, edited], editedMarks:[markId] }
  function sourceEditImpact(model, oldTextByMark, locations) {
    var edited = {};
    (model.marks || []).forEach(function (m) {
      if (m.type !== "link") return;
      var old = oldTextByMark ? oldTextByMark[m.id] : undefined;
      if (old != null && old !== markText(model, m)) edited[m.id] = true;
    });
    var affected = [], pinned = [];
    (locations || []).forEach(function (loc) {
      if (!edited[loc.markId]) return;
      if (loc.altId) pinned.push(loc); else affected.push(loc);
    });
    return { affected: affected, pinned: pinned, editedMarks: Object.keys(edited) };
  }
  function marksOverlapping(model, nodeKey, start, len) {
    var end = start + len;
    return (model.marks || []).filter(function (m) {
      if (isObjectMark(m)) return m.anchor.nodeKey === nodeKey;
      if (isMultiBlock(m)) {
        return markSpans(model, m).some(function (s) {
          return s.nodeKey === nodeKey && s.start < end && (s.start + s.len) > start;
        });
      }
      if (m.anchor.nodeKey !== nodeKey) return false;
      var mEnd = m.anchor.start + m.anchor.len;
      return m.anchor.start < end && mEnd > start; // strict overlap
    });
  }
  function logHistory(model, entry) {
    model.history = model.history || [];
    // Stamp a wall-clock time so the timeline can interleave these events with the
    // import events (which carry importedAt); insertion order still breaks ties.
    if (entry && entry.at == null) entry.at = Date.now();
    model.history.unshift(entry);
    return entry;
  }

  // ---- history: pure collapse + view mapping (spec 5) -----------------------
  // Collapse a stream of per-keystroke edit deltas (each { inserted, removed } from
  // applyTextEdit's diff) into one commit summary. This is the hybrid-granularity core:
  // ordinary prose edits fold into a single commit entry rather than one entry each.
  function summarizeEdits(edits) {
    var added = 0, removed = 0, count = 0;
    (edits || []).forEach(function (e) {
      if (!e) return;
      var ins = e.inserted || 0, rem = e.removed || 0;
      if (ins === 0 && rem === 0) return; // a no-op keystroke (arrow key etc.) doesn't count
      added += ins; removed += rem; count++;
    });
    return { charsAdded: added, charsRemoved: removed, editCount: count };
  }
  // Map one history entry to its display view { kind, label, detail }. Pure so the timeline
  // rendering is headlessly testable and the copy lives in one place. A commit collapses a
  // prose session; every other type is a discrete structural event.
  function historyEntryView(entry) {
    entry = entry || {};
    var typeLabel = { link: "Link", alternate: "Alternate", comment: "Comment" }[entry.markType] || "Mark";
    switch (entry.type) {
      case "commit": {
        var bits = [];
        if (entry.charsAdded) bits.push("+" + entry.charsAdded);
        if (entry.charsRemoved) bits.push("−" + entry.charsRemoved); // U+2212 minus
        var detail = bits.length ? bits.join(" / ") + " chars" : "no net change";
        if (entry.note) detail += " — “" + entry.note + "”";
        return { kind: "commit", label: "Edited source", detail: detail };
      }
      case "mark-broken": return { kind: "structural", label: typeLabel + " broke", detail: "the anchored text was deleted" };
      case "mark-stale": return { kind: "structural", label: "Alternate went stale", detail: "the base changed since it was written" };
      case "mark-restored": return { kind: "structural", label: typeLabel + " restored", detail: "back in sync with the base" };
      case "mark-updated": return { kind: "structural", label: typeLabel + " updated", detail: "extended to include appended text" };
      case "alternate-created": return { kind: "structural", label: "Alternate added", detail: entry.tag ? "for " + entry.tag : null };
      case "comment-added": return { kind: "structural", label: "Comment opened", detail: null };
      case "comment-resolved": return { kind: "structural", label: "Comment resolved", detail: null };
      case "comment-reopened": return { kind: "structural", label: "Comment reopened", detail: null };
      // uio-S-C04 (SRC-11): raw edit-op types read as author words, not model vocabulary.
      case "range-replaced": return { kind: "structural", label: "Edited text", detail: null };
      case "node-split": return { kind: "structural", label: "Paragraph split", detail: null };
      case "node-reformat": return { kind: "structural", label: "Reformatted", detail: null };
      default: return { kind: "structural", label: "Edited source", detail: null };
    }
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
  // Parse plain text into source-doc nodes. Handles unordered ("- ") AND ordered ("1. ") lists;
  // switching marker style flushes the current list into a separate node (mirrors markdown-lite's
  // ORDERED_RE, carried over -- the continuous-doc rewrite had dropped the ordered branch, so
  // numbered lines collapsed into one paragraph).
  var ORDERED_ITEM_RE = /^(\d+)\.\s+(.*)$/;
  var UNORDERED_ITEM_RE = /^[-*+]\s+(.*)$/;
  // A Markdown table separator row: pipes, dashes, colons and spaces, with at least one dash.
  var TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
  function isTableSeparator(line) { return TABLE_SEP_RE.test(line) && line.indexOf("-") !== -1; }
  function looksLikeTableRow(line) { return line.indexOf("|") !== -1; }
  // A standalone thematic break: three or more of -, *, or _ on their own line (optionally spaced),
  // NOT a table separator (those carry pipes / a preceding table row). Markdown renders it as a
  // horizontal rule; source-doc has no rule node, so on import we drop it rather than leak "---" as
  // literal body text (#162).
  var THEMATIC_BREAK_RE = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/;
  function isThematicBreak(line) { return THEMATIC_BREAK_RE.test(line) && line.indexOf("|") === -1; }
  // A converted-PDF/manual cell often carries a literal <br> for its internal line breaks; fold it to
  // a space so it reads as one cell instead of showing the tag verbatim (#162).
  function foldCellBreaks(s) { return String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " ").replace(/\s{2,}/g, " ").trim(); }
  // Split one table row into trimmed cells. Tolerates optional leading/trailing pipes and honours a
  // backslash-escaped pipe (the mdCell export escapes "|" as "\|", so import must unescape it).
  function splitTableRow(line) {
    var s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    var cells = [], cur = "";
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (s[i] === "|") { cells.push(foldCellBreaks(cur)); cur = ""; continue; }
      cur += s[i];
    }
    cells.push(foldCellBreaks(cur));
    return cells;
  }
  // Parse inline Markdown (**bold** / __bold__ / *italic* / _italic_ / `code`) out of a raw string
  // into PLAIN text + format runs [{start,len,style}] over that plain text. The model text stays
  // plain, so a mark's character offset means the same in the model and the rendered DOM (the render
  // wraps runs in transparent <strong>/<em>/<code>, which the text-walking mark engine sees through).
  // Underscore emphasis only fires at a word boundary so snake_case identifiers are left literal;
  // unmatched markers and backslash-escaped markers stay literal. Non-nesting (a bold span's inner
  // text is taken literally) -- enough for real imported manuals, and it never produces overlaps.
  function parseInline(raw) {
    raw = String(raw == null ? "" : raw);
    var out = "", runs = [], i = 0, n = raw.length;
    function boundaryOK(idx) { return idx === 0 || /\s/.test(raw[idx - 1]) || /[([{"'>]/.test(raw[idx - 1]); }
    while (i < n) {
      var ch = raw[i], nx = raw[i + 1];
      if (ch === "\\" && i + 1 < n && "*_`\\".indexOf(nx) !== -1) { out += nx; i += 2; continue; }
      if (ch === "`") { var c = raw.indexOf("`", i + 1); if (c > i + 1 || (c === i + 1)) { if (c > i) { var s0 = out.length; out += raw.slice(i + 1, c); runs.push({ start: s0, len: out.length - s0, style: "code" }); i = c + 1; continue; } } }
      if ((ch === "*" || ch === "_") && nx === ch) {
        if (ch === "*" || boundaryOK(i)) {
          var mk = ch + ch, e = raw.indexOf(mk, i + 2);
          if (e > i + 1 && raw.slice(i + 2, e).trim()) { var s1 = out.length; out += raw.slice(i + 2, e); runs.push({ start: s1, len: out.length - s1, style: "bold" }); i = e + 2; continue; }
        }
      }
      if (ch === "*" || ch === "_") {
        if (ch === "*" || boundaryOK(i)) {
          var e2 = raw.indexOf(ch, i + 1);
          if (e2 > i + 1 && raw.slice(i + 1, e2).trim() && raw[i + 1] !== ch) { var s2 = out.length; out += raw.slice(i + 1, e2); runs.push({ start: s2, len: out.length - s2, style: "italic" }); i = e2 + 1; continue; }
        }
      }
      out += ch; i++;
    }
    return { text: out, formats: runs };
  }
  // Build a paragraph node from raw text, lifting inline formatting into a formats[] run list (only
  // set when there is formatting, so plain paragraphs stay clean).
  function inlineNode(type, raw, extra) {
    var p = parseInline(raw), node = extra || {};
    node.type = type; node.text = p.text;
    if (p.formats.length) node.formats = p.formats;
    return node;
  }
  function blocksFromText(text) {
    // Strip HTML comments first (page markers like "<!-- Page 43 -->" from converted PDFs, and any
    // multi-line comment) so they never surface as body text.
    var clean = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
    var lines = clean.split("\n");
    var nodes = [], para = [], list = [], listFmts = [], listOrdered = false, listStart = 1;
    function flushP() { if (para.length) { nodes.push(inlineNode("paragraph", para.join(" "))); para = []; } }
    function flushL() {
      if (!list.length) return;
      var node = { type: "list", ordered: listOrdered, items: list.slice() };
      if (listFmts.some(function (f) { return f && f.length; })) node.itemFormats = listFmts.slice();
      if (listOrdered && listStart !== 1) node.start = listStart; // a list starting at N renders <ol start="N">
      nodes.push(node); list = []; listFmts = [];
    }
    function pushItem(raw) { var p = parseInline(raw); list.push(p.text); listFmts.push(p.formats.length ? p.formats : null); }
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      // A Markdown pipe table: a row line immediately followed by a separator row. Collect the header
      // + every following pipe row into a real table node (rows of inline-formatted cells).
      if (looksLikeTableRow(line) && li + 1 < lines.length && isTableSeparator(lines[li + 1]) && !isTableSeparator(line)) {
        flushP(); flushL();
        var rows = [splitTableRow(line)]; li += 2; // skip the separator row
        while (li < lines.length && looksLikeTableRow(lines[li]) && lines[li].trim() !== "" && !isTableSeparator(lines[li])) { rows.push(splitTableRow(lines[li])); li++; }
        li--; // the outer loop will ++ past the last consumed row
        var cellFormats = rows.map(function (r) { return r.map(function (c) { var p = parseInline(c); return p.formats.length ? p.formats : null; }); });
        var plainRows = rows.map(function (r) { return r.map(function (c) { return parseInline(c).text; }); });
        var tnode = { type: "table", rows: plainRows };
        if (cellFormats.some(function (r) { return r.some(Boolean); })) tnode.cellFormats = cellFormats;
        nodes.push(tnode);
        continue;
      }
      // A standalone thematic break (---, ***, ___) closes any open block and is dropped, so it
      // never surfaces as a literal "---" paragraph (#162). Checked before the list rules -- a rule
      // is never a list item (no "- " + content), so the order is safe.
      if (isThematicBreak(line)) { flushP(); flushL(); continue; }
      var b = UNORDERED_ITEM_RE.exec(line);
      var o = b ? null : ORDERED_ITEM_RE.exec(line);
      if (b) {
        if (list.length && listOrdered) flushL(); // switching ordered -> unordered starts a new list
        flushP(); listOrdered = false; pushItem(b[1]);
      } else if (o) {
        if (list.length && !listOrdered) flushL(); // switching unordered -> ordered starts a new list
        flushP();
        if (!list.length) { listOrdered = true; listStart = parseInt(o[1], 10) || 1; }
        pushItem(o[2]);
      } else if (line.trim() === "") { flushP(); flushL(); }
      else { flushL(); para.push(line.trim()); }
    }
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

  // ---- source v2: unify a Product's topic docs into ONE continuous document --
  // Concatenate several chapter docs into ONE continuous model (spec 2c section 1). Each
  // chapter contributes a level-1 heading node (its name, stamped chapter:true) followed by
  // that chapter's nodes, deep-copied so the source docs are never mutated. A node key is
  // preserved when it is still free and re-keyed only on collision (the cousin of the
  // reconcile-rekey machinery); every reference that rides a key -- a text mark's
  // anchor.nodeKey and a history entry's markId -- is rewritten through the same remap, so
  // marks, per-node variants (which travel ON the node, deep-cloned) and provenance all
  // survive the merge. Minted keys skip any key already present, so a preserved key can never
  // be handed out again. Pure + DOM-free -> headlessly testable.
  function concatChapters(chapters) {
    var out = makeModel();
    function freshNodeKey() { var k; do { k = nextId(out, "n"); } while (nodeByKey(out, k)); return k; }
    function freshMarkId() { var k; do { k = nextId(out, "m"); } while (markById(out, k)); return k; }
    (chapters || []).forEach(function (ch) {
      var name = (ch && ch.name != null && String(ch.name).trim()) ? String(ch.name) : "Untitled";
      out.nodes.push({ type: "heading", level: 1, text: name, key: freshNodeKey(), chapter: true });
      var src = fromJSON(ch && ch.model ? toJSON(ch.model) : null); // independent deep copy, keys ensured
      var nodeRemap = {}, markRemap = {};
      (src.nodes || []).forEach(function (n) {
        var oldKey = n.key;
        var newKey = (oldKey && !nodeByKey(out, oldKey)) ? oldKey : freshNodeKey();
        if (oldKey != null) nodeRemap[oldKey] = newKey;
        n.key = newKey;
        out.nodes.push(n);
      });
      (src.marks || []).forEach(function (m) {
        var oldId = m.id;
        var newId = (oldId && !markById(out, oldId)) ? oldId : freshMarkId();
        if (oldId != null) markRemap[oldId] = newId;
        m.id = newId;
        if (m.anchor && m.anchor.nodeKey != null && nodeRemap.hasOwnProperty(m.anchor.nodeKey)) m.anchor.nodeKey = nodeRemap[m.anchor.nodeKey];
        out.marks.push(m);
      });
      (src.history || []).forEach(function (h) {
        if (h && h.markId != null && markRemap.hasOwnProperty(h.markId)) h.markId = markRemap[h.markId];
        out.history.push(h);
      });
    });
    return out;
  }
  // The chapter (level-1 / chapter:true) headings of a unified doc, in document order, each with
  // the index of its heading node -> the outline the unified TOC and chapter-reorder build on.
  function chapters(model) {
    var out = [];
    (model && model.nodes || []).forEach(function (n, i) {
      if (n.type === "heading" && (n.chapter === true || (n.level || 2) === 1)) out.push({ key: n.key, text: nodeText(n), index: i });
    });
    return out;
  }
  function isChapterNode(n) { return !!n && n.type === "heading" && (n.chapter === true || (n.level || 2) === 1); }
  // The nested outline the unified TOC renders: chapters (level-1) each carrying their child
  // headings (level 2/3), in document order. A heading before the first chapter (rare) nests at
  // the top level with no children. Pure -> the TOC tree is testable without the DOM.
  function outline(model) {
    var out = [], cur = null;
    (model && model.nodes || []).forEach(function (n) {
      if (n.type !== "heading") return;
      if (isChapterNode(n)) { cur = { key: n.key, text: nodeText(n), level: 1, children: [] }; out.push(cur); }
      else { var item = { key: n.key, text: nodeText(n), level: n.level || 2 }; if (cur) cur.children.push(item); else out.push({ key: n.key, text: nodeText(n), level: n.level || 2, children: [] }); }
    });
    return out;
  }
  // The contiguous node span each chapter owns: its level-1 heading through the node just before
  // the next chapter heading (or end of doc). Nodes before the first chapter heading (there
  // shouldn't be any in a migrated doc) form a leading "" block that never moves.
  function chapterBlocks(model) {
    var ns = (model && model.nodes) || [], blocks = [], cur = null;
    ns.forEach(function (n, i) {
      if (isChapterNode(n)) { if (cur) blocks.push(cur); cur = { key: n.key, text: nodeText(n), start: i, end: i + 1 }; }
      else if (cur) { cur.end = i + 1; }
      else {
        // leading nodes before the first chapter heading (rare) share one key:null block that stays put
        if (!blocks.length) blocks.push({ key: null, text: "", start: 0, end: 1 }); else blocks[0].end = i + 1;
      }
    });
    if (cur) blocks.push(cur);
    return blocks;
  }
  // Move a whole chapter block (heading + its nodes) so it lands immediately before the chapter
  // keyed refKey, or at the end when refKey is null. Pure array splice on model.nodes -- node
  // keys, marks (anchored by key) and variants (on the node) all ride along untouched. Pushes
  // undo. Returns true when the order actually changed.
  function moveChapter(model, chapterKey, refKey) {
    if (!model || chapterKey === refKey) return false;
    var blocks = chapterBlocks(model);
    var from = null, before = null;
    blocks.forEach(function (b) { if (b.key === chapterKey) from = b; if (b.key === refKey) before = b; });
    if (!from || (refKey != null && !before)) return false;
    var moving = model.nodes.slice(from.start, from.end);
    if (!moving.length) return false;
    pushUndo(model);
    var rest = model.nodes.slice(0, from.start).concat(model.nodes.slice(from.end));
    // recompute the insert point in `rest` (indices shift once `moving` is pulled out)
    var at = rest.length;
    if (refKey != null) { for (var i = 0; i < rest.length; i++) { if (rest[i].key === refKey) { at = i; break; } } }
    model.nodes = rest.slice(0, at).concat(moving, rest.slice(at));
    return true;
  }

  // ---- source v2: additive Markdown import with a reconcile preview (md-import-additive) -----
  // Import is CHAPTER-scoped and non-destructive (spec 2c section 4): an incoming file becomes one
  // or more chapters that either ADD (a name not already in the doc) or UPDATE an existing chapter.
  // An update is a node-level reconcile -- unchanged nodes keep their key (so their marks + variants
  // survive), changed/removed nodes drop, new nodes insert -- computed by an LCS over node text so
  // the author can preview exactly what add/change/remove will happen BEFORE it is applied.
  function normChapterName(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  // LCS reconcile of one chapter's body: returns the merged node sequence (old nodes reused where
  // the text still matches, new nodes inserted where added) + the add/remove/keep counts.
  function nodeReconcile(oldNodes, newNodes) {
    var a = oldNodes || [], b = newNodes || [], m = a.length, n = b.length;
    var dp = []; for (var x = 0; x <= m; x++) { dp.push(new Array(n + 1).fill(0)); }
    for (var i = m - 1; i >= 0; i--) for (var j = n - 1; j >= 0; j--) {
      dp[i][j] = (nodeText(a[i]) === nodeText(b[j])) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    var p = 0, q = 0, result = [], added = 0, removed = 0, kept = 0;
    while (p < m && q < n) {
      if (nodeText(a[p]) === nodeText(b[q])) { result.push({ node: a[p], isNew: false }); kept++; p++; q++; }
      else if (dp[p + 1][q] >= dp[p][q + 1]) { removed++; p++; }
      else { result.push({ node: b[q], isNew: true }); added++; q++; }
    }
    while (q < n) { result.push({ node: b[q], isNew: true }); added++; q++; }
    while (p < m) { removed++; p++; }
    return { result: result, added: added, removed: removed, kept: kept };
  }
  // Build the preview PLAN for importing `incoming` chapters ([{name, nodes}]) into `model`. Each
  // incoming chapter is matched to an existing chapter by name; a miss is an "add", a hit is an
  // "update" carrying its node reconcile. Pure -- no mutation; the plan is what the preview shows.
  function importPlan(model, incoming) {
    var blocks = chapterBlocks(model), byName = {};
    blocks.forEach(function (b) { if (b.key != null) byName[normChapterName(b.text)] = b; });
    var ops = [], summary = { chaptersAdded: 0, chaptersUpdated: 0, nodesAdded: 0, nodesRemoved: 0, nodesKept: 0 };
    (incoming || []).forEach(function (ch) {
      var name = (ch && ch.name != null && String(ch.name).trim()) ? String(ch.name) : "Untitled";
      var match = byName[normChapterName(name)];
      if (!match) {
        var nodes = (ch.nodes || []);
        ops.push({ type: "add", name: name, nodes: nodes });
        summary.chaptersAdded++; summary.nodesAdded += nodes.length;
      } else {
        var body = model.nodes.slice(match.start + 1, match.end); // chapter body, excluding its heading
        var rec = nodeReconcile(body, ch.nodes || []);
        ops.push({ type: "update", chapterKey: match.key, name: name, result: rec.result, added: rec.added, removed: rec.removed, kept: rec.kept });
        summary.chaptersUpdated++; summary.nodesAdded += rec.added; summary.nodesRemoved += rec.removed; summary.nodesKept += rec.kept;
      }
    });
    return { ops: ops, summary: summary };
  }
  // Apply a plan built by importPlan. Adds append a new chapter (fresh keys); updates rebuild the
  // matched chapter's body in place, keeping the reused nodes' keys (marks + variants ride along)
  // and minting fresh keys only for inserted nodes. Pushes ONE undo (the whole import is reversible).
  function applyImportPlan(model, plan) {
    if (!model || !plan) return model;
    pushUndo(model);
    function freshKey() { var k; do { k = nextId(model, "n"); } while (nodeByKey(model, k)); return k; }
    (plan.ops || []).forEach(function (op) {
      if (op.type === "add") {
        model.nodes.push({ type: "heading", level: 1, chapter: true, text: op.name, key: freshKey() });
        (op.nodes || []).forEach(function (n) { var c = clone(n); c.key = freshKey(); model.nodes.push(c); });
      } else {
        var blocks = chapterBlocks(model), blk = null;
        blocks.forEach(function (b) { if (b.key === op.chapterKey) blk = b; });
        if (!blk) return;
        var newBody = (op.result || []).map(function (r) { if (r.isNew) { var c = clone(r.node); c.key = freshKey(); return c; } return r.node; });
        model.nodes = model.nodes.slice(0, blk.start + 1).concat(newBody, model.nodes.slice(blk.end));
      }
    });
    return model;
  }

  // ---- source v2: cross-variant manual combine/import (variant-combine-import, spec 2d) ------
  // A variant's manual is imported into the SAME document as an OVERLAY on the Flagship base -- the
  // base is never rewritten (that is what the flagship importPlan does). Within a name-matched
  // chapter, align the incoming variant nodes to the Flagship body: an LCS by text gives the SHARED
  // anchors (variant inherits the base), and the runs between anchors pair positionally -- each
  // paired (base, incoming) is a DIVERGED wording, a leftover base node is ABSENT in the variant,
  // and a leftover incoming node is ADDED-ONLY. A whole chapter only the variant has is an
  // added-only chapter. Pure + DOM-free -> headlessly testable like importPlan.
  function variantAlign(baseNodes, incoming) {
    var a = baseNodes || [], b = incoming || [], m = a.length, n = b.length;
    var dp = []; for (var x = 0; x <= m; x++) { dp.push(new Array(n + 1).fill(0)); }
    for (var i = m - 1; i >= 0; i--) for (var j = n - 1; j >= 0; j--) {
      dp[i][j] = (nodeText(a[i]) === nodeText(b[j])) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    var p = 0, q = 0, pairs = [], absent = [], added = [], runBase = [], runIn = [];
    function flushRun() {
      var k = Math.min(runBase.length, runIn.length), t;
      for (t = 0; t < k; t++) pairs.push({ base: runBase[t], incoming: runIn[t], kind: "diverged" });
      for (t = k; t < runBase.length; t++) absent.push(runBase[t]);
      for (t = k; t < runIn.length; t++) added.push(runIn[t]);
      runBase = []; runIn = [];
    }
    while (p < m && q < n) {
      if (nodeText(a[p]) === nodeText(b[q])) { flushRun(); pairs.push({ base: a[p], incoming: b[q], kind: "shared" }); p++; q++; }
      else if (dp[p + 1][q] >= dp[p][q + 1]) { runBase.push(a[p]); p++; }
      else { runIn.push(b[q]); q++; }
    }
    while (p < m) { runBase.push(a[p]); p++; }
    while (q < n) { runIn.push(b[q]); q++; }
    flushRun();
    return { pairs: pairs, absent: absent, added: added };
  }
  // Build the preview PLAN for combining `incoming` chapters into `model` AS a named `variant`. The
  // Flagship base is read-only here; the plan is a set of per-node overrides. Non-destructive: a
  // SHARED match emits no op (the variant just inherits) -- import only ever ADDS divergence, so it
  // never silently un-diverges a hand edit. Pure -- no mutation. Returns null for Flagship (use
  // importPlan for the base).
  function variantImportPlan(model, variant, incoming) {
    if (isFlagship(variant)) return null;
    var blocks = chapterBlocks(model), byName = {};
    blocks.forEach(function (b) { if (b.key != null) byName[normChapterName(b.text)] = b; });
    var ops = [], summary = { variant: variant, chaptersMatched: 0, chaptersAdded: 0, shared: 0, diverged: 0, absent: 0, added: 0 };
    (incoming || []).forEach(function (ch) {
      var name = (ch && ch.name != null && String(ch.name).trim()) ? String(ch.name) : "Untitled";
      var match = byName[normChapterName(name)];
      if (!match) {
        ops.push({ type: "add-chapter", name: name, nodes: (ch.nodes || []) });
        summary.chaptersAdded++; summary.added += (ch.nodes || []).length;
        return;
      }
      summary.chaptersMatched++;
      var body = model.nodes.slice(match.start + 1, match.end);
      var al = variantAlign(body, ch.nodes || []);
      al.pairs.forEach(function (pr) {
        if (pr.kind === "shared") { summary.shared++; return; }
        ops.push({ type: "diverge", nodeKey: pr.base.key, name: name, text: nodeText(pr.incoming), from: nodeText(pr.base) });
        summary.diverged++;
      });
      al.absent.forEach(function (bn) { ops.push({ type: "absent", nodeKey: bn.key, name: name, from: nodeText(bn) }); summary.absent++; });
      al.added.forEach(function (inn) { ops.push({ type: "add-node", chapterKey: match.key, name: name, node: inn, text: nodeText(inn) }); summary.added++; });
    });
    return { variant: variant, ops: ops, summary: summary };
  }
  // Apply a variant plan: write per-node overrides for plan.variant only. The Flagship base text and
  // every other variant are untouched. Added nodes/chapters are base-absent (present only for this
  // variant). Pushes ONE undo -- the whole combine is reversible.
  function applyVariantImportPlan(model, plan) {
    if (!model || !plan || !plan.variant) return model;
    var variant = plan.variant;
    pushUndo(model);
    function freshKey() { var k; do { k = nextId(model, "n"); } while (nodeByKey(model, k)); return k; }
    function ov(node) { if (!node.variants) node.variants = {}; return node.variants; }
    (plan.ops || []).forEach(function (op) {
      if (op.type === "diverge") { var n = nodeByKey(model, op.nodeKey); if (n) ov(n)[variant] = { text: op.text }; }
      else if (op.type === "absent") { var n2 = nodeByKey(model, op.nodeKey); if (n2) ov(n2)[variant] = { absent: true }; }
      else if (op.type === "add-node") {
        var blocks = chapterBlocks(model), blk = null;
        blocks.forEach(function (b) { if (b.key === op.chapterKey) blk = b; });
        if (!blk) return;
        var c = clone(op.node); c.key = freshKey(); c.baseAbsent = true; c.variants = {}; c.variants[variant] = { text: nodeText(op.node) };
        model.nodes = model.nodes.slice(0, blk.end).concat([c], model.nodes.slice(blk.end));
      } else if (op.type === "add-chapter") {
        var head = { type: "heading", level: 1, chapter: true, text: op.name, key: freshKey(), baseAbsent: true, variants: {} };
        head.variants[variant] = { text: op.name };
        model.nodes.push(head);
        (op.nodes || []).forEach(function (nd) { var cc = clone(nd); cc.key = freshKey(); cc.baseAbsent = true; cc.variants = {}; cc.variants[variant] = { text: nodeText(nd) }; model.nodes.push(cc); });
      }
    });
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
  // ---- source v2: find-to-word + match cycling (find-word-cycling, spec 2c section 2) --------
  // Every occurrence of `needle` across the whole document's text, in document order, as a
  // highlightable span {nodeKey,start,len,index}. Case-insensitive substring (contains) match --
  // concrete positions the editor can scroll to + paint, unlike a scattered fuzzy subsequence.
  // The match COUNT ("5 matches") is out.length; cycling is an index into out. Pure + DOM-free.
  function findMatches(model, needle) {
    var q = String(needle == null ? "" : needle).toLowerCase();
    var out = [];
    if (!q) return out;
    (model && model.nodes || []).forEach(function (n) {
      var hay = nodeText(n).toLowerCase(), from = 0, i;
      while ((i = hay.indexOf(q, from)) !== -1) {
        out.push({ nodeKey: n.key, start: i, len: q.length, index: out.length });
        from = i + (q.length || 1);
      }
    });
    return out;
  }
  // The nearest heading at or before a node (the "section" a match sits under), so the TOC filter
  // can keep the heading row that owns a body hit -- "narrow the outline to entries under matching
  // text" (spec 2c section 2). Returns the heading node's key, or null if the hit precedes any heading.
  function headingKeyForNode(model, nodeKey) {
    var ns = (model && model.nodes) || [], cur = null;
    for (var i = 0; i < ns.length; i++) {
      if (ns[i].type === "heading") cur = ns[i].key;
      if (ns[i].key === nodeKey) return cur;
    }
    return null;
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

  // ---- source v2: serialise the continuous document back out to Markdown (.md) ---------------
  // The inverse of the import on-ramp (product-rail-source-rw-markdown-export). A node tree -> a
  // portable Markdown string. Inline conventions (bold **x**, `inline code`) already live literally
  // in node text, so they emit as-is; each block type maps to standard Markdown. Pure + DOM-free ->
  // headlessly testable and reusable anywhere. Chapter headings (level 1) become `# `.
  function mdCell(c) { return String(c == null ? "" : c).replace(/\|/g, "\\|"); }
  // Re-insert the inline markers for a node's format runs so import->export round-trips (import lifts
  // **bold**/*italic*/`code` OUT of the text into formats[]; this puts them back). Plain when no runs.
  function inlineToMarkdown(text, runs) {
    text = String(text == null ? "" : text);
    if (!runs || !runs.length) return text;
    var sorted = runs.slice().sort(function (a, b) { return a.start - b.start; });
    var out = "", pos = 0;
    sorted.forEach(function (r) {
      if (!r || r.start < pos || r.start > text.length) return;
      out += text.slice(pos, r.start);
      var mk = r.style === "bold" ? "**" : r.style === "code" ? "`" : "*";
      out += mk + text.slice(r.start, r.start + r.len) + mk;
      pos = r.start + r.len;
    });
    return out + text.slice(pos);
  }
  function nodeToMarkdown(node) {
    if (!node) return "";
    switch (node.type) {
      case "heading": {
        var lvl = Math.max(1, Math.min(6, node.level || 2));
        return new Array(lvl + 1).join("#") + " " + inlineToMarkdown(node.text || "", node.formats);
      }
      case "paragraph": return inlineToMarkdown(node.text == null ? "" : node.text, node.formats);
      case "callout": {
        var t = inlineToMarkdown(node.text == null ? "" : node.text, node.formats);
        var lines = t.split("\n");
        return lines.map(function (line, i) {
          return "> " + (i === 0 && node.tag ? "**" + node.tag + "** " : "") + line;
        }).join("\n");
      }
      case "list": {
        var ordered = !!node.ordered;
        return (node.items || []).map(function (it, i) { return (ordered ? (i + 1) + ". " : "- ") + inlineToMarkdown(it, node.itemFormats && node.itemFormats[i]); }).join("\n");
      }
      case "table": {
        var rows = node.rows || [];
        if (!rows.length) return "";
        var cf = node.cellFormats || [];
        function cell(c, ri, ci) { return mdCell(inlineToMarkdown(c, cf[ri] && cf[ri][ci])); }
        var head = rows[0] || [], out = [];
        out.push("| " + head.map(function (c, ci) { return cell(c, 0, ci); }).join(" | ") + " |");
        out.push("| " + head.map(function () { return "---"; }).join(" | ") + " |");
        for (var i = 1; i < rows.length; i++) out.push("| " + (rows[i] || []).map(function (c, ci) { return cell(c, i, ci); }).join(" | ") + " |");
        return out.join("\n");
      }
      case "image": {
        var alt = node.alt || node.caption || "";
        var md = "![" + alt + "](" + (node.src || "") + ")";
        if (node.caption && node.caption !== alt) md += "\n\n*" + node.caption + "*";
        return md;
      }
      case "row": // A3: emit each side-by-side image on its own line -- Markdown has no row primitive
        return (node.children || []).map(nodeToMarkdown).filter(Boolean).join("\n\n");
      default: return String(node.text == null ? "" : node.text);
    }
  }
  function toMarkdown(model) {
    var body = ((model && model.nodes) || []).map(nodeToMarkdown).join("\n\n");
    return body.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "") + "\n";
  }

  var _pure = {
    nodeText: nodeText, setNodeText: setNodeText, isTextNode: isTextNode, inlineRuns: inlineRuns, planLinkedBlocks: planLinkedBlocks,
    nodeToMarkdown: nodeToMarkdown, toMarkdown: toMarkdown,
    searchText: searchText, fuzzyMatch: fuzzyMatch, findMatches: findMatches, headingKeyForNode: headingKeyForNode,
    diffText: diffText, mapPos: mapPos, shiftAnchor: shiftAnchor,
    create: create, ensureKeys: ensureKeys, headings: headings, markPath: markPath, markCounts: markCounts, insertNodeAfter: insertNodeAfter, concatChapters: concatChapters, chapters: chapters, chapterBlocks: chapterBlocks, moveChapter: moveChapter, outline: outline, importPlan: importPlan, applyImportPlan: applyImportPlan, variantAlign: variantAlign, variantImportPlan: variantImportPlan, applyVariantImportPlan: applyVariantImportPlan,
    addMark: addMark, anchorText: anchorText, refreshMark: refreshMark, isObjectMark: isObjectMark,
    isMultiBlock: isMultiBlock, markSpans: markSpans, markText: markText,
    applyTextEdit: applyTextEdit, replaceRange: replaceRange, replaceAll: replaceAll,
    splitNode: splitNode, setNodeType: setNodeType, nodesInAnchor: nodesInAnchor,
    snapshot: snapshot, pushUndo: pushUndo, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    toJSON: toJSON, fromJSON: fromJSON,
    nodeByKey: nodeByKey, markById: markById, NODE_TYPES: NODE_TYPES, MARK_TYPES: MARK_TYPES,
    blocksFromText: blocksFromText, fromSections: fromSections, parseInline: parseInline,
    markStatus: markStatus, markMeta: markMeta, updateMark: updateMark,
    alternatesFor: alternatesFor, pickAlternate: pickAlternate,
    markExtendedBy: markExtendedBy, marksOverlapping: marksOverlapping, sourceEditImpact: sourceEditImpact, logHistory: logHistory,
    selbarDecision: selbarDecision,
    summarizeEdits: summarizeEdits, historyEntryView: historyEntryView,
    isMarkableObjectNode: isMarkableObjectNode, objectAlternatesFor: objectAlternatesFor, objectNodeLabel: objectNodeLabel, whereUsedForMark: whereUsedForMark,
    rowOf: rowOf, combineIntoRow: combineIntoRow, removeFromRow: removeFromRow,
    FLAGSHIP: FLAGSHIP, isFlagship: isFlagship, nodeForVariant: nodeForVariant, imageForVariant: imageForVariant, setVariantImage: setVariantImage, variantView: variantView, setVariantText: setVariantText, removeNodeFromVariant: removeNodeFromVariant, restoreNodeToVariant: restoreNodeToVariant, variantsInDoc: variantsInDoc
  };

  var SourceDoc = {
    create: create, ensureKeys: ensureKeys, headings: headings, markPath: markPath, markCounts: markCounts, insertNodeAfter: insertNodeAfter, fromSections: fromSections, concatChapters: concatChapters, chapters: chapters, chapterBlocks: chapterBlocks, moveChapter: moveChapter, outline: outline, importPlan: importPlan, applyImportPlan: applyImportPlan, variantAlign: variantAlign, variantImportPlan: variantImportPlan, applyVariantImportPlan: applyVariantImportPlan,
    nodeText: nodeText, nodeByKey: nodeByKey, markById: markById, inlineRuns: inlineRuns, planLinkedBlocks: planLinkedBlocks,
    addMark: addMark, anchorText: anchorText, refreshMark: refreshMark, isObjectMark: isObjectMark,
    isMultiBlock: isMultiBlock, markSpans: markSpans, markText: markText,
    applyTextEdit: applyTextEdit, replaceRange: replaceRange, replaceAll: replaceAll,
    splitNode: splitNode, setNodeType: setNodeType, nodesInAnchor: nodesInAnchor,
    undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo, pushUndo: pushUndo,
    markStatus: markStatus, markMeta: markMeta, updateMark: updateMark,
    alternatesFor: alternatesFor, pickAlternate: pickAlternate,
    markExtendedBy: markExtendedBy, marksOverlapping: marksOverlapping, sourceEditImpact: sourceEditImpact, logHistory: logHistory,
    selbarDecision: selbarDecision,
    summarizeEdits: summarizeEdits, historyEntryView: historyEntryView,
    isMarkableObjectNode: isMarkableObjectNode, objectAlternatesFor: objectAlternatesFor, objectNodeLabel: objectNodeLabel, whereUsedForMark: whereUsedForMark,
    rowOf: rowOf, combineIntoRow: combineIntoRow, removeFromRow: removeFromRow,
    FLAGSHIP: FLAGSHIP, isFlagship: isFlagship, nodeForVariant: nodeForVariant, imageForVariant: imageForVariant, setVariantImage: setVariantImage, variantView: variantView, setVariantText: setVariantText, removeNodeFromVariant: removeNodeFromVariant, restoreNodeToVariant: restoreNodeToVariant, variantsInDoc: variantsInDoc,
    searchText: searchText, fuzzyMatch: fuzzyMatch, findMatches: findMatches, headingKeyForNode: headingKeyForNode,
    toMarkdown: toMarkdown,
    toJSON: toJSON, fromJSON: fromJSON,
    _pure: _pure
  };

  if (typeof window !== "undefined") window.SourceDoc = SourceDoc;
  if (typeof module !== "undefined" && module.exports) module.exports = SourceDoc;
})();
