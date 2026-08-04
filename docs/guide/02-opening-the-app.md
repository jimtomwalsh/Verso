## 2. Opening the app

Verso is a plain web app — nothing to install.

- **Desktop app:** launch it. It wraps the same app in a window.
- **Browser:** open `index.html`. For export and fonts to work, serve the folder over `http://`
  rather than `file://`:
  ```
  cd "…/verso"
  python3 -m http.server 8123      # or: ./serve.command
  ```
  Then visit `http://localhost:8123/index.html`.

Your work **saves automatically to this browser** (IndexedDB) as you go; the **All changes
saved** status in the top bar confirms it.

**Create a document.** The **＋** beside the tabs opens **New document**: pick a **Product**
(defaults to the one you're scoped to), a **preset** — the starting matrix cell (eLearning,
Presentation, 1-pager, Quick-start guide, Responsive doc), each shown as *geometry · interactive
or static* — then a **title** and **code**. The document is born in that Product and that cell;
you can change the cell later. The same dialog also opens a saved course, imports a document, or
loads a sample.

**Change the document type later.** The **cell chip** in the editor header (e.g. *Reflow ·
Interactive*) opens a small menu to change the document's matrix cell after creation. Toggling
**Interactive / Static** applies at once; switching the **geometry** (Reflow / Fixed frame /
Paged) warns first, because content reflows into the new geometry and may not survive 1:1 — you
can switch back. In a **Static** document the interactive block types (Quiz, Image hotspots,
Web/HTML Embed, Accordion, Card Reveal, and the rest) are hidden from the Blocks library; any
interactive blocks you already placed are kept, and turning interactivity back on restores them.

> **Note.** Your course lives only in this browser. Export a **JSON** backup regularly and
> before clearing browser data or switching machines (§15).

---
