// workspace-transfer.js -- moving a whole working environment, as one file.
//
// WHAT THERE WAS. `Export .verso` carries ONE design document. The folder backup carries the ONE
// course that is open, and has no restore. Neither touches LibraryStore -- so SOURCE DOCUMENTS AND
// PRODUCTS HAD NO EXPORT AT ALL. "Move my environment" meant exporting each design document one at
// a time and abandoning everything else, which is why nothing has ever moved between the Mac app,
// staging and the browser.
//
// WHY IT CANNOT ALL BE ONE FILE. The obvious design -- one self-contained package with the media
// baked in, the way .verso does it -- was measured against a real workspace before being chosen,
// as the ticket asked. The numbers rule it out: 2.86 MB of structure and 1.2 GB of media across
// 179 asset refs. `.verso` builds its ZIP as a single in-memory byte array, so that package is not
// constructible in a browser tab, and the browser it would be imported into holds ~4.9 MB of
// localStorage in total.
//
// So this file carries the STRUCTURE -- registry, library (source documents live there), products,
// classification -- and NAMES the media it does not carry. Per-document `.verso` already moves a
// course with its assets and is sized per course. The import reports exactly which asset refs the
// destination is missing, so a document that will render with holes says so on the way in rather
// than looking fine and being wrong.
//
// BE CONSCIOUS OF DATA LOSS (James's constraint, and the reason this file is shaped as it is):
// nothing here writes. It builds a file, and it PLANS an import -- what arrives, what collides,
// and for a replace, exactly what would be dropped -- so the caller can state all of that before
// the author agrees to any of it. Applying is a separate call, on a plan the author has seen.
//
// PURE: no DOM, no storage, no clock, no randomness. The caller supplies `now` and the stores.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  var FORMAT = "verso-workspace";
  var FORMAT_VERSION = 1;
  // Every store a workspace is made of, in the order a reader should think about them: documents,
  // then the library they draw on, then the products both hang off, then the rules over the lot.
  var STORES = ["registry", "library", "products", "classification"];

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  // ---- what the file says about media it is not carrying --------------------
  // Every asset:<id> reference reachable from the stores. Found by walking the SERIALISED text
  // rather than the object graph on purpose: a ref can sit on any block field, any nested child,
  // a header logo or a theme, and a walker that knows the shape would miss the one place nobody
  // thought of. The id grammar is AssetStore's own (a content hash), so a false positive would
  // have to be a string that already looks exactly like an asset id.
  function assetRefsIn(stores) {
    var found = {};
    STORES.forEach(function (k) {
      var v = stores && stores[k];
      if (v === undefined || v === null) return;
      var text = typeof v === "string" ? v : JSON.stringify(v);
      var m = text.match(/asset:[A-Za-z0-9_-]+/g) || [];
      m.forEach(function (ref) { found[ref.slice(6)] = true; });
    });
    return Object.keys(found).sort();
  }

  // ---- building the file ----------------------------------------------------
  // `now` is passed in, not read from a clock, so the same workspace produces the same file and
  // the suite can assert on it.
  function buildWorkspaceFile(stores, opts) {
    stores = stores || {}; opts = opts || {};
    var out = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt: opts.now || 0,
      generator: opts.generator || "Verso",
      // Where it came from, because the first question on opening someone else's workspace file is
      // "whose is this and when". Free text; never used to decide anything.
      origin: opts.origin || "",
      stores: {}
    };
    STORES.forEach(function (k) { if (stores[k] !== undefined) out.stores[k] = clone(stores[k]); });
    var refs = assetRefsIn(stores);
    // Stated in the file itself, so a workspace file is self-describing about its own hole rather
    // than relying on whoever sends it to mention it.
    out.media = {
      carried: false,
      assetRefs: refs,
      note: refs.length
        ? "Media is not carried in a workspace file. Export each design document as .verso to move its images."
        : "No media is referenced by this workspace."
    };
    return out;
  }

  // ---- reading one back -----------------------------------------------------
  // A file arrives from a disk and may be anything. This REFUSES what it cannot vouch for rather
  // than repairing it: a half-understood workspace applied over a real one is the failure this
  // whole file exists to avoid.
  function readWorkspaceFile(parsed) {
    var errors = [];
    if (!parsed || typeof parsed !== "object") return { ok: false, errors: ["That file isn't a Verso workspace."] };
    if (parsed.format !== FORMAT) errors.push("That file isn't a Verso workspace (no workspace marker).");
    else if (typeof parsed.formatVersion !== "number" || parsed.formatVersion > FORMAT_VERSION) {
      errors.push("That workspace was written by a newer version of Verso than this one.");
    }
    var stores = (parsed && parsed.stores) || null;
    if (!errors.length && (!stores || typeof stores !== "object")) errors.push("That workspace file has no stores in it.");
    if (!errors.length && !stores.registry && !stores.library && !stores.products) {
      errors.push("That workspace file is empty — no documents, library or products.");
    }
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], workspace: parsed };
  }

  // ---- planning an import ---------------------------------------------------
  // Decided BEFORE anything is written, and handed back whole, so the author is asked to agree to
  // a described act rather than an unlabelled one.
  //
  // `mode` is "replace" (the default, and the honest simple case: the destination becomes the
  // file) or "merge" (bring work in alongside). Merge does NOT decide collisions here -- it reports
  // them, because a code in both files is a per-document question and a single global switch is how
  // one team's import quietly destroys another's work.
  //
  // `findRegistryId` is passed in rather than re-derived: a document's identity is the registry key
  // matched key-first, then meta.code, then either case-insensitively (GH #266). Re-implementing
  // that rule here is exactly how the two would drift apart.
  function planImport(incoming, current, mode, findRegistryId) {
    mode = mode === "merge" ? "merge" : "replace";
    // Read the media block BEFORE narrowing to the stores -- it is a sibling of `stores`, not a
    // member of it, and reading it afterwards silently reported "no media" for every import.
    var media = (incoming && incoming.media) || null;
    incoming = (incoming && incoming.stores) || {};
    current = current || {};
    var find = typeof findRegistryId === "function" ? findRegistryId : function (reg, code) {
      return reg && Object.prototype.hasOwnProperty.call(reg, code) ? code : null;
    };
    var curReg = current.registry || {}, inReg = incoming.registry || {};
    var curLib = (current.library && current.library.components) || {};
    var inLib = (incoming.library && incoming.library.components) || {};
    var curProd = current.products || {}, inProd = incoming.products || {};

    var plan = {
      mode: mode,
      documents: { arriving: [], collisions: [], dropped: [] },
      library: { arriving: [], collisions: [], dropped: [] },
      products: { arriving: [], collisions: [], dropped: [] },
      // Named separately from the counts because it is the one number that means "this will look
      // broken afterwards", and it must not be buried in a total.
      media: { refs: (media && media.assetRefs) || [], carried: !!(media && media.carried) },
      total: 0
    };
    Object.keys(inReg).forEach(function (code) {
      var hit = find(curReg, code);
      if (hit) plan.documents.collisions.push({ id: code, existingId: hit });
      else plan.documents.arriving.push(code);
    });
    Object.keys(inLib).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(curLib, id)) plan.library.collisions.push({ id: id, existingId: id });
      else plan.library.arriving.push(id);
    });
    Object.keys(inProd).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(curProd, id)) plan.products.collisions.push({ id: id, existingId: id });
      else plan.products.arriving.push(id);
    });
    // REPLACE names what it is about to destroy. Anything the destination holds that the file does
    // not is dropped, and it is listed by id -- "12 documents will be removed" is a number, and a
    // number is not enough to agree to losing work by.
    if (mode === "replace") {
      Object.keys(curReg).forEach(function (code) { if (!inReg[code]) plan.documents.dropped.push(code); });
      Object.keys(curLib).forEach(function (id) { if (!inLib[id]) plan.library.dropped.push(id); });
      Object.keys(curProd).forEach(function (id) { if (!inProd[id]) plan.products.dropped.push(id); });
    }
    plan.total = plan.documents.arriving.length + plan.documents.collisions.length +
      plan.library.arriving.length + plan.library.collisions.length +
      plan.products.arriving.length + plan.products.collisions.length;
    return plan;
  }
  // Everything the destination would lose, as one number. Replace only -- a merge drops nothing,
  // which is precisely the difference between them.
  function droppedCount(plan) {
    if (!plan || plan.mode !== "replace") return 0;
    return plan.documents.dropped.length + plan.library.dropped.length + plan.products.dropped.length;
  }

  // ---- applying a plan ------------------------------------------------------
  // Returns NEW store objects; it never mutates what it is given, so a caller holding the current
  // workspace still holds it if anything downstream fails.
  //
  // `decisions` answers the collisions, per id: "keep" (leave what is here), "replace" (take the
  // incoming), or "both" (bring it in under a new id). Unanswered collisions default to KEEP,
  // because the default on an unanswered question about someone's work is to leave it alone.
  // `renameFor(id)` supplies the new id for "both" -- caller-supplied so this stays pure.
  function applyImport(incoming, current, plan, decisions, renameFor) {
    incoming = (incoming && incoming.stores) || {};
    current = current || {};
    decisions = decisions || {};
    var rename = typeof renameFor === "function" ? renameFor : function (id) { return id + "-imported"; };
    var replace = plan && plan.mode === "replace";

    var reg = replace ? {} : clone(current.registry || {});
    var lib = replace ? { components: {} } : clone(current.library || { components: {} });
    if (!lib.components) lib.components = {};
    var prod = replace ? {} : clone(current.products || {});

    function put(target, from, collisions) {
      var collided = {};
      (collisions || []).forEach(function (c) { collided[c.id] = c.existingId; });
      Object.keys(from || {}).forEach(function (id) {
        if (!replace && collided[id]) {
          var d = decisions[id] || "keep";
          if (d === "keep") return;
          if (d === "both") { target[rename(id)] = clone(from[id]); return; }
          target[collided[id]] = clone(from[id]);   // "replace": onto the id ALREADY here
          return;
        }
        target[id] = clone(from[id]);
      });
    }
    put(reg, incoming.registry, plan && plan.documents.collisions);
    put(lib.components, (incoming.library && incoming.library.components), plan && plan.library.collisions);
    put(prod, incoming.products, plan && plan.products.collisions);

    var out = { registry: reg, library: lib, products: prod };
    // Classification is a single settings object rather than a bag of records, so it has no
    // collisions to answer: replace takes the file's, merge keeps what is already configured.
    // Silently adopting another deployment's classification levels on a merge would reclassify
    // every document in the destination against rules nobody chose.
    if (replace && incoming.classification !== undefined) out.classification = clone(incoming.classification);
    else if (current.classification !== undefined) out.classification = clone(current.classification);
    else if (incoming.classification !== undefined) out.classification = clone(incoming.classification);
    return out;
  }

  // Which of the file's asset refs the destination cannot resolve -> the documents that will render
  // with holes. `has(id)` is AssetStore's own membership test, passed in.
  function missingMedia(plan, has) {
    var refs = (plan && plan.media && plan.media.refs) || [];
    if (typeof has !== "function") return refs.slice();
    return refs.filter(function (id) { return !has(id); });
  }

  var api = {
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION, STORES: STORES,
    assetRefsIn: assetRefsIn,
    buildWorkspaceFile: buildWorkspaceFile,
    readWorkspaceFile: readWorkspaceFile,
    planImport: planImport,
    droppedCount: droppedCount,
    applyImport: applyImport,
    missingMedia: missingMedia
  };
  window.VersoWorkspaceTransfer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
