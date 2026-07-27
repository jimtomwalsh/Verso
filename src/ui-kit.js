// ui-kit.js — the Verso Design System canonical control set, vanilla + offline.
//
// Issue #10 (parent #22). A SINGLE canonical, classic-
// script implementation of each DS primitive, conforming to its contract in
// design-system/components/**/<Name>.d.ts + .prompt.md. Token-driven (DS tokens
// via editor.css, referenced directly); icons ONLY via the Lucide Icon
// accessor (src/icons.js). This is the control LIBRARY (#10); the surface
// re-skins that consume it (TopBar #12, panels #11/#13/#14) land later.
//
// Where a canonical chrome class already exists (uiswitch, prop-toggle,
// prop-field, color-field, insp-crumbs, insp-section, modal-*, ctx-*), the
// factory EMITS THAT SAME CLASS so adoption is a true drop-in and no re-style is
// needed. Genuinely-new controls (Badge, Tabs, DocumentTab, TreeItem, palette
// tiles, Tooltip, Select, Checkbox, TextField, Button, IconButton, Panel) get a
// `vds-*` class + a chrome-only CSS block appended to editor.css.
//
// CHROME ONLY. Not loaded by render(doc,theme) / course.css / the SCORM export.
// Vanilla classic script — no ES modules, no bundler, opens from file://.
//
// window.VersoUI.<Name>(props) -> DOM Element (contract-conformant props).
// window.VersoUI._pure.*        -> DOM-free logic, guarded in tests/run.js.
(function () {
  "use strict";

  // Minimal element helper (mirrors editor.js `h`, kept local so the library is
  // self-contained and loads before editor.js).
  function h(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function iconSvg(name) {
    return (typeof window !== "undefined" && window.Icon) ? window.Icon(name) : "";
  }

  // ==========================================================================
  // PURE LOGIC (DOM-free) — extracted so tests/run.js can guard it headlessly.
  // ==========================================================================
  var _pure = {
    // SegmentedControl / Select / Tabs accept string | {value,label,icon,title}.
    normOptions: function (options) {
      return (options || []).map(function (o) {
        if (o && typeof o === "object") {
          return { value: String(o.value), label: o.label != null ? o.label : o.value, icon: o.icon || null, title: o.title || null };
        }
        return { value: String(o), label: String(o), icon: null, title: null };
      });
    },
    // Are ANY segments icon-bearing? -> the icon row modifier.
    segHasIcon: function (options) {
      return _pure.normOptions(options).some(function (o) { return !!o.icon; });
    },
    // ContextMenu entries: "-" | {divider} -> {sep:true}; else normalized item.
    normMenuItems: function (items) {
      return (items || []).map(function (it) {
        if (it === "-" || (it && it.divider) || (it && it.sep)) return { sep: true };
        if (it && it.head) return { head: String(it.head) };
        return {
          label: String(it.label),
          value: it.value != null ? String(it.value) : String(it.label),
          icon: it.icon || null,
          shortcut: it.shortcut || null,
          danger: !!it.danger,
          disabled: !!it.disabled,
          onClick: typeof it.onClick === "function" ? it.onClick : null
        };
      });
    },
    // Breadcrumb crumbs: string | {label,onClick}. Last item is current.
    normCrumbs: function (items) {
      return (items || []).map(function (c) {
        if (c && typeof c === "object") return { label: String(c.label), onClick: typeof c.onClick === "function" ? c.onClick : null };
        return { label: String(c), onClick: null };
      });
    },
    btnClass: function (variant, size, full) {
      var v = (variant === "primary" || variant === "secondary" || variant === "ghost" || variant === "danger") ? variant : "secondary";
      var s = size === "sm" ? "sm" : "md";
      return "vds-btn vds-btn--" + v + " vds-btn--" + s + (full ? " vds-btn--full" : "");
    },
    iconBtnClass: function (size, active, danger) {
      var s = (size === "sm" || size === "lg") ? size : "md";
      return "vds-iconbtn vds-iconbtn--" + s + (active ? " is-active" : "") + (danger ? " is-danger" : "");
    },
    badgeClass: function (tone, size) {
      var t = (tone === "accent" || tone === "success" || tone === "danger" || tone === "warning" || tone === "component") ? tone : "neutral";
      var s = size === "sm" ? "sm" : "md";
      return "vds-badge vds-badge--" + t + " vds-badge--" + s;
    },
    // Tri-state checkbox aria-checked value.
    checkAria: function (checked, mixed) { return mixed ? "mixed" : (checked ? "true" : "false"); },
    // TreeItem indent (px) by depth — 8px base + 12px per level.
    treeIndent: function (depth) { return 8 + Math.max(0, (depth | 0)) * 12; },
    // ToggleChip: an independently-toggleable pill (several can be active at once,
    // unlike SegmentedControl's one-of-N). `disabled` reads as a permanent baseline.
    toggleChipClass: function (active, disabled) {
      return "vds-chip" + (active ? " is-on" : "") + (disabled ? " is-disabled" : "");
    }
  };

  // ==========================================================================
  // FOUNDATION
  // ==========================================================================
  function Icon(props) {
    props = props || {};
    var span = h("span", "vds-icon");
    span.innerHTML = iconSvg(props.name);
    var svg = span.firstChild;
    if (svg && svg.setAttribute) {
      var size = props.size || 16;
      svg.setAttribute("width", size); svg.setAttribute("height", size);
      if (props.strokeWidth) svg.setAttribute("stroke-width", props.strokeWidth);
      if (props.color) svg.style.color = props.color;
    }
    return span;
  }

  // ==========================================================================
  // ACTIONS
  // ==========================================================================
  function Button(props) {
    props = props || {};
    var b = h("button", _pure.btnClass(props.variant, props.size, props.full));
    b.type = props.type || "button";
    if (props.icon) { var gi = h("span", "vds-btn__icon"); gi.innerHTML = iconSvg(props.icon); b.appendChild(gi); }
    var label = props.label != null ? props.label : (props.children != null ? props.children : "");
    if (label !== "") b.appendChild(h("span", "vds-btn__label", String(label)));
    if (props.iconRight) { var gr = h("span", "vds-btn__icon vds-btn__icon--right"); gr.innerHTML = iconSvg(props.iconRight); b.appendChild(gr); }
    if (props.disabled) b.disabled = true;
    if (props.title) b.title = props.title;
    if (typeof props.onClick === "function") b.addEventListener("click", props.onClick);
    return b;
  }
  function IconButton(props) {
    props = props || {};
    var b = h("button", _pure.iconBtnClass(props.size, props.active, props.danger));
    b.type = "button";
    b.innerHTML = iconSvg(props.icon);
    if (props.label) { b.title = props.label; b.setAttribute("aria-label", props.label); }
    if (props.active) b.setAttribute("aria-pressed", "true");
    if (props.disabled) b.disabled = true;
    if (typeof props.onClick === "function") b.addEventListener("click", props.onClick);
    return b;
  }

  // ==========================================================================
  // CONTROLS
  // ==========================================================================
  // IconField — reuses the existing `prop-field` chrome (the 55-site canonical
  // helper). Returns the wrap element; the input is `.querySelector` or `.input`.
  function IconField(props) {
    props = props || {};
    var wrap = h("div", "prop-field");
    if (props.title) wrap.title = props.title;
    if (props.icon || props.prefix) {
      var g = h("span", "prop-field__glyph");
      if (props.icon) g.innerHTML = iconSvg(props.icon); else g.textContent = props.prefix;
      wrap.appendChild(g);
    }
    var i = h("input", "prop-field__input"); i.type = "text"; i.spellcheck = false;
    i.placeholder = props.placeholder || "";
    i.value = props.value == null ? "" : props.value;
    if (props.disabled) i.disabled = true;
    i.addEventListener("change", function () { if (typeof props.onChange === "function") props.onChange(i.value); });
    wrap.appendChild(i);
    if (props.suffix) wrap.appendChild(h("span", "prop-field__unit", props.suffix));
    wrap.input = i;
    return wrap;
  }
  function TextField(props) {
    props = props || {};
    var wrap = h("div", "vds-textfield" + (props.leadingIcon ? " vds-textfield--icon" : ""));
    if (props.leadingIcon) { var g = h("span", "vds-textfield__icon"); g.innerHTML = iconSvg(props.leadingIcon); wrap.appendChild(g); }
    var el;
    if (props.multiline) {
      el = h("textarea", "vds-textfield__input"); el.rows = props.rows || 3;
    } else {
      el = h("input", "vds-textfield__input"); el.type = "text";
    }
    el.spellcheck = false;
    el.placeholder = props.placeholder || "";
    el.value = props.value == null ? "" : props.value;
    if (props.disabled) el.disabled = true;
    el.addEventListener("input", function () { if (typeof props.onChange === "function") props.onChange(el.value); });
    wrap.appendChild(el);
    wrap.input = el;
    return wrap;
  }
  function FieldRow(props) {
    props = props || {};
    var row = h("div", "insp-row" + (props.align === "top" ? " insp-row--top" : ""));
    var lbl = h("span", "insp-row__label");
    if (props.label && props.label.nodeType) lbl.appendChild(props.label); else lbl.textContent = props.label == null ? "" : props.label;
    if (props.labelWidth) lbl.style.width = props.labelWidth + "px";
    row.appendChild(lbl);
    appendChildren(row, props.children);
    return row;
  }
  function TwoUp(props) {
    props = props || {};
    var row = h("div", "prop-grid-row");
    var kids = toArray(props.children);
    var c1 = h("div", "prop-grid-cell"); if (kids[0]) c1.appendChild(kids[0]); row.appendChild(c1);
    var c2 = h("div", "prop-grid-cell"); if (kids[1]) c2.appendChild(kids[1]); row.appendChild(c2);
    if (props.gap != null) row.style.gap = props.gap + "px";
    return row;
  }
  // SegmentedControl — reuses `prop-toggle-row` / `prop-toggle` (segmentedLive).
  function SegmentedControl(props) {
    props = props || {};
    var opts = _pure.normOptions(props.options);
    var isIcon = _pure.segHasIcon(props.options);
    var row = h("div", "prop-toggle-row" + (isIcon ? " prop-toggle-row--icon" : "") + (props.size === "sm" ? " prop-toggle-row--sm" : ""));
    var btns = [];
    opts.forEach(function (o) {
      var b = h("button", "prop-toggle" + (o.icon ? " prop-toggle--icon" : "") + (o.value === String(props.value) ? " is-on" : ""));
      b.type = "button";
      if (o.icon) b.innerHTML = iconSvg(o.icon); else b.textContent = o.label;
      if (o.title) { b.title = o.title; b.setAttribute("aria-label", o.title); }
      b.addEventListener("click", function () {
        btns.forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        if (typeof props.onChange === "function") props.onChange(o.value);
      });
      btns.push(b); row.appendChild(b);
    });
    return row;
  }
  // Switch — EXACT drop-in for editor.js `switchEl` (same uiswitch DOM). Self-
  // updates its is-on/aria state; callers that re-render simply discard it.
  function Switch(props) {
    props = props || {};
    var on = !!props.checked;
    var b = h("button", "uiswitch" + (on ? " is-on" : ""));
    b.type = "button"; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", on ? "true" : "false");
    if (props.disabled) b.disabled = true;
    b.appendChild(h("span", "uiswitch__knob"));
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      if (b.disabled) return;
      var next = !b.classList.contains("is-on");
      b.classList.toggle("is-on", next);
      b.setAttribute("aria-checked", next ? "true" : "false");
      if (typeof props.onChange === "function") props.onChange(next);
    });
    return b;
  }
  function SwitchRow(props) {
    props = props || {};
    var row = h("div", "switch-row");
    var left = h("div", "switch-row__labels");
    left.appendChild(h("span", "switch-row__label", props.label == null ? "" : props.label));
    if (props.description != null) left.appendChild(h("span", "switch-row__desc", String(props.description)));
    row.appendChild(left);
    row.appendChild(Switch({ checked: props.checked, disabled: props.disabled, onChange: props.onChange }));
    return row;
  }
  function Select(props) {
    props = props || {};
    var sel = h("select", "vds-select");
    if (props.disabled) sel.disabled = true;
    if (props.placeholder) {
      var ph = h("option", null, props.placeholder); ph.value = ""; ph.disabled = true; if (props.value == null || props.value === "") ph.selected = true; sel.appendChild(ph);
    }
    _pure.normOptions(props.options).forEach(function (o) {
      var op = h("option", null, o.label); op.value = o.value; if (o.value === String(props.value)) op.selected = true; sel.appendChild(op);
    });
    sel.addEventListener("change", function () { if (typeof props.onChange === "function") props.onChange(sel.value); });
    return sel;
  }
  function Checkbox(props) {
    props = props || {};
    var wrap = h("label", "vds-check" + (props.disabled ? " is-disabled" : ""));
    var box = h("span", "vds-check__box" + (props.mixed ? " is-mixed" : (props.checked ? " is-on" : "")));
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", _pure.checkAria(props.checked, props.mixed));
    box.innerHTML = props.mixed ? iconSvg("minus") : (props.checked ? iconSvg("plus") : "");
    wrap.appendChild(box);
    if (props.label != null) wrap.appendChild(h("span", "vds-check__label", String(props.label)));
    wrap.addEventListener("click", function (e) {
      e.preventDefault();
      if (props.disabled) return;
      var next = !box.classList.contains("is-on");
      box.classList.toggle("is-on", next); box.classList.remove("is-mixed");
      box.setAttribute("aria-checked", next ? "true" : "false");
      box.innerHTML = next ? iconSvg("plus") : "";
      if (typeof props.onChange === "function") props.onChange(next);
    });
    return wrap;
  }
  // ColorField — the canonical swatch·hex·opacity·eyedropper control. The
  // editor's richer token/per-mode popover (openColorFieldPop) adopts this shell
  // surface-by-surface; here it is the standalone contract form. Reuses the
  // `color-field` swatch/value classes.
  function ColorField(props) {
    props = props || {};
    var wrap = h("div", "color-field vds-color");
    var sw = h("button", "color-field__swatch"); sw.type = "button"; sw.title = "Colour";
    if (props.value) sw.style.background = props.value; else sw.classList.add("color-field__swatch--empty");
    wrap.appendChild(sw);
    var hex = h("input", "vds-color__hex"); hex.type = "text"; hex.spellcheck = false;
    hex.value = props.value || ""; hex.placeholder = props.tokenName || "hex";
    if (props.tokenName) { hex.value = props.tokenName; hex.readOnly = true; }
    hex.addEventListener("change", function () { if (typeof props.onChange === "function") props.onChange(hex.value.trim()); });
    wrap.appendChild(hex);
    if (props.opacity != null) {
      var op = h("input", "vds-color__opacity"); op.type = "text"; op.value = props.opacity + "%"; op.title = "Opacity";
      op.addEventListener("change", function () { if (typeof props.onOpacityChange === "function") props.onOpacityChange(parseInt(op.value, 10) || 0); });
      wrap.appendChild(op);
    }
    var eye = h("button", "vds-color__eyedrop"); eye.type = "button"; eye.title = "Pick from screen"; eye.innerHTML = iconSvg("pipette");
    if (typeof props.onEyedrop === "function") eye.addEventListener("click", props.onEyedrop);
    wrap.appendChild(eye);
    if (props.disabled) { hex.disabled = true; sw.disabled = true; eye.disabled = true; }
    return wrap;
  }

  // ==========================================================================
  // PANELS
  // ==========================================================================
  function Panel(props) {
    props = props || {};
    var side = props.side === "left" ? "left" : "right";
    var panel = h("div", "vds-panel vds-panel--" + side);
    if (props.width) panel.style.width = props.width;
    if (props.header != null) { var hd = h("div", "vds-panel__header"); appendChildren(hd, props.header); panel.appendChild(hd); }
    var body = h("div", "vds-panel__body"); appendChildren(body, props.children); panel.appendChild(body);
    if (props.footer != null) { var ft = h("div", "vds-panel__footer"); appendChildren(ft, props.footer); panel.appendChild(ft); }
    return panel;
  }
  // PanelSection — reuses the `insp-section` taxonomy chrome (sectionGroup).
  function PanelSection(props) {
    props = props || {};
    var collapsible = props.collapsible !== false;
    var open = props.defaultOpen !== false;
    var sec = h("div", "insp-section" + (open ? "" : " is-collapsed") + (props.divider === false ? " insp-section--no-divider" : ""));
    var head = h("div", "insp-section__head");
    var twirl = h("span", "insp-section__twirl" + (open ? " is-open" : ""));
    head.appendChild(twirl);
    if (props.title != null) head.appendChild(h("span", "insp-section__title", props.title));
    if (props.actions != null) { var act = h("span", "insp-section__actions"); appendChildren(act, props.actions); head.appendChild(act); }
    var body = h("div", "insp-section__body"); appendChildren(body, props.children);
    if (collapsible) {
      head.addEventListener("click", function () {
        var nowCollapsed = !sec.classList.contains("is-collapsed");
        sec.classList.toggle("is-collapsed", nowCollapsed);
        twirl.classList.toggle("is-open", !nowCollapsed);
      });
    }
    sec.appendChild(head); sec.appendChild(body);
    return sec;
  }
  // Breadcrumb — reuses `insp-crumbs` (the existing inspector context line).
  function Breadcrumb(props) {
    props = props || {};
    var crumbs = _pure.normCrumbs(props.items);
    var bar = h("div", "insp-crumbs");
    crumbs.forEach(function (c, i) {
      if (i > 0) { var sep = h("span", "insp-crumbs__sep"); sep.innerHTML = iconSvg("chevron-right"); bar.appendChild(sep); }
      if (i === crumbs.length - 1) {
        bar.appendChild(h("span", "insp-crumbs__cur", c.label));
      } else {
        var b = h("button", "insp-crumbs__crumb"); b.type = "button"; b.textContent = c.label;
        if (c.onClick) b.addEventListener("click", c.onClick);
        bar.appendChild(b);
      }
    });
    return bar;
  }

  // ==========================================================================
  // NAVIGATION
  // ==========================================================================
  function Tabs(props) {
    props = props || {};
    var strip = h("div", "vds-tabs");
    _pure.normOptions(props.tabs).forEach(function (t) {
      var b = h("button", "vds-tab" + (t.value === String(props.value) ? " is-on" : "")); b.type = "button"; b.textContent = t.label;
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(strip.children, function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        if (typeof props.onChange === "function") props.onChange(t.value);
      });
      strip.appendChild(b);
    });
    return strip;
  }
  function DocumentTab(props) {
    props = props || {};
    var tab = h("div", "vds-doctab" + (props.active ? " is-active" : ""));
    var name = h("button", "vds-doctab__label", props.label); name.type = "button";
    if (typeof props.onSelect === "function") name.addEventListener("click", props.onSelect);
    tab.appendChild(name);
    var close = h("button", "vds-doctab__close"); close.type = "button"; close.title = "Close"; close.setAttribute("aria-label", "Close"); close.innerHTML = iconSvg("x");
    if (typeof props.onClose === "function") close.addEventListener("click", function (e) { e.stopPropagation(); props.onClose(); });
    tab.appendChild(close);
    return tab;
  }

  // ==========================================================================
  // STRUCTURE
  // ==========================================================================
  function TreeItem(props) {
    props = props || {};
    var row = h("div", "vds-tree-item" + (props.selected ? " is-selected" : "") + (props.muted ? " is-muted" : ""));
    row.style.paddingLeft = _pure.treeIndent(props.depth) + "px";
    if (props.expandable) {
      var tw = h("button", "vds-tree-item__twirl" + (props.expanded ? " is-open" : "")); tw.type = "button";
      tw.innerHTML = iconSvg("chevron-right");
      tw.addEventListener("click", function (e) { e.stopPropagation(); if (typeof props.onToggle === "function") props.onToggle(); });
      row.appendChild(tw);
    } else {
      row.appendChild(h("span", "vds-tree-item__twirl vds-tree-item__twirl--ghost"));
    }
    if (props.icon) { var ic = h("span", "vds-tree-item__icon"); ic.innerHTML = iconSvg(props.icon); row.appendChild(ic); }
    var lbl = h("span", "vds-tree-item__label");
    if (props.label && props.label.nodeType) lbl.appendChild(props.label); else lbl.textContent = props.label == null ? "" : props.label;
    row.appendChild(lbl);
    if (props.trailing != null) { var tr = h("span", "vds-tree-item__trailing"); appendChildren(tr, props.trailing); row.appendChild(tr); }
    if (typeof props.onSelect === "function") row.addEventListener("click", props.onSelect);
    return row;
  }
  function BlockPaletteItem(props) {
    props = props || {};
    var row = h("div", "vds-palette-item");
    if (props.draggable) row.setAttribute("draggable", "true");
    var chip = h("span", "vds-palette-item__chip"); chip.innerHTML = iconSvg(props.icon); row.appendChild(chip);
    row.appendChild(h("span", "vds-palette-item__label", props.label));
    if (typeof props.onClick === "function") row.addEventListener("click", props.onClick);
    return row;
  }
  function BlockTile(props) {
    props = props || {};
    var tile = h("div", "vds-tile" + (props.selected ? " is-selected" : ""));
    if (props.draggable) tile.setAttribute("draggable", "true");
    if (props.label != null) tile.title = String(props.label); // full label on hover (grid labels single-line + ellipsis)
    var ic = h("span", "vds-tile__icon"); ic.innerHTML = iconSvg(props.icon); tile.appendChild(ic);
    tile.appendChild(h("span", "vds-tile__label", props.label));
    if (typeof props.onClick === "function") tile.addEventListener("click", props.onClick);
    return tile;
  }
  // Width-adaptive by default: pass `minColWidth` and the COLUMN COUNT flexes with
  // the (resizable) dock while each tile keeps a stable target size. `columns` is the
  // fixed-count fallback for a fixed-width dock; `minColWidth` wins when both given.
  function BlockGrid(props) {
    props = props || {};
    var grid = h("div", "vds-grid");
    grid.style.gridTemplateColumns = props.minColWidth
      ? "repeat(auto-fill, minmax(" + props.minColWidth + "px, 1fr))"
      : "repeat(" + (props.columns || 3) + ", 1fr)";
    appendChildren(grid, props.children);
    return grid;
  }
  function Badge(props) {
    props = props || {};
    var b = h("span", _pure.badgeClass(props.tone, props.size));
    appendChildren(b, props.children);
    return b;
  }
  // ToggleChip — a row of these is a MULTI-select toggle (several active at once);
  // for a single-select "pick exactly one" row, use SegmentedControl instead.
  function ToggleChip(props) {
    props = props || {};
    var b = h("button", _pure.toggleChipClass(props.active, props.disabled), props.label != null ? String(props.label) : "");
    b.type = "button";
    if (props.disabled) b.disabled = true;
    if (props.title) b.title = props.title;
    b.addEventListener("click", function () { if (!props.disabled && typeof props.onClick === "function") props.onClick(); });
    return b;
  }

  // ==========================================================================
  // OVERLAYS
  // ==========================================================================
  // Modal — reuses `modal-overlay` / `modal-box` (promptModal/confirmModal).
  function Modal(props) {
    props = props || {};
    var overlay = h("div", "modal-overlay");
    var box = h("div", "modal-box vds-modal");
    if (props.width) box.style.width = props.width + "px";
    var head = h("div", "modal-head");
    head.appendChild(h("span", "modal-title", props.title == null ? "" : props.title));
    var close = h("button", "vds-modal__close"); close.type = "button"; close.title = "Close"; close.setAttribute("aria-label", "Close"); close.innerHTML = iconSvg("x");
    head.appendChild(close);
    box.appendChild(head);
    if (props.description != null) box.appendChild(h("p", "modal-sub", String(props.description)));
    if (props.children != null) { var body = h("div", "vds-modal__body"); appendChildren(body, props.children); box.appendChild(body); }
    if (props.footer != null) { var ft = h("div", "vds-modal__footer"); appendChildren(ft, props.footer); box.appendChild(ft); }
    overlay.appendChild(box);
    function doClose() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); if (typeof props.onClose === "function") props.onClose(); }
    close.addEventListener("click", doClose);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) doClose(); });
    overlay.close = doClose;
    return overlay;
  }
  // ContextMenu — reuses the `ctx-menu`/`ctx-item` chrome (showContextMenu).
  // Returns the menu element; positioning/opening stays the caller's concern.
  function ContextMenu(props) {
    props = props || {};
    var m = h("div", "ctx-menu");
    _pure.normMenuItems(props.items).forEach(function (it) {
      if (it.sep) { m.appendChild(h("div", "ctx-sep")); return; }
      if (it.head) { m.appendChild(h("div", "ctx-head", it.head)); return; }
      var el = h("div", "ctx-item" + (it.danger ? " ctx-item--danger" : "") + (it.disabled ? " is-disabled" : ""));
      if (it.icon) { var g = h("span", "ctx-item__icon"); g.innerHTML = iconSvg(it.icon); el.appendChild(g); }
      el.appendChild(h("span", "ctx-item__label", it.label));
      if (it.shortcut) el.appendChild(h("span", "ctx-item__shortcut", it.shortcut));
      if (!it.disabled) el.addEventListener("click", function () {
        if (it.onClick) it.onClick();
        if (typeof props.onSelect === "function") props.onSelect(it.value);
      });
      m.appendChild(el);
    });
    return m;
  }
  function Tooltip(props) {
    props = props || {};
    var wrap = h("span", "vds-tip-wrap");
    appendChildren(wrap, props.children);
    var tip = h("span", "vds-tip vds-tip--" + (props.placement || "top"), props.label == null ? "" : props.label);
    tip.setAttribute("role", "tooltip");
    wrap.appendChild(tip);
    return wrap;
  }

  // ---- small shared DOM utils ----------------------------------------------
  function toArray(children) {
    if (children == null) return [];
    if (Array.isArray(children)) return children;
    return [children];
  }
  function appendChildren(host, children) {
    toArray(children).forEach(function (c) {
      if (c == null) return;
      if (c.nodeType) host.appendChild(c);
      else host.appendChild(document.createTextNode(String(c)));
    });
  }

  var VersoUI = {
    Icon: Icon,
    Button: Button, IconButton: IconButton,
    IconField: IconField, TextField: TextField, FieldRow: FieldRow, TwoUp: TwoUp,
    SegmentedControl: SegmentedControl, Switch: Switch, SwitchRow: SwitchRow,
    Select: Select, Checkbox: Checkbox, ColorField: ColorField,
    Panel: Panel, PanelSection: PanelSection, Breadcrumb: Breadcrumb,
    Tabs: Tabs, DocumentTab: DocumentTab,
    TreeItem: TreeItem, BlockPaletteItem: BlockPaletteItem, BlockTile: BlockTile, BlockGrid: BlockGrid, Badge: Badge, ToggleChip: ToggleChip,
    Modal: Modal, ContextMenu: ContextMenu, Tooltip: Tooltip,
    _pure: _pure
  };

  if (typeof window !== "undefined") window.VersoUI = VersoUI;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoUI;
})();
