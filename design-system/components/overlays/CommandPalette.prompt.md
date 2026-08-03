**CommandPalette** — the one find-anything index, opened with ⌘K. See `readme.md`, "The UI
spine" (keyboard contract). It is navigation, not a seventh presentation.

```jsx
<CommandPalette
  value={q} onChange={setQ} onClose={close} onRun={run}
  placeholder="Find a setting, an action, a page or a guide section…"
  results={[
    { kind: "action",  label: "Preview in Demo mode", sub: "Output" },
    { kind: "setting", label: "Motion", sub: "Project settings", keywords: ["confetti", "animation"] },
    { kind: "guide",   label: "Theming & design", sub: "User guide" },
    { kind: "page",    label: "Getting started", sub: "Page" },
  ]} />
```

Rules:

- **One index, four sources.** Settings sections, actions, guide sections and the open
  document's pages and blocks. If a thing is findable at all, it is findable here.
- **No other surface owns a search box.** Three fields over three indexes was the divergence
  this removes: the question people actually ask ("where is the disclaimer setting and how does
  it work?") needed two of them. A contents list (a TOC, an outliner) is navigation and stays.
- **Every result names its category.** "Motion — Project settings", not a bare "Motion".
  Choosing a result is never a leap of faith.
- **Intent words, not synonyms.** A section is indexed by what authors want, not only by what it
  is called: a disclaimer lives under Header & Footer, confetti under Motion, the nav pill under
  Learner nav. Names that are not guessable from intent are the reason the index exists.
- **A result routes, it does not act in place.** The palette closes, then a setting opens the
  sheet at its named section (expanded), a guide section opens the guide at that heading, a page
  or block selects on the canvas. The palette never becomes a place to change a value.
- **Ranking is by the strongest reason.** A label prefix beats a word start, beats a mid-label
  hit, beats an intent word. Every whitespace-separated token must match somewhere, so a second
  word narrows rather than widens. Kind is a tie-break only and never beats a better text match.
- **A shortlist, not a list.** Cap the results. Before you type, the palette shows the actions —
  something useful, not everything.
- **Transient.** Esc (topmost layer only, LIFO) and a click outside dismiss it; focus returns to
  whatever opened it. It may take a scrim because it captures typing — the settings surfaces may
  not, because the canvas has to stay live beside them.
