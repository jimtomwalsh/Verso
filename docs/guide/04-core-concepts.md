## 4. Core concepts

Four ideas cover most of how Verso works.

![Chapters (1) contain pages (2) in the Structure outliner.](docs/assets/annotated-structure.webp "A chapter (1) holds pages (2); the learner moves page to page.")

- **A document is one course**, held in this browser and shown as a tab.
- **Chapters → pages → blocks.** A course is chapters; each chapter holds pages; each page is
  built from blocks. The learner moves page to page, and chapters drive the navigation and
  progress bar.
- **Some blocks are containers.** A **Card**, **Columns**, **Card Reveal**, or **Accordion**
  holds child blocks inside it.
- **The Inspector mirrors your selection.** Select nothing for document-wide settings (theme,
  fonts, header/footer); select a block for that block's settings. Editing a text block shows its
  Type controls and its layout, spacing and appearance settings together in one scrolling panel.

### Sections

Every group of settings — in the inspector, in the settings sheet, in a dialog — is a **section**:
a title with a chevron, sometimes a switch, and rows underneath. Click the title to fold it; folded,
it states what it will do in one line ("On · centred, bottom rule"), so a closed section never reads
as unknown. The chevron and the switch are independent: turning a section off dims its rows but
keeps them there and usable, so you can set something up before you switch it on.

Sections nest **one** level deep at most, and a nested one looks the same, just quieter and
indented. There is no third level and no other kind of heading, so anything with a chevron opens
and anything without one is an ordinary row.

The **Header** and **Footer** settings are two sections of their own (they used to be nested inside
one "Header & Footer"), and with a nav bar in place each learner-nav group — **Nav buttons**,
**Progress pill**, **Progression**, **Nav sections**, **Guided tour** — is its own section too. ⌘K
still finds any of them by what you want rather than by their names: "disclaimer" finds Footer,
"logo" finds Header, "pill" finds Progress pill.

### Inherited and overridden settings

Many settings are set once high up and followed everywhere below. Verso reads them down five
levels: **System → Product → Course → Page → Block.** The nearest level that sets a value wins.

A setting never shows as blank or "unset". It always shows the value that will actually apply,
plus a small note at the end of the row telling you where that value came from:

- **A grey scope name — "Course", "System".** The value is inherited. Change it at that level and
  every page or block following it changes with it.
- **A blue dot and a Reset link.** This one is set here, so it no longer follows its parent. Hover
  **Reset** to see exactly what it would go back to and from which level. Clicking Reset applies
  straight away — there is nothing to save, and ⌘Z undoes it like any other edit.
- **A count in the section header — "3 overridden".** That section has three values set here
  rather than inherited. It is the quick way to spot a block or page that has drifted from the
  course.

### Classification

Classification says who may read a piece of content and whether it may leave your organisation at
all. It follows the same five levels as everything else, so you set it once on a **Product** and
every document, page and block under it inherits.

Set it in the **Classification** section — on the Product panel, or on a document, page or block
in the Inspector. The section is folded by default, because most content simply inherits; a blue
dot on the header tells you when something below has been classified in its own right.

Under the picker Verso states what the level actually means: whether it may leave the
organisation, who may read it internally, and whether it needs sign-off before release.

**You can tighten, never loosen.** A block inside a document classified as Internal may be made
Restricted, but it cannot be made Open — the picker does not offer the looser levels, and a
looser value would not apply even if one arrived from an import. **Reset** puts a block back to
whatever it inherits.

Your levels are set up for your organisation. Verso ships three neutral ones — Open, Internal and
Restricted — until yours replace them.

> **Note.** Classification is the label. Acting on it when you publish — holding a Restricted
> block out of a package that goes outside — is not built yet.

---
