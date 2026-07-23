import React from "react";

export type Crumb = string | { label: string; onClick?: () => void };

export interface BreadcrumbProps {
  /** Selection path; last item is the current selection (emphasised). */
  items: Crumb[];
  style?: React.CSSProperties;
}

/** Inspector context line — "Page 49 › Image hotspots". */
export function Breadcrumb(props: BreadcrumbProps): JSX.Element;
