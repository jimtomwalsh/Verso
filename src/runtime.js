/*
 * runtime — THE shared interaction engine.
 *
 * One module, used identically by BOTH the editor's Interact preview / demo mode
 * AND the exported SCORM package, so authored behaviour == shipped behaviour
 * (the same WYSIWYG-parity principle as render.js).
 *
 * It owns the reactive core only:
 *   - a state store: `visited` per page, `watched` per video, `checked` per checkbox
 *   - click triggers -> actions (goto / next / prev / show / hide / enable / toggle)
 *   - state emitters: video `ended` / Vimeo `finish` -> watched; checkbox change -> checked
 *   - on ANY state change, re-evaluate EVERY gate -> disable / hide per gate.mode
 *   - a completion hook (all pages visited AND all required gates satisfied)
 *
 * Page navigation (page show/hide) is a pluggable SEAM, not owned here: pass a
 * `nav` adapter (export.js injects its existing page-swap; the editor preview and
 * the standalone tests use the built-in DOM page-swap). This keeps the existing
 * export runtime untouched while giving it a clean place to plug the engine in.
 *
 * Contract with render.js:
 *   - interactive blocks carry `data-id="<block.id>"`.
 *   - a gated block carries `data-gate="disable"|"hide"` and renders locked first.
 *   - the engine toggles `.is-locked` + `aria-disabled` + inner control.disabled
 *     (disable mode) or the native `hidden` attribute (hide mode).
 *
 * Interaction map (built by export.js / editor / window.buildInteractionMap):
 *   { "<blockId>": { interactions:[ {trigger,action} ], gate:{mode,when,hint?,required?} }, ... }
 *
 * Classic script — exposes window.CourseRuntime = { create }.
 */
