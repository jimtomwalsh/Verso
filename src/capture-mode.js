/*
 * #26 Docs capture mode — deterministic editor for byte-identical screenshots.
 *
 * OFF BY DEFAULT. A capture session is not an authoring or export session: this file
 * self-activates ONLY when a flag is present, and does nothing otherwise. It backs ADR
 * 0004's "unchanged UI -> identical bytes -> no-op commits" promise for the docs
 * illustration pipeline (#17), driven by the scene runner (#27) via the Puppeteer harness.
 *
 * VERSO-UI-ONLY. It patches page-global nondeterminism sources (clock, RNG) and injects an
 * editor-chrome stylesheet. It NEVER touches render(doc, theme) / src/course.css / the SCORM
 * export: the export serialises the pure render output, which reads no capture state, so the
 * pure-render invariant holds. Course output is unaffected.
 *
 * Activation (either):
 *   - window.__captureMode = true   set BEFORE this script runs
 *       (Puppeteer: page.evaluateOnNewDocument(() => { window.__captureMode = true }))
 *   - ?capture=1  URL query          (for manual/browser checks; capture=0/false disables)
 *
 * MUST load first (before any id-minting code) so the deterministic clock + seeded RNG are
 * in place — random-/timestamp-suffixed ids minted during a scene then stay UNIQUE within a
 * run yet IDENTICAL between two runs of the same scene (same code path -> same call sequence).
 */
