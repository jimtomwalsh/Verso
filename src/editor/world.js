// editor/world.js -- how the canvas gets built and painted (arch-P3b-07world).
//
// One WORLD, many frames. Every page in the course is a frame, laid out in columns -- one column
// per chapter -- and the whole thing is a single transformed surface that pan and zoom move. This
// file is the loop that produces it: `buildWorld` renders the frames, `layoutColumns` measures
// their TRUE heights and stacks them, an observer restacks when a frame changes size, and
// `drawConnectors` paints the interaction links over the top.
//
// WHY MEASURE-THEN-STACK. A frame's height is not known until its page has rendered, because
// content flows. So the pass is: render every frame at natural height, measure, stack from the
// measurements, then draw connectors against the stacked positions. Anything that changes a
// frame's height afterwards -- an image loading, a variant switch -- has to run that tail again,
// which is what `scheduleRestack` and the ResizeObserver are for. Get the order wrong and the
// connectors point at where a frame used to be.
//
// IT CAME OUT FROM UNDER THE WRONG BANNER. A banner reading "JJJJ: page drag-reparent" claimed
// 502 lines; 50 of them were the drag (now `pages.js`) and the rest were this. Nothing about
// building the world is about reparenting a page.
//
// WHAT IT STILL ASKS EDITOR.JS FOR, and this is the point of the slice: the canvas GEOMETRY.
// `world`, `framePos`, `frameDescs`, `FRAME_W`, `frameX`, `frameY`, `colX`, `worldW`, `SVGNS` and
// the spacing constants are minted by `mount()` and read here. They are not this module's to own
// -- `mount` is the boot-shaped core `arch-p3b-08` claims -- so they cross the kernel, and 08
// decides where the state and its builder finally sit together.
//
// Editor chrome only. Each frame's CONTENT comes from render.js untouched; everything this file
// adds is a wrapper, an overlay or an SVG line, and none of it reaches into render().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "SVGNS", "LABEL_H", "frameX", "frameY", "pushHistory",
      "mount", "colX", "GAP_Y", "setSelection", "worldW", "focusFrame",
      "setActivePage", "showContextMenu", "mergePageWithNext", "revealFrameBlocks", "promptModal",
      "showAllConnectorsOn", "BREAKPOINTS", "currentDoc", "editorAssetResolve", "pageDisplayName", "pageDragSuppressed",
      "previewVariant", "copySelection", "pageClipboardNow", "pastePage", "duplicatePage", "hasMergeableNext",
      "savePageAsLibraryMaster", "deletePage", "wirePageDrag", "REVEAL_GLYPH_SVG", "activeModeNow", "applyLayoutVars",
      "cap", "makeGridOverlay", "makeDropTarget", "fitChapter",
      "createChapter", "CHAPTER_HEADER_H", "FRAME_CULL", "interactModeOn", "clamp", "conditionSources",
      "isPreview", "addPageAfter", "activeTheme", "setWorld", "setFramePos", "setFrameDescs",
      "setWorldH", "setNumCols", "setCurrentPage", "FRAME_W", "doc", "selection",
      "FRAME_H", "activeBp", "currentPage", "activeVariant", "multiSel", "gridMode",
      "world", "framePos", "frameDescs", "worldH", "numCols"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        SVGNS = E.SVGNS,
        LABEL_H = E.LABEL_H,
        frameX = E.frameX,
        frameY = E.frameY,
        pushHistory = E.pushHistory,
        mount = E.mount,
        colX = E.colX,
        GAP_Y = E.GAP_Y,
        setSelection = E.setSelection,
        worldW = E.worldW,
        focusFrame = E.focusFrame,
        setActivePage = E.setActivePage,
        showContextMenu = E.showContextMenu,
        mergePageWithNext = E.mergePageWithNext,
        revealFrameBlocks = E.revealFrameBlocks,
        promptModal = E.promptModal,
        showAllConnectorsOn = E.showAllConnectorsOn,
        BREAKPOINTS = E.BREAKPOINTS,
        currentDoc = E.currentDoc,
        editorAssetResolve = E.editorAssetResolve,
        pageDisplayName = E.pageDisplayName,
        pageDragSuppressed = E.pageDragSuppressed,
        previewVariant = E.previewVariant,
        copySelection = E.copySelection,
        pageClipboardNow = E.pageClipboardNow,
        pastePage = E.pastePage,
        duplicatePage = E.duplicatePage,
        hasMergeableNext = E.hasMergeableNext,
        savePageAsLibraryMaster = E.savePageAsLibraryMaster,
        deletePage = E.deletePage,
        wirePageDrag = E.wirePageDrag,
        REVEAL_GLYPH_SVG = E.REVEAL_GLYPH_SVG,
        activeModeNow = E.activeModeNow,
        applyLayoutVars = E.applyLayoutVars,
        cap = E.cap,
        makeGridOverlay = E.makeGridOverlay,
        makeDropTarget = E.makeDropTarget,
        fitChapter = E.fitChapter,
        createChapter = E.createChapter,
        CHAPTER_HEADER_H = E.CHAPTER_HEADER_H,
        FRAME_CULL = E.FRAME_CULL,
        interactModeOn = E.interactModeOn,
        clamp = E.clamp,
        conditionSources = E.conditionSources,
        isPreview = E.isPreview,
        addPageAfter = E.addPageAfter,
        activeTheme = E.activeTheme,
        setWorld = E.setWorld,
        setFramePos = E.setFramePos,
        setFrameDescs = E.setFrameDescs,
        setWorldH = E.setWorldH,
        setNumCols = E.setNumCols,
        setCurrentPage = E.setCurrentPage;

    // ---- build the multi-frame world -----------------------------------------
    // Frames render at FULL content length (no internal scroll). A fold marker
    // shows the device viewport line so you can gauge how much content sits below
    // the fold. Real scrolling lives in demo mode, not the authoring canvas.
    // SPEC 7 canvas geometry: a page renders through the SAME renderPage() in every geometry
    // (pure-render invariant held); only the frame CONTAINER changes per doc.meta.geo. reflow
    // = today's fluid vertical flow (no rule -> pixel-identical). frame = a fixed one-screen
    // surface that clips + warns on overflow. paged = a page-height surface with page-break
    // guides, so content flows across page sections. These two helpers are PURE (headless-
    // tested); the geometry itself is CSS on `.world.geo-<geo> .frame`, driven off this class.
    /* @pure-geo-canvas-start */
    function worldGeoClass(geo) { return "geo-" + (geo === "frame" || geo === "paged" ? geo : "reflow"); }
    function frameContentOverflows(scrollH, clientH) { return clientH > 0 && scrollH > clientH + 2; }
    /* @pure-geo-canvas-end */
    var _worldGeo = "reflow";

    function buildWorld() {
      E.setWorld(h("div", "world"));
      E.setFrameDescs([]);
      var deviceH = BREAKPOINTS[E.activeBp].h;
      var renderDoc = currentDoc(); // base doc, or the resolved doc when previewing a variant
      // Geometry cell drives the frame container (reflow / frame / paged). Untagged/legacy docs
      // resolve to reflow via the doc-type model -> today's canvas, unchanged.
      _worldGeo = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(renderDoc).geo : "reflow";
      E.world.classList.add(worldGeoClass(_worldGeo));

      // JJJJ: group pages into chapter COLUMNS; each page's column X is known now
      // (its row Y is set after measure in layoutColumns). page.id -> {col,row}.
      var chapters = (window.groupPagesByChapter ? window.groupPagesByChapter(renderDoc) : [{ pages: renderDoc.pages }]);
      // arch-P1: the whole per-pass render context (nav, styles, gates, motion, glossary) comes
      // from ONE builder the export calls too, so the canvas and the shipped package cannot
      // disagree about what render sees. src/render-context.js.
      window.applyRenderContext(window.buildRenderContext(renderDoc));
      E.setNumCols(Math.max(1, chapters.length));
      E.setFramePos([]);
      var colRowById = {};
      chapters.forEach(function (ch, c) { (ch.pages || []).forEach(function (p, r) { colRowById[p.id] = { col: c, row: r }; }); });
      E.world.style.width = worldW() + "px";

      // YY: swap asset refs -> objectURL/data: on the doc for the duration of the
      // render, then restore, so node.__block keeps pointing at the real doc blocks
      // (editing depends on it) and the stored doc keeps its lean "asset:<id>" refs.
      var __restoreMedia = (window.resolveMedia && window.AssetStore) ? window.resolveMedia(renderDoc, editorAssetResolve) : null;
      try {
      renderDoc.pages.forEach(function (page, i) {
        var loc = colRowById[page.id] || { col: 0, row: i };
        E.framePos[i] = { x: colX(loc.col), y: 0, col: loc.col, row: loc.row };
        var wrap = h("div", "frame-wrap");
        wrap.style.left = E.framePos[i].x + "px"; wrap.style.top = "0px"; wrap.style.width = E.FRAME_W + "px";
        var label = h("div", "frame-label" + (i === E.currentPage ? " is-active" : ""));
        label.appendChild(h("span", "frame-label__name", pageDisplayName(page, E.doc)));
        label.addEventListener("click", function () { if (pageDragSuppressed()) return; focusFrame(i); setActivePage(i); setSelection("page", i); });
        label.addEventListener("contextmenu", (function (pi, pg) { return function (e) {
          e.preventDefault(); e.stopPropagation();
          // Previewing a variant shows resolved clones -> don't mutate page structure.
          if (E.activeVariant) {
            showContextMenu(e.clientX, e.clientY, [
              { head: "Previewing: " + E.activeVariant },
              { label: "Switch to Flagship to edit pages", onClick: function () { previewVariant(null); } }
            ]);
            return;
          }
          focusFrame(pi); setActivePage(pi); setSelection("page", pi);
          var items = [{ head: pg.name || "Page" }];
          items.push({ label: "Copy page", onClick: function () { setSelection("page", pi); copySelection(); } });
          if (pageClipboardNow()) items.push({ label: "Paste page after", onClick: function () { E.setCurrentPage(pi); pastePage(); } });
          items.push({ label: "Duplicate page", onClick: function () { duplicatePage(pi); } });
          if (hasMergeableNext(pi)) items.push({ label: "Merge with next page", onClick: function () { mergePageWithNext(pi); } });
          items.push({ label: "Save page to library…", onClick: function () { savePageAsLibraryMaster(pi); } });
          if (E.doc.pages.length > 1) {
            items.push({ sep: true });
            items.push({ label: "Delete page", danger: true, onClick: function () { deletePage(pi); } });
          }
          showContextMenu(e.clientX, e.clientY, items);
        }; })(i, page));
        wirePageDrag(label, i);
        // Item U: reveal-all-blocks glyph. On hover it outlines every block on this
        // page at once (a quick visual map + where the empty gaps are), with a small
        // type tag on each. Editor chrome only -- the class/tag are added on the live
        // canvas DOM and removed on mouseout, so exported output is untouched.
        var revealGlyph = h("span", "frame-label__reveal");
        revealGlyph.innerHTML = REVEAL_GLYPH_SVG; // inject as markup, not textContent, so the icon draws (CC)
        revealGlyph.title = "Reveal all blocks on this page";
        revealGlyph.addEventListener("mouseenter", function () { revealFrameBlocks(frame, true); });
        revealGlyph.addEventListener("mouseleave", function () { revealFrameBlocks(frame, false); });
        revealGlyph.addEventListener("click", function (e) { e.stopPropagation(); });
        label.appendChild(revealGlyph);

        var frame = h("div", "frame");
        frame.style.width = E.FRAME_W + "px";
        frame.style.minHeight = deviceH + "px"; // every frame is at least one full device screen
        frame.style.setProperty("--vp-h", deviceH + "px"); // fill-layout viewport ref (auto spacers); exported course falls back to 100vh
        frame.style.backgroundColor = activeTheme().color.bg;
        var cr = window.renderPage(page, activeTheme(), window.resolveHeaderFooter(renderDoc, page));
        cr.setAttribute("data-bp", E.activeBp);   // course.css responsive rules key off this
        cr.setAttribute("data-mode", activeModeNow()); // logo auto-tint keys off this
        applyLayoutVars(cr, page);              // master page padding (+ per-page override)
        frame.appendChild(cr);

        // fold marker at the device viewport height (clipped by frame if content
        // is shorter than a screenful, i.e. only shows when there IS a fold)
        var fold = h("div", "fold-line");
        fold.style.top = deviceH + "px";
        fold.appendChild(h("span", "fold-line__label", cap(E.activeBp) + " fold · " + deviceH + "px"));
        frame.appendChild(fold);

        // Alignment grid overlay on the ACTIVE page only (editor chrome; see refreshGridOverlay)
        if (i === E.currentPage && E.gridMode !== "off") frame.appendChild(makeGridOverlay());

        makeDropTarget(frame, (function (pi) { return function () { return { pageIndex: pi, append: true }; }; })(i), "drop-into");

        wrap.appendChild(label); wrap.appendChild(frame);
        E.world.appendChild(wrap);
        E.frameDescs.push({ wrap: wrap, frame: frame, label: label, i: i });
      });
      } finally { if (__restoreMedia) __restoreMedia(); }

      // JJJJ: a header atop each chapter COLUMN (name + page count; double-click to rename).
      // Empty chapters still show a header so they're a visible column.
      // uio-E-M04 (EDIT-13): the header is a flat LABEL, not a tab -- it used to carry a border,
      // a fill and ‹ › × buttons, so a chapter marker read as a closable document window (a third
      // navigator, nearest the work). The verbs were duplicates: the outline's chapter row already
      // drags to reorder and right-clicks to delete, and that is where movement belongs.
      chapters.forEach(function (ch, c) {
        var hdr = h("div", "chapter-header");
        hdr.style.left = colX(c) + "px"; hdr.style.top = "0px"; hdr.style.width = E.FRAME_W + "px";
        hdr.appendChild(h("span", "chapter-header__name", ch.name || "Chapter"));
        var n = ch.pages ? ch.pages.length : 0;
        hdr.appendChild(h("span", "chapter-header__count", n + (n === 1 ? " page" : " pages")));
        hdr.title = "Click to fit this chapter · double-click to rename";
        hdr.addEventListener("click", (function (col) { return function () { fitChapter(col); }; })(c));
        hdr.addEventListener("dblclick", function () {
          if (!ch.id) return;
          promptModal("Rename chapter", "Name", ch.name || "", function (nm) {
            if (nm == null) return;
            var real = (E.doc.chapters || []).filter(function (x) { return x.id === ch.id; })[0];
            if (real) { pushHistory(); real.name = nm; mount(); }
          });
        });
        E.world.appendChild(hdr);
      });

      // JJJJ: "+ Chapter" affordance in the next column slot -> creates an empty chapter.
      var addCh = h("div", "chapter-header chapter-header--add");
      addCh.style.left = colX(chapters.length) + "px"; addCh.style.top = "0px"; addCh.style.width = E.FRAME_W + "px";
      addCh.appendChild(h("span", "chapter-header__name", "+ Chapter"));
      addCh.title = "Add a chapter (empty column)";
      addCh.addEventListener("click", function () {
        promptModal("New chapter", "Name", "Chapter " + ((E.doc.chapters || []).length + 1), function (nm) {
          if (nm == null) return;
          pushHistory(); createChapter((nm || "").trim() || undefined); mount();
        });
      });
      E.world.appendChild(addCh);
      // widen the world so the + column is reachable
      E.world.style.width = (colX(chapters.length) + E.FRAME_W) + "px";
      observeFrames(); // re-stack the column whenever a frame's height settles (images / embeds / font swap)
      return E.world;
    }

    // JJJJ: measure frame heights (must be in the DOM), then stack each chapter
    // COLUMN vertically (independent masonry stacks) -- sets framePos[i].y + each
    // wrap.top + worldH. Runs before connectors so their geometry is correct.
    function layoutColumns() {
      var colY = [];
      E.frameDescs.forEach(function (f) {
        f.h = f.frame.offsetHeight;
        var c = (E.framePos[f.i] && E.framePos[f.i].col) || 0;
        if (colY[c] == null) colY[c] = CHAPTER_HEADER_H; // leave room for the chapter header bar
        if (E.framePos[f.i]) E.framePos[f.i].y = colY[c];
        f.wrap.style.top = colY[c] + "px";
        colY[c] += LABEL_H + f.h + GAP_Y;
      });
      var maxH = 0;
      colY.forEach(function (y) { if (y != null && y - GAP_Y > maxH) maxH = y - GAP_Y; });
      E.setWorldH(maxH || E.FRAME_H);
      E.world.style.height = E.worldH + "px";
      // SPEC 7: in fixed-frame geometry a page is clipped to one screen -- flag any frame whose
      // content overflows so the canvas shows the amber warning (never silently spawns a slide).
      // Measured here (post-attach) before culling, alongside the height reads above.
      if (_worldGeo === "frame") E.frameDescs.forEach(function (f) {
        if (f.frame) f.frame.classList.toggle("is-overflowing", frameContentOverflows(f.frame.scrollHeight, f.frame.clientHeight));
      });
      // Perf (#150): now that the heights are measured + stacked, pin each frame's
      // contain-intrinsic-size and enable content-visibility:auto, so the browser SKIPS
      // painting + laying-out pages scrolled out of the viewport. The frame's own bg still
      // paints (only its contents are skipped), and scrolling one into view renders it on demand.
      //
      // #348, MEASURED 2026-08-07: this comment used to claim that measuring a frame forces its
      // own layout, so the seed height is always exact. That claim is FALSE.
      // A skipped frame's offsetHeight returns its contain-intrinsic-size, not its real
      // content height -- 34 of 37 offscreen frames in a Puppeteer harness returned exactly the
      // seeded value, off by up to 900px. So `f.h` above is a re-read of our own last guess for
      // every culled offscreen frame, and a seed that goes stale (an image lands, the web font
      // swaps, a block is edited off-view) can never correct itself. Left as-is deliberately
      // until the flicker driver is confirmed on a real course -- see __cullDiag below.
      if (FRAME_CULL && CULL_ON) E.frameDescs.forEach(function (f) {
        if (!f.frame) return;
        f.frame.style.containIntrinsicSize = E.FRAME_W + "px " + Math.round(f.h || E.FRAME_H) + "px";
        f.frame.classList.add("frame--cull");
      });
      _diag.restacks++;
    }

    // ---- #348: the frame cull is OFF by default -------------------------------------------
    // Measured on a real 61-page course, not inferred. With the cull ON, fragments of pages
    // flicker in and out on a STILL canvas at far zoom; with it OFF, a still canvas is quiet.
    // The JS loop is not what churns -- a 5s idle sample read 1 restack, 2 ResizeObserver fires
    // and every frame reserving exactly its real height. So the thrash is the browser's own
    // render/skip decision at the relevance boundary, which we cannot damp from inside the loop.
    //
    // The cull only earns anything when frames are OFF screen. At the far zoom where this bites,
    // the whole world is on screen and it buys nothing, so off is not much of a trade. It stays
    // behind `__frameCull(true)` for the far-zoom detail work, which needs a real stand-in for a
    // page rather than a cull (filed separately), and `__cullDiag(secs)` still reports the churn.
    var CULL_ON = false;
    try { if (localStorage.getItem("authoring.frameCull") === "1") CULL_ON = true; } catch (e) {}
    var _diag = { restacks: 0, roFires: 0 };
    window.__frameCull = function (on) {
      CULL_ON = (on == null) ? CULL_ON : !!on;
      try { localStorage.setItem("authoring.frameCull", CULL_ON ? "1" : "0"); } catch (e) {}
      E.frameDescs.forEach(function (f) {
        if (!f.frame) return;
        if (CULL_ON) { f.frame.style.containIntrinsicSize = E.FRAME_W + "px " + Math.round(f.h || E.FRAME_H) + "px"; f.frame.classList.add("frame--cull"); }
        else { f.frame.classList.remove("frame--cull"); f.frame.style.containIntrinsicSize = ""; }
      });
      if (window.console) console.log("[frame-cull] " + (CULL_ON ? "ON" : "OFF (persists across reload)"));
      return CULL_ON;
    };
    // Sample for `secs` seconds WITHOUT touching anything, then report. renderSetChanges is the
    // number that matters: on a still canvas it should be 0, and anything else is the thrash.
    window.__cullDiag = function (secs) {
      secs = secs || 3;
      var start = { restacks: _diag.restacks, roFires: _diag.roFires };
      var last = null, setChanges = 0, everToggled = {};
      var iv = setInterval(function () {
        var set = E.frameDescs.map(function (f, i) {
          // Check the frame's CONTENT, not the frame. `content-visibility: auto` skips an
          // element's CONTENTS -- the element itself is never the thing reported as skipped, so
          // checkVisibility on f.frame answers true forever and the counter reads a flat zero
          // while the screen is visibly thrashing. That is what it did on the first real reading.
          var content = f.frame && f.frame.firstElementChild;
          var vis = content && content.checkVisibility ? content.checkVisibility({ contentVisibilityAuto: true }) : true;
          if (last && last[i] !== (vis ? "1" : "0")) everToggled[i] = (everToggled[i] || 0) + 1;
          return vis ? "1" : "0";
        });
        if (last && set.join("") !== last.join("")) setChanges++;
        last = set;
      }, 16);
      return new Promise(function (resolve) {
        setTimeout(function () {
          clearInterval(iv);
          // Only meaningful while the cull is ON. With it off there is no reserved box to be
          // wrong, and parsing the cleared style as 0 reported every frame as mismatched by its
          // full height -- an artefact that reads exactly like a catastrophic finding.
          var mism = CULL_ON ? [] : null;
          if (CULL_ON) E.frameDescs.forEach(function (f, i) {
            if (!f.frame) return;
            var seeded = parseFloat((f.frame.style.containIntrinsicSize || "0px 0px").split(" ")[1]) || 0;
            var prev = f.frame.style.contentVisibility;
            f.frame.style.contentVisibility = "visible";
            var real = f.frame.offsetHeight;
            f.frame.style.contentVisibility = prev;
            if (Math.abs(real - seeded) > 1) mism.push({ frame: i, reserved: Math.round(seeded), real: real, offBy: Math.round(real - seeded) });
          });
          var worst = Object.keys(everToggled).sort(function (a, b) { return everToggled[b] - everToggled[a]; }).slice(0, 8)
            .map(function (k) { return "frame " + k + " x" + everToggled[k]; });
          var r = {
            seconds: secs, cullOn: CULL_ON, frames: E.frameDescs.length,
            restacks: _diag.restacks - start.restacks,
            resizeObserverFires: _diag.roFires - start.roFires,
            renderSetChanges: setChanges,
            framesThatToggled: worst,
            reservedHeightWrong: mism ? mism.length : "n/a (cull off)",
            worstMismatches: mism ? mism.sort(function (a, b) { return Math.abs(b.offBy) - Math.abs(a.offBy); }).slice(0, 8) : []
          };
          if (window.console) console.log("[cull-diag]", JSON.stringify(r, null, 2));
          resolve(r);
        }, secs * 1000);
      });
    };

    // Spacing consistency: a frame's rendered height can change AFTER the initial
    // layoutColumns measure — an image finishes loading, an HTML embed fits, the Exo 2
    // web-font swaps in and reflows text. Without a re-stack, every frame BELOW keeps a
    // stale top -> pages overlap (content grew) or gap (content shrank). A per-frame
    // ResizeObserver re-stacks the column whenever any frame's SIZE changes, coalesced to
    // one pass per animation frame. Re-stacking only moves wraps (position, not size), so
    // it can't feed back into the observer and loop.
    var frameRO = null, restackRaf = 0;
    function scheduleRestack() {
      if (restackRaf) return;
      restackRaf = requestAnimationFrame(function () {
        restackRaf = 0;
        if (E.world && E.world.isConnected) drawConnectors(); // re-measures (layoutColumns) + redraws spine/gaps
      });
    }
    function observeFrames() {
      if (!window.ResizeObserver) return;
      if (frameRO) frameRO.disconnect();
      frameRO = new ResizeObserver(function (recs) { _diag.roFires += recs.length; scheduleRestack(); });
      E.frameDescs.forEach(function (f) { if (f.frame) frameRO.observe(f.frame); });
    }

    // Shared connector geometry: a horizontal-eased cubic between two points, the ONE
    // path-maths the editor's flow connectors use. The tour-builder edge layer (#222)
    // reuses this same helper rather than standing up a second connector renderer
    // (DSLMS board/Edge law: reuse the data-goto connector path, not a duplicate).
    // bend defaults to the flow-connector pull; pass an explicit value to match a
    // different anchor spacing.
    function connectorPathD(sx, sy, tx, ty, bend) {
      if (bend == null) bend = Math.max(52, Math.abs(tx - sx) * 0.42);
      var dir = tx >= sx ? 1 : -1;
      return "M" + sx + " " + sy + " C" + (sx + bend * dir) + " " + sy + " " + (tx - bend * dir) + " " + ty + " " + tx + " " + ty;
    }

    // draw flow connectors after the column layout is measured + positioned.
    function drawConnectors() {
      layoutColumns();
      // #62: the page-gap Add/Merge affordances show in BOTH modes (structural
      // authoring, not connectors), so build them before the Interact-only return.
      buildGapAffordances();

      // idempotent: drop any prior connector layer so a standalone redraw (mode
      // toggle) never stacks two SVGs.
      var old = E.world.querySelector("svg.connectors");
      if (old) old.parentNode.removeChild(old);

      // SPEC §5: connectors show ONLY in Interact mode (Design = clean canvas).
      if (!interactModeOn()) return;

      // CONTEXTUAL connectors (James 2026-07-09): unless "Show all connections" is on,
      // draw only the component links that TOUCH the current selection (single or
      // multi) so a dense layout stays readable. The structural page-spine (below)
      // always draws — it's the backbone, not spaghetti. A block link is relevant when
      // its source block is selected; a gate link when the gated OR source block is.
      function blockInSelection(b) {
        if (!b) return false;
        if (E.selection.block && b === E.selection.block) return true;
        return E.multiSel.length > 0 && E.multiSel.indexOf(b) !== -1;
      }

      var svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "connectors");
      svg.setAttribute("width", worldW()); svg.setAttribute("height", E.worldH);
      var defs = document.createElementNS(SVGNS, "defs");
      function mkArrow(id, fill) {
        var m = document.createElementNS(SVGNS, "marker");
        m.setAttribute("id", id); m.setAttribute("viewBox", "0 0 10 10");
        m.setAttribute("refX", "8.5"); m.setAttribute("refY", "5");
        m.setAttribute("markerWidth", "6"); m.setAttribute("markerHeight", "6");
        m.setAttribute("orient", "auto-start-reverse");
        var a = document.createElementNS(SVGNS, "path");
        a.setAttribute("d", "M1 1L9 5L1 9z"); a.setAttribute("fill", fill);
        m.appendChild(a); defs.appendChild(m);
      }
      mkArrow("flow-arrow", "#0d99ff");      // nav links (real navigation)
      mkArrow("flow-arrow-sel", "#ff9f0a");  // selected nav link
      svg.appendChild(defs);

      // JJJJ: structural spine is now WITHIN-chapter + vertical (page bottom ->
      // next page top, same column). Chapter boundaries get no spine (column order
      // implies the chapter sequence).
      for (var i = 0; i < E.doc.pages.length - 1; i++) {
        if (!E.framePos[i] || !E.framePos[i + 1] || E.framePos[i].col !== E.framePos[i + 1].col) continue;
        var cxp = frameX(i) + E.FRAME_W / 2;
        var y1 = frameY(i) + LABEL_H + E.frameDescs[i].h; // bottom of page i
        var y2 = frameY(i + 1) + LABEL_H;               // top of page i+1
        var p = document.createElementNS(SVGNS, "path");
        p.setAttribute("class", "flow-link");
        p.setAttribute("d", "M" + cxp + " " + y1 + " L" + cxp + " " + y2);
        svg.appendChild(p);
      }

      // page id -> frame index; block id -> { pi, elm } (the on-canvas node).
      var idById = {};
      E.doc.pages.forEach(function (pg, pi) { idById[pg.id] = pi; });
      var blockLoc = {};
      E.frameDescs.forEach(function (f) {
        Array.prototype.forEach.call(f.frame.querySelectorAll("[data-id]"), function (elm) {
          blockLoc[elm.getAttribute("data-id")] = { pi: f.i, elm: elm };
        });
      });

      // element world-space rect via the OFFSET chain (unscaled world units) — the
      // world's zoom transform is applied AFTER drawConnectors runs, so screen
      // rects / view.zoom would be wrong here. offsetLeft/Top are transform-immune.
      function elmWorldRect(loc) {
        var frame = E.frameDescs[loc.pi].frame, x = 0, y = 0, c = loc.elm;
        while (c && c !== frame) { x += c.offsetLeft || 0; y += c.offsetTop || 0; c = c.offsetParent; }
        return { x: frameX(loc.pi) + x, y: frameY(loc.pi) + LABEL_H + y, w: loc.elm.offsetWidth, h: loc.elm.offsetHeight };
      }

      // ---- nav arrows: derived from REAL authored interactions (SPEC §5/§6) ----
      // Primary path = normalizeInteractions(block): covers modern block.interactions
      // AND legacy block.action.goto (SAMPLE_DOC nav buttons) in one shape, anchored
      // via the block's canvas node (no id required). Fallback = bare [data-goto]
      // elements owned by a block with NO interactions (componentGrid menu cards,
      // whose goto lives per-instance). show/hide/enable/toggle are NOT drawn.
      var imap = window.buildInteractionMap(E.doc); // still used by the gate pass
      function navTargetIndex(a, si) {
        if (!a) return -1;
        if (a.type === "goto") return (a.target in idById) ? idById[a.target] : -1;
        if (a.type === "next") return si + 1 < E.doc.pages.length ? si + 1 : -1;
        if (a.type === "prev") return si - 1 >= 0 ? si - 1 : -1;
        return -1;
      }
      var linksByFrame = {}; // pi -> [{ block, elm, ti }]
      E.frameDescs.forEach(function (f) {
        var si = f.i, bucket = (linksByFrame[si] = linksByFrame[si] || []);
        Array.prototype.forEach.call(f.frame.querySelectorAll(".canvas-block"), function (node) {
          var b = node.__block; if (!b) return;
          window.normalizeInteractions(b).forEach(function (ix) {
            var ti = navTargetIndex(ix.action, si);
            if (ti >= 0) bucket.push({ block: b, elm: node, ti: ti });
          });
        });
        Array.prototype.forEach.call(f.frame.querySelectorAll("[data-goto]"), function (elm) {
          var owner = elm.closest(".canvas-block");
          if (owner && owner.__block && window.normalizeInteractions(owner.__block).length) return; // already counted above
          var g = elm.getAttribute("data-goto");
          var ti = (g in idById) ? idById[g] : -1;
          if (ti >= 0) bucket.push({ block: (owner && owner.__block) || null, elm: elm, ti: ti });
        });
      });
      Object.keys(linksByFrame).forEach(function (piKey) {
        var si = +piKey, links = linksByFrame[si], n = links.length;
        links.forEach(function (lk, k) {
          var ti = lk.ti;
          if (ti === si) return; // self-link has no meaningful path
          // contextual: skip links that don't touch the selection (unless Show all)
          if (!showAllConnectorsOn() && !(E.selection.node === lk.elm || blockInSelection(lk.block))) return;
          var isForward = ti > si;
          var srcH = E.frameDescs[si].h || E.FRAME_H, tgtH = E.frameDescs[ti].h || E.FRAME_H;
          var fan = (n > 1) ? (k - (n - 1) / 2) * 24 : 0;
          var sx = frameX(si) + (isForward ? FRAME_W : 0);
          var syB = frameY(si) + LABEL_H;
          var sy = clamp(syB + srcH / 2 + fan, syB + 14, syB + srcH - 14);
          var tx = isForward ? frameX(ti) : frameX(ti) + E.FRAME_W;
          var ty = frameY(ti) + LABEL_H + tgtH / 2;
          var isSelected = E.selection.node === lk.elm || (E.selection.block && lk.block === E.selection.block);
          var ap = document.createElementNS(SVGNS, "path");
          ap.setAttribute("class", "action-link" + (isSelected ? " is-selected" : ""));
          ap.setAttribute("d", connectorPathD(sx, sy, tx, ty));
          ap.setAttribute("marker-end", "url(#" + (isSelected ? "flow-arrow-sel" : "flow-arrow") + ")");
          svg.appendChild(ap);
        });
      });

      // ---- gate connectors: gated element -> condition source(s) (SPEC §6) -----
      // Distinct LOCKED style (dashed + a small lock glyph) so "locked until" never
      // reads like "navigates to". Element-anchored (gate source is often same-page).
      Object.keys(imap).forEach(function (id) {
        var loc = blockLoc[id], entry = imap[id];
        if (!loc || !entry.gate || !entry.gate.when) return;
        var gatedSel = blockInSelection(loc.elm.__block);
        var gr = elmWorldRect(loc);
        conditionSources(entry.gate.when).forEach(function (srcId) {
          var sLoc = blockLoc[srcId]; if (!sLoc) return;
          var srcSel = blockInSelection(sLoc.elm.__block);
          // contextual: draw only if the gated or source block is selected (unless Show all)
          if (!showAllConnectorsOn() && !gatedSel && !srcSel) return;
          var isSel = gatedSel || srcSel;
          var sr = elmWorldRect(sLoc);
          // anchor on the LEFT edges; both control points share one bulge X so the
          // curve is a clean C into the left gutter, clear of the blue nav arrows.
          var gx = gr.x, gy = gr.y + gr.h / 2;
          var sxp = sr.x, syp = sr.y + sr.h / 2;
          var bulgeX = Math.min(gx, sxp) - Math.max(30, Math.abs(gy - syp) * 0.35 + 18);
          var gp = document.createElementNS(SVGNS, "path");
          gp.setAttribute("class", "gate-link" + (isSel ? " is-selected" : ""));
          gp.setAttribute("d", "M" + gx + " " + gy + " C" + bulgeX + " " + gy + " " + bulgeX + " " + syp + " " + sxp + " " + syp);
          svg.appendChild(gp);
          // lock glyph at the leftmost apex of the C (the curve's mid-x extreme).
          svg.appendChild(mkLockGlyph(bulgeX + 6, (gy + syp) / 2, isSel));
        });
      });

      E.world.appendChild(svg); // in front of frames
    }

    // #62: on-canvas gap affordance. Hovering the empty space between two vertically
    // stacked pages IN THE SAME CHAPTER reveals two glyph buttons: Add (insert a blank
    // page in the gap) + Merge (combine the two pages into one). Rebuilt each connector
    // pass so positions stay correct; a narrow centred hover zone keeps it out of the
    // way of marquee drags. Editor chrome only — nothing renders/ships.
    function buildGapAffordances() {
      Array.prototype.forEach.call(E.world.querySelectorAll(".page-gap"), function (g) { g.remove(); });
      if (isPreview()) return; // structural edits are disabled while previewing a variant / translation
      for (var i = 0; i < E.doc.pages.length - 1; i++) {
        if (!E.framePos[i] || !E.framePos[i + 1] || E.framePos[i].col !== E.framePos[i + 1].col) continue;
        var top = frameY(i) + LABEL_H + (E.frameDescs[i] ? E.frameDescs[i].h : 0); // bottom of page i
        var zone = h("div", "page-gap");
        zone.style.left = (frameX(i) + E.FRAME_W / 2 - 130) + "px";
        zone.style.top = top + "px";
        zone.style.width = "260px";
        zone.style.height = GAP_Y + "px";
        var tools = h("div", "page-gap__tools");
        (function (pi) {
          var addBtn = h("button", "page-gap__btn"); addBtn.type = "button"; addBtn.title = "Add a blank page here";
          addBtn.innerHTML = Icon("plus");
          addBtn.addEventListener("click", function (e) { e.stopPropagation(); addPageAfter(pi); });
          var mergeBtn = h("button", "page-gap__btn"); mergeBtn.type = "button"; mergeBtn.title = "Merge these two pages into one";
          mergeBtn.innerHTML = Icon("fold-vertical");
          mergeBtn.addEventListener("click", function (e) { e.stopPropagation(); mergePageWithNext(pi); });
          tools.appendChild(addBtn); tools.appendChild(mergeBtn);
        })(i);
        zone.appendChild(tools);
        E.world.appendChild(zone);
      }
    }

    // a small padlock glyph (drawn, no emoji) centred at (cx,cy) for gate links.
    function mkLockGlyph(cx, cy, sel) {
      var g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "gate-lock" + (sel ? " is-selected" : ""));
      g.setAttribute("transform", "translate(" + (cx - 6) + "," + (cy - 6) + ")");
      var bg = document.createElementNS(SVGNS, "rect");
      bg.setAttribute("x", "-2"); bg.setAttribute("y", "-2"); bg.setAttribute("width", "16"); bg.setAttribute("height", "16");
      bg.setAttribute("rx", "4"); bg.setAttribute("class", "gate-lock__bg");
      g.appendChild(bg);
      var body = document.createElementNS(SVGNS, "rect");
      body.setAttribute("x", "2.5"); body.setAttribute("y", "5.5"); body.setAttribute("width", "7"); body.setAttribute("height", "5.5");
      body.setAttribute("rx", "1"); body.setAttribute("class", "gate-lock__mark");
      g.appendChild(body);
      var shackle = document.createElementNS(SVGNS, "path");
      shackle.setAttribute("d", "M3.6 5.5V4.2a2.4 2.4 0 0 1 4.8 0V5.5");
      shackle.setAttribute("class", "gate-lock__mark"); shackle.setAttribute("fill", "none");
      g.appendChild(shackle);
      return g;
    }

    kernel.expose({
      buildWorld: buildWorld, layoutColumns: layoutColumns, scheduleRestack: scheduleRestack,
      observeFrames: observeFrames, connectorPathD: connectorPathD, drawConnectors: drawConnectors,
      buildGapAffordances: buildGapAffordances, worldGeoClass: worldGeoClass, frameContentOverflows: frameContentOverflows,
      mkLockGlyph: mkLockGlyph
    });
  }

  window.VersoWorld = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoWorld;
})();
