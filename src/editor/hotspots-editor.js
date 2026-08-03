// editor/hotspots-editor.js -- editing a hotspot tour on the canvas (arch-P3b-06).
//
// A hotspot block is a screen GRAPH: screens, markers on them, and links between them. This is
// the editing side of it -- the canvas overlay that reveals and places markers, the multi-select
// and layer actions a selected hotspot answers to, and renderHotspotInspector, the panel that
// edits the entry screen's visual, its markers and where each one goes.
//
// IT OWNS THE SELECTION. hotspotEditId (which marker is open) and hotspotEditScreenId (which
// screen) live here now. P3b-04 had to borrow them from editor.js as a get/set pair because the
// tour builder writes them from 29 sites and this code had not moved yet; they are home, and the
// board reads them from this module through the namespace instead. Same for clampPct,
// revealHotspot, findHotspot and renderHotspotInspector, which editor.js was only relaying.
//
// Editor chrome only: the graph it edits is the document, but nothing here renders or exports.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // install(kernel) is called once, by editor.js, after it has provided its host surface.
  function install(kernel) {
    // The screen-graph reads (arch-P3-08) are a pure sibling. Read inside install, where every
    // script on the page has already run -- the load-order rule the P3b-01 ratchet enforces.
    var HS = window.VersoHotspots;
    var E = kernel.need(
      "doc", "inspector", "setInspector", "selection", "multiSel", "h",
      "findPageOfBlock", "reapplyStructural", "pushHistory", "reselectBlockNode", "iconField", "renderModelView",
      "sectionGroup", "beginSections", "endSections", "canvasNodeForBlock", "dsSelect", "switchRow",
      "renderInspector", "assetRef", "colorOpt", "twoUp", "iconBtn", "moveBlock",
      "segmentedLive", "fieldRow", "walkPageBlocks", "duplicateBlock", "deleteBlockByRef", "clearBlockContentAction",
      "canSplitAtBlock", "splitPageAtBlock", "line", "renderImageVariantVersions", "optionalRow", "colorFieldFlat",
      "panelSection", "confirmModal", "scheduleSave", "sweepAllAssets", "tourBoardIsOpen", "openTourBuilder",
      "tourMakeMarker", "renderTourNodes", "renderTourInspector"
    );
    // The stable half: function declarations and constants editor.js never reassigns, aliased once
    // so the moved body reads exactly as it did.
    var h = E.h, findPageOfBlock = E.findPageOfBlock, reapplyStructural = E.reapplyStructural,
        pushHistory = E.pushHistory, reselectBlockNode = E.reselectBlockNode, iconField = E.iconField,
        renderModelView = E.renderModelView, sectionGroup = E.sectionGroup, beginSections = E.beginSections,
        endSections = E.endSections, canvasNodeForBlock = E.canvasNodeForBlock, dsSelect = E.dsSelect,
        switchRow = E.switchRow, renderInspector = E.renderInspector, assetRef = E.assetRef,
        colorOpt = E.colorOpt, twoUp = E.twoUp, iconBtn = E.iconBtn,
        moveBlock = E.moveBlock, segmentedLive = E.segmentedLive, fieldRow = E.fieldRow,
        walkPageBlocks = E.walkPageBlocks, duplicateBlock = E.duplicateBlock, deleteBlockByRef = E.deleteBlockByRef,
        clearBlockContentAction = E.clearBlockContentAction, canSplitAtBlock = E.canSplitAtBlock, splitPageAtBlock = E.splitPageAtBlock,
        line = E.line, renderImageVariantVersions = E.renderImageVariantVersions, optionalRow = E.optionalRow,
        colorFieldFlat = E.colorFieldFlat, panelSection = E.panelSection, confirmModal = E.confirmModal,
        scheduleSave = E.scheduleSave, sweepAllAssets = E.sweepAllAssets, tourBoardIsOpen = E.tourBoardIsOpen,
        openTourBuilder = E.openTourBuilder, tourMakeMarker = E.tourMakeMarker, renderTourNodes = E.renderTourNodes,
        renderTourInspector = E.renderTourInspector;

    // ---- image hotspots ------------------------------------------------------
    // Which hotspot is currently opened for editing on the canvas. Scoped by id
    // (unique within a block); a stale id from another block simply won't match, so
    // the inspector falls back to the block's first hotspot.
    var hotspotEditId = null;
    // #216: which Screen node the inspector is editing (its visual + markers). Default
    // = the entry screen; the Screens list switches it so deep tours are authored inline.
    var hotspotEditScreenId = null;
    function clampPct(v) { return Math.max(0, Math.min(100, v)); }
    // The id of the Screen a marker lives on (its markers[] contains the id) -- used to
    // switch the inspector to that screen when a marker is picked on the canvas.
    function screenIdOfMarker(block, mid) {
      var found = null;
      if (block && Array.isArray(block.screens)) block.screens.forEach(function (s) {
        if (found || !s || !Array.isArray(s.markers)) return;
        if (s.markers.some(function (m) { return m && m.id === mid; })) found = s.id;
      });
      return found;
    }
    // #215 unified screen-graph accessors. findHotspot returns the MARKER with that id
    // (searching every screen), keeping the legacy call sites' shape (id/x/y/label/blocks).
    function findHotspot(block, id) { return HS.findMarker(block, id); }
    // The entry Screen node (block.entry, else the first screen). The base image and
    // its markers live here; legacy block.src/alt/hotspots migrated onto it (#215).
    function hotspotEntryScreen(block) { return HS.entryScreen(block); }
    // Every card-blocks array nested in a hotspot block (screens[].markers[].blocks) —
    // the canonical reach-in for the deep walks (remint/find/clear/F&R/rename/...).
    // Returns the LIVE arrays so walks can splice.
    function hotspotCardArrays(b) { return HS.cardArrays(b); }

    // Force-show ONE hotspot's popover on the canvas so its child blocks (title /
    // body / image) are editable in place; hide the rest. Positioned by the SAME
    // helper the runtime uses (window.CourseRuntime.positionPopover) so canvas and
    // shipped course agree. Editor-only: render always emits popovers hidden.
    function revealHotspotPopover(blockNode, hsId) {
      if (!blockNode) return;
      var stage = blockNode.querySelector(".hotspot-stage"); if (!stage) return;
      Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-popover"), function (p) {
        p.hidden = true; p.classList.remove("is-editing", "is-open");
      });
      Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-marker"), function (m) { m.classList.remove("is-active"); });
      if (!hsId) return;
      var pop = stage.querySelector('.hotspot-popover[data-hotspot-panel="' + hsId + '"]');
      var mk = stage.querySelector('.hotspot-marker[data-hotspot="' + hsId + '"]');
      if (!pop) return;
      pop.hidden = false; pop.classList.add("is-editing", "is-open");
      if (mk) mk.classList.add("is-active");
      if (window.CourseRuntime && window.CourseRuntime.positionPopover) window.CourseRuntime.positionPopover(stage, mk, pop);
    }

    // #216: show ONE screen PANEL on the canvas for editing (its own markers become
    // draggable). Entry -> the base image (no panel); any other screen -> its panel +
    // .is-screen-open so the ENTRY markers hide and the panel's markers are the ones on
    // top. Editor-only; render always emits panels hidden. Returns the shown panel.
    function showEditScreen(blockNode, screenId) {
      if (!blockNode) return null;
      var stage = blockNode.querySelector(".hotspot-stage"); if (!stage) return null;
      Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-popover"), function (p) { p.hidden = true; p.classList.remove("is-editing", "is-open"); });
      Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-marker"), function (m) { m.classList.remove("is-active"); });
      var entryId = stage.getAttribute("data-hotspot-entry");
      var isEntry = !screenId || screenId === entryId;
      var shown = null;
      Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-screen"), function (s) {
        var on = !isEntry && s.getAttribute("data-screen-id") === screenId;
        s.hidden = !on; if (on) shown = s;
      });
      if (isEntry) stage.classList.remove("is-screen-open");
      else stage.classList.add("is-screen-open");
      // the preview Back/Home just end the preview -- keep them hidden on the canvas.
      var back = stage.querySelector(".hotspot-back"); if (back) back.hidden = true;
      var home = stage.querySelector(".hotspot-home"); if (home) home.hidden = true;
      return shown;
    }
    // #(feedback): step the CANVAS through a tour's screens so the author can clean up each
    // screen's markers/targets in place. Advances hotspotEditScreenId, re-shows that screen on the
    // canvas + re-renders the inspector to it. Panel markers are already wired for drag at build.
    function hsCanvasCycle(node, block, dir) {
      var ss = (block.screens || []).filter(Boolean);
      if (ss.length < 2) return;
      var idx = 0;
      for (var i = 0; i < ss.length; i++) if (ss[i].id === hotspotEditScreenId) idx = i;
      var next = ss[(idx + dir + ss.length) % ss.length];
      hotspotEditScreenId = next.id; hotspotEditId = null;
      renderInspector();
      showEditScreen(node, next.id);
    }
    // Reveal the inspector's current edit state on the canvas: the edited screen (so its
    // markers drag), plus the selected marker's popover if it is a card marker.
    function revealHotspot(blockNode, block, hsId) {
      if (!blockNode || !block) return;
      showEditScreen(blockNode, hotspotEditScreenId);
      var mk = findHotspot(block, hsId);
      if (mk && mk.action !== "navigate") revealHotspotPopover(blockNode, hsId);
      else {
        // highlight the selected navigate marker (no popover) as a cue
        var el2 = blockNode.querySelector('.hotspot-marker[data-hotspot="' + hsId + '"]');
        if (el2) el2.classList.add("is-active");
      }
    }

    // Which hotspot popover-card (if any) a block lives inside — the owning hotspot
    // BLOCK + its hs. Used to keep the card revealed across edits (paste/delete/drag
    // all rebuild the canvas; without this the open card snaps shut to the image).
    function hotspotOwnerOf(target) { return HS.ownerOf(E.doc.pages, target, walkPageBlocks); }

    // After a mount() rebuild, if the current selection (or a just-pasted/dropped
    // block) sits inside a hotspot card, re-reveal that card so it stays open for
    // further editing. Screen-mode is left to its own reveal. Idempotent.
    function keepHotspotCardOpen() {
      var candidates = [];
      if (E.selection && E.selection.block) candidates.push(E.selection.block);
      if (E.multiSel && E.multiSel.length) candidates = candidates.concat(E.multiSel);
      for (var i = 0; i < candidates.length; i++) {
        var owner = hotspotOwnerOf(candidates[i]);
        if (owner) {
          hotspotEditId = owner.hs.id;
          hotspotEditScreenId = screenIdOfMarker(owner.block, owner.hs.id) || hotspotEditScreenId;
          revealHotspot(canvasNodeForBlock(owner.block), owner.block, owner.hs.id);
          return;
        }
      }
    }

    // SPEC-ui-kit ticket 5/6: the two-level inspector shell every block reuses. Single
    // click (Block level) = renderContainerChrome only (how the box sits on the page);
    // "Edit contents" / the breadcrumb enters Content level = the block's tool params
    // via renderContent(node). The breadcrumb names the depth and clicks back out.
    // The default container io maps the two universally-honored container props
    // (spaceTop / spaceBottom) + the real move/duplicate/delete ops; a block with more
    // container props supplies a richer io/decl.
    function blockChromeIo(block) {
      return {
        get: function (k) {
          if (k === "align") return block.align;
          if (k === "valign") return block.valign;
          if (k === "spaceTop") return block.spaceTop;
          if (k === "spaceBottom") return block.spaceBottom;
          return undefined;
        },
        set: function (k, v) {
          if (k === "align") { if (v == null || v === "start") delete block.align; else block.align = v; }
          else if (k === "valign") { if (v == null || v === "top") delete block.valign; else block.valign = v; }
          else if (k === "spaceTop") { if (v == null) delete block.spaceTop; else block.spaceTop = v; }
          else if (k === "spaceBottom") { if (v == null) delete block.spaceBottom; else block.spaceBottom = v; }
          reapplyStructural(findPageOfBlock(block));
        }
      };
    }
    function blockChromeHandlers(block) {
      return { moveUp: function () { moveBlock(block, -1); }, moveDown: function () { moveBlock(block, 1); },
        duplicate: function () { duplicateBlock(block); }, remove: function () { deleteBlockByRef(block); },
        // #174: reset this block's subtree to a blank skeleton (wipe copy/images/embeds, keep structure).
        clearContent: function () { clearBlockContentAction([block]); },
        // Split-page (slice) tool: only when this is a top-level block below the first
        // (canSplitAtBlock). The old floating toolbar that hosted it was retired in the
        // two-level migration, so it lives in the panel Actions row (single source now).
        split: canSplitAtBlock(block) ? function () { splitPageAtBlock(block); } : null };
    }
    // #88: an image figure's ONLY appearance is its box stroke — render's shared
    // applyBlockAppearance reads block.box.border/borderColor/borderWidth (the image
    // renderer itself draws no border). With no stroke control in the image inspector,
    // a border applied via a pasted box style (STYLE_KEYS carries `box`) was
    // unremovable. Expose the canonical rich stroke (colour + width) mapped to
    // block.box; on removal, also drop any stray legacy top-level block.border.
    function imageChromeIo(block) {
      return {
        get: function (k) {
          if (k === "align") return block.align;
          if (k === "valign") return block.valign;
          if (k === "spaceTop") return block.spaceTop;
          if (k === "spaceBottom") return block.spaceBottom;
          if (k === "hasStroke") return !!(block.box && block.box.border);
          if (k === "strokeColor") return block.box && block.box.borderColor;
          if (k === "strokeWidth") return block.box && block.box.borderWidth;
          return undefined;
        },
        set: function (k, v) {
          if (k === "align") { if (v == null || v === "start") delete block.align; else block.align = v; }
          else if (k === "valign") { if (v == null || v === "top") delete block.valign; else block.valign = v; }
          else if (k === "spaceTop") { if (v == null) delete block.spaceTop; else block.spaceTop = v; }
          else if (k === "spaceBottom") { if (v == null) delete block.spaceBottom; else block.spaceBottom = v; }
          else if (k === "hasStroke") {
            if (v) { block.box = block.box || {}; block.box.border = true; }
            else if (block.box) { delete block.box.border; delete block.box.borderColor; delete block.box.borderWidth; }
            delete block.border; // clear any legacy top-level border flag too
          }
          else if (k === "strokeColor") { block.box = block.box || {}; if (v == null) delete block.box.borderColor; else block.box.borderColor = v; }
          else if (k === "strokeWidth") { block.box = block.box || {}; if (v == null) delete block.box.borderWidth; else block.box.borderWidth = v; }
          reapplyStructural(findPageOfBlock(block));
        }
      };
    }
    // The container path from the page down to a block (SPEC-ui-kit, James): [page, ...
    // containers, block]. Walks the real nesting (columns / group / accordion+cardReveal
    // items / hotspot popovers) so the layer breadcrumb can jump to any ancestor.
    function blockAncestry(block) {
      var pi = findPageOfBlock(block); if (pi < 0 || !E.doc.pages[pi]) return null;
      var path = null;
      (function walk(blocks, trail) {
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          if (b === block) { path = trail.concat(b); return true; }
          var sets = [];
          if (b.type === "columns" && b.columns) b.columns.forEach(function (col) { sets.push(col); });
          if (b.children) sets.push(b.children);
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (it && it.children) sets.push(it.children); if (it && it.front) sets.push(it.front); if (it && it.back) sets.push(it.back); });
          hotspotCardArrays(b).forEach(function (arr) { sets.push(arr); }); // #215: screens[].markers[].blocks
          for (var k = 0; k < sets.length; k++) { if (walk(sets[k], trail.concat(b))) return true; }
        }
        return false;
      })(E.doc.pages[pi].blocks, []);
      return path ? { pageIndex: pi, path: path } : null;
    }

    function renderHotspotInspector(block) {
      // #215 unified screen-graph: the inspector reads/writes the entry Screen's
      // visual + markers. Defensive migrate catches a legacy-shaped block that slipped
      // past normalizeDoc (e.g. pasted JSON from an old clipboard).
      if (window.migrateHotspotBlock) window.migrateHotspotBlock(block);
      if (!Array.isArray(block.screens) || !block.screens.length) {
        block.screens = [{ id: "scr-entry", visual: "", kind: "image", alt: "", markers: [] }];
        block.entry = "scr-entry";
      }
      var entry = hotspotEntryScreen(block);
      entry.markers = entry.markers || [];
      block.screens.forEach(function (s) { if (s && !Array.isArray(s.markers)) s.markers = []; });
      // #216: the inspector edits ONE screen at a time (its visual + markers). Default
      // = the entry screen; the Screens list switches hotspotEditScreenId so a deep
      // tour is authored inline. A stale id (deleted screen) falls back to entry.
      function screenById(id) {
        for (var i = 0; i < block.screens.length; i++) if (block.screens[i] && block.screens[i].id === id) return block.screens[i];
        return null;
      }
      var curScreen = (hotspotEditScreenId && screenById(hotspotEditScreenId)) || entry;
      hotspotEditScreenId = curScreen.id;
      var isEntryScreen = curScreen === entry || curScreen.id === entry.id;
      curScreen.markers = curScreen.markers || [];
      function screenLabel(s, i) { return (s && s.name) || (s === entry ? "Entry" : "Screen " + (i)); }
      // The Screen node a navigate marker targets; create-on-demand when the author
      // uploads/links a destination. Ids stay unique within the block.
      function markerTarget(mk) {
        if (!mk || !mk.target) return null;
        for (var i = 0; i < block.screens.length; i++) if (block.screens[i] && block.screens[i].id === mk.target) return block.screens[i];
        return null;
      }
      function ensureMarkerTarget(mk) {
        var t = markerTarget(mk);
        if (t) return t;
        var tid = "scr-" + mk.id;
        while (block.screens.some(function (s) { return s && s.id === tid; })) tid += "x";
        t = { id: tid, visual: "", kind: "image", alt: "", markers: [] };
        block.screens.push(t);
        mk.target = tid;
        return t;
      }
      // Clearing a destination: drop the target Screen node too when nothing else
      // lives on it (no own markers), so the graph doesn't collect orphan nodes.
      function clearMarkerTarget(mk) {
        var t = markerTarget(mk);
        if (t && !(t.markers || []).length) {
          var i = block.screens.indexOf(t);
          if (i >= 0) block.screens.splice(i, 1);
        } else if (t) t.visual = "";
        delete mk.target;
      }
      function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
      function textLine(label, get, set, ph) {
        line(label, function (c) { var i = h("input", "prop-text"); i.type = "text"; i.spellcheck = false; i.placeholder = ph || ""; i.value = get() || "";
          i.addEventListener("change", function () { set(i.value); }); c.appendChild(i); });
      }

      // #160: canonical taxonomy — Content (base image + hotspots), Appearance (markers +
      // overlay card), Behaviour (interaction mode). Buffered + emitted in PanelLayout order.
      beginSections();

      // ---- Base image (Content): a compact upload glyph + the alt field on one row ----
      // #216: edits the CURRENT screen's visual (entry = the base image; any other
      // screen = its panel visual). Block-level controls (width/blend/variants) apply to
      // the base image only, so they show on the entry screen.
      sectionGroup("Content", isEntryScreen ? "Base image" : "Screen image", function (_bsb) {
      var _bins = E.inspector; E.setInspector(_bsb);
      try {
      var isAssetSrc = typeof curScreen.visual === "string" && curScreen.visual.indexOf("asset:") === 0;
      var brow = h("div", "insp-inline-row");
      var up = iconBtn("image-plus", isAssetSrc ? "Replace image / video / SVG" : "Upload image / video / SVG");
      up.addEventListener("click", function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,.svg,video/*";
        inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { pushHistory(); curScreen.visual = assetRef(r.result, f); if (f.type && f.type.indexOf("video/") === 0) curScreen.kind = "video"; else curScreen.kind = "image"; refresh(); }; r.readAsDataURL(f); });
        inp.click();
      });
      brow.appendChild(up);
      var altIn = h("input", "prop-text"); altIn.type = "text"; altIn.spellcheck = false; altIn.placeholder = "describe the image"; altIn.value = curScreen.alt || "";
      altIn.addEventListener("input", function () { curScreen.alt = altIn.value; renderModelView(); });
      brow.appendChild(altIn);
      E.inspector.appendChild(brow);
      // a real (non-asset) URL stays editable in a compact field
      if (!isAssetSrc && curScreen.visual) textLine("URL", function () { return curScreen.visual; }, function (v) { curScreen.visual = v || ""; refresh(); }, "https://…");
      // Caption shown beneath the screen, updating as the learner navigates. Per-screen, optional.
      textLine("Caption", function () { return curScreen.caption; }, function (v) { if (v) curScreen.caption = v; else delete curScreen.caption; refresh(); }, "Caption shown below this screen");
      // #217: a video screen visual (screen recording) — Loop (idle animation) vs Play once
      // (plays on arrival, freezes on the last frame). Play once can show a Replay control.
      if (curScreen.kind === "video" && curScreen.visual) {
        E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Playback"));
        var pbSel = dsSelect([["Loop (idle animation)", "loop"], ["Play once (freeze on end)", "once"]], curScreen.playback === "once" ? "once" : "loop", function (v) {
          pushHistory();
          if (v === "once") curScreen.playback = "once"; else delete curScreen.playback;
          refresh();
        });
        pbSel.title = "Loop cycles as an idle animation; Play once plays on arrival then freezes on the last frame";
        E.inspector.appendChild(pbSel);
        if (curScreen.playback === "once") switchRow("Replay button", function () { return curScreen.replay !== false; }, function (v) { if (v) delete curScreen.replay; else curScreen.replay = false; refresh(); });
        // #53: hold this screen's hotspots hidden until the play-once video finishes, then reveal
        // them (a "continue" or card that appears once the demo has played through). Reduced-motion
        // learners get them revealed up front so they are never stranded.
        if (curScreen.playback === "once") switchRow("Reveal hotspots after it ends", function () { return !!curScreen.revealAfterEnd; }, function (v) { if (v) curScreen.revealAfterEnd = true; else delete curScreen.revealAfterEnd; refresh(); });
        E.inspector.appendChild(h("div", "insp-hint", "Screen video plays muted. Reduced-motion learners see the first frame with a Play button."));
      }
      // #146: base-image SIZE — width as a % of the page. Below 100 the image centres
      // (esp. a product SVG) and frees margin space that popovers open into. Stored on the
      // block (imgWidth) so render stays pure (editor == export). 100/blank clears it.
      if (isEntryScreen && entry.visual) {
        var wrow = iconField("W", {
          value: (block.imgWidth == null ? "" : block.imgWidth), unit: "%", placeholder: "100",
          step: 5, min: 20, max: 100, title: "Base image width (% of page width)",
          onchange: function (v) {
            var n = parseInt(v, 10);
            if (isNaN(n) || n >= 100) delete block.imgWidth; else block.imgWidth = Math.max(20, n);
            refresh();
          }
        }).wrap;
        E.inspector.appendChild(wrow);
        E.inspector.appendChild(h("div", "insp-hint", "Below 100% the image centres and popovers can open into the side margin."));
        // #178: base-image blend mode — mirrors the image block. Blends the base image into the
        // page behind it (Lighten/Screen melt a dark asset into a dark page). Normal = unset.
        E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Blend"));
        var hsBlend = dsSelect([["Normal", "normal"], ["Lighten", "lighten"], ["Screen", "screen"], ["Darken", "darken"],
          ["Multiply", "multiply"], ["Overlay", "overlay"], ["Soft light", "soft-light"],
          ["Hard light", "hard-light"], ["Difference", "difference"]], block.blendMode || "normal", function (v) {
          pushHistory();
          if (v === "normal") delete block.blendMode; else block.blendMode = v;
          refresh();
        });
        hsBlend.title = "Blend the base image into the page background behind it";
        E.inspector.appendChild(hsBlend);
      }
      // #148 slice 3: per-variant BASE-image versions for the hotspot (the migrated
      // channel = entry-screen overrides[V].visual; same UI as the image block, routed
      // through imgVersionHost). Markers/popovers stay shared; only the base swaps.
      if (isEntryScreen && entry.visual) renderImageVariantVersions(block);
      } finally { E.setInspector(_bins); }
      });

      // ---- Interaction (Behaviour): a dropdown, no label ----
      sectionGroup("Behaviour", "Interaction", function (_isb) {
      var _iins = E.inspector; E.setInspector(_isb);
      try {
      // #49: block.mode is a DEFAULT-ONLY hint (which action a NEW hotspot gets); each marker's
      // own Action is the truth, so ONE experience can mix card + navigate hotspots. Switching
      // the default no longer rewrites existing markers -- that clobbered a mix. Set a hotspot's
      // action per-hotspot in "Selected hotspot" below.
      E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Default for new hotspots"));
      var irow = h("div", "insp-inline-row");
      var iSel = dsSelect([["Popover on click", "popover"], ["Screen navigation", "screen"]], block.mode || "popover", function (v) {
        pushHistory();
        if (v === "screen") block.mode = "screen"; else delete block.mode;
        refresh();
      });
      iSel.title = "The action a NEW hotspot starts with. Each hotspot's own Action wins — mix card + navigate freely.";
      irow.appendChild(iSel); E.inspector.appendChild(irow);
      // Navigation chrome (Back / Home / completion / trail) shows whenever ANY hotspot navigates
      // -- a mixed tour still needs it -- not only when the default is Screen navigation.
      var hasNavMarker = (block.screens || []).some(function (s) { return s && (s.markers || []).some(function (m) { return m && m.action === "navigate"; }); });
      if (block.mode === "screen" || hasNavMarker) {
        textLine("Back label", function () { return block.backLabel; }, function (v) { if (v) block.backLabel = v; else delete block.backLabel; refresh(); }, "Back");
        // #216: Home returns to the entry screen from any depth (shown only on tours that
        // go deeper than one level, where Back alone can strand the learner). Default on.
        switchRow("Home button", function () { return block.home !== false; }, function (v) { if (v) delete block.home; else block.home = false; refresh(); });
        if (block.home !== false) textLine("Home label", function () { return block.homeLabel; }, function (v) { if (v) block.homeLabel = v; else delete block.homeLabel; refresh(); }, "Home");
        E.inspector.appendChild(h("div", "insp-hint", "Home shows once a marker on a second-level screen navigates deeper. Build deeper screens in the Screens list below."));
        // #218 completion: default = every screen visited (releases the page's Next when
        // gating is on); optionally a completion screen finishes the tour on arrival.
        var compOpts = [["Every screen visited", ""]];
        block.screens.forEach(function (s, si) { if (s) compOpts.push([screenLabel(s, si), s.id]); });
        E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Completion"));
        var compSel = dsSelect(compOpts, block.completionScreen || "", function (v) {
          pushHistory();
          if (v) block.completionScreen = v; else delete block.completionScreen;
          refresh();
        });
        compSel.title = "When the tour counts complete (releases the page's Next when gating is on)";
        E.inspector.appendChild(compSel);
        // #218 the learner-facing Navigation trail (off by default): a breadcrumb of the
        // screens walked, with back-jump. Distinct from the editor Breadcrumb.
        switchRow("Navigation trail", function () { return !!block.trail; }, function (v) { if (v) block.trail = true; else delete block.trail; refresh(); });
        // External nav buttons (Back / Home) below the screen — toggle off for tours that drive
        // navigation purely through on-screen markers. Default on.
        switchRow("External nav buttons", function () { return !block.hideNav; }, function (v) { if (v) delete block.hideNav; else block.hideNav = true; refresh(); });
      }
      } finally { E.setInspector(_iins); }
      });

      // ---- Markers ---- (#45: defined here, but rendered lower down — directly above
      // the Hotspots list — so all marker/hotspot config sits together in one place. The
      // section header is the Appearance sectionGroup title at the call site below.)
      function renderMarkersSection() {
      function eachMarker(fn) { var n = canvasNodeForBlock(block); if (n) Array.prototype.forEach.call(n.querySelectorAll(".hotspot-marker"), fn); }
      colorOpt("Colour", function () { return block.markerColor; }, function (v) {
        if (v == null) delete block.markerColor; else block.markerColor = v;
        eachMarker(function (m) { if (v == null) m.style.removeProperty("--hotspot-color"); else m.style.setProperty("--hotspot-color", v); }); renderModelView();
      }, "var(--color-accent)");
      E.inspector.appendChild(iconField("W", { value: block.markerSize, unit: "px", placeholder: "34", step: 2, min: 16, max: 160, title: "Marker size",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.markerSize; else block.markerSize = n; eachMarker(function (m) { if (isNaN(n)) m.style.removeProperty("--hotspot-size"); else m.style.setProperty("--hotspot-size", n + "px"); }); renderModelView(); } }).wrap);
      // Custom marker: upload an SVG or a full HTML animation to replace the "i" badge.
      // Size control above still drives it; it goes green on completion (CSS-only).
      // .svg  -> inlined as-authored (exact green recolour).
      // .html -> a self-contained HTML animation, run isolated in a srcdoc iframe
      // (scripts stripped; green = a tint on completion).
      var markerKind = block.markerHtml ? "HTML animation" : (block.markerSvg ? "SVG marker" : null);
      var mrow = h("div", "insp-inline-row");
      var upM = iconBtn("image-plus", markerKind ? "Replace custom marker" : "Upload custom marker (SVG or HTML)");
      upM.addEventListener("click", function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".svg,.html,.htm,image/svg+xml,text/html";
        inp.addEventListener("change", function () {
          var f = inp.files && inp.files[0]; if (!f) return;
          var isHtml = /\.html?$/i.test(f.name) || f.type === "text/html";
          var isSvg = !isHtml && (/\.svg$/i.test(f.name) || f.type === "image/svg+xml");
          var r = new FileReader();
          r.onload = function () {
            pushHistory();
            if (isHtml) { block.markerHtml = String(r.result); delete block.markerSvg; }
            else if (isSvg) {
              // Read SVG as TEXT and rebuild a proper data:image/svg+xml ref. macOS
              // often reports an empty file.type for .svg -> readAsDataURL would yield
              // data:;base64,... -> the store resolves it to a blob: URL and
              // markerSvgNode's strict svg-data-url test fails (marker silently stayed
              // the "i" glyph). Forcing the mime keeps it inlined + recolourable.
              block.markerSvg = assetRef("data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(r.result)), { type: "image/svg+xml", name: f.name });
              delete block.markerHtml;
            }
            else { block.markerSvg = assetRef(r.result, f); delete block.markerHtml; }
            refresh();
          };
          if (isHtml || isSvg) r.readAsText(f); else r.readAsDataURL(f);
        });
        inp.click();
      });
      mrow.appendChild(upM);
      mrow.appendChild(h("div", "insp-inline-label", markerKind || "Default “i” badge"));
      if (markerKind) { var rmM = iconBtn("trash", "Remove custom marker", true); rmM.addEventListener("click", function () { pushHistory(); delete block.markerSvg; delete block.markerHtml; refresh(); }); mrow.appendChild(rmM); }
      E.inspector.appendChild(mrow);
      if (markerKind) E.inspector.appendChild(h("div", "insp-hint", "Tip: animations look best around 60–140px — use the size control above."));
      switchRow("Mark as viewed", function () { return block.trackViewed !== false; }, function (v) { if (v) delete block.trackViewed; else block.trackViewed = false; refresh(); });
      if (block.trackViewed !== false) colorOpt("Viewed colour", function () { return block.viewedColor; }, function (v) {
        if (v == null) delete block.viewedColor; else block.viewedColor = v;
        eachMarker(function (m) { if (v == null) m.style.removeProperty("--hotspot-viewed"); else m.style.setProperty("--hotspot-viewed", v); }); renderModelView();
      }, "#3ddc84");
      } // end renderMarkersSection (#45)

      // ---- Overlay card (Appearance) — colours apply LIVE; write block.cardStyle ----
      // #49: show whenever the default is popover OR any hotspot is a card (a mixed tour still
      // needs card styling even when the default action is Screen navigation).
      var hasCardMarker = (block.screens || []).some(function (s) { return s && (s.markers || []).some(function (m) { return m && m.action !== "navigate"; }); });
      if (block.mode !== "screen" || hasCardMarker) {
        sectionGroup("Appearance", "Overlay card", function (_osb) {
        var _oins = E.inspector; E.setInspector(_osb);
        try {
        var cs = block.cardStyle || {};
        function setCard(k, v) { block.cardStyle = block.cardStyle || {}; if (v == null || v === "") delete block.cardStyle[k]; else block.cardStyle[k] = v; }
        function eachPop(fn) { var n = canvasNodeForBlock(block); if (n) Array.prototype.forEach.call(n.querySelectorAll(".hotspot-popover"), fn); }
        var prow = h("div", "insp-inline-row");
        var pSel = dsSelect([["Auto placement", "auto"], ["Top", "top"], ["Bottom", "bottom"], ["Left", "left"], ["Right", "right"], ["Centre", "center"]], block.popoverPlace || "auto", function (v) { pushHistory(); if (v === "auto") delete block.popoverPlace; else block.popoverPlace = v; refresh(); });
        prow.appendChild(pSel); E.inspector.appendChild(prow);
        colorOpt("Fill", function () { return cs.fill; }, function (v) { setCard("fill", v); eachPop(function (p) { if (v == null) { p.style.background = ""; p.style.removeProperty("--pop-bg"); } else { p.style.background = v; p.style.setProperty("--pop-bg", v); } }); renderModelView(); }, "var(--color-surface)");
        colorOpt("Text", function () { return cs.textColor; }, function (v) { setCard("textColor", v); eachPop(function (p) { p.style.color = v == null ? "" : v; }); renderModelView(); }, "var(--color-ink)");
        optionalRow(E.inspector, "Stroke", { addTitle: "Add a stroke",
          get: function () { return !!(block.cardStyle && block.cardStyle.border === true); },
          set: function (v) { block.cardStyle = block.cardStyle || {}; if (v) block.cardStyle.border = true; else delete block.cardStyle.border; refresh(); },
          build: function (b) {
            colorFieldFlat(null, cs.borderColor, function (v) { setCard("borderColor", v); refresh(); }, b);
            b.appendChild(iconField(Icon("border-weight"), { value: cs.borderWidth, unit: "px", placeholder: "1", step: 1, min: 0, max: 12, title: "Border width", onchange: function (v) { var n = parseInt(v, 10); setCard("borderWidth", isNaN(n) ? null : n); refresh(); } }).wrap);
          } });
        E.inspector.appendChild(twoUp(
          iconField(Icon("radius"), { value: cs.radius, unit: "px", placeholder: "12", step: 1, min: 0, max: 60, title: "Corner radius", onchange: function (v) { var n = parseInt(v, 10); setCard("radius", isNaN(n) ? null : n); refresh(); } }).wrap,
          iconField(Icon("padding"), { value: cs.padding, unit: "px", placeholder: "20", step: 2, min: 0, max: 60, title: "Padding", onchange: function (v) { var n = parseInt(v, 10); setCard("padding", isNaN(n) ? null : n); refresh(); } }).wrap
        ));
        E.inspector.appendChild(iconField("W", { value: cs.width, unit: "px", placeholder: "auto width", step: 10, min: 120, max: 600, title: "Card width", onchange: function (v) { var n = parseInt(v, 10); setCard("width", isNaN(n) ? null : n); refresh(); } }).wrap);
        } finally { E.setInspector(_oins); }
        });
      }
      // Markers (Appearance) — styling rendered here, beside the hotspot list (#45).
      sectionGroup("Appearance", "Markers", function (_msb) {
        var _mins = E.inspector; E.setInspector(_msb);
        try { renderMarkersSection(); } finally { E.setInspector(_mins); }
      });

      // Screens (Content) — the graph's screen nodes (#216). Switch which screen the
      // inspector edits (its image + markers), add screens, rename, delete (not entry).
      // A navigate marker's "Goes to" can point at any screen listed here.
      function deleteScreen(s) {
        var i = block.screens.indexOf(s); if (i < 0 || s === entry) return;
        block.screens.splice(i, 1);
        block.screens.forEach(function (sc) { (sc && sc.markers || []).forEach(function (m) { if (m && m.target === s.id) delete m.target; }); });
        if (hotspotEditScreenId === s.id) { hotspotEditScreenId = entry.id; hotspotEditId = null; }
      }
      sectionGroup("Content", "Screens", function (_ssb) {
      var _sins = E.inspector; E.setInspector(_ssb);
      try {
      var addScr = h("button", "prop-btn prop-btn--accent", "+ Add screen");
      addScr.addEventListener("click", function () {
        pushHistory();
        var sid = "scr-" + Math.random().toString(36).slice(2, 8);
        while (screenById(sid)) sid += "x";
        block.screens.push({ id: sid, visual: "", kind: "image", alt: "", markers: [] });
        hotspotEditScreenId = sid; hotspotEditId = null;
        reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
      });
      // #221 tour builder: a full-screen 2D board of screen nodes (augments this inline
      // list). Opens the same graph in a spatial canvas with multi-upload + link-drawing.
      // Pinned FIRST + given icon+emphasis so it reads as the section's headline action.
      // Hidden while the builder is ALREADY open (this same inspector is re-hosted in the
      // builder's right panel) -- you can't "open" the surface you're already in (#224 QA).
      if (!(typeof tourBoardIsOpen === "function" && tourBoardIsOpen())) {
        var openBoard = h("button", "prop-btn prop-btn--accent prop-btn--board");
        openBoard.innerHTML = (window.Icon ? window.Icon("workflow") : "") + "<span>Open tour builder</span>";
        openBoard.addEventListener("click", function () { openTourBuilder(block); });
        E.inspector.appendChild(openBoard);
      }
      E.inspector.appendChild(addScr);
      block.screens.forEach(function (s, si) {
        if (!s) return;
        var row = h("div", "insp-row" + (curScreen.id === s.id ? " is-selected" : ""));
        var nmeIn = h("input", "prop-text"); nmeIn.type = "text"; nmeIn.spellcheck = false;
        nmeIn.placeholder = (s === entry ? "Entry" : "Screen " + si);
        nmeIn.value = s.name || "";
        nmeIn.addEventListener("input", function () { if (nmeIn.value) s.name = nmeIn.value; else delete s.name; });
        row.appendChild(nmeIn);
        var pick = h("button", "prop-btn", "◎"); pick.title = "Edit this screen";
        pick.addEventListener("click", function () { hotspotEditScreenId = s.id; hotspotEditId = null; renderInspector(); });
        row.appendChild(pick);
        if (s !== entry) {
          var dScr = h("button", "prop-btn prop-btn--danger", "×"); dScr.title = "Delete screen";
          dScr.addEventListener("click", function () { pushHistory(); deleteScreen(s); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
          row.appendChild(dScr);
        }
        E.inspector.appendChild(row);
      });
      E.inspector.appendChild(h("div", "insp-hint", "Editing " + screenLabel(curScreen, block.screens.indexOf(curScreen)) + ". Its image + hotspots are shown below; add screens to build a multi-level tour."));
      } finally { E.setInspector(_sins); }
      });

      // Hotspots (Content) — the list of hotspots ON THE CURRENT SCREEN + the selected-
      // hotspot editor. The add affordance is a canonical accent button inside the section
      // (the sectionGroup title replaces the former propHeader header).
      sectionGroup("Content", "Hotspots", function (_hsb) {
      var _hins = E.inspector; E.setInspector(_hsb);
      try {
      var addHs = h("button", "prop-btn prop-btn--accent", "+ Add hotspot");
      addHs.addEventListener("click", function () {
        pushHistory();
        // #216: a new Marker on the CURRENT screen (seed shared with the board click-to-drop,
        // via tourMakeMarker). Cascade the seed position (diagonal, 30->70%) so repeated adds
        // don't stack on one point (which bunches the pins unusably in the tour builder).
        var _mn = (curScreen.markers.length % 6), _mp = 30 + _mn * 8;
        var _m = tourMakeMarker(block, _mp, _mp);
        curScreen.markers.push(_m);
        hotspotEditId = _m.id;
        reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
      });
      E.inspector.appendChild(addHs);
      if (!curScreen.markers.length) E.inspector.appendChild(h("div", "insp-hint", "Add a hotspot, then drag its marker onto the image. Click a marker to open its popover and edit the copy."));
      curScreen.markers.forEach(function (hs, hi) {
        var row = h("div", "insp-row" + (hotspotEditId === hs.id ? " is-selected" : ""));
        // editable label (blank = "Hotspot N"); focusing selects+reveals this hotspot,
        // typing updates the model live + the marker's hover title in place.
        var nameIn = h("input", "prop-text"); nameIn.type = "text"; nameIn.spellcheck = false;
        nameIn.placeholder = "Hotspot " + (hi + 1);
        nameIn.value = hs.label || "";
        var pushed = false;
        nameIn.addEventListener("focus", function () { if (hotspotEditId !== hs.id) { hotspotEditId = hs.id; revealHotspot(canvasNodeForBlock(block), block, hs.id); } });
        nameIn.addEventListener("input", function () {
          if (!pushed) { pushHistory(); pushed = true; }
          if (nameIn.value) hs.label = nameIn.value; else delete hs.label;
          var n = canvasNodeForBlock(block);
          if (n) { var mk = n.querySelector('.hotspot-marker[data-hotspot="' + hs.id + '"]'); if (mk) { if (nameIn.value) mk.title = nameIn.value; else mk.removeAttribute("title"); } }
          renderModelView();
        });
        nameIn.addEventListener("blur", function () { pushed = false; });
        row.appendChild(nameIn);
        var sel = h("button", "prop-btn", "◎"); sel.title = "Edit this hotspot";
        sel.addEventListener("click", function () { hotspotEditId = hs.id; renderInspector(); });
        row.appendChild(sel);
        var del = h("button", "prop-btn prop-btn--danger", "×");
        del.title = "Delete hotspot";
        del.addEventListener("click", function () { pushHistory(); var i = curScreen.markers.indexOf(hs); if (i >= 0) { clearMarkerTarget(hs); curScreen.markers.splice(i, 1); } if (hotspotEditId === hs.id) hotspotEditId = null; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
        row.appendChild(del);
        E.inspector.appendChild(row);
      });

      // resolve which hotspot to edit (valid stored id ON THIS SCREEN, else the first)
      var active = null;
      for (var _ai = 0; _ai < curScreen.markers.length; _ai++) if (curScreen.markers[_ai] && curScreen.markers[_ai].id === hotspotEditId) active = curScreen.markers[_ai];
      if (!active) active = curScreen.markers[0] || null;
      hotspotEditId = active ? active.id : null;
      if (active) {
        var _hsListBody = E.inspector;
        E.setInspector(panelSection(_hsListBody, "Selected hotspot"));
        // #49: per-hotspot Action — the real truth (block "Default for new hotspots" only seeds
        // new ones). Flip freely: card blocks AND a navigate target are both kept, so switching
        // back and forth is lossless. Everything below re-renders for the chosen action.
        // Single home: while the tour builder is open, Action lives on the floating pill (not here);
        // in the plain sidebar (no pill) it stays in the panel.
        if (!tourBoardIsOpen()) segmentedLive("Action", [["Card popover", "card"], ["Navigate", "navigate"]],
          function (v) { return (active.action === "navigate" ? "navigate" : "card") === v; },
          function (v) {
            active.action = (v === "navigate") ? "navigate" : "card";
            hotspotEditId = active.id;
            reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
          });
        E.inspector.appendChild(h("div", "insp-hint", active.action === "navigate"
          ? "Drag the marker to position it on the menu. Upload the screen it opens below; click the marker on the canvas to preview it."
          : "Drag the marker on the canvas to move it. Edit the title and body in the popover; the text panel formats them."));
        E.inspector.appendChild(twoUp(
          iconField("X", { value: active.x == null ? 50 : active.x, unit: "%", placeholder: "50", step: 1, min: 0, max: 100, title: "Horizontal %",
            onchange: function (v) { var n = parseFloat(v); if (!isNaN(n)) { active.x = clampPct(n); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } } }).wrap,
          iconField("Y", { value: active.y == null ? 50 : active.y, unit: "%", placeholder: "50", step: 1, min: 0, max: 100, title: "Vertical %",
            onchange: function (v) { var n = parseFloat(v); if (!isNaN(n)) { active.y = clampPct(n); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } } }).wrap
        ));
        // #48 marker shape: a POINT badge, or a resizable BOX region -- a transparent hit-box
        // that highlights a UI element without obscuring it. Box adds W x H (% of the image);
        // drag the box's corner handle on the canvas / tour board to resize, or set them here.
        // Single home: Shape lives on the pill while the builder is open; in the plain sidebar, here.
        if (!tourBoardIsOpen()) segmentedLive("Shape", [["Point", "point"], ["Box (region)", "box"]],
          function (v) { return (active.shape === "box" ? "box" : "point") === v; },
          function (v) {
            if (v === "box") { active.shape = "box"; if (active.w == null) active.w = 20; if (active.h == null) active.h = 12; }
            else delete active.shape;
            reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
          });
        if (active.shape === "box") {
          E.inspector.appendChild(twoUp(
            iconField("W", { value: active.w == null ? 20 : active.w, unit: "%", placeholder: "20", step: 1, min: 2, max: 100, title: "Box width (% of image)",
              onchange: function (v) { var n = parseFloat(v); if (!isNaN(n)) { active.w = clampPct(n); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } } }).wrap,
            iconField("H", { value: active.h == null ? 12 : active.h, unit: "%", placeholder: "12", step: 1, min: 2, max: 100, title: "Box height (% of image)",
              onchange: function (v) { var n = parseFloat(v); if (!isNaN(n)) { active.h = clampPct(n); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } } }).wrap
          ));
        }
        if (active.action !== "navigate") {
          // Per-hotspot popover-card size. Overrides the block-level "Card width";
          // height is a min-height (grows the card). Blank = inherit the block default.
          E.inspector.appendChild(twoUp(
            iconField("W", { value: active.cardW, unit: "px", placeholder: "auto", step: 10, min: 120, max: 600, datalist: "dl-gap", title: "Card width (this hotspot)",
              onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete active.cardW; else active.cardW = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap,
            iconField("H", { value: active.cardH, unit: "px", placeholder: "auto", step: 10, min: 60, max: 800, datalist: "dl-gap", title: "Card height (this hotspot)",
              onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete active.cardH; else active.cardH = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap
          ));
        }
        if (active.action === "navigate") {
          // #216: the destination is any Screen node (marker.target). "Goes to" picks it
          // from the whole graph (or mints a new screen), so markers can chain to arbitrary
          // depth and several markers can share a destination.
          E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Goes to"));
          var goOpts = [["(choose a screen)", ""]];
          block.screens.forEach(function (s, si) { if (s && s.id !== curScreen.id) goOpts.push([screenLabel(s, si), s.id]); });
          // #224 T6: a navigate marker can also target a LOOP (a screen-carousel). Same
          // marker.target field; the learner cycles the loop's screens forward/back (T6b).
          (Array.isArray(block.loops) ? block.loops : []).forEach(function (lp, li) { if (lp) goOpts.push(["Loop: " + (lp.name || ("Loop " + (li + 1))), lp.id]); });
          goOpts.push(["New screen…", "__new"]);
          var goSel = dsSelect(goOpts, active.target || "", function (v) {
            pushHistory();
            if (v === "__new") {
              var sid = "scr-" + Math.random().toString(36).slice(2, 8);
              while (screenById(sid)) sid += "x";
              block.screens.push({ id: sid, visual: "", kind: "image", alt: "", markers: [] });
              active.target = sid; hotspotEditScreenId = sid; hotspotEditId = null;
            } else if (v) { active.target = v; } else { clearMarkerTarget(active); }
            reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
          });
          goSel.title = "Which screen or loop this hotspot navigates to";
          E.inspector.appendChild(goSel);
          // targeting a loop: note it (a loop has no single visual to edit inline)
          var tLoop = (Array.isArray(block.loops) ? block.loops : []).filter(function (lp) { return lp && lp.id === active.target; })[0];
          if (tLoop) E.inspector.appendChild(h("div", "insp-hint", "Targets the loop “" + (tLoop.name || "Loop") + "” (" + (tLoop.screens || []).length + " screens). Learners cycle it forward/back."));
          var tScr = markerTarget(active);
          if (tScr) {
            // edit the target screen's visual in place, or jump to it to add markers.
            fieldRow("Screen image URL", tScr.visual || "", function (v) { pushHistory(); tScr.visual = v || ""; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }, "url or upload below");
            var upS = h("button", "prop-btn", "Upload screen image / SVG…");
            upS.addEventListener("click", function () {
              var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,.svg";
              inp.addEventListener("change", function () {
                var f = inp.files && inp.files[0]; if (!f) return;
                var r = new FileReader();
                r.onload = function () { pushHistory(); tScr.visual = assetRef(r.result, f); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); };
                r.readAsDataURL(f);
              });
              inp.click();
            });
            E.inspector.appendChild(upS);
            fieldRow("Screen alt", tScr.alt || "", function (v) { tScr.alt = v; renderModelView(); }, "describe the screen");
            var jump = h("button", "prop-btn", "Edit this screen and its hotspots ▸");
            jump.addEventListener("click", function () { hotspotEditScreenId = tScr.id; hotspotEditId = null; renderInspector(); });
            E.inspector.appendChild(jump);
          }
        } else {
          var hasImg = (active.blocks || []).some(function (b) { return b.type === "image"; });
          if (hasImg) {
            var rmImg = h("button", "prop-btn", "Remove popover image");
            rmImg.addEventListener("click", function () { pushHistory(); active.blocks = (active.blocks || []).filter(function (b) { return b.type !== "image"; }); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
            E.inspector.appendChild(rmImg);
          } else {
            var addImg = h("button", "prop-btn", "Add image to popover");
            addImg.addEventListener("click", function () { pushHistory(); active.blocks = active.blocks || []; active.blocks.push({ type: "image", src: "", alt: "" }); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
            E.inspector.appendChild(addImg);
          }
          // #217: a card video (played in place, may carry sound behind an explicit play).
          // Reuses the self-hosted video path (webEmbed + localVideo) -> <video controls>;
          // select the video block inside the card to upload the file.
          var hasVid = (active.blocks || []).some(function (b) { return b.type === "webEmbed"; });
          if (hasVid) {
            var rmVid = h("button", "prop-btn", "Remove popover video");
            rmVid.addEventListener("click", function () { pushHistory(); active.blocks = (active.blocks || []).filter(function (b) { return b.type !== "webEmbed"; }); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
            E.inspector.appendChild(rmVid);
          } else {
            var addVid = h("button", "prop-btn", "Add video to popover");
            addVid.addEventListener("click", function () { pushHistory(); active.blocks = active.blocks || []; active.blocks.push({ type: "webEmbed", url: "", localVideo: "" }); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
            E.inspector.appendChild(addVid);
            E.inspector.appendChild(h("div", "insp-hint", "Then select the video block inside the card to upload the file."));
          }
        }
        E.setInspector(_hsListBody);
      }
      } finally { E.setInspector(_hins); }
      });

      // Advanced: bulk source-video purge (tour builder only). Harvested screens are
      // author-time scratch (never exported) but the recordings themselves can be heavy —
      // this is the all-at-once pressure valve alongside the per-source Remove on each card.
      if (Array.isArray(block.sources) && block.sources.length) {
        sectionGroup("Advanced", "Source videos", function (_asb) {
          var _ains = E.inspector; E.setInspector(_asb);
          try {
            var n = block.sources.length;
            E.inspector.appendChild(h("div", "insp-hint", n + " source video" + (n === 1 ? "" : "s") + " on the board. Author-time scratch — never exported."));
            var purge = h("button", "prop-btn prop-btn--danger", "Purge all sources");
            purge.addEventListener("click", function () {
              confirmModal("Purge all sources", "Remove all " + block.sources.length + " source video" + (block.sources.length === 1 ? "" : "s") + "? Screens you've already harvested from them are kept.", function () {
                pushHistory();
                delete block.sources;
                scheduleSave(); renderTourNodes(); renderTourInspector();
                try { sweepAllAssets(); } catch (_) {} // free the purged blobs now (unreferenced)
              }, { okLabel: "Purge all", danger: true });
            });
            E.inspector.appendChild(purge);
          } finally { E.setInspector(_ains); }
        });
      }

      endSections(E.inspector);
      // reveal the active hotspot on the canvas for in-place editing (after layout)
      var revealId = hotspotEditId;
      requestAnimationFrame(function () { revealHotspot(canvasNodeForBlock(block), block, revealId); });
    }
    // What this region owns, published for the OTHER regions that read it -- the tour builder
    // writes both ids, and editor.js still selects a marker from the canvas.
    kernel.provide({
      setHotspotEditId: function (v) { hotspotEditId = v; },
      setHotspotEditScreenId: function (v) { hotspotEditScreenId = v; },
      clampPct: clampPct, revealHotspot: revealHotspot, findHotspot: findHotspot,
      renderHotspotInspector: renderHotspotInspector
    });
    kernel.provideLive({
      hotspotEditId: function () { return hotspotEditId; },
      hotspotEditScreenId: function () { return hotspotEditScreenId; }
    });
    kernel.expose({
      // editor.js still calls all of these: the block-layer chrome it shares with every other
      // inspector, and the canvas-side marker verbs. They are the seam until P3b-03b and the
      // long tail move the panels that sit around them.
      blockAncestry: blockAncestry,
      blockChromeHandlers: blockChromeHandlers,
      blockChromeIo: blockChromeIo,
      hotspotCardArrays: hotspotCardArrays,
      hotspotEntryScreen: hotspotEntryScreen,
      hotspotOwnerOf: hotspotOwnerOf,
      hsCanvasCycle: hsCanvasCycle,
      imageChromeIo: imageChromeIo,
      keepHotspotCardOpen: keepHotspotCardOpen,
      revealHotspotPopover: revealHotspotPopover,
      screenIdOfMarker: screenIdOfMarker,
      showEditScreen: showEditScreen,
      renderHotspotInspector: renderHotspotInspector,
      revealHotspot: revealHotspot,
      findHotspot: findHotspot,
      clampPct: clampPct,
      hotspotEditId: function () { return hotspotEditId; },
      setHotspotEditId: function (v) { hotspotEditId = v; },
      hotspotEditScreenId: function () { return hotspotEditScreenId; },
      setHotspotEditScreenId: function (v) { hotspotEditScreenId = v; }
    });
    return VersoHotspotsEditor;
  }

  var VersoHotspotsEditor = { install: install };
  window.VersoHotspotsEditor = VersoHotspotsEditor;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoHotspotsEditor;
})();
