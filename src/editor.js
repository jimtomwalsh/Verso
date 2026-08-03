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

  // ---- Chapter ops (JJJJ) ---------------------------------------------------
  function createChapter(name) {
    if (!Array.isArray(doc.chapters)) doc.chapters = [];
    var id = "chap-" + Date.now() + "-" + Math.floor(Math.random() * 1e4);
    var maxOrder = doc.chapters.reduce(function (m, c) { return Math.max(m, (c.order || 0) + 1); }, 0);
    doc.chapters.push({ id: id, name: name || ("Chapter " + (doc.chapters.length + 1)), order: maxOrder });
    return id;
  }
  // Reassign page index `pi` to a chapter, re-sort doc.pages column-major, return
  // the moved page's NEW index (so the caller can keep it selected/current).
  function moveToChapter(pi, chapterId) {
    var pages = doc.pages || [];
    var page = pages[pi];
    if (!page) return pi;
    pages.splice(pi, 1);            // pull it out of its current spot
    page.chapterId = chapterId;
    var at = window.chapterInsertIndex ? window.chapterInsertIndex(pages, chapterId, doc.chapters) : pages.length;
    pages.splice(at, 0, page);      // drop it at the END of the target chapter (addition order)
    return at;
  }
  function chapterPos(id) {
    var sorted = (doc.chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    for (var i = 0; i < sorted.length; i++) if (sorted[i].id === id) return { sorted: sorted, pos: i };
    return { sorted: sorted, pos: -1 };
  }
  // Swap a chapter with its neighbour (dir -1 left / +1 right); re-sort pages.
  function reorderChapter(id, dir) {
    var r = chapterPos(id), pos = r.pos, swap = pos + dir;
    if (pos < 0 || swap < 0 || swap >= r.sorted.length) return false;
    var t = r.sorted[pos].order; r.sorted[pos].order = r.sorted[swap].order; r.sorted[swap].order = t;
    // Keep the chapters ARRAY canonical (sorted by order, order re-indexed to position) so
    // array-index == c.order — otherwise array-index consumers diverge from the outline and
    // Next skips a chapter. (Fix 2026-07-08.)
    if (Array.isArray(doc.chapters)) {
      doc.chapters.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      doc.chapters.forEach(function (c, i) { c.order = i; });
    }
    if (window.resortColumnMajor) doc.pages = window.resortColumnMajor(doc.pages, doc.chapters);
    return true;
  }
  // Delete a chapter; its pages move to the previous chapter (or the next if it
  // was the first). Refuses the last chapter.
  function deleteChapter(id) {
    var chs = doc.chapters || [];
    if (chs.length <= 1) { window.alert("A course needs at least one chapter."); return false; }
    var r = chapterPos(id); if (r.pos < 0) return false;
    var target = r.sorted[r.pos > 0 ? r.pos - 1 : 1];
    (doc.pages || []).forEach(function (p) { if (p.chapterId === id) p.chapterId = target.id; });
    doc.chapters = chs.filter(function (c) { return c.id !== id; });
    if (window.resortColumnMajor) doc.pages = window.resortColumnMajor(doc.pages, doc.chapters);
    return true;
  }

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

  // ---- SHARED COMPONENT LIBRARY (cross-course single-source) -----------------
  // A machine-level store (separate from the per-doc registry) of component DEFS that
  // ANY course references by key. A componentGrid resolves its def doc -> LIBRARY ->
  // built-in, so a library component is single-source: edit the master and every course
  // using it updates. render resolves defs to static HTML at export time (editor
  // context), so the shipped SCORM is self-contained. Storage routes through
  // libraryAdapter() (#18) -- localStorage on the 'browser' backend, the per-user file
  // store on 'file' -- the same seam/flag the doc registry uses.
  // Neutral demo master (ships with the tool, mirrors SAMPLE_DOC's role): a single
  // reusable component carrying one named facet ("pro"), so the shipped demo course's
  // Products & Variants chapter (model.js) has a real shared component to point its
  // libraryInstance placements at on a fresh install. Only used to seed an EMPTY store —
  // never overwrites real authored components.
  function seedDemoLibrary(lib) {
    lib.components["comp-demo-feature"] = {
      name: "Feature Highlight",
      productId: "prod-demo",
      template: {
        id: "lib-demo-root", type: "frame", padding: 24, radius: 12, border: true,
        children: [
          { id: "lib-demo-h", type: "subheading", text: "Standard" },
          { id: "lib-demo-p", type: "paragraph", text: "The Standard tier covers the core feature set." }
        ]
      },
      facets: {
        pro: {
          name: "Pro",
          template: {
            id: "lib-demo-root-pro", type: "frame", padding: 24, radius: 12, border: true,
            children: [
              { id: "lib-demo-h-pro", type: "subheading", text: "Pro" },
              { id: "lib-demo-p-pro", type: "paragraph", text: "The Pro tier adds advanced options on top of the Standard feature set." }
            ]
          }
        }
      }
    };
  }
  function loadLibrary() { return Store.loadLibrary(seedDemoLibrary); }
  window.LibraryStore = loadLibrary();
  function saveLibrary() { Store.saveLibrary(window.LibraryStore); }
  function libComponents() { return (window.LibraryStore && window.LibraryStore.components) || {}; }

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

  function getTextStyles() {
    if (!doc.styles) {
      doc.styles = clone(window.TEXT_STYLES);
    }
    return doc.styles;
  }
  // #127: per-block-TYPE default appearance, on doc.theme.blockStyles (the render arg,
  // reached in render/export via the __blockStyles per-pass hook). Ensures the theme +
  // its blockStyles map exist so a capture/edit never crashes on an old/partial doc.
  function getBlockStyles() {
    if (!doc.theme) doc.theme = window.defaultDocTheme();
    if (!doc.theme.blockStyles || typeof doc.theme.blockStyles !== "object") doc.theme.blockStyles = {};
    return doc.theme.blockStyles;
  }
  // Rename a named text style AND repoint every block.styleRef to the new name so
  // references never break (deep-walk the whole doc — nested blocks + headerFooter).
  function renameTextStyle(oldName, newName) {
    newName = (newName || "").trim();
    if (!newName || newName === oldName) return false;
    var styles = getTextStyles();
    if (styles[newName]) { window.alert('A text style named "' + newName + '" already exists.'); return false; }
    if (!styles[oldName]) return false;
    pushHistory();
    styles[newName] = styles[oldName];
    delete styles[oldName];
    (function repoint(v) {
      if (!v || typeof v !== "object") return;
      if (v.styleRef === oldName) v.styleRef = newName;
      Object.keys(v).forEach(function (k) { repoint(v[k]); });
    })(doc);
    // #145: the type->role map holds style NAMES (not styleRef fields), so repoint it too.
    if (doc.textRoles) Object.keys(doc.textRoles).forEach(function (t) { if (doc.textRoles[t] === oldName) doc.textRoles[t] = newName; });
    if (window.saveRegistry) saveRegistry(registry);
    mount();
    return true;
  }
  window.__renameTextStyle = renameTextStyle; // headless/browser test hook

  // Issue #12 (parent #22): document tabs are the DS DocumentTab; the add button
  // is the DS IconButton (Lucide plus). Re-skin only — the switch/close/new-doc
  // handlers are unchanged. A legacy chip fallback keeps the bar working if the
  // control library is ever absent.
  // SPEC 7 (product-filtered tabs): the global product picker scopes the visible tabs. A tab
  // shows when its doc matches the active product ("" = All products -> every open tab). An
  // untagged doc has no productId, so it only ever shows under All products -- the same rule
  // Product Rail uses everywhere else (an untagged doc is never silently attributed to a
  // filter). PURE (no DOM) so tests/run.js exercises the predicate headlessly.
  function visibleTabIds(openIds, reg, activeProduct) { return PR.visibleTabIds(openIds, reg, activeProduct); }

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
    var activeProduct = (typeof getActiveProduct === "function") ? getActiveProduct() : "";
    var shown = visibleTabIds(openDocIds, registry, activeProduct);
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
          active: id === activeDocId,
          dot: dotColour,
          dotTitle: dotTitle,
          icon: dt.icon,
          typeLabel: dt.label,
          onSelect: function () { switchDoc(id); },
          onClose: function () { closeTab(id); }
        }));
        return;
      }
      var tab = h("div", "toolbar-tab" + (id === activeDocId ? " is-active" : ""));
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
    if (activeDocId === id) {
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
    if (activeDocId === id) return;
    activateDoc(id); // id + doc + registry entry together; history and the page cursor reset
    stampDocOpenedAt(doc, Date.now()); // #71 recents: record the open (in-memory; persists on this doc's next save -> no save-indicator churn per tab click)
    // The active variant/version belong to the outgoing doc; drop them if the new doc lacks them.
    if (activeVariant && (doc.variants || []).indexOf(activeVariant) === -1) activeVariant = null;
    if (activeVersion && (doc.versions || []).indexOf(activeVersion) === -1) activeVersion = null;
    if (typeof connectBackupFolder === "function") connectBackupFolder(); // re-point auto-backup at this doc's folder
    mount();
    renderTabs();
    renderVariantSwitch(); // rebuild the top-bar variant pill for the NEW doc (else it shows the old doc's variants / goes blank)
    renderVersionSwitch(); // #206: same for the software-version switcher
    syncCellChip(); // SPEC 7: reflect the new doc's matrix cell in the header chip
  }

  // SPEC 7: after the product picker changes, re-scope the tab strip. If the active doc fell
  // out of scope and other tabs are visible, activate the first visible one (switchDoc rebuilds
  // the strip + canvas). If NOTHING is in scope, leave the active doc as-is and just redraw the
  // (now empty-but-for-＋) strip -- the file-picker is how the author opens one in that product.
  function reconcileActiveTabToScope() {
    var shown = visibleTabIds(openDocIds, registry, (typeof getActiveProduct === "function") ? getActiveProduct() : "");
    if (shown.length && shown.indexOf(activeDocId) === -1) { switchDoc(shown[0]); return; }
    renderTabs();
  }

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


  // ---- Shared "header & footer default for new courses" ---------------------
  // A machine-level default (localStorage, cross-project) captured from any course's
  // Header & Footer, applied as the starting header/footer of every NEW course. The
  // pure core sanitises what carries: the per-course header TITLE is dropped (each
  // new course uses its own name) and any courseNav SECTIONS are cleared (nav is
  // chapter-derived at render, so styling carries but not the source course's page
  // bindings). The logo asset ref is baked to an inline data URI by the caller so the
  // default is self-contained (survives asset GC + isn't tied to the source course).
  var HF_DEFAULT_KEY = "authoring.defaultHeaderFooter";
  /* @hfdefault-start */
  function sanitizeHeaderFooterDefault(hf) {
    if (!hf || typeof hf !== "object") return null;
    var out = JSON.parse(JSON.stringify(hf));
    if (out.header && typeof out.header === "object") delete out.header.title;
    if (out.footer && Array.isArray(out.footer.children)) {
      out.footer.children.forEach(function (ch) { if (ch && ch.type === "courseNav") ch.sections = []; });
    }
    return out;
  }
  function headerFooterFromDefault(savedDefault, title) {
    if (!savedDefault || typeof savedDefault !== "object") return null;
    var out = JSON.parse(JSON.stringify(savedDefault));
    out.header = out.header || {};
    out.header.title = title; // always the NEW course's own name, never the source course's
    return out;
  }
  /* @hfdefault-end */
  window.__hfDefault = { sanitize: sanitizeHeaderFooterDefault, fromDefault: headerFooterFromDefault };
  function getHeaderFooterDefault() {
    try { var s = localStorage.getItem(HF_DEFAULT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  // Schema-CSV import rebuilds the whole doc from the CSV, which would overwrite the
  // house header/footer default with whatever (often blank) HF the CSV carries. Expose
  // the machine default so importSchema can keep it: returns the default HF for `title`,
  // or null when no house default has been set (then the CSV's own HF is left alone).
  window.__hfDefault.forNewDoc = function (title) {
    var saved = getHeaderFooterDefault();
    return saved ? headerFooterFromDefault(saved, title) : null;
  };
  function saveHeaderFooterDefault() {
    var clean = sanitizeHeaderFooterDefault(doc.headerFooter);
    if (!clean) return false;
    if (clean.header && typeof clean.header.logo === "string") { // bake the logo -> portable data URI
      var m = /^asset:(.+)$/.exec(clean.header.logo);
      if (m && window.AssetStore) { var a = window.AssetStore.get(m[1]); if (a && a.dataUrl) clean.header.logo = a.dataUrl; }
    }
    try { localStorage.setItem(HF_DEFAULT_KEY, JSON.stringify(clean)); return true; } catch (e) { return false; }
  }
  function clearHeaderFooterDefault() { try { localStorage.removeItem(HF_DEFAULT_KEY); } catch (e) {} }

  // SPEC 7: `opts` (optional) = { productId, geo, interactive } from the product-first create
  // flow. When present, the new doc is stamped with its Product (doc.meta.productId) and its
  // matrix cell (doc.meta.geo/interactive) at birth. Omitted -> an untagged doc = today's
  // {reflow, interactive} default, so the old callers are unchanged.
  function createBlankDoc(title, code, opts) {
    if (registry[code]) {
      alert("A course with code '" + code + "' already exists.");
      return;
    }
    var newDoc = {
      meta: { title: title, code: code },
      backupRequired: true, // Slice 2: a new course MUST bind a backup folder (nagged until it does)
      headerFooter: headerFooterFromDefault(getHeaderFooterDefault(), title) || {
        header: { on: true, title: title, subtitle: "Course Orientation", logo: null },
        footer: { on: true, text: "WARNING: This document may contain technical data subject to export control laws." }
      },
      pages: [
        {
          id: "intro",
          name: "Introduction",
          blocks: [
            { type: "heading", text: title },
            { type: "paragraph", text: "Welcome to the " + title + " course." }
          ]
        }
      ]
    };
    opts = opts || {};
    if (opts.productId) tagDocProductStage(newDoc, opts.productId, null);
    if (opts.geo) tagDocCell(newDoc, opts.geo, opts.interactive); // preset {geo, interactive}
    registry[code] = newDoc;
    saveRegistry(registry);
    openDocIds.push(code);
    saveOpenDocIds(openDocIds);
    switchDoc(code);
  }

  function importDocToRegistry(importedDoc) {
    var code = importedDoc.meta.code || ("IMPORTED-" + Math.floor(Math.random() * 1000));
    importedDoc.meta.code = code;
    // Commit + load. Wrapped so any failure is VISIBLE: native alert()/confirm()
    // are swallowed by the Verso WKWebView host (no WKUIDelegate panels), so the
    // old raw confirm()/alert() here failed silently -> "picked a file, nothing
    // happened". Route the overwrite prompt through the DOM confirmModal and log
    // every step so a failed import self-reports in the Web Inspector console.
    function commit() {
      try {
        registry[code] = importedDoc;
        saveRegistry(registry);
        if (openDocIds.indexOf(code) === -1) {
          openDocIds.push(code);
          saveOpenDocIds(openDocIds);
        }
        switchDoc(code);
        if (window.console && console.log) console.log("[import] loaded course '" + code + "'");
      } catch (e) {
        if (window.console && console.error) console.error("[import] commit failed:", e);
        confirmModal("Import failed", "Could not load the course: " + (e && e.message || e), function () {});
      }
    }
    if (registry[code]) {
      confirmModal("Overwrite existing course?",
        "A course with code '" + code + "' already exists. Overwrite it?",
        commit, { danger: true, okLabel: "Overwrite" });
      return;
    }
    commit();
  }

  // Read a picked .verso/.json course file and hand the parsed doc to onDoc.
  // Factored out of showNewDocDialog so the file browser (#74) reuses the exact
  // same read/parse/error path. Native alert() is swallowed by the WKWebView host,
  // so every failure routes through the DOM confirmModal.
  function readCourseFile(file, onDoc) {
    if (!file) return;
    var isVerso = /\.verso$/i.test(file.name || "");
    var reader = new FileReader();
    reader.onerror = function () {
      var err = reader.error;
      if (window.console && console.error) console.error("[import] FileReader error:", err);
      confirmModal("Import failed",
        "Could not read the file" + (err && err.name ? " (" + err.name + ")" : "") + ". It may be too large for this app's memory.",
        function () {});
    };
    reader.onload = function () {
      try {
        var imported;
        if (isVerso) {
          var pkg = window.VersoFormat.readPackage(new Uint8Array(reader.result));
          if (window.AssetStore) Object.keys(pkg.assets).forEach(function (id) {
            window.AssetStore.put(pkg.assets[id].dataUrl, { mime: pkg.assets[id].mime });
          });
          imported = pkg.doc;
        } else {
          imported = JSON.parse(reader.result);
        }
        if (!imported || !imported.pages) {
          confirmModal("Import failed", "That file isn't a valid course document (no pages found).", function () {});
          return;
        }
        if (window.console && console.log) console.log("[import] parsed OK: " + (imported.pages || []).length + " pages from " + file.name);
        onDoc(imported);
      } catch (e) {
        if (window.console && console.error) console.error("[import] parse/import failed:", e);
        confirmModal("Import failed", (isVerso ? "Invalid .verso: " : "Invalid JSON: ") + (e && e.message || e), function () {});
      }
    };
    if (isVerso) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }
  function pickCourseFile(onDoc) {
    var input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json,.verso";
    input.addEventListener("change", function () { readCourseFile(input.files && input.files[0], onDoc); });
    input.click();
  }

  function showNewDocDialog() {
    var existing = document.getElementById("new-doc-modal");
    if (existing) return;

    // Import / sample sit in the footer beside Cancel + Create blank; the whole
    // dialog routes through the DS modal shell (VersoUI.Modal) — issue #19. modal
    // + box are assigned from the shell below.
    var modal, box, titleIn, codeIn;
    // SPEC 7 product-first creation: the new doc is born in a Product (defaults to the current
    // picker scope) and a matrix-cell preset (defaults to eLearning). Resolved to
    // {geo, interactive} via the doc-type model at create time.
    var DT = window.__docType;
    var newDocProduct = (typeof getActiveProduct === "function") ? getActiveProduct() : "";
    var newDocPreset = "elearning";
    var btnImport = window.VersoUI.Button({ variant: "secondary", label: "Import…", onClick: function () {
      pickCourseFile(function (imported) { importDocToRegistry(imported); modal.remove(); });
    } });
    var btnSample = window.VersoUI.Button({ variant: "secondary", label: "Load sample copy", onClick: function () {
      var code = "DEMO-WSE-101-copy-" + Math.floor(Math.random() * 1000);
      var freshSample = clone(window.SAMPLE_DOC || doc);
      freshSample.meta.code = code;
      freshSample.meta.title += " (Copy)";
      importDocToRegistry(freshSample);
      modal.remove();
    } });

    var shell = dsModalShell({
      id: "new-doc-modal", keys: false,
      title: "New document",
      subtitle: "Open a saved course, import a document, or start a blank one.",
      extras: [btnImport, btnSample],
      primaryLabel: "Create blank",
      onPrimary: function () {
        var title = titleIn.value.trim();
        var code = codeIn.value.trim();
        if (!title || !code) { alert("Title and Code are required."); return; }
        var cell = (DT && DT.presetToCell(newDocPreset)) || { geo: "reflow", interactive: true };
        createBlankDoc(title, code, { productId: newDocProduct, geo: cell.geo, interactive: cell.interactive });
        modal.remove();
        // Slice 2: MANDATORY backup-folder setup — prompt the picker immediately (still
        // within this click gesture, required for the native/FSA folder pickers). If the
        // author cancels, the loud "no backup folder" banner nags until they bind.
        bindProjectFolder();
      }
    });
    modal = shell.modal; box = shell.body;

    var closedIds = Object.keys(registry).filter(function (id) {
      return openDocIds.indexOf(id) === -1;
    });
    if (closedIds.length > 0) {
      var openBody = modalSection(box, "Open a saved course");
      var list = h("div", "modal-list");
      closedIds.forEach(function (id) {
        var d = registry[id];
        var item = h("div", "modal-list__item");
        var left = h("div", "insp-list__text");
        left.appendChild(h("span", "insp-list__title", d.meta.title || id));
        left.appendChild(h("span", "insp-list__meta", id));
        item.appendChild(left);
        item.addEventListener("click", function () {
          openDocIds.push(id);
          saveOpenDocIds(openDocIds);
          switchDoc(id);
          modal.remove();
        });
        // Delete a saved (closed) course from the registry. Confirm first; permanent
        // local removal (any exported SCORM / on-disk backup folder is left alone).
        var del = iconBtn("trash", "Delete this saved course", true);
        del.addEventListener("click", function (e) {
          e.stopPropagation(); // don't open the course we're deleting
          confirmModal("Delete course?", "Permanently remove “" + (d.meta.title || id) + "” (" + id + ") from this machine. This can't be undone. Any exported SCORM or backup folder on disk is not affected.", function () {
            delete registry[id];
            saveRegistry(registry);
            var oi = openDocIds.indexOf(id); if (oi !== -1) { openDocIds.splice(oi, 1); saveOpenDocIds(openDocIds); }
            modal.remove(); showNewDocDialog(); // re-render the list fresh
          }, { okLabel: "Delete", danger: true });
        });
        item.appendChild(del);
        list.appendChild(item);
      });
      openBody.appendChild(list);
    }

    box = modalSection(box, "New course");
    // Product (defaults to the current scope) -> preset (matrix cell) -> name, per SPEC 7.
    var prodRow = modalField(box, "Product");
    prodRow.appendChild(window.VersoUI.Select({
      options: productSelectOptions(window.ProductsStore),
      value: newDocProduct,
      onChange: function (v) { newDocProduct = v || ""; }
    }));
    if (DT && window.VersoUI.ChoiceCards) {
      modalField(box, "Start from a preset");
      box.appendChild(window.VersoUI.ChoiceCards({
        options: DT.PRESETS.map(function (p) {
          return { value: p.key, title: p.name, desc: (p.geo.charAt(0).toUpperCase() + p.geo.slice(1)) + " · " + (p.interactive ? "interactive" : "static") };
        }),
        value: newDocPreset,
        onChange: function (v) { newDocPreset = v; }
      }));
    }
    titleIn = modalText(box, "Course title", "", "e.g. My New Course");
    codeIn = modalText(box, "Course code", "", "e.g. DRO-NEW-101");
  }

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
    if (typeof rebindTourBuilderToLiveDoc === "function") rebindTourBuilderToLiveDoc(); // keep an open builder bound to the restored doc
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
    themePresetSel = null; // #126: the picker's shown theme is per-course; don't bleed one course's choice into the next
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
  // §12 slice 1: a comment object. `anchor` is one of the 3 tiers (block/page/
  // general — see makeAnchorFromPoint). `author`/`colour`/`replies` are in the
  // schema now so multi-user colours + threading (slice 5) are ADDITIVE — no
  // migration. Build 1 is flat + `done`.
  function makeComment(anchor, body) {
    var id = (typeof commentIdentity === "function") ? commentIdentity() : { name: null, colour: null };
    return { id: "cm_" + Math.random().toString(36).slice(2, 8), anchor: anchor, body: body || "",
      done: false, author: id.name || null, colour: id.colour || null, createdAt: Date.now(), replies: [] };
  }
  window.__makeComment = makeComment;
  // §12 / #196: pin taxonomy. A comment is one of two KINDS:
  // - "task"    (default): a human-authored instruction — appears in the right-panel queue,
  // open|done via `.done`.
  // - "receipt": a nested CHANGE record under its task via `.parentId`, carrying the before/after
  // text (`.original`/`.changed`) so the author can review + revert. Never appears in
  // the queue; it belongs to its task.
  // Additive to the makeComment schema (exactly like author/colour/replies before it) — NO migration:
  // a legacy comment with no `.kind` reads as a task (see commentIsTask). This is the model + the
  // pure classifiers the list/pin UIs consume.
  // Pure classifiers — no Date/Math/identity deps, so they are asserted headlessly. A comment with
  // no `.kind` is a task (back-compat). Receipts are excluded from the queue and grouped by parent.
  function commentIsReceipt(c) { return !!(c && c.kind === "receipt"); }
  function commentIsTask(c) { return !!c && !commentIsReceipt(c); }
  function taskComments(doc) { return ((doc && doc.comments) || []).filter(commentIsTask); }
  function receiptsFor(doc, taskId) { return ((doc && doc.comments) || []).filter(function (c) { return commentIsReceipt(c) && c.parentId === taskId; }); }
  function openTasks(doc) { return taskComments(doc).filter(function (c) { return !c.done; }); }
  function doneTasks(doc) { return taskComments(doc).filter(function (c) { return !!c.done; }); }
  // ticket 26 (review-links round-trip): guest-vs-internal + orphaned-anchor classifiers. Both are
  // pure + additive over the SHIPPED comment object (no new store, no migration) -- a guest comment
  // is an ordinary doc.comments entry with source:"guest-link"; an orphaned one is a block-anchored
  // note whose target block (by stable cid) the author has since deleted. Surfaced, never dropped.
  /* @comment-guest-start */
  function commentIsGuest(c) { return !!(c && (c.source === "guest-link" || c.guest === true)); }
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
  function docCids(doc, acc) {
    acc = acc || {};
    walkBlocks(doc, function (b) { if (typeof b.cid === "string") acc[b.cid] = true; });
    return acc;
  }
  function commentIsOrphaned(c, doc) {
    var a = c && c.anchor;
    if (!a || !a.blockId) return false; // only block-anchored notes orphan (page/world resolve differently)
    return !docCids(doc)[a.blockId];
  }
  // ticket 26 id-space bridge: the server anchors review comments by the STABLE block id (block.id),
  // but the client comment mode pins by CID (data-cid). Map a server block.id -> its client cid so a
  // guest comment resolves onto the live block. Returns the cid, or null (-> surfaces as orphaned,
  // never mis-anchored). Pure; walks nested containers like docCids.
  function blockCidById(doc, id) {
    if (id == null) return null;
    var found = null;
    walkBlocks(doc, function (b) { if (found == null && b.id === id && typeof b.cid === "string") found = b.cid; });
    return found;
  }
  // inverse of blockCidById: a client cid -> the server STABLE block id, so an author's reply/resolve
  // can be fanned back to the server (which anchors by block.id). Null if unmapped. Pure.
  function blockIdByCid(doc, cid) {
    if (cid == null) return null;
    var found = null;
    walkBlocks(doc, function (b) { if (found == null && b.cid === cid && b.id != null) found = b.id; });
    return found;
  }
  // ticket 26: map a server->client `comment.added` ENVELOPE (blockId + author live on the envelope;
  // {id, threadId, body, kind} in payload -- see server/sync.js) into a client comment shaped like
  // makeComment, anchored by cid so the shipped pins/panel render it. Guest notes carry source. Pure
  // (colourFn injected). -> a client comment, or null if the envelope has no comment id.
  function commentFromEnv(env, doc, colourFn) {
    if (!env) return null;
    var p = env.payload || {};
    if (!p.id) return null;
    var cid = blockCidById(doc, env.blockId);
    return {
      id: p.id,
      anchor: { blockId: cid || env.blockId }, // cid resolves the pin; a raw id falls through to orphaned
      body: p.body || "",
      author: env.author || null,
      colour: env.author ? colourFn(env.author) : null,
      done: false,
      source: (p.kind === "guest") ? "guest-link" : null,
      threadId: p.threadId || p.id,
      createdAt: env.ts || 0,
      replies: []
    };
  }
  /* @comment-guest-end */
  window.__commentModel = { isReceipt: commentIsReceipt, isTask: commentIsTask, tasks: taskComments, receiptsFor: receiptsFor, openTasks: openTasks, doneTasks: doneTasks, isGuest: commentIsGuest, isOrphaned: commentIsOrphaned };
  // #24: where-used for a shared library master -- courses = how many courses in the
  // registry reference it at all, instances = total libraryInstance placements across
  // all of them. Reuses walkBlocks (not a 4th near-duplicate walker) since every
  // libraryInstance placement is an ordinary block, no different from any other #20
  // reference for this purpose. PURE (DOM-free): takes the registry object as data, so
  // tests/run.js can exercise it headlessly against a fixture multi-course registry.
  /* @where-used-start */
  function libraryWhereUsed(ref, registryObj) {
    var courses = 0, instances = 0;
    Object.keys(registryObj || {}).forEach(function (code) {
      var count = 0;
      walkBlocks(registryObj[code], function (b) { if (b.type === "libraryInstance" && b.ref === ref) count++; });
      // #22: a page master's instances are PAGES (page.libraryRef), not blocks -- walkBlocks
      // only reaches doc.pages[].blocks, so count those separately on the same pass.
      ((registryObj[code] && registryObj[code].pages) || []).forEach(function (p) { if (p && p.libraryRef === ref) count++; });
      if (count > 0) { courses++; instances += count; }
    });
    return { courses: courses, instances: instances };
  }
  // Product Rail (source-stage-info-panel): the detailed, per-usage sibling of
  // libraryWhereUsed's counts -- one entry per referencing block, with enough to
  // both label it (document title) and jump to it (docCode + blockId). Generic over
  // any LibraryStore ref (topics included -- a topic is just a kind:"topic" master).
  function libraryWhereUsedDetail(ref, registryObj) {
    var entries = [];
    Object.keys(registryObj || {}).forEach(function (code) {
      var doc = registryObj[code];
      walkBlocks(doc, function (b) {
        if (b.type === "libraryInstance" && b.ref === ref) {
          entries.push({ docCode: code, docTitle: (doc.meta && doc.meta.title) || code, blockId: b.id });
        }
      });
    });
    return entries;
  }
  /* @where-used-end */
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

  // ---- Interact mode ------------------------------
  // A right-panel tab toggles the editor between Design (property inspectors, no
  // connectors) and Interact (interaction editor + authored connectors + canvas
  // tint). One flag drives connector visibility (drawConnectors), the inspector
  // dispatch (renderInspector), and the canvas indicator.
  var interactMode = false;
  var INTERACT_MODE_KEY = "authoring.interactMode"; // HH: persist Design/Interact tab across refresh
  // Interact connectors are CONTEXTUAL to the selection by default: only links
  // touching the selected component(s) draw, so a dense layout isn't spaghetti.
  // "Show all connections" flips to the full overview. Editor-chrome only.
  var showAllConnectors = false;
  var SHOW_ALL_CONNECTORS_KEY = "authoring.showAllConnectors";
  try { showAllConnectors = localStorage.getItem(SHOW_ALL_CONNECTORS_KEY) === "1"; } catch (e) {}
  var commentMode = false; // §12 slice 2: review comment mode (drop pins); declared here so the drill/marquee handlers can bail on it
  function syncRightTabs() {
    var tabs = document.querySelectorAll("#right-ptabs .ptab");
    Array.prototype.forEach.call(tabs, function (t) {
      t.classList.toggle("is-active", t.getAttribute("data-ptab") === (interactMode ? "interact" : "design"));
    });
  }
  function setInteractMode(on) {
    on = !!on;
    if (interactMode === on) return;
    interactMode = on;
    try { localStorage.setItem(INTERACT_MODE_KEY, on ? "1" : "0"); } catch (e) {} // HH
    endPick();                                   // never leave a pick session dangling across modes
    canvas.classList.toggle("is-interact", interactMode);
    syncRightTabs();
    mount();                                     // rebuild world (connectors + tint) + repaint panel
  }
  function wireRightTabs() {
    var tabs = document.querySelectorAll("#right-ptabs .ptab");
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener("click", function () { setInteractMode(t.getAttribute("data-ptab") === "interact"); });
    });
    // #92c: Settings now lives on the left rail (rail-settings-btn, wired in mountLeftRail);
    // the right-panel cog was removed to end the duplication.
    syncRightTabs();
  }

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
  // all blocks on a page (nested included), optionally excluding one — the
  // candidate list for element-target + gate-source pickers.
  function pageBlockCandidates(pi, exclude) {
    var out = [];
    if (pi < 0 || !doc.pages[pi]) return out;
    walkPageBlocks(doc.pages[pi].blocks, function (b) { if (b !== exclude) out.push(b); });
    return out;
  }
  // gate condition sources (flattens allOf) -> list of source ids.
  function conditionSources(cond) {
    var ids = [];
    (function walk(c) {
      if (!c) return;
      if (c.allOf) { c.allOf.forEach(walk); return; }
      if (c.anyOf) { c.anyOf.forEach(walk); return; }
      if (c.source) ids.push(c.source);
    })(cond);
    return ids;
  }

  // ---- click-to-pick (element targets + gate sources, SPEC §6) --------------
  // The panel enters a "pick target" state; the next canvas block click resolves
  // the target/source. A capture-phase canvas handler intercepts so it never
  // triggers normal selection/editing.
  var picking = null; // { onPick, label }
  function startPick(label, onPick) {
    picking = { onPick: onPick, label: label };
    document.body.classList.add("is-picking");
  }
  function endPick() {
    if (!picking) return;
    picking = null;
    document.body.classList.remove("is-picking");
  }
  // Capture-phase so a pick click is consumed before normal selection/editing.
  canvas.addEventListener("mousedown", function (e) {
    if (!picking) return;
    var n = e.target.closest ? e.target.closest(".canvas-block") : null;
    e.preventDefault(); e.stopPropagation();
    var cb = picking.onPick; endPick();
    if (n && n.__block) cb(n.__block);
  }, true);

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


  // Legacy icon-button keys -> Lucide (kebab) names, resolved through the offline
  // Icon accessor (src/icons.js). Hand-drawn ICONS art retired; callers keep their
  // stable keys so wiring is untouched (re-skin, never re-wire).
  var ICON_ALIAS = {
    duplicate: "copy", trash: "trash-2", grip: "grip-vertical", plus: "plus",
    minus: "minus", chevron: "chevron-right", image: "image", refresh: "refresh-cw",
    upload: "upload", unlink: "unlink", eye: "eye", eyeOff: "eye-off",
    arrowUp: "arrow-up", arrowDown: "arrow-down", lock: "lock", unlock: "lock-open",
    slice: "scissors", merge: "fold-vertical"
  };
  function iconBtn(icon, title, danger) {
    var b = h("button", "icon-btn" + (danger ? " icon-btn--danger" : ""));
    b.title = title;
    b.innerHTML = Icon(ICON_ALIAS[icon] || icon);
    return b;
  }

  // ---- active theme (#124: home is doc.theme) -------------------------------
  // The theme TOKENS now live per-course on doc.theme (was editor-global). `activeMode`
  // (which palette you PREVIEW) stays an editor-global UI preference — it's a workspace
  // toggle, not course identity (export bakes BOTH modes; the learner toggles). The
  // token payload is per-doc.
  // // `workingThemes` is a mount-rebuilt CACHE: docThemeToModes(doc.theme) projects the
  // doc's theme onto the { dark, light } FLAT shape applyTheme/render/export consume,
  // sharing the doc's group objects BY REFERENCE — so a panel edit (setToken/
  // setButtonToken) mutates doc.theme in place, and scheduleSave() persists it with the
  // doc. mount()/switchDoc rebuild the cache so setDoc round-trips doc.theme.
  var THEME_MODE_KEY = "authoring.themeMode";
  var activeMode = "dark";
  var workingThemes = window.docThemeToModes(doc && doc.theme ? doc.theme : window.defaultDocTheme());
  function activeTheme() { return workingThemes[activeMode]; }
  // SSSS: which token SET the Theme panel EDITS — independent of the PREVIEWED mode
  // (the NNN top-bar toggle drives the preview/activeMode). null = follow the preview.
  // Lets you edit the light AND dark palettes explicitly, not just the active one.
  var themeEditMode = null;
  function themeEditName() { return themeEditMode || activeMode; }
  function themeEdit() { return workingThemes[themeEditName()]; }
  // Rebuild the working cache from the current doc's theme (called by mount/switchDoc so
  // the panel + canvas + export always reflect THIS course's theme).
  function syncWorkingFromDoc() {
    if (!doc) return;
    if (!doc.theme) doc.theme = window.defaultDocTheme();
    workingThemes = window.docThemeToModes(doc.theme);
  }
  // Only the preview-mode preference is editor-global now; theme tokens ride the doc.
  function loadTheme() {
    try { var m = localStorage.getItem(THEME_MODE_KEY); if (m === "dark" || m === "light") activeMode = m; } catch (e) {}
    syncWorkingFromDoc();
  }
  function persistTheme() {
    try { localStorage.setItem(THEME_MODE_KEY, activeMode); } catch (e) {} // preview pref only
    scheduleSave(); // theme tokens live on doc.theme (mutated in place via workingThemes) -> persist the doc
  }
  function reapplyTheme() {
    var t = activeTheme();
    Array.prototype.forEach.call(canvas.querySelectorAll(".course-root"), function (r) { window.applyTheme(r, t); r.setAttribute("data-mode", activeMode); });
    Array.prototype.forEach.call(canvas.querySelectorAll(".frame"), function (f) { f.style.backgroundColor = t.color.bg; });
    // Item Z: push the active theme INTO each HTML-interaction iframe so it
    // recolours/contrasts too (same call the exported runtime makes on its toggle).
    if (window.pushEmbedTheme) window.pushEmbedTheme(canvas, activeMode, t.color);
    // late-loading iframes announce readiness -> re-push so they don't miss it.
    if (!window.__embedThemeReadyBound) {
      window.__embedThemeReadyBound = true;
      window.addEventListener("message", function (e) {
        var d = e.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (_) { return; } }
        if (d && d.type === "theme-shim-ready" && window.pushEmbedTheme) window.pushEmbedTheme(canvas, activeMode, activeTheme().color);
      });
    }
  }
  function persistThemePref() { try { localStorage.setItem(THEME_MODE_KEY, activeMode); } catch (e) {} }
  // Switching the previewed palette is a UI pref only — it does NOT touch doc.theme, so
  // persist the pref without dirtying/saving the doc.
  function setMode(m) { activeMode = m; reapplyTheme(); persistThemePref(); renderInspector(); updateModeToggle(); }
  // NNN: top-bar light/dark authoring toggle (replaces the Theme-panel selector).
  function updateModeToggle() {
    var b = document.getElementById("mode-toggle");
    if (!b) return;
    b.title = "Switch to " + (activeMode === "dark" ? "light" : "dark") + " palette";
    b.classList.toggle("is-active", activeMode === "light");
  }
  (function wireModeToggle() {
    var b = document.getElementById("mode-toggle");
    if (b) { b.addEventListener("click", function () { setMode(activeMode === "dark" ? "light" : "dark"); }); updateModeToggle(); }
  })();
  // #81 — the Help (?) button used to open the guide in a new browser tab, which
  // silently no-ops in the WKWebView desktop shell / file:// context (and a raw .md
  // wouldn't render as a page anyway). Open the guide IN-APP instead: fetch the
  // markdown (the same fetch mechanism the SCORM export already uses for local src
  // files) and render it into a modal. mdToHtml is a pure, unit-tested subset renderer.
  /* @md-start */
  // Minimal Markdown -> HTML for the in-app Help guide. Trusted, bundled content
  // (docs/USER-GUIDE.md) but HTML-escaped defensively. Covers the guide's subset:
  // headings, fenced code, pipe tables, blockquotes, ordered/unordered lists,
  // horizontal rules, paragraphs, and inline bold / code / links. Deliberately small
  // (no bundler, classic script) — not a general CommonMark parser.
  function mdToHtml(md) {
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function attr(s) { return esc(s).replace(/"/g, "&quot;"); }
    // #25 figure directive: a whole line that is a markdown image, optionally with a
    // CommonMark "caption" title and a {poster=<path>} attribute for the reduced-motion
    // still of a future motion figure (#28). Kept to the mdToHtml subset (one regex, no
    // vendored parser). src/poster are docs/assets/ paths; missing assets degrade to alt
    // text (see openHelpModal's onerror wiring). group order: alt, src, caption, attrs.
    var FIG_RE = /^!\[([^\]]*)\]\(\s*([^)\s"]+)(?:\s+"([^"]*)")?\s*\)(?:\{([^}]*)\})?\s*$/;
    // a line that begins a new block — a list item's lazy continuation stops here.
    function isBlockStart(s) {
      return /^\s*```/.test(s) || /^#{1,6}\s+/.test(s) || /^\s*>\s?/.test(s)
        || /^\s*[-*]\s+/.test(s) || /^\s*\d+\.\s+/.test(s)
        || /^---+\s*$/.test(s) || /^\*\*\*+\s*$/.test(s) || FIG_RE.test(s);
    }
    function figHtml(m) {
      var alt = m[1] || "", srcPath = m[2] || "", caption = m[3] || "", attrs = m[4] || "";
      var pm = attrs.match(/poster\s*=\s*([^\s}]+)/);
      var poster = pm ? pm[1] : "";
      var img = "<img class=\"doc-figure__img\" src=\"" + attr(srcPath) + "\" alt=\"" + attr(alt) + "\" loading=\"lazy\""
        + (poster ? " data-poster=\"" + attr(poster) + "\"" : "") + ">";
      var cap = caption ? "<figcaption class=\"doc-figure__cap\">" + inline(caption) + "</figcaption>" : "";
      return "<figure class=\"doc-figure\">" + img + cap + "</figure>";
    }
    // uio-O-W1 (OVL-23): a keyboard shortcut written in the guide renders as the SAME chip the
    // menus use, instead of bare glyphs floating in a sentence. Pure text pass, run last: a
    // <code> span always wins the alternation, so a shortcut quoted as code stays code.
    function kbdify(html) {
      return String(html).replace(/(<code\b[^>]*>[\s\S]*?<\/code>)|([⌘⌥⇧⌃]+[A-Za-z0-9=\\−-]?)/g,
        function (_m, codeSpan, chip) { return codeSpan ? codeSpan : "<kbd class=\"help-kbd\">" + chip + "</kbd>"; });
    }
    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, function (_m, c) { return "<code>" + c + "</code>"; });
      s = s.replace(/\*\*([^*]+)\*\*/g, function (_m, b) { return "<strong>" + b + "</strong>"; });
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, t, u) { return "<a href=\"" + u + "\" target=\"_blank\" rel=\"noopener\">" + t + "</a>"; });
      return kbdify(s);
    }
    // uio-O-W1 (OVL-23): ONE callout with three tones. A guide callout already leads with its
    // own label ("**Note.**", "**Tip.**", "**Caution.**"), so the tone is read from that label:
    // authors keep writing plain markdown and every callout in the app is drawn one way.
    function calloutTone(text) {
      var m = String(text).match(/^\s*\*\*\s*([^*]+?)\s*\.?\s*\*\*/);
      var w = m ? m[1].trim().toLowerCase() : "";
      if (w === "caution" || w === "warning" || w === "important") return "caution";
      if (w === "tip" || w === "reassurance" || w === "remember" || w === "what you build") return "reassure";
      return "note";
    }
    // #8 heading IDs: slugify heading text so the docs reader's TOC nav can deep-link to a
    // section (ADR 0004 — "guide headings are docs anchors"). Deterministic + unique per doc.
    var seenSlugs = {};
    function slugify(s) {
      var base = String(s).toLowerCase().replace(/`[^`]*`/g, "").replace(/[*_]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      var slug = base, n = 2;
      while (seenSlugs[slug]) { slug = base + "-" + n; n++; }
      seenSlugs[slug] = true;
      return slug;
    }
    function isTableSep(s) { return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(s); }
    function splitRow(s) { return s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); }); }
    var lines = String(md).replace(/\r\n/g, "\n").split("\n");
    var out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*```/.test(line)) { // fenced code
        var buf = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // consume closing fence
        out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) { // pipe table
        var head = splitRow(line); i += 2; var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") { rows.push(splitRow(lines[i])); i++; }
        var th = head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("");
        var trs = rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("");
        out.push("<table><thead><tr>" + th + "</tr></thead><tbody>" + trs + "</tbody></table>");
        continue;
      }
      var hd = line.match(/^(#{1,6})\s+(.*)$/);
      if (hd) { var lv = hd[1].length, ht = hd[2].trim(); out.push("<h" + lv + " id=\"" + slugify(ht) + "\">" + inline(ht) + "</h" + lv + ">"); i++; continue; }
      if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
      var fig = line.match(FIG_RE);
      if (fig) { out.push(figHtml(fig)); i++; continue; }
      if (/^\s*>\s?/.test(line)) { // blockquote -> the one help callout, toned by its own label
        var qb = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qb.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        var qtext = qb.join("\n");
        out.push("<blockquote class=\"help-callout help-callout--" + calloutTone(qtext) + "\">" + mdToHtml(qtext) + "</blockquote>");
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) { // unordered list (with lazy continuation of wrapped lines)
        var ul = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          var uitem = lines[i].replace(/^\s*[-*]\s+/, ""); i++;
          while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) { uitem += " " + lines[i].trim(); i++; }
          ul.push("<li>" + inline(uitem) + "</li>");
        }
        out.push("<ul>" + ul.join("") + "</ul>");
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) { // ordered list (with lazy continuation of wrapped lines)
        var ol = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          var oitem = lines[i].replace(/^\s*\d+\.\s+/, ""); i++;
          while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) { oitem += " " + lines[i].trim(); i++; }
          ol.push("<li>" + inline(oitem) + "</li>");
        }
        out.push("<ol>" + ol.join("") + "</ol>");
        continue;
      }
      if (line.trim() === "") { i++; continue; }
      var pb = []; // paragraph: gather until a blank line or the next block starts
      while (i < lines.length && lines[i].trim() !== "" &&
        !/^\s*```/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) &&
        !FIG_RE.test(lines[i]) &&
        !(/\|/.test(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        pb.push(lines[i]); i++;
      }
      out.push("<p>" + inline(pb.join(" ")) + "</p>");
    }
    return out.join("\n");
  }
  /* @md-end */
  // #8 docs reader: a two-pane guide (sidebar TOC + search on the left, reading pane on the
  // right), modelled on a professional docs site. The TOC is built from the guide's own
  // heading IDs (mdToHtml emits them), so nav + scroll-spy track the content and never drift.
  // uio-F06: `focusId` is a guide heading slug -- the palette passes one so a guide result lands
  // on its section instead of at the top of the guide.
  function openHelpModal(focusId) {
    if (document.getElementById("help-modal")) return;
    var modal = h("div", "modal-overlay"); modal.id = "help-modal";
    var box = h("div", "modal-box modal-box--docs");
    var head = modalHead(box, "User guide", "Verso — how to build and export a course.");
    var x = h("button", "modal-x"); x.type = "button"; x.setAttribute("aria-label", "Close");
    x.innerHTML = window.Icon ? window.Icon("x") : "×";
    head.appendChild(x);

    var split = h("div", "docs-split");
    var nav = h("aside", "docs-nav");
    // uio-F06 (OVL-21): the guide's own "Search the guide" field is GONE. It was a third search
    // box over a third index, next to the document search and the settings the palette now
    // covers -- and the question people actually ask ("where is the disclaimer setting and how
    // does it work?") needed two of them. Guide sections are in the one Cmd-K index; the TOC
    // stays, because a contents list is navigation, not search.
    var toc = h("nav", "docs-toc");
    nav.appendChild(toc);

    var body = h("div", "help-doc"); body.appendChild(h("p", "help-doc__loading", "Loading the guide…"));
    split.appendChild(nav); split.appendChild(body);
    box.appendChild(split);
    modal.appendChild(box);
    document.body.appendChild(modal);
    // uio-F06: the guide joins the ONE layer stack, so Escape over it closes the topmost layer
    // only and focus returns to whatever opened it.
    function close() { if (!modal.parentNode) return; modal.remove(); popLayer("help"); }
    x.addEventListener("click", close);
    modal.addEventListener("mousedown", function (e) { if (e.target === modal) close(); });
    pushLayer("help", close);

    fetch("docs/USER-GUIDE.md", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (md) {
        body.innerHTML = mdToHtml(md);
        postProcessFigures(body);
        buildDocsNav(body, toc);
        if (focusId) {
          var target = body.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId));
          if (target) scrollToHead(body, target);
        }
      })
      .catch(function () {
        body.innerHTML = "";
        body.appendChild(h("p", null, "The guide could not be loaded in this context. Open docs/USER-GUIDE.md from the app folder in a text editor or browser."));
      });
  }

  // #25/#28 figure post-processing (impure, kept out of the pure renderer): reduced-motion
  // swaps a motion figure to its poster still; a broken asset drops to a caption placeholder.
  function postProcessFigures(body) {
    var reduce = false;
    try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var figs = body.querySelectorAll("figure.doc-figure > img.doc-figure__img");
    Array.prototype.forEach.call(figs, function (img) {
      if (reduce && img.getAttribute("data-poster")) { img.src = img.getAttribute("data-poster"); }
      img.addEventListener("error", function () { var fig = img.parentNode; if (fig) fig.classList.add("doc-figure--missing"); });
    });
  }

  // Build the sidebar TOC from the rendered guide's h2/h3 headings and wire click-to-scroll +
  // scroll-spy (the active section follows the reading pane).
  // uio-F06: it no longer returns a search function -- searching the guide is Cmd-K's job now.
  function buildDocsNav(body, toc) {
    var heads = Array.prototype.slice.call(body.querySelectorAll("h2[id], h3[id]"));
    var items = []; // { el(nav button), head, id, level, text }
    heads.forEach(function (hEl) {
      var level = hEl.tagName === "H2" ? 2 : 3;
      var text = hEl.textContent.trim();
      var btn = h("button", "docs-toc__item docs-toc__item--h" + level);
      btn.type = "button"; btn.textContent = text; btn.setAttribute("data-target", hEl.id);
      btn.addEventListener("click", function () { scrollToHead(body, hEl); setActive(hEl.id); });
      toc.appendChild(btn);
      items.push({ el: btn, head: hEl, id: hEl.id, level: level, text: text.toLowerCase() });
    });
    function setActive(id) {
      items.forEach(function (it) { it.el.classList.toggle("is-active", it.id === id); });
      var cur = items.filter(function (it) { return it.id === id; })[0];
      if (cur) cur.el.scrollIntoView({ block: "nearest" });
    }
    // scroll-spy: highlight the topmost heading currently at/above the reading-pane top
    var ticking = false;
    body.addEventListener("scroll", function () {
      if (ticking) return; ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        var top = body.getBoundingClientRect().top, active = items[0];
        for (var k = 0; k < items.length; k++) {
          if (items[k].head.getBoundingClientRect().top - top <= 8) active = items[k]; else break;
        }
        if (active) items.forEach(function (it) { it.el.classList.toggle("is-active", it === active); });
      });
    });
    if (items[0]) items[0].el.classList.add("is-active");
  }
  function scrollToHead(body, hEl) {
    var top = hEl.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTo ? body.scrollTo({ top: Math.max(0, top - 8), behavior: "auto" }) : (body.scrollTop = top - 8);
  }
  (function wireHelp() {
    var b = document.getElementById("help-btn");
    if (b) b.addEventListener("click", openHelpModal);
    var fb = document.getElementById("find-btn");
    if (fb) fb.addEventListener("click", function () { openFindReplace(); });
  })();
  function setToken(key, val) { themeEdit().color[key] = val; reapplyTheme(); persistTheme(); } // SSSS: edits the chosen set
  // KK: edit a theme buttonStyle prop (bg/fg/radius/padY/padX/fontSize). Same
  // live-apply-then-persist path as setToken; reapplyTheme re-emits --button-* so
  // every non-overridden button restyles at once (reference, not copy).
  function ensureButton() { var t = themeEdit(); if (!t.button) t.button = clone(window.THEMES[themeEditName()].button); return t.button; } // SSSS
  function setButtonToken(key, val) { ensureButton()[key] = val; reapplyTheme(); persistTheme(); }
  // #125: edit a SHARED (mode-independent) theme group -- font / space / radius / size.
  // themeEdit()'s shared groups ARE doc.theme's groups (shared by reference via
  // docThemeToModes), so a write mutates doc.theme in place; reapplyTheme re-emits the
  // --<group>-<key> var (applyTheme is generic over every group) and persistTheme saves
  // the doc. Same live-apply-then-persist contract as setToken/setButtonToken.
  function setSharedToken(group, key, val) {
    var t = themeEdit(); if (!t[group]) t[group] = {}; t[group][key] = val;
    reapplyTheme(); persistTheme();
  }

  // ---- theme presets (#126: cross-course library + COPY-ON-APPLY) -----------
  // A preset is a cross-course snapshot { theme:<doc.theme>, textStyles:<doc.styles> }
  // kept in localStorage (NOT the per-doc registry) so it's shared across projects.
  // Applying SNAPSHOTS (deep-clones) the tokens onto THIS doc — no live link — so a
  // course stays self-contained/portable and editing a preset never retro-changes an
  // existing course. Deliberately the OPPOSITE of #99 by-reference styles (see #77 spec).
  // The preset LIBRARY (load/save/merge/apply/rename/delete) is src/theme.js -- it copies theme
  // tokens, so it belongs beside them (arch-P3-09). What stays here is what a module cannot own:
  // the undo push, the repaint and the durable save.
  //
  // Which saved theme the picker shows. UI-only: copy-on-apply keeps no live link, so this is just
  // the last applied/saved name, reset on delete. Editor-global, survives renderInspector rebuilds.
  var themePresetSel = null;
  var TP = window.ThemePresets;
  function loadThemePresets() { return TP.load(localStorage); }
  function saveThemePresets(p) { return TP.save(localStorage, p); }
  function mergeTextStyles(docStyles, presetStyles) { return window.mergeTextStyles(docStyles, presetStyles); }
  function applyThemePresetToDoc(d, preset) { return window.applyThemePresetToDoc(d, preset); }
  function snapshotThemePreset() { return window.snapshotThemePreset(doc.theme, getTextStyles(), Date.now()); }
  function saveThemePreset(name) {
    var presets = loadThemePresets();
    if (!TP.put(presets, name, snapshotThemePreset())) return false;
    saveThemePresets(presets); return true;
  }
  function applyThemePreset(name) {
    var presets = loadThemePresets(), p = presets[name]; if (!p) return false;
    pushHistory(); // theme + styles are doc data now -> an apply is undoable
    applyThemePresetToDoc(doc, p);
    window.applyRenderContext({ docStyles: getTextStyles() }); // render reads the text-style hook
    syncWorkingFromDoc();
    saveRegistry(registry);
    reapplyTheme(); mount(); renderInspector();
    return true;
  }
  function renameThemePreset(oldName, newName) {
    var presets = loadThemePresets();
    var res = TP.rename(presets, oldName, newName);
    if (!res.ok) {
      if (res.reason === "exists") window.alert('A preset named "' + (newName || "").trim() + '" already exists.');
      return false;
    }
    saveThemePresets(presets); return true;
  }
  function deleteThemePreset(name) {
    var presets = loadThemePresets();
    if (!TP.remove(presets, name)) return false;
    saveThemePresets(presets); return true;
  }

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
      cr.setAttribute("data-mode", activeMode);
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
    if (interactMode) decorateInteractHandle();
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
    if (selection.block) containerAncestors(selection.block).forEach(function (c) { openContainers.add(c); });
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
      kitMode: !!window.__KIT_MODE, commentMode: commentMode, interactMode: interactMode,
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

  // ---- Shared palette colour-row (SVG image palette + HTML-interaction palette) ------
  // ONE row = swatch + label + [BG | Text | Keep] toggles + a ⋯ twirl holding the full
  // token dropdown + a "Switch to colour" custom picker. Used identically by both the
  // image SVG palette and the interaction palette so they look + behave the same.
  // BG -> the page-bg token, Text -> ink, Keep -> the authored colour.
  var PALETTE_ROLE_TOKEN = { bg: "bg", text: "ink", keep: "keep" };
  function paletteColorRow(host, o) {
    var map = o.map, key = o.key, tokens = o.tokens || [];
    var explicit = map.hasOwnProperty(key) ? map[key] : null;
    var isCustom = !!explicit && explicit !== "surface" && explicit !== "ink" && explicit !== "keep" && explicit !== "bg";
    var isHexMap = !!explicit && /^(#|rgb)/i.test(String(explicit));
    var role = o.roleOf ? o.roleOf(key) : "keep";
    // Persist the map write NOW (debounced), not only on the 4s autosave tick. Every
    // mutation below routes through apply(), and WKWebView does NOT fire beforeunload
    // on Cmd+R, so without this a colour mapping made just before a hard refresh is
    // lost (reverts) — the same gap the text-edit path closed with scheduleSave. This
    // is the single choke for all three palette consumers (embed / SVG image / glossary).
    function apply() { o.refresh(); scheduleSave(); }
    // Line 1: swatch + label, with a ⋯ advanced-token toggle at the far right.
    var head = h("div", "insp-row");
    var lbl = h("span", "insp-row__label"); lbl.style.flex = "1 1 auto";
    var sw = h("span", "insp-swatch");
    sw.style.cssText = "display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid var(--color-hair);background:" + o.swatchColor;
    lbl.appendChild(sw); lbl.appendChild(document.createTextNode(o.label)); lbl.title = o.label;
    head.appendChild(lbl);
    var advRow = h("div", "insp-row"); advRow.style.marginTop = "5px"; advRow.style.display = isCustom ? "" : "none";
    advRow.appendChild(h("span", "insp-row__label", "Token"));
    var selOpts = [["Auto", "auto"], ["Keep as-is", "keep"]].concat(tokens.map(function (t) { return [t, t]; }));
    if (isHexMap) selOpts.unshift(["Custom colour", "__custom"]);
    var selCurrent = explicit == null ? "auto" : (isHexMap ? "__custom" : explicit);
    var sel = dsSelect(selOpts, selCurrent, function (v) { if (v === "__custom") return; pushHistory(); if (v === "auto") delete map[key]; else map[key] = v; apply(); });
    advRow.appendChild(sel);
    colourControl("Switch to colour", isHexMap ? explicit : null, function (v) { pushHistory(); if (v == null) delete map[key]; else map[key] = v; apply(); }, advRow);
    var advBtn = h("button", null, "⋯");
    advBtn.type = "button"; advBtn.title = "Advanced — map this colour to a specific theme token";
    advBtn.style.cssText = "flex:0 0 auto;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:13px;line-height:1;color:var(--text-secondary);border:1px solid var(--border-subtle);background:" + (isCustom ? "var(--surface-raised)" : "transparent") + ";";
    advBtn.addEventListener("click", function () { advRow.style.display = advRow.style.display === "none" ? "" : "none"; });
    head.appendChild(advBtn);
    host.appendChild(head);
    // Line 2: full-width role toggles — their own row so labels never truncate.
    var roleRow = h("div", "prop-toggle-row"); roleRow.style.marginTop = "5px";
    [["BG", "bg"], ["Text", "text"], ["Keep", "keep"]].forEach(function (ro) {
      var b = h("button", "prop-toggle" + (!isCustom && role === ro[1] ? " is-on" : ""), ro[0]);
      b.type = "button";
      b.title = ro[1] === "bg" ? "Background — follows the theme (light in light mode, dark in dark mode)" : ro[1] === "text" ? "Text — follows the theme (contrasts the background per mode)" : "Keep this colour exactly as authored (brand/accent)";
      b.addEventListener("click", function () { pushHistory(); map[key] = PALETTE_ROLE_TOKEN[ro[1]]; apply(); });
      roleRow.appendChild(b);
    });
    host.appendChild(roleRow);
    host.appendChild(advRow);
  }

  // an embed block selected -> its params. Title is optional and lives with text
  // blocks, not embeds — so embeds expose code/url/height only.
  function renderEmbedInspector(node) {
    var block = node.__block;
    // head omitted (two-level breadcrumb carries identity)
    // // // #161: canonical taxonomy — Content (source), Layout (fit), Light/Dark (theme flip),
    // Appearance (border/radius). Buffered + emitted in PanelLayout order by endSections.
    beginSections();
    if (block.type === "htmlEmbed") {
      // Content — the HTML source + optional bundled file.
      sectionGroup("Content", "HTML code", function (secBody) {
      var _eins = inspector; inspector = secBody;
      try {
      var codeIn = h("textarea", "prop-input prop-code"); codeIn.spellcheck = false;
      codeIn.placeholder = "Paste your interaction's HTML here…";
      // block.html may be an "asset:<id>" ref (hoisted out to AssetStore on save
      // so the doc JSON stays small) -> decode back to raw markup for editing.
      var rawHtml = window.resolveEmbedHtml ? window.resolveEmbedHtml(block.html) : (block.html || "");
      // PERF: a big interaction (MBs of inlined base64) as a LIVE <textarea> makes the
      // whole inspector chug — a multi-MB editable node degrades every subsequent panel
      // interaction while the block is selected, even though the interaction itself runs
      // fine. Above a threshold, DON'T inject the source until the author asks to edit it;
      // the textarea is created (so commit/paste wiring is unchanged) but held out of the
      // DOM. Small interactions behave exactly as before (source shown inline).
      var HTML_INLINE_MAX = 200000; // ~200KB of markup
      var deferSource = rawHtml.length > HTML_INLINE_MAX;
      if (!deferSource) codeIn.value = rawHtml;
      // Fill + reveal the deferred source on demand (explicit author action = accepts the cost).
      function loadSource() {
        if (codeIn.value !== rawHtml) codeIn.value = rawHtml;
        if (loadWrap && loadWrap.parentNode) loadWrap.parentNode.removeChild(loadWrap);
        // #161: append to the captured section body — this fires on a deferred click, after
        // the render's inspector-swap has been restored, so `inspector` would be the panel root.
        if (!codeIn.parentNode) secBody.appendChild(codeIn);
        codeIn.focus();
      }
      // EE: commit to the model on every input (paste/type), like every other
      // field, then rebuild the iframe on `change` (blur) only — rebuilding per
      // keystroke would tear down + refocus the node mid-edit and drop the caret.
      function commitCode(rebuild) {
        block.html = codeIn.value; if (block.html) delete block.src;
        if (rebuild) node = reRenderBlockNode(node);
        renderModelView();
        scheduleSave(); // persist + hoist the pasted HTML (saveRegistry reroutes it to AssetStore)
      }
      codeIn.addEventListener("input", function () { commitCode(false); });
      codeIn.addEventListener("change", function () { commitCode(true); });

      // EE: a direct "Paste from clipboard" button. Cmd+V into this textarea is
      // swallowed in some environments (the Verso WKWebView shell has no Edit-menu
      // Paste key equivalent; a drag that ends off-window can also leave
      // `body.is-dragging-block *` user-select:none stuck over the field). Reading
      // the clipboard on a real click gesture sidesteps all of that. Inserts at the
      // caret (non-destructive) and falls back to a hint if the API is blocked.
      var pasteBtn = h("button", "prop-btn", "Paste from clipboard");
      pasteBtn.style.marginBottom = "6px";
      function flashPaste(msg) { pasteBtn.textContent = msg; setTimeout(function () { pasteBtn.textContent = "Paste from clipboard"; }, 2000); }
      pasteBtn.addEventListener("click", function () {
        if (!codeIn.parentNode) loadSource(); // reveal the deferred field before pasting into it
        if (!navigator.clipboard || !navigator.clipboard.readText) { codeIn.focus(); flashPaste("Unavailable - use Cmd+V in field"); return; }
        navigator.clipboard.readText().then(function (text) {
          if (!text) { flashPaste("Clipboard was empty"); return; }
          codeIn.focus();
          if (typeof codeIn.setRangeText === "function") {
            codeIn.setRangeText(text, codeIn.selectionStart || 0, codeIn.selectionEnd || 0, "end");
          } else {
            codeIn.value = text;
          }
          commitCode(true);
          flashPaste("Pasted");
        }).catch(function () { codeIn.focus(); flashPaste("Blocked - use Cmd+V in field"); });
      });
      inspector.appendChild(pasteBtn);
      // Deferred large source: show a compact placeholder + "Load HTML to edit" instead of
      // the giant textarea, so selecting the block + using the rest of the panel stays snappy.
      var loadWrap = null;
      if (deferSource) {
        loadWrap = h("div", null);
        loadWrap.appendChild(h("div", "insp-hint", "Large interaction (" + (rawHtml.length / 1048576).toFixed(1) + " MB). The source is hidden so the panel stays responsive — load it only to edit the raw HTML."));
        var loadBtn = h("button", "prop-btn", "Load HTML to edit");
        loadBtn.addEventListener("click", loadSource);
        loadWrap.appendChild(loadBtn);
        inspector.appendChild(loadWrap);
      } else {
        inspector.appendChild(codeIn);
      }

      inspector = panelSection(inspector, "Or bundled file");
      // §10 design-consistency: canonical fieldRow (was labeledRow); commits on change.
      fieldRow("src", block.src, function (v) { block.src = v || undefined; node = reRenderBlockNode(node); renderModelView(); }, "path/to/file.html");
      } finally { inspector = _eins; }
      });

      // VV state-conditional: layout/flip/appearance are meaningless with no
      // interaction yet -- show them only once there's HTML or a bundled file.
      if (block.html || block.src) {
      // Layout — interaction fit (embed sizing, not block container chrome).
      sectionGroup("Layout", "Layout", function (secBody) {
      var _lins = inspector; inspector = secBody;
      try {
      // §10 design-consistency: dimensional fields use the canonical iconField (was labeledRow).
      inspector.appendChild(twoUp(
        iconField("W", { value: block.fitWidth || 900, unit: "px", placeholder: "900", step: 10, min: 100, max: 2000, datalist: "dl-gap", title: "Max width — the interaction's natural design width; it never displays wider than this and scales down to fit narrower screens",
          onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { block.fitWidth = n; fitEmbeds(); renderModelView(); } } }).wrap,
        iconField("H", { value: block.height || 500, unit: "px", placeholder: "500", step: 10, min: 50, max: 2000, datalist: "dl-gap", title: "Design height — sets the aspect ratio; scales together with the width",
          onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { block.height = n; fitEmbeds(); renderModelView(); } } }).wrap));
      // §174 unified: one responsive model. The interaction scales to fit the screen up to
      // its Max width, keeps aspect ratio, and stays centred — no Fit/Fill or align juggling.
      inspector.appendChild(h("div", "insp-hint", "Scales to fit the screen up to its Max width, keeps its aspect ratio, and stays centred. Set the width/height to the interaction's natural design size."));
      } finally { inspector = _lins; }
      });

      // Light/Dark — how this interaction reacts when the learner flips light/dark.
      // The theme (tokens + data-mode) is always pushed in; this only chooses the
      // VISUAL fallback for interactions that don't read the tokens themselves:
      // Tokens = conservative bg/text nudge (default) · Invert = aggressive
      // filter-invert in dark (opt-in) · None = leave it alone (self-themed).
      sectionGroup("Light/Dark", "On light & dark", function (secBody) {
      var _dins = inspector; inspector = secBody;
      try {
      segmentedLive("Fallback", [["Tokens", "tokens"], ["Invert", "invert"], ["None", "none"]],
        function (v) { return (block.themeFallback || "tokens") === v; },
        function (v) { if (v === "tokens") delete block.themeFallback; else block.themeFallback = v; node = reRenderBlockNode(node); renderModelView(); });
      // Phase 2 — link the interaction's OWN palette (its declared :root colour vars) to
      // the course theme, using the SAME map model as the SVG palette. Each detected var
      // can Keep its authored colour, map to a theme token (tracks light/dark), or switch
      // to a fixed colour. Dynamic: works for any interaction regardless of its var names.
      var embedVars = embedColorVarsCached(block);
      if (embedVars.length) {
        inspector.appendChild(disclosure("embedPalette", "Interaction colours", function (discBody) {
          discBody.appendChild(h("div", "insp-hint", "This interaction defines its own colours. Give each a role — Background and Text follow light/dark automatically; Keep leaves it as authored. Use ⋯ to map to a specific theme token, or switch it to a fixed colour."));
          block.embedColorMap = block.embedColorMap || {};
          var tokens = (window.paletteTokens && window.paletteTokens()) || [];
          // no auto-classify for an opaque interaction -> an unmapped var defaults to Keep.
          function embedRoleOf(k) {
            var v = block.embedColorMap[k];
            if (v === "bg" || v === "surface" || v === "surfaceAlt") return "bg";
            if (v === "ink" || v === "inkSoft" || v === "muted") return "text";
            return "keep";
          }
          // #85: recolour the interaction LIVE instead of tearing down + reloading
          // its iframe (a full interaction reload = the 2-3s per-click freeze).
          // Rewrite the wrap's baked colour-map and re-push the theme; the in-iframe
          // shim recolours on the message (BACKLOG:252). The shim only SETS map keys
          // and never clears one, so a var switched back to Keep would stick -> push
          // EVERY detected var (Keep/absent = its authored literal) so reverts apply
          // live too. Then re-render the inspector so the toggles reflect the click
          // (cheap now that the colour-var detection is cached).
          var embedRefresh = function () {
            var wrap = (node.classList && node.classList.contains("embed--html")) ? node
              : (node.querySelector && node.querySelector(".embed--html"));
            if (wrap && window.resolveEmbedColorMap) {
              var resolved = window.resolveEmbedColorMap(block), full = {};
              embedVars.forEach(function (ev) { full[ev.name] = resolved.hasOwnProperty(ev.name) ? resolved[ev.name] : ev.value; });
              if (Object.keys(full).length) wrap.setAttribute("data-embed-colormap", JSON.stringify(full));
              else wrap.removeAttribute("data-embed-colormap");
              if (window.pushEmbedTheme) window.pushEmbedTheme(canvas, activeMode, activeTheme().color);
            }
            renderModelView(); renderInspector();
          };
          embedVars.forEach(function (v) {
            paletteColorRow(discBody, { key: v.name, swatchColor: v.value, label: v.name, map: block.embedColorMap, tokens: tokens, roleOf: embedRoleOf, refresh: embedRefresh });
          });
        }));
      }
      } finally { inspector = _dins; }
      });

      // Appearance — border + corner radius (embed skin).
      sectionGroup("Appearance", "Appearance", function (secBody) {
        var _ains = inspector; inspector = secBody;
        try { embedAppearance(node, block); } finally { inspector = _ains; }
      });
      } // end has-content
    } else {
      // webEmbed — Content (URL / offline video) + Appearance.
      sectionGroup("Content", "Source", function (secBody) {
      var _wins = inspector; inspector = secBody;
      try {
      var _srcBody = inspector;
      inspector = panelSection(_srcBody, "URL");
      var urlIn = h("textarea", "prop-input"); urlIn.spellcheck = false;
      urlIn.placeholder = "Vimeo / YouTube / embed URL";
      urlIn.value = block.url || "";
      var readout = h("div", "insp-hint", describeUrl(block.url));
      urlIn.addEventListener("input", function () { block.url = urlIn.value; readout.textContent = describeUrl(urlIn.value); renderModelView(); });
      urlIn.addEventListener("change", function () { block.url = urlIn.value; node = reRenderBlockNode(node); readout.textContent = describeUrl(urlIn.value); });
      inspector.appendChild(urlIn); inspector.appendChild(readout);

      inspector = panelSection(_srcBody, "Offline video (self-host)");
      var fileBtn = h("button", "prop-btn", block.localVideo ? "Replace Video file" : "Upload local video (MP4)");
      fileBtn.addEventListener("click", function () {
        var input = document.createElement("input");
        input.type = "file"; input.accept = "video/mp4,video/webm";
        input.addEventListener("change", function () {
          var file = input.files && input.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            pushHistory();
            block.localVideo = assetRef(reader.result, file);
            fileBtn.textContent = "Replace Video file";
            rmBtn.style.display = "block";
            node = reRenderBlockNode(node);
            renderModelView();
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
      inspector.appendChild(fileBtn);
      
      var rmBtn = h("button", "prop-btn prop-btn--danger", "Remove local video");
      rmBtn.style.marginTop = "6px";
      rmBtn.style.display = block.localVideo ? "block" : "none";
      rmBtn.addEventListener("click", function () {
        pushHistory();
        delete block.localVideo;
        fileBtn.textContent = "Upload local video (MP4)";
        rmBtn.style.display = "none";
        node = reRenderBlockNode(node);
        renderModelView();
      });
      inspector.appendChild(rmBtn);

      // §10 design-consistency: canonical iconField (was labeledRow); live-applies iframe height.
      // Height is the section's own row, not the offline-video group's — back onto the body.
      inspector = _srcBody;
      inspector.appendChild(iconField("H", { value: block.height || 360, unit: "px", placeholder: "360", step: 10, min: 50, max: 2000, datalist: "dl-gap", title: "Height",
        onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { block.height = n; var f = node.querySelector(".embed__iframe"); if (f) f.style.height = n + "px"; renderModelView(); } } }).wrap);
      } finally { inspector = _wins; }
      });

      // Appearance — border + corner radius (embed skin).
      sectionGroup("Appearance", "Appearance", function (secBody) {
        var _ains = inspector; inspector = secBody;
        try { embedAppearance(node, block); } finally { inspector = _ains; }
      });
    }

    endSections(inspector);
    // footer omitted (spacing + actions at Block level)
  }

  // border + corner radius controls (default off — embeds render as authored).
  // §10 design-consistency: migrated from a bespoke prop-toggle-row + labeledRow to
  // the canonical segmentedLive + iconField, applied live (no mount).
  function embedAppearance(node, block) {
    // #161: no own header — rendered inside the canonical Appearance sectionGroup at the call site.
    switchRow("Stroke", function () { return !!block.border; },
      function (v) { block.border = v; applyAppearance(node, block); renderModelView(); });
    inspector.appendChild(iconField(Icon("radius"), { value: block.radius, unit: "px", placeholder: "0", step: 1, min: 0, max: 100, datalist: "dl-radius", title: "Corner radius",
      onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.radius; else block.radius = n; applyAppearance(node, block); renderModelView(); } }).wrap);
    // #176: author-settable letterbox/background colour behind the player. Default
    // ("Default") falls to the theme var(--color-bg) (tracks light/dark) via CSS —
    // so unset embeds keep the theme-aware fill; a value paints the surround.
    if (block.type === "webEmbed") {
      colorFieldFlat("Fill", block.embedBg || null, function (v) {
        pushHistory();
        if (v) block.embedBg = v; else delete block.embedBg;
        applyAppearance(node, block); renderModelView();
      });
    }
  }
  function applyAppearance(node, block) {
    var f = node.querySelector(".embed__iframe");
    if (!f) return;
    f.style.border = block.border ? "1px solid var(--color-hair)" : "0";
    f.style.borderRadius = (block.radius || 0) + "px";
    // #176: live-apply the letterbox fill to the wrapper (the visible bands) + the
    // media element (its object-fit letterbox); empty clears back to CSS default.
    var wrap = node.classList && node.classList.contains("embed--web") ? node : node.querySelector(".embed--web");
    if (wrap) wrap.style.background = block.embedBg || "";
    f.style.background = block.embedBg || "";
  }
  function describeUrl(url) {
    var info = window.parseVideo(url);
    if (info.provider === "empty") return "Paste a Vimeo / YouTube / embed URL.";
    return "Detected: " + info.provider + (info.id ? " · id " + info.id : "") +
      (info.provider === "vimeo" ? " — plays live here; self-hosted at export." : " — live in editor.");
  }
  function getBlockPageIndexAndIndex(block) {
    for (var pi = 0; pi < doc.pages.length; pi++) {
      var pg = doc.pages[pi]; if (!pg || !pg.blocks) continue; // a stray null/malformed page entry must not abort every later page's lookup
      var idx = pg.blocks.indexOf(block);
      if (idx >= 0) return { pageIndex: pi, blockIndex: idx };
    }
    return null;
  }
  function getSelectionTypeForBlock(block) {
    if (block.type === "htmlEmbed" || block.type === "webEmbed") return "embed";
    if (block.type === "navButton") return "navButton";
    if (block.type === "componentGrid") return "block";
    if (block.type === "libraryInstance") return "block";
    // non-text primitives + containers are configured in the block inspector
    if (block.type === "image" || block.type === "divider" || block.type === "spacer" || block.type === "frame" || block.type === "group" || block.type === "checkbox" || block.type === "accordion" || block.type === "cardReveal" || block.type === "sequence" || block.type === "cardDeck" || block.type === "courseNav") return "block";
    if (block.type === "quiz" || block.type === "hotspot" || block.type === "table") return "block";
    return "field";
  }
  function duplicateBlock(block) {
    var loc = getBlockPageIndexAndIndex(block);
    if (!loc) return;
    pushHistory(); // DDD: was undoable-gap — no caller pushed, so a duplicate couldn't be undone
    var pi = loc.pageIndex, idx = loc.blockIndex;
    var fresh = remintIds(clone(block)); // re-mint so the copy's ids never collide
    doc.pages[pi].blocks.splice(idx + 1, 0, fresh);
    reapplyStructural(pi); // PERF: one page, not the world
    reselectBlockNode(fresh, getSelectionTypeForBlock(fresh));
  }
  // #174: text-bearing block types whose authored copy lives on block.text.
  var TEXT_CONTENT_TYPES = { heading: 1, subheading: 1, paragraph: 1, note: 1, quote: 1, list: 1 };
  // #174 Clear content: recursively blank a block subtree's authored CONTENT — text,
  // image/embed asset refs, and interactive copy (item titles/labels/dates, quiz
  // prompts/option text/feedback, hotspot labels + base image) — while KEEPING the block
  // SKELETON: every sub-block, column, item and question stays; only its payload is wiped.
  // Turns a built block (or a whole container subtree) into a reusable blank template.
  // PURE data mutation on the block tree, deleting REFERENCES only (no AssetStore hoist) ->
  // storage-invariant safe. Recurses the canonical subtree shape (children / columns[] /
  // items[].children / items[].front / hotspots[].blocks), mirroring the doc deep-walks.
  function clearBlockContent(block) {
    if (!block || typeof block !== "object") return;
    var t = block.type;
    if (TEXT_CONTENT_TYPES[t]) block.text = "";
    if (t === "image") { delete block.src; delete block.srcLight; delete block.srcDark; delete block.caption; delete block.alt; }
    if (t === "htmlEmbed" || t === "webEmbed") { delete block.html; delete block.src; }
    if (t === "hotspot") {
      // #215 unified screen-graph: visuals/alt live on the Screen nodes; markers keep
      // their position/action skeleton, lose label, recurse card blocks. Inlined walk
      // (not hotspotCardArrays) so the tests' clearBlockContent slice stays standalone.
      delete block.src; delete block.alt; delete block.markerSvg; delete block.markerHtml;
      if (Array.isArray(block.screens)) block.screens.forEach(function (s) {
        if (!s) return; delete s.visual; delete s.alt;
        if (Array.isArray(s.markers)) s.markers.forEach(function (m) {
          if (!m) return; delete m.label;
          if (Array.isArray(m.blocks)) m.blocks.forEach(clearBlockContent);
        });
      });
    }
    if (t === "cardReveal") delete block.hint;
    if (t === "quiz" && Array.isArray(block.questions)) block.questions.forEach(function (q) {
      if (!q) return;
      q.prompt = ""; delete q.feedbackCorrect; delete q.feedbackIncorrect;
      if (Array.isArray(q.options)) q.options.forEach(function (o) { if (o) o.text = ""; });
    });
    // Container / item recursion — keep the skeleton, clear the payload.
    if (Array.isArray(block.children)) block.children.forEach(clearBlockContent);
    if (Array.isArray(block.columns)) block.columns.forEach(function (col) { if (Array.isArray(col)) col.forEach(clearBlockContent); });
    if (Array.isArray(block.items)) block.items.forEach(function (it) {
      if (!it) return;
      if ("title" in it) it.title = "";
      if ("label" in it) delete it.label;
      if ("date" in it) delete it.date;
      if (Array.isArray(it.children)) it.children.forEach(clearBlockContent);
      if (Array.isArray(it.front)) it.front.forEach(clearBlockContent);
    });
  }
  window.__clearBlockContent = clearBlockContent; // #174 test hook (pure subtree clear)
  // #170/#33: text<->list BLOCK-TYPE conversion (not an inline execCommand list -- a
  // whole-block type swap between the dedicated "list" type and any other text-content
  // type). Only block-level tags are treated as item breaks, so inline formatting
  // (b/i/u/span/a) survives untouched inside each <li>.
  /* @list-convert-start */
  function htmlToListItems(html) {
    var s = String(html == null ? "" : html);
    s = s.replace(/<\/(p|div)>/gi, "\n").replace(/<(p|div)[^>]*>/gi, "").replace(/<br\s*\/?>/gi, "\n");
    var lines = s.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
    if (!lines.length) return "<li></li>";
    return lines.map(function (l) { return "<li>" + l + "</li>"; }).join("");
  }
  // Inverse: join <li> items back into one flowing field, each item's inline HTML kept
  // intact, multiple items separated by <br> so nothing is silently dropped.
  function listItemsToHtml(liHtml) {
    var s = String(liHtml == null ? "" : liHtml);
    var items = [], re = /<li[^>]*>([\s\S]*?)<\/li>/gi, m;
    while ((m = re.exec(s))) items.push(m[1].trim());
    if (!items.length) return s; // not actually <li>-shaped -- return untouched (defensive)
    return items.join("<br>");
  }
  // Converts a text-content block to/from the dedicated "list" type IN PLACE. Remembers
  // the PRIOR type on the block (__priorTextType) so a round-trip restores it (default
  // "paragraph" if that memory is somehow absent) -- heading<->list<->heading is lossless
  // on TYPE; content is lossless on inline formatting (see htmlToListItems above).
  function convertTextListBlockType(block) {
    if (!block) return block;
    if (block.type === "list") {
      var restore = block.__priorTextType || "paragraph";
      block.text = listItemsToHtml(block.text);
      block.type = restore;
      delete block.__priorTextType;
    } else {
      block.__priorTextType = block.type;
      block.text = htmlToListItems(block.text);
      block.type = "list";
    }
    return block;
  }
  /* @list-convert-end */
  window.__convertTextListBlockType = convertTextListBlockType; // test hook
  // Action wrapper: confirm (destructive), push history, clear one or more blocks, remount.
  function clearBlockContentAction(blocks) {
    var list = Array.isArray(blocks) ? blocks.filter(Boolean) : [blocks].filter(Boolean);
    if (!list.length) return;
    var msg = list.length > 1
      ? ("Empty all copy, images and embeds from these " + list.length + " blocks? The block structure is kept; this can be undone.")
      : "Empty all copy, images and embeds from this block? The block structure is kept; this can be undone.";
    confirmModal("Clear content", msg, function () {
      pushHistory();
      list.forEach(clearBlockContent);
      var pi = findPageOfBlock(list[0]);
      if (pi >= 0) reapplyStructural(pi); else mount();
      reselectBlockNode(list[0], getSelectionTypeForBlock(list[0]));
    }, { danger: true, okLabel: "Clear content" });
  }
  // Page context menu: deep-clone a page (fresh page + block ids), keep it in the
  // same chapter, and drop it right after the source. Mirrors splitPageAtBlock's
  // chapter-inherit + courseNav section-membership sync so nav/progress stay correct.
  function duplicatePage(pi) {
    var src = doc.pages[pi];
    if (!src) return;
    pushHistory();
    var copy = clone(src);                 // carries chapterId, padX/Y, hide flags, blocks
    copy.id = "page-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    copy.name = (src.name || "Page") + " copy"; // legacy field (export data-name)
    // P2: freeze a disambiguating title override on the duplicate so it doesn't read as an
    // identical auto-derived name to its source (number stays auto-derived by position).
    var _srcTitle = (src.title != null ? String(src.title) : firstCopyOf(src));
    if (_srcTitle) copy.title = _srcTitle + " copy"; else delete copy.title;
    (copy.blocks || []).forEach(remintIds); // re-mint block ids so the copy never collides
    doc.pages.splice(pi + 1, 0, copy);
    // sync section membership: wherever src.id sits, drop copy.id right after it
    eachCourseNav(function (nav) {
      (nav.sections || []).forEach(function (sec) {
        var at = (sec.pageIds || []).indexOf(src.id);
        if (at >= 0 && sec.pageIds.indexOf(copy.id) < 0) sec.pageIds.splice(at + 1, 0, copy.id);
      });
    });
    currentPage = pi + 1;
    mount();
    setActivePage(pi + 1);
    focusFrame(pi + 1);
    setSelection("page", pi + 1);
  }
  // #22: capture a whole PAGE as a shared-library master. Goes straight to the shared
  // library (unlike a block, which stages through doc.components / "My Components" first)
  // -- a course-local "My Pages" concept has no clear use on its own, cross-course reuse
  // IS the point for a page. Mints every block's id ONCE here (remintIds per top-level
  // block, mirroring saveBlockAsComponent) -- from this point those ids are PERMANENT
  // (#19's contract), the substrate #21-style overrides on this page's instances key to.
  function savePageAsLibraryMaster(pi) {
    var page = doc.pages[pi];
    if (!page) return;
    promptModal("Name this reusable page", "Page name", page.name || page.title || "Page", function (v) {
      var name = (v || "").trim();
      if (!name) return;
      var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) { alert("Please use a name with some letters or numbers."); return; }
      function save() {
        pushHistory();
        var blocks = (page.blocks || []).map(function (b) { return remintIds(clone(b)); });
        window.LibraryStore.components[id] = { name: name, kind: "page", template: { blocks: blocks } };
        saveLibrary();
        mount(); setSelection("page", pi);
        alert("Saved “" + name + "” to the shared library. Find it in Settings → System → Component Library.");
      }
      if (libComponents()[id]) confirmModal("Overwrite component", "The library already has “" + id + "”. Overwrite it?", save, { okLabel: "Overwrite" });
      else save();
    });
  }
  // #22: insert a NEW page that live-links to a page master, right after the current
  // page in its chapter -- same insertion shape as duplicatePage (fresh page id,
  // courseNav section sync), but the page carries libraryRef instead of its own blocks.
  function insertPageFromLibrary(key) {
    pushHistory();
    var afterId = doc.pages[currentPage] && doc.pages[currentPage].id;
    var newPage = {
      id: "page-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      name: (libComponents()[key] && libComponents()[key].name) || "Page",
      chapterId: doc.pages[currentPage] && doc.pages[currentPage].chapterId,
      libraryRef: key
    };
    doc.pages.splice(currentPage + 1, 0, newPage);
    eachCourseNav(function (nav) {
      (nav.sections || []).forEach(function (sec) {
        var at = (sec.pageIds || []).indexOf(afterId);
        if (at >= 0 && sec.pageIds.indexOf(newPage.id) < 0) sec.pageIds.splice(at + 1, 0, newPage.id);
      });
    });
    currentPage = currentPage + 1;
    mount();
    setActivePage(currentPage);
    setSelection("page", currentPage);
  }
  // #22: convert a live page-instance into an independent page, in place -- same "detach
  // bakes what you see" principle #21/#23 established for block instances: axis content
  // resolves, THEN instance overrides apply, THEN every block's id is freshly reminted
  // (a genuine new landed copy, per #19's remintIds contract). Keeps a __linkedFrom
  // breadcrumb (no relink UI for pages in v1 -- out of this ticket's agreed scope, unlike
  // #21's block-level Relink).
  function detachPageLibraryInstance(pi) {
    var page = doc.pages[pi];
    if (!page || !page.libraryRef) return;
    var def = resolveComponentDef(page.libraryRef);
    if (!def || !def.template) return;
    pushHistory();
    var ref = page.libraryRef;
    var blocks = (def.template.blocks || []).map(function (b) {
      var withOverrides = clone(b);
      if (window.resolveLibraryAxisContent) withOverrides = window.resolveLibraryAxisContent(withOverrides, window.__libraryAxisContext);
      if (page.overrides && window.applyInstanceOverrides) window.applyInstanceOverrides(withOverrides, page.overrides);
      return remintIds(withOverrides);
    });
    delete page.libraryRef;
    delete page.overrides;
    page.__linkedFrom = ref;
    page.blocks = blocks;
    mount(); setActivePage(pi); setSelection("page", pi);
  }
  // Split-page v2: merge a page with the one after it (inverse of splitPageAtBlock).
  // Only within the SAME chapter (the column-major next page) so content never jumps
  // chapters unexpectedly. Appends the next page's blocks, drops it, cleans courseNav.
  function hasMergeableNext(pi) {
    var a = doc.pages[pi], b = doc.pages[pi + 1];
    return !!(a && b && (a.chapterId || null) === (b.chapterId || null));
  }
  function mergePageWithNext(pi) {
    var a = doc.pages[pi], b = doc.pages[pi + 1];
    if (!a || !b) return;
    if ((a.chapterId || null) !== (b.chapterId || null)) {
      window.alert("The next page is in a different chapter. Move it into this chapter first (drag in the outliner) to merge.");
      return;
    }
    pushHistory();
    a.blocks = (a.blocks || []).concat(b.blocks || []);
    eachCourseNav(function (nav) {
      (nav.sections || []).forEach(function (sec) {
        var at = (sec.pageIds || []).indexOf(b.id);
        if (at >= 0) sec.pageIds.splice(at, 1); // the merged-away page no longer exists
      });
    });
    doc.pages.splice(pi + 1, 1);
    if (currentPage > pi) currentPage = pi;
    mount();
    setActivePage(pi);
    focusFrame(pi);
    setSelection("page", pi);
  }
  // Item LL — split-page (slice) tool. Cut a long page in two at a top-level
  // block boundary: `block` and everything below it become a new page spliced in
  // right after. Model-only op; render/export untouched. Restricted to top-level
  // page blocks (getBlockPageIndexAndIndex only sees those) and never at index 0
  // (that would leave the first page empty). Section membership on every courseNav
  // block is synced so the new page inherits the same chapter as its parent.
  function eachCourseNav(fn) {
    var ch = doc.headerFooter || {};
    [ch.header, ch.footer].forEach(function (region) {
      if (region && region.children) walkPageBlocks(region.children, function (b) { if (b.type === "courseNav") fn(b); });
    });
    doc.pages.forEach(function (p) { walkPageBlocks(p.blocks, function (b) { if (b.type === "courseNav") fn(b); }); });
  }
  // #168: the ONE canonical learner nav is the FOOTER's courseNav — the only one an author
  // can create (the "+ Learner nav bar" button is footer-only + gated to none-present, and
  // courseNav is not in the block palette). The Settings modal 'Learner nav' tab used to grab
  // the FIRST courseNav `eachCourseNav` yielded (header -> footer -> pages), so a legacy/stray
  // header or page nav would win and drift from the footer nav the author selects on canvas.
  // Resolving both surfaces to THIS instance makes them a single source of truth. Null = the
  // footer has no nav yet.
  function footerCourseNav() {
    var f = doc.headerFooter && doc.headerFooter.footer;
    var found = null;
    if (f && f.children) walkPageBlocks(f.children, function (b) { if (b.type === "courseNav" && !found) found = b; });
    return found;
  }
  function canSplitAtBlock(block) {
    var loc = getBlockPageIndexAndIndex(block);
    return !!loc && loc.blockIndex > 0;
  }
  function splitPageAtBlock(block) {
    var loc = getBlockPageIndexAndIndex(block);
    if (!loc) { window.alert("Split works only on a top-level block (not inside a group or columns)."); return; }
    var pi = loc.pageIndex, idx = loc.blockIndex;
    if (idx <= 0) { window.alert("This is the first block on the page — nothing above it to keep. Pick a lower block."); return; }
    pushHistory();
    var P = doc.pages[pi];
    var tail = P.blocks.splice(idx); // blocks[idx..] move to the new page
    var newPage = {
      id: "page-" + Date.now(),
      // uio-E-C07 (EDIT-12): seed with the clean base; renumberSplitFamily rewrites the whole run
      // to "Base · K of M" below, so splits never accumulate " (cont.)".
      name: stripSplitSuffix(P.name || "Page"),
      blocks: tail
    };
    // inherit page-level props so the cont. page renders identically
    if (P.chapterId != null) newPage.chapterId = P.chapterId; // IIII: cont. page stays in parent's chapter (nav/progress correct)
    if (P.padX != null) newPage.padX = P.padX;
    if (P.padXTablet != null) newPage.padXTablet = P.padXTablet;
    if (P.padXMobile != null) newPage.padXMobile = P.padXMobile;
    if (P.padY != null) newPage.padY = P.padY;
    if (P.hideHeader) newPage.hideHeader = P.hideHeader;
    if (P.hideFooter) newPage.hideFooter = P.hideFooter;
    doc.pages.splice(pi + 1, 0, newPage);
    renumberSplitFamily(doc, P.id); // uio-E-C07: rename the run to "Base · K of M" (no accumulating "(cont.)")
    // sync section membership: wherever P.id sits, drop newPage.id right after it
    eachCourseNav(function (nav) {
      (nav.sections || []).forEach(function (sec) {
        var at = (sec.pageIds || []).indexOf(P.id);
        if (at >= 0 && sec.pageIds.indexOf(newPage.id) < 0) sec.pageIds.splice(at + 1, 0, newPage.id);
      });
    });
    currentPage = pi; // stay on the first half (linear next now reaches the cont.)
    mount();
    setActivePage(pi);
    setSelection("page", pi);
  }
  function moveBlock(block, dir) {
    var loc = getBlockPageIndexAndIndex(block);
    if (!loc) return;
    var pi = loc.pageIndex, idx = loc.blockIndex;
    var targetIdx = idx + dir;
    var p = doc.pages[pi];
    if (targetIdx >= 0 && targetIdx < p.blocks.length) {
      pushHistory(); // DDD: was undoable-gap — no caller pushed, so a move couldn't be undone (push only on a real move, not an at-edge no-op)
      var temp = p.blocks[idx];
      p.blocks[idx] = p.blocks[targetIdx];
      p.blocks[targetIdx] = temp;
      reapplyStructural(pi); // PERF: one page, not the world

      var newFrame = frameDescs[pi] && frameDescs[pi].frame;
      var newSection = newFrame && newFrame.querySelector(".page");
      var newNode = newSection ? newSection.children[targetIdx] : null;
      if (newNode) {
        var selType = selection.type;
        if (selType === "block") {
          setSelection("block", newNode);
        } else if (selType === "field") {
          var fieldNode = newNode.querySelector("[data-edit]") || newNode;
          setSelection("field", fieldNode);
        } else if (selType === "navButton") {
          setSelection("navButton", newNode);
        } else if (selType === "embed") {
          setSelection("embed", newNode);
        }
      }
    }
  }
  // The ONE canonical footer that every element inspector ends with: a Spacing
  // disclosure (space top / bottom) + a Block-actions icon row (move up, move
  // down, duplicate, hide, lock, delete). The markup is identical everywhere —
  // only the wired handlers vary, supplied via `opts` so a non-block element (a
  // component-grid card instance) maps the SAME actions onto its own model. Call
  // this as the LAST section of every render*Inspector.
  // Universal per-block appearance: fill, border (colour + weight), corner
  // radius, text colour — applied to the block's outer node. Persisted as
  // block.box (a dedicated namespace); render.js re-applies it (so demo + export
  // match). Live-applied to the canvas node so the panel never rebuilds.
  function renderAppearanceSection(block) {
    // #155: canonical taxonomy section (formerly an ad-hoc block-appearance disclosure). Buffered by
    // the beginSections()/endSections() wrapper in renderBlockActionsSection so it orders by PanelLayout.
    sectionGroup("Appearance", "Appearance", function (body) {
      block.box = block.box || {};
      var box = block.box;
      function nodeOf() { return canvasNodeForBlock(block); }
      // uio-F03: the live preview follows the RESOLVED value (this block's own, else the
      // course's captured type default, else the system default) — the same ladder the row
      // shows and the same one render.js applies, so Reset previews correctly too.
      function effBox(prop) { return resolveScoped(blockBoxChain(block), prop, { at: "block" }).value; }
      function setBorder() { var n = nodeOf(); if (n) n.style.border = effBox("border") ? ((effBox("borderWidth") || 1) + "px solid " + (box.borderColor || "var(--color-hair)")) : ""; }
      // Condensed (James 2026-07-08): colours stacked, the two dimensional fields (border weight
      // + corner radius) paired two-up with glyphs — matching the case/align/spacing language.
      colorFieldFlat("Fill", box.fill, function (v) { var n = nodeOf(); if (v == null) { delete box.fill; if (n) n.style.background = ""; } else { box.fill = v; if (n) n.style.background = v; } renderModelView(); }, body);
      colorFieldFlat("Text", box.textColor, function (v) { var n = nodeOf(); if (v == null) { delete box.textColor; if (n) n.style.color = ""; } else { box.textColor = v; if (n) n.style.color = v; } renderModelView(); }, body);
      // uio-F03: Stroke resolves down System -> Course type default -> Block, and the row
      // carries the shared inheritance tail (named scope, or dot + Reset when set here).
      var strokeRes = resolveScoped(blockBoxChain(block), "border", { at: "block" });
      switchRow("Stroke", function () { return !!strokeRes.value; },
        function (v) { box.border = v; setBorder(); renderModelView(); renderInspector(); }, body, false,
        { inherit: { res: strokeRes, format: onOffLabel, onReset: function () {
            pushHistory(); delete box.border; setBorder(); renderModelView(); renderInspector();
          } } });
      if (strokeRes.value) colorFieldFlat("Stroke colour", box.borderColor, function (v) { if (v == null) delete box.borderColor; else box.borderColor = v; setBorder(); renderModelView(); }, body);
      // Stroke width + corner radius: canonical iconFields, live-applied, paired two-up.
      var weightField = iconField(Icon("border-weight"), { value: box.borderWidth, unit: "px", placeholder: "1", step: 1, min: 0, max: 12, datalist: "dl-gap", title: "Stroke width",
        onchange: function (v) { pushHistory(); var n = parseFloat(v); if (isNaN(n)) delete box.borderWidth; else box.borderWidth = n; setBorder(); renderModelView(); } }).wrap;
      var radiusField = iconField(Icon("radius"), { value: box.radius, unit: "px", placeholder: "0", step: 1, min: 0, max: 80, datalist: "dl-gap", title: "Corner radius",
        onchange: function (v) { pushHistory(); var n = parseFloat(v); var nd = nodeOf(); if (isNaN(n)) { delete box.radius; if (nd) nd.style.borderRadius = ""; } else { box.radius = n; if (nd) nd.style.borderRadius = n + "px"; } renderModelView(); } }).wrap;
      var apRow = twoUp(weightField, radiusField); apRow.style.marginTop = "4px"; body.appendChild(apRow);

      // #127: capture this block's look as the THEME DEFAULT for its type. Every other
      // block of the same type with no own override then inherits it (render/export
      // cascade: theme.blockStyles[type] is the baseline, block.box wins). Saves the
      // EFFECTIVE appearance (what you see = type default merged with this block's box).
      var type = block.type;
      var bs = getBlockStyles();
      var hasTypeDef = bs && bs[type] && Object.keys(bs[type]).length;
      var tdBody = panelSection(body, "Theme default (" + type + ")");
      tdBody.appendChild(h("div", "insp-hint", hasTypeDef
        ? "Every " + type + " block inherits this captured look unless it sets its own. Capture again to update it."
        : "Capture this look as the default for every " + type + " block in the course."));
      var capRow = h("div", null); capRow.style.display = "flex"; capRow.style.gap = "6px"; capRow.style.marginTop = "2px";
      var capBtn = h("button", "prop-btn", "Capture look");
      capBtn.title = "Save this appearance as the theme default for " + type + " blocks";
      capBtn.addEventListener("click", function () {
        var eff = window.resolveBlockBox(bs && bs[type], block.box);
        if (!eff || !Object.keys(eff).length) { alert("Style this block (fill / border / radius / text colour) first, then capture its look."); return; }
        pushHistory();
        getBlockStyles()[type] = clone(eff);
        window.applyRenderContext({ blockStyles: getBlockStyles() });
        scheduleSave(); mount(); renderInspector();
      });
      capRow.appendChild(capBtn);
      if (hasTypeDef) {
        var clrBtn = h("button", "prop-btn prop-btn--danger", "Clear default");
        clrBtn.title = "Remove the captured " + type + " default (blocks fall back to their own styling)";
        clrBtn.addEventListener("click", function () {
          pushHistory();
          delete getBlockStyles()[type];
          window.applyRenderContext({ blockStyles: getBlockStyles() });
          scheduleSave(); mount(); renderInspector();
        });
        capRow.appendChild(clrBtn);
      }
      tdBody.appendChild(capRow);
    });
  }

  function renderBlockActionsSection(block, opts) {
    opts = opts || {};
    var spaceObj = opts.spaceObj || block;                 // object holding spaceTop/spaceBottom
    var onSpace  = opts.onSpace  || function () { reapplyBlock(block); }; // PERF: single-page rebuild, not the whole world
    var doMove   = opts.move      || function (dir) { moveBlock(block, dir); };
    var doDup    = opts.duplicate || function () { duplicateBlock(block); };
    var doDelete = opts.remove    || function () { deleteBlockByRef(block); };
    var isHidden = opts.isHidden  || function () { return !!block.hidden; };
    var doHide   = opts.toggleHidden || function () { pushHistory(); block.hidden = !block.hidden; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };
    var isLocked = opts.isLocked  || function () { return !!block.locked; };
    var doLock   = opts.toggleLock || function () { pushHistory(); block.locked = !block.locked; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };

    // Item D — universal per-element alignment. Available on EVERY block via the
    // canonical footer, using the canonical segmentedLive picker. Writes block.align
    // (start|center|end); render.js maps it to alignSelf (the cross-axis in any flex
    // parent -- headerFooter children region, columns, frame). Structural enough to rebuild
    // so nested contexts re-render correctly; segmented click carries no text focus.
    // #155: the universal Level-1 container sections (Layout / Spacing / Appearance) adopt the
    // canonical sectionGroup taxonomy, buffered here and emitted by endSections() in PanelLayout
    // order (Appearance < Layout < Spacing) with the shared collapse + Edit-layout drag behaviour.
    // #165: if the CALLER already opened a buffer (a single-level inspector emitting its own
    // Content/Appearance/Behaviour sections), add ours to THAT buffer and let the caller flush —
    // so the whole panel sorts as ONE PanelLayout stream (Behaviour lands after Layout/Spacing)
    // instead of two independently-sorted cycles. Standalone callers self-manage as before.
    var ownBuffer = !sectionsBufferOpen();
    if (ownBuffer) beginSections();
    sectionGroup("Layout", "Layout", function (body) {
      segmentedIconLive("Align", [[Icon("align-left"), "start", "Start"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "end", "End"]],
        function (v) { return (block.align || "start") === v; },
        function (v) {
          if (v === "start") delete block.align; else block.align = v;
          reapplyBlock(block); reselectBlockNode(block, getSelectionTypeForBlock(block)); // PERF: one page, not the world
        }, body);
      // Vertical align (Item D2): sits directly under the horizontal Align, same
      // segmented look + vertical glyphs. Writes block.valign (top|center|bottom);
      // render maps it to auto margins on the block's flex-column parent's main axis.
      segmentedIconLive("Vertical", [[Icon("align-start-horizontal"), "top", "Top"], [Icon("align-center-horizontal"), "center", "Middle"], [Icon("align-end-horizontal"), "bottom", "Bottom"]],
        function (v) { return (block.valign || "top") === v; },
        function (v) {
          if (v === "top") delete block.valign; else block.valign = v;
          reapplyBlock(block); reselectBlockNode(block, getSelectionTypeForBlock(block)); // PERF: one page, not the world
        }, body);
      body.appendChild(h("div", "insp-hint", "Aligns this element. Center / End also position a sized element (an HTML interaction or fit-width image) within the column; a full-width block is unaffected. Vertical align centres or bottom-anchors the block when its column is taller than its content (e.g. text beside a taller image)."));
    });

    sectionGroup("Spacing", "Spacing", function (body) {
      // Space top / Space bottom sit two-up (paired numerics).
      var spaceRow = twoUp(
        iconField(Icon("arrow-up-to-line"), { value: spaceObj.spaceTop == null ? "" : spaceObj.spaceTop, unit: "px", placeholder: "auto", step: 2, min: -200, max: 200, datalist: "dl-gap", noHistory: true, title: "Space top (negative pulls tighter / overlaps)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete spaceObj.spaceTop; else spaceObj.spaceTop = n; onSpace(); } }).wrap,
        iconField(Icon("arrow-down-to-line"), { value: spaceObj.spaceBottom == null ? "" : spaceObj.spaceBottom, unit: "px", placeholder: "auto", step: 2, min: -200, max: 200, datalist: "dl-gap", noHistory: true, title: "Space bottom (negative pulls tighter / overlaps)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete spaceObj.spaceBottom; else spaceObj.spaceBottom = n; onSpace(); } }).wrap
      );
      spaceRow.style.marginTop = "4px";
      body.appendChild(spaceRow);
    });

    // A block can own its appearance (e.g. cardReveal styles each CARD, not the
    // grid root) and pass { appearance:false } to suppress the grid-level panel.
    if (opts.appearance !== false) renderAppearanceSection(block);

    // #155/#165: flush only the buffer WE opened; a caller that opened its own flushes it itself.
    if (ownBuffer) endSections(inspector);

    // §64: the per-block "Chapter recap" toggle was RETIRED — the chapter summary now
    // lives in the native quiz's completion panel (the "Chapter summary" bulleted list
    // shown after the knowledge check is passed), not scattered across arbitrary blocks.

    // Block actions (move / duplicate / slice / visibility / lock / delete) now live
    // in the STATIC canvas toolbar (single source), not the panel — fed the SAME opts
    // so a card instance etc. still retargets correctly.
    showBlockToolbar(block, opts);
  }

  // ---- contextual block actions, merged into the persistent canvas overlay bar ------
  // The block actions (move / duplicate / split / hide / lock / delete) live as a
  // contextual SEGMENT of the #canvas-overlay tools bar (grid / find / comment / zoom),
  // appended when an element is selected and cleared on deselect — so they sit in ONE
  // bigger canvas toolbar alongside the tools, rather than a separate floating bar. The
  // bar itself is positioned by CSS (.canvas-overlay-bar), so there is nothing to place.
  var blockToolbarEl = null, blockToolbarSep = null;
  function ensureBlockToolbar() {
    if (blockToolbarEl) return blockToolbarEl;
    var inner = document.querySelector("#canvas-overlay .canvas-overlay-bar__inner");
    if (!inner) return null; // bar absent (zen / preview panels hidden)
    blockToolbarSep = h("span", "canvas-overlay-bar__sep canvas-overlay-bar__sep--actions");
    blockToolbarEl = h("div", "canvas-overlay-bar__actions");
    inner.appendChild(blockToolbarSep);
    inner.appendChild(blockToolbarEl);
    return blockToolbarEl;
  }
  function positionBlockToolbar() {} // the overlay bar is positioned by CSS; kept for callers
  function hideBlockToolbar() {
    if (blockToolbarEl) { blockToolbarEl.innerHTML = ""; blockToolbarEl.hidden = true; }
    if (blockToolbarSep) blockToolbarSep.hidden = true;
  }
  function showBlockToolbar(block, opts) {
    opts = opts || {};
    var bar = ensureBlockToolbar();
    if (!bar) return; // canvas overlay bar not present (panels hidden)
    bar.innerHTML = "";
    var doMove = opts.move || function (d) { moveBlock(block, d); };
    var doDup = opts.duplicate || function () { duplicateBlock(block); };
    var doDelete = opts.remove || function () { deleteBlockByRef(block); };
    var isHidden = opts.isHidden || function () { return !!block.hidden; };
    var doHide = opts.toggleHidden || function () { pushHistory(); block.hidden = !block.hidden; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };
    var isLocked = opts.isLocked || function () { return !!block.locked; };
    var doLock = opts.toggleLock || function () { pushHistory(); block.locked = !block.locked; reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, getSelectionTypeForBlock(block)); };

    var up = iconBtn("arrowUp", "Move up"); up.addEventListener("click", function () { doMove(-1); }); bar.appendChild(up);
    var down = iconBtn("arrowDown", "Move down"); down.addEventListener("click", function () { doMove(1); }); bar.appendChild(down);
    var dup = iconBtn("duplicate", "Duplicate"); dup.addEventListener("click", function () { doDup(); }); bar.appendChild(dup);
    // #174: clear content — reset this block's subtree to a blank skeleton (keeps structure).
    var clr = iconBtn("eraser", "Clear content (keep structure)"); clr.addEventListener("click", function () { clearBlockContentAction([block]); }); bar.appendChild(clr);
    if (canSplitAtBlock(block)) { var slice = iconBtn("slice", "Split page here"); slice.addEventListener("click", function () { splitPageAtBlock(block); }); bar.appendChild(slice); }
    bar.appendChild(h("div", "tb-sep"));
    var hide = iconBtn(isHidden() ? "eyeOff" : "eye", isHidden() ? "Show block" : "Hide block"); if (isHidden()) hide.classList.add("is-off"); hide.addEventListener("click", function () { doHide(); }); bar.appendChild(hide);
    var lock = iconBtn(isLocked() ? "lock" : "unlock", isLocked() ? "Unlock block" : "Lock block"); if (isLocked()) lock.classList.add("is-on"); lock.addEventListener("click", function () { doLock(); }); bar.appendChild(lock);
    bar.appendChild(h("div", "tb-sep"));
    var del = iconBtn("trash", "Delete block", true); del.addEventListener("click", function () { doDelete(); }); bar.appendChild(del);

    bar.hidden = false;
    if (blockToolbarSep) blockToolbarSep.hidden = false;
  }

  // Quiz inspector (hybrid): structure + question type + correct flags + settings
  // live here; kicker / title / prompt / option text / sentence / feedback /
  // completion copy are edited inline on the canvas. Structural changes
  // mount()+reselect (open question disclosures persist via openSections).
  function renderQuizInspector(node) {
    var block = node.__block;
    block.intro = block.intro || {}; block.settings = block.settings || {}; block.done = block.done || {}; block.done.retry = block.done.retry || {}; block.questions = block.questions || [];
    var s = block.settings;
    function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
    function label(parent, text) { parent.appendChild(h("div", "insp-row__label insp-row__label--stacked", text)); }

    var head = h("div", "prop-component"); head.appendChild(h("span", null, "Quiz")); inspector.appendChild(head);
    inspector.appendChild(h("div", "insp-hint", "Kicker, title, question text, options and feedback are all edited on the canvas. Play the real interaction in demo mode."));

    // #160: canonical taxonomy — Content (questions), Appearance (colours), Behaviour
    // (intro / shuffle / celebrate / retry, merged). Buffered + emitted in PanelLayout order.
    beginSections();

    // Behaviour — intro page, question/answer shuffle, celebrate-on-pass, retry (all merged
    // from the former Intro page / Settings / Completion sub-headers into one Behaviour section).
    sectionGroup("Behaviour", "Behaviour", function (secBody) {
      switchRow("Show intro", function () { return !!block.intro.on; }, function (v) { block.intro.on = v; refresh(); }, secBody);
      switchRow("Shuffle questions", function () { return !!s.shuffleQuestions; }, function (v) { s.shuffleQuestions = v; refresh(); }, secBody);
      switchRow("Shuffle answers", function () { return !!s.shuffleOptions; }, function (v) { s.shuffleOptions = v; refresh(); }, secBody);
      switchRow("Celebrate on pass (confetti)", function () { return !!s.confetti; }, function (v) { s.confetti = v; refresh(); }, secBody);
      switchRow("Show retry button", function () { return !!block.done.retry.on; }, function (v) { block.done.retry.on = v; refresh(); }, secBody);
      secBody.appendChild(h("div", "insp-hint", "Completion title and body are edited on the canvas."));
    });

    // Appearance — per-quiz colour overrides (theme CSS vars on THIS quiz's root only).
    // Applied live to the canvas node (no rebuild, so selection is kept); persisted as
    // block.colors, which render.js re-applies (so demo + export match).
    sectionGroup("Appearance", "Colours", function (body) {
      body.appendChild(h("div", "insp-hint", "Restyle just this quiz. Leave a swatch blank to inherit the course theme."));
      block.colors = block.colors || {};
      var MAP = window.QUIZ_COLOR_VARS || {};
      [["Accent", "accent"], ["Panel", "panel"], ["Options / cards", "option"], ["Text", "text"], ["Borders", "border"], ["Incorrect (error)", "error"]].forEach(function (c) {
        var key = c[1], cssVar = MAP[key];
        colorFieldFlat(c[0], block.colors[key], function (v) {
          if (v == null) { delete block.colors[key]; if (cssVar) node.style.removeProperty(cssVar); }
          else { block.colors[key] = v; if (cssVar) node.style.setProperty(cssVar, v); }
          renderModelView();
        }, body);
      });
    });

    // Content — the questions (the quiz payload) + add-question. Per-question editors stay
    // as collapsible disclosures INSIDE this Content section (panel-ia §3 allows that).
    sectionGroup("Content", "Questions", function (secBody) {
    var _qins = inspector; inspector = secBody;
    try {
    block.questions.forEach(function (q, qi) {
      var type = q.type || "multipleChoice";
      var typeLabel = type === "fillBlank" ? "Fill the blank" : "Multiple choice";
      inspector.appendChild(disclosure("quiz-q-" + (q.id || qi), "Q" + (qi + 1) + " · " + typeLabel, function (body) {
        label(body, "Question type");
        var trow = h("div", "prop-toggle-row");
        [["choice", "multipleChoice"], ["fill blank", "fillBlank"], ["sort", "cardSort"]].forEach(function (o) {
          var b = h("button", "prop-toggle" + (type === o[1] ? " is-on" : ""), o[0]);
          b.addEventListener("click", function () {
            if (type === o[1]) return;
            pushHistory(); q.type = o[1];
            if (o[1] === "cardSort") {
              if (!q.categories) q.categories = [{ id: "c1", label: "Group A" }, { id: "c2", label: "Group B" }];
              if (!q.cards) q.cards = [{ text: "Item one", categoryId: "c1" }, { text: "Item two", categoryId: "c2" }];
              if (!q.methodLabel || /select|complete/i.test(q.methodLabel)) q.methodLabel = "Sort each item into the correct group";
            } else if (o[1] === "fillBlank") {
              if (q.stemBefore == null) q.stemBefore = "The answer is"; if (q.stemAfter == null) q.stemAfter = "";
              if (!q.methodLabel || /select|sort/i.test(q.methodLabel)) q.methodLabel = "Complete the sentence";
              q.options = q.options || [{ text: "Correct answer", correct: true }, { text: "Wrong answer", correct: false }];
            } else {
              if (q.prompt == null) q.prompt = "Type your question here?";
              if (!q.methodLabel || /complete|sort/i.test(q.methodLabel)) q.methodLabel = "Select the answer";
              q.options = q.options || [{ text: "Correct answer", correct: true }, { text: "Wrong answer", correct: false }];
            }
            refresh();
          });
          trow.appendChild(b);
        });
        body.appendChild(trow);

        if (type === "cardSort") {
          label(body, "Groups");
          (q.categories || []).forEach(function (cat, ci) {
            var row = h("div", "insp-row");
            row.appendChild(h("span", "insp-row__label", (cat.label || "(group)").slice(0, 18)));
            var del = h("button", "prop-btn prop-btn--danger", "×"); del.style.flex = "0 0 auto";
            del.addEventListener("click", function () { pushHistory(); q.categories.splice(ci, 1); refresh(); });
            row.appendChild(del); body.appendChild(row);
          });
          var addCat = h("button", "prop-btn", "+ Add group");
          addCat.addEventListener("click", function () { pushHistory(); q.categories = q.categories || []; q.categories.push({ id: "c" + Date.now(), label: "New group" }); refresh(); });
          body.appendChild(addCat);

          label(body, "Cards (assign each to its group)");
          (q.cards || []).forEach(function (card, ci) {
            var row = h("div", "insp-row");
            row.appendChild(h("span", "insp-row__label", (card.text || "(card)").slice(0, 12)));
            var sel = dsSelect((q.categories || []).map(function (cat) { return [cat.label, cat.id]; }), card.categoryId, function (v) { pushHistory(); card.categoryId = v; refresh(); });
            sel.style.flex = "1 1 auto";
            row.appendChild(sel);
            var del = h("button", "prop-btn prop-btn--danger", "×"); del.style.flex = "0 0 auto";
            del.addEventListener("click", function () { pushHistory(); q.cards.splice(ci, 1); refresh(); });
            row.appendChild(del); body.appendChild(row);
          });
          var addCard = h("button", "prop-btn", "+ Add card");
          addCard.addEventListener("click", function () { pushHistory(); q.cards = q.cards || []; var first = (q.categories && q.categories[0] && q.categories[0].id) || ""; q.cards.push({ text: "New card", categoryId: first }); refresh(); });
          body.appendChild(addCard);
          body.appendChild(h("div", "insp-hint", "Group names and card text are edited on the canvas; assign each card to its correct group here."));
        } else {
          label(body, "Options (tick the correct one)");
          (q.options || []).forEach(function (opt, oi) {
            var row = h("div", "insp-row");
            var ck = h("button", "prop-toggle" + (opt.correct ? " is-on" : ""), opt.correct ? "✓" : "○"); ck.title = "Mark correct"; ck.style.flex = "0 0 auto";
            ck.addEventListener("click", function () { pushHistory(); (q.options || []).forEach(function (o) { o.correct = false; }); opt.correct = true; refresh(); });
            row.appendChild(ck);
            row.appendChild(h("span", "insp-row__label", (opt.text || "(option)").slice(0, 18)));
            var del = h("button", "prop-btn prop-btn--danger", "×"); del.title = "Delete option"; del.style.flex = "0 0 auto";
            del.addEventListener("click", function () { pushHistory(); q.options.splice(oi, 1); refresh(); });
            row.appendChild(del);
            body.appendChild(row);
          });
          var addOpt = h("button", "prop-btn", "+ Add option");
          addOpt.addEventListener("click", function () { pushHistory(); q.options = q.options || []; q.options.push({ text: "New option", correct: false }); refresh(); });
          body.appendChild(addOpt);
          body.appendChild(h("div", "insp-hint", type === "fillBlank" ? "Sentence (before/after the blank), chip text and feedback are edited on the canvas." : "Prompt, option text and feedback are edited on the canvas."));
        }

        var actions = h("div", "icon-row");
        var up = iconBtn("arrowUp", "Move up"); up.addEventListener("click", function () { if (qi > 0) { pushHistory(); var t = block.questions[qi - 1]; block.questions[qi - 1] = q; block.questions[qi] = t; refresh(); } });
        var down = iconBtn("arrowDown", "Move down"); down.addEventListener("click", function () { if (qi < block.questions.length - 1) { pushHistory(); var t = block.questions[qi + 1]; block.questions[qi + 1] = q; block.questions[qi] = t; refresh(); } });
        var dup = iconBtn("duplicate", "Duplicate"); dup.addEventListener("click", function () { pushHistory(); var c = clone(q); c.id = "q" + Date.now(); block.questions.splice(qi + 1, 0, c); refresh(); });
        var del = iconBtn("trash", "Delete", true); del.addEventListener("click", function () { pushHistory(); block.questions.splice(qi, 1); refresh(); });
        actions.appendChild(up); actions.appendChild(down); actions.appendChild(dup); actions.appendChild(del);
        body.appendChild(actions);
      }));
    });
    var addQ = h("button", "prop-btn prop-btn--accent", "+ Add question");
    addQ.addEventListener("click", function () { pushHistory(); block.questions.push({ id: "q" + Date.now(), type: "multipleChoice", methodLabel: "Select the answer", prompt: "New question?", options: [{ text: "Correct answer", correct: true }, { text: "Wrong answer", correct: false }], feedbackCorrect: "<strong>Correct.</strong>", feedbackIncorrect: "Not quite." }); refresh(); });
    inspector.appendChild(addQ);
    } finally { inspector = _qins; }
    });

    endSections(inspector);
    // footer omitted (spacing + actions at Block level; Behaviour/Completion merged above)
  }

  // Accordion / Tabs inspector: display mode + (accordion-only) open-mode + a
  // section list (title edit / add a block to a section / delete section / add
  // section). Section CONTENT is ordinary child blocks edited on the canvas.
  // Shared surface-texture controls for cardReveal + accordion/tabs: pick the pattern
  // (grid / dots / none) and its colour. Pure data on the block (block.pattern +
  // block.patternColor) -> render stamps data-pattern + --tex-color; ships in SCORM.
  function patternControls(block, refresh, target) {
    var host = panelSection(target || inspector, "Texture");
    segmentedLive("Pattern", [["Grid", "grid"], ["Dots", "dots"], ["None", "none"]],
      function (v) { return (block.pattern || "grid") === v; },
      function (v) { if (v === "grid") delete block.pattern; else block.pattern = v; refresh(); }, host);
    colorFieldFlat("Pattern colour", block.patternColor,
      function (v) { if (v == null) delete block.patternColor; else block.patternColor = v; refresh(); }, host);
  }

  function renderAccordionInspector(node) {
    var block = node.__block;
    block.items = block.items || [];
    function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
    // head omitted (two-level breadcrumb carries identity)
    inspector.appendChild(h("div", "insp-hint", "Section titles and content are edited on the canvas. Play it in demo mode to expand/collapse."));

    // #161: canonical taxonomy — Behaviour (display mode), Appearance (texture + fill),
    // Content (sections). Buffered + emitted in PanelLayout order by endSections.
    beginSections();

    // Behaviour — display style + open behaviour.
    sectionGroup("Behaviour", "Display", function (secBody) {
      segmentedLive("Style", [["Accordion", "accordion"], ["Tabs", "tabs"]],
        function (v) { return (block.mode === "tabs" ? "tabs" : "accordion") === v; },
        function (v) { block.mode = v; refresh(); }, secBody);
      if (block.mode !== "tabs") {
        segmentedLive("Open sections", [["One at a time", "single"], ["Multiple", "multi"]],
          function (v) { return (block.multi ? "multi" : "single") === v; },
          function (v) { block.multi = (v === "multi"); refresh(); }, secBody);
      }
    });

    // Appearance — surface texture (shared patternControls) + per-mode panel fill.
    sectionGroup("Appearance", "Appearance", function (secBody) {
      patternControls(block, refresh, secBody);
      // Fill (per mode, so it still switches light/dark) — mirrors card-reveal "Card
      // appearance". Stored on block.cardBox.fillDark/fillLight; render.js emits the
      // --acc-fill-* vars the course.css layer already reads. Blank = theme default.
      secBody.appendChild(disclosure("accordion-fill", "Fill", function (body) {
        body.appendChild(h("div", "insp-hint", "Panel fill per mode, so it still switches light/dark. Blank = the default (dark #2a2a2a / light #fff)."));
        block.cardBox = block.cardBox || {};
        var cb = block.cardBox;
        colourControl("Fill (dark)", cb.fillDark, function (v) { if (v == null) delete cb.fillDark; else cb.fillDark = v; refresh(); }, body);
        colourControl("Fill (light)", cb.fillLight, function (v) { if (v == null) delete cb.fillLight; else cb.fillLight = v; refresh(); }, body);
      }));
    });

    // Content — the section list (payload). Add affordance = canonical accent button.
    sectionGroup("Content", "Sections", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {
        var addSec = h("button", "prop-btn prop-btn--accent", "+ Add section");
        addSec.addEventListener("click", function () {
          pushHistory();
          block.items.push({ title: "New section", children: [{ type: "paragraph", text: "Section content." }] });
          refresh();
        });
        inspector.appendChild(addSec);
        block.items.forEach(function (item, i) {
          fieldRow("Section " + (i + 1), item.title, function (v) { item.title = v; refresh(); }, "Section title");
          var row = h("div", "insp-row");
          var addB = h("button", "prop-toggle", "+ block"); addB.type = "button"; addB.title = "Add a text block to this section";
          addB.addEventListener("click", function () { pushHistory(); item.children = item.children || []; item.children.push({ type: "paragraph", text: "Section content." }); refresh(); });
          var delB = h("button", "prop-toggle", "Delete"); delB.type = "button"; delB.title = "Delete this section";
          delB.addEventListener("click", function () { pushHistory(); block.items.splice(i, 1); refresh(); });
          row.appendChild(addB); row.appendChild(delB);
          inspector.appendChild(row);
        });
      } finally { inspector = _ins; }
    });

    endSections(inspector);
    // footer omitted (spacing + actions at Block level)
  }

  // FLAGSHIP Sequence inspector (slice 2) — clones the accordion Steps pattern. Spine +
  // Orientation segmented toggles (Reveal lands in slice 3); a Steps section with per-step
  // title (+ free-text date in Dated spine), reorder, delete and a "+ block" escape-hatch.
  // Step BODY content is ordinary nested blocks edited on the canvas (items[].children).
  function renderSequenceInspector(node) {
    var block = node.__block;
    block.items = block.items || [];
    var spine = block.spine === "dated" || block.spine === "plain" ? block.spine : "numbered";
    function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
    // (no block-label head — the two-level breadcrumb carries the block identity)
    inspector.appendChild(h("div", "insp-hint", "Step titles and content are edited on the canvas. Reveal behaviour plays in demo mode."));

    // #37: canonical taxonomy (mirrors accordion / cardReveal) — Behaviour (spine +
    // orientation + reveal), Appearance (surface texture), Content (steps). Buffered +
    // emitted in PanelLayout order by endSections; the old flat Spine sub-header is
    // gone (the Behaviour sectionGroup title carries it). Inner code uses the inspector
    // swap idiom so every control/hint keeps its default-target wiring unchanged.
    beginSections();

    // Behaviour — marker spine + orientation + reveal interaction.
    sectionGroup("Behaviour", "Behaviour", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {
    segmentedLive("Marker", [["Numbered", "numbered"], ["Dated", "dated"], ["Plain", "plain"]],
      function (v) { return spine === v; },
      function (v) { block.spine = v; refresh(); });
    inspector.appendChild(h("div", "insp-hint", spine === "dated" ? "Dated: each step's marker is your own free text (“2019”, “Phase 1”, “0600Z”); empty falls back to the number." : spine === "plain" ? "Plain: a simple node dot — the title and body carry the step." : "Numbered: markers count 1, 2, 3… automatically as you add or reorder steps."));
    segmentedLive("Orientation", [["Vertical", "vertical"], ["Horizontal", "horizontal"]],
      function (v) { return (block.orient === "horizontal" ? "horizontal" : "vertical") === v; },
      function (v) { block.orient = v; refresh(); });
    var reveal = block.reveal === "click" || block.reveal === "static" ? block.reveal : "scroll";
    segmentedLive("Reveal", [["Scroll", "scroll"], ["Click", "click"], ["Static", "static"]],
      function (v) { return reveal === v; },
      function (v) { block.reveal = v; refresh(); });
    inspector.appendChild(h("div", "insp-hint", reveal === "click" ? "Click: learners step through with ‹ › arrows (one at a time, cumulative)." : reveal === "static" ? "Static: every step shown at once, no animation." : "Scroll: steps reveal as they enter view and the spine fills. Reduced-motion falls back to static."));
      } finally { inspector = _ins; }
    });

    // Appearance — shared surface texture (grid / dots / none).
    sectionGroup("Appearance", "Appearance", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try { patternControls(block, refresh); } finally { inspector = _ins; }
    });

    // Content — the steps list (payload).
    sectionGroup("Content", "Steps", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {

    // SPEC-ui-kit ticket 6: steps are the canonical repeated-item list — one row per
    // step (grip · full-width title · trash, "+" above), replacing the old 3-5 rows
    // per step. Per-step secondaries (date on the dated spine, marker icon, +block
    // escape hatch) ride the row as compact icons (rowExtras) — James's icon density.
    repeatedList(inspector, "Steps", {
      items: function () { return block.items; },
      value: function (it) { return it.title; },
      setValue: function (it, v) { it.title = v; refresh(); },
      add: function () { block.items.push({ title: "New step", children: [{ type: "paragraph", text: "Describe this step." }] }); refresh(); },
      remove: function (i) { block.items.splice(i, 1); refresh(); },
      move: function (from, to) { var m = block.items.splice(from, 1)[0]; block.items.splice(to, 0, m); refresh(); },
      placeholder: "Step title", addLabel: "Add step", removeTitle: "Delete step",
      rowExtras: function (item) {
        var nodes = [];
        if (spine === "dated") {
          var dateIn = h("input", "rep-row__extra-field"); dateIn.type = "text"; dateIn.value = item.date || ""; dateIn.placeholder = "date"; dateIn.title = "Marker text (e.g. 2019, Phase 1); empty falls back to the number";
          dateIn.addEventListener("change", function () { pushHistory(); if (dateIn.value === "") delete item.date; else item.date = dateIn.value; refresh(); });
          nodes.push(dateIn);
        }
        var iconB = iconBtn("image", item.icon ? "Replace this step's marker icon" : "Upload an icon to replace this step's marker");
        iconB.addEventListener("click", function () {
          var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/svg+xml,image/*";
          inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { pushHistory(); item.icon = assetRef(rd.result, f); refresh(); }; rd.readAsDataURL(f); });
          inp.click();
        });
        nodes.push(iconB);
        if (item.icon) { var rm = iconBtn("minus", "Remove the step icon (back to the marker)"); rm.addEventListener("click", function () { pushHistory(); delete item.icon; refresh(); }); nodes.push(rm); }
        var addBlk = iconBtn("plus", "Add a text block to this step");
        addBlk.addEventListener("click", function () { pushHistory(); item.children = item.children || []; item.children.push({ type: "paragraph", text: "Step content." }); refresh(); });
        nodes.push(addBlk);
        return nodes;
      }
    });
      } finally { inspector = _ins; }
    });

    endSections(inspector);
    // (no renderBlockActionsSection here — spacing + block actions live at Block level
    // via renderContainerChrome, per the two-level split.)
  }

  // Card Deck inspector — a paged carousel. Cards are the canonical repeated-item list
  // (grip · optional section-label field · trash, "+" above); a "+block" row-extra seeds
  // the FIRST block into an empty card (on-canvas drop needs an existing sibling). Card
  // BODY content is ordinary nested blocks edited on the canvas (items[].children).
  // Appearance = shared patternControls + per-mode Fill, mirroring card-reveal/accordion.
  function renderCardDeckInspector(node) {
    var block = node.__block;
    block.items = block.items || [];
    function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
    inspector.appendChild(h("div", "insp-hint", "Card content is edited on the canvas — drop any blocks into a card. Learners page through the deck with the ‹ › arrows in demo mode. Card numbers are automatic."));

    patternControls(block, refresh);

    // Fill (per mode, so it still switches light/dark) — mirrors card-reveal / accordion.
    inspector.appendChild(disclosure("carddeck-fill", "Fill", function (body) {
      body.appendChild(h("div", "insp-hint", "Card fill per mode, so it still switches light/dark. Blank = the default (dark #1c1c1c / light #fff)."));
      block.cardBox = block.cardBox || {};
      var cb = block.cardBox;
      colourControl("Fill (dark)", cb.fillDark, function (v) { if (v == null) delete cb.fillDark; else cb.fillDark = v; refresh(); }, body);
      colourControl("Fill (light)", cb.fillLight, function (v) { if (v == null) delete cb.fillLight; else cb.fillLight = v; refresh(); }, body);
    }));

    repeatedList(inspector, "Cards", {
      items: function () { return block.items; },
      value: function (it) { return it.label; },
      setValue: function (it, v) { if (v === "") delete it.label; else it.label = v; refresh(); },
      add: function () { block.items.push({ label: "", children: [{ type: "paragraph", text: "Card content." }] }); refresh(); },
      remove: function (i) { block.items.splice(i, 1); refresh(); },
      move: function (from, to) { var m = block.items.splice(from, 1)[0]; block.items.splice(to, 0, m); refresh(); },
      placeholder: "Section label (optional)", addLabel: "Add card", removeTitle: "Delete card",
      rowExtras: function (item) {
        var addBlk = iconBtn("plus", "Add a text block to this card");
        addBlk.addEventListener("click", function () { pushHistory(); item.children = item.children || []; item.children.push({ type: "paragraph", text: "Card content." }); refresh(); });
        return [addBlk];
      }
    });
  }

  // TTTT: Card Reveal inspector — grid columns/gap, cover on/off + hint, add/delete
  // cards. Card CONTENT is ordinary nested blocks edited on the canvas.
  // Flip cards author BOTH faces: every card needs a Side-1 (front) block list.
  // Seeded from the legacy hint label so switching modes never loses the old
  // front-face look; idempotent (an existing front is left alone).
  function ensureFlipFronts(block) {
    (block.items || []).forEach(function (it) { if (it && !Array.isArray(it.front)) it.front = [{ type: "heading", text: block.hint || "Flip" }]; });
  }
  function renderCardRevealInspector(node) {
    var block = node.__block;
    block.items = block.items || [];
    function refresh() { reapplyStructural(findPageOfBlock(block)); reselectBlockNode(block, "block"); }
    // head omitted (two-level breadcrumb carries identity)
    inspector.appendChild(h("div", "insp-hint", "Card content (headings, text, images) is edited on the canvas."));
    // Reveal style: one interaction mode per block (mutually exclusive). Function-scope so
    // the Content section's card-add can seed a flip front.
    var rs = block.revealStyle === "flip" ? "flip" : block.revealStyle === "off" ? "off" : "reveal";
    // #161: canonical taxonomy — Behaviour (reveal + number), Layout (grid), Appearance
    // (texture + card skin), Content (cards). Emitted in PanelLayout order by endSections.
    beginSections();

    // Behaviour — the reveal interaction + card numbering.
    sectionGroup("Behaviour", "Reveal", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {
      segmentedLive("Reveal style", [["Reveal", "reveal"], ["Flip", "flip"], ["Off", "off"]],
        function (v) { return rs === v; },
        function (v) { if (v === "reveal") delete block.revealStyle; else block.revealStyle = v; if (v === "flip") ensureFlipFronts(block); refresh(); }, inspector);
      inspector.appendChild(h("div", "insp-hint", rs === "flip" ? "Flip: click a card to turn it over in 3D. Both faces hold their own blocks — use a card's flip button on the canvas to edit its other side." : rs === "off" ? "Off: static cards, no interaction (content always shown)." : "Reveal: hold/hover/tap clears a frosted cover to reveal the content."));
      if (rs === "reveal") {
        switchRow("Cover", function () { return !block.noCover; }, function (v) { block.noCover = !v; refresh(); });
        if (!block.noCover) {
          fieldRow("Cover hint", block.hint, function (v) { block.hint = v; refresh(); }, "Hold to reveal");
          // Frosted-glass cover: colour + opacity + blur. The fill is translucent so the
          // backdrop-blur reads (a solid fill defeats it). Clear the swatch -> theme default.
          inspector.appendChild(h("div", "insp-hint", "The cover is frosted glass — a translucent tint over a blur. Clear the colour to track the theme."));
          colorFieldFlat("Cover colour", block.coverColor, function (v) { if (v == null) delete block.coverColor; else block.coverColor = v; refresh(); });
          inspector.appendChild(twoUp(
            iconField(Icon("contrast"), { value: block.coverOpacity, unit: "%", placeholder: "48", step: 2, min: 0, max: 100, datalist: "dl-gap", title: "Cover opacity",
              onchange: function (v) { pushHistory(); var n = parseInt(v, 10); if (isNaN(n)) delete block.coverOpacity; else block.coverOpacity = n; refresh(); } }).wrap,
            iconField(Icon("blur"), { value: block.coverBlur, unit: "px", placeholder: "16", step: 1, min: 0, max: 40, datalist: "dl-gap", title: "Cover blur",
              onchange: function (v) { pushHistory(); var n = parseInt(v, 10); if (isNaN(n)) delete block.coverBlur; else block.coverBlur = n; refresh(); } }).wrap));
        }
      }
      switchRow("Number", function () { return !block.noIndex; }, function (v) { block.noIndex = !v; refresh(); });
      } finally { inspector = _ins; }
    });

    // Layout — grid columns / gap / card height.
    sectionGroup("Layout", "Grid", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {
      inspector.appendChild(twoUp(
        iconField("W", { value: block.cols, unit: "", placeholder: "3", step: 1, min: 1, max: 6, title: "Columns",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.cols; else block.cols = n; refresh(); } }).wrap,
        iconField(Icon("padding"), { value: block.gap, unit: "px", placeholder: "16", step: 2, min: 0, max: 60, datalist: "dl-gap", title: "Gap between cards",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.gap; else block.gap = n; refresh(); } }).wrap));
      inspector.appendChild(iconField("H", { value: block.cardH, unit: "px", placeholder: "320", step: 10, min: 80, max: 900, datalist: "dl-gap", title: "Card height",
        onchange: function (v) { pushHistory(); var n = parseInt(v, 10); if (isNaN(n)) delete block.cardH; else block.cardH = n; refresh(); } }).wrap);
      } finally { inspector = _ins; }
    });

    // Appearance — surface texture (shared patternControls) + per-card skin.
    sectionGroup("Appearance", "Appearance", function (secBody) {
      patternControls(block, refresh, secBody);
      // Card appearance (fill / border / corners) applied UNIFORMLY to every card via
      // block.cardBox -> render's shared applyBlockAppearance. Grill 2026-07-06: card
      // level, not the grid root; leave blank to keep the reference gradient look.
      secBody.appendChild(disclosure("cardreveal-appearance", "Card appearance", function (body) {
        body.appendChild(h("div", "insp-hint", "Fill (per mode, so it still switches light/dark), border and corners for every card. Blank = the default (dark #2a2a2a / light #fff)."));
        block.cardBox = block.cardBox || {};
        var cb = block.cardBox;
        colourControl("Fill (dark)", cb.fillDark, function (v) { if (v == null) delete cb.fillDark; else cb.fillDark = v; refresh(); }, body);
        colourControl("Fill (light)", cb.fillLight, function (v) { if (v == null) delete cb.fillLight; else cb.fillLight = v; refresh(); }, body);
        switchRow("Stroke", function () { return !!cb.border; }, function (v) { cb.border = v; refresh(); }, body);
        colorFieldFlat("Stroke colour", cb.borderColor, function (v) { if (v == null) delete cb.borderColor; else cb.borderColor = v; refresh(); }, body);
        // §10 design-consistency: canonical iconField (was a hand-rolled insp-row input).
        body.appendChild(iconField(Icon("radius"), { value: cb.radius, unit: "px", placeholder: "0", step: 1, min: 0, max: 80, datalist: "dl-gap", title: "Corner radius",
          onchange: function (v) { pushHistory(); var n = parseFloat(v); if (isNaN(n)) delete cb.radius; else cb.radius = n; refresh(); } }).wrap);
      }));
    });

    // Content — the card list. Add affordance = canonical accent button.
    sectionGroup("Content", "Cards", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {
      var addCard = h("button", "prop-btn prop-btn--accent", "+ Add card");
      addCard.addEventListener("click", function () {
        pushHistory();
        var fresh = { children: [{ type: "heading", text: "Card " + (block.items.length + 1) }, { type: "paragraph", text: "Hidden detail." }] };
        if (rs === "flip") fresh.front = [{ type: "heading", text: block.hint || "Flip" }];
        block.items.push(fresh);
        refresh();
      });
      inspector.appendChild(addCard);
      block.items.forEach(function (item, i) {
        var row = h("div", "insp-row");
        row.appendChild(h("span", "insp-row__label", "Card " + (i + 1)));
        // Add-block escape hatch per face (mirrors the accordion "+ block"): keeps an
        // emptied face reachable — canvas drag/drop needs at least one block to target.
        if (rs === "flip") {
          var addF = h("button", "prop-toggle", "+ front"); addF.type = "button"; addF.title = "Add a text block to this card's front (Side 1)";
          addF.addEventListener("click", function () { pushHistory(); item.front = Array.isArray(item.front) ? item.front : []; item.front.push({ type: "paragraph", text: "Front content." }); refresh(); });
          var addBk = h("button", "prop-toggle", "+ back"); addBk.type = "button"; addBk.title = "Add a text block to this card's back (Side 2)";
          addBk.addEventListener("click", function () { pushHistory(); item.children = item.children || []; item.children.push({ type: "paragraph", text: "Back content." }); refresh(); });
          row.appendChild(addF); row.appendChild(addBk);
        } else {
          var addB = h("button", "prop-toggle", "+ block"); addB.type = "button"; addB.title = "Add a text block to this card";
          addB.addEventListener("click", function () { pushHistory(); item.children = item.children || []; item.children.push({ type: "paragraph", text: "Card content." }); refresh(); });
          row.appendChild(addB);
        }
        var delB = h("button", "prop-toggle", "Delete"); delB.type = "button"; delB.title = "Delete this card";
        delB.addEventListener("click", function () { pushHistory(); block.items.splice(i, 1); refresh(); });
        row.appendChild(delB); inspector.appendChild(row);
      });
      } finally { inspector = _ins; }
    });

    endSections(inspector);
    // footer omitted (spacing + actions at Block level; cardReveal appearance stays in Content)
  }

  // Contextual sidebar (James 2026-07-08): selecting the footer nav bar (the "nav pill") on the
  // canvas surfaces ITS settings inline — the same Learner-nav controls the ⚙ Settings dialog
  // holds — so you edit the thing you just clicked instead of hunting through the modal. The
  // surrounding footer furniture (padding, logo, disclaimer) still lives in ⚙ → a pointer links
  // there. Mirrors the pattern for page/block selections: the sidebar shows the relevant slice.
  function renderCourseNavInspector(node) {
    var block = node.__block;
    var head = h("div", "prop-component"); head.appendChild(h("span", null, "Learner nav")); inspector.appendChild(head);
    courseNavControls(block, inspector);
    var toFooter = h("button", "insp-hint insp-backlink", "Footer padding, logo & disclaimer → ⚙ Header & Footer");
    toFooter.type = "button";
    toFooter.addEventListener("click", function () { openSettingsModal("project"); if (settingsModal) { settingsModal.sectionKey.project = "footer"; renderSettingsBody(); } });
    inspector.appendChild(toFooter);
  }

  function renderBlockInspector(node) {
    var block = node.__block;
    if (block.type === "quiz") { renderBlockTwoLevel(node, "Quiz", CONTENT_PURE_DECL, renderQuizInspector); return; } // SPEC-ui-kit ticket 8: two-level (#160: depth-pure content)
    if (block.type === "accordion") { renderBlockTwoLevel(node, "Accordion", CONTENT_PURE_DECL, renderAccordionInspector); return; } // SPEC-ui-kit ticket 8: two-level (#161: depth-pure content)
    if (block.type === "cardReveal") { renderBlockTwoLevel(node, "Card reveal", CONTENT_PURE_DECL, renderCardRevealInspector); return; } // SPEC-ui-kit ticket 8: two-level (#161: depth-pure content)
    if (block.type === "cardDeck") { renderBlockTwoLevel(node, "Card deck", CONTENT_DECL, renderCardDeckInspector); return; } // paged carousel of full-frame cards
    if (block.type === "sequence") { renderBlockTwoLevel(node, "Sequence", CONTENT_DECL, renderSequenceInspector); return; } // SPEC-ui-kit ticket 6: two-level
    if (block.type === "courseNav") { renderCourseNavInspector(node); return; }
    if (block.type === "hotspot") { renderBlockTwoLevel(node, "Image hotspots", CONTENT_PURE_DECL, function (n) { renderHotspotInspector(n.__block); }); return; } // SPEC-ui-kit ticket 5: two-level (#160: depth-pure content)
    if (block.type === "frame" || block.type === "group") { renderFrameOrGroupTwoLevel(node); return; } // SPEC-ui-kit ticket 8: two-level (container chrome + children)
    if (block.type === "image") { renderBlockTwoLevel(node, "Image", IMAGE_PURE_DECL, function (n) { renderImageContent(n.__block); }, imageChromeIo(block), blockChromeHandlers(block)); return; } // SPEC-ui-kit ticket 7: two-level (#88 stroke; #160: depth-pure content)
    if (block.type === "heading" || block.type === "paragraph" || block.type === "note") { renderBlockTwoLevel(node, block.type.charAt(0).toUpperCase() + block.type.slice(1), CONTENT_DECL, renderTextContent); return; } // SPEC-ui-kit ticket 7: two-level
    if (block.type === "spacer") { renderContentlessBlock(node, "Spacer", renderSpacerBody); return; } // SPEC-ui-kit ticket 7: content-less
    if (block.type === "divider") { renderContentlessBlock(node, "Divider", function () { inspector.appendChild(h("div", "insp-hint", "A horizontal rule — styling follows the course theme.")); }); return; } // SPEC-ui-kit ticket 7: content-less
    if (block.type === "columns") { renderContentlessBlock(node, "Columns", renderColumnsBody); return; } // SPEC-ui-kit ticket 8
    if (block.type === "table") { renderBlockTwoLevel(node, "Table", CONTENT_DECL, renderTableInspector); return; } // #90
    if (block.type === "componentGrid") { renderContentlessBlock(node, "Component grid", renderComponentGridBody); return; } // SPEC-ui-kit ticket 8
    if (block.type === "libraryInstance") { renderContentlessBlock(node, "Library instance", renderLibraryInstanceBody); return; } // #20: live-linked mirror, content lives in the master
    if (block.type === "checkbox") { renderContentlessBlock(node, "Checkbox", renderCheckboxBody); return; } // SPEC-ui-kit ticket 8
    var head = h("div", "prop-component");
    head.appendChild(h("span", null, blockLabel(block)));
    inspector.appendChild(head);



    renderBlockActionsSection(block);
  }

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
    if (typeof applyLeftSection === "function") applyLeftSection(_activeLeftSection); // SPEC 7: re-apply the left switcher's active section (Edit shows the panel; the switcher owns pane visibility)
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

  // ---- Component Library panel (cross-course shared components) -------------
  function exportLibraryJson() {
    var blob = new Blob([JSON.stringify(window.LibraryStore, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "component-library.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importLibraryJson() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var p; try { p = JSON.parse(r.result); } catch (e) { window.alert("Couldn't read that file as JSON."); return; }
        if (!p || !p.components) { window.alert("That file isn't a component library (no components)."); return; }
        var n = Object.keys(p.components).length;
        var merge = window.confirm("Import " + n + " component(s).\n\nOK = MERGE (imported win on a name clash).\nCancel = keep yours (skip clashes).");
        Object.keys(p.components).forEach(function (k) { if (merge || !window.LibraryStore.components[k]) window.LibraryStore.components[k] = p.components[k]; });
        saveLibrary(); mount(); renderInspector();
      };
      r.readAsText(f);
    });
    inp.click();
  }
  function buildLibraryBody(c) {
    c.appendChild(h("div", "insp-hint", "A shared library used across ALL your courses. A course REFERENCES a library component; edit the master here and every course using it updates. It bakes into the export, so the shipped SCORM stays self-contained (air-gap safe)."));
    var lib = libComponents();
    // #22: PAGE masters get their own list below (different actions -- Insert page, not
    // Copy to course, since a page isn't a doc.components-shaped thing) -- filter/label
    // by type per the ticket's acceptance criteria.
    var keys = Object.keys(lib).filter(function (k) { return lib[k].kind !== "page"; });
    if (keys.length) {
      var list = h("div", "insp-list");
      keys.forEach(function (k) {
        var comp = lib[k];
        var item = h("div", "insp-list__item");
        var left = h("div", "insp-list__text");
        left.appendChild(h("span", "insp-list__title", comp.name || k));
        left.appendChild(h("span", "insp-list__meta", (comp.slots || []).map(function (s) { return s.label; }).join(", ") || comp.kind || "component"));
        // #24: where-used — a live-linked instance (#20) already resolves the CURRENT
        // master on every render, so this is a read-only blast-radius indicator, not a
        // staleness warning. Scanning the full registry per row is fine here: the panel
        // only builds when an author opens Settings > System > Component Library.
        var usage = libraryWhereUsed(k, getRegistry());
        left.appendChild(h("span", "insp-list__meta", usage.instances
          ? "Used in " + usage.courses + " course" + (usage.courses === 1 ? "" : "s") + " / " + usage.instances + " instance" + (usage.instances === 1 ? "" : "s")
          : "Not placed anywhere yet"));
        item.appendChild(left);
        var acts = h("div"); acts.style.cssText = "display:flex;gap:4px;";
        var copyB = h("button", "prop-btn", "Copy to course"); copyB.style.cssText = "padding:2px 6px;font-size:10px;"; copyB.title = "Detach a local copy into this course (edits won't propagate)";
        // #19: deliberately plain clone(), NOT remintIds — the master's ids are its
        // stable identity and must survive a detach untouched (see the contract on remintIds).
        copyB.addEventListener("click", function () { pushHistory(); getComponents()[k] = clone(comp); saveRegistry(registry); mount(); });
        // #24: an explicit, deliberate confirmation that every #20 live instance already
        // reflects the current master (architecture, not a data mutation this button
        // performs) -- and durably persists the master in case an in-memory edit hasn't
        // been saved yet. Detached/copied-to-course snapshots are NOT live references
        // (that's the whole point of detaching, #19/#21) so are intentionally out of
        // scope here; #21's Relink is the targeted way to re-sync one of those.
        var pushB = h("button", "prop-btn", "Push update"); pushB.style.cssText = "padding:2px 6px;font-size:10px;";
        pushB.title = "Confirm every live-linked instance reflects this master's current content, and save it durably.";
        pushB.addEventListener("click", function () {
          saveLibrary();
          var fresh = libraryWhereUsed(k, getRegistry());
          confirmModal("Push update", fresh.instances
            ? "Saved. " + fresh.instances + " live-linked instance" + (fresh.instances === 1 ? "" : "s") + " across " + fresh.courses + " course" + (fresh.courses === 1 ? "" : "s") + " already reflect “" + (comp.name || k) + "”'s current content — instances resolve the master live, so there's nothing further to push."
            : "Saved. “" + (comp.name || k) + "” isn't placed anywhere yet, so there's nothing to push.",
            function () {}, { okLabel: "OK" });
        });
        var delB = h("button", "prop-btn prop-btn--danger", "✕"); delB.style.cssText = "padding:2px 6px;font-size:10px;";
        delB.addEventListener("click", function () {
          var impact = libraryWhereUsed(k, getRegistry());
          var warn = impact.instances ? " Currently used in " + impact.courses + " course" + (impact.courses === 1 ? "" : "s") + " / " + impact.instances + " instance" + (impact.instances === 1 ? "" : "s") + " —" : "";
          confirmModal("Remove component", "Remove “" + (comp.name || k) + "” from the shared library?" + warn + " courses referencing it fall back to a built-in / show unknown.", function () { delete window.LibraryStore.components[k]; saveLibrary(); mount(); renderInspector(); }, { okLabel: "Remove", danger: true });
        });
        acts.appendChild(copyB); acts.appendChild(pushB); acts.appendChild(delB); item.appendChild(acts);
        list.appendChild(item);
      });
      c.appendChild(list);
    } else {
      c.appendChild(h("div", "insp-hint", "No shared components yet. Promote a course component below, or import a library."));
    }

    // #22: PAGE masters -- listed + labelled separately from block masters. "Insert page"
    // (not "Copy to course") since placing one adds a whole page to doc.pages, not a
    // doc.components entry; capture happens from a page's OWN inspector ("Save page to
    // library", above in renderPageInspector), not from here.
    var pageKeys = Object.keys(lib).filter(function (k) { return lib[k].kind === "page"; });
    if (pageKeys.length) {
      var pageSecBody = panelSection(c, "Pages");
      var pageList = h("div", "insp-list");
      pageKeys.forEach(function (k) {
        var comp = lib[k];
        var item = h("div", "insp-list__item");
        var left = h("div", "insp-list__text");
        left.appendChild(h("span", "insp-list__title", comp.name || k));
        left.appendChild(h("span", "insp-list__meta", "page"));
        var usage = libraryWhereUsed(k, getRegistry());
        left.appendChild(h("span", "insp-list__meta", usage.instances
          ? "Used in " + usage.courses + " course" + (usage.courses === 1 ? "" : "s") + " / " + usage.instances + " instance" + (usage.instances === 1 ? "" : "s")
          : "Not placed anywhere yet"));
        item.appendChild(left);
        var pacts = h("div"); pacts.style.cssText = "display:flex;gap:4px;";
        var insertB = h("button", "prop-btn prop-btn--accent", "Insert page"); insertB.style.cssText = "padding:2px 6px;font-size:10px;"; insertB.title = "Insert a live-linked page right after the current one — editing the master updates every placement";
        insertB.addEventListener("click", function () { insertPageFromLibrary(k); });
        var pPushB = h("button", "prop-btn", "Push update"); pPushB.style.cssText = "padding:2px 6px;font-size:10px;";
        pPushB.title = "Confirm every live-linked page reflects this master's current content, and save it durably.";
        pPushB.addEventListener("click", function () {
          saveLibrary();
          var fresh = libraryWhereUsed(k, getRegistry());
          confirmModal("Push update", fresh.instances
            ? "Saved. " + fresh.instances + " live-linked page" + (fresh.instances === 1 ? "" : "s") + " across " + fresh.courses + " course" + (fresh.courses === 1 ? "" : "s") + " already reflect “" + (comp.name || k) + "”'s current content — pages resolve the master live, so there's nothing further to push."
            : "Saved. “" + (comp.name || k) + "” isn't placed anywhere yet, so there's nothing to push.",
            function () {}, { okLabel: "OK" });
        });
        var pDelB = h("button", "prop-btn prop-btn--danger", "✕"); pDelB.style.cssText = "padding:2px 6px;font-size:10px;";
        pDelB.addEventListener("click", function () {
          var impact = libraryWhereUsed(k, getRegistry());
          var warn = impact.instances ? " Currently used in " + impact.courses + " course" + (impact.courses === 1 ? "" : "s") + " / " + impact.instances + " instance" + (impact.instances === 1 ? "" : "s") + " —" : "";
          confirmModal("Remove page", "Remove “" + (comp.name || k) + "” from the shared library?" + warn + " courses referencing it show an empty page.", function () { delete window.LibraryStore.components[k]; saveLibrary(); mount(); renderInspector(); }, { okLabel: "Remove", danger: true });
        });
        pacts.appendChild(insertB); pacts.appendChild(pPushB); pacts.appendChild(pDelB); item.appendChild(pacts);
        pageList.appendChild(item);
      });
      pageSecBody.appendChild(pageList);
    }
    // promote a course-local component to the shared library (single-sources it)
    var docKeys = Object.keys(doc.components || {}).filter(function (k) { return !(window.COMPONENTS || {})[k]; });
    if (docKeys.length) {
      var addBody = panelSection(c, "Add to library");
      var selectedKey = docKeys[0];
      addBody.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Course component"));
      var psel = dsSelect(docKeys.map(function (k) { return [doc.components[k].name || k, k]; }), selectedKey, function (v) { selectedKey = v; });
      addBody.appendChild(psel);
      var saveB = h("button", "prop-btn prop-btn--accent", "Save to library"); saveB.style.marginTop = "6px";
      saveB.addEventListener("click", function () {
        if (!selectedKey || !doc.components[selectedKey]) return;
        function doSave() {
          pushHistory();
          // #19: plain clone(), NOT remintIds — promoting to the shared library keeps the
          // exact ids this course-local component was captured with (see the contract on
          // remintIds); they become the master's permanent cross-course identity.
          var promoted = clone(doc.components[selectedKey]);
          stampMasterVersion(promoted, Date.now()); // Product Rail: bump on this content edit
          // Product Rail: stamp the reserved owning-Product tag from THIS course's Product
          // context, if it has one -- birthplace, not ownership; an untagged course simply
          // promotes with no reserved tag (nothing to attribute). Stamped once, here, at
          // the moment of promotion -- never re-stamped on a later overwrite.
          stampOwnerProductTag(promoted, doc.meta && doc.meta.productId);
          window.LibraryStore.components[selectedKey] = promoted;
          delete doc.components[selectedKey]; // single-source: this course now references the library copy
          saveLibrary(); saveRegistry(registry); mount(); renderInspector();
        }
        if (libComponents()[selectedKey]) {
          // #24 IMPACT PREVIEW: the one place a master's content actually changes today
          // (there's no in-place master editor yet, #21) — so this overwrite confirm is
          // where a blast-radius preview belongs.
          var impact = libraryWhereUsed(selectedKey, getRegistry());
          var warn = impact.instances ? " " + impact.instances + " live-linked instance" + (impact.instances === 1 ? "" : "s") + " across " + impact.courses + " course" + (impact.courses === 1 ? "" : "s") + " will pick up this content immediately." : " It isn't placed anywhere yet.";
          confirmModal("Overwrite component", "The library already has “" + selectedKey + "”. Overwrite it?" + warn, doSave, { okLabel: "Overwrite" });
        } else doSave();
      });
      addBody.appendChild(saveB);
    }
    var xfer = panelSection(c, "Transfer");
    xfer.appendChild(h("div", "insp-hint", "Move the library between machines / the on-prem server."));
    var expB = h("button", "prop-btn", "Export library (.json)");
    expB.addEventListener("click", exportLibraryJson); xfer.appendChild(expB);
    var impB = h("button", "prop-btn", "Import library (.json)…"); impB.style.marginTop = "6px";
    impB.addEventListener("click", importLibraryJson); xfer.appendChild(impB);
  }
  function buildComponentsBody(c) {
    c.appendChild(h("div", "insp-hint", "Define component templates and fields. Grids can render any defined template."));
    var comps = getComponents();
    var list = h("div", "insp-list");
    Object.keys(comps).forEach(function (k) {
      var comp = comps[k];
      var item = h("div", "insp-list__item");
      var left = h("div", "insp-list__text");
      left.appendChild(h("span", "insp-list__title", comp.name));
      left.appendChild(h("span", "insp-list__meta", (comp.slots || []).map(function (s) { return s.label; }).join(", ")));
      item.appendChild(left);
      list.appendChild(item);
    });
    c.appendChild(list);

    var btn = h("button", "prop-btn prop-btn--accent", "+ Define custom component");
    btn.style.marginTop = "10px";
    btn.addEventListener("click", showDefineComponentDialog);
    c.appendChild(btn);
  }

  // Capture a built block (typically a Frame composed from primitives) as a
  // reusable component. v1 = a saved preset: inserting drops an independent copy
  // (detached). Stored on doc.components with kind:"composed" so it shows in
  // the Blocks panel under "My Components" and survives save/load + export.
  function saveBlockAsComponent(block) {
    promptModal("Name this reusable component", "Component name", blockLabel(block), function (v) {
      var name = (v || "").trim();
      if (!name) return;
      var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) { alert("Please use a name with some letters or numbers."); return; }
      var comps = getComponents();
      function save() {
        pushHistory();
        comps[id] = { name: name, kind: "composed", template: remintIds(clone(block)) };
        doc.components = comps;
        saveRegistry(registry);
        mount();
        alert("Saved “" + name + "”. Find it in the Blocks panel → My Components.");
      }
      if (comps[id]) confirmModal("Overwrite component", "A component named “" + name + "” already exists. Overwrite it?", save, { okLabel: "Overwrite" });
      else save();
    });
  }

  // Dissolve a group/card back into its children in the page (at its position).
  function ungroupContainer(block) {
    var loc = getBlockPageIndexAndIndex(block);
    if (!loc) return;
    pushHistory();
    var args = [loc.blockIndex, 1].concat(block.children || []);
    Array.prototype.splice.apply(doc.pages[loc.pageIndex].blocks, args);
    clearSelection();
    mount();
  }

  function showDefineComponentDialog() {
    var existing = document.getElementById("define-comp-modal");
    if (existing) return;
    var modal = h("div", "modal-overlay");
    modal.id = "define-comp-modal";
    var box = h("div", "modal-box");
    modalHead(box, "Define custom component", "Create a reusable template with named fields you can drop onto any page.");

    var nameIn = modalText(box, "Component name", "", "e.g. Product Card");
    var idIn = modalText(box, "Component ID", "", "e.g. product-card");
    var slotsIn = modalText(box, "Fields / slots", "", "e.g. Title, Details, Action text");
    nameIn.addEventListener("input", function () {
      idIn.value = this.value.trim().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    });

    modalActions(box, modal, "Define template", function () {
      var name = nameIn.value.trim();
      var id = idIn.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
      var slotsRaw = slotsIn.value.trim();
      if (!name || !id || !slotsRaw) { alert("All fields are required."); return; }
      var slots = slotsRaw.split(",").map(function (s) {
        var clean = s.trim();
        var key = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
        return { key: key, label: clean };
      }).filter(function (s) { return s.key !== ""; });
      if (slots.length === 0) { alert("At least one valid field is required."); return; }
      var comps = getComponents();
      if (comps[id]) { alert("A component with ID '" + id + "' already exists."); return; }
      pushHistory();
      comps[id] = { name: name, slots: slots };
      doc.components = comps;
      saveRegistry(registry);
      modal.remove();
      mount();
    });
    modal.appendChild(box);
    document.body.appendChild(modal);
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
          colourControl("Background", canvasBg, function (val) { applyCanvasBg(val == null ? BG_DEFAULT : val); }, cvBody, true);
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
      { key: "library", title: "Component Library", build: buildLibraryBody }
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
    var _ins = inspector;
    try {
      sections.forEach(function (s) {
        var sec = sectionGroup("settings:" + s.key, s.title, function (body) {
          inspector = body;
          try { s.build(body); } finally { inspector = _ins; }
        }, s.opts ? s.opts() : null);
        sec.setAttribute("data-settings-section", s.key);
        settingsModal.content.appendChild(sec);
      });
    } finally { inspector = _ins; }
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
    var es = doc.endScreen || (doc.endScreen = {});
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

  // ---- KKK: custom (uploaded) fonts ----------------------------------------
  // doc.fonts = [{ family, src:"asset:<id>", format }]. The font file is stored in
  // the asset store (like an image) and base64-inlined as an @font-face in BOTH the
  // editor (a <style> below) AND the export (theme.css), so a course using an
  // uploaded font renders offline / air-gapped. render.js already falls back to the
  // raw family name when it isn't in FONT_STACKS, so a custom family "just works".
  function fontFormatFor(file) {
    var n = ((file && file.name) || "").toLowerCase();
    if (/\.woff2$/.test(n)) return "woff2";
    if (/\.woff$/.test(n)) return "woff";
    if (/\.otf$/.test(n)) return "opentype";
    return "truetype";
  }
  function resolveFontDataUrl(src) {
    if (!src) return null;
    if (src.indexOf("data:") === 0) return src;
    var m = /^asset:(.+)$/.exec(src);
    if (m && window.AssetStore) { var a = window.AssetStore.get(m[1]); return a ? a.dataUrl : null; }
    return null;
  }
  // Shared (editor + export): build the @font-face CSS for a doc's custom fonts.
  window.buildFontFaceCss = function (d) {
    return (((d && d.fonts) || []).map(function (f) {
      var url = resolveFontDataUrl(f.src);
      if (!url || url.indexOf("data:") !== 0) return "";
      var wt = f.weight ? "font-weight:" + f.weight + ";" : ""; // multi-weight embeds (e.g. Google 400 + 700)
      return "@font-face{font-family:'" + String(f.family).replace(/['\\]/g, "") + "';src:url('" + url + "') format('" + (f.format || "truetype") + "');" + wt + "font-display:swap;}";
    }).filter(Boolean)).join("\n");
  };
  function registerDocFontNames() {
    (doc.fonts || []).forEach(function (f) {
      if (!f.family) return;
      if (window.FONT_LIST && window.FONT_LIST.indexOf(f.family) === -1) window.FONT_LIST.push(f.family);
      if (window.EMBEDDABLE_FONTS && window.EMBEDDABLE_FONTS.indexOf(f.family) === -1) window.EMBEDDABLE_FONTS.push(f.family); // uploaded => embedded => never flagged
    });
  }
  function applyDocFonts() {
    var st = document.getElementById("doc-font-faces");
    if (!st) { st = document.createElement("style"); st.id = "doc-font-faces"; document.head.appendChild(st); }
    st.textContent = window.buildFontFaceCss(doc);
    registerDocFontNames();
  }
  window.__applyDocFonts = applyDocFonts; // headless/browser test hook
  window.__resolveAssetDataUrl = resolveFontDataUrl; // shared asset->dataURL (fonts, glossary, …)
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
      doc.motion = doc.motion || {};
      if (v === "" || v == null || isNaN(n)) delete doc.motion[key]; else doc.motion[key] = Math.max(0, Math.min(2000, n));
      if (!Object.keys(doc.motion).length) delete doc.motion;
      reapplyLayout(); scheduleSave();
    }
    var m = doc.motion || {};
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
    var bound = !!(doc && doc.backup);
    var connected = bound && (backupMode() === "native" ? !!doc.backup.folderPath : !!backupHandle);
    var row = h("div", "insp-row");
    var lbl = h("span", "insp-row__label"); lbl.style.flex = "1 1 auto";
    lbl.textContent = bound
      ? (connected ? "Backing up to: " + doc.backup.folderName : "Bound to “" + doc.backup.folderName + "” — NOT connected this session")
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
    doc.glossary = doc.glossary || {};
    if (!Array.isArray(doc.glossary.terms)) doc.glossary.terms = [];
    var refresh = function () { mount(); };

    // Canonical repeated-item list (same control as the Sequence block's steps, per the
    // DS control set): one row per term — grip · TERM field · DEFINITION field (rowExtra)
    // · trash, with a "+ Add term" header. Edits commit through repeatedList's own
    // pushHistory; the definition rowExtra commits its own on change.
    repeatedList(c, "Terms", {
      items: function () { return doc.glossary.terms; },
      value: function (it) { return it.term; },
      setValue: function (it, v) { it.term = v; refresh(); },
      add: function () { doc.glossary.terms.push({ term: "", def: "" }); refresh(); },
      remove: function (i) { doc.glossary.terms.splice(i, 1); refresh(); },
      move: function (from, to) { var m = doc.glossary.terms.splice(from, 1)[0]; doc.glossary.terms.splice(to, 0, m); refresh(); },
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
          doc.glossary.terms = mergeGlossaryTerms(doc.glossary.terms, added);
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
    if (doc.glossary.terms.length) {
      var clearAll = function () {
        confirmModal("Clear all terms", "Remove all " + doc.glossary.terms.length + " glossary terms? This can't be undone from here (use Undo).", function () {
          pushHistory();
          doc.glossary.terms = [];
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
  // A MODEST curated set of the most popular Google Fonts (James 2026-07-08: "most popular
  // as long as they include Exo 2 and Arial"). Exo 2 is bundled + already pickable; Arial is
  // a system font (in FONT_STACKS). Picking one here FETCHES the woff2 at author-time and
  // EMBEDS it (air-gap: no runtime CDN link ever ships). A hand list, not the full API.
  var CURATED_GOOGLE_FONTS = [
    "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Oswald", "Raleway",
    "Nunito", "Nunito Sans", "Merriweather", "Playfair Display", "Source Sans 3", "PT Sans",
    "Work Sans", "Rubik", "Noto Sans", "Ubuntu", "Mulish", "DM Sans", "Karla", "Fira Sans",
    "Barlow", "Josefin Sans", "Quicksand", "Libre Franklin", "Archivo", "Space Grotesk",
    "Manrope", "Cabin", "Bebas Neue", "Titillium Web", "Roboto Slab", "Roboto Condensed",
    "Kanit", "Heebo", "Assistant"
  ];
  window.CURATED_GOOGLE_FONTS = CURATED_GOOGLE_FONTS; // headless test hook
  // Fetch a Google Font's woff2 at AUTHOR time and embed it via the existing doc.fonts
  // pipeline (base64 @font-face → editor + export). Needs an internet connection while
  // authoring; the SHIPPED course stays self-contained. Overridable window.__fontFetch for
  // tests. Returns a Promise.
  function fetchAndEmbedGoogleFont(family) {
    if (!family) return Promise.resolve();
    if ((doc.fonts || []).some(function (f) { return f.family === family; })) { window.alert(family + " is already added."); return Promise.resolve(); }
    var doFetch = window.__fontFetch || window.fetch.bind(window);
    var api = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family) + ":wght@400;700&display=swap";
    function blobToDataUrl(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
    return doFetch(api).then(function (r) { if (!r.ok) throw new Error("CSS " + r.status); return r.text(); })
      .then(function (css) {
        // The CSS2 API returns one @font-face per weight/subset. Pick ONE woff2 per weight
        // (400 + 700) so bold is a REAL cut, not synthetic. Falls back to any single woff2.
        var byWeight = {};
        css.split("@font-face").forEach(function (blk) {
          var u = /url\((https:\/\/[^)]+\.woff2)\)/i.exec(blk); if (!u) return;
          var w = (/font-weight:\s*(\d+)/i.exec(blk) || [])[1] || "400";
          if (!byWeight[w]) byWeight[w] = u[1];
        });
        var weights = Object.keys(byWeight);
        if (!weights.length) throw new Error("no woff2 found");
        var wanted = weights.filter(function (w) { return w === "400" || w === "700"; });
        if (!wanted.length) wanted = [weights[0]];
        return Promise.all(wanted.map(function (w) {
          return doFetch(byWeight[w]).then(function (r) { if (!r.ok) throw new Error("woff2 " + r.status); return r.blob(); })
            .then(blobToDataUrl).then(function (dataUrl) { return { weight: w, dataUrl: dataUrl }; });
        }));
      })
      .then(function (faces) {
        pushHistory();
        doc.fonts = doc.fonts || [];
        faces.forEach(function (f) {
          doc.fonts.push({ family: family, src: assetRef(f.dataUrl, { name: family + "-" + f.weight + ".woff2", type: "font/woff2" }), format: "woff2", weight: parseInt(f.weight, 10), source: "google" });
        });
        applyDocFonts(); renderInspector(); scheduleSave();
      })
      .catch(function (e) { window.alert("Couldn't fetch " + family + " from Google Fonts (needs internet while authoring): " + (e && e.message || e)); });
  }
  window.__fetchGoogleFont = fetchAndEmbedGoogleFont; // headless test hook

  function buildFontsBody(c) {
    c.appendChild(h("div", "insp-hint", "Upload a font file (.ttf / .otf / .woff / .woff2) to embed it in the course — it renders offline. Then pick it as a font on any text."));
    doc.fonts = doc.fonts || [];
    // One row per FAMILY (a multi-weight embed is several entries but shows as one row;
    // the count hints at how many weights are embedded). Delete removes all of the family.
    var seen = {};
    doc.fonts.forEach(function (f) { if (!seen[f.family]) seen[f.family] = 0; seen[f.family]++; });
    Object.keys(seen).forEach(function (fam) {
      var row = h("div", "insp-row");
      var lbl = h("span", "insp-row__label", fam + (seen[fam] > 1 ? "  ·  " + seen[fam] + " weights" : "")); lbl.style.flex = "1 1 auto"; lbl.style.fontFamily = "'" + fam + "'";
      row.appendChild(lbl);
      var del = iconBtn("trash", "Remove font", true);
      del.addEventListener("click", function () { pushHistory(); doc.fonts = doc.fonts.filter(function (f) { return f.family !== fam; }); applyDocFonts(); renderInspector(); scheduleSave(); });
      row.appendChild(del);
      c.appendChild(row);
    });
    var up = h("button", "prop-btn", "Upload font…");
    up.addEventListener("click", function () {
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".ttf,.otf,.woff,.woff2,font/*";
      inp.addEventListener("change", function () {
        var file = inp.files && inp.files[0]; if (!file) return;
        var r = new FileReader();
        r.onload = function () {
          promptModal("Name this font", "Name (as it appears in the picker)", file.name.replace(/\.(ttf|otf|woff2?)$/i, ""), function (family) {
            family = (family || "").trim();
            if (!family) return;
            pushHistory();
            doc.fonts = doc.fonts || [];
            doc.fonts.push({ family: family, src: assetRef(r.result, file), format: fontFormatFor(file) });
            applyDocFonts(); renderInspector(); scheduleSave();
          });
        };
        r.readAsDataURL(file);
      });
      inp.click();
    });
    c.appendChild(up);

    // Google Fonts source: pick a popular family -> fetched + embedded at author-time.
    var gf = panelSection(c, "Google Fonts");
    gf.appendChild(h("div", "insp-hint", "Pick a popular Google Font — it's downloaded and EMBEDDED now (needs internet), so the exported course stays offline-safe. Exo 2 is bundled; Arial is a system font — both already in the picker."));
    var added = {}; (doc.fonts || []).forEach(function (f) { added[f.family] = true; });
    var opts = CURATED_GOOGLE_FONTS.filter(function (fam) { return !added[fam]; }).map(function (fam) { return [fam, fam]; });
    gf.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Google Font"));
    var gsel = dsSelect(opts, "", function (v) { if (!v) return; gsel.value = ""; fetchAndEmbedGoogleFont(v); }, { placeholder: "Add a Google Font…" });
    gf.appendChild(gsel);
  }
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


  // ---- theme controls (collapsible Theme section) --------------------------
  function showEditTextStyleDialog(name, s) {
    var existing = document.getElementById("edit-style-modal");
    if (existing) return;
    var modal = h("div", "modal-overlay");
    modal.id = "edit-style-modal";
    var box = h("div", "modal-box");
    modalHead(box, "Edit text style", "Editing the “" + name + "” style — the same controls as the text inspector.");

    // Draft the edits so Cancel discards them (the collect-on-save behaviour the
    // dialog had before); Save commits with the same delete-if-empty semantics.
    var draft = { font: s.font, weight: s.weight, size: s.size, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, wordSpacing: s.wordSpacing, color: s.color, colorToken: s.colorToken, colorLight: s.colorLight, colorDark: s.colorDark, align: s.align, textTransform: s.textTransform, textIndent: s.textIndent };

    // NN: live lorem specimen so the style previews as the controls change. Uses
    // the SAME applyTextStyle render path the canvas + export consume, so what you
    // see here is what ships. Editor-chrome only; the specimen node never enters
    // the doc. Each draft mutation below calls syncSpecimen().
    var specWrap = h("div", null);
    specWrap.style.cssText = "margin:0 0 14px;padding:12px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;background:rgba(255,255,255,0.03);overflow-wrap:anywhere;";
    var specimen = h("p", null, "The quick brown fox jumps over the lazy dog. 1234567890");
    specimen.style.margin = "0";
    specWrap.appendChild(specimen);
    // applyTheme seeds --color-* on the specimen so a token colour (var(--color-ink))
    // resolves in the preview for the mode currently being edited.
    function syncSpecimen() { window.applyTheme(specimen, activeTheme()); window.applyTextStyle(specimen, draft); }
    syncSpecimen();
    box.appendChild(specWrap);

    // Panel System v2 (D4): the SAME typeCluster the field inspector mounts — one Type
    // control body in BOTH places. Writes to `draft`; syncSpecimen previews it live.
    typeCluster(box, draft, syncSpecimen);

    modalActions(box, modal, "Save style", function () {
      pushHistory();
      if (draft.font) s.font = draft.font; else delete s.font;
      if (draft.weight) s.weight = draft.weight; else delete s.weight;
      if (draft.size == null || isNaN(draft.size)) delete s.size; else s.size = draft.size;
      if (draft.lineHeight == null || draft.lineHeight === "") delete s.lineHeight; else s.lineHeight = draft.lineHeight;
      if (draft.letterSpacing == null || isNaN(draft.letterSpacing)) delete s.letterSpacing; else s.letterSpacing = draft.letterSpacing;
      if (draft.wordSpacing == null || isNaN(draft.wordSpacing)) delete s.wordSpacing; else s.wordSpacing = draft.wordSpacing;
      // colour: token XOR hex (mutually exclusive) — a token wins and clears the hex.
      delete s.colorLight; delete s.colorDark;
      if (draft.colorToken) { s.colorToken = draft.colorToken; delete s.color; }
      else if (draft.colorLight || draft.colorDark) { s.colorLight = draft.colorLight; s.colorDark = draft.colorDark; delete s.color; delete s.colorToken; }
      else { delete s.colorToken; if (draft.color == null) delete s.color; else s.color = draft.color; }
      if (draft.align == null || draft.align === "left") delete s.align; else s.align = draft.align;
      if (!draft.textTransform) delete s.textTransform; else s.textTransform = draft.textTransform;
      if (draft.textIndent == null || isNaN(draft.textIndent)) delete s.textIndent; else s.textIndent = draft.textIndent;
      saveRegistry(registry);
      modal.remove();
      mount();
      renderInspector();
    });
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function showAddTextStyleDialog() {
    var existing = document.getElementById("add-style-modal");
    if (existing) return;
    var modal = h("div", "modal-overlay");
    modal.id = "add-style-modal";
    var box = h("div", "modal-box");
    modalHead(box, "Add text style", "Save a named text style you can apply to any text block.");

    var nameIn = modalText(box, "Style name", "", "e.g. Subtitle 3");

    modalActions(box, modal, "Create style", function () {
      var name = nameIn.value.trim();
      if (!name) { alert("Style name is required."); return; }
      var styles = getTextStyles();
      if (styles[name]) { alert("A style with that name already exists."); return; }
      pushHistory();
      styles[name] = { font: "System", size: 15, weight: "400", lineHeight: "1.5" };
      saveRegistry(registry);
      modal.remove();
      renderInspector();
    });
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function renderThemeControls(c) {
    // #126: cross-course theme presets — the FIRST control in the panel. One drop-down:
    // pick a saved theme (applies on select, COPY-ON-APPLY so the course stays self-
    // contained) or "Save current setup as new theme" to snapshot this course's look for
    // reuse across projects. Rename/Delete appear for the chosen saved theme.
    // #162: each theme section is a canonical panelSection collapsible. The IIFEs below
    // take a `c` param (shadowing the outer content pane) so their appends land in the
    // section body without re-pointing every internal reference.
    (function themePresetPicker(c) {
      var presets = loadThemePresets();
      var names = Object.keys(presets);
      if (themePresetSel && !presets[themePresetSel]) themePresetSel = null; // stale (deleted elsewhere)
      // Neutral placeholder — never echo the selected name (that duplicated the chosen
      // theme: once here, once as its real option). The selected real option below is
      // what the closed control shows.
      var presetPairs = names.map(function (name) { return [name, "preset:" + name]; });
      presetPairs.push(["+ Save current setup as new theme…", "__new"]);
      var sel = dsSelect(presetPairs, themePresetSel ? ("preset:" + themePresetSel) : "", function (v) {
        if (v === "__new") {
          promptModal("Save theme preset", "Theme name", "", function (nm) {
            if (nm == null) { renderInspector(); return; }
            nm = (nm || "").trim(); if (!nm) { renderInspector(); return; }
            var existing = loadThemePresets();
            function doSave() { if (saveThemePreset(nm)) { themePresetSel = nm; renderInspector(); } else renderInspector(); }
            if (existing[nm]) confirmModal("Overwrite theme", 'A theme named "' + nm + '" already exists. Overwrite it?', doSave, { okLabel: "Overwrite" });
            else doSave();
          });
          return;
        }
        if (v.indexOf("preset:") === 0) {
          var name = v.slice(7);
          if (applyThemePreset(name)) { themePresetSel = name; renderInspector(); }
          return;
        }
        // "" (placeholder) -> no-op
      }, { placeholder: names.length ? "Saved themes…" : "No saved themes yet" });
      c.appendChild(sel);
      // Manage the chosen saved theme.
      if (themePresetSel && presets[themePresetSel]) {
        var manage = h("div", null);
        manage.style.display = "flex"; manage.style.gap = "6px"; manage.style.marginTop = "6px";
        var renBtn = h("button", "prop-btn", "Rename");
        renBtn.addEventListener("click", function () {
          promptModal("Rename theme", "New name", themePresetSel, function (nn) {
            if (nn == null) return;
            var old = themePresetSel;
            if (renameThemePreset(old, nn)) { themePresetSel = (nn || "").trim(); renderInspector(); }
          });
        });
        var delBtn = h("button", "prop-btn prop-btn--danger", "Delete");
        delBtn.addEventListener("click", function () {
          confirmModal("Delete theme", "Delete the '" + themePresetSel + "' theme? Courses that used it are unaffected.", function () {
            if (deleteThemePreset(themePresetSel)) { themePresetSel = null; renderInspector(); }
          }, { okLabel: "Delete", danger: true });
        });
        manage.appendChild(renBtn); manage.appendChild(delBtn);
        c.appendChild(manage);
      }
      c.appendChild(h("div", "insp-hint", "Reuse a theme across projects. Picking a saved theme copies its colours, button + text styles onto this course (no live link)."));
    })(panelSection(c, "Theme preset"));

    // NNN: the Dark/Light palette switch now lives in the TOP BAR (#mode-toggle);
    // removed from here so there is one place to switch mode. Swatches below show
    // the ACTIVE mode's palette and rebuild when the top-bar toggle flips it.
    // SSSS: pick which palette these swatches EDIT — light or dark — independent of
    // what the canvas previews (NNN top-bar toggle). So you can set both explicitly.
    segmentedLive("Editing", [["Light", "light"], ["Dark", "dark"]],
      function (v) { return themeEditName() === v; },
      function (v) { themeEditMode = v; renderInspector(); }, c);
    if (themeEditName() !== activeMode) {
      c.appendChild(h("div", "insp-hint", "Editing the " + themeEditName() + " palette while the canvas previews " + activeMode + " — flip the top-bar palette toggle to preview it."));
    }
    var sColors = panelSection(c, "Theme colours");
    // Each token applies LIVE via setToken (reapplyTheme repaints the canvas in
    // place); no history (theme is not in doc). Clearing reverts to the default.
    [["accent", "Accent"], ["bg", "Background"], ["surface", "Surface"], ["ink", "Text"], ["success", "Complete"]].forEach(function (t) {
      var key = t[0];
      colourControl(t[1], themeEdit().color[key],
        function (val) { setToken(key, val == null ? window.THEMES[themeEditName()].color[key] : val); }, sColors, true);
    });

    // #125: full-token editing -- the mode-SHARED groups (font / space / radius / size).
    // Unlike the per-mode colours above, these are shared across light + dark (edited once,
    // applied to both). Each writes through setSharedToken (live via reapplyTheme + persisted
    // on doc.theme). A shared px field: parse the number, store "<n>px".
    function sharedPx(group, key, glyph, title) {
      var cur = parseInt((themeEdit()[group] || {})[key], 10);
      return iconField(glyph, {
        value: isNaN(cur) ? "" : cur, unit: "px", step: 1, min: 0, max: 400,
        title: title, datalist: "dl-gap", noHistory: true,
        onchange: function (v) { var n = parseInt(v, 10); setSharedToken(group, key, (isNaN(n) ? 0 : n) + "px"); }
      }).wrap;
    }

    var sType = panelSection(c, "Typography");
    sType.appendChild(h("div", "insp-hint", "Font families are shared across the light and dark palettes."));
    [["heading", "Headings"], ["body", "Body text"]].forEach(function (f) {
      var key = f[0];
      sType.appendChild(h("div", "insp-row__label insp-row__label--stacked", f[1]));
      sType.appendChild(buildFontPicker(window.fontNameFromStack(themeEdit().font[key]), function (name) {
        setSharedToken("font", key, name ? window.fontStackFor(name) : window.THEMES[themeEditName()].font[key]);
      }));
    });

    var sSpace = panelSection(c, "Spacing");
    sSpace.appendChild(twoUp(sharedPx("space", "xs", "XS", "Space — extra small"), sharedPx("space", "sm", "S", "Space — small")));
    sSpace.appendChild(twoUp(sharedPx("space", "md", "M", "Space — medium"), sharedPx("space", "lg", "L", "Space — large")));
    sSpace.appendChild(twoUp(sharedPx("space", "xl", "XL", "Space — extra large")));

    var sRadius = panelSection(c, "Radius");
    sRadius.appendChild(twoUp(sharedPx("radius", "card", Icon("radius"), "Card corner radius")));

    var sSizes = panelSection(c, "Text sizes");
    sSizes.appendChild(twoUp(sharedPx("size", "pageTitle", "T", "Page title"), sharedPx("size", "cardTitle", "C", "Card title")));
    sSizes.appendChild(twoUp(sharedPx("size", "cardBody", "B", "Card body"), sharedPx("size", "cardNum", "#", "Card number / eyebrow")));

    // KK: theme-level Button style. Edits the buttonStyle bundle (--button-*);
    // every non-overridden button (nav/CTA + footer-nav radius) restyles live via
    // reapplyTheme -- reference, not copy. Clearing a control reverts to baseline.
    var sButton = panelSection(c, "Button style");
    var btn = ensureButton();
    colorFieldFlat("Fill", btn.bg,
      function (val) { setButtonToken("bg", val == null ? window.THEMES[themeEditName()].button.bg : val); }, sButton, { noHistory: true });
    colorFieldFlat("Text", btn.fg,
      function (val) { setButtonToken("fg", val == null ? window.THEMES[themeEditName()].button.fg : val); }, sButton, { noHistory: true });
    // Stroke (border) colour. Pairs with the Stroke width field below; clearing
    // reverts to the transparent baseline (no visible border).
    colorFieldFlat("Stroke", (btn.borderColor && btn.borderColor !== "transparent") ? btn.borderColor : null,
      function (val) { setButtonToken("borderColor", val == null ? window.THEMES[themeEditName()].button.borderColor : val); }, sButton, { noHistory: true });
    // Hover-state colours (interaction feedback). Empty tracks the base fill/text
    // (course.css fallback), so clearing = revert to the plain brighten-on-hover.
    colorFieldFlat("Hover fill", btn.hoverBg || null,
      function (val) { setButtonToken("hoverBg", val == null ? "" : val); }, sButton, { noHistory: true });
    colorFieldFlat("Hover text", btn.hoverFg || null,
      function (val) { setButtonToken("hoverFg", val == null ? "" : val); }, sButton, { noHistory: true });
    function btnPx(key, glyph, title) {
      var def = window.THEMES[themeEditName()].button[key];
      return iconField(glyph, {
        value: parseInt(ensureButton()[key], 10), unit: "px", step: 1, min: 0, max: 400,
        title: title, datalist: "dl-gap", noHistory: true,
        onchange: function (v) { var n = parseInt(v, 10); setButtonToken(key, isNaN(n) ? def : (n + "px")); }
      }).wrap;
    }
    sButton.appendChild(twoUp(btnPx("radius", Icon("radius"), "Corner radius"), btnPx("fontSize", "A", "Font size")));
    sButton.appendChild(twoUp(btnPx("padY", Icon("padding"), "Padding (vertical)"), btnPx("padX", Icon("padding"), "Padding (horizontal)")));
    sButton.appendChild(twoUp(btnPx("borderWidth", Icon("border-weight"), "Stroke width")));

    // #127: block-type default appearance. Lists each captured type default (fill /
    // text / border / radius) with canonical controls + a remove action. Capture is done
    // from a styled block's Appearance panel ("Capture look"); this edits what was captured.
    // A block's own box always wins over its type default (render/export cascade).
    var sBlock = panelSection(c, "Block styles");
    sBlock.appendChild(h("div", "insp-hint", "Default appearance per block type. Capture a styled block's look from its Appearance panel, then fine-tune it here. Any block's own styling overrides its type default."));
    // uio-O-W2 (OVL-07): each captured type is its OWN section beside "Block styles", not a
    // third level of headings inside it. `listHost` is the Theme body they sit in.
    (function blockStylesEditor(intro, listHost) {
      var bstyles = getBlockStyles();
      var types = Object.keys(bstyles);
      function commit() { window.applyRenderContext({ blockStyles: getBlockStyles() }); scheduleSave(); mount(); }
      if (!types.length) { intro.appendChild(h("div", "insp-hint", "No block defaults captured yet.")); return; }
      types.forEach(function (type) {
        var box = bstyles[type];
        var c = panelSection(listHost, type + " blocks");
        colorFieldFlat("Fill", box.fill, function (v) { if (v == null) delete box.fill; else box.fill = v; commit(); }, c, { noHistory: true });
        colorFieldFlat("Text", box.textColor, function (v) { if (v == null) delete box.textColor; else box.textColor = v; commit(); }, c, { noHistory: true });
        // uio-F03: the SAME row, at the COURSE rung — the type default overriding the system
        // default. Proves one primitive reads correctly at any rung, in any surface.
        var typeStrokeRes = resolveScoped(scopeChain([scopeRung("system", BOX_SYSTEM_DEFAULTS), scopeRung("course", box)]), "border", { at: "course" });
        switchRow("Stroke", function () { return !!typeStrokeRes.value; },
          function (v) { if (v) box.border = true; else delete box.border; commit(); refreshSettingsPanes(); }, c, false,
          { inherit: { res: typeStrokeRes, format: onOffLabel, onReset: function () {
              pushHistory(); delete box.border; commit(); refreshSettingsPanes();
            } } });
        if (typeStrokeRes.value) colorFieldFlat("Stroke colour", box.borderColor, function (v) { if (v == null) delete box.borderColor; else box.borderColor = v; commit(); }, c, { noHistory: true });
        var wf = iconField(Icon("border-weight"), { value: box.borderWidth, unit: "px", placeholder: "1", step: 1, min: 0, max: 12, datalist: "dl-gap", noHistory: true, title: "Stroke width",
          onchange: function (v) { var n = parseFloat(v); if (isNaN(n)) delete box.borderWidth; else box.borderWidth = n; commit(); } }).wrap;
        var rf = iconField(Icon("radius"), { value: box.radius, unit: "px", placeholder: "0", step: 1, min: 0, max: 80, datalist: "dl-gap", noHistory: true, title: "Corner radius",
          onchange: function (v) { var n = parseFloat(v); if (isNaN(n)) delete box.radius; else box.radius = n; commit(); } }).wrap;
        c.appendChild(twoUp(wf, rf));
        var clr = h("button", "prop-btn prop-btn--danger", "Remove " + type + " default"); clr.style.marginTop = "6px";
        clr.addEventListener("click", function () { pushHistory(); delete bstyles[type]; commit(); refreshSettingsPanes(); });
        c.appendChild(clr);
      });
    })(sBlock, c);

    var reset = h("button", "prop-btn", "Reset " + themeEditName() + " theme");
    reset.addEventListener("click", function () {
      // Reset THIS course's theme for the edited mode: restore the baseline palette +
      // the shared button bundle on doc.theme, then re-derive the working cache (keeps
      // the doc-reference link intact so the next edit still round-trips).
      var nm = themeEditName();
      if (!doc.theme) doc.theme = window.defaultDocTheme();
      doc.theme.color[nm] = clone(window.THEMES[nm].color);
      doc.theme.button = clone(window.THEMES[nm].button);
      // #125: also restore the shared (mode-independent) groups now editable here.
      doc.theme.font = clone(window.THEMES[nm].font);
      doc.theme.space = clone(window.THEMES[nm].space);
      doc.theme.radius = clone(window.THEMES[nm].radius);
      doc.theme.size = clone(window.THEMES[nm].size);
      window.normalizeDocTheme(doc.theme);
      syncWorkingFromDoc();
      reapplyTheme(); persistTheme(); renderInspector();
    });
    c.appendChild(reset);
    c.appendChild(h("div", "insp-hint", "Published SCORM lets the learner pick dark/light at runtime (wired in export)."));

    var sSaved = panelSection(c, "Saved Text Styles");
    var styles = getTextStyles();
    var slist = h("div", "insp-group");
    slist.style.display = "flex";
    slist.style.flexDirection = "column";
    slist.style.gap = "6px";
    slist.style.marginTop = "8px";
    
    Object.keys(styles).forEach(function (name) {
      var s = styles[name];
      var item = h("div", null);
      item.style.padding = "6px 8px";
      item.style.background = "var(--surface-canvas)";
      item.style.border = "1px solid var(--border-strong)";
      item.style.borderRadius = "6px";
      item.style.display = "flex";
      item.style.justifyContent = "space-between";
      item.style.alignItems = "center";
      
      var left = h("div", null);
      left.style.display = "flex";
      left.style.flexDirection = "column";
      left.style.gap = "2px";
      
      var title = h("span", null, name);
      title.style.fontWeight = "600";
      title.style.fontSize = "11px";
      
      var subtitle = h("span", null, (s.font || "Default") + " • " + (s.size || "auto") + "px • " + (s.weight || "Default"));
      subtitle.style.fontSize = "9px";
      subtitle.style.color = "var(--text-secondary)";
      
      left.appendChild(title);
      left.appendChild(subtitle);
      item.appendChild(left);
      
      var actions = h("div", null);
      actions.style.display = "flex";
      actions.style.gap = "4px";
      
      var editBtn = h("button", "prop-btn", "Edit");
      editBtn.style.padding = "2px 6px";
      editBtn.style.fontSize = "10px";
      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        showEditTextStyleDialog(name, s);
      });

      var renBtn = h("button", "prop-btn", "Rename");
      renBtn.style.padding = "2px 6px";
      renBtn.style.fontSize = "10px";
      renBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        promptModal("Rename text style", "New name", name, function (nn) {
          if (nn == null) return;
          if (renameTextStyle(name, nn)) renderInspector();
        });
      });

      var delBtn = h("button", "prop-btn prop-btn--danger", "✕");
      delBtn.style.padding = "2px 6px";
      delBtn.style.fontSize = "10px";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        confirmModal("Delete text style", "Delete the '" + name + "' style? Blocks using it fall back to their default.", function () {
          pushHistory();
          delete styles[name];
          saveRegistry(registry);
          mount();
          renderInspector();
        }, { okLabel: "Delete", danger: true });
      });
      
      actions.appendChild(editBtn);
      actions.appendChild(renBtn);
      actions.appendChild(delBtn);
      item.appendChild(actions);
      slist.appendChild(item);
    });
    sSaved.appendChild(slist);

    var addStyleBtn = h("button", "prop-btn prop-btn--accent", "+ Add Text Style");
    addStyleBtn.style.marginTop = "10px";
    addStyleBtn.addEventListener("click", showAddTextStyleDialog);
    sSaved.appendChild(addStyleBtn);

    // #145: text roles — the named style each block TYPE links to. A CSV/schema import
    // drops blocks by type with no style; this map lets the editor auto-link each type
    // to its role style (styleRef is a live ref, so editing the style repaints all).
    var sRoles = panelSection(c, "Text roles (by block type)");
    sRoles.appendChild(h("div", "insp-hint", "Each text block type links to a named style. New blocks and imported courses auto-link to these; editing a style repaints every linked block."));
    var roles = getTextRoles();
    var styleNames = Object.keys(getTextStyles());
    var ROLE_TYPES = [["heading", "Heading"], ["subheading", "Subheading"], ["paragraph", "Paragraph"], ["note", "Note / callout"], ["quote", "Quote"], ["list", "List"]];
    ROLE_TYPES.forEach(function (rt) {
      var type = rt[0];
      var row = h("div", "insp-inline-row"); row.style.alignItems = "center"; row.style.gap = "8px"; row.style.marginTop = "4px";
      var lab = h("span", null, rt[1]); lab.style.flex = "0 0 90px"; lab.style.fontSize = "11px";
      var rolePairs = [["— none —", ""]].concat(styleNames.map(function (n) { return [n, n]; }));
      // warn (no crash) when a role points at a style the course does not have.
      if (roles[type] && styleNames.indexOf(roles[type]) === -1) rolePairs.push([roles[type] + " (missing)", roles[type]]);
      var sel = dsSelect(rolePairs, roles[type] || "", function (v) { pushHistory(); if (v) roles[type] = v; else delete roles[type]; saveRegistry(registry); });
      sel.style.flex = "1 1 auto";
      row.appendChild(lab); row.appendChild(sel);
      sRoles.appendChild(row);
    });
    var applyRolesBtn = h("button", "prop-btn prop-btn--accent", "Apply text styles by type");
    applyRolesBtn.style.marginTop = "10px";
    applyRolesBtn.title = "Link every text block that has no style yet to its type's role style (manual choices are kept)";
    applyRolesBtn.addEventListener("click", function () {
      var n = window.Editor.applyTextRolesByType();
      applyRolesBtn.textContent = n ? "Styled " + n + " block" + (n === 1 ? "" : "s") : "All text blocks already styled";
      setTimeout(function () { renderInspector(); }, 1100);
    });
    sRoles.appendChild(applyRolesBtn);
  }

  // a plain text field selected
  // #157/rawSelect review: canonical dropdown — VersoUI.Select fed the editor's [label, value]
  // option pairs. Returns the <select> element so callers can still style width/flex or attach
  // extra listeners (e.g. the selection-aware weight picker's mousedown range capture).
  function dsSelect(pairs, current, onChange, opts) {
    opts = opts || {};
    return window.VersoUI.Select({
      options: (pairs || []).map(function (o) { return { value: o[1], label: o[0] }; }),
      value: current == null ? "" : String(current),
      placeholder: opts.placeholder || null,
      onChange: onChange
    });
  }
  function selectRow(label, options, current, onchange) {
    inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", label));
    var sel = dsSelect(options, current, function (v) { pushHistory(); onchange(v); });
    inspector.appendChild(sel);
    return sel;
  }
  // Item I: is a chosen font in the safe/embeddable set (web-loaded + bundled)?
  // Empty = theme default = safe. Anything else (a system font picked from the
  // fuller Local-Font-Access list) may not render on an offline/air-gapped target
  // unless embedded at export -- so we flag it.
  function isEmbeddableFont(name) {
    if (!name) return true;
    var emb = window.EMBEDDABLE_FONTS || [];
    return emb.indexOf(name) !== -1;
  }
  // font picker: a button + popup listbox where each font name is rendered IN
  // that font. Drop-in for the plain <select> font pickers — exposes `.value` (get/set) and
  // fires a 'change' event on pick, so attachFontWarn works against it unchanged. Options =
  // "" (Default) + window.FONT_LIST; only loaded families appear here, so previews render.
  function buildFontPicker(current, onPick) {
    var wrap = h("div", "font-picker");
    var btn = h("button", "font-picker__btn prop-select"); btn.type = "button";
    var pop = h("div", "font-picker__pop"); pop.hidden = true;
    var val = current || "";
    function labelFor(v) { return v ? v : "Default"; }
    function stackFor(v) { return window.fontStackFor ? window.fontStackFor(v) : (v ? "'" + v + "'" : ""); }
    function paintBtn() { btn.textContent = labelFor(val); btn.style.fontFamily = stackFor(val); }
    (([""]).concat(window.FONT_LIST || [])).forEach(function (v) {
      var row = h("div", "font-picker__opt" + (v === val ? " is-active" : ""), labelFor(v));
      row.style.fontFamily = stackFor(v);
      row.addEventListener("click", function () {
        val = v; paintBtn();
        Array.prototype.forEach.call(pop.children, function (c) { c.classList.remove("is-active"); });
        row.classList.add("is-active");
        close(); onPick(v);
        try { wrap.dispatchEvent(new Event("change")); } catch (_) {}
      });
      pop.appendChild(row);
    });
    function onDoc(e) { if (!wrap.contains(e.target)) close(); }
    function onEsc(e) { if (e.key === "Escape") { close(); } }
    function open() { pop.hidden = false; btn.classList.add("is-open"); setTimeout(function () { document.addEventListener("mousedown", onDoc); }, 0); document.addEventListener("keydown", onEsc); }
    function close() { pop.hidden = true; btn.classList.remove("is-open"); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); }
    btn.addEventListener("click", function () { pop.hidden ? open() : close(); });
    wrap.appendChild(btn); wrap.appendChild(pop);
    paintBtn();
    Object.defineProperty(wrap, "value", { get: function () { return val; }, set: function (v) { val = v || ""; paintBtn(); } });
    return wrap;
  }
  window.__buildFontPicker = buildFontPicker; // headless test hook

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
  // A navigable element (a nav-button block or a component instance) carries
  // action.goto = a page id. This is set here (dropdown or drag-to-link), drawn
  // as an accent connector on the canvas, and followed in demo mode.
  function pageIndexById(id) { for (var i = 0; i < doc.pages.length; i++) if (doc.pages[i].id === id) return i; return -1; }
  function pageById(id) { var i = pageIndexById(id); return i >= 0 ? doc.pages[i] : null; }
  function currentGoto(host) { return (host.action && host.action.goto) ? host.action.goto : ""; }
  // Combined action selector value: "__exit" for the Exit-course DO-action, else
  // the goto page id (or "" for none). Keeps the single "On click" dropdown one control.
  var EXIT_ACTION = "__exit";
  function currentAction(host) { return (host.action && host.action.exit) ? EXIT_ACTION : currentGoto(host); }
  function setGoto(host, pageId) {
    pushHistory();
    if (pageId) host.action = { goto: pageId };
    else if (host.action) delete host.action;
  }
  function setExitAction(host) { pushHistory(); host.action = { exit: true }; }
  function setAction(host, v) { if (v === EXIT_ACTION) setExitAction(host); else setGoto(host, v); }

  // Actions inspector section. host = the object that holds .action (an instance
  // or a block); sourceNode = its canvas node; reselect = re-select after remount.
  function buildActions(host, sourceNode, reselect) {
    var _actRoot = inspector; inspector = panelSection(_actRoot, "Actions");
    var opts = [["No navigation", ""]]
      .concat(doc.pages.map(function (p) { return [pageDisplayName(p, doc), p.id]; }))
      .concat([["Exit course (end SCORM session)", EXIT_ACTION]]);
    selectRow("On click", opts, currentAction(host), function (v) { setAction(host, v); mount(); reselect(); });
    var drag = h("button", "prop-btn", "⤳  Drag onto a page to link");
    drag.title = "Press here and drag onto a target frame on the canvas";
    drag.addEventListener("mousedown", function (e) { e.preventDefault(); startLink(host, sourceNode, reselect); });
    inspector.appendChild(drag);
    if (currentAction(host) === EXIT_ACTION) {
      inspector.appendChild(h("div", "insp-hint", "Exits the course — ends the SCORM session (LMSFinish) and hands the learner back to the LMS. In demo mode it just shows a notice; test the real exit in the LMS."));
    } else if (currentGoto(host)) {
      var tgt = pageById(currentGoto(host));
      inspector.appendChild(h("div", "insp-hint", "Navigates to “" + (tgt ? tgt.name : currentGoto(host)) + "”. Click it in demo mode to follow the link."));
    } else {
      inspector.appendChild(h("div", "insp-hint", "No navigation set. Drag onto a frame, or pick a page above."));
    }
    inspector = _actRoot;
  }

  // a nav-button block selected -> its label + Actions
  function renderNavButtonInspector(node) {
    var block = node.__block;
    var head = h("div", "prop-component");
    head.appendChild(h("span", null, "Navigation button"));
    inspector.appendChild(head);

    // #161: canonical taxonomy — Content (label), Appearance (button style), Behaviour
    // (on-click navigation). renderBlockActionsSection then pins the box Appearance/Layout/
    // Spacing container sections (its own begin/endSections) + the Actions footer.
    beginSections();

    // Content — the button label.
    sectionGroup("Content", "Label", function (secBody) {
      var row = h("div", "insp-row"); row.appendChild(h("span", "insp-row__label", "Text"));
      var input = h("input", "prop-text"); input.type = "text"; input.spellcheck = false; input.value = block.text || "";
      input.addEventListener("input", function () { block.text = input.value; if (node.textContent !== input.value) node.textContent = input.value; renderModelView(); });
      row.appendChild(input); secBody.appendChild(row);
    });

    // Appearance — unified, live-apply button style (never rebuilds the panel, so the
    // button stays selected on every change; colours are real pickers).
    sectionGroup("Appearance", "Style", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try {
      function restyle() { window.applyButtonStyle(node, block); renderModelView(); }

      colorFieldFlat("Fill", block.bg, function (v) { if (v == null) delete block.bg; else block.bg = v; restyle(); });
      colorFieldFlat("Text", block.fg, function (v) { if (v == null) delete block.fg; else block.fg = v; restyle(); });
      // Per-block hover-state override (KK); empty falls back to the theme bundle.
      colorFieldFlat("Hover fill", block.hoverBg, function (v) { if (v == null) delete block.hoverBg; else block.hoverBg = v; restyle(); });
      colorFieldFlat("Hover text", block.hoverFg, function (v) { if (v == null) delete block.hoverFg; else block.hoverFg = v; restyle(); });

      segmentedLive("Size", [["S", "s"], ["M", "m"], ["L", "l"]], function (v) { return (block.size || "m") === v; },
        function (v) { if (v === "m") delete block.size; else block.size = v; restyle(); });
      segmentedLive("Shape", [["rounded", ""], ["pill", "pill"], ["square", "square"]], function (v) { return (block.shape || "") === v; },
        function (v) { if (!v) delete block.shape; else block.shape = v; delete block.radius; restyle(); });
      segmentedLive("Width", [["hug", false], ["full", true]], function (v) { return !!block.fullWidth === v; },
        function (v) { block.fullWidth = v; restyle(); });

      // Stroke: on/off + colour + width (colour/width always shown; take effect when on)
      switchRow("Stroke", function () { return !!block.stroke; },
        function (v) { if (!v) delete block.stroke; else block.stroke = true; restyle(); });
      colorFieldFlat("Stroke colour", block.strokeColor, function (v) { if (v == null) delete block.strokeColor; else block.strokeColor = v; restyle(); });
      fieldRow("Stroke width", block.strokeWidth == null ? "" : block.strokeWidth, function (v) { var n = parseFloat(v); if (isNaN(n)) delete block.strokeWidth; else block.strokeWidth = n; restyle(); }, "1", 0.5, 0, 12, "dl-gap");

      inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Font"));
      var navFontSel = buildFontPicker(block.font || "", function (v) { if (!v) delete block.font; else block.font = v; restyle(); });
      inspector.appendChild(navFontSel);
      inspector.appendChild(attachFontWarn(navFontSel));
      } finally { inspector = _ins; }
    });

    // Behaviour — on-click navigation target (shared buildActions).
    sectionGroup("Behaviour", "On click", function (secBody) {
      var _ins = inspector; inspector = secBody;
      try { buildActions(block, node, function () { reselectBlockNode(block, "navButton"); }); } finally { inspector = _ins; }
    });

    // #165: keep the buffer OPEN across the shared footer so the nav's Content/Appearance/
    // Behaviour + the footer's Appearance(box)/Layout/Spacing emit as ONE PanelLayout-sorted
    // stream (Behaviour after Layout/Spacing), then flush once.
    renderBlockActionsSection(block);
    endSections(inspector);
  }

  // ---- drag-to-link: press the inspector's drag control, drag onto a frame ---
  // A screen-space preview arrow tracks the cursor; the frame under the cursor
  // highlights; releasing over it sets action.goto to that page.
  var linking = null;      // { host, reselect, from:{x,y} }
  var linkOverlay = null, linkPath = null, hlFrame = null;
  function ensureLinkOverlay() {
    if (linkOverlay) return;
    linkOverlay = document.createElementNS(SVGNS, "svg");
    linkOverlay.setAttribute("class", "link-overlay");
    var defs = document.createElementNS(SVGNS, "defs");
    var m = document.createElementNS(SVGNS, "marker");
    m.setAttribute("id", "link-arrow"); m.setAttribute("viewBox", "0 0 10 10");
    m.setAttribute("refX", "8"); m.setAttribute("refY", "5");
    m.setAttribute("markerWidth", "7"); m.setAttribute("markerHeight", "7");
    m.setAttribute("orient", "auto-start-reverse");
    var ar = document.createElementNS(SVGNS, "path");
    ar.setAttribute("d", "M0 0L10 5L0 10z"); ar.setAttribute("fill", "#0d99ff");
    m.appendChild(ar); defs.appendChild(m);
    linkPath = document.createElementNS(SVGNS, "path");
    linkPath.setAttribute("class", "link-overlay__path");
    linkPath.setAttribute("marker-end", "url(#link-arrow)");
    linkOverlay.appendChild(defs); linkOverlay.appendChild(linkPath);
    document.body.appendChild(linkOverlay);
  }
  function frameElementUnder(cx, cy) { var e = document.elementFromPoint(cx, cy); return e ? e.closest(".frame") : null; }
  function frameIndexOf(frameEl) { for (var i = 0; i < frameDescs.length; i++) if (frameDescs[i].frame === frameEl) return i; return -1; }
  function clearFrameHighlight() { if (hlFrame) { hlFrame.classList.remove("is-link-target"); hlFrame = null; } }
  function startLink(host, sourceNode, reselect) {
    ensureLinkOverlay();
    var r = sourceNode.getBoundingClientRect();
    linking = { host: host, reselect: reselect, from: { x: r.right, y: r.top + r.height / 2 } };
    linkOverlay.style.display = "block";
    document.body.classList.add("is-linking");
  }
  // Interact-mode variant of the drag-to-link gesture: drop onto a frame appends
  // a {click -> goto:targetPage} interaction to the block (mints an id) instead of
  // writing the legacy host.action.goto.
  function startInteractLink(block, sourceNode) {
    ensureLinkOverlay();
    var r = sourceNode.getBoundingClientRect();
    linking = { interact: true, block: block, from: { x: r.right, y: r.top + r.height / 2 } };
    linkOverlay.style.display = "block";
    document.body.classList.add("is-linking");
  }
  window.addEventListener("mousemove", function (e) {
    if (!linking) return;
    var f = linking.from, x2 = e.clientX, y2 = e.clientY, cx = (x2 - f.x) / 2;
    linkPath.setAttribute("d", "M" + f.x + " " + f.y + " C" + (f.x + cx) + " " + f.y + " " + (x2 - cx) + " " + y2 + " " + x2 + " " + y2);
    var fr = frameElementUnder(x2, y2);
    if (fr !== hlFrame) { clearFrameHighlight(); if (fr) { fr.classList.add("is-link-target"); hlFrame = fr; } }
  });
  window.addEventListener("mouseup", function (e) {
    if (!linking) return;
    var lk = linking; linking = null;
    var fr = frameElementUnder(e.clientX, e.clientY);
    clearFrameHighlight();
    linkOverlay.style.display = "none";
    document.body.classList.remove("is-linking");
    if (fr) {
      var idx = frameIndexOf(fr);
      if (idx >= 0) {
        if (lk.interact) {
          pushHistory();
          addGotoInteraction(lk.block, doc.pages[idx].id);
          mount(); interactReselect(lk.block);
        } else { setGoto(lk.host, doc.pages[idx].id); mount(); lk.reselect(); }
      }
    }
  });

  // ---- editing wiring (across all frames) ----------------------------------
  function blockLocked(node) { var b = node.closest && node.closest(".canvas-block"); return !!(b && b.__block && b.__block.locked); }
  // SSS two-state text (OPT-IN, default off = current always-editable behaviour).
  // On: a text block SELECTS on single-click (no caret) and enters edit only on
  // double-click, so drag-to-move / Delete / select behave like any other block.
  var TWO_STATE_KEY = "authoring.two-state-text";
  // §74 progressive selection is now the DEFAULT (select-first). The flag is
  // REUSED, flipped: absent OR "1" => select-first ON; only an explicit "0"
  // ("Click to edit" escape hatch) opts out. Back-compat: users who had turned
  // the old opt-in OFF stored "0" and stay click-to-edit; everyone else flips on.
  // James 2026-07-08: select-first is the only model — always on, no opt-out (the toggle was
  // removed). Hard-wired true so anyone who previously stored "0" is migrated to select-first.
  function twoStateText() { return true; }
  function setTwoStateText(on) { try { localStorage.setItem(TWO_STATE_KEY, on ? "1" : "0"); } catch (e) {} }
  // shared selection dispatch for an editable field node (instance slot / nav / field)
  function selectFieldNode(node) {
    var card = node.closest("[data-instance]");
    if (card) { setSelection("instance", card); return; }
    if (node.__block && node.__block.type === "navButton") { setSelection("navButton", node); return; }
    setSelection("field", node);
  }
  // two-state: turn a selected text node into an actively-edited one (caret at end)
  function enterTextEdit(node) {
    node.setAttribute("contenteditable", "true");
    node.classList.add("is-text-editing");
    node.focus();
    try {
      var r = document.createRange(); r.selectNodeContents(node); r.collapse(false);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (e) {}
  }
  // ticket 11/13: the top-level canvas block a field node belongs to (the sync granularity is the
  // top-level block by stable id). Used to drive collab lock/edit events off the edit lifecycle.
  function collabBlockOf(node) {
    var cb = node && node.closest && node.closest(".canvas-block");
    return (cb && cb.__block) || (node && node.__block) || null;
  }
  // ticket 11 AC2: the caret's character offset within an editable field (for a remote cursor).
  // Best-effort + guarded -> null if unavailable, so the render falls back to a block-corner flag.
  function caretOffsetIn(node) {
    try {
      var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
      var r = sel.getRangeAt(0); if (!node.contains(r.endContainer)) return null;
      var pre = document.createRange(); pre.selectNodeContents(node); pre.setEnd(r.endContainer, r.endOffset);
      return pre.toString().length;
    } catch (e) { return null; }
  }
  function enableEditing(root) {
    // locked blocks: mark them (editor.css lays a click-shield) and skip all
    // editing/selection wiring below, so they can't be moved or edited on the
    // canvas — unlock from the inspector (reachable via the Structure outliner).
    Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (n) {
      if (n.__block && n.__block.locked) { n.setAttribute("data-locked", "true"); n.style.position = "relative"; }
      // §12 slice 0: stamp the stable comment-anchor id on the node for hit-testing
      // (editor-chrome — render never emits it, so the export stays clean).
      if (n.__block && n.__block.cid) n.setAttribute("data-cid", n.__block.cid);
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-edit]"), function (node) {
      if (blockLocked(node)) return;
      // a locked card instance can't have its slot text edited inline (mirrors a
      // locked block); unlock from the inspector's Block-actions footer.
      var lockedCard = node.closest("[data-instance]");
      if (lockedCard && lockedCard.__instance && lockedCard.__instance.locked) return;
      node.classList.add("is-editable");
      node.setAttribute("spellcheck", "false");
      node.addEventListener("focus", function () { History.beginEpisode(); selectFieldNode(node); if (typeof CollabChrome !== "undefined") CollabChrome.onEditFocus(collabBlockOf(node)); }); // collab: implicit lock acquire on edit-intent (server mode only)
      node.addEventListener("input", function () {
        History.pushOnce(); // one undo step per typing burst, not one per keystroke
        var rich = node.getAttribute("data-rich");
        writeModel(node, rich ? node.innerHTML : node.textContent);
        scheduleSpellcheck(); // P0: re-check typos as the author types
        var key = node.getAttribute("data-edit");
        if (!rich && panelFields[key] && panelFields[key].value !== node.textContent) panelFields[key].value = node.textContent;
        if (typeof CollabChrome !== "undefined") { CollabChrome.onEditCommit(collabBlockOf(node)); CollabChrome.onCaret(collabBlockOf(node), caretOffsetIn(node)); } // collab: fan the edit out (debounced) + share the caret (throttled)
      });
      node.addEventListener("keyup", function () { if (typeof CollabChrome !== "undefined") CollabChrome.onCaret(collabBlockOf(node), caretOffsetIn(node)); }); // collab: caret moves (arrows/click) without an edit
      node.addEventListener("blur", function () { if (typeof CollabChrome !== "undefined") CollabChrome.onEditBlur(collabBlockOf(node)); }); // collab: auto-release the lock on blur (server mode only)
      // Paste as PLAIN TEXT by default: the browser's default contenteditable paste
      // drags the SOURCE's rich HTML (fonts/colours/spans + even a copied canvas
      // block's editor chrome) into the field, overriding its style. Instead strip to
      // text/plain and insert it so pasted words INHERIT the target element's own
      // formatting + named styleRef. execCommand("insertText") replaces the selection
      // and fires `input`, so the normal writeModel path commits + pushes history.
      node.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = "";
        try { text = (e.clipboardData || window.clipboardData).getData("text/plain"); } catch (_) {}
        if (window.__sanitizeText) text = window.__sanitizeText(text); // strip invisible/mojibake chars too
        if (!text) return;
        // Paste-clean into a bullet list: each non-empty line -> a clean <li>, stripping a
        // leading bullet char pasted from Word / Confluence / plain text.
        if (caretInList(node)) {
          var esc = function (t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
          var lines = text.split(/\r?\n/).map(function (l) {
            return l.replace(/^[\s ]*[•‣◦⁃∙▪●–—→✓*\-o]?[\s ]+/, "").replace(/\s+$/, "");
          }).filter(function (l) { return l.trim(); });
          if (lines.length) {
            document.execCommand("insertHTML", false, lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join(""));
            writeModel(node, node.innerHTML);
            return;
          }
        }
        document.execCommand("insertText", false, text);
      });
      // rich fields allow line breaks (Shift+Enter too); plain fields commit on Enter.
      // Two-state: Escape exits edit back to the selected (no-caret) state.
      node.addEventListener("keydown", function (e) {
        // Tab / Shift+Tab in a bullet list nests / un-nests the current item (execCommand
        // indent/outdent wraps it in a child <ul>); commit the new HTML to the model.
        if (e.key === "Tab" && caretInList(node)) {
          e.preventDefault();
          document.execCommand(e.shiftKey ? "outdent" : "indent");
          writeModel(node, node.innerHTML);
          return;
        }
        if (e.key === "Enter" && !node.getAttribute("data-rich")) { e.preventDefault(); node.blur(); }
        else if (e.key === "Escape" && twoStateText()) { e.preventDefault(); node.blur(); }
      });
      if (twoStateText()) {
        // SSS two-state: not editable until double-click; single-click just selects.
        node.setAttribute("contenteditable", "false");
        node.addEventListener("mousedown", function (e) {
          if (node.getAttribute("contenteditable") === "true") return; // already editing -> normal caret
          e.preventDefault(); selectFieldNode(node); // select the block WITHOUT dropping a caret
        });
        node.addEventListener("dblclick", function () { enterTextEdit(node); });
        node.addEventListener("blur", function () {
          flushSave(); node.setAttribute("contenteditable", "false"); node.classList.remove("is-text-editing");
          // §74 rule 3: exiting edit (Escape/blur, NOT a drill-driven reselect) drops
          // the drill pointer from the "edit" leaf back to the "field" level, so the
          // next Escape steps further out (edit -> block -> container).
          if (!applyingDrill) drill.index = SEL.settleAfterRerender(drill);
          updateDragAffordance(); // exited edit -> the selected block is draggable again
        });
      } else {
        // current behaviour: always editable, click = caret.
        node.setAttribute("contenteditable", "true");
        node.addEventListener("blur", function () { flushSave(); });
      }
    });
    Array.prototype.forEach.call(root.querySelectorAll("[data-instance]"), function (card) {
      card.addEventListener("mousedown", function (e) { if (e.target === card) setSelection("instance", card); });
    });
    // embed blocks are opaque — clicking the block (not inside its iframe) selects
    // it; content-filled iframes eat clicks, so the Structure outliner is the
    // reliable way to select those.
    Array.prototype.forEach.call(root.querySelectorAll("[data-embed]"), wireEmbedNode);
    Array.prototype.forEach.call(root.querySelectorAll("[data-hotspot-block]"), wireHotspotNode);

    // Wire up direct canvas drag-and-drop & drop targets on the canvas blocks
    Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (node) {
      var block = node.__block;
      if (!block) return;
      if (block.locked) return; // locked: no drag handle, no click-select (unlock via inspector)

      var pageEl = node.closest(".page");
      if (!pageEl) return;
      var pageId = pageEl.getAttribute("data-page-id");
      var pi = pageIndexById(pageId);
      if (pi === -1) return;

      // A columns row gets page-level top/bottom edge bands (AA) but no box/drag
      // handle of its own; a group is an invisible container with neither.
      if (block.type === "columns") { attachColumnsEdgeBands(node, block, pi); attachColumnResizers(node, block); attachColumnSwaps(node, block); attachEmptyColumnDrops(node, block); return; }
      if (block.type === "group") return; // no box of its own

      // Hotspot popover-card content is a FULL editing container (parity with
      // accordion / card-reveal children): its blocks are drop targets AND
      // draggable, so blocks can be dragged INTO the card and reordered.
      // findBlockParent resolves hotspots[].blocks, so a move/drop splices into the
      // right array (a left/right column-wrap safely no-ops inside the overlay).
      // 1. Make this block a drop target
      makeDropTarget(node, { targetBlock: block });
      // 1a. Image blocks also accept an external image FILE dropped from the desktop.
      if (block.type === "image") attachImageFileDrop(node, block);

      // 1b. Direct click-to-select for blocks with no editable text / instance /
      // embed of their own (image, divider, spacer, card frame). Guarded so it
      // never steals a click that a nested block, editable text, instance, embed
      // or the drag handle should own, and never fights the multi-select
      // (Shift/Cmd) capture handler.
      node.addEventListener("mousedown", function (e) {
        if (e.shiftKey || e.metaKey || e.button !== 0) return;
        if (e.target.closest(".canvas-drag-handle, [data-edit], [data-instance], [data-embed]")) return;
        if (e.target.closest(".canvas-block") !== node) return; // a nested block owns it
        e.stopPropagation();
        selectByType(node, block);
      });

      node.style.position = "relative";

      // Shared move-drag payload — identical to the old gripper's, so every drop /
      // reorder path (makeDropTarget / handleDrop) is untouched. Alt = duplicate.
      function startBlockDrag(e) {
        setDragPayload({ kind: "move", page: pi, block: block, duplicate: e.altKey });
        e.dataTransfer.effectAllowed = e.altKey ? "copy" : "move";
        try { e.dataTransfer.setData("text/plain", ""); } catch (_) {}
        node.classList.add("is-dragging");
        document.body.classList.add("is-dragging-block");
      }
      function endBlockDrag() {
        node.classList.remove("is-dragging");
        clearDropMarks();
        setDragPayload(null);
        document.body.classList.remove("is-dragging-block");
      }

      if (twoStateText()) {
        // §74 PHASE 2: NO gripper. The block body itself is the drag surface, but
        // draggable is toggled ON only when the block is SELECTED (updateDragAffordance,
        // on every selection change) — so first click selects, a press-drag on the
        // selected block MOVES it. draggable is cleared while editing text so
        // the caret / text-selection still works.
        node.addEventListener("dragstart", function (e) {
          if (node.getAttribute("draggable") !== "true") { e.preventDefault(); return; }
          if (isTextTarget(e.target)) { e.preventDefault(); return; } // editing -> select text, don't move
          startBlockDrag(e);
        });
        node.addEventListener("dragend", endBlockDrag);
      } else {
        // Click-to-edit escape hatch keeps the gripper handle (unchanged behaviour).
        if (node.querySelector(".canvas-drag-handle")) return;
        var handle = h("div", "canvas-drag-handle", "⠿");
        handle.setAttribute("draggable", "true");
        handle.setAttribute("contenteditable", "false");
        handle.title = "Drag to reorder or move side-by-side";
        handle.addEventListener("dragstart", startBlockDrag);
        handle.addEventListener("dragend", endBlockDrag);
        node.appendChild(handle);
        node.classList.add("canvas-block-wrapper");
      }
    });

    // Flip cards: only one face is visible at a time, so give each card an
    // editor-only flip toggle to author the hidden side in place (WYSIWYG — the
    // canvas flips exactly like the learner card). View state lives in the
    // flipEditBack WeakSet keyed on the item object, so it survives mount()
    // rebuilds but never touches the doc (nothing ships in the export).
    Array.prototype.forEach.call(root.querySelectorAll('.card-reveal[data-reveal-style="flip"]'), function (grid) {
      var block = grid.__block;
      if (!block || !Array.isArray(block.items)) return;
      Array.prototype.forEach.call(grid.querySelectorAll(".card-reveal__card"), function (card) {
        var item = block.items[parseInt(card.getAttribute("data-cr-index"), 10)];
        if (!item) return;
        if (flipEditBack.has(item)) card.classList.add("is-revealed");
        var btn = h("button", "card-flip-edit");
        btn.type = "button";
        btn.setAttribute("contenteditable", "false");
        btn.setAttribute("draggable", "false");
        btn.title = "Flip to edit the other side";
        btn.innerHTML = Icon("refresh-cw");
        btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
        btn.addEventListener("click", function (e) {
          e.stopPropagation(); e.preventDefault();
          if (flipEditBack.has(item)) { flipEditBack.delete(item); card.classList.remove("is-revealed"); }
          else { flipEditBack.add(item); card.classList.add("is-revealed"); }
        });
        card.appendChild(btn);
      });
    });
    wireItemBodyDrops(root); // #134: every card/side body (incl. empty) accepts dropped blocks
    scheduleSpellcheck(); // P0: (re)mark typos after every canvas render (mount / reapplyStructural)
  }
  // Which flip cards are currently edit-flipped to their back (Side 2). Editor view
  // state only — keyed on the live item object, so it survives mount() but is never
  // serialised into the doc or the export.
  var flipEditBack = new WeakSet();
  // A transparent shield over each embed: keeps wheel/pan/zoom on the CANVAS
  // (an iframe would otherwise swallow the wheel and the browser would page-zoom),
  // makes the block reliably selectable, and double-click "enters" the embed to
  // actually interact with it (shield goes pointer-through until you click away).
  function wireEmbedNode(node) {
    var shield = document.createElement("div");
    shield.className = "embed__shield";
    shield.title = "Click to select · double-click to interact";
    shield.addEventListener("mousedown", function (e) { e.stopPropagation(); setSelection("embed", node); });
    shield.addEventListener("dblclick", function (e) { e.stopPropagation(); node.classList.add("is-interactive"); });
    node.appendChild(shield);
  }

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

  // reselect a block after a mount(), using its natural selection type.
  function interactReselect(block) { reselectBlockNode(block, getSelectionTypeForBlock(block)); }

  // add a {click -> goto:pageId} interaction (mints an id). Used by the drag-to-
  // link gesture and the connection handle.
  function addGotoInteraction(block, pageId) {
    ensureId(block);
    block.interactions = block.interactions || [];
    block.interactions.push({ trigger: { type: "click" }, action: { type: "goto", target: pageId } });
  }

  // connection handle: in Interact mode the selected element sprouts a small
  // handle you drag onto a target page to author a goto (SPEC §6 drag-to-link).
  function decorateInteractHandle() {
    Array.prototype.forEach.call(canvas.querySelectorAll(".interact-handle"), function (n) { n.parentNode.removeChild(n); });
    var block = interactBlock(); if (!block) return;
    var node = canvasNodeForBlock(block); if (!node) return;
    if (!node.style.position) node.style.position = "relative";
    var handle = h("div", "interact-handle");
    handle.title = "Drag onto a page to link (go to)";
    handle.setAttribute("contenteditable", "false");
    handle.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); startInteractLink(block, node); });
    node.appendChild(handle);
  }

  var ACTION_TYPES = [
    ["Go to page", "goto"], ["Next page", "next"], ["Previous page", "prev"],
    ["Show element", "show"], ["Hide element", "hide"],
    ["Enable element", "enable"], ["Toggle element", "toggle"],
    ["Exit course", "exit"]
  ];
  // TARGETLESS actions: they carry no page/element target, so switching to one
  // clears any stale target and the inspector shows no target picker. (goto has a
  // page target; show/hide/enable/toggle have an element target; next/prev/exit none.)
  var NAV_ACTIONS = { next: 1, prev: 1, exit: 1 };

  // resolve the selected element for the interaction editor. Works for any
  // selection that carries a block (field / block / navButton / embed).
  function interactBlock() {
    if (selection && selection.block) return selection.block;
    if (selection && selection.node && selection.node.__block) return selection.node.__block; // navButton etc.
    return null;
  }

  function renderInteractInspector() {
    var block = interactBlock();
    var head = h("div", "prop-component prop-component--interact");
    head.appendChild(h("span", null, block ? blockLabel(block) : "Interact"));
    if (block && block.id) head.appendChild(h("span", "insp-tag", block.id));
    inspector.appendChild(head);

    // Connectors are contextual to the selection by default; this flips to the
    // full overview. Always shown (even with nothing selected) so you can survey
    // every link when wanted, then clear it to zero back in on one component.
    switchRow("Show all connections", function () { return showAllConnectors; }, function (v) {
      showAllConnectors = v;
      try { localStorage.setItem(SHOW_ALL_CONNECTORS_KEY, v ? "1" : "0"); } catch (e) {}
      drawConnectors();
    });

    if (!block) {
      inspector.appendChild(h("div", "insp-hint", "Interact mode. Select an element on the canvas to see its links (blue arrows = navigation, grey dashed + lock = gates). Turn on “Show all connections” for the full overview."));
      return;
    }
    if (picking) inspector.appendChild(h("div", "insp-hint insp-hint--picking", "Click an element on the canvas to set the " + (picking.label || "target") + "  ·  Esc to cancel"));

    renderOnClickSection(block);
    renderGateSection(block);
  }

  // ---- "On click ->" action list -------------------------------------------
  function renderOnClickSection(block) {
    var list = block.interactions || [];
    inspector.appendChild(propHeader("On click", function () {
      pushHistory();
      ensureId(block);
      block.interactions = block.interactions || [];
      block.interactions.push({ trigger: { type: "click" }, action: { type: "next" } });
      mount(); interactReselect(block);
    }, "Add a click action"));

    if (!list.length) {
      inspector.appendChild(h("div", "insp-hint", "No click actions. Add one, or drag the handle on the element onto a target page to link."));
    }

    list.forEach(function (ix, idx) {
      var a = ix.action || (ix.action = { type: "next" });
      var rowHead = h("div", "insp-int-row");
      rowHead.appendChild(h("span", "insp-int-row__idx", "Action " + (idx + 1)));
      var del = iconBtn("trash", "Remove this action", true);
      del.addEventListener("click", function () {
        pushHistory();
        block.interactions.splice(idx, 1);
        if (!block.interactions.length) delete block.interactions;
        mount(); interactReselect(block);
      });
      rowHead.appendChild(del);
      inspector.appendChild(rowHead);

      // action type
      selectRow("Do", ACTION_TYPES, a.type || "next", function (v) {
        a.type = v;
        // reset the now-irrelevant target so stale ids never linger
        if (v === "goto") { if (a.target && !pageById(a.target)) delete a.target; }
        else if (NAV_ACTIONS[v]) { delete a.target; }
        mount(); interactReselect(block);
      });

      if (a.type === "goto") {
        var pageOpts = [["— pick page —", ""]].concat(doc.pages.map(function (p) { return [pageDisplayName(p, doc), p.id]; }));
        selectRow("Target page", pageOpts, a.target || "", function (v) {
          if (!v) delete a.target; else a.target = v;
          mount(); interactReselect(block);
        });
      } else if (!NAV_ACTIONS[a.type]) {
        // element-target action: dropdown of this page's blocks + click-to-pick.
        buildTargetPicker(block, a, "Target element");
      }
    });
  }

  // dropdown-of-labels + "pick on canvas" for an element target/source. `holder`
  // is the object owning the `field`; picking/choosing mints the target's id.
  function buildTargetPicker(sourceBlock, holder, label, field) {
    field = field || "target";
    var pi = findPageOfBlock(sourceBlock);
    var candidates = pageBlockCandidates(pi, sourceBlock);
    var opts = [["— pick element —", ""]].concat(candidates.map(function (b, i) {
      return [blockLabel(b) + (b.id ? "" : ""), b.id || ("new:" + i)];
    }));
    selectRow(label, opts, holder[field] || "", function (v) {
      if (!v) { delete holder[field]; }
      else {
        var tb = v.indexOf("new:") === 0 ? candidates[parseInt(v.slice(4), 10)]
          : candidates.filter(function (b) { return b.id === v; })[0];
        if (tb) { ensureId(tb); holder[field] = tb.id; }
      }
      mount(); interactReselect(sourceBlock);
    });
    var pick = h("button", "prop-btn", "Pick on canvas");
    pick.title = "Then click the target element on the canvas";
    pick.addEventListener("click", function () {
      startPick(label.toLowerCase(), function (picked) {
        if (picked === sourceBlock) { endPick(); renderInspector(); return; }
        pushHistory(); ensureId(picked); holder[field] = picked.id;
        mount(); interactReselect(sourceBlock);
      });
      renderInspector(); // reflect the "click an element" hint immediately
    });
    inspector.appendChild(pick);
    if (holder[field]) {
      var tgt = blockById(holder[field]);
      inspector.appendChild(h("div", "insp-hint", tgt ? ("Targets “" + blockLabel(tgt) + "”.") : "Target element no longer exists."));
    }
  }

  // ---- "Locked until ->" reactive gate -------------------------------------
  var IS_OPTIONS = [["visited", "visited"], ["watched", "watched"], ["checked", "checked"]];
  function renderGateSection(block) {
    var _gateRoot = inspector;
    var on = !!block.gate;
    // uio-O-W2 (OVL-07): the gate's own on/off is the SECTION's switch, not a "Gate" row one
    // line under a heading that said the same thing. Off, the section states so and stops --
    // there is no configuration to keep, because turning it off deletes the gate.
    _gateRoot.appendChild(sectionGroup(null, "Locked until", function (gateBody) {
    var _gins = inspector; inspector = gateBody;
    try {
    if (!on) {
      inspector.appendChild(h("div", "insp-hint", "Off. Turn on to keep this element locked (greyed or hidden) until a condition is met."));
      return;
    }
    var g = block.gate;

    segmentedLive("When locked", [["disable", "disable"], ["hide", "hide"]], function (v) { return (g.mode || "disable") === v; }, function (v) {
      g.mode = v; mount(); interactReselect(block);
    });

    // conditions (allOf). A single condition is stored bare; two+ become allOf.
    var conds = gateConditionList(g);
    conds.forEach(function (c, ci) {
      var rowHead = h("div", "insp-int-row");
      rowHead.appendChild(h("span", "insp-int-row__idx", conds.length > 1 ? ("Condition " + (ci + 1)) : "Condition"));
      if (conds.length > 1) {
        var del = iconBtn("trash", "Remove this condition", true);
        del.addEventListener("click", function () { pushHistory(); removeGateCondition(g, ci); mount(); interactReselect(block); });
        rowHead.appendChild(del);
      }
      inspector.appendChild(rowHead);
      buildTargetPicker(block, c, "Source element", "source");
      selectRow("Is", IS_OPTIONS, c.is || "visited", function (v) { c.is = v; mount(); interactReselect(block); });
    });
    var addCond = h("button", "prop-btn", "+ Add condition (all of)");
    addCond.addEventListener("click", function () { pushHistory(); addGateCondition(g); mount(); interactReselect(block); });
    inspector.appendChild(addCond);

    inspector = panelSection(gateBody, "Hint + completion");
    // hint writes live (no rebuild) so the field keeps focus while typing.
    var hintRow = h("div", "insp-row"); hintRow.appendChild(h("span", "insp-row__label", "Hint"));
    var hintIn = h("input", "prop-text"); hintIn.type = "text"; hintIn.spellcheck = false;
    hintIn.placeholder = "e.g. Watch the video to continue";
    hintIn.value = g.hint || "";
    hintIn.addEventListener("input", function () { if (hintIn.value) g.hint = hintIn.value; else delete g.hint; renderModelView(); });
    hintRow.appendChild(hintIn); inspector.appendChild(hintRow);

    switchRow("Required to complete", function () { return !!g.required; }, function (v) {
      if (v) g.required = true; else delete g.required;
      mount(); interactReselect(block);
    });
    inspector.appendChild(h("div", "insp-hint", "Required gates must be satisfied (plus every page visited) before the course reports complete."));
    } finally { inspector = _gins; }
    }, {
      key: "gate.lockedUntil",
      toggle: {
        get: function () { return !!block.gate; },
        set: function (v) {
          if (v) { ensureId(block); block.gate = block.gate || { mode: "disable", when: { source: "", is: "visited" } }; }
          else { delete block.gate; }
          mount(); interactReselect(block);
        }
      },
      summary: function () { return block.gate ? ((block.gate.mode || "disable") === "hide" ? "hidden until met" : "greyed until met") : ""; }
    }));
  }

  // normalise gate.when into an editable array of {source,is} conditions.
  function gateConditionList(g) {
    if (!g.when) { g.when = { source: "", is: "visited" }; return [g.when]; }
    if (g.when.allOf) return g.when.allOf;
    return [g.when];
  }
  function addGateCondition(g) {
    var list = gateConditionList(g);
    var next = { source: "", is: "visited" };
    if (g.when.allOf) g.when.allOf.push(next);
    else g.when = { allOf: [g.when, next] };
  }
  function removeGateCondition(g, ci) {
    if (!g.when.allOf) { g.when = { source: "", is: "visited" }; return; }
    g.when.allOf.splice(ci, 1);
    if (g.when.allOf.length === 1) g.when = g.when.allOf[0];
  }

  // find a block anywhere in the doc by its id (for target/source labels).
  function blockById(id) {
    var found = null;
    doc.pages.forEach(function (p) { walkPageBlocks(p.blocks, function (b) { if (b.id === id) found = b; }); });
    return found;
  }

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

  // ---- build the multi-frame world -----------------------------------------
  // Frames render at FULL content length (no internal scroll). A fold marker
  // ---- JJJJ: page drag-reparent (drag a page by its label into a column) ----
  var pageDragSuppressClick = false;
  function pointerCol(clientX) {
    var r = canvas.getBoundingClientRect();
    var worldX = (clientX - r.left - view.x) / view.zoom;
    return Math.floor(worldX / (FRAME_W + GAP_X));
  }
  function dropPageToCol(pi, col) {
    var sorted = (doc.chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var page = doc.pages[pi]; if (!page) return;
    var targetId;
    if (col >= sorted.length) targetId = createChapter();      // dropped on the "+ Chapter" slot -> new chapter
    else if (col >= 0) targetId = sorted[col].id;
    else return;
    if (page.chapterId === targetId) { mount(); setSelection("page", doc.pages.indexOf(page)); return; }
    pushHistory();
    var np = moveToChapter(pi, targetId);
    mount(); setActivePage(np); setSelection("page", np);
  }
  function wirePageDrag(label, pi) {
    label.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      var sx = e.clientX, sy = e.clientY, dragging = false, indicator = null, dropCol = 0;
      function onMove(ev) {
        if (!dragging) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
          dragging = true; document.body.classList.add("is-dragging-page");
          indicator = h("div", "page-drop-col"); world.appendChild(indicator);
        }
        var maxCol = (doc.chapters || []).length; // last index = the "+ Chapter" slot
        dropCol = Math.max(0, Math.min(pointerCol(ev.clientX), maxCol));
        indicator.style.left = colX(dropCol) + "px"; indicator.style.width = FRAME_W + "px";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("is-dragging-page");
        if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
        if (dragging) { pageDragSuppressClick = true; setTimeout(function () { pageDragSuppressClick = false; }, 0); dropPageToCol(pi, dropCol); }
      }
      document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
    });
  }

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
    world = h("div", "world");
    frameDescs = [];
    var deviceH = BREAKPOINTS[activeBp].h;
    var renderDoc = currentDoc(); // base doc, or the resolved doc when previewing a variant
    // Geometry cell drives the frame container (reflow / frame / paged). Untagged/legacy docs
    // resolve to reflow via the doc-type model -> today's canvas, unchanged.
    _worldGeo = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(renderDoc).geo : "reflow";
    world.classList.add(worldGeoClass(_worldGeo));

    // JJJJ: group pages into chapter COLUMNS; each page's column X is known now
    // (its row Y is set after measure in layoutColumns). page.id -> {col,row}.
    var chapters = (window.groupPagesByChapter ? window.groupPagesByChapter(renderDoc) : [{ pages: renderDoc.pages }]);
    // arch-P1: the whole per-pass render context (nav, styles, gates, motion, glossary) comes
    // from ONE builder the export calls too, so the canvas and the shipped package cannot
    // disagree about what render sees. src/render-context.js.
    window.applyRenderContext(window.buildRenderContext(renderDoc));
    _numCols = Math.max(1, chapters.length);
    framePos = [];
    var colRowById = {};
    chapters.forEach(function (ch, c) { (ch.pages || []).forEach(function (p, r) { colRowById[p.id] = { col: c, row: r }; }); });
    world.style.width = worldW() + "px";

    // YY: swap asset refs -> objectURL/data: on the doc for the duration of the
    // render, then restore, so node.__block keeps pointing at the real doc blocks
    // (editing depends on it) and the stored doc keeps its lean "asset:<id>" refs.
    var __restoreMedia = (window.resolveMedia && window.AssetStore) ? window.resolveMedia(renderDoc, editorAssetResolve) : null;
    try {
    renderDoc.pages.forEach(function (page, i) {
      var loc = colRowById[page.id] || { col: 0, row: i };
      framePos[i] = { x: colX(loc.col), y: 0, col: loc.col, row: loc.row };
      var wrap = h("div", "frame-wrap");
      wrap.style.left = framePos[i].x + "px"; wrap.style.top = "0px"; wrap.style.width = FRAME_W + "px";
      var label = h("div", "frame-label" + (i === currentPage ? " is-active" : ""));
      label.appendChild(h("span", "frame-label__name", pageDisplayName(page, doc)));
      label.addEventListener("click", function () { if (pageDragSuppressClick) return; focusFrame(i); setActivePage(i); setSelection("page", i); });
      label.addEventListener("contextmenu", (function (pi, pg) { return function (e) {
        e.preventDefault(); e.stopPropagation();
        // Previewing a variant shows resolved clones -> don't mutate page structure.
        if (activeVariant) {
          showContextMenu(e.clientX, e.clientY, [
            { head: "Previewing: " + activeVariant },
            { label: "Switch to Flagship to edit pages", onClick: function () { previewVariant(null); } }
          ]);
          return;
        }
        focusFrame(pi); setActivePage(pi); setSelection("page", pi);
        var items = [{ head: pg.name || "Page" }];
        items.push({ label: "Copy page", onClick: function () { setSelection("page", pi); copySelection(); } });
        if (pageClipboard) items.push({ label: "Paste page after", onClick: function () { currentPage = pi; pastePage(); } });
        items.push({ label: "Duplicate page", onClick: function () { duplicatePage(pi); } });
        if (hasMergeableNext(pi)) items.push({ label: "Merge with next page", onClick: function () { mergePageWithNext(pi); } });
        items.push({ label: "Save page to library…", onClick: function () { savePageAsLibraryMaster(pi); } });
        if (doc.pages.length > 1) {
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
      frame.style.width = FRAME_W + "px";
      frame.style.minHeight = deviceH + "px"; // every frame is at least one full device screen
      frame.style.setProperty("--vp-h", deviceH + "px"); // fill-layout viewport ref (auto spacers); exported course falls back to 100vh
      frame.style.backgroundColor = activeTheme().color.bg;
      var cr = window.renderPage(page, activeTheme(), window.resolveHeaderFooter(renderDoc, page));
      cr.setAttribute("data-bp", activeBp);   // course.css responsive rules key off this
      cr.setAttribute("data-mode", activeMode); // logo auto-tint keys off this
      applyLayoutVars(cr, page);              // master page padding (+ per-page override)
      frame.appendChild(cr);

      // fold marker at the device viewport height (clipped by frame if content
      // is shorter than a screenful, i.e. only shows when there IS a fold)
      var fold = h("div", "fold-line");
      fold.style.top = deviceH + "px";
      fold.appendChild(h("span", "fold-line__label", cap(activeBp) + " fold · " + deviceH + "px"));
      frame.appendChild(fold);

      // Alignment grid overlay on the ACTIVE page only (editor chrome; see refreshGridOverlay)
      if (i === currentPage && gridMode !== "off") frame.appendChild(makeGridOverlay());

      makeDropTarget(frame, (function (pi) { return function () { return { pageIndex: pi, append: true }; }; })(i), "drop-into");

      wrap.appendChild(label); wrap.appendChild(frame);
      world.appendChild(wrap);
      frameDescs.push({ wrap: wrap, frame: frame, label: label, i: i });
    });
    } finally { if (__restoreMedia) __restoreMedia(); }

    // JJJJ: a header bar atop each chapter COLUMN (name + page count; double-click
    // to rename). Empty chapters still show a header so they're a visible column.
    chapters.forEach(function (ch, c) {
      var hdr = h("div", "chapter-header");
      hdr.style.left = colX(c) + "px"; hdr.style.top = "0px"; hdr.style.width = FRAME_W + "px";
      hdr.appendChild(h("span", "chapter-header__name", ch.name || "Chapter"));
      var n = ch.pages ? ch.pages.length : 0;
      hdr.appendChild(h("span", "chapter-header__count", n + (n === 1 ? " page" : " pages")));
      hdr.title = "Click to fit this chapter · double-click to rename";
      hdr.addEventListener("click", (function (col) { return function () { fitChapter(col); }; })(c));
      hdr.addEventListener("dblclick", function () {
        if (!ch.id) return;
        promptModal("Rename chapter", "Name", ch.name || "", function (nm) {
          if (nm == null) return;
          var real = (doc.chapters || []).filter(function (x) { return x.id === ch.id; })[0];
          if (real) { pushHistory(); real.name = nm; mount(); }
        });
      });
      if (ch.id) {
        var acts = h("div", "chapter-header__acts");
        function chBtn(glyph, title, danger, fn) {
          var b = h("button", "chapter-header__btn" + (danger ? " chapter-header__btn--danger" : ""), glyph);
          b.type = "button"; b.title = title;
          b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
          return b;
        }
        acts.appendChild(chBtn("‹", "Move chapter left", false, function () { pushHistory(); if (reorderChapter(ch.id, -1)) mount(); }));
        acts.appendChild(chBtn("›", "Move chapter right", false, function () { pushHistory(); if (reorderChapter(ch.id, 1)) mount(); }));
        acts.appendChild(chBtn("×", "Delete chapter (pages move to the previous chapter)", true, function () {
          confirmModal("Delete chapter", "Delete chapter “" + (ch.name || "") + "”? Its pages move to the previous chapter.", function () { pushHistory(); if (deleteChapter(ch.id)) mount(); }, { okLabel: "Delete", danger: true });
        }));
        hdr.appendChild(acts);
      }
      world.appendChild(hdr);
    });

    // JJJJ: "+ Chapter" affordance in the next column slot -> creates an empty chapter.
    var addCh = h("div", "chapter-header chapter-header--add");
    addCh.style.left = colX(chapters.length) + "px"; addCh.style.top = "0px"; addCh.style.width = FRAME_W + "px";
    addCh.appendChild(h("span", "chapter-header__name", "+ Chapter"));
    addCh.title = "Add a chapter (empty column)";
    addCh.addEventListener("click", function () {
      promptModal("New chapter", "Name", "Chapter " + ((doc.chapters || []).length + 1), function (nm) {
        if (nm == null) return;
        pushHistory(); createChapter((nm || "").trim() || undefined); mount();
      });
    });
    world.appendChild(addCh);
    // widen the world so the + column is reachable
    world.style.width = (colX(chapters.length) + FRAME_W) + "px";
    observeFrames(); // re-stack the column whenever a frame's height settles (images / embeds / font swap)
    return world;
  }

  // JJJJ: measure frame heights (must be in the DOM), then stack each chapter
  // COLUMN vertically (independent masonry stacks) -- sets framePos[i].y + each
  // wrap.top + worldH. Runs before connectors so their geometry is correct.
  function layoutColumns() {
    var colY = [];
    frameDescs.forEach(function (f) {
      f.h = f.frame.offsetHeight;
      var c = (framePos[f.i] && framePos[f.i].col) || 0;
      if (colY[c] == null) colY[c] = CHAPTER_HEADER_H; // leave room for the chapter header bar
      if (framePos[f.i]) framePos[f.i].y = colY[c];
      f.wrap.style.top = colY[c] + "px";
      colY[c] += LABEL_H + f.h + GAP_Y;
    });
    var maxH = 0;
    colY.forEach(function (y) { if (y != null && y - GAP_Y > maxH) maxH = y - GAP_Y; });
    worldH = maxH || FRAME_H;
    world.style.height = worldH + "px";
    // SPEC 7: in fixed-frame geometry a page is clipped to one screen -- flag any frame whose
    // content overflows so the canvas shows the amber warning (never silently spawns a slide).
    // Measured here (post-attach) before culling, alongside the height reads above.
    if (_worldGeo === "frame") frameDescs.forEach(function (f) {
      if (f.frame) f.frame.classList.toggle("is-overflowing", frameContentOverflows(f.frame.scrollHeight, f.frame.clientHeight));
    });
    // Perf (#150): now that the TRUE heights are measured + stacked, pin each frame's
    // contain-intrinsic-size to its measured height and enable content-visibility:auto,
    // so the browser SKIPS painting + laying-out pages scrolled out of the viewport. The
    // stacking above already used the real measured f.h, and the intrinsic-size equals
    // that height, so an offscreen frame reserves exactly the right box -> the column
    // layout + world height are UNCHANGED; the frame's own bg still paints (only its
    // contents are skipped), and scrolling one into view (or any getBoundingClientRect on
    // its contents) renders it on demand. The FIRST measure runs with culling already on
    // for prior frames, but each frame's offsetHeight read forces its own layout, so the
    // seed height is always exact.
    if (FRAME_CULL) frameDescs.forEach(function (f) {
      if (!f.frame) return;
      f.frame.style.containIntrinsicSize = FRAME_W + "px " + Math.round(f.h || FRAME_H) + "px";
      f.frame.classList.add("frame--cull");
    });
  }

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
      if (world && world.isConnected) drawConnectors(); // re-measures (layoutColumns) + redraws spine/gaps
    });
  }
  function observeFrames() {
    if (!window.ResizeObserver) return;
    if (frameRO) frameRO.disconnect();
    frameRO = new ResizeObserver(scheduleRestack);
    frameDescs.forEach(function (f) { if (f.frame) frameRO.observe(f.frame); });
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
    var old = world.querySelector("svg.connectors");
    if (old) old.parentNode.removeChild(old);

    // SPEC §5: connectors show ONLY in Interact mode (Design = clean canvas).
    if (!interactMode) return;

    // CONTEXTUAL connectors (James 2026-07-09): unless "Show all connections" is on,
    // draw only the component links that TOUCH the current selection (single or
    // multi) so a dense layout stays readable. The structural page-spine (below)
    // always draws — it's the backbone, not spaghetti. A block link is relevant when
    // its source block is selected; a gate link when the gated OR source block is.
    function blockInSelection(b) {
      if (!b) return false;
      if (selection.block && b === selection.block) return true;
      return multiSel.length > 0 && multiSel.indexOf(b) !== -1;
    }

    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "connectors");
    svg.setAttribute("width", worldW()); svg.setAttribute("height", worldH);
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
    for (var i = 0; i < doc.pages.length - 1; i++) {
      if (!framePos[i] || !framePos[i + 1] || framePos[i].col !== framePos[i + 1].col) continue;
      var cxp = frameX(i) + FRAME_W / 2;
      var y1 = frameY(i) + LABEL_H + frameDescs[i].h; // bottom of page i
      var y2 = frameY(i + 1) + LABEL_H;               // top of page i+1
      var p = document.createElementNS(SVGNS, "path");
      p.setAttribute("class", "flow-link");
      p.setAttribute("d", "M" + cxp + " " + y1 + " L" + cxp + " " + y2);
      svg.appendChild(p);
    }

    // page id -> frame index; block id -> { pi, elm } (the on-canvas node).
    var idById = {};
    doc.pages.forEach(function (pg, pi) { idById[pg.id] = pi; });
    var blockLoc = {};
    frameDescs.forEach(function (f) {
      Array.prototype.forEach.call(f.frame.querySelectorAll("[data-id]"), function (elm) {
        blockLoc[elm.getAttribute("data-id")] = { pi: f.i, elm: elm };
      });
    });

    // element world-space rect via the OFFSET chain (unscaled world units) — the
    // world's zoom transform is applied AFTER drawConnectors runs, so screen
    // rects / view.zoom would be wrong here. offsetLeft/Top are transform-immune.
    function elmWorldRect(loc) {
      var frame = frameDescs[loc.pi].frame, x = 0, y = 0, c = loc.elm;
      while (c && c !== frame) { x += c.offsetLeft || 0; y += c.offsetTop || 0; c = c.offsetParent; }
      return { x: frameX(loc.pi) + x, y: frameY(loc.pi) + LABEL_H + y, w: loc.elm.offsetWidth, h: loc.elm.offsetHeight };
    }

    // ---- nav arrows: derived from REAL authored interactions (SPEC §5/§6) ----
    // Primary path = normalizeInteractions(block): covers modern block.interactions
    // AND legacy block.action.goto (SAMPLE_DOC nav buttons) in one shape, anchored
    // via the block's canvas node (no id required). Fallback = bare [data-goto]
    // elements owned by a block with NO interactions (componentGrid menu cards,
    // whose goto lives per-instance). show/hide/enable/toggle are NOT drawn.
    var imap = window.buildInteractionMap(doc); // still used by the gate pass
    function navTargetIndex(a, si) {
      if (!a) return -1;
      if (a.type === "goto") return (a.target in idById) ? idById[a.target] : -1;
      if (a.type === "next") return si + 1 < doc.pages.length ? si + 1 : -1;
      if (a.type === "prev") return si - 1 >= 0 ? si - 1 : -1;
      return -1;
    }
    var linksByFrame = {}; // pi -> [{ block, elm, ti }]
    frameDescs.forEach(function (f) {
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
        if (!showAllConnectors && !(selection.node === lk.elm || blockInSelection(lk.block))) return;
        var isForward = ti > si;
        var srcH = frameDescs[si].h || FRAME_H, tgtH = frameDescs[ti].h || FRAME_H;
        var fan = (n > 1) ? (k - (n - 1) / 2) * 24 : 0;
        var sx = frameX(si) + (isForward ? FRAME_W : 0);
        var syB = frameY(si) + LABEL_H;
        var sy = clamp(syB + srcH / 2 + fan, syB + 14, syB + srcH - 14);
        var tx = isForward ? frameX(ti) : frameX(ti) + FRAME_W;
        var ty = frameY(ti) + LABEL_H + tgtH / 2;
        var isSelected = selection.node === lk.elm || (selection.block && lk.block === selection.block);
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
        if (!showAllConnectors && !gatedSel && !srcSel) return;
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

    world.appendChild(svg); // in front of frames
  }

  // #62: on-canvas gap affordance. Hovering the empty space between two vertically
  // stacked pages IN THE SAME CHAPTER reveals two glyph buttons: Add (insert a blank
  // page in the gap) + Merge (combine the two pages into one). Rebuilt each connector
  // pass so positions stay correct; a narrow centred hover zone keeps it out of the
  // way of marquee drags. Editor chrome only — nothing renders/ships.
  function buildGapAffordances() {
    Array.prototype.forEach.call(world.querySelectorAll(".page-gap"), function (g) { g.remove(); });
    if (isPreview()) return; // structural edits are disabled while previewing a variant / translation
    for (var i = 0; i < doc.pages.length - 1; i++) {
      if (!framePos[i] || !framePos[i + 1] || framePos[i].col !== framePos[i + 1].col) continue;
      var top = frameY(i) + LABEL_H + (frameDescs[i] ? frameDescs[i].h : 0); // bottom of page i
      var zone = h("div", "page-gap");
      zone.style.left = (frameX(i) + FRAME_W / 2 - 130) + "px";
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
      world.appendChild(zone);
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

  // ---- left panel ----------------------------------------------------------
  // ---- Structure outliner: pages twirl down to their blocks ----------------
  var pageItems = [];
  var openPages = {};
  var openChapters = {}; // module G: chapter groups twirled open in the outliner (default open; false = collapsed)
  // DD: which container blocks (columns / group / frame) are twirled open in the
  // outliner. Keyed by block REF (blocks are id-less until they join an interaction,
  // so a ref Set is the stable key; survives renderStructure, resets on doc reload).
  var openContainers = (typeof Set !== "undefined") ? new Set() : { has: function () { return false; }, add: function () {}, delete: function () {} };
  var multiSel = []; // block refs multi-selected (outliner / marquee) — for grouping + fit
  var multiSelPages = []; // page indices multi-selected (marquee / outliner)
  var outlineAnchor = null; // {kind:"block",pi,bi} | {kind:"page",pi} — for Shift-range
  function inMulti(block) { return multiSel.indexOf(block) !== -1; }
  function inMultiPage(i) { return multiSelPages.indexOf(i) !== -1; }
  function toggleMulti(block) {
    var i = multiSel.indexOf(block);
    if (i === -1) multiSel.push(block); else multiSel.splice(i, 1);
    if (multiSel.length) blurActiveText(); // multi-selecting exits text edit
    renderStructure();
    refreshCanvasSelection();
  }
  function toggleMultiPage(i) {
    var k = multiSelPages.indexOf(i);
    if (k === -1) multiSelPages.push(i); else multiSelPages.splice(k, 1);
    renderStructure();
    refreshCanvasSelection();
  }
  function clearMulti() { if (multiSel.length) { multiSel = []; } }
  function clearMultiPages() { if (multiSelPages.length) { multiSelPages = []; } }
  function clearAllMulti() { clearMulti(); clearMultiPages(); }
  // the top-level page block containing an event target (so a shift-click
  // anywhere inside a block selects the whole block, not an inner leaf)
  function canvasTopBlock(target) {
    var node = target;
    while (node && node !== canvas) {
      if (node.classList && node.classList.contains("canvas-block") && node.parentElement && node.parentElement.classList.contains("page")) return node;
      node = node.parentNode;
    }
    return null;
  }
  function canvasNodeForBlock(block) {
    if (!world) return null;
    var all = world.querySelectorAll(".canvas-block");
    for (var i = 0; i < all.length; i++) if (all[i].__block === block) return all[i];
    return null;
  }
  // Encompassing outline for a selected group/card. A group is display:contents
  // (no box of its own), so we union its children's rects and draw an overlay.
  function drawContainerOutline(b) {
    var node = canvasNodeForBlock(b); if (!node) return;
    var frame = node.closest(".frame"); if (!frame) return;
    var zoom = (view && view.zoom) || 1;
    var fr = frame.getBoundingClientRect();
    var boxes = [];
    if (b.type === "frame") { boxes.push(node.getBoundingClientRect()); }
    else {
      Array.prototype.forEach.call(node.children, function (c) {
        if (c.classList && c.classList.contains("block-group__empty")) return;
        boxes.push(c.getBoundingClientRect());
      });
      if (!boxes.length) boxes.push(node.getBoundingClientRect());
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    boxes.forEach(function (r) { minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); });
    if (!isFinite(minX)) return;
    var pad = 6;
    var ol = h("div", "group-outline");
    ol.appendChild(h("div", "group-outline__label", b.type === "group" ? "Group" : "Card"));
    ol.style.left = (((minX - fr.left) / zoom) - pad) + "px";
    ol.style.top = (((minY - fr.top) / zoom) - pad) + "px";
    ol.style.width = (((maxX - minX) / zoom) + pad * 2) + "px";
    ol.style.height = (((maxY - minY) / zoom) + pad * 2) + "px";
    frame.appendChild(ol);
  }
  // redraw multi-select highlights + the encompassing group/card outline
  function refreshCanvasSelection() {
    if (!world) return;
    Array.prototype.forEach.call(world.querySelectorAll(".is-multi-canvas"), function (n) { n.classList.remove("is-multi-canvas"); });
    Array.prototype.forEach.call(world.querySelectorAll(".frame.is-multi-page"), function (n) { n.classList.remove("is-multi-page"); });
    Array.prototype.forEach.call(world.querySelectorAll(".group-outline"), function (n) { n.remove(); });
    // A 2+ multi-selection owns the highlight: drop any lingering single is-selected
    // marker (e.g. the seed block a Shift/Cmd+click promoted into the set) so the
    // canvas doesn't double-highlight one member.
    if (multiSel.length >= 2) Array.prototype.forEach.call(world.querySelectorAll(".is-selected"), function (n) { n.classList.remove("is-selected"); });
    multiSel.forEach(function (b) { var n = canvasNodeForBlock(b); if (n) n.classList.add("is-multi-canvas"); });
    multiSelPages.forEach(function (i) { var f = frameDescs[i] && frameDescs[i].frame; if (f) f.classList.add("is-multi-page"); });
    if (selection.type === "block" && selection.block && (selection.block.type === "group" || selection.block.type === "frame")) drawContainerOutline(selection.block);
    updateDragAffordance();
    // Contextual connectors depend on the current selection, so redraw them here —
    // the single choke point every selection change (single / multi / marquee /
    // outliner) routes through. Interact-mode only (connectors don't exist in Design);
    // not a mousemove hot path (all callers are discrete). The heavy rebuild paths
    // (mount / reapplyWorld / reapplyPage) also call drawConnectors directly — the
    // extra draw here is idempotent (it drops the prior SVG layer first).
    if (interactMode) drawConnectors();
  }
  // §74 PHASE 2: in select-first mode the SELECTED block's node becomes the drag
  // surface (draggable=true) so a press-drag on it moves it; every other block is
  // non-draggable, and a block being text-edited is non-draggable (caret wins).
  // columns/group have no box to grab (reorder them from the outliner), so they
  // are never made draggable — parity with the old gripper, which skipped them.
  function updateDragAffordance() {
    if (!world) return;
    var sel = null;
    if (twoStateText() && selection && selection.node &&
        (selection.type === "block" || selection.type === "field" || selection.type === "instance" ||
         selection.type === "embed" || selection.type === "navButton")) {
      var host = (selection.node.closest && selection.node.closest(".canvas-block")) || selection.node;
      var editing = world.querySelector(".is-text-editing");
      var b = host && host.__block;
      if (b && !b.locked && b.type !== "group" && b.type !== "columns" &&
          !(editing && host.contains(editing))) sel = host;
    }
    Array.prototype.forEach.call(world.querySelectorAll(".canvas-block[draggable=\"true\"]"), function (n) {
      if (n !== sel) n.removeAttribute("draggable");
    });
    if (sel) sel.setAttribute("draggable", "true");
  }
  // Group the multi-selected blocks (must share a page) into a new Frame, at the
  // position of the earliest, preserving order. This is the "select several ->
  // group -> save as component" flow.
  function groupMulti() {
    if (multiSel.length < 2) return;
    // resolve each block by REF (findBlockParent) so nested blocks resolve too. Grouping
    // needs ONE shared parent array (a group is a single node in one place): a page's top
    // level OR one column / card's children. Cross-parent -> a clear message, no silent drop.
    var locs = [];
    for (var i = 0; i < multiSel.length; i++) {
      var res = null;
      for (var pi = 0; pi < doc.pages.length; pi++) { var r = findBlockParent(doc.pages[pi].blocks, multiSel[i]); if (r) { res = r; break; } }
      if (!res) { clearMulti(); renderStructure(); return; }
      locs.push({ block: multiSel[i], parentArray: res.parentArray, index: res.index });
    }
    var pa = locs[0].parentArray;
    if (locs.some(function (l) { return l.parentArray !== pa; })) { alert("To group, select blocks with the same parent — all at the page level, or all within one column / card."); return; }
    locs.sort(function (a, b) { return a.index - b.index; });
    var insertAt = locs[0].index;
    var children = locs.map(function (l) { return l.block; });
    pushHistory();
    // remove highest index first so earlier indices stay valid
    locs.slice().sort(function (a, b) { return b.index - a.index; }).forEach(function (l) { pa.splice(l.index, 1); });
    // an INVISIBLE group (not a styled Card) — grouping must not change the look
    var frame = { type: "group", children: children };
    pa.splice(insertAt, 0, frame);
    doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
    clearMulti();
    mount();
    reselectBlockNode(frame, "block");
    return frame; // #22: lets saveSelectionAsSectionMaster capture the resulting group directly
  }
  // #22: a "section" master is just a multi-block selection, grouped then captured --
  // reuses groupMulti (already enforces the "one shared parent, adjacent" contract a
  // section needs) + saveBlockAsComponent (already works on ANY block, a group included)
  // verbatim. No new capture/render/override/axis machinery: a group's children are
  // walked by the SAME generic children-array logic every other container already uses
  // (walkTextBlocks, applyInstanceOverrides, resolveAxisNode all check node.children with
  // no type-specific branching), so overrides/axis/detach/export on a section master work
  // for free once it's a library entry -- confirmed by browser-verify, not just asserted.
  function saveSelectionAsSectionMaster() {
    var frame = groupMulti();
    if (frame) saveBlockAsComponent(frame);
  }
  // #131: merge the multi-selected TEXT blocks (>=2, all text-style types) into ONE.
  // Fold every body — in CANVAS STACK ORDER (parent-array index, NOT selection order) —
  // into the TOP block joined by line breaks, delete the rest, reselect the survivor.
  // Requires one shared parent (mirrors groupMulti): merging across columns/cards is
  // ambiguous, so bail with a clear message rather than silently drop blocks.
  function mergeTextBoxes() {
    if (!canMergeTextBoxes(multiSel)) return;
    var locs = [];
    for (var i = 0; i < multiSel.length; i++) {
      var res = null;
      for (var pi = 0; pi < doc.pages.length; pi++) { var r = findBlockParent(doc.pages[pi].blocks, multiSel[i]); if (r) { res = r; break; } }
      if (!res) { clearMulti(); renderStructure(); return; }
      locs.push({ block: multiSel[i], parentArray: res.parentArray, index: res.index });
    }
    var pa = locs[0].parentArray;
    if (locs.some(function (l) { return l.parentArray !== pa; })) { alert("To merge, select text blocks with the same parent — all at the page level, or all within one column / card."); return; }
    locs.sort(function (a, b) { return a.index - b.index; });
    var survivor = locs[0].block;
    pushHistory();
    // Fold bodies into the top block (its type/style wins), then remove the merged-in
    // blocks highest index first so earlier indices stay valid during the splice.
    survivor.text = mergeTextValues(locs.map(function (l) { return l.block.text; }));
    locs.slice(1).sort(function (a, b) { return b.index - a.index; }).forEach(function (l) { pa.splice(l.index, 1); });
    doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
    clearMulti();
    mount();
    reselectBlockNode(survivor, "block");
  }
  // #131: the multi-selection floating tool bar (canvas overlay actions segment).
  // renderInspector hides the single-block bar before the multi branch, so re-show a
  // set-scoped bar: Merge (only when the whole set is text) / Group / Delete.
  function showMultiToolbar() {
    var bar = ensureBlockToolbar();
    if (!bar) return; // canvas overlay bar not present (panels hidden)
    bar.innerHTML = "";
    if (canMergeTextBoxes(multiSel)) {
      var merge = iconBtn("merge", "Merge text boxes");
      merge.addEventListener("click", function () { mergeTextBoxes(); });
      bar.appendChild(merge);
    }
    var group = iconBtn("group", "Group selection");
    group.addEventListener("click", function () { groupMulti(); });
    bar.appendChild(group);
    bar.appendChild(h("div", "tb-sep"));
    var del = iconBtn("trash", "Delete " + multiSel.length + " items", true);
    del.addEventListener("click", function () { deleteSelection(); });
    bar.appendChild(del);
    bar.hidden = false;
    if (blockToolbarSep) blockToolbarSep.hidden = false;
  }
  // Inverse of groupMulti: unwrap a `group` block, splicing its children back
  // into the group's parent array at the group's position (order preserved).
  // Parent-resolution mirrors deleteBlockByRef, so a group nested in a column or
  // another group unwraps in place too. cleanupColumns tidies any 1-col leftovers.
  function ungroupBlock(block) {
    if (!block || block.type !== "group") return;
    var children = (block.children || []).slice();
    var loc = null;
    for (var pi = 0; pi < doc.pages.length; pi++) {
      var res = findBlockParent(doc.pages[pi].blocks, block);
      if (res) { loc = res; break; }
    }
    if (!loc) return;
    pushHistory();
    var args = [loc.index, 1].concat(children); // replace the group with its children
    loc.parentArray.splice.apply(loc.parentArray, args);
    doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
    clearSelection(); mount();
    if (children.length) { var n = canvasNodeForBlock(children[0]); if (n) selectByType(n, children[0]); }
  }
  // Issue #13 (parent #22): the DS LeftPanel block iconography — each block type
  // maps to a Lucide glyph resolved through the Icon accessor (no text glyphs).
  var BLOCK_LUCIDE = {
    heading: "heading", subheading: "type", paragraph: "align-left", quote: "quote",
    list: "list", note: "message-square-warning", image: "image", divider: "minus",
    spacer: "move-vertical", frame: "square", group: "group", componentGrid: "component",
    navButton: "navigation", modeToggle: "contrast", checkbox: "check-square",
    htmlEmbed: "code-xml", webEmbed: "square-play", columns: "columns-2", table: "table", quiz: "list-checks",
    hotspot: "target", courseNav: "menu", accordion: "panels-top-left", cardReveal: "layers", cardDeck: "copy",
    sequence: "workflow", libraryInstance: "component"
  };
  function blockIcon(b) { return BLOCK_LUCIDE[b.type] || "square"; }
  // A DS twirl caret (Lucide chevron-right, rotates to chevron-down when open). The
  // glyph is resolved at runtime via the Icon accessor, so no inline markup lives in
  // this source (the chrome conformance gate stays green). Ghost = an empty spacer
  // that keeps leaf rows aligned under their siblings' carets.
  function outlineCaret(open, ghost) {
    var c = h("span", "tree-caret" + (open ? " is-open" : "") + (ghost ? " tree-caret--ghost" : ""));
    if (!ghost && window.Icon) c.innerHTML = window.Icon("chevron-right");
    return c;
  }
  function outlineIcon(cls, name) {
    var s = h("span", cls);
    if (window.Icon) s.innerHTML = window.Icon(name);
    return s;
  }
  function blockLabel(b) {
    if (b.name) return b.name; // author-given outliner name (editor chrome; render ignores it)
    if (b.type === "heading") return b.text || "Heading";
    if (b.type === "subheading") return b.text || "Subheading";
    if (b.type === "paragraph") return b.text ? b.text.slice(0, 26) : "Paragraph";
    if (b.type === "quote") return b.text ? b.text.slice(0, 26) : "Quote";
    if (b.type === "list") return "Bulleted list";
    if (b.type === "note") return b.text ? b.text.slice(0, 26) : "Note";
    if (b.type === "image") return "Image";
    if (b.type === "divider") return "Divider";
    if (b.type === "spacer") return "Spacer (" + (b.height == null ? 40 : b.height) + "px)";
    if (b.type === "frame") return "Card (" + ((b.children || []).length) + ")";
    if (b.type === "group") return "Group (" + ((b.children || []).length) + ")";
    if (b.type === "componentGrid") return (COMPONENTS[b.component] ? COMPONENTS[b.component].name : b.component) + " ×" + ((b.instances || []).length);
    if (b.type === "libraryInstance") { var libDef = resolveComponentDef(b.ref); return (libDef && libDef.name) || b.ref || "Library instance"; }
    if (b.type === "navButton") return b.text ? b.text.slice(0, 24) : "Navigation button";
    if (b.type === "modeToggle") return "Light / dark toggle";
    if (b.type === "checkbox") return b.label ? b.label.slice(0, 24) : "Checkbox";
    if (b.type === "htmlEmbed") return "HTML Interaction";
    if (b.type === "webEmbed") return "Web Embed";
    if (b.type === "columns") return "Columns Layout (" + (b.columns ? b.columns.length : 0) + " columns)";
    if (b.type === "quiz") return "Quiz (" + ((b.questions || []).length) + " Q)";
    if (b.type === "hotspot") { var hsE = hotspotEntryScreen(b); return "Image hotspots (" + ((hsE && hsE.markers || []).length) + ")"; }
    if (b.type === "courseNav") return "Learner nav bar (" + ((b.sections || []).length) + ")";
    if (b.type === "cardDeck") return "Card deck (" + ((b.items || []).length) + ")";
    if (b.type === "cardReveal") return "Card reveal (" + ((b.items || []).length) + ")";
    if (b.type === "accordion") return (b.mode === "tabs" ? "Tabs (" : "Accordion (") + ((b.items || []).length) + ")";
    if (b.type === "sequence") return "Sequence (" + ((b.items || []).length) + ")";
    return b.type;
  }
  // DD: a container block's twirl-able children, grouped for display. columns ->
  // one group per column (labelled); group/frame -> a single group of `children`.
  // Returns null for non-containers (incl. componentGrid, whose "children" are
  // instances selected on the canvas, not blocks). Empty containers return null so
  // no caret is drawn.
  function containerChildGroups(block) {
    if (block.type === "columns" && block.columns && block.columns.length) {
      var cg = [];
      block.columns.forEach(function (col, ci) {
        if (col && col.length) cg.push({ label: "Column " + (ci + 1), blocks: col });
      });
      return cg.length ? cg : null;
    }
    if ((block.type === "group" || block.type === "frame") && block.children && block.children.length) {
      return [{ label: null, blocks: block.children }];
    }
    // items[]-based containers (cardReveal / cardDeck / accordion / sequence): each item
    // holds authored child blocks (item.children, plus item.front on a flip card). The
    // canvas renders these as real, selectable nested blocks, but the outliner used to
    // stop at the container -> nested blocks (e.g. an empty group tucked in a card) were
    // unreachable from the tree. Expose them, one group per item, like columns.
    if (Array.isArray(block.items) && block.items.length &&
        (block.type === "cardDeck" || block.type === "cardReveal" || block.type === "accordion" || block.type === "sequence")) {
      var noun = block.type === "accordion" ? "Section" : block.type === "sequence" ? "Step" : "Card";
      var isFlip = block.type === "cardReveal" && block.revealStyle === "flip";
      var ig = [];
      block.items.forEach(function (it, ii) {
        if (!it) return;
        var name = (it.title != null && String(it.title).trim()) ? String(it.title).trim()
          : (it.label != null && String(it.label).trim()) ? String(it.label).trim()
          : noun + " " + (ii + 1);
        // #134: emit a group for EVERY item (and both flip sides) even when empty, each
        // carrying a lazy ref to the exact array -- so an empty card/side is both visible in
        // the tree and a drop target (the outliner drop resolves arrayOwner[arrayKey], never
        // the card's non-existent block.children). A card gets both faces when the block is a
        // flip card OR the item already carries a front array (so front content is reachable).
        var wantFront = isFlip || Array.isArray(it.front);
        if (wantFront) {
          ig.push({ label: name + " (front)", blocks: it.front || [], arrayOwner: it, arrayKey: "front" });
          ig.push({ label: name + " (back)", blocks: it.children || [], arrayOwner: it, arrayKey: "children" });
        } else {
          ig.push({ label: name, blocks: it.children || [], arrayOwner: it, arrayKey: "children" });
        }
      });
      return ig.length ? ig : null;
    }
    return null;
  }
  // DD: select a nested block by REF (no page index into page.blocks — it lives
  // inside a container). Reuses the canvas node lookup + shared selectByType path.
  function selectBlockRef(pi, block) {
    clearAllMulti();
    focusFrame(pi); setActivePage(pi);
    var node = canvasNodeForBlock(block);
    if (!node) { clearSelection(); return; }
    selectByType(node, block);
  }
  // Flattened VISIBLE outline order of every selectable block (across chapters, pages,
  // and nested containers/columns — respecting the open/collapsed state, so it mirrors
  // exactly what the user sees). Powers Shift-range select that spans columns AND pages.
  function flatOutlineBlocks() {
    var out = [];
    function walkBlocks(blocks, pi) {
      (blocks || []).forEach(function (b) {
        out.push({ block: b, pi: pi });
        var g = containerChildGroups(b);
        if (g && openContainers.has(b)) g.forEach(function (grp) { walkBlocks(grp.blocks, pi); });
      });
    }
    function walkPage(page, pi) { if (openPages[page.id]) walkBlocks(page.blocks, pi); }
    var idxOf = {}; doc.pages.forEach(function (p, i) { idxOf[p.id] = i; });
    var chGroups = (window.groupPagesByChapter && Array.isArray(doc.chapters) && doc.chapters.length)
      ? window.groupPagesByChapter(doc) : null;
    if (chGroups) {
      chGroups.forEach(function (ch) {
        if (openChapters[ch.id] === false) return;
        (ch.pages || []).forEach(function (page) { walkPage(page, idxOf[page.id]); });
      });
    } else {
      doc.pages.forEach(function (page, pi) { walkPage(page, pi); });
    }
    return out;
  }
  function flatIndexOfBlock(flat, b) { for (var i = 0; i < flat.length; i++) if (flat[i].block === b) return i; return -1; }
  window.__flatOutlineBlocks = flatOutlineBlocks; // headless test hook
  window.__multiSelCount = function () { return multiSel.length; }; // headless test hook
  // Shared block-row click handler used at EVERY depth (top-level + nested), so Shift /
  // Cmd multi-select works uniformly across columns, containers and pages.
  function handleBlockRowClick(e, pi, block, bi, depth) {
    if (e.metaKey || e.ctrlKey) {
      clearMultiPages(); toggleMulti(block);
      outlineAnchor = { kind: "block", block: block, pi: pi };
      blurActiveText(); renderStructure(); refreshCanvasSelection(); renderInspector(); return;
    }
    if (e.shiftKey && outlineAnchor && outlineAnchor.kind === "block" && outlineAnchor.block) {
      var flat = flatOutlineBlocks();
      var ai = flatIndexOfBlock(flat, outlineAnchor.block), ci = flatIndexOfBlock(flat, block);
      if (ai !== -1 && ci !== -1) {
        var a = Math.min(ai, ci), z = Math.max(ai, ci);
        multiSel = []; clearMultiPages();
        for (var k = a; k <= z; k++) multiSel.push(flat[k].block);
        blurActiveText(); renderStructure(); refreshCanvasSelection(); renderInspector(); return;
      }
    }
    clearAllMulti(); outlineAnchor = { kind: "block", block: block, pi: pi };
    if (depth === 0) selectBlock(pi, bi); else selectBlockRef(pi, block);
  }
  // DD: render one outliner block row (recursive). depth 0 = top-level page block
  // (keeps drag-reorder + multi-select, index `bi` into page.blocks); depth > 0 =
  // nested container child (select-only, no drag, ref-based selection). Container
  // rows get a twirl caret; their children recurse indented underneath.
  function appendBlockRow(list, page, pi, block, bi, depth) {
    var groups = containerChildGroups(block);
    var br = h("div", "tree-block" + (block.type === "componentGrid" ? " tree-block--component" : "") + (selection.block === block ? " is-selected" : "") + (inMulti(block) ? " is-multi" : "") + (block.hidden ? " is-hidden" : "") + (block.locked ? " is-locked" : ""));
    if (depth > 0) br.style.paddingLeft = (6 + depth * 14) + "px";
    if (groups) {
      var isOpen = openContainers.has(block);
      var ccaret = outlineCaret(isOpen, false);
      ccaret.addEventListener("click", function (e) {
        e.stopPropagation();
        if (openContainers.has(block)) openContainers.delete(block); else openContainers.add(block);
        renderStructure();
      });
      br.appendChild(ccaret);
    } else if (depth > 0) {
      br.appendChild(outlineCaret(false, true)); // align leaves under sibling carets
    }
    br.appendChild(outlineIcon("tree-block__icon", blockIcon(block)));
    var bname = h("span", "tree-block__name", blockLabel(block));
    br.appendChild(bname);
    wireOutlineBlockMenu(br, page, pi, block, bi, depth, bname);
    if (block.hidden) br.appendChild(h("span", "tree-block__flag", "hidden"));
    if (block.locked) br.appendChild(h("span", "tree-block__flag", "locked"));

    if (depth === 0) {
      br.setAttribute("draggable", block.locked ? "false" : "true");
      br.addEventListener("click", function (e) { handleBlockRowClick(e, pi, block, bi, 0); });
      br.addEventListener("dragstart", function (e) {
        // Carry the block REF (not just index) -- handleDrop's move branch
        // resolves and removes the source by reference; index-only payloads
        // were silently no-op'ing (and dirtying undo) after the payload shapes
        // diverged from the canvas handle.
        setDragPayload({ kind: "move", page: pi, block: block, index: bi });
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", ""); } catch (_) {}
        br.classList.add("is-dragging");
        document.body.classList.add("is-dragging-block");
      });
      br.addEventListener("dragend", function () {
        br.classList.remove("is-dragging");
        clearDropMarks();
        setDragPayload(null);
        document.body.classList.remove("is-dragging-block");
      });
    } else {
      br.setAttribute("draggable", "false");
      br.addEventListener("click", function (e) { handleBlockRowClick(e, pi, block, bi, depth); });
    }
    // TTT: drop target. A CONTAINER row (frame/group/columns, any depth) accepts a
    // "drop into" (append to its children / first column); a top-level LEAF row keeps
    // the reorder-at-index drop. Nested leaves aren't drop targets.
    if (groups) {
      // #134: items-based containers (cards/accordion/sequence) have no block.children --
      // route a block-row drop into the FIRST item's array; group/frame/columns keep intoContainer.
      var isItems = Array.isArray(block.items) &&
        (block.type === "cardDeck" || block.type === "cardReveal" || block.type === "accordion" || block.type === "sequence");
      if (isItems) {
        makeDropTarget(br, (function (blk) { return function () {
          var it0 = null; for (var z = 0; z < blk.items.length; z++) { if (blk.items[z]) { it0 = blk.items[z]; break; } }
          if (!it0) return null;
          var arr = (it0.children = it0.children || []);
          return { intoBlocks: { arrayRef: arr, ownerBlock: blk } };
        }; })(block), "drop-into");
      } else {
        makeDropTarget(br, (function (b) { return function () { return { intoContainer: b }; }; })(block), "drop-into");
      }
    } else if (depth === 0) {
      makeDropTarget(br, { page: pi, index: bi });
    }
    list.appendChild(br);

    if (groups && openContainers.has(block)) {
      groups.forEach(function (g) {
        if (g.label != null) {
          var cap = h("div", "tree-col-cap" + (g.arrayOwner ? " tree-col-cap--drop" : ""), g.label);
          cap.style.paddingLeft = (6 + (depth + 1) * 14) + "px";
          // #134: a card/side cap (incl. an empty one) is a drop target appending into its
          // exact items[i].children / .front array (resolved + created lazily at drop).
          if (g.arrayOwner) {
            makeDropTarget(cap, (function (gg, blk) { return function () {
              var arr = (gg.arrayOwner[gg.arrayKey] = gg.arrayOwner[gg.arrayKey] || []);
              return { intoBlocks: { arrayRef: arr, ownerBlock: blk } };
            }; })(g, block), "drop-into");
          }
          list.appendChild(cap);
        }
        g.blocks.forEach(function (child) { appendBlockRow(list, page, pi, child, -1, depth + 1); });
      });
    }
  }
  // ---- outliner reorder: drag PAGES + CHAPTERS (blocks already reorder via the
  // block DnD above). Isolated from that system: its own `treeDrag` state + native
  // HTML5 drag on the tree rows, so it never touches the block dragPayload path.
  // Model ops keep the column-major invariant (pages contiguous per chapter, valid
  // integer play order) so canvas + nav stay correct. -----------------------------
  var treeDrag = null; // { kind:"page", id } | { kind:"chapter", id }
  function clearTreeMarks() {
    Array.prototype.forEach.call(document.querySelectorAll(".tree-drop-before,.tree-drop-after,.tree-drop-into"), function (el) {
      el.classList.remove("tree-drop-before", "tree-drop-after", "tree-drop-into");
    });
  }
  // move a page to (before/after) a reference page, or append to a chapter when
  // refPageId is null; reassign its chapter, then re-sort column-major so the
  // chapter blocks stay contiguous and currentPage/play-order stay valid.
  function structMovePage(dragId, refPageId, after, destChapterId) {
    var pi = doc.pages.findIndex(function (p) { return p.id === dragId; });
    if (pi < 0) return;
    if (refPageId && refPageId === dragId) return; // self-drop = no-op
    pushHistory();
    var curId = doc.pages[currentPage] && doc.pages[currentPage].id;
    var page = doc.pages[pi];
    if (destChapterId != null) page.chapterId = destChapterId;
    doc.pages.splice(pi, 1);
    var insertAt;
    if (refPageId) {
      var ri = doc.pages.findIndex(function (p) { return p.id === refPageId; });
      insertAt = ri < 0 ? doc.pages.length : (after ? ri + 1 : ri);
    } else {
      insertAt = doc.pages.length; // dropped on a chapter header -> end of that chapter
    }
    doc.pages.splice(insertAt, 0, page);
    if (window.resortColumnMajor) doc.pages = window.resortColumnMajor(doc.pages, doc.chapters);
    if (curId) { var ni = doc.pages.findIndex(function (p) { return p.id === curId; }); if (ni >= 0) currentPage = ni; }
    mount();
  }
  // reorder a chapter to (before/after) a reference chapter; renumber order + re-sort.
  function structMoveChapter(dragId, refId, after) {
    if (dragId === refId) return;
    var chs = (doc.chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var di = chs.findIndex(function (c) { return c.id === dragId; });
    if (di < 0) return;
    pushHistory();
    var curId = doc.pages[currentPage] && doc.pages[currentPage].id;
    var drag = chs.splice(di, 1)[0];
    var ri = chs.findIndex(function (c) { return c.id === refId; });
    var at = ri < 0 ? chs.length : (after ? ri + 1 : ri);
    chs.splice(at, 0, drag);
    chs.forEach(function (c, i) { c.order = i; });
    if (window.resortColumnMajor) doc.pages = window.resortColumnMajor(doc.pages, doc.chapters);
    if (curId) { var ni = doc.pages.findIndex(function (p) { return p.id === curId; }); if (ni >= 0) currentPage = ni; }
    mount();
  }
  function wireTreePageDrag(prow, page) {
    prow.setAttribute("draggable", "true");
    prow.addEventListener("dragstart", function (e) {
      treeDrag = { kind: "page", id: page.id };
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch (_) {}
      e.stopPropagation();
    });
    prow.addEventListener("dragend", function () { treeDrag = null; clearTreeMarks(); });
    prow.addEventListener("dragover", function (e) {
      if (!treeDrag || treeDrag.kind !== "page") return; // pages accept only page drops
      e.preventDefault(); e.stopPropagation();
      var r = prow.getBoundingClientRect();
      prow.__after = (e.clientY - r.top) > r.height / 2;
      clearTreeMarks();
      prow.classList.add(prow.__after ? "tree-drop-after" : "tree-drop-before");
    });
    prow.addEventListener("dragleave", function () { prow.classList.remove("tree-drop-before", "tree-drop-after"); });
    prow.addEventListener("drop", function (e) {
      if (!treeDrag || treeDrag.kind !== "page") return;
      e.preventDefault(); e.stopPropagation();
      var src = treeDrag; treeDrag = null; var after = prow.__after; clearTreeMarks();
      structMovePage(src.id, page.id, after, page.chapterId); // drop lands in the ref page's chapter
    });
  }
  function wireTreeChapterDrag(crow, ch) {
    crow.setAttribute("draggable", "true");
    crow.addEventListener("dragstart", function (e) {
      treeDrag = { kind: "chapter", id: ch.id };
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch (_) {}
      e.stopPropagation();
    });
    crow.addEventListener("dragend", function () { treeDrag = null; clearTreeMarks(); });
    crow.addEventListener("dragover", function (e) {
      if (!treeDrag) return;
      e.preventDefault(); e.stopPropagation();
      clearTreeMarks();
      if (treeDrag.kind === "chapter") {
        var r = crow.getBoundingClientRect();
        crow.__after = (e.clientY - r.top) > r.height / 2;
        crow.classList.add(crow.__after ? "tree-drop-after" : "tree-drop-before");
      } else {
        crow.classList.add("tree-drop-into"); // a page dropped on the header joins this chapter
      }
    });
    crow.addEventListener("dragleave", function () { crow.classList.remove("tree-drop-before", "tree-drop-after", "tree-drop-into"); });
    crow.addEventListener("drop", function (e) {
      if (!treeDrag) return;
      e.preventDefault(); e.stopPropagation();
      var src = treeDrag; treeDrag = null; var after = crow.__after; clearTreeMarks();
      if (src.kind === "chapter") structMoveChapter(src.id, ch.id, after);
      else if (src.kind === "page") structMovePage(src.id, null, false, ch.id); // append to chapter end
    });
  }
  // ---- outliner right-click context menu (chapters / pages / blocks) --------
  // Shared inline-rename: swap a tree row's name span for a text input (reuses the
  // page-rename pattern + .tree-page__rename styling). allowClear lets an emptied
  // input revert to the derived label (used for blocks, which have no real name).
  function outlineInlineRename(nameSpan, current, commit, allowClear) {
    if (!nameSpan || !nameSpan.parentNode) { mount(); return; } // stale span (tree rebuilt) — bail safely
    var row = nameSpan.closest(".tree-page, .tree-block, .tree-chapter");
    if (row) row.setAttribute("draggable", "false");
    var inp = h("input", "tree-page__rename"); inp.type = "text"; inp.value = current || ""; inp.spellcheck = false;
    nameSpan.replaceWith(inp); inp.focus(); inp.select();
    var done = false;
    function finish(save) {
      if (done) return; done = true;
      var v = inp.value.trim();
      if (save && ((v && v !== current) || (allowClear && v === "" && current !== ""))) { pushHistory(); commit(v); }
      mount();
    }
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener("blur", function () { finish(true); });
  }
  // While previewing a resolved variant, structural edits are disabled everywhere;
  // the outliner menu offers only a route back to the flagship.
  function outlineVariantMenu(e) {
    showContextMenu(e.clientX, e.clientY, [
      { head: "Previewing: " + activeVariant },
      { label: "Switch to Flagship to edit", onClick: function () { previewVariant(null); } }
    ]);
  }
  function wireOutlineChapterMenu(row, ch, nameSpan) {
    row.addEventListener("contextmenu", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (activeVariant) return outlineVariantMenu(e);
      var real = (doc.chapters || []).filter(function (x) { return x.id === ch.id; })[0];
      var items = [{ head: ch.name || "Chapter" }];
      // chapter menu doesn't setSelection, so its name span stays live
      items.push({ label: "Rename", onClick: function () { outlineInlineRename(nameSpan, ch.name || "", function (v) { if (real) real.name = v; }); } });
      items.push({ label: "Move left", onClick: function () { pushHistory(); if (reorderChapter(ch.id, -1)) mount(); } });
      items.push({ label: "Move right", onClick: function () { pushHistory(); if (reorderChapter(ch.id, 1)) mount(); } });
      items.push({ sep: true });
      items.push({ label: "Delete chapter", danger: true, onClick: function () {
        confirmModal("Delete chapter", "Delete chapter “" + (ch.name || "") + "”? Its pages move to the previous chapter.", function () { pushHistory(); if (deleteChapter(ch.id)) mount(); }, { okLabel: "Delete", danger: true });
      } });
      showContextMenu(e.clientX, e.clientY, items);
    });
  }
  function wireOutlinePageMenu(row, page, pi, nameSpan) {
    row.addEventListener("contextmenu", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (activeVariant) return outlineVariantMenu(e);
      focusFrame(pi); setActivePage(pi); setSelection("page", pi); // this re-renders the tree, so resolve the live row at click time
      var items = [{ head: pageDisplayName(page, doc) }];
      items.push({ label: "Rename", onClick: function () { outlineInlineRename(document.querySelector(".tree-page__name.is-active") || nameSpan, (page.title != null ? page.title : firstCopyOf(page)) || "", function (v) { setPageTitle(page, v); }, true); } });
      items.push({ label: "Copy page", onClick: function () { setSelection("page", pi); copySelection(); } });
      if (pageClipboard) items.push({ label: "Paste page after", onClick: function () { currentPage = pi; pastePage(); } });
      items.push({ label: "Duplicate page", onClick: function () { duplicatePage(pi); } });
      if (hasMergeableNext(pi)) items.push({ label: "Merge with next page", onClick: function () { mergePageWithNext(pi); } });
      items.push({ label: "Save page to library…", onClick: function () { savePageAsLibraryMaster(pi); } });
      if (doc.pages.length > 1) { items.push({ sep: true }); items.push({ label: "Delete page", danger: true, onClick: function () { deletePage(pi); } }); }
      showContextMenu(e.clientX, e.clientY, items);
    });
  }
  function wireOutlineBlockMenu(row, page, pi, block, bi, depth, nameSpan) {
    row.addEventListener("contextmenu", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (activeVariant) return outlineVariantMenu(e);
      // right-clicking a block that's part of a multi-selection KEEPS it (so Group works);
      // otherwise select just this block. (single-select re-renders the tree)
      // right-clicking a block that's part of a multi-selection KEEPS it (so Delete/Group
      // act on the whole set) at ANY depth; otherwise select just this block.
      var multi = inMulti(block) && multiSel.length >= 2;
      if (!multi) { if (depth === 0) { clearAllMulti(); selectBlock(pi, bi); } else { selectBlockRef(pi, block); } }
      var items = [{ head: multi ? (multiSel.length + " items selected") : blockLabel(block) }];
      if (!multi) items.push({ label: "Rename", onClick: function () { outlineInlineRename(document.querySelector(".tree-block.is-selected .tree-block__name") || nameSpan, block.name || "", function (v) { if (v) block.name = v; else delete block.name; }, true); } });
      if (!multi && depth === 0) items.push({ label: "Duplicate", onClick: function () { duplicateBlock(block); } });
      if (multi && canMergeTextBoxes(multiSel)) items.push({ label: "Merge text boxes", onClick: function () { mergeTextBoxes(); } });
      if (multi) items.push({ label: "Group selection", onClick: function () { groupMulti(); } });
      if (multi) items.push({ label: "Save selection to library…", onClick: function () { saveSelectionAsSectionMaster(); } }); // #22 section master
      if (!multi && block.type === "group") items.push({ label: "Ungroup", onClick: function () { ungroupBlock(block); } });
      if (!multi) items.push({ label: "Save as component…", onClick: function () { saveBlockAsComponent(block); } });
      // #174: reset the block(s) to a blank skeleton — wipe copy/images/embeds, keep structure.
      items.push({ label: "Clear content", onClick: function () { clearBlockContentAction(multi ? multiSel.slice() : block); } });
      items.push({ sep: true });
      items.push({ label: multi ? ("Delete " + multiSel.length + " items") : "Delete", danger: true, onClick: function () { if (multi) deleteSelection(); else deleteBlockByRef(block); } });
      showContextMenu(e.clientX, e.clientY, items);
    });
  }
  function renderStructure() {
    pagesList.innerHTML = ""; pageItems = [];
    // drop any multi-selected blocks that no longer exist (e.g. after grouping). Use a
    // ref-based, nesting-aware existence check (findBlockParent) — getBlockPageIndexAndIndex
    // only sees TOP-LEVEL blocks, so it was silently dropping every NESTED (column / child)
    // block from the multi-selection on each re-render, breaking cross-column select.
    multiSel = multiSel.filter(function (b) {
      for (var pi = 0; pi < doc.pages.length; pi++) { var pg = doc.pages[pi]; if (pg && findBlockParent(pg.blocks, b)) return true; }
      return false;
    });
    // module G: group the page rows under their CHAPTER (a twirl-able header row),
    // mirroring the canvas columns. `pi` stays the real doc.pages index everywhere.
    var idxOf = {}; doc.pages.forEach(function (p, i) { if (p) idxOf[p.id] = i; });
    var groups = (window.groupPagesByChapter && Array.isArray(doc.chapters) && doc.chapters.length)
      ? window.groupPagesByChapter(doc) : null;
    if (groups) {
      groups.forEach(function (ch) {
        var cOpen = openChapters[ch.id] !== false;
        var crow = h("div", "tree-chapter");
        var ccaret = outlineCaret(cOpen, false);
        ccaret.addEventListener("click", function (e) { e.stopPropagation(); openChapters[ch.id] = !cOpen; renderStructure(); });
        crow.appendChild(ccaret);
        // Chapter names STAY upper-cased (DS content rule) — uppercasing is applied
        // in CSS (.tree-chapter__name) so the underlying model text is untouched.
        var cname = h("span", "tree-chapter__name", ch.name || "Chapter");
        crow.appendChild(cname);
        var ccount = (window.VersoUI && window.VersoUI.Badge)
          ? window.VersoUI.Badge({ children: String((ch.pages || []).length) })
          : h("span", null, String((ch.pages || []).length));
        ccount.classList.add("tree-chapter__count");
        crow.appendChild(ccount);
        wireTreeChapterDrag(crow, ch);
        wireOutlineChapterMenu(crow, ch, cname);
        pagesList.appendChild(crow);
        if (cOpen) (ch.pages || []).forEach(function (page) { emitPage(page, idxOf[page.id]); });
      });
    } else {
      doc.pages.forEach(function (page, pi) { if (page) emitPage(page, pi); });
    }
    function emitPage(page, pi) {
      var open = !!openPages[page.id];
      var prow = h("div", "tree-page");
      var caret = outlineCaret(open, false);
      caret.addEventListener("click", function (e) { e.stopPropagation(); openPages[page.id] = !open; renderStructure(); });
      var picon = outlineIcon("tree-page__icon", "file-text");
      // uio-E-C07 (EDIT-12): the derived chapter.page number lives in its OWN fixed column so the
      // name row identifies itself cleanly -- no baked-in / doubled numbers, no truncated tail.
      var num = h("span", "tree-page__num", pageNumberOf(page, doc));
      var name = h("span", "tree-page__name" + (pi === currentPage ? " is-active" : "") + (inMultiPage(pi) ? " is-multi" : ""), pageTitlePart(page));
      name.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey) { clearMulti(); toggleMultiPage(pi); outlineAnchor = { kind: "page", pi: pi }; return; }
        if (e.shiftKey && outlineAnchor && outlineAnchor.kind === "page") {
          var a = Math.min(outlineAnchor.pi, pi), z = Math.max(outlineAnchor.pi, pi);
          multiSelPages = []; clearMulti();
          for (var k = a; k <= z; k++) multiSelPages.push(k);
          renderStructure(); refreshCanvasSelection(); return;
        }
        clearAllMulti(); outlineAnchor = { kind: "page", pi: pi };
        focusFrame(pi); setActivePage(pi); setSelection("page", pi);
      });
      name.title = "Double-click to rename";
      name.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        prow.setAttribute("draggable", "false"); // let the input take text selection, not a row drag
        // P2: rename edits the TITLE part only (page.title override); the chapter.page
        // number stays auto-derived. Seed with the current override or the derived first
        // copy so the author edits the visible title; an empty/unchanged commit clears it.
        var seedTitle = (page.title != null ? page.title : firstCopyOf(page)) || "";
        var inp = h("input", "tree-page__rename"); inp.type = "text"; inp.value = seedTitle; inp.spellcheck = false;
        name.replaceWith(inp); inp.focus(); inp.select();
        function commit() { var v = inp.value.trim(); if (v !== seedTitle) { pushHistory(); setPageTitle(page, v); } mount(); }
        inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); } else if (ev.key === "Escape") { ev.preventDefault(); inp.value = seedTitle; inp.blur(); } });
        inp.addEventListener("blur", commit);
      });
      prow.appendChild(caret); prow.appendChild(picon); prow.appendChild(num); prow.appendChild(name);
      makeDropTarget(prow, function () { return { page: pi, index: doc.pages[pi].blocks.length }; }, "drop-into");
      wireTreePageDrag(prow, page); // reorder pages / move between chapters (isolated from block DnD)
      wireOutlinePageMenu(prow, page, pi, name);
      pagesList.appendChild(prow);
      pageItems.push(name);

      if (open) {
        var list = h("div", "tree-blocks");
        page.blocks.forEach(function (block, bi) {
          appendBlockRow(list, page, pi, block, bi, 0);
        });
        var end = h("div", "tree-drop-end", "drop here");
        makeDropTarget(end, function () { return { page: pi, index: doc.pages[pi].blocks.length }; });
        list.appendChild(end);
        pagesList.appendChild(list);
      }
    }
  }
  // select a block from the outliner -> map to its canvas node + right selection
  function selectBlock(pi, bi) {
    focusFrame(pi); setActivePage(pi);
    var block = doc.pages[pi].blocks[bi];
    var frame = frameDescs[pi] && frameDescs[pi].frame;
    if (!frame || !block) { clearSelection(); return; }
    
    var nodes = frame.querySelectorAll(".canvas-block");
    var node = null;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].__block === block) {
        node = nodes[i];
        break;
      }
    }
    if (!node) { clearSelection(); return; }
    selectByType(node, block);
  }
  // map a block + its canvas node to the correct selection type. Shared by the
  // outliner (selectBlock) and direct canvas clicks (enableEditing).
  function selectByType(node, block) {
    if (block.type === "htmlEmbed" || block.type === "webEmbed") setSelection("embed", node);
    else if (block.type === "navButton") setSelection("navButton", node);
    else if (block.type === "componentGrid" || block.type === "columns") setSelection("block", node);
    else if (node.getAttribute && node.getAttribute("data-edit") != null) setSelection("field", node);
    else setSelection("block", node);
  }
  function setActivePage(i) { currentPage = i; pageItems.forEach(function (it, idx) { it.classList.toggle("is-active", idx === i); }); if (frameDescs) frameDescs.forEach(function (f) { if (f.label) f.label.classList.toggle("is-active", f.i === i); }); refreshGridOverlay(); }

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
    var cellInteractive = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(doc).interactive : true;
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
    if (selection && selection.block) {
      var loc = getBlockPageIndexAndIndex(selection.block);
      if (loc && loc.pageIndex === currentPage && page.blocks[loc.blockIndex] === selection.block)
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
    var page = doc.pages[currentPage];
    if (selection && selection.block) {
      var loc = findBlockParent(page.blocks, selection.block);
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
    if (__sourceLinkDropAt && doc.pages[__sourceLinkDropAt.pageIndex]) {
      var tp = doc.pages[__sourceLinkDropAt.pageIndex];
      L = { array: tp.blocks, index: Math.max(0, Math.min(__sourceLinkDropAt.index, tp.blocks.length)) };
      currentPage = __sourceLinkDropAt.pageIndex;
      __sourceLinkDropAt.index = L.index + 1; // the next block in this placement lands after this one
    } else {
      L = insertLoc();
    }
    L.array.splice(L.index, 0, block);
    reapplyStructural(findPageOfBlock(block)); // PERF: one page, not the world
    setActivePage(currentPage);
    focusFrame(currentPage);
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
  // SPEC 8 (source-link 02): the Edit left-panel Source tab is a read-only, live view of the OPEN
  // document's product source doc -- the same content the author sees in the Source stage, in a
  // narrow reading column, with its own find (SourceDoc.findMatches + cycle) and a TOC
  // (SourceDoc.outline, click-to-jump + scroll-spy). It keys off the open doc's product
  // (doc.meta.productId), NOT the rail scope, so it always matches the course in front of you. All
  // source editing stays in the Source stage (the single-host lesson) -- nothing here is editable.
  function renderEditSourcePanel() {
    var host = document.getElementById("tab-source"); if (!host) return;
    host.innerHTML = "";
    var SD = window.SourceDoc, U = window.VersoUI;
    var productId = (doc && doc.meta && doc.meta.productId) || "";
    if (!productId) {
      host.appendChild(h("div", "source-stage__empty", "This document isn't attached to a Product. Use Save/Recents -> Promote to Product to link it, then its source appears here."));
      return;
    }
    var master = productId ? sourceMasterFor(productId) : null;
    if (!master || !master.doc || !SD) {
      host.appendChild(h("div", "source-stage__empty", "This Product has no source document yet. Build it in the Source stage."));
      return;
    }
    var model = SD.fromJSON(master.doc);
    // source-link 03: keep the live master + model + its component id so the Place gesture can add a
    // link mark to the master and persist it (and so the canvas can resolve placements back to it).
    __editSourceMaster = master; __editSourceModel = model;
    __editSourceMasterId = (window.ProductsStore[productId] && window.ProductsStore[productId].groundTruthId) || null;
    var wrap = h("div", "edit-source");

    // ---- find (reuses SD.findMatches + a small local cycle, mirroring the Source stage). The
    // search field reuses the shared .vbrowser__search chrome (same control as the doc browser +
    // Source stage) rather than a bespoke input, for app-wide search parity. ----
    var matches = [], findIdx = 0;
    var searchBar = h("div", "edit-source__searchbar");
    var search = h("label", "vbrowser__search");
    search.innerHTML = window.Icon ? window.Icon("search") : "";
    var input = h("input", "vbrowser__search-input"); input.type = "text"; input.placeholder = "find in source"; input.spellcheck = false;
    var count = h("span", "edit-source__count", "");
    search.appendChild(input); search.appendChild(count);
    searchBar.appendChild(search);
    wrap.appendChild(searchBar);

    var docCol = h("div", "edit-source__doc");
    function clearFindHi() { Array.prototype.forEach.call(docCol.querySelectorAll(".is-find-current"), function (el) { el.classList.remove("is-find-current"); }); }
    function scrollToHit(i) {
      clearFindHi();
      var mt = matches[i]; if (!mt) return;
      var el = docCol.querySelector('[data-node="' + mt.nodeKey + '"]');
      if (el) { el.classList.add("is-find-current"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }
    function runFind() {
      var q = input.value.trim();
      matches = q ? SD.findMatches(model, q) : [];
      findIdx = 0;
      count.textContent = q ? (matches.length ? (matches.length + " found") : "no matches") : "";
      if (matches.length) scrollToHit(0); else clearFindHi();
    }
    function cycleFind(dir) {
      if (!matches.length) return;
      findIdx = (findIdx + dir + matches.length) % matches.length;
      count.textContent = (findIdx + 1) + " / " + matches.length;
      scrollToHit(findIdx);
    }
    input.addEventListener("input", runFind);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); cycleFind(e.shiftKey ? -1 : 1); } });

    // ---- table of contents (SD.outline: chapters + headings, click to jump, scroll-spy) ----
    var outline = SD.outline(model), tocRows = [];
    if (outline.length) {
      var toc = h("nav", "edit-source__toc"); toc.setAttribute("aria-label", "Source outline");
      function tocRow(node) {
        // Reuse the shared .source-doc__toc-item row (look + is-current scroll-spy class the Source
        // stage's own TOC uses) rather than a bespoke row.
        var r = h("button", "source-doc__toc-item source-doc__toc-item--l" + (node.level || 2), node.text || "Untitled");
        r.type = "button"; r.setAttribute("data-toc-key", node.key); r.title = node.text || "";
        r.addEventListener("click", function () { var t = docCol.querySelector('[data-node="' + node.key + '"]'); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); });
        toc.appendChild(r); tocRows.push(r);
      }
      outline.forEach(function (ch) { tocRow(ch); (ch.children || []).forEach(tocRow); });
      wrap.appendChild(toc);
    }

    // ---- reading column (read-only projection; the SAME renderSourceDocNode the stage uses) ----
    (model.nodes || []).forEach(function (n) { docCol.appendChild(renderSourceDocNode(n)); });
    // 07: a source figure is draggable as one unit -> a linked image block. Object-anchor descriptor
    // (no start/len). Images aren't text-selectable, so a pointerdown-drag on the figure is safe.
    Array.prototype.forEach.call(docCol.querySelectorAll("figure.source-doc__figure[data-object]"), function (figEl) {
      figEl.classList.add("edit-source__figure");
      figEl.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        startSourceLinkDrag({ anchor: { nodeKey: figEl.getAttribute("data-node") } }, ev);
      });
    });
    // Scroll-spy: highlight the TOC entry for the last heading scrolled above the top.
    docCol.addEventListener("scroll", function () {
      if (!tocRows.length) return;
      var top = docCol.getBoundingClientRect().top + 8, curKey = null;
      Array.prototype.forEach.call(docCol.querySelectorAll(".source-doc__h[data-node]"), function (el) { if (el.getBoundingClientRect().top <= top) curKey = el.getAttribute("data-node"); });
      tocRows.forEach(function (r) { r.classList.toggle("is-current", r.getAttribute("data-toc-key") === curKey); });
    });
    wrap.appendChild(docCol);
    host.appendChild(wrap);

    // source-link 03: paint passages already linked into the OPEN document (a persistent highlight,
    // distinct from the transient find highlight), and honour a pending jump-to-source request.
    paintPanelLinkedPassages(docCol, model);
    // A text selection in the read-only column raises the floating "Place" bar (arm-then-click).
    docCol.addEventListener("mouseup", function () { setTimeout(function () { maybeShowPlaceBar(docCol, model); }, 0); });
    if (__pendingSourceJumpMark && __pendingSourceJumpMark.masterId === __editSourceMasterId) {
      var jm = SD.markById(model, __pendingSourceJumpMark.markId);
      __pendingSourceJumpMark = null;
      if (jm) {
        var jk = jm.anchor && jm.anchor.nodeKey;
        var tel = jk && docCol.querySelector('[data-node="' + jk + '"]');
        if (tel) { tel.classList.add("is-find-current"); setTimeout(function () { tel.scrollIntoView({ block: "center", behavior: "smooth" }); }, 0); }
      }
    }
  }
  if (window.__productRail) window.__productRail.renderEditSourcePanel = renderEditSourcePanel; // browser-verify hook

  // ==== source-link 03: select a range -> place a live-linked text block (arm-then-click) ========
  // The panel viewer (02) is read-only, but its text is selectable. Selecting a range raises a
  // small floating "Place" bar; Place creates a type:"link" mark on the source master and arms
  // placement; the next canvas click drops one locked, live-linked text block that resolves through
  // the 01 resolver. Cross-node selections (a heading through a paragraph) link as one passage.
  var __editSourceMaster = null, __editSourceModel = null, __editSourceMasterId = null;
  var __armedSourceLink = null;        // { masterId, markId } armed for the next canvas click
  var __pendingSourceJumpMark = null;  // { masterId, markId } to scroll to after the panel re-renders
  var __sourceLinkDropAt = null;       // #161 part 1: { pageIndex, index } explicit drop gap for a placement

  // #161 part 1: the between-block gap under the cursor on the target page -> where a dropped linked
  // block should land, plus the Y to draw the drop-line at. Only TOP-LEVEL page blocks are gap targets
  // (a linked block drops between page blocks, not inside a column); returns null off any page.
  function sourceLinkDropGap(cx, cy) {
    var pi = pageIndexFromPoint(cx, cy); if (pi < 0) return null;
    var fr = frameElementUnder(cx, cy); if (!fr) return null;
    var page = doc.pages[pi]; if (!page) return null;
    var tops = Array.prototype.filter.call(fr.querySelectorAll(".canvas-block"), function (el) {
      return el.__block && page.blocks.indexOf(el.__block) !== -1; // top-level only (skip nested)
    });
    tops.sort(function (a, b) { return page.blocks.indexOf(a.__block) - page.blocks.indexOf(b.__block); });
    var index = page.blocks.length, lineY = null;
    for (var i = 0; i < tops.length; i++) {
      var r = tops[i].getBoundingClientRect();
      if (cy < r.top + r.height / 2) { index = page.blocks.indexOf(tops[i].__block); lineY = r.top; break; }
    }
    if (lineY == null) { // below every block -> the trailing gap
      if (tops.length) lineY = tops[tops.length - 1].getBoundingClientRect().bottom;
      else lineY = fr.getBoundingClientRect().top + 14; // empty page
    }
    return { pageIndex: pi, index: index, lineY: lineY, frameRect: fr.getBoundingClientRect() };
  }
  function hideSourceLinkDropLine() { var l = document.getElementById("source-link-dropline"); if (l) l.remove(); }
  function showSourceLinkDropLine(cx, cy) {
    var gap = sourceLinkDropGap(cx, cy);
    if (!gap) { hideSourceLinkDropLine(); return; }
    var line = document.getElementById("source-link-dropline");
    if (!line) { line = h("div", "source-link-dropline"); line.id = "source-link-dropline"; document.body.appendChild(line); }
    line.style.left = gap.frameRect.left + "px";
    line.style.width = gap.frameRect.width + "px";
    line.style.top = gap.lineY + "px";
  }

  // Char offset of a DOM point within a block element's text (walks all text nodes -> matches the
  // SourceDoc plain-text offset model the marks anchor to).
  function panelCharOffset(blockEl, container, offset) {
    var r = document.createRange();
    r.selectNodeContents(blockEl);
    try { r.setEnd(container, offset); } catch (e) { return 0; }
    return r.toString().length;
  }
  // Build a SourceDoc range descriptor {anchor, endAnchor?} from the current selection in the panel,
  // or null when the selection is empty / collapsed / outside the reading column. Single-node ->
  // one anchor; cross-node -> anchor (first node, start..end) + endAnchor (last node, 0..end),
  // matching SourceDoc.addMark's multi-block shape.
  function panelSelectionDescriptor(docCol, model) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var rng = sel.getRangeAt(0);
    if (!docCol.contains(rng.startContainer) || !docCol.contains(rng.endContainer)) return null;
    var sEl = (rng.startContainer.nodeType === 3 ? rng.startContainer.parentNode : rng.startContainer);
    var eEl = (rng.endContainer.nodeType === 3 ? rng.endContainer.parentNode : rng.endContainer);
    var sBlock = sEl && sEl.closest ? sEl.closest("[data-node]") : null;
    var eBlock = eEl && eEl.closest ? eEl.closest("[data-node]") : null;
    if (!sBlock || !eBlock) return null;
    var sKey = sBlock.getAttribute("data-node"), eKey = eBlock.getAttribute("data-node");
    var sOff = panelCharOffset(sBlock, rng.startContainer, rng.startOffset);
    var eOff = panelCharOffset(eBlock, rng.endContainer, rng.endOffset);
    var SD = window.SourceDoc;
    if (sKey === eKey) {
      if (eOff <= sOff) return null;
      return { anchor: { nodeKey: sKey, start: sOff, len: eOff - sOff } };
    }
    var sNode = SD.nodeByKey(model, sKey);
    var sLen = sNode ? SD.nodeText(sNode).length : sOff;
    return { anchor: { nodeKey: sKey, start: sOff, len: Math.max(0, sLen - sOff) }, endAnchor: { nodeKey: eKey, start: 0, len: eOff } };
  }
  function hidePlaceBar() { var b = document.querySelector("[data-source-placebar]"); if (b) b.remove(); }
  function maybeShowPlaceBar(docCol, model) {
    hidePlaceBar();
    if (__armedSourceLink) return; // already arming -> don't stack
    var desc = panelSelectionDescriptor(docCol, model);
    if (!desc) return;
    var sel = window.getSelection();
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    var bar = h("div", "source-placebar"); bar.setAttribute("data-source-placebar", "1");
    // 04: a grab handle starts a custom pointer-drag (decoupled from the text selection, which is why
    // it's NOT native HTML5 DnD -- setting draggable would kill selecting text in the panel).
    var grip = h("button", "source-placebar__grip"); grip.type = "button"; grip.title = "Drag onto the canvas to place";
    grip.innerHTML = window.Icon ? window.Icon("grip-vertical") : "";
    grip.addEventListener("pointerdown", function (ev) { ev.preventDefault(); startSourceLinkDrag(desc, ev); });
    bar.appendChild(grip);
    var btn = window.VersoUI && window.VersoUI.Button
      ? window.VersoUI.Button({ variant: "primary", size: "sm", icon: "link", label: "Place", onClick: function () { armSourceLinkPlacement(desc); } })
      : h("button", null, "Place");
    if (!(window.VersoUI && window.VersoUI.Button)) btn.addEventListener("click", function () { armSourceLinkPlacement(desc); });
    bar.appendChild(btn);
    document.body.appendChild(bar);
    bar.style.top = Math.max(8, rect.top - bar.offsetHeight - 8) + "px";
    bar.style.left = Math.max(8, rect.left) + "px";
  }
  // Place: arm the next canvas click to drop the linked copy. Mark creation is DEFERRED to the drop
  // (05): a range spanning formats splits into several linked blocks, each with its own link mark,
  // so the marks are minted per run when the drop resolves — we carry the range descriptor, not a
  // pre-made single mark.
  function armSourceLinkPlacement(desc) {
    if (!window.SourceDoc || !__editSourceModel || !__editSourceMasterId) return;
    __armedSourceLink = { masterId: __editSourceMasterId, descriptor: desc };
    document.body.classList.add("is-arming-source-link");
    hidePlaceBar();
    var s = window.getSelection(); if (s) s.removeAllRanges();
    sourceToast("Linked passage armed — click a spot in the canvas to place it. Esc to cancel.");
  }
  function cancelArmedSourceLink() {
    if (!__armedSourceLink) return;
    __armedSourceLink = null;
    document.body.classList.remove("is-arming-source-link");
    sourceToast("Placement cancelled.");
  }
  // format-split (05): source structure -> destination block type. heading lvl1 -> Heading 1
  // (heading block), heading lvl2/3 -> Heading 2 (subheading block), paragraph/callout -> Body.
  var SOURCE_LINK_BLOCK_TYPE = { h1: "heading", h2: "subheading", body: "paragraph" };
  var SOURCE_LINK_TEXT_TYPES = { heading: 1, subheading: 1, paragraph: 1, note: 1, quote: 1 };
  // A drop target counts as "a text block to merge into" (06) only if it's an editable text block
  // that isn't itself a whole-block linked placement (don't nest a link inside a link).
  function isSourceLinkTextBlock(b) { return !!(b && SOURCE_LINK_TEXT_TYPES[b.type] && !b.sourceLink); }
  // The armed drop. Dropping ONTO an existing text block appends a locked linked inline span there
  // (06); dropping in a gap runs the format-split planner and inserts one linked block per same-
  // format run (05). Optional (cx,cy) = the drop point (from the drag or the armed click); absent ->
  // gap placement on the current page.
  function placeArmedSourceLink(cx, cy) {
    var a = __armedSourceLink; if (!a) return false;
    __armedSourceLink = null;
    document.body.classList.remove("is-arming-source-link");
    // An object anchor (no start/len) is a figure link (07) -> always a new linked image block.
    var isObject = !!(a.descriptor && a.descriptor.anchor && a.descriptor.anchor.len == null);
    if (cx != null) {
      if (!isObject) {
        var el = document.elementFromPoint(cx, cy);
        var blockEl = el && el.closest ? el.closest(".canvas-block") : null;
        if (blockEl && isSourceLinkTextBlock(blockEl.__block)) return dropInlineSourceLink(a, blockEl.__block);
      }
      var pi = pageIndexFromPoint(cx, cy); if (pi >= 0) setActivePage(pi);
      // #161 part 1: land the block(s) at the between-block gap under the cursor (where the drop-line
      // showed), not at the current selection. Consumed by insertBlock, cleared after the placement.
      var gap = sourceLinkDropGap(cx, cy);
      if (gap) __sourceLinkDropAt = { pageIndex: gap.pageIndex, index: gap.index };
    }
    var result = isObject ? placeSourceLinkImage(a) : placeSourceLinkBlocks(a);
    __sourceLinkDropAt = null; // one placement only -- never leak the gap into ordinary insertBlock calls
    return result;
  }
  // 07: drop a source figure -> a new linked image block. The link is an OBJECT mark (anchor
  // {nodeKey}, no start/len); the image block resolves its src/alt from the figure node via 01.
  function placeSourceLinkImage(a) {
    var SD = window.SourceDoc;
    var master = libComponents()[a.masterId];
    if (!master || !master.doc) { sourceToast("The source is no longer available."); return false; }
    var model = SD.fromJSON(master.doc);
    var mk = SD.addMark(model, { type: "link", anchor: a.descriptor.anchor }); // object mark (len null)
    master.doc = SD.toJSON(model); saveLibrary();
    insertBlock({ type: "image", id: mintId(), sourceLink: { masterId: a.masterId, markId: mk.id } });
    decorateSourceLinks();
    if (_activeLeftSection === "source") renderEditSourcePanel();
    sourceToast("Linked image placed.");
    return true;
  }
  // 05: gap placement -- run the format-split planner and insert ONE locked, live-linked text block
  // per contiguous same-format run (each in the destination's matching preset). A single-format range
  // yields one block; consecutive same-format nodes stay in one block joined by line breaks.
  function placeSourceLinkBlocks(a) {
    var SD = window.SourceDoc;
    var master = libComponents()[a.masterId];
    if (!master || !master.doc) { sourceToast("The source is no longer available."); return false; }
    var model = SD.fromJSON(master.doc);
    var plan = SD.planLinkedBlocks(model, a.descriptor);
    if (!plan.length) return false;
    // Mint every link mark and PERSIST them to the master BEFORE inserting any block (#161): insertBlock
    // renders the canvas, and the render resolver (resolveSourceLinkContent) reads master.doc to fill the
    // linked copy live. Persisting AFTER the insert loop (the old order) meant that first render saw the
    // pre-mark master.doc, markById returned null, and the block rendered blank + collapsed until an
    // unrelated re-render. placeSourceLinkImage already persists before its insertBlock -- match it.
    var markIds = plan.map(function (run) {
      return SD.addMark(model, { type: "link", anchor: run.anchor, endAnchor: run.endAnchor }).id;
    });
    master.doc = SD.toJSON(model); saveLibrary();
    plan.forEach(function (run, i) {
      insertBlock({ type: SOURCE_LINK_BLOCK_TYPE[run.format] || "paragraph", id: mintId(), sourceLink: { masterId: a.masterId, markId: markIds[i] } });
    });
    decorateSourceLinks();
    if (_activeLeftSection === "source") renderEditSourcePanel(); // repaint so newly-linked passages highlight
    sourceToast(plan.length > 1 ? ("Placed " + plan.length + " linked blocks.") : "Linked block placed.");
    return true;
  }
  function slEscape(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  // 06: drop onto a text block -> append a locked, live-linked inline span to that block. The whole
  // dropped range flattens to ONE link mark (you're merging into body prose; the 05 format-split is
  // between-block only). Owned text around the span stays editable; the span is contenteditable=false
  // (locked) and resolves live via 01's #120-style inline post-pass, baking at export.
  function dropInlineSourceLink(a, block) {
    var SD = window.SourceDoc;
    var master = libComponents()[a.masterId];
    if (!master || !master.doc) { sourceToast("The source is no longer available."); return false; }
    var model = SD.fromJSON(master.doc);
    var mk = SD.addMark(model, { type: "link", anchor: a.descriptor.anchor, endAnchor: a.descriptor.endAnchor });
    master.doc = SD.toJSON(model); saveLibrary();
    pushHistory();
    var span = '<span data-source-link="' + mk.id + '" data-master="' + a.masterId + '">' + slEscape(SD.markText(model, mk)) + '</span>';
    block.text = (block.text ? block.text + " " : "") + span;
    reapplyBlock(block);
    decorateSourceLinks();
    if (_activeLeftSection === "source") renderEditSourcePanel();
    sourceToast("Linked span added.");
    return true;
  }
  // 04: the destination page under a drop point (its .frame -> .page[data-page-id] -> doc index).
  function pageIndexFromPoint(cx, cy) {
    var fr = frameElementUnder(cx, cy); if (!fr) return -1;
    var pageEl = fr.querySelector(".page[data-page-id]");
    var pid = pageEl && pageEl.getAttribute("data-page-id");
    return pid ? (doc.pages || []).findIndex(function (p) { return p.id === pid; }) : -1;
  }
  // 04: the preferred placement gesture -- press the grab handle and drag the passage onto the
  // canvas. A ghost follows the cursor; the page under the cursor lights up as the drop target;
  // release resolves through the SAME placement the arm-then-click path uses (placeArmedSourceLink).
  // Custom pointer events (not native DnD) so selecting text in the read-only panel still works.
  function startSourceLinkDrag(desc, ev) {
    hidePlaceBar();
    var ghost = h("div", "source-link-ghost", "Linked copy"); document.body.appendChild(ghost);
    document.body.classList.add("is-dragging-source-link");
    function clearTarget() { var p = document.querySelector(".frame.is-drop-target"); if (p) p.classList.remove("is-drop-target"); }
    // Dropping ONTO an editable text block appends an inline span there (06); dropping in a gap inserts
    // a new block. Show the between-block drop-line only for the gap case; highlight the block for the
    // inline case -- so the drag always previews exactly where the copy will land (#161 part 1).
    var isObjDrag = !!(desc && desc.anchor && desc.anchor.len == null);
    function overTextBlock(x, y) {
      if (isObjDrag) return null; // a figure always becomes a new image block, never an inline span
      var el = document.elementFromPoint(x, y); var be = el && el.closest ? el.closest(".canvas-block") : null;
      return (be && isSourceLinkTextBlock(be.__block)) ? be : null;
    }
    function clearInlineTarget() { var b = document.querySelector(".canvas-block.is-sl-inline-target"); if (b) b.classList.remove("is-sl-inline-target"); }
    function move(e) {
      ghost.style.left = (e.clientX + 12) + "px"; ghost.style.top = (e.clientY + 12) + "px";
      clearTarget(); clearInlineTarget();
      var fr = frameElementUnder(e.clientX, e.clientY); if (fr) fr.classList.add("is-drop-target");
      var tb = overTextBlock(e.clientX, e.clientY);
      if (tb) { tb.classList.add("is-sl-inline-target"); hideSourceLinkDropLine(); }
      else if (fr) { showSourceLinkDropLine(e.clientX, e.clientY); }
      else { hideSourceLinkDropLine(); }
    }
    function up(e) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      ghost.remove(); document.body.classList.remove("is-dragging-source-link"); clearTarget(); clearInlineTarget(); hideSourceLinkDropLine();
      if (!frameElementUnder(e.clientX, e.clientY)) { sourceToast("Dropped outside the canvas — nothing placed."); return; }
      __armedSourceLink = { masterId: __editSourceMasterId, descriptor: desc };
      placeArmedSourceLink(e.clientX, e.clientY); // routes to inline-span (onto a text block) or gap placement
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    move(ev);
  }
  // Two-way jump (direction: canvas -> panel): clicking a linked block's indicator opens the Source
  // tab and scrolls the panel to the exact source passage.
  function jumpSourcePanelToMark(masterId, markId) {
    __pendingSourceJumpMark = { masterId: masterId, markId: markId };
    if (typeof applyLeftSection === "function") applyLeftSection("source"); // re-renders the panel, which honours the pending jump
  }
  // On-canvas link indicator: a small clickable badge on every placed linked block (editor chrome
  // only -- never rendered into the shipped course). Idempotent; re-run after each render.
  function decorateSourceLinks(scope) {
    var root = scope || canvas; if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".source-link-badge"), function (b) { b.remove(); });
    Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (node) {
      node.classList.remove("is-source-linked");
      var b = node.__block;
      if (b && b.sourceLink && b.sourceLink.markId) {
        node.classList.add("is-source-linked");
        var badge = h("button", "source-link-badge"); badge.type = "button";
        badge.innerHTML = window.Icon ? window.Icon("link") : "";
        badge.title = "Linked from source — jump, or pick / create an alternate";
        badge.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); openSourceLinkMenu({ kind: "block", block: b }, b.sourceLink.masterId, b.sourceLink.markId, e.clientX, e.clientY); });
        node.appendChild(badge);
      }
    });
    // 06: per-span indicator inside a mixed block -- each locked linked inline span gets its own
    // contextual menu (jump + alternate), distinct from the whole-block badge above.
    Array.prototype.forEach.call(root.querySelectorAll(".canvas-block span[data-source-link]"), function (sp) {
      sp.classList.add("is-source-linked-span");
      if (sp.__slWired) return; sp.__slWired = true;
      sp.title = "Linked from source — jump, or pick / create an alternate";
      sp.addEventListener("click", function (e) {
        e.stopPropagation();
        var owner = sp.closest ? sp.closest(".canvas-block") : null;
        if (!owner || !owner.__block) return;
        openSourceLinkMenu({ kind: "span", block: owner.__block, spanEl: sp, markId: sp.getAttribute("data-source-link") }, sp.getAttribute("data-master"), sp.getAttribute("data-source-link"), e.clientX, e.clientY);
      });
    });
  }
  // Panel: highlight passages already linked into the OPEN document (a persistent cue, distinct from
  // the find highlight). A link mark counts as "used here" when a block in the open doc points at it.
  function paintPanelLinkedPassages(docCol, model) {
    var SD = window.SourceDoc;
    var used = {};
    walkBlocks(doc, function (b) { if (b.sourceLink && b.sourceLink.masterId === __editSourceMasterId && b.sourceLink.markId) used[b.sourceLink.markId] = 1; });
    (model.marks || []).forEach(function (m) {
      if (m.type !== "link" || !used[m.id]) return;
      SD.markSpans(model, m).forEach(function (sp) {
        var el = docCol.querySelector('[data-node="' + sp.nodeKey + '"]');
        if (el) el.classList.add("is-source-linked-passage");
      });
    });
  }
  // ==== source-link 08: alternates (create + pick) from the canvas ==============================
  // Linked copy is locked; the sanctioned way to say it differently in ONE place is an alternate --
  // a named fork registered on the source master (so it's visible + pushable from the Source stage,
  // 10) that this single placement points at via altId. A location shows base until an alternate is
  // picked or pushed to it (never automatic). Text alternates are span/range-contextual.
  function sourceAltSnippet(s) { s = String(s == null ? "" : s); return s.length > 32 ? s.slice(0, 32) + "…" : s; }
  // Alternate marks anchored identically to a link mark (its candidate alternates).
  function sourceLinkAlternates(model, link) {
    var SD = window.SourceDoc, a = link.anchor, end = link.endAnchor;
    return (model.marks || []).filter(function (m) {
      if (m.type !== "alternate" || SD.isObjectMark(m) !== SD.isObjectMark(link)) return false;
      if (!m.anchor || m.anchor.nodeKey !== a.nodeKey || m.anchor.start !== a.start || m.anchor.len !== a.len) return false;
      if (!!end !== !!m.endAnchor) return false;
      return !end || (m.endAnchor.nodeKey === end.nodeKey && m.endAnchor.len === end.len);
    });
  }
  // The altId a target (a whole linked block, or one inline span inside a block) currently points at.
  function sourceLinkTargetAlt(target) {
    if (target.kind === "block") return (target.block.sourceLink && target.block.sourceLink.altId) || null;
    return target.spanEl ? (target.spanEl.getAttribute("data-alt") || null) : null;
  }
  // Point a target at an alternate (altId) or back to base (null). Block -> block.sourceLink.altId;
  // span -> data-alt on that span inside the owning block's rich text. This block/span ONLY.
  function setSourceLinkTargetAlt(target, altId) {
    if (target.kind === "block") {
      if (!target.block.sourceLink) return;
      if (altId) target.block.sourceLink.altId = altId; else delete target.block.sourceLink.altId;
    } else {
      var host = document.createElement("div"); host.innerHTML = target.block.text || "";
      var sp = host.querySelector('span[data-source-link="' + target.markId + '"]');
      if (!sp) return;
      if (altId) sp.setAttribute("data-alt", altId); else sp.removeAttribute("data-alt");
      target.block.text = host.innerHTML;
    }
    pushHistory(); reapplyBlock(target.block); decorateSourceLinks(); scheduleSave();
    sourceToast(altId ? "Alternate applied to this block." : "Reset to base wording.");
  }
  // Create a new alternate wording on the source master, then point THIS target at it. Text only in
  // v1 (an object/figure alternate is whole-block; figure-swap storage is a follow-up).
  function createSourceAlternate(target, masterId, markId) {
    var SD = window.SourceDoc, master = libComponents()[masterId];
    if (!master || !master.doc) return;
    var model = SD.fromJSON(master.doc);
    var link = SD.markById(model, markId); if (!link) return;
    if (SD.isObjectMark(link)) { sourceToast("Object (figure) alternates are coming soon."); return; }
    var base = SD.markText(model, link);
    var shell = dsModalShell({
      title: "Create an alternate",
      subtitle: "A named fork of this passage, applied to this block only. It registers on the source, so you can reuse or push it later.",
      primaryLabel: "Create alternate",
      onPrimary: function () {
        var wording = (ta.value || "").trim();
        if (!wording) { ta.focus(); return; }
        var alt = SD.addMark(model, { type: "alternate", anchor: link.anchor, endAnchor: link.endAnchor, alt: wording, tag: (nameIn.value || "").trim(), baseText: base });
        master.doc = SD.toJSON(model); saveLibrary();
        setSourceLinkTargetAlt(target, alt.id);
        shell.modal.close();
      }
    });
    var nameIn = modalText(shell.body, "Name (optional)", "", "e.g. Short form");
    var lbl = modalField(shell.body, "Wording");
    var ta = h("textarea", "prop-text modal-field__control"); ta.rows = 3; ta.value = base; lbl.appendChild(ta);
    setTimeout(function () { ta.focus(); ta.select(); }, 0);
  }
  // The per-target source-link menu (badge / span indicator): jump to source, pick base or an
  // existing alternate, or create a new one. Reuses the canonical context menu.
  function openSourceLinkMenu(target, masterId, markId, x, y) {
    var SD = window.SourceDoc, master = libComponents()[masterId];
    var cur = sourceLinkTargetAlt(target);
    var items = [{ label: "Jump to source", onClick: function () { jumpSourcePanelToMark(masterId, markId); } }, { sep: true },
      { label: "Base wording", active: !cur, onClick: function () { setSourceLinkTargetAlt(target, null); } }];
    if (master && master.doc) {
      var model = SD.fromJSON(master.doc);
      var link = SD.markById(model, markId);
      if (link) sourceLinkAlternates(model, link).forEach(function (alt) {
        items.push({ label: (alt.tag ? alt.tag + " — " : "") + sourceAltSnippet(alt.alt), active: cur === alt.id, onClick: function () { setSourceLinkTargetAlt(target, alt.id); } });
      });
    }
    items.push({ sep: true }, { label: "Create an alternate…", onClick: function () { createSourceAlternate(target, masterId, markId); } });
    showContextMenu(x, y, items);
  }

  // ==== source-link 09/10: live where-used + base-edit warning + alternate push =================
  // The real, live where-used for a source link mark: every block (or inline span) in ANY document
  // that references it, computed by walking the registry (like libraryWhereUsedDetail) so it never
  // drifts from a stored list. altId per location = whether that placement shows base or a fork.
  function sourceLinkWhereUsed(masterId, markId) {
    var out = [], reg = registry; // the LIVE in-memory registry (getRegistry() returns a stale storage copy)
    Object.keys(reg).forEach(function (code) {
      var d = reg[code]; if (!d) return;
      var title = (d.meta && d.meta.title) || code;
      walkBlocks(d, function (b) {
        if (b.sourceLink && b.sourceLink.masterId === masterId && (!markId || b.sourceLink.markId === markId)) {
          out.push({ docCode: code, docTitle: title, blockId: b.id, markId: b.sourceLink.markId, altId: b.sourceLink.altId || null, kind: "block" });
        }
        if (b.text && typeof b.text === "string" && b.text.indexOf("data-source-link=") !== -1) {
          var probe = document.createElement("div"); probe.innerHTML = b.text;
          Array.prototype.forEach.call(probe.querySelectorAll("span[data-source-link]"), function (sp) {
            if (sp.getAttribute("data-master") !== masterId) return;
            var mid = sp.getAttribute("data-source-link"); if (markId && mid !== markId) return;
            out.push({ docCode: code, docTitle: title, blockId: b.id, markId: mid, altId: sp.getAttribute("data-alt") || null, kind: "span" });
          });
        }
      });
    });
    return out;
  }
  // Set/clear a where-used location's altId in ITS OWN document (block field or inline span data-alt).
  // Shared by the 09 fork + the 10 push.
  function applyAltToLocation(reg, loc, altId) {
    var d = reg[loc.docCode]; if (!d) return;
    walkBlocks(d, function (b) {
      if (b.id !== loc.blockId) return;
      if (loc.kind === "span") {
        var host = document.createElement("div"); host.innerHTML = b.text || "";
        var sp = host.querySelector('span[data-source-link="' + loc.markId + '"]');
        if (sp) { if (altId) sp.setAttribute("data-alt", altId); else sp.removeAttribute("data-alt"); b.text = host.innerHTML; }
      } else if (b.sourceLink) {
        if (altId) b.sourceLink.altId = altId; else delete b.sourceLink.altId;
      }
    });
  }

  // --- 09: base-edit warning + fork (fires at LOCK, matching the unlock->lock commit model) ---
  var __sourceLinkOldText = null, __sourcePreEditModelJson = null;
  // On unlock: snapshot each link mark's current wording (so "fork" can freeze it) + the whole model
  // (so "cancel" can revert the edits). Only when the doc actually carries link marks.
  function snapshotSourceLinkBase() {
    var SD = window.SourceDoc, model = __sourceDocModel;
    __sourceLinkOldText = null; __sourcePreEditModelJson = null;
    if (!SD || !model || !(model.marks || []).some(function (m) { return m.type === "link"; })) return;
    __sourceLinkOldText = {};
    (model.marks || []).forEach(function (m) { if (m.type === "link") __sourceLinkOldText[m.id] = SD.markText(model, m); });
    __sourcePreEditModelJson = SD.toJSON(model);
  }
  // The blast radius of the just-finished edit session: base-showing locations of edited link marks.
  function sourceBaseEditImpact() {
    var SD = window.SourceDoc, model = __sourceDocModel;
    if (!SD || !model || !__sourceLinkOldText) return { affected: [], pinned: [], editedMarks: [] };
    return SD.sourceEditImpact(model, __sourceLinkOldText, sourceLinkWhereUsed(__sourceActiveTopicId, null));
  }
  // "Keep as-is (fork)": freeze each edited link mark's OLD wording as an alternate on the master,
  // and pin every affected (base-showing) location -- in whatever document uses it -- to that
  // alternate. The source base then moves on; those placements keep the old words.
  function forkAffectedToAlternate(impact) {
    var SD = window.SourceDoc, model = __sourceDocModel, reg = registry, byMark = {};
    impact.affected.forEach(function (loc) { (byMark[loc.markId] = byMark[loc.markId] || []).push(loc); });
    Object.keys(byMark).forEach(function (markId) {
      var link = SD.markById(model, markId); if (!link) return;
      var oldText = __sourceLinkOldText[markId];
      var alt = SD.addMark(model, { type: "alternate", anchor: link.anchor, endAnchor: link.endAnchor, alt: oldText, tag: "Frozen", baseText: oldText });
      byMark[markId].forEach(function (loc) { applyAltToLocation(reg, loc, alt.id); });
    });
    saveRegistry(reg); // the alternate marks on the master persist via the lock's own commit
  }
  function finalizeSourceLock(topic, opts) {
    flushSourceEditSession(topic, { prompt: opts.prompt });
    __sourceUnlocked = false; __sourceLinkOldText = null; __sourcePreEditModelJson = null;
    applySourceLockState(); refreshSourceSelBar(); updateSourceDocBar();
  }
  function revertSourceEditSession(topic) {
    var SD = window.SourceDoc;
    if (SD && __sourcePreEditModelJson && topic) {
      __sourceDocModel = SD.fromJSON(__sourcePreEditModelJson); __sourceDocModelTopicId = topic.id;
      persistSourceDocModel(topic, __sourceDocModel);
    }
    __sourceEditSession = null; __sourceUnlocked = false; __sourceLinkOldText = null; __sourcePreEditModelJson = null;
    renderSourceArticle();
    sourceToast("Edit cancelled.");
  }
  // The three-way warning shown at lock when the edit changed linked passages (09).
  function showSourceBaseEditModal(topic, impact, opts) {
    var n = impact.affected.length, resolved = false;
    var forkBtn = window.VersoUI.Button({ variant: "secondary", label: "Keep as-is (fork)", onClick: function () {
      resolved = true; forkAffectedToAlternate(impact); shell.modal.close(); finalizeSourceLock(topic, opts);
      sourceToast("Kept " + n + " linked place" + (n === 1 ? "" : "s") + " on the old wording.");
    } });
    var shell = dsModalShell({
      title: "This source is linked in " + n + " place" + (n === 1 ? "" : "s"),
      subtitle: "Your edit changes wording that other documents link. Choose what those linked copies do.",
      primaryLabel: "Update all",
      cancelLabel: "Cancel edit",
      extras: [forkBtn],
      onPrimary: function () { resolved = true; shell.modal.close(); finalizeSourceLock(topic, opts); sourceToast("Updated " + n + " linked place" + (n === 1 ? "" : "s") + "."); },
      onClose: function () { if (resolved) return; revertSourceEditSession(topic); } // Cancel / Escape / scrim = revert
    });
    shell.body.appendChild(h("div", "insp-hint", "Update all — the linked copies re-resolve to your new wording. Keep as-is — freeze their current wording as an alternate, then your source moves on. Cancel — undo this edit."));
  }

  window.__sourceLink = { // browser-verify hooks
    sourceLinkWhereUsed: sourceLinkWhereUsed, snapshotSourceLinkBase: snapshotSourceLinkBase,
    sourceBaseEditImpact: sourceBaseEditImpact, forkAffectedToAlternate: forkAffectedToAlternate,
    pushSourceAlternate: pushSourceAlternate, applyAltToLocation: applyAltToLocation,
    armSourceLinkPlacement: armSourceLinkPlacement, placeArmedSourceLink: placeArmedSourceLink,
    jumpSourcePanelToMark: jumpSourcePanelToMark, panelSelectionDescriptor: panelSelectionDescriptor,
    startSourceLinkDrag: startSourceLinkDrag, pageIndexFromPoint: pageIndexFromPoint,
    openSourceLinkMenu: openSourceLinkMenu, createSourceAlternate: createSourceAlternate,
    setSourceLinkTargetAlt: setSourceLinkTargetAlt, sourceLinkAlternates: sourceLinkAlternates,
    isArmed: function () { return !!__armedSourceLink; }
  };
  // One-time global wiring: while a linked passage is armed, the next canvas click PLACES it (capture
  // phase, before the canvas's own click-select), and Escape cancels arming.
  if (typeof document !== "undefined" && !window.__sourceLinkWired) {
    window.__sourceLinkWired = true;
    document.addEventListener("click", function (e) {
      if (!__armedSourceLink) return;
      var cv = document.getElementById("canvas-viewport");
      if (cv && cv.contains(e.target)) { e.preventDefault(); e.stopPropagation(); placeArmedSourceLink(e.clientX, e.clientY); }
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && __armedSourceLink) { e.preventDefault(); cancelArmedSourceLink(); } });
  }
  // (source-link 03) The SPEC 7 / #137 whole-topic +-insert (insertSourceLinkedBlock) is retired:
  // the Edit Source tab is now a read-only viewer (02) and copy is placed as a range-linked block
  // via select-then-place (armSourceLinkPlacement above), not a whole-topic libraryInstance.
  // Two-way link, direction 2: a linked block's affordance opens the Source stage on its topic.
  function jumpToSourceTopic(topicId) {
    if (!topicId) return;
    __sourceActiveTopicId = topicId;
    try { localStorage.setItem(SOURCE_TOPIC_PERSIST_KEY, topicId); } catch (e) {}
    setStage("source");
  }
  // Two-way link, direction 1: open the doc, land in Edit, and select the exact linked block.
  function jumpToLinkedBlock(docCode, blockId) {
    openCourseFromBrowser(docCode);
    setStage("edit");
    var b = blockById(blockId);
    if (b) {
      var pi = findPageOfBlock(b);
      if (pi != null && pi >= 0) { focusFrame(pi); setActivePage(pi); }
      reselectBlockNode(b, "block");
    }
  }
  function wireLeftSwitcher() {
    renderAssets();
    renderComponentsPalette();
    try { var saved = localStorage.getItem(LEFT_SECTION_KEY); if (LEFT_SECTIONS.indexOf(saved) !== -1) _activeLeftSection = saved; } catch (e) {}
    applyLeftSection(_activeLeftSection);
  }

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
    if (interactMode) decorateInteractHandle();
    decorateVariantVersionBadges(); // #148: on-canvas version-cycle badge on image blocks with variant versions
    decorateStyleAudit(); // #145: mark unstyled text blocks when the audit toggle is on
    renderCommentPins(); // §12: re-project review pins (canvas.innerHTML was cleared)
    if (typeof CollabChrome !== "undefined") { CollabChrome.ensure(); CollabChrome.reproject(); } // ticket 11: presence chrome (server-mode only; inert in standalone)

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
  // Cmd/Ctrl+Shift+F toggles a readout of the browser's real frame cadence during pan/zoom vs
  // the JS cost of applyView, so we can separate paint/composite-bound jank (frame ms >>
  // applyView-JS ms) from script-bound jank. This is how we decide whether the canvas
  // needs an architectural change (native-scroll pan / cached-layer zoom) rather than more
  // JS micro-opt. Purely diagnostic; the loop only runs while the HUD is on.
  var perfHud = null, perfOn = false, _perfRaf = 0, _perfLast = 0, _perfFrames = [], _perfMaxFrame = 0, _perfViewJs = 0, _perfViewN = 0;
  function perfTick(ts) {
    if (!perfOn) return;
    if (_perfLast) { var dt = ts - _perfLast; _perfFrames.push(dt); if (dt > _perfMaxFrame) _perfMaxFrame = dt; if (_perfFrames.length > 90) _perfFrames.shift(); }
    _perfLast = ts;
    if (!perfTick._acc || ts - perfTick._acc > 250) {
      perfTick._acc = ts;
      var n = _perfFrames.length || 1;
      var avg = _perfFrames.reduce(function (a, b) { return a + b; }, 0) / n;
      var fps = avg > 0 ? Math.round(1000 / avg) : 0;
      var vjs = _perfViewN ? (_perfViewJs / _perfViewN) : 0;
      if (perfHud) perfHud.textContent = "FPS " + fps + "   frame " + avg.toFixed(1) + "ms (max " + _perfMaxFrame.toFixed(0) + ")   applyView-JS " + vjs.toFixed(2) + "ms/" + _perfViewN;
      _perfViewJs = 0; _perfViewN = 0; _perfMaxFrame = 0;
    }
    _perfRaf = requestAnimationFrame(perfTick);
  }
  function togglePerfHud() {
    perfOn = !perfOn;
    if (perfOn) {
      if (!perfHud) { perfHud = h("div", "perf-hud"); document.body.appendChild(perfHud); }
      perfHud.hidden = false; perfHud.textContent = "perf HUD on - pan / zoom now";
      _perfLast = 0; _perfFrames = []; _perfMaxFrame = 0; _perfViewJs = 0; _perfViewN = 0;
      _perfRaf = requestAnimationFrame(perfTick);
    } else {
      if (_perfRaf) { cancelAnimationFrame(_perfRaf); _perfRaf = 0; }
      if (perfHud) perfHud.hidden = true;
    }
  }
  window.__perfHud = togglePerfHud;
  // Diagnostic A/B: the world carries a permanent `will-change: transform` (CSS). On a
  // very large world that layer can be too big to GPU-cache, so the browser repaints it
  // every pan/zoom frame -- worse than not promoting it. __wc('auto') drops the promotion
  // so you can FEEL the difference; __wc('transform') restores it. Console-only helper.
  window.__wc = function (v) { if (world) world.style.willChange = v || "auto"; return world && (world.style.willChange || "(from CSS: transform)"); };

  window.addEventListener("keydown", function (e) {
    // Perf HUD toggle. Match on e.code (physical key) so macOS Option-mangled characters
    // (Option+Shift+P types a special char, breaking an e.key match) never break it.
    // Cmd/Ctrl+Shift+F (F = FPS) is the primary; Option+Shift+P kept as a fallback.
    if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyF") ||
        (e.altKey && e.shiftKey && e.code === "KeyP")) { e.preventDefault(); togglePerfHud(); return; }
    if (e.code === "Space" && !isTextTarget(e.target)) { spaceHeld = true; canvas.classList.add("is-pannable"); e.preventDefault(); }

    var isZ = e.key === "z" || e.key === "Z";
    var isY = e.key === "y" || e.key === "Y";
    var meta = e.metaKey || e.ctrlKey;
    if (meta && !e.shiftKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); openFindReplace(); return; } // Cmd/Ctrl+F = find & replace
    if (meta && e.shiftKey && (e.key === "g" || e.key === "G") && !isTextTarget(e.target) &&
        selection.type === "block" && selection.block && selection.block.type === "group") {
      e.preventDefault(); ungroupBlock(selection.block); return; // Cmd+Shift+G = ungroup
    }
    if (meta && (e.key === "g" || e.key === "G") && multiSel.length >= 2 && !isTextTarget(e.target)) {
      e.preventDefault(); groupMulti(); return;
    }
    if (meta && isZ) {
      e.preventDefault();
      if (document.activeElement && isTextTarget(document.activeElement)) {
        document.activeElement.blur();
      }
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    } else if (meta && isY) {
      e.preventDefault();
      if (document.activeElement && isTextTarget(document.activeElement)) {
        document.activeElement.blur();
      }
      redo();
    } else if (meta && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomIn();
    } else if (meta && e.key === "-") {
      e.preventDefault();
      zoomOut();
    } else if (meta && e.key === "0") {
      e.preventDefault();
      fitAll();
    } else if (meta && (e.key === "a" || e.key === "A") && !isTextTarget(e.target)) {
      e.preventDefault();
      // Select-first mode: a SELECTED (not-editing) text field -> enter edit + select ALL
      // its text (what you expect in a box), NOT select-all-blocks. Default mode keeps the
      // text contenteditable so isTextTarget already routes Cmd+A to the native select-all.
      if (selection.type === "field" && selection.node && selection.node.getAttribute("data-edit") != null && selection.node.getAttribute("contenteditable") !== "true") {
        enterTextEdit(selection.node);
        try { var r = document.createRange(); r.selectNodeContents(selection.node); var sa = window.getSelection(); sa.removeAllRanges(); sa.addRange(r); } catch (_) {}
      } else {
        selectAllOnPage();
      }
    } else if (meta && (e.key === "d" || e.key === "D") && !isTextTarget(e.target)) {
      e.preventDefault(); duplicateSelection();
    } else if (meta && (e.key === "c" || e.key === "C") && !isTextTarget(e.target)) {
      if (copySelection()) e.preventDefault();
    } else if (meta && (e.key === "v" || e.key === "V") && !isTextTarget(e.target)) {
      // Cmd+V pastes as-is; Cmd+Shift+V pastes WITHOUT formatting (inherits theme/target).
      if (pasteClipboard(e.shiftKey)) e.preventDefault();
    } else if (meta && (e.key === "p" || e.key === "P") && !isTextTarget(e.target)) {
      e.preventDefault(); enterDemo(); // Cmd+P = open preview
    } else if (meta && e.key === ",") {
      // uio-F06 keyboard contract. Cmd-, opens Settings where you left it; Alt+Cmd-, opens the
      // settings for what is selected -- which IS the inspector, since the inspector holds the
      // sheet's Block scope. So the modified form puts the sheet away and hands the dock back.
      e.preventDefault();
      if (e.altKey) openSelectionSettings(); else openSettingsModal();
    } else if (meta && (e.key === "k" || e.key === "K") && !isTextTarget(e.target)) {
      e.preventDefault(); openQuickJump(); // the one index: settings, actions, guide, pages, blocks
    } else if (meta && e.key === "\\" && !isTextTarget(e.target)) {
      e.preventDefault(); togglePanels(); // Cmd+\ = hide/show side panels (maximise canvas)
    } else if (meta && e.code === "Digit1") {
      e.preventDefault(); zoomTo100();
    } else if (!meta && e.shiftKey && e.code === "Digit1" && !isTextTarget(e.target)) {
      e.preventDefault(); fitAll();
    } else if (!meta && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !isTextTarget(e.target) &&
               selection.block && (selection.type === "block" || selection.type === "field" || selection.type === "embed" || selection.type === "navButton")) {
      e.preventDefault(); moveBlock(selection.block, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "." && !meta && !isTextTarget(e.target)) {
      e.preventDefault();
      fitSelection();
    } else if ((e.key === "c" || e.key === "C") && !meta && !e.shiftKey && !isTextTarget(e.target) && !demoIsOpen()) {
      e.preventDefault();
      setCommentMode(!commentMode); // §12: toggle canvas comment mode (demo has its own C)
    } else if (e.key === "Escape" && !isTextTarget(e.target)) {
      // §12: Escape first closes an open comment popover, then exits comment mode.
      if (commentMode) { if (openCommentId) { closeCommentPopover(); renderCommentPins(); } else setCommentMode(false); return; }
      if (multiSel.length || multiSelPages.length) { clearAllMulti(); renderStructure(); refreshCanvasSelection(); }
      else if (twoStateText() && SEL.escapeStep(drill) != null) {
        // §74 rule 3: Escape steps OUT one drill level (block -> columns -> ... ),
        // clearing only after the outermost level.
        drill.index = SEL.escapeStep(drill); applyDrillLevel(drill.levels[drill.index]);
      }
      else clearSelection();
    } else if ((e.key === "Delete" || e.key === "Backspace") && (!isTextTarget(e.target) || multiSel.length)) {
      if (deleteSelection()) e.preventDefault();
    }
  });
  // Delete the current selection (multi-selected blocks, or a single selected
  // block/embed/nav button). Pages and component instances are left to their
  // inspector's explicit delete (more destructive / needs confirmation).
  function deleteSelection() {
    if (multiSel.length) {
      pushHistory();
      // ref-based removal (via findBlockParent) so NESTED blocks — inside columns /
      // group / frame children — delete too, not just top-level (multi-select now spans
      // containers + pages). Re-resolve per block so sibling index shifts don't matter.
      multiSel.slice().forEach(function (b) {
        for (var pi = 0; pi < doc.pages.length; pi++) {
          var res = findBlockParent(doc.pages[pi].blocks, b);
          if (res) { res.parentArray.splice(res.index, 1); break; }
        }
      });
      doc.pages.forEach(function (page) { cleanupColumns(page.blocks); });
      clearAllMulti(); clearSelection(); mount();
      return true;
    }
    if ((selection.type === "block" || selection.type === "embed" || selection.type === "navButton") && selection.block) {
      deleteBlockByRef(selection.block);
      return true;
    }
    // SSS two-state: a text FIELD selected but NOT being edited (contenteditable off)
    // deletes its block — same as any other selected block. (In the default mode the
    // field is always contenteditable, so this never fires and text-delete is normal.)
    if (selection.type === "field" && selection.block && selection.node &&
        selection.node.getAttribute && selection.node.getAttribute("contenteditable") !== "true") {
      deleteBlockByRef(selection.block);
      return true;
    }
    return false;
  }
  // a single selected block, whatever the selection flavour it arrived as
  function selectedSingleBlock() {
    if ((selection.type === "block" || selection.type === "embed" || selection.type === "navButton" || selection.type === "field") && selection.block) return selection.block;
    return null;
  }
  function selectAllOnPage() {
    var p = doc.pages[currentPage]; if (!p) return;
    clearSelection(); clearMultiPages();
    multiSel = (p.blocks || []).filter(function (b) { return !b.locked; });
    renderStructure(); refreshCanvasSelection(); renderInspector(); // #131: surface the multi inspector + floating bar on select-all
  }
  function duplicateSelection() {
    if (multiSel.length) {
      pushHistory();
      var news = [];
      multiSel.slice().forEach(function (b) { var loc = getBlockPageIndexAndIndex(b); if (loc) { var c = remintIds(clone(b)); doc.pages[loc.pageIndex].blocks.splice(loc.blockIndex + 1, 0, c); news.push(c); } });
      multiSel = news; mount(); return;
    }
    var b = selectedSingleBlock(); if (b) duplicateBlock(b);
  }
  // §96 slice 1: cross-FILE paste dependency carry. switchDoc keeps the in-memory
  // clipboard (it's an in-app swap, not a reload), so a block copied in doc A can be
  // pasted into doc B — but the block may reference named text styles (styleRef) or a
  // component def (componentGrid.component) that is CUSTOM to doc A. Without carrying
  // those, the pasted block loses its named style or renders "[unknown component]".
  // We snapshot ONLY the referenced defs at COPY time (source doc still current) and
  // merge the MISSING ones into the target at paste. STANDARD styles/components need no
  // carry — both docs seed the same globals (TEXT_STYLES / COMPONENTS), so a shared name
  // already resolves; and a same-named def the TARGET owns wins (the paste adopts the
  // target's house style — the normal cross-doc named-style contract). Pure + testable.
  /* @pastedeps-start */
  function collectPasteDeps(blocks, srcStyles, srcComponents) {
    var styleNames = {}, compKeys = {};
    (function walk(v) {
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) walk(v[i]); return; }
      if (v && typeof v === "object") {
        if (typeof v.styleRef === "string" && v.styleRef) styleNames[v.styleRef] = true;
        if (v.type === "componentGrid" && typeof v.component === "string" && v.component) compKeys[v.component] = true;
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k]);
      }
    })(blocks);
    var out = { styles: {}, components: {} };
    Object.keys(styleNames).forEach(function (n) { if (srcStyles && srcStyles[n] != null) out.styles[n] = clone(srcStyles[n]); });
    Object.keys(compKeys).forEach(function (k) { if (srcComponents && srcComponents[k] != null) out.components[k] = clone(srcComponents[k]); });
    return out;
  }
  // Merge captured deps into the target style/component maps, ADD-IF-MISSING only.
  // Returns the names actually added (paste toast + tests); never clobbers a target def.
  function mergePasteDeps(deps, tgtStyles, tgtComponents) {
    var added = { styles: [], components: [] };
    if (deps && deps.styles) Object.keys(deps.styles).forEach(function (n) {
      if (tgtStyles && tgtStyles[n] == null) { tgtStyles[n] = clone(deps.styles[n]); added.styles.push(n); }
    });
    if (deps && deps.components) Object.keys(deps.components).forEach(function (k) {
      if (tgtComponents && tgtComponents[k] == null) { tgtComponents[k] = clone(deps.components[k]); added.components.push(k); }
    });
    return added;
  }
  /* @pastedeps-end */
  window.__pasteDeps = { collect: collectPasteDeps, merge: mergePasteDeps }; // headless test hook

  var clipboard = []; // cloned blocks (Cmd+C / Cmd+V)
  var clipboardDeps = { styles: {}, components: {} }; // §96: styles/components the clipboard blocks reference
  var pageClipboard = null; // §96 slice 2: a whole page + its deps (same-doc + cross-file)
  function copySelection() {
    // §96 slice 2: a PAGE is selected -> copy the whole page (blocks + page props + deps).
    // Cmd+V then pastes the page after the current one; routing keys off pageClipboard.
    if (selection.type === "page" && selection.node != null) {
      var pg = doc.pages[selection.node];
      if (!pg) return false;
      pageClipboard = { page: clone(pg), deps: collectPasteDeps(pg.blocks || [], doc.styles, doc.components) };
      clipboard = []; // route the next paste to the page path
      return true;
    }
    var items = [];
    if (multiSel.length) items = multiSel.map(clone);
    else { var b = selectedSingleBlock(); if (b) items = [clone(b)]; }
    if (!items.length) return false;
    clipboard = items;
    clipboardDeps = collectPasteDeps(items, doc.styles, doc.components); // capture NOW (source doc is current)
    pageClipboard = null; // a block copy supersedes any held page
    return true;
  }
  // §96 slice 2: paste the held page AFTER the current page (same-doc or cross-file).
  // Mirrors duplicatePage (fresh page + block ids, courseNav section sync) but also
  // carries custom styles/components into THIS doc and re-homes the page into the insert
  // anchor's chapter (the source's chapterId is meaningless in another file).
  function pastePage() {
    if (!pageClipboard) return false;
    if (!doc.pages) return false;
    pushHistory();
    var copy = clone(pageClipboard.page);
    copy.id = "page-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    (copy.blocks || []).forEach(remintIds);
    mergePasteDeps(pageClipboard.deps, getTextStyles(), getComponents()); // add-if-missing
    window.applyRenderContext({ docStyles: getTextStyles() });
    var at = (currentPage != null && currentPage >= 0 && currentPage < doc.pages.length) ? currentPage : doc.pages.length - 1;
    var anchor = doc.pages[at];
    copy.chapterId = anchor ? (anchor.chapterId || null) : ((doc.pages[0] && doc.pages[0].chapterId) || null);
    doc.pages.splice(at + 1, 0, copy);
    eachCourseNav(function (nav) {
      (nav.sections || []).forEach(function (sec) {
        var i = anchor ? (sec.pageIds || []).indexOf(anchor.id) : -1;
        if (i >= 0 && sec.pageIds.indexOf(copy.id) < 0) sec.pageIds.splice(i + 1, 0, copy.id);
      });
    });
    currentPage = at + 1;
    mount();
    setActivePage(at + 1);
    focusFrame(at + 1);
    setSelection("page", at + 1);
    return true;
  }
  // Paste-without-formatting (Cmd+Shift+V): strip block-level style + inline text formatting
  // from the pasted subtree so it inherits the theme / target defaults. Recurses into nested
  // children. SKIPS raw embed / asset markup (html/svg/src + full documents) so an interaction
  // keeps its own styling. Deletes style/styleRef on every node; removes inline formatting
  // tags (b/i/span/font/…) + style="" attrs from rich text, keeping structural tags (li/p/br).
  function stripFormattingDeep(v) {
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) stripFormattingDeep(v[i]); return; }
    if (v && typeof v === "object") {
      delete v.style; delete v.styleRef;
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
        var val = v[k];
        if (typeof val === "string") {
          if (k === "html" || k === "svg" || k === "src") continue;
          if (/<!doctype|<html[\s>]/i.test(val)) continue;
          v[k] = val.replace(/<\/?(?:b|i|u|s|span|font|strong|em|sub|sup|mark|small)(?:\s[^>]*)?>/gi, "").replace(/\sstyle="[^"]*"/gi, "");
        } else stripFormattingDeep(val);
      }
    }
  }
  window.__stripFormattingDeep = stripFormattingDeep; // headless test hook
  function pasteClipboard(strip) {
    if (pageClipboard && !clipboard.length) return pastePage(); // §96 slice 2: a page is held
    if (!clipboard.length) return false;
    var p = doc.pages[currentPage]; if (!p) return false;
    pushHistory();
    // §96: carry any CUSTOM styles/components the clipboard references into THIS doc
    // (add-if-missing) so a cross-file paste keeps its named style + resolves its
    // component. No-op for a same-doc paste / standard defs. Skip carrying styles when
    // stripping (paste-without-formatting drops styleRef anyway).
    if (!strip) mergePasteDeps(clipboardDeps, getTextStyles(), getComponents());
    else mergePasteDeps({ styles: {}, components: clipboardDeps.components }, getTextStyles(), getComponents());
    window.applyRenderContext({ docStyles: getTextStyles() }); // render resolves the newly-carried styles this pass
    var news = clipboard.map(function (b) { var c = remintIds(clone(b)); if (strip) stripFormattingDeep(c); return c; });
    var L = insertLoc(); // FFFF: paste after the selected block (into its own container — incl. a hotspot card), else bottom
    news.forEach(function (c, i) { L.array.splice(L.index + i, 0, c); });
    clearSelection(); clearMultiPages(); multiSel = news.slice();
    // PERF: paste lands on ONE page (the selection's / currentPage); rebuild just it.
    // If the pasted blocks somehow span pages, findPageOfBlock(news[0]) still isolates
    // the first; a not-found (-1) falls back to a full mount inside reapplyStructural.
    reapplyStructural(findPageOfBlock(news[0])); return true;
  }
  // §96 browser-verify hook: drive the real cross-FILE flow (copy in A -> switchDoc B ->
  // paste) through the actual paste + dependency-carry wiring, not a reimplementation.
  window.__xfer = {
    registry: function () { return registry; },
    currentDoc: function () { return doc; },
    addDoc: function (d) { registry[d.meta.code] = d; },
    switchDoc: switchDoc,
    loadClipboard: function (items, srcStyles, srcComponents) { clipboard = items.map(clone); clipboardDeps = collectPasteDeps(clipboard, srcStyles, srcComponents); pageClipboard = null; },
    loadPageClipboard: function (pg, srcStyles, srcComponents) { pageClipboard = { page: clone(pg), deps: collectPasteDeps(pg.blocks || [], srcStyles, srcComponents) }; clipboard = []; },
    clipboardDeps: function () { return clipboardDeps; },
    paste: function (strip) { return pasteClipboard(strip); },
    setPage: function (i) { currentPage = i; }
  };

  // Copy Style / Paste Style: lift ONLY presentation keys off a block (never content or
  // identity) so pasting pushes the LOOK onto another block. render ignores keys that don't
  // apply to the target type (a paragraph has no box/colorMap), so it's safe across types +
  // additive (only the source's keys are written).
  var STYLE_KEYS = ["style", "styleRef", "box", "cardBox", "colorMap", "embedColorMap", "embedBg", "coverColor", "coverOpacity", "coverBlur", "cardH", "cols", "gap", "fit", "fitH", "fitFill", "padding", "maxWidth", "border", "borderColor", "borderWidth", "radius", "height", "spaceTop", "spaceBottom", "autoTint", "themeFallback", "align"];
  var styleClipboard = null;
  function copyBlockStyle(block) {
    if (!block) return false;
    var out = {};
    STYLE_KEYS.forEach(function (k) { if (block[k] !== undefined) out[k] = clone(block[k]); });
    if (!Object.keys(out).length) return false;
    styleClipboard = out; return true;
  }
  function pasteBlockStyle(block) {
    if (!styleClipboard || !block) return false;
    pushHistory();
    Object.keys(styleClipboard).forEach(function (k) { block[k] = clone(styleClipboard[k]); });
    mount(); return true;
  }
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
  function selectionScreenRects() {
    var rects = [];
    multiSel.forEach(function (b) { var n = canvasNodeForBlock(b); if (n) rects.push(n.getBoundingClientRect()); });
    multiSelPages.forEach(function (i) { var f = frameDescs[i] && frameDescs[i].frame; if (f) rects.push(f.getBoundingClientRect()); });
    if (selection.type === "page") { var f = frameDescs[selection.pageIndex] && frameDescs[selection.pageIndex].frame; if (f) rects.push(f.getBoundingClientRect()); }
    else if (selection.node) { var host = (selection.node.closest && selection.node.closest(".canvas-block")) || selection.node; rects.push(host.getBoundingClientRect()); }
    return rects;
  }
  function fitSelection() {
    var rects = selectionScreenRects();
    if (!rects.length) { fitAll(); return; }
    var cr = canvas.getBoundingClientRect();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach(function (r) { minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); });
    var wx = (minX - cr.left - view.x) / view.zoom, wy = (minY - cr.top - view.y) / view.zoom;
    fitWorldRect(wx, wy, (maxX - minX) / view.zoom, (maxY - minY) / view.zoom);
  }

  // Canvas multi-select: Shift/Cmd-click an element toggles it into the selection.
  // Capture phase (registered BEFORE the leaf-first click handler below) so it owns
  // every modifier-click and beats contentEditable focus / block mousedown handlers.
  canvas.addEventListener("mousedown", function (e) {
    // A PAN gesture (middle-click, or Space-held left-drag) must NOT clear the selection —
    // the whole point of panning/zooming is to reposition and then act on what's selected,
    // so the selection has to survive it. (The pan itself is handled by the next listener.)
    if (e.button === 1 || (spaceHeld && e.button === 0)) return;
    if (e.shiftKey || e.metaKey) {
      // LEAF-FIRST (James 2026-07-12): toggle the element UNDER THE CURSOR, not the whole
      // top-level block (canvasTopBlock) — so two siblings inside one card/column can be
      // multi-selected. Seed from the current single selection so the first modifier-click
      // makes a pair. Bail on locked / non-block chrome (never selects).
      var levels = buildDrillLevels(e.target);
      var node = levels.length ? levels[leafSelectIndex(levels)].node : null;
      if (node && node.__block && !node.__block.locked) {
        e.preventDefault(); e.stopPropagation();
        if (!multiSel.length && selection && selection.block && selection.block !== node.__block) multiSel.push(selection.block);
        resetDrill(); toggleMulti(node.__block); renderInspector();
      }
      return;
    }
    if (multiSel.length || multiSelPages.length) { clearAllMulti(); refreshCanvasSelection(); renderInspector(); }
  }, true);

  // ---- §74 progressive drill-in selection (select-first mode) --------------
  // Build the outermost->innermost stack of selectable levels at a click point.
  // Simple text blocks are ONE node that is both `.canvas-block` and `[data-edit]`
  // (see render.js editable()) -> they collapse to a single "field" level, so the
  // stack for a bare paragraph is [field, edit] (select then edit). Structural
  // container blocks (frame/group/columns/cardReveal) add an outer "block" level.
  // `.layout-column` / `.card-reveal__card` are structural but have no selection
  // identity yet, so they are skipped (deferred, noted in BACKLOG §74).
  function buildDrillLevels(target) {
    var top = canvasTopBlock(target);
    if (!top || !top.__block || top.__block.locked) return [];
    var inner = []; // innermost-first
    var n = target;
    while (n && n.nodeType === 1) {
      // Progressive disclosure (James 2026-07-08): a node that is BOTH a canvas-block AND an
      // editable field (a simple text block) now yields BOTH levels — the block tier (Layout/
      // Spacing/Appearance) then the field tier (Type). The old `else if` collapsed them, so a
      // text block jumped straight to the combined field panel and you never got block settings.
      if (n.matches("[data-edit]")) inner.push({ kind: "field", node: n });
      if (n.classList.contains("canvas-block") && n.__block) {
        // Only give a data-edit node its OWN extra block tier when it's a PLAIN text block
        // (heading/paragraph/note/…, i.e. selection type "field"). Special field-types like
        // navButton keep their single bespoke inspector and must not gain a generic block panel.
        if (!n.matches("[data-edit]") || getSelectionTypeForBlock(n.__block) === "field") inner.push({ kind: "block", node: n });
      }
      if (n === top) break;
      n = n.parentNode;
    }
    var levels = inner.reverse(); // outermost-first (block before field for a dual-role node)
    if (!levels.length) return [];
    // A terminal editable field's final step ENTERS the caret AND shows the Type inspector in
    // one click (the "edit" step calls selectFieldNode itself), so you go block -> type+edit
    // without a dead "field selected, not editing" middle click.
    var leaf = levels[levels.length - 1];
    if (leaf.kind === "field" && leaf.node.classList.contains("is-editable")) levels[levels.length - 1] = { kind: "edit", node: leaf.node };
    return levels;
  }
  function applyDrillLevel(l) {
    if (!l) return;
    applyingDrill = true;
    try {
      clearAllMulti();
      if (l.kind === "edit") { selectFieldNode(l.node); enterTextEdit(l.node); } // Type inspector + caret in one step
      else if (l.kind === "field") { blurActiveText(); selectFieldNode(l.node); }
      // Block tier: force a BLOCK selection even for a data-edit text node (selectByType would
      // map data-edit -> field). Keep selectByType for embeds/navButtons/componentGrid/columns.
      else if (l.node.getAttribute && l.node.getAttribute("data-edit") != null && l.node.__block) { blurActiveText(); setSelection("block", l.node); }
      else { blurActiveText(); selectByType(l.node, l.node.__block); }
    } finally { applyingDrill = false; }
  }
  // LEAF-FIRST (James 2026-07-12, issue-follow-up): a plain click selects the
  // INNERMOST element under the cursor (a heading inside a card selects the
  // heading, not the card) — the deepest level whose kind is not "edit" (the caret
  // step is reached by double-click). Pure so tests/run.js can guard it without a DOM.
  function leafSelectIndex(levels) {
    // Innermost element = the deepest level's node. Step back over ITS OWN caret
    // ("edit") level to the block/field select-level, but NEVER past it into an
    // ancestor: an element whose ONLY level is editable (e.g. navButton, whose block
    // tier is suppressed) must still select ITSELF, not the container it sits in.
    return SEL.leafSelectIndex(levels);
  }
  // A single capture-phase handler owns canvas clicks in select-first mode: it picks
  // the leaf level (below) before any per-node mousedown drops a caret / selects a
  // container, routes Shift/Cmd into the multi-selection, and defers a press-drag on
  // the selected leaf so a native move wins over entering text edit. Bespoke subtrees
  // (embeds, hotspots, card instances, the drag / interact handles) keep their own handlers.
  canvas.addEventListener("mousedown", function (e) {
    if (!twoStateText()) return;                 // click-to-edit escape hatch: old behaviour
    if (interactMode || commentMode) return;     // interact / comment mode own their click semantics
    if (e.button !== 0 || e.shiftKey || e.metaKey || spaceHeld) return;   // Shift/Cmd multi-select is owned by the handler above
    if (isTextTarget(e.target)) return;          // already editing this field -> native caret
    if (e.target.closest(".canvas-drag-handle, .interact-handle, [data-embed], [data-hotspot-block], [data-instance]")) return;
    // Contextual sidebar (James 2026-07-08): the footer nav bar is chrome (parent is the footer,
    // not .page) so the normal drill/canvasTopBlock never reaches it. Select it when its BACKGROUND
    // is clicked — not a nav button / mode toggle / editable label (those keep their own behaviour)
    // — so the sidebar surfaces the Learner-nav controls (renderCourseNavInspector).
    var navBar = e.target.closest(".course-nav.canvas-block");
    if (navBar && navBar.__block && !e.target.closest("[data-edit], .course-nav__btn, .mode-toggle, button, a")) {
      e.preventDefault(); e.stopPropagation();
      blurActiveText(); resetDrill(); setSelection("block", navBar);
      return;
    }
    var levels = buildDrillLevels(e.target);
    if (!levels.length) return;                  // background / chrome -> let marquee + deselect run
    var leafIndex = leafSelectIndex(levels);     // deepest NON-edit level = the element under the cursor
    var leaf = levels[leafIndex];
    var editLevel = levels[levels.length - 1];   // kind "edit" only when the leaf is editable text
    var leafBlock = leaf.node && leaf.node.__block;

    // ---- Plain click already ON the selected leaf: the selected block is the PHASE-2
    // drag surface, so a press-DRAG must MOVE it and a double-click must EDIT. Defer to
    // mouseup; if the pointer drags (native dragstart or >4px move) do nothing (the move
    // ran), else a double-click enters the caret. NOT preventDefault so the browser can
    // start the native drag; stopPropagation so the field's own mousedown (which would
    // preventDefault-select and BLOCK the drag) never runs. THIS is the fix for "click,
    // then click-hold to move" being swallowed as a double-click into text edit.
    // Keyed on the NODE (the press is on the block that is currently selected AND
    // draggable), NOT selection.block -- setSelection leaves selection.block null for
    // some types (e.g. navButton), which would wrongly drop those out of the drag path.
    var leafHost = leaf.node && leaf.node.closest && leaf.node.closest(".canvas-block");
    var selHost = selection && selection.node && selection.node.closest && selection.node.closest(".canvas-block");
    var onSelectedLeaf = leafBlock && !multiSel.length && leafHost && leafHost === selHost &&
      leafHost.getAttribute("draggable") === "true";
    if (onSelectedLeaf) {
      e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, moved = false;
      function onMove(ev) { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true; }
      function onDrag() { moved = true; }
      function onUp() {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        window.removeEventListener("dragstart", onDrag, true);
        if (!moved && e.detail >= 2 && editLevel.kind === "edit") {
          drill.levels = levels; drill.index = levels.length - 1;
          applyDrillLevel(editLevel);            // double-click, no drag -> enter text edit
        }
      }
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
      window.addEventListener("dragstart", onDrag, true);
      return;
    }

    // ---- New target: select the LEAF directly (leaf-first). drill.index tracks the leaf
    // so Escape steps OUTWARD (leaf -> parent container -> ... -> deselect); a plain click
    // clears any prior multi-selection.
    e.preventDefault(); e.stopPropagation();
    clearAllMulti();
    drill.levels = levels; drill.index = leafIndex;
    // A leaf that is the caret ("edit") step -- an element like navButton whose only
    // drill level is editable -- SELECTS on a single click without dropping the caret
    // (so it becomes draggable, and doesn't jump straight into text edit); a
    // double-click still edits (the field's own dblclick + the onSelectedLeaf branch).
    if (leaf.kind === "edit") { blurActiveText(); selectFieldNode(leaf.node); }
    else applyDrillLevel(leaf);
  }, true);

  // ==========================================================================
  // §12 slice 2 — Comment mode: drop review pins on the canvas, 3-tier anchored
  // (block > page > world). Pins are EDITOR CHROME (an overlay on the fixed
  // canvas viewport) — they live OUTSIDE render.js output and never ship in the
  // export (mirrors the selection / drag chrome). The store is `doc.comments`,
  // persisted in the .json, stripped from SCORM.
  // ==========================================================================
  var COMMENT_MODE_KEY = "authoring.commentMode";
  var commentBtn = document.getElementById("comment-toggle");
  var commentPinLayer = null; // canvas pin overlay
  var demoPinLayer = null;    // §12 slice 4: preview pin overlay
  var demoCommentMode = false; // §12 slice 4: comment mode inside the demo/preview
  var openCommentId = null;   // the comment whose popover is open
  var editingComment = null;  // the comment currently being edited (for empty-drop cleanup)
  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
  // §12 slice 4: comment pins work on TWO surfaces — the authoring canvas and the
  // demo/preview — sharing ONE store (doc.comments). A surface descriptor abstracts
  // the differences: where to query blocks/pages (`root`), where the pin overlay
  // lives (`layerParent` + `getLayer`), the container the pins position against
  // (`rect`), and whether world/general anchors apply (canvas-only). `activeSurf()`
  // picks the demo while it's open + in comment mode, else the canvas.
  function canvasSurf() {
    return { name: "canvas", root: world, layerParent: canvas,
      getLayer: function () { if (!commentPinLayer) commentPinLayer = h("div", "comment-pin-layer"); return commentPinLayer; },
      rect: function () { return canvas.getBoundingClientRect(); }, allowWorld: true,
      worldToPx: function (a) { return { px: view.x + a.worldX * view.zoom, py: view.y + a.worldY * view.zoom }; },
      inMode: function () { return commentMode; } };
  }
  function demoSurf() {
    return { name: "demo", root: demoDeviceEl(), layerParent: demoStageEl(),
      getLayer: function () { if (!demoPinLayer) demoPinLayer = h("div", "comment-pin-layer"); return demoPinLayer; },
      rect: function () { return demoStageEl().getBoundingClientRect(); }, allowWorld: false,
      worldToPx: function () { return null; }, // world/general pins are canvas-only
      inMode: function () { return demoCommentMode; } };
  }
  // Demo is the active surface WHENEVER the preview overlay is open (pins are shown
  // there in read mode too); demoCommentMode only gates DROPPING new pins.
  function activeSurf() { return demoIsOpen() ? demoSurf() : canvasSurf(); }

  function setCommentMode(on) {
    on = !!on;
    if (commentMode === on) return;
    commentMode = on;
    try { localStorage.setItem(COMMENT_MODE_KEY, on ? "1" : "0"); } catch (e) {}
    canvas.classList.toggle("is-comment-mode", commentMode);
    if (commentBtn) commentBtn.classList.toggle("is-active", commentMode);
    if (commentMode) { if (interactMode) setInteractMode(false); closeCommentPopover(); clearSelection(); clearAllMulti(); refreshCanvasSelection(); }
    else closeCommentPopover();
    renderInspector();   // slice 3 swaps the panel to the comment list while in-mode
    renderCommentPins();
  }
  // §12 slice 3: the right panel becomes the comment LIST while in comment mode.
  var commentFilter = "open"; // "open" | "resolved"
  function renderCommentList() {
    inspector.innerHTML = ""; panelFields = {}; // self-clearing: the filter/resolve/row
    // handlers call this directly (not via renderInspector), so it must not double-append.
    var UI = window.VersoUI; // DS canonical control set (re-skin, issue #17)
    // uio-O-W2 (OVL-07): the identity + sidecar controls are a section, not a bold line with no
    // affordance. The filter and the list below are the panel's own rows.
    var _cmtRoot = inspector;
    inspector = panelSection(_cmtRoot, "Comments");
    // §12 slice 5: who am I (author identity) + sidecar transport
    var idn = commentIdentity();
    var idRow = h("div", "comment-identity");
    var idDot = h("span", "comment-row__dot"); idDot.style.background = idn.colour;
    var nameField = UI.TextField({ value: idn.name });
    nameField.classList.add("comment-identity__field");
    nameField.input.title = "Your name (stamped on comments you drop)";
    nameField.input.addEventListener("change", function () { setCommentAuthor(nameField.input.value); renderCommentList(); });
    idRow.appendChild(idDot); idRow.appendChild(nameField);
    inspector.appendChild(idRow);
    // sidecar transport — Export / Import (two secondary buttons, 2-up)
    inspector.appendChild(UI.TwoUp({ children: [
      UI.Button({ variant: "secondary", full: true, label: "Export…", title: "Save comments as a sidecar JSON", onClick: function () { exportComments(); } }),
      UI.Button({ variant: "secondary", full: true, label: "Import…", title: "Merge a reviewer's comments file", onClick: function () { importComments(); } })
    ] }));
    inspector = _cmtRoot;
    var list = (doc.comments || []);
    var openN = list.filter(function (c) { return !c.done; }).length;
    var resN = list.length - openN;
    // Open / Resolved filter — primary = active (2-up)
    inspector.appendChild(UI.TwoUp({ children: [
      UI.Button({ variant: commentFilter === "open" ? "primary" : "secondary", full: true, label: "Open (" + openN + ")", onClick: function () { commentFilter = "open"; renderCommentList(); } }),
      UI.Button({ variant: commentFilter === "resolved" ? "primary" : "secondary", full: true, label: "Resolved (" + resN + ")", onClick: function () { commentFilter = "resolved"; renderCommentList(); } })
    ] }));
    var shown = list.filter(function (c) { return commentFilter === "resolved" ? c.done : !c.done; });
    // ticket 26: split off ORPHANED notes (block-anchored, block since deleted) into their own tray
    // so a reviewer's feedback is never silently lost when the author deletes the block it points at.
    var orphaned = shown.filter(function (c) { return commentIsOrphaned(c, doc); });
    var anchored = shown.filter(function (c) { return !commentIsOrphaned(c, doc); });
    if (!shown.length) {
      inspector.appendChild(h("div", "insp-hint", commentFilter === "resolved" ? "No resolved comments yet." : "No open comments. Click anywhere on the canvas to drop one."));
      return;
    }
    // one row builder, reused for the anchored list + the orphaned tray (ticket 26).
    function commentRow(c, isOrphan) {
      var row = h("div", "comment-row" + (c.id === openCommentId ? " is-open" : "") + (isOrphan ? " is-orphan" : ""));
      var dot = h("span", "comment-row__dot"); if (c.colour) dot.style.background = c.colour;
      var mid = h("div", "comment-row__mid");
      var top = h("div", "comment-row__meta");
      if (c.author) top.appendChild(h("span", "comment-row__name", c.author));
      if (commentIsGuest(c)) top.appendChild(h("span", "comment-row__tag is-guest", "Guest")); // ticket 26: guest-vs-internal
      if (top.childNodes.length) mid.appendChild(top);
      var text = (c.body || "").trim();
      mid.appendChild(h("span", "comment-row__snip" + (text ? "" : " is-empty"), text || "(empty note)"));
      if (isOrphan) mid.appendChild(h("div", "comment-row__orphan-note", "The block this points at was deleted."));
      row.appendChild(dot); row.appendChild(mid);
      if (isOrphan) {
        var dismiss = iconBtn("trash", "Dismiss this orphaned note", true);
        dismiss.addEventListener("click", function (e) { e.stopPropagation(); pushHistory(); doc.comments = (doc.comments || []).filter(function (x) { return x.id !== c.id; }); scheduleSave(); renderCommentPins(); renderCommentList(); });
        row.appendChild(dismiss);
      } else {
        var box = UI.Checkbox({ checked: !!c.done, onChange: function (v) { pushHistory(); c.done = v; if (typeof CollabChrome !== "undefined") CollabChrome.fanoutResolve(c, v); scheduleSave(); renderCommentPins(); renderCommentList(); } });
        box.classList.add("comment-row__done"); box.title = "Resolve";
        box.addEventListener("click", function (e) { e.stopPropagation(); });
        row.appendChild(box);
        row.addEventListener("click", function () { jumpToComment(c); renderCommentList(); });
      }
      return row;
    }
    var listWrap = h("div", "comment-list");
    anchored.forEach(function (c) { listWrap.appendChild(commentRow(c, false)); });
    inspector.appendChild(listWrap);
    if (orphaned.length) {
      inspector.appendChild(h("div", "comment-group__head", "Orphaned — need a home (" + orphaned.length + ")"));
      inspector.appendChild(h("div", "insp-hint", "These notes lost the block they pointed at. Kept, never dropped — re-anchor by re-adding the block, or dismiss."));
      var orphanWrap = h("div", "comment-list is-orphan-tray");
      orphaned.forEach(function (c) { orphanWrap.appendChild(commentRow(c, true)); });
      inspector.appendChild(orphanWrap);
    }
  }
  // Re-render the panel list after a comment change (only while in comment mode —
  // renderInspector clears + routes to renderCommentList; calling it directly would
  // double-append). No-op otherwise so leaving the mode shows the normal inspector.
  function refreshCommentPanel() { if (commentMode) renderInspector(); }
  // §12 slice 5: author identity + colour (per reviewer). Stored in localStorage so
  // this machine's drops carry a stable name + a deterministic colour; the schema
  // already reserved author/colour, so this is additive (no migration).
  var COMMENT_AUTHOR_KEY = "authoring.commentAuthor";
  var COMMENT_COLOURS = ["#f5a623", "#4d7cad", "#e0563f", "#2ea36b", "#9b59b6", "#e91e8c", "#0d99ff", "#d4a017"];
  function colourForName(name) { var x = 0; name = name || ""; for (var i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) >>> 0; return COMMENT_COLOURS[x % COMMENT_COLOURS.length]; }
  function commentIdentity() {
    try { var s = JSON.parse(localStorage.getItem(COMMENT_AUTHOR_KEY) || "null"); if (s && s.name) return s; } catch (e) {}
    return { name: "Me", colour: colourForName("Me") };
  }
  function setCommentAuthor(name) {
    name = (name || "").trim() || "Me";
    var id = { name: name, colour: colourForName(name) };
    try { localStorage.setItem(COMMENT_AUTHOR_KEY, JSON.stringify(id)); } catch (e) {}
    return id;
  }
  // §12 slice 5: a reply on a comment (threading). Same author/colour stamp.
  function makeReply(body) {
    var id = commentIdentity();
    return { id: "rp_" + Math.random().toString(36).slice(2, 8), body: body || "", author: id.name || null, colour: id.colour || null, createdAt: Date.now() };
  }
  // §12 slice 5: the air-gapped transport. Comments export as a standalone SIDECAR
  // JSON (never baked into the course / SCORM); a reviewer sends it back and it is
  // MERGED (union by id, replies unioned, resolve adopted) — conflict-free, so two
  // people's notes combine without clobbering.
  function exportComments() {
    var payload = { type: "verso-comments", version: 1, exportedBy: commentIdentity().name, exportedAt: Date.now(), comments: doc.comments || [] };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "comments-" + (doc.code || doc.id || "course") + ".json"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  // ===== Live-collaboration chrome (platform-pivot ticket 11; SERVER-MODE ONLY) =========
  // Presence avatars (this increment) + remote cursors + held-block read-only chrome (11b).
  // ONE controller, INERT unless VersoSync.isCollaborating(): every render path hangs off that
  // single gate, so standalone/solo shows NO presence chrome and takes exactly today's branches.
  // Reuses colourForName (the comment-review palette -> one colour per person everywhere). Nothing
  // here touches render()/course.css -- editor chrome only.
  //
  // PURE model (headless-tested; no DOM, no network): the peers list -> the avatar cluster to draw
  // (editing vs viewing, deterministic initials, "+N" overflow past `max`). The server's
  // presence.state peer carries {name/author, colour, viewingBlockId, editingBlockId, cursor}.
  /* @presence-model-start */
  function presenceInitials(name) {
    var parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return ((parts[0][0] || "?") + (parts.length > 1 ? (parts[parts.length - 1][0] || "") : "")).toUpperCase();
  }
  function presenceModel(peers, max) {
    max = max || 4;
    var list = (peers || []).map(function (p) {
      var nm = p.name || p.author || "?";
      return { name: nm, initials: presenceInitials(nm), colour: p.colour || null,
        editing: p.state === "editing" || !!p.editingBlockId,
        blockId: p.editingBlockId || p.viewingBlockId || p.blockId || null };
    });
    return { shown: list.slice(0, max), overflow: Math.max(0, list.length - max), total: list.length };
  }
  // ticket 11b: locate a top-level block's page/index by stable id (the remote block.change
  // target). Pure; returns {pi, bi} or null. The server's block.change is keyed by stable id.
  function findBlockLocation(pages, id) {
    for (var p = 0; p < (pages || []).length; p++) {
      var bs = (pages[p] && pages[p].blocks) || [];
      for (var b = 0; b < bs.length; b++) if (bs[b] && bs[b].id === id) return { pi: p, bi: b };
    }
    return null;
  }
  // ticket 11b: which locks earn read-only chrome -- CONTENT locks held by SOMEONE ELSE (never my
  // own; structure locks are momentary and not shown). Pure; -> [{blockId, holder}].
  function peerHeldBlocks(locks, meName) {
    return (locks || []).filter(function (lk) {
      var cls = lk.class || lk.klass || "content";
      var who = lk.author || lk.holder;
      return cls === "content" && !!(lk.resourceId || lk.blockId) && !!who && who !== meName;
    }).map(function (lk) { return { blockId: lk.resourceId || lk.blockId, holder: lk.author || lk.holder }; });
  }
  // ticket 13-UI: the soft-conflict prompt rows. Joins VersoSync.conflictView() (WHICH block +
  // MY buffered edit) with the server's CURRENT block from the reduced doc, so the modal can show
  // "my edits vs current/restored" side by side. Pure; never drops a conflict (a row with no
  // server block still surfaces). -> [{blockId, mine, theirs, hasMine, serverSeq}].
  function conflictRows(view, doc) {
    var pages = (doc && doc.pages) || [];
    return (view || []).map(function (c) {
      var loc = findBlockLocation(pages, c.blockId);
      var theirs = loc ? pages[loc.pi].blocks[loc.bi] : null;
      return { blockId: c.blockId, mine: c.mine || null, theirs: theirs, hasMine: !!c.hasMine, serverSeq: c.serverSeq };
    });
  }
  // ticket 13-UI: a compact text preview of a block for the two conflict panes (headline text /
  // body / first string field). Pure; falls back to a short JSON snippet so nothing renders blank.
  function blockPreview(b) {
    if (!b) return "(deleted)";
    var f = b.text || b.body || b.html || b.title || b.caption;
    if (typeof f === "string") return f.replace(/<[^>]+>/g, "").trim() || "(empty)";
    try { var s = JSON.stringify(b); return s.length > 160 ? s.slice(0, 157) + "…" : s; } catch (e) { return "(block)"; }
  }
  // ticket 11 (RemoteCaret): which peers show a live cursor/gaze flag on a block -- those VIEWING a
  // block (an EDITING peer already shows via the held-block chip, so skip them to avoid doubling).
  // Never me. Pure; -> [{blockId, name, colour}].
  function viewerCursors(peers, meName) {
    return (peers || []).filter(function (p) {
      var nm = p.name || p.author;
      return !!nm && nm !== meName && !p.editingBlockId && !!p.viewingBlockId;
    }).map(function (p) {
      var cur = p.cursor || null;
      var offset = cur ? (cur.offset != null ? cur.offset : (cur.selection && cur.selection.offset)) : null;
      return { blockId: p.viewingBlockId, name: p.name || p.author, colour: p.colour || null, offset: (typeof offset === "number" ? offset : null) };
    });
  }
  /* @presence-model-end */

  var CollabChrome = (function () {
    var wired = false, session = null, peers = [], locks = [], pending = [];
    var resolvedConflicts = [], notifyArmed = {};
    // send-side (drives the pipe from the local author's edit lifecycle); all no-op in standalone.
    var HEARTBEAT_MS = 12000, EDIT_DEBOUNCE_MS = 400, CURSOR_THROTTLE_MS = 120, IDLE_RELEASE_MS = 30000;
    var editingBlockId = null, viewingBlockId = null, beatTimer = null, editTimer = null, pendingBlock = null;
    var caretPending = false, lastCaret = null, idleTimer = null;
    function enabled() { return !!(window.VersoSync && window.VersoSync.enabled); }
    function live() { return !!(window.VersoSync && window.VersoSync.isCollaborating()); }
    // find a top-level canvas block by its stable id (data-id), escaping the selector. Shared by
    // the lock chrome + the remote cursors (both address blocks by the same stable id).
    function blockElById(id) {
      var esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
      return canvas.querySelector('.canvas-block[data-id="' + esc + '"]');
    }

    function clusterEl() {
      var host = document.querySelector(".toolbar__group--right");
      if (!host) return null;
      var el = host.querySelector(".collab-presence");
      if (!el) { el = h("div", "collab-presence"); host.insertBefore(el, host.firstChild); }
      return el;
    }
    // ticket 11: the presence avatar cluster (avatars of who is here, editing vs viewing).
    function renderPresence() {
      var el = clusterEl(); if (!el) return;
      if (!live() || !peers.length) { el.innerHTML = ""; el.style.display = "none"; return; }
      el.style.display = "";
      el.innerHTML = "";
      var m = presenceModel(peers, 4);
      m.shown.forEach(function (p) {
        var av = h("div", "collab-av" + (p.editing ? " is-editing" : " is-viewing"));
        av.style.setProperty("--acol", p.colour || "#888");
        av.setAttribute("title", p.name + (p.editing ? " — editing" : " — viewing"));
        av.textContent = p.initials;
        el.appendChild(av);
      });
      if (m.overflow) { var more = h("div", "collab-av collab-av--more"); more.textContent = "+" + m.overflow; el.appendChild(more); }
    }
    // ticket 11b: a fanned-out remote block.change -> patch the ONE changed block on the live
    // canvas by stable id. Caret-safe: while the local author is typing, DEFER (queue) and flush
    // on the next blur, so a peer's edit never yanks a caret. (Block-locking already prevents a
    // peer editing the block I hold, so the deferred window only affects my own in-flight typing.)
    function applyRemote(env) {
      if (!env || env.type !== "block.change" || !env.blockId) return;
      var patch = env.payload && env.payload.patch;
      if (typeof patch === "string") { try { patch = JSON.parse(patch); } catch (e) { return; } }
      if (!patch) return;
      if (typeof isTextTarget === "function" && isTextTarget(document.activeElement)) { pending.push(env); return; }
      var loc = findBlockLocation((doc && doc.pages) || [], env.blockId);
      if (!loc) return;
      doc.pages[loc.pi].blocks[loc.bi] = patch;
      try { reapplyStructural(loc.pi); } catch (e) { try { mount(); } catch (e2) {} } // re-render just that page (mount() if previewing)
      // a remote block.change swaps the block OBJECT -> if the tour builder is open on that same
      // block, its captured reference just went stale; re-bind it to the live doc (same guard as undo/setDoc).
      if (typeof rebindTourBuilderToLiveDoc === "function") { try { rebindTourBuilderToLiveDoc(); } catch (e) {} }
      reproject();
    }
    function flushPending() {
      if (!pending.length) return;
      var q = pending; pending = [];
      q.forEach(applyRemote);
    }
    // ticket 11b: held-block read-only chrome. A block a PEER holds a content lock on gets an
    // author-colour inset outline + an "editing…" holder chip and goes contenteditable=false
    // (the visible face of ticket 15's read-only gate). My own locks show no chrome.
    function renderLocks() {
      Array.prototype.forEach.call(canvas.querySelectorAll(".collab-held"), function (el) {
        el.classList.remove("collab-held"); el.style.removeProperty("--hcol"); el.removeAttribute("data-collab-holder");
        el.removeAttribute("aria-readonly");
        var c = el.querySelector(".collab-held__chip"); if (c) c.remove();
      });
      if (!live()) return;
      var me = commentIdentity().name;
      peerHeldBlocks(locks, me).forEach(function (hb) {
        var el = blockElById(hb.blockId);
        if (!el) return;
        var colour = colourForName(hb.holder);
        el.classList.add("collab-held"); el.style.setProperty("--hcol", colour);
        el.setAttribute("data-collab-holder", hb.holder); el.setAttribute("aria-readonly", "true");
        var chip = h("div", "collab-held__chip"); chip.style.setProperty("--hcol", colour);
        var av = h("span", "collab-held__av"); av.textContent = presenceInitials(hb.holder); chip.appendChild(av);
        chip.appendChild(h("span", "collab-held__lbl", hb.holder + " editing…"));
        chip.setAttribute("role", "button"); chip.setAttribute("title", "Ask " + hb.holder + " for this block");
        chip.onclick = function (e) { e.stopPropagation(); openHeldMenu(e, hb); };
        el.appendChild(chip);
      });
    }
    // ticket 13-UI: the human path out of a stuck lock -- a ContextMenu off the held-block chip.
    // Request handoff nudges the holder; notify-when-free arms a ping on release. Both go over the
    // presence channel (server relays them). Light-dismiss (click-out / Escape).
    function closeHeldMenu() { var m = document.querySelector(".collab-menu"); if (m) m.remove(); }
    function openHeldMenu(e, hb) {
      closeHeldMenu();
      var armed = !!notifyArmed[hb.blockId];
      var menu = h("div", "collab-menu");
      var bh = h("button", "collab-menu__item", "Request handoff");
      bh.onclick = function (ev) { ev.stopPropagation(); closeHeldMenu(); if (session && session.requestHandoff) session.requestHandoff(hb.blockId); toast(hb.holder + " nudged for this block"); };
      var bn = h("button", "collab-menu__item" + (armed ? " is-armed" : ""), armed ? "Notifying when free" : "Notify me when free");
      bn.onclick = function (ev) { ev.stopPropagation(); closeHeldMenu(); notifyArmed[hb.blockId] = !armed; if (session && session.notifyWhenFree) session.notifyWhenFree(hb.blockId, !armed); toast(!armed ? "You’ll be told when this block frees" : "Notify-when-free off"); };
      menu.appendChild(bh); menu.appendChild(bn);
      document.body.appendChild(menu);
      var r = e.currentTarget.getBoundingClientRect();
      var MENU_W = 200; // the menu's min-width (190) + a small viewport margin; keep it on-screen
      menu.style.left = Math.min(r.left, window.innerWidth - MENU_W) + "px";
      menu.style.top = (r.bottom + 6) + "px";
    }
    // a tiny transient toast (reused for handoff/notify confirmation; light, non-blocking)
    function toast(msg) {
      var t = h("div", "collab-toast", msg); document.body.appendChild(t);
      requestAnimationFrame(function () { t.classList.add("is-on"); });
      setTimeout(function () { t.classList.remove("is-on"); setTimeout(function () { if (t.parentNode) t.remove(); }, 220); }, 3000);
    }
    // ---- ticket 13-UI: the soft-conflict prompt (reconnect-collision + restore-collision) ----
    // Driven by VersoSync.conflictView() joined with the current doc. Two panes -- my buffered
    // edits vs the current/restored block -- and a deliberate Keep mine / Use theirs. NEVER auto-
    // dismisses and NEVER silently drops. `variant` = "server" (reconnect) | "restored" (restore).
    function showConflicts(variant) {
      if (!live() || !window.VersoSync || !window.VersoSync.conflictView) return;
      var rows = conflictRows(window.VersoSync.conflictView(), window.VersoSync._state ? window.VersoSync._state().doc : (doc || null))
        .filter(function (r) { return resolvedConflicts.indexOf(r.blockId) === -1; });
      if (!rows.length) { closeConflict(); return; }
      var r = rows[0]; // resolve one block at a time; the modal reopens for the next
      var theirsLabel = variant === "restored" ? "Restored version" : "Current on server";
      var desc = variant === "restored"
        ? "An admin restored this course while you had unsaved edits."
        : "This block moved on while you were disconnected.";
      closeConflict();
      var scrim = h("div", "collab-scrim"); scrim.setAttribute("data-collab-conflict", "1");
      var modal = h("div", "collab-modal");
      modal.appendChild(h("div", "collab-modal__title", "Resolve your unsaved edits"));
      modal.appendChild(h("div", "collab-modal__desc", desc + " Nothing is lost — choose which to keep. (" + rows.length + " to resolve)"));
      var panes = h("div", "collab-panes");
      var pMine = h("div", "collab-pane is-mine"); pMine.appendChild(h("div", "collab-pane__h", "Your edits")); pMine.appendChild(h("div", "collab-pane__b", blockPreview(r.mine)));
      var pTheirs = h("div", "collab-pane"); pTheirs.appendChild(h("div", "collab-pane__h", theirsLabel)); pTheirs.appendChild(h("div", "collab-pane__b", blockPreview(r.theirs)));
      panes.appendChild(pMine); panes.appendChild(pTheirs);
      modal.appendChild(panes);
      var foot = h("div", "collab-modal__foot");
      var useTheirs = h("button", "collab-btn", "Use " + (variant === "restored" ? "restored" : "theirs"));
      var keepMine = h("button", "collab-btn is-primary", "Keep mine");
      useTheirs.onclick = function () { resolveConflict(r, "theirs", variant); };
      keepMine.onclick = function () { resolveConflict(r, "mine", variant); };
      foot.appendChild(useTheirs); foot.appendChild(keepMine);
      modal.appendChild(foot);
      scrim.appendChild(modal); document.body.appendChild(scrim);
    }
    function closeConflict() {
      var s = document.querySelector(".collab-scrim[data-collab-conflict]"); if (s) s.remove();
    }
    function resolveConflict(r, which, variant) {
      resolvedConflicts.push(r.blockId);
      try {
        if (which === "mine" && r.hasMine && session && session.sendChange) {
          session.sendChange(r.blockId, r.mine, r.serverSeq); // re-assert my edit on top of the new server seq
        } else if (which === "theirs") {
          if (window.VersoSync && window.VersoSync._buffer) window.VersoSync._buffer.ack(r.blockId); // drop my buffered edit
          if (r.theirs) applyRemote({ type: "block.change", blockId: r.blockId, payload: { patch: r.theirs } });
        }
      } catch (e) {}
      showConflicts(variant); // reopen for the next unresolved block, or close when none remain
    }

    // ticket 11 (RemoteCaret): a live cursor/gaze flag for each VIEWING peer, anchored to the block
    // they're looking at (so it tracks pan/zoom with the block, like the held chip). Author-colour,
    // ephemeral, pointer-events:none -- it can never intercept a click. Editors show via the chip.
    function renderCursors() {
      Array.prototype.forEach.call(canvas.querySelectorAll(".collab-cursor"), function (n) { n.remove(); });
      if (!live()) return;
      var me = commentIdentity().name;
      viewerCursors(peers, me).forEach(function (vc) {
        var el = blockElById(vc.blockId);
        if (!el) return;
        var colour = vc.colour || colourForName(vc.name);
        var caret = h("div", "collab-cursor"); caret.style.setProperty("--ccol", colour);
        caret.appendChild(h("span", "collab-cursor__flag", vc.name));
        positionCaret(caret, el, vc.offset); // ticket 11 AC2: place it at the offset WITHIN the block (corner fallback)
        el.appendChild(caret);
      });
    }
    // place a remote caret at a character offset inside a block's editable field. Best-effort +
    // guarded: on any failure it leaves the CSS default (a block-corner flag), never throws.
    function positionCaret(caret, blockEl, offset) {
      if (offset == null) return;
      try {
        var field = blockEl.querySelector("[data-edit]") || blockEl;
        var remaining = offset, node, rect = null;
        var walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT, null, false);
        while ((node = walker.nextNode())) {
          var len = node.nodeValue.length;
          if (remaining <= len) {
            var r = document.createRange(); r.setStart(node, remaining); r.collapse(true);
            rect = (r.getClientRects()[0]) || r.getBoundingClientRect(); break;
          }
          remaining -= len;
        }
        if (!rect) return;
        var br = blockEl.getBoundingClientRect();
        caret.style.top = (rect.top - br.top) + "px";
        caret.style.left = (rect.left - br.left) + "px";
        if (rect.height) caret.style.height = rect.height + "px";
      } catch (e) {}
    }
    // ticket 11 AC2: share the local caret with peers (throttled -> one send per window, latest wins).
    function onCaret(block, offset) {
      if (!live() || !block || !block.id || !session || !session.cursorUpdate || typeof offset !== "number") return;
      touchIdle(); // caret movement is activity -> keep the lock alive
      lastCaret = { blockId: block.id, offset: offset };
      if (caretPending) return;
      caretPending = true;
      setTimeout(function () {
        caretPending = false;
        if (lastCaret && live() && session && session.cursorUpdate) session.cursorUpdate(lastCaret.blockId, { offset: lastCaret.offset });
      }, CURSOR_THROTTLE_MS);
    }
    // ---- send-side: drive the pipe from the local author's edit lifecycle (tickets 11 + 13) ----
    // Nothing here runs in standalone (every method gates on live()+session). edit-intent (focus)
    // implicitly acquires the block's content lock + heartbeats; edit-commit fans the block out
    // (debounced, and recorded in the durable unacked buffer); blur/idle releases the lock.
    function beat() { if (live() && session && session.heartbeat) session.heartbeat(viewingBlockId, editingBlockId); }
    // spec story 9: auto-release a held block on IDLE (blur is handled in onEditBlur; this closes the
    // "focused but idle" gap so a walked-away author doesn't hold the lock indefinitely). Reset on any
    // edit/caret activity. In an autosave app there is no manual "save" trigger -- blur + idle cover it.
    function touchIdle() {
      if (!live()) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        idleTimer = null;
        if (live() && session && session.releaseLock && editingBlockId) { session.releaseLock(editingBlockId); editingBlockId = null; beat(); }
      }, IDLE_RELEASE_MS);
    }
    function onEditFocus(block) {
      if (!live() || !block || !block.id || !session) return;
      viewingBlockId = editingBlockId = block.id;
      if (session.acquireLock) session.acquireLock(block.id); // implicit acquire on edit-intent (spec stories 8-9)
      beat(); touchIdle();
    }
    function onEditCommit(block) {
      if (!live() || !block || !block.id) return;
      editingBlockId = viewingBlockId = block.id; // (re)engage on edit activity (e.g. typing after an idle release)
      touchIdle();
      pendingBlock = block; // coalesce rapid keystrokes; the server coalesces again downstream
      if (editTimer) clearTimeout(editTimer);
      editTimer = setTimeout(flushEdit, EDIT_DEBOUNCE_MS);
    }
    function flushEdit() {
      editTimer = null;
      if (!live() || !pendingBlock || !session || !session.sendChange) { pendingBlock = null; return; }
      var b = pendingBlock; pendingBlock = null;
      var content; try { content = JSON.parse(JSON.stringify(b)); } catch (e) { return; } // plain, serialisable
      var baseSeq = (window.VersoSync && window.VersoSync._state) ? window.VersoSync._state().seq : 0;
      session.sendChange(b.id, content, baseSeq); // fans out + records in the durable unacked buffer
    }
    function onEditBlur(block) {
      if (!live() || !block || !block.id) return;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } // blur supersedes the idle timer
      if (editTimer) { clearTimeout(editTimer); flushEdit(); } // commit any pending edit before releasing
      if (session && session.releaseLock) session.releaseLock(block.id); // auto-release on blur (spec story 9)
      if (editingBlockId === block.id) editingBlockId = null;
      beat();
    }
    // ticket 26: fan an author's reply/resolve back to the reviewer + peers (shared BOTH ways --
    // spec 4 stories 12/23). A reply is comment.add on the parent thread; the hub echoes it to the
    // origin, so ingestComment adds it locally (send-only avoids a duplicate). Translate the client
    // cid anchor -> the server stable block id. Returns true when it fanned out (server mode).
    function fanoutReply(comment, body) {
      if (!live() || !session || !session.comment || !comment) return false;
      var cid = comment.anchor && comment.anchor.blockId;
      session.comment(blockIdByCid(doc, cid) || cid, body, comment.threadId || comment.id);
      return true;
    }
    function fanoutResolve(comment, resolved) {
      if (!live() || !session || !session.resolveComment || !comment) return false;
      var cid = comment.anchor && comment.anchor.blockId;
      session.resolveComment(blockIdByCid(doc, cid) || cid, comment.threadId || comment.id, resolved);
      return true;
    }

    function onEvent(env, state) {
      if (!env) return;
      if (env.type === "presence.state") { peers = (state && state.peers) || []; reproject(); }
      else if (env.type === "lock.state") { locks = (state && state.locks) || []; reproject(); }
      else if (env.type === "block.change") { applyRemote(env); }
      else if (env.type === "block.conflict") { showConflicts("server"); }           // reconnect-collision
      else if (env.type === "sync.resnapshot") {                                       // restore-collision if I had unacked edits
        if (window.VersoSync && window.VersoSync._buffer && window.VersoSync._buffer.pending().length) showConflicts("restored");
      }
      else if (env.type === "comment.added") { ingestComment(env); }    // ticket 26: guest/author comment round-trip
      else if (env.type === "comment.resolved") { resolveThread(env); }
    }
    function afterCommentChange() { try { renderCommentPins(); if (typeof refreshCommentPanel === "function") refreshCommentPanel(); } catch (e) {} }
    // ticket 26: a comment fanned out over the sync channel (a guest reviewer's note, or another
    // author's) is mapped from the server envelope into a client comment (anchored by CID, so the
    // SHIPPED pins/panel resolve it) and upserted into doc.comments -- a delta, not a parallel comment
    // system. A reply (threadId != id) attaches to its parent's replies; else it's a top-level note.
    function ingestComment(env) {
      var c = commentFromEnv(env, doc, colourForName); if (!c) return;
      doc.comments = doc.comments || [];
      if (c.threadId && c.threadId !== c.id) {
        var parent = null;
        for (var j = 0; j < doc.comments.length; j++) if (doc.comments[j].id === c.threadId) { parent = doc.comments[j]; break; }
        if (parent) {
          var replies = parent.replies = parent.replies || [];
          // Reconcile the ORIGIN echo of my own optimistic reply. A local optimistic reply carries an
          // "rp_" id (makeReply); the server mints a fresh "cm_" id + resolves the author server-side.
          // So match my unconfirmed reply by body + the rp_ marker (NOT by author, which can differ)
          // and adopt the server id -- never a duplicate, and never collapsing two people's replies
          // (theirs arrive with cm_ ids, so they only match by exact id).
          var slot = null;
          for (var q = 0; q < replies.length; q++) {
            if (replies[q].id === c.id) { slot = replies[q]; break; } // exact echo already present
            if (slot == null && String(replies[q].id).indexOf("rp_") === 0 && replies[q].body === c.body) slot = replies[q];
          }
          if (slot) { slot.id = c.id; } // adopt the server id (reconcile the optimistic reply)
          else replies.push({ id: c.id, body: c.body, author: c.author, colour: c.colour, createdAt: c.createdAt });
          afterCommentChange(); return;
        }
      }
      var i = -1; for (var k = 0; k < doc.comments.length; k++) if (doc.comments[k].id === c.id) { i = k; break; }
      if (i >= 0) doc.comments[i] = c; else doc.comments.push(c);
      afterCommentChange();
    }
    // ticket 26: an author reply/resolve (or a guest's) marks the whole thread done, both ways.
    function resolveThread(env) {
      var p = (env && env.payload) || {};
      var threadId = p.threadId; if (!threadId) return;
      var resolved = p.resolved !== false;
      (doc.comments || []).forEach(function (c) { if (c.id === threadId || c.threadId === threadId) c.done = resolved; });
      afterCommentChange();
    }
    // Idempotent: subscribe + connect once, only in server mode. No-op in standalone.
    function ensure() {
      if (wired || !enabled()) return;
      wired = true;
      try {
        window.VersoSync.onEvent(onEvent);
        document.addEventListener("blur", flushPending, true); // flush deferred remote edits when a field loses focus
        // light-dismiss for the handoff menu (NOT the conflict modal). Wired here (server mode only)
        // -- the menu can only open while collaborating, so it never needs these in standalone.
        document.addEventListener("click", closeHeldMenu);
        document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeHeldMenu(); });
        beatTimer = setInterval(beat, HEARTBEAT_MS); // ticket 11 AC4: heartbeat drives presence TTL
        session = window.VersoSync.connect(activeDocId);
      } catch (e) {}
    }
    // Re-draw the collab overlays after a mount() (canvas.innerHTML was cleared). Cheap + gated.
    function reproject() { try { renderPresence(); renderLocks(); renderCursors(); } catch (e) {} }
    return { ensure: ensure, reproject: reproject, live: live, _model: presenceModel,
      // send-side (called from the editor's edit lifecycle)
      onEditFocus: onEditFocus, onEditCommit: onEditCommit, onEditBlur: onEditBlur, onCaret: onCaret,
      fanoutReply: fanoutReply, fanoutResolve: fanoutResolve,
      _peers: function (p) { peers = p || []; }, _locks: function (l) { locks = l || []; },
      _applyRemote: applyRemote, _flush: flushPending, _pending: function () { return pending.slice(); },
      _showConflicts: showConflicts, _openHeldMenu: openHeldMenu, _resolved: function () { return resolvedConflicts.slice(); },
      _ingestComment: ingestComment, _resolveThread: resolveThread,
      _beat: beat, _editing: function () { return editingBlockId; }, _setSession: function (s) { session = s; },
      _session: function () { return session; } };
  })();
  window.__CollabChrome = CollabChrome;

  function mergeComments(incoming) {
    doc.comments = doc.comments || [];
    var byId = {}; doc.comments.forEach(function (c) { byId[c.id] = c; });
    var added = 0, updated = 0;
    (incoming || []).forEach(function (inc) {
      if (!inc || !inc.id) return;
      var ex = byId[inc.id];
      if (!ex) { doc.comments.push(inc); byId[inc.id] = inc; added++; return; }
      var have = {}; (ex.replies || []).forEach(function (r) { if (r && r.id) have[r.id] = 1; });
      (inc.replies || []).forEach(function (r) { if (r && r.id && !have[r.id]) { ex.replies = ex.replies || []; ex.replies.push(r); have[r.id] = 1; updated++; } });
      if (inc.done && !ex.done) { ex.done = true; updated++; } // resolve wins (someone closed it)
    });
    return { added: added, updated: updated };
  }
  window.__mergeComments = mergeComments; // test hook (Viewer round-trip)
  function importComments() {
    var input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", function () {
      var file = input.files && input.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          var list = Array.isArray(parsed) ? parsed : (parsed && parsed.comments);
          if (!Array.isArray(list)) { alert("Not a Verso comments file (expected a comments array)."); return; }
          pushHistory();
          var r = mergeComments(list);
          scheduleSave(); renderCommentPins(); refreshCommentPanel();
          alert("Merged comments: " + r.added + " new, " + r.updated + " updated.");
        } catch (e) { alert("Invalid comments JSON: " + e.message); }
      };
      reader.readAsText(file);
    });
    input.click();
  }
  // Pan (keep zoom) so the comment's pin lands at the canvas centre, then open it.
  function jumpToComment(c) {
    var pos = anchorToScreen(c.anchor);
    if (pos) {
      var cr = canvas.getBoundingClientRect();
      view.x += (cr.width / 2 - pos.px); view.y += (cr.height / 2 - pos.py);
      applyView();
    }
    openCommentPopover(c);
  }
  if (commentBtn) commentBtn.addEventListener("click", function () { setCommentMode(!commentMode); });
  var gridBtn = document.getElementById("grid-toggle");
  if (gridBtn) gridBtn.addEventListener("click", cycleGrid);
  updateGridBtn(); // reflect the persisted mode on boot (overlay itself is seeded by the mount loop)
  var styleAuditBtn = document.getElementById("style-audit-toggle");
  if (styleAuditBtn) styleAuditBtn.addEventListener("click", toggleStyleAudit);
  updateStyleAuditBtn(); // reflect the persisted audit state on boot

  // Resolve a click to the MOST SPECIFIC anchor: block (cid + normalised offset) >
  // page (pageId + normalised) > world (absolute infinite-canvas coords).
  function makeAnchorFromPoint(clientX, clientY, target) {
    var s = activeSurf();
    var blockEl = target && target.closest ? target.closest(".canvas-block[data-cid]") : null;
    if (blockEl && s.root && s.root.contains(blockEl)) {
      var r = blockEl.getBoundingClientRect();
      return { blockId: blockEl.getAttribute("data-cid"),
        dx: clamp01((clientX - r.left) / (r.width || 1)), dy: clamp01((clientY - r.top) / (r.height || 1)) };
    }
    var pageEl = target && target.closest ? target.closest(".page[data-page-id]") : null;
    if (pageEl) {
      var pr = pageEl.getBoundingClientRect();
      return { pageId: pageEl.getAttribute("data-page-id"),
        x: clamp01((clientX - pr.left) / (pr.width || 1)), y: clamp01((clientY - pr.top) / (pr.height || 1)) };
    }
    // world/general = canvas-only; in the preview a drop outside a page is ignored.
    if (!s.allowWorld) return null;
    var cr = canvas.getBoundingClientRect();
    return { worldX: (clientX - cr.left - view.x) / view.zoom, worldY: (clientY - cr.top - view.y) / view.zoom };
  }
  // Anchor -> canvas-relative screen px for THIS view (null if the anchored block/
  // page isn't in the current DOM — e.g. a variant preview drops the block).
  // #181: pins anchor to a block/page node's live getBoundingClientRect(). #150 put
  // content-visibility:auto on offscreen frames ('frame--cull'), which SKIPS layout of
  // the frame's subtree while scrolled away -> a descendant .page / .canvas-block rect
  // collapses to the reserved-box origin and the pin re-projects to the wrong place or
  // page. Force the culled ancestor frame to render for the duration of the measure, then
  // restore, so the rect is always the node's real position regardless of cull state.
  function rectUnculled(n) {
    var culled = n.closest ? n.closest(".frame--cull") : null;
    if (!culled) return n.getBoundingClientRect();
    var prev = culled.style.contentVisibility;
    culled.style.contentVisibility = "visible";
    var r = n.getBoundingClientRect();
    culled.style.contentVisibility = prev;
    return r;
  }
  // ---- #197 proximity capture: resolve a pin point -> nearby blocks --------
  // The tooling needs to know WHERE a pin lives without the author spelling it out. A pin
  // dropped BESIDE a block (a non-expert drop) must still capture it — so this is proximity, not a
  // single direct hit. Pure + identifier-agnostic: items carry { cid, blockId, pageId, rect }; the
  // DOM reader below feeds real canvas rects. Distance is point-to-rect (0 when the point is inside),
  // results are nearest-first, filtered to `radius` px. Fed to the Course index (#137) via block ids
  // downstream; cid is always present, blockId only when render stamped one (block.id is lazy).
  function rectPointDistance(r, p) {
    var dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width));
    var dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height));
    return Math.sqrt(dx * dx + dy * dy);
  }
  function resolveProximity(items, point, radius) {
    radius = (radius == null) ? 0 : radius;
    return (items || [])
      .filter(function (it) { return it && it.rect; })
      .map(function (it) { return { cid: it.cid, blockId: it.blockId, pageId: it.pageId, d: rectPointDistance(it.rect, point) }; })
      .filter(function (h) { return h.d <= radius; })
      .sort(function (a, b) { return a.d - b.d; });
  }
  window.__resolveProximity = resolveProximity; // pure, test hook
  // DOM reader (wiring): collect the active surface's block boxes and resolve a client point to the
  // nearby blocks + the page the pin sits in. Default radius ~120px = "beside". pageId falls back to
  // the page directly under the point when no block is near, so a pin in whitespace still routes.
  function resolvePinContext(clientX, clientY, radius) {
    var s = activeSurf();
    if (!s || !s.root) return { pageId: null, blockIds: [], cids: [] };
    var items = [];
    var nodes = s.root.querySelectorAll(".canvas-block[data-cid]");
    Array.prototype.forEach.call(nodes, function (n) {
      var pageEl = n.closest ? n.closest(".page[data-page-id]") : null;
      var r = rectUnculled(n);
      items.push({ cid: n.getAttribute("data-cid"), blockId: n.getAttribute("data-id") || null,
        pageId: pageEl ? pageEl.getAttribute("data-page-id") : null,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
    });
    var hits = resolveProximity(items, { x: clientX, y: clientY }, radius == null ? 120 : radius);
    var pageId = hits.length ? hits[0].pageId : null;
    if (!pageId) {
      var pe = document.elementFromPoint(clientX, clientY);
      pe = (pe && pe.closest) ? pe.closest(".page[data-page-id]") : null;
      if (pe) pageId = pe.getAttribute("data-page-id");
    }
    return { pageId: pageId,
      blockIds: hits.map(function (h) { return h.blockId; }).filter(Boolean),
      cids: hits.map(function (h) { return h.cid; }).filter(Boolean) };
  }
  window.__resolvePinContext = resolvePinContext;
  function anchorToScreen(a) {
    if (!a) return null;
    var s = activeSurf();
    if (!s.root) return null;
    var cr = s.rect();
    if (a.blockId) {
      var n = s.root.querySelector('.canvas-block[data-cid="' + a.blockId + '"]');
      if (!n) return null;
      var r = rectUnculled(n);
      return { px: r.left - cr.left + (a.dx || 0) * r.width, py: r.top - cr.top + (a.dy || 0) * r.height };
    }
    if (a.pageId) {
      var pe = s.root.querySelector('.page[data-page-id="' + a.pageId + '"]');
      if (!pe) return null;
      var pr = rectUnculled(pe);
      return { px: pr.left - cr.left + (a.x || 0) * pr.width, py: pr.top - cr.top + (a.y || 0) * pr.height };
    }
    if (a.worldX != null) return s.allowWorld ? s.worldToPx(a) : null; // world pins don't exist in preview
    return null;
  }
  // Place the note popover next to its pin but CLAMPED into the surface viewport so
  // an edge-of-canvas drop never leaves the note off-screen (#212). Default is to the
  // right of the pin (pos.px + 16); if that overflows the right edge it flips to the
  // left, and the top is lifted so the bottom fits. Without this, focus({preventScroll})
  // keeps the canvas still but the note renders past the fold and looks like nothing
  // was placed. Must be called AFTER the popover is in the DOM (needs its measured size).
  // Pure clamp math (regression-guarded in tests/run.js): given the pin position, the
  // surface viewport size and the popover size, return the clamped {left, top}. A zero
  // viewport dimension (host not laid out) disables clamping on that axis.
  function clampPopover(pos, vw, vh, pw, ph, m) {
    var left = pos.px + 16;
    if (vw) {
      if (left + pw > vw - m) left = pos.px - pw - 16;          // flip to the left of the pin
      if (left < m) left = m;
      if (left + pw > vw - m) left = Math.max(m, vw - pw - m);  // still too wide -> pin to edge
    }
    var top = pos.py;
    if (vh) {
      if (top + ph > vh - m) top = Math.max(m, vh - ph - m);    // lift so the bottom fits
      if (top < m) top = m;
    }
    return { left: left, top: top };
  }
  function placePopover(pop, pos) {
    var host = activeSurf().layerParent;
    var vw = host ? host.clientWidth : 0, vh = host ? host.clientHeight : 0;
    var xy = clampPopover(pos, vw, vh, pop.offsetWidth || 240, pop.offsetHeight || 0, 8);
    pop.style.left = xy.left + "px"; pop.style.top = xy.top + "px";
  }
  // Re-project + redraw every pin. Pins are ALWAYS shown (Design mode too), so this
  // runs from mount() + applyView() (pan/zoom) as well as on any comment change.
  function renderCommentPins() {
    var s = activeSurf();
    if (!s.layerParent) return;
    // Fast path (#150): applyView() calls this on EVERY pan/zoom frame. When the course
    // has no comments there is nothing to project -- skip the layer attach + full pin
    // rebuild entirely (a big chunk of the pan/zoom cost on comment-free courses). Still
    // strip any stale pins if a layer already exists (e.g. the last comment was deleted).
    if (!(doc.comments && doc.comments.length)) {
      var lyr = (s.name === "demo") ? demoPinLayer : commentPinLayer;
      if (lyr) Array.prototype.forEach.call(lyr.querySelectorAll(".comment-pin"), function (n) { n.remove(); });
      return;
    }
    var layer = s.getLayer();
    if (layer.parentNode !== s.layerParent) s.layerParent.appendChild(layer);
    // The pin layer is `position:absolute; inset:0` INSIDE the layer parent. When that
    // parent is a scroll container -- native-scroll pan (#151) on the canvas, or the demo
    // preview's scrollable stage -- the layer scrolls WITH the content, but anchorToScreen
    // returns VIEWPORT-relative coords. Left uncompensated, every pin drifts up/left by the
    // scroll offset and clips out of view (#212 follow-up: pins never appeared once
    // native-scroll pan was enabled). Cancel the parent's scroll on the layer so its origin
    // stays glued to the viewport; a no-op (translate 0,0) in transform-pan mode.
    var _sx = s.layerParent.scrollLeft || 0, _sy = s.layerParent.scrollTop || 0;
    layer.style.transform = (_sx || _sy) ? ("translate(" + _sx + "px," + _sy + "px)") : "";
    layer.classList.toggle("is-mode", s.inMode());
    // preserve an open popover across a re-render
    var pop = layer.querySelector(".comment-popover");
    Array.prototype.forEach.call(layer.querySelectorAll(".comment-pin"), function (n) { n.remove(); });
    var commentPinLayer = layer; // local alias so the rest of the body is unchanged
    (doc.comments || []).forEach(function (c) {
      var pos = anchorToScreen(c.anchor);
      if (!pos) return;
      var pin = h("div", "comment-pin" + (c.done ? " is-done" : "") + (c.id === openCommentId ? " is-open" : ""));
      pin.style.left = pos.px + "px"; pin.style.top = pos.py + "px";
      if (c.colour && !c.done) pin.style.background = c.colour; // §12 slice 5: tint by author
      var nReplies = (c.replies || []).length;
      pin.title = (c.author ? c.author + ": " : "") + (c.body ? c.body.slice(0, 80) : "(empty note)") + (nReplies ? " (+" + nReplies + ")" : "");
      pin.textContent = c.done ? "✓" : "";
      pin.addEventListener("mousedown", function (e) { e.stopPropagation(); e.preventDefault(); openCommentPopover(c); });
      commentPinLayer.insertBefore(pin, pop || null);
    });
    if (pop) { // reposition the open popover to its pin
      var oc = (doc.comments || []).filter(function (c) { return c.id === openCommentId; })[0];
      var p2 = oc && anchorToScreen(oc.anchor);
      if (p2) { placePopover(pop, p2); } else closeCommentPopover();
    }
  }
  window.__renderCommentPins = renderCommentPins; // browser-test hook

  function closeCommentPopover() {
    // a popover may live in either surface's layer — clear both
    [commentPinLayer, demoPinLayer].forEach(function (l) { var p = l && l.querySelector(".comment-popover"); if (p) p.remove(); });
    // discard an empty note (a stray drop that was never written) — but keep it if
    // it has replies (§12 slice 5: a thread with no root body is still real).
    if (editingComment && !(editingComment.body || "").trim() && !(editingComment.replies || []).length && doc.comments) {
      var i = doc.comments.indexOf(editingComment);
      if (i !== -1) { doc.comments.splice(i, 1); scheduleSave(); }
    }
    editingComment = null;
    openCommentId = null;
    refreshCommentPanel(); // finalise the list snippet / drop the discarded row
  }
  function openCommentPopover(c) {
    closeCommentPopover();
    var UI = window.VersoUI; // DS canonical control set (re-skin, issue #17)
    var layer = activeSurf().getLayer();
    if (!layer.parentNode) renderCommentPins();
    openCommentId = c.id; editingComment = c;
    var pos = anchorToScreen(c.anchor); if (!pos) { renderCommentPins(); return; }
    var pop = h("div", "comment-popover");
    pop.style.left = (pos.px + 16) + "px"; pop.style.top = pos.py + "px";
    pop.addEventListener("mousedown", function (e) { e.stopPropagation(); }); // clicks inside stay inside
    var bodyField = UI.TextField({ multiline: true, rows: 3, value: c.body || "", placeholder: "Write a note…" });
    bodyField.classList.add("comment-popover__body");
    var ta = bodyField.input;
    var pushed = false;
    ta.addEventListener("input", function () {
      if (!pushed) { pushHistory(); pushed = true; }
      c.body = ta.value; scheduleSave(); refreshCommentPanel(); // live snippet (popover keeps focus — separate DOM)
    });
    ta.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ta.blur(); closeCommentPopover(); renderCommentPins(); } });
    var row = h("div", "comment-popover__row");
    var doneCheck = UI.Checkbox({ checked: !!c.done, label: "Resolved", onChange: function (v) { pushHistory(); c.done = v; if (typeof CollabChrome !== "undefined") CollabChrome.fanoutResolve(c, v); scheduleSave(); renderCommentPins(); refreshCommentPanel(); } });
    doneCheck.classList.add("comment-popover__done");
    var del = h("button", "comment-popover__del", "Delete");
    del.addEventListener("click", function () {
      pushHistory();
      var i = doc.comments.indexOf(c); if (i !== -1) doc.comments.splice(i, 1);
      editingComment = null; scheduleSave(); closeCommentPopover(); renderCommentPins();
    });
    row.appendChild(doneCheck); row.appendChild(del);
    // §12 slice 5: author label on the note
    if (c.author) { var au = h("div", "comment-popover__author"); var ad = h("span", "comment-row__dot"); ad.style.background = c.colour || ""; au.appendChild(ad); au.appendChild(document.createTextNode(c.author)); pop.appendChild(au); }
    pop.appendChild(bodyField); pop.appendChild(row);
    // §12 slice 5: threaded replies
    var thread = h("div", "comment-thread");
    (c.replies || []).forEach(function (rp) {
      var line = h("div", "comment-reply");
      var rd = h("span", "comment-row__dot"); rd.style.background = rp.colour || "";
      var rb = h("span", "comment-reply__body"); rb.textContent = (rp.author ? rp.author + ": " : "") + (rp.body || "");
      line.appendChild(rd); line.appendChild(rb); thread.appendChild(line);
    });
    var replyField = UI.TextField({ value: "", placeholder: "Reply…" });
    replyField.classList.add("comment-reply__input");
    replyField.input.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    var replyBtn = UI.Button({ variant: "secondary", full: true, label: "Reply", onClick: function () {
      var v = (replyField.input.value || "").trim(); if (!v) return;
      pushHistory(); c.replies = c.replies || []; c.replies.push(makeReply(v)); // optimistic local add (instant)
      if (typeof CollabChrome !== "undefined") CollabChrome.fanoutReply(c, v); // collab: fan out; the echo is deduped by content
      scheduleSave();
      openCommentPopover(c); renderCommentPins(); // rebuild the popover with the new reply
    } });
    thread.appendChild(replyField); thread.appendChild(replyBtn);
    pop.appendChild(thread);
    layer.appendChild(pop);
    placePopover(pop, pos); // clamp into the viewport now it is measurable (#212)
    renderCommentPins(); // reflect is-open on the pin
    // preventScroll: focusing an absolutely-positioned popover near the viewport
    // edge would otherwise auto-scroll the canvas container to bring the textarea
    // into view, panning the canvas away from the drop point (#212).
    setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }
  // Drop a pin: capture-phase so it beats the drill / marquee / pan handlers.
  canvas.addEventListener("mousedown", function (e) {
    if (!commentMode) return;
    if (e.button !== 0 || spaceHeld) return;                 // middle / space still pan
    if (e.target.closest(".comment-pin, .comment-popover")) return; // handled by their own listeners
    e.preventDefault(); e.stopPropagation();
    // Positive exit: while a note is open, the first click OUTSIDE it just closes it
    // (back to the crosshair) — the NEXT click drops a new pin.
    if (openCommentId) { closeCommentPopover(); renderCommentPins(); return; }
    var anchor = makeAnchorFromPoint(e.clientX, e.clientY, e.target);
    pushHistory();
    var c = makeComment(anchor, "");
    doc.comments = doc.comments || []; doc.comments.push(c);
    scheduleSave();
    openCommentPopover(c);
  }, true);

  // §12 slice 4: demo/preview comment mode — same store, block/page anchors only.
  var demoCommentBtn = document.getElementById("demo-comment");
  function setDemoCommentMode(on) {
    on = !!on;
    if (demoCommentMode === on) return;
    demoCommentMode = on;
    demoStageEl().classList.toggle("is-comment-mode", demoCommentMode);
    if (demoCommentBtn) demoCommentBtn.classList.toggle("is-active", demoCommentMode);
    if (!demoCommentMode) closeCommentPopover();
    renderCommentPins();
  }
  if (demoCommentBtn) demoCommentBtn.addEventListener("click", function () { setDemoCommentMode(!demoCommentMode); });
  // NB: attach via getElementById, NOT the demoDevice/demoStage vars — those are
  // assigned further down the IIFE, so they're still undefined at this line.
  var _demoDeviceEl = document.getElementById("demo-device");
  var _demoStageEl = document.getElementById("demo-stage");
  // Drop a pin in the preview (capture-phase, ahead of the runtime's nav clicks).
  if (_demoDeviceEl) _demoDeviceEl.addEventListener("mousedown", function (e) {
    if (!demoCommentMode || e.button !== 0) return;
    if (e.target.closest(".comment-pin, .comment-popover")) return;
    // Positive exit (same as the canvas): a first outside click closes the open note.
    if (openCommentId) { e.preventDefault(); e.stopPropagation(); closeCommentPopover(); renderCommentPins(); return; }
    var anchor = makeAnchorFromPoint(e.clientX, e.clientY, e.target);
    if (!anchor) return; // outside a page — no world anchor in preview
    e.preventDefault(); e.stopPropagation();
    pushHistory();
    var c = makeComment(anchor, "");
    doc.comments = doc.comments || []; doc.comments.push(c);
    scheduleSave();
    openCommentPopover(c);
  }, true);
  // While commenting, swallow preview clicks so a note-drop never triggers nav.
  if (_demoDeviceEl) _demoDeviceEl.addEventListener("click", function (e) { if (demoCommentMode) { e.preventDefault(); e.stopPropagation(); } }, true);
  // Content scrolls inside the device -> re-project pins to follow it.
  if (_demoStageEl) _demoStageEl.addEventListener("scroll", function () { if (demoIsOpen()) renderCommentPins(); }, true);

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
      var anyOpen = groups.some(function (ch) { return openChapters[ch.id] !== false; });
      groups.forEach(function (ch) { openChapters[ch.id] = anyOpen ? false : true; });
      if (anyOpen) Object.keys(openPages).forEach(function (k) { delete openPages[k]; }); // tidy page block-twirls on collapse
    } else {
      // no chapters: collapse/expand the page block-twirls instead
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
    items.push({ label: "Light", active: activeMode === "light", onClick: function () { setMode("light"); } });
    items.push({ label: "Dark", active: activeMode === "dark", onClick: function () { setMode("dark"); } });
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
    var src = (targetDoc && targetDoc.meta && targetDoc.pages) ? targetDoc : doc;
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
    getThemes: function () { return workingThemes; },
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
      isOn: function () { return interactMode; },
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
    perfOn: function () { return perfOn; }
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
    noteViewJs: function (ms) { _perfViewJs += ms; _perfViewN++; }
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
  // arch-P3b-04: what the tour builder reads. `activeMode` is the light/dark toggle and the board
  // themes its thumbnails from it. arch-P3b-06 took the two hotspot selection ids off this list:
  // the hotspots editor owns them now and provides them itself, which is where they belonged.
  window.VersoEditor.provideLive({
    activeMode: function () { return activeMode; }
  });
  // arch-P3b-07j: the preview flips light/dark for real, so it writes this one back. Entering the
  // preview also drops comment mode WITHOUT the side effects of the full setter -- it is about to
  // rebuild the surface anyway -- so that write crosses as its own narrow function.
  window.VersoEditor.provide({
    setActiveMode: function (m) { activeMode = m; },
    resetDemoCommentMode: function () { demoCommentMode = false; }
  });
  // Both are flipped as the author works: comment mode inside the preview, and which comment's
  // popover is open. A captured value would leave the preview drawing the last state.
  window.VersoEditor.provideLive({
    demoCommentMode: function () { return demoCommentMode; },
    openCommentId: function () { return openCommentId; }
  });
  // arch-P3b-07b: what the canonical control set reads. `blockToolbarSep` is minted when this file
  // builds the canvas overlay bar, so renderContainerChrome has to read the current one.
  window.VersoEditor.provideLive({
    blockToolbarSep: function () { return blockToolbarSep; },
    // arch-P3b-07q: the state the context menu reads as the author works. `enteredBlock` is also
    // WRITTEN by it ("Enter group"), and a write has to cross as a function -- assigning to a
    // provided getter is a TypeError under "use strict", which is what the extraction guard caught.
    enteredBlock: function () { return enteredBlock; },
    activeVariant: function () { return activeVariant; },
    activeVersion: function () { return activeVersion; },
    clipboard: function () { return clipboard; },
    styleClipboard: function () { return styleClipboard; },
    // arch-P3b-07d: which document is open. Reassigned on every tab switch, and the backup writer
    // keys its folder and its debounce off it -- a captured value would keep backing up the course
    // the author closed.
    activeDocId: function () { return activeDocId; }
  });
  // arch-P3b-07p: what the Cmd-K palette reads. Most of these are the COMMANDS it dispatches to.
  window.VersoEditor.provide({
    // @p07-provide
    syncSendToPublishCount: syncSendToPublishCount,
    publishToast: publishToast,
    addToQueue: addToQueue,
    applyLayoutVars: applyLayoutVars,
    persistTheme: persistTheme,
    closeCommentPopover: closeCommentPopover,
    demoCommentBtn: demoCommentBtn,
    fitEmbedsIn: fitEmbedsIn,
    pageIndexById: pageIndexById,
    setDemoCommentMode: setDemoCommentMode,
    BREAKPOINTS: BREAKPOINTS,
    modalHead: modalHead,
    isTextTarget: isTextTarget,
    convertTextListBlockType: convertTextListBlockType,
    TEXT_CONTENT_TYPES: TEXT_CONTENT_TYPES,
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
    saveRegistry: saveRegistry, selection: selection, line: line, dsSelect: dsSelect,
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
  window.VersoVariants.install(VE);   // the variant and version axes
  window.VersoCopyEditor.install(VE);   // the Read view and its find & replace
  window.VersoDemo.install(VE);   // the fullscreen learner preview

  // arch-P3b-07b: the style-key lists and the container IO list are DATA, not entry points, so they
  // cannot cross as bound forwarders. They are read here, once, the moment their owner has
  // installed. Constants -- nothing reassigns them afterwards.
  CONTAINER_IO_KEYS = VE.get("CONTAINER_IO_KEYS");
  HEADER_STYLE_KEYS = VE.get("HEADER_STYLE_KEYS");
  FOOTER_STYLE_KEYS = VE.get("FOOTER_STYLE_KEYS");
  NAV_BTN_KEYS = VE.get("NAV_BTN_KEYS");
  NAV_PILL_KEYS = VE.get("NAV_PILL_KEYS");
  BOX_SYSTEM_DEFAULTS = VE.get("BOX_SYSTEM_DEFAULTS");

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
  try { if (localStorage.getItem(INTERACT_MODE_KEY) === "1") { interactMode = true; canvas.classList.add("is-interact"); syncRightTabs(); } } catch (e) {}
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && picking) { endPick(); renderInspector(); } });
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
