// editor/board/builder.js -- the tour builder, the board you actually touch (arch-P3b-04).
//
// A full-screen overlay that lays a hotspot block's screen-graph out as a pannable, zoomable board
// of node cards: drag a pin to move a marker, drag a port to a node to link them, box-select,
// group-move, drop a loop frame around a carousel, scrub a source video and cut a segment out of
// it. The shipped hotspot inspector is RE-HOSTED in its right panel rather than reimplemented, so
// there is one property editor, not two.
//
// It renders and exports NOTHING. Node coordinates live on screens[].bx/by, which render() ignores,
// so the pure-render invariant holds: the board is a view of the document, never part of it.
//
// P3-06 moved the geometry (src/editor/board/layout.js) and the harvest maths
// (src/editor/board/harvest.js) and left 1,871 lines of DOM behind. This is that DOM.
//
// TWO THINGS WORTH KNOWING BEFORE CHANGING ANYTHING HERE.
//
//   1. `doc` is replaced wholesale by undo, redo, a programmatic setDoc or a collab frame, and the
//      board holds a live reference to one block inside it. Left alone, every edit after such a
//      swap lands on a detached copy and vanishes when the board closes -- which is exactly the
//      data loss GH #50 recorded. syncTourBoard re-binds tourBlock by ID into the new document,
//      and closes the board if the block is genuinely gone. That is why `doc` arrives here as a
//      live getter and never as a captured value.
//
//   2. hotspotEditId / hotspotEditScreenId are NOT this file's state. They are the hotspot
//      editor's selection, shared with the inline inspector that still lives in editor.js, and
//      the board both reads and writes them -- so they cross as an accessor pair rather than a
//      value. When the hotspots editor moves (P3b-06) they can go home; until then, pretending
//      they belong here would have made the board the owner of state it merely participates in.
//
// Editor chrome only.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // install(kernel) is called once, by editor.js, after it has provided its host surface.
  function install(kernel) {
    var E = kernel.need(
      // live: replaced or reassigned by something outside this file
      "doc", "inspector", "setInspector", "activeMode",
      "hotspotEditId", "setHotspotEditId", "hotspotEditScreenId", "setHotspotEditScreenId",
      // stable: function declarations and one constant, aliased below
      "h", "iconBtn", "switchEl", "panelSection", "pushHistory", "scheduleSave", "flushSave",
      "ensureId", "versionBaseNode", "editorAssetResolve", "renderHotspotInspector", "dsSelect",
      "activeTheme", "SVGNS", "reapplyStructural", "reselectBlockNode", "findPageOfBlock",
      "canvasNodeForBlock", "revealHotspot", "mintId", "renderInspector", "showContextMenu",
      "promptModal", "confirmModal", "clampPct", "clamp", "connectorPathD", "findHotspot",
      "segmentedIconLive", "clone", "sweepAllAssets", "writeModel", "assetRef"
    );
    // The stable half is aliased once. Every one of these is a function DECLARATION or a constant
    // that editor.js never reassigns, so the alias is the same object on every call and the moved
    // body reads exactly as it did -- which is what "extract by copy" is supposed to mean. The
    // reassigned bindings above are deliberately NOT aliased; they are read through E every time.
    var h = E.h, iconBtn = E.iconBtn, switchEl = E.switchEl, panelSection = E.panelSection,
        pushHistory = E.pushHistory, scheduleSave = E.scheduleSave, flushSave = E.flushSave,
        ensureId = E.ensureId, versionBaseNode = E.versionBaseNode,
        editorAssetResolve = E.editorAssetResolve, renderHotspotInspector = E.renderHotspotInspector,
        dsSelect = E.dsSelect, activeTheme = E.activeTheme, SVGNS = E.SVGNS,
        reapplyStructural = E.reapplyStructural, reselectBlockNode = E.reselectBlockNode,
        findPageOfBlock = E.findPageOfBlock, canvasNodeForBlock = E.canvasNodeForBlock,
        revealHotspot = E.revealHotspot, mintId = E.mintId, assetRef = E.assetRef,
        renderInspector = E.renderInspector, showContextMenu = E.showContextMenu,
        promptModal = E.promptModal, confirmModal = E.confirmModal, clampPct = E.clampPct,
        clamp = E.clamp, connectorPathD = E.connectorPathD, findHotspot = E.findHotspot,
        segmentedIconLive = E.segmentedIconLive, clone = E.clone,
        sweepAllAssets = E.sweepAllAssets, writeModel = E.writeModel;
    // Tour builder (#221/#222/#223 — hotspot tours T5a/T5b/T5c). A full-screen Verso
    // UI overlay that lays a hotspot block's screen-graph out as a pannable/zoomable
    // 2D board of node cards, with the SAME renderHotspotInspector re-hosted in a right
    // panel (the board never reinvents property editing). Built to the DSLMS board/
    // contracts (GraphBoard/ScreenNode/Edge/ConnectionPort). AUGMENTS the inline T2-T4
    // flow — it renders and exports NOTHING (node coords persist on screens[].bx/by,
    // which render() ignores, so render stays a pure function of the doc). Follows the
    // shipped .vbrowser overlay pattern (ensureBrowser/openBrowser/closeBrowser).
    var tourUI = null;              // { overlay, board, layer, edges, nodes, panelBody, bar:{...} } DOM refs
    var tourBlock = null;           // the live hotspot block being edited
    var tourZoom = 1, tourPanX = 0, tourPanY = 0;
    var tourFacesUp = false;        // T5c: every card popover open for bulk edit
    var tourConnect = null;         // T5b: active drag-to-connect { srcId, from }
    var tourPlacing = false;        // click-to-drop: "Add hotspot" armed -> next click on a screen drops a marker
    var tourPanelOpen = false;      // the Properties drawer: collapsed by default so the board dominates
                                    // (canvas-first); opened on demand for the deep value settings.
    var tourSelKind = null;         // the EXPLICIT board selection kind ('node'|'marker'|'loop') the pill
                                    // segment reflects — decoupled from hotspotEditId, which the re-hosted
                                    // panel auto-points at markers[0] even when a node is selected.
    var tourReturnFocus = null;     // focus return on close
    var tourNodeSel = [];           // multi-select: screen ids box/click-selected on the board
    var tourSpace = false;          // Space held (board pan modifier, mirrors the main canvas)
    var tourFaceCardPos = {};       // T5c: markerId -> { s, m, to } for leader wires (from = live pin pt)
    var tourThumbHMap = {};         // screenId -> measured thumb height (board px) for 1:1 pin geometry
    var tourHotMarker = null;       // marker whose card + leader wire are highlighted (select/hover)
    var tourLinkSel = null;         // T5b: the SELECTED edge (its source marker id) — decoupled from
                                    // hotspotEditId, which the re-hosted inspector always pins to a marker
    // Board geometry -> src/editor/board/layout.js (arch-P3-06). The metrics and every position
    // derived from them are the module's; these are the names the DOM code already uses.
    var BL = window.VersoBoardLayout;
    var TOUR_NODE_W = BL.METRICS.NODE_W, TOUR_THUMB_H = BL.METRICS.THUMB_H;
    var TOUR_SOURCE_W = BL.METRICS.SOURCE_W, TOUR_SOURCE_H = BL.METRICS.SOURCE_H;
    var TOUR_NOMINAL_W = BL.METRICS.NOMINAL_W;   // assumed learner screen width, for scaling point markers
    var TOUR_NODE_H = BL.METRICS.NODE_H;
    var tourLoopSel = null;         // #224 T6: the SELECTED loop frame id (its own selection lane)

    function tourBoardIsOpen() { return !!(tourUI && !tourUI.overlay.hidden); }
    // #224 QA: an ISOLATED preview of just this tour, so the author can test navigation +
    // loop carousels without leaving the builder or exporting the whole course. Renders the
    // live block through the SAME course renderer + runtime (renderBlockNode + bindHotspots),
    // themed like the canvas; it never round-trips the doc, so it can't drop unsaved state.
    var tourPreviewEl = null;
    function tourPreviewIsOpen() { return !!tourPreviewEl; }
    function closeTourPreview() { if (tourPreviewEl && tourPreviewEl.parentNode) tourPreviewEl.parentNode.removeChild(tourPreviewEl); tourPreviewEl = null; }
    function openTourPreview() {
      if (!tourBlock) return;
      if (window.normalizeHotspotLoops) window.normalizeHotspotLoops(tourBlock);
      closeTourPreview();
      var ov = h("div", "tourb-preview"); ov.id = "tourb-preview";
      var bar = h("div", "tourb-preview__bar");
      bar.appendChild(h("div", "tourb-preview__title", "Preview"));
      bar.appendChild(h("div", "tourb-preview__hint", "Test the tour: click hotspots, cycle loops with the arrows, Back to return."));
      bar.appendChild(h("div", "vbrowser__spacer"));
      var done = h("button", "vbrowser__btn vbrowser__btn--primary", "Close preview");
      done.addEventListener("click", closeTourPreview);
      bar.appendChild(done);
      var closeX = iconBtn("x", "Close preview (Esc)"); closeX.classList.add("vbrowser__close");
      closeX.addEventListener("click", closeTourPreview); bar.appendChild(closeX);
      ov.appendChild(bar);
      var body = h("div", "tourb-preview__body");
      var root = h("div", "course-root"); root.setAttribute("data-mode", E.activeMode);
      root.appendChild(window.renderBlockNode(tourBlock));
      body.appendChild(root); ov.appendChild(body);
      document.body.appendChild(ov);
      try { window.applyTheme(root, activeTheme()); } catch (_) {}
      try { if (window.CourseRuntime && window.CourseRuntime.bindHotspots) window.CourseRuntime.bindHotspots(root); } catch (_) {}
      tourPreviewEl = ov;
    }
    function screenVisualSrc(scr) {
      var v = scr && scr.visual;
      if (!v || typeof v !== "string") return null;
      if (v.indexOf("asset:") === 0) return editorAssetResolve(v.slice(6));
      return v;
    }
    function tourScreens() { return (tourBlock && Array.isArray(tourBlock.screens)) ? tourBlock.screens : []; }
    function tourScreenById(id) { var ss = tourScreens(); for (var i = 0; i < ss.length; i++) if (ss[i] && ss[i].id === id) return ss[i]; return null; }
    // #216: seed a new Marker. ONE source of truth for the panel "+ Add hotspot" and the
    // board click-to-drop, so the two can't drift. Action follows the block's authoring hint;
    // card blocks are seeded either way so a later mode flip has copy to show. Position is
    // passed in (panel cascades it 30->70%; click-to-drop uses the exact clicked x/y%).
    function tourMakeMarker(block, x, y) {
      return {
        id: "hs_" + Math.random().toString(36).slice(2, 8),
        x: x, y: y,
        action: (block && block.mode === "screen") ? "navigate" : "card",
        blocks: [ { type: "subheading", text: "Hotspot title" }, { type: "paragraph", text: "Describe what this point shows." } ]
      };
    }
    function tourEntryScreen() { return tourScreenById(tourBlock && tourBlock.entry) || tourScreens()[0] || null; }
    function tourScreenLabel(s, i) { return (s && s.name) || (s === tourEntryScreen() ? "Home" : "Screen " + i); }

    // ---- #224 T6: loop (screen-carousel) frames ----------------------------------------
    function tourLoops() { return (tourBlock && Array.isArray(tourBlock.loops)) ? tourBlock.loops : []; }
    function tourLoopById(id) { var ls = tourLoops(); for (var i = 0; i < ls.length; i++) if (ls[i] && ls[i].id === id) return ls[i]; return null; }
    // The loop a screen belongs to (a screen is a member of at most one loop), or null.
    function screenLoop(sid) { var ls = tourLoops(); for (var i = 0; i < ls.length; i++) if (ls[i] && (ls[i].screens || []).indexOf(sid) >= 0) return ls[i]; return null; }
    function tourLoopMembers(loop) { return (loop && loop.screens || []).map(tourScreenById).filter(Boolean); }
    function tourLoopLabel(loop, i) { return (loop && loop.name) || ("Loop " + ((i == null ? tourLoops().indexOf(loop) : i) + 1)); }
    function loopSize(loop) { return BL.loopSize(loop); }
    function loopSlotPos(loop, idx) { return BL.loopSlotPos(loop, idx); }
    function loopRect(loop) { return BL.loopRect(loop); }
    function ptInRect(px, py, r) { return BL.ptInRect(px, py, r); }
    // #224 QA: Cmd/Ctrl+T -> tidy. Snap the free (non-member) screen nodes into a clean grid
    // in their CURRENT rough reading order (row-banded by y, then x), then stack the loop
    // frames below. Members auto-arrange inside their frame, so they follow. Preserves the
    // author's general arrangement while removing overlap/drift.
    // #224 QA: Cmd/Ctrl+T -> tidy. The arrangement is planned by the module (a value, so the suite
    // can assert it); this pushes history, writes it and repaints.
    function tourTidyLayout() {
      if (!tourBlock) return;
      var plan = BL.tidyPlan(tourScreens(), tourLoops(), tourNodeSel);
      if (!plan.screens.length) return;
      pushHistory();
      BL.applyTidyPlan(plan, tourScreens(), tourLoops());
      scheduleSave(); renderTourNodes(); if (!plan.selecting) requestAnimationFrame(tourFit);
    }
    // Map every loop member's screen id -> its slot top-left, so renderTourNodes positions
    // members inside their frame (not at their own bx/by). Non-members use bx/by as before.
    function tourMemberSlots() { return BL.memberSlots(tourLoops()); }

    // Any screen missing board coords gets a grid slot, so an old block (or one authored
    // purely inline) lays out sensibly the first time the board opens.
    function autoLayoutTourCoords() { return BL.autoLayoutCoords(tourScreens()); }

    function ensureTourBuilder() {
      if (tourUI) return tourUI;
      var overlay = h("div", "vbrowser tourb"); overlay.id = "tour-builder"; overlay.hidden = true;
      // --- top bar (reuse the .vbrowser__bar strip) ---
      var bar = h("div", "vbrowser__bar tourb__bar");
      var title = h("div", "vbrowser__title", "Tour builder");
      bar.appendChild(title);
      var count = h("span", "tourb__count"); bar.appendChild(count);
      var spacer = h("div", "vbrowser__spacer"); bar.appendChild(spacer);
      // Top bar = the CREATIVE actions + overlay chrome. The board TOOLS (Tidy / Cards face-up /
      // zoom) live in a floating pill over the board (built below) — a true canvas-overlay-bar
      // mirror, so the board reads like the main editor canvas. Preview is the single accent
      // primary (DSLMS action-priority); Upload screens is a strong secondary.
      var upBtn = h("button", "vbrowser__btn", "Upload screens");
      upBtn.addEventListener("click", tourUploadScreens);
      bar.appendChild(upBtn);
      // Add source video = drop a scratch video onto the board to harvest screenshots/segments
      // from (author-time only; never ships). Playhead/in-out/harvest controls land in a later pass.
      var srcBtn = h("button", "vbrowser__btn", "Add source video");
      srcBtn.title = "Add a source video to harvest screens from (author-time scratch — never exported)";
      srcBtn.addEventListener("click", tourAddSource);
      bar.appendChild(srcBtn);
      // #224 T6: add a loop (screen-carousel) frame.
      var loopBtn = h("button", "vbrowser__btn", "Add loop");
      loopBtn.title = "Add a loop: a frame holding a set of screens the learner cycles forward/back";
      loopBtn.addEventListener("click", tourAddLoop);
      bar.appendChild(loopBtn);
      // Add hotspot = arm click-to-drop: the next click on a screen drops a marker where you
      // click (direct manipulation; no round-trip to the panel "+ Add"). Toggles is-armed.
      var addHsBtn = h("button", "vbrowser__btn tourb__addhs", "Add hotspot");
      addHsBtn.title = "Add hotspot: click a screen to drop a marker where you click (Esc to cancel)";
      addHsBtn.addEventListener("click", function () { tourSetPlacing(!tourPlacing); });
      bar.appendChild(addHsBtn);
      // Isolated preview: test THIS tour (nav + loop carousels) without leaving the builder.
      var prevBtn = h("button", "vbrowser__btn vbrowser__btn--primary", "Preview");
      prevBtn.title = "Test this tour in isolation";
      prevBtn.addEventListener("click", openTourPreview);
      bar.appendChild(prevBtn);
      // Properties drawer toggle: collapsed by default (canvas-first) — open it for the deep value
      // settings the pill/menus don't carry (colours, card padding, blend, alt, playback, nav labels).
      var propsBtn = h("button", "vbrowser__btn tourb__propsbtn");
      propsBtn.innerHTML = (window.Icon ? window.Icon("panel-left") : "") + "<span>Properties</span>";
      propsBtn.title = "Show / hide the properties panel";
      propsBtn.addEventListener("click", function () { tourSetPanelOpen(!tourPanelOpen); });
      bar.appendChild(propsBtn);
      var doneBtn = h("button", "vbrowser__btn", "Done");
      doneBtn.addEventListener("click", closeTourBuilder);
      bar.appendChild(doneBtn);
      var closeBtn = iconBtn("x", "Close (Esc)"); closeBtn.classList.add("vbrowser__close");
      closeBtn.addEventListener("click", closeTourBuilder);
      bar.appendChild(closeBtn);
      overlay.appendChild(bar);
      // --- body: board (left) + inspector (right) ---
      var body = h("div", "tourb__body");
      var board = h("div", "tourb__board");
      var layer = h("div", "tourb__layer");
      // Nodes first, the edge SVG LAST so connectors paint IN FRONT of the screen
      // previews — the line must visibly terminate at its pin so it's obvious which
      // hotspot is connected (James, 2026-07-23). Pins/ports keep an explicit z-index,
      // so they still sit on top of the line; the edge layer is pointer-events:none so
      // it never intercepts a node/pin/port drag (the DSLMS Edge "no-intercept" intent,
      // met by transparency to pointers rather than by painting underneath).
      // Loop frames sit BENEATH the nodes (a group frame, like the edge layer) so member
      // ScreenNodes paint inside them. Order in the layer: loops, then nodes, then edges on top.
      var loops = h("div", "tourb__loops"); layer.appendChild(loops);
      // Source-video scratch nodes (harvest surfaces): a distinct layer, beneath the screen
      // nodes. They live on tourBlock.sources[] and are excluded from render/export.
      var sources = h("div", "tourb__sources"); layer.appendChild(sources);
      var nodes = h("div", "tourb__nodes"); layer.appendChild(nodes);
      var edges = document.createElementNS(SVGNS, "svg"); edges.setAttribute("class", "tourb-edges");
      layer.appendChild(edges);
      board.appendChild(layer);
      // --- floating tool pill (a canvas-overlay-bar mirror, over the board) ---
      // Reuses the DSLMS raised-pill surface (.canvas-overlay-bar__inner / __sep / .icon-btn) so it
      // reads as the same product as the main canvas. Holds the board TOOLS (Tidy / Cards face-up /
      // zoom) and a trailing contextual actions segment (populated by the selection ticket).
      var pill = h("div", "tourb__pill");
      var pillInner = h("div", "canvas-overlay-bar__inner tourb__pill-inner");
      var tidyBtn = iconBtn("layout-grid", "Tidy layout: arrange screens into a grid (Cmd/Ctrl+T)");
      tidyBtn.addEventListener("click", tourTidyLayout); pillInner.appendChild(tidyBtn);
      var faceWrap = h("label", "tourb__switch"); pillInner.appendChild(faceWrap);
      tourBuildFaceSwitch(faceWrap);
      pillInner.appendChild(h("span", "canvas-overlay-bar__sep"));
      var zoom = h("div", "zoom tourb__zoom"); zoom.title = "Fit / actual size";
      var zlvl = h("span", "tourb__zoom-level", "100%"); zoom.appendChild(zlvl);
      var zcaret = h("span", "zoom__caret"); if (window.Icon) zcaret.innerHTML = window.Icon("chevron-down"); zoom.appendChild(zcaret);
      zoom.addEventListener("click", tourZoomCycle); pillInner.appendChild(zoom);
      // contextual selection-actions segment (appended on select, cleared on deselect — ticket 04).
      var pillActionsSep = h("span", "canvas-overlay-bar__sep canvas-overlay-bar__sep--actions"); pillActionsSep.hidden = true; pillInner.appendChild(pillActionsSep);
      var pillActions = h("div", "canvas-overlay-bar__actions"); pillActions.hidden = true; pillInner.appendChild(pillActions);
      pill.appendChild(pillInner); board.appendChild(pill);
      var panel = h("div", "tourb__panel");
      var panelHead = h("div", "tourb__panel-head");
      panelHead.appendChild(h("span", "tourb__panel-title", "Properties"));
      var panelClose = iconBtn("chevron", "Hide properties"); panelClose.classList.add("tourb__panel-close");
      panelClose.addEventListener("click", function () { tourSetPanelOpen(false); });
      panelHead.appendChild(panelClose);
      panel.appendChild(panelHead);
      var panelBody = h("div", "tourb__panel-body"); panel.appendChild(panelBody);
      body.appendChild(board); body.appendChild(panel);
      overlay.appendChild(body);
      document.body.appendChild(overlay);
      tourUI = { overlay: overlay, board: board, layer: layer, loops: loops, sources: sources, edges: edges, nodes: nodes, panelBody: panelBody, count: count, zlvl: zlvl, faceWrap: faceWrap, addHsBtn: addHsBtn, pill: pill, pillActions: pillActions, pillActionsSep: pillActionsSep, panel: panel, propsBtn: propsBtn };
      wireTourBoardGestures();
      return tourUI;
    }
    // (Re)build the Cards face-up switch fresh so it always reflects tourFacesUp=false on
    // open (switchEl has no imperative setter; rebuilding is the clean reset).
    function tourBuildFaceSwitch(wrap) {
      wrap.innerHTML = "";
      wrap.appendChild(h("span", "tourb__switch-label", "Cards face-up"));
      wrap.appendChild(switchEl(tourFacesUp, function (v) { tourFacesUp = v; renderTourNodes(); }));
    }

    var TOUR_OPEN_KEY = "authoring.tourBuilder"; // persists WHICH block's builder is open across refresh
    function openTourBuilder(block) {
      // #224 QA (data-loss fix): when a non-Flagship software version / variant is being
      // previewed, the inspector is bound to a DISPOSABLE display clone (node.__block), not
      // the base doc block. The tour GRAPH (screens, links, loops, board layout) is structural
      // base-level data, so edit the BASE block always -- otherwise a loop authored on the clone
      // is discarded when the preview re-resolves (screens survived only because they predate the
      // preview). versionBaseNode unwraps the clone via its __vbase back-link (no-op on base).
      block = versionBaseNode(block);
      tourBlock = block;
      if (window.migrateHotspotBlock) window.migrateHotspotBlock(block);
      if (!Array.isArray(block.screens) || !block.screens.length) { block.screens = [{ id: "scr-entry", visual: "", kind: "image", alt: "", markers: [] }]; block.entry = "scr-entry"; }
      autoLayoutTourCoords();
      ensureTourBuilder();
      if (window.normalizeHotspotLoops) window.normalizeHotspotLoops(block);
      tourFacesUp = true; tourConnect = null; tourNodeSel = []; tourSpace = false; tourLinkSel = null; tourHotMarker = null; tourLoopSel = null; tourSelKind = null;
      tourSetPlacing(false);
      tourSetPanelOpen(false); // canvas-first: the drawer starts collapsed each time the builder opens
      if (tourUI.faceWrap) tourBuildFaceSwitch(tourUI.faceWrap);
      tourReturnFocus = document.activeElement;
      tourUI.overlay.hidden = false;
      document.body.classList.add("tour-builder-open");
      // persist the mode so a page refresh re-opens the builder on the same block
      try { localStorage.setItem(TOUR_OPEN_KEY, ensureId(block) || ""); } catch (_) {}
      syncTourBoard();
      requestAnimationFrame(tourFit);
      setTimeout(function () { try { tourUI.board.focus(); } catch (_) {} }, 0);
    }

    function closeTourBuilder() {
      if (!tourUI) return;
      try { flushSave(); } catch (_) {} // don't let the 600ms autosave debounce drop builder edits on exit
      tourUI.overlay.hidden = true;
      document.body.classList.remove("tour-builder-open");
      tourConnect = null; tourSetPlacing(false);
      try { localStorage.removeItem(TOUR_OPEN_KEY); } catch (_) {}
      var ret = tourReturnFocus; tourReturnFocus = null;
      if (ret && ret.focus) { try { ret.focus(); } catch (_) {} }
    }

    // Find the hotspot block with this id anywhere in the LIVE doc (nested containers included).
    function tourFindHotspotById(id) {
      if (!id) return null;
      var found = null;
      (function scan(blocks) { (blocks || []).forEach(function (b) { if (!b || found) return; if (b.type === "hotspot" && b.id === id) { found = b; return; } if (b.blocks) scan(b.blocks); if (b.children) scan(b.children); if (b.columns) b.columns.forEach(scan); }); })(
        (E.doc.pages || []).reduce(function (acc, p) { return acc.concat(p.blocks || []); }, [])
      );
      return found;
    }
    // Data-loss guard: `doc` is a fresh object graph after undo/redo, a programmatic setDoc, or a
    // collab sync -- which orphans the builder's captured `tourBlock` reference, so subsequent edits
    // land on a detached copy and vanish on close. Whenever the doc is replaced while the board is
    // open, RE-BIND tourBlock to the same-id block in the new doc (or close if it's genuinely gone).
    function rebindTourBuilderToLiveDoc() {
      if (!tourUI || tourUI.overlay.hidden || !tourBlock || !tourBlock.id) return;
      var live = tourFindHotspotById(tourBlock.id);
      if (live) { if (live !== tourBlock) { tourBlock = live; syncTourBoard(); } }
      else closeTourBuilder(); // its block is gone from the new doc -> nothing to edit
    }
    // Boot: if the builder was open when the page was last refreshed, re-open it on the
    // same hotspot block (found by its persisted id in the current doc). Silent no-op if
    // the block is gone (e.g. a different course is now loaded).
    function maybeReopenTourBuilder() {
      var id; try { id = localStorage.getItem(TOUR_OPEN_KEY); } catch (_) { id = null; }
      if (!id) return;
      var found = tourFindHotspotById(id);
      if (found) openTourBuilder(found);
      else { try { localStorage.removeItem(TOUR_OPEN_KEY); } catch (_) {} }
    }

    // Re-host the SHIPPED hotspot inspector in the board's right panel, mirrored to the
    // board selection (hotspotEditScreenId / hotspotEditId module state). Swap the module
    // `inspector` target, build, restore — the node card is a handle, never a second editor.
    function renderTourInspector() {
      if (!tourUI || !tourBlock) return;
      renderTourPillActions(); // the pill segment mirrors the same selection as the panel
      var body = tourUI.panelBody; body.innerHTML = "";
      // #224 T6: a selected loop frame mirrors its own props (title, members, wrap), not the
      // screen/marker inspector — the panel reflects the selection (the design spec).
      if (tourLoopSel) { var loop = tourLoopById(tourLoopSel); if (loop) { renderTourLoopInspector(body, loop); return; } tourLoopSel = null; }
      var _ins = E.inspector; E.setInspector(body);
      try { renderHotspotInspector(tourBlock); } finally { E.setInspector(_ins); }
    }
    function renderTourLoopInspector(body, loop) {
      var li = tourLoops().indexOf(loop);
      // uio-O-W2 (OVL-07): two sections in the one notation — the loop's own settings, then its
      // ordered members — instead of a bold "Loop" line with a stack of labels under it.
      var loopBody = panelSection(body, "Loop");
      // name
      loopBody.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Name"));
      var nm = h("input", "prop-text"); nm.type = "text"; nm.spellcheck = false; nm.placeholder = "Loop " + (li + 1); nm.value = loop.name || "";
      nm.addEventListener("change", function () { pushHistory(); if (nm.value.trim()) loop.name = nm.value.trim(); else delete loop.name; scheduleSave(); renderTourNodes(); });
      loopBody.appendChild(nm);
      // wrap toggle — cycle past the ends (last -> first) or stop at the ends
      var wrapRow = h("label", "tourb__switch"); wrapRow.style.margin = "10px 0";
      wrapRow.appendChild(h("span", "tourb__switch-label", "Wrap around"));
      wrapRow.appendChild(switchEl(!!loop.wrap, function (v) { pushHistory(); if (v) loop.wrap = true; else delete loop.wrap; scheduleSave(); }));
      loopBody.appendChild(wrapRow);
      // ordered member strip: reorder (up/down) + remove. Order = carousel order.
      var memBody = panelSection(body, "Screens in this loop");
      var members = loop.screens || [];
      if (!members.length) memBody.appendChild(h("div", "tourb-loop__hint", "None yet. Drag screens into the frame, or add them below."));
      var list = h("div", "tourb-memlist");
      members.forEach(function (sid, idx) {
        var s = tourScreenById(sid); if (!s) return;
        var row = h("div", "tourb-memrow");
        row.appendChild(h("span", "tourb-memrow__ord", "" + (idx + 1)));
        var nmSpan = h("span", "tourb-memrow__name", tourScreenLabel(s, tourScreens().indexOf(s))); row.appendChild(nmSpan);
        var up = iconBtn("arrow-up", "Move up"); up.classList.add("tourb-memrow__btn"); up.disabled = idx === 0;
        up.addEventListener("click", function () { if (idx === 0) return; pushHistory(); members.splice(idx, 1); members.splice(idx - 1, 0, sid); scheduleSave(); renderTourNodes(); renderTourInspector(); });
        var dn = iconBtn("arrow-down", "Move down"); dn.classList.add("tourb-memrow__btn"); dn.disabled = idx === members.length - 1;
        dn.addEventListener("click", function () { if (idx === members.length - 1) return; pushHistory(); members.splice(idx, 1); members.splice(idx + 1, 0, sid); scheduleSave(); renderTourNodes(); renderTourInspector(); });
        var rm = iconBtn("x", "Remove from loop"); rm.classList.add("tourb-memrow__btn");
        rm.addEventListener("click", function () { pushHistory(); members.splice(idx, 1); scheduleSave(); renderTourNodes(); renderTourInspector(); });
        row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
        list.appendChild(row);
      });
      memBody.appendChild(list);
      // add-screens picker (the fallback to drag-in): every screen not already in this loop
      var addOpts = [["Add a screen…", ""]];
      tourScreens().forEach(function (s, si) { if (s && members.indexOf(s.id) < 0) addOpts.push([tourScreenLabel(s, si), s.id]); });
      if (addOpts.length > 1) {
        var addSel = dsSelect(addOpts, "", function (v) { if (!v) return; pushHistory(); members.push(v); scheduleSave(); renderTourNodes(); renderTourInspector(); });
        addSel.title = "Add a screen to this loop"; memBody.appendChild(addSel);
      }
      // delete the loop (members become free nodes; any inbound navigate target is cleared)
      var del = h("button", "prop-btn prop-btn--danger", "Delete loop"); del.style.marginTop = "12px";
      del.addEventListener("click", function () { tourDeleteLoop(loop); });
      body.appendChild(del);
    }

    // Full board refresh: nodes + edges + re-hosted inspector + bar counts.
    function syncTourBoard() {
      if (!tourBoardIsOpen()) return;
      renderTourNodes();
      renderTourInspector();
    }

    function renderTourNodes() {
      if (!tourUI) return;
      tourScrubNode = null; // #54: nodes are rebuilt below -> drop the stale hover-scrub reference
      renderTourLoops();
      renderTourSources();
      var ss = tourScreens(), entry = tourEntryScreen();
      // #224 T6: members of a loop are positioned inside their frame's grid (not at their
      // own bx/by); write the slot back onto bx/by so edges + drag-start stay consistent.
      var slots = tourMemberSlots();
      ss.forEach(function (s) { if (s && slots[s.id]) { s.bx = slots[s.id].x; s.by = slots[s.id].y; } });
      tourUI.nodes.innerHTML = "";
      if (tourUI.count) tourUI.count.textContent = ss.length + (ss.length === 1 ? " screen" : " screens");
      ss.forEach(function (s, si) {
        if (!s) return;
        var selected = (E.hotspotEditScreenId === s.id) && !E.hotspotEditId;
        var loopOf = screenLoop(s.id), memIdx = loopOf ? loopOf.screens.indexOf(s.id) : -1;
        var card = h("div", "tourb-node" + (selected ? " is-selected" : "") + (tourNodeSel.indexOf(s.id) >= 0 ? " is-multi" : "") + (loopOf ? " is-loop-member" : ""));
        card.style.left = (s.bx || 0) + "px"; card.style.top = (s.by || 0) + "px"; card.style.width = TOUR_NODE_W + "px";
        card.setAttribute("data-screen-id", s.id);
        if (loopOf) card.setAttribute("data-loop-member", loopOf.id);
        // thumbnail — the image shows at its NATURAL aspect ratio (thumb auto-heights to it)
        // so a pin at x/y% overlays the exact same point the learner sees (1:1 with render,
        // which also lays markers over the image at its natural aspect). An empty screen keeps
        // a fixed 16:9 placeholder. Measured heights (post-load) feed the edge/wire geometry.
        var thumb = h("div", "tourb-node__thumb");
        var src = screenVisualSrc(s);
        if (!src) { thumb.classList.add("is-empty"); thumb.style.height = TOUR_THUMB_H + "px"; if (window.Icon) thumb.innerHTML = window.Icon("image"); }
        else if (s.kind === "video") { var v = document.createElement("video"); v.src = src; v.muted = true; v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("preload", "auto"); v.addEventListener("loadedmetadata", tourReflowNode); v.addEventListener("loadeddata", function () { tourVideoToPoster(v, thumb); }); thumb.appendChild(v); tourWireHoverScrub(thumb, src); }
        else { var img = document.createElement("img"); img.src = src; img.alt = s.alt || ""; img.addEventListener("load", tourReflowNode); thumb.appendChild(img); }
        // badges
        if (s === entry || s.id === (entry && entry.id)) thumb.appendChild(h("span", "tourb-node__badge tourb-node__badge--entry", "Home"));
        if (tourBlock.completionScreen && tourBlock.completionScreen === s.id) { var fb = h("span", "tourb-node__badge tourb-node__badge--done", "Finish"); fb.title = "Completion screen"; thumb.appendChild(fb); }
        // loop member: a small order pill (its position in the carousel) at the thumb corner
        if (loopOf) { var lb = h("span", "tourb-node__badge tourb-node__badge--loop", "" + (memIdx + 1)); lb.title = "Loop position " + (memIdx + 1) + " of " + loopOf.screens.length; thumb.appendChild(lb); }
        // #55: a video screen gets a play-glyph badge (bottom-left) so it reads as a video, not an
        // image, at a glance; the title names its playback mode (loop vs play-once).
        if (s.kind === "video") { var vbadge = h("span", "tourb-node__badge tourb-node__badge--video"); vbadge.title = "Video screen — " + (s.playback === "once" ? "play once" : "loop"); if (window.Icon) vbadge.innerHTML = window.Icon("play"); thumb.appendChild(vbadge); }
        // WYSIWYG markers: render the REAL learner marker (colour, box/point, glyph, size) via the
        // shared render.js builder, then layer editor affordances (select / drag / resize / connect)
        // on it. Course tokens (--color-accent etc.) are applied to the thumb below so the marker
        // resolves its real colours. A box is %-sized so it matches the learner exactly; a point is a
        // fixed px size, scaled to the thumb (TOUR_NOMINAL_W) so it reads at the right proportion.
        try { if (window.applyTheme) { window.applyTheme(thumb, activeTheme()); thumb.setAttribute("data-mode", E.activeMode); } } catch (_) {}
        var loopById = {}; (tourBlock.loops || []).forEach(function (l) { if (l && l.id) loopById[l.id] = l; });
        (s.markers || []).forEach(function (m, mi) {
          if (!m) return;
          var isNav = m.action === "navigate";
          var isBox = m.shape === "box";
          var pin = window.hotspotMarkerEl(tourBlock, m, mi, loopById); // the exact learner marker
          pin.classList.add("tourb-marker");
          if (E.hotspotEditId === m.id) pin.classList.add("is-selected");
          pin.setAttribute("data-pin", m.id);
          if (!isBox) pin.style.setProperty("--hotspot-size", ((tourBlock.markerSize || 34) * TOUR_NODE_W / TOUR_NOMINAL_W) + "px");
          pin.title = m.label || (isBox ? "Region hotspot — drag to move; drag the corner to resize" : (isNav ? "Navigate hotspot — drag to move; drag the ring to link a screen" : "Card hotspot — drag to move"));
          pin.addEventListener("pointerdown", function (e) { tourBeginPinDrag(s, m, pin, thumb, e); });
          pin.addEventListener("contextmenu", function (e) { e.preventDefault(); e.stopPropagation(); tourSelectMarker(s, m); tourMarkerMenu(s, m, e.clientX, e.clientY); });
          // hover a marker -> light up its leader wire + card (which callout maps to which marker)
          pin.addEventListener("pointerenter", function () { tourHotMarker = m.id; renderTourEdges(); });
          pin.addEventListener("pointerleave", function () { tourHotMarker = E.hotspotEditId; renderTourEdges(); });
          if (isBox) { // #48: bottom-right corner handle resizes the region (sets m.w / m.h %)
            var rz = h("div", "tourb-pin__resize"); rz.title = "Drag to resize the region";
            rz.addEventListener("pointerdown", function (e) { tourBeginPinResize(s, m, pin, thumb, e); });
            pin.appendChild(rz);
          }
          thumb.appendChild(pin);
          if (isNav) { // ConnectionPort — drag-to-connect handle
            var port = h("div", "tourb-port" + (m.target ? " is-connected" : "") + (tourConnect && tourConnect.srcId === m.id ? " is-active" : ""));
            port.setAttribute("data-port", m.id);
            port.style.left = (m.x == null ? 50 : m.x) + "%"; port.style.top = (m.y == null ? 50 : m.y) + "%";
            port.title = "Drag to a screen to link it";
            port.addEventListener("pointerdown", function (e) { tourBeginConnect(s, m, e); });
            thumb.appendChild(port);
          }
        });
        card.appendChild(thumb);
        // inline title
        var t = h("input", "tourb-node__title"); t.type = "text"; t.spellcheck = false;
        t.placeholder = (s === entry ? "Home" : "Screen " + si); t.value = s.name || "";
        var tpushed = false;
        t.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        t.addEventListener("focus", function () { tpushed = false; });
        t.addEventListener("input", function () { if (!tpushed) { pushHistory(); tpushed = true; } if (t.value) s.name = t.value; else delete s.name; scheduleSave(); });
        card.appendChild(t);
        // secondary Caption field below the screen name (mirrors the inspector Caption) -- the line
        // shown beneath the screen to the learner, updating per screen.
        var capIn = h("input", "tourb-node__caption"); capIn.type = "text"; capIn.spellcheck = false;
        capIn.placeholder = "Caption"; capIn.value = s.caption || "";
        var cpushed = false;
        capIn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        capIn.addEventListener("focus", function () { cpushed = false; });
        capIn.addEventListener("input", function () { if (!cpushed) { pushHistory(); cpushed = true; } if (capIn.value) s.caption = capIn.value; else delete s.caption; scheduleSave(); });
        card.appendChild(capIn);
        // node pointer: shift/cmd-click toggles multi-select; plain drag moves (group if
        // multi-selected); plain click single-selects. (persist bx/by; render ignores them.)
        card.addEventListener("pointerdown", function (e) { tourNodePointerDown(s, card, e); });
        card.addEventListener("contextmenu", function (e) { e.preventDefault(); e.stopPropagation(); tourSelectNode(s); tourNodeMenu(s, e.clientX, e.clientY); });
        tourUI.nodes.appendChild(card);
      });
      // measure each thumb's real (aspect-driven) height in board px so edges/wires anchor to
      // the true pin positions (updated again per node as its image loads, via tourReflowNode).
      tourMeasureThumbs();
      // T5c: cards face-up — lay every card popover OUT AROUND its node (not stacked on the
      // pins) with a leader wire per card, so many callouts stay readable. Runs after all
      // nodes exist; populates tourFaceCardPos, which renderTourEdges draws the wires from.
      // With face-up OFF, only the SELECTED marker's card is laid out (select = open its box).
      tourFaceCardPos = {};
      tourScreens().forEach(function (s) { if (s) tourLayoutFaceCards(s); });
      renderTourEdges();
      applyTourTransform();
      renderTourPillActions(); // keep the selection segment current after any node rebuild
    }

    // ---- #224 T6: draw the loop frames (beneath the nodes) ----
    function tourLoopIsTargeted(loop) {
      var hit = false;
      tourScreens().forEach(function (s) { (s && s.markers || []).forEach(function (m) { if (m && m.action === "navigate" && m.target === loop.id) hit = true; }); });
      return hit;
    }
    function renderTourLoops() {
      if (!tourUI || !tourUI.loops) return;
      tourUI.loops.innerHTML = "";
      tourLoops().forEach(function (loop, li) {
        if (!loop) return;
        var sz = loopSize(loop), n = (loop.screens || []).length;
        var frame = h("div", "tourb-loop" + (tourLoopSel === loop.id ? " is-selected" : "") + (tourLoopIsTargeted(loop) ? " is-target" : ""));
        frame.style.left = (loop.bx || 0) + "px"; frame.style.top = (loop.by || 0) + "px";
        frame.style.width = sz.w + "px"; frame.style.height = sz.h + "px";
        frame.setAttribute("data-loop-id", loop.id);
        var head = h("div", "tourb-loop__head");
        if (window.Icon) { var gi = h("span", "tourb-loop__glyph"); gi.innerHTML = window.Icon("layers"); head.appendChild(gi); } // stacked-cards = a screen collection (#224 QA)
        var t = h("input", "tourb-loop__title"); t.type = "text"; t.spellcheck = false;
        t.placeholder = "Loop " + (li + 1); t.value = loop.name || "";
        var tpushed = false;
        t.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        t.addEventListener("focus", function () { tpushed = false; tourSelectLoop(loop); });
        t.addEventListener("input", function () { if (!tpushed) { pushHistory(); tpushed = true; } if (t.value) loop.name = t.value; else delete loop.name; scheduleSave(); });
        head.appendChild(t);
        head.appendChild(h("span", "tourb-loop__count", n + (n === 1 ? " screen" : " screens")));
        frame.appendChild(head);
        if (!n) frame.appendChild(h("div", "tourb-loop__empty", "Drag screens in, or use Add screens in the panel"));
        // whole-frame pointer: select + drag (members follow). Ignore clicks that land on a
        // member node (nodes are a layer above and handle their own pointer) or the title.
        frame.addEventListener("pointerdown", function (e) { tourLoopPointerDown(loop, frame, e); });
        frame.addEventListener("contextmenu", function (e) { e.preventDefault(); e.stopPropagation(); tourSelectLoop(loop); tourLoopMenu(loop, e.clientX, e.clientY); });
        tourUI.loops.appendChild(frame);
      });
    }
    function tourAddLoop() {
      if (!tourBlock) return;
      pushHistory();
      if (!Array.isArray(tourBlock.loops)) tourBlock.loops = [];
      var id = "loop-" + Math.random().toString(36).slice(2, 8); while (tourLoopById(id)) id += "x";
      // drop it into view: to the right of the current node spread, vertically centred-ish
      var maxX = 80; tourScreens().forEach(function (s) { if (s) maxX = Math.max(maxX, (s.bx || 0) + TOUR_NODE_W); });
      var loop = { id: id, screens: [], bx: maxX + 80, by: 80, bw: BL.LOOP.MIN_W, bh: BL.LOOP.EMPTY_H };
      tourBlock.loops.push(loop);
      tourSelectLoop(loop);
      scheduleSave(); renderTourNodes();
      requestAnimationFrame(tourFit);
    }
    // ---- source-video scratch nodes (harvest surfaces; excluded from render/export) ----
    // They live on tourBlock.sources[] = [{ id, visual:"asset:<id>", name, bx, by }]. render.js
    // never reads `sources`, and eachMediaSlot skips it, so a source is author-time-only. This
    // first pass gives the on-board presence + interim hover-scrub; the playhead/in-out transport
    // and the harvest (screenshot / segment) actions land in later passes.
    function tourSources() { return (tourBlock && Array.isArray(tourBlock.sources)) ? tourBlock.sources : []; }
    function tourSourceById(id) { var ss = tourSources(); for (var i = 0; i < ss.length; i++) if (ss[i] && ss[i].id === id) return ss[i]; return null; }
    function tourSourceSrc(src) {
      var v = src && src.visual;
      if (!v || typeof v !== "string") return null;
      if (v.indexOf("asset:") === 0) return editorAssetResolve(v.slice(6));
      return v;
    }
    function tourAddSource() {
      if (!tourBlock) return;
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = "video/*";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          pushHistory();
          if (!Array.isArray(tourBlock.sources)) tourBlock.sources = [];
          var id = "src-" + Math.random().toString(36).slice(2, 8); while (tourSourceById(id)) id += "x";
          // drop it ABOVE the current node/source spread so it reads as a separate surface
          var minY = Infinity;
          tourScreens().forEach(function (s) { if (s) minY = Math.min(minY, s.by || 0); });
          tourSources().forEach(function (s) { if (s) minY = Math.min(minY, s.by || 0); });
          if (!isFinite(minY)) minY = 60;
          var nm = (f.name || "").replace(/\.[^.]+$/, "").trim();
          var srcNode = { id: id, visual: assetRef(r.result, f), bx: 80, by: minY - TOUR_SOURCE_H - 120 };
          if (nm) srcNode.name = nm;
          tourBlock.sources.push(srcNode);
          scheduleSave(); renderTourNodes();
          requestAnimationFrame(tourFit);
        };
        r.readAsDataURL(f);
      });
      inp.click();
    }
    function tourRemoveSource(src) {
      if (!src || !tourBlock) return;
      confirmModal("Remove source video", "Screens you have already harvested from it are kept.", function () {
        pushHistory();
        var arr = tourSources(); var i = arr.indexOf(src); if (i >= 0) arr.splice(i, 1);
        if (!arr.length) delete tourBlock.sources;
        scheduleSave(); renderTourNodes();
        try { sweepAllAssets(); } catch (_) {} // free the removed source's blob now (it's unreferenced)
      }, { okLabel: "Remove", danger: true });
    }
    function renderTourSources() {
      if (!tourUI || !tourUI.sources) return;
      tourActiveCutCancel = null; tourActiveCutSel = null; // transports rebuilt below -> drop any open pending cut / selection
      tourUI.sources.innerHTML = "";
      tourSources().forEach(function (src, si) {
        if (!src) return;
        var card = h("div", "tourb-source");
        card.style.left = (src.bx || 0) + "px"; card.style.top = (src.by || 0) + "px"; card.style.width = TOUR_SOURCE_W + "px";
        card.setAttribute("data-source-id", src.id);
        // header: SOURCE tag + name + remove
        var head = h("div", "tourb-source__head");
        if (window.Icon) { var gi = h("span", "tourb-source__glyph"); gi.innerHTML = window.Icon("square-play"); head.appendChild(gi); }
        head.appendChild(h("span", "tourb-source__tag", "Source"));
        var nm = h("input", "tourb-source__title"); nm.type = "text"; nm.spellcheck = false;
        nm.placeholder = "Source " + (si + 1); nm.value = src.name || "";
        var pushed = false;
        nm.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        nm.addEventListener("focus", function () { pushed = false; });
        nm.addEventListener("input", function () { if (!pushed) { pushHistory(); pushed = true; } if (nm.value) src.name = nm.value; else delete src.name; scheduleSave(); });
        head.appendChild(nm);
        var rm = iconBtn("trash", "Remove source video", true); rm.classList.add("tourb-source__remove");
        rm.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        rm.addEventListener("click", function (e) { e.stopPropagation(); tourRemoveSource(src); });
        head.appendChild(rm);
        card.appendChild(head);
        // video thumb — a LIVE video (the harvest surface): the transport plays/scrubs it, so
        // (unlike screen nodes) we keep the live element rather than poster-swapping it.
        var thumb = h("div", "tourb-source__thumb");
        var vsrc = tourSourceSrc(src);
        var vid = null;
        if (!vsrc) { thumb.classList.add("is-empty"); thumb.style.height = TOUR_SOURCE_H + "px"; if (window.Icon) thumb.innerHTML = window.Icon("square-play"); }
        else {
          vid = document.createElement("video"); vid.src = vsrc; vid.muted = true;
          vid.setAttribute("muted", ""); vid.setAttribute("playsinline", ""); vid.setAttribute("preload", "auto");
          thumb.appendChild(vid);
          if (tourCropEditSrc === src.id) thumb.appendChild(tourBuildCropOverlay(src, thumb));
        }
        card.appendChild(thumb);
        if (vid) card.appendChild(tourBuildTransport(src, vid));
        card.addEventListener("pointerdown", function (e) { tourSourcePointerDown(src, card, e); });
        tourUI.sources.appendChild(card);
      });
    }
    function tourSourcePointerDown(src, card, e) {
      if (e.button !== 0 || tourSpace) return;
      if (e.target.closest(".tourb-source__title, .tourb-source__remove, .tourb-transport")) return;
      e.stopPropagation();
      var start = { x: e.clientX, y: e.clientY }, moved = false, pushedH = false;
      var ox = src.bx || 0, oy = src.by || 0;
      try { card.setPointerCapture(e.pointerId); } catch (_) {}
      function mv(ev) {
        if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 4) return;
        if (!pushedH) { pushHistory(); pushedH = true; }
        moved = true;
        var dx = (ev.clientX - start.x) / tourZoom, dy = (ev.clientY - start.y) / tourZoom;
        src.bx = Math.round(ox + dx); src.by = Math.round(oy + dy);
        card.style.left = src.bx + "px"; card.style.top = src.by + "px";
      }
      function up() { card.removeEventListener("pointermove", mv); card.removeEventListener("pointerup", up); if (moved) scheduleSave(); }
      card.addEventListener("pointermove", mv); card.addEventListener("pointerup", up);
    }

    // Source-video segment math -> src/editor/board/harvest.js (arch-P3-06). Marks, cuts, the ripple
    // merge, the kept ranges and the net length are arithmetic; these are the names the transport UI
    // below already calls.
    var HV = window.VersoHarvest;
    function tourFormatTime(sec) { return HV.formatTime(sec); }
    function tourApplyMark(kind, t, cur) { return HV.applyMark(kind, t, cur); }
    function tourCropRect(crop, natW, natH) { return HV.cropRect(crop, natW, natH); }
    function tourSegReady(inP, outP, cuts) { return HV.segReady(inP, outP, cuts); }
    function tourSpeedField(speed) { return HV.speedField(speed); }
    function tourApplyCut(pending, t, cuts) { return HV.applyCut(pending, t, cuts); }
    function tourMergeCuts(cuts) { return HV.mergeCuts(cuts); }
    function tourClipCutsToBounds(cuts, inP, outP) { return HV.clipCutsToBounds(cuts, inP, outP); }
    function tourKeptRanges(inP, outP, cuts) { return HV.keptRanges(inP, outP, cuts); }
    function tourNetLength(inP, outP, cuts) { return HV.netLength(inP, outP, cuts); }

    var tourPlayingVideo = null; // only one source plays at a time
    var tourCropEditSrc = null;  // id of the source whose crop overlay is open (one at a time)
    var tourActiveCutCancel = null; // canceller for an OPEN pending ripple cut (editor-only), if any;
                                    // the board Escape ladder dismisses it first (see the global keydown)
    var tourActiveCutSel = null;    // deselector for a SELECTED committed cut band (editor-only), if any;
                                    // Escape (after any pending cancel) clears the selection before stepping out
    function tourPauseAllSources(except) {
      if (tourPlayingVideo && tourPlayingVideo !== except) { try { tourPlayingVideo.pause(); } catch (_) {} }
    }
    // The MediaTransport strip (DSLMS board/SourceNode): scrub rail + playhead + in/out ticks,
    // and a controls row (play/pause, time readout, Set in / Set out). Plays/scrubs the LIVE
    // video passed in; marks persist on src.in / src.out (seconds).
    function tourBuildTransport(src, vid) {
      var wrap = h("div", "tourb-transport");
      // --- scrub rail ---
      var rail = h("div", "tourb-transport__rail");
      var range = h("div", "tourb-transport__range"); rail.appendChild(range);
      var fill = h("div", "tourb-transport__fill"); rail.appendChild(fill);
      // ripple cuts: removed bands punched out of the kept tint (rebuilt each paint), above the tint
      // but below the ticks/knob. Pending cut renders here too as a dashed bracket.
      var cutLayer = h("div", "tourb-transport__cuts"); rail.appendChild(cutLayer);
      var inTick = h("div", "tourb-transport__tick tourb-transport__tick--in"); rail.appendChild(inTick);
      var outTick = h("div", "tourb-transport__tick tourb-transport__tick--out"); rail.appendChild(outTick);
      var knob = h("div", "tourb-transport__knob"); rail.appendChild(knob);
      wrap.appendChild(rail);
      // --- controls row ---
      var row = h("div", "tourb-transport__row");
      var play = iconBtn("play", "Play / pause"); play.classList.add("tourb-transport__play");
      row.appendChild(play);
      var time = h("span", "tourb-transport__time", "0:00 / 0:00"); row.appendChild(time);
      row.appendChild(h("div", "tourb-transport__spacer"));
      // crop: toggle the crop overlay on the source (all harvests come out this same W x H)
      var cropB = iconBtn("crop", "Crop the source (all screens harvested from it share this size)");
      cropB.classList.add("tourb-transport__crop"); if (tourCropEditSrc === src.id) cropB.classList.add("is-on");
      cropB.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      cropB.addEventListener("click", function (e) { e.stopPropagation(); tourCropEditSrc = (tourCropEditSrc === src.id) ? null : src.id; renderTourSources(); });
      row.appendChild(cropB);
      var setIn = h("button", "tourb-transport__mark", "Set in"); setIn.type = "button"; setIn.title = "Set the segment IN point at the playhead"; row.appendChild(setIn);
      var setOut = h("button", "tourb-transport__mark", "Set out"); setOut.type = "button"; setOut.title = "Set the segment OUT point at the playhead"; row.appendChild(setOut);
      // harvest: freeze the current frame into a new image screen (＋ Segment lands here in tick 5)
      var shot = h("button", "tourb-transport__harvest"); shot.type = "button";
      shot.innerHTML = (window.Icon ? window.Icon("image") : "") + "<span>Screenshot</span>";
      shot.title = "Create a screen from the current frame";
      shot.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      shot.addEventListener("click", function (e) { e.stopPropagation(); tourHarvestScreenshot(src, vid); });
      row.appendChild(shot);
      // harvest a clip between in/out (silent WebM). Enabled only when a valid segment is marked.
      var seg = h("button", "tourb-transport__harvest tourb-transport__harvest--seg"); seg.type = "button";
      seg.innerHTML = (window.Icon ? window.Icon("scissors") : "") + "<span>Segment</span>";
      seg.title = "Create an animated screen from the in → out segment";
      seg.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      seg.addEventListener("click", function (e) { e.stopPropagation(); tourHarvestSegment(src, vid); });
      row.appendChild(seg);
      wrap.appendChild(row);

      // --- cut sub-row (ripple T3): Set cut-in / Set cut-out, disclosed once in<out exists. ---
      // pendingCut = seconds of an open cut-in awaiting its cut-out (ephemeral, editor-only).
      // Committed cuts live on src.cuts (T1 model); the bake (T2) stitches the kept ranges.
      var pendingCut = null;
      var cutRow = h("div", "tourb-transport__cutrow");
      cutRow.appendChild(h("span", "tourb-transport__speed-label", "Cut"));
      var cutIn = h("button", "tourb-transport__mark", "Cut in"); cutIn.type = "button"; cutIn.title = "Drop a cut-in at the playhead (carve a section out of the segment)";
      var cutOut = h("button", "tourb-transport__mark", "Cut out"); cutOut.type = "button"; cutOut.title = "Set the cut-out at the playhead to remove the section";
      cutRow.appendChild(cutIn); cutRow.appendChild(cutOut);
      // ✕ remove the selected cut (T4) — appears only when a committed band is selected; undo-reversible, no Modal.
      var cutRemove = iconBtn("x", "Remove the selected cut (restore that section)"); cutRemove.classList.add("tourb-transport__cutrm");
      cutRemove.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      cutRemove.addEventListener("click", function (e) { e.stopPropagation(); removeSelectedCut(); });
      cutRow.appendChild(cutRemove);
      wrap.appendChild(cutRow);
      var selCutIdx = null; // index into src.cuts of the SELECTED committed band (editor-only), or null
      function hasSpan() { return src.in != null && src.out != null && dur() > 0 && src.out > src.in; }
      // Open / clear a pending cut-in. The canceller is published module-side so the board's Escape
      // ladder can dismiss an open cut FIRST (before stepping out of any other board mode).
      function openPending(t) { pendingCut = t; tourActiveCutCancel = clearPending; clearCutSel(false); paint(); }
      function clearPending(repaint) { pendingCut = null; if (tourActiveCutCancel === clearPending) tourActiveCutCancel = null; if (repaint !== false) paint(); }
      // T4: select / deselect / remove a committed cut band. One selected at a time.
      function selectCut(i) { selCutIdx = i; tourActiveCutSel = clearCutSel; clearPending(false); paint(); }
      function clearCutSel(repaint) { if (selCutIdx == null) { if (repaint === true) paint(); return; } selCutIdx = null; if (tourActiveCutSel === clearCutSel) tourActiveCutSel = null; if (repaint !== false) paint(); }
      function removeSelectedCut() {
        if (selCutIdx == null || !Array.isArray(src.cuts) || !src.cuts[selCutIdx]) return;
        pushHistory(); // undo-reversible (no Modal — low-stakes, restorable)
        src.cuts.splice(selCutIdx, 1);
        if (!src.cuts.length) delete src.cuts;
        clearCutSel(false);
        scheduleSave(); paint();
      }
      function reclipCuts() { // called when in/out move: drop/trim cuts outside the new bounds
        if (Array.isArray(src.cuts) && src.cuts.length) {
          src.cuts = tourClipCutsToBounds(src.cuts, src.in, src.out);
          if (!src.cuts.length) delete src.cuts;
        }
        if (pendingCut != null && (!hasSpan() || pendingCut < src.in || pendingCut > src.out)) clearPending(false);
        clearCutSel(false); // indices may have shifted -> drop any selection
      }
      function markCut(kind) {
        var t = vid.currentTime || 0;
        if (kind === "in") { openPending(t); return; } // open a pending cut-in (no model change)
        if (pendingCut == null) return; // guarded by the disabled state
        var cut = tourApplyCut(pendingCut, t, src.cuts); // ordered {start,end} or null if t<=cut-in
        if (!cut) { paint(); return; } // invalid crossing -> keep the pending open
        pushHistory();
        var merged = tourMergeCuts(tourClipCutsToBounds((src.cuts || []).concat([cut]), src.in, src.out));
        if (merged.length) src.cuts = merged; else delete src.cuts;
        clearPending(false); clearCutSel(false); // a fresh commit can re-index cuts
        scheduleSave(); paint();
      }
      cutIn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      cutOut.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      cutIn.addEventListener("click", function (e) { e.stopPropagation(); markCut("in"); });
      cutOut.addEventListener("click", function (e) { e.stopPropagation(); markCut("out"); });

      // --- speed sub-row: pick a playback-speed preset for the baked clip (0.5x .. 2x). ---
      // Editor-only intent stored on src.speed; the bake re-times via vid.playbackRate. Progressively
      // disclosed with the segment tools -- shown only once a valid in<out exists (like +Segment enabling).
      var speedRow = h("div", "tourb-transport__speed");
      speedRow.appendChild(h("span", "tourb-transport__speed-label", "Speed"));
      var speedOpts = [
        { value: "0.5", label: "0.5×" }, { value: "0.75", label: "0.75×" },
        { value: "1", label: "1×" }, { value: "1.25", label: "1.25×" },
        { value: "1.5", label: "1.5×" }, { value: "2", label: "2×" }
      ];
      var speedSeg = window.VersoUI.SegmentedControl({
        size: "sm", value: String(src.speed || 1), options: speedOpts,
        onChange: function (v) {
          pushHistory();
          var n = tourSpeedField(v); // 1x = default = no field (clean provenance)
          if (n) src.speed = n; else delete src.speed;
          scheduleSave();
        }
      });
      speedSeg.style.flex = "1 1 auto"; speedSeg.title = "Playback speed of the baked segment (bake time follows the baked length)";
      speedRow.appendChild(speedSeg);
      wrap.appendChild(speedRow);

      function dur() { var d = vid.duration; return (d && isFinite(d) && d > 0) ? d : 0; }
      function paint() {
        var d = dur(), t = vid.currentTime || 0;
        var pct = d ? Math.max(0, Math.min(100, t / d * 100)) : 0;
        knob.style.left = pct + "%"; fill.style.width = pct + "%";
        var hasIn = src.in != null && d, hasOut = src.out != null && d;
        inTick.hidden = !hasIn; outTick.hidden = !hasOut;
        if (hasIn) inTick.style.left = Math.max(0, Math.min(100, src.in / d * 100)) + "%";
        if (hasOut) outTick.style.left = Math.max(0, Math.min(100, src.out / d * 100)) + "%";
        var lo = hasIn ? src.in / d * 100 : (hasOut ? 0 : 0);
        var hi = hasOut ? src.out / d * 100 : (hasIn ? 100 : 0);
        if ((hasIn || hasOut) && hi > lo) { range.hidden = false; range.style.left = lo + "%"; range.style.width = (hi - lo) + "%"; }
        else range.hidden = true;
        play.innerHTML = (window.Icon ? window.Icon(vid.paused ? "play" : "pause") : "");
        // ripple cuts: punch-out bands + pending bracket on the rail, and the net-length readout
        var span = hasSpan(), cuts = Array.isArray(src.cuts) ? src.cuts : [];
        cutLayer.innerHTML = "";
        if (d) {
          cuts.forEach(function (c, i) {
            var band = h("div", "tourb-transport__cut" + (i === selCutIdx ? " is-sel" : ""));
            band.style.left = Math.max(0, Math.min(100, c.start / d * 100)) + "%";
            band.style.width = Math.max(0, Math.min(100, (c.end - c.start) / d * 100)) + "%";
            band.title = "Removed " + tourFormatTime(c.start) + "-" + tourFormatTime(c.end) + " (click to select)";
            band.addEventListener("pointerdown", function (e) { e.stopPropagation(); }); // select, don't seek the rail
            band.addEventListener("click", function (e) { e.stopPropagation(); selectCut(i); });
            cutLayer.appendChild(band);
          });
          if (pendingCut != null) {
            var pa = Math.min(pendingCut, t), pb = Math.max(pendingCut, t);
            var pend = h("div", "tourb-transport__cut tourb-transport__cut--pending");
            pend.style.left = Math.max(0, Math.min(100, pa / d * 100)) + "%";
            pend.style.width = Math.max(0, Math.min(100, (pb - pa) / d * 100)) + "%";
            cutLayer.appendChild(pend);
          }
        }
        var netTxt = (span && cuts.length) ? (" · clip " + tourFormatTime(tourNetLength(src.in, src.out, cuts))) : "";
        time.textContent = tourFormatTime(t) + " / " + tourFormatTime(d) + netTxt;
        // ＋Segment needs a valid clip with net kept length > 0 (a cut can swallow it)
        seg.disabled = !tourSegReady(src.in, src.out, cuts);
        // cut + speed tools disclosed once a span exists; cut-out waits for a pending cut-in
        // speed is a bake-time choice you set BEFORE marking, so show it whenever the video has loaded;
        // cut controls are meaningless without a segment, so they stay gated on a valid in<out (Q11).
        speedRow.hidden = !(d > 0);
        cutRow.hidden = !span;
        cutOut.disabled = pendingCut == null;
        cutIn.classList.toggle("is-on", pendingCut != null);
        cutRemove.hidden = selCutIdx == null || !(cuts[selCutIdx]); // ✕ only with a live selection
      }
      function seekTo(clientX) {
        var d = dur(); if (!d) return;
        var r = rail.getBoundingClientRect(); if (!r.width) return;
        var frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        try { vid.currentTime = frac * d; } catch (_) {}
      }
      // click / drag the rail to seek
      rail.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); e.preventDefault();
        clearCutSel(); // clicking the rail body (not a band -> those stopPropagation) deselects
        try { rail.setPointerCapture(e.pointerId); } catch (_) {}
        seekTo(e.clientX);
        function mv(ev) { seekTo(ev.clientX); }
        function up() { rail.removeEventListener("pointermove", mv); rail.removeEventListener("pointerup", up); }
        rail.addEventListener("pointermove", mv); rail.addEventListener("pointerup", up);
      });
      play.addEventListener("click", function (e) {
        e.stopPropagation();
        if (vid.paused) { tourPauseAllSources(vid); tourPlayingVideo = vid; vid.play().catch(function () {}); }
        else vid.pause();
      });
      function mark(kind) {
        pushHistory();
        var r = tourApplyMark(kind, vid.currentTime || 0, { in: src.in, out: src.out });
        if (r.in == null) delete src.in; else src.in = r.in;
        if (r.out == null) delete src.out; else src.out = r.out;
        reclipCuts(); // moving a bound drops/trims cuts now outside [in,out]
        scheduleSave(); paint();
      }
      setIn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      setOut.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      setIn.addEventListener("click", function (e) { e.stopPropagation(); mark("in"); });
      setOut.addEventListener("click", function (e) { e.stopPropagation(); mark("out"); });
      vid.addEventListener("timeupdate", paint);
      vid.addEventListener("loadedmetadata", paint);
      vid.addEventListener("play", paint);
      vid.addEventListener("pause", paint);
      paint();
      return wrap;
    }
    // Freeze the source's CURRENT frame into a new image screen node. A normal harvested asset
    // (assetRef -> AssetStore, content-hash dedupe); the export media pre-pass downscales it like
    // any image, so we store full-res here. Records lightweight provenance `source:{id,t}`
    // (editor-only, ignored by render like bx/by) so tick 6 can re-bake in place.
    function tourHarvestScreenshot(src, vid, replace) {
      if (!vid || !vid.videoWidth) return; // no decoded frame yet -> nothing to grab
      var url;
      try {
        // honour the source crop so every screen harvested from this source is the same W x H
        var r = tourCropRect(src.crop, vid.videoWidth, vid.videoHeight);
        var cv = document.createElement("canvas"); cv.width = r.w; cv.height = r.h;
        cv.getContext("2d").drawImage(vid, r.sx, r.sy, r.sw, r.sh, 0, 0, r.w, r.h);
        url = cv.toDataURL("image/png"); // throws if the frame is cross-origin tainted
      } catch (_) { return; }
      pushHistory();
      var t = vid.currentTime || 0;
      // RE-BAKE: replace an existing screen's visual in place -> its id + markers/nav survive.
      if (replace) {
        replace.visual = assetRef(url, { type: "image/png", name: (src.name || "source") + " " + tourFormatTime(t) });
        replace.kind = "image"; replace.source = { id: src.id, t: t };
        tourSelKind = "node"; E.setHotspotEditScreenId(replace.id); E.setHotspotEditId(null); tourLoopSel = null;
        scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
        return;
      }
      var sid = "scr-" + Math.random().toString(36).slice(2, 8); while (tourScreenById(sid)) sid += "x";
      // stack harvests from THIS source down its own column so they don't pile on one spot
      var sibs = tourScreens().filter(function (s) { return s && s.source && s.source.id === src.id; }).length;
      var scr = {
        id: sid,
        visual: assetRef(url, { type: "image/png", name: (src.name || "source") + " " + tourFormatTime(t) }),
        kind: "image", alt: "", markers: [],
        bx: (src.bx || 0) + TOUR_SOURCE_W + 60, by: (src.by || 0) + sibs * (TOUR_THUMB_H + 130),
        source: { id: src.id, t: t } // provenance -> non-destructive re-bake (tick 6)
      };
      scr.name = (src.name ? src.name + " " : "") + tourFormatTime(t);
      tourBlock.screens.push(scr);
      tourSelKind = "node"; E.setHotspotEditScreenId(sid); E.setHotspotEditId(null); tourLoopSel = null;
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    // ---- ＋ Segment: record the in->out slice to a SILENT WebM screen (Q7) ----
    // Play the source in->out drawing each frame through the CROP canvas, capture that canvas's
    // stream into a MediaRecorder. Canvas capture carries no audio (silent by construction) and
    // bakes the crop in, so the clip is the same W x H as screenshot harvests. Output = a normal
    // kind:"video" screen (keeps the shipped hotspot-video runtime: progress/reveal/once/loop).
    var tourSegRecording = false;
    function tourPickWebmMime() {
      var c = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      for (var i = 0; i < c.length; i++) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (_) {} }
      return "";
    }
    function tourHarvestSegment(src, vid, replace, inOut) {
      var inMark = inOut ? inOut.in : src.in, outMark = inOut ? inOut.out : src.out;
      // speed preset: re-bake replays inOut.speed, a fresh bake reads src.speed (default 1x)
      var speed = (inOut && inOut.speed) || src.speed || 1;
      // ripple cuts: re-bake replays inOut.cuts, a fresh bake reads src.cuts. The bake walks the
      // KEPT ranges (T1) and splices them; the removed bands are never recorded.
      var cuts = tourClipCutsToBounds(inOut ? inOut.cuts : src.cuts, inMark, outMark);
      if (tourSegRecording || !vid || !tourSegReady(inMark, outMark, cuts)) return;
      if (typeof MediaRecorder === "undefined") return;
      var kept = tourKeptRanges(inMark, outMark, cuts);
      if (!kept.length) return;
      var r = tourCropRect(src.crop, vid.videoWidth || 1280, vid.videoHeight || 720);
      var cv = document.createElement("canvas"); cv.width = r.w; cv.height = r.h;
      var ctx = cv.getContext("2d");
      var stream = cv.captureStream ? cv.captureStream(30) : null;
      if (!stream) return;
      var mime = tourPickWebmMime(), rec;
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (_) { return; }
      var chunks = [], raf = null, inPt = inMark, outPt = outMark, pi = 0; // pi = index of the kept piece being captured
      function stopDraw() { if (raf) { cancelAnimationFrame(raf); raf = null; } try { vid.pause(); } catch (_) {} try { vid.playbackRate = 1; } catch (_) {} }
      // Walk to the next kept piece: pause the recorder BEFORE the seek so the gap isn't captured,
      // resume on `seeked` -> MediaRecorder splices the pieces with no frozen-frame smear.
      function advance() {
        pi++;
        if (pi >= kept.length) { try { rec.stop(); } catch (_) {} return; } // all pieces captured
        try { rec.pause(); } catch (_) {}
        try { vid.pause(); } catch (_) {}
        var onSeam = function () {
          vid.removeEventListener("seeked", onSeam);
          try { rec.resume(); } catch (_) {}
          try { vid.playbackRate = speed; } catch (_) {}
          vid.play().catch(function () {});
          draw();
        };
        vid.addEventListener("seeked", onSeam);
        try { vid.currentTime = kept[pi].in; } catch (_) { onSeam(); }
      }
      function draw() {
        try { ctx.drawImage(vid, r.sx, r.sy, r.sw, r.sh, 0, 0, r.w, r.h); } catch (_) {}
        if ((vid.currentTime || 0) >= kept[pi].out) { if (raf) { cancelAnimationFrame(raf); raf = null; } advance(); return; }
        raf = requestAnimationFrame(draw);
      }
      rec.ondataavailable = function (e) { if (e && e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stopDraw();
        var blob = new Blob(chunks, { type: mime || "video/webm" });
        var fr = new FileReader();
        fr.onload = function () { tourFinishSegment(src, fr.result, inPt, outPt, replace, speed, cuts); };
        fr.onerror = function () { tourSegRecording = false; };
        fr.readAsDataURL(blob);
      };
      tourSegRecording = true;
      var onSeeked = function () {
        vid.removeEventListener("seeked", onSeeked);
        try { rec.start(); } catch (_) { tourSegRecording = false; return; }
        try { vid.playbackRate = speed; } catch (_) {} // re-time the capture: 2x -> half-length clip, 0.5x -> double
        vid.play().catch(function () {});
        draw();
      };
      vid.addEventListener("seeked", onSeeked);
      try { vid.currentTime = kept[0].in; } catch (_) { onSeeked(); }
    }
    function tourFinishSegment(src, dataUrl, inPt, outPt, replace, speed, cuts) {
      tourSegRecording = false;
      if (!dataUrl || typeof dataUrl !== "string" || dataUrl.indexOf("data:") !== 0) return;
      var sp = tourSpeedField(speed); // 1x = default -> omit (clean provenance, ignored by render)
      var cx = (Array.isArray(cuts) && cuts.length) ? cuts.map(function (c) { return { start: c.start, end: c.end }; }) : null;
      pushHistory();
      var label0 = (src.name ? src.name + " " : "") + tourFormatTime(inPt) + "-" + tourFormatTime(outPt);
      // RE-BAKE: replace an existing screen's clip in place -> id + markers/nav survive.
      if (replace) {
        replace.visual = assetRef(dataUrl, { type: "video/webm", name: label0 });
        replace.kind = "video"; if (!replace.playback) replace.playback = "once";
        replace.source = { id: src.id, in: inPt, out: outPt }; if (sp) replace.source.speed = sp; if (cx) replace.source.cuts = cx;
        tourSelKind = "node"; E.setHotspotEditScreenId(replace.id); E.setHotspotEditId(null); tourLoopSel = null;
        scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
        return;
      }
      var sid = "scr-" + Math.random().toString(36).slice(2, 8); while (tourScreenById(sid)) sid += "x";
      var sibs = tourScreens().filter(function (s) { return s && s.source && s.source.id === src.id; }).length;
      var label = (src.name ? src.name + " " : "") + tourFormatTime(inPt) + "-" + tourFormatTime(outPt);
      var scr = {
        id: sid,
        visual: assetRef(dataUrl, { type: "video/webm", name: label }),
        kind: "video", playback: "once", alt: "", markers: [],
        bx: (src.bx || 0) + TOUR_SOURCE_W + 60, by: (src.by || 0) + sibs * (TOUR_THUMB_H + 130),
        source: { id: src.id, in: inPt, out: outPt } // provenance -> re-cut (tick 6)
      };
      if (sp) scr.source.speed = sp;
      if (cx) scr.source.cuts = cx;
      scr.name = label;
      tourBlock.screens.push(scr);
      tourSelKind = "node"; E.setHotspotEditScreenId(sid); E.setHotspotEditId(null); tourLoopSel = null;
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    // Non-destructive RE-BAKE: re-run the harvest from the still-present source and swap this
    // screen's visual IN PLACE (id + markers/nav preserved) -- so "nudge the frame / re-cut after
    // I changed the crop" is one click, not delete + re-harvest + re-wire. Needs the source (Q3:
    // it persists). No-op if the source was removed.
    function tourRebakeScreen(s) {
      if (!s || !s.source) return;
      var src = tourSourceById(s.source.id); if (!src) return; // source gone -> nothing to re-bake from
      var vid = (tourUI && tourUI.sources) ? tourUI.sources.querySelector('.tourb-source[data-source-id="' + src.id + '"] video') : null;
      if (!vid || !vid.videoWidth) return;
      if (s.source.in != null && s.source.out != null) { tourHarvestSegment(src, vid, s, { in: s.source.in, out: s.source.out, speed: s.source.speed, cuts: s.source.cuts }); return; }
      var t = s.source.t || 0;
      var grab = function () { tourHarvestScreenshot(src, vid, s); };
      if (Math.abs((vid.currentTime || 0) - t) < 0.06) { grab(); return; }
      var on = function () { vid.removeEventListener("seeked", on); grab(); };
      vid.addEventListener("seeked", on);
      try { vid.currentTime = t; } catch (_) { vid.removeEventListener("seeked", on); grab(); }
    }
    // Crop overlay on a source thumb: a draggable/resizable rect stored NORMALISED on src.crop
    // (0-1 fractions). All harvests route through it (tourCropRect) so every screen from this
    // source is the same size. A full-frame crop is stored as "no crop" (whole frame).
    function tourBuildCropOverlay(src, thumb) {
      var c0 = (src.crop && typeof src.crop === "object") ? src.crop : {};
      var crop = { x: c0.x || 0, y: c0.y || 0, w: c0.w == null ? 1 : c0.w, h: c0.h == null ? 1 : c0.h };
      var ov = h("div", "tourb-crop");
      var box = h("div", "tourb-crop__box");
      function clampAll() {
        crop.w = Math.max(0.05, Math.min(1, crop.w)); crop.h = Math.max(0.05, Math.min(1, crop.h));
        crop.x = Math.max(0, Math.min(1 - crop.w, crop.x)); crop.y = Math.max(0, Math.min(1 - crop.h, crop.y));
      }
      function place() { box.style.left = (crop.x * 100) + "%"; box.style.top = (crop.y * 100) + "%"; box.style.width = (crop.w * 100) + "%"; box.style.height = (crop.h * 100) + "%"; }
      function r3(n) { return Math.round(n * 1000) / 1000; }
      function store() {
        clampAll();
        if (crop.x <= 0.001 && crop.y <= 0.001 && crop.w >= 0.999 && crop.h >= 0.999) delete src.crop; // full frame = no crop
        else src.crop = { x: r3(crop.x), y: r3(crop.y), w: r3(crop.w), h: r3(crop.h) };
        scheduleSave();
      }
      place();
      // drag the body = move
      box.addEventListener("pointerdown", function (e) {
        if (e.target !== box) return; // corner handles have their own
        e.stopPropagation(); e.preventDefault();
        var r = thumb.getBoundingClientRect(), ox = crop.x, oy = crop.y, sx = e.clientX, sy = e.clientY, pushed = false;
        try { box.setPointerCapture(e.pointerId); } catch (_) {}
        function mv(ev) { if (!pushed) { pushHistory(); pushed = true; } crop.x = ox + (ev.clientX - sx) / r.width; crop.y = oy + (ev.clientY - sy) / r.height; clampAll(); place(); }
        function up() { box.removeEventListener("pointermove", mv); box.removeEventListener("pointerup", up); store(); place(); }
        box.addEventListener("pointermove", mv); box.addEventListener("pointerup", up);
      });
      // corner handles = resize (the opposite corner stays anchored)
      [["nw", -1, -1], ["ne", 1, -1], ["sw", -1, 1], ["se", 1, 1]].forEach(function (cn) {
        var hx = cn[1], hy = cn[2];
        var hd = h("div", "tourb-crop__handle tourb-crop__handle--" + cn[0]);
        hd.addEventListener("pointerdown", function (e) {
          e.stopPropagation(); e.preventDefault();
          var r = thumb.getBoundingClientRect(), o = { x: crop.x, y: crop.y, w: crop.w, h: crop.h }, sx = e.clientX, sy = e.clientY, pushed = false;
          try { hd.setPointerCapture(e.pointerId); } catch (_) {}
          function mv(ev) {
            if (!pushed) { pushHistory(); pushed = true; }
            var dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
            if (hx < 0) { crop.x = o.x + dx; crop.w = o.w - dx; } else { crop.w = o.w + dx; }
            if (hy < 0) { crop.y = o.y + dy; crop.h = o.h - dy; } else { crop.h = o.h + dy; }
            if (crop.w < 0.05) { if (hx < 0) crop.x = o.x + o.w - 0.05; crop.w = 0.05; }
            if (crop.h < 0.05) { if (hy < 0) crop.y = o.y + o.h - 0.05; crop.h = 0.05; }
            clampAll(); place();
          }
          function up() { hd.removeEventListener("pointermove", mv); hd.removeEventListener("pointerup", up); store(); place(); }
          hd.addEventListener("pointermove", mv); hd.addEventListener("pointerup", up);
        });
        box.appendChild(hd);
      });
      ov.appendChild(box);
      return ov;
    }
    function tourSelectLoop(loop) {
      tourSelKind = loop ? "loop" : null;
      tourLoopSel = loop ? loop.id : null; E.setHotspotEditId(null); E.setHotspotEditScreenId(null); tourNodeSel = []; tourLinkSel = null;
      renderTourInspector(); renderTourNodes();
    }
    function tourDeleteLoop(loop) {
      pushHistory();
      // members become free nodes where they sit (their bx/by already hold the slot); any
      // navigate marker aimed at this loop is cleared so no dangling target survives.
      tourScreens().forEach(function (s) { (s && s.markers || []).forEach(function (m) { if (m && m.target === loop.id) delete m.target; }); });
      var i = tourLoops().indexOf(loop); if (i >= 0) tourBlock.loops.splice(i, 1);
      if (tourLoopSel === loop.id) tourLoopSel = null;
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    // ---- selection-contextual actions segment (the pill's pillActions mount) ----------------
    // Mirrors the board selection: appends per-object VERBS + the object's DEFINING mode toggles
    // (marker Action/Shape) into the floating pill, cleared on deselect. Single home — the
    // Action/Shape toggles are removed from the re-hosted panel while the builder is open (they
    // stay in the plain sidebar, where there is no pill). Same "one bar, contextual segment"
    // pattern as the main canvas ensureBlockToolbar.
    function tourPillIcon(name) { return window.Icon ? window.Icon(name) : ""; }
    function renderTourPillActions() {
      if (!tourUI || !tourUI.pillActions) return;
      var host = tourUI.pillActions, sep = tourUI.pillActionsSep;
      host.innerHTML = "";
      // Branch on the EXPLICIT selection kind, not hotspotEditId (the re-hosted panel points that at
      // markers[0] even for a node selection — see renderHotspotInspector).
      var m = (tourSelKind === "marker" && E.hotspotEditId && tourBlock) ? findHotspot(tourBlock, E.hotspotEditId) : null;
      var s = E.hotspotEditScreenId ? tourScreenById(E.hotspotEditScreenId) : null;
      var loop = (tourSelKind === "loop" && tourLoopSel) ? tourLoopById(tourLoopSel) : null;
      var shown = false;
      if (tourSelKind === "marker" && m && s) {
        // Action: Card <-> Navigate (moved off the panel — single home in the builder)
        var aw = h("div", "tourb__pillseg");
        segmentedIconLive("", [[tourPillIcon("message-square"), "card", "Card popover"], [tourPillIcon("navigation"), "navigate", "Navigate to a screen"]],
          function (v) { return (m.action === "navigate" ? "navigate" : "card") === v; },
          function (v) { m.action = (v === "navigate") ? "navigate" : "card"; E.setHotspotEditId(m.id); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); }, aw);
        host.appendChild(aw);
        // Shape: Point <-> Box
        var sw = h("div", "tourb__pillseg");
        segmentedIconLive("", [[tourPillIcon("target"), "point", "Point marker"], [tourPillIcon("square"), "box", "Box region"]],
          function (v) { return (m.shape === "box" ? "box" : "point") === v; },
          function (v) { if (v === "box") { m.shape = "box"; if (m.w == null) m.w = 20; if (m.h == null) m.h = 12; } else delete m.shape; reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); }, sw);
        host.appendChild(sw);
        host.appendChild(h("span", "tb-sep"));
        var dupM = iconBtn("duplicate", "Duplicate hotspot"); dupM.addEventListener("click", function () { tourDuplicateMarker(s, m); }); host.appendChild(dupM);
        var delM = iconBtn("trash", "Delete hotspot", true); delM.addEventListener("click", function () { tourDeleteMarker(s, m); }); host.appendChild(delM);
        shown = true;
      } else if (tourSelKind === "loop" && loop) {
        var wrapB = iconBtn("refresh", loop.wrap ? "Wrap around: on (cycle past the ends)" : "Wrap around: off"); if (loop.wrap) wrapB.classList.add("is-on");
        wrapB.addEventListener("click", function () { pushHistory(); if (loop.wrap) delete loop.wrap; else loop.wrap = true; scheduleSave(); renderTourNodes(); renderTourInspector(); }); host.appendChild(wrapB);
        var delL = iconBtn("trash", "Delete loop", true); delL.addEventListener("click", function () { tourDeleteLoop(loop); }); host.appendChild(delL);
        shown = true;
      } else if (tourSelKind === "node" && s) {
        var isEntry = tourBlock.entry === s.id;
        var homeB = iconBtn("square-play", isEntry ? "Entry (Home) screen" : "Set as entry (Home) screen"); if (isEntry) homeB.classList.add("is-on");
        homeB.addEventListener("click", function () { if (isEntry) return; pushHistory(); tourBlock.entry = s.id; scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); }); host.appendChild(homeB);
        var isFin = tourBlock.completionScreen === s.id;
        var finB = iconBtn("check-square", isFin ? "Finish screen (click to clear)" : "Set as finish (completion) screen"); if (isFin) finB.classList.add("is-on");
        finB.addEventListener("click", function () { pushHistory(); if (isFin) delete tourBlock.completionScreen; else tourBlock.completionScreen = s.id; scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); }); host.appendChild(finB);
        host.appendChild(h("span", "tb-sep"));
        var replB = iconBtn("image", "Replace screen image"); replB.addEventListener("click", function () { tourReplaceScreenImage(s); }); host.appendChild(replB);
        // re-bake from source: only for a harvested screen whose source is still on the board
        if (s.source && tourSourceById(s.source.id)) {
          var rbB = iconBtn("refresh", "Re-bake from source (re-capture this screen from its source video)");
          rbB.addEventListener("click", function () { tourRebakeScreen(s); }); host.appendChild(rbB);
        }
        var dupN = iconBtn("duplicate", "Duplicate screen"); dupN.addEventListener("click", function () { tourDuplicateScreen(s); }); host.appendChild(dupN);
        if (!isEntry) { var delN = iconBtn("trash", "Delete screen", true); delN.addEventListener("click", function () { tourDeleteScreen(s); }); host.appendChild(delN); } // entry/Home is protected
        shown = true;
      }
      host.hidden = !shown; if (sep) sep.hidden = !shown;
    }
    // ---- object verbs the pill segment fires (screen/ marker duplicate, delete, image replace) ----
    function tourReplaceScreenImage(s) {
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,.svg,video/*";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () { pushHistory(); s.visual = assetRef(r.result, f); s.kind = (f.type && f.type.indexOf("video/") === 0) ? "video" : "image"; scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); };
        r.readAsDataURL(f);
      });
      inp.click();
    }
    function tourDuplicateScreen(s) {
      pushHistory();
      var copy = clone(s);
      copy.id = "scr-" + Math.random().toString(36).slice(2, 8); while (tourScreenById(copy.id)) copy.id += "x";
      (copy.markers || []).forEach(function (mk) { if (mk) mk.id = "hs_" + Math.random().toString(36).slice(2, 8); });
      copy.bx = (s.bx || 0) + 28; copy.by = (s.by || 0) + 28;
      if (copy.name) copy.name = copy.name + " copy";
      var i = tourBlock.screens.indexOf(s);
      tourBlock.screens.splice(i < 0 ? tourBlock.screens.length : i + 1, 0, copy);
      tourSelKind = "node"; E.setHotspotEditScreenId(copy.id); E.setHotspotEditId(null); tourLoopSel = null;
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    function tourDuplicateMarker(s, m) {
      pushHistory();
      var copy = clone(m);
      copy.id = "hs_" + Math.random().toString(36).slice(2, 8);
      copy.x = clampPct((m.x == null ? 50 : m.x) + 4); copy.y = clampPct((m.y == null ? 50 : m.y) + 4);
      var i = (s.markers || []).indexOf(m);
      (s.markers = s.markers || []).splice(i < 0 ? s.markers.length : i + 1, 0, copy);
      tourSelKind = "marker"; E.setHotspotEditScreenId(s.id); E.setHotspotEditId(copy.id);
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    function tourDeleteMarker(s, m) {
      pushHistory();
      var i = (s.markers || []).indexOf(m); if (i >= 0) s.markers.splice(i, 1);
      if (E.hotspotEditId === m.id) E.setHotspotEditId(null);
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    // Delete a screen node from the board. Mirrors the panel deleteScreen (entry/Home is protected),
    // and clears every dangling reference: inbound navigate targets, the completion pointer, and any
    // loop membership — so no edge or badge points at a removed screen.
    function tourDeleteScreen(s) {
      var entry = tourEntryScreen();
      if (!s || (entry && s.id === entry.id)) return; // never delete the entry/Home screen
      var i = tourBlock.screens.indexOf(s); if (i < 0) return;
      pushHistory();
      tourBlock.screens.splice(i, 1);
      tourBlock.screens.forEach(function (sc) { (sc && sc.markers || []).forEach(function (m) { if (m && m.target === s.id) delete m.target; }); });
      if (tourBlock.completionScreen === s.id) delete tourBlock.completionScreen;
      (tourBlock.loops || []).forEach(function (l) { if (l && l.screens) { var j = l.screens.indexOf(s.id); if (j >= 0) l.screens.splice(j, 1); } });
      if (E.hotspotEditScreenId === s.id) { E.setHotspotEditScreenId((entry && entry.id) || null); E.setHotspotEditId(null); }
      scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }
    // ---- right-click context menus: the SAME verbs as the pill segment, a second surface (one
    // vocabulary). Selecting first keeps the menu + pill mirrored to the object. ----
    function tourMarkerMenu(s, m, x, y) {
      var isNav = m.action === "navigate", isBox = m.shape === "box";
      showContextMenu(x, y, [
        { label: "Card popover", active: !isNav, onClick: function () { pushHistory(); m.action = "card"; E.setHotspotEditId(m.id); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); } },
        { label: "Navigate to a screen", active: isNav, onClick: function () { pushHistory(); m.action = "navigate"; E.setHotspotEditId(m.id); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); } },
        { sep: true },
        { label: "Point marker", active: !isBox, onClick: function () { pushHistory(); delete m.shape; reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); } },
        { label: "Box region", active: isBox, onClick: function () { pushHistory(); m.shape = "box"; if (m.w == null) m.w = 20; if (m.h == null) m.h = 12; reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); } },
        { sep: true },
        { label: "Duplicate hotspot", onClick: function () { tourDuplicateMarker(s, m); } },
        { label: "Delete hotspot", danger: true, onClick: function () { tourDeleteMarker(s, m); } }
      ]);
    }
    function tourNodeMenu(s, x, y) {
      var isEntry = tourBlock.entry === s.id, isFin = tourBlock.completionScreen === s.id;
      var items = [
        { label: "Set as Home (entry)", active: isEntry, onClick: function () { if (isEntry) return; pushHistory(); tourBlock.entry = s.id; scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); } },
        { label: isFin ? "Clear finish screen" : "Set as finish screen", active: isFin, onClick: function () { pushHistory(); if (isFin) delete tourBlock.completionScreen; else tourBlock.completionScreen = s.id; scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); } },
        { sep: true },
        { label: "Replace image…", onClick: function () { tourReplaceScreenImage(s); } },
        { label: "Duplicate screen", onClick: function () { tourDuplicateScreen(s); } }
      ];
      if (!isEntry) items.push({ sep: true }, { label: "Delete screen", danger: true, onClick: function () { tourDeleteScreen(s); } });
      showContextMenu(x, y, items);
    }
    function tourLoopMenu(loop, x, y) {
      showContextMenu(x, y, [
        { label: "Wrap around", active: !!loop.wrap, onClick: function () { pushHistory(); if (loop.wrap) delete loop.wrap; else loop.wrap = true; scheduleSave(); renderTourNodes(); renderTourInspector(); } },
        { sep: true },
        { label: "Delete loop", danger: true, onClick: function () { tourDeleteLoop(loop); } }
      ]);
    }
    // Add/remove/reorder membership after a node is dropped: the screen joins the loop whose
    // frame its centre lands in, leaves if dropped out, or re-indexes if moved within its loop.
    function tourResolveMembership(s) {
      var cx = (s.bx || 0) + TOUR_NODE_W / 2, cy = (s.by || 0) + tourThumbHeight(s) / 2;
      var cur = screenLoop(s.id), tgt = null;
      tourLoops().forEach(function (loop) { if (loop && ptInRect(cx, cy, loopRect(loop))) tgt = loop; });
      if (tgt && tgt !== cur) {
        if (cur) { var ci = cur.screens.indexOf(s.id); if (ci >= 0) cur.screens.splice(ci, 1); }
        tgt.screens.push(s.id);
        return true;
      }
      if (!tgt && cur) { var i = cur.screens.indexOf(s.id); if (i >= 0) cur.screens.splice(i, 1); return true; }
      if (tgt && tgt === cur) { // reorder within the frame by drop position
        var cols = BL.loopCols(cur.screens.length);
        var relX = cx - ((cur.bx || 0) + BL.LOOP.PAD), relY = cy - ((cur.by || 0) + BL.LOOP.HEADER + BL.LOOP.PAD);
        var col = clamp(Math.round(relX / (TOUR_NODE_W + BL.LOOP.GAP)), 0, cols - 1);
        var row = Math.max(0, Math.round(relY / (BL.LOOP.CELL_H + BL.LOOP.GAP)));
        var to = clamp(row * cols + col, 0, cur.screens.length - 1), from = cur.screens.indexOf(s.id);
        if (from >= 0 && from !== to) { cur.screens.splice(from, 1); cur.screens.splice(to, 0, s.id); return true; }
      }
      return false;
    }
    // Frame drag: move loop.bx/by; the member nodes follow (moved in place for smoothness,
    // re-slotted on drop). A click (no drag) just selects the loop.
    function tourLoopPointerDown(loop, frame, e) {
      if (e.button !== 0 || tourSpace) return;
      if (e.target.closest(".tourb-loop__title, .tourb-node")) return;
      e.stopPropagation();
      var start = { x: e.clientX, y: e.clientY }, moved = false, pushedH = false;
      var ox = loop.bx || 0, oy = loop.by || 0, members = null;
      try { frame.setPointerCapture(e.pointerId); } catch (_) {}
      function mv(ev) {
        if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 4) return;
        if (!pushedH) { pushHistory(); pushedH = true; }
        if (!members) members = tourLoopMembers(loop).map(function (m) { return { sc: m, el: tourUI.nodes.querySelector('.tourb-node[data-screen-id="' + m.id + '"]'), ox: m.bx || 0, oy: m.by || 0 }; });
        moved = true;
        var dx = (ev.clientX - start.x) / tourZoom, dy = (ev.clientY - start.y) / tourZoom;
        loop.bx = Math.round(ox + dx); loop.by = Math.round(oy + dy);
        frame.style.left = loop.bx + "px"; frame.style.top = loop.by + "px";
        members.forEach(function (g) { g.sc.bx = Math.round(g.ox + dx); g.sc.by = Math.round(g.oy + dy); if (g.el) { g.el.style.left = g.sc.bx + "px"; g.el.style.top = g.sc.by + "px"; } });
        renderTourEdges();
      }
      function up() {
        frame.removeEventListener("pointermove", mv); frame.removeEventListener("pointerup", up);
        if (!moved) { tourSelectLoop(loop); return; }
        scheduleSave(); renderTourNodes();
      }
      frame.addEventListener("pointermove", mv); frame.addEventListener("pointerup", up);
    }
    function tourMeasureThumbs() {
      if (!tourUI) return;
      Array.prototype.forEach.call(tourUI.nodes.querySelectorAll(".tourb-node"), function (card) {
        var th = card.querySelector(".tourb-node__thumb");
        if (th) tourThumbHMap[card.getAttribute("data-screen-id")] = th.offsetHeight || TOUR_THUMB_H;
      });
    }
    function tourThumbHeight(s) { return (s && tourThumbHMap[s.id]) || TOUR_THUMB_H; }
    // an image/video finished loading -> the node re-heighted to its aspect; re-measure that
    // node + repaint the edges/wires so their endpoints track the new pin positions.
    // #224 QA (crisp-on-zoom): a live <video> thumbnail is a GPU-composited layer the board's
    // scale transform upsamples as a cached texture -> blurry when zoomed in (and one video can
    // promote the whole layer, blurring every node). Swap it for a STATIC first-frame <img>,
    // which the browser re-rasterises crisply at the live zoom (and stops N videos decoding on
    // the board). Best-effort: a tainted/undecodable frame keeps the live video.
    function tourVideoToPoster(v, thumb) {
      if (!v || !v.videoWidth || v.parentNode !== thumb) return;
      // #53: capture the poster from the LAST frame (where the recording ENDS), not the first.
      // Seeking is async, so draw inside a one-shot "seeked"; fall back to the current frame if
      // the duration is unknown or the seek fails.
      function grab() {
        try {
          if (v.parentNode !== thumb) return;
          var cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight;
          cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
          var url = cv.toDataURL("image/png"); // throws if the frame is cross-origin tainted
          var img = document.createElement("img"); img.src = url; img.alt = "";
          img.addEventListener("load", tourReflowNode);
          thumb.replaceChild(img, v);
        } catch (_) { /* keep the live video (loadedmetadata reflow already wired) */ }
      }
      var dur = v.duration;
      if (dur && isFinite(dur) && dur > 0) {
        var last = Math.max(0, dur - 0.05);
        if (Math.abs((v.currentTime || 0) - last) < 0.06) { grab(); return; }
        var onSeeked = function () { v.removeEventListener("seeked", onSeeked); grab(); };
        v.addEventListener("seeked", onSeeked);
        try { v.currentTime = last; } catch (_) { v.removeEventListener("seeked", onSeeked); grab(); }
      } else { grab(); }
    }
    // #54: hover a video board node to scrub its playback. Board nodes are static posters (a live
    // <video> is swapped for an <img> by tourVideoToPoster to avoid N decoding videos, #224). On
    // hover we bring a fresh live <video> back for JUST this node (only one is live at a time),
    // map the cursor X across the thumb to currentTime, and restore the cached poster on leave.
    var tourScrubNode = null;
    function tourRestoreScrub(thumb) {
      if (!thumb || !thumb.__scrubVideo) return;
      var v = thumb.__scrubVideo; thumb.__scrubVideo = null;
      if (v.parentNode === thumb) {
        if (thumb.__scrubPoster) thumb.replaceChild(thumb.__scrubPoster, v); else tourVideoToPoster(v, thumb);
      }
      thumb.__scrubPoster = null;
      if (tourScrubNode === thumb) tourScrubNode = null;
    }
    function tourWireHoverScrub(thumb, src) {
      thumb.addEventListener("pointerenter", function () {
        if (tourSpace || tourConnect || thumb.__scrubVideo) return; // don't fight pan / connect
        var poster = thumb.querySelector("img"); if (!poster) return; // poster not ready yet
        if (tourScrubNode && tourScrubNode !== thumb) tourRestoreScrub(tourScrubNode); // only one live
        var v = document.createElement("video"); v.src = src; v.muted = true;
        v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("preload", "auto");
        thumb.__scrubPoster = poster; thumb.__scrubVideo = v; tourScrubNode = thumb;
        thumb.replaceChild(v, poster);
      });
      thumb.addEventListener("pointermove", function (e) {
        var v = thumb.__scrubVideo; if (!v) return;
        var r = thumb.getBoundingClientRect(); if (!r.width) return; // live rect = zoom-correct
        var frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        var dur = v.duration; if (dur && isFinite(dur)) { try { v.currentTime = frac * dur; } catch (_) {} }
      });
      thumb.addEventListener("pointerleave", function () { tourRestoreScrub(thumb); });
    }
    function tourReflowNode(e) {
      if (!tourUI) return;
      var card = e && e.target && e.target.closest ? e.target.closest(".tourb-node") : null;
      var th = card && card.querySelector(".tourb-node__thumb");
      if (card && th) tourThumbHMap[card.getAttribute("data-screen-id")] = th.offsetHeight || TOUR_THUMB_H;
      Array.prototype.forEach.call(tourUI.nodes.querySelectorAll(".tourb-card"), function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
      tourFaceCardPos = {}; tourScreens().forEach(function (s) { if (s) tourLayoutFaceCards(s); });
      renderTourEdges();
    }

    // T5c — build ONE face-up card (reuses the SHIPPED popover render renderBlockNode + the
    // real writeModel/__bind text-commit, so it edits the true model with NO new pipeline).
    function tourBuildFaceCard(m) {
      var pop = h("div", "tourb-card"); pop.setAttribute("data-card", m.id);
      pop.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      (m.blocks || []).forEach(function (child) {
        var node = window.renderBlockNode ? window.renderBlockNode(child) : null;
        if (!node) return;
        node.__block = child;
        Array.prototype.forEach.call(node.querySelectorAll("[data-edit]"), wireTourCardField);
        if (node.getAttribute && node.getAttribute("data-edit") != null) wireTourCardField(node);
        pop.appendChild(node);
      });
      if (!(m.blocks || []).length) pop.appendChild(h("div", "tourb-card__empty", "Empty card"));
      return pop;
    }
    // Distribute a screen's card popovers AROUND its node (left column for pins on the left
    // half, right column for the right half), stacked so they never overlap, each wired back
    // to its pin. Cards live in board space (siblings of the nodes) so they pan/zoom together.
    function tourLayoutFaceCards(s) {
      // face-up shows every card; otherwise just the selected marker's card ("select opens the box")
      var cards = (s.markers || []).filter(function (m) { return m && m.action !== "navigate" && (tourFacesUp || m.id === E.hotspotEditId); });
      if (!cards.length) return;
      var CARD_W = 210, GAP = 14, OFF = 54;
      var left = cards.filter(function (m) { return (m.x == null ? 50 : m.x) < 50; });
      var right = cards.filter(function (m) { return (m.x == null ? 50 : m.x) >= 50; });
      [{ side: "left", list: left }, { side: "right", list: right }].forEach(function (col) {
        var x = col.side === "left" ? (s.bx || 0) - OFF - CARD_W : (s.bx || 0) + TOUR_NODE_W + OFF;
        // start the column a little above the node top so a tall stack stays centred-ish
        var y = (s.by || 0) - Math.max(0, (col.list.length - 2) * 20);
        col.list.forEach(function (m) {
          var pop = tourBuildFaceCard(m);
          pop.style.left = x + "px"; pop.style.top = y + "px"; pop.style.width = CARD_W + "px";
          tourUI.nodes.appendChild(pop);
          var hh = pop.offsetHeight || 90; // board-space layout height (pre-transform)
          var to = { x: col.side === "left" ? x + CARD_W : x, y: y + Math.min(hh / 2, 34) };
          // store s+m so the wire's pin end recomputes live (survives a thumb re-measure)
          tourFaceCardPos[m.id] = { s: s, m: m, to: to };
          y += hh + GAP;
        });
      });
    }
    // Lightweight editable binding for a face-up card field: writes through the SAME
    // writeModel/__bind path the canvas uses, but never triggers a board rebuild (which
    // would blow away the caret mid-edit — so we deliberately do NOT call selectFieldNode).
    function wireTourCardField(node) {
      if (!node.__bind) return;
      node.classList.add("is-editable"); node.setAttribute("contenteditable", "true"); node.setAttribute("spellcheck", "false");
      var pushed = false;
      node.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      node.addEventListener("focus", function () { pushed = false; });
      node.addEventListener("input", function () { if (!pushed) { pushHistory(); pushed = true; } var rich = node.getAttribute("data-rich"); writeModel(node, rich ? node.innerHTML : node.textContent); });
      node.addEventListener("keydown", function (e) { if (e.key === "Enter" && !node.getAttribute("data-rich")) { e.preventDefault(); node.blur(); } });
    }

    // ---- T5b: edge layer (reuses connectorPathD — the data-goto connector maths) ----
    function tourPortPt(s, m) { return { x: (s.bx || 0) + TOUR_NODE_W * ((m.x == null ? 50 : m.x) / 100), y: (s.by || 0) + tourThumbHeight(s) * ((m.y == null ? 50 : m.y) / 100) }; }
    function tourAnchorPt(s) { return { x: (s.bx || 0), y: (s.by || 0) + tourThumbHeight(s) / 2 }; }
    function tourLoopAnchorPt(loop) { return { x: (loop.bx || 0), y: (loop.by || 0) + loopSize(loop).h / 2 }; }
    function renderTourEdges() {
      var svg = tourUI.edges; while (svg.firstChild) svg.removeChild(svg.firstChild);
      var ss = tourScreens();
      // #224 QA: a selected node lights up every connector touching it (in or out), so you can
      // see what links to the screen you picked. Key off tourLinkSel (a selected LINK lights just
      // itself) NOT hotspotEditId -- the re-hosted inspector always pins hotspotEditId to a marker,
      // so a node selection ALSO has a marker "active"; tourLinkSel is the real node-vs-link signal.
      var selNode = (!tourLinkSel && E.hotspotEditScreenId && !tourLoopSel) ? E.hotspotEditScreenId : null;
      ss.forEach(function (s) {
        if (!s) return;
        (s.markers || []).forEach(function (m) {
          if (!m || m.action !== "navigate" || !m.target) return;
          var t = tourScreenById(m.target), loopT = t ? null : tourLoopById(m.target);
          if (!t && !loopT) return;
          var from = tourPortPt(s, m), to = loopT ? tourLoopAnchorPt(loopT) : tourAnchorPt(t), d = connectorPathD(from.x, from.y, to.x, to.y);
          // an edge is highlighted + shows its delete affordance when ITS source marker is
          // the selected link (select a navigate pin -> its line lights up so you can see +
          // remove exactly that connection; click empty space to deselect). No fat hit path:
          // the layer is pointer-through.
          var sel = tourLinkSel === m.id;
          var touchesNode = selNode && (s.id === selNode || m.target === selNode);
          var p = document.createElementNS(SVGNS, "path"); p.setAttribute("class", "tourb-edge" + (sel ? " is-selected" : (touchesNode ? " is-connected" : ""))); p.setAttribute("d", d);
          svg.appendChild(p);
          if (sel) { // delete affordance at the midpoint (pointer-events re-enabled in CSS)
            var mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
            var g = document.createElementNS(SVGNS, "g"); g.setAttribute("class", "tourb-edge__del"); g.setAttribute("transform", "translate(" + mx + "," + my + ")");
            var c = document.createElementNS(SVGNS, "circle"); c.setAttribute("r", "9"); g.appendChild(c);
            var xr = document.createElementNS(SVGNS, "path"); xr.setAttribute("d", "M-3 -3 L3 3 M3 -3 L-3 3"); xr.setAttribute("class", "tourb-edge__del-x"); g.appendChild(xr);
            g.addEventListener("click", function (e) { e.stopPropagation(); tourDeleteEdge(s, m); });
            svg.appendChild(g);
          }
        });
      });
      if (tourConnect) { // draft edge following the cursor
        var p2 = document.createElementNS(SVGNS, "path"); p2.setAttribute("class", "tourb-edge tourb-edge--draft");
        p2.setAttribute("d", connectorPathD(tourConnect.from.x, tourConnect.from.y, tourConnect.cursor.x, tourConnect.cursor.y));
        svg.appendChild(p2);
      }
      // T5c leader wires: pin -> its face-up card (same connector maths as the tour edges).
      // The wire (and its card, below) light up for the selected/hovered marker so it's clear
      // which box belongs to which hotspot.
      Object.keys(tourFaceCardPos).forEach(function (id) {
        var w = tourFaceCardPos[id]; if (!w.s || !w.m) return;
        var from = tourPortPt(w.s, w.m), hot = (tourHotMarker === id);
        var wp = document.createElementNS(SVGNS, "path"); wp.setAttribute("class", "tourb-wire" + (hot ? " is-hot" : ""));
        wp.setAttribute("d", connectorPathD(from.x, from.y, w.to.x, w.to.y, 32));
        svg.appendChild(wp);
      });
      tourApplyCardHot();
    }
    // highlight the card whose marker is selected/hovered (accent border), and de-highlight
    // the rest — so it reads which callout box maps to which pin.
    function tourApplyCardHot() {
      if (!tourUI) return;
      Array.prototype.forEach.call(tourUI.nodes.querySelectorAll(".tourb-card"), function (c) {
        c.classList.toggle("is-hot", c.getAttribute("data-card") === tourHotMarker);
      });
    }
    function tourDeleteEdge(s, m) {
      pushHistory();
      var t = tourScreenById(m.target);
      // mirror the inspector's clearMarkerTarget: drop an orphan destination node
      if (t && !(t.markers || []).length) { var i = tourScreens().indexOf(t); if (i >= 0) tourBlock.screens.splice(i, 1); }
      delete m.target; E.setHotspotEditId(null); tourLinkSel = null;
      reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
    }

    // ---- board coordinate helpers + pan/zoom (reuse the canvas view idiom) ----
    function applyTourTransform() {
      if (!tourUI) return;
      tourUI.layer.style.transform = "translate(" + tourPanX + "px," + tourPanY + "px) scale(" + tourZoom + ")";
      // counter-scale pins/ports/badges so they hold a sensible on-screen size at any zoom
      // (otherwise they blow up + bunch when you zoom in). Clamp so they never get bigger than
      // base (1) nor shrink below ~0.5x screen when zoomed way out.
      tourUI.layer.style.setProperty("--tour-inv", String(Math.max(0.5, Math.min(1, 1 / tourZoom))));
      if (tourUI.zlvl) tourUI.zlvl.textContent = Math.round(tourZoom * 100) + "%";
    }
    function tourClientToBoard(cx, cy) { var r = tourUI.board.getBoundingClientRect(); return { x: (cx - r.left - tourPanX) / tourZoom, y: (cy - r.top - tourPanY) / tourZoom }; }
    function tourFit() {
      if (!tourUI) return;
      var ss = tourScreens(); if (!ss.length) { tourZoom = 1; tourPanX = 40; tourPanY = 40; applyTourTransform(); return; }
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ss.forEach(function (s) { if (!s) return; var x = s.bx || 0, y = s.by || 0; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + TOUR_NODE_W); maxY = Math.max(maxY, y + TOUR_THUMB_H + 40); });
      var r = tourUI.board.getBoundingClientRect(), pad = 60;
      var zw = (r.width - pad * 2) / Math.max(1, maxX - minX), zh = (r.height - pad * 2) / Math.max(1, maxY - minY);
      tourZoom = clamp(Math.min(zw, zh, 1), 0.1, 2);
      tourPanX = (r.width - (maxX - minX) * tourZoom) / 2 - minX * tourZoom;
      tourPanY = (r.height - (maxY - minY) * tourZoom) / 2 - minY * tourZoom;
      applyTourTransform();
    }
    var tourZoomState = 0; // 0 -> fit, 1 -> 100%
    function tourZoomCycle() { tourZoomState = (tourZoomState + 1) % 2; if (tourZoomState === 1) { tourZoom = 1; applyTourTransform(); } else tourFit(); }

    // Arm / disarm click-to-drop placement. Armed = the "Add hotspot" button lights + the board
    // shows a crosshair; the next click on a screen image drops a marker. Cancels any live connect.
    function tourSetPlacing(on) {
      tourPlacing = !!on;
      if (tourPlacing) tourConnect = null;
      if (tourUI) {
        if (tourUI.addHsBtn) tourUI.addHsBtn.classList.toggle("is-armed", tourPlacing);
        if (tourUI.board) tourUI.board.classList.toggle("is-placing", tourPlacing);
      }
    }

    // Open / close the Properties drawer. Collapsed = slid off-screen (board reclaims the width);
    // open = slid in over the right of the board. State lives on tourPanelOpen for the session.
    function tourSetPanelOpen(open) {
      tourPanelOpen = !!open;
      if (tourUI) {
        if (tourUI.panel) tourUI.panel.classList.toggle("is-open", tourPanelOpen);
        if (tourUI.propsBtn) tourUI.propsBtn.classList.toggle("is-on", tourPanelOpen);
      }
    }

    function wireTourBoardGestures() {
      var board = tourUI.board;
      board.setAttribute("tabindex", "-1");
      // Click-to-drop placement (capture phase, so it beats node-select + pan/marquee). While
      // armed, a click on a screen's image drops a marker at that exact x/y% (1:1 with the
      // learner render), selects it, and disarms. A click on anything that isn't a real screen
      // image cancels placement. Reuses the panel "+ Add" seed + refresh path (syncTourBoard).
      board.addEventListener("pointerdown", function (e) {
        if (!tourPlacing || e.button !== 0) return;
        var thumbEl = e.target && e.target.closest ? e.target.closest(".tourb-node__thumb") : null;
        if (!thumbEl || thumbEl.classList.contains("is-empty")) { e.preventDefault(); e.stopPropagation(); tourSetPlacing(false); return; }
        var card = thumbEl.closest(".tourb-node");
        var s = card && tourScreenById(card.getAttribute("data-screen-id"));
        if (!s) { e.preventDefault(); e.stopPropagation(); tourSetPlacing(false); return; }
        e.preventDefault(); e.stopPropagation();
        var r = thumbEl.getBoundingClientRect();
        var x = Math.round(clampPct((e.clientX - r.left) / r.width * 100));
        var y = Math.round(clampPct((e.clientY - r.top) / r.height * 100));
        pushHistory();
        var m = tourMakeMarker(tourBlock, x, y);
        (s.markers = s.markers || []).push(m);
        tourSetPlacing(false);
        tourSelKind = "marker"; E.setHotspotEditScreenId(s.id); E.setHotspotEditId(m.id); tourHotMarker = m.id;
        tourLinkSel = (m.action === "navigate") ? m.id : null;
        // sync the hidden canvas + export, then syncTourBoard() (fires from reselect) redraws the board.
        reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
      }, true);
      // cmd/ctrl-wheel zoom anchored at the cursor; plain wheel/trackpad pans
      board.addEventListener("wheel", function (e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          var b = tourClientToBoard(e.clientX, e.clientY);
          var dy = e.deltaY; if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 100; dy = Math.max(-60, Math.min(60, dy));
          var nz = clamp(tourZoom * Math.exp(-dy * 0.008), 0.1, 8); // #224 QA: closer max zoom for precise hotspot placement
          var r = tourUI.board.getBoundingClientRect();
          tourPanX = (e.clientX - r.left) - b.x * nz; tourPanY = (e.clientY - r.top) - b.y * nz; tourZoom = nz;
          applyTourTransform();
        } else { e.preventDefault(); tourPanX -= e.deltaX; tourPanY -= e.deltaY; applyTourTransform(); }
      }, { passive: false });
      // Space held = pan modifier (mirrors the main canvas), scoped to while the board is open.
      document.addEventListener("keydown", function (e) { if (e.code === "Space" && tourBoardIsOpen() && !(e.target && e.target.closest && e.target.closest("input, textarea, [contenteditable=true]"))) { tourSpace = true; board.classList.add("is-pannable"); } });
      document.addEventListener("keyup", function (e) { if (e.code === "Space") { tourSpace = false; board.classList.remove("is-pannable"); } });
      // Empty-board left-drag = MARQUEE select (box-select nodes); Space/middle-drag = PAN;
      // trackpad two-finger = pan via wheel. Same gesture split as the main canvas.
      var panning = false, last = null, marquee = null;
      function onBg(t) { return t === board || t === tourUI.layer || t === tourUI.edges || t === tourUI.nodes; }
      board.addEventListener("pointerdown", function (e) {
        // #224 QA: PAN works ANYWHERE (over nodes/loops/pins too, not just bare board) -- when
        // zoomed in there's little empty canvas to grab. Middle-button or Space+left starts a pan
        // regardless of target; the node/loop/pin handlers bail on tourSpace/middle (no
        // stopPropagation), so the event bubbles here. This MUST come before the onBg guard.
        if (e.button === 1 || (e.button === 0 && tourSpace)) { panning = true; last = { x: e.clientX, y: e.clientY }; board.classList.add("is-panning"); try { board.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); return; }
        if (!onBg(e.target)) return;
        if (e.button === 0) { // deselect any selected link/loop + start a marquee (cheap
          // updates only — never rebuild the node DOM on pointerdown; that drops the drag)
          if (tourLinkSel) { tourLinkSel = null; renderTourEdges(); tourClearPinSel(); }
          if (tourLoopSel) { tourLoopSel = null; renderTourLoops(); renderTourInspector(); }
          tourStartMarquee(e); e.preventDefault();
        }
      });
      board.addEventListener("pointermove", function (e) {
        if (tourConnect) { tourConnect.cursor = tourClientToBoard(e.clientX, e.clientY); renderTourEdges(); return; }
        if (marquee) { tourUpdateMarquee(e); return; }
        if (!panning) return; var dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; tourPanX += dx; tourPanY += dy; applyTourTransform();
      });
      board.addEventListener("pointerup", function (e) { panning = false; board.classList.remove("is-panning"); if (marquee) tourEndMarquee(); if (tourConnect) tourFinishConnect(e); });
      board.addEventListener("pointercancel", function () { panning = false; board.classList.remove("is-panning"); if (marquee) tourEndMarquee(); tourConnect = null; renderTourEdges(); });

      // marquee lives in board-VIEWPORT space (client px rel. to the board), converted to
      // board coords to hit-test node rects — so it stays correct at any pan/zoom.
      function tourStartMarquee(e) {
        var r = board.getBoundingClientRect();
        marquee = { x0: e.clientX - r.left, y0: e.clientY - r.top, el: h("div", "tourb__marquee"), additive: e.shiftKey };
        // Capture the pointer so every move/up is delivered to the board even as the box
        // sweeps over node cards. Do NOT rebuild the node DOM here (renderTourNodes) — tearing
        // out the subtree under an in-flight pointerdown drops the drag in real browsers; just
        // clear the existing rings in place.
        try { board.setPointerCapture(e.pointerId); } catch (_) {}
        if (!marquee.additive) { tourNodeSel = []; tourApplyNodeSelClasses(); }
        board.appendChild(marquee.el);
      }
      function tourUpdateMarquee(e) {
        var r = board.getBoundingClientRect(), x1 = e.clientX - r.left, y1 = e.clientY - r.top;
        var L = Math.min(marquee.x0, x1), T = Math.min(marquee.y0, y1), W = Math.abs(x1 - marquee.x0), H = Math.abs(y1 - marquee.y0);
        marquee.el.style.left = L + "px"; marquee.el.style.top = T + "px"; marquee.el.style.width = W + "px"; marquee.el.style.height = H + "px";
        var a = tourClientToBoard(marquee.x0 + r.left, marquee.y0 + r.top), b = tourClientToBoard(x1 + r.left, y1 + r.top);
        var bx0 = Math.min(a.x, b.x), by0 = Math.min(a.y, b.y), bx1 = Math.max(a.x, b.x), by1 = Math.max(a.y, b.y);
        var hit = tourScreens().filter(function (s) { return s && !((s.bx || 0) > bx1 || (s.bx || 0) + TOUR_NODE_W < bx0 || (s.by || 0) > by1 || (s.by || 0) + TOUR_NODE_H < by0); }).map(function (s) { return s.id; });
        tourNodeSel = marquee.additive ? tourNodeSel.concat(hit.filter(function (id) { return tourNodeSel.indexOf(id) < 0; })) : hit;
        tourApplyNodeSelClasses();
      }
      function tourEndMarquee() { if (marquee && marquee.el && marquee.el.parentNode) marquee.el.parentNode.removeChild(marquee.el); marquee = null; }
    }
    // cheap restyle of node selection rings without a full re-render (marquee drag is hot)
    function tourApplyNodeSelClasses() {
      if (!tourUI) return;
      Array.prototype.forEach.call(tourUI.nodes.children, function (card) {
        var id = card.getAttribute("data-screen-id");
        card.classList.toggle("is-multi", tourNodeSel.indexOf(id) >= 0);
      });
    }
    function tourClearPinSel() { if (tourUI) Array.prototype.forEach.call(tourUI.nodes.querySelectorAll("[data-pin].is-selected"), function (p) { p.classList.remove("is-selected"); }); }

    // ---- selection ----
    function tourSelectNode(s) { tourSelKind = "node"; tourLoopSel = null; E.setHotspotEditScreenId(s.id); E.setHotspotEditId(null); tourLinkSel = null; tourNodeSel = [s.id]; renderTourInspector(); renderTourNodes(); }
    function tourSelectMarker(s, m) { tourSelKind = "marker"; tourLoopSel = null; E.setHotspotEditScreenId(s.id); E.setHotspotEditId(m.id); tourHotMarker = m.id; tourLinkSel = (m && m.action === "navigate") ? m.id : null; renderTourInspector(); renderTourNodes(); }

    // ---- node pointer: multi-select (shift/cmd-click) + drag reposition (group-aware) ----
    function tourNodePointerDown(s, card, e) {
      if (e.button !== 0 || tourSpace) return;
      if (e.target.closest(".tourb-marker, .tourb-pin, .tourb-port, .tourb-node__title, .tourb-node__caption, .tourb-card")) return;
      e.stopPropagation();
      // shift / cmd / ctrl-click TOGGLES this node in the multi-selection (no drag).
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        var i = tourNodeSel.indexOf(s.id);
        if (i >= 0) tourNodeSel.splice(i, 1); else tourNodeSel.push(s.id);
        tourSelKind = "node"; E.setHotspotEditScreenId(s.id); E.setHotspotEditId(null); tourLoopSel = null; tourLinkSel = null;
        renderTourInspector(); tourApplyNodeSelClasses(); renderTourEdges(); // #224 QA: light this node's connectors
        return;
      }
      var inGroup = tourNodeSel.indexOf(s.id) >= 0 && tourNodeSel.length > 1;
      var start = { x: e.clientX, y: e.clientY }, moved = false, pushedH = false, group = null;
      try { card.setPointerCapture(e.pointerId); } catch (_) {}
      function ensureGroup() {
        if (group) return;
        if (!inGroup) { tourNodeSel = [s.id]; tourApplyNodeSelClasses(); }
        group = (inGroup ? tourNodeSel : [s.id]).map(function (id) { var sc = tourScreenById(id); return sc ? { sc: sc, el: tourUI.nodes.querySelector('.tourb-node[data-screen-id="' + id + '"]'), ox: sc.bx || 0, oy: sc.by || 0 } : null; }).filter(Boolean);
      }
      function mv(ev) {
        if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 4) return;
        if (!pushedH) { pushHistory(); pushedH = true; }
        moved = true; ensureGroup();
        var dx = (ev.clientX - start.x) / tourZoom, dy = (ev.clientY - start.y) / tourZoom;
        group.forEach(function (g) { g.sc.bx = Math.round(g.ox + dx); g.sc.by = Math.round(g.oy + dy); if (g.el) { g.el.classList.add("is-dragging"); g.el.style.left = g.sc.bx + "px"; g.el.style.top = g.sc.by + "px"; } });
        renderTourEdges();
      }
      function up() {
        card.removeEventListener("pointermove", mv); card.removeEventListener("pointerup", up);
        if (group) group.forEach(function (g) { if (g.el) g.el.classList.remove("is-dragging"); });
        if (!moved) { tourSelectNode(s); return; }   // a click (no drag) single-selects
        // #224 T6: a dropped node may have entered/left/re-ordered a loop frame's membership.
        var changed = false;
        (group || [{ sc: s }]).forEach(function (g) { if (tourResolveMembership(g.sc)) changed = true; });
        scheduleSave();
        if (changed) { renderTourInspector(); renderTourNodes(); }
      }
      card.addEventListener("pointermove", mv); card.addEventListener("pointerup", up);
    }

    // ---- pin drag: reposition a marker on its screen (set x/y%), click to select ----
    function tourBeginPinDrag(s, m, pin, thumb, e) {
      if (e.button !== 0 || tourSpace) return; // Space held -> let the board pan (#224 QA)
      e.stopPropagation();
      var start = { x: e.clientX, y: e.clientY }, moved = false, pushed = false;
      var port = thumb.querySelector('.tourb-port[data-port="' + m.id + '"]');
      try { pin.setPointerCapture(e.pointerId); } catch (_) {}
      function mv(ev) {
        if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return;
        if (!pushed) { pushHistory(); pushed = true; }
        moved = true;
        var r = thumb.getBoundingClientRect();
        m.x = Math.round(clampPct((ev.clientX - r.left) / r.width * 100));
        m.y = Math.round(clampPct((ev.clientY - r.top) / r.height * 100));
        pin.style.left = m.x + "%"; pin.style.top = m.y + "%";
        if (port) { port.style.left = m.x + "%"; port.style.top = m.y + "%"; }
        renderTourEdges();
      }
      function up() {
        pin.removeEventListener("pointermove", mv); pin.removeEventListener("pointerup", up);
        if (!moved) { tourSelectMarker(s, m); return; }
        // commit: keep the hidden canvas + the inspector's X/Y in sync via the normal path
        scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
      }
      pin.addEventListener("pointermove", mv); pin.addEventListener("pointerup", up);
    }

    // ---- #48 box resize: drag the corner handle to size a region marker (m.w / m.h %). The
    // box is centred on m.x/m.y, so the BR corner sits at (x + w/2, y + h/2); half-extent =
    // cursor% - centre%, doubled back into w/h. stopPropagation keeps the pin-drag off. ----
    function tourBeginPinResize(s, m, pin, thumb, e) {
      if (e.button !== 0 || tourSpace) return;
      e.stopPropagation(); e.preventDefault();
      var pushed = false;
      try { pin.setPointerCapture(e.pointerId); } catch (_) {}
      function mv(ev) {
        if (!pushed) { pushHistory(); pushed = true; }
        var r = thumb.getBoundingClientRect();
        var cx = m.x == null ? 50 : m.x, cy = m.y == null ? 50 : m.y;
        var px = clampPct((ev.clientX - r.left) / r.width * 100);
        var py = clampPct((ev.clientY - r.top) / r.height * 100);
        m.w = Math.max(2, Math.min(100, Math.round((px - cx) * 2)));
        m.h = Math.max(2, Math.min(100, Math.round((py - cy) * 2)));
        pin.style.width = m.w + "%"; pin.style.height = m.h + "%";
      }
      function up() {
        pin.removeEventListener("pointermove", mv); pin.removeEventListener("pointerup", up);
        if (pushed) { scheduleSave(); reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); }
      }
      pin.addEventListener("pointermove", mv); pin.addEventListener("pointerup", up);
    }

    // ---- T5b: drag-to-connect (port -> node sets/repoints marker.target) ----
    function tourBeginConnect(s, m, e) {
      if (e.button !== 0 || tourSpace) return; // Space held -> let the board pan (#224 QA)
      e.stopPropagation(); e.preventDefault();
      tourConnect = { srcId: m.id, srcScreen: s, marker: m, from: tourPortPt(s, m), cursor: tourPortPt(s, m) };
      renderTourEdges();
    }
    function tourFinishConnect(e) {
      var conn = tourConnect; tourConnect = null;
      if (!conn) return;
      // drop target = the screen node OR the loop frame under the cursor (#224 T6: a navigate
      // marker can point at a loop exactly as it points at a screen — same marker.target).
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var card = el && el.closest ? el.closest(".tourb-node") : null;
      var loopEl = !card && el && el.closest ? el.closest(".tourb-loop") : null;
      var tid = (card && card.getAttribute("data-screen-id")) || (loopEl && loopEl.getAttribute("data-loop-id"));
      if (tid && tid !== conn.srcScreen.id) {
        pushHistory(); conn.marker.target = tid; conn.marker.action = "navigate";
        reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block");
      } else { renderTourEdges(); }
    }

    // ---- multi-file upload (T5a): each file -> a new screen node in a grid ----
    function tourUploadScreens() {
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,.svg,video/*"; inp.multiple = true;
      inp.addEventListener("change", function () {
        var files = inp.files ? Array.prototype.slice.call(inp.files) : []; if (!files.length) return;
        pushHistory();
        var ss = tourScreens(), gapX = TOUR_NODE_W + 90, gapY = TOUR_THUMB_H + 130, perRow = 4, base = ss.length, pending = files.length;
        files.forEach(function (f, k) {
          var r = new FileReader();
          r.onload = function () {
            var sid = "scr-" + Math.random().toString(36).slice(2, 8); while (tourScreenById(sid)) sid += "x";
            var idx = base + k, col = idx % perRow, row = Math.floor(idx / perRow);
            // inherit the screen name from the uploaded file name (drop the extension)
            var nm = (f.name || "").replace(/\.[^.]+$/, "").trim();
            var newScr = { id: sid, visual: assetRef(r.result, f), kind: (f.type && f.type.indexOf("video/") === 0) ? "video" : "image", alt: "", markers: [], bx: 80 + col * gapX, by: 60 + row * gapY };
            if (nm) newScr.name = nm;
            tourBlock.screens.push(newScr);
            if (--pending === 0) { reapplyStructural(findPageOfBlock(tourBlock)); reselectBlockNode(tourBlock, "block"); }
          };
          r.readAsDataURL(f);
        });
      });
      inp.click();
    }

    // #224 QA: Cmd/Ctrl+T tidies the node layout into a grid (when the builder is open and
    // not typing). preventDefault so the shell doesn't open a new tab; the Tidy bar button is
    // the fallback where a browser reserves Cmd+T.
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "t" || e.key === "T") && tourBoardIsOpen() && !tourPreviewIsOpen()) {
        if (e.target && e.target.closest && e.target.closest("input, textarea, [contenteditable=true]")) return;
        e.preventDefault(); e.stopPropagation(); tourTidyLayout();
      }
    });
    // global Escape-to-close (mirrors the course browser's single keydown guard)
    document.addEventListener("keydown", function (e) {
      // the isolated preview sits ABOVE the builder -> Escape closes it first
      if (e.key === "Escape" && tourPreviewIsOpen()) { e.preventDefault(); e.stopPropagation(); closeTourPreview(); return; }
      if (e.key === "Escape" && tourBoardIsOpen()) {
        // Esc while typing in a card / title first blurs the field (don't exit the builder).
        var inField = e.target && e.target.closest && e.target.closest(".tourb-node__title, .tourb-node__caption, [contenteditable=true]");
        if (inField) { e.preventDefault(); try { e.target.blur(); } catch (_) {} return; }
        // an OPEN pending ripple cut cancels first (the most transient mode) and stops there.
        if (tourActiveCutCancel) { e.preventDefault(); e.stopPropagation(); tourActiveCutCancel(); return; }
        // then a SELECTED cut band deselects (before stepping out of any other board mode).
        if (tourActiveCutSel) { e.preventDefault(); e.stopPropagation(); tourActiveCutSel(); return; }
        // armed click-to-drop disarms first (a mode you can back out of before it closes anything).
        if (tourPlacing) { e.preventDefault(); tourSetPlacing(false); return; }
        // an open Properties drawer closes next (on-demand surface, easy to dismiss).
        if (tourPanelOpen) { e.preventDefault(); tourSetPanelOpen(false); return; }
        // otherwise step out one level at a time: Cards face-up mode, then a selected link,
        // then a multi-selection, then close. (Do NOT gate on hotspotEditId — the re-hosted
        // inspector always pins it to a marker, so that would never let Escape reach close.)
        if (tourFacesUp) { e.preventDefault(); tourFacesUp = false; if (tourUI && tourUI.faceWrap) tourBuildFaceSwitch(tourUI.faceWrap); renderTourNodes(); return; }
        if (tourLoopSel) { e.preventDefault(); tourLoopSel = null; renderTourLoops(); renderTourInspector(); return; }
        if (tourLinkSel) { e.preventDefault(); tourLinkSel = null; renderTourEdges(); tourClearPinSel(); return; }
        if (tourNodeSel.length) { e.preventDefault(); tourNodeSel = []; tourApplyNodeSelClasses(); return; }
        e.preventDefault(); e.stopPropagation(); closeTourBuilder(); // don't let the close Esc reach main-editor handlers
      }
    });
    // Fine-tune placement: arrow keys nudge the selected marker (0.5% / 2% with Shift). Gives
    // sub-pixel control the drag can't, and stays 1:1 with the learner render (percent coords).
    document.addEventListener("keydown", function (e) {
      if (!tourBoardIsOpen() || !E.hotspotEditId) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) < 0) return;
      if (e.target && e.target.closest && e.target.closest("input, textarea, [contenteditable=true]")) return;
      var m = findHotspot(tourBlock, E.hotspotEditId); if (!m) return;
      e.preventDefault();
      var step = e.shiftKey ? 2 : 0.5;
      if (e.key === "ArrowLeft") m.x = clampPct((m.x == null ? 50 : m.x) - step);
      else if (e.key === "ArrowRight") m.x = clampPct((m.x == null ? 50 : m.x) + step);
      else if (e.key === "ArrowUp") m.y = clampPct((m.y == null ? 50 : m.y) - step);
      else m.y = clampPct((m.y == null ? 50 : m.y) + step);
      // move the pin + its port in place, repaint wires/edges; persist (no heavy rebuild)
      var pin = tourUI.nodes.querySelector('[data-pin="' + m.id + '"]');
      var port = tourUI.nodes.querySelector('.tourb-port[data-port="' + m.id + '"]');
      if (pin) { pin.style.left = m.x + "%"; pin.style.top = m.y + "%"; }
      if (port) { port.style.left = m.x + "%"; port.style.top = m.y + "%"; }
      renderTourEdges(); scheduleSave();
    });
    kernel.expose({
      openTourBuilder: openTourBuilder,
      closeTourBuilder: closeTourBuilder,
      tourBoardIsOpen: tourBoardIsOpen,
      syncTourBoard: syncTourBoard,
      maybeReopenTourBuilder: maybeReopenTourBuilder
    });
    return VersoTourBoard;
  }

  var VersoTourBoard = { install: install };
  window.VersoTourBoard = VersoTourBoard;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoTourBoard;
})();
