// editor/inspector/dispatch.js -- which panel the right inspector shows, and what runs after it
// (arch-P3-04).
//
// The inspector is the editor's highest-churn surface: nearly every feature that touches authoring
// adds a control to it, and the panel that gets shown was decided by a nine-line if/else chain
// whose ORDER carried the whole precedence rule. Comment mode beats interact mode beats a
// multi-selection beats the selection type. Nothing said so; you had to read the chain and notice
// that the early returns were doing the work.
//
// Each early return also decided -- silently, by falling out before the rest of the function --
// which of the six fixed post-render steps ran. The full path ran all six. A multi-selection ran
// one of them plus a step of its own. Comment and interact mode ran none. Nobody wrote that down;
// it is what "return early" happens to mean. The scroll-edge shading is the one that would have
// shown: three panels never called it, and the only reason it is not visibly stale is that
// wireScrollEdges also installs a MutationObserver that re-measures on any subtree change. A
// coincidence, holding up a contract.
//
// So the chain is a TABLE. Precedence is the row order, and the post-render steps each panel gets
// are a list on the row -- readable side by side, and testable without a browser. A new panel is a
// new row, which is what P4 needs when block inspectors start declaring their own.
//
// The table names steps; editor.js owns the functions. A ratchet in tests/run.js fails a step name
// with no implementation, so the two cannot drift apart.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // The six fixed steps a fully-rendered element/page/document panel gets, in order.
  //   variantOverrides  the per-variant text section, when the doc has variants
  //   layoutBar         the Edit-layout affordance, when this panel has reorderable sections
  //   settingsPanes     keeps the settings modal in sync when an in-modal control re-rendered
  //   versionGuard      disables non-persisting block controls while editing a software version
  //   tourBoard         mirrors the edit onto the tour board when it is open
  //   scrollEdges       the panel's top/bottom scroll shading
  var FULL = ["variantOverrides", "layoutBar", "settingsPanes", "versionGuard", "tourBoard", "scrollEdges"];

  // First match wins, so this order IS the precedence rule.
  var INSPECTORS = [
    // kit.html owns #inspector as a static gallery; an internal re-render must not wipe it.
    { key: "kit", render: null, after: [], when: function (s) { return !!s.kitMode; } },
    // §12: in comment mode the panel IS the comment list, whatever is selected.
    { key: "comment", render: "renderCommentList", after: ["scrollEdges"], when: function (s) { return !!s.commentMode; } },
    { key: "interact", render: "renderInteractInspector", after: ["scrollEdges"], when: function (s) { return !!s.interactMode; } },
    // Two or more selected shows the batch panel regardless of the single selection's type.
    { key: "multi", render: "renderMultiInspector", after: ["variantOverrides", "multiToolbar", "scrollEdges"],
      when: function (s) { return s.multiSelCount >= 2; } },
    { key: "instance", render: "renderInstanceInspector", after: FULL, when: function (s) { return s.selectionType === "instance"; } },
    { key: "field", render: "renderFieldInspector", after: FULL, when: function (s) { return s.selectionType === "field"; } },
    // The embed panel is two-level (a content shell around the embed's own inspector), so the row
    // names the shell rather than the inner renderer.
    { key: "embed", render: "renderEmbedPanel", after: FULL, when: function (s) { return s.selectionType === "embed"; } },
    { key: "navButton", render: "renderNavButtonInspector", after: FULL, when: function (s) { return s.selectionType === "navButton"; } },
    { key: "page", render: "renderPageInspector", after: FULL, when: function (s) { return s.selectionType === "page"; } },
    { key: "block", render: "renderBlockInspector", after: FULL, when: function (s) { return s.selectionType === "block"; } },
    // Nothing selected: the document/canvas panel. The last row matches everything, so an
    // unknown selection type lands here rather than leaving the panel blank.
    { key: "document", render: "renderDocumentInspector", after: FULL, when: function () { return true; } }
  ];

  // state = { kitMode, commentMode, interactMode, multiSelCount, selectionType }
  function pick(state) {
    var s = state || {};
    if (typeof s.multiSelCount !== "number") s.multiSelCount = 0;
    for (var i = 0; i < INSPECTORS.length; i++) if (INSPECTORS[i].when(s)) return INSPECTORS[i];
    return INSPECTORS[INSPECTORS.length - 1];
  }
  // Every step name any row can ask for -- the set editor.js has to implement.
  function steps() {
    var seen = {};
    INSPECTORS.forEach(function (r) { r.after.forEach(function (n) { seen[n] = 1; }); });
    return Object.keys(seen).sort();
  }

  var VersoInspector = {
    FULL: FULL,
    INSPECTORS: INSPECTORS,
    pick: pick,
    steps: steps
  };

  window.VersoInspector = VersoInspector;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoInspector;
})();
