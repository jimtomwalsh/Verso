// editor/theme.js -- the course's palette, and the panel that edits it (arch-P3b-07f).
//
// A theme belongs to the COURSE, not to the tool: doc.theme is the home of the tokens, and this
// file keeps a flat { dark, light } projection of it that applyTheme, render and the export all
// consume. The projection shares the document's group objects BY REFERENCE, which is what makes a
// panel edit land on doc.theme in place and persist with the document rather than beside it.
//
// Two modes, two independent questions. Which palette you PREVIEW is a workspace preference and
// stays editor-global, because the export bakes both and the learner does the toggling. Which
// palette the panel EDITS is separate again, so the light set can be worked on while the dark one
// is on screen.
//
// PRESETS are the cross-course half. Applying one COPIES its tokens into this document rather than
// linking to it, so a shared starting point can never reach back and restyle a course that was
// finished months ago.
//
// The panel itself is the largest part and the least interesting: named text styles, the type
// cluster, the colour rows, the button style. It is worth reading only for how it re-applies --
// every edit goes through reapplyTheme, which re-emits the CSS custom properties, so the canvas
// restyles under the author's cursor without a rebuild.
//
// This file OWNS the previewed mode and the working projection now, and provides both, so the
// preview, the tour board and the canvas ask it rather than asking editor.js to hold them.
//
// The banner it came from also held the in-app user guide (moved) and the canonical dropdown
// (moved to the control set, where every other canonical control lives).
//
// Editor chrome only: it decides what render() is handed, and never renders.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "renderInspector", "panelSection", "twoUp", "colorFieldFlat", "clone",
      "pushHistory", "saveRegistry", "registry", "canvas", "mount",
      "iconField", "promptModal", "confirmModal", "refreshSettingsPanes", "scheduleSave", "modalHead",
      "modalActions", "dsSelect", "typeCluster", "modalText", "segmentedLive",
      "colourControl", "buildFontPicker", "resolveScoped", "scopeChain", "BOX_SYSTEM_DEFAULTS", "switchRow",
      "onOffLabel", "getTextRoles", "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        renderInspector = E.renderInspector,
        panelSection = E.panelSection,
        twoUp = E.twoUp,
        colorFieldFlat = E.colorFieldFlat,
        clone = E.clone,
        pushHistory = E.pushHistory,
        saveRegistry = E.saveRegistry,
        registry = E.registry,
        canvas = E.canvas,
        mount = E.mount,
        iconField = E.iconField,
        promptModal = E.promptModal,
        confirmModal = E.confirmModal,
        refreshSettingsPanes = E.refreshSettingsPanes,
        scheduleSave = E.scheduleSave,
        modalHead = E.modalHead,
        modalActions = E.modalActions,
        dsSelect = E.dsSelect,
        typeCluster = E.typeCluster,
        modalText = E.modalText,
        segmentedLive = E.segmentedLive,
        colourControl = E.colourControl,
        buildFontPicker = E.buildFontPicker,
        resolveScoped = E.resolveScoped,
        scopeChain = E.scopeChain,
        BOX_SYSTEM_DEFAULTS = E.BOX_SYSTEM_DEFAULTS,
        switchRow = E.switchRow,
        onOffLabel = E.onOffLabel,
        getTextRoles = E.getTextRoles;

    // arch-P3b-07styles: the NAMED styles. They were in editor.js under a banner about Product
    // tag vocabulary; this file has always owned the panel that edits them, and `renameTextStyle`
    // is the only thing that knows a rename has to repoint every styleRef in the document.
    function getTextStyles() {
      if (!E.doc.styles) {
        E.doc.styles = clone(window.TEXT_STYLES);
      }
      return E.doc.styles;
    }
    // #127: per-block-TYPE default appearance, on E.doc.theme.blockStyles (the render arg,
    // reached in render/export via the __blockStyles per-pass hook). Ensures the theme +
    // its blockStyles map exist so a capture/edit never crashes on an old/partial E.doc.
    function getBlockStyles() {
      if (!E.doc.theme) E.doc.theme = window.defaultDocTheme();
      if (!E.doc.theme.blockStyles || typeof E.doc.theme.blockStyles !== "object") E.doc.theme.blockStyles = {};
      return E.doc.theme.blockStyles;
    }
    // Rename a named text style AND repoint every block.styleRef to the new name so
    // references never break (deep-walk the whole E.doc — nested blocks + headerFooter).
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
      })(E.doc);
      // #145: the type->role map holds style NAMES (not styleRef fields), so repoint it too.
      if (E.doc.textRoles) Object.keys(E.doc.textRoles).forEach(function (t) { if (E.doc.textRoles[t] === oldName) E.doc.textRoles[t] = newName; });
      if (window.saveRegistry) saveRegistry(registry);
      mount();
      return true;
    }
    window.__renameTextStyle = renameTextStyle; // headless/browser test hook

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
    var workingThemes = window.docThemeToModes(E.doc && E.doc.theme ? E.doc.theme : window.defaultDocTheme());
    function activeTheme() { return workingThemes[activeMode]; }
    // SSSS: which token SET the Theme panel EDITS — independent of the PREVIEWED mode
    // (the NNN top-bar toggle drives the preview/activeMode). null = follow the preview.
    // Lets you edit the light AND dark palettes explicitly, not just the active one.
    var themeEditMode = null;
    // What the rest of the chrome may ask about the previewed palette. This file owns the mode and
    // the projection now, so the canvas, the preview and the tour board ask rather than reaching
    // into editor.js for state it was only holding on this file's behalf (arch-P3b-07f).
    function activeModeNow() { return activeMode; }
    function setActiveMode(m) { activeMode = m; }
    function workingThemesNow() { return workingThemes; }
    function themeEditName() { return themeEditMode || activeMode; }
    function themeEdit() { return workingThemes[themeEditName()]; }
    // Rebuild the working cache from the current doc's theme (called by mount/switchDoc so
    // the panel + canvas + export always reflect THIS course's theme).
    function syncWorkingFromDoc() {
      if (!E.doc) return;
      if (!E.doc.theme) E.doc.theme = window.defaultDocTheme();
      workingThemes = window.docThemeToModes(E.doc.theme);
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
    // Which preset the picker SHOWS is per-course: switching document clears it rather than
    // bleeding one course's choice into the next.
    function clearThemePresetChoice() { themePresetSel = null; }
    var TP = window.ThemePresets;
    function loadThemePresets() { return TP.load(localStorage); }
    function saveThemePresets(p) { return TP.save(localStorage, p); }
    function mergeTextStyles(docStyles, presetStyles) { return window.mergeTextStyles(docStyles, presetStyles); }
    function applyThemePresetToDoc(d, preset) { return window.applyThemePresetToDoc(d, preset); }
    function snapshotThemePreset() { return window.snapshotThemePreset(E.doc.theme, getTextStyles(), Date.now()); }
    function saveThemePreset(name) {
      var presets = loadThemePresets();
      if (!TP.put(presets, name, snapshotThemePreset())) return false;
      saveThemePresets(presets); return true;
    }
    function applyThemePreset(name) {
      var presets = loadThemePresets(), p = presets[name]; if (!p) return false;
      pushHistory(); // theme + styles are doc data now -> an apply is undoable
      applyThemePresetToDoc(E.doc, p);
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
        if (!E.doc.theme) E.doc.theme = window.defaultDocTheme();
        E.doc.theme.color[nm] = clone(window.THEMES[nm].color);
        E.doc.theme.button = clone(window.THEMES[nm].button);
        // #125: also restore the shared (mode-independent) groups now editable here.
        E.doc.theme.font = clone(window.THEMES[nm].font);
        E.doc.theme.space = clone(window.THEMES[nm].space);
        E.doc.theme.radius = clone(window.THEMES[nm].radius);
        E.doc.theme.size = clone(window.THEMES[nm].size);
        window.normalizeDocTheme(E.doc.theme);
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

    // The previewed mode is state this file OWNS, and three other regions read it: the preview
    // renders in it, the tour board themes its thumbnails from it, and the canvas stamps it. They
    // resolve against provide(), so it is provided here rather than mirrored in editor.js.
    kernel.provideLive({ activeMode: activeModeNow });
    kernel.provide({ setActiveMode: setActiveMode });
    kernel.expose({
      getTextStyles: getTextStyles, getBlockStyles: getBlockStyles, renameTextStyle: renameTextStyle,
      activeTheme: activeTheme, activeModeNow: activeModeNow, setActiveMode: setActiveMode,
      setMode: setMode, loadTheme: loadTheme, persistTheme: persistTheme,
      reapplyTheme: reapplyTheme, syncWorkingFromDoc: syncWorkingFromDoc, workingThemesNow: workingThemesNow,
      renderThemeControls: renderThemeControls, clearThemePresetChoice: clearThemePresetChoice, loadThemePresets: loadThemePresets,
      saveThemePreset: saveThemePreset, applyThemePreset: applyThemePreset, renameThemePreset: renameThemePreset,
      deleteThemePreset: deleteThemePreset
    });
  }

  window.VersoTheme = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoTheme;
})();
