import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * PanelSection — the `sectionGroup` wrapper (D3 taxonomy). A titled, optionally
 * collapsible group of rows. `actions` render on the right of the header
 * (e.g. an add "+" or reset). This is the unit every inspector is assembled
 * from — one section per taxonomy type (Content / Type / Appearance / …).
 */
export function PanelSection({
  title,
  children,
  collapsible = true,
  defaultOpen = true,
  actions,
  divider = true,
  style,
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <section
      style={{
        borderTop: divider ? "1px solid var(--border-subtle)" : "none",
        padding: "8px var(--section-pad)",
        ...style,
      }}
    >
      {title && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: "20px",
            marginBottom: open ? "4px" : 0,
          }}
        >
          <button
            type="button"
            onClick={() => collapsible && setOpen((o) => !o)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: collapsible ? "pointer" : "default",
              font: "var(--type-section)",
              color: "var(--text-primary)",
            }}
          >
            {collapsible && (
              <Icon
                name="chevron-right"
                size={12}
                style={{
                  color: "var(--icon-idle)",
                  transform: open ? "rotate(90deg)" : "none",
                  transition: "transform var(--dur-fast) var(--ease-standard)",
                }}
              />
            )}
            <span>{title}</span>
          </button>
          {actions && <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>{actions}</div>}
        </header>
      )}
      {open && <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>{children}</div>}
    </section>
  );
}
