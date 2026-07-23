# Docs capture scenes (#27)

A **scene** is a small JSON file that describes a deterministic screenshot of the real Verso
editor. The runner `tools/docs-capture.js` reads a scene, drives the editor in **docs capture
mode** (#26 — deterministic clock/RNG, frozen animations + caret) on the **synthetic demo doc
only** (`window.SAMPLE_DOC`; real course content never enters a capture — export-control), and
writes a size-budgeted WebP to `docs/assets/`. Re-running an unchanged scene reproduces
byte-identical bytes, so a no-op scene makes a no-op commit (ADR 0004).

## Run

```
cd "$CODE" && python3 -m http.server 8123 &            # serve the app
NODE_PATH="$SCRATCH/node_modules" node tools/docs-capture.js docs/scenes/<scene>.json
```

Exit code is non-zero if the scene is invalid, produces no output, or a still exceeds its
size budget (~200 KB for stills).

## Scene format

```json
{
  "id": "workspace-overview",             // unique scene id
  "covers": ["editor-workspace", "src/editor.js#mount"],  // src surfaces this illustrates (#30)
  "kind": "still",                        // "still" (motion arrives with #28)
  "viewport": { "width": 1440, "height": 900, "dpr": 2 },
  "theme": "dark",                        // "dark" | "light"
  "steps": [ ... ]                        // ordered step-list, see below
}
```

`covers` is the list of source surfaces the scene illustrates; #30 uses it to detect which
scenes a code change makes stale.

## Step vocabulary

A scene is **data, not code** — steps come from a fixed small vocabulary:

| verb     | fields                    | effect                                             |
|----------|---------------------------|----------------------------------------------------|
| `goto`   | `target` (CSS selector)   | click a nav / page target                          |
| `select` | `target` (CSS selector)   | click a canvas block to select it (opens inspector)|
| `hover`  | `target` (CSS selector)   | hover a target                                     |
| `click`  | `target` (CSS selector)   | click a target                                     |
| `type`   | `target`, `text`          | type text into a target                            |
| `wait`   | `ms`                      | pause (let the UI settle)                          |
| `shoot`  | `out` (`*.webp`), `clip?` | still screenshot to `docs/assets/<out>`; `clip` crops the shot (see below) |
| `shootMotion` | `out`, `poster` (`*.webp`), `frames[]`, `clip?`, `loop?` | capture a frame sequence -> one animated WebP (`out`) + a poster still (`poster`) |

`clip` is either a CSS selector (crop to that element's box, rounded to whole pixels) or an
explicit rect `{ "x", "y", "width", "height" }`. Omit it for a full-viewport shot.

Every scene needs at least one `shoot` step. A missed selector logs a warning and continues
(so a scene degrades rather than crashing mid-capture).

## Determinism: target stable chrome

Two runs of an unchanged scene must produce byte-identical bytes (the no-op-commit promise).
Capture mode (#26) freezes the clock, RNG, animations and caret, and the runner waits for
fonts + image decode before each shoot — but the **live zoomed-out canvas page-previews are
async-scaled and are NOT byte-stable**. So a scene should `clip` to stable editor chrome
(a panel, the palette, the toolbar, a selected block's inspector) rather than shoot the whole
multi-page canvas. The shipped `structure-panel` scene clips to the left column (Structure
outliner + Blocks palette), which reproduces exactly.

## Motion scenes (#28)

`kind: "motion"` scenes use a `shootMotion` step. Motion comes from **discrete state changes
between frames** (capture mode freezes CSS animations), so each frame is deterministic. Each
frame is `{ "before": [ ...steps... ], "duration": <ms> }` — the `before` steps run, the UI
settles, then the frame is captured. The runner muxes the frames into one animated WebP
(`out`, ~500KB budget) via `tools/webp-anim.js`, and writes the FIRST frame as the `poster`
still (the reduced-motion fallback). Prefer race-free actions (selecting a page always selects
it) over stateful toggles. Example: `docs/scenes/outliner-navigate.json`.

The runner resets persisted UI prefs (localStorage + IndexedDB) before every capture, so a
toggle driven in one scene can't change the next run's starting state.

## Wiring a figure into the guide

Reference the emitted asset from `docs/USER-GUIDE.md` with the figure directive (#25):

```
![Alt text](docs/assets/structure-panel.webp "Caption shown under the image")
```

For a motion figure, add the reduced-motion poster still with `{poster=...}`:

```
![Alt text](docs/assets/outliner-navigate.webp "Caption"){poster=docs/assets/outliner-navigate-still.webp}
```
