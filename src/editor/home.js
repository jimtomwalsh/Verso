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
      "showNewDocDialog", "getActiveProduct", "editorAssetResolve", "activeTheme", "formatRelativeTime", "switchDoc",
      "promptModal", "clone", "activateDoc", "mount", "promoteToProductModal", "unlinkDocFromProduct",
      "mountProductPicker", "exportVersoPackage", "showContextMenu", "courseMatchesQuery", "docMatchesProductStage", "recentsCompare",
      "pickCourseFile", "importDocToRegistry", "newProductPrompt", "storageBackend", "renderTabs", "registry",
      "openDocIds", "activeDocId"
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
        getActiveProduct = E.getActiveProduct,
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
        mountProductPicker = E.mountProductPicker,
        exportVersoPackage = E.exportVersoPackage,
        showContextMenu = E.showContextMenu,
        courseMatchesQuery = E.courseMatchesQuery,
        docMatchesProductStage = E.docMatchesProductStage,
        recentsCompare = E.recentsCompare,
        pickCourseFile = E.pickCourseFile,
        importDocToRegistry = E.importDocToRegistry,
        newProductPrompt = E.newProductPrompt,
        storageBackend = E.storageBackend,
        renderTabs = E.renderTabs,
        registry = E.registry,
        openDocIds = E.openDocIds;

    // ---- #73 Home / file browser ("local-first, no cloud") -------------------
    // A full-screen overlay OVER the editor (editor-first: the app still boots into
    // the editor; a top-bar Home button opens this). A grid of course cards — each a
    // live scaled-DOM page-1 thumbnail + title + code + last-edited — sorted by
    // recents (recentsCompare) and filtered by a title/code search box. Clicking a
    // card opens the course via the same switchDoc path the tabs use, so the browser
    // and tabs stay in sync. Editor chrome only: nothing here renders/exports.
    var browserUI = null, browserQuery = "", thumbObserver = null;
    var THUMB_DESIGN_W = 1024; // render page 1 at a desktop width, then scale the node to the card

    function renderCourseThumb(d) {
      var frame = h("div", "vbrowser-thumb");
      frame.__renderThumb = function () {
        if (frame.__rendered) return; frame.__rendered = true;
        if (!d || !d.pages || !d.pages.length) { frame.classList.add("is-empty"); frame.innerHTML = Icon("file"); return; }
        var node = null;
        try {
          var restore = (window.resolveMedia && window.AssetStore) ? window.resolveMedia(d, editorAssetResolve) : null;
          try { node = window.render(d, activeTheme()); } finally { if (restore) restore(); }
        } catch (e) { node = null; }
        if (!node) { frame.classList.add("is-empty"); frame.innerHTML = Icon("file"); return; }
        var holder = h("div", "vbrowser-thumb__holder");
        holder.style.width = THUMB_DESIGN_W + "px";
        holder.appendChild(node);
        frame.appendChild(holder);
        requestAnimationFrame(function () {
          var fw = frame.clientWidth || 220;
          holder.style.transform = "scale(" + (fw / THUMB_DESIGN_W) + ")";
        });
      };
      return frame;
    }

    function buildBrowserCard(id, d) {
      var card = h("div", "vbrowser-card" + (id === E.activeDocId ? " is-active" : ""));
      var thumb = renderCourseThumb(d);
      var body = h("div", "vbrowser-card__body");
      var main = h("div", "vbrowser-card__main");
      var titleEl = h("div", "vbrowser-card__title", (d.meta && d.meta.title) || id);
      titleEl.title = titleEl.textContent;
      var meta = h("div", "vbrowser-card__meta");
      meta.appendChild(h("span", "vbrowser-card__code", (d.meta && d.meta.code) || id));
      meta.appendChild(h("span", "vbrowser-card__sep", "·"));
      meta.appendChild(h("span", "vbrowser-card__when", formatRelativeTime(d.meta && d.meta.updatedAt, Date.now())));
      main.appendChild(titleEl); main.appendChild(meta);
      // SPEC 7: a badge row — Product (if tagged), interactive/static, and an open-state mark.
      var cell = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(d) : { interactive: true };
      var pid = d.meta && d.meta.productId;
      var pname = (pid && window.ProductsStore && window.ProductsStore[pid]) ? window.ProductsStore[pid].name : null;
      var badges = h("div", "vbrowser-card__badges");
      if (pname) badges.appendChild(h("span", "vbrowser-card__badge", pname));
      badges.appendChild(h("span", "vbrowser-card__badge", cell.interactive ? "Interactive" : "Static"));
      if (id === E.activeDocId || openDocIds.indexOf(id) !== -1) badges.appendChild(h("span", "vbrowser-card__badge vbrowser-card__badge--open", "Open"));
      main.appendChild(badges);
      var menuBtn = iconBtn("more-horizontal", "Course actions"); menuBtn.classList.add("vbrowser-card__menu");
      menuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var r = menuBtn.getBoundingClientRect();
        showCourseMenu(r.left, r.bottom + 4, id);
      });
      body.appendChild(main); body.appendChild(menuBtn);
      card.appendChild(thumb); card.appendChild(body);
      card.__thumb = thumb; card.__docId = id;
      card.addEventListener("click", function () { openCourseFromBrowser(id); });
      return card;
    }

    function openCourseFromBrowser(id) {
      if (!registry[id]) return;
      if (openDocIds.indexOf(id) === -1) { openDocIds.push(id); saveOpenDocIds(openDocIds); renderTabs(); }
      closeBrowser();
      if (id !== E.activeDocId) switchDoc(id);
    }

    // #74 card actions — all reuse the existing single-source logic (registry +
    // saveRegistry choke point), just wrapped behind the browser's cards/menu.
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
      promptModal("Rename course", "Course title", (d.meta && d.meta.title) || "", function (val) {
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
          renderBrowserGrid();
        }, { danger: true, okLabel: "Delete" });
    }
    function showCourseMenu(x, y, id) {
      var d = registry[id]; if (!d) return;
      // side-rail-cleanup slice 2: Promote / Remove-from-Product folded in from the retired save-menu, so
      // the file picker is the one home for file actions. Remove only shows when the course is tagged.
      var linkedPid = d.meta && d.meta.productId;
      var linked = !!(linkedPid && window.ProductsStore && window.ProductsStore[linkedPid]);
      var items = [
        { label: "Open", onClick: function () { openCourseFromBrowser(id); } },
        { label: "Duplicate", onClick: function () { duplicateCourse(id); } },
        { label: "Rename…", onClick: function () { renameCourse(id); } },
        { sep: true },
        { label: "Promote to Product…", onClick: function () { promoteToProductModal(d); } }
      ];
      if (linked) {
        items.push({ label: "Remove from Product", onClick: function () {
          var pname = (window.ProductsStore[linkedPid].name) || "this Product";
          confirmModal("Remove from Product?", "Unlinks “" + ((d.meta && d.meta.title) || id) + "” from “" + pname + "”. The course and its content stay -- only the Product tag is removed.", function () { unlinkDocFromProduct(d); mountProductPicker(); renderBrowserGrid(); }, { okLabel: "Remove", danger: true });
        } });
      }
      items.push({ sep: true });
      items.push({ label: "Export .verso", onClick: function () { exportVersoPackage(registry[id]); } });
      items.push({ sep: true });
      items.push({ label: "Delete", danger: true, onClick: function () { deleteCourse(id); } });
      showContextMenu(x, y, items);
    }

    function buildBrowserEmpty() {
      var wrap = h("div", "vbrowser-empty");
      var querying = !!browserQuery;
      wrap.appendChild(h("div", "vbrowser-empty__title", querying ? "No matching courses" : "No courses yet"));
      wrap.appendChild(h("div", "vbrowser-empty__hint",
        querying ? "No course title or code matches your search." : "Create a new course or import a .verso to get started."));
      if (!querying) {
        var b = h("button", "vbrowser__btn vbrowser__btn--primary", "New course");
        b.addEventListener("click", function () { closeBrowser(); showNewDocDialog(); });
        wrap.appendChild(b);
      }
      return wrap;
    }

    function observeThumbs(cards) {
      if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
      if (typeof IntersectionObserver === "undefined" || !browserUI) {
        cards.forEach(function (c) { if (c.__thumb) c.__thumb.__renderThumb(); });
        return;
      }
      thumbObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && en.target.__thumb) { en.target.__thumb.__renderThumb(); thumbObserver.unobserve(en.target); }
        });
      }, { root: browserUI.grid, rootMargin: "300px" });
      cards.forEach(function (c) { thumbObserver.observe(c); });
    }

    // SPEC 7 file-picker: the doc browser groups documents BY DOC TYPE (geometry cell), each group
    // colour-coded. Grouping is pure (takes a geoOf resolver) so tests/run.js exercises it headlessly.
    var BROWSER_GEO = {
      reflow: { label: "Reflow", colour: "#0d99ff" },
      frame:  { label: "Fixed frame", colour: "#9747ff" },
      paged:  { label: "Paged", colour: "#14ae5c" }
    };
    /* @pure-browser-geo-start */
    var BROWSER_GEO_ORDER = ["reflow", "frame", "paged"];
    function groupDocIdsByGeo(ids, reg, geoOf) {
      var by = { reflow: [], frame: [], paged: [] };
      (ids || []).forEach(function (id) {
        var d = reg && reg[id]; if (!d) return;
        var geo = geoOf ? geoOf(d) : "reflow";
        if (!by[geo]) geo = "reflow"; // unknown geo groups under reflow
        by[geo].push(id);
      });
      return BROWSER_GEO_ORDER.filter(function (g) { return by[g].length; })
        .map(function (g) { return { geo: g, ids: by[g] }; });
    }
    /* @pure-browser-geo-end */
    function renderBrowserGrid() {
      if (!browserUI) return;
      var grid = browserUI.grid; grid.innerHTML = "";
      // Respect the global product scope (like the tabs) + the search query.
      var scope = (typeof getActiveProduct === "function") ? getActiveProduct() : "";
      var ids = Object.keys(registry).filter(function (id) {
        return courseMatchesQuery(registry[id], browserQuery) && docMatchesProductStage(registry[id], scope, null);
      });
      ids.sort(function (x, y) { return recentsCompare(registry[x], registry[y]); });
      if (!ids.length) { grid.appendChild(buildBrowserEmpty()); return; }
      var groups = groupDocIdsByGeo(ids, registry, function (d) {
        return (window.__docType && window.__docType.docCell) ? window.__docType.docCell(d).geo : "reflow";
      });
      var allCards = [];
      groups.forEach(function (grp) {
        var gm = BROWSER_GEO[grp.geo] || BROWSER_GEO.reflow;
        var head = h("div", "vbrowser__group");
        var dot = h("span", "vbrowser__group-dot"); dot.style.background = gm.colour; head.appendChild(dot);
        head.appendChild(h("span", "vbrowser__group-title", gm.label));
        head.appendChild(h("span", "vbrowser__group-count", String(grp.ids.length)));
        grid.appendChild(head);
        var inner = h("div", "vbrowser__grid-inner");
        grp.ids.forEach(function (id) { var c = buildBrowserCard(id, registry[id]); inner.appendChild(c); allCards.push(c); });
        grid.appendChild(inner);
      });
      observeThumbs(allCards);
    }

    function ensureBrowser() {
      if (browserUI) return browserUI;
      var overlay = h("div", "vbrowser"); overlay.id = "vbrowser"; overlay.hidden = true;
      var bar = h("div", "vbrowser__bar");
      bar.appendChild(h("div", "vbrowser__title", "Courses"));
      var search = h("label", "vbrowser__search");
      search.innerHTML = Icon("search");
      var input = h("input", "vbrowser__search-input"); input.type = "text"; input.placeholder = "search courses";
      input.addEventListener("input", function () { browserQuery = input.value; renderBrowserGrid(); });
      search.appendChild(input);
      bar.appendChild(search);
      var spacer = h("div", "vbrowser__spacer"); bar.appendChild(spacer);
      var importBtn = h("button", "vbrowser__btn", "Import");
      importBtn.addEventListener("click", function () {
        pickCourseFile(function (imported) { importDocToRegistry(imported); closeBrowser(); });
      });
      bar.appendChild(importBtn);
      // new-product-empty-landing: create a Product straight from the browser header. newProductPrompt
      // sets it as the active scope and re-opens this browser onto its (empty) grid.
      var newProdBtn = h("button", "vbrowser__btn", "New Product");
      newProdBtn.addEventListener("click", function () { newProductPrompt(); });
      bar.appendChild(newProdBtn);
      var newBtn = h("button", "vbrowser__btn vbrowser__btn--primary", "New course");
      newBtn.addEventListener("click", function () { closeBrowser(); showNewDocDialog(); });
      bar.appendChild(newBtn);
      var closeBtn = iconBtn("x", "Close (Esc)"); closeBtn.classList.add("vbrowser__close");
      closeBtn.addEventListener("click", closeBrowser);
      bar.appendChild(closeBtn);
      var grid = h("div", "vbrowser__grid");
      // side-rail-cleanup slice 2: the "where are my files" store path, folded in from the retired
      // save-menu, so the picker carries every file affordance the popover used to.
      var foot = h("div", "vbrowser__foot");
      foot.appendChild(h("span", "vbrowser__foot-label", "Files stored in"));
      foot.appendChild(h("span", "vbrowser__foot-path", storeLocationText()));
      overlay.appendChild(bar); overlay.appendChild(grid); overlay.appendChild(foot);
      document.body.appendChild(overlay);
      browserUI = { overlay: overlay, grid: grid, input: input, foot: foot };
      return browserUI;
    }

    function openBrowser() {
      ensureBrowser();
      browserQuery = ""; browserUI.input.value = "";
      browserUI.overlay.hidden = false;
      document.body.classList.add("vbrowser-open");
      renderBrowserGrid();
      setTimeout(function () { try { browserUI.input.focus(); } catch (_) {} }, 0);
    }
    function closeBrowser() {
      if (!browserUI) return;
      browserUI.overlay.hidden = true;
      document.body.classList.remove("vbrowser-open");
      if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
    }
    function browserIsOpen() { return !!(browserUI && !browserUI.overlay.hidden); }

    (function wireHome() {
      var b = document.getElementById("home-btn");
      if (b) b.addEventListener("click", openBrowser);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && browserIsOpen()) { e.preventDefault(); closeBrowser(); }
      });
    })();

    // ---- File store location -------------------------------------------------
    // side-rail-cleanup slice 2: the #75 rail save/recents popover is RETIRED. Its recents were a
    // subset of the file picker's grid; its actions (Save-as-copy = Duplicate, Open = Import,
    // Promote / Remove-from-Product, and this store path) now all live in the picker (ensureBrowser
    // + showCourseMenu), so the picker is the one home for file management. storeLocationText survives
    // -- the picker footer reads it for the "where are my files" line.
    function storeLocationText() {
      return storageBackend() === "file"
        ? "~/Library/Application Support/Verso/store"
        : "This browser (localStorage + IndexedDB)";
    }

    kernel.expose({
      openBrowser: openBrowser, closeBrowser: closeBrowser, browserIsOpen: browserIsOpen,
      duplicateCourse: duplicateCourse, renameCourse: renameCourse, deleteCourse: deleteCourse,
      openCourseFromBrowser: openCourseFromBrowser, storeLocationText: storeLocationText
    });
  }

  window.VersoHome = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoHome;
})();
