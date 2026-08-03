// editor/copy-editor.js -- the Read view, and the find & replace under it (arch-P3b-07j).
//
// Build and Read are the two ways to look at the same course. Build is the canvas. Read is this: a
// full-screen page-by-page list of every text field, side by side with its variants, for the pass
// where an author is editing WORDS and does not want to think about layout at all. It is a VIEW,
// never a store -- each row reads the model through frValueOf and writes back through frWrite, so
// nothing is copied out and nothing can drift.
//
// Find & replace sat 900 lines away in editor.js under the variant banner, and it is the same
// thing seen from the other end. frTargets enumerates the copy of the current canvas, frValueOf
// reads a field, frWrite writes it. The dialog steps through matches with those three; the Read
// view lists them all with the same three. Bringing them together took the region's traffic with
// editor.js from eleven names to four.
//
// VARIANT SAFETY is the reason the write path is one function. Replacing while a variant is
// previewed goes through that variant's override layer and never touches the flagship copy, which
// is the whole point of the feature -- editing Variant 1 must leave the base untouched. A cell is
// locked until the author unlocks it, so an override is always deliberate.
//
// The pure half (frCount, frReplaceAll, frWords, frTotal, frNext) is fenced for the headless suite,
// as is the open/closed view state. Neither touches the DOM.
//
// Editor chrome only: it edits the document's copy, and never renders the course.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pushHistory", "scheduleSave", "mount", "scheduleSpellcheck", "dsSelect",
      "modalText", "sanitizeText", "sanitizeFieldHtml", "flushSave", "buildFormatToggleBar", "TEXT_CONTENT_TYPES",
      "convertTextListBlockType", "pageDisplayName", "clamp", "focusFrame", "setActivePage", "setSelection",
      "isTextTarget", "modalHead", "modalField", "previewVariant", "doc", "activeVariant",
      "currentPage"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        pushHistory = E.pushHistory,
        scheduleSave = E.scheduleSave,
        mount = E.mount,
        scheduleSpellcheck = E.scheduleSpellcheck,
        dsSelect = E.dsSelect,
        modalText = E.modalText,
        sanitizeText = E.sanitizeText,
        sanitizeFieldHtml = E.sanitizeFieldHtml,
        flushSave = E.flushSave,
        buildFormatToggleBar = E.buildFormatToggleBar,
        TEXT_CONTENT_TYPES = E.TEXT_CONTENT_TYPES,
        convertTextListBlockType = E.convertTextListBlockType,
        pageDisplayName = E.pageDisplayName,
        clamp = E.clamp,
        focusFrame = E.focusFrame,
        setActivePage = E.setActivePage,
        setSelection = E.setSelection,
        isTextTarget = E.isTextTarget,
        modalHead = E.modalHead,
        modalField = E.modalField,
        previewVariant = E.previewVariant;

    // ===== #116 copy-editor view-state (pure; extracted + eval'd by tests/run.js) =====
    // The full-screen copy editor is an alternate view over the layout canvas (same enter/exit
    // shell as Demo) — one view at a time. This is the SINGLE SOURCE of the open/closed logic:
    // enter -> open, exit -> closed, toggle flips; `restoreCanvas` fires only on a real close
    // (was open, now closed) so the layout canvas is re-focused exactly as demo's exit does.
    window.copyEditorNextState = function (cur, action) {
      cur = cur || { open: false };
      var open = action === "enter" ? true : action === "exit" ? false : !cur.open;
      return { open: open, hidden: !open, bodyOpen: open, restoreCanvas: !!(cur.open && !open) };
    };
    // #117 (slice 2): a clean, dim ROLE TAG derived from a frTargets `label`
    // ("<type> · <key>", "option", "table cell", …). Pure — drives the read-only view.
    window.copyEditorRole = function (label) {
      label = String(label || "");
      var parts = label.split(" · "); // " · "
      var type = parts[0], key = parts[parts.length - 1];
      if (type === "card") return "card";
      if (label === "sort card") return "card";
      if (label === "table cell") return "table cell";
      if (label === "option") return "option";
      if (label === "sort category") return "category";
      if (label === "item title") return "title";
      if (type === "question") {
        if (key === "prompt" || key === "stemBefore" || key === "stemAfter") return "quiz stem";
        if (key === "feedbackCorrect" || key === "feedbackIncorrect") return "feedback";
        if (key === "methodLabel") return "label";
        return "quiz";
      }
      if (label.indexOf("quiz") === 0) return "quiz";
      if (key === "caption") return "caption";
      if (key === "kicker") return "kicker";
      if (key === "title") return "title";
      if (key === "label") return "label";
      if (type === "heading") return "heading";
      if (key === "text") return "paragraph";
      return key || "text";
    };
    // #117 (slice 2): group the resolved copy list (each { pageIndex, label, value })
    // into per-page sections IN ORDER, skipping truly-empty values (tags/nbsp only),
    // tagging each surviving row with a role. Pure — a VIEW over the model, never a
    // store. The DOM builder adds the read-only chapter/page location headers.
    window.copyEditorModel = function (list) {
      var groups = [], byPage = {};
      (list || []).forEach(function (it) {
        if (!it) return;
        var v = it.value == null ? "" : String(it.value);
        if (!v.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim()) return; // empty after stripping tags/nbsp
        var pi = it.pageIndex;
        var g = byPage[pi];
        if (!g) { g = byPage[pi] = { pageIndex: pi, rows: [] }; groups.push(g); }
        g.rows.push({ role: window.copyEditorRole(it.label), html: v, ref: it.ref }); // ref = frTarget (slice 3 write-back)
      });
      return groups;
    };
    // #104 side-by-side: the column spine for the variant view — flagship first (""),
    // then every declared variant in order. Pure over the doc; empty (no columns worth
    // showing) when the course has no variants, which is how the mode toggle stays hidden.
    window.copyEditorSbsColumns = function (d) {
      var vs = (d && d.variants) || [];
      return vs.length ? [""].concat(vs.slice()) : [];
    };
    // ===== end #116 copy-editor view-state =====

    function copyEditorEl() { return document.getElementById("copy-editor"); }
    function copyEditorIsOpen() { var el = copyEditorEl(); return !!(el && !el.hidden); }
    function applyCopyEditorState(st) {
      var el = copyEditorEl(); if (!el) return;
      el.hidden = st.hidden;
      document.body.classList.toggle("copyedit-open", st.bodyOpen); // hide authoring-only chrome behind the view
    }
    // #117 (slice 2): paint ALL course copy into the shell as a READ-ONLY document —
    // every frTargets entry (the writable spine) as a flat row with a dim role tag,
    // grouped under read-only chapter/page location headers, in reading order, empties
    // skipped, inline HTML preserved. A VIEW over the model (frValueOf), never a store;
    // two-way editing arrives in slice 3.
    // #118 (slice 3): the copy editor is now EDITABLE. Each row is bound through the same
    // sanitize -> write -> save path the layout canvas uses (writeModel), but keyed on the
    // frTargets {host,key} and routed via frWrite (base, or the active variant's override
    // layer — F&R's existing rule; no new variant logic). RICH-PRESERVING: we commit the
    // field's innerHTML (inline bold/italic/links/weight spans survive sanitizeFieldHtml),
    // never flattening to plain text (the inline-HTML data-loss landmine — see ADR 0001).
    var copyEditDirty = false; // an edit here needs a canvas rebuild (mount) on toggle-back
    // #175: the row the format toolbar acts on. Set on focus; the toolbar (B/I/U + inline
    // weight) applies to THIS row's selection and commits through the same frWrite path, so
    // a variant-active edit lands on overrides[variant] (rich-preserving) — letting an author
    // re-apply/repair the flagship's inline-weight boundary (e.g. lighter 'Rf') on variant text.
    var _activeCopyRow = null;
    // #104: the copy-editor Side-by-side (variant columns) mode + which variant cells the
    // author has UNLOCKED for editing this session. Unlock is transient UI (never persisted
    // to the doc); keyed by host+key+variant since frTargets rebuilds fresh {host,key}
    // wrappers each render (the host object is the stable identity).
    var copyEditSbs = false;
    var _unlockedCells = [];
    function cellUnlocked(t, variant) {
      for (var i = 0; i < _unlockedCells.length; i++) {
        var u = _unlockedCells[i];
        if (u.host === t.host && u.key === t.key && u.variant === variant) return true;
      }
      return false;
    }
    function setCellUnlocked(t, variant) {
      if (!cellUnlocked(t, variant)) _unlockedCells.push({ host: t.host, key: t.key, variant: variant });
    }
    // #104: commit a cell to a SPECIFIC variant layer ("" = flagship/base). The single-view
    // rows pass activeVariant (unchanged); the side-by-side flagship/variant cells pass their
    // own column variant so each writes the correct override layer via frWrite.
    function commitCopyRow(t, tx, variant) {
      frWrite(t, variant == null ? activeVariant : variant, sanitizeText(sanitizeFieldHtml(tx.innerHTML)));
      copyEditDirty = true;
      scheduleSave();
      scheduleSpellcheck(); // P0: re-check typos in the copy-editor view as the author types
    }
    function bindCopyRow(tx, t, variant) {
      tx.setAttribute("contenteditable", "true");
      tx.setAttribute("spellcheck", "true"); // #119: native browser spellcheck (red squiggles) in the copy view
      tx.classList.add("is-editable");
      tx.addEventListener("input", function () { commitCopyRow(t, tx, variant); });
      // #175: remember which row (+ its frTarget) the format toolbar should act on, and
      // reflect the selection's B/I/U state in the toolbar as the caret/selection moves.
      tx.addEventListener("focus", function () { _activeCopyRow = { tx: tx, t: t, variant: variant == null ? activeVariant : variant }; refreshCopyFormatState(); });
      tx.addEventListener("keyup", refreshCopyFormatState);
      tx.addEventListener("mouseup", refreshCopyFormatState);
      // Paste as PLAIN TEXT (mirrors the canvas): the browser default drags the source's
      // rich HTML into the field; strip to text/plain so pasted words inherit the field.
      tx.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = "";
        try { text = (e.clipboardData || window.clipboardData).getData("text/plain"); } catch (_) {}
        if (window.__sanitizeText) text = window.__sanitizeText(text);
        if (text) document.execCommand("insertText", false, text);
      });
      // v1: one logical edit per field — Enter/Escape commit + blur (no contenteditable
      // <div>/<br> injection into fields the canvas renders inline). Structural/multiline
      // changes stay on the layout canvas; existing inline markup is preserved on write.
      tx.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); tx.blur(); }
      });
      tx.addEventListener("blur", function () { flushSave(); renderCopyEditorTools(); }); // #119: refresh word count after an edit
    }
    // #119 (slice 4): the view header tools — REUSE only.
    //  - word count via frCore.words over frTargets (the same base-scope metric F&R shows, #78)
    //  - Find & replace opens the EXISTING modal (already targets frTargets); it appears above
    // the copy-editor overlay and, after a replace, we re-paint the view + count.
    function copyEditorWordTotal() {
      return frTargets(E.doc, "").reduce(function (n, t) { return n + frWords(frValueOf(t, "")); }, 0);
    }
    function renderCopyEditorTools() {
      var host = document.getElementById("copyedit-tools"); if (!host) return;
      host.innerHTML = "";
      var n = copyEditorWordTotal();
      var wc = h("span", "copyedit-wordcount", String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " word" + (n === 1 ? "" : "s"));
      host.appendChild(wc);
      // #104: Single | Side by side — the variant-columns mode toggle. Canonical
      // SegmentedControl (prop-toggle-row), shown ONLY when the course declares variants
      // (else there is nothing to place beside a block). Flipping it re-paints the doc.
      if ((E.doc.variants || []).length) {
        var seg = h("div", "prop-toggle-row copyedit-modeseg");
        [["Single", false], ["Side by side", true]].forEach(function (o) {
          var b = h("button", "prop-toggle" + (copyEditSbs === o[1] ? " is-on" : ""), o[0]);
          b.title = o[1] ? "Show each variant's copy beside the flagship" : "One column of flagship copy";
          b.addEventListener("click", function () {
            if (copyEditSbs === o[1]) return;
            copyEditSbs = o[1];
            renderCopyEditorDoc(); renderCopyEditorTools();
          });
          seg.appendChild(b);
        });
        host.appendChild(seg);
      }
      var find = h("button", "copyedit-tool", "Find & replace");
      find.title = "Find & replace across all course copy (Cmd/Ctrl+F)";
      find.addEventListener("click", function () { openFindReplace(); });
      host.appendChild(find);
    }
    // #175: inline rich-formatting toolbar for the copy editor — B / I / U + inline
    // Weight, the SAME controls (and the same weight surroundContents mechanic) the
    // flagship field inspector uses (typeCluster / the "Style" B-I-U row). Acts on the
    // focused row (_activeCopyRow) and commits via commitCopyRow -> frWrite, so with a
    // variant active the formatting lands on overrides[variant] (rich-preserving). This
    // is the missing control the reporter needed: re-apply/repair the flagship's inline
    // weight boundary (e.g. lighter 'Rf') on shortened variant text. Built from canonical
    // prop-toggle buttons + the shared dsSelect weight picker (no bespoke controls).
    var _copyFormatBar = null; // the shared toggle-bar instance (has .refresh()) once built
    function refreshCopyFormatState() { if (_copyFormatBar) _copyFormatBar.refresh(); }
    // Apply an inline font-weight span to the active row's selection (or the whole row when
    // nothing is selected) — mirrors the field inspector's applyWeightToSelection: raw
    // font-weight span => literal HTML that survives sanitizeFieldHtml and round-trips
    // render/export. surroundContents throws across element boundaries -> extract+insert.
    function applyCopyWeight(weight, savedRange) {
      if (!weight || !_activeCopyRow) return;
      var tx = _activeCopyRow.tx, t = _activeCopyRow.t;
      tx.focus();
      var sel = window.getSelection();
      var r = savedRange && tx.contains(savedRange.commonAncestorContainer) ? savedRange : ((sel && sel.rangeCount) ? sel.getRangeAt(0) : null);
      if (!r || r.collapsed || !tx.contains(r.commonAncestorContainer)) { r = document.createRange(); r.selectNodeContents(tx); }
      sel.removeAllRanges(); sel.addRange(r);
      pushHistory();
      var span = document.createElement("span"); span.style.fontWeight = weight;
      try { r.surroundContents(span); }
      catch (e) { span.appendChild(r.extractContents()); r.insertNode(span); }
      commitCopyRow(t, tx, _activeCopyRow.variant);
    }
    function buildCopyFormatBar() {
      var bar = document.getElementById("copyedit-format");
      if (bar) return bar; // built once, persists across re-enters
      var host = document.getElementById("copyedit-tools");
      if (!host || !host.parentNode) return null;
      bar = h("div", "copyedit__format"); bar.id = "copyedit-format";
      // #170/#158/#33: the shared canonical toggle-bar builder (B/I/U/Link/List) -- the same
      // one the field inspector's Style row uses. The copy editor gains Link as a side effect
      // of sharing one implementation (it had none before); same execCommand/createLink
      // mechanic. List converts the FOCUSED row's underlying block type in place -- only
      // shown when that row is a genuine top-level text-content block (t.host.type in
      // TEXT_CONTENT_TYPES), never a quiz sub-field row (t.host has no .type). This bar is
      // built ONCE and persists across every row focus, so visibility/state re-derive on
      // every bar.refresh() (via refreshCopyFormatState, already wired to focus/keyup/mouseup).
      var biu = buildFormatToggleBar({
        getNode: function () { return _activeCopyRow && _activeCopyRow.tx; },
        onChange: function () { if (!_activeCopyRow) return; commitCopyRow(_activeCopyRow.t, _activeCopyRow.tx, _activeCopyRow.variant); },
        isListToggleable: function () { return !!(_activeCopyRow && _activeCopyRow.t.key === "text" && _activeCopyRow.t.host && _activeCopyRow.t.host.type && TEXT_CONTENT_TYPES[_activeCopyRow.t.host.type]); },
        isListBlock: function () { return !!(_activeCopyRow && _activeCopyRow.t.host.type === "list"); },
        toggleListBlock: function () {
          if (!_activeCopyRow) return;
          pushHistory();
          convertTextListBlockType(_activeCopyRow.t.host);
          copyEditDirty = true; scheduleSave();
          renderCopyEditorDoc(); renderCopyEditorTools(); // rows rebuild -- the converted row now reflects the new content/type
        }
      });
      _copyFormatBar = biu;
      bar.appendChild(biu);
      // Inline weight — capture the row's live range on mousedown (opening the select steals
      // focus + collapses the selection, same trick the field inspector's Weight uses).
      var savedRange = null;
      var wt = dsSelect([["Weight", ""], ["Regular", "400"], ["Medium", "500"], ["Semibold", "600"], ["Bold", "700"], ["Extra", "800"]], "", function (weight) {
        var r = savedRange; savedRange = null;
        applyCopyWeight(weight, r);
        wt.value = ""; // reset to the placeholder so re-picking the same weight fires change again
      });
      wt.addEventListener("mousedown", function () {
        var sel = window.getSelection();
        var r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
        savedRange = (r && _activeCopyRow && _activeCopyRow.tx.contains(r.commonAncestorContainer)) ? r.cloneRange() : null;
      });
      bar.appendChild(wt);
      host.parentNode.insertBefore(bar, host);
      return bar;
    }
    function renderCopyEditorDoc() {
      var host = document.getElementById("copyedit-doc"); if (!host) return;
      host.innerHTML = "";
      _activeCopyRow = null; refreshCopyFormatState(); // rows are rebuilt -> drop the stale ref
      // #104: Side-by-side variant columns. Row presence keys off the FLAGSHIP value (variant
      // ""); each variant then gets a cell beside it. Single mode is the pre-#104 behaviour.
      var cols = window.copyEditorSbsColumns(E.doc);
      var sbs = copyEditSbs && cols.length;
      var listVariant = sbs ? "" : E.activeVariant;
      var list = frTargets(E.doc, listVariant).map(function (t) {
        return { pageIndex: t.pageIndex, label: t.label, value: frValueOf(t, listVariant), ref: t };
      });
      var groups = window.copyEditorModel(list);
      if (!groups.length) { host.appendChild(h("div", "copyedit-empty", "No course copy yet.")); return; }
      host.classList.toggle("copyedit__doc--sbs", !!sbs);
      // A single column-header row (frontend gate item 4: header once, not per page group),
      // aligned to the same grid template every row uses.
      var tmpl = sbs ? ("var(--copyedit-role-w, 96px) repeat(" + cols.length + ", minmax(0, 1fr))") : null;
      if (sbs) {
        var chead = h("div", "copyedit-colhead");
        chead.style.gridTemplateColumns = tmpl;
        chead.appendChild(h("span", "copyedit-colhead__cell", "")); // above the role tag
        cols.forEach(function (v) { chead.appendChild(h("span", "copyedit-colhead__cell", v === "" ? "Flagship" : v)); });
        host.appendChild(chead);
      }
      groups.forEach(function (g) {
        var page = E.doc.pages[g.pageIndex];
        var chapter = page && (E.doc.chapters || []).filter(function (c) { return c.id === page.chapterId; })[0];
        var head = h("div", "copyedit-loc");
        if (chapter) head.appendChild(h("span", "copyedit-loc__chapter", chapter.name || "Chapter"));
        head.appendChild(h("span", "copyedit-loc__page", pageDisplayName(page, E.doc)));
        host.appendChild(head);
        g.rows.forEach(function (row) {
          if (sbs) { host.appendChild(buildSbsRow(row, cols, tmpl)); return; }
          var r = h("div", "copyedit-row");
          r.appendChild(h("span", "copyedit-row__role", row.role));
          var tx = h("div", "copyedit-row__text");
          tx.innerHTML = row.html; // preserve inline HTML markup (rich-preserving edit target)
          if (row.ref) bindCopyRow(tx, row.ref); // slice 3: two-way editing keyed on {host,key}
          r.appendChild(tx);
          host.appendChild(r);
        });
      });
    }
    // #104: one side-by-side row = role tag + flagship cell + one cell per variant. The
    // flagship cell edits base copy (as in Single mode); each variant cell is READ-ONLY behind
    // a lock until unlocked (variant copy is derived/precious — mirrors the read-only variant
    // canvas preview, #207), or offers a quiet "+ from flagship" create affordance when the
    // variant holds no override. Non-overridable targets (table/quiz) get a truly empty cell.
    function copyGlyphBtn(name, cls, title, onClick) {
      var b = h("button", "copyedit-cellbtn " + cls);
      if (window.Icon) b.innerHTML = window.Icon(name);
      b.title = title; b.setAttribute("aria-label", title);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // don't steal caret from any focused cell
      b.addEventListener("click", onClick);
      return b;
    }
    function buildSbsRow(row, cols, tmpl) {
      var t = row.ref;
      var r = h("div", "copyedit-row copyedit-row--sbs");
      r.style.gridTemplateColumns = tmpl;
      r.appendChild(h("span", "copyedit-row__role", row.role));
      cols.forEach(function (v) {
        var cell = h("div", "copyedit-cell");
        if (v === "") { // flagship column — editable base copy, as Single mode
          var fx = h("div", "copyedit-row__text");
          fx.innerHTML = row.html;
          if (t) bindCopyRow(fx, t, "");
          cell.appendChild(fx);
          r.appendChild(cell); return;
        }
        // variant column
        if (!t || !t.overridable) { cell.classList.add("copyedit-cell--na"); r.appendChild(cell); return; }
        if (frHasOverride(t, v)) {
          var unlocked = cellUnlocked(t, v);
          var vx = h("div", "copyedit-row__text");
          vx.innerHTML = frValueOf(t, v);
          if (unlocked) bindCopyRow(vx, t, v); else vx.classList.add("copyedit-cell--locked");
          cell.appendChild(vx);
          cell.appendChild(copyGlyphBtn(unlocked ? "lock-open" : "lock", "copyedit-lock",
            unlocked ? "Lock" : "Unlock to edit",
            function () {
              if (cellUnlocked(t, v)) { _unlockedCells = _unlockedCells.filter(function (u) { return !(u.host === t.host && u.key === t.key && u.variant === v); }); }
              else setCellUnlocked(t, v);
              renderCopyEditorDoc();
            }));
          if (unlocked) cell.classList.add("copyedit-cell--editing");
        } else { // no override yet — create from flagship
          cell.classList.add("copyedit-cell--empty");
          cell.appendChild(copyGlyphBtn("plus", "copyedit-create", "Create variant copy from flagship",
            function () {
              pushHistory();
              frWrite(t, v, frValueOf(t, "")); // seed the override from the flagship copy
              setCellUnlocked(t, v);
              copyEditDirty = true; scheduleSave();
              renderCopyEditorDoc();
            }));
        }
        r.appendChild(cell);
      });
      return r;
    }
    function enterCopyEditor() {
      copyEditDirty = false;
      copyEditSbs = false; _unlockedCells = []; // #104: open in Single; unlock state is transient
      applyCopyEditorState(window.copyEditorNextState({ open: copyEditorIsOpen() }, "enter"));
      buildCopyFormatBar(); // #175: inline B/I/U + weight toolbar (built once)
      renderCopyEditorDoc(); // slices 2-3: paint + bind the course copy
      renderCopyEditorTools(); // slice 4: word count + Find & replace
      scheduleSpellcheck(); // P0: mark typos across the whole copy document
      syncViewToggle(); // reflect Read in the header Build/Read control
    }
    function exitCopyEditor() {
      var st = window.copyEditorNextState({ open: copyEditorIsOpen() }, "exit");
      applyCopyEditorState(st);
      _activeCopyRow = null; // #175: drop the format-toolbar target
      if (st.restoreCanvas) {
        // #118: an edit here wrote through to the one doc — rebuild the layout canvas from it
        // (the mount()/setDoc round-trip) so it shows the copy-editor edits. Then re-focus the
        // active page (canvas laid out + selected), the same idiom as exitDemo.
        if (copyEditDirty) { copyEditDirty = false; mount(); }
        if (E.doc.pages && E.doc.pages.length) {
          var p = clamp(E.currentPage || 0, 0, E.doc.pages.length - 1);
          focusFrame(p); setActivePage(p); setSelection("page", p);
        }
      }
      syncViewToggle(); // reflect Build in the header Build/Read control
    }
    function toggleCopyEditor() { if (copyEditorIsOpen()) exitCopyEditor(); else enterCopyEditor(); }
    // SPEC 7 (decision 14): a Build/Read segmented control in the editor header is the in-flow
    // way to switch between the authoring canvas (Build) and the per-doc copy view (Read = the
    // copy editor). It stays in sync however the copy editor is opened/closed (rail button, Esc).
    // Preview stays its own separate glyph.
    function currentViewMode() { return copyEditorIsOpen() ? "read" : "build"; }
    function mountViewToggle() {
      if (typeof document === "undefined") return;
      var host = document.getElementById("editor-view-toggle"); if (!host) return;
      var U = window.VersoUI; if (!U || !U.SegmentedControl) return;
      host.innerHTML = "";
      host.appendChild(U.SegmentedControl({
        size: "sm",
        // edit-header-ia-v2 (feedback): glyphs, not words. Build = authoring canvas (square-pen);
        // Read = the copy/read view (file-text). Titles carry the words for tooltip + a11y.
        options: [{ value: "build", icon: "square-pen", title: "Build" }, { value: "read", icon: "file-text", title: "Read" }],
        value: currentViewMode(),
        onChange: function (v) {
          if (v === "read") { if (!copyEditorIsOpen()) enterCopyEditor(); }
          else if (copyEditorIsOpen()) exitCopyEditor();
        }
      }));
    }
    function syncViewToggle() { mountViewToggle(); } // re-render so the active segment reflects the real state
    function wireCopyEditor() {
      // side-rail-cleanup: the #copy-editor-btn rail button is retired; Read view is entered via the
      // editor header's Build/Read toggle. Only the in-view exit + Escape are wired here now.
      var exit = document.getElementById("copyedit-exit");
      if (exit) exit.addEventListener("click", exitCopyEditor);
      document.addEventListener("keydown", function (e) {
        if (!copyEditorIsOpen()) return;
        if (e.key === "Escape" && !isTextTarget(e.target)) { e.preventDefault(); exitCopyEditor(); }
      });
    }
    window.__copyEditor = { enter: enterCopyEditor, exit: exitCopyEditor, toggle: toggleCopyEditor, isOpen: copyEditorIsOpen };

    // ==========================================================================
    // Find & replace (BACKLOG §3, grilled 2026-07-09) — author-side find/replace
    // over ALL text copy in the CURRENT canvas only. Case-SENSITIVE, EXACT match
    // as typed. Two modes: step-through (find-next → replace/skip) and replace-all.
    // Variant safety (the whole point): a replace while previewing a variant goes
    // through the SAME override layer the per-field variant edit uses
    // (block.overrides[<variant>]) and NEVER mutates the base — so editing Variant
    // 1 leaves Flagship untouched. On Flagship it edits the base directly.
    // // Only BLOCK-level fields (text/label/title/kicker) + component-INSTANCE slots
    // are variant-overridable (that is exactly what render.js `applyOverride`
    // consumes); nested quiz/intro/done/item copy has NO per-variant path, so it is
    // enumerated for Flagship editing only and EXCLUDED when a variant is active
    // (matching it there would silently rewrite the shared base). htmlEmbed srcdoc
    // is deliberately out of scope (string-replacing markup is unsafe).
    // The core below is PURE + fenced for the headless suite.
    /* @fr-start */
    function frCount(value, needle) {
      if (!needle) return 0;
      var s = value == null ? "" : String(value), n = 0, i = 0;
      while ((i = s.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
      return n;
    }
    function frReplaceAll(value, needle, rep) {
      if (!needle) return value == null ? "" : String(value);
      return (value == null ? "" : String(value)).split(needle).join(rep == null ? "" : rep);
    }
    // #78: word count for a single copy string. Rich-text fields (list/summary) store
    // inline HTML, so strip tags + fold entities to whitespace before counting, then
    // count whitespace-delimited runs. PURE — used for the F&R total-copy metric and
    // guarded in tests/run.js.
    function frWords(value) {
      var s = value == null ? "" : String(value);
      s = s.replace(/<[^>]+>/g, " ");                 // drop inline tags
      s = s.replace(/&nbsp;/gi, " ").replace(/&[a-z0-9#]+;/gi, ""); // nbsp -> space, other entities -> glued
      var m = s.match(/\S+/g);
      return m ? m.length : 0;
    }
    // Enumerate every text-copy target in the doc. When `variant` is set, only the
    // variant-overridable targets are returned. Each target = { host, key, isSlot,
    // overridable, label, pageIndex }. PURE (no closure deps).
    function frTargets(d, variant) {
      var out = [];
      function push(t) { if (variant && !t.overridable) return; out.push(t); }
      function nested(obj, key, pageIndex, label) {
        if (obj && typeof obj[key] === "string") push({ host: obj, key: key, isSlot: false, overridable: false, label: label, pageIndex: pageIndex });
      }
      function addBlock(b, pageIndex) {
        if (!b || typeof b !== "object") return;
        // block-level direct copy (variant-overridable via applyOverride top-level keys)
        ["text", "label", "title", "kicker", "caption"].forEach(function (k) {
          if (typeof b[k] === "string") push({ host: b, key: k, isSlot: false, overridable: true, label: (b.type || "block") + " · " + k, pageIndex: pageIndex });
        });
        // component instances — slot copy (variant-overridable via slots merge)
        if (b.type === "componentGrid" && Array.isArray(b.instances)) {
          b.instances.forEach(function (ins) {
            if (ins && ins.slots) Object.keys(ins.slots).forEach(function (key) {
              if (typeof ins.slots[key] === "string") push({ host: ins, key: key, isSlot: true, overridable: true, label: "card · " + key, pageIndex: pageIndex });
            });
          });
        }
        // #90: table cell copy (base-only) — each cell is a { t } object
        if (b.type === "table" && Array.isArray(b.rows)) {
          b.rows.forEach(function (row) { (row || []).forEach(function (cell) {
            if (cell && typeof cell.t === "string") push({ host: cell, key: "t", isSlot: false, overridable: false, label: "table cell", pageIndex: pageIndex });
          }); });
        }
        // nested quiz copy (base-only, no per-variant path)
        if (b.intro) { nested(b.intro, "body", pageIndex, "quiz intro"); nested(b.intro, "startLabel", pageIndex, "quiz start"); }
        if (b.done) {
          nested(b.done, "title", pageIndex, "quiz done · title"); nested(b.done, "body", pageIndex, "quiz done · body"); nested(b.done, "summary", pageIndex, "quiz summary");
          if (b.done.retry) nested(b.done.retry, "label", pageIndex, "quiz retry");
        }
        if (Array.isArray(b.questions)) b.questions.forEach(function (q) {
          if (!q) return;
          ["methodLabel", "stemBefore", "stemAfter", "prompt", "feedbackCorrect", "feedbackIncorrect"].forEach(function (k) { nested(q, k, pageIndex, "question · " + k); });
          if (Array.isArray(q.options)) q.options.forEach(function (opt) { nested(opt, "text", pageIndex, "option"); });
          if (Array.isArray(q.cards)) q.cards.forEach(function (card) { nested(card, "text", pageIndex, "sort card"); });
          if (Array.isArray(q.cats)) q.cats.forEach(function (cat) { nested(cat, "label", pageIndex, "sort category"); });
        });
      }
      var pages = (d && d.pages) || [];
      pages.forEach(function (page, pi) {
        (function walk(blocks) {
          (blocks || []).forEach(function (b) {
            if (!b || typeof b !== "object") return;
            addBlock(b, pi);
            if (Array.isArray(b.children)) walk(b.children);
            if (Array.isArray(b.columns)) b.columns.forEach(walk);
            if (Array.isArray(b.items)) b.items.forEach(function (it) {
              if (!it) return;
              nested(it, "title", pi, "item title"); // accordion / sequence step title (base-only)
              if (Array.isArray(it.children)) walk(it.children);
              if (Array.isArray(it.front)) walk(it.front);
            });
            // #215: screens[].markers[].blocks — inlined so the tests' F&R slice stays standalone
            if (Array.isArray(b.screens)) b.screens.forEach(function (s) { if (s && Array.isArray(s.markers)) s.markers.forEach(function (m) { if (m && Array.isArray(m.blocks)) walk(m.blocks); }); });
          });
        })(page && page.blocks);
      });
      return out;
    }
    // Effective current value of a target (the override wins when previewing a
    // variant that has one, else the base) — the string F&R searches + replaces in.
    function frValueOf(t, variant) {
      if (variant && t.overridable) {
        var o = t.host.overrides && t.host.overrides[variant];
        if (o) {
          if (t.isSlot) { if (o.slots && o.slots[t.key] != null) return String(o.slots[t.key]); }
          else if (o[t.key] != null) return String(o[t.key]);
        }
      }
      if (t.isSlot) return (t.host.slots && t.host.slots[t.key] != null) ? String(t.host.slots[t.key]) : "";
      return t.host[t.key] != null ? String(t.host[t.key]) : "";
    }
    // Write a target's value to the correct layer: the variant override (when a
    // variant is active + the target is overridable), else the base. Mirrors
    // writeVariantField's prune-on-empty so an inherited field carries no override.
    function frWrite(t, variant, value) {
      if (variant && t.overridable) {
        var host = t.host;
        host.overrides = host.overrides || {};
        var o = host.overrides[variant] || (host.overrides[variant] = {});
        if (value === "" || value == null) { if (t.isSlot) { if (o.slots) delete o.slots[t.key]; } else delete o[t.key]; }
        else { if (t.isSlot) { o.slots = o.slots || {}; o.slots[t.key] = value; } else o[t.key] = value; }
        if (o.slots && !Object.keys(o.slots).length) delete o.slots;
        if (!Object.keys(o).length) delete host.overrides[variant];
        if (host.overrides && !Object.keys(host.overrides).length) delete host.overrides;
      } else {
        if (t.isSlot) { t.host.slots = t.host.slots || {}; t.host.slots[t.key] = value; }
        else t.host[t.key] = value;
      }
    }
    // #104 side-by-side: does target `t` HOLD a variant override for `variant`?
    // (overridable target + a stored value on host.overrides[variant] for its key).
    // Pure over the host — drives which copy-editor variant cells are "held" (locked,
    // editable on unlock) vs "empty" (offer create-from-flagship). Mirrors frValueOf's
    // override lookup exactly so the two never disagree.
    function frHasOverride(t, variant) {
      if (!t || !t.overridable || !variant) return false;
      var o = t.host && t.host.overrides && t.host.overrides[variant];
      if (!o) return false;
      return t.isSlot ? !!(o.slots && o.slots[t.key] != null) : (o[t.key] != null);
    }
    // Total occurrences across every target, for the live count.
    function frTotal(targets, variant, needle) {
      return targets.reduce(function (n, t) { return n + frCount(frValueOf(t, variant), needle); }, 0);
    }
    // The next match at-or-after `after` = { tIndex, pos }, wrapping ONCE to the top.
    // Returns { tIndex, start } or null.
    function frNext(targets, variant, needle, after) {
      if (!needle || !targets.length) return null;
      var startT = after ? after.tIndex : 0, startPos = after ? after.pos : 0;
      for (var i = startT; i < targets.length; i++) {
        var val = frValueOf(targets[i], variant);
        var idx = val.indexOf(needle, i === startT ? startPos : 0);
        if (idx !== -1) return { tIndex: i, start: idx };
      }
      for (var j = 0; j <= startT && j < targets.length; j++) { // wrap
        var v2 = frValueOf(targets[j], variant);
        var i2 = v2.indexOf(needle, 0);
        if (i2 !== -1) return { tIndex: j, start: i2 };
      }
      return null;
    }
    /* @fr-end */
    window.__frCore = { count: frCount, replaceAll: frReplaceAll, targets: frTargets, valueOf: frValueOf, write: frWrite, total: frTotal, next: frNext, words: frWords, hasOverride: frHasOverride };
    var frCore = window.__frCore; // in-app alias the dialog composes from

    var frOpen = false;
    function openFindReplace() {
      if (frOpen) return; frOpen = true;
      var modal = h("div", "modal-overlay fr-overlay");
      var box = h("div", "modal-box fr-box"); modal.appendChild(box);
      // Which layer replacements target: "" = Flagship (base), "<name>" = a variant
      // override. Defaults to whatever is being previewed; a selector below lets you
      // aim replacements at a variant WITHOUT leaving Flagship (it previews it for you).
      var frVariant = E.activeVariant || "";
      var variants = (E.doc.variants || []);
      function scopeSub() { return frVariant ? ("Editing “" + frVariant + "” — replacements are saved as a variant override; Flagship copy is untouched.") : "Editing Flagship — replacements edit the base copy."; }
      modalHead(box, "Find & replace", scopeSub());
      var scopeNote = null;
      if (variants.length) {
        var vr = modalField(box, "Apply to");
        // Picking a target ALSO previews it on the canvas, so replacements are visible
        // and the highlighted-variant canvas matches the scope you're editing.
        var vpairs = [["Flagship (base copy)", ""]].concat(variants.map(function (v) { return ["Variant · " + v, v]; }));
        var vsel = dsSelect(vpairs, frVariant || "", function (v) {
          frVariant = v;
          previewVariant(frVariant || null);
          if (scopeNote) scopeNote.textContent = scopeSub();
          searchFrom = { tIndex: 0, pos: 0 }; cur = null; refresh();
        });
        vsel.classList.add("modal-field__control"); // keep the modal field layout on the DS select
        vr.appendChild(vsel);
        scopeNote = h("div", "fr-scope-note", scopeSub());
        box.appendChild(scopeNote);
      }
      // #78: total word count across course copy. Doc copy is synchronous (frTargets over
      // the Flagship base — a course-level metric, so it ignores the active variant scope).
      var wordCount = h("div", "fr-wordcount");
      box.appendChild(wordCount);
      var docWords = frCore.targets(E.doc, "").reduce(function (n, t) { return n + frCore.words(frCore.valueOf(t, "")); }, 0);
      function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
      wordCount.textContent = fmtNum(docWords) + " word" + (docWords === 1 ? "" : "s") + " in course copy";
      var findInput = modalText(box, "Find", "", "Case-sensitive, exact");
      var replaceInput = modalText(box, "Replace", "", "Replacement text");
      var status = h("div", "fr-status", "Type to search.");
      box.appendChild(status);
      var preview = h("div", "fr-preview"); preview.style.display = "none";
      box.appendChild(preview);

      var cur = null;        // current highlighted match { tIndex, start }
      var searchFrom = null; // { tIndex, pos } to resume from

      function ts() { return frCore.targets(E.doc, frVariant); }
      function needle() { return findInput.value; }

      function showPreview() {
        if (!cur) { preview.style.display = "none"; return; }
        var arr = ts(); var t = arr[cur.tIndex]; if (!t) { preview.style.display = "none"; return; }
        var val = frCore.valueOf(t, frVariant), n = needle();
        var a = Math.max(0, cur.start - 24), b = Math.min(val.length, cur.start + n.length + 24);
        var pre = (a > 0 ? "…" : "") + val.slice(a, cur.start);
        var mid = val.slice(cur.start, cur.start + n.length);
        var post = val.slice(cur.start + n.length, b) + (b < val.length ? "…" : "");
        preview.textContent = "";
        var loc = h("div", "fr-preview__loc", "Page " + (t.pageIndex + 1) + " · " + t.label);
        var snip = h("div", "fr-preview__snip");
        snip.appendChild(document.createTextNode(pre));
        snip.appendChild(h("mark", "fr-hit", mid));
        snip.appendChild(document.createTextNode(post));
        preview.appendChild(loc); preview.appendChild(snip);
        preview.style.display = "";
      }
      function refresh() {
        var arr = ts(), n = needle();
        if (!n) { status.textContent = "Type to search."; cur = null; showPreview(); return; }
        var total = frCore.total(arr, frVariant, n);
        status.textContent = total ? (total + " match" + (total === 1 ? "" : "es")) : "No matches.";
        showPreview();
      }
      function findNext() {
        var arr = ts(), n = needle();
        if (!n) { refresh(); return; }
        cur = frCore.next(arr, frVariant, n, searchFrom || { tIndex: 0, pos: 0 });
        if (cur) searchFrom = { tIndex: cur.tIndex, pos: cur.start + n.length };
        else searchFrom = { tIndex: 0, pos: 0 };
        var total = frCore.total(arr, frVariant, n);
        status.textContent = total ? ((cur ? "Match found — " : "") + total + " match" + (total === 1 ? "" : "es")) : "No matches.";
        showPreview();
      }
      function replaceOne() {
        var n = needle(); if (!n) return;
        if (!cur) { findNext(); return; }
        var arr = ts(), t = arr[cur.tIndex]; if (!t) { cur = null; findNext(); return; }
        var val = frCore.valueOf(t, frVariant);
        if (val.substr(cur.start, n.length) !== n) { cur = null; findNext(); return; } // stale — re-find
        var nv = val.slice(0, cur.start) + replaceInput.value + val.slice(cur.start + n.length);
        pushHistory();
        frCore.write(t, frVariant, nv);
        mount();
        if (copyEditorIsOpen()) { renderCopyEditorDoc(); renderCopyEditorTools(); } // #119: reflect the replace in the open copy view
        searchFrom = { tIndex: cur.tIndex, pos: cur.start + replaceInput.value.length };
        cur = null;
        findNext();
        findInput.focus();
      }
      function replaceAll() {
        var n = needle(); if (!n) return;
        var arr = ts(), rep = replaceInput.value, hits = 0;
        var changed = arr.filter(function (t) { return frCore.count(frCore.valueOf(t, frVariant), n) > 0; });
        if (!changed.length) { status.textContent = "No matches."; return; }
        pushHistory();
        changed.forEach(function (t) {
          var val = frCore.valueOf(t, frVariant);
          hits += frCore.count(val, n);
          frCore.write(t, frVariant, frCore.replaceAll(val, n, rep));
        });
        mount();
        if (copyEditorIsOpen()) { renderCopyEditorDoc(); renderCopyEditorTools(); } // #119: reflect the replace in the open copy view
        cur = null; searchFrom = { tIndex: 0, pos: 0 };
        status.textContent = "Replaced " + hits + " match" + (hits === 1 ? "" : "es") + ".";
        preview.style.display = "none";
        findInput.focus();
      }

      findInput.addEventListener("input", function () { searchFrom = { tIndex: 0, pos: 0 }; cur = null; refresh(); });
      var findNextBtn = h("button", "prop-btn", "Find next");
      findNextBtn.addEventListener("click", function () { findNext(); findInput.focus(); });
      var replaceBtn = h("button", "prop-btn", "Replace");
      replaceBtn.addEventListener("click", replaceOne);
      var replaceAllBtn = h("button", "prop-btn prop-btn--accent", "Replace all");
      replaceAllBtn.addEventListener("click", replaceAll);
      function close() { modal.remove(); frOpen = false; document.removeEventListener("keydown", onKey, true); }
      var actions = h("div", "modal-actions");
      var cancel = h("button", "prop-btn prop-btn--danger", "Close");
      cancel.addEventListener("click", close);
      actions.appendChild(findNextBtn); actions.appendChild(replaceBtn);
      actions.appendChild(cancel); actions.appendChild(replaceAllBtn);
      box.appendChild(actions);

      function onKey(e) {
        if (!frOpen) return;
        if (e.key === "Escape") { e.preventDefault(); close(); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.target === replaceInput) replaceOne(); else findNext();
        }
      }
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(modal);
      // seed Find with the current text selection when there is one
      var selText = window.getSelection ? String(window.getSelection()) : "";
      if (selText && selText.length <= 80 && selText.indexOf("\n") === -1) { findInput.value = selText; refresh(); }
      findInput.focus(); if (findInput.select) findInput.select();
    }
    window.__openFindReplace = openFindReplace; // test + toolbar hook

    kernel.expose({
      openFindReplace: openFindReplace, frWords: frWords, wireCopyEditor: wireCopyEditor,
      mountViewToggle: mountViewToggle
    });
  }

  window.VersoCopyEditor = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoCopyEditor;
})();
