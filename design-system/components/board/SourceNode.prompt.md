**SourceNode** — an author-time *source video* on the `GraphBoard`: a scratch harvest surface the author scrubs to cut screens from, NOT a screen that ships. A raised card (distinct from `ScreenNode` by an accent "Source" tag) wrapping a `ThumbnailFrame` of the video, an inline-editable title, a remove action, and — below the frame — a **MediaTransport** strip. It lives on `hotspot.sources[]` and is excluded from render/export; the board resolves its video directly.

```jsx
<SourceNode
  x={src.bx} y={src.by} title={src.name} onTitleChange={renameSource}
  onMove={(x, y) => setSourceCoords(src.id, x, y)} onRemove={() => removeSource(src.id)}
>
  <ThumbnailFrame ratio="16 / 9">{videoOf(src.visual)}</ThumbnailFrame>
  <MediaTransport
    time={t} duration={dur} inPoint={src.in} outPoint={src.out}
    onSeek={setTime} onPlayToggle={togglePlay} playing={playing}
    onSetIn={markIn} onSetOut={markOut}
  />
</SourceNode>
```

- **Sibling to `ScreenNode`, not a fork.** Same card tokens (`--surface-raised`, `--radius-md`, `--border-subtle`, `--space-2`), same inline-title rename-in-place, same drag-to-reposition (persist `sources[].bx/by`; render ignores them). The ONE visual difference: an accent **"Source" tag** (`--accent` on `color-mix(--accent 14%)`, `--radius-pill`) so it never reads as a shipping screen. Multiple SourceNodes may coexist (multi-source tours).
- **Never ships (the invariant).** `sources` is skipped by the media walk, so a source video is excluded from BOTH the editor resolve-pass and the SCORM bake; it persists in the doc (for re-harvesting) but is kept alive only for garbage-collection. A `ScreenNode` is what the learner gets; a `SourceNode` is the workbench.
- **Direct manipulation.** The transport belongs ON the media it controls (craft: direct manipulation + the-tool-recedes), NOT on the board bar or the contextual pill — those carry board-wide tools and selection *verbs*, not a per-object continuous control. Removal is a hover `IconButton` (trash) with a `Modal` confirm (destructive), consistent with other danger actions.
- **State.** Idle card `--surface-raised` / `--border-subtle`; dragging raises z. No selection inspector in v1 (the node is self-contained; harvest actions live on the node).

---

### MediaTransport (the embedded pattern this node introduces)

The canonical control set has no scrub/transport; this is that pattern. A two-row strip, full card width, below the `ThumbnailFrame`:

- **Row 1 — scrub track.** A thin rail (`height: 4px`, `--radius-pill`, `--border-subtle`) with a filled portion up to the playhead (`--accent`). A draggable **playhead** knob (`--accent`, `--shadow-100`). Click the rail to seek; drag the knob to scrub live. In/out marks render as **bracket ticks** on the rail with the selected range tinted (`color-mix(--accent 24%)`) so the segment reads at a glance.
- **Row 2 — controls.** Left: a play/pause `IconButton` at `--control-sm`. Centre/right: a monospace **time readout** `current / duration` (`--text-secondary`, tabular-nums, `--type-caption`). Trailing: **Set in** / **Set out** `IconButton`s (mark the current playhead as the segment ends). Harvest actions (＋ Screenshot at the playhead, ＋ Segment between in/out) append here in later passes.
- **Feel.** Only one source plays at a time (starting one pauses others + any hover-scrub). Live feedback on every drag (`onSeek` fires continuously). `in < out` is enforced. Reversible: marks clear/reset without side effects. Keyboard: space toggles play when the node is focused.
- **Tokens:** rail/fill `--border-subtle` / `--accent`; knob `--accent` + `--shadow-100`; readout `--text-secondary` / `--type-caption`; buttons canonical `IconButton` at `--control-sm`; spacing `--space-1`…`--space-2`; radius `--radius-pill` (rail/knob).

