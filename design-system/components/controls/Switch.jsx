import React from "react";

/**
 * Switch — a compact on/off toggle (compact, ~28x16). Used for every
 * boolean setting.
 */
export function Switch({ checked = false, disabled = false, onChange, style }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
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
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "14px" : "2px",
          width: "12px",
          height: "12px",
          borderRadius: "var(--radius-full)",
          background: "var(--white)",
          transition: "left var(--dur-fast) var(--ease-standard)",
        }}
      />
    </button>
  );
}

/**
 * SwitchRow — the `switchRow` control (27 sites): a full-width row with a
 * label and a trailing Switch. The default way to expose a boolean setting.
 */
export function SwitchRow({ label, description, checked, disabled, onChange, style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: description ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: "12px",
        minHeight: "var(--row-height)",
        padding: "2px 0",
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "var(--type-label)", color: "var(--text-primary)" }}>{label}</div>
        {description && (
          <div style={{ font: "var(--type-label)", color: "var(--text-tertiary)", marginTop: "2px" }}>
            {description}
          </div>
        )}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}
