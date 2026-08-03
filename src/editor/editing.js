// editor/editing.js -- making the canvas typeable (arch-P3b-07n).
//
// Every frame's content is rendered by render.js, which knows nothing about editing. This file is
// what turns that output into something an author can type into: contentEditable on the fields
// that carry copy, the drop targets, the column resizers and edge bands, the image drop, the
// embed shield.
//
// THE INVARIANT IT PROTECTS: nothing here may leak into render(). Everything it adds is either an
// attribute the export strips or a listener that never existed in the package -- which is why the
// editor and the export can render from the same function and still behave differently.
//
// TWO-STATE TEXT is the rule underneath the field wiring. A block is SELECTED first and editable
// second, so a single click never drops a caret into copy the author only meant to point at. The
// second click, or a double-click, enters the text.
//
// The collaboration hooks live on the same lifecycle: focus takes a soft lock, an edit fans out
// debounced, the caret is shared as it moves, and blur releases. Every one of them is a no-op
// when no server is present, which is the standalone case and the common one.
//
// An embed gets a transparent SHIELD rather than pointer-events:none, because an iframe that
// cannot be clicked also cannot be selected -- the shield takes the click and hands it to the
// selection, and a double-click passes it through to the interaction underneath.
//
// Editor chrome only, in the strictest sense: this is the file the pure-render invariant is about.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "SEL", "collabChrome", "setSelection", "writeModel", "History", "scheduleSpellcheck",
      "caretInList", "flushSave", "setDragPayload", "h", "updateDragAffordance", "wireHotspotNode",
      "pageIndexById", "attachColumnsEdgeBands", "attachColumnResizers", "attachColumnSwaps", "attachEmptyColumnDrops", "makeDropTarget",
      "attachImageFileDrop", "selectByType", "clearDropMarks", "isTextTarget", "wireItemBodyDrops", "panelFields",
      "drill", "applyingDrill"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var SEL = E.SEL,
        collabChrome = E.collabChrome,
        setSelection = E.setSelection,
        writeModel = E.writeModel,
        History = E.History,
        scheduleSpellcheck = E.scheduleSpellcheck,
        caretInList = E.caretInList,
        flushSave = E.flushSave,
        setDragPayload = E.setDragPayload,
        h = E.h,
        updateDragAffordance = E.updateDragAffordance,
        wireHotspotNode = E.wireHotspotNode,
        pageIndexById = E.pageIndexById,
        attachColumnsEdgeBands = E.attachColumnsEdgeBands,
        attachColumnResizers = E.attachColumnResizers,
        attachColumnSwaps = E.attachColumnSwaps,
        attachEmptyColumnDrops = E.attachEmptyColumnDrops,
        makeDropTarget = E.makeDropTarget,
        attachImageFileDrop = E.attachImageFileDrop,
        selectByType = E.selectByType,
        clearDropMarks = E.clearDropMarks,
        isTextTarget = E.isTextTarget,
        wireItemBodyDrops = E.wireItemBodyDrops;

    // ---- editing wiring (across all frames) ----------------------------------
    function blockLocked(node) { var b = node.closest && node.closest(".canvas-block"); return !!(b && b.__block && b.__block.locked); }
    // SSS two-state text (OPT-IN, default off = current always-editable behaviour).
    // On: a text block SELECTS on single-click (no caret) and enters edit only on
    // double-click, so drag-to-move / Delete / select behave like any other block.
    var TWO_STATE_KEY = "authoring.two-state-text";
    // §74 progressive selection is now the DEFAULT (select-first). The flag is
    // REUSED, flipped: absent OR "1" => select-first ON; only an explicit "0"
    // ("Click to edit" escape hatch) opts out. Back-compat: users who had turned
    // the old opt-in OFF stored "0" and stay click-to-edit; everyone else flips on.
    // James 2026-07-08: select-first is the only model — always on, no opt-out (the toggle was
    // removed). Hard-wired true so anyone who previously stored "0" is migrated to select-first.
    function twoStateText() { return true; }
    function setTwoStateText(on) { try { localStorage.setItem(TWO_STATE_KEY, on ? "1" : "0"); } catch (e) {} }
    // shared selection dispatch for an editable field node (instance slot / nav / field)
    function selectFieldNode(node) {
      var card = node.closest("[data-instance]");
      if (card) { setSelection("instance", card); return; }
      if (node.__block && node.__block.type === "navButton") { setSelection("navButton", node); return; }
      setSelection("field", node);
    }
    // two-state: turn a selected text node into an actively-edited one (caret at end)
    function enterTextEdit(node) {
      node.setAttribute("contenteditable", "true");
      node.classList.add("is-text-editing");
      node.focus();
      try {
        var r = document.createRange(); r.selectNodeContents(node); r.collapse(false);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      } catch (e) {}
    }
    // ticket 11/13: the top-level canvas block a field node belongs to (the sync granularity is the
    // top-level block by stable id). Used to drive collab lock/edit events off the edit lifecycle.
    function collabBlockOf(node) {
      var cb = node && node.closest && node.closest(".canvas-block");
      return (cb && cb.__block) || (node && node.__block) || null;
    }
    // ticket 11 AC2: the caret's character offset within an editable field (for a remote cursor).
    // Best-effort + guarded -> null if unavailable, so the render falls back to a block-corner flag.
    function caretOffsetIn(node) {
      try {
        var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
        var r = sel.getRangeAt(0); if (!node.contains(r.endContainer)) return null;
        var pre = document.createRange(); pre.selectNodeContents(node); pre.setEnd(r.endContainer, r.endOffset);
        return pre.toString().length;
      } catch (e) { return null; }
    }
    function enableEditing(root) {
      // locked blocks: mark them (editor.css lays a click-shield) and skip all
      // editing/selection wiring below, so they can't be moved or edited on the
      // canvas — unlock from the inspector (reachable via the Structure outliner).
      Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (n) {
        if (n.__block && n.__block.locked) { n.setAttribute("data-locked", "true"); n.style.position = "relative"; }
        // §12 slice 0: stamp the stable comment-anchor id on the node for hit-testing
        // (editor-chrome — render never emits it, so the export stays clean).
        if (n.__block && n.__block.cid) n.setAttribute("data-cid", n.__block.cid);
      });
      Array.prototype.forEach.call(root.querySelectorAll("[data-edit]"), function (node) {
        if (blockLocked(node)) return;
        // a locked card instance can't have its slot text edited inline (mirrors a
        // locked block); unlock from the inspector's Block-actions footer.
        var lockedCard = node.closest("[data-instance]");
        if (lockedCard && lockedCard.__instance && lockedCard.__instance.locked) return;
        node.classList.add("is-editable");
        node.setAttribute("spellcheck", "false");
        node.addEventListener("focus", function () { History.beginEpisode(); selectFieldNode(node); if (collabChrome()) collabChrome().onEditFocus(collabBlockOf(node)); }); // collab: implicit lock acquire on edit-intent (server mode only)
        node.addEventListener("input", function () {
          History.pushOnce(); // one undo step per typing burst, not one per keystroke
          var rich = node.getAttribute("data-rich");
          writeModel(node, rich ? node.innerHTML : node.textContent);
          scheduleSpellcheck(); // P0: re-check typos as the author types
          var key = node.getAttribute("data-edit");
          if (!rich && E.panelFields[key] && E.panelFields[key].value !== node.textContent) E.panelFields[key].value = node.textContent;
          if (collabChrome()) { collabChrome().onEditCommit(collabBlockOf(node)); collabChrome().onCaret(collabBlockOf(node), caretOffsetIn(node)); } // collab: fan the edit out (debounced) + share the caret (throttled)
        });
        node.addEventListener("keyup", function () { if (collabChrome()) collabChrome().onCaret(collabBlockOf(node), caretOffsetIn(node)); }); // collab: caret moves (arrows/click) without an edit
        node.addEventListener("blur", function () { if (collabChrome()) collabChrome().onEditBlur(collabBlockOf(node)); }); // collab: auto-release the lock on blur (server mode only)
        // Paste as PLAIN TEXT by default: the browser's default contenteditable paste
        // drags the SOURCE's rich HTML (fonts/colours/spans + even a copied canvas
        // block's editor chrome) into the field, overriding its style. Instead strip to
        // text/plain and insert it so pasted words INHERIT the target element's own
        // formatting + named styleRef. execCommand("insertText") replaces the selection
        // and fires `input`, so the normal writeModel path commits + pushes history.
        node.addEventListener("paste", function (e) {
          e.preventDefault();
          var text = "";
          try { text = (e.clipboardData || window.clipboardData).getData("text/plain"); } catch (_) {}
          if (window.__sanitizeText) text = window.__sanitizeText(text); // strip invisible/mojibake chars too
          if (!text) return;
          // Paste-clean into a bullet list: each non-empty line -> a clean <li>, stripping a
          // leading bullet char pasted from Word / Confluence / plain text.
          if (caretInList(node)) {
            var esc = function (t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
            var lines = text.split(/\r?\n/).map(function (l) {
              return l.replace(/^[\s ]*[•‣◦⁃∙▪●–—→✓*\-o]?[\s ]+/, "").replace(/\s+$/, "");
            }).filter(function (l) { return l.trim(); });
            if (lines.length) {
              document.execCommand("insertHTML", false, lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join(""));
              writeModel(node, node.innerHTML);
              return;
            }
          }
          document.execCommand("insertText", false, text);
        });
        // rich fields allow line breaks (Shift+Enter too); plain fields commit on Enter.
        // Two-state: Escape exits edit back to the selected (no-caret) state.
        node.addEventListener("keydown", function (e) {
          // Tab / Shift+Tab in a bullet list nests / un-nests the current item (execCommand
          // indent/outdent wraps it in a child <ul>); commit the new HTML to the model.
          if (e.key === "Tab" && caretInList(node)) {
            e.preventDefault();
            document.execCommand(e.shiftKey ? "outdent" : "indent");
            writeModel(node, node.innerHTML);
            return;
          }
          if (e.key === "Enter" && !node.getAttribute("data-rich")) { e.preventDefault(); node.blur(); }
          else if (e.key === "Escape" && twoStateText()) { e.preventDefault(); node.blur(); }
        });
        if (twoStateText()) {
          // SSS two-state: not editable until double-click; single-click just selects.
          node.setAttribute("contenteditable", "false");
          node.addEventListener("mousedown", function (e) {
            if (node.getAttribute("contenteditable") === "true") return; // already editing -> normal caret
            e.preventDefault(); selectFieldNode(node); // select the block WITHOUT dropping a caret
          });
          node.addEventListener("dblclick", function () { enterTextEdit(node); });
          node.addEventListener("blur", function () {
            flushSave(); node.setAttribute("contenteditable", "false"); node.classList.remove("is-text-editing");
            // §74 rule 3: exiting edit (Escape/blur, NOT a drill-driven reselect) drops
            // the drill pointer from the "edit" leaf back to the "field" level, so the
            // next Escape steps further out (edit -> block -> container).
            if (!E.applyingDrill) E.drill.index = SEL.settleAfterRerender(E.drill);
            updateDragAffordance(); // exited edit -> the selected block is draggable again
          });
        } else {
          // current behaviour: always editable, click = caret.
          node.setAttribute("contenteditable", "true");
          node.addEventListener("blur", function () { flushSave(); });
        }
      });
      Array.prototype.forEach.call(root.querySelectorAll("[data-instance]"), function (card) {
        card.addEventListener("mousedown", function (e) { if (e.target === card) setSelection("instance", card); });
      });
      // embed blocks are opaque — clicking the block (not inside its iframe) selects
      // it; content-filled iframes eat clicks, so the Structure outliner is the
      // reliable way to select those.
      Array.prototype.forEach.call(root.querySelectorAll("[data-embed]"), wireEmbedNode);
      Array.prototype.forEach.call(root.querySelectorAll("[data-hotspot-block]"), wireHotspotNode);

      // Wire up direct canvas drag-and-drop & drop targets on the canvas blocks
      Array.prototype.forEach.call(root.querySelectorAll(".canvas-block"), function (node) {
        var block = node.__block;
        if (!block) return;
        if (block.locked) return; // locked: no drag handle, no click-select (unlock via inspector)

        var pageEl = node.closest(".page");
        if (!pageEl) return;
        var pageId = pageEl.getAttribute("data-page-id");
        var pi = pageIndexById(pageId);
        if (pi === -1) return;

        // A columns row gets page-level top/bottom edge bands (AA) but no box/drag
        // handle of its own; a group is an invisible container with neither.
        if (block.type === "columns") { attachColumnsEdgeBands(node, block, pi); attachColumnResizers(node, block); attachColumnSwaps(node, block); attachEmptyColumnDrops(node, block); return; }
        if (block.type === "group") return; // no box of its own

        // Hotspot popover-card content is a FULL editing container (parity with
        // accordion / card-reveal children): its blocks are drop targets AND
        // draggable, so blocks can be dragged INTO the card and reordered.
        // findBlockParent resolves hotspots[].blocks, so a move/drop splices into the
        // right array (a left/right column-wrap safely no-ops inside the overlay).
        // 1. Make this block a drop target
        makeDropTarget(node, { targetBlock: block });
        // 1a. Image blocks also accept an external image FILE dropped from the desktop.
        if (block.type === "image") attachImageFileDrop(node, block);

        // 1b. Direct click-to-select for blocks with no editable text / instance /
        // embed of their own (image, divider, spacer, card frame). Guarded so it
        // never steals a click that a nested block, editable text, instance, embed
        // or the drag handle should own, and never fights the multi-select
        // (Shift/Cmd) capture handler.
        node.addEventListener("mousedown", function (e) {
          if (e.shiftKey || e.metaKey || e.button !== 0) return;
          if (e.target.closest(".canvas-drag-handle, [data-edit], [data-instance], [data-embed]")) return;
          if (e.target.closest(".canvas-block") !== node) return; // a nested block owns it
          e.stopPropagation();
          selectByType(node, block);
        });

        node.style.position = "relative";

        // Shared move-drag payload — identical to the old gripper's, so every drop /
        // reorder path (makeDropTarget / handleDrop) is untouched. Alt = duplicate.
        function startBlockDrag(e) {
          setDragPayload({ kind: "move", page: pi, block: block, duplicate: e.altKey });
          e.dataTransfer.effectAllowed = e.altKey ? "copy" : "move";
          try { e.dataTransfer.setData("text/plain", ""); } catch (_) {}
          node.classList.add("is-dragging");
          document.body.classList.add("is-dragging-block");
        }
        function endBlockDrag() {
          node.classList.remove("is-dragging");
          clearDropMarks();
          setDragPayload(null);
          document.body.classList.remove("is-dragging-block");
        }

        if (twoStateText()) {
          // §74 PHASE 2: NO gripper. The block body itself is the drag surface, but
          // draggable is toggled ON only when the block is SELECTED (updateDragAffordance,
          // on every selection change) — so first click selects, a press-drag on the
          // selected block MOVES it. draggable is cleared while editing text so
          // the caret / text-selection still works.
          node.addEventListener("dragstart", function (e) {
            if (node.getAttribute("draggable") !== "true") { e.preventDefault(); return; }
            if (isTextTarget(e.target)) { e.preventDefault(); return; } // editing -> select text, don't move
            startBlockDrag(e);
          });
          node.addEventListener("dragend", endBlockDrag);
        } else {
          // Click-to-edit escape hatch keeps the gripper handle (unchanged behaviour).
          if (node.querySelector(".canvas-drag-handle")) return;
          var handle = h("div", "canvas-drag-handle", "⠿");
          handle.setAttribute("draggable", "true");
          handle.setAttribute("contenteditable", "false");
          handle.title = "Drag to reorder or move side-by-side";
          handle.addEventListener("dragstart", startBlockDrag);
          handle.addEventListener("dragend", endBlockDrag);
          node.appendChild(handle);
          node.classList.add("canvas-block-wrapper");
        }
      });

      // Flip cards: only one face is visible at a time, so give each card an
      // editor-only flip toggle to author the hidden side in place (WYSIWYG — the
      // canvas flips exactly like the learner card). View state lives in the
      // flipEditBack WeakSet keyed on the item object, so it survives mount()
      // rebuilds but never touches the doc (nothing ships in the export).
      Array.prototype.forEach.call(root.querySelectorAll('.card-reveal[data-reveal-style="flip"]'), function (grid) {
        var block = grid.__block;
        if (!block || !Array.isArray(block.items)) return;
        Array.prototype.forEach.call(grid.querySelectorAll(".card-reveal__card"), function (card) {
          var item = block.items[parseInt(card.getAttribute("data-cr-index"), 10)];
          if (!item) return;
          if (flipEditBack.has(item)) card.classList.add("is-revealed");
          var btn = h("button", "card-flip-edit");
          btn.type = "button";
          btn.setAttribute("contenteditable", "false");
          btn.setAttribute("draggable", "false");
          btn.title = "Flip to edit the other side";
          btn.innerHTML = Icon("refresh-cw");
          btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
          btn.addEventListener("click", function (e) {
            e.stopPropagation(); e.preventDefault();
            if (flipEditBack.has(item)) { flipEditBack.delete(item); card.classList.remove("is-revealed"); }
            else { flipEditBack.add(item); card.classList.add("is-revealed"); }
          });
          card.appendChild(btn);
        });
      });
      wireItemBodyDrops(root); // #134: every card/side body (incl. empty) accepts dropped blocks
      scheduleSpellcheck(); // P0: (re)mark typos after every canvas render (mount / reapplyStructural)
    }
    // Which flip cards are currently edit-flipped to their back (Side 2). Editor view
    // state only — keyed on the live item object, so it survives mount() but is never
    // serialised into the doc or the export.
    var flipEditBack = new WeakSet();
    // A transparent shield over each embed: keeps wheel/pan/zoom on the CANVAS
    // (an iframe would otherwise swallow the wheel and the browser would page-zoom),
    // makes the block reliably selectable, and double-click "enters" the embed to
    // actually interact with it (shield goes pointer-through until you click away).
    function wireEmbedNode(node) {
      var shield = document.createElement("div");
      shield.className = "embed__shield";
      shield.title = "Click to select · double-click to interact";
      shield.addEventListener("mousedown", function (e) { e.stopPropagation(); setSelection("embed", node); });
      shield.addEventListener("dblclick", function (e) { e.stopPropagation(); node.classList.add("is-interactive"); });
      node.appendChild(shield);
    }

    kernel.expose({
      enableEditing: enableEditing, wireEmbedNode: wireEmbedNode, enterTextEdit: enterTextEdit,
      selectFieldNode: selectFieldNode, blockLocked: blockLocked, twoStateText: twoStateText,
      setTwoStateText: setTwoStateText, collabBlockOf: collabBlockOf, caretOffsetIn: caretOffsetIn
    });
  }

  window.VersoEditing = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoEditing;
})();
