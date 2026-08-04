// editor/inspector/blocks.js -- which panel a selected block gets, and the panels that are
// big enough to need writing out (arch-P3b-07x).
//
// `renderBlockInspector` is a table from block type to panel. Most rows are one line: the type
// hands its content renderer to the shared two-level shell and stops. The rows that are NOT one
// line are the blocks whose settings are structural rather than cosmetic -- a quiz owns its
// questions, an accordion its items, a sequence its steps, a card deck and a card reveal their
// cards. You cannot edit those on the canvas the way you edit a heading, so each one carries a
// panel that adds, reorders and deletes the model underneath it. Those six panels and the table
// that picks between them are one concern: the table is unreadable without them, and they exist
// only because it names them.
//
// The embed panel joins them. It is the same shape (a block whose settings are its model) and it
// was already in the table; it sat 600 lines away only because it grew up beside the colour row
// it borrows.
//
// What stayed behind is what the table DELEGATES to and does not own: the two-level shell itself,
// the text/image/table/columns content renderers, and the hotspot panel, which is a module of its
// own. The universal tail every panel ends with -- appearance and the block actions -- is
// block-actions.js.
//
// Editor chrome only. Every panel writes to the document and re-renders through the same
// reapplyStructural / mount path the canvas uses; none of it reaches into render().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pushHistory", "sectionGroup", "renderModelView", "iconField", "switchRow",
      "renderBlockTwoLevel", "segmentedLive", "iconBtn", "reRenderBlockNode", "colourControl", "renderContentlessBlock",
      "beginSections", "disclosure", "endSections", "colorFieldFlat", "reapplyStructural", "findPageOfBlock",
      "reselectBlockNode", "panelSection", "CONTENT_PURE_DECL", "CONTENT_DECL", "fieldRow", "twoUp",
      "fitEmbeds", "assetRef", "repeatedList", "scheduleSave", "embedColorVarsCached", "canvas",
      "activeModeNow", "activeTheme", "renderInspector", "paletteColorRow", "dsSelect", "clone",
      "courseNavControls", "openSettingsSection", "renderHotspotInspector", "renderFrameOrGroupTwoLevel", "IMAGE_PURE_DECL", "renderImageContent",
      "imageChromeIo", "blockChromeHandlers", "renderTextContent", "renderSpacerBody", "renderColumnsBody", "renderTableInspector",
      "renderComponentGridBody", "renderLibraryInstanceBody", "renderCheckboxBody", "blockLabel", "renderBlockActionsSection", "setInspector",
      "inspector"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        pushHistory = E.pushHistory,
        sectionGroup = E.sectionGroup,
        renderModelView = E.renderModelView,
        iconField = E.iconField,
        switchRow = E.switchRow,
        renderBlockTwoLevel = E.renderBlockTwoLevel,
        segmentedLive = E.segmentedLive,
        iconBtn = E.iconBtn,
        reRenderBlockNode = E.reRenderBlockNode,
        colourControl = E.colourControl,
        renderContentlessBlock = E.renderContentlessBlock,
        beginSections = E.beginSections,
        disclosure = E.disclosure,
        endSections = E.endSections,
        colorFieldFlat = E.colorFieldFlat,
        reapplyStructural = E.reapplyStructural,
        findPageOfBlock = E.findPageOfBlock,
        reselectBlockNode = E.reselectBlockNode,
        panelSection = E.panelSection,
        CONTENT_PURE_DECL = E.CONTENT_PURE_DECL,
        CONTENT_DECL = E.CONTENT_DECL,
        fieldRow = E.fieldRow,
        twoUp = E.twoUp,
        fitEmbeds = E.fitEmbeds,
        assetRef = E.assetRef,
        repeatedList = E.repeatedList,
        scheduleSave = E.scheduleSave,
        embedColorVarsCached = E.embedColorVarsCached,
        canvas = E.canvas,
        activeModeNow = E.activeModeNow,
        activeTheme = E.activeTheme,
        renderInspector = E.renderInspector,
        paletteColorRow = E.paletteColorRow,
        dsSelect = E.dsSelect,
        clone = E.clone,
        courseNavControls = E.courseNavControls,
        openSettingsSection = E.openSettingsSection,
        renderHotspotInspector = E.renderHotspotInspector,
        renderFrameOrGroupTwoLevel = E.renderFrameOrGroupTwoLevel,
        IMAGE_PURE_DECL = E.IMAGE_PURE_DECL,
        renderImageContent = E.renderImageContent,
        imageChromeIo = E.imageChromeIo,
        blockChromeHandlers = E.blockChromeHandlers,
        renderTextContent = E.renderTextContent,
        renderSpacerBody = E.renderSpacerBody,
        renderColumnsBody = E.renderColumnsBody,
        renderTableInspector = E.renderTableInspector,
        renderComponentGridBody = E.renderComponentGridBody,
        renderLibraryInstanceBody = E.renderLibraryInstanceBody,
        renderCheckboxBody = E.renderCheckboxBody,
        blockLabel = E.blockLabel,
        renderBlockActionsSection = E.renderBlockActionsSection,
        setInspector = E.setInspector;

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
        var _eins = E.inspector; E.setInspector(secBody);
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
        E.inspector.appendChild(pasteBtn);
        // Deferred large source: show a compact placeholder + "Load HTML to edit" instead of
        // the giant textarea, so selecting the block + using the rest of the panel stays snappy.
        var loadWrap = null;
        if (deferSource) {
          loadWrap = h("div", null);
          loadWrap.appendChild(h("div", "insp-hint", "Large interaction (" + (rawHtml.length / 1048576).toFixed(1) + " MB). The source is hidden so the panel stays responsive — load it only to edit the raw HTML."));
          var loadBtn = h("button", "prop-btn", "Load HTML to edit");
          loadBtn.addEventListener("click", loadSource);
          loadWrap.appendChild(loadBtn);
          E.inspector.appendChild(loadWrap);
        } else {
          E.inspector.appendChild(codeIn);
        }

        E.setInspector(panelSection(E.inspector, "Or bundled file"));
        // §10 design-consistency: canonical fieldRow (was labeledRow); commits on change.
        fieldRow("src", block.src, function (v) { block.src = v || undefined; node = reRenderBlockNode(node); renderModelView(); }, "path/to/file.html");
        } finally { E.setInspector(_eins); }
        });

        // VV state-conditional: layout/flip/appearance are meaningless with no
        // interaction yet -- show them only once there's HTML or a bundled file.
        if (block.html || block.src) {
        // Layout — interaction fit (embed sizing, not block container chrome).
        sectionGroup("Layout", "Layout", function (secBody) {
        var _lins = E.inspector; E.setInspector(secBody);
        try {
        // §10 design-consistency: dimensional fields use the canonical iconField (was labeledRow).
        E.inspector.appendChild(twoUp(
          iconField("W", { value: block.fitWidth || 900, unit: "px", placeholder: "900", step: 10, min: 100, max: 2000, datalist: "dl-gap", title: "Max width — the interaction's natural design width; it never displays wider than this and scales down to fit narrower screens",
            onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { block.fitWidth = n; fitEmbeds(); renderModelView(); } } }).wrap,
          iconField("H", { value: block.height || 500, unit: "px", placeholder: "500", step: 10, min: 50, max: 2000, datalist: "dl-gap", title: "Design height — sets the aspect ratio; scales together with the width",
            onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { block.height = n; fitEmbeds(); renderModelView(); } } }).wrap));
        // §174 unified: one responsive model. The interaction scales to fit the screen up to
        // its Max width, keeps aspect ratio, and stays centred — no Fit/Fill or align juggling.
        E.inspector.appendChild(h("div", "insp-hint", "Scales to fit the screen up to its Max width, keeps its aspect ratio, and stays centred. Set the width/height to the interaction's natural design size."));
        } finally { E.setInspector(_lins); }
        });

        // Light/Dark — how this interaction reacts when the learner flips light/dark.
        // The theme (tokens + data-mode) is always pushed in; this only chooses the
        // VISUAL fallback for interactions that don't read the tokens themselves:
        // Tokens = conservative bg/text nudge (default) · Invert = aggressive
        // filter-invert in dark (opt-in) · None = leave it alone (self-themed).
        sectionGroup("Light/Dark", "On light & dark", function (secBody) {
        var _dins = E.inspector; E.setInspector(secBody);
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
          E.inspector.appendChild(disclosure("embedPalette", "Interaction colours", function (discBody) {
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
                if (window.pushEmbedTheme) window.pushEmbedTheme(canvas, activeModeNow(), activeTheme().color);
              }
              renderModelView(); renderInspector();
            };
            embedVars.forEach(function (v) {
              paletteColorRow(discBody, { key: v.name, swatchColor: v.value, label: v.name, map: block.embedColorMap, tokens: tokens, roleOf: embedRoleOf, refresh: embedRefresh });
            });
          }));
        }
        } finally { E.setInspector(_dins); }
        });

        // Appearance — border + corner radius (embed skin).
        sectionGroup("Appearance", "Appearance", function (secBody) {
          var _ains = E.inspector; E.setInspector(secBody);
          try { embedAppearance(node, block); } finally { E.setInspector(_ains); }
        });
        } // end has-content
      } else {
        // webEmbed — Content (URL / offline video) + Appearance.
        sectionGroup("Content", "Source", function (secBody) {
        var _wins = E.inspector; E.setInspector(secBody);
        try {
        var _srcBody = E.inspector;
        E.setInspector(panelSection(_srcBody, "URL"));
        var urlIn = h("textarea", "prop-input"); urlIn.spellcheck = false;
        urlIn.placeholder = "Vimeo / YouTube / embed URL";
        urlIn.value = block.url || "";
        var readout = h("div", "insp-hint", describeUrl(block.url));
        urlIn.addEventListener("input", function () { block.url = urlIn.value; readout.textContent = describeUrl(urlIn.value); renderModelView(); });
        urlIn.addEventListener("change", function () { block.url = urlIn.value; node = reRenderBlockNode(node); readout.textContent = describeUrl(urlIn.value); });
        E.inspector.appendChild(urlIn); E.inspector.appendChild(readout);

        E.setInspector(panelSection(_srcBody, "Offline video (self-host)"));
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
        E.inspector.appendChild(fileBtn);

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
        E.inspector.appendChild(rmBtn);

        // §10 design-consistency: canonical iconField (was labeledRow); live-applies iframe height.
        // Height is the section's own row, not the offline-video group's — back onto the body.
        E.setInspector(_srcBody);
        E.inspector.appendChild(iconField("H", { value: block.height || 360, unit: "px", placeholder: "360", step: 10, min: 50, max: 2000, datalist: "dl-gap", title: "Height",
          onchange: function (v) { var n = parseInt(v, 10); if (!isNaN(n)) { block.height = n; var f = node.querySelector(".embed__iframe"); if (f) f.style.height = n + "px"; renderModelView(); } } }).wrap);
        } finally { E.setInspector(_wins); }
        });

        // Appearance — border + corner radius (embed skin).
        sectionGroup("Appearance", "Appearance", function (secBody) {
          var _ains = E.inspector; E.setInspector(secBody);
          try { embedAppearance(node, block); } finally { E.setInspector(_ains); }
        });
      }

      endSections(E.inspector);
      // footer omitted (spacing + actions at Block level)
    }

    // border + corner radius controls (default off — embeds render as authored).
    // §10 design-consistency: migrated from a bespoke prop-toggle-row + labeledRow to
    // the canonical segmentedLive + iconField, applied live (no mount).
    function embedAppearance(node, block) {
      // #161: no own header — rendered inside the canonical Appearance sectionGroup at the call site.
      switchRow("Stroke", function () { return !!block.border; },
        function (v) { block.border = v; applyAppearance(node, block); renderModelView(); });
      E.inspector.appendChild(iconField(Icon("radius"), { value: block.radius, unit: "px", placeholder: "0", step: 1, min: 0, max: 100, datalist: "dl-radius", title: "Corner radius",
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

      var head = h("div", "prop-component"); head.appendChild(h("span", null, "Quiz")); E.inspector.appendChild(head);
      E.inspector.appendChild(h("div", "insp-hint", "Kicker, title, question text, options and feedback are all edited on the canvas. Play the real interaction in demo mode."));

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
      var _qins = E.inspector; E.setInspector(secBody);
      try {
      block.questions.forEach(function (q, qi) {
        var type = q.type || "multipleChoice";
        var typeLabel = type === "fillBlank" ? "Fill the blank" : "Multiple choice";
        E.inspector.appendChild(disclosure("quiz-q-" + (q.id || qi), "Q" + (qi + 1) + " · " + typeLabel, function (body) {
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
      E.inspector.appendChild(addQ);
      } finally { E.setInspector(_qins); }
      });

      endSections(E.inspector);
      // footer omitted (spacing + actions at Block level; Behaviour/Completion merged above)
    }

    // Accordion / Tabs inspector: display mode + (accordion-only) open-mode + a
    // section list (title edit / add a block to a section / delete section / add
    // section). Section CONTENT is ordinary child blocks edited on the canvas.
    // Shared surface-texture controls for cardReveal + accordion/tabs: pick the pattern
    // (grid / dots / none) and its colour. Pure data on the block (block.pattern +
    // block.patternColor) -> render stamps data-pattern + --tex-color; ships in SCORM.
    function patternControls(block, refresh, target) {
      var host = panelSection(target || E.inspector, "Texture");
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
      E.inspector.appendChild(h("div", "insp-hint", "Section titles and content are edited on the canvas. Play it in demo mode to expand/collapse."));

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
        var _ins = E.inspector; E.setInspector(secBody);
        try {
          var addSec = h("button", "prop-btn prop-btn--accent", "+ Add section");
          addSec.addEventListener("click", function () {
            pushHistory();
            block.items.push({ title: "New section", children: [{ type: "paragraph", text: "Section content." }] });
            refresh();
          });
          E.inspector.appendChild(addSec);
          block.items.forEach(function (item, i) {
            fieldRow("Section " + (i + 1), item.title, function (v) { item.title = v; refresh(); }, "Section title");
            var row = h("div", "insp-row");
            var addB = h("button", "prop-toggle", "+ block"); addB.type = "button"; addB.title = "Add a text block to this section";
            addB.addEventListener("click", function () { pushHistory(); item.children = item.children || []; item.children.push({ type: "paragraph", text: "Section content." }); refresh(); });
            var delB = h("button", "prop-toggle", "Delete"); delB.type = "button"; delB.title = "Delete this section";
            delB.addEventListener("click", function () { pushHistory(); block.items.splice(i, 1); refresh(); });
            row.appendChild(addB); row.appendChild(delB);
            E.inspector.appendChild(row);
          });
        } finally { E.setInspector(_ins); }
      });

      endSections(E.inspector);
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
      E.inspector.appendChild(h("div", "insp-hint", "Step titles and content are edited on the canvas. Reveal behaviour plays in demo mode."));

      // #37: canonical taxonomy (mirrors accordion / cardReveal) — Behaviour (spine +
      // orientation + reveal), Appearance (surface texture), Content (steps). Buffered +
      // emitted in PanelLayout order by endSections; the old flat Spine sub-header is
      // gone (the Behaviour sectionGroup title carries it). Inner code uses the inspector
      // swap idiom so every control/hint keeps its default-target wiring unchanged.
      beginSections();

      // Behaviour — marker spine + orientation + reveal interaction.
      sectionGroup("Behaviour", "Behaviour", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try {
      segmentedLive("Marker", [["Numbered", "numbered"], ["Dated", "dated"], ["Plain", "plain"]],
        function (v) { return spine === v; },
        function (v) { block.spine = v; refresh(); });
      E.inspector.appendChild(h("div", "insp-hint", spine === "dated" ? "Dated: each step's marker is your own free text (“2019”, “Phase 1”, “0600Z”); empty falls back to the number." : spine === "plain" ? "Plain: a simple node dot — the title and body carry the step." : "Numbered: markers count 1, 2, 3… automatically as you add or reorder steps."));
      segmentedLive("Orientation", [["Vertical", "vertical"], ["Horizontal", "horizontal"]],
        function (v) { return (block.orient === "horizontal" ? "horizontal" : "vertical") === v; },
        function (v) { block.orient = v; refresh(); });
      var reveal = block.reveal === "click" || block.reveal === "static" ? block.reveal : "scroll";
      segmentedLive("Reveal", [["Scroll", "scroll"], ["Click", "click"], ["Static", "static"]],
        function (v) { return reveal === v; },
        function (v) { block.reveal = v; refresh(); });
      E.inspector.appendChild(h("div", "insp-hint", reveal === "click" ? "Click: learners step through with ‹ › arrows (one at a time, cumulative)." : reveal === "static" ? "Static: every step shown at once, no animation." : "Scroll: steps reveal as they enter view and the spine fills. Reduced-motion falls back to static."));
        } finally { E.setInspector(_ins); }
      });

      // Appearance — shared surface texture (grid / dots / none).
      sectionGroup("Appearance", "Appearance", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try { patternControls(block, refresh); } finally { E.setInspector(_ins); }
      });

      // Content — the steps list (payload).
      sectionGroup("Content", "Steps", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try {

      // SPEC-ui-kit ticket 6: steps are the canonical repeated-item list — one row per
      // step (grip · full-width title · trash, "+" above), replacing the old 3-5 rows
      // per step. Per-step secondaries (date on the dated spine, marker icon, +block
      // escape hatch) ride the row as compact icons (rowExtras) — James's icon density.
      repeatedList(E.inspector, "Steps", {
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
        } finally { E.setInspector(_ins); }
      });

      endSections(E.inspector);
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
      E.inspector.appendChild(h("div", "insp-hint", "Card content is edited on the canvas — drop any blocks into a card. Learners page through the deck with the ‹ › arrows in demo mode. Card numbers are automatic."));

      patternControls(block, refresh);

      // Fill (per mode, so it still switches light/dark) — mirrors card-reveal / accordion.
      E.inspector.appendChild(disclosure("carddeck-fill", "Fill", function (body) {
        body.appendChild(h("div", "insp-hint", "Card fill per mode, so it still switches light/dark. Blank = the default (dark #1c1c1c / light #fff)."));
        block.cardBox = block.cardBox || {};
        var cb = block.cardBox;
        colourControl("Fill (dark)", cb.fillDark, function (v) { if (v == null) delete cb.fillDark; else cb.fillDark = v; refresh(); }, body);
        colourControl("Fill (light)", cb.fillLight, function (v) { if (v == null) delete cb.fillLight; else cb.fillLight = v; refresh(); }, body);
      }));

      repeatedList(E.inspector, "Cards", {
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
      E.inspector.appendChild(h("div", "insp-hint", "Card content (headings, text, images) is edited on the canvas."));
      // Reveal style: one interaction mode per block (mutually exclusive). Function-scope so
      // the Content section's card-add can seed a flip front.
      var rs = block.revealStyle === "flip" ? "flip" : block.revealStyle === "off" ? "off" : "reveal";
      // #161: canonical taxonomy — Behaviour (reveal + number), Layout (grid), Appearance
      // (texture + card skin), Content (cards). Emitted in PanelLayout order by endSections.
      beginSections();

      // Behaviour — the reveal interaction + card numbering.
      sectionGroup("Behaviour", "Reveal", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try {
        segmentedLive("Reveal style", [["Reveal", "reveal"], ["Flip", "flip"], ["Off", "off"]],
          function (v) { return rs === v; },
          function (v) { if (v === "reveal") delete block.revealStyle; else block.revealStyle = v; if (v === "flip") ensureFlipFronts(block); refresh(); }, E.inspector);
        E.inspector.appendChild(h("div", "insp-hint", rs === "flip" ? "Flip: click a card to turn it over in 3D. Both faces hold their own blocks — use a card's flip button on the canvas to edit its other side." : rs === "off" ? "Off: static cards, no interaction (content always shown)." : "Reveal: hold/hover/tap clears a frosted cover to reveal the content."));
        if (rs === "reveal") {
          switchRow("Cover", function () { return !block.noCover; }, function (v) { block.noCover = !v; refresh(); });
          if (!block.noCover) {
            fieldRow("Cover hint", block.hint, function (v) { block.hint = v; refresh(); }, "Hold to reveal");
            // Frosted-glass cover: colour + opacity + blur. The fill is translucent so the
            // backdrop-blur reads (a solid fill defeats it). Clear the swatch -> theme default.
            E.inspector.appendChild(h("div", "insp-hint", "The cover is frosted glass — a translucent tint over a blur. Clear the colour to track the theme."));
            colorFieldFlat("Cover colour", block.coverColor, function (v) { if (v == null) delete block.coverColor; else block.coverColor = v; refresh(); });
            E.inspector.appendChild(twoUp(
              iconField(Icon("contrast"), { value: block.coverOpacity, unit: "%", placeholder: "48", step: 2, min: 0, max: 100, datalist: "dl-gap", title: "Cover opacity",
                onchange: function (v) { pushHistory(); var n = parseInt(v, 10); if (isNaN(n)) delete block.coverOpacity; else block.coverOpacity = n; refresh(); } }).wrap,
              iconField(Icon("blur"), { value: block.coverBlur, unit: "px", placeholder: "16", step: 1, min: 0, max: 40, datalist: "dl-gap", title: "Cover blur",
                onchange: function (v) { pushHistory(); var n = parseInt(v, 10); if (isNaN(n)) delete block.coverBlur; else block.coverBlur = n; refresh(); } }).wrap));
          }
        }
        switchRow("Number", function () { return !block.noIndex; }, function (v) { block.noIndex = !v; refresh(); });
        } finally { E.setInspector(_ins); }
      });

      // Layout — grid columns / gap / card height.
      sectionGroup("Layout", "Grid", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try {
        E.inspector.appendChild(twoUp(
          iconField("W", { value: block.cols, unit: "", placeholder: "3", step: 1, min: 1, max: 6, title: "Columns",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.cols; else block.cols = n; refresh(); } }).wrap,
          iconField(Icon("padding"), { value: block.gap, unit: "px", placeholder: "16", step: 2, min: 0, max: 60, datalist: "dl-gap", title: "Gap between cards",
            onchange: function (v) { var n = parseInt(v, 10); if (isNaN(n)) delete block.gap; else block.gap = n; refresh(); } }).wrap));
        E.inspector.appendChild(iconField("H", { value: block.cardH, unit: "px", placeholder: "320", step: 10, min: 80, max: 900, datalist: "dl-gap", title: "Card height",
          onchange: function (v) { pushHistory(); var n = parseInt(v, 10); if (isNaN(n)) delete block.cardH; else block.cardH = n; refresh(); } }).wrap);
        } finally { E.setInspector(_ins); }
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
        var _ins = E.inspector; E.setInspector(secBody);
        try {
        var addCard = h("button", "prop-btn prop-btn--accent", "+ Add card");
        addCard.addEventListener("click", function () {
          pushHistory();
          var fresh = { children: [{ type: "heading", text: "Card " + (block.items.length + 1) }, { type: "paragraph", text: "Hidden detail." }] };
          if (rs === "flip") fresh.front = [{ type: "heading", text: block.hint || "Flip" }];
          block.items.push(fresh);
          refresh();
        });
        E.inspector.appendChild(addCard);
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
          row.appendChild(delB); E.inspector.appendChild(row);
        });
        } finally { E.setInspector(_ins); }
      });

      endSections(E.inspector);
      // footer omitted (spacing + actions at Block level; cardReveal appearance stays in Content)
    }

    // Contextual sidebar (James 2026-07-08): selecting the footer nav bar (the "nav pill") on the
    // canvas surfaces ITS settings inline — the same Learner-nav controls the ⚙ Settings dialog
    // holds — so you edit the thing you just clicked instead of hunting through the modal. The
    // surrounding footer furniture (padding, logo, disclaimer) still lives in ⚙ → a pointer links
    // there. Mirrors the pattern for page/block selections: the sidebar shows the relevant slice.
    function renderCourseNavInspector(node) {
      var block = node.__block;
      var head = h("div", "prop-component"); head.appendChild(h("span", null, "Learner nav")); E.inspector.appendChild(head);
      courseNavControls(block, E.inspector);
      var toFooter = h("button", "insp-hint insp-backlink", "Footer padding, logo & disclaimer → ⚙ Header & Footer");
      toFooter.type = "button";
      toFooter.addEventListener("click", function () { openSettingsSection("project", "footer"); });
      E.inspector.appendChild(toFooter);
    }

    // ---- INSPECTORS: block type -> its panel (arch-P4-02) ---------------------
    // This was a seventeen-branch if/else whose every arm ended in `return`, which meant the
    // ORDER of the arms carried a precedence rule nobody had written down and the fall-through at
    // the bottom -- the label-only panel a type with no arm gets -- looked like dead code rather
    // than the deliberate default it is.
    //
    // As a table the three shapes are visible side by side. `twoLevel` is the common case: the
    // type hands a content renderer to the shared two-level shell. `contentless` is a block whose
    // settings ARE its content, so there is nothing to edit on the canvas. `custom` is the escape
    // hatch for the two that are neither.
    //
    // A type with no row is not an error. It gets the label-only panel plus the universal tail,
    // which is the right answer for a type whose only settings are appearance -- subheading, quote
    // and list are all here on purpose. The contract test asserts the table holds no type that
    // render.js does not know about; it deliberately does NOT require a row per type, because
    // requiring one would push nine empty rows into this table to satisfy a checker.
    var INSPECTORS = {
      quiz:            { kind: "twoLevel",     label: "Quiz",            decl: "CONTENT_PURE_DECL", body: function () { return renderQuizInspector; } },
      accordion:       { kind: "twoLevel",     label: "Accordion",       decl: "CONTENT_PURE_DECL", body: function () { return renderAccordionInspector; } },
      cardReveal:      { kind: "twoLevel",     label: "Card reveal",     decl: "CONTENT_PURE_DECL", body: function () { return renderCardRevealInspector; } },
      cardDeck:        { kind: "twoLevel",     label: "Card deck",       decl: "CONTENT_DECL",      body: function () { return renderCardDeckInspector; } },
      sequence:        { kind: "twoLevel",     label: "Sequence",        decl: "CONTENT_DECL",      body: function () { return renderSequenceInspector; } },
      table:           { kind: "twoLevel",     label: "Table",           decl: "CONTENT_DECL",      body: function () { return renderTableInspector; } },
      // the hotspot panel is a module of its own; the shell takes the block, not the node
      hotspot:         { kind: "twoLevel",     label: "Image hotspots",  decl: "CONTENT_PURE_DECL", body: function () { return function (n) { renderHotspotInspector(n.__block); }; } },
      // the three plain text types share one arm; the label is the type, capitalised
      heading:         { kind: "twoLevel",     label: null,              decl: "CONTENT_DECL",      body: function () { return renderTextContent; } },
      paragraph:       { kind: "twoLevel",     label: null,              decl: "CONTENT_DECL",      body: function () { return renderTextContent; } },
      note:            { kind: "twoLevel",     label: null,              decl: "CONTENT_DECL",      body: function () { return renderTextContent; } },
      spacer:          { kind: "contentless",  label: "Spacer",          body: function () { return renderSpacerBody; } },
      columns:         { kind: "contentless",  label: "Columns",         body: function () { return renderColumnsBody; } },
      componentGrid:   { kind: "contentless",  label: "Component grid",  body: function () { return renderComponentGridBody; } },
      libraryInstance: { kind: "contentless",  label: "Library instance", body: function () { return renderLibraryInstanceBody; } },   // #20: live-linked mirror, content lives in the master
      checkbox:        { kind: "contentless",  label: "Checkbox",        body: function () { return renderCheckboxBody; } },
      divider:         { kind: "contentless",  label: "Divider",         body: function () { return function () { E.inspector.appendChild(h("div", "insp-hint", "A horizontal rule — styling follows the course theme.")); }; } },
      // the two that are neither shape
      courseNav:       { kind: "custom",       run: function (node) { renderCourseNavInspector(node); } },
      frame:           { kind: "custom",       run: function (node) { renderFrameOrGroupTwoLevel(node); } },   // container chrome + children
      group:           { kind: "custom",       run: function (node) { renderFrameOrGroupTwoLevel(node); } },
      // image is two-level but carries chrome io + handlers the shell needs
      image:           { kind: "custom",       run: function (node) { renderBlockTwoLevel(node, "Image", IMAGE_PURE_DECL, function (n) { renderImageContent(n.__block); }, imageChromeIo(node.__block), blockChromeHandlers(node.__block)); } }   // #88 stroke
    };
    var INSPECTOR_DECLS = { CONTENT_DECL: function () { return CONTENT_DECL; }, CONTENT_PURE_DECL: function () { return CONTENT_PURE_DECL; } };

    function renderBlockInspector(node) {
      var block = node.__block;
      var row = INSPECTORS[block.type];
      if (row) {
        if (row.kind === "custom") { row.run(node); return; }
        if (row.kind === "twoLevel") {
          var label = row.label || (block.type.charAt(0).toUpperCase() + block.type.slice(1));
          renderBlockTwoLevel(node, label, INSPECTOR_DECLS[row.decl](), row.body());
          return;
        }
        renderContentlessBlock(node, row.label, row.body());
        return;
      }
      // No row: the label-only panel. A type whose only settings are appearance ends here and the
      // universal tail below is the whole panel -- subheading, quote and list all do.
      var head = h("div", "prop-component");
      head.appendChild(h("span", null, blockLabel(block)));
      E.inspector.appendChild(head);
      renderBlockActionsSection(block);
    }

    kernel.expose({
      renderBlockInspector: renderBlockInspector, renderEmbedInspector: renderEmbedInspector
    });
    kernel.provide({ INSPECTORS: INSPECTORS });
  }

  window.VersoInspectorBlocks = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoInspectorBlocks;
})();
