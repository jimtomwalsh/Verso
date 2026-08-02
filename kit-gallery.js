/*
 * kit-gallery.js -- renders the UI kit gallery (kit.html) from the REAL editor
 * primitives exposed on window.__kit. Classic script,
 * no build, no exports -- matches the app's constraints. Every demo is wrapped so
 * one broken primitive can't blank the whole gallery (and names the culprit).
 */
(function () {
  "use strict";
  var K = window.__kit;
  var host = (K && K.inspector) || document.getElementById("inspector");
  if (!K || !host) {
    if (host) host.innerHTML = '<div class="kit-error">window.__kit not available — editor.js did not load.</div>';
    return;
  }

  function group(name, build) {
    var g = K.h("div", "kit-group");
    g.appendChild(K.h("div", "kit-group__name", name));
    host.appendChild(g);
    try {
      build(g);
    } catch (e) {
      var err = K.h("div", "kit-error", name + ": " + (e && e.message ? e.message : e));
      g.appendChild(err);
      if (window.console) console.error("[kit] " + name, e);
    }
  }
  function note(parent, t) { parent.appendChild(K.h("div", "kit-group__note", t)); }
  function put(parent, n) { if (n instanceof Node) parent.appendChild(n); }
  // A few canonical primitives (fieldRow / selectRow / customSelectRow) append to
  // the module-level #inspector and take no target arg. Run them inside `grouped`
  // so their fresh nodes are re-homed into the group box — grouped-and-labelled
  // like every other primitive, not leaked to the panel root.
  function grouped(g, fn) {
    var n = host.childNodes.length;
    fn();
    while (host.childNodes.length > n) g.appendChild(host.childNodes[n]);
  }

  // ---- breadcrumb (two-level navigation, ticket 5) -------------------------
  group("breadcrumb — selection-depth navigator (ticket 5)", function (g) {
    var log = K.h("div", "kit-group__note", "clicked: (none)");
    K.breadcrumb(g, [
      { label: "Image hotspots", level: "block" },
      { label: "Contents", level: "content" },
      { label: "Marker 3", level: "marker" }
    ], function (level) { log.textContent = "clicked: " + level; });
    g.appendChild(log);
    note(g, "Names the current depth (block ▸ content ▸ child) and clicks back out — the anchor that stops Content level being a trap. Last crumb = current.");
  });

  // ---- section header ------------------------------------------------------
  group("panelSection — section header", function (g) {
    K.panelSection(g, "Appearance");
    note(g, "panelSection(host, title) — the one grouping header used inside a panel. It appends the section and hands back its body, so the rows that follow go inside it. The old flat sub() header is retired.");
  });

  group("propHeader — section header with add", function (g) {
    put(g, K.propHeader("Fill", function () {}, "Add fill"));
    note(g, "A header with a right-aligned + that reveals/adds the section (Fill / Stroke).");
  });

  group("optionalRow — collapsed-optional set (ticket 2)", function (g) {
    // Off state: one greyed row + "+". Click "+" to enable + expand inline.
    var fillOn = false;
    K.optionalRow(g, "Fill", { addTitle: "Add fill",
      get: function () { return fillOn; }, set: function (v) { fillOn = v; },
      build: function (b) { K.colourControl("Colour", "#0d99ff", function () {}, b); } });
    // On state: header (title + "-") over the body; the "-" reverts to the placeholder.
    var strokeOn = true;
    K.optionalRow(g, "Stroke", { addTitle: "Add stroke",
      get: function () { return strokeOn; }, set: function (v) { strokeOn = v; },
      build: function (b) {
        K.colourControl("Colour", "#a259ff", function () {}, b);
        put(b, K.iconField(K.Icon("border-weight"), { value: 1, unit: "px", step: 1, min: 0, max: 20, title: "Width", onchange: function () {} }).wrap);
      } });
    note(g, "Off = one greyed row + +. Click + to enable + expand inline; the - removes and reverts. Canonical for fill / stroke / any optional group.");
  });

  group("repeatedList — one row per item (ticket 3)", function (g) {
    // scratch model exposed so the browser function-test can assert model writes.
    var steps = [{ text: "Detect" }, { text: "Classify" }, { text: "Respond" }];
    window.__kitDemoSteps = steps;
    K.repeatedList(g, "Steps", {
      items: function () { return steps; },
      value: function (it) { return it.text; },
      setValue: function (it, v) { it.text = v; },
      add: function () { steps.push({ text: "" }); },
      remove: function (i) { steps.splice(i, 1); },
      move: function (from, to) { var m = steps.splice(from, 1)[0]; steps.splice(to, 0, m); },
      placeholder: "Describe this step", addLabel: "Add step", removeTitle: "Delete step"
    });
    note(g, "Grip drag-reorders · full-width field · trash. + above adds. No per-row label — the header names the set once.");
  });

  group("renderContainerChrome — invariant Block-level chrome (ticket 4)", function (g) {
    var noop = { moveUp: function () {}, moveDown: function () {}, duplicate: function () {}, remove: function () {} };
    // A frame: every container row applies.
    var frame = { align: "start", width: 600, padX: 24, gap: 12, hasFill: true, fillColor: "#0d99ff", hasStroke: false, radius: 8, spaceTop: 0, spaceBottom: 24 };
    window.__kitDemoFrame = frame;
    var frameBody = K.panelSection(g, "Frame — every container row");
    K.renderContainerChrome(frameBody, { align: true, width: true, padding: true, gap: true },
      { get: function (k) { return frame[k]; }, set: function (k, v) { frame[k] = v; } }, noop);
    // A spacer: only spacing + actions apply — the rest are hidden, order unchanged.
    var spacer = { spaceTop: 0, spaceBottom: 40 };
    window.__kitDemoSpacer = spacer;
    var spacerBody = K.panelSection(g, "Spacer — only spacing + actions (rest hidden, order kept)");
    K.renderContainerChrome(spacerBody, { fill: false, stroke: false, radius: false },
      { get: function (k) { return spacer[k]; }, set: function (k, v) { spacer[k] = v; } }, noop);
    note(g, "ONE renderer; each block DECLARES which rows apply. Fixed order; omitted rows hidden — a block can't lay it out differently. Fill/stroke are collapsed-optional; dims are iconField; actions reuse iconBtn.");
  });

  // ---- booleans / visibility / modes --------------------------------------
  group("switchRow — boolean", function (g) {
    var on = true;
    K.switchRow("Border", function () { return on; }, function (v) { on = v; }, g);
    note(g, "The canonical on/off. Word-button toggles are retired.");
  });

  group("eyeRow — visibility", function (g) {
    var vis = true;
    K.eyeRow("Disclaimer", function () { return vis; }, function (v) { vis = v; }, g);
    note(g, "Open / slashed eye. visible=true means shown.");
  });

  group("segmentedIconLive — mode via icons", function (g) {
    var al = "start";
    K.segmentedIconLive("Align", [
      [K.Icon("align-left"), "start", "Left"],
      [K.Icon("align-center"), "center", "Centre"],
      [K.Icon("align-right"), "end", "Right"]
    ], function (v) { return v === al; }, function (v) { al = v; }, g);
    note(g, "2-3 mutually-exclusive options where an icon is clearer than a word.");
  });

  group("segmentedLive — word modes", function (g) {
    var fit = "auto";
    K.segmentedLive("Fit", [["Auto", "auto"], ["Original", "original"]],
      function (v) { return v === fit; }, function (v) { fit = v; }, g);
    note(g, "Only for word-labelled modes with no clear icon. Not for booleans.");
  });

  // ---- inputs --------------------------------------------------------------
  group("iconField — numeric / dimensional", function (g) {
    put(g, K.iconField(K.Icon("radius"), { value: 8, unit: "px", step: 1, min: 0, max: 100,
      title: "Corner radius", onchange: function () {} }).wrap);
    note(g, "Leading glyph inside the field + faint unit. The glyph is the drag-scrub handle.");
  });

  group("twoUp — paired numerics", function (g) {
    put(g, K.twoUp(
      K.iconField(K.Icon("arrow-up-to-line"), { value: 0, unit: "px", step: 1, title: "Space above", onchange: function () {} }).wrap,
      K.iconField(K.Icon("arrow-down-to-line"), { value: 24, unit: "px", step: 1, title: "Space below", onchange: function () {} }).wrap
    ));
    note(g, "Two naturally-paired fields side by side (paired X/Y, W/H, top/bottom).");
  });

  group("fieldRow — named text", function (g) {
    grouped(g, function () { K.fieldRow("Alt text", "", function () {}, "describe the image"); });
    note(g, "Named content (Title / URL / Alt / class) stays a labelled row — an icon can't represent it.");
  });

  group("selectRow — plain word options", function (g) {
    grouped(g, function () { K.selectRow("Open sections", [["One at a time", "single"], ["Multiple", "multi"]], "single", function () {}); });
    note(g, "Use only when the option label carries no useful visual.");
  });

  group("customSelectRow — preview options", function (g) {
    grouped(g, function () {
      K.customSelectRow("Bullet style", [
        ["disc", "Disc", { html: '<span style="opacity:.9">&#8226;&nbsp;&nbsp;Disc</span>' }],
        ["dash", "Dash", { html: '<span style="opacity:.9">&#8211;&nbsp;&nbsp;Dash</span>' }],
        ["check", "Check", { html: '<span style="opacity:.9">&#10003;&nbsp;&nbsp;Check</span>' }]
      ], "disc", function () {});
    });
    note(g, "Custom listbox where each option shows a live preview (font, style, marker).");
  });

  group("colourControl — swatch + hex", function (g) {
    K.colourControl("Marker colour", "#0d99ff", function () {}, g);
    note(g, "Native swatch + hex, applied live. Clear to revert to default.");
  });

  group("colorField — token / custom / per-mode", function (g) {
    K.colorField("Card fill", { token: "accent" }, function () {}, g);
    note(g, "The unified mode-aware colour picker (theme token, custom hex, or per-mode). Preserved as-is by the redesign.");
  });

  // ---- disclosures ---------------------------------------------------------
  group("disclosure — top-level twirl", function (g) {
    put(g, K.disclosure("kitDemoDisc", "Spacing", function (body) {
      body.appendChild(K.h("div", "insp-hint", "Body revealed on open; open-state persists per block-type."));
    }));
    note(g, "In kit mode the twirl is static (open-state persists but the panel isn't rebuilt).");
  });

  group("subDisclosure — level-2 nest", function (g) {
    var enabled = true;
    put(g, K.subDisclosure("kitDemoSubDisc", "Fill", function (body) {
      K.colourControl("Colour", "#a259ff", function () {}, body);
    }, { toggle: { get: function () { return enabled; }, set: function (v) { enabled = v; } } }));
    note(g, "A nest with an enable-switch in its header. Two levels of nesting, max.");
  });

  // ---- icon set ------------------------------------------------------------
  group("Icons — Lucide, bundled offline (via the Icon accessor)", function (g) {
    var grid = K.h("div", "kit-glyphs");
    var custom = K.Icon.CUSTOM || {};
    K.Icon.names().forEach(function (name) {
      var cell = K.h("div", "kit-glyph");
      var mark = K.h("span", "kit-glyph__mark");
      mark.innerHTML = K.Icon(name);
      cell.appendChild(mark);
      var label = name + (Object.prototype.hasOwnProperty.call(custom, name) ? " *" : "");
      cell.appendChild(K.h("div", "kit-glyph__name", label));
      grid.appendChild(cell);
    });
    g.appendChild(grid);
    note(g, "Every chrome icon resolves through Icon(name) (src/icons.js) keyed by Lucide kebab-case name — no inline one-off SVG. Names marked * are Verso-custom field marks (padding / radius / border-weight / blur / axis spacing / tracking) with no clean Lucide equivalent.");
  });
})();
