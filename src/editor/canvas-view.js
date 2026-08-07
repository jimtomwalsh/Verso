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

  // ==== the region (arch-P3b-02) ==========================================
  //
  // Everything above is the maths P3-07 lifted out of editor.js. This is the rest of the region --
  // the ~300 lines that APPLY it: the transform write, the eased zoom and its compositor
  // counterpart, the native-scroll pan, the WKWebView snapshot proxy, and the four fit/focus
  // drivers. P3 left all of it behind on the belief that DOM code cannot be tested. tests/_editor.js
  // boots the whole editor in the VM tier, so it can be, and this is the first region moved on that
  // basis -- the template the remaining P3b tickets follow.
  //
  // WHAT STAYED, AND WHY. `view`, `world`, `canvas`, `currentPage`, `frameDescs`, `framePos` and the
  // frame geometry are read from roughly 250 places across editor.js -- selection, marquee, drag,
  // comment pins, the outliner. They are shared state, not this region's private state, and pulling
  // them here would have moved a seam rather than removed one. They arrive through the namespace,
  // and the five that a rebuild REPLACES (world, worldH, frameDescs, framePos, numCols) arrive as
  // live getters, because buildWorld reassigns every one of them and a captured reference would
  // leave this file animating the previous world.
  //
  // Lifted verbatim, including two things that look like slips and are not:
  //   · zoom in is `* 1.25` and zoom out is `/ 1.25`. Not the same number in floating point, and
  //     they are what makes in-then-out return to exactly where you started.
  //   · applyView reconciles view.x/y BACK off the scroll offset the browser actually accepted,
  //     after writing it. The browser clamps scroll at the ends; skipping the read-back is how the
  //     view and the scrollbar drift apart at the edge of a large course.
  //
  // install(kernel) is called once, by editor.js, after it has provided its host surface. The
  // kernel is passed IN rather than read off window: under a bare require each module gets its own
  // window stand-in, so a cross-module global reads undefined -- in the tests only, which is the
  // worst place for a difference to live (dnd.js hit exactly this).
  function install(kernel) {
    var E = kernel.need(
      "canvas", "world", "view", "worldH", "frameDescs", "framePos", "numCols",
      "currentPage", "setCurrentPage", "zoomLevelEl",
      "colX", "frameX", "frameY", "FRAME_W", "FRAME_H", "LABEL_H",
      "clamp", "h", "persistView", "renderCommentPins", "perfOn", "noteViewJs"
    );

    // eased zoom (smooths chunky mouse-wheel deltas; lower ZOOM_SENS = gentler).
    // ~1.8x faster than the original for a snappier trackpad feel; the rAF ease
    // (zoomStep) keeps it smooth despite the higher gain.
    var ZOOM_SENS = 0.008; // trackpad zoom gain (James: responsive trackpad feel). Tunable.
    // Perf (#172): below this zoom the whole multi-page world is on-screen and body text is a
    // sub-pixel smudge; while a gesture is in motion we drop the page CONTENT paint (see the
    // .world--far CSS) so the compositor only moves the plain frame boxes. Tunable in one place.
    var FAR_ZOOM = 0.5;

    // Perf (#151): native-snapshot gesture proxy. Replaces the "content disappears while moving"
    // LOD (#150 media cull / #172 plain-page cull) with a REAL cached bitmap of the page. In the
    // packaged WKWebView app `window.webkit.messageHandlers.nativeSnapshot` rasterises a screen
    // rect (real fonts, no taint -- the SVG-foreignObject route can't load @font-face in image
    // mode); we show that bitmap over the viewport while pan/zooming so the compositor scales ONE
    // texture instead of re-rasterising the whole multi-page DOM each frame, then swap back to the
    // live DOM on settle. Feature-detected: no bridge (a plain browser) -> the CSS LOD still runs.
    // Editor chrome only -- render()/doc/export never learn about it.
    var _snapReq = 0, _snapPending = {};
    window.__nativeSnapshotReply = function (reqId, dataUrl) {
      var res = _snapPending[reqId]; if (!res) return; delete _snapPending[reqId]; res(dataUrl || null);
    };
    function hasNativeSnapshot() {
      return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeSnapshot);
    }
    function nativeSnapshot(rect) {
      if (!hasNativeSnapshot()) return Promise.resolve(null);
      var reqId = "s" + (++_snapReq);
      return new Promise(function (resolve) {
        _snapPending[reqId] = resolve;
        try { window.webkit.messageHandlers.nativeSnapshot.postMessage({ reqId: reqId, x: rect.x, y: rect.y, w: rect.w, h: rect.h }); }
        catch (e) { delete _snapPending[reqId]; resolve(null); return; }
        setTimeout(function () { if (_snapPending[reqId]) { delete _snapPending[reqId]; resolve(null); } }, 1000); // watchdog
      });
    }
    window.__nativeSnapshot = nativeSnapshot; // explicit API + headless test seam

    // The proxy overlay lives in `canvas` (the clip viewport), a SIBLING of `world`, so hiding the
    // live world doesn't hide it. Affine tracking: a screen pixel captured at gesture start maps to
    // s = A*s0 + B where A = zoom/startZoom and B = view.xy - startXY*A (canvas-local coords).
    // Default OFF: WKWebView's takeSnapshot proved flaky in the packaged app (returned a BLACK
    // frame + flickered on a large course). Kept behind a runtime flag for an opt-in retry once the
    // snapshot is fixed (afterScreenUpdates + onload-gated hide, below); OFF falls back to the
    // #172/#150 CSS LOD. Toggle from the console: window.__canvasProxy(true|false).
    var CANVAS_PROXY = false;
    window.__canvasProxy = function (on) { CANVAS_PROXY = !!on; if (!CANVAS_PROXY) proxyEnd(); return CANVAS_PROXY; };
    var _proxy = { epoch: 0, img: null, pending: false, sx: 0, sy: 0, sz: 1 };
    function proxyActive() { return !!_proxy.img; }
    function proxyBegin() {
      // Only where the live path is worst + where the LOD would otherwise blank content (far zoom),
      // and only when the native rasteriser exists. Re-entrancy guard: skip while a snapshot is
      // already installed (active) or in flight (pending) -- markNavigating fires every motion frame.
      if (!CANVAS_PROXY || proxyActive() || _proxy.pending || !E.world || !E.canvas) return;
      if (!(E.view.zoom < FAR_ZOOM) || !hasNativeSnapshot()) return;
      var r = E.canvas.getBoundingClientRect();
      var epoch = ++_proxy.epoch;
      _proxy.pending = true;
      _proxy.sx = E.view.x; _proxy.sy = E.view.y; _proxy.sz = E.view.zoom;
      nativeSnapshot({ x: r.left, y: r.top, w: r.width, h: r.height }).then(function (dataUrl) {
        if (epoch !== _proxy.epoch) { _proxy.pending = false; return; } // superseded by settle/new gesture
        _proxy.pending = false;
        if (!dataUrl) return; // failed snapshot -> leave the live DOM up (CSS LOD covers this gesture)
        var img = document.createElement("img");
        img.className = "canvas-proxy";
        img.style.cssText = "position:absolute;left:0;top:0;width:" + r.width + "px;height:" + r.height +
          "px;transform-origin:0 0;pointer-events:none;z-index:20;";
        // Only hide the live world ONCE the bitmap has actually decoded + is ready to paint --
        // hiding before that is what caused the flash-to-nothing / flicker. Abort on a bad image.
        img.onload = function () {
          if (epoch !== _proxy.epoch || proxyActive()) { return; } // gesture ended before decode
          if (!img.naturalWidth || !img.naturalHeight) return;     // empty/black snapshot -> don't hide
          E.canvas.appendChild(img);
          _proxy.img = img;
          E.world.style.visibility = "hidden"; // the bitmap now stands in for the whole live world
          proxyTrackView();
        };
        img.onerror = function () { /* keep the live DOM up */ };
        img.src = dataUrl;
      });
    }
    function proxyTrackView() {
      if (!_proxy.img) return;
      var A = E.view.zoom / (_proxy.sz || 1);
      var bx = E.view.x - _proxy.sx * A, by = E.view.y - _proxy.sy * A;
      _proxy.img.style.transform = "translate(" + bx + "px," + by + "px) scale(" + A + ")";
    }
    function proxyEnd() {
      _proxy.epoch++; _proxy.pending = false; // invalidate any snapshot still in flight
      if (_proxy.img) { if (_proxy.img.parentNode) _proxy.img.parentNode.removeChild(_proxy.img); _proxy.img = null; }
      if (E.world) E.world.style.visibility = ""; // live DOM (now at the final crisp transform) returns
    }

    // Perf (#151 lever 1): native-scroll pan. Instead of moving the world with a transform
    // translate (which re-rasterises the whole DOM when the layer is too big to GPU-cache), the
    // world lives inside an overflow:auto SIZER and panning is native scrolling -- the browser
    // moves already-painted GPU tiles, so content NEVER blanks and pan stays buttery even zoomed
    // out. Zoom stays a `scale()` transform (that half is lever 2's snapshot problem). Mapping:
    // the world sits at (SCROLL_PAD, SCROLL_PAD) in the sizer, so world origin renders at
    // canvas-local x = SCROLL_PAD - scrollLeft; the existing `view.x` (world origin's canvas-local
    // x) therefore equals SCROLL_PAD - scrollLeft. Backing `view.x/y` off scroll that way keeps
    // EVERY screen<->world read (select, marquee, drag, pins) working unchanged; only the writers
    // (pan/zoom/fit) reroute to scroll. Default OFF (flag) + a console toggle for A/B on hardware.
    var NS_KEY = "authoring.nativeScroll";
    var NATIVE_SCROLL = false;
    try { NATIVE_SCROLL = localStorage.getItem(NS_KEY) === "1"; } catch (e) {} // persist across Cmd+R (testing footgun)
    var SCROLL_PAD = 2000; // breathing room around the content so panning feels free (not a huge void)
    var scrollSizer = null, _scrollSync = false;
    function nativeScroll() { return NATIVE_SCROLL; } // the flag as a read, for editor.js's remaining branches
    function attachWorld() {
      // Used by every canvas.appendChild(world) site so the structure follows the flag.
      if (NATIVE_SCROLL) {
        if (!scrollSizer) scrollSizer = E.h("div", "canvas-scroll");
        scrollSizer.innerHTML = ""; scrollSizer.appendChild(E.world);
        E.canvas.appendChild(scrollSizer);
        E.canvas.classList.add("native-scroll");
      } else {
        if (E.world) { E.world.style.left = ""; E.world.style.top = ""; }
        E.canvas.appendChild(E.world);
        E.canvas.classList.remove("native-scroll");
      }
    }
    window.__nativeScroll = function (on) {
      var was = NATIVE_SCROLL; NATIVE_SCROLL = (on == null) ? NATIVE_SCROLL : !!on; // no arg = query
      try { localStorage.setItem(NS_KEY, NATIVE_SCROLL ? "1" : "0"); } catch (e) {}
      if (was !== NATIVE_SCROLL && E.world && E.canvas) {
        attachWorld();
        if (!NATIVE_SCROLL) { E.canvas.scrollLeft = 0; E.canvas.scrollTop = 0; }
        applyView();
      }
      if (window.console) console.log("[native-scroll] " + (NATIVE_SCROLL ? "ON (persists across reload)" : "OFF"));
      return NATIVE_SCROLL;
    };

    var targetZoom = 1, zoomAnchor = null, zooming = false;
    function applyView() {
      if (!E.world) return;
      var _pt0 = E.perfOn ? performance.now() : 0;
      if (NATIVE_SCROLL && scrollSizer) {
        // A programmatic view change (fit / restore / toggle) is authoritative + instant: cancel
        // any in-flight compositor zoom transition + its settle so they can't fight this write.
        E.world.style.transition = "";
        if (_zoomSettleT) { clearTimeout(_zoomSettleT); _zoomSettleT = null; zooming = false; }
        // Pan is native scroll; the transform carries ZOOM only. Size the sizer to the scaled
        // world + pad so scrollbars have the right range, then drive scroll from view.x/y and
        // reconcile view from the CLAMPED scroll the browser accepted (keeps reads exact).
        E.world.style.left = SCROLL_PAD + "px"; E.world.style.top = SCROLL_PAD + "px";
        E.world.style.transform = "scale(" + E.view.zoom + ")";
        scrollSizer.style.width = (worldW() * E.view.zoom + SCROLL_PAD * 2) + "px";
        scrollSizer.style.height = ((E.worldH || E.FRAME_H) * E.view.zoom + SCROLL_PAD * 2) + "px";
        _scrollSync = true;
        E.canvas.scrollLeft = SCROLL_PAD - E.view.x; E.canvas.scrollTop = SCROLL_PAD - E.view.y;
        _scrollSync = false;
        E.view.x = SCROLL_PAD - E.canvas.scrollLeft; E.view.y = SCROLL_PAD - E.canvas.scrollTop;
      } else {
        E.world.style.transform = "translate(" + E.view.x + "px," + E.view.y + "px) scale(" + E.view.zoom + ")";
      }
      // Perf (#172): flag zoomed-out so the nav-lod (in-motion) rule can collapse pages to
      // cheap boxes. A class toggle only -- reflects the CURRENT zoom every frame; the actual
      // paint drop is gated on .nav-lod so it only bites WHILE moving, snapping back on settle.
      E.world.classList.toggle("world--far", E.view.zoom < FAR_ZOOM);
      if (proxyActive()) proxyTrackView(); // #151: keep the cached bitmap glued to the live transform
      E.zoomLevelEl.textContent = Math.round(E.view.zoom * 100) + "%";
      E.persistView();
      if (typeof E.renderCommentPins === "function") E.renderCommentPins(); // §12: pins track pan/zoom
      if (E.perfOn) E.noteViewJs(performance.now() - _pt0);
    }
    // Native-scroll pan (#151): a user scroll IS the pan. Sync view.x/y from the scroll offset and
    // reproject pins -- but do NOT re-run applyView (would re-set scroll -> loop) and do NOT tag
    // nav-lod (native scroll never re-rasterises, so content stays fully live/crisp = the win).
    // Guarded off _scrollSync so applyView's own scroll write doesn't re-enter.
    E.canvas.addEventListener("scroll", function () {
      if (!NATIVE_SCROLL || _scrollSync) return;
      E.view.x = SCROLL_PAD - E.canvas.scrollLeft; E.view.y = SCROLL_PAD - E.canvas.scrollTop;
      if (proxyActive()) proxyTrackView();
      E.persistView();
      if (typeof E.renderCommentPins === "function") E.renderCommentPins();
    }, { passive: true });
    // Perf (#150): the canvas is paint/compositing-bound -- pan/zoom re-rasterises every
    // page, SVG and embed on screen each frame (measured 7 FPS zoomed out). While a gesture
    // is IN MOTION we tag the world `nav-lod`; CSS then stops painting the heavy leaf content
    // (images / inline SVGs / embeds / video), so the GPU only moves cheap boxes -> smooth
    // motion. A settle timer clears it ~120ms after the last movement, snapping full detail
    // back. Editor chrome only (a class on the editor-built world) -- render()/doc/export are
    // untouched, and this is opt-in motion behaviour, never a persistent blank.
    var _navSettleT = null;
    // #347: the LOD is a perf trade, and the browser may no longer need to pay it -- the 7 FPS
    // above was measured in the packaged WKWebView, not here. This flag turns the whole
    // suppression off so live-crisp pan/zoom can be A/B'd against it on a real course without a
    // rebuild: window.__canvasLod(false). Default ON = today's behaviour, so nothing changes
    // until the measurement says it should. Persisted like NATIVE_SCROLL, because the test
    // involves importing a course and reloading, and a flag that resets on Cmd+R tests nothing.
    var LOD_KEY = "authoring.canvasLod";
    var CANVAS_LOD = true;
    try { if (localStorage.getItem(LOD_KEY) === "0") CANVAS_LOD = false; } catch (e) {}
    window.__canvasLod = function (on) {
      CANVAS_LOD = (on == null) ? CANVAS_LOD : !!on; // no arg = query
      try { localStorage.setItem(LOD_KEY, CANVAS_LOD ? "1" : "0"); } catch (e) {}
      if (!CANVAS_LOD) {
        // Drop any suppression already on screen; otherwise content stays hidden until the
        // next gesture settles, which reads as the toggle having done nothing.
        if (_navSettleT) { clearTimeout(_navSettleT); _navSettleT = null; }
        if (E.world) E.world.classList.remove("nav-lod");
        proxyEnd();
      }
      if (window.console) console.log("[canvas-lod] " + (CANVAS_LOD ? "ON (pages blank while moving)" : "OFF (live crisp; persists across reload)"));
      return CANVAS_LOD;
    };
    function markNavigating() {
      // #151: with native-scroll pan on, pan never re-rasterises (no LOD needed) and we want ZOOM
      // to show LIVE content too (the blanking is what read as "pages go black on zoom"). So skip
      // the paint-suppression classes entirely -- zoom paints live. If live zoom janks, a
      // cached-layer zoom is the next step.
      if (NATIVE_SCROLL || !CANVAS_LOD) return;
      if (E.world) E.world.classList.add("nav-lod");
      proxyBegin(); // (interim path) on gesture start; no-op if already proxying / not far-zoom / no native bridge
      if (_navSettleT) clearTimeout(_navSettleT);
      _navSettleT = setTimeout(function () { if (E.world) E.world.classList.remove("nav-lod"); proxyEnd(); }, 120);
    }
    // Fit the view to an arbitrary WORLD-space rect (used by "." zoom-to-selection).
    function fitWorldRect(wx, wy, ww, wh) {
      if (!(ww > 0) || !(wh > 0)) return;
      var rect = E.canvas.getBoundingClientRect(), pad = 80;
      var z = E.clamp(Math.min((rect.width - pad * 2) / ww, (rect.height - pad * 2) / wh), 0.05, 2);
      zooming = false; targetZoom = z; zoomAnchor = null;
      E.view.zoom = z;
      E.view.x = rect.width / 2 - (wx + ww / 2) * z;
      E.view.y = rect.height / 2 - (wy + wh / 2) * z;
      E.view.ready = true; applyView();
    }
    function zoomStep() {
      var z = E.view.zoom + (targetZoom - E.view.zoom) * 0.22; // ease toward target
      if (Math.abs(targetZoom - z) < 0.001) { z = targetZoom; zooming = false; }
      E.view.zoom = z;
      if (zoomAnchor) { E.view.x = zoomAnchor.sx - zoomAnchor.wx * z; E.view.y = zoomAnchor.sy - zoomAnchor.wy * z; }
      markNavigating();
      applyView();
      if (zooming) requestAnimationFrame(zoomStep);
    }
    // Every zoom entry point (wheel / buttons / keys) sets targetZoom + zoomAnchor then calls
    // startZoom(). Non-native: the eased rAF zoomStep (re-rasterises each frame). Native-scroll:
    // route to a COMPOSITOR zoom instead -- animate the world transform with a CSS transition so
    // WebKit scales the ALREADY-PAINTED layer (smooth + content-visible at any page count, brief
    // blur) rather than re-rasterising every page per frame; bake to a crisp scale-only transform
    // + scroll on settle. This is the fix for "zoom slows down at 6+ pages". #151 lever 2, done
    // right (the browser's own layer, no flaky snapshot API).
    var _zoomSettleT = null, _zoomBase = 1;
    var _zoomDur = 80, _zoomSettle = 95; // compositor-zoom transition + settle (ms), live-tunable
    // Dial the zoom feel from the console without a rebuild, e.g. __zoomTune({sens:0.01, dur:60}).
    window.__zoomTune = function (o) {
      o = o || {};
      if (o.sens != null) ZOOM_SENS = o.sens;
      if (o.dur != null) _zoomDur = o.dur;
      if (o.settle != null) _zoomSettle = o.settle;
      return { sens: ZOOM_SENS, dur: _zoomDur, settle: _zoomSettle };
    };
    function startZoom() {
      if (!NATIVE_SCROLL || !scrollSizer || !E.world) {
        if (!zooming) { zooming = true; requestAnimationFrame(zoomStep); }
        return;
      }
      if (!zooming) { zooming = true; _zoomBase = E.view.zoom; } // capture committed base once per gesture
      var z = targetZoom, a = zoomAnchor;
      // Keep the anchor world point under the cursor while scaling, WITHOUT moving scroll:
      // translate = anchorWorld * (base - z) (derivation in canvas-perf-151-spec).
      var t = zoomTranslate(_zoomBase, z, a), tx = t.tx, ty = t.ty;
      // linear (not ease-out) so rapid continuous notches don't pulse/accel-decel each segment;
      // short so the composited-blur window is brief and it crisps quickly.
      E.world.style.transition = "transform " + _zoomDur + "ms linear";
      E.world.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + z + ")";
      if (E.zoomLevelEl) E.zoomLevelEl.textContent = Math.round(z * 100) + "%";
      if (_zoomSettleT) clearTimeout(_zoomSettleT);
      // bake right after the transition finishes (single blur->crisp settle; was 160 -> a second,
      // visibly-doubled re-bake 50ms after the transition already crisped).
      _zoomSettleT = setTimeout(function () { bakeZoom(z, a); }, _zoomSettle);
    }
    function bakeZoom(z, a) {
      _zoomSettleT = null; zooming = false;
      if (!NATIVE_SCROLL || !scrollSizer) return;
      var sl = E.canvas.scrollLeft, st = E.canvas.scrollTop;
      var t = zoomTranslate(_zoomBase, z, a);
      // Fold the transient translate into scroll so the crisp re-render lands in the SAME place.
      var baked = bakeView(SCROLL_PAD, { left: sl, top: st }, t);
      E.view.zoom = z;
      E.view.x = baked.x; E.view.y = baked.y;
      E.world.style.transition = "";
      applyView(); // sizes the sizer + scale-only transform + drives scroll(=sl-tx) + reconciles view
    }
    function worldW() { return E.colX(Math.max(0, E.numCols - 1)) + E.FRAME_W; }
    // The fit/focus maths is the top half of this file (arch-P3-07); these apply what it returns.
    function fitAll() {
      var v = fitWorld(E.canvas.getBoundingClientRect(), { w: worldW(), h: E.worldH }, E.LABEL_H);
      E.view.zoom = v.zoom; E.view.x = v.x; E.view.y = v.y;
      E.view.ready = true; applyView();
    }
    // JJJJ: 2D fit helpers + a page->chapter->grid cycle on the zoom-fit button.
    function fitToRect(x, y, w, h) {
      var v = fitRect(E.canvas.getBoundingClientRect(), { x: x, y: y, w: w, h: h });
      E.view.zoom = v.zoom; E.view.x = v.x; E.view.y = v.y;
      E.view.ready = true; applyView();
    }
    function fitChapter(col) {
      var bottom = 0;
      E.frameDescs.forEach(function (f) { if (E.framePos[f.i] && E.framePos[f.i].col === col) { var b = E.framePos[f.i].y + E.LABEL_H + (f.h || 0); if (b > bottom) bottom = b; } });
      fitToRect(E.colX(col), 0, E.FRAME_W, bottom || E.FRAME_H);
    }
    var fitMode = 2; // starts at the last mode so the FIRST click lands on page
    function fitCycle() {
      fitMode = nextFitMode(fitMode);
      var col = (E.framePos[E.currentPage] && E.framePos[E.currentPage].col) || 0;
      var mode = fitModeName(fitMode);
      if (mode === "page") focusFrame(E.currentPage);
      else if (mode === "chapter") fitChapter(col);
      else fitAll();
    }
    function focusFrame(i) {
      E.setCurrentPage(i);
      var fh = E.frameDescs[i] ? E.frameDescs[i].frame.offsetHeight : E.FRAME_H;
      // JJJJ: the frame's Y is its position in its own chapter column.
      var v = focusRect(E.canvas.getBoundingClientRect(), { x: E.frameX(i), y: E.frameY(i), w: E.FRAME_W, h: fh }, E.LABEL_H);
      E.view.zoom = v.zoom; E.view.x = v.x; E.view.y = v.y;
      applyView();
    }

    // ---- the zoom entry points -------------------------------------------
    // editor.js binds the wheel, the Cmd+= / Cmd+- keys and the 100% button; each one used to
    // repeat the same four lines of anchor maths inline, four times over, which is why
    // targetZoom/zoomAnchor/zooming had to stay visible to the whole file. They are private now
    // and this is the whole surface. Each body is its original, including `* 1.25` against
    // `/ 1.25` -- the asymmetry is what makes in-then-out land back on the zoom you started at.
    function anchorAt(sx, sy) {
      if (!zooming) targetZoom = E.view.zoom; // sync if zoom was set elsewhere (fit/focus)
      zoomAnchor = { sx: sx, sy: sy, wx: (sx - E.view.x) / E.view.zoom, wy: (sy - E.view.y) / E.view.zoom };
    }
    function centre() {
      var rect = E.canvas.getBoundingClientRect();
      return { x: rect.width / 2, y: rect.height / 2 };
    }
    // A ctrl/cmd wheel notch, in canvas-local coords. deltaMode normalisation (lines/pages -> px)
    // and the +/-60 cap live here so one chunky mouse notch cannot jump the zoom.
    function wheelZoom(sx, sy, deltaY, deltaMode) {
      anchorAt(sx, sy);
      var dy = deltaY;
      if (deltaMode === 1) dy *= 16; else if (deltaMode === 2) dy *= 100;
      dy = Math.max(-60, Math.min(60, dy));
      targetZoom = E.clamp(targetZoom * Math.exp(-dy * ZOOM_SENS), 0.05, 4);
      startZoom();
    }
    function zoomIn() {
      var c = centre();
      anchorAt(c.x, c.y);
      targetZoom = E.clamp(targetZoom * 1.25, 0.05, 4);
      startZoom();
    }
    function zoomOut() {
      var c = centre();
      anchorAt(c.x, c.y);
      targetZoom = E.clamp(targetZoom / 1.25, 0.05, 4);
      startZoom();
    }
    function zoomTo100() {
      var rect = E.canvas.getBoundingClientRect();
      var mx = rect.width / 2, my = rect.height / 2;
      var wx = (mx - E.view.x) / E.view.zoom, wy = (my - E.view.y) / E.view.zoom;
      zooming = false; targetZoom = 1; zoomAnchor = null;
      E.view.zoom = 1; E.view.x = mx - wx; E.view.y = my - wy; E.view.ready = true; applyView();
    }
    // A plain wheel/trackpad pan, when native scroll is off.
    function panBy(dx, dy) {
      E.view.x -= dx; E.view.y -= dy; markNavigating(); applyView();
    }
    // A space-drag pan. Opposite sign to panBy -- a wheel reports how far the CONTENT should
    // move, a drag reports how far the POINTER moved -- and it routes to scroll when the sizer
    // exists, which is the only reason `scrollSizer` was ever visible outside this region.
    function panDrag(dx, dy) {
      if (NATIVE_SCROLL && scrollSizer) {
        // #151: drive native scroll; the scroll listener syncs view.x/y + pins (no re-raster).
        E.canvas.scrollLeft -= dx; E.canvas.scrollTop -= dy;
      } else {
        E.view.x += dx; E.view.y += dy; markNavigating(); applyView();
      }
    }

    kernel.expose({
      applyView: applyView,
      markNavigating: markNavigating,
      attachWorld: attachWorld,
      nativeScroll: nativeScroll,
      worldW: worldW,
      fitAll: fitAll,
      fitToRect: fitToRect,
      fitChapter: fitChapter,
      fitCycle: fitCycle,
      fitWorldRect: fitWorldRect,
      focusFrame: focusFrame,
      wheelZoom: wheelZoom,
      zoomIn: zoomIn,
      zoomOut: zoomOut,
      zoomTo100: zoomTo100,
      panBy: panBy,
      panDrag: panDrag
    });
    return VersoCanvasView;
  }

  var VersoCanvasView = {
    install: install,
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
