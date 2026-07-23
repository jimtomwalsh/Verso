/* @ds-bundle: {"format":4,"namespace":"VersoDesignSystem_2a48ac","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"IconButton","sourcePath":"components/actions/IconButton.jsx"},{"name":"Checkbox","sourcePath":"components/controls/Checkbox.jsx"},{"name":"ColorField","sourcePath":"components/controls/ColorField.jsx"},{"name":"FieldRow","sourcePath":"components/controls/FieldRow.jsx"},{"name":"TwoUp","sourcePath":"components/controls/FieldRow.jsx"},{"name":"IconField","sourcePath":"components/controls/IconField.jsx"},{"name":"SegmentedControl","sourcePath":"components/controls/SegmentedControl.jsx"},{"name":"Select","sourcePath":"components/controls/Select.jsx"},{"name":"Switch","sourcePath":"components/controls/Switch.jsx"},{"name":"SwitchRow","sourcePath":"components/controls/Switch.jsx"},{"name":"TextField","sourcePath":"components/controls/TextField.jsx"},{"name":"Icon","sourcePath":"components/foundation/Icon.jsx"},{"name":"DocumentTab","sourcePath":"components/navigation/DocumentTab.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"ContextMenu","sourcePath":"components/overlays/ContextMenu.jsx"},{"name":"Modal","sourcePath":"components/overlays/Modal.jsx"},{"name":"Tooltip","sourcePath":"components/overlays/Tooltip.jsx"},{"name":"Breadcrumb","sourcePath":"components/panels/Breadcrumb.jsx"},{"name":"Panel","sourcePath":"components/panels/Panel.jsx"},{"name":"PanelSection","sourcePath":"components/panels/PanelSection.jsx"},{"name":"Badge","sourcePath":"components/structure/Badge.jsx"},{"name":"BlockPaletteItem","sourcePath":"components/structure/BlockPaletteItem.jsx"},{"name":"BlockTile","sourcePath":"components/structure/BlockTile.jsx"},{"name":"BlockGrid","sourcePath":"components/structure/BlockTile.jsx"},{"name":"TreeItem","sourcePath":"components/structure/TreeItem.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"cde32d36ea55","components/actions/IconButton.jsx":"7f4c51ec704d","components/controls/Checkbox.jsx":"5c2fff154156","components/controls/ColorField.jsx":"722d67f7f333","components/controls/FieldRow.jsx":"47f0a262d880","components/controls/IconField.jsx":"59d992bfb550","components/controls/SegmentedControl.jsx":"ad00c3bfad95","components/controls/Select.jsx":"aaab5ec20eb4","components/controls/Switch.jsx":"f2ee6bd398eb","components/controls/TextField.jsx":"9482917d20d1","components/foundation/Icon.jsx":"81679693e213","components/navigation/DocumentTab.jsx":"2be321bcea3c","components/navigation/Tabs.jsx":"4518f0ac6d1f","components/overlays/ContextMenu.jsx":"5f2f2c2d9199","components/overlays/Modal.jsx":"9eaf2a79e187","components/overlays/Tooltip.jsx":"3e09e2fb6f29","components/panels/Breadcrumb.jsx":"f092cecfd41b","components/panels/Panel.jsx":"028bc96ee4f6","components/panels/PanelSection.jsx":"0f2fef7bb1f4","components/structure/Badge.jsx":"754e4b9fbce9","components/structure/BlockPaletteItem.jsx":"d82e540fe177","components/structure/BlockTile.jsx":"7bd58ed02d38","components/structure/TreeItem.jsx":"377d4a9bcb8c","ui_kits/editor/CanvasView.jsx":"82a7c40d455e","ui_kits/editor/Inspector.jsx":"b73aee6e27b2","ui_kits/editor/LeftPanel.jsx":"c67b61926180","ui_kits/editor/TopBar.jsx":"ecd626a7a47d","ui_kits/editor/data.js":"213ab1840a07"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.VersoDesignSystem_2a48ac = window.VersoDesignSystem_2a48ac || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/controls/FieldRow.jsx
try { (() => {
/**
 * FieldRow — a labelled inspector row: a fixed-width label on the left, the
 * control(s) on the right. The single most repeated layout in the panels
 * (~20 direct sites; the structural basis for most others).
 */
function FieldRow({
  label,
  children,
  align = "center",
  labelWidth = 64,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: `${labelWidth}px 1fr`,
      alignItems: align === "top" ? "start" : "center",
      gap: "8px",
      minHeight: "var(--row-height)",
      padding: "2px 0",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-secondary)",
      paddingTop: align === "top" ? "5px" : 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, children));
}

/**
 * TwoUp — two equal controls side by side inside a row's control slot
 * (X/Y, W/H, gap/columns). Mirrors the editor's `twoUp` helper.
 */
function TwoUp({
  children,
  gap = 6,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: `${gap}px`,
      minWidth: 0,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { FieldRow, TwoUp });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/FieldRow.jsx", error: String((e && e.message) || e) }); }

// components/controls/Switch.jsx
try { (() => {
/**
 * Switch — a compact on/off toggle (compact, ~28x16). Used for every
 * boolean setting.
 */
function Switch({
  checked = false,
  disabled = false,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      position: "relative",
      width: "28px",
      height: "16px",
      flex: "none",
      border: "none",
      borderRadius: "var(--radius-full)",
      padding: 0,
      cursor: disabled ? "default" : "pointer",
      background: checked ? "var(--accent)" : "var(--gray-700)",
      opacity: disabled ? 0.4 : 1,
      transition: "background var(--dur-fast) var(--ease-standard)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: "2px",
      left: checked ? "14px" : "2px",
      width: "12px",
      height: "12px",
      borderRadius: "var(--radius-full)",
      background: "var(--white)",
      transition: "left var(--dur-fast) var(--ease-standard)"
    }
  }));
}

/**
 * SwitchRow — the `switchRow` control (27 sites): a full-width row with a
 * label and a trailing Switch. The default way to expose a boolean setting.
 */
function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: description ? "flex-start" : "center",
      justifyContent: "space-between",
      gap: "12px",
      minHeight: "var(--row-height)",
      padding: "2px 0",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-primary)"
    }
  }, label), description && /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-tertiary)",
      marginTop: "2px"
    }
  }, description)), /*#__PURE__*/React.createElement(Switch, {
    checked: checked,
    disabled: disabled,
    onChange: onChange
  }));
}
Object.assign(__ds_scope, { Switch, SwitchRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Switch.jsx", error: String((e && e.message) || e) }); }

// components/controls/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * TextField — free text entry. The counterpart to IconField (which is for
 * short/numeric values): TextField is for prose — alt text, captions, a
 * disclaimer, a link URL, a chapter name. Set `multiline` for a growing
 * textarea. Full-width by default so it sits under its label.
 */
function TextField({
  value,
  placeholder,
  multiline = false,
  rows = 3,
  disabled = false,
  leadingIcon,
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const shell = {
    display: "flex",
    alignItems: multiline ? "flex-start" : "center",
    gap: "6px",
    width: "100%",
    minHeight: "var(--control-md)",
    padding: multiline ? "6px 8px" : "0 8px",
    background: "var(--surface-input)",
    borderRadius: "var(--radius-xs)",
    border: "1px solid",
    borderColor: focus ? "var(--border-focus)" : hover && !disabled ? "var(--border-input)" : "transparent",
    boxShadow: focus ? "inset 0 0 0 1px var(--border-focus)" : "none",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color var(--dur-fast) var(--ease-standard)",
    ...style
  };
  const inputBase = {
    flex: 1,
    minWidth: 0,
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    font: "var(--type-value)",
    padding: 0,
    resize: "none",
    fontFamily: "var(--font-ui)"
  };
  return /*#__PURE__*/React.createElement("label", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: shell
  }, leadingIcon && /*#__PURE__*/React.createElement(LeadingGlyph, {
    name: leadingIcon,
    multiline: multiline
  }), multiline ? /*#__PURE__*/React.createElement("textarea", _extends({
    value: value ?? "",
    placeholder: placeholder,
    disabled: disabled,
    rows: rows,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onChange: e => onChange && onChange(e.target.value),
    style: {
      ...inputBase,
      lineHeight: "var(--leading-normal)"
    }
  }, rest)) : /*#__PURE__*/React.createElement("input", _extends({
    type: "text",
    value: value ?? "",
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onChange: e => onChange && onChange(e.target.value),
    style: inputBase
  }, rest)));
}
function LeadingGlyph({
  name,
  multiline
}) {
  // Lazy require to avoid a hard import cycle in the bundle.
  const Icon = typeof window !== "undefined" && window.VersoDesignSystem_2a48ac && window.VersoDesignSystem_2a48ac.Icon || null;
  if (!Icon) return null;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      color: "var(--icon-idle)",
      paddingTop: multiline ? "2px" : 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: name,
    size: 14
  }));
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/TextField.jsx", error: String((e && e.message) || e) }); }

