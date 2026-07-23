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
