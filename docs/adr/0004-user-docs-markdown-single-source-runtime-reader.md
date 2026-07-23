# User docs: markdown single-source, runtime reader, committed regenerable captures

The in-app user docs (#91) stay single-sourced from `docs/USER-GUIDE.md` markdown and are
rendered at runtime by the bundled `mdToHtml` (extended: heading IDs, images, figure
directive, nested lists) into a floating docs panel with popout. We deliberately rejected a
hand-authored HTML docs bundle (dual-maintenance breaks the CLAUDE.md same-session
docs-alignment rule) and a generated static site (adds a build step to a no-build stack, and
the built bundle drifts from its source between builds). Illustrations (#220) are produced by
re-runnable scenes that capture the real editor via the Puppeteer harness and are committed
as size-budgeted static/animated WebP under `docs/assets/` — committed so docs work on a
fresh clone, `file://`, and the packaged shell; regenerable so they track the UI (code is
truth), unlike hand-authored motion which rots silently.

## Consequences

- Guide headings are **docs anchors**: editor surfaces deep-link to them, so renaming a
  section heading is a breaking change for those surfaces.
- Docs authors (human + agent) keep to the `mdToHtml` subset; the renderer is extended, not
  swapped for a vendored CommonMark parser.
- Capture scenes must use a synthetic demo doc only — real course content is
  export-controlled and never enters the repo.
- Staleness is procedural, not automated: a UI change touching a covered scene re-runs that
  scene in the same session (hash-ratchet/CI regeneration deliberately deferred).
- Popout is environment-adaptive: new-tab standalone page in browsers; full-window in-app
  promotion in the WKWebView shell (which swallows `window.open` — see #81).
- Capture runner (#27): `tools/docs-capture.js` reads a declarative scene (JSON header +
  step-list) and drives the real editor via Puppeteer in capture mode on `window.SAMPLE_DOC`
  (synthetic demo only), emitting a budget-checked still WebP to `docs/assets/`. Determinism
  has a real constraint: the live zoomed-out canvas page-previews are async-scaled and NOT
  byte-stable, so scenes `clip` to stable editor chrome (panel/palette/toolbar/inspector), not
  the whole canvas. The runner is a dev tool (needs Puppeteer via NODE_PATH), never shipped in
  the app; its pure scene-schema core is unit-tested in `tests/run.js`.
- Annotations (#29): a capture-only overlay (highlight ring / numbered callout chip / pointer)
  drawn into a body-level `#capture-annotate-layer`, DS-token styled in editor.css so it
  inherits the theme, driven by scene steps (highlight/callout/pointer/clearAnnotations). It is
  editor chrome only — rendered outside `.course-root`, so render()/course.css/the SCORM export
  never see it (invariant held; verified against a real `buildPackage`). Absent from normal
  authoring (capture mode is off by default).
- Motion (#28): `tools/webp-anim.js` is an ORIGINAL animated-WebP **muxer** (VP8X/ANIM/ANMF
  from the public WebP container spec), not a vendored VP8 encoder — a real encoder was too
  heavy for the no-build/air-gap stack (the same reason the vendored GIF codec is unsuitable).
  The runner's `shootMotion` step captures a sequence of frames (motion = discrete state
  changes between frames, since animations are frozen) and muxes Chrome-native per-frame WebP
  bitstreams into one budget-checked (~500KB) animated WebP plus a poster still; under
  `prefers-reduced-motion` the docs reader shows the poster (the #25 `{poster=}` slot). For
  byte-identical re-runs the runner also resets persisted UI prefs (localStorage + IndexedDB)
  before each capture, so a stateful toggle driven in one scene can't flip the next run's start.
- Capture mode (#26): `src/capture-mode.js` self-activates on `?capture=1` or a preset
  `window.__captureMode` and installs a deterministic clock (monotonic from a fixed epoch),
  a seeded RNG (mulberry32 over `Math.random`), a freeze stylesheet (transitions/animations
  off, caret hidden), and a media-settle helper — so two shots of the same demo-doc state are
  byte-identical, satisfying the "unchanged UI -> identical bytes -> no-op commits" promise.
  Off by default (zero effect on normal authoring); Verso-UI-only, never bundled into the
  SCORM export. Loads first in index.html so the patched clock/RNG precede any id minting.
- Figure directive (#25): a whole guide line of the form
  `![alt](docs/assets/x.webp "caption"){poster=docs/assets/x-still.webp}` renders a
  `<figure>` in the docs reader. Caption and `{poster=...}` are optional; `poster` is the
  reduced-motion still slot for motion figures (#28), unused for stills. A missing asset
  degrades to a caption-only placeholder (no broken glyph). The first real committed figure
  is wired by the capture tracer (#27), not hand-authored.
