/*
 * src/session-state.js -- the signed-out state inside the app (platform-pivot 38,
 * Identity surface 2). SERVER MODE ONLY; installs nothing in a local install.
 *
 * THE FAILURE THIS EXISTS TO PREVENT. A session expires while someone is mid-sentence.
 * Everything still looks editable, so they keep typing, and every keystroke goes nowhere.
 * That is the one identity state that loses an author's work, which is why the spec
 * (specs/3-identity.spec.md -> "Identity UI surfaces", surface 2) specifies it separately
 * from sign-in rather than folding it in.
 *
 * THE ANSWER IS NOT TO TAKE THE CANVAS AWAY. Losing sight of the text is worse than losing
 * the ability to save it: the author must be able to read and copy what they wrote. So
 * nothing here blanks, disables or modal-blocks the canvas. What changes is that the app
 * stops pretending to save, in two places at once -- a banner under the toolbar, and a quiet
 * persistent chip on the canvas for the author who has scrolled past the banner.
 *
 * SIGNING BACK IN MUST NOT RELOAD THIS TAB. The danger-state copy promises "this tab keeps
 * your edit until you reload", so a sign-in that reloads would break the promise in the act
 * of keeping it. The banner opens sign-in in a SEPARATE window and polls /auth/me until a
 * principal comes back; only then does it say saving has resumed. That is also why the
 * recovery state exists at all: an alarm that never visibly cancels trains people to ignore
 * the next one.
 *
 * App chrome, not one of the six spine surfaces -- a sibling of #save-fail-banner and
 * #storage-advisory in editor.js, which are the same species and the same shape.
 *
 * Dependency-free classic script. Styles: styles/editor/16-session.css.
 */