This supersedes the interim hover-scrub on source nodes (`ScreenNode` video thumbs keep hover-scrub — it's the right lightweight affordance there).

### Crop overlay (source-level, uniform output)

A **crop** `IconButton` (crop glyph) on the controls row toggles a crop overlay on the thumb: a bright rect (`--accent` border) with four corner handles, the area outside dimmed by a scrim. Drag the body to move, a corner to resize (the opposite corner stays anchored). Stored **normalised** on `src.crop = {x,y,w,h}` (0-1 fractions); a full-frame crop stores as *no crop*. Every harvest (screenshot now, segment later) routes through this crop so all screens from one source share the same W×H — that is the point. Re-crop is **forward-only** (already-harvested screens are independent baked assets). Reuses the crop-rect prior art from the image-block crop design; tokens: box `--accent`; handles `--accent` + white stroke; scrim a black alpha (no token — a dimming mask). One crop overlay open at a time.

### Ripple cuts (MediaTransport extension — carve removed sections out of a segment)

Extends `MediaTransport` so a `＋ Segment` clip can be **one in/out with sections punched out of the middle** (a mistake removed; the good pieces stitched). Model is **subtractive**: `src = {in, out, cuts:[{start,end}]}` — kept clip = `[in,out]` minus the cuts. Additive keep-range assembly is out of scope. **Progressively disclosed:** the cut affordances appear only once a valid `in < out` exists (before that they are meaningless — simple-things-simple).

- **Rail (Row 1) — kept vs removed reads at a glance.** The `[in,out]` range keeps the accent kept-tint (`color-mix(--accent 24%)`). Each committed cut renders as a **removed band punched out of that tint**: a flat neutral `--surface-sunken` fill with `--border-subtle` notch edges — accent means *kept/live*, so a cut must read as **absence**, not another accent. (Hatch/diagonal rejected — noisier, no token.) A **pending** cut (cut-in dropped, cut-out not yet) shows as a **dashed `--accent` bracket** — a provisional dialect of the in/out bracket ticks. A **selected** cut band gets a **1px `--accent` outline** (the one place accent touches a cut, marking the acted-upon target) plus an inline **✕ remove** `IconButton` at `--control-sm`.
- **Controls (Row 2) — a distinct sub-group.** Appended after Set in / Set out (which they mirror): **Set cut-in** / **Set cut-out** — same control class as the segment-bounds pair (consistency-over-novelty, not a one-off), grouped with a `--space-2` gap so they read as "carve within the segment", not new segment bounds. **Set cut-out is disabled until a pending cut-in exists** (keeps the pending→commit state legible). First click drops the pending cut-in at the playhead; second commits it. `Esc` cancels a pending cut.
- **Net-length readout.** Rides the **existing** time readout cluster (no new row): `0:12 / 1:30 · clip 0:18` — the trailing `clip` = in→out minus cuts, same `--type-caption`, `--text-secondary`, tabular-nums. Shown only when cuts exist. This is what the bake will produce.
- **Feel + guards.** Cuts kept sorted + non-overlapping (overlapping/adjacent **auto-merge** on commit). A cut touching in/out is allowed (pulls the effective bound inward). Moving in/out **clips/drops** cuts outside the new bounds. `＋ Segment` **disables** when the net kept length is 0 (extends the existing `in < out` gate). Remove-cut is **reversible via undo** (no `Modal` — unlike node removal; it is low-stakes and restorable). Live feedback on every mark. Keyboard: `Esc` cancels the pending cut.
- **Tokens:** removed band `--surface-sunken` / `--border-subtle`; pending bracket dashed `--accent`; selected outline `--accent` (1px); ✕ + cut buttons canonical `IconButton` at `--control-sm`; readout `--text-secondary` / `--type-caption`; group spacing `--space-2`.

Provenance for re-bake carries the cuts: `source:{id, in, out, cuts:[{start,end}], speed?}` (editor-only, ignored by render like `bx/by`). Composes with the segment **speed preset** (speed applies to the whole stitched clip).