// components/foundation/Icon.jsx
try { (() => {
/**
 * Icon — renders a Lucide glyph by name.
 *
 * Verso's real editor ships its own 16px line-icon set (the "WDS Icon
 * Library"), which was not included in the provided sources. Lucide is used
 * here as the closest match: same 2px-stroke, 24-grid, rounded-cap style.
 * Swap this mapping for the real sprite when integrating.
 *
 * Requires the Lucide UMD build on `window.lucide` (load from CDN). If it is
 * not present, a neutral placeholder box is drawn so layout never breaks.
 */
function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  color,
  style,
  ...rest
}) {
  const lucide = typeof window !== "undefined" ? window.lucide : null;
  const node = lucide && lucide.icons ? lucide.icons[toPascal(name)] || lucide.icons[name] : null;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      display: "block",
      flex: "none",
      ...style
    },
    "aria-hidden": true,
    ...rest
  };
  if (!node) {
    // Fallback: soft rounded square so nothing collapses.
    return React.createElement("svg", common, React.createElement("rect", {
      x: 4,
      y: 4,
      width: 16,
      height: 16,
      rx: 3,
      opacity: 0.35
    }));
  }

  // A Lucide iconNode is ["svg", attrs, [ [tag, attrs], ... ]]; children live
  // in node[2]. Older/other builds expose a flat array of child tuples — support both.
  const kids = Array.isArray(node[2]) ? node[2] : Array.isArray(node) && Array.isArray(node[0]) ? node : [];
  const children = kids.map((child, i) => {
    const [tag, attrs] = child;
    return React.createElement(tag, {
      key: i,
      ...attrs
    });
  });
  return React.createElement("svg", common, children);
}
function toPascal(name) {
  if (!name) return "";
  return String(name).split(/[-_ ]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/foundation/Icon.jsx", error: String((e && e.message) || e) }); }

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — text action. Primary is the top-bar "Export"; secondary/ghost are
 * the quiet workhorses inside panels and dialogs.
 */
function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  full = false,
  onClick,
  style,
  ...rest
}) {
  const heights = {
    sm: "var(--control-md)",
    md: "var(--control-lg)"
  };
  const pads = {
    sm: "0 8px",
    md: "0 12px"
  };
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: heights[size],
    padding: pads[size],
    font: "var(--type-label-strong)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid transparent",
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
    width: full ? "100%" : "auto",
    opacity: disabled ? 0.4 : 1,
    transition: "background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)"
  };
  const variants = {
    primary: {
      background: "var(--accent)",
      color: "var(--text-on-accent)"
    },
    secondary: {
      background: "var(--surface-input)",
      color: "var(--text-primary)",
      borderColor: "var(--border-input)"
    },
    ghost: {
      background: "transparent",
      color: "var(--text-primary)"
    },
    danger: {
      background: "var(--danger)",
      color: "var(--white)"
    }
  };
  const hover = {
    primary: "var(--accent-hover)",
    secondary: "var(--surface-hover)",
    ghost: "var(--surface-hover)",
    danger: "var(--danger-hover)"
  };
  const [h, setH] = React.useState(false);
  const vstyle = variants[variant];
  const bg = !disabled && h ? variant === "secondary" || variant === "ghost" ? undefined : hover[variant] : vstyle.background;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      ...base,
      ...vstyle,
      background: bg || vstyle.background,
      ...(h && !disabled && (variant === "secondary" || variant === "ghost") ? {
        background: "var(--surface-hover)"
      } : null),
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  }), children && /*#__PURE__*/React.createElement("span", null, children), iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: 14
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * IconButton — square, icon-only action. The toolbar and the per-block
 * "Actions" row (move up/down, duplicate, delete) are built from these.
 * `active` = toggled-on state (e.g. comment mode engaged).
 */
