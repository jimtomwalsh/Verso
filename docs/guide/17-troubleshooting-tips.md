## 17. Troubleshooting & tips

- **Your course lives in this browser.** Export a JSON backup regularly, and before clearing
  browser data or switching machines.
- **Images won't stick after a reload?** The app keeps media in the browser's IndexedDB store,
  and some ways of opening it — a raw `file://` path, or a locked-down private window — switch
  that store off. Open the served app at `http://localhost:8123` or the Verso app instead. You'll
  see a storage warning at the top when you're in one of those places.
- **Reset Workspace** clears every open tab and restores the sample course. It clears whichever
  store you're actually on, so on a shared server it's your workspace it resets, not just this
  browser. If it can't, it says so and changes nothing.
- **Neon-pink block?** That's an unfilled image or interaction placeholder — an authoring cue
  only. It never appears in preview or the export.
- **Something looks wrong on the canvas?** Check **Demo** — it runs the real learner runtime, so
  it's the source of truth.
- **Reduce motion is respected.** Every fade and animation is disabled for learners who prefer
  reduced motion.
- **Air-gap rule.** Anything a learner sees is embedded, never fetched at runtime. You can be
  online while authoring; the shipped course sends nothing out.

---
