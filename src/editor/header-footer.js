// editor/header-footer.js -- the course chrome an author configures once (arch-P3b-07e).
//
// The header and footer are GLOBAL: one configuration the whole course renders, not a per-page
// thing. That is why this file is large out of proportion to its idea -- every knob has to exist
// twice (header and footer), be independently overridable per page, and be resettable back to the
// inherited value, which is the scope ladder in inspector/primitives.js doing its work.
//
// The learner-facing nav lives here too, and it is the fiddliest part: the progress pill and its
// shadow, the button states, the section list, the tour markers. Each is a nest that opens only
// when its parent is switched on, so an author configuring a plain header never sees the pill's
// seventeen properties.
//
// EVERYTHING WRITES THROUGH reapplyHeaderFooter, all fifty-seven call sites. That is deliberate:
// the chrome updates on the canvas while the panel keeps focus, so a value can be typed and seen
// without the panel rebuilding underneath the caret.
//
// This is what the "custom fonts" banner actually held -- the fonts themselves are about a hundred
// lines elsewhere in it, and the glossary, motion and layout bodies that shared the banner are
// separate concerns that stayed.
//
// Editor chrome only: it configures what render() emits, but it does not render.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "reapplyHeaderFooter", "h", "iconField", "panelSection", "renderInspector", "switchRow",
      "colorFieldFlat", "pushHistory", "twoUp", "mount", "openSections", "segmentedIconLive",
      "nestOverridden", "nestReset", "layout", "iconBtn", "NAV_BTN_KEYS", "NAV_PILL_KEYS",
      "pageDisplayName", "reapplyLayout", "scheduleSave", "pokeHeaderFooterLive", "blockLabel", "crossRefRow",
      "openSettingsSection", "subDisclosure", "resolveScoped", "gateScopeChain", "onOffLabel", "dsSelect",
      "HEADER_STYLE_KEYS", "FOOTER_STYLE_KEYS", "headerFooterSummary", "getHeaderFooterDefault", "saveHeaderFooterDefault", "clearHeaderFooterDefault",
      "assetRef", "segmentedLive", "eyeRow", "persistLayout", "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var reapplyHeaderFooter = E.reapplyHeaderFooter,
        h = E.h,
        iconField = E.iconField,
        panelSection = E.panelSection,
        renderInspector = E.renderInspector,
        switchRow = E.switchRow,
        colorFieldFlat = E.colorFieldFlat,
        pushHistory = E.pushHistory,
        twoUp = E.twoUp,
        mount = E.mount,
        openSections = E.openSections,
        segmentedIconLive = E.segmentedIconLive,
        nestOverridden = E.nestOverridden,
        nestReset = E.nestReset,
        layout = E.layout,
        iconBtn = E.iconBtn,
        NAV_BTN_KEYS = E.NAV_BTN_KEYS,
        NAV_PILL_KEYS = E.NAV_PILL_KEYS,
        pageDisplayName = E.pageDisplayName,
        reapplyLayout = E.reapplyLayout,
        scheduleSave = E.scheduleSave,
        pokeHeaderFooterLive = E.pokeHeaderFooterLive,
        blockLabel = E.blockLabel,
        crossRefRow = E.crossRefRow,
        openSettingsSection = E.openSettingsSection,
        subDisclosure = E.subDisclosure,
        resolveScoped = E.resolveScoped,
        gateScopeChain = E.gateScopeChain,
        onOffLabel = E.onOffLabel,
        dsSelect = E.dsSelect,
        HEADER_STYLE_KEYS = E.HEADER_STYLE_KEYS,
        FOOTER_STYLE_KEYS = E.FOOTER_STYLE_KEYS,
        headerFooterSummary = E.headerFooterSummary,
        getHeaderFooterDefault = E.getHeaderFooterDefault,
        saveHeaderFooterDefault = E.saveHeaderFooterDefault,
        clearHeaderFooterDefault = E.clearHeaderFooterDefault,
        assetRef = E.assetRef,
        segmentedLive = E.segmentedLive,
        eyeRow = E.eyeRow,
        persistLayout = E.persistLayout;

    // reapplyHeaderFooter so the canvas updates while the panel keeps focus. iconField
    // pushes history itself (headerFooter lives in doc, so it is on the undo stack).
    function headerFooterNum(cfg, key, glyph, title, placeholder, min, max) {
      return iconField(glyph, {
        value: cfg[key] == null ? "" : cfg[key], unit: "px", placeholder: placeholder || "auto",
        step: 1, min: min, max: max, title: title, datalist: "dl-gap",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete cfg[key]; else cfg[key] = n; if (!pokeHeaderFooterLive(cfg, key)) reapplyHeaderFooter(); } // PERF: poke live, full rebuild only as fallback
      }).wrap;
    }

    // global header/footer settings. Text is edited inline on the page.
    // On/off + reveal toggles (header, footer, underline, top rule, logo presence)
    // change WHICH controls are shown, so they rebuild the panel (mount). Value
    // edits (align, tint, size, colour, padding) apply live via reapplyHeaderFooter and
    // keep panel focus.
    // Item X — the headerFooter child/slot editor. Lists the added child blocks on a
    // header/footer config and lets the author add a learner light/dark toggle or a
    // text element, set each child's alignment, and remove them. Add/remove is
    // structural -> mount() (rebuilds the list + canvas); align is live -> reapplyHeaderFooter
    // (keeps the panel). Children render via render.js appendHeaderFooterChildren, so they
    // show on every page and ship in the export automatically. Text children are
    // edited inline on the canvas (like the built-in title/footer text).
    function headerFooterChildrenEditor(config, host, isFooter) {
      config.children = config.children || [];
      host = panelSection(host, "Added content"); // #162: canonical collapsible (was the nest's "Placed items" sub + this sub)
      if (!config.children.length) {
        host.appendChild(h("div", "insp-hint", "No added elements yet. Add a light/dark toggle so learners can switch theme, or a text element."));
      }
      config.children.forEach(function (child, idx) {
        var row = h("div", "insp-row"); row.appendChild(h("span", "insp-row__label", blockLabel(child)));
        var del = iconBtn("trash", "Remove element", true);
        del.addEventListener("click", function () { pushHistory(); config.children.splice(idx, 1); openSections.headerFooter = true; mount(); });
        row.appendChild(del);
        host.appendChild(row);
        // The nav bar is a full-width footer element; per-child alignment is a no-op
        // for it. Its controls live in the top-level "Learner nav" panel (keeping the nav
        // nests at level 2 rather than burying them 3 deep under Footer > Placed items).
        // uio-O-W1 (OVL-06): this used to be a line of prose telling the author to go and find
        // another panel. The nav bar is owned by the Learner nav section, so the row states its
        // live value and links straight there.
        if (child.type === "courseNav") {
          var navSecs = (child.sections || []).length;
          crossRefRow({
            label: "Nav bar",
            value: navSecs ? (navSecs + (navSecs === 1 ? " section" : " sections")) : "No sections yet",
            linkLabel: "Learner nav", host: host,
            title: "Open Settings on Learner nav, where this bar is styled",
            onNavigate: function () { openSettingsSection("project", "nav"); }
          });
          return;
        }
        segmentedIconLive("Align", [[Icon("align-left"), "start", "Start"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "end", "End"]],
          function (v) { return (child.align || "start") === v; },
          function (v) { if (v === "start") delete child.align; else child.align = v; reapplyHeaderFooter(); }, host);
      });
      var addToggle = h("button", "prop-btn", "+ Light/dark toggle");
      addToggle.addEventListener("click", function () {
        pushHistory();
        config.children.push({ type: "modeToggle", label: "Light / Dark" });
        openSections.headerFooter = true; mount();
      });
      var addText = h("button", "prop-btn", "+ Text element");
      addText.addEventListener("click", function () {
        pushHistory();
        config.children.push({ type: "note", text: "New text" });
        openSections.headerFooter = true; mount();
      });
      host.appendChild(addToggle); host.appendChild(addText);
      // Footer-only: the learner navigation bar (prev / progress / next).
      if (isFooter && !config.children.some(function (ch) { return ch.type === "courseNav"; })) {
        var addNav = h("button", "prop-btn", "+ Learner nav bar");
        addNav.addEventListener("click", function () {
          pushHistory();
          config.children.push(makeCourseNav());
          openSections.headerFooter = true; mount();
        });
        host.appendChild(addNav);
      }
    }

    // A new nav bar seeds its sections from the current pages (one section per page,
    // skipping the first page which is conventionally the menu/landing). The author
    // then edits labels + page membership below.
    function makeCourseNav() {
      var secs = (E.doc.pages || []).slice(1).map(function (p, i) {
        return { id: "s" + (i + 1), label: p.name || "Section " + (i + 1), pageIds: [p.id] };
      });
      return { type: "courseNav", menuLabel: "Menu", prevLabel: "Back", nextLabel: "Next",
        showPrev: true, showBar: true, showNext: true, sections: secs };
    }

    // Inline controls for a footer nav-bar child: part toggles, arrow/menu labels,
    // and a section editor (label + which pages belong to each section). Toggles and
    // section membership are STRUCTURAL (change the rendered DOM) -> mount(); label
    // text is live -> reapplyHeaderFooter (keeps the panel + focus).
    // SPEC-panel-cleanup slice 2: the nav block inspector as nests — Buttons / Progress
    // pill / Progression / Sections. Same primitives as slice 1 (switch/eye/icon segments
    // + dot/reset). Word-boolean segments retired.
    // uio-O-W2 (OVL-07): the nav's five groups are described ONCE and drawn in two places. On the
    // canvas the nav block is selected and they are the panel's own sections; in the settings sheet
    // they are sheet sections in their own right. They used to be nested inside a "Learner nav"
    // section there, which made their inner groups (Labels, Appearance, Size…) a third level.
    function courseNavNests(child) {
      child.sections = child.sections || [];
      return [
        { key: "nav.buttons", title: "Buttons", sheetTitle: "Nav buttons", build: function (b) { navButtonsNest(child, b); }, opts: {
          overridden: function () { return nestOverridden(child, NAV_BTN_KEYS); },
          onReset: function () { nestReset(child, NAV_BTN_KEYS); reapplyHeaderFooter(); }
        } },
        { key: "nav.pill", title: "Progress pill", build: function (b) { navPillNest(child, b); }, opts: {
          toggle: { get: function () { return child.showBar !== false; }, set: function (v) { if (v) delete child.showBar; else child.showBar = false; reapplyHeaderFooter(); } },
          overridden: function () { return nestOverridden(child, NAV_PILL_KEYS); },
          onReset: function () { nestReset(child, NAV_PILL_KEYS); reapplyHeaderFooter(); }
        } },
        { key: "nav.progression", title: "Progression", build: function (b) { navProgressionNest(child, b); }, opts: {
          // §2 chapter progression: opt-in course-level gate (feature-enable = the switch).
          toggle: { get: function () { return !!E.doc.gatedProgression; }, set: function (v) { if (v) E.doc.gatedProgression = true; else delete E.doc.gatedProgression; reapplyHeaderFooter(); } }
        } },
        { key: "nav.sections", title: "Sections", sheetTitle: "Nav sections", build: function (b) { navSectionsNest(child, b); } },
        // Guided tour (learner coach-marks over the footer controls). Feature-enable = the
        // header switch; body = which page it appears on + editable copy per marker.
        { key: "nav.tour", title: "Guided tour", build: function (b) { navTourNest(child, b); }, opts: {
          toggle: {
            get: function () { return !!(child.tour && child.tour.on); },
            set: function (v) {
              if (v) {
                child.tour = child.tour || {};
                child.tour.on = true;
                if (child.tour.page == null) child.tour.page = (E.doc.pages && E.doc.pages[0] && E.doc.pages[0].id) || "";
              } else if (child.tour) { child.tour.on = false; }
              reapplyHeaderFooter();
            }
          }
        } }
      ];
    }
    function courseNavControls(child, host) {
      courseNavNests(child).forEach(function (n) {
        host.appendChild(subDisclosure(n.key, n.title, n.build, n.opts));
      });
    }
    // Progression body — a course-level gate, so it reads the doc rather than the nav block.
    function navProgressionNest(child, b) {
      b.appendChild(h("div", "insp-hint", "On: each chapter must pass its knowledge check (native quiz) before the learner can advance to the next; play it in demo mode to test. Add the chapter's dot-point summary to the quiz's \"Chapter summary\" list (on the quiz completion panel) — it shows once the learner passes."));
      // §5: auto-gate ALL interactions — one course-level DEFAULT switch (per-page override
      // lives in the page inspector). Default off.
      // uio-F03: the SAME ladder, seen from the Course rung — one primitive, two surfaces.
      var courseGateRes = resolveScoped(gateScopeChain(null), "gateInteractions", { at: "course" });
      switchRow("Require all interactions before Next", function () { return !!courseGateRes.value; },
        function (v) { if (v) E.doc.gateAllInteractions = true; else delete E.doc.gateAllInteractions; reapplyHeaderFooter(); renderInspector(); }, b, false,
        { inherit: { res: courseGateRes, format: onOffLabel, onReset: function () {
            pushHistory(); delete E.doc.gateAllInteractions; reapplyHeaderFooter(); renderInspector();
          } } });
      b.appendChild(h("div", "insp-hint", "Course default: on every page the learner must finish its interactions — pass quizzes, view all hotspots, watch videos, tick checkboxes, reveal all cards, step through sequences, open every accordion section — before Next enables. The gated Next greys out and shows a reminder. Override per page in the page's settings. Interactions we can't detect (embedded HTML interactions) are skipped, so a page can never trap the learner."));
      // Author-overridable reminder copy (optional; blank -> the default sentence).
      var gmRow = h("div", "insp-row");
      gmRow.appendChild(h("span", "insp-row__label", "Reminder message"));
      var gmIn = h("input", "prop-text"); gmIn.type = "text"; gmIn.spellcheck = false;
      gmIn.placeholder = "Complete the interactions on this page to continue.";
      gmIn.value = E.doc.gateMessage || "";
      gmIn.addEventListener("change", function () { pushHistory(); var v = gmIn.value.trim(); if (v) E.doc.gateMessage = v; else delete E.doc.gateMessage; reapplyHeaderFooter(); });
      gmRow.appendChild(gmIn); b.appendChild(gmRow);
    }
    // Tour body: a page picker (when the dots appear) + per-marker Title/Description. Copy
    // is optional -> empty falls back to the render default (shown as the field placeholder,
    // read from window.VERSO_TOUR_DEFAULTS so editor + render never drift).
    var TOUR_MARKERS = [["prev", "Back arrow"], ["mode", "Light/dark + language"], ["menu", "Menu & progress"], ["glossary", "Glossary"], ["next", "Next arrow"]];
    function navTourNest(child, host) {
      var tour = child.tour || (child.tour = { on: true });
      var defs = window.VERSO_TOUR_DEFAULTS || {};
      host.appendChild(h("div", "insp-hint", "Coach-mark dots pop up over the footer buttons to explain them. They appear automatically when the learner reaches the chosen page (every visit). Preview in Demo to see them."));
      // page picker (host-scoped select — selectRow targets the global inspector)
      host.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Show on page"));
      var opts = [["Every page", ""]].concat((E.doc.pages || []).map(function (p) { return [pageDisplayName(p, E.doc), p.id]; }));
      var sel = dsSelect(opts, tour.page || "", function (v) { pushHistory(); if (!v) tour.page = ""; else tour.page = v; reapplyHeaderFooter(); });
      host.appendChild(sel);
      // per-marker copy
      var items = tour.items || (tour.items = {});
      TOUR_MARKERS.forEach(function (m) {
        var key = m[0], d = defs[key] || { title: "", desc: "" };
        var it = items[key] || (items[key] = {});
        var mbody = panelSection(host, m[1]);
        mbody.appendChild(headerFooterTextRow("Title", it, "title", d.title || ""));
        mbody.appendChild(headerFooterTextRow("Description", it, "desc", d.desc || ""));
      });
      host.appendChild(h("div", "insp-hint", "A marker only shows if its button is present (e.g. Glossary needs glossary terms; the arrows/toggle follow their own switches above)."));
    }
    function navButtonsNest(child, host) {
      // Visibility
      switchRow("Back arrow", function () { return child.showPrev !== false; }, function (v) { if (v) delete child.showPrev; else child.showPrev = false; reapplyHeaderFooter(); }, host);
      switchRow("Next arrow", function () { return child.showNext !== false; }, function (v) { if (v) delete child.showNext; else child.showNext = false; reapplyHeaderFooter(); }, host);
      switchRow("Icons only", function () { return child.iconsOnly === true; }, function (v) { if (v) child.iconsOnly = true; else delete child.iconsOnly; reapplyHeaderFooter(); }, host);
      // #169b: pin is the GLOBAL DEFAULT (on) — the toggle is an opt-OUT (stores pinButtons:false).
      switchRow("Pin to gutters", function () { return child.pinButtons !== false; }, function (v) { if (v) delete child.pinButtons; else child.pinButtons = false; reapplyHeaderFooter(); }, host);
      host.appendChild(h("div", "insp-hint", "The progress/chapter pill always floats at the bottom. On (default): Prev/Next pin to the screen's bottom corners and stay visible as the learner scrolls — the same fixed inset in every course, independent of page padding. Off: they sit at the page end and scroll away. The canvas previews the pinned corners; check Demo for the live scroll behaviour."));
      var h0 = host;
      // Content
      host = panelSection(h0, "Labels");
      host.appendChild(headerFooterTextRow("Back label", child, "prevLabel", "Back"));
      host.appendChild(headerFooterTextRow("Next label", child, "nextLabel", "Next"));
      host.appendChild(headerFooterTextRow("Menu label", child, "menuLabel", "Menu"));
      if (E.doc.glossary && Array.isArray(E.doc.glossary.terms) && E.doc.glossary.terms.length) host.appendChild(headerFooterTextRow("Glossary label", child, "glossaryLabel", "Glossary"));
      // Appearance — canonical colourControls driving --nav-btn-* vars (default = white outline).
      host = panelSection(h0, "Appearance"); // gate-ok: Header/Footer nav styling, not a block container
      host.appendChild(h("div", "insp-hint", "Default: white stroke + text on a subtle background fill. Clear a swatch to revert."));
      colorFieldFlat("Fill", child.btnFill, function (v) { if (v == null) delete child.btnFill; else child.btnFill = v; reapplyHeaderFooter(); }, host);
      colorFieldFlat("Stroke", child.btnBorder, function (v) { if (v == null) delete child.btnBorder; else child.btnBorder = v; reapplyHeaderFooter(); }, host);
      colorFieldFlat("Text", child.btnText, function (v) { if (v == null) delete child.btnText; else child.btnText = v; reapplyHeaderFooter(); }, host);
      colorFieldFlat("Hover", child.btnHover, function (v) { if (v == null) delete child.btnHover; else child.btnHover = v; reapplyHeaderFooter(); }, host);
    }
    function navPillNest(child, host) {
      // Toggle glyph
      switchRow("Light/dark toggle", function () { return child.showModeToggle !== false; }, function (v) { if (v) delete child.showModeToggle; else child.showModeToggle = false; reapplyHeaderFooter(); }, host);
      host.appendChild(h("div", "insp-hint", "Puts a light/dark switch glyph in the pill's left slot (works in demo + the exported course)."));
      // §1: nudge the light/dark + glossary glyphs toward the pill edges (0 = centred).
      host.appendChild(iconField(Icon("padding"), { value: child.pillGlyphNudge, unit: "px", placeholder: "0", step: 1, min: 0, max: 24, datalist: "dl-gap", title: "Push the light/dark + glossary glyphs toward the pill edges",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillGlyphNudge; else child.pillGlyphNudge = n; reapplyHeaderFooter(); } }).wrap);
      // Size (BACKLOG §pill P2): author pill width (max) + height (min). Blank = the defaults
      // (width caps at 460px; height is content-derived). Writes --nav-pill-width/-height.
      var h0 = host;
      host = panelSection(h0, "Size");
      host.appendChild(twoUp(
        iconField("W", { value: child.pillWidth, unit: "px", placeholder: "460", step: 10, min: 160, max: 900, datalist: "dl-gap", title: "Pill width (maximum)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillWidth; else child.pillWidth = n; reapplyHeaderFooter(); } }).wrap,
        iconField("H", { value: child.pillHeight, unit: "px", placeholder: "auto", step: 2, min: 24, max: 160, datalist: "dl-gap", title: "Pill height (minimum)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillHeight; else child.pillHeight = n; reapplyHeaderFooter(); } }).wrap));
      // Surface
      host = panelSection(h0, "Surface");
      host.appendChild(h("div", "insp-hint", "Clear a swatch to revert to the theme default."));
      colorFieldFlat("Pill fill", child.pillFill, function (v) { if (v == null) delete child.pillFill; else child.pillFill = v; reapplyHeaderFooter(); }, host);
      host.appendChild(twoUp(
        iconField(Icon("contrast"), { value: child.pillOpacity, unit: "%", placeholder: "100", step: 5, min: 0, max: 100, datalist: "dl-gap", title: "Pill surface opacity (translucent background; text stays crisp)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillOpacity; else child.pillOpacity = Math.max(0, Math.min(100, n)); reapplyHeaderFooter(); } }).wrap,
        iconField(Icon("blur"), { value: child.pillBlur, unit: "px", placeholder: "0", step: 1, min: 0, max: 40, datalist: "dl-gap", title: "Layer blur — frosts the content behind the pill (pairs with opacity)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillBlur; else child.pillBlur = Math.max(0, Math.min(40, n)); reapplyHeaderFooter(); } }).wrap));
      switchRow("Stroke", function () { return child.pillStroke !== false; }, function (v) { if (v) delete child.pillStroke; else child.pillStroke = false; reapplyHeaderFooter(); renderInspector(); }, host);
      if (child.pillStroke !== false) {
        colorFieldFlat("Stroke colour", child.pillBorder, function (v) { if (v == null) delete child.pillBorder; else child.pillBorder = v; reapplyHeaderFooter(); }, host);
      }
      host.appendChild(twoUp(
        iconField(Icon("border-weight"), { value: child.pillStrokeWidth, unit: "px", placeholder: "1", step: 1, min: 0, max: 8, datalist: "dl-gap", title: "Stroke width",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillStrokeWidth; else child.pillStrokeWidth = n; reapplyHeaderFooter(); } }).wrap,
        iconField(Icon("radius"), { value: child.pillRadius, unit: "px", placeholder: "999", step: 1, min: 0, max: 999, datalist: "dl-gap", title: "Pill corner radius",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillRadius; else child.pillRadius = n; reapplyHeaderFooter(); } }).wrap));
      // Drop shadow (James 2026-07-08): off -> no shadow; on -> author offset/blur/spread/colour+
      // opacity, composed by render into --nav-pill-shadow (WYSIWYG in editor + runtime + export).
      host = panelSection(h0, "Drop shadow");
      switchRow("Drop shadow", function () { return child.pillShadow !== false; }, function (v) { if (v) delete child.pillShadow; else child.pillShadow = false; reapplyHeaderFooter(); renderInspector(); }, host);
      if (child.pillShadow !== false) {
        host.appendChild(twoUp(
          iconField("X", { value: child.pillShadowX, unit: "px", placeholder: "0", step: 1, min: -60, max: 60, datalist: "dl-gap", title: "Shadow X offset",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillShadowX; else child.pillShadowX = n; reapplyHeaderFooter(); } }).wrap,
          iconField("Y", { value: child.pillShadowY, unit: "px", placeholder: "10", step: 1, min: -60, max: 60, datalist: "dl-gap", title: "Shadow Y offset",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillShadowY; else child.pillShadowY = n; reapplyHeaderFooter(); } }).wrap));
        host.appendChild(twoUp(
          iconField(Icon("blur"), { value: child.pillShadowBlur, unit: "px", placeholder: "30", step: 1, min: 0, max: 100, datalist: "dl-gap", title: "Shadow blur",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillShadowBlur; else child.pillShadowBlur = n; reapplyHeaderFooter(); } }).wrap,
          iconField(Icon("padding"), { value: child.pillShadowSpread, unit: "px", placeholder: "0", step: 1, min: -40, max: 40, datalist: "dl-gap", title: "Shadow spread",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillShadowSpread; else child.pillShadowSpread = n; reapplyHeaderFooter(); } }).wrap));
        colorFieldFlat("Shadow colour", child.pillShadowColor, function (v) { if (v == null) delete child.pillShadowColor; else child.pillShadowColor = v; reapplyHeaderFooter(); }, host);
        host.appendChild(iconField(Icon("contrast"), { value: child.pillShadowOpacity, unit: "%", placeholder: "35", step: 5, min: 0, max: 100, datalist: "dl-gap", title: "Shadow opacity",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete child.pillShadowOpacity; else child.pillShadowOpacity = Math.max(0, Math.min(100, n)); reapplyHeaderFooter(); } }).wrap);
      }
      // Bar
      host = panelSection(h0, "Progress bar");
      colorFieldFlat("Bar fill", child.barFill, function (v) { if (v == null) delete child.barFill; else child.barFill = v; reapplyHeaderFooter(); }, host);
      colorFieldFlat("Bar track", child.barTrack, function (v) { if (v == null) delete child.barTrack; else child.barTrack = v; reapplyHeaderFooter(); }, host);
    }
    function navSectionsNest(child, host) {
      if (!child.sections.length) host.appendChild(h("div", "insp-hint", "No sections yet. Add one per chapter; the bar advances through them and the jump modal lists them."));
      child.sections.forEach(function (sec, idx) {
        var row = h("div", "insp-row"); row.appendChild(h("span", "insp-row__label", "Section " + (idx + 1)));
        var del = iconBtn("trash", "Remove section", true);
        del.addEventListener("click", function () { pushHistory(); child.sections.splice(idx, 1); renderInspector(); reapplyHeaderFooter(); });
        row.appendChild(del); host.appendChild(row);
        host.appendChild(headerFooterTextRow("Label", sec, "label", "Section label"));
        (E.doc.pages || []).forEach(function (p) {
          var pr = h("label", "insp-check");
          var cb = h("input"); cb.type = "checkbox"; cb.checked = (sec.pageIds || []).indexOf(p.id) >= 0;
          cb.addEventListener("change", function () {
            pushHistory();
            sec.pageIds = sec.pageIds || [];
            var at = sec.pageIds.indexOf(p.id);
            if (cb.checked && at < 0) sec.pageIds.push(p.id);
            else if (!cb.checked && at >= 0) sec.pageIds.splice(at, 1);
            reapplyHeaderFooter();
          });
          pr.appendChild(cb); pr.appendChild(h("span", null, pageDisplayName(p, E.doc)));
          host.appendChild(pr);
        });
      });
      var addSec = h("button", "prop-btn", "+ Section");
      addSec.addEventListener("click", function () {
        pushHistory();
        child.sections.push({ id: "s" + (child.sections.length + 1), label: "New section", pageIds: [] });
        renderInspector(); reapplyHeaderFooter();
      });
      host.appendChild(addSec);
    }

    // small labelled text input bound to obj[key]; live-applies via reapplyHeaderFooter.
    function headerFooterTextRow(label, obj, key, placeholder) {
      var row = h("div", "insp-row"); row.appendChild(h("span", "insp-row__label", label));
      var input = h("input", "prop-text"); input.type = "text"; input.spellcheck = false;
      input.value = obj[key] == null ? "" : obj[key]; input.placeholder = placeholder || "";
      input.addEventListener("input", function () {
        if (input.value === "") delete obj[key]; else obj[key] = input.value;
        reapplyHeaderFooter();
      });
      row.appendChild(input); return row;
    }

    // uio-O-W2 (OVL-07): Header and Footer are their own SHEET SECTIONS now, not two nests inside
    // a "Header & Footer" one. Nested, their own groups (Logo / Layout / Appearance / Added
    // content) were a third level of headings, which is what put three header styles in this pane.
    // Promoted, the pane is exactly two levels: the section, and its groups. Each keeps the switch,
    // summary and Reset it carried as a nest — those live on the section header (hfSectionOpts).
    function headerFooterConfig() {
      return E.doc.headerFooter || (E.doc.headerFooter = { header: { on: false }, footer: { on: false } });
    }
    function hfSectionOpts(isHeader) {
      var ch = headerFooterConfig();
      var part = isHeader ? ch.header : ch.footer;
      var keys = isHeader ? HEADER_STYLE_KEYS : FOOTER_STYLE_KEYS;
      return {
        toggle: { get: function () { return part.on === true; }, set: function (v) { part.on = v; reapplyHeaderFooter(); } },
        summary: function () { return headerFooterSummary(part, isHeader); },
        overridden: function () { return nestOverridden(part, keys); },
        onReset: function () { nestReset(part, keys); reapplyHeaderFooter(); }
      };
    }
    function buildHeaderBody(c) {
      buildHeaderNest(headerFooterConfig().header, c);
      c.appendChild(h("div", "insp-hint", "Text is editable directly on the page. To hide the header on one page, select that page (its name in Structure or its label on the canvas)."));
    }
    function buildFooterBody(c) {
      buildFooterNest(headerFooterConfig().footer, c);
      c.appendChild(h("div", "insp-hint", "Text is editable directly on the page. To hide the footer on one page, select that page (its name in Structure or its label on the canvas)."));
    }
    function buildHeaderFooterDefaultBody(c) {
      // New-course default: capture THIS course's header/footer as the starting point
      // for every new course (machine-wide). Look only — a new course keeps its own
      // name + chapter-derived nav (see sanitizeHeaderFooterDefault).
      var hasDefault = !!getHeaderFooterDefault();
      var ncd = c;
      var setBtn = h("button", "prop-btn", hasDefault ? "Update the default from this course" : "Set as default for new courses");
      setBtn.addEventListener("click", function () {
        if (saveHeaderFooterDefault()) renderInspector(); // re-render -> shows Clear + updated hint
      });
      ncd.appendChild(setBtn);
      if (hasDefault) {
        var clrBtn = h("button", "prop-btn prop-btn--danger", "Clear saved default");
        clrBtn.addEventListener("click", function () { clearHeaderFooterDefault(); renderInspector(); });
        ncd.appendChild(clrBtn);
      }
      ncd.appendChild(h("div", "insp-hint", hasDefault
        ? "New courses start from your saved header & footer (logo, colours, padding, subtitle, footer text). Each keeps its own course name; nav stays chapter-derived."
        : "New courses use the built-in default. Set one here to reuse this course's logo, colours, padding, subtitle and footer text on every new course."));
    }
    function buildHeaderNest(hd, host) {
      var h0 = host;
      // Logo (content)
      host = panelSection(h0, "Logo");
      var up = h("button", "prop-btn", hd.logo ? "Replace logo (SVG/PNG)" : "Upload logo (SVG/PNG)");
      var input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.style.display = "none";
      input.addEventListener("change", function () { var f = input.files && input.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { hd.logo = assetRef(r.result, f); reapplyHeaderFooter(); renderInspector(); }; r.readAsDataURL(f); });
      up.addEventListener("click", function () { input.click(); });
      host.appendChild(up); host.appendChild(input);
      if (hd.logo) {
        var rm = h("button", "prop-btn prop-btn--danger", "Remove logo"); rm.addEventListener("click", function () { hd.logo = null; reapplyHeaderFooter(); renderInspector(); }); host.appendChild(rm);
        segmentedLive("Logo tint", [["Auto", "auto"], ["Original", "original"]],  // mode-choice (no clear icon) -> stays word segments
          function (v) { return (hd.logoTint || "auto") === v; },
          function (v) { hd.logoTint = v; reapplyHeaderFooter(); }, host);
        host.appendChild(headerFooterNum(hd, "logoSize", "H", "Logo size", "30", 8, 200));
      }
      // Layout
      host = panelSection(h0, "Layout"); // gate-ok: Header/Footer styling, not a block container
      segmentedIconLive("Align", [[Icon("align-left"), "start", "Start"], [Icon("align-horizontal-space-between"), "between", "Split"], [Icon("align-center"), "center", "Center"]],
        function (v) { return (hd.align || "start") === v; },
        function (v) { hd.align = v; reapplyHeaderFooter(); }, host);
      host.appendChild(twoUp(
        headerFooterNum(hd, "padX", Icon("pad-x"), "Side padding", "auto", 0, 200),
        headerFooterNum(hd, "padY", Icon("pad-y"), "Vertical padding", "auto", 0, 200)));
      // JJJ: pin the header to the top of the viewport (pure CSS position:sticky, export-safe).
      switchRow("Pin to top", function () { return hd.pinned === true; }, function (v) { hd.pinned = v; reapplyHeaderFooter(); }, host);
      // Appearance
      host = panelSection(h0, "Appearance"); // gate-ok: Header/Footer styling, not a block container
      switchRow("Underline", function () { return hd.border !== false; }, function (v) { hd.border = v; reapplyHeaderFooter(); renderInspector(); }, host);
      if (hd.border !== false) {
        colorFieldFlat("Underline colour", hd.borderColor || "#2f6fd0",
          function (val) { if (val == null) delete hd.borderColor; else hd.borderColor = val; reapplyHeaderFooter(); }, host);
      }
      // Content (headerFooterChildrenEditor wraps its own "Added content" section)
      headerFooterChildrenEditor(hd, h0);
    }
    function buildFooterNest(ft, host) {
      var h0 = host;
      // Layout
      host = panelSection(h0, "Layout"); // gate-ok: Header/Footer styling, not a block container
      segmentedIconLive("Align", [[Icon("align-left"), "left", "Left"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "right", "Right"]],
        function (v) { return (ft.align || "left") === v; },
        function (v) { ft.align = v; reapplyHeaderFooter(); }, host);
      host.appendChild(twoUp(
        headerFooterNum(ft, "padX", Icon("pad-x"), "Side padding", "auto", 0, 200),
        headerFooterNum(ft, "padY", Icon("pad-y"), "Vertical padding", "auto", 0, 200)));
      // Appearance
      host = panelSection(h0, "Appearance"); // gate-ok: Header/Footer styling, not a block container
      switchRow("Top rule", function () { return ft.border !== false; }, function (v) { ft.border = v; reapplyHeaderFooter(); renderInspector(); }, host);
      if (ft.border !== false) {
        colorFieldFlat("Rule colour", ft.borderColor || "#3c4045",
          function (val) { if (val == null) delete ft.borderColor; else ft.borderColor = val; reapplyHeaderFooter(); }, host);
      }
      // Disclaimer (content) — VVVV(3): show/hide the export-control line; HHHH: its gap.
      host = panelSection(h0, "Disclaimer");
      eyeRow("Disclaimer", function () { return ft.hideText !== true; }, function (visible) { ft.hideText = !visible; reapplyHeaderFooter(); renderInspector(); }, host);
      if (!ft.hideText) {
        host.appendChild(iconField(Icon("padding"), { value: ft.textGap, unit: "px", placeholder: "8", step: 2, min: 0, max: 120, datalist: "dl-gap", title: "Space above the disclaimer (gap from the nav)",
          onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete ft.textGap; else ft.textGap = n; reapplyHeaderFooter(); } }).wrap);
      }
      // Content (headerFooterChildrenEditor wraps its own "Added content" section)
      headerFooterChildrenEditor(ft, h0, true);
    }
    // Page layout = per-breakpoint side padding (%) + vertical padding (px).
    // Lives in localStorage (not doc), so it is off the undo stack (noHistory) and
    // applies live via reapplyLayout, keeping panel focus.
    function buildLayoutBody(c) {
      function layoutNum(key, glyph, unit, title, min, max) {
        return iconField(glyph, {
          value: layout[key] == null ? "" : layout[key], unit: unit, title: title,
          step: 1, min: min, max: max, noHistory: true, datalist: unit === "%" ? "dl-pct" : "dl-gap",
          onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { layout[key] = n; reapplyLayout(); persistLayout(); } }
        }).wrap;
      }
      var sPad = panelSection(c, "Side padding");
      sPad.appendChild(twoUp(
        layoutNum("padDesktop", Icon("monitor"), "%", "Desktop side padding", 0, 45),
        layoutNum("padTablet", Icon("tablet"), "%", "Tablet side padding", 0, 45)));
      sPad.appendChild(twoUp(
        layoutNum("padMobile", Icon("smartphone"), "%", "Mobile side padding", 0, 45),
        layoutNum("padY", Icon("pad-y"), "px", "Vertical padding", 0, 200)));
      sPad.appendChild(h("div", "insp-hint", "Desktop 10% = 80%-width content, centred (current project default). Vertical padding is top/bottom in px."));
      // B: master content-width cap. Stored on the DOC (ships in export via the
      // __contentMaxWidth hook), unlike the localStorage padding above.
      var sWidth = panelSection(c, "Content width");
      sWidth.appendChild(iconField("W", {
        value: E.doc.contentMaxWidth == null ? "" : E.doc.contentMaxWidth, unit: "px", title: "Max content width",
        placeholder: "full width", step: 20, min: 320, max: 2000, noHistory: true, datalist: "dl-gap",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete E.doc.contentMaxWidth; else E.doc.contentMaxWidth = n; reapplyLayout(); scheduleSave(); }
      }).wrap);
      sWidth.appendChild(h("div", "insp-hint", "Caps the readable content column and centres it (blank = full width). Ships in the exported course."));
      // Master IMAGE corner radius (doc.imageRadius -> --img-radius via __imageRadius). One
      // control rounds EVERY image; a per-image "Corner radius" (block.radius on the image
      // inspector) overrides it. 0 = square; blank = the theme default (--radius-card). Ships in export.
      var sImg = panelSection(c, "Image corner radius");
      sImg.appendChild(iconField(Icon("radius"), {
        value: E.doc.imageRadius == null ? "" : E.doc.imageRadius, unit: "px", title: "Master image corner radius (per-image overrides)",
        placeholder: "theme default", step: 1, min: 0, max: 100, noHistory: true, datalist: "dl-radius",
        onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete E.doc.imageRadius; else E.doc.imageRadius = n; mount(); scheduleSave(); }
      }).wrap);
      sImg.appendChild(h("div", "insp-hint", "Rounds every image from one control. Set a single image's own radius in its inspector to override; 0 = square corners."));
    }

    kernel.expose({
      buildHeaderBody: buildHeaderBody, buildFooterBody: buildFooterBody, buildHeaderFooterDefaultBody: buildHeaderFooterDefaultBody,
      buildLayoutBody: buildLayoutBody, makeCourseNav: makeCourseNav, headerFooterConfig: headerFooterConfig,
      hfSectionOpts: hfSectionOpts,
      // The nav's controls are drawn twice: once into the canvas inspector when a nav block is
      // selected, once into the settings sheet's nested groups. Both were still calling these by
      // name from editor.js after the region moved (arch-P3b-07).
      courseNavControls: courseNavControls, courseNavNests: courseNavNests
    });
  }

  window.VersoHeaderFooter = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoHeaderFooter;
})();
