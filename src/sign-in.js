/*
 * src/sign-in.js -- the server-mode sign-in surface (platform-pivot 19, Identity surface 1).
 *
 * WHY IT IS NOT AN EDITOR MODULE. Nobody is signed in yet, so there is no document, no
 * registry and no editor to hang a panel off. This runs before all of that, off the one fact
 * the bootstrap script already publishes: window.__versoServerAuthRequired. In a local
 * install that global never exists, this file installs nothing, and Law 4 holds by
 * construction rather than by a check somewhere.
 *
 * FIVE STATES, AND THE COPY IS PART OF THE SPECIFICATION. specs/3-identity.spec.md ->
 * "Identity UI surfaces", surface 1. The lines below are quoted from it rather than
 * paraphrased, because each one carries a decision the visual layer cannot state:
 *
 *   - SSO is the only prominent path; break-glass is a quiet link under a divider, never a
 *     peer button, because an emergency account offered as an equal choice gets used as one.
 *   - There is no password field on the SSO path, and the surface says why: the password is
 *     entered on the organisation's own page and Verso never sees it.
 *   - AN OUTAGE IS NOT A WRONG PASSWORD. If the IdP cannot be reached the surface says so in
 *     those words, disables the SSO button and leaves the break-glass link live. Rendering a
 *     credentials error there sends an admin off hunting a password problem that does not
 *     exist, during the exact incident the break-glass account was built for.
 *   - A wrong break-glass password must not implicate the SSO path either.
 *
 * NO ORGANISATION NAME IS COMPILED IN. Every "{org}" is the name set at first-run and served
 * by GET /auth/config, falling back to "your organisation". The repo hygiene gate hard-fails
 * on a customer name in shipping code, and this is the surface most likely to acquire one.
 *
 * Dependency-free, classic script, no framework. Styles are styles/editor/15-sign-in.css.
 */
