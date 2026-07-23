import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Icon name (kebab or PascalCase), resolved against the Lucide set. */
  name: string;
  /** Pixel size (width = height). Default 16 — the Verso chrome default. */
  size?: number;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /** Override stroke colour (defaults to currentColor). */
  color?: string;
}

/**
 * Renders a line icon by name. Substitutes Lucide for Verso's in-house 16px
 * icon set (same stroke weight / rounded caps); requires window.lucide.
 */
export function Icon(props: IconProps): JSX.Element;
