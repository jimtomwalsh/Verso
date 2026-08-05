## 6. Adding & editing blocks

Blocks are the content units on a page. This section covers inserting and editing them; §7 is
the full catalogue.

![Click a page in the outliner; the highlight marks the page you're editing.](docs/assets/annotated-navigate.webp "The highlight marks the active page."){poster=docs/assets/annotated-navigate-still.webp}

**Insert a block.** Switch the left panel to **Blocks** and click or drag a block onto a page — or
into a container (**Card**, **Columns**, **Card Reveal**). For a reusable component you've already
saved (§9), use the **Reusable components** beneath the palette in the same Blocks section.

**Select and drill in.** One click selects the outermost container under the cursor; each
further click drills one level in (container → block → text). **Double-click** jumps straight
into text editing. **Esc** steps back out one level.

**Move, duplicate, delete.** Drag to move; **⌘D** duplicates; **Delete** removes the selection;
arrow keys nudge. Group blocks with **⌘G** (ungroup **⌘⇧G**).

**A block's full list of actions — two ways in.** Right-click the block on the canvas, or click the
**⋯** beside the breadcrumb at the top of the Inspector. Both open the same list: Duplicate, Copy,
Copy style, Move up / down, Save as component, Clear content, Delete, plus the variant and software
version show/hide toggles. The list ends with **Block settings**, which takes you back into the
Inspector on that block.

**Text properties show what the text is actually set to.** With text selected, the Inspector's
**Type** section reads out the font, size, weight, line height and colour that apply right now,
even where you haven't set them yourself. A value you haven't set is greyed and the label says
where it comes from — **Theme** for the course's own styling, or the name of the text style the
block references. Set your own and the label swaps for a dot and a **Reset**, whose tooltip tells
you what Reset puts back. The section header counts them ("2 overridden") so you can see at a
glance how far a block has drifted from the theme.

The colour swatch paints the colour that applies, greyed with a small dot when it's inherited. A
chequerboard swatch means genuinely no colour — an empty fill or stroke — and never appears on
text.

> **Tip.** An unfilled image or interaction placeholder glows neon-pink on the canvas so you
> never miss a slot. It's an authoring cue only — it never shows in preview or the export.

---
