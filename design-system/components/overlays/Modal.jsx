import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * Modal — the canonical dialog shell that replaced raw window.prompt/confirm
 * (D7). Centered card on a scrim: title, optional description, body, and a
 * right-aligned footer of actions. Compose an IconField for the prompt-modal
 * pattern; a message + Cancel/Confirm buttons for the confirm-modal pattern.
 */
export function Modal({
  title,
  description,
  children,
  footer,
  width = 380,
  onClose,
  style,
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--alpha-scrim)",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--surface-raised)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-modal)",
          color: "var(--text-primary)",
          overflow: "hidden",
          ...style,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            padding: "16px 16px 0",
          }}
        >
          <div>
            <div style={{ font: "var(--type-modal-title)" }}>{title}</div>
            {description && (
              <div style={{ font: "var(--type-label)", color: "var(--text-secondary)", marginTop: "4px" }}>
                {description}
              </div>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: "none",
                border: "none",
                background: "transparent",
                color: "var(--icon-idle)",
                cursor: "pointer",
                padding: "2px",
                borderRadius: "var(--radius-xs)",
              }}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </header>
        {children && <div style={{ padding: "16px" }}>{children}</div>}
        {footer && (
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 16px 16px" }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
