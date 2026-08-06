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

- Nothing in `editor.js` / `styles/editor/` may leak into `render()`.
- New per-document state is **data on the `doc`**; render reads per-pass hooks
  (`window.__navSections`, `__docStyles`, `__glossary`, …), never editor state.
- If a change would make the editor and the export diverge, it's wrong.

## The 4-file block contract

A block has up to four concerns, and each one is a **registry keyed by block type**:

| Concern | Registry | Where |
|---|---|---|
| Pure render | `BLOCKS` | `src/render.js` |
| Course styling (ships in SCORM) | — | `styles/course/`, inlined by the exporter |
| Learner behaviour | `RUNTIME` | `src/runtime.js` |
| Inspector panel | `INSPECTORS` | `src/editor/inspector/blocks.js` |

**Start with `src/blocks/manifest.js`.** Add your block's row before writing any of the four
pieces. It declares which concerns your type has, and `node tests/run.js` then tells you **by
name** which ones you have not written — in both directions, so a piece left behind after a block
changes shape fails too.

Not every block has all four, and saying so is the point. Seven of twenty-seven types have runtime
behaviour; a heading renders and is finished. Nine have no inspector row because the label-only
panel is correct for a type whose only settings are appearance. `false` and `null` in the manifest
are assertions the suite checks as hard as the trues — declaring empty pieces to make a row look
full turns the contract into decoration.

Course chrome that binds to the page rather than to a block goes in `CHROME_RUNTIME`, not `RUNTIME`.
The two are separate so "this block has no runtime" and "this runtime has no block" stay
distinguishable.

Build inspector controls from the canonical set in `src/editor/inspector/primitives.js` — a
hand-rolled settings row is a defect. If the shape you need is missing, add it there first, then
build to it (see `design-system/readme.md`).

## Where things live

**Start with [`docs/architecture.html`](docs/architecture.html)** — open it in a browser. It is the
orientation map: the one law drawn out, a router for common tasks ("add a block", "change a panel",
"move code out of editor.js"), the layers, the four block registries, and a filterable index of
every module. Read it before grepping.

`src/editor.js` was 26,000 lines; it is ~6,700 of wiring plus **56 modules under `src/editor/`**.
**`src/editor/README.md` is the map** — one row per module, what it holds and what state it owns.
A suite gate fails if a module has no row or a row names no file, so it cannot rot. Read it before
looking for anything.

Modules reach the host through `src/editor/kernel.js` (`window.VersoEditor`): a module `need`s what
it reads and `expose`s its entry points; the host `provide`s stable values and `provideLive`s
anything it reassigns. **`need()` resolves against `provide()`, never against another module's
`expose()`.** Read kernel.js's header before adding a module — its rules are each a bug that
already shipped here.

Three stylesheet/doc directories are split files joined in a declared order
(`styles/editor/`, `styles/course/`, `docs/guide/`, each with an `order.json`). **Order is part of
the source**: CSS cascades and the guide is read top to bottom, so the suite fails if the directory,
the declared list, the `<link>` sequence or the exporter's read disagree. Add a file → add its row.

## Stack rules

- **Vanilla JS, classic `<script>` globals** — no ES modules, no bundler, no `npm install`
  in the app. It must open from `file://`.
- `styles/editor/` = editor UI only (never bleeds into course output). `styles/course/` =
  tokens-only, ships in SCORM.
- **No emojis** in code or files.
- **No runtime dependencies, ever.** Dev-only tools are permitted, but the app must always
  run and ship without them: `index.html` opens from `file://` with nothing installed, and a
  SCORM export carries no third-party code. `package.json` declares zero dependencies and
  exists to state that — the hygiene gate fails any `dependencies` or `devDependencies` entry.
- **`server/` is the one scoped exception** (optional server-of-one backend, server mode,
  in development): Node built-ins only (`node:sqlite`, `node:crypto`, `node:http`) plus a
  consciously accepted bundled Node runtime — still no third-party npm packages, no
  external network calls, and it never renders. It is dormant unless a deployment runs in
  server mode; the standalone `file://` app is unaffected.

## Testing

```bash
node tests/run.js         # headless regression suite — must be N/N green
node scripts/check-hygiene.js   # boundary + content gate (also a suite section)
node tools/docs-maintain.js     # every palette block is documented
node --check src/<file>.js
```

A failure prints `FAIL [section] name` and exits non-zero; CI gates on it.

