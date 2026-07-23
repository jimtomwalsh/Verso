import React from "react";

export interface DocumentTabProps {
  /** Course / document name. */
  label: string;
  active?: boolean;
  onSelect?: () => void;
  onClose?: () => void;
  style?: React.CSSProperties;
}

/** A top-bar course tab. Several courses can be open at once. */
export function DocumentTab(props: DocumentTabProps): JSX.Element;
