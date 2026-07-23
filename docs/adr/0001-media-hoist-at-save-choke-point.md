# ADR 0001 — Inline media must be hoisted to AssetStore at the save choke point

Status: accepted (2026-07-11)

## Context

A large real course (147MB JSON: 62 pages, 444 blocks, ~133MB of it inline base64
images, largest single PNG 59MB) could not be imported:

- **New -> Import JSON -> pick file -> nothing.** Modal stayed open, no course, no
  error. Reproduced on the 147MB file, an older backup, and a 27MB slimmed copy.
- The same import ran fine in headless Chromium (~1.1s), so the JS path itself
  completes — the failure was environment-specific (the Verso WKWebView host).

Two independent defects, found together:

1. **Silent import failure.** The Import-JSON `FileReader` had `onload` but no
   `onerror`, and the handler used native `alert()`/`confirm()`. Any read/parse/load
   failure produced *exactly* "nothing happens" with no surface to diagnose it.

2. **The real blocker — inline media overflows storage on save.**
   `migrateAllAssets()` hoists inline base64 media into the uncapped IndexedDB
   `AssetStore`, but it **only runs on boot**. A doc imported *after* boot went
   straight to `saveRegistry -> JSON.stringify(registry)` with all 133MB of images
   still inline, blew the ~5MB `localStorage` cap ("Storage full"), the write failed,
   and — because it never persisted — the doc was **lost on reload before
   boot-migration could ever run on it.** `saveRegistry` hoisted embed-HTML but not
   media, so nothing drained the images at the write.

## Decision

**All inline `data:` media is hoisted to `AssetStore` (IndexedDB, no cap) at the
single save choke point (`saveRegistry`), before `JSON.stringify`.** The registry
JSON that hits `localStorage` therefore only ever carries structure, text, and
`asset:<id>` refs — never megabytes of base64.

Implementation (both in `src/editor.js`):

- `saveRegistry` runs `migrateDocMedia` + `migrateDocEmbedHtml` over every doc before
  stringify. Idempotent (a hoisted field is already an `asset:` ref, skipped next
  pass) and non-destructive (an un-hoistable `data:` URL is left in place, never
  dropped). `migrateDocMedia` / `eachMediaSlot` live in `src/render.js` and walk
  every string field in the doc, so any media slot is covered.
- The Import-JSON handler gained `reader.onerror`, DOM dialogs (`confirmModal`)
  instead of native `alert`, and `[import] ...` console logging at each step, so a
  future failure names the failing step instead of doing nothing.

This preserves the `render(doc, theme)` purity invariant: `asset:` refs are the
established mechanism; render resolves them via the `resolveAssets` hook and export
serialises the same output. Editor == export is unaffected.

## Consequences

- A media-heavy course imports and **persists** cleanly; the residual registry JSON
  stays well under the `localStorage` cap.
- If "Storage full" ever returns *after* media hoisting, the residual (non-media)
  JSON alone exceeds the cap — a different, smaller fix (route the registry itself to
  IndexedDB). Not needed today; noted as the next escalation.
- Regression guard: `tests/run.js` (1647/1647). The wiring (import + a real
  `saveRegistry`) must be browser-verified in the actual WKWebView app — headless
  Chromium does not reproduce the storage failure.

## Landmine — do NOT repeat: inline HTML-block string translation

The session that triggered this incident was an agent (~2h, since reverted) trying to
make the embedded translation agent **pull text strings out of HTML blocks and
translate them inline**. That work is what corrupted storage/media management here.

- **Agent translation of native content is the working, kept approach.** Keep it.
- **Do NOT re-attempt extracting/translating strings inside raw HTML blocks inline**
  without first solving media/storage bloat. Raw HTML blocks and their media are
  hoisted out of the doc JSON on purpose (see `migrateDocEmbedHtml`); a translation
  pass that re-inlines that content, or duplicates per-language copies into the doc,
  puts the bytes straight back into the `localStorage`-bound registry and reintroduces
  exactly the "Storage full" / silent-data-loss failure above.
- If inline HTML-string translation is ever wanted again, design it against this ADR
  first: translated variants must live as `asset:` refs / out-of-doc storage, never
  as inline base64 or duplicated raw markup in the registry JSON.
