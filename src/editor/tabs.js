// editor/tabs.js -- the open documents, and which one you are looking at (arch-P3b-07tabs).
//
// Verso holds several courses open at once. The tab strip is the only place that knows which,
// which one is active, and what happens when you leave one for another -- and that last part is
// the reason this is a module rather than a strip of markup.
//
// SWITCHING IS NOT SELECTING. `switchDoc` replaces the document wholesale, and everything keyed to
// the old one has to be rebuilt rather than carried: the variant and version switchers, the
// backup folder binding, the cell chip, the canvas. A surface that captured the OLD document and
// kept editing it is the single most expensive bug class in this codebase's history, which is why
// the switch is one function and every consumer goes through it.
//
// THE STRIP SHOWS WHAT IS OPEN. It used to be filtered by a global Product scope, which meant
// choosing a Product could filter the active tab out from under you -- so a repair function existed
// purely to put a visible document back. uio-W01 retired both. `PR.visibleTabIds` survives as the
// one predicate for what a strip holds, and uio-W10 is where it grows a document-TYPE split so
// Source and Edit can own separate strips.
//
// It came out from under a banner titled "Product Rail: tag vocabulary", which described the 46
// lines above it and nothing here.
//
// Editor chrome only: it opens and closes documents and never renders one.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "openDocIds", "h", "showNewDocDialog", "activateDoc", "mount",
      "connectBackupFolder", "PR", "colourForName", "saveOpenDocIds", "stampDocOpenedAt", "renderVariantSwitch",
      "renderVersionSwitch", "syncCellChip", "registry", "setActiveVariant", "setActiveVersion", "activeDocId",
      "doc", "activeVariant", "activeVersion"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var openDocIds = E.openDocIds,
        h = E.h,
        showNewDocDialog = E.showNewDocDialog,
        activateDoc = E.activateDoc,
        mount = E.mount,
        connectBackupFolder = E.connectBackupFolder,
        PR = E.PR,
        colourForName = E.colourForName,
        saveOpenDocIds = E.saveOpenDocIds,
        stampDocOpenedAt = E.stampDocOpenedAt,
        renderVariantSwitch = E.renderVariantSwitch,
        renderVersionSwitch = E.renderVersionSwitch,
        syncCellChip = E.syncCellChip,
        registry = E.registry,
        setActiveVariant = E.setActiveVariant,
        setActiveVersion = E.setActiveVersion;

    // Issue #12 (parent #22): document tabs are the DS DocumentTab; the add button
    // is the DS IconButton (Lucide plus). Re-skin only — the switch/close/new-doc
    // handlers are unchanged. A legacy chip fallback keeps the bar working if the
    // control library is ever absent.
    // uio-W01: the strip shows what is open. It used to be filtered by the global Product picker,
    // which meant choosing a Product silently emptied the tab bar -- work hidden rather than
    // organised, and the reason a whole repair function (`reconcileActiveTabToScope`) had to exist
    // to put the active document back. Both are gone. The only id that draws nothing is one with no
    // document behind it. PURE (no DOM) so tests/run.js exercises the predicate headlessly.
    function visibleTabIds(openIds, reg) { return PR.visibleTabIds(openIds, reg); }

    // tab-doctype-glyph: map a document's geometry cell -> {glyph, label} for the tab's leading
    // doc-type marker. Keyed on geo (the doc-type spine the file-picker already groups by), so the
    // tab glyph and the browser grouping read as one vocabulary.
    var TAB_DOCTYPE_GLYPH = {
      reflow: { icon: "layers", label: "Course" },
      frame: { icon: "monitor", label: "Presentation" },
      paged: { icon: "file-text", label: "Paged / print document" }
    };
    function renderTabs() {
      var container = document.getElementById("toolbar-tabs");
      if (!container) return;
      container.innerHTML = "";
      var U = window.VersoUI;
      var shown = visibleTabIds(openDocIds, registry);
      shown.forEach(function (id) {
        var d = registry[id];
        if (!d) return;
        var title = d.meta.title || id;
        // Per-Product colour dot, keyed on the stable productId (not the mutable name) so the
        // colour never shifts when a product is renamed. Untagged docs get no dot.
        var pid = d.meta && d.meta.productId;
        var dotColour = pid ? colourForName(pid) : null;
        // Per-Product dot tooltip so its meaning is legible (it's a stable Product marker, NOT a
        // changed-since-export cue).
        var prod = pid && window.ProductsStore ? window.ProductsStore[pid] : null;
        var dotTitle = pid ? ("Product: " + ((prod && prod.name) || pid)) : null;
        var cell = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(d) : { geo: "reflow" };
        var dt = TAB_DOCTYPE_GLYPH[cell.geo] || TAB_DOCTYPE_GLYPH.reflow;
        if (U && U.DocumentTab) {
          container.appendChild(U.DocumentTab({
            label: title,
            active: id === E.activeDocId,
            dot: dotColour,
            dotTitle: dotTitle,
            icon: dt.icon,
            typeLabel: dt.label,
            onSelect: function () { switchDoc(id); },
            onClose: function () { closeTab(id); }
          }));
          return;
        }
        var tab = h("div", "toolbar-tab" + (id === E.activeDocId ? " is-active" : ""));
        tab.appendChild(h("span", null, title));
        var close = h("span", "toolbar-tab__close", "✕");
        close.addEventListener("click", function (e) {
          e.stopPropagation();
          closeTab(id);
        });
        tab.appendChild(close);
        tab.addEventListener("click", function () {
          switchDoc(id);
        });
        container.appendChild(tab);
      });
      if (U && U.IconButton) {
        var addBtn = U.IconButton({ icon: "plus", label: "Create or import a course…", size: "md", onClick: showNewDocDialog });
        addBtn.classList.add("toolbar-tabs__add");
        container.appendChild(addBtn);
        return;
      }
      var add = h("span", "toolbar-tabs__add", "+");
      add.title = "Create or import a course...";
      add.addEventListener("click", showNewDocDialog);
      container.appendChild(add);
    }

    function closeTab(id) {
      var idx = openDocIds.indexOf(id);
      if (idx === -1) return;
      if (openDocIds.length <= 1) {
        alert("At least one course tab must remain open.");
        return;
      }
      openDocIds.splice(idx, 1);
      saveOpenDocIds(openDocIds);
      if (E.activeDocId === id) {
        // Closing the ACTIVE tab is a document swap like any other. It used to move `doc` and the
        // id by hand and leave the closed course's undo stack standing, so one Ctrl+Z afterwards
        // restored the closed course's snapshot into the newly-active one -- overwriting it in
        // memory and in the registry, then saving it. It goes through the one owner now.
        activateDoc(openDocIds[Math.max(0, idx - 1)]);
        mount();
      }
      renderTabs();
    }

    function switchDoc(id) {
      if (E.activeDocId === id) return;
      activateDoc(id); // id + doc + registry entry together; history and the page cursor reset
      stampDocOpenedAt(E.doc, Date.now()); // #71 recents: record the open (in-memory; persists on this doc's next save -> no save-indicator churn per tab click)
      // The active variant/version belong to the outgoing doc; drop them if the new doc lacks them.
      if (E.activeVariant && (E.doc.variants || []).indexOf(E.activeVariant) === -1) E.setActiveVariant(null);
      if (E.activeVersion && (E.doc.versions || []).indexOf(E.activeVersion) === -1) E.setActiveVersion(null);
      if (typeof connectBackupFolder === "function") connectBackupFolder(); // re-point auto-backup at this doc's folder
      mount();
      renderTabs();
      renderVariantSwitch(); // rebuild the top-bar variant pill for the NEW doc (else it shows the old doc's variants / goes blank)
      renderVersionSwitch(); // #206: same for the software-version switcher
      syncCellChip(); // SPEC 7: reflect the new doc's matrix cell in the header chip
    }

    // `reconcileActiveTabToScope` lived here and is gone with uio-W01. Its whole job was undoing
    // the product filter's damage: when the scope changed and the active document fell out of it,
    // something had to put a visible document back in front of the author. Nothing can filter the
    // active document out from under you any more, so there is nothing to reconcile.

    kernel.expose({
      visibleTabIds: visibleTabIds, renderTabs: renderTabs, closeTab: closeTab,
      switchDoc: switchDoc
    });
  }

  window.VersoTabs = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoTabs;
})();
