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
// WHAT THIS FILE DOES NOT OWN. The band headers and the primary-source treatment are uio-W05; the
// facet rail is uio-W06; open-vs-reveal is uio-W07; creation actions are uio-W08. Files renders
// bands here with a plain header on purpose, so W05 has one place to make them speak.
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

  var PURE = {
    GROUPING_KEY: GROUPING_KEY, MODE_KEY: MODE_KEY, GROUPINGS: GROUPINGS, MODES: MODES,
    TYPE_ORDER: TYPE_ORDER, TYPE_LABEL: TYPE_LABEL,
    buildCorpus: buildCorpus, corpusSummary: corpusSummary, groupCorpus: groupCorpus,
    matchesQuery: matchesQuery, byRecent: byRecent, byBand: byBand, bandPrimary: bandPrimary,
    normGrouping: normGrouping, normMode: normMode
  };

  // ---- the destination -----------------------------------------------------

  function install(kernel) {
    var E = kernel.need(
      "h", "registry", "libComponents", "switchDoc", "openDocIds", "saveOpenDocIds",
      "colourForName", "formatRelativeTime", "showContextMenu", "promoteToProductModal",
      "unlinkDocFromProduct", "exportVersoPackage", "renameCourse", "duplicateCourse",
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
    // document into Source. uio-W07 makes an already-open document REVEAL its tab rather than
    // opening a second copy; until then this is the plain open.
    function openDoc(d) {
      if (!d) return;
      if (d.kind === "source") {
        if (window.__productRail && window.__productRail.openSourceTopicId) window.__productRail.openSourceTopicId(d.id);
        if (window.__leftRail) window.__leftRail.setStage("source");
        return;
      }
      if (E.openDocIds.indexOf(d.id) === -1) { E.openDocIds.push(d.id); E.saveOpenDocIds(E.openDocIds); }
      E.switchDoc(d.id);
      if (window.__leftRail) window.__leftRail.setStage("edit");
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
      head.appendChild(controls);
      host.appendChild(head);

      var body = h("div", "files__body");
      host.appendChild(body);
      ui = { host: host, count: count, body: body };
      return ui;
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

    function docRow(d, showTypeChip) {
      var prod = d.productId && window.ProductsStore ? window.ProductsStore[d.productId] : null;
      return window.VersoUI.DocumentRow({
        title: d.title,
        type: d.type,
        typeChip: showTypeChip,
        primary: d.primary,
        dot: d.productId ? E.colourForName(d.productId) : null,
        dotTitle: d.productId ? ("Product: " + ((prod && prod.name) || d.productId)) : null,
        updated: window.VersoUI._pure.compactRelativeTime(d.updatedAt, Date.now()),
        updatedTitle: typeof d.updatedAt === "number" ? E.formatRelativeTime(d.updatedAt, Date.now()) : null,
        onOpen: function () { openDoc(d); },
        onMenu: function (ev) { rowMenu(d, ev); }
      });
    }

    function docCard(d, showTypeChip) {
      var card = h("div", "files-card" + (d.primary ? " is-primary" : ""));
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
      meta.appendChild(h("span", "files-card__when",
        window.VersoUI._pure.compactRelativeTime(d.updatedAt, Date.now())));
      card.appendChild(meta);
      card.addEventListener("click", function () { openDoc(d); });
      return card;
    }

    function render() {
      if (!ensureUI()) return;
      var all = corpus().filter(function (d) { return matchesQuery(d, query); });
      var sum = corpusSummary(all);
      ui.count.textContent = sum.documents + (sum.documents === 1 ? " document" : " documents") +
        (sum.products ? (" · " + sum.products + (sum.products === 1 ? " product" : " products")) : "");
      ui.body.innerHTML = "";
      ui.body.classList.toggle("files__body--cards", mode === "card");
      // Drop ticks for documents no longer listed -- deleted, or filtered out by a search. A
      // selection that outlives what it pointed at is how a bulk action touches the wrong thing.
      var visible = {}; all.forEach(function (d) { visible[d.id] = 1; });
      Object.keys(selected).forEach(function (id) { if (!visible[id]) delete selected[id]; });
      var bar = bulkBar();
      ui.body.classList.toggle("has-selection", !!bar);
      if (bar) ui.body.appendChild(bar);

      if (!all.length) {
        ui.body.appendChild(h("div", "files__empty",
          query ? "No document matches that." : "No documents yet."));
        return;
      }
      // A type chip is redundant in the Type view -- the band above already says it.
      var showTypeChip = grouping !== "type";
      groupCorpus(all, grouping, window.ProductsStore || {}).forEach(function (g) {
        var band = h("div", "files-band");
        if (g.label || g.note) band.appendChild(bandHeader(g));
        var list = h("div", mode === "card" ? "files-band__cards" : "files-band__rows");
        g.docs.forEach(function (d) {
          // A row reading "Primary source" does not also need a "Source" type chip beside it -- the
          // role chip already says what type it is, and two chips saying one thing is the noise the
          // type chip is switched off for elsewhere.
          var chip = showTypeChip && !(d.primary && d.type === "source");
          var el = mode === "card" ? docCard(d, chip) : docRow(d, chip);
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
