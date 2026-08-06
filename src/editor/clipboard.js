// editor/clipboard.js -- the verbs that act on a selection (arch-P3b-07).
//
// Delete, duplicate, select-all, copy, paste, and the style-only copy/paste pair. They are one
// concern because they share the hard part, which is not the copying: it is what a block DEPENDS
// on.
//
// A block carries references -- a named text style, a shared component definition -- that live on
// the DOCUMENT, not on the block. Copy it into another course and those references resolve to
// nothing, so the paste would land visibly broken. So a copy collects its dependencies, and a
// paste MERGES them into the destination: a style whose name is taken is renamed rather than
// overwritten, because silently restyling the course you pasted INTO is worse than a duplicate
// name.
//
// Ids are reminted on the way in. Two copies of one block sharing an id is the shape of every
// undo bug in this app's history, and a whole-page paste mints a fresh page id for the same
// reason.
//
// The style clipboard is deliberately separate: copying a block's LOOK and pasting it onto another
// is a different action from copying the block, and merging them into one clipboard would make
// each one surprising.
//
// Editor chrome only: it edits the document and renders none of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "clone", "pushHistory", "getTextStyles", "mount", "clearSelection", "remintIds",
      "getComponents", "registry", "deleteBlockByRef", "clearMultiPages", "switchDoc", "findBlockParent",
      "cleanupColumns", "clearAllMulti", "renderStructure", "refreshCanvasSelection", "renderInspector", "getBlockPageIndexAndIndex",
      "duplicateBlock", "eachCourseNav", "setActivePage", "focusFrame", "setSelection", "insertLoc",
      "reapplyStructural", "findPageOfBlock", "currentDoc", "setMultiSel", "setCurrentPage", "selection",
      "doc", "multiSel", "currentPage"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var clone = E.clone,
        pushHistory = E.pushHistory,
        getTextStyles = E.getTextStyles,
        mount = E.mount,
        clearSelection = E.clearSelection,
        remintIds = E.remintIds,
        getComponents = E.getComponents,
        registry = E.registry,
        deleteBlockByRef = E.deleteBlockByRef,
        clearMultiPages = E.clearMultiPages,
        switchDoc = E.switchDoc,
        findBlockParent = E.findBlockParent,
        cleanupColumns = E.cleanupColumns,
        clearAllMulti = E.clearAllMulti,
        renderStructure = E.renderStructure,
        refreshCanvasSelection = E.refreshCanvasSelection,
        renderInspector = E.renderInspector,
        getBlockPageIndexAndIndex = E.getBlockPageIndexAndIndex,
        duplicateBlock = E.duplicateBlock,
        eachCourseNav = E.eachCourseNav,
        setActivePage = E.setActivePage,
        focusFrame = E.focusFrame,
        setSelection = E.setSelection,
        insertLoc = E.insertLoc,
        reapplyStructural = E.reapplyStructural,
        findPageOfBlock = E.findPageOfBlock,
        currentDoc = E.currentDoc,
        setMultiSel = E.setMultiSel,
        setCurrentPage = E.setCurrentPage;

    // Delete the current selection (multi-selected blocks, or a single selected
    // block/embed/nav button). Pages and component instances are left to their
    // inspector's explicit delete (more destructive / needs confirmation).
    function deleteSelection() {
      if (E.multiSel.length) {
        pushHistory();
        // ref-based removal (via findBlockParent) so NESTED blocks — inside columns /
        // group / frame children — delete too, not just top-level (multi-select now spans
        // containers + pages). Re-resolve per block so sibling index shifts don't matter.
        E.multiSel.slice().forEach(function (b) {
          for (var pi = 0; pi < E.doc.pages.length; pi++) {
            var res = findBlockParent(E.doc.pages[pi].blocks, b);
            if (res) { res.parentArray.splice(res.index, 1); break; }
          }
        });
        E.doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
        clearAllMulti(); clearSelection(); mount();
        return true;
      }
      if ((E.selection.type === "block" || E.selection.type === "embed" || E.selection.type === "navButton") && E.selection.block) {
        deleteBlockByRef(E.selection.block);
        return true;
      }
      // SSS two-state: a text FIELD selected but NOT being edited (contenteditable off)
      // deletes its block — same as any other selected block. (In the default mode the
      // field is always contenteditable, so this never fires and text-delete is normal.)
      if (E.selection.type === "field" && E.selection.block && E.selection.node &&
          E.selection.node.getAttribute && E.selection.node.getAttribute("contenteditable") !== "true") {
        deleteBlockByRef(E.selection.block);
        return true;
      }
      return false;
    }
    // a single selected block, whatever the selection flavour it arrived as
    function selectedSingleBlock() {
      if ((E.selection.type === "block" || E.selection.type === "embed" || E.selection.type === "navButton" || E.selection.type === "field") && E.selection.block) return E.selection.block;
      return null;
    }
    function selectAllOnPage() {
      var p = E.doc.pages[E.currentPage]; if (!p) return;
      clearSelection(); clearMultiPages();
      E.setMultiSel((p.blocks || []).filter(function (b) { return !b.locked; }));
      renderStructure(); refreshCanvasSelection(); renderInspector(); // #131: surface the multi inspector + floating bar on select-all
    }
    function duplicateSelection() {
      if (E.multiSel.length) {
        pushHistory();
        var news = [];
        E.multiSel.slice().forEach(function (b) { var loc = getBlockPageIndexAndIndex(b); if (loc) { var c = remintIds(clone(b)); E.doc.pages[loc.pageIndex].blocks.splice(loc.blockIndex + 1, 0, c); news.push(c); } });
        E.setMultiSel(news); mount(); return;
      }
      var b = selectedSingleBlock(); if (b) duplicateBlock(b);
    }
    // §96 slice 1: cross-FILE paste dependency carry. switchDoc keeps the in-memory
    // clipboard (it's an in-app swap, not a reload), so a block copied in doc A can be
    // pasted into doc B — but the block may reference named text styles (styleRef) or a
    // component def (componentGrid.component) that is CUSTOM to doc A. Without carrying
    // those, the pasted block loses its named style or renders "[unknown component]".
    // We snapshot ONLY the referenced defs at COPY time (source doc still current) and
    // merge the MISSING ones into the target at paste. STANDARD styles/components need no
    // carry — both docs seed the same globals (TEXT_STYLES / COMPONENTS), so a shared name
    // already resolves; and a same-named def the TARGET owns wins (the paste adopts the
    // target's house style — the normal cross-doc named-style contract). Pure + testable.
    /* @pastedeps-start */
    function collectPasteDeps(blocks, srcStyles, srcComponents) {
      var styleNames = {}, compKeys = {};
      (function walk(v) {
        if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) walk(v[i]); return; }
        if (v && typeof v === "object") {
          if (typeof v.styleRef === "string" && v.styleRef) styleNames[v.styleRef] = true;
          if (v.type === "componentGrid" && typeof v.component === "string" && v.component) compKeys[v.component] = true;
          for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k]);
        }
      })(blocks);
      var out = { styles: {}, components: {} };
      Object.keys(styleNames).forEach(function (n) { if (srcStyles && srcStyles[n] != null) out.styles[n] = clone(srcStyles[n]); });
      Object.keys(compKeys).forEach(function (k) { if (srcComponents && srcComponents[k] != null) out.components[k] = clone(srcComponents[k]); });
      return out;
    }
    // Merge captured deps into the target style/component maps, ADD-IF-MISSING only.
    // Returns the names actually added (paste toast + tests); never clobbers a target def.
    function mergePasteDeps(deps, tgtStyles, tgtComponents) {
      var added = { styles: [], components: [] };
      if (deps && deps.styles) Object.keys(deps.styles).forEach(function (n) {
        if (tgtStyles && tgtStyles[n] == null) { tgtStyles[n] = clone(deps.styles[n]); added.styles.push(n); }
      });
      if (deps && deps.components) Object.keys(deps.components).forEach(function (k) {
        if (tgtComponents && tgtComponents[k] == null) { tgtComponents[k] = clone(deps.components[k]); added.components.push(k); }
      });
      return added;
    }
    /* @pastedeps-end */
    window.__pasteDeps = { collect: collectPasteDeps, merge: mergePasteDeps }; // headless test hook

    // What the rest of the chrome may ask about the clipboards. Three regions read them: the tree
    // offers "Paste page after" only when there is one, and the context menu and the block bar gate
    // their paste actions the same way (arch-P3b-07).
    function clipboardNow() { return clipboard; }
    function pageClipboardNow() { return pageClipboard; }
    function styleClipboardNow() { return styleClipboard; }
    var clipboard = []; // cloned blocks (Cmd+C / Cmd+V)
    var clipboardDeps = { styles: {}, components: {} }; // §96: styles/components the clipboard blocks reference
    var pageClipboard = null; // §96 slice 2: a whole page + its deps (same-doc + cross-file)
    function copySelection() {
      // §96 slice 2: a PAGE is selected -> copy the whole page (blocks + page props + deps).
      // Cmd+V then pastes the page after the current one; routing keys off pageClipboard.
      if (E.selection.type === "page" && E.selection.node != null) {
        var pg = E.doc.pages[E.selection.node];
        if (!pg) return false;
        pageClipboard = { page: clone(pg), deps: collectPasteDeps(pg.blocks || [], E.doc.styles, E.doc.components) };
        clipboard = []; // route the next paste to the page path
        return true;
      }
      var items = [];
      if (E.multiSel.length) items = E.multiSel.map(clone);
      else { var b = selectedSingleBlock(); if (b) items = [clone(b)]; }
      if (!items.length) return false;
      clipboard = items;
      clipboardDeps = collectPasteDeps(items, E.doc.styles, E.doc.components); // capture NOW (source doc is current)
      pageClipboard = null; // a block copy supersedes any held page
      return true;
    }
    // §96 slice 2: paste the held page AFTER the current page (same-doc or cross-file).
    // Mirrors duplicatePage (fresh page + block ids, courseNav section sync) but also
    // carries custom styles/components into THIS doc and re-homes the page into the insert
    // anchor's chapter (the source's chapterId is meaningless in another file).
    function pastePage() {
      if (!pageClipboard) return false;
      if (!E.doc.pages) return false;
      pushHistory();
      var copy = clone(pageClipboard.page);
      copy.id = "page-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
      (copy.blocks || []).forEach(remintIds);
      mergePasteDeps(pageClipboard.deps, getTextStyles(), getComponents()); // add-if-missing
      window.applyRenderContext({ docStyles: getTextStyles() });
      var at = (E.currentPage != null && E.currentPage >= 0 && E.currentPage < E.doc.pages.length) ? currentPage : E.doc.pages.length - 1;
      var anchor = E.doc.pages[at];
      copy.chapterId = anchor ? (anchor.chapterId || null) : ((E.doc.pages[0] && E.doc.pages[0].chapterId) || null);
      E.doc.pages.splice(at + 1, 0, copy);
      eachCourseNav(function (nav) {
        (nav.sections || []).forEach(function (sec) {
          var i = anchor ? (sec.pageIds || []).indexOf(anchor.id) : -1;
          if (i >= 0 && sec.pageIds.indexOf(copy.id) < 0) sec.pageIds.splice(i + 1, 0, copy.id);
        });
      });
      E.setCurrentPage(at + 1);
      mount();
      setActivePage(at + 1);
      focusFrame(at + 1);
      setSelection("page", at + 1);
      return true;
    }
    // Paste-without-formatting (Cmd+Shift+V): strip block-level style + inline text formatting
    // from the pasted subtree so it inherits the theme / target defaults. Recurses into nested
    // children. SKIPS raw embed / asset markup (html/svg/src + full documents) so an interaction
    // keeps its own styling. Deletes style/styleRef on every node; removes inline formatting
    // tags (b/i/span/font/…) + style="" attrs from rich text, keeping structural tags (li/p/br).
    function stripFormattingDeep(v) {
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) stripFormattingDeep(v[i]); return; }
      if (v && typeof v === "object") {
        delete v.style; delete v.styleRef;
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
          var val = v[k];
          if (typeof val === "string") {
            if (k === "html" || k === "svg" || k === "src") continue;
            if (/<!doctype|<html[\s>]/i.test(val)) continue;
            v[k] = val.replace(/<\/?(?:b|i|u|s|span|font|strong|em|sub|sup|mark|small)(?:\s[^>]*)?>/gi, "").replace(/\sstyle="[^"]*"/gi, "");
          } else stripFormattingDeep(val);
        }
      }
    }
    window.__stripFormattingDeep = stripFormattingDeep; // headless test hook
    function pasteClipboard(strip) {
      if (pageClipboard && !clipboard.length) return pastePage(); // §96 slice 2: a page is held
      if (!clipboard.length) return false;
      var p = E.doc.pages[E.currentPage]; if (!p) return false;
      pushHistory();
      // §96: carry any CUSTOM styles/components the clipboard references into THIS doc
      // (add-if-missing) so a cross-file paste keeps its named style + resolves its
      // component. No-op for a same-doc paste / standard defs. Skip carrying styles when
      // stripping (paste-without-formatting drops styleRef anyway).
      if (!strip) mergePasteDeps(clipboardDeps, getTextStyles(), getComponents());
      else mergePasteDeps({ styles: {}, components: clipboardDeps.components }, getTextStyles(), getComponents());
      window.applyRenderContext({ docStyles: getTextStyles() }); // render resolves the newly-carried styles this pass
      var news = clipboard.map(function (b) { var c = remintIds(clone(b)); if (strip) stripFormattingDeep(c); return c; });
      var L = insertLoc(); // FFFF: paste after the selected block (into its own container — incl. a hotspot card), else bottom
      news.forEach(function (c, i) { L.array.splice(L.index + i, 0, c); });
      clearSelection(); clearMultiPages(); E.setMultiSel(news.slice());
      // PERF: paste lands on ONE page (the selection's / currentPage); rebuild just it.
      // If the pasted blocks somehow span pages, findPageOfBlock(news[0]) still isolates
      // the first; a not-found (-1) falls back to a full mount inside reapplyStructural.
      reapplyStructural(findPageOfBlock(news[0])); return true;
    }
    // §96 browser-verify hook: drive the real cross-FILE flow (copy in A -> switchDoc B ->
    // paste) through the actual paste + dependency-carry wiring, not a reimplementation.
    window.__xfer = {
      registry: function () { return registry; },
      currentDoc: function () { return E.doc; },
      addDoc: function (d) { registry[d.meta.code] = d; },
      switchDoc: switchDoc,
      loadClipboard: function (items, srcStyles, srcComponents) { clipboard = items.map(clone); clipboardDeps = collectPasteDeps(clipboard, srcStyles, srcComponents); pageClipboard = null; },
      loadPageClipboard: function (pg, srcStyles, srcComponents) { pageClipboard = { page: clone(pg), deps: collectPasteDeps(pg.blocks || [], srcStyles, srcComponents) }; clipboard = []; },
      clipboardDeps: function () { return clipboardDeps; },
      paste: function (strip) { return pasteClipboard(strip); },
      setPage: function (i) { E.setCurrentPage(i); }
    };

    // Copy Style / Paste Style: lift ONLY presentation keys off a block (never content or
    // identity) so pasting pushes the LOOK onto another block. render ignores keys that don't
    // apply to the target type (a paragraph has no box/colorMap), so it's safe across types +
    // additive (only the source's keys are written).
    var STYLE_KEYS = ["style", "styleRef", "box", "cardBox", "colorMap", "embedColorMap", "embedBg", "coverColor", "coverOpacity", "coverBlur", "cardH", "cols", "gap", "fit", "fitH", "fitFill", "padding", "maxWidth", "border", "borderColor", "borderWidth", "radius", "height", "spaceTop", "spaceBottom", "autoTint", "themeFallback", "align"];
    var styleClipboard = null;
    function copyBlockStyle(block) {
      if (!block) return false;
      var out = {};
      STYLE_KEYS.forEach(function (k) { if (block[k] !== undefined) out[k] = clone(block[k]); });
      if (!Object.keys(out).length) return false;
      styleClipboard = out; return true;
    }
    function pasteBlockStyle(block) {
      if (!styleClipboard || !block) return false;
      pushHistory();
      Object.keys(styleClipboard).forEach(function (k) { block[k] = clone(styleClipboard[k]); });
      mount(); return true;
    }

    // These three are reassigned as the author copies, so they cross as live getters. They used to
    // be provided by editor.js from its own variables; it no longer has them.
    kernel.provideLive({
      clipboard: clipboardNow,
      pageClipboard: pageClipboardNow,
      styleClipboard: styleClipboardNow
    });
    kernel.expose({
      deleteSelection: deleteSelection, selectedSingleBlock: selectedSingleBlock, selectAllOnPage: selectAllOnPage,
      duplicateSelection: duplicateSelection, copySelection: copySelection, pastePage: pastePage,
      pasteClipboard: pasteClipboard, copyBlockStyle: copyBlockStyle, pasteBlockStyle: pasteBlockStyle,
      collectPasteDeps: collectPasteDeps, mergePasteDeps: mergePasteDeps, stripFormattingDeep: stripFormattingDeep,
      pageClipboardNow: pageClipboardNow, clipboardNow: clipboardNow, styleClipboardNow: styleClipboardNow
    });
  }

  window.VersoClipboard = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoClipboard;
})();
