// editor/interact.js -- the second thing the canvas can be (arch-P3b-07s).
//
// Design mode edits what a page LOOKS like. Interact mode edits what it DOES: which element takes
// a click, where that click goes, and what has to have happened first. One flag separates them,
// and it changes three things at once -- the connectors drawn over the world, which inspector the
// right panel dispatches to, and a tint on the canvas.
//
// FOUR SURFACES, ONE CONCERN. The mode flag and its tabs; click-to-pick, where the panel asks for
// a target and the next canvas click answers; the drag-to-link gesture, where you pull a handle
// off the selected element onto a page; and the two inspector sections -- what happens on click,
// and what the element is locked until. They are one file because they are one gesture vocabulary:
// every one of them ends in the same place, an `interactions` or `gate` entry on a block, and
// every one of them mints the block's lazy id on the way (`ensureId`).
//
// IT OWNS THE MODE. `interactMode` was read from nine places in editor.js and from the outliner,
// which is exactly the shape the phase has been un-picking: editor.js was the middleman for state
// whose only writer had already left. The flag, the "show all connections" preference and the
// pending pick session all live here now, behind accessors, and editor.js asks rather than reads.
//
// WHAT STAYED, and why. `drawConnectors` paints the links but it is canvas GEOMETRY -- frameX,
// frameY, world, SVGNS -- and it belongs with the view, not with the model of what a link means.
// It stays in editor.js until the geometry has a home. `renderOnClickSection` went to actions.js
// in 07n and is called back through the kernel.
//
// Editor chrome only. It writes `block.interactions` and `block.gate`, which render.js and the
// runtime read; nothing here renders or exports.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "mount", "SVGNS", "canvas", "pushHistory", "walkPageBlocks",
      "ensureId", "switchRow", "setGoto", "reselectBlockNode", "getSelectionTypeForBlock", "canvasNodeForBlock",
      "blockLabel", "drawConnectors", "renderOnClickSection", "sectionGroup", "segmentedLive", "iconBtn",
      "buildTargetPicker", "selectRow", "panelSection", "renderModelView", "setInspector", "inspector",
      "selection", "doc", "frameDescs"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        mount = E.mount,
        SVGNS = E.SVGNS,
        canvas = E.canvas,
        pushHistory = E.pushHistory,
        walkPageBlocks = E.walkPageBlocks,
        ensureId = E.ensureId,
        switchRow = E.switchRow,
        setGoto = E.setGoto,
        reselectBlockNode = E.reselectBlockNode,
        getSelectionTypeForBlock = E.getSelectionTypeForBlock,
        canvasNodeForBlock = E.canvasNodeForBlock,
        blockLabel = E.blockLabel,
        drawConnectors = E.drawConnectors,
        renderOnClickSection = E.renderOnClickSection,
        sectionGroup = E.sectionGroup,
        segmentedLive = E.segmentedLive,
        iconBtn = E.iconBtn,
        buildTargetPicker = E.buildTargetPicker,
        selectRow = E.selectRow,
        panelSection = E.panelSection,
        renderModelView = E.renderModelView,
        setInspector = E.setInspector;

    // ---- Interact mode ------------------------------
    // A right-panel tab toggles the editor between Design (property inspectors, no
    // connectors) and Interact (interaction editor + authored connectors + canvas
    // tint). One flag drives connector visibility (drawConnectors), the inspector
    // dispatch (renderInspector), and the canvas indicator.
    var interactMode = false;
    var INTERACT_MODE_KEY = "authoring.interactMode"; // HH: persist Design/Interact tab across refresh
    // Interact connectors are CONTEXTUAL to the selection by default: only links
    // touching the selected component(s) draw, so a dense layout isn't spaghetti.
    // "Show all connections" flips to the full overview. Editor-chrome only.
    var showAllConnectors = false;
    var SHOW_ALL_CONNECTORS_KEY = "authoring.showAllConnectors";
    try { showAllConnectors = localStorage.getItem(SHOW_ALL_CONNECTORS_KEY) === "1"; } catch (e) {}
    function syncRightTabs() {
      var tabs = document.querySelectorAll("#right-ptabs .ptab");
      Array.prototype.forEach.call(tabs, function (t) {
        t.classList.toggle("is-active", t.getAttribute("data-ptab") === (interactMode ? "interact" : "design"));
      });
    }
    function setInteractMode(on) {
      on = !!on;
      if (interactMode === on) return;
      interactMode = on;
      try { localStorage.setItem(INTERACT_MODE_KEY, on ? "1" : "0"); } catch (e) {} // HH
      endPick();                                   // never leave a pick session dangling across modes
      canvas.classList.toggle("is-interact", interactMode);
      syncRightTabs();
      mount();                                     // rebuild world (connectors + tint) + repaint panel
    }
    function wireRightTabs() {
      var tabs = document.querySelectorAll("#right-ptabs .ptab");
      Array.prototype.forEach.call(tabs, function (t) {
        t.addEventListener("click", function () { setInteractMode(t.getAttribute("data-ptab") === "interact"); });
      });
      // #92c: Settings now lives on the left rail (rail-settings-btn, wired in mountLeftRail);
      // the right-panel cog was removed to end the duplication.
      syncRightTabs();
    }

    // all blocks on a page (nested included), optionally excluding one — the
    // candidate list for element-target + gate-source pickers.
    function pageBlockCandidates(pi, exclude) {
      var out = [];
      if (pi < 0 || !E.doc.pages[pi]) return out;
      walkPageBlocks(E.doc.pages[pi].blocks, function (b) { if (b !== exclude) out.push(b); });
      return out;
    }
    // gate condition sources (flattens allOf) -> list of source ids.
    function conditionSources(cond) {
      var ids = [];
      (function walk(c) {
        if (!c) return;
        if (c.allOf) { c.allOf.forEach(walk); return; }
        if (c.anyOf) { c.anyOf.forEach(walk); return; }
        if (c.source) ids.push(c.source);
      })(cond);
      return ids;
    }

    // ---- click-to-pick (element targets + gate sources, SPEC §6) --------------
    // The panel enters a "pick target" state; the next canvas block click resolves
    // the target/source. A capture-phase canvas handler intercepts so it never
    // triggers normal selection/editing.
    var picking = null; // { onPick, label }
    function startPick(label, onPick) {
      picking = { onPick: onPick, label: label };
      document.body.classList.add("is-picking");
    }
    function endPick() {
      if (!picking) return;
      picking = null;
      document.body.classList.remove("is-picking");
    }
    // Capture-phase so a pick click is consumed before normal selection/editing.
    canvas.addEventListener("mousedown", function (e) {
      if (!picking) return;
      var n = e.target.closest ? e.target.closest(".canvas-block") : null;
      e.preventDefault(); e.stopPropagation();
      var cb = picking.onPick; endPick();
      if (n && n.__block) cb(n.__block);
    }, true);


    // ---- drag-to-link: press the inspector's drag control, drag onto a frame ---
    // A screen-space preview arrow tracks the cursor; the frame under the cursor
    // highlights; releasing over it sets action.goto to that page.
    var linking = null;      // { host, reselect, from:{x,y} }
    var linkOverlay = null, linkPath = null, hlFrame = null;
    function ensureLinkOverlay() {
      if (linkOverlay) return;
      linkOverlay = document.createElementNS(SVGNS, "svg");
      linkOverlay.setAttribute("class", "link-overlay");
      var defs = document.createElementNS(SVGNS, "defs");
      var m = document.createElementNS(SVGNS, "marker");
      m.setAttribute("id", "link-arrow"); m.setAttribute("viewBox", "0 0 10 10");
      m.setAttribute("refX", "8"); m.setAttribute("refY", "5");
      m.setAttribute("markerWidth", "7"); m.setAttribute("markerHeight", "7");
      m.setAttribute("orient", "auto-start-reverse");
      var ar = document.createElementNS(SVGNS, "path");
      ar.setAttribute("d", "M0 0L10 5L0 10z"); ar.setAttribute("fill", "#0d99ff");
      m.appendChild(ar); defs.appendChild(m);
      linkPath = document.createElementNS(SVGNS, "path");
      linkPath.setAttribute("class", "link-overlay__path");
      linkPath.setAttribute("marker-end", "url(#link-arrow)");
      linkOverlay.appendChild(defs); linkOverlay.appendChild(linkPath);
      document.body.appendChild(linkOverlay);
    }
    function frameElementUnder(cx, cy) { var e = document.elementFromPoint(cx, cy); return e ? e.closest(".frame") : null; }
    function frameIndexOf(frameEl) { for (var i = 0; i < E.frameDescs.length; i++) if (E.frameDescs[i].frame === frameEl) return i; return -1; }
    function clearFrameHighlight() { if (hlFrame) { hlFrame.classList.remove("is-link-target"); hlFrame = null; } }
    function startLink(host, sourceNode, reselect) {
      ensureLinkOverlay();
      var r = sourceNode.getBoundingClientRect();
      linking = { host: host, reselect: reselect, from: { x: r.right, y: r.top + r.height / 2 } };
      linkOverlay.style.display = "block";
      document.body.classList.add("is-linking");
    }
    // Interact-mode variant of the drag-to-link gesture: drop onto a frame appends
    // a {click -> goto:targetPage} interaction to the block (mints an id) instead of
    // writing the legacy host.action.goto.
    function startInteractLink(block, sourceNode) {
      ensureLinkOverlay();
      var r = sourceNode.getBoundingClientRect();
      linking = { interact: true, block: block, from: { x: r.right, y: r.top + r.height / 2 } };
      linkOverlay.style.display = "block";
      document.body.classList.add("is-linking");
    }
    window.addEventListener("mousemove", function (e) {
      if (!linking) return;
      var f = linking.from, x2 = e.clientX, y2 = e.clientY, cx = (x2 - f.x) / 2;
      linkPath.setAttribute("d", "M" + f.x + " " + f.y + " C" + (f.x + cx) + " " + f.y + " " + (x2 - cx) + " " + y2 + " " + x2 + " " + y2);
      var fr = frameElementUnder(x2, y2);
      if (fr !== hlFrame) { clearFrameHighlight(); if (fr) { fr.classList.add("is-link-target"); hlFrame = fr; } }
    });
    window.addEventListener("mouseup", function (e) {
      if (!linking) return;
      var lk = linking; linking = null;
      var fr = frameElementUnder(e.clientX, e.clientY);
      clearFrameHighlight();
      linkOverlay.style.display = "none";
      document.body.classList.remove("is-linking");
      if (fr) {
        var idx = frameIndexOf(fr);
        if (idx >= 0) {
          if (lk.interact) {
            pushHistory();
            addGotoInteraction(lk.block, E.doc.pages[idx].id);
            mount(); interactReselect(lk.block);
          } else { setGoto(lk.host, E.doc.pages[idx].id); mount(); lk.reselect(); }
        }
      }
    });

    // reselect a block after a mount(), using its natural selection type.
    function interactReselect(block) { reselectBlockNode(block, getSelectionTypeForBlock(block)); }

    // add a {click -> goto:pageId} interaction (mints an id). Used by the drag-to-
    // link gesture and the connection handle.
    function addGotoInteraction(block, pageId) {
      ensureId(block);
      block.interactions = block.interactions || [];
      block.interactions.push({ trigger: { type: "click" }, action: { type: "goto", target: pageId } });
    }

    // connection handle: in Interact mode the selected element sprouts a small
    // handle you drag onto a target page to author a goto (SPEC §6 drag-to-link).
    function decorateInteractHandle() {
      Array.prototype.forEach.call(canvas.querySelectorAll(".interact-handle"), function (n) { n.parentNode.removeChild(n); });
      var block = interactBlock(); if (!block) return;
      var node = canvasNodeForBlock(block); if (!node) return;
      if (!node.style.position) node.style.position = "relative";
      var handle = h("div", "interact-handle");
      handle.title = "Drag onto a page to link (go to)";
      handle.setAttribute("contenteditable", "false");
      handle.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); startInteractLink(block, node); });
      node.appendChild(handle);
    }

    var ACTION_TYPES = [
      ["Go to page", "goto"], ["Next page", "next"], ["Previous page", "prev"],
      ["Show element", "show"], ["Hide element", "hide"],
      ["Enable element", "enable"], ["Toggle element", "toggle"],
      ["Exit course", "exit"]
    ];
    // TARGETLESS actions: they carry no page/element target, so switching to one
    // clears any stale target and the inspector shows no target picker. (goto has a
    // page target; show/hide/enable/toggle have an element target; next/prev/exit none.)
    var NAV_ACTIONS = { next: 1, prev: 1, exit: 1 };

    // resolve the selected element for the interaction editor. Works for any
    // selection that carries a block (field / block / navButton / embed).
    function interactBlock() {
      if (E.selection && E.selection.block) return E.selection.block;
      if (E.selection && E.selection.node && E.selection.node.__block) return E.selection.node.__block; // navButton etc.
      return null;
    }

    function renderInteractInspector() {
      var block = interactBlock();
      var head = h("div", "prop-component prop-component--interact");
      head.appendChild(h("span", null, block ? blockLabel(block) : "Interact"));
      if (block && block.id) head.appendChild(h("span", "insp-tag", block.id));
      E.inspector.appendChild(head);

      // Connectors are contextual to the selection by default; this flips to the
      // full overview. Always shown (even with nothing selected) so you can survey
      // every link when wanted, then clear it to zero back in on one component.
      switchRow("Show all connections", function () { return showAllConnectors; }, function (v) {
        showAllConnectors = v;
        try { localStorage.setItem(SHOW_ALL_CONNECTORS_KEY, v ? "1" : "0"); } catch (e) {}
        drawConnectors();
      });

      if (!block) {
        E.inspector.appendChild(h("div", "insp-hint", "Interact mode. Select an element on the canvas to see its links (blue arrows = navigation, grey dashed + lock = gates). Turn on “Show all connections” for the full overview."));
        return;
      }
      if (picking) E.inspector.appendChild(h("div", "insp-hint insp-hint--picking", "Click an element on the canvas to set the " + (picking.label || "target") + "  ·  Esc to cancel"));

      renderOnClickSection(block);
      renderGateSection(block);
    }

    // ...continues in actions.js (arch-P3b-07).



    // ---- "Locked until ->" reactive gate -------------------------------------
    var IS_OPTIONS = [["visited", "visited"], ["watched", "watched"], ["checked", "checked"]];
    function renderGateSection(block) {
      var _gateRoot = E.inspector;
      var on = !!block.gate;
      // uio-O-W2 (OVL-07): the gate's own on/off is the SECTION's switch, not a "Gate" row one
      // line under a heading that said the same thing. Off, the section states so and stops --
      // there is no configuration to keep, because turning it off deletes the gate.
      _gateRoot.appendChild(sectionGroup(null, "Locked until", function (gateBody) {
      var _gins = E.inspector; E.setInspector(gateBody);
      try {
      if (!on) {
        E.inspector.appendChild(h("div", "insp-hint", "Off. Turn on to keep this element locked (greyed or hidden) until a condition is met."));
        return;
      }
      var g = block.gate;

      segmentedLive("When locked", [["disable", "disable"], ["hide", "hide"]], function (v) { return (g.mode || "disable") === v; }, function (v) {
        g.mode = v; mount(); interactReselect(block);
      });

      // conditions (allOf). A single condition is stored bare; two+ become allOf.
      var conds = gateConditionList(g);
      conds.forEach(function (c, ci) {
        var rowHead = h("div", "insp-int-row");
        rowHead.appendChild(h("span", "insp-int-row__idx", conds.length > 1 ? ("Condition " + (ci + 1)) : "Condition"));
        if (conds.length > 1) {
          var del = iconBtn("trash", "Remove this condition", true);
          del.addEventListener("click", function () { pushHistory(); removeGateCondition(g, ci); mount(); interactReselect(block); });
          rowHead.appendChild(del);
        }
        E.inspector.appendChild(rowHead);
        buildTargetPicker(block, c, "Source element", "source");
        selectRow("Is", IS_OPTIONS, c.is || "visited", function (v) { c.is = v; mount(); interactReselect(block); });
      });
      var addCond = h("button", "prop-btn", "+ Add condition (all of)");
      addCond.addEventListener("click", function () { pushHistory(); addGateCondition(g); mount(); interactReselect(block); });
      E.inspector.appendChild(addCond);

      E.setInspector(panelSection(gateBody, "Hint + completion"));
      // hint writes live (no rebuild) so the field keeps focus while typing.
      var hintRow = h("div", "insp-row"); hintRow.appendChild(h("span", "insp-row__label", "Hint"));
      var hintIn = h("input", "prop-text"); hintIn.type = "text"; hintIn.spellcheck = false;
      hintIn.placeholder = "e.g. Watch the video to continue";
      hintIn.value = g.hint || "";
      hintIn.addEventListener("input", function () { if (hintIn.value) g.hint = hintIn.value; else delete g.hint; renderModelView(); });
      hintRow.appendChild(hintIn); E.inspector.appendChild(hintRow);

      switchRow("Required to complete", function () { return !!g.required; }, function (v) {
        if (v) g.required = true; else delete g.required;
        mount(); interactReselect(block);
      });
      E.inspector.appendChild(h("div", "insp-hint", "Required gates must be satisfied (plus every page visited) before the course reports complete."));
      } finally { E.setInspector(_gins); }
      }, {
        key: "gate.lockedUntil",
        toggle: {
          get: function () { return !!block.gate; },
          set: function (v) {
            if (v) { ensureId(block); block.gate = block.gate || { mode: "disable", when: { source: "", is: "visited" } }; }
            else { delete block.gate; }
            mount(); interactReselect(block);
          }
        },
        summary: function () { return block.gate ? ((block.gate.mode || "disable") === "hide" ? "hidden until met" : "greyed until met") : ""; }
      }));
    }

    // normalise gate.when into an editable array of {source,is} conditions.
    function gateConditionList(g) {
      if (!g.when) { g.when = { source: "", is: "visited" }; return [g.when]; }
      if (g.when.allOf) return g.when.allOf;
      return [g.when];
    }
    function addGateCondition(g) {
      var list = gateConditionList(g);
      var next = { source: "", is: "visited" };
      if (g.when.allOf) g.when.allOf.push(next);
      else g.when = { allOf: [g.when, next] };
    }
    function removeGateCondition(g, ci) {
      if (!g.when.allOf) { g.when = { source: "", is: "visited" }; return; }
      g.when.allOf.splice(ci, 1);
      if (g.when.allOf.length === 1) g.when = g.when.allOf[0];
    }

    // find a block anywhere in the doc by its id (for target/source labels).
    function blockById(id) {
      var found = null;
      E.doc.pages.forEach(function (p) { walkPageBlocks(p.blocks, function (b) { if (b.id === id) found = b; }); });
      return found;
    }

    // The mode, restored from the last session. editor.js used to do this inline, reaching into
    // three of this module's internals to do it; it calls one entry point now.
    function restoreInteractMode() {
      try { if (localStorage.getItem(INTERACT_MODE_KEY) !== "1") return; } catch (e) { return; }
      interactMode = true;
      canvas.classList.add("is-interact");
      syncRightTabs();
    }
    // What editor.js asks instead of reading. The flag, the connector preference and the pending
    // pick session are this module's own state -- nine editor.js reads of `interactMode` were the
    // last reason it lived over there.
    function interactModeOn() { return interactMode; }
    function showAllConnectorsOn() { return showAllConnectors; }
    function isPicking() { return !!picking; }

    kernel.expose({
      syncRightTabs: syncRightTabs, setInteractMode: setInteractMode, wireRightTabs: wireRightTabs,
      pageBlockCandidates: pageBlockCandidates, conditionSources: conditionSources, startPick: startPick,
      endPick: endPick, startLink: startLink, frameElementUnder: frameElementUnder,
      interactReselect: interactReselect, addGotoInteraction: addGotoInteraction, decorateInteractHandle: decorateInteractHandle,
      interactBlock: interactBlock, renderInteractInspector: renderInteractInspector, renderGateSection: renderGateSection,
      blockById: blockById, restoreInteractMode: restoreInteractMode, interactModeOn: interactModeOn,
      showAllConnectorsOn: showAllConnectorsOn, isPicking: isPicking
    });
    // The mode itself, live, for the modules that already read it through the kernel.
    kernel.provideLive({
      interactMode: function () { return interactMode; },
      showAllConnectors: function () { return showAllConnectors; }
    });
    // Constants the rest of the chrome reads as DATA. They cannot cross as bound forwarders,
    // because bind() returns a function.
    kernel.provide({
      ACTION_TYPES: ACTION_TYPES, NAV_ACTIONS: NAV_ACTIONS
    });
  }

  window.VersoInteract = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoInteract;
})();
