// render-context.js -- the per-pass state render.js needs, built in ONE place (arch-P1).
//
// `render(doc, theme)` is pure in the sense that matters: the same document renders the same
// markup in the editor canvas and in the shipped SCORM package. But the state that pass needs
// -- named text styles, chapter nav, gate flags, motion timings -- did not arrive as arguments.
// It arrived through ten mutable `window.__*` globals that editor.js and export.js each assigned
// by hand, independently, in three separate blocks of near-identical code.
//
// CONTRIBUTING states the law: "If a change would make the editor and the export diverge, it's
// wrong." The law was real; its enforcement was two files staying in sync by eye. Add an eleventh
// hook, wire it in editor.js, forget export.js, and the canvas and the shipped course render
// differently -- silently, with a green suite, because no test crossed the seam. There was no
// seam. There were ten untyped globals.
//
// This module is the seam. `buildRenderContext(doc, opts)` derives every doc-driven hook from the
// document, once, for both callers. Divergence is now a diff between two objects (see the
// "arch-P1 render-context divergence" section in tests/run.js), not an invisible omission.
//
// THREE KINDS OF HOOK, and why only one kind is built here:
//
//   1. DOC-DERIVED (the ten in DOC_HOOKS below) -- a pure function of the document. Both callers
//      need exactly these, computed exactly this way. This is what buildRenderContext returns,
//      and the only set the divergence test can meaningfully compare.
//   2. ENVIRONMENT (`libraryAxisContext`, `assetResolver`) -- legitimately different per caller
//      and set on a different clock: the axis context follows variant/version resolution, the
//      asset resolver is bound once at boot (objectURL in the editor, base64 in the export).
//      They travel through the same `applyRenderContext` gate so no caller assigns a render hook
//      by hand, but they are NEVER doc-derived, so buildRenderContext does not invent them.
//   3. RENDER-OWNED (`__repairMojibake`, `__svgColorCount`, `__themeShim`, `__EMBED_THEME_SHIM`)
//      -- render.js PUBLISHES these; they are outputs, not inputs. Nothing upstream sets them,
//      so there is nothing here to build. Listed so the sixteen hooks are all accounted for.
//
// `applyRenderContext` writes the context out to the `window.__*` globals render.js still reads.
// That is deliberate and temporary: it keeps anything outside these three files working while the
// interface beds in. When the globals are dropped, this function is the single place that changes.
//
// Pure and DOM-free: no window, no document, no Date.now. Testable in Node today.
(function () {
  "use strict";

  // The doc-derived hooks, in the order the old hand-written blocks assigned them. Each entry
  // names the context field; the window global is always "__" + the field name.
  var DOC_HOOKS = [
    "navSections",         // chapter-aware nav sections (via chaptersToNavSections)
    "docStyles",           // named text styles: doc.styles
    "blockStyles",         // per-block-type default appearance: doc.theme.blockStyles
    "contentMaxWidth",     // master content-width cap
    "imageRadius",         // master image corner radius (0 is a valid value, not "unset")
    "gatedProgression",    // opt-in linear chapter unlock
    "gateAllInteractions", // course-default per-page interaction gate
    "gateMessage",         // author-overridable gate reminder copy
    "motion",              // { modeMs, chapterMs } fade durations
    "glossaryTerms"        // doc-wide [{term, def}] list, or null
  ];

  // Environment hooks: applied through the same gate, never derived from the document.
  var ENV_HOOKS = ["libraryAxisContext", "assetResolver"];

  // Hooks render.js sets on itself. Here for the record; never built, never applied.
  var RENDER_OWNED_HOOKS = ["repairMojibake", "svgColorCount", "themeShim", "EMBED_THEME_SHIM"];

  function globalFor(field) { return "__" + field; }

  // Resolve a helper the context needs: an explicit opts override wins, else the global the app
  // publishes. Both callers leave it unset, so both get the same function -- which is the point:
  // a field neither caller can supply differently is a field that cannot diverge.
  function helper(opts, key, globalName) {
    if (opts && typeof opts[key] === "function") return opts[key];
    if (typeof window !== "undefined" && typeof window[globalName] === "function") return window[globalName];
    return null;
  }

  // buildRenderContext(doc, opts) -> ctx
  //
  // Returns exactly the ten doc-derived fields, always all ten, in a stable shape -- so two
  // contexts built from the same doc are deep-equal, and a missing field is a visible `undefined`
  // rather than a silently absent global.
  //
  // opts (all optional):
  //   chaptersToNavSections  fn(doc) -> sections   (default: window.chaptersToNavSections)
  //   glossaryTerms          fn(doc) -> terms|null (default: window.__glossaryTermsFn)
  function buildRenderContext(doc, opts) {
    var d = doc || {};
    var navFn = helper(opts, "chaptersToNavSections", "chaptersToNavSections");
    var glossFn = helper(opts, "glossaryTerms", "__glossaryTermsFn");
    return {
      navSections: navFn ? navFn(d) : null,
      docStyles: d.styles || null,
      blockStyles: (d.theme && d.theme.blockStyles) || null,
      contentMaxWidth: d.contentMaxWidth || null,
      // 0 is a real radius (square corners), so this tests for null/undefined, not falsiness.
      imageRadius: (d.imageRadius != null ? d.imageRadius : null),
      gatedProgression: d.gatedProgression || null,
      gateAllInteractions: d.gateAllInteractions || null,
      gateMessage: d.gateMessage || null,
      motion: d.motion || null,
      // An empty list is "no glossary", not "a glossary with nothing in it" -- render only tests
      // truthiness, and an empty array is truthy, so it would ship an empty popover.
      glossaryTerms: emptyToNull(glossFn ? glossFn(d) : null)
    };
  }

  function emptyToNull(v) {
    if (!v) return null;
    if (Array.isArray(v) && v.length === 0) return null;
    return v;
  }

  // applyRenderContext(ctx) -> ctx
  //
  // Writes the context to the `window.__*` globals render.js reads. Only keys PRESENT on ctx are
  // written, so a partial context refreshes one field without blanking the rest -- that is how the
  // editor's mid-edit style refreshes and the environment hooks travel through here rather than
  // assigning a global by hand. Unknown keys are ignored: a typo cannot invent a render hook.
  // A no-op outside a browser, so the builder stays callable in Node.
  function applyRenderContext(ctx) {
    if (!ctx || typeof window === "undefined") return ctx;
    for (var i = 0; i < DOC_HOOKS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(ctx, DOC_HOOKS[i])) window[globalFor(DOC_HOOKS[i])] = ctx[DOC_HOOKS[i]];
    }
    for (var j = 0; j < ENV_HOOKS.length; j++) {
      if (Object.prototype.hasOwnProperty.call(ctx, ENV_HOOKS[j])) window[globalFor(ENV_HOOKS[j])] = ctx[ENV_HOOKS[j]];
    }
    return ctx;
  }

  // Read the live globals back into context shape. The divergence test uses this to prove that
  // building-then-applying lands the same state the hand-written blocks used to leave behind.
  function readRenderContext() {
    var out = {};
    if (typeof window === "undefined") return out;
    DOC_HOOKS.forEach(function (k) { out[k] = window[globalFor(k)]; });
    return out;
  }

  // Order-independent structural comparison, so a divergence report is a list of field names
  // rather than a wall of JSON. Returns [] when the two contexts agree.
  function diffRenderContexts(a, b) {
    var out = [];
    var keys = {};
    Object.keys(a || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(b || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) {
      if (!deepEqual((a || {})[k], (b || {})[k])) out.push(k);
    });
    return out;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    if (typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
      if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }

  var RenderContext = {
    DOC_HOOKS: DOC_HOOKS,
    ENV_HOOKS: ENV_HOOKS,
    RENDER_OWNED_HOOKS: RENDER_OWNED_HOOKS,
    build: buildRenderContext,
    apply: applyRenderContext,
    read: readRenderContext,
    diff: diffRenderContexts,
    globalFor: globalFor
  };

  if (typeof window !== "undefined") {
    window.RenderContext = RenderContext;
    window.buildRenderContext = buildRenderContext;
    window.applyRenderContext = applyRenderContext;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = RenderContext;
})();
