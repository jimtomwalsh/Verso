# Contributing to Verso

Thanks for your interest in Verso. This guide covers how to build, test, and submit changes.

## Prerequisites

There is **no build step and no install.** The app is vanilla JavaScript with classic
`<script>` globals and no third-party runtime dependencies.

- To run the editor: open `index.html` directly, or serve it for a clean HTTP origin
  (`./serve.command` → `http://localhost:8123`).
- To run the tests: **Node.js** only (the test runner is pure Node, no dependencies).

## The one invariant (please read before changing render/export)

`render(doc, theme)` in `src/render.js` is a **pure function of the document.** The editor
mounts its output onto the canvas, and the SCORM export serialises the *same* output — so
what you see in the editor is what ships.

- Nothing in `editor.js` / `editor.css` may leak into `render()`.
- New per-document state is **data on the `doc`**; render reads per-pass hooks
  (`window.__navSections`, `__docStyles`, `__glossary`, …), never editor state.
- If a change would make the editor and the export diverge, it's wrong.

## The 4-file block contract

Content blocks are split across four files, each with one job:

- `src/render.js` — pure render
- `src/course.css` — course styling (tokens-only) that ships in SCORM
- `src/runtime.js` — learner-side behaviour in the exported course
- `src/editor.js` — the inspector / authoring UI

Build inspector controls from the canonical set (see `UX-STYLE-GUIDE.md` and the
`design-system/`); if a pattern is missing, add it there first, then build to it.

## Stack rules

- **Vanilla JS, classic `<script>` globals** — no ES modules, no bundler, no `npm install`
  in the app. It must open from `file://`.
- `editor.css` = editor UI only (never bleeds into course output). `src/course.css` =
  tokens-only, ships in SCORM.
- **No emojis** in code or files.
- Keep the app **dependency-free** — do not add third-party runtime packages.

## Testing

```bash
node tests/run.js         # headless regression suite — must be N/N green
node --check src/<file>.js
```

- The suite syntax-checks `src/*` and exercises the extracted pure cores against fixtures.
  A failure prints `FAIL [section] name` and exits non-zero; CI gates on this.
- **Add a regression guard** for any new pure logic (extract the core, assert it in
  `tests/run.js`).
- Headless tests miss *wiring* — browser-verify your change: boot the app, check the editor
  render **and** a real `SCORMExport.buildPackage(...)`, not just green unit tests.

## Keep the docs in sync (code is truth)

The in-app User Guide (`docs/USER-GUIDE.md`) must track the feature set — if a change adds or
alters something an author sees or does, update the guide in the same change. Two tools help:

```bash
node tools/docs-maintain.js            # fail if a palette block is undocumented (--report to list)
node tools/docs-capture.js --stale src/editor.js editor.css   # which figure scenes a diff touches
```

`docs-maintain` catches missing block docs (the same coverage the suite enforces); `docs-capture
--stale` lists the illustration scenes to re-run when you change a surface they cover (see
`docs/scenes/README.md`). An unchanged scene re-captures byte-identically, so re-running is safe.

## Repository hygiene gate

This repo enforces a hygiene gate that hard-fails (in CI and, if installed, at commit time)
if a change introduces: customer/proprietary content, personal filesystem paths, secrets,
external CDN `<script>` loads in shipping HTML, new third-party runtime dependencies, or
committed course-content files. The gate is `scripts/check-hygiene.js`; it also runs as a
section of `node tests/run.js`, which CI requires to pass.

Enable the local pre-commit hook once per clone:

```bash
scripts/install-hooks.sh        # sets core.hooksPath -> scripts/hooks
```

Sample content must be neutral and invented — never real course material.

## Pull requests

1. Branch from `main`.
2. Keep render/CSS changes single-source so editor and export stay identical.
3. `node tests/run.js` must be green; new pure logic gets a regression guard.
4. Browser-verify wiring before opening the PR.
5. Describe what changed and why; match the style of the surrounding code.

## Do not commit course content

Real course data, built SCORM packages, `*.versopub.json`, and course assets are
**gitignored and must stay local** — never commit or push them. If you add a new sample,
use scrubbed, non-proprietary placeholder content only.

## Reporting security issues

Do not open a public issue for vulnerabilities — see [SECURITY.md](SECURITY.md).
