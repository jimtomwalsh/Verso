// editor/settings-sheet.js -- everything about the course that is not on a page (arch-P3b-07g).
//
// The sheet is one surface with two tabs. SYSTEM is about the tool: light chrome, spellcheck,
// developer tools, the panel layout. PROJECT is about the course: its type, the header and footer,
// the learner nav, page layout, theme, fonts, glossary, motion, components, review. Each section
// is a descriptor with a build function, and the list is filtered by the document's type -- which
// is how a document that cannot have a learner nav simply does not offer one.
//
// The OVERLAY LAYER STACK lives here, and it is the more load-bearing half. Every dismissible
// surface pushes itself as it opens and pops as it closes, and ONE global keydown owns Escape,
// closing the topmost layer only. Without that, a confirm dialog opened from the sheet takes the
// Escape meant for it AND the one meant for the sheet, and every new overlay adds another handler
// racing the others for the same key. It is forty lines and it is the reason the app has one Esc
// contract rather than eleven.
//
// Four panel bodies moved with it, from the fonts banner they were filed under: the glossary
// (with its CSV import), motion, the backup folder, and the breakpoint sizes. They are sections of
// this sheet and nothing else calls them.
//
// Editor chrome only: it configures what render() emits, and renders none of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "scheduleSave", "BREAKPOINTS", "BP_DEFAULTS", "panelSection", "switchRow",
      "mount", "iconField", "pushHistory", "saveBpSizes", "applyBp", "view",
      "BP_MIN", "BP_MAX", "currentCell", "hfSectionOpts", "backupSlug", "bpClampDim",
      "twoUp", "segmentedLive", "setCellGeo", "setCellInteractive", "colourControl", "applyCanvasBg",
      "BG_DEFAULT", "uiThemeIsLight", "applyUiTheme", "spellcheckOn", "setSpellcheckEnabled", "devToolsOn",
      "setDevToolsEnabled", "buildLibraryBody", "buildPublishDestinationsBody", "buildPublishPresetsBody", "buildHeaderBody", "buildFooterBody", "buildHeaderFooterDefaultBody", "buildLayoutBody",
      "renderThemeControls", "buildFontsBody", "buildComponentsBody", "buildPipelineBody", "footerCourseNav", "crossRefRow",
      "courseNavNests", "sectionGroup", "MOD_KEY", "wirePanelResizer", "togglePanels", "reapplyLayout",
      "backupMode", "backupHandleSet", "bindProjectFolder", "reconnectBackupFolder", "repeatedList", "confirmModal",
      "doc", "inspector", "canvasBg",
      // Moving a whole working environment. The pure planner is src/workspace-transfer.js; these
      // two are the disk-and-stores half, which lives beside the document import it generalises.
      "exportWorkspaceFile", "importWorkspaceFile", "exportWorkspaceEverything",
      // The panel host is swapped while a section body builds, and a write crosses as a function.
      "setInspector"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        scheduleSave = E.scheduleSave,
        BREAKPOINTS = E.BREAKPOINTS,
        BP_DEFAULTS = E.BP_DEFAULTS,
        panelSection = E.panelSection,
        switchRow = E.switchRow,
        mount = E.mount,
        iconField = E.iconField,
        pushHistory = E.pushHistory,
        saveBpSizes = E.saveBpSizes,
        applyBp = E.applyBp,
        view = E.view,
        BP_MIN = E.BP_MIN,
        BP_MAX = E.BP_MAX,
        currentCell = E.currentCell,
        hfSectionOpts = E.hfSectionOpts,
        backupSlug = E.backupSlug,
        bpClampDim = E.bpClampDim,
        twoUp = E.twoUp,
        segmentedLive = E.segmentedLive,
        setCellGeo = E.setCellGeo,
        setCellInteractive = E.setCellInteractive,
        colourControl = E.colourControl,
        applyCanvasBg = E.applyCanvasBg,
        BG_DEFAULT = E.BG_DEFAULT,
        uiThemeIsLight = E.uiThemeIsLight,
        applyUiTheme = E.applyUiTheme,
        spellcheckOn = E.spellcheckOn,
        setSpellcheckEnabled = E.setSpellcheckEnabled,
        devToolsOn = E.devToolsOn,
        setDevToolsEnabled = E.setDevToolsEnabled,
        buildLibraryBody = E.buildLibraryBody,
        buildHeaderBody = E.buildHeaderBody,
        buildFooterBody = E.buildFooterBody,
        buildHeaderFooterDefaultBody = E.buildHeaderFooterDefaultBody,
        buildLayoutBody = E.buildLayoutBody,
        renderThemeControls = E.renderThemeControls,
        buildFontsBody = E.buildFontsBody,
        buildComponentsBody = E.buildComponentsBody,
        buildPipelineBody = E.buildPipelineBody,
        footerCourseNav = E.footerCourseNav,
        crossRefRow = E.crossRefRow,
        courseNavNests = E.courseNavNests,
        sectionGroup = E.sectionGroup,
        MOD_KEY = E.MOD_KEY,
        wirePanelResizer = E.wirePanelResizer,
        togglePanels = E.togglePanels,
        reapplyLayout = E.reapplyLayout,
        backupMode = E.backupMode,
        backupHandleSet = E.backupHandleSet,
        bindProjectFolder = E.bindProjectFolder,
        reconnectBackupFolder = E.reconnectBackupFolder,
        repeatedList = E.repeatedList,
        confirmModal = E.confirmModal;

    // ---- uio-F05: the overlay LAYER STACK (the spine's Esc contract) ----------
    // Every dismissible surface pushes itself here as it opens and pops as it closes. ONE global
    // keydown owns Escape, and it closes the TOPMOST layer only, last-in-first-out — so a confirm
    // raised over the settings sheet closes the confirm and leaves the sheet standing. Before
    // this, each surface listened for Escape on its own, so one keypress could close two things
    // (or the wrong one). Focus returns to whatever opened the layer, per the spine's keyboard
    // contract. `window.__overlayLayers` is the test hook.
    /* @f05-start */
    var overlayLayers = []; // [{ name, close, returnFocus }] — topmost is last
    function pushLayer(name, close) {
      var active = document.activeElement;
      var layer = { name: name, close: close, returnFocus: active && active.focus ? active : null };
      overlayLayers.push(layer);
      if (overlayLayers.length === 1) document.addEventListener("keydown", overlayEsc, true);
      return layer;
    }
    function popLayer(name) {
      // Remove the TOPMOST layer with this name (a surface may legitimately be stacked twice).
      for (var i = overlayLayers.length - 1; i >= 0; i--) {
        if (overlayLayers[i].name !== name) continue;
        var layer = overlayLayers.splice(i, 1)[0];
        if (!overlayLayers.length) document.removeEventListener("keydown", overlayEsc, true);
        if (layer.returnFocus && document.contains(layer.returnFocus)) {
          try { layer.returnFocus.focus(); } catch (e) {}
        }
        return layer;
      }
      return null;
    }
    function topLayer() { return overlayLayers.length ? overlayLayers[overlayLayers.length - 1] : null; }
    function overlayEsc(e) {
      if (e.key !== "Escape") return;
      var top = topLayer();
      if (!top) return;
      e.preventDefault();
      e.stopPropagation(); // the topmost layer answers this keypress, and only it
      try { top.close(); } catch (err) {}
    }
    /* @f05-end */
    window.__overlayLayers = {
      push: pushLayer, pop: popLayer, top: topLayer,
      names: function () { return overlayLayers.map(function (l) { return l.name; }); }
    };

    // ---- ⚙ Settings sheet (System / Project tabs) ----------------------------
    // uio-F05: this was a centred modal on a scrim. It is now the spine's SHEET — right-docked,
    // full-height, NO scrim — so the canvas stays live and editable beside it (squeezed, never
    // covered). The doc-settings panels are mounted by redirecting `inspector` at the content
    // pane (the same trick the sectioned inspectors use). SYSTEM = global / cross-document
    // (canvas + shared component library); PROJECT = this document (header/footer, nav, layout,
    // theme, fonts, glossary, motion, components, review).
    var settingsModal = null; // { host, box, content, active, tab }
    // Section registry per tab. Each section's `build(host)` fills the CONTENT pane — the same
    // body-builders the old sidebar used, so no logic is duplicated; they just render into the
    // dialog's right pane one-at-a-time instead of a stacked wall of disclosures.
    // #42: apply an edited preview dimension — clamp, persist, and (like setBreakpoint)
    // re-mount so the frames resize when the edited device is the one being previewed.
    function setBpSize(bp, dim, val) {
      if (!BREAKPOINTS[bp]) return;
      BREAKPOINTS[bp][dim] = bpClampDim(val, BP_DEFAULTS[bp][dim]);
      saveBpSizes();
      applyBp();
      view.ready = false; mount(); // frames may have changed size -> refit (mirrors setBreakpoint)
    }
    // uio / verso-workspace-export-import: the one place a whole working environment leaves and
    // arrives. Stated plainly, because the two buttons do very different-sized things: export is
    // safe and repeatable, import can replace everything you have.
    function buildWorkspaceBody(host) {
      var U = window.VersoUI;
      host.appendChild(h("div", "insp-hint",
        "A workspace file carries EVERY document, every source document, your products and your settings — the whole machine, not one document. It is how work moves between the app, staging and this browser."));
      var row = h("div", "insp-row insp-row--actions");
      // The PRIMARY export is the complete one. Exporting the structure and leaving the author to
      // fetch each document's images by hand is what made the flow "far too much work", and every
      // manual repetition is a document that can be missed without anyone noticing.
      row.appendChild(U.Button({ variant: "primary", label: "Export everything to a folder…", onClick: function () { E.exportWorkspaceEverything(); } }));
      row.appendChild(U.Button({ variant: "secondary", label: "Import workspace…", onClick: function () { E.importWorkspaceFile(); } }));
      host.appendChild(row);
      host.appendChild(h("div", "insp-hint",
        "Pick a folder once and Verso writes the whole thing into it: the workspace file, plus a .verso for every document carrying that document's images. Chrome or Edge — Safari and Firefox can't write to a folder."));
      // The structure-only download stays, quietly, for the case where the folder is not wanted --
      // and it is labelled with what it leaves out rather than looking like the same act, smaller.
      var row2 = h("div", "insp-row insp-row--actions");
      row2.appendChild(U.Button({ variant: "secondary", label: "Workspace file only (no images)", onClick: function () { E.exportWorkspaceFile(); } }));
      host.appendChild(row2);
      host.appendChild(h("div", "insp-hint",
        "Importing offers Replace or Merge, tells you exactly what it will add and remove first, and downloads a backup of your current workspace before it touches anything."));
    }
    function buildPreviewSizesBody(host) {
      host.appendChild(h("div", "insp-hint", "The pixel dimensions behind the desktop / tablet / mobile preview buttons. These size the preview frame only — the course's own responsive layout (which keys off the device name) is unchanged. Saved on this machine."));
      [["desktop", "Desktop"], ["tablet", "Tablet"], ["mobile", "Mobile"]].forEach(function (pair) {
        var bp = pair[0];
        var body = panelSection(host, pair[1]);
        var wField = iconField("W", { value: BREAKPOINTS[bp].w, unit: "px", placeholder: String(BP_DEFAULTS[bp].w), step: 10, min: BP_MIN, max: BP_MAX, datalist: "dl-gap", title: pair[1] + " width",
          onchange: function (v) { setBpSize(bp, "w", v); } }).wrap;
        var hField = iconField("H", { value: BREAKPOINTS[bp].h, unit: "px", placeholder: String(BP_DEFAULTS[bp].h), step: 10, min: BP_MIN, max: BP_MAX, datalist: "dl-gap", title: pair[1] + " height",
          onchange: function (v) { setBpSize(bp, "h", v); } }).wrap;
        body.appendChild(twoUp(wField, hField));
      });
      var reset = h("button", "prop-btn", "Reset to defaults"); reset.style.marginTop = "10px";
      reset.addEventListener("click", function () {
        Object.keys(BP_DEFAULTS).forEach(function (k) { BREAKPOINTS[k].w = BP_DEFAULTS[k].w; BREAKPOINTS[k].h = BP_DEFAULTS[k].h; });
        saveBpSizes(); applyBp(); view.ready = false; mount(); refreshSettingsPanes();
      });
      host.appendChild(reset);
    }
    // edit-header-ia-v2: the document type (geometry . interactivity) moved off the header bar into
    // the Document settings modal -- it's set once, so it belongs here, not on a face-up control.
    // Reuses the cell model (currentCell / setCellGeo / setCellInteractive); a geometry change still
    // warns + reflows via setCellGeo's confirm.
    function buildDocTypeBody(host) {
      var body = host; // OVL-07: no inner "Document type" heading restating the section's own title
      segmentedLive("Geometry",
        [{ value: "reflow", label: "Reflow" }, { value: "frame", label: "Fixed frame" }, { value: "paged", label: "Paged" }],
        function (v) { return currentCell().geo === v; },
        function (v) { setCellGeo(v); },
        body, true);
      switchRow("Interactive", function () { return currentCell().interactive; }, function (on) { setCellInteractive(on); }, body, true);
      body.appendChild(h("div", "insp-hint", "Set once per document. Geometry lays out the canvas — Reflow scrolls; Fixed frame and Paged are fixed-size. Changing geometry reflows existing content. Interactive allows interactive blocks; Static is print/read-oriented."));
    }
    function getSettingsSections(tab) {
      if (tab === "system") return [
        { key: "canvas", title: "Canvas", build: function (host) {
            var cvBody = host; // OVL-07: the section is already called Canvas — no second heading
            colourControl("Background", E.canvasBg, function (val) { applyCanvasBg(val == null ? BG_DEFAULT : val); }, cvBody, true);
            cvBody.appendChild(h("div", "insp-hint", "System settings persist across every document on this machine."));
            // #44: light theme for Verso's OWN UI (chrome), distinct from the learner course light/dark.
            var ifBody = panelSection(host, "Interface");
            switchRow("Light interface", function () { return uiThemeIsLight(); }, function (v) { applyUiTheme(v); }, ifBody);
            ifBody.appendChild(h("div", "insp-hint", "Light theme for Verso's own UI (panels, toolbar, inspector). Separate from the learner course's light/dark mode."));
            // P0 spellcheck: mark misspellings across every text box, on or off selection.
            switchRow("Spellcheck", function () { return spellcheckOn(); }, function (v) { setSpellcheckEnabled(v); }, ifBody);
            ifBody.appendChild(h("div", "insp-hint", "Underlines likely typos in every text box on the canvas and in the copy editor, whether or not it's selected. Editor-only — never shown to learners or exported."));
            // uio-E-C05 (EDIT-10): the live JSON document model is a developer affordance, off by default.
            switchRow("Developer tools", function () { return devToolsOn(); }, function (v) { setDevToolsEnabled(v); }, ifBody);
            ifBody.appendChild(h("div", "insp-hint", "Shows the live document model (JSON) below the inspector for debugging. Off by default; editor-only, never exported."));
          } },
        { key: "preview", title: "Preview sizes", build: buildPreviewSizesBody },
        // A workspace is machine-level -- every document, the library and the products at once --
        // so it belongs in System beside the other things that outlive one document, not in
        // Project beside that document's own header and backup.
        //
        // ABOVE Component Library, deliberately. The library section carries its own "Transfer"
        // sub-section with an Export Library (.json) button, and the two sat as near-identical
        // export pairs a few pixels apart -- one of which is a SUBSET of the other, since the
        // workspace file already carries the library. James went looking for the workspace export
        // and found the library one. The bigger scope reads first, so the narrower control is met
        // as a subset of something already understood rather than mistaken for it.
        { key: "workspace", title: "Workspace", build: buildWorkspaceBody },
        { key: "library", title: "Component Library", build: buildLibraryBody },
        // uio-P-M02: named publish destinations. A library of named things that outlives any one
        // document, like the two above it — so it lives where they live rather than in a modal of
        // its own. Publish's per-output popover routes here rather than managing them inline.
        { key: "destinations", title: "Publish destinations", build: E.buildPublishDestinationsBody },
        // uio-P-M04: output presets, beside the destinations they publish to. Same reasoning — a
        // library of named things, managed where the other libraries are, not in a hover menu.
        { key: "presets", title: "Output presets", build: E.buildPublishPresetsBody }
      ];
      return [
        { key: "docType", title: "Document type", build: buildDocTypeBody },
        { key: "backup", title: "Backup", build: buildBackupBody },
        // OVL-07: promoted out of one "Header & Footer" section, so their own groups are level 2
        // rather than a third level of headings. `opts` rides the section header (switch + summary
        // + Reset) and is resolved per render, because it reads the live document.
        { key: "header", title: "Header", build: buildHeaderBody, opts: function () { return hfSectionOpts(true); } },
        { key: "footer", title: "Footer", build: buildFooterBody, opts: function () { return hfSectionOpts(false); } },
        { key: "hfDefault", title: "New-course default", build: buildHeaderFooterDefaultBody },
        // #168: canonical footer nav (was first-found, which could drift to a stray).
        // uio-O-W1 (OVL-06): with no nav bar yet, the pane used to instruct the author to walk to
        // Header & Footer. It now states the fact and links there.
        // OVL-07: with a nav bar present its five groups are sheet sections of their own, so their
        // inner groups (Labels, Appearance, Size…) sit at level 2 instead of a third level under a
        // "Learner nav" wrapper. With no nav bar there is nothing to configure, so the one section
        // states that and links to where a nav bar is added.
        ].concat(navSettingsSections()).concat([
        { key: "layout", title: "Page layout", build: buildLayoutBody },
        { key: "endScreen", title: "Completion screen", build: buildEndScreenBody },
        { key: "theme", title: "Theme", build: renderThemeControls },
        { key: "fonts", title: "Custom fonts", build: buildFontsBody },
        { key: "glossary", title: "Glossary", build: buildGlossaryBody },
        { key: "motion", title: "Motion", build: buildMotionBody },
        { key: "components", title: "Custom Components", build: buildComponentsBody },
        { key: "pipeline", title: "Review (Viewer)", build: buildPipelineBody }
      ]);
    }
    // The learner-nav sections for the settings sheet. One descriptor list, two surfaces: the
    // same five groups are the nav BLOCK's inspector sections when the bar is selected on the
    // canvas (courseNavControls) and sheet sections here.
    function navSettingsSections() {
      var n = footerCourseNav();
      if (!n) {
        return [{ key: "nav", title: "Learner nav", build: function (host) {
          crossRefRow({ label: "Learner nav bar", value: "Not added", linkLabel: "Footer", host: host,
            title: "Open Footer, where the nav bar is added",
            onNavigate: function () { openSettingsSection("project", "footer"); } });
        } }];
      }
      return courseNavNests(n).map(function (nest) {
        return {
          // Under the selected nav block "Buttons" is unambiguous; standing on their own in the
          // sheet they say which thing they belong to.
          key: nest.key, title: nest.sheetTitle || nest.title,
          build: function (host) { nest.build(host); },
          opts: nest.opts ? function () { return nest.opts; } : null
        };
      });
    }
    // uio-F05: render EVERY section of the active tab into the content pane as one scroll.
    // This used to be a 220px nav rail plus one section at a time. Both are gone: a nav rail
    // inside a dock is a second navigation system competing with the section headers and with
    // the one ⌘K index, and one-section-at-a-time is the same divergence uio-E-C02 removes from
    // the inspector. Sections are the canonical sectionGroup -- collapsible, with the F03
    // "N overridden" roll-up -- and open collapsed, so the sheet reads as a browsable list.
    // The section builders are untouched: `inspector` is still rebound at the host they append
    // into, exactly as before, so all 15 keep working.
    function renderSettingsBody() {
      if (!settingsModal) return;
      var tab = settingsModal.tab, sections = getSettingsSections(tab);
      var activeKey = settingsModal.sectionKey[tab];
      if (!sections.some(function (s) { return s.key === activeKey; })) activeKey = sections[0].key;
      settingsModal.sectionKey[tab] = activeKey;
      settingsModal.content.innerHTML = "";
      // Each section body builds into the panel host every canonical control appends to, so the
      // host is swapped for the duration of the build and restored after -- including on a throw.
      var _ins = E.inspector;
      try {
        sections.forEach(function (s) {
          var sec = sectionGroup("settings:" + s.key, s.title, function (body) {
            E.setInspector(body);
            try { s.build(body); } finally { E.setInspector(_ins); }
          }, s.opts ? s.opts() : null);
          sec.setAttribute("data-settings-section", s.key);
          settingsModal.content.appendChild(sec);
        });
      } finally { E.setInspector(_ins); }
      wireScrollEdges(settingsModal.content); // uio-O-W1: idempotent — wires once, re-measures every time
    }
    // Open one section and bring it into view — the landing move for every cross-reference link
    // (uio-O-W1/OVL-06) now that there is no nav rail to highlight.
    function revealSettingsSection(key) {
      if (!settingsModal) return;
      var sec = settingsModal.content.querySelector('[data-settings-section="' + key + '"]');
      if (!sec) return;
      if (sec.classList.contains("is-collapsed")) {
        var head = sec.querySelector(".insp-section__head");
        if (head) head.click(); // reuse the header's own toggle, so the stored state follows
      }
      if (sec.scrollIntoView) sec.scrollIntoView({ block: "start" });
    }
    function ensureSettingsModal() {
      if (settingsModal) return settingsModal;
      // uio-F05: the sheet is a grid child of .workspace pinned to the SAME column the inspector
      // uses. Opening it widens that column to --panel-sheet-width and hides the inspector, so the
      // canvas is squeezed exactly ONCE and stays live. No overlay element, because there is no
      // scrim: the whole point of the sheet is that the author can keep editing beside it.
      var host = h("div", "settings-sheet"); host.id = "settings-modal"; host.hidden = true;
      var box = h("div", "settings-sheet__box");
      // Header: title + subtitle + System/Project tabs (canonical VersoUI.Tabs).
      var head = h("div", "settings-head");
      head.appendChild(h("div", "settings-title", "Settings"));
      head.appendChild(h("div", "settings-sub", "System settings persist across documents; project settings belong to this course."));
      var tabs = window.VersoUI.Tabs({
        tabs: [{ value: "system", label: "System" }, { value: "project", label: "Project" }],
        value: "project",
        onChange: function (v) { selectTab(v); }
      });
      head.appendChild(tabs); box.appendChild(head);
      // Body: ONE scroll of collapsible sections (the nav rail is gone — see renderSettingsBody).
      // uio-O-W1 (OVL-10): the body sits in a scroll-frame so its top/bottom edges can say when
      // there is more. The sheet is exactly where the audit found content sliced by the footer.
      var content = h("div", "settings-content");
      var frame = h("div", "scroll-frame"); frame.appendChild(content);
      box.appendChild(frame);
      function selectTab(name) {
        settingsModal.tab = name;
        // Keep the canonical Tabs strip in sync on programmatic opens (open("system")/open("project")).
        Array.prototype.forEach.call(tabs.children, function (b) {
          b.classList.toggle("is-on", b.textContent === (name === "system" ? "System" : "Project"));
        });
        renderSettingsBody();
      }
      // uio-O-W1 (OVL-09): the footer used to carry one accent "Done", which implied a commit
      // that never happens — settings apply live and save themselves. The surface now STATES its
      // contract (the spine's save contract: autosave + live-apply + Undo) and offers a plain
      // Close. The accent is spent on the app's real primary action, never on dismissing a panel.
      var foot = h("div", "settings-foot");
      foot.appendChild(h("div", "settings-foot__contract", "Changes apply live, saved automatically. Undo with " + MOD_KEY + "Z."));
      foot.appendChild(window.VersoUI.Button({ variant: "secondary", label: "Close", onClick: closeSettingsModal }));
      box.appendChild(foot);
      host.appendChild(box);
      // uio-F05-fb1: the sheet is resizable like every other dock, and keeps its own persisted
      // width (--sheet-w) rather than borrowing the inspector's. 340px minimum because below that
      // the shared row's 76px label column plus a 24px control stops being legible; 720px maximum
      // so the sheet can never take more room than the canvas it is meant to sit beside.
      var grip = h("div", "panel-resizer"); grip.id = "resizer-sheet";
      host.appendChild(grip);
      wirePanelResizer(grip, "sheet-w", "right", 340, 720);
      // uio-F05: NO scrim click-out. There is no scrim, and dismissing on a canvas click would
      // make the canvas unusable while the sheet is open — which is the one thing the sheet exists
      // to allow. Close and Esc are the only dismissals.
      var ws = document.querySelector(".workspace");
      (ws || document.body).appendChild(host);
      settingsModal = { host: host, overlay: host, box: box, content: content, selectTab: selectTab, active: false, tab: "project", sectionKey: { system: "canvas", project: "header" } };
      return settingsModal;
    }
    function openSettingsModal(tab) {
      ensureSettingsModal();
      if (settingsModal.active) { settingsModal.selectTab(tab || settingsModal.tab || "project"); return; }
      settingsModal.active = true;
      settingsModal.selectTab(tab || settingsModal.tab || "project");
      settingsModal.host.hidden = false;
      var ws = document.querySelector(".workspace");
      if (ws) ws.classList.add("has-sheet"); // widens the right dock; hides the inspector
      pushLayer("settings", closeSettingsModal);
    }
    // uio-O-W1 (OVL-06): the navigation target behind every settings cross-reference — open
    // Settings on a NAMED section, so a link lands the author on the row instead of at the top.
    function openSettingsSection(tab, sectionKey) {
      ensureSettingsModal();
      if (sectionKey) settingsModal.sectionKey[tab] = sectionKey;
      openSettingsModal(tab);
      if (sectionKey) revealSettingsSection(sectionKey);
    }
    function closeSettingsModal() {
      if (!settingsModal || !settingsModal.active) return;
      settingsModal.active = false;
      settingsModal.host.hidden = true;
      var ws = document.querySelector(".workspace");
      if (ws) ws.classList.remove("has-sheet"); // restores the inspector at --panel-right-width
      popLayer("settings"); // returns focus to whatever opened the sheet
    }
    // uio-O-W1 (OVL-10): tell a scrolling body to state where there is more. The classes go on the
    // `.scroll-frame` WRAPPER, not the scroller -- pseudo-elements inside an overflow box scroll
    // away with the content, so the edges have to be drawn by a positioned host around it. Safe to
    // call repeatedly; `sync` is kept on the element so a re-render can re-measure.
    function wireScrollEdges(scroller) {
      if (!scroller) return null;
      var frame = scroller.parentNode;
      if (!frame || !frame.classList || !frame.classList.contains("scroll-frame")) return null;
      function sync() {
        var slack = scroller.scrollHeight - scroller.clientHeight;
        frame.classList.toggle("has-edge-top", scroller.scrollTop > 1);
        frame.classList.toggle("has-edge-bottom", slack - scroller.scrollTop > 1);
      }
      if (!scroller.__scrollEdges) {
        scroller.__scrollEdges = true;
        scroller.addEventListener("scroll", sync);
        // ResizeObserver catches the panel being dragged wider/narrower and the window resizing.
        if (typeof ResizeObserver === "function") {
          try { new ResizeObserver(sync).observe(scroller); } catch (e) {}
        }
        // It does NOT catch the CONTENT changing height -- the scroller's own box never moves for
        // that -- and folding a section open is exactly the case the affordance exists for. So
        // watch the subtree too, coalesced to one measure per frame so a burst of class toggles
        // during a re-render costs one layout read, not one per mutation.
        if (typeof MutationObserver === "function") {
          var queued = false;
          try {
            new MutationObserver(function () {
              if (queued) return; queued = true;
              var run = function () { queued = false; sync(); };
              if (typeof requestAnimationFrame === "function") requestAnimationFrame(run); else run();
            }).observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
          } catch (e) {}
        }
      }
      sync();
      return sync;
    }
    // uio-F06 (Alt+Cmd-,): the settings for the CURRENT SELECTION. Those are the inspector's rows --
    // the spine has the inspector holding the sheet's Block scope -- so this is not a second
    // surface. It puts the sheet away if it is covering the dock, brings the panels back if they
    // are hidden, and puts focus in the inspector.
    function openSelectionSettings() {
      closeSettingsModal();
      var ws = document.querySelector(".workspace");
      if (ws && ws.classList.contains("is-panels-hidden")) togglePanels();
      // Focus the first control of the inspector's BODY, not the panel's Design/Interact tab strip
      // -- landing on the tabs would answer "settings for what I selected" with "here is a panel".
      var body = document.getElementById("inspector");
      if (!body) return;
      var focusable = body.querySelector('input:not([type="hidden"]), select, button, [tabindex="0"]');
      if (focusable && focusable.focus) { try { focusable.focus(); } catch (e) {} }
      else if (body.scrollIntoView) body.scrollIntoView({ block: "nearest" });
    }
    // #111 course-completion / exit splash. Course-level config on doc.endScreen; ON for
    // every course unless the author turns it off here. Copy is optional -> empty falls back
    // to the render defaults (shown as placeholders, read from window.VERSO_ENDSCREEN_DEFAULTS
    // so editor + render never drift). Preview it in Demo mode: play the course, Exit course.
    function buildEndScreenBody(host) {
      var es = E.doc.endScreen || (E.doc.endScreen = {});
      var defs = window.VERSO_ENDSCREEN_DEFAULTS || {};
      host.appendChild(h("div", "insp-hint", "A branded screen shown when the learner selects Exit course. It ships inside the SCORM package and replaces the LMS's default exit page. On by default for every course."));
      switchRow("Show completion screen", function () { return es.on !== false; }, function (v) { if (v) delete es.on; else es.on = false; scheduleSave(); }, host);
      function textRow(label, key, ph) {
        var row = h("div", "insp-row"); row.appendChild(h("span", "insp-row__label", label));
        var input = h("input", "prop-text"); input.type = "text"; input.spellcheck = false;
        input.value = es[key] == null ? "" : es[key]; input.placeholder = ph || "";
        input.addEventListener("input", function () { if (input.value === "") delete es[key]; else es[key] = input.value; scheduleSave(); });
        row.appendChild(input); return row;
      }
      var msg = panelSection(host, "Message");
      msg.appendChild(textRow("Eyebrow", "eyebrow", defs.eyebrow || ""));
      msg.appendChild(textRow("Title", "title", defs.title || ""));
      msg.appendChild(textRow("Body", "body", defs.body || ""));
      msg.appendChild(textRow("Footnote", "footnote", defs.footnote || ""));
      var det = panelSection(host, "Details");
      switchRow("Show modules completed + date", function () { return es.showMeta === true; }, function (v) { if (v) es.showMeta = true; else delete es.showMeta; scheduleSave(); }, det);
      det.appendChild(h("div", "insp-hint", "Empty fields use the placeholder defaults. Preview in Demo mode: play the course, then select Exit course to see the screen learners get."));
    }
    // Keep the open modal in sync when an in-modal control mutates the doc + re-renders.
    function refreshSettingsPanes() { if (settingsModal && settingsModal.active) renderSettingsBody(); }
    window.__settingsModal = { open: openSettingsModal, close: closeSettingsModal, build: renderSettingsBody }; // test hook

    // §1 glossary: doc-wide term/definition list. Returns a cleaned [{term,def}] array
    // (rows with SOME text kept; both fields coerced to strings) or null when empty, so
    // render/export only emit the glossary button + popover when there's real content.
    function glossaryTerms(d) {
      var t = d && d.glossary && d.glossary.terms;
      if (!Array.isArray(t)) return null;
      var out = [];
      t.forEach(function (x) {
        if (!x) return;
        var term = String(x.term == null ? "" : x.term);
        var def = String(x.def == null ? "" : x.def);
        if (term.trim() || def.trim()) out.push({ term: term, def: def });
      });
      return out.length ? out : null;
    }
    window.__glossaryTermsFn = glossaryTerms;
    // §1 glossary: upload a doc-wide abbreviations SVG/image. Stored as an asset;
    // Global motion: author fade durations for the light/dark toggle + chapter changes
    // (doc.motion = { modeMs, chapterMs }). Blank = the ON-by-default CSS values (300/450ms);
    // 0 = instant. prefers-reduced-motion always overrides to instant (handled in course.css).
    function buildMotionBody(c) {
      c.appendChild(h("div", "insp-hint", "Fade the light/dark switch and chapter changes. Milliseconds — 0 = instant, blank = default (300 / 450). Learners with 'reduce motion' always get instant transitions."));
      function setMotion(key, v) {
        var n = parseInt(v, 10);
        E.doc.motion = E.doc.motion || {};
        if (v === "" || v == null || isNaN(n)) delete E.doc.motion[key]; else E.doc.motion[key] = Math.max(0, Math.min(2000, n));
        if (!Object.keys(E.doc.motion).length) delete E.doc.motion;
        reapplyLayout(); scheduleSave();
      }
      var m = E.doc.motion || {};
      var mFade = panelSection(c, "Light / dark fade");
      mFade.appendChild(iconField(Icon("contrast"), { value: m.modeMs, unit: "ms", placeholder: "300", step: 50, min: 0, max: 2000, datalist: "dl-gap", title: "Light/dark fade duration (ms; 0 = instant)",
        onchange: function (v) { setMotion("modeMs", v); } }).wrap);
      var cFade = panelSection(c, "Chapter change fade");
      cFade.appendChild(iconField(Icon("contrast"), { value: m.chapterMs, unit: "ms", placeholder: "450", step: 50, min: 0, max: 2000, datalist: "dl-gap", title: "Chapter-change fade duration (ms; 0 = instant)",
        onchange: function (v) { setMotion("chapterMs", v); } }).wrap);
    }

    // a button appears in the footer nav pill that opens it as a centred overlay.
    var glossaryPreviewMode = null; // which mode the settings preview shows (null = follow the editor's active mode)
    // Project auto-backup settings. Bind / re-bind the folder;
    // shows live status. The picker MUST run from this click (a user gesture) for FSA.
    function buildBackupBody(c) {
      c.appendChild(h("div", "insp-hint", "Auto-save a durable copy of this course to a real folder (e.g. its OneDrive project folder) on every change. Writes a self-contained " + backupSlug() + ".json (fully restorable, images included) + " + backupSlug() + ".schema.csv, plus timestamped snapshots. The live app storage is not a file — this is your hard backup."));
      var bound = !!(E.doc && E.doc.backup);
      var connected = bound && (backupMode() === "native" ? !!E.doc.backup.folderPath : backupHandleSet());
      var row = h("div", "insp-row");
      var lbl = h("span", "insp-row__label"); lbl.style.flex = "1 1 auto";
      lbl.textContent = bound
        ? (connected ? "Backing up to: " + E.doc.backup.folderName : "Bound to “" + E.doc.backup.folderName + "” — NOT connected this session")
        : "No backup folder — your work is only in app storage.";
      row.appendChild(lbl); c.appendChild(row);
      if (!bound || !connected) {
        var warn = h("div", "insp-hint"); warn.style.color = "var(--danger)";
        warn.textContent = bound ? "Reconnect to resume auto-backup (the browser needs a click to re-authorise the folder after a restart)." : "Bind a folder now — without it, clearing app storage loses this course.";
        c.appendChild(warn);
      }
      var pick = h("button", "prop-btn", bound ? "Change folder…" : "Choose project folder…");
      pick.addEventListener("click", function () { bindProjectFolder().then(function () { renderSettingsBody(); }); });
      c.appendChild(pick);
      if (bound && !connected) {
        var rc = h("button", "prop-btn", "Reconnect folder");
        rc.addEventListener("click", function () { reconnectBackupFolder().then(function () { renderSettingsBody(); }); });
        c.appendChild(rc);
      }
    }
    function buildGlossaryBody(c) {
      c.appendChild(h("div", "insp-hint", "Add glossary terms and definitions. A 'Glossary' button then appears in the footer nav pill and opens a searchable term list — in the editor demo and the exported course. Fill the table below, or import a two-column CSV (Term, Definition)."));
      E.doc.glossary = E.doc.glossary || {};
      if (!Array.isArray(E.doc.glossary.terms)) E.doc.glossary.terms = [];
      var refresh = function () { mount(); };

      // Canonical repeated-item list (same control as the Sequence block's steps, per the
      // DS control set): one row per term — grip · TERM field · DEFINITION field (rowExtra)
      // · trash, with a "+ Add term" header. Edits commit through repeatedList's own
      // pushHistory; the definition rowExtra commits its own on change.
      repeatedList(c, "Terms", {
        items: function () { return E.doc.glossary.terms; },
        value: function (it) { return it.term; },
        setValue: function (it, v) { it.term = v; refresh(); },
        add: function () { E.doc.glossary.terms.push({ term: "", def: "" }); refresh(); },
        remove: function (i) { E.doc.glossary.terms.splice(i, 1); refresh(); },
        move: function (from, to) { var m = E.doc.glossary.terms.splice(from, 1)[0]; E.doc.glossary.terms.splice(to, 0, m); refresh(); },
        placeholder: "Term", addLabel: "Add term", removeTitle: "Delete term",
        rowExtras: function (item) {
          var defIn = h("input", "rep-row__extra-field"); defIn.type = "text"; defIn.spellcheck = false;
          defIn.value = item.def || ""; defIn.placeholder = "Definition"; defIn.title = "Definition";
          defIn.style.flex = "2 1 0"; defIn.style.minWidth = "0"; // the wider of the two fields
          defIn.addEventListener("change", function () { pushHistory(); item.def = defIn.value; scheduleSave(); });
          return [defIn];
        }
      });

      // CSV import — a two-column "Term,Definition" file (a header row is auto-skipped when
      // the first cell reads like a term label). Reuses the shared CSVBind.parseCSV. Imported
      // rows are MERGED + DE-DUPLICATED into the current list by term (case-insensitive): a
      // term already present has its definition UPDATED (CSV wins) instead of adding a
      // duplicate row; new terms append. Air-gap clean (no network, no asset store).
      var importCsv = function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".csv,text/csv";
        inp.addEventListener("change", function () {
          var f = inp.files && inp.files[0]; if (!f) return;
          var r = new FileReader();
          r.onload = function () {
            var added = window.parseGlossaryCsv ? window.parseGlossaryCsv(String(r.result)) : [];
            if (!added.length) { alert("No Term/Definition rows found in that CSV."); return; }
            pushHistory();
            E.doc.glossary.terms = mergeGlossaryTerms(E.doc.glossary.terms, added);
            scheduleSave();
            mount();
          };
          r.readAsText(f);
        });
        inp.click();
      };
      var csvBtn = (window.VersoUI && window.VersoUI.Button)
        ? window.VersoUI.Button({ variant: "secondary", full: true, icon: "download", label: "Import CSV (Term, Definition)…", onClick: importCsv })
        : (function () { var b = h("button", "prop-btn", "Import CSV (Term, Definition)…"); b.addEventListener("click", importCsv); return b; })();
      c.appendChild(csvBtn);

      // Clear all — a guarded wipe of every term (shown only when there are terms).
      if (E.doc.glossary.terms.length) {
        var clearAll = function () {
          confirmModal("Clear all terms", "Remove all " + E.doc.glossary.terms.length + " glossary terms? This can't be undone from here (use Undo).", function () {
            pushHistory();
            E.doc.glossary.terms = [];
            scheduleSave();
            mount();
          }, { okLabel: "Clear all", danger: true });
        };
        var clearBtn = (window.VersoUI && window.VersoUI.Button)
          ? window.VersoUI.Button({ variant: "secondary", full: true, icon: "trash-2", label: "Clear all terms", danger: true, onClick: clearAll })
          : (function () { var b = h("button", "prop-btn prop-btn--danger", "Clear all terms"); b.addEventListener("click", clearAll); return b; })();
        c.appendChild(clearBtn);
      }
    }
    // Pure MERGE + DE-DUP of glossary terms by term (case-insensitive, trimmed): keeps the
    // FIRST occurrence's term casing + position, and takes the LATEST definition for a repeat
    // (so a CSV re-import updates rather than duplicates). Rows with an empty term aren't
    // de-duped (each is kept). Extracted so tests/run.js can guard it headlessly.
    function mergeGlossaryTerms(existing, incoming) {
      var out = [], pos = {};
      (existing || []).concat(incoming || []).forEach(function (t) {
        if (!t) return;
        var term = String(t.term == null ? "" : t.term);
        var def = String(t.def == null ? "" : t.def);
        var key = term.trim().toLowerCase();
        if (key && Object.prototype.hasOwnProperty.call(pos, key)) {
          out[pos[key]].def = def; // duplicate term -> update definition (later wins)
        } else {
          if (key) pos[key] = out.length;
          out.push({ term: term, def: def });
        }
      });
      return out;
    }
    window.mergeGlossaryTerms = mergeGlossaryTerms;
    // Pure CSV -> [{term,def}] parse for the glossary import (extracted so tests/run.js can
    // guard it headlessly). Skips a leading header row (first cell = term/abbr/acronym/…),
    // trims cells, and drops wholly-empty rows.
    function parseGlossaryCsv(text) {
      var rows = (window.CSVBind && window.CSVBind.parseCSV) ? window.CSVBind.parseCSV(String(text)) : [];
      if (!rows.length) return [];
      var start = 0;
      var h0 = String(rows[0][0] == null ? "" : rows[0][0]).trim().toLowerCase();
      if (h0 === "term" || h0 === "abbreviation" || h0 === "abbr" || h0 === "acronym" || h0 === "word") start = 1;
      var out = [];
      for (var i = start; i < rows.length; i++) {
        var term = String(rows[i][0] == null ? "" : rows[i][0]).trim();
        var def = String(rows[i][1] == null ? "" : rows[i][1]).trim();
        if (term || def) out.push({ term: term, def: def });
      }
      return out;
    }
    window.parseGlossaryCsv = parseGlossaryCsv;

    kernel.expose({
      pushLayer: pushLayer, popLayer: popLayer, openSettingsModal: openSettingsModal,
      closeSettingsModal: closeSettingsModal, openSettingsSection: openSettingsSection, openSelectionSettings: openSelectionSettings,
      renderSettingsBody: renderSettingsBody, refreshSettingsPanes: refreshSettingsPanes, getSettingsSections: getSettingsSections,
      wireScrollEdges: wireScrollEdges, glossaryTerms: glossaryTerms, buildGlossaryBody: buildGlossaryBody,
      buildMotionBody: buildMotionBody, buildBackupBody: buildBackupBody
    });
  }

  window.VersoSettingsSheet = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoSettingsSheet;
})();
