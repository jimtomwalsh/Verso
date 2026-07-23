# Hotspot block: unified screen-graph model + migrate-on-load

## Status

accepted

## Context

The hotspot block is being redesigned to host software tours — screen recordings and
grabs the learner walks through, driven by hotspot clicks (video/gif screen visuals,
screens that chain to arbitrary depth, a sub-canvas authoring surface). Its data shape
today is flat: markers live directly on the block (`block.hotspots[]`), and a
screen-mode destination is just an image URL hanging off a marker (`hs.screen`). A
directed screen graph — where markers belong to a screen and screens navigate to other
screens — cannot live in that shape.

## Decision

Adopt **one unified model**: `block.screens[]`, where each screen is a first-class node
(`{ visual, kind: image|gif|video, playback: loop|once, replay, markers[] }`) and each
marker's action is either `card` (popover child blocks) or `navigate` (target screen id).
`block.entry` names the entry screen. Every existing behaviour is a special case of this
model (popover-only = one entry screen, all markers `card`; hub-and-spoke = entry + one
navigate marker per screen).

Existing authored blocks reach the new shape by **migration on load** (`migration.js`),
not by a parallel legacy code path. Old popover blocks → one entry screen with `card`
markers; old screen-mode blocks → entry + one synthesized screen per `hs.screen`, with
`navigate` markers. `render()` stays pure and has a single path.

## Considered options

- **Dual-path (rejected)** — leave old blocks in the flat shape with their own render
  branch; only new graph blocks use `block.screens`. Rejected: it taxes render, runtime,
  and the new sub-canvas with two permanent models, and every future change to this block
  pays that cost.
- **New block type (rejected earlier)** — the interaction is a hotspot block from the
  learner's perspective and reuses the marker/positioning machinery; a sibling block would
  duplicate it.

## Consequences

- Migration touches persisted course data across many courses, so it must be lossless and
  is guarded by a regression test (old doc → migrate → renders the *identical* learner
  experience) added to `tests/run.js`. "Don't disrupt existing content" is satisfied by
  provably-identical render output, not by freezing the old shape.
- Video/gif screen visuals reuse the existing media path (`assetRef` → IndexedDB
  `AssetStore` hoist at the save choke point → externalize in SCORM export), so the
  storage invariant (ADR-0001) is honoured with no new mechanism.
- The full-screen sub-canvas "builder" overlay augments (does not replace) inline
  Level-1/Level-2 editing, and must be designed through the verso-frontend authority
  before it is built.
