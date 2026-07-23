import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * Checkbox — a small square check. Used for quiz answer keys, acknowledge
 * gates, and multi-select lists. `mixed` renders the indeterminate dash.
 */
export function Checkbox({ checked = false, mixed = false, disabled = false, label, onChange, style }) {
  const on = checked || mixed;
  const box = (
    <span
      style={{
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
        transition: "background var(--dur-fast) var(--ease-standard)",
      }}
    >
      {mixed ? <Icon name="minus" size={11} /> : checked ? <Icon name="check" size={11} /> : null}
    </span>
  );

  if (!label) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={mixed ? "mixed" : checked}
        disabled={disabled}
        onClick={() => !disabled && onChange && onChange(!checked)}
        style={{ border: "none", background: "transparent", padding: 0, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, ...style }}
      >
        {box}
      </button>
    );
  }

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        font: "var(--type-label)",
        color: "var(--text-primary)",
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      {box}
      <span>{label}</span>
    </label>
  );
}
