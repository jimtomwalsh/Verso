// editor/product-rail.js -- the facts that follow a document across Source, Edit and Publish
// (arch-P3-05).
//
// Four questions get asked of a document at every stage of the rail: how much of it comes from
// approved source, what has drifted since it last went out, where a passage is used, and how many
// packages it actually produces. Before uio-F04 each stage answered them itself, so the same fact
// read differently in three places -- or worse, was computed twice and disagreed.
//
// uio-F04 fixed the phrasing by putting one resolver behind them. What it could not fix is where
// that resolver lived: 300 lines in the middle of editor.js, reachable only by the surfaces that
// happened to be in the same closure, and testable only by slicing three comment fences out of the
// file and re-animating them with `new Function`.
//
// THE RULE THIS LAYER KEEPS: it invents nothing. Its inputs are the primitives underneath it --
// the linked-master stamps, the word counts, the where-used placements, the release log, the
// document's variants. It turns those into one phrasing and one tone that every surface renders
// identically. A second staleness or alignment computation anywhere else is the bug this exists to
// prevent, and the suite fails it.
//
// TWO HALVES, deliberately split:
//   · the FACTS are pure -- plain values in, plain fact objects out, no store and no DOM. Bands,
//     alignment, drift, where-used, outputs, and the meter model are module-level functions you can
//     call with a literal.
//   · the BINDING is an instance. create(env) takes the registry, the library stamps, the source
//     index and the release log as callbacks, and answers the same questions about the live app.
// Drawing stays in editor.js: a fact carries a label, a tone and a title, and the badge and meter
// that render it are chrome.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- the pure facts ------------------------------------------------------
  // One band scale, everywhere. >=85 verified · 60-84 mixed · <60 mostly novel.
  var BANDS = [
    { key: "verified", min: 85, label: "Verified" },
    { key: "mixed", min: 60, label: "Mixed" },
    { key: "novel", min: 0, label: "Mostly novel" }
  ];
  // Tones read as fact, not as scolding: novel copy is a legitimate authoring choice, so the bottom
  // band is neutral rather than red. Red is reserved for something actually wrong.
  var BAND_TONE = { verified: "success", mixed: "warning", novel: "neutral" };
  function band(pct) {
    if (pct == null) return null;
    for (var i = 0; i < BANDS.length; i++) if (pct >= BANDS[i].min) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }
  // ALIGNMENT. `alignment` is whatever sourceAlignment() returned ({linkedWords,totalWords}); pass
  // `indexed:false` when there is no approved source to measure against at all. Both no-source and
  // no-prose resolve to the SAME honest "Not indexed" state rather than a 0% that blames the author.
  function alignmentFact(alignment, indexed) {
    var total = (alignment && alignment.totalWords) || 0;
    var linked = (alignment && alignment.linkedWords) || 0;
    if (indexed === false || !total) {
      return {
        indexed: false, pct: null, band: null, bandLabel: "Not indexed", tone: "neutral",
        label: "Not indexed",
        title: indexed === false
          ? "Not indexed - there is no approved source document to measure this against yet."
          : "Not indexed - there is no prose here to measure."
      };
    }
    var pct = Math.round(linked / total * 100), b = band(pct);
    return {
      indexed: true, pct: pct, band: b.key, bandLabel: b.label, tone: BAND_TONE[b.key],
      // The word counts travel ON the fact: rollUpAlignment pools them, so a set of facts can be
      // combined into one without going back to the documents they came from.
      linkedWords: linked, totalWords: total,
      label: pct + "% aligned",
      title: pct + "% of these " + total + " words are linked to approved source (" + b.label.toLowerCase() +
        "). The rest is novel copy authored here."
    };
  }
  // A set of alignments as one. Words are pooled rather than percentages averaged, so a one-line
  // document cannot swing a Product's number the way a 40-page one does.
  function rollUpAlignment(alignments) {
    var linked = 0, total = 0, indexed = false;
    (alignments || []).forEach(function (a) {
      if (!a) return;
      linked += a.linkedWords || 0; total += a.totalWords || 0;
      if (a.indexed !== false) indexed = true;
    });
    return alignmentFact({ linkedWords: linked, totalWords: total }, indexed && total > 0);
  }
  // DRIFT. `driftedIds` is driftedMasterIds()'s answer (null = links no source at all); `published`
  // is whether the release log has ever recorded this document going out. A never-published document
  // has nothing to have drifted FROM, so it reports "unpublished" instead of counting every linked
  // topic as changed -- the misreading the raw count invited.
  function driftFact(driftedIds, published) {
    if (driftedIds == null) {
      return { state: "unlinked", count: 0, ids: [], tone: "neutral", label: "",
        title: "This document links no approved source." };
    }
    if (!published) {
      return { state: "unpublished", count: 0, ids: [], tone: "neutral", label: "",
        title: "Never published, so there is no earlier version to have drifted from." };
    }
    if (!driftedIds.length) {
      return { state: "current", count: 0, ids: [], tone: "neutral", label: "",
        title: "Every linked source passage is as it was when this document was last published." };
    }
    var n = driftedIds.length;
    return { state: "drifted", count: n, ids: driftedIds.slice(), tone: "warning",
      label: n + " changed",
      title: n + " linked source document" + (n === 1 ? "" : "s") + " changed since this document was last published." };
  }
  // WHERE-USED. `places` is the list of placements ({docCode,...}); this counts the distinct
  // documents behind them, because "linked in 3 documents" is the fact an author acts on.
  function whereUsedFact(places) {
    var docs = {};
    (places || []).forEach(function (p) { if (p && p.docCode != null) docs[p.docCode] = 1; });
    var codes = Object.keys(docs), n = codes.length;
    return {
      docs: n, docCodes: codes, places: (places || []).length, tone: "neutral",
      label: n ? ("Linked in " + n) : "Not linked",
      title: n
        ? ("Used in " + n + " document" + (n === 1 ? "" : "s") + " across " + (places || []).length + " place" + ((places || []).length === 1 ? "" : "s") + ".")
        : "Not currently linked in any document."
    };
  }
  // VARIANTS AS OUTPUTS. One document with N variants is N+1 packages; the queue treats it as one
  // row, which is why the real output count is invisible. Flagship always leads the list.
  function outputsFact(variants) {
    var vs = (variants || []).filter(function (v) { return v != null && String(v) !== ""; });
    var names = ["Flagship"].concat(vs.map(String));
    return {
      count: names.length, names: names, variants: vs.map(String), tone: "neutral",
      label: names.length + " outputs",
      title: names.length === 1
        ? "Publishing this document produces one package (Flagship)."
        : "Publishing this document produces " + names.length + " packages: " + names.join(", ") + "."
    };
  }
  // The meter EXPLAINS the alignment number, so every part of it -- fill, tone, value text, band
  // name -- comes from the fact object, never a second computation. A not-indexed fact yields a
  // meter with no fill and the words instead of a 0%.
  function alignmentMeterModel(fact) {
    if (!fact || fact.indexed === false || fact.pct == null) {
      return { indexed: false, pct: null, tone: "neutral", value: "Not indexed",
        bandLabel: "Not indexed", title: (fact && fact.title) || "Not indexed." };
    }
    var b = band(fact.pct);
    return { indexed: true, pct: fact.pct, tone: BAND_TONE[b.key], value: fact.pct + "%",
      bandLabel: b.label, title: fact.title };
  }
  // Which open tabs the strip shows: all of them. uio-W01 retired the Product scope that used to
  // filter this, because a filter was doing a mode's job -- switching Product silently emptied the
  // tab bar, and work was hidden rather than organised. What a strip holds now depends only on what
  // is open. The one thing still filtered is an id with no document behind it, which draws nothing.
  //
  // The function survives the scope's deletion on purpose: uio-W10 splits the strips by document
  // TYPE, one per destination, and this is where that predicate goes.
  function visibleTabIds(openIds, reg) {
    return (openIds || []).filter(function (id) { return !!(reg && reg[id]); });
  }

  // uio-W10: THE SPLIT. Source and Edit own SEPARATE strips holding only their own document type,
  // and the two never mix. Not a filter over one strip -- two strips over two stores, because a
  // design document is a registry entry and a source document is a LibraryStore component, and a
  // single strip holding both would have to pretend they are the same kind of thing.
  //
  // The Source predicate is the mirror of the one above: an id with nothing behind it draws
  // nothing. A source document is product-optional (uio-W14), so nothing here asks about a product.
  function visibleSourceTabIds(openIds, components) {
    var comps = components || {};
    return (openIds || []).filter(function (id) {
      var c = comps[id];
      return !!(c && c.kind === "topic" && c.sourceMaster && !c.archivedInto);
    });
  }

  // What the strip says about itself: `2 open` on Source, `3 open · 2 products` on Edit. THE
  // MIXED-PRODUCT FACT IS STATED RATHER THAN IMPLIED -- documents from different products coexist
  // in one strip now, with nothing filtering them, and a strip that spans two products while
  // saying only "3 open" would leave you to work that out from the colour dots.
  //
  // The product count appears only when it is more than one, because "1 product" on a strip that
  // has never held two is noise on every screen.
  function stripMeta(items) {
    var list = items || [];
    var seen = {}, products = 0;
    list.forEach(function (i) {
      var pid = i && i.productId;
      if (pid && !seen[pid]) { seen[pid] = 1; products++; }
    });
    var label = list.length + " open";
    if (products > 1) label += " · " + products + " products";
    return { open: list.length, products: products, label: label };
  }

  // ---- the binding ---------------------------------------------------------
  // env = {
  //   storage            localStorage-shaped. Held only to retire the legacy scope key (below);
  //                      no Product state persists here any more.
  //   docById(id)        a document from the registry
  //   allDocIds()        every document id
  //   walkBlocks(doc,fn) the shared block walker
  //   countWords(html)   the shared HTML-stripping word counter
  //   libraryComponents() masterId -> component (each carrying updatedAt)
  //   productsStore()    productId -> Product
  //   sourceIndexedFor(doc)  is there approved source to align this document against
  //   whereUsed(masterId)    placements of a source passage
  //   published(docId)       has this document ever gone out (the release log)
  // }
  // ---- the retired global scope (uio-W01) -----------------------------------
  // One global active Product used to live here, persisted under `verso.activeProduct` and read by
  // every destination. It filtered the Edit tab strip, filtered Publish, hard-gated Source and
  // filtered a picker that never listed source documents at all. Four consequences, and all four
  // are why it is gone: a filter was doing a mode's job, work was hidden rather than organised, two
  // Products at once was impossible, and the mechanism was already obsolete because the Edit source
  // panel resolves source from the open document's own tag.
  //
  // Product is now three things and nothing else: a tag on a document (`meta.productId`), a facet
  // in Files and Publish, and an inspector in Source and Edit. Never global state.
  //
  // THE KEY IS NOT SIMPLY DELETED. Whatever Product the author last had selected is the best guess
  // at the facet Files should open on, so it is read ONCE and handed forward under a new name, then
  // the old key is removed and never written again. `uio-W06` (Files facets) is what reads the seed;
  // until it lands the seed just sits there, which is why this is a migration and not a deletion.
  var LEGACY_PRODUCT_SCOPE_KEY = "verso.activeProduct";
  var FILES_PRODUCT_FACET_SEED_KEY = "verso.filesProductFacetSeed";
  // Pure but for the injected storage. Idempotent: a second boot finds the legacy key absent and
  // does nothing, and it never overwrites a seed the author has since changed in Files.
  function consumeLegacyProductScope(storage) {
    if (!storage) return { seeded: false, id: "" };
    var saved = null;
    try { saved = storage.getItem(LEGACY_PRODUCT_SCOPE_KEY); } catch (e) { return { seeded: false, id: "" }; }
    if (saved === null || saved === undefined) return { seeded: false, id: "" };
    try { storage.removeItem(LEGACY_PRODUCT_SCOPE_KEY); } catch (e) {}
    if (!saved) return { seeded: false, id: "" };
    var already = null;
    try { already = storage.getItem(FILES_PRODUCT_FACET_SEED_KEY); } catch (e) {}
    if (already !== null && already !== undefined) return { seeded: false, id: saved };
    try { storage.setItem(FILES_PRODUCT_FACET_SEED_KEY, saved); } catch (e) { return { seeded: false, id: saved }; }
    return { seeded: true, id: saved };
  }
  function filesProductFacetSeed(storage) {
    if (!storage) return "";
    try { return storage.getItem(FILES_PRODUCT_FACET_SEED_KEY) || ""; } catch (e) { return ""; }
  }

  function createProductRail(env) {
    env = env || {};
    var storage = env.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var docById = env.docById || function () { return null; };
    var allDocIds = env.allDocIds || function () { return []; };
    var walkBlocks = env.walkBlocks || function () {};
    var countWords = env.countWords || function () { return 0; };
    var libraryComponents = env.libraryComponents || function () { return {}; };
    var productsStore = env.productsStore || function () { return {}; };
    var sourceIndexedFor = env.sourceIndexedFor || function () { return true; };
    var whereUsed = env.whereUsed || function () { return []; };
    var published = env.published || function () { return false; };

    // The Product scope that used to live here is gone -- see LEGACY_PRODUCT_SCOPE_KEY above. The
    // rail retires it once on this instance's behalf, so the old key cannot outlive the upgrade.
    var retiredScope = consumeLegacyProductScope(storage);

    // --- ground-truth staleness ---
    // A document links approved source through block.sourceLink.masterId; each linked master carries
    // a version stamp bumped on every content edit. Publishing snapshots those stamps onto the doc;
    // staleness is how many have moved since. UI only, never a gate.
    function linkedMasterIds(doc) {
      var ids = {};
      walkBlocks(doc, function (b) { if (b && b.sourceLink && b.sourceLink.masterId) ids[b.sourceLink.masterId] = 1; });
      return Object.keys(ids);
    }
    // WHICH masters moved. null when the document links no source at all -> no badge, rather than a
    // misleading "0 changed". A master absent from the baseline (newly linked, or never exported)
    // counts as changed. This is the ONE staleness computation; every surface derives from it.
    function driftedMasterIds(doc, currentVersions) {
      if (!doc) return null;
      var ids = linkedMasterIds(doc);
      if (!ids.length) return null;
      var baseline = (doc.meta && doc.meta.lastPublishedGroundTruthVersions) || {};
      return ids.filter(function (id) { return baseline[id] !== (currentVersions || {})[id]; });
    }
    function staleCount(doc, currentVersions) {
      var drifted = driftedMasterIds(doc, currentVersions);
      return drifted === null ? null : drifted.length;
    }
    function currentMasterVersions() {
      var comps = libraryComponents() || {}, out = {};
      Object.keys(comps).forEach(function (k) { if (comps[k]) out[k] = comps[k].updatedAt; });
      return out;
    }
    // The instant a document finishes exporting, its badge goes to zero: record every linked
    // master's current stamp as the new "last published" point.
    function snapshotBaseline(doc) {
      if (!doc) return doc;
      var cur = currentMasterVersions(), snap = {};
      linkedMasterIds(doc).forEach(function (id) { snap[id] = cur[id]; });
      doc.meta = doc.meta || {};
      doc.meta.lastPublishedGroundTruthVersions = snap;
      return doc;
    }

    // --- source alignment ---
    // A whole source-linked block counts all its words as linked; an inline <span data-source-link>
    // counts the words inside it.
    function linkedSpanWords(html) {
      var s = String(html == null ? "" : html), linked = 0;
      var re = /<span\b[^>]*\bdata-source-link\b[^>]*>([\s\S]*?)<\/span>/gi, m;
      while ((m = re.exec(s))) linked += countWords(m[1]);
      return linked;
    }
    function sourceAlignment(doc) {
      var linked = 0, total = 0;
      walkBlocks(doc, function (b) {
        if (!b || typeof b.text !== "string") return;
        var w = countWords(b.text);
        if (!w) return;
        total += w;
        if (b.sourceLink && b.sourceLink.markId) linked += w;   // whole-block linked
        else linked += linkedSpanWords(b.text);                 // inline linked spans
      });
      return { linkedWords: linked, totalWords: total, ratio: total ? linked / total : 0 };
    }
    function sourceAlignmentPct(doc) {
      var a = sourceAlignment(doc);
      if (!a.totalWords) return null;
      return Math.round(a.ratio * 100);
    }

    // --- the three document-scoped facts, for any surface, from one call ---
    function docFacts(docId, versions) {
      var d = docById(docId); if (!d) return null;
      var vers = versions || currentMasterVersions();
      return {
        docId: docId,
        title: (d.meta && d.meta.title) || docId,
        alignment: alignmentFact(sourceAlignment(d), sourceIndexedFor(d)),
        drift: driftFact(driftedMasterIds(d, vers), published(docId)),
        outputs: outputsFact(d.variants)
      };
    }
    // Documents belonging to a Product (the same meta.productId tag the browser + picker scope by).
    function productDocIds(pid) {
      if (!pid) return [];
      return allDocIds().filter(function (code) {
        var d = docById(code);
        return !!(d && d.meta && d.meta.productId === pid);
      });
    }
    // Product-scoped roll-up, plus (when a source topic is given) that topic's where-used and how
    // many of the Product's published documents are behind it.
    function productFacts(pid, masterId) {
      var vers = currentMasterVersions();
      var ids = productDocIds(pid);
      var each = ids.map(function (id) { return docFacts(id, vers); }).filter(Boolean);
      var outputs = 0;
      each.forEach(function (f) { outputs += f.outputs.count; });
      var behind = masterId ? each.filter(function (f) {
        return f.drift.state === "drifted" && f.drift.ids.indexOf(masterId) !== -1;
      }) : [];
      return {
        productId: pid,
        docIds: ids,
        docs: each,
        alignment: rollUpAlignment(each.map(function (f) { return f.alignment; })),
        outputs: { count: outputs, tone: "neutral", label: outputs + " outputs",
          title: outputs + " package" + (outputs === 1 ? "" : "s") + " across " + ids.length + " document" + (ids.length === 1 ? "" : "s") + "." },
        whereUsed: masterId ? whereUsedFact(whereUsed(masterId)) : null,
        behind: { count: behind.length, tone: behind.length ? "warning" : "neutral",
          label: behind.length ? (behind.length + " behind") : "",
          title: behind.length
            ? (behind.length + " published document" + (behind.length === 1 ? " is" : "s are") + " older than this source.")
            : "Every published document here is up to date with this source." }
      };
    }

    return {
      // uio-W01: the retired scope, reported rather than held. `seed` is what Files should open its
      // Product facet on the first time it runs (uio-W06); "" means the author had no scope set.
      retiredProductScope: retiredScope,
      filesProductFacetSeed: function () { return filesProductFacetSeed(storage); },
      linkedMasterIds: linkedMasterIds,
      driftedMasterIds: driftedMasterIds,
      staleCount: staleCount,
      currentMasterVersions: currentMasterVersions,
      snapshotBaseline: snapshotBaseline,
      sourceAlignment: sourceAlignment,
      sourceAlignmentPct: sourceAlignmentPct,
      linkedSpanWords: linkedSpanWords,
      docFacts: docFacts,
      productDocIds: productDocIds,
      productFacts: productFacts,
      whereUsedFor: function (masterId) { return whereUsedFact(whereUsed(masterId)); }
    };
  }

  // ---- Product Rail: tag vocabulary + the reserved owning-Product tag ------------
  // arch-P3b-07tags. A master's tags are [{value, reserved}]. At most one entry is reserved:
  // the owning-Product tag, stamped ONCE at promotion time from the active document's Product
  // context -- birthplace, not ownership, so a master promoted from an untagged document simply
  // gets no reserved tag and there is nothing to attribute. Every other entry is a freeform
  // technology tag, global across Products rather than scoped per Product.
  //
  // These are the FACTS half of this file: plain values in, the same object back, no store and
  // no DOM. Callers own persistence -- saveLibrary() after mutating the master passed in.
  //
  // FOUR OF THESE FIVE HAVE NO CALLER. `stampOwnerProductTag` runs at promotion (library.js);
  // the add, the remove and the vocabulary match are the model for a tag-editing UI that was
  // specified, tested and never built. They are kept, and said out loud here, so whoever builds
  // that UI finds a model rather than writing a second one.
  // A master's tags: [{value, reserved}]. At most one entry is reserved:true -- the
  // "owning Product" tag, stamped ONCE at promotion time from the active doc's Product
  // context (birthplace, not ownership -- a master promoted from an untagged doc simply
  // gets no reserved tag, nothing to attribute). Every other entry is a freeform
  // technology tag, global across Products (never scoped per Product). Pure; callers own
  // persistence (saveLibrary()) after mutating the master object passed in.
  /* @tag-vocab-start */
  function ownerProductTagValue(productId) { return productId ? ("product:" + productId) : null; }
  function stampOwnerProductTag(master, productId) {
    if (!master) return master;
    if (!Array.isArray(master.tags)) master.tags = [];
    if (!productId) return master; // no Product context at promotion time -- nothing to attribute
    if (master.tags.some(function (t) { return t && t.reserved; })) return master; // stamped once, never re-stamped
    master.tags.push({ value: ownerProductTagValue(productId), reserved: true });
    return master;
  }
  function addTechnologyTag(master, value) {
    if (!master) return master;
    var v = String(value || "").trim(); if (!v) return master;
    if (!Array.isArray(master.tags)) master.tags = [];
    if (master.tags.some(function (t) { return t && t.value === v; })) return master; // no dupes
    master.tags.push({ value: v, reserved: false });
    return master;
  }
  // Ordinary tag-editing can never remove the reserved tag -- matches on a non-reserved value only.
  function removeMasterTag(master, value) {
    if (!master || !Array.isArray(master.tags)) return master;
    master.tags = master.tags.filter(function (t) { return !(t && t.value === value && !t.reserved); });
    return master;
  }
  // Autocomplete-first matching against the global technology-tag vocabulary. "propose
  // new" is the caller's fallback when exact is false -- never the default typing path.
  function matchTagVocabulary(vocab, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return { matches: [], exact: false };
    var matches = (vocab || []).filter(function (t) { return t && t.toLowerCase().indexOf(q) !== -1; });
    var exact = (vocab || []).some(function (t) { return t && t.toLowerCase() === q; });
    return { matches: matches, exact: exact };
  }
  /* @tag-vocab-end */

  var VersoProductRail = {
    BANDS: BANDS,
    BAND_TONE: BAND_TONE,
    band: band,
    alignmentFact: alignmentFact,
    rollUpAlignment: rollUpAlignment,
    driftFact: driftFact,
    whereUsedFact: whereUsedFact,
    outputsFact: outputsFact,
    alignmentMeterModel: alignmentMeterModel,
    visibleTabIds: visibleTabIds,
    // uio-W10: the per-destination split, and what a strip says about itself.
    visibleSourceTabIds: visibleSourceTabIds, stripMeta: stripMeta,
    // uio-W01: the retired scope's migration, exported so tests reach the pure core directly.
    LEGACY_PRODUCT_SCOPE_KEY: LEGACY_PRODUCT_SCOPE_KEY,
    FILES_PRODUCT_FACET_SEED_KEY: FILES_PRODUCT_FACET_SEED_KEY,
    consumeLegacyProductScope: consumeLegacyProductScope,
    ownerProductTagValue: ownerProductTagValue, stampOwnerProductTag: stampOwnerProductTag,
    addTechnologyTag: addTechnologyTag, removeMasterTag: removeMasterTag,
    matchTagVocabulary: matchTagVocabulary,
    create: createProductRail
  };

  window.VersoProductRail = VersoProductRail;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoProductRail;
})();
