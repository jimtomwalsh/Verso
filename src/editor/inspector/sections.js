// editor/inspector/sections.js -- THE section, and the author's ordering of them (arch-P3b-03).
//
// Every group of rows in every settings surface in this app is one function, sectionGroup. There
// are 34 adopters. It draws a chevron, a title, an optional switch, a one-line summary while
// collapsed, an override dot and roll-up count, and a body of plain rows -- and it is the reason
// three older header styles (a bold heading with no affordance, a bulleted twirl, a nested twirl)
// could be retired: they shared one pane, so the same glyph meant "section" in one panel and
// "sub-section" in another, and which headers opened was something you learned by clicking.
//
// Above it sits PanelLayout: a per-author, localStorage-backed GLOBAL ranking and collapse state
// for section TYPES, so an author who always wants Spacing above Appearance gets that in every
// block's inspector. Pure -- no DOM, no document -- and now reachable by a plain `require`, which
// is how the suite drives it instead of slicing the IIFE out of editor.js and rebuilding it with
// `new Function`.
//
// TWO LEVELS, NEVER THREE. Depth is counted while building rather than declared, and it is
// observed two ways because sections are built two ways: a buildFn nests while it runs (the
// counter sees that) and an imperative caller appends into a body it already holds (only the DOM
// sees that). Past level 2 the section is STILL DRAWN -- dropping rows to enforce a rule would
// hide an author's settings -- and recorded on window.__sectionDepth3, so a browser probe can name
// the offender instead of the depth quietly creeping back.
//
// Editor chrome only: never touches doc, render() or the export.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- PanelLayout: the ranking + collapse store (pure) --------------------
  var PanelLayout = (function () {
    var KEY = "verso.panelLayout";
    // uio-F07 added "Classification" — what content may leave and to whom. It is not Appearance,
    // Layout or Behaviour, and filing it under Advanced would bury a governance fact in a drawer
    // named for developer settings. It sits after Behaviour because it is about the content's
    // disposition rather than how it looks or acts, and it opens COLLAPSED: most blocks simply
    // inherit, and a section that always shows an inherited value is the pre-expanded wall the
    // spine forbids. An OVERRIDDEN one wears the accent dot, so tightening is visible folded.
    var TAXONOMY = ["Type", "Content", "Appearance", "Layout", "Spacing", "Behaviour", "Classification", "Light/Dark", "Advanced"];
    // #164 (panel-ia §5 / interaction-feel §1 — shallow by default): advanced/optional section
    // types open COLLAPSED on first paint, revealed on intent. Core types (Type…Behaviour) stay
    // open. The author's explicit open/close still wins (recorded for these types, see setCollapsed).
    var DEFAULT_COLLAPSED = { "Classification": true, "Light/Dark": true, "Advanced": true };
    // uio-F05: the settings sheet is ONE scroll of sections (it lost its nav rail), so its
    // sections open COLLAPSED — a 15-section wall is the "pre-expanded wall" the spine forbids.
    // Collapsed headers ARE the browse affordance; openSettingsSection expands the one you asked
    // for. Prefix rule rather than 15 map entries, so a new settings section inherits it.
    function defaultCollapsed(type) { return !!DEFAULT_COLLAPSED[type] || /^settings:/.test(type); }
    function load() {
      var st = { order: TAXONOMY.slice(), collapsed: {} };
      try {
        var raw = JSON.parse(localStorage.getItem(KEY) || "null");
        if (raw && Array.isArray(raw.order)) {
          // keep only KNOWN types, then append any taxonomy types added since the save
          var known = raw.order.filter(function (t) { return TAXONOMY.indexOf(t) !== -1; });
          TAXONOMY.forEach(function (t) { if (known.indexOf(t) === -1) known.push(t); });
          st.order = known;
        }
        if (raw && raw.collapsed && typeof raw.collapsed === "object") st.collapsed = raw.collapsed;
      } catch (e) {}
      return st;
    }
    function save(st) { try { localStorage.setItem(KEY, JSON.stringify({ order: st.order, collapsed: st.collapsed })); } catch (e) {} }
    function reset() { try { localStorage.removeItem(KEY); } catch (e) {} }
    function rank(type) { var i = load().order.indexOf(type); return i === -1 ? 999 : i; }
    // STABLE-sort a list of {type,…} sections by the global ranking; unknown types keep their
    // relative order at the end. Sections a panel lacks are simply absent (skipped).
    function orderSections(sections) {
      return sections.map(function (s, i) { return { s: s, i: i, r: rank(s.type) }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
        .map(function (x) { return x.s; });
    }
    // #164: a stored state (true/false) always wins; an UNSET default-collapsed type reads collapsed.
    function isCollapsed(type) {
      var c = load().collapsed;
      if (Object.prototype.hasOwnProperty.call(c, type)) return !!c[type];
      return defaultCollapsed(type);
    }
    // For a default-collapsed type, record BOTH open + closed explicitly so an author's "open"
    // sticks (deleting would fall back to the collapsed default). Others: store true, clear on open.
    function setCollapsed(type, v) {
      var st = load();
      if (defaultCollapsed(type)) st.collapsed[type] = !!v;
      else if (v) st.collapsed[type] = true; else delete st.collapsed[type];
      save(st);
    }
    function reorder(newOrder) {
      var known = (newOrder || []).filter(function (t) { return TAXONOMY.indexOf(t) !== -1; });
      TAXONOMY.forEach(function (t) { if (known.indexOf(t) === -1) known.push(t); });
      var st = load(); st.order = known; save(st); return known;
    }
    function move(type, toIndex) {
      var st = load(); var from = st.order.indexOf(type); if (from === -1) return st.order;
      var arr = st.order.slice(); arr.splice(from, 1);
      arr.splice(Math.max(0, Math.min(toIndex, arr.length)), 0, type); st.order = arr; save(st); return arr;
    }
    return { TAXONOMY: TAXONOMY, load: load, save: save, reset: reset, rank: rank, orderSections: orderSections, isCollapsed: isCollapsed, setCollapsed: setCollapsed, reorder: reorder, move: move };
  })();

  // Depth arithmetic, split out so it can be checked on plain numbers. `counterDepth` = how many
  // buildFn calls are on the stack. `hostBodies` = how many section bodies the host sits inside,
  // itself included. They OVERLAP by one whenever a caller appends into the very body being built,
  // so that one is subtracted rather than counted twice; the rest of `hostBodies` is real extra
  // nesting the counter cannot see, and the counter in turn sees nesting the DOM cannot (a section
  // still detached from its parent while it builds).
  function sectionDepthOf(counterDepth, hostBodies) {
    var extra = Math.max(0, (hostBodies || 0) - (counterDepth > 0 ? 1 : 0));
    var depth = counterDepth + extra;
    return { level: depth === 0 ? 1 : 2, tooDeep: depth > 1 };
  }

  // ---- the region (arch-P3b-03) -------------------------------------------
  // install(kernel) is called once, by editor.js, after it has provided its host surface.
  //
  // WHAT STAYED IN editor.js, AND WHY. `inspector` is the panel host, and it is SWAPPED in and out
  // as a render target at more than thirty sites across that file (`var _ins = inspector;
  // inspector = secBody; try { … } finally { inspector = _ins; }`). It is ambient state that this
  // region reads rather than owns, so it arrives as a live getter. Same for `_scopeTally`, which
  // the inheritance tails push into from a different banner entirely; this region borrows it for
  // the duration of a build and hands it back, so it needs both a read and a write.
  function install(kernel) {
    var E = kernel.need(
      "h", "inspector", "openSections", "saveOpenSections", "pushHistory", "showContextMenu",
      "sectionSummary", "overrideCount", "rollupLabel", "switchEl",
      "scopeTally", "setScopeTally", "renderInspector"
    );

    // Panel System v2 (D3) — section wrapper + buffer. A v2 panel wraps each section in
    // sectionGroup(type,title,buildFn); beginSections()/endSections() buffer them and emit in
    // the author's global ranking (PanelLayout), applying collapse. Non-adopted panels are
    // unaffected (they still append directly). Edit-layout mode adds drag handles.
    var panelEditMode = false; // "Edit panel layout" mode: reorder sections by drag
    var _sectionBuf = null;    // active buffer during a v2 panel render
    function beginSections() { _sectionBuf = []; }
    // #165: a caller that is ALREADY emitting sections adds ours to its buffer and flushes once, so
    // the whole panel sorts as one PanelLayout stream instead of two independently-sorted cycles.
    // renderContainerChrome asks this before deciding whether it owns the buffer.
    function sectionsBufferOpen() { return _sectionBuf !== null; }
    var _sectionDepth = 0;
    // Published so a browser probe can NAME an offender instead of the depth quietly creeping
    // back: a static test can read the source, but only a real render knows how deep a panel
    // actually nests once every builder has run.
    var _sectionDepthViolations = window.__sectionDepth3 = [];
    /* @ovl07-start */
    //   type              PanelLayout taxonomy key -- reorderable, collapse persisted per type.
    //                     Null for a section outside the reorderable set.
    //   opts.key          openSections key: open/closed persists across rebuilds and reloads.
    //   opts.defaultOpen  first-run state when neither store knows this section.
    //   opts.toggle       {get,set} -- a switch in the header, independent of the chevron (OVL-08).
    //   opts.summary      fn -> string: the collapsed one-liner ("On - centred, bottom rule").
    //   opts.overridden   fn -> bool: the section-level override dot; opts.onReset enables Reset.
    //   opts.actions      element (or array) pinned to the right of the title.
    function sectionGroup(type, title, buildFn, opts) {
      opts = opts || {};
      var d = sectionDepthOf(_sectionDepth, opts.hostBodies);
      var level = d.level;
      if (d.tooDeep) _sectionDepthViolations.push(title);
      var keyed = opts.key != null;
      var collapsed = keyed
        ? !(E.openSections[opts.key] == null ? opts.defaultOpen !== false : E.openSections[opts.key])
        : (type != null ? PanelLayout.isCollapsed(type) : opts.defaultOpen === false);
      var enabled = opts.toggle ? !!opts.toggle.get() : true;
      var over = !!(opts.overridden && opts.overridden());
      var sec = E.h("div", "insp-section" + (level === 2 ? " insp-section--l2" : "") +
        (collapsed ? " is-collapsed" : "") + (enabled ? "" : " is-inactive") +
        (opts.divider === false ? " insp-section--no-divider" : ""));
      if (type != null) sec.setAttribute("data-section-type", type);
      var head = E.h("div", "insp-section__head");
      var twirl = E.h("span", "insp-section__twirl" + (collapsed ? "" : " is-open"));
      var titleEl = E.h("span", "insp-section__title", title);
      var handle = E.h("span", "insp-section__drag"); handle.textContent = "∷"; handle.title = "Drag to reorder";
      // uio-F03 roll-up: the header counts the rows in this section that carry their own value
      // instead of inheriting one ("3 overridden"). Filled after buildFn, from the tally the
      // inheritance tails push into. Empty (and invisible) when nothing is overridden.
      var rollup = E.h("span", "insp-section__rollup");
      head.appendChild(twirl); head.appendChild(titleEl);
      if (over) { var dot = E.h("span", "insp-section__dot"); dot.title = "Customized from theme default"; head.appendChild(dot); }
      // The one-line summary, shown only while collapsed: what this section will actually do.
      // With a switch it always leads with On/Off, so "collapsed" never has to mean "unknown".
      var summaryText = E.sectionSummary(opts, enabled);
      if (summaryText) { var sum = E.h("span", "insp-section__summary", summaryText); sum.title = summaryText; head.appendChild(sum); }
      head.appendChild(rollup);
      var ctrls = E.h("div", "insp-section__ctrls");
      if (over && opts.onReset) {
        var rb = E.h("button", "insp-section__reset", "Reset"); rb.type = "button"; rb.title = "Reset this section to the theme default";
        rb.addEventListener("click", function (e) { e.stopPropagation(); E.pushHistory(); opts.onReset(); E.renderInspector(); });
        ctrls.appendChild(rb);
      }
      if (opts.toggle) {
        ctrls.appendChild(E.switchEl(enabled, function (v) {
          E.pushHistory();
          opts.toggle.set(v);   // the switch NEVER moves the disclosure (OVL-08)
          E.renderInspector();
        }));
      }
      if (opts.actions) [].concat(opts.actions).forEach(function (a) { if (a) ctrls.appendChild(a); });
      head.appendChild(ctrls);
      head.appendChild(handle);
      var body = E.h("div", "insp-section__body");
      head.addEventListener("click", function () {
        if (panelEditMode) return; // in edit mode the header is a drag grip, not a collapse toggle
        var nowCollapsed = !sec.classList.contains("is-collapsed");
        sec.classList.toggle("is-collapsed", nowCollapsed); twirl.classList.toggle("is-open", !nowCollapsed);
        if (keyed) { E.openSections[opts.key] = !nowCollapsed; E.saveOpenSections(); }
        else if (type != null) PanelLayout.setCollapsed(type, nowCollapsed);
      });
      // Assembled BEFORE the body is built, so a nested section can see the chain it is being
      // appended into (sectionBodiesAbove walks the tree even while the panel is still detached).
      sec.appendChild(head); sec.appendChild(body);
      // Nested sections must not land in the panel's own ordering buffer (they belong to their
      // parent's body), so the buffer is suspended for the duration of the build.
      var prevTally = E.scopeTally; E.setScopeTally([]);
      var prevBuf = _sectionBuf; _sectionBuf = null;
      _sectionDepth++;
      try { buildFn(body); } catch (e) {}
      _sectionDepth--;
      _sectionBuf = prevBuf;
      var childTally = E.scopeTally; E.setScopeTally(prevTally);
      // A parent counts what its nested sections resolved too, so the roll-up on a level-1 header
      // is the truth for everything folded underneath it.
      if (E.scopeTally) [].push.apply(E.scopeTally, childTally);
      var overrides = E.overrideCount(childTally);
      rollup.textContent = E.rollupLabel(overrides);
      if (overrides) {
        sec.classList.add("has-overrides");
        rollup.title = overrides + (overrides === 1 ? " value in this section is" : " values in this section are") +
          " set here instead of inherited";
      }
      if (_sectionBuf) _sectionBuf.push({ type: type, el: sec });
      return sec;
    }
    /* @ovl07-end */
    function endSections(container) {
      if (!_sectionBuf) return;
      PanelLayout.orderSections(_sectionBuf).forEach(function (o) { container.appendChild(o.el); });
      if (panelEditMode) wireSectionDrag(container);
      _sectionBuf = null;
    }
    function wireSectionDrag(container) {
      Array.prototype.forEach.call(container.querySelectorAll(".insp-section"), function (sec) {
        sec.setAttribute("draggable", "true");
        sec.addEventListener("dragstart", function (e) { sec.classList.add("is-dragging"); try { e.dataTransfer.setData("text/plain", sec.getAttribute("data-section-type")); } catch (_) {} });
        sec.addEventListener("dragend", function () { sec.classList.remove("is-dragging"); });
        sec.addEventListener("dragover", function (e) { e.preventDefault(); });
        sec.addEventListener("drop", function (e) {
          e.preventDefault();
          var dragged = ""; try { dragged = e.dataTransfer.getData("text/plain"); } catch (_) {}
          var target = sec.getAttribute("data-section-type");
          if (!dragged || dragged === target) return;
          var order = PanelLayout.load().order;
          PanelLayout.move(dragged, order.indexOf(target));
          E.renderInspector();
        });
      });
    }
    // uio-E-C05 (EDIT-09): section reordering is a once-in-a-while GLOBAL preference, so its entry
    // point moved OFF the top of the inspector into the panel overflow menu ("Reorder inspector
    // sections…"). This bar is now only the MODE BANNER while reordering is on: it states the scope
    // (every block's inspector) + Done/Reset, so you always know what the drag is rearranging.
    function renderPanelLayoutBar() {
      if (!panelEditMode) return; // off: no top-of-panel control; the ⋯ menu is the entry point
      var bar = E.h("div", "insp-layout-bar is-editing");
      bar.appendChild(E.h("span", "insp-layout-bar__scope", "Reordering sections for every block’s inspector — saved for you, not the course."));
      var done = E.h("button", "insp-layout-bar__btn"); done.type = "button";
      done.textContent = "Done"; done.title = "Finish reordering";
      done.addEventListener("click", function () { panelEditMode = false; E.renderInspector(); });
      bar.appendChild(done);
      var reset = E.h("button", "insp-layout-bar__btn insp-layout-bar__btn--reset"); reset.type = "button";
      reset.textContent = "Reset"; reset.title = "Restore the default section order + collapse";
      reset.addEventListener("click", function () { PanelLayout.reset(); E.renderInspector(); });
      bar.appendChild(reset);
      E.inspector.insertBefore(bar, E.inspector.firstChild); // pin to the very top of the panel
    }
    // uio-E-C05 (EDIT-09): the panel overflow (⋯) menu. Holds the demoted "Reorder inspector
    // sections…" entry, shown only when the current inspector actually has reorderable sections.
    function panelHasReorderableSections() { return !!E.inspector.querySelector(".insp-section[data-section-type]"); }
    function openPanelOverflowMenu(anchor) {
      // The ⋯ button only shows when there ARE reorderable sections (see maybeRenderLayoutBar), so
      // the menu always carries the reorder entry.
      var items = [{ label: panelEditMode ? "Done reordering sections" : "Reorder inspector sections…",
        onClick: function () { panelEditMode = !panelEditMode; E.renderInspector(); } }];
      if (panelEditMode) items.push({ label: "Reset section order", onClick: function () { PanelLayout.reset(); E.renderInspector(); } });
      var r = anchor.getBoundingClientRect();
      E.showContextMenu(r.right - 4, r.bottom + 6, items);
    }
    function mountPanelOverflow() {
      var btn = document.getElementById("panel-overflow-btn");
      if (!btn || btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener("click", function () { openPanelOverflowMenu(btn); });
    }
    // Show the Edit-layout bar only on panels that actually use v2 sections (else it's a dead control).
    // Only the PanelLayout-managed sections (sectionGroup -> data-section-type) are
    // drag-reorderable, so the Edit-layout bar shows only when THOSE exist. The DS
    // PanelSection wrappers (issue #14, no data-section-type) are plain collapsibles
    // and must not summon the bar on every block inspector.
    function maybeRenderLayoutBar() {
      var has = panelHasReorderableSections();
      // uio-E-C05 (EDIT-09): the ⋯ entry point shows only where reordering applies; the banner shows
      // only while reordering is on. If a re-render drops the sections, leave edit mode so no orphan banner.
      var ov = document.getElementById("panel-overflow-btn"); if (ov) ov.hidden = !has;
      if (!has) { panelEditMode = false; return; }
      renderPanelLayoutBar();
    }
    window.__panelV2 = { beginSections: beginSections, sectionGroup: sectionGroup, endSections: endSections, setEditMode: function (v) { panelEditMode = v; }, getEditMode: function () { return panelEditMode; } }; // test hook

    kernel.expose({
      beginSections: beginSections,
      sectionsBufferOpen: sectionsBufferOpen,
      sectionGroup: sectionGroup,
      endSections: endSections,
      renderPanelLayoutBar: renderPanelLayoutBar,
      panelHasReorderableSections: panelHasReorderableSections,
      mountPanelOverflow: mountPanelOverflow,
      maybeRenderLayoutBar: maybeRenderLayoutBar
    });
    return VersoInspectorSections;
  }

  var VersoInspectorSections = {
    install: install,
    PanelLayout: PanelLayout,
    sectionDepthOf: sectionDepthOf
  };

  // PanelLayout keeps its own global: it was one before this file existed, and the browser probe
  // and the depth report both reach it by that name.
  window.PanelLayout = PanelLayout;
  window.VersoInspectorSections = VersoInspectorSections;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoInspectorSections;
})();
