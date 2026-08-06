// source-ownership.js -- which source documents a piece of work draws on (uio-W14).
//
// THE PROBLEM IT SOLVES. Source was keyed on Product from end to end: you resolved a Product, the
// Product named one master through `groundTruthId`, and that master was the only source document
// that existed as far as the app was concerned. Two things fell out of that, and both are wrong.
//
// A source document with NO product had nowhere to live. Glossaries, standards, style guides --
// the material that serves every product precisely because it belongs to none -- could be created
// (`createTopic` has always taken an optional productId) but could never be resolved, listed or
// opened again, because every path in got there through a Product.
//
// And a design document could draw on exactly ONE source document, its product's primary. A course
// that cites the product manual AND the shared glossary had no way to say so, even though the link
// marks already carry a `masterId` and would have resolved either one.
//
// So ownership is stated here, once, as a pure question over the two stores:
//
//   - a source document is a LibraryStore component, product-optional;
//   - a product still names exactly ONE primary, and a product with none degrades to null rather
//     than to an exception;
//   - a design document has that primary plus any EXTRAS it has attached by hand, in
//     `meta.extraSourceIds`.
//
// NO FILE-SPACE MIGRATION. LibraryStore and the registry stay separate stores; nothing moves. What
// changes is that "which sources does this document have" stops being "look up its product" and
// becomes a question with an answer of its own.
//
// Pure and DOM-free on purpose: this is the part that has to be right, and a browser cannot tell
// you that a resolution quietly returned the wrong document.
(function () {
  "use strict";

  // ---- what a source document IS -------------------------------------------

  // The reserved master component. `archivedInto` marks a chapter that was folded into one of
  // these, which is a part of a document rather than a document.
  function isSourceDocument(c) {
    return !!(c && c.kind === "topic" && c.sourceMaster && !c.archivedInto);
  }

  // Every source document in the library, product or not, ordered by name so the list a person
  // sees does not depend on the order a store happened to enumerate.
  function sourceDocuments(components) {
    components = components || {};
    return Object.keys(components)
      .map(function (id) { return components[id]; })
      .filter(isSourceDocument)
      .sort(function (a, b) {
        var na = String(a.name || a.id || "").toLowerCase(), nb = String(b.name || b.id || "").toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      });
  }

  // The shared, cross-product material: the source documents that carry no product. Not leftovers
  // -- a glossary serves every product because it belongs to none.
  function sharedSourceDocuments(components) {
    return sourceDocuments(components).filter(function (c) { return !c.productId; });
  }

  // ---- one primary per product ---------------------------------------------

  // ONE primary, still named by product.groundTruthId. A product with none is a real state -- every
  // new product is in it -- so this answers "" rather than throwing.
  function primaryIdFor(products, productId) {
    var p = productId && products && products[productId];
    return (p && p.groundTruthId) || "";
  }

  // The primary as a component, and only if it really is a source document: a groundTruthId left
  // pointing at something deleted, or at a chapter that was later archived, resolves to null rather
  // than handing back a half-document that every caller downstream would have to re-check.
  function primaryFor(components, products, productId) {
    var id = primaryIdFor(products, productId);
    var c = id && components && components[id];
    return isSourceDocument(c) ? c : null;
  }

  // masterId -> productId, for the reverse question ("is this document somebody's primary?"). Built
  // from the products, so a component claiming to be a master that no product points at is not one.
  function primaryIndex(products) {
    var out = {};
    Object.keys(products || {}).forEach(function (pid) {
      var gt = products[pid] && products[pid].groundTruthId;
      if (gt && !out[gt]) out[gt] = pid;
    });
    return out;
  }

  // ---- a design document's sources ------------------------------------------

  // The hand-attached extras, normalised: strings only, no blanks, no duplicates, order kept. The
  // shape is defended here rather than at every call site, because this list round-trips through
  // save, load, export and a .verso package, and any of those can hand back something odd.
  function extraSourceIds(doc) {
    var raw = (doc && doc.meta && doc.meta.extraSourceIds) || [];
    if (!Array.isArray(raw)) return [];
    var seen = {}, out = [];
    raw.forEach(function (id) {
      if (typeof id !== "string" || !id || seen[id]) return;
      seen[id] = 1; out.push(id);
    });
    return out;
  }

  // What this document draws on: its product's primary (resolved automatically from the tag) plus
  // its extras (attached by hand). `all` is what a resolver should walk.
  //
  // An extra that names the primary is not listed twice, and an extra naming something that is not
  // a source document is dropped -- a deleted glossary should leave a document with one fewer
  // source, not with a hole its callers have to test for.
  function sourcesForDoc(doc, components, products) {
    components = components || {};
    var primary = primaryFor(components, products || {}, (doc && doc.meta && doc.meta.productId) || "");
    var extras = [];
    var seen = {};
    if (primary) seen[primary.id] = 1;
    extraSourceIds(doc).forEach(function (id) {
      if (seen[id]) return;
      var c = components[id];
      if (!isSourceDocument(c)) return;
      seen[id] = 1; extras.push(c);
    });
    return { primary: primary, extras: extras, all: (primary ? [primary] : []).concat(extras) };
  }

  // A link mark carries a masterId and nothing else, which is why multi-source linking needs no
  // change to the mark model: resolution just has a longer list to look down. A mark pointing at an
  // extra resolves exactly as one pointing at the primary.
  function resolveLinkedSource(masterId, doc, components, products) {
    if (!masterId) return null;
    var set = sourcesForDoc(doc, components, products).all;
    for (var i = 0; i < set.length; i++) if (set[i].id === masterId) return set[i];
    return null;
  }

  // ---- attaching and detaching ----------------------------------------------
  //
  // Pure list arithmetic, returning the NEW list rather than mutating meta, so the caller owns the
  // write and the history entry that goes with it.

  // The primary is never an extra: it is already attached by the product tag, and listing it twice
  // would show the same document under two headings in the Product panel.
  function attachExtra(doc, id, components, products) {
    var ids = extraSourceIds(doc);
    if (!id || typeof id !== "string") return ids;
    if (ids.indexOf(id) !== -1) return ids;
    if (components && !isSourceDocument(components[id])) return ids;
    if (id === primaryIdFor(products || {}, (doc && doc.meta && doc.meta.productId) || "")) return ids;
    return ids.concat([id]);
  }
  function detachExtra(doc, id) {
    return extraSourceIds(doc).filter(function (x) { return x !== id; });
  }

  // The write, kept in one place so an empty list is DELETED rather than persisted as `[]`. A
  // document that never attached an extra should round-trip byte-identical to one from before this
  // ticket existed.
  function setExtraSourceIds(doc, ids) {
    if (!doc) return doc;
    doc.meta = doc.meta || {};
    var clean = [];
    var seen = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      if (typeof id !== "string" || !id || seen[id]) return;
      seen[id] = 1; clean.push(id);
    });
    if (clean.length) doc.meta.extraSourceIds = clean; else delete doc.meta.extraSourceIds;
    return doc;
  }

  var API = {
    isSourceDocument: isSourceDocument,
    sourceDocuments: sourceDocuments,
    sharedSourceDocuments: sharedSourceDocuments,
    primaryIdFor: primaryIdFor,
    primaryFor: primaryFor,
    primaryIndex: primaryIndex,
    extraSourceIds: extraSourceIds,
    sourcesForDoc: sourcesForDoc,
    resolveLinkedSource: resolveLinkedSource,
    attachExtra: attachExtra,
    detachExtra: detachExtra,
    setExtraSourceIds: setExtraSourceIds
  };

  if (typeof window !== "undefined") window.SourceOwnership = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
