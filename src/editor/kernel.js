// editor/kernel.js -- the one way a moved region and editor.js reach each other (arch-P3b-01).
//
// THE PROBLEM THIS SOLVES. editor.js is a single IIFE holding 1,268 functions that call each other
// freely, plus the mutable state they all read. P3 moved nine regions' DECISIONS out and left the
// DOM behind, and the reason it stopped there is this: a panel renderer cannot leave the closure
// until there is an agreed way for it to reach `doc`, `h`, `panelSection` and the rest, and for
// editor.js's forty remaining call sites to reach back into it. Without that, every move is a
// bespoke wiring job and each one invents its own convention.
//
// So: one namespace. editor.js PROVIDES what a moved region may reach back for. A region NEEDS a
// subset of that and EXPOSES its entry points. editor.js BINDS those entry points to a local name,
// so the call sites it keeps do not change at all.
//
// FOUR RULES, EACH ONE A BUG THAT HAS ALREADY SHIPPED HERE.
//
//   1. Everything resolves at ACCESS time, never at wiring time. `doc` is reassigned wholesale on
//      a document swap -- setDoc, undo, a collab frame -- and a region that captured the value at
//      load would keep editing the document the author closed. That is not hypothetical: it is the
//      tour-builder data loss, and it is the close-active-tab undo bug P3-02 fixed. need() hands
//      back getters for exactly this reason. Nothing here ever caches a provided value.
//
//   2. A name that was never provided FAILS, and says which name. The alternative is a region
//      quietly reading undefined and rendering an empty panel, which is the hardest class of bug
//      to bisect because nothing throws. need() records every name asked for whether or not it
//      exists, so audit() can list the gaps without anyone exercising the UI.
//
//   3. Two regions cannot expose the same entry point. One name, one owner; a collision means a
//      region was moved twice or split badly, and it should stop the suite, not race at boot.
//
//   4. bind() returns a STABLE function that dispatches on call. That is what lets editor.js keep
//      `renderInspector()` at all forty of its call sites while the body of it lives in another
//      file -- the diff for a region move is the region, not the whole file.
//
// HOW A REGION REACHES THIS. Through `window.VersoEditor`, set below. Under a bare `require` each
// module gets its own window stand-in, so a cross-module global reads undefined -- the footgun
// dnd.js documents. A region file is therefore tested through the VM tier (tests/_editor.js),
// which runs kernel.js and the region in ONE context where window is genuinely shared, exactly as
// the browser does. A region must never be reached by bare `require`.
//
// Pure: no DOM, no store, no document knowledge. It is a wiring table and nothing else.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // name -> { get: function () { ... } }. A plain provide wraps a constant; provideLive stores the
  // caller's getter as-is. Both are read the same way, so a consumer never knows or cares which
  // kind it got -- and a binding can be upgraded from constant to live without touching consumers.
  var provided = Object.create(null);
  // Which names were registered LIVE, so a later constant provide() cannot freeze one (rule 5).
  var live = Object.create(null);
  // name -> function. What the moved regions publish back.
  var exposed = Object.create(null);
  // Every name any region has ever asked for, and every name any call site has bound. Kept so the
  // audit can answer "what did somebody expect that nobody supplies?" from a boot alone.
  var needed = Object.create(null);
  var bound = Object.create(null);

  function fail(msg) { throw new Error("VersoEditor: " + msg); }

  // ---- the host side (editor.js) -------------------------------------------
  // provide("h", h) or provide({ h: h, doc: ... }). Re-providing a name is allowed: editor.js is
  // the single host and rewiring it is legitimate. Two REGIONS colliding is the error case, and
  // that is expose()'s job below.
  function provide(name, value) {
    if (name && typeof name === "object") {
      Object.keys(name).forEach(function (k) { provide(k, name[k]); });
      return VersoEditor;
    }
    // RULE 5, and it cost a batch to learn: a LIVE binding may never be downgraded to a constant.
    // `provide("selection", selection)` looks harmless beside forty other entries, and it replaces
    // the getter with a snapshot taken at boot -- so every region reading it sees an empty
    // selection forever, silently, while editor.js's own copy updates on every click. No test that
    // reads source text can see that, and no boot fails on it.
    if (live[name]) fail("`" + name + "` is provided LIVE -- providing it as a constant would freeze it at this value");
    provided[name] = { get: function () { return value; } };
    return VersoEditor;
  }
  // A binding whose VALUE is replaced, not mutated: `doc` on a document swap, `selection` on every
  // click. Pass the getter, not the value, or rule 1 is lost the first time it is reassigned.
  function provideLive(name, getter) {
    if (name && typeof name === "object") {
      Object.keys(name).forEach(function (k) { provideLive(k, name[k]); });
      return VersoEditor;
    }
    if (typeof getter !== "function") fail("provideLive(" + name + ") needs a getter function");
    provided[name] = { get: getter };
    live[name] = true;
    return VersoEditor;
  }
  function has(name) { return !!provided[name]; }
  function get(name) {
    var slot = provided[name];
    if (!slot) fail("nothing provides `" + name + "` -- editor.js must provide() it before a region reads it");
    return slot.get();
  }

  // ---- the region side -----------------------------------------------------
  // need("doc", "h", ...) or need(["doc", "h"]) -> an object of getters. Read it like plain state:
  //
  //   var E = window.VersoEditor.need("doc", "h", "panelSection");
  //   E.h("div", "row");          // resolved now, from whatever editor.js currently provides
  //   E.doc.pages                 // the LIVE document, not the one that was current at load
  //
  // Asking for a name is recorded immediately, so a typo shows up in audit().unmet after a boot
  // rather than the first time an author opens that panel.
  function need(names) {
    var list = Array.isArray(names) ? names : Array.prototype.slice.call(arguments);
    var ctx = {};
    list.forEach(function (name) {
      needed[name] = true;
      Object.defineProperty(ctx, name, {
        enumerable: true,
        get: function () { return get(name); }
      });
    });
    return ctx;
  }
  // A region publishes what editor.js still calls. One name, one owner (rule 3).
  function expose(name, fn) {
    if (name && typeof name === "object") {
      Object.keys(name).forEach(function (k) { expose(k, name[k]); });
      return VersoEditor;
    }
    if (exposed[name] && exposed[name] !== fn) fail("`" + name + "` is exposed twice -- one entry point, one owner");
    exposed[name] = fn;
    return VersoEditor;
  }

  // ---- the call sites editor.js keeps --------------------------------------
  // var renderInspector = VersoEditor.bind("renderInspector");
  //
  // The returned function is stable and can be handed out at load, before anything is exposed --
  // it looks the entry point up when it is CALLED. That is what keeps a region move to one diff
  // hunk instead of forty.
  function bind(name) {
    bound[name] = true;
    return function () {
      var fn = exposed[name];
      if (typeof fn !== "function") fail("`" + name + "` was called before any region exposed it");
      return fn.apply(this, arguments);
    };
  }

  // ---- the ratchet ---------------------------------------------------------
  // unmet: a region asked for something no one provides. unbound: a call site forwards to an entry
  // point no region publishes. Both are wiring bugs that a browser would only reveal by rendering
  // the wrong thing; the suite asserts both lists are empty after a full editor boot.
  function audit() {
    return {
      provided: Object.keys(provided).sort(),
      exposed: Object.keys(exposed).sort(),
      needed: Object.keys(needed).sort(),
      bound: Object.keys(bound).sort(),
      unmet: Object.keys(needed).filter(function (n) { return !provided[n]; }).sort(),
      unbound: Object.keys(bound).filter(function (n) { return !exposed[n]; }).sort()
    };
  }
  // Tests only. A vm context is fresh per load, so the app never needs this.
  function reset() {
    provided = Object.create(null);
    live = Object.create(null);
    exposed = Object.create(null);
    needed = Object.create(null);
    bound = Object.create(null);
    return VersoEditor;
  }

  var VersoEditor = {
    provide: provide,
    provideLive: provideLive,
    has: has,
    get: get,
    need: need,
    expose: expose,
    bind: bind,
    audit: audit,
    reset: reset
  };

  window.VersoEditor = VersoEditor;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoEditor;
})();
