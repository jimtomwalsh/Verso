// editor/outliner.js -- the document seen as a list (arch-P3b-07i).
//
// The canvas shows a course as space; this shows it as structure. Chapters twirl down to pages,
// pages twirl down to their blocks, and a container twirls down to what is inside it -- so the
// tree goes as deep as the document does rather than stopping at the page, which is what makes it
// usable on a course of eighty pages.
//
// IT IS THE SAME SELECTION, not a parallel one. Clicking a row selects on the canvas, the canvas
// selecting scrolls the row into view, and multi-select is one set shared by the tree, the marquee
// and the canvas. A second selection model would be a second source of truth, and every bug in
// this app's history that took a day to find was a second source of truth.
//
// It also carries the tree's own verbs: drag to reorder pages and chapters, drag a page onto
// another to reparent it, and the right-click menu that offers what a chapter, a page or a block
// can each do. Blocks reorder through the shared drop resolver rather than a second implementation.
//
// The multi-select ARRAYS stay in editor.js, because the marquee and the canvas read them too;
// this file mutates them in place and reassigns them through two setters.
//
// Editor chrome only: it navigates and reorders the document, and renders none of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "mount", "pushHistory", "setSelection", "makeDropTarget", "findBlockParent",
      "clearSelection", "focusFrame", "showContextMenu", "pagesList", "blurActiveText", "cleanupColumns",
      "canMergeTextBoxes", "iconBtn", "view", "reselectBlockNode", "saveBlockAsComponent", "deleteSelection",
      "COMPONENTS", "renderInspector", "setDragPayload", "reorderChapter", "firstCopyOf", "setPageTitle",
      "canvas", "drawConnectors", "twoStateText", "mergeTextValues", "ensureBlockToolbar", "resolveComponentDef",
      "hotspotEntryScreen", "clearDropMarks", "previewVariant", "confirmModal", "deleteChapter", "pageDisplayName",
      "copySelection", "pastePage", "duplicatePage", "hasMergeableNext", "mergePageWithNext", "savePageAsLibraryMaster",
      "deletePage", "duplicateBlock", "clearBlockContentAction", "deleteBlockByRef", "refreshGridOverlay", "setMultiSel",
      "setMultiSelPages", "cap", "doc", "selection", "world", "multiSel",
      "multiSelPages", "currentPage", "frameDescs", "activeVariant", "interactMode",
      "pageClipboard",
      "setCurrentPage",
      "pageNumberOf", "pageTitlePart"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        mount = E.mount,
        pushHistory = E.pushHistory,
        setSelection = E.setSelection,
        makeDropTarget = E.makeDropTarget,
        findBlockParent = E.findBlockParent,
        clearSelection = E.clearSelection,
        focusFrame = E.focusFrame,
        showContextMenu = E.showContextMenu,
        pagesList = E.pagesList,
        blurActiveText = E.blurActiveText,
        cleanupColumns = E.cleanupColumns,
        canMergeTextBoxes = E.canMergeTextBoxes,
        iconBtn = E.iconBtn,
        view = E.view,
        reselectBlockNode = E.reselectBlockNode,
        saveBlockAsComponent = E.saveBlockAsComponent,
        deleteSelection = E.deleteSelection,
        COMPONENTS = E.COMPONENTS,
        renderInspector = E.renderInspector,
        setDragPayload = E.setDragPayload,
        reorderChapter = E.reorderChapter,
        firstCopyOf = E.firstCopyOf,
        setPageTitle = E.setPageTitle,
        canvas = E.canvas,
        drawConnectors = E.drawConnectors,
        twoStateText = E.twoStateText,
        mergeTextValues = E.mergeTextValues,
        ensureBlockToolbar = E.ensureBlockToolbar,
        resolveComponentDef = E.resolveComponentDef,
        hotspotEntryScreen = E.hotspotEntryScreen,
        clearDropMarks = E.clearDropMarks,
        previewVariant = E.previewVariant,
        confirmModal = E.confirmModal,
        deleteChapter = E.deleteChapter,
        pageDisplayName = E.pageDisplayName,
        copySelection = E.copySelection,
        pastePage = E.pastePage,
        duplicatePage = E.duplicatePage,
        hasMergeableNext = E.hasMergeableNext,
        mergePageWithNext = E.mergePageWithNext,
        savePageAsLibraryMaster = E.savePageAsLibraryMaster,
        deletePage = E.deletePage,
        duplicateBlock = E.duplicateBlock,
        clearBlockContentAction = E.clearBlockContentAction,
        deleteBlockByRef = E.deleteBlockByRef,
        refreshGridOverlay = E.refreshGridOverlay,
        pageNumberOf = E.pageNumberOf,
        pageTitlePart = E.pageTitlePart,
        setMultiSel = E.setMultiSel,
        setMultiSelPages = E.setMultiSelPages,
        cap = E.cap;

    // ---- left panel ----------------------------------------------------------
    // ---- Structure outliner: pages twirl down to their blocks ----------------
    var pageItems = [];
    var openPages = {};
    var openChapters = {}; // module G: chapter groups twirled open in the outliner (default open; false = collapsed)
    // DD: which container blocks (columns / group / frame) are twirled open in the
    // outliner. Keyed by block REF (blocks are id-less until they join an interaction,
    // so a ref Set is the stable key; survives renderStructure, resets on doc reload).
    var openContainers = (typeof Set !== "undefined") ? new Set() : { has: function () { return false; }, add: function () {}, delete: function () {} };
    // The twirl state, asked for by name. The canvas reveals a container's children by opening the
    // same set the tree opens, so this is one map rather than two (arch-P3b-07i).
    function openPagesMap() { return openPages; }
    function openChaptersMap() { return openChapters; }
    function openContainersSet() { return openContainers; }
    var outlineAnchor = null; // {kind:"block",pi,bi} | {kind:"page",pi} — for Shift-range
    function inMulti(block) { return E.multiSel.indexOf(block) !== -1; }
    function inMultiPage(i) { return E.multiSelPages.indexOf(i) !== -1; }
    function toggleMulti(block) {
      var i = E.multiSel.indexOf(block);
      if (i === -1) E.multiSel.push(block); else E.multiSel.splice(i, 1);
      if (E.multiSel.length) blurActiveText(); // multi-selecting exits text edit
      renderStructure();
      refreshCanvasSelection();
    }
    function toggleMultiPage(i) {
      var k = E.multiSelPages.indexOf(i);
      if (k === -1) E.multiSelPages.push(i); else E.multiSelPages.splice(k, 1);
      renderStructure();
      refreshCanvasSelection();
    }
    function clearMulti() { if (E.multiSel.length) E.setMultiSel([]); }
    function clearMultiPages() { if (E.multiSelPages.length) E.setMultiSelPages([]); }
    function clearAllMulti() { clearMulti(); clearMultiPages(); }
    // the top-level page block containing an event target (so a shift-click
    // anywhere inside a block selects the whole block, not an inner leaf)
    function canvasTopBlock(target) {
      var node = target;
      while (node && node !== canvas) {
        if (node.classList && node.classList.contains("canvas-block") && node.parentElement && node.parentElement.classList.contains("page")) return node;
        node = node.parentNode;
      }
      return null;
    }
    function canvasNodeForBlock(block) {
      if (!E.world) return null;
      var all = E.world.querySelectorAll(".canvas-block");
      for (var i = 0; i < all.length; i++) if (all[i].__block === block) return all[i];
      return null;
    }
    // Encompassing outline for a selected group/card. A group is display:contents
    // (no box of its own), so we union its children's rects and draw an overlay.
    function drawContainerOutline(b) {
      var node = canvasNodeForBlock(b); if (!node) return;
      var frame = node.closest(".frame"); if (!frame) return;
      var zoom = (view && view.zoom) || 1;
      var fr = frame.getBoundingClientRect();
      var boxes = [];
      if (b.type === "frame") { boxes.push(node.getBoundingClientRect()); }
      else {
        Array.prototype.forEach.call(node.children, function (c) {
          if (c.classList && c.classList.contains("block-group__empty")) return;
          boxes.push(c.getBoundingClientRect());
        });
        if (!boxes.length) boxes.push(node.getBoundingClientRect());
      }
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      boxes.forEach(function (r) { minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); });
      if (!isFinite(minX)) return;
      var pad = 6;
      var ol = h("div", "group-outline");
      ol.appendChild(h("div", "group-outline__label", b.type === "group" ? "Group" : "Card"));
      ol.style.left = (((minX - fr.left) / zoom) - pad) + "px";
      ol.style.top = (((minY - fr.top) / zoom) - pad) + "px";
      ol.style.width = (((maxX - minX) / zoom) + pad * 2) + "px";
      ol.style.height = (((maxY - minY) / zoom) + pad * 2) + "px";
      frame.appendChild(ol);
    }
    // redraw multi-select highlights + the encompassing group/card outline
    function refreshCanvasSelection() {
      if (!E.world) return;
      Array.prototype.forEach.call(E.world.querySelectorAll(".is-multi-canvas"), function (n) { n.classList.remove("is-multi-canvas"); });
      Array.prototype.forEach.call(E.world.querySelectorAll(".frame.is-multi-page"), function (n) { n.classList.remove("is-multi-page"); });
      Array.prototype.forEach.call(E.world.querySelectorAll(".group-outline"), function (n) { n.remove(); });
      // A 2+ multi-selection owns the highlight: drop any lingering single is-selected
      // marker (e.g. the seed block a Shift/Cmd+click promoted into the set) so the
      // canvas doesn't double-highlight one member.
      if (E.multiSel.length >= 2) Array.prototype.forEach.call(E.world.querySelectorAll(".is-selected"), function (n) { n.classList.remove("is-selected"); });
      E.multiSel.forEach(function (b) { var n = canvasNodeForBlock(b); if (n) n.classList.add("is-multi-canvas"); });
      E.multiSelPages.forEach(function (i) { var f = E.frameDescs[i] && E.frameDescs[i].frame; if (f) f.classList.add("is-multi-page"); });
      if (E.selection.type === "block" && E.selection.block && (E.selection.block.type === "group" || E.selection.block.type === "frame")) drawContainerOutline(E.selection.block);
      updateDragAffordance();
      // Contextual connectors depend on the current selection, so redraw them here —
      // the single choke point every selection change (single / multi / marquee /
      // outliner) routes through. Interact-mode only (connectors don't exist in Design);
      // not a mousemove hot path (all callers are discrete). The heavy rebuild paths
      // (mount / reapplyWorld / reapplyPage) also call drawConnectors directly — the
      // extra draw here is idempotent (it drops the prior SVG layer first).
      if (E.interactMode) drawConnectors();
    }
    // §74 PHASE 2: in select-first mode the SELECTED block's node becomes the drag
    // surface (draggable=true) so a press-drag on it moves it; every other block is
    // non-draggable, and a block being text-edited is non-draggable (caret wins).
    // columns/group have no box to grab (reorder them from the outliner), so they
    // are never made draggable — parity with the old gripper, which skipped them.
    function updateDragAffordance() {
      if (!E.world) return;
      var sel = null;
      if (twoStateText() && E.selection && E.selection.node &&
          (E.selection.type === "block" || E.selection.type === "field" || E.selection.type === "instance" ||
           E.selection.type === "embed" || E.selection.type === "navButton")) {
        var host = (E.selection.node.closest && E.selection.node.closest(".canvas-block")) || E.selection.node;
        var editing = E.world.querySelector(".is-text-editing");
        var b = host && host.__block;
        if (b && !b.locked && b.type !== "group" && b.type !== "columns" &&
            !(editing && host.contains(editing))) sel = host;
      }
      Array.prototype.forEach.call(E.world.querySelectorAll(".canvas-block[draggable=\"true\"]"), function (n) {
        if (n !== sel) n.removeAttribute("draggable");
      });
      if (sel) sel.setAttribute("draggable", "true");
    }
    // Group the multi-selected blocks (must share a page) into a new Frame, at the
    // position of the earliest, preserving order. This is the "select several ->
    // group -> save as component" flow.
    function groupMulti() {
      if (E.multiSel.length < 2) return;
      // resolve each block by REF (findBlockParent) so nested blocks resolve too. Grouping
      // needs ONE shared parent array (a group is a single node in one place): a page's top
      // level OR one column / card's children. Cross-parent -> a clear message, no silent drop.
      var locs = [];
      for (var i = 0; i < E.multiSel.length; i++) {
        var res = null;
        for (var pi = 0; pi < E.doc.pages.length; pi++) { var r = findBlockParent(E.doc.pages[pi].blocks, E.multiSel[i]); if (r) { res = r; break; } }
        if (!res) { clearMulti(); renderStructure(); return; }
        locs.push({ block: E.multiSel[i], parentArray: res.parentArray, index: res.index });
      }
      var pa = locs[0].parentArray;
      if (locs.some(function (l) { return l.parentArray !== pa; })) { alert("To group, select blocks with the same parent — all at the page level, or all within one column / card."); return; }
      locs.sort(function (a, b) { return a.index - b.index; });
      var insertAt = locs[0].index;
      var children = locs.map(function (l) { return l.block; });
      pushHistory();
      // remove highest index first so earlier indices stay valid
      locs.slice().sort(function (a, b) { return b.index - a.index; }).forEach(function (l) { pa.splice(l.index, 1); });
      // an INVISIBLE group (not a styled Card) — grouping must not change the look
      var frame = { type: "group", children: children };
      pa.splice(insertAt, 0, frame);
      E.doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
      clearMulti();
      mount();
      reselectBlockNode(frame, "block");
      return frame; // #22: lets saveSelectionAsSectionMaster capture the resulting group directly
    }
    // #22: a "section" master is just a multi-block selection, grouped then captured --
    // reuses groupMulti (already enforces the "one shared parent, adjacent" contract a
    // section needs) + saveBlockAsComponent (already works on ANY block, a group included)
    // verbatim. No new capture/render/override/axis machinery: a group's children are
    // walked by the SAME generic children-array logic every other container already uses
    // (walkTextBlocks, applyInstanceOverrides, resolveAxisNode all check node.children with
    // no type-specific branching), so overrides/axis/detach/export on a section master work
    // for free once it's a library entry -- confirmed by browser-verify, not just asserted.
    function saveSelectionAsSectionMaster() {
      var frame = groupMulti();
      if (frame) saveBlockAsComponent(frame);
    }
    // #131: merge the multi-selected TEXT blocks (>=2, all text-style types) into ONE.
    // Fold every body — in CANVAS STACK ORDER (parent-array index, NOT selection order) —
    // into the TOP block joined by line breaks, delete the rest, reselect the survivor.
    // Requires one shared parent (mirrors groupMulti): merging across columns/cards is
    // ambiguous, so bail with a clear message rather than silently drop blocks.
    function mergeTextBoxes() {
      if (!canMergeTextBoxes(E.multiSel)) return;
      var locs = [];
      for (var i = 0; i < E.multiSel.length; i++) {
        var res = null;
        for (var pi = 0; pi < E.doc.pages.length; pi++) { var r = findBlockParent(E.doc.pages[pi].blocks, E.multiSel[i]); if (r) { res = r; break; } }
        if (!res) { clearMulti(); renderStructure(); return; }
        locs.push({ block: E.multiSel[i], parentArray: res.parentArray, index: res.index });
      }
      var pa = locs[0].parentArray;
      if (locs.some(function (l) { return l.parentArray !== pa; })) { alert("To merge, select text blocks with the same parent — all at the page level, or all within one column / card."); return; }
      locs.sort(function (a, b) { return a.index - b.index; });
      var survivor = locs[0].block;
      pushHistory();
      // Fold bodies into the top block (its type/style wins), then remove the merged-in
      // blocks highest index first so earlier indices stay valid during the splice.
      survivor.text = mergeTextValues(locs.map(function (l) { return l.block.text; }));
      locs.slice(1).sort(function (a, b) { return b.index - a.index; }).forEach(function (l) { pa.splice(l.index, 1); });
      E.doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
      clearMulti();
      mount();
      reselectBlockNode(survivor, "block");
    }
    // #131: the multi-selection floating tool bar (canvas overlay actions segment).
    // renderInspector hides the single-block bar before the multi branch, so re-show a
    // set-scoped bar: Merge (only when the whole set is text) / Group / Delete.
    function showMultiToolbar() {
      var bar = ensureBlockToolbar();
      if (!bar) return; // canvas overlay bar not present (panels hidden)
      bar.innerHTML = "";
      if (canMergeTextBoxes(E.multiSel)) {
        var merge = iconBtn("merge", "Merge text boxes");
        merge.addEventListener("click", function () { mergeTextBoxes(); });
        bar.appendChild(merge);
      }
      var group = iconBtn("group", "Group selection");
      group.addEventListener("click", function () { groupMulti(); });
      bar.appendChild(group);
      bar.appendChild(h("div", "tb-sep"));
      var del = iconBtn("trash", "Delete " + E.multiSel.length + " items", true);
      del.addEventListener("click", function () { deleteSelection(); });
      bar.appendChild(del);
      bar.hidden = false;
    }
    // Inverse of groupMulti: unwrap a `group` block, splicing its children back
    // into the group's parent array at the group's position (order preserved).
    // Parent-resolution mirrors deleteBlockByRef, so a group nested in a column or
    // another group unwraps in place too. cleanupColumns tidies any 1-col leftovers.
    function ungroupBlock(block) {
      if (!block || block.type !== "group") return;
      var children = (block.children || []).slice();
      var loc = null;
      for (var pi = 0; pi < E.doc.pages.length; pi++) {
        var res = findBlockParent(E.doc.pages[pi].blocks, block);
        if (res) { loc = res; break; }
      }
      if (!loc) return;
      pushHistory();
      var args = [loc.index, 1].concat(children); // replace the group with its children
      loc.parentArray.splice.apply(loc.parentArray, args);
      E.doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
      clearSelection(); mount();
      if (children.length) { var n = canvasNodeForBlock(children[0]); if (n) selectByType(n, children[0]); }
    }
    // Issue #13 (parent #22): the DS LeftPanel block iconography — each block type
    // maps to a Lucide glyph resolved through the Icon accessor (no text glyphs).
    var BLOCK_LUCIDE = {
      heading: "heading", subheading: "type", paragraph: "align-left", quote: "quote",
      list: "list", note: "message-square-warning", image: "image", divider: "minus",
      spacer: "move-vertical", frame: "square", group: "group", componentGrid: "component",
      navButton: "navigation", modeToggle: "contrast", checkbox: "check-square",
      htmlEmbed: "code-xml", webEmbed: "square-play", columns: "columns-2", table: "table", quiz: "list-checks",
      hotspot: "target", courseNav: "menu", accordion: "panels-top-left", cardReveal: "layers", cardDeck: "copy",
      sequence: "workflow", libraryInstance: "component"
    };
    function blockIcon(b) { return BLOCK_LUCIDE[b.type] || "square"; }
    // A DS twirl caret (Lucide chevron-right, rotates to chevron-down when open). The
    // glyph is resolved at runtime via the Icon accessor, so no inline markup lives in
    // this source (the chrome conformance gate stays green). Ghost = an empty spacer
    // that keeps leaf rows aligned under their siblings' carets.
    function outlineCaret(open, ghost) {
      var c = h("span", "tree-caret" + (open ? " is-open" : "") + (ghost ? " tree-caret--ghost" : ""));
      if (!ghost && window.Icon) c.innerHTML = window.Icon("chevron-right");
      return c;
    }
    function outlineIcon(cls, name) {
      var s = h("span", cls);
      if (window.Icon) s.innerHTML = window.Icon(name);
      return s;
    }
    function blockLabel(b) {
      if (b.name) return b.name; // author-given outliner name (editor chrome; render ignores it)
      if (b.type === "heading") return b.text || "Heading";
      if (b.type === "subheading") return b.text || "Subheading";
      if (b.type === "paragraph") return b.text ? b.text.slice(0, 26) : "Paragraph";
      if (b.type === "quote") return b.text ? b.text.slice(0, 26) : "Quote";
      if (b.type === "list") return "Bulleted list";
      if (b.type === "note") return b.text ? b.text.slice(0, 26) : "Note";
      if (b.type === "image") return "Image";
      if (b.type === "divider") return "Divider";
      if (b.type === "spacer") return "Spacer (" + (b.height == null ? 40 : b.height) + "px)";
      if (b.type === "frame") return "Card (" + ((b.children || []).length) + ")";
      if (b.type === "group") return "Group (" + ((b.children || []).length) + ")";
      if (b.type === "componentGrid") return (COMPONENTS[b.component] ? COMPONENTS[b.component].name : b.component) + " ×" + ((b.instances || []).length);
      if (b.type === "libraryInstance") { var libDef = resolveComponentDef(b.ref); return (libDef && libDef.name) || b.ref || "Library instance"; }
      if (b.type === "navButton") return b.text ? b.text.slice(0, 24) : "Navigation button";
      if (b.type === "modeToggle") return "Light / dark toggle";
      if (b.type === "checkbox") return b.label ? b.label.slice(0, 24) : "Checkbox";
      if (b.type === "htmlEmbed") return "HTML Interaction";
      if (b.type === "webEmbed") return "Web Embed";
      if (b.type === "columns") return "Columns Layout (" + (b.columns ? b.columns.length : 0) + " columns)";
      if (b.type === "quiz") return "Quiz (" + ((b.questions || []).length) + " Q)";
      if (b.type === "hotspot") { var hsE = hotspotEntryScreen(b); return "Image hotspots (" + ((hsE && hsE.markers || []).length) + ")"; }
      if (b.type === "courseNav") return "Learner nav bar (" + ((b.sections || []).length) + ")";
      if (b.type === "cardDeck") return "Card deck (" + ((b.items || []).length) + ")";
      if (b.type === "cardReveal") return "Card reveal (" + ((b.items || []).length) + ")";
      if (b.type === "accordion") return (b.mode === "tabs" ? "Tabs (" : "Accordion (") + ((b.items || []).length) + ")";
      if (b.type === "sequence") return "Sequence (" + ((b.items || []).length) + ")";
      return b.type;
    }
    // DD: a container block's twirl-able children, grouped for display. columns ->
    // one group per column (labelled); group/frame -> a single group of `children`.
    // Returns null for non-containers (incl. componentGrid, whose "children" are
    // instances selected on the canvas, not blocks). Empty containers return null so
    // no caret is drawn.
    function containerChildGroups(block) {
      if (block.type === "columns" && block.columns && block.columns.length) {
        var cg = [];
        block.columns.forEach(function (col, ci) {
          if (col && col.length) cg.push({ label: "Column " + (ci + 1), blocks: col });
        });
        return cg.length ? cg : null;
      }
      if ((block.type === "group" || block.type === "frame") && block.children && block.children.length) {
        return [{ label: null, blocks: block.children }];
      }
      // items[]-based containers (cardReveal / cardDeck / accordion / sequence): each item
      // holds authored child blocks (item.children, plus item.front on a flip card). The
      // canvas renders these as real, selectable nested blocks, but the outliner used to
      // stop at the container -> nested blocks (e.g. an empty group tucked in a card) were
      // unreachable from the tree. Expose them, one group per item, like columns.
      if (Array.isArray(block.items) && block.items.length &&
          (block.type === "cardDeck" || block.type === "cardReveal" || block.type === "accordion" || block.type === "sequence")) {
        var noun = block.type === "accordion" ? "Section" : block.type === "sequence" ? "Step" : "Card";
        var isFlip = block.type === "cardReveal" && block.revealStyle === "flip";
        var ig = [];
        block.items.forEach(function (it, ii) {
          if (!it) return;
          var name = (it.title != null && String(it.title).trim()) ? String(it.title).trim()
            : (it.label != null && String(it.label).trim()) ? String(it.label).trim()
            : noun + " " + (ii + 1);
          // #134: emit a group for EVERY item (and both flip sides) even when empty, each
          // carrying a lazy ref to the exact array -- so an empty card/side is both visible in
          // the tree and a drop target (the outliner drop resolves arrayOwner[arrayKey], never
          // the card's non-existent block.children). A card gets both faces when the block is a
          // flip card OR the item already carries a front array (so front content is reachable).
          var wantFront = isFlip || Array.isArray(it.front);
          if (wantFront) {
            ig.push({ label: name + " (front)", blocks: it.front || [], arrayOwner: it, arrayKey: "front" });
            ig.push({ label: name + " (back)", blocks: it.children || [], arrayOwner: it, arrayKey: "children" });
          } else {
            ig.push({ label: name, blocks: it.children || [], arrayOwner: it, arrayKey: "children" });
          }
        });
        return ig.length ? ig : null;
      }
      return null;
    }
    // DD: select a nested block by REF (no page index into page.blocks — it lives
    // inside a container). Reuses the canvas node lookup + shared selectByType path.
    function selectBlockRef(pi, block) {
      clearAllMulti();
      focusFrame(pi); setActivePage(pi);
      var node = canvasNodeForBlock(block);
      if (!node) { clearSelection(); return; }
      selectByType(node, block);
    }
    // Flattened VISIBLE outline order of every selectable block (across chapters, pages,
    // and nested containers/columns — respecting the open/collapsed state, so it mirrors
    // exactly what the user sees). Powers Shift-range select that spans columns AND pages.
    function flatOutlineBlocks() {
      var out = [];
      function walkBlocks(blocks, pi) {
        (blocks || []).forEach(function (b) {
          out.push({ block: b, pi: pi });
          var g = containerChildGroups(b);
          if (g && openContainers.has(b)) g.forEach(function (grp) { walkBlocks(grp.blocks, pi); });
        });
      }
      function walkPage(page, pi) { if (openPages[page.id]) walkBlocks(page.blocks, pi); }
      var idxOf = {}; E.doc.pages.forEach(function (p, i) { idxOf[p.id] = i; });
      var chGroups = (window.groupPagesByChapter && Array.isArray(E.doc.chapters) && E.doc.chapters.length)
        ? window.groupPagesByChapter(E.doc) : null;
      if (chGroups) {
        chGroups.forEach(function (ch) {
          if (openChapters[ch.id] === false) return;
          (ch.pages || []).forEach(function (page) { walkPage(page, idxOf[page.id]); });
        });
      } else {
        E.doc.pages.forEach(function (page, pi) { walkPage(page, pi); });
      }
      return out;
    }
    function flatIndexOfBlock(flat, b) { for (var i = 0; i < flat.length; i++) if (flat[i].block === b) return i; return -1; }
    window.__flatOutlineBlocks = flatOutlineBlocks; // headless test hook
    window.__multiSelCount = function () { return E.multiSel.length; }; // headless test hook
    // Shared block-row click handler used at EVERY depth (top-level + nested), so Shift /
    // Cmd multi-select works uniformly across columns, containers and pages.
    function handleBlockRowClick(e, pi, block, bi, depth) {
      if (e.metaKey || e.ctrlKey) {
        clearMultiPages(); toggleMulti(block);
        outlineAnchor = { kind: "block", block: block, pi: pi };
        blurActiveText(); renderStructure(); refreshCanvasSelection(); renderInspector(); return;
      }
      if (e.shiftKey && outlineAnchor && outlineAnchor.kind === "block" && outlineAnchor.block) {
        var flat = flatOutlineBlocks();
        var ai = flatIndexOfBlock(flat, outlineAnchor.block), ci = flatIndexOfBlock(flat, block);
        if (ai !== -1 && ci !== -1) {
          var a = Math.min(ai, ci), z = Math.max(ai, ci);
          E.setMultiSel([]); clearMultiPages();
          for (var k = a; k <= z; k++) E.multiSel.push(flat[k].block);
          blurActiveText(); renderStructure(); refreshCanvasSelection(); renderInspector(); return;
        }
      }
      clearAllMulti(); outlineAnchor = { kind: "block", block: block, pi: pi };
      if (depth === 0) selectBlock(pi, bi); else selectBlockRef(pi, block);
    }
    // DD: render one outliner block row (recursive). depth 0 = top-level page block
    // (keeps drag-reorder + multi-select, index `bi` into page.blocks); depth > 0 =
    // nested container child (select-only, no drag, ref-based selection). Container
    // rows get a twirl caret; their children recurse indented underneath.
    function appendBlockRow(list, page, pi, block, bi, depth) {
      var groups = containerChildGroups(block);
      var br = h("div", "tree-block" + (block.type === "componentGrid" ? " tree-block--component" : "") + (E.selection.block === block ? " is-selected" : "") + (inMulti(block) ? " is-multi" : "") + (block.hidden ? " is-hidden" : "") + (block.locked ? " is-locked" : ""));
      if (depth > 0) br.style.paddingLeft = (6 + depth * 14) + "px";
      if (groups) {
        var isOpen = openContainers.has(block);
        var ccaret = outlineCaret(isOpen, false);
        ccaret.addEventListener("click", function (e) {
          e.stopPropagation();
          if (openContainers.has(block)) openContainers.delete(block); else openContainers.add(block);
          renderStructure();
        });
        br.appendChild(ccaret);
      } else if (depth > 0) {
        br.appendChild(outlineCaret(false, true)); // align leaves under sibling carets
      }
      br.appendChild(outlineIcon("tree-block__icon", blockIcon(block)));
      var bname = h("span", "tree-block__name", blockLabel(block));
      br.appendChild(bname);
      wireOutlineBlockMenu(br, page, pi, block, bi, depth, bname);
      if (block.hidden) br.appendChild(h("span", "tree-block__flag", "hidden"));
      if (block.locked) br.appendChild(h("span", "tree-block__flag", "locked"));

      if (depth === 0) {
        br.setAttribute("draggable", block.locked ? "false" : "true");
        br.addEventListener("click", function (e) { handleBlockRowClick(e, pi, block, bi, 0); });
        br.addEventListener("dragstart", function (e) {
          // Carry the block REF (not just index) -- handleDrop's move branch
          // resolves and removes the source by reference; index-only payloads
          // were silently no-op'ing (and dirtying undo) after the payload shapes
          // diverged from the canvas handle.
          setDragPayload({ kind: "move", page: pi, block: block, index: bi });
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", ""); } catch (_) {}
          br.classList.add("is-dragging");
          document.body.classList.add("is-dragging-block");
        });
        br.addEventListener("dragend", function () {
          br.classList.remove("is-dragging");
          clearDropMarks();
          setDragPayload(null);
          document.body.classList.remove("is-dragging-block");
        });
      } else {
        br.setAttribute("draggable", "false");
        br.addEventListener("click", function (e) { handleBlockRowClick(e, pi, block, bi, depth); });
      }
      // TTT: drop target. A CONTAINER row (frame/group/columns, any depth) accepts a
      // "drop into" (append to its children / first column); a top-level LEAF row keeps
      // the reorder-at-index drop. Nested leaves aren't drop targets.
      if (groups) {
        // #134: items-based containers (cards/accordion/sequence) have no block.children --
        // route a block-row drop into the FIRST item's array; group/frame/columns keep intoContainer.
        var isItems = Array.isArray(block.items) &&
          (block.type === "cardDeck" || block.type === "cardReveal" || block.type === "accordion" || block.type === "sequence");
        if (isItems) {
          makeDropTarget(br, (function (blk) { return function () {
            var it0 = null; for (var z = 0; z < blk.items.length; z++) { if (blk.items[z]) { it0 = blk.items[z]; break; } }
            if (!it0) return null;
            var arr = (it0.children = it0.children || []);
            return { intoBlocks: { arrayRef: arr, ownerBlock: blk } };
          }; })(block), "drop-into");
        } else {
          makeDropTarget(br, (function (b) { return function () { return { intoContainer: b }; }; })(block), "drop-into");
        }
      } else if (depth === 0) {
        makeDropTarget(br, { page: pi, index: bi });
      }
      list.appendChild(br);

      if (groups && openContainers.has(block)) {
        groups.forEach(function (g) {
          if (g.label != null) {
            var cap = h("div", "tree-col-cap" + (g.arrayOwner ? " tree-col-cap--drop" : ""), g.label);
            cap.style.paddingLeft = (6 + (depth + 1) * 14) + "px";
            // #134: a card/side cap (incl. an empty one) is a drop target appending into its
            // exact items[i].children / .front array (resolved + created lazily at drop).
            if (g.arrayOwner) {
              makeDropTarget(cap, (function (gg, blk) { return function () {
                var arr = (gg.arrayOwner[gg.arrayKey] = gg.arrayOwner[gg.arrayKey] || []);
                return { intoBlocks: { arrayRef: arr, ownerBlock: blk } };
              }; })(g, block), "drop-into");
            }
            list.appendChild(cap);
          }
          g.blocks.forEach(function (child) { appendBlockRow(list, page, pi, child, -1, depth + 1); });
        });
      }
    }
    // ---- outliner reorder: drag PAGES + CHAPTERS (blocks already reorder via the
    // block DnD above). Isolated from that system: its own `treeDrag` state + native
    // HTML5 drag on the tree rows, so it never touches the block dragPayload path.
    // Model ops keep the column-major invariant (pages contiguous per chapter, valid
    // integer play order) so canvas + nav stay correct. -----------------------------
    var treeDrag = null; // { kind:"page", id } | { kind:"chapter", id }
    function clearTreeMarks() {
      Array.prototype.forEach.call(document.querySelectorAll(".tree-drop-before,.tree-drop-after,.tree-drop-into"), function (el) {
        el.classList.remove("tree-drop-before", "tree-drop-after", "tree-drop-into");
      });
    }
    // move a page to (before/after) a reference page, or append to a chapter when
    // refPageId is null; reassign its chapter, then re-sort column-major so the
    // chapter blocks stay contiguous and currentPage/play-order stay valid.
    function structMovePage(dragId, refPageId, after, destChapterId) {
      var pi = E.doc.pages.findIndex(function (p) { return p.id === dragId; });
      if (pi < 0) return;
      if (refPageId && refPageId === dragId) return; // self-drop = no-op
      pushHistory();
      var curId = E.doc.pages[E.currentPage] && E.doc.pages[E.currentPage].id;
      var page = E.doc.pages[pi];
      if (destChapterId != null) page.chapterId = destChapterId;
      E.doc.pages.splice(pi, 1);
      var insertAt;
      if (refPageId) {
        var ri = E.doc.pages.findIndex(function (p) { return p.id === refPageId; });
        insertAt = ri < 0 ? E.doc.pages.length : (after ? ri + 1 : ri);
      } else {
        insertAt = E.doc.pages.length; // dropped on a chapter header -> end of that chapter
      }
      E.doc.pages.splice(insertAt, 0, page);
      if (window.resortColumnMajor) E.doc.pages = window.resortColumnMajor(E.doc.pages, E.doc.chapters);
      if (curId) { var ni = E.doc.pages.findIndex(function (p) { return p.id === curId; }); if (ni >= 0) E.setCurrentPage(ni); }
      mount();
    }
    // reorder a chapter to (before/after) a reference chapter; renumber order + re-sort.
    function structMoveChapter(dragId, refId, after) {
      if (dragId === refId) return;
      var chs = (E.doc.chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var di = chs.findIndex(function (c) { return c.id === dragId; });
      if (di < 0) return;
      pushHistory();
      var curId = E.doc.pages[E.currentPage] && E.doc.pages[E.currentPage].id;
      var drag = chs.splice(di, 1)[0];
      var ri = chs.findIndex(function (c) { return c.id === refId; });
      var at = ri < 0 ? chs.length : (after ? ri + 1 : ri);
      chs.splice(at, 0, drag);
      chs.forEach(function (c, i) { c.order = i; });
      if (window.resortColumnMajor) E.doc.pages = window.resortColumnMajor(E.doc.pages, E.doc.chapters);
      if (curId) { var ni = E.doc.pages.findIndex(function (p) { return p.id === curId; }); if (ni >= 0) E.setCurrentPage(ni); }
      mount();
    }
    function wireTreePageDrag(prow, page) {
      prow.setAttribute("draggable", "true");
      prow.addEventListener("dragstart", function (e) {
        treeDrag = { kind: "page", id: page.id };
        try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch (_) {}
        e.stopPropagation();
      });
      prow.addEventListener("dragend", function () { treeDrag = null; clearTreeMarks(); });
      prow.addEventListener("dragover", function (e) {
        if (!treeDrag || treeDrag.kind !== "page") return; // pages accept only page drops
        e.preventDefault(); e.stopPropagation();
        var r = prow.getBoundingClientRect();
        prow.__after = (e.clientY - r.top) > r.height / 2;
        clearTreeMarks();
        prow.classList.add(prow.__after ? "tree-drop-after" : "tree-drop-before");
      });
      prow.addEventListener("dragleave", function () { prow.classList.remove("tree-drop-before", "tree-drop-after"); });
      prow.addEventListener("drop", function (e) {
        if (!treeDrag || treeDrag.kind !== "page") return;
        e.preventDefault(); e.stopPropagation();
        var src = treeDrag; treeDrag = null; var after = prow.__after; clearTreeMarks();
        structMovePage(src.id, page.id, after, page.chapterId); // drop lands in the ref page's chapter
      });
    }
    function wireTreeChapterDrag(crow, ch) {
      crow.setAttribute("draggable", "true");
      crow.addEventListener("dragstart", function (e) {
        treeDrag = { kind: "chapter", id: ch.id };
        try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch (_) {}
        e.stopPropagation();
      });
      crow.addEventListener("dragend", function () { treeDrag = null; clearTreeMarks(); });
      crow.addEventListener("dragover", function (e) {
        if (!treeDrag) return;
        e.preventDefault(); e.stopPropagation();
        clearTreeMarks();
        if (treeDrag.kind === "chapter") {
          var r = crow.getBoundingClientRect();
          crow.__after = (e.clientY - r.top) > r.height / 2;
          crow.classList.add(crow.__after ? "tree-drop-after" : "tree-drop-before");
        } else {
          crow.classList.add("tree-drop-into"); // a page dropped on the header joins this chapter
        }
      });
      crow.addEventListener("dragleave", function () { crow.classList.remove("tree-drop-before", "tree-drop-after", "tree-drop-into"); });
      crow.addEventListener("drop", function (e) {
        if (!treeDrag) return;
        e.preventDefault(); e.stopPropagation();
        var src = treeDrag; treeDrag = null; var after = crow.__after; clearTreeMarks();
        if (src.kind === "chapter") structMoveChapter(src.id, ch.id, after);
        else if (src.kind === "page") structMovePage(src.id, null, false, ch.id); // append to chapter end
      });
    }
    // ---- outliner right-click context menu (chapters / pages / blocks) --------
    // Shared inline-rename: swap a tree row's name span for a text input (reuses the
    // page-rename pattern + .tree-page__rename styling). allowClear lets an emptied
    // input revert to the derived label (used for blocks, which have no real name).
    function outlineInlineRename(nameSpan, current, commit, allowClear) {
      if (!nameSpan || !nameSpan.parentNode) { mount(); return; } // stale span (tree rebuilt) — bail safely
      var row = nameSpan.closest(".tree-page, .tree-block, .tree-chapter");
      if (row) row.setAttribute("draggable", "false");
      var inp = h("input", "tree-page__rename"); inp.type = "text"; inp.value = current || ""; inp.spellcheck = false;
      nameSpan.replaceWith(inp); inp.focus(); inp.select();
      var done = false;
      function finish(save) {
        if (done) return; done = true;
        var v = inp.value.trim();
        if (save && ((v && v !== current) || (allowClear && v === "" && current !== ""))) { pushHistory(); commit(v); }
        mount();
      }
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      });
      inp.addEventListener("blur", function () { finish(true); });
    }
    // While previewing a resolved variant, structural edits are disabled everywhere;
    // the outliner menu offers only a route back to the flagship.
    function outlineVariantMenu(e) {
      showContextMenu(e.clientX, e.clientY, [
        { head: "Previewing: " + E.activeVariant },
        { label: "Switch to Flagship to edit", onClick: function () { previewVariant(null); } }
      ]);
    }
    function wireOutlineChapterMenu(row, ch, nameSpan) {
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (E.activeVariant) return outlineVariantMenu(e);
        var real = (E.doc.chapters || []).filter(function (x) { return x.id === ch.id; })[0];
        var items = [{ head: ch.name || "Chapter" }];
        // chapter menu doesn't setSelection, so its name span stays live
        items.push({ label: "Rename", onClick: function () { outlineInlineRename(nameSpan, ch.name || "", function (v) { if (real) real.name = v; }); } });
        items.push({ label: "Move left", onClick: function () { pushHistory(); if (reorderChapter(ch.id, -1)) mount(); } });
        items.push({ label: "Move right", onClick: function () { pushHistory(); if (reorderChapter(ch.id, 1)) mount(); } });
        items.push({ sep: true });
        items.push({ label: "Delete chapter", danger: true, onClick: function () {
          confirmModal("Delete chapter", "Delete chapter “" + (ch.name || "") + "”? Its pages move to the previous chapter.", function () { pushHistory(); if (deleteChapter(ch.id)) mount(); }, { okLabel: "Delete", danger: true });
        } });
        showContextMenu(e.clientX, e.clientY, items);
      });
    }
    function wireOutlinePageMenu(row, page, pi, nameSpan) {
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (E.activeVariant) return outlineVariantMenu(e);
        focusFrame(pi); setActivePage(pi); setSelection("page", pi); // this re-renders the tree, so resolve the live row at click time
        var items = [{ head: pageDisplayName(page, E.doc) }];
        items.push({ label: "Rename", onClick: function () { outlineInlineRename(document.querySelector(".tree-page__name.is-active") || nameSpan, (page.title != null ? page.title : firstCopyOf(page)) || "", function (v) { setPageTitle(page, v); }, true); } });
        items.push({ label: "Copy page", onClick: function () { setSelection("page", pi); copySelection(); } });
        if (E.pageClipboard) items.push({ label: "Paste page after", onClick: function () { E.setCurrentPage(pi); pastePage(); } });
        items.push({ label: "Duplicate page", onClick: function () { duplicatePage(pi); } });
        if (hasMergeableNext(pi)) items.push({ label: "Merge with next page", onClick: function () { mergePageWithNext(pi); } });
        items.push({ label: "Save page to library…", onClick: function () { savePageAsLibraryMaster(pi); } });
        if (E.doc.pages.length > 1) { items.push({ sep: true }); items.push({ label: "Delete page", danger: true, onClick: function () { deletePage(pi); } }); }
        showContextMenu(e.clientX, e.clientY, items);
      });
    }
    function wireOutlineBlockMenu(row, page, pi, block, bi, depth, nameSpan) {
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (E.activeVariant) return outlineVariantMenu(e);
        // right-clicking a block that's part of a multi-selection KEEPS it (so Group works);
        // otherwise select just this block. (single-select re-renders the tree)
        // right-clicking a block that's part of a multi-selection KEEPS it (so Delete/Group
        // act on the whole set) at ANY depth; otherwise select just this block.
        var multi = inMulti(block) && E.multiSel.length >= 2;
        if (!multi) { if (depth === 0) { clearAllMulti(); selectBlock(pi, bi); } else { selectBlockRef(pi, block); } }
        var items = [{ head: multi ? (E.multiSel.length + " items selected") : blockLabel(block) }];
        if (!multi) items.push({ label: "Rename", onClick: function () { outlineInlineRename(document.querySelector(".tree-block.is-selected .tree-block__name") || nameSpan, block.name || "", function (v) { if (v) block.name = v; else delete block.name; }, true); } });
        if (!multi && depth === 0) items.push({ label: "Duplicate", onClick: function () { duplicateBlock(block); } });
        if (multi && canMergeTextBoxes(E.multiSel)) items.push({ label: "Merge text boxes", onClick: function () { mergeTextBoxes(); } });
        if (multi) items.push({ label: "Group selection", onClick: function () { groupMulti(); } });
        if (multi) items.push({ label: "Save selection to library…", onClick: function () { saveSelectionAsSectionMaster(); } }); // #22 section master
        if (!multi && block.type === "group") items.push({ label: "Ungroup", onClick: function () { ungroupBlock(block); } });
        if (!multi) items.push({ label: "Save as component…", onClick: function () { saveBlockAsComponent(block); } });
        // #174: reset the block(s) to a blank skeleton — wipe copy/images/embeds, keep structure.
        items.push({ label: "Clear content", onClick: function () { clearBlockContentAction(multi ? E.multiSel.slice() : block); } });
        items.push({ sep: true });
        items.push({ label: multi ? ("Delete " + E.multiSel.length + " items") : "Delete", danger: true, onClick: function () { if (multi) deleteSelection(); else deleteBlockByRef(block); } });
        showContextMenu(e.clientX, e.clientY, items);
      });
    }
    function renderStructure() {
      pagesList.innerHTML = ""; pageItems = [];
      // drop any multi-selected blocks that no longer exist (e.g. after grouping). Use a
      // ref-based, nesting-aware existence check (findBlockParent) — getBlockPageIndexAndIndex
      // only sees TOP-LEVEL blocks, so it was silently dropping every NESTED (column / child)
      // block from the multi-selection on each re-render, breaking cross-column select.
      E.setMultiSel(E.multiSel.filter(function (b) {
        for (var pi = 0; pi < E.doc.pages.length; pi++) { var pg = E.doc.pages[pi]; if (pg && findBlockParent(pg.blocks, b)) return true; }
        return false;
      }));
      // module G: group the page rows under their CHAPTER (a twirl-able header row),
      // mirroring the canvas columns. `pi` stays the real doc.pages index everywhere.
      var idxOf = {}; E.doc.pages.forEach(function (p, i) { if (p) idxOf[p.id] = i; });
      var groups = (window.groupPagesByChapter && Array.isArray(E.doc.chapters) && E.doc.chapters.length)
        ? window.groupPagesByChapter(E.doc) : null;
      if (groups) {
        groups.forEach(function (ch) {
          var cOpen = openChapters[ch.id] !== false;
          var crow = h("div", "tree-chapter");
          var ccaret = outlineCaret(cOpen, false);
          ccaret.addEventListener("click", function (e) { e.stopPropagation(); openChapters[ch.id] = !cOpen; renderStructure(); });
          crow.appendChild(ccaret);
          // Chapter names STAY upper-cased (DS content rule) — uppercasing is applied
          // in CSS (.tree-chapter__name) so the underlying model text is untouched.
          var cname = h("span", "tree-chapter__name", ch.name || "Chapter");
          crow.appendChild(cname);
          var ccount = (window.VersoUI && window.VersoUI.Badge)
            ? window.VersoUI.Badge({ children: String((ch.pages || []).length) })
            : h("span", null, String((ch.pages || []).length));
          ccount.classList.add("tree-chapter__count");
          crow.appendChild(ccount);
          wireTreeChapterDrag(crow, ch);
          wireOutlineChapterMenu(crow, ch, cname);
          pagesList.appendChild(crow);
          if (cOpen) (ch.pages || []).forEach(function (page) { emitPage(page, idxOf[page.id]); });
        });
      } else {
        E.doc.pages.forEach(function (page, pi) { if (page) emitPage(page, pi); });
      }
      function emitPage(page, pi) {
        var open = !!openPages[page.id];
        var prow = h("div", "tree-page");
        var caret = outlineCaret(open, false);
        caret.addEventListener("click", function (e) { e.stopPropagation(); openPages[page.id] = !open; renderStructure(); });
        var picon = outlineIcon("tree-page__icon", "file-text");
        // uio-E-C07 (EDIT-12): the derived chapter.page number lives in its OWN fixed column so the
        // name row identifies itself cleanly -- no baked-in / doubled numbers, no truncated tail.
        var num = h("span", "tree-page__num", pageNumberOf(page, E.doc));
        var name = h("span", "tree-page__name" + (pi === E.currentPage ? " is-active" : "") + (inMultiPage(pi) ? " is-multi" : ""), pageTitlePart(page));
        name.addEventListener("click", function (e) {
          if (e.metaKey || e.ctrlKey) { clearMulti(); toggleMultiPage(pi); outlineAnchor = { kind: "page", pi: pi }; return; }
          if (e.shiftKey && outlineAnchor && outlineAnchor.kind === "page") {
            var a = Math.min(outlineAnchor.pi, pi), z = Math.max(outlineAnchor.pi, pi);
            E.setMultiSelPages([]); clearMulti();
            for (var k = a; k <= z; k++) E.multiSelPages.push(k);
            renderStructure(); refreshCanvasSelection(); return;
          }
          clearAllMulti(); outlineAnchor = { kind: "page", pi: pi };
          focusFrame(pi); setActivePage(pi); setSelection("page", pi);
        });
        name.title = "Double-click to rename";
        name.addEventListener("dblclick", function (e) {
          e.stopPropagation();
          prow.setAttribute("draggable", "false"); // let the input take text selection, not a row drag
          // P2: rename edits the TITLE part only (page.title override); the chapter.page
          // number stays auto-derived. Seed with the current override or the derived first
          // copy so the author edits the visible title; an empty/unchanged commit clears it.
          var seedTitle = (page.title != null ? page.title : firstCopyOf(page)) || "";
          var inp = h("input", "tree-page__rename"); inp.type = "text"; inp.value = seedTitle; inp.spellcheck = false;
          name.replaceWith(inp); inp.focus(); inp.select();
          function commit() { var v = inp.value.trim(); if (v !== seedTitle) { pushHistory(); setPageTitle(page, v); } mount(); }
          inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); } else if (ev.key === "Escape") { ev.preventDefault(); inp.value = seedTitle; inp.blur(); } });
          inp.addEventListener("blur", commit);
        });
        prow.appendChild(caret); prow.appendChild(picon); prow.appendChild(num); prow.appendChild(name);
        makeDropTarget(prow, function () { return { page: pi, index: E.doc.pages[pi].blocks.length }; }, "drop-into");
        wireTreePageDrag(prow, page); // reorder pages / move between chapters (isolated from block DnD)
        wireOutlinePageMenu(prow, page, pi, name);
        pagesList.appendChild(prow);
        pageItems.push(name);

        if (open) {
          var list = h("div", "tree-blocks");
          page.blocks.forEach(function (block, bi) {
            appendBlockRow(list, page, pi, block, bi, 0);
          });
          var end = h("div", "tree-drop-end", "drop here");
          makeDropTarget(end, function () { return { page: pi, index: E.doc.pages[pi].blocks.length }; });
          list.appendChild(end);
          pagesList.appendChild(list);
        }
      }
    }
    // select a block from the outliner -> map to its canvas node + right selection
    function selectBlock(pi, bi) {
      focusFrame(pi); setActivePage(pi);
      var block = E.doc.pages[pi].blocks[bi];
      var frame = E.frameDescs[pi] && E.frameDescs[pi].frame;
      if (!frame || !block) { clearSelection(); return; }

      var nodes = frame.querySelectorAll(".canvas-block");
      var node = null;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].__block === block) {
          node = nodes[i];
          break;
        }
      }
      if (!node) { clearSelection(); return; }
      selectByType(node, block);
    }
    // map a block + its canvas node to the correct selection type. Shared by the
    // outliner (selectBlock) and direct canvas clicks (enableEditing).
    function selectByType(node, block) {
      if (block.type === "htmlEmbed" || block.type === "webEmbed") setSelection("embed", node);
      else if (block.type === "navButton") setSelection("navButton", node);
      else if (block.type === "componentGrid" || block.type === "columns") setSelection("block", node);
      else if (node.getAttribute && node.getAttribute("data-edit") != null) setSelection("field", node);
      else setSelection("block", node);
    }
    function setActivePage(i) { E.setCurrentPage(i); pageItems.forEach(function (it, idx) { it.classList.toggle("is-active", idx === i); }); if (E.frameDescs) E.frameDescs.forEach(function (f) { if (f.label) f.label.classList.toggle("is-active", f.i === i); }); refreshGridOverlay(); }

    kernel.expose({
      renderStructure: renderStructure, setActivePage: setActivePage, refreshCanvasSelection: refreshCanvasSelection,
      canvasNodeForBlock: canvasNodeForBlock, canvasTopBlock: canvasTopBlock, blockLabel: blockLabel,
      blockIcon: blockIcon, selectBlock: selectBlock, selectByType: selectByType,
      toggleMulti: toggleMulti, inMulti: inMulti, clearAllMulti: clearAllMulti,
      clearMultiPages: clearMultiPages, clearTreeMarks: clearTreeMarks, showMultiToolbar: showMultiToolbar,
      groupMulti: groupMulti, ungroupBlock: ungroupBlock, mergeTextBoxes: mergeTextBoxes,
      saveSelectionAsSectionMaster: saveSelectionAsSectionMaster, updateDragAffordance: updateDragAffordance, openPagesMap: openPagesMap,
      openChaptersMap: openChaptersMap, openContainersSet: openContainersSet
    });
    // Constants the rest of the chrome reads as DATA. They cannot cross as bound forwarders,
    // because bind() returns a function.
    kernel.provide({
      BLOCK_LUCIDE: BLOCK_LUCIDE
    });
  }

  window.VersoOutliner = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoOutliner;
})();
