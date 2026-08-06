// editor/drill.js -- selecting your way INTO something (arch-P3b-07m).
//
// A course page is nested: a card holds columns, a column holds a text block, a text block holds a
// field. One click on the canvas has to mean one of those, and guessing is what made the old
// editor feel arbitrary -- click a paragraph inside a card and sometimes you got the card,
// sometimes the text.
//
// SELECT-FIRST is the answer: the first click selects the OUTERMOST thing, and each further click
// on the same spot steps one level in -- card, then column, then block, then field. Escape steps
// back out one level at a time. The chain is built once per target and walked by index, so
// stepping in and out is symmetric by construction rather than by two functions agreeing.
//
// Zoom-to-fit shares the file because it answers the same question from the other side: it needs
// the screen rectangle of whatever is selected, at whatever depth, including a multi-selection.
//
// It defers to whichever mode owns the click -- interact and comment mode both take it before
// this runs -- and it never fires while text is being edited, because a click inside a caret is a
// caret move, not a selection.
//
// Editor chrome only: it decides what is selected, and renders none of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "SEL", "view", "blurActiveText", "canvas", "clearAllMulti", "selectFieldNode",
      "resetDrill", "renderInspector", "setSelection", "canvasNodeForBlock", "fitAll", "fitWorldRect",
      "toggleMulti", "refreshCanvasSelection", "canvasTopBlock", "getSelectionTypeForBlock", "enterTextEdit", "selectByType",
      "twoStateText", "commentModeOn", "isTextTarget", "selection", "multiSel", "frameDescs",
      "drill", "multiSelPages", "spaceHeld", "interactMode", "applyingDrill",
      "setApplyingDrill"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var SEL = E.SEL,
        view = E.view,
        blurActiveText = E.blurActiveText,
        canvas = E.canvas,
        clearAllMulti = E.clearAllMulti,
        selectFieldNode = E.selectFieldNode,
        resetDrill = E.resetDrill,
        renderInspector = E.renderInspector,
        setSelection = E.setSelection,
        canvasNodeForBlock = E.canvasNodeForBlock,
        fitAll = E.fitAll,
        fitWorldRect = E.fitWorldRect,
        toggleMulti = E.toggleMulti,
        refreshCanvasSelection = E.refreshCanvasSelection,
        canvasTopBlock = E.canvasTopBlock,
        getSelectionTypeForBlock = E.getSelectionTypeForBlock,
        enterTextEdit = E.enterTextEdit,
        selectByType = E.selectByType,
        twoStateText = E.twoStateText,
        commentModeOn = E.commentModeOn,
        isTextTarget = E.isTextTarget;

    // ---- "." — zoom to fit the current selection -----------------------------
    function selectionScreenRects() {
      var rects = [];
      E.multiSel.forEach(function (b) { var n = canvasNodeForBlock(b); if (n) rects.push(n.getBoundingClientRect()); });
      E.multiSelPages.forEach(function (i) { var f = E.frameDescs[i] && E.frameDescs[i].frame; if (f) rects.push(f.getBoundingClientRect()); });
      if (E.selection.type === "page") { var f = E.frameDescs[E.selection.pageIndex] && E.frameDescs[E.selection.pageIndex].frame; if (f) rects.push(f.getBoundingClientRect()); }
      else if (E.selection.node) { var host = (E.selection.node.closest && E.selection.node.closest(".canvas-block")) || E.selection.node; rects.push(host.getBoundingClientRect()); }
      return rects;
    }
    function fitSelection() {
      var rects = selectionScreenRects();
      if (!rects.length) { fitAll(); return; }
      var cr = canvas.getBoundingClientRect();
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      rects.forEach(function (r) { minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); });
      var wx = (minX - cr.left - view.x) / view.zoom, wy = (minY - cr.top - view.y) / view.zoom;
      fitWorldRect(wx, wy, (maxX - minX) / view.zoom, (maxY - minY) / view.zoom);
    }

    // Canvas multi-select: Shift/Cmd-click an element toggles it into the selection.
    // Capture phase (registered BEFORE the leaf-first click handler below) so it owns
    // every modifier-click and beats contentEditable focus / block mousedown handlers.
    canvas.addEventListener("mousedown", function (e) {
      // A PAN gesture (middle-click, or Space-held left-drag) must NOT clear the selection —
      // the whole point of panning/zooming is to reposition and then act on what's selected,
      // so the selection has to survive it. (The pan itself is handled by the next listener.)
      if (e.button === 1 || (E.spaceHeld && e.button === 0)) return;
      if (e.shiftKey || e.metaKey) {
        // LEAF-FIRST (James 2026-07-12): toggle the element UNDER THE CURSOR, not the whole
        // top-level block (canvasTopBlock) — so two siblings inside one card/column can be
        // multi-selected. Seed from the current single selection so the first modifier-click
        // makes a pair. Bail on locked / non-block chrome (never selects).
        var levels = buildDrillLevels(e.target);
        var node = levels.length ? levels[leafSelectIndex(levels)].node : null;
        if (node && node.__block && !node.__block.locked) {
          e.preventDefault(); e.stopPropagation();
          if (!E.multiSel.length && E.selection && E.selection.block && E.selection.block !== node.__block) E.multiSel.push(E.selection.block);
          resetDrill(); toggleMulti(node.__block); renderInspector();
        }
        return;
      }
      if (E.multiSel.length || E.multiSelPages.length) { clearAllMulti(); refreshCanvasSelection(); renderInspector(); }
    }, true);

    // ---- §74 progressive drill-in selection (select-first mode) --------------
    // Build the outermost->innermost stack of selectable levels at a click point.
    // Simple text blocks are ONE node that is both `.canvas-block` and `[data-edit]`
    // (see render.js editable()) -> they collapse to a single "field" level, so the
    // stack for a bare paragraph is [field, edit] (select then edit). Structural
    // container blocks (frame/group/columns/cardReveal) add an outer "block" level.
    // `.layout-column` / `.card-reveal__card` are structural but have no selection
    // identity yet, so they are skipped (deferred, noted in BACKLOG §74).
    function buildDrillLevels(target) {
      var top = canvasTopBlock(target);
      if (!top || !top.__block || top.__block.locked) return [];
      var inner = []; // innermost-first
      var n = target;
      while (n && n.nodeType === 1) {
        // Progressive disclosure (James 2026-07-08): a node that is BOTH a canvas-block AND an
        // editable field (a simple text block) now yields BOTH levels — the block tier (Layout/
        // Spacing/Appearance) then the field tier (Type). The old `else if` collapsed them, so a
        // text block jumped straight to the combined field panel and you never got block settings.
        if (n.matches("[data-edit]")) inner.push({ kind: "field", node: n });
        if (n.classList.contains("canvas-block") && n.__block) {
          // Only give a data-edit node its OWN extra block tier when it's a PLAIN text block
          // (heading/paragraph/note/…, i.e. selection type "field"). Special field-types like
          // navButton keep their single bespoke inspector and must not gain a generic block panel.
          if (!n.matches("[data-edit]") || getSelectionTypeForBlock(n.__block) === "field") inner.push({ kind: "block", node: n });
        }
        if (n === top) break;
        n = n.parentNode;
      }
      var levels = inner.reverse(); // outermost-first (block before field for a dual-role node)
      if (!levels.length) return [];
      // A terminal editable field's final step ENTERS the caret AND shows the Type inspector in
      // one click (the "edit" step calls selectFieldNode itself), so you go block -> type+edit
      // without a dead "field selected, not editing" middle click.
      var leaf = levels[levels.length - 1];
      if (leaf.kind === "field" && leaf.node.classList.contains("is-editable")) levels[levels.length - 1] = { kind: "edit", node: leaf.node };
      return levels;
    }
    function applyDrillLevel(l) {
      if (!l) return;
      E.setApplyingDrill(true);
      try {
        clearAllMulti();
        if (l.kind === "edit") { selectFieldNode(l.node); enterTextEdit(l.node); } // Type inspector + caret in one step
        else if (l.kind === "field") { blurActiveText(); selectFieldNode(l.node); }
        // Block tier: force a BLOCK selection even for a data-edit text node (selectByType would
        // map data-edit -> field). Keep selectByType for embeds/navButtons/componentGrid/columns.
        else if (l.node.getAttribute && l.node.getAttribute("data-edit") != null && l.node.__block) { blurActiveText(); setSelection("block", l.node); }
        else { blurActiveText(); selectByType(l.node, l.node.__block); }
      } finally { E.setApplyingDrill(false); }
    }
    // LEAF-FIRST (James 2026-07-12, issue-follow-up): a plain click selects the
    // INNERMOST element under the cursor (a heading inside a card selects the
    // heading, not the card) — the deepest level whose kind is not "edit" (the caret
    // step is reached by double-click). Pure so tests/run.js can guard it without a DOM.
    function leafSelectIndex(levels) {
      // Innermost element = the deepest level's node. Step back over ITS OWN caret
      // ("edit") level to the block/field select-level, but NEVER past it into an
      // ancestor: an element whose ONLY level is editable (e.g. navButton, whose block
      // tier is suppressed) must still select ITSELF, not the container it sits in.
      return SEL.leafSelectIndex(levels);
    }
    // A single capture-phase handler owns canvas clicks in select-first mode: it picks
    // the leaf level (below) before any per-node mousedown drops a caret / selects a
    // container, routes Shift/Cmd into the multi-selection, and defers a press-drag on
    // the selected leaf so a native move wins over entering text edit. Bespoke subtrees
    // (embeds, hotspots, card instances, the drag / interact handles) keep their own handlers.
    canvas.addEventListener("mousedown", function (e) {
      if (!twoStateText()) return;                 // click-to-edit escape hatch: old behaviour
      if (E.interactMode || commentModeOn()) return;     // interact / comment mode own their click semantics
      if (e.button !== 0 || e.shiftKey || e.metaKey || E.spaceHeld) return;   // Shift/Cmd multi-select is owned by the handler above
      if (isTextTarget(e.target)) return;          // already editing this field -> native caret
      if (e.target.closest(".canvas-drag-handle, .interact-handle, [data-embed], [data-hotspot-block], [data-instance]")) return;
      // Contextual sidebar (James 2026-07-08): the footer nav bar is chrome (parent is the footer,
      // not .page) so the normal drill/canvasTopBlock never reaches it. Select it when its BACKGROUND
      // is clicked — not a nav button / mode toggle / editable label (those keep their own behaviour)
      // — so the sidebar surfaces the Learner-nav controls (renderCourseNavInspector).
      var navBar = e.target.closest(".course-nav.canvas-block");
      if (navBar && navBar.__block && !e.target.closest("[data-edit], .course-nav__btn, .mode-toggle, button, a")) {
        e.preventDefault(); e.stopPropagation();
        blurActiveText(); resetDrill(); setSelection("block", navBar);
        return;
      }
      var levels = buildDrillLevels(e.target);
      if (!levels.length) return;                  // background / chrome -> let marquee + deselect run
      var leafIndex = leafSelectIndex(levels);     // deepest NON-edit level = the element under the cursor
      var leaf = levels[leafIndex];
      var editLevel = levels[levels.length - 1];   // kind "edit" only when the leaf is editable text
      var leafBlock = leaf.node && leaf.node.__block;

      // ---- Plain click already ON the selected leaf: the selected block is the PHASE-2
      // drag surface, so a press-DRAG must MOVE it and a double-click must EDIT. Defer to
      // mouseup; if the pointer drags (native dragstart or >4px move) do nothing (the move
      // ran), else a double-click enters the caret. NOT preventDefault so the browser can
      // start the native drag; stopPropagation so the field's own mousedown (which would
      // preventDefault-select and BLOCK the drag) never runs. THIS is the fix for "click,
      // then click-hold to move" being swallowed as a double-click into text edit.
      // Keyed on the NODE (the press is on the block that is currently selected AND
      // draggable), NOT selection.block -- setSelection leaves selection.block null for
      // some types (e.g. navButton), which would wrongly drop those out of the drag path.
      var leafHost = leaf.node && leaf.node.closest && leaf.node.closest(".canvas-block");
      var selHost = E.selection && E.selection.node && E.selection.node.closest && E.selection.node.closest(".canvas-block");
      var onSelectedLeaf = leafBlock && !E.multiSel.length && leafHost && leafHost === selHost &&
        leafHost.getAttribute("draggable") === "true";
      if (onSelectedLeaf) {
        e.stopPropagation();
        var sx = e.clientX, sy = e.clientY, moved = false;
        function onMove(ev) { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true; }
        function onDrag() { moved = true; }
        function onUp() {
          window.removeEventListener("mousemove", onMove, true);
          window.removeEventListener("mouseup", onUp, true);
          window.removeEventListener("dragstart", onDrag, true);
          if (!moved && e.detail >= 2 && editLevel.kind === "edit") {
            E.drill.levels = levels; E.drill.index = levels.length - 1;
            applyDrillLevel(editLevel);            // double-click, no drag -> enter text edit
          }
        }
        window.addEventListener("mousemove", onMove, true);
        window.addEventListener("mouseup", onUp, true);
        window.addEventListener("dragstart", onDrag, true);
        return;
      }

      // ---- New target: select the LEAF directly (leaf-first). drill.index tracks the leaf
      // so Escape steps OUTWARD (leaf -> parent container -> ... -> deselect); a plain click
      // clears any prior multi-selection.
      e.preventDefault(); e.stopPropagation();
      clearAllMulti();
      E.drill.levels = levels; E.drill.index = leafIndex;
      // A leaf that is the caret ("edit") step -- an element like navButton whose only
      // drill level is editable -- SELECTS on a single click without dropping the caret
      // (so it becomes draggable, and doesn't jump straight into text edit); a
      // double-click still edits (the field's own dblclick + the onSelectedLeaf branch).
      if (leaf.kind === "edit") { blurActiveText(); selectFieldNode(leaf.node); }
      else applyDrillLevel(leaf);
    }, true);

    kernel.expose({
      fitSelection: fitSelection, selectionScreenRects: selectionScreenRects, applyDrillLevel: applyDrillLevel,
      buildDrillLevels: buildDrillLevels, leafSelectIndex: leafSelectIndex
    });
  }

  window.VersoDrill = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDrill;
})();
