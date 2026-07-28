# Verso

[![CI](https://github.com/jimtomwalsh/Verso/actions/workflows/ci.yml/badge.svg)](https://github.com/jimtomwalsh/Verso/actions/workflows/ci.yml)

A **self-hosted, offline, private** browser-based tool for creating **technical documentation
and learning materials**. You build content on a canvas editor, reuse blocks across documents,
and publish in different formats — including interactive **SCORM 1.2** courses that run in an LMS.

Vanilla JavaScript, no build step, no dependencies. The editor opens straight
from `file://` — it runs entirely on your own machine.

> 🌳 **[See the Verso roadmap](roadmap.html)** — an at-a-glance map of what Verso does
> today and where it's growing. (Open `roadmap.html` in a browser.)

## Two ways to run Verso

- **Local / standalone (the default, shipping today).** One author, one machine.
  Everything below under *Security, privacy & data handling* applies to this posture and
  is unchanged.
- **Server-of-one (optional, on-prem, _in development_).** The same engine, plus a
  minimal self-hostable Node backend so a small team can work in the same master courses
  on an **on-prem** server (never cloud). It adds accounts/SSO, real-time collaboration,
  block-locking, and review links. This posture is **not yet released** — it is dormant
  and no local install points at it. When it ships it is strictly opt-in; enabling it does
  not change the standalone experience. Its architecture + security model live in
  [`server/README.md`](server/README.md) and the *Server mode* section of
  [`SECURITY.md`](SECURITY.md).

## Security, privacy & data handling

> This section describes the **local / standalone** posture — the shipping product. The
> optional on-prem **server mode** (in development) has a distinct security model; see
> [`SECURITY.md`](SECURITY.md).

Verso is designed to keep your content on your own machine. In short:

- **Self-hosted / local-first.** Runs from a local file, a local static server, or an
  optional macOS desktop shell. In this posture there is **no server, no cloud, no hosted
  backend** — nothing to sign in to.
- **Your content never leaves your device.** Courses are stored locally (browser
  `localStorage` / IndexedDB, or local files via the File System Access API). Nothing is
  transmitted to the tool's author or any backend.
- **No accounts, no telemetry, no analytics, no tracking, no phone-home.** The app
  collects and sends nothing.
- **Zero third-party runtime dependencies.** Dependency-free vanilla JS — no `npm
  install`, no `node_modules`, no bundled framework. (Server mode adds one consciously
  accepted exception, a bundled Node runtime — scoped to that posture, see below.)
- **Self-contained exports.** SCORM packages inline their fonts and assets and run
  offline / air-gapped in an LMS.
- **Fully air-gap capable.** All editor fonts are vendored locally; with local media the
  editor makes **no external network calls at all**.

The only external network touchpoints are **optional and author-initiated**:

1. **Adding a custom Google Font** downloads that public font *at authoring time* and
   embeds it into the course — no course data is sent, and the exported course stays
   self-contained.
2. **Embedding an external Vimeo/YouTube video or Web Embed** causes that provider to be
   contacted *when a learner views that page*. For fully air-gapped courses, use
   self-hosted video / local media instead (Verso can self-host Vimeo as a local
   `<video>` on export).

See [SECURITY.md](SECURITY.md) for the vulnerability-disclosure policy.

## The one invariant

`render(doc, theme)` in `src/render.js` is a **pure function of the document** — the editor
mounts its output onto the canvas, and the SCORM export serialises the *same* output. So what
you see in the editor is what ships. The full render/export rules live in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Run

Double-click `index.html`, or serve it for a clean HTTP origin:

```bash
./serve.command        # python3 -m http.server 8123 → http://localhost:8123
```

No install. No bundler. Classic `<script>` tags exposing globals.

## Test

```bash
node tests/run.js      # headless regression suite, pure Node → N/N
```

Run before every change; CI gates on it. Wiring that unit tests can't see is browser-verified
against a real `SCORMExport.buildPackage(...)`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
full testing workflow and regression-guard rule.

## Authoring model

Build content once, reuse it across documents, and publish it in different formats.

- **Document** → chapters → pages → blocks. Blocks are the content units
  (headings, text, images, columns, cards, quizzes, hotspots, HTML/web embeds, …).
- **Blocks follow a 4-file contract** (`render.js` · `course.css` · `runtime.js` ·
  `editor.js`), with UI controls from `design-system/` — see
  [CONTRIBUTING.md](CONTRIBUTING.md).
- **Theming** is CSS custom properties (`--color-*`), with a `data-mode` light/dark
  switch and author-editable tokens, saved text styles, and custom fonts.
- **Export** produces a self-contained SCORM 1.2 zip; fonts and assets are inlined
  so the course renders offline / air-gapped.

## Project layout

```
index.html          editor shell (toolbar, panels, canvas)
editor.css          Verso UI ONLY — never bleeds into course output
src/
  render.js         PURE render(doc, theme) — the single source of truth
  course.css        course styling (tokens-only) — ships in SCORM
  runtime.js        learner-side runtime for the exported course
  quiz-runtime.js   knowledge-check runtime
  editor.js         canvas editor + inspector UI
  export.js         SCORM 1.2 packaging
  model.js / schema.js / persist.js / theme.js / csv.js / components.js …
  store-http.js     HTTP storage adapter — inert unless a server URL is injected
  sync-client.js    live-collaboration client — inert unless a server URL is injected
tests/run.js        headless regression suite (no deps)
viewer/             standalone review Viewer (publish → comment → merge back)
desktop/            optional macOS app shell (WKWebView)
design-system/      the Verso UI design system — rules, tokens, components, gate mapping
server/             optional server-of-one backend (server mode, in development)
docs/               user guide + architecture decision records (docs/adr/)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for build/test setup, the render/export invariant, the
4-file block contract, stack rules, and the PR checklist. In short: `node tests/run.js` must be
green, render/CSS changes stay single-source, and new pure logic gets a regression guard. UI
controls come from the canonical set in [`design-system/readme.md`](design-system/readme.md).

> **Course content is not part of this repository.** Real course data, built SCORM
> packages, and course assets are gitignored and stay local — see `.gitignore`.