function IconButton({
  icon,
  size = "md",
  active = false,
  disabled = false,
  danger = false,
  label,
  onClick,
  style,
  ...rest
}) {
  const dims = {
    sm: "var(--control-sm)",
    md: "var(--control-md)",
    lg: "var(--control-lg)"
  };
  const iconSizes = {
    sm: 12,
    md: 16,
    lg: 18
  };
  const [h, setH] = React.useState(false);
  const bg = active ? "var(--surface-active)" : h && !disabled ? "var(--surface-hover)" : "transparent";
  const color = danger ? "var(--danger)" : active ? "var(--icon-strong)" : h && !disabled ? "var(--icon-strong)" : "var(--icon-idle)";
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    "aria-label": label,
    title: label,
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dims[size],
      height: dims[size],
      padding: 0,
      border: "none",
      borderRadius: "var(--radius-xs)",
      background: bg,
      color,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
      transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: iconSizes[size]
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/controls/Checkbox.jsx
try { (() => {
/**
 * Checkbox — a small square check. Used for quiz answer keys, acknowledge
 * gates, and multi-select lists. `mixed` renders the indeterminate dash.
 */
function Checkbox({
  checked = false,
  mixed = false,
  disabled = false,
  label,
  onChange,
  style
}) {
  const on = checked || mixed;
  const box = /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      width: "14px",
      height: "14px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-xs)",
      background: on ? "var(--accent)" : "transparent",
      boxShadow: on ? "none" : "inset 0 0 0 1px var(--border-input)",
      color: "var(--white)",
      transition: "background var(--dur-fast) var(--ease-standard)"
    }
  }, mixed ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "minus",
    size: 11
  }) : checked ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 11
  }) : null);
  if (!label) {
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      role: "checkbox",
      "aria-checked": mixed ? "mixed" : checked,
      disabled: disabled,
      onClick: () => !disabled && onChange && onChange(!checked),
      style: {
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        ...style
      }
    }, box);
  }
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
      font: "var(--type-label)",
      color: "var(--text-primary)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.checked),
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }), box, /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/controls/ColorField.jsx
try { (() => {
/**
 * ColorField — the unified `colorField` (D5). One control replaces the four
 * legacy colour paths (colourControl / colorToken / per-mode / palette-map).
 * Layout: swatch · hex · opacity% · eyedropper. A colour may be a raw hex
 * ("custom") or a theme token ("token") shown by its token name; per-mode
 * fills are handled by rendering two ColorFields (one per light/dark).
 */
function ColorField({
  value = "#000000",
  opacity = 100,
  tokenName,
  onChange,
  onOpacityChange,
  onEyedrop,
  disabled = false,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const hex = String(value).replace(/^#/, "").toUpperCase();
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      height: "var(--control-md)",
      background: "var(--surface-input)",
      borderRadius: "var(--radius-xs)",
      border: "1px solid",
      borderColor: hover && !disabled ? "var(--border-input)" : "transparent",
      opacity: disabled ? 0.5 : 1,
      overflow: "hidden",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      width: "16px",
      height: "16px",
      margin: "0 6px",
      borderRadius: "3px",
      boxShadow: "inset 0 0 0 1px var(--border-strong)",
      backgroundColor: value,
      backgroundImage: "linear-gradient(45deg,#7a7a7a 25%,transparent 25%),linear-gradient(-45deg,#7a7a7a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#7a7a7a 75%),linear-gradient(-45deg,transparent 75%,#7a7a7a 75%)",
      backgroundSize: "6px 6px",
      backgroundPosition: "0 0,0 3px,3px -3px,-3px 0",
      cursor: disabled ? "default" : "pointer"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      font: "var(--type-value)",
      color: "var(--text-primary)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, tokenName || hex), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      font: "var(--type-value)",
      color: "var(--text-secondary)",
      padding: "0 6px",
      borderLeft: "1px solid var(--border-subtle)"
    }
  }, opacity, "%"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onEyedrop,
    disabled: disabled,
    title: "Pick colour",
    style: {
      flex: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "22px",
      height: "100%",
      border: "none",
      background: "transparent",
      color: "var(--icon-idle)",
      cursor: disabled ? "default" : "pointer",
      borderLeft: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "pipette",
    size: 13
  })));
}
Object.assign(__ds_scope, { ColorField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/ColorField.jsx", error: String((e && e.message) || e) }); }

// components/controls/IconField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * IconField — the workhorse input (55 sites in the real editor). A leading
 * glyph (or short text label) sits inside a 24px field with an editable value.
 * Used for X/Y/W/H, padding, radius, opacity, size — anything numeric or short.
 */
function IconField({
  icon,
  prefix,
  value,
  suffix,
  placeholder,
  disabled = false,
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      height: "var(--control-md)",
      padding: "0 6px",
      background: "var(--surface-input)",
      borderRadius: "var(--radius-xs)",
      border: "1px solid",
      borderColor: focus ? "var(--border-focus)" : hover && !disabled ? "var(--border-input)" : "transparent",
      boxShadow: focus ? "inset 0 0 0 1px var(--border-focus)" : "none",
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? "default" : "text",
      transition: "border-color var(--dur-fast) var(--ease-standard)",
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14,
    style: {
      color: "var(--icon-idle)"
    }
  }), prefix && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-tertiary)",
      flex: "none"
    }
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    type: "text",
    value: value ?? "",
    placeholder: placeholder,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--text-primary)",
      font: "var(--type-value)",
      padding: 0
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-tertiary)",
      flex: "none"
    }
  }, suffix));
}
Object.assign(__ds_scope, { IconField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/IconField.jsx", error: String((e && e.message) || e) }); }

// components/controls/SegmentedControl.jsx
try { (() => {
/**
 * SegmentedControl — the `segmentedLive` / `segmentedIconLive` control (~20
 * sites). A single-select track of segments. Supports text labels, icons, or
 * both. Used for alignment, fit modes, variant switches, reveal styles.
 */
function SegmentedControl({
  options,
  value,
  onChange,
  size = "md",
  style
}) {
  const height = size === "sm" ? "var(--control-sm)" : "var(--control-md)";
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: "grid",
      gridAutoFlow: "column",
      gridAutoColumns: "1fr",
      gap: "2px",
      height,
      padding: "2px",
      background: "var(--surface-input)",
      borderRadius: "var(--radius-xs)",
      ...style
    }
  }, options.map(opt => {
    const val = typeof opt === "string" ? opt : opt.value;
    const selected = val === value;
    return /*#__PURE__*/React.createElement(Segment, {
      key: val,
      opt: opt,
      selected: selected,
      onClick: () => onChange && onChange(val)
    });
  }));
}
function Segment({
  opt,
  selected,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const label = typeof opt === "string" ? opt : opt.label;
  const icon = typeof opt === "string" ? null : opt.icon;
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "tab",
    "aria-selected": selected,
    title: typeof opt === "object" ? opt.title || label : label,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "5px",
      border: "none",
      borderRadius: "calc(var(--radius-xs) - 1px)",
      cursor: "pointer",
      padding: "0 8px",
      minWidth: 0,
      font: "var(--type-label-strong)",
      background: selected ? "var(--surface-active)" : hover ? "var(--surface-hover)" : "transparent",
      color: selected ? "var(--text-primary)" : "var(--icon-idle)",
      boxShadow: selected ? "0 1px 2px rgba(0,0,0,0.3)" : "none",
      transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)"
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  }), label && /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, label));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/controls/Select.jsx
try { (() => {
/**
 * Select — a native-backed dropdown styled to the Verso chrome. Kept native
 * for long/dynamic option lists (fonts, categories); bounded choices should
 * use SegmentedControl instead.
 */
function Select({
  options,
  value,
  onChange,
  disabled = false,
  placeholder,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const norm = options.map(o => typeof o === "string" ? {
    value: o,
    label: o
  } : o);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      height: "var(--control-md)",
      padding: "0 6px",
      background: "var(--surface-input)",
      borderRadius: "var(--radius-xs)",
      border: "1px solid",
      borderColor: hover && !disabled ? "var(--border-input)" : "transparent",
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.value),
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: value ? "var(--text-primary)" : "var(--text-tertiary)",
      font: "var(--type-value)",
      cursor: disabled ? "default" : "pointer",
      padding: 0,
      paddingRight: "16px"
    }
  }, placeholder && /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder), norm.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 14,
    style: {
      position: "absolute",
      right: "6px",
      color: "var(--icon-idle)",
      pointerEvents: "none"
    }
  }));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Select.jsx", error: String((e && e.message) || e) }); }

