// editor/pages.js -- how a course is arranged: chapters, and which one a page belongs to
// (arch-P3b-07r).
//
// A Verso course is pages grouped into chapters, and the canvas draws one COLUMN per chapter. So
// there are two ways to change that grouping and they have to agree: the chapter list itself
// (create, rename-by-reorder, delete and what happens to the pages left behind), and the direct
// gesture -- dragging a page by its label into another column. Both end in the same two writes,
// `page.chapterId` and a column-major resort, which is why they are one file.
//
// The delete is the interesting half. Removing a chapter must not remove its pages: they fall back
// to the first remaining chapter, and the resort puts them where that chapter's column is. A
// chapter op that quietly took pages with it would be the worst kind of data loss here, because
// the pages are still in the .json and simply stop being reachable.
//
// WHAT THIS IS NOT. The banner it came from -- "JJJJ: page drag-reparent" -- claimed 502 lines and
// held 50. The other 450 are the world BUILDER: buildWorld, layoutColumns, the resize observer,
// the connector painter and the gap affordances. That is the canvas render loop, not page
// arrangement, and it is where the canvas geometry (world, framePos, frameX/frameY, FRAME_W) has
// to end up. It has its own note in the handoff and its own slice ahead of it.
//
// Editor chrome only: it rearranges the document and hands the redraw to mount().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "view", "mount", "setSelection", "canvas", "GAP_X", "pushHistory",
      "setActivePage", "h", "colX", "doc", "FRAME_W", "world"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var view = E.view,
        mount = E.mount,
        setSelection = E.setSelection,
        canvas = E.canvas,
        GAP_X = E.GAP_X,
        pushHistory = E.pushHistory,
        setActivePage = E.setActivePage,
        h = E.h,
        colX = E.colX;

    // ---- Chapter ops (JJJJ) ---------------------------------------------------
    function createChapter(name) {
      if (!Array.isArray(E.doc.chapters)) E.doc.chapters = [];
      var id = "chap-" + Date.now() + "-" + Math.floor(Math.random() * 1e4);
      var maxOrder = E.doc.chapters.reduce(function (m, c) { return Math.max(m, (c.order || 0) + 1); }, 0);
      E.doc.chapters.push({ id: id, name: name || ("Chapter " + (E.doc.chapters.length + 1)), order: maxOrder });
      return id;
    }
    // Reassign page index `pi` to a chapter, re-sort doc.pages column-major, return
    // the moved page's NEW index (so the caller can keep it selected/current).
    function moveToChapter(pi, chapterId) {
      var pages = E.doc.pages || [];
      var page = pages[pi];
      if (!page) return pi;
      pages.splice(pi, 1);            // pull it out of its current spot
      page.chapterId = chapterId;
      var at = window.chapterInsertIndex ? window.chapterInsertIndex(pages, chapterId, E.doc.chapters) : pages.length;
      pages.splice(at, 0, page);      // drop it at the END of the target chapter (addition order)
      return at;
    }
    function chapterPos(id) {
      var sorted = (E.doc.chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      for (var i = 0; i < sorted.length; i++) if (sorted[i].id === id) return { sorted: sorted, pos: i };
      return { sorted: sorted, pos: -1 };
    }
    // Swap a chapter with its neighbour (dir -1 left / +1 right); re-sort pages.
    function reorderChapter(id, dir) {
      var r = chapterPos(id), pos = r.pos, swap = pos + dir;
      if (pos < 0 || swap < 0 || swap >= r.sorted.length) return false;
      var t = r.sorted[pos].order; r.sorted[pos].order = r.sorted[swap].order; r.sorted[swap].order = t;
      // Keep the chapters ARRAY canonical (sorted by order, order re-indexed to position) so
      // array-index == c.order — otherwise array-index consumers diverge from the outline and
      // Next skips a chapter. (Fix 2026-07-08.)
      if (Array.isArray(E.doc.chapters)) {
        E.doc.chapters.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        E.doc.chapters.forEach(function (c, i) { c.order = i; });
      }
      if (window.resortColumnMajor) E.doc.pages = window.resortColumnMajor(E.doc.pages, E.doc.chapters);
      return true;
    }
    // Delete a chapter; its pages move to the previous chapter (or the next if it
    // was the first). Refuses the last chapter.
    function deleteChapter(id) {
      var chs = E.doc.chapters || [];
      if (chs.length <= 1) { window.alert("A course needs at least one chapter."); return false; }
      var r = chapterPos(id); if (r.pos < 0) return false;
      var target = r.sorted[r.pos > 0 ? r.pos - 1 : 1];
      (E.doc.pages || []).forEach(function (p) { if (p.chapterId === id) p.chapterId = target.id; });
      E.doc.chapters = chs.filter(function (c) { return c.id !== id; });
      if (window.resortColumnMajor) E.doc.pages = window.resortColumnMajor(E.doc.pages, E.doc.chapters);
      return true;
    }

    // ---- JJJJ: page drag-reparent (drag a page by its label into a column) ----
    var pageDragSuppressClick = false;
    function pointerCol(clientX) {
      var r = canvas.getBoundingClientRect();
      var worldX = (clientX - r.left - view.x) / view.zoom;
      return Math.floor(worldX / (E.FRAME_W + GAP_X));
    }
    function dropPageToCol(pi, col) {
      var sorted = (E.doc.chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var page = E.doc.pages[pi]; if (!page) return;
      var targetId;
      if (col >= sorted.length) targetId = createChapter();      // dropped on the "+ Chapter" slot -> new chapter
      else if (col >= 0) targetId = sorted[col].id;
      else return;
      if (page.chapterId === targetId) { mount(); setSelection("page", E.doc.pages.indexOf(page)); return; }
      pushHistory();
      var np = moveToChapter(pi, targetId);
      mount(); setActivePage(np); setSelection("page", np);
    }
    function wirePageDrag(label, pi) {
      label.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        var sx = e.clientX, sy = e.clientY, dragging = false, indicator = null, dropCol = 0;
        function onMove(ev) {
          if (!dragging) {
            if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
            dragging = true; document.body.classList.add("is-dragging-page");
            indicator = h("div", "page-drop-col"); E.world.appendChild(indicator);
          }
          var maxCol = (E.doc.chapters || []).length; // last index = the "+ Chapter" slot
          dropCol = Math.max(0, Math.min(pointerCol(ev.clientX), maxCol));
          indicator.style.left = colX(dropCol) + "px"; indicator.style.width = E.FRAME_W + "px";
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp);
          document.body.classList.remove("is-dragging-page");
          if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
          if (dragging) { pageDragSuppressClick = true; setTimeout(function () { pageDragSuppressClick = false; }, 0); dropPageToCol(pi, dropCol); }
        }
        document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
      });
    }

    // The world builder still paints the page labels, and its click handler has to know a drag
    // just ended -- otherwise the drop is followed by a select on the page you dragged. The flag
    // is this module's, so it answers rather than exporting the variable.
    function pageDragSuppressed() { return pageDragSuppressClick; }

    kernel.expose({
      createChapter: createChapter, moveToChapter: moveToChapter, chapterPos: chapterPos,
      reorderChapter: reorderChapter, deleteChapter: deleteChapter, pointerCol: pointerCol,
      dropPageToCol: dropPageToCol, wirePageDrag: wirePageDrag, pageDragSuppressed: pageDragSuppressed
    });
  }

  window.VersoPages = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoPages;
})();
