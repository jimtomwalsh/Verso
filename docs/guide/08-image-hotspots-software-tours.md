## 8. Image hotspots & software tours

An **Image hotspots** block places pins over an image. Each pin either opens a **popover**
(a rich-text and image call-out) or **navigates to another screen** — so a set of screens
becomes a guided software walkthrough.

### Behaviour

Under **Behaviour**, **Default for new hotspots** sets whether a *newly added* hotspot starts as a
**Popover on click** or **Screen navigation**. It is only a starting point — each hotspot's own
**Action** (in **Selected hotspot**) is the truth, so **one experience can mix** popover and
navigation hotspots freely. Switching the default never rewrites hotspots you have already placed.
Add screens in the **Screens** list; the first is the **Entry** screen. Each screen has its own
image and pins, so a tour can go any number of levels deep. A navigation pin's **Goes to** menu
targets any screen (or mints a new one).

In a deep tour, the learner gets a **Back** control and, by default, a **Home** control (jumps
to the entry screen). Both are optional and their labels are editable. The navigation controls and
the progress counter sit in a bar **below the screen**, so they never cover screen content — and
the space beneath the image stays clear for step instructions.

### Point or region markers

Select a hotspot and pick its **Shape**:

- **Point** — the default info badge.
- **Box (region)** — a resizable, transparent outline that frames a UI element (a button, a
  field) without covering it. It takes the course accent colour and the same pulse, so it still
  invites a click. Set **W** and **H** as a percentage of the image, or drag the box's
  **bottom-right corner handle** on the canvas or the tour board to resize it. A region marker
  can open a popover or navigate, exactly like a point.

### Video & GIF screens

A screen's image can be a **video or GIF** (a screen recording) — upload it where the image
goes. A video screen offers a **Playback** choice:

- **Loop** — an idle animation that cycles.
- **Play once** — autoplays muted on arrival, then freezes on the last frame with an optional
  **Replay** button. Turn on **Reveal hotspots after it ends** to keep that screen's hotspots
  hidden until the video finishes — so a "continue" or a card only appears once the demo has
  played through. (Reduced-motion learners get those hotspots up front, so they are never stuck.)

Reduced-motion learners see the first frame with a Play button instead. A popover card can also
hold a video. Video is packaged as separate files in the SCORM zip, so the course still loads
fast and works offline.

### Completion

Under **Behaviour**, a tour counts complete once the learner has **visited every screen** —
which releases the page's Next when gating is on. Alternatively, pick a **completion screen**,
or switch tracking off (**Mark as viewed**) so a decorative tour never holds Next. A
**Navigation trail** toggle shows the learner a breadcrumb of the screens they walked.

### Captions

Give each screen a **Caption** (in its inspector, or the secondary field under the screen name on
its tour-builder node). A single caption line sits **beneath the screen** and updates to the current
screen's caption as the learner moves through the tour — a quiet, always-current instruction that
never covers the screen.

### Chrome: nav, counter, progress, restart

- **External nav buttons** (Back / Home) sit below the screen. Turn them off under Behaviour for a
  tour that drives navigation purely through on-screen markers.
- The **screens-visited counter** anchors top-right, above the screen.
- A video screen shows a thin **1px progress bar** along the bottom edge as it plays.
- When the interaction is **fully finished** — every screen visited and every play-once video
  watched to the end — a white **restart** button appears centred on the **final** screen (the
  completion screen, or a dead-end with nowhere further to go) so the learner can replay. It stays
  hidden until then, and hides again if they navigate back through the tour.

### Editing screens on the canvas

For a multi-screen hotspot, small **‹ ›** buttons flank the interaction on the canvas. Step through
the screens with them to place and clean up each screen's markers in place, without opening the tour
builder. A video screen shows its **final frame** on the canvas (paused), so you can place markers
against the real end-state UI instead of a blank frame.

### Tour builder

For a multi-screen tour, the Screens section has an **Open tour builder** button — a full-screen
board where every screen is a node laid out in 2D.

- **Navigate.** Pan with a two-finger or space drag; zoom with ⌘/Ctrl-scroll. A **floating tool bar**
  sits over the board with **Tidy**, the **Cards face-up** toggle and the **zoom / Fit** control — the
  same floating-toolbar idea as the main canvas.
- **Build.** **Upload screens** adds several images at once. Drag nodes to arrange them; the
  layout saves with the course. **Tidy** (⌘/Ctrl+T) snaps nodes into a clean grid.
- **Add a hotspot by clicking.** Press **Add hotspot** in the board's top bar, then click anywhere
  on a screen — a marker drops exactly where you click. Press **Esc** (or the button again) to cancel
  without placing.
- **Link.** Drag the **port** on a navigation pin to another node to draw or repoint its link;
  click a link's **×** to remove it.
