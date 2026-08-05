// editor/account-menu.js -- who am I signed in as (platform-pivot 39, Identity surface 3).
//
// A small surface with one job nothing else does: it is the ONLY place a person can confirm
// which account they are currently using. That matters most in the case it is easiest to
// forget -- an IT admin who signed in with the emergency local account during an outage and
// never signed back out, and who is now making changes as the break-glass admin without
// noticing. The whole point of the ticket is that the emergency account is never invisible
// while it is in use, so it gets a persistent warning strip in the menu AND a visibly
// different avatar in the toolbar.
//
// THE ROLE IS SHOWN BY NAME ONLY. Titles are admin-defined since platform-pivot 37, so the
// menu must not hard-code one or infer meaning from it -- "Technical Authority" tells this
// module nothing and it must stay that way. There is no permissions screen and no capability
// list here; that restraint is a decision (spec question C), not an omission. An author who
// cannot do something learns it from the disabled control, not from a list they have to read.
//
// A POPOVER, per the spine, and the SAME popover the storage dot opens: openChromePop is
// provided by editor.js and already owns the layer stack, Escape, click-outside, focus return
// and anchoring. A second popover implementation is how two popovers end up dismissing
// differently.
//
// SERVER MODE ONLY (Law 4). It reads window.__versoServerPrincipal, which only a server sets,
// so a local install grows no avatar and no menu rather than growing one that says "Owner".
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- the copy + the pure model -------------------------------------------
  var COPY = {
    signOut: "Sign out",
    breakGlassStrip: "Local admin account, in use",
    ssoMethod: "Signed in with {org} sign-in",
    localMethod: "Signed in with the local admin account",
    windowsMethod: "Signed in with your Windows account",
    fallbackOrg: "your organisation"
  };
  // principal + rung + org -> what the menu shows. PURE, so every branch is testable without a
  // browser, and so the break-glass rule is stated once instead of in three render paths.
  function accountModel(principal, rung, org) {
    if (!principal || principal.kind !== "user") return null;
    var name = principal.name || principal.email || "Signed in";
    var breakGlass = !!principal.breakGlass;
    // How they signed in. The break-glass account always reports the local method even on an
    // SSO deployment -- that IS the fact worth surfacing, and reporting the deployment's rung
    // there would hide exactly the case this menu exists for.
    var method;
    if (breakGlass || rung === "local") method = COPY.localMethod;
    else if (rung === "iwa") method = COPY.windowsMethod;
    else method = COPY.ssoMethod.split("{org}").join(org || COPY.fallbackOrg);
    return {
      name: name,
      email: principal.email || null,
      role: principal.role || null,      // the admin-defined NAME, never a capability
      method: method,
      breakGlass: breakGlass,
      strip: breakGlass ? COPY.breakGlassStrip : null,
      initials: initialsOf(name)
    };
  }
  function initialsOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // Only where there is an account to show. A guest holds a link, not an account, and a local
  // install has no principal at all.
  function shouldMount(w) {
    var p = w && w.__versoServerPrincipal;
    return !!(w && w.__versoServerUrl && p && p.kind === "user");
  }

  function install(kernel) {
    var E = kernel.need("h", "openChromePop", "closeChromePop");
    var h = E.h;

    function model() {
      return accountModel(window.__versoServerPrincipal, window.__versoServerRung, window.__versoServerOrg);
    }

    function signOut(base) {
      var url = String(base || window.__versoServerUrl || "").replace(/\/+$/, "") + "/auth/logout";
      return fetch(url, { method: "POST", credentials: "same-origin" })
        .then(function () { window.location.reload(); })
        .catch(function () { window.location.reload(); });
    }

    function openMenu(anchor) {
      var m = model();
      if (!m) return;
      E.openChromePop(anchor, function (pop) {
        // The strip comes FIRST and is persistent: an admin who opened this menu for another
        // reason still sees which account they are on before anything else.
        if (m.strip) pop.appendChild(h("div", "account-pop__strip", m.strip));
        pop.appendChild(h("div", "chrome-pop__title", m.name));
        if (m.email) pop.appendChild(h("div", "account-pop__email", m.email));
        if (m.role) {
          var r = h("div", "chrome-pop__row");
          r.appendChild(h("span", "chrome-pop__label", "Role"));
          r.appendChild(h("span", "chrome-pop__val", m.role));
          pop.appendChild(r);
        }
        pop.appendChild(h("div", "account-pop__method", m.method));
        var out = window.VersoUI.Button({
          variant: "secondary", size: "sm", full: true, label: COPY.signOut,
          onClick: function () { E.closeChromePop(); signOut(); }
        });
        out.classList.add("account-pop__out");
        pop.appendChild(out);
      }, { align: "right", cls: "account-pop" });
    }

    // The avatar lives with the presence cluster in the toolbar's right group, so "who is here"
    // and "who am I" read as one thing rather than two unrelated corners.
    function mount() {
      if (!shouldMount(window)) return null;
      var host = document.querySelector(".toolbar__group--right");
      if (!host) return null;
      var m = model();
      if (!m) return null;
      var btn = host.querySelector(".account-av");
      if (!btn) {
        btn = h("button", "account-av");
        btn.type = "button";
        host.insertBefore(btn, host.firstChild);
        btn.addEventListener("click", function () { openMenu(btn); });
      }
      // The break-glass avatar is visibly different, not merely labelled: someone who never
      // opens the menu should still be able to tell at a glance.
      btn.className = "account-av" + (m.breakGlass ? " account-av--breakglass" : "");
      btn.textContent = m.initials;
      btn.title = m.name + (m.breakGlass ? " — " + COPY.breakGlassStrip : "");
      btn.setAttribute("aria-label", "Account: " + m.name);
      return btn;
    }

    kernel.expose({ accountMenu: { mount: mount, open: openMenu, model: model } });
    if (typeof document !== "undefined" && document.querySelector) mount();
  }

  window.VersoAccountMenu = {
    COPY: COPY, accountModel: accountModel, initialsOf: initialsOf, shouldMount: shouldMount, install: install
  };
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