**Three tiers, in order of preference.** Reach for the highest one that fits:

1. **`require` the file.** Anything with a dual-mode footer (`module.exports = window.X`) returns
   its real interface. Test the real thing.
2. **`tests/_load.js`** runs a classic script in a `node:vm` context with a stub window/document,
   for files a bare `require` cannot reach — DOM at load time, or an activation gate that must be
   seeded first.
3. **`tests/_editor.js`** boots the *whole* editor — every script `index.html` loads, in page order.
   `EDITOR_BOOT.boot()` / `.tryBoot()`. This is how DOM-heavy modules get tested at all.

Reading source text and string-slicing a core back into life is the tier below all three, and it is
what made the harness the thing forbidding a restructure. Avoid adding more of it; when a claim you
inherit fails after a move, **name what the claim actually rests on** rather than pointing it at
the new file — a claim can pass while matching the wrong implementation entirely.

**Add a regression guard** for any new pure logic.

**Headless tests miss wiring.** Browser-verify: boot the app, check the editor render **and** a real
`SCORMExport.buildPackage(...)`. A test that reads source cannot see a URL that fails to resolve, a
free identifier that only throws on one path, or a global that is already taken — all three have
shipped past a fully green suite here.

### Standing ratchets

These fail the build; widen the subject, never relax the floor.

- Every block type has the pieces its manifest declares, and no orphan pieces exist
- Every module in `src/editor/` has a README row, and every row a module
- Every split stylesheet and guide section is declared, and linked in the declared order
- The editor namespace has no unmet need and no unbound call site, after a full boot
- `editor.js` names nothing that only a module declares
- Every top-level entry carries a role in the boundary table
- Chrome tokens outside the design system do not increase

## Keep the docs in sync (code is truth)

The in-app User Guide (`docs/guide/*.md`) must track the feature set — if a change adds or
alters something an author sees or does, update the guide in the same change. Two tools help:

```bash
node tools/docs-maintain.js            # fail if a palette block is undocumented (--report to list)
node tools/docs-capture.js --stale src/editor.js styles/editor/   # which figure scenes a diff touches
```

`docs-maintain` catches missing block docs (the same coverage the suite enforces); `docs-capture
--stale` lists the illustration scenes to re-run when you change a surface they cover (see
`docs/scenes/README.md`). An unchanged scene re-captures byte-identically, so re-running is safe.

## Repository hygiene gate

This repo enforces a hygiene gate that hard-fails (in CI and, if installed, at commit time)
if a change introduces: customer/proprietary content, personal filesystem paths, secrets,
external CDN `<script>` loads in shipping HTML, third-party dependencies, or committed
course-content files. The gate is `scripts/check-hygiene.js`; it also runs as a section of
`node tests/run.js`, which CI requires to pass.

It also enforces the **repository boundary** — the role table in
[README.md](README.md#repository-boundary). Every top-level entry carries one declared role
(Ships / Optional / Dev-only / Meta / Gitignored). A new top-level file or folder fails the
gate until you classify it in both the README table and the `ROLES` map in the gate, and
nothing under `workbench/` may be staged. Put prototypes, spikes, specs and audits in
`workbench/` — it is gitignored on purpose, so working material stops sitting next to
shipping code.

Enable the local pre-commit hook once per clone:

```bash
scripts/install-hooks.sh        # sets core.hooksPath -> scripts/hooks
```

Sample content must be neutral and invented — never real course material.

## Pull requests

1. **Branch from `staging`, and PR into `staging`** — never into `main`. `main` is production and
   deploys on push; `staging` is the pre-release instance the same workflow serves from `/staging/`.
   A separate promotion PR moves `staging` → `main`.
2. Keep render/CSS changes single-source so the editor and the export stay identical.
3. `node tests/run.js` green; new pure logic gets a regression guard.
4. Browser-verify wiring before opening the PR, including a real `buildPackage` if you touched
   anything the exporter reads.
5. Say what changed and **why it is one concern**; name what you left behind and why; say what the
   tests and the browser check did *and did not* prove.

## Do not commit course content

Real course data, built SCORM packages, `*.versopub.json`, and course assets are
**gitignored and must stay local** — never commit or push them. If you add a new sample,
use scrubbed, non-proprietary placeholder content only.

## Reporting security issues

Do not open a public issue for vulnerabilities — see [SECURITY.md](SECURITY.md).