(function () {
  // arch-P2 test seam: a real window in the browser, this file's own namespace under require.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  var FALLBACK_ORG = "your organisation";

  // ---- the copy, in one table (pure) ---------------------------------------
  // Held together so the whole set can be read at once, and so a test can assert the exact
  // sentences rather than a paraphrase of them. {org} is interpolated at render.
  var COPY = {
    title: "Sign in to Verso",
    lede: "Verso is running on your organisation's server. Sign in to open your courses.",
    ssoButton: "Continue with {org} sign-in",
    ssoReassurance: "You'll enter your password on {org}'s own sign-in page. Verso never sees it.",
    ssoRedirecting: "Taking you to {org}'s sign-in page…",
    idpDownTitle: "Can't reach the sign-in service",
    idpDown: "Can't reach your organisation's sign-in service right now. This isn't your password — try again shortly, or use the local admin account below.",
    breakGlassLink: "Use the local admin account",
    breakGlassWhy: "For emergencies — works even when {org}'s sign-in service is down.",
    wrongPassword: "That password doesn't match. Try again, or continue with {org} sign-in above.",
    localOnlyLede: "Verso is running on your organisation's server. Sign in with your Verso account.",
    signingIn: "Signing in…",
    back: "Back"
  };
  function interpolate(s, org) { return String(s).split("{org}").join(org || FALLBACK_ORG); }

  // ---- which state to render (pure) ----------------------------------------
  // Separated from the DOM so every branch is testable without a browser, and so the rule
  // that an outage disables ONLY the SSO button is stated once rather than in three handlers.
  //   cfg   = what GET /auth/config returned (or null if it could not be read)
  //   view  = { showLocal, error, busy }
  function viewModel(cfg, view) {
    cfg = cfg || {};
    view = view || {};
    var org = cfg.org || FALLBACK_ORG;
    var hasSso = !!cfg.sso;
    // A deployment with no SSO rung has nothing to be down. Treating "unreachable" as the
    // default would show every local-accounts server a permanent outage banner.
    var reachable = hasSso ? (cfg.ssoReachable !== false) : true;
    var vm = {
      org: org,
      hasSso: hasSso,
      // With no SSO configured there is no second path to hide behind: the account form IS
      // the surface, and calling it "break-glass" there would be theatre.
      showLocalForm: !hasSso || !!view.showLocal,
      localIsBreakGlass: hasSso,
      ssoDisabled: hasSso && !reachable,
      busy: !!view.busy,
      lede: interpolate(hasSso ? COPY.lede : COPY.localOnlyLede, org),
      ssoLabel: interpolate(COPY.ssoButton, org),
      ssoNote: interpolate(COPY.ssoReassurance, org),
      breakGlassLabel: COPY.breakGlassLink,
      breakGlassNote: interpolate(COPY.breakGlassWhy, org),
      message: null
    };
    if (vm.ssoDisabled) vm.message = { tone: "warn", title: COPY.idpDownTitle, body: interpolate(COPY.idpDown, org) };
    // A credentials error never overwrites the outage notice: the outage is the bigger fact,
    // and it is the one that explains why they are on the local form at all.
    if (view.error === "credentials" && !vm.ssoDisabled) vm.message = { tone: "error", title: null, body: interpolate(COPY.wrongPassword, org) };
    else if (view.error && view.error !== "credentials" && !vm.ssoDisabled) vm.message = { tone: "error", title: null, body: String(view.error) };
    return vm;
  }

  // Should this page show a sign-in surface at all? PURE, and deliberately narrow: only a
  // server that has told us it needs authentication. No server URL, or a resolved principal,
  // means nothing renders -- which is what keeps the local posture untouched.
  function shouldSignIn(w) {
    return !!(w && w.__versoServerUrl && w.__versoServerAuthRequired === true);
  }

  // ---- the surface ---------------------------------------------------------
  // EVERY CONTROL IS A CANONICAL ONE. src/ui-kit.js publishes window.VersoUI as a standalone
  // classic script loaded long before this file, so "the editor has not booted yet" is not a
  // reason to hand-roll a button or an input -- and hand-rolled controls are the exact
  // divergence the design authority exists to stop. Button and TextField come styled by
  // styles/editor/12-controls.css; this file adds layout and prose only.
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function ui() { return (typeof window !== "undefined" && window.VersoUI) || null; }

  function mount(opts) {
    opts = opts || {};
    var base = opts.base || window.__versoServerUrl || "";
    var doFetch = opts.fetch || (typeof fetch === "function" ? fetch : null);
    var reload = opts.reload || function () { window.location.reload(); };
    var go = opts.navigate || function (url) { window.location.href = url; };
    var state = { showLocal: false, error: null, busy: false };
    var cfg = null;

    var root = el("div", "verso-signin");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", COPY.title);
    var card = el("div", "verso-signin__card");
    root.appendChild(card);

    function render() {
      var vm = viewModel(cfg, state);
      card.textContent = "";
      card.appendChild(el("p", "verso-signin__mark", "Verso"));
      card.appendChild(el("p", "verso-signin__lede", vm.lede));

      if (vm.message) {
        var m = el("div", "verso-signin__msg verso-signin__msg--" + vm.message.tone);
        if (vm.message.title) m.appendChild(el("strong", null, vm.message.title));
        m.appendChild(document.createTextNode(vm.message.body));
        card.appendChild(m);
      }
      if (vm.busy) { card.appendChild(el("p", "verso-signin__busy", COPY.signingIn)); return; }

      if (vm.hasSso && !vm.showLocalForm) {
        card.appendChild(ui().Button({
          variant: "primary", full: true, label: vm.ssoLabel, disabled: vm.ssoDisabled,
          onClick: function () { state.busy = true; render(); go(base.replace(/\/+$/, "") + "/auth/sso/start"); }
        }));
        card.appendChild(el("p", "verso-signin__note", vm.ssoNote));

        card.appendChild(el("div", "verso-signin__divider", "or"));
        var link = el("button", "verso-signin__link", vm.breakGlassLabel);
        link.type = "button";
        link.addEventListener("click", function () { state.showLocal = true; state.error = null; render(); });
        card.appendChild(link);
        card.appendChild(el("p", "verso-signin__note", vm.breakGlassNote));
        return;
      }

      // the account form -- the break-glass path, or the whole surface on a local-accounts server
      if (vm.localIsBreakGlass) card.appendChild(el("p", "verso-signin__title", "Local admin account"));
      var form = el("form");
      function field(labelText, props) {
        var wrap = el("div", "verso-signin__field");
        wrap.appendChild(el("label", "verso-signin__label", labelText));
        var tf = ui().TextField(props);
        wrap.appendChild(tf);
        form.appendChild(wrap);
        return tf.input;
      }
      var email = field("Email", { type: "email", name: "email", autocomplete: "username" });
      var pw = field("Password", { type: "password", name: "password", autocomplete: "current-password" });

      var submitWrap = el("div", "verso-signin__submit");
      submitWrap.appendChild(ui().Button({ variant: "primary", full: true, label: "Sign in", type: "submit" }));
      form.appendChild(submitWrap);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        state.busy = true; state.error = null; render();
        signIn(email.value, pw.value);
      });
      card.appendChild(form);

      if (vm.hasSso) {
        var back = el("div", "verso-signin__back");
        var b = el("button", "verso-signin__link", COPY.back);
        b.type = "button";
        b.addEventListener("click", function () { state.showLocal = false; state.error = null; render(); });
        back.appendChild(b);
        card.appendChild(back);
      }
      // Keyboard-first, and the sibling's precedent (promptModal focuses its field): on a
      // local-accounts server this form IS the surface, so landing without focus means the
      // author must reach for the mouse before they can type their first character.
      if (email && email.focus) { try { email.focus(); } catch (e) {} }
    }

    function signIn(emailValue, password) {
      if (!doFetch) { state.busy = false; state.error = "Sign-in is unavailable in this browser."; return render(); }
      doFetch(base.replace(/\/+$/, "") + "/auth/login", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue, password: password })
      }).then(function (r) {
        if (r && r.ok) return reload();
        state.busy = false; state.error = "credentials"; render();
      }).catch(function () {
        state.busy = false;
        state.error = "Could not reach the Verso server. Check your connection and try again.";
        render();
      });
    }

    render();
    if (document.body) document.body.appendChild(root);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(root); });

    // The rung and the organisation name are a fetch, so the surface renders immediately with
    // the safe default (an account form) and upgrades the moment the config lands. A blank
    // screen while a request is in flight is the one state an outage must not produce.
    if (doFetch) {
      doFetch(base.replace(/\/+$/, "") + "/auth/config", { credentials: "same-origin" })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.ok) { cfg = j; render(); } })
        .catch(function () {});
    }
    return { root: root, render: render, _state: state, _setConfig: function (c) { cfg = c; render(); } };
  }

  function install(w) {
    w = w || window;
    if (!shouldSignIn(w)) return null;
    return mount({ base: w.__versoServerUrl });
  }

  window.VersoSignIn = { COPY: COPY, interpolate: interpolate, viewModel: viewModel, shouldSignIn: shouldSignIn, mount: mount, install: install };

  // Live install. Guarded on a real document so `require` in the suite is inert.
  if (typeof document !== "undefined" && document.createElement) install(window);

  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
