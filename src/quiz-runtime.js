/*
 * quiz-runtime.js — the PLAY behaviour for the knowledge-check quiz block.
 *
 * Ships INSIDE the SCORM package and boots in the editor's demo mode. It is NOT
 * loaded on the authoring canvas (there the quiz stays a static, editable
 * "author view"). It reads only the DOM render.js produced — question type from
 * data-qtype, answer keys from [data-correct], feedback text from .kc-fb--good /
 * .kc-fb--bad — so render() stays pure and there is no second source of truth.
 *
 * Interaction model (matches James's reference knowledge check): one panel at a
 * time, a segmented animated progress bar, tap-select letter pills (multiple
 * choice) and chip-into-blank (fill in the blank), retry-until-correct with an
 * animated feedback row, auto-advance on the last question, completion panel.
 * Formative — no pass/fail score; completion = every question answered correctly.
 *
 * SCORM hook: set window.QuizRuntime.onResult / .onComplete before init().
 * The export wrapper attaches these to record per-question completion +
 * mark the (possibly multiple) quizzes in a course complete to the LMS.
 *
 * Classic script — exposes window.QuizRuntime.
 */
(function () {
  "use strict";
  var api = { init: init, onResult: null, onComplete: null, burstConfetti: burstConfetti };
  window.QuizRuntime = api;

  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function init(root) { Array.prototype.forEach.call((root || document).querySelectorAll(".quiz"), setup); }
  function slice(nl) { return Array.prototype.slice.call(nl); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // Self-contained confetti burst on a quiz pass (no library — air-gap safe). Orange/brand
  // particles on a transient full-screen canvas; gravity + fade, self-removes after ~2.6s.
  // Skipped entirely for prefers-reduced-motion. Author opt-in per quiz (data-confetti).
  function burstConfetti() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch (e) {}
    var cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    // z-index must clear the editor's in-page demo overlay (.demo = z-index:100) so the
    // burst is visible in PREVIEW too, not just the export (where nothing sits above it).
    cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;";
    var dpr = window.devicePixelRatio || 1;
    var W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    (document.body || document.documentElement).appendChild(cv);
    var ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    var colors = ["#f5a623", "#ff7a00", "#e2653b", "#ff9f0a"]; // brand oranges only (James 2026-07-09: no green/yellow-gold)
    var N = 130, parts = [];
    for (var i = 0; i < N; i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.5, y: H * 0.35 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 9, vy: Math.random() * -11 - 3,
        w: 5 + Math.random() * 6, h: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
    var t0 = performance.now(), LIFE = 2600;
    function frame(now) {
      var el = now - t0; ctx.clearRect(0, 0, W, H);
      var alpha = el < LIFE - 600 ? 1 : Math.max(0, (LIFE - el) / 600);
      ctx.globalAlpha = alpha;
      parts.forEach(function (p) {
        p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (el < LIFE) requestAnimationFrame(frame);
      else if (cv.parentNode) cv.parentNode.removeChild(cv);
    }
    requestAnimationFrame(frame);
  }

  function setup(quiz) {
    if (quiz.__quizInited) return;
    quiz.__quizInited = true;
    var cfg = {
      intro: quiz.getAttribute("data-intro") === "1",
      retry: quiz.getAttribute("data-retry") === "1",
      shuffleQ: quiz.getAttribute("data-shuffle-q") === "1",
      shuffleO: quiz.getAttribute("data-shuffle-o") === "1",
      confetti: quiz.getAttribute("data-confetti") === "1"
    };
    var counter = quiz.querySelector(".kc-counter");
    var progress = quiz.querySelector(".kc-progress");
    var introP = quiz.querySelector(".kc-intro");
    var qWrap = quiz.querySelector(".kc-questions");
    var doneP = quiz.querySelector(".kc-done");
    var questions = slice(quiz.querySelectorAll(".kc-q"));
    if (!qWrap || !questions.length) return;
    quiz.classList.add("quiz--play");

    if (cfg.shuffleQ) shuffle(questions).forEach(function (q) { qWrap.appendChild(q); });
    if (cfg.shuffleO) questions.forEach(function (q) {
      var group = q.querySelector(".kc-pills") || q.querySelector(".kc-chips") || q.querySelector(".kc-sort__pool");
      if (group) shuffle(slice(group.children)).forEach(function (o) { group.appendChild(o); });
    });

    var current = 0;

    function renderProgress(done) {
      slice(progress.children).forEach(function (seg, i) {
        seg.classList.toggle("done", done || i < current);
        seg.classList.toggle("active", !done && i === current);
      });
    }
    function hideAll() {
      if (introP) introP.style.display = "none";
      questions.forEach(function (q) { q.style.display = "none"; });
      if (doneP) doneP.style.display = "none";
    }
    function showIntro() { hideAll(); if (counter) counter.textContent = ""; if (introP) introP.style.display = ""; }
    function start() { current = 0; questions.forEach(reset); showQuestion(); }
    function showQuestion() {
      hideAll();
      var q = questions[current];
      q.style.display = "";
      if (counter) counter.textContent = "Question " + (current + 1) + " of " + questions.length;
      renderProgress(false);
      wire(q);
    }
    function advance() { if (current < questions.length - 1) { current++; showQuestion(); } else finish(); }
    function finish() {
      hideAll();
      renderProgress(true);
      if (counter) counter.textContent = "Complete";
      if (doneP) {
        doneP.style.display = "";
        var retry = doneP.querySelector(".kc-retry");
        if (retry) retry.onclick = function () { cfg.intro && introP ? showIntro() : start(); };
      }
      if (cfg.confetti) burstConfetti(); // celebrate a pass (author opt-in; reduced-motion aware)
      if (api.onComplete) { try { api.onComplete({ quiz: quiz, total: questions.length }); } catch (e) {} }
      // §2 chapter progression: a bubbling DOM event so CourseRuntime can mark the
      // quiz's chapter passed WITHOUT fighting over QuizRuntime.onComplete (which the
      // SCORM layer owns). Decoupled — works in the editor demo and the export alike.
      try { quiz.dispatchEvent(new CustomEvent("kc-complete", { bubbles: true })); } catch (e) {}
    }

    function feedbackRow(q) { return q.querySelector(".kc-feedback"); }
    function showFeedback(q, good) {
      var holder = q.querySelector(good ? ".kc-fb--good" : ".kc-fb--bad");
      var text = holder ? holder.innerHTML : "";
      var row = feedbackRow(q);
      row.innerHTML = '<span class="kc-fb-icon ' + (good ? "good" : "bad") + '">' + (good ? CHECK : CROSS) + '</span><span class="kc-fb-text">' + text + '</span>';
      row.className = "kc-feedback show";
    }
    function solved(q, isLast) {
      var next = q.querySelector(".kc-next");
      if (api.onResult) { try { api.onResult({ quiz: quiz, qid: q.getAttribute("data-qid"), correct: true }); } catch (e) {} }
      if (isLast) setTimeout(advance, 2000);
      else if (next) next.classList.add("show");
    }

    function reset(q) {
      q.__solved = false;
      var fr = feedbackRow(q); if (fr) { fr.className = "kc-feedback"; fr.innerHTML = ""; }
      var next = q.querySelector(".kc-next"); if (next) { next.classList.remove("show"); next.onclick = advance; }
      slice(q.querySelectorAll(".kc-pill")).forEach(function (p) { p.classList.remove("correct", "incorrect", "faded"); p.disabled = false; });
      slice(q.querySelectorAll(".kc-chip")).forEach(function (c) { c.classList.remove("used", "wrong-flash"); c.disabled = false; });
      var blank = q.querySelector(".kc-blank"); if (blank) { blank.classList.remove("filled", "wrong"); blank.textContent = "select below"; }
      var pool = q.querySelector(".kc-sort__pool");
      if (pool) {
        slice(q.querySelectorAll(".kc-card")).forEach(function (card) { card.classList.remove("placed", "picked", "wrong"); card.disabled = false; pool.appendChild(card); });
        slice(q.querySelectorAll(".kc-cat")).forEach(function (c) { c.classList.remove("wrong"); });
      }
    }
    function wire(q) {
      reset(q);
      var last = current === questions.length - 1;
      var type = q.getAttribute("data-qtype");
      if (type === "fillBlank") wireBlank(q, last);
      else if (type === "cardSort") wireCardSort(q, last);
      else wirePills(q, last);
    }
    function wirePills(q, last) {
      var pills = slice(q.querySelectorAll(".kc-pill"));
      pills.forEach(function (pill) {
        pill.onclick = function () {
          if (q.__solved) return;
          pills.forEach(function (p) { p.classList.remove("incorrect"); });
          if (pill.getAttribute("data-correct") === "true") {
            q.__solved = true;
            pill.classList.add("correct");
            pills.forEach(function (p) { if (p !== pill) { p.disabled = true; p.classList.add("faded"); } });
            showFeedback(q, true);
            solved(q, last);
          } else {
            pill.classList.add("incorrect");
            showFeedback(q, false);
            setTimeout(function () { pill.classList.remove("incorrect"); }, 1100);
          }
        };
      });
    }
    function wireBlank(q, last) {
      var blank = q.querySelector(".kc-blank");
      var chips = slice(q.querySelectorAll(".kc-chip"));
      chips.forEach(function (chip) {
        chip.onclick = function () {
          if (q.__solved) return;
          if (chip.getAttribute("data-correct") === "true") {
            q.__solved = true;
            if (blank) { blank.textContent = chip.textContent; blank.classList.add("filled"); }
            chip.classList.add("used");
            chips.forEach(function (c) { if (c !== chip) { c.disabled = true; c.classList.add("used"); } });
            showFeedback(q, true);
            solved(q, last);
          } else {
            if (blank) blank.classList.add("wrong");
            chip.classList.add("wrong-flash");
            showFeedback(q, false);
            setTimeout(function () { if (blank) blank.classList.remove("wrong"); chip.classList.remove("wrong-flash"); }, 1100);
          }
        };
      });
    }

    // card sort: tap a card to pick it up, tap a group to drop it. Right group ->
    // the card locks into place; wrong -> both flash and the card is released.
    // Touch/keyboard friendly (buttons), no drag library (air-gap safe).
    function wireCardSort(q, last) {
      var cards = slice(q.querySelectorAll(".kc-card"));
      var cats = slice(q.querySelectorAll(".kc-cat"));
      var picked = null;
      var total = cards.length, placed = 0;
      function pick(card) { if (card.classList.contains("placed")) return; if (picked) picked.classList.remove("picked"); picked = card; card.classList.add("picked"); }
      cards.forEach(function (card) {
        card.onclick = function () { if (!q.__solved) pick(card); };
        card.onkeydown = function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.onclick(); } };
      });
      cats.forEach(function (cat) {
        cat.setAttribute("tabindex", "0");
        cat.setAttribute("role", "button");
        function drop() {
          if (q.__solved || !picked) return;
          var card = picked;
          if (card.getAttribute("data-cat") === cat.getAttribute("data-cat")) {
            card.classList.remove("picked"); card.classList.add("placed"); card.disabled = true;
            cat.querySelector(".kc-cat__drop").appendChild(card);
            picked = null; placed++;
            if (placed >= total) { q.__solved = true; showFeedback(q, true); solved(q, last); }
          } else {
            cat.classList.add("wrong"); card.classList.add("wrong");
            showFeedback(q, false);
            setTimeout(function () { cat.classList.remove("wrong"); card.classList.remove("wrong", "picked"); }, 1100);
            picked = null;
          }
        }
        cat.onclick = drop;
        cat.onkeydown = function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); drop(); } };
      });
    }

    if (introP) { var sb = introP.querySelector(".kc-start"); if (sb) sb.onclick = start; }
    if (cfg.intro && introP) showIntro(); else start();
  }
})();
