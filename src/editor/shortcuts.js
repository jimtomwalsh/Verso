// editor/shortcuts.js -- one place that says what every key does (arch-P3b-07).
//
// A single global keydown, and the reason it is worth its own file is that a keyboard map read in
// one piece is the only way to see the whole contract: which keys are taken, which are modified,
// and which surface owns each one.
//
// THREE RULES RUN THROUGH IT.
//
// A key that means something while typing means nothing here -- isTextTarget guards every branch
// that could steal a character from a field, which is why Delete only deletes a block when the
// caret is not in text.
//
// ESCAPE UNWINDS, one step at a time: an open comment popover first, then comment mode, then a
// multi-selection, then one level of the drill, then the selection itself. Anything that swallows
// Escape whole makes the next surface unreachable.
//
// A MODE OWNS ITS KEYS. Comment mode and the preview each claim C for themselves, and the drill
// claims Escape and the arrows while it is active, so the map defers rather than competing.
//
// Almost everything it needs is a VERB somewhere else -- undo, zoom, paste, the palette. That is
// what a keyboard map is: forty references and no logic of its own.
//
// Editor chrome only.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "SEL", "isTextTarget", "redo", "fitAll", "setCommentMode", "commentModeOn",
      "togglePerfHud", "canvas", "openFindReplace", "ungroupBlock", "groupMulti", "undo",
      "zoomIn", "zoomOut", "enterTextEdit", "selectAllOnPage", "duplicateSelection", "copySelection",
      "pasteClipboard", "enterDemo", "openSelectionSettings", "openSettingsModal", "openQuickJump", "togglePanels",
      "zoomTo100", "moveBlock", "fitSelection", "demoIsOpen", "openCommentIdNow", "closeCommentPopover",
      "renderCommentPins", "clearAllMulti", "renderStructure", "refreshCanvasSelection", "twoStateText", "applyDrillLevel",
      "clearSelection", "deleteSelection", "selection", "drill", "multiSel", "spaceHeld",
      "multiSelPages",
      "setSpaceHeld"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var SEL = E.SEL,
        isTextTarget = E.isTextTarget,
        redo = E.redo,
        fitAll = E.fitAll,
        setCommentMode = E.setCommentMode,
        commentModeOn = E.commentModeOn,
        togglePerfHud = E.togglePerfHud,
        canvas = E.canvas,
        openFindReplace = E.openFindReplace,
        ungroupBlock = E.ungroupBlock,
        groupMulti = E.groupMulti,
        undo = E.undo,
        zoomIn = E.zoomIn,
        zoomOut = E.zoomOut,
        enterTextEdit = E.enterTextEdit,
        selectAllOnPage = E.selectAllOnPage,
        duplicateSelection = E.duplicateSelection,
        copySelection = E.copySelection,
        pasteClipboard = E.pasteClipboard,
        enterDemo = E.enterDemo,
        openSelectionSettings = E.openSelectionSettings,
        openSettingsModal = E.openSettingsModal,
        openQuickJump = E.openQuickJump,
        togglePanels = E.togglePanels,
        zoomTo100 = E.zoomTo100,
        moveBlock = E.moveBlock,
        fitSelection = E.fitSelection,
        demoIsOpen = E.demoIsOpen,
        openCommentIdNow = E.openCommentIdNow,
        closeCommentPopover = E.closeCommentPopover,
        renderCommentPins = E.renderCommentPins,
        clearAllMulti = E.clearAllMulti,
        renderStructure = E.renderStructure,
        refreshCanvasSelection = E.refreshCanvasSelection,
        twoStateText = E.twoStateText,
        applyDrillLevel = E.applyDrillLevel,
        clearSelection = E.clearSelection,
        deleteSelection = E.deleteSelection;

    window.addEventListener("keydown", function (e) {
      // Perf HUD toggle. Match on e.code (physical key) so macOS Option-mangled characters
      // (Option+Shift+P types a special char, breaking an e.key match) never break it.
      // Cmd/Ctrl+Shift+F (F = FPS) is the primary; Option+Shift+P kept as a fallback.
      if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyF") ||
          (e.altKey && e.shiftKey && e.code === "KeyP")) { e.preventDefault(); togglePerfHud(); return; }
      if (e.code === "Space" && !isTextTarget(e.target)) { E.setSpaceHeld(true); canvas.classList.add("is-pannable"); e.preventDefault(); }

      var isZ = e.key === "z" || e.key === "Z";
      var isY = e.key === "y" || e.key === "Y";
      var meta = e.metaKey || e.ctrlKey;
      if (meta && !e.shiftKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); openFindReplace(); return; } // Cmd/Ctrl+F = find & replace
      if (meta && e.shiftKey && (e.key === "g" || e.key === "G") && !isTextTarget(e.target) &&
          E.selection.type === "block" && E.selection.block && E.selection.block.type === "group") {
        e.preventDefault(); ungroupBlock(E.selection.block); return; // Cmd+Shift+G = ungroup
      }
      if (meta && (e.key === "g" || e.key === "G") && E.multiSel.length >= 2 && !isTextTarget(e.target)) {
        e.preventDefault(); groupMulti(); return;
      }
      if (meta && isZ) {
        e.preventDefault();
        if (document.activeElement && isTextTarget(document.activeElement)) {
          document.activeElement.blur();
        }
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (meta && isY) {
        e.preventDefault();
        if (document.activeElement && isTextTarget(document.activeElement)) {
          document.activeElement.blur();
        }
        redo();
      } else if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomIn();
      } else if (meta && e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (meta && e.key === "0") {
        e.preventDefault();
        fitAll();
      } else if (meta && (e.key === "a" || e.key === "A") && !isTextTarget(e.target)) {
        e.preventDefault();
        // Select-first mode: a SELECTED (not-editing) text field -> enter edit + select ALL
        // its text (what you expect in a box), NOT select-all-blocks. Default mode keeps the
        // text contenteditable so isTextTarget already routes Cmd+A to the native select-all.
        if (E.selection.type === "field" && E.selection.node && E.selection.node.getAttribute("data-edit") != null && E.selection.node.getAttribute("contenteditable") !== "true") {
          enterTextEdit(E.selection.node);
          try { var r = document.createRange(); r.selectNodeContents(E.selection.node); var sa = window.getSelection(); sa.removeAllRanges(); sa.addRange(r); } catch (_) {}
        } else {
          selectAllOnPage();
        }
      } else if (meta && (e.key === "d" || e.key === "D") && !isTextTarget(e.target)) {
        e.preventDefault(); duplicateSelection();
      } else if (meta && (e.key === "c" || e.key === "C") && !isTextTarget(e.target)) {
        if (copySelection()) e.preventDefault();
      } else if (meta && (e.key === "v" || e.key === "V") && !isTextTarget(e.target)) {
        // Cmd+V pastes as-is; Cmd+Shift+V pastes WITHOUT formatting (inherits theme/target).
        if (pasteClipboard(e.shiftKey)) e.preventDefault();
      } else if (meta && (e.key === "p" || e.key === "P") && !isTextTarget(e.target)) {
        e.preventDefault(); enterDemo(); // Cmd+P = open preview
      } else if (meta && e.key === ",") {
        // uio-F06 keyboard contract. Cmd-, opens Settings where you left it; Alt+Cmd-, opens the
        // settings for what is selected -- which IS the inspector, since the inspector holds the
        // sheet's Block scope. So the modified form puts the sheet away and hands the dock back.
        e.preventDefault();
        if (e.altKey) openSelectionSettings(); else openSettingsModal();
      } else if (meta && (e.key === "k" || e.key === "K") && !isTextTarget(e.target)) {
        e.preventDefault(); openQuickJump(); // the one index: settings, actions, guide, pages, blocks
      } else if (meta && e.key === "\\" && !isTextTarget(e.target)) {
        e.preventDefault(); togglePanels(); // Cmd+\ = hide/show side panels (maximise canvas)
      } else if (meta && e.code === "Digit1") {
        e.preventDefault(); zoomTo100();
      } else if (!meta && e.shiftKey && e.code === "Digit1" && !isTextTarget(e.target)) {
        e.preventDefault(); fitAll();
      } else if (!meta && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !isTextTarget(e.target) &&
                 E.selection.block && (E.selection.type === "block" || E.selection.type === "field" || E.selection.type === "embed" || E.selection.type === "navButton")) {
        e.preventDefault(); moveBlock(E.selection.block, e.key === "ArrowUp" ? -1 : 1);
      } else if (e.key === "." && !meta && !isTextTarget(e.target)) {
        e.preventDefault();
        fitSelection();
      } else if ((e.key === "c" || e.key === "C") && !meta && !e.shiftKey && !isTextTarget(e.target) && !demoIsOpen()) {
        e.preventDefault();
        setCommentMode(!commentModeOn()); // §12: toggle canvas comment mode (demo has its own C)
      } else if (e.key === "Escape" && !isTextTarget(e.target)) {
        // §12: Escape first closes an open comment popover, then exits comment mode.
        if (commentModeOn()) { if (openCommentIdNow()) { closeCommentPopover(); renderCommentPins(); } else setCommentMode(false); return; }
        if (E.multiSel.length || E.multiSelPages.length) { clearAllMulti(); renderStructure(); refreshCanvasSelection(); }
        else if (twoStateText() && SEL.escapeStep(E.drill) != null) {
          // §74 rule 3: Escape steps OUT one drill level (block -> columns -> ... ),
          // clearing only after the outermost level.
          E.drill.index = SEL.escapeStep(E.drill); applyDrillLevel(E.drill.levels[E.drill.index]);
        }
        else clearSelection();
      } else if ((e.key === "Delete" || e.key === "Backspace") && (!isTextTarget(e.target) || E.multiSel.length)) {
        if (deleteSelection()) e.preventDefault();
      }
    });

    kernel.expose({

    });
  }

  window.VersoShortcuts = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoShortcuts;
})();
