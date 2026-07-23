import React from "react";

export interface BlockTileProps {
  /** Block type name (Heading, Image, Quiz…). */
  label: string;
  /** Leading Lucide glyph for the block type. */
  icon: string;
  selected?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export interface BlockGridProps {
  children: React.ReactNode;
  /** Fixed column count. Default 3 (fits the 248px dock). */
  columns?: number;
  style?: React.CSSProperties;
}

/** A palette block as an icon tile (icon over label) — the grid alternative to BlockPaletteItem. */
export function BlockTile(props: BlockTileProps): JSX.Element;
/** Responsive grid wrapper for BlockTiles. */
export function BlockGrid(props: BlockGridProps): JSX.Element;