// components/navigation/DocumentTab.jsx
try { (() => {
/**
 * DocumentTab — a top-bar course tab. The active tab reads as connected to
 * the workspace; inactive tabs are quiet. A close "×" appears on hover/active.
 */
function DocumentTab({
  label,
  active = false,
  onSelect,
  onClose,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const showClose = active || hover;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onSelect,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      height: "var(--tabbar-height)",
      maxWidth: "180px",
      padding: "0 10px",
      cursor: "pointer",
      font: "var(--type-label)",
      color: active ? "var(--text-primary)" : "var(--text-secondary)",
      background: active ? "var(--surface-canvas)" : "transparent",
      borderRight: "1px solid var(--border-subtle)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onClose && onClose();
    },
    style: {
      flex: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "16px",
      height: "16px",
      borderRadius: "var(--radius-xs)",
      color: "var(--icon-idle)",
      visibility: showClose ? "visible" : "hidden"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 12
  })));
}
Object.assign(__ds_scope, { DocumentTab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/DocumentTab.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/**
 * Tabs — the inspector's underline tab strip ("Design" / "Interact"). Small,
 * text-only, with an accent underline on the active tab.
 */
function Tabs({
  tabs,
  value,
  onChange,
  style
}) {
  const norm = tabs.map(t => typeof t === "string" ? {
    value: t,
    label: t
  } : t);
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: "flex",
      alignItems: "stretch",
      gap: "16px",
      height: "36px",
      padding: "0 var(--section-pad)",
      borderBottom: "1px solid var(--border-subtle)",
      ...style
    }
  }, norm.map(t => {
    const active = t.value === value;
    return /*#__PURE__*/React.createElement(Tab, {
      key: t.value,
      label: t.label,
      active: active,
      onClick: () => onChange && onChange(t.value)
    });
  }));
}
function Tab({
  label,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "tab",
    "aria-selected": active,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: "relative",
      border: "none",
      background: "transparent",
      padding: 0,
      cursor: "pointer",
      font: active ? "var(--type-label-strong)" : "var(--type-label)",
      color: active ? "var(--text-primary)" : hover ? "var(--text-primary)" : "var(--text-secondary)"
    }
  }, label, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: "2px",
      background: active ? "var(--accent)" : "transparent",
      borderRadius: "2px 2px 0 0"
    }
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/overlays/ContextMenu.jsx
try { (() => {
/**
 * ContextMenu — the floating menu behind right-click (canvas + outliner) and
 * ⋯ overflow buttons (9 sites). Items carry an optional icon, a keyboard
 * shortcut hint, a danger flag, and dividers between groups. Verb parity with
 * the block Actions row is intentional.
 */
function ContextMenu({
  items,
  onSelect,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "menu",
    style: {
      minWidth: "180px",
      padding: "4px",
      background: "var(--surface-raised)",
      borderRadius: "var(--radius-md)",
      boxShadow: "var(--shadow-menu)",
      color: "var(--text-primary)",
      ...style
    }
  }, items.map((item, i) => {
    if (item === "-" || item.divider) {
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        style: {
          height: "1px",
          background: "var(--border-subtle)",
          margin: "4px 0"
        }
      });
    }
    return /*#__PURE__*/React.createElement(MenuItem, {
      key: i,
      item: item,
      onSelect: onSelect
    });
  }));
}
function MenuItem({
  item,
  onSelect
}) {
  const [hover, setHover] = React.useState(false);
  const disabled = item.disabled;
  const danger = item.danger;
  return /*#__PURE__*/React.createElement("div", {
    role: "menuitem",
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: () => {
      if (disabled) return;
      item.onClick && item.onClick();
      onSelect && onSelect(item.value ?? item.label);
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      height: "26px",
      padding: "0 8px",
      borderRadius: "var(--radius-xs)",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
      background: hover && !disabled ? danger ? "var(--red-tint)" : "var(--surface-hover)" : "transparent",
      color: danger ? "var(--danger)" : "var(--text-primary)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      width: "16px",
      display: "inline-flex",
      justifyContent: "center",
      color: danger ? "var(--danger)" : "var(--icon-idle)"
    }
  }, item.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: item.icon,
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: "var(--type-label)"
    }
  }, item.label), item.shortcut && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      font: "var(--type-label)",
      color: "var(--text-tertiary)"
    }
  }, item.shortcut));
}
Object.assign(__ds_scope, { ContextMenu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/ContextMenu.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Modal.jsx
try { (() => {
/**
 * Modal — the canonical dialog shell that replaced raw window.prompt/confirm
 * (D7). Centered card on a scrim: title, optional description, body, and a
 * right-aligned footer of actions. Compose an IconField for the prompt-modal
 * pattern; a message + Cancel/Confirm buttons for the confirm-modal pattern.
 */
function Modal({
  title,
  description,
  children,
  footer,
  width = 380,
  onClose,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "fixed",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--alpha-scrim)",
      zIndex: 1000
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation(),
    style: {
      width,
      maxWidth: "calc(100vw - 32px)",
      background: "var(--surface-raised)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-modal)",
      color: "var(--text-primary)",
      overflow: "hidden",
      ...style
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "12px",
      padding: "16px 16px 0"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-modal-title)"
    }
  }, title), description && /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-secondary)",
      marginTop: "4px"
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    style: {
      flex: "none",
      border: "none",
      background: "transparent",
      color: "var(--icon-idle)",
      cursor: "pointer",
      padding: "2px",
      borderRadius: "var(--radius-xs)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 16
  }))), children && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px"
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      padding: "0 16px 16px"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Modal.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Tooltip.jsx
try { (() => {
/**
 * Tooltip — a small dark label shown on hover. Wraps any trigger element.
 * Delay + placement match the editor's toolbar tooltips.
 */
function Tooltip({
  label,
  children,
  placement = "bottom",
  style
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    bottom: {
      top: "calc(100% + 6px)",
      left: "50%",
      transform: "translateX(-50%)"
    },
    top: {
      bottom: "calc(100% + 6px)",
      left: "50%",
      transform: "translateX(-50%)"
    },
    left: {
      right: "calc(100% + 6px)",
      top: "50%",
      transform: "translateY(-50%)"
    },
    right: {
      left: "calc(100% + 6px)",
      top: "50%",
      transform: "translateY(-50%)"
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    style: {
      position: "relative",
      display: "inline-flex",
      ...style
    }
  }, children, show && label && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: "absolute",
      ...pos[placement],
      padding: "4px 7px",
      background: "var(--gray-900)",
      color: "var(--text-primary)",
      font: "var(--type-label)",
      whiteSpace: "nowrap",
      borderRadius: "var(--radius-sm)",
      boxShadow: "var(--shadow-popover)",
      pointerEvents: "none",
      zIndex: 900
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/panels/Breadcrumb.jsx
try { (() => {
/**
 * Breadcrumb — the inspector context line ("Page 49 › Image hotspots"). Shows
 * the selection path; the last crumb is the current selection (emphasised).
 */
function Breadcrumb({
  items = [],
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      height: "28px",
      padding: "0 var(--section-pad)",
      font: "var(--type-label)",
      color: "var(--text-tertiary)",
      overflow: "hidden",
      ...style
    }
  }, items.map((item, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: last ? "var(--text-primary)" : "var(--text-tertiary)",
        fontWeight: last ? "var(--weight-medium)" : "var(--weight-regular)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: item.onClick ? "pointer" : "default"
      },
      onClick: item.onClick
    }, typeof item === "string" ? item : item.label), !last && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "chevron-right",
      size: 12,
      style: {
        color: "var(--icon-idle)",
        flex: "none"
      }
    }));
  }));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/panels/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/panels/Panel.jsx
try { (() => {
/**
 * Panel — the left/right dock shell. A fixed-width, full-height column with
 * the panel surface + a single edge border. Compose PanelSection children
 * inside. `side` controls which edge border shows.
 */
function Panel({
  children,
  side = "right",
  width,
  header,
  footer,
  style
}) {
  const w = width || (side === "left" ? "var(--panel-left-width)" : "var(--panel-right-width)");
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      display: "flex",
      flexDirection: "column",
      width: w,
      flex: "none",
      height: "100%",
      background: "var(--surface-panel)",
      borderLeft: side === "right" ? "1px solid var(--border-subtle)" : "none",
      borderRight: side === "left" ? "1px solid var(--border-subtle)" : "none",
      color: "var(--text-primary)",
      overflow: "hidden",
      ...style
    }
  }, header && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none"
    }
  }, header), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden"
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      borderTop: "1px solid var(--border-subtle)"
    }
  }, footer));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/panels/Panel.jsx", error: String((e && e.message) || e) }); }

