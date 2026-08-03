import React from "react";

/**
 * Timeline — a vertical node-based activity/history trail. Each entry is a dot on a
 * connecting line with its content to the right (date, label, optional detail). The
 * caller supplies entries already ordered (newest-first is the established convention,
 * e.g. Product Rail's per-topic import/edit history).
 */
export function Timeline({ entries = [], style }) {
  return (
    <div style={{ position: "relative", paddingLeft: "2px", ...style }}>
      {entries.map((entry, i) => {
        const isLast = i === entries.length - 1;
        return (
          <div key={i} style={{ position: "relative", paddingLeft: "16px", paddingBottom: isLast ? 0 : "14px" }}>
            {!isLast && (
              <div style={{
                content: "''", position: "absolute", left: "3px", top: "12px", bottom: "-2px",
                width: "1px", background: "var(--border-subtle)",
              }} />
            )}
            <div style={{
              position: "absolute", left: 0, top: "4px", width: "7px", height: "7px",
              borderRadius: "50%", background: "var(--accent)",
            }} />
            {entry.date && (
              <div style={{
                font: "var(--type-label)", fontSize: "9px", color: "var(--text-tertiary)",
                textTransform: "uppercase", letterSpacing: "var(--tracking-caps)",
              }}>{entry.date}</div>
            )}
            {entry.label && (
              <div style={{ font: "var(--type-label)", fontSize: "12px", color: "var(--text-primary)", marginTop: "1px" }}>
                {entry.label}
              </div>
            )}
            {entry.detail && (
              <div style={{ font: "var(--type-label)", fontSize: "11px", color: "var(--text-tertiary)", marginTop: "1px" }}>
                {entry.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
