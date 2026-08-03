// editor/selection.js -- what is selected, and how a click gets there (arch-P3-07).
//
// Two rules live here, and both were spread across a thousand lines of canvas handlers.
//
// THE SHAPE. `selection` is one object with five slots -- block, field, instance, pageIndex, plus
// the node itself -- and which slots are filled depends on the type. A field selection carries the
// block AND the field; an instance carries the instance AND its host block; a page carries an
// INDEX, not a node, which is why every guard here tests `!= null` rather than truthiness: page 0
// is a real page, and a truthiness test collapses it to null and takes the page inspector down
// with it (doc.pages[null].id).
//
// THE DRILL. Clicking the canvas resolves a chain of selectable levels at that point, outermost to
// innermost, and selects the LEAF -- the thing actually under the cursor. Escape then steps
// OUTWARD along the same chain, so the way back up is the way you came down. The rules that make
// that work are small and were entirely implicit:
//   · the leaf is the deepest NON-edit level. An "edit" level is the text caret, and a single
//     click should select the element, not drop a caret into it;
//   · ...unless the edit level belongs to a DIFFERENT node than the one below it, in which case
//     there is a real element between them and the deeper level wins;
//   · any selection that did not come from the drill restarts the chain, so the next canvas click
//     re-drills from the top rather than resuming someone else's descent;
//   · entering a block's Content level ends the moment a different block is selected.
//
// Pure: the DOM reads are injected, so the whole model runs on plain objects in node.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // Block types with a Content level you can ENTER (double-click, or "Edit contents"). Text blocks
  // edit inline through their own dblclick, so they are not here.
  var TWO_LEVEL_TYPES = {
    hotspot: 1, sequence: 1, frame: 1, group: 1, image: 1, accordion: 1, quiz: 1, cardReveal: 1,
    cardDeck: 1, htmlEmbed: 1, webEmbed: 1, spacer: 1, divider: 1, columns: 1, componentGrid: 1,
    checkbox: 1, libraryInstance: 1
  };
  function canEnterContent(type) { return !!TWO_LEVEL_TYPES[type]; }

  // The selection types that mark their node as the selected card in the canvas.
  var CARD_TYPES = { instance: 1, embed: 1, navButton: 1, block: 1, field: 1 };
  function marksCard(type) { return !!CARD_TYPES[type]; }

  // How the shape is read off a DOM node. Overridden in tests with plain objects.
  var DOM_READ = {
    block: function (n) { return n && n.__block; },
    bindObj: function (n) { return n && n.__bind && n.__bind.obj; },
    instance: function (n) { return n && n.__instance; },
    field: function (n) { return n && n.getAttribute && n.getAttribute("data-edit"); }
  };

  // type + node -> the full selection object. `node` is a DOM node for element selections and a
  // page INDEX for a "page" selection.
  function shape(type, node, read) {
    var r = read || DOM_READ;
    var sel = { type: type, node: node != null ? node : null, block: null, field: null, instance: null, pageIndex: -1 };
    if (node == null) return sel;
    if (type === "block" || type === "embed") {
      sel.block = r.block(node) || null;
    } else if (type === "field") {
      sel.block = r.block(node) || r.bindObj(node) || null;
      sel.field = r.field(node) || null;
    } else if (type === "instance") {
      sel.instance = r.instance(node) || null;
      sel.block = r.block(node) || null;
    } else if (type === "page") {
      sel.pageIndex = node;
    }
    return sel;
  }
  var NONE = function () { return shape("none", null); };

  // Selecting anything that is not the entered block leaves its Content level.
  function exitsEnteredBlock(entered, nextBlock) { return !!entered && nextBlock !== entered; }

  // ---- the drill chain -----------------------------------------------------
  function emptyDrill() { return { levels: null, index: -1 }; }
  // The deepest NON-edit level. Step back over the innermost element's OWN caret ("edit") level to
  // its block/field select-level, but NEVER past it into an ancestor: an element whose ONLY level
  // is editable (navButton, whose block tier is suppressed) must still select ITSELF, not the
  // container it sits in. The comparison is against the LEAF's node throughout, not against each
  // neighbour, which is what stops the walk at the first level belonging to something else.
  function leafSelectIndex(levels) {
    var ls = levels || [];
    if (!ls.length) return -1;
    var leafNode = ls[ls.length - 1].node;
    var i = ls.length - 1;
    while (i > 0 && ls[i].kind === "edit" && ls[i - 1].node === leafNode) i--;
    return i;
  }
  // Escape steps outward. Returns the new index, or null when there is nowhere left to go (the
  // caller deselects instead of sitting at the top of a chain).
  function escapeStep(drill) {
    if (!drill || !drill.levels || !(drill.index > 0)) return null;
    return drill.index - 1;
  }
  // A re-render lands on the same chain: if the current level is the trailing caret step, back off
  // it so the element -- not the caret -- is what stays selected.
  function settleAfterRerender(drill) {
    if (!drill || !drill.levels) return drill ? drill.index : -1;
    var last = drill.levels.length - 1;
    if (drill.index === last && drill.levels[last] && drill.levels[last].kind === "edit") return drill.index - 1;
    return drill.index;
  }
  // Any selection that is not the drill applying a level restarts the chain.
  function resetsDrill(applyingDrill) { return !applyingDrill; }

  var VersoSelection = {
    TWO_LEVEL_TYPES: TWO_LEVEL_TYPES,
    CARD_TYPES: CARD_TYPES,
    DOM_READ: DOM_READ,
    canEnterContent: canEnterContent,
    marksCard: marksCard,
    shape: shape,
    none: NONE,
    exitsEnteredBlock: exitsEnteredBlock,
    emptyDrill: emptyDrill,
    leafSelectIndex: leafSelectIndex,
    escapeStep: escapeStep,
    settleAfterRerender: settleAfterRerender,
    resetsDrill: resetsDrill
  };

  window.VersoSelection = VersoSelection;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoSelection;
})();
