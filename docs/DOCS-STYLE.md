# Verso docs style guide

How the User Guide is written, structured, and illustrated. The goal: a brand-new user can
**orient** themselves in minutes and **find** how to do any one thing in seconds. Modelled on
the Figma and Notion help centres. This is the standard the guide is held to — and the
standard the drift tools (`docs-maintain`, `docs-capture --stale`) exist to protect.

## The reader's journey (information architecture)

Order sections the way a newcomer's questions arrive:

1. **What is this?** — one paragraph on what Verso is and what you'll make.
2. **Quick start** — the shortest path from zero to a first result. A newcomer should reach
   "it worked" here, before any reference material.
3. **Where am I?** — a tour of the workspace (the three panes), with one annotated figure.
4. **Core concepts** — the mental model (chapters → pages → blocks) in a handful of lines.
5. **Tasks** — one section per thing you do (pages, blocks, theming, variants, import,
   preview, review, publish). Grouped by workflow, not by menu.
6. **Reference** — the exhaustive lists (block catalogue, keyboard shortcuts).
7. **Troubleshooting & tips** — friction points, placed last.

## Section shape (every section the same)

- **One-line intro** under the heading: what this section is for. No preamble.
- Then the content, shortest-useful-thing first.
- **A "task" reads as steps.** If it's a procedure, use a numbered list with imperative verbs
  ("Click…", "Drag…", "Pick…"), one action per step.
- **Keep it scannable.** A user skims for the one line they need — bold the UI label they'll
  look for.

## Writing rules

- **Voice: imperative and direct.** "Click **Demo** to preview." Not "You can click the Demo
  button in order to see a preview."
- **Paragraphs ≤ 3 sentences.** Vary length — a short lead, a fuller explanation, a short
  close. Never a wall.
- **Bold a UI label on first mention** (**Blocks** palette, **Demo**, **Import & Export**), so
  it's recognisable and searchable. Don't bold for mere emphasis.
- **British spelling**, sentence case for headings, terse. Same word for the same thing every
  time (a "page" is always a page).
- **Cut hedging and filler** ("simply", "just", "in order to", "please note"). Say the thing.
- **No customer or proprietary content.** Neutral, invented placeholders only — the public
  repo carries none.

## Callouts (use blockquotes)

Reserve a `>` blockquote for one of three jobs, and lead with a bold tag:

- `> **Tip.** …` — a shortcut or better way.
- `> **Note.** …` — a caveat or thing that's easy to miss.
- `> **Reassurance.** …` — "you can't break anything here" at a friction point.

Place a callout **where the friction is**, not in a lump at the end.

## Formatting devices

- **Keyboard shortcuts** render as symbols in a table: ⌘Z, ⌘⇧Z, ⌘K. `⌘` = Cmd (macOS) / Ctrl
  (Windows). Keep the shortcuts table the single reference; mention a shortcut inline only
  where it's the natural way to do the task.
- **Tables** for anything list-like with two facets (block → what it does; action → shortcut).
  Bold the header row; keep cells scannable.
- **Reference lists stay chunked.** A long catalogue is grouped under short sub-headings
  (Text, Media, Layout, …), each item one or two tight lines. If one item needs a lot of
  detail (e.g. software tours), give it its **own sub-section with its own sub-headings** —
  never a single 50-line bullet.

## Figures (the image rules)

Images earn their place or they don't appear. A giant, non-specific screenshot is worse than
no screenshot.

- **Show one thing.** Capture the *specific* control being discussed — the Pages outliner, the
  Blocks palette — not the whole editor. Crop tight (the scene runner's `clip`).
- **Right-sized.** Figures are framed and centred, capped to a modest width so they read as an
  inline reference, never a full-bleed wall. The reader never upscales a capture past its
  natural size.
- **Placed after the concept, before the steps** — the Figma rule. One figure per idea; a
  section rarely needs more than one.
- **Annotated when orienting.** Use numbered callout chips (1, 2, 3) + highlight rings to point
  at parts, with the numbers explained in the caption or the text.
- **Motion only for motion.** A GIF/animated figure is for a multi-step interaction (navigating,
  toggling). A single state is a still. Every motion figure ships a reduced-motion poster.
- **Caption every figure** — one descriptive line ("The Blocks palette, grouped by type").

## Maintained by code (drift is a bug)

World-class docs stay world-class only if they can't rot. Two guards, both runnable:

- `node tools/docs-maintain.js` — fails if a palette block isn't documented. Run it (and
  update the guide) whenever you add or rename a feature.
- `node tools/docs-capture.js --stale <changed-files>` — lists the figure scenes a code change
  touches, so illustrations get re-captured in the same change. Unchanged scenes re-capture to
  byte-identical bytes, so this is free to run.

Treat both as part of "done", the same as tests.
