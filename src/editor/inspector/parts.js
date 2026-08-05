// editor/inspector/parts.js -- the panels for the two things that are not blocks
// (arch-P3b-07parts).
//
// Nearly everything an author selects on the canvas is a block, and inspector/blocks.js has the
// table for those. Two things are not, and they get their panels here.
//
// A FIELD is a text slot INSIDE a block -- a quiz option, a card's front, an accordion item's
// title. It has no block of its own, so it borrows its parent's identity and offers only what a
// slot can carry: the text style, the inline formatting, and the conversion between a paragraph
// and a list. `caretInList` sits with it because Tab-nesting and paste-cleaning apply wherever the
// caret is inside an `<li>`, whatever field it happens to be in.
//
// An INSTANCE is one card of a component grid. It IS a model object, but not a block: it lives in
// its parent's `instances` array, so every edit re-renders through the parent and then has to find
// its own card again -- which is what `reselectByIndex` is for, and why `reflectStatus` swaps the
// status class in place rather than re-mounting. Losing the selection on every keystroke is the
// failure mode those two exist to prevent.
//
// What they share, and the reason they are one file: both are panels for a thing the document
// model does not give an id to, so both are addressed by their PARENT plus an index, and both
// have to re-find themselves after the parent redraws.
//
// Editor chrome only. Both write into the document and hand the redraw to the same
// reapplyStructural / mount path every other panel uses.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pushHistory", "renderModelView", "mount", "reselectByIndex", "panelSection",
      "renderInspector", "getTextStyles", "customSelectRow", "sanitizeFieldHtml", "TEXT_CONTENT_TYPES", "reselectBlockNode",
      "writeModel", "renderSourceLinkProvenance", "beginSections", "sectionGroup", "stripInlineColor", "typeCluster",
      "scheduleSave", "buildFormatToggleBar", "convertTextListBlockType", "reapplyStructural", "findPageOfBlock", "fieldRow",
      "colorFieldFlat", "iconField", "endSections", "versionEditable", "renderContainerChrome", "CONTENT_DECL",
      "blockChromeIo", "blockChromeHandlers", "blurActiveText", "resetDrill", "buildActions", "iconBtn",
      "propHeader", "setSelection", "renderBlockActionsSection", "clone", "clearSelection", "setInspector",
      "measureTextBaseline",
      "inspector", "selection", "panelFields"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        pushHistory = E.pushHistory,
        renderModelView = E.renderModelView,
        mount = E.mount,
        reselectByIndex = E.reselectByIndex,
        panelSection = E.panelSection,
        renderInspector = E.renderInspector,
        getTextStyles = E.getTextStyles,
        customSelectRow = E.customSelectRow,
        sanitizeFieldHtml = E.sanitizeFieldHtml,
        TEXT_CONTENT_TYPES = E.TEXT_CONTENT_TYPES,
        reselectBlockNode = E.reselectBlockNode,
        writeModel = E.writeModel,
        renderSourceLinkProvenance = E.renderSourceLinkProvenance,
        beginSections = E.beginSections,
        sectionGroup = E.sectionGroup,
        stripInlineColor = E.stripInlineColor,
        typeCluster = E.typeCluster,
        scheduleSave = E.scheduleSave,
        buildFormatToggleBar = E.buildFormatToggleBar,
        convertTextListBlockType = E.convertTextListBlockType,
        reapplyStructural = E.reapplyStructural,
        findPageOfBlock = E.findPageOfBlock,
        fieldRow = E.fieldRow,
        colorFieldFlat = E.colorFieldFlat,
        iconField = E.iconField,
        endSections = E.endSections,
        versionEditable = E.versionEditable,
        renderContainerChrome = E.renderContainerChrome,
        CONTENT_DECL = E.CONTENT_DECL,
        blockChromeIo = E.blockChromeIo,
        blockChromeHandlers = E.blockChromeHandlers,
        blurActiveText = E.blurActiveText,
        resetDrill = E.resetDrill,
        buildActions = E.buildActions,
        iconBtn = E.iconBtn,
        propHeader = E.propHeader,
        setSelection = E.setSelection,
        renderBlockActionsSection = E.renderBlockActionsSection,
        clone = E.clone,
        clearSelection = E.clearSelection,
        measureTextBaseline = E.measureTextBaseline,
        setInspector = E.setInspector;

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
        var plainBody = panelSection(E.inspector, field);
        var input = h("textarea", "prop-input");
        input.value = obj[field];
        input.addEventListener("input", function () { writeModel(node, input.value); if (node.textContent !== input.value) node.textContent = input.value; });
        plainBody.appendChild(input);
        return;
      }
      // rich field -> Text properties (in the panel, no floating window)
      var s = host.style || (host.style = {});
      function apply() { window.applyTextStyle(node, s); renderModelView(); }

      var head = h("div", "prop-component"); head.appendChild(h("span", null, "Text")); E.inspector.appendChild(head);
      // uio-F04 (EDIT-06): editing the text of a source-linked block is exactly when its provenance
      // matters, so the same line the block inspector carries appears here too. Same call, so the two
      // panels can never say different things about the same block.
      var fieldProv = renderSourceLinkProvenance(obj);
      if (fieldProv) E.inspector.appendChild(fieldProv);

      // Panel System v2 (D3): the flagship reference panel adopts the sectionGroup taxonomy —
      // a "Type" section (style picker + typeCluster + inline B/I/U/link) and a "Content"
      // section (list controls), so the Edit-layout drag mode + global ranking work here live.
      beginSections();
      sectionGroup("Type", "Type", function (secBody) {
      var _ins = E.inspector; E.setInspector(secBody);
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
      // uio-E-C03: the cluster resolves through F03's ladder — the measured theme baseline, the
      // named style this field references, then the field's own overrides — so every control
      // shows what the text is actually set to rather than "Default" / "auto" / nothing.
      typeCluster(E.inspector, s, apply, {
        scope: {
          theme: measureTextBaseline(node),
          styleName: host.styleRef || "",
          styleProps: (host.styleRef && presets[host.styleRef]) || null,
          block: s
        },
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
      E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Style"));
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
      E.inspector.appendChild(biu);

      // List marker settings — the on/off toggle now lives in the inline-format bar above.
      // Purely the marker styling, shown only when the field IS a list block (#31: the quiz
      // Chapter-summary <ul> is its own root-<ul> field; the list block itself is rootIsList).
      // One <ul> renders disc / numbered / lettered alike (list-style-type is tag-agnostic),
      // so the marker (incl. Numbered / Lettered / Roman) lives entirely in the Bullet-style
      // dropdown; marker size stays a numeric iconField (exception).
      if (rootIsList) {
        var _typeBody = E.inspector; E.setInspector(panelSection(_typeBody, "List"));
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
        E.inspector.appendChild(iconField("H", { value: obj.listMarkerSize == null ? "" : obj.listMarkerSize, unit: "em", placeholder: "1", step: 0.1, min: 0.5, max: 4, datalist: "dl-gap", title: "Marker size (relative to text)",
          onchange: function (val) { pushHistory(); var n = parseFloat(val); if (isNaN(n)) { delete obj.listMarkerSize; node.style.removeProperty("--li-marker-size"); } else { obj.listMarkerSize = n; node.style.setProperty("--li-marker-size", n + "em"); } renderModelView(); } }).wrap);
        E.setInspector(_typeBody);
      }
      } finally { E.setInspector(_ins); }
      });
      endSections(E.inspector);

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
        renderContainerChrome(E.inspector, CONTENT_DECL, blockChromeIo(blk), blockChromeHandlers(blk));
      } else {
        // Quiz sub-fields (a rich field on a non-text block) still bridge to their block's own
        // settings; and while editing a non-base software version the block chrome would be
        // present-but-inert (per applyVersionEditGuard), so the focused text panel + link stay.
        var backHint = h("button", "insp-hint insp-backlink", "Layout, spacing & appearance → block settings");
        backHint.type = "button";
        backHint.title = "These act on the whole block, not the text. Click to select the block (or press Esc).";
        backHint.addEventListener("mousedown", function (e) { e.preventDefault(); });
        backHint.addEventListener("click", function () { blurActiveText(); resetDrill(); reselectBlockNode(E.selection.block, "block"); });
        E.inspector.appendChild(backHint);
      }
    }

    // a component instance selected -> sectioned, properties
    function renderInstanceInspector(card) {
      var instance = card.__instance, block = card.__block, index = card.__index, def = card.__def;

      var head = h("div", "prop-component prop-component--instance");
      head.appendChild(h("span", null, def.name));
      E.inspector.appendChild(head);

      // Content
      var _instRoot = E.inspector;
      E.setInspector(panelSection(_instRoot, "Content"));
      def.slots.forEach(function (slot) {
        var control;
        if (slot.multiline) {
          E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", slot.label));
          control = h("textarea", "prop-input");
        } else {
          var row = h("div", "insp-row");
          row.appendChild(h("span", "insp-row__label", slot.label));
          control = h("input", "prop-text"); control.type = "text";
          row.appendChild(control);
          E.inspector.appendChild(row);
        }
        control.spellcheck = false;
        control.value = instance.slots[slot.key] == null ? "" : instance.slots[slot.key];
        if (slot.multiline) E.inspector.appendChild(control);
        control.addEventListener("input", function () {
          instance.slots[slot.key] = control.value;
          var target = card.querySelector('[data-edit="' + slot.key + '"]');
          if (target && target.textContent !== control.value) target.textContent = control.value;
          renderModelView();
        });
        E.panelFields[slot.key] = control;
      });

      // Variant (style-swap)
      if (def.variants && def.variants.status) {
        E.setInspector(panelSection(_instRoot, "Variant"));
        var row = h("div", "prop-toggle-row");
        def.variants.status.options.forEach(function (opt) {
          var on = (instance.status || def.variants.status.default) === opt;
          var b = h("button", "prop-toggle" + (on ? " is-on" : ""), opt);
          b.addEventListener("click", function () { pushHistory(); instance.status = opt; renderModelView(); reflectStatus(card); renderInspector(); });
          row.appendChild(b);
        });
        E.inspector.appendChild(row);
      }

      // Actions (flagship): where this card navigates on click
      E.setInspector(_instRoot);
      buildActions(instance, card, function () { reselectByIndex(block, index); });

      // Component (instance-specific): detach from the component definition. Hide /
      // move / duplicate / delete now live in the shared footer below, so this row
      // holds only the action the footer can't express.
      E.setInspector(panelSection(_instRoot, "Component"));
      var compRow = h("div", "icon-row");
      var detach = iconBtn("unlink", instance.detached ? "Detached" : "Detach from component");
      if (instance.detached) detach.classList.add("is-on");
      detach.addEventListener("click", function () { pushHistory(); instance.detached = true; mount(); reselectByIndex(block, index); });
      compRow.appendChild(detach);
      E.inspector.appendChild(compRow);
      E.setInspector(_instRoot);

      // Grid — the cards row carries the "+" add affordance (same handler as before).
      E.setInspector(panelSection(_instRoot, "Grid"));
      E.inspector.appendChild(propHeader("Cards", function () {
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
      E.inspector.appendChild(selGrid);
      E.setInspector(_instRoot);

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

    kernel.expose({
      caretInList: caretInList, renderFieldInspector: renderFieldInspector, renderInstanceInspector: renderInstanceInspector,
      reflectStatus: reflectStatus
    });
  }

  window.VersoInspectorParts = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoInspectorParts;
})();