// components/panels/PanelSection.jsx
try { (() => {
/**
 * PanelSection — the `sectionGroup` wrapper (D3 taxonomy). A titled, optionally
 * collapsible group of rows. `actions` render on the right of the header
 * (e.g. an add "+" or reset). This is the unit every inspector is assembled
 * from — one section per taxonomy type (Content / Type / Appearance / …).
 */
function PanelSection({
  title,
  children,
  collapsible = true,
  defaultOpen = true,
  actions,
  divider = true,
  style
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return /*#__PURE__*/React.createElement("section", {
    style: {
      borderTop: divider ? "1px solid var(--border-subtle)" : "none",
      padding: "8px var(--section-pad)",
      ...style
    }
  }, title && /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: "20px",
      marginBottom: open ? "4px" : 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => collapsible && setOpen(o => !o),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      border: "none",
      background: "transparent",
      padding: 0,
      cursor: collapsible ? "pointer" : "default",
      font: "var(--type-section)",
      color: "var(--text-primary)"
    }
  }, collapsible && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 12,
    style: {
      color: "var(--icon-idle)",
      transform: open ? "rotate(90deg)" : "none",
      transition: "transform var(--dur-fast) var(--ease-standard)"
    }
  }), /*#__PURE__*/React.createElement("span", null, title)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "2px"
    }
  }, actions)), open && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "2px"
    }
  }, children));
}
Object.assign(__ds_scope, { PanelSection });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/panels/PanelSection.jsx", error: String((e && e.message) || e) }); }

// components/structure/Badge.jsx
try { (() => {
/**
 * Badge — a small count / status pill. Neutral by default; `tone` tints it for
 * status (accent, success, danger, component-purple). Used for chapter counts,
 * "viewed" progress, variant tags, and NEW markers.
 */
function Badge({
  children,
  tone = "neutral",
  size = "sm",
  style
}) {
  const tones = {
    neutral: {
      bg: "var(--surface-input)",
      fg: "var(--text-secondary)"
    },
    accent: {
      bg: "var(--accent-quiet)",
      fg: "var(--accent)"
    },
    success: {
      bg: "var(--green-tint)",
      fg: "var(--success)"
    },
    danger: {
      bg: "var(--red-tint)",
      fg: "var(--danger)"
    },
    component: {
      bg: "rgba(151,71,255,0.16)",
      fg: "var(--component)"
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: size === "sm" ? "16px" : "20px",
      minWidth: size === "sm" ? "16px" : "20px",
      padding: "0 5px",
      borderRadius: "var(--radius-full)",
      background: t.bg,
      color: t.fg,
      font: "var(--type-label-strong)",
      fontSize: size === "sm" ? "10px" : "11px",
      letterSpacing: "var(--tracking-normal)",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/structure/Badge.jsx", error: String((e && e.message) || e) }); }

// components/structure/BlockPaletteItem.jsx
try { (() => {
/**
 * BlockPaletteItem — a row in the Blocks palette: a leading block-type icon
 * and its name. Click or drag to insert. Hover raises the row.
 */
function BlockPaletteItem({
  label,
  icon,
  onClick,
  draggable = true,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    draggable: draggable,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      height: "30px",
      padding: "0 8px",
      borderRadius: "var(--radius-xs)",
      cursor: "grab",
      background: hover ? "var(--surface-hover)" : "transparent",
      color: "var(--text-primary)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      width: "24px",
      height: "24px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-xs)",
      background: "var(--surface-input)",
      color: hover ? "var(--accent)" : "var(--icon-idle)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 15
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)"
    }
  }, label));
}
Object.assign(__ds_scope, { BlockPaletteItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/structure/BlockPaletteItem.jsx", error: String((e && e.message) || e) }); }

// components/structure/BlockTile.jsx
try { (() => {
/**
 * BlockTile — a block-palette entry as a compact icon tile (icon over label),
 * for laying the palette out as a scannable grid instead of a long scrolling
 * list. Drag or click to insert. Pair several in a CSS grid (see BlockGrid).
 */
function BlockTile({
  label,
  icon,
  selected = false,
  onClick,
  draggable = true,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const activeBg = selected ? "var(--surface-selected)" : hover ? "var(--surface-hover)" : "var(--surface-input)";
  return /*#__PURE__*/React.createElement("div", {
    draggable: draggable,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    title: label,
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "7px",
      padding: "12px 6px 9px",
      borderRadius: "var(--radius-sm)",
      cursor: "grab",
      background: activeBg,
      boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px var(--border-subtle)",
      color: "var(--text-primary)",
      transition: "background var(--dur-fast) var(--ease-standard)",
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20,
    style: {
      color: selected || hover ? "var(--accent)" : "var(--icon-idle)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      fontSize: "10px",
      color: "var(--text-secondary)",
      textAlign: "center",
      lineHeight: 1.25,
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, label));
}

/**
 * BlockGrid — a responsive grid wrapper for BlockTiles. `columns` sets the
 * fixed column count (default 3, which fits the 248px left dock).
 */
function BlockGrid({
  children,
  columns = 3,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      gap: "6px",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { BlockTile, BlockGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/structure/BlockTile.jsx", error: String((e && e.message) || e) }); }

// components/structure/TreeItem.jsx
try { (() => {
/**
 * TreeItem — an outliner row (chapter / page / block). Handles indentation,
 * an optional twirl chevron for containers, a leading icon, the label, and a
 * trailing slot (count badge, visibility eye). Mirrors the Structure panel.
 */
function TreeItem({
  label,
  icon,
  depth = 0,
  selected = false,
  expandable = false,
  expanded = false,
  muted = false,
  trailing,
  onToggle,
  onSelect,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onSelect,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      height: "26px",
      paddingRight: "8px",
      paddingLeft: `${8 + depth * 14}px`,
      cursor: "pointer",
      borderRadius: "var(--radius-xs)",
      background: selected ? "var(--surface-selected)" : hover ? "var(--surface-hover)" : "transparent",
      color: muted ? "var(--text-tertiary)" : "var(--text-primary)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      expandable && onToggle && onToggle();
    },
    style: {
      flex: "none",
      width: "12px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--icon-idle)"
    }
  }, expandable && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 12,
    style: {
      transform: expanded ? "rotate(90deg)" : "none",
      transition: "transform var(--dur-fast) var(--ease-standard)"
    }
  })), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14,
    style: {
      color: selected ? "var(--accent)" : "var(--icon-idle)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      font: selected ? "var(--type-label-strong)" : "var(--type-label)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, label), trailing && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      display: "inline-flex",
      alignItems: "center"
    }
  }, trailing));
}
Object.assign(__ds_scope, { TreeItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/structure/TreeItem.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/CanvasView.jsx
try { (() => {
// Verso editor — the canvas (infinite board) with the open page rendered.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const {
    Badge,
    Icon
  } = V;
  function BlockWrap({
    block,
    selected,
    onSelect,
    children
  }) {
    const [hover, setHover] = React.useState(false);
    return /*#__PURE__*/React.createElement("div", {
      onClick: e => {
        e.stopPropagation();
        onSelect({
          type: "block",
          id: block.id
        });
      },
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        position: "relative",
        borderRadius: 4,
        outline: selected ? "2px solid var(--accent)" : hover ? "1px solid var(--accent)" : "1px solid transparent",
        outlineOffset: 2,
        cursor: "default"
      }
    }, children);
  }
  function CanvasView({
    selected,
    onSelect
  }) {
    const page = window.VERSO_COURSE.page;
    const sel = id => selected.type === "block" && selected.id === id;
    return /*#__PURE__*/React.createElement("div", {
      onClick: () => onSelect({
        type: "page",
        id: page.id
      }),
      style: {
        flex: 1,
        background: "var(--surface-canvas)",
        overflow: "auto",
        display: "flex",
        justifyContent: "center",
        padding: "56px 40px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 720,
        alignSelf: "flex-start"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
        color: "var(--accent)",
        font: "var(--type-label)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "file-text",
      size: 12
    }), /*#__PURE__*/React.createElement("span", null, page.label)), /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#212121",
        borderRadius: 8,
        padding: "44px 52px",
        fontFamily: "var(--font-brand)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.04)"
      }
    }, page.blocks.map(b => /*#__PURE__*/React.createElement("div", {
      key: b.id,
      style: {
        marginBottom: 24
      }
    }, /*#__PURE__*/React.createElement(BlockWrap, {
      block: b,
      selected: sel(b.id),
      onSelect: onSelect
    }, b.type === "Heading" && /*#__PURE__*/React.createElement("h1", {
      style: {
        margin: 0,
        font: "600 30px/1.2 var(--font-brand)",
        color: "#fff"
      }
    }, b.text), b.type === "Paragraph" && /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        font: "400 15px/1.6 var(--font-brand)",
        color: "#c9c9c9"
      }
    }, b.text), b.type === "Image hotspots" && /*#__PURE__*/React.createElement(Hotspots, {
      block: b
    })))))));
  }
  function Hotspots({
    block
  }) {
    // Placeholder base image with pin markers (matches the screenshot's hotspot block).
    const pins = [{
      x: "18%",
      y: "62%"
    }, {
      x: "38%",
      y: "40%"
    }, {
      x: "55%",
      y: "70%"
    }, {
      x: "72%",
      y: "48%"
    }, {
      x: "86%",
      y: "30%"
    }];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        height: 300,
        borderRadius: 6,
        overflow: "hidden",
        background: "linear-gradient(160deg,#2b3540,#1a2028 70%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,0.28)",
        font: "500 12px var(--font-ui)",
        letterSpacing: "0.06em",
        textTransform: "uppercase"
      }
    }, "Operational environments \u2014 base image"), pins.map((p, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        position: "absolute",
        left: p.x,
        top: p.y,
        transform: "translate(-50%,-50%)",
        width: 26,
        height: 26,
        borderRadius: 999,
        background: "rgba(255,138,0,0.92)",
        boxShadow: "0 0 0 4px rgba(255,138,0,0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        font: "700 12px var(--font-ui)"
      }
    }, i + 1)));
  }
  window.CanvasView = CanvasView;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/CanvasView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/Inspector.jsx
