// editor/actions.js -- what a click does, when the click is the learner's (arch-P3b-07).
//
// A nav button or a component instance can carry an ACTION: go to a page, exit the course, or
// nothing. This is the panel that sets one, and the small model behind it.
//
// The interesting part is what it refuses to do. An action targets a PAGE ID, never an index,
// because pages are reordered constantly and an index-based link silently starts pointing at the
// wrong page rather than breaking visibly. The panel names the target so a broken link reads as a
// missing name instead of a number.
//
// EXIT is offered but honest about itself: in the exported package it ends the SCORM session and
// hands the learner back to the LMS, and in the preview it can only say so -- there is nowhere to
// go. The hint says which, rather than letting an author believe they tested it.
//
// The "On click" list is the same idea one level up: the actions a whole block offers, in the
// order a learner meets them.
//
// Editor chrome only: it writes what render() will emit and the runtime will obey.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "mount", "interactReselect", "pushHistory", "colorFieldFlat", "selectRow",
      "sectionGroup", "segmentedLive", "ensureId", "pageDisplayName", "renderModelView", "NAV_ACTIONS",
      "blockLabel", "renderInspector", "panelSection", "startLink", "beginSections", "switchRow",
      "fieldRow", "buildFontPicker", "attachFontWarn", "reselectBlockNode", "renderBlockActionsSection", "endSections",
      "propHeader", "iconBtn", "ACTION_TYPES", "findPageOfBlock", "pageBlockCandidates", "startPick",
      "endPick", "blockById", "inspector", "doc",
      "setInspector"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        mount = E.mount,
        interactReselect = E.interactReselect,
        pushHistory = E.pushHistory,
        colorFieldFlat = E.colorFieldFlat,
        selectRow = E.selectRow,
        sectionGroup = E.sectionGroup,
        segmentedLive = E.segmentedLive,
        ensureId = E.ensureId,
        pageDisplayName = E.pageDisplayName,
        renderModelView = E.renderModelView,
        NAV_ACTIONS = E.NAV_ACTIONS,
        blockLabel = E.blockLabel,
        renderInspector = E.renderInspector,
        panelSection = E.panelSection,
        startLink = E.startLink,
        beginSections = E.beginSections,
        switchRow = E.switchRow,
        fieldRow = E.fieldRow,
        buildFontPicker = E.buildFontPicker,
        attachFontWarn = E.attachFontWarn,
        reselectBlockNode = E.reselectBlockNode,
        renderBlockActionsSection = E.renderBlockActionsSection,
        endSections = E.endSections,
        propHeader = E.propHeader,
        iconBtn = E.iconBtn,
        ACTION_TYPES = E.ACTION_TYPES,
        findPageOfBlock = E.findPageOfBlock,
        pageBlockCandidates = E.pageBlockCandidates,
        startPick = E.startPick,
        endPick = E.endPick,
        blockById = E.blockById;

    // ---- Actions (flagship: prototype navigation) ----------------------------
    // A navigable element (a nav-button block or a component instance) carries
    // action.goto = a page id. This is set here (dropdown or drag-to-link), drawn
    // as an accent connector on the canvas, and followed in demo mode.
    function pageIndexById(id) { for (var i = 0; i < E.doc.pages.length; i++) if (E.doc.pages[i].id === id) return i; return -1; }
    function pageById(id) { var i = pageIndexById(id); return i >= 0 ? E.doc.pages[i] : null; }
    function currentGoto(host) { return (host.action && host.action.goto) ? host.action.goto : ""; }
    // Combined action selector value: "__exit" for the Exit-course DO-action, else
    // the goto page id (or "" for none). Keeps the single "On click" dropdown one control.
    var EXIT_ACTION = "__exit";
    function currentAction(host) { return (host.action && host.action.exit) ? EXIT_ACTION : currentGoto(host); }
    function setGoto(host, pageId) {
      pushHistory();
      if (pageId) host.action = { goto: pageId };
      else if (host.action) delete host.action;
    }
    function setExitAction(host) { pushHistory(); host.action = { exit: true }; }
    function setAction(host, v) { if (v === EXIT_ACTION) setExitAction(host); else setGoto(host, v); }

    // Actions inspector section. host = the object that holds .action (an instance
    // or a block); sourceNode = its canvas node; reselect = re-select after remount.
    function buildActions(host, sourceNode, reselect) {
      var _actRoot = E.inspector; E.setInspector(panelSection(_actRoot, "Actions"));
      var opts = [["No navigation", ""]]
        .concat(E.doc.pages.map(function (p) { return [pageDisplayName(p, E.doc), p.id]; }))
        .concat([["Exit course (end SCORM session)", EXIT_ACTION]]);
      selectRow("On click", opts, currentAction(host), function (v) { setAction(host, v); mount(); reselect(); });
      var drag = h("button", "prop-btn", "⤳  Drag onto a page to link");
      drag.title = "Press here and drag onto a target frame on the canvas";
      drag.addEventListener("mousedown", function (e) { e.preventDefault(); startLink(host, sourceNode, reselect); });
      E.inspector.appendChild(drag);
      if (currentAction(host) === EXIT_ACTION) {
        E.inspector.appendChild(h("div", "insp-hint", "Exits the course — ends the SCORM session (LMSFinish) and hands the learner back to the LMS. In demo mode it just shows a notice; test the real exit in the LMS."));
      } else if (currentGoto(host)) {
        var tgt = pageById(currentGoto(host));
        E.inspector.appendChild(h("div", "insp-hint", "Navigates to “" + (tgt ? tgt.name : currentGoto(host)) + "”. Click it in demo mode to follow the link."));
      } else {
        E.inspector.appendChild(h("div", "insp-hint", "No navigation set. Drag onto a frame, or pick a page above."));
      }
      E.setInspector(_actRoot);
    }

    // a nav-button block selected -> its label + Actions
    function renderNavButtonInspector(node) {
      var block = node.__block;
      var head = h("div", "prop-component");
      head.appendChild(h("span", null, "Navigation button"));
      E.inspector.appendChild(head);

      // #161: canonical taxonomy — Content (label), Appearance (button style), Behaviour
      // (on-click navigation). renderBlockActionsSection then pins the box Appearance/Layout/
      // Spacing container sections (its own begin/endSections) + the Actions footer.
      beginSections();

      // Content — the button label.
      sectionGroup("Content", "Label", function (secBody) {
        var row = h("div", "insp-row"); row.appendChild(h("span", "insp-row__label", "Text"));
        var input = h("input", "prop-text"); input.type = "text"; input.spellcheck = false; input.value = block.text || "";
        input.addEventListener("input", function () { block.text = input.value; if (node.textContent !== input.value) node.textContent = input.value; renderModelView(); });
        row.appendChild(input); secBody.appendChild(row);
      });

      // Appearance — unified, live-apply button style (never rebuilds the panel, so the
      // button stays selected on every change; colours are real pickers).
      sectionGroup("Appearance", "Style", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try {
        function restyle() { window.applyButtonStyle(node, block); renderModelView(); }

        colorFieldFlat("Fill", block.bg, function (v) { if (v == null) delete block.bg; else block.bg = v; restyle(); });
        colorFieldFlat("Text", block.fg, function (v) { if (v == null) delete block.fg; else block.fg = v; restyle(); });
        // Per-block hover-state override (KK); empty falls back to the theme bundle.
        colorFieldFlat("Hover fill", block.hoverBg, function (v) { if (v == null) delete block.hoverBg; else block.hoverBg = v; restyle(); });
        colorFieldFlat("Hover text", block.hoverFg, function (v) { if (v == null) delete block.hoverFg; else block.hoverFg = v; restyle(); });

        segmentedLive("Size", [["S", "s"], ["M", "m"], ["L", "l"]], function (v) { return (block.size || "m") === v; },
          function (v) { if (v === "m") delete block.size; else block.size = v; restyle(); });
        segmentedLive("Shape", [["rounded", ""], ["pill", "pill"], ["square", "square"]], function (v) { return (block.shape || "") === v; },
          function (v) { if (!v) delete block.shape; else block.shape = v; delete block.radius; restyle(); });
        segmentedLive("Width", [["hug", false], ["full", true]], function (v) { return !!block.fullWidth === v; },
          function (v) { block.fullWidth = v; restyle(); });

        // Stroke: on/off + colour + width (colour/width always shown; take effect when on)
        switchRow("Stroke", function () { return !!block.stroke; },
          function (v) { if (!v) delete block.stroke; else block.stroke = true; restyle(); });
        colorFieldFlat("Stroke colour", block.strokeColor, function (v) { if (v == null) delete block.strokeColor; else block.strokeColor = v; restyle(); });
        fieldRow("Stroke width", block.strokeWidth == null ? "" : block.strokeWidth, function (v) { var n = parseFloat(v); if (isNaN(n)) delete block.strokeWidth; else block.strokeWidth = n; restyle(); }, "1", 0.5, 0, 12, "dl-gap");

        E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Font"));
        var navFontSel = buildFontPicker(block.font || "", function (v) { if (!v) delete block.font; else block.font = v; restyle(); });
        E.inspector.appendChild(navFontSel);
        E.inspector.appendChild(attachFontWarn(navFontSel));
        } finally { E.setInspector(_ins); }
      });

      // Behaviour — on-click navigation target (shared buildActions).
      sectionGroup("Behaviour", "On click", function (secBody) {
        var _ins = E.inspector; E.setInspector(secBody);
        try { buildActions(block, node, function () { reselectBlockNode(block, "navButton"); }); } finally { E.setInspector(_ins); }
      });

      // #165: keep the buffer OPEN across the shared footer so the nav's Content/Appearance/
      // Behaviour + the footer's Appearance(box)/Layout/Spacing emit as ONE PanelLayout-sorted
      // stream (Behaviour after Layout/Spacing), then flush once.
      renderBlockActionsSection(block);
      endSections(E.inspector);
    }

    // ---- "On click ->" action list -------------------------------------------
    function renderOnClickSection(block) {
      var list = block.interactions || [];
      E.inspector.appendChild(propHeader("On click", function () {
        pushHistory();
        ensureId(block);
        block.interactions = block.interactions || [];
        block.interactions.push({ trigger: { type: "click" }, action: { type: "next" } });
        mount(); interactReselect(block);
      }, "Add a click action"));

      if (!list.length) {
        E.inspector.appendChild(h("div", "insp-hint", "No click actions. Add one, or drag the handle on the element onto a target page to link."));
      }

      list.forEach(function (ix, idx) {
        var a = ix.action || (ix.action = { type: "next" });
        var rowHead = h("div", "insp-int-row");
        rowHead.appendChild(h("span", "insp-int-row__idx", "Action " + (idx + 1)));
        var del = iconBtn("trash", "Remove this action", true);
        del.addEventListener("click", function () {
          pushHistory();
          block.interactions.splice(idx, 1);
          if (!block.interactions.length) delete block.interactions;
          mount(); interactReselect(block);
        });
        rowHead.appendChild(del);
        E.inspector.appendChild(rowHead);

        // action type
        selectRow("Do", ACTION_TYPES, a.type || "next", function (v) {
          a.type = v;
          // reset the now-irrelevant target so stale ids never linger
          if (v === "goto") { if (a.target && !pageById(a.target)) delete a.target; }
          else if (NAV_ACTIONS[v]) { delete a.target; }
          mount(); interactReselect(block);
        });

        if (a.type === "goto") {
          var pageOpts = [["— pick page —", ""]].concat(E.doc.pages.map(function (p) { return [pageDisplayName(p, E.doc), p.id]; }));
          selectRow("Target page", pageOpts, a.target || "", function (v) {
            if (!v) delete a.target; else a.target = v;
            mount(); interactReselect(block);
          });
        } else if (!NAV_ACTIONS[a.type]) {
          // element-target action: dropdown of this page's blocks + click-to-pick.
          buildTargetPicker(block, a, "Target element");
        }
      });
    }

    // dropdown-of-labels + "pick on canvas" for an element target/source. `holder`
    // is the object owning the `field`; picking/choosing mints the target's id.
    function buildTargetPicker(sourceBlock, holder, label, field) {
      field = field || "target";
      var pi = findPageOfBlock(sourceBlock);
      var candidates = pageBlockCandidates(pi, sourceBlock);
      var opts = [["— pick element —", ""]].concat(candidates.map(function (b, i) {
        return [blockLabel(b) + (b.id ? "" : ""), b.id || ("new:" + i)];
      }));
      selectRow(label, opts, holder[field] || "", function (v) {
        if (!v) { delete holder[field]; }
        else {
          var tb = v.indexOf("new:") === 0 ? candidates[parseInt(v.slice(4), 10)]
            : candidates.filter(function (b) { return b.id === v; })[0];
          if (tb) { ensureId(tb); holder[field] = tb.id; }
        }
        mount(); interactReselect(sourceBlock);
      });
      var pick = h("button", "prop-btn", "Pick on canvas");
      pick.title = "Then click the target element on the canvas";
      pick.addEventListener("click", function () {
        startPick(label.toLowerCase(), function (picked) {
          if (picked === sourceBlock) { endPick(); renderInspector(); return; }
          pushHistory(); ensureId(picked); holder[field] = picked.id;
          mount(); interactReselect(sourceBlock);
        });
        renderInspector(); // reflect the "click an element" hint immediately
      });
      E.inspector.appendChild(pick);
      if (holder[field]) {
        var tgt = blockById(holder[field]);
        E.inspector.appendChild(h("div", "insp-hint", tgt ? ("Targets “" + blockLabel(tgt) + "”.") : "Target element no longer exists."));
      }
    }

    kernel.expose({
      renderNavButtonInspector: renderNavButtonInspector, renderOnClickSection: renderOnClickSection,
      currentGoto: currentGoto, setGoto: setGoto,
      // Two page lookups that lived in this banner and are used across the chrome.
      pageIndexById: pageIndexById, pageById: pageById,
      // The two builders the component-instance and gate panels call into.
      buildActions: buildActions, buildTargetPicker: buildTargetPicker
    });
  }

  window.VersoActions = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoActions;
})();
