// editor/inspector/scopes.js -- the panels for a selection that is not one block (arch-P3b-08).
//
// Three of the ten panels the dispatcher can pick are not about a block. They are about the SCOPE
// you are working at: the whole document, one page, or several things at once. blocks.js has the
// block-type table, parts.js has the two things a block contains; these are the three above it.
//
// THE DOCUMENT PANEL IS DELIBERATELY LEAN. It used to be the stacked wall of every document
// setting; that wall moved into the settings sheet in 2026-07, and what is left is the canvas
// backdrop, the capability row and a link to where the rest went. A sidebar that shows everything
// when nothing is selected teaches an author to ignore the sidebar.
//
// THE PAGE PANEL is the widest of the three, because a page is where several models intersect: the
// chapter it belongs to (changing it MOVES the page between canvas columns), the per-page
// header/footer opt-outs, the interaction gate, side padding, and the page actions -- duplicate,
// split, merge, save as a library master, delete. Most of those verbs live in structure-ops.js and
// are called from here; the panel is the surface, not the model.
//
// THE MULTI PANEL is the payoff of cross-scope multi-select: one text style, colour or alignment
// applied to every selected text block at once. Non-text blocks in the selection are ignored
// rather than refused, so a sloppy marquee still does the useful thing.
//
// All three swap `inspector` for a section body and restore it in a `finally`. That is the panel
// idiom in this codebase, and it is why these files write through `setInspector` rather than
// assigning: the host owns the render target, and an assignment to a live binding is a TypeError
// under strict mode.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "mount", "setSelection", "sectionGroup", "panelSection", "pushHistory",
      "beginSections", "endSections", "setActivePage", "getTextStyles", "colourControl", "iconField",
      "twoUp", "saveRegistry", "customSelectRow", "applyStyleToBlock", "dsSelect", "segmentedIconLive",
      "selectRow", "moveToChapter", "promptModal", "createChapter", "resolveScoped", "gateScopeChain",
      "switchRow", "onOffLabel", "resolveComponentDef", "reconcilePageOverrides", "collectPageOverridableTextFields", "fieldRow",
      "clone", "deletePage", "applyCanvasBg", "openSettingsModal", "setInspector", "TEXT_STYLE_TYPES",
      "classificationRow", "classificationSpec", "classificationLevels", "productOf",
      "CELL_GEO_LABEL", "BG_DEFAULT", "detachPageLibraryInstance", "savePageAsLibraryMaster", "setCurrentPage", "inspector",
      "doc", "currentPage", "multiSel", "registry", "canvasBg"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        mount = E.mount,
        setSelection = E.setSelection,
        sectionGroup = E.sectionGroup,
        panelSection = E.panelSection,
        pushHistory = E.pushHistory,
        beginSections = E.beginSections,
        endSections = E.endSections,
        setActivePage = E.setActivePage,
        getTextStyles = E.getTextStyles,
        colourControl = E.colourControl,
        iconField = E.iconField,
        twoUp = E.twoUp,
        saveRegistry = E.saveRegistry,
        customSelectRow = E.customSelectRow,
        applyStyleToBlock = E.applyStyleToBlock,
        dsSelect = E.dsSelect,
        segmentedIconLive = E.segmentedIconLive,
        selectRow = E.selectRow,
        moveToChapter = E.moveToChapter,
        promptModal = E.promptModal,
        createChapter = E.createChapter,
        resolveScoped = E.resolveScoped,
        gateScopeChain = E.gateScopeChain,
        switchRow = E.switchRow,
        onOffLabel = E.onOffLabel,
        resolveComponentDef = E.resolveComponentDef,
        reconcilePageOverrides = E.reconcilePageOverrides,
        collectPageOverridableTextFields = E.collectPageOverridableTextFields,
        fieldRow = E.fieldRow,
        clone = E.clone,
        deletePage = E.deletePage,
        applyCanvasBg = E.applyCanvasBg,
        openSettingsModal = E.openSettingsModal,
        setInspector = E.setInspector,
        TEXT_STYLE_TYPES = E.TEXT_STYLE_TYPES,
        CELL_GEO_LABEL = E.CELL_GEO_LABEL,
        BG_DEFAULT = E.BG_DEFAULT,
        detachPageLibraryInstance = E.detachPageLibraryInstance,
        savePageAsLibraryMaster = E.savePageAsLibraryMaster,
        setCurrentPage = E.setCurrentPage;

    // Multi-selection (>=2) batch inspector: apply a text style / colour / alignment to EVERY
    // selected text block at once (the payoff of cross-scope multi-select). Non-text blocks in
    // the selection are ignored. (§105)
    function renderMultiInspector() {
      var textBlocks = E.multiSel.filter(function (b) { return TEXT_STYLE_TYPES[b.type]; });
      var head = h("div", "prop-component");
      head.appendChild(h("span", null, E.multiSel.length + " items selected"));
      E.inspector.appendChild(head);
      if (!textBlocks.length) {
        E.inspector.appendChild(h("div", "insp-hint", "No text blocks in the selection. Delete or group it from the right-click menu."));
        return;
      }
      function batch(mut) { pushHistory(); textBlocks.forEach(function (b) { mut(b); }); window.applyRenderContext({ docStyles: getTextStyles() }); mount(); }
      // #161: the batch text controls (style / colour / alignment) live in one canonical Type
      // section, matching the single-selection field inspector's Type grammar.
      beginSections();
      sectionGroup("Type", "Text — applies to all " + textBlocks.length + " text block" + (textBlocks.length > 1 ? "s" : ""), function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try {
        // 1. Saved text style — the explicit ask
        var presets = getTextStyles(), presetNames = Object.keys(presets);
        if (presetNames.length) {
          var common = textBlocks[0].styleRef || "";
          var allSame = textBlocks.every(function (b) { return (b.styleRef || "") === common; });
          var bStyleCss = function (p) { var css = ""; if (p && p.font && window.fontStackFor) css += "font-family:" + window.fontStackFor(p.font) + ";"; if (p && p.weight) css += "font-weight:" + p.weight + ";"; if (p && p.textTransform) css += "text-transform:" + p.textTransform + ";"; return css; };
          var bStyleOpts = [["", "Apply a style…"]].concat(presetNames.map(function (n) { return [n, n, { style: bStyleCss(presets[n]) }]; }));
          customSelectRow("Text style", bStyleOpts, allSame ? common : "", function (v) {
            if (!v || !presets[v]) return;
            batch(function (b) { applyStyleToBlock(b, v); });
          });
        }
        // 2. Colour — theme token (flips light/dark) or a fixed custom hex, applied to all
        var COLOUR_TOKENS = [["Ink", "ink"], ["Ink soft", "ink-soft"], ["Muted", "muted"], ["Accent", "accent"], ["Success", "success"], ["Danger", "danger"]];
        var cCol = h("div", null); cCol.appendChild(h("label", null, "Colour"));
        var colCustom = h("div", null);
        var selCol = dsSelect([["— keep —", ""]].concat(COLOUR_TOKENS).concat([["Custom…", "custom"]]), "", function (v) {
          colCustom.innerHTML = "";
          if (v === "") return;
          if (v === "custom") { colourControl("Custom colour", "#ffffff", function (val) { batch(function (b) { b.style = b.style || {}; delete b.style.colorToken; if (val == null) delete b.style.color; else b.style.color = val; }); }, colCustom, true); return; }
          batch(function (b) { b.style = b.style || {}; b.style.colorToken = v; delete b.style.color; });
        });
        selCol.style.width = "100%";
        cCol.appendChild(selCol);
        cCol.appendChild(colCustom);
        E.inspector.appendChild(cCol);
        // 3. Alignment
        var cAlign = h("div", null);
        segmentedIconLive("Align", [[Icon("align-left"), "left", "Left"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "right", "Right"]],
          function () { return false; },
          function (v) { batch(function (b) { b.style = b.style || {}; b.style.align = v; }); }, cAlign, true);
        E.inspector.appendChild(cAlign);
        } finally { E.setInspector(_ins); }
      });
      endSections(E.inspector);
    }

    // a page selected -> per-page headerFooter opt-outs
    function renderPageInspector(pi) {
      var page = E.doc.pages[pi];
      if (!page) return; // stale index (e.g. mid doc-switch): inspector already cleared by caller — no crash, no re-dispatch
      var head = h("div", "prop-component");
      head.appendChild(h("span", null, "Page")); head.appendChild(h("span", "insp-tag", page.id));
      E.inspector.appendChild(head);

      // #162: canonical section grammar. Organizational sections (Chapter, Header & Footer
      // on this page) are panelSection collapsibles appended directly; the taxonomy-mappable
      // sections (Interaction gate -> Behaviour, Side padding -> Layout) are sectionGroups
      // buffered + emitted in canonical PanelLayout order; Page actions is pinned last.
      // JJJJ: which chapter (canvas column) this page belongs to. Changing it moves
      // the page into that chapter's column (re-sorts pages column-major).
      var chs = E.doc.chapters || [];
      if (chs.length) {
        var chBody = panelSection(E.inspector, "Chapter");
        var chOpts = chs.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).map(function (c) { return [c.name || "Untitled", c.id]; });
        chOpts.push(["+ New chapter…", "__new"]);
        var _pi0 = E.inspector; E.setInspector(chBody);
        try {
        selectRow("Belongs to", chOpts, page.chapterId || (chs[0] && chs[0].id), function (v) {
          function commit(target) { pushHistory(); var np = moveToChapter(pi, target); mount(); setActivePage(np); setSelection("page", np); }
          if (v === "__new") {
            promptModal("New chapter", "Name", "Chapter " + (chs.length + 1), function (nm) {
              if (nm == null) { mount(); setSelection("page", pi); return; }
              commit(createChapter((nm || "").trim() || undefined));
            });
            return;
          }
          commit(v);
        });
        } finally { E.setInspector(_pi0); }
      }

      var hfBody = panelSection(E.inspector, "Header & Footer on this page");
      function toggle(flag, label) {
        hfBody.appendChild(h("div", "insp-row__label insp-row__label--stacked", label));
        var row = h("div", "prop-toggle-row");
        [["shown", false], ["hidden", true]].forEach(function (o) {
          var b = h("button", "prop-toggle" + (!!page[flag] === o[1] ? " is-on" : ""), o[0]);
          b.addEventListener("click", function () { page[flag] = o[1]; mount(); setSelection("page", pi); });
          row.appendChild(b);
        });
        hfBody.appendChild(row);
      }
      toggle("hideHeader", "Header");
      toggle("hideFooter", "Footer");
      hfBody.appendChild(h("div", "insp-hint", "Global header/footer are configured with nothing selected (Header & Footer)."));

      beginSections();
      // §5 per-page interaction gate: tri-state override of the course-level default. Holds
      // this page's Next (greyed + reminder) until its interactions complete.
      sectionGroup("Behaviour", "Interaction gate", function (secBody) {
        var _i = E.inspector; E.setInspector(secBody);
        try {
        // uio-F03: was a tri-state picker with an explicit "Inherit course default" option —
        // the exact "unset" the spine forbids. Now the switch always shows what will ACTUALLY
        // apply on this page, and the tail says where that came from (or offers Reset).
        var gateRes = resolveScoped(gateScopeChain(page), "gateInteractions", { at: "page" });
        switchRow("Require interactions before Next", function () { return !!gateRes.value; },
          function (v) { page.gateInteractions = !!v; mount(); setSelection("page", pi); }, E.inspector, false,
          { inherit: { res: gateRes, format: onOffLabel, onReset: function () {
              pushHistory(); delete page.gateInteractions; mount(); setSelection("page", pi);
            } } });
        E.inspector.appendChild(h("div", "insp-hint", "Hold this page's Next until its interactions are done (hotspots, cards, sequences, accordions, quizzes, videos, checkboxes). With nothing set here the page follows the course switch in Header & Footer → Progression."));
        } finally { E.setInspector(_i); }
      });

      // uio-F07: a page may tighten what its document classifies, never loosen it.
      sectionGroup("Classification", "Classification", function (secBody) {
        E.classificationRow(E.classificationSpec({ product: E.productOf(E.doc), doc: E.doc, page: page }), {
          at: "page", host: secBody, levels: E.classificationLevels(),
          write: function (id) { page.classificationId = id; mount(); setSelection("page", pi); },
          clear: function () { delete page.classificationId; mount(); setSelection("page", pi); }
        });
      });

      sectionGroup("Layout", "Side padding (%)", function (secBody) {
        var _i = E.inspector; E.setInspector(secBody);
        try {
        E.inspector.appendChild(h("div", "insp-hint", "Overrides the global side padding for this page, per screen size. Leave tablet/mobile blank to inherit the desktop value; leave all blank to inherit the course default."));
        // Per-breakpoint side padding, mirroring the global master-layout pane
        // (buildLayoutBody): desktop base + tablet/mobile overrides that fall back to
        // desktop. Writes page.padX / padXTablet / padXMobile (render fans them out to
        // the --page-pad-x[-tablet|-mobile] vars). Same iconField/twoUp control set.
        function pagePadX(key, glyph, title, phVal) {
          return iconField(glyph, {
            value: page[key] == null ? "" : page[key], unit: "%", title: title,
            placeholder: phVal, step: 0.5, min: 0, max: 45, datalist: "dl-pct",
            onchange: function (v) { var n = parseFloat(v); if (isNaN(n)) delete page[key]; else page[key] = n; mount(); setSelection("page", pi); }
          }).wrap;
        }
        var inheritPh = (page.padX != null ? String(page.padX) : "inherit");
        E.inspector.appendChild(twoUp(
          pagePadX("padX", Icon("monitor"), "Desktop side padding", "inherit"),
          pagePadX("padXTablet", Icon("tablet"), "Tablet side padding", inheritPh)));
        E.inspector.appendChild(twoUp(
          pagePadX("padXMobile", Icon("smartphone"), "Mobile side padding", inheritPh),
          iconField(Icon("pad-y"), { value: page.padY == null ? "" : page.padY, unit: "px", title: "Vertical padding (top/bottom)", placeholder: "inherit", step: 2, min: 0, max: 300, datalist: "dl-gap",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete page.padY; else page.padY = n; mount(); setSelection("page", pi); } }).wrap));
        } finally { E.setInspector(_i); }
      });
      endSections(E.inspector);

      // #22: page-master library section -- mirrors #20/#21's block-level instance
      // inspector (renderLibraryInstanceBody): live/linked hint + reconcile-on-open +
      // Overrides field list + Detach when this page IS an instance; a "Save page to
      // library" capture action when it isn't. panelSection (not sectionGroup) matches
      // the "Chapter"/"Header & Footer" organizational sections above, not the
      // taxonomy-mappable ones.
      var libSecBody = panelSection(E.inspector, "Library");
      if (page.libraryRef) {
        var pdef = resolveComponentDef(page.libraryRef);
        var pHead = h("div", "prop-component prop-component--instance");
        pHead.appendChild(h("span", null, (pdef && pdef.name) || page.libraryRef || "Library page"));
        libSecBody.appendChild(pHead);
        libSecBody.appendChild(h("div", "insp-hint", pdef
          ? "Live library page, linked to “" + (pdef.name || page.libraryRef) + "”. Edit the master in Settings → System → Component Library and every placement updates automatically."
          : "This page's library master (“" + page.libraryRef + "”) no longer exists. Detach to keep this page as independent content."));
        if (pdef && pdef.template) {
          var prec = reconcilePageOverrides(pdef.template.blocks, page.overrides || {});
          page.overrides = prec.living;
          if (prec.dropped.length) {
            saveRegistry(E.registry);
            libSecBody.appendChild(h("div", "insp-hint insp-hint--warn", prec.dropped.length + " override" + (prec.dropped.length === 1 ? "" : "s") +
              " dropped — the master no longer has " + (prec.dropped.length === 1 ? "that field" : "those fields") + "."));
          }
          var pfields = collectPageOverridableTextFields(pdef.template.blocks);
          if (pfields.length) {
            libSecBody.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Overrides"));
            var _pi1 = E.inspector; E.setInspector(libSecBody);
            try {
              pfields.forEach(function (f) {
                var current = (page.overrides[f.id] && page.overrides[f.id].text) || "";
                fieldRow(f.type.charAt(0).toUpperCase() + f.type.slice(1), current, function (v) {
                  if (v) page.overrides[f.id] = { text: v }; else delete page.overrides[f.id];
                  saveRegistry(E.registry); mount(); setSelection("page", pi);
                }, f.text || "inherits from master");
              });
            } finally { E.setInspector(_pi1); }
          }
        }
        var pDetachB = h("button", "prop-btn", "Detach"); pDetachB.style.marginTop = "6px";
        pDetachB.title = "Convert to an independent, editable page — this page stops receiving master updates.";
        pDetachB.disabled = !pdef;
        pDetachB.addEventListener("click", function () { detachPageLibraryInstance(pi); });
        libSecBody.appendChild(pDetachB);
      } else {
        libSecBody.appendChild(h("div", "insp-hint", "Save this page to the shared library to reuse it (live-linked) in other courses."));
        var pSaveB = h("button", "prop-btn prop-btn--accent", "Save page to library…"); pSaveB.style.marginTop = "6px";
        pSaveB.addEventListener("click", function () { savePageAsLibraryMaster(pi); });
        libSecBody.appendChild(pSaveB);
      }

      var actBody = panelSection(E.inspector, "Page actions");
      var dupBtn = h("button", "prop-btn", "Duplicate page");
      dupBtn.addEventListener("click", function () {
        pushHistory();
        var copy = clone(page); copy.id = "page-" + Date.now();
        E.doc.pages.splice(pi + 1, 0, copy);
        E.setCurrentPage(pi + 1);
        mount(); setActivePage(E.currentPage); setSelection("page", E.currentPage);
      });
      actBody.appendChild(dupBtn);
      var delBtn = h("button", "prop-btn prop-btn--danger", "Delete page");
      delBtn.style.marginTop = "6px";
      if (E.doc.pages.length <= 1) { delBtn.disabled = true; delBtn.title = "A course needs at least one page."; }
      delBtn.addEventListener("click", function () { deletePage(pi); });
      actBody.appendChild(delBtn);
    }

    // Nothing selected → a LEAN, contextual doc panel (James 2026-07-08). The stacked wall of
    // document settings moved into the ⚙ settings modal (System / Project tabs); the sidebar now
    // keeps only the always-handy Canvas background + a pointer to the modal. Selecting anything
    // on the canvas shows that thing's contextual inspector instead (page, block, nav, …).
    function renderDocumentInspector() {
      // #162: the canvas backdrop is an Appearance sectionGroup (canonical taxonomy), so the
      // document panel reads with the same grammar as the block inspectors.
      beginSections();
      // SPEC 7 capability inspector: with nothing selected the Document context leads with the
      // document's matrix cell + the geometry-specific tools (condToolsFor). No top strip -- these
      // live in the inspector like every other document control. Changing the cell (header chip)
      // re-mounts, so this section updates live.
      var _cell = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(E.doc) : { geo: "reflow", interactive: true };
      sectionGroup("Layout", "Document type", function (secBody) {
        var _i = E.inspector; E.setInspector(secBody);
        try {
          E.inspector.appendChild(h("div", "insp-hint",
            (CELL_GEO_LABEL[_cell.geo] || _cell.geo) + " · " + (_cell.interactive ? "Interactive" : "Static") +
            " — change it in Document settings (the sliders button in the editor header)."));
          var tools = (window.__docType && window.__docType.condToolsFor) ? window.__docType.condToolsFor(_cell.geo) : [];
          if (tools.length) {
            var toolsBody = panelSection(E.inspector, (CELL_GEO_LABEL[_cell.geo] || _cell.geo) + " tools");
            tools.forEach(function (t) {
              var row = h("div", "insp-row insp-doc-tool");
              row.appendChild(h("span", "insp-row__label", t));
              toolsBody.appendChild(row);
            });
          }
        } finally { E.setInspector(_i); }
      });
      // uio-F07: the document's own classification, inheriting from its Product (or the deployment
      // default when it is untagged). The same row every other rung renders.
      sectionGroup("Classification", "Classification", function (secBody) {
        E.classificationRow(E.classificationSpec({ product: E.productOf(E.doc), doc: E.doc }), {
          at: "course", host: secBody, levels: E.classificationLevels(),
          write: function (id) { E.doc.classificationId = id; mount(); setSelection(null); },
          clear: function () { delete E.doc.classificationId; mount(); setSelection(null); }
        });
      });
      sectionGroup("Appearance", "Canvas", function (secBody) {
        var _i = E.inspector; E.setInspector(secBody);
        try {
        // Canvas background lives in localStorage (not doc), so it is off the undo stack
        // (noHistory) and applies live via applyCanvasBg. Clearing reverts to the default backdrop.
        colourControl("Background", E.canvasBg, function (val) { applyCanvasBg(val == null ? BG_DEFAULT : val); }, E.inspector, true);
        // The button IS the route, so it states its destination rather than pointing at a
        // corner of the window (it used to say "top right", which no cog has ever been in).
        var openBtn = h("button", "insp-hint insp-backlink", "Open project & system settings");
        openBtn.type = "button";
        openBtn.title = "Header & Footer, Glossary, Theme, fonts and more live in the settings sheet.";
        openBtn.addEventListener("click", function () { openSettingsModal("project"); });
        E.inspector.appendChild(openBtn);
        } finally { E.setInspector(_i); }
      });
      endSections(E.inspector);
    }

    kernel.expose({
      renderMultiInspector: renderMultiInspector, renderPageInspector: renderPageInspector, renderDocumentInspector: renderDocumentInspector
    });
  }

  window.VersoInspectorScopes = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoInspectorScopes;
})();