try { (() => {
// Verso editor — right dock: the contextual inspector.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const {
    Panel,
    Tabs,
    Breadcrumb,
    PanelSection,
    FieldRow,
    TwoUp,
    IconField,
    SegmentedControl,
    ColorField,
    SwitchRow,
    Select,
    TextField,
    IconButton
  } = V;
  function ActionsRow() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 2,
        background: "var(--surface-input)",
        borderRadius: "var(--radius-xs)",
        padding: 2,
        width: "fit-content"
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "arrow-up",
      label: "Move up"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "arrow-down",
      label: "Move down"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "copy",
      label: "Duplicate"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "trash-2",
      label: "Delete",
      danger: true
    }));
  }
  function AlignRow() {
    const [h, setH] = React.useState("center");
    const [v, setV] = React.useState("top");
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Horizontal"
    }, /*#__PURE__*/React.createElement(SegmentedControl, {
      value: h,
      onChange: setH,
      options: [{
        value: "left",
        icon: "align-start-vertical"
      }, {
        value: "center",
        icon: "align-center-vertical"
      }, {
        value: "right",
        icon: "align-end-vertical"
      }]
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Vertical"
    }, /*#__PURE__*/React.createElement(SegmentedControl, {
      value: v,
      onChange: setV,
      options: [{
        value: "top",
        icon: "align-start-horizontal"
      }, {
        value: "middle",
        icon: "align-center-horizontal"
      }, {
        value: "bottom",
        icon: "align-end-horizontal"
      }]
    })));
  }
  function HotspotInspector() {
    const [marker, setMarker] = React.useState("#FF8A00");
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PanelSection, {
      title: "Position",
      divider: false
    }, /*#__PURE__*/React.createElement(AlignRow, null)), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Actions",
      collapsible: false
    }, /*#__PURE__*/React.createElement(ActionsRow, null)), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Base image"
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Source"
    }, /*#__PURE__*/React.createElement(IconField, {
      icon: "image",
      placeholder: "paste a URL"
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Alt text",
      align: "top"
    }, /*#__PURE__*/React.createElement(TextField, {
      multiline: true,
      rows: 2,
      placeholder: "Describe the image for screen readers"
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Interaction"
    }, /*#__PURE__*/React.createElement(Select, {
      value: "Popover on click",
      options: ["Popover on click", "Popover on hover", "Tooltip"]
    }))), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Markers",
      actions: /*#__PURE__*/React.createElement(IconButton, {
        icon: "plus",
        label: "Add colour",
        size: "sm"
      })
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Colour"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: marker,
      opacity: 100,
      onChange: setMarker
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Size"
    }, /*#__PURE__*/React.createElement(IconField, {
      prefix: "W",
      value: "30",
      suffix: "px"
    })), /*#__PURE__*/React.createElement(SwitchRow, {
      label: "Mark as viewed",
      checked: true,
      onChange: () => {}
    })), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Overlay card"
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Fill"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: "#262626",
      opacity: 100
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Border"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: "#0D99FF",
      opacity: 100
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Radius"
    }, /*#__PURE__*/React.createElement(TwoUp, null, /*#__PURE__*/React.createElement(IconField, {
      prefix: "R",
      value: "4"
    }), /*#__PURE__*/React.createElement(IconField, {
      prefix: "W",
      value: "20"
    })))), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Hotspots"
    }, ["Military", "Protecting", "Law Enforcement", "Extended", "Gatherings"].map(h => /*#__PURE__*/React.createElement("div", {
      key: h,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 26
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 12,
        borderRadius: 999,
        background: "#FF8A00",
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        font: "var(--type-label)",
        color: "var(--text-primary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, h), /*#__PURE__*/React.createElement(IconButton, {
      icon: "x",
      label: "Remove",
      size: "sm"
    })))));
  }
  function TextInspector({
    kind
  }) {
    const [font, setFont] = React.useState("Exo 2");
    const [align, setAlign] = React.useState("left");
    const [color, setColor] = React.useState(kind === "Heading" ? "#FFFFFF" : "#C9C9C9");
    const [style, setStyle] = React.useState("B");
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PanelSection, {
      title: "Type",
      divider: false
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Font"
    }, /*#__PURE__*/React.createElement(Select, {
      value: font,
      onChange: setFont,
      options: ["Exo 2", "Inter", "Arial"]
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Size"
    }, /*#__PURE__*/React.createElement(TwoUp, null, /*#__PURE__*/React.createElement(IconField, {
      prefix: "S",
      value: kind === "Heading" ? "30" : "15",
      suffix: "px"
    }), /*#__PURE__*/React.createElement(Select, {
      value: kind === "Heading" ? "Semibold" : "Regular",
      options: ["Regular", "Medium", "Semibold", "Bold"]
    }))), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Style"
    }, /*#__PURE__*/React.createElement(SegmentedControl, {
      value: style,
      onChange: setStyle,
      options: [{
        value: "B",
        icon: "bold"
      }, {
        value: "I",
        icon: "italic"
      }, {
        value: "U",
        icon: "underline"
      }, {
        value: "L",
        icon: "link"
      }]
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Align"
    }, /*#__PURE__*/React.createElement(SegmentedControl, {
      value: align,
      onChange: setAlign,
      options: [{
        value: "left",
        icon: "align-left"
      }, {
        value: "center",
        icon: "align-center"
      }, {
        value: "right",
        icon: "align-right"
      }, {
        value: "justify",
        icon: "align-justify"
      }]
    }))), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Appearance"
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Colour"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: color,
      opacity: 100,
      onChange: setColor
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Style"
    }, /*#__PURE__*/React.createElement(Select, {
      value: "\u2014 None \u2014",
      options: ["— None —", "Section title", "Body", "Caption"]
    }))), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Actions",
      collapsible: false
    }, /*#__PURE__*/React.createElement(ActionsRow, null)));
  }
  function PageInspector() {
    const [twoCol, setTwoCol] = React.useState(false);
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PanelSection, {
      title: "Chapter",
      divider: false
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Name"
    }, /*#__PURE__*/React.createElement(IconField, {
      value: "Introduction"
    })), /*#__PURE__*/React.createElement(SwitchRow, {
      label: "Gated progression",
      description: "Complete this chapter's quiz to advance",
      checked: twoCol,
      onChange: setTwoCol
    })), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Page padding"
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Top / Bottom"
    }, /*#__PURE__*/React.createElement(TwoUp, null, /*#__PURE__*/React.createElement(IconField, {
      prefix: "T",
      value: "64"
    }), /*#__PURE__*/React.createElement(IconField, {
      prefix: "B",
      value: "64"
    }))), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Sides"
    }, /*#__PURE__*/React.createElement(TwoUp, null, /*#__PURE__*/React.createElement(IconField, {
      prefix: "L",
      value: "52"
    }), /*#__PURE__*/React.createElement(IconField, {
      prefix: "R",
      value: "52"
    })))), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Header & Footer"
    }, /*#__PURE__*/React.createElement(SwitchRow, {
      label: "Show header",
      checked: false,
      onChange: () => {}
    }), /*#__PURE__*/React.createElement(SwitchRow, {
      label: "Show footer",
      checked: true,
      onChange: () => {}
    }), /*#__PURE__*/React.createElement(SwitchRow, {
      label: "Learner nav pill",
      checked: true,
      onChange: () => {}
    })), /*#__PURE__*/React.createElement(PanelSection, {
      title: "Theme"
    }, /*#__PURE__*/React.createElement(FieldRow, {
      label: "Background"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: "#212121",
      tokenName: "bg",
      opacity: 100
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Ink"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: "#FFFFFF",
      tokenName: "ink",
      opacity: 100
    })), /*#__PURE__*/React.createElement(FieldRow, {
      label: "Accent"
    }, /*#__PURE__*/React.createElement(ColorField, {
      value: "#0D99FF",
      tokenName: "accent",
      opacity: 100
    }))));
  }
  function Inspector({
    selected
  }) {
    const [tab, setTab] = React.useState("Design");
    const page = window.VERSO_COURSE.page;
    let crumbs, body;
    if (selected.type === "block") {
      const b = page.blocks.find(x => x.id === selected.id);
      crumbs = [page.name || "Page", b ? b.type : "Block"];
      body = b && b.type === "Image hotspots" ? /*#__PURE__*/React.createElement(HotspotInspector, null) : b ? /*#__PURE__*/React.createElement(TextInspector, {
        kind: b.type
      }) : /*#__PURE__*/React.createElement(PageInspector, null);
    } else {
      crumbs = ["Document", "Page 2.4"];
      body = /*#__PURE__*/React.createElement(PageInspector, null);
    }
    return /*#__PURE__*/React.createElement(Panel, {
      side: "right",
      header: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Tabs, {
        tabs: ["Design", "Interact"],
        value: tab,
        onChange: setTab
      }), /*#__PURE__*/React.createElement(Breadcrumb, {
        items: crumbs
      }))
    }, body);
  }
  window.Inspector = Inspector;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/Inspector.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/LeftPanel.jsx
