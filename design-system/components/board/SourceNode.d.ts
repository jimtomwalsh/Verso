import React from "react";

export interface MediaTransportProps {
  /** Current playhead time (seconds). */
  time: number;
  /** Media duration (seconds). */
  duration: number;
  /** Segment in/out points (seconds), if marked. Enforced in < out. */
  inPoint?: number;
  outPoint?: number;
  playing?: boolean;
  /** Fires continuously while scrubbing (click-rail or drag-knob) — live feedback. */
  onSeek?: (time: number) => void;
  onPlayToggle?: () => void;
  /** Mark the current playhead as the segment start / end. */
  onSetIn?: () => void;
  onSetOut?: () => void;
}

/**
 * MediaTransport — the scrub/playhead pattern the canonical control set lacks. A
 * two-row strip: a thin scrub rail (`--border-subtle`) with an `--accent` fill and a
 * draggable knob (`--accent` + `--shadow-100`), in/out bracket ticks tinting the
 * selected range; and a controls row with a play/pause `IconButton` (`--control-sm`),
 * a monospace `current / duration` readout (`--text-secondary`, tabular-nums), and
 * Set-in / Set-out buttons. Click-to-seek + drag-to-scrub with continuous `onSeek`;
 * only one instance plays at a time. Editor chrome only.
 */
export function MediaTransport(props: MediaTransportProps): JSX.Element;

export interface SourceNodeProps {
  /** Board coords (pixels). Persisted (`sources[].bx/by`); drag updates them. */
  x: number;
  y: number;
  /** `ThumbnailFrame` of the source video + the `MediaTransport` strip. */
  children?: React.ReactNode;
  /** Inline-editable source title. */
  title?: string;
  onTitleChange?: (title: string) => void;
  onMove?: (x: number, y: number) => void;
  /** Remove the source (destructive; confirmed via `Modal`). Harvested screens are kept. */
  onRemove?: () => void;
  style?: React.CSSProperties;
}

/**
 * SourceNode — an author-time source video on the `GraphBoard`: a scratch harvest
 * surface, NOT a screen that ships. Sibling to `ScreenNode` (same card tokens, inline
 * rename, drag-to-reposition) distinguished by an accent "Source" tag. Hosts a
 * `MediaTransport` for scrubbing + marking in/out; later grows harvest actions
 * (screenshot at playhead → image screen, segment between in/out → video screen).
 * Lives on `hotspot.sources[]`, excluded from render/export (the `sources` container
 * is skipped by the media walk) but persisted for re-harvesting. Editor chrome only.
 */
export function SourceNode(props: SourceNodeProps): JSX.Element;
