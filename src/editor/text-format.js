// editor/text-format.js -- inline text formatting: the toggle set, the bar that renders it, and the
// floating bar that follows a selection on the canvas (arch-P3b-07fmt).
//
// One model, two surfaces. FORMAT_TOGGLES is the whole vocabulary of what an author can do to a
// run of text -- bold, italic, underline, a link, and a whole-block list conversion -- and it is
// declared once. Everything else in this file renders that list somewhere.
//
// `buildFormatToggleBar` is the panel-side bar: the field inspector, the instance inspector and
// the Course Copy Editor all mount it, and `io` is what keeps it out of their business. The bar
// asks for the contentEditable node to act on and reports back that it changed something; who
// persists that, and how, is the caller's problem. That is why one bar serves three surfaces
// that commit through three different write paths.
//
// The canvas bar is the same list again, positioned above a live selection instead of docked in
// a panel. It only ever appears over a non-collapsed selection inside a [data-edit] field, and
// it acts by execCommand -- which fires the field's own input handler and so commits through
// writeModel exactly as typing does. There is no second write path here, deliberately: the bar
// is a shortcut to the keystrokes, not an alternative to them.
//
// The link and list kinds reach back out (a prompt for the href, a block-type conversion for the
// list) and both arrive through `io`. The three names this file needs from the host are `h`,
// `iconBtn` and `promptModal` -- the smallest need list of any region moved in this phase.
//
// Editor chrome only. Nothing here renders into a shipped course; the marks it writes do.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "iconBtn", "promptModal"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        iconBtn = E.iconBtn,
        promptModal = E.promptModal;

    // #170/#158: ONE canonical, config-driven formatting toggle-bar builder, shared by the
    // block inspector's field editor AND the Course Copy Editor -- replacing their two
    // bespoke prop-toggle-row "biu" rows. Behaviour is unchanged (inline execCommand for
    // B/I/U/Link, active state via queryCommandState/an anchor check); only the surfaces
    // now share one implementation. `io` decouples the bar from which surface it's in:
    //   io.getNode() -> the current contentEditable element to focus/act on (or null/undefined
    //                   when nothing is active -- the bar simply no-ops on click)
    //   io.onChange() -> called after a toggle mutates content; the caller owns persistence
    //                    (inspector: obj[field] = sanitizeFieldHtml(...) + renderModelView();
    //                    copy editor: commitCopyRow(...))
    // Config-driven so a future kind (e.g. the List ticket's block-level toggle) is a new
    // branch here, not a new bar -- today "inline-exec" (B/I/U), "link", and "list-block"
    // (#170/#33: a whole block-TYPE conversion, not an inline execCommand list) exist.
    var FORMAT_TOGGLES = [
      { kind: "inline-exec", label: "B", cmd: "bold", title: "Bold (selected text)" },
      { kind: "inline-exec", label: "I", cmd: "italic", title: "Italic (selected text)" },
      { kind: "inline-exec", label: "U", cmd: "underline", title: "Underline (selected text)" },
      { kind: "link" },
      { kind: "list-block" }
    ];
    function formatCmdOn(cmd) { try { return document.queryCommandState(cmd); } catch (e) { return false; } }
    // uio-E-C06: the link BEHAVIOUR, extracted so the two surfaces can render different controls
    // over it. The panel wants a labelled row with a clear action; the copy editor's toolbar wants
    // a glyph. What neither should own is the fiddly part below — the modal steals focus, so the
    // Range has to be saved and restored before execCommand, and createLink sets no target, so the
    // anchors need target/rel afterwards or a course link opens over the course.
    function promptLinkForSelection(io, done) {
      var node = io.getNode(); if (!node) return;
      var a = formatSelectionAnchor(), sel = window.getSelection();
      if (!a && (!sel || sel.isCollapsed)) { window.alert("Select some text first, then add a link."); return; }
      var savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
      promptModal("Link", "URL (opens in a new tab; leave blank to remove)", a ? a.getAttribute("href") : "https://", function (url) {
        var n2 = io.getNode(); if (!n2) return;
        n2.focus();
        if (savedRange) { var s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(savedRange); }
        url = (url || "").trim();
        if (!url) { document.execCommand("unlink", false, null); }
        else {
          document.execCommand("createLink", false, url);
          Array.prototype.forEach.call(n2.querySelectorAll("a[href]"), function (el) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); });
        }
        io.onChange();
        if (done) done();
      });
    }
    function removeLinkFromSelection(io, done) {
      var n = io.getNode(); if (!n) return;
      n.focus(); document.execCommand("unlink", false, null); io.onChange();
      if (done) done();
    }
    function formatSelectionAnchor() {
      var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
      var c = sel.getRangeAt(0).commonAncestorContainer;
      c = c.nodeType === 1 ? c : c.parentNode;
      return (c && c.closest) ? c.closest("a[href]") : null;
    }
    // ---- Above-selection floating format bar on the Edit canvas (floating-format-bar-to-edit-canvas) ----
    // The same above-the-selection glyph bar idiom the Source stage uses (buildSourceSelBar), brought to
    // the main Edit canvas. It appears on a non-collapsed text selection inside an editable [data-edit]
    // field with the inline format actions -- bold / italic / underline, the SAME inline-exec set as the
    // inspector's FORMAT_TOGGLES (one config, two surfaces). Clicking runs execCommand, which fires the
    // field's own input -> writeModel commit (identical to typing), so there is no separate write path.
    // Editor chrome only; never in the shipped course. Positioned fixed above the selection.
    /* @canvas-fmtbar-start */
    var FMTBAR_GLYPH = { bold: "bold", italic: "italic", underline: "underline" };
    var __canvasFmtBar = null;
    // The editable canvas text field a DOM point sits in, or null (a live contentEditable [data-edit]).
    function canvasEditableFieldOf(node) {
      var el = (node && node.nodeType === 3) ? node.parentNode : node;
      var f = (el && el.closest) ? el.closest("[data-edit].is-editable") : null;
      return (f && f.getAttribute("contenteditable") === "true") ? f : null;
    }
    function hideCanvasFmtBar() { if (__canvasFmtBar) { __canvasFmtBar.remove(); __canvasFmtBar = null; } }
    function syncCanvasFmtBarActive(bar) {
      Array.prototype.forEach.call(bar.querySelectorAll("[data-cmd]"), function (b) {
        var on = false; try { on = document.queryCommandState(b.getAttribute("data-cmd")); } catch (e) {}
        b.classList.toggle("is-active", on);
      });
    }
    function ensureCanvasFmtBar() {
      if (__canvasFmtBar) return __canvasFmtBar;
      var bar = h("div", "canvas-fmtbar"); bar.setAttribute("data-canvas-fmtbar", "1");
      FORMAT_TOGGLES.filter(function (t) { return t.kind === "inline-exec"; }).forEach(function (t) {
        var b = h("button", "canvas-fmtbar__btn"); b.type = "button"; b.title = t.title;
        b.setAttribute("data-cmd", t.cmd);
        var glyph = FMTBAR_GLYPH[t.cmd];
        if (glyph && window.Icon) b.innerHTML = window.Icon(glyph); else b.textContent = t.label;
        b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the field's selection
        b.addEventListener("click", function () { document.execCommand(t.cmd, false, null); syncCanvasFmtBarActive(bar); });
        bar.appendChild(b);
      });
      document.body.appendChild(bar);
      __canvasFmtBar = bar; return bar;
    }
    // Shows/positions the bar for a text selection in a canvas field; hides it otherwise. The Source
    // stage's own selbar owns [data-node] selections, so this only ever binds to [data-edit] fields --
    // the two never collide.
    function onCanvasSelectionChange() {
      if (typeof document === "undefined") return;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) { hideCanvasFmtBar(); return; }
      var r = sel.getRangeAt(0);
      if (!canvasEditableFieldOf(r.commonAncestorContainer)) { hideCanvasFmtBar(); return; }
      var rect = r.getBoundingClientRect();
      if (!rect || !rect.width) { hideCanvasFmtBar(); return; }
      var bar = ensureCanvasFmtBar();
      syncCanvasFmtBarActive(bar);
      bar.style.left = (rect.left + rect.width / 2) + "px";
      bar.style.top = rect.top + "px"; // a CSS transform centres + lifts it above the selection
    }
    /* @canvas-fmtbar-end */
    // uio-E-C06 (EDIT-11): the BLOCK INSPECTOR no longer mounts this bar. Character formatting acts
    // on a text SELECTION, and the Edit canvas has a bar that follows one (`canvas-fmtbar`, below),
    // so making an author hold a selection while travelling to a panel was the divergence EDIT-11
    // names. The inspector renders Link and List as canonical rows instead and reaches the link
    // behaviour directly (`promptLinkForSelection` / `removeLinkFromSelection`).
    //
    // The Course Copy Editor is now this bar's ONLY caller, and it keeps B/I/U on purpose: its rows
    // carry no `[data-edit]`, so `canvasEditableFieldOf` never matches them and the floating bar
    // never appears there. Taking B/I/U out of here would leave that surface unable to bold
    // anything at all -- the same trap that made E-C06 read as blocked, just moved one surface over.
    function buildFormatToggleBar(io) {
      var bar = h("div", "prop-toggle-row");
      var execBtns = [];
      var listBtn = null;
      FORMAT_TOGGLES.forEach(function (t) {
        if (t.kind === "inline-exec") {
          var b = h("button", "prop-toggle" + (formatCmdOn(t.cmd) ? " is-on" : ""), t.label);
          if (t.title) b.title = t.title;
          b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the field's text selection
          b.addEventListener("click", function () {
            var node = io.getNode(); if (!node) return;
            node.focus();
            document.execCommand(t.cmd, false, null);
            io.onChange();
            b.classList.toggle("is-on", formatCmdOn(t.cmd));
          });
          bar.appendChild(b);
          execBtns.push({ el: b, cmd: t.cmd });
        } else if (t.kind === "link") {
          // The toolbar affordance: a Link toggle plus its own unlink glyph. The PANEL renders the
          // same two behaviours as one row with a clear action (buildLinkRow) -- same functions,
          // different control, which is the point of extracting them.
          var linkB = h("button", "prop-toggle" + (formatSelectionAnchor() ? " is-on" : ""), "Link");
          linkB.title = "Link the selected text to an external URL (opens in a new tab)";
          linkB.addEventListener("mousedown", function (e) { e.preventDefault(); });
          linkB.addEventListener("click", function () { promptLinkForSelection(io); });
          bar.appendChild(linkB);
          var unlinkB = iconBtn("unlink", "Remove the link");
          unlinkB.addEventListener("mousedown", function (e) { e.preventDefault(); });
          unlinkB.addEventListener("click", function () { removeLinkFromSelection(io); });
          bar.appendChild(unlinkB);
        } else if (t.kind === "list-block") {
          // #170/#33: converts the WHOLE block to/from the dedicated "list" type (on-state
          // reads block.type, not queryCommandState). Not every surface/field supports this
          // (e.g. a quiz sub-field can't become a top-level list block), so the button is
          // hidden -- not just disabled -- when io.isListToggleable() says no. A persisting
          // bar (copy editor) re-derives visibility on every bar.refresh(), since which row
          // is focused changes without the bar itself being rebuilt.
          if (!io.isListToggleable || !io.isListBlock || !io.toggleListBlock) return;
          var listB = h("button", "prop-toggle prop-toggle--icon");
          listB.type = "button";
          listB.title = "List — converts this block to/from a bulleted list";
          listB.innerHTML = Icon("list");
          listB.addEventListener("mousedown", function (e) { e.preventDefault(); });
          listB.addEventListener("click", function () { io.toggleListBlock(); });
          bar.appendChild(listB);
          listBtn = listB;
        }
      });
      // Resync every inline-exec button's active state against the CURRENT selection, plus
      // the list-block toggle's visibility/state -- callers that persist across re-focus
      // (the copy editor's format bar, built once) use this instead of rebuilding; a surface
      // that rebuilds the bar every render still gets a correct initial state (called below).
      bar.refresh = function () {
        var active = !!io.getNode();
        execBtns.forEach(function (o) { o.el.classList.toggle("is-on", active && formatCmdOn(o.cmd)); });
        if (listBtn) {
          var canList = !!(io.isListToggleable && io.isListToggleable());
          listBtn.hidden = !canList;
          if (canList) listBtn.classList.toggle("is-on", !!(io.isListBlock && io.isListBlock()));
        }
      };
      bar.refresh();
      return bar;
    }
    window.__buildFormatToggleBar = buildFormatToggleBar; // headless test hook

    kernel.expose({
      buildFormatToggleBar: buildFormatToggleBar, onCanvasSelectionChange: onCanvasSelectionChange, hideCanvasFmtBar: hideCanvasFmtBar,
      // uio-E-C06: the link behaviour, for whichever surface renders a control over it.
      promptLinkForSelection: promptLinkForSelection, removeLinkFromSelection: removeLinkFromSelection, formatSelectionAnchor: formatSelectionAnchor
    });
  }

  window.VersoTextFormat = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoTextFormat;
})();
