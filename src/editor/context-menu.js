// editor/context-menu.js -- right-click, everywhere (arch-P3b-07q).
//
// Two halves that were 900 lines apart in editor.js and are one thing: the MENU (build it, place
// it so it never runs off-screen, dismiss it on an outside click, Escape or blur) and the WIRING
// that decides what a right-click at a given point is actually ON -- a block, a page, a chapter,
// the canvas itself.
//
// It joins the overlay LAYER STACK rather than owning Escape. That is the spine's rule: one Escape
// contract, and every dismissable surface pushes and pops rather than each binding its own handler
// and fighting over the order.
//
// Four names from editor.js, which is what a menu framework should cost.
//
// Editor chrome only: it offers actions on the document, but nothing here renders or exports.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pasteClipboard", "previewVariant", "newVariantPrompt", "reselectBlockNode", "popLayer", "pushLayer",
      "openSettingsSection", "canvas", "variantNames", "moveBlock", "reapplyBlock", "duplicateBlock",
      "copySelection", "copyBlockStyle", "pasteBlockStyle", "ungroupBlock", "saveBlockAsComponent", "clearBlockContentAction",
      "canSplitAtBlock", "splitPageAtBlock", "deleteBlockByRef", "isHiddenIn", "toggleHiddenIn", "versionNames",
      "isHiddenInVersion", "toggleHiddenInVersion", "IMG_VERSION_TYPES", "imgVariantSrc", "uploadImageVariant", "pushHistory",
      "setImgVariantSrc", "renderInspector", "inMulti", "canMergeTextBoxes", "mergeTextBoxes", "groupMulti",
      "saveSelectionAsSectionMaster", "deleteSelection", "setSelection", "activeVersion", "multiSel", "inspector",
      "activeVariant", "clipboard", "styleClipboard", "enteredBlock", "setEnteredBlock"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        pasteClipboard = E.pasteClipboard,
        previewVariant = E.previewVariant,
        newVariantPrompt = E.newVariantPrompt,
        reselectBlockNode = E.reselectBlockNode,
        popLayer = E.popLayer,
        pushLayer = E.pushLayer,
        openSettingsSection = E.openSettingsSection,
        canvas = E.canvas,
        variantNames = E.variantNames,
        moveBlock = E.moveBlock,
        reapplyBlock = E.reapplyBlock,
        duplicateBlock = E.duplicateBlock,
        copySelection = E.copySelection,
        copyBlockStyle = E.copyBlockStyle,
        pasteBlockStyle = E.pasteBlockStyle,
        ungroupBlock = E.ungroupBlock,
        saveBlockAsComponent = E.saveBlockAsComponent,
        clearBlockContentAction = E.clearBlockContentAction,
        canSplitAtBlock = E.canSplitAtBlock,
        splitPageAtBlock = E.splitPageAtBlock,
        deleteBlockByRef = E.deleteBlockByRef,
        isHiddenIn = E.isHiddenIn,
        toggleHiddenIn = E.toggleHiddenIn,
        versionNames = E.versionNames,
        isHiddenInVersion = E.isHiddenInVersion,
        toggleHiddenInVersion = E.toggleHiddenInVersion,
        IMG_VERSION_TYPES = E.IMG_VERSION_TYPES,
        imgVariantSrc = E.imgVariantSrc,
        uploadImageVariant = E.uploadImageVariant,
        pushHistory = E.pushHistory,
        setImgVariantSrc = E.setImgVariantSrc,
        renderInspector = E.renderInspector,
        inMulti = E.inMulti,
        canMergeTextBoxes = E.canMergeTextBoxes,
        mergeTextBoxes = E.mergeTextBoxes,
        groupMulti = E.groupMulti,
        saveSelectionAsSectionMaster = E.saveSelectionAsSectionMaster,
        deleteSelection = E.deleteSelection,
        setSelection = E.setSelection;

    // ---- context-menu framework ----
    var ctxMenuEl = null;
    function ensureCtxStyle() {
      if (document.getElementById("ctx-menu-style")) return;
      var s = document.createElement("style"); s.id = "ctx-menu-style";
      s.textContent =
        ".ctx-menu{position:fixed;z-index:9999;min-width:208px;background:#262626;border:1px solid #444;border-radius:9px;padding:5px;box-shadow:0 12px 32px rgba(0,0,0,.45);font:12px/1.3 Inter,system-ui,sans-serif;color:#e6e6e6;}" +
        ".ctx-item{display:flex;align-items:center;min-height:30px;padding:6px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;color:#e6e6e6;transition:background .1s ease,color .1s ease;}" +
        ".ctx-item:hover{background:#0d99ff;color:#fff;}" +
        ".ctx-item--danger{color:#ff8a8a;}" +
        ".ctx-item--danger:hover{background:rgba(255,107,107,.16);color:#ff6b6b;}" +
        ".ctx-item--active{color:#0d99ff;font-weight:600;}" +
        ".ctx-item--active:hover{color:#fff;}" +
        ".ctx-item--disabled{color:#8a8a8a;cursor:default;}" +
        ".ctx-item--disabled:hover{background:transparent;color:#8a8a8a;}" +
        ".ctx-item__hint{margin-left:auto;padding-left:14px;font-size:11px;color:#8a8a8a;}" +
        ".ctx-sep{height:1px;background:#3a3a3a;margin:5px 8px;}" +
        ".ctx-head{padding:8px 12px 4px;font-size:11px;font-weight:600;letter-spacing:0;color:#8a8a8a;}" +
        // uio-O-W2 (OVL-13): submenus. The parent row keeps a trailing chevron; the panel sits to
        // its right, overlapping by the menu's own padding so the pointer never crosses a gap.
        ".ctx-item--parent{position:relative;}" +
        ".ctx-item__chev{margin-left:auto;padding-left:14px;color:#8a8a8a;}" +
        ".ctx-item--parent:hover .ctx-item__chev{color:#fff;}" +
        ".ctx-menu--sub{position:absolute;left:100%;top:-5px;margin-left:-2px;display:none;}" +
        ".ctx-menu--sub.is-flipped{left:auto;right:100%;margin-left:0;margin-right:-2px;}" +
        ".ctx-item--parent:hover > .ctx-menu--sub{display:block;}" +
        ".canvas.is-variant-preview{outline:2px solid #8e44ad;outline-offset:-2px;}" +
        ".canvas.is-version-preview{outline:2px solid #0e9384;outline-offset:-2px;}";
      document.head.appendChild(s);
    }
    function closeCtxMenu() {
      if (!ctxMenuEl) return;
      ctxMenuEl.remove(); ctxMenuEl = null;
      document.removeEventListener("mousedown", onCtxOutside, true);
      popLayer("ctx-menu"); // uio-F05: Escape is the layer stack's; focus returns to the trigger
    }
    function onCtxOutside(e) { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(); }
    // uio-F05: opts.escalate = { label, tab, section } appends the spine's required route from
    // this menu of verbs into the settings sheet, after a separator.
    // uio-O-W2 (OVL-13): a menu never renders a section that has nothing in it. A heading whose
    // group holds no actionable entry is dropped, and the separators that framed it go with it, so
    // a menu can offer a section unconditionally and simply not show it when it is empty. PURE, so
    // it is regression-guarded in tests/run.js.
    function pruneEmptyMenuSections(items) {
      var kept = [], i;
      for (i = 0; i < (items || []).length; i++) {
        var it = items[i];
        if (it && it.head) {
          var hasEntry = false;
          for (var j = i + 1; j < items.length; j++) {
            var nx = items[j];
            if (!nx || nx.head) break;          // the next section starts: this one was empty
            if (nx.sep) continue;               // a rule is furniture, not an entry
            hasEntry = true; break;
          }
          if (!hasEntry) continue;              // drop the heading itself
        }
        kept.push(it);
      }
      // Collapse the separators left stranded by a dropped section: no leading rule, no trailing
      // rule, never two in a row, and never a rule sitting directly under a heading.
      var out = [];
      for (i = 0; i < kept.length; i++) {
        var k = kept[i];
        if (k && k.sep) {
          var prev = out[out.length - 1];
          if (!prev || prev.sep || prev.head) continue;
          var nextReal = null;
          for (var n = i + 1; n < kept.length; n++) { if (kept[n] && !kept[n].sep) { nextReal = kept[n]; break; } }
          if (!nextReal) continue;
        }
        out.push(k);
      }
      return out;
    }
    // Render one menu level. A `submenu` entry opens its own panel to the side on hover, so a
    // section that would otherwise spend a third of the menu on rows you rarely want collapses to
    // one row you can ignore. Submenus are display-only nesting -- they never introduce a second
    // dismissal or a second Escape owner; the whole tree closes with its root.
    function buildCtxMenuEl(items, isSub) {
      var m = h("div", "ctx-menu" + (isSub ? " ctx-menu--sub" : ""));
      items.forEach(function (it) {
        if (!it) return;
        if (it.sep) { m.appendChild(h("div", "ctx-sep")); return; }
        if (it.head) { m.appendChild(h("div", "ctx-head", it.head)); return; }
        // uio-P-C05: `disabled` + `hint` complete the DS ContextMenu contract — an entry can be listed
        // as unavailable, with a trailing state word ("Soon"), instead of being hidden or renamed.
        var el = h("div", "ctx-item" + (it.danger ? " ctx-item--danger" : "") + (it.active ? " ctx-item--active" : "") + (it.disabled ? " ctx-item--disabled" : ""), it.label);
        if (it.hint) el.appendChild(h("span", "ctx-item__hint", it.hint));
        if (it.submenu && it.submenu.length) {
          el.classList.add("ctx-item--parent");
          el.appendChild(h("span", "ctx-item__chev", "›"));
          var sub = buildCtxMenuEl(pruneEmptyMenuSections(it.submenu), true);
          el.appendChild(sub);
          // Flip to the left when the panel would run off the window, measured on open rather
          // than guessed, because a menu near the right edge is the normal case on a wide canvas.
          el.addEventListener("mouseenter", function () {
            sub.classList.remove("is-flipped");
            var r = sub.getBoundingClientRect();
            if (r.right > window.innerWidth - 8) sub.classList.add("is-flipped");
          });
          m.appendChild(el);
          return;
        }
        if (!it.disabled) el.addEventListener("click", function () { closeCtxMenu(); if (it.onClick) it.onClick(); });
        m.appendChild(el);
      });
      return m;
    }
    function showContextMenu(x, y, items, opts) {
      ensureCtxStyle(); closeCtxMenu();
      if (opts && opts.escalate) {
        items = items.concat([{ sep: true }, {
          label: opts.escalate.label || "All settings…",
          onClick: function () { openSettingsSection(opts.escalate.tab || "project", opts.escalate.section || null); }
        }]);
      }
      var m = buildCtxMenuEl(pruneEmptyMenuSections(items));
      document.body.appendChild(m);
      var r = m.getBoundingClientRect();
      m.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
      m.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
      ctxMenuEl = m;
      pushLayer("ctx-menu", closeCtxMenu);
      setTimeout(function () { document.addEventListener("mousedown", onCtxOutside, true); }, 0);
    }

    // ---- context-menu wiring ----
    function findTargetFromEvent(e) {
      var node = e.target;
      while (node && node !== canvas) {
        if (node.__instance) return { type: "instance", node: node, instance: node.__instance, block: node.__block };
        if (node.__block) return { type: "block", node: node, block: node.__block };
        node = node.parentNode;
      }
      return null;
    }
    // uio-O-W1 (OVL-14): ONE block verb list, two doors. Copy style, Save as component and
    // Clear content used to be reachable only by right-clicking a canvas object — a gesture
    // nothing in the UI advertises — so the inspector and the menu describing the same block
    // shared almost no vocabulary. This is the single definition of that list. The canvas
    // right-click and the inspector header's "..." overflow both render it, so the two doors
    // cannot drift apart, and its foot names the way back into the inspector.
    // target = { block, instance? } — the shape findTargetFromEvent returns.
    function blockMenuItems(target) {
      var items = [];
      var block = target && target.block;
      var host = (target && target.instance) || block;
      var vs = variantNames();
      if (block) {
        items.push({ label: "Duplicate", onClick: function () { duplicateBlock(block); } });
        items.push({ label: "Copy", onClick: function () { copySelection(); } });
        if (E.clipboard.length) {
          items.push({ label: "Paste", onClick: function () { pasteClipboard(); } });
          items.push({ label: "Paste without formatting", onClick: function () { pasteClipboard(true); } });
        }
        items.push({ label: "Copy style", onClick: function () { copyBlockStyle(block); } });
        if (E.styleClipboard) items.push({ label: "Paste style", onClick: function () { pasteBlockStyle(block); } });
        items.push({ label: "Move up", onClick: function () { moveBlock(block, -1); } });
        items.push({ label: "Move down", onClick: function () { moveBlock(block, 1); } });
        if (block.type === "group") items.push({ label: "Ungroup", onClick: function () { ungroupBlock(block); } });
        items.push({ label: "Save as component…", onClick: function () { saveBlockAsComponent(block); } });
        // #174: reset the block subtree to a blank skeleton (parity with the outliner menu).
        items.push({ label: "Clear content", onClick: function () { clearBlockContentAction([block]); } });
        if (canSplitAtBlock(block)) {
          items.push({ sep: true });
          items.push({ label: "Split page here", onClick: function () { splitPageAtBlock(block); } });
        }
        items.push({ sep: true });
        items.push({ label: "Delete", danger: true, onClick: function () { deleteBlockByRef(block); } });
      }
      items.push({ sep: true });
      // uio-O-W2 (OVL-13): these three groups used to be headings with a row per variant, and the
      // variant heading rendered even with nothing under it ("Variants (none yet)") — a third of
      // the menu spent on a feature the block does not use. Each is ONE row with a submenu now,
      // and with no variants at all the whole family collapses to a single ordinary "Add
      // variant…" entry. The "+" prefix is gone: it was a fourth style for "create" in a product
      // that already has filled buttons, ghost add-rows and plain menu verbs.
      if (vs.length) {
        // Variant TEXT is edited in the Design panel (the block is selected, so the panel already
        // shows its "Variant text" fields). The menu keeps only visibility + variant creation.
        var variantSub = vs.map(function (v) {
          return { label: (isHiddenIn(host, v) ? "✓ " : "") + "Hide in " + v, onClick: function () { toggleHiddenIn(host, v); } };
        });
        variantSub.push({ sep: true });
        variantSub.push({ label: "New variant…", onClick: function () { newVariantPrompt(); } });
        items.push({ label: "Variants", submenu: variantSub });
      } else {
        items.push({ label: "Add variant…", onClick: function () { newVariantPrompt(); } });
      }
      // #207: software-version show/hide tagging (mirrors the variant "Hide in <x>" family).
      // Only when the course has versions; while editing a version the toggle for THAT version
      // sits first for quick reach (hide this block from the release you're authoring).
      var versAll = versionNames();
      if (versAll.length) {
        var ordered = E.activeVersion ? [E.activeVersion].concat(versAll.filter(function (v) { return v !== E.activeVersion; })) : versAll;
        items.push({ label: "Software versions", submenu: ordered.map(function (v) {
          return { label: (isHiddenInVersion(host, v) ? "✓ " : "") + "Hide in " + v + (v === E.activeVersion ? " (current)" : ""), onClick: function () { toggleHiddenInVersion(host, v); } };
        }) });
      }
      // #148: image / hotspot base image — a direct "Upload image for <variant>" that
      // opens the file picker straight away and writes that variant's version (overrides[v].src).
      if (block && IMG_VERSION_TYPES[block.type] && vs.length) {
        var imgSub = [];
        vs.forEach(function (v) {
          var own = imgVariantSrc(block, v);
          imgSub.push({ label: (own ? "Replace image for " : "Upload image for ") + v, onClick: function () {
            uploadImageVariant(block, v, function () { reapplyBlock(block); reselectBlockNode(block, "block"); });
          } });
          if (own) imgSub.push({ label: "Remove " + v + " version", danger: true, onClick: function () { pushHistory(); setImgVariantSrc(block, v, null); reapplyBlock(block); reselectBlockNode(block, "block"); } });
        });
        items.push({ label: "Variant images", submenu: imgSub });
      }
      if (block) {
        items.push({ sep: true });
        items.push({ label: "Block settings", hint: "Inspector", onClick: function () { revealBlockSettings(block); } });
      }
      return items;
    }
    // The route the menu's foot names: select the block and open its own settings in the
    // inspector, so the menu always hands off to the panel rather than dead-ending.
    function revealBlockSettings(block) {
      if (!block) return;
      E.setEnteredBlock(block);
      reselectBlockNode(block, "block");
      renderInspector();
      if (E.inspector && E.inspector.scrollTo) E.inspector.scrollTo({ top: 0 });
    }
    function wireContextMenu() {
      canvas.addEventListener("contextmenu", function (e) {
        e.preventDefault(); // always replace the native menu on the canvas
        var vs = variantNames();
        var items = [];

        // While previewing a variant the canvas shows RESOLVED clones, so only offer
        // navigation between variants — not editing (that stays on the flagship).
        if (E.activeVariant) {
          items.push({ head: "Previewing: " + E.activeVariant });
          items.push({ label: "← Back to Flagship (edit)", onClick: function () { previewVariant(null); } });
          items.push({ sep: true });
          vs.forEach(function (v) { if (v !== E.activeVariant) items.push({ label: "Preview: " + v, onClick: function () { previewVariant(v); } }); });
          showContextMenu(e.clientX, e.clientY, items);
          return;
        }
        // #207: a version-only context is EDITABLE (the dynamic flagship), so it falls through to
        // the normal block menu below (which gains a "This version" show/hide section). A version
        // composed with a variant preview is read-only and handled by the activeVariant branch above.

        var target = findTargetFromEvent(e);
        // #131 multi-selection branch: right-clicking a block that is part of a >=2
        // selection KEEPS the set (don't reset to single) and offers set actions —
        // Merge text boxes (only when the whole set is text) / Group / Delete.
        if (target && target.type === "block" && inMulti(target.block) && E.multiSel.length >= 2) {
          items.push({ head: E.multiSel.length + " items selected" });
          if (canMergeTextBoxes(E.multiSel)) items.push({ label: "Merge text boxes", onClick: function () { mergeTextBoxes(); } });
          items.push({ label: "Group selection", onClick: function () { groupMulti(); } });
          items.push({ label: "Save selection to library…", onClick: function () { saveSelectionAsSectionMaster(); } }); // #22 section master
          items.push({ sep: true });
          items.push({ label: "Delete " + E.multiSel.length + " items", danger: true, onClick: function () { deleteSelection(); } });
          showContextMenu(e.clientX, e.clientY, items);
          return;
        }
        if (target) {
          setSelection(target.type === "instance" ? "instance" : "block", target.node);
          // uio-O-W1 (OVL-14): one shared definition, rendered identically by the inspector's
          // "..." overflow. An instance target keeps its variant/version section but not the
          // block verbs (matching the previous behaviour).
          items = items.concat(blockMenuItems(target.type === "block" ? target : { instance: target.instance }));
        } else {
          if (E.clipboard.length) { items.push({ label: "Paste", onClick: function () { pasteClipboard(); } }); items.push({ label: "Paste without formatting", onClick: function () { pasteClipboard(true); } }); items.push({ sep: true }); }
          items.push({ head: "Variants" });
          items.push({ label: "✓ Flagship", onClick: function () { previewVariant(null); } });
          vs.forEach(function (v) { items.push({ label: "Preview: " + v, onClick: function () { previewVariant(v); } }); });
          items.push({ sep: true });
          items.push({ label: "New variant…", onClick: function () { newVariantPrompt(); } });
        }
        showContextMenu(e.clientX, e.clientY, items);
      });
      window.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCtxMenu(); });
      window.addEventListener("blur", closeCtxMenu);
    }

    kernel.expose({
      showContextMenu: showContextMenu, closeCtxMenu: closeCtxMenu, wireContextMenu: wireContextMenu,
      // The canvas block toolbar's overflow button offers the SAME verb list as a right-click, so
      // it asks for the items rather than building a second one. It was still calling this by name
      // from editor.js after the region moved (arch-P3b-07).
      blockMenuItems: blockMenuItems
    });
  }

  window.VersoContextMenu = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoContextMenu;
})();
