import React from "react";

/**
 * Tabs — the inspector's underline tab strip ("Design" / "Interact"). Small,
 * text-only, with an accent underline on the active tab.
 */
export function Tabs({ tabs, value, onChange, style }) {
  const norm = tabs.map((t) => (typeof t === "string" ? { value: t, label: t } : t));
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: "16px",
        height: "36px",
        padding: "0 var(--section-pad)",
        borderBottom: "1px solid var(--border-subtle)",
        ...style,
      }}
    >
      {norm.map((t) => {
        const active = t.value === value;
        return (
          <Tab key={t.value} label={t.label} active={active} onClick={() => onChange && onChange(t.value)} />
        );
      })}
    </div>
  );
}

function Tab({ label, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        font: active ? "var(--type-label-strong)" : "var(--type-label)",
        color: active ? "var(--text-primary)" : hover ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "2px",
          background: active ? "var(--accent)" : "transparent",
          borderRadius: "2px 2px 0 0",
        }}
      />
    </button>
  );
}
