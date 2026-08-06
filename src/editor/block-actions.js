// editor/block-actions.js -- what you can do to a selected block, and the two surfaces that
// offer it (arch-P3b-07o).
//
// Every block panel ends the same way. Whatever the block is, the last thing its inspector
// renders is this: how it looks (fill, text colour, stroke, corner radius) and what you can do to
// it (move, duplicate, clear, split, hide, lock, delete). `renderBlockActionsSection` is that
// tail, and every render*Inspector calls it last.
//
// The verbs also live on the canvas, as a contextual segment of the overlay tools bar that
// appears when something is selected and clears when it is not. Panel and bar are ONE concern
// because they are one set of verbs: both take the same `opts`, which is how a non-block element
// (a component-grid card instance) maps the same six actions onto its own model without either
// surface knowing what it is looking at.
//
// What the verbs DO is structure-ops.js. This file decides what is offered, to what, and how it
// reads; the ops decide what happens to the document.
//
// uio-E-M01: the bar is a floating element docked above the selected block, not a segment of the
// canvas overlay bar, so the separator it used to mint is retired. Two other modules
// read it live to show the bar again after they hide it, which is why it is provided from here
// rather than passed.
//
// Editor chrome only. Appearance is persisted to `block.box`, a document namespace render.js
// re-applies, so the canvas and the export agree without either surface reaching into render().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "pushHistory", "h", "iconBtn", "renderModelView", "reselectBlockNode", "getSelectionTypeForBlock",
      "getBlockStyles", "renderInspector", "iconField", "reapplyStructural", "findPageOfBlock", "sectionGroup",
      "colorFieldFlat", "reapplyBlock", "resolveScoped", "blockBoxChain", "twoUp", "scheduleSave",
      "mount", "moveBlock", "duplicateBlock", "deleteBlockByRef", "segmentedIconLive", "canvasNodeForBlock",
      "switchRow", "onOffLabel", "panelSection", "clone", "sectionsBufferOpen", "beginSections",
      "endSections", "clearBlockContentAction", "canSplitAtBlock", "splitPageAtBlock", "inspector"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var pushHistory = E.pushHistory,
        h = E.h,
        iconBtn = E.iconBtn,
        renderModelView = E.renderModelView,
        reselectBlockNode = E.reselectBlockNode,
        getSelectionTypeForBlock = E.getSelectionTypeForBlock,
        getBlockStyles = E.getBlockStyles,
        renderInspector = E.renderInspector,
        iconField = E.iconField,
        reapplyStructural = E.reapplyStructural,
        findPageOfBlock = E.findPageOfBlock,
        sectionGroup = E.sectionGroup,
        colorFieldFlat = E.colorFieldFlat,
        reapplyBlock = E.reapplyBlock,
        resolveScoped = E.resolveScoped,
        blockBoxChain = E.blockBoxChain,
        twoUp = E.twoUp,
        scheduleSave = E.scheduleSave,
        mount = E.mount,
        moveBlock = E.moveBlock,
        duplicateBlock = E.duplicateBlock,
        deleteBlockByRef = E.deleteBlockByRef,
        segmentedIconLive = E.segmentedIconLive,
        canvasNodeForBlock = E.canvasNodeForBlock,
        switchRow = E.switchRow,
        onOffLabel = E.onOffLabel,
        panelSection = E.panelSection,
        clone = E.clone,
        sectionsBufferOpen = E.sectionsBufferOpen,
        beginSections = E.beginSections,
        endSections = E.endSections,
        clearBlockContentAction = E.clearBlockContentAction,
        canSplitAtBlock = E.canSplitAtBlock,
        splitPageAtBlock = E.splitPageAtBlock;

    // The ONE canonical footer that every element inspector ends with: a Spacing
    // disclosure (space top / bottom) + a Block-actions icon row (move up, move
    // down, duplicate, hide, lock, delete). The markup is identical everywhere —
    // only the wired handlers vary, supplied via `opts` so a non-block element (a
    // component-grid card instance) maps the SAME actions onto its own model. Call
    // this as the LAST section of every render*Inspector.
    // Universal per-block appearance: fill, border (colour + weight), corner
    // radius, text colour — applied to the block's outer node. Persisted as
    // block.box (a dedicated namespace); render.js re-applies it (so demo + export
    // match). Live-applied to the canvas node so the panel never rebuilds.
    function renderAppearanceSection(block) {
      // #155: canonical taxonomy section (formerly an ad-hoc block-appearance disclosure). Buffered by
      // the beginSections()/endSections() wrapper in renderBlockActionsSection so it orders by PanelLayout.
      sectionGroup("Appearance", "Appearance", function (body) {
        block.box = block.box || {};
        var box = block.box;
        function nodeOf() { return canvasNodeForBlock(block); }
        // uio-F03: the live preview follows the RESOLVED value (this block's own, else the
        // course's captured type default, else the system default) — the same ladder the row
        // shows and the same one render.js applies, so Reset previews correctly too.
        function effBox(prop) { return resolveScoped(blockBoxChain(block), prop, { at: "block" }).value; }
        function setBorder() { var n = nodeOf(); if (n) n.style.border = effBox("border") ? ((effBox("borderWidth") || 1) + "px solid " + (box.borderColor || "var(--color-hair)")) : ""; }
        // Condensed (James 2026-07-08): colours stacked, the two dimensional fields (border weight
        // + corner radius) paired two-up with glyphs — matching the case/align/spacing language.
        colorFieldFlat("Fill", box.fill, function (v) { var n = nodeOf(); if (v == null) { delete box.fill; if (n) n.style.background = ""; } else { box.fill = v; if (n) n.style.background = v; } renderModelView(); }, body);
        colorFieldFlat("Text", box.textColor, function (v) { var n = nodeOf(); if (v == null) { delete box.textColor; if (n) n.style.color = ""; } else { box.textColor = v; if (n) n.style.color = v; } renderModelView(); }, body);
        // uio-F03: Stroke resolves down System -> Course type default -> Block, and the row
        // carries the shared inheritance tail (named scope, or dot + Reset when set here).
        var strokeRes = resolveScoped(blockBoxChain(block), "border", { at: "block" });
        switchRow("Stroke", function () { return !!strokeRes.value; },
          function (v) { box.border = v; setBorder(); renderModelView(); renderInspector(); }, body, false,
          { inherit: { res: strokeRes, format: onOffLabel, onReset: function () {
              pushHistory(); delete box.border; setBorder(); renderModelView(); renderInspector();
            } } });
        if (strokeRes.value) colorFieldFlat("Stroke colour", box.borderColor, function (v) { if (v == null) delete box.borderColor; else box.borderColor = v; setBorder(); renderModelView(); }, body);
        // Stroke width + corner radius: canonical iconFields, live-applied, paired two-up.
        var weightField = iconField(Icon("border-weight"), { value: box.borderWidth, unit: "px", placeholder: "1", step: 1, min: 0, max: 12, datalist: "dl-gap", title: "Stroke width",
          onchange: function (v) { pushHistory(); var n = parseFloat(v); if (isNaN(n)) delete box.borderWidth; else box.borderWidth = n; setBorder(); renderModelView(); } }).wrap;
        var radiusField = iconField(Icon("radius"), { value: box.radius, unit: "px", placeholder: "0", step: 1, min: 0, max: 80, datalist: "dl-gap", title: "Corner radius",
          onchange: function (v) { pushHistory(); var n = parseFloat(v); var nd = nodeOf(); if (isNaN(n)) { delete box.radius; if (nd) nd.style.borderRadius = ""; } else { box.radius = n; if (nd) nd.style.borderRadius = n + "px"; } renderModelView(); } }).wrap;
        var apRow = twoUp(weightField, radiusField); apRow.style.marginTop = "4px"; body.appendChild(apRow);

        // #127: capture this block's look as the THEME DEFAULT for its type. Every other
        // block of the same type with no own override then inherits it (render/export
        // cascade: theme.blockStyles[type] is the baseline, block.box wins). Saves the
        // EFFECTIVE appearance (what you see = type default merged with this block's box).
        var type = block.type;
        var bs = getBlockStyles();
        var hasTypeDef = bs && bs[type] && Object.keys(bs[type]).length;
        var tdBody = panelSection(body, "Theme default (" + type + ")");
        tdBody.appendChild(h("div", "insp-hint", hasTypeDef
          ? "Every " + type + " block inherits this captured look unless it sets its own. Capture again to update it."
          : "Capture this look as the default for every " + type + " block in the course."));
        var capRow = h("div", null); capRow.style.display = "flex"; capRow.style.gap = "6px"; capRow.style.marginTop = "2px";
        var capBtn = h("button", "prop-btn", "Capture look");
        capBtn.title = "Save this appearance as the theme default for " + type + " blocks";
        capBtn.addEventListener("click", function () {
          var eff = window.resolveBlockBox(bs && bs[type], block.box);
          if (!eff || !Object.keys(eff).length) { alert("Style this block (fill / border / radius / text colour) first, then capture its look."); return; }
          pushHistory();
          getBlockStyles()[type] = clone(eff);
          window.applyRenderContext({ blockStyles: getBlockStyles() });
          scheduleSave(); mount(); renderInspector();
        });
        capRow.appendChild(capBtn);
        if (hasTypeDef) {
          var clrBtn = h("button", "prop-btn prop-btn--danger", "Clear default");
          clrBtn.title = "Remove the captured " + type + " default (blocks fall back to their own styling)";
          clrBtn.addEventListener("click", function () {
            pushHistory();
            delete getBlockStyles()[type];
            window.applyRenderContext({ blockStyles: getBlockStyles() });
            scheduleSave(); mount(); renderInspector();
          });
          capRow.appendChild(clrBtn);
        }
        tdBody.appendChild(capRow);
      });
    }

    function renderBlockActionsSection(block, opts) {
      opts = opts || {};
      var spaceObj = opts.spaceObj || block;                 // object holding spaceTop/spaceBottom
      var onSpace  = opts.onSpace  || function () { reapplyBlock(block); }; // PERF: single-page rebuild, not the whole world
      var doMove   = opts.move      || function (dir) { moveBlock(block, dir); };
      var doDup    = opts.duplicate || function () { duplicateBlock(block); };
      var doDelete = opts.remove    || function () { deleteBlockByRef(block); };
      var isHidden = opts.isHidden  || function () { return !!block.hidden; };
      var doHide   = opts.toggleHidden || function () { pushHistory(); block.hidden = !block.hidden; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };
      var isLocked = opts.isLocked  || function () { return !!block.locked; };
      var doLock   = opts.toggleLock || function () { pushHistory(); block.locked = !block.locked; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };

      // Item D — universal per-element alignment. Available on EVERY block via the
      // canonical footer, using the canonical segmentedLive picker. Writes block.align
      // (start|center|end); render.js maps it to alignSelf (the cross-axis in any flex
      // parent -- headerFooter children region, columns, frame). Structural enough to rebuild
      // so nested contexts re-render correctly; segmented click carries no text focus.
      // #155: the universal Level-1 container sections (Layout / Spacing / Appearance) adopt the
      // canonical sectionGroup taxonomy, buffered here and emitted by endSections() in PanelLayout
      // order (Appearance < Layout < Spacing) with the shared collapse + Edit-layout drag behaviour.
      // #165: if the CALLER already opened a buffer (a single-level inspector emitting its own
      // Content/Appearance/Behaviour sections), add ours to THAT buffer and let the caller flush —
      // so the whole panel sorts as ONE PanelLayout stream (Behaviour lands after Layout/Spacing)
      // instead of two independently-sorted cycles. Standalone callers self-manage as before.
      var ownBuffer = !sectionsBufferOpen();
      if (ownBuffer) beginSections();
      sectionGroup("Layout", "Layout", function (body) {
        segmentedIconLive("Align", [[Icon("align-left"), "start", "Start"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "end", "End"]],
          function (v) { return (block.align || "start") === v; },
          function (v) {
            if (v === "start") delete block.align; else block.align = v;
            reapplyBlock(block); reselectBlockNode(block, getSelectionTypeForBlock(block)); // PERF: one page, not the world
          }, body);
        // Vertical align (Item D2): sits directly under the horizontal Align, same
        // segmented look + vertical glyphs. Writes block.valign (top|center|bottom);
        // render maps it to auto margins on the block's flex-column parent's main axis.
        segmentedIconLive("Vertical", [[Icon("align-start-horizontal"), "top", "Top"], [Icon("align-center-horizontal"), "center", "Middle"], [Icon("align-end-horizontal"), "bottom", "Bottom"]],
          function (v) { return (block.valign || "top") === v; },
          function (v) {
            if (v === "top") delete block.valign; else block.valign = v;
            reapplyBlock(block); reselectBlockNode(block, getSelectionTypeForBlock(block)); // PERF: one page, not the world
          }, body);
        body.appendChild(h("div", "insp-hint", "Aligns this element. Center / End also position a sized element (an HTML interaction or fit-width image) within the column; a full-width block is unaffected. Vertical align centres or bottom-anchors the block when its column is taller than its content (e.g. text beside a taller image)."));
      });

      sectionGroup("Spacing", "Spacing", function (body) {
        // Space top / Space bottom sit two-up (paired numerics).
        var spaceRow = twoUp(
          iconField(Icon("arrow-up-to-line"), { value: spaceObj.spaceTop == null ? "" : spaceObj.spaceTop, unit: "px", placeholder: "auto", step: 2, min: -200, max: 200, datalist: "dl-gap", noHistory: true, title: "Space top (negative pulls tighter / overlaps)",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete spaceObj.spaceTop; else spaceObj.spaceTop = n; onSpace(); } }).wrap,
          iconField(Icon("arrow-down-to-line"), { value: spaceObj.spaceBottom == null ? "" : spaceObj.spaceBottom, unit: "px", placeholder: "auto", step: 2, min: -200, max: 200, datalist: "dl-gap", noHistory: true, title: "Space bottom (negative pulls tighter / overlaps)",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete spaceObj.spaceBottom; else spaceObj.spaceBottom = n; onSpace(); } }).wrap
        );
        spaceRow.style.marginTop = "4px";
        body.appendChild(spaceRow);
      });

      // A block can own its appearance (e.g. cardReveal styles each CARD, not the
      // grid root) and pass { appearance:false } to suppress the grid-level panel.
      if (opts.appearance !== false) renderAppearanceSection(block);

      // #155/#165: flush only the buffer WE opened; a caller that opened its own flushes it itself.
      if (ownBuffer) endSections(E.inspector);

      // §64: the per-block "Chapter recap" toggle was RETIRED — the chapter summary now
      // lives in the native quiz's completion panel (the "Chapter summary" bulleted list
      // shown after the knowledge check is passed), not scattered across arbitrary blocks.

      // Block actions (move / duplicate / slice / visibility / lock / delete) now live
      // in the STATIC canvas toolbar (single source), not the panel — fed the SAME opts
      // so a card instance etc. still retargets correctly.
      showBlockToolbar(block, opts);
    }

    // ---- uio-E-M01 (EDIT-04): the block's actions attach to the BLOCK -------------------
    // They used to be a contextual segment appended to the persistent #canvas-overlay tools bar,
    // so acting on a block meant travelling to the bottom of the screen and back — and the bar
    // then held two unrelated things at once: tools that act on the CANVAS (grid, find, comment,
    // zoom) and verbs that act on ONE selected block. The bar keeps the view tools; the verbs
    // dock above the block they belong to, where you already are.
    //
    // Positioned `fixed` off the block node's own rect, which already accounts for the world's
    // zoom transform and the viewport's scroll — so there is no second copy of the pan/zoom maths
    // here. It has to be RE-positioned whenever that rect moves, which is why positionBlockToolbar
    // stopped being a no-op and why the viewport's scroll drives it.
    var blockToolbarEl = null;
    var __toolbarNode = null;   // the DOM node the open toolbar is tracking
    // `node` is the element the bar will sit above. It is a PARAMETER rather than something this
    // function works out, because there are two producers of the bar's contents -- showBlockToolbar
    // here and renderContainerChrome's Actions cluster -- and only the caller knows which element
    // the selection is really on. The first build shipped without it: the container-chrome path
    // showed the bar and never named a node, so it drew at the viewport origin and never tracked.
    function ensureBlockToolbar(node) {
      if (node) __toolbarNode = node;
      if (blockToolbarEl) return blockToolbarEl;
      blockToolbarEl = h("div", "block-toolbar");
      blockToolbarEl.setAttribute("data-block-toolbar", "1");
      // mousedown must not steal the selection the toolbar is acting on
      blockToolbarEl.addEventListener("mousedown", function (e) { e.preventDefault(); });
      document.body.appendChild(blockToolbarEl);
      return blockToolbarEl;
    }
    // Put the bar just above the tracked block, clamped INTO the canvas viewport so a block at the
    // very top of the scroll does not push its own toolbar off-screen. Hidden outright when the
    // block has scrolled out of view — a toolbar for something you cannot see is a control pointing
    // at nothing, and it would otherwise sit over whatever IS on screen.
    function positionBlockToolbar() {
      var bar = blockToolbarEl;
      if (!bar || bar.hidden || !__toolbarNode || !__toolbarNode.isConnected) return;
      var vp = document.getElementById("canvas-viewport");
      var r = __toolbarNode.getBoundingClientRect();
      if (!r.width && !r.height) { bar.style.visibility = "hidden"; return; }
      var GAP = 6;
      if (vp) {
        var v = vp.getBoundingClientRect();
        if (r.bottom < v.top || r.top > v.bottom) { bar.style.visibility = "hidden"; return; }
        bar.style.visibility = "";
        var bw = bar.offsetWidth || 0, bh = bar.offsetHeight || 0;
        var top = r.top - bh - GAP;
        if (top < v.top + 4) top = Math.min(r.top + GAP, v.bottom - bh - 4); // no room above -> just inside
        var left = Math.max(v.left + 4, Math.min(r.left, v.right - bw - 4));
        bar.style.top = Math.round(top) + "px";
        bar.style.left = Math.round(left) + "px";
      } else {
        bar.style.visibility = "";
        bar.style.top = Math.round(r.top - (bar.offsetHeight || 0) - GAP) + "px";
        bar.style.left = Math.round(r.left) + "px";
      }
    }
    function hideBlockToolbar() {
      __toolbarNode = null;
      if (blockToolbarEl) { blockToolbarEl.innerHTML = ""; blockToolbarEl.hidden = true; }
    }
    function showBlockToolbar(block, opts) {
      opts = opts || {};
      var bar = ensureBlockToolbar(opts.node || nodeForBlock(block));
      if (!bar) return;
      bar.innerHTML = "";
      // The node the bar tracks. `opts.node` lets a retargeting caller (a card instance) name a
      // different element than the block's own; otherwise the block's rendered node is it.
      if (!__toolbarNode) { bar.hidden = true; return; } // nothing on screen to attach to
      var doMove = opts.move || function (d) { moveBlock(block, d); };
      var doDup = opts.duplicate || function () { duplicateBlock(block); };
      var doDelete = opts.remove || function () { deleteBlockByRef(block); };
      var isHidden = opts.isHidden || function () { return !!block.hidden; };
      var doHide = opts.toggleHidden || function () { pushHistory(); block.hidden = !block.hidden; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };
      var isLocked = opts.isLocked || function () { return !!block.locked; };
      var doLock = opts.toggleLock || function () { pushHistory(); block.locked = !block.locked; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };

      var up = iconBtn("arrowUp", "Move up"); up.addEventListener("click", function () { doMove(-1); }); bar.appendChild(up);
      var down = iconBtn("arrowDown", "Move down"); down.addEventListener("click", function () { doMove(1); }); bar.appendChild(down);
      var dup = iconBtn("duplicate", "Duplicate"); dup.addEventListener("click", function () { doDup(); }); bar.appendChild(dup);
      // #174: clear content — reset this block's subtree to a blank skeleton (keeps structure).
      var clr = iconBtn("eraser", "Clear content (keep structure)"); clr.addEventListener("click", function () { clearBlockContentAction([block]); }); bar.appendChild(clr);
      if (canSplitAtBlock(block)) { var slice = iconBtn("slice", "Split page here"); slice.addEventListener("click", function () { splitPageAtBlock(block); }); bar.appendChild(slice); }
      bar.appendChild(h("div", "tb-sep"));
      var hide = iconBtn(isHidden() ? "eyeOff" : "eye", isHidden() ? "Show block" : "Hide block"); if (isHidden()) hide.classList.add("is-off"); hide.addEventListener("click", function () { doHide(); }); bar.appendChild(hide);
      var lock = iconBtn(isLocked() ? "lock" : "unlock", isLocked() ? "Unlock block" : "Lock block"); if (isLocked()) lock.classList.add("is-on"); lock.addEventListener("click", function () { doLock(); }); bar.appendChild(lock);
      bar.appendChild(h("div", "tb-sep"));
      var del = iconBtn("trash", "Delete block", true); del.addEventListener("click", function () { doDelete(); }); bar.appendChild(del);

      bar.hidden = false;
      bar.style.visibility = "hidden";  // placed before it is shown, so it never flashes at 0,0
      positionBlockToolbar();
    }
    // The rendered node for a block, by the id the canvas already stamps on it.
    function nodeForBlock(block) {
      if (!block || !block.id || typeof document === "undefined") return null;
      // render.js stamps `data-id` on every block it draws (src/render.js). One attribute, so
      // there is no guessing which one the canvas used.
      return document.querySelector('#canvas-viewport [data-id="' + block.id + '"]');
    }

    kernel.expose({
      renderBlockActionsSection: renderBlockActionsSection, ensureBlockToolbar: ensureBlockToolbar, hideBlockToolbar: hideBlockToolbar,
      positionBlockToolbar: positionBlockToolbar, nodeForBlock: nodeForBlock
    });
  }

  window.VersoBlockActions = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoBlockActions;
})();
