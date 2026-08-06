// editor/files.js -- the Files destination: every document you have, in one place (uio-W04).
//
// THE PROBLEM IT SOLVES. Verso kept its documents in two stores that had never met on screen.
// Design documents -- courses, presentations, guides -- live in the registry, keyed by code. Source
// documents live in LibraryStore as `kind:"topic"` components, and the only place you could see one
// was the Source stage, one product at a time. So "what do I have?" had no answer: the file browser
// listed half your work and called it everything.
//
// Files answers it. One corpus, both stores, three ways to look at it. The header states the size
// of what you are looking at, because a list with no count leaves you wondering whether it is
// showing you everything.
//
// GROUPING IS A SWITCH, NOT A SCREEN. Product, Type and Recent are three views over ONE list: the
// same documents, the same row, the same actions. That is the whole point -- a "view" that changed
// what you could do would be a mode wearing a switch's clothes, which is exactly what uio-W01 tore
// out of this app.
//
// LIST IS THE DEFAULT AND THE SHIPPED ANSWER. Forty products in a card grid is a scrolling problem;
// four products in a list still reads fine. Card mode exists for visual recall, not as the primary.
//
// FACETS ARE A LENS, NEVER A MODE (uio-W06). Type and Product narrow what is listed and change
// nothing else: the bands keep their identity underneath, the header keeps counting the whole
// corpus, and clearing every facet returns to exactly the unfiltered view. The selection is a local
// in this module -- never persisted, never on the kernel -- because a filter state the rest of the
// app could read is the global Product scope uio-W01 deleted, rebuilt under a friendlier name.
//
// WHAT THIS FILE DOES NOT OWN. Open-vs-reveal is uio-W07; creation actions are uio-W08.
//
// The pure core -- the corpus, the grouping, the summary -- is DOM-free and exported, because
// merging two stores into one list is the part that has to be right and the part a browser cannot
// tell you is wrong.
//
// Editor chrome only: it lists and opens documents and never renders one.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- the pure core -------------------------------------------------------

  // Per-client view preferences. Files-only, and deliberately NOT app-wide scope: uio-W06's guard
  // rail is that nothing outside Files ever reads how Files is arranged, and that starts here.
  var GROUPING_KEY = "verso.filesGrouping";
  var MODE_KEY = "verso.filesMode";
  var GROUPINGS = ["product", "type", "recent"];
  var MODES = ["list", "card"];

  // ONE corpus from TWO stores. A design document is a registry entry; a source document is a
  // LibraryStore component with kind:"topic". They keep their separate stores -- there is no
  // file-space migration here -- and meet only as this flat list of descriptors.
  //
  // env = {
  //   registry        code -> document
  //   components      id -> library component (source documents among them)
  //   products        id -> product
  //   geoOf(doc)      a design document's geometry: reflow | frame | paged
  // }
  function buildCorpus(env) {
    env = env || {};
    var registry = env.registry || {}, comps = env.components || {}, products = env.products || {};
    var geoOf = env.geoOf || function () { return "reflow"; };
    var out = [];

    Object.keys(registry).forEach(function (id) {
      var d = registry[id]; if (!d || typeof d !== "object") return;
      var meta = d.meta || {};
      out.push({
        id: id,
        kind: "design",
        title: meta.title || id,
        type: geoOf(d) || "reflow",
        productId: meta.productId || "",
        updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : null,
        primary: false
      });
    });

    // A source document is the reserved master a product points at with groundTruthId. Loose
    // topics -- the pre-unification model, and anything archived into a master -- are chapters of a
    // document rather than documents, so they are not listed as one.
    var primaryIds = {};
    Object.keys(products).forEach(function (pid) {
      var gt = products[pid] && products[pid].groundTruthId;
      if (gt) primaryIds[gt] = pid;
    });
    Object.keys(comps).forEach(function (id) {
      var c = comps[id]; if (!c || c.kind !== "topic") return;
      if (c.archivedInto) return;              // a chapter of a master, not a document
      if (!c.sourceMaster && !primaryIds[id]) return; // a loose pre-unification topic
      out.push({
        id: id,
        kind: "source",
        title: c.name || id,
        type: "source",
        productId: c.productId || primaryIds[id] || "",
        updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : null,
        // A product names exactly one primary source. uio-W05 gives it its treatment; the fact
        // is established here so both the band and the row can read it.
        primary: !!primaryIds[id]
      });
    });
    return out;
  }

  // What the header states. A list with no count leaves you unsure it is showing you everything.
  // Products counts the products actually REPRESENTED, not every product that exists -- the header
  // describes what is in front of you.
  function corpusSummary(docs) {
    var seen = {}, n = 0;
    (docs || []).forEach(function (d) { if (d && d.productId && !seen[d.productId]) { seen[d.productId] = 1; n++; } });
    return { documents: (docs || []).length, products: n };
  }

  // Most-recent first; a document with no timestamp sorts LAST but is never hidden, and ties break
  // on title so the order is stable across renders rather than dependent on store insertion order.
  function byRecent(a, b) {
    var ua = (a && typeof a.updatedAt === "number") ? a.updatedAt : -Infinity;
    var ub = (b && typeof b.updatedAt === "number") ? b.updatedAt : -Infinity;
    if (ua !== ub) return ub - ua;
    var ta = ((a && a.title) || "").toLowerCase(), tb = ((b && b.title) || "").toLowerCase();
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  // Within a band: the primary source first (it is what the product traces back to), then the rest
  // most-recent first.
  function byBand(a, b) {
    if (!!a.primary !== !!b.primary) return a.primary ? -1 : 1;
    return byRecent(a, b);
  }

  var TYPE_ORDER = ["source", "reflow", "frame", "paged"];
  var TYPE_LABEL = { source: "Source", reflow: "Courses", frame: "Presentations", paged: "Guides" };

  // Three views over one list. Same documents, same rows, same actions -- only the arrangement
  // changes. `products` supplies band names; an id with no product is the trailing "No product"
  // band, which is where shared cross-product material lives rather than a leftovers bin.
  function groupCorpus(docs, grouping, products) {
    docs = (docs || []).slice();
    products = products || {};
    if (grouping === "recent") {
      return [{ key: "recent", label: "", docs: docs.sort(byRecent) }];
    }
    if (grouping === "type") {
      var byType = {};
      docs.forEach(function (d) {
        var t = TYPE_ORDER.indexOf(d.type) === -1 ? "reflow" : d.type;
        (byType[t] = byType[t] || []).push(d);
      });
      return TYPE_ORDER.filter(function (t) { return byType[t] && byType[t].length; })
        .map(function (t) { return { key: t, label: TYPE_LABEL[t], docs: byType[t].sort(byRecent) }; });
    }
    // product (the default)
    var bands = {}, none = [];
    docs.forEach(function (d) {
      if (!d.productId) { none.push(d); return; }
      (bands[d.productId] = bands[d.productId] || []).push(d);
    });
    var out = Object.keys(bands).sort(function (a, b) {
      var na = ((products[a] && products[a].name) || a).toLowerCase();
      var nb = ((products[b] && products[b].name) || b).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    }).map(function (pid) {
      return { key: pid, label: (products[pid] && products[pid].name) || pid, docs: bands[pid].sort(byBand) };
    });
    // Always trailing, and never called "Unassigned": these are the glossaries and standards that
    // serve every product, not documents someone forgot to file.
    if (none.length) out.push({ key: "", label: "No product", note: "Shared, cross-product material", docs: none.sort(byBand) });
    return out;
  }

  // A document matches the search box on its title or its id. Same shape as the browser's own
  // matcher, so moving between the two does not change what a query finds.
  function matchesQuery(d, q) {
    if (!q) return true;
    q = String(q).toLowerCase();
    return (((d && d.title) || "").toLowerCase().indexOf(q) !== -1) ||
           (((d && d.id) || "").toLowerCase().indexOf(q) !== -1);
  }

  // uio-W05: the band's primary source, or null. Pure, because "which document does this product
  // trace back to" is the question the whole band header exists to answer, and it must not depend
  // on the order a store happened to enumerate.
  function bandPrimary(band) {
    var docs = (band && band.docs) || [];
    for (var i = 0; i < docs.length; i++) if (docs[i] && docs[i].primary) return docs[i];
    return null;
  }

  function normGrouping(g) { return GROUPINGS.indexOf(g) === -1 ? "product" : g; }
  function normMode(m) { return MODES.indexOf(m) === -1 ? "list" : m; }

  // ---- uio-W06: facets, which are a LENS and must never become a mode ------
  //
  // This is the ticket most likely to regress into the thing uio-W01 just deleted. The global
  // Product scope was app state that every destination read: it filtered the Edit tab strip,
  // filtered Publish, hard-gated Source. A facet rail that persisted, or that anything outside
  // Files could read, would be that same mechanism wearing a filter's clothes.
  //
  // So the guard rails are structural, not a note in a comment:
  //   - facet state lives in a local in the destination and is NEVER written to storage,
  //   - it is never exposed on the kernel, so no other module can reach it,
  //   - and clearing every facet returns to EXACTLY the unfiltered view -- which is true by
  //     construction here, because applyFacets on an empty selection is the identity function.
  //
  // Within a dimension the selections are an OR (Course *or* Guide); across dimensions an AND
  // (a Course *in* Alpha). That is what "lens" means: narrowing, never switching.
  var FACET_DIMS = ["type", "product"];

  function normFacets(f) {
    var out = { type: {}, product: {} };
    if (!f || typeof f !== "object") return out;
    FACET_DIMS.forEach(function (dim) {
      var sel = f[dim];
      if (!sel || typeof sel !== "object") return;
      Object.keys(sel).forEach(function (k) { if (sel[k]) out[dim][k] = true; });
    });
    return out;
  }
  function facetCount(f) {
    f = normFacets(f);
    return Object.keys(f.type).length + Object.keys(f.product).length;
  }
  // A document's value in a dimension. Product is "" for the No product facet, which is a real
  // selection -- shared cross-product material is a thing you look for, not an absence.
  function facetValue(d, dim) { return dim === "type" ? (d && d.type) || "" : (d && d.productId) || ""; }

  // The identity function when nothing is selected. That is the whole acceptance criterion:
  // clearing every facet returns to exactly the prior view, with no path that rebuilds it
  // differently.
  function applyFacets(docs, facets) {
    var f = normFacets(facets);
    var dims = FACET_DIMS.filter(function (dim) { return Object.keys(f[dim]).length; });
    if (!dims.length) return (docs || []).slice();
    return (docs || []).filter(function (d) {
      return dims.every(function (dim) { return !!f[dim][facetValue(d, dim)]; });
    });
  }

  // Counts for a dimension are computed with every OTHER dimension applied but not that one --
  // the standard faceted-search rule, and the one that stops a facet you can click from
  // promising results it cannot deliver. Counting with the dimension applied to itself would
  // show every unselected row as 0 the moment you picked one.
  //
  // Every type is listed even at zero, so the four document types read as a fixed vocabulary
  // rather than a list that grows as you create things. Products list every product that exists
  // plus No product.
  function facetCounts(docs, facets, products) {
    docs = docs || [];
    products = products || {};
    var f = normFacets(facets);
    function tally(dim) {
      var others = FACET_DIMS.filter(function (x) { return x !== dim; });
      var pool = docs.filter(function (d) {
        return others.every(function (x) {
          var sel = f[x];
          return !Object.keys(sel).length || !!sel[facetValue(d, x)];
        });
      });
      var n = {};
      pool.forEach(function (d) { var v = facetValue(d, dim); n[v] = (n[v] || 0) + 1; });
      return n;
    }
    var tn = tally("type");
    var pn = tally("product");
    var productKeys = Object.keys(products).sort(function (a, b) {
      var na = ((products[a] && products[a].name) || a).toLowerCase();
      var nb = ((products[b] && products[b].name) || b).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    // A product with no documents at all is still worth listing -- an empty product is a real
    // thing you just made, and hiding it reads as the creation having failed.
    Object.keys(pn).forEach(function (k) { if (k && productKeys.indexOf(k) === -1) productKeys.push(k); });
    return {
      type: TYPE_ORDER.map(function (t) {
        return { dim: "type", key: t, label: TYPE_LABEL[t], count: tn[t] || 0, active: !!f.type[t] };
      }),
      product: productKeys.map(function (pid) {
        return { dim: "product", key: pid, label: (products[pid] && products[pid].name) || pid,
                 count: pn[pid] || 0, active: !!f.product[pid] };
      }).concat([{ dim: "product", key: "", label: "No product", count: pn[""] || 0, active: !!f.product[""] }])
    };
  }

  // What the dismissible chips above the results say. Named in the same words the rail uses, so
  // dismissing a chip and unticking its row are visibly the same act.
  function facetChips(facets, products) {
    var f = normFacets(facets);
    products = products || {};
    var out = [];
    TYPE_ORDER.forEach(function (t) {
      if (f.type[t]) out.push({ dim: "type", key: t, label: "Type: " + TYPE_LABEL[t] });
    });
    Object.keys(f.product).forEach(function (pid) {
      out.push({ dim: "product", key: pid,
                 label: "Product: " + (pid ? ((products[pid] && products[pid].name) || pid) : "No product") });
    });
    return out;
  }

  // THE ONE-TIME SEED, and the reason it is one-time. uio-W01 retired the global Product scope but
  // kept the last selected Product under a new name, because it is the best guess at the facet
  // Files should open on. Reading it here is a courtesy on the first launch after the upgrade.
  //
  // The key is REMOVED in the same pass, always -- including when the product it names no longer
  // exists. A seed that survived would be a persisted scope by another route, which is exactly what
  // this ticket exists not to rebuild.
  // ---- uio-W07: open vs reveal --------------------------------------------
  //
  // A row has to say whether the document is ALREADY OPEN, because the alternative is finding out
  // by clicking -- and the wrong answer to that click is a second copy of a document you already
  // had, in a strip you now have to reconcile by hand.
  //
  // Where a document is open is a fact about the two strips, not about the document: Edit holds
  // registry ids, Source holds LibraryStore ids, and neither can hold the other's. So this reads
  // both open sets and answers with the destination that has it, or "" for closed.
  function openStateOf(d, openDesignIds, openSourceIds) {
    if (!d) return "";
    if (d.kind === "source") return (openSourceIds || []).indexOf(d.id) !== -1 ? "source" : "";
    return (openDesignIds || []).indexOf(d.id) !== -1 ? "edit" : "";
  }

  // ---- uio-W08: what a creation form offers -------------------------------
  //
  // The empty option reads "None (shared)", never "All products". They look alike and mean opposite
  // things: one is a filter saying "do not narrow", the other is a CHOICE saying "this belongs to no
  // product", which is a real and deliberate state for a glossary or a standard. Reusing the filter's
  // wording here would tell an author they were declining to choose when they were choosing.
  //
  // "+ New product…" sits at the bottom so a product can be made from inside the form that needs it,
  // rather than sending the author away to make one and come back.
  var NO_PRODUCT_LABEL = "None (shared)";
  var NEW_PRODUCT_VALUE = "__new";
  function productChoices(products) {
    products = products || {};
    var opts = [{ value: "", label: NO_PRODUCT_LABEL }];
    Object.keys(products).sort(function (a, b) {
      var na = ((products[a] && products[a].name) || a).toLowerCase();
      var nb = ((products[b] && products[b].name) || b).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    }).forEach(function (id) {
      opts.push({ value: id, label: (products[id] && products[id].name) || id });
    });
    opts.push({ value: NEW_PRODUCT_VALUE, label: "+ New product…" });
    return opts;
  }
  // "Make this the primary source" AUTO-TICKS when the product has no primary yet, because that is
  // what the author almost always means: the first source document you write for a product is what
  // it traces back to. It does NOT auto-tick when one exists, because silently displacing a
  // product's primary is the one thing this checkbox must never do by default.
  function primaryDefault(products, productId) {
    if (!productId) return false;              // shared material is nobody's primary
    var p = (products || {})[productId];
    return !!p && !p.groundTruthId;
  }

  var FACET_SEED_KEY = "verso.filesProductFacetSeed";
  function consumeFacetSeed(storage, products) {
    if (!storage) return "";
    var saved = null;
    try { saved = storage.getItem(FACET_SEED_KEY); } catch (e) { return ""; }
    try { storage.removeItem(FACET_SEED_KEY); } catch (e) {}
    if (!saved) return "";
    return (products && products[saved]) ? saved : "";
  }

  var PURE = {
    GROUPING_KEY: GROUPING_KEY, MODE_KEY: MODE_KEY, GROUPINGS: GROUPINGS, MODES: MODES,
    TYPE_ORDER: TYPE_ORDER, TYPE_LABEL: TYPE_LABEL, FACET_DIMS: FACET_DIMS, FACET_SEED_KEY: FACET_SEED_KEY,
    buildCorpus: buildCorpus, corpusSummary: corpusSummary, groupCorpus: groupCorpus,
    matchesQuery: matchesQuery, byRecent: byRecent, byBand: byBand, bandPrimary: bandPrimary,
    normGrouping: normGrouping, normMode: normMode,
    normFacets: normFacets, facetCount: facetCount, applyFacets: applyFacets,
    facetCounts: facetCounts, facetChips: facetChips, consumeFacetSeed: consumeFacetSeed,
    openStateOf: openStateOf,
    productChoices: productChoices, primaryDefault: primaryDefault,
    NO_PRODUCT_LABEL: NO_PRODUCT_LABEL, NEW_PRODUCT_VALUE: NEW_PRODUCT_VALUE
  };

  // ---- the destination -----------------------------------------------------

  function install(kernel) {
    var E = kernel.need(
      "h", "registry", "libComponents", "switchDoc", "openDocIds", "saveOpenDocIds",
      "colourForName", "formatRelativeTime", "showContextMenu", "promoteToProductModal",
      "unlinkDocFromProduct", "exportVersoPackage", "renameCourse", "duplicateCourse", "openSourceTopicId",
      // uio-W08: the three creation actions. All three live here, and none of them needs a
      // pre-selected product -- there is no scope left to inherit.
      "createSourceDocument", "createProduct", "showNewDocDialog", "openSourceDocIds", "storeLocationText",
      "promptModal", "modalText", "saveProducts",
      "deleteCourse", "tagDocProductStage", "saveRegistry", "dsModalShell", "modalField",
      "confirmModal"
    );
    var h = E.h;

    var ui = null;
    var query = "";
    // uio-W04b: which documents are ticked for a bulk action. Deliberately NOT persisted -- a
    // selection is a thing you are doing right now, and finding yesterday's ticks still applied
    // after a reload is how a destructive bulk action goes wrong.
    var selected = {};
    var grouping = normGrouping(readPref(GROUPING_KEY));
    var mode = normMode(readPref(MODE_KEY));
    // uio-W06: the facet selection. A LOCAL, deliberately. It is never written to storage and
    // never exposed on the kernel, because a facet state anything else could read is the global
    // Product scope uio-W01 deleted, rebuilt.
    var facets = { type: {}, product: {} };
    var seedConsumed = false;

    function readPref(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function writePref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    function geoOf(d) {
      return (window.__docType && window.__docType.docCell) ? window.__docType.docCell(d).geo : "reflow";
    }
    function corpus() {
      return buildCorpus({
        registry: E.registry,
        components: E.libComponents(),
        products: window.ProductsStore || {},
        geoOf: geoOf
      });
    }

    // Opening a document means opening it where it belongs: a design document into Edit, a source
    // document into Source.
    //
    // uio-W07: AN ALREADY-OPEN DOCUMENT IS REVEALED, NOT DUPLICATED. Both openers are idempotent on
    // their strip -- a document already in the open set is switched to rather than pushed again --
    // so "open" and "reveal" are the same call and there is no second path that could disagree with
    // the first. What reveal adds is scrolling the tab into view: landing a destination whose strip
    // has scrolled past the tab you just chose leaves you looking for it.
    function openDoc(d) {
      if (!d) return;
      if (d.kind === "source") {
        // This reached for `window.__productRail.openSourceTopicId`, which is never assigned -- the
        // hook object carries the browser-verify entry points, not this one. So Files landed Source
        // and left whatever was already open showing, since uio-W04. It goes through the kernel now,
        // which is also what puts the document in Source's strip (uio-W10).
        E.openSourceTopicId(d.id);
        if (window.__leftRail) window.__leftRail.setStage("source");
        revealTab("#source-tabs", d.id);
        return;
      }
      if (E.openDocIds.indexOf(d.id) === -1) { E.openDocIds.push(d.id); E.saveOpenDocIds(E.openDocIds); }
      E.switchDoc(d.id);
      if (window.__leftRail) window.__leftRail.setStage("edit");
      revealTab("#toolbar-tabs", d.id);
    }
    // Scroll the now-active tab into the strip. Deferred a frame because the destination has only
    // just been shown, and a strip that is still display:none has no scroll geometry to work with.
    function revealTab(stripSel, id) {
      if (typeof document === "undefined") return;
      setTimeout(function () {
        var strip = document.querySelector(stripSel); if (!strip) return;
        var tab = strip.querySelector(".vds-doctab.is-active");
        if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
      }, 0);
    }

    function ensureUI() {
      if (ui) return ui;
      var host = document.getElementById("stage-files"); if (!host) return null;
      host.innerHTML = "";

      var head = h("div", "files__head");
      var titleWrap = h("div", "files__headline");
      titleWrap.appendChild(h("h2", "files__title", "Files"));
      var count = h("span", "files__count");
      titleWrap.appendChild(count);
      head.appendChild(titleWrap);

      var controls = h("div", "files__controls");
      // Grouping: one switch, three arrangements of the same list. The canonical segmented control,
      // not three buttons that happen to look related.
      var groupSeg = window.VersoUI.SegmentedControl({
        options: [{ value: "product", label: "Product" }, { value: "type", label: "Type" }, { value: "recent", label: "Recent" }],
        value: grouping,
        onChange: function (v) { grouping = normGrouping(v); writePref(GROUPING_KEY, grouping); render(); }
      });
      controls.appendChild(groupSeg);
      // The canonical IconField is the DS's search form. It commits on change, so the input is
      // also listened to directly for search-as-you-type -- the same thing the browser's own search
      // box does, rather than a second bespoke field.
      var search = window.VersoUI.IconField({
        icon: "search", placeholder: "search documents", value: query,
        onChange: function (v) { query = v || ""; render(); }
      });
      var searchInput = search.querySelector("input");
      if (searchInput) searchInput.addEventListener("input", function () { query = searchInput.value || ""; render(); });
      search.classList.add("files__search");
      controls.appendChild(search);
      // List is the default and the shipped answer; card mode is for visual recall.
      var modeSeg = window.VersoUI.SegmentedControl({
        options: [{ value: "list", icon: "list", title: "List" }, { value: "card", icon: "grid-2x2", title: "Cards" }],
        value: mode,
        onChange: function (v) { mode = normMode(v); writePref(MODE_KEY, mode); render(); }
      });
      modeSeg.classList.add("files__mode");
      controls.appendChild(modeSeg);
      // uio-W08: ONE New control opening the three actions, rather than three buttons competing for
      // the header. The full three-up set lives in the empty state, where naming every way in is the
      // whole job of the screen.
      var newBtn = window.VersoUI.Button({ variant: "primary", size: "sm", label: "New", onClick: newMenu });
      newBtn.classList.add("files__new");
      controls.appendChild(newBtn);
      head.appendChild(controls);
      host.appendChild(head);

      // uio-W06: the facet rail sits BESIDE the results, not above them, so it reads as a lens you
      // are looking through rather than a control that changed the screen. The results keep their
      // own scroll; the rail does not scroll away from under your hand while you use it.
      var main = h("div", "files__main");
      var rail = h("div", "files__facets");
      var body = h("div", "files__body");
      main.appendChild(rail);
      main.appendChild(body);
      host.appendChild(main);
      // uio-W09: the retired overlay's footer carried the one line where the app admits out loud
      // whether the work is in a real folder or in browser storage. It belongs to whichever surface
      // answers "where are my documents?", and that is this one now.
      host.appendChild(h("div", "files__store", E.storeLocationText()));
      ui = { host: host, count: count, body: body, rail: rail };
      return ui;
    }

    // One facet row: the canonical Checkbox, a name, a count. A CHECKBOX because the selections
    // within a dimension are an OR and you can hold several -- a radio would say "mode", which is
    // the one thing this rail must never become.
    function facetRow(f) {
      var row = window.VersoUI.Checkbox({
        checked: !!f.active, label: f.label,
        onChange: function (on) {
          if (on) facets[f.dim][f.key] = true; else delete facets[f.dim][f.key];
          render();
        }
      });
      row.classList.add("files-facet");
      if (f.active) row.classList.add("is-active");
      if (!f.count) row.classList.add("is-empty");
      row.appendChild(h("span", "files-facet__count", String(f.count)));
      row.title = f.label + " — " + f.count + (f.count === 1 ? " document" : " documents");
      return row;
    }

    function renderFacetRail(all) {
      var counts = facetCounts(all, facets, window.ProductsStore || {});
      ui.rail.innerHTML = "";
      [["Type", counts.type], ["Product", counts.product]].forEach(function (pair) {
        var group = h("div", "files-facets__group");
        group.appendChild(h("div", "files-facets__group-label", pair[0]));
        pair[1].forEach(function (f) { group.appendChild(facetRow(f)); });
        ui.rail.appendChild(group);
      });
    }

    // The chips are the same act as the rail's ticks, said again where the results are, because
    // "why am I seeing only these?" has to be answerable without looking away from the list.
    function facetChipBar() {
      var chips = facetChips(facets, window.ProductsStore || {});
      if (!chips.length) return null;
      var bar = h("div", "files__chips");
      chips.forEach(function (c) {
        var chip = h("button", "files__chip", c.label);
        chip.type = "button";
        chip.title = "Remove this filter";
        chip.appendChild(h("span", "files__chip-x", "✕"));
        chip.addEventListener("click", function () { delete facets[c.dim][c.key]; render(); });
        bar.appendChild(chip);
      });
      if (chips.length > 1) {
        bar.appendChild(window.VersoUI.Button({
          variant: "ghost", size: "sm", label: "Clear all",
          onClick: function () { facets = { type: {}, product: {} }; render(); }
        }));
      }
      return bar;
    }

    // uio-W05: THE BAND HEADER IS THE SPINE OF THE WHOLE MODEL. You must be able to see which
    // source document a product traces back to WITHOUT OPENING ANYTHING -- that relationship is
    // what makes a product more than a tag, and a header that only counted documents left it
    // invisible.
    //
    // Product name, then the primary source named in accent, then the count on the right. A
    // product with no primary source says so plainly rather than rendering an empty line where a
    // name should be: "no primary source" is a real state, common on a new product, and a blank
    // reads as a bug. The No product band substitutes its own line, because shared material has no
    // primary by definition.
    function bandHeader(g) {
      var head = h("div", "files-band__head");
      if (g.label) head.appendChild(h("span", "files-band__name", g.label));
      if (g.note) {
        head.appendChild(h("span", "files-band__note", g.note));
      } else if (g.key) { // a real product band -- "" is No product, which has no primary by definition
        var primary = bandPrimary(g);
        var line = h("span", "files-band__primary");
        if (primary) {
          line.appendChild(h("span", "files-band__primary-label", "Primary source"));
          line.appendChild(h("span", "files-band__primary-name", primary.title));
        } else {
          line.appendChild(h("span", "files-band__primary-none", "No primary source"));
        }
        head.appendChild(line);
      }
      head.appendChild(h("span", "files-band__count", g.docs.length + (g.docs.length === 1 ? " document" : " documents")));
      return head;
    }

    // uio-W04b: THE ROW MENU. Files lists every untagged course in its No product band -- exactly
    // where you would spot them -- and until now had no actions on its rows at all, because W02 gave
    // the row an onMenu slot and W04 never wired one. The actions mirror the browser's card menu and
    // REUSE its functions rather than reimplementing them, so the two places cannot drift apart.
    // The old overlay is retired by uio-W09; this is what carries the actions past it.
    function rowMenu(d, ev) {
      var items = [{ head: d.title }];
      items.push({ label: "Open", onClick: function () { openDoc(d); } });
      if (d.kind === "source") {
        // A source document's product is entangled with its product's groundTruthId: reassigning a
        // primary would break the product it is primary FOR. uio-W14 owns product-optional source
        // documents. Say so rather than offering an action that misbehaves.
        items.push({ sep: true });
        items.push({ label: "Source documents are managed in Source", disabled: true });
      } else {
        items.push({ sep: true });
        items.push({ label: d.productId ? "Move to another product…" : "Assign to a product…",
                     onClick: function () { E.promoteToProductModal(E.registry[d.id]); } });
        if (d.productId) items.push({ label: "Remove from product", onClick: function () {
          E.unlinkDocFromProduct(E.registry[d.id]); E.saveRegistry(E.registry); render();
        } });
        items.push({ sep: true });
        items.push({ label: "Rename…", onClick: function () { E.renameCourse(d.id); } });
        items.push({ label: "Duplicate", onClick: function () { E.duplicateCourse(d.id); } });
        items.push({ label: "Export .verso", onClick: function () { E.exportVersoPackage(E.registry[d.id]); } });
        items.push({ sep: true });
        items.push({ label: "Delete", danger: true, onClick: function () { E.deleteCourse(d.id); } });
      }
      var r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect
        ? ev.currentTarget.getBoundingClientRect() : { right: 0, bottom: 0 };
      E.showContextMenu(r.right, r.bottom + 4, items);
    }

    // The bulk bar. James's case is a handful, not forty, so this stays plain: tick rows, the bar
    // states HOW MANY before you commit, one action writes them all. A bulk action that does not
    // say what it is about to touch is how the wrong things get moved.
    function selectedIds() { return Object.keys(selected).filter(function (k) { return selected[k]; }); }
    function assignSelectedToProduct() {
      var ids = selectedIds(); if (!ids.length) return;
      var products = window.ProductsStore || {};
      var keys = Object.keys(products);
      if (!keys.length) { E.confirmModal("No products yet", "Create a product first, then assign documents to it.", function () {}); return; }
      var chosen = keys[0];
      var shell = E.dsModalShell({
        id: "files-assign-modal", title: "Assign to a product",
        subtitle: ids.length + (ids.length === 1 ? " document" : " documents") + " will be tagged. Content is never touched.",
        primaryLabel: "Assign",
        onPrimary: function () {
          ids.forEach(function (id) {
            var doc = E.registry[id]; if (!doc) return;
            E.tagDocProductStage(doc, chosen, null);
          });
          E.saveRegistry(E.registry);
          selected = {};
          shell.modal.remove();
          render();
        }
      });
      var row = E.modalField(shell.body, "Product");
      row.appendChild(window.VersoUI.Select({
        options: keys.map(function (k) { return { value: k, label: (products[k] && products[k].name) || k }; }),
        value: chosen,
        onChange: function (v) { chosen = v; }
      }));
    }
    function bulkBar() {
      var n = selectedIds().length;
      if (!n) return null;
      var bar = h("div", "files__bulk");
      bar.appendChild(h("span", "files__bulk-count", n + (n === 1 ? " document selected" : " documents selected")));
      var assign = window.VersoUI.Button({ variant: "primary", size: "sm", label: "Assign to a product…", onClick: assignSelectedToProduct });
      bar.appendChild(assign);
      var clear = window.VersoUI.Button({ variant: "ghost", size: "sm", label: "Clear", onClick: function () { selected = {}; render(); } });
      bar.appendChild(clear);
      return bar;
    }

    // ---- uio-W08: the three creation actions --------------------------------
    //
    // ALL THREE LIVE HERE, and none of them needs a pre-selected product. Creation used to inherit
    // the global scope -- a new document was silently stamped with whatever the top bar happened to
    // be showing -- and the Source path refused outright when nothing was selected. There is no
    // scope left to inherit and nothing left to refuse: the author chooses, in the form, including
    // choosing none.

    // The product row every creation form shares, so the three read the same and a product made in
    // one is a product made in all. Returns a getter for the chosen id.
    function productField(body, initial, onProductMade) {
      var chosen = initial || "";
      var row = E.modalField(body, "Product");
      var sel = null;
      function announce() { if (typeof onProductMade === "function") onProductMade(chosen); }
      function onChange(v) {
        // "+ New product…" makes one from inside the form that needs it, rather than sending the
        // author away to make one and come back to a form they would have to fill in again. Either
        // way the select is rebuilt, so cancelling puts the previous choice back rather than
        // leaving the row showing a product that was never created.
        if (v === NEW_PRODUCT_VALUE) {
          E.promptModal("New product", "Name", "", function (name) {
            if ((name || "").trim()) chosen = E.createProduct(name).id;
            rebuild(); announce();
          });
          return;
        }
        chosen = v || "";
        announce();
      }
      function rebuild() {
        var next = window.VersoUI.Select({
          options: productChoices(window.ProductsStore || {}), value: chosen, onChange: onChange
        });
        if (sel) row.replaceChild(next, sel); else row.appendChild(next);
        sel = next;
      }
      rebuild();
      return { get: function () { return chosen; } };
    }

    function newSourceDocumentModal() {
      var primaryTick = null, nameIn = null, product = null;
      var shell = E.dsModalShell({
        id: "files-new-source-modal",
        title: "New source document",
        subtitle: "The written material a product traces back to. Shared material — a glossary, a standard — belongs to no product on purpose.",
        primaryLabel: "Create",
        onPrimary: function () {
          var name = (nameIn.value || "").trim();
          if (!name) { window.alert("Give the document a name."); return; }
          var pid = product.get();
          var master = E.createSourceDocument(name, pid);
          // The tick is what sets groundTruthId, so an author who unticks it on a product with no
          // primary gets a second source document and a product that still has none -- which is a
          // legitimate thing to want and used to be impossible to express.
          var p = pid && window.ProductsStore[pid];
          if (p) {
            if (primaryTick.checked) p.groundTruthId = master.id;
            else if (p.groundTruthId === master.id) delete p.groundTruthId;
            E.saveProducts();
          }
          shell.modal.remove();
          // Files is stale the moment a document is created, and it keeps a live instance
          // (uio-W03) -- so it is marked for a rebuild on the next entry rather than re-rendered
          // behind a destination the author is leaving.
          if (window.__leftRail && window.__leftRail.invalidate) window.__leftRail.invalidate("files");
          E.openSourceTopicId(master.id);
          if (window.__leftRail) window.__leftRail.setStage("source");
        }
      });
      nameIn = E.modalText(shell.body, "Name", "", "e.g. Aegis Node Reference");
      product = productField(shell.body, "", function (pid) { syncPrimary(pid); });
      var tickRow = E.modalField(shell.body, "Primary source");
      primaryTick = h("input", "files__tick"); primaryTick.type = "checkbox";
      var tickLabel = h("label", "files-new__tick");
      tickLabel.appendChild(primaryTick);
      tickLabel.appendChild(h("span", null, "Make this the primary source"));
      tickRow.appendChild(tickLabel);
      function syncPrimary(pid) {
        primaryTick.checked = primaryDefault(window.ProductsStore || {}, pid);
        primaryTick.disabled = !pid;   // shared material is nobody's primary
      }
      syncPrimary("");
    }

    function newProductModal() {
      E.promptModal("New product", "Name", "", function (name) {
        if (!(name || "").trim()) return;
        var p = E.createProduct(name);
        // Creation RETURNS TO FILES with the new (empty) band in view. It used to land on a
        // dedicated product page, which was a screen whose only content was the absence of content.
        if (window.__leftRail) window.__leftRail.setStage("files");
        render();
        var band = ui && ui.body.querySelector('[data-band="' + p.id + '"]');
        if (band && band.scrollIntoView) band.scrollIntoView({ block: "nearest" });
      });
    }

    function newMenu(ev) {
      var r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect
        ? ev.currentTarget.getBoundingClientRect() : { left: 0, bottom: 0 };
      E.showContextMenu(r.left, r.bottom + 4, [
        { head: "New" },
        { label: "Source document…", onClick: newSourceDocumentModal },
        { label: "Design document…", onClick: function () { E.showNewDocDialog(); } },
        { sep: true },
        { label: "Product…", onClick: newProductModal }
      ]);
    }

    // uio-W08 §4.7. FIRST RUN NAMES WHAT YOU CAN DO AND OFFERS ALL THREE WAYS TO DO IT. No
    // destination instructs you to go and use a different one first -- the whole reason Source used
    // to say "Pick a Product in the top bar" and the top bar no longer exists.
    function emptyState() {
      var wrap = h("div", "files-empty");
      var glyph = h("div", "files-empty__glyph");
      glyph.innerHTML = window.Icon ? window.Icon("folder") : "";
      wrap.appendChild(glyph);
      wrap.appendChild(h("div", "files-empty__title", "Nothing here yet"));
      wrap.appendChild(h("div", "files-empty__body",
        "Create a product, a source document, or a design document to get started."));
      var acts = h("div", "files-empty__actions");
      acts.appendChild(window.VersoUI.Button({ variant: "primary", size: "sm", label: "New source document", onClick: newSourceDocumentModal }));
      acts.appendChild(window.VersoUI.Button({ variant: "secondary", size: "sm", label: "New design document", onClick: function () { E.showNewDocDialog(); } }));
      acts.appendChild(window.VersoUI.Button({ variant: "secondary", size: "sm", label: "New product", onClick: newProductModal }));
      wrap.appendChild(acts);
      return wrap;
    }

    // What is open right now, read fresh on every render -- so closing the last tab for a document
    // clears its label in Files without Files having to be told.
    function openSets() {
      return {
        design: E.openDocIds || [],
        source: (typeof E.openSourceDocIds === "function") ? E.openSourceDocIds() : []
      };
    }

    function docRow(d, showTypeChip, open) {
      var prod = d.productId && window.ProductsStore ? window.ProductsStore[d.productId] : null;
      return window.VersoUI.DocumentRow({
        title: d.title,
        type: d.type,
        typeChip: showTypeChip,
        // uio-W07: the row states whether it is already open, and where.
        openIn: openStateOf(d, open.design, open.source),
        primary: d.primary,
        dot: d.productId ? E.colourForName(d.productId) : null,
        dotTitle: d.productId ? ("Product: " + ((prod && prod.name) || d.productId)) : null,
        updated: window.VersoUI._pure.compactRelativeTime(d.updatedAt, Date.now()),
        updatedTitle: typeof d.updatedAt === "number" ? E.formatRelativeTime(d.updatedAt, Date.now()) : null,
        onOpen: function () { openDoc(d); },
        onMenu: function (ev) { rowMenu(d, ev); }
      });
    }

    function docCard(d, showTypeChip, open) {
      var card = h("div", "files-card" + (d.primary ? " is-primary" : "") +
        (openStateOf(d, open.design, open.source) ? " is-open" : ""));
      card.setAttribute("data-doc-type", d.type);
      // The same primary treatment the list carries, so switching mode never changes what a
      // document IS -- only how much room it takes.
      if (d.primary) card.appendChild(h("span", "files-card__primary", "Primary source"));
      var glyph = h("span", "files-card__glyph files-card__glyph--" +
        (d.type === "source" ? "source" : "design"));
      var T = window.VersoUI.DOCUMENT_TYPES[window.VersoUI._pure.docType(d.type)];
      glyph.innerHTML = window.Icon ? window.Icon(T.icon) : "";
      card.appendChild(glyph);
      card.appendChild(h("span", "files-card__title", d.title));
      var meta = h("span", "files-card__meta");
      if (showTypeChip) meta.appendChild(h("span", "files-card__chip", T.label));
      // The same fact the list row states, in the room a card has for it.
      var openIn = openStateOf(d, open.design, open.source);
      if (openIn) meta.appendChild(h("span", "files-card__open", window.VersoUI._pure.openStateLabel(openIn)));
      meta.appendChild(h("span", "files-card__when",
        window.VersoUI._pure.compactRelativeTime(d.updatedAt, Date.now())));
      card.appendChild(meta);
      card.addEventListener("click", function () { openDoc(d); });
      return card;
    }

    function render() {
      if (!ensureUI()) return;
      // The one-time facet seed from the retired global scope (uio-W01). Consumed on the first
      // render, when the product store is populated, and the key is removed in the same pass.
      if (!seedConsumed) {
        seedConsumed = true;
        var seed = consumeFacetSeed(typeof localStorage !== "undefined" ? localStorage : null,
                                    window.ProductsStore || {});
        if (seed) facets.product[seed] = true;
      }
      var searched = corpus().filter(function (d) { return matchesQuery(d, query); });
      // uio-W06: facets narrow what is LISTED. The header keeps counting the whole searched corpus,
      // so the number you are filtering down from stays on screen -- a count that shrank with the
      // filter would leave you unable to tell a narrow lens from an empty library.
      var all = applyFacets(searched, facets);
      var sum = corpusSummary(searched);
      ui.count.textContent = sum.documents + (sum.documents === 1 ? " document" : " documents") +
        (sum.products ? (" · " + sum.products + (sum.products === 1 ? " product" : " products")) : "");
      renderFacetRail(searched);
      ui.body.innerHTML = "";
      ui.body.classList.toggle("files__body--cards", mode === "card");
      // Drop ticks for documents no longer listed -- deleted, or filtered out by a search or a
      // facet. A selection that outlives what it pointed at is how a bulk action touches the wrong
      // thing.
      var visible = {}; all.forEach(function (d) { visible[d.id] = 1; });
      Object.keys(selected).forEach(function (id) { if (!visible[id]) delete selected[id]; });
      var chips = facetChipBar();
      if (chips) ui.body.appendChild(chips);
      var bar = bulkBar();
      ui.body.classList.toggle("has-selection", !!bar);
      if (bar) ui.body.appendChild(bar);

      if (!all.length) {
        // A search or a facet that finds nothing is NOT first run: the library is not empty, this
        // lens is. Offering "create a product to get started" there would answer a question nobody
        // asked. Only a genuinely empty corpus gets the first-run state.
        if (facetCount(facets) || query) {
          ui.body.appendChild(h("div", "files__empty",
            facetCount(facets) ? "No document matches those filters." : "No document matches that."));
          return;
        }
        ui.body.appendChild(emptyState());
        return;
      }
      // A type chip is redundant in the Type view -- the band above already says it.
      var showTypeChip = grouping !== "type";
      var open = openSets();
      groupCorpus(all, grouping, window.ProductsStore || {}).forEach(function (g) {
        var band = h("div", "files-band");
        band.setAttribute("data-band", g.key);
        if (g.label || g.note) band.appendChild(bandHeader(g));
        var list = h("div", mode === "card" ? "files-band__cards" : "files-band__rows");
        g.docs.forEach(function (d) {
          // A row reading "Primary source" does not also need a "Source" type chip beside it -- the
          // role chip already says what type it is, and two chips saying one thing is the noise the
          // type chip is switched off for elsewhere.
          var chip = showTypeChip && !(d.primary && d.type === "source");
          var el = mode === "card" ? docCard(d, chip, open) : docRow(d, chip, open);
          // uio-W05, the DIVIDER treatment: the primary source is not just first in its band, it is
          // visibly the thing the rest descend from -- an accent left border, a heavier title, and a
          // rule separating it from the design documents beneath. The prototype's subtitle variant
          // is deliberately NOT shipped: at forty products a second line per band is noise.
          if (d.primary) el.classList.add("is-primary-source");
          // uio-W04b: only design documents can be bulk-assigned. A source document's product is
          // entangled with its product's groundTruthId -- reassigning a primary would break the
          // product it is primary FOR -- and uio-W14 owns that, so it gets no tick.
          if (mode === "list" && d.kind === "design") {
            var tick = h("input", "files__tick"); tick.type = "checkbox";
            tick.checked = !!selected[d.id];
            tick.title = "Select for a bulk action";
            tick.addEventListener("click", function (ev) { ev.stopPropagation(); });
            tick.addEventListener("change", function () {
              if (tick.checked) selected[d.id] = true; else delete selected[d.id];
              render();
            });
            el.insertBefore(tick, el.firstChild);
            if (selected[d.id]) el.classList.add("is-selected");
          }
          list.appendChild(el);
        });
        band.appendChild(list);
        ui.body.appendChild(band);
      });
    }

    // Entering Files. The destination keeps a live instance (uio-W03), so this builds once; a
    // changed document set marks it stale through invalidateStage("files") and it rebuilds on the
    // next entry rather than on every one.
    function mountFilesStage() { render(); }
    function refreshFiles() { if (ui) render(); }

    kernel.expose({ mountFilesStage: mountFilesStage, refreshFiles: refreshFiles, filesOpenDoc: openDoc });
  }

  window.VersoFiles = { install: install, _pure: PURE };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoFiles;
})();
