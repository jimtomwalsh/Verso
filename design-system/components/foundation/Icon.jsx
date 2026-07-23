import React from "react";

/**
 * Icon — renders a Lucide glyph by name.
 *
 * Verso's real editor ships its own 16px line-icon set (the "WDS Icon
 * Library"), which was not included in the provided sources. Lucide is used
 * here as the closest match: same 2px-stroke, 24-grid, rounded-cap style.
 * Swap this mapping for the real sprite when integrating.
 *
 * Requires the Lucide UMD build on `window.lucide` (load from CDN). If it is
 * not present, a neutral placeholder box is drawn so layout never breaks.
 */
export function Icon({ name, size = 16, strokeWidth = 2, color, style, ...rest }) {
  const lucide = typeof window !== "undefined" ? window.lucide : null;
  const node =
    lucide && lucide.icons
      ? lucide.icons[toPascal(name)] || lucide.icons[name]
      : null;

  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: { display: "block", flex: "none", ...style },
    "aria-hidden": true,
    ...rest,
  };

  if (!node) {
    // Fallback: soft rounded square so nothing collapses.
    return React.createElement("svg", common,
      React.createElement("rect", { x: 4, y: 4, width: 16, height: 16, rx: 3, opacity: 0.35 })
    );
  }

  // A Lucide iconNode is ["svg", attrs, [ [tag, attrs], ... ]]; children live
  // in node[2]. Older/other builds expose a flat array of child tuples — support both.
  const kids = Array.isArray(node[2])
    ? node[2]
    : Array.isArray(node) && Array.isArray(node[0])
    ? node
    : [];
  const children = kids.map((child, i) => {
    const [tag, attrs] = child;
    return React.createElement(tag, { key: i, ...attrs });
  });
  return React.createElement("svg", common, children);
}

function toPascal(name) {
  if (!name) return "";
  return String(name)
    .split(/[-_ ]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}
