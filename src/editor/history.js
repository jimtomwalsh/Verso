// editor/history.js -- undo, redo, and the rule that a document swap moves everything at once
// (arch-P3-02).
//
// Undo is not a stack of edits here. It is a stack of whole-document snapshots, and every
// restore REPLACES the object the entire editor is holding. That makes the interesting part of
// this module the swap, not the stack: `doc` (what every editor surface has a reference to) and
// `registry[activeDocId]` (what the next save persists) are two names for one document, and any
// path that replaces one without the other leaves the editor editing an object the registry will
// never write. That class of bug has bitten this codebase repeatedly -- a tour-builder session
// edited an orphaned doc and lost the lot; undo/redo left the registry holding the pre-undo doc
// so the next save shipped it (#50).
//
// So the module owns the stacks and the SEQUENCE, and the caller owns the single pair-write it
// is handed. One env callback, `applyDoc(next, changed)`, is the only way a snapshot reaches the
// editor. There is no path through here that touches one half of the pair.
//
// THE OTHER HALF OF THE RULE: reset(). A history stack belongs to ONE document. Switch tabs, or
// close the active tab, and a snapshot of the outgoing course is still sitting on the stack --
// press Ctrl+Z and it is restored INTO the incoming course, overwriting it in memory and in the
// registry. closeDoc was doing exactly that. Every document swap now resets history, and the
// suite pins it.
//
// `changed` is the repaint hint, not a correctness matter: a list of page indices when the two
// snapshots differ only inside pages (rebuild those), or null when they do not (full mount).
// Undoing one word in a 60-page course with embedded interactions should not re-create every
// iframe, which is where the Ctrl+Z lag came from.
//
// DOM-free and dependency-free, so the stack semantics, the cap, redo invalidation, the
// focus-episode rule and the swap contract are all exercised headlessly.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  var MAX_HISTORY = 50;

  // Which page indices differ between two doc snapshots -- or null when the change is not
  // page-isolatable (page count/order/id changed, or a doc-level field like chapters / theme /
  // headerFooter / variants differs), meaning a full mount is needed. Pure.
  function isolatedPageChanges(prev, next) {
    if (!prev || !next) return null;
    var pp = prev.pages || [], np = next.pages || [];
    if (pp.length !== np.length) return null;
    for (var i = 0; i < pp.length; i++) if ((pp[i] && pp[i].id) !== (np[i] && np[i].id)) return null;
    function shell(d) { var o = {}; Object.keys(d).forEach(function (k) { if (k !== "pages") o[k] = d[k]; }); return JSON.stringify(o); }
    if (shell(prev) !== shell(next)) return null; // a doc-level field changed -> full rebuild
    var changed = [];
    for (var j = 0; j < pp.length; j++) if (JSON.stringify(pp[j]) !== JSON.stringify(np[j])) changed.push(j);
    return changed;
  }

  // env = {
  //   getDoc()               the live document
  //   applyDoc(next, changed) the caller's ONE pair-write + repaint. Required.
  //   canIsolate()           false while a variant/version preview is on screen (it renders
  //                          resolved clones, so a per-page rebuild would repaint the wrong thing)
  //   onChange()             after anything moves -- the undo/redo button state
  //   clone(o)               defaults to a JSON round-trip
  //   max                    stack cap, defaults to 50
  // }
  function createHistory(env) {
    env = env || {};
    var applyDoc = env.applyDoc || function () {};
    var getDoc = env.getDoc || function () { return null; };
    var canIsolate = env.canIsolate || function () { return true; };
    var onChange = env.onChange || function () {};
    var clone = env.clone || function (o) { return JSON.parse(JSON.stringify(o)); };
    var max = env.max || MAX_HISTORY;

    var undoStack = [];
    var redoStack = [];
    // One undo step per typing burst, not one per keystroke. The canvas calls beginEpisode() on
    // focus and pushOnce() on every input; the first input in an episode snapshots, the rest ride
    // on it. Without this a paragraph is 200 undo steps and the 50-deep cap is a single sentence.
    var pushedThisEpisode = false;

    // Snapshot the current document. Any new edit invalidates the redo branch.
    function push() {
      var d = getDoc();
      if (d == null) return false; // kit gallery / pre-boot: nothing to snapshot
      undoStack.push(clone(d));
      if (undoStack.length > max) undoStack.shift();
      redoStack = [];
      onChange();
      return true;
    }
    function beginEpisode() { pushedThisEpisode = false; }
    function pushOnce() {
      if (pushedThisEpisode) return false;
      pushedThisEpisode = true;
      return push();
    }

    // The one restore path. Snapshot the current doc onto the opposite stack, then hand the
    // popped one to the caller together with the repaint hint.
    function restore(from, to) {
      if (!from.length) return false;
      var prev = getDoc();
      to.push(clone(prev));
      var next = from.pop();
      applyDoc(next, canIsolate() ? isolatedPageChanges(prev, next) : null);
      onChange();
      return true;
    }
    function undo() { return restore(undoStack, redoStack); }
    function redo() { return restore(redoStack, undoStack); }

    // A history stack belongs to one document. Every swap of the active document drops it, so a
    // snapshot of the outgoing course can never be restored into the incoming one.
    function reset() {
      undoStack = [];
      redoStack = [];
      pushedThisEpisode = false;
      onChange();
    }

    return {
      push: push,
      pushOnce: pushOnce,
      beginEpisode: beginEpisode,
      undo: undo,
      redo: redo,
      reset: reset,
      canUndo: function () { return undoStack.length > 0; },
      canRedo: function () { return redoStack.length > 0; },
      depth: function () { return { undo: undoStack.length, redo: redoStack.length }; }
    };
  }

  var VersoHistory = {
    MAX_HISTORY: MAX_HISTORY,
    isolatedPageChanges: isolatedPageChanges,
    create: createHistory
  };

  window.VersoHistory = VersoHistory;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoHistory;
})();