try { (() => {
// Verso editor — left dock: Structure outliner + Blocks palette.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const {
    Panel,
    TreeItem,
    BlockPaletteItem,
    BlockTile,
    BlockGrid,
    Badge,
    IconButton,
    SegmentedControl,
    Icon
  } = V;
  function SectionLabel({
    children,
    actions
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 10px 4px"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-section)",
        color: "var(--text-primary)"
      }
    }, children), actions && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 2
      }
    }, actions));
  }
  function LeftPanel({
    selected,
    onSelect
  }) {
    const course = window.VERSO_COURSE;
    const [openChapters, setOpenChapters] = React.useState({
      intro: true,
      types: true
    });
    const [view, setView] = React.useState("grid");
    const toggle = id => setOpenChapters(o => ({
      ...o,
      [id]: !o[id]
    }));
    return /*#__PURE__*/React.createElement(Panel, {
      side: "left"
    }, /*#__PURE__*/React.createElement(SectionLabel, {
      actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
        icon: "list-collapse",
        label: "Collapse all",
        size: "sm"
      }), /*#__PURE__*/React.createElement(IconButton, {
        icon: "plus",
        label: "Add page",
        size: "sm"
      }))
    }, "Structure"), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "0 8px 8px"
      }
    }, course.chapters.map(ch => /*#__PURE__*/React.createElement(React.Fragment, {
      key: ch.id
    }, /*#__PURE__*/React.createElement(TreeItem, {
      label: ch.name,
      depth: 0,
      expandable: true,
      expanded: !!openChapters[ch.id],
      onToggle: () => toggle(ch.id),
      trailing: /*#__PURE__*/React.createElement(Badge, null, ch.pages.length)
    }), openChapters[ch.id] && ch.pages.map(p => /*#__PURE__*/React.createElement(TreeItem, {
      key: p.id,
      label: p.name,
      icon: "file-text",
      depth: 1,
      selected: selected.type === "page" && selected.id === p.id,
      onSelect: () => onSelect({
        type: "page",
        id: p.id
      })
    }))))), /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: "1px solid var(--border-subtle)"
      }
    }), /*#__PURE__*/React.createElement(SectionLabel, {
      actions: /*#__PURE__*/React.createElement("div", {
        style: {
          width: 56
        }
      }, /*#__PURE__*/React.createElement(SegmentedControl, {
        size: "sm",
        value: view,
        onChange: setView,
        options: [{
          value: "grid",
          icon: "layout-grid",
          title: "Grid"
        }, {
          value: "list",
          icon: "list",
          title: "List"
        }]
      }))
    }, "Blocks"), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "0 8px 16px"
      }
    }, window.VERSO_PALETTE.map(cat => /*#__PURE__*/React.createElement("div", {
      key: cat.group,
      style: {
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        font: "var(--type-label)",
        color: "var(--text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "var(--tracking-caps)",
        padding: "6px 4px 6px",
        fontSize: 10
      }
    }, cat.group), view === "grid" ? /*#__PURE__*/React.createElement(BlockGrid, {
      columns: 3
    }, cat.items.map(it => /*#__PURE__*/React.createElement(BlockTile, {
      key: it.label,
      icon: it.icon,
      label: it.label.split(" (")[0]
    }))) : cat.items.map(it => /*#__PURE__*/React.createElement(BlockPaletteItem, {
      key: it.label,
      icon: it.icon,
      label: it.label
    }))))));
  }
  window.LeftPanel = LeftPanel;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/LeftPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/TopBar.jsx
