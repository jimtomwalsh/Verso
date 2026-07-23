import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * ColorField — the unified `colorField` (D5). One control replaces the four
 * legacy colour paths (colourControl / colorToken / per-mode / palette-map).
 * Layout: swatch · hex · opacity% · eyedropper. A colour may be a raw hex
 * ("custom") or a theme token ("token") shown by its token name; per-mode
 * fills are handled by rendering two ColorFields (one per light/dark).
 */
export function ColorField({
  value = "#000000",
  opacity = 100,
  tokenName,
  onChange,
  onOpacityChange,
  onEyedrop,
  disabled = false,
  style,
}) {
  const [hover, setHover] = React.useState(false);
  const hex = String(value).replace(/^#/, "").toUpperCase();

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        height: "var(--control-md)",
        background: "var(--surface-input)",
        borderRadius: "var(--radius-xs)",
        border: "1px solid",
        borderColor: hover && !disabled ? "var(--border-input)" : "transparent",
        opacity: disabled ? 0.5 : 1,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Swatch (checker under alpha) */}
      <span
        style={{
          flex: "none",
          width: "16px",
          height: "16px",
          margin: "0 6px",
          borderRadius: "3px",
          boxShadow: "inset 0 0 0 1px var(--border-strong)",
          backgroundColor: value,
          backgroundImage:
            "linear-gradient(45deg,#7a7a7a 25%,transparent 25%),linear-gradient(-45deg,#7a7a7a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#7a7a7a 75%),linear-gradient(-45deg,transparent 75%,#7a7a7a 75%)",
          backgroundSize: "6px 6px",
          backgroundPosition: "0 0,0 3px,3px -3px,-3px 0",
          cursor: disabled ? "default" : "pointer",
        }}
      />
      {/* Hex / token name */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          font: "var(--type-value)",
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {tokenName || hex}
      </span>
      {/* Opacity */}
      <span
        style={{
          flex: "none",
          font: "var(--type-value)",
          color: "var(--text-secondary)",
          padding: "0 6px",
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        {opacity}%
      </span>
      {/* Eyedropper */}
      <button
        type="button"
        onClick={onEyedrop}
        disabled={disabled}
        title="Pick colour"
        style={{
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
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        <Icon name="pipette" size={13} />
      </button>
    </div>
  );
}
