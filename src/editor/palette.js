// editor/palette.js -- one index, one palette (arch-P3b-07p).
//
// `design-system/readme.md` ("The UI spine") makes Cmd-K a contract, not a feature: find-anything
// over ONE index, so no surface owns a private search box. The index spans four sources -- settings
// sections, editor actions, the user guide's headings, and the open document's own pages and blocks
// -- and this file is both the index and the overlay that ranks and runs it.
//
// WHY ITS DEPENDENCY LIST IS LONG AND WILL STAY LONG. Twenty-three of the names it reads are the
// COMMANDS it dispatches to: enterDemo, openSettingsModal, undo, redo, fitAll, addPageAfterCurrent.
// That is not coupling to reduce; it is what a command palette IS. The same shape the inspector
// dispatcher has, and the reason both are wiring rather than logic.
//
// The guide's headings arrive from disk, so they are folded in and re-ranked AFTER the overlay is
// already open -- an author never waits on a file read to start typing. The highlight is clamped
// rather than reset when they land, so the row under the cursor does not jump.
//
// Editor chrome only: it navigates and runs commands, but nothing here renders or exports.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "loadGuide",
      "h", "line", "setStage", "openHelpModal", "canvas", "layout",
      "enterDemo", "openSettingsModal", "openFindReplace", "addPageAfterCurrent", "undo", "redo",
      "fitAll", "zoomTo100", "togglePanels", "getSettingsSections", "blockLabel", "openSettingsSection",
      "focusFrame", "setActivePage", "setSelection", "clearAllMulti", "selectBlock", "popLayer",
      "pushLayer", "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        line = E.line,
        setStage = E.setStage,
        openHelpModal = E.openHelpModal,
        canvas = E.canvas,
        layout = E.layout,
        enterDemo = E.enterDemo,
        openSettingsModal = E.openSettingsModal,
        openFindReplace = E.openFindReplace,
        addPageAfterCurrent = E.addPageAfterCurrent,
        undo = E.undo,
        redo = E.redo,
        fitAll = E.fitAll,
        zoomTo100 = E.zoomTo100,
        togglePanels = E.togglePanels,
        getSettingsSections = E.getSettingsSections,
        blockLabel = E.blockLabel,
        openSettingsSection = E.openSettingsSection,
        focusFrame = E.focusFrame,
        setActivePage = E.setActivePage,
        setSelection = E.setSelection,
        clearAllMulti = E.clearAllMulti,
        selectBlock = E.selectBlock,
        popLayer = E.popLayer,
        pushLayer = E.pushLayer;

    // ---- uio-F06: one index, one palette (Cmd-K) -----------------------------
    // The spine's keyboard contract: Cmd-K is find-anything over ONE index -- settings, actions,
    // guide sections and the document's own pages and blocks. No surface owns a separate search
    // box, which is why the user guide's own "Search the guide" field is retired in this change.
    //
    // The core below is PURE: it takes plain lists and a query string and returns ranked entries.
    // No DOM, no doc, no editor state -- so the ranking and the guide parser are testable without
    // booting the editor.
    /* @f06-start */
    // Intent words per settings section. The audit's finding was that section names are not
    // guessable from what you actually want: a disclaimer lives under Header & Footer, confetti
    // under Motion, the nav pill under Learner nav. Aliases let the index answer the intent
    // rather than demanding you already know Verso's filing system.
    var SETTINGS_ALIASES = {
      canvas:       ["background", "backdrop", "interface", "light", "dark", "spellcheck", "spelling", "typo", "developer tools", "devtools", "json", "debug"],
      preview:      ["breakpoint", "desktop", "tablet", "mobile", "screen size", "responsive"],
      library:      ["shared components", "reusable", "master", "cross-course"],
      docType:      ["geometry", "reflow", "paged", "frame", "slide", "interactive", "static", "layout mode", "preset", "format"],
      backup:       ["restore", "snapshot", "recover", "copy"],
      header:       ["logo", "brand", "masthead", "banner", "header & footer"],
      footer:       ["disclaimer", "copyright", "nav bar", "small print", "header & footer"],
      hfDefault:    ["new course default", "starting header", "starting footer", "reuse header"],
      nav:          ["learner nav", "next", "previous", "progress", "pill"],
      layout:       ["page width", "margins", "padding", "column", "gutter"],
      endScreen:    ["completion", "finish", "exit", "congratulations", "certificate"],
      theme:        ["colours", "colors", "palette", "tokens", "styling", "brand"],
      fonts:        ["typeface", "custom font", "upload font", "woff", "otf", "ttf", "family"],
      glossary:     ["definitions", "terms", "jargon", "acronym"],
      motion:       ["animation", "confetti", "transition", "reduced motion", "effects"],
      components:   ["my components", "custom blocks", "reusable"],
      pipeline:     ["review", "viewer", "comments", "approval", "feedback", "sign-off"]
    };
    // Tie-break order only. It decides what the palette shows before you type, and which kind
    // wins when two entries score identically; it never overrides a better text match.
    var COMMAND_KINDS = ["action", "page", "setting", "guide", "block"];
    function commandKindBias(kind) {
      var i = COMMAND_KINDS.indexOf(kind);
      return i === -1 ? 0 : (COMMAND_KINDS.length - i);
    }
    function commandNorm(s) { return String(s == null ? "" : s).toLowerCase(); }
    // Flatten the four sources into ONE list of entries. Every entry carries the words it can be
    // found by and a `ref` naming what to do with it; routing lives with the caller, not here.
    function commandEntries(sources) {
      sources = sources || {};
      var out = [];
      (sources.settings || []).forEach(function (s) {
        out.push({ kind: "setting", label: s.title,
          sub: s.tab === "system" ? "System settings" : "Project settings",
          keywords: SETTINGS_ALIASES[s.key] || [], ref: { tab: s.tab, key: s.key } });
      });
      (sources.actions || []).forEach(function (a) {
        out.push({ kind: "action", label: a.label, sub: a.sub || "Action",
          keywords: a.keywords || [], ref: { id: a.id } });
      });
      (sources.guide || []).forEach(function (g) {
        out.push({ kind: "guide", label: g.title, sub: "User guide", keywords: [], ref: { id: g.id } });
      });
      (sources.pages || []).forEach(function (p) {
        out.push({ kind: "page", label: p.name, sub: "Page", keywords: [], ref: { pi: p.pi } });
      });
      (sources.blocks || []).forEach(function (b) {
        out.push({ kind: "block", label: b.label, sub: b.sub, keywords: [], ref: { pi: b.pi, bi: b.bi } });
      });
      return out;
    }
    // Score one entry against a query. -1 means "no match, drop it". Every whitespace-separated
    // token must appear somewhere in the entry, so "custom font" does not match every font row;
    // the returned score is the strongest single-token match, so the best reason wins.
    function scoreCommand(entry, q) {
      var query = commandNorm(q).replace(/^\s+|\s+$/g, "");
      var bias = commandKindBias(entry.kind);
      if (!query) return bias;
      var label = commandNorm(entry.label), sub = commandNorm(entry.sub);
      var keys = (entry.keywords || []).map(commandNorm);
      var keyText = keys.join(" ");
      var hay = label + " " + sub + " " + keyText;
      var tokens = query.split(/\s+/), best = -1;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (hay.indexOf(t) === -1) return -1; // one missing token disqualifies the entry
        var s;
        if (label.indexOf(t) === 0) s = 100;                       // the label starts with it
        else if ((" " + label).indexOf(" " + t) !== -1) s = 80;     // a word of the label starts with it
        else if (label.indexOf(t) !== -1) s = 60;                   // somewhere in the label
        else if (keys.indexOf(t) !== -1) s = 55;                    // an exact intent word
        else if ((" " + keyText).indexOf(" " + t) !== -1) s = 50;   // an intent word starts with it
        else if (keyText.indexOf(t) !== -1) s = 40;                 // inside an intent word
        else s = 20;                                                // only the category matched
        if (s > best) best = s;
      }
      return best + bias;
    }
    function rankCommands(entries, q, limit) {
      var scored = [];
      for (var i = 0; i < entries.length; i++) {
        var s = scoreCommand(entries[i], q);
        if (s < 0) continue;
        scored.push({ e: entries[i], s: s, i: i });
      }
      scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; }); // stable: input order breaks ties
      var out = [];
      for (var j = 0; j < scored.length && (!limit || out.length < limit); j++) out.push(scored[j].e);
      return out;
    }
    // Parse the user guide's own headings into index entries. The slug MUST match the one
    // mdToHtml emits (same lowercase/strip/dedupe rules) or a guide result would scroll nowhere.
    // Fenced code blocks are skipped so a `## ` inside an example is not indexed as a section.
    function parseGuideHeadings(md) {
      var lines = String(md == null ? "" : md).split("\n");
      var out = [], seen = {}, inFence = false;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^```/.test(line)) { inFence = !inFence; continue; }
        if (inFence) continue;
        var m = /^(##|###)\s+(.+?)\s*$/.exec(line);
        if (!m) continue;
        var raw = m[2];
        var base = raw.toLowerCase().replace(/`[^`]*`/g, "").replace(/[*_]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
        var slug = base, n = 2;
        while (seen[slug]) { slug = base + "-" + n; n++; }
        seen[slug] = true;
        // "## 3. The workspace" reads as "The workspace" in a result row -- the number is filing,
        // not meaning, and nobody searches for it.
        out.push({ id: slug, title: raw.replace(/^\d+\.\s*/, ""), level: m[1].length });
      }
      return out;
    }
    /* @f06-end */
    window.__commandIndex = { entries: commandEntries, score: scoreCommand, rank: rankCommands, guide: parseGuideHeadings }; // test hook

    // The verbs the palette can run. Curated on purpose: every one is a real, existing action, and
    // an action with no home elsewhere in the UI does not belong here either.
    function commandActions() {
      return [
        { id: "demo",        label: "Preview in Demo mode",         sub: "Output",   keywords: ["play", "preview", "fullscreen", "learner view"], run: function () { enterDemo(); } },
        { id: "publish",     label: "Send to publish",              sub: "Output",   keywords: ["queue", "package", "scorm", "release"], run: function () { var b = document.getElementById("send-to-publish-btn"); if (b) b.click(); } },
        { id: "settings",    label: "Open settings",                sub: "App",      keywords: ["preferences", "options"], run: function () { openSettingsModal(); } },
        { id: "guide",       label: "Open the user guide",          sub: "Help",     keywords: ["docs", "documentation", "manual", "help"], run: function () { openHelpModal(); } },
        { id: "find",        label: "Find and replace",             sub: "Document", keywords: ["search text", "replace"], run: function () { openFindReplace(); } },
        { id: "newPage",     label: "Add a page",                   sub: "Document", keywords: ["new page", "insert page"], run: function () { addPageAfterCurrent(); } },
        { id: "undo",        label: "Undo",                         sub: "Document", keywords: ["step back", "revert"], run: function () { undo(); } },
        { id: "redo",        label: "Redo",                         sub: "Document", keywords: ["step forward"], run: function () { redo(); } },
        { id: "fit",         label: "Fit all pages",                sub: "View",     keywords: ["zoom to fit", "overview"], run: function () { fitAll(); } },
        { id: "zoom100",     label: "Zoom to 100%",                 sub: "View",     keywords: ["actual size"], run: function () { zoomTo100(); } },
        { id: "panels",      label: "Hide or show the side panels", sub: "View",     keywords: ["zen", "maximise canvas", "full width"], run: function () { togglePanels(); } },
        { id: "stageSource", label: "Go to Source",                 sub: "Stage",    keywords: ["source stage"], run: function () { setStage("source"); } },
        { id: "stageEdit",   label: "Go to Edit",                   sub: "Stage",    keywords: ["edit stage", "canvas"], run: function () { setStage("edit"); } },
        { id: "stagePublish",label: "Go to Publish",                sub: "Stage",    keywords: ["publish stage"], run: function () { setStage("publish"); } }
      ];
    }
    // The guide lives on disk, so its headings are fetched once on first use and cached. Opened
    // from file:// the fetch fails and the palette simply carries no guide results -- the same
    // graceful degradation the help modal already has.
    var __guideIndexCache = null;
    function loadGuideIndex(then) {
      if (__guideIndexCache) { then(__guideIndexCache); return; }
      if (typeof fetch !== "function") { __guideIndexCache = []; then(__guideIndexCache); return; }
      E.loadGuide()
        .then(function (md) { __guideIndexCache = parseGuideHeadings(md); then(__guideIndexCache); })
        .catch(function () { __guideIndexCache = []; then(__guideIndexCache); });
    }
    // Everything the palette can find right now, from the live document + the settings tree.
    function commandSources(guide) {
      var settings = [];
      ["system", "project"].forEach(function (tab) {
        getSettingsSections(tab).forEach(function (s) { settings.push({ tab: tab, key: s.key, title: s.title }); });
      });
      var pages = [], blocks = [];
      (E.doc && E.doc.pages ? E.doc.pages : []).forEach(function (p, pi) {
        pages.push({ name: p.name, pi: pi });
        (p.blocks || []).forEach(function (b, bi) { blocks.push({ label: blockLabel(b), sub: p.name, pi: pi, bi: bi }); });
      });
      return { settings: settings, actions: commandActions(), guide: guide || [], pages: pages, blocks: blocks };
    }
    function runCommandEntry(entry) {
      if (!entry) return;
      if (entry.kind === "setting") { openSettingsSection(entry.ref.tab, entry.ref.key); return; }
      if (entry.kind === "action") {
        var acts = commandActions();
        for (var i = 0; i < acts.length; i++) if (acts[i].id === entry.ref.id) { acts[i].run(); return; }
        return;
      }
      if (entry.kind === "guide") { openHelpModal(entry.ref.id); return; }
      if (entry.kind === "page") { focusFrame(entry.ref.pi); setActivePage(entry.ref.pi); setSelection("page", entry.ref.pi); return; }
      clearAllMulti(); selectBlock(entry.ref.pi, entry.ref.bi);
    }
    // ---- Cmd-K command palette -----------------------------------------------
    var PALETTE_LIMIT = 40; // a palette you scroll is a list; this is a shortlist
    function openQuickJump() {
      if (document.querySelector(".qj-overlay")) return;
      var overlay = h("div", "qj-overlay");
      var box = h("div", "qj-box");
      var input = h("input", "qj-input"); input.type = "text";
      input.placeholder = "Find a setting, an action, a page or a guide section…"; input.spellcheck = false;
      var list = h("div", "qj-list");
      box.appendChild(input); box.appendChild(list); overlay.appendChild(box); document.body.appendChild(overlay);
      var entries = commandEntries(commandSources(__guideIndexCache));
      var filtered = rankCommands(entries, "", PALETTE_LIMIT), active = 0;
      function draw() {
        list.innerHTML = "";
        if (!filtered.length) { list.appendChild(h("div", "qj-empty", "Nothing matches.")); return; }
        filtered.forEach(function (it, idx) {
          var row = h("div", "qj-item" + (idx === active ? " is-active" : ""));
          row.appendChild(h("span", "qj-item__label", it.label));
          // The result names the category it lives in, so choosing it is never a leap of faith.
          row.appendChild(h("span", "qj-item__sub", it.sub));
          row.addEventListener("mousedown", function (e) { e.preventDefault(); choose(it); });
          list.appendChild(row);
        });
      }
      function choose(it) { close(); runCommandEntry(it); }
      function close() {
        if (!overlay.parentNode) return;
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
        popLayer("palette"); // uio-F06: Escape is the layer stack's, not this surface's
      }
      function onKey(e) {
        // Escape is deliberately NOT handled here -- the F05 layer stack owns it, so a palette
        // opened over the settings sheet closes the palette and leaves the sheet standing.
        if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); draw(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
        else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
      }
      function refilter() { filtered = rankCommands(entries, input.value, PALETTE_LIMIT); active = 0; draw(); }
      input.addEventListener("input", refilter);
      overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
      document.addEventListener("keydown", onKey, true);
      pushLayer("palette", close);
      draw(); input.focus();
      // The guide's headings arrive from disk. When they land, fold them in and re-rank in place
      // rather than making the author wait on a file read before the palette will open.
      loadGuideIndex(function (guide) {
        if (!overlay.parentNode || !guide.length) return;
        var wasActive = active;
        entries = commandEntries(commandSources(guide));
        refilter();
        active = Math.min(wasActive, Math.max(0, filtered.length - 1)); // don't yank the highlight
        draw();
      });
    }

    kernel.expose({
      openQuickJump: openQuickJump
    });
  }

  window.VersoPalette = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoPalette;
})();
