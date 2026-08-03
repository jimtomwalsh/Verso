// editor/structure-ops.js -- the verbs that change the SHAPE of a course (arch-P3b-07w).
//
// Duplicate, clear, convert, split, merge, move. One block or one page, and always the same
// question: after this edit, what is the document made of? These are the operations behind the
// canvas action bar, the right-click menu, the outliner's row menu and three keyboard shortcuts
// -- eight surfaces in six files, none of which should have to know that splitting a page means
// renumbering a split family and re-syncing every learner nav.
//
// That last part is why the courseNav bookkeeping came too. Three of these ops call
// `eachCourseNav` after they change the page list, because a nav that still points at the old
// shape is a broken course; `footerCourseNav` is its documented sibling, the #168 rule that says
// WHICH nav is canonical when several exist. Separating a pair whose comment explains both would
// have cost more than it saved.
//
// The page-library trio (save a page as a master, insert one, detach an instance) sits here for
// the same reason: inserting a master is a page insert, and detaching one rewrites a page in
// place. What they share with the rest of the file is the page list, not the library.
//
// Nothing here renders. Every op mutates the document, pushes history, and hands the redraw to
// mount / reapplyStructural -- which is exactly why they can be called from eight places without
// any of them agreeing on what the screen currently looks like. The pure-render invariant holds
// trivially: this file never touches render().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "setSelection", "pushHistory", "mount", "setActivePage", "remintIds", "clone",
      "reapplyStructural", "libComponents", "walkPageBlocks", "reselectBlockNode", "confirmModal", "focusFrame",
      "findPageOfBlock", "firstCopyOf", "promptModal", "saveLibrary", "resolveComponentDef", "stripSplitSuffix",
      "renumberSplitFamily", "setCurrentPage", "doc", "currentPage", "frameDescs", "selection"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var setSelection = E.setSelection,
        pushHistory = E.pushHistory,
        mount = E.mount,
        setActivePage = E.setActivePage,
        remintIds = E.remintIds,
        clone = E.clone,
        reapplyStructural = E.reapplyStructural,
        libComponents = E.libComponents,
        walkPageBlocks = E.walkPageBlocks,
        reselectBlockNode = E.reselectBlockNode,
        confirmModal = E.confirmModal,
        focusFrame = E.focusFrame,
        findPageOfBlock = E.findPageOfBlock,
        firstCopyOf = E.firstCopyOf,
        promptModal = E.promptModal,
        saveLibrary = E.saveLibrary,
        resolveComponentDef = E.resolveComponentDef,
        stripSplitSuffix = E.stripSplitSuffix,
        renumberSplitFamily = E.renumberSplitFamily,
        setCurrentPage = E.setCurrentPage;

    function getBlockPageIndexAndIndex(block) {
      for (var pi = 0; pi < E.doc.pages.length; pi++) {
        var pg = E.doc.pages[pi]; if (!pg || !pg.blocks) continue; // a stray null/malformed page entry must not abort every later page's lookup
        var idx = pg.blocks.indexOf(block);
        if (idx >= 0) return { pageIndex: pi, blockIndex: idx };
      }
      return null;
    }
    function getSelectionTypeForBlock(block) {
      if (block.type === "htmlEmbed" || block.type === "webEmbed") return "embed";
      if (block.type === "navButton") return "navButton";
      if (block.type === "componentGrid") return "block";
      if (block.type === "libraryInstance") return "block";
      // non-text primitives + containers are configured in the block inspector
      if (block.type === "image" || block.type === "divider" || block.type === "spacer" || block.type === "frame" || block.type === "group" || block.type === "checkbox" || block.type === "accordion" || block.type === "cardReveal" || block.type === "sequence" || block.type === "cardDeck" || block.type === "courseNav") return "block";
      if (block.type === "quiz" || block.type === "hotspot" || block.type === "table") return "block";
      return "field";
    }
    function duplicateBlock(block) {
      var loc = getBlockPageIndexAndIndex(block);
      if (!loc) return;
      pushHistory(); // DDD: was undoable-gap — no caller pushed, so a duplicate couldn't be undone
      var pi = loc.pageIndex, idx = loc.blockIndex;
      var fresh = remintIds(clone(block)); // re-mint so the copy's ids never collide
      E.doc.pages[pi].blocks.splice(idx + 1, 0, fresh);
      reapplyStructural(pi); // PERF: one page, not the world
      reselectBlockNode(fresh, getSelectionTypeForBlock(fresh));
    }
    // #174: text-bearing block types whose authored copy lives on block.text.
    var TEXT_CONTENT_TYPES = { heading: 1, subheading: 1, paragraph: 1, note: 1, quote: 1, list: 1 };
    // #174 Clear content: recursively blank a block subtree's authored CONTENT — text,
    // image/embed asset refs, and interactive copy (item titles/labels/dates, quiz
    // prompts/option text/feedback, hotspot labels + base image) — while KEEPING the block
    // SKELETON: every sub-block, column, item and question stays; only its payload is wiped.
    // Turns a built block (or a whole container subtree) into a reusable blank template.
    // PURE data mutation on the block tree, deleting REFERENCES only (no AssetStore hoist) ->
    // storage-invariant safe. Recurses the canonical subtree shape (children / columns[] /
    // items[].children / items[].front / hotspots[].blocks), mirroring the doc deep-walks.
    function clearBlockContent(block) {
      if (!block || typeof block !== "object") return;
      var t = block.type;
      if (TEXT_CONTENT_TYPES[t]) block.text = "";
      if (t === "image") { delete block.src; delete block.srcLight; delete block.srcDark; delete block.caption; delete block.alt; }
      if (t === "htmlEmbed" || t === "webEmbed") { delete block.html; delete block.src; }
      if (t === "hotspot") {
        // #215 unified screen-graph: visuals/alt live on the Screen nodes; markers keep
        // their position/action skeleton, lose label, recurse card blocks. Inlined walk
        // (not hotspotCardArrays) so the tests' clearBlockContent slice stays standalone.
        delete block.src; delete block.alt; delete block.markerSvg; delete block.markerHtml;
        if (Array.isArray(block.screens)) block.screens.forEach(function (s) {
          if (!s) return; delete s.visual; delete s.alt;
          if (Array.isArray(s.markers)) s.markers.forEach(function (m) {
            if (!m) return; delete m.label;
            if (Array.isArray(m.blocks)) m.blocks.forEach(clearBlockContent);
          });
        });
      }
      if (t === "cardReveal") delete block.hint;
      if (t === "quiz" && Array.isArray(block.questions)) block.questions.forEach(function (q) {
        if (!q) return;
        q.prompt = ""; delete q.feedbackCorrect; delete q.feedbackIncorrect;
        if (Array.isArray(q.options)) q.options.forEach(function (o) { if (o) o.text = ""; });
      });
      // Container / item recursion — keep the skeleton, clear the payload.
      if (Array.isArray(block.children)) block.children.forEach(clearBlockContent);
      if (Array.isArray(block.columns)) block.columns.forEach(function (col) { if (Array.isArray(col)) col.forEach(clearBlockContent); });
      if (Array.isArray(block.items)) block.items.forEach(function (it) {
        if (!it) return;
        if ("title" in it) it.title = "";
        if ("label" in it) delete it.label;
        if ("date" in it) delete it.date;
        if (Array.isArray(it.children)) it.children.forEach(clearBlockContent);
        if (Array.isArray(it.front)) it.front.forEach(clearBlockContent);
      });
    }
    window.__clearBlockContent = clearBlockContent; // #174 test hook (pure subtree clear)
    // #170/#33: text<->list BLOCK-TYPE conversion (not an inline execCommand list -- a
    // whole-block type swap between the dedicated "list" type and any other text-content
    // type). Only block-level tags are treated as item breaks, so inline formatting
    // (b/i/u/span/a) survives untouched inside each <li>.
    /* @list-convert-start */
    function htmlToListItems(html) {
      var s = String(html == null ? "" : html);
      s = s.replace(/<\/(p|div)>/gi, "\n").replace(/<(p|div)[^>]*>/gi, "").replace(/<br\s*\/?>/gi, "\n");
      var lines = s.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
      if (!lines.length) return "<li></li>";
      return lines.map(function (l) { return "<li>" + l + "</li>"; }).join("");
    }
    // Inverse: join <li> items back into one flowing field, each item's inline HTML kept
    // intact, multiple items separated by <br> so nothing is silently dropped.
    function listItemsToHtml(liHtml) {
      var s = String(liHtml == null ? "" : liHtml);
      var items = [], re = /<li[^>]*>([\s\S]*?)<\/li>/gi, m;
      while ((m = re.exec(s))) items.push(m[1].trim());
      if (!items.length) return s; // not actually <li>-shaped -- return untouched (defensive)
      return items.join("<br>");
    }
    // Converts a text-content block to/from the dedicated "list" type IN PLACE. Remembers
    // the PRIOR type on the block (__priorTextType) so a round-trip restores it (default
    // "paragraph" if that memory is somehow absent) -- heading<->list<->heading is lossless
    // on TYPE; content is lossless on inline formatting (see htmlToListItems above).
    function convertTextListBlockType(block) {
      if (!block) return block;
      if (block.type === "list") {
        var restore = block.__priorTextType || "paragraph";
        block.text = listItemsToHtml(block.text);
        block.type = restore;
        delete block.__priorTextType;
      } else {
        block.__priorTextType = block.type;
        block.text = htmlToListItems(block.text);
        block.type = "list";
      }
      return block;
    }
    /* @list-convert-end */
    window.__convertTextListBlockType = convertTextListBlockType; // test hook
    // Action wrapper: confirm (destructive), push history, clear one or more blocks, remount.
    function clearBlockContentAction(blocks) {
      var list = Array.isArray(blocks) ? blocks.filter(Boolean) : [blocks].filter(Boolean);
      if (!list.length) return;
      var msg = list.length > 1
        ? ("Empty all copy, images and embeds from these " + list.length + " blocks? The block structure is kept; this can be undone.")
        : "Empty all copy, images and embeds from this block? The block structure is kept; this can be undone.";
      confirmModal("Clear content", msg, function () {
        pushHistory();
        list.forEach(clearBlockContent);
        var pi = findPageOfBlock(list[0]);
        if (pi >= 0) reapplyStructural(pi); else mount();
        reselectBlockNode(list[0], getSelectionTypeForBlock(list[0]));
      }, { danger: true, okLabel: "Clear content" });
    }
    // Page context menu: deep-clone a page (fresh page + block ids), keep it in the
    // same chapter, and drop it right after the source. Mirrors splitPageAtBlock's
    // chapter-inherit + courseNav section-membership sync so nav/progress stay correct.
    function duplicatePage(pi) {
      var src = E.doc.pages[pi];
      if (!src) return;
      pushHistory();
      var copy = clone(src);                 // carries chapterId, padX/Y, hide flags, blocks
      copy.id = "page-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
      copy.name = (src.name || "Page") + " copy"; // legacy field (export data-name)
      // P2: freeze a disambiguating title override on the duplicate so it doesn't read as an
      // identical auto-derived name to its source (number stays auto-derived by position).
      var _srcTitle = (src.title != null ? String(src.title) : firstCopyOf(src));
      if (_srcTitle) copy.title = _srcTitle + " copy"; else delete copy.title;
      (copy.blocks || []).forEach(remintIds); // re-mint block ids so the copy never collides
      E.doc.pages.splice(pi + 1, 0, copy);
      // sync section membership: wherever src.id sits, drop copy.id right after it
      eachCourseNav(function (nav) {
        (nav.sections || []).forEach(function (sec) {
          var at = (sec.pageIds || []).indexOf(src.id);
          if (at >= 0 && sec.pageIds.indexOf(copy.id) < 0) sec.pageIds.splice(at + 1, 0, copy.id);
        });
      });
      E.setCurrentPage(pi + 1);
      mount();
      setActivePage(pi + 1);
      focusFrame(pi + 1);
      setSelection("page", pi + 1);
    }
    // #22: capture a whole PAGE as a shared-library master. Goes straight to the shared
    // library (unlike a block, which stages through doc.components / "My Components" first)
    // -- a course-local "My Pages" concept has no clear use on its own, cross-course reuse
    // IS the point for a page. Mints every block's id ONCE here (remintIds per top-level
    // block, mirroring saveBlockAsComponent) -- from this point those ids are PERMANENT
    // (#19's contract), the substrate #21-style overrides on this page's instances key to.
    function savePageAsLibraryMaster(pi) {
      var page = E.doc.pages[pi];
      if (!page) return;
      promptModal("Name this reusable page", "Page name", page.name || page.title || "Page", function (v) {
        var name = (v || "").trim();
        if (!name) return;
        var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (!id) { alert("Please use a name with some letters or numbers."); return; }
        function save() {
          pushHistory();
          var blocks = (page.blocks || []).map(function (b) { return remintIds(clone(b)); });
          window.LibraryStore.components[id] = { name: name, kind: "page", template: { blocks: blocks } };
          saveLibrary();
          mount(); setSelection("page", pi);
          alert("Saved “" + name + "” to the shared library. Find it in Settings → System → Component Library.");
        }
        if (libComponents()[id]) confirmModal("Overwrite component", "The library already has “" + id + "”. Overwrite it?", save, { okLabel: "Overwrite" });
        else save();
      });
    }
    // #22: insert a NEW page that live-links to a page master, right after the current
    // page in its chapter -- same insertion shape as duplicatePage (fresh page id,
    // courseNav section sync), but the page carries libraryRef instead of its own blocks.
    function insertPageFromLibrary(key) {
      pushHistory();
      var afterId = E.doc.pages[E.currentPage] && E.doc.pages[E.currentPage].id;
      var newPage = {
        id: "page-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        name: (libComponents()[key] && libComponents()[key].name) || "Page",
        chapterId: E.doc.pages[E.currentPage] && E.doc.pages[E.currentPage].chapterId,
        libraryRef: key
      };
      E.doc.pages.splice(E.currentPage + 1, 0, newPage);
      eachCourseNav(function (nav) {
        (nav.sections || []).forEach(function (sec) {
          var at = (sec.pageIds || []).indexOf(afterId);
          if (at >= 0 && sec.pageIds.indexOf(newPage.id) < 0) sec.pageIds.splice(at + 1, 0, newPage.id);
        });
      });
      E.setCurrentPage(E.currentPage + 1);
      mount();
      setActivePage(E.currentPage);
      setSelection("page", E.currentPage);
    }
    // #22: convert a live page-instance into an independent page, in place -- same "detach
    // bakes what you see" principle #21/#23 established for block instances: axis content
    // resolves, THEN instance overrides apply, THEN every block's id is freshly reminted
    // (a genuine new landed copy, per #19's remintIds contract). Keeps a __linkedFrom
    // breadcrumb (no relink UI for pages in v1 -- out of this ticket's agreed scope, unlike
    // #21's block-level Relink).
    function detachPageLibraryInstance(pi) {
      var page = E.doc.pages[pi];
      if (!page || !page.libraryRef) return;
      var def = resolveComponentDef(page.libraryRef);
      if (!def || !def.template) return;
      pushHistory();
      var ref = page.libraryRef;
      var blocks = (def.template.blocks || []).map(function (b) {
        var withOverrides = clone(b);
        if (window.resolveLibraryAxisContent) withOverrides = window.resolveLibraryAxisContent(withOverrides, window.__libraryAxisContext);
        if (page.overrides && window.applyInstanceOverrides) window.applyInstanceOverrides(withOverrides, page.overrides);
        return remintIds(withOverrides);
      });
      delete page.libraryRef;
      delete page.overrides;
      page.__linkedFrom = ref;
      page.blocks = blocks;
      mount(); setActivePage(pi); setSelection("page", pi);
    }
    // Split-page v2: merge a page with the one after it (inverse of splitPageAtBlock).
    // Only within the SAME chapter (the column-major next page) so content never jumps
    // chapters unexpectedly. Appends the next page's blocks, drops it, cleans courseNav.
    function hasMergeableNext(pi) {
      var a = E.doc.pages[pi], b = E.doc.pages[pi + 1];
      return !!(a && b && (a.chapterId || null) === (b.chapterId || null));
    }
    function mergePageWithNext(pi) {
      var a = E.doc.pages[pi], b = E.doc.pages[pi + 1];
      if (!a || !b) return;
      if ((a.chapterId || null) !== (b.chapterId || null)) {
        window.alert("The next page is in a different chapter. Move it into this chapter first (drag in the outliner) to merge.");
        return;
      }
      pushHistory();
      a.blocks = (a.blocks || []).concat(b.blocks || []);
      eachCourseNav(function (nav) {
        (nav.sections || []).forEach(function (sec) {
          var at = (sec.pageIds || []).indexOf(b.id);
          if (at >= 0) sec.pageIds.splice(at, 1); // the merged-away page no longer exists
        });
      });
      E.doc.pages.splice(pi + 1, 1);
      if (E.currentPage > pi) E.setCurrentPage(pi);
      mount();
      setActivePage(pi);
      focusFrame(pi);
      setSelection("page", pi);
    }
    // Item LL — split-page (slice) tool. Cut a long page in two at a top-level
    // block boundary: `block` and everything below it become a new page spliced in
    // right after. Model-only op; render/export untouched. Restricted to top-level
    // page blocks (getBlockPageIndexAndIndex only sees those) and never at index 0
    // (that would leave the first page empty). Section membership on every courseNav
    // block is synced so the new page inherits the same chapter as its parent.
    function eachCourseNav(fn) {
      var ch = E.doc.headerFooter || {};
      [ch.header, ch.footer].forEach(function (region) {
        if (region && region.children) walkPageBlocks(region.children, function (b) { if (b.type === "courseNav") fn(b); });
      });
      E.doc.pages.forEach(function (p) { walkPageBlocks(p.blocks, function (b) { if (b.type === "courseNav") fn(b); }); });
    }
    // #168: the ONE canonical learner nav is the FOOTER's courseNav — the only one an author
    // can create (the "+ Learner nav bar" button is footer-only + gated to none-present, and
    // courseNav is not in the block palette). The Settings modal 'Learner nav' tab used to grab
    // the FIRST courseNav `eachCourseNav` yielded (header -> footer -> pages), so a legacy/stray
    // header or page nav would win and drift from the footer nav the author selects on canvas.
    // Resolving both surfaces to THIS instance makes them a single source of truth. Null = the
    // footer has no nav yet.
    function footerCourseNav() {
      var f = E.doc.headerFooter && E.doc.headerFooter.footer;
      var found = null;
      if (f && f.children) walkPageBlocks(f.children, function (b) { if (b.type === "courseNav" && !found) found = b; });
      return found;
    }
    function canSplitAtBlock(block) {
      var loc = getBlockPageIndexAndIndex(block);
      return !!loc && loc.blockIndex > 0;
    }
    function splitPageAtBlock(block) {
      var loc = getBlockPageIndexAndIndex(block);
      if (!loc) { window.alert("Split works only on a top-level block (not inside a group or columns)."); return; }
      var pi = loc.pageIndex, idx = loc.blockIndex;
      if (idx <= 0) { window.alert("This is the first block on the page — nothing above it to keep. Pick a lower block."); return; }
      pushHistory();
      var P = E.doc.pages[pi];
      var tail = P.blocks.splice(idx); // blocks[idx..] move to the new page
      var newPage = {
        id: "page-" + Date.now(),
        // uio-E-C07 (EDIT-12): seed with the clean base; renumberSplitFamily rewrites the whole run
        // to "Base · K of M" below, so splits never accumulate " (cont.)".
        name: stripSplitSuffix(P.name || "Page"),
        blocks: tail
      };
      // inherit page-level props so the cont. page renders identically
      if (P.chapterId != null) newPage.chapterId = P.chapterId; // IIII: cont. page stays in parent's chapter (nav/progress correct)
      if (P.padX != null) newPage.padX = P.padX;
      if (P.padXTablet != null) newPage.padXTablet = P.padXTablet;
      if (P.padXMobile != null) newPage.padXMobile = P.padXMobile;
      if (P.padY != null) newPage.padY = P.padY;
      if (P.hideHeader) newPage.hideHeader = P.hideHeader;
      if (P.hideFooter) newPage.hideFooter = P.hideFooter;
      E.doc.pages.splice(pi + 1, 0, newPage);
      renumberSplitFamily(E.doc, P.id); // uio-E-C07: rename the run to "Base · K of M" (no accumulating "(cont.)")
      // sync section membership: wherever P.id sits, drop newPage.id right after it
      eachCourseNav(function (nav) {
        (nav.sections || []).forEach(function (sec) {
          var at = (sec.pageIds || []).indexOf(P.id);
          if (at >= 0 && sec.pageIds.indexOf(newPage.id) < 0) sec.pageIds.splice(at + 1, 0, newPage.id);
        });
      });
      E.setCurrentPage(pi); // stay on the first half (linear next now reaches the cont.)
      mount();
      setActivePage(pi);
      setSelection("page", pi);
    }
    function moveBlock(block, dir) {
      var loc = getBlockPageIndexAndIndex(block);
      if (!loc) return;
      var pi = loc.pageIndex, idx = loc.blockIndex;
      var targetIdx = idx + dir;
      var p = E.doc.pages[pi];
      if (targetIdx >= 0 && targetIdx < p.blocks.length) {
        pushHistory(); // DDD: was undoable-gap — no caller pushed, so a move couldn't be undone (push only on a real move, not an at-edge no-op)
        var temp = p.blocks[idx];
        p.blocks[idx] = p.blocks[targetIdx];
        p.blocks[targetIdx] = temp;
        reapplyStructural(pi); // PERF: one page, not the world

        var newFrame = E.frameDescs[pi] && E.frameDescs[pi].frame;
        var newSection = newFrame && newFrame.querySelector(".page");
        var newNode = newSection ? newSection.children[targetIdx] : null;
        if (newNode) {
          var selType = E.selection.type;
          if (selType === "block") {
            setSelection("block", newNode);
          } else if (selType === "field") {
            var fieldNode = newNode.querySelector("[data-edit]") || newNode;
            setSelection("field", fieldNode);
          } else if (selType === "navButton") {
            setSelection("navButton", newNode);
          } else if (selType === "embed") {
            setSelection("embed", newNode);
          }
        }
      }
    }

    kernel.expose({
      getBlockPageIndexAndIndex: getBlockPageIndexAndIndex, getSelectionTypeForBlock: getSelectionTypeForBlock, duplicateBlock: duplicateBlock,
      clearBlockContent: clearBlockContent, convertTextListBlockType: convertTextListBlockType, clearBlockContentAction: clearBlockContentAction,
      duplicatePage: duplicatePage, savePageAsLibraryMaster: savePageAsLibraryMaster, insertPageFromLibrary: insertPageFromLibrary,
      detachPageLibraryInstance: detachPageLibraryInstance, hasMergeableNext: hasMergeableNext, mergePageWithNext: mergePageWithNext,
      eachCourseNav: eachCourseNav, footerCourseNav: footerCourseNav, canSplitAtBlock: canSplitAtBlock,
      splitPageAtBlock: splitPageAtBlock, moveBlock: moveBlock
    });
    // Constants the rest of the chrome reads as DATA. They cannot cross as bound forwarders,
    // because bind() returns a function.
    kernel.provide({
      TEXT_CONTENT_TYPES: TEXT_CONTENT_TYPES
    });
  }

  window.VersoStructureOps = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoStructureOps;
})();
