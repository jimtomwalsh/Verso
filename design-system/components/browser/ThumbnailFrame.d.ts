import React from "react";

export interface ThumbnailFrameProps {
  /** The pre-scaled live-DOM preview node (a `transform: scale()`d render of page 1). */
  children?: React.ReactNode;
  /** CSS aspect-ratio for the frame. Default "4 / 3" (landscape course page). */
  ratio?: string;
  /** Force the empty/placeholder state even if children are present. */
  empty?: boolean;
  style?: React.CSSProperties;
}

/** Fixed-aspect frame that clips + centres a live scaled-DOM course thumbnail, with an empty state. */
export function ThumbnailFrame(props: ThumbnailFrameProps): JSX.Element;
