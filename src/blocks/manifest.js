/*
 * src/blocks/manifest.js -- what each block type declares, and nothing else (arch-P4-04).
 *
 * A Verso block has up to four concerns: it RENDERS to DOM, it may carry COURSE CSS, it may bind
 * LEARNER RUNTIME behaviour, and it has an INSPECTOR panel in the editor. `CONTRIBUTING.md` and
 * `design-system/readme.md` have said so in prose for a long time. Prose does not fail a build.
 *
 * This file is that contract as data. Each row states what its block type declares, and
 * `tests/run.js` checks every claim against the four real registries in BOTH directions:
 *
 *   render      -> the `BLOCKS` table in src/render.js
 *   css         -> the selector literally appearing in src/course.css
 *   runtime     -> the `RUNTIME` table in src/runtime.js            (arch-P4-01)
 *   inspector   -> the `INSPECTORS` table in src/editor/inspector/blocks.js  (arch-P4-02)
 *
 * WHY BOTH DIRECTIONS. A one-way check catches a block you forgot to finish. It does not catch the
 * opposite and more common rot: a concern left behind after a block changed shape -- CSS for a
 * class nothing renders any more, a binder for a type that was deleted. Both fail here, and the
 * failure names the type and the concern.
 *
 * NOT EVERY BLOCK HAS ALL FOUR, AND SAYING SO IS THE POINT. A heading renders and is finished: no
 * runtime, and its inspector is the label-only default. Seven of twenty-seven types have runtime
 * behaviour. Nine have no inspector row because appearance-only is the correct panel for them.
 * Declaring empty pieces to make every row look full would turn this file into decoration and the
 * test into a tautology. `false` and `null` here are assertions, not omissions -- the test checks
 * them as hard as it checks the trues.
 *
 * ADDING A BLOCK: add its row here first. The suite will then tell you, by name, which of the four
 * pieces you have not written yet. That is the whole reason this file exists.
 *
 * DEV-TIME ONLY. index.html does not load this file and the running app does not read it -- it is
 * the contract the suite checks, not data the editor depends on. It is still a classic script that
 * publishes window.BlockManifest, so a future surface (a palette derived from the register rather
 * than hand-listed, say) can load it without changing its shape.
 */
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // css:       the class the renderer emits that course.css styles, or null when the type owns
  //            none (it delegates its rendering to other blocks).
  // runtime:   the RUNTIME key, or false when the type has no learner behaviour.
  // inspector: true when the type has an INSPECTORS row; false when the label-only default panel
  //            is the correct one.
  var BLOCK_MANIFEST = {
    // ---- Text: render + css, nothing else. Four of the six take the default panel.
    heading:         { css: "page-title",     runtime: false,        inspector: true,  group: "Text" },
    subheading:      { css: "page-subtitle",  runtime: false,        inspector: false, group: "Text" },
    paragraph:       { css: "body-copy",      runtime: false,        inspector: true,  group: "Text" },
    quote:           { css: "body-quote",     runtime: false,        inspector: false, group: "Text" },
    list:            { css: "body-list",      runtime: false,        inspector: false, group: "Text" },
    note:            { css: "body-note",      runtime: false,        inspector: true,  group: "Text" },

    // ---- Media
    image:           { css: "block-image",    runtime: "image",      inspector: true,  group: "Media" },   // runtime = the click-to-zoom lightbox
    htmlEmbed:       { css: "embed--html",    runtime: false,        inspector: false, group: "Media" },   // panel comes from the dispatcher's renderEmbedPanel, not the block table
    webEmbed:        { css: "embed--web",     runtime: false,        inspector: false, group: "Media" },
    hotspot:         { css: "block-hotspot",  runtime: "hotspot",    inspector: true,  group: "Media" },

    // ---- Layout
    frame:           { css: "block-frame",    runtime: false,        inspector: true,  group: "Layout" },
    group:           { css: "block-group",    runtime: false,        inspector: true,  group: "Layout" },
    columns:         { css: "layout-columns", runtime: false,        inspector: true,  group: "Layout" },
    table:           { css: "table-block",    runtime: false,        inspector: true,  group: "Layout" },
    divider:         { css: "block-divider",  runtime: false,        inspector: true,  group: "Layout" },
    spacer:          { css: "block-spacer",   runtime: false,        inspector: true,  group: "Layout" },
    accordion:       { css: "acc",            runtime: "accordion",  inspector: true,  group: "Layout" },   // the class is `acc`; `accordion` is the data attribute
    cardReveal:      { css: "card-reveal",    runtime: "cardReveal", inspector: true,  group: "Layout" },
    sequence:        { css: "seq",            runtime: "sequence",   inspector: true,  group: "Layout" },
    cardDeck:        { css: "card-deck",      runtime: "cardDeck",   inspector: true,  group: "Layout" },

    // ---- Interactive
    navButton:       { css: "nav-button",     runtime: false,        inspector: false, group: "Interactive" },  // its panel is actions.js's, reached by selection type
    checkbox:        { css: "block-checkbox", runtime: false,        inspector: true,  group: "Interactive" },
    quiz:            { css: "quiz",           runtime: false,        inspector: true,  group: "Interactive" },  // quiz behaviour is QuizRuntime, its own file
    courseNav:       { css: "course-nav",     runtime: "courseNav",  inspector: true,  group: "Interactive" },
    modeToggle:      { css: "mode-toggle",    runtime: false,        inspector: false, group: "Interactive" },  // light/dark switch; CSS + a data attribute only

    // ---- Components: both delegate their rendering to other blocks, so neither owns any CSS.
    componentGrid:   { css: null,             runtime: false,        inspector: true,  group: "Components" },
    libraryInstance: { css: null,             runtime: false,        inspector: true,  group: "Components" }
  };

  window.BlockManifest = { BLOCK_MANIFEST: BLOCK_MANIFEST };
  if (typeof module !== "undefined" && module.exports) module.exports = window.BlockManifest;
})();
