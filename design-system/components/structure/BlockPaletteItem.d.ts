import React from "react";

export interface BlockPaletteItemProps {
  /** Block type name (Heading, Image, Quiz, Card Reveal…). */
  label: string;
  /** Leading Lucide glyph for the block type. */
  icon: string;
  draggable?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** An entry in the Blocks palette — click or drag to insert a block. */
export function BlockPaletteItem(props: BlockPaletteItemProps): JSX.Element;
