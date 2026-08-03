import React from "react";

export interface MeterProps {
  /** The fact being measured, e.g. "Alignment". Always visible — a bar with no name is a mystery. */
  label: string;
  /**
   * 0–100. Null/undefined is the NOT-INDEXED state: the track renders empty (dashed) and the
   * value reads as words — a measurement that could not be taken, never a 0% score.
   */
  pct?: number | null;
  /** Band tone from the caller's one band scale: success (top band) · warning (middle) · neutral (bottom). */
  tone?: "success" | "warning" | "neutral";
  /** Value text beside the track, e.g. "78%". Defaults to `${pct}%`, or "Not indexed" when pct is null. */
  value?: string;
  /** The band's name ("Verified" · "Mixed" · "Mostly novel"), spoken in the aria-label so colour is never the only carrier. */
  bandLabel?: string;
  style?: React.CSSProperties;
}

/**
 * Labelled, banded percentage meter — label · track · value. For a fact that EXPLAINS a number
 * (Publish's alignment %). The band tone colours the fill and the value ink, exactly the quiet
 * Badge's tone-as-ink move, so the meter reads as kin to the fact badges beside it.
 */
export function Meter(props: MeterProps): JSX.Element;
