// editor/source-link.js -- copy that stays joined to where it came from (arch-P3b-07).
//
// A course does not own its words. A product's source document does, and a block that shows some
// of those words holds a LINK to the range rather than a copy of it. Change the source and every
// course showing that passage changes with it. That is the single-source promise, and this file is
// where it is kept on the authoring side.
//
// Four things, in the order an author meets them:
//
//   the SOURCE TAB in the Edit panel -- the open document's product source, read-only, with its
//   own find and contents list. Read-only on purpose: all source editing happens on the Source
//   stage, because one editing host is what stops two of them disagreeing.
//
//   PLACEMENT -- select a range, arm, click where it goes. The blocks land at the drop point
//   rather than at the selection, and a format split stacks its blocks in order.
//
//   ALTERNATES -- a placement can be pinned to a different wording of the same range. The base
//   moves on; the pinned placement keeps the words it was pinned to.
//
//   WHERE-USED and the BASE-EDIT WARNING -- before an edit to the source lands, the author is told
//   which courses show that passage, and offered the fork that freezes the old wording as an
//   alternate for the placements that should not follow.
//
// It shared the Assets banner because both put content on the canvas. Nothing else about them is
// the same, and separating them halved the traffic each has with editor.js.
//
// Editor chrome only: it decides what render() is handed, and renders none of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "sourceToast", "libComponents", "frameElementUnder", "saveLibrary", "sourceDocModel",
      "activeLeftSection", "walkBlocks", "setActivePage", "insertBlock", "mintId", "pushHistory",
      "reapplyBlock", "dsModalShell", "registry", "lockSourceEditing", "pushSourceAlternate", "setStage",
      "sourceMasterFor", "renderSourceDocNode", "applyLeftSection", "canvas", "scheduleSave", "modalText",
      "renderEditProductPanel",
      "modalField", "showContextMenu", "sourceActiveTopicId", "saveRegistry", "flushSourceEditSession", "applySourceLockState",
      "refreshSourceSelBar", "updateSourceDocBar", "setSourceDocModel", "persistSourceDocModel", "clearSourceEditSession", "renderSourceArticle",
      "openSourceTopicId", "openCourseFromBrowser", "blockById", "findPageOfBlock", "focusFrame", "reselectBlockNode",
      "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        sourceToast = E.sourceToast,
        libComponents = E.libComponents,
        frameElementUnder = E.frameElementUnder,
        saveLibrary = E.saveLibrary,
        sourceDocModel = E.sourceDocModel,
        activeLeftSection = E.activeLeftSection,
        walkBlocks = E.walkBlocks,
        setActivePage = E.setActivePage,
        insertBlock = E.insertBlock,
        mintId = E.mintId,
        pushHistory = E.pushHistory,
        reapplyBlock = E.reapplyBlock,
        dsModalShell = E.dsModalShell,
        registry = E.registry,
        lockSourceEditing = E.lockSourceEditing,
        pushSourceAlternate = E.pushSourceAlternate,
        setStage = E.setStage,
        sourceMasterFor = E.sourceMasterFor,
        renderSourceDocNode = E.renderSourceDocNode,
        applyLeftSection = E.applyLeftSection,
        canvas = E.canvas,
        scheduleSave = E.scheduleSave,
        modalText = E.modalText,
        modalField = E.modalField,
        showContextMenu = E.showContextMenu,
        sourceActiveTopicId = E.sourceActiveTopicId,
        saveRegistry = E.saveRegistry,
        flushSourceEditSession = E.flushSourceEditSession,
        applySourceLockState = E.applySourceLockState,
        refreshSourceSelBar = E.refreshSourceSelBar,
        updateSourceDocBar = E.updateSourceDocBar,
        setSourceDocModel = E.setSourceDocModel,
        persistSourceDocModel = E.persistSourceDocModel,
        clearSourceEditSession = E.clearSourceEditSession,
        renderSourceArticle = E.renderSourceArticle,
        openSourceTopicId = E.openSourceTopicId,
        openCourseFromBrowser = E.openCourseFromBrowser,
        blockById = E.blockById,
        findPageOfBlock = E.findPageOfBlock,
        focusFrame = E.focusFrame,
        reselectBlockNode = E.reselectBlockNode;

    // SPEC 8 (source-link 02): the Edit left-panel Source tab is a read-only, live view of the OPEN
    // document's product source doc -- the same content the author sees in the Source stage, in a
    // narrow reading column, with its own find (SourceDoc.findMatches + cycle) and a TOC
    // (SourceDoc.outline, click-to-jump + scroll-spy). It keys off the open DOCUMENT, not the rail
    // scope, so it always matches the course in front of you. All source editing stays in the Source
    // stage (the single-host lesson) -- nothing here is editable.
    //
    // uio-W14: the document's sources are its product's primary PLUS any extras attached by hand,
    // resolved through SourceOwnership. So a shared glossary attached to an untagged course shows
    // here, where before "no product" meant "no source" and the panel simply gave up.
    function renderEditSourcePanel() {
      var host = document.getElementById("tab-source"); if (!host) return;
      host.innerHTML = "";
      // uio-W12: the Product panel sits ABOVE this reading column, in the same left pane, and is
      // repainted with it -- both answer questions about the open document, so they must never be
      // showing two different documents.
      if (typeof E.renderEditProductPanel === "function") E.renderEditProductPanel();
      var SD = window.SourceDoc, U = window.VersoUI;
      var owned = window.SourceOwnership.sourcesForDoc(E.doc, libComponents(), window.ProductsStore || {});
      // The primary is what the panel reads when there is one; an untagged document with an
      // attached extra reads that instead of nothing. uio-W12's Product panel is where the whole
      // set is listed and switched between.
      var master = owned.primary || owned.extras[0] || null;
      if (!master || !master.doc || !SD) {
        var productId = (E.doc && E.doc.meta && E.doc.meta.productId) || "";
        host.appendChild(h("div", "source-stage__empty", productId
          ? "This Product has no source document yet. Build it in the Source stage."
          // uio-W13: a plain fact, not a defect report. Having no product is a state a document is
          // legitimately in -- shared material lives there on purpose -- so this says what would
          // put source here rather than what is wrong.
          : "No product, and no source attached. Assign a product, or attach a source, in the Product panel above."));
        return;
      }
      var model = SD.fromJSON(master.doc);
      // source-link 03: keep the live master + model + its component id so the Place gesture can add a
      // link mark to the master and persist it (and so the canvas can resolve placements back to it).
      // The id comes off the RESOLVED master rather than off the product, so an extra is placed
      // against itself instead of silently against the primary.
      __editSourceMaster = master; __editSourceModel = model;
      __editSourceMasterId = master.id || null;
      var wrap = h("div", "edit-source");

      // ---- find (reuses SD.findMatches + a small local cycle, mirroring the Source stage). The
      // search field reuses the shared .vbrowser__search chrome (same control as the doc browser +
      // Source stage) rather than a bespoke input, for app-wide search parity. ----
      var matches = [], findIdx = 0;
      var searchBar = h("div", "edit-source__searchbar");
      var search = h("label", "vbrowser__search");
      search.innerHTML = window.Icon ? window.Icon("search") : "";
      var input = h("input", "vbrowser__search-input"); input.type = "text"; input.placeholder = "find in source"; input.spellcheck = false;
      var count = h("span", "edit-source__count", "");
      search.appendChild(input); search.appendChild(count);
      searchBar.appendChild(search);
      wrap.appendChild(searchBar);

      var docCol = h("div", "edit-source__doc");
      function clearFindHi() { Array.prototype.forEach.call(docCol.querySelectorAll(".is-find-current"), function (el) { el.classList.remove("is-find-current"); }); }
      function scrollToHit(i) {
        clearFindHi();
        var mt = matches[i]; if (!mt) return;
        var el = docCol.querySelector('[data-node="' + mt.nodeKey + '"]');
        if (el) { el.classList.add("is-find-current"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
      }
      function runFind() {
        var q = input.value.trim();
        matches = q ? SD.findMatches(model, q) : [];
        findIdx = 0;
        count.textContent = q ? (matches.length ? (matches.length + " found") : "no matches") : "";
        if (matches.length) scrollToHit(0); else clearFindHi();
      }
      function cycleFind(dir) {
        if (!matches.length) return;
        findIdx = (findIdx + dir + matches.length) % matches.length;
        count.textContent = (findIdx + 1) + " / " + matches.length;
        scrollToHit(findIdx);
      }
      input.addEventListener("input", runFind);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); cycleFind(e.shiftKey ? -1 : 1); } });

      // ---- table of contents (SD.outline: chapters + headings, click to jump, scroll-spy) ----
      var outline = SD.outline(model), tocRows = [];
      if (outline.length) {
        var toc = h("nav", "edit-source__toc"); toc.setAttribute("aria-label", "Source outline");
        function tocRow(node) {
          // Reuse the shared .source-doc__toc-item row (look + is-current scroll-spy class the Source
          // stage's own TOC uses) rather than a bespoke row.
          var r = h("button", "source-doc__toc-item source-doc__toc-item--l" + (node.level || 2), node.text || "Untitled");
          r.type = "button"; r.setAttribute("data-toc-key", node.key); r.title = node.text || "";
          r.addEventListener("click", function () { var t = docCol.querySelector('[data-node="' + node.key + '"]'); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); });
          toc.appendChild(r); tocRows.push(r);
        }
        outline.forEach(function (ch) { tocRow(ch); (ch.children || []).forEach(tocRow); });
        wrap.appendChild(toc);
      }

      // ---- reading column (read-only projection; the SAME renderSourceDocNode the stage uses) ----
      (model.nodes || []).forEach(function (n) { docCol.appendChild(renderSourceDocNode(n)); });
      // 07: a source figure is draggable as one unit -> a linked image block. Object-anchor descriptor
      // (no start/len). Images aren't text-selectable, so a pointerdown-drag on the figure is safe.
      Array.prototype.forEach.call(docCol.querySelectorAll("figure.source-doc__figure[data-object]"), function (figEl) {
        figEl.classList.add("edit-source__figure");
        figEl.addEventListener("pointerdown", function (ev) {
          ev.preventDefault();
          startSourceLinkDrag({ anchor: { nodeKey: figEl.getAttribute("data-node") } }, ev);
        });
      });
      // Scroll-spy: highlight the TOC entry for the last heading scrolled above the top.
      docCol.addEventListener("scroll", function () {
        if (!tocRows.length) return;
        var top = docCol.getBoundingClientRect().top + 8, curKey = null;
        Array.prototype.forEach.call(docCol.querySelectorAll(".source-doc__h[data-node]"), function (el) { if (el.getBoundingClientRect().top <= top) curKey = el.getAttribute("data-node"); });
        tocRows.forEach(function (r) { r.classList.toggle("is-current", r.getAttribute("data-toc-key") === curKey); });
      });
      wrap.appendChild(docCol);
      host.appendChild(wrap);

      // source-link 03: paint passages already linked into the OPEN document (a persistent highlight,
      // distinct from the transient find highlight), and honour a pending jump-to-source request.
      paintPanelLinkedPassages(docCol, model);
      // A text selection in the read-only column raises the floating "Place" bar (arm-then-click).
      docCol.addEventListener("mouseup", function () { setTimeout(function () { maybeShowPlaceBar(docCol, model); }, 0); });
      if (__pendingSourceJumpMark && __pendingSourceJumpMark.masterId === __editSourceMasterId) {
        var jm = SD.markById(model, __pendingSourceJumpMark.markId);
        __pendingSourceJumpMark = null;
        if (jm) {
          var jk = jm.anchor && jm.anchor.nodeKey;
          var tel = jk && docCol.querySelector('[data-node="' + jk + '"]');
          if (tel) { tel.classList.add("is-find-current"); setTimeout(function () { tel.scrollIntoView({ block: "center", behavior: "smooth" }); }, 0); }
        }
      }
    }
    if (window.__productRail) window.__productRail.renderEditSourcePanel = renderEditSourcePanel; // browser-verify hook

    // ==== source-link 03: select a range -> place a live-linked text block (arm-then-click) ========
    // The panel viewer (02) is read-only, but its text is selectable. Selecting a range raises a
    // small floating "Place" bar; Place creates a type:"link" mark on the source master and arms
    // placement; the next canvas click drops one locked, live-linked text block that resolves through
    // the 01 resolver. Cross-node selections (a heading through a paragraph) link as one passage.
    var __editSourceMaster = null, __editSourceModel = null, __editSourceMasterId = null;
    var __armedSourceLink = null;        // { masterId, markId } armed for the next canvas click
    var __pendingSourceJumpMark = null;  // { masterId, markId } to scroll to after the panel re-renders
    var __sourceLinkDropAt = null;       // #161 part 1: { pageIndex, index } explicit drop gap for a placement

    // #161 part 1: the between-block gap under the cursor on the target page -> where a dropped linked
    // block should land, plus the Y to draw the drop-line at. Only TOP-LEVEL page blocks are gap targets
    // (a linked block drops between page blocks, not inside a column); returns null off any page.
    function sourceLinkDropGap(cx, cy) {
      var pi = pageIndexFromPoint(cx, cy); if (pi < 0) return null;
      var fr = frameElementUnder(cx, cy); if (!fr) return null;
      var page = E.doc.pages[pi]; if (!page) return null;
      var tops = Array.prototype.filter.call(fr.querySelectorAll(".canvas-block"), function (el) {
        return el.__block && page.blocks.indexOf(el.__block) !== -1; // top-level only (skip nested)
      });
      tops.sort(function (a, b) { return page.blocks.indexOf(a.__block) - page.blocks.indexOf(b.__block); });
      var index = page.blocks.length, lineY = null;
      for (var i = 0; i < tops.length; i++) {
        var r = tops[i].getBoundingClientRect();
        if (cy < r.top + r.height / 2) { index = page.blocks.indexOf(tops[i].__block); lineY = r.top; break; }
      }
      if (lineY == null) { // below every block -> the trailing gap
        if (tops.length) lineY = tops[tops.length - 1].getBoundingClientRect().bottom;
        else lineY = fr.getBoundingClientRect().top + 14; // empty page
      }
      return { pageIndex: pi, index: index, lineY: lineY, frameRect: fr.getBoundingClientRect() };
    }
    function hideSourceLinkDropLine() { var l = document.getElementById("source-link-dropline"); if (l) l.remove(); }
    function showSourceLinkDropLine(cx, cy) {
      var gap = sourceLinkDropGap(cx, cy);
      if (!gap) { hideSourceLinkDropLine(); return; }
      var line = document.getElementById("source-link-dropline");
      if (!line) { line = h("div", "source-link-dropline"); line.id = "source-link-dropline"; document.body.appendChild(line); }
      line.style.left = gap.frameRect.left + "px";
      line.style.width = gap.frameRect.width + "px";
      line.style.top = gap.lineY + "px";
    }

    // Char offset of a DOM point within a block element's text (walks all text nodes -> matches the
    // SourceDoc plain-text offset model the marks anchor to).
    function panelCharOffset(blockEl, container, offset) {
      var r = document.createRange();
      r.selectNodeContents(blockEl);
      try { r.setEnd(container, offset); } catch (e) { return 0; }
      return r.toString().length;
    }
    // Build a SourceDoc range descriptor {anchor, endAnchor?} from the current selection in the panel,
    // or null when the selection is empty / collapsed / outside the reading column. Single-node ->
    // one anchor; cross-node -> anchor (first node, start..end) + endAnchor (last node, 0..end),
    // matching SourceDoc.addMark's multi-block shape.
    function panelSelectionDescriptor(docCol, model) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
      var rng = sel.getRangeAt(0);
      if (!docCol.contains(rng.startContainer) || !docCol.contains(rng.endContainer)) return null;
      var sEl = (rng.startContainer.nodeType === 3 ? rng.startContainer.parentNode : rng.startContainer);
      var eEl = (rng.endContainer.nodeType === 3 ? rng.endContainer.parentNode : rng.endContainer);
      var sBlock = sEl && sEl.closest ? sEl.closest("[data-node]") : null;
      var eBlock = eEl && eEl.closest ? eEl.closest("[data-node]") : null;
      if (!sBlock || !eBlock) return null;
      var sKey = sBlock.getAttribute("data-node"), eKey = eBlock.getAttribute("data-node");
      var sOff = panelCharOffset(sBlock, rng.startContainer, rng.startOffset);
      var eOff = panelCharOffset(eBlock, rng.endContainer, rng.endOffset);
      var SD = window.SourceDoc;
      if (sKey === eKey) {
        if (eOff <= sOff) return null;
        return { anchor: { nodeKey: sKey, start: sOff, len: eOff - sOff } };
      }
      var sNode = SD.nodeByKey(model, sKey);
      var sLen = sNode ? SD.nodeText(sNode).length : sOff;
      return { anchor: { nodeKey: sKey, start: sOff, len: Math.max(0, sLen - sOff) }, endAnchor: { nodeKey: eKey, start: 0, len: eOff } };
    }
    function hidePlaceBar() { var b = document.querySelector("[data-source-placebar]"); if (b) b.remove(); }
    function maybeShowPlaceBar(docCol, model) {
      hidePlaceBar();
      if (__armedSourceLink) return; // already arming -> don't stack
      var desc = panelSelectionDescriptor(docCol, model);
      if (!desc) return;
      var sel = window.getSelection();
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      var bar = h("div", "source-placebar"); bar.setAttribute("data-source-placebar", "1");
      // 04: a grab handle starts a custom pointer-drag (decoupled from the text selection, which is why
      // it's NOT native HTML5 DnD -- setting draggable would kill selecting text in the panel).
      var grip = h("button", "source-placebar__grip"); grip.type = "button"; grip.title = "Drag onto the canvas to place";
      grip.innerHTML = window.Icon ? window.Icon("grip-vertical") : "";
      grip.addEventListener("pointerdown", function (ev) { ev.preventDefault(); startSourceLinkDrag(desc, ev); });
      bar.appendChild(grip);
      var btn = window.VersoUI && window.VersoUI.Button
        ? window.VersoUI.Button({ variant: "primary", size: "sm", icon: "link", label: "Place", onClick: function () { armSourceLinkPlacement(desc); } })
        : h("button", null, "Place");
      if (!(window.VersoUI && window.VersoUI.Button)) btn.addEventListener("click", function () { armSourceLinkPlacement(desc); });
      bar.appendChild(btn);
      document.body.appendChild(bar);
      bar.style.top = Math.max(8, rect.top - bar.offsetHeight - 8) + "px";
      bar.style.left = Math.max(8, rect.left) + "px";
    }
    // Place: arm the next canvas click to drop the linked copy. Mark creation is DEFERRED to the drop
    // (05): a range spanning formats splits into several linked blocks, each with its own link mark,
    // so the marks are minted per run when the drop resolves — we carry the range descriptor, not a
    // pre-made single mark.
    function armSourceLinkPlacement(desc) {
      if (!window.SourceDoc || !__editSourceModel || !__editSourceMasterId) return;
      __armedSourceLink = { masterId: __editSourceMasterId, descriptor: desc };
      document.body.classList.add("is-arming-source-link");
      hidePlaceBar();
      var s = window.getSelection(); if (s) s.removeAllRanges();
      sourceToast("Linked passage armed — click a spot in the canvas to place it. Esc to cancel.");
    }
    function cancelArmedSourceLink() {
      if (!__armedSourceLink) return;
      __armedSourceLink = null;
      document.body.classList.remove("is-arming-source-link");
      sourceToast("Placement cancelled.");
    }
    // format-split (05): source structure -> destination block type. heading lvl1 -> Heading 1
    // (heading block), heading lvl2/3 -> Heading 2 (subheading block), paragraph/callout -> Body.
    var SOURCE_LINK_BLOCK_TYPE = { h1: "heading", h2: "subheading", body: "paragraph" };
    var SOURCE_LINK_TEXT_TYPES = { heading: 1, subheading: 1, paragraph: 1, note: 1, quote: 1 };
    // A drop target counts as "a text block to merge into" (06) only if it's an editable text block
    // that isn't itself a whole-block linked placement (don't nest a link inside a link).
    function isSourceLinkTextBlock(b) { return !!(b && SOURCE_LINK_TEXT_TYPES[b.type] && !b.sourceLink); }
    // The armed drop. Dropping ONTO an existing text block appends a locked linked inline span there
    // (06); dropping in a gap runs the format-split planner and inserts one linked block per same-
    // format run (05). Optional (cx,cy) = the drop point (from the drag or the armed click); absent ->
    // gap placement on the current page.
    function placeArmedSourceLink(cx, cy) {
      var a = __armedSourceLink; if (!a) return false;
      __armedSourceLink = null;
      document.body.classList.remove("is-arming-source-link");
      // An object anchor (no start/len) is a figure link (07) -> always a new linked image block.
      var isObject = !!(a.descriptor && a.descriptor.anchor && a.descriptor.anchor.len == null);
      if (cx != null) {
        if (!isObject) {
          var el = document.elementFromPoint(cx, cy);
          var blockEl = el && el.closest ? el.closest(".canvas-block") : null;
          if (blockEl && isSourceLinkTextBlock(blockEl.__block)) return dropInlineSourceLink(a, blockEl.__block);
        }
        var pi = pageIndexFromPoint(cx, cy); if (pi >= 0) setActivePage(pi);
        // #161 part 1: land the block(s) at the between-block gap under the cursor (where the drop-line
        // showed), not at the current selection. Consumed by insertBlock, cleared after the placement.
        var gap = sourceLinkDropGap(cx, cy);
        if (gap) __sourceLinkDropAt = { pageIndex: gap.pageIndex, index: gap.index };
      }
      var result = isObject ? placeSourceLinkImage(a) : placeSourceLinkBlocks(a);
      __sourceLinkDropAt = null; // one placement only -- never leak the gap into ordinary insertBlock calls
      return result;
    }
    // 07: drop a source figure -> a new linked image block. The link is an OBJECT mark (anchor
    // {nodeKey}, no start/len); the image block resolves its src/alt from the figure node via 01.
    function placeSourceLinkImage(a) {
      var SD = window.SourceDoc;
      var master = libComponents()[a.masterId];
      if (!master || !master.doc) { sourceToast("The source is no longer available."); return false; }
      var model = SD.fromJSON(master.doc);
      var mk = SD.addMark(model, { type: "link", anchor: a.descriptor.anchor }); // object mark (len null)
      master.doc = SD.toJSON(model); saveLibrary();
      insertBlock({ type: "image", id: mintId(), sourceLink: { masterId: a.masterId, markId: mk.id } });
      decorateSourceLinks();
      if (activeLeftSection() === "source") renderEditSourcePanel();
      sourceToast("Linked image placed.");
      return true;
    }
    // 05: gap placement -- run the format-split planner and insert ONE locked, live-linked text block
    // per contiguous same-format run (each in the destination's matching preset). A single-format range
    // yields one block; consecutive same-format nodes stay in one block joined by line breaks.
    function placeSourceLinkBlocks(a) {
      var SD = window.SourceDoc;
      var master = libComponents()[a.masterId];
      if (!master || !master.doc) { sourceToast("The source is no longer available."); return false; }
      var model = SD.fromJSON(master.doc);
      var plan = SD.planLinkedBlocks(model, a.descriptor);
      if (!plan.length) return false;
      // Mint every link mark and PERSIST them to the master BEFORE inserting any block (#161): insertBlock
      // renders the canvas, and the render resolver (resolveSourceLinkContent) reads master.doc to fill the
      // linked copy live. Persisting AFTER the insert loop (the old order) meant that first render saw the
      // pre-mark master.doc, markById returned null, and the block rendered blank + collapsed until an
      // unrelated re-render. placeSourceLinkImage already persists before its insertBlock -- match it.
      var markIds = plan.map(function (run) {
        return SD.addMark(model, { type: "link", anchor: run.anchor, endAnchor: run.endAnchor }).id;
      });
      master.doc = SD.toJSON(model); saveLibrary();
      plan.forEach(function (run, i) {
        insertBlock({ type: SOURCE_LINK_BLOCK_TYPE[run.format] || "paragraph", id: mintId(), sourceLink: { masterId: a.masterId, markId: markIds[i] } });
      });
      decorateSourceLinks();
      if (activeLeftSection() === "source") renderEditSourcePanel(); // repaint so newly-linked passages highlight
      sourceToast(plan.length > 1 ? ("Placed " + plan.length + " linked blocks.") : "Linked block placed.");
      return true;
    }
    function slEscape(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    // 06: drop onto a text block -> append a locked, live-linked inline span to that block. The whole
    // dropped range flattens to ONE link mark (you're merging into body prose; the 05 format-split is
    // between-block only). Owned text around the span stays editable; the span is contenteditable=false
    // (locked) and resolves live via 01's #120-style inline post-pass, baking at export.
    function dropInlineSourceLink(a, block) {
      var SD = window.SourceDoc;
      var master = libComponents()[a.masterId];
      if (!master || !master.doc) { sourceToast("The source is no longer available."); return false; }
      var model = SD.fromJSON(master.doc);
      var mk = SD.addMark(model, { type: "link", anchor: a.descriptor.anchor, endAnchor: a.descriptor.endAnchor });
      master.doc = SD.toJSON(model); saveLibrary();
      pushHistory();
      var span = '<span data-source-link="' + mk.id + '" data-master="' + a.masterId + '">' + slEscape(SD.markText(model, mk)) + '</span>';
      block.text = (block.text ? block.text + " " : "") + span;
      reapplyBlock(block);
      decorateSourceLinks();
      if (activeLeftSection() === "source") renderEditSourcePanel();
      sourceToast("Linked span added.");
      return true;
    }
    // 04: the destination page under a drop point (its .frame -> .page[data-page-id] -> doc index).
    function pageIndexFromPoint(cx, cy) {
      var fr = frameElementUnder(cx, cy); if (!fr) return -1;
      var pageEl = fr.querySelector(".page[data-page-id]");
      var pid = pageEl && pageEl.getAttribute("data-page-id");
      return pid ? (E.doc.pages || []).findIndex(function (p) { return p.id === pid; }) : -1;
    }
    // 04: the preferred placement gesture -- press the grab handle and drag the passage onto the
    // canvas. A ghost follows the cursor; the page under the cursor lights up as the drop target;
    // release resolves through the SAME placement the arm-then-click path uses (placeArmedSourceLink).
    // Custom pointer events (not native DnD) so selecting text in the read-only panel still works.
    function startSourceLinkDrag(desc, ev) {
      hidePlaceBar();
      var ghost = h("div", "source-link-ghost", "Linked copy"); document.body.appendChild(ghost);
      document.body.classList.add("is-dragging-source-link");
      function clearTarget() { var p = document.querySelector(".frame.is-drop-target"); if (p) p.classList.remove("is-drop-target"); }
      // Dropping ONTO an editable text block appends an inline span there (06); dropping in a gap inserts
      // a new block. Show the between-block drop-line only for the gap case; highlight the block for the
      // inline case -- so the drag always previews exactly where the copy will land (#161 part 1).
      var isObjDrag = !!(desc && desc.anchor && desc.anchor.len == null);
      function overTextBlock(x, y) {
        if (isObjDrag) return null; // a figure always becomes a new image block, never an inline span
        var el = document.elementFromPoint(x, y); var be = el && el.closest ? el.closest(".canvas-block") : null;
        return (be && isSourceLinkTextBlock(be.__block)) ? be : null;
      }
      function clearInlineTarget() { var b = document.querySelector(".canvas-block.is-sl-inline-target"); if (b) b.classList.remove("is-sl-inline-target"); }
      function move(e) {
        ghost.style.left = (e.clientX + 12) + "px"; ghost.style.top = (e.clientY + 12) + "px";
        clearTarget(); clearInlineTarget();
        var fr = frameElementUnder(e.clientX, e.clientY); if (fr) fr.classList.add("is-drop-target");
        var tb = overTextBlock(e.clientX, e.clientY);
        if (tb) { tb.classList.add("is-sl-inline-target"); hideSourceLinkDropLine(); }
        else if (fr) { showSourceLinkDropLine(e.clientX, e.clientY); }
        else { hideSourceLinkDropLine(); }
      }
      function up(e) {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        ghost.remove(); document.body.classList.remove("is-dragging-source-link"); clearTarget(); clearInlineTarget(); hideSourceLinkDropLine();
        if (!frameElementUnder(e.clientX, e.clientY)) { sourceToast("Dropped outside the canvas — nothing placed."); return; }
        __armedSourceLink = { masterId: __editSourceMasterId, descriptor: desc };
        placeArmedSourceLink(e.clientX, e.clientY); // routes to inline-span (onto a text block) or gap placement
      }
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      move(ev);
    }
    // Two-way jump (direction: canvas -> panel): clicking a linked block's indicator opens the Source
    // tab and scrolls the panel to the exact source passage.
    function jumpSourcePanelToMark(masterId, markId) {
      __pendingSourceJumpMark = { masterId: masterId, markId: markId };
      applyLeftSection("source"); // re-renders the panel, which honours the pending jump
    }
    // On-canvas link indicator: a small clickable badge on every placed linked block (editor chrome
    // only -- never rendered into the shipped course). Idempotent; re-run after each render.
    function decorateSourceLinks(scope) {
      var root = scope || canvas; if (!root) return;
      Array.prototype.forEach.call(root.querySelectorAll(".source-link-badge"), function (b) { b.remove(); });
      Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (node) {
        node.classList.remove("is-source-linked");
        var b = node.__block;
        if (b && b.sourceLink && b.sourceLink.markId) {
          node.classList.add("is-source-linked");
          var badge = h("button", "source-link-badge"); badge.type = "button";
          badge.innerHTML = window.Icon ? window.Icon("link") : "";
          badge.title = "Linked from source — jump, or pick / create an alternate";
          badge.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); openSourceLinkMenu({ kind: "block", block: b }, b.sourceLink.masterId, b.sourceLink.markId, e.clientX, e.clientY); });
          node.appendChild(badge);
        }
      });
      // 06: per-span indicator inside a mixed block -- each locked linked inline span gets its own
      // contextual menu (jump + alternate), distinct from the whole-block badge above.
      Array.prototype.forEach.call(root.querySelectorAll(".canvas-block span[data-source-link]"), function (sp) {
        sp.classList.add("is-source-linked-span");
        if (sp.__slWired) return; sp.__slWired = true;
        sp.title = "Linked from source — jump, or pick / create an alternate";
        sp.addEventListener("click", function (e) {
          e.stopPropagation();
          var owner = sp.closest ? sp.closest(".canvas-block") : null;
          if (!owner || !owner.__block) return;
          openSourceLinkMenu({ kind: "span", block: owner.__block, spanEl: sp, markId: sp.getAttribute("data-source-link") }, sp.getAttribute("data-master"), sp.getAttribute("data-source-link"), e.clientX, e.clientY);
        });
      });
    }
    // Panel: highlight passages already linked into the OPEN document (a persistent cue, distinct from
    // the find highlight). A link mark counts as "used here" when a block in the open doc points at it.
    function paintPanelLinkedPassages(docCol, model) {
      var SD = window.SourceDoc;
      var used = {};
      walkBlocks(E.doc, function (b) { if (b.sourceLink && b.sourceLink.masterId === __editSourceMasterId && b.sourceLink.markId) used[b.sourceLink.markId] = 1; });
      (model.marks || []).forEach(function (m) {
        if (m.type !== "link" || !used[m.id]) return;
        SD.markSpans(model, m).forEach(function (sp) {
          var el = docCol.querySelector('[data-node="' + sp.nodeKey + '"]');
          if (el) el.classList.add("is-source-linked-passage");
        });
      });
    }
    // ==== source-link 08: alternates (create + pick) from the canvas ==============================
    // Linked copy is locked; the sanctioned way to say it differently in ONE place is an alternate --
    // a named fork registered on the source master (so it's visible + pushable from the Source stage,
    // 10) that this single placement points at via altId. A location shows base until an alternate is
    // picked or pushed to it (never automatic). Text alternates are span/range-contextual.
    function sourceAltSnippet(s) { s = String(s == null ? "" : s); return s.length > 32 ? s.slice(0, 32) + "…" : s; }
    // Alternate marks anchored identically to a link mark (its candidate alternates).
    function sourceLinkAlternates(model, link) {
      var SD = window.SourceDoc, a = link.anchor, end = link.endAnchor;
      return (model.marks || []).filter(function (m) {
        if (m.type !== "alternate" || SD.isObjectMark(m) !== SD.isObjectMark(link)) return false;
        if (!m.anchor || m.anchor.nodeKey !== a.nodeKey || m.anchor.start !== a.start || m.anchor.len !== a.len) return false;
        if (!!end !== !!m.endAnchor) return false;
        return !end || (m.endAnchor.nodeKey === end.nodeKey && m.endAnchor.len === end.len);
      });
    }
    // The altId a target (a whole linked block, or one inline span inside a block) currently points at.
    function sourceLinkTargetAlt(target) {
      if (target.kind === "block") return (target.block.sourceLink && target.block.sourceLink.altId) || null;
      return target.spanEl ? (target.spanEl.getAttribute("data-alt") || null) : null;
    }
    // Point a target at an alternate (altId) or back to base (null). Block -> block.sourceLink.altId;
    // span -> data-alt on that span inside the owning block's rich text. This block/span ONLY.
    function setSourceLinkTargetAlt(target, altId) {
      if (target.kind === "block") {
        if (!target.block.sourceLink) return;
        if (altId) target.block.sourceLink.altId = altId; else delete target.block.sourceLink.altId;
      } else {
        var host = document.createElement("div"); host.innerHTML = target.block.text || "";
        var sp = host.querySelector('span[data-source-link="' + target.markId + '"]');
        if (!sp) return;
        if (altId) sp.setAttribute("data-alt", altId); else sp.removeAttribute("data-alt");
        target.block.text = host.innerHTML;
      }
      pushHistory(); reapplyBlock(target.block); decorateSourceLinks(); scheduleSave();
      sourceToast(altId ? "Alternate applied to this block." : "Reset to base wording.");
    }
    // Create a new alternate wording on the source master, then point THIS target at it. Text only in
    // v1 (an object/figure alternate is whole-block; figure-swap storage is a follow-up).
    function createSourceAlternate(target, masterId, markId) {
      var SD = window.SourceDoc, master = libComponents()[masterId];
      if (!master || !master.doc) return;
      var model = SD.fromJSON(master.doc);
      var link = SD.markById(model, markId); if (!link) return;
      if (SD.isObjectMark(link)) { sourceToast("Object (figure) alternates are coming soon."); return; }
      var base = SD.markText(model, link);
      var shell = dsModalShell({
        title: "Create an alternate",
        subtitle: "A named fork of this passage, applied to this block only. It registers on the source, so you can reuse or push it later.",
        primaryLabel: "Create alternate",
        onPrimary: function () {
          var wording = (ta.value || "").trim();
          if (!wording) { ta.focus(); return; }
          var alt = SD.addMark(model, { type: "alternate", anchor: link.anchor, endAnchor: link.endAnchor, alt: wording, tag: (nameIn.value || "").trim(), baseText: base });
          master.doc = SD.toJSON(model); saveLibrary();
          setSourceLinkTargetAlt(target, alt.id);
          shell.modal.close();
        }
      });
      var nameIn = modalText(shell.body, "Name (optional)", "", "e.g. Short form");
      var lbl = modalField(shell.body, "Wording");
      var ta = h("textarea", "prop-text modal-field__control"); ta.rows = 3; ta.value = base; lbl.appendChild(ta);
      setTimeout(function () { ta.focus(); ta.select(); }, 0);
    }
    // The per-target source-link menu (badge / span indicator): jump to source, pick base or an
    // existing alternate, or create a new one. Reuses the canonical context menu.
    function openSourceLinkMenu(target, masterId, markId, x, y) {
      var SD = window.SourceDoc, master = libComponents()[masterId];
      var cur = sourceLinkTargetAlt(target);
      var items = [{ label: "Jump to source", onClick: function () { jumpSourcePanelToMark(masterId, markId); } }, { sep: true },
        { label: "Base wording", active: !cur, onClick: function () { setSourceLinkTargetAlt(target, null); } }];
      if (master && master.doc) {
        var model = SD.fromJSON(master.doc);
        var link = SD.markById(model, markId);
        if (link) sourceLinkAlternates(model, link).forEach(function (alt) {
          items.push({ label: (alt.tag ? alt.tag + " — " : "") + sourceAltSnippet(alt.alt), active: cur === alt.id, onClick: function () { setSourceLinkTargetAlt(target, alt.id); } });
        });
      }
      items.push({ sep: true }, { label: "Create an alternate…", onClick: function () { createSourceAlternate(target, masterId, markId); } });
      showContextMenu(x, y, items);
    }

    // ==== source-link 09/10: live where-used + base-edit warning + alternate push =================
    // The real, live where-used for a source link mark: every block (or inline span) in ANY document
    // that references it, computed by walking the registry (like libraryWhereUsedDetail) so it never
    // drifts from a stored list. altId per location = whether that placement shows base or a fork.
    function sourceLinkWhereUsed(masterId, markId) {
      var out = [], reg = registry; // the LIVE in-memory registry (getRegistry() returns a stale storage copy)
      Object.keys(reg).forEach(function (code) {
        var d = reg[code]; if (!d) return;
        var title = (d.meta && d.meta.title) || code;
        walkBlocks(d, function (b) {
          if (b.sourceLink && b.sourceLink.masterId === masterId && (!markId || b.sourceLink.markId === markId)) {
            out.push({ docCode: code, docTitle: title, blockId: b.id, markId: b.sourceLink.markId, altId: b.sourceLink.altId || null, kind: "block" });
          }
          if (b.text && typeof b.text === "string" && b.text.indexOf("data-source-link=") !== -1) {
            var probe = document.createElement("div"); probe.innerHTML = b.text;
            Array.prototype.forEach.call(probe.querySelectorAll("span[data-source-link]"), function (sp) {
              if (sp.getAttribute("data-master") !== masterId) return;
              var mid = sp.getAttribute("data-source-link"); if (markId && mid !== markId) return;
              out.push({ docCode: code, docTitle: title, blockId: b.id, markId: mid, altId: sp.getAttribute("data-alt") || null, kind: "span" });
            });
          }
        });
      });
      return out;
    }
    // Set/clear a where-used location's altId in ITS OWN document (block field or inline span data-alt).
    // Shared by the 09 fork + the 10 push.
    function applyAltToLocation(reg, loc, altId) {
      var d = reg[loc.docCode]; if (!d) return;
      walkBlocks(d, function (b) {
        if (b.id !== loc.blockId) return;
        if (loc.kind === "span") {
          var host = document.createElement("div"); host.innerHTML = b.text || "";
          var sp = host.querySelector('span[data-source-link="' + loc.markId + '"]');
          if (sp) { if (altId) sp.setAttribute("data-alt", altId); else sp.removeAttribute("data-alt"); b.text = host.innerHTML; }
        } else if (b.sourceLink) {
          if (altId) b.sourceLink.altId = altId; else delete b.sourceLink.altId;
        }
      });
    }

    // --- 09: base-edit warning + fork (fires at LOCK, matching the unlock->lock commit model) ---
    var __sourceLinkOldText = null, __sourcePreEditModelJson = null;
    // On unlock: snapshot each link mark's current wording (so "fork" can freeze it) + the whole model
    // (so "cancel" can revert the edits). Only when the doc actually carries link marks.
    function snapshotSourceLinkBase() {
      var SD = window.SourceDoc, model = sourceDocModel();
      __sourceLinkOldText = null; __sourcePreEditModelJson = null;
      if (!SD || !model || !(model.marks || []).some(function (m) { return m.type === "link"; })) return;
      __sourceLinkOldText = {};
      (model.marks || []).forEach(function (m) { if (m.type === "link") __sourceLinkOldText[m.id] = SD.markText(model, m); });
      __sourcePreEditModelJson = SD.toJSON(model);
    }
    // The blast radius of the just-finished edit session: base-showing locations of edited link marks.
    function sourceBaseEditImpact() {
      var SD = window.SourceDoc, model = sourceDocModel();
      if (!SD || !model || !__sourceLinkOldText) return { affected: [], pinned: [], editedMarks: [] };
      return SD.sourceEditImpact(model, __sourceLinkOldText, sourceLinkWhereUsed(sourceActiveTopicId(), null));
    }
    // "Keep as-is (fork)": freeze each edited link mark's OLD wording as an alternate on the master,
    // and pin every affected (base-showing) location -- in whatever document uses it -- to that
    // alternate. The source base then moves on; those placements keep the old words.
    function forkAffectedToAlternate(impact) {
      var SD = window.SourceDoc, model = sourceDocModel(), reg = registry, byMark = {};
      impact.affected.forEach(function (loc) { (byMark[loc.markId] = byMark[loc.markId] || []).push(loc); });
      Object.keys(byMark).forEach(function (markId) {
        var link = SD.markById(model, markId); if (!link) return;
        var oldText = __sourceLinkOldText[markId];
        var alt = SD.addMark(model, { type: "alternate", anchor: link.anchor, endAnchor: link.endAnchor, alt: oldText, tag: "Frozen", baseText: oldText });
        byMark[markId].forEach(function (loc) { applyAltToLocation(reg, loc, alt.id); });
      });
      saveRegistry(reg); // the alternate marks on the master persist via the lock's own commit
    }
    function finalizeSourceLock(topic, opts) {
      flushSourceEditSession(topic, { prompt: opts.prompt });
      lockSourceEditing(); __sourceLinkOldText = null; __sourcePreEditModelJson = null;
      applySourceLockState(); refreshSourceSelBar(); updateSourceDocBar();
    }
    function revertSourceEditSession(topic) {
      var SD = window.SourceDoc;
      if (SD && __sourcePreEditModelJson && topic) {
        setSourceDocModel(SD.fromJSON(__sourcePreEditModelJson), topic.id);
        persistSourceDocModel(topic, sourceDocModel());
      }
      clearSourceEditSession(); lockSourceEditing(); __sourceLinkOldText = null; __sourcePreEditModelJson = null;
      renderSourceArticle();
      sourceToast("Edit cancelled.");
    }
    // The three-way warning shown at lock when the edit changed linked passages (09).
    function showSourceBaseEditModal(topic, impact, opts) {
      var n = impact.affected.length, resolved = false;
      var forkBtn = window.VersoUI.Button({ variant: "secondary", label: "Keep as-is (fork)", onClick: function () {
        resolved = true; forkAffectedToAlternate(impact); shell.modal.close(); finalizeSourceLock(topic, opts);
        sourceToast("Kept " + n + " linked place" + (n === 1 ? "" : "s") + " on the old wording.");
      } });
      var shell = dsModalShell({
        title: "This source is linked in " + n + " place" + (n === 1 ? "" : "s"),
        subtitle: "Your edit changes wording that other documents link. Choose what those linked copies do.",
        primaryLabel: "Update all",
        cancelLabel: "Cancel edit",
        extras: [forkBtn],
        onPrimary: function () { resolved = true; shell.modal.close(); finalizeSourceLock(topic, opts); sourceToast("Updated " + n + " linked place" + (n === 1 ? "" : "s") + "."); },
        onClose: function () { if (resolved) return; revertSourceEditSession(topic); } // Cancel / Escape / scrim = revert
      });
      shell.body.appendChild(h("div", "insp-hint", "Update all — the linked copies re-resolve to your new wording. Keep as-is — freeze their current wording as an alternate, then your source moves on. Cancel — undo this edit."));
    }

    window.__sourceLink = { // browser-verify hooks
      sourceLinkWhereUsed: sourceLinkWhereUsed, snapshotSourceLinkBase: snapshotSourceLinkBase,
      sourceBaseEditImpact: sourceBaseEditImpact, forkAffectedToAlternate: forkAffectedToAlternate,
      pushSourceAlternate: pushSourceAlternate, applyAltToLocation: applyAltToLocation,
      armSourceLinkPlacement: armSourceLinkPlacement, placeArmedSourceLink: placeArmedSourceLink,
      jumpSourcePanelToMark: jumpSourcePanelToMark, panelSelectionDescriptor: panelSelectionDescriptor,
      startSourceLinkDrag: startSourceLinkDrag, pageIndexFromPoint: pageIndexFromPoint,
      openSourceLinkMenu: openSourceLinkMenu, createSourceAlternate: createSourceAlternate,
      setSourceLinkTargetAlt: setSourceLinkTargetAlt, sourceLinkAlternates: sourceLinkAlternates,
      isArmed: function () { return !!__armedSourceLink; }
    };
    // One-time global wiring: while a linked passage is armed, the next canvas click PLACES it (capture
    // phase, before the canvas's own click-select), and Escape cancels arming.
    if (typeof document !== "undefined" && !window.__sourceLinkWired) {
      window.__sourceLinkWired = true;
      document.addEventListener("click", function (e) {
        if (!__armedSourceLink) return;
        var cv = document.getElementById("canvas-viewport");
        if (cv && cv.contains(e.target)) { e.preventDefault(); e.stopPropagation(); placeArmedSourceLink(e.clientX, e.clientY); }
      }, true);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && __armedSourceLink) { e.preventDefault(); cancelArmedSourceLink(); } });
    }
    // (source-link 03) The SPEC 7 / #137 whole-topic +-insert (insertSourceLinkedBlock) is retired:
    // the Edit Source tab is now a read-only viewer (02) and copy is placed as a range-linked block
    // via select-then-place (armSourceLinkPlacement above), not a whole-topic libraryInstance.
    // Two-way link, direction 2: a linked block's affordance opens the Source stage on its topic.
    function jumpToSourceTopic(topicId) {
      if (!topicId) return;
      openSourceTopicId(topicId);
      setStage("source");
    }
    // Two-way link, direction 1: open the doc, land in Edit, and select the exact linked block.
    function jumpToLinkedBlock(docCode, blockId) {
      openCourseFromBrowser(docCode);
      setStage("edit");
      var b = blockById(blockId);
      if (b) {
        var pi = findPageOfBlock(b);
        if (pi != null && pi >= 0) { focusFrame(pi); setActivePage(pi); }
        reselectBlockNode(b, "block");
      }
    }

    // The explicit drop gap for a placement. It is set for the duration of one placement only and
    // the insert path in assets.js reads it to land each block where the author dropped it rather
    // than at the selection -- so this file provides it, being the only one that writes it.
    kernel.provideLive({ __sourceLinkDropAt: function () { return __sourceLinkDropAt; } });
    kernel.expose({
      renderEditSourcePanel: renderEditSourcePanel, sourceLinkWhereUsed: sourceLinkWhereUsed, sourceLinkAlternates: sourceLinkAlternates,
      sourceAltSnippet: sourceAltSnippet, applyAltToLocation: applyAltToLocation, decorateSourceLinks: decorateSourceLinks,
      snapshotSourceLinkBase: snapshotSourceLinkBase, sourceBaseEditImpact: sourceBaseEditImpact, showSourceBaseEditModal: showSourceBaseEditModal,
      finalizeSourceLock: finalizeSourceLock, jumpToLinkedBlock: jumpToLinkedBlock, jumpToSourceTopic: jumpToSourceTopic
    });
  }

  window.VersoSourceLink = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoSourceLink;
})();
