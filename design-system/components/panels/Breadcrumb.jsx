import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * Breadcrumb — the inspector context line ("Page 49 › Image hotspots"). Shows
 * the selection path; the last crumb is the current selection (emphasised).
 */
export function Breadcrumb({ items = [], style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        height: "28px",
        padding: "0 var(--section-pad)",
        font: "var(--type-label)",
        color: "var(--text-tertiary)",
        overflow: "hidden",
        ...style,
      }}
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            <span
              style={{
                color: last ? "var(--text-primary)" : "var(--text-tertiary)",
                fontWeight: last ? "var(--weight-medium)" : "var(--weight-regular)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                cursor: item.onClick ? "pointer" : "default",
              }}
              onClick={item.onClick}
            >
              {typeof item === "string" ? item : item.label}
            </span>
            {!last && <Icon name="chevron-right" size={12} style={{ color: "var(--icon-idle)", flex: "none" }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