(function () {
  "use strict";

  function qsAll(root, sel) { return [].slice.call(root.querySelectorAll(sel)); }
  function noop() {}

  // Default "Exit course" behaviour: end the SCORM session cleanly. The exported
  // shell exposes window.SCORM (scorm-api.js); SCORM.quit("logout") sets
  // cmi.core.exit = "logout", commits, then LMSFinish. "logout" (not the empty
  // default the incidental-unload path uses) is what asks the LMS to END and
  // RETURN the learner — Moodle stays on the SCO for a normal/empty exit, which is
  // why the exit button appeared to do nothing. Guarded so it's a safe no-op
  // outside an LMS (SCORM absent). Best-effort window.close() after (browsers block
  // close() on non-script-opened windows, harmless where it can't apply). The
  // editor demo passes its own onExit (see editor.js) so it never touches the real
  // SCORM API or window.
  function defaultExit() {
    try { if (typeof window !== "undefined" && window.SCORM && window.SCORM.quit) window.SCORM.quit("logout"); } catch (_) {}
    try { if (typeof window !== "undefined" && window.close) window.close(); } catch (_) {}
  }

  // Built-in DOM page-swap. Used by the editor preview + standalone tests; the
  // SCORM export injects its own `nav` adapter (its existing show()/pages runtime)
  // so the two never fight over the DOM. Each page is the `.page[data-page-id]`;
  // the shown/hidden unit is its nearest .scorm-page / .course-root wrapper.
  function defaultNav(root) {
    var pages = qsAll(root, ".page[data-page-id]");
    if (!pages.length) pages = qsAll(root, "[data-page-id]");
    var ids = pages.map(function (p) { return p.getAttribute("data-page-id"); });
    var boxes = pages.map(function (p) {
      return (p.closest && (p.closest(".scorm-page") || p.closest(".course-root"))) || p;
    });
    var cur = 0;
    function show(i) {
      cur = Math.max(0, Math.min(i, pages.length - 1));
      boxes.forEach(function (b, idx) {
        var on = idx === cur;
        b.classList.toggle("is-current", on);
        if (boxes.length > 1) b.hidden = !on;
      });
    }
    if (pages.length > 1) show(0);
    return {
      count: function () { return pages.length; },
      pageIds: function () { return ids.slice(); },
      currentPageId: function () { return ids[cur]; },
      goto: function (id) { var i = ids.indexOf(id); if (i < 0) return false; show(i); return true; },
      next: function () { show(cur + 1); },
      prev: function () { show(cur - 1); }
    };
  }

  // ---- image hotspots ------------------------------------------------------
  // A hotspot block (.block-hotspot) has "i" markers over an image, each owning a
  // hidden anchored popover. Behaviour is bound purely by DOM selector here (no
  // interaction-map entry, no ids), so it runs identically in the editor demo and
  // the exported package. Positioning is shared with the editor's edit-reveal via
  // window.CourseRuntime.positionPopover so canvas and runtime agree.
  function positionPopover(stage, marker, pop) {
    if (!stage || !marker || !pop) return;
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var gap = 16;
    // #146: the popover is a child of the full-width STAGE, but the marker lives in the
    // centred, possibly-narrower .hotspot-frame — so its %-left is relative to the IMAGE,
    // not the stage. Anchor in the stage's own LAYOUT coordinates: the frame's offset
    // within the stage (its auto-centring margin) + the marker's authored % of the frame.
    // Uses offsetLeft/clientWidth (layout px), NOT getBoundingClientRect, so it is immune
    // to the editor canvas zoom transform (rects are scaled, clientWidth is not — mixing
    // them mis-placed the card under zoom). Reduces to the old mx%*sw when frame == stage.
    var frame = marker.closest ? marker.closest(".hotspot-frame") : null;
    var fx = frame ? frame.offsetLeft : 0, fy = frame ? frame.offsetTop : 0;
    var fw = frame ? frame.clientWidth : sw, fh = frame ? frame.clientHeight : sh;
    var mx = parseFloat(marker.style.left);
    var my = parseFloat(marker.style.top);
    if (isNaN(mx)) mx = 50;
    if (isNaN(my)) my = 50;
    var ax = fx + mx / 100 * fw;
    var ay = fy + my / 100 * fh;
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    // author placement override (data-popover-place on the stage): auto|top|bottom|left|right|center.
    var place = stage.getAttribute("data-popover-place") || "auto";
    var side, left, top;
    // "center": overlay the card in the middle of the image (no marker anchor, no
    // pointer arrow — the CSS hides ::after for data-side="center"). Closes via the
    // X / outside-click / Esc paths just like the anchored placements.
    if (place === "center") {
      left = (sw - pw) / 2;
      top = (sh - ph) / 2;
      left = Math.max(6, Math.min(left, Math.max(6, sw - pw - 6)));
      top = Math.max(6, Math.min(top, Math.max(6, sh - ph - 6)));
      pop.style.left = left + "px";
      pop.style.top = top + "px";
      pop.setAttribute("data-side", "center");
      return;
    }
    if (place === "top" || place === "bottom") {
      side = place;
      left = ax - pw / 2;
      top = place === "top" ? ay - gap - ph : ay + gap;
    } else if (place === "left" || place === "right") {
      side = place;
      left = side === "right" ? ax + gap : ax - gap - pw;
      top = ay - ph / 2;
    } else {
      // auto: prefer opening into the empty MARGIN beside the centred image (the space
      // between the frame edge and the stage edge, on the marker's side). If that margin
      // can't fit the card, fall back to the original "open toward the roomier side over
      // the image" behaviour — so a full-width image (no margin) is unchanged.
      var leftMargin = fx, rightMargin = sw - (fx + fw);
      var toward = (ax > sw / 2) ? "right" : "left"; // marker on the right half -> right margin
      var marginFits = toward === "right" ? (rightMargin >= pw + gap) : (leftMargin >= pw + gap);
      side = marginFits ? toward : (ax > 0.55 * sw ? "left" : "right");
      left = side === "right" ? ax + gap : ax - gap - pw;
      top = ay - ph / 2;
    }
    left = Math.max(6, Math.min(left, Math.max(6, sw - pw - 6)));
    top = Math.max(6, Math.min(top, Math.max(6, sh - ph - 6)));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.setAttribute("data-side", side);
  }

  // Accordion / Tabs block. render.js emits the AUTHOR view (all panels shown);
  // this collapses to the interactive state + wires clicks, in demo AND export
  // (both call create()). Same markup both places -> no WYSIWYG mismatch.
  function bindAccordion(root) {
    qsAll(root, "[data-accordion]").forEach(function (acc) {
      // Completion (§5 auto-gate): the block is "done" once every section/tab has been
      // opened at least once. Emit a bubbling accordion-complete so the engine can require
      // it, decoupled from this binder (same pattern as hotspot-complete).
      var opened = {}, doneFired = false;
      function markOpened(count, i) {
        opened[i] = true;
        if (!doneFired && Object.keys(opened).length >= count && count > 0) {
          doneFired = true;
          try { acc.dispatchEvent(new CustomEvent("accordion-complete", { bubbles: true })); } catch (e) {}
        }
      }
      if (acc.getAttribute("data-acc-mode") === "tabs") {
        var tabs = qsAll(acc, ".acc__tab"), panels = qsAll(acc, ".acc__panel");
        var activate = function (i) {
          tabs.forEach(function (t, j) { var on = j === i; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", on ? "true" : "false"); });
          panels.forEach(function (p, j) { p.hidden = j !== i; });
          markOpened(tabs.length, i);
        };
        tabs.forEach(function (t, i) { t.addEventListener("click", function () { activate(i); }); });
        activate(0);
      } else {
        var multi = acc.getAttribute("data-acc-multi") === "1";
        var items = qsAll(acc, ".acc__item");
        var setItem = function (item, open) {
          item.classList.toggle("is-open", open);
          var h = item.querySelector(".acc__header"), p = item.querySelector(".acc__panel");
          if (h) h.setAttribute("aria-expanded", open ? "true" : "false");
          if (p) p.hidden = !open;
        };
        items.forEach(function (item, i) { setItem(item, i === 0); if (i === 0) markOpened(items.length, 0); }); // first open, rest closed
        items.forEach(function (item, i) {
          var header = item.querySelector(".acc__header"); if (!header) return;
          header.addEventListener("click", function () {
            var panel = item.querySelector(".acc__panel"), willOpen = panel ? panel.hidden : true;
            if (!multi && willOpen) items.forEach(function (o) { if (o !== item) setItem(o, false); });
            setItem(item, willOpen);
            if (willOpen) markOpened(items.length, i);
          });
        });
      }
    });
  }

  function bindHotspots(root) {
    var blocks = qsAll(root, ".block-hotspot");
    if (!blocks.length) return;
    function closePop(pop) {
      if (!pop || pop.hidden) return;
      pop.classList.remove("is-open");
      if (pop.__marker) pop.__marker.classList.remove("is-active");
      setTimeout(function () { if (!pop.classList.contains("is-open")) pop.hidden = true; }, 220);
    }
    function closeAll(scope) { qsAll(scope || root, ".hotspot-popover").forEach(closePop); }
    function openPop(stage, marker) {
      var id = marker.getAttribute("data-hotspot");
      var pop = stage.querySelector('.hotspot-popover[data-hotspot-panel="' + id + '"]');
      if (!pop) return;
      qsAll(stage, ".hotspot-popover").forEach(function (p) { if (p !== pop) closePop(p); });
      qsAll(stage, ".hotspot-marker").forEach(function (m) { if (m !== marker) m.classList.remove("is-active"); });
      if (pop.classList.contains("is-open")) { closePop(pop); return; } // toggle off
      pop.__marker = marker;
      pop.hidden = false;
      positionPopover(stage, marker, pop);
      marker.classList.add("is-active");
      (window.requestAnimationFrame || setTimeout)(function () { pop.classList.add("is-open"); });
    }
    // Screen graph (#216): navigate by SCREEN id, with a back-stack so Back retraces
    // the learner's actual path one step and Home jumps to the entry screen. The
    // stack of visited non-entry screen ids lives on the stage (stage.__hsStack);
    // an empty stack === the entry/base state (no panel shown).
    function hsHideChrome(stage) {
      var back = stage.querySelector(".hotspot-back"); if (back) back.hidden = true;
      var home = stage.querySelector(".hotspot-home"); if (home) home.hidden = true;
    }
    function hsShowChrome(stage) {
      var back = stage.querySelector(".hotspot-back"); if (back) back.hidden = false;
      var home = stage.querySelector(".hotspot-home"); if (home) home.hidden = false;
    }
    // base = the entry screen: hide every panel + all "you are here" state.
    function screenBase(stage) {
      loopExit(stage); // #224 T6b: Home clears any loop carousel too
      qsAll(stage, ".hotspot-screen").forEach(function (s) { s.hidden = true; });
      qsAll(stage, ".hotspot-marker").forEach(function (m) { m.classList.remove("is-active"); });
      stage.classList.remove("is-screen-open");
      hsHideChrome(stage);
      stage.__hsStack = [];
      hsSyncVideos(stage); // #217: play the entry screen's video, pause the rest
      hsAfterNav(stage, stage.getAttribute("data-hotspot-entry")); // #218 back on the entry screen
    }
    // show one screen PANEL by id (no stack change); returns false if it isn't there.
    function screenShow(stage, sid) {
      var panel = stage.querySelector('.hotspot-screen[data-screen-id="' + sid + '"]');
      if (!panel) return false;
      qsAll(stage, ".hotspot-screen").forEach(function (s) { s.hidden = s !== panel; });
      panel.style.animation = "none"; panel.offsetHeight; panel.style.animation = ""; // restart fade
      stage.classList.add("is-screen-open");
      hsShowChrome(stage);
      hsSyncVideos(stage); // #217: play the arrived-at screen's video, pause the rest
      hsAfterNav(stage, sid); // #218 mark visited + counter + trail + completion (stack already current)
      return true;
    }
    // ---- completion / gating + Navigation trail (#218) -----------------------
    // Default completion = every REACHABLE screen visited (or an author-designated
    // completion screen reached), which fires the existing `hotspot-complete` auto-gate
    // signal so page Next-gating is unchanged. trackViewed:false opts out (render emits
    // no counter + no signal). The Navigation trail is an author-optional breadcrumb of
    // the walked path (off by default); each crumb jumps back along the learner's path.
    function hsBlockOf(stage) { return stage.closest ? stage.closest(".block-hotspot") : null; }
    function hsTrack(stage) { var b = hsBlockOf(stage); return !b || b.getAttribute("data-track-viewed") !== "0"; }
    function hsScreenMode(stage) { var b = hsBlockOf(stage); return !!(b && b.getAttribute("data-mode") === "screen"); }
    // reachable screens = a BFS over navigate targets from the entry (so an orphan screen
    // the learner can never reach never blocks completion). Cached per stage.
    function hsReachable(stage) {
      if (stage.__hsReachable) return stage.__hsReachable;
      var entryId = stage.getAttribute("data-hotspot-entry");
      var frame = stage.querySelector(".hotspot-frame");
      function markersOf(sid) {
        if (sid === entryId) return frame ? qsAll(frame, ".hotspot-marker").filter(function (m) { return m.parentNode === frame; }) : [];
        var p = stage.querySelector('.hotspot-screen[data-screen-id="' + sid + '"]');
        return p ? qsAll(p, ".hotspot-marker") : [];
      }
      var seen = {}; seen[entryId] = true; var q = [entryId];
      while (q.length) {
        markersOf(q.shift()).forEach(function (m) {
          if (m.getAttribute("data-action") !== "navigate") return;
          var t = m.getAttribute("data-target");
          if (!t) return;
          // #224 T6b: a marker can target a LOOP; its reachable screens are the loop's
          // members (the loop id itself is not a screen). So completion counts every
          // member the carousel can show, not a phantom loop node.
          var lp = stage.__hsLoops && stage.__hsLoops[t];
          if (lp) { lp.screens.forEach(function (sid) { if (sid && !seen[sid]) { seen[sid] = true; q.push(sid); } }); }
          else if (!seen[t]) { seen[t] = true; q.push(t); }
        });
      }
      stage.__hsReachable = Object.keys(seen);
      return stage.__hsReachable;
    }
    function hsMarkVisited(stage, sid) { if (sid) { stage.__hsVisited = stage.__hsVisited || {}; stage.__hsVisited[sid] = true; } }
    function hsUpdateCounter(stage) {
      var counter = stage.querySelector(".hotspot-counter"); if (!counter) return;
      var reach = hsReachable(stage), total = reach.length, vis = stage.__hsVisited || {};
      var visited = reach.filter(function (id) { return vis[id]; }).length;
      counter.textContent = visited + " of " + total + " screens visited";
      if (visited >= total) counter.classList.add("is-complete");
    }
    function hsCheckComplete(stage, curSid) {
      if (!hsTrack(stage) || stage.__hsComplete) return;
      var cs = stage.getAttribute("data-hotspot-complete-screen");
      var done = (cs && curSid === cs) || hsReachable(stage).every(function (id) { return stage.__hsVisited && stage.__hsVisited[id]; });
      if (done) { stage.__hsComplete = true; try { stage.dispatchEvent(new CustomEvent("hotspot-complete", { bubbles: true })); } catch (e) {} }
    }
    function hsTrailName(stage, sid) {
      var entryId = stage.getAttribute("data-hotspot-entry");
      if (sid === entryId) return stage.getAttribute("data-hotspot-entry-name") || "Home";
      var p = stage.querySelector('.hotspot-screen[data-screen-id="' + sid + '"]');
      return (p && p.getAttribute("data-screen-name")) || sid;
    }
    function hsRenderTrail(stage) {
      var trail = stage.querySelector(".hotspot-trail"); if (!trail) return;
      var path = [stage.getAttribute("data-hotspot-entry")].concat(stage.__hsStack || []);
      trail.innerHTML = "";
      trail.hidden = path.length <= 1; // only show once the learner steps off the entry screen
      path.forEach(function (sid, i) {
        var crumb = document.createElement("button");
        crumb.type = "button"; crumb.className = "hotspot-trail__crumb";
        crumb.textContent = hsTrailName(stage, sid);
        crumb.setAttribute("data-trail-index", i);
        if (i === path.length - 1) crumb.setAttribute("aria-current", "step");
        crumb.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); hsTrailJump(stage, i); });
        trail.appendChild(crumb);
      });
    }
    function hsTrailJump(stage, idx) {
      loopExit(stage); // #224 T6b: jumping via the trail leaves any loop carousel
      var stack = stage.__hsStack || [];
      qsAll(stage, ".hotspot-marker").forEach(function (m) { m.classList.remove("is-active"); });
      if (idx <= 0) { screenBase(stage); return; }             // entry crumb -> Home
      stage.__hsStack = stack.slice(0, idx);                   // truncate the path to that crumb
      screenShow(stage, stack[idx - 1]);
    }
    // Caption: keep the single below-screen caption line in sync with the CURRENT screen. The
    // per-screen text rides the DOM (data-screen-caption on each panel; the entry caption on the
    // stage) so this never re-reads the doc.
    function hsUpdateCaption(stage, curSid) {
      var cap = stage.querySelector(".hotspot-caption"); if (!cap) return;
      var entryId = stage.getAttribute("data-hotspot-entry");
      var text;
      if (curSid === entryId) text = stage.getAttribute("data-hotspot-entry-caption") || "";
      else { var p = stage.querySelector('.hotspot-screen[data-screen-id="' + curSid + '"]'); text = (p && p.getAttribute("data-screen-caption")) || ""; }
      cap.textContent = text;
    }
    // called after every screen change (base/show): record the screen, refresh the
    // counter + trail + caption, and test completion. Screen-mode only (popover mode keeps the
    // marker-viewed counter via updateViewedCounter); base/show only run in screen mode.
    function hsAfterNav(stage, curSid) {
      hsMarkVisited(stage, curSid);
      hsUpdateCounter(stage);
      hsRenderTrail(stage);
      hsUpdateCaption(stage, curSid);
      hsCheckComplete(stage, curSid);
    }
    // ---- screen video playback (#217): a screen visual of kind "video" is a screen
    // recording. It autoplays MUTED on screen-enter; "loop" idles/cycles, "play-once"
    // plays through then FREEZES on the last frame and offers a Replay control (author
    // can hide). Reduced motion never autoplays: the first frame shows with a Play
    // affordance. render emits the static <video>; all of this lives here (shared demo +
    // SCORM). A screen becomes "current" via screenBase/screenShow, which call hsSyncVideos.
    function hsReduce() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
    function hsBtnFor(v) {
      if (v.__hsBtn) return v.__hsBtn;
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "hotspot-video-btn"; btn.hidden = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        btn.hidden = true;
        try { v.currentTime = 0; } catch (x) {}
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      });
      if (v.parentNode) v.parentNode.appendChild(btn);
      v.__hsBtn = btn;
      return btn;
    }
    function setupHotspotVideo(v) {
      if (v.__hsSetup) return; v.__hsSetup = true;
      v.muted = true; // keep autoplay-eligible even if the attribute was stripped
      var btn = hsBtnFor(v);
      // 1px playback progress bar along the bottom of the screen: reflect THIS video while it is
      // the current screen's video. currentTime advances continuously, so we sample it every
      // animation frame while playing (smooth), not on the coarse ~4Hz timeupdate (which jumps).
      var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      function progressTick() {
        v.__hsRaf = null;
        if (v.paused || v.ended) return; // stopped -> leave the bar at its last width
        var st = v.closest && v.closest(".hotspot-stage");
        var bar = st && st.querySelector(".hotspot-video-progress");
        if (bar && v.duration && isFinite(v.duration)) bar.style.width = (v.currentTime / v.duration * 100) + "%";
        v.__hsRaf = raf(progressTick);
      }
      v.addEventListener("play", function () { if (!v.__hsRaf) v.__hsRaf = raf(progressTick); });
      v.addEventListener("ended", function () { // pin the bar to 100% on a clean finish
        var st = v.closest && v.closest(".hotspot-stage"); var bar = st && st.querySelector(".hotspot-video-progress");
        if (bar) bar.style.width = "100%";
      });
      // #53: reveal any hotspots on this screen that are gated on the video ending. The video
      // and its markers share a container (the .hotspot-frame for the entry, or the screen's
      // .hotspot-screen panel), so reveal within that host.
      function hsRevealGated() {
        var host = (v.closest && (v.closest(".hotspot-screen") || v.closest(".hotspot-frame"))) || null;
        if (host) qsAll(host, ".hotspot-marker--gated").forEach(function (m) { m.classList.add("is-revealed"); });
      }
      if (v.getAttribute("data-hotspot-video") === "once") {
        v.addEventListener("ended", function () {
          // native freeze on the last frame; offer Replay unless the author hid it
          if (v.getAttribute("data-noreplay") !== "1") { btn.textContent = "Replay"; btn.hidden = false; }
          hsRevealGated();
        });
        // reduced-motion learners don't autoplay -> reveal gated hotspots up front so they are
        // never stranded waiting for an "ended" that won't fire on its own.
        if (hsReduce()) hsRevealGated();
      }
    }
    // play the CURRENT screen's video, pause every other; entry videos are the frame's
    // direct <video> children (no panel), a sub-screen's live inside its .hotspot-screen.
    function hsSyncVideos(stage) {
      var vids = qsAll(stage, ".hotspot-video");
      if (!vids.length) return;
      var open = stage.querySelector(".hotspot-screen:not([hidden])");
      var pbar = stage.querySelector(".hotspot-video-progress"); if (pbar) pbar.style.width = "0%"; // reset; the current video refills via timeupdate
      var reduce = hsReduce();
      vids.forEach(function (v) {
        setupHotspotVideo(v);
        var panel = v.closest ? v.closest(".hotspot-screen") : null;
        var current = open ? (panel === open) : !panel; // base state -> entry (frame) videos
        var btn = v.__hsBtn;
        if (!current) { try { v.pause(); } catch (x) {} if (btn) btn.hidden = true; return; }
        if (reduce) { try { v.pause(); } catch (x) {} if (btn) { btn.textContent = "Play"; btn.hidden = false; } return; }
        if (btn) btn.hidden = true;
        try { v.currentTime = 0; } catch (x) {}
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      });
    }
    // navigate INTO a screen via a marker: push the path, show the panel, and keep
    // the clicked marker as "you are here" (visible only when it's an entry marker;
    // a marker on a now-hidden sub-screen panel simply isn't shown -- Back/Home + the
    // Navigation trail (#218) carry wayfinding deeper in).
    function screenNav(stage, sid, marker) {
      qsAll(stage, ".hotspot-marker").forEach(function (m) { m.classList.remove("is-active"); });
      stage.__hsStack = stage.__hsStack || [];
      stage.__hsStack.push(sid); // push BEFORE show so the Navigation trail path is current
      if (!screenShow(stage, sid)) { stage.__hsStack.pop(); return; } // no destination uploaded -> undo
      if (marker) marker.classList.add("is-active");
    }
    function screenBack(stage) {
      if (stage.__hsLoop) { loopExit(stage); return; } // in a loop, Back just closes the modal
      var st = stage.__hsStack || [];
      st.pop(); // drop the current screen
      qsAll(stage, ".hotspot-marker").forEach(function (m) { m.classList.remove("is-active"); });
      var top = st[st.length - 1];
      if (top) screenShow(stage, top); else screenBase(stage);
    }
    // ---- #224 T6b + QA: loop MODAL ----------------------------------------------
    // A navigate marker targeting a loop opens a contained MODAL (dimmed backdrop + card) that
    // isolates the loop's screens + Prev/Next as a distinct sub-mode -- so the loop reads as a
    // separate thing, not another layer of the tour's own nav. The modal OVERLAYS the screen the
    // learner was on (no back-stack change); exit (x / backdrop / Esc) just hides it and they're
    // back where they came from. The current member's real .hotspot-screen panel is RELOCATED
    // into the modal stage (no duplicated media) and returned to the frame on move/exit. Members
    // are ordinary screens, so hsMarkVisited/counter/completion fire exactly as a nav would.
    function loopModal(stage) { return stage.querySelector(".hotspot-loop-modal"); }
    function loopStageEl(stage) { var m = loopModal(stage); return m && m.querySelector("[data-loop-stage]"); }
    // move the currently-hosted member panel (if any) back to the frame, hidden
    function loopReturnPanel(stage) {
      var ms = loopStageEl(stage); if (!ms) return;
      var frame = stage.querySelector(".hotspot-frame");
      qsAll(ms, ".hotspot-screen").forEach(function (p) { p.hidden = true; if (frame) frame.appendChild(p); });
    }
    function loopShowMember(stage, idx) {
      var st = stage.__hsLoop, lp = st && stage.__hsLoops && stage.__hsLoops[st.id];
      if (!lp) return false;
      var n = lp.screens.length; idx = lp.wrap ? ((idx % n) + n) % n : Math.max(0, Math.min(n - 1, idx));
      var sid = lp.screens[idx];
      var panel = stage.querySelector('.hotspot-screen[data-screen-id="' + sid + '"]');
      if (!panel) return false;
      loopReturnPanel(stage);                 // park the previous member back in the frame
      var ms = loopStageEl(stage); ms.appendChild(panel); panel.hidden = false;
      panel.style.animation = "none"; panel.offsetHeight; panel.style.animation = ""; // restart fade
      st.idx = idx;
      // header + nav state
      var modal = loopModal(stage);
      var title = modal.querySelector("[data-loop-title]"); if (title) title.textContent = lp.name || "Screen states";
      var pos = modal.querySelector("[data-loop-pos]"); if (pos) pos.textContent = (idx + 1) + " / " + n;
      var prev = modal.querySelector("[data-loop-prev]"), next = modal.querySelector("[data-loop-next]");
      if (prev) prev.disabled = !lp.wrap && idx === 0;
      if (next) next.disabled = !lp.wrap && idx === n - 1;
      hsSyncVideos(stage);                    // play the shown member's video, pause the rest
      hsMarkVisited(stage, sid); hsUpdateCounter(stage); hsCheckComplete(stage, sid); // #218 progress
      // #224 QA: once every member of this loop has been seen, highlight the close (x) as a
      // "you've viewed them all -- you can close" cue.
      var allSeen = lp.screens.every(function (id) { return stage.__hsVisited && stage.__hsVisited[id]; });
      modal.classList.toggle("is-loop-complete", allSeen);
      return true;
    }
    function loopExit(stage) {
      if (!stage.__hsLoop) return;
      loopReturnPanel(stage);
      var modal = loopModal(stage); if (modal) { modal.hidden = true; modal.classList.remove("is-loop-complete"); }
      stage.classList.remove("is-loop-open");
      stage.__hsLoop = null;
      hsSyncVideos(stage); // resume the underlying screen's video state
    }
    function loopEnter(stage, loopId) {
      var lp = stage.__hsLoops && stage.__hsLoops[loopId], modal = loopModal(stage);
      if (!lp || !lp.screens.length || !modal) return false;
      qsAll(stage, ".hotspot-marker").forEach(function (m) { m.classList.remove("is-active"); });
      stage.__hsLoop = { id: loopId, idx: 0 };
      if (!loopShowMember(stage, 0)) { stage.__hsLoop = null; return false; }
      modal.hidden = false;
      stage.classList.add("is-loop-open"); // suppresses the base Back/Home/counter behind the dim
      return true;
    }
    function loopGo(stage, delta) {
      var st = stage.__hsLoop, lp = st && stage.__hsLoops && stage.__hsLoops[st.id];
      if (!lp) return;
      loopShowMember(stage, st.idx + delta);
    }
    // HTML-animation marker (srcdoc iframe): on completion, recolour only the KEY
    // (saturated/chromatic) paints to the viewed colour — the orange turns green while
    // white/grey/black stay — by walking the animation's shapes and testing each one's
    // COMPUTED fill/stroke (resolves whatever CSS var / literal drives it, so it doesn't
    // depend on var names). Same-origin (sandbox allows it) so the parent can read/set
    // styles inside the frame; retried on load if the frame wasn't ready. A lone-SVG
    // marker does the equivalent via CSS (.hs-key-fill / .hs-key-stroke) — no JS.
    var MARKER_SHAPE_SEL = "path,circle,ellipse,rect,polygon,polyline,line,g";
    function markerIsSaturated(c) {
      var m = /rgba?\(([^)]+)\)/i.exec(c || ""); if (!m) return false;
      var p = m[1].split(",").map(function (x) { return parseFloat(x); });
      if (p.length >= 4 && p[3] === 0) return false; // fully transparent
      var r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      var s = mx === mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
      return s >= 0.18; // mirrors render isNeutralColor threshold
    }
    function tintMarkerViewed(mk) {
      var fr = mk && mk.querySelector && mk.querySelector(".hotspot-marker__frame");
      if (!fr) return;
      var green = ((typeof getComputedStyle === "function" && getComputedStyle(mk).getPropertyValue("--hotspot-viewed")) || "").trim() || "#3ddc84";
      function apply() {
        try {
          var d = fr.contentDocument, win = fr.contentWindow; if (!d || !win) return;
          Array.prototype.forEach.call(d.querySelectorAll(MARKER_SHAPE_SEL), function (n) {
            if (!n.style) return;
            var cs = win.getComputedStyle(n);
            if (markerIsSaturated(cs.fill)) n.style.setProperty("fill", green, "important");
            if (markerIsSaturated(cs.stroke)) n.style.setProperty("stroke", green, "important");
          });
        } catch (e) {}
      }
      apply();
      fr.addEventListener("load", apply);
    }
    // "X of N viewed" progress counter — recount markers vs .is-viewed on each open.
    function updateViewedCounter(stage) {
      var total = qsAll(stage, ".hotspot-marker").length;
      var viewed = qsAll(stage, ".hotspot-marker.is-viewed").length;
      var counter = stage.querySelector(".hotspot-counter");
      if (counter) {
        counter.textContent = viewed + " of " + total + " viewed";
        if (total > 0 && viewed >= total) counter.classList.add("is-complete");
      }
      // §5 auto-gate: emit once every marker is viewed (independent of the visual
      // counter, so a tracking-on hotspot with no counter still signals completion).
      if (total > 0 && viewed >= total) { try { stage.dispatchEvent(new CustomEvent("hotspot-complete", { bubbles: true })); } catch (e) {} }
    }
    blocks.forEach(function (blk) {
      var stage = blk.querySelector(".hotspot-stage") || blk;
      var track = blk.getAttribute("data-track-viewed") !== "0"; // learner progress cue
      var screenMode = blk.getAttribute("data-mode") === "screen";
      stage.__hsStack = [];
      stage.__hsVisited = {};
      // #224 T6b: index the loops render emitted (id -> ordered members + wrap + name), so
      // the click handler can tell a loop target from a screen target.
      stage.__hsLoops = {};
      qsAll(stage, ".hotspot-loop").forEach(function (meta) {
        var id = meta.getAttribute("data-loop-id"); if (!id) return;
        stage.__hsLoops[id] = {
          screens: (meta.getAttribute("data-loop-screens") || "").split(",").filter(Boolean),
          wrap: meta.getAttribute("data-loop-wrap") === "1",
          name: meta.getAttribute("data-loop-name") || ""
        };
      });
      stage.__hsLoop = null;
      // One handler dispatches by the clicked marker's ACTION, so a screen can mix
      // navigate + card markers (the graph model, not a per-block mode).
      blk.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest(".hotspot-back")) { e.preventDefault(); e.stopPropagation(); screenBack(stage); return; }
        if (e.target.closest && e.target.closest(".hotspot-home")) { e.preventDefault(); e.stopPropagation(); screenBase(stage); return; }
        // #224 T6b: loop carousel forward/back (buttons, not markers) -> cycle within the loop
        if (e.target.closest && e.target.closest("[data-loop-close]")) { e.preventDefault(); e.stopPropagation(); loopExit(stage); return; }
        if (e.target.closest && e.target.closest("[data-loop-prev]")) { e.preventDefault(); e.stopPropagation(); loopGo(stage, -1); return; }
        if (e.target.closest && e.target.closest("[data-loop-next]")) { e.preventDefault(); e.stopPropagation(); loopGo(stage, 1); return; }
        var close = e.target.closest ? e.target.closest(".hotspot-popover__close") : null;
        if (close) { e.preventDefault(); e.stopPropagation(); closePop(close.closest(".hotspot-popover")); return; }
        var marker = e.target.closest ? e.target.closest(".hotspot-marker") : null;
        if (marker) {
          e.preventDefault(); e.stopPropagation();
          if (marker.getAttribute("data-action") === "navigate") {
            closeAll(stage); // leave no popover open across a screen swap
            var tgt = marker.getAttribute("data-target");
            // #224 T6b: a loop target enters the carousel; any other target is a normal
            // screen nav (which also leaves a loop the learner may have been inside).
            if (tgt && stage.__hsLoops[tgt]) loopEnter(stage, tgt);
            else { loopExit(stage); screenNav(stage, tgt, marker); }
          } else {
            openPop(stage, marker);
          }
          if (track) { marker.classList.add("is-viewed"); tintMarkerViewed(marker); if (!screenMode) updateViewedCounter(stage); } // screen-mode progress = screens visited (nav-driven, #218)
          return;
        }
        if (e.target.closest && e.target.closest(".hotspot-popover")) return; // inside content
        closeAll(stage); // clicked the image itself
      });
      hsSyncVideos(stage); // #217: autoplay the entry screen's idle/action video (muted)
      if (screenMode) hsAfterNav(stage, stage.getAttribute("data-hotspot-entry")); // #218 seed: entry visited, counter/trail/completion
    });
    // click anywhere outside a marker/popover, or Esc, closes any open popover
    root.addEventListener("click", function (e) {
      if (e.target.closest && (e.target.closest(".hotspot-marker") || e.target.closest(".hotspot-popover"))) return;
      closeAll();
    });
    root.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      closeAll();
      // #224 QA: Escape exits an open loop modal FIRST (leaving the underlying screen intact);
      // only if no loop is open does it fall through to Home.
      var inLoop = qsAll(root, ".hotspot-stage").filter(function (s) { return s.__hsLoop; });
      if (inLoop.length) { inLoop.forEach(loopExit); return; }
      qsAll(root, ".hotspot-stage.is-screen-open").forEach(function (stage) { screenBase(stage); });
    });
  }

  // ---- footer course-nav (Item FF) -----------------------------------------
  // A .course-nav bar has prev/next arrows + a centre progress bar whose click
  // opens a chapter-jump modal. Prev/next carry data-nav-action and are routed
  // through the engine's main click handler (so page-visited/gates stay reactive);
  // jump buttons reuse [data-goto]. This fn owns only the VIEW: modal open/close
  // and the live progress fill/label/visited-marks, recomputed on every state
  // change. Returns an array of update(state, nav) fns the engine calls in changed().
  // Image lightbox: click any .block-image--zoomable to zoom it into a near-fullscreen
  // overlay (dark backdrop) with its caption; close via X, backdrop, or Esc. ONE overlay
  // per root, populated on click by cloning the image (so per-mode light/dark sources +
  // inline-SVG recolour still apply inside the themed root). DOM-bound; runs in the
  // exported package AND the demo (both call create), never on the authoring canvas.
  function bindImageLightbox(root) {
    var figs = qsAll(root, ".block-image--zoomable");
    if (!figs.length) return;
    var overlay = root.querySelector(".image-lightbox");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "image-lightbox";
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="image-lightbox__backdrop" data-lightbox-close></div>' +
        '<div class="image-lightbox__card">' +
        '<button type="button" class="image-lightbox__close" data-lightbox-close aria-label="Close">×</button>' +
        '<div class="image-lightbox__stage"></div>' +
        '<div class="image-lightbox__cap" hidden></div>' +
        "</div>";
      root.appendChild(overlay);
    }
    var stage = overlay.querySelector(".image-lightbox__stage");
    var cap = overlay.querySelector(".image-lightbox__cap");
    function open(fig) {
      var medias = qsAll(fig, "img, svg");
      if (!medias.length) return;
      stage.innerHTML = "";
      medias.forEach(function (m) {
        var c = m.cloneNode(true);
        c.classList.add("image-lightbox__media");
        c.style.maxWidth = ""; c.style.height = ""; c.style.width = ""; // shed the in-page sizing so it scales to the overlay
        stage.appendChild(c);
      });
      var text = fig.getAttribute("data-caption") || "";
      cap.textContent = text; cap.hidden = !text;
      overlay.hidden = false;
    }
    figs.forEach(function (fig) {
      fig.classList.add("is-lightbox-bound"); // CSS keys the zoom cursor off this (only where clickable)
      fig.addEventListener("click", function () { open(fig); });
    });
    overlay.addEventListener("click", function (e) {
      if ((e.target.closest && e.target.closest("[data-lightbox-close]")) ||
          !(e.target.closest && e.target.closest(".image-lightbox__card"))) overlay.hidden = true;
    });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") overlay.hidden = true; });
  }

  // Keep a tour label fully inside the course frame. The label is centred over its dot
  // (transform: translateX(-50%)); we measure its natural box and, if it spills past the
  // frame edge (e.g. the far-left Back / far-right Next markers, or a narrow viewport),
  // set --tour-shift so CSS slides it inward. Bound = the nearest .course-root/.scorm-page
  // (the visible frame in both the exported package and the editor demo device), else the
  // viewport. Reset first so each measure is from the natural position, not a stale shift.
  function clampTourLabel(label) {
    if (!label) return;
    label.style.removeProperty("--tour-shift");
    var host = (label.closest && (label.closest(".scorm-page") || label.closest(".course-root"))) || null;
    var left, right;
    if (host) { var hr = host.getBoundingClientRect(); left = hr.left; right = hr.right; }
    else { var de = label.ownerDocument.documentElement; left = 0; right = de.clientWidth; }
    var r = label.getBoundingClientRect(), m = 8, shift = 0;
    if (r.left < left + m) shift = (left + m) - r.left;
    else if (r.right > right - m) shift = (right - m) - r.right;
    if (shift) label.style.setProperty("--tour-shift", Math.round(shift) + "px");
  }
  function bindCourseNav(root) {
    var bars = qsAll(root, ".course-nav");
    if (!bars.length) return [];
    function closeModals(except) {
      qsAll(root, ".course-nav__modal").forEach(function (m) { if (m !== except) m.hidden = true; });
      qsAll(root, ".glossary-pop").forEach(function (o) { if (o !== except) o.hidden = true; }); // §1: Esc / outside also dismiss the glossary
    }
    bars.forEach(function (bar) {
      var prog = bar.querySelector(".course-nav__progress");
      var modal = bar.querySelector(".course-nav__modal");
      // §1 glossary: the pill button toggles an anchored term/definition popover with a
      // live case-insensitive filter over term + definition. Only one popover (chapter /
      // glossary) is open at a time (closeModals closes both).
      var gbtn = bar.querySelector(".course-nav__glossary");
      var gpop = bar.querySelector(".glossary-pop");
      if (gbtn && gpop) {
        gbtn.addEventListener("click", function (e) {
          e.stopPropagation();
          var open = gpop.hidden;
          closeModals(open ? gpop : null);
          gpop.hidden = !open;
          if (!gpop.hidden) { var fin = gpop.querySelector("[data-glossary-filter]"); if (fin) setTimeout(function () { try { fin.focus(); } catch (_) {} }, 0); }
        });
        var filterIn = gpop.querySelector("[data-glossary-filter]");
        if (filterIn) {
          filterIn.addEventListener("click", function (e) { e.stopPropagation(); }); // typing in the box must not toggle the chapter modal
          filterIn.addEventListener("input", function () {
            var q = filterIn.value.trim().toLowerCase();
            var shown = 0;
            qsAll(gpop, ".glossary-pop__row").forEach(function (r) {
              var match = !q || (r.getAttribute("data-term") || "").indexOf(q) !== -1;
              r.hidden = !match; if (match) shown++;
            });
            var empty = gpop.querySelector(".glossary-pop__empty");
            if (empty) empty.hidden = shown !== 0;
          });
        }
      }
      if (prog && modal) {
        prog.addEventListener("click", function (e) {
          if (e.target.closest && (e.target.closest(".course-nav__modal") || e.target.closest(".glossary-pop") || e.target.closest(".course-nav__glossary") || e.target.closest("[data-mode-toggle]"))) return; // chapter modal / glossary / language / mode-toggle handled elsewhere
          e.stopPropagation();
          var open = modal.hidden;
          closeModals(open ? modal : null);
          modal.hidden = !open;
        });
        modal.addEventListener("click", function (e) {
          if (e.target.closest && e.target.closest("[data-modal-close]")) { e.stopPropagation(); modal.hidden = true; return; } // the top-right × dismisses
          var jump = e.target.closest && e.target.closest(".course-nav__jump");
          if (jump && jump.classList.contains("is-locked")) { // C: can't jump forward to a locked chapter
            e.stopPropagation(); e.preventDefault(); // block the engine's [data-goto] handler; keep the modal open
            jump.classList.add("is-nudge"); setTimeout(function () { jump.classList.remove("is-nudge"); }, 380);
            return;
          }
          if (e.target.closest && e.target.closest("[data-goto]")) modal.hidden = true; // nav handled by engine
        });
      }
      // Guided tour: each dot toggles its own label (accordion — opening one closes
      // the others); hover highlights the whole marker. WHEN the tour is live (which
      // page) is owned by the per-bar update fn below via .is-tour-live. Learner-only:
      // the author canvas never runs the runtime, so authoring stays clutter-free.
      var tourMarks = qsAll(bar, ".course-tour");
      if (tourMarks.length) {
        var closeTour = function (except) {
          tourMarks.forEach(function (m) {
            if (m === except) return;
            qsAll(m, ".course-tour__dot, .course-tour__conn, .course-tour__label").forEach(function (x) { x.classList.remove("is-open"); });
            var lb = m.querySelector(".course-tour__label"); if (lb) lb.style.removeProperty("--tour-shift");
          });
        };
        tourMarks.forEach(function (m) {
          var dot = m.querySelector(".course-tour__dot");
          var conn = m.querySelector(".course-tour__conn");
          var label = m.querySelector(".course-tour__label");
          if (dot) dot.addEventListener("click", function (e) {
            e.stopPropagation();
            var open = !dot.classList.contains("is-open");
            closeTour(open ? m : null);
            dot.classList.toggle("is-open", open);
            dot.classList.add("is-visited");
            // replay draw/rise by removing then re-adding on the next frame
            [conn, label].forEach(function (x) { if (!x) return; x.classList.remove("is-open"); if (open) { void x.offsetWidth; x.classList.add("is-open"); } });
            if (label) { if (open) clampTourLabel(label); else label.style.removeProperty("--tour-shift"); }
          });
          m.addEventListener("mouseenter", function () { [dot, conn, label].forEach(function (x) { if (x) x.classList.add("is-hot"); }); });
          m.addEventListener("mouseleave", function () { [dot, conn, label].forEach(function (x) { if (x) x.classList.remove("is-hot"); }); });
        });
        // Keep any open label inside the frame as the viewport resizes.
        var tourWin = (bar.ownerDocument && bar.ownerDocument.defaultView) || window;
        tourWin.addEventListener("resize", function () { qsAll(bar, ".course-tour__label.is-open").forEach(clampTourLabel); });
      }
    });
    // click outside any nav closes open modals
    root.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".course-nav")) return;
      closeModals(null);
    });
    root.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModals(null);
    });
    return bars.map(function (bar) {
      var map; try { map = JSON.parse(bar.getAttribute("data-nav-map") || "[]"); } catch (_) { map = []; }
      var fill = bar.querySelector(".course-nav__fill");
      var label = bar.querySelector(".course-nav__label");
      var menuLabel = bar.getAttribute("data-nav-menu-label") || "Menu";
      var jumps = qsAll(bar, ".course-nav__jump");
      var tourPage = bar.getAttribute("data-tour-page"); // null = tour off; "" = every page; else the trigger page id
      return function update(state, nav) {
        var cur = nav.currentPageId ? nav.currentPageId() : null;
        // Guided tour reveal: live on the trigger page (or every page when unset). Auto
        // every visit -> drop .is-tour-live on leaving so a return re-pops the dots and
        // clears any label the learner had opened.
        if (tourPage !== null) {
          var live = (tourPage === "" || tourPage === cur);
          if (live !== bar.classList.contains("is-tour-live")) {
            bar.classList.toggle("is-tour-live", live);
            if (!live) qsAll(bar, ".course-tour__dot, .course-tour__conn, .course-tour__label").forEach(function (x) { x.classList.remove("is-open", "is-visited"); });
          }
        }
        var idx = -1;
        for (var i = 0; i < map.length; i++) { if (map[i].pages.indexOf(cur) >= 0) { idx = i; break; } }
        var n = map.length;
        // Fill advances one page-step across the whole course (smooth), while the
        // label names the current chapter (chapter-scoped context). pos = 1-based
        // global page index of `cur`; total = every page across all sections.
        var pos = 0, total = 0, found = false;
        for (var s = 0; s < map.length; s++) {
          var pgs = map[s].pages || [];
          if (!found) { var at = pgs.indexOf(cur); if (at >= 0) { pos = total + at + 1; found = true; } }
          total += pgs.length;
        }
        if (fill) fill.style.width = (total ? Math.round((pos / total) * 100) : 0) + "%";
        if (label) label.textContent = idx >= 0 ? (map[idx].label || (idx + 1) + " of " + n) : menuLabel;
        // C: progressive chapter unlock. Furthest reached section = the highest one with
        // any visited page (at least the current). Sections up to there are unlocked
        // (revisitable — back always works); LATER sections are LOCKED (greyed, not
        // jumpable) so the learner can't skip forward. They unlock as they reach them.
        var reached = idx;
        if (state.__gated) {
          // §2 gated: unlock up to the first chapter whose PREDECESSOR's KC hasn't
          // passed (linear KC-gated), current chapter always reachable.
          reached = 0;
          for (var gi = 1; gi < n; gi++) { if (state.kcPassed && map[gi - 1] && state.kcPassed[map[gi - 1].id]) reached = gi; else break; }
          reached = Math.max(reached, idx);
        } else {
          map.forEach(function (sec, si) { if ((sec.pages || []).some(function (p) { return state.visited[p]; })) reached = Math.max(reached, si); });
        }
        map.forEach(function (sec, si) {
          var done = sec.pages.length > 0 && sec.pages.every(function (p) { return state.visited[p]; });
          var locked = si > reached;
          var j = jumps[si]; if (!j) return;
          j.classList.toggle("is-done", done);
          j.classList.toggle("is-current", si === idx);
          j.classList.toggle("is-locked", locked);
          j.setAttribute("aria-disabled", locked ? "true" : "false");
        });
      };
    });
  }

  // ---- CCCC: scroll-completion gate ----------------------------------------
  // Hide the footer Next button until the learner has reached the BOTTOM of the
  // current page (or the page already fits the viewport, so there's nothing to
  // scroll). Reaching the bottom also marks the page reached (-> visited ->
  // completion). Runs identically in the editor demo and the exported package
  // (both call create()); the editor CANVAS never calls create(), so its Next
  // stays visible. Fails OPEN — any ambiguity reveals Next, never trapping the
  // learner on a page that can't be scrolled.
  function bindScrollGate(root, nav, onReach) {
    var docEl = root.ownerDocument || (root.nodeType === 9 ? root : document);
    var win = docEl.defaultView || window;
    var pages = qsAll(root, ".page[data-page-id]");
    if (!pages.length) pages = qsAll(root, "[data-page-id]");
    var boxOf = function (p) { return (p.closest && (p.closest(".scorm-page") || p.closest(".course-root"))) || p; };
    var boxes = pages.map(boxOf);
    // stamp every page box as gated so CSS hides its Next until the page completes
    boxes.forEach(function (b) { if (b && b.classList) b.classList.add("rt-gated"); });

    function scrollerFor(box) {
      var n = box;
      while (n && n.parentElement) {
        var s = win.getComputedStyle ? win.getComputedStyle(n) : null;
        if (s && /(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
        n = n.parentElement;
      }
      return docEl.scrollingElement || docEl.documentElement;
    }
    function atBottom(sc) {
      if (!sc) return true;                         // fail-open
      var sh = sc.scrollHeight, ch = sc.clientHeight;
      if (sh <= ch + 2) return true;                // page fits -> already at bottom
      return (sc.scrollTop + ch) >= (sh - 2);
    }
    function curBox() {
      var pid = nav.currentPageId && nav.currentPageId();
      if (pid) { for (var i = 0; i < pages.length; i++) if (pages[i].getAttribute("data-page-id") === pid) return boxes[i]; }
      return boxes[0] || null;
    }
    function evaluate() {
      var box = curBox(); if (!box) return;
      if (atBottom(scrollerFor(box))) {
        if (box.classList) box.classList.add("is-scroll-done");
        var pid = nav.currentPageId && nav.currentPageId();
        if (pid && onReach) onReach(pid);
      }
    }
    // on arrival at a page: reset scroll to its top, then evaluate (short pages
    // complete immediately; tall pages wait for the learner to scroll down).
    function arrive() {
      var box = curBox();
      if (box) { var sc = scrollerFor(box); try { if (sc && sc.scrollTo) sc.scrollTo(0, 0); else if (sc) sc.scrollTop = 0; } catch (_) {} }
      evaluate();
    }
    if (win.addEventListener) {
      win.addEventListener("scroll", evaluate, true); // capture: catch inner scrollers too
      win.addEventListener("resize", evaluate);
    }
    return { evaluate: evaluate, arrive: arrive };
  }

  // Learner keyboard scrolling: on a long page the arrow / Page keys should SCROLL
  // it (browser default doesn't reach the page's inner overflow owner). Maps
  // ArrowDown/Up -> a line, PageDown/Up -> ~a viewport, onto the CURRENT page's real
  // scroll owner (same walk bindScrollGate uses). Guarded so it never fires while a
  // field / quiz / modal has focus, and never with a modifier held. The scrollBy
  // fires a scroll event, so the scroll-completion gate still evaluates normally.
  function bindKeyboardScroll(root, nav) {
    var docEl = root.ownerDocument || (root.nodeType === 9 ? root : document);
    var win = docEl.defaultView || window;
    function boxOf(p) { return (p.closest && (p.closest(".scorm-page") || p.closest(".course-root"))) || p; }
    function scrollerFor(box) {
      var n = box;
      while (n && n.parentElement) {
        var s = win.getComputedStyle ? win.getComputedStyle(n) : null;
        if (s && /(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
        n = n.parentElement;
      }
      return docEl.scrollingElement || docEl.documentElement;
    }
    function curScroller() {
      var pid = nav.currentPageId && nav.currentPageId();
      var page = pid ? docEl.querySelector('[data-page-id="' + pid + '"]') : null;
      var box = page ? boxOf(page) : (docEl.querySelector(".scorm-page.is-current") || docEl.querySelector(".course-root"));
      return box ? scrollerFor(box) : (docEl.scrollingElement || docEl.documentElement);
    }
    function blocked(t) {
      if (!t) return false;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true;
      if (t.closest && t.closest(".quiz, .kc")) return true; // let quiz option keys work
      return !!(docEl.querySelector && docEl.querySelector(".glossary-pop:not([hidden]), .image-lightbox:not([hidden]), .hotspot-popover:not([hidden])"));
    }
    docEl.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (blocked(e.target)) return;
      var sc = curScroller(); if (!sc) return;
      var vp = (sc.clientHeight || win.innerHeight || 600) * 0.9, dy;
      if (e.key === "ArrowDown") dy = 64;
      else if (e.key === "ArrowUp") dy = -64;
      else if (e.key === "PageDown") dy = vp;
      else if (e.key === "PageUp") dy = -vp;
      else return;
      e.preventDefault();
      if (sc.scrollBy) sc.scrollBy(0, dy); else sc.scrollTop += dy;
    });
  }

  // JJJ: auto-hide a pinned header on scroll-DOWN, reveal on scroll-UP / near the
  // top / pointer near the top edge -- so a long page reads uncluttered but the
  // header (and any learner mode toggle in it) is one gesture away. Base pin is CSS
  // sticky (works with no JS); this only adds the show/hide animation. Runs in the
  // demo AND the exported package (both call CourseRuntime.create) = same behaviour.
  // Honours prefers-reduced-motion by leaving the header always visible.
  function bindPinnedHeader(root) {
    var docEl = root.ownerDocument || (root.nodeType === 9 ? root : document);
    var win = docEl.defaultView || window;
    var headers = qsAll(root, ".course-header--pinned");
    if (!headers.length || !win.addEventListener) return;
    if (win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var lastTop = 0;
    function onScroll(e) {
      var t = e && e.target;
      var sc = (t && t.nodeType === 1 && typeof t.scrollTop === "number") ? t : (docEl.scrollingElement || docEl.documentElement);
      var top = (sc && sc.scrollTop) || 0;
      var hide = top > lastTop && top > 60;         // scrolling down and past the header
      headers.forEach(function (h) { h.classList.toggle("is-hidden", hide); });
      lastTop = top < 0 ? 0 : top;
    }
    win.addEventListener("scroll", onScroll, true);  // capture: catch inner scrollers too
    win.addEventListener("mousemove", function (e) {  // hover near the top edge reveals
      if (e.clientY != null && e.clientY < 10) headers.forEach(function (h) { h.classList.remove("is-hidden"); });
    });
  }

  // TTTT: Card Reveal explicit toggle. Hover/focus reveal is pure CSS; this adds a
  // click/tap + Enter/Space toggle of `.is-revealed` (sticky reveal) so touch users
  // get a deliberate reveal, in the editor demo AND the exported package.
  function bindCardReveal(root) {
    // §5 auto-gate: once every card in a grid is revealed, emit a bubbling event so
    // CourseRuntime can mark the block complete (sticky — a later flip-back keeps it done).
    function maybeCardComplete(grid) {
      if (!grid) return;
      var cards = qsAll(grid, ".card-reveal__card");
      if (cards.length && cards.every(function (c) { return c.classList.contains("is-revealed"); })) {
        try { grid.dispatchEvent(new CustomEvent("card-reveal-complete", { bubbles: true })); } catch (e) {}
      }
    }
    qsAll(root, ".card-reveal__card").forEach(function (card) {
      var grid = card.closest ? card.closest(".card-reveal") : null;
      var isFlip = grid && grid.getAttribute("data-reveal-style") === "flip";
      if (isFlip) {
        // Flip mode: the whole card TOGGLES so a flipped card can flip BACK. Guard clicks on
        // an interactive child (link/button) so they aren't swallowed — but NOT the cover:
        // in flip mode the front FACE *is* `.card-reveal__cover` (the "Flip" hint), so excluding
        // it swallowed every click on the card front and the flip never fired.
        card.addEventListener("click", function (e) {
          if (e.target.closest && e.target.closest("a, button")) return;
          card.classList.toggle("is-revealed"); maybeCardComplete(grid);
        });
        card.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.classList.toggle("is-revealed"); maybeCardComplete(grid); }
        });
      } else {
        // Frost "hold to reveal": a CLICK LATCHES the card open INDEFINITELY (add, not toggle),
        // bound on the CARD (not the cover) so it still fires after :hover has cleared the cover
        // — a cover-only handler misses clicks that land on the revealed content beneath, which
        // is why it wouldn't "stay open". Interactive children (link/button) are excluded.
        card.addEventListener("click", function (e) {
          if (e.target.closest && e.target.closest("a, button")) return;
          card.classList.add("is-revealed"); maybeCardComplete(grid);
        });
        card.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.classList.add("is-revealed"); maybeCardComplete(grid); }
        });
      }
    });
  }

  // Card Deck paging engine. Shows ONE card at a time; the ‹ › arrows advance/retreat an
  // active index (clamped at both ends — no wrap), the counter follows. Runtime-gated via
  // `is-armed` so the EDITOR canvas (never runs the runtime) shows every card stacked and
  // droppable. Each card carries its own footer arrows; only the active card's are live.
  function bindCardDeck(root) {
    qsAll(root, ".card-deck").forEach(function (deck) {
      var cards = qsAll(deck, ".card-deck__card");
      if (!cards.length) return;
      var active = 0;
      function paint() {
        cards.forEach(function (c, i) { c.classList.toggle("is-active", i === active); });
        var ac = cards[active];
        var p = ac.querySelector(".card-deck__prev");
        var n = ac.querySelector(".card-deck__next");
        if (p) p.disabled = active <= 0;
        if (n) n.disabled = active >= cards.length - 1;
      }
      cards.forEach(function (c) {
        var p = c.querySelector(".card-deck__prev");
        var n = c.querySelector(".card-deck__next");
        if (p) p.addEventListener("click", function () { if (active > 0) { active--; paint(); } });
        if (n) n.addEventListener("click", function () { if (active < cards.length - 1) { active++; paint(); } });
      });
      deck.classList.add("is-armed");
      paint();
    });
  }

  // FLAGSHIP Sequence reveal engine (slice 3). ONE engine, three author-selected modes
  // read from data-seq-reveal, decoupled from any scroll container:
  //   scroll  - each step reveals on viewport entry (staggered along the spine) and its
  //             connector fills; a dedicated IntersectionObserver (the page-level
  //             bindScrollGate is a completion gate, not an element observer, so this is
  //             the same technique applied per step).
  //   click   - cumulative wizard: the ‹ › arrows advance an active index; steps after it
  //             are hidden (JS-only, so the EDITOR still shows every step).
  //   static  - all shown, no animation.
  // prefers-reduced-motion forces the static outcome (steps shown, no observer, no fill anim).
  function bindSequence(root) {
    var docEl = root.ownerDocument || (root.nodeType === 9 ? root : document);
    var win = docEl.defaultView || window;
    var reduce = !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    qsAll(root, ".seq").forEach(function (seq) {
      var mode = seq.getAttribute("data-seq-reveal");
      var steps = qsAll(seq, ".seq__step");
      // Completion (§5 auto-gate): "done" once the learner reaches the last step (click) or
      // every step has revealed (scroll/static). Bubbling sequence-complete, emitted once.
      var seqDone = false;
      function seqComplete() { if (seqDone || !steps.length) return; seqDone = true; try { seq.dispatchEvent(new CustomEvent("sequence-complete", { bubbles: true })); } catch (e) {} }
      if (mode === "click") {
        var prev = seq.querySelector(".seq__wizard-prev");
        var next = seq.querySelector(".seq__wizard-next");
        var counter = seq.querySelector(".seq__counter");
        var active = 0;
        var paint = function () {
          steps.forEach(function (s, i) { s.classList.toggle("is-future", i > active); });
          if (counter) counter.textContent = (active + 1) + " / " + steps.length;
          if (prev) prev.disabled = active <= 0;
          if (next) next.disabled = active >= steps.length - 1;
          if (active >= steps.length - 1) seqComplete();
        };
        if (prev) prev.addEventListener("click", function () { if (active > 0) { active--; paint(); } });
        if (next) next.addEventListener("click", function () { if (active < steps.length - 1) { active++; paint(); } });
        paint();
        return;
      }
      if (mode === "scroll" && !reduce && win.IntersectionObserver) {
        // Arm the block so CSS hides not-yet-revealed steps. Runtime-gated (never a bare
        // selector) so the EDITOR canvas — which doesn't run the runtime — shows every step.
        seq.classList.add("is-armed");
        var io = new win.IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
          if (steps.every(function (s) { return s.classList.contains("is-in"); })) seqComplete();
        }, { threshold: 0.2 });
        steps.forEach(function (s) { io.observe(s); });
        return;
      }
      // static, reduced-motion, or no-IO fallback: reveal everything up front
      steps.forEach(function (s) { s.classList.add("is-in"); });
      seqComplete();
    });
  }

  // ---- the engine ----------------------------------------------------------
  function create(opts) {
    opts = opts || {};
    var root = opts.root || document;
    var map = opts.interactions || {};
    var nav = opts.nav || defaultNav(root);
    var onComplete = opts.onComplete || noop;
    var onStateChange = opts.onStateChange || noop;
    var onExit = opts.onExit || defaultExit;

    // completion buckets keyed by block id. viewed/revealed/quizDone are the §5
    // auto-gate signals (all-hotspots-viewed / all-cards-revealed / quiz finished),
    // emitted via bubbling DOM events like kc-complete so bind* stay decoupled.
    var state = { visited: {}, watched: {}, checked: {}, viewed: {}, revealed: {}, quizDone: {}, sequenceDone: {}, accordionDone: {} };
    var gateIdCtr = 0;
    // Auto-gate tracks completion by block id, but a block's id is LAZY (minted only
    // when it gains an authored interaction) — so a plain hotspot / card grid / sequence
    // has none and was silently skipped by the page gate. Stamp a stable transient id on
    // any detectable host that lacks one, so both autoGateTargets (require it) and markDone
    // (record it) resolve to the SAME key. Reuses a real ancestor id when present.
    function ensureGateId(el) {
      if (!el || !el.getAttribute) return null;
      var h = el.closest ? el.closest("[data-id]") : null;
      if (h && h.getAttribute("data-id")) return h.getAttribute("data-id");
      var id = "rtg_" + (++gateIdCtr);
      el.setAttribute("data-id", id);
      return id;
    }
    var gates = [];       // { id, el, gate }
    var vimeoHosts = [];  // { id, frame }
    var navUpdaters = []; // footer course-nav view updaters (set after bind)
    var scrollGate = null; // CCCC: scroll-completion gate (set after bind)
    var completed = false;

    // ---- §2 chapter progression (opt-in via data-gated-progression) ----------
    // Quiz-pass unlocks the next chapter: hard-blocks the footer Next at a chapter's
    // last page until its KC passes, locks later chapters in the jump menu, reveals
    // the chapter recap, and gates course-completion. Ungated -> none of this runs.
    // root can be `document` (export → find the course-root descendant) OR the
    // course-root element itself (demo → the attr is on root, which querySelector
    // does NOT match), so check both.
    var gated = !!((root.getAttribute && root.getAttribute("data-gated-progression")) || (root.querySelector && root.querySelector("[data-gated-progression]")));
    state.kcPassed = {};   // { chapterId: true }
    // #87: transient per-chapter hold that keeps the footer Next DISABLED for a
    // standard beat after a KC pass, so the learner actually sees the completion
    // panel / chapter summary instead of clicking straight through. kcPassed still
    // flips immediately (it drives chapter reachability + course completion); only
    // the Next-ENABLE is delayed, via this hold + a setTimeout that clears it.
    state.kcHold = {};     // { chapterId: true } while the post-pass hold is active
    state.__gated = gated; // read by the course-nav update fn (has `state`, not this scope)
    var chapMap = [], chapterOfPage = {}, chapterHasQuiz = {};
    (function () {
      var navEl = root.querySelector && root.querySelector(".course-nav[data-nav-map]");
      try { chapMap = navEl ? JSON.parse(navEl.getAttribute("data-nav-map") || "[]") : []; } catch (_) { chapMap = []; }
      chapMap.forEach(function (c) { (c.pages || []).forEach(function (pid) { chapterOfPage[pid] = c.id; }); });
    })();
    function chapterOfEl(el) {
      var pg = el && el.closest && el.closest(".page[data-page-id]");
      return pg ? chapterOfPage[pg.getAttribute("data-page-id")] : null;
    }
    var KC_UNLOCK_MS = 3000; // #87: standard post-KC-pass hold before Next unlocks
    if (gated) {
      qsAll(root, "[data-quiz]").forEach(function (q) { var c = chapterOfEl(q); if (c) chapterHasQuiz[c] = true; });
      // a chapter with NO knowledge check auto-passes (never a dead-end)
      chapMap.forEach(function (c) { if (!chapterHasQuiz[c.id]) state.kcPassed[c.id] = true; });
      root.addEventListener("kc-complete", function (e) {
        var c = chapterOfEl(e.target);
        if (c && !state.kcPassed[c]) {
          // #87: flip kcPassed at once (reachability + completion stay correct), but
          // hold the Next-ENABLE for a standard beat. The gate (kcGateAllows) treats a
          // held chapter as still-blocked at its last page, so the footer Next shows
          // DISABLED until the timer clears the hold and re-runs the gates.
          state.kcPassed[c] = true; state.kcHold[c] = true; changed();
          setTimeout(function () { delete state.kcHold[c]; changed(); }, KC_UNLOCK_MS);
        }
      });
    }
    // §64: the per-block recap reveal path was retired — the chapter summary now
    // lives in the pass-gated quiz completion panel (kc-done__summary), so there is
    // nothing to reveal here.

    function elFor(id) { return root.querySelector('[data-id="' + id + '"]'); }

    // set inner controls (and the element itself if it is a control) disabled;
    // <a> uses aria-disabled since it has no `disabled` property.
    function setControlsDisabled(el, dis) {
      qsAll(el, "button, input, select, textarea, a").forEach(function (c) {
        if (c.tagName === "A") { if (dis) c.setAttribute("aria-disabled", "true"); else c.removeAttribute("aria-disabled"); }
        else c.disabled = dis;
      });
      if (/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.disabled = dis;
    }

    // ---- actions ----
    // ---- global motion: chapter-change fade ---------------------------------
    // On a page swap that CROSSES a chapter boundary, re-trigger the .is-chapter-enter
    // opacity fade on the incoming page box (CSS owns the duration via --motion-chapter-fade
    // + prefers-reduced-motion). lastChapter seeds from the current page so the very first
    // navigation is judged against the real starting chapter (no fade on init).
    var lastChapter = null;
    function currentBox() {
      var pid = nav.currentPageId && nav.currentPageId();
      var pageEl = pid ? root.querySelector('.page[data-page-id="' + pid + '"]') : null;
      return (pageEl && pageEl.closest && (pageEl.closest(".scorm-page") || pageEl.closest(".course-root"))) || pageEl;
    }
    function chapterOfCurrent() {
      var box = currentBox();
      var cr = box && box.classList && box.classList.contains("course-root") ? box : (box && box.querySelector ? box.querySelector(".course-root") : null);
      var c = cr && cr.getAttribute ? cr.getAttribute("data-chapter-id") : null;
      if (c) return c;
      var pid = nav.currentPageId && nav.currentPageId();
      return pid ? (chapterOfPage[pid] || null) : null;
    }
    function maybeChapterFade() {
      var ch = chapterOfCurrent();
      if (lastChapter != null && ch && ch !== lastChapter) {
        var box = currentBox();
        if (box && box.classList) { box.classList.remove("is-chapter-enter"); void box.offsetWidth; box.classList.add("is-chapter-enter"); }
      }
      lastChapter = ch;
    }

    function afterNav() {
      // Every page starts AT THE TOP. The scroll reset used to live ONLY in the
      // scroll-gate's arrive(), so a course WITHOUT scroll-gating never reset scroll on
      // nav and landed mid-page. Reset unconditionally here. (Fix 2026-07-08.)
      if (!scrollGate) {
        try {
          var __box = currentBox();
          var __sc = (__box && __box.parentElement) ? __box : null; // page box (may itself scroll)
          if (__box) { __box.scrollTop = 0; }
          var __d = (typeof document !== "undefined") && (document.scrollingElement || document.documentElement);
          if (__d) __d.scrollTop = 0;
          if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
        } catch (_) {}
      }
      // CCCC: a page counts as reached when its bottom is seen (or it fits) — the
      // gate marks visited via onReach. Without a gate, mark on arrival as before.
      if (scrollGate) scrollGate.arrive();
      else { var pid = nav.currentPageId && nav.currentPageId(); if (pid) state.visited[pid] = true; }
      maybeChapterFade();
      changed();
    }
    function setVisible(id, vis) { var e = elFor(id); if (e) e.hidden = !vis; changed(); }
    function toggleVisible(id) { var e = elFor(id); if (e) e.hidden = !e.hidden; changed(); }
    function setEnabled(id, en) {
      var e = elFor(id); if (!e) return;
      e.classList.toggle("is-locked", !en);
      e.setAttribute("aria-disabled", en ? "false" : "true");
      setControlsDisabled(e, !en);
      changed();
    }
    // B: forward-lock — the learner can't advance (Next button OR keyboard, which both
    // route through here / the nav adapter) until the CURRENT page's CCCC scroll-gate is
    // satisfied (bottom reached). Encourages consuming the page; prev/back always free.
    // A non-gated page (no scroll-gate) or a page already scroll-done advances freely.
    // §2 gated: is leaving the CURRENT page allowed by the chapter KC-gate? Blocks
    // only at a chapter's LAST page until its KC passes (free within a chapter; a
    // no-quiz chapter auto-passes). Used by canAdvance AND gateFooterNav (so the
    // Next button is visibly DISABLED, not just click-inert). Ungated -> always true.
    /* @kcgate-start */
    // PURE (#87): is leaving page `pid` allowed by the chapter KC-gate? Blocks at a
    // chapter's LAST page until its KC passes AND its post-pass hold has cleared; free
    // within a chapter and for any passed+unheld chapter. Ungated -> always true.
    function kcGateAllows(gated, kcPassed, kcHold, chapterOfPage, chapMap, pid) {
      if (!gated || !pid) return true;
      var ch = chapterOfPage[pid];
      if (!ch) return true;
      if (kcPassed[ch] && !(kcHold && kcHold[ch])) return true; // passed + not holding -> free
      var chObj = null; for (var i = 0; i < chapMap.length; i++) if (chapMap[i].id === ch) chObj = chapMap[i];
      var pages = (chObj && chObj.pages) || [];
      return !(pages.length && pages[pages.length - 1] === pid); // on the last page + (unpassed OR held) -> blocked
    }
    /* @kcgate-end */
    function chapterAdvanceOk() {
      var pid = nav.currentPageId && nav.currentPageId();
      return kcGateAllows(gated, state.kcPassed, state.kcHold, chapterOfPage, chapMap, pid);
    }
    function canAdvance() {
      if (!chapterAdvanceOk()) return false;
      var pid = nav.currentPageId && nav.currentPageId();
      if (!pid) return true;
      var pageEl = root.querySelector('.page[data-page-id="' + pid + '"]');
      var box = (pageEl && pageEl.closest && (pageEl.closest(".scorm-page") || pageEl.closest(".course-root"))) || pageEl;
      if (!box || !box.classList || !box.classList.contains("rt-gated")) return true;
      return box.classList.contains("is-scroll-done");
    }
    function runAction(a) {
      if (!a) return;
      switch (a.type) {
        case "goto": nav.goto(a.target); afterNav(); break;
        case "next": if (!canAdvance()) break; nav.next(); afterNav(); break;
        case "prev": nav.prev(); afterNav(); break;
        case "show": setVisible(a.target, true); break;
        case "hide": setVisible(a.target, false); break;
        case "enable": setEnabled(a.target, true); break;
        case "toggle": toggleVisible(a.target); break;
        case "exit": onExit(); break;
      }
    }

    // ---- conditions + gates ----
    function evalCondition(c) {
      if (!c) return true;
      if (c.allOf) return c.allOf.every(evalCondition);
      if (c.anyOf) return c.anyOf.some(evalCondition); // deferred in v1; harmless if authored
      if (c.source && c.is) {
        // Checkbox gates track the LIVE box, not a sticky bucket. An acknowledgement
        // checkbox ("I agree…") must deactivate Next the moment it reads unchecked —
        // including on RETURN to a page where the box has reset — so the gate is a plain
        // boolean of the checkbox's current state. Other signals (viewed/revealed/watched/
        // quizDone) stay sticky-once-done. Falls back to the bucket if no box is found.
        if (c.is === "checked") {
          var host = elFor(c.source);
          var box = host && host.querySelector ? host.querySelector('input[type="checkbox"]') : null;
          if (box) return !!box.checked;
        }
        var bucket = state[c.is]; return !!(bucket && bucket[c.source]);
      }
      return true;
    }
    function applyGates() {
      gates.forEach(function (g) {
        var ok = evalCondition(g.gate.when);
        var el = g.el || (g.el = elFor(g.id));
        if (!el) return;
        if (g.gate.mode === "hide") {
          el.hidden = !ok;
        } else {
          el.classList.toggle("is-locked", !ok);
          el.setAttribute("aria-disabled", ok ? "false" : "true");
          setControlsDisabled(el, !ok);
        }
      });
    }

    // §5 auto-gate ALL interactions: when a course-root carries data-gate-all, derive the
    // DETECTABLE interactions on a page from the DOM and require each complete before Next.
    // Pure-derived (nothing authored): checkbox->checked, video/Vimeo->watched, tracked
    // hotspot->viewed (all markers), card grid->revealed (all cards), quiz->quizDone.
    // Opaque interactions (HTML-embed iframes) have no signal and are intentionally omitted,
    // so a page can never trap the learner. Each target is a plain {source,is} condition
    // that evalCondition already understands (state[is][source]).
    // A page gates its Next when render stamped data-gate-page="1" on it (course-wide
    // doc.gateAllInteractions default, overridable per page). Per-page, not course-root,
    // so an author can require interactions on some pages only.
    function pageGates(pageEl) { return !!(pageEl && pageEl.getAttribute && pageEl.getAttribute("data-gate-page") === "1"); }
    function autoGateTargets(pageEl) {
      if (!pageEl) return [];
      var out = [], seen = {};
      // `el` = the element to key on; ensureGateId gives it a stable id (reusing a real
      // ancestor id, else a transient one) so un-authored blocks are tracked too.
      function add(el, is) {
        if (!el) return;
        var id = ensureGateId(el); if (!id) return;
        var k = is + ":" + id; if (seen[k]) return; seen[k] = 1; out.push({ source: id, is: is });
      }
      qsAll(pageEl, "video").forEach(function (v) { add(v.closest && v.closest("[data-id]") || v, "watched"); });
      qsAll(pageEl, 'iframe[src*="vimeo.com"]').forEach(function (f) { add(f.closest && f.closest("[data-id]") || f, "watched"); });
      qsAll(pageEl, ".hotspot-stage").forEach(function (st) {
        if (!qsAll(st, ".hotspot-marker").length) return;                 // no markers -> nothing to view
        var tw = st.closest && st.closest("[data-track-viewed]");
        if (tw && tw.getAttribute("data-track-viewed") === "0") return;   // author disabled tracking -> no signal
        add(st, "viewed");
      });
      qsAll(pageEl, ".card-reveal").forEach(function (g) {
        if (!qsAll(g, ".card-reveal__card").length) return;
        add(g, "revealed");
      });
      qsAll(pageEl, ".seq").forEach(function (s) {
        if (!qsAll(s, ".seq__step").length) return;
        add(s, "sequenceDone");
      });
      qsAll(pageEl, "[data-accordion]").forEach(function (a) {
        if (!qsAll(a, ".acc__item, .acc__tab").length) return;
        add(a, "accordionDone");
      });
      qsAll(pageEl, "[data-quiz]").forEach(function (q) { add(q, "quizDone"); });
      return out;
    }
    function autoGatePass(pageEl) {
      if (!pageGates(pageEl)) return true;
      // Checkboxes are evaluated LIVE and ALL must be ticked (agree-to-terms gates must
      // re-lock Next whenever any box reads unchecked — e.g. on returning to the page).
      // Scanning every box (not one condition per block) also covers multi-checkbox blocks.
      var boxesOk = qsAll(pageEl, 'input[type="checkbox"]').every(function (cb) {
        var host = cb.closest && cb.closest("[data-id]");
        return host ? !!cb.checked : true; // only gate checkboxes that belong to a block
      });
      if (!boxesOk) return false;
      // The remaining interactions (hotspot/card/quiz/video) are sticky-once-done.
      return autoGateTargets(pageEl).every(function (t) {
        return t.is === "checked" ? true : evalCondition(t);
      });
    }

    // GGGG: gate the footer nav NEXT by the CURRENT page's REQUIRED gates — the
    // learner can't advance until e.g. a video is watched / a checkbox ticked. Reuses
    // gate.required + evalCondition (opt-in: an author just marks a block's gate
    // required), so pages with no required gates are unaffected. Reactive (re-eval on
    // every state change) and fail-OPEN (no page / no required gates -> Next enabled).
    // Prev is never gated. CCCC's CSS scroll-gate is the scroll-condition sibling.
    function gateFooterNav() {
      var pid = nav.currentPageId && nav.currentPageId();
      var pageEl = pid ? root.querySelector('.page[data-page-id="' + pid + '"]') : null;
      var cr = (pageEl && pageEl.closest && pageEl.closest(".course-root")) || root;
      var pass = gates.filter(function (g) {
        if (!g.gate.required) return false;
        var el = g.el || (g.el = elFor(g.id));
        return el && pageEl && pageEl.contains(el);
      }).every(function (g) { return evalCondition(g.gate.when); });
      var autoOk = autoGatePass(pageEl); // §5: also require every detectable interaction on the page
      pass = pass && autoOk;
      pass = pass && chapterAdvanceOk(); // §2: also disable Next while the chapter KC-gate holds
      // #108: on the LAST page there is no page after it, so a Next button would be dead
      // (nav.next clamps at the final page and no-ops). HIDE it there instead of shipping a
      // disabled-forever control; show it again on any non-last page. display:none (hidden)
      // leaves the fixed 3-col nav grid intact (Next owns grid-column 3), so prev/progress
      // don't reflow; it also wins over the scroll-gate's visibility rule.
      var ids = nav.pageIds ? nav.pageIds() : [];
      var isLast = ids.length > 0 && pid != null && ids[ids.length - 1] === pid;
      // NOTE: do NOT set btn.disabled — a truly disabled button fires no click, so the
      // learner gets a dead control with no feedback (the reason this never "stuck"). We
      // mark it aria-disabled + .is-nav-gated (greyed via CSS) and INTERCEPT the click to
      // nudge + show the reminder. The gate hint (rendered hidden in the nav) is toggled
      // to match, but only when the interactions are the blocker (not the KC-hold / last-page).
      var interactionsBlock = !autoOk; // the reminder is specifically "finish the interactions"
      qsAll(cr, ".course-nav__next").forEach(function (btn) {
        btn.hidden = isLast;
        btn.classList.toggle("is-nav-gated", !pass);
        if (!pass) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
      });
      qsAll(cr, "[data-gate-hint]").forEach(function (hint) {
        hint.hidden = !(interactionsBlock && !isLast);
      });
    }
    // Persistent-hint + on-attempt nudge when a learner clicks a gated Next: shake the
    // button and flash the reminder so the block is explained, not just dead.
    function nudgeGatedNext(btn) {
      var cr = (btn.closest && btn.closest(".course-root")) || root;
      btn.classList.remove("is-nudge"); void btn.offsetWidth; btn.classList.add("is-nudge");
      setTimeout(function () { btn.classList.remove("is-nudge"); }, 600);
      qsAll(cr, "[data-gate-hint]").forEach(function (hint) {
        hint.hidden = false;
        hint.classList.remove("is-flash"); void hint.offsetWidth; hint.classList.add("is-flash");
        setTimeout(function () { hint.classList.remove("is-flash"); }, 900);
      });
    }

    // ---- completion ----
    function checkComplete() {
      if (completed) return;
      var pageIds = nav.pageIds ? nav.pageIds() : Object.keys(state.visited);
      var allVisited = pageIds.length > 0 && pageIds.every(function (p) { return state.visited[p]; });
      var reqOk = gates.filter(function (g) { return g.gate.required; })
        .every(function (g) { return evalCondition(g.gate.when); });
      // §2 gated: the course also isn't complete until every chapter's KC has passed
      // (no-quiz chapters are auto-passed at init, so this is all-chapters when gated).
      var kcOk = !gated || chapMap.every(function (c) { return state.kcPassed[c.id]; });
      // §5 auto-gate: gateFooterNav blocks forward nav, but the LAST page has no Next to
      // gate — so completion must also require every gated page's interactions are done.
      var autoOk = qsAll(root, ".page[data-page-id]").every(function (pageEl) {
        return autoGatePass(pageEl);
      });
      if (allVisited && reqOk && kcOk && autoOk) { completed = true; onComplete(state); }
    }

    // fired on ANY state change: gates are reactive, not click-time.
    function changed() { applyGates(); gateFooterNav(); refreshNav(); checkComplete(); onStateChange(state); }
    function refreshNav() { navUpdaters.forEach(function (u) { u(state, nav); }); }

    // ---- bindings ----
    // Single delegated click: an element in the map runs its click interactions;
    // otherwise a bare [data-goto] (legacy nav / menu cards) still navigates, so
    // pre-interaction docs keep working through the same engine.
    root.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-id]") : null;
      if (t) {
        var entry = map[t.getAttribute("data-id")];
        if (entry && entry.interactions && entry.interactions.length) {
          var ran = false;
          entry.interactions.forEach(function (ix) {
            if (ix.trigger && ix.trigger.type === "click") { runAction(ix.action); ran = true; }
          });
          if (ran) { e.preventDefault(); return; }
        }
      }
      // footer course-nav arrows: route prev/next through the engine so
      // page-visited/gates stay reactive (same path as any nav action).
      var na = e.target && e.target.closest ? e.target.closest("[data-nav-action]") : null;
      if (na) {
        var act = na.getAttribute("data-nav-action");
        // Gated Next: not disabled (so this click fires) — swallow it, nudge + remind
        // instead of advancing. Prev/exit are never gated.
        if (act === "next" && na.classList.contains("is-nav-gated")) { e.preventDefault(); nudgeGatedNext(na); return; }
        if (act === "prev" || act === "next") { runAction({ type: act }); e.preventDefault(); return; }
        if (act === "exit") { runAction({ type: "exit" }); e.preventDefault(); return; }
      }
      var g = e.target && e.target.closest ? e.target.closest("[data-goto]") : null;
      if (g) { if (nav.goto(g.getAttribute("data-goto"))) { e.preventDefault(); afterNav(); } }
    });

    // checkbox change -> checked[blockId]
    root.addEventListener("change", function (e) {
      var input = e.target;
      if (input && input.type === "checkbox") {
        var host = input.closest ? input.closest("[data-id]") : null;
        if (host) { state.checked[host.getAttribute("data-id")] = !!input.checked; changed(); }
      }
    });

    // §5 auto-gate completion signals (bubbling, decoupled from bind*): a quiz
    // finishing, a hotspot's markers all viewed, a card grid all revealed. Each marks
    // its block id done in the matching bucket so the auto-gate can require it. These
    // run regardless of chapter `gated` (that path also listens to kc-complete for KC).
    function markDone(bucket, target) {
      var host = target && target.closest ? target.closest("[data-id]") : null;
      if (host) { var id = host.getAttribute("data-id"); if (id && !state[bucket][id]) { state[bucket][id] = true; changed(); } }
    }
    root.addEventListener("kc-complete", function (e) { markDone("quizDone", e.target); });
    root.addEventListener("hotspot-complete", function (e) { markDone("viewed", e.target); });
    root.addEventListener("card-reveal-complete", function (e) { markDone("revealed", e.target); });
    root.addEventListener("sequence-complete", function (e) { markDone("sequenceDone", e.target); });
    root.addEventListener("accordion-complete", function (e) { markDone("accordionDone", e.target); });

    // Pre-stamp a gate id on EVERY detectable host before the binders run. A completion
    // that fires at bind time (a single-section accordion, a static/reduced-motion sequence,
    // a one-marker hotspot) must record against the SAME id autoGateTargets will later
    // require — otherwise the signal lands on a not-yet-stamped host and is lost, trapping
    // the learner. Idempotent (ensureGateId reuses a real ancestor id or an existing stamp).
    qsAll(root, "video, iframe[src*='vimeo.com'], .hotspot-stage, .card-reveal, .seq, [data-accordion], [data-quiz]").forEach(function (el) {
      ensureGateId(el.closest && el.closest("[data-id]") ? el.closest("[data-id]") : el);
    });

    // media emitters: self-hosted <video> `ended`, Vimeo iframe `finish` (Player API).
    // Iterate the MEDIA directly (not [data-id]) and ensureGateId the host, so a video on
    // a page with no authored interaction (hence no id) is still tracked by the page gate.
    qsAll(root, "video").forEach(function (vid) {
      var id = ensureGateId(vid.closest && vid.closest("[data-id]") ? vid.closest("[data-id]") : vid);
      vid.addEventListener("ended", function () { state.watched[id] = true; changed(); });
    });
    qsAll(root, 'iframe[src*="vimeo.com"]').forEach(function (frame) {
      var id = ensureGateId(frame.closest && frame.closest("[data-id]") ? frame.closest("[data-id]") : frame);
      vimeoHosts.push({ id: id, frame: frame });
    });
    if (vimeoHosts.length && typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("message", function (e) {
        var data; try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch (_) { return; }
        if (!data || (data.event !== "finish" && data.event !== "ended")) return;
        vimeoHosts.forEach(function (h) { if (h.frame.contentWindow === e.source) { state.watched[h.id] = true; changed(); } });
      });
      vimeoHosts.forEach(function (h) {
        function subscribe() { try { h.frame.contentWindow.postMessage(JSON.stringify({ method: "addEventListener", value: "finish" }), "*"); } catch (_) {} }
        h.frame.addEventListener("load", subscribe); subscribe();
      });
    }

    // collect gates from the map
    Object.keys(map).forEach(function (id) {
      var entry = map[id];
      if (entry && entry.gate) gates.push({ id: id, el: elFor(id), gate: entry.gate });
    });

    // image-hotspot open/close (DOM-bound; no map entry needed)
    bindHotspots(root);
    // accordion / tabs block (DOM-bound; collapses the author-view render)
    bindAccordion(root);
    // footer course-nav (DOM-bound view; arrows routed through the engine above)
    navUpdaters = bindCourseNav(root);
    // JJJ: pinned-header auto-hide/reveal on scroll (base pin is CSS sticky)
    bindPinnedHeader(root);
    bindCardReveal(root); // TTTT: card tap/keyboard reveal
    bindSequence(root); // FLAGSHIP sequence reveal engine (scroll / click / static)
    bindCardDeck(root); // Card Deck paging (‹ › one card at a time)
    bindImageLightbox(root); // click-to-zoom overlay on every image (opt-out per image)
    // CCCC scroll-completion gate: reaching a page's bottom (or it fitting) marks
    // it reached (-> visited -> completion) and reveals its Next button.
    scrollGate = bindScrollGate(root, nav, function (pid) {
      if (pid && !state.visited[pid]) { state.visited[pid] = true; changed(); }
    });
    // Arrow / Page keys scroll the current page (browser default doesn't reach the
    // inner overflow owner); guarded against fields / quizzes / open modals.
    bindKeyboardScroll(root, nav);

    // initial: mark/gate the start page, lock/hide gates per their conditions
    (function start() {
      if (scrollGate) scrollGate.arrive();
      else { var pid = nav.currentPageId && nav.currentPageId(); if (pid) state.visited[pid] = true; }
      applyGates(); gateFooterNav(); refreshNav(); checkComplete(); onStateChange(state);
      // global motion: record the starting chapter so the first navigation is judged against
      // the real chapter (no fade on init). The light/dark fade is CSS-only (scoped to
      // [data-mode], which naturally avoids animating the initial theme stamp).
      lastChapter = chapterOfCurrent();
    })();

    return {
      state: state,
      // imperative test / demo hooks
      setState: function (kind, id, val) { if (state[kind]) { state[kind][id] = val; changed(); } },
      goto: function (id) { nav.goto(id); afterNav(); },
      next: function () { if (!canAdvance()) return; nav.next(); afterNav(); }, // B: forward-locked until scroll-done
      prev: function () { nav.prev(); afterNav(); },
      evaluate: applyGates,
      isComplete: function () { return completed; },
      nav: nav
    };
  }

  window.CourseRuntime = { create: create, defaultNav: defaultNav, positionPopover: positionPopover, bindHotspots: bindHotspots, bindCourseNav: bindCourseNav, bindAccordion: bindAccordion, bindScrollGate: bindScrollGate, bindPinnedHeader: bindPinnedHeader, bindCardReveal: bindCardReveal, bindSequence: bindSequence, bindImageLightbox: bindImageLightbox };
})();