(function () {
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  // ---- the copy, verbatim from the spec ------------------------------------
  // Each line carries a decision the visuals cannot state: that nothing is being saved, that
  // the window for recovering it closes at reload, and -- in the recovery line -- that
  // nothing was actually lost, which is the only thing the author wants to know.
  var COPY = {
    expired: {
      tone: "warn",
      title: "Your session expired",
      body: "Nothing you type from here is being saved. Sign in to keep working."
    },
    refused: {
      tone: "danger",
      title: "That change wasn't saved",
      body: "You're signed out, so nothing you type is being saved. This tab keeps your edit until you reload — sign in now to keep it."
    },
    restored: {
      tone: "success",
      title: "Signed back in",
      body: "Saving has resumed — nothing from the last few minutes was lost."
    },
    chip: "Not saving",
    action: "Sign in",
    checking: "Checking…"
  };

  // ---- the state machine (pure) --------------------------------------------
  // Four states, and the ONE rule that matters is the ratchet in the middle: once a save has
  // actually been refused, an expiry notice must never demote the message back to the milder
  // warning. The refusal states a loss that already happened; the warning states a risk. A
  // second 401 arriving a moment later must not quietly downgrade it.
  var STATES = ["active", "expired", "refused", "restored"];
  function nextState(current, event) {
    if (event === "signedIn") return "restored";
    if (event === "saveRefused") return "refused";
    if (event === "authRequired") return current === "refused" ? "refused" : "expired";
    if (event === "dismissRestored") return "active";
    return current;
  }
  // What the chrome shows for a state. Returns null for "active", which is how the banner and
  // the chip both know to be absent rather than empty.
  function viewFor(state) {
    if (state === "active" || STATES.indexOf(state) < 0) return null;
    var c = COPY[state];
    return {
      state: state, tone: c.tone, title: c.title, body: c.body,
      // The chip says the same fact in two words, and it is on for exactly the states in which
      // saving is actually off -- never during recovery, when saying "Not saving" would
      // contradict the banner beside it.
      chip: (state === "expired" || state === "refused") ? COPY.chip : null,
      action: (state === "expired" || state === "refused") ? COPY.action : null
    };
  }
  // Server mode only, and only once the server has told us who we are (or that it does not
  // know). A local install has no session to lose.
  function shouldInstall(w) {
    return !!(w && w.__versoServerUrl && w.__versoServerMode === "server");
  }

  // ---- the chrome ----------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function create(opts) {
    opts = opts || {};
    var base = opts.base || window.__versoServerUrl || "";
    var doFetch = opts.fetch || (typeof fetch === "function" ? fetch : null);
    var openWindow = opts.openWindow || function (url) { return window.open(url, "verso-signin", "width=460,height=640"); };
    var setTimer = opts.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var state = "active";
    var banner = null, chip = null, polling = false;

    function ensureBanner() {
      if (banner) return banner;
      banner = el("div", "verso-session");
      banner.id = "session-banner";
      banner.setAttribute("role", "alert");
      banner.__title = el("strong", "verso-session__title");
      banner.__body = el("span", "verso-session__body");
      banner.appendChild(banner.__title);
      banner.appendChild(banner.__body);
      // Canonical control, not a hand-rolled one. window.VersoUI is a standalone classic
      // script loaded well before this file, so there is no reason to roll a button -- and
      // #save-fail-banner's bespoke .save-fail-banner__btn beside it is the divergence, not
      // the precedent to copy.
      banner.__action = window.VersoUI.Button({ variant: "secondary", size: "sm", label: COPY.action, onClick: signInAgain });
      banner.__action.classList.add("verso-session__action");
      banner.appendChild(banner.__action);
      // BETWEEN the toolbar and the canvas, literally. body is a flex column with the
      // workspace as its growing child, so inserting here puts the banner in the layout and
      // the canvas shifts down by its height. Floating it over the top instead landed it on
      // the Files header, which is how this was caught -- a fixed banner has no idea what is
      // underneath it, and what is underneath it changes with the stage.
      var ws = document.getElementById("workspace");
      if (ws && ws.parentNode) ws.parentNode.insertBefore(banner, ws);
      else document.body.appendChild(banner);
      return banner;
    }
    function ensureChip() {
      if (chip) return chip;
      chip = el("div", "verso-session-chip");
      chip.id = "session-chip";
      // aria-hidden: the banner already announces this to a screen reader, and a second
      // live region saying the same two words would just talk over it.
      chip.setAttribute("aria-hidden", "true");
      document.body.appendChild(chip);
      return chip;
    }

    function render() {
      var v = viewFor(state);
      if (!v) {
        if (banner) banner.hidden = true;
        if (chip) chip.hidden = true;
        return;
      }
      var b = ensureBanner();
      b.hidden = false;
      b.className = "verso-session verso-session--" + v.tone;
      b.__title.textContent = v.title;
      b.__body.textContent = v.body;
      b.__action.hidden = !v.action;
      if (v.action) { var lab = b.__action.querySelector(".vds-btn__label"); if (lab) lab.textContent = polling ? COPY.checking : v.action; }
      b.__action.disabled = polling;
      var c = ensureChip();
      c.hidden = !v.chip;
      if (v.chip) c.textContent = v.chip;
    }

    function to(event) {
      var was = state;
      state = nextState(state, event);
      if (state !== was || event === "signedIn") render();
      return state;
    }

    // Open sign-in in its own window and watch for it to work. Polling rather than waiting for
    // a message from that window, because the SSO path leaves the origin entirely and comes
    // back through a redirect this tab never sees.
    function signInAgain() {
      if (polling) return;
      var w = openWindow(base.replace(/\/+$/, "") + "/");
      polling = true; render();
      var tries = 0;
      (function poll() {
        if (!doFetch) { polling = false; return render(); }
        tries++;
        doFetch(base.replace(/\/+$/, "") + "/auth/me", { credentials: "same-origin" })
          .then(function (r) { return r && r.ok ? r.json() : null; })
          .then(function (j) {
            if (j && j.principal) {
              polling = false;
              try { if (w && w.close) w.close(); } catch (e) {}
              // Tell the storage adapter first: the banner says saving has resumed, and it
              // must be true by the time anyone reads it.
              if (window.__versoHttpAuthRestored) { try { window.__versoHttpAuthRestored(); } catch (e) {} }
              return to("signedIn");
            }
            if (tries < 240) return setTimer(poll, 1500);
            polling = false; render();
          })
          .catch(function () {
            if (tries < 240) return setTimer(poll, 1500);
            polling = false; render();
          });
      })();
    }

    return {
      state: function () { return state; },
      authRequired: function () { return to("authRequired"); },
      saveRefused: function () { return to("saveRefused"); },
      signedIn: function () { return to("signedIn"); },
      dismissRestored: function () { return to("dismissRestored"); },
      render: render,
      _banner: function () { return banner; },
      _chip: function () { return chip; },
      _polling: function () { return polling; }
    };
  }

  function install(w) {
    w = w || window;
    if (!shouldInstall(w)) return null;
    var s = create({ base: w.__versoServerUrl });
    // The bootstrap already knows we arrived signed out; say so rather than waiting for the
    // first failed save, which might be four seconds of typing away.
    if (w.__versoServerAuthRequired === true) s.authRequired();
    return s;
  }

  window.VersoSession = {
    COPY: COPY, STATES: STATES, nextState: nextState, viewFor: viewFor,
    shouldInstall: shouldInstall, create: create, install: install
  };
  if (typeof document !== "undefined" && document.createElement) window.__versoSession = install(window);

  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
