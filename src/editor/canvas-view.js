// editor/canvas-view.js -- where the canvas is looking (arch-P3-07).
//
// Pan, zoom and fit are four formulas and a lot of DOM. The formulas decide what the author sees:
// which zoom a fit lands on, where the world sits after it, and how far the world has to translate
// to keep the point under the cursor still while scaling. The DOM part -- writing the transform,
// driving scroll, sizing the scroll sizer -- is bookkeeping around them.
//
// The formulas had no test, and they are the kind that go wrong quietly: an off-by-one on a pad,
// a label height counted twice, a clamp on the wrong side. Nothing throws; the canvas just sits
// slightly wrong, and "slightly wrong" is hard to notice and harder to bisect.
//
// So the maths is here, taking plain numbers and returning a plain view {zoom, x, y}, and
// editor.js applies it. Every one of these was lifted verbatim -- including the asymmetries, which
// are load-bearing and now have a comment saying so:
//   · fitWorld pads by 90, fitRect by 70, focusRect by 140/180. Different jobs, different framing.
//   · fitWorld's zoom accounts for the frame LABEL above each page, but its vertical centring does
//     not -- it offsets by half a label instead, which is what keeps a fitted board optically
//     centred rather than mathematically centred and visually low.
//   · every fit clamps to 5%-100%. The canvas never zooms past 1:1, so a fit can shrink to show
//     everything but never magnifies a small course to fill the window.
//
// Pure: no DOM, no store.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  var ZOOM = { MIN: 0.05, MAX: 1 };
  var PAD = { WORLD: 90, RECT: 70, FOCUS_X: 140, FOCUS_Y: 180 };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clampZoom(z) { return clamp(z, ZOOM.MIN, ZOOM.MAX); }

  // Fit an arbitrary world rectangle (a chapter column, a page) into the viewport, centred.
  // viewport = { width, height }; target = { x, y, w, h }.
  function fitRect(viewport, target, pad) {
    var p = pad == null ? PAD.RECT : pad;
    var z = clampZoom(Math.min((viewport.width - p * 2) / target.w, (viewport.height - p * 2) / target.h));
    return {
      zoom: z,
      x: (viewport.width - target.w * z) / 2 - target.x * z,
      y: (viewport.height - target.h * z) / 2 - target.y * z
    };
  }
  // Fit the WHOLE board. The zoom accounts for the frame label above the top row; the vertical
  // centring deliberately does not, offsetting by half a scaled label instead -- see the header.
  function fitWorld(viewport, world, labelH, pad) {
    var p = pad == null ? PAD.WORLD : pad;
    var lh = labelH || 0;
    var z = clampZoom(Math.min((viewport.width - p * 2) / world.w, (viewport.height - p * 2) / (world.h + lh)));
    return {
      zoom: z,
      x: (viewport.width - world.w * z) / 2,
      y: (viewport.height - world.h * z) / 2 + lh * z * 0.5
    };
  }
  // Centre one page frame. Tighter margins than a fit, because focusing a page means filling the
  // window with it. frame = { x, y, w, h }.
  function focusRect(viewport, frame, labelH) {
    var lh = labelH || 0;
    var z = clampZoom(Math.min((viewport.width - PAD.FOCUS_X) / frame.w, (viewport.height - PAD.FOCUS_Y) / frame.h));
    return {
      zoom: z,
      x: viewport.width / 2 - (frame.x + frame.w / 2) * z,
      y: viewport.height / 2 - (frame.y + lh + frame.h / 2) * z
    };
  }

  // ---- anchored zoom -------------------------------------------------------
  // Scaling about a point the cursor is over, WITHOUT moving scroll mid-gesture: translate the
  // world by anchorWorld * (base - z). At z === base the translation is zero, so a gesture that
  // returns to where it started leaves the world exactly where it was.
  function zoomTranslate(baseZoom, z, anchor) {
    if (!anchor) return { tx: 0, ty: 0 };
    return { tx: anchor.wx * (baseZoom - z), ty: anchor.wy * (baseZoom - z) };
  }
  // Bake a finished gesture: fold the transient translate into the scroll offsets so the crisp
  // re-render lands in the SAME place. canvas-local (PAD + wp*z) - (sl - tx) is the same point as
  // (PAD + tx + wp*z) - sl, which is why this is a subtraction and not a second transform.
  function bakeView(scrollPad, scroll, translate) {
    return {
      x: scrollPad - (scroll.left - translate.tx),
      y: scrollPad - (scroll.top - translate.ty)
    };
  }

  // ---- the zoom-fit button's cycle ----------------------------------------
  // One control, three framings, in order of how much they show: the page you are on, its chapter
  // column, then the whole board. The stored mode starts at 2 so the FIRST click lands on page.
  var FIT_MODES = ["page", "chapter", "world"];
  function nextFitMode(mode) { return ((mode == null ? 2 : mode) + 1) % FIT_MODES.length; }
  function fitModeName(mode) { return FIT_MODES[((mode % FIT_MODES.length) + FIT_MODES.length) % FIT_MODES.length]; }

  // ---- the alignment grid --------------------------------------------------
  var GRID_MODES = ["off", "thirds", "quarters", "columns", "fine"];
  var GRID_LABELS = { off: "off", thirds: "rule of thirds", quarters: "quarters", columns: "12-col", fine: "fine" };
  function nextGridMode(mode) {
    var i = GRID_MODES.indexOf(mode);
    return GRID_MODES[(i < 0 ? 0 : i + 1) % GRID_MODES.length];
  }
  // A stored value that is no longer a mode (an older build, a hand-edited preference) reads as
  // off rather than leaving the grid in a state nothing can cycle out of.
  function readGridMode(stored) { return GRID_MODES.indexOf(stored) >= 0 ? stored : "off"; }

  var VersoCanvasView = {
    ZOOM: ZOOM,
    PAD: PAD,
    clampZoom: clampZoom,
    fitRect: fitRect,
    fitWorld: fitWorld,
    focusRect: focusRect,
    zoomTranslate: zoomTranslate,
    bakeView: bakeView,
    FIT_MODES: FIT_MODES,
    nextFitMode: nextFitMode,
    fitModeName: fitModeName,
    GRID_MODES: GRID_MODES,
    GRID_LABELS: GRID_LABELS,
    nextGridMode: nextGridMode,
    readGridMode: readGridMode
  };

  window.VersoCanvasView = VersoCanvasView;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoCanvasView;
})();
