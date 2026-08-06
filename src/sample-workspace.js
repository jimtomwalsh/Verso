// sample-workspace.js -- the content Verso ships with, so nothing is ever tested against a blank page.
//
// WHY THIS EXISTS. Until now the tool shipped one course and nothing else. Source was empty until
// somebody pasted lorem ipsum in by hand to have anything to click, and every test session began by
// building throwaway content before the real testing could start. A feature judged against an empty
// document is not judged at all: the outline, the margin, the variant columns, the facets and the
// per-document Publish cards are all invisible with one document of one type.
//
// IT IS DATA, NOT A BUILDER. Everything below is a literal, editable by hand and readable in a diff,
// and it is seeded through the store seams that already existed for `SAMPLE_DOC` -- getRegistry's
// default, seedDemoLibrary, loadProducts' default. There is no second construction path to keep in
// step with the model, and a workspace file (verso-workspace-export-import) is this same data
// arriving through a different door.
//
// NOTHING HERE IS REAL. This repository is public and Apache-2.0. The Meridian and Atlas lines are
// invented, and the prose is written to exercise structures, not to describe any product that
// exists. Keep it that way -- scripts/check-hygiene.js will hard-fail a commit that does not.
//
// WHAT IT DELIBERATELY COVERS. Three products, four document types, two source documents with real
// chaptered prose, all four mark types (comments open AND resolved, a linked passage used in two
// documents, an alternate that is genuinely stale, a restricted passage), variants already declared
// and diverged, a classification set at the Product rung and overridden at the document, and the
// edges: an untagged document, a document linked nowhere, a broken mark, a never-published
// document, a title long enough to truncate.
//
// EARNED, NOT FLAGGED. The stale alternate is stale because its `baseText` really does differ from
// the text it anchors, and the broken mark is broken because its node really is absent -- so
// SourceDoc.refreshMark reaches the same verdict the data claims. A hand-set `stale: true` would
// have been erased the first time the model was refreshed, and would have taught the wrong thing
// about the model in the meantime.
//
// TIMESTAMPS ARE FIXED LITERALS. No Date.now() -- this file is loaded by tests/run.js, which has
// neither a clock it will tolerate nor a use for one. The dates simply age, which is honest.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // Fixed points, most-recent last. Files sorts on updatedAt, so these also fix the reading order.
  var T_CREATED = 1785700000000;   // "a few days ago" at the time this shipped
  var T_GLOSSARY = 1785790000000;
  var T_NOTES = 1785830000000;
  var T_GUIDE = 1785880000000;
  var T_DECK = 1785920000000;
  var T_MANUAL = 1785960000000;

  // ---- products -------------------------------------------------------------
  // Three, because one product cannot show a band, a facet or a cross-product view. Atlas has no
  // source document ON PURPOSE: a product whose primary source has not been written yet is the
  // ordinary state of a new product, and the surfaces that assume one need to meet it.
  var PRODUCTS = {
    "prod-meridian": {
      id: "prod-meridian",
      name: "Meridian Field Sensor",
      createdAt: T_CREATED,
      // Declared at the Product, which is where the variant axis lives -- so Source's variant
      // columns and the variant-aware publish path have something to resolve without setup.
      variants: ["Base", "Extended"],
      // The Product rung of F07's ladder. Everything under Meridian is Internal unless a document
      // or a passage tightens it, which the manual below does.
      classificationId: "class_internal",
      groundTruthId: "topic-meridian-manual"
    },
    "prod-atlas": {
      id: "prod-atlas",
      name: "Atlas Bench Unit",
      createdAt: T_CREATED
    }
  };

  // ---- source documents (LibraryStore components, kind:"topic") -------------
  // Chaptered prose with real headings, because the outline, the measure, scroll-spy and
  // find-in-document all need something with shape to work on.
  var MANUAL_NODES = [
    { key: "n-c1", type: "heading", level: 1, chapter: true, text: "1 · Before you begin" },
    { key: "n-c1-p1", type: "paragraph", text: "The Meridian Field Sensor ships calibrated for bench use. Confirm the shipping seal is intact before unpacking, and record the serial number printed on the underside of the base plate." },
    { key: "n-c1-p2", type: "paragraph", text: "Two people are required for the mast-mounted installation described in the next chapter. Do not attempt it alone." },

    { key: "n-c2", type: "heading", level: 1, chapter: true, text: "2 · Installing the sensor" },
    { key: "n-c2-p1", type: "paragraph", text: "Mount the bracket to the mast with the four supplied bolts, torqued to 12 Nm. The arrow moulded into the bracket must point away from the mast." },
    // The alternate on this paragraph was written against "every 500 mm". The wording has since
    // changed, which is what makes it stale -- see the mark's baseText below.
    { key: "n-c2-p2", type: "paragraph", text: "Route the signal cable down the inside of the mast and secure it every 400 mm." },
    // Diverged wording: the same instruction, different on Extended units.
    { key: "n-c2-p3", type: "paragraph", text: "Power the unit from the supplied 24 V adapter.",
      variants: { Extended: { text: "Power the unit from the supplied 24 V adapter, or from the vehicle loom where one is fitted." } } },
    // Added-only: absent from the base, present for Extended alone. `baseAbsent` is what makes a
    // node belong to a variant rather than to the document.
    { key: "n-c2-p4", type: "paragraph", text: "Extended units carry a second cable for the auxiliary head. Route it alongside the first and label both ends.",
      baseAbsent: true, variants: { Extended: { text: "Extended units carry a second cable for the auxiliary head. Route it alongside the first and label both ends." } } },

    { key: "n-c3", type: "heading", level: 1, chapter: true, text: "3 · Calibration and handover" },
    { key: "n-c3-p1", type: "paragraph", text: "Run the self-test from the front panel. A steady green lamp means the unit is ready to hand over." },
    { key: "n-c3-p2", type: "paragraph", text: "Calibration constants for pre-production units are held under separate cover and must not be reproduced in customer-facing documentation." },
    { key: "n-c3-p3", type: "paragraph", text: "Record the handover on the installation sheet and leave a copy with the site owner." }
  ];

  var MANUAL_MARKS = [
    // A comment still open: the margin stub, the rail's open count and the section dot all read it.
    { id: "mk-comment-open", type: "comment", anchor: { nodeKey: "n-c1-p2", start: 0, len: 30 },
      variant: "", tag: "", classificationId: null, signoff: null, baseText: null, alt: null,
      comments: [], locations: null, stale: false, broken: false },
    // And one whose thread is resolved, so "open" and "resolved" are distinguishable without
    // resolving something first. Resolution lives on the topic's threads, below.
    { id: "mk-comment-done", type: "comment", anchor: { nodeKey: "n-c2-p1", start: 0, len: 62 },
      variant: "", tag: "", classificationId: null, signoff: null, baseText: null, alt: null,
      comments: [], locations: null, stale: false, broken: false },
    // A linked passage used in TWO documents -- the case where an edit here has a blast radius, and
    // the only case that makes the where-used list worth drawing.
    { id: "mk-link-mount", type: "link", anchor: { nodeKey: "n-c2-p1", start: 0, len: 96 },
      variant: "", tag: "", classificationId: null, signoff: null, baseText: null, alt: null,
      comments: [],
      locations: [
        { docCode: "MER-DECK-01", docTitle: "Meridian Field Sensor — Installation Overview", sectionTitle: "Mounting", blockId: "blk-deck-mount" },
        { docCode: "MER-FG-01", docTitle: "Meridian Field Sensor — Facilitator Guide", sectionTitle: "Session 2", blockId: "blk-guide-mount" }
      ],
      stale: false, broken: false },
    // STALE, and stale for the real reason: baseText is the wording the alternate was written
    // against, the node now says something else, and refreshMark compares the two.
    { id: "mk-alt-cable", type: "alternate", anchor: { nodeKey: "n-c2-p2", start: 0, len: 78 },
      variant: "", tag: "short form", classificationId: null, signoff: null,
      baseText: "Route the signal cable down the inside of the mast and secure it every 500 mm.",
      alt: "Run the signal cable inside the mast, clipped at 500 mm intervals.",
      comments: [], locations: null, stale: true, broken: false },
    // A restricted passage, tighter than the document it sits in -- which is the only reason a mark
    // carries its own classificationId rather than inheriting.
    { id: "mk-restricted-calib", type: "restricted", anchor: { nodeKey: "n-c3-p2", start: 0, len: 142 },
      variant: "", tag: "", classificationId: "class_restricted", signoff: null, baseText: null, alt: null,
      comments: [], locations: null, stale: false, broken: false },
    // BROKEN, and broken for the real reason: it is an object mark (no len) whose node is not in
    // the document. The rail's red dot and the "downstream copies are orphaned" warning need a
    // genuine instance to point at, and one that survives a refresh.
    { id: "mk-broken-figure", type: "link", anchor: { nodeKey: "n-removed-figure" },
      variant: "", tag: "", classificationId: null, signoff: null, baseText: null, alt: null,
      comments: [], locations: null, stale: false, broken: true }
  ];

  var SOURCE_DOCS = {
    "topic-meridian-manual": {
      id: "topic-meridian-manual",
      kind: "topic",
      name: "Meridian Field Sensor — Operating Manual",
      productId: "prod-meridian",
      sourceMaster: true,
      // The document rung OVERRIDES the Product's Internal with something tighter. F07 allows
      // tightening only, so this is the direction an override is permitted to go -- and it gives
      // the banner and the ladder a real two-rung resolution to show.
      classificationId: "class_restricted",
      sections: [],
      createdAt: T_CREATED,
      updatedAt: T_MANUAL,
      // Comment THREADS, anchored to the comment marks above. One open, one resolved.
      comments: [
        { id: "cm-sample-open", anchor: { markId: "mk-comment-open" },
          body: "Is two people a hard requirement, or a recommendation? The installers read this as optional.",
          done: false, author: "Sample reviewer", colour: null, createdAt: T_CREATED, replies: [] },
        { id: "cm-sample-done", anchor: { markId: "mk-comment-done" },
          body: "Confirm the torque figure against the current bracket revision.",
          done: true, author: "Sample reviewer", colour: null, createdAt: T_CREATED, replies: [] }
      ],
      // _seq is set past every key used above so a node added by hand never collides with a
      // literal one and silently steals its marks.
      doc: { version: 1, _seq: 400, nodes: MANUAL_NODES, marks: MANUAL_MARKS, history: [] }
    },

    // Shared material, deliberately belonging to NO product and linked from nothing: the "None
    // (shared)" band, and the case where where-used has the honest answer "nowhere".
    "topic-shared-glossary": {
      id: "topic-shared-glossary",
      kind: "topic",
      name: "Shared Glossary",
      sourceMaster: true,
      sections: [],
      createdAt: T_CREATED,
      updatedAt: T_GLOSSARY,
      comments: [],
      doc: {
        version: 1, _seq: 400, marks: [], history: [],
        nodes: [
          { key: "n-g1", type: "heading", level: 1, chapter: true, text: "Glossary" },
          { key: "n-g1-p1", type: "paragraph", text: "**Base plate** — the machined plate a sensor bolts to. Every mounting instruction assumes one is already fitted." },
          { key: "n-g1-p2", type: "paragraph", text: "**Auxiliary head** — the second sensing element fitted to Extended units only. Base units have no auxiliary head and no second cable." },
          { key: "n-g1-p3", type: "paragraph", text: "**Handover** — the point at which the installed unit passes to the site owner, recorded on the installation sheet." }
        ]
      }
    }
  };

  // ---- design documents (registry entries) ----------------------------------
  // A presentation and a guide alongside the shipped course, because the matrix doc-types and the
  // per-document Publish cards have nothing to say when every document is the same type.
  var DESIGN_DOCS = {
    // Frame geometry, interactive: a presentation.
    "MER-DECK-01": {
      meta: {
        title: "Meridian Field Sensor — Installation Overview",
        code: "MER-DECK-01",
        productId: "prod-meridian",
        geo: "frame", interactive: true,
        updatedAt: T_DECK
      },
      schemaVersion: 4,
      chapters: [{ id: "chap-deck", name: "Overview", order: 0 }],
      pages: [
        { id: "deck-01", name: "Title", chapterId: "chap-deck", blocks: [
          { type: "heading", text: "Installing the Meridian Field Sensor" },
          { type: "paragraph", text: "A ten-minute overview for installers who have done the bench setup." }
        ] },
        { id: "deck-02", name: "Mounting", chapterId: "chap-deck", blocks: [
          { type: "subheading", text: "Mounting the bracket" },
          // Linked to the manual: one of the two places mk-link-mount reports.
          { id: "blk-deck-mount", type: "paragraph",
            text: "Mount the bracket to the mast with the four supplied bolts, torqued to 12 Nm. The arrow moulded into the bracket must point away from the mast.",
            sourceLink: { masterId: "topic-meridian-manual", markId: "mk-link-mount" } }
        ] }
      ]
    },

    // Paged geometry, static: a facilitator guide. The title is long ON PURPOSE -- a row, a tab and
    // a Publish card all have to truncate something eventually, and they should be seen doing it.
    "MER-FG-01": {
      meta: {
        title: "Meridian Field Sensor — Facilitator Guide for the Two-Day Installation and Handover Workshop",
        code: "MER-FG-01",
        productId: "prod-meridian",
        geo: "paged", interactive: false,
        updatedAt: T_GUIDE
      },
      schemaVersion: 4,
      chapters: [{ id: "chap-guide", name: "Sessions", order: 0 }],
      pages: [
        { id: "guide-01", name: "Session 1", chapterId: "chap-guide", blocks: [
          { type: "heading", text: "Session 1 — Bench familiarisation" },
          { type: "paragraph", text: "Ninety minutes. Every participant unpacks a unit, records its serial number and runs the self-test." },
          { type: "note", text: "Facilitator: keep one sealed unit back so the seal check can be demonstrated rather than described." }
        ] },
        { id: "guide-02", name: "Session 2", chapterId: "chap-guide", blocks: [
          { type: "heading", text: "Session 2 — Mast installation" },
          // The SAME linked passage as the deck. This is what makes the link mark's where-used list
          // say two documents rather than one.
          { id: "blk-guide-mount", type: "paragraph",
            text: "Mount the bracket to the mast with the four supplied bolts, torqued to 12 Nm. The arrow moulded into the bracket must point away from the mast.",
            sourceLink: { masterId: "topic-meridian-manual", markId: "mk-link-mount" } },
          { type: "paragraph", text: "Pair the group. Nobody climbs alone, and the second person stays on the ground with the cable." }
        ] }
      ]
    },

    // UNTAGGED: no product at all, and referenced by nothing. It belongs in the "No product" band,
    // and it is the document that proves that band is not a leftovers bin.
    "ATL-NOTES-01": {
      meta: {
        title: "Bench Unit Release Notes",
        code: "ATL-NOTES-01",
        geo: "reflow", interactive: true,
        updatedAt: T_NOTES
      },
      schemaVersion: 4,
      chapters: [{ id: "chap-notes", name: "Notes", order: 0 }],
      pages: [
        { id: "notes-01", name: "Current release", chapterId: "chap-notes", blocks: [
          { type: "heading", text: "Bench Unit — release notes" },
          { type: "paragraph", text: "Written before the product had a name, kept because the changes it lists are still true. Nothing links to it and it has never been published." },
          { type: "paragraph", text: "Self-test now reports the firmware revision on the front panel rather than only in the log." }
        ] }
      ]
    }
  };

  window.SAMPLE_WORKSPACE = {
    products: PRODUCTS,
    sourceDocs: SOURCE_DOCS,
    designDocs: DESIGN_DOCS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = window.SAMPLE_WORKSPACE;
})();
