// editor/admin-users.js -- people and roles, for whoever can manage them
// (platform-pivot 21, Identity surface 4). SERVER MODE ONLY (Law 4).
//
// PRESENTATION: ITS OWN FULL SURFACE, not a right-docked sheet. James settled this 2026-08-05
// and the reasoning is recorded so it is not relitigated: an IT admin adding people is not
// adjusting a setting and has no use for the canvas behind, and the at-scale state needs
// search, a count, pagination and a per-row role editor -- more than a sheet should hold. It
// is NOT a fifth authoring destination either: putting "People" beside Source/Edit/Publish
// would sit it in front of every author, almost none of whom can open it.
//
// THE SERVER DECIDES, THIS RENDERS. Every refusal and every warning on this screen is computed
// by platform-pivot-37 and arrives with the data: the two composition guardrails come back on
// each role, and the never-locked-out refusal comes back from the write that was declined. This
// module must never re-derive them. A UI that computes its own copy of a server rule is a UI
// that will one day explain a rule the server did not apply -- and here that means telling an
// admin their change was fine when it was refused, or refused when it went through.
//
// TITLES ARE DATA. Nothing here hard-codes "admin" or infers meaning from a role's name; the
// capability tick-boxes come from the server's fixed vocabulary and the names are whatever the
// organisation chose. That is what makes a rename a rename rather than a permissions change.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  var PAGE_SIZE = 25;

  // ---- copy (normative; specs/3-identity.spec.md surface 4) -----------------
  var COPY = {
    title: "People",
    emptyTitle: "You're the only account so far",
    emptyBody: "Add the people who'll be authoring alongside you.",
    guests: "Guests hold a link, not an account — they can view and comment on one document each.",
    guestsLink: "Review links",
    you: "— you",
    rolesTitle: "Roles",
    newRole: "New role",
    remove: "Remove from workspace",
    search: "Search people",
    refusalTitle: "Someone must be able to manage this server",
    // Capability-first, because titles are renameable: naming "the admin role" here could be
    // false the moment somebody renames it.
    refusalBody: "{name} is the only person who can manage users and server configuration. At least one must remain, so nobody is ever locked out of sign-in, users, and configuration. Nothing was changed.",
    refusalWayOut: "To change this person's role, first give someone else a role that can manage users and server configuration."
  };

  // ---- pure view helpers ----------------------------------------------------
  // Search + paginate. Pure so the at-scale state (the prototype's reference is several hundred
  // people) is testable without rendering several hundred rows.
  function filterPeople(users, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return (users || []).slice();
    return (users || []).filter(function (u) {
      return String(u.name || "").toLowerCase().indexOf(q) >= 0 ||
             String(u.email || "").toLowerCase().indexOf(q) >= 0 ||
             String(u.role || "").toLowerCase().indexOf(q) >= 0;
    });
  }
  function paginate(list, page, size) {
    size = size || PAGE_SIZE;
    var total = (list || []).length;
    var pages = Math.max(1, Math.ceil(total / size));
    var p = Math.min(Math.max(1, page || 1), pages);
    return { page: p, pages: pages, total: total, rows: (list || []).slice((p - 1) * size, p * size) };
  }
  // The empty state is "only the installing admin", not "no rows" -- there is always at least
  // one account, so an empty TABLE would never appear and a bare table of one is not an
  // explanation.
  function isEmptyState(users, selfId) {
    var real = (users || []).filter(function (u) { return !u.breakGlass; });
    return real.length <= 1 && (!selfId || real.every(function (u) { return u.id === selfId; }));
  }
  // A refusal from the server, turned into the modal's three sentences. Returns null for
  // anything that is not the never-locked-out invariant, so an ordinary error is not dressed up
  // as a constitutional one.
  function refusalFor(res, personName) {
    if (!res || res.ok || res.invariant !== "lastCapabilityHolder") return null;
    return {
      title: COPY.refusalTitle,
      body: COPY.refusalBody.split("{name}").join(personName || "That person"),
      wayOut: COPY.refusalWayOut
    };
  }
  // Server mode, and only for someone who can actually manage users. The capability is ASKED
  // FOR (GET /auth/me) rather than read off the page: the bootstrap deliberately carries no
  // capability list, because a list in the page invites a client-side check that looks
  // authoritative and is not.
  function shouldOffer(principal) {
    return !!(principal && principal.kind === "user" &&
      Array.isArray(principal.capabilities) && principal.capabilities.indexOf("manageUsers") >= 0);
  }

  function install(kernel) {
    var E = kernel.need("h");
    var h = E.h;
    // confirmModal/promptModal are EXPOSED by modals.js, not provided -- and need() resolves
    // against provide(), never against another module's expose. bind() is the documented way
    // across that line, and it is what editor.js itself uses for these two.
    var confirmModal = kernel.bind("confirmModal");
    var promptModal = kernel.bind("promptModal");
    var UI = function () { return window.VersoUI; };
    var base = function () { return String(window.__versoServerUrl || "").replace(/\/+$/, ""); };
    var root = null, state = { users: [], roles: [], caps: [], query: "", page: 1, selfId: null, busy: false, error: null };

    function api(path, opts) {
      return fetch(base() + path, Object.assign({ credentials: "same-origin" }, opts || {}))
        .then(function (r) { return r.json().then(function (j) { j.__status = r.status; return j; }).catch(function () { return { ok: false, __status: r.status }; }); });
    }
    function load() {
      return Promise.all([api("/api/users"), api("/api/roles"), api("/auth/me")]).then(function (r) {
        state.users = (r[0] && r[0].users) || [];
        state.roles = (r[1] && r[1].roles) || [];
        state.caps = (r[1] && r[1].capabilities) || [];
        state.defaultRoleId = r[1] && r[1].defaultRoleId;
        state.selfId = r[2] && r[2].principal && r[2].principal.principal;
        render();
      });
    }
    // Every write goes through here so the refusal path is stated ONCE. A declined write
    // re-loads rather than patching local state: the server is the only thing that knows what
    // actually happened, and a UI that assumes its own write succeeded is how a screen ends up
    // disagreeing with the database.
    function write(promise, personName) {
      state.busy = true; render();
      return promise.then(function (res) {
        state.busy = false;
        var refusal = refusalFor(res, personName);
        if (refusal) showRefusal(refusal);
        else if (!res.ok) state.error = res.error || "That change could not be saved.";
        else state.error = null;
        return load();
      }).catch(function () { state.busy = false; state.error = "Could not reach the Verso server."; render(); });
    }
    function showRefusal(r) {
      // A modal, because it is a blocking decision the admin has to read before continuing --
      // the one thing the spine allows a modal for besides a destructive confirm.
      confirmModal(r.title, r.body + "\n\n" + r.wayOut, function () {}, { okLabel: "I understand" });
    }

    // ---- the surface ---------------------------------------------------------
    function close() { if (root) { root.remove(); root = null; } }
    function open() {
      close();
      root = h("div", "verso-admin");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", COPY.title);
      document.body.appendChild(root);
      load();
    }

    function render() {
      if (!root) return;
      root.textContent = "";
      var head = h("div", "verso-admin__head");
      head.appendChild(h("h1", "verso-admin__title", COPY.title));
      var closeBtn = UI().Button({ variant: "ghost", size: "sm", label: "Close", onClick: close });
      head.appendChild(closeBtn);
      root.appendChild(head);

      var body = h("div", "verso-admin__body");
      root.appendChild(body);
      if (state.error) body.appendChild(h("div", "verso-admin__error", state.error));
      renderPeople(body);
      renderGuests(body);
      renderRoles(body);
    }

    function renderPeople(body) {
      var sec = h("section", "verso-admin__section");
      if (isEmptyState(state.users, state.selfId)) {
        var e = h("div", "verso-admin__empty");
        e.appendChild(h("p", "verso-admin__empty-title", COPY.emptyTitle));
        e.appendChild(h("p", "verso-admin__empty-body", COPY.emptyBody));
        sec.appendChild(e);
        body.appendChild(sec);
        return;
      }
      var filtered = filterPeople(state.users, state.query);
      var pg = paginate(filtered, state.page);

      var bar = h("div", "verso-admin__bar");
      var search = UI().TextField({
        value: state.query, placeholder: COPY.search,
        onChange: function (v) { state.query = v; state.page = 1; render(); }
      });
      search.classList.add("verso-admin__search");
      bar.appendChild(search);
      bar.appendChild(h("span", "verso-admin__count", pg.total + (pg.total === 1 ? " person" : " people")));
      sec.appendChild(bar);

      var list = h("div", "verso-admin__list");
      pg.rows.forEach(function (u) { list.appendChild(personRow(u)); });
      sec.appendChild(list);

      if (pg.pages > 1) {
        var nav = h("div", "verso-admin__pager");
        nav.appendChild(UI().Button({ variant: "secondary", size: "sm", label: "Previous", disabled: pg.page === 1,
          onClick: function () { state.page = pg.page - 1; render(); } }));
        nav.appendChild(h("span", "verso-admin__pageno", "Page " + pg.page + " of " + pg.pages));
        nav.appendChild(UI().Button({ variant: "secondary", size: "sm", label: "Next", disabled: pg.page === pg.pages,
          onClick: function () { state.page = pg.page + 1; render(); } }));
        sec.appendChild(nav);
      }
      body.appendChild(sec);
    }

    function personRow(u) {
      var row = h("div", "verso-admin__row");
      var av = h("div", "verso-admin__av" + (u.breakGlass ? " verso-admin__av--breakglass" : ""));
      av.textContent = window.VersoAccountMenu.initialsOf(u.name || u.email);
      row.appendChild(av);
      var who = h("div", "verso-admin__who");
      var nm = h("div", "verso-admin__name", u.name || u.email);
      if (u.id === state.selfId) nm.appendChild(h("span", "verso-admin__you", " " + COPY.you));
      who.appendChild(nm);
      who.appendChild(h("div", "verso-admin__email", u.email || ""));
      row.appendChild(who);
      row.appendChild(h("div", "verso-admin__role", u.role || "—"));

      // The row editor opens INLINE, not on another screen: an admin changing three people's
      // roles should never lose their place in the list to do it.
      var open = false;
      var editor = h("div", "verso-admin__editor");
      editor.hidden = true;
      var more = UI().IconButton({ icon: "more-horizontal", label: "Edit " + (u.name || u.email), size: "sm",
        onClick: function () { open = !open; editor.hidden = !open; } });
      row.appendChild(more);

      var sel = UI().Select({
        options: state.roles.map(function (r) { return { value: r.id, label: r.name }; }),
        value: u.roleId || "",
        onChange: function (v) { write(api("/api/users/" + encodeURIComponent(u.id) + "/role", { method: "PUT", body: JSON.stringify({ roleId: v }) }), u.name); }
      });
      var f = h("div", "verso-admin__field");
      f.appendChild(h("span", "verso-admin__label", "Role"));
      f.appendChild(sel);
      editor.appendChild(f);
      editor.appendChild(UI().Button({
        variant: "danger", size: "sm", label: COPY.remove,
        onClick: function () {
          confirmModal("Remove " + (u.name || u.email) + "?",
            "They lose access to this server immediately. Their work stays where it is.",
            function () { write(api("/api/users/" + encodeURIComponent(u.id), { method: "DELETE" }), u.name); },
            { danger: true, okLabel: "Remove" });
        }
      }));

      var wrap = h("div", "verso-admin__rowwrap");
      wrap.appendChild(row);
      wrap.appendChild(editor);
      return wrap;
    }

    // Guests are shown, but never as rows: there is no account to manage, and a row implies one.
    function renderGuests(body) {
      var sec = h("div", "verso-admin__guests");
      sec.appendChild(h("span", "verso-admin__guests-note", COPY.guests));
      body.appendChild(sec);
    }

    function renderRoles(body) {
      var sec = h("section", "verso-admin__section");
      var head = h("div", "verso-admin__bar");
      head.appendChild(h("h2", "verso-admin__subtitle", COPY.rolesTitle));
      head.appendChild(UI().Button({
        variant: "secondary", size: "sm", label: COPY.newRole,
        onClick: function () {
          promptModal("New role", "Name", "", function (name) {
            if (name) write(api("/api/roles", { method: "POST", body: JSON.stringify({ name: name, capabilities: ["view"] }) }));
          });
        }
      }));
      sec.appendChild(head);

      state.roles.forEach(function (r) {
        var card = h("div", "verso-admin__role-card");
        var top = h("div", "verso-admin__role-head");
        var nameField = UI().TextField({ value: r.name, onChange: function () {} });
        nameField.classList.add("verso-admin__role-name");
        // Renaming commits on blur rather than per keystroke: every keystroke would be a write,
        // and the server would see "A", "Au", "Aut"... as three role names.
        nameField.input.addEventListener("blur", function () {
          if (nameField.input.value !== r.name) write(api("/api/roles/" + encodeURIComponent(r.id), { method: "PATCH", body: JSON.stringify({ name: nameField.input.value }) }));
        });
        top.appendChild(nameField);
        top.appendChild(h("span", "verso-admin__holders", r.holders + (r.holders === 1 ? " person" : " people")));
        if (r.isDefault) top.appendChild(UI().Badge({ tone: "neutral", quiet: true, children: "Default for new people" }));
        top.appendChild(UI().Button({
          variant: "ghost", size: "sm", label: "Delete",
          onClick: function () { write(api("/api/roles/" + encodeURIComponent(r.id), { method: "DELETE" })); }
        }));
        card.appendChild(top);

        var caps = h("div", "verso-admin__caps");
        state.caps.forEach(function (c) {
          var on = r.capabilities.indexOf(c) >= 0;
          var box = UI().Checkbox({
            checked: on, label: c,
            onChange: function (next) {
              var list = r.capabilities.filter(function (x) { return x !== c; });
              if (next) list.push(c);
              write(api("/api/roles/" + encodeURIComponent(r.id), { method: "PATCH", body: JSON.stringify({ capabilities: list }) }));
            }
          });
          caps.appendChild(box);
        });
        card.appendChild(caps);

        // Warnings arrive WITH the role. They are advisory, they render inline against the
        // offending role, and they never block the write.
        (r.warnings || []).forEach(function (w) {
          card.appendChild(h("div", "verso-admin__warn", w.message));
        });
        sec.appendChild(card);
      });
      body.appendChild(sec);
    }

    kernel.expose({ adminUsers: { open: open, close: close, _state: function () { return state; }, _load: load } });

    // The entry point. Offered only to someone who can actually use it, and the capability is
    // asked for rather than assumed from the page.
    if (typeof document !== "undefined" && window.__versoServerUrl && typeof fetch === "function") {
      fetch(base() + "/auth/me", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!shouldOffer(j && j.principal)) return;
          var host = document.querySelector(".left-rail__actions");
          if (!host) return;
          var btn = h("button", "rail-btn");
          btn.id = "rail-people-btn";
          btn.title = COPY.title;
          btn.setAttribute("data-lucide", "users");
          btn.addEventListener("click", open);
          host.insertBefore(btn, host.firstChild);
          if (window.hydrateIcons) window.hydrateIcons(host);
        })
        .catch(function () {});
    }
  }

  window.VersoAdminUsers = {
    COPY: COPY, PAGE_SIZE: PAGE_SIZE,
    filterPeople: filterPeople, paginate: paginate, isEmptyState: isEmptyState,
    refusalFor: refusalFor, shouldOffer: shouldOffer, install: install
  };
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
