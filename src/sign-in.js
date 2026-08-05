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
    // On a local-accounts deployment there IS no SSO path, so the sentence above would point at
    // a button that does not exist. The spec's line is for the break-glass case, which by
    // definition means SSO is configured.
    wrongPasswordNoSso: "That password doesn't match. Try again.",
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
    if (view.error === "credentials" && !vm.ssoDisabled) vm.message = { tone: "error", title: null, body: interpolate(hasSso ? COPY.wrongPassword : COPY.wrongPasswordNoSso, org) };
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

  // ---- first run (platform-pivot 31) ---------------------------------------
  // The OTHER argued exception to the six-presentation spine, on exactly the same grounds as
  // sign-in: there is no canvas to squeeze, because the server is not set up yet. It shares
  // this file and this stylesheet deliberately -- two surfaces that carry the same exception
  // for the same reason should not drift into two looks.
  //
  // It reads as COMPLETING AN INSTALLATION rather than configuring an app: a step rail, four
  // steps, a review, and a done state.
  var FR = {
    steps: ["Local admin account", "Sign-in method", "Data location", "Review"],
    adminWhy: "This account always works, even if your sign-in provider is down. Keep its password somewhere safe — it's the way in if everything else fails.",
    ssoRecommended: "Company sign-in (recommended)",
    localOnly: "Local accounts only",
    eitherWay: "The local admin account you just made works either way.",
    dataWhat: "Your courses, source documents, media and the change log live here. Back it up like any other server folder.",
    dataNeverSmb: "Must be a local disk. Never a network share — SQLite on SMB corrupts silently.",
    doneTitle: "Your Verso server is ready",
    doneBody: "Sign in with the local admin account to add the rest of your team."
  };
  // PURE: which step, what has been filled in -> can we go on. Separated so the wizard's rules
  // are testable without a browser, and so "you cannot skip the admin account" is stated once.
  function firstRunStepValid(step, data) {
    data = data || {};
    if (step === 0) return !!(data.adminEmail && /@/.test(data.adminEmail) && data.adminPassword && data.adminPassword.length >= 8);
    if (step === 1) {
      if (data.method !== "oidc") return true;              // local accounts need nothing more
      return !!(data.issuer && data.clientId && data.clientSecret);
    }
    // A network path is not "filled in but questionable", it is invalid: SQLite corrupts
    // silently on SMB. Leaving Continue enabled beside the inline refusal would have the screen
    // saying two different things at once.
    if (step === 2) return !!data.dataDir && !isNetworkPath(data.dataDir);
    return true;
  }
  // The one hard refusal in the flow. SQLite on SMB corrupts silently under oplocks, and a
  // silent corruption of the doc-of-record is the worst outcome this product has.
  function isNetworkPath(p) {
    var v = String(p || "").trim();
    return /^\\\\/.test(v) || /^[a-z]+:\/\//i.test(v) || /^\/\//.test(v);
  }
  function firstRunPayload(data) {
    var out = { adminEmail: data.adminEmail, adminPassword: data.adminPassword, adminName: data.adminName || null, organisationName: data.organisationName || null };
    if (data.method === "oidc") out.oidc = { issuer: data.issuer, clientId: data.clientId, clientSecret: data.clientSecret, redirectUri: data.redirectUri || null };
    return out;
  }
  function shouldFirstRun(w) { return !!(w && w.__versoServerUrl && w.__versoFirstRunNeeded === true); }

  // The wizard. Same card, same tokens, plus a persistent step rail -- it must read as
  // completing an installation, not as configuring an app.
  function mountFirstRun(opts) {
    opts = opts || {};
    var base = opts.base || window.__versoServerUrl || "";
    var doFetch = opts.fetch || (typeof fetch === "function" ? fetch : null);
    var reload = opts.reload || function () { window.location.reload(); };
    var step = 0, done = false, error = null, busy = false;
    var data = { method: "oidc", dataDir: opts.dataDir || "" };

    var root = el("div", "verso-signin verso-firstrun");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Set up your Verso server");
    var card = el("div", "verso-signin__card verso-firstrun__card");
    root.appendChild(card);

    // `live` re-renders the whole step on every keystroke rather than only the footer. The data
    // folder needs it: its refusal is INLINE, and a field that only repaints the footer left that
    // warning unreachable -- the copy was there and could never appear. Caught in the browser.
    function field(label, key, type, placeholder, live) {
      var wrap = el("div", "verso-signin__field");
      wrap.appendChild(el("label", "verso-signin__label", label));
      var tf = ui().TextField({ value: data[key] || "", type: type || "text", placeholder: placeholder || "",
        onChange: function (v) {
          data[key] = v;
          if (live) { var pos = tf.input.selectionStart; render(); var next = document.querySelector(".verso-firstrun__card .vds-textfield__input"); if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) {} } }
          else paintFooter();
        } });
      wrap.appendChild(tf);
      return wrap;
    }
    var footer;
    function paintFooter() {
      if (!footer) return;
      footer.textContent = "";
      if (step > 0) footer.appendChild(ui().Button({ variant: "ghost", size: "sm", label: "Back",
        onClick: function () { step--; error = null; render(); } }));
      var last = step === 3;
      footer.appendChild(ui().Button({
        variant: "primary", full: true, label: last ? "Set up this server" : "Continue",
        disabled: busy || !firstRunStepValid(step, data),
        onClick: function () { if (last) submit(); else { step++; error = null; render(); } }
      }));
    }

    function render() {
      card.textContent = "";
      card.appendChild(el("p", "verso-signin__mark", "Verso"));
      if (done) {
        card.appendChild(el("p", "verso-signin__title", FR.doneTitle));
        card.appendChild(el("p", "verso-signin__lede", FR.doneBody));
        card.appendChild(ui().Button({ variant: "primary", full: true, label: "Sign in", onClick: reload }));
        return;
      }
      // The rail is persistent: at every step you can see how many are left, which is what
      // makes this read as an installation rather than an open-ended settings screen.
      var rail = el("ol", "verso-firstrun__rail");
      FR.steps.forEach(function (label, i) {
        rail.appendChild(el("li", "verso-firstrun__step" + (i === step ? " is-current" : (i < step ? " is-done" : "")), label));
      });
      card.appendChild(rail);
      if (error) {
        var m = el("div", "verso-signin__msg verso-signin__msg--error");
        m.textContent = error;
        card.appendChild(m);
      }

      if (step === 0) {
        card.appendChild(el("p", "verso-signin__title", FR.steps[0]));
        card.appendChild(el("p", "verso-signin__note", FR.adminWhy));
        card.appendChild(field("Your name", "adminName"));
        card.appendChild(field("Email", "adminEmail", "email"));
        card.appendChild(field("Password", "adminPassword", "password"));
        card.appendChild(field("Organisation name", "organisationName"));
      } else if (step === 1) {
        card.appendChild(el("p", "verso-signin__title", FR.steps[1]));
        var seg = ui().SegmentedControl({
          options: [{ value: "oidc", label: FR.ssoRecommended }, { value: "local", label: FR.localOnly }],
          value: data.method, onChange: function (v) { data.method = v; render(); }
        });
        card.appendChild(seg);
        card.appendChild(el("p", "verso-signin__note", FR.eitherWay));
        if (data.method === "oidc") {
          card.appendChild(field("Issuer URL", "issuer", "text", "https://login.microsoftonline.com/<tenant>/v2.0"));
          card.appendChild(field("Client ID", "clientId"));
          card.appendChild(field("Client secret", "clientSecret", "password"));
        }
      } else if (step === 2) {
        card.appendChild(el("p", "verso-signin__title", FR.steps[2]));
        card.appendChild(el("p", "verso-signin__note", FR.dataWhat));
        card.appendChild(field("Folder", "dataDir", "text", "D:\\Verso\\data", true));
        var warn = el("p", "verso-signin__note verso-firstrun__never", FR.dataNeverSmb);
        card.appendChild(warn);
        if (isNetworkPath(data.dataDir)) {
          var bad = el("div", "verso-signin__msg verso-signin__msg--error");
          bad.textContent = "That looks like a network share. SQLite corrupts silently on SMB — use a local disk.";
          card.appendChild(bad);
        }
      } else {
        card.appendChild(el("p", "verso-signin__title", FR.steps[3]));
        [["Local admin", data.adminEmail],
         ["Sign-in", data.method === "oidc" ? "Company sign-in (" + (data.issuer || "") + ")" : "Local accounts only"],
         ["Data folder", data.dataDir]].forEach(function (row) {
          var r = el("div", "chrome-pop__row");
          r.appendChild(el("span", "verso-signin__label", row[0]));
          r.appendChild(el("span", "verso-firstrun__val", row[1] || "—"));
          card.appendChild(r);
        });
      }
      footer = el("div", "verso-firstrun__footer");
      card.appendChild(footer);
      paintFooter();
    }

    function submit() {
      // The one refusal in the flow, enforced at the last moment as well as inline: a network
      // path here means silent corruption of the doc-of-record later.
      if (isNetworkPath(data.dataDir)) { error = "The data folder must be on a local disk."; return render(); }
      busy = true; error = null; render();
      doFetch(base.replace(/\/+$/, "") + "/api/first-run", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(firstRunPayload(data))
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          busy = false;
          if (j && j.ok) { done = true; return render(); }
          error = (j && j.error) || "Setup could not be completed."; render();
        })
        .catch(function () { busy = false; error = "Could not reach the Verso server."; render(); });
    }

    render();
    if (document.body) document.body.appendChild(root);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(root); });
    return { root: root, render: render, _data: data, _step: function () { return step; } };
  }

  window.VersoSignIn = {
    COPY: COPY, interpolate: interpolate, viewModel: viewModel, shouldSignIn: shouldSignIn, mount: mount, install: install,
    // platform-pivot 31 first run, sharing this surface's argued exception
    FIRST_RUN: FR, firstRunStepValid: firstRunStepValid, isNetworkPath: isNetworkPath,
    firstRunPayload: firstRunPayload, shouldFirstRun: shouldFirstRun, mountFirstRun: mountFirstRun
  };

  // Live install. Guarded on a real document so `require` in the suite is inert.
  // First run comes BEFORE sign-in: there is nobody to sign in as yet.
  if (typeof document !== "undefined" && document.createElement) {
    if (shouldFirstRun(window)) mountFirstRun({ base: window.__versoServerUrl });
    else install(window);
  }

  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
