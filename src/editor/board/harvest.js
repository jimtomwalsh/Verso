// editor/board/harvest.js -- the source-video segment model behind the tour builder (arch-P3-06).
//
// The tour builder harvests screens out of a screen recording: mark an in and an out point, cut
// ranges out of the middle, set a playback rate, crop the frame. Every one of those is arithmetic
// on times and rectangles, and all of it lived inside the board's 2,000-line DOM region behind a
// comment fence that tests/run.js sliced out and re-animated with `new Function` -- twice, from two
// different sections, because two suites needed the same twelve functions.
//
// It is arithmetic. It belongs in a file you can require.
//
// THE RULES THE MATH KEEPS, and why none of them is obvious:
//   · a mark that would cross the other end DROPS that end rather than silently reordering, so an
//     out before the in can never produce a negative segment;
//   · cuts merge on overlap AND on adjacency, so two cuts that meet exactly become one range
//     instead of two the ripple would have to special-case;
//   · cuts are clipped to the in/out bounds, so moving an end never leaves a cut floating outside
//     the segment it was made in;
//   · the kept ranges are what actually ships, and the net length is their sum -- not out minus in,
//     which is the number the author would otherwise be shown for a segment with cuts in it.
//
// Pure: no DOM, no clock, no store. Times are seconds; crops are normalised 0-1 rectangles.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function tourFormatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  // Marking an in/out point at time t. Keep 0 <= in < out; a mark that would cross the
  // other end DROPS that other end (it's no longer valid) rather than silently reordering.
  // cur = { in, out } (either may be null/undefined). Returns a fresh { in, out }.
  function tourApplyMark(kind, t, cur) {
    cur = cur || {};
    var inP = (cur.in == null) ? null : cur.in, outP = (cur.out == null) ? null : cur.out;
    if (kind === "in") { inP = t; if (outP != null && outP <= t) outP = null; }
    else { outP = t; if (inP != null && inP >= t) inP = null; }
    return { in: inP, out: outP };
  }
  // Resolve a normalised crop {x,y,w,h} (0-1 fractions of the source) against the video's
  // natural pixels -> a source rect {sx,sy,sw,sh} and the output {w,h}. Clamped in-bounds
  // with a 1% min so a harvest is never zero-sized. No crop -> the full frame.
  function tourCropRect(crop, natW, natH) {
    var c = crop || { x: 0, y: 0, w: 1, h: 1 };
    var x = Math.max(0, Math.min(1, c.x == null ? 0 : c.x));
    var y = Math.max(0, Math.min(1, c.y == null ? 0 : c.y));
    var w = Math.max(0.01, Math.min(1 - x, c.w == null ? 1 : c.w));
    var hh = Math.max(0.01, Math.min(1 - y, c.h == null ? 1 : c.h));
    var sw = Math.max(1, Math.round(w * natW)), sh = Math.max(1, Math.round(hh * natH));
    return { sx: Math.round(x * natW), sy: Math.round(y * natH), sw: sw, sh: sh, w: sw, h: sh };
  }
  // A segment is harvestable only when both ends are marked and the NET kept length is > 0
  // (cuts may punch the middle out; a cut swallowing the whole clip -> not ready). cuts optional.
  function tourSegReady(inP, outP, cuts) { return inP != null && outP != null && tourNetLength(inP, outP, cuts) > 0; }
  // Speed preset -> the value to persist on provenance. 1x (or invalid) is the default and stores
  // as NO field (clean provenance, ignored by render like bx/by); any other rate stores the number.
  function tourSpeedField(speed) { var n = parseFloat(speed); return (n && n !== 1 && isFinite(n)) ? n : null; }

  // ---- Ripple cuts (T1): pure model + logic ---------------------------------
  // A segment is [in,out] with zero or more removed CUT ranges punched out of the middle;
  // the kept clip is [in,out] minus the cuts, its pieces stitched. All helpers are pure +
  // side-effect-free (mirror tourApplyMark) — no DOM, no bake, no provenance here.

  // Commit a pending cut: given a pending cut-in and the playhead t, form the removed range.
  // Mirrors the outer-mark crossing guard — a cut-out at/before the cut-in is invalid -> null
  // (the caller keeps the pending open or cancels). `cuts` is accepted for call-site parity with
  // tourApplyMark; committing/merging into the list is the caller's separate step (tourMergeCuts).
  function tourApplyCut(pending, t, cuts) {
    if (pending == null || t == null) return null;
    if (!(t > pending)) return null; // cut-out must land strictly after cut-in
    return { start: pending, end: t };
  }
  // Sort ascending by start and auto-merge overlapping OR adjacent ranges (end === next.start)
  // into a clean, non-overlapping list so the rail reads as one band per removed region.
  function tourMergeCuts(cuts) {
    var list = (cuts || []).filter(function (c) { return c && c.end > c.start; })
      .map(function (c) { return { start: c.start, end: c.end }; })
      .sort(function (a, b) { return a.start - b.start; });
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i], last = out[out.length - 1];
      if (last && c.start <= last.end) { if (c.end > last.end) last.end = c.end; }
      else out.push(c);
    }
    return out;
  }
  // Drop cuts fully outside [in,out]; trim cuts that straddle a bound. Called when in/out moves.
  // Returns a merged, in-bounds list.
  function tourClipCutsToBounds(cuts, inP, outP) {
    if (inP == null || outP == null || !(outP > inP)) return [];
    var trimmed = [];
    (cuts || []).forEach(function (c) {
      if (!c || !(c.end > c.start)) return;
      var s = Math.max(inP, c.start), e = Math.min(outP, c.end);
      if (e > s) trimmed.push({ start: s, end: e });
    });
    return tourMergeCuts(trimmed);
  }
  // Decompose [in,out] minus the cuts into the surviving kept pieces, in order. Returns
  // [{in,out}...] (same shape as an outer segment) so the stitched bake (T2) can walk them.
  function tourKeptRanges(inP, outP, cuts) {
    if (inP == null || outP == null || !(outP > inP)) return [];
    var cs = tourClipCutsToBounds(cuts, inP, outP), ranges = [], cursor = inP;
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].start > cursor) ranges.push({ in: cursor, out: cs[i].start });
      cursor = Math.max(cursor, cs[i].end);
    }
    if (cursor < outP) ranges.push({ in: cursor, out: outP });
    return ranges;
  }
  // Net kept length = sum of kept ranges (drives the readout + the ＋Segment bake gate).
  function tourNetLength(inP, outP, cuts) {
    return tourKeptRanges(inP, outP, cuts).reduce(function (n, r) { return n + (r.out - r.in); }, 0);
  }
  var VersoHarvest = {
    formatTime: tourFormatTime,
    applyMark: tourApplyMark,
    cropRect: tourCropRect,
    segReady: tourSegReady,
    speedField: tourSpeedField,
    applyCut: tourApplyCut,
    mergeCuts: tourMergeCuts,
    clipCutsToBounds: tourClipCutsToBounds,
    keptRanges: tourKeptRanges,
    netLength: tourNetLength
  };

  window.VersoHarvest = VersoHarvest;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoHarvest;
})();
