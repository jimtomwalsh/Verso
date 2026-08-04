// editor/shell.js -- the frame around the work: which stage, which Product, which cell
// (arch-P3b-07shell).
//
// Everything outside the canvas and the panels. The top bar with its pipeline buttons, the left
// rail, the three-stage switch, the Product picker and the matrix-cell chip. None of it edits a
// document; all of it says what you are currently editing it AS.
//
// THE STAGE IS THE BIG ONE. Source, Edit and Publish are not three tabs over one canvas -- each is
// a different workspace, and `setStage` is what swaps them: a class on the workspace, a different
// stage mounted, and a persisted key so a refresh returns you where you were rather than dumping
// you back in Edit. The stage also gates work: `__framedWhileVisible` exists because a stage that
// was never visible has never been laid out, and fitting a canvas nobody has seen produces
// nonsense.
//
// THE CELL IS THE OTHER MODEL HERE. A document is one square of a matrix -- reflow / fixed frame /
// paged, crossed with interactive or static -- and the chip in the top bar is the only place that
// square is shown and changed. Changing it re-renders, which is why `applyCellChange` is one
// function rather than two setters that could disagree.
//
// THE PRODUCT PICKER WAS THE THIRD SCOPE, AND IT IS GONE (uio-W01). Changing Product used to
// re-scope the tab strip, which could filter the active document out from under you -- so this file
// called a repair function to put it back. Product is a tag, a facet and an inspector now; nothing
// here scopes anything, and the repair function went with the scope that needed it.
//
// It came out from under a banner titled "Project auto-backup", whose actual backup writer left in
// 07d. What was left under that banner was this, and it is not data-safety at all.
//
// Editor chrome only, and the outermost layer of it: nothing here renders a course.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "renderSourceStage", "openBrowser", "canvas", "pipelineButtons",
      "showContextMenu", "openSettingsModal", "mount", "renderSettingsBody", "pipelineByDirection",
      "publishQueue", "publishOptionsForRow", "publishFormatSummary", "publishFormatRows", "applyLeftSection", "activeLeftSection",
      "mountPublishStage", "openDocIds", "view", "fitAll", "saveRegistry", "registry",
      "confirmModal", "promptModal", "createProduct", "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        renderSourceStage = E.renderSourceStage,
        openBrowser = E.openBrowser,
        canvas = E.canvas,
        pipelineButtons = E.pipelineButtons,
        showContextMenu = E.showContextMenu,
        openSettingsModal = E.openSettingsModal,
        mount = E.mount,
        renderSettingsBody = E.renderSettingsBody,
        pipelineByDirection = E.pipelineByDirection,
        publishQueue = E.publishQueue,
        publishOptionsForRow = E.publishOptionsForRow,
        publishFormatSummary = E.publishFormatSummary,
        publishFormatRows = E.publishFormatRows,
        applyLeftSection = E.applyLeftSection,
        activeLeftSection = E.activeLeftSection,
        mountPublishStage = E.mountPublishStage,
        openDocIds = E.openDocIds,
        view = E.view,
        fitAll = E.fitAll,
        saveRegistry = E.saveRegistry,
        registry = E.registry,
        confirmModal = E.confirmModal,
        promptModal = E.promptModal,
        createProduct = E.createProduct;

    function renderPipelineButtons(container) {
      container.innerHTML = "";
      pipelineButtons.forEach(function (btn) {
        container.appendChild(window.__pipelineButton(btn.label, btn.onClick, btn.accent));
      });
    }
    // Panel System v2 (D6) — Export is the PRIMARY top-bar action; the secondary IO (Import CSV,
    // Publish to Viewer, JSON backup) sits in a ⋯ overflow. The doc "Import & Export" panel keeps
    // the full set. Fed by the registered pipelineButtons (Export SCORM = accent).
    // Issue #12 (parent #22) — DS action-priority: Export is DEMOTED to a SECONDARY
    // button carrying an export-options chevron (Preview is the sole primary, built
    // in mountTopBar). The secondary IO (Import CSV, Publish to Viewer, JSON backup)
    // stays in the ⋯ overflow, now the DS IconButton. Re-skin only — Export fires
    // the same registered accent pipeline handler; the overflow menu is unchanged.
    // side-rail-cleanup slice 2: the Import/Export pipeline was RELOCATED off the rail onto the Publish
    // stage, into #publish-io (built in the queue-pane head).
    // uio-P-C05 (PUB-13): it is no longer an "Import & export" grab-bag. Import belongs to Source, so
    // the pane's named control is now FORMAT — it states the format the queue will emit without
    // opening anything, and its menu lists the other formats once with their "soon" state. The
    // remaining outbound/workspace actions keep a home in a quiet ... overflow beside it.
    // Callers that kept the old menu in sync (registerPipelineButton) still re-render this.
    function renderToolbarPipeline() {
      var host = document.getElementById("publish-io"); if (!host) return;
      host.innerHTML = "";
      var U = window.VersoUI;
      var summary = publishQueueFormat();
      var fmtLabel = "Format: " + summary.label;
      var fmtTitle = summary.mixed
        ? "The queued documents use presets that ask for different formats"
        : "Output format, set by each document's output preset";
      var btn;
      if (U && U.Button) {
        btn = U.Button({ variant: "secondary", size: "sm", icon: "file-text", iconRight: "chevron-down", label: fmtLabel, title: fmtTitle, onClick: function () { openPublishFormatMenu(btn); } });
      } else {
        btn = h("button", "tool"); btn.type = "button"; btn.textContent = fmtLabel; btn.title = fmtTitle;
        btn.addEventListener("click", function () { openPublishFormatMenu(btn); });
      }
      host.appendChild(btn);
      var outbound = pipelineByDirection(pipelineButtons, "export");
      if (U && U.IconButton) {
        var ov = U.IconButton({ icon: "more-horizontal", label: "Other export actions", onClick: function () {
          var r = ov.getBoundingClientRect();
          var items = outbound.map(function (b) { return { label: b.label, onClick: b.onClick }; });
          items.push({ sep: true });
          items.push({ label: "Publish to Viewer…", onClick: function () { publishToViewer(); } }); // not a registered pipeline button
          showContextMenu(r.right, r.bottom + 4, items);
        } });
        host.appendChild(ov);
      }
    }
    // The format the pending queue will emit, read from each row's resolved preset options.
    function publishQueueFormat() {
      var SX = window.SCORMExport, PQ = window.PublishQueue;
      var fmts = (SX && SX.formats) ? SX.formats() : [];
      var base = (SX && SX.defaultOptions) ? (SX.defaultOptions().format || "") : "";
      var rows = (PQ && PQ.pendingRows) ? PQ.pendingRows(publishQueue()) : [];
      var values = rows.map(function (r) { return publishOptionsForRow(r).format || base; });
      return publishFormatSummary(fmts, values, base);
    }
    // Every format listed ONCE: the emitted one marked selected, the rest greyed with a "Soon" state
    // (never re-labelled "(soon)" per entry). Nothing here sets the format — the menu ends by naming
    // where it IS set, the row's output preset.
    function openPublishFormatMenu(anchor) {
      var SX = window.SCORMExport;
      var fmts = (SX && SX.formats) ? SX.formats() : [];
      var summary = publishQueueFormat();
      var items = [{ head: "Output format" }];
      publishFormatRows(fmts, summary.value).forEach(function (f) {
        items.push({ label: f.label, active: f.selected, hint: f.hint, disabled: !f.available });
      });
      items.push({ sep: true });
      items.push({ head: "Set by the output preset on each queued document." });
      var r = anchor.getBoundingClientRect();
      showContextMenu(r.right, r.bottom + 4, items);
    }

    // Issue #12 (parent #22) — re-skin the editor top bar to the DS. Hydrate the
    // icon-only tools from the Lucide Icon accessor (markup in index.html stays
    // svg-free so the DS conformance gate holds) and promote Preview (Demo) to the
    // single accent-blue PRIMARY (a vds-btn). RE-SKIN ONLY: the demo-enter click
    // wiring set in wireDemo() binds to the same node, untouched here.
    function mountTopBar() {
      if (typeof document === "undefined") return;
      var Ic = window.Icon; if (!Ic) return;
      var hosts = document.querySelectorAll(".toolbar [data-lucide], .left-rail [data-lucide], .canvas-overlay-bar [data-lucide], .stage-placeholder [data-lucide], .panel-tabs [data-lucide]");
      Array.prototype.forEach.call(hosts, function (el) {
        var name = el.getAttribute("data-lucide");
        if (!name) return;
        if (el.id === "demo-enter") return; // handled as the primary Preview button
        if (el.id === "zoom-fit") { var g = h("span", "zoom__caret"); g.innerHTML = Ic(name); el.appendChild(g); return; }
        el.innerHTML = Ic(name);
      });
      var prev = document.getElementById("demo-enter");
      if (prev) {
        // #92c: Preview is a glyph-only accent button (the "Preview" word is dropped; the
        // title tooltip + the adjacent size chevron carry the meaning).
        prev.className = "vds-btn vds-btn--primary vds-btn--md tool--preview tool--preview-icon";
        prev.innerHTML = "";
        var pIcon = h("span", "vds-btn__icon"); pIcon.innerHTML = Ic("play"); prev.appendChild(pIcon);
      }
    }

    // Product Rail (2026-07-27 DaVinci pivot): left rail is three fixed, ungated,
    // free-form segments -- Source, Edit, Publish -- replacing the old single
    // Document tab. Edit shows exactly today's document-editing workspace
    // (Structure/Blocks/Components + canvas + inspector), byte-for-byte unchanged.
    // Source/Publish are placeholder regions until Epics 2/3/6 build their real
    // content -- this ticket only owns the segment switch + the shared product
    // context, not what renders inside each stage.
    /* @stage-rail-start */
    var STAGE_IDS = ["source", "edit", "publish"];
    function isValidStage(s) { return STAGE_IDS.indexOf(s) !== -1; }
    // Edit renders through the workspace's ORIGINAL grid (no extra class) so today's
    // editing experience never changes; Source/Publish get a modifier class that hides
    // the edit-only grid items and reveals their own placeholder (same "hide the grid
    // items, span the leftover column" approach as .workspace.is-panels-hidden).
    function stageWorkspaceClass(stage) {
      if (stage === "source") return "workspace--stage-source";
      if (stage === "publish") return "workspace--stage-publish";
      return null;
    }
    // ProductsStore ({id: {id,name,...}}) -> dropdown options, "All products" first.
    function productSelectOptions(store) {
      var opts = [{ value: "", label: "All products" }];
      Object.keys(store || {}).sort(function (a, b) {
        return ((store[a] && store[a].name) || "").localeCompare((store[b] && store[b].name) || "");
      }).forEach(function (id) {
        opts.push({ value: id, label: (store[id] && store[id].name) || id });
      });
      return opts;
    }
    /* @stage-rail-end */

    var __activeStage = "edit";
    var STAGE_PERSIST_KEY = "verso.activeStage"; // persist the active stage so a refresh returns here, not Edit
    // The canvas viewport is display:none on Source/Publish, so any fit computed while it's hidden
    // measures a 0x0 rect and lands the author in blank space. Frame the content ONCE the first time
    // Edit is shown with a laid-out canvas; later Edit entries keep the author's pan.
    var __framedWhileVisible = false;
    function setStage(stage) {
      if (!isValidStage(stage)) return;
      __activeStage = stage;
      try { localStorage.setItem(STAGE_PERSIST_KEY, stage); } catch (e) {}
      if (typeof document === "undefined") return;
      applyLeftSection(activeLeftSection()); // SPEC 7: re-apply the left switcher's active section (Edit shows the panel; the switcher owns pane visibility)
      var ws = document.getElementById("workspace");
      if (ws) {
        ws.classList.remove("workspace--stage-source", "workspace--stage-publish");
        var cls = stageWorkspaceClass(stage);
        if (cls) ws.classList.add(cls);
      }
      var srcEl = document.getElementById("stage-source"); if (srcEl) srcEl.hidden = stage !== "source";
      var pubEl = document.getElementById("stage-publish"); if (pubEl) pubEl.hidden = stage !== "publish";
      // uio-E-C01 (EDIT-07): the doc zones (tabs / doc controls / output) were merged into the
      // single .toolbar and show only in Edit; Source/Publish show the identity zone only.
      var tb = document.querySelector(".toolbar"); if (tb) tb.classList.toggle("toolbar--edit", stage === "edit");
      STAGE_IDS.forEach(function (s) {
        var btn = document.getElementById("rail-tab-" + s);
        if (btn) btn.classList.toggle("is-active", s === stage);
      });
      if (stage === "source") renderSourceStage();
      if (stage === "publish") mountPublishStage();
      // SPEC 7 file-picker: landing on Edit with no open tabs shows the doc browser automatically.
      if (stage === "edit" && !openDocIds.length && typeof openBrowser === "function") openBrowser();
      // Frame the content the first time Edit is actually visible (see __framedWhileVisible). rAF so the
      // canvas has a real, non-zero rect before fitAll measures it.
      if (stage === "edit" && !__framedWhileVisible && typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          if (__framedWhileVisible || __activeStage !== "edit") return;
          var r = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
          if (!r || r.width < 2 || r.height < 2) return; // still hidden / not laid out yet
          view.ready = false; fitAll(); __framedWhileVisible = true;
        });
      }
    }
    function mountLeftRail() {
      if (typeof document === "undefined") return;
      var rail = document.getElementById("left-rail"); if (!rail) return;
      var setBtn = document.getElementById("rail-settings-btn");
      // side-rail-cleanup: the rail cog opens SYSTEM (app/machine) settings. Per-document/project
      // settings now open from the editor header's Document-settings button (edit-header-ia-v2), so
      // the rail no longer duplicates them.
      if (setBtn && !setBtn.__wired) { setBtn.__wired = true; setBtn.addEventListener("click", function () { openSettingsModal("system"); }); }
      var tabs = rail.querySelectorAll(".rail-tab");
      Array.prototype.forEach.call(tabs, function (t) {
        if (t.__navWired) return; t.__navWired = true;
        t.addEventListener("click", function () { setStage(t.getAttribute("data-rail-tab")); });
      });
      // restore the stage the author left on (a refresh should not snap back to Edit)
      try { var saved = localStorage.getItem(STAGE_PERSIST_KEY); if (isValidStage(saved)) __activeStage = saved; } catch (e) {}
      setStage(__activeStage);
    }
    // The stage is this file's own state. editor.js reads it in one place and asks rather than
    // reaching for the variable.
    function activeStage() { return __activeStage; }
    window.__leftRail = { mount: mountLeftRail, setStage: setStage, getStage: function () { return __activeStage; } }; // boot + settings

    // SPEC 7 (cell switcher + tiered mutability): the editor-header chip shows the document's matrix
    // cell (geometry . interactivity) and opens a menu to change it AFTER creation. Tiered: toggling
    // interactivity is free + immediate; a geometry-mode change warns (content reflows, may not survive
    // 1:1) then re-renders the canvas into the new geometry. Reads/writes doc.meta via the pure
    // doc-type model; a geometry change is reflected by mount() rebuilding the geo-classed canvas.
    var CELL_GEO_LABEL = { reflow: "Reflow", frame: "Fixed frame", paged: "Paged" };
    function currentCell() {
      return (window.__docType && window.__docType.docCell) ? window.__docType.docCell(E.doc) : { geo: "reflow", interactive: true };
    }
    function applyCellChange(geo, interactive) {
      if (!window.__docType || !window.__docType.tagDocCell) return;
      window.__docType.tagDocCell(E.doc, geo, interactive);
      saveRegistry(registry);
      mount();            // rebuild the geo-classed canvas + palette (static fallback rides render)
      syncCellChip();     // no-op now the chip left the bar; harmless if re-added later
      // edit-header-ia-v2: the geometry/interactivity controls now live in the Document settings
      // modal -- re-render it so the segmented state reflects the change.
      var sm = document.getElementById("settings-modal");
      if (sm && !sm.hidden && typeof renderSettingsBody === "function") renderSettingsBody();
    }
    function setCellInteractive(on) {
      var c = currentCell();
      if (c.interactive === on) return;
      applyCellChange(c.geo, on); // immediate, no warning (free per tiered mutability)
    }
    function setCellGeo(geo) {
      var c = currentCell();
      if (c.geo === geo) return;
      // Guarded: a geometry-mode switch reflows content and may not survive 1:1.
      confirmModal("Change layout mode?",
        "Switching to " + (CELL_GEO_LABEL[geo] || geo) + " reflows this document's content into the new geometry. It may not survive 1:1 -- you can switch back, but check the result.",
        function () { applyCellChange(geo, c.interactive); },
        { okLabel: "Change & reflow" });
    }
    // edit-header-ia-v2: the geometry/interactivity picker moved off the header (the cell chip +
    // its menu are retired) into the Document settings modal's "Document type" section
    // (buildDocTypeBody). syncCellChip is kept as a safe no-op for the 3 legacy call sites (the chip
    // element no longer exists, so it returns early) rather than re-plumbing them.
    function syncCellChip() {
      if (typeof document === "undefined") return;
      var chip = document.getElementById("editor-cell-chip"); if (!chip) return;
      var c = currentCell();
      chip.textContent = (CELL_GEO_LABEL[c.geo] || c.geo) + " · " + (c.interactive ? "Interactive" : "Static");
      chip.classList.toggle("is-static", !c.interactive);
    }
    // edit-header-ia-v2: the header's Document-settings button opens the settings modal on the
    // Project tab -- the per-document/per-course settings (Header & Footer, Learner nav, Theme...).
    // The System tab (app/machine settings) is reachable from the rail cog. Today's eLearning is the
    // only shipped doc type, so the Project sections ARE its document settings; when other doc types
    // land, getSettingsSections filters the list by the doc's type (the capability-driven seam).
    function mountDocSettingsBtn() {
      if (typeof document === "undefined") return;
      var b = document.getElementById("doc-settings-btn"); if (!b || b.__wired) return;
      b.__wired = true;
      b.addEventListener("click", function () { openSettingsModal("project"); });
    }

    // THE TOP-BAR PRODUCT PICKER IS GONE (uio-W01). It held one global active Product, persisted
    // across refresh, that every destination read and filtered itself by. Choosing a Product in it
    // silently emptied the Edit tab strip, hid Publish rows, and gated Source behind an alert. A
    // filter was doing a mode's job. Product is a tag, a facet and an inspector now -- never a mode
    // the author is inside, and never one value shared between destinations.
    //
    // What replaced each consumer: tab strips show what is open (`visibleTabIds`, split by document
    // TYPE in uio-W10); the document browser is unscoped until Files replaces it (uio-W04); Publish
    // gets its own facets (uio-W16); Source resolves its own document (source-stage.js,
    // `activeSourceProductId`) until it gains a real switcher in uio-W10/W14; and creating a
    // document no longer inherits a scope (uio-W08). `verso.activeProduct` is read once on upgrade
    // and retired -- see product-rail.js, "the retired global scope".

    // Create an empty Product from a single-field name modal. It no longer selects anything,
    // because there is nothing to select: a new Product is empty until a document is tagged with
    // it. `onDone` lets the caller refresh whatever surface it was opened from.
    function newProductPrompt(onDone) {
      promptModal("New product", "Product name", "", function (v) {
        var name = (v || "").trim(); if (!name) return;
        var prod = createProduct(name); if (!prod) return;
        if (typeof onDone === "function") onDone(prod);
      });
    }

    kernel.expose({
      renderPipelineButtons: renderPipelineButtons, renderToolbarPipeline: renderToolbarPipeline, publishQueueFormat: publishQueueFormat,
      openPublishFormatMenu: openPublishFormatMenu, mountTopBar: mountTopBar, isValidStage: isValidStage,
      stageWorkspaceClass: stageWorkspaceClass, productSelectOptions: productSelectOptions, setStage: setStage,
      activeStage: activeStage, mountLeftRail: mountLeftRail, currentCell: currentCell,
      applyCellChange: applyCellChange, setCellInteractive: setCellInteractive, setCellGeo: setCellGeo,
      syncCellChip: syncCellChip, mountDocSettingsBtn: mountDocSettingsBtn,
      newProductPrompt: newProductPrompt
    });
    // Constants the rest of the chrome reads as DATA. They cannot cross as bound forwarders,
    // because bind() returns a function.
    kernel.provide({
      CELL_GEO_LABEL: CELL_GEO_LABEL, STAGE_IDS: STAGE_IDS
    });
  }

  window.VersoShell = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoShell;
})();
