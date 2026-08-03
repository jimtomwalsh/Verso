// editor/dnd-ui.js -- what a drag LOOKS like on the canvas (arch-P3b-07t).
//
// THE SPLIT THIS COMPLETES. arch-P3-08 pulled the drop RESOLVER into editor/dnd.js: given a drag
// payload and a target, where does the block actually land, and what does the block tree look like
// afterwards. That is pure, and it moved first because it could be tested without a browser. This
// is the other half -- the part that could not: the overlay a drag paints, the insertion line, the
// hit zones a drop target answers to, and the column edge bands, resizers and swap handles.
//
// So dnd.js decides; this file shows and wires. It calls DND for every structural answer and never
// duplicates one -- appendIntoContainer and appendIntoColumn here are one-line relays for exactly
// that reason.
//
// THE DRAG STATE LIVES HERE NOW. `dragPayload` (what is being dragged: a move from the outliner, or
// an insert from the Assets tab) and `dragTargetZone` (before / after / into) were read from twelve
// places in editor.js while the code that maintains them sat in this region. The module owns them
// and provides them, so the outliner and the Assets tab read the owner rather than going through
// editor.js. Same tidy-up P3b-06 made with the hotspot selection and P3b-07b with the scope tally.
//
// WHAT STAYED, and why it is worth saying: the banner this came from also held `iconBtn` and its
// legacy-key alias table. Those are a canonical CONTROL, not drag behaviour -- they belong with the
// rest of the control set in inspector/primitives.js, and they are noted as a follow-up rather than
// smuggled through this ticket.
//
// Editor chrome only: it rearranges the document, but nothing here renders or exports.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    // The drop resolver is a pure sibling. Read inside install, where every script on the page has
    // already run -- the load-order rule the P3b-01 ratchet enforces.
    var DND = window.VersoDnd;
    var E = kernel.need(
      "h", "pushHistory", "findPageOfBlock", "clone", "cleanupColumns", "reapplyStructural",
      "LIBRARY", "walkBlocks", "walkPageBlocks", "renderModelView", "scheduleSave",
      "reselectBlockNode", "iconBtn", "setCurrentPage", "doc", "currentPage"
    );
    // The stable half, aliased once so the moved body reads exactly as it did. `doc` and
    // `currentPage` are NOT here: a document swap replaces `doc` wholesale and every focusFrame
    // reassigns `currentPage`, so both are read through E at the moment they are used.
    var h = E.h, pushHistory = E.pushHistory, findPageOfBlock = E.findPageOfBlock, clone = E.clone,
        cleanupColumns = E.cleanupColumns, reapplyStructural = E.reapplyStructural,
        LIBRARY = E.LIBRARY, walkBlocks = E.walkBlocks, walkPageBlocks = E.walkPageBlocks,
        renderModelView = E.renderModelView, scheduleSave = E.scheduleSave,
        reselectBlockNode = E.reselectBlockNode, iconBtn = E.iconBtn;

    // dragPayload: { kind:"move", page, index } | { kind:"insert", makeIndex }
    var dragPayload = null;
    var dragTargetZone = "before";
    function clearDropMarks() {
      Array.prototype.forEach.call(document.querySelectorAll(".drop-before,.drop-into,.drop-left,.drop-right,.drop-after"), function (e) {
        e.classList.remove("drop-before", "drop-into", "drop-left", "drop-right", "drop-after");
      });
      hideDropPreview();
    }

    // Live snap-zone drop preview (OS-window-snap feel). A single, reusable,
    // pointer-events:none overlay painted over the hovered block per dragover -- it
    // NEVER intercepts drops, so the real hit-testing (block 4-zone dragover +
    // stopPropagation, the columns edge bands) stays fully intact; only the painting
    // moved off the per-block .drop-* border classes. Two layers: a filled quadrant
    // tint so the four hotspots read as segments, and a solid accent bar showing
    // exactly where the block will land. Positioned in viewport space (fixed) from
    // getBoundingClientRect, so canvas pan/zoom transforms don't matter.
    function getDropOverlay() {
      var ov = document.getElementById("drop-overlay");
      if (ov) return ov;
      ov = h("div", "drop-overlay");
      ov.id = "drop-overlay";
      ov.__tint = h("div", "drop-overlay__tint");
      ov.__bar = h("div", "drop-overlay__bar");
      ov.appendChild(ov.__tint);
      ov.appendChild(ov.__bar);
      document.body.appendChild(ov);
      return ov;
    }
    function setDropBox(node, l, t, w, hgt) {
      node.style.left = l + "px"; node.style.top = t + "px";
      node.style.width = Math.max(0, w) + "px"; node.style.height = Math.max(0, hgt) + "px";
    }
    function showDropPreview(rect, zone) {
      var ov = getDropOverlay();
      ov.style.display = "block";
      var edge = 0.28; // column hotspot band width (the decision band is 0.22/0.78)
      if (zone === "before") {
        setDropBox(ov.__tint, rect.left, rect.top, rect.width, rect.height / 2);
        setDropBox(ov.__bar, rect.left, rect.top - 1.5, rect.width, 3);
      } else if (zone === "after") {
        setDropBox(ov.__tint, rect.left, rect.top + rect.height / 2, rect.width, rect.height / 2);
        setDropBox(ov.__bar, rect.left, rect.top + rect.height - 1.5, rect.width, 3);
      } else if (zone === "left") {
        setDropBox(ov.__tint, rect.left, rect.top, rect.width * edge, rect.height);
        setDropBox(ov.__bar, rect.left - 1.5, rect.top, 3, rect.height);
      } else if (zone === "right") {
        setDropBox(ov.__tint, rect.left + rect.width * (1 - edge), rect.top, rect.width * edge, rect.height);
        setDropBox(ov.__bar, rect.left + rect.width - 1.5, rect.top, 3, rect.height);
      }
    }
    function hideDropPreview() {
      var ov = document.getElementById("drop-overlay");
      if (ov) ov.style.display = "none";
    }
    function makeDropTarget(el, getTarget, cls) {
      cls = cls || "drop-before";
      el.addEventListener("dragover", function (e) {
        if (!dragPayload) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = dragPayload.kind === "insert" ? "copy" : "move";

        if (el.classList.contains("canvas-block")) {
          var rect = el.getBoundingClientRect();
          var pctX = (e.clientX - rect.left) / rect.width;
          var pctY = (e.clientY - rect.top) / rect.height;
          // Decide the hotspot; paint via the live overlay (not per-block borders).
          if (pctX < 0.22) dragTargetZone = "left";
          else if (pctX > 0.78) dragTargetZone = "right";
          else if (pctY < 0.5) dragTargetZone = "before";
          else dragTargetZone = "after";
          showDropPreview(rect, dragTargetZone);
        } else {
          dragTargetZone = "before";
          el.classList.add(cls);
          hideDropPreview();
        }
      });
      el.addEventListener("dragleave", function () {
        el.classList.remove(cls, "drop-before", "drop-after", "drop-left", "drop-right");
      });
      el.addEventListener("drop", function (e) {
        if (!dragPayload) return;
        e.preventDefault(); e.stopPropagation();
        el.classList.remove(cls, "drop-before", "drop-after", "drop-left", "drop-right");
        hideDropPreview();
        handleDrop(typeof getTarget === "function" ? getTarget() : getTarget);
      });
    }
    // TTT: append a block INTO a container — a group/frame's children, or the first
    // column of a columns block (creating the column if empty). Pure model op.
    function appendIntoContainer(cont, blk) { return DND.appendIntoContainer(cont, blk); }
    // #94: append a block into a SPECIFIC column of a columns block (the targeted
    // empty-column drop slot). Creates the column array if absent. Pure model op.
    function appendIntoColumn(cont, ci, blk) { return DND.appendIntoColumn(cont, ci, blk); }
    // #94: wire each EMPTY column of a Columns block as its own drop target, so content
    // dropped onto it lands in THAT column (a fresh palette Columns block starts with two
    // empty columns). Non-empty columns keep their existing per-block drop zones; only
    // columns still showing the empty-column placeholder get this slot target.
    function attachEmptyColumnDrops(columnsNode, block) {
      var cols = Array.prototype.filter.call(columnsNode.children, function (c) {
        return c.classList && c.classList.contains("layout-column");
      });
      cols.forEach(function (colEl, ci) {
        if (!colEl.querySelector(".layout-column__empty")) return; // only empty columns need a slot target
        makeDropTarget(colEl, (function (b, i) { return function () { return { intoColumn: { block: b, index: i } }; }; })(block, ci), "drop-into");
      });
    }
    // #134: wire each card/accordion BODY (incl. EMPTY ones) as a drop target that appends
    // into the exact items[i].children / items[i].front array. render() emits the item index
    // on every card/panel (data-cr-index / data-cd-index / data-acc-index), so an empty body --
    // which renders only a placeholder div and was NOT a drop target before -- now accepts any
    // block, uniformly across every card and both flip sides. Editor drop wiring only; the array
    // is resolved (and created) lazily at drop time, so render() + the doc are untouched until a
    // block actually lands. makeDropTarget stopPropagation lets a child block's before/after
    // zone win when the pointer is over it; the body target only fires on the empty background.
    function wireItemBodyDrops(root) {
      function ownerOf(el) { var cb = el.closest && el.closest(".canvas-block"); return cb && cb.__block; }
      function wire(bodyEl, block, idx, key) {
        if (!bodyEl || !block || !Array.isArray(block.items) || isNaN(idx)) return;
        makeDropTarget(bodyEl, (function (blk, i, k) {
          return function () {
            var it = blk.items && blk.items[i]; if (!it) return null;
            var arr = (it[k] = it[k] || []);
            return { intoBlocks: { arrayRef: arr, ownerBlock: blk } };
          };
        })(block, idx, key), "drop-into");
      }
      Array.prototype.forEach.call(root.querySelectorAll(".card-reveal__card"), function (card) {
        var block = ownerOf(card), idx = parseInt(card.getAttribute("data-cr-index"), 10);
        wire(card.querySelector(".card-reveal__content"), block, idx, "children"); // reveal body / flip back (Side 2)
        wire(card.querySelector(".card-reveal__front"), block, idx, "front");       // flip front (Side 1)
      });
      Array.prototype.forEach.call(root.querySelectorAll(".card-deck__card"), function (card) {
        wire(card.querySelector(".card-deck__content"), ownerOf(card), parseInt(card.getAttribute("data-cd-index"), 10), "children");
      });
      Array.prototype.forEach.call(root.querySelectorAll(".acc__panel[data-acc-index]"), function (panel) {
        wire(panel, ownerOf(panel), parseInt(panel.getAttribute("data-acc-index"), 10), "children"); // accordion/sequence parity
      });
    }
    // The drop's model surgery is src/editor/dnd.js (arch-P3-08). This owns what a module cannot:
    // the drag payload, the undo push, the active page and the repaint.
    function handleDrop(target) {
      var res = DND.resolveDrop({
        doc: E.doc, payload: dragPayload, target: target, zone: dragTargetZone, currentPage: E.currentPage,
        make: function (i) { return LIBRARY[i].make(); },
        beginEdit: pushHistory,
        findPageOfBlock: findPageOfBlock,
        walkBlocks: walkPageBlocks,
        clone: clone,
        cleanupColumns: cleanupColumns
      });
      dragPayload = null;
      if (!res.ok) { if (res.reason === "cycle") clearDropMarks(); return; }
      E.setCurrentPage(res.currentPage);
      // A drop touches at most the source and destination pages; -1 falls back to a full mount.
      reapplyStructural(res.affected.length ? res.affected : -1);
    }

    // AA: a `columns` row is skipped as a canvas drop target (its inner column
    // blocks own the 4-zone drops and stopPropagation the dragover), so dropping a
    // full-width block before/after the columns row at PAGE level was unreachable.
    // Give the columns node its own full-width top/bottom edge bands that insert a
    // full-width block before/after the columns block in page.blocks. The bands sit
    // above the column content and only capture pointer events while a block is
    // being dragged (body.is-dragging-block), so they never touch normal editing.
    function attachColumnsEdgeBands(columnsNode, block, pi) {
      columnsNode.style.position = "relative";
      ["top", "bottom"].forEach(function (edge) {
        var band = h("div", "columns-edge-band columns-edge-band--" + edge);
        band.addEventListener("dragover", function (e) {
          if (!dragPayload) return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = dragPayload.kind === "insert" ? "copy" : "move";
          clearDropMarks();
          band.classList.add("is-band-active");
          dragTargetZone = edge === "top" ? "before" : "after";
          // Live preview: a full-width insertion bar at the columns row's top/bottom
          // edge (page-level before/after), matching the block-level snap feel.
          showDropPreview(columnsNode.getBoundingClientRect(), dragTargetZone);
        });
        band.addEventListener("dragleave", function () { band.classList.remove("is-band-active"); });
        band.addEventListener("drop", function (e) {
          if (!dragPayload) return;
          e.preventDefault(); e.stopPropagation();
          band.classList.remove("is-band-active");
          hideDropPreview();
          // page-level before/after the columns block (not into a column)
          E.setCurrentPage(pi);
          dragTargetZone = edge === "top" ? "before" : "after";
          handleDrop({ targetBlock: block });
        });
        columnsNode.appendChild(band);
      });
    }

    // Per-gap column-resize handles (editor chrome only — never rendered/exported).
    // A hover-revealed vertical line + grab strip in each inter-column gap; dragging
    // it redistributes flex ratios between the TWO adjacent columns only (a splitter),
    // leaving the other columns' widths untouched. The result is written to
    // block.colWidths (plain doc data -> ships in SCORM); render.js reads it back.
    // The invariant holds: nothing here leaks into render() — we mutate the doc, and
    // during a live drag we mirror the SAME flex values onto the mounted column nodes
    // for smooth feedback (setDoc/re-mount would reproduce them from colWidths).
    var COL_MIN_PX = 48; // a column may not be dragged narrower than this
    function attachColumnResizers(columnsNode, block) {
      var cols = Array.prototype.slice.call(columnsNode.children).filter(function (c) {
        return c.classList && c.classList.contains("layout-column");
      });
      if (cols.length < 2) return; // nothing to resize between
      columnsNode.style.position = "relative";
      var gap = block.gap == null ? 24 : block.gap;
      var handles = [];

      function positionHandles() {
        handles.forEach(function (hnd, i) {
          // Centre of the gap between column i and i+1, relative to the row
          // (columnsNode is the offsetParent since it is position:relative).
          var left = cols[i].offsetLeft + cols[i].offsetWidth + gap / 2;
          hnd.style.left = left + "px";
        });
      }

      cols.slice(0, -1).forEach(function (_, i) {
        var hnd = h("div", "col-resize-handle");
        hnd.setAttribute("role", "separator");
        hnd.setAttribute("aria-orientation", "vertical");
        hnd.title = "Drag to resize columns";
        hnd.appendChild(h("div", "col-resize-handle__line"));
        handles.push(hnd);
        columnsNode.appendChild(hnd);

        var drag = null;
        hnd.addEventListener("pointerdown", function (e) {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          // Materialise the CURRENT rendered widths as explicit ratios so ONLY the
          // dragged pair changes (untouched columns keep their exact pixel width).
          var widths = cols.map(function (c) { return c.offsetWidth; });
          pushHistory();
          block.colWidths = widths.slice();
          drag = { startX: e.clientX, wi: widths[i], wj: widths[i + 1], total: widths[i] + widths[i + 1] };
          hnd.setPointerCapture(e.pointerId);
          hnd.classList.add("is-resizing");
          document.body.classList.add("is-col-resizing");
        });
        hnd.addEventListener("pointermove", function (e) {
          if (!drag) return;
          var dx = e.clientX - drag.startX;
          var ni = Math.max(COL_MIN_PX, Math.min(drag.total - COL_MIN_PX, drag.wi + dx));
          var nj = drag.total - ni;
          block.colWidths[i] = ni;
          block.colWidths[i + 1] = nj;
          cols[i].style.flex = String(ni);
          cols[i + 1].style.flex = String(nj);
          positionHandles();
        });
        function endDrag(e) {
          if (!drag) return;
          drag = null;
          try { hnd.releasePointerCapture(e.pointerId); } catch (_) {}
          hnd.classList.remove("is-resizing");
          document.body.classList.remove("is-col-resizing");
          positionHandles();
          renderModelView();
          scheduleSave();
        }
        hnd.addEventListener("pointerup", endDrag);
        hnd.addEventListener("pointercancel", endDrag);
      });

      positionHandles();
      // Keep handles glued if the row reflows (window resize / inspector-driven relayout).
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () { positionHandles(); });
        ro.observe(columnsNode);
      }
    }

    // Pure swap of two adjacent columns' block arrays (+ colWidths, if custom and still
    // matching the column count). i/i+1 must both be valid indices; the caller (the click
    // handler below) guarantees that by construction (one button per adjacent pair).
    /* @swap-columns-start */
    function swapColumns(block, i) {
      if (!block || !Array.isArray(block.columns)) return block;
      var a = block.columns[i], b = block.columns[i + 1];
      block.columns[i] = b; block.columns[i + 1] = a;
      if (Array.isArray(block.colWidths) && block.colWidths.length === block.columns.length) {
        var wa = block.colWidths[i], wb = block.colWidths[i + 1];
        block.colWidths[i] = wb; block.colWidths[i + 1] = wa;
      }
      return block;
    }
    /* @swap-columns-end */
    // Per-gap column-SWAP glyph (editor chrome only — never rendered/exported). A small
    // hover-revealed icon button in each inter-column gap, mirroring attachColumnResizers'
    // wiring exactly, that exchanges the two adjacent columns via swapColumns and
    // re-renders. Unlike a resize (a live drag on flex ratios), a swap is a genuine
    // structural change — content actually moves — so it goes through the normal
    // pushHistory + reapplyStructural + reselectBlockNode path, not a live DOM mirror.
    function attachColumnSwaps(columnsNode, block) {
      var cols = Array.prototype.slice.call(columnsNode.children).filter(function (c) {
        return c.classList && c.classList.contains("layout-column");
      });
      if (cols.length < 2) return; // nothing to swap between
      var gap = block.gap == null ? 24 : block.gap;
      var btns = [];

      function positionSwaps() {
        btns.forEach(function (btn, i) {
          var left = cols[i].offsetLeft + cols[i].offsetWidth + gap / 2;
          btn.style.left = left + "px";
          btn.style.top = (columnsNode.offsetHeight / 2) + "px";
        });
      }

      cols.slice(0, -1).forEach(function (_, i) {
        var btn = iconBtn("arrow-left-right", "Swap these two columns");
        btn.classList.add("col-swap-btn");
        btn.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          pushHistory();
          swapColumns(block, i);
          reapplyStructural(findPageOfBlock(block));
          reselectBlockNode(block, "block");
        });
        btns.push(btn);
        columnsNode.appendChild(btn);
      });

      positionSwaps();
      if (window.ResizeObserver) {
        var ro2 = new ResizeObserver(function () { positionSwaps(); });
        ro2.observe(columnsNode);
      }
    }
    // The drag state crosses in both directions: the outliner and the Assets tab SET the payload
    // when a drag starts and clear it when it ends, and this file reads it on every dragover.
    kernel.provideLive({
      dragPayload: function () { return dragPayload; },
      dragTargetZone: function () { return dragTargetZone; }
    });
    kernel.provide({
      setDragPayload: function (v) { dragPayload = v; },
      setDragTargetZone: function (v) { dragTargetZone = v; }
    });
    kernel.expose({
      clearDropMarks: clearDropMarks, makeDropTarget: makeDropTarget, handleDrop: handleDrop,
      attachEmptyColumnDrops: attachEmptyColumnDrops, wireItemBodyDrops: wireItemBodyDrops,
      attachColumnsEdgeBands: attachColumnsEdgeBands, attachColumnResizers: attachColumnResizers,
      attachColumnSwaps: attachColumnSwaps,
      showDropPreview: showDropPreview, hideDropPreview: hideDropPreview
    });
  }

  window.VersoDndUi = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDndUi;
})();