try { (() => {
// Verso editor — top bar: document tabs + toolbar.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const {
    DocumentTab,
    IconButton,
    Button,
    Tooltip
  } = V;
  function TopBar({
    theme,
    onToggleTheme,
    zoom
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        flex: "none",
        background: "var(--surface-app)",
        borderBottom: "1px solid var(--border-subtle)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        height: "var(--tabbar-height)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        gap: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-brand)",
        fontSize: 15,
        color: "var(--text-primary)",
        padding: "0 10px 0 6px"
      }
    }, "Verso", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--accent)"
      }
    }, "."))), /*#__PURE__*/React.createElement(DocumentTab, {
      label: "Sample Course",
      active: true
    }), /*#__PURE__*/React.createElement(DocumentTab, {
      label: "RF Systems 201"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "plus",
      label: "New course",
      size: "md"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        height: 40,
        padding: "0 8px",
        gap: 6,
        borderTop: "1px solid var(--border-subtle)"
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: variantBtn
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-tertiary)"
      }
    }, "Variant"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-primary)",
        fontWeight: 500
      }
    }, "Flagship"), /*#__PURE__*/React.createElement(V.Icon, {
      name: "chevron-down",
      size: 13,
      style: {
        color: "var(--icon-idle)"
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: groupStyle
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "monitor",
      label: "Desktop",
      active: true
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "tablet",
      label: "Tablet"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "smartphone",
      label: "Mobile"
    })), /*#__PURE__*/React.createElement("div", {
      style: dividerStyle
    }), /*#__PURE__*/React.createElement(Tooltip, {
      label: theme === "dark" ? "Light mode" : "Dark mode"
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: theme === "dark" ? "sun" : "moon",
      label: "Theme",
      onClick: onToggleTheme
    })), /*#__PURE__*/React.createElement(IconButton, {
      icon: "search",
      label: "Search (\u2318K)"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "help-circle",
      label: "Help"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-label)",
        color: "var(--text-tertiary)",
        padding: "0 6px",
        whiteSpace: "nowrap"
      }
    }, "Saved 08:09"), /*#__PURE__*/React.createElement("div", {
      style: groupStyle
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "undo-2",
      label: "Undo"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "redo-2",
      label: "Redo"
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-label)",
        color: "var(--text-secondary)",
        padding: "0 4px"
      }
    }, zoom, "%"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "message-square",
      label: "Comment (C)"
    }), /*#__PURE__*/React.createElement("div", {
      style: dividerStyle
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "upload",
      iconRight: "chevron-down"
    }, "Export"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "play"
    }, "Preview"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "more-horizontal",
      label: "More"
    })));
  }
  const variantBtn = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    padding: "0 10px",
    background: "var(--surface-input)",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    font: "var(--type-label)",
    color: "var(--text-primary)"
  };
  const groupStyle = {
    display: "flex",
    alignItems: "center",
    gap: 2
  };
  const dividerStyle = {
    width: 1,
    height: 20,
    background: "var(--border-subtle)",
    margin: "0 4px"
  };
  window.TopBar = TopBar;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/TopBar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/editor/data.js
try { (() => {
// Fake course model for the Verso editor UI kit — a neutral sample course
// shown in the provided screenshots. Not production data.
window.VERSO_COURSE = {
  title: "Sample Course",
  chapters: [{
    id: "intro",
    name: "INTRODUCTION",
    pages: [{
      id: "p11",
      name: "1.1 Welcome"
    }, {
      id: "p12",
      name: "1.2 Page"
    }, {
      id: "p13",
      name: "1.3 Learning Objectives"
    }, {
      id: "p14",
      name: "1.4 Notes"
    }]
  }, {
    id: "types",
    name: "CORE CONCEPTS",
    pages: [{
      id: "p21",
      name: "2.1 What is UAS? Types and Cap…"
    }, {
      id: "p22",
      name: "2.2 Unmanned Aerial Systems"
    }, {
      id: "p23",
      name: "2.3 How It Fits Together…"
    }, {
      id: "p24",
      name: "2.4 Classification Groups Interac…"
    }, {
      id: "p25",
      name: "2.5 Unmanned Systems Are Not …"
    }, {
      id: "p26",
      name: "2.6 Types and Capabilities (cont.)"
    }]
  }, {
    id: "threat",
    name: "PUTTING IT INTO PRACTICE",
    pages: [{
      id: "p31",
      name: "3.1 Practice Scenarios"
    }]
  }],
  // The blocks on the currently-open page (2.4 — the hotspots page).
  page: {
    id: "p24",
    label: "2.4 Applying the Concepts",
    blocks: [{
      id: "b1",
      type: "Heading",
      icon: "heading",
      text: "Applying the Concepts"
    }, {
      id: "b2",
      type: "Paragraph",
      icon: "align-left",
      text: "Different situations call for a different approach. Planning, execution and review considerations come together when you put the ideas into practice."
    }, {
      id: "b3",
      type: "Image hotspots",
      icon: "target",
      hotspots: ["Military", "Protecting", "Law Enforcement", "Extended", "Gatherings"]
    }]
  }
};

// Blocks palette catalogue (from the User Guide).
window.VERSO_PALETTE = [{
  group: "Text",
  items: [{
    icon: "heading",
    label: "Heading"
  }, {
    icon: "type",
    label: "Subheading"
  }, {
    icon: "align-left",
    label: "Paragraph"
  }, {
    icon: "quote",
    label: "Quote"
  }, {
    icon: "list",
    label: "Bulleted list"
  }, {
    icon: "message-square-warning",
    label: "Note / callout"
  }]
}, {
  group: "Media",
  items: [{
    icon: "image",
    label: "Image"
  }, {
    icon: "code-xml",
    label: "HTML Interaction"
  }, {
    icon: "square-play",
    label: "Web Embed"
  }, {
    icon: "target",
    label: "Image hotspots"
  }]
}, {
  group: "Layout",
  items: [{
    icon: "square",
    label: "Card (container)"
  }, {
    icon: "minus",
    label: "Divider"
  }, {
    icon: "move-vertical",
    label: "Spacer"
  }, {
    icon: "panels-top-left",
    label: "Accordion / Tabs"
  }, {
    icon: "layers",
    label: "Card Reveal"
  }, {
    icon: "workflow",
    label: "Sequence (process)"
  }]
}, {
  group: "Interactive",
  items: [{
    icon: "navigation",
    label: "Navigation button"
  }, {
    icon: "check-square",
    label: "Acknowledge / Checkbox"
  }, {
    icon: "list-checks",
    label: "Quiz (knowledge check)"
  }]
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editor/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.ColorField = __ds_scope.ColorField;

__ds_ns.FieldRow = __ds_scope.FieldRow;

__ds_ns.TwoUp = __ds_scope.TwoUp;

__ds_ns.IconField = __ds_scope.IconField;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.SwitchRow = __ds_scope.SwitchRow;

__ds_ns.TextField = __ds_scope.TextField;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.DocumentTab = __ds_scope.DocumentTab;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.ContextMenu = __ds_scope.ContextMenu;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.PanelSection = __ds_scope.PanelSection;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.BlockPaletteItem = __ds_scope.BlockPaletteItem;

__ds_ns.BlockTile = __ds_scope.BlockTile;

__ds_ns.BlockGrid = __ds_scope.BlockGrid;

__ds_ns.TreeItem = __ds_scope.TreeItem;

})();
