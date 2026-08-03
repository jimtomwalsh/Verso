/*
 * Verso theme(s). Components reference NAMED tokens only; applyTheme()
 * flattens a theme onto a course root as CSS custom properties.
 *
 * M5: there are now two token sets — `dark` (the real Captivate course look) and
 * `light` — exposed as window.THEMES. This is the groundwork for the light/dark
 * export toggle (auto-detect via prefers-color-scheme + optional manual switch):
 * because every component reads tokens, a second theme is pure data, no component
 * changes. The light set is hand-tuned for contrast, NOT a naive inversion.
 *
 * Non-colour tokens (font/space/radius/size) are shared between modes via BASE.
 * window.THEME stays pointed at the dark set for back-compat (window.render).
 *
 * Classic script — exposes window.THEMES, window.THEME, window.applyTheme.
 */
(function () {
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  var BASE = {
    font: {
      heading: "'Exo 2', 'Segoe UI', system-ui, sans-serif",
      body: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    },
    space: { xs: "6px", sm: "12px", md: "20px", lg: "32px", xl: "56px" },
    radius: { card: "12px" },
    size: { pageTitle: "34px", cardNum: "14px", cardTitle: "22px", cardBody: "15px" },
    // KK: theme-level component-style layer. The single source for the CTA/nav
    // button LOOK. Emitted by applyTheme (editor) and tokenBody (export) as
    // --button-* CSS vars that course.css consumes as DEFAULTS; a per-block
    // override (applyButtonStyle inline style) still wins. Colour values are
    // theme-token refs, so they track dark/light automatically -> the bundle can
    // be mode-shared while its colours stay per-mode. REFERENCE not copy: editing
    // the theme repaints every non-overridden button live (no re-apply per block).
    button: {
      bg: "var(--color-accent)",
      fg: "#14150f",
      radius: "8px",
      padY: "12px",
      padX: "22px",
      fontSize: "15px",
      fontWeight: "600",
      // Stroke (border). Default 0-width transparent = no visible border (matches
      // the prior `border: none`); set a width + colour for an outlined button.
      // Emitted as --button-border-width / --button-border-color; course.css
      // consumes them (with 0 / transparent fallbacks for older persisted themes).
      borderWidth: "0",
      borderColor: "transparent",
      // Hover-state colours (the interaction feedback). Empty = track the base
      // fill/text (course.css falls back through --button-bg/-fg), so a plain
      // button just brightens on hover as before; set a value for a distinct
      // hover colour. Emitted as --button-hover-bg / --button-hover-fg.
      hoverBg: "",
      hoverFg: ""
    }
  };

  function theme(colors) {
    return { color: colors, font: BASE.font, space: BASE.space, radius: BASE.radius, size: BASE.size, button: BASE.button };
  }

  window.THEMES = {
    dark: theme({
      bg: "#1b1c1e",
      surface: "#2a2c2f",
      surfaceAlt: "#34373b",
      ink: "#f4f6f7",
      inkSoft: "#b9bec3",
      muted: "#818181",
      hair: "#3c4045",
      rule: "#2f6fd0",
      accent: "#f5a623",
      success: "#6bbe46",
      danger: "#e5654b"
    }),
    light: theme({
      bg: "#f4f5f6",
      surface: "#ffffff",
      surfaceAlt: "#eceef0",
      ink: "#1b1c1e",
      inkSoft: "#4a5054",
      muted: "#8a9096",
      hair: "#dfe2e5",
      rule: "#2f6fd0",
      accent: "#e08600",   // slightly deeper amber for contrast on light
      success: "#4e9e2f",  // slightly deeper green for contrast on light
      danger: "#cf4a32"
    })
  };

  window.THEME = window.THEMES.dark;

  // Saved named text styles (backlog A pass 2). A preset is exactly the shape of
  // a block's `style` object (consumed by render.js applyTextStyle, and already
  // read by the export pipeline) — so "apply preset" = copy these props onto
  // block.style, no new plumbing. `font` values are FONT_LIST names; colour is
  // deliberately omitted so presets stay theme-safe (dark/light both fine).
  window.TEXT_STYLES = {
    "Heading 1": { font: "Exo 2", size: 34, weight: "700", lineHeight: "1.2", letterSpacing: 0.2 },
    "Heading 2": { font: "Exo 2", size: 26, weight: "700", lineHeight: "1.25" },
    "Body 1": { font: "System", size: 17, weight: "400", lineHeight: "1.6" },
    "Body 2": { font: "System", size: 15, weight: "400", lineHeight: "1.55" },
    "Callout": { font: "Exo 2", size: 14, weight: "600", lineHeight: "1.45", letterSpacing: 0.4 }
  };

  // #145: text-role map — the named style each text block TYPE links to by default.
  // A course-from-CSV import (schema.js) drops blocks by type with no style; this map
  // lets the editor auto-link each type to its role style (styleRef is a LIVE ref, so
  // editing the named style later repaints every linked block). Values are keys of the
  // doc's named-style store (doc.styles); a value with no matching style is skipped
  // (the block stays unstyled and the audit indicator flags it). Author-editable per
  // course (doc.textRoles); `note` defaults to Callout (no built-in "Warnings" style).
  window.TEXT_ROLES = {
    heading: "Heading 1",
    subheading: "Heading 2",
    paragraph: "Body 1",
    note: "Callout",
    quote: "Body 2",
    list: "Body 1"
  };

  function kebab(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }

  window.applyTheme = function (el, t) {
    t = t || window.THEME;
    Object.keys(t).forEach(function (group) {
      var vals = t[group];
      if (vals && typeof vals === "object") {
        Object.keys(vals).forEach(function (key) {
          el.style.setProperty("--" + group + "-" + kebab(key), vals[key]);
        });
      }
    });
  };

  // ---- doc.theme (#124: per-course theme home) -----------------------------
  // The theme now lives ON the doc as ONE versioned object (was editor-global
  // localStorage). Shape:
  //   { schemaVersion, color:{ dark:{…}, light:{…} }, font, space, radius,
  //     size, button, textStyles, blockStyles }
  // color is per-mode; font/space/radius/size/button are shared across modes
  // (= today's BASE). textStyles/blockStyles are seeded here; slices 2-4 (#125-127)
  // fill them. render(doc, theme) still takes the FLAT per-mode shape as its arg —
  // docThemeToModes projects doc.theme onto that shape so render/applyTheme/export
  // are unchanged. editor == export because both bake the same doc.theme.
  window.THEME_SCHEMA_VERSION = 1;
  function tclone(o) { return JSON.parse(JSON.stringify(o)); }

  // Idempotent validate + backfill. Never throws; fills any missing group from the
  // baseline so an old/hand-built/partial doc.theme always resolves.
  window.normalizeDocTheme = function (dt) {
    if (!dt || typeof dt !== "object") dt = {};
    if (!dt.color || typeof dt.color !== "object") dt.color = {};
    // A pre-schema FLAT theme colour map (has .bg, no per-mode split) — promote it
    // to both modes so nothing crashes.
    if (dt.color.bg && !dt.color.dark && !dt.color.light) {
      var flatColor = dt.color; dt.color = { dark: flatColor, light: tclone(flatColor) };
    }
    if (!dt.color.dark) dt.color.dark = tclone(window.THEMES.dark.color);
    if (!dt.color.light) dt.color.light = tclone(window.THEMES.light.color);
    ["dark", "light"].forEach(function (m) {
      var base = window.THEMES[m].color;
      Object.keys(base).forEach(function (k) { if (dt.color[m][k] == null) dt.color[m][k] = base[k]; });
    });
    if (!dt.font) dt.font = tclone(BASE.font);
    if (!dt.space) dt.space = tclone(BASE.space);
    if (!dt.radius) dt.radius = tclone(BASE.radius);
    if (!dt.size) dt.size = tclone(BASE.size);
    if (!dt.button) dt.button = tclone(BASE.button);
    else Object.keys(BASE.button).forEach(function (k) { if (dt.button[k] == null) dt.button[k] = BASE.button[k]; });
    if (!dt.textStyles) dt.textStyles = tclone(window.TEXT_STYLES);
    if (!dt.blockStyles || typeof dt.blockStyles !== "object") dt.blockStyles = {};
    dt.schemaVersion = window.THEME_SCHEMA_VERSION;
    return dt;
  };

  // Project doc.theme -> { dark, light } FLAT themes (the shape applyTheme / render /
  // export.tokenBody consume). The shared groups (font/space/radius/size/button) are
  // shared BY REFERENCE across both modes AND with doc.theme, so an editor edit to a
  // shared group updates both modes and the doc at once; only `color` differs per mode.
  window.docThemeToModes = function (dt) {
    dt = window.normalizeDocTheme(dt);
    function flat(color) {
      return { color: color, font: dt.font, space: dt.space, radius: dt.radius, size: dt.size, button: dt.button };
    }
    return { dark: flat(dt.color.dark), light: flat(dt.color.light) };
  };

  // Assemble a doc.theme from a { dark, light } FLAT pair — the one-time migration
  // from the old editor-global working themes. Shared groups come from the dark set
  // (identical to light in the legacy data).
  window.makeDocTheme = function (modes) {
    var d = (modes && modes.dark) || window.THEMES.dark;
    var l = (modes && modes.light) || window.THEMES.light;
    return window.normalizeDocTheme({
      schemaVersion: window.THEME_SCHEMA_VERSION,
      color: { dark: tclone(d.color), light: tclone(l.color) },
      font: tclone(d.font || BASE.font),
      space: tclone(d.space || BASE.space),
      radius: tclone(d.radius || BASE.radius),
      size: tclone(d.size || BASE.size),
      button: tclone(d.button || BASE.button),
      textStyles: tclone(window.TEXT_STYLES),
      blockStyles: {}
    });
  };

  // A fresh doc.theme seeded from the built-in THEMES (brand-new docs, no prior theme).
  window.defaultDocTheme = function () { return window.makeDocTheme(window.THEMES); };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
