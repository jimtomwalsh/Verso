// editor/cutover.js -- the guarded action that moves this machine's work to the server
// (platform-pivot 36). SERVER MODE ONLY, and only for a holder of `serverConfig`.
//
// WHY THIS IS A SEPARATE TICKET FROM THE ENGINE. platform-pivot-33 built and proved
// Migration.runToServer -- backup, deliver, stash, verify, write, verify, flip, refusing at any
// failed stage -- and deliberately wired NOTHING to it. That matches the precedent src/migration.js
// set for the browser->file core: "the live wiring (a guarded menu action) is a separate,
// supervised step". A one-way, data-moving action should not get its entry point in the same
// change that builds its engine.
//
// THE SHAPE OF THE FLOW, and why it is this shape:
//
//   1. DRY RUN FIRST, ALWAYS. runToServer supports dryRun and proves the entire path without
//      committing anything. The real cutover is not offered until a dry run has passed, so the
//      first time an admin learns their server rejects the write is never also the moment their
//      local store stopped being authoritative.
//   2. THE BACKUP IS A DOWNLOAD THEY MUST KEEP. A browser cannot confirm a file reached the
//      disk. The engine says so in its own log rather than implying otherwise, and this screen
//      says it too -- no green tick that claims more than was proved.
//   3. PER-STAGE PROGRESS, in the core's own stage names, so a failure names the stage in the
//      author's words rather than in a stack trace.
//   4. A REFUSAL MUST READ AS SAFE, NOT BROKEN. Every failed stage leaves the machine exactly as
//      it was. An admin who thinks a failed migration ate their work will do something rash, so
//      the failure copy leads with what did NOT happen.
//
// commitBackend stays the ONE writer of the backend flag; this calls it and never touches the
// key. A ratchet in tests/run.js fails any other writer.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // The core's stages, in order, with what each one means to a person. The engine returns these
  // names; this table is the only place they become English.
  var STAGES = [
    { id: "read", label: "Reading what's on this machine" },
    { id: "backup", label: "Building and checking a backup" },
    { id: "deliver", label: "Handing you the backup file" },
    { id: "stash", label: "Storing a copy on the server" },
    { id: "write", label: "Writing your work to the server" },
    { id: "verify", label: "Reading it back to prove it arrived" }
  ];
  var COPY = {
    title: "Move this machine's work to the server",
    lede: "Your courses, source documents and products are stored in this browser. This moves them to the shared server so your team can work on them together.",
    dryRun: "Run a rehearsal",
    dryRunNote: "Nothing is moved. It proves the whole path first, including the backup and the server write.",
    real: "Move everything to the server",
    realNote: "One way. After this, the server is where your work lives.",
    keepBackup: "Keep the backup file it downloads. A browser cannot confirm a download reached your disk, so check for it before going further.",
    dryOk: "Rehearsal passed. Nothing was moved.",
    doneTitle: "Your work is on the server",
    doneBody: "Verso will reload onto the server store.",
    // Leads with what did NOT happen, because that is the thing an admin needs first.
    failLead: "Nothing was changed. Your work is still on this machine, exactly as it was.",
    failAt: "It stopped at: "
  };

  // ---- pure ----------------------------------------------------------------
  // Turn the engine's result into per-stage marks. Stages before the failure ran; the failing
  // one is named; the rest never started. PURE, so the "which stages ran" reasoning is testable
  // without a server.
  function stageMarks(result) {
    var failedAt = (result && !result.ok) ? result.stage : null;
    var idx = failedAt ? STAGES.map(function (s) { return s.id; }).indexOf(failedAt) : -1;
    return STAGES.map(function (s, i) {
      if (!failedAt) return { id: s.id, label: s.label, state: "ok" };
      if (i < idx) return { id: s.id, label: s.label, state: "ok" };
      if (i === idx) return { id: s.id, label: s.label, state: "failed" };
      return { id: s.id, label: s.label, state: "skipped" };
    });
  }
  // Offered only where it can actually do something: a server to move TO, the browser store
  // still authoritative, and someone allowed to change server configuration.
  function shouldOffer(env) {
    env = env || {};
    return !!(env.serverUrl && env.backend === "browser" &&
      env.capabilities && env.capabilities.indexOf("serverConfig") >= 0);
  }
  function failMessage(result) {
    if (!result || result.ok) return null;
    var s = STAGES.filter(function (x) { return x.id === result.stage; })[0];
    return COPY.failLead + " " + COPY.failAt + (s ? s.label.toLowerCase() : result.stage) +
      (result.error ? " — " + result.error : "") + ".";
  }

  function install(kernel) {
    var E = kernel.need("h", "Store");
    var h = E.h;
    var dsModalShell = kernel.bind("dsModalShell");
    var UI = function () { return window.VersoUI; };
    var base = function () { return String(window.__versoServerUrl || "").replace(/\/+$/, ""); };

    function stamp() {
      var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    }
    // The three sinks runToServer needs. Each is the REAL one -- the download the author keeps,
    // the copy stored server-side, and the read-back that proves the copy landed.
    function sinks() {
      return {
        deliver: function (name, text) {
          try {
            var b = new Blob([text], { type: "application/json" });
            var url = URL.createObjectURL(b);
            var a = document.createElement("a");
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            return { ok: true };
          } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
        },
        stash: function (archive) { window.__cutoverStash = archive; return { ok: true }; },
        readStash: function () { return window.__cutoverStash; }
      };
    }
    function serverStore() {
      var a = window.__storageAdapter;
      if (!a) return null;
      return {
        readRegistry: a.readRegistry, writeRegistry: a.writeRegistry,
        readLibrary: a.readLibrary, writeLibrary: a.writeLibrary,
        readProducts: a.readProducts, writeProducts: a.writeProducts
      };
    }
    function browserStore() {
      var b = E.Store.browserAdapter;
      return { readRegistry: b.readRegistry, readLibrary: b.readLibrary, readProducts: b.readProducts };
    }

    function run(dry, onDone, log) {
      var srv = serverStore();
      if (!srv) return onDone({ ok: false, stage: "write", error: "this page is not connected to a Verso server" });
      var s = sinks();
      var res = window.Migration.runToServer(browserStore(), srv, {
        dryRun: !!dry, tsLabel: stamp(), log: log,
        deliver: s.deliver, stash: s.stash, readStash: s.readStash
      });
      onDone(res);
    }

    function open() {
      var dryPassed = false, running = false;
      var lines = [];
      // NO onPrimary here on purpose. dsModalShell wires the primary button's click itself, so
      // passing one AND adding a listener meant both fired -- and dsModalShell's ran first, so
      // pressing "Move everything to the server" quietly ran a second rehearsal instead. One
      // button whose meaning changes needs exactly one handler that knows which meaning it has.
      var shell = dsModalShell({
        title: COPY.title,
        primaryLabel: COPY.dryRun,
        cancelLabel: "Close",
        width: 520
      });
      var body = shell.body;
      var stagesEl, noteEl, logEl;
      // The primary is a canonical Button, so its text lives in a label span; writing
      // textContent on the button itself would delete the span and any icon with it.
      function setLabel(t) {
        var lab = shell.primary.querySelector(".vds-btn__label");
        if (lab) lab.textContent = t; else shell.primary.textContent = t;
      }

      function paint(marks, note, tone) {
        body.textContent = "";
        body.appendChild(h("p", "cutover__lede", COPY.lede));
        var keep = h("p", "cutover__keep", COPY.keepBackup);
        body.appendChild(keep);
        stagesEl = h("ol", "cutover__stages");
        (marks || STAGES.map(function (s) { return { id: s.id, label: s.label, state: "idle" }; })).forEach(function (m) {
          var li = h("li", "cutover__stage cutover__stage--" + m.state, m.label);
          stagesEl.appendChild(li);
        });
        body.appendChild(stagesEl);
        noteEl = h("p", "cutover__note" + (tone ? " cutover__note--" + tone : ""), note ||
          (dryPassed ? COPY.realNote : COPY.dryRunNote));
        body.appendChild(noteEl);
        if (lines.length) {
          logEl = h("pre", "cutover__log", lines.join("\n"));
          body.appendChild(logEl);
        }
      }

      function start(real) {
        if (running) return;
        // The real cutover is not reachable until a rehearsal has passed. Belt and braces: the
        // button only changes after a dry run, and this refuses anyway.
        if (real && !dryPassed) return;
        running = true;
        lines = [];
        shell.primary.disabled = true;
        paint(null, real ? "Moving your work…" : "Rehearsing…");
        // Deferred a frame so the "running" paint lands before the synchronous engine blocks.
        setTimeout(function () {
          run(!real, function (res) {
            running = false;
            shell.primary.disabled = false;
            if (!res.ok) {
              dryPassed = false;
              setLabel(COPY.dryRun);
              paint(stageMarks(res), failMessage(res), "fail");
              return;
            }
            if (!real) {
              dryPassed = true;
              // The label becomes the real action only once the rehearsal has proved the path.
              setLabel(COPY.real);
              paint(stageMarks(res), COPY.dryOk + " " + COPY.realNote, "ok");
              return;
            }
            // SUCCESS. commitBackend is the one writer of the flag, and saves stay suppressed
            // through the flip and the reload so no stale flush can land under the new backend.
            E.Store.commitBackend("http");
            paint(stageMarks(res), COPY.doneTitle + ". " + COPY.doneBody, "ok");
            setTimeout(function () { window.location.reload(); }, 1200);
          }, function (line) { lines.push(String(line)); });
        }, 0);
      }

      // The ONE handler. It branches on what the button currently means.
      shell.primary.addEventListener("click", function () { start(dryPassed); });
      paint(null, null);
      return shell;
    }

    kernel.expose({ cutover: { open: open, run: run } });

    if (typeof document !== "undefined" && window.__versoServerUrl && typeof fetch === "function") {
      fetch(base() + "/auth/me", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var p = (j && j.principal) || {};
          if (!shouldOffer({ serverUrl: window.__versoServerUrl, backend: E.Store.backend(), capabilities: p.capabilities })) return;
          var host = document.querySelector(".left-rail__actions");
          if (!host) return;
          var btn = h("button", "rail-btn");
          btn.id = "rail-cutover-btn";
          btn.title = COPY.title;
          btn.setAttribute("data-lucide", "server");
          btn.addEventListener("click", open);
          host.insertBefore(btn, host.firstChild);
          if (window.hydrateIcons) window.hydrateIcons(host);
        })
        .catch(function () {});
    }
  }

  window.VersoCutover = { COPY: COPY, STAGES: STAGES, stageMarks: stageMarks, shouldOffer: shouldOffer, failMessage: failMessage, install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
