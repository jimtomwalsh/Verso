import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * SearchField — the browser's filter box: a leading `search` glyph, a free-text
 * input, and a clear affordance once there's a query. It is the IconField control
 * form (leading glyph + borderless-at-rest input, border on hover, accent ring on
 * focus) tuned for filtering rather than editing a value. The consumer filters the
 * card grid by title/code on `onChange`; this owns only the control chrome.
 */
export function SearchField({ value = "", placeholder = "search courses", onChange, onClear, style }) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const ring = focus
    ? "inset 0 0 0 1px var(--accent)"
    : hover
    ? "inset 0 0 0 1px var(--border-input)"
    : "inset 0 0 0 1px transparent";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        height: "var(--control-md)",
        padding: "0 var(--space-3)",
        borderRadius: "var(--radius-xs)",
        background: "var(--surface-input)",
        boxShadow: ring,
        transition: "box-shadow var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
    >
      <Icon name="search" size={14} style={{ color: "var(--icon-idle)", flex: "none" }} />
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange && onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-primary)",
          font: "var(--type-value)",
        }}
      />
      {value ? (
        <Icon
          name="x"
          size={14}
          onClick={onClear}
          style={{ color: "var(--icon-idle)", cursor: "pointer", flex: "none" }}
        />
      ) : null}
    </div>
  );
}
