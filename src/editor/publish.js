// editor/publish.js -- what gets built, where it lands, and what the run records (arch-P3-03).
//
// The publish MODELS were extracted long ago and are well tested: publish-queue.js (rows and their
// statuses), publish-presets.js (named option bundles), publish-paths.js (folder labels and the
// version ledger), release-history.js (the append-only log). 353 lines, all pure, all green.
//
// The orchestration was not. Deciding which packages a row expands into, resolving each one's
// options and destination, sequencing the run, recording a version only after a package actually
// lands, and writing one release record for everything that went out together -- all of that lived
// in editor.js among the chrome that draws it. Both bugs this area has logged were in exactly that
// layer, and neither could be reached by a test:
//
//   · every run wrote V001. defaultOptions() carries a frozen version, and nothing asked the
//     ledger for the next one, so each publish silently overwrote the last.
//   · the "N outputs" chip promised packages the run never built. The chip counted variants from
//     one fact and the run expanded them from another.
//
// Both are decisions, not drawing. So the decisions live here, behind an interface, and editor.js
// keeps the drawing. Nothing in this file touches the DOM: destinations are resolved, not picked;
// packages are built and delivered through injected callbacks; the run is a promise chain the
// suite can drive to completion with no browser and no exporter.
//
// ONE FACT, ONE EXPANSION. outputsForRow() reads the same outputs fact the row's chip states, so
// the count promised and the packages that land come from one source by construction rather than
// by two call sites agreeing. optionsForRow() asks the ledger for the version and the exporter for
// the increment rule, so no copy of either lives here.
//
// THE RUN'S ORDER MATTERS, and it is the part worth pinning: a row is several outputs, built and
// delivered in sequence; the release entry is captured BEFORE the ground-truth baseline moves, so
// it records the source versions the package was actually built against; and the version is
// recorded only AFTER the package lands, so a failed write never burns a number.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  var KEYS = {
    queue: "authoring.publishQueue",
    paths: "authoring.publishPaths",
    presets: "authoring.publishPresets",
    history: "authoring.releaseHistory"
  };

  // The longest shared head of two strings. Used to state what a set of destinations have in
  // common without claiming more than is true of all of them.
  function commonPrefix(a, b) {
    var i = 0, n = Math.min(a.length, b.length);
    while (i < n && a.charAt(i) === b.charAt(i)) i++;
    return a.slice(0, i);
  }

  // A row is several outputs, so a collapsed destination chip has to speak for all of them. Three
  // cases, in order of how much it can honestly say:
  //   · every output lands on the same path -> state that path;
  //   · they share the folder the author PICKED but nest differently under it (an inherited root
  //     gives each variant its own subfolder) -> state the shared part and end it in an ellipsis,
  //     which is true of all of them rather than true of one and implied of the rest;
  //   · they came from different picked folders -> "Mixed", and the popover has the detail.
  // The shared part is cut at a folder boundary, so the chip never states half a folder name.
  function destSummary(dests) {
    var list = (dests || []).filter(Boolean);
    if (!list.length) return null;
    var first = list[0];
    if (list.every(function (dd) { return dd.chip === first.chip; })) {
      return { label: first.kind === "download" ? first.label : first.chip, kind: first.kind, mixed: false, why: first.hint };
    }
    if (list.every(function (dd) { return dd.handleKey === first.handleKey; })) {
      var shared = list.reduce(function (acc, dd) { return commonPrefix(acc, dd.chip); }, first.chip);
      var cut = shared.lastIndexOf("/");
      return { label: (cut > -1 ? shared.slice(0, cut + 1) : shared) + "…", kind: first.kind, mixed: false,
               why: first.hint + " Each output gets its own subfolder." };
    }
    return { label: "Mixed", kind: "mixed", mixed: true,
             why: "These outputs publish to different folders. Open to see each one." };
  }

  // What the row promises to write. The name is asked of the exporter's OWN naming function
  // instead of being rebuilt here, so the promise on the row and the file that lands cannot drift.
  // No namer, or one that throws, yields "" -- the row states nothing rather than guessing.
  function rowFilename(nameFn, opts) {
    if (typeof nameFn !== "function" || !opts) return "";
    try { return String(nameFn(opts) || ""); } catch (e) { return ""; }
  }
  // The filename is a promise about a run that has not happened, so it is shown only while the run
  // is still ahead. Once a row is done or failed its status carries the real outcome.
  function showsFilename(row) {
    var s = row && row.status;
    return s === "pending" || s === "running";
  }
  // The outputs fact turned into a chip model. It INVENTS no expansion of its own: count, names and
  // phrasing come from the fact verbatim. A document without variants rolls up to null, so a
  // flagship-only row carries no chip rather than one saying "1 output" about nothing.
  function variantRollup(outputsFact) {
    if (!outputsFact || !(outputsFact.count > 1)) return null;
    return {
      count: outputsFact.count,
      label: outputsFact.label,   // the fact's phrasing, verbatim -- never re-worded here
      title: outputsFact.title,
      rows: (outputsFact.names || []).map(function (name, i) { return { name: name, flagship: i === 0 }; })
    };
  }
  // A row's outcome after all of its outputs have run. One output states its own result; several
  // state the count and where they went, because "Done · <one filename>" would under-report a row
  // that shipped three packages.
  function rowResult(results) {
    var rs = (results || []).filter(Boolean);
    if (!rs.length) return { to: "error", path: "nothing to publish" };
    if (rs.length === 1) return rs[0];
    var toFolder = rs.filter(function (r) { return r.to === "folder"; }).length;
    return { to: toFolder === rs.length ? "folder" : (toFolder ? "mixed" : "download"),
             path: rs.length + " packages" + (toFolder ? " · " + rs[rs.length - 1].path.replace(/[^/]+$/, "") : "") };
  }

  // env = {
  //   store          the storage seam (readKey/writeKey) -- the same durable k/v the registry uses
  //   models         { queue, presets, paths, history } (defaults to the window globals)
  //   exporter()     the SCORM exporter (defaults to window.SCORMExport)
  //   docById(id)    a document from the registry
  //   productById(id) a Product container (for its display name)
  //   activeDocId()   the open document's id
  //   outputsFact(variants)   the SAME fact the outputs chip states
  //   masterVersions(doc)     source-version stamps this package is built against
  //   now()          epoch ms
  //   -- run only --
  //   deliver(row, variant, pkg) -> Promise<result>   write it to disk, or download
  //   activateDoc(id) -> Promise                      make that doc current so the exporter reads it
  //   onQueueChange()                                 repaint the queue
  //   afterRowPublished(doc)                          move this document's published baseline
  // }
  function createPublish(env) {
    env = env || {};
    var models = env.models || {};
    function PQ() { return models.queue || window.PublishQueue; }
    function PP() { return models.presets || window.PublishPresets; }
    function PA() { return models.paths || window.PublishPaths; }
    function RH() { return models.history || window.ReleaseHistory; }
    var exporter = env.exporter || function () { return window.SCORMExport; };
    var docById = env.docById || function () { return null; };
    var productById = env.productById || function () { return null; };
    // uio-W01: env.activeProduct is gone -- Publish was never universal because it filtered by
    // the global scope. A row now takes its Product from the document it publishes, and
    // nothing else. uio-W16 gives Publish its own facets.
    var activeDocId = env.activeDocId || function () { return null; };
    var outputsFact = env.outputsFact || function () { return { count: 1, variants: [] }; };
    var masterVersions = env.masterVersions || function () { return {}; };
    var now = env.now || function () { return Date.now(); };
    var store = env.store || null;

    // ---- the four stores: lazily loaded, persisted through the durable k/v seam ----
    var cache = { queue: null, paths: null, presets: null, history: null };
    function read(key) {
      if (!store) return null;
      try { return store.readKey(key); } catch (e) { return null; }
    }
    function write(key, value) {
      if (!store) return { ok: false };
      try { return store.writeKey(key, value); } catch (e) { return { ok: false, error: e }; }
    }
    function load(name, model) {
      var M = model(); if (!M) return null;
      try { var raw = read(KEYS[name]); if (raw) return M.fromJSON(JSON.parse(raw)); } catch (e) {}
      return M.create();
    }
    function get(name, model) {
      if (!cache[name]) cache[name] = load(name, model);
      return cache[name];
    }
    function save(name, model) {
      var M = model(); if (!M || !cache[name]) return { ok: false };
      try { return write(KEYS[name], JSON.stringify(M.toJSON(cache[name]))); } catch (e) { return { ok: false, error: e }; }
    }
    function queue() { return get("queue", PQ); }
    function paths() { return get("paths", PA); }
    function presets() { return get("presets", PP); }
    function history() { return get("history", RH); }

    // ---- the plan: what this row builds, and where each package goes ----
    // The Product is the DOCUMENT's own, falling back to the active one, so a row publishes into
    // the tree it belongs to rather than the one that happens to be on screen.
    function pathCtx(row, variant) {
      var d = docById(row && row.docId) || {}, meta = d.meta || {};
      var pid = meta.productId || "";
      var prod = pid && productById(pid);
      return { productId: pid, productName: (prod && prod.name) || "", docId: row && row.docId,
               docCode: meta.code || (row && row.docId), variant: variant || null };
    }
    function resolveDest(row, variant) {
      var M = PA(); if (!M) return null;
      return M.resolve(paths(), pathCtx(row, variant));
    }
    // Every package this row produces, flagship first, from the SAME fact the row's chip states --
    // so a chip promising three packages and a run building one cannot happen. A preset that pins
    // one variant narrows the row to that single output.
    function outputsForRow(row) {
      var P = PP(), X = exporter();
      var pinned = (X && P) ? P.optionsFor(presets(), (row && row.preset) || "master").variant : null;
      if (pinned) return [String(pinned)];
      var d = docById(row && row.docId);
      var fact = outputsFact(d && d.variants);
      return (fact && fact.variants && fact.variants.length) ? [null].concat(fact.variants) : [null];
    }
    // A row's preset id resolved to real export options: the exporter's defaults with the preset's
    // overrides on top. The variant is passed explicitly because a row is several outputs and each
    // is named and versioned in its own right -- one function answers "what builds this package"
    // for the preview on the row and for the run that writes it.
    function optionsForRow(row, variant) {
      var X = exporter(), P = PP(), A = PA();
      var base = (X && X.defaultOptions) ? X.defaultOptions() : {};
      if (!P || !row) return base;
      var out = Object.assign(base, P.optionsFor(presets(), row.preset || "master"));
      if (variant !== undefined) out.variant = variant || null;
      // Name the package for THIS row's document, not for whichever one is open. The run hands
      // these same options to buildPackage, so the filename shown is the filename that lands.
      var d = docById(row.docId), code = d && d.meta && d.meta.code;
      if (code) out.code = code;
      // THE V001 BUG. defaultOptions() carries a frozen version; the ledger carries the real one.
      // Per doc+variant, so a variant steps independently of its flagship, and "replace current
      // version" reuses the last one -- the only way to overwrite, and it is opt-in.
      if (A) out.version = A.nextVersion(paths(), A.pathKey(row.docId, out.variant),
        { replace: !!row.replaceVersion, suggest: X && X.suggestVersion });
      return out;
    }
    // Which Product the head's folder chip is setting: the Product the queued rows agree on, and
    // failing that the open document's. A queue spanning several Products has no single root to
    // state, so it resolves to null and the chip says so rather than naming one Product's folder and
    // quietly writing it to another's. uio-W01 removed the fourth answer this used to try first --
    // the global scope, which could name a Product no row in the queue belonged to.
    function rootScope() {
      var seen = {};
      if (PQ()) (queue().rows || []).forEach(function (r) {
        var d = docById(r.docId), p = d && d.meta && d.meta.productId;
        if (p) seen[p] = 1;
      });
      var keys = Object.keys(seen);
      if (keys.length === 1) return keys[0];
      if (keys.length > 1) return null;
      var od = docById(activeDocId());
      return (od && od.meta && od.meta.productId) || "";
    }
    // One release entry per OUTPUT (not per row): a document with variants ships several packages,
    // each with its own variant, version and destination, and a record that collapsed them into one
    // row would misreport what actually went out. A failed output is recorded too -- a history row
    // that omitted its failures would report a clean "Published" for a run that partly did not.
    function releaseEntryForRow(row, result, variant) {
      var d = docById(row.docId) || {}, meta = d.meta || {};
      var opts = optionsForRow(row, variant);
      var P = PP();
      var failed = !result || result.to === "error";
      return {
        docId: row.docId,
        code: meta.code || "",
        stage: meta.stage || "",
        title: row.title || meta.title || row.docId,
        exportFormat: opts.format || "",
        variant: opts.variant || "",
        version: opts.version || "",
        preset: P ? P.presetName(presets(), row.preset || "master") : "",
        destination: failed ? "" : (result.to === "download" ? "Downloads" : (result.path || result.to || "")),
        status: failed ? "error" : "done",
        groundTruthVersions: masterVersions(d)
      };
    }

    // ---- adding to the queue ----
    // Zero-config recall: a document returns with the preset it was last published under.
    function addDoc(docId) {
      var Q = PQ(), P = PP(), d = docById(docId);
      if (!Q || !d) return null;
      var preset = P ? P.lastForDoc(presets(), docId) : "master";
      Q.addDoc(queue(), docId, { title: (d.meta && d.meta.title) || docId, preset: preset });
      save("queue", PQ);
      return { pending: Q.pendingRows(queue()).length };
    }

    // ---- the run ----
    var running = false;
    function isRunning() { return running; }
    // Every PENDING row, in order. Each row: make its document current (the exporter reads the live
    // one), expand it into outputs, and for each output build -> deliver -> record. Statuses are
    // written as they change so the queue can repaint; the whole run appends ONE release record.
    // Returns a promise that settles when the queue is drained -- which is what makes it testable.
    function run() {
      var Q = PQ(), X = exporter();
      if (!Q || !X || running) return Promise.resolve(null);
      var q = queue();
      var pend = Q.pendingRows(q);
      if (!pend.length) return Promise.resolve(null);
      running = true;
      var originalId = activeDocId();
      var runEntries = [];   // one entry per output published this run, successes and failures
      var repaint = env.onQueueChange || function () {};
      var deliver = env.deliver || function () { return Promise.resolve({ to: "download" }); };
      var activate = env.activateDoc || function () { return Promise.resolve(); };
      repaint();

      function rowStep(row) {
        if (!docById(row.docId)) {
          var gone = { to: "error", path: "document not found" };
          runEntries.push(releaseEntryForRow(row, gone));
          Q.setStatus(q, row.id, "error", gone);
          save("queue", PQ); repaint();
          return Promise.resolve();
        }
        Q.setStatus(q, row.id, "running"); repaint();
        return Promise.resolve(activate(row.docId)).then(function () {
          var A = PA();
          var outs = outputsForRow(row), results = [];
          return outs.reduce(function (chain, variant) {
            return chain.then(function () {
              var opts = optionsForRow(row, variant);
              return Promise.resolve(X.buildPackage(opts))
                .then(function (pkg) { return deliver(row, variant, pkg); })
                .then(function (res) {
                  results.push(res);
                  // Captured BEFORE the baseline moves, so groundTruthVersions reflects the source
                  // versions this package was actually built against.
                  runEntries.push(releaseEntryForRow(row, res, variant));
                  // Recorded only AFTER the package lands: a failed write never burns a version.
                  if (A && opts.version) { A.recordVersion(paths(), A.pathKey(row.docId, opts.variant), opts.version); save("paths", PA); }
                });
            });
          }, Promise.resolve()).then(function () {
            Q.setStatus(q, row.id, "done", rowResult(results));
            if (env.afterRowPublished) env.afterRowPublished(docById(row.docId));
          });
        }).catch(function (e) {
          var err = { to: "error", path: String((e && e.message) || e) };
          runEntries.push(releaseEntryForRow(row, err));
          Q.setStatus(q, row.id, "error", err);
        }).then(function () { save("queue", PQ); repaint(); });
      }

      return pend.reduce(function (chain, row) {
        return chain.then(function () { return rowStep(row); });
      }, Promise.resolve()).then(function () {
        running = false;
        if (activeDocId() !== originalId && docById(originalId)) return activate(originalId);
      }).then(function () {
        // ONE immutable record for everything that published together.
        if (runEntries.length && RH()) {
          RH().append(history(), { productId: "", createdAt: now(), entries: runEntries });
          save("history", RH);
        }
        save("queue", PQ); repaint();
        return { entries: runEntries.length, rows: pend.length };
      }, function (e) { running = false; throw e; });
    }

    return {
      KEYS: KEYS,
      queue: queue, paths: paths, presets: presets, history: history,
      saveQueue: function () { return save("queue", PQ); },
      savePaths: function () { return save("paths", PA); },
      savePresets: function () { return save("presets", PP); },
      saveHistory: function () { return save("history", RH); },
      pathCtx: pathCtx,
      resolveDest: resolveDest,
      outputsForRow: outputsForRow,
      optionsForRow: optionsForRow,
      releaseEntryForRow: releaseEntryForRow,
      rootScope: rootScope,
      addDoc: addDoc,
      isRunning: isRunning,
      run: run
    };
  }

  var VersoPublish = {
    KEYS: KEYS,
    commonPrefix: commonPrefix,
    destSummary: destSummary,
    rowFilename: rowFilename,
    showsFilename: showsFilename,
    variantRollup: variantRollup,
    rowResult: rowResult,
    create: createPublish
  };

  window.VersoPublish = VersoPublish;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoPublish;
})();
