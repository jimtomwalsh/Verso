// editor/diagnostics.js -- what the app tells you about itself (arch-P3b-07u).
//
// A frame-cadence readout for pan and zoom, off by default, never shipped. It exists because
// "the canvas feels slow" is not a bug report: the HUD separates the browser's real frame rate
// from the JS this app spends per frame, so a slow pan can be blamed on the right half.
//
// The console helper beside it is the A/B for the one that was genuinely ambiguous. The world
// used to carry a permanent `will-change: transform`, and on a very large world that layer is too
// big to cache -- so promotion made it WORSE. #347 settled it by feel and dropped the declaration;
// __wc('transform') puts it back if the question ever reopens.
//
// Two names from editor.js, which is what a diagnostic should cost.
//
// Editor chrome only, and less than that: it never touches the document at all.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "world"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h;

    // ---- perf HUD (diagnostic; editor chrome, OFF by default, never ships) -------------
    // Cmd/Ctrl+Shift+F toggles a readout of the browser's real frame cadence during pan/zoom vs
    // the JS cost of applyView, so we can separate paint/composite-bound jank (frame ms >>
    // applyView-JS ms) from script-bound jank. This is how we decide whether the canvas
    // needs an architectural change (native-scroll pan / cached-layer zoom) rather than more
    // JS micro-opt. Purely diagnostic; the loop only runs while the HUD is on.
    var perfHud = null, perfOn = false, _perfRaf = 0, _perfLast = 0, _perfFrames = [], _perfMaxFrame = 0, _perfViewJs = 0, _perfViewN = 0;
    function perfTick(ts) {
      if (!perfOn) return;
      if (_perfLast) { var dt = ts - _perfLast; _perfFrames.push(dt); if (dt > _perfMaxFrame) _perfMaxFrame = dt; if (_perfFrames.length > 90) _perfFrames.shift(); }
      _perfLast = ts;
      if (!perfTick._acc || ts - perfTick._acc > 250) {
        perfTick._acc = ts;
        var n = _perfFrames.length || 1;
        var avg = _perfFrames.reduce(function (a, b) { return a + b; }, 0) / n;
        var fps = avg > 0 ? Math.round(1000 / avg) : 0;
        var vjs = _perfViewN ? (_perfViewJs / _perfViewN) : 0;
        if (perfHud) perfHud.textContent = "FPS " + fps + "   frame " + avg.toFixed(1) + "ms (max " + _perfMaxFrame.toFixed(0) + ")   applyView-JS " + vjs.toFixed(2) + "ms/" + _perfViewN;
        _perfViewJs = 0; _perfViewN = 0; _perfMaxFrame = 0;
      }
      _perfRaf = requestAnimationFrame(perfTick);
    }
    function togglePerfHud() {
      perfOn = !perfOn;
      if (perfOn) {
        if (!perfHud) { perfHud = h("div", "perf-hud"); document.body.appendChild(perfHud); }
        perfHud.hidden = false; perfHud.textContent = "perf HUD on - pan / zoom now";
        _perfLast = 0; _perfFrames = []; _perfMaxFrame = 0; _perfViewJs = 0; _perfViewN = 0;
        _perfRaf = requestAnimationFrame(perfTick);
      } else {
        if (_perfRaf) { cancelAnimationFrame(_perfRaf); _perfRaf = 0; }
        if (perfHud) perfHud.hidden = true;
      }
    }
    window.__perfHud = togglePerfHud;
    // Diagnostic A/B: the world is NOT layer-promoted (#347 removed the CSS `will-change`,
    // because on a multi-chapter course the layer is too big to GPU-cache and the browser then
    // repaints the lot every pan/zoom frame). __wc('transform') promotes it so you can FEEL the
    // difference; __wc() or __wc('auto') returns to the shipped default. Console-only helper.
    window.__wc = function (v) { if (E.world) E.world.style.willChange = v || "auto"; return E.world && (E.world.style.willChange || "(from CSS: none)"); };

    // The canvas view region measures its own JS cost per frame and hands it here; the HUD is the
    // only thing that reads it, so both the flag and the accumulator live in this file now.
    kernel.provideLive({ perfOn: function () { return perfOn; } });
    kernel.expose({
      togglePerfHud: togglePerfHud, perfTick: perfTick,
      noteViewJsSample: function (ms) { _perfViewJs += ms; _perfViewN++; }
    });
  }

  window.VersoDiagnostics = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDiagnostics;
})();
