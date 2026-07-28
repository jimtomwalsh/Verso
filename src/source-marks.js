// source-marks.js -- the range-mark PAINTING engine for the Source stage (Epic 2b).
//
// Spec 2b §1.2 / §3. Given a root element whose block elements carry data-node="<key>"
// (the DOM projection of a SourceDoc model -- see source-doc.js) and that model, this engine:
//   * computes a live DOM Range for each text mark from its MODEL anchor {nodeKey,start,len},
//   * paints the three mark types as visually-distinct CSS Custom Highlights (no wrapper spans,
//     so reading flow is never cluttered -- the mechanism the prototype proved),
//   * exposes hit-testing (which mark is under a selection/point) and a selection->anchor helper
//     so the toolbars ticket can drive create / ⟳ update without re-deriving offsets.
//
// It is deliberately VIEW-AGNOSTIC: it never mounts, renders node content, handles the lock, or
// owns the toolbars -- lock-toolbars mounts it onto the real Source-stage article. It only paints
// marks over whatever keyed DOM it is handed and reads/writes offsets, so the same engine serves
// the article, a variant column, or a spike harness unchanged.
//
// Highlight API is feature-detected; where absent (older engines) paint() is a safe no-op and the
// caller can fall back to status dots only. No new runtime dependency.
//
// window.SourceMarks.create({ root, model }) -> engine instance
(function () {
  "use strict";

  var HL_TYPES = ["link", "alt", "comment", "active", "stale", "broken"];

  function hasHighlight() {
    return typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
  }
  // Register the shared highlight registry once per page (idempotent). Names are namespaced
  // sd-* so they never collide with any other Highlight a host page might define. The visual
  // treatment (colour/underline per type) lives in CSS ::highlight(sd-*) rules, owned by the
  // editor chrome -- this engine only assigns ranges to the right named set.
  var REG = null;
  function registry() {
    if (REG || !hasHighlight()) return REG;
    REG = {};
    HL_TYPES.forEach(function (k) {
      var h = CSS.highlights.get("sd-" + k);
      if (!h) { h = new Highlight(); CSS.highlights.set("sd-" + k, h); }
      REG[k] = h;
    });
    return REG;
  }

  function SD() { return (typeof window !== "undefined" && window.SourceDoc) || (typeof require === "function" && require("./source-doc.js")); }

  function create(opts) {
    opts = opts || {};
    var root = opts.root;
    var model = opts.model;
    var sd = SD();
    var activeId = null;

    function setModel(m) { model = m; }
    function setActive(id) { activeId = id; }

    function nodeEl(key) { return root && root.querySelector('[data-node="' + cssEscape(key) + '"]'); }
    function cssEscape(s) {
      if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
      return String(s).replace(/["\\\]]/g, "\\$&");
    }

    // Compute a live DOM Range for a text mark's model anchor. The projection renders each block
    // as a single text node; if a host renders inline formatting (multiple text nodes) we walk
    // the node's text to place the offset. Returns null if the node is missing or the offset
    // no longer fits (the mark is broken -- the caller paints it in the broken set instead).
    function rangeFor(anchor) {
      var el = nodeEl(anchor.nodeKey);
      if (!el) return null;
      var startPos = walkToOffset(el, anchor.start);
      var endPos = walkToOffset(el, anchor.start + anchor.len);
      if (!startPos || !endPos) return null;
      try {
        var r = document.createRange();
        r.setStart(startPos.node, startPos.offset);
        r.setEnd(endPos.node, endPos.offset);
        return r;
      } catch (e) { return null; }
    }
    // Map a character offset within a block element to a {node, offset} DOM position, walking its
    // text nodes so the engine works whether the block is one text node or several (bold/code).
    function walkToOffset(el, idx) {
      var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, acc = 0, last = null;
      while ((n = tw.nextNode())) {
        last = n;
        if (acc + n.length >= idx) return { node: n, offset: idx - acc };
        acc += n.length;
      }
      return last ? { node: last, offset: last.length } : { node: el, offset: 0 };
    }
    // Inverse: a DOM {node, offset} inside a block -> the character offset within that block.
    function offsetOf(el, container, offset) {
      var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, acc = 0;
      while ((n = tw.nextNode())) {
        if (n === container) return acc + offset;
        acc += n.length;
      }
      return acc;
    }
    // The block element (data-node) that contains a DOM node, and its key.
    function blockOf(node) {
      node = node && node.nodeType === 3 ? node.parentNode : node;
      var el = node && node.closest ? node.closest("[data-node]") : null;
      return el ? { el: el, key: el.getAttribute("data-node") } : null;
    }

    // Read the current selection as a MODEL anchor {nodeKey,start,len}, or null if the selection
    // is collapsed / spans blocks / is outside the root. This is the create/update entry point.
    function selectionAnchor() {
      var sel = typeof window !== "undefined" && window.getSelection && window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      var r = sel.getRangeAt(0);
      if (r.collapsed || !root.contains(r.commonAncestorContainer)) return null;
      var b1 = blockOf(r.startContainer), b2 = blockOf(r.endContainer);
      if (!b1 || !b2 || b1.key !== b2.key) return null; // one block only (v1)
      var s = offsetOf(b1.el, r.startContainer, r.startOffset);
      var e = offsetOf(b1.el, r.endContainer, r.endOffset);
      if (e < s) { var t = s; s = e; e = t; }
      return { nodeKey: b1.key, start: s, len: e - s };
    }

    // The whole point: paint every mark into its type's highlight set, with active/stale/broken
    // taking visual precedence. Broken marks still paint (struck-through) so the author can see
    // and repair them. Safe no-op without the Highlight API.
    function paint() {
      var reg = registry();
      if (!reg) return;
      HL_TYPES.forEach(function (k) { reg[k].clear(); });
      (model.marks || []).forEach(function (m) {
        if (sd.isObjectMark(m)) return; // object marks decorate their node element, not a range
        sd.refreshMark(model, m);
        var r = rangeFor(m.anchor);
        if (!r) { m.broken = true; return; }
        if (m.broken) { reg.broken.add(r); return; }
        if (m.id === activeId) { reg.active.add(r); return; }
        if (m.stale) { reg.stale.add(r); return; }
        reg[m.type === "link" ? "link" : m.type === "comment" ? "comment" : "alt"].add(r);
      });
    }

    // Hit-test: the mark whose painted span contains a DOM point (for click-to-activate).
    function markAtPoint(container, offset) {
      var b = blockOf(container);
      if (!b) return null;
      var pos = offsetOf(b.el, container, offset);
      var hits = sd.marksOverlapping(model, b.key, pos, 0);
      return hits.length ? hits[hits.length - 1] : null; // topmost (last-painted) wins
    }

    // The bounding rect of a mark's painted span (for positioning a pinned panel / status dot).
    function rectFor(m) {
      if (sd.isObjectMark(m)) { var el = nodeEl(m.anchor.nodeKey); return el && el.getBoundingClientRect(); }
      var r = rangeFor(m.anchor);
      return r ? r.getBoundingClientRect() : null;
    }

    return {
      paint: paint,
      setModel: setModel,
      setActive: setActive,
      rangeFor: rangeFor,
      selectionAnchor: selectionAnchor,
      markAtPoint: markAtPoint,
      rectFor: rectFor,
      offsetOf: offsetOf,
      blockOf: blockOf,
      hasHighlight: hasHighlight
    };
  }

  var SourceMarks = { create: create, hasHighlight: hasHighlight, _registry: registry };
  if (typeof window !== "undefined") window.SourceMarks = SourceMarks;
  if (typeof module !== "undefined" && module.exports) module.exports = SourceMarks;
})();