- **Edit in place.** Drag a marker to move a hotspot, or nudge it with the arrow keys.
- **Properties drawer.** The board fills the screen; the **Properties** button (top bar) slides in a
  drawer for the finer settings — colours, card padding, blend, alt text, video playback, nav labels —
  showing whatever you've selected. It starts closed so the board dominates; **Esc** or the ‹ button
  closes it. Most building happens on the board and toolbar; the drawer is for the occasional deep tweak.
- **Quick actions in the toolbar.** Whatever you select adds its actions to the floating toolbar:
  a **screen** gets set-as-Home, set-as-Finish, replace image and duplicate; a **hotspot** gets its
  **Card ↔ Navigate** and **Point ↔ Box** toggles plus duplicate and delete; a **loop** gets wrap and
  delete. (Inside the builder those hotspot toggles live on the toolbar, so the Inspector stays for the
  finer settings.) **Right-click** any screen, hotspot or loop for the same actions as a menu. The
  **Home** screen is protected — it can't be deleted.
- **What you see is what they get.** Markers on the board render exactly as the learner sees them —
  the real colour, the point badge or the resizable region box, the pulse — so you place against the
  final look, not a stand-in. A selected marker gets a thin selection ring on top.
- **Video nodes.** A video screen carries a small **play badge** so you can tell it from an image
  at a glance, and its node posters on the video's **final frame**. **Hover** a video node to scrub
  its preview — move left-to-right across the node to seek through the recording.
- **Source videos (harvest a tour from a recording).** **Add source video** drops a video onto the
  board as a **Source** node — a scratch surface you build screens from instead of pre-cutting them
  elsewhere. Each source has its own **player**: play/pause, a **playhead** you can drag or click to
  scrub, a time readout, and **Set in** / **Set out** to mark a segment (the marked range highlights
  on the scrub bar). A source is **author-time only: it is never included in the exported course**, so
  a long screen-recording never bloats your package. It stays saved with the course so you can come
  back and keep working from it; the **trash** button on the node removes it (screens you've already
  made from it are kept). To clear every source at once (e.g. once you've finished harvesting and
  want to slim the save file), open the Properties panel with nothing selected and use **Purge all
  sources** near the bottom — it removes all source recordings in one step; screens you've already
  harvested stay.
- **Crop the source (uniform size).** The **crop** button on a source's player shows a crop frame over
  the video — drag it to move, the corners to resize. Every screen you then harvest from that source
  comes out at that **same size**, so a set of screens lines up perfectly. Re-cropping only affects
  screens you make *after* the change (ones you already harvested keep their size).
- **＋ Screenshot (freeze a frame into a screen).** With a source scrubbed to the moment you want,
  press **Screenshot** on its player — Verso freezes that exact frame into a **new image screen** on
  the board, named after the source and the time (e.g. "Capture 0:07"), and selects it ready for
  hotspots. It's a normal screen from then on. Harvest as many as you like; they stack down their own
  column.
- **＋ Segment (turn a clip into a screen).** Mark **Set in** and **Set out** on a source, then press
  **Segment** — Verso records that stretch of the video into a **new video screen** (silent, cropped to
  the source's crop, so it matches your screenshots). It plays once and freezes on its last frame, and
  carries the full hotspot-video behaviour (progress bar, reveal-after-end). Recording runs in real
  time, so a ten-second clip takes about ten seconds. **Segment** is greyed out until a valid in/out
  range is marked.
- **Re-bake from source (non-destructive tweaks).** A screen you harvested remembers where it came
  from. Select it and press **Re-bake from source** (on its toolbar) to re-capture it from the source
  — handy after you crop the source or want the frame nudged. It **updates the screen in place**: the
  hotspots and links you've already added to it are kept. (Available only while the source is still on
  the board.)
- **Preview.** **Preview** runs an isolated test of just this tour without exporting; **Escape**
  returns you to the board.

> **Note.** The tour builder is an authoring aid only — it changes nothing in the exported
> course. Press **Done** or **Escape** to close.

### Loops (screen carousels)

To show one piece of UI across several states (off / warning / error) without wiring a separate
pin for each, use a **loop** — a frame holding an ordered set of screens the learner cycles as
one carousel.

- **Create one.** Click **Add loop** in the board's top bar, then drag screen nodes into the
  frame (or add them from the Inspector's **Add a screen** list). Reorder by dragging; a small
  number shows each member's place.
- **Point a pin at it.** Aim a navigation hotspot at the loop the same way you aim one at a
  screen. A pin that opens a loop shows a **stacked-cards** glyph so learners know it reveals a
  set of states.
- **How the learner sees it.** Clicking the pin opens the loop as a contained modal — one member
  screen at a time with **Prev / Next**, its name, and position ("2 / 3"). The **✕** lights up
  once they've seen every state. A **Wrap around** toggle cycles past the last screen back to
  the first. Every member counts toward completion.

---
