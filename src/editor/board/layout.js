// editor/board/layout.js -- where things sit on the tour builder's board (arch-P3-06).
//
// The tour builder is a 2D board of screen nodes, loop frames and the wires between them. Its
// geometry is arithmetic: how wide a loop frame has to be for N members, where member i sits inside
// it, whether a point is inside a rectangle, and what a "tidy" arrangement of the free nodes looks
// like. None of it had a test, because all of it was closure-local inside 2,000 lines of DOM.
//
// That matters more here than the line count suggests. These coordinates are AUTHOR DATA: they
// persist on screens[].bx/by and loops[].bx/by, they survive in the saved document, and render()
// deliberately ignores them so the board can exist without making render impure. A layout bug does
// not throw -- it quietly moves the author's arrangement, and the only way to notice is to look.
//
// So the planning is separated from the doing. tidyPlan() takes the screens, the loops and what is
// selected, and RETURNS the coordinates it would set. editor.js applies them, pushes history and
// repaints. The plan is a value, so the suite can assert the arrangement without a board, and the
// rules that were only ever implied by the code -- selected nodes tidy in place from their own
// top-left, an unselected tidy also stacks the loop frames below the grid, loop members are never
// moved directly because their frame owns their slots -- are each one assertion.
//
// Pure: no DOM, no store, no history. Board pixels throughout.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // Board-space node metrics. The thumb is 16:9 and deliberately large: pin placement is done by
  // eye on this board, so a small thumb makes precise placement impossible (#224 QA).
  var METRICS = {
    NODE_W: 300,
    THUMB_H: 169,
    NOMINAL_W: 1280,        // assumed learner screen width, for scaling fixed-px point markers
    SOURCE_W: 440,          // the source-video scratch node is the harvest surface, so it is bigger
    SOURCE_H: 248
  };
  METRICS.NODE_H = METRICS.THUMB_H + 44;   // thumb + title, for marquee hit-testing

  // Loop-frame geometry. A frame owns its members' grid and auto-fits to them.
  var LOOP = { PAD: 20, HEADER: 34, GAP: 22, COLS_MAX: 4 };
  LOOP.CELL_H = METRICS.NODE_H + 24;
  LOOP.MIN_W = METRICS.NODE_W + LOOP.PAD * 2;
  LOOP.EMPTY_H = LOOP.HEADER + LOOP.PAD * 2 + 90;

  // Free-node tidy grid: the spacing a tidied board uses.
  var TIDY = { PER_ROW: 4, ORIGIN_X: 80, ORIGIN_Y: 60, LOOP_GAP_Y: 60, GRID_GAP_Y: 40 };
  TIDY.GAP_X = METRICS.NODE_W + 90;
  TIDY.GAP_Y = METRICS.THUMB_H + 130;
  TIDY.BAND = METRICS.THUMB_H + 60;        // row-banding tolerance when reading the current order

  function loopCols(n) { return Math.max(1, Math.min(LOOP.COLS_MAX, n || 1)); }
  // Auto-fit size (board px) for a loop's member grid plus its header. Members lay out row-major.
  function loopSize(loop) {
    var n = ((loop && loop.screens) || []).length;
    if (!n) return { w: LOOP.MIN_W, h: LOOP.EMPTY_H };
    var cols = loopCols(n), rows = Math.ceil(n / cols);
    return { w: LOOP.PAD * 2 + cols * METRICS.NODE_W + (cols - 1) * LOOP.GAP,
             h: LOOP.HEADER + LOOP.PAD * 2 + rows * LOOP.CELL_H + (rows - 1) * LOOP.GAP };
  }
  // Board-space top-left of the member at grid index idx within loop.
  function loopSlotPos(loop, idx) {
    var cols = loopCols(((loop && loop.screens) || []).length);
    var col = idx % cols, row = Math.floor(idx / cols);
    return { x: ((loop && loop.bx) || 0) + LOOP.PAD + col * (METRICS.NODE_W + LOOP.GAP),
             y: ((loop && loop.by) || 0) + LOOP.HEADER + LOOP.PAD + row * (LOOP.CELL_H + LOOP.GAP) };
  }
  function loopRect(loop) {
    var sz = loopSize(loop);
    return { x: (loop && loop.bx) || 0, y: (loop && loop.by) || 0, w: sz.w, h: sz.h };
  }
  function ptInRect(px, py, r) { return !!r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
  // Which loop claims a screen, if any. A screen belongs to at most one (normalizeHotspotLoops
  // enforces that), so the first hit is the answer.
  function loopOfScreen(loops, sid) {
    var ls = loops || [];
    for (var i = 0; i < ls.length; i++) if (ls[i] && (ls[i].screens || []).indexOf(sid) >= 0) return ls[i];
    return null;
  }
  // Every loop member's screen id -> its slot top-left, so the renderer positions members inside
  // their frame rather than at their own bx/by. Non-members keep using bx/by.
  function memberSlots(loops) {
    var map = {};
    (loops || []).forEach(function (loop) {
      ((loop && loop.screens) || []).forEach(function (sid, i) { map[sid] = loopSlotPos(loop, i); });
    });
    return map;
  }

  // Any screen missing board coords gets a grid slot, so an old block -- or one authored purely
  // inline, before the board existed -- lays out sensibly the first time the board opens. Already
  // placed nodes are never moved; blanks fill the cells after them.
  function autoLayoutCoords(screens) {
    var ss = screens || [], placed = 0;
    ss.forEach(function (s) { if (s && typeof s.bx === "number" && typeof s.by === "number") placed++; });
    var start = placed;
    ss.forEach(function (s) {
      if (!s || (typeof s.bx === "number" && typeof s.by === "number")) return;
      var idx = start++;
      s.bx = TIDY.ORIGIN_X + (idx % TIDY.PER_ROW) * TIDY.GAP_X;
      s.by = TIDY.ORIGIN_Y + Math.floor(idx / TIDY.PER_ROW) * TIDY.GAP_Y;
    });
    return ss;
  }

  // THE TIDY PLAN. Snap the free (non-member) screen nodes into a clean grid in their CURRENT
  // rough reading order -- row-banded by y, then x -- so the author's general arrangement survives
  // while overlap and drift do not.
  //
  // Returns { screens: [{id,bx,by}], loops: [{id,bx,by}], selecting } and mutates nothing.
  //   · With ids selected, ONLY those tidy, anchored at their own current top-left, so tidying a
  //     cluster does not drag it to the origin.
  //   · With nothing selected the whole board tidies from the board origin, and the loop frames
  //     stack below the grid -- which only makes sense for a whole-board pass, so a selected tidy
  //     leaves them alone.
  //   · Loop MEMBERS are never in the plan. Their frame owns their slots; moving one directly
  //     would put it somewhere its frame does not agree with.
  function tidyPlan(screens, loops, selectedIds) {
    var all = (screens || []).filter(function (s) { return s && !loopOfScreen(loops, s.id); });
    var sel = selectedIds || [];
    var selecting = sel.length > 0;
    var subset = selecting ? all.filter(function (s) { return sel.indexOf(s.id) >= 0; }) : all;
    if (!subset.length) return { screens: [], loops: [], selecting: selecting };

    var x0 = selecting ? Math.min.apply(null, subset.map(function (s) { return s.bx || 0; })) : TIDY.ORIGIN_X;
    var y0 = selecting ? Math.min.apply(null, subset.map(function (s) { return s.by || 0; })) : TIDY.ORIGIN_Y;
    var ordered = subset.slice().sort(function (a, b) {
      var ra = Math.round((a.by || 0) / TIDY.BAND), rb = Math.round((b.by || 0) / TIDY.BAND);
      return ra !== rb ? ra - rb : (a.bx || 0) - (b.bx || 0);
    });
    var out = ordered.map(function (s, i) {
      return { id: s.id,
               bx: x0 + (i % TIDY.PER_ROW) * TIDY.GAP_X,
               by: y0 + Math.floor(i / TIDY.PER_ROW) * TIDY.GAP_Y };
    });

    var loopMoves = [];
    if (!selecting) {
      var ly = y0 + (Math.ceil(ordered.length / TIDY.PER_ROW) || 0) * TIDY.GAP_Y + TIDY.GRID_GAP_Y;
      (loops || []).slice().sort(function (a, b) {
        return ((a && a.by) || 0) - ((b && b.by) || 0) || ((a && a.bx) || 0) - ((b && b.bx) || 0);
      }).forEach(function (loop) {
        loopMoves.push({ id: loop.id, bx: x0, by: ly });
        ly += loopSize(loop).h + TIDY.LOOP_GAP_Y;
      });
    }
    return { screens: out, loops: loopMoves, selecting: selecting };
  }
  // Write a plan onto the live screens and loops. Separated from tidyPlan so the arrangement can be
  // asserted as a value, and so the caller owns history and the repaint.
  function applyTidyPlan(plan, screens, loops) {
    var byId = {};
    (screens || []).forEach(function (s) { if (s && s.id) byId[s.id] = s; });
    (plan && plan.screens || []).forEach(function (m) { if (byId[m.id]) { byId[m.id].bx = m.bx; byId[m.id].by = m.by; } });
    var loopById = {};
    (loops || []).forEach(function (l) { if (l && l.id) loopById[l.id] = l; });
    (plan && plan.loops || []).forEach(function (m) { if (loopById[m.id]) { loopById[m.id].bx = m.bx; loopById[m.id].by = m.by; } });
    return plan;
  }

  var VersoBoardLayout = {
    METRICS: METRICS,
    LOOP: LOOP,
    TIDY: TIDY,
    loopCols: loopCols,
    loopSize: loopSize,
    loopSlotPos: loopSlotPos,
    loopRect: loopRect,
    ptInRect: ptInRect,
    loopOfScreen: loopOfScreen,
    memberSlots: memberSlots,
    autoLayoutCoords: autoLayoutCoords,
    tidyPlan: tidyPlan,
    applyTidyPlan: applyTidyPlan
  };

  window.VersoBoardLayout = VersoBoardLayout;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoBoardLayout;
})();
