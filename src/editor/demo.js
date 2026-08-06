// editor/demo.js -- the course as the learner will meet it (arch-P3b-07j).
//
// Press Play and the authoring canvas is replaced by a device frame running the REAL runtime: the
// same render(), the same nav, the same quiz and interaction code the SCORM package ships. That is
// the point of it. A preview that approximated the runtime would be worse than none, because it
// would be trusted and wrong.
//
// What this file adds around that is only what a preview needs and an export must never have: a
// breakpoint picker (desktop / tablet / mobile, or auto from the window), a fit-scale so a desktop
// frame fits a laptop screen, a notice when a learner action would leave the course (an exit
// button has nowhere to go here), and an end screen after the last page.
//
// It owns its own elements and its own page cursor. The comment layer asks whether the preview is
// open and where its stage is, rather than reaching for the elements, which is why four small
// accessors cross rather than four DOM nodes.
//
// Exiting lands the canvas on the page the preview was showing, not wherever the canvas was before
// it opened. Losing your place on exit is a small thing that feels broken every time.
//
// Editor chrome only: it MOUNTS render() output and never changes it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "BREAKPOINTS", "activeTheme", "clamp", "renderCommentPins", "setDemoCommentMode", "pageIndexById",
      "fitEmbedsIn", "demoCommentBtn", "closeCommentPopover", "isTextTarget", "persistTheme", "h",
      "editorAssetResolve", "applyLayoutVars", "focusFrame", "setActivePage", "setSelection", "registry",
      "addToQueue", "publishToast", "syncSendToPublishCount", "doc", "activeMode", "demoCommentMode",
      "activeDocId", "currentPage", "openCommentId", "setActiveMode", "resetDemoCommentMode"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var BREAKPOINTS = E.BREAKPOINTS,
        activeTheme = E.activeTheme,
        clamp = E.clamp,
        renderCommentPins = E.renderCommentPins,
        setDemoCommentMode = E.setDemoCommentMode,
        pageIndexById = E.pageIndexById,
        fitEmbedsIn = E.fitEmbedsIn,
        closeCommentPopover = E.closeCommentPopover,
        isTextTarget = E.isTextTarget,
        persistTheme = E.persistTheme,
        h = E.h,
        editorAssetResolve = E.editorAssetResolve,
        applyLayoutVars = E.applyLayoutVars,
        focusFrame = E.focusFrame,
        setActivePage = E.setActivePage,
        setSelection = E.setSelection,
        registry = E.registry,
        addToQueue = E.addToQueue,
        publishToast = E.publishToast,
        syncSendToPublishCount = E.syncSendToPublishCount;

    // ---- demo mode (fullscreen, simulates the real learner experience) -------
    // A real device viewport (breakpoint-sized) with REAL scroll, its own
    // breakpoint toggle and page prev/next. This is where scrolling belongs;
    // the authoring canvas stays full-length + fold marker.
    var demo = document.getElementById("demo");
    var demoStage = document.getElementById("demo-stage");
    var demoScaler = document.getElementById("demo-scaler");
    var demoDevice = document.getElementById("demo-device");
    // What the rest of the chrome may ask about the preview. The comment layer projects its pins
    // onto whichever surface is live, so it needs to know whether this one is open and where its
    // stage is -- but it has no business holding the elements (arch-P3b-07j).
    function demoIsOpen() { return !!(demo && !demo.hidden); }
    function demoStageEl() { return demoStage; }
    function demoDeviceEl() { return demoDevice; }
    function demoRuntimeNow() { return demoRuntime; }
    // Item X — learner mode-toggle preview parity. In demo the toggle is a real
    // control (editing is off, so the click fires instead of editing the label). One
    // delegated listener flips the demo course-root's data-mode + re-pushes the theme
    // into embeds, mirroring the exported runtime's toggleTheme(). demoDevice persists
    // across renderDemo() (its children are replaced, not the node), so bind once.
    demoDevice.addEventListener("click", function (e) {
      if (!e.target.closest("[data-mode-toggle]")) return;
      e.preventDefault();
      E.setActiveMode(E.activeMode === "dark" ? "light" : "dark");
      persistTheme();
      // Re-theme the EXISTING demo course-root in place (rewrite the inline --color-*
      // tokens + re-stamp data-mode + CSS-driven glyph swap), mirroring the editor
      // CANVAS's reapplyTheme -- NOT a renderDemo() rebuild. A rebuild tears the DOM
      // down (demoDevice.innerHTML="") and recreates it already painted in the new
      // mode, so there is no old->new value change for the [data-mode] crossfade to
      // animate (the §1 hard-cut James saw in preview). Mutating in place changes the
      // consuming background-color/color, so the course.css transition fades -- and it
      // also preserves the live QuizRuntime/gate state across a mode flip (no re-seed).
      var __t = activeTheme();
      var __roots = demoDevice.querySelectorAll(".course-root");
      if (__roots.length) {
        Array.prototype.forEach.call(__roots, function (r) { window.applyTheme(r, __t); r.setAttribute("data-mode", E.activeMode); });
        demoDevice.style.backgroundColor = __t.color.bg; // device backdrop behind the (filling) root
      } else {
        renderDemo(); // nothing mounted yet -> full render
      }
      if (window.pushEmbedTheme) window.pushEmbedTheme(demoDevice, E.activeMode, __t.color);
    });
    var demoTitle = document.getElementById("demo-title");
    var demoBpBtns = [];
    var demoBp = "auto", demoPage = 0;
    // Chapter-change fade in the DEMO: renderDemo() re-creates the runtime every nav, so
    // the runtime's own lastChapter (a closure var) resets each time and never detects a
    // crossing — track the previous chapter HERE (survives the rebuild) so the fade fires
    // in preview too, matching the export. undefined = first render (no fade). (Bug 2026-07-08.)
    var demoPrevChapter;
    // Interaction runtime for preview parity (SPEC §7): the SAME CourseRuntime the
    // exported package runs, fed buildInteractionMap(doc), over a nav adapter that
    // re-renders the demo page. `demoStore` persists visited/watched/checked across
    // per-page re-renders so gate state survives navigation.
    var demoRuntime = null;
    var demoStore = { visited: {}, watched: {}, checked: {} };
    function demoNavAdapter() {
      return {
        count: function () { return E.doc.pages.length; },
        pageIds: function () { return E.doc.pages.map(function (p) { return p.id; }); },
        currentPageId: function () { return E.doc.pages[demoPage] ? E.doc.pages[demoPage].id : null; },
        goto: function (id) { var i = pageIndexById(id); if (i < 0) return false; if (i !== demoPage) { demoPage = i; renderDemo(); } return true; },
        next: function () { var i = clamp(demoPage + 1, 0, E.doc.pages.length - 1); if (i !== demoPage) { demoPage = i; renderDemo(); } },
        prev: function () { var i = clamp(demoPage - 1, 0, E.doc.pages.length - 1); if (i !== demoPage) { demoPage = i; renderDemo(); } }
      };
    }

    // Which breakpoint an actual width maps to (Auto mode = real responsive).
    function bpForWidth(w) { if (w < 600) return "mobile"; if (w < 1000) return "tablet"; return "desktop"; }

    // Scale a forced-device screen (dw x dh) to FIT the stage, keeping its ratio,
    // so it fills the available space (enlarges when the device is smaller than the
    // stage, shrinks when larger). Vertical fit unless width is the tighter bound.
    function demoFitScale(dw, dh) {
      return Math.min(demoStage.clientWidth / dw, demoStage.clientHeight / dh);
    }
    // Transient centred notice over the preview device (editor chrome). Used by the
    // demo onExit override so an "Exit course" click gives visible feedback without
    // ending a SCORM session or closing the window (neither exists / is wanted here).
    function flashDemoNotice(msg) {
      var host = demoStage || demoDevice;
      if (!host) return;
      var n = h("div", "demo-notice", msg);
      n.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;" +
        "background:rgba(20,22,26,0.92);color:#fff;padding:12px 18px;border-radius:10px;" +
        "font-size:13px;max-width:70%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,0.35);pointer-events:none;";
      host.appendChild(n);
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 2200);
    }
    // #111 preview: render the real completion splash over the demo stage on "Exit course",
    // with meta filled from the demo's visited state (mirrors the export boot's fillEndMeta).
    // Click it to return to the course. Editor-only (Demo is the author's learner preview).
    function previewEndScreen() {
      if (!(window.renderEndScreen && (!window.endScreenOn || window.endScreenOn(E.doc)))) {
        flashDemoNotice("Exit course — ends the SCORM session in the LMS.");
        return;
      }
      var host = window.renderEndScreen(E.doc);
      var total = parseInt(host.getAttribute("data-modules-total"), 10) || 0;
      var vis = (demoStore && demoStore.visited) || {};
      var done = total, mapAttr = host.getAttribute("data-modules-map");
      if (mapAttr) { try { done = JSON.parse(mapAttr).filter(function (ids) { return ids.length && ids.every(function (id) { return !!vis[id]; }); }).length; } catch (e) {} }
      else { var c = 0; for (var k in vis) if (vis[k]) c++; done = total ? Math.min(c, total) : c; }
      var mval = host.querySelector('[data-end-chip="modules"] .course-end__chip-val');
      if (mval) { if (total > 0) mval.textContent = done + " / " + total; else { var mc = host.querySelector('[data-end-chip="modules"]'); if (mc) mc.setAttribute("data-end-empty", "1"); } }
      var dval = host.querySelector('[data-end-chip="date"] .course-end__chip-val');
      if (dval) { try { dval.textContent = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) {} }
      host.setAttribute("data-mode", E.activeMode);
      host.setAttribute("data-bp", demoBp === "auto" ? bpForWidth(demoStage.clientWidth) : demoBp);
      host.setAttribute("data-env", "runtime");
      host.style.cursor = "pointer"; host.title = "Preview of the learner exit screen — click to return to the course";
      (host.querySelector(".course-end") || host).classList.add("is-shown");
      host.addEventListener("click", function () { renderDemo(); });
      demoDevice.innerHTML = ""; demoDevice.appendChild(host);
    }
    function renderDemo() {
      demoDevice.innerHTML = "";
      demoDevice.style.backgroundColor = activeTheme().color.bg;
      if (demoBp === "auto") {
        // Auto = view through the author's actual monitor: fill the whole stage.
        demoDevice.style.width = "100%"; demoDevice.style.maxWidth = "none"; demoDevice.style.height = "100%";
        demoDevice.style.zoom = ""; // auto: no zoom, fills the real monitor
        demoDevice.classList.remove("demo__device--framed");
      } else {
        // Forced device = the breakpoint's EXACT pixel size (no fit-scaling): a fixed
        // w x h window floating in the black stage. The .demo__scaler centres it and
        // scrolls when it is larger than the stage; content scrolls INSIDE the device.
        // So #42's custom preview sizes render 1:1 (a 1440px desktop shows at 1440px),
        // instead of being shrunk to the author's monitor height.
        var dw = BREAKPOINTS[demoBp].w, dh = (BREAKPOINTS[demoBp] && BREAKPOINTS[demoBp].h) || demoStage.clientHeight;
        demoDevice.style.width = dw + "px"; demoDevice.style.maxWidth = "none"; demoDevice.style.height = dh + "px";
        demoDevice.style.zoom = ""; // exact pixels — do NOT scale the device to the stage
        // Without the zoom containing block, a runtime position:fixed nav would escape to
        // the app viewport (ghost pill), so EVERY forced device is framed (inline nav +
        // subtle edge), desktop included (it no longer fills the viewport at 1:1).
        demoDevice.classList.add("demo__device--framed");
      }
      var __rmDemo = (window.resolveMedia && window.AssetStore) ? window.resolveMedia(E.doc, editorAssetResolve) : null;
      var cr;
      // arch-P1: preview renders through the same one render context as the canvas and the export.
      window.applyRenderContext(window.buildRenderContext(E.doc));
      try { cr = window.renderPage(E.doc.pages[demoPage], activeTheme(), window.resolveHeaderFooter(E.doc, E.doc.pages[demoPage])); }
      finally { if (__rmDemo) __rmDemo(); }
      var __demoBp = demoBp === "auto" ? bpForWidth(demoStage.clientWidth) : demoBp;
      cr.setAttribute("data-bp", __demoBp);
      cr.setAttribute("data-mode", E.activeMode);
      cr.setAttribute("data-env", "runtime"); // VVVV: preview is a learner runtime -> footer floats as pills (canvas stays inline)
      applyLayoutVars(cr, E.doc.pages[demoPage]);
      // Auto scales to the real monitor (stage height); a forced device uses its
      // fixed fold height (set on demoDevice above), so content scrolls inside it.
      var devH = demoBp === "auto" ? demoStage.clientHeight : ((BREAKPOINTS[demoBp] && BREAKPOINTS[demoBp].h) || demoStage.clientHeight);
      cr.style.setProperty("--vp-h", devH + "px");
      demoDevice.appendChild(cr);
      // §2 chapter-change fade (preview parity): on a page whose chapter differs from the
      // last rendered one, re-trigger the .is-chapter-enter opacity fade on the fresh demo
      // box. CSS owns the duration (--motion-chapter-fade) + the prefers-reduced-motion skip.
      var __demoCh = E.doc.pages[demoPage] && E.doc.pages[demoPage].chapterId;
      if (demoPrevChapter !== undefined && __demoCh && __demoCh !== demoPrevChapter) {
        cr.classList.remove("is-chapter-enter"); void cr.offsetWidth; cr.classList.add("is-chapter-enter");
      }
      demoPrevChapter = __demoCh;
      if (window.QuizRuntime) window.QuizRuntime.init(cr); // play the quiz for real in demo
      // interaction runtime (parity with the exported package): bind click actions,
      // media/checkbox emitters + reactive gates. Re-seed persisted state so gates
      // that were satisfied on other pages stay satisfied.
      if (window.CourseRuntime) {
        demoRuntime = window.CourseRuntime.create({
          root: cr,
          interactions: window.buildInteractionMap(E.doc),
          nav: demoNavAdapter(),
          // "Exit course" DO-action in PREVIEW: the real behaviour ends the SCORM
          // session + closes the window, neither of which should touch the editor.
          // Override with a transient notice so the author sees the action fired
          // without leaving the app. Editor chrome only (inline styled, not shipped).
          onExit: function () { previewEndScreen(); },
          onStateChange: function (st) {
            ["visited", "watched", "checked"].forEach(function (k) {
              Object.keys(st[k]).forEach(function (id) { demoStore[k][id] = st[k][id]; });
            });
          }
        });
        ["watched", "checked"].forEach(function (k) {
          Object.keys(demoStore[k]).forEach(function (id) { if (demoStore[k][id]) demoRuntime.setState(k, id, true); });
        });
      }
      demoTitle.textContent = E.doc.pages[demoPage].name;
      demoBpBtns.forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-bp") === demoBp); });
      // §12 slice 4: the demo renders via the PURE renderPage (no data-cid), so stamp
      // the comment-anchor ids here (editor chrome, same as enableEditing does on the
      // canvas) and re-project the shared pins onto the preview.
      stampDemoCids(cr);
      // Push the active theme (tokens + each block's embedColorMap) INTO the preview's
      // embed iframes. renderDemo rebuilds fresh iframes every entry / page-nav, and the
      // canvas reapplyTheme / boot push only target `canvas`, never demoDevice — so
      // without this the preview shows each interaction on its OWN default palette (the
      // author's mapped colours "change" on entering preview). pushEmbedTheme binds a
      // per-frame load listener, so iframes still loading get themed when they finish.
      requestAnimationFrame(function () {
        fitEmbedsIn(demoDevice); renderCommentPins();
        if (window.pushEmbedTheme) window.pushEmbedTheme(demoDevice, E.activeMode, activeTheme().color);
      });
    }
    // §12 slice 4: stamp data-cid on the demo course-root's blocks for hit-testing.
    function stampDemoCids(cr) {
      if (!cr) return;
      Array.prototype.forEach.call(cr.querySelectorAll(".canvas-block"), function (n) {
        if (n.__block && n.__block.cid) n.setAttribute("data-cid", n.__block.cid);
      });
    }
    // resized while in demo: in Auto, re-evaluate the breakpoint live (no iframe
    // reload — just swap data-bp + re-fit embeds)
    function onDemoResize() {
      if (demo.hidden) return;
      var cr = demoDevice.querySelector(".course-root");
      if (!cr) return;
      // Only Auto tracks the live monitor size on resize; a forced device stays a
      // fixed screen.
      if (demoBp === "auto") {
        var rbp = bpForWidth(demoStage.clientWidth);
        if (cr.getAttribute("data-bp") !== rbp) cr.setAttribute("data-bp", rbp);
        demoDevice.style.height = "100%";
        cr.style.setProperty("--vp-h", demoStage.clientHeight + "px");
      } else {
        // Forced device is a fixed-pixel window; resizing the app just re-centres/scrolls
        // it (handled by .demo__scaler) — nothing to rescale, exact pixels are preserved.
        demoDevice.style.zoom = "";
      }
      fitEmbedsIn(demoDevice);
    }
    function stepDemo(d) { demoPage = clamp(demoPage + d, 0, E.doc.pages.length - 1); renderDemo(); }
    // Set the preview screen size (Auto/desktop/tablet/mobile) -- used by the demo
    // toolbar buttons AND the 1/2/3/4 keys.
    function setDemoBp(bp) { if (demoBp === bp) return; demoBp = bp; renderDemo(); }
    function enterDemo() {
      // NOTE: do not force browser fullscreen — that locks the window size and you
      // couldn't resize to test breakpoints. The overlay is fixed/inset:0 so it
      // already fills the app window; fullscreen is an opt-in button.
      demoBp = "auto"; demoPage = E.currentPage || 0;
      demoStore = { visited: {}, watched: {}, checked: {} }; // fresh run each session
      E.resetDemoCommentMode(); demoStage.classList.remove("is-comment-mode"); // §12: start in read mode
      // Read live: the button belongs to comments.js, which installs AFTER this file, so an alias
      // taken at install time would be undefined (arch-P3b-07).
      if (E.demoCommentBtn) E.demoCommentBtn.classList.remove("is-active");
      demo.hidden = false;
      document.body.classList.add("demo-open"); // #76: hide authoring-only chrome while previewing
      renderDemo();
      requestAnimationFrame(onDemoResize); // correct bp once the stage has laid out
    }
    function toggleDemoFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else if (demo.requestFullscreen) demo.requestFullscreen().catch(function () {});
    }
    function exitDemo() {
      if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); }
      setDemoCommentMode(false); closeCommentPopover();
      demo.hidden = true;
      renderCommentPins(); // §12: back on the canvas surface — re-project the shared pins
      document.body.classList.remove("demo-open"); // #76: restore authoring chrome on the editing canvas
      // issue 100: land the canvas on the page the preview was showing at exit (demoPage),
      // not wherever the canvas happened to be before preview. Same focus idiom as
      // clicking a page (focus frame + active-page + select). Runs last so the canvas is
      // laid out again (demo hidden, demo-open removed) before focusFrame measures it.
      if (E.doc.pages && E.doc.pages.length) {
        var __exitPage = clamp(demoPage, 0, E.doc.pages.length - 1);
        focusFrame(__exitPage); setActivePage(__exitPage); setSelection("page", __exitPage);
      }
    }

    function wireDemo() {
      demoBpBtns = Array.prototype.slice.call(document.querySelectorAll("#demo-bp .bp-btn"));
      demoBpBtns.forEach(function (b) { b.addEventListener("click", function () { demoBp = b.getAttribute("data-bp"); renderDemo(); }); });
      document.getElementById("demo-enter").addEventListener("click", enterDemo);
      // SPEC 7 (send-to-publish-wire): the editor-header glyph adds the active document to the standing
      // publish queue via the ONE shared addToQueue -- its remembered preset (T2), no configure step,
      // re-arming (never duplicating) a row that already exists, and toasting the running pending count.
      var sendPub = document.getElementById("send-to-publish-btn");
      if (sendPub && !sendPub.__wired) {
        sendPub.__wired = true;
        sendPub.addEventListener("click", function () {
          if (E.activeDocId && registry[E.activeDocId]) addToQueue(E.activeDocId);
          else publishToast("Open a document first to send it to the publish queue.");
        });
      }
      syncSendToPublishCount(); // uio-E-C08: seed the pending count from the persisted queue at boot
      document.getElementById("demo-exit").addEventListener("click", exitDemo);
      document.getElementById("demo-prev").addEventListener("click", function () { stepDemo(-1); });
      document.getElementById("demo-next").addEventListener("click", function () { stepDemo(1); });
      document.getElementById("demo-fs").addEventListener("click", toggleDemoFullscreen);
      // real learner navigation: CourseRuntime now owns click nav + gates (parity
      // with export). Only fall back to this direct data-goto handler if the shared
      // runtime is unavailable, so the two never both re-render.
      demoDevice.addEventListener("click", function (e) {
        if (window.CourseRuntime) return; // runtime handles data-id + data-goto
        var t = e.target.closest("[data-goto]");
        if (!t) return;
        e.preventDefault();
        var idx = pageIndexById(t.getAttribute("data-goto"));
        if (idx >= 0) { demoPage = idx; renderDemo(); }
      });
      document.addEventListener("keydown", function (e) {
        if (demo.hidden) return;
        if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !isTextTarget(e.target)) { e.preventDefault(); setDemoCommentMode(!E.demoCommentMode); return; }
        if (isTextTarget(e.target)) return; // typing in a comment note: arrows/numbers/Esc belong to the box
        // §12: Escape steps back — close an open note, then exit comment mode, then exit the preview.
        if (e.key === "Escape") {
          if (E.openCommentId) { closeCommentPopover(); renderCommentPins(); return; }
          if (E.demoCommentMode) { setDemoCommentMode(false); return; }
          exitDemo();
        }
        else if (e.key === "ArrowRight") stepDemo(1);
        else if (e.key === "ArrowLeft") stepDemo(-1);
        // 1/2/3/4 cycle the preview screen size.
        else if (e.key === "1") { e.preventDefault(); setDemoBp("auto"); }
        else if (e.key === "2") { e.preventDefault(); setDemoBp("desktop"); }
        else if (e.key === "3") { e.preventDefault(); setDemoBp("tablet"); }
        else if (e.key === "4") { e.preventDefault(); setDemoBp("mobile"); }
      });
      window.addEventListener("resize", onDemoResize);
    }

    kernel.expose({
      enterDemo: enterDemo, exitDemo: exitDemo, wireDemo: wireDemo,
      demoIsOpen: demoIsOpen, demoStageEl: demoStageEl, demoDeviceEl: demoDeviceEl,
      demoRuntimeNow: demoRuntimeNow
    });
  }

  window.VersoDemo = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDemo;
})();
