// editor/home.js -- the course browser (arch-P3b-07k).
//
// The screen an author sees before any document is open, and the answer to "where are my courses?"
// in a tool with no cloud: a grid of the registry, grouped by document GEOMETRY (reflow / fixed
// frame / paged) rather than by folder, because that is the axis an author actually sorts by --
// a slide deck and a workbook do not belong in the same row.
//
// EACH CARD RENDERS ITS REAL FIRST PAGE. Not a stored image: `renderCourseThumb` runs the real
// renderer at a desktop width and scales the node down, so a thumbnail can never drift from the
// course the way a cached PNG would. That is why the cards come in behind an IntersectionObserver
// -- rendering forty of them eagerly would cost more than opening the course.
//
// It also owns the destructive verbs an author reaches for from here (duplicate, rename, delete)
// and the store-location line, which is the one place the app admits out loud whether the work is
// in a real folder or in browser storage.
//
// Editor chrome only: it opens and manages documents, but nothing here renders or exports.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "saveRegistry", "iconBtn", "saveOpenDocIds", "stampDocUpdatedAt", "confirmModal",
      "showNewDocDialog", "editorAssetResolve", "activeTheme", "formatRelativeTime", "switchDoc",
      "promptModal", "clone", "activateDoc", "mount", "promoteToProductModal", "unlinkDocFromProduct",
      "exportVersoPackage", "showContextMenu", "courseMatchesQuery", "recentsCompare",
      "pickCourseFile", "importDocToRegistry", "newProductPrompt", "storageBackend", "renderTabs", "registry",
      "openDocIds", "activeDocId", "refreshFiles"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        saveRegistry = E.saveRegistry,
        iconBtn = E.iconBtn,
        saveOpenDocIds = E.saveOpenDocIds,
        stampDocUpdatedAt = E.stampDocUpdatedAt,
        confirmModal = E.confirmModal,
        showNewDocDialog = E.showNewDocDialog,
        editorAssetResolve = E.editorAssetResolve,
        activeTheme = E.activeTheme,
        formatRelativeTime = E.formatRelativeTime,
        switchDoc = E.switchDoc,
        promptModal = E.promptModal,
        clone = E.clone,
        activateDoc = E.activateDoc,
        mount = E.mount,
        promoteToProductModal = E.promoteToProductModal,
        unlinkDocFromProduct = E.unlinkDocFromProduct,
        exportVersoPackage = E.exportVersoPackage,
        showContextMenu = E.showContextMenu,
        courseMatchesQuery = E.courseMatchesQuery,
        recentsCompare = E.recentsCompare,
        pickCourseFile = E.pickCourseFile,
        importDocToRegistry = E.importDocToRegistry,
        newProductPrompt = E.newProductPrompt,
        storageBackend = E.storageBackend,
        renderTabs = E.renderTabs,
        registry = E.registry,
        openDocIds = E.openDocIds;

    // uio-W09: THE OVERLAY IS GONE. #73's full-screen modal browser -- the card grid, its live
    // page-1 thumbnails, its search, its per-card menu and its footer -- is deleted, not kept in
    // parallel with Files. Two surfaces answering "where are my documents?" is the divergence this
    // whole epic exists to end, and the overlay only ever listed HALF the answer: design documents
    // from the registry, never the source documents in LibraryStore.
    //
    // Everything it did has a home. The grid is the Files destination; the search is Files' own
    // field and ⌘K; the per-card menu is Files' row menu, which reuses the very functions below so
    // the two could never drift; the empty state is Files' first run; the footer's store path is
    // read by Files.
    //
    // What stays here is the file MANAGEMENT the overlay happened to host: duplicate, rename,
    // delete, open, and the one place the app admits out loud where the work is stored.

    function openCourseFromBrowser(id) {
      if (!registry[id]) return;
      if (openDocIds.indexOf(id) === -1) { openDocIds.push(id); saveOpenDocIds(openDocIds); renderTabs(); }
      if (id !== E.activeDocId) switchDoc(id);
    }

    // Card actions — all reuse the existing single-source logic (registry + saveRegistry choke
    // point). Files' row menu calls exactly these, which is why retiring the overlay took no
    // behaviour with it.
    function uniqueCopyCode(baseCode) {
      var base = (baseCode || "COURSE") + "-copy", code = base, n = 1;
      while (registry[code]) { n++; code = base + "-" + n; }
      return code;
    }
    function duplicateCourse(id) {
      var srcDoc = registry[id]; if (!srcDoc) return;
      var copy = JSON.parse(JSON.stringify(srcDoc)); // keep asset:<id> refs (media stays in the shared store)
      if (!copy.meta) copy.meta = {};
      copy.meta.code = uniqueCopyCode(srcDoc.meta && srcDoc.meta.code);
      copy.meta.title = ((srcDoc.meta && srcDoc.meta.title) || "Untitled") + " (Copy)";
      delete copy.meta.lastOpenedAt;
      stampDocUpdatedAt(copy, Date.now());
      registry[copy.meta.code] = copy;
      saveRegistry(registry);
      renderBrowserGrid();
    }
    function renameCourse(id) {
      var d = registry[id]; if (!d) return;
      promptModal("Rename document", "Document title", (d.meta && d.meta.title) || "", function (val) {
        val = (val || "").trim(); if (!val) return;
        if (!d.meta) d.meta = {};
        d.meta.title = val;
        stampDocUpdatedAt(d, Date.now());
        saveRegistry(registry);
        if (id === E.activeDocId) renderTabs();
        renderBrowserGrid();
      });
    }
    function deleteCourse(id) {
      var d = registry[id]; if (!d) return;
      confirmModal("Delete course?",
        "Permanently remove “" + ((d.meta && d.meta.title) || id) + "” (" + id + ") from this machine. This can't be undone. Any exported SCORM or backup folder on disk is not affected.",
        function () {
          delete registry[id];
          var oi = openDocIds.indexOf(id);
          if (oi !== -1) openDocIds.splice(oi, 1);
          if (id === E.activeDocId) {
            var next = openDocIds[0] || Object.keys(registry)[0];
            if (!next) { var fresh = clone(window.SAMPLE_DOC); registry[fresh.meta.code] = fresh; next = fresh.meta.code; }
            if (openDocIds.indexOf(next) === -1) openDocIds.push(next);
            activateDoc(next);
            mount();
          }
          saveOpenDocIds(openDocIds);
          saveRegistry(registry);
          renderTabs();
          if (typeof E.refreshFiles === "function") E.refreshFiles();
        }, { danger: true, okLabel: "Delete" });
    }



    // uio-W09: the top-bar file-picker button lands FILES. It used to open the overlay, and an
    // Escape handler existed purely to close it -- both gone with the surface they served. Files is
    // a destination, so it is reached the way every destination is.
    (function wireHome() {
      var b = document.getElementById("home-btn");
      if (b) b.addEventListener("click", function () {
        if (window.__leftRail) window.__leftRail.setStage("files");
      });
    })();

    // ---- File store location -------------------------------------------------
    // The one place the app admits out loud whether the work is in a real folder or in browser
    // storage. The retired overlay's footer read it; Files reads it now.
    function storeLocationText() {
      return storageBackend() === "file"
        ? "~/Library/Application Support/Verso/store"
        : "This browser (localStorage + IndexedDB)";
    }

    kernel.expose({
      duplicateCourse: duplicateCourse, renameCourse: renameCourse, deleteCourse: deleteCourse,
      openCourseFromBrowser: openCourseFromBrowser, storeLocationText: storeLocationText
    });
  }

  window.VersoHome = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoHome;
})();
