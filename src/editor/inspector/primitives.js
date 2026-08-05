// editor/inspector/primitives.js -- the canonical control set (arch-P3b-07b).
//
// WHAT THIS IS. `design-system/readme.md` ("The UI spine") states one rule about Verso's chrome:
// every settings row resolves to a canonical helper, and a hand-rolled row is a defect. This file
// is that helper set. If a panel needs a control shape that is not here, the answer is to add it
// here, not to build it in the panel.
//
// It arrives as four regions of editor.js that were never adjacent but were always one concern:
//
//   1. the scrub + datalist plumbing every numeric row shares (`makeScrubbable`, `ensureDatalists`)
//   2. the binary and segmented controls (`switchEl` / `switchRow` / `eyeRow` / `segmentedIconLive`
//      / `subDisclosure`) and the summary strings a collapsed section shows
//   3. the SCOPE LADDER -- System, Product, Course, Page, Block -- and the row anatomy that renders
//      an inherited or overridden value in one visual language (`settingsRow` / `crossRefRow` /
//      `fieldRow`)
//   4. the row and container primitives on top of it (`segmentedLive` / `iconField` / `twoUp` /
//      `propHeader` / `breadcrumb` / `optionalRow` / `repeatedList` / `renderContainerChrome`)
//
// IT OWNS THE SCOPE TALLY. `_scopeTally` is the buffer a panel build borrows so a section can
// report how many of its properties are overridden. editor.js held it and lent it out through a
// getter and a setter because neither end had moved; both ends are here now, and the section engine
// reads it from this module instead. Same move P3b-06 made with the hotspot selection.
//
// WHY renderContainerChrome IS HERE and not with the block inspectors: it is the container row
// ORDER (`CONTAINER_ROW_ORDER`) plus the same primitives above, applied for every block that has a
// box around it. It is a composition of this file, and it was the one thing a VM boot did not catch
// in P3b-03 -- it reads the section buffer directly, so it only breaks in a real browser render.
//
// Editor chrome only. Nothing here renders or exports; a learner never sees any of it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pushHistory", "panelSection", "sectionGroup", "getBlockStyles", "alignSeg",
      "ensureBlockToolbar", "colourControl", "inspector", "doc", "blockToolbarSep",
      "scheduleSave", "buildFontPicker", "colorField", "isEmbeddableFont"
    );
    // The stable half: function declarations editor.js never reassigns, aliased once so the moved
    // bodies read exactly as they did. `inspector`, `doc` and `blockToolbarSep` are deliberately
    // NOT here -- editor.js swaps `inspector` for a section body while a panel builds and replaces
    // `doc` wholesale on a document swap, and `blockToolbarSep` is minted by block-actions.js when
    // it first builds the overlay bar (arch-P3b-07o). All three are read through E at use.
    var buildFontPicker = E.buildFontPicker,
        colorField = E.colorField,
        isEmbeddableFont = E.isEmbeddableFont;
    var h = E.h, pushHistory = E.pushHistory, panelSection = E.panelSection,
        sectionGroup = E.sectionGroup, getBlockStyles = E.getBlockStyles,
        alignSeg = E.alignSeg, ensureBlockToolbar = E.ensureBlockToolbar,
        colourControl = E.colourControl, scheduleSave = E.scheduleSave;

    // ---- the three controls that were living elsewhere (arch-P3b-07) --------------------
    // A canonical control belongs with the canonical control set, whatever banner its first
    // caller happened to sit under. The icon button came from the drag-and-drop banner, the
    // dropdown and its labelled row from the theme banner.
    //
    // Legacy icon-button keys -> Lucide (kebab) names, resolved through the offline Icon accessor
    // (src/icons.js). The hand-drawn ICONS art is retired; callers keep their stable keys, so this
    // was a re-skin and never a re-wire.
    var ICON_ALIAS = {
      duplicate: "copy", trash: "trash-2", grip: "grip-vertical", plus: "plus",
      minus: "minus", chevron: "chevron-right", image: "image", refresh: "refresh-cw",
      upload: "upload", unlink: "unlink", eye: "eye", eyeOff: "eye-off",
      arrowUp: "arrow-up", arrowDown: "arrow-down", lock: "lock", unlock: "lock-open",
      slice: "scissors", merge: "fold-vertical"
    };
    function iconBtn(icon, title, danger) {
      var b = h("button", "icon-btn" + (danger ? " icon-btn--danger" : ""));
      b.title = title;
      b.innerHTML = Icon(ICON_ALIAS[icon] || icon);
      return b;
    }
    // #157/rawSelect review: the canonical dropdown -- VersoUI.Select fed the editor's
    // [label, value] option pairs. Returns the <select> element so callers can still style
    // width/flex or attach extra listeners (the weight picker captures a range on mousedown).
    function dsSelect(pairs, current, onChange, opts) {
      opts = opts || {};
      return window.VersoUI.Select({
        options: (pairs || []).map(function (o) { return { value: o[1], label: o[0] }; }),
        value: current == null ? "" : String(current),
        placeholder: opts.placeholder || null,
        onChange: onChange
      });
    }
    function selectRow(label, options, current, onchange) {
      E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", label));
      var sel = dsSelect(options, current, function (v) { pushHistory(); onchange(v); });
      E.inspector.appendChild(sel);
      return sel;
    }

    function ensureDatalists() {
      var lists = {
        "dl-font-size": [12, 14, 16, 18, 22, 28, 34, 42, 56],
        "dl-line-height": [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8],
        "dl-letter-spacing": [-1, -0.5, 0, 0.5, 1, 1.5, 2],
        "dl-radius": [0, 4, 8, 12, 16, 24],
        "dl-gap": [0, 8, 12, 16, 24, 32, 48],
        "dl-columns": [1, 2, 3, 4, 5, 6],
        "dl-pct": [0, 5, 10, 15, 20, 25, 33, 40]
      };
      Object.keys(lists).forEach(function (id) {
        if (document.getElementById(id)) return;
        var dl = document.createElement("datalist");
        dl.id = id;
        lists[id].forEach(function (val) {
          var opt = document.createElement("option");
          opt.value = val;
          dl.appendChild(opt);
        });
        document.body.appendChild(dl);
      });
    }

    function makeScrubbable(labelNode, inputNode, onchange, step, min, max) {
      step = step || 1;
      labelNode.style.cursor = "ew-resize";
      labelNode.style.userSelect = "none";

      var startX = 0;
      var startVal = 0;

      function clampFmt(v) {
        if (min != null) v = Math.max(min, v);
        if (max != null) v = Math.min(max, v);
        if (step % 1 !== 0) v = parseFloat(v.toFixed(2));
        else v = Math.round(v);
        return v;
      }
      function apply(v) {
        v = clampFmt(v);
        inputNode.value = v;
        onchange(String(v));
      }

      function onMouseMove(e) {
        apply(startVal + (e.clientX - startX) * step);
      }
      function onMouseUp() {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
      }
      function beginDrag(e) {
        startX = e.clientX;
        startVal = parseFloat(inputNode.value) || 0;
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "ew-resize";
        e.preventDefault();
      }

      // Drag the glyph with the LEFT button (original affordance).
      labelNode.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return; // left only
        beginDrag(e);
      });

      // H: scrub directly over the FIELD with the MIDDLE button (Blender
      // convention) -- left-click still lands the caret / selects text for typing,
      // so the field stays a normal input.
      inputNode.addEventListener("mousedown", function (e) {
        if (e.button !== 1) return; // middle only
        beginDrag(e);
      });
      // Kill the middle-click autoscroll / paste that would otherwise fire.
      inputNode.addEventListener("auxclick", function (e) { if (e.button === 1) e.preventDefault(); });

      // NOTE: wheel/scroll-over-field-to-change RETIRED 2026-07-08 (James) — scrolling the
      // panel while the pointer passed over a field changed values by accident. The glyph
      // drag (beginDrag, above) + explicit middle-button scrub remain the deliberate ways
      // to adjust a number.
    }

    // A boolean SWITCH. This is THE canonical binary control — word-button
    // segmented toggles ([Off|On]) are retired. `onToggle(nextBool)` owns everything
    // (model write + reapply + any re-render).
    // Drop-in onto the DS canonical control set (issue #10): when the vanilla DS
    // library is present, `switchEl` builds via VersoUI.Switch — identical uiswitch
    // DOM, so the 27 switchRow sites re-skin automatically with the DS. A local
    // fallback keeps the editor working if the library ever fails to load.
    function switchEl(on, onToggle) {
      if (window.VersoUI && window.VersoUI.Switch) {
        return window.VersoUI.Switch({ checked: !!on, onChange: onToggle });
      }
      var b = h("button", "uiswitch" + (on ? " is-on" : ""));
      b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", on ? "true" : "false");
      b.appendChild(h("span", "uiswitch__knob"));
      b.addEventListener("click", function (e) { e.stopPropagation(); onToggle(!b.classList.contains("is-on")); });
      return b;
    }
    // Labelled standalone switch row (for a boolean that is NOT a nest-enable).
    // A toggle sits in the shared settings row (uio-F01): label grows, the switch is the
    // control, right-aligned. Not a separate row anatomy.
    // rowOpts (optional) forwards the shared row's slots — today `inherit` (uio-F03's scope
    // tail) and `overflow` — so a toggle can carry them without a second row anatomy.
    function switchRow(labelText, get, set, target, noHistory, rowOpts) {
      var o = {
        label: labelText, variant: "insp-row--toggle", controlAlign: "end",
        host: target || E.inspector,
        control: switchEl(!!get(), function (v) { if (!noHistory) pushHistory(); set(v); })
      };
      if (rowOpts) { if (rowOpts.inherit) o.inherit = rowOpts.inherit; if (rowOpts.overflow) o.overflow = rowOpts.overflow; }
      settingsRow(o);
    }
    // Visibility control = an EYE glyph (open / slashed). `visibleGet/Set` in terms of
    // VISIBLE (true = shown); the caller maps to whatever underlying flag it uses.
    function eyeRow(labelText, visibleGet, visibleSet, target) {
      var vis = !!visibleGet();
      var b = h("button", "eye-btn" + (vis ? "" : " is-off")); b.type = "button";
      b.title = vis ? "Visible — click to hide" : "Hidden — click to show";
      b.innerHTML = vis ? Icon("eye") : Icon("eye-off");
      b.addEventListener("click", function () { pushHistory(); visibleSet(!vis); });
      settingsRow({ label: labelText, variant: "insp-row--toggle", controlAlign: "end", host: target || E.inspector, control: b });
    }
    // Icon-segmented single-choice (mode-choice, e.g. alignment). options =
    // [[iconSvg, value, title], ...]. Word segments are only for choices with no clear icon.
    function segmentedIconLive(labelText, options, isCurrent, onPick, target, noHistory) {
      var host = target || E.inspector;
      if (labelText) host.appendChild(h("div", "insp-row__label insp-row__label--stacked", labelText));
      var rowEl = h("div", "prop-toggle-row prop-toggle-row--icon"); var btns = [];
      options.forEach(function (o) {
        var b = h("button", "prop-toggle prop-toggle--icon" + (isCurrent(o[1]) ? " is-on" : ""));
        b.type = "button"; b.innerHTML = o[0]; if (o[2]) { b.title = o[2]; b.setAttribute("aria-label", o[2]); }
        b.addEventListener("click", function () { if (!noHistory) pushHistory(); onPick(o[1]); btns.forEach(function (x) { x.classList.remove("is-on"); }); b.classList.add("is-on"); });
        btns.push(b); rowEl.appendChild(b);
      });
      host.appendChild(rowEl);
    }
    // A section that carries a feature switch. opts: { toggle:{get,set} (the switch),
    // overridden:fn->bool (override dot + enables Reset), onReset:fn (revert styling),
    // summary:fn->string (the collapsed one-liner) }.
    //
    // uio-O-W2 (OVL-08): the switch and the disclosure used to fight each other. Being OFF forced
    // `is-collapsed` whatever the author had twirled open, turning it ON auto-opened the section,
    // and an off section never built its body at all -- so it showed nothing of the configuration
    // it still held, and turning the header back on was a leap of faith. They are independent now:
    // the chevron owns open/closed, the switch owns on/off, an OFF section dims but keeps its rows.
    //
    // uio-O-W2 (OVL-07): and it is no longer its own chrome. It was the second of three header
    // styles in the Header & Footer pane; every one of those behaviours now lives in the ONE
    // section, so this is a named adapter rather than a parallel implementation.
    function subDisclosure(key, title, buildBody, opts) {
      opts = opts || {};
      return sectionGroup(null, title, buildBody, {
        key: key, defaultOpen: false, toggle: opts.toggle, summary: opts.summary,
        overridden: opts.overridden, onReset: opts.onReset
      });
    }
    // "Off · centred, top rule" — the collapsed section's one line. Pure string assembly over
    // whatever the caller reports, so a section with nothing to say adds nothing rather than
    // padding the header with "Default".
    function sectionSummary(opts, enabled) {
      var parts = [];
      if (opts.toggle) parts.push(enabled ? "On" : "Off");
      var detail = "";
      try { detail = opts.summary ? String(opts.summary() || "") : ""; } catch (e) {}
      if (detail) parts.push(detail);
      return parts.join(" · ");
    }
    // Override registry (SPEC decision 5): each appearance nest declares the block-prop
    // keys it owns. Present key = overridden; reset = delete them (revert to theme default).
    // uio-O-W2 (OVL-08): what the collapsed Header/Footer section will actually do. PURE over the
    // config object, so it is regression-guarded in tests/run.js. Names only what is SET -- an
    // untouched section reads as its alignment alone rather than a recital of every default.
    function headerFooterSummary(cfg, isHeader) {
      cfg = cfg || {};
      var bits = [];
      if (cfg.align) bits.push(cfg.align === "center" ? "centred" : cfg.align);
      if (cfg.border) bits.push(isHeader ? "bottom rule" : "top rule");
      if (isHeader && cfg.logo) bits.push("logo");
      if (isHeader && cfg.pinned) bits.push("pinned");
      if (!isHeader && cfg.hideText) bits.push("text hidden");
      return bits.join(", ");
    }
    function nestOverridden(cfg, keyList) { return !!cfg && keyList.some(function (k) { return cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== ""; }); }
    function nestReset(cfg, keyList) { if (cfg) keyList.forEach(function (k) { delete cfg[k]; }); }
    var HEADER_STYLE_KEYS = ["align", "border", "borderColor", "padX", "padY", "logoTint", "logoSize", "pinned"];
    var FOOTER_STYLE_KEYS = ["align", "border", "borderColor", "padX", "padY", "hideText", "textGap"];
    var NAV_BTN_KEYS = ["btnFill", "btnBorder", "btnText", "btnHover"];
    var NAV_PILL_KEYS = ["pillFill", "pillOpacity", "pillBlur", "pillBorder", "pillStroke", "pillStrokeWidth", "pillRadius", "pillGlyphNudge", "pillWidth", "pillHeight", "pillShadow", "pillShadowX", "pillShadowY", "pillShadowBlur", "pillShadowSpread", "pillShadowColor", "pillShadowOpacity", "barFill", "barTrack"];

    // System -> Product -> Course -> Page -> Block. One ladder, one primitive, one visual
    // language (design-system/readme.md, "The UI spine" -> "Scope and inheritance").
    //
    // DELIBERATELY PROPERTY-AGNOSTIC — read this before extending it.
    // resolveScoped() takes the property being resolved as an ARGUMENT and never inspects it.
    // It only hands the key to each rung's own reader. There is NO list of known settings in
    // here, and nothing assumes the resolved value is a style or theme value: it can be a
    // boolean, a number, a colour string, a classification code, an approval state — the
    // resolver does not care and must never learn to care.
    //
    // A SECOND AXIS rides this same primitive by supplying two things and nothing else:
    //   1. a different property key, and
    //   2. a scope chain whose rungs read that axis's own storage (the rung's `read` is where
    //      per-rung name mapping lives, so rungs may store the same idea under different keys).
    // That is how uio-F07's export-control classification inherits down this ladder without a
    // second, parallel inheritance path. A parallel path is the failure this shape prevents.
    //
    // Two seams keep it general:
    //   rung.read(prop) -> NOT_SET, or the value this rung sets. null / false / 0 / "" are
    //      REAL values; only NOT_SET means "this rung says nothing about that property".
    //   opts.choose(a, b) -> optional winner-picker for axes where the deepest rung does not
    //      simply win. Default is last-wins (the deepest rung that sets it). F07's "a block may
    //      only override to something MORE restrictive" is exactly a choose().
    //
    // PURE: no DOM, no closures over editor state. Fenced for the headless regression guard.
    /* @f03-start */
    var SCOPE_LADDER = ["system", "product", "course", "page", "block"];
    var SCOPE_LABELS = { system: "System", product: "Product", course: "Course", page: "Page", block: "Block" };
    var NOT_SET = { __f03NotSet: true };   // sentinel: this rung sets nothing for this property

    function scopeLabel(scope) { return SCOPE_LABELS[scope] || String(scope == null ? "" : scope); }
    function scopeDepth(scope) { var i = SCOPE_LADDER.indexOf(scope); return i === -1 ? SCOPE_LADDER.length : i; }

    // A rung backed by a plain object bag: own-property presence means "this rung sets it".
    // Any axis that does not store its value in a bag supplies its own read() instead.
    function scopeRung(scope, bag, label) {
      return {
        scope: scope, label: label || scopeLabel(scope),
        read: function (prop) {
          return (bag && Object.prototype.hasOwnProperty.call(bag, prop)) ? bag[prop] : NOT_SET;
        }
      };
    }
    // Order any set of rungs System -> Block; absent rungs are simply left out.
    function scopeChain(rungs) {
      return (rungs || []).filter(Boolean).slice().sort(function (a, b) { return scopeDepth(a.scope) - scopeDepth(b.scope); });
    }

    // Resolve one property down a chain, as seen from one rung (opts.at, default the deepest).
    // Rungs deeper than `at` are not in play — a page row must not read a block's override.
    function resolveScoped(chain, prop, opts) {
      opts = opts || {};
      chain = chain || [];
      var at = opts.at || (chain.length ? chain[chain.length - 1].scope : null);
      var atDepth = scopeDepth(at);
      var trace = [], winner = NOT_SET, winScope = null, winLabel = null, ownValue = NOT_SET, parent = null;
      for (var i = 0; i < chain.length; i++) {
        var r = chain[i];
        if (scopeDepth(r.scope) > atDepth) continue;
        var lab = r.label || scopeLabel(r.scope);
        var v = r.read(prop);
        trace.push({ scope: r.scope, label: lab, set: v !== NOT_SET, value: v === NOT_SET ? undefined : v });
        if (v === NOT_SET) continue;
        if (r.scope === at) ownValue = v;
        else parent = { scope: r.scope, label: lab, value: v };   // nearest ancestor that sets it
        if (winner === NOT_SET || !opts.choose) { winner = v; winScope = r.scope; winLabel = lab; }
        else { var w = opts.choose(winner, v); if (w === v) { winner = v; winScope = r.scope; winLabel = lab; } else winner = w; }
      }
      var found = winner !== NOT_SET;
      var overridden = ownValue !== NOT_SET;
      return {
        prop: prop,
        at: at, atLabel: scopeLabel(at),
        found: found,
        value: found ? winner : undefined,          // what will ACTUALLY apply — never "unset"
        scope: winScope,                            // the rung the applied value came from
        // A rung may name itself (uio-E-C03's "Theme" and "Style “Lead”" occupy the system and
        // course rungs but are not called that on screen), so its own label wins over the
        // ladder's. Every rung that supplies no label still reads exactly as it did.
        scopeLabel: winScope ? (winLabel || scopeLabel(winScope)) : null,
        overridden: overridden,                     // this rung sets its own value
        inherited: found && !overridden,
        from: parent,                               // what Reset restores, and from where
        trace: trace
      };
    }

    // What a Reset does, expressed as data (the mutation stays at the call site).
    // null = nothing to reset. restores = null means no rung above sets it, so the value clears.
    function resetPlan(chain, prop, at) {
      var res = resolveScoped(chain, prop, { at: at });
      if (!res.overridden) return null;
      return { prop: prop, clearAt: res.at, restores: res.from || null };
    }
    // Reset's tooltip must state WHAT it restores and FROM WHICH scope (spine requirement).
    function resetTooltip(res, format) {
      if (!res || !res.overridden) return "";
      var f = format || String;
      return res.from
        ? "Reset to the " + res.from.label + " value: " + f(res.from.value)
        : "Reset — nothing is set above " + res.atLabel + ", so this clears";
    }
    // Inherited copy: never "unset" — always what will apply, and where it comes from.
    function inheritedTooltip(res, format) {
      if (!res || !res.found) return "";
      var f = format || String;
      return "Inherited from " + (res.scopeLabel || "") + ": " + f(res.value);
    }
    // Section roll-up: how many of a section's rows carry their own value at this rung.
    function overrideCount(resolutions) {
      var n = 0;
      (resolutions || []).forEach(function (r) { if (r && r.overridden) n++; });
      return n;
    }
    function rollupLabel(n) { return n > 0 ? n + " overridden" : ""; }
    /* @f03-end */

    // The active sectionGroup's tally of resolutions, so a section header can count its own
    // overrides without every call site plumbing a count back up. A stack, so nesting is safe.
    var _scopeTally = null;
    function tallyResolution(res) { if (_scopeTally && res) _scopeTally.push(res); }

    // Builds the shared row's inheritance TAIL (uio-F01 left this slot empty for F03).
    // Two states, one language, every surface:
    //   inherited  -> the source scope named in tertiary ink (the control shows the value)
    //   overridden -> a 4px accent dot + an inline Reset naming what it restores
    // Reset is a LIVE edit, not a commit control: it writes immediately and Undo takes it back
    // (the spine's save contract — no Save/Apply/Cancel/Done).
    //   spec: { res (a resolveScoped result), format (value -> string), onReset () }
    function inheritanceTail(spec) {
      var res = spec && spec.res;
      if (!res || !res.found) return null;
      tallyResolution(res);
      var wrap = h("span", "insp-inherit");
      if (res.overridden) {
        wrap.appendChild(h("span", "insp-row__override-dot"));
        var btn = h("button", "insp-row__reset", "Reset"); btn.type = "button";
        btn.title = resetTooltip(res, spec.format);
        btn.addEventListener("click", function (ev) { ev.stopPropagation(); if (spec.onReset) spec.onReset(res); });
        wrap.appendChild(btn);
      } else {
        var s = h("span", "insp-row__scope", res.scopeLabel);
        s.title = inheritedTooltip(res, spec.format);
        wrap.appendChild(s);
      }
      return wrap;
    }
    function onOffLabel(v) { return v ? "on" : "off"; }

    // ---- The two ladders wired today (uio-F03) --------------------------------------
    // Each is only a CHAIN — a list of rungs and how each rung reads the property. The
    // resolver above is shared and knows nothing about either of them. Adding an axis means
    // adding a chain builder here, never touching resolveScoped.

    // Block appearance: System defaults -> the course's captured per-type default
    // (doc.theme.blockStyles[type]) -> this block's own box. This RECONCILES with the cascade
    // render.js already applies (resolveBlockBox: type default is the baseline, block.box
    // wins); the ladder surfaces that existing model rather than adding a second one.
    var BOX_SYSTEM_DEFAULTS = { border: false, borderWidth: 1, radius: 0 };
    function blockBoxChain(block) {
      var bs = getBlockStyles();
      return scopeChain([
        scopeRung("system", BOX_SYSTEM_DEFAULTS),
        scopeRung("course", (bs && block && bs[block.type]) || {}),
        scopeRung("block", (block && block.box) || {})
      ]);
    }
    // Interaction gate: System (off) -> Course (doc.gateAllInteractions) -> Page
    // (page.gateInteractions). The two upper rungs store the same idea under different keys,
    // which is why per-rung name mapping lives in read() — the same seam a second axis uses.
    function gateScopeChain(page) {
      return scopeChain([
        { scope: "system", label: "System", read: function () { return false; } },
        { scope: "course", label: "Course", read: function () { return E.doc.gateAllInteractions ? true : NOT_SET; } },
        page ? scopeRung("page", page) : null
      ]);
    }

    // uio-E-C03. Text style: Theme -> the named text style this block references -> the block's
    // own style bag. The three rungs are exactly the cascade render.js already applies
    // (course.css class, then resolveBlockStyle's named-style merge, then per-block overrides),
    // surfaced through the one resolver rather than restated as a second model.
    //
    // The colour rung is the "same idea, different keys" seam in use: a bag stores colour as one
    // of colorToken / colorLight+colorDark / color, so the rung normalises to the colorField
    // shape and the resolver never learns that four keys are one property.
    /* @ec03-start */
    var TEXT_COLOR_PROP = "__colorField";
    function textColorOf(bag) {
      if (!bag) return NOT_SET;
      if (bag.colorToken) return { token: bag.colorToken };
      if (bag.colorLight || bag.colorDark) return { light: bag.colorLight || bag.colorDark, dark: bag.colorDark || bag.colorLight };
      if (bag.color != null && bag.color !== "") return { hex: bag.color };
      return NOT_SET;
    }
    function textStyleRung(scope, label, bag) {
      return {
        scope: scope, label: label,
        read: function (prop) {
          if (prop === TEXT_COLOR_PROP) return textColorOf(bag);
          if (!bag) return NOT_SET;
          var v = Object.prototype.hasOwnProperty.call(bag, prop) ? bag[prop] : NOT_SET;
          // A style bag carries `undefined` / "" for props it does not set (the controls delete
          // by writing those), so presence alone would report a rung as setting something it does
          // not. Only the block rung can legitimately hold a falsy-but-real value here, and none
          // of the typography props has one — 0px text and an empty font are not values.
          return (v === undefined || v === "" || v === null) ? NOT_SET : v;
        }
      };
    }
    // spec: { theme (measured baseline bag), styleName, styleProps, block (the block's style bag) }
    function textStyleChain(spec) {
      spec = spec || {};
      return scopeChain([
        spec.theme ? textStyleRung("system", "Theme", spec.theme) : null,
        spec.styleProps ? textStyleRung("course", "Style “" + (spec.styleName || "") + "”", spec.styleProps) : null,
        textStyleRung("block", "Block", spec.block || {})
      ]);
    }
    // A resolved weight is a number on the model and a word in the chrome, and the ghost text
    // has to read the way the picker's own options do.
    var WEIGHT_LABELS = { "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra" };
    function weightLabel(v) { var k = String(v == null ? "" : v); return WEIGHT_LABELS[k] || k; }
    // getComputedStyle hands back rgb()/rgba(); every colour control downstream speaks hex.
    // Fully transparent stays null — the one state that legitimately paints a checkerboard.
    function cssColorToHex(css) {
      var m = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/i.exec(String(css || "").trim());
      if (!m) return /^#[0-9a-f]{3,8}$/i.test(String(css || "").trim()) ? String(css).trim() : null;
      var a = m[4] == null ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      if (!(a > 0)) return null;
      function hx(n) { var v = Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16); return v.length === 1 ? "0" + v : v; }
      return "#" + hx(m[1]) + hx(m[2]) + hx(m[3]);
    }
    /* @ec03-end */
    // The Theme rung is MEASURED, never guessed. A text block's baseline is course.css reading
    // theme vars (--font-heading, --size-page-title) mixed with literals (.page-title is
    // font-weight 700, .body-copy is 17px), and a copy of that table in JS is how the ghost text
    // and the canvas drift apart. So: clone the block's own rendered node in place, strip the
    // inline props applyTextStyle owns, measure, drop it. Same ancestors, same classes, same
    // theme vars, so it is the real baseline for any block type without a mapping table.
    var TEXT_BASELINE_PROPS = ["fontFamily", "fontSize", "fontWeight", "color", "lineHeight",
      "letterSpacing", "wordSpacing", "textTransform", "textIndent", "textAlign"];
    function measureTextBaseline(node) {
      if (!node || !node.cloneNode || !node.parentNode) return null;
      if (typeof window.getComputedStyle !== "function") return null;
      var probe = node.cloneNode(false);   // shallow: the classes and the tag, none of the copy
      TEXT_BASELINE_PROPS.forEach(function (p) { try { probe.style[p] = ""; } catch (e) {} });
      if (probe.style.removeProperty) { probe.style.removeProperty("--tc-light"); probe.style.removeProperty("--tc-dark"); }
      probe.removeAttribute("contenteditable");
      probe.removeAttribute("id");
      probe.setAttribute("aria-hidden", "true");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      var out = null;
      try {
        node.parentNode.appendChild(probe);
        var cs = window.getComputedStyle(probe);
        if (!cs) return null;
        var px = parseFloat(cs.fontSize);
        var lh = parseFloat(cs.lineHeight);
        out = {
          font: (typeof window.fontNameFromStack === "function" ? window.fontNameFromStack(cs.fontFamily) : "") || "",
          size: isNaN(px) ? undefined : Math.round(px),
          weight: String(parseInt(cs.fontWeight, 10) || 400),
          color: cssColorToHex(cs.color),
          lineHeight: (isNaN(lh) || isNaN(px) || !px) ? undefined : Math.round((lh / px) * 100) / 100
        };
      } catch (e) { out = null; }
      finally { if (probe.parentNode) probe.parentNode.removeChild(probe); }
      return out;
    }

    // ---- The shared settings/overlay row (uio-F01 — the UI spine's row anatomy) ------
    // ONE row reused identically across sheet / popover / inspector: a fixed label column,
    // the control beside it, an optional inheritance tail, and a hover-only overflow. It is
    // width-independent by construction (label fixed in px, control flexes, tail/overflow
    // fixed), so it renders identically at any panel width. A Switch is a control in this
    // row, not a different row (the toggle variant grows the label and right-aligns the
    // control). uio-F03 fills the inheritance tail: pass `inherit` and the row renders the
    // inherited / overridden / Reset language from a resolveScoped result. See
    // design-system/readme.md "The UI spine" and design-system/components/controls/FieldRow.*.
    //   opts: { label, control, tail (node), inherit ({res,format,onReset}),
    //           overflow ({title,onClick}), host, variant, controlAlign ("end") }
    function settingsRow(opts) {
      opts = opts || {};
      var row = h("div", "insp-row" + (opts.variant ? " " + opts.variant : ""));
      var label = null;
      if (opts.label != null && opts.label !== "") {
        label = h("span", "insp-row__label", opts.label);
        row.appendChild(label);
      } else {
        row.classList.add("insp-row--nolabel");
      }
      if (opts.control) {
        if (opts.controlAlign === "end" && opts.control.classList) opts.control.classList.add("insp-row__control--end");
        row.appendChild(opts.control);
      }
      // uio-F03 fills the tail slot: pass `inherit` ({res, format, onReset}) and the row shows
      // the scope/inheritance language; `tail` still takes a ready-made node.
      var tailNode = opts.tail || (opts.inherit ? inheritanceTail(opts.inherit) : null);
      if (tailNode) {
        var tail = h("div", "insp-row__tail");
        tail.appendChild(tailNode);
        row.appendChild(tail);
      }
      if (opts.overflow) {
        var ov = h("button", "insp-row__overflow"); ov.type = "button";
        ov.innerHTML = Icon("more-horizontal");
        ov.title = opts.overflow.title || "More actions";
        ov.addEventListener("click", function (ev) { ev.stopPropagation(); opts.overflow.onClick(ev, ov); });
        row.appendChild(ov);
      }
      (opts.host || E.inspector).appendChild(row);
      return { row: row, label: label };
    }
    window.__settingsRow = settingsRow; // headless test hook

    // uio-O-W1 (OVL-06): a setting that is READ-ONLY here because another surface owns it.
    // The old shape was dead prose telling the author to walk somewhere ("edit it in the
    // Learner nav panel"). This is the one replacement: the shared row (uio-F01) showing the
    // LIVE value plus a link that navigates there — never an instruction. Every cross-reference
    // in the chrome uses this, so one row anatomy covers them all.
    // opts: { label, value, linkLabel, onNavigate, host, title }.
    function crossRefRow(opts) {
      opts = opts || {};
      var wrap = h("div", "insp-xref");
      if (opts.value != null && opts.value !== "") wrap.appendChild(h("span", "insp-xref__value", String(opts.value)));
      var link = h("button", "insp-xref__link"); link.type = "button";
      link.appendChild(h("span", "insp-xref__link-label", opts.linkLabel || "Open"));
      var chev = h("span", "insp-xref__chev"); chev.innerHTML = Icon("chevron-right"); link.appendChild(chev);
      link.title = opts.title || ("Go to " + (opts.linkLabel || "the panel that owns this"));
      link.addEventListener("click", function () { if (opts.onNavigate) opts.onNavigate(); });
      wrap.appendChild(link);
      return settingsRow({ label: opts.label, host: opts.host || E.inspector, control: wrap, controlAlign: "end" });
    }
    window.__crossRefRow = crossRefRow; // headless test hook

    function fieldRow(label, value, onchange, placeholder, step, min, max, datalistId) {
      var i = h("input", "prop-text"); i.type = "text"; i.spellcheck = false; i.placeholder = placeholder || "auto"; i.value = value == null ? "" : value;
      if (datalistId) {
        ensureDatalists();
        i.setAttribute("list", datalistId);
      }
      i.addEventListener("change", function () { pushHistory(); onchange(i.value); });
      var r = settingsRow({ label: label, control: i });
      if (step) {
        makeScrubbable(r.label, i, function (v) { onchange(v); }, step, min, max);
      }
      return i;
    }

    // A segmented (single-choice) control that updates its own is-on state in place
    // and applies LIVE — never rebuilds the panel, so selection/scroll are kept.
    function segmentedLive(labelText, options, isCurrent, onPick, target, noHistory) {
      var host = target || E.inspector;
      host.appendChild(h("div", "insp-row__label insp-row__label--stacked", labelText));
      var rowEl = h("div", "prop-toggle-row");
      var btns = [];
      options.forEach(function (o) {
        var b = h("button", "prop-toggle" + (isCurrent(o[1]) ? " is-on" : ""), o[0]);
        b.addEventListener("click", function () { if (!noHistory) pushHistory(); onPick(o[1]); btns.forEach(function (x) { x.classList.remove("is-on"); }); b.classList.add("is-on"); });
        btns.push(b); rowEl.appendChild(b);
      });
      host.appendChild(rowEl);
    }

    // Inline-icon numeric-field glyphs now come from the offline Icon accessor
    // (src/icons.js, Lucide bundled). The hand-drawn GLYPHS set has been retired;
    // dimensional fields keep their letter marks (H / W / A) as raw chars.

    // inline-icon numeric field. Returns { wrap, input }; the caller
    // places wrap (single, or inside a twoUp cell). Write semantics mirror fieldRow
    // exactly (pushHistory on change; raw onchange on scrub) so swapping a fieldRow
    // for an iconField is pure headerFooter -- the model write is identical.
    // opts: value, onchange, unit, placeholder, step, min, max, datalist, title
    function iconField(glyph, opts) {
      opts = opts || {};
      var wrap = h("div", "prop-field");
      if (opts.title) wrap.title = opts.title;
      var g = h("span", "prop-field__glyph"); g.innerHTML = glyph;
      wrap.appendChild(g);
      var i = h("input", "prop-field__input"); i.type = "text"; i.spellcheck = false;
      i.placeholder = opts.placeholder || "";
      i.value = opts.value == null ? "" : opts.value;
      if (opts.datalist) { ensureDatalists(); i.setAttribute("list", opts.datalist); }
      i.addEventListener("change", function () { if (!opts.noHistory) pushHistory(); opts.onchange(i.value); });
      wrap.appendChild(i);
      if (opts.unit) wrap.appendChild(h("span", "prop-field__unit", opts.unit));
      if (opts.step) makeScrubbable(g, i, function (v) { opts.onchange(v); }, opts.step, opts.min, opts.max);
      // NOTE: DialKit scroll-to-fine-tune (wheel over field changes value) RETIRED 2026-07-08
      // (James) — too easy to change a value by accident while scrolling the panel. The glyph
      // drag-scrub (makeScrubbable, above) is the deliberate quick-adjust; type for exact values.
      return { wrap: wrap, input: i };
    }
    window.__iconField = iconField; // headless test hook
    // two naturally-paired fields side by side (paired X/Y, W/H). Pass one or two
    // node(s) (typically iconField(...).wrap). Returns the row element.
    function twoUp(a, b) {
      var row = h("div", "prop-grid-row");
      var c1 = h("div", "prop-grid-cell"); c1.appendChild(a); row.appendChild(c1);
      var c2 = h("div", "prop-grid-cell"); if (b) c2.appendChild(b); row.appendChild(c2);
      return row;
    }
    // section header with an optional right-aligned "+" add/reveal affordance
    // (Fill / Stroke pattern). onAdd runs the SAME handler the old full-width
    // button ran -- the "+" is a re-style of the trigger, not a new behaviour.
    function propHeader(title, onAdd, addTitle) {
      var row = h("div", "prop-head-row");
      row.appendChild(h("span", "prop-head-row__title", title));
      if (onAdd) {
        var add = h("button", "prop-add"); add.type = "button";
        add.innerHTML = Icon("plus");
        add.title = addTitle || ("Add " + title.toLowerCase());
        add.addEventListener("click", onAdd);
        row.appendChild(add);
      }
      return row;
    }

    // Inspector breadcrumb. Names the current selection
    // DEPTH and lets you click back out to a shallower level — the anchor that stops
    // Content level being a trap. `trail` = [{label, level}, ...] outermost -> current;
    // every crumb but the last is a button calling onNavigate(level). Pure view — the
    // caller owns what `level` means and what navigating does.
    function breadcrumb(host, trail, onNavigate) {
      trail = trail || [];
      // DS re-skin (issue #14): build via the canonical VersoUI.Breadcrumb (identical
      // insp-crumbs DOM: last crumb = current, earlier crumbs are buttons). Falls back
      // to the local builder if the DS library is somehow absent (switchEl-style guard).
      if (window.VersoUI && window.VersoUI.Breadcrumb) {
        var items = trail.map(function (c, i) {
          var last = i === trail.length - 1;
          return { label: c.label, onClick: last ? null : (function (level) { return function () { if (onNavigate) onNavigate(level); }; })(c.level) };
        });
        var dsBar = window.VersoUI.Breadcrumb({ items: items });
        host.appendChild(dsBar);
        return dsBar;
      }
      var bar = h("div", "insp-crumbs");
      trail.forEach(function (c, i) {
        if (i > 0) {
          var sep = h("span", "insp-crumbs__sep");
          sep.innerHTML = Icon("chevron-right");
          bar.appendChild(sep);
        }
        if (i === trail.length - 1) {
          bar.appendChild(h("span", "insp-crumbs__cur", c.label));
        } else {
          var b = h("button", "insp-crumbs__crumb"); b.type = "button"; b.textContent = c.label;
          (function (level) { b.addEventListener("click", function () { if (onNavigate) onNavigate(level); }); })(c.level);
          bar.appendChild(b);
        }
      });
      host.appendChild(bar);
      return bar;
    }

    // Collapsed-optional section. The Fill/Stroke
    // pattern generalised: when OFF it's a single quiet (semi-greyed) row — title + "+".
    // Click "+" to enable the set + expand its controls inline. When ON it's a header
    // (title + a "-" remove) over the body. Toggling repaints ONLY this section (never
    // mount()/renderInspector), so it applies LIVE like the other canonical controls.
    // opts: { get():bool, set(bool), build(bodyEl), addTitle, removeTitle, noHistory }.
    // The caller's set() owns the model rule (what to write on enable / clear on disable).
    function optionalRow(host, title, opts) {
      opts = opts || {};
      var wrap = h("div", "opt-sec");
      function paint() {
        wrap.innerHTML = "";
        if (opts.get()) {
          wrap.classList.add("is-on");
          var head = h("div", "prop-head-row");
          head.appendChild(h("span", "prop-head-row__title", title));
          var rm = h("button", "prop-add opt-sec__remove"); rm.type = "button";
          rm.innerHTML = Icon("minus");
          rm.title = opts.removeTitle || ("Remove " + title.toLowerCase());
          rm.addEventListener("click", function () { if (!opts.noHistory) pushHistory(); opts.set(false); paint(); });
          head.appendChild(rm);
          wrap.appendChild(head);
          var body = h("div", "opt-sec__body");
          opts.build(body);
          wrap.appendChild(body);
        } else {
          wrap.classList.remove("is-on");
          var row = h("div", "opt-sec__off");
          row.appendChild(h("span", "opt-sec__off-title", title));
          var add = h("button", "prop-add"); add.type = "button";
          add.innerHTML = Icon("plus");
          add.title = opts.addTitle || ("Add " + title.toLowerCase());
          add.addEventListener("click", function () { if (!opts.noHistory) pushHistory(); opts.set(true); paint(); });
          row.appendChild(add);
          wrap.appendChild(row);
        }
      }
      paint();
      host.appendChild(wrap);
      return wrap;
    }

    // Repeated-item list. One row per item = grip handle
    // (drag to reorder) + a full-width field + a trash. A single "+" above the list
    // adds. No per-row label — the header (propHeader) names the set once; a
    // placeholder carries the field's meaning. Add / remove / reorder repaint the
    // list in place (structural); a field edit writes live WITHOUT repaint (keeps
    // focus/caret) — the canonical fieldRow commit-on-change semantics. opts:
    // items():array · value(item):string · setValue(item,v) · add() · remove(i)
    // move(from,to) · placeholder · addLabel · removeTitle · onChange · noHistory
    function repeatedList(host, title, opts) {
      opts = opts || {};
      var wrap = h("div", "rep-list");
      var dragFrom = -1;
      function commit(fn) { if (!opts.noHistory) pushHistory(); fn(); paint(); if (opts.onChange) opts.onChange(); }
      function paint() {
        wrap.innerHTML = "";
        if (title != null) wrap.appendChild(propHeader(title, function () { commit(function () { opts.add(); }); }, opts.addLabel || ("Add " + String(title).toLowerCase())));
        var items = opts.items() || [];
        items.forEach(function (item, i) {
          var row = h("div", "rep-row");
          var grip = h("span", "rep-row__grip"); grip.title = "Drag to reorder";
          grip.innerHTML = Icon("grip-vertical");
          grip.setAttribute("draggable", "true");
          grip.addEventListener("dragstart", function (e) { dragFrom = i; row.classList.add("is-dragging"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); } catch (_) {} });
          grip.addEventListener("dragend", function () { dragFrom = -1; [].forEach.call(wrap.querySelectorAll(".rep-row"), function (r) { r.classList.remove("is-dragging", "is-drop-target"); }); });
          row.addEventListener("dragover", function (e) { if (dragFrom < 0) return; e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch (_) {} row.classList.add("is-drop-target"); });
          row.addEventListener("dragleave", function () { row.classList.remove("is-drop-target"); });
          row.addEventListener("drop", function (e) { e.preventDefault(); row.classList.remove("is-drop-target"); var from = dragFrom; dragFrom = -1; if (from < 0 || from === i) return; commit(function () { opts.move(from, i); }); });
          var field = h("input", "rep-row__field"); field.type = "text"; field.spellcheck = false;
          field.placeholder = opts.placeholder || ""; field.value = opts.value ? (opts.value(item) || "") : "";
          // live edit, no repaint (keeps focus/caret) — commit-on-change like fieldRow.
          field.addEventListener("change", function () { if (!opts.noHistory) pushHistory(); opts.setValue(item, field.value); if (opts.onChange) opts.onChange(); });
          var del = iconBtn("trash", opts.removeTitle || "Delete", true); del.classList.add("rep-row__del");
          del.addEventListener("click", function () { commit(function () { opts.remove(i); }); });
          row.appendChild(grip); row.appendChild(field);
          // optional compact per-item extras (icons / a narrow field) between field and
          // trash — for blocks with secondary per-item settings; keeps one row per item.
          if (opts.rowExtras) {
            var ex = opts.rowExtras(item, i);
            (Array.isArray(ex) ? ex : [ex]).forEach(function (n) { if (n instanceof Node) row.appendChild(n); });
          }
          row.appendChild(del);
          wrap.appendChild(row);
        });
      }
      paint();
      host.appendChild(wrap);
      return wrap;
    }

    // Invariant Block-level container chrome. ONE renderer
    // produces the whole Block-level panel from a per-block-type DECLARATION of which
    // container props apply — so a block can't lay this out differently (convergence by
    // construction). Row ORDER is fixed; a prop the decl omits is simply hidden, never
    // reordered. Icon-led, no per-control labels (§ icon policy): fill/stroke use the
    // collapsed-optional row, dims use iconField, actions reuse iconBtn.
    // decl  = which rows apply. Guaranteed unless set false: fill, stroke, radius,
    // spacing, actions. Opt-in (default off): align, width, padding, gap.
    // io    = model-agnostic accessor: io.get(key) / io.set(key, value). Keys: align,
    // width, padX, gap, hasFill, fillColor, hasStroke, strokeColor,
    // strokeWidth, radius, spaceTop, spaceBottom. (Each block supplies its own
    // io when wired in tickets 8-9; until then only the gallery/kit calls this.)
    // handlers = { moveUp, moveDown, duplicate, remove } for the actions row (a missing
    // handler renders its button disabled).
    var CONTAINER_ROW_ORDER = ["align", "width", "padding", "gap", "fill", "stroke", "radius", "spacing", "actions"];
    // The canonical io.get/io.set key contract — the ONLY keys renderContainerChrome
    // reads/writes. Blocks wiring their own io (tickets 8-9) map these exact keys onto
    // their model fields, so the stringly-typed keys have one source of truth.
    var CONTAINER_IO_KEYS = ["align", "width", "padX", "gap", "hasFill", "fillColor", "hasStroke", "strokeColor", "strokeWidth", "radius", "spaceTop", "spaceBottom"];
    function renderContainerChrome(host, decl, io, handlers) {
      decl = decl || {}; io = io || {}; handlers = handlers || {};
      function want(k, def) { return decl[k] === undefined ? def : !!decl[k]; }
      var get = io.get || function () { return undefined; };
      var set = io.set || function () {};
      function num(v) { var n = parseInt(v, 10); return isNaN(n) ? undefined : n; }

      // DS re-skin (issue #14): each named group is a collapsible VersoUI.PanelSection
      // (matching design-system/ui_kits/editor/Inspector.jsx) instead of the old flat
      // insp-sub hairline header. A section is only opened when it has at least one
      // applicable row, so we never leave an orphan header. The first section drops its
      // top divider (the layer crumbs already cap the panel top). Every row inside is a
      // canonical VersoUI control; the model wiring (io.get/set, scrub, optionalRow,
      // pushHistory) is unchanged — this is a re-skin, not a re-wire.
      var firstSection = true;
      function section(title, opts) {
        opts = opts || {};
        if (firstSection) { opts.divider = false; firstSection = false; }
        return panelSection(host, title, opts);
      }
      // 1. Position — horizontal + vertical align, each a DS FieldRow + SegmentedControl
      // (mockup AlignRow). Default ON; a content-less block turns them off in its decl.
      if (want("align", true) || want("valign", true)) {
        var pos = section("Position");
        if (want("align", true)) {
          pos.appendChild(alignSeg("Horizontal", get("align") || "start", [
            { value: "start", icon: "align-left", title: "Left" }, { value: "center", icon: "align-center", title: "Centre" }, { value: "end", icon: "align-right", title: "Right" }
          ], function (v) { set("align", v); }));
        }
        if (want("valign", true)) {
          pos.appendChild(alignSeg("Vertical", get("valign") || "top", [
            { value: "top", icon: "align-start-horizontal", title: "Top" }, { value: "center", icon: "align-center-horizontal", title: "Middle" }, { value: "bottom", icon: "align-end-horizontal", title: "Bottom" }
          ], function (v) { set("valign", v); }));
        }
      }
      // 2. Layout — width, padding + gap, space above/below (icon-led IconField dims).
      var hasLayout = want("width", false) || want("padding", false) || want("gap", false) || want("spacing", true);
      if (hasLayout) {
        var lay = section("Layout");
        if (want("width", false)) {
          lay.appendChild(iconField("W", { value: get("width"), unit: "px", step: 10, min: 0, title: "Width", onchange: function (v) { set("width", num(v)); } }).wrap);
        }
        if (want("padding", false) || want("gap", false)) {
          var pad = want("padding", false) ? iconField(Icon("padding"), { value: get("padX"), unit: "px", step: 1, min: 0, title: "Padding", onchange: function (v) { set("padX", num(v)); } }).wrap : null;
          var gap = want("gap", false) ? iconField(Icon("unfold-horizontal"), { value: get("gap"), unit: "px", step: 1, min: 0, title: "Gap", onchange: function (v) { set("gap", num(v)); } }).wrap : null;
          lay.appendChild(pad && gap ? twoUp(pad, gap) : (pad || gap));
        }
        if (want("spacing", true)) {
          lay.appendChild(twoUp(
            iconField(Icon("arrow-up-to-line"), { value: get("spaceTop"), unit: "px", step: 1, min: -200, max: 200, title: "Space above (negative overlaps)", onchange: function (v) { set("spaceTop", num(v)); } }).wrap,
            iconField(Icon("arrow-down-to-line"), { value: get("spaceBottom"), unit: "px", step: 1, min: -200, max: 200, title: "Space below (negative overlaps)", onchange: function (v) { set("spaceBottom", num(v)); } }).wrap
          ));
        }
      }
      // 3. Appearance — fill, stroke, radius.
      var hasAppearance = want("fill", true) || want("stroke", true) || want("radius", true);
      if (hasAppearance) {
        var ap = section("Appearance");
        if (want("fill", true)) {
          optionalRow(ap, "Fill", { addTitle: "Add fill",
            get: function () { return !!get("hasFill"); },
            set: function (v) { set("hasFill", v); if (!v) set("fillColor", null); },
            build: function (b) { colourControl(null, get("fillColor"), function (v) { set("fillColor", v); }, b); } });
        }
        // Stroke — collapsed-optional (rich: colour + width). decl.stroke === "switch"
        // renders a plain on/off switch instead, for blocks whose border is a theme-styled
        // on/off line (a frame) — so colour/width aren't dead controls.
        if (want("stroke", true)) {
          if (decl.stroke === "switch") {
            switchRow("Stroke", function () { return !!get("hasStroke"); }, function (v) { set("hasStroke", v); }, ap);
          } else {
            optionalRow(ap, "Stroke", { addTitle: "Add stroke",
              get: function () { return !!get("hasStroke"); },
              set: function (v) { set("hasStroke", v); if (!v) set("strokeColor", null); },
              build: function (b) {
                colourControl(null, get("strokeColor"), function (v) { set("strokeColor", v); }, b);
                b.appendChild(iconField(Icon("border-weight"), { value: get("strokeWidth"), unit: "px", step: 1, min: 0, max: 40, title: "Stroke width", onchange: function (v) { set("strokeWidth", num(v)); } }).wrap);
              } });
          }
        }
        // Radius closes the Appearance section.
        if (want("radius", true)) {
          ap.appendChild(iconField(Icon("radius"), { value: get("radius"), unit: "px", step: 1, min: 0, max: 100, title: "Corner radius", onchange: function (v) { set("radius", num(v)); } }).wrap);
        }
      }
      // 4. Actions — move / duplicate / split / delete. These live in the CANVAS overlay
      // bar (a contextual segment appended to #canvas-overlay when a block is selected), so
      // they sit alongside the grid/find/comment/zoom tools in ONE bigger canvas toolbar
      // rather than a panel section. The 'lost' block actions from the left-rail/top-bar
      // reorg are re-joined here. Same handlers, so behaviour is unchanged.
      if (want("actions", true)) {
        var bar = ensureBlockToolbar();
        if (bar) {
          bar.innerHTML = "";
          var acts = [["arrowUp", "Move up", handlers.moveUp, false], ["arrowDown", "Move down", handlers.moveDown, false],
           ["duplicate", "Duplicate", handlers.duplicate, false]];
          // #174: clear content — reset the block subtree to a blank skeleton (keeps structure).
          if (typeof handlers.clearContent === "function") acts.push(["eraser", "Clear content (keep structure)", handlers.clearContent, false]);
          // Slice (split page here) — only offered when the block can be split (top-level,
          // not the first).
          if (typeof handlers.split === "function") acts.push(["slice", "Split page here", handlers.split, false]);
          acts.push(["trash", "Delete", handlers.remove, true]);
          acts.forEach(function (a) {
            var btn = iconBtn(a[0], a[1], a[3]);
            if (a[2]) btn.addEventListener("click", a[2]); else btn.disabled = true;
            bar.appendChild(btn);
          });
          bar.hidden = false;
          if (E.blockToolbarSep) E.blockToolbarSep.hidden = false;
        }
      }
    }
    // ---- Shared palette colour-row (SVG image palette + HTML-interaction palette) ------
    // ONE row = swatch + label + [BG | Text | Keep] toggles + a ⋯ twirl holding the full
    // token dropdown + a "Switch to colour" custom picker. Used identically by both the
    // image SVG palette and the interaction palette so they look + behave the same.
    // BG -> the page-bg token, Text -> ink, Keep -> the authored colour.
    var PALETTE_ROLE_TOKEN = { bg: "bg", text: "ink", keep: "keep" };
    function paletteColorRow(host, o) {
      var map = o.map, key = o.key, tokens = o.tokens || [];
      var explicit = map.hasOwnProperty(key) ? map[key] : null;
      var isCustom = !!explicit && explicit !== "surface" && explicit !== "ink" && explicit !== "keep" && explicit !== "bg";
      var isHexMap = !!explicit && /^(#|rgb)/i.test(String(explicit));
      var role = o.roleOf ? o.roleOf(key) : "keep";
      // Persist the map write NOW (debounced), not only on the 4s autosave tick. Every
      // mutation below routes through apply(), and WKWebView does NOT fire beforeunload
      // on Cmd+R, so without this a colour mapping made just before a hard refresh is
      // lost (reverts) — the same gap the text-edit path closed with scheduleSave. This
      // is the single choke for all three palette consumers (embed / SVG image / glossary).
      function apply() { o.refresh(); scheduleSave(); }
      // Line 1: swatch + label, with a ⋯ advanced-token toggle at the far right.
      var head = h("div", "insp-row");
      var lbl = h("span", "insp-row__label"); lbl.style.flex = "1 1 auto";
      var sw = h("span", "insp-swatch");
      sw.style.cssText = "display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid var(--color-hair);background:" + o.swatchColor;
      lbl.appendChild(sw); lbl.appendChild(document.createTextNode(o.label)); lbl.title = o.label;
      head.appendChild(lbl);
      var advRow = h("div", "insp-row"); advRow.style.marginTop = "5px"; advRow.style.display = isCustom ? "" : "none";
      advRow.appendChild(h("span", "insp-row__label", "Token"));
      var selOpts = [["Auto", "auto"], ["Keep as-is", "keep"]].concat(tokens.map(function (t) { return [t, t]; }));
      if (isHexMap) selOpts.unshift(["Custom colour", "__custom"]);
      var selCurrent = explicit == null ? "auto" : (isHexMap ? "__custom" : explicit);
      var sel = dsSelect(selOpts, selCurrent, function (v) { if (v === "__custom") return; pushHistory(); if (v === "auto") delete map[key]; else map[key] = v; apply(); });
      advRow.appendChild(sel);
      colourControl("Switch to colour", isHexMap ? explicit : null, function (v) { pushHistory(); if (v == null) delete map[key]; else map[key] = v; apply(); }, advRow);
      var advBtn = h("button", null, "⋯");
      advBtn.type = "button"; advBtn.title = "Advanced — map this colour to a specific theme token";
      advBtn.style.cssText = "flex:0 0 auto;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:13px;line-height:1;color:var(--text-secondary);border:1px solid var(--border-subtle);background:" + (isCustom ? "var(--surface-raised)" : "transparent") + ";";
      advBtn.addEventListener("click", function () { advRow.style.display = advRow.style.display === "none" ? "" : "none"; });
      head.appendChild(advBtn);
      host.appendChild(head);
      // Line 2: full-width role toggles — their own row so labels never truncate.
      var roleRow = h("div", "prop-toggle-row"); roleRow.style.marginTop = "5px";
      [["BG", "bg"], ["Text", "text"], ["Keep", "keep"]].forEach(function (ro) {
        var b = h("button", "prop-toggle" + (!isCustom && role === ro[1] ? " is-on" : ""), ro[0]);
        b.type = "button";
        b.title = ro[1] === "bg" ? "Background — follows the theme (light in light mode, dark in dark mode)" : ro[1] === "text" ? "Text — follows the theme (contrasts the background per mode)" : "Keep this colour exactly as authored (brand/accent)";
        b.addEventListener("click", function () { pushHistory(); map[key] = PALETTE_ROLE_TOKEN[ro[1]]; apply(); });
        roleRow.appendChild(b);
      });
      host.appendChild(roleRow);
      host.appendChild(advRow);
    }

    // What editor.js and the other regions still call. The scope tally crosses in both directions
    // because a panel build borrows the buffer and hands it back -- it is the one piece of state
    // this file owns rather than derives.
    kernel.provideLive({ scopeTally: function () { return _scopeTally; } });
    kernel.provide({ setScopeTally: function (v) { _scopeTally = v; } });

    // ---- the three shared controls the panels mount by name (arch-P3b-07prim2) ------
    // The generalised listbox, its labelled row, the Type cluster and the font-embed warning.
    // They stayed in editor.js when 07b took the rest of the control set because they sat two
    // hundred lines away under the format-bar banner, not because they are a different concern:
    // customSelectRow is mounted by the block panels, typeCluster by the field inspector AND the
    // theme panel from one implementation, and attachFontWarn by every surface that offers a font.
    // Panel System v2 (James 2026-07-08): the generalised custom listbox. Same shape as
    // buildFontPicker (a button + popup, exposes `.value` get/set, fires 'change' on pick)
    // but each option can carry a live PREVIEW instead of a bare word — a CSS style applied
    // to the row+button (e.g. render a text-style name IN that style) and/or preview HTML
    // (e.g. the actual bullet glyph). Reuses the .font-picker chrome so styling stays shared.
    // options: [value, label, meta?]  meta = { style?: cssText, html?: rowInnerHTML,
    // btnHtml?: buttonInnerHTML (falls back to html) }.
    function customSelect(current, options, onPick, opts) {
      opts = opts || {};
      var wrap = h("div", "font-picker custom-select");
      var btn = h("button", "font-picker__btn prop-select"); btn.type = "button";
      var pop = h("div", "font-picker__pop"); pop.hidden = true;
      var val = current == null ? "" : String(current);
      function find(v) { for (var i = 0; i < options.length; i++) { if (String(options[i][0]) === String(v)) return options[i]; } return null; }
      function paintBtn() {
        var o = find(val) || options[0] || ["", opts.placeholder || ""];
        var meta = o[2] || {};
        btn.style.cssText = ""; // clear any prior preview style
        if (meta.btnHtml || meta.html) btn.innerHTML = meta.btnHtml || meta.html; else btn.textContent = o[1];
        if (meta.style) btn.style.cssText = meta.style;
      }
      options.forEach(function (o) {
        var meta = o[2] || {};
        var row = h("div", "font-picker__opt" + (String(o[0]) === val ? " is-active" : ""));
        if (meta.html) row.innerHTML = meta.html; else row.textContent = o[1];
        if (meta.style) row.style.cssText = meta.style;
        row.addEventListener("click", function () {
          val = String(o[0]); paintBtn();
          Array.prototype.forEach.call(pop.children, function (c) { c.classList.remove("is-active"); });
          row.classList.add("is-active");
          close(); onPick(o[0]);
          try { wrap.dispatchEvent(new Event("change")); } catch (_) {}
        });
        pop.appendChild(row);
      });
      function onDoc(e) { if (!wrap.contains(e.target)) close(); }
      function onEsc(e) { if (e.key === "Escape") close(); }
      function open() { pop.hidden = false; btn.classList.add("is-open"); setTimeout(function () { document.addEventListener("mousedown", onDoc); }, 0); document.addEventListener("keydown", onEsc); }
      function close() { pop.hidden = true; btn.classList.remove("is-open"); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); }
      btn.addEventListener("click", function () { pop.hidden ? open() : close(); });
      wrap.appendChild(btn); wrap.appendChild(pop);
      paintBtn();
      Object.defineProperty(wrap, "value", { get: function () { return val; }, set: function (v) { val = v == null ? "" : String(v); paintBtn(); } });
      return wrap;
    }
    window.__customSelect = customSelect; // headless test hook
    // Drop-in for selectRow that renders a customSelect (with previews) instead of a native
    // <select>. Same signature + pushHistory-on-pick behaviour, appended to `inspector`.
    function customSelectRow(label, options, current, onchange, opts) {
      E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", label));
      var cs = customSelect(current, options, function (v) { pushHistory(); onchange(v); }, opts);
      E.inspector.appendChild(cs);
      return cs;
    }

    // Panel System v2 (D4) — the ONE reusable Type control body. Renders font/weight/size/
    // colour(colorField)/line-height/tracking/word-spacing/case/indent/alignment onto `model`,
    // calling onChange() after each edit. Mounted IDENTICALLY in the field inspector AND the
    // Edit-Text-Style dialog. `model` fields: font,weight,size,lineHeight,letterSpacing,
    // wordSpacing,textTransform,textIndent,align,color,colorToken,colorLight,colorDark.
    // opts (field-inspector only): { fieldNode, applyWeightToSelection(weight, range) }.
    // When present, the Weight control is SELECTION-AWARE — highlighted text is weighted
    // inline (a font-weight span) and the whole-field model.weight is left untouched; with
    // no live selection it sets model.weight as before. The Edit-Text-Style dialog passes no
    // opts (there is no live text there), so its Weight stays whole-model. #99/#44 follow-up:
    // this collapses the old twin whole-field + selection weight controls into one.
    function typeCluster(container, model, onChange, opts) {
      onChange = onChange || function () {};
      opts = opts || {};
      // uio-E-C03. With a scope spec the cluster stops saying "Default" / "auto" / nothing and
      // says what the text is ACTUALLY set to, in tertiary ink, naming where it comes from. The
      // Edit-Text-Style dialog passes no spec (a draft style has no block and no canvas node to
      // resolve against), so it keeps the old placeholders — resolve() answers null there and
      // every branch below falls back to what it did before.
      var chain = opts.scope ? textStyleChain(opts.scope) : null;
      function resolve(prop) { return chain ? resolveScoped(chain, prop, { at: "block" }) : null; }
      function ghost(res, format) {
        if (!res || !res.found || res.overridden) return null;
        return { text: (format || String)(res.value), title: inheritedTooltip(res, format) };
      }
      // FieldRow.prompt.md: a WIDE control (the colour field, a full-width picker) stacks its
      // label above itself and is otherwise the same row family — so the inheritance tail belongs
      // on that label line. Both halves of the spine's language land here: the source scope named
      // in tertiary ink when inherited, the accent dot + inline Reset when this field owns the
      // value. The glyph-only cells below have no label line to carry a tail and state their
      // scope on hover until they are routed through settingsRow.
      function stackedLabel(text, res, format, onReset) {
        var line = h("div", "insp-row__label insp-row__label--stacked insp-label-line");
        line.appendChild(h("span", null, text));
        var tail = res ? inheritanceTail({ res: res, format: format, onReset: onReset }) : null;
        if (tail) line.appendChild(tail);
        container.appendChild(line);
      }
      var fontRes = resolve("font");
      stackedLabel("Font", fontRes, null, function () { delete model.font; onChange(); });
      var fontGhost = ghost(fontRes);
      var fp = buildFontPicker(model.font || "", function (v) { model.font = v; onChange(); },
        fontGhost ? { inherited: fontGhost.text, inheritedTitle: fontGhost.title } : null);
      container.appendChild(fp);
      container.appendChild(attachFontWarn(fp));
      // Size + Weight
      var sizeGhost = ghost(resolve("size"));
      var size = iconField("A", { value: model.size == null ? "" : model.size, unit: "px", placeholder: sizeGhost ? sizeGhost.text : "auto", step: 1, min: 1, max: 200, datalist: "dl-font-size", noHistory: true, title: sizeGhost ? sizeGhost.title : "Font size",
        onchange: function (v) { var n = parseInt(v, 10); model.size = isNaN(n) ? undefined : n; onChange(); } }).wrap;
      if (sizeGhost) size.classList.add("is-inherited");
      // Selection-aware (field inspector): opening the <select> steals focus + collapses the
      // selection, so capture the live field range on mousedown (same trick the Link button uses).
      var savedWtRange = null;
      var wtGhost = ghost(resolve("weight"), weightLabel);
      var wt = dsSelect([[wtGhost ? wtGhost.text : "Weight", ""], ["Regular", "400"], ["Medium", "500"], ["Semibold", "600"], ["Bold", "700"], ["Extra", "800"]], model.weight || "", function (weight) {
        if (savedWtRange && opts && opts.applyWeightToSelection) {
          var range = savedWtRange; savedWtRange = null;
          if (!weight) return; // empty on a live selection = no-op (don't clear the whole field)
          if (opts.applyWeightToSelection(weight, range)) return; // weighted the selection inline
        }
        model.weight = weight; onChange(); // no selection -> whole field (or the style draft)
      });
      if (opts && opts.fieldNode) {
        wt.addEventListener("mousedown", function () {
          var sel = window.getSelection();
          var r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
          savedWtRange = (r && !r.collapsed && opts.fieldNode.contains(r.commonAncestorContainer)) ? r.cloneRange() : null;
        });
      }
      if (wtGhost) { wt.classList.add("is-inherited"); wt.title = wtGhost.title; }
      container.appendChild(twoUp(size, wt));
      // Colour — the unified colorField (token XOR hex XOR per-mode).
      // The audit's sharpest complaint was here: an unset text colour painted a transparency
      // checkerboard, which everywhere else means "no colour". Text colour is never transparent
      // — it inherits — so the swatch now paints the colour that will actually apply and marks
      // it inherited. The checkerboard is left to the fields where empty really does mean no paint.
      var colGhost = resolve(TEXT_COLOR_PROP);
      function colourWords(v) { return !v ? "" : (v.token ? v.token : (v.light || v.dark ? "per-mode" : v.hex)); }
      stackedLabel("Colour", colGhost, colourWords, function () {
        delete model.color; delete model.colorToken; delete model.colorLight; delete model.colorDark; onChange();
      });
      function tcVal() { return model.colorToken ? { token: model.colorToken } : (model.colorLight || model.colorDark ? { light: model.colorLight, dark: model.colorDark } : (model.color != null ? { hex: model.color } : null)); }
      colorField(null, tcVal(), function (v) {
        delete model.color; delete model.colorToken; delete model.colorLight; delete model.colorDark;
        if (v && v.token) model.colorToken = v.token;
        else if (v && (v.light || v.dark)) { model.colorLight = v.light; model.colorDark = v.dark; }
        else if (v && v.hex) model.color = v.hex;
        onChange();
      }, container, (colGhost && colGhost.found && !colGhost.overridden)
        ? { inherited: colGhost.value, inheritedFrom: colGhost.scopeLabel }
        : null);
      // Line-height + tracking
      var lhGhost = ghost(resolve("lineHeight"));
      var lh = iconField(Icon("line-height"), { value: model.lineHeight == null ? "" : model.lineHeight, placeholder: lhGhost ? lhGhost.text : "1.5", step: 0.05, min: 0.5, max: 3, datalist: "dl-line-height", noHistory: true, title: lhGhost ? lhGhost.title : "Line height",
        onchange: function (v) { model.lineHeight = (v ? v : undefined); onChange(); } }).wrap;
      if (lhGhost) lh.classList.add("is-inherited");
      container.appendChild(twoUp(lh,
        iconField(Icon("letter-spacing"), { value: model.letterSpacing == null ? "" : model.letterSpacing, unit: "px", placeholder: "0", step: 0.1, min: -10, max: 50, datalist: "dl-letter-spacing", noHistory: true, title: "Letter spacing",
          onchange: function (v) { var n = parseFloat(v); model.letterSpacing = isNaN(n) ? undefined : n; onChange(); } }).wrap));
      // Word-spacing + first-line indent
      container.appendChild(twoUp(
        iconField(Icon("word-spacing"), { value: model.wordSpacing == null ? "" : model.wordSpacing, unit: "px", placeholder: "0", step: 0.5, min: -20, max: 100, datalist: "dl-gap", noHistory: true, title: "Word spacing",
          onchange: function (v) { var n = parseFloat(v); model.wordSpacing = isNaN(n) ? undefined : n; onChange(); } }).wrap,
        iconField(Icon("indent-increase"), { value: model.textIndent == null ? "" : model.textIndent, unit: "px", placeholder: "0", step: 2, min: 0, max: 200, datalist: "dl-gap", noHistory: true, title: "First-line indent",
          onchange: function (v) { var n = parseInt(v, 10); model.textIndent = isNaN(n) ? undefined : n; onChange(); } }).wrap));
      // Case + Alignment (icon segments)
      segmentedLive("Case", [["None", ""], ["UPPER", "uppercase"], ["lower", "lowercase"], ["Title", "capitalize"]],
        function (val) { return (model.textTransform || "") === val; },
        function (val) { model.textTransform = val || undefined; onChange(); }, container, true);
      segmentedIconLive("Align", [[Icon("align-left"), "left", "Left"], [Icon("align-center"), "center", "Center"], [Icon("align-right"), "right", "Right"], [Icon("align-justify"), "justify", "Justify"]],
        function (val) { return (model.align || "left") === val; },
        function (val) { model.align = val; onChange(); }, container, true);
    }
    window.__typeCluster = typeCluster; // test hook

    // Builds the "not embeddable" warning note for a font <select> and keeps it in
    // sync with the current value. Returns the note node; the caller places it just
    // under the picker. Hidden while the choice is safe; shown (flex) otherwise.
    function attachFontWarn(selectEl) {
      var note = h("div", "font-embed-warn");
      var ic = h("span", "font-embed-warn__icon", "!"); ic.setAttribute("aria-hidden", "true");
      note.appendChild(ic);
      note.appendChild(h("span", "font-embed-warn__text", "Not in the embeddable set - may not render on an offline/air-gapped machine unless embedded at export."));
      function sync() { note.style.display = isEmbeddableFont(selectEl.value) ? "none" : "flex"; }
      selectEl.addEventListener("change", sync);
      sync();
      return note;
    }

    kernel.expose({
      ensureDatalists: ensureDatalists, makeScrubbable: makeScrubbable,
      switchEl: switchEl, switchRow: switchRow, eyeRow: eyeRow,
      segmentedIconLive: segmentedIconLive, subDisclosure: subDisclosure,
      sectionSummary: sectionSummary, headerFooterSummary: headerFooterSummary,
      nestOverridden: nestOverridden, nestReset: nestReset,
      scopeLabel: scopeLabel, scopeDepth: scopeDepth, scopeRung: scopeRung, scopeChain: scopeChain,
      resolveScoped: resolveScoped, resetPlan: resetPlan, resetTooltip: resetTooltip,
      inheritedTooltip: inheritedTooltip, overrideCount: overrideCount, rollupLabel: rollupLabel,
      tallyResolution: tallyResolution, inheritanceTail: inheritanceTail, onOffLabel: onOffLabel,
      blockBoxChain: blockBoxChain, gateScopeChain: gateScopeChain,
      textStyleChain: textStyleChain, measureTextBaseline: measureTextBaseline,
      cssColorToHex: cssColorToHex, weightLabel: weightLabel,
      settingsRow: settingsRow, crossRefRow: crossRefRow, fieldRow: fieldRow,
      segmentedLive: segmentedLive, iconField: iconField, twoUp: twoUp, propHeader: propHeader,
      breadcrumb: breadcrumb, optionalRow: optionalRow, repeatedList: repeatedList,
      renderContainerChrome: renderContainerChrome,
      iconBtn: iconBtn, dsSelect: dsSelect, selectRow: selectRow,
      paletteColorRow: paletteColorRow,
      customSelectRow: customSelectRow, typeCluster: typeCluster, attachFontWarn: attachFontWarn
    });
    // Constants the panels read as data rather than call.
    kernel.provide({
      HEADER_STYLE_KEYS: HEADER_STYLE_KEYS, FOOTER_STYLE_KEYS: FOOTER_STYLE_KEYS,
      NAV_BTN_KEYS: NAV_BTN_KEYS, NAV_PILL_KEYS: NAV_PILL_KEYS,
      SCOPE_LADDER: SCOPE_LADDER, SCOPE_LABELS: SCOPE_LABELS, NOT_SET: NOT_SET,
      TEXT_COLOR_PROP: TEXT_COLOR_PROP,
      BOX_SYSTEM_DEFAULTS: BOX_SYSTEM_DEFAULTS,
      CONTAINER_ROW_ORDER: CONTAINER_ROW_ORDER, CONTAINER_IO_KEYS: CONTAINER_IO_KEYS,
      ICON_ALIAS: ICON_ALIAS
    });
  }

  window.VersoInspectorPrimitives = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoInspectorPrimitives;
})();
