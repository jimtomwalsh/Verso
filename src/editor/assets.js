// editor/assets.js -- everything insertable, and the store behind it (arch-P3b-07h).
//
// Two halves that are one idea. The TAB is the author's shelf: every block type and every shared
// component, grouped, searchable, either clicked to insert at the current place or dragged onto
// the canvas. The SEAM is what makes the shelf's contents survive: an uploaded image, video or
// font is content-addressed in the asset store and referenced by id, never by a path into a
// folder that will not exist on the next machine.
//
// One flat LIBRARY table drives the shelf, and its INDEX is the drag payload -- which is why the
// order is stable and why an entry is appended rather than inserted when a new type ships.
//
// The seam is also where a course's assets are swept: a package export walks the document for the
// ids it actually references, so a course that dropped an image does not ship it. That sweep is
// the reason the store can be shared across courses without growing without bound.
//
// The left panel's three sections (Structure / Blocks / Source) switch here too, because the
// switch is what decides whether this shelf is the visible one at all.
//
// The SOURCE-LINK glue that shared this banner -- placing linked copy, alternates, where-used --
// is a different concern and moved to editor/source-link.js.
//
// Editor chrome only: it inserts into the document, and renders none of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "registry", "confirmModal", "Store", "setDragPayload", "setCurrentPage",
      "BLOCK_LUCIDE", "clearDropMarks", "paletteAllowsType", "getComponents", "clone", "libComponents",
      "mintId", "insertPageFromLibrary", "getBlockPageIndexAndIndex", "findBlockParent", "pushHistory", "stampRoleStyle",
      "reapplyStructural", "findPageOfBlock", "setActivePage", "focusFrame", "reselectBlockNode", "renderEditSourcePanel",
      "storageBackend", "saveRegistry", "mount", "selection", "__sourceLinkDropAt", "doc",
      "currentPage"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        registry = E.registry,
        confirmModal = E.confirmModal,
        Store = E.Store,
        setDragPayload = E.setDragPayload,
        setCurrentPage = E.setCurrentPage,
        BLOCK_LUCIDE = E.BLOCK_LUCIDE,
        clearDropMarks = E.clearDropMarks,
        paletteAllowsType = E.paletteAllowsType,
        getComponents = E.getComponents,
        clone = E.clone,
        libComponents = E.libComponents,
        mintId = E.mintId,
        insertPageFromLibrary = E.insertPageFromLibrary,
        getBlockPageIndexAndIndex = E.getBlockPageIndexAndIndex,
        findBlockParent = E.findBlockParent,
        pushHistory = E.pushHistory,
        stampRoleStyle = E.stampRoleStyle,
        reapplyStructural = E.reapplyStructural,
        findPageOfBlock = E.findPageOfBlock,
        setActivePage = E.setActivePage,
        focusFrame = E.focusFrame,
        reselectBlockNode = E.reselectBlockNode,
        renderEditSourcePanel = E.renderEditSourcePanel,
        storageBackend = E.storageBackend,
        saveRegistry = E.saveRegistry,
        mount = E.mount;

    // ---- Assets tab: the library of insertable block/component types ----------
    // This is where everything draggable/insertable converges. For now items are
    // click-to-insert (append to the focused page); drag-drop is M7.5.
    // Flat list (index = dragPayload.makeIndex, kept stable), grouped in the panel
    // by `group` into collapsible sections.
    var LIBRARY = [
      { group: "Text", icon: "H", label: "Heading", make: function () { return { type: "heading", text: "New heading" }; } },
      { group: "Text", icon: "h", label: "Subheading", make: function () { return { type: "subheading", text: "New subheading" }; } },
      { group: "Text", icon: "¶", label: "Paragraph", make: function () { return { type: "paragraph", text: "New paragraph of body copy." }; } },
      { group: "Text", icon: "❝", label: "Quote", make: function () { return { type: "quote", text: "A pulled quote." }; } },
      { group: "Text", icon: "•", label: "Bulleted list", make: function () { return { type: "list", text: "<li>First item</li><li>Second item</li>" }; } },
      { group: "Text", icon: "!", label: "Note / callout", make: function () { return { type: "note", text: "Note / callout text." }; } },
      { group: "Media", icon: "▦", label: "Image", make: function () { return { type: "image", src: "", alt: "" }; } },
      { group: "Media", icon: "</>", label: "HTML Interaction", make: function () { return { type: "htmlEmbed", height: 420, align: "center" }; } },
      { group: "Media", icon: "▶", label: "Web Embed", make: function () { return { type: "webEmbed", url: "" }; } },
      { group: "Media", icon: "◎", label: "Image hotspots", make: function () { return { type: "hotspot", entry: "scr-entry", screens: [{ id: "scr-entry", visual: "", kind: "image", alt: "", markers: [] }] }; } },
      { group: "Layout", icon: "▭", label: "Card (container)", make: function () { return { type: "frame", padding: 20, radius: 12, border: false, children: [{ type: "subheading", text: "Card title" }, { type: "paragraph", text: "Card body text." }] }; } },
      // #94: place an EMPTY multi-column container up front, then drop content into each
      // column. Defaults to 2 equal empty columns; render.js shows an empty-column drop
      // slot per column (mirrors the empty-frame/-group placeholders) and the editor
      // wires each empty column as an intoColumn drop target.
      { group: "Layout", icon: "▥", label: "Columns", make: function () { return { type: "columns", explicit: true, columns: [[], []] }; } },
      // #90: native table. rows = array of rows; each row an array of cell objects { t }.
      { group: "Layout", icon: "▦", label: "Table", make: function () { return { type: "table", header: true, borders: "all", zebra: false, cellPad: 10, align: [], rows: [[{ t: "Column 1" }, { t: "Column 2" }, { t: "Column 3" }], [{ t: "" }, { t: "" }, { t: "" }], [{ t: "" }, { t: "" }, { t: "" }]] }; } },
      { group: "Layout", icon: "—", label: "Divider", make: function () { return { type: "divider", spaceTop: 60, spaceBottom: 60 }; } },
      { group: "Layout", icon: "↕", label: "Spacer", make: function () { return { type: "spacer", height: 40 }; } },
      { group: "Layout", icon: "▤", label: "Accordion / Tabs", make: function () { return { type: "accordion", mode: "accordion", items: [{ title: "Section 1", children: [{ type: "paragraph", text: "Section content." }] }, { title: "Section 2", children: [{ type: "paragraph", text: "Section content." }] }] }; } },
      { group: "Layout", icon: "▦", label: "Card Reveal", make: function () { return { type: "cardReveal", cols: 4, gap: 24, hint: "Hold to reveal", items: [1, 2, 3, 4].map(function (n) { return { children: [{ type: "heading", text: "Card " + n }, { type: "paragraph", text: "Hidden detail revealed on hover." }] }; }) }; } },
      { group: "Layout", icon: "▸", label: "Sequence (process / timeline)", make: function () { return { type: "sequence", spine: "numbered", orient: "vertical", reveal: "scroll", items: [1, 2, 3].map(function (n) { return { title: "Step " + n, children: [{ type: "paragraph", text: "Describe step " + n + "." }] }; }) }; } },
      { group: "Layout", icon: "❐", label: "Card Deck (carousel)", make: function () { return { type: "cardDeck", items: [1, 2].map(function (n) { return { label: "", children: [{ type: "heading", text: "Card " + n + " title" }, { type: "paragraph", text: "Card body text — drop any blocks in here." }] }; }) }; } },
      { group: "Interactive", icon: "→", label: "Navigation button", make: function () { return { type: "navButton", text: "Continue", action: {} }; } },
      { group: "Interactive", icon: "☑", label: "Acknowledge / Checkbox", make: function () { return { type: "checkbox", label: "I acknowledge / understand this." }; } },
      { group: "Interactive", icon: "?", label: "Quiz (knowledge check)", make: function () { return {
        type: "quiz",
        kicker: "Knowledge Check",
        title: "Chapter knowledge check",
        intro: { on: false, body: "Answer the questions to check your understanding.", startLabel: "Start" },
        settings: { shuffleQuestions: false, shuffleOptions: false },
        questions: [
          { id: "q" + Date.now(), type: "multipleChoice", methodLabel: "Select the answer", prompt: "Type your question here?", options: [ { text: "Correct answer", correct: true }, { text: "Wrong answer", correct: false }, { text: "Another wrong answer", correct: false } ], feedbackCorrect: "<strong>Correct.</strong> Explain why this is right.", feedbackIncorrect: "Give a hint and point to the material to review." },
          { id: "q" + (Date.now() + 1), type: "fillBlank", methodLabel: "Complete the sentence", stemBefore: "This step is important because", stemAfter: "", options: [ { text: "it has no real effect", correct: false }, { text: "it directly supports the topic being covered", correct: true }, { text: "it only matters in rare cases", correct: false } ], feedbackCorrect: "<strong>Correct.</strong> Explain why this is right.", feedbackIncorrect: "Give a hint and point to the material to review." }
        ],
        done: { title: "Knowledge Check Complete", body: "All questions answered correctly. Continue to the next section.", retry: { on: false, label: "Try again" } }
      }; } },
      { group: "Components", icon: "◆", label: "Chapter Card grid", make: function () { return { type: "componentGrid", component: "chapter-card", className: "card-grid", instances: [{ status: "incomplete", slots: { number: "00", title: "New Chapter", objective: "Objective text." } }] }; } }
    ];
    var ASSET_GROUP_KEY = "authoring.assetGroupsCollapsed";
    function collapsedGroups() { try { return JSON.parse(localStorage.getItem(ASSET_GROUP_KEY)) || {}; } catch (e) { return {}; } }
    function setGroupCollapsed(g, collapsed) { var c = collapsedGroups(); if (collapsed) c[g] = 1; else delete c[g]; try { localStorage.setItem(ASSET_GROUP_KEY, JSON.stringify(c)); } catch (e) {} }
    // Issue #13: the Blocks palette can lay out as a scannable icon GRID (DS default)
    // or a labelled LIST — persisted, toggled by the DS SegmentedControl in the head.
    var PALETTE_VIEW_KEY = "authoring.palette.view";
    function paletteView() { try { return localStorage.getItem(PALETTE_VIEW_KEY) === "list" ? "list" : "grid"; } catch (e) { return "grid"; } }
    function setPaletteView(v) { try { localStorage.setItem(PALETTE_VIEW_KEY, v === "list" ? "list" : "grid"); } catch (e) {} }
    // The Lucide glyph for a LIBRARY entry, derived from the block it inserts (cached).
    function libLucide(item) {
      if (item.__lucide) return item.__lucide;
      var t = null; try { t = item.make().type; } catch (e) {}
      return (item.__lucide = (BLOCK_LUCIDE[t] || "square"));
    }
    // Build ONE palette entry from the canonical control set: a BlockTile (grid) or a
    // BlockPaletteItem (list). Re-skin only — the click-to-insert + drag-to-canvas
    // wiring is attached to the returned element exactly as before.
    function paletteEntry(view, opts) {
      var U = window.VersoUI, el;
      if (view === "grid" && U && U.BlockTile) el = U.BlockTile({ icon: opts.icon, label: opts.gridLabel || opts.label, draggable: !!opts.dragData, onClick: opts.onInsert });
      else if (U && U.BlockPaletteItem) el = U.BlockPaletteItem({ icon: opts.icon, label: opts.label, draggable: !!opts.dragData, onClick: opts.onInsert });
      else { el = h("div", "asset-item"); el.appendChild(h("span", "asset-item__icon")); el.appendChild(h("span", "asset-item__name", opts.label)); el.addEventListener("click", opts.onInsert); }
      // issue 105: a grid tile's label is single-line + ellipsised, so its tooltip must be the
      // FULL label (what got truncated) rather than the generic insert hint; the list view,
      // whose label never truncates, keeps the hint.
      if (view === "grid" && opts.label != null) el.title = String(opts.label);
      else if (opts.title) el.title = opts.title;
      if (opts.dragData) {
        el.setAttribute("draggable", "true");
        el.addEventListener("dragstart", function (e) {
          setDragPayload(opts.dragData());
          e.dataTransfer.effectAllowed = "copy";
          try { e.dataTransfer.setData("text/plain", ""); } catch (_) {}
          document.body.classList.add("is-dragging-block");
        });
        el.addEventListener("dragend", function () {
          clearDropMarks(); setDragPayload(null); document.body.classList.remove("is-dragging-block");
        });
      } else {
        el.removeAttribute("draggable");
      }
      return el;
    }
    // Kept for compatibility: a single LIBRARY entry in the current view.
    function makeAssetRow(item, idx) {
      return paletteEntry(paletteView(), {
        icon: libLucide(item), label: item.label, gridLabel: item.label.split(" (")[0],
        title: "Click to add, or drag into the Structure panel / a canvas page",
        onInsert: function () { insertBlock(item.make()); },
        dragData: function () { return { kind: "insert", makeIndex: idx }; }
      });
    }
    function renderAssets() {
      var view = paletteView();
      var U = window.VersoUI;
      // The grid/list toggle lives in the "Insert" section head (DS SegmentedControl).
      var toggleHost = document.getElementById("palette-view-toggle");
      if (toggleHost) {
        toggleHost.innerHTML = "";
        if (U && U.SegmentedControl) {
          toggleHost.appendChild(U.SegmentedControl({
            size: "sm", value: view,
            options: [{ value: "grid", icon: "layout-grid", title: "Grid" }, { value: "list", icon: "list", title: "List" }],
            onChange: function (v) { setPaletteView(v); renderAssets(); renderComponentsPalette(); }
          }));
        }
      }
      var list = document.getElementById("assets-list");
      list.innerHTML = "";
      var collapsed = collapsedGroups();
      // A group's body: a BlockGrid (grid view) or a flat list (list view).
      function groupBody() {
        // issue 105: width-adaptive columns — the left dock is user-resizable (--left-w), so a
        // fixed 3-col grid balloons the tiles as the panel widens. auto-fill keeps each
        // tile at a stable target size and flexes the column count with the panel instead.
        if (view === "grid" && U && U.BlockGrid) return U.BlockGrid({ minColWidth: 84 });
        return h("div", "asset-group__list");
      }
      // SPEC 7: in a static cell, hide interactive block types from the library (existing blocks
      // are untouched -- this only gates what NEW content can be added).
      var cellInteractive = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(E.doc).interactive : true;
      var order = [], byGroup = {};
      LIBRARY.forEach(function (item, idx) {
        // A palette item's block type lives in item.make() (the item itself has no .type). Cache it
        // on first read, then gate on the cell: a static cell hides interactive types.
        if (item.__bt === undefined) item.__bt = item.type || (item.make ? (item.make() || {}).type : null);
        if (!paletteAllowsType(item.__bt, cellInteractive)) return; // static cell: skip interactive types
        var g = item.group || "Blocks";
        if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
        byGroup[g].push({ item: item, idx: idx });
      });
      order.forEach(function (g) {
        var det = h("details", "asset-group"); det.open = !collapsed[g];
        det.addEventListener("toggle", function () { setGroupCollapsed(g, !det.open); });
        var sum = h("summary", "asset-group__summary");
        sum.appendChild(h("span", "caret"));
        sum.appendChild(h("span", "asset-group__title", g));
        det.appendChild(sum);
        var body = groupBody();
        byGroup[g].forEach(function (entry) { body.appendChild(makeAssetRow(entry.item, entry.idx)); });
        det.appendChild(body);
        list.appendChild(det);
      });

    }
    // The "Components" left-pane twirl: the SOLE browse/insert surface for reusable
    // components (moved out of the Blocks palette, which used to carry "My Components" /
    // "Shared Library" as asset-groups here — see git history for the prior layout).
    // Three groups: My Components (course-local, copy-only), Blocks (shared cross-course
    // library, live-linked), Pages (shared cross-course page masters, live-linked).
    function renderComponentsPalette() {
      var view = paletteView();
      var U = window.VersoUI;
      var list = document.getElementById("components-palette-list");
      if (!list) return;
      list.innerHTML = "";
      var collapsed = collapsedGroups();
      function groupBody() {
        if (view === "grid" && U && U.BlockGrid) return U.BlockGrid({ minColWidth: 84 });
        return h("div", "asset-group__list");
      }
      function renderGroup(title, rows, emptyHint) {
        if (!rows.length && !emptyHint) return;
        var det = h("details", "asset-group"); det.open = !collapsed[title];
        det.addEventListener("toggle", function () { setGroupCollapsed(title, !det.open); });
        var sum = h("summary", "asset-group__summary");
        sum.appendChild(h("span", "caret"));
        sum.appendChild(h("span", "asset-group__title", title));
        det.appendChild(sum);
        if (rows.length) {
          var body = groupBody();
          rows.forEach(function (row) { body.appendChild(row); });
          det.appendChild(body);
        } else {
          det.appendChild(h("div", "asset-empty", emptyHint));
        }
        list.appendChild(det);
      }

      // user-saved composed components (from "Save as component") — course-local, copy-only
      var comps = getComponents();
      var composedRows = Object.keys(comps).filter(function (k) { return comps[k].kind === "composed"; }).map(function (k) {
        var comp = comps[k];
        return paletteEntry(view, {
          icon: "component", label: comp.name, title: "Click to insert a copy",
          onInsert: function () { insertBlock(clone(comp.template)); }
        });
      });
      renderGroup("My Components", composedRows);

      // SHARED component library (cross-course single-source). Composed components only: a
      // slot-def carries a `render` FUNCTION, which JSON can't serialise, so only
      // template-based (composed) defs survive the library round-trip. Insert places a
      // LIVE-LINKED libraryInstance wrapper (edit the master, every placement updates) —
      // "My Components" above stays copy-only, since it has no cross-course concern. Use
      // the block inspector's Detach action to convert a placement into an independent,
      // editable copy. ALWAYS rendered (even when empty) so the feature is DISCOVERABLE.
      var lib = libComponents();
      var libBlockRows = Object.keys(lib).filter(function (k) { return lib[k] && lib[k].kind === "composed" && lib[k].template; }).map(function (k) {
        var comp = lib[k];
        return paletteEntry(view, {
          icon: "component", label: comp.name || k, title: "Insert a live-linked instance from the shared cross-course library — editing the master updates every placement",
          onInsert: function () { insertBlock({ type: "libraryInstance", id: mintId(), ref: k }); }
        });
      });
      renderGroup("Blocks", libBlockRows, "No shared components yet. Design a block, then use “Save as component” and “Save to library” (document panel) to reuse it across courses.");

      // shared library PAGE masters — same live-linked model as Blocks above, one page at a
      // time. Inserting places a new page right after the current one (insertPageFromLibrary).
      var libPageRows = Object.keys(lib).filter(function (k) { return lib[k] && lib[k].kind === "page"; }).map(function (k) {
        var comp = lib[k];
        return paletteEntry(view, {
          icon: "file-text", label: comp.name || k, title: "Insert a new page from this shared page master — editing the master updates every placement",
          onInsert: function () { insertPageFromLibrary(k); }
        });
      });
      renderGroup("Pages", libPageRows, "No shared pages yet. Use “Save page to library…” (page Inspector or right-click) to reuse a page across courses.");
    }
    // FFFF: new/pasted blocks drop AFTER the selected top-level block on the current
    // page (so an insert lands where you are working), else append at the bottom.
    function insertAfterIndex(page) {
      if (E.selection && E.selection.block) {
        var loc = getBlockPageIndexAndIndex(E.selection.block);
        if (loc && loc.pageIndex === E.currentPage && page.blocks[loc.blockIndex] === E.selection.block)
          return loc.blockIndex + 1;
      }
      return page.blocks.length;
    }
    // Resolve WHERE a new/pasted block should land: into the selected block's OWN
    // container (nested — e.g. a hotspot popover card, a columns cell, a group), right
    // after it; else the bottom of the current page. This lets you insert/paste INTO
    // a hotspot card by first selecting a block inside it (findBlockParent descends
    // hotspots[].blocks). Returns the actual array + index to splice at.
    function insertLoc() {
      var page = E.doc.pages[E.currentPage];
      if (E.selection && E.selection.block) {
        var loc = findBlockParent(page.blocks, E.selection.block);
        if (loc) return { array: loc.parentArray, index: loc.index + 1 };
      }
      return { array: page.blocks, index: page.blocks.length };
    }
    function insertBlock(block) {
      pushHistory(); // DDD: was undoable-gap — inserting a block from the palette couldn't be undone
      stampRoleStyle(block); // #145: auto-link a dropped text block (+ its children) to its type's theme role style
      // #161 part 1: a source-link drop targets an explicit between-block gap (the drop-line the drag
      // showed), not the selection-based insertLoc. __sourceLinkDropAt is set only for the duration of a
      // source-link placement and auto-advances so a format-split's multiple blocks stack in order.
      var L;
      if (E.__sourceLinkDropAt && E.doc.pages[E.__sourceLinkDropAt.pageIndex]) {
        var tp = E.doc.pages[E.__sourceLinkDropAt.pageIndex];
        L = { array: tp.blocks, index: Math.max(0, Math.min(E.__sourceLinkDropAt.index, tp.blocks.length)) };
        E.setCurrentPage(E.__sourceLinkDropAt.pageIndex);
        E.__sourceLinkDropAt.index = L.index + 1; // the next block in this placement lands after this one
      } else {
        L = insertLoc();
      }
      L.array.splice(L.index, 0, block);
      reapplyStructural(findPageOfBlock(block)); // PERF: one page, not the world
      setActivePage(E.currentPage);
      focusFrame(E.currentPage);
      reselectBlockNode(block, "block"); // select the new block so repeated inserts stack after it
    }
    // SPEC 7 (decision 11): the left panel is a single 3-way switcher -- Structure . Blocks .
    // Source -- with equal billing (Source insertion is a primary use now, not a bolt-on). Each
    // .lpane carries data-lsec; the active section's pane(s) show and the rest drop out. Components
    // folds INTO Blocks (James's call), so the Blocks section shows the Insert palette with the
    // Reusable-components pane beneath it. The last-active section persists across reloads.
    var LEFT_SECTIONS = ["structure", "blocks", "source"];
    var LEFT_SECTION_KEY = "authoring.lpane.active";
    var _activeLeftSection = "structure";
    // Which section the left panel is showing. Two other regions ask -- the stage switch re-applies
    // it, and the source-link glue repaints its panel only when Source is the visible one -- so it
    // crosses as a question rather than as a variable (arch-P3b-07h).
    function activeLeftSection() { return _activeLeftSection; }
    function applyLeftSection(sec) {
      if (LEFT_SECTIONS.indexOf(sec) === -1) sec = "structure";
      _activeLeftSection = sec;
      try { localStorage.setItem(LEFT_SECTION_KEY, sec); } catch (e) {}
      var panel = document.querySelector(".panel--left"); if (!panel) return;
      Array.prototype.forEach.call(panel.querySelectorAll(".lpane[data-lsec]"), function (el) {
        el.hidden = el.getAttribute("data-lsec") !== sec;
      });
      mountLeftSwitcher(); // re-render so the active segment reflects the state (also on programmatic switches)
      if (sec === "source") renderEditSourcePanel();
    }
    function mountLeftSwitcher() {
      var host = document.getElementById("lpane-switch"); if (!host) return;
      var U = window.VersoUI; if (!U || !U.SegmentedControl) return;
      host.innerHTML = "";
      host.appendChild(U.SegmentedControl({
        size: "sm",
        options: [{ value: "structure", label: "Structure" }, { value: "blocks", label: "Blocks" }, { value: "source", label: "Source" }],
        value: _activeLeftSection,
        onChange: function (v) { applyLeftSection(v); }
      }));
    }

    function wireLeftSwitcher() {
      renderAssets();
      renderComponentsPalette();
      try { var saved = localStorage.getItem(LEFT_SECTION_KEY); if (LEFT_SECTIONS.indexOf(saved) !== -1) _activeLeftSection = saved; } catch (e) {}
      applyLeftSection(_activeLeftSection);
    }

    // ---- Asset store seam glue (YY) ------------------------------------------
    var ASSET_SCHEMA = 1;
    function editorAssetResolve(id) {
      return window.AssetStore ? window.AssetStore.url(id) : null;
    }
    // .verso project export (#67) — the portable authoring artifact (doc + its media),
    // distinct from SCORM (published output) and the self-contained Export JSON. Media
    // stays as asset:<id> refs in doc.json; each referenced asset is packed raw so ids
    // (content hashes) survive the round-trip and refs re-resolve on import.
    function collectDocAssetRefs(d) {
      var out = {};
      if (window.resolveMedia && window.AssetStore) {
        var undo = window.resolveMedia(d, function (id) {
          if (!out[id]) { var a = window.AssetStore.get(id); if (a) out[id] = { dataUrl: a.dataUrl, mime: a.mime }; }
          return null; // return null -> leave the ref untouched; we only collect
        });
        if (typeof undo === "function") undo();
      }
      return out;
    }
    // targetDoc lets the file browser (#74) export a specific course; the pipeline
    // button passes no doc (its onClick may hand us an event), so only honour an arg
    // that actually looks like a doc — otherwise fall back to the active `doc`.
    function exportVersoPackage(targetDoc) {
      var src = (targetDoc && targetDoc.meta && targetDoc.pages) ? targetDoc : E.doc;
      try {
        if (!window.VersoFormat) throw new Error("The .verso packer isn't loaded.");
        var d = JSON.parse(JSON.stringify(src)); // keep asset:<id> refs (not inlined)
        var assets = collectDocAssetRefs(d);
        var bytes = window.VersoFormat.buildPackage(d, assets, {});
        var blob = new Blob([bytes], { type: "application/zip" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = String((src.meta && src.meta.code) || "course").replace(/[^\w.-]+/g, "_") + ".verso";
        document.body.appendChild(a); a.click(); a.remove();
        if (window.console && console.log) console.log("[export] .verso built (" + Object.keys(assets).length + " assets, " + bytes.length + " bytes)");
      } catch (e) {
        if (window.console && console.error) console.error("[export] .verso failed:", e);
        confirmModal("Export failed", "Could not build the .verso package: " + (e && e.message || e), function () {});
      }
    }
    // #69 guarded cutover: the ONLY sanctioned way to move browser storage -> file
    // storage. Never flip authoring.storageBackend by hand (the 2026-07-12 clobber).
    // ASYNC because the live path awaits the native bridge (WKWebView replies): backup
    // EVERY course to a verified .verso up front (the HARD gate) -> suppress saves ->
    // write the registry to disk (awaited) -> read it BACK FROM DISK and verify -> flip
    // the flag -> controlled reload (saves stay suppressed through it; a fresh boot resets
    // the guard). Fails safe at every stage: any abort leaves the browser store
    // authoritative and untouched, and resumes saves (rollback = flip the flag back).
    // // Dependency-injected so the harness drives the whole flow against fakes (async
    // nativeStore + setFlag/reload) with no real data. The LIVE deps come from
    // window.__nativeStore (store-native.js glue over the Swift bridge) -> the app-rebuild
    // test boundary (issue #68/#69). Returns { ok, flip, stage, error?, codes? }.
    async function migrateToFileBackend(opts) {
      opts = opts || {};
      var log = opts.log || function (m) { if (window.console && console.log) console.log("[migrate] " + m); };
      function fail(stage, error) { log("aborted at " + stage + ": " + error); return { ok: false, flip: false, stage: stage, error: error }; }
      // HARD precondition: must start from the browser backend holding the real registry.
      var backend = opts.backend || storageBackend();
      if (backend !== "browser") return fail("precondition", "not on the browser backend (already " + backend + ")");
      // The native store glue must be present (Swift bridge). Absent in a plain browser.
      var ns = opts.nativeStore || window.__nativeStore;
      if (!ns) return fail("precondition", "native file storage is not available on this build (rebuild the desktop app)");
      var browserAdapter = opts.browserAdapter || Store.browserAdapter;
      var browserLibAdapter = opts.browserLibraryAdapter || Store.browserAdapter;
      var putRegistry = opts.putRegistry || ns.putRegistry;
      var getRegistry = opts.getRegistry || ns.getRegistry;
      var putLibrary = opts.putLibrary || ns.putLibrary;
      var getLibrary = opts.getLibrary || ns.getLibrary;
      var reload = opts.reload || ns.reload || function () { location.reload(); };
      if (!putRegistry || !getRegistry) return fail("precondition", "native store is missing put/getRegistry");
      // #18: the library rides the SAME guarded cutover as the registry, so the native
      // store must support both -- a half-capable build never leaves the library behind.
      if (!putLibrary || !getLibrary) return fail("precondition", "native store is missing put/getLibrary");

      // Read the authoritative sources (never mutated here). The library is OPTIONAL --
      // a fresh install may have no shared components yet, unlike the registry.
      var srcJson;
      try { srcJson = browserAdapter.readRegistry(); } catch (e) { return fail("read", "browser read threw: " + (e && e.message || e)); }
      if (!srcJson) return fail("read", "browser registry is empty");
      var src; try { src = JSON.parse(srcJson); } catch (e) { return fail("read", "browser registry unparseable"); }
      var codes = Object.keys(src);
      if (!codes.length) return fail("read", "no courses in browser registry");
      var libJson;
      try { libJson = browserLibAdapter.readLibrary(); } catch (e) { return fail("read", "browser library read threw: " + (e && e.message || e)); }

      // 1. BACKUP GATE (awaited, verified on disk) BEFORE any target write or suppression.
      var backup = opts.backup ? opts.backup(src) : window.Migration.runBackupsAsync(src, {
        versoFormat: window.VersoFormat, collectAssets: collectDocAssetRefs,
        writeFile: ns.writeFile, verifySize: ns.verifySize,
        tsLabel: opts.tsLabel || (ns.tsLabel && ns.tsLabel())
      });
      var bk; try { bk = await backup; } catch (e) { return fail("backup", "backup threw: " + (e && e.message || e)); }
      if (!bk || !bk.ok) return fail("backup", (bk && bk.error) || "backup failed");
      if (bk.count !== codes.length) return fail("backup", "backup incomplete: " + bk.count + "/" + codes.length + " courses");
      log("backup verified: " + bk.count + " course(s) -> " + bk.dir);

      // 1b. Back up the shared library too (same pre-cutover dir, plain JSON, verified
      // written) -- skipped only when there is nothing to back up (no library yet).
      if (libJson) {
        var libBackup = opts.backupLibrary ? opts.backupLibrary(libJson, bk.dir) : (function () {
          var path = bk.dir + "library.json";
          return Promise.resolve(ns.writeFile(path, (new TextEncoder()).encode(libJson))).then(function (bw) {
            if (!bw || !bw.ok) return { ok: false, error: (bw && bw.error) || "library backup write failed" };
            return Promise.resolve(ns.verifySize(path)).then(function (sz) {
              return (sz > 0) ? { ok: true, path: path } : { ok: false, error: "library backup verify failed (not on disk)" };
            });
          });
        })();
        var lbk; try { lbk = await libBackup; } catch (e) { return fail("backup", "library backup threw: " + (e && e.message || e)); }
        if (!lbk || !lbk.ok) return fail("backup", "library: " + ((lbk && lbk.error) || "backup failed"));
        log("library backup verified -> " + lbk.path);
      }

      // 2. SUPPRESS SAVES for the whole switch (no stale flush can land).
      window.Migration.suppress();
      // 3. WRITE the registry to disk and AWAIT the durable-write confirmation.
      var w; try { w = await putRegistry(srcJson); } catch (e) { window.Migration.resume(); return fail("write", "registry write threw: " + (e && e.message || e)); }
      if (!w || !w.ok) { window.Migration.resume(); return fail("write", (w && w.error) || "registry disk write failed"); }
      // 4. VERIFY: read the registry BACK FROM DISK; abort (resume) on any drift.
      var back; try { back = await getRegistry(); } catch (e) { window.Migration.resume(); return fail("verify", "registry read-back threw: " + (e && e.message || e)); }
      var v = window.Migration.verifyRegistries(srcJson, back);
      if (!v.ok) { window.Migration.resume(); return fail("verify", v.reason); }
      log("verified " + v.count + " course(s) on disk");

      // 3b/4b. WRITE + VERIFY the shared library too, in the SAME suppression window --
      // either both the registry and the library land on disk, or neither does (the flag
      // never flips), so the two content types can never straddle backends.
      if (libJson) {
        var lw; try { lw = await putLibrary(libJson); } catch (e) { window.Migration.resume(); return fail("write", "library write threw: " + (e && e.message || e)); }
        if (!lw || !lw.ok) { window.Migration.resume(); return fail("write", "library: " + ((lw && lw.error) || "library disk write failed")); }
        var libBack; try { libBack = await getLibrary(); } catch (e) { window.Migration.resume(); return fail("verify", "library read-back threw: " + (e && e.message || e)); }
        var lv = window.Migration.verifyLibrary(libJson, libBack);
        if (!lv.ok) { window.Migration.resume(); return fail("verify", "library: " + lv.reason); }
        log("verified " + lv.count + " library component(s) on disk");
      }

      // 5. FLIP the flag, then a controlled reload. Saves stay suppressed through it;
      // the fresh boot re-reads the on-disk registry (and library) and resets the guard.
      // The ONE sanctioned write of the backend flag, and it happens here: after a verified backup
      // of every course, with saves suppressed, and only once the registry (and the library) have
      // been read BACK from disk and matched. Never flip it by hand -- that is the 2026-07-12 clobber.
      var setFlag = opts.setFlag || function (vv) { Store.commitBackend(vv); };
      setFlag("file");
      log("flag flipped to file; reloading under the migrated store");
      await reload();
      return { ok: true, flip: true, stage: "done", codes: codes };
    }
    // The guarded entry point for the Export-overflow menu item: a DS confirm (reusing
    // confirmModal, not bespoke chrome) then the async cutover. On a stopped migration it
    // surfaces the stage/reason and reassures that nothing changed; on success the app
    // reloads under the file store, so there is nothing more to report.
    function migrateToFileBackendPrompt() {
      confirmModal("Migrate to file storage",
        "This first backs up EVERY course to a .verso, then moves storage (including your shared component library) from this browser to on-disk files and reloads. Your browser copy is kept as a read-only fallback. Continue?",
        function () {
          migrateToFileBackend({}).then(function (res) {
            if (res && !res.ok) confirmModal("Migration stopped",
              "Nothing was changed - you are still on browser storage.\n\nStopped at: " + res.stage + "\n" + (res.error || ""),
              function () {}, { okLabel: "OK" });
          });
        }, { okLabel: "Back up + migrate" });
    }
    // render.js resolves "asset:<id>" srcs through this hook at the point of use,
    // so EVERY editor render path (buildWorld, single-block re-render, demo,
    // inspector) shows media -- not just the ones wrapped in resolveMedia. Export
    // overrides doc media to base64 before it serialises, so this editor
    // (objectURL) resolver never leaks into the shipped package.
    window.applyRenderContext({ assetResolver: editorAssetResolve });
    // Upload sites call this instead of storing base64 on the doc: store the blob,
    // get back an "asset:<id>" ref. If the store is absent or the write fails
    // (quota), fall back to the inline data: URL so the media still shows (and XX's
    // save-state surfaces the failure).
    function assetRef(dataUrl, file) {
      var id = window.AssetStore ? window.AssetStore.put(dataUrl, { mime: (file && file.type) || "", name: (file && file.name) || null }) : null;
      return id ? "asset:" + id : dataUrl;
    }
    // Inspector code that inspects a media value OUTSIDE the render resolve-window
    // (e.g. SVG-palette colour detection) must see the real src, not the ref. SVG
    // assets resolve to a data: URL so detectSvgColorsFromSrc/isVectorSrc still work.
    function srcForInspect(v) {
      var m = typeof v === "string" && /^asset:(.+)$/.exec(v);
      return (m && window.AssetStore) ? window.AssetStore.url(m[1]) : v;
    }
    // The interaction's HTML for the inspector's palette detection: inline block.html, or
    // a bundled `src` decoded from its data URL (so the "Interaction colours" picker
    // appears for uploaded-file interactions too, not just pasted-inline ones).
    function embedHtmlForInspect(block) {
      // block.html may be an asset ref / data: URL / raw -> resolve to raw markup
      // so palette detection sees the real source, not "asset:<id>".
      if (block.html) return window.resolveEmbedHtml ? window.resolveEmbedHtml(block.html) : block.html;
      var s = srcForInspect(block.src);
      var m = typeof s === "string" && /^data:text\/html([^,]*),([\s\S]*)$/i.exec(s);
      if (!m) return "";
      try { return /base64/i.test(m[1]) ? decodeURIComponent(escape(atob(m[2]))) : decodeURIComponent(m[2]); }
      catch (_) { try { return atob(m[2]); } catch (_2) { return ""; } }
    }
    // #85: the inspector's colour palette needs the interaction's declared colour
    // vars, which means decoding the full markup (atob + decodeURIComponent) and
    // regex-parsing the ENTIRE HTML string. That ran on EVERY inspector render
    // (open + every re-render after a toggle) with no caching -> a 2-3s freeze for a
    // large interaction. Cache the detected vars per block, keyed on the block's
    // html/src so it only recomputes when the actual source changes.
    var _embedVarCache = new WeakMap();
    function embedColorVarsCached(block) {
      if (!window.detectEmbedColorVars) return [];
      var sig = block.html != null ? "h:" + block.html : "s:" + (block.src || "");
      var hit = _embedVarCache.get(block);
      if (hit && hit.sig === sig) return hit.vars;
      var vars = window.detectEmbedColorVars(embedHtmlForInspect(block));
      _embedVarCache.set(block, { sig: sig, vars: vars });
      return vars;
    }
    // Hoist legacy inline base64 media in every registry doc into the store, once
    // per doc. Non-destructive (migrateDocMedia keeps un-hoistable data: URLs), and
    // only stamps a doc migrated when ALL its media hoisted -> a partial pass retries
    // next boot. Called by persist.js after the store hydrates.
    function migrateAllAssets() {
      if (!window.AssetStore || !window.migrateDocMedia) return;
      var changed = false;
      Object.keys(registry).forEach(function (id) {
        var d = registry[id];
        if (!d || d.assetSchema === ASSET_SCHEMA) return;
        var res = window.migrateDocMedia(d, function (dataUrl) { return window.AssetStore.put(dataUrl, {}); });
        // Also drain any legacy RAW htmlEmbed markup that already bloated the doc
        // (pre-reroute stores) out to AssetStore, so an over-full registry recovers.
        var eres = window.migrateDocEmbedHtml ? window.migrateDocEmbedHtml(d, function (dataUrl) { return window.AssetStore.put(dataUrl, { mime: "text/html" }); }) : { migrated: 0, failed: 0 };
        if (res.failed === 0) d.assetSchema = ASSET_SCHEMA;
        if (res.migrated || eres.migrated) changed = true;
      });
      if (changed) saveRegistry(registry);
      // Always re-mount once after the store is ready: editor.js booted (and did its
      // first mount) BEFORE persist.js defined window.AssetStore, so any doc that
      // already held asset refs rendered blank on that first pass -- re-render now
      // that assetSrc can resolve, whether or not anything migrated this boot.
      mount();
    }
    // Mark-sweep: union asset refs across ALL registry docs (the store is shared),
    // then delete orphaned blobs. Called on unload.
    function sweepAllAssets() {
      if (!window.AssetStore || !window.collectAssetRefs) return;
      var ids = {};
      Object.keys(registry).forEach(function (id) {
        var d = registry[id];
        if (d) window.collectAssetRefs(d).forEach(function (a) { ids[a] = true; });
      });
      window.AssetStore.sweep(Object.keys(ids));
    }

    kernel.expose({
      assetRef: assetRef, editorAssetResolve: editorAssetResolve, srcForInspect: srcForInspect,
      embedColorVarsCached: embedColorVarsCached, sweepAllAssets: sweepAllAssets, migrateAllAssets: migrateAllAssets,
      migrateToFileBackendPrompt: migrateToFileBackendPrompt, exportVersoPackage: exportVersoPackage, renderAssets: renderAssets,
      renderComponentsPalette: renderComponentsPalette, insertBlock: insertBlock, insertLoc: insertLoc,
      applyLeftSection: applyLeftSection, activeLeftSection: activeLeftSection, wireLeftSwitcher: wireLeftSwitcher,
      // #69: the sanctioned, backup-gated browser->file cutover. The integration seam offers it to
      // the desktop shell, so it has to cross even though nothing in this file calls it.
      migrateToFileBackend: migrateToFileBackend
    });
    // Constants the rest of the chrome reads as DATA. They cannot cross as bound forwarders,
    // because bind() returns a function.
    kernel.provide({
      LIBRARY: LIBRARY
    });
  }

  window.VersoAssets = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoAssets;
})();
