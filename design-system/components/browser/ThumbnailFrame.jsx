import React from "react";
import { Icon } from "../foundation/Icon.jsx";

/**
 * ThumbnailFrame — a fixed-aspect frame that holds a *live scaled-DOM* preview of
 * a course's first page (the file browser's thumbnail strategy: no rasteriser, the
 * frame simply clips + centres a `transform: scale()`d render of page 1). The
 * consumer passes the already-scaled preview node as `children`; this component
 * owns only the frame (aspect ratio, clip, hairline, canvas background) and the
 * empty/placeholder state. Default ratio matches a landscape course page.
 */
export function ThumbnailFrame({ children, ratio = "4 / 3", empty = false, style }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: ratio,
        overflow: "hidden",
        background: "var(--surface-canvas)",
        borderRadius: "var(--radius-md) var(--radius-md) 0 0",
        boxShadow: "inset 0 0 0 1px var(--border-subtle)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        ...style,
      }}
    >
      {empty || !children ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--icon-idle)",
          }}
        >
          <Icon name="file" size={24} />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
