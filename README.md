# Verso

[![CI](https://github.com/jimtomwalsh/Verso/actions/workflows/ci.yml/badge.svg)](https://github.com/jimtomwalsh/Verso/actions/workflows/ci.yml)

A **self-hosted, offline, private** browser-based eLearning authoring tool. Authors
build interactive courses on a canvas editor and export them as **SCORM 1.2** packages
that run in an LMS.

Vanilla JavaScript, no build step, no dependencies. The editor opens straight
from `file://` — it runs entirely on your own machine.

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

`render(doc, theme)` in `src/render.js` is a **pure function of the document**.

- The editor **mounts** its output onto the canvas.
- The SCORM export **serialises the same output**.

So what you see in the editor is what ships. Nothing in `editor.js` / `editor.css`
may leak into `render()`; new per-document state is data on the `doc`, and render
reads per-pass hooks (e.g. `window.__navSections`, `__docStyles`, `__glossary`)
rather than editor state. This is the rule everything else defers to.

## Run

Double-click `index.html`, or serve it for a clean HTTP origin:

```bash
./serve.command        # python3 -m http.server 8123 → http://localhost:8123
```

No install. No bundler. Classic `<script>` tags exposing globals.

## Test

Headless regression suite — pure Node, no dependencies, run before every change:

```bash
node tests/run.js      # syntax-checks src/* + exercises the pure cores → N/N
```

It extracts the pure logic from the classic-script IIFEs and asserts against
fixtures; a failure prints `FAIL [section] name` and the process exits non-zero
(this is what CI gates on). Add a regression guard for any new pure logic.

Wiring that unit tests can't see is checked with a Puppeteer harness that boots
the app, runs an in-page probe, and inspects both the editor render **and** a real
`SCORMExport.buildPackage(...)`.

## Authoring model

- **Document** → chapters → pages → blocks. Blocks are the content units
  (headings, text, images, columns, cards, quizzes, hotspots, HTML/web embeds, …).
- **Blocks follow a 4-file contract:** `src/render.js` (pure render) ·
  `src/course.css` (tokens-only styling that ships in SCORM) · `src/runtime.js`
  (learner-side behaviour in the exported course) · `src/editor.js` (the inspector
  UI). New controls are built from the canonical set in `UX-STYLE-GUIDE.md`.
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
design-system/      the Verso UI design system (tokens + components)
server/             optional server-of-one backend (server mode, in development)
docs/               user guide + architecture decision records (docs/adr/)
UX-STYLE-GUIDE.md   canonical inspector controls + design rules
```

## Stack rules

- Vanilla JS, classic `<script>` globals — **no** ES modules, bundler, or
  `npm install` in the **app**. Must open from `file://`.
- `editor.css` = Verso UI only. `src/course.css` = tokens-only, ships in SCORM.
- No emojis in code or files.
- The optional `server/` backend (server mode, in development) is the one scoped
  exception to "dependency-free": it uses only Node built-ins (`node:sqlite`,
  `node:crypto`, `node:http`) plus a consciously accepted bundled Node runtime.
  It never renders, and everything in it is dormant unless a deployment runs in
  server mode — the standalone `file://` app is unaffected.

## Contributing

1. Read `UX-STYLE-GUIDE.md` (how the UI is built) before adding inspector controls.
2. Make render/CSS changes single-source so editor and export stay identical.
3. `node tests/run.js` must be green, and any new pure logic gets a regression guard.
4. Browser-verify wiring (editor render **and** the export package) before shipping.

> **Course content is not part of this repository.** Real course data, built SCORM
> packages, and course assets are gitignored and stay local — see `.gitignore`.
