/*
 * Editor: boot + M2 text editing + M3 components + M4 canvas + M5 theme.
 *
 * Right panel is CONTEXTUAL (), driven by renderInspector():
 *   - nothing selected -> Canvas background + Theme (document/page context)
 *   - a component instance selected -> sectioned component properties
 *   - a plain text field selected -> that field
 * So canvas colour only appears when nothing else is selected, etc.
 *
 * Invariants: MODEL is source of truth (edits write into SAMPLE_DOC; live JSON
 * proves it); editing is editor-side so render() stays export-clean; each frame
 * is renderPage() output — the same markup the SCORM export emits.
 *
 * Classic script — runs on load, no exports.
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  // arch-P3-07: the canvas view maths (fit / focus / anchored zoom / the fit + grid cycles) and the
  // selection model (the shape, the entered-block rule, the drill chain). Both pure, both required
  // by index.html before this file.
  var CV = window.VersoCanvasView;
  var SEL = window.VersoSelection;
  // arch-P3b-01: the editor namespace. This file provides the host surface a moved region reads,
  // and binds the entry points those regions expose. Both sides are at the bottom of the file.
  var VE = window.VersoEditor;
  // arch-P3-08: the drop resolver + block-tree surgery, and the screen-graph read accessors.
  var DND = window.VersoDnd;
  var HS = window.VersoHotspots;
  // uio-O-W1: one spelling of the modifier key, so every printed shortcut in the chrome
  // (save-contract line, menu hints) reads the same on a Mac as on Windows/Linux.
  var MOD_KEY = (function () {
    try { return /Mac|iPhone|iPad/.test((navigator.platform || navigator.userAgent || "")) ? "⌘" : "Ctrl+"; }
    catch (e) { return "⌘"; }
  })();
  var GAP_X = 300, GAP_Y = 110, LABEL_H = 30;
  // JJJJ: per-page canvas position { x, y, col } (chapters = columns, pages stack
  // vertically). Filled by buildWorld (x/col) + layoutColumns (y). frameX/frameY
  // read it so all connectors/zoom/hit-test are chapter-aware.
  var framePos = [];
  var _numCols = 1;
  var CHAPTER_HEADER_H = 46; // space above each chapter column for its header bar

  // arch-P3b-07r: the chapter ops and the page drag-reparent gesture moved to editor/pages.js.
  // They are one concern: both end in `page.chapterId` plus a column-major resort, and the canvas
  // draws one column per chapter. The world BUILDER that shared the drag banner did NOT move --
  // it is the render loop, and it goes with the canvas geometry.
  var createChapter = VE.bind("createChapter");
  var moveToChapter = VE.bind("moveToChapter");
  var chapterPos = VE.bind("chapterPos");
  var reorderChapter = VE.bind("reorderChapter");
  var deleteChapter = VE.bind("deleteChapter");
  var pointerCol = VE.bind("pointerCol");
  var dropPageToCol = VE.bind("dropPageToCol");
  var wirePageDrag = VE.bind("wirePageDrag");
  var pageDragSuppressed = VE.bind("pageDragSuppressed");


  // M6: explicit breakpoints (Captivate-style, not fluid). Each is a fixed device
  // frame size; the active one drives frame dimensions + a data-bp attr on every
  // course-root that course.css keys its responsive rules off. The same data-bp
  // mechanism will drive the exported course (width thresholds), so responsive
  // behaviour is single-source between editor and export.
  var BREAKPOINTS = {
    desktop: { w: 1200, h: 675 }, // desktop preview/frame standard (16:9)
    tablet: { w: 768, h: 1024 },
    mobile: { w: 390, h: 780 }
  };
  // #42: the author can override the pixel dimensions behind the desktop/tablet/mobile
  // preview buttons. Stored per-machine (localStorage, a System setting) and merged into
  // BREAKPOINTS on boot. Editor chrome ONLY — these size the PREVIEW FRAME; the responsive
  // course CSS keys off the data-bp NAME (not pixels), so render/export stay unchanged.
  var BP_DEFAULTS = JSON.parse(JSON.stringify(BREAKPOINTS));
  var BP_SIZES_KEY = "authoring.previewSizes";
  var BP_MIN = 240, BP_MAX = 4000;
  function bpClampDim(v, def) { var n = parseInt(v, 10); if (isNaN(n)) return def; return Math.max(BP_MIN, Math.min(BP_MAX, n)); }
  function loadBpSizes() {
    try {
      var s = JSON.parse(localStorage.getItem(BP_SIZES_KEY) || "null");
      if (!s || typeof s !== "object") return;
      Object.keys(BP_DEFAULTS).forEach(function (k) {
        if (!s[k] || typeof s[k] !== "object") return;
        if (s[k].w != null) BREAKPOINTS[k].w = bpClampDim(s[k].w, BP_DEFAULTS[k].w);
        if (s[k].h != null) BREAKPOINTS[k].h = bpClampDim(s[k].h, BP_DEFAULTS[k].h);
      });
    } catch (e) {}
  }
  function saveBpSizes() { try { localStorage.setItem(BP_SIZES_KEY, JSON.stringify(BREAKPOINTS)); } catch (e) {} }
  var activeBp = "desktop";
  var FRAME_W = BREAKPOINTS.desktop.w, FRAME_H = BREAKPOINTS.desktop.h;
  function applyBp() { FRAME_W = BREAKPOINTS[activeBp].w; FRAME_H = BREAKPOINTS[activeBp].h; }
  // Perf (#150): content-visibility:auto on frames scrolled out of the viewport, so the
  // browser skips painting/laying-out offscreen pages (the big structural win on multi-
  // page / multi-chapter courses). Reversible master switch. See layoutColumns.
  var FRAME_CULL = ("contentVisibility" in (document.documentElement.style || {}));

  var COMPONENTS = window.COMPONENTS;

  var canvas = document.getElementById("canvas-viewport");
  var pagesList = document.getElementById("pages-list");
  var inspector = document.getElementById("inspector");

  // Tab / Shift+Tab moves between fields in the design panel. Committing a field fires
  // `change` -> many handlers rebuild the inspector DOM, destroying the element the browser
  // would Tab into (focus falls to <body>). So: commit the current field, then focus the
  // next/prev control in the REBUILT panel. Delegated on #inspector (persists across rebuilds).
  inspector.addEventListener("keydown", function (e) {
    // Enter in a single-line inspector field commits the value AND blurs it (deselect),
    // like Tab but without moving to the next field. Excluded: TEXTAREA (Enter = newline).
    // blur fires `change`, reusing the same commit path (which may rebuild the inspector).
    if (e.key === "Enter" && !e.altKey && !e.metaKey && !e.ctrlKey) {
      var et = e.target;
      if (et && /^(INPUT|SELECT)$/.test(et.tagName)) { e.preventDefault(); et.blur(); }
      return;
    }
    if (e.key !== "Tab" || e.altKey || e.metaKey || e.ctrlKey) return;
    var t = e.target;
    if (!t || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    var SEL = ".prop-field__input, .prop-hex, .prop-input, .prop-select, textarea";
    function fields() { return Array.prototype.filter.call(inspector.querySelectorAll(SEL), function (n) { return n.offsetParent !== null && !n.disabled; }); }
    var list = fields(), idx = list.indexOf(t);
    if (idx === -1) return;
    e.preventDefault();
    var next = idx + (e.shiftKey ? -1 : 1);
    t.blur(); // commit the current value (may rebuild the inspector)
    var list2 = fields(), target = list2[next]; // re-query after any rebuild
    if (target) { target.focus(); if (target.select) { try { target.select(); } catch (_) {} } }
  });
  var modelJson = document.getElementById("model-json");
  var modelDetails = document.getElementById("model-details"); // FFF: the live-model panel (collapsed by default)
  var zoomLevelEl = document.getElementById("zoom-level");

  // ---- Document Registry & Tabs ---------------------------------------------
  // ---- Storage seam (#66/#68/#18, platform-pivot 01) -> src/editor/storage.js ----
  // arch-P3-01: the keys, the adapter swap, the three-facet StorageBackend and the durable-write
  // core moved out to a module with an interface a test can cross. Behaviour-preserving at the
  // 'browser' default (which is every install today), with one fix the move exposed: an injected
  // adapter now serves only the facets it actually implements, so the http backend can no longer
  // swallow every library/products write into a catch. What stays HERE is the wiring plus the
  // CHROME a write outcome drives -- the save-state chip, the red data-loss banner, the alert.
  var Store = window.VersoStorage.create({ storage: localStorage });
  var StorageBackend = Store.StorageBackend;
  window.StorageBackend = StorageBackend;
  // The durable k/v writer, still the local name the publish/preset/history stores below call.
  var writeStore = window.VersoStorage.writeStore;
  function storageBackend() { return Store.backend(); }
  function registryAdapter() { return Store.adapterFor("registry"); }
  function libraryAdapter() { return Store.adapterFor("library"); }
  function productsAdapter() { return Store.adapterFor("products"); }

  function getRegistry() {
    return Store.getRegistry(function () {
      var defaultRegistry = {};
      defaultRegistry[window.SAMPLE_DOC.meta.code] = window.SAMPLE_DOC;
      return defaultRegistry;
    });
  }

  // #71 recents: last-edited / last-opened ordering for the file browser. PURE
  // (DOM-free, takes `now` as a param) so tests/run.js can exercise the comparator
  // and stampers headlessly. updatedAt/lastOpenedAt are OPTIONAL epoch-ms fields on
  // doc.meta -> they travel inside .verso exports for free. A stamper only writes a
  // scalar onto meta; it NEVER touches media (storage invariant / ADR 0001: no
  // re-inlining). Absent updatedAt sorts LAST (a course is never hidden) and the UI
  // renders it as "-".
  /* @pure-recents-start */
  function stampDocUpdatedAt(d, now) {
    if (!d) return d;
    if (!d.meta) d.meta = {};
    d.meta.updatedAt = now;
    return d;
  }
  function stampDocOpenedAt(d, now) {
    if (!d) return d;
    if (!d.meta) d.meta = {};
    d.meta.lastOpenedAt = now;
    return d;
  }
  // Product Rail: version/updatedAt stamp on a LibraryStore master, bumped on every
  // content edit -- the primitive Deliver's staleness count and Ground Truth's change-
  // tracking display both read, with no UI of its own. Promotion (the "Save to library"
  // overwrite) is the ONLY content-mutation path today (#21: no in-place master editor
  // yet), so that is the sole call site. A read never bumps it -- only this stamper does.
  function stampMasterVersion(master, now) {
    if (!master) return master;
    master.updatedAt = now;
    return master;
  }
  function docUpdatedAt(d) {
    return (d && d.meta && typeof d.meta.updatedAt === "number") ? d.meta.updatedAt : -Infinity;
  }
  // Most-recently-edited first; missing updatedAt sorts last; ties broken by title
  // (case-insensitive) so the order is deterministic across saves.
  function recentsCompare(a, b) {
    var ua = docUpdatedAt(a), ub = docUpdatedAt(b);
    if (ua !== ub) return ub - ua;
    var ta = ((a && a.meta && a.meta.title) || "").toLowerCase();
    var tb = ((b && b.meta && b.meta.title) || "").toLowerCase();
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  // #73 file browser: filter predicate (title OR code, case-insensitive; empty
  // query matches all) and the last-edited relative-time label (absent/invalid
  // timestamp -> em dash, so a course with no updatedAt is shown, never hidden).
  function courseMatchesQuery(d, q) {
    if (!q) return true;
    q = String(q).toLowerCase();
    var t = ((d && d.meta && d.meta.title) || "").toLowerCase();
    var c = ((d && d.meta && d.meta.code) || "").toLowerCase();
    return t.indexOf(q) !== -1 || c.indexOf(q) !== -1;
  }
  function formatRelativeTime(ts, now) {
    if (typeof ts !== "number" || !isFinite(ts)) return "—";
    var s = Math.floor((now - ts) / 1000);
    if (s < 0) s = 0;
    if (s < 45) return "just now";
    var mins = Math.floor(s / 60);
    if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
    var wks = Math.floor(days / 7);
    if (wks < 5) return wks + (wks === 1 ? " week ago" : " weeks ago");
    var mos = Math.floor(days / 30);
    if (mos < 12) return mos + (mos === 1 ? " month ago" : " months ago");
    var yrs = Math.floor(days / 365);
    return yrs + (yrs === 1 ? " year ago" : " years ago");
  }
  // Product Rail #1: doc.meta.productId/stage are optional tagging fields (next to
  // code/title/updatedAt) — an untagged doc has neither and behaves exactly as today.
  // A falsy filter value means "no constraint on that dimension" (matches everything,
  // tagged or not); a truthy one requires an exact match, so an untagged doc never
  // matches a specific Product/Stage filter.
  function docMatchesProductStage(d, productId, stage) {
    var meta = (d && d.meta) || {};
    if (productId && meta.productId !== productId) return false;
    if (stage && meta.stage !== stage) return false;
    return true;
  }
  // Tags (or clears, when passed a falsy value) a document's Product/Stage. Writes
  // ONLY doc.meta — never touches pages/blocks, so promotion is lossless by construction.
  function tagDocProductStage(d, productId, stage) {
    if (!d) return d;
    if (!d.meta) d.meta = {};
    if (productId) d.meta.productId = productId; else delete d.meta.productId;
    if (stage) d.meta.stage = stage; else delete d.meta.stage;
    return d;
  }
  /* @pure-recents-end */

  // SPEC 7 (Editor Window Rework): a document is a cell in a two-axis matrix, not a
  // fixed profile. Layout geometry (doc.meta.geo) x interactivity (doc.meta.interactive)
  // sit on the SAME meta object as productId/stage. These are PURE helpers (DOM-free) so
  // tests/run.js exercises them headlessly; the UI tickets (creation flow, cell switcher,
  // capability inspector, static fallback) all consume this one model. `stage` from
  // SPEC 1 is subsumed -- geo is the authoritative geometry; the three former stages are
  // now presets over {geo, interactive}. An untagged legacy doc resolves to
  // {reflow, interactive:true} = today's behaviour, so NO migration is needed and every
  // existing course opens byte-identical.
  /* @pure-doctype-start */
  var DOCTYPE_GEOS = ["reflow", "frame", "paged"];
  // The five named starting cells. Authors can recombine (any geo x interactivity) after
  // creation, so the preset list is a convenience for the create flow, not an enum lock.
  var DOCTYPE_PRESETS = [
    { key: "elearning",  name: "eLearning",         geo: "reflow", interactive: true  },
    { key: "deck",       name: "Presentation",      geo: "frame",  interactive: true  },
    { key: "onepager",   name: "1-pager",           geo: "paged",  interactive: false },
    { key: "quickstart", name: "Quick-start guide", geo: "paged",  interactive: false },
    { key: "webdoc",     name: "Responsive doc",    geo: "reflow", interactive: false }
  ];
  // Geometry-specific Document-context tools (right inspector, nothing selected).
  var DOCTYPE_COND_TOOLS = {
    paged:  ["Margins", "Running header / footer", "Page breaks", "Page numbers"],
    frame:  ["Frame size / aspect", "Slide transitions", "Animation"],
    reflow: ["Breakpoint preview"]
  };
  function isValidGeo(geo) { return DOCTYPE_GEOS.indexOf(geo) !== -1; }
  // Resolve a doc's matrix cell. Untagged/legacy docs -> {reflow, interactive:true}. An
  // out-of-range geo falls back to reflow; interactive is strict -- only an explicit
  // `false` turns a doc static (so an absent/legacy value stays interactive).
  function docCell(d) {
    var meta = (d && d.meta) || {};
    var geo = isValidGeo(meta.geo) ? meta.geo : "reflow";
    var interactive = meta.interactive === false ? false : true;
    return { geo: geo, interactive: interactive };
  }
  // Write a doc's cell onto doc.meta ONLY -- never touches pages/blocks, so a cell change
  // is lossless by construction. A falsy/invalid geo clears geo back to the reflow
  // default; a non-boolean interactive clears it back to the interactive default.
  function tagDocCell(d, geo, interactive) {
    if (!d) return d;
    if (!d.meta) d.meta = {};
    if (isValidGeo(geo)) d.meta.geo = geo; else delete d.meta.geo;
    if (interactive === true || interactive === false) d.meta.interactive = interactive;
    else delete d.meta.interactive;
    return d;
  }
  // preset key -> {geo, interactive}. Unknown key -> null (caller falls back to default).
  function presetToCell(presetKey) {
    for (var i = 0; i < DOCTYPE_PRESETS.length; i++) {
      if (DOCTYPE_PRESETS[i].key === presetKey) {
        return { geo: DOCTYPE_PRESETS[i].geo, interactive: DOCTYPE_PRESETS[i].interactive };
      }
    }
    return null;
  }
  // {geo, interactive} -> the preset key that names that cell, or null when the cell is a
  // recombination no preset covers (the matrix allows cells outside the five presets).
  function cellToPreset(geo, interactive) {
    for (var i = 0; i < DOCTYPE_PRESETS.length; i++) {
      if (DOCTYPE_PRESETS[i].geo === geo && DOCTYPE_PRESETS[i].interactive === interactive) {
        return DOCTYPE_PRESETS[i].key;
      }
    }
    return null;
  }
  // Geometry tool list for the Document-context inspector. Unknown geo -> the reflow set
  // (matches the default geo).
  function condToolsFor(geo) {
    return (DOCTYPE_COND_TOOLS[geo] || DOCTYPE_COND_TOOLS.reflow).slice();
  }
  // SPEC 7 static fallback: block types that mount runtime.js for learner interactivity. In a
  // STATIC cell (doc.meta.interactive === false) these are hidden from the Blocks library so a
  // static document can't gain new interactive content. Existing ones are NEVER dropped -- they
  // simply render their static output (the authoring canvas already renders without the learner
  // runtime; the degrade is only visible in Demo/export, a follow-up), and toggling back to
  // interactive restores them, so the toggle is lossless.
  var INTERACTIVE_BLOCK_TYPES = {
    quiz: 1, hotspot: 1, checkbox: 1, navButton: 1,
    accordion: 1, cardReveal: 1, sequence: 1, cardDeck: 1, htmlEmbed: 1, webEmbed: 1
  };
  function isInteractiveBlockType(t) { return !!INTERACTIVE_BLOCK_TYPES[t]; }
  // A palette item is offered when the cell is interactive, OR the item is not an interactive type.
  function paletteAllowsType(type, interactive) { return interactive !== false || !isInteractiveBlockType(type); }
  /* @pure-doctype-end */

  var saveStateEl = null;
  var saveFailed = false;
  var saveFailAlerted = false;   // one blocking alert per failure episode
  var failBannerEl = null;
  function triggerExportJson() {
    var b = pipelineButtons.filter(function (x) { return /export json/i.test(x.label); })[0];
    if (b && b.onClick) b.onClick();
  }
  // A LOUD, always-visible, DOM-based data-loss banner (YYY). The small chip was
  // too easy to miss -- and a save failure = unsaved work that vanishes on
  // refresh, so it must be impossible to ignore. DOM-based so it shows in Verso
  // regardless of native dialogs; carries the Export-JSON escape hatch.
  function ensureFailBanner() {
    if (failBannerEl) return failBannerEl;
    failBannerEl = document.createElement("div");
    failBannerEl.id = "save-fail-banner";
    failBannerEl.setAttribute("role", "alert");
    var msg = document.createElement("span");
    msg.className = "save-fail-banner__msg";
    failBannerEl.appendChild(msg);
    var btn = document.createElement("button");
    btn.className = "save-fail-banner__btn";
    btn.type = "button";
    btn.textContent = "Export JSON now";
    btn.addEventListener("click", triggerExportJson);
    failBannerEl.appendChild(btn);
    failBannerEl.__msg = msg;
    document.body.appendChild(failBannerEl);
    return failBannerEl;
  }
  // GGG: a one-time (per session) storage-environment advisory shown at boot when
  // the origin is fragile (file://) or IndexedDB is missing -- the data-loss
  // footguns persist.js documents. DOM-based (shows in Verso too), dismissible.
  function showStorageAdvisory() {
    var adv = window.storageAdvisory && window.storageAdvisory();
    if (!adv) return;
    try { if (sessionStorage.getItem("authoring.storageAdvisoryDismissed") === "1") return; } catch (e) {}
    var bar = document.createElement("div");
    bar.id = "storage-advisory";
    bar.setAttribute("role", "alert");
    var msg = document.createElement("span");
    msg.className = "storage-advisory__msg";
    msg.textContent = adv.msg;
    bar.appendChild(msg);
    var x = document.createElement("button");
    x.className = "storage-advisory__btn";
    x.type = "button";
    x.textContent = "Dismiss";
    x.addEventListener("click", function () {
      bar.remove();
      try { sessionStorage.setItem("authoring.storageAdvisoryDismissed", "1"); } catch (e) {}
    });
    bar.appendChild(x);
    document.body.appendChild(bar);
  }
  function setSaveState(state, detail) {
    if (!saveStateEl) {
      saveStateEl = document.getElementById("save-state");
      if (saveStateEl && !saveStateEl.__wired) {
        saveStateEl.__wired = true;
        // Failed indicator doubles as the escape hatch: click -> Export JSON.
        saveStateEl.addEventListener("click", function () { if (saveFailed) triggerExportJson(); });
      }
    }
    saveFailed = (state === "failed");
    if (state !== "failed") { // recovered: clear the loud warning + re-arm the alert
      saveFailAlerted = false;
      if (failBannerEl) failBannerEl.style.display = "none";
    }
    refreshStorageDot(); // #92b: fail -> red dot; recovered -> re-evaluate health

    if (!saveStateEl) return;
    saveStateEl.className = "save-state save-state--" + state;
    // #92 top-bar declutter: the routine 'Saved HH:MM' / 'Saving...' copy is retired.
    // The save-state element now surfaces ONLY the loud data-loss failure; the separate
    // red FAIL banner (ensureFailBanner) remains the primary safety net. Hidden otherwise.
    if (state === "failed") { // LOUD
      saveStateEl.hidden = false;
      saveStateEl.textContent = "Save failed - export JSON";
      saveStateEl.title = detail || "Could not save to this browser.";
      var msg = detail || "A save failed - your recent changes are NOT saved and will be lost on refresh.";
      var banner = ensureFailBanner();
      banner.__msg.textContent = "Not saved: " + msg;
      banner.style.display = "flex";
      if (!saveFailAlerted) {
        saveFailAlerted = true;
        // one blocking alert per episode (async so the current save flow finishes first)
        setTimeout(function () {
          window.alert("DATA-LOSS WARNING\n\n" + msg + "\n\nClick \"Export JSON now\" in the red bar to save your work to a file before refreshing.");
        }, 0);
      }
    } else { // saved / saving -> silent (no routine copy on the top bar)
      saveStateEl.hidden = true;
      saveStateEl.textContent = "";
      saveStateEl.title = "";
    }
  }

  // Save-suppression guard (#69, clobber-proof cutover): while a browser->file
  // migration is switching backends, EVERY durable-write path must be a no-op so a
  // stale in-memory registry can never be flushed under the new backend (the exact
  // 2026-07-12 clobber). saveRegistry is the single choke point, so guarding it here
  // neuters scheduleSave/flushSave/pagehide/beforeunload/error/rejection at once; the
  // latter two are also guarded so nothing is even scheduled. No-op at the "browser"
  // default (window.Migration.savesSuppressed() is only true during a migration).
  function savesSuppressed() {
    return !!(window.Migration && window.Migration.savesSuppressed && window.Migration.savesSuppressed());
  }
  // The chrome half of the write choke point: the module does the media hoist, the serialise and
  // the durable write and hands back an outcome; this turns that outcome into what the author
  // sees. A swallowed QuotaExceededError is the #1 data-loss landmine (the write fails, the stale
  // registry is faithfully restored next boot, and the day's work is gone with no signal), so
  // every non-ok stage is LOUD.
  function saveRegistry(r) {
    if (savesSuppressed()) return false;
    setSaveState("saving");
    var res = Store.saveRegistry(r);
    if (res.ok) { setSaveState("saved"); if (typeof scheduleBackup === "function") scheduleBackup(); return true; }
    if (res.stage === "suppressed") return false;
    if (res.stage === "serialise") {
      setSaveState("failed", "Save failed: the document could not be serialised (" +
        (res.error && res.error.message || res.error) + "). Export JSON now to avoid losing work.");
      if (window.console && console.error) console.error("[save] serialise failed:", res.error);
      return false;
    }
    setSaveState("failed", res.quota
      ? "Storage full - your latest changes are NOT saved in this browser. Click to export JSON now and avoid losing work."
      : "Save failed: " + (res.error && res.error.message || res.error) + ". Click to export JSON now.");
    if (window.console && console.error) console.error("[save] registry write failed:", res.error);
    return false;
  }
  // Persist edits quickly + reliably (data-loss gotcha): writeModel debounces a
  // save on every text change, blur flushes immediately, and pagehide/beforeunload
  // flush on exit. Verso (WKWebView) does NOT reliably fire beforeunload on a
  // Cmd+R reload, and the 4s autosave timer leaves a window where in-edit text
  // (never blurred) is lost on refresh -- these close it.
  var saveDebounceT = null;
  function scheduleSave() {
    if (savesSuppressed()) return;
    if (doc) stampDocUpdatedAt(doc, Date.now()); // #71 recents: this is the post-edit hook -> bump the active doc only
    if (saveDebounceT) clearTimeout(saveDebounceT);
    saveDebounceT = setTimeout(function () { saveDebounceT = null; saveRegistry(registry); }, 600);
    scheduleWeightRefresh();
  }

  // §308 live course-weight readout: show the estimated exported package size in the
  // top bar so heavy courses are visible at a glance. Reuses the export estimator
  // (window.estimateCourseBytes) — the SAME math as the oversize-package guard — and
  // refreshes (throttled) whenever the doc changes. Editor chrome only; nothing ships.
  var _weightEl = null, _weightT = null;
  function _fmtBytes(b) {
    if (b < 1024) return b + " B";
    var kb = b / 1024; if (kb < 1024) return Math.round(kb) + " KB";
    var mb = kb / 1024; return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB";
  }
  function refreshCourseWeight() {
    if (!_weightEl) _weightEl = document.getElementById("course-weight");
    if (!_weightEl || typeof window.estimateCourseBytes !== "function") return;
    var b = window.estimateCourseBytes(doc);
    _weightEl.textContent = _fmtBytes(b);
    var heavy = b > 100 * 1024 * 1024;
    _weightEl.classList.toggle("is-heavy", heavy);
    _weightEl.title = "Estimated exported course weight (assets + content) is about " + _fmtBytes(b) +
      (heavy ? " — past ~100 MB, may exceed Moodle's upload limit." : ".");
  }
  function scheduleWeightRefresh() {
    if (_weightT) return;
    _weightT = setTimeout(function () { _weightT = null; refreshCourseWeight(); probeStorageQuota(); }, 1200);
  }

  // #92b storage-health dot: a tri-state coloured dot in the top
  // bar replacing the routine "Saved" text + the standalone course-weight readout.
  // green (ok)  -> healthy
  // amber (warn)-> getting full, or a fragile storage environment (file:// / no IndexedDB)
  // red (fail)  -> near/over quota, or a save has failed (data-loss risk)
  // The separate red data-loss FAIL banner is untouched (the primary safety net). Clicking
  // the dot opens a small popover with backend + quota % + estimated course weight.
  var _storageDotEl = null, _storageRatio = null;
  function probeStorageQuota() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (est) {
          if (est && est.quota) { _storageRatio = est.usage / est.quota; refreshStorageDot(); }
        }).catch(function () {});
      }
    } catch (e) {}
  }
  function refreshStorageDot() {
    if (!_storageDotEl) _storageDotEl = document.getElementById("storage-dot");
    if (!_storageDotEl) return;
    var adv = (typeof window.storageAdvisory === "function") ? window.storageAdvisory() : null;
    var state = "ok";
    if (saveFailed || (_storageRatio != null && _storageRatio >= 0.9)) state = "fail";
    else if ((_storageRatio != null && _storageRatio >= 0.7) || (adv && adv.level === "warn")) state = "warn";
    _storageDotEl.className = "storage-dot storage-dot--" + state;
    _storageDotEl.title = (state === "fail" ? "Storage nearly full or a save failed"
      : state === "warn" ? "Storage getting full" : "Storage healthy") + " — click for details";
  }
  // The ONE anchored chrome popover -- the UI spine's Popover surface (anchored to its trigger, a
  // few rows of fact, light-dismiss). The storage dot's details and the Publish variant roll-up
  // (uio-P-C08) both open THROUGH this; a second floating-div implementation anywhere in the chrome
  // is exactly the per-corner divergence this helper exists to prevent. Opening from the anchor
  // that already owns the open popover closes it (toggle); Esc closes it as the topmost layer.
  var _chromePopEl = null, _chromePopAnchor = null;
  function closeChromePop() {
    if (!_chromePopEl) return;
    if (_chromePopEl.parentNode) _chromePopEl.parentNode.removeChild(_chromePopEl);
    _chromePopEl = null; _chromePopAnchor = null;
    document.removeEventListener("mousedown", _chromePopOutside, true);
    // uio-F05: Escape is the layer stack's, not this popover's. Popping restores focus to the
    // anchor, so dismissing a popover leaves the keyboard where it started.
    popLayer("chrome-pop");
  }
  function _chromePopOutside(e) {
    if (_chromePopEl && !_chromePopEl.contains(e.target) && !(_chromePopAnchor && _chromePopAnchor.contains(e.target)) && e.target !== _chromePopAnchor) closeChromePop();
  }
  // uio-F05: the ONE escalation control. A narrow surface (popover, menu) states the few things
  // it can hold, then routes into the sheet on a named section — never "go and look in Settings".
  // { label, tab, section }. Used by openChromePop(opts.escalate) and by the context menu.
  function escalateLink(spec) {
    var a = h("button", "chrome-pop__escalate", spec.label || "All settings");
    a.type = "button";
    a.title = "Open the settings sheet" + (spec.label ? "" : "") ;
    a.addEventListener("click", function () {
      closeChromePop();
      openSettingsSection(spec.tab || "project", spec.section || null);
    });
    return a;
  }
  function openChromePop(anchor, build, opts) {
    if (_chromePopAnchor === anchor) { closeChromePop(); return null; } // toggle off
    closeChromePop();
    var pop = h("div", "chrome-pop" + (opts && opts.cls ? " " + opts.cls : ""));
    build(pop);
    // uio-F05: a popover holds a few rows and then has to hand over. The spine requires every
    // narrow surface to carry a VISIBLE route into the sheet, so the author is never stuck in a
    // dead end guessing where the rest of the settings live.
    if (opts && opts.escalate) pop.appendChild(escalateLink(opts.escalate));
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + "px";
    if (opts && opts.align === "right") pop.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    else pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - (pop.offsetWidth || 220) - 8)) + "px";
    // no room below the anchor: open above it instead of running off screen
    var ph = pop.offsetHeight || 0;
    if (r.bottom + 6 + ph > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - 6 - ph) + "px";
    _chromePopEl = pop; _chromePopAnchor = anchor;
    pushLayer("chrome-pop", closeChromePop);
    setTimeout(function () {
      document.addEventListener("mousedown", _chromePopOutside, true);
    }, 0);
    return pop;
  }
  function openStoragePopover(anchor) {
    openChromePop(anchor, function (pop) {
      pop.appendChild(h("div", "chrome-pop__title", "Storage"));
      function row(label, val, cls) {
        var r = h("div", "chrome-pop__row");
        r.appendChild(h("span", "chrome-pop__label", label));
        r.appendChild(h("span", "chrome-pop__val" + (cls ? " " + cls : ""), val));
        pop.appendChild(r);
      }
      var backend = storageBackend();
      row("Location", backend === "file" ? "Local file" : "This browser");
      row("Used", _storageRatio != null ? Math.round(_storageRatio * 100) + "%" : "n/a");
      var weight = (typeof window.estimateCourseBytes === "function") ? _fmtBytes(window.estimateCourseBytes(doc)) : "-";
      row("Course weight", weight);
      // uio-F04: share of this document's prose linked to approved source, phrased by the shared
      // resolver so it matches the Publish row and the Source top bar word for word.
      var stFacts = f04DocFacts(activeDocId);
      if (stFacts) row("Source alignment", stFacts.alignment.label);
      if (saveFailed) pop.appendChild(h("div", "chrome-pop__note chrome-pop__note--fail", "A save failed - export JSON from the red bar to avoid losing work."));
      else { var adv = (typeof window.storageAdvisory === "function") ? window.storageAdvisory() : null; if (adv && adv.msg) pop.appendChild(h("div", "chrome-pop__note", adv.msg)); }
    }, { align: "right", escalate: { label: "Backup settings", tab: "project", section: "backup" } });
  }
  function mountStorageDot() {
    var dot = document.getElementById("storage-dot"); if (!dot) return;
    if (!dot.__wired) { dot.__wired = true; dot.addEventListener("click", function () { openStoragePopover(dot); }); }
    probeStorageQuota();
    refreshStorageDot();
  }
  // Environment cue (2026-07-26): the staging Pages deploy serves at .../staging/ (see
  // .github/workflows/deploy.yml) -- flag it so a staging session is never mistaken for
  // production. Matches ONLY that exact deployed path (not a local folder that merely
  // happens to have "staging" somewhere in it, and never a file:// local open). Editor
  // chrome only -- editor.js never ships in the SCORM export, so a learner never sees this.
  function mountStagingBanner() {
    try {
      if (location.protocol.indexOf("http") !== 0) return;
      if (!/\/staging\/(index\.html)?$/.test(location.pathname)) return;
    } catch (e) { return; }
    var b = document.createElement("div");
    b.id = "staging-banner";
    b.textContent = "STAGING";
    b.title = "Pre-release test build — not production";
    document.body.appendChild(b);
  }
  function flushSave() {
    if (savesSuppressed()) return;
    if (saveDebounceT) { clearTimeout(saveDebounceT); saveDebounceT = null; }
    saveRegistry(registry);
  }
  window.addEventListener("pagehide", flushSave);
  window.addEventListener("beforeunload", flushSave);
  // CCC: last-ditch resilience -- on any uncaught error/rejection, log it and
  // FLUSH a save so a crash can't take unsaved work with it. Not an alert (the
  // red data-loss banner already surfaces real save failures loudly).
  window.addEventListener("error", function (e) {
    if (window.console && console.error) console.error("[uncaught]", (e && e.error) || (e && e.message) || e);
    try { flushSave(); } catch (_) {}
  });
  window.addEventListener("unhandledrejection", function (e) {
    if (window.console && console.error) console.error("[unhandled rejection]", e && e.reason);
    try { flushSave(); } catch (_) {}
  });
  function getOpenDocIds() { return Store.getOpenDocIds([window.SAMPLE_DOC.meta.code]); }
  function saveOpenDocIds(ids) { Store.saveOpenDocIds(ids); }
  function getActiveDocId() { return Store.getActiveDocId(window.SAMPLE_DOC.meta.code); }
  function saveActiveDocId(id) { Store.saveActiveDocId(id); }

  // AAA: versioned doc-migration harness. Every load + import runs this so an
  // older saved course is UPGRADED to the current shape instead of crashing as
  // the schema evolves. To add a migration: handle it under the next `v < N`
  // guard and bump the stamped version. Non-destructive + idempotent (a doc at
  // the current version is untouched except the stamp).
  // MMMM: strip invisible / .notdef / control chars that sneak in via paste
  // (zero-width U+200B-200D, soft hyphen U+00AD, BOM U+FEFF, object/replacement
  // U+FFFC/U+FFFD). Pure; none of these ever legitimately appear in ids, urls, hex,
  // or base64, so a deep pass over the whole doc is safe and also repairs mojibake
  // U+FFFD in raw HTML-interaction markup.
  var INVISIBLE_RE = /[\u200B-\u200D\u00AD\uFEFF\uFFFC\uFFFD]/g;
  // Repair UTF-8-bytes-decoded-through-a-legacy-charset mojibake (the CONFIRMED cause of
  // garbled interaction copy, e.g. an em dash shows as `\u201A\u00C4\u00EE`). The engine
  // now lives in render.js as `window.__repairMojibake` (an ftfy-style Mac-Roman +
  // Windows-1252 decode round-trip) so it ships in the SCORM export and BOTH surfaces
  // repair identically -- one implementation, not a fixed table that misses cases.
  // render.js loads before editor.js; fall back to identity if it somehow isn't present.
  function repairMojibake(s) {
    return (typeof s === "string" && typeof window.__repairMojibake === "function") ? window.__repairMojibake(s) : s;
  }
  function sanitizeText(s) { return typeof s === "string" ? repairMojibake(s).replace(INVISIBLE_RE, "") : s; }
  // Editor CHROME leaking into saved text: the canvas injects a drag-handle overlay
  // INTO each block (which for a simple text block IS the [data-edit] node), so a rich
  // commit that captures node.innerHTML bakes the handle in; and pasting a copied canvas
  // block drags its whole chrome (is-selected + `outline: \u2026var(--accent)` = a blue box
  // frozen into the DATA, surviving reload) into a contenteditable field. This strips
  // those artifacts. PURE + idempotent; only touches strings that carry the signature
  // (so author HTML-interaction markup in block.html is never mangled).
  /* @sanitize-field-start */
  var CHROME_SIG = /canvas-drag-handle|data-(?:edit|rich)=|is-(?:editable|selected|text-editing)|--(?:ui-)?accent|\u283F/;
  var EDITOR_CLASS = /^(canvas-block|canvas-block-wrapper|is-editable|is-selected|is-text-editing|is-multi|is-hidden|is-locked|is-dragging|drop-into|reveal-block-outline)$/;
  // #120 inline styles (1/4): `data-style-ref` is DELIBERATELY absent from the attr
  // strip list below, so an inline `<span data-style-ref="Name">` survives a save/commit
  // that trips the chrome signature -- editor-only attrs (data-edit/rich, is-selected,
  // caret-color, accent outline) are stripped while the style ref is preserved.
  function sanitizeFieldHtml(s) {
    if (typeof s !== "string" || !CHROME_SIG.test(s)) return s;
    var out = s
      // the drag-handle overlay (braille gripper), captured whole into innerHTML
      .replace(/<div class="canvas-drag-handle"[^>]*>[\s\S]*?<\/div>/g, "")
      .replace(/\u283F/g, "")
      // editor-only attributes that ride in on paste / capture
      .replace(/\s(?:contenteditable|spellcheck|draggable|data-edit|data-rich|data-instance)="[^"]*"/g, "");
    // drop editor-only classes from any class="" (keep legit render classes)
    out = out.replace(/\sclass="([^"]*)"/g, function (m, cls) {
      var kept = cls.split(/\s+/).filter(function (c) { return c && !EDITOR_CLASS.test(c); });
      return kept.length ? ' class="' + kept.join(" ") + '"' : "";
    });
    // drop selection-outline + caret artifacts from inline styles (keep author styles).
    // Targeted removals — NOT a `;`-split — so values containing entities (a `&quot;` ends
    // in a semicolon) or url()s survive intact.
    out = out.replace(/\sstyle="([^"]*)"/g, function (m, st) {
      var cleaned = st
        .replace(/(?:^|;)\s*caret-color\s*:[^;]*/gi, "")
        .replace(/(?:^|;)\s*transition-timing-function\s*:[^;]*/gi, "")
        .replace(/(?:^|;)\s*outline\s*:[^;]*--(?:ui-)?accent[^;]*/gi, "")
        .replace(/;\s*;/g, ";").replace(/^\s*;\s*/, "").replace(/\s*;\s*$/, "").trim();
      return cleaned ? ' style="' + cleaned + '"' : "";
    });
    return out;
  }
  /* @sanitize-field-end */
  function sanitizeDeep(v) {
    if (typeof v === "string") return sanitizeText(sanitizeFieldHtml(v));
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) v[i] = sanitizeDeep(v[i]); return v; }
    if (v && typeof v === "object") { for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = sanitizeDeep(v[k]); return v; }
    return v;
  }
  window.__sanitizeText = sanitizeText; // headless test hook
  window.__sanitizeFieldHtml = sanitizeFieldHtml; // headless test hook
  // WWW: when a saved text style is APPLIED, its colour must WIN. applyTextStyle sets
  // node.style.color on the CONTAINER, but the field's rich HTML may carry inline
  // <span style="color:..."> (CSV import / paste / prior authoring), and an inner inline
  // colour beats the container in the cascade -> the applied colour looks "stuck." Strip
  // inline `color` decls so the style/theme colour cascades from the node. Deliberately
  // NOT background-color: no text-style control sets a highlight, so stripping it would
  // silently nuke intentional author highlights. The `(?:^|;)` anchor means the `color`
  // inside `background-color` is never matched. PURE + idempotent; run ONLY at apply-style
  // time, never globally (inline colour is legitimate when NO named style is referenced).
  function stripInlineColor(html) {
    if (typeof html !== "string" || html.indexOf("color") === -1) return html;
    return html.replace(/\sstyle="([^"]*)"/g, function (m, st) {
      var cleaned = st
        .replace(/(?:^|;)\s*color\s*:[^;]*/gi, "")
        .replace(/;\s*;/g, ";").replace(/^\s*;\s*/, "").replace(/\s*;\s*$/, "").trim();
      return cleaned ? ' style="' + cleaned + '"' : "";
    });
  }
  window.__stripInlineColor = stripInlineColor; // headless test hook
  // "Override always wins" (James, 2026-07-07): the editor has NO inline text-colour
  // command (only B/I/U), so ANY inline `color:` in a rich-text field is always FOREIGN
  // PASTE RESIDUE, never author intent. Strip it from EVERY rich-text string on load so the
  // block-type default (e.g. .body-note's muted colour) OR an applied text-style colour
  // always governs — never a stray baked span (the grey↔white body-text mismatch James hit;
  // e.g. a pasted `<span style="color:#fff">` that survived because the block had no
  // styleRef). Idempotent; safe on non-HTML strings (stripInlineColor only rewrites a
  // style="color:" run). SKIPS raw HTML-interaction / asset markup — the `html`/`svg`/`src`
  // fields and any full-document string (`<!doctype`/`<html>`) — whose colours are
  // legitimate embed styling, not text-block colour. (Supersedes the earlier styleRef-gated
  // version: the no-in-app-colour-command fact makes a global strip safe.)
  function stripStyledColorsDeep(v) {
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) stripStyledColorsDeep(v[i]); return; }
    if (v && typeof v === "object") {
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
        var val = v[k];
        if (typeof val === "string") {
          if (k === "html" || k === "svg" || k === "src") continue;   // raw embed / asset markup
          if (/<!doctype|<html[\s>]/i.test(val)) continue;            // a full HTML document
          v[k] = stripInlineColor(val);
        } else stripStyledColorsDeep(val);
      }
    }
  }
  window.__stripStyledColorsDeep = stripStyledColorsDeep; // headless test hook
  // #124: seed the per-course doc.theme (one-time, guarded, idempotent). A doc that
  // predates the per-doc theme inherits whatever was the editor-GLOBAL working theme
  // (localStorage authoring.themeOverrides) so existing courses look IDENTICAL on
  // first open, then diverge going forward. Brand-new docs (no prior global override)
  // get the built-in default. Later opens no-op (doc.theme already present, just
  // re-normalised to backfill any groups added by a newer schema).
  function seedDocTheme(d) {
    if (!d || typeof d !== "object") return;
    if (d.theme && d.theme.color && d.theme.color.dark && d.theme.color.light) {
      window.normalizeDocTheme(d.theme); return;
    }
    var modes = null;
    try {
      var ovr = localStorage.getItem("authoring.themeOverrides");
      if (ovr) { var p = JSON.parse(ovr); if (p && p.dark && p.light) modes = p; }
    } catch (e) {}
    d.theme = modes ? window.makeDocTheme(modes) : window.defaultDocTheme();
  }

  function normalizeDoc(d) {
    if (!d || typeof d !== "object") return d;
    // A stray null/malformed entry in d.pages (seen from a live-session page-array bug)
    // crashes every walker below it (and everywhere else the doc is read) the moment it's
    // hit -- strip it before any of those walkers run, so a doc that got corrupted mid-
    // session self-heals on next load instead of crashing on it.
    if (Array.isArray(d.pages)) d.pages = d.pages.filter(function (p) { return p && typeof p === "object"; });
    var v = d.schemaVersion || 0;
    // v0 -> v1: course header/footer field renamed chrome -> headerFooter.
    if (v < 1 && d.chrome && !d.headerFooter) { d.headerFooter = d.chrome; delete d.chrome; }
    // v1 -> v2 (JJJJ): introduce the Chapter layer. First try KKKK menu-migration
    // (legacy Course Menu page + "01…" page names -> explicit chapters, menu page
    // removed); if the doc has no recognisable menu/naming structure, fall back to
    // a single default chapter holding every page. Non-destructive (page order
    // preserved; discarded menu content is flagged, not silently dropped).
    if (v < 2 && (!Array.isArray(d.chapters) || !d.chapters.length)) {
      var rep = window.migrateToChapters ? window.migrateToChapters(d) : { changed: false, flags: [] };
      if (!rep.changed) {
        var cid = "chap-" + Date.now();
        d.chapters = [{ id: cid, name: "Chapter 1", order: 0 }];
        (d.pages || []).forEach(function (p) { if (p && !p.chapterId) p.chapterId = cid; });
      } else if (rep.flags && rep.flags.length) {
        d.__migrationFlags = (d.__migrationFlags || []).concat(rep.flags); // surfaced by the editor after load
      }
    }
    // §5: quiz rich sub-fields (done.title/body; question prompt/feedbackCorrect/
    // feedbackIncorrect) used to share ONE style object per parent, so formatting one
    // bled onto its sibling. They now carry per-field styles. Migrate any NON-EMPTY
    // shared style onto each field (preserving the old "applied to all" look so nothing
    // shifts visually); idempotent (skips once the per-field keys exist).
    (function migrateQuizFieldStyles() {
      function clone(o) { return JSON.parse(JSON.stringify(o)); }
      function nonEmpty(o) { return o && typeof o === "object" && Object.keys(o).length > 0; }
      function visit(blocks) {
        (blocks || []).forEach(function (b) {
          if (!b || typeof b !== "object") return;
          if (b.type === "quiz") {
            // per-field key = a {style,styleRef} host (same shape resolveBlockStyle reads),
            // so wrap the legacy flat style in { style: ... }.
            if (b.done && nonEmpty(b.done.style) && !b.done.titleStyle && !b.done.bodyStyle) {
              b.done.titleStyle = { style: clone(b.done.style) }; b.done.bodyStyle = { style: clone(b.done.style) }; delete b.done.style;
            }
            (b.questions || []).forEach(function (q) {
              if (nonEmpty(q.style) && !q.promptStyle && !q.feedbackCorrectStyle && !q.feedbackIncorrectStyle) {
                q.promptStyle = { style: clone(q.style) }; q.feedbackCorrectStyle = { style: clone(q.style) }; q.feedbackIncorrectStyle = { style: clone(q.style) }; delete q.style;
              }
            });
          }
          // Card Reveal: a legacy FIXED cardBox.fill didn't switch light/dark -> split it
          // onto both per-mode fills (preserves the look, now theme-switchable).
          if (b.type === "cardReveal" && b.cardBox && b.cardBox.fill && !b.cardBox.fillDark && !b.cardBox.fillLight) {
            b.cardBox.fillDark = b.cardBox.fill; b.cardBox.fillLight = b.cardBox.fill; delete b.cardBox.fill;
          }
          // Card Reveal flip: both faces are authorable (items[].front = Side 1). A flip
          // card without a front is seeded from the old block-level hint label, so the
          // previous front-face look carries over as editable content (no data loss).
          // Idempotent; reveal/off items are never touched.
          if (b.type === "cardReveal" && b.revealStyle === "flip" && Array.isArray(b.items)) {
            b.items.forEach(function (it) { if (it && !Array.isArray(it.front)) it.front = [{ type: "heading", text: b.hint || "Flip" }]; });
          }
          // Sequence block field-defaults: a new type (no legacy migration). Default the three
          // toggles when absent and coerce items to an array, so a hand-built doc can't
          // crash render. Idempotent; never overwrites an authored value.
          if (b.type === "sequence") {
            if (b.spine == null) b.spine = "numbered";
            if (b.orient == null) b.orient = "vertical";
            if (b.reveal == null) b.reveal = "scroll";
            if (!Array.isArray(b.items)) b.items = [];
          }
          // Card Deck field-defaults: a new type (no legacy migration). Coerce items to an
          // array so a hand-built doc can't crash render. Idempotent.
          if (b.type === "cardDeck" && !Array.isArray(b.items)) b.items = [];
          if (Array.isArray(b.children)) visit(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(visit);
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (Array.isArray(it.children)) visit(it.children); if (Array.isArray(it.front)) visit(it.front); });
        });
      }
      (d.pages || []).forEach(function (p) { visit(p.blocks); });
      // Course HEADER title + subtitle share the header-config obj (same shared-style
      // collision as the quiz done fields) -> wrap any legacy shared style into per-field
      // hosts. (The footer has a single rich field, so it never collided.)
      var hdr = d.headerFooter && d.headerFooter.header;
      if (hdr && nonEmpty(hdr.style) && !hdr.titleStyle && !hdr.subtitleStyle) {
        hdr.titleStyle = { style: clone(hdr.style) }; hdr.subtitleStyle = { style: clone(hdr.style) }; delete hdr.style;
      }
    })();
    // #215 / ADR-0003: hotspot blocks -> the unified screen-graph model. The pure
    // per-block transform lives in render.js (window.migrateHotspotBlock, exported
    // for tests); this walk just reaches every hotspot block, including ones nested
    // in containers and inside other hotspots' popover cards. Self-contained walk
    // (no shared helper) so the test harness's normalizeDoc slice stays evaluable.
    (function () {
      function walk(blocks) {
        (blocks || []).forEach(function (b) {
          if (!b || typeof b !== "object") return;
          if (b.type === "hotspot" && window.migrateHotspotBlock) window.migrateHotspotBlock(b);
          if (Array.isArray(b.children)) walk(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(function (col) { if (Array.isArray(col)) walk(col); });
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (Array.isArray(it.children)) walk(it.children); if (Array.isArray(it.front)) walk(it.front); });
          if (Array.isArray(b.screens)) b.screens.forEach(function (s) { if (s && Array.isArray(s.markers)) s.markers.forEach(function (m) { if (m && Array.isArray(m.blocks)) walk(m.blocks); }); });
        });
      }
      (d.pages || []).forEach(function (pg) { walk(pg.blocks); });
    })();
    // v3 -> v4 (P2 auto page-naming, CORRECTED): the v2->v3 pass seeded page.title from
    // page.name, but real course names are AUTO-generated ("01 · Overview", …) carrying their
    // OWN numbering — so as a title override they SUPPRESSED the intended first-copy title AND
    // double-numbered it. Reverse it: strip any auto-seeded override (title === the page's name)
    // so the title derives from the first line of copy again. A genuine RENAME (title != name)
    // is preserved. Version-gated one-shot.
    if (v < 4) {
      (d.pages || []).forEach(function (p) {
        if (p && p.title != null && typeof p.name === "string" && String(p.title).trim() === p.name.trim()) {
          delete p.title;
        }
      });
    }
    seedDocTheme(d); // #124: ensure a per-course doc.theme (one-time migration from the old global theme)
    d.schemaVersion = 4; // = current DOC schema version
    sanitizeDeep(d); // MMMM: clean invisible/mojibake chars from existing docs on load (idempotent)
    // §64: retire the old per-block recap flag on load — the chapter summary now lives
    // in the quiz completion panel. Drop block.recap so any flagged block becomes normal
    // visible content (nothing lost); idempotent.
    (function () {
      function stripRecap(blocks) {
        (blocks || []).forEach(function (b) {
          if (!b) return;
          if (b.recap) delete b.recap;
          if (b.children) stripRecap(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(stripRecap);
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (it.children) stripRecap(it.children); if (Array.isArray(it.front)) stripRecap(it.front); });
        });
      }
      (d.pages || []).forEach(function (pg) { stripRecap(pg.blocks); });
    })();

    // §64 / #82: normalise the chapter summary into clean BARE <li> items. The summary field
    // renders AS the list block's editable <ul> primitive (render.js), so its stored value is
    // the <ul>'s innerHTML — bare <li>s, NOT a wrapping <ul> (legacy data wrapped the list in
    // <ul>..</ul>, which nested when fed into the <ul> tag). Flatten any legacy/mixed structure
    // (loose lines, stray nested lists, the old <ul> wrapper) into clean bullets, preserving
    // inline formatting. Idempotent; a plain-text summary is left untouched.
    (function () {
      function normalizeSummary(html) {
        if (html == null) return html;
        var str = String(html);
        if (!/<li/i.test(str)) return str;
        var t = str.replace(/<(ul|ol|li|div|p)[^>]*>/gi, "\n").replace(/<\/(ul|ol|li|div|p)\s*>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
        var lines = t.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
        return lines.length ? lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") : "";
      }
      function walkQuiz(blocks) {
        (blocks || []).forEach(function (b) {
          if (!b) return;
          if (b.type === "quiz" && b.done && b.done.summary != null) b.done.summary = normalizeSummary(b.done.summary);
          if (b.children) walkQuiz(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(walkQuiz);
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (it.children) walkQuiz(it.children); if (Array.isArray(it.front)) walkQuiz(it.front); });
        });
      }
      (d.pages || []).forEach(function (pg) { walkQuiz(pg.blocks); });
    })();

    // §174: unify HTML-interaction sizing — retire the Fit/Fill toggle (drop block.fitFill)
    // and default interactions to centred, so the shipped "just works" responsive model
    // applies to existing embeds too. Idempotent; preserves an explicit start/end align.
    (function () {
      function walkEmbeds(blocks) {
        (blocks || []).forEach(function (b) {
          if (!b) return;
          if (b.type === "htmlEmbed") { if (b.fitFill != null) delete b.fitFill; if (b.align == null) b.align = "center"; }
          if (b.children) walkEmbeds(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(walkEmbeds);
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (it.children) walkEmbeds(it.children); if (Array.isArray(it.front)) walkEmbeds(it.front); });
        });
      }
      (d.pages || []).forEach(function (pg) { walkEmbeds(pg.blocks); });
    })();
    stripStyledColorsDeep(d); // WWW: existing styleRef blocks obey their style colour (retroactive, idempotent)
    // §12 slice 0: stamp a stable, persisted `cid` on EVERY block (mint-on-load,
    // kept in the .json) so comments can block-anchor + re-project across views.
    // Idempotent (skips blocks that already have one). Editor-chrome — never
    // exported (render ignores cid), so the SCORM package is byte-unaffected.
    (function () {
      // self-contained minter (normalizeDoc is sliced in isolation by the test
      // harness, so it can't rely on the top-level mintCid defined further down).
      function newCid() { return "c_" + Math.random().toString(36).slice(2, 8); }
      function stampCids(blocks) {
        (blocks || []).forEach(function (b) {
          if (!b || typeof b !== "object") return;
          if (b.type && !b.cid) b.cid = newCid();
          if (b.children) stampCids(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(stampCids);
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (Array.isArray(it.children)) stampCids(it.children); if (Array.isArray(it.front)) stampCids(it.front); });
        });
      }
      (d.pages || []).forEach(function (pg) { stampCids(pg.blocks); });
    })();
    // §12 slice 1: the comment store lives on the doc (round-trips in the .json via
    // the normal save path) and is STRIPPED from the learner SCORM export — export
    // builds HTML from render, which never reads doc.comments, so comments never
    // leak (export-control-safe). Just ensure the array exists.
    if (!Array.isArray(d.comments)) d.comments = [];
    // #215: the onboarding tour was retired — strip any stale doc.tour blob on load
    // so legacy docs stop carrying inert data (nothing reads it anymore).
    if (d.tour != null) delete d.tour;
    // §55 fix: self-heal the play-order invariant on EVERY load — re-sort doc.pages[]
    // column-major (grouped by chapter in doc.chapters order, order-within kept) so any
    // drift (legacy/CSV imports, a cross-chapter move that skipped the resort, a deletion
    // gap) can never reach the SCORM export as skipped/out-of-order chapters. Idempotent
    // (an already-sorted array is unchanged). Chapters are guaranteed by the v<2 block above.
    // Canonicalize chapter order FIRST: sort the chapters ARRAY by c.order and re-index
    // c.order to its position, so array-index == c.order everywhere. reorderChapter only
    // swaps order VALUES (leaves the array unsorted), so array-index consumers diverged
    // from the c.order-based outline -> Next skipped a chapter. Idempotent. (Fix 2026-07-08.)
    if (Array.isArray(d.chapters) && d.chapters.length) {
      d.chapters.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      d.chapters.forEach(function (c, i) { c.order = i; });
    }
    if (window.resortColumnMajor && Array.isArray(d.pages) && Array.isArray(d.chapters)) {
      d.pages = window.resortColumnMajor(d.pages, d.chapters);
    }
    return d;
  }
  window.__migrateDoc = normalizeDoc; // headless test hook

  // >>> P2 auto page-naming helpers ------------------------------------------
  // AUTHORING-ONLY page name: "<chapter#>.<page-in-chapter#> <title>", where the NUMBER is
  // DERIVED from the chapter model on every render (never stored -> self-organizes across
  // split/add/delete/move, same edit-proof principle as the §55 play-order fix) and the
  // TITLE is an author-overridable page.title, falling back to the first copy on the slide.
  // Pure of render/export: used only by the canvas frame-label + the outliner; the learner
  // nav + SCORM export are untouched (they still read page.name / page.id).
  var COPY_BLOCK_TYPES = { heading: 1, subheading: 1, paragraph: 1, note: 1, quote: 1, list: 1 };
  function stripToText(html) {
    return String(html == null ? "" : html)
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ").trim();
  }
  // First text-bearing block's plain text (recursing frames/columns/cardReveal items),
  // tags stripped + whitespace collapsed. Skips spacer/media/nav blocks. "" if none.
  function firstCopyOf(page) {
    var found = "";
    (function walk(blocks) {
      if (found || !Array.isArray(blocks)) return;
      for (var i = 0; i < blocks.length && !found; i++) {
        var b = blocks[i];
        if (!b || typeof b !== "object") continue;
        if (COPY_BLOCK_TYPES[b.type]) { var t = stripToText(b.text); if (t) { found = t; return; } }
        if (Array.isArray(b.children)) walk(b.children);
        if (Array.isArray(b.columns)) b.columns.forEach(walk);
        if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (Array.isArray(it.children)) walk(it.children); if (Array.isArray(it.front)) walk(it.front); });
      }
    })(page && page.blocks);
    return found;
  }
  // A copy-less page's fallback name: its page.name minus any leading auto-number prefix
  // ("01 · ", "1. ", "2 - ") and minus the "New Page" default, so a media-only/blank page
  // still reads sensibly without double-numbering. "" if nothing usable.
  function nameFallback(page) {
    var nm = page && typeof page.name === "string" ? page.name.trim() : "";
    if (!nm || nm === "New Page") return "";
    return nm.replace(/^\d+\s*[·.\-:]?\s*/, "").trim();
  }
  // The TITLE part: an explicit override wins, else the FIRST LINE OF COPY, else the page's
  // (de-numbered) name, else "Page"; capped ~40ch.
  function pageTitlePart(page) {
    var override = page && page.title != null ? String(page.title).trim() : "";
    var title = override || firstCopyOf(page) || nameFallback(page) || "Page";
    return title.length > 40 ? title.slice(0, 39).replace(/\s+$/, "") + "…" : title;
  }
  // The DERIVED "chapter.page" number (1-based) from the chapter grouping; "" if not placed.
  function pageNumberOf(page, doc) {
    var groups = window.groupPagesByChapter ? window.groupPagesByChapter(doc) : [];
    for (var ci = 0; ci < groups.length; ci++) {
      var ps = groups[ci].pages || [];
      for (var pi = 0; pi < ps.length; pi++) {
        if (ps[pi] === page || (ps[pi] && page && ps[pi].id === page.id)) return (ci + 1) + "." + (pi + 1);
      }
    }
    return "";
  }
  function pageDisplayName(page, doc) {
    var num = pageNumberOf(page, doc);
    return num ? num + " " + pageTitlePart(page) : pageTitlePart(page);
  }
  // Write an override from a rename. Empty, or a value equal to the auto-derived first copy,
  // CLEARS the override (page keeps auto-naming); anything else sets page.title.
  function setPageTitle(page, v) {
    v = (v == null ? "" : String(v)).trim();
    if (!v || v === firstCopyOf(page)) { if (page.title != null) delete page.title; }
    else page.title = v;
  }
  window.__pageDisplayName = pageDisplayName; // headless test hooks
  window.__firstCopyOf = firstCopyOf;
  window.__setPageTitle = setPageTitle;
  // uio-E-C07 (EDIT-12): split naming. The old behaviour appended " (cont.)" on every split, so a
  // twice-split page read "Base (cont.) (cont.)" and clipped its tail. Instead a split family reads
  // "Base · K of M". stripSplitSuffix reduces any name to its clean base (removing a trailing
  // " · N of M" or one-or-more " (cont.)"), and renumberSplitFamily renumbers the contiguous
  // same-chapter run that shares a base. Both are PURE (mutate only the passed doc) -> regression-guarded.
  function stripSplitSuffix(name) {
    var s = String(name == null ? "" : name).trim(), prev;
    // Peel any trailing " · N of M" or " (cont.)" — repeatedly, in any order — until stable.
    do { prev = s; s = s.replace(/\s*·\s*\d+\s+of\s+\d+\s*$/i, "").replace(/\s*\(cont\.?\)\s*$/i, "").trim(); } while (s !== prev);
    return s || "Page";
  }
  function renumberSplitFamily(doc, pageId) {
    var pages = (doc && doc.pages) || [];
    var idx = -1;
    for (var i = 0; i < pages.length; i++) { if (pages[i] && pages[i].id === pageId) { idx = i; break; } }
    if (idx < 0) return;
    var base = stripSplitSuffix(pages[idx].name), ch = pages[idx].chapterId;
    var lo = idx, hi = idx;
    while (lo - 1 >= 0 && pages[lo - 1] && pages[lo - 1].chapterId === ch && stripSplitSuffix(pages[lo - 1].name) === base) lo--;
    while (hi + 1 < pages.length && pages[hi + 1] && pages[hi + 1].chapterId === ch && stripSplitSuffix(pages[hi + 1].name) === base) hi++;
    var M = hi - lo + 1;
    if (M < 2) { pages[idx].name = base; return; } // a lone page just gets the clean base back
    for (var k = lo; k <= hi; k++) pages[k].name = base + " · " + (k - lo + 1) + " of " + M;
  }
  window.__stripSplitSuffix = stripSplitSuffix;
  window.__renumberSplitFamily = renumberSplitFamily;
  // <<< P2 auto page-naming helpers

  var registry = getRegistry();
  Object.keys(registry).forEach(function (id) { normalizeDoc(registry[id]); });
  var activeDocId = getActiveDocId();
  var openDocIds = getOpenDocIds();

  // KKKK: surface any legacy-menu migration flags once, so discarded Course Menu
  // content is reviewed rather than silently lost. One-shot per load.
  var _mig = registry[activeDocId] && registry[activeDocId].__migrationFlags;
  if (_mig && _mig.length) {
    delete registry[activeDocId].__migrationFlags;
    setTimeout(function () {
      window.alert("This course was upgraded to chapters and its Course Menu page was removed (navigation is now the footer bar).\n\n- " + _mig.join("\n- "));
    }, 400);
  }

  if (openDocIds.indexOf(activeDocId) === -1) {
    openDocIds.push(activeDocId);
    saveOpenDocIds(openDocIds);
  }
  if (!registry[activeDocId]) {
    normalizeDoc(window.SAMPLE_DOC); // seed sample gets the same migration as stored docs (chapters, menu removal)
    registry[window.SAMPLE_DOC.meta.code] = window.SAMPLE_DOC;
    saveRegistry(registry);
    activeDocId = window.SAMPLE_DOC.meta.code;
    saveActiveDocId(activeDocId);
  }

  var doc = registry[activeDocId];

  function getComponents() {
    if (!doc.components) {
      doc.components = clone(window.COMPONENTS);
    }
    return doc.components;
  }

  // arch-P3b-07lib: the shared component library moved to editor/library.js -- the store and its
  // accessors, the where-used counters that sat 1,800 lines away under a banner about interaction
  // identity, and the panel that sat 2,700 lines below that. One feature, three places. The doc
  // walker the counters borrow stayed here: it is substrate four unrelated callers share.
  var seedDemoLibrary = VE.bind("seedDemoLibrary");
  var loadLibrary = VE.bind("loadLibrary");
  var saveLibrary = VE.bind("saveLibrary");
  var libComponents = VE.bind("libComponents");
  var libraryWhereUsed = VE.bind("libraryWhereUsed");
  var libraryWhereUsedDetail = VE.bind("libraryWhereUsedDetail");
  var exportLibraryJson = VE.bind("exportLibraryJson");
  var importLibraryJson = VE.bind("importLibraryJson");
  var buildLibraryBody = VE.bind("buildLibraryBody");
  var buildComponentsBody = VE.bind("buildComponentsBody");
  var saveBlockAsComponent = VE.bind("saveBlockAsComponent");
  var ungroupContainer = VE.bind("ungroupContainer");
  var showDefineComponentDialog = VE.bind("showDefineComponentDialog");


  // Product Rail #1 — ProductsStore: { [productId]: {id, name, createdAt, groundTruthId} }.
  // Same load/save shape as the library above, through productsAdapter()'s adapter seam.
  // A fresh (empty) store seeds the same neutral demo Product SAMPLE_DOC tags itself to
  // (meta.productId), so "Products & Variants" (model.js) is a real Product Rail example
  // out of the box — never overwrites a real, already-persisted store.
  function loadProducts() {
    return Store.loadProducts(function () {
      return { "prod-demo": { id: "prod-demo", name: "Sample Product Line", createdAt: 0 } };
    });
  }
  window.ProductsStore = loadProducts();
  function saveProducts() { Store.saveProducts(window.ProductsStore); }

  // ---- Product Rail facts -> src/editor/product-rail.js (arch-P3-05) ---------------------------
  // Alignment, drift, where-used, outputs: the four facts that follow a document across Source,
  // Edit and Publish. The layer INVENTS nothing -- it turns the primitives below into one phrasing
  // and one tone every surface renders identically. Drawing them (f04Badge, f04AlignmentMeter, the
  // Product picker) stays here; a fact carries a label, a tone and a title, and that is chrome's
  // whole input. Every callback is deferred, so this binds before the helpers are declared.
  var PR = window.VersoProductRail;
  var ProductRail = PR.create({
    storage: localStorage,                                   // the Product scope is a per-client UI pref
    docById: function (id) { return registry[id]; },
    allDocIds: function () { return Object.keys(registry); },
    walkBlocks: function (d, visit) { return walkBlocks(d, visit); },
    countWords: function (html) { return frWords(html); },
    libraryComponents: function () { return (typeof libComponents === "function" && libComponents()) || {}; },
    productsStore: function () { return window.ProductsStore || {}; },
    // Is there approved source to align this document against at all? A document tagged to a
    // Product with no source document can never score, so it reads "Not indexed" rather than 0%.
    sourceIndexedFor: function (d) {
      var pid = d && d.meta && d.meta.productId;
      if (!pid) return true;                                 // untagged: fall back to "has prose" alone
      if (typeof sourceMasterFor !== "function") return true;
      return !!sourceMasterFor(pid) || (typeof unifiableTopicsFor === "function" && unifiableTopicsFor(pid).length > 0);
    },
    whereUsed: function (masterId) {
      return (typeof sourceLinkWhereUsed === "function") ? sourceLinkWhereUsed(masterId, null) : [];
    },
    // Has this document ever actually gone out? Straight from the release log, the same record the
    // picker's "Last published" line reads.
    published: function (docId) {
      var RH = window.ReleaseHistory;
      return !!(RH && RH.lastPublishedFor && RH.lastPublishedFor(releaseHistory(), docId));
    }
  });

  // ---- Publish orchestration -> src/editor/publish.js (arch-P3-03) -----------------------------
  // The four stores (queue / paths / presets / release history), the plan every row expands into,
  // and the run that drains the queue all live in the module. It is DOM-free: it resolves
  // destinations, it does not pick them; it builds and delivers through the callbacks below. What
  // stays here is the chrome -- the pane, the rows, the chips, the folder picker, the file writes.
  // Every callback below is deferred, so the module can be built here even though half of what it
  // reaches for (the outputs fact, the delivery, the repaint) is declared further down the file.
  var Publish = window.VersoPublish.create({
    store: Store,                                            // the same durable k/v the registry rides
    docById: function (id) { return registry[id]; },
    productById: function (id) { return window.ProductsStore && window.ProductsStore[id]; },
    activeProduct: function () { return getActiveProduct(); },
    activeDocId: function () { return activeDocId; },
    outputsFact: function (variants) { return f04OutputsFact(variants); },
    masterVersions: function (d) {
      var gtv = {}, cur = currentMasterVersions();
      docLinkedMasterIds(d).forEach(function (id) { gtv[id] = cur[id]; });
      return gtv;
    },
    // --- the run's four contact points with the browser ---
    deliver: function (row, variant, pkg) { return deliverPublishPackage(row, variant, pkg); },
    // The exporter reads the LIVE document, so each row's document has to be current before it
    // builds. requestAnimationFrame lets the canvas finish mounting first, as it always has.
    activateDoc: function (id) {
      if (activeDocId === id) return Promise.resolve();
      switchDoc(id);
      return new Promise(function (resolve) { requestAnimationFrame(resolve); });
    },
    onQueueChange: function () { renderPublishQueue(); },
    // A finished export IS this document's new "last published" baseline (staleness tracking).
    afterRowPublished: function (d) { snapshotGroundTruthBaseline(d); saveRegistry(registry); }
  });
  function publishQueue() { return Publish.queue(); }
  function savePublishQueue() { return Publish.saveQueue(); }
  function publishPaths() { return Publish.paths(); }
  function savePublishPaths() { return Publish.savePaths(); }
  function publishPresets() { return Publish.presets(); }
  function savePublishPresets() { return Publish.savePresets(); }
  function releaseHistory() { return Publish.history(); }
  function saveReleaseHistory() { return Publish.saveHistory(); }
  function publishPathCtx(row, variant) { return Publish.pathCtx(row, variant); }
  function publishResolveDest(row, variant) { return Publish.resolveDest(row, variant); }
  function publishRowOutputs(row) { return Publish.outputsForRow(row); }
  function publishOptionsForRow(row, variant) { return Publish.optionsForRow(row, variant); }
  function releaseEntryForRow(row, result, variant) { return Publish.releaseEntryForRow(row, result, variant); }
  function publishRootScope() { return Publish.rootScope(); }
  function publishRowDestSummary(dests) { return window.VersoPublish.destSummary(dests); }
  function publishRowFilename(nameFn, opts) { return window.VersoPublish.rowFilename(nameFn, opts); }
  function publishShowsFilename(row) { return window.VersoPublish.showsFilename(row); }
  function publishVariantRollup(fact) { return window.VersoPublish.variantRollup(fact); }

  // ---- Publish save paths (Product Rail Epic 6, T3) — where each package lands + its version ------
  // The PublishPaths model holds only labels + the version ledger. The File System Access directory
  // HANDLES can't be serialised, so each one lives in the existing keyed-handle IndexedDB store
  // under the key the model computes — one handle per Product root, one per per-output override.
  // Handles are browser objects, so this half stays here.
  var __publishDirHandles = {}; // handleKey -> handle|null, so a run doesn't re-read IndexedDB per output
  // The persisted handle for a resolved destination: memory first, then IndexedDB (saveBackupHandle /
  // loadBackupHandle, the same store the backup + review folders already use). A handle whose
  // permission has lapsed and can't be re-granted resolves to null, and the caller downloads instead —
  // a publish never fails because a folder went away.
  function publishDirHandle(handleKey) {
    if (!handleKey) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(__publishDirHandles, handleKey)) return Promise.resolve(__publishDirHandles[handleKey]);
    return Promise.resolve(loadBackupHandle(handleKey)).then(function (h) {
      if (!h) { __publishDirHandles[handleKey] = null; return null; }
      return Promise.resolve(dirPermission(h, false)).then(function (perm) {
        __publishDirHandles[handleKey] = perm === "granted" ? h : null;
        return __publishDirHandles[handleKey];
      });
    }).catch(function () { __publishDirHandles[handleKey] = null; return null; });
  }
  // Pick a folder and remember it. Returns the handle's folder name (the label the model stores) or
  // null if the browser can't pick or the author cancelled.
  function pickPublishDir(handleKey) {
    if (!window.showDirectoryPicker) return Promise.resolve(null);
    return Promise.resolve(window.showDirectoryPicker({ mode: "readwrite" })).then(function (h) {
      __publishDirHandles[handleKey] = h;
      return Promise.resolve(saveBackupHandle(handleKey, h)).then(function () { return h.name || "folder"; });
    }).catch(function () { return null; });
  }
  function forgetPublishDir(handleKey) { delete __publishDirHandles[handleKey]; saveBackupHandle(handleKey, null); }
  // Walk (creating as needed) the `Product/<doc-variant>/` nesting an inherited root writes into.
  function publishEnsureDir(root, segments) {
    return (segments || []).reduce(function (chain, seg) {
      return chain.then(function (dir) { return dir.getDirectoryHandle(seg, { create: true }); });
    }, Promise.resolve(root));
  }
  // The chip itself: the same publish-chip family as the preset + destination chips beside it, and
  // -- unlike P-C07's destination -- a real button, because it has somewhere to go: the canonical
  // anchored popover (openChromePop, the storage dot's own machinery) listing every output. Both
  // Publish rows (picker + queue) build it through here, so there is one chip, not two.
  function publishVariantChip(facts, cls) {
    var roll = publishVariantRollup(facts && facts.outputs);
    if (!roll) return null;
    var chip = h("button", "publish-chip" + (cls ? " " + cls : ""), roll.label);
    chip.type = "button";
    chip.title = roll.title + " Click to list them.";
    chip.addEventListener("click", function () {
      openChromePop(chip, function (pop) {
        pop.appendChild(h("div", "chrome-pop__title", "Outputs"));
        roll.rows.forEach(function (o) {
          var row = h("div", "chrome-pop__row");
          row.appendChild(h("span", "chrome-pop__val", o.name));
          if (o.flagship) row.appendChild(h("span", "chrome-pop__label", "Base"));
          pop.appendChild(row);
        });
        pop.appendChild(h("div", "chrome-pop__note", "Each output publishes as its own package. Variants are defined in the Edit stage."));
      }, { cls: "publish-varpop" });
    });
    return chip;
  }
  // uio-P-C05 (PUB-13): the Publish pane's one menu mixed INBOUND pipelines (Import CSV, Import
  // Schema) with outbound ones, under a label that was half irrelevant. Direction is now data: the
  // Source stage lists the imports (where import already lives), the Publish pane states only what
  // it emits. Both stages read the SAME registered list, so a module that registers a new action
  // lands on the right stage without either stage keeping its own copy.
  //
  // Direction is DECLARED at registration (registerPipelineButton's `opts.direction`). The label
  // regex below is only the fallback for an action that never declared one: registerPipelineButton
  // is public API, and a third-party caller naming something "Ingest CSV" must not silently land on
  // the Publish pane. Declaring it is how you get it right; the guess is how old callers keep working.
  /* @publish-format-start */
  var PIPELINE_DIRECTIONS = ["import", "export"];
  function pipelineDirection(label) { return /^\s*import\b/i.test(String(label == null ? "" : label)) ? "import" : "export"; }
  function pipelineDirectionOf(btn) {
    var declared = btn && btn.direction;
    if (PIPELINE_DIRECTIONS.indexOf(declared) !== -1) return declared; // an explicit declaration always wins
    return pipelineDirection(btn && btn.label);
  }
  function pipelineByDirection(btns, dir) {
    return (btns || []).filter(function (b) { return b && pipelineDirectionOf(b) === dir; });
  }
  // Under an "Import" menu head the repeated prefix is noise ("Import CSV" -> "CSV…"). Every import
  // opens a file picker, so the entry always ends in an ellipsis.
  function importMenuLabel(label) {
    var raw = String(label == null ? "" : label).trim();
    var s = raw.replace(/^import\s+/i, "").trim() || raw;
    return /(…|\.\.\.)$/.test(s) ? s : s + "…";
  }
  // The output formats, stated ONCE: the emitted one is marked selected, the rest carry a plain
  // "Soon" state instead of smuggling "(soon)" into their names.
  function publishFormatRows(formats, selected) {
    return (formats || []).map(function (f) {
      return { value: f.value, label: f.label, available: !!f.enabled, selected: f.value === selected, hint: f.enabled ? "" : "Soon" };
    });
  }
  // What the queue will actually emit. Format is a PRESET option, so it is READ from the rows'
  // resolved options — the Publish pane never becomes a second place that sets it. Presets that
  // disagree read "Mixed" rather than picking a winner; an empty queue states the default.
  function publishFormatSummary(formats, values, fallback) {
    var uniq = [];
    (values || []).forEach(function (v) { if (v && uniq.indexOf(v) === -1) uniq.push(v); });
    if (uniq.length > 1) return { value: null, label: "Mixed", mixed: true };
    var value = uniq[0] || fallback || "";
    var match = (formats || []).filter(function (f) { return f.value === value; })[0];
    return { value: value, label: (match && match.label) || value, mixed: false };
  }
  /* @publish-format-end */
  // The documents the picker offers: every registry doc, scoped to the active Product when one is
  // set (untagged docs drop out of a Product-scoped view), sorted by title. docId = the registry key.
  function publishPickDocs() {
    var pid = getActiveProduct(), out = [];
    Object.keys(registry).forEach(function (id) {
      var d = registry[id]; if (!d) return;
      if (pid && !docMatchesProductStage(d, pid, null)) return;
      out.push({ id: id, title: (d.meta && d.meta.title) || id });
    });
    out.sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; });
    return out;
  }
  // uio-P-C04 (PUB-12): the picker was alphabetical-only with no scope, count, search or sort, so the
  // two orderings that actually decide publishing work -- most drifted first, least recently published
  // first -- were unreachable. The whole view (search -> filter -> sort) is a pure function of the
  // decorated rows, so it is fixture-testable and the header's count can never disagree with the list.
  /* @publish-pick-start */
  var PUBLISH_SORTS = [
    { key: "title", label: "Title" },
    { key: "drift", label: "Drift" },
    { key: "last", label: "Last published" }
  ];
  // A row "needs attention" when approved source moved under it, or it has never gone out at all.
  // Both mean the same thing to the person publishing: this one is not current.
  function publishNeedsAttention(row) {
    return !!(row && ((row.drift || 0) > 0 || !row.lastAt));
  }
  function publishPickView(rows, opts) {
    opts = opts || {};
    var q = String(opts.query == null ? "" : opts.query).trim().toLowerCase();
    var out = (rows || []).filter(function (r) {
      if (!r) return false;
      if (q && String(r.title || "").toLowerCase().indexOf(q) === -1) return false;
      if (opts.filter === "attention" && !publishNeedsAttention(r)) return false;
      return true;
    });
    var byTitle = function (a, b) {
      var x = String(a.title || "").toLowerCase(), y = String(b.title || "").toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    };
    if (opts.sort === "drift") {
      // most drifted first; ties fall back to title so the order is stable, never arbitrary
      out.sort(function (a, b) { return (b.drift || 0) - (a.drift || 0) || byTitle(a, b); });
    } else if (opts.sort === "last") {
      // least recently published first, and NEVER-published ahead of everything -- those are the
      // most overdue, not the most recent (a 0 timestamp would sort them last by accident).
      out.sort(function (a, b) {
        var ax = a.lastAt || 0, bx = b.lastAt || 0;
        if (!ax !== !bx) return ax ? 1 : -1;
        return ax - bx || byTitle(a, b);
      });
    } else {
      out.sort(byTitle);
    }
    return out;
  }
  /* @publish-pick-end */
  // uio-P-C06 (PUB-04): bulk publishing had no bulk controls -- a dozen documents meant a dozen
  // identical "+" clicks. Selection is VIEW state (session-only, never saved on the document), and
  // searching, filtering or re-ordering the list NEVER changes it. Filtering is a lens, not an edit:
  // one keystroke in the search field must not throw away five deliberate ticks that cannot be undone.
  // The hazard -- queueing documents that are off screen -- is answered by stating it plainly in the
  // footer instead ("5 selected · 2 hidden by search"), so nothing is silently lost and nothing is
  // silently included.
  /* @publish-sel-start */
  // The selected ids among `rows`, in the order those rows are given. Pass the visible list to count
  // what is on screen; pass the full candidate list to get everything the batch will queue. Ids for
  // documents that no longer exist simply never match, so a stale tick can never queue anything.
  function publishSelectedIds(sel, rows) {
    var out = [];
    (rows || []).forEach(function (r) { if (r && r.id && sel && sel[r.id]) out.push(r.id); });
    return out;
  }
  // Which of the two lenses is doing the hiding, named the way the author would name it.
  function publishHiddenBy(query, filter) {
    var q = !!String(query == null ? "" : query).trim(), f = !!filter && filter !== "all";
    if (q && f) return "search and filter";
    if (q) return "search";
    if (f) return "the filter";
    return "the current view";
  }
  // Everything the selection footer needs, from the visible rows plus the full candidate list.
  // The one deliberate asymmetry: "select all" and its mixed state count the VISIBLE rows only,
  // because ticking a box that says "Select all 3" over a list of 3 can only sanely mean those 3 --
  // while the queue button counts the WHOLE selection, hidden rows included, because that is what
  // the author actually ticked. The hidden line exists so those two numbers are never a surprise.
  function publishSelectionSummary(sel, visible, all, opts) {
    opts = opts || {};
    var vis = publishSelectedIds(sel, visible), tot = publishSelectedIds(sel, all);
    var visTotal = (visible || []).filter(function (r) { return r && r.id; }).length;
    var hidden = Math.max(0, tot.length - vis.length);
    return {
      ids: tot,
      selected: tot.length,
      visible: vis.length,
      hidden: hidden,
      visibleTotal: visTotal,
      all: visTotal > 0 && vis.length === visTotal,
      mixed: vis.length > 0 && vis.length < visTotal,
      allLabel: vis.length ? (vis.length + " of " + visTotal + " selected") : ("Select all " + visTotal),
      queueLabel: "Queue selected" + (tot.length ? " (" + tot.length + ")" : ""),
      hiddenLabel: hidden ? (tot.length + " selected · " + hidden + " hidden by " + publishHiddenBy(opts.query, opts.filter)) : "",
      reason: tot.length ? "" : "Tick documents above to queue them together."
    };
  }
  /* @publish-sel-end */
  // ---- Product Rail: Ground-Truth staleness (export-is-publish tracking) ----
  // A document links Ground Truth through block.sourceLink.masterId; each linked master carries a
  // version stamp (master.updatedAt via stampMasterVersion, bumped on every content edit). At export
  // we snapshot every linked master's stamp into doc.meta.lastPublishedGroundTruthVersions; the
  // staleness count is how many linked masters have changed since that baseline. UI-only, never a
  // gate. All four helpers are pure (fixture-testable in tests/run.js).
  function docLinkedMasterIds(doc) { return ProductRail.linkedMasterIds(doc); }
  function driftedMasterIds(doc, versions) { return ProductRail.driftedMasterIds(doc, versions); }
  function groundTruthStaleCount(doc, versions) { return ProductRail.staleCount(doc, versions); }
  function currentMasterVersions() { return ProductRail.currentMasterVersions(); }
  function snapshotGroundTruthBaseline(doc) { return ProductRail.snapshotBaseline(doc); }

  // ---- Product Rail: source-alignment metric (linked-to-approved-source vs novel) ----
  // What share of a document's prose is linked to approved source vs authored novel here. A whole
  // source-linked block (block.sourceLink) counts all its words as linked; an inline `<span
  // data-source-link>` counts the words inside it. Reuses frWords (the shared HTML-stripping word
  // counter). Pure -> fixture-testable. Surfaced live in the Edit header + on the Publish rows.
  function sourceAlignment(doc) { return ProductRail.sourceAlignment(doc); }
  function sourceAlignmentPct(doc) { return ProductRail.sourceAlignmentPct(doc); }

  // ---- uio-F04: cross-stage data surfacing (the READ layer over the Product Rail) ----------------
  // Four facts follow a document (and a source topic) across Source, Edit and Publish: how much of it
  // comes from approved source, what has drifted since it last went out, where a passage is used, and
  // how many packages it actually produces. Every stage used to phrase these itself, so the same fact
  // read differently in three places -- or, worse, was computed twice.
  //
  // THE RULE: this layer INVENTS NOTHING. Its inputs are the Product Rail helpers that already exist
  // -- sourceAlignment (@src-align), driftedMasterIds + currentMasterVersions (@gt-staleness),
  // sourceLinkWhereUsed, ReleaseHistory.lastPublishedFor, and doc.variants. It turns those into one
  // phrasing + one tone that every surface renders identically. A second staleness or alignment
  // computation anywhere else is a hard fail.
  //
  // The fenced part is pure (plain values in, plain fact objects out) so tests/run.js can fixture it
  // directly; the adapters below the fence do the binding to the live stores.
  var F04_BANDS = PR.BANDS;
  function f04Band(pct) { return PR.band(pct); }
  function f04AlignmentFact(alignment, indexed) { return PR.alignmentFact(alignment, indexed); }
  function f04RollUpAlignment(alignments) { return PR.rollUpAlignment(alignments); }
  function f04DriftFact(driftedIds, published) { return PR.driftFact(driftedIds, published); }
  function f04WhereUsedFact(places) { return PR.whereUsedFact(places); }
  function f04OutputsFact(variants) { return PR.outputsFact(variants); }
  function f04AlignmentMeterModel(fact) { return PR.alignmentMeterModel(fact); }

  // ---- uio-F04 adapters -> src/editor/product-rail.js (arch-P3-05) --------------------------------
  // Nothing here computes a fact; the binding to the live stores is the env handed to
  // VersoProductRail.create above, and these are the names the surfaces already call.
  // The three document-scoped facts, for any surface, from one call.
  function f04DocFacts(docId, versions) { return ProductRail.docFacts(docId, versions); }
  function f04ProductDocIds(pid) { return ProductRail.productDocIds(pid); }
  function f04ProductFacts(pid, masterId) { return ProductRail.productFacts(pid, masterId); }
  // The ONE way an F04 fact is drawn: the canonical DS Badge, quiet (these repeat down lists), small,
  // carrying the fact's own tone + tooltip. Returns null for a fact with nothing to say, so a surface
  // never has to decide when to hide one.
  function f04Badge(fact, cls) {
    if (!fact || !fact.label) return null;
    var U = window.VersoUI;
    var el = U && U.Badge
      ? U.Badge({ tone: fact.tone || "neutral", quiet: true, size: "sm", children: [fact.label] })
      : h("span", "vds-badge vds-badge--neutral vds-badge--sm vds-badge--quiet", fact.label);
    if (cls) el.classList.add(cls);
    if (fact.title) el.title = fact.title;
    return el;
  }
  // uio-P-C01 (PUB-01): the ONE way alignment is drawn on Publish -- the canonical DS Meter,
  // labelled and banded, fed by the same fact object every other surface reads. The picker row and
  // the queue row both call this, so the number and its band can never read differently a pane
  // apart -- and both stay equal to the Source top bar, which reads the same resolver.
  function f04AlignmentMeter(fact, cls) {
    if (!fact) return null;
    var m = f04AlignmentMeterModel(fact);
    var U = window.VersoUI;
    var el = U && U.Meter
      ? U.Meter({ label: "Alignment", pct: m.pct, tone: m.tone, value: m.value, bandLabel: m.bandLabel })
      : h("span", "vds-meter", "Alignment " + m.value);
    if (cls) el.classList.add(cls);
    if (m.title) el.title = m.title;
    return el;
  }
  // Read API for the tickets that CONSUME this layer (uio-P-C01's alignment meter, uio-P-C08's variant
  // roll-up chip, uio-S-M05, uio-E-M03) and for the browser-verify harness. Read-only: it renders
  // nothing and mutates nothing.
  window.__f04 = {
    docFacts: f04DocFacts,
    productFacts: f04ProductFacts,
    productDocIds: f04ProductDocIds,
    whereUsed: function (masterId) { return f04WhereUsedFact(sourceLinkWhereUsed(masterId, null)); },
    bands: F04_BANDS,
    band: f04Band,
    _pure: { alignmentFact: f04AlignmentFact, rollUp: f04RollUpAlignment, driftFact: f04DriftFact,
      whereUsedFact: f04WhereUsedFact, outputsFact: f04OutputsFact, alignmentMeterModel: f04AlignmentMeterModel }
  };

  // uio-P-C03 (PUB-10): the picker row's provenance line. States the fact plainly when a document
  // has gone out, and states the absence just as plainly when it hasn't -- "never published" is
  // information, not an error, so it reads as a fact rather than a warning.
  function publishLastLabel(docId) {
    var RH = window.ReleaseHistory; if (!RH || !RH.lastPublishedFor) return "";
    var last = RH.lastPublishedFor(releaseHistory(), docId);
    if (!last) return "Never published";
    var when = last.at ? new Date(last.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    return "Last published " + [when, last.version].filter(Boolean).join(" · ");
  }
  // uio-P-C04: the picker's view state. Session-only on purpose — a search you left behind three
  // days ago silently hiding documents is worse than retyping it.
  // uio-P-C06: the tick marks live here too — same session-only lifetime, for the same reason.
  var __publishPickQuery = "", __publishPickFilter = "all", __publishPickSort = "title", __publishPickSel = {};
  function publishSortLabel() {
    for (var i = 0; i < PUBLISH_SORTS.length; i++) if (PUBLISH_SORTS[i].key === __publishPickSort) return PUBLISH_SORTS[i].label;
    return PUBLISH_SORTS[0].label;
  }
  function mountPublishStage() {
    if (typeof document === "undefined") return;
    renderPublishPick();
    renderPublishQueue();
  }
  // browser-verify hook (mirrors window.__sourceRw): lets the Puppeteer harness seed release records
  // and re-render the stage without driving a real export. Read/render only -- no publish path here.
  window.__publishRw = {
    releaseHistory: releaseHistory,
    saveReleaseHistory: saveReleaseHistory,
    lastLabel: publishLastLabel,
    render: mountPublishStage
  };
  // uio-P-C04 (PUB-12): decorate every candidate with the two facts the orderings need -- how far it
  // has drifted from approved source, and when it last actually went out -- then let the pure view do
  // search/filter/sort. The header counts what the list shows, from the same array.
  // uio-P-C06: the render AND "Queue selected" both read the list from here, so the batch can only
  // ever contain rows the picker is showing.
  // uio-F04: the row's facts come from f04DocFacts -- the same call the Source top bar and the Edit
  // provenance line make -- so a number here can never disagree with the same number a stage away.
  function publishPickRows() {
    var vers = currentMasterVersions(), RH = window.ReleaseHistory;
    return publishPickDocs().map(function (d) {
      var last = RH && RH.lastPublishedFor ? RH.lastPublishedFor(releaseHistory(), d.id) : null;
      var facts = f04DocFacts(d.id, vers);
      return { id: d.id, title: d.title, drift: facts ? facts.drift.count : 0, lastAt: last ? last.at : 0, facts: facts };
    });
  }
  // Left pane: a product-scoped list of documents, each with an "Add to queue" action. Plus a
  // shortcut to queue the currently-open document (the fast single-export path -- a queue-of-one).
  function renderPublishPick() {
    var host = document.getElementById("publish-pick"); if (!host) return;
    var U = window.VersoUI;
    host.innerHTML = "";
    var all = publishPickRows();
    var docs = publishPickView(all, { query: __publishPickQuery, filter: __publishPickFilter, sort: __publishPickSort });
    var attention = all.filter(publishNeedsAttention).length;
    // uio-P-C06 (PUB-04): this render READS the selection and never writes it. Search, filter and
    // sort are a lens over the list, so a tick survives all three for the whole session; the footer
    // states how much of the selection the current lens is hiding.
    var sel = publishSelectionSummary(__publishPickSel, docs, all, { query: __publishPickQuery, filter: __publishPickFilter });

    // Header strip: what this list IS (scope + count), and how it is ordered.
    var head = h("div", "publish-pick__head");
    head.appendChild(h("span", "publish-pick__title", "Documents"));
    var prod = getActiveProduct(), pname = prod && window.ProductsStore && window.ProductsStore[prod] ? window.ProductsStore[prod].name : "";
    head.appendChild(h("span", "publish-pick__scope", [pname, String(docs.length)].filter(Boolean).join(" · ")));
    // Reuses `publish-chip` — this pane's established "compact value that opens a menu" control
    // (the queue row's preset chip). Same job, same look; a second chrome for it would be exactly
    // the piecemeal divergence this overhaul exists to undo.
    var sortBtn = h("button", "publish-chip publish-pick__sort"); sortBtn.type = "button";
    sortBtn.title = "Order this list";
    sortBtn.innerHTML = (window.Icon ? window.Icon("list") : "") + "<span>" + publishSortLabel() + "</span>";
    // A menu, not a cycling button: three orderings that a cycle would hide. Canonical context menu,
    // current one ticked.
    sortBtn.addEventListener("click", function (ev) {
      var r = (ev.currentTarget || ev.target).getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 4, [{ head: "Order by" }].concat(PUBLISH_SORTS.map(function (s) {
        return { label: s.label, active: __publishPickSort === s.key, onClick: function () { __publishPickSort = s.key; renderPublishPick(); } };
      })));
    });
    head.appendChild(sortBtn);
    host.appendChild(head);

    // Search — the same field the Source rail uses for the same job, one stage over.
    var search = h("div", "vbrowser__search publish-pick__search");
    search.innerHTML = window.Icon ? window.Icon("search") : "";
    var input = h("input", "vbrowser__search-input"); input.type = "text"; input.placeholder = "Search documents";
    input.value = __publishPickQuery;
    input.addEventListener("input", function () {
      __publishPickQuery = input.value;
      renderPublishPick();
      var again = document.querySelector(".publish-pick__search .vbrowser__search-input");
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    search.appendChild(input);
    host.appendChild(search);

    // "Needs attention" is only offered when something actually needs it — a permanently-empty
    // filter is noise.
    if (attention && U && U.SegmentedControl) {
      host.appendChild(U.SegmentedControl({
        size: "sm",
        options: [{ value: "all", label: "All " + all.length }, { value: "attention", label: "Needs attention " + attention }],
        value: __publishPickFilter,
        onChange: function (v) { __publishPickFilter = v; renderPublishPick(); }
      }));
    } else if (__publishPickFilter !== "all") { __publishPickFilter = "all"; }

    if (registry[activeDocId]) {
      var addCur = U ? U.Button({ variant: "secondary", full: true, icon: "plus", label: "Add current document", onClick: function () { addDocToPublishQueue(activeDocId); } }) : h("button", null, "Add current document");
      addCur.classList.add("publish-pane__addcur");
      host.appendChild(addCur);
    }
    var list = h("div", "publish-picklist");
    if (!docs.length) {
      list.appendChild(h("div", "publish-empty", all.length
        ? "No document matches that."
        : ("No documents" + (getActiveProduct() ? " in this Product" : "") + " yet.")));
    }
    docs.forEach(function (d) {
      var row = h("div", "publish-pickrow");
      // uio-P-C06 (PUB-04): the row leads with the canonical DS Checkbox (14px, Checkbox.d.ts) so a
      // dozen documents are picked as one set. The per-row "+" below is untouched: ticking is the
      // additional path for a batch, not a replacement for queueing one document.
      if (U && U.Checkbox) {
        var box = U.Checkbox({
          checked: !!__publishPickSel[d.id],
          onChange: function (v) {
            if (v) __publishPickSel[d.id] = true; else delete __publishPickSel[d.id];
            renderPublishPick();
          }
        });
        box.classList.add("publish-pickrow__sel");
        box.title = "Select “" + d.title + "” for queueing";
        row.appendChild(box);
      }
      row.appendChild(h("span", "publish-pickrow__title", d.title));
      var add = U ? U.IconButton({ icon: "plus", label: "Add “" + d.title + "” to the publish queue", onClick: function () { addDocToPublishQueue(d.id); } }) : h("button", null, "+");
      row.appendChild(add);
      // uio-P-C03 (PUB-10): "when did this last actually go out, and as what" — the line that
      // decides whether a re-publish is needed at all. Read from the release record, so it can
      // never disagree with the history below.
      var wrap = h("div", "publish-pickitem");
      wrap.appendChild(row);
      // uio-F04 (PUB-01/02/15): drift, alignment and real output count, all from f04DocFacts and all
      // drawn as the canonical DS Badge. They sit on the row's meta line, BELOW the title, for the
      // same reason the queue row does it: three badges beside a title eat the title, and a document
      // you cannot read the name of is worse than one whose numbers take a second line. A fact with
      // nothing to say returns no badge, so an in-sync or never-published document stays quiet
      // instead of carrying a chip that only means "nothing here". Never blocks or warns -- the
      // author can still queue any of these freely.
      var meta = h("div", "publish-pickitem__meta");
      var facts = d.facts || f04DocFacts(d.id);
      if (facts) {
        // uio-P-C01 (PUB-01): alignment is the one fact drawn as the labelled Meter.
        // uio-P-C08 (PUB-15): outputs graduate to the variant roll-up chip.
        // Drift stays a quiet badge.
        [f04Badge(facts.drift, "publish-pickrow__drift"),
         f04AlignmentMeter(facts.alignment, "publish-pickrow__align"),
         publishVariantChip(facts, "publish-pickrow__outputs")
        ].forEach(function (b) { if (b) meta.appendChild(b); });
      }
      meta.appendChild(h("span", "publish-pickitem__last", publishLastLabel(d.id)));
      wrap.appendChild(meta);
      list.appendChild(wrap);
    });
    host.appendChild(list);

    // uio-P-C06 (PUB-04): the selection footer, pinned under the scrolling list. It stays as long as
    // there is anything to select OR anything selected -- a live selection with every row filtered
    // away must never lose its footer, or the author is left holding ticks they can neither see nor
    // clear. The Publish button's rule applies here too: with nothing ticked the action is disabled
    // and states its reason on hover instead of failing silently.
    if (docs.length || sel.selected) {
      var foot = h("div", "publish-pick__foot");
      if (docs.length && U && U.Checkbox) {
        // Ticks what is SHOWN. Untickng it clears the shown rows and leaves hidden ones alone; the
        // hidden line below carries its own Clear for the whole selection.
        var allBox = U.Checkbox({
          checked: sel.all, mixed: sel.mixed, label: sel.allLabel,
          onChange: function (v) {
            docs.forEach(function (r) { if (v) __publishPickSel[r.id] = true; else delete __publishPickSel[r.id]; });
            renderPublishPick();
          }
        });
        allBox.classList.add("publish-pick__all");
        allBox.title = "Select every document shown";
        foot.appendChild(allBox);
      }
      // The whole truth when the current lens is hiding part of the selection: how many are ticked,
      // how many of those are off screen, and one action to drop the lot.
      if (sel.hidden) {
        var hint = h("div", "publish-pick__hidden");
        hint.appendChild(h("span", "publish-pick__hidden-text", sel.hiddenLabel));
        var clearFn = function () { __publishPickSel = {}; renderPublishPick(); };
        var clear = U ? U.Button({ variant: "ghost", size: "sm", label: "Clear", onClick: clearFn }) : h("button", null, "Clear");
        clear.classList.add("publish-pick__clear");
        clear.title = "Clear all " + sel.selected + " ticked documents, hidden ones included";
        if (!U) clear.addEventListener("click", clearFn);
        hint.appendChild(clear);
        foot.appendChild(hint);
      }
      var qs = U ? U.Button({ variant: "secondary", full: true, icon: "plus", label: sel.queueLabel, onClick: queueSelectedDocs })
        : h("button", null, sel.queueLabel);
      qs.classList.add("publish-pick__queuesel");
      if (!sel.selected) { qs.setAttribute("disabled", "disabled"); qs.title = sel.reason; }
      foot.appendChild(qs);
      host.appendChild(foot);
    }
  }
  // A tiny transient confirmation toast (reuses the shared .collab-toast style), for actions taken
  // away from the Publish stage -- e.g. "Send to publish queue" from the Edit-stage top bar.
  function publishToast(msg) {
    var t = h("div", "collab-toast", msg); document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("is-on"); });
    setTimeout(function () { t.classList.remove("is-on"); setTimeout(function () { if (t.parentNode) t.remove(); }, 220); }, 2600);
  }
  // The ONE shared "queue this document" action (T4). Adds the doc with its remembered preset (T2),
  // no configure step, no duplicate row (re-arms an existing one). Used by every entry point: the
  // Publish-stage picker rows AND the Edit-stage top-bar "Send to publish queue". Toasts the count.
  // uio-P-C06 (PUB-04): `quiet` suppresses only the confirmation, never the save. A batch adds every
  // document through this exact path and then confirms once, so one toast per document never stacks.
  function addToQueue(docId, opts) {
    var added = Publish.addDoc(docId); // zero-config preset recall lives with the queue
    if (!added) return;
    renderPublishQueue();
    syncSendToPublishCount();
    if (!(opts && opts.quiet)) publishToast("Added to the publish queue — " + added.pending + " pending.");
  }
  // uio-P-C06 (PUB-04): queue the whole selection in one action -- every ticked document, including
  // any the current search or filter is hiding, because that is what the author ticked and the
  // footer said so before they pressed it. Identical to pressing "+" on each row (same preset
  // recall, same de-duplication); the ticks clear afterwards, since the batch has been handed over
  // and a stale selection would invite queueing it twice.
  function queueSelectedDocs() {
    var PQ = window.PublishQueue; if (!PQ) return;
    var ids = publishSelectedIds(__publishPickSel, publishPickRows());
    if (!ids.length) return;
    ids.forEach(function (id) { addToQueue(id, { quiet: true }); });
    __publishPickSel = {};
    renderPublishPick();
    var n = PQ.pendingRows(publishQueue()).length;
    publishToast("Added " + ids.length + " document" + (ids.length === 1 ? "" : "s") + " to the publish queue — " + n + " pending.");
  }
  // uio-E-C08 (EDIT-15): reflect the pending queue count on the Edit header's "Send to publish"
  // button, so the destination + its backlog are legible without opening the Publish stage.
  function syncSendToPublishCount() {
    var el = document.getElementById("send-to-publish-count"); if (!el) return;
    var PQ = window.PublishQueue;
    var n = PQ ? PQ.pendingRows(publishQueue()).length : 0;
    el.textContent = n ? String(n) : "";
    el.hidden = !n;
  }
  function addDocToPublishQueue(docId) { addToQueue(docId); } // back-compat name used by the picker rows
  // Right pane: the persistent queue, one row per document (title + status + remove), and one
  // Publish button that runs every pending row sequentially through buildPackage.
  function renderPublishQueue() {
    var host = document.getElementById("publish-queue"); if (!host) return;
    var U = window.VersoUI, PQ = window.PublishQueue; if (!PQ) return;
    var q = publishQueue();
    host.innerHTML = "";
    var head = h("div", "publish-pane__head");
    head.appendChild(h("div", "publish-pane__title", "Publish queue"));
    // uio-P-C02 (PUB-03): the accent belongs to a button that has something to do. The Publish
    // button is the accent primary ONLY when there are rows to run; otherwise it's a quiet disabled
    // secondary that states the reason on hover, so a dead button never hogs the pane's one accent.
    var pending = PQ.pendingRows(q).length;
    var canRun = !!pending && !Publish.isRunning();
    var pubLabel = Publish.isRunning() ? "Publishing…" : ("Publish" + (pending ? " (" + pending + ")" : ""));
    var pub = U ? U.Button({ variant: canRun ? "primary" : "secondary", icon: "upload", label: pubLabel, onClick: runPublishQueue }) : h("button", null, pubLabel);
    if (!canRun) {
      pub.setAttribute("disabled", "disabled");
      pub.title = Publish.isRunning() ? "Publishing…" : "Nothing queued to publish — add documents from the left.";
    }
    // side-rail-cleanup slice 2: the relocated Import/Export menu sits with the Publish button (the
    // stage's export/publish surface). #publish-io is filled by renderToolbarPipeline below.
    var actions = h("div", "publish-pane__head-actions");
    var io = h("div", "publish-io"); io.id = "publish-io";
    // T3: the Product publish folder — one pick for the whole family, stated where the queue's own
    // actions live so it reads as a property of this queue rather than of any one row.
    var rootChip = publishRootChip();
    if (rootChip) actions.appendChild(rootChip);
    actions.appendChild(io); actions.appendChild(pub);
    head.appendChild(actions);
    host.appendChild(head);
    syncSendToPublishCount(); // uio-E-C08: keep the Edit header's count in step with every queue change
    renderToolbarPipeline(); // fill #publish-io with the Format control + its export overflow
    // uio-P-C03 (PUB-10): the queue scrolls in its own region so Release history can take the space
    // the queue isn't using — the pane no longer scrolls as one long strip with history off-screen.
    var scroller = h("div", "publish-queue__body");
    host.appendChild(scroller);
    var rows = (q.rows || []);
    if (!rows.length) { scroller.appendChild(h("div", "publish-empty", "Add documents from the left to queue them for publishing.")); renderPublishHistory(host); return; }
    var list = h("div", "publish-queuelist");
    rows.forEach(function (r) {
      var row = h("div", "publish-queuerow is-" + r.status);
      var main = h("div", "publish-queuerow__main");
      main.appendChild(h("span", "publish-queuerow__title", r.title));
      var meta = h("div", "publish-queuerow__meta");
      // preset chip -> a menu to switch preset / save-as / rename / delete (T2). Frozen at add-time;
      // clicking re-picks. Disabled while the row is running.
      var PP = window.PublishPresets;
      var chip = h("button", "publish-chip", PP ? PP.presetName(publishPresets(), r.preset || "master") : (r.preset || "master"));
      chip.type = "button"; chip.title = "Output preset";
      if (r.status !== "running") chip.addEventListener("click", function (ev) {
        var rr = (ev.currentTarget || ev.target).getBoundingClientRect();
        openPublishPresetMenu(r.id, rr.left, rr.bottom + 4);
      });
      meta.appendChild(chip);
      // uio-P-C07 (PUB-05) / T3: destination + resolved filename, in the same chip family as the
      // preset beside them. Now that a folder is a real choice, the chip is a real button: it opens
      // the destination popover, which owns one path row per output plus the re-cut opt-in.
      var outs = publishRowOutputs(r);
      var dests = outs.map(function (v) { return publishResolveDest(r, v); });
      var summary = publishRowDestSummary(dests);
      if (summary) {
        var dchip = h("button", "publish-chip publish-chip--dest", summary.label);
        dchip.type = "button";
        dchip.title = "Destination · " + summary.why + " Click to set a folder.";
        if (r.status !== "running") dchip.addEventListener("click", function () { openPublishDestPopover(dchip, r.id); });
        meta.appendChild(dchip);
      }
      if (publishShowsFilename(r)) {
        // The flagship's name leads; a row with variants says how many more follow rather than
        // listing filenames it has no room for — the popover holds the full list.
        var fname = publishRowFilename(window.SCORMExport && window.SCORMExport.packageName, publishOptionsForRow(r, outs[0]));
        if (fname) {
          var more = outs.length > 1 ? "  +" + (outs.length - 1) + " more" : "";
          var fEl = h("span", "publish-queuerow__file", fname + more);
          fEl.title = outs.length > 1 ? "Writes " + outs.length + " packages, starting with " + fname : "Writes " + fname;
          meta.appendChild(fEl);
        }
      }
      meta.appendChild(h("span", "publish-queuerow__status", publishStatusLabel(r)));
      // uio-F04 (PUB-01/02/15): the same three facts the picker row states, on the row that is actually
      // about to run -- so what you confirmed before queueing is still in front of you at the moment of
      // publishing. Identical call, identical phrasing, identical badge.
      var qf = f04DocFacts(r.docId);
      if (qf) {
        // uio-P-C01 (PUB-01): the same labelled Meter as the picker row.
        // uio-P-C08 (PUB-15): outputs graduate to the variant roll-up chip.
        [f04Badge(qf.drift, "publish-queuerow__drift"),
         f04AlignmentMeter(qf.alignment, "publish-queuerow__align"),
         publishVariantChip(qf, "publish-queuerow__outputs")
        ].forEach(function (b) { if (b) meta.appendChild(b); });
      }
      main.appendChild(meta);
      row.appendChild(main);
      if (r.status !== "running") {
        var rm = U ? U.IconButton({ icon: "x", label: "Remove from the queue", onClick: function () { PQ.removeRow(q, r.id); savePublishQueue(); renderPublishQueue(); } }) : h("button", null, "x");
        row.appendChild(rm);
      }
      list.appendChild(row);
    });
    scroller.appendChild(list);
    renderPublishHistory(host);
  }
  // Release history (Epic 6): the append-only whole-family export log, newest first, each release
  // expandable to its per-document entries (format / variant / version). Provenance only -- it never
  // re-exports or mutates a package.
  // uio-P-C03 (PUB-10): it answers "what did we ship?", so it OWNS the empty half of the pane
  // instead of hiding collapsed beneath the queue. Open by default (the mirror image of the Source
  // stage's History, which is demoted for the opposite reason), one row per release stating count /
  // preset / destination / outcome, and it states its own empty state rather than vanishing.
  function renderPublishHistory(host) {
    var RH = window.ReleaseHistory, U = window.VersoUI; if (!RH) return;
    var releases = RH.list(releaseHistory());
    var body = panelSection(host, "Release history", { collapsible: true, defaultOpen: true, divider: true });
    body.parentNode && body.parentNode.classList && body.parentNode.classList.add("publish-history");
    body.appendChild(h("div", "publish-history__note", "Append-only. Every completed run is recorded here; nothing here re-exports."));
    if (!releases.length) {
      body.appendChild(h("div", "publish-empty", "Nothing published yet — queue a document above and press Publish to start the record."));
      return;
    }
    releases.forEach(function (rel) {
      var s = RH.releaseSummary(rel);
      var det = h("details", "publish-release");
      var sum = h("summary", "publish-release__sum");
      sum.appendChild(h("span", "publish-release__when", formatRelativeTime(rel.createdAt, Date.now())));
      sum.appendChild(h("span", "publish-release__count", s.docLabel));
      if (s.presetLabel) sum.appendChild(h("span", "publish-release__preset", s.presetLabel));
      if (s.destinationLabel) sum.appendChild(h("span", "publish-release__dest", s.destinationLabel));
      // canonical DS Badge, quiet tone — one per row, so a column of solid fills would shout.
      var pill = U && U.Badge ? U.Badge({ tone: s.ok ? "success" : "danger", quiet: true, children: s.outcome })
        : h("span", null, s.outcome);
      pill.classList.add("publish-release__outcome");
      sum.appendChild(pill);
      det.appendChild(sum);
      var relBody = h("div", "publish-release__body");
      (rel.entries || []).forEach(function (en) {
        var row = h("div", "publish-release__entry" + (en.status === "error" ? " is-failed" : ""));
        row.appendChild(h("span", "publish-release__entry-title", en.title));
        var tags = [en.exportFormat, en.variant, en.version, en.preset].filter(Boolean).join(" · ");
        if (tags) row.appendChild(h("span", "publish-release__entry-tags", tags));
        if (en.status === "error") row.appendChild(h("span", "publish-release__entry-tags", "failed"));
        else if (en.destination) row.appendChild(h("span", "publish-release__entry-tags", en.destination));
        relBody.appendChild(row);
      });
      det.appendChild(relBody);
      body.appendChild(det);
    });
  }
  function publishStatusLabel(r) {
    if (r.status === "running") return "Publishing…";
    if (r.status === "done") return "Done" + (r.result && r.result.path ? " · " + r.result.path : "");
    if (r.status === "error") return "Failed" + (r.result && r.result.path ? " · " + r.result.path : "");
    return "Pending";
  }
  // The preset menu on a queue row (T2): pick any preset (built-in or custom) for this row, save the
  // current one under a new name, or rename/delete a custom preset. Picking also records the choice as
  // the document's last-used preset so a re-queue is zero-config.
  function openPublishPresetMenu(rowId, x, y) {
    var PQ = window.PublishQueue, PP = window.PublishPresets; if (!PQ || !PP) return;
    var q = publishQueue(), store = publishPresets();
    var row = PQ.rowById(q, rowId); if (!row) return;
    var items = [{ head: "Output preset" }];
    PP.allPresets(store).forEach(function (p) {
      items.push({ label: p.name, active: (row.preset || "master") === p.id, onClick: function () {
        row.preset = p.id; PP.setLastForDoc(store, row.docId, p.id);
        savePublishQueue(); savePublishPresets(); renderPublishQueue();
      } });
    });
    items.push({ sep: true });
    items.push({ label: "Save current as new preset…", onClick: function () {
      promptPublishPresetName("Save output preset", PP.presetName(store, row.preset || "master") + " copy", function (name) {
        var np = PP.saveCustom(store, name, PP.optionsFor(store, row.preset || "master"));
        if (np) { row.preset = np.id; PP.setLastForDoc(store, row.docId, np.id); savePublishQueue(); savePublishPresets(); renderPublishQueue(); }
      });
    } });
    if (!PP.isBuiltin(row.preset || "master")) {
      items.push({ label: "Rename preset…", onClick: function () {
        promptPublishPresetName("Rename preset", PP.presetName(store, row.preset), function (name) {
          PP.renameCustom(store, row.preset, name); savePublishPresets(); renderPublishQueue();
        });
      } });
      items.push({ label: "Delete preset", danger: true, onClick: function () {
        PP.deleteCustom(store, row.preset); row.preset = "master";
        savePublishPresets(); savePublishQueue(); renderPublishQueue();
      } });
    }
    showContextMenu(x, y, items);
  }
  // T3: the destination popover. It is the row's "where does this land, and what is it called"
  // surface — one path row PER OUTPUT (flagship + each variant), each independently pickable and
  // independently remembered, each showing the filename it will write. It also carries the one
  // setting that changes those filenames: the deliberate re-cut.
  //
  // Why a popover rather than an expanded row: the spine puts a few settings for the thing you
  // clicked in a popover anchored to it, and keeps the collapsed row's name in front of the author
  // instead of trading it for a column of folder paths.
  function openPublishDestPopover(anchor, rowId) {
    var PQ = window.PublishQueue, PA = window.PublishPaths, SX = window.SCORMExport, U = window.VersoUI;
    if (!PQ || !PA) return;
    var q = publishQueue();
    var row = PQ.rowById(q, rowId); if (!row) return;
    openChromePop(anchor, function (pop) {
      pop.appendChild(h("div", "chrome-pop__title", "Publish destination"));
      var rootLbl = PA.rootLabel(publishPaths(), publishPathCtx(row, null).productId);
      var note = h("div", "chrome-pop__note", rootLbl
        ? "Outputs inherit the Product folder “" + rootLbl + "” and nest by document and variant. Pick a folder below to override one."
        : "No Product folder is set, so these outputs download. Pick a folder below, or set a Product folder once in the pane header.");
      pop.appendChild(note);
      publishRowOutputs(row).forEach(function (v) {
        var dest = PA.resolve(publishPaths(), publishPathCtx(row, v));
        var opts = publishOptionsForRow(row, v);
        var line = h("div", "publish-destrow");
        var head = h("div", "publish-destrow__head");
        head.appendChild(h("span", "publish-destrow__name", v ? String(v) : "Flagship"));
        var pathEl = h("span", "publish-destrow__path" + (dest.inherited ? " is-inherited" : ""), dest.chip);
        pathEl.title = dest.hint;
        head.appendChild(pathEl);
        line.appendChild(head);
        var fn = publishRowFilename(SX && SX.packageName, opts);
        if (fn) line.appendChild(h("div", "publish-destrow__file", fn));
        var acts = h("div", "publish-destrow__acts");
        var pickLabel = dest.kind === "row" ? "Change folder" : "Choose folder";
        var pick = U ? U.Button({ variant: "secondary", label: pickLabel, onClick: function () {
          pickPublishDir(PA.rowHandleKey(dest.key)).then(function (name) {
            if (!name) return;
            PA.setRowPath(publishPaths(), dest.key, name); savePublishPaths();
            closeChromePop(); renderPublishQueue();
          });
        } }) : h("button", null, pickLabel);
        acts.appendChild(pick);
        if (dest.kind === "row") {
          var rst = U ? U.Button({ variant: "secondary", label: "Reset", onClick: function () {
            forgetPublishDir(PA.rowHandleKey(dest.key));
            PA.clearRowPath(publishPaths(), dest.key); savePublishPaths();
            closeChromePop(); renderPublishQueue();
          } }) : h("button", null, "Reset");
          // The spine's inheritance tail: Reset says, in words, what it puts the row back to.
          rst.title = rootLbl ? "Go back to inheriting the Product folder “" + rootLbl + "”." : "Go back to downloading this output.";
          acts.appendChild(rst);
        }
        line.appendChild(acts);
        pop.appendChild(line);
      });
      // Q2: never a silent overwrite. Off (the default) steps to a new version every run; on reuses
      // the last one, which is the only way to write over a package on purpose.
      var sw = U && U.SwitchRow ? U.SwitchRow({
        label: "Replace current version",
        description: row.replaceVersion ? "Overwrites the last package instead of adding a new version." : "Off: every run writes a new incremented version.",
        checked: !!row.replaceVersion,
        onChange: function (on) {
          row.replaceVersion = !!on; savePublishQueue();
          closeChromePop(); renderPublishQueue();
        }
      }) : null;
      if (sw) { sw.classList.add("publish-destrow__replace"); pop.appendChild(sw); }
    }, { cls: "chrome-pop--publish-dest" });
  }
  // The Product root folder, set once for the whole family (T3, Q1). It lives in the pane head rather
  // than on a row because it is a Product-scoped setting that every row inherits — putting it on a row
  // would imply it belonged to that row.
  function publishRootChip() {
    var PA = window.PublishPaths, U = window.VersoUI; if (!PA) return null;
    var pid = publishRootScope();
    if (pid === null) {
      // Several Products are queued. Each keeps its own folder, so there is nothing here to set —
      // and a control that would write one Product's folder onto another's rows would be a trap.
      var span = h("span", "publish-chip publish-chip--root publish-chip--static", "Folder · per Product");
      span.title = "This queue spans several Products, and each one has its own publish folder. Pick a Product in the rail to set its folder.";
      return span;
    }
    var lbl = PA.rootLabel(publishPaths(), pid);
    var chip = h("button", "publish-chip publish-chip--root", lbl ? "Folder · " + lbl : "Set publish folder");
    chip.type = "button";
    chip.title = lbl
      ? "Every queued output publishes under “" + lbl + "”, nested by document and variant, unless it has its own folder."
      : "Pick one folder for this Product and every queued output publishes under it. Until then, packages download.";
    chip.addEventListener("click", function () {
      openChromePop(chip, function (pop) {
        pop.appendChild(h("div", "chrome-pop__title", "Product publish folder"));
        pop.appendChild(h("div", "chrome-pop__note", lbl
          ? "Rows inherit this folder and nest into Product / document-variant. A row with its own folder ignores it."
          : "One pick covers the whole queue. Without it every package downloads instead."));
        var pick = U ? U.Button({ variant: "primary", full: true, label: lbl ? "Change folder" : "Choose folder", onClick: function () {
          pickPublishDir(PA.rootHandleKey(pid)).then(function (name) {
            if (!name) return;
            PA.setRoot(publishPaths(), pid, name); savePublishPaths();
            closeChromePop(); renderPublishQueue();
          });
        } }) : h("button", null, "Choose folder");
        pop.appendChild(pick);
        if (lbl) {
          var clr = U ? U.Button({ variant: "secondary", full: true, label: "Clear folder", onClick: function () {
            forgetPublishDir(PA.rootHandleKey(pid));
            PA.clearRoot(publishPaths(), pid); savePublishPaths();
            closeChromePop(); renderPublishQueue();
          } }) : h("button", null, "Clear folder");
          clr.title = "Rows without their own folder go back to downloading.";
          pop.appendChild(clr);
        }
        if (!window.showDirectoryPicker) pop.appendChild(h("div", "chrome-pop__note", "This browser can't save straight to a folder, so packages download."));
      }, { cls: "chrome-pop--publish-dest", align: "right" });
    });
    return chip;
  }
  // A minimal DS name modal (no raw prompt()): a single TextField + Save/Cancel. Reused for save +
  // rename of an output preset. onOk receives the trimmed name (never fires on a blank name).
  function promptPublishPresetName(title, initial, onOk) {
    var UI = window.VersoUI; if (!UI || !UI.Modal) return;
    var field = UI.TextField({ value: initial || "" });
    var inputEl = field.input || (field.querySelector && field.querySelector("input,textarea"));
    var body = h("div"); body.appendChild(field);
    var modal;
    function commit() {
      var val = (inputEl && inputEl.value != null ? inputEl.value : "").trim();
      if (!val) return;
      if (modal && modal.close) modal.close();
      onOk(val);
    }
    var footer = h("div");
    footer.appendChild(UI.Button({ variant: "secondary", label: "Cancel", onClick: function () { if (modal && modal.close) modal.close(); } })); // spine-ok: one-decision prompt modal (single field)
    footer.appendChild(UI.Button({ variant: "primary", label: "Save", onClick: commit })); // spine-ok: one-decision prompt modal (single field)
    modal = UI.Modal({ title: title, children: body, footer: footer });
    document.body.appendChild(modal);
    if (inputEl) { setTimeout(function () { inputEl.focus(); inputEl.select && inputEl.select(); }, 0); inputEl.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); commit(); } }); }
  }
  // Download a built package — the fallback whenever no folder is set, the browser can't write to
  // one, or a remembered folder's permission has lapsed. A publish never fails for want of a folder.
  function downloadPublishPackage(pkg) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(pkg.blob); a.download = pkg.name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    return { to: "download", path: pkg.name };
  }
  // T3: write one built package to its resolved destination. An override writes straight into the
  // picked folder; an inherited root nests into `Product/<doc-variant>/` first. `create: true` on the
  // file handle is what makes "replace current version" an overwrite — with the flag off the filename
  // has already stepped, so there is nothing to overwrite.
  function deliverPublishPackage(row, variant, pkg) {
    var PA = window.PublishPaths;
    var dest = PA ? publishResolveDest(row, variant) : null;
    if (!dest || dest.kind === "download") return Promise.resolve(downloadPublishPackage(pkg));
    return publishDirHandle(dest.handleKey).then(function (root) {
      if (!root) return downloadPublishPackage(pkg);
      return publishEnsureDir(root, dest.segments)
        .then(function (dir) { return dir.getFileHandle(pkg.name, { create: true }); })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w) { return Promise.resolve(w.write(pkg.blob)).then(function () { return w.close(); }); })
        .then(function () { return { to: "folder", path: dest.chip + pkg.name }; });
    }).catch(function (e) {
      console.warn("[publish] folder write failed, downloading instead: " + pkg.name, e);
      return downloadPublishPackage(pkg);
    });
  }
  function publishRowResult(results) { return window.VersoPublish.rowResult(results); }
  // The run itself is the module's (arch-P3-03). What is left here is the one thing it cannot
  // decide: whether this origin can publish at all. A file:// page can't read course.css, the fonts
  // or the interactions it has to bundle, so the packages would be silently incomplete.
  function runPublishQueue() {
    if (location.protocol === "file:") { window.alert("Publish needs the http:// origin so it can bundle fonts, course.css and interactions.\n\nRun ./serve.command and open http://localhost:8123, then Publish again."); return; }
    return Publish.run();
  }
  // Creates a Product container and persists it; the sole write path other Product Rail
  // tickets (new-product-flow, promote-to-product) build their UI on top of.
  function createProduct(name) {
    var id = "prod-" + Math.random().toString(36).slice(2, 8);
    while (window.ProductsStore[id]) id = "prod-" + Math.random().toString(36).slice(2, 8);
    var prod = { id: id, name: (String(name || "").trim() || "Untitled product"), createdAt: Date.now() };
    window.ProductsStore[id] = prod;
    saveProducts();
    return prod;
  }
  // Product Rail (source-stage-variant-columns): the hardware-variant axis a Product's
  // Source topics carry, declared once per Product (not per-document -- topics are
  // Product-scoped library content). No declaring UI exists yet; this is a fixture/
  // future-authoring write path, same precedent as createProduct/createTopic.
  function setProductVariants(productId, variants) {
    var p = productId && window.ProductsStore[productId]; if (!p) return null;
    p.variants = (variants || []).slice();
    saveProducts();
    return p;
  }
  // Product/source lifecycle (test + real authoring cleanup): unlink a course, delete a Product's
  // source document, or delete the Product outright. Destructive ops are confirm-gated at the UI.
  // Unlink the OPEN (or given) course from its Product -- clears only doc.meta.productId/stage; the
  // course + its content are untouched.
  function unlinkDocFromProduct(d) {
    d = d || doc; if (!d || !d.meta || !d.meta.productId) return false;
    pushHistory();
    delete d.meta.productId; delete d.meta.stage;
    saveRegistry(registry);
    return true;
  }
  // Clear the Product tag from EVERY course in the registry pointing at pid. Returns the count.
  function unlinkAllCoursesFromProduct(pid) {
    var n = 0;
    Object.keys(registry).forEach(function (id) {
      var d = registry[id];
      if (d && d.meta && d.meta.productId === pid) { delete d.meta.productId; delete d.meta.stage; n++; }
    });
    if (n) saveRegistry(registry);
    return n;
  }
  // Delete a Product's WHOLE source document: its reserved master + every topic tagged to it
  // (archived or loose). Clears product.groundTruthId. The Product entry itself stays.
  function deleteProductSource(pid) {
    var product = window.ProductsStore[pid]; if (!product) return 0;
    var comps = libComponents(), n = 0;
    Object.keys(comps).forEach(function (k) {
      var c = comps[k];
      if (c && c.kind === "topic" && c.productId === pid) { delete comps[k]; n++; }
    });
    if (product.groundTruthId && comps[product.groundTruthId]) { delete comps[product.groundTruthId]; n++; }
    delete product.groundTruthId;
    saveLibrary(); saveProducts();
    return n;
  }
  // Delete a Product outright: its source document + unlink all its linked courses + remove the entry.
  function deleteProduct(pid) {
    if (!window.ProductsStore[pid]) return false;
    deleteProductSource(pid);
    unlinkAllCoursesFromProduct(pid);
    delete window.ProductsStore[pid];
    saveProducts();
    return true;
  }
  // Foundational tagging-layer API (Product Rail #1) — the surface every downstream
  // Product Rail ticket (bottom-rail nav, +New Product, Promote to Product, browser
  // filters) builds its UI on top of. Exposed the same way __modals exposes confirmModal.
  window.__productRail = { createProduct: createProduct, tagDocProductStage: tagDocProductStage, docMatchesProductStage: docMatchesProductStage, setProductVariants: setProductVariants,
    unlinkDocFromProduct: unlinkDocFromProduct, unlinkAllCoursesFromProduct: unlinkAllCoursesFromProduct, deleteProductSource: deleteProductSource, deleteProduct: deleteProduct };
  // SPEC 7 matrix doc-type model -- the pure surface the Editor Window Rework tickets
  // (creation flow, cell switcher, capability inspector, static fallback, file picker
  // grouping) consume so the {geo, interactive} logic lives in exactly one place.
  window.__docType = { docCell: docCell, tagDocCell: tagDocCell, presetToCell: presetToCell,
    cellToPreset: cellToPreset, condToolsFor: condToolsFor, isValidGeo: isValidGeo,
    isInteractiveBlockType: isInteractiveBlockType, paletteAllowsType: paletteAllowsType,
    PRESETS: DOCTYPE_PRESETS, GEOS: DOCTYPE_GEOS };
  // "Promote to Product" (save menu action): tags the ACTIVE document onto a new or
  // existing Product + stage. Writes ONLY doc.meta.productId/stage -- no content
  // extraction, splitting, or Ground Truth generation, and never a bulk/batch action
  // (this modal always operates on `doc`, the one open course). Reuses the modalField +
  // dsSelect pattern Find & Replace's variant picker already established, not a new
  // control -- see modalField(box, "Apply to") at the Find & Replace call site.
  var PRODUCT_STAGE_OPTS = [["eLearning", "elearning"], ["Presentations", "presentations"], ["Print docs", "printDocs"]];
  // targetDoc defaults to the active doc (top-bar / header entry points); the file picker's per-card
  // menu passes a specific registry doc so any course can be promoted without opening it first.
  function promoteToProductModal(targetDoc) {
    var td = targetDoc || doc;
    if (!td) return;
    var NEW_KEY = "__new__";
    var products = window.ProductsStore || {};
    var productKeys = Object.keys(products);
    var pOpts = [["+ Create a new Product…", NEW_KEY]].concat(productKeys.map(function (k) { return [products[k].name || k, k]; }));
    var chosen = productKeys.length ? productKeys[0] : NEW_KEY;
    var stage = (td.meta && td.meta.stage) || "elearning";
    var newNameVal = "";
    var shell = dsModalShell({
      title: "Promote to Product",
      subtitle: "Tags this course onto a Product + format. Only adds meta — the course's content is never touched.",
      primaryLabel: "Promote",
      onPrimary: function () {
        var pid = chosen;
        if (chosen === NEW_KEY) {
          var name = (newNameVal || "").trim();
          if (!name) return;
          pid = createProduct(name).id;
        }
        pushHistory();
        tagDocProductStage(td, pid, stage);
        // spec 2d bridge: carry the course's declared variants onto the Product (union) so the
        // Product's variant workflow (import-as-variant, columns) is reachable -- both sides store
        // variants as the same array of name strings, so this is a straight merge. Reads the CARD's
        // doc (td), not the open one, since Promote is a per-card menu action.
        if (td.variants && td.variants.length) {
          var pv = (window.ProductsStore[pid] && window.ProductsStore[pid].variants) || [];
          var merged = pv.slice();
          td.variants.forEach(function (v) { if (merged.indexOf(v) === -1) merged.push(v); });
          setProductVariants(pid, merged);
        }
        saveRegistry(registry);
        shell.modal.close();
        mountProductPicker(); // refresh the top-bar product context so the new/changed Product shows
      }
    });
    var box = shell.body;
    var pRow = modalField(box, "Product");
    var pSel = dsSelect(pOpts, chosen, function (v) { chosen = v; newNameRow.style.display = (v === NEW_KEY) ? "" : "none"; });
    pSel.classList.add("modal-field__control");
    pRow.appendChild(pSel);
    var newNameRow = h("div"); newNameRow.style.display = (chosen === NEW_KEY) ? "" : "none";
    var nameInput = modalText(newNameRow, "New Product name", "", "e.g. Radar Line");
    nameInput.addEventListener("input", function () { newNameVal = nameInput.value; });
    box.appendChild(newNameRow);
    var sRow = modalField(box, "Format");
    var sSel = dsSelect(PRODUCT_STAGE_OPTS, stage, function (v) { stage = v; });
    sSel.classList.add("modal-field__control");
    sRow.appendChild(sSel);
  }
  function isLibraryComponent(key) { return !!libComponents()[key]; }

  // ---- Product Rail: tag vocabulary + reserved owning-Product tag ---------------
  // A master's tags: [{value, reserved}]. At most one entry is reserved:true -- the
  // "owning Product" tag, stamped ONCE at promotion time from the active doc's Product
  // context (birthplace, not ownership -- a master promoted from an untagged doc simply
  // gets no reserved tag, nothing to attribute). Every other entry is a freeform
  // technology tag, global across Products (never scoped per Product). Pure; callers own
  // persistence (saveLibrary()) after mutating the master object passed in.
  /* @tag-vocab-start */
  function ownerProductTagValue(productId) { return productId ? ("product:" + productId) : null; }
  function stampOwnerProductTag(master, productId) {
    if (!master) return master;
    if (!Array.isArray(master.tags)) master.tags = [];
    if (!productId) return master; // no Product context at promotion time -- nothing to attribute
    if (master.tags.some(function (t) { return t && t.reserved; })) return master; // stamped once, never re-stamped
    master.tags.push({ value: ownerProductTagValue(productId), reserved: true });
    return master;
  }
  function addTechnologyTag(master, value) {
    if (!master) return master;
    var v = String(value || "").trim(); if (!v) return master;
    if (!Array.isArray(master.tags)) master.tags = [];
    if (master.tags.some(function (t) { return t && t.value === v; })) return master; // no dupes
    master.tags.push({ value: v, reserved: false });
    return master;
  }
  // Ordinary tag-editing can never remove the reserved tag -- matches on a non-reserved value only.
  function removeMasterTag(master, value) {
    if (!master || !Array.isArray(master.tags)) return master;
    master.tags = master.tags.filter(function (t) { return !(t && t.value === value && !t.reserved); });
    return master;
  }
  // Autocomplete-first matching against the global technology-tag vocabulary. "propose
  // new" is the caller's fallback when exact is false -- never the default typing path.
  function matchTagVocabulary(vocab, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return { matches: [], exact: false };
    var matches = (vocab || []).filter(function (t) { return t && t.toLowerCase().indexOf(q) !== -1; });
    var exact = (vocab || []).some(function (t) { return t && t.toLowerCase() === q; });
    return { matches: matches, exact: exact };
  }
  /* @tag-vocab-end */
  // The global technology-tag vocabulary: every non-reserved tag value already used by
  // any master in the shared library (not scoped per Product, per the ticket's spec).
  function collectTagVocabulary() {
    var seen = {}, out = [];
    var comps = libComponents();
    Object.keys(comps).forEach(function (k) {
      ((comps[k] && comps[k].tags) || []).forEach(function (t) {
        if (t && !t.reserved && t.value && !seen[t.value]) { seen[t.value] = true; out.push(t.value); }
      });
    });
    return out;
  }
  // doc override -> shared library -> built-in. Shared by the editor + render.
  function resolveComponentDef(key) {
    return (doc.components && doc.components[key]) || libComponents()[key] || (window.COMPONENTS || {})[key];
  }
  window.resolveComponentDef = resolveComponentDef;

  // arch-P3b-07styles: the NAMED text and block styles -- the doc.styles / theme.blockStyles
  // accessors and the rename that repoints every styleRef in the document -- moved to
  // editor/theme.js, which already owned the panel that edits them.
  var getTextStyles = VE.bind("getTextStyles");
  var getBlockStyles = VE.bind("getBlockStyles");
  var renameTextStyle = VE.bind("renameTextStyle");

  // arch-P3b-07tabs: the document tab strip -- what is open, which one is active, and the
  // wholesale swap `switchDoc` performs when you leave one for another -- moved to
  // editor/tabs.js. It came out from under a banner about tag vocabulary, which described the
  // 46 lines above it and nothing here.
  var visibleTabIds = VE.bind("visibleTabIds");
  var renderTabs = VE.bind("renderTabs");
  var closeTab = VE.bind("closeTab");
  var switchDoc = VE.bind("switchDoc");
  var reconcileActiveTabToScope = VE.bind("reconcileActiveTabToScope");


  // ---- #73 Home / file browser ("local-first, no cloud") -------------------
  // arch-P3b-07k: the course grid, its live-rendered thumbnails, the destructive verbs it offers
  // and the store-location line moved to editor/home.js.
  var openBrowser = VE.bind("openBrowser");
  var closeBrowser = VE.bind("closeBrowser");
  var browserIsOpen = VE.bind("browserIsOpen");
  var duplicateCourse = VE.bind("duplicateCourse");
  var renameCourse = VE.bind("renameCourse");
  var deleteCourse = VE.bind("deleteCourse");
  var openCourseFromBrowser = VE.bind("openCourseFromBrowser");
  var storeLocationText = VE.bind("storeLocationText");


  // arch-P3b-07doc: everything about bringing a course into existence -- the New dialog, the
  // blank-course builder, the .json import and its id-collision check, the file readers -- moved
  // to editor/documents.js. The shared header/footer default went with them: it exists only so a
  // new course inherits the chrome the author already built, and has no other consumer.
  var sanitizeHeaderFooterDefault = VE.bind("sanitizeHeaderFooterDefault");
  var headerFooterFromDefault = VE.bind("headerFooterFromDefault");
  var getHeaderFooterDefault = VE.bind("getHeaderFooterDefault");
  var saveHeaderFooterDefault = VE.bind("saveHeaderFooterDefault");
  var clearHeaderFooterDefault = VE.bind("clearHeaderFooterDefault");
  var createBlankDoc = VE.bind("createBlankDoc");
  var importDocToRegistry = VE.bind("importDocToRegistry");
  var readCourseFile = VE.bind("readCourseFile");
  var pickCourseFile = VE.bind("pickCourseFile");
  var showNewDocDialog = VE.bind("showNewDocDialog");


  // ---- history / undo-redo -> src/editor/history.js (arch-P3-02) -------------
  // The stacks, the cap, redo invalidation, the one-step-per-typing-burst rule and the repaint
  // hint all live in the module. What stays here is the half it cannot own: the pair-write below.
  //
  // No onChange hook is passed, because there is nothing to tell. updateHistoryButtons() drove
  // #undo-btn / #redo-btn, and no HTML in this repo has carried those elements since the toolbar
  // merge -- so it read null, did nothing, and was called on every mount and every page rebuild.
  // Undo state is surfaced by the canvas itself. Removed with the extraction rather than moved.
  var History = window.VersoHistory.create({
    getDoc: function () { return doc; },
    applyDoc: function (next, changed) { applyDocSwap(next, changed); },
    // A variant/version preview renders resolved clones, so a per-page rebuild would repaint
    // something the author is not looking at -- full mount while previewing.
    canIsolate: function () { return !isPreview(); },
    clone: function (o) { return clone(o); }
  });

  // THE pair-write, and the only one. `doc` is what every editor surface holds a reference to;
  // `registry[activeDocId]` is what the next save persists. They are two names for one document.
  // Replace one without the other and the editor edits an object the registry will never write:
  // the tour-builder session that lost its edits, and the undo that shipped the pre-undo doc on
  // the next save (#50), were both this. A ratchet in tests/run.js fails any other assignment.
  function setActiveDocObject(next) {
    doc = next;
    registry[activeDocId] = next;
    return next;
  }
  // A snapshot (undo, redo, setDoc) reaching the canvas: swap the document, then repaint either
  // the pages that actually changed or the whole world.
  function applyDocSwap(next, changed) {
    setActiveDocObject(next);
    if (changed) {
      clearSelection();
      if (changed.length) reapplyStructural(changed); else { renderStructure(); renderModelView(); }
    } else {
      mount();
    }
    rebindTourBuilderToLiveDoc(); // keep an open builder bound to the restored doc
  }
  // Making a different course the active one. Tab click, tab close, course delete: all three
  // move the id, the live doc and the registry entry together, drop the outgoing course's undo
  // history (a snapshot of one course must never be restorable into another) and reset the
  // per-document cursor -- a stale page index makes restoreSelection read past the end of the
  // new doc and crash. closeDoc used to do none of that.
  function activateDoc(id) {
    activeDocId = id;
    saveActiveDocId(activeDocId);
    setActiveDocObject(registry[activeDocId]);
    History.reset();
    clearSelection(); clearMultiPages(); multiSel = []; currentPage = 0;
    clearThemePresetChoice(); // #126: the picker's shown theme is per-course; don't bleed one course's choice into the next
    return doc;
  }
  function pushHistory() { History.push(); }
  function undo() { History.undo(); }
  function redo() { History.redo(); }

  function h(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- interaction element identity ---------------
  // `block.id` is lazy + opt-in: minted only when a block first PARTICIPATES in an
  // interaction (gains interactions/gate, or is chosen as a target / condition
  // source). Un-interactive blocks stay id-less. Format: "b_" + 6 base36 chars.
  function mintId() { return "b_" + Math.random().toString(36).slice(2, 8); }
  window.__mintId = mintId;
  // Ensure a block has an id (call this from the Interact-mode authoring UI the
  // moment a block becomes interactive or is picked as a target/source).
  function ensureId(block) { if (block && !block.id) block.id = mintId(); return block && block.id; }
  window.__ensureId = ensureId;
  // §12 slice 0: `block.cid` is a STABLE, always-present comment-anchor id (unlike
  // the lazy `block.id`). Minted for EVERY block in normalizeDoc, persisted in the
  // .json. Kept OFF `block.id` because render stamps any `block.id` as `data-id`
  // (exported + bound by the runtime engine) — a separate cid keeps the SCORM
  // export byte-unaffected; the editor stamps `data-cid` on mount for hit-testing.
  function mintCid() { return "c_" + Math.random().toString(36).slice(2, 8); }
  window.__mintCid = mintCid;
  // arch-P3b-07z: the comment MODEL -- makeComment, the task/receipt and guest/orphan
  // classifiers, the cid scans and the server-envelope bridge -- moved to editor/comments.js,
  // which is the only thing that consumes it. The @comment-guest fence went with it. What is
  // left here is the doc walker those scans borrow, which is substrate, not comment code.
  var makeComment = VE.bind("makeComment");
  var commentIsReceipt = VE.bind("commentIsReceipt");
  var commentIsTask = VE.bind("commentIsTask");
  var taskComments = VE.bind("taskComments");
  var receiptsFor = VE.bind("receiptsFor");
  var openTasks = VE.bind("openTasks");
  var doneTasks = VE.bind("doneTasks");
  var commentIsGuest = VE.bind("commentIsGuest");
  var commentIsOrphaned = VE.bind("commentIsOrphaned");
  var commentFromEnv = VE.bind("commentFromEnv");
  var docCids = VE.bind("docCids");
  var blockCidById = VE.bind("blockCidById");
  var blockIdByCid = VE.bind("blockIdByCid");
  // walk every block in the doc (incl. nested containers), calling visit(block). The ONE place that
  // knows the container-child keys, shared by the cid scans below (kills the duplicated walkers).
  function walkBlocks(doc, visit) {
    function walk(b) {
      if (!b || typeof b !== "object") return;
      visit(b);
      ["children", "columns", "items", "blocks", "cells"].forEach(function (k) { if (Array.isArray(b[k])) b[k].forEach(walk); });
    }
    ((doc && doc.pages) || []).forEach(function (p) { (p.blocks || []).forEach(walk); });
  }
  // ...continues in library.js (arch-P3b-07).

  window.__libraryWhereUsed = libraryWhereUsed; // test hook
  // Re-mint on duplicate: a cloned subtree must never reuse ids, or a copy's
  // interactions/gate would collide with the original — and a shared cid would make
  // a comment anchor to two blocks at once. Walk children / columns / items and
  // re-mint every "b_" id AND the cid in place. Call after any block clone that
  // lands in the document — duplicate-in-place, duplicate-selection, paste, and
  // saveBlockAsComponent's CAPTURE of a new component (the ids minted there become
  // that component's permanent identity, see below).
  //
  // #19 stable-id master snapshot contract: NEVER call remintIds on content already
  // resident in doc.components or LibraryStore.components. A component's ids are
  // minted exactly ONCE, at the moment it is captured (saveBlockAsComponent) — from
  // then on they are the component's PERMANENT identity: stable through save/load,
  // through "Save to library" / "Copy to course" (both plain `clone()`, no remint),
  // and through .verso export/import (plain JSON, no id processing there either).
  // This is the substrate #20 (mirror instances) and #21 (instance overrides) build
  // on: an override keys against a master's block id, so that id must never drift.
  function remintIds(node) {
    if (!node || typeof node !== "object") return node;
    if (typeof node.id === "string" && node.id.indexOf("b_") === 0) node.id = mintId();
    if (typeof node.cid === "string") node.cid = mintCid(); // §12: copy gets a fresh comment-anchor id
    if (node.children) node.children.forEach(remintIds);
    if (node.columns) node.columns.forEach(function (col) { (col || []).forEach(remintIds); });
    if (Array.isArray(node.items)) node.items.forEach(function (it) { if (!it) return; if (it.children) it.children.forEach(remintIds); if (Array.isArray(it.front)) it.front.forEach(remintIds); });
    // hotspot popover-card blocks (#215: screens[].markers[].blocks). Inlined (not the
    // hotspotCardArrays helper) so the tests' remintIds slice stays self-contained.
    if (Array.isArray(node.screens)) node.screens.forEach(function (s) {
      if (s && Array.isArray(s.markers)) s.markers.forEach(function (m) { if (m && Array.isArray(m.blocks)) m.blocks.forEach(remintIds); });
    });
    return node;
  }
  window.__remintIds = remintIds;

  // arch-P3b-07s: Interact mode moved to editor/interact.js -- the mode flag and its tabs,
  // click-to-pick, drag-to-link, the connection handle and the two inspector sections (on-click
  // and the locked-until gate). The module OWNS the mode, the show-all-connections preference and
  // the pending pick, and editor.js asks for them through accessors. `drawConnectors` stayed: it
  // paints the links, but it is canvas geometry and belongs with the view.
  var syncRightTabs = VE.bind("syncRightTabs");
  var setInteractMode = VE.bind("setInteractMode");
  var wireRightTabs = VE.bind("wireRightTabs");
  var pageBlockCandidates = VE.bind("pageBlockCandidates");
  var conditionSources = VE.bind("conditionSources");
  var startPick = VE.bind("startPick");
  var endPick = VE.bind("endPick");
  var startLink = VE.bind("startLink");
  var frameElementUnder = VE.bind("frameElementUnder");
  var interactReselect = VE.bind("interactReselect");
  var addGotoInteraction = VE.bind("addGotoInteraction");
  var decorateInteractHandle = VE.bind("decorateInteractHandle");
  var interactBlock = VE.bind("interactBlock");
  var renderInteractInspector = VE.bind("renderInteractInspector");
  var restoreInteractMode = VE.bind("restoreInteractMode");
  var interactModeOn = VE.bind("interactModeOn");
  var showAllConnectorsOn = VE.bind("showAllConnectorsOn");
  var isPicking = VE.bind("isPicking");
  var renderGateSection = VE.bind("renderGateSection");
  var blockById = VE.bind("blockById");
  // Constants, read back from their owner right after it installs (see the bottom of this file).
  var ACTION_TYPES, NAV_ACTIONS;


  // walk a page's block tree (children + columns) so nested interactive blocks
  // are reached — mirrors render.js walkBlocks (which is module-private there).
  function walkPageBlocks(blocks, fn) {
    (blocks || []).forEach(function (b) {
      fn(b);
      if (b.children) walkPageBlocks(b.children, fn);
      if (b.columns) b.columns.forEach(function (col) { walkPageBlocks(col, fn); });
      if (b.items) b.items.forEach(function (item) { if (!item) return; if (item.children) walkPageBlocks(item.children, fn); if (Array.isArray(item.front)) walkPageBlocks(item.front, fn); }); // accordion / cardReveal items[].children + flip fronts
      hotspotCardArrays(b).forEach(function (arr) { walkPageBlocks(arr, fn); }); // hotspot popover-card blocks (#215)
    });
  }
  // the page index that owns a block (top-level OR nested), for same-page target
  // pickers. getBlockPageIndexAndIndex only sees top-level blocks.
  function findPageOfBlock(block) {
    for (var pi = 0; pi < doc.pages.length; pi++) {
      var pg = doc.pages[pi]; if (!pg) continue; // a stray null/malformed page entry must not abort every later page's lookup
      var hit = false;
      walkPageBlocks(pg.blocks, function (b) { if (b === block) hit = true; });
      if (hit) return pi;
    }
    return -1;
  }
  // ...continues in interact.js (arch-P3b-07).


  // ...continues in interact.js (arch-P3b-07).

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function colX(col) { return col * (FRAME_W + GAP_X); }
  function frameX(i) { return (framePos[i] && framePos[i].x != null) ? framePos[i].x : colX(i); }
  function frameY(i) { return (framePos[i] && framePos[i].y != null) ? framePos[i].y : 0; }
  function isHex(s) { return /^#[0-9a-fA-F]{6}$/.test(s); }

  function findBlockParent(blocks, targetBlock) { return DND.findBlockParent(blocks, targetBlock); }

  // #95: the group block that holds `target` as a DIRECT child (innermost group wins),
  // or null. A group is a boxless (display:contents) content chunk whose children are
  // full-width, so a side (left/right) drop on a child means "beside the whole group" —
  // handleDrop uses this to retarget the columns-wrap onto the group, not the child.
  // Only DIRECT group children match: a child inside a Card/accordion/hotspot/columns
  // that is NOT itself a group child returns null, preserving the #55 in-place wrap.
  /* @groupparent-start */
  function groupParentOf(blocks, target) { return DND.groupParentOf(blocks, target); }
  /* @groupparent-end */

  function cleanupColumns(blocks) { return DND.cleanupColumns(blocks); }

  // arch-P3b-07b: the datalist plumbing and the drag-to-scrub behaviour every numeric row shares
  // moved to editor/inspector/primitives.js.

  var ensureDatalists = VE.bind("ensureDatalists");
  var makeScrubbable = VE.bind("makeScrubbable");


  // ---- drag & drop (reorder in the outliner, insert from Assets) -----------
  // arch-P3b-07t: the drag OVERLAY -- the insertion line, the hit zones, the column edge bands,
  // resizers and swap handles -- moved to editor/dnd-ui.js. It completes the split arch-P3-08
  // started: editor/dnd.js already DECIDES where a drop lands; that file SHOWS it. The drag state
  // (dragPayload / dragTargetZone) went with it and is read back through the namespace, because
  // the code that maintains it left and the outliner and Assets tab that read it did not.
  //
  // iconBtn and its legacy-key alias table stayed: they are a canonical CONTROL, not drag
  // behaviour, and belong with the rest of the set in inspector/primitives.js. Noted as a
  // follow-up rather than smuggled through that ticket.
  var clearDropMarks = VE.bind("clearDropMarks");
  var makeDropTarget = VE.bind("makeDropTarget");
  var handleDrop = VE.bind("handleDrop");
  var attachEmptyColumnDrops = VE.bind("attachEmptyColumnDrops");
  var wireItemBodyDrops = VE.bind("wireItemBodyDrops");
  var attachColumnsEdgeBands = VE.bind("attachColumnsEdgeBands");
  var attachColumnResizers = VE.bind("attachColumnResizers");
  var attachColumnSwaps = VE.bind("attachColumnSwaps");
  var showDropPreview = VE.bind("showDropPreview");
  var hideDropPreview = VE.bind("hideDropPreview");
  // The drag STATE reads and writes this file still makes. They are the drag SOURCES -- a canvas
  // block, an outliner row, an Assets tile -- and each moves out in a later slice; until then they
  // go through the owner rather than a local variable. Reads are functions, not a bound value,
  // because a payload is set and cleared many times per drag and a captured value would be stale.
  function dragPayloadNow() { return VE.get("dragPayload"); }
  function dragTargetZoneNow() { return VE.get("dragTargetZone"); }
  function setDragPayload(v) { VE.get("setDragPayload")(v); }
  function setDragTargetZone(v) { VE.get("setDragTargetZone")(v); }


  // arch-P3b-07: the icon button and its legacy-key alias table are canonical CONTROLS, and moved
  // to editor/inspector/primitives.js with the rest of the set. They were in the drag-and-drop
  // banner because that is where the first caller happened to be.
  var iconBtn = VE.bind("iconBtn");
  var ICON_ALIAS;   // data, not an entry point -- read from its owner after install (__kit ships it)

  // ---- active theme (#124: home is doc.theme) -------------------------------
  // arch-P3b-07f: the theme -- the per-course tokens, the two modes, the preset library and the
  // Theme panel -- moved to editor/theme.js. It owns the previewed mode and provides it.
  var activeTheme = VE.bind("activeTheme");
  var activeModeNow = VE.bind("activeModeNow");
  var setActiveMode = VE.bind("setActiveMode");
  var setMode = VE.bind("setMode");
  var loadTheme = VE.bind("loadTheme");
  var persistTheme = VE.bind("persistTheme");
  var reapplyTheme = VE.bind("reapplyTheme");
  var syncWorkingFromDoc = VE.bind("syncWorkingFromDoc");
  var workingThemesNow = VE.bind("workingThemesNow");
  var renderThemeControls = VE.bind("renderThemeControls");
  var clearThemePresetChoice = VE.bind("clearThemePresetChoice");
  var loadThemePresets = VE.bind("loadThemePresets");
  var saveThemePreset = VE.bind("saveThemePreset");
  var applyThemePreset = VE.bind("applyThemePreset");
  var renameThemePreset = VE.bind("renameThemePreset");
  var deleteThemePreset = VE.bind("deleteThemePreset");

  // arch-P3b-07: the in-app user guide -- the Markdown renderer, the modal, its contents list and
  // the figure handling -- moved to editor/help.js. It sat under the theme banner.
  var openHelpModal = VE.bind("openHelpModal");

  // ...continues in theme.js (arch-P3b-07).


  // ---- master page layout (side padding per breakpoint, persisted) ---------
  // Mode-independent (padding is the same in dark/light). Desktop 10% side
  // padding = 80%-width content centred — the current project's convention.
  var LAYOUT_KEY = "authoring.layout";
  var layout = { padDesktop: 10, padTablet: 6, padMobile: 5, padY: 56 };
  function loadLayout() { try { var l = JSON.parse(localStorage.getItem(LAYOUT_KEY)); if (l) { for (var k in l) if (l[k] != null) layout[k] = l[k]; } } catch (e) {} }
  function persistLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) {} }
  function applyLayoutVars(root, page) {
    root.style.setProperty("--page-pad-x", layout.padDesktop + "%");
    root.style.setProperty("--page-pad-x-tablet", layout.padTablet + "%");
    root.style.setProperty("--page-pad-x-mobile", layout.padMobile + "%");
    root.style.setProperty("--page-pad-y", layout.padY + "px");
    // per-page override wins over the global layout (same vars renderPage sets;
    // re-applied here because this runs after renderPage in the editor).
    if (page) window.applyPagePadding(root, page);
  }
  // Rebuild ONLY the canvas world (frames), leaving the inspector untouched so a
  // live headerFooter/layout edit updates the canvas while the panel keeps focus/scroll/
  // caret. Used by reapplyHeaderFooter/reapplyLayout (header/footer + page padding are
  // baked into renderPage/applyLayoutVars, so there is no lighter partial update).
  function reapplyWorld() {
    canvas.innerHTML = "";
    buildWorld();
    attachWorld();
    drawConnectors();
    canvas.classList.toggle("is-variant-preview", !!activeVariant);
    canvas.classList.toggle("is-version-preview", !!activeVersion);
    updateVariantBadge();
    updateVersionBadge();
    // uio-E-C04: keep the top-bar axis switches + the off-base return chip in sync (menu pick,
    // undo/redo, doc swap) -- onVariantPick only mounts, so the label/chip refresh here.
    syncVariantSwitch();
    syncVersionSwitch();
    if (canvasEditable()) enableEditing(world); // #207 + ticket 15: variant preview read-only; software version editable UNLESS collaborating
    fitEmbeds();
    refreshCanvasSelection();
    if (!view.ready) fitAll(); else applyView();
  }
  // PERF (James 2026-07-08): incremental single-page rebuild. Block-level edits (spacing,
  // align, columns, appearance…) only change ONE page, so rebuilding the WHOLE world — every
  // page's renderPage — is what made those edits + scroll-tune lag ~0.5s. This re-renders just
  // frame `i`'s content, mirroring the per-frame steps in buildWorld (renderPage + data-attrs +
  // layout vars + fold), then re-wires editing on that frame only. Doc-wide changes (header/
  // footer, nav, glossary, theme, page add/remove/reorder) still go through the full path.
  function reapplyPage(i) {
    var fd = frameDescs[i];
    if (!fd || isPreview()) { reapplyWorld(); return; } // variant/language preview renders clones -> full
    var renderDoc = currentDoc();
    var page = renderDoc.pages[i];
    if (!page) { reapplyWorld(); return; }
    var frame = fd.frame, deviceH = BREAKPOINTS[activeBp].h;
    var __restoreMedia = (window.resolveMedia && window.AssetStore) ? window.resolveMedia(renderDoc, editorAssetResolve) : null;
    try {
      frame.innerHTML = ""; // frame's own drop-target listeners live on the frame, not children — kept
      frame.style.backgroundColor = activeTheme().color.bg;
      var cr = window.renderPage(page, activeTheme(), window.resolveHeaderFooter(renderDoc, page));
      cr.setAttribute("data-bp", activeBp);
      cr.setAttribute("data-mode", activeModeNow());
      applyLayoutVars(cr, page);
      frame.appendChild(cr);
      var fold = h("div", "fold-line"); fold.style.top = deviceH + "px";
      fold.appendChild(h("span", "fold-line__label", cap(activeBp) + " fold · " + deviceH + "px"));
      frame.appendChild(fold);
      // frame.innerHTML="" above wiped any grid overlay — re-seed it on the active page
      if (i === currentPage && gridMode !== "off") frame.appendChild(makeGridOverlay());
    } finally { if (__restoreMedia) __restoreMedia(); }
    if (canvasEditable()) enableEditing(frame); // ticket 15: base-only editing while collaborating
    fitEmbedsIn(frame);
    drawConnectors();
    refreshCanvasSelection();
    decorateVariantVersionBadges(frame); // #148: re-add the version-cycle badge on this page's image blocks
    decorateStyleAudit(frame); // #145: re-mark unstyled text blocks on this page
    decorateSourceLinks(frame); // source-link 03: re-add the link indicator on this page's linked blocks
  }
  // Rebuild only the page a block lives on (falls back to full mount if it can't be located).
  function reapplyBlock(block) {
    var pi = findPageOfBlock(block);
    if (pi == null || pi < 0) { mount(); return; }
    reapplyPage(pi);
  }
  // PERF (James 2026-07-09): STRUCTURAL block edits on ONE page (delete / insert /
  // paste a block) previously ran a full mount() — which rebuilds EVERY page's DOM,
  // re-instantiating every HTML-interaction iframe + decoding every image across the
  // whole course, so on an embed/image-heavy course each one lagged ~1-2s. This is
  // mount() MINUS the all-pages rebuild: it re-renders just the affected page
  // (reapplyPage) then refreshes the cheap chrome (outliner / inspector / comment
  // pins — each sub-1ms) so the outliner + panel stay in sync. Falls back to a full
  // mount when the page can't be isolated (unknown page / multi-page edit / variant
  // preview). Non-structural appearance edits use reapplyBlock (no chrome refresh).
  function reapplyStructural(pi) {
    var list = Array.isArray(pi) ? pi : [pi];
    var ok = list.length && list.every(function (i) { return i != null && i >= 0 && i < doc.pages.length; });
    if (!ok || isPreview()) { mount(); return; } // can't isolate (unknown / multi-page / variant / language) -> full rebuild
    list.forEach(function (i) {
      reapplyPage(i);
      // reapplyPage rebuilds only the page CONTENT (fd.frame); the sibling frame-label
      // carries the DERIVED page name (first line of copy), which a structural edit can
      // change — refresh it so the canvas label doesn't lag until the next full mount.
      var fd = frameDescs[i];
      if (fd && fd.frame && fd.frame.parentNode) {
        var nm = fd.frame.parentNode.querySelector(".frame-label__name");
        if (nm && doc.pages[i]) nm.textContent = pageDisplayName(doc.pages[i], doc);
      }
    });
    renderStructure();
    renderModelView();
    renderCommentPins();
    if (interactModeOn()) decorateInteractHandle();
    decorateVariantVersionBadges(); // #148: on-canvas version-cycle badge on image blocks with variant versions
    decorateStyleAudit(); // #145: mark unstyled text blocks when the audit toggle is on
    decorateSourceLinks(); // source-link 03: link indicator on placed source-linked blocks
  }
  window.__reapplyPage = reapplyPage; // perf/test hook
  window.__perf = { // perf-measurement hooks (harmless; used to profile the re-render paths)
    mount: function () { mount(); },
    reapplyPage: function (i) { reapplyPage(i); },
    reapplyStructural: function (i) { reapplyStructural(i); },
    renderStructure: function () { renderStructure(); },
    renderModelView: function () { renderModelView(); },
    renderAssets: function () { renderAssets(); },
    buildWorld: function () { canvas.innerHTML = ""; buildWorld(); attachWorld(); },
    enableEditing: function () { enableEditing(world); },
    fitEmbeds: function () { fitEmbeds(); }
  };
  // PERF (James 2026-07-08): header/footer padding + logo size are inline styles on the
  // .course-header/.course-footer elements (render.js applyHeaderFooterBox), so a numeric
  // edit can poke them LIVE on every frame instead of rebuilding the whole world — which is
  // what made footer scroll-tune unusable. Returns false (→ caller does a full rebuild) if it
  // can't identify the edge or nothing is on canvas yet.
  function pokeHeaderFooterLive(cfg, key) {
    var hf = doc.headerFooter || {};
    var sel = (cfg === hf.header) ? ".course-header" : (cfg === hf.footer) ? ".course-footer" : null;
    if (!sel) return false;
    var els = canvas.querySelectorAll(sel);
    if (!els.length) return false;
    Array.prototype.forEach.call(els, function (root) {
      if (key === "padX") { root.style.paddingLeft = cfg.padX == null ? "" : cfg.padX + "px"; root.style.paddingRight = cfg.padX == null ? "" : cfg.padX + "px"; }
      else if (key === "padY") { root.style.paddingTop = cfg.padY == null ? "" : cfg.padY + "px"; root.style.paddingBottom = cfg.padY == null ? "" : cfg.padY + "px"; }
      else if (key === "logoSize") { var img = root.querySelector(".course-header__img, .course-footer__img"); if (img) img.style.height = (cfg.logoSize || 30) + "px"; }
    });
    return true;
  }
  function reapplyHeaderFooter() { reapplyWorld(); }
  function reapplyLayout() { reapplyWorld(); }

  // ---- configurable canvas background (persisted) --------------------------
  var BG_KEY = "authoring.canvasBg";
  var BG_DEFAULT = "#2d2d2d";
  var canvasBg = BG_DEFAULT;
  function applyCanvasBg(hex) {
    canvasBg = hex;
    canvas.style.backgroundColor = hex; // dot grid lives in background-image, preserved
    try { localStorage.setItem(BG_KEY, hex); } catch (e) {}
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- view (pan/zoom) -----------------------------------------------------
  var VIEW_KEY = "authoring.view";
  var view = { x: 0, y: 0, zoom: 1, ready: false };
  // Restore the last pan/zoom so a refresh keeps you where you were (ready=true
  // makes mount() skip its one-time fitAll).
  (function loadView() {
    try {
      var s = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
      if (s && isFinite(s.x) && isFinite(s.y) && isFinite(s.zoom) && s.zoom > 0) {
        view.x = s.x; view.y = s.y; view.zoom = s.zoom; view.ready = true;
      }
    } catch (e) {}
  })();
  var _viewSaveT = null;
  function persistView() {
    if (_viewSaveT) clearTimeout(_viewSaveT);
    _viewSaveT = setTimeout(function () {
      try { localStorage.setItem(VIEW_KEY, JSON.stringify({ x: view.x, y: view.y, zoom: view.zoom })); } catch (e) {}
    }, 250);
  }
  var world = null;
  var worldH = FRAME_H;        // measured max frame height (frames are full content length)
  var frameDescs = [];         // { wrap, frame, i } per page
  var currentPage = 0;         // for demo mode entry

  // ---- alignment-grid overlay (editor chrome ONLY — never rendered/exported) ----
  // A cycling visual grid on the ACTIVE page's .frame to eyeball-align content
  // (like the fold-line + column-resize handles: a translucent, pointer-events:none
  // layer inside the frame, so it rides the world's zoom transform automatically).
  // The choice is a VIEW pref (localStorage), NOT doc data — nothing ships in SCORM.
  var GRID_KEY = "authoring.gridMode";
  var GRID_MODES = CV.GRID_MODES, GRID_LABELS = CV.GRID_LABELS;
  var gridMode = "off";
  try { gridMode = CV.readGridMode(localStorage.getItem(GRID_KEY)); } catch (e) {}
  function makeGridOverlay() {
    var g = h("div", "grid-overlay grid-overlay--" + gridMode);
    g.setAttribute("aria-hidden", "true");
    return g;
  }
  // Re-place the overlay on the active frame (removes any stale ones first). Called
  // on toggle + active-page change; the frame-build loop also seeds it on full mount.
  function refreshGridOverlay() {
    if (!canvas) return;
    Array.prototype.forEach.call(canvas.querySelectorAll(".grid-overlay"), function (n) { n.parentNode && n.parentNode.removeChild(n); });
    if (gridMode === "off") return;
    var fd = frameDescs && frameDescs[currentPage];
    if (fd && fd.frame) fd.frame.appendChild(makeGridOverlay());
  }
  function updateGridBtn() {
    var b = document.getElementById("grid-toggle");
    if (!b) return;
    b.classList.toggle("is-active", gridMode !== "off");
    b.title = "Alignment grid (" + GRID_LABELS[gridMode] + ")";
  }
  function cycleGrid() {
    gridMode = CV.nextGridMode(gridMode);
    try { localStorage.setItem(GRID_KEY, gridMode); } catch (e) {}
    updateGridBtn();
    refreshGridOverlay();
  }
  // #145 fallback indicator: an editor-only "not styled to a theme role" audit. A toggle
  // draws a red box around every text block with no (resolvable) styleRef and shows a live
  // count. Verso UI ONLY — a class on the live canvas node, never in render()/doc/export.
  var STYLE_AUDIT_KEY = "authoring.styleAudit";
  var styleAuditOn = false;
  try { styleAuditOn = localStorage.getItem(STYLE_AUDIT_KEY) === "1"; } catch (e) {}
  function styleAuditCount() {
    var n = 0;
    (doc.pages || []).forEach(function (p) { walkTextBlocks(p.blocks, function (b) { if (isUnstyledText(b)) n++; }); });
    return n;
  }
  function updateStyleAuditBtn() {
    var b = document.getElementById("style-audit-toggle");
    if (!b) return;
    b.classList.toggle("is-active", styleAuditOn);
    var n = styleAuditOn ? styleAuditCount() : 0;
    b.setAttribute("data-count", n ? String(n) : "");
    b.title = styleAuditOn
      ? (n ? n + " text block" + (n === 1 ? "" : "s") + " not styled to a theme role" : "All text blocks are styled to a role")
      : "Highlight text blocks with no theme style";
  }
  function decorateStyleAudit(scope) {
    var root = scope || canvas;
    if (!root) { updateStyleAuditBtn(); return; }
    Array.prototype.forEach.call(root.querySelectorAll(".is-unstyled-audit"), function (n) { n.classList.remove("is-unstyled-audit"); });
    if (styleAuditOn) {
      Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (node) {
        if (isUnstyledText(node.__block)) node.classList.add("is-unstyled-audit");
      });
    }
    updateStyleAuditBtn();
  }
  function toggleStyleAudit() {
    styleAuditOn = !styleAuditOn;
    try { localStorage.setItem(STYLE_AUDIT_KEY, styleAuditOn ? "1" : "0"); } catch (e) {}
    decorateStyleAudit();
  }
  // ---- the canvas view region -> src/editor/canvas-view.js (arch-P3b-02) ---
  // The transform write, the eased + compositor zoom, native-scroll pan, the WKWebView snapshot
  // proxy and the fit/focus drivers all live in the module now, beside the maths P3-07 moved
  // there. What stayed here is the state they read -- view, world, currentPage, frameDescs,
  // framePos, the frame geometry -- because roughly 250 other lines in this file read the same
  // things. These are the entry points, bound before the module installs, so every call site
  // below is unchanged.
  var applyView = VE.bind("applyView");
  var markNavigating = VE.bind("markNavigating");
  var attachWorld = VE.bind("attachWorld");
  var nativeScroll = VE.bind("nativeScroll");   // the NATIVE_SCROLL flag, as a read
  var worldW = VE.bind("worldW");
  var fitAll = VE.bind("fitAll");
  var fitToRect = VE.bind("fitToRect");
  var fitChapter = VE.bind("fitChapter");
  var fitCycle = VE.bind("fitCycle");
  var fitWorldRect = VE.bind("fitWorldRect");
  var focusFrame = VE.bind("focusFrame");
  var wheelZoom = VE.bind("wheelZoom");
  var zoomIn = VE.bind("zoomIn");
  var zoomOut = VE.bind("zoomOut");
  var zoomTo100 = VE.bind("zoomTo100");
  var panBy = VE.bind("panBy");
  var panDrag = VE.bind("panDrag");

  // ---- model write path ----------------------------------------------------
  // #207: capture an inline edit into base.versionOverrides[version][field], DIFFED against the
  // base value (equal => the override is pruned, so a version only stores real deltas). Empty
  // maps are pruned so the doc stays clean and resolveVersion returns same-ref where untouched.
  function setVersionOverrideField(baseNode, version, field, value) {
    var baseVal = baseNode[field];
    if (value === baseVal) {
      if (baseNode.versionOverrides && baseNode.versionOverrides[version]) {
        delete baseNode.versionOverrides[version][field];
        if (!Object.keys(baseNode.versionOverrides[version]).length) delete baseNode.versionOverrides[version];
        if (!Object.keys(baseNode.versionOverrides).length) delete baseNode.versionOverrides;
      }
      return;
    }
    baseNode.versionOverrides = baseNode.versionOverrides || {};
    (baseNode.versionOverrides[version] || (baseNode.versionOverrides[version] = {}))[field] = value;
  }
  function writeModel(node, value) { // MMMM: strip invisible chars + editor chrome (drag handle / pasted-block outline) on commit
    var obj = node.__bind.obj, field = node.__bind.field;
    value = sanitizeText(sanitizeFieldHtml(value));
    // In an editable software version, the bound obj is a display clone carrying __vbase — write
    // the edit into that base node's versionOverrides (never mutating base by same-ref). Base
    // editing (no __vbase) writes the field directly, exactly as before.
    if (versionEditable() && obj && obj.__vbase) setVersionOverrideField(obj.__vbase, activeVersion, field, value);
    else obj[field] = value;
    renderModelView(); scheduleSave();
  }
  // FFF perf: the live-model panel is collapsed by default, so skip the whole-doc
  // JSON.stringify on every keystroke unless it's actually open; when open, coalesce
  // a burst of edits into one stringify (~5/s) instead of one per keystroke.
  var modelViewT = null;
  function paintModelView() { if (modelJson && modelDetails && modelDetails.open) modelJson.textContent = JSON.stringify(doc, null, 2); }
  function renderModelView() {
    if (!modelJson || !(modelDetails && modelDetails.open)) return;
    if (modelViewT) return;
    modelViewT = setTimeout(function () { modelViewT = null; paintModelView(); }, 200);
  }
  if (modelDetails) modelDetails.addEventListener("toggle", function () { if (modelDetails.open) paintModelView(); }); // refresh on open
  // uio-E-C05 (EDIT-10): the live JSON document model is a DEBUGGING affordance, not everyday
  // authoring chrome. It is hidden unless the "Developer tools" system setting is on (off by
  // default), so authors scrolling for a property never land on it.
  function devToolsOn() { try { return localStorage.getItem("authoring.devtools") === "on"; } catch (e) { return false; } }
  function applyDevToolsVisibility() {
    if (!modelDetails) return;
    var on = devToolsOn();
    modelDetails.hidden = !on;
    if (!on) modelDetails.open = false; // collapse when hidden so re-enabling starts closed
  }
  function setDevToolsEnabled(on) {
    try { localStorage.setItem("authoring.devtools", on ? "on" : "off"); } catch (e) {}
    applyDevToolsVisibility();
    if (on) paintModelView();
  }
  applyDevToolsVisibility(); // enforce the default-off state at boot

  // ---- selection state -----------------------------------------------------
  var selection = { type: "none", node: null };
  var selectedCard = null;
  var panelFields = {};
  // §74 progressive drill-in selection: `drill.levels` = outermost->innermost
  // selectable levels resolved at the last click point; `drill.index` = the level
  // currently selected. `applyingDrill` guards setSelection from wiping the chain
  // while the drill IS the thing driving the selection. Any OTHER selection path
  // (outliner, marquee, delete, programmatic) resets the chain so the next canvas
  // click re-drills from the top.
  var drill = SEL.emptyDrill();
  var applyingDrill = false;
  // SPEC-ui-kit ticket 5: the block currently ENTERED to its Content level (null =
  // every block is at Block level). Selecting a different block/nothing exits it.
  var enteredBlock = null;
  // The block types with a Content level you can ENTER (double-click / Edit contents).
  // Text blocks edit inline (their own dblclick); content-less blocks (spacer/divider/
  // columns/componentGrid/checkbox) have no Content level.
  var TWO_LEVEL_TYPES = SEL.TWO_LEVEL_TYPES;
  // Double-click a block on the canvas to enter its Content level (the gesture James
  // expects, alongside the "Edit contents" button + the breadcrumb to pop back out).
  if (canvas) canvas.addEventListener("dblclick", function (e) {
    var bn = e.target.closest && e.target.closest(".canvas-block, [data-embed]");
    if (!bn || !bn.__block || !TWO_LEVEL_TYPES[bn.__block.type]) return;
    enteredBlock = bn.__block;
    setSelection(bn.__block.type === "htmlEmbed" || bn.__block.type === "webEmbed" ? "embed" : "block", bn);
  });
  function resetDrill() { drill = SEL.emptyDrill(); }

  function setSelection(type, node) {
    if (SEL.resetsDrill(applyingDrill)) resetDrill(); // a non-drill selection restarts the drill chain
    Array.prototype.forEach.call(document.querySelectorAll("[data-embed].is-interactive"), function (e) { e.classList.remove("is-interactive"); });
    if (selectedCard) { selectedCard.classList.remove("is-selected"); selectedCard = null; }
    
    // node is a DOM node for element selections but the PAGE INDEX (an int) for a
    // "page" selection -- so use != null, not truthiness, or page 0 collapses to null
    // and renderPageInspector(null) throws (doc.pages[null].id).
    selection = SEL.shape(type, node);

    // BB: keep the active page in sync with a direct canvas selection so demo/
    // preview and "insert into focused page" target the page you're working on.
    // currentPage was previously only moved by frame-label/outliner clicks + page
    // add, never by selecting a component/text/embed on the canvas. findPageOfBlock
    // also resolves nested blocks (columns children).
    if (selection.block) {
      var __selPi = findPageOfBlock(selection.block);
      if (__selPi >= 0) setActivePage(__selPi);
    }

    // SPEC-ui-kit ticket 5: a selection that isn't the entered block exits Content level.
    if (SEL.exitsEnteredBlock(enteredBlock, selection.block)) enteredBlock = null;

    if (SEL.marksCard(type)) {
      selectedCard = node;
      node.classList.add("is-selected");
    }
    renderInspector();
    refreshCanvasSelection();
    syncStructureToSelection();
  }
  function clearSelection() { setSelection("none", null); }
  // RR: reflect a canvas selection in the Structure outliner (was one-way,
  // outliner -> canvas only). Expand any collapsed container ancestors of the
  // selected block, rebuild the tree so its row shows selected, scroll it in.
  function containerAncestors(target) {
    var found = null;
    function walk(blocks, chain) {
      for (var i = 0; i < (blocks || []).length && !found; i++) {
        var b = blocks[i];
        if (b === target) { found = chain.slice(); return; }
        if (b.children) walk(b.children, chain.concat(b));
        if (!found && b.columns) for (var c = 0; c < b.columns.length && !found; c++) walk(b.columns[c], chain.concat(b));
      }
    }
    (doc.pages || []).forEach(function (p) { if (!found && p) walk(p.blocks, []); });
    return found || [];
  }
  function syncStructureToSelection() {
    if (typeof renderStructure !== "function") return;
    if (selection.block) containerAncestors(selection.block).forEach(function (c) { openContainersSet().add(c); });
    renderStructure();
    var sel = document.querySelector("#tab-structure .tree-block.is-selected");
    // Fall back to the active PAGE row when no block is selected (page / empty-page
    // selection highlights .tree-page__name.is-active, which the block query misses).
    if (!sel) sel = document.querySelector("#tab-structure .tree-page__name.is-active");
    if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }

  function restoreSelection() {
    if (selection.type === "none") {
      renderInspector();
      return;
    }
    
    var foundNode = null;
    if (selection.type === "page") {
      renderInspector();
      return;
    }
    
    if (selection.block) {
      var nodes = world.querySelectorAll(".canvas-block, [data-instance], [data-embed]");
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.__block === selection.block) {
          if (selection.type === "block" || selection.type === "embed") {
            foundNode = n;
            break;
          } else if (selection.type === "instance" && n.__instance === selection.instance) {
            foundNode = n;
            break;
          } else if (selection.type === "field") {
            var editNode = n.querySelector('[data-edit="' + selection.field + '"]') || (n.getAttribute("data-edit") === selection.field ? n : null);
            if (editNode) {
              foundNode = editNode;
              break;
            }
          }
        }
      }
    }
    
    if (foundNode) {
      selection.node = foundNode;
      selectedCard = foundNode;
      foundNode.classList.add("is-selected");
      renderInspector();
    } else {
      clearSelection();
    }
  }

  /* @merge-text-start */
  // Block types that carry an author-editable rich TEXT field + support a named styleRef.
  var TEXT_STYLE_TYPES = { heading: 1, subheading: 1, paragraph: 1, quote: 1, list: 1, note: 1 };
  // #131 merge gate: a set of blocks is mergeable iff it holds >=2 blocks and EVERY one
  // is a text-style type (heading/subheading/paragraph/quote/list/note). Pure predicate.
  function canMergeTextBoxes(blocks) {
    if (!blocks || blocks.length < 2) return false;
    return blocks.every(function (b) { return b && TEXT_STYLE_TYPES[b.type]; });
  }
  // #131 merge join: fold several stacked text bodies into ONE field, separated by a
  // blank line. Rich text is inline HTML (innerHTML-bound, see render.js `editable`), so
  // #143 uses a DOUBLE <br> (a blank line) between what were separate boxes; empty bodies
  // are dropped so a blank block adds no stray break. Pure fn -> render.js round-trips it.
  function mergeTextValues(texts) {
    return (texts || [])
      .map(function (t) { return t == null ? "" : String(t); })
      .filter(function (t) { return t !== ""; })
      .join("<br><br>");
  }
  /* @merge-text-end */
  // Apply a saved style to ONE block's data model (mount() re-renders). Mirrors the single
  // field-inspector apply: reference the named style, clear per-block overrides, and strip
  // inline colour so the style colour wins (WWW). stripStyledColorsDeep skips html/svg/src.
  function applyStyleToBlock(block, styleName) {
    block.styleRef = styleName;
    block.style = {};
    stripStyledColorsDeep(block);
  }
  // ---- #145: text-role auto-styling (type -> named style) ------------------
  // The predictable mapping James applies by hand after a CSV/schema import
  // (heading->Heading 1, paragraph->Body 1, note->Warnings, ...). styleRef is a LIVE
  // reference resolved at render (resolveBlockStyle), so linking a block to its role
  // style once means editing that named style later repaints every linked block. Pure
  // doc data — nothing here leaks into render(); editor == export.
  function getTextRoles() {
    if (!doc.textRoles) doc.textRoles = clone(window.TEXT_ROLES || {});
    return doc.textRoles;
  }
  // The role style NAME for a block type, but only if that named style actually exists
  // in the doc's style store — an unresolved role (e.g. note->"Warnings" with no such
  // style) returns null so the block is left unstyled (and flagged by the audit).
  function roleStyleFor(type) {
    var name = getTextRoles()[type];
    return (name && getTextStyles()[name]) ? name : null;
  }
  // A text block counts as "not styled to a theme role" when it carries no styleRef
  // (or a dangling one). Drives both the auto-stamp skip and the audit indicator.
  function isUnstyledText(block) {
    if (!block || !TEXT_STYLE_TYPES[block.type]) return false;
    return !(block.styleRef && getTextStyles()[block.styleRef]);
  }
  // Deep-walk a block subtree's text-bearing descendants (mirrors render.js walkBlocks:
  // children / columns / items.children+front / hotspot cards). componentGrid instances
  // are slot-based, not styleRef blocks, so they're skipped.
  function walkTextBlocks(blocks, fn) {
    (blocks || []).forEach(function (b) {
      if (!b || typeof b !== "object") return;
      fn(b);
      if (Array.isArray(b.children)) walkTextBlocks(b.children, fn);
      if (Array.isArray(b.columns)) b.columns.forEach(function (col) { walkTextBlocks(col, fn); });
      if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (Array.isArray(it.children)) walkTextBlocks(it.children, fn); if (Array.isArray(it.front)) walkTextBlocks(it.front, fn); });
      // #215: screens[].markers[].blocks — inlined so the tests' walkTextBlocks slice stays standalone
      if (Array.isArray(b.screens)) b.screens.forEach(function (s) { if (s && Array.isArray(s.markers)) s.markers.forEach(function (m) { if (m && Array.isArray(m.blocks)) walkTextBlocks(m.blocks, fn); }); });
    });
  }
  // #21: a library instance's text-field OVERRIDES, keyed to a master text block's
  // STABLE id (#19). v1 scope (grilled with James): text-only leaf overrides, edited via
  // an Inspector field list (not inline canvas editing — keeps the #20 opacity guard
  // untouched). PURE (DOM-free) so tests/run.js can exercise the reconcile rule headlessly.
  /* @overrides-start */
  // Every overridable text field currently on a master, keyed by the master's stable id.
  function collectOverridableTextFields(template) {
    var out = [];
    walkTextBlocks([template], function (b) { if (b && typeof b.id === "string" && TEXT_STYLE_TYPES[b.type]) out.push({ id: b.id, type: b.type, text: b.text || "" }); });
    return out;
  }
  // The reconciliation rule (#21 acceptance): an override survives ("living") only while
  // its field id still exists on the CURRENT master; one whose field was removed is
  // "dropped" (returned so the caller can prune + surface it to the author). Reordering
  // never drops anything — overrides key to a stable id, never a position.
  function reconcileOverrides(template, overrides) {
    var fieldIds = {};
    collectOverridableTextFields(template).forEach(function (f) { fieldIds[f.id] = true; });
    var living = {}, dropped = [];
    Object.keys(overrides || {}).forEach(function (id) {
      if (fieldIds[id]) living[id] = overrides[id]; else dropped.push(id);
    });
    return { living: living, dropped: dropped };
  }
  // #22: page-master twins of the two functions above. A page master's content is an
  // ARRAY of top-level blocks (def.template.blocks), not one node with .children -- so
  // these call walkTextBlocks directly on that array instead of wrapping a single node.
  // Otherwise identical rules (same reconciliation semantics across the whole region).
  function collectPageOverridableTextFields(pageBlocks) {
    var out = [];
    walkTextBlocks(pageBlocks || [], function (b) { if (b && typeof b.id === "string" && TEXT_STYLE_TYPES[b.type]) out.push({ id: b.id, type: b.type, text: b.text || "" }); });
    return out;
  }
  function reconcilePageOverrides(pageBlocks, overrides) {
    var fieldIds = {};
    collectPageOverridableTextFields(pageBlocks).forEach(function (f) { fieldIds[f.id] = true; });
    var living = {}, dropped = [];
    Object.keys(overrides || {}).forEach(function (id) {
      if (fieldIds[id]) living[id] = overrides[id]; else dropped.push(id);
    });
    return { living: living, dropped: dropped };
  }
  /* @overrides-end */
  window.__reconcileOverrides = reconcileOverrides; // test hook
  window.__collectOverridableTextFields = collectOverridableTextFields; // test hook
  // Stamp the role style onto ONE block subtree (auto-link on create/drop). Only fills
  // UNSTYLED text blocks (never clobbers a manual styleRef); skips a type whose role is
  // unset/unresolved. Returns the count stamped.
  function stampRoleStyle(rootBlock) {
    var n = 0;
    walkTextBlocks([rootBlock], function (b) {
      if (!isUnstyledText(b)) return;
      var role = roleStyleFor(b.type);
      if (role) { applyStyleToBlock(b, role); n++; }
    });
    return n;
  }
  // Bulk: link every UNSTYLED text block in the doc to its type's role style. The
  // one-click "apply theme text styles by type" + the auto-pass after a schema import.
  // Pure over the doc (mutates in place); caller refreshes render.
  function applyTextRolesByType() {
    var n = 0;
    (doc.pages || []).forEach(function (p) {
      walkTextBlocks(p.blocks, function (b) {
        if (!isUnstyledText(b)) return;
        var role = roleStyleFor(b.type);
        if (role) { applyStyleToBlock(b, role); n++; }
      });
    });
    return n;
  }
  // Multi-selection (>=2) batch inspector: apply a text style / colour / alignment to EVERY
  // selected text block at once (the payoff of cross-scope multi-select). Non-text blocks in
  // the selection are ignored. (§105)
  function renderMultiInspector() {
    var textBlocks = multiSel.filter(function (b) { return TEXT_STYLE_TYPES[b.type]; });
    var head = h("div", "prop-component");
    head.appendChild(h("span", null, multiSel.length + " items selected"));
    inspector.appendChild(head);
    if (!textBlocks.length) {
      inspector.appendChild(h("div", "insp-hint", "No text blocks in the selection. Delete or group it from the right-click menu."));
      return;
    }
    function batch(mut) { pushHistory(); textBlocks.forEach(function (b) { mut(b); }); window.applyRenderContext({ docStyles: getTextStyles() }); mount(); }
    // #161: the batch text controls (style / colour / alignment) live in one canonical Type
    // section, matching the single-selection field inspector's Type grammar.
    beginSections();
    sectionGroup("Type", "Text — applies to all " + textBlocks.length + " text block" + (textBlocks.length > 1 ? "s" : ""), function (secBody) {
      var _ins = inspector; inspector = secBody;
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
      inspector.appendChild(cCol);
      // 3. Alignment
      var cAlign = h("div", null);
      segmentedIconLive("Align", [[Icon("align-left"), "left", "Left"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "right", "Right"]],
        function () { return false; },
        function (v) { batch(function (b) { b.style = b.style || {}; b.style.align = v; }); }, cAlign, true);
      inspector.appendChild(cAlign);
      } finally { inspector = _ins; }
    });
    endSections(inspector);
  }
  // ---- contextual inspector ------------------------------------------------
  // The section engine -> src/editor/inspector/sections.js (arch-P3b-03). THE section wrapper
  // (34 adopters), the two-level depth rule, the drag-reorder mode and the PanelLayout store all
  // live there now. What stayed here is what the region READS rather than owns: `inspector`, the
  // panel host this file swaps in and out as a render target at thirty-odd sites, and the
  // `_scopeTally` the inheritance tails push into from another banner entirely.
  var beginSections = VE.bind("beginSections");
  var sectionsBufferOpen = VE.bind("sectionsBufferOpen");
  var sectionGroup = VE.bind("sectionGroup");
  var endSections = VE.bind("endSections");
  var panelHasReorderableSections = VE.bind("panelHasReorderableSections");
  var mountPanelOverflow = VE.bind("mountPanelOverflow");
  var maybeRenderLayoutBar = VE.bind("maybeRenderLayoutBar");

  // What each row of the dispatch table (src/editor/inspector/dispatch.js) names. The table decides
  // WHICH panel and WHAT runs after it; these are the implementations, and a ratchet fails a name
  // with nothing behind it.
  var INSPECTOR_PANELS = {
    renderCommentList: function () { renderCommentList(); },              // §12 slice 3: panel = the comment list
    renderInteractInspector: function () { renderInteractInspector(); },
    renderMultiInspector: function () { renderMultiInspector(); },
    renderInstanceInspector: function () { renderInstanceInspector(selection.node); },
    renderFieldInspector: function () { renderFieldInspector(selection.node); },
    // SPEC-ui-kit ticket 8: two-level (#161: depth-pure content)
    renderEmbedPanel: function () {
      renderBlockTwoLevel(selection.node, selection.node.__block.type === "htmlEmbed" ? "HTML Interaction" : "Web Embed",
        CONTENT_PURE_DECL, renderEmbedInspector);
    },
    renderNavButtonInspector: function () { renderNavButtonInspector(selection.node); },
    renderPageInspector: function () { renderPageInspector(selection.node); },
    renderBlockInspector: function () { renderBlockInspector(selection.node); },
    renderDocumentInspector: function () { renderDocumentInspector(); }
  };
  var INSPECTOR_STEPS = {
    variantOverrides: function () { renderVariantOverrides(); },
    multiToolbar: function () { showMultiToolbar(); },
    layoutBar: function () { maybeRenderLayoutBar(); },                   // D3: only if this panel uses v2 sections
    settingsPanes: function () { refreshSettingsPanes(); },               // keep the ⚙ modal in sync if an in-modal control re-rendered
    versionGuard: function () { applyVersionEditGuard(); },               // #207 FIX 2
    // #221 tour builder: when the spatial board overlay is open, mirror every edit
    // (canvas drag, inspector change, undo) back onto the board + its re-hosted inspector.
    tourBoard: function () { if (typeof tourBoardIsOpen === "function" && tourBoardIsOpen()) syncTourBoard(); },
    scrollEdges: function () { wireScrollEdges(document.querySelector(".panel--right .panel-scroll")); } // uio-O-W1 (OVL-10)
  };
  function renderInspector() {
    var rule = window.VersoInspector.pick({
      kitMode: !!window.__KIT_MODE, commentMode: commentModeOn(), interactMode: interactModeOn(),
      multiSelCount: multiSel.length, selectionType: selection.type
    });
    if (!rule.render) return; // kit.html owns #inspector as a static gallery
    inspector.innerHTML = ""; panelFields = {};
    hideBlockToolbar(); // element inspectors re-show it via renderBlockActionsSection; page/document/none leave it hidden
    INSPECTOR_PANELS[rule.render]();
    rule.after.forEach(function (step) { INSPECTOR_STEPS[step](); });
  }
  // #207 FIX 2 (interaction-feel §3 "no dead controls"): while editing a NON-BASE software version,
  // per-version appearance/structure overrides are not captured yet, so an element inspector's block
  // controls would be present-but-inert (edits vanish on remount). Disable them with a reason instead.
  // The inline TEXT path (field inspector -> writeModel capture) DOES persist, so it stays live.
  function applyVersionEditGuard() {
    inspector.classList.remove("is-version-readonly-panel");
    var old = inspector.querySelector(":scope > .version-edit-notice"); if (old) old.remove();
    if (!versionEditable()) return;
    if (["block", "instance", "embed"].indexOf(selection.type) === -1) return; // field = the persisting text path; page/doc/none have no per-version surface
    inspector.classList.add("is-version-readonly-panel");
    var note = h("div", "version-edit-notice");
    var vname = String(activeVersion).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    note.innerHTML = "Editing <strong>" + vname + "</strong>. Text you edit on the canvas is saved to this version. Per-version appearance and structure are coming — those controls are disabled here.";
    inspector.insertBefore(note, inspector.firstChild);
  }
  // a page selected -> per-page headerFooter opt-outs
  function renderPageInspector(pi) {
    var page = doc.pages[pi];
    if (!page) return; // stale index (e.g. mid doc-switch): inspector already cleared by caller — no crash, no re-dispatch
    var head = h("div", "prop-component");
    head.appendChild(h("span", null, "Page")); head.appendChild(h("span", "insp-tag", page.id));
    inspector.appendChild(head);

    // #162: canonical section grammar. Organizational sections (Chapter, Header & Footer
    // on this page) are panelSection collapsibles appended directly; the taxonomy-mappable
    // sections (Interaction gate -> Behaviour, Side padding -> Layout) are sectionGroups
    // buffered + emitted in canonical PanelLayout order; Page actions is pinned last.
    // JJJJ: which chapter (canvas column) this page belongs to. Changing it moves
    // the page into that chapter's column (re-sorts pages column-major).
    var chs = doc.chapters || [];
    if (chs.length) {
      var chBody = panelSection(inspector, "Chapter");
      var chOpts = chs.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).map(function (c) { return [c.name || "Untitled", c.id]; });
      chOpts.push(["+ New chapter…", "__new"]);
      var _pi0 = inspector; inspector = chBody;
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
      } finally { inspector = _pi0; }
    }

    var hfBody = panelSection(inspector, "Header & Footer on this page");
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
      var _i = inspector; inspector = secBody;
      try {
      // uio-F03: was a tri-state picker with an explicit "Inherit course default" option —
      // the exact "unset" the spine forbids. Now the switch always shows what will ACTUALLY
      // apply on this page, and the tail says where that came from (or offers Reset).
      var gateRes = resolveScoped(gateScopeChain(page), "gateInteractions", { at: "page" });
      switchRow("Require interactions before Next", function () { return !!gateRes.value; },
        function (v) { page.gateInteractions = !!v; mount(); setSelection("page", pi); }, inspector, false,
        { inherit: { res: gateRes, format: onOffLabel, onReset: function () {
            pushHistory(); delete page.gateInteractions; mount(); setSelection("page", pi);
          } } });
      inspector.appendChild(h("div", "insp-hint", "Hold this page's Next until its interactions are done (hotspots, cards, sequences, accordions, quizzes, videos, checkboxes). With nothing set here the page follows the course switch in Header & Footer → Progression."));
      } finally { inspector = _i; }
    });

    sectionGroup("Layout", "Side padding (%)", function (secBody) {
      var _i = inspector; inspector = secBody;
      try {
      inspector.appendChild(h("div", "insp-hint", "Overrides the global side padding for this page, per screen size. Leave tablet/mobile blank to inherit the desktop value; leave all blank to inherit the course default."));
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
      inspector.appendChild(twoUp(
        pagePadX("padX", Icon("monitor"), "Desktop side padding", "inherit"),
        pagePadX("padXTablet", Icon("tablet"), "Tablet side padding", inheritPh)));
      inspector.appendChild(twoUp(
        pagePadX("padXMobile", Icon("smartphone"), "Mobile side padding", inheritPh),
        iconField(Icon("pad-y"), { value: page.padY == null ? "" : page.padY, unit: "px", title: "Vertical padding (top/bottom)", placeholder: "inherit", step: 2, min: 0, max: 300, datalist: "dl-gap",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete page.padY; else page.padY = n; mount(); setSelection("page", pi); } }).wrap));
      } finally { inspector = _i; }
    });
    endSections(inspector);

    // #22: page-master library section -- mirrors #20/#21's block-level instance
    // inspector (renderLibraryInstanceBody): live/linked hint + reconcile-on-open +
    // Overrides field list + Detach when this page IS an instance; a "Save page to
    // library" capture action when it isn't. panelSection (not sectionGroup) matches
    // the "Chapter"/"Header & Footer" organizational sections above, not the
    // taxonomy-mappable ones.
    var libSecBody = panelSection(inspector, "Library");
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
          saveRegistry(registry);
          libSecBody.appendChild(h("div", "insp-hint insp-hint--warn", prec.dropped.length + " override" + (prec.dropped.length === 1 ? "" : "s") +
            " dropped — the master no longer has " + (prec.dropped.length === 1 ? "that field" : "those fields") + "."));
        }
        var pfields = collectPageOverridableTextFields(pdef.template.blocks);
        if (pfields.length) {
          libSecBody.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Overrides"));
          var _pi1 = inspector; inspector = libSecBody;
          try {
            pfields.forEach(function (f) {
              var current = (page.overrides[f.id] && page.overrides[f.id].text) || "";
              fieldRow(f.type.charAt(0).toUpperCase() + f.type.slice(1), current, function (v) {
                if (v) page.overrides[f.id] = { text: v }; else delete page.overrides[f.id];
                saveRegistry(registry); mount(); setSelection("page", pi);
              }, f.text || "inherits from master");
            });
          } finally { inspector = _pi1; }
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

    var actBody = panelSection(inspector, "Page actions");
    var dupBtn = h("button", "prop-btn", "Duplicate page");
    dupBtn.addEventListener("click", function () {
      pushHistory();
      var copy = clone(page); copy.id = "page-" + Date.now();
      doc.pages.splice(pi + 1, 0, copy);
      currentPage = pi + 1;
      mount(); setActivePage(currentPage); setSelection("page", currentPage);
    });
    actBody.appendChild(dupBtn);
    var delBtn = h("button", "prop-btn prop-btn--danger", "Delete page");
    delBtn.style.marginTop = "6px";
    if (doc.pages.length <= 1) { delBtn.disabled = true; delBtn.title = "A course needs at least one page."; }
    delBtn.addEventListener("click", function () { deletePage(pi); });
    actBody.appendChild(delBtn);
  }

  // §10 design-consistency: labeledRow (pre-canonical text/number row) removed —
  // all call sites migrated to the canonical fieldRow / iconField.

  // re-render one embed's canvas node in place (after code/url change). The
  // inspector isn't rebuilt, so its focused field keeps focus.
  function reRenderBlockNode(node) {
    var fresh = window.renderOneBlock(node.__block);
    node.parentNode.replaceChild(fresh, node);
    wireEmbedNode(fresh);
    selectedCard = fresh; fresh.classList.add("is-selected"); selection.node = fresh;
    fitEmbeds();
    return fresh;
  }

  // arch-P3b-07y: the shared palette colour-row moved to editor/inspector/primitives.js, with the
  // rest of the canonical control set. Both palettes that place it -- the SVG image palette here,
  // the HTML-interaction palette in inspector/blocks.js -- read it from there now.
  var paletteColorRow = VE.bind("paletteColorRow");

  // arch-P3b-07x: the block-type -> panel table and the six panels it names (quiz, accordion,
  // sequence, card deck, card reveal, learner nav) plus the embed panel moved to
  // editor/inspector/blocks.js. What they delegate to -- the two-level shell, the text and image
  // content renderers, the shared colour row -- stayed here.
  var renderBlockInspector = VE.bind("renderBlockInspector");
  var renderEmbedInspector = VE.bind("renderEmbedInspector");

  // arch-P3b-07w: the verbs that change the shape of a course -- duplicate, clear, convert,
  // split, merge, move, for a block or a page -- moved to editor/structure-ops.js, with the
  // courseNav bookkeeping three of them run after the page list changes.
  var getBlockPageIndexAndIndex = VE.bind("getBlockPageIndexAndIndex");
  var getSelectionTypeForBlock = VE.bind("getSelectionTypeForBlock");
  var duplicateBlock = VE.bind("duplicateBlock");
  var clearBlockContent = VE.bind("clearBlockContent");
  var convertTextListBlockType = VE.bind("convertTextListBlockType");
  var clearBlockContentAction = VE.bind("clearBlockContentAction");
  var duplicatePage = VE.bind("duplicatePage");
  var savePageAsLibraryMaster = VE.bind("savePageAsLibraryMaster");
  var insertPageFromLibrary = VE.bind("insertPageFromLibrary");
  var detachPageLibraryInstance = VE.bind("detachPageLibraryInstance");
  var hasMergeableNext = VE.bind("hasMergeableNext");
  var mergePageWithNext = VE.bind("mergePageWithNext");
  var eachCourseNav = VE.bind("eachCourseNav");
  var footerCourseNav = VE.bind("footerCourseNav");
  var canSplitAtBlock = VE.bind("canSplitAtBlock");
  var splitPageAtBlock = VE.bind("splitPageAtBlock");
  var moveBlock = VE.bind("moveBlock");
  // Constants, read back from their owner right after it installs (see the bottom of this file).
  var TEXT_CONTENT_TYPES;

  // arch-P3b-07o: the universal panel tail every block inspector ends with -- appearance plus the
  // block actions -- and the canvas overlay bar that carries the same verbs moved to
  // editor/block-actions.js. It owns blockToolbarSep and provides it live from there.
  var renderBlockActionsSection = VE.bind("renderBlockActionsSection");
  var ensureBlockToolbar = VE.bind("ensureBlockToolbar");
  var hideBlockToolbar = VE.bind("hideBlockToolbar");
  var positionBlockToolbar = VE.bind("positionBlockToolbar");


  // ...continues in blocks.js (arch-P3b-07).


  // ---- image hotspots -> src/editor/hotspots-editor.js (arch-P3b-06) -------
  // The canvas overlay that places and reveals markers, the layer actions a selected hotspot
  // answers to, and renderHotspotInspector. The module OWNS hotspotEditId / hotspotEditScreenId
  // now -- P3b-04 had to borrow them from here as a get/set pair because the tour builder writes
  // them from 29 sites and this code had not moved yet. These are the accessors that replaced
  // the two variables at the four canvas sites that still reach for them.
  var renderHotspotInspector = VE.bind("renderHotspotInspector");
  var revealHotspot = VE.bind("revealHotspot");
  var findHotspot = VE.bind("findHotspot");
  var clampPct = VE.bind("clampPct");
  var hotspotEditId = VE.bind("hotspotEditId");
  var setHotspotEditId = VE.bind("setHotspotEditId");
  var hotspotEditScreenId = VE.bind("hotspotEditScreenId");
  var setHotspotEditScreenId = VE.bind("setHotspotEditScreenId");
  var blockAncestry = VE.bind("blockAncestry");
  var blockChromeHandlers = VE.bind("blockChromeHandlers");
  var blockChromeIo = VE.bind("blockChromeIo");
  var hotspotCardArrays = VE.bind("hotspotCardArrays");
  var hotspotEntryScreen = VE.bind("hotspotEntryScreen");
  var hotspotOwnerOf = VE.bind("hotspotOwnerOf");
  var hsCanvasCycle = VE.bind("hsCanvasCycle");
  var imageChromeIo = VE.bind("imageChromeIo");
  var keepHotspotCardOpen = VE.bind("keepHotspotCardOpen");
  var revealHotspotPopover = VE.bind("revealHotspotPopover");
  var screenIdOfMarker = VE.bind("screenIdOfMarker");
  var showEditScreen = VE.bind("showEditScreen");
  // The compact segmented layer breadcrumb at the top of the panel — Page 6 › Column 2
  // › Group 1 › Block, each crumb clickable to select that layer without the canvas.
  function renderLayerCrumbs(block, label) {
    var anc = blockAncestry(block);
    var trail = [];
    if (anc) {
      trail.push({ label: "Page " + (anc.pageIndex + 1), level: { kind: "page", i: anc.pageIndex } });
      anc.path.forEach(function (b, idx) {
        var last = idx === anc.path.length - 1;
        trail.push({ label: last ? label : blockLabel(b), level: last ? null : { kind: "block", block: b } });
      });
    } else { trail.push({ label: label, level: null }); }
    var bar = breadcrumb(inspector, trail, function (level) {
      if (!level) return;
      enteredBlock = null;
      if (level.kind === "page") { setActivePage(level.i); setSelection("page", level.i); }
      else if (level.kind === "block") { reselectBlockNode(level.block, "block"); }
    });
    // uio-O-W1 (OVL-14): the second door onto the block's verbs. Right-click is the only way
    // to reach Copy style / Save as component / Clear content, and nothing advertises it — so
    // the inspector header carries a "..." overflow opening the IDENTICAL menu (one definition,
    // blockMenuItems). Canonical ContextMenu surface, canonical more-horizontal glyph.
    if (bar && block) {
      var ov = h("button", "insp-crumbs__more"); ov.type = "button";
      ov.innerHTML = Icon("more-horizontal");
      ov.title = "Block actions";
      ov.setAttribute("aria-label", "Block actions");
      ov.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var r = ov.getBoundingClientRect();
        showContextMenu(r.right, r.bottom + 4, blockMenuItems({ block: block }));
      });
      bar.appendChild(ov);
    }
  }
  // SPEC-ui-kit (James, all-in-one): the universal chrome (Position/Layout/Appearance +
  // actions) is ALWAYS shown; double-clicking the block (or "Edit settings") reveals the
  // block-specific params BELOW it — one panel, not two views that replace.
  // uio-F04 (EDIT-06): a source-linked block used to say only "linked" (a badge on the canvas). It now
  // states the same facts every other stage states -- which source it came from, how many other
  // documents use that passage, and whether the source has moved since this document last went out.
  // Same resolver, same phrasing, same badge as the Publish row. uio-E-M03 adds the lock chip and the
  // Edit-in-Source jump on top of this line.
  function renderSourceLinkProvenance(block) {
    if (!block || !block.sourceLink || !block.sourceLink.masterId) return null;
    var masterId = block.sourceLink.masterId, markId = block.sourceLink.markId || null;
    var comps = (typeof libComponents === "function" && libComponents()) || {};
    var master = comps[masterId];
    var line = h("div", "insp-provenance");
    line.appendChild(h("span", "insp-provenance__label", "From source"));
    line.appendChild(h("span", "insp-provenance__name", (master && master.name) || "an unknown source document"));
    var used = f04WhereUsedFact(sourceLinkWhereUsed(masterId, markId));
    var ub = f04Badge(used, "insp-provenance__fact"); if (ub) line.appendChild(ub);
    var docFacts = f04DocFacts(activeDocId);
    if (docFacts && docFacts.drift.state === "drifted" && docFacts.drift.ids.indexOf(masterId) !== -1) {
      var db = f04Badge({ tone: "warning", label: "Source changed",
        title: "This source document has changed since “" + docFacts.title + "” was last published." }, "insp-provenance__fact");
      if (db) line.appendChild(db);
    }
    return line;
  }
  function renderBlockTwoLevel(node, label, decl, renderContent, io, handlers) {
    var block = node.__block;
    var atContent = (enteredBlock === block);
    renderLayerCrumbs(block, label);
    var prov = renderSourceLinkProvenance(block);
    if (prov) inspector.appendChild(prov);
    // #160: depth-pure content level (panel-ia §1). A block opts in via decl.pureContent —
    // at CONTENT level the visible container chrome (Position / Layout / Appearance) is
    // suppressed so the panel shows ONLY the content's own canonical sections; the Actions
    // footer stays wired (actions-only decl). Container chrome still renders at Block level.
    var chromeDecl = (atContent && decl && decl.pureContent) ? ACTIONS_ONLY_DECL : decl;
    renderContainerChrome(inspector, chromeDecl, io || blockChromeIo(block), handlers || blockChromeHandlers(block));
    if (atContent) {
      renderContent(node); // block-specific params, below the universal chrome
    } else {
      var enter = h("button", "prop-btn", "Edit " + (label || "block").toLowerCase() + " settings");
      enter.style.marginTop = "12px";
      enter.addEventListener("click", function () { enteredBlock = block; renderInspector(); });
      inspector.appendChild(enter);
    }
  }
  // Container decl for a block whose box only carries spacing + actions (an image /
  // timeline — no fill/stroke/radius/align/width/padding/gap).
  var BOX_ONLY_DECL = { align: false, valign: false, fill: false, stroke: false, radius: false };
  // Content blocks (hotspot/sequence/image/text/accordion/quiz/cardReveal/embed): the
  // box carries align + spacing + actions (no fill/stroke/radius); align is Block-level.
  var CONTENT_DECL = { fill: false, stroke: false, radius: false };
  // #88 image: like CONTENT_DECL (spacing + align + actions), but the box STROKE is
  // exposed so an applied border can be edited/removed. Fill + box-radius stay off
  // (the image has its own corner-radius control in renderImageContent).
  var IMAGE_DECL = { fill: false, stroke: true, radius: false };
  // #160: depth-pure variants (decl.pureContent) — the block opts its CONTENT level out of
  // the shared container chrome so it shows only its own canonical sections (panel-ia §1).
  // Same box decl as the base, plus the flag. Used by quiz / image / hotspot (scoped slice).
  var CONTENT_PURE_DECL = { fill: false, stroke: false, radius: false, pureContent: true };
  var IMAGE_PURE_DECL = { fill: false, stroke: true, radius: false, pureContent: true };
  // Actions-only decl: no visible sections (Position / Layout / Appearance all off), Actions
  // footer still wired. Swapped in at CONTENT level for a pureContent block.
  var ACTIONS_ONLY_DECL = { align: false, valign: false, width: false, padding: false, gap: false, spacing: false, fill: false, stroke: false, radius: false, actions: true };

  // SPEC-ui-kit ticket 7: content-less blocks (spacer, divider) have no inner content,
  // so no Content level — just a single-crumb breadcrumb (identity), the block's own
  // controls, and the invariant container chrome (spacing + actions).
  function renderContentlessBlock(node, label, renderBody) {
    // All-in-one: the block's own settings are the "specific" params, revealed below the
    // universal chrome on double-click / Edit settings (same model as every block).
    renderBlockTwoLevel(node, label, BOX_ONLY_DECL, function (n) { if (renderBody) renderBody(n); });
  }

  // SPEC-ui-kit ticket 8: columns layout (column gap / row gap / reset widths). Its
  // children live in the columns on the canvas (no Content panel) -> single-level.

  // SPEC-ui-kit ticket 8: componentGrid = grid layout (template/columns/gap/instances);
  // its instances live on the canvas (no Content panel) -> single-level.
  function renderComponentGridBody(node) {
    var block = node.__block;
    var _ins = inspector; inspector = panelSection(inspector, "Grid Layout");
    try {
      var comps = getComponents();
      var optComps = Object.keys(comps).map(function (k) { return [comps[k].name, k]; });
      selectRow("Component Template", optComps, block.component, function (v) {
        pushHistory();
        block.component = v;
        var freshDef = comps[v];
        block.instances = (block.instances || []).map(function (inst) {
          var slots = {};
          freshDef.slots.forEach(function (s) {
            slots[s.key] = (inst.slots && inst.slots[s.key]) || "";
          });
          return {
            status: inst.status || "incomplete",
            hidden: !!inst.hidden,
            detached: !!inst.detached,
            slots: slots
          };
        });
        mount();
        reselectBlockNode(block, "block");
      });
      
      fieldRow("Class name", block.className, function (v) {
        block.className = v;
        mount();
        reselectBlockNode(block, "block");
      });

      inspector.appendChild(twoUp(
        iconField(Icon("columns-2"), { value: block.columns, placeholder: "2", step: 1, min: 1, max: 12, datalist: "dl-columns", title: "Columns",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n) || n < 1) delete block.columns; else block.columns = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap,
        iconField(Icon("unfold-horizontal"), { value: block.gap, unit: "px", placeholder: "24", step: 2, min: 0, max: 120, datalist: "dl-gap", title: "Gap",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.gap; else block.gap = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap
      ));
      
      var def = resolveComponentDef(block.component); // incl. shared library
      if (def) {
        inspector.appendChild(propHeader("Grid instances", function () {
          pushHistory();
          var fresh = { status: "incomplete", slots: {} };
          def.slots.forEach(function (s) { fresh.slots[s.key] = ""; });
          fresh.slots[def.slots[0].key] = String(block.instances.length + 1).padStart(2, "0");
          fresh.slots[def.slots[1].key] = "New " + def.name;
          block.instances.push(fresh);
          mount();
          reselectBlockNode(block, "block");
        }, "Add " + def.name));
      }
    } finally { inspector = _ins; }
  }

  // #20/#21: a live-linked mirror of a shared library master, placed inline on the canvas
  // (distinct from componentGrid, whose instances live inside a grid of cards). Content-
  // less on the CANVAS by design -- the nested subtree stays non-interactive there
  // (editor.css's pointer-events guard), so structural edits always happen at the source
  // (the Component Library panel). #21 adds LOCAL leaf overrides on top of that: a text
  // field on the master can be overridden per-instance via the field list below (an
  // Inspector row per overridable field, not inline canvas editing -- keeps the opacity
  // guard untouched, see the ticket's grill). Reuses the SAME "prop-component
  // prop-component--instance" header componentGrid cards use for their own instance
  // inspector (renderInstanceInspector) -- the established "you're looking at an
  // instance of a shared def" visual language.
  function renderLibraryInstanceBody(node) {
    var block = node.__block;
    var def = resolveComponentDef(block.ref); // doc override -> shared library -> built-in
    var head = h("div", "prop-component prop-component--instance");
    head.appendChild(h("span", null, (def && def.name) || block.ref || "Library instance"));
    inspector.appendChild(head);
    inspector.appendChild(h("div", "insp-hint", def
      ? "Live library instance, linked to “" + (def.name || block.ref) + "”. Edit the master in Settings → System → Component Library and every placement updates automatically."
      : "This instance's library master (“" + block.ref + "”) no longer exists. Detach to keep this placement as an editable copy, or remove it."));

    // SPEC 7 two-way link: a block inserted from Source carries a sourceRef -- offer a jump back
    // to its exact source topic (the reverse of the Source panel's where-used row).
    if (block.sourceRef && block.sourceRef.topicId && window.VersoUI && window.VersoUI.Button) {
      inspector.appendChild(window.VersoUI.Button({
        variant: "secondary", icon: "link", label: "Open in Source",
        onClick: function () { jumpToSourceTopic(block.sourceRef.topicId); }
      }));
    }

    // Product Rail: a facet switcher, shown only when the master carries named facets
    // (never for docTypeRenderings -- that's export-time-only, structurally never a
    // picker here). Switching only changes what THIS placement resolves to; it never
    // touches the master or the link status, so there's no confirmation dialog.
    if (def && def.facets && typeof def.facets === "object") {
      var facetKeys = Object.keys(def.facets);
      if (facetKeys.length) {
        inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Facet"));
        var facetOpts = facetKeys.map(function (k) { return [(def.facets[k].name || k), k]; });
        var curFacet = (block.facet && def.facets[block.facet]) ? block.facet : facetKeys[0];
        var fSel = dsSelect(facetOpts, curFacet, function (v) {
          pushHistory();
          if (v) block.facet = v; else delete block.facet;
          saveRegistry(registry); mount(); reselectBlockNode(block, "block");
        });
        fSel.title = "Which facet of this topic this placement shows.";
        inspector.appendChild(fSel);
      }
    }

    if (def && def.template) {
      // #21 RECONCILE: prune + surface any override whose field the master no longer
      // has (a structural change since this override was set). Runs whenever the
      // instance's inspector opens -- the natural point an author would notice.
      var rec = reconcileOverrides(def.template, block.overrides || {});
      block.overrides = rec.living;
      if (rec.dropped.length) {
        saveRegistry(registry);
        inspector.appendChild(h("div", "insp-hint insp-hint--warn", rec.dropped.length + " override" + (rec.dropped.length === 1 ? "" : "s") +
          " dropped — the master no longer has " + (rec.dropped.length === 1 ? "that field" : "those fields") + "."));
      }
      var fields = collectOverridableTextFields(def.template);
      if (fields.length) {
        // A stacked label, not sub() -- the #163 conformance gate reserves raw sub() headers
        // for grandfathered debt; a stacked label is the canonical in-section grouping here
        // (same pattern "Add to library"'s "Course component" label already uses).
        inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Overrides"));
        fields.forEach(function (f) {
          var current = (block.overrides[f.id] && block.overrides[f.id].text) || "";
          fieldRow(f.type.charAt(0).toUpperCase() + f.type.slice(1), current, function (v) {
            if (v) block.overrides[f.id] = { text: v }; else delete block.overrides[f.id];
            saveRegistry(registry); mount(); reselectBlockNode(block, "block");
          }, f.text || "inherits from master");
        });
      }
    }

    var detachB = h("button", "prop-btn", "Detach"); detachB.style.marginTop = "6px";
    detachB.title = "Convert to an independent, editable copy — this placement stops receiving master updates.";
    detachB.disabled = !def || !(window.resolveFacetTemplate ? window.resolveFacetTemplate(def, block.facet) : def.template);
    detachB.addEventListener("click", function () { detachLibraryInstance(block); });
    inspector.appendChild(detachB);
  }
  // Convert a live mirror into an independent, editable copy, in place: the block's own
  // fields are replaced with a FRESH remint of the master's current template (#19: this
  // one DOES remint -- it is a NEW independent copy landing in the document, precisely
  // the case remintIds exists for, unlike the library-storage "preserve" sites above).
  // Overrides are BAKED IN as this copy's own content (what the author was actually
  // seeing), not reverted to the master's raw field values -- a silent revert-to-master
  // on detach would be a real footgun. The instance-level overrides map itself isn't
  // carried forward (a plain block has no such field); its VALUES are, as ordinary text.
  // Keeps a __linkedFrom breadcrumb so #21 RELINK (renderFrameOrGroupTwoLevel) can
  // re-attach it later.
  function detachLibraryInstance(block) {
    var def = resolveComponentDef(block.ref);
    // Product Rail: bake whatever facet this placement was actually pointing at (falls
    // back to def.template when the master carries no facets) -- the fork snapshots the
    // resolved facet+variant+token combo; there's no live pointer afterward.
    var facetTemplate = window.resolveFacetTemplate ? window.resolveFacetTemplate(def, block.facet) : (def && def.template);
    if (!def || !facetTemplate) return;
    pushHistory();
    var ref = block.ref;
    var withOverrides = clone(facetTemplate);
    // #23: bake the CURRENT axis content first (same "detach bakes what you see"
    // principle #21 established for instance overrides) -- axis resolves, THEN the
    // instance's own field overrides apply on top (most specific wins, matches the
    // resolve order render.js's BLOCKS.libraryInstance uses).
    if (window.resolveLibraryAxisContent) withOverrides = window.resolveLibraryAxisContent(withOverrides, window.__libraryAxisContext);
    // Bake in what the author was ACTUALLY seeing (overrides applied), not the master's
    // raw content -- a surprise revert-to-master on detach would be a real footgun.
    if (block.overrides && window.applyInstanceOverrides) window.applyInstanceOverrides(withOverrides, block.overrides);
    var fresh = remintIds(withOverrides);
    Object.keys(block).forEach(function (k) { delete block[k]; });
    Object.keys(fresh).forEach(function (k) { block[k] = fresh[k]; });
    block.__linkedFrom = ref;
    reapplyStructural(findPageOfBlock(block));
    reselectBlockNode(block, "block");
  }
  // #21 RELINK: the inverse of detach -- re-attach a (possibly since-edited) block back
  // to a library master. Replaces the block's fields with a fresh libraryInstance wrapper;
  // local edits made since detaching are NOT preserved as overrides (the ticket's relink
  // is "re-attach", not "diff and reconcile a detached copy's edits" -- that's a much
  // larger problem #21 didn't scope in, see the grill).
  function relinkToLibrary(block, ref) {
    pushHistory();
    Object.keys(block).forEach(function (k) { delete block[k]; });
    block.type = "libraryInstance";
    block.id = mintId();
    block.ref = ref;
    reapplyStructural(findPageOfBlock(block));
    reselectBlockNode(block, "block");
  }

  // SPEC-ui-kit ticket 8: checkbox = an acknowledgement (label edited on canvas +
  // a require-to-continue gate) -> single-level.
  function renderCheckboxBody(node) {
    var block = node.__block;
      // L: the checkbox previously fell through to the footer only. Give it a real
      // section — the label is edited on canvas, plus a self-contained acknowledgement
      // gate that reuses the shipped gate engine (GGGG): a required self-referencing
      // "checked" gate keeps the footer Next disabled until the learner ticks it.
      var _ins = inspector; inspector = panelSection(inspector, "Acknowledgement");
      try {
      inspector.appendChild(h("div", "insp-hint", "The checkbox label is edited on the canvas."));
      var isAckGate = !!(block.gate && block.gate.required && block.gate.when && block.gate.when.source === block.id && block.gate.when.is === "checked");
      switchRow("Require to continue", function () { return isAckGate; },
        function (v) {
          if (v) { ensureId(block); block.gate = { required: true, mode: "disable", when: { source: block.id, is: "checked" } }; }
          else if (block.gate && block.gate.when && block.gate.when.source === block.id && block.gate.when.is === "checked") { delete block.gate; } // only clear OUR ack gate
          reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
        });
      inspector.appendChild(h("div", "insp-hint", "On: the footer Next stays disabled until the learner ticks this box. Ships in the exported course."));
      } finally { inspector = _ins; }
  }
  function renderColumnsBody(node) {
    var block = node.__block;
      var _ins = inspector; inspector = panelSection(inspector, "Columns Layout");
      try {
      // Column gap = horizontal (between columns); Row gap = vertical (between
      // stacked blocks in a column). Row gap defaults to 0 so the blocks' own
      // Space top/bottom drive vertical spacing (GG); set it to add a uniform gap.
      inspector.appendChild(twoUp(
        iconField(Icon("unfold-horizontal"), { value: block.gap == null ? 24 : block.gap, unit: "px", placeholder: "24", step: 2, min: 0, max: 120, datalist: "dl-gap", title: "Column gap (horizontal)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.gap; else block.gap = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap,
        iconField(Icon("arrow-down-to-line"), { value: block.rowGap == null ? "" : block.rowGap, unit: "px", placeholder: "0", step: 2, min: 0, max: 120, datalist: "dl-gap", title: "Row gap (vertical, between stacked blocks)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.rowGap; else block.rowGap = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap
      ));
      // Custom widths are set by dragging the on-canvas gap handles. Offer a reset
      // back to equal split (drop colWidths -> render falls back to flex:1 each).
      if (block.colWidths) {
        var resetColW = h("button", "prop-btn", "Reset to equal widths");
        resetColW.addEventListener("click", function () {
          pushHistory(); delete block.colWidths; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
        });
        inspector.appendChild(resetColW);
      }
      inspector.appendChild(h("div", "insp-hint", "Blocks inside each column are edited on the canvas — click one to select it."));
      } finally { inspector = _ins; }
  }

  function renderSpacerBody(node) {
    var block = node.__block;
    inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Mode"));
    var mrow = h("div", "prop-toggle-row");
    [["fixed", false], ["auto", true]].forEach(function (o) {
      var b = h("button", "prop-toggle" + (!!block.auto === o[1] ? " is-on" : ""), o[0]);
      b.addEventListener("click", function () { pushHistory(); block.auto = o[1]; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
      mrow.appendChild(b);
    });
    inspector.appendChild(mrow);
    if (block.auto) {
      inspector.appendChild(h("div", "insp-hint", "Auto spacer springs to fill leftover vertical space. Put one above AND below a block to centre it on the page."));
    } else {
      inspector.appendChild(iconField("H", { value: block.height == null ? 40 : block.height, unit: "px", placeholder: "40", step: 2, min: 0, max: 600, datalist: "dl-gap", title: "Height",
        onchange: function (v) { var n = parseInt(v, 10); block.height = isNaN(n) ? 40 : n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap);
    }
  }
  // SPEC-ui-kit ticket 7: text block Content = the copy (a textarea mirror of the
  // on-canvas text). Styling (font/size/colour/align) is the deeper field inspector,
  // reached by double-clicking the text on the canvas. Box = spacing + actions.
  // #90: Table inspector — structure (rows/cols) + on-token style knobs. Cells edit on
  // the canvas (each is an editable() rich field); this panel owns everything else.
  function renderTableInspector(node) {
    var block = node.__block;
    block.rows = (block.rows && block.rows.length) ? block.rows : [[{ t: "" }]];
    block.align = block.align || [];
    function ncols() { return (block.rows[0] || []).length; }
    function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
    function newRow(n) { var r = []; for (var i = 0; i < n; i++) r.push({ t: "" }); return r; }

    var _tblRoot = inspector;
    inspector = panelSection(_tblRoot, "Table");
    switchRow("Header row", function () { return block.header !== false; }, function (v) { block.header = !!v; refresh(); });
    segmentedLive("Borders", [["All", "all"], ["Rows", "rows"], ["None", "none"]],
      function (v) { return (block.borders || "all") === v; },
      function (v) { block.borders = v; refresh(); });
    switchRow("Striped rows", function () { return !!block.zebra; }, function (v) { block.zebra = !!v; refresh(); });
    inspector.appendChild(iconField(Icon("padding"), { value: block.cellPad == null ? 10 : block.cellPad, unit: "px", placeholder: "10", step: 1, min: 0, max: 48, datalist: "dl-gap", title: "Cell padding",
      onchange: function (v) { var n = parseInt(v, 10); block.cellPad = isNaN(n) ? undefined : n; refresh(); } }).wrap);

    inspector = panelSection(_tblRoot, "Structure");
    inspector.appendChild(propHeader("Rows (" + block.rows.length + ")", function () { pushHistory(); block.rows.push(newRow(ncols())); refresh(); }, "Add row"));
    inspector.appendChild(propHeader("Columns (" + ncols() + ")", function () { pushHistory(); block.rows.forEach(function (r) { r.push({ t: "" }); }); refresh(); }, "Add column"));
    var rmRow = h("button", "prop-btn", "Remove last row"); rmRow.disabled = block.rows.length <= 1;
    rmRow.addEventListener("click", function () { if (block.rows.length > 1) { pushHistory(); block.rows.pop(); refresh(); } });
    var rmCol = h("button", "prop-btn", "Remove last column"); rmCol.disabled = ncols() <= 1;
    rmCol.addEventListener("click", function () { if (ncols() > 1) { pushHistory(); block.rows.forEach(function (r) { r.pop(); }); block.align = block.align.slice(0, ncols()); refresh(); } });
    rmRow.style.marginTop = "8px";
    inspector.appendChild(rmRow); inspector.appendChild(rmCol);

    inspector = panelSection(_tblRoot, "Column alignment");
    for (var ci = 0; ci < ncols(); ci++) {
      (function (i) {
        segmentedIconLive("Column " + (i + 1), [[Icon("align-left"), "left", "Left"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "right", "Right"]],
          function (v) { return (block.align[i] || "left") === v; },
          function (v) { block.align[i] = v; refresh(); });
      })(ci);
    }
    inspector = _tblRoot;
  }
  function renderTextContent(node) {
    var block = node.__block;
      var _ins = inspector; inspector = panelSection(inspector, "Content");
      var textIn = h("textarea", "prop-input");
      textIn.value = block.text || "";
      textIn.addEventListener("input", function () {
        block.text = textIn.value;
        var textNode = node.querySelector("[data-edit]") || node;
        if (textNode.getAttribute("data-rich")) {
          textNode.innerHTML = textIn.value;
        } else {
          textNode.textContent = textIn.value;
        }
        renderModelView();
      });
      inspector.appendChild(textIn);
      inspector.appendChild(h("div", "insp-hint", "Or edit on the canvas; double-click the text to style it (font, size, colour)."));
      inspector = _ins;
  }

  // SPEC-ui-kit ticket 7: image Content = the image + all its display params
  // (src/upload/alt/caption/zoom/size/fit/radius/light-dark/palette/per-mode). The
  // box itself only carries spacing + actions (BOX_ONLY_DECL), like a hotspot.
  // #148 (slice 1 — image block): per-variant image VERSIONS. A variant carries its OWN
  // image through the EXISTING pure override channel block.overrides[<variant>].src, which
  // render.js resolveVariant already bakes — so editor == export, and it coexists with the
  // per-asset variantVis hide. These are the authoring reads/writes; the model + export are
  // untouched. Whole-instance-capable (overrides[<variant>] can hold any field); this slice
  // surfaces the primary asset (src), the concrete need (swap an image/SVG per variant).
  function imgVariantSrc(block, variant) {
    var hf = imgVersionHost(block);
    if (!hf) return null;
    var o = hf.host.overrides && hf.host.overrides[variant];
    var v = o && o[hf.field];
    return (v != null && v !== "") ? v : null;
  }
  function setImgVariantSrc(block, variant, src) {
    var hf = imgVersionHost(block);
    if (!hf) return;
    var host = hf.host;
    host.overrides = host.overrides || {};
    var o = host.overrides[variant] || (host.overrides[variant] = {});
    if (src == null || src === "") delete o[hf.field]; else o[hf.field] = src;
    if (o && !Object.keys(o).length) delete host.overrides[variant];
    if (host.overrides && !Object.keys(host.overrides).length) delete host.overrides;
  }
  // #215: the base image lives at block.src for an image block but on the entry
  // Screen node (entry.visual) for a hotspot — one host/field resolver keeps the
  // whole #148 variant-version machinery working for both (resolveVariant applies
  // per-screen overrides via the render.js screens descent). Defined INSIDE the
  // imgVariantSrc..uploadImageVariant span so the tests' #148 slice stays evaluable.
  function imgVersionHost(block) {
    if (block && block.type === "hotspot") {
      var e = typeof hotspotEntryScreen === "function" ? hotspotEntryScreen(block) : null;
      return e ? { host: e, field: "visual" } : null;
    }
    return block ? { host: block, field: "src" } : null;
  }
  function baseImgSrc(block) {
    var hf = imgVersionHost(block);
    return hf ? hf.host[hf.field] : null;
  }
  function uploadImageVariant(block, variant, after) {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { pushHistory(); setImgVariantSrc(block, variant, assetRef(r.result, f)); if (after) after(); };
      r.readAsDataURL(f);
    });
    inp.click();
  }
  // The image inspector's "Variant versions" section: one row per variant to give it its
  // own image (upload/replace) or drop back to the flagship. Rendered only when the course
  // has variants AND the base image is set (a version is a swap OF the flagship image).
  function renderImageVariantVersions(block) {
    var names = variantNames();
    if (!names.length) return;
    var _ins = inspector; inspector = panelSection(inspector, "Variant versions");
    inspector.appendChild(h("div", "insp-hint", "Show a different image per product variant. The image above is the Flagship; a variant with its own version swaps to it at runtime and in the export."));
    // uio-O-W1 (OVL-06): the hint used to end with an instruction ("preview a variant from the
    // top-bar switcher"). Which variant is being previewed is owned by the top-bar switcher, so
    // this row shows the live value and opens that switcher.
    crossRefRow({
      label: "Previewing", value: activeVariant || "Flagship", linkLabel: "Variant switcher",
      title: "Open the top-bar variant switcher",
      onNavigate: function () { openVariantMenuAtSwitch(); }
    });
    names.forEach(function (V) {
      var own = imgVariantSrc(block, V);
      var row = h("div", "insp-inline-row");
      var lbl = h("div", null); lbl.style.flex = "1"; lbl.style.display = "flex"; lbl.style.flexDirection = "column"; lbl.style.gap = "1px"; lbl.style.minWidth = "0";
      var nm = h("span", null, V); nm.style.fontWeight = "600"; nm.style.fontSize = "11px";
      var stt = h("span", null, own ? "Own image" : "Inherits flagship"); stt.style.fontSize = "9px"; stt.style.color = own ? "var(--color-accent, #e08600)" : "var(--text-secondary)";
      lbl.appendChild(nm); lbl.appendChild(stt); row.appendChild(lbl);
      var upBtn = iconBtn("image-plus", own ? "Replace this variant's image" : "Add a variant version for " + V);
      upBtn.addEventListener("click", function () { uploadImageVariant(block, V, function () { reapplyBlock(block); reselectBlockNode(block, "block"); }); });
      row.appendChild(upBtn);
      if (own) {
        var rm = iconBtn("trash", "Remove this variant's image (inherit the flagship)", true);
        rm.addEventListener("click", function () { pushHistory(); setImgVariantSrc(block, V, null); reapplyBlock(block); reselectBlockNode(block, "block"); });
        row.appendChild(rm);
      }
      inspector.appendChild(row);
    });
    inspector = _ins;
  }

  // #148: on-canvas VERSION CYCLE. An image block that has >=1 variant version gets a
  // small overlay badge (top-right) so the author can SEE it carries iterations and cycle
  // through them (Flagship -> each variant with its own image) to preview each on the
  // block. Author-only: the preview is a transient <img>.src swap held in a WeakMap; it
  // NEVER mutates the doc and NEVER leaks into render() (mount rebuilds from the base doc,
  // then re-applies the swap). Skipped in variant/language preview (canvas is read-only).
  var imgVersionPreview = new WeakMap(); // block -> variant name currently previewed (absent = Flagship)
  // Blocks whose base image (block.src) can carry per-variant versions. #148 slice 1-2 =
  // image; slice 3 adds hotspot (its base image is also block.src, resolved by the same
  // pure resolveVariant). Keep this list as the single gate for all three UI surfaces.
  var IMG_VERSION_TYPES = { image: 1, hotspot: 1 };
  function hasImageVersions(block) {
    return !!(block && IMG_VERSION_TYPES[block.type] &&
      variantNames().some(function (v) { return imgVariantSrc(block, v); }));
  }
  function imageVersionList(block) { // [null=Flagship, ...variants that have their own image]
    return [null].concat(variantNames().filter(function (v) { return imgVariantSrc(block, v); }));
  }
  function resolveDisplaySrc(raw) {
    if (typeof raw === "string" && raw.indexOf("asset:") === 0 && window.AssetStore) {
      var u = window.AssetStore.url(raw.slice(6)); if (u) return u;
    }
    return raw;
  }
  // The base image element for a version-badge preview: a raster IMG OR an inlined
  // vector SVG (image block or hotspot base). Both raster and vector must swap on the canvas,
  // else a vector base cycles the label but never the picture (real preview re-inlines
  // via resolveVariant, so it looked right there — the canvas was the odd one out).
  function versionBaseEl(node) {
    return node.querySelector("img.block-image__img, img.hotspot-image, svg.block-image__img, svg.hotspot-image");
  }
  // Build the base element for a previewed version's src. Mirrors resolveVariant: only
  // the src is overridden, so an SVG version re-inlines with the SAME mono/colorMap the
  // flagship carries. Resolve an asset: ref to its data URL first so inlineSvg can decode
  // it (its own asset resolver isn't live outside a render pass); rasters keep the fast blob URL.
  function buildVersionBaseEl(raw, cls, block) {
    var dataUrl = raw;
    if (typeof raw === "string" && raw.indexOf("asset:") === 0 && window.AssetStore && window.AssetStore.get) {
      var a = window.AssetStore.get(raw.slice(6)); if (a && a.dataUrl) dataUrl = a.dataUrl;
    }
    if (/^data:image\/svg\+xml/i.test(dataUrl || "") && window.inlineSvg) {
      var svg = window.inlineSvg({ src: dataUrl, mono: block.mono, colorMap: block.colorMap });
      if (svg) { svg.setAttribute("class", cls); return svg; }
    }
    var img = document.createElement("img");
    img.className = cls;
    img.src = resolveDisplaySrc(raw);
    return img;
  }
  function applyImageVersionPreview(node, block) {
    var cur = versionBaseEl(node); if (!cur) return;
    // stash the flagship-rendered base element ONCE, so cycling back to Flagship restores
    // the exact original (correct classes, recolour, auto-tint) rather than a rebuild.
    if (!node.__imgVerBase) node.__imgVerBase = { el: cur.cloneNode(true), cls: cur.getAttribute("class") || "" };
    var v = imgVersionPreview.get(block) || null;
    if (!v) { cur.parentNode && cur.parentNode.replaceChild(node.__imgVerBase.el.cloneNode(true), cur); return; }
    var raw = imgVariantSrc(block, v) || baseImgSrc(block); // #215: hotspot base = entry.visual
    var next = buildVersionBaseEl(raw, node.__imgVerBase.cls, block);
    cur.parentNode && cur.parentNode.replaceChild(next, cur);
  }
  function decorateVariantVersionBadges(scope) {
    if (isPreview()) return; // preview renders resolved clones (read-only) — no author cycle there
    function escv(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    var root = scope || canvas;
    Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (node) {
      var block = node.__block;
      if (!hasImageVersions(block)) { var stale = node.querySelector(":scope > .variant-cycle"); if (stale) stale.remove(); return; }
      if (node.querySelector(":scope > .variant-cycle")) { applyImageVersionPreview(node, block); return; }
      if (!node.style.position) node.style.position = "relative";
      var versions = imageVersionList(block);
      var badge = h("div", "variant-cycle");
      badge.setAttribute("contenteditable", "false");
      badge.title = "Cycle variant image versions (preview on canvas)";
      function paint() {
        var v = imgVersionPreview.get(block) || null;
        var idx = versions.indexOf(v); if (idx < 0) idx = 0;
        badge.innerHTML = (window.Icon ? window.Icon("layers") : "") +
          '<span class="variant-cycle__name">' + escv(v || "Flagship") + "</span>" +
          '<span class="variant-cycle__count">' + (idx + 1) + "/" + versions.length + "</span>";
      }
      badge.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
      badge.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        var v = imgVersionPreview.get(block) || null;
        var idx = versions.indexOf(v); if (idx < 0) idx = 0;
        var next = versions[(idx + 1) % versions.length];
        if (next) imgVersionPreview.set(block, next); else imgVersionPreview.delete(block);
        applyImageVersionPreview(node, block); paint();
      });
      paint();
      node.appendChild(badge);
      applyImageVersionPreview(node, block);
    });
  }

  function renderImageContent(block) {
      // #160: canonical taxonomy — Content (source / alt / caption), Layout (size / fit),
      // Appearance (radius / blend), Behaviour (zoom), Light/Dark (contrast / palette /
      // per-mode). Sections buffer + emit in PanelLayout order via endSections.
      // VV state-conditional: with no image the alt/size/light-dark/per-mode controls are
      // meaningless, so only the Content section shows until a source is set.
      // A source-linked image resolves its pixels at render time (block.src stays empty), so count a
      // live source link as "has an image" too -- else its Layout/Appearance/Behaviour controls hide.
      var hasImage = !!(block.src || block.srcLight || block.srcDark || (block.sourceLink && block.sourceLink.markId));
      beginSections();

      // Content — source (URL / upload), alt, per-variant versions, caption.
      sectionGroup("Content", "Image", function (secBody) {
      var _cins = inspector; inspector = secBody;
      try {
      fieldRow("Image URL", block.src, function (v) { block.src = v; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }, "https://… or upload below");
      var up = h("button", "prop-btn", "Upload image…");
      up.addEventListener("click", function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
        inp.addEventListener("change", function () {
          var f = inp.files && inp.files[0]; if (!f) return;
          var r = new FileReader();
          r.onload = function () { pushHistory(); block.src = assetRef(r.result, f); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); };
          r.readAsDataURL(f);
        });
        inp.click();
      });
      inspector.appendChild(up);
      if (!hasImage) {
        inspector.appendChild(h("div", "insp-hint", "Add an image above (paste a URL or upload) to set alt text, size, and light/dark options."));
      } else {
      fieldRow("Alt text", block.alt, function (v) { block.alt = v; renderModelView(); }, "describe the image");
      // #148: per-variant image versions (only when the course has variants).
      renderImageVariantVersions(block);
      // Caption shown in the click-to-zoom lightbox (falls back to alt if empty).
      fieldRow("Caption", block.caption, function (v) { if (v) block.caption = v; else delete block.caption; renderModelView(); }, "shown under the zoomed image");
      }
      } finally { inspector = _cins; }
      });

      if (hasImage) {
      // Layout — max width + padding, fit height + fit mode.
      sectionGroup("Layout", "Layout", function (secBody) {
      var _lins = inspector; inspector = secBody;
      try {
      inspector.appendChild(twoUp(
        iconField("W", { value: block.maxWidth, unit: "px", placeholder: "full width", step: 10, min: 40, max: 2000, datalist: "dl-gap", title: "Max width",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.maxWidth; else block.maxWidth = n; reapplyBlock(block); reselectBlockNode(block, "block"); } }).wrap, // PERF: one page, not the world
        iconField(Icon("padding"), { value: block.padding, unit: "px", placeholder: "0", step: 2, min: 0, max: 200, datalist: "dl-gap", title: "Padding around the image",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.padding; else block.padding = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap));
      // VVV: fit into a fixed height (crop/letterbox/stretch). Empty = natural aspect.
      inspector.appendChild(iconField("H", { value: block.fitH, unit: "px", placeholder: "auto height", step: 10, min: 40, max: 1200, datalist: "dl-gap", title: "Fit height",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.fitH; else block.fitH = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap);
      if (block.fitH) {
        segmentedLive("Fit", [["Cover", "cover"], ["Contain", "contain"], ["Fill", "fill"]],
          function (v) { return (block.fit || "cover") === v; },
          function (v) { block.fit = v; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }, inspector);
      }
      } finally { inspector = _lins; }
      });

      // Appearance — corner radius + blend mode (the image's own skin).
      sectionGroup("Appearance", "Appearance", function (secBody) {
      var _ains = inspector; inspector = secBody;
      try {
      // Corner radius on the IMAGE itself (blank = the theme default --radius-card,
      // 0 = square). Writes block.radius -> --img-radius on the figure (render.js);
      // this is the image's OWN rounding, independent of any frame it sits in.
      inspector.appendChild(iconField(Icon("radius"), { value: block.radius, unit: "px", placeholder: "rounded", step: 1, min: 0, max: 100, datalist: "dl-radius", title: "Corner radius (0 = square; blank = theme default)",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.radius; else block.radius = n; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); } }).wrap);
      // Blend mode (#152): blend the asset against the page behind it, so a
      // dark-background image/GIF melts into a dark page (Lighten/Screen) instead of
      // regenerating it. Writes block.blendMode -> --img-blend on the figure (render.js).
      // Normal = unset (no blend). Note: it blends against the PAGE, so it reads
      // differently in light vs dark; Lighten/Screen suit a dark asset on a dark page.
      inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Blend"));
      var blendSel = dsSelect([["Normal", "normal"], ["Lighten", "lighten"], ["Screen", "screen"], ["Darken", "darken"],
        ["Multiply", "multiply"], ["Overlay", "overlay"], ["Soft light", "soft-light"],
        ["Hard light", "hard-light"], ["Difference", "difference"]], block.blendMode || "normal", function (v) {
        pushHistory();
        if (v === "normal") delete block.blendMode; else block.blendMode = v;
        reapplyBlock(block); reselectBlockNode(block, "block"); // PERF: one page, not the world
      });
      blendSel.title = "Blend the image into the page background behind it";
      inspector.appendChild(blendSel);
      } finally { inspector = _ains; }
      });

      // Behaviour — click-to-zoom lightbox (standard-on; opt out per image).
      sectionGroup("Behaviour", "Behaviour", function (secBody) {
        segmentedLive("Click to zoom", [["On", "on"], ["Off", "off"]],
          function (v) { return (block.noZoom === true ? "off" : "on") === v; },
          function (v) { if (v === "off") block.noZoom = true; else delete block.noZoom; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }, secBody);
      });

      // Light/Dark — contrast, SVG palette, per-mode sources (advanced; was a disclosure).
      sectionGroup("Light/Dark", "Light & dark", function (secBody) {
        var _ins = inspector; inspector = secBody;
        try {
      // Item Y — light/dark contrast (its own dimension, NOT the CSV variant axis). No inner
      // "Light / dark" header: it restated the section's own title one style down (OVL-07).
      var _ldBody = inspector;
      // Tri-state contrast: Auto (default) tints VECTOR art (SVG) and leaves RASTER
      // photos alone, so assets adapt to light/dark out of the box; On/Off override.
      var isVec = window.isVectorSrc && window.isVectorSrc(srcForInspect(block.src));
      segmentedLive("Contrast in dark", [["Auto", "auto"], ["On", "on"], ["Off", "off"]],
        function (v) { return (block.autoTint === true ? "on" : block.autoTint === false ? "off" : "auto") === v; },
        function (v) {
          if (v === "on") block.autoTint = true;
          else if (v === "off") block.autoTint = false;
          else delete block.autoTint; // auto
          reapplyBlock(block); reselectBlockNode(block, "block"); // PERF: one page, not the world
        });
      inspector.appendChild(h("div", "insp-hint", "Auto: vector/SVG art recolours to contrast dark mode; photos are left untouched" + (block.src ? " (this asset detected as " + (isVec ? "vector" : "raster") + ")" : "") + ". Ships in the exported course."));

      // Dynamic palette (Phase 1): map an uploaded SVG's colours to theme tokens.
      // The SVG is inlined so each mapped colour recolours per mode from the token
      // (edit values in Theme) — no per-mode upload, no blunt invert. This is the
      // primary light/dark path for vector art; the per-mode uploads below are the
      // fallback (e.g. a raster photo that needs distinct artwork per mode).
      var svgColors = (window.detectSvgColorsFromSrc && window.detectSvgColorsFromSrc(srcForInspect(block.src))) || [];
      if (svgColors.length) {
        inspector = panelSection(_ldBody, "Palette — SVG colours");
        inspector.appendChild(h("div", "insp-hint", "Give each colour a role — Background and Text follow light/dark automatically; Keep leaves a brand colour as-is. Use ⋯ to map to a specific theme token, or switch it to a fixed custom colour."));
        block.colorMap = block.colorMap || {};
        // Three plain roles instead of raw token names: BG -> surface, Text -> ink,
        // Keep -> unchanged. An untouched colour stays Auto (the classifier decides
        // its role); a tap sets the role explicitly. The ... button reveals the full
        // token list for fine control. render applies colorMap the same either way.
        function roleOf(col) {
          if (block.colorMap.hasOwnProperty(col)) {
            var v = block.colorMap[col];
            if (v === "surface" || v === "surfaceAlt" || v === "bg") return "bg";
            if (v === "ink" || v === "inkSoft" || v === "muted") return "text";
            return "keep"; // "keep" or any brand token
          }
          var t = ((window.classifySvgColor && window.classifySvgColor(col)) || {}).token;
          if (t === "bg" || t === "surface" || t === "surfaceAlt") return "bg";
          if (t === "ink" || t === "inkSoft") return "text";
          return "keep";
        }
        // BG -> the theme's actual page background token (--color-bg, the off-white in
        // light mode) so a recoloured SVG background MATCHES the page it sits on, rather
        // than the pure-white `surface`. Author can still pick `surface` via the ⋯ token.
        var allTokens = (window.paletteTokens && window.paletteTokens()) || [];
        var svgRefresh = function () { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); };
        svgColors.forEach(function (col) {
          paletteColorRow(inspector, { key: col, swatchColor: col, label: col, map: block.colorMap, tokens: allTokens, roleOf: roleOf, refresh: svgRefresh });
        });
      }

      inspector = panelSection(_ldBody, "Per-mode image (fallback)");
      inspector.appendChild(h("div", "insp-hint", "Rarely needed — for a raster asset that needs different artwork per mode. For SVGs use the palette above. Blank = use Image URL."));
      // optional per-mode raster sources; blank falls back to Image URL above
      function modeSrcRow(labelText, key) {
        fieldRow(labelText, block[key], function (v) { if (v) block[key] = v; else delete block[key]; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }, "blank = use Image URL");
        var b = h("button", "prop-btn", "Upload " + labelText.toLowerCase() + "…");
        b.addEventListener("click", function () {
          var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
          inp.addEventListener("change", function () {
            var f = inp.files && inp.files[0]; if (!f) return;
            var r = new FileReader();
            r.onload = function () { pushHistory(); block[key] = assetRef(r.result, f); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); };
            r.readAsDataURL(f);
          });
          inp.click();
        });
        inspector.appendChild(b);
      }
      modeSrcRow("Light source", "srcLight");
      modeSrcRow("Dark source", "srcDark");
        } finally { inspector = _ins; }
      });
      } // end hasImage (Layout / Appearance / Behaviour / Light-Dark sections)
      endSections(inspector);
  }


  // SPEC-ui-kit ticket 8: frame (Card) / group. Their box IS container chrome, so
  // Block level maps straight onto renderContainerChrome; Content level = the children
  // (Inside) + type actions (save/convert/ungroup). A frame's border is a theme-styled
  // on/off line (render.js honours block.border only, not colour/width) -> stroke:"switch".
  function renderFrameContent(node) {
    var block = node.__block;
    var isCard = block.type === "frame";
    block.children = block.children || [];
    var _frameRoot = inspector;
    inspector = panelSection(_frameRoot, "Inside");
    block.children.forEach(function (child, ci) {
      var crow = h("div", "insp-row");
      crow.appendChild(h("span", "insp-row__label", blockIcon(child) + "  " + blockLabel(child)));
      var del = h("button", "prop-btn prop-btn--danger", "×");
      del.title = "Remove from " + (isCard ? "card" : "group");
      del.addEventListener("click", function () { pushHistory(); block.children.splice(ci, 1); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); });
      crow.appendChild(del);
      inspector.appendChild(crow);
    });
    var addWrap = h("div", "insp-row");
    addWrap.appendChild(h("span", "insp-row__label", "Add inside"));
    var addPairs = [];
    LIBRARY.forEach(function (item, idx) {
      var t = item.make().type;
      if (t === "frame" || t === "componentGrid") return; // no nested cards/grids in v1
      addPairs.push([item.label, String(idx)]);
    });
    var addSel = dsSelect(addPairs, "", function (v) {
      var idx = parseInt(v, 10); if (isNaN(idx)) return;
      pushHistory();
      block.children.push(LIBRARY[idx].make());
      reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
    }, { placeholder: "Choose a block…" });
    addWrap.appendChild(addSel);
    inspector.appendChild(addWrap);

    inspector = panelSection(_frameRoot, "Actions");
    var saveBtn = h("button", "prop-btn prop-btn--accent", "Save as component…");
    saveBtn.addEventListener("click", function () { saveBlockAsComponent(block); });
    inspector.appendChild(saveBtn);
    var convBtn = h("button", "prop-btn", isCard ? "Convert to group (remove card styling)" : "Convert to card (add fill / outline)");
    convBtn.style.marginTop = "6px";
    convBtn.addEventListener("click", function () {
      pushHistory();
      if (isCard) { block.type = "group"; }
      else { block.type = "frame"; if (block.padding == null) block.padding = 20; if (block.radius == null) block.radius = 12; }
      reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block");
    });
    inspector.appendChild(convBtn);
    var ungBtn = h("button", "prop-btn prop-btn--danger", "Ungroup (release blocks)");
    ungBtn.style.marginTop = "6px";
    ungBtn.addEventListener("click", function () { ungroupContainer(block); });
    inspector.appendChild(ungBtn);
    inspector = _frameRoot;
  }
  function renderFrameOrGroupTwoLevel(node) {
    var block = node.__block;
    if (block.type !== "frame") { renderBlockTwoLevel(node, "Group", CONTENT_DECL, renderFrameContent); return; }
    var io = {
      get: function (k) {
        if (k === "align") return block.align;
        if (k === "valign") return block.valign;
        if (k === "padX") return block.padding == null ? 20 : block.padding;
        if (k === "gap") return block.gap;
        if (k === "radius") return block.radius == null ? 12 : block.radius;
        if (k === "hasFill") return !!block.background;
        if (k === "fillColor") return block.background;
        if (k === "hasStroke") return !!block.border;
        if (k === "spaceTop") return block.spaceTop;
        if (k === "spaceBottom") return block.spaceBottom;
        return undefined;
      },
      set: function (k, v) {
        if (k === "align") { if (v == null || v === "start") delete block.align; else block.align = v; }
        else if (k === "valign") { if (v == null || v === "top") delete block.valign; else block.valign = v; }
        else if (k === "padX") { if (v == null) delete block.padding; else block.padding = v; }
        else if (k === "gap") { if (v == null) delete block.gap; else block.gap = v; }
        else if (k === "radius") { if (v == null) delete block.radius; else block.radius = v; }
        else if (k === "hasFill") { if (v) { if (!block.background) block.background = "#2a2c2f"; } else delete block.background; }
        else if (k === "fillColor") { if (v == null) delete block.background; else block.background = v; }
        else if (k === "hasStroke") { if (v) block.border = true; else delete block.border; }
        else if (k === "spaceTop") { if (v == null) delete block.spaceTop; else block.spaceTop = v; }
        else if (k === "spaceBottom") { if (v == null) delete block.spaceBottom; else block.spaceBottom = v; }
        reapplyStructural(findPageOfBlock(block));
      }
    };
    renderBlockTwoLevel(node, "Card", { padding: true, gap: true, radius: true, fill: true, stroke: "switch" }, renderFrameContent, io, blockChromeHandlers(block));
    // #21 RELINK: a block detached from a library instance keeps a breadcrumb
    // (__linkedFrom, set by detachLibraryInstance) so it can be re-attached later —
    // discards whatever local edits were made since detach, so it's confirmed.
    if (block.__linkedFrom) {
      var relinkB = h("button", "prop-btn", "Relink to library"); relinkB.style.marginTop = "6px";
      relinkB.title = "Re-attach to “" + block.__linkedFrom + "” — replaces this block's content with the master's current content and discards edits made since detaching.";
      relinkB.addEventListener("click", function () {
        confirmModal("Relink to library", "Re-attach this block to “" + block.__linkedFrom + "”? Its content will be replaced by the master's CURRENT content — any edits made since detaching are discarded.",
          function () { relinkToLibrary(block, block.__linkedFrom); }, { okLabel: "Relink" });
      });
      inspector.appendChild(relinkB);
    }
  }


  // ============================================================================
  // ---- tour builder -> src/editor/board/builder.js (arch-P3b-04) -----------
  // 1,871 lines of board DOM: the node cards, the pin and port drags, the loop frames, the
  // source-video scrubber and segment cutter, and the re-hosted hotspot inspector. P3-06 had
  // already moved its geometry (board/layout.js) and its harvest maths (board/harvest.js).
  // These five are the whole surface the rest of this file uses.
  var openTourBuilder = VE.bind("openTourBuilder");
  var closeTourBuilder = VE.bind("closeTourBuilder");
  var tourBoardIsOpen = VE.bind("tourBoardIsOpen");
  var syncTourBoard = VE.bind("syncTourBoard");
  var maybeReopenTourBuilder = VE.bind("maybeReopenTourBuilder");
  var rebindTourBuilderToLiveDoc = VE.bind("rebindTourBuilderToLiveDoc");   // arch-P3b-07

  // A section built for an imperative caller: appends it to `host` and hands back the BODY, so
  // the rows that follow append into the section rather than beside it. uio-O-W2 (OVL-07): this
  // is now an adapter over the ONE sectionGroup, not a second section implementation — it used
  // to build VersoUI.PanelSection and fall back to a flat sub() header, which is how a panel
  // ended up mixing two section chromes. It carries no data-section-type, so it stays out of
  // the PanelLayout drag-reorder set (that remains the taxonomy panels' feature).
  function panelSection(host, title, opts) {
    opts = opts || {};
    host = host || inspector;
    var sec = sectionGroup(null, title, function () {}, {
      key: opts.key, defaultOpen: opts.defaultOpen, divider: opts.divider, actions: opts.actions,
      hostBodies: sectionBodiesAbove(host)
    });
    host.appendChild(sec);
    return sec.querySelector(".insp-section__body");
  }
  // How many section bodies `host` sits inside, itself included. The host may still be detached
  // (a panel is built before it is mounted), so this walks the tree it is in, not the document.
  function sectionBodiesAbove(host) {
    var n = 0;
    for (var el = host; el; el = el.parentNode) {
      if (el.nodeType === 1 && el.classList && el.classList.contains("insp-section__body")) n++;
    }
    return n;
  }
  // DS inline-labelled segmented row (mockup AlignRow) — a canonical FieldRow whose
  // control is a VersoUI.SegmentedControl. Preserves the segmented wiring exactly
  // (pushHistory + the caller's live set), just re-skinned to label-on-the-left.
  function alignSeg(label, current, options, onPick) {
    var seg = window.VersoUI.SegmentedControl({ value: current, options: options, onChange: function (v) { pushHistory(); onPick(v); } });
    seg.style.flex = "1 1 auto"; seg.style.minWidth = "0";
    return window.VersoUI.FieldRow({ label: label, children: seg });
  }
  // a single-line row for a NAMED control — label on the left, the
  // control (colour swatch, input, segments) right-aligned on the SAME line. Replaces
  // the stacked "label-above-control" look in the Content inspectors. build(cell) renders
  // a canonical control into the right cell (pass a null label to skip its own stacked one).
  function line(label, build, target) {
    var row = h("div", "insp-line");
    row.appendChild(h("span", "insp-line__label", label));
    var cell = h("div", "insp-line__control");
    build(cell);
    row.appendChild(cell);
    (target || inspector).appendChild(row);
    return row;
  }
  // Fill/Stroke-style colour (SPEC-ui-kit, James review): collapsed to a "+" while
  // on the theme default (hidden away); click "+" to reveal the swatch + hex. Built on
  // the collapsed-optional row. getV()/setV() read/write the block's colour (null = default).
  function colorOpt(label, getV, setV, defV, target) {
    optionalRow(target || inspector, label, {
      addTitle: "Set " + label.toLowerCase(),
      get: function () { return getV() != null; },
      set: function (v) { if (v) { if (getV() == null) setV(defV || "var(--color-accent)"); } else setV(null); },
      build: function (b) { colorFieldFlat(null, getV(), setV, b); }
    });
  }

  // collapsible section (twirl). open-state persists across inspector rebuilds AND
  // across reloads (localStorage, global per block-type — namespaced keys like
  // "hf.header" / "nav.pill"). Defaults below are the FIRST-RUN state; stored wins after.
  var OPEN_KEY = "authoring.panels-open";
  function loadOpenSections() {
    var d = { theme: false, layout: false, headerFooter: false, textAdvanced: false, spacing: true, imgLightDark: false, "nav.sections": true };
    try { var s = JSON.parse(localStorage.getItem(OPEN_KEY) || "null"); if (s && typeof s === "object") Object.keys(s).forEach(function (k) { d[k] = !!s[k]; }); } catch (e) {}
    return d;
  }
  var openSections = loadOpenSections();
  function saveOpenSections() { try { localStorage.setItem(OPEN_KEY, JSON.stringify(openSections)); } catch (e) {} }
  function toggleSection(key) { openSections[key] = !openSections[key]; saveOpenSections(); renderInspector(); }
  // uio-O-W2 (OVL-07): an adapter over the ONE section, kept for the callers that name their
  // open-state key. It used to be its own bullet-caret chrome — the third header style in a pane
  // that already had two.
  function disclosure(key, title, buildBody) {
    return sectionGroup(null, title, buildBody, { key: key, defaultOpen: false });
  }

  // ---- Canonical panel primitives -------------------
  // arch-P3b-07b: the binary + segmented controls and the collapsed-section summaries moved to
  // editor/inspector/primitives.js. The style-key constants went with them -- they are what
  // nestOverridden and nestReset are asked about -- and are read back from their owner right after
  // it installs, at the bottom of this file. Declared here so the sites below still read a
  // file-top-level name.
  var HEADER_STYLE_KEYS, FOOTER_STYLE_KEYS, NAV_BTN_KEYS, NAV_PILL_KEYS;

  var switchEl = VE.bind("switchEl");
  var switchRow = VE.bind("switchRow");
  var eyeRow = VE.bind("eyeRow");
  var segmentedIconLive = VE.bind("segmentedIconLive");
  var subDisclosure = VE.bind("subDisclosure");
  var sectionSummary = VE.bind("sectionSummary");
  var headerFooterSummary = VE.bind("headerFooterSummary");
  var nestOverridden = VE.bind("nestOverridden");
  var nestReset = VE.bind("nestReset");


  // nothing selected -> document/page context: canvas background + a collapsible
  // Theme section (set-and-forget, so it twirls closed by default).
  var pipelineButtons = [];
  function buildPipelineBody(c) {
    // Export SCORM / Import CSV / JSON backup now live in the TOP BAR (D6: primary Export +
    // ⋯ overflow) — retired from here. This panel keeps only the review-folder workflow.
    c.appendChild(h("div", "insp-hint", "Export & import moved to the top bar (the Export button + ⋯ menu). This section handles the review-folder workflow."));
    // §12 Viewer V1: publish a FROZEN review snapshot (.versopub.json) — the doc with
    // all block cids, comments stripped — that the standalone Verso Viewer opens so
    // reviewers can drop comments anchored to this exact version.
    c.appendChild(h("div", "insp-hint", "Publish a frozen snapshot into the shared review folder; reviewers comment in the Verso Viewer and their notes return to the same folder. Once connected, new comments auto-ingest on launch + every minute — the button below re-checks now / reconnects the folder."));
    var pubBtn = h("button", "prop-btn", "Publish to Viewer…");
    pubBtn.addEventListener("click", publishToViewer);
    c.appendChild(pubBtn);
    var ingBtn = h("button", "prop-btn", "Check for reviews now…");
    ingBtn.addEventListener("click", ingestReviewsFromFolder);
    c.appendChild(ingBtn);
  }
  // §12 Viewer: a chosen exchange-folder handle (File System Access), remembered for
  // the session so publish + ingest reuse it. Not persisted (a fresh session re-picks).
  // §12 Viewer: the shared exchange-folder handle (File System Access). PERSISTED in
  // IndexedDB (FileSystemHandles are structured-cloneable) so the connection survives
  // a refresh/restart and reviews can auto-ingest on load + on a poll. The browser may
  // still require ONE user gesture to re-authorise after a full restart — handled by
  // degrading to a manual re-pick when silent permission isn't granted.
  var reviewDirHandle = null;
  var reviewPollTimer = null;
  function reviewIdb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("verso-review", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("h"); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  async function saveReviewDir(handle) { try { var db = await reviewIdb(); await new Promise(function (res, rej) { var tx = db.transaction("h", "readwrite"); tx.objectStore("h").put(handle, "dir"); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); } catch (e) {} }
  async function loadReviewDir() { try { var db = await reviewIdb(); return await new Promise(function (res) { var tx = db.transaction("h", "readonly"); var g = tx.objectStore("h").get("dir"); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }); } catch (e) { return null; } }
  // check/ask permission on a handle. silent=true never prompts (boot/poll path).
  async function dirPermission(handle, silent) {
    if (!handle || !handle.queryPermission) return "granted"; // older impls: assume ok
    var opts = { mode: "readwrite" };
    var p = await handle.queryPermission(opts);
    if (p === "granted") return "granted";
    if (silent) return p; // "prompt"/"denied" — don't nag on load
    try { return await handle.requestPermission(opts); } catch (e) { return "denied"; }
  }
  // Get a usable folder handle: in-memory > persisted (with a gesture-driven re-grant)
  // > pick a new one. Persists the pick so it's remembered next launch.
  async function ensureReviewFolder() {
    if (reviewDirHandle && (await dirPermission(reviewDirHandle, false)) === "granted") return reviewDirHandle;
    var saved = await loadReviewDir();
    if (saved && (await dirPermission(saved, false)) === "granted") { reviewDirHandle = saved; startReviewPoll(); return reviewDirHandle; }
    if (!window.showDirectoryPicker) return null;
    try { reviewDirHandle = await window.showDirectoryPicker({ mode: "readwrite" }); await saveReviewDir(reviewDirHandle); startReviewPoll(); return reviewDirHandle; }
    catch (e) { return null; }
  }
  function snapshotBlob(versionOverride) {
    var frozen = JSON.parse(JSON.stringify(doc));
    delete frozen.comments; // reviewers add their own; cids already present (normalizeDoc)
    // §12a: bake every AssetStore "asset:<id>" ref (images, per-mode sources, embeds,
    // header logo, glossary) into a self-contained base64 data-URI so the frozen snapshot
    // renders standalone in the Verso Viewer, which has NO AssetStore. Same base64 path as
    // export (NOT editorAssetResolve, whose blob: URLs don't travel to another machine);
    // the clone is throwaway so there's nothing to restore.
    if (window.resolveMedia && window.AssetStore) {
      window.resolveMedia(frozen, function (id) {
        var a = window.AssetStore.get(id);
        return a ? a.dataUrl : window.AssetStore.placeholder;
      });
    }
    var course = doc.code || doc.id || "course";
    var version = versionOverride || doc.version || (new Date().toISOString().slice(0, 10));
    var snap = { type: "verso-pub", schema: 1, course: course, version: version, publishedAt: Date.now(), doc: frozen };
    var name = "verso-" + String(course).replace(/[^\w.-]+/g, "_") + "-" + String(version).replace(/[^\w.-]+/g, "_") + ".versopub.json";
    return { name: name, text: JSON.stringify(snap) };
  }
  // Freeze the current doc into a review snapshot. Writes straight to the shared
  // review folder (File System Access) when available; falls back to a download.
  // `versionOverride` lets the SCORM export tag the review file with the SAME version.
  async function publishToViewer(versionOverride, quiet) {
    var f = snapshotBlob(versionOverride);
    var dir = await ensureReviewFolder();
    if (dir) {
      try {
        var fh = await dir.getFileHandle(f.name, { create: true });
        var w = await fh.createWritable(); await w.write(f.text); await w.close();
        if (!quiet) window.alert("Published " + f.name + " to the review folder.");
        return { name: f.name, to: "folder" };
      } catch (e) { /* fall through to download */ }
    }
    var blob = new Blob([f.text], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = f.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    return { name: f.name, to: "download" };
  }
  // Scan a folder handle for reviewer sidecars (review-*.json) and merge them all
  // (conflict-free). Returns { added, updated, files }. Pure of UI so both the manual
  // button and the auto/poll path reuse it.
  async function scanAndMerge(dir) {
    var added = 0, updated = 0, files = 0;
    for await (var entry of dir.values()) {
      if (entry.kind !== "file" || !/^review-.*\.json$/i.test(entry.name)) continue;
      try {
        var file = await entry.getFile();
        var parsed = JSON.parse(await file.text());
        var list = Array.isArray(parsed) ? parsed : (parsed && parsed.comments);
        if (!Array.isArray(list)) continue;
        var r = mergeComments(list); added += r.added; updated += r.updated; files++;
      } catch (e) { /* skip a bad file */ }
    }
    return { added: added, updated: updated, files: files };
  }
  // Manual ingest (button): picks/authorises the folder if needed, then reports.
  async function ingestReviewsFromFolder() {
    var dir = await ensureReviewFolder();
    if (!dir) { window.alert("Folder access needs Edge/Chrome opened locally. Use the comment panel's Import… as a fallback."); return; }
    var r;
    try { pushHistory(); r = await scanAndMerge(dir); }
    catch (e) { window.alert("Could not read the folder: " + e.message); return; }
    scheduleSave(); renderCommentPins(); refreshCommentPanel();
    window.alert("Ingested " + r.files + " review file(s): " + r.added + " new comments, " + r.updated + " updated.");
  }
  // Silent auto-ingest (boot + poll): only touches the doc / notifies when something
  // NEW actually arrived, so it never nags. Never prompts for permission.
  async function autoIngestReviews() {
    var dir = reviewDirHandle || await loadReviewDir();
    if (!dir) return;
    if ((await dirPermission(dir, true)) !== "granted") return; // wait for a gesture-driven re-grant
    reviewDirHandle = dir;
    var before = (doc.comments || []).length;
    var r;
    try { r = await scanAndMerge(dir); } catch (e) { return; }
    if (r.added > 0 || r.updated > 0) {
      scheduleSave(); renderCommentPins(); refreshCommentPanel();
      if (r.added > 0) reviewToast(r.added + " new review comment" + (r.added > 1 ? "s" : "") + " arrived");
    }
    void before;
  }
  function startReviewPoll() {
    if (reviewPollTimer) return;
    // OneDrive sync + FSA: a 60s poll is plenty; guarded by silent permission.
    reviewPollTimer = setInterval(function () { autoIngestReviews(); }, 60000);
  }
  function stopReviewPoll() { if (reviewPollTimer) { clearInterval(reviewPollTimer); reviewPollTimer = null; } }
  // Power (#179): pause background work when the window is occluded / minimised so macOS App
  // Nap can engage (a laptop energy win in the packaged WKWebView app). WebKit fires
  // visibilitychange on occlusion. We pause the two forever-timers -- autosave (flushed first
  // by its governor) + the review poll -- and drop the world's GPU-layer promotion; all resume
  // on return. `_reviewPollWasOn` remembers whether the poll was actually running so we don't
  // start it on a course that never had folder permission. Editor chrome only.
  var _reviewPollWasOn = false;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      _reviewPollWasOn = !!reviewPollTimer;
      if (window.__autosaveGov) window.__autosaveGov.pause();
      stopReviewPoll();
      if (world) world.style.willChange = "auto"; // release the compositor layer while unseen
    } else {
      if (window.__autosaveGov) window.__autosaveGov.resume();
      if (_reviewPollWasOn) startReviewPoll();
      if (world) world.style.willChange = ""; // restore the CSS-driven promotion (transform)
    }
  });
  function reviewToast(msg) {
    var t = h("div", "review-toast", msg);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("is-out"); }, 3600);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 4200);
  }
  // Boot: reconnect the saved folder + auto-ingest if the browser still grants it
  // silently; otherwise stay quiet until the next Ingest click re-authorises.
  async function initReviewAutoIngest() {
    if (!window.showDirectoryPicker) return;
    var saved = await loadReviewDir(); if (!saved) return;
    if ((await dirPermission(saved, true)) === "granted") { reviewDirHandle = saved; startReviewPoll(); autoIngestReviews(); }
  }
  window.__setReviewDir = function (d) { reviewDirHandle = d; }; // test hook
  window.__autoIngestReviews = autoIngestReviews; // test hook

  // ---- Project auto-backup (P0 data-safety) --------
  // arch-P3b-07d: the durable-copy writer moved to editor/backup.js. It read only five names from
  // this file, the smallest set in the phase -- the banner it sat in also held the top bar, the
  // three-stage model and the cell chip, and those are separate concerns that stayed.
  var scheduleBackup = VE.bind("scheduleBackup");
  var backupSlug = VE.bind("backupSlug");
  var backupMode = VE.bind("backupMode");
  var connectBackupFolder = VE.bind("connectBackupFolder");
  // arch-P3b-07: these five stayed as bare call sites when the region moved, so they threw the
  // moment their path ran -- the publish destination handles and the two folder buttons.
  var loadBackupHandle = VE.bind("loadBackupHandle");
  var saveBackupHandle = VE.bind("saveBackupHandle");
  var bindProjectFolder = VE.bind("bindProjectFolder");
  var reconnectBackupFolder = VE.bind("reconnectBackupFolder");
  var backupHandleSet = VE.bind("backupHandleSet");

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
  window.__leftRail = { mount: mountLeftRail, setStage: setStage, getStage: function () { return __activeStage; } }; // boot + settings

  // SPEC 7 (cell switcher + tiered mutability): the editor-header chip shows the document's matrix
  // cell (geometry . interactivity) and opens a menu to change it AFTER creation. Tiered: toggling
  // interactivity is free + immediate; a geometry-mode change warns (content reflows, may not survive
  // 1:1) then re-renders the canvas into the new geometry. Reads/writes doc.meta via the pure
  // doc-type model; a geometry change is reflected by mount() rebuilding the geo-classed canvas.
  var CELL_GEO_LABEL = { reflow: "Reflow", frame: "Fixed frame", paged: "Paged" };
  function currentCell() {
    return (window.__docType && window.__docType.docCell) ? window.__docType.docCell(doc) : { geo: "reflow", interactive: true };
  }
  function applyCellChange(geo, interactive) {
    if (!window.__docType || !window.__docType.tagDocCell) return;
    window.__docType.tagDocCell(doc, geo, interactive);
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

  // Persistent top-bar product context (Product Rail): "" = All products. Persisted across
  // refresh (mirrors STAGE_PERSIST_KEY) so a chosen product scope survives a reload on every
  // stage; every stage reads it through window.__productRail.getActiveProduct().
  function setActiveProduct(id) { ProductRail.setActiveProduct(id); }
  function getActiveProduct() { return ProductRail.getActiveProduct(); }
  function restoreActiveProduct() { ProductRail.restoreActiveProduct(); }
  function mountProductPicker() {
    if (typeof document === "undefined") return;
    restoreActiveProduct(); // first mount = boot; restore the persisted scope before building the Select
    var host = document.getElementById("product-picker-host"); if (!host) return;
    host.innerHTML = "";
    var U = window.VersoUI; if (!U || !U.Select) return;
    host.appendChild(U.Select({
      options: productSelectOptions(window.ProductsStore),
      value: ProductRail.getActiveProduct(),
      onChange: function (v) { setActiveProduct(v); renderSourceStage(); reconcileActiveTabToScope(); } // re-resolve the Product's document + re-scope the Edit tabs
    }));
    // new-product-button: a "+" beside the picker creates an empty Product from scratch (the only
    // other path, Promote to Product, tags an already-open course -- it can't make a net-new one).
    if (U.IconButton) {
      var addBtn = U.IconButton({ icon: "plus", label: "New product", size: "sm", title: "New product", onClick: newProductPrompt });
      addBtn.classList.add("product-picker__add");
      host.appendChild(addBtn);
    }
  }
  // Create an empty Product from a single-field name modal, then select it (scope switches to it).
  // First-document creation is handled by the editor's empty-state file picker once the scope is set.
  function newProductPrompt() {
    promptModal("New product", "Product name", "", function (v) {
      var name = (v || "").trim(); if (!name) return;
      var prod = createProduct(name); if (!prod) return;
      setActiveProduct(prod.id);
      mountProductPicker();          // rebuild the dropdown with the new Product selected
      // new-product-empty-landing: land on the Edit-stage document browser, empty (no documents are
      // tagged to the new Product yet), rather than a bespoke per-stage prompt. Creating a document
      // from that empty browser pre-stamps it with this Product (showNewDocDialog reads the scope).
      setStage("edit");
      reconcileActiveTabToScope();   // re-scope the Edit tabs to the new (empty) Product
      renderSourceStage();           // keep the Source stage's own doc bound for when it's opened
      openBrowser();                 // the empty document browser for the new Product
    });
  }
  window.__productRail.getActiveProduct = getActiveProduct;
  window.__productRail.setActiveProduct = setActiveProduct;
  window.__productRail.mountProductPicker = mountProductPicker; // boot hook

  // ---- Source stage -> src/editor/source-stage.js (arch-P3b-05) ------------
  // 3,224 lines: the unified per-Product document, its outline rail, the directly-editable
  // article, facets, variant columns, range marks with comments and where-used, find-to-word,
  // the two-layer lock and additive Markdown import. Nothing in it reads a binding this file
  // REPLACES, so it copied verbatim -- no live getters, no accessor pairs.
  var applySourceLockState = VE.bind("applySourceLockState");
  var flushSourceEditSession = VE.bind("flushSourceEditSession");
  var persistSourceDocModel = VE.bind("persistSourceDocModel");
  var refreshSourceSelBar = VE.bind("refreshSourceSelBar");
  var renderSourceArticle = VE.bind("renderSourceArticle");
  var renderSourceDocNode = VE.bind("renderSourceDocNode");
  var renderSourceStage = VE.bind("renderSourceStage");
  var renderSourceToolbar = VE.bind("renderSourceToolbar");
  var sourceMasterFor = VE.bind("sourceMasterFor");
  var sourceToast = VE.bind("sourceToast");
  var unifiableTopicsFor = VE.bind("unifiableTopicsFor");
  var updateSourceDocBar = VE.bind("updateSourceDocBar");
  var pushSourceAlternate = VE.bind("pushSourceAlternate");
  // arch-P3b-07: the base-edit warning and the two-way jump kept reading the stage's state by
  // name after it moved. They ask through these instead.
  var sourceDocModel = VE.bind("sourceDocModel");
  var setSourceDocModel = VE.bind("setSourceDocModel");
  var sourceActiveTopicId = VE.bind("sourceActiveTopicId");
  var openSourceTopicId = VE.bind("openSourceTopicId");
  var lockSourceEditing = VE.bind("lockSourceEditing");
  var clearSourceEditSession = VE.bind("clearSourceEditSession");

  // ...continues in library.js (arch-P3b-07).


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
    var _cell = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(doc) : { geo: "reflow", interactive: true };
    sectionGroup("Layout", "Document type", function (secBody) {
      var _i = inspector; inspector = secBody;
      try {
        inspector.appendChild(h("div", "insp-hint",
          (CELL_GEO_LABEL[_cell.geo] || _cell.geo) + " · " + (_cell.interactive ? "Interactive" : "Static") +
          " — change it in Document settings (the sliders button in the editor header)."));
        var tools = (window.__docType && window.__docType.condToolsFor) ? window.__docType.condToolsFor(_cell.geo) : [];
        if (tools.length) {
          var toolsBody = panelSection(inspector, (CELL_GEO_LABEL[_cell.geo] || _cell.geo) + " tools");
          tools.forEach(function (t) {
            var row = h("div", "insp-row insp-doc-tool");
            row.appendChild(h("span", "insp-row__label", t));
            toolsBody.appendChild(row);
          });
        }
      } finally { inspector = _i; }
    });
    sectionGroup("Appearance", "Canvas", function (secBody) {
      var _i = inspector; inspector = secBody;
      try {
      // Canvas background lives in localStorage (not doc), so it is off the undo stack
      // (noHistory) and applies live via applyCanvasBg. Clearing reverts to the default backdrop.
      colourControl("Background", canvasBg, function (val) { applyCanvasBg(val == null ? BG_DEFAULT : val); }, inspector, true);
      // The button IS the route, so it states its destination rather than pointing at a
      // corner of the window (it used to say "top right", which no cog has ever been in).
      var openBtn = h("button", "insp-hint insp-backlink", "Open project & system settings");
      openBtn.type = "button";
      openBtn.title = "Header & Footer, Glossary, Theme, fonts and more live in the settings sheet.";
      openBtn.addEventListener("click", function () { openSettingsModal("project"); });
      inspector.appendChild(openBtn);
      } finally { inspector = _i; }
    });
    endSections(inspector);
  }

  // ---- uio-F05: the overlay LAYER STACK (the spine's Esc contract) ----------
  // arch-P3b-07g: the layer stack and the settings sheet it was written for -- both tabs, the
  // section registry and four panel bodies that were filed under the fonts banner -- moved to
  // editor/settings-sheet.js.
  var pushLayer = VE.bind("pushLayer");
  var popLayer = VE.bind("popLayer");
  var openSettingsModal = VE.bind("openSettingsModal");
  var closeSettingsModal = VE.bind("closeSettingsModal");
  var openSettingsSection = VE.bind("openSettingsSection");
  var openSelectionSettings = VE.bind("openSelectionSettings");
  var renderSettingsBody = VE.bind("renderSettingsBody");
  var refreshSettingsPanes = VE.bind("refreshSettingsPanes");
  var getSettingsSections = VE.bind("getSettingsSections");
  var wireScrollEdges = VE.bind("wireScrollEdges");
  var glossaryTerms = VE.bind("glossaryTerms");
  var buildGlossaryBody = VE.bind("buildGlossaryBody");
  var buildMotionBody = VE.bind("buildMotionBody");
  var buildBackupBody = VE.bind("buildBackupBody");


  // ---- KKK: custom (uploaded) fonts ----------------------------------------
  // arch-P3b-07: uploaded and Google fonts -- the store, the embedding, the picker and the
  // air-gap flag -- moved to editor/fonts.js. This banner also held the header/footer editor
  // (07e) and three settings-panel bodies, which are separate concerns.
  var fontFormatFor = VE.bind("fontFormatFor");
  var resolveFontDataUrl = VE.bind("resolveFontDataUrl");
  var registerDocFontNames = VE.bind("registerDocFontNames");
  var applyDocFonts = VE.bind("applyDocFonts");
  var fetchAndEmbedGoogleFont = VE.bind("fetchAndEmbedGoogleFont");
  var buildFontsBody = VE.bind("buildFontsBody");
  var isEmbeddableFont = VE.bind("isEmbeddableFont");
  var buildFontPicker = VE.bind("buildFontPicker");

  // ...continues in settings-sheet.js (arch-P3b-07).

  // ...continues in fonts.js (arch-P3b-07).

  // A headerFooter/footer numeric field (padding, logo size). Applies LIVE via
  // arch-P3b-07e: the header/footer editor -- both configurations, their per-page overrides and
  // the learner nav's nests -- moved to editor/header-footer.js.
  var buildHeaderBody = VE.bind("buildHeaderBody");
  var buildFooterBody = VE.bind("buildFooterBody");
  var buildHeaderFooterDefaultBody = VE.bind("buildHeaderFooterDefaultBody");
  var buildLayoutBody = VE.bind("buildLayoutBody");
  var makeCourseNav = VE.bind("makeCourseNav");
  var headerFooterConfig = VE.bind("headerFooterConfig");
  var hfSectionOpts = VE.bind("hfSectionOpts");
  // arch-P3b-07: the nav's controls are drawn from two places here and neither was bound.
  var courseNavControls = VE.bind("courseNavControls");
  var courseNavNests = VE.bind("courseNavNests");


  // ...continues in theme.js (arch-P3b-07).


  // arch-P3b-07: the canonical dropdown and its labelled row moved to
  // editor/inspector/primitives.js, where every other canonical control lives. They were in the
  // theme banner, between the Theme panel and the font picker that each happened to use one.
  var dsSelect = VE.bind("dsSelect");
  var selectRow = VE.bind("selectRow");
  // ...continues in fonts.js (arch-P3b-07).


  // #170/#158: ONE canonical, config-driven formatting toggle-bar builder, shared by the
  // block inspector's field editor AND the Course Copy Editor -- replacing their two
  // bespoke prop-toggle-row "biu" rows. Behaviour is unchanged (inline execCommand for
  // B/I/U/Link, active state via queryCommandState/an anchor check); only the surfaces
  // now share one implementation. `io` decouples the bar from which surface it's in:
  //   io.getNode() -> the current contentEditable element to focus/act on (or null/undefined
  //                   when nothing is active -- the bar simply no-ops on click)
  //   io.onChange() -> called after a toggle mutates content; the caller owns persistence
  //                    (inspector: obj[field] = sanitizeFieldHtml(...) + renderModelView();
  //                    copy editor: commitCopyRow(...))
  // Config-driven so a future kind (e.g. the List ticket's block-level toggle) is a new
  // branch here, not a new bar -- today "inline-exec" (B/I/U), "link", and "list-block"
  // (#170/#33: a whole block-TYPE conversion, not an inline execCommand list) exist.
  var FORMAT_TOGGLES = [
    { kind: "inline-exec", label: "B", cmd: "bold", title: "Bold (selected text)" },
    { kind: "inline-exec", label: "I", cmd: "italic", title: "Italic (selected text)" },
    { kind: "inline-exec", label: "U", cmd: "underline", title: "Underline (selected text)" },
    { kind: "link" },
    { kind: "list-block" }
  ];
  function formatCmdOn(cmd) { try { return document.queryCommandState(cmd); } catch (e) { return false; } }
  function formatSelectionAnchor() {
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
    var c = sel.getRangeAt(0).commonAncestorContainer;
    c = c.nodeType === 1 ? c : c.parentNode;
    return (c && c.closest) ? c.closest("a[href]") : null;
  }
  // ---- Above-selection floating format bar on the Edit canvas (floating-format-bar-to-edit-canvas) ----
  // The same above-the-selection glyph bar idiom the Source stage uses (buildSourceSelBar), brought to
  // the main Edit canvas. It appears on a non-collapsed text selection inside an editable [data-edit]
  // field with the inline format actions -- bold / italic / underline, the SAME inline-exec set as the
  // inspector's FORMAT_TOGGLES (one config, two surfaces). Clicking runs execCommand, which fires the
  // field's own input -> writeModel commit (identical to typing), so there is no separate write path.
  // Editor chrome only; never in the shipped course. Positioned fixed above the selection.
  /* @canvas-fmtbar-start */
  var FMTBAR_GLYPH = { bold: "bold", italic: "italic", underline: "underline" };
  var __canvasFmtBar = null;
  // The editable canvas text field a DOM point sits in, or null (a live contentEditable [data-edit]).
  function canvasEditableFieldOf(node) {
    var el = (node && node.nodeType === 3) ? node.parentNode : node;
    var f = (el && el.closest) ? el.closest("[data-edit].is-editable") : null;
    return (f && f.getAttribute("contenteditable") === "true") ? f : null;
  }
  function hideCanvasFmtBar() { if (__canvasFmtBar) { __canvasFmtBar.remove(); __canvasFmtBar = null; } }
  function syncCanvasFmtBarActive(bar) {
    Array.prototype.forEach.call(bar.querySelectorAll("[data-cmd]"), function (b) {
      var on = false; try { on = document.queryCommandState(b.getAttribute("data-cmd")); } catch (e) {}
      b.classList.toggle("is-active", on);
    });
  }
  function ensureCanvasFmtBar() {
    if (__canvasFmtBar) return __canvasFmtBar;
    var bar = h("div", "canvas-fmtbar"); bar.setAttribute("data-canvas-fmtbar", "1");
    FORMAT_TOGGLES.filter(function (t) { return t.kind === "inline-exec"; }).forEach(function (t) {
      var b = h("button", "canvas-fmtbar__btn"); b.type = "button"; b.title = t.title;
      b.setAttribute("data-cmd", t.cmd);
      var glyph = FMTBAR_GLYPH[t.cmd];
      if (glyph && window.Icon) b.innerHTML = window.Icon(glyph); else b.textContent = t.label;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the field's selection
      b.addEventListener("click", function () { document.execCommand(t.cmd, false, null); syncCanvasFmtBarActive(bar); });
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
    __canvasFmtBar = bar; return bar;
  }
  // Shows/positions the bar for a text selection in a canvas field; hides it otherwise. The Source
  // stage's own selbar owns [data-node] selections, so this only ever binds to [data-edit] fields --
  // the two never collide.
  function onCanvasSelectionChange() {
    if (typeof document === "undefined") return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { hideCanvasFmtBar(); return; }
    var r = sel.getRangeAt(0);
    if (!canvasEditableFieldOf(r.commonAncestorContainer)) { hideCanvasFmtBar(); return; }
    var rect = r.getBoundingClientRect();
    if (!rect || !rect.width) { hideCanvasFmtBar(); return; }
    var bar = ensureCanvasFmtBar();
    syncCanvasFmtBarActive(bar);
    bar.style.left = (rect.left + rect.width / 2) + "px";
    bar.style.top = rect.top + "px"; // a CSS transform centres + lifts it above the selection
  }
  /* @canvas-fmtbar-end */
  function buildFormatToggleBar(io) {
    var bar = h("div", "prop-toggle-row");
    var execBtns = [];
    var listBtn = null;
    FORMAT_TOGGLES.forEach(function (t) {
      if (t.kind === "inline-exec") {
        var b = h("button", "prop-toggle" + (formatCmdOn(t.cmd) ? " is-on" : ""), t.label);
        if (t.title) b.title = t.title;
        b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the field's text selection
        b.addEventListener("click", function () {
          var node = io.getNode(); if (!node) return;
          node.focus();
          document.execCommand(t.cmd, false, null);
          io.onChange();
          b.classList.toggle("is-on", formatCmdOn(t.cmd));
        });
        bar.appendChild(b);
        execBtns.push({ el: b, cmd: t.cmd });
      } else if (t.kind === "link") {
        // Inline hyperlink: link the selected text to an external URL (opens in a new tab).
        // createLink doesn't set target, so post-add target=_blank + rel; the <a> round-trips
        // render + export (sanitizeFieldHtml keeps href/target/rel). Empty URL removes the link.
        var linkB = h("button", "prop-toggle" + (formatSelectionAnchor() ? " is-on" : ""), "Link");
        linkB.title = "Link the selected text to an external URL (opens in a new tab)";
        linkB.addEventListener("mousedown", function (e) { e.preventDefault(); });
        linkB.addEventListener("click", function () {
          var node = io.getNode(); if (!node) return;
          var a = formatSelectionAnchor(), sel = window.getSelection();
          if (!a && (!sel || sel.isCollapsed)) { window.alert("Select some text first, then click Link."); return; }
          // Save the text selection — the modal steals focus, so restore the Range before execCommand.
          var savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
          promptModal("Link", "URL (opens in a new tab; leave blank to remove)", a ? a.getAttribute("href") : "https://", function (url) {
            var n2 = io.getNode(); if (!n2) return;
            n2.focus();
            if (savedRange) { var s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(savedRange); }
            url = (url || "").trim();
            if (!url) { document.execCommand("unlink", false, null); }
            else {
              document.execCommand("createLink", false, url);
              Array.prototype.forEach.call(n2.querySelectorAll("a[href]"), function (el) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); });
            }
            io.onChange();
          });
        });
        bar.appendChild(linkB);
        var unlinkB = iconBtn("unlink", "Remove the link");
        unlinkB.addEventListener("mousedown", function (e) { e.preventDefault(); });
        unlinkB.addEventListener("click", function () { var n3 = io.getNode(); if (!n3) return; n3.focus(); document.execCommand("unlink", false, null); io.onChange(); });
        bar.appendChild(unlinkB);
      } else if (t.kind === "list-block") {
        // #170/#33: converts the WHOLE block to/from the dedicated "list" type (on-state
        // reads block.type, not queryCommandState). Not every surface/field supports this
        // (e.g. a quiz sub-field can't become a top-level list block), so the button is
        // hidden -- not just disabled -- when io.isListToggleable() says no. A persisting
        // bar (copy editor) re-derives visibility on every bar.refresh(), since which row
        // is focused changes without the bar itself being rebuilt.
        if (!io.isListToggleable || !io.isListBlock || !io.toggleListBlock) return;
        var listB = h("button", "prop-toggle prop-toggle--icon");
        listB.type = "button";
        listB.title = "List — converts this block to/from a bulleted list";
        listB.innerHTML = Icon("list");
        listB.addEventListener("mousedown", function (e) { e.preventDefault(); });
        listB.addEventListener("click", function () { io.toggleListBlock(); });
        bar.appendChild(listB);
        listBtn = listB;
      }
    });
    // Resync every inline-exec button's active state against the CURRENT selection, plus
    // the list-block toggle's visibility/state -- callers that persist across re-focus
    // (the copy editor's format bar, built once) use this instead of rebuilding; a surface
    // that rebuilds the bar every render still gets a correct initial state (called below).
    bar.refresh = function () {
      var active = !!io.getNode();
      execBtns.forEach(function (o) { o.el.classList.toggle("is-on", active && formatCmdOn(o.cmd)); });
      if (listBtn) {
        var canList = !!(io.isListToggleable && io.isListToggleable());
        listBtn.hidden = !canList;
        if (canList) listBtn.classList.toggle("is-on", !!(io.isListBlock && io.isListBlock()));
      }
    };
    bar.refresh();
    return bar;
  }
  window.__buildFormatToggleBar = buildFormatToggleBar; // headless test hook

  // Panel System v2 (James 2026-07-08): the generalised custom listbox. Same shape as
  // buildFontPicker (a button + popup, exposes `.value` get/set, fires 'change' on pick)
  // but each option can carry a live PREVIEW instead of a bare word — a CSS style applied
  // to the row+button (e.g. render a text-style name IN that style) and/or preview HTML
  // (e.g. the actual bullet glyph). Reuses the .font-picker chrome so styling stays shared.
  // options: [value, label, meta?]  meta = { style?: cssText, html?: rowInnerHTML,
  // btnHtml?: buttonInnerHTML (falls back to html) }.
  function customSelect(current, options, onPick, opts) {
    opts = opts || {};
    var wrap = h("div", "font-picker custom-select");
    var btn = h("button", "font-picker__btn prop-select"); btn.type = "button";
    var pop = h("div", "font-picker__pop"); pop.hidden = true;
    var val = current == null ? "" : String(current);
    function find(v) { for (var i = 0; i < options.length; i++) { if (String(options[i][0]) === String(v)) return options[i]; } return null; }
    function paintBtn() {
      var o = find(val) || options[0] || ["", opts.placeholder || ""];
      var meta = o[2] || {};
      btn.style.cssText = ""; // clear any prior preview style
      if (meta.btnHtml || meta.html) btn.innerHTML = meta.btnHtml || meta.html; else btn.textContent = o[1];
      if (meta.style) btn.style.cssText = meta.style;
    }
    options.forEach(function (o) {
      var meta = o[2] || {};
      var row = h("div", "font-picker__opt" + (String(o[0]) === val ? " is-active" : ""));
      if (meta.html) row.innerHTML = meta.html; else row.textContent = o[1];
      if (meta.style) row.style.cssText = meta.style;
      row.addEventListener("click", function () {
        val = String(o[0]); paintBtn();
        Array.prototype.forEach.call(pop.children, function (c) { c.classList.remove("is-active"); });
        row.classList.add("is-active");
        close(); onPick(o[0]);
        try { wrap.dispatchEvent(new Event("change")); } catch (_) {}
      });
      pop.appendChild(row);
    });
    function onDoc(e) { if (!wrap.contains(e.target)) close(); }
    function onEsc(e) { if (e.key === "Escape") close(); }
    function open() { pop.hidden = false; btn.classList.add("is-open"); setTimeout(function () { document.addEventListener("mousedown", onDoc); }, 0); document.addEventListener("keydown", onEsc); }
    function close() { pop.hidden = true; btn.classList.remove("is-open"); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); }
    btn.addEventListener("click", function () { pop.hidden ? open() : close(); });
    wrap.appendChild(btn); wrap.appendChild(pop);
    paintBtn();
    Object.defineProperty(wrap, "value", { get: function () { return val; }, set: function (v) { val = v == null ? "" : String(v); paintBtn(); } });
    return wrap;
  }
  window.__customSelect = customSelect; // headless test hook
  // Drop-in for selectRow that renders a customSelect (with previews) instead of a native
  // <select>. Same signature + pushHistory-on-pick behaviour, appended to `inspector`.
  function customSelectRow(label, options, current, onchange, opts) {
    inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", label));
    var cs = customSelect(current, options, function (v) { pushHistory(); onchange(v); }, opts);
    inspector.appendChild(cs);
    return cs;
  }

  // Panel System v2 (D4) — the ONE reusable Type control body. Renders font/weight/size/
  // colour(colorField)/line-height/tracking/word-spacing/case/indent/alignment onto `model`,
  // calling onChange() after each edit. Mounted IDENTICALLY in the field inspector AND the
  // Edit-Text-Style dialog. `model` fields: font,weight,size,lineHeight,letterSpacing,
  // wordSpacing,textTransform,textIndent,align,color,colorToken,colorLight,colorDark.
  // opts (field-inspector only): { fieldNode, applyWeightToSelection(weight, range) }.
  // When present, the Weight control is SELECTION-AWARE — highlighted text is weighted
  // inline (a font-weight span) and the whole-field model.weight is left untouched; with
  // no live selection it sets model.weight as before. The Edit-Text-Style dialog passes no
  // opts (there is no live text there), so its Weight stays whole-model. #99/#44 follow-up:
  // this collapses the old twin whole-field + selection weight controls into one.
  function typeCluster(container, model, onChange, opts) {
    onChange = onChange || function () {};
    container.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Font"));
    var fp = buildFontPicker(model.font || "", function (v) { model.font = v; onChange(); });
    container.appendChild(fp);
    container.appendChild(attachFontWarn(fp));
    // Size + Weight
    var size = iconField("A", { value: model.size == null ? "" : model.size, unit: "px", placeholder: "auto", step: 1, min: 1, max: 200, datalist: "dl-font-size", noHistory: true, title: "Font size",
      onchange: function (v) { var n = parseInt(v, 10); model.size = isNaN(n) ? undefined : n; onChange(); } }).wrap;
    // Selection-aware (field inspector): opening the <select> steals focus + collapses the
    // selection, so capture the live field range on mousedown (same trick the Link button uses).
    var savedWtRange = null;
    var wt = dsSelect([["Weight", ""], ["Regular", "400"], ["Medium", "500"], ["Semibold", "600"], ["Bold", "700"], ["Extra", "800"]], model.weight || "", function (weight) {
      if (savedWtRange && opts && opts.applyWeightToSelection) {
        var range = savedWtRange; savedWtRange = null;
        if (!weight) return; // empty on a live selection = no-op (don't clear the whole field)
        if (opts.applyWeightToSelection(weight, range)) return; // weighted the selection inline
      }
      model.weight = weight; onChange(); // no selection -> whole field (or the style draft)
    });
    if (opts && opts.fieldNode) {
      wt.addEventListener("mousedown", function () {
        var sel = window.getSelection();
        var r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
        savedWtRange = (r && !r.collapsed && opts.fieldNode.contains(r.commonAncestorContainer)) ? r.cloneRange() : null;
      });
    }
    container.appendChild(twoUp(size, wt));
    // Colour — the unified colorField (token XOR hex XOR per-mode).
    function tcVal() { return model.colorToken ? { token: model.colorToken } : (model.colorLight || model.colorDark ? { light: model.colorLight, dark: model.colorDark } : (model.color != null ? { hex: model.color } : null)); }
    colorField("Colour", tcVal(), function (v) {
      delete model.color; delete model.colorToken; delete model.colorLight; delete model.colorDark;
      if (v && v.token) model.colorToken = v.token;
      else if (v && (v.light || v.dark)) { model.colorLight = v.light; model.colorDark = v.dark; }
      else if (v && v.hex) model.color = v.hex;
      onChange();
    }, container);
    // Line-height + tracking
    container.appendChild(twoUp(
      iconField(Icon("line-height"), { value: model.lineHeight == null ? "" : model.lineHeight, placeholder: "1.5", step: 0.05, min: 0.5, max: 3, datalist: "dl-line-height", noHistory: true, title: "Line height",
        onchange: function (v) { model.lineHeight = (v ? v : undefined); onChange(); } }).wrap,
      iconField(Icon("letter-spacing"), { value: model.letterSpacing == null ? "" : model.letterSpacing, unit: "px", placeholder: "0", step: 0.1, min: -10, max: 50, datalist: "dl-letter-spacing", noHistory: true, title: "Letter spacing",
        onchange: function (v) { var n = parseFloat(v); model.letterSpacing = isNaN(n) ? undefined : n; onChange(); } }).wrap));
    // Word-spacing + first-line indent
    container.appendChild(twoUp(
      iconField(Icon("word-spacing"), { value: model.wordSpacing == null ? "" : model.wordSpacing, unit: "px", placeholder: "0", step: 0.5, min: -20, max: 100, datalist: "dl-gap", noHistory: true, title: "Word spacing",
        onchange: function (v) { var n = parseFloat(v); model.wordSpacing = isNaN(n) ? undefined : n; onChange(); } }).wrap,
      iconField(Icon("indent-increase"), { value: model.textIndent == null ? "" : model.textIndent, unit: "px", placeholder: "0", step: 2, min: 0, max: 200, datalist: "dl-gap", noHistory: true, title: "First-line indent",
        onchange: function (v) { var n = parseInt(v, 10); model.textIndent = isNaN(n) ? undefined : n; onChange(); } }).wrap));
    // Case + Alignment (icon segments)
    segmentedLive("Case", [["None", ""], ["UPPER", "uppercase"], ["lower", "lowercase"], ["Title", "capitalize"]],
      function (val) { return (model.textTransform || "") === val; },
      function (val) { model.textTransform = val || undefined; onChange(); }, container, true);
    segmentedIconLive("Align", [[Icon("align-left"), "left", "Left"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "right", "Right"], [Icon("align-justify"), "justify", "Justify"]],
      function (val) { return (model.align || "left") === val; },
      function (val) { model.align = val; onChange(); }, container, true);
  }
  window.__typeCluster = typeCluster; // test hook

  // Builds the "not embeddable" warning note for a font <select> and keeps it in
  // sync with the current value. Returns the note node; the caller places it just
  // under the picker. Hidden while the choice is safe; shown (flex) otherwise.
  function attachFontWarn(selectEl) {
    var note = h("div", "font-embed-warn");
    var ic = h("span", "font-embed-warn__icon", "!"); ic.setAttribute("aria-hidden", "true");
    note.appendChild(ic);
    note.appendChild(h("span", "font-embed-warn__text", "Not in the embeddable set - may not render on an offline/air-gapped machine unless embedded at export."));
    function sync() { note.style.display = isEmbeddableFont(selectEl.value) ? "none" : "flex"; }
    selectEl.addEventListener("change", sync);
    sync();
    return note;
  }
  // ---- Scope + inheritance (uio-F03 — the UI spine's five-rung ladder) -------------
  // arch-P3b-07b: the ladder, its resolver and the row anatomy moved to
  // editor/inspector/primitives.js. The scope TALLY moved with them -- this file used to hold the
  // buffer and lend it out through a getter and a setter because neither end had left yet.
  var BOX_SYSTEM_DEFAULTS;   // data, not an entry point -- read from its owner after install

  var scopeLabel = VE.bind("scopeLabel");
  var scopeDepth = VE.bind("scopeDepth");
  var scopeRung = VE.bind("scopeRung");
  var scopeChain = VE.bind("scopeChain");
  var resolveScoped = VE.bind("resolveScoped");
  var resetPlan = VE.bind("resetPlan");
  var resetTooltip = VE.bind("resetTooltip");
  var inheritedTooltip = VE.bind("inheritedTooltip");
  var overrideCount = VE.bind("overrideCount");
  var rollupLabel = VE.bind("rollupLabel");
  var tallyResolution = VE.bind("tallyResolution");
  var inheritanceTail = VE.bind("inheritanceTail");
  var onOffLabel = VE.bind("onOffLabel");
  var blockBoxChain = VE.bind("blockBoxChain");
  var gateScopeChain = VE.bind("gateScopeChain");
  var settingsRow = VE.bind("settingsRow");
  var crossRefRow = VE.bind("crossRefRow");
  var fieldRow = VE.bind("fieldRow");


  // ---- QQ: colour picker -----------------------------------------
  // arch-P3b-07: the whole colour region -- the hex/HSV maths, colourControl and its anchored
  // popover, and the Panel System v2 colorField/colorFieldFlat -- lives in editor/color.js now.
  // Three entry points come back, because thirty-five call sites in this file (and the hotspots
  // editor) place a colour row. window.resolveColorField, window.__colourMath and
  // window.__colorField are set by that file and are unchanged.
  // One `var` each, not a comma continuation: the UI-kit seam gate checks every __kit export is
  // declared at this file's own top level, and it matches on the line start.
  var colourControl = VE.bind("colourControl");
  var colorField = VE.bind("colorField");
  var colorFieldFlat = VE.bind("colorFieldFlat");

  // arch-P3b-07b: the row and container primitives moved to editor/inspector/primitives.js with
  // the rest of the canonical control set. renderContainerChrome went with them: it is that set
  // composed for every block with a box around it, not a block inspector of its own.
  var CONTAINER_IO_KEYS;   // data, not an entry point -- read from its owner after install

  var segmentedLive = VE.bind("segmentedLive");
  var iconField = VE.bind("iconField");
  var twoUp = VE.bind("twoUp");
  var propHeader = VE.bind("propHeader");
  var breadcrumb = VE.bind("breadcrumb");
  var optionalRow = VE.bind("optionalRow");
  var repeatedList = VE.bind("repeatedList");
  var renderContainerChrome = VE.bind("renderContainerChrome");


  // ---- shared modal builders (the canonical .modal-* dialog pattern) -------
  // arch-P3b-07c: the eight builders moved to editor/modals.js. The field inspector, the instance
  // inspector and the block-reselect helpers shared this banner and are separate concerns; they
  // stayed.
  var modalHead = VE.bind("modalHead");
  var modalSection = VE.bind("modalSection");
  var modalField = VE.bind("modalField");
  var modalText = VE.bind("modalText");
  var modalActions = VE.bind("modalActions");
  var dsModalShell = VE.bind("dsModalShell");
  var promptModal = VE.bind("promptModal");
  var confirmModal = VE.bind("confirmModal");


  // Caret currently inside a list item within this field? Any rich field can hold an
  // inline list, so Tab-nesting + paste-clean apply wherever the caret sits in an <li>.
  function caretInList(fieldNode) {
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.anchorNode) return false;
    var a = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    var li = a && a.closest ? a.closest("li") : null;
    return !!(li && fieldNode.contains(li));
  }
  function renderFieldInspector(node) {
    var obj = node.__bind.obj, field = node.__bind.field;
    // Style host: a per-field styleKey (quiz sub-fields that share a parent obj —
    // done.title/body, question prompt/feedback) keeps each field's style separate so
    // formatting one doesn't bleed onto its sibling; absent -> style lives on obj itself.
    var styleKey = node.__bind.styleKey;
    var host = styleKey ? (obj[styleKey] || (obj[styleKey] = {})) : obj;
    // plain fields keep a simple textarea
    if (!node.getAttribute("data-rich")) {
      var plainBody = panelSection(inspector, field);
      var input = h("textarea", "prop-input");
      input.value = obj[field];
      input.addEventListener("input", function () { writeModel(node, input.value); if (node.textContent !== input.value) node.textContent = input.value; });
      plainBody.appendChild(input);
      return;
    }
    // rich field -> Text properties (in the panel, no floating window)
    var s = host.style || (host.style = {});
    function apply() { window.applyTextStyle(node, s); renderModelView(); }

    var head = h("div", "prop-component"); head.appendChild(h("span", null, "Text")); inspector.appendChild(head);
    // uio-F04 (EDIT-06): editing the text of a source-linked block is exactly when its provenance
    // matters, so the same line the block inspector carries appears here too. Same call, so the two
    // panels can never say different things about the same block.
    var fieldProv = renderSourceLinkProvenance(obj);
    if (fieldProv) inspector.appendChild(fieldProv);

    // Panel System v2 (D3): the flagship reference panel adopts the sectionGroup taxonomy —
    // a "Type" section (style picker + typeCluster + inline B/I/U/link) and a "Content"
    // section (list controls), so the Edit-layout drag mode + global ranking work here live.
    beginSections();
    sectionGroup("Type", "Type", function (secBody) {
    var _ins = inspector; inspector = secBody;
    try {
    // saved named text styles (A pass 2): applying one copies the preset's props
    // onto block.style (the same shape applyTextStyle + export already consume).
    var presets = getTextStyles();
    var presetNames = Object.keys(presets);
    if (presetNames.length) {
      // Preview each named style IN that style (font/weight/case) instead of a bare word.
      function stylePreviewCss(p) {
        var css = "";
        if (p && p.font && window.fontStackFor) css += "font-family:" + window.fontStackFor(p.font) + ";";
        if (p && p.weight) css += "font-weight:" + p.weight + ";";
        if (p && p.textTransform) css += "text-transform:" + p.textTransform + ";";
        return css;
      }
      var styleOpts = [["", "Apply a preset…"]].concat(presetNames.map(function (n) { return [n, n, { style: stylePreviewCss(presets[n]) }]; }));
      var psel = customSelectRow("Text style", styleOpts, (host.styleRef || ""), function (v) {
        if (!v) { delete host.styleRef; renderInspector(); return; } // "detach" -> keep current props as its own
        if (!presets[v]) return;
        // LLL: REFERENCE the named style (edits to it propagate to every block using
        // it); per-block tweaks below become overrides in host.style that win.
        pushHistory();
        host.styleRef = v; host.style = {}; s = host.style;
        // WWW: the style's colour must WIN — strip inline colour baked into the field's
        // rich HTML (else an inner <span style="color:"> beats the container colour
        // applyTextStyle sets and the applied colour looks "stuck").
        if (typeof obj[field] === "string") {
          var stripped = stripInlineColor(obj[field]);
          if (stripped !== obj[field]) { obj[field] = stripped; node.innerHTML = stripped; }
        }
        window.applyRenderContext({ docStyles: getTextStyles() });
        window.applyTextStyle(node, window.resolveBlockStyle(host)); renderModelView();
        renderInspector(); // clears + rebuilds (renderFieldInspector alone would append a 2nd copy)
      });
      psel.title = "Reference a named style. Editing that style later updates every block using it; tweaks here override just this block.";
    }

    // Panel System v2 (D4): the unified typeCluster — the SAME control body the Edit-Text-
    // Style dialog mounts. Covers font/weight/size/colour(the unified colorField)/line-
    // height/tracking/word-spacing/case/indent/alignment, writing to the field style `s`
    // (host.style override — so tweaking a styled field overrides just THIS field, D4).
    // #99/#44: the Weight control is selection-aware here — highlighted characters get an
    // inline font-weight span (a brand name with mixed weight, e.g. regular + semibold, in one heading);
    // no selection sets the whole field. Raw inline style => literal HTML in obj.text, so
    // render.js round-trips it and editor == export (survives sanitizeFieldHtml, which keeps
    // font-weight). Weight-ONLY, never touches the run's size/font/colour. surroundContents
    // throws when the range crosses element boundaries -> extract+insert handles that (v1
    // accepts nested spans; innermost wins; undo/Regular reverts).
    typeCluster(inspector, s, apply, {
      fieldNode: node,
      applyWeightToSelection: function (weight, range) {
        node.focus();
        var sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        var r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
        if (!r || r.collapsed) return false; // fall back to whole field
        pushHistory();
        var span = document.createElement("span"); span.style.fontWeight = weight;
        try { r.surroundContents(span); }
        catch (e) { span.appendChild(r.extractContents()); r.insertNode(span); }
        obj[field] = sanitizeFieldHtml(node.innerHTML); renderModelView(); scheduleSave();
        return true;
      }
    });

    // Row 4: Inline style (B / I / U / Link / List) — #170/#158/#33: the shared canonical
    // toggle-bar builder, also used by the Course Copy Editor (buildCopyFormatBar). List is
    // now a whole block-TYPE conversion (block.type <-> "list"), not an inline execCommand
    // list -- on-state reads the model, and clicking converts the block in place via
    // convertTextListBlockType, remembering the prior type for a lossless round-trip. Only
    // genuine top-level text-content blocks (obj.type in TEXT_CONTENT_TYPES) can convert --
    // a quiz sub-field (obj has no .type) never shows the List toggle.
    inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Style"));
    var rootIsList = node.tagName === "UL" || node.tagName === "OL";
    var biu = buildFormatToggleBar({
      getNode: function () { return node; },
      onChange: function () { obj[field] = sanitizeFieldHtml(node.innerHTML); renderModelView(); },
      isListToggleable: function () { return field === "text" && !!obj && !!obj.type && !!TEXT_CONTENT_TYPES[obj.type]; },
      isListBlock: function () { return !!obj && obj.type === "list"; },
      toggleListBlock: function () {
        pushHistory();
        convertTextListBlockType(obj);
        reapplyStructural(findPageOfBlock(obj));
        reselectBlockNode(obj, "field"); // re-renders the inspector fresh (new type + marker section)
      }
    });
    inspector.appendChild(biu);

    // List marker settings — the on/off toggle now lives in the inline-format bar above.
    // Purely the marker styling, shown only when the field IS a list block (#31: the quiz
    // Chapter-summary <ul> is its own root-<ul> field; the list block itself is rootIsList).
    // One <ul> renders disc / numbered / lettered alike (list-style-type is tag-agnostic),
    // so the marker (incl. Numbered / Lettered / Roman) lives entirely in the Bullet-style
    // dropdown; marker size stays a numeric iconField (exception).
    if (rootIsList) {
      var _typeBody = inspector; inspector = panelSection(_typeBody, "List");
      var MARKERS =[["Disc", "disc"], ["Circle", "circle"], ["Square", "square"], ["Dash", "dash"], ["Arrow", "arrow"], ["Check", "check"], ["Numbered 1.", "decimal"], ["Lettered a.", "lower-alpha"], ["Roman i.", "lower-roman"], ["Custom", "custom"]];
      var MARK_GLYPH = { disc: "•", circle: "◦", square: "▪", dash: "–", arrow: "→", check: "✓", decimal: "1.", "lower-alpha": "a.", "lower-roman": "i.", custom: (obj.listMarkerChar || "✱") };
      var markerOpts = MARKERS.map(function (o) { var g = MARK_GLYPH[o[1]] || ""; return [o[1], o[0], { html: '<span class="cs-mark">' + g + '</span>' + o[0] }]; });
      customSelectRow("Bullet style", markerOpts, (obj.listMarker || "disc"), function (v) {
        if (v === "disc") delete obj.listMarker; else obj.listMarker = v;
        if (v === "disc") node.removeAttribute("data-list-marker"); else node.setAttribute("data-list-marker", v);
        renderModelView();
        renderInspector();
      });
      if (obj.listMarker === "custom") {
        fieldRow("Custom character", obj.listMarkerChar || "", function (val) {
          if (val) { obj.listMarkerChar = val; node.style.setProperty("--li-marker", JSON.stringify(val + " ")); }
          else { delete obj.listMarkerChar; node.style.removeProperty("--li-marker"); }
          renderModelView();
        }, "e.g.  →  ✓  ▪");
      }
      colorFieldFlat("Marker colour", obj.listMarkerColor, function (v) {
        if (v == null) { delete obj.listMarkerColor; node.style.removeProperty("--li-marker-color"); }
        else { obj.listMarkerColor = v; node.style.setProperty("--li-marker-color", v); }
        renderModelView();
      });
      inspector.appendChild(iconField("H", { value: obj.listMarkerSize == null ? "" : obj.listMarkerSize, unit: "em", placeholder: "1", step: 0.1, min: 0.5, max: 4, datalist: "dl-gap", title: "Marker size (relative to text)",
        onchange: function (val) { pushHistory(); var n = parseFloat(val); if (isNaN(n)) { delete obj.listMarkerSize; node.style.removeProperty("--li-marker-size"); } else { obj.listMarkerSize = n; node.style.setProperty("--li-marker-size", n + "em"); } renderModelView(); } }).wrap);
      inspector = _typeBody;
    }
    } finally { inspector = _ins; }
    });
    endSections(inspector);

    // uio-E-C02 (EDIT-02): one inspector scroll, no cross-panel jump link. This REVERSES the
    // 2026-07-08 progressive-disclosure split (James's call 2026-07-30, option A): editing a
    // top-level text block now shows the SAME full panel as block-select — the block's
    // Position / Layout / Spacing / Appearance / Behaviour chrome sits right below Type, in one
    // scroll, and the old "-> block settings" jump link is gone. Esc still steps out to the block.
    var blk = node.__block;
    var showBlockChrome = blk && blk.type && TEXT_CONTENT_TYPES[blk.type] && !versionEditable();
    if (showBlockChrome) {
      // Same builder + decl the block two-level inspector uses (renderBlockInspector -> text ->
      // renderBlockTwoLevel with CONTENT_DECL), so the section set/wiring is identical.
      renderContainerChrome(inspector, CONTENT_DECL, blockChromeIo(blk), blockChromeHandlers(blk));
    } else {
      // Quiz sub-fields (a rich field on a non-text block) still bridge to their block's own
      // settings; and while editing a non-base software version the block chrome would be
      // present-but-inert (per applyVersionEditGuard), so the focused text panel + link stay.
      var backHint = h("button", "insp-hint insp-backlink", "Layout, spacing & appearance → block settings");
      backHint.type = "button";
      backHint.title = "These act on the whole block, not the text. Click to select the block (or press Esc).";
      backHint.addEventListener("mousedown", function (e) { e.preventDefault(); });
      backHint.addEventListener("click", function () { blurActiveText(); resetDrill(); reselectBlockNode(selection.block, "block"); });
      inspector.appendChild(backHint);
    }
  }

  // a component instance selected -> sectioned, properties
  function renderInstanceInspector(card) {
    var instance = card.__instance, block = card.__block, index = card.__index, def = card.__def;

    var head = h("div", "prop-component prop-component--instance");
    head.appendChild(h("span", null, def.name));
    inspector.appendChild(head);

    // Content
    var _instRoot = inspector;
    inspector = panelSection(_instRoot, "Content");
    def.slots.forEach(function (slot) {
      var control;
      if (slot.multiline) {
        inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", slot.label));
        control = h("textarea", "prop-input");
      } else {
        var row = h("div", "insp-row");
        row.appendChild(h("span", "insp-row__label", slot.label));
        control = h("input", "prop-text"); control.type = "text";
        row.appendChild(control);
        inspector.appendChild(row);
      }
      control.spellcheck = false;
      control.value = instance.slots[slot.key] == null ? "" : instance.slots[slot.key];
      if (slot.multiline) inspector.appendChild(control);
      control.addEventListener("input", function () {
        instance.slots[slot.key] = control.value;
        var target = card.querySelector('[data-edit="' + slot.key + '"]');
        if (target && target.textContent !== control.value) target.textContent = control.value;
        renderModelView();
      });
      panelFields[slot.key] = control;
    });

    // Variant (style-swap)
    if (def.variants && def.variants.status) {
      inspector = panelSection(_instRoot, "Variant");
      var row = h("div", "prop-toggle-row");
      def.variants.status.options.forEach(function (opt) {
        var on = (instance.status || def.variants.status.default) === opt;
        var b = h("button", "prop-toggle" + (on ? " is-on" : ""), opt);
        b.addEventListener("click", function () { pushHistory(); instance.status = opt; renderModelView(); reflectStatus(card); renderInspector(); });
        row.appendChild(b);
      });
      inspector.appendChild(row);
    }

    // Actions (flagship): where this card navigates on click
    inspector = _instRoot;
    buildActions(instance, card, function () { reselectByIndex(block, index); });

    // Component (instance-specific): detach from the component definition. Hide /
    // move / duplicate / delete now live in the shared footer below, so this row
    // holds only the action the footer can't express.
    inspector = panelSection(_instRoot, "Component");
    var compRow = h("div", "icon-row");
    var detach = iconBtn("unlink", instance.detached ? "Detached" : "Detach from component");
    if (instance.detached) detach.classList.add("is-on");
    detach.addEventListener("click", function () { pushHistory(); instance.detached = true; mount(); reselectByIndex(block, index); });
    compRow.appendChild(detach);
    inspector.appendChild(compRow);
    inspector = _instRoot;

    // Grid — the cards row carries the "+" add affordance (same handler as before).
    inspector = panelSection(_instRoot, "Grid");
    inspector.appendChild(propHeader("Cards", function () {
      pushHistory();
      var fresh = { status: "incomplete", slots: {} };
      def.slots.forEach(function (s) { fresh.slots[s.key] = ""; });
      fresh.slots[def.slots[0].key] = String(block.instances.length + 1).padStart(2, "0");
      fresh.slots[def.slots[1].key] = "New " + def.name;
      block.instances.push(fresh);
      mount();
    }, "Add " + def.name));

    var selGrid = h("button", "prop-btn", "Select parent grid");
    selGrid.style.marginTop = "8px";
    selGrid.addEventListener("click", function () {
      var gridNode = card.parentNode;
      setSelection("block", gridNode);
    });
    inspector.appendChild(selGrid);
    inspector = _instRoot;

    // Shared footer — SAME markup as every other inspector, wired to operate on
    // this card within its grid's instances[] rather than a page's blocks[].
    renderBlockActionsSection(block, {
      spaceObj: instance,
      onSpace: function () { mount(); reselectByIndex(block, index); },
      move: function (dir) {
        var arr = block.instances, ni = index + dir;
        if (ni < 0 || ni >= arr.length) return;
        pushHistory();
        var t = arr[index]; arr[index] = arr[ni]; arr[ni] = t;
        mount(); reselectByIndex(block, ni);
      },
      duplicate: function () { pushHistory(); block.instances.splice(index + 1, 0, clone(instance)); mount(); reselectByIndex(block, index + 1); },
      remove: function () { pushHistory(); block.instances.splice(index, 1); mount(); clearSelection(); },
      isHidden: function () { return !!instance.hidden; },
      toggleHidden: function () { pushHistory(); instance.hidden = !instance.hidden; mount(); reselectByIndex(block, index); },
      isLocked: function () { return !!instance.locked; },
      toggleLock: function () { pushHistory(); instance.locked = !instance.locked; mount(); reselectByIndex(block, index); }
    });
  }

  // live status class swap on canvas without a re-mount (keeps selection)
  function reflectStatus(card) {
    var s = card.__instance.status === "complete" ? "complete" : "incomplete";
    card.classList.remove("is-complete", "is-incomplete");
    card.classList.add("is-" + s);
  }
  // after a re-mount, re-find the same instance's card and reselect it
  function reselectByIndex(block, index) {
    var target = null;
    Array.prototype.forEach.call(canvas.querySelectorAll("[data-instance]"), function (c) {
      if (c.__block === block && c.__index === index) target = c;
    });
    if (target) setSelection("instance", target); else clearSelection();
  }
  // after a re-mount, re-find a top-level block's canvas node and reselect it
  function reselectBlockNode(block, type) {
    var target = null;
    // search ALL blocks (incl. nested in a card/columns), not just top-level,
    // so re-selecting a nested block/button after a change doesn't fall through
    // to clearSelection.
    Array.prototype.forEach.call(canvas.querySelectorAll(".canvas-block, [data-embed]"), function (n) {
      if (n.__block === block) target = n;
    });
    if (target) setSelection(type, target); else clearSelection();
  }

  // Drop an image FILE from the desktop straight onto an image block (filled or the
  // empty placeholder) to set/replace its src -- no inspector round-trip. Fires ONLY
  // for EXTERNAL file drags (internal block moves carry `dragPayload`, which stays
  // null here) and only for an image/* file, reusing the EXACT inspector upload path
  // (FileReader -> assetRef -> block.src) so it stores in the asset store + ships in
  // export identically. A dashed drop-highlight marks the target while hovering.
  function externalImageDrag(e) {
    if (dragPayloadNow()) return false; // an internal block move -> leave it to makeDropTarget
    var dt = e.dataTransfer; if (!dt) return false;
    // dragover doesn't expose file contents, only that Files are present
    return Array.prototype.indexOf.call(dt.types || [], "Files") !== -1;
  }
  function attachImageFileDrop(node, block) {
    node.addEventListener("dragover", function (e) {
      if (!externalImageDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      node.classList.add("is-file-drop");
    });
    node.addEventListener("dragleave", function (e) { if (e.target === node) node.classList.remove("is-file-drop"); });
    node.addEventListener("drop", function (e) {
      if (dragPayloadNow()) return; // internal move -> normal drop logic owns it
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !/^image\//.test(f.type)) { node.classList.remove("is-file-drop"); return; }
      e.preventDefault(); e.stopPropagation();
      node.classList.remove("is-file-drop");
      var r = new FileReader();
      r.onload = function () { pushHistory(); block.src = assetRef(r.result, f); reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); };
      r.readAsDataURL(f);
    });
  }

  // ---- Actions (flagship: prototype navigation) ----------------------------
  // arch-P3b-07: what a learner's click does -- the action model, its panel and the "On click"
  // list -- moved to editor/actions.js. An action targets a PAGE ID, never an index.
  var renderNavButtonInspector = VE.bind("renderNavButtonInspector");
  var renderOnClickSection = VE.bind("renderOnClickSection");
  var pageIndexById = VE.bind("pageIndexById");
  var pageById = VE.bind("pageById");
  var buildActions = VE.bind("buildActions");
  var buildTargetPicker = VE.bind("buildTargetPicker");
  var currentGoto = VE.bind("currentGoto");
  var setGoto = VE.bind("setGoto");


  // ...continues in interact.js (arch-P3b-07).


  // ---- editing wiring (across all frames) ----------------------------------
  // arch-P3b-07n: what turns render()'s output into something typeable -- contentEditable, the
  // drop targets, the column resizers, the embed shield and the collab edit lifecycle -- moved to
  // editor/editing.js. It is the file the pure-render invariant is about.
  var enableEditing = VE.bind("enableEditing");
  var wireEmbedNode = VE.bind("wireEmbedNode");
  var enterTextEdit = VE.bind("enterTextEdit");
  var selectFieldNode = VE.bind("selectFieldNode");
  var blockLocked = VE.bind("blockLocked");
  var twoStateText = VE.bind("twoStateText");
  var setTwoStateText = VE.bind("setTwoStateText");
  var collabBlockOf = VE.bind("collabBlockOf");
  var caretOffsetIn = VE.bind("caretOffsetIn");


  // Hotspot block on the canvas: markers drag to reposition (updates x/y %), and a
  // plain click opens that hotspot for editing (reveals its popover so its child
  // blocks become editable). stopPropagation keeps the canvas from panning /
  // selecting. Reposition uses the stage's on-screen rect so it is zoom-correct
  // (rect + pointer are both in screen px). The popover close button just conceals
  // the reveal here — the runtime (demo/export) owns real open/close.
  function wireHotspotNode(node) {
    var block = node.__block; if (!block) return;
    var stage = node.querySelector(".hotspot-stage"); if (!stage) return;
    // #(feedback): on the canvas a hotspot video screen otherwise shows a blank grey box, which
    // makes marker placement blind. Pin each video to its FINAL frame (paused) so the author targets
    // against the real end-state UI. Editor-only (the runtime owns real playback in demo/export).
    Array.prototype.forEach.call(stage.querySelectorAll("video"), function (v) {
      if (v.__canvasPinned) return; v.__canvasPinned = true;
      v.muted = true; v.removeAttribute("autoplay"); try { v.pause(); } catch (_) {}
      function pinLast() { var d = v.duration; if (d && isFinite(d) && d > 0) { try { v.currentTime = Math.max(0, d - 0.05); } catch (_) {} } }
      if (v.readyState >= 1) pinLast(); else v.addEventListener("loadedmetadata", pinLast, { once: true });
    });
    // #(feedback): little prev/next buttons either side of the interaction to cycle screens on the
    // canvas (clean up each screen's markers/targets in place). Editor chrome only, multi-screen only.
    if ((block.screens || []).filter(Boolean).length > 1 && !node.querySelector(".hotspot-canvas-nav")) {
      [["prev", -1, "chevron-left", "‹", "Previous screen"], ["next", 1, "chevron-right", "›", "Next screen"]].forEach(function (d) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "hotspot-canvas-nav hotspot-canvas-nav--" + d[0];
        b.setAttribute("aria-label", d[4]); b.title = d[4];
        b.innerHTML = window.Icon ? window.Icon(d[2]) : d[3];
        b.addEventListener("mousedown", function (e) { e.stopPropagation(); });
        b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); hsCanvasCycle(node, block, d[1]); });
        node.appendChild(b);
      });
    }
    Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-marker"), function (mk) {
      var hs = findHotspot(block, mk.getAttribute("data-hotspot"));
      if (!hs) return;
      mk.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var startX = e.clientX, startY = e.clientY, moved = false, pushed = false;
        // #146: coords are relative to the IMAGE (the .hotspot-frame), not the full-width
        // stage — so a marker dropped on the product lands where the cursor is at any image
        // width (frame == stage at 100%, so this is unchanged there).
        var rect = (mk.closest && mk.closest(".hotspot-frame") || stage).getBoundingClientRect();
        function mm(ev) {
          if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
          moved = true;
          if (!pushed) { pushHistory(); pushed = true; }
          hs.x = Math.round(clampPct((ev.clientX - rect.left) / rect.width * 100) * 10) / 10;
          hs.y = Math.round(clampPct((ev.clientY - rect.top) / rect.height * 100) * 10) / 10;
          mk.style.left = hs.x + "%"; mk.style.top = hs.y + "%";
          var pop = stage.querySelector('.hotspot-popover[data-hotspot-panel="' + hs.id + '"]');
          if (pop && !pop.hidden && window.CourseRuntime && window.CourseRuntime.positionPopover) window.CourseRuntime.positionPopover(stage, mk, pop);
        }
        function mu() {
          document.removeEventListener("mousemove", mm);
          document.removeEventListener("mouseup", mu);
          if (!moved) { setHotspotEditId(hs.id); setHotspotEditScreenId(screenIdOfMarker(block, hs.id) || hotspotEditScreenId()); selectByType(node, block); revealHotspot(node, block, hs.id); }
          else renderModelView();
        }
        document.addEventListener("mousemove", mm);
        document.addEventListener("mouseup", mu);
      });
      // #48: a box (region) marker gets a bottom-right corner handle to resize it in place.
      // Editor chrome only (injected here, never in render.js) so it never ships in SCORM.
      if (hs.shape === "box" && !mk.querySelector(".hotspot-resize")) {
        var rz = document.createElement("div"); rz.className = "hotspot-resize"; rz.title = "Drag to resize the region";
        mk.appendChild(rz);
        rz.addEventListener("mousedown", function (e) {
          if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
          var frame = (mk.closest && mk.closest(".hotspot-frame")) || stage, rect = frame.getBoundingClientRect(), pushed = false;
          function rm(ev) {
            if (!pushed) { pushHistory(); pushed = true; }
            var cx = hs.x == null ? 50 : hs.x, cy = hs.y == null ? 50 : hs.y;
            var px = clampPct((ev.clientX - rect.left) / rect.width * 100), py = clampPct((ev.clientY - rect.top) / rect.height * 100);
            hs.w = Math.max(2, Math.min(100, Math.round((px - cx) * 2)));
            hs.h = Math.max(2, Math.min(100, Math.round((py - cy) * 2)));
            mk.style.width = hs.w + "%"; mk.style.height = hs.h + "%";
          }
          function ru() { document.removeEventListener("mousemove", rm); document.removeEventListener("mouseup", ru); if (pushed) { scheduleSave(); renderModelView(); } }
          document.addEventListener("mousemove", rm); document.addEventListener("mouseup", ru);
        });
      }
    });
    Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-popover__close"), function (c) {
      c.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      c.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); setHotspotEditId(null); revealHotspotPopover(node, null); });
    });
    // screen mode: the Back control just re-shows the screen being edited (the canvas
    // preview is edit-mode, not learner navigation -- the real Back lives in runtime.js).
    Array.prototype.forEach.call(stage.querySelectorAll(".hotspot-back, .hotspot-home"), function (b) {
      b.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); showEditScreen(node, hotspotEditScreenId()); });
    });
  }

  // ==========================================================================
  // Interact-mode authoring
  // The right panel becomes the interaction editor for the selected element:
  // - "On click ->" : an action list (goto / next / prev / show|hide|enable|
  // toggle) authored via canonical controls + drag-to-link + click-to-pick.
  // - "Locked until ->" : a reactive gate (mode + condition allOf + hint +
  // required). Any authored interaction/gate/target mints ids via ensureId.
  // Every model-affecting change mount()s (so render.js re-emits data-id and the
  // connectors re-derive) then reselects the same element.
  // ==========================================================================

  // ...continues in interact.js (arch-P3b-07).

  // ...continues in interact.js (arch-P3b-07).


  // Item U: the little map/grid glyph shown beside each page title (16x16,
  // currentColor, matching the GLYPHS family style).
  var REVEAL_GLYPH_SVG = Icon("grid-2x2");
  // Outline every block on one frame's page (hover reveal). Adds an editor-only
  // class + a small type tag to each .canvas-block; removing them on mouseout
  // leaves the DOM exactly as it was, so exported markup is never affected.
  function revealFrameBlocks(frameEl, on) {
    if (!frameEl) return;
    Array.prototype.forEach.call(frameEl.querySelectorAll(".canvas-block"), function (b) {
      if (on) {
        b.classList.add("reveal-block-outline");
        if (!b.querySelector(":scope > .reveal-block-tag")) {
          var type = (b.__block && b.__block.type) ? b.__block.type : "block";
          b.appendChild(h("span", "reveal-block-tag", type));
        }
      } else {
        b.classList.remove("reveal-block-outline");
        var tag = b.querySelector(":scope > .reveal-block-tag");
        if (tag) tag.remove();
      }
    });
  }

  // arch-P3b-07world: the canvas render loop moved to editor/world.js -- buildWorld, the
  // measure-then-stack pass in layoutColumns, the restack observer, the connector painter and the
  // gap affordances. It reads the canvas geometry (world, framePos, frameDescs, frameX/frameY,
  // FRAME_W, SVGNS) from here rather than owning it: those are minted by mount(), and where mount
  // and its world state finally live is arch-p3b-08's call.
  var buildWorld = VE.bind("buildWorld");
  var layoutColumns = VE.bind("layoutColumns");
  var scheduleRestack = VE.bind("scheduleRestack");
  var observeFrames = VE.bind("observeFrames");
  var connectorPathD = VE.bind("connectorPathD");
  var drawConnectors = VE.bind("drawConnectors");
  var buildGapAffordances = VE.bind("buildGapAffordances");
  var worldGeoClass = VE.bind("worldGeoClass");
  var frameContentOverflows = VE.bind("frameContentOverflows");
  var mkLockGlyph = VE.bind("mkLockGlyph");


  // ---- left panel ----------------------------------------------------------
  // The multi-select sets. They live here rather than with the outliner because THREE surfaces
  // read them -- the tree, the marquee and the canvas -- and a set that one of them owned would be
  // a second source of truth for the same idea. The outliner mutates them in place and reassigns
  // them through the two setters below (arch-P3b-07i).
  var multiSel = []; // block refs multi-selected (outliner / marquee) — for grouping + fit
  var multiSelPages = []; // page indices multi-selected (marquee / outliner)
  // arch-P3b-07i: the Structure outliner -- the tree, its twirls, the reorder and reparent drags
  // and its right-click menu -- moved to editor/outliner.js. It shares ONE selection with the
  // canvas; the multi-select arrays stay here because the marquee reads them too.
  var renderStructure = VE.bind("renderStructure");
  var setActivePage = VE.bind("setActivePage");
  var refreshCanvasSelection = VE.bind("refreshCanvasSelection");
  var canvasNodeForBlock = VE.bind("canvasNodeForBlock");
  var canvasTopBlock = VE.bind("canvasTopBlock");
  var blockLabel = VE.bind("blockLabel");
  var blockIcon = VE.bind("blockIcon");
  var selectBlock = VE.bind("selectBlock");
  var selectByType = VE.bind("selectByType");
  var toggleMulti = VE.bind("toggleMulti");
  var inMulti = VE.bind("inMulti");
  var clearAllMulti = VE.bind("clearAllMulti");
  var clearMultiPages = VE.bind("clearMultiPages");
  var clearTreeMarks = VE.bind("clearTreeMarks");
  var showMultiToolbar = VE.bind("showMultiToolbar");
  var groupMulti = VE.bind("groupMulti");
  var ungroupBlock = VE.bind("ungroupBlock");
  var mergeTextBoxes = VE.bind("mergeTextBoxes");
  var saveSelectionAsSectionMaster = VE.bind("saveSelectionAsSectionMaster");
  var updateDragAffordance = VE.bind("updateDragAffordance");
  var openPagesMap = VE.bind("openPagesMap");
  var openChaptersMap = VE.bind("openChaptersMap");
  var openContainersSet = VE.bind("openContainersSet");
  // Constants, read back from their owner right after it installs (see the bottom of this file).
  var BLOCK_LUCIDE;


  // ---- Assets tab: the library of insertable block/component types ----------
  // arch-P3b-07h: the shelf of insertable types, the left-panel section switch and the asset-store
  // seam behind them moved to editor/assets.js. The source-link glue that shared this banner is a
  // different concern and moved to editor/source-link.js.
  var assetRef = VE.bind("assetRef");
  var editorAssetResolve = VE.bind("editorAssetResolve");
  var srcForInspect = VE.bind("srcForInspect");
  var embedColorVarsCached = VE.bind("embedColorVarsCached");
  var sweepAllAssets = VE.bind("sweepAllAssets");
  var migrateAllAssets = VE.bind("migrateAllAssets");
  var migrateToFileBackendPrompt = VE.bind("migrateToFileBackendPrompt");
  var exportVersoPackage = VE.bind("exportVersoPackage");
  var renderAssets = VE.bind("renderAssets");
  var renderComponentsPalette = VE.bind("renderComponentsPalette");
  var insertBlock = VE.bind("insertBlock");
  var insertLoc = VE.bind("insertLoc");
  var applyLeftSection = VE.bind("applyLeftSection");
  var activeLeftSection = VE.bind("activeLeftSection");
  var wireLeftSwitcher = VE.bind("wireLeftSwitcher");
  var migrateToFileBackend = VE.bind("migrateToFileBackend");
  // Constants, read back from their owner right after it installs (see the bottom of this file).
  var LIBRARY;

  // arch-P3b-07: the source-link glue -- the read-only Source tab, range placement, alternates,
  // where-used and the base-edit warning -- moved to editor/source-link.js. It shared the Assets
  // banner because both put content on the canvas; nothing else about them is the same.
  var renderEditSourcePanel = VE.bind("renderEditSourcePanel");
  var sourceLinkWhereUsed = VE.bind("sourceLinkWhereUsed");
  var sourceLinkAlternates = VE.bind("sourceLinkAlternates");
  var sourceAltSnippet = VE.bind("sourceAltSnippet");
  var applyAltToLocation = VE.bind("applyAltToLocation");
  var decorateSourceLinks = VE.bind("decorateSourceLinks");
  var snapshotSourceLinkBase = VE.bind("snapshotSourceLinkBase");
  var sourceBaseEditImpact = VE.bind("sourceBaseEditImpact");
  var showSourceBaseEditModal = VE.bind("showSourceBaseEditModal");
  var finalizeSourceLock = VE.bind("finalizeSourceLock");
  var jumpToLinkedBlock = VE.bind("jumpToLinkedBlock");
  var jumpToSourceTopic = VE.bind("jumpToSourceTopic");

  // ...continues in assets.js (arch-P3b-07).


  // ---- mount / re-mount (preserves view) -----------------------------------
  function mount() {
    syncWorkingFromDoc(); // #124: rebuild the theme cache from THIS doc's doc.theme (so switchDoc/setDoc round-trip the per-course theme)
    var activeEl = document.activeElement;
    var activeInfo = null;
    if (activeEl && activeEl.closest("#inspector")) {
      var row = activeEl.closest(".insp-row") || activeEl.closest(".prop-grid-cell") || activeEl.closest(".prop-row") || activeEl.parentNode;
      var labelNode = row && (row.querySelector("label") || row.querySelector(".insp-row__label") || row.querySelector("span"));
      if (labelNode) {
        activeInfo = {
          label: labelNode.textContent.trim(),
          selectionStart: activeEl.selectionStart,
          selectionEnd: activeEl.selectionEnd
        };
      }
    }

    canvas.innerHTML = "";
    buildWorld();
    attachWorld();
    drawConnectors();
    // Flagship / base is editable; a variant OR version preview renders resolved clones,
    // so editing is disabled there (edits belong on the flagship / base / per-block overrides).
    canvas.classList.toggle("is-variant-preview", !!activeVariant);
    canvas.classList.toggle("is-version-preview", !!activeVersion);
    updateVariantBadge();
    updateVersionBadge();
    // uio-E-C04: keep the top-bar axis switches + the off-base return chip in sync (menu pick,
    // undo/redo, doc swap) -- onVariantPick only mounts, so the label/chip refresh here.
    syncVariantSwitch();
    syncVersionSwitch();
    if (canvasEditable()) enableEditing(world); // #207 + ticket 15: version = editable flagship UNLESS collaborating (base-only)
    fitEmbeds();
    // fitEmbeds() resizes HTML/web-embed iframes to fit, changing their frames'
    // heights AFTER the drawConnectors() above measured them — re-stack so the pages
    // below sit at the correct offsets (else an embed page overlaps / gaps its
    // neighbour). The ResizeObserver catches later async settles (images, font swap).
    drawConnectors();
    renderStructure();
    renderAssets(); // keep the Blocks palette current
    renderComponentsPalette(); // keep the Components pane current (My Components / Blocks / Pages)
    if (typeof syncCellChip === "function") syncCellChip(); // SPEC 7: reflect the doc's cell in the header chip after any rebuild
    renderModelView();

    restoreSelection();
    
    renderTabs();
    refreshCanvasSelection();
    if (interactModeOn()) decorateInteractHandle();
    decorateVariantVersionBadges(); // #148: on-canvas version-cycle badge on image blocks with variant versions
    decorateStyleAudit(); // #145: mark unstyled text blocks when the audit toggle is on
    renderCommentPins(); // §12: re-project review pins (canvas.innerHTML was cleared)
    if (collabChrome()) { collabChrome().ensure(); collabChrome().reproject(); } // ticket 11: presence chrome (server-mode only; inert in standalone)

    if (activeInfo) {
      var inputs = inspector.querySelectorAll("input, select, textarea");
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var row = inp.closest(".insp-row") || inp.closest(".prop-grid-cell") || inp.closest(".prop-row") || inp.parentNode;
        var labelNode = row && (row.querySelector("label") || row.querySelector(".insp-row__label") || row.querySelector("span"));
        if (labelNode && labelNode.textContent.trim() === activeInfo.label) {
          inp.focus();
          if (activeInfo.selectionStart != null && inp.setSelectionRange) {
            try {
              inp.setSelectionRange(activeInfo.selectionStart, activeInfo.selectionEnd);
            } catch (_) {}
          }
          break;
        }
      }
    }
    
    if (!view.ready) fitAll(); else applyView();

    // keep an open hotspot card revealed across edits (paste/drop into the card
    // leave the selection on a child; without this the popover snaps shut).
    requestAnimationFrame(keepHotspotCardOpen);

    scheduleWeightRefresh(); // §308: keep the course-weight readout current across doc swaps/edits
  }

  // Scale each HTML-interaction iframe (often a fixed-width design) down to the
  // available page width so it fits with no scrollbars, at any breakpoint.
  function fitEmbeds() { fitEmbedsIn(canvas); }
  function fitEmbedsIn(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".embed--html .embed__fit"), function (fit) {
      var frame = fit.querySelector(".embed__iframe");
      var wrap = fit.parentNode;
      var block = wrap && wrap.__block;
      if (!frame || !block) return;
      var dw = block.fitWidth || 900;
      var avail = fit.clientWidth || dw;
      var s = Math.min(1, avail / dw); // §174 unified: fit-to-width, capped at natural (never upscale)
      var hpx = block.height || 500;
      frame.style.width = dw + "px";
      frame.style.height = hpx + "px";
      frame.style.transformOrigin = "top left";
      frame.style.transform = "scale(" + s + ")";
      // §174: honour block.align in plain page flow. The scaled visual is dw*s wide and
      // anchored top-left (transform-origin), so it left-pins by default; offset it so
      // Center sits mid-container and End flushes right (clamped so it never left-shifts).
      var vis = dw * s, gap = avail - vis;
      var al = block.align || "start"; var off = al === "center" ? gap / 2 : (al === "end" ? gap : 0); // fresh/migrated embeds carry explicit "center"
      frame.style.marginLeft = (off > 0 ? off : 0) + "px";
      fit.style.height = (hpx * s) + "px"; // collapse wrapper to the scaled height
    });
  }

  // ---- pan / zoom ----------------------------------------------------------
  // Global guard: never let ctrl/⌘ + wheel (pinch-zoom gesture) zoom the whole
  // browser page — the editor owns zoom on the canvas only.
  window.addEventListener("wheel", function (e) { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false, capture: true });

  function isTextTarget(t) {
    if (!t) return false;
    if (t.isContentEditable || t.tagName === "TEXTAREA") return true;
    if (t.tagName !== "INPUT") return false;
    // Only TEXT-ENTRY inputs are "text targets" (native caret / keyboard). Toggle,
    // button and picker inputs (checkbox / radio / range / ...) are NOT: clicking one
    // must still leaf-select + let its block be dragged (the drill handler and the
    // dragstart guard both bail on a text target), and canvas shortcuts must not be
    // swallowed by a focused checkbox. Whitelist the text-entry types only.
    var ty = (t.getAttribute("type") || "text").toLowerCase();
    return ty === "text" || ty === "search" || ty === "email" || ty === "url" ||
           ty === "tel" || ty === "password" || ty === "number";
  }
  // Building a multi-selection (or any "nothing is in text-edit" gesture) must drop the
  // caret, so Delete removes the selected BLOCKS, not a character in a still-focused box.
  function blurActiveText() { if (document.activeElement && isTextTarget(document.activeElement)) document.activeElement.blur(); }
  canvas.addEventListener("wheel", function (e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      wheelZoom(e.clientX - rect.left, e.clientY - rect.top, e.deltaY, e.deltaMode);
    } else if (nativeScroll()) {
      return; // #151: let the browser scroll the container -- GPU tiles move, content never blanks
    } else {
      e.preventDefault();
      panBy(e.deltaX, e.deltaY);
    }
  }, { passive: false });

  var spaceHeld = false, panning = false, last = null;
  // Cmd+\ : hide/show both side panels to maximise the canvas (parity),
  // persisted like the lpane collapse state.
  var PANELS_HIDDEN_KEY = "authoring.panels-hidden";
  function applyPanelsHidden(hidden) { var ws = document.querySelector(".workspace"); if (ws) ws.classList.toggle("is-panels-hidden", !!hidden); }
  function togglePanels() {
    var ws = document.querySelector(".workspace"); if (!ws) return;
    var hidden = !ws.classList.contains("is-panels-hidden");
    // uio-F05-fb1: hiding the panels collapses every dock track to 0, and the settings sheet
    // sits in one of them. Left alone it became a 0px-wide surface that was still "open" and
    // still on the Escape layer stack -- invisible, but the next Escape went to it. Zen mode
    // CLOSES the sheet instead, so what is on screen matches what is open.
    if (hidden) closeSettingsModal();
    applyPanelsHidden(hidden);
    try { localStorage.setItem(PANELS_HIDDEN_KEY, hidden ? "1" : "0"); } catch (_) {}
    if (typeof positionBlockToolbar === "function") positionBlockToolbar(); // re-centre the static toolbar over the resized canvas
  }
  window.addEventListener("resize", function () { if (typeof positionBlockToolbar === "function") positionBlockToolbar(); });
  try { if (localStorage.getItem(PANELS_HIDDEN_KEY) === "1") applyPanelsHidden(true); } catch (_) {}

  // ---- perf HUD (diagnostic; editor chrome, OFF by default, never ships) -------------
  // arch-P3b-07u: the frame-cadence readout and the will-change A/B moved to
  // editor/diagnostics.js. Proximity capture, which shared this ticket, moved with the comments.
  var togglePerfHud = VE.bind("togglePerfHud");
  var perfTick = VE.bind("perfTick");
  var noteViewJsSample = VE.bind("noteViewJsSample");


  // arch-P3b-07: the global keyboard map moved to editor/shortcuts.js -- one file that says what
  // every key does, and defers to whichever mode owns the key it is holding.

  // arch-P3b-07: the selection verbs -- delete, duplicate, select-all, copy, paste and the
  // style-only pair -- moved to editor/clipboard.js. They share the hard part: what a block
  // DEPENDS on, and how those dependencies merge into the course you paste into.
  var deleteSelection = VE.bind("deleteSelection");
  var selectedSingleBlock = VE.bind("selectedSingleBlock");
  var selectAllOnPage = VE.bind("selectAllOnPage");
  var duplicateSelection = VE.bind("duplicateSelection");
  var copySelection = VE.bind("copySelection");
  var pastePage = VE.bind("pastePage");
  var pasteClipboard = VE.bind("pasteClipboard");
  var copyBlockStyle = VE.bind("copyBlockStyle");
  var pasteBlockStyle = VE.bind("pasteBlockStyle");
  var collectPasteDeps = VE.bind("collectPasteDeps");
  var mergePasteDeps = VE.bind("mergePasteDeps");
  var stripFormattingDeep = VE.bind("stripFormattingDeep");
  var pageClipboardNow = VE.bind("pageClipboardNow");
  var clipboardNow = VE.bind("clipboardNow");
  var styleClipboardNow = VE.bind("styleClipboardNow");

  // ---- uio-F06: one index, one palette (Cmd-K) -----------------------------
  // arch-P3b-07p: the index and the Cmd-K overlay moved to editor/palette.js. Most of what it
  // reads from this file are the COMMANDS it dispatches to -- that is what a palette is, and the
  // list is not coupling to reduce.
  var openQuickJump = VE.bind("openQuickJump");

  window.addEventListener("keyup", function (e) { if (e.code === "Space") { spaceHeld = false; canvas.classList.remove("is-pannable"); } });
  // ---- marquee (rubber-band) selection -------------------------------------
  // Left-drag on empty canvas draws a box; pages (frames) and top-level blocks
  // it touches all become the selection at once (heterogeneous). Space/middle
  // still pan, so this reuses the split: drag = select, space-drag = pan.
  var marquee = null; // { sx, sy, el, moved }
  function rectsIntersect(a, b) { return !(b.left > a.right || b.right < a.left || b.top > a.bottom || b.bottom < a.top); }
  function startMarquee(e) {
    clearSelection(); clearAllMulti();
    var el = h("div", "marquee-box"); document.body.appendChild(el);
    marquee = { sx: e.clientX, sy: e.clientY, el: el, moved: false };
    updateMarquee(e);
  }
  function updateMarquee(e) {
    if (!marquee) return;
    var x = Math.min(marquee.sx, e.clientX), y = Math.min(marquee.sy, e.clientY);
    var w = Math.abs(e.clientX - marquee.sx), ht = Math.abs(e.clientY - marquee.sy);
    if (w > 3 || ht > 3) marquee.moved = true;
    marquee.el.style.left = x + "px"; marquee.el.style.top = y + "px";
    marquee.el.style.width = w + "px"; marquee.el.style.height = ht + "px";
  }
  function endMarquee(e) {
    if (!marquee) return;
    var box = { left: Math.min(marquee.sx, e.clientX), top: Math.min(marquee.sy, e.clientY), right: Math.max(marquee.sx, e.clientX), bottom: Math.max(marquee.sy, e.clientY) };
    var moved = marquee.moved;
    marquee.el.remove(); marquee = null;
    if (!moved) { clearSelection(); refreshCanvasSelection(); return; } // plain click on bg = deselect
    multiSel = []; multiSelPages = [];
    frameDescs.forEach(function (fd, i) { if (fd.frame && rectsIntersect(box, fd.frame.getBoundingClientRect())) multiSelPages.push(i); });
    Array.prototype.forEach.call(world.querySelectorAll(".page > .canvas-block"), function (n) {
      if (n.__block && !n.__block.locked && rectsIntersect(box, n.getBoundingClientRect())) multiSel.push(n.__block);
    });
    renderStructure();
    refreshCanvasSelection();
  }

  // ---- "." — zoom to fit the current selection -----------------------------
  // arch-P3b-07m: progressive drill-in selection and zoom-to-fit moved to editor/drill.js. They are
  // one concern: both need the screen rectangle of whatever is selected, at whatever depth.
  var fitSelection = VE.bind("fitSelection");
  var selectionScreenRects = VE.bind("selectionScreenRects");
  var applyDrillLevel = VE.bind("applyDrillLevel");
  var buildDrillLevels = VE.bind("buildDrillLevels");
  var leafSelectIndex = VE.bind("leafSelectIndex");


  // ==========================================================================
  // ---- canvas input: pan, rubber-band marquee, and the two header buttons ----
  // This routes a mousedown on the canvas background to the right gesture. The comment layer adds
  // its own capture-phase listener ABOVE this one, so a pin drop beats a marquee; everything else
  // is decided here (arch-P3b-07).
  canvas.addEventListener("mousedown", function (e) {
    var onBg = e.target === canvas || e.target === world || (e.target.classList && e.target.classList.contains("connectors"));
    // pan: middle mouse, or Space-held left-drag
    if (e.button === 1 || (spaceHeld && e.button === 0)) {
      panning = true; last = { x: e.clientX, y: e.clientY };
      canvas.classList.add("is-panning"); e.preventDefault(); return;
    }
    // plain left-drag on empty canvas: rubber-band select
    if (onBg && e.button === 0 && !e.shiftKey && !e.metaKey) {
      startMarquee(e); e.preventDefault();
    }
  });
  window.addEventListener("mousemove", function (e) {
    if (marquee) { updateMarquee(e); return; }
    if (!panning) return;
    var dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    panDrag(dx, dy);
  });
  window.addEventListener("mouseup", function (e) { if (marquee) endMarquee(e); });
  window.addEventListener("mouseup", function () { if (panning) { panning = false; canvas.classList.remove("is-panning"); } });
  document.getElementById("zoom-fit").addEventListener("click", fitCycle);

  var addPageBtn = document.getElementById("add-page-btn");
  if (addPageBtn) addPageBtn.addEventListener("click", addPageAfterCurrent);

  // Outliner "add chapter" — mirrors the canvas "+ Chapter" column affordance so a new
  // chapter is reachable from the Pages header bar without scrolling the canvas. Prompts
  // for a name (defaulting to the next number), then mounts.
  var addChapterBtn = document.getElementById("add-chapter-btn");
  if (addChapterBtn) {
    addChapterBtn.innerHTML = Icon("folder-plus") || "+";
    addChapterBtn.addEventListener("click", function () {
      promptModal("New chapter", "Name", "Chapter " + ((doc.chapters || []).length + 1), function (nm) {
        if (nm == null) return;
        pushHistory(); createChapter((nm || "").trim() || undefined); mount();
      });
    });
  }



  // arch-P3b-07: review comments -- pins, their three-tier anchors, the comment list, identity,
  // replies, the sidecar transport and the presence chrome -- moved to editor/comments.js.
  var setCommentMode = VE.bind("setCommentMode");
  var commentModeOn = VE.bind("commentModeOn");
  var renderCommentList = VE.bind("renderCommentList");
  var refreshCommentPanel = VE.bind("refreshCommentPanel");
  var commentIdentity = VE.bind("commentIdentity");
  var colourForName = VE.bind("colourForName");
  var makeReply = VE.bind("makeReply");
  var mergeComments = VE.bind("mergeComments");
  var makeAnchorFromPoint = VE.bind("makeAnchorFromPoint");
  var rectUnculled = VE.bind("rectUnculled");
  var activeSurf = VE.bind("activeSurf");
  var renderCommentPins = VE.bind("renderCommentPins");
  var closeCommentPopover = VE.bind("closeCommentPopover");
  var openCommentPopover = VE.bind("openCommentPopover");
  var openCommentIdNow = VE.bind("openCommentIdNow");
  var setDemoCommentMode = VE.bind("setDemoCommentMode");
  var resetDemoCommentMode = VE.bind("resetDemoCommentMode");
  var demoCommentModeNow = VE.bind("demoCommentModeNow");
  var collabChrome = VE.bind("collabChrome");
  var anchorToScreen = VE.bind("anchorToScreen");
  var resolvePinContext = VE.bind("resolvePinContext");

  // Outliner "collapse all to chapters" — one-click zoom-out of the tree. Toggles: if any
  // chapter is open, collapse every chapter (and tidy page twirls) to the chapter level;
  // if all already collapsed, expand every chapter back. Editor chrome only, no doc change.
  var collapseTreeBtn = document.getElementById("collapse-tree-btn");
  if (collapseTreeBtn) {
    collapseTreeBtn.innerHTML = Icon("list-collapse") || "–";
    collapseTreeBtn.addEventListener("click", collapseTreeToChapters);
  }
  function collapseTreeToChapters() {
    var groups = (window.groupPagesByChapter && Array.isArray(doc.chapters) && doc.chapters.length)
      ? window.groupPagesByChapter(doc) : null;
    if (groups) {
      var openChapters = openChaptersMap(), openPages = openPagesMap();
      var anyOpen = groups.some(function (ch) { return openChapters[ch.id] !== false; });
      groups.forEach(function (ch) { openChapters[ch.id] = anyOpen ? false : true; });
      if (anyOpen) Object.keys(openPages).forEach(function (k) { delete openPages[k]; }); // tidy page block-twirls on collapse
    } else {
      // no chapters: collapse/expand the page block-twirls instead
      var openPages = openPagesMap();
      var anyPageOpen = doc.pages.some(function (p) { return !!openPages[p.id]; });
      if (anyPageOpen) Object.keys(openPages).forEach(function (k) { delete openPages[k]; });
      else doc.pages.forEach(function (p) { openPages[p.id] = true; });
    }
    renderStructure();
  }

  // Insert a blank page immediately AFTER page index `pi`, inheriting that page's
  // chapter so it lands in the same column right after it (a page with no chapterId
  // gets regrouped away by the column-major resort — the "page landed elsewhere"
  // surprise). New pages are COMPLETELY BLANK (James's preference); global header/
  // footer/nav come from doc.headerFooter, so an empty blocks list still shows them.
  function addPageAfter(pi) {
    pushHistory();
    var ref = doc.pages[pi];
    var newPage = { id: "page-" + Date.now(), name: "New Page", blocks: [] };
    if (ref && ref.chapterId != null) newPage.chapterId = ref.chapterId;
    doc.pages.splice(pi + 1, 0, newPage);
    currentPage = pi + 1;
    mount();
    setActivePage(currentPage);
    focusFrame(currentPage);
  }
  function addPageAfterCurrent() { addPageAfter(currentPage); }

  // Delete a page by index. Refuses the last page (a course needs >=1). Nav
  // gotos that pointed at it are left as-is (dangling refs are a separate
  // concern); selection + current page are re-anchored.
  function deletePage(pi) {
    if (doc.pages.length <= 1) { window.alert("A course needs at least one page."); return; }
    var name = doc.pages[pi].name || doc.pages[pi].id;
    confirmModal("Delete page", "Delete page “" + name + "”? This cannot be undone except via Undo.", function () {
      pushHistory();
      // #171: re-anchor the viewport by page IDENTITY, not raw index. Deleting a page
      // BEFORE the active one shifts every later page's index down by one, so keeping
      // the old currentPage number would silently jump the view to a different page.
      // Decide which page should stay in view FIRST (the active page, or its nearest
      // surviving neighbour when the active page is the one being deleted), then resolve
      // that page's new index after the splice.
      var keepId = pi === currentPage
        ? ((doc.pages[pi + 1] || doc.pages[pi - 1] || {}).id) // active page deleted -> neighbour
        : doc.pages[currentPage].id;                          // keep the same page in view
      doc.pages.splice(pi, 1);
      var ni = keepId ? pageIndexById(keepId) : -1;
      currentPage = ni >= 0 ? ni : Math.min(currentPage, doc.pages.length - 1);
      clearSelection();
      mount();
      setActivePage(currentPage);
      focusFrame(currentPage);
    }, { okLabel: "Delete", danger: true });
  }

  // ---- resizable side panels (persisted) -----------------------------------
  // uio-F05-fb1: every dock width restores + clamps through these two helpers, so a surface
  // built later (the settings sheet) resizes exactly like the panels that ship in the HTML.
  function restoreDockWidth(varName) {
    var workspace = document.querySelector(".workspace"); if (!workspace) return;
    try { var v = localStorage.getItem("authoring." + varName); if (v) workspace.style.setProperty("--" + varName, v); } catch (e) {}
  }
  // handle: the .panel-resizer element. side: which edge of the workspace the width is measured
  // from. min/max: the clamp, so a dock can't be dragged past legibility or off the canvas.
  function wirePanelResizer(handle, varName, side, min, max) {
    if (!handle || handle.__resizeWired) return; handle.__resizeWired = true;
    var workspace = document.querySelector(".workspace");
    var dragging = false;
    handle.addEventListener("mousedown", function (e) { dragging = true; handle.classList.add("is-dragging"); document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; e.preventDefault(); });
    window.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var rect = workspace.getBoundingClientRect();
      var w = side === "left" ? (e.clientX - rect.left) : (rect.right - e.clientX);
      w = Math.max(min || 180, Math.min(max || 560, w));
      workspace.style.setProperty("--" + varName, w + "px");
      try { localStorage.setItem("authoring." + varName, w + "px"); } catch (_) {}
    });
    window.addEventListener("mouseup", function () { if (dragging) { dragging = false; handle.classList.remove("is-dragging"); document.body.style.cursor = ""; document.body.style.userSelect = ""; } });
  }
  function wireResizers() {
    restoreDockWidth("left-w"); restoreDockWidth("right-w"); restoreDockWidth("sheet-w");
    wirePanelResizer(document.getElementById("resizer-left"), "left-w", "left", 180, 560);
    wirePanelResizer(document.getElementById("resizer-right"), "right-w", "right", 180, 560);
  }

  // ---- breakpoint switch (M6) ---------------------------------------------
  var BP_KEY = "authoring.breakpoint";
  var BP_LABELS = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
  function loadBp() { try { var b = localStorage.getItem(BP_KEY); if (BREAKPOINTS[b]) activeBp = b; } catch (e) {} }
  // #92c: the breakpoints live behind the Preview chevron; reflect the active one in its title.
  function updateBpSwitch() {
    var cv = document.getElementById("preview-bp-btn");
    if (cv) cv.title = "Preview size: " + (BP_LABELS[activeBp] || activeBp);
  }
  function setBreakpoint(bp) {
    if (!BREAKPOINTS[bp] || bp === activeBp) { updateBpSwitch(); return; }
    activeBp = bp; applyBp();
    try { localStorage.setItem(BP_KEY, bp); } catch (e) {}
    view.ready = false; // frames changed size -> refit
    mount();
    updateBpSwitch();
  }
  function openPreviewBpMenu(anchor) {
    var r = anchor.getBoundingClientRect();
    var items = [{ head: "Preview size" }];
    Object.keys(BREAKPOINTS).forEach(function (bp) {
      items.push({
        label: (BP_LABELS[bp] || bp) + "  " + BREAKPOINTS[bp].w + "×" + BREAKPOINTS[bp].h,
        active: bp === activeBp,
        onClick: function () { setBreakpoint(bp); }
      });
    });
    // edit-header-ia-v2: light/dark moved off its own face-up slot into this menu (rarely used).
    // Divider under the size presets, then the palette toggle.
    items.push({ sep: true });
    items.push({ head: "Palette" });
    items.push({ label: "Light", active: activeModeNow() === "light", onClick: function () { setMode("light"); } });
    items.push({ label: "Dark", active: activeModeNow() === "dark", onClick: function () { setMode("dark"); } });
    showContextMenu(r.right, r.bottom + 4, items);
  }
  function wireBpSwitch() {
    var cv = document.getElementById("preview-bp-btn");
    if (cv && !cv.__wired) { cv.__wired = true; cv.addEventListener("click", function (e) { e.stopPropagation(); openPreviewBpMenu(cv); }); }
    updateBpSwitch();
  }

  // ---- demo mode (fullscreen, simulates the real learner experience) -------
  // arch-P3b-07j: the preview -- the device frame, the breakpoint picker, the fit-scale and the
  // end screen -- moved to editor/demo.js. It owns its elements; four accessors cross.
  var enterDemo = VE.bind("enterDemo");
  var exitDemo = VE.bind("exitDemo");
  var wireDemo = VE.bind("wireDemo");
  var demoIsOpen = VE.bind("demoIsOpen");
  var demoStageEl = VE.bind("demoStageEl");
  var demoDeviceEl = VE.bind("demoDeviceEl");
  var demoRuntimeNow = VE.bind("demoRuntimeNow");

  // arch-P3b-07j: the Read view and the find & replace it is a list-shaped version of both moved
  // to editor/copy-editor.js. They were 900 lines apart here and share one write path.
  var openFindReplace = VE.bind("openFindReplace");
  var frWords = VE.bind("frWords");
  var wireCopyEditor = VE.bind("wireCopyEditor");
  var mountViewToggle = VE.bind("mountViewToggle");


  // #44: LIGHT MODE for the tool's OWN UI (editor chrome) — distinct from the learner
  // course light/dark. `.theme-light` on <html> swaps the vendored DS chrome tokens
  // (design-system/tokens/colors.css ships the light override the whole chrome reads via
  // var(--...)); the course output (course.css, data-mode) is untouched. Persisted per machine.
  function uiThemeIsLight() { try { return localStorage.getItem("verso.uiTheme") === "light"; } catch (e) { return false; } }
  function applyUiTheme(light) {
    document.documentElement.classList.toggle("theme-light", !!light);
    try { localStorage.setItem("verso.uiTheme", light ? "light" : "dark"); } catch (e) {}
  }
  window.__uiTheme = { apply: applyUiTheme, isLight: uiThemeIsLight };

  // ===== P0 spellcheck: obvious typo marking across EVERY text box =====
  // Marks misspelled words on the canvas AND in the copy editor, whether or not a box is
  // selected, using the CSS Custom Highlight API. That paints ranges with NO DOM change,
  // so nothing is written to the document -> it can never leak into render() or a SCORM
  // export (the pure-render invariant is untouched). src/spellcheck.js owns the dictionary
  // + pure checker; this owns the visual pass. Rebuilt after each canvas/copy-editor render
  // and debounced on edits. Toggle in Settings (default ON). No dict or no Highlight API
  // (older engine) -> silently no-ops, app unaffected.
  var SPELL_HL_NAME = "verso-spelling";
  function spellcheckOn() { try { return localStorage.getItem("verso.spellcheck") !== "off"; } catch (e) { return true; } }
  function spellApiOk() { return typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight !== "undefined" && !!window.VersoSpell && window.VersoSpell.ready; }
  function collectSpellRanges() {
    var ranges = [];
    // Every editable canvas field + every copy-editor row. Walk text nodes so inline
    // markup (bold/links/weight spans) is skipped over, not misread as words.
    var hosts = document.querySelectorAll("#canvas-viewport [data-edit], .copyedit-row__text");
    for (var i = 0; i < hosts.length; i++) {
      var walker = document.createTreeWalker(hosts[i], NodeFilter.SHOW_TEXT, null);
      var tn;
      while ((tn = walker.nextNode())) {
        var data = tn.nodeValue;
        if (!data || data.length < 3) continue;
        var hits = window.VersoSpell.check(data);
        for (var hI = 0; hI < hits.length; hI++) {
          try {
            var r = document.createRange();
            r.setStart(tn, hits[hI].start); r.setEnd(tn, hits[hI].start + hits[hI].len);
            ranges.push(r);
          } catch (e) {}
        }
      }
    }
    return ranges;
  }
  function runSpellcheck() {
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    if (!spellApiOk() || !spellcheckOn()) { CSS.highlights.delete(SPELL_HL_NAME); return; }
    var ranges = collectSpellRanges();
    if (!ranges.length) { CSS.highlights.delete(SPELL_HL_NAME); return; }
    var hl = new Highlight();
    for (var i = 0; i < ranges.length; i++) hl.add(ranges[i]); // Highlight is a set of ranges
    CSS.highlights.set(SPELL_HL_NAME, hl);
  }
  var _spellT = null;
  function scheduleSpellcheck() { if (_spellT) clearTimeout(_spellT); _spellT = setTimeout(function () { _spellT = null; runSpellcheck(); }, 250); }
  function setSpellcheckEnabled(on) { try { localStorage.setItem("verso.spellcheck", on ? "on" : "off"); } catch (e) {} runSpellcheck(); }
  window.__spellcheck = { run: runSpellcheck, schedule: scheduleSpellcheck, setEnabled: setSpellcheckEnabled, enabled: spellcheckOn };

  // #133: right-click a flagged word -> "Add to dictionary" (clears the squiggle + persists
  // so it is never flagged again). Highlights are not DOM nodes, so resolve the word from the
  // caret position under the pointer, inside any editable field / copy-editor row. Capture
  // phase + stopPropagation so it pre-empts the canvas block menu; falls through (native menu)
  // when the pointer is not on a misspelling.
  function caretNodeOffset(x, y) {
    if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; }
    if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
    return null;
  }
  function spellWordAtPoint(x, y) {
    var pos = caretNodeOffset(x, y);
    if (!pos || !pos.node || pos.node.nodeType !== 3) return null;
    var par = pos.node.parentNode;
    if (!par || !par.closest || !par.closest("#canvas-viewport [data-edit], .copyedit-row__text")) return null;
    var text = pos.node.nodeValue || "", s = pos.offset, e = pos.offset;
    var WORD = /[A-Za-z'’-]/;
    while (s > 0 && WORD.test(text.charAt(s - 1))) s--;
    while (e < text.length && WORD.test(text.charAt(e))) e++;
    var word = text.slice(s, e);
    if (!word || !window.VersoSpell || !window.VersoSpell.check(word).length) return null; // only when it IS a flagged typo
    return word;
  }
  document.addEventListener("contextmenu", function (e) {
    if (!spellApiOk() || !spellcheckOn()) return;
    var word = spellWordAtPoint(e.clientX, e.clientY);
    if (!word) return;
    e.preventDefault(); e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { head: "“" + word + "”" },
      { label: "Add to dictionary", onClick: function () { window.VersoSpell.addWord(word); runSpellcheck(); } }
    ]);
  }, true);

  // ...continues in demo.js (arch-P3b-07).


  // ...continues in assets.js (arch-P3b-07).


  // ---- integration seam (FROZEN CONTRACT — do not widen without coordination)-
  // Sibling modules that own NO editor internals (src/csv.js, src/export.js,
  // src/persist.js — the data/export pipeline) talk to the editor ONLY through
  // this object. This is the whole reason those modules can be developed in
  // parallel with this file without colliding: they never reach inside editor.js,
  // and this file never reaches inside them.
  window.Editor = {
    getDoc: function () { return doc; },
    // #145: link every unstyled text block to its type's theme role style. Called by
    // the "Apply text styles by type" button and the schema importer (auto after import).
    // Returns the count stamped; refreshes render + saves when anything changed.
    applyTextRolesByType: function () {
      var n = applyTextRolesByType();
      if (n) { window.applyRenderContext({ docStyles: getTextStyles() }); saveRegistry(registry); mount(); }
      return n;
    },
    // #73 home / file browser — open the course wall (also the Home top-bar button).
    openBrowser: function () { openBrowser(); },
    closeBrowser: function () { closeBrowser(); },
    // #221 tour builder — open the spatial screen-graph board for a hotspot block
    // (defaults to the first hotspot block in the doc). Mirrors openBrowser.
    openTourBuilder: function (block) {
      if (!block) { (doc.pages || []).forEach(function (p) { (p.blocks || []).forEach(function (b) { if (!block && b && b.type === "hotspot") block = b; }); }); }
      if (block) openTourBuilder(block);
      return !!block;
    },
    closeTourBuilder: function () { closeTourBuilder(); },
    // side-rail-cleanup slice 2: the #75 save/recents popover is retired -- the file picker
    // (Editor.openBrowser) is now the one home for recents + file actions.
    // #74 card actions (also reached via each card's "…" menu) — exposed for wiring/verify.
    duplicateCourse: function (id) { duplicateCourse(id); },
    renameCourse: function (id) { renameCourse(id); },
    deleteCourse: function (id) { deleteCourse(id); },
    exportCourse: function (id) { exportVersoPackage(registry[id]); },
    // §12: publish a review snapshot (.versopub.json) — used by the SCORM export
    // modal's "Also publish review file" toggle. Quiet (export shows its own status).
    publishReviewFile: function (version) { return publishToViewer(version, true); },
    setDoc: function (next, skipHistory) {
      if (!next) return;
      normalizeDoc(next); // migrate legacy doc.chrome -> doc.headerFooter on import
      stampDocUpdatedAt(next, Date.now()); // #71 recents: programmatic replace is an edit
      if (!skipHistory) pushHistory();
      applyDocSwap(next, null); // the pair-write + a full mount (+ re-binds an open tour builder)
      saveRegistry(registry);
    },
    // follow-the-edit: navigate to + highlight what a change just touched. target =
    // { blockId? , pageId? , chapterId? }. Called after setDoc (the canvas is freshly mounted),
    // so it resolves against the current doc + reuses the normal selection path.
    followEdit: function (target) {
      if (!target) return;
      if (target.blockId != null) {
        var found = null, foundPi = -1;
        (doc.pages || []).forEach(function (p, idx) { walkPageBlocks(p.blocks, function (b) { if (b.id === target.blockId) { found = b; foundPi = idx; } }); });
        if (found) { if (foundPi >= 0) { setActivePage(foundPi); focusFrame(foundPi); } reselectBlockNode(found, getSelectionTypeForBlock(found)); return; }
      }
      var pi = -1;
      if (target.pageId != null) { for (var i = 0; i < (doc.pages || []).length; i++) if (doc.pages[i].id === target.pageId) pi = i; }
      else if (target.chapterId != null) { (doc.pages || []).forEach(function (p, idx) { if (pi < 0 && p.chapterId === target.chapterId) pi = idx; }); }
      if (pi >= 0) { setActivePage(pi); focusFrame(pi); setSelection("page", pi); }
    },
    saveActiveDoc: function (updatedDoc) {
      // persist.js's autosave hands back the object it got from getDoc(), so this is normally the
      // same reference; routing it through the pair-write means a caller that hands back a COPY
      // can never leave the editor holding one document while the registry persists another.
      setActiveDocObject(updatedDoc);
      var ok = saveRegistry(registry);
      renderTabs();
      return ok;
    },
    // #69: the sanctioned, backup-gated browser->file cutover (never flip the flag by
    // hand). Dep-injectable for the test harness; live path needs the native bridge.
    migrateToFileBackend: migrateToFileBackend,
    // Let sibling pipeline modules (persist.js autosave) surface a save failure
    // in the shared indicator instead of swallowing it (XX).
    reportSaveFailure: function (msg) {
      setSaveState("failed", msg || "Autosave failed. Export JSON now to avoid losing work.");
    },
    // Asset store seam (YY / SPEC §4). Store CRUD lives in persist.js
    // (window.AssetStore); these delegate. putAsset returns "asset:<id>" ready
    // ids (or null on failure so callers keep the inline data: URL).
    putAsset: function (dataUrl, meta) { return window.AssetStore ? window.AssetStore.put(dataUrl, meta) : null; },
    assetUrl: function (id) { return window.AssetStore ? window.AssetStore.url(id) : null; },
    getAsset: function (id) { return window.AssetStore ? window.AssetStore.get(id) : null; },
    migrateAssets: migrateAllAssets,
    sweepAssets: sweepAllAssets,
    getTheme: function () { return activeTheme(); },
    getThemes: function () { return workingThemesNow(); },
    // #126 cross-course preset library (also drives the browser-verify + automation).
    themePresets: {
      list: function () { return loadThemePresets(); },
      save: function (name) { return saveThemePreset(name); },
      apply: function (name) { return applyThemePreset(name); },
      rename: function (o, n) { return renameThemePreset(o, n); },
      remove: function (name) { return deleteThemePreset(name); }
    },
    // variant support (phase 3): the list of variant names, a resolved doc for a
    // given variant, and variant-aware page render. `variant` optional -> hero.
    getVariants: function () { return window.getVariants(doc); },
    resolveVariant: function (variant) { return window.resolveVariant(doc, variant); },
    renderPage: function (page, variant) {
      var rdoc = window.resolveVariant(doc, variant);
      var rp = rdoc.pages.filter(function (p) { return p.id === page.id; })[0];
      if (!rp) return null; // page excluded in this variant
      var __rm = (window.resolveMedia && window.AssetStore) ? window.resolveMedia(rdoc, editorAssetResolve) : null;
      try { return window.renderPage(rp, activeTheme(), window.resolveHeaderFooter(rdoc, rp)); }
      finally { if (__rm) __rm(); }
    },
    // uio-P-C05: `opts.direction` ("import" | "export") declares which stage the action belongs to.
    // Omit it and the direction is guessed from the label, so every existing caller keeps working;
    // declare it and the guess is never consulted. Anything inbound should declare it.
    registerPipelineButton: function (label, onClick, accent, opts) {
      var declared = opts && opts.direction;
      pipelineButtons.push({ label: label, onClick: onClick, accent: accent, direction: PIPELINE_DIRECTIONS.indexOf(declared) !== -1 ? declared : null });
      var mount = document.getElementById("sidebar-pipeline-mount");
      if (mount) renderPipelineButtons(mount);
      renderToolbarPipeline(); // D6: keep the primary top-bar Export + ⋯ overflow in sync
      // uio-P-C05: an import registered after boot has to reach the Source stage's Import menu too.
      if (__activeStage === "source") renderSourceToolbar();
    },
    // Interact-mode test/automation hooks (used by the headless function tests
    // and any harness that needs to drive Interact mode programmatically).
    interact: {
      setMode: function (on) { setInteractMode(on); },
      isOn: function () { return interactModeOn(); },
      selectBlock: function (pi, bi) { selectBlock(pi, bi); },
      enterDemo: function () { enterDemo(); },
      exitDemo: function () { exitDemo(); },
      demoRuntime: function () { return demoRuntimeNow(); },
      interactionMap: function () { return window.buildInteractionMap(doc); }
    },
    // Snap-zone DnD test/automation hooks: drive the REAL handleDrop /
    // cleanupColumns / deleteBlockByRef paths headlessly (real HTML5 drag events
    // are impractical in --dump-dom). Editor-chrome only; never touches render.
    dnd: {
      // Drop a moved block onto another block's top/bottom/left/right hotspot.
      dropOnBlock: function (srcPi, srcBlock, targPi, targetBlock, zone, dup) {
        setDragPayload({ kind: "move", page: srcPi, block: srcBlock, duplicate: !!dup });
        setDragTargetZone(zone);
        currentPage = targPi;
        handleDrop({ targetBlock: targetBlock });
      },
      // Insert a new library block onto another block's hotspot.
      insertOnBlock: function (makeIndex, targPi, targetBlock, zone) {
        setDragPayload({ kind: "insert", makeIndex: makeIndex });
        setDragTargetZone(zone);
        currentPage = targPi;
        handleDrop({ targetBlock: targetBlock });
      },
      // Outliner-style reorder: move a block to a page/index slot.
      reorderByIndex: function (srcPi, srcBlock, targPi, targIndex) {
        setDragPayload({ kind: "move", page: srcPi, block: srcBlock, index: -1 });
        handleDrop({ page: targPi, index: targIndex });
      },
      // Append (drop onto empty frame area).
      appendToPage: function (srcPi, srcBlock, targPi) {
        setDragPayload({ kind: "move", page: srcPi, block: srcBlock });
        handleDrop({ pageIndex: targPi, append: true });
      },
      deleteBlock: function (block) { deleteBlockByRef(block); }
    }
  };

  // Curated cross-platform families used when the Local Font Access API is absent
  // or permission is denied (the usual headless / file:// case).
  var FALLBACK_SYSTEM_FONTS = [
    "Arial", "Arial Black", "Book Antiqua", "Bookman Old Style", "Calibri", "Comic Sans MS",
    "Courier New", "Garamond", "Georgia", "Helvetica", "Impact", "Lucida Console",
    "Lucida Sans Unicode", "Palatino Linotype", "Segoe UI", "Tahoma", "Times New Roman",
    "Trebuchet MS", "Verdana"
  ];
  // Pin the embeddable/safe set at the top (dedup the rest against it) so the
  // web/bundled fonts always sit above the fuller system list.
  function composeFontList(rest) {
    var pinned = (window.EMBEDDABLE_FONTS || []).slice();
    if (!pinned.length) pinned = ["Exo 2", "Inter", "System"];
    var seen = {};
    pinned.forEach(function (f) { seen[f] = true; });
    var tail = rest.filter(function (f) { return f && !seen[f]; });
    return pinned.concat(tail);
  }
  async function loadFonts() {
    try {
      // queryLocalFonts is the standard entry point; navigator.fonts.query is the
      // older draft name -- try either where present.
      var q = window.queryLocalFonts
        ? window.queryLocalFonts.bind(window)
        : (navigator.fonts && navigator.fonts.query ? navigator.fonts.query.bind(navigator.fonts) : null);
      if (q) {
        var locals = await q();
        var unique = {};
        (locals || []).forEach(function (f) { unique[f.family] = true; });
        var names = Object.keys(unique).sort();
        if (names.length > 0) {
          window.FONT_LIST = composeFontList(names);
          return;
        }
      }
    } catch (e) {
      console.warn("Local Font Access API unavailable/denied, using curated system fallback list.");
    }
    window.FONT_LIST = composeFontList(FALLBACK_SYSTEM_FONTS);
  }

  // ==========================================================================
  // Variant authoring (phase 3, Feature 1): a right-click CONTEXT MENU to create
  // content/visibility overrides, and a toolbar SWITCHER to preview each variant
  // on the canvas. Overrides (`block.overrides[v]`) + visibility (`variantVis`)
  // are exactly what render.js `resolveVariant` and the SCORM export already
  // consume. Editing happens on the flagship/base; previewing a variant is
  // read-only (inline variant editing comes later).
  // ==========================================================================
  var activeVariant = null; // null = flagship (editable); "<name>" = variant preview
  // #206: the SOFTWARE-VERSION axis (parallel, independent of the product-variant axis).
  // null = base (the editable anchor); "<name>" = a read-only version preview. Edit-in-place
  // for the active version is #207 — here every version preview is read-only, like a variant.
  var activeVersion = null;

  // isPreview() = the READ-ONLY gate for the conservative surfaces (isolated updates, structural
  // edits, badges). It stays true for either axis so those paths do a full, safe rebuild. But the
  // ACTUAL editability gate is narrower: only a VARIANT preview is read-only; a software version
  // is the editable flagship (#207), so canvas editing keys off !activeVariant, not !isPreview().
  function isPreview() { return !!activeVariant || !!activeVersion; }
  // Ticket 15 (platform-pivot, collab): base-only editing while collaborating. All concurrent
  // editing + structural ops target the BASE doc (structural ops are already base-only — isPreview
  // blocks them for any active axis); an axis preview (product-variant OR software-version) is
  // READ-ONLY while collaborating. PURE (no editor state) so tests/run.js pins it. Standalone:
  // collaborating=false, so every result reduces EXACTLY to today's behaviour (a software version
  // stays the editable dynamic flagship #207; only a variant preview is read-only).
  /* @collab-edit-gate-start */
  function collabEditGate(collaborating, activeVariant, activeVersion) {
    var axisActive = !!activeVariant || !!activeVersion;
    return {
      axisPreviewReadOnly: !!collaborating && axisActive,                       // any axis preview -> read-only in collab
      canvasEditable: !activeVariant && !(!!collaborating && !!activeVersion),  // base only under collab
      versionEditable: !!activeVersion && !activeVariant && !collaborating      // #207 in-place version edit off in collab
    };
  }
  /* @collab-edit-gate-end */
  // The ONE collab gate (server URL AND a live connection). VersoSync is always defined (inert
  // without a server URL) -> false in standalone, so every branch below is today's code.
  function collaborating() { return !!(window.VersoSync && window.VersoSync.isCollaborating()); }
  function editGate() { return collabEditGate(collaborating(), activeVariant, activeVersion); }
  // Canvas content is editable on the base doc; a variant preview is always read-only, and a
  // software-version preview becomes read-only too WHILE COLLABORATING (base-only editing).
  function canvasEditable() { return editGate().canvasEditable; }
  // #207: a non-base software version is the editable "dynamic flagship" when no variant preview
  // is layered on top. Base (activeVersion null) edits write base fields; an active version's
  // inline edits capture into versionOverrides[version] — but NOT while collaborating (base only).
  function versionEditable() { return editGate().versionEditable; }
  // The two axes NEST: product resolves first (variant), then the software version resolves on
  // top of the already-product-resolved doc. Base editing
  // (both null) binds to the raw doc so it stays live-editable. An EDITABLE version uses the
  // resolveVersionForEdit tree (all-clone + __vbase back-links) so in-place edits capture to base.
  function currentDoc() {
    var d = doc;
    if (activeVariant) d = window.resolveVariant(d, activeVariant);
    if (activeVersion) {
      d = (versionEditable() && window.resolveVersionForEdit)
        ? window.resolveVersionForEdit(d, activeVersion)
        : (window.resolveVersion ? window.resolveVersion(d, activeVersion) : d);
    }
    // #23: keep render.js's per-pass library-axis hook (window.__libraryAxisContext)
    // in sync with the SAME effective keys this call just resolved, so a libraryInstance
    // placement's master template resolves consistently with the rest of this render
    // pass. Variant is never null (falls back to hero/identity, same as resolveAxis's
    // own identity handling) so axis-tagged master content correctly filters even in
    // flagship/base view; version is null when the doc carries no version axis at all.
    window.applyRenderContext({
      libraryAxisContext: {
        variant: activeVariant || (d.heroVariant || "hero"),
        version: activeVersion || (d.versions && d.versions[0]) || null
      }
    });
    return d;
  }
  function currentPages() { return currentDoc().pages; }
  function variantNames() { return (doc.variants || []).slice(); }
  function versionNames() { return (doc.versions || []).slice(); }

  // ---- context-menu framework ----
  // arch-P3b-07q: the menu and the wiring that decides what a right-click is ON both moved to
  // editor/context-menu.js. They were 900 lines apart here and are one thing.
  var showContextMenu = VE.bind("showContextMenu");
  var closeCtxMenu = VE.bind("closeCtxMenu");
  var wireContextMenu = VE.bind("wireContextMenu");
  var blockMenuItems = VE.bind("blockMenuItems");   // arch-P3b-07: the overflow button's verb list


  // ---- variant model mutations ----
  // arch-P3b-07l: both axes a course varies along -- the variant/version model, the live override
  // panel and the two toolbar switchers -- moved to editor/variants.js.
  var newVariantPrompt = VE.bind("newVariantPrompt");
  var renderVariantOverrides = VE.bind("renderVariantOverrides");
  var previewVariant = VE.bind("previewVariant");
  var renderVariantSwitch = VE.bind("renderVariantSwitch");
  var syncVariantSwitch = VE.bind("syncVariantSwitch");
  var updateVariantBadge = VE.bind("updateVariantBadge");
  var openVariantMenu = VE.bind("openVariantMenu");
  var openVariantMenuAtSwitch = VE.bind("openVariantMenuAtSwitch");
  var renderVersionSwitch = VE.bind("renderVersionSwitch");
  var syncVersionSwitch = VE.bind("syncVersionSwitch");
  var updateVersionBadge = VE.bind("updateVersionBadge");


  // ...continues in copy-editor.js (arch-P3b-07).


  // ...continues in variants.js (arch-P3b-07).


  function isHiddenIn(node, variant) { var vv = node.variantVis; return !!(vv && vv.hide && vv.hide.indexOf(variant) !== -1); }
  function toggleHiddenIn(node, variant) {
    pushHistory();
    var vv = node.variantVis || (node.variantVis = {});
    vv.hide = vv.hide || [];
    var i = vv.hide.indexOf(variant);
    if (i === -1) vv.hide.push(variant); else vv.hide.splice(i, 1);
    if (!vv.hide.length) delete vv.hide;
    if (node.variantVis && !node.variantVis.hide && !node.variantVis.only) delete node.variantVis;
    mount();
  }
  // #207: the SAME show/hide-per-key pattern for the software-version axis (node.versionVis).
  // In an editable version the selected node is a display clone, so tag its BASE node (__vbase).
  function versionBaseNode(node) { return (node && node.__vbase) || node; }
  function isHiddenInVersion(node, version) { var vv = versionBaseNode(node).versionVis; return !!(vv && vv.hide && vv.hide.indexOf(version) !== -1); }
  function toggleHiddenInVersion(node, version) {
    pushHistory();
    var b = versionBaseNode(node);
    var vv = b.versionVis || (b.versionVis = {});
    vv.hide = vv.hide || [];
    var i = vv.hide.indexOf(version);
    if (i === -1) vv.hide.push(version); else vv.hide.splice(i, 1);
    if (!vv.hide.length) delete vv.hide;
    if (b.versionVis && !b.versionVis.hide && !b.versionVis.only) delete b.versionVis;
    mount();
  }
  function deleteBlockByRef(block) {
    // Resolve across the whole page tree (top-level, columns children, group
    // children) -- getBlockPageIndexAndIndex only sees top-level blocks, so a
    // block inside a columns row was previously undeletable. After removal, run
    // the collapse pass so a columns row reduced to one column unwraps to a plain
    // block (no orphan single-column containers).
    var loc = null;
    for (var pi = 0; pi < doc.pages.length; pi++) {
      var res = findBlockParent(doc.pages[pi].blocks, block);
      if (res) { loc = res; break; }
    }
    if (!loc) return;
    // If the block lives in a hotspot card, keep that card open after the delete
    // (selection would otherwise clear -> the popover snaps shut to the image).
    var hsOwner = hotspotOwnerOf(block);
    pushHistory();
    loc.parentArray.splice(loc.index, 1);
    doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
    // `pi` from the resolve loop above = the page the block lived on (loop broke there).
    // Hotspot-card deletes keep the delicate popover-reveal path on a full mount.
    if (hsOwner) { setHotspotEditId(hsOwner.hs.id); clearSelection(); mount(); reselectBlockNode(hsOwner.block, "block"); }
    else { clearSelection(); reapplyStructural(pi); } // PERF: one page, not the world
  }

  // ...continues in variants.js (arch-P3b-07).


  // ...continues in context-menu.js (arch-P3b-07).


  // ---- editor namespace: the host surface (arch-P3b-01) --------------------
  // What a region moved out of this file may reach back for. Sits here, beside __kit and outside
  // the __KIT_MODE gate, for the same reason __kit does: it is a pure reference to functions
  // already defined above, and the table has to exist on both pages that load this file.
  //
  // The panel context first, because the inspector is the region this exists for -- it is the
  // highest-churn surface in the app and the one whose merge conflicts the split is meant to stop.
  window.VersoEditor.provide({
    h: h,
    isHex: isHex,
    panelSection: panelSection,
    sectionGroup: sectionGroup,
    selectRow: selectRow,
    iconField: iconField,
    History: History
  });
  // doc and selection are REPLACED, not mutated -- a doc swap (setDoc, undo, a collab frame)
  // rebinds `doc` wholesale, and every click rebinds `selection`. They go through getters so a
  // region reads the live one at the moment it renders. Handing over the value instead is how the
  // tour builder lost an author's work, and it is what P3-02's close-active-tab fix was about.
  window.VersoEditor.provideLive({
    doc: function () { return doc; },
    selection: function () { return selection; }
  });
  // arch-P3b-02: what the canvas view region reads. The five below are REPLACED wholesale every
  // time buildWorld runs, so they are live -- a captured `world` would leave the module animating
  // the previous one, silently, and only on the second course you open.
  window.VersoEditor.provideLive({
    world: function () { return world; },
    worldH: function () { return worldH; },
    frameDescs: function () { return frameDescs; },
    framePos: function () { return framePos; },
    numCols: function () { return _numCols; },
    currentPage: function () { return currentPage; },
  });
  window.VersoEditor.provide({
    canvas: canvas,
    view: view,                 // mutated in place, never reassigned -- the object itself is stable
    zoomLevelEl: zoomLevelEl,
    colX: colX, frameX: frameX, frameY: frameY,
    FRAME_W: FRAME_W, FRAME_H: FRAME_H, LABEL_H: LABEL_H,
    clamp: clamp,
    persistView: persistView,
    renderCommentPins: renderCommentPins,
    // focusFrame sets the current page, and the perf HUD counts applyView's JS cost. Both are
    // writes INTO this file, so they cross as functions rather than as exposed variables.
    setCurrentPage: function (i) { currentPage = i; },
    // arch-P3b-07world: the render loop MINTS these on every build, and thirty editor.js sites
    // plus five other modules READ them. Per the phase rule that is state that stays here and
    // moves through a narrow setter -- 08 decides where mount and its world state finally sit.
    setWorld: function (el) { world = el; },
    setFramePos: function (a) { framePos = a; },
    setFrameDescs: function (a) { frameDescs = a; },
    setWorldH: function (v) { worldH = v; },
    setNumCols: function (v) { _numCols = v; },
    noteViewJs: function (ms) { noteViewJsSample(ms); }
  });
  // arch-P3b-03: what the inspector section engine reads. `inspector` is the panel host, and this
  // file reassigns it as a render target at thirty-odd sites (`var _ins = inspector; inspector =
  // secBody; try { … } finally { inspector = _ins; }`), so it has to be live -- the section engine
  // must draw into whichever body is current, not the one that was current when it installed.
  window.VersoEditor.provideLive({
    inspector: function () { return inspector; }
  });
  window.VersoEditor.provide({
    openSections: openSections,   // mutated by key, never reassigned
    saveOpenSections: saveOpenSections,
    pushHistory: pushHistory,
    showContextMenu: showContextMenu,
    renderInspector: renderInspector,
    // arch-P3b-07b: these four are EXPOSED by editor/inspector/primitives.js now, and a need()
    // resolves against provide(), so the bound forwarders are what cross to the section engine.
    // The scope TALLY is no longer here at all -- the primitives module owns the buffer and
    // provides it, so the two regions that use it no longer go through this file. Same tidy-up
    // P3b-06 made with the hotspot selection.
    sectionSummary: sectionSummary,
    overrideCount: overrideCount,
    rollupLabel: rollupLabel,
    switchEl: switchEl
  });
  // arch-P3b-07f/07: `activeMode`, comment mode and the open comment used to sit here for the tour
  // board and the preview to read. editor/theme.js owns the previewed mode now and
  // editor/comments.js owns the review state, and each provides its own -- the tidy-up P3b-06 made
  // with the hotspot selection, three more times. What is left is genuinely this file's.
  window.VersoEditor.provideLive({
    // arch-P3b-07g: the canvas backdrop the System tab edits; reassigned on every change.
    canvasBg: function () { return canvasBg; },
    // arch-P3b-07i: the shared multi-select sets. The outliner mutates them in place; the two
    // setters are for the reassignments, because assigning to a provided getter is a TypeError.
    multiSel: function () { return multiSel; },
    // arch-P3b-07: the progressive-drill chain the keyboard map steps through.
    drill: function () { return drill; },
    applyingDrill: function () { return applyingDrill; },
    multiSelPages: function () { return multiSelPages; },
    // arch-P3b-07i: the page the author last copied, offered as "Paste page after" in the tree.
    // arch-P3b-07: what the comment layer reads as the author works. The pin dropper runs in the
    // capture phase and has to know whether a pan or a marquee already owns this gesture, and the
    // comment panel writes its fields into the shared field map like any other panel.
    spaceHeld: function () { return spaceHeld; },
    panning: function () { return panning; },
    last: function () { return last; },
    marquee: function () { return marquee; },
    // arch-P3b-07s: `interactMode` is provided from editor/interact.js, which owns it.
    panelFields: function () { return panelFields; }
  });
  // arch-P3b-07o: `blockToolbarSep` used to be provided from here, because this file built the
  // canvas overlay bar. The bar left with the actions it carries, so block-actions.js owns the
  // separator and provides it live from there; the two modules that read it did not change.
  window.VersoEditor.provideLive({
    // arch-P3b-07q: the state the context menu reads as the author works. `enteredBlock` is also
    // WRITTEN by it ("Enter group"), and a write has to cross as a function -- assigning to a
    // provided getter is a TypeError under "use strict", which is what the extraction guard caught.
    enteredBlock: function () { return enteredBlock; },
    activeVariant: function () { return activeVariant; },
    activeVersion: function () { return activeVersion; },
    // arch-P3b-07d: which document is open. Reassigned on every tab switch, and the backup writer
    // keys its folder and its debounce off it -- a captured value would keep backing up the course
    // the author closed.
    activeDocId: function () { return activeDocId; }
  });
  // arch-P3b-07p: what the Cmd-K palette reads. Most of these are the COMMANDS it dispatches to.
  window.VersoEditor.provide({
    // @p07-provide
    syncCellChip: syncCellChip,
    renderVersionSwitch: renderVersionSwitch,
    renderVariantSwitch: renderVariantSwitch,
    stampDocOpenedAt: stampDocOpenedAt,
    colourForName: colourForName,
    PR: PR,
    connectBackupFolder: connectBackupFolder,
    productSelectOptions: productSelectOptions,
    tagDocCell: tagDocCell,
    tagDocProductStage: tagDocProductStage,
    stampOwnerProductTag: stampOwnerProductTag,
    stampMasterVersion: stampMasterVersion,
    gridMode: gridMode,
    activeBp: activeBp,
    addPageAfter: addPageAfter,
    conditionSources: conditionSources,
    interactModeOn: interactModeOn,
    FRAME_CULL: FRAME_CULL,
    CHAPTER_HEADER_H: CHAPTER_HEADER_H,
    fitChapter: fitChapter,
    makeGridOverlay: makeGridOverlay,
    REVEAL_GLYPH_SVG: REVEAL_GLYPH_SVG,
    wirePageDrag: wirePageDrag,
    pageClipboardNow: pageClipboardNow,
    pageDragSuppressed: pageDragSuppressed,
    showAllConnectorsOn: showAllConnectorsOn,
    revealFrameBlocks: revealFrameBlocks,
    worldW: worldW,
    GAP_Y: GAP_Y,
    GAP_X: GAP_X,
    buildTargetPicker: buildTargetPicker,
    renderOnClickSection: renderOnClickSection,
    setGoto: setGoto,
    renumberSplitFamily: renumberSplitFamily,
    stripSplitSuffix: stripSplitSuffix,
    sectionsBufferOpen: sectionsBufferOpen,
    blockBoxChain: blockBoxChain,
    renderCheckboxBody: renderCheckboxBody,
    renderLibraryInstanceBody: renderLibraryInstanceBody,
    renderComponentGridBody: renderComponentGridBody,
    renderTableInspector: renderTableInspector,
    renderColumnsBody: renderColumnsBody,
    renderSpacerBody: renderSpacerBody,
    renderTextContent: renderTextContent,
    blockChromeHandlers: blockChromeHandlers,
    imageChromeIo: imageChromeIo,
    renderImageContent: renderImageContent,
    IMAGE_PURE_DECL: IMAGE_PURE_DECL,
    renderFrameOrGroupTwoLevel: renderFrameOrGroupTwoLevel,
    renderHotspotInspector: renderHotspotInspector,
    courseNavControls: courseNavControls,
    paletteColorRow: paletteColorRow,
    activeModeNow: activeModeNow,
    embedColorVarsCached: embedColorVarsCached,
    fitEmbeds: fitEmbeds,
    CONTENT_DECL: CONTENT_DECL,
    CONTENT_PURE_DECL: CONTENT_PURE_DECL,
    disclosure: disclosure,
    renderContentlessBlock: renderContentlessBlock,
    reRenderBlockNode: reRenderBlockNode,
    renderBlockTwoLevel: renderBlockTwoLevel,
    endPick: endPick,
    startPick: startPick,
    pageBlockCandidates: pageBlockCandidates,
    propHeader: propHeader,
    renderBlockActionsSection: renderBlockActionsSection,
    attachFontWarn: attachFontWarn,
    startLink: startLink,
    interactReselect: interactReselect,
    wireItemBodyDrops: wireItemBodyDrops,
    attachImageFileDrop: attachImageFileDrop,
    attachEmptyColumnDrops: attachEmptyColumnDrops,
    attachColumnSwaps: attachColumnSwaps,
    attachColumnResizers: attachColumnResizers,
    attachColumnsEdgeBands: attachColumnsEdgeBands,
    wireHotspotNode: wireHotspotNode,
    updateDragAffordance: updateDragAffordance,
    caretInList: caretInList,
    collabChrome: collabChrome,
    selectByType: selectByType,
    getSelectionTypeForBlock: getSelectionTypeForBlock,
    canvasTopBlock: canvasTopBlock,
    toggleMulti: toggleMulti,
    fitWorldRect: fitWorldRect,
    resetDrill: resetDrill,
    selectFieldNode: selectFieldNode,
    // arch-P3b-07m: the drill sets this while it re-selects, so setSelection knows not to reset the
    // chain it is walking. A flag, and the only writer is the drill.
    setApplyingDrill: function (v) { applyingDrill = v; },
    applyDrillLevel: applyDrillLevel,
    openCommentIdNow: openCommentIdNow,
    fitSelection: fitSelection,
    openQuickJump: openQuickJump,
    openSelectionSettings: openSelectionSettings,
    duplicateSelection: duplicateSelection,
    selectAllOnPage: selectAllOnPage,
    enterTextEdit: enterTextEdit,
    zoomOut: zoomOut,
    zoomIn: zoomIn,
    togglePerfHud: togglePerfHud,
    commentModeOn: commentModeOn,
    setCommentMode: setCommentMode,
    // arch-P3b-07: the keyboard map arms space-to-pan; the pan handler here reads it.
    setSpaceHeld: function (v) { spaceHeld = v; },
    SEL: window.VersoSelection,
    currentDoc: currentDoc,
    insertLoc: insertLoc,
    eachCourseNav: eachCourseNav,
    renderStructure: renderStructure,
    clearMultiPages: clearMultiPages,
    remintIds: remintIds,
    // arch-P3b-07: the comment panel clears the shared field map like any other panel does.
    resetPanelFields: function () { panelFields = {}; },
    pageNumberOf: pageNumberOf, pageTitlePart: pageTitlePart,
    cap: cap,
    refreshGridOverlay: refreshGridOverlay,
    deletePage: deletePage,
    savePageAsLibraryMaster: savePageAsLibraryMaster,
    mergePageWithNext: mergePageWithNext,
    hasMergeableNext: hasMergeableNext,
    duplicatePage: duplicatePage,
    pastePage: pastePage,
    deleteChapter: deleteChapter,
    hotspotEntryScreen: hotspotEntryScreen,
    mergeTextValues: mergeTextValues,
    twoStateText: twoStateText,
    drawConnectors: drawConnectors,
    setPageTitle: setPageTitle,
    firstCopyOf: firstCopyOf,
    reorderChapter: reorderChapter,
    COMPONENTS: COMPONENTS,
    blurActiveText: blurActiveText,
    pagesList: pagesList,
    makeDropTarget: makeDropTarget,
    setMultiSel: function (v) { multiSel = v; },
    setMultiSelPages: function (v) { multiSelPages = v; },
    // arch-P3b-07: exposed by editor/comments.js; a need() resolves against provide(), so the
    // bound forwarder is what crosses to the preview.
    resetDemoCommentMode: resetDemoCommentMode,
    collapseTreeToChapters: collapseTreeToChapters,
    createChapter: createChapter,
    fitCycle: fitCycle,
    endMarquee: endMarquee,
    panDrag: panDrag,
    updateMarquee: updateMarquee,
    startMarquee: startMarquee,
    updateStyleAuditBtn: updateStyleAuditBtn,
    toggleStyleAudit: toggleStyleAudit,
    updateGridBtn: updateGridBtn,
    cycleGrid: cycleGrid,
    applyView: applyView,
    commentFromEnv: commentFromEnv,
    rebindTourBuilderToLiveDoc: rebindTourBuilderToLiveDoc,
    commentIsGuest: commentIsGuest,
    refreshCanvasSelection: refreshCanvasSelection,
    clearSelection: clearSelection,
    setInteractMode: setInteractMode,
    demoDeviceEl: demoDeviceEl,
    blockIdByCid: blockIdByCid,
    commentIsOrphaned: commentIsOrphaned,
    demoIsOpen: demoIsOpen,
    demoStageEl: demoStageEl,
    repeatedList: repeatedList,
    reconnectBackupFolder: reconnectBackupFolder,
    bindProjectFolder: bindProjectFolder,
    backupHandleSet: backupHandleSet,
    backupMode: backupMode,
    wirePanelResizer: wirePanelResizer,
    MOD_KEY: MOD_KEY,
    courseNavNests: courseNavNests,
    footerCourseNav: footerCourseNav,
    buildPipelineBody: buildPipelineBody,
    buildComponentsBody: buildComponentsBody,
    buildFontsBody: buildFontsBody,
    renderThemeControls: renderThemeControls,
    buildLayoutBody: buildLayoutBody,
    buildHeaderFooterDefaultBody: buildHeaderFooterDefaultBody,
    buildFooterBody: buildFooterBody,
    buildHeaderBody: buildHeaderBody,
    buildLibraryBody: buildLibraryBody,
    setDevToolsEnabled: setDevToolsEnabled,
    devToolsOn: devToolsOn,
    setSpellcheckEnabled: setSpellcheckEnabled,
    spellcheckOn: spellcheckOn,
    applyUiTheme: applyUiTheme,
    uiThemeIsLight: uiThemeIsLight,
    BG_DEFAULT: BG_DEFAULT,
    applyCanvasBg: applyCanvasBg,
    setCellInteractive: setCellInteractive,
    setCellGeo: setCellGeo,
    bpClampDim: bpClampDim,
    backupSlug: backupSlug,
    hfSectionOpts: hfSectionOpts,
    currentCell: currentCell,
    BP_MAX: BP_MAX,
    BP_MIN: BP_MIN,
    applyBp: applyBp,
    saveBpSizes: saveBpSizes,
    BP_DEFAULTS: BP_DEFAULTS,
    blockById: blockById,
    openCourseFromBrowser: openCourseFromBrowser,
    openSourceTopicId: openSourceTopicId,
    renderSourceArticle: renderSourceArticle,
    clearSourceEditSession: clearSourceEditSession,
    persistSourceDocModel: persistSourceDocModel,
    setSourceDocModel: setSourceDocModel,
    updateSourceDocBar: updateSourceDocBar,
    refreshSourceSelBar: refreshSourceSelBar,
    applySourceLockState: applySourceLockState,
    flushSourceEditSession: flushSourceEditSession,
    sourceActiveTopicId: sourceActiveTopicId,
    applyLeftSection: applyLeftSection,
    renderSourceDocNode: renderSourceDocNode,
    sourceMasterFor: sourceMasterFor,
    pushSourceAlternate: pushSourceAlternate,
    lockSourceEditing: lockSourceEditing,
    insertBlock: insertBlock,
    activeLeftSection: activeLeftSection,
    sourceDocModel: sourceDocModel,
    frameElementUnder: frameElementUnder,
    sourceToast: sourceToast,
    renderEditSourcePanel: renderEditSourcePanel,
    stampRoleStyle: stampRoleStyle,
    findBlockParent: findBlockParent,
    getBlockPageIndexAndIndex: getBlockPageIndexAndIndex,
    insertPageFromLibrary: insertPageFromLibrary,
    getComponents: getComponents,
    paletteAllowsType: paletteAllowsType,
    clearDropMarks: clearDropMarks,
    Store: Store,
    getTextRoles: getTextRoles,
    renameTextStyle: renameTextStyle,
    scopeChain: scopeChain,
    buildFontPicker: buildFontPicker,
    typeCluster: typeCluster,
    modalActions: modalActions,
    refreshSettingsPanes: refreshSettingsPanes,
    getTextStyles: getTextStyles,
    syncSendToPublishCount: syncSendToPublishCount,
    publishToast: publishToast,
    addToQueue: addToQueue,
    applyLayoutVars: applyLayoutVars,
    persistTheme: persistTheme,
    closeCommentPopover: closeCommentPopover,
    fitEmbedsIn: fitEmbedsIn,
    pageIndexById: pageIndexById,
    setDemoCommentMode: setDemoCommentMode,
    BREAKPOINTS: BREAKPOINTS,
    modalHead: modalHead,
    isTextTarget: isTextTarget,
    convertTextListBlockType: convertTextListBlockType,
    buildFormatToggleBar: buildFormatToggleBar,
    sanitizeFieldHtml: sanitizeFieldHtml,
    sanitizeText: sanitizeText,
    scheduleSpellcheck: scheduleSpellcheck,
    versionEditable: versionEditable,
    canvasEditable: canvasEditable,
    isPreview: isPreview,
    stripToText: stripToText,
    resolveComponentDef: resolveComponentDef,
    persistLayout: persistLayout,
    eyeRow: eyeRow,
    clearHeaderFooterDefault: clearHeaderFooterDefault,
    saveHeaderFooterDefault: saveHeaderFooterDefault,
    getHeaderFooterDefault: getHeaderFooterDefault,
    headerFooterSummary: headerFooterSummary,
    onOffLabel: onOffLabel,
    gateScopeChain: gateScopeChain,
    resolveScoped: resolveScoped,
    subDisclosure: subDisclosure,
    crossRefRow: crossRefRow,
    pokeHeaderFooterLive: pokeHeaderFooterLive,
    reapplyLayout: reapplyLayout,
    pageDisplayName: pageDisplayName,
    nestReset: nestReset,
    nestOverridden: nestOverridden,
    reapplyHeaderFooter: reapplyHeaderFooter,
    deleteSelection: deleteSelection,
    saveSelectionAsSectionMaster: saveSelectionAsSectionMaster,
    groupMulti: groupMulti,
    mergeTextBoxes: mergeTextBoxes,
    canMergeTextBoxes: canMergeTextBoxes,
    inMulti: inMulti,
    setImgVariantSrc: setImgVariantSrc,
    uploadImageVariant: uploadImageVariant,
    imgVariantSrc: imgVariantSrc,
    IMG_VERSION_TYPES: IMG_VERSION_TYPES,
    toggleHiddenInVersion: toggleHiddenInVersion,
    isHiddenInVersion: isHiddenInVersion,
    versionNames: versionNames,
    toggleHiddenIn: toggleHiddenIn,
    isHiddenIn: isHiddenIn,
    saveBlockAsComponent: saveBlockAsComponent,
    ungroupBlock: ungroupBlock,
    pasteBlockStyle: pasteBlockStyle,
    copyBlockStyle: copyBlockStyle,
    copySelection: copySelection,
    reapplyBlock: reapplyBlock,
    newVariantPrompt: newVariantPrompt,
    previewVariant: previewVariant,
    pasteClipboard: pasteClipboard,
    openDocIds: openDocIds,
    renderTabs: renderTabs,
    storageBackend: storageBackend,
    newProductPrompt: newProductPrompt,
    importDocToRegistry: importDocToRegistry,
    pickCourseFile: pickCourseFile,
    recentsCompare: recentsCompare,
    docMatchesProductStage: docMatchesProductStage,
    courseMatchesQuery: courseMatchesQuery,
    exportVersoPackage: exportVersoPackage,
    unlinkDocFromProduct: unlinkDocFromProduct,
    promoteToProductModal: promoteToProductModal,
    mount: mount,
    activateDoc: activateDoc,
    switchDoc: switchDoc,
    formatRelativeTime: formatRelativeTime,
    showNewDocDialog: showNewDocDialog,
    stampDocUpdatedAt: stampDocUpdatedAt,
    saveOpenDocIds: saveOpenDocIds,
    pushLayer: pushLayer,
    popLayer: popLayer,
    selectBlock: selectBlock,
    clearAllMulti: clearAllMulti,
    setSelection: setSelection,
    setActivePage: setActivePage,
    focusFrame: focusFrame,
    openSettingsSection: openSettingsSection,
    blockLabel: blockLabel,
    getSettingsSections: getSettingsSections,
    togglePanels: togglePanels,
    zoomTo100: zoomTo100,
    fitAll: fitAll,
    redo: redo,
    undo: undo,
    addPageAfterCurrent: addPageAfterCurrent,
    openFindReplace: openFindReplace,
    openSettingsModal: openSettingsModal,
    enterDemo: enterDemo,
    openHelpModal: openHelpModal,
    setStage: setStage,
  });
  window.VersoEditor.provide({
    getBlockStyles: getBlockStyles,
    setEnteredBlock: function (b) { enteredBlock = b; }, alignSeg: alignSeg, ensureBlockToolbar: ensureBlockToolbar,
    // arch-P3b-07t: what the drag overlay reads. `LIBRARY` is the insertable-type table an
    // Assets-tab drag carries an index into.
    LIBRARY: LIBRARY, clone: clone, walkBlocks: walkBlocks, cleanupColumns: cleanupColumns,
    // Region-to-region: colour is exposed by editor/color.js, and a need() resolves against
    // provide(), so the bound forwarder is what crosses. It dispatches at call time, which is why
    // it does not matter that colour installs first.
    colourControl: colourControl,
    setInspector: function (el) { inspector = el; },
    // arch-P3b-07l: the two axes stay owned here, because the canvas, the outliner, the export and
    // the publish rail all read them. variants.js reads them through the live getters above and
    // writes them through these two, so switching axis still goes through one place.
    setActiveVariant: function (v) { activeVariant = v; },
    setActiveVersion: function (v) { activeVersion = v; },
    // stable: function declarations this file never reassigns
    iconBtn: iconBtn, activeTheme: activeTheme, SVGNS: SVGNS,
    flushSave: flushSave, scheduleSave: scheduleSave, ensureId: ensureId, mintId: mintId,
    versionBaseNode: versionBaseNode, editorAssetResolve: editorAssetResolve, assetRef: assetRef,
    dsSelect: dsSelect,
    reapplyStructural: reapplyStructural, reselectBlockNode: reselectBlockNode,
    findPageOfBlock: findPageOfBlock, canvasNodeForBlock: canvasNodeForBlock,
        promptModal: promptModal, confirmModal: confirmModal,
    clamp: clamp, connectorPathD: connectorPathD,
    segmentedIconLive: segmentedIconLive, clone: clone,
    sweepAllAssets: sweepAllAssets, writeModel: writeModel
  });
  // arch-P3b-05: what the Source stage reads. All stable -- function declarations, constants, and
  // objects this file mutates but never replaces.
  window.VersoEditor.provide({
    libComponents: libComponents, dsModalShell: dsModalShell, modalField: modalField,
    modalSection: modalSection, f04Badge: f04Badge, f04ProductFacts: f04ProductFacts,
    layout: layout, view: view, variantNames: variantNames, registry: registry, History: History,
    getRegistry: getRegistry, saveLibrary: saveLibrary, saveProducts: saveProducts,
    ProductRail: ProductRail, getActiveProduct: getActiveProduct, setActiveProduct: setActiveProduct,
    setProductVariants: setProductVariants, mountProductPicker: mountProductPicker,
    deleteProduct: deleteProduct, deleteProductSource: deleteProductSource,
    unlinkAllCoursesFromProduct: unlinkAllCoursesFromProduct,
    pipelineByDirection: pipelineByDirection, pipelineButtons: pipelineButtons,
    importMenuLabel: importMenuLabel, libraryWhereUsedDetail: libraryWhereUsedDetail,
    makeComment: makeComment, makeReply: makeReply, promptModal: promptModal,
    clearTreeMarks: clearTreeMarks, jumpToLinkedBlock: jumpToLinkedBlock,
    sourceLinkWhereUsed: sourceLinkWhereUsed, sourceLinkAlternates: sourceLinkAlternates,
    sourceAltSnippet: sourceAltSnippet, applyAltToLocation: applyAltToLocation,
    decorateSourceLinks: decorateSourceLinks, snapshotSourceLinkBase: snapshotSourceLinkBase,
    sourceBaseEditImpact: sourceBaseEditImpact, showSourceBaseEditModal: showSourceBaseEditModal,
    finalizeSourceLock: finalizeSourceLock, modalText: modalText,
    saveRegistry: saveRegistry, line: line, dsSelect: dsSelect,
    variantNames: variantNames, confirmModal: confirmModal, showContextMenu: showContextMenu
  });
  // arch-P3b-06: what the hotspots editor reads. Mostly panel primitives and the block-layer verbs
  // its context menu fires. `multiSel` is the multi-selection array, replaced on every marquee.
  window.VersoEditor.provideLive({ multiSel: function () { return multiSel; } });
  window.VersoEditor.provide({
    renderModelView: renderModelView, switchRow: switchRow, colorOpt: colorOpt, twoUp: twoUp,
    segmentedLive: segmentedLive, fieldRow: fieldRow, line: line, optionalRow: optionalRow,
    colorFieldFlat: colorFieldFlat, renderImageVariantVersions: renderImageVariantVersions,
    moveBlock: moveBlock, walkPageBlocks: walkPageBlocks, duplicateBlock: duplicateBlock,
    deleteBlockByRef: deleteBlockByRef, clearBlockContentAction: clearBlockContentAction,
    canSplitAtBlock: canSplitAtBlock, splitPageAtBlock: splitPageAtBlock,
    // Region-to-region: these are EXPOSED by other modules, and a need() resolves against
    // provide(), so the bound forwarders are what cross. The forwarder dispatches at call time,
    // which keeps install order irrelevant.
    beginSections: beginSections, endSections: endSections,
    tourBoardIsOpen: tourBoardIsOpen, openTourBuilder: openTourBuilder,
    tourMakeMarker: VE.bind("tourMakeMarker"),
    renderTourNodes: VE.bind("renderTourNodes"),
    renderTourInspector: VE.bind("renderTourInspector")
  });
  // This list grows as regions move and ask for more -- deliberately, one binding at a time, so
  // the surface stays a record of what is actually depended on rather than a guess. audit().unmet
  // names anything a region asked for that nobody here supplies.
  //
  // Regions install last, once the surface above is complete. Each one reads what it needs and
  // exposes its entry points, which the bind()s further up this file are already pointing at.
  CV.install(VE);
  window.VersoColor.install(VE);             // installs early: the panels below place its rows
  window.VersoInspectorPrimitives.install(VE);   // and every settings row resolves to one of these
  window.VersoDndUi.install(VE);             // owns the drag state the outliner and Assets tab read
  window.VersoPalette.install(VE);   // the Cmd-K index over everything above
  window.VersoBackup.install(VE);   // P0 data-safety: the durable copy on disk
  window.VersoHome.install(VE);   // the pre-document course browser
  window.VersoContextMenu.install(VE);   // right-click, everywhere
  window.VersoModals.install(VE);   // the canonical dialog every editor modal composes from
  window.VersoHeaderFooter.install(VE);   // the global course chrome and the learner nav
  window.VersoStructureOps.install(VE);   // before copy-editor: it aliases TEXT_CONTENT_TYPES at install
  window.VersoVariants.install(VE);   // the variant and version axes
  window.VersoCopyEditor.install(VE);   // the Read view and its find & replace
  window.VersoDemo.install(VE);   // the fullscreen learner preview
  window.VersoHelp.install(VE);   // the in-app user guide
  window.VersoTheme.install(VE);   // the course palette and the Theme panel
  window.VersoFonts.install(VE);   // fonts, embedded so a course works offline
  window.VersoAssets.install(VE);   // the shelf of insertable types and the asset store
  window.VersoSourceLink.install(VE);   // copy that stays joined to its source
  window.VersoSettingsSheet.install(VE);   // the settings sheet and the one Escape contract
  window.VersoComments.install(VE);   // review comments and the presence chrome
  window.VersoOutliner.install(VE);   // the document seen as a list
  window.VersoClipboard.install(VE);   // the verbs that act on a selection
  window.VersoShortcuts.install(VE);   // one place that says what every key does
  window.VersoDiagnostics.install(VE);   // the frame-cadence readout
  window.VersoDrill.install(VE);   // select-first drill-in and zoom-to-fit
  window.VersoInteract.install(VE);   // Interact mode; before actions.js, which aliases ACTION_TYPES
  window.VersoPages.install(VE);   // chapters, and which one a page belongs to
  window.VersoWorld.install(VE);   // the canvas render loop
  window.VersoLibrary.install(VE);   // the shared component library; installs early -- it loads the store
  window.VersoDocuments.install(VE);   // bringing a course into existence
  window.VersoTabs.install(VE);   // the open documents, and which one you are looking at
  window.VersoEditing.install(VE);   // what makes the canvas typeable
  window.VersoActions.install(VE);   // what a learner's click does
  window.VersoInspectorBlocks.install(VE);   // which panel a selected block gets
  window.VersoBlockActions.install(VE);   // the universal panel tail and the canvas action bar

  // arch-P3b-07b: the style-key lists and the container IO list are DATA, not entry points, so they
  // cannot cross as bound forwarders. They are read here, once, the moment their owner has
  // installed. Constants -- nothing reassigns them afterwards.
  ICON_ALIAS = VE.get("ICON_ALIAS");
  CONTAINER_IO_KEYS = VE.get("CONTAINER_IO_KEYS");
  HEADER_STYLE_KEYS = VE.get("HEADER_STYLE_KEYS");
  FOOTER_STYLE_KEYS = VE.get("FOOTER_STYLE_KEYS");
  NAV_BTN_KEYS = VE.get("NAV_BTN_KEYS");
  NAV_PILL_KEYS = VE.get("NAV_PILL_KEYS");
  BOX_SYSTEM_DEFAULTS = VE.get("BOX_SYSTEM_DEFAULTS");

  LIBRARY = VE.get("LIBRARY");

  BLOCK_LUCIDE = VE.get("BLOCK_LUCIDE");

  TEXT_CONTENT_TYPES = VE.get("TEXT_CONTENT_TYPES");

  ACTION_TYPES = VE.get("ACTION_TYPES");
  NAV_ACTIONS = VE.get("NAV_ACTIONS");

  // ---- UI kit gallery seam ----------------------
  // Expose the canonical control primitives + Icon accessor so kit.html can render
  // them live from the REAL source (no copied markup). This is assigned
  // unconditionally (in kit mode AND normal mode) — a pure reference to defined fns.
  //
  // arch-P3b-07b moved it BELOW the install calls. Most of what it exports now lives in
  // editor/inspector/primitives.js and arrives as a bound forwarder or a constant read above; an
  // object literal built before install would have captured the constants as undefined. It is
  // still outside the __KIT_MODE gate, which is what matters -- kit.html needs it.
  window.__kit = {
    Icon: Icon, ICON_ALIAS: ICON_ALIAS, h: h,
    panelSection: panelSection, propHeader: propHeader, optionalRow: optionalRow, repeatedList: repeatedList, renderContainerChrome: renderContainerChrome, CONTAINER_IO_KEYS: CONTAINER_IO_KEYS, breadcrumb: breadcrumb, disclosure: disclosure, subDisclosure: subDisclosure,
    switchRow: switchRow, eyeRow: eyeRow, segmentedIconLive: segmentedIconLive,
    fieldRow: fieldRow, iconField: iconField, twoUp: twoUp,
    selectRow: selectRow, customSelectRow: customSelectRow,
    colourControl: colourControl, colorField: colorField, segmentedLive: segmentedLive,
    inspector: inspector
  };
  window.VersoInspectorSections.install(VE);
  window.VersoSourceStage.install(VE);
  window.VersoHotspotsEditor.install(VE);   // owns the hotspot selection the board reads
  window.VersoTourBoard.install(VE);

  // ---- init ----------------------------------------------------------------
  // Skipped in kit mode (kit.html only needs the primitives defined above, not a
  // booted editor — no doc load, mount, fonts, storage/backup wiring, or panels).
  if (!window.__KIT_MODE) {
  loadTheme();
  loadLayout();
  loadBpSizes(); loadBp(); applyBp();
  var savedBg = null; try { savedBg = localStorage.getItem(BG_KEY); } catch (e) {}
  applyCanvasBg(isHex(savedBg) ? savedBg : BG_DEFAULT);
  wireBpSwitch();
  wireDemo();
  applyUiTheme(uiThemeIsLight()); // #44: restore the saved editor-chrome light/dark theme
  wireCopyEditor(); // #116: full-screen copy-editor view (rail glyph opens, Close/Esc returns)
  mountViewToggle(); // SPEC 7: Build/Read segmented control in the editor header
  mountTopBar(); // #12: hydrate DS icons + promote Preview to the sole primary
  mountDocSettingsBtn(); // edit-header-ia-v2: the header's Document-settings button (the cell chip's
  // geometry/interactivity moved INTO its modal -- the "Document type" settings section)
  mountLeftRail(); // #89: wire the left rail (pinned actions + nav tabs)
  mountPanelOverflow(); // uio-E-C05 (EDIT-09): wire the inspector panel's ⋯ overflow menu
  mountProductPicker(); // Product Rail: top-bar product dropdown (Source/Edit/Publish shared context)
  mountStorageDot(); // #92b: wire the storage-health dot + quota probe
  mountStagingBanner(); // flag a staging Pages deploy so it's never mistaken for production
  refreshCourseWeight(); // §308: initial course-weight readout
  wireLeftSwitcher();
  wireRightTabs();
  // HH: restore the right-panel Design/Interact mode before the boot mount so the
  // canvas + panel render in the saved mode (setInteractMode persists it on change).
  restoreInteractMode();   // arch-P3b-07s: the module owns the flag, the key and the tab sync
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && isPicking()) { endPick(); renderInspector(); } });
  document.addEventListener("selectionchange", onCanvasSelectionChange); // floating-format-bar: above-selection B/I/U on the Edit canvas
  window.addEventListener("scroll", hideCanvasFmtBar, true); // keep the fixed bar from lagging the selection on scroll
  wireResizers();
  renderVariantSwitch();
  renderVersionSwitch(); // #206: software-version switcher (second top-bar glyph)
  wireContextMenu();
  // #67: register the .verso project export in the Export overflow menu. Registered
  // unconditionally (verso-format.js loads AFTER editor.js) — exportVersoPackage guards
  // on window.VersoFormat at click time.
  window.Editor.registerPipelineButton("Export .verso (project)", exportVersoPackage, false);
  // Product Rail Epic 6 (T4): fast-track the open document into the persistent Publish queue with its
  // remembered preset, no configure step -- the early-stage single-export path. Sits in the top-bar
  // overflow beside the other IO actions; the Publish stage's picker rows are the other entry point.
  window.Editor.registerPipelineButton("Send to publish queue", function () { if (activeDocId && registry[activeDocId]) addToQueue(activeDocId); }, false);
  // #69: the guarded browser->file cutover. Registered ONLY when the native store glue is
  // present (Verso desktop shell with the rebuilt bridge) -> invisible in a plain browser,
  // so it can never be triggered where it cannot safely run.
  if (window.__nativeStore) window.Editor.registerPipelineButton("Migrate to file storage (beta)", migrateToFileBackendPrompt, false);
  loadFonts().then(function() { applyDocFonts(); console.info("[fonts] loaded " + window.FONT_LIST.length + " fonts."); }); // KKK: register custom fonts after the picker list composes
  mount();
  // Push the active theme INTO every HTML-interaction iframe on boot. mount() themes
  // the canvas DOM but does NOT cross the iframe boundary — only pushEmbedTheme does,
  // and its sole boot-reachable caller is reapplyTheme (otherwise wired only to the
  // mode toggle / palette edits). Without this, a fresh load / hard reload leaves the
  // shim idle and the interaction on its OWN default palette, so an author's mapped
  // colours (block.embedColorMap) revert until they toggle the mode. This also BINDS
  // the `theme-shim-ready` re-push listener, so iframes that load late (lazy, or async
  // asset:<id> HTML resolved after the initial render) get themed when they announce.
  reapplyTheme();
  // GGG: warn on a fragile storage origin (file:// / no IndexedDB). Bound to `load`
  // (not called inline, nor a setTimeout) because persist.js -- which defines
  // window.storageAdvisory -- loads AFTER editor.js in index.html; the boot
  // migration alert can even pump a setTimeout(0) before persist.js runs, so only
  // the `load` event reliably fires after every classic script has executed.
  window.addEventListener("load", showStorageAdvisory);
  // §12 Viewer: on boot, reconnect the saved review folder and auto-ingest any new
  // reviewer comments (silently — no prompt); then poll every 60s while granted.
  window.addEventListener("load", function () { initReviewAutoIngest(); connectBackupFolder(); });
  // #221: re-open the tour builder after a refresh if it was open (persisted mode).
  window.addEventListener("load", function () { try { maybeReopenTourBuilder(); } catch (_) {} });
  } // end !__KIT_MODE
})();