(function () {
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  function flagOn() {
    if (window.__captureMode === true) return true;
    try {
      var q = new URLSearchParams(location.search);
      if (!q.has("capture")) return false;
      var v = q.get("capture");
      return v !== "0" && v !== "false" && v !== "";
    } catch (e) { return false; }
  }
  if (!flagOn()) return;
  window.__captureMode = true;

  // ---- 1. Deterministic clock -----------------------------------------------------------
  // A monotonic counter from a fixed epoch. Every Date.now() / argless new Date() advances
  // by one tick, so timestamp-derived ids stay unique across a scene but reproduce exactly.
  var EPOCH = 1700000000000; // fixed, arbitrary (2023-11-14T22:13:20Z)
  var tick = 0;
  function nowMs() { tick += 1; return EPOCH + tick; }

  var RealDate = Date;
  // Proxy preserves instanceof (target is the real Date) + static methods, overrides now(),
  // and makes argless construction deterministic while forwarding all arg'd calls verbatim.
  var CapDate = new Proxy(RealDate, {
    construct: function (Target, argsList) {
      if (argsList.length === 0) return new RealDate(nowMs());
      return new (Function.prototype.bind.apply(RealDate, [null].concat(argsList)))();
    },
    apply: function () { return new RealDate(nowMs()).toString(); }, // Date() as a plain call
    get: function (Target, prop) { return prop === "now" ? nowMs : Target[prop]; }
  });
  try { window.Date = CapDate; } catch (e) { /* non-writable in some shells; ignore */ }
  try {
    if (window.performance && typeof performance.now === "function") {
      var pt = 0;
      performance.now = function () { pt += 16; return pt; }; // fixed ~60fps step
    }
  } catch (e) { /* ignore */ }

  // ---- 2. Seeded RNG (mulberry32) -------------------------------------------------------
  // Deterministic sequence in place of Math.random(), so random-suffixed ids reproduce.
  var seed = 0x9e3779b9 >>> 0;
  Math.random = function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---- 3. Freeze motion + caret (editor chrome only) ------------------------------------
  // Kill transitions/animations, hide the blinking text caret, and stop smooth scrolling so
  // two shots of the same state are pixel-identical. Injected into the editor DOM at runtime;
  // never enters the SCORM package.
  function injectFreezeCSS() {
    if (document.getElementById("capture-freeze-css")) return;
    var s = document.createElement("style");
    s.id = "capture-freeze-css";
    s.textContent =
      "*, *::before, *::after {" +
      "  transition: none !important;" +
      "  animation: none !important;" +
      "  animation-duration: 0s !important;" +
      "  caret-color: transparent !important;" +
      "  scroll-behavior: auto !important;" +
      "}";
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- 4. Media settle ------------------------------------------------------------------
  // Pause + rewind <video>/<audio> so their frame is fixed. Exposed on window.CaptureMode so
  // the scene runner (#27) can re-settle after DOM changes, right before a shoot step.
  function settleMedia(root) {
    var scope = root || document;
    var media = scope.querySelectorAll ? scope.querySelectorAll("video, audio") : [];
    Array.prototype.forEach.call(media, function (m) {
      try { m.autoplay = false; m.pause(); if (isFinite(m.duration)) m.currentTime = 0; } catch (e) {}
    });
  }

  function markReady() {
    var el = document.documentElement;
    if (el) el.setAttribute("data-capture", "on");
    injectFreezeCSS();
    settleMedia(document);
  }
  if (document.documentElement) markReady();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markReady, { once: true });
  } else {
    markReady();
  }

  // ---- 5. Annotation overlay (#29) ------------------------------------------------------
  // A capture-ONLY overlay drawn OVER the editor to teach a workflow in a docs figure:
  // a highlight ring, a numbered callout chip, and a pointer arrow, each positioned against
  // a target element's box. Rendered into a body-level layer (NOT inside .course-root), so it
  // is editor chrome only — render()/the SCORM export never see it (they serialise the pure
  // render output, not this layer). Styled with DS tokens in editor.css (var(--accent)), so
  // the annotations inherit the active theme. Driven by declarative scene steps via the API
  // below. Absent entirely from normal authoring (capture mode is off by default).
  function annotLayer() {
    var el = document.getElementById("capture-annotate-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "capture-annotate-layer";
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }
  function clearAnnotations() { var l = document.getElementById("capture-annotate-layer"); if (l) l.textContent = ""; }
  function boxOf(target) {
    var t = typeof target === "string" ? document.querySelector(target) : target;
    if (!t || !t.getBoundingClientRect) return null;
    var r = t.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  // draw one annotation: { type:'highlight'|'callout'|'pointer', box?, target?, n?, side? }.
  // box (viewport coords {x,y,w,h}) is authoritative — the runner resolves it (so scenes can
  // target ::-p-text / nth selectors); target is a querySelector fallback for in-page callers.
  function annotate(spec) {
    if (!spec || !spec.type) return false;
    var b = spec.box && spec.box.w != null ? spec.box : boxOf(spec.target);
    if (!b) return false;
    var layer = annotLayer();
    var pad = 4;
    if (spec.type === "highlight") {
      var ring = document.createElement("div");
      ring.className = "capture-annot capture-annot--ring";
      ring.style.left = (b.x - pad) + "px"; ring.style.top = (b.y - pad) + "px";
      ring.style.width = (b.w + pad * 2) + "px"; ring.style.height = (b.h + pad * 2) + "px";
      layer.appendChild(ring);
      return true;
    }
    if (spec.type === "callout") {
      var chip = document.createElement("div");
      chip.className = "capture-annot capture-annot--chip";
      chip.textContent = spec.n != null ? String(spec.n) : "1";
      var side = spec.side || "tl";
      var cx = (side.indexOf("r") !== -1) ? b.x + b.w : b.x;
      var cy = (side.indexOf("b") !== -1) ? b.y + b.h : b.y;
      chip.style.left = cx + "px"; chip.style.top = cy + "px";
      layer.appendChild(chip);
      return true;
    }
    if (spec.type === "pointer") {
      var from = spec.from || "left";
      var ptr = document.createElement("div");
      ptr.className = "capture-annot capture-annot--pointer capture-annot--pointer-" + from;
      // Lucide "arrow-right" geometry, rotated per side in CSS; colour = var(--accent)
      ptr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
      var midY = b.y + b.h / 2, midX = b.x + b.w / 2, gap = 40;
      if (from === "left") { ptr.style.left = (b.x - gap - 24) + "px"; ptr.style.top = (midY - 12) + "px"; }
      else if (from === "right") { ptr.style.left = (b.x + b.w + gap) + "px"; ptr.style.top = (midY - 12) + "px"; }
      else if (from === "top") { ptr.style.left = (midX - 12) + "px"; ptr.style.top = (b.y - gap - 24) + "px"; }
      else { ptr.style.left = (midX - 12) + "px"; ptr.style.top = (b.y + b.h + gap) + "px"; }
      layer.appendChild(ptr);
      return true;
    }
    return false;
  }

  // ---- Public surface (used by the scene runner #27/#29) --------------------------------
  window.CaptureMode = {
    active: true,
    epoch: EPOCH,
    // advance-and-settle helper the runner calls just before a shoot step
    settle: function (root) { injectFreezeCSS(); settleMedia(root); },
    // deterministic id helper for scene-authored fixtures that want a stable id
    seq: function (prefix) { return (prefix || "cap") + "-" + nowMs(); },
    // #29 annotation overlay (capture-only, never in course output)
    annotate: annotate,
    clearAnnotations: clearAnnotations
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
