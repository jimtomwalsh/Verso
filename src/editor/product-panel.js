// editor/product-panel.js -- what this document belongs to (uio-W12).
//
// THE PROBLEM IT SOLVES. Product used to be a global mode: one picker at the top of the app, read
// by every destination, deciding what each of them would show. uio-W01 deleted it, which was right
// and which left a real question with nowhere to be answered. Looking at a course, you could no
// longer see what product it belonged to, which source document it traced back to, what else lived
// alongside it, or whether it had fallen behind that source. The information was in the stores the
// whole time; nothing put it in front of you.
//
// So this is an INSPECTOR, and the distinction is the whole ticket. An inspector reads the thing
// you have open and tells you about it. A filter takes what you pick and changes what everything
// else shows. The old picker was the second wearing the clothes of the first, and rebuilding it
// here -- one click in this panel quietly re-scoping a list somewhere -- is the specific failure
// this file must not have. So: it reads the open document and nothing else, every action it offers
// OPENS something rather than narrowing something, and it holds no state of its own at all.
//
// It renders in the left panel of both Source and Edit, from one model, because "what does this
// belong to" is the same question in both places and two implementations would answer it two ways.
// Extras and Siblings are Edit-only: a source document has no extras (it IS the source) and its
// siblings are a product's other source documents, which is a list of at most one.
//
// The pure model is exported and DOM-free, because resolving five relationships across three
// stores is the part that has to be right.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- the pure model ------------------------------------------------------

  // env = {
  //   kind          "design" | "source"  -- which destination is asking
  //   doc           the open document (a registry entry, or a LibraryStore source master)
  //   components    id -> library component
  //   products      id -> product
  //   registry      code -> design document
  //   openDocIds    what Edit has open, so a sibling can say "(open elsewhere)"
  //   drift         { state, count } from the existing staleness chain, or null
  // }
  //
  // Everything is resolved here so the renderer only lays out. A relationship that cannot be
  // resolved comes back absent rather than as a half-object the renderer has to re-test.
  function panelModel(env) {
    env = env || {};
    var SO = (typeof window !== "undefined" && window.SourceOwnership) ||
             (typeof require === "function" ? require("../source-ownership.js") : null);
    var doc = env.doc, kind = env.kind === "source" ? "source" : "design";
    var components = env.components || {}, products = env.products || {}, registry = env.registry || {};
    if (!doc) return { present: false, kind: kind };

    // A design document carries its product in meta; a source document carries it on the component.
    var productId = kind === "source" ? (doc.productId || "") : ((doc.meta && doc.meta.productId) || "");
    var product = (productId && products[productId]) || null;
    var docId = kind === "source" ? doc.id : ((doc.meta && doc.meta.code) || "");

    var primary = SO ? SO.primaryFor(components, products, productId) : null;
    // Looking at the primary itself, "Primary source -> this document" is a line pointing at where
    // you already are. It says so instead.
    var isPrimary = !!(primary && kind === "source" && primary.id === doc.id);

    // Extras are a design document's hand-attached sources. A source document has none by
    // definition -- it is the source.
    var extras = (kind === "design" && SO) ? SO.sourcesForDoc(doc, components, products).extras : [];

    // Siblings: the OTHER documents in this product. Edit only, and never including this one.
    var siblings = [];
    if (kind === "design" && productId) {
      var openIds = env.openDocIds || [];
      Object.keys(registry).forEach(function (id) {
        if (id === docId) return;
        var d = registry[id];
        if (!d || !d.meta || d.meta.productId !== productId) return;
        siblings.push({ id: id, title: d.meta.title || id, openElsewhere: openIds.indexOf(id) !== -1 });
      });
      siblings.sort(function (a, b) {
        var ta = a.title.toLowerCase(), tb = b.title.toLowerCase();
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
    }

    return {
      present: true,
      kind: kind,
      docId: docId,
      productId: productId,
      productName: product ? (product.name || productId) : "",
      tagged: !!product,
      primary: primary ? { id: primary.id, title: primary.name || primary.id } : null,
      isPrimary: isPrimary,
      extras: extras.map(function (c) { return { id: c.id, title: c.name || c.id }; }),
      siblings: siblings,
      release: releaseLine(env.drift)
    };
  }

  // THE RELEASE LINE, read from the existing drift chain rather than computed again. Four states,
  // and three of them are silent: a document that links no source, or has never been published, has
  // nothing to be behind, and a line saying so on every untouched document would be noise on every
  // screen. Only "in sync" and "behind" are worth the row.
  function releaseLine(drift) {
    if (!drift || !drift.state) return null;
    if (drift.state === "current") {
      return { tone: "success", text: "In sync with source" };
    }
    if (drift.state === "drifted") {
      var n = drift.count || 0;
      return { tone: "warning", text: n + " revision" + (n === 1 ? "" : "s") + " behind source" };
    }
    return null;
  }

  var PURE = { panelModel: panelModel, releaseLine: releaseLine };

  // ---- the panel -----------------------------------------------------------

  function install(kernel) {
    var E = kernel.need(
      "h", "registry", "libComponents", "openDocIds", "switchDoc", "saveOpenDocIds",
      "f04DocFacts", "showContextMenu", "saveRegistry", "doc", "openSourceTopicId",
      "promoteToProductModal", "classificationRow", "classificationSpec", "classificationLevels", "saveProducts"
    );
    var h = E.h;

    function modelFor(kind, doc) {
      return panelModel({
        kind: kind, doc: doc,
        components: E.libComponents(), products: window.ProductsStore || {}, registry: E.registry,
        openDocIds: E.openDocIds,
        drift: kind === "design" && doc && doc.meta && doc.meta.code
          ? (E.f04DocFacts(doc.meta.code) || {}).drift : null
      });
    }

    // Opening a source document lands SOURCE, because that is the destination that hosts its type.
    // Never a filter: the list you came from is exactly as you left it.
    function openSource(id) {
      E.openSourceTopicId(id);
      if (window.__leftRail) window.__leftRail.setStage("source");
    }
    function openDesign(id) {
      if (E.openDocIds.indexOf(id) === -1) { E.openDocIds.push(id); E.saveOpenDocIds(E.openDocIds); }
      E.switchDoc(id);
      if (window.__leftRail) window.__leftRail.setStage("edit");
    }

    function line(label, valueEl) {
      var row = h("div", "prodpanel__row");
      row.appendChild(h("span", "prodpanel__label", label));
      row.appendChild(valueEl);
      return row;
    }
    // A link in this panel OPENS. There is no control here that narrows anything, which is what
    // keeps an inspector from becoming the picker uio-W01 removed.
    function linkTo(text, onClick, title) {
      var b = h("button", "prodpanel__link", text);
      b.type = "button";
      if (title) b.title = title;
      b.addEventListener("click", onClick);
      return b;
    }

    // A classification write repaints THIS panel in place rather than reaching for a global
    // re-render: the panel is the only thing whose text changed, and the two entry points below
    // both land here anyway.
    function repaint(host, m) { renderInto(host, m); }
    function renderInto(host, m) {
      host.innerHTML = "";
      if (!m || !m.present) return;
      var body = h("div", "prodpanel");

      if (!m.tagged) {
        // UNTAGGED IS A PLAIN FACT, NOT AN ERROR. No red, no alarm glyph: shared material is a
        // thing people make deliberately. uio-W13 owns the fuller state; this is the panel's half.
        body.appendChild(h("div", "prodpanel__untagged",
          "No product. This is shared material — glossaries and standards used across products live here on purpose."));
        if (m.kind === "design") {
          var assign = linkTo("Assign a product…", function () {
            E.promoteToProductModal(E.registry[m.docId]);
          });
          assign.classList.add("prodpanel__action");
          body.appendChild(assign);
        }
        host.appendChild(body);
        return;
      }

      body.appendChild(line("Product", h("span", "prodpanel__value", m.productName)));

      // uio-F07 — classification is ANCHORED here. Product is the rung the model is set at, and
      // every document, page and block below it inherits unless it tightens. So the control lives
      // beside the Product's name rather than in a settings drawer: the thing being classified and
      // the thing doing the classifying are the same object.
      var product = (window.ProductsStore || {})[m.productId];
      if (product && typeof E.classificationRow === "function") {
        var cWrap = h("div", "prodpanel__classification");
        E.classificationRow(E.classificationSpec({ product: product }), {
          at: "product", host: cWrap, levels: E.classificationLevels(),
          write: function (id) { product.classificationId = id; E.saveProducts(); repaint(host, m); },
          clear: function () { delete product.classificationId; E.saveProducts(); repaint(host, m); }
        });
        body.appendChild(cWrap);
      }

      if (m.isPrimary) {
        body.appendChild(line("Primary source", h("span", "prodpanel__value prodpanel__value--self", "This document")));
      } else if (m.primary) {
        body.appendChild(line("Primary source",
          linkTo(m.primary.title, function () { openSource(m.primary.id); }, "Open in Source")));
      } else {
        // A product with no primary is a real state -- every new product is in it -- and a blank
        // where a name should be reads as a bug.
        body.appendChild(line("Primary source", h("span", "prodpanel__value prodpanel__none", "None yet")));
      }

      if (m.kind === "design") {
        var extrasWrap = h("div", "prodpanel__list");
        if (m.extras.length) {
          m.extras.forEach(function (x) {
            var row = h("div", "prodpanel__item");
            row.appendChild(linkTo(x.title, function () { openSource(x.id); }, "Open in Source"));
            var off = h("button", "prodpanel__detach", "✕");
            off.type = "button"; off.title = "Detach this source";
            off.addEventListener("click", function () { detachExtra(x.id); });
            row.appendChild(off);
            extrasWrap.appendChild(row);
          });
        } else {
          extrasWrap.appendChild(h("div", "prodpanel__empty", "None attached."));
        }
        var add = linkTo("+ Attach a source…", function (ev) { attachExtraMenu(ev); });
        add.classList.add("prodpanel__action");
        extrasWrap.appendChild(add);
        body.appendChild(line("Extras", extrasWrap));

        var sibWrap = h("div", "prodpanel__list");
        if (m.siblings.length) {
          m.siblings.forEach(function (s) {
            var row = h("div", "prodpanel__item");
            row.appendChild(linkTo(s.title, function () { openDesign(s.id); }, "Switch to this document"));
            // Stated rather than implied: switching to it will reveal a tab you already have open
            // rather than opening a second copy.
            if (s.openElsewhere) row.appendChild(h("span", "prodpanel__note", "(open elsewhere)"));
            sibWrap.appendChild(row);
          });
        } else {
          sibWrap.appendChild(h("div", "prodpanel__empty", "The only document in this product."));
        }
        body.appendChild(line("Siblings", sibWrap));
      }

      if (m.release) {
        var rel = h("div", "prodpanel__release prodpanel__release--" + m.release.tone, m.release.text);
        body.appendChild(rel);
      }
      host.appendChild(body);
    }

    // Attaching an extra is a write on the OPEN document's meta. Every source document is offered
    // except the ones already there and the primary, which is attached by the product tag already.
    function attachExtraMenu(ev) {
      var SO = window.SourceOwnership;
      var doc = E.doc; if (!doc) return;
      var comps = E.libComponents();
      var already = SO.sourcesForDoc(doc, comps, window.ProductsStore || {}).all
        .reduce(function (a, c) { a[c.id] = 1; return a; }, {});
      var offer = SO.sourceDocuments(comps).filter(function (c) { return !already[c.id]; });
      var items = [{ head: "Attach a source document" }];
      if (!offer.length) items.push({ label: "Every source document is already attached", disabled: true });
      offer.forEach(function (c) {
        items.push({ label: c.name || c.id, onClick: function () {
          SO.setExtraSourceIds(doc, SO.attachExtra(doc, c.id, comps, window.ProductsStore || {}));
          E.saveRegistry(E.registry);
          renderEditProductPanel();
        } });
      });
      var r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect
        ? ev.currentTarget.getBoundingClientRect() : { left: 0, bottom: 0 };
      E.showContextMenu(r.left, r.bottom + 4, items);
    }
    function detachExtra(id) {
      var SO = window.SourceOwnership, doc = E.doc; if (!doc) return;
      SO.setExtraSourceIds(doc, SO.detachExtra(doc, id));
      E.saveRegistry(E.registry);
      renderEditProductPanel();
    }

    // Edit: above the read-only source reading column, which is untouched.
    function renderEditProductPanel() {
      if (typeof document === "undefined") return;
      var host = document.getElementById("edit-product-panel"); if (!host) return;
      renderInto(host, modelFor("design", E.doc));
    }
    // Source: at the top of the outline rail, reading the open source document.
    function renderSourceProductPanel(master) {
      if (typeof document === "undefined") return;
      var host = document.getElementById("source-product-panel"); if (!host) return;
      renderInto(host, modelFor("source", master));
    }

    kernel.expose({
      renderEditProductPanel: renderEditProductPanel,
      renderSourceProductPanel: renderSourceProductPanel
    });
  }

  window.VersoProductPanel = { install: install, _pure: PURE };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoProductPanel;
})();
