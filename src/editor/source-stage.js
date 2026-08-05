// editor/source-stage.js -- the Source stage: one document per Product (arch-P3b-05).
//
// The left rail is the whole outline of a Product's ONE source document -- chapters with their
// headings nested, not a per-topic list -- and the article beside it is directly editable: click a
// heading or a paragraph and type, no edit-mode toggle. Around that sit the things a real source
// document needs and a slide deck does not: per-section facets (technical / digestible /
// dotpoint), hardware-variant columns declared per Product, range marks with comments and
// where-used, find-to-word with match cycling, a two-layer lock, and additive Markdown import
// that reconciles into the existing document rather than replacing it.
//
// THIS ONE COPIED CLEAN. Every binding it reaches for is a function declaration, a constant, or an
// object editor.js mutates but never replaces -- nothing here reads a value that gets swapped out
// underneath it. So there is no live-getter routing and no accessor pair: the body below is the
// region verbatim, aliased once at the top of install(), and the diff is a pure move.
//
// Editor chrome only. The source document is stored through the library master; nothing here
// renders or exports a course.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // install(kernel) is called once, by editor.js, after it has provided its host surface.
  function install(kernel) {
    var E = kernel.need(
      "h", "libComponents", "dsModalShell", "line", "f04Badge", "layout",
      "modalField", "variantNames", "clearTreeMarks", "setProductVariants", "jumpToLinkedBlock", "view",
      "showContextMenu", "confirmModal",
      "makeComment", "libraryWhereUsedDetail", "getRegistry", "sourceLinkWhereUsed", "pipelineByDirection", "pipelineButtons",
      "importMenuLabel", "unlinkAllCoursesFromProduct", "deleteProductSource", "deleteProduct", "saveLibrary", "modalSection",
      "makeReply", "modalText", "f04ProductFacts", "panelSection", "snapshotSourceLinkBase", "sourceBaseEditImpact", "showSourceBaseEditModal",
      "finalizeSourceLock", "sourceLinkAlternates", "registry", "applyAltToLocation", "saveRegistry", "decorateSourceLinks",
      "sourceAltSnippet", "History", "dsSelect", "promptModal", "saveProducts", "selection", "colourForName",
      "renderSourceProductPanel",
      "classificationSpec", "classificationLevels", "classificationChain", "resolveScoped"
    );
    // Aliased once: every one of these is stable (a function declaration, a constant, or an object
    // that is mutated but never reassigned), so the moved body reads exactly as it did.
    var h = E.h, libComponents = E.libComponents, dsModalShell = E.dsModalShell,
        line = E.line, f04Badge = E.f04Badge, layout = E.layout,
        modalField = E.modalField, variantNames = E.variantNames, clearTreeMarks = E.clearTreeMarks,
        setProductVariants = E.setProductVariants, jumpToLinkedBlock = E.jumpToLinkedBlock, view = E.view,
        showContextMenu = E.showContextMenu, confirmModal = E.confirmModal,
        makeComment = E.makeComment, libraryWhereUsedDetail = E.libraryWhereUsedDetail, getRegistry = E.getRegistry,
        sourceLinkWhereUsed = E.sourceLinkWhereUsed, pipelineByDirection = E.pipelineByDirection, pipelineButtons = E.pipelineButtons,
        importMenuLabel = E.importMenuLabel, unlinkAllCoursesFromProduct = E.unlinkAllCoursesFromProduct, deleteProductSource = E.deleteProductSource,
        deleteProduct = E.deleteProduct, saveLibrary = E.saveLibrary, modalSection = E.modalSection,
        makeReply = E.makeReply, modalText = E.modalText,
        f04ProductFacts = E.f04ProductFacts, panelSection = E.panelSection,
        snapshotSourceLinkBase = E.snapshotSourceLinkBase, sourceBaseEditImpact = E.sourceBaseEditImpact, showSourceBaseEditModal = E.showSourceBaseEditModal,
        finalizeSourceLock = E.finalizeSourceLock, sourceLinkAlternates = E.sourceLinkAlternates, registry = E.registry,
        applyAltToLocation = E.applyAltToLocation, saveRegistry = E.saveRegistry, decorateSourceLinks = E.decorateSourceLinks,
        sourceAltSnippet = E.sourceAltSnippet, History = E.History, dsSelect = E.dsSelect,
        promptModal = E.promptModal, saveProducts = E.saveProducts, selection = E.selection,
        colourForName = E.colourForName;

    // Product Rail (source-stage-nav-article): Source stage left-nav + flowing article.
    // A "topic" is a LibraryStore master with kind:"topic" -- per #68's own note, Ground
    // Truth topics slot into the existing master shape rather than a second store. No
    // variant-column support yet (Flagship/base facet only); that's the next ticket.
    /* @source-stage-start */
    var DETAIL_FACETS = ["technical", "digestible", "dotpoint"];
    function isValidFacet(f) { return DETAIL_FACETS.indexOf(f) !== -1; }
    // Fuzzy full-text search across the topic (name + every heading/paragraph/facet), not the
    // title only -- so an author finds a topic by a phrase inside it (spec 2.3, toc-search-drawer).
    // Falls back to a title substring if SourceDoc isn't loaded (defensive; it always is).
    function topicMatchesQuery(topic, query) {
      if (!query) return true;
      if (typeof window !== "undefined" && window.SourceDoc && window.SourceDoc.fuzzyMatch) {
        return window.SourceDoc.fuzzyMatch(window.SourceDoc.searchText(topic), query);
      }
      return ((topic && topic.name) || "").toLowerCase().indexOf(String(query).toLowerCase()) !== -1;
    }
    // Every kind:"topic" master, narrowed to the active product context ("" = All
    // products -> every topic) and a search query. Untagged (productId-less) topics
    // only ever show under "All products", matching an untagged doc's existing
    // behaviour elsewhere in Product Rail (never silently attributed to a filter).
    function filterTopics(comps, activeProduct, query) {
      return Object.keys(comps || {}).map(function (k) { return comps[k]; })
        .filter(function (t) { return t && t.kind === "topic"; })
        // Source v2: the reserved unified-doc master is not a nav topic, and a topic already
        // rolled into a master (archivedInto) is now a chapter -- both are hidden so a migrated
        // Product's nav shows the one document, never the old per-topic list on top of it.
        .filter(function (t) { return !t.sourceMaster && !t.archivedInto; })
        .filter(function (t) { return !activeProduct || t.productId === activeProduct; })
        .filter(function (t) { return topicMatchesQuery(t, query); });
    }
    // Groups topics by owning Product (label from ProductsStore; "" bucket -> "Unassigned",
    // sorted last), each group's topics sorted by their canonical order (see canonicalizeTopicOrder).
    // Only reached in the empty-Product onboarding fallback now that the unified TOC replaced the
    // per-topic navigator; kept (with filterTopics/topicMatchesQuery) as a small pure helper.
    function groupTopicsByProduct(topics, products) {
      var groups = {};
      (topics || []).forEach(function (t) {
        var pid = t.productId || "";
        if (!groups[pid]) groups[pid] = [];
        groups[pid].push(t);
      });
      return Object.keys(groups).sort(function (a, b) {
        var an = a ? ((products[a] && products[a].name) || a) : "￿";
        var bn = b ? ((products[b] && products[b].name) || b) : "￿";
        return an.localeCompare(bn);
      }).map(function (pid) {
        return {
          productId: pid,
          label: pid ? ((products[pid] && products[pid].name) || pid) : "Unassigned",
          topics: groups[pid].slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
        };
      });
    }
    // Assigns a stable, dense integer `order` to every topic within its own Product group
    // (order is meaningful only WITHIN a group -- cross-group position doesn't exist). A
    // topic with no order yet (never dragged) sorts to the end of its group, alphabetically
    // among its equally-unordered siblings, so a freshly created/imported topic appends
    // rather than jumping into the middle of an author's chosen order. Same canonicalize-
    // then-restamp idiom `doc.chapters` already uses (editor.js ~1044-1045).
    function canonicalizeTopicOrder(topics) {
      var byProduct = {};
      (topics || []).forEach(function (t) {
        var pid = t.productId || "";
        (byProduct[pid] = byProduct[pid] || []).push(t);
      });
      Object.keys(byProduct).forEach(function (pid) {
        var group = byProduct[pid].slice().sort(function (a, b) {
          var ao = a.order, bo = b.order;
          if (ao == null && bo == null) return (a.name || "").localeCompare(b.name || "");
          if (ao == null) return 1;
          if (bo == null) return -1;
          return ao - bo;
        });
        group.forEach(function (t, i) { t.order = i; });
      });
    }
    // A section's text for the requested facet, falling back to "technical" then to
    // whichever facet IS present -- a section never renders blank just because the
    // page-level control is set to a facet this section hasn't been written for yet.
    function resolveSectionFacetText(section, facet) {
      var facets = (section && section.facets) || {};
      if (facets[facet] != null) return facets[facet];
      if (facets.technical != null) return facets.technical;
      var firstKey = Object.keys(facets)[0];
      return firstKey ? facets[firstKey] : "";
    }
    // Product Rail (source-stage-variant-columns): variants are declared per-Product
    // (ProductsStore[id].variants), not per-document -- a Source topic is Product-scoped
    // library content, not tied to whatever course happens to be open.
    function declaredVariantsForProduct(products, productId) {
      var p = productId && products && products[productId];
      return (p && Array.isArray(p.variants)) ? p.variants.slice() : [];
    }
    // A section only carries a variant's own content when section.overrides[v] exists --
    // mirrors the shipped per-variant image-override mechanic (own image vs inherits
    // flagship, src/editor.js's renderImageVariantVersions), applied to section text.
    function sectionOverrideVariants(section) {
      return Object.keys((section && section.overrides) || {});
    }
    // Of the currently-toggled variants, only the ones THIS section actually diverges
    // for -- a section with no override for any toggled variant stays single-column.
    function sectionActiveVariants(section, activeVariants) {
      var present = sectionOverrideVariants(section);
      return (activeVariants || []).filter(function (v) { return present.indexOf(v) !== -1; });
    }
    // [{variant:null, text:<flagship>}, {variant:"coastal", text:<override>}, ...] in
    // toggle order. Length 1 (Flagship only) when nothing toggled diverges here --
    // callers render that case as a plain single body, no column chrome at all.
    function sectionColumns(section, activeVariants, facet) {
      var cols = [{ variant: null, text: resolveSectionFacetText(section, facet) }];
      sectionActiveVariants(section, activeVariants).forEach(function (v) {
        var ov = (section.overrides && section.overrides[v]) || {};
        cols.push({ variant: v, text: resolveSectionFacetText({ facets: ov.facets }, facet) });
      });
      return cols;
    }
    // Product Rail (source-topic-content-authoring): section CRUD -- plain array ops on
    // topic.sections, mutating in place (callers stamp updatedAt + saveLibrary()).
    function addSection(topic) {
      if (!topic) return null;
      topic.sections = topic.sections || [];
      var sec = { id: "sec-" + Math.random().toString(36).slice(2, 8), heading: "", facets: { technical: "" } };
      topic.sections.push(sec);
      return sec;
    }
    function removeSection(topic, index) {
      if (!topic || !topic.sections) return;
      topic.sections.splice(index, 1);
    }
    // Drag-and-drop reorder (the section grip handle) -- move dragId to just before/after
    // refId within the same topic.sections array. Same shape as the outliner's
    // structMoveChapter (editor.js ~16341): splice out, find the reference's new index,
    // splice back in before/after it. Self-drop is a no-op.
    function structMoveSection(topic, dragId, refId, after) {
      if (!topic || !topic.sections || dragId === refId) return;
      var arr = topic.sections;
      var di = arr.findIndex(function (s) { return s.id === dragId; });
      if (di < 0) return;
      var drag = arr.splice(di, 1)[0];
      var ri = arr.findIndex(function (s) { return s.id === refId; });
      var at = ri < 0 ? arr.length : (after ? ri + 1 : ri);
      arr.splice(at, 0, drag);
    }
    // Diverge-for-<variant>: copies Flagship's CURRENT facets into an independently-
    // editable override, once -- mirrors the shipped "own image vs inherits flagship"
    // convention (src/editor.js's renderImageVariantVersions). A no-op if already diverged
    // (never silently resets an author's existing override back to Flagship's text).
    function divergeSectionVariant(section, variant, cloneFn) {
      if (!section || !variant) return;
      section.overrides = section.overrides || {};
      if (section.overrides[variant]) return;
      section.overrides[variant] = { facets: cloneFn(section.facets || {}) };
    }
    // source-stage-comments: which of a topic's comments anchor to this section.
    function sourceCommentsForSection(topic, sectionId) {
      return (topic.comments || []).filter(function (c) { return c.anchor && c.anchor.sectionId === sectionId; });
    }
    /* @source-stage-end */

    var __sourceActiveTopicId = null;
    var __sourceActiveFacet = "technical";
    var __sourceSearchQuery = "";
    var __sourceReplaceQuery = ""; // source find-and-replace: the replacement text
    var __sourceReplaceOpen = false; // uio-S-C02 (SRC-05): the replace row is revealed on demand, not always shown
    var __sourceActiveVariants = []; // reset whenever a different topic is selected
    // Source rewrite (Epic 2b, lock-toolbars): a topic renders the new continuous-document article
    // (node model + range marks + two-layer lock + canvas-idiom toolbars) once it carries a `doc`
    // (SourceDoc JSON). Legacy section topics render the shipped article unchanged -- additive, no
    // regression. The live SourceDoc model is cached per topic so its owned undo stack survives
    // re-renders; edits persist back to topic.doc.
    var __sourceUnlocked = false;    // base prose editable? (annotation is always live)
    var __sourceEditSession = null;  // buffered prose-edit deltas during an unlock->lock cycle (History commit collapse)
    var __sourceShowMarks = true;    // marks painted + status dots visible
    var __sourceDocModel = null;     // the live SourceDoc model for __sourceDocModelTopicId
    var __sourceDocModelTopicId = null;
    var __sourceMarksEngine = null;  // the SourceMarks painting engine bound to the mounted article
    // Source v2 (consolidated-panel): ONE right panel (#source-stage-info) holds Marks + History +
    // Source + Comments; the on-demand overlay drawer is retired. One doc-bar control shows/hides it.
    var __sourceInfoOpen = true;     // the one consolidated right panel is shown (default) or hidden
    var __sourceMarksFilter = "all"; // the Marks-section filter: all | alternate | link | comment
    var __sourceActiveMarkId = null; // the mark whose row is highlighted (selected in the panel/article)
    var __sourceAltPanelMarkId = null; // the alternate mark shown in the pinned contextual panel
    var __sourceWhereUsedMarkId = null; // the link mark shown in the pinned where-used ("Linked in N") panel
    var __sourceOpenCommentMarkId = null; // the comment mark whose thread card is open, or null
    // Source v2 (unified-toc): the left rail is ONE document TOC of the active Product's unified
    // doc (chapters + nested headings) instead of a per-topic list. Chapter twirl state (a key set
    // to false is collapsed; default open) + the chapter drag-reorder state.
    var __sourceOpenChapters = {}; // chapterKey -> false collapses it in the TOC (default open)
    var __sourceChapterDrag = null; // { key } | null
    // Source v2 (find-word-cycling): the TOC search finds down to the word/line level. The live
    // ordered hits + the cursor into them drive the "N matches" count, next/prev cycling, and the
    // TOC filter (a heading is kept when it owns a hit). Recomputed by renderSourceUnifiedToc.
    var __sourceFindMatches = []; // [{nodeKey,start,len,index}] in document order for the current query
    var __sourceFindIndex = 0;    // which hit is currently scrolled-to + highlighted

    // A small canonical Badge overlaid on an IconButton's corner -- the notification-bell-
    // with-unread-count pattern -- so a count survives an icon-only treatment without
    // reintroducing a text sentence. Returns the plain icon button unwrapped when there's
    // nothing to show a count for.
    function iconButtonWithBadge(btn, count) {
      if (!count || !window.VersoUI || !window.VersoUI.Badge) return btn;
      var wrap = h("div", "source-stage__toolbar-badge-wrap");
      wrap.appendChild(btn);
      var badge = window.VersoUI.Badge({ children: String(count), tone: "warning", size: "sm" });
      badge.classList.add("source-stage__toolbar-badge");
      wrap.appendChild(badge);
      return wrap;
    }

    // The left-rail action row. Under the unified-document model (Source v2) there is no per-topic
    // list to manage, so the topic-management actions -- select / delete / move / reorder / needs-
    // review -- are gone (cleanup, spec 2c section 7.6). What remains: Markdown import always, plus
    // "New topic" only in the empty-Product onboarding path (no document yet).
    function renderSourceToolbar() {
      if (typeof document === "undefined") return;
      var host = document.getElementById("source-stage-nav-actions"); if (!host) return;
      host.innerHTML = "";
      if (!window.VersoUI || !window.VersoUI.IconButton) return;
      var U = window.VersoUI;
      // Top row = navigation / authoring actions (New topic, Import).
      var row = h("div", "source-stage__toolbar");
      if (!activeSourceMaster()) {
        row.appendChild(U.IconButton({ icon: "plus", label: "New topic", onClick: newTopicModal }));
      }
      // uio-P-C05 (PUB-13): import is a SOURCE action. This one button now opens the whole inbound
      // set — Markdown plus every registered import pipeline that used to sit on the Publish pane —
      // so nothing is duplicated and the Publish pane is left to what it sends out.
      row.appendChild(U.IconButton({ icon: "download", label: "Import…", onClick: function (ev) {
        var t = (ev && (ev.currentTarget || ev.target)) || null;
        var r = t && t.getBoundingClientRect ? t.getBoundingClientRect() : { left: 0, bottom: 0 };
        openSourceImportMenu(r.left, r.bottom + 4);
      } }));
      host.appendChild(row);
      // uio-S-C05 (SRC-13): product-scope actions (incl. the destructive delete-document / delete-
      // product) live in the FOOTER strip, away from navigation, so they read as acting on the
      // Product and are never one click from ordinary outline navigation.
      var footer = document.getElementById("source-stage-nav-footer");
      if (footer) {
        footer.innerHTML = "";
        var lifePid = activeSourceProductId();
        if (lifePid && window.ProductsStore[lifePid]) {
          var frow = h("div", "source-stage__toolbar");
          frow.appendChild(U.IconButton({ icon: "more-horizontal", label: "Product actions", onClick: function (e) {
            var t = (e && (e.currentTarget || e.target)) || null; var r = t && t.getBoundingClientRect ? t.getBoundingClientRect() : { left: 0, bottom: 0 };
            openProductActionsMenu(lifePid, r.left, r.bottom + 4);
          } }));
          footer.appendChild(frow);
        }
      }
    }
    // uio-P-C05 (PUB-13): the Source stage's one inbound menu. Markdown first (the everyday path),
    // then every action a module registered with an "Import" name — routed to the SAME handler the
    // Publish pane used to call, so no importer is rebuilt or duplicated here.
    function openSourceImportMenu(x, y) {
      var items = [{ head: "Import" }, { label: "Markdown…", onClick: importMarkdownModal }];
      var inbound = pipelineByDirection(pipelineButtons, "import");
      if (inbound.length) items.push({ sep: true });
      inbound.forEach(function (b) { items.push({ label: importMenuLabel(b.label), onClick: b.onClick }); });
      showContextMenu(x, y, items);
    }
    // Product/source lifecycle menu (Source stage). Destructive items are confirm-gated; on delete we
    // reset the active Product + re-render so the stage never points at a document that no longer exists.
    function openProductActionsMenu(pid, x, y) {
      var pname = (window.ProductsStore[pid] && window.ProductsStore[pid].name) || "Product";
      var hasSource = !!sourceMasterFor(pid) || unifiableTopicsFor(pid).length > 0;
      showContextMenu(x, y, [
        { head: pname },
        { label: "Export to Markdown", onClick: function () {
          if (!hasSource) { window.alert("This Product has no source document to export."); return; }
          exportProductSourceMarkdown(pid);
        } },
        { label: "Unlink all courses", onClick: function () {
          var n = unlinkAllCoursesFromProduct(pid);
          window.alert(n ? ("Unlinked " + n + " course" + (n === 1 ? "" : "s") + " from “" + pname + "”.") : "No linked courses to unlink.");
        } },
        { label: "Delete source document", danger: true, onClick: function () {
          if (!hasSource) { window.alert("This Product has no source document to delete."); return; }
          confirmModal("Delete source document?", "Removes the entire continuous document for “" + pname + "” -- every chapter -- and cannot be undone. The Product itself stays.", function () { deleteProductSource(pid); afterProductLifecycleChange(); }, { okLabel: "Delete", danger: true });
        } },
        { sep: true },
        { label: "Delete Product", danger: true, onClick: function () {
          confirmModal("Delete Product?", "Deletes “" + pname + "” entirely -- its source document and its Product tag on any linked course. Cannot be undone.", function () { deleteProduct(pid); afterProductLifecycleChange(); }, { okLabel: "Delete", danger: true });
        } }
      ]);
    }
    // Export a Product's continuous source document to a portable Markdown (.md) file (pilot ask:
    // "this source page should be exportable to .md"). Prefers the persisted unified master doc (it
    // carries the author's edits); falls back to a freshly-concatenated model for a not-yet-unified
    // Product. Serialisation is the pure SourceDoc.toMarkdown; download reuses the Blob idiom.
    function sourceModelForExport(pid) {
      var SD = window.SourceDoc; if (!SD) return null;
      var master = sourceMasterFor(pid);
      // platform-pivot 35: a master whose body has not loaded is NOT an empty one. Falling
      // through to buildUnifiedModelFor here would rebuild the export from the old per-topic
      // content and hand the author a file that silently disagrees with what they see.
      if (master && window.__versoTopicDeferred && window.__versoTopicDeferred(master.id)) return "deferred";
      if (master && master.doc && master.doc.nodes && master.doc.nodes.length) return SD.fromJSON(master.doc);
      return buildUnifiedModelFor(pid);
    }
    function exportProductSourceMarkdown(pid) {
      var SD = window.SourceDoc;
      var model = sourceModelForExport(pid);
      if (model === "deferred") {
        // Fetch it, then run the export the author actually asked for.
        window.__versoHydrateTopic(sourceMasterFor(pid).id).then(function () { exportProductSourceMarkdown(pid); });
        return;
      }
      if (!SD || !model || !model.nodes || !model.nodes.length) { window.alert("This Product has no source document to export."); return; }
      var pname = (window.ProductsStore[pid] && window.ProductsStore[pid].name) || "source";
      var slug = String(pname).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "source";
      var md = SD.toMarkdown(model);
      var blob = new Blob([md], { type: "text/markdown" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = slug + "-source.md";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      if (typeof sourceToast === "function") sourceToast("Exported “" + pname + "” source to Markdown.");
    }
    // After a delete, drop any dangling topic state and re-render the stage. uio-W01: there is no
    // global Product to clear and no picker to rebuild -- the stage re-resolves what it shows on the
    // next render, and the deleted Product's document is simply no longer a candidate. Clearing the
    // remembered document matters, though: it is the FIRST thing activeSourceProductId consults, so
    // leaving it pointing at a deleted Product's master would keep resolving to nothing.
    function afterProductLifecycleChange() {
      __sourceActiveTopicId = null; __sourceDocModel = null; __sourceDocModelTopicId = null;
      __sourceActiveVariants = [];
      try { localStorage.removeItem(SOURCE_TOPIC_PERSIST_KEY); } catch (e) {}
      renderSourceStage();
    }

    // ---- Source v2: the unified-document TOC (unified-toc, spec 2c section 2) ----
    // The active Product's source is ONE document (the reserved master). The left rail shows its
    // whole outline -- chapters (old topics, level-1) with their headings nested -- not a per-topic
    // list. This resolves the Product to show and materialises the one-doc model on first entry.

    // The Source stage's own memory of which document was open, restored across a refresh. It sits
    // here rather than beside renderSourceStage because uio-W01 made it the FIRST thing consulted
    // when resolving what Source shows -- see activeSourceProductId below.
    var SOURCE_TOPIC_PERSIST_KEY = "verso.sourceTopic";

    // WHICH DOCUMENT SOURCE SHOWS (uio-W14).
    //
    // This used to resolve a PRODUCT and let the product name a master, which meant a source
    // document with no product could be created and then never opened again -- there was no path in
    // that did not go through a Product. Glossaries and standards, the material that serves every
    // product precisely because it belongs to none, were unreachable by construction.
    //
    // So the resolution is document-first now. The product is read OFF the document that resolved,
    // not the other way round.
    //
    // Order: the document the author last had open here (persisted under the same key the stage
    // restores from, and it may perfectly well carry no product), then the first product that has
    // any source content, then any shared source document, then whatever product exists so an empty
    // install still lands somewhere real.
    function activeSourceDocId() {
      var comps = libComponents() || {};
      try {
        var lastId = localStorage.getItem(SOURCE_TOPIC_PERSIST_KEY);
        if (lastId && window.SourceOwnership.isSourceDocument(comps[lastId])) return lastId;
      } catch (e) {}
      var keys = Object.keys(window.ProductsStore || {});
      for (var i = 0; i < keys.length; i++) {
        var m = sourceMasterFor(keys[i]);
        if (m) return m.id;
      }
      var shared = window.SourceOwnership.sharedSourceDocuments(comps);
      if (shared.length) return shared[0].id;
      return "";
    }
    // The source document the stage shows, product or not. Null when there is genuinely none.
    function activeSourceMaster() {
      var comps = libComponents() || {};
      var id = activeSourceDocId();
      var c = id && comps[id];
      if (window.SourceOwnership.isSourceDocument(c)) return c;
      return null;
    }
    // The Product whose source the stage shows -- DERIVED from the open document, and "" when that
    // document is shared material. Every product-scoped affordance below (variants, the product
    // actions menu, the lifecycle deletes) reads this and degrades to absent rather than to broken,
    // because a shared document has no product to act on and saying so is the honest answer.
    function activeSourceProductId() {
      var open = activeSourceMaster();
      if (open) return (open.productId && window.ProductsStore[open.productId]) ? open.productId : "";
      // Nothing open yet: fall back to a product that has source content, then to any product, so
      // an empty stage can still offer the onboarding path for one.
      var keys = Object.keys(window.ProductsStore || {});
      for (var i = 0; i < keys.length; i++) {
        if (sourceMasterFor(keys[i]) || unifiableTopicsFor(keys[i]).length) return keys[i];
      }
      return keys[0] || "";
    }
    // Resolve a Product's unified-doc master, migrating on first entry when the Product still has
    // loose topics (the one-doc model is the locked v2 design and the migration is reversible --
    // see migrateProductToUnifiedDoc). Returns the master topic, or null.
    //
    // uio-W14 took the global product out of its name: it takes the product it acts on, so nothing
    // has to have a "the active product" in scope to call it.
    function ensureUnifiedDocFor(productId) {
      if (!productId) return null;
      var master = sourceMasterFor(productId);
      if (!master && unifiableTopicsFor(productId).length) master = migrateProductToUnifiedDoc(productId);
      return master;
    }
    // What the stage opens on: the document that resolved, whether it belongs to a product or is
    // shared. The product path still migrates loose topics on first entry.
    function ensureUnifiedDocForActiveProduct() {
      var open = activeSourceMaster();
      if (open) return open;
      return ensureUnifiedDocFor(activeSourceProductId());
    }
    // Scroll the reading column to a node (a chapter or heading key) -- the TOC's click-to-jump.
    function scrollSourceToNode(key) {
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var target = host.querySelector('[data-node="' + key + '"]');
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    // ---- find-to-word + match cycling (find-word-cycling, spec 2c section 2) ----
    // The TOC search finds every occurrence of the query across the whole document (not just
    // headings). The hits drive a "N matches" count + next/prev cycling that scrolls to and paints
    // each one, and the same hits filter the TOC (a heading stays when it owns a hit). The paint
    // reuses the mounted marks engine's rangeFor (model offset -> live DOM Range) into a dedicated
    // CSS Custom Highlight so it never collides with the alternate/link/comment sets.
    function clearSourceFindHighlight() {
      if (typeof CSS !== "undefined" && CSS.highlights) { var hl = CSS.highlights.get("sd-find"); if (hl) hl.clear(); }
    }
    function paintSourceFindHit(hit) {
      if (!hit || typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
      var hl = CSS.highlights.get("sd-find"); if (!hl) { hl = new Highlight(); CSS.highlights.set("sd-find", hl); }
      hl.clear();
      var eng = __sourceMarksEngine; if (!eng || !eng.rangeFor) return;
      var r = eng.rangeFor({ nodeKey: hit.nodeKey, start: hit.start, len: hit.len });
      if (r) hl.add(r);
    }
    function scrollToSourceFindHit(hit) {
      var host = document.getElementById("source-stage-article"); if (!host || !hit) return;
      var el = host.querySelector('[data-node="' + hit.nodeKey + '"]');
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      syncSourceTocToNode(hit.nodeKey);
      // paint after layout settles so rangeFor reads final text nodes
      requestAnimationFrame(function () { paintSourceFindHit(hit); });
    }
    // Scroll the left TOC to (and mark current) the entry owning a given doc node -- used when a
    // find-jump moves the cursor without a document scroll (the scroll-spy only fires on scroll).
    function syncSourceTocToNode(nodeKey) {
      var rail = document.getElementById("source-topic-list"); if (!rail) return;
      var SD = window.SourceDoc; if (!SD || !SD.headingKeyForNode || !__sourceDocModel) return;
      var key = SD.headingKeyForNode(__sourceDocModel, nodeKey); if (!key) return;
      var rows = Array.prototype.slice.call(rail.querySelectorAll(".source-toc__row[data-toc-key]"));
      rows.forEach(function (it) {
        var on = it.getAttribute("data-toc-key") === key;
        it.classList.toggle("is-current", on);
        it.classList.toggle("is-selected", on);
        if (on) it.scrollIntoView({ block: "nearest" });
      });
    }
    // Step the find cursor by dir (+1 next / -1 prev), wrapping, then scroll+paint + refresh the nav.
    function cycleSourceFind(dir) {
      if (!__sourceFindMatches.length) return;
      __sourceFindIndex = (__sourceFindIndex + dir + __sourceFindMatches.length) % __sourceFindMatches.length;
      scrollToSourceFindHit(__sourceFindMatches[__sourceFindIndex]);
      renderSourceFindNav();
    }
    // The contextual match navigator ("3 / 12" + prev/next), shown only while a query has hits.
    function renderSourceFindNav() {
      var nav = document.getElementById("source-find-nav"); if (!nav) return;
      nav.innerHTML = "";
      var q = __sourceSearchQuery || "", U = window.VersoUI;
      if (!q) { nav.style.display = "none"; return; }
      nav.style.display = "";
      var n = __sourceFindMatches.length;
      var count = h("span", "source-find-nav__count", n ? (__sourceFindIndex + 1) + " / " + n : "No matches");
      nav.appendChild(count);
      if (n && U && U.IconButton) {
        nav.appendChild(U.IconButton({ icon: "chevron-up", label: "Previous match", onClick: function () { cycleSourceFind(-1); } }));
        nav.appendChild(U.IconButton({ icon: "chevron-down", label: "Next match", onClick: function () { cycleSourceFind(1); } }));
      }
    }
    // Chapter drag-reorder on a TOC chapter row: same drop-marker idiom as the topic-row drag it
    // replaces (tree-drop-before/after + clearTreeMarks), but it moves a whole chapter block in the
    // one document via SourceDoc.moveChapter.
    function wireSourceChapterDrag(row, key) {
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", function (e) { __sourceChapterDrag = { key: key }; row.classList.add("is-dragging"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); } catch (_) {} e.stopPropagation(); });
      row.addEventListener("dragend", function () { __sourceChapterDrag = null; row.classList.remove("is-dragging"); clearTreeMarks(); });
      row.addEventListener("dragover", function (e) {
        if (!__sourceChapterDrag || __sourceChapterDrag.key === key) return;
        e.preventDefault(); e.stopPropagation();
        var r = row.getBoundingClientRect();
        row.__after = (e.clientY - r.top) > r.height / 2;
        clearTreeMarks();
        row.classList.add(row.__after ? "tree-drop-after" : "tree-drop-before");
      });
      row.addEventListener("dragleave", function () { row.classList.remove("tree-drop-before", "tree-drop-after"); });
      row.addEventListener("drop", function (e) {
        if (!__sourceChapterDrag) return;
        e.preventDefault(); e.stopPropagation();
        var dragKey = __sourceChapterDrag.key, after = row.__after;
        __sourceChapterDrag = null; clearTreeMarks();
        applySourceChapterMove(dragKey, key, after);
      });
    }
    function applySourceChapterMove(dragKey, refKey, after) {
      var master = ensureUnifiedDocForActiveProduct(); if (!master) return;
      var SD = window.SourceDoc, model = ensureSourceDocModel(master);
      var chs = SD.chapters(model).map(function (c) { return c.key; });
      var refIdx = chs.indexOf(refKey);
      var target = after ? (chs[refIdx + 1] || null) : refKey; // drop-after == "before the next chapter"
      if (SD.moveChapter(model, dragKey, target)) {
        persistSourceDocModel(master, model);
        renderSourceArticle();
        renderSourceTopicList();
      }
    }
    // Render the one-document TOC into the left rail: chapters as top-level TreeItem rows (twirl +
    // heading-count badge), their headings nested one/two levels deep. The search finds every hit
    // across the whole document (find-word-cycling); the TOC narrows to headings that OWN a hit --
    // one mechanism drives the count, the highlight, and this filter. Rows are canonical
    // VersoUI.TreeItem (DSLMS structure/TreeItem).
    function renderSourceUnifiedToc(master) {
      if (typeof document === "undefined") return;
      renderSourceToolbar(null, 0); // one-doc toolbar: import only
      var host = document.getElementById("source-topic-list"); if (!host) return;
      host.innerHTML = "";
      var U = window.VersoUI, SD = window.SourceDoc;
      if (!U || !U.TreeItem || !SD) return;
      var model = ensureSourceDocModel(master);
      var q = __sourceSearchQuery || "";
      // Recompute the live hits (the count/cycle source of truth) and the set of headings that own
      // one: headingKeyForNode of a heading-text hit is that heading itself, so this covers both
      // heading matches and body matches uniformly.
      __sourceFindMatches = q ? SD.findMatches(model, q) : [];
      if (__sourceFindIndex >= __sourceFindMatches.length) __sourceFindIndex = 0;
      var kept = null;
      if (q) { kept = {}; __sourceFindMatches.forEach(function (m) { var hk = SD.headingKeyForNode(model, m.nodeKey); if (hk) kept[hk] = 1; }); }
      function keep(key) { return !q || (kept && kept[key]); }
      var tree = SD.outline(model), rendered = 0;
      // B1: collapse-all / expand-all. One toggle atop the outline -- if any chapter is open it
      // collapses them all, else it re-expands them (clears the per-chapter overrides). Hidden
      // during an active find (the filter force-opens every matching chapter, so it's a no-op).
      var expandableKeys = tree.filter(function (ch) { return (ch.children || []).length > 0; }).map(function (ch) { return ch.key; });
      if (!q && expandableKeys.length && U.IconButton) {
        var anyOpen = expandableKeys.some(function (k) { return __sourceOpenChapters[k] !== false; });
        var collapseBtn = U.IconButton({
          icon: "list-collapse",
          label: anyOpen ? "Collapse all chapters" : "Expand all chapters",
          onClick: function () {
            if (anyOpen) expandableKeys.forEach(function (k) { __sourceOpenChapters[k] = false; });
            else expandableKeys.forEach(function (k) { delete __sourceOpenChapters[k]; });
            renderSourceTopicList();
          }
        });
        // Sit on the SAME row as New topic / Import / Product actions (built by renderSourceToolbar just
        // above) rather than in its own full-width strip atop the tree. Falls back to a strip if the
        // toolbar row isn't there.
        var toolbarRow = document.querySelector("#source-stage-nav-actions .source-stage__toolbar");
        if (toolbarRow) toolbarRow.appendChild(collapseBtn);
        else { var tools = h("div", "source-toc__tools"); tools.appendChild(collapseBtn); host.appendChild(tools); }
      }
      tree.forEach(function (ch) {
        var kids = (ch.children || []).filter(function (k) { return keep(k.key); });
        if (q && !keep(ch.key) && !kids.length) return; // chapter has no hit anywhere -> filtered out
        var open = q ? true : (__sourceOpenChapters[ch.key] !== false); // an active filter force-opens
        var count = (ch.children || []).length;
        var chapterRow = U.TreeItem({
          label: ch.text || "Untitled chapter", depth: 0,
          expandable: count > 0, expanded: open,
          trailing: count ? U.Badge({ children: String(count), tone: "neutral", size: "sm" }) : null,
          onToggle: function () { __sourceOpenChapters[ch.key] = !open; renderSourceTopicList(); },
          onSelect: function () { scrollSourceToNode(ch.key); }
        });
        chapterRow.classList.add("source-toc__row", "source-toc__row--chapter");
        chapterRow.setAttribute("data-toc-key", ch.key);
        chapterRow.title = ch.text || "";
        wireSourceChapterDrag(chapterRow, ch.key);
        host.appendChild(chapterRow); rendered++;
        if (open) kids.forEach(function (k) {
          var kr = U.TreeItem({ label: k.text || "Untitled", depth: (k.level >= 3 ? 2 : 1), onSelect: function () { scrollSourceToNode(k.key); } });
          kr.classList.add("source-toc__row");
          kr.setAttribute("data-toc-key", k.key);
          kr.title = k.text || "";
          host.appendChild(kr); rendered++;
        });
      });
      if (!rendered) host.appendChild(h("div", "source-stage__empty", q ? "No matches." : "This document has no headings yet."));
      renderSourceFindNav();
      updateSourceScrollSpy();
    }

    function renderSourceTopicList() {
      if (typeof document === "undefined") return;
      // Source v2: when the active Product has a unified document, the rail is its one TOC.
      var master = activeSourceMaster();
      if (master) { renderSourceUnifiedToc(master); return; }
      // No unified document for this Product yet (an empty Product) -> the onboarding toolbar
      // (import / new topic) + a plain, click-to-open list of any still-loose topics. The old
      // select / reorder / bulk-move / needs-review machinery is gone with the topic model (cleanup).
      renderSourceToolbar();
      var host = document.getElementById("source-topic-list"); if (!host) return;
      host.innerHTML = "";
      var topics = filterTopics(libComponents(), activeSourceProductId(), __sourceSearchQuery);
      if (!topics.length) {
        host.appendChild(h("div", "source-stage__empty", "No source document yet — import a Markdown file or add a topic to begin."));
        return;
      }
      groupTopicsByProduct(topics, window.ProductsStore || {}).forEach(function (g) {
        host.appendChild(h("div", "source-stage__group-label", g.label));
        g.topics.forEach(function (t) {
          var row = h("div", "source-stage__topic-row" + (t.id === __sourceActiveTopicId ? " is-active" : ""));
          var label = h("button", "source-stage__topic-label", t.name || "Untitled topic");
          label.type = "button";
          label.addEventListener("click", function () {
            if (t.id === __sourceActiveTopicId) return;
            // uio-W10: a source DOCUMENT opens through the strip, so it gets a tab. A loose topic
            // (the pre-unification model) is not a document and keeps the plain in-place swap.
            if (window.SourceOwnership.isSourceDocument(t)) { openSourceDoc(t.id); return; }
            __sourceActiveTopicId = t.id;
            try { localStorage.setItem(SOURCE_TOPIC_PERSIST_KEY, t.id); } catch (e) {} // return to this topic after a refresh
            __sourceActiveVariants = []; // a different topic may have a different variant set
            __sourceEditingCell = null; // don't carry an in-progress edit across topics
            __sourceDocModel = null; __sourceDocModelTopicId = null; // rebind the doc model to the new topic
            __sourceUnlocked = false; // every topic opens locked (base prose protected by default)
            renderSourceTopicList();
            renderSourceArticle();
          });
          row.appendChild(label);
          host.appendChild(row);
        });
      });
    }

    // The Flagship chip (always on, non-interactive) + one VersoUI.ToggleChip per variant
    // declared for the topic's Product -- a MULTI-select toggle row (several variants can
    // be active at once), unlike SegmentedControl's one-of-N. Returns null (append
    // nothing) when the Product has no declared variants at all.
    function buildVariantPillsRow(topic) {
      var declared = declaredVariantsForProduct(window.ProductsStore || {}, topic.productId);
      if (!declared.length) return null;
      var U = window.VersoUI; if (!U || !U.ToggleChip) return null;
      var row = h("div", "source-stage__variant-pills");
      row.appendChild(U.ToggleChip({ label: "Flagship", active: true, disabled: true }));
      declared.forEach(function (v) {
        row.appendChild(U.ToggleChip({
          label: v,
          active: __sourceActiveVariants.indexOf(v) !== -1,
          onClick: function () {
            var idx = __sourceActiveVariants.indexOf(v);
            if (idx === -1) __sourceActiveVariants.push(v); else __sourceActiveVariants.splice(idx, 1);
            renderSourceArticle();
          }
        }));
      });
      return row;
    }
    // spec 2d: the Source-stage variant bar on a Product's unified document -- the column-toggle chips
    // (when variants are declared) plus a "Manage variants" entry that is ALWAYS shown, so you can
    // declare the FIRST variant on a Product that has none yet (the piece that was missing: nothing
    // let you tell a Product its variants, so the whole variant workflow was unreachable).
    function buildSourceVariantBar(topic) {
      if (!topic || !topic.sourceMaster) return null;
      var U = window.VersoUI;
      var bar = h("div", "source-stage__variant-bar");
      var pills = buildVariantPillsRow(topic);
      if (pills) bar.appendChild(pills); else bar.appendChild(h("span", "source-stage__variant-empty", "No variants declared."));
      var manage = (U && U.IconButton) ? U.IconButton({ icon: "layers", label: "Manage variants", onClick: function () { openVariantEditor(topic); } }) : h("button", null, "Variants");
      manage.classList.add("source-stage__variant-manage");
      bar.appendChild(manage);
      return bar;
    }
    // spec 2d: declare/rename/remove the variants a Product's source can carry. Writes the Product's
    // variant list (setProductVariants); a rename also migrates the master document's per-node
    // overrides to the new name (SourceDoc.renameVariant), so a variant's divergences travel with it.
    function openVariantEditor(topic) {
      var U = window.VersoUI, SD = window.SourceDoc;
      var pid = topic.productId || activeSourceProductId();
      var product = pid && window.ProductsStore[pid]; if (!product) return;
      var shell = dsModalShell({
        title: "Variants",
        subtitle: "The variants this Product's source can carry. Each is a column you can compare and a target you can import a variant manual into. Flagship is the base and is always present.",
        primaryLabel: "Done",
        // Commit any name still typed in the add field before closing -- otherwise clicking Done
        // after typing a name (without Enter / the + button) would silently discard it.
        onPrimary: function () { if (addInput && addInput.value.trim()) doAdd(); shell.modal.close(); }
      });
      var box = shell.body;
      function current() { return declaredVariantsForProduct(window.ProductsStore || {}, pid); }
      var listWrap = h("div", "variant-editor__list"); box.appendChild(listWrap);
      function rerender() {
        listWrap.innerHTML = "";
        var vs = current();
        if (!vs.length) { listWrap.appendChild(h("div", "variant-editor__empty", "No variants yet. Add one below.")); return; }
        vs.forEach(function (v) {
          var row = h("div", "variant-editor__row");
          var input = h("input", "prop-text variant-editor__name"); input.type = "text"; input.value = v;
          input.addEventListener("change", function () {
            var nn = input.value.trim(); var list = current();
            if (!nn || nn === v || list.indexOf(nn) !== -1) { input.value = v; return; }
            list[list.indexOf(v)] = nn; setProductVariants(pid, list);
            var model = ensureSourceDocModel(topic); SD.renameVariant(model, v, nn); persistSourceDocModel(topic, model);
            var si = __sourceActiveVariants.indexOf(v); if (si !== -1) __sourceActiveVariants[si] = nn;
            rerender(); renderSourceArticle();
          });
          row.appendChild(input);
          var rm = (U && U.IconButton) ? U.IconButton({ icon: "x", label: "Remove variant", onClick: function () {
            setProductVariants(pid, current().filter(function (x) { return x !== v; }));
            var si = __sourceActiveVariants.indexOf(v); if (si !== -1) __sourceActiveVariants.splice(si, 1);
            rerender(); renderSourceArticle();
          } }) : h("button", null, "Remove");
          rm.classList.add("variant-editor__remove");
          row.appendChild(rm);
          listWrap.appendChild(row);
        });
      }
      rerender();
      var addRow = h("div", "variant-editor__add");
      var addInput = h("input", "prop-text variant-editor__name"); addInput.type = "text"; addInput.placeholder = "New variant name";
      function doAdd() {
        var nn = addInput.value.trim(); if (!nn) return;
        var list = current(); if (list.indexOf(nn) !== -1) { addInput.value = ""; return; }
        list.push(nn); setProductVariants(pid, list); addInput.value = ""; rerender(); renderSourceArticle();
      }
      // stopPropagation, not just preventDefault: dsModalShell binds Enter to the primary button,
      // so without it one Enter both adds the variant AND closes the dialog, and you cannot declare
      // two variants without reopening. Enter in this field means "add"; Done means "finish".
      addInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doAdd(); } });
      var addBtn = (U && U.IconButton) ? U.IconButton({ icon: "plus", label: "Add variant", onClick: doAdd }) : h("button", null, "Add");
      addRow.appendChild(addInput); addRow.appendChild(addBtn);
      box.appendChild(addRow);
    }

    // Product Rail (source-topic-content-authoring): the facets object to read/write for
    // a given column -- Flagship writes straight onto the section; a variant column
    // writes into its (already-diverged, by the time this is called) override.
    function facetsRefFor(sec, variant) {
      if (variant == null) { sec.facets = sec.facets || {}; return sec.facets; }
      sec.overrides = sec.overrides || {};
      sec.overrides[variant] = sec.overrides[variant] || { facets: {} };
      sec.overrides[variant].facets = sec.overrides[variant].facets || {};
      return sec.overrides[variant].facets;
    }
    function stampTopicUpdated(topic) { topic.updatedAt = Date.now(); saveLibrary(); }

    // Drag state for the section grip handle (source-stage-section-disclosure) -- only the
    // handle itself is draggable=true (the section box holds an editable heading input and
    // body text, so making the whole box draggable would fight text selection); the
    // surrounding .source-stage__section box is the drop target. Same shape as the
    // outliner's `treeDrag` (editor.js ~16310), reusing its drop-marker classes.
    var __sourceSectionDrag = null; // { id } | null
    // Which single (section, variant) body cell is currently in edit mode -- click a
    // rendered body to swap it for a real contentEditable surface (seeded with the SAME
    // MarkdownLite.render() HTML the view shows, so entering edit mode never flashes raw
    // ** markers); blur commits + swaps back. Everything else keeps reading as normal
    // MarkdownLite output, so browsing a topic never shows raw markdown -- only the one
    // cell an author is actively typing into, and even that cell reads as formatted text.
    var __sourceEditingCell = null; // { sectionId, variant } | null

    // (#92) buildSourceEditToolbar is retired: the legacy per-cell Bold/code/bullet toolbar it built
    // was superseded by the continuous-doc rewrite's floating selection bar (buildSourceSelBar), which
    // owns Source-stage formatting now. It had no remaining callers, so the format-toolbar duplication
    // #92 flagged is gone -- one live inspector-style bar (buildFormatToggleBar) + the Source selbar,
    // which are deliberately different idioms.
    // Commits an edited cell's contentEditable content back to markdown-lite text. Guards
    // against a purely cosmetic open/close (click in, click away, nothing typed) ever
    // rewriting the stored string: some of render()'s own behaviour is lossy in one
    // direction (e.g. a multi-line paragraph with no blank-line separators collapses its
    // newlines to spaces), so a naive round-trip of UNCHANGED content could still come out
    // textually different from the original -- which would falsely look like an edit to
    // the re-import reconcile system (#87/#88's lastImportedText comparisons). Comparing
    // against a re-serialize of the OLD text's own rendered form (not the old text
    // itself) means "no real edit happened" is judged the same lossy way render() itself
    // already behaves, so it never fires on a no-op.
    function commitEditableCell(topic, sec, variant, editEl) {
      var ref = facetsRefFor(sec, variant);
      var oldText = ref[__sourceActiveFacet] || "";
      var newText = window.MarkdownLite.serialize(editEl);
      var probe = document.createElement("div");
      probe.innerHTML = window.MarkdownLite.render(oldText);
      var normalizedOld = window.MarkdownLite.serialize(probe);
      if (newText !== normalizedOld) {
        ref[__sourceActiveFacet] = newText;
        stampTopicUpdated(topic);
      }
    }

    // md-topic-import: lets the author compare their current (Flagship) text against a
    // re-imported source's version once reconcileSection has flagged a real conflict, and
    // pick a side -- "Use updated text" applies the source's version (and clears the flag);
    // "Keep mine" dismisses the flag without changing anything; Cancel leaves it pending.
    function openSourceUpdateModal(topic, sec) {
      var shell = dsModalShell({
        title: "Source updated",
        subtitle: (sec.heading || "This section") + " changed both here and in the re-imported source since the last import.",
        primaryLabel: "Use updated text",
        extras: window.VersoUI ? [window.VersoUI.Button({
          variant: "secondary", label: "Keep mine",
          onClick: function () { delete sec.sourceUpdate; stampTopicUpdated(topic); shell.modal.close(); renderSourceArticle(); }
        })] : [],
        onPrimary: function () {
          sec.facets.technical = sec.sourceUpdate.text;
          sec.lastImportedText = sec.sourceUpdate.text;
          delete sec.sourceUpdate;
          stampTopicUpdated(topic);
          shell.modal.close();
          renderSourceArticle();
        }
      });
      // product-rail-review-diff: a real line-level diff (LineDiff, classic LCS) instead of
      // two flat side-by-side blocks -- removed lines (your text) and added lines (the
      // source's) are visually distinguished so the actual change is legible at a glance.
      var diffBody = modalSection(shell.body, "What changed");
      var diffBlock = h("div", "source-stage__diff-block");
      var ops = window.LineDiff ? window.LineDiff.diff(sec.facets.technical || "", sec.sourceUpdate.text || "") : [];
      ops.forEach(function (op) {
        var prefix = op.type === "removed" ? "− " : op.type === "added" ? "+ " : "  ";
        diffBlock.appendChild(h("div", "source-stage__diff-line source-stage__diff-line--" + op.type, prefix + op.text));
      });
      diffBody.appendChild(diffBlock);
    }

    // source-stage-comments: the same feedback/discussion system the canvas editor already
    // has (makeComment/makeReply, comment-popover/comment-thread/comment-row CSS), ported
    // to Source stage. Storage lives on the topic itself (topic.comments), not doc.comments
    // -- Product Rail topics are library content (window.LibraryStore), not part of any
    // course doc. Anchor is section-scoped ({sectionId}, no dx/dy/pageId -- there's no
    // canvas/zoom here to project a pixel position from). No floating pin/popover either:
    // Source stage never uses floating overlays anywhere (the flag pill, diverge row,
    // variant pills are all plain inline siblings, full-rerender on every state change) --
    // an inline expand/collapse thread panel matches that established convention, not the
    // canvas's own (structurally different: infinite pan/zoom needs a pin anchored in
    // screen space; a normal scrolling document doesn't).
    var __sourceOpenCommentSectionId = null; // which section's thread panel is expanded, or null

    // One comment's rendered row: the SAME .comment-reply/.comment-row__dot/.comment-
    // popover__row/.comment-popover__del classes the canvas comment system already
    // defines in editor.css (plain flex rows, nothing canvas/position-specific), reused
    // verbatim rather than styled twice.
    // opts.onChange (optional): fired after any mutation (resolve/delete/reply) so a mark-anchored
    // thread can log the event to History + refresh its pinned card, instead of the default section
    // path's full renderSourceArticle. Defaults to renderSourceArticle when omitted (the #94 path).
    function buildSourceCommentItem(topic, c, opts) {
      var UI = window.VersoUI;
      var after = (opts && opts.onChange) || function () { stampTopicUpdated(topic); renderSourceArticle(); };
      var item = h("div", "source-stage__comment-item");
      var line = h("div", "comment-reply");
      var dot = h("span", "comment-row__dot"); dot.style.background = c.colour || "";
      var body = h("span", "comment-reply__body");
      body.textContent = (c.author ? c.author + ": " : "") + (c.body || "");
      line.appendChild(dot); line.appendChild(body);
      item.appendChild(line);
      var row = h("div", "comment-popover__row");
      if (UI && UI.Checkbox) {
        var doneCheck = UI.Checkbox({
          checked: !!c.done, label: "Resolved",
          onChange: function (v) { c.done = v; after("resolve", c); }
        });
        row.appendChild(doneCheck);
      }
      var del = h("button", "comment-popover__del", "Delete");
      del.addEventListener("click", function () {
        var i = (topic.comments || []).indexOf(c);
        if (i !== -1) topic.comments.splice(i, 1);
        after("delete", c);
      });
      row.appendChild(del);
      item.appendChild(row);
      (c.replies || []).forEach(function (rp) {
        var rl = h("div", "comment-reply");
        var rd = h("span", "comment-row__dot"); rd.style.background = rp.colour || "";
        var rb = h("span", "comment-reply__body"); rb.textContent = (rp.author ? rp.author + ": " : "") + (rp.body || "");
        rl.appendChild(rd); rl.appendChild(rb); item.appendChild(rl);
      });
      if (UI && UI.TextField && UI.Button) {
        var replyField = UI.TextField({ value: "", placeholder: "Reply…" });
        replyField.classList.add("comment-reply__input");
        var replyBtn = UI.Button({
          variant: "secondary", label: "Reply",
          onClick: function () {
            var v = (replyField.input.value || "").trim(); if (!v) return;
            c.replies = c.replies || []; c.replies.push(makeReply(v));
            after("reply", c);
          }
        });
        item.appendChild(replyField); item.appendChild(replyBtn);
      }
      return item;
    }
    // The expanded thread panel for one section: every comment anchored to it, then a
    // fresh "Add a comment" field at the bottom.
    function buildSourceCommentPanel(topic, sec) {
      var UI = window.VersoUI;
      var panel = h("div", "comment-thread source-stage__comment-panel");
      sourceCommentsForSection(topic, sec.id).forEach(function (c) { panel.appendChild(buildSourceCommentItem(topic, c)); });
      if (UI && UI.TextField && UI.Button) {
        var newField = UI.TextField({ multiline: true, rows: 2, value: "", placeholder: "Add a comment…" });
        newField.classList.add("comment-popover__body");
        var addBtn = UI.Button({
          variant: "primary", label: "Comment",
          onClick: function () {
            var v = (newField.input.value || "").trim(); if (!v) return;
            topic.comments = topic.comments || [];
            topic.comments.push(makeComment({ sectionId: sec.id }, v));
            stampTopicUpdated(topic); renderSourceArticle();
          }
        });
        panel.appendChild(newField); panel.appendChild(addBtn);
      }
      return panel;
    }

    function renderSourceArticle() {
      if (typeof document === "undefined") return;
      var host = document.getElementById("source-stage-article"); if (!host) return;
      host.innerHTML = "";
      var topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      // the all-marks drawer belongs to the continuous-document view only -- drop it when the
      // active topic isn't a doc topic (the doc path re-syncs it against the live model below).
      if (!(topic && topicHasDoc(topic))) { __sourceActiveMarkId = null; closeSourceAltPanel(); closeSourceWherePanel(); closeSourceCommentThread(); }
      if (!topic || topic.kind !== "topic") {
        host.appendChild(h("div", "source-stage__empty", "Select a topic to read it."));
        renderSourceInfoPanel(null);
        return;
      }
      var headEl = h("div", "source-stage__article-head");
      var titleInput = h("input", "source-stage__title source-stage__title-input");
      titleInput.type = "text"; titleInput.value = topic.name || "";
      titleInput.placeholder = "Untitled topic";
      titleInput.addEventListener("change", function () {
        topic.name = titleInput.value.trim();
        stampTopicUpdated(topic);
        renderSourceTopicList(); // the left-nav row label must stay in sync
      });
      headEl.appendChild(titleInput);
      headEl.appendChild(renderSourceProvenanceLine(topic)); // provenance pinned under the header
      headEl.appendChild(renderSourceFactsStrip(topic));     // uio-F04 (SRC-12): downstream consequence

      // Section-cells RETIRED (superseded by the continuous document): every topic now uses the
      // continuous node-model article (lock + toolbars + marks). A legacy section topic auto-converts
      // on open -- lossless, the section model only carried base prose in practice. An empty topic
      // seeds one editable paragraph so it's never a dead, uneditable page.
      if (!topicHasDoc(topic) && window.SourceDoc) {
        var _m = window.SourceDoc.fromSections(topic, resolveTopicBaseText);
        if (!_m.nodes.length) _m = window.SourceDoc.create([{ type: "paragraph", text: "" }]);
        topic.doc = window.SourceDoc.toJSON(_m);
        __sourceDocModel = null; __sourceDocModelTopicId = null;
        stampTopicUpdated(topic);
      }
      host.appendChild(headEl);
      renderSourceNodeArticle(topic, host);
      renderSourceInfoPanel(topic);
      return;
    }

    // Product Rail (source-stage-info-panel): "Linked in" (where-used, jumps to the
    // referencing document -- Epic 4's lock/fork tickets are what will ever populate
    // this list; the panel + its empty state are correct before that data exists) +
    // "History" (created/last-updated, reusing the same relative-time formatter recents
    // already uses). Reuses the canonical panelSection() helper, not a one-off block --
    // this is a plain info panel, not a block-inspector taxonomy section (sectionGroup's
    // TAXONOMY/reorder system is specific to that surface, not this one).
    // The ONE consolidated right panel (Source v2, spec 2c section 3). It replaces the old pair --
    // an always-on info aside PLUS an overlay all-marks drawer that stacked on top of it (the
    // "double-up") -- with a single panel of canonical sections in navigator order: Marks (the mark
    // navigator, folded in from the drawer) / History / Source (provenance + where-used) / Comments.
    // Resolve a topic's imported-source stamp. A unified master built from imported topics may carry no
    // own stamp (older migrations) -- inherit it from an imported constituent (archivedInto === master.id).
    function resolveTopicSource(topic) {
      if (!topic) return null;
      if (topic.source) return topic.source;
      if (topic.sourceMaster) {
        var comps = libComponents(), ids = Object.keys(comps);
        for (var i = 0; i < ids.length; i++) { var t = comps[ids[i]]; if (t && t.archivedInto === topic.id && t.source) return t.source; }
      }
      return null;
    }
    // The provenance line shown UNDER the document header (moved out of the sidebar): where this doc
    // came from (imported file + version/date), or that it was authored in Verso. Sets the reader's
    // expectation up front.
    function renderSourceProvenanceLine(topic) {
      var src = resolveTopicSource(topic);
      var el = h("div", "source-stage__provenance");
      if (src) {
        var meta = [src.version, src.publishDate].filter(Boolean).join(" · ");
        el.textContent = "Imported from " + (src.file || "an unknown file") + (meta ? " · " + meta : "");
      } else {
        el.textContent = "Authored in Verso";
        el.classList.add("is-authored");
      }
      return el;
    }
    // uio-F04 (SRC-12): the Source stage never said what depends on the document being edited. This
    // quiet strip sits under the title and states it: how far the Product's documents run on approved
    // source, how many of them are behind THIS topic, where this topic is used, and how many packages
    // the Product actually ships. Every number comes from f04ProductFacts -- the same resolver the
    // Publish rows read -- so with one document in the Product the alignment badge here and the
    // alignment badge on that document's Publish row are literally the same number.
    function renderSourceFactsStrip(topic) {
      var strip = h("div", "source-stage__facts");
      var pid = activeSourceProductId();
      var facts = f04ProductFacts(pid, topic && topic.id);
      var docCount = facts.docIds.length;
      var align = facts.alignment;
      var alignEl = f04Badge(align, "source-stage__fact");
      if (alignEl) {
        // Scope stated in the tooltip AND beside the badge: this is a Product roll-up, not one
        // document's score, and nobody should have to guess which.
        alignEl.title = align.title + " Across " + docCount + " document" + (docCount === 1 ? "" : "s") + " in this Product.";
        strip.appendChild(alignEl);
        strip.appendChild(h("span", "source-stage__fact-scope", docCount + " document" + (docCount === 1 ? "" : "s")));
      }
      [facts.whereUsed ? f04Badge(facts.whereUsed, "source-stage__fact") : null,
       f04Badge(facts.behind, "source-stage__fact"),
       facts.outputs.count > docCount ? f04Badge(facts.outputs, "source-stage__fact") : null
      ].forEach(function (b) { if (b) strip.appendChild(b); });
      return strip;
    }
    function renderSourceInfoPanel(topic) {
      if (typeof document === "undefined") return;
      var host = document.getElementById("source-stage-info"); if (!host) return;
      host.innerHTML = "";
      if (!topic) return;
      // Marks -- the navigator, first (only when the topic is a continuous document with a live model).
      // For a doc topic this section owns the Linked (where-used) + Comments tabs, so the old
      // standalone Source "Linked in" block and the duplicate comments accordion are retired here --
      // each mark type now appears in exactly one place (source-right-panel-consolidation parts 2-3).
      var hasDoc = topicHasDoc(topic);
      if (hasDoc) renderSourceMarksSection(host, ensureSourceDocModel(topic));
      // History
      renderHistoryTimeline(host, topic);
      // Legacy section topics have no marks tabs -- keep their standalone Linked-in list. Comments are
      // NOT re-rendered here: they already live in the Marks section's Comments tab, so a second
      // standalone accordion just duplicated them (#163). The Comments tab is now their only home.
      if (!hasDoc) {
        var sourceBody = panelSection(host, "Source", { collapsible: true });
        var used = libraryWhereUsedDetail(topic.id, getRegistry());
        sourceBody.appendChild(h("div", "source-info__subhead", "Linked in (" + used.length + ")"));
        if (!used.length) {
          sourceBody.appendChild(h("div", "insp-hint", "Not currently linked in any document."));
        } else {
          used.forEach(function (u) {
            var row = h("button", "source-stage__linked-row", u.docTitle);
            row.type = "button";
            row.title = "Open " + u.docTitle + " and select the linked block";
            row.addEventListener("click", function () { jumpToLinkedBlock(u.docCode, u.blockId); });
            sourceBody.appendChild(row);
          });
        }
      }
      applySourceInfoVisibility();
    }
    // Show or hide the one consolidated panel (its single doc-bar toggle). Hidden -> the reading
    // column reclaims the width; shown (default) -> the panel docks at the right as before.
    function applySourceInfoVisibility() {
      var el = document.getElementById("source-stage-info"); if (!el) return;
      el.style.display = __sourceInfoOpen ? "" : "none";
    }
    // Structural History events (comment/alternate added, resolved, reopened) log to model.history,
    // but the info-panel History timeline must be RE-RENDERED to show them. Only the prose-commit
    // path did that, so structural events never surfaced until an unrelated re-render (bug #109).
    // Call this after any structural event persists.
    function refreshSourceHistory(topic) {
      var t = topic || (__sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null);
      if (t && typeof document !== "undefined" && document.getElementById("source-stage-info")) renderSourceInfoPanel(t);
    }

    // ==== Source rewrite (Epic 2b): continuous-document article + two-layer lock + toolbars ====
    // The node-model article. Coexists with the legacy section article (above): a topic renders
    // this once it carries a `doc`. render()/mount() stay pure -- topic.doc is data on the topic,
    // the live model is cached, and edits round-trip through applyTextEdit -> topic.doc.
    function topicHasDoc(topic) { return !!(topic && topic.doc && topic.doc.nodes && topic.doc.nodes.length); }
    function resolveTopicBaseText(sec) { return resolveSectionFacetText(sec, "technical"); }
    function convertTopicToDoc(topic) {
      if (!window.SourceDoc) return;
      var model = window.SourceDoc.fromSections(topic, resolveTopicBaseText);
      topic.doc = window.SourceDoc.toJSON(model);
      __sourceDocModel = null; __sourceDocModelTopicId = null; // force a fresh model bind
      stampTopicUpdated(topic);
      renderSourceArticle();
    }
    function revertTopicDoc(topic) {
      if (topic) { delete topic.doc; stampTopicUpdated(topic); }
      __sourceDocModel = null; __sourceDocModelTopicId = null;
      renderSourceArticle();
    }
    // The live model for a topic, cached so its owned undo stack persists across the article's
    // frequent full re-renders. Rebuilt from topic.doc whenever the active topic changes.
    function ensureSourceDocModel(topic) {
      if (__sourceDocModel && __sourceDocModelTopicId === topic.id) return __sourceDocModel;
      __sourceDocModel = window.SourceDoc.fromJSON(topic.doc);
      __sourceDocModelTopicId = topic.id;
      return __sourceDocModel;
    }
    function persistSourceDocModel(topic, model) {
      topic.doc = window.SourceDoc.toJSON(model);
      stampTopicUpdated(topic);
    }

    // Project one node to its DOM block, keyed by node.key. Text blocks (heading/paragraph/callout)
    // are contentEditable so the base prose can be edited when unlocked; structural blocks (list/
    // table/image) render for reading in v1 (cell/list editing is fast-follow, spec 6) but still
    // carry marks. Marks paint over whatever text these blocks contain via the engine.
    /* @pure-imgwidth-start */
    // A1 (source image resize): width is stored as node.imgWidth = % of the column, so render
    // is pure (editor == export). Blank/>=100 = full width. These two helpers are the pure core
    // exercised by tests/run.js.
    function clampSourceImgWidth(w) {
      w = parseFloat(w);
      if (isNaN(w)) return 100;
      return Math.max(20, Math.min(100, w));
    }
    // Free-drag with a light magnetic snap at 25/50/75/100% (within ~4% of a stop).
    function snapSourceImgWidth(pct) {
      var stops = [25, 50, 75, 100];
      for (var i = 0; i < stops.length; i++) { if (Math.abs(pct - stops[i]) <= 4) return stops[i]; }
      return Math.round(pct);
    }
    // A2 (source image align): align stored as node.align; centre is the default (no style, so a
    // full-width image reads the same either way). Returns "left"/"right" to apply, or "" for centred.
    function sourceImgAlign(node) {
      var a = node && node.align;
      return (a === "left" || a === "right") ? a : "";
    }
    /* @pure-imgwidth-end */

    // Fill an element with text, wrapping inline-format runs (from Markdown import) in transparent
    // <strong>/<em>/<code>. The wrappers do NOT change the element's text content or length, so the
    // mark engine (which walks text nodes by character offset) still lines up on the plain model text.
    function fillSourceInline(el, text, runs) {
      text = String(text == null ? "" : text);
      // An empty text block generates no line box in the contentEditable article, so it has zero height
      // and is invisible -- an Enter at the end of a line splits off an empty paragraph that "vanishes"
      // (History still logs the split). A trailing <br> gives the empty block a line to sit on.
      if (!text) { el.appendChild(document.createElement("br")); return; }
      if (!runs || !runs.length) { el.textContent = text; return; }
      var sorted = runs.slice().sort(function (a, b) { return a.start - b.start; });
      var pos = 0;
      sorted.forEach(function (r) {
        if (!r || r.start < pos || r.start > text.length) return; // defensive: skip overlaps / stale runs
        if (r.start > pos) el.appendChild(document.createTextNode(text.slice(pos, r.start)));
        var tag = r.style === "bold" ? "strong" : r.style === "italic" ? "em" : "code";
        var span = document.createElement(tag);
        span.textContent = text.slice(r.start, r.start + r.len);
        el.appendChild(span); pos = r.start + r.len;
      });
      if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
    }
    function renderSourceDocNode(node) {
      var SD = window.SourceDoc, el;
      // level-aware so the selbar's H1/H2 read distinctly (source-selbar-block-formats): level 1 -> h1
      // (also chapter headings, the top structure), level 2 -> h2, level 3 -> h3.
      if (node.type === "heading") { el = h(node.level === 1 ? "h1" : node.level === 3 ? "h3" : "h2", "source-doc__h"); fillSourceInline(el, SD.nodeText(node), node.formats); el.setAttribute("data-editable", "1"); }
      else if (node.type === "callout") { el = h("div", "source-doc__callout"); if (node.tag) el.appendChild(h("div", "source-doc__callout-tag", node.tag)); var cb = h("div", "source-doc__callout-body"); fillSourceInline(cb, SD.nodeText(node), node.formats); cb.setAttribute("data-node-body", "1"); el.appendChild(cb); }
      else if (node.type === "list") { el = h(node.ordered ? "ol" : "ul", "source-doc__list"); if (node.ordered && node.start && node.start !== 1) el.setAttribute("start", node.start); (node.items || []).forEach(function (it, ix) { var liEl = h("li"); fillSourceInline(liEl, it, node.itemFormats && node.itemFormats[ix]); el.appendChild(liEl); }); }
      else if (node.type === "table") { el = h("table", "source-doc__table"); (node.rows || []).forEach(function (row, ri) { var tr = h("tr"); (row || []).forEach(function (c, ci) { var td = h("td"); fillSourceInline(td, c, node.cellFormats && node.cellFormats[ri] && node.cellFormats[ri][ci]); tr.appendChild(td); }); el.appendChild(tr); }); }
      else if (node.type === "row") {
        // A3: a row lays its image children side by side. Each child renders through the normal path
        // so it keeps its own key (marks stay attached), its width (A1) and its align chrome.
        el = h("div", "source-doc__row");
        (node.children || []).forEach(function (ch) { el.appendChild(renderSourceDocNode(ch)); });
      }
      else if (node.type === "image") {
        // A1: the image sits inside a sized wrap so the L/R resize handles pin to the image edges
        // (not the full-width figure). Width = node.imgWidth % of the column, applied purely.
        el = h("figure", "source-doc__figure");
        var wrap = h("span", "source-doc__imgwrap");
        var im = h("img"); if (node.src) im.src = node.src; if (node.alt) im.alt = node.alt;
        var iw = clampSourceImgWidth(node.imgWidth == null ? 100 : node.imgWidth);
        if (iw < 100) wrap.style.width = iw + "%";
        wrap.appendChild(im);
        wrap.appendChild(h("span", "source-doc__handle source-doc__handle--l"));
        wrap.appendChild(h("span", "source-doc__handle source-doc__handle--r"));
        el.appendChild(wrap);
        if (node.caption) el.appendChild(h("figcaption", null, node.caption));
        var al = sourceImgAlign(node); if (al) el.style.textAlign = al; // A2: centre is the default
      }
      else { el = h("p", "source-doc__p"); fillSourceInline(el, SD.nodeText(node), node.formats); el.setAttribute("data-editable", "1"); }
      el.setAttribute("data-node", node.key);
      // image/table = a first-class markable OBJECT (a node-id mark, no text span). Tag it so a
      // click selects the whole node and offers the same alternate/comment actions as a text span.
      if (SD.isMarkableObjectNode && SD.isMarkableObjectNode(node)) { el.classList.add("source-doc__obj"); el.setAttribute("data-object", "1"); }
      return el;
    }

    // spec 2d: render one node as a variant comparison. A node all shown variants agree on renders as
    // a single shared block (its normal element); a node that diverges splits into one column per shown
    // variant, each drawing its own wording or an explicit "not in this variant" state. Read-oriented.
    function renderSourceDocNodeColumns(topic, node, shown) {
      var SD = window.SourceDoc;
      if (node.type === "image") return renderSourceImageColumns(topic, node, shown); // B2
      var view = SD.variantView(node, shown);
      if (view.mode === "shared") { var el = renderSourceDocNode(node); el.classList.add("source-doc__shared"); return el; }
      var row = h("div", "source-doc__vrow"); row.setAttribute("data-node", node.key);
      view.cols.forEach(function (c) {
        var cell = h("div", "source-doc__vcol" + (c.diverged ? " is-diverged" : "") + (!c.present ? " is-absent" : ""));
        cell.appendChild(h("div", "source-doc__vcol-head", c.variant));
        if (!c.present) cell.appendChild(h("div", "source-doc__vcol-absent", "Not in this variant"));
        else { var body = h("div", "source-doc__vcol-body"); body.textContent = c.text; cell.appendChild(body); }
        row.appendChild(cell);
      });
      return row;
    }
    // B2: an image node compared across variants -- each column shows that variant's picture (its own
    // src override, or the inherited Flagship one), or "Not in this variant". Unlike text (read-only in
    // the columns view), an image is swappable per column: a Swap button picks a new file for JUST that
    // variant, and a named variant can be removed/restored -- a discrete object action, not free-text
    // editing that would fight contentEditable. Columns collapse to one shared image when they agree.
    function renderSourceImageColumns(topic, node, shown) {
      var SD = window.SourceDoc;
      var cols = shown.map(function (v) { var r = SD.imageForVariant(node, v); r.variant = v; return r; });
      var first = cols[0];
      var allSame = cols.every(function (c) { return c.present === first.present && c.src === first.src; });
      if (allSame && first.present) { var el = renderSourceDocNode(node); el.classList.add("source-doc__shared"); return el; }
      var row = h("div", "source-doc__vrow"); row.setAttribute("data-node", node.key);
      cols.forEach(function (c) {
        var isFlag = SD.isFlagship(c.variant);
        var cell = h("div", "source-doc__vcol" + (c.source === "override" ? " is-diverged" : "") + (!c.present ? " is-absent" : ""));
        cell.appendChild(h("div", "source-doc__vcol-head", c.variant));
        var acts = h("div", "source-vcol__imgacts");
        function imgBtn(icon, title, fn) { var b = h("button", "source-vcol__imgbtn"); b.type = "button"; b.title = title; b.innerHTML = window.Icon ? window.Icon(icon) : ""; b.addEventListener("click", fn); return b; }
        if (!c.present) {
          cell.appendChild(h("div", "source-doc__vcol-absent", "Not in this variant"));
          acts.appendChild(imgBtn("plus", "Add an image for " + c.variant, function () { pickImageForVariant(topic, node.key, c.variant); }));
        } else {
          var fig = h("figure", "source-doc__figure source-doc__vcol-fig");
          var wrap = h("span", "source-doc__imgwrap");
          var im = h("img"); if (c.src) im.src = c.src; if (c.alt) im.alt = c.alt;
          var iw = clampSourceImgWidth(node.imgWidth == null ? 100 : node.imgWidth); if (iw < 100) wrap.style.width = iw + "%";
          wrap.appendChild(im); fig.appendChild(wrap);
          if (c.caption) fig.appendChild(h("figcaption", null, c.caption));
          cell.appendChild(fig);
          acts.appendChild(imgBtn("image", isFlag ? "Replace the base image" : "Swap image for " + c.variant, function () { pickImageForVariant(topic, node.key, c.variant); }));
          if (!isFlag) acts.appendChild(imgBtn("eye-off", "Hide in " + c.variant, function () { SD.removeNodeFromVariant(__sourceDocModel, node.key, c.variant); persistSourceDocModel(topic, __sourceDocModel); renderSourceArticle(); }));
          else if (c.source === "override") { /* Flagship always present */ }
        }
        cell.appendChild(acts);
        row.appendChild(cell);
      });
      return row;
    }
    // B2: pick a file and set it as the image for one variant (Flagship replaces the base). Stored as a
    // data-URI inline (the Source doc is never SCORM-exported -- same as insertSourceImage). Unlocked.
    function pickImageForVariant(topic, nodeKey, variant) {
      if (!__sourceUnlocked) { sourceToast("Unlock the source to change a variant's image."); return; }
      var inp = h("input"); inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          window.SourceDoc.setVariantImage(__sourceDocModel, nodeKey, variant, rd.result, { alt: String(f.name || "image").replace(/\.[^.]+$/, "") });
          persistSourceDocModel(topic, __sourceDocModel);
          renderSourceArticle();
          sourceToast(window.SourceDoc.isFlagship(variant) ? "Base image replaced." : "Image set for " + variant + ".");
        };
        rd.readAsDataURL(f);
      });
      inp.click();
    }

    function renderSourceNodeArticle(topic, host) {
      var SD = window.SourceDoc, SM = window.SourceMarks;
      var model = ensureSourceDocModel(topic);
      var layout = h("div", "source-doc__layout");
      // Source v2: the unified document's outline lives in the LEFT rail (renderSourceUnifiedToc),
      // so the in-article sticky rail is dropped for a source master -- no double-TOC. A legacy
      // section topic (fallback path) keeps its own in-article outline.
      var toc = topic.sourceMaster ? null : buildSourceToc(model, host);
      if (toc) layout.appendChild(toc);
      var col = h("div", "source-doc__col");
      // spec 2d: on a variant-bearing Product, a chip row picks which variants are shown as columns.
      // Flagship-only (no chips active) reads exactly as before; turning a variant on splits the
      // diverged nodes into columns. The column view is a read-oriented comparison (no inline edit yet).
      if (topic.sourceMaster) { var vbar = buildSourceVariantBar(topic); if (vbar) col.appendChild(vbar); }
      var showCols = topic.sourceMaster && __sourceActiveVariants.length > 0;
      // /verso-frontend fix: make the editable->read-only mode switch legible when comparing variants.
      if (showCols) col.appendChild(h("div", "source-doc__cols-hint", "Comparing variants — read-only. Turn variants off to edit."));
      var art = h("article", "source-doc" + (showCols ? " source-doc--cols" : "")); art.setAttribute("spellcheck", "false");
      if (showCols) {
        var shown = [SD.FLAGSHIP].concat(__sourceActiveVariants);
        model.nodes.forEach(function (n) { art.appendChild(renderSourceDocNodeColumns(topic, n, shown)); });
      } else {
        model.nodes.forEach(function (n) { art.appendChild(renderSourceDocNode(n)); });
      }
      col.appendChild(art);
      layout.appendChild(col);
      host.appendChild(layout);
      // scroll-spy + alt-panel tracking: re-bound each render (host survives innerHTML clears).
      host.removeEventListener("scroll", onSourceArticleScroll);
      host.addEventListener("scroll", onSourceArticleScroll);
      requestAnimationFrame(updateSourceScrollSpy);

      // Column comparison is read-only: skip the marks engine + editing wiring (they operate on the
      // Flagship base text, which the split columns don't project). Toggle every variant off to edit.
      if (showCols) return;

      // per-block contentEditable when unlocked; the keydown guard (below) enforces the lock so
      // marks stay clickable + annotation stays live even when locked.
      applySourceLockState(art);

      __sourceMarksEngine = SM.create({ root: art, model: model });
      repaintSourceMarks();
      wireSourceImageResize(topic, art, model);

      // A cross-paragraph edit (typing/deleting over a selection that spans blocks, or a Backspace/Delete
      // that would merge two paragraphs) can't be left to the browser -- with one editing host it would
      // mangle the block DOM. Intercept those before the input lands and route them through the model
      // (SourceDoc.replaceRange), which merges + removes blocks and re-anchors marks. Single-block edits
      // fall through to native editing + the input reconcile below.
      art.addEventListener("beforeinput", function (e) {
        if (!__sourceUnlocked) return; // locked: the keydown guard already refuses edits
        var it = e.inputType || "";
        if (it === "insertParagraph" || it === "insertLineBreak") {
          // Enter splits the current block into a new paragraph THROUGH the model (a single editing
          // host over discrete blocks can't be left to the browser). Collapsed caret only; a rare
          // Enter over a multi-char selection is left as a no-op (delete then press Enter).
          e.preventDefault();
          var selP = window.getSelection();
          if (!selP || !selP.isCollapsed || !selP.focusNode) return;
          var blk = selP.focusNode.nodeType === 3 ? selP.focusNode.parentNode : selP.focusNode;
          blk = blk && blk.closest ? blk.closest("[data-node]") : null;
          if (!blk) return;
          var off = sourceCaretOffsetIn(blk, selP.focusNode, selP.focusOffset);
          afterSourceStructuralEdit(topic, model, SD.splitNode(model, blk.getAttribute("data-node"), off));
          return;
        }
        var isDelete = it.indexOf("delete") === 0;
        var isInsert = it === "insertText" || it === "insertReplacementText" || it === "insertFromPaste";
        if (!isDelete && !isInsert) return;
        var anchor = __sourceMarksEngine && __sourceMarksEngine.selectionAnchor();
        // (A) an edit replacing a MULTI-BLOCK selection
        if (anchor && anchor.endAnchor) {
          e.preventDefault();
          var ins = isDelete ? "" : (e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData("text/plain") : ""));
          afterSourceStructuralEdit(topic, model, SD.replaceRange(model, anchor, ins));
          return;
        }
        // (B) a collapsed caret at a block boundary -> a Backspace/Delete that would merge two paragraphs
        if (isDelete) {
          var sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.focusNode) return;
          var block = sel.focusNode.nodeType === 3 ? sel.focusNode.parentNode : sel.focusNode;
          block = block && block.closest ? block.closest("[data-node]") : null;
          if (!block) return;
          var caretOff = sourceCaretOffsetIn(block, sel.focusNode, sel.focusOffset);
          var key = block.getAttribute("data-node");
          var idx = model.nodes.findIndex(function (n) { return n.key === key; });
          if (idx < 0) return;
          var back = it === "deleteContentBackward", fwd = it === "deleteContentForward";
          if (back && caretOff === 0 && idx > 0) {
            var prev = model.nodes[idx - 1], prevLen = SD.nodeText(prev).length;
            e.preventDefault();
            afterSourceStructuralEdit(topic, model, SD.replaceRange(model, { nodeKey: prev.key, start: prevLen, len: 0, endAnchor: { nodeKey: key, start: 0, len: 0 } }, ""));
          } else if (fwd && caretOff === SD.nodeText(model.nodes[idx]).length && idx < model.nodes.length - 1) {
            var next = model.nodes[idx + 1], thisLen = SD.nodeText(model.nodes[idx]).length;
            e.preventDefault();
            afterSourceStructuralEdit(topic, model, SD.replaceRange(model, { nodeKey: key, start: thisLen, len: 0, endAnchor: { nodeKey: next.key, start: 0, len: 0 } }, ""));
          }
        }
      });
      // base edits: read the edited block's text back into the model, shift marks, persist. With one
      // editing host the input event targets the article, so the edited block is found from the caret.
      art.addEventListener("input", function () {
        var sel = window.getSelection();
        var fn = sel && sel.focusNode;
        var host = fn ? (fn.nodeType === 3 ? fn.parentNode : fn) : null;
        var block = host && host.closest ? host.closest("[data-node]") : null;
        if (!block) return;
        var res = SD.applyTextEdit(model, block.getAttribute("data-node"), block.textContent);
        recordSourceEdit(res && res.edit); // buffer for the unlock->lock History commit
        persistSourceDocModel(topic, model);
        repaintSourceMarks();
        // a base edit can flip an open alternate to stale -> re-render its panel (status + base line).
        if (__sourceAltPanelMarkId) renderSourceAltPanel(topic);
      });
      // two-layer lock: typing into base prose while locked is refused with a reminder; Ctrl+Z is
      // our owned undo (native undo would not restore marks).
      art.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) SD.redo(model); else SD.undo(model);
          persistSourceDocModel(topic, model);
          renderSourceArticle();
          return;
        }
        if (!__sourceUnlocked && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter")) {
          e.preventDefault();
          sourceToast("The source is locked -- unlock in the toolbar to edit the base text.");
        }
      });
      // clicking a painted mark activates it (contextual view is the alternates/comments tickets;
      // here we confirm the hit-test + active repaint work).
      art.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".source-doc__handle")) return; // resize handle, not a select
        if (!__sourceShowMarks) return;
        // an image/table is a whole-node OBJECT: a click on it selects the object (not a text span)
        // and offers the same alternate/comment actions, anchored by node id (spec 6).
        var objEl = e.target && e.target.closest ? e.target.closest('[data-object="1"]') : null;
        if (objEl && art.contains(objEl)) { selectSourceObject(topic, objEl.getAttribute("data-node")); return; }
        clearSourceObjectSel();
        var sel = window.getSelection(); if (!sel || !sel.focusNode) return;
        var m = __sourceMarksEngine.markAtPoint(sel.focusNode, sel.focusOffset);
        __sourceMarksEngine.setActive(m ? m.id : null); repaintSourceMarks();
        // keep the consolidated panel's Marks section in sync -- highlight the row for the clicked mark
        __sourceActiveMarkId = m ? m.id : null;
        if (__sourceInfoOpen && topicHasDoc(topic)) renderSourceInfoPanel(topic);
        // selecting a span opens its contextual panel by mark type: an alternate -> the alt panel
        // (spec 3.2); a link -> the read-only where-used panel (spec 3.1). One mark has one type, so
        // at most one opens; the other is passed null and closes. Comments have their own thread.
        syncSourceAltPanel(topic, m && m.type === "alternate" ? m.id : null);
        syncSourceWherePanel(topic, m && m.type === "link" ? m.id : null);
      });
      document.addEventListener("selectionchange", onSourceSelectionChange);
      document.removeEventListener("keydown", onSourceLockedTypeGuard);
      document.addEventListener("keydown", onSourceLockedTypeGuard); // #108: reminder when typing into locked prose

      host.appendChild(buildSourceDocBar(topic));
      host.appendChild(buildSourceSelBar(topic));
      applySourceInfoVisibility(); // keep the one consolidated panel's shown/hidden state after a re-render
      if (__sourceAltPanelMarkId) renderSourceAltPanel(topic); // re-pin the alt panel after a re-render
      if (__sourceWhereUsedMarkId) renderSourceWherePanel(topic); // re-pin the where-used panel after a re-render
      renderSourceCommentPins(topic); // re-pin the comment margin pins after a re-render
      if (__sourceOpenCommentMarkId) renderSourceCommentThread(topic); // re-pin an open comment thread
    }

    function applySourceLockState(art) {
      art = art || document.querySelector("#source-stage-article .source-doc");
      if (!art) return;
      // Single editing host: the whole article is the one contentEditable region when unlocked, so a
      // selection can span paragraphs. Per-block editable hosts confined every selection to one block --
      // the browser cannot extend a selection across separate editing hosts -- which is why a
      // cross-paragraph drag (comment / alternate / delete across paragraphs) was impossible in edit
      // mode. Blocks inherit editability from the article; objects (image / table) stay non-editable so
      // they remain whole-node selections rather than editable text.
      art.contentEditable = __sourceUnlocked ? "true" : "false";
      Array.prototype.forEach.call(art.querySelectorAll('[data-editable], [data-node-body]'), function (el) {
        el.removeAttribute("contenteditable"); // inherit the article host
      });
      Array.prototype.forEach.call(art.querySelectorAll('[data-object="1"]'), function (el) {
        el.contentEditable = "false";
      });
      art.classList.toggle("source-doc--unlocked", __sourceUnlocked);
    }
    // When LOCKED the blocks are contentEditable=false, so a real click can't place a caret in them
    // and a keystroke lands on <body>, never reaching the article's keydown guard -- so no "source
    // is locked" reminder ever showed (bug #108). A document-level guard catches the attempt: if the
    // locked source doc is mounted and the user presses a character key while NOT in a real field,
    // show the reminder. Registered once; cheap (returns early in every non-typing case).
    function onSourceLockedTypeGuard(e) {
      if (__sourceUnlocked) return;
      if (!document.querySelector("#source-stage-article .source-doc")) return; // no locked doc mounted
      if (e.metaKey || e.ctrlKey || e.altKey) return; // a shortcut, not typing
      if (!e.key || e.key.length !== 1) return; // only printable keys count as "trying to type"
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return; // a real field (title, search)
      sourceToast("The source is locked -- unlock in the toolbar to edit the base text.");
    }
    function repaintSourceMarks() {
      if (!__sourceMarksEngine) return;
      if (!__sourceShowMarks) { if (window.SourceMarks && window.SourceMarks._registry && window.SourceMarks._registry()) { var reg = window.SourceMarks._registry(); Object.keys(reg).forEach(function (k) { reg[k].clear(); }); } if (__sourceMarksEngine.clearObjectDecor) __sourceMarksEngine.clearObjectDecor(); renderSourceClassBadges(); return; }
      __sourceMarksEngine.paint();
      // uio-S-C06: the figure badges ride the same repaint as every other mark treatment, so
      // "show marks" turns them all on and off together.
      renderSourceClassBadges();
    }

    // --- History commit collapse (spec 5) --------------------------------------
    // Prose edits made during one unlock->lock cycle fold into a single "commit" History entry
    // rather than one entry per keystroke (structural events -- breaks, stale, comments -- keep
    // their own discrete entries; those are logged inside applyTextEdit / the mark actions).
    // We buffer the per-edit deltas while unlocked; on lock we summarise + capture a why-note.
    function beginSourceEditSession() { __sourceEditSession = { edits: [] }; }
    function recordSourceEdit(edit) {
      if (__sourceEditSession && edit && ((edit.inserted || 0) || (edit.removed || 0))) __sourceEditSession.edits.push(edit);
    }
    function flushSourceEditSession(topic, opts) {
      opts = opts || {};
      var s = __sourceEditSession; __sourceEditSession = null;
      var SD = window.SourceDoc, model = __sourceDocModel;
      if (!s || !s.edits.length || !topic || !SD || !model) return;
      var summary = SD.summarizeEdits(s.edits);
      if (!summary.editCount) return;
      function commit(note) {
        SD.logHistory(model, { type: "commit", charsAdded: summary.charsAdded, charsRemoved: summary.charsRemoved, editCount: summary.editCount, note: (note || "").trim() || undefined });
        persistSourceDocModel(topic, model);
        renderSourceInfoPanel(topic); // refresh the History timeline in the info panel
      }
      if (opts.prompt === false) commit(""); else sourceCommitNoteModal(commit);
    }
    // The skippable why-note prompted at lock (spec 5). Reuses the DS modal shell (promptModal's
    // family) -- Save records the note, Skip / Escape / scrim commits with no note. The commit
    // always lands; the note is optional, never a gate.
    function sourceCommitNoteModal(onCommit) {
      if (!window.VersoUI || !window.VersoUI.Modal) { onCommit(""); return; }
      var done = false;
      var ta = h("textarea", "source-note__text"); ta.placeholder = "Why this change? (optional)"; ta.rows = 3;
      var shell = dsModalShell({
        title: "Save changes", subtitle: "Add an optional note about why you made this edit.",
        primaryLabel: "Save note", cancelLabel: "Skip",
        onPrimary: function () { if (done) return; done = true; var v = ta.value; shell.modal.close(); onCommit(v); },
        onClose: function () { if (done) return; done = true; onCommit(""); }
      });
      shell.body.appendChild(ta);
      ta.focus();
    }
    // Single entry point for flipping the source lock, so the toolbar button and the
    // browser-verify hook share one begin/flush path. opts.prompt=false skips the why-note modal.
    function setSourceUnlocked(v, opts) {
      opts = opts || {};
      var next = !!v;
      if (next === __sourceUnlocked) { applySourceLockState(); refreshSourceSelBar(); updateSourceDocBar(); return; }
      var topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      if (next) {
        beginSourceEditSession();
        snapshotSourceLinkBase(); // 09: snapshot linked-passage wording so lock can warn + fork
        __sourceUnlocked = true;
        applySourceLockState(); refreshSourceSelBar(); updateSourceDocBar();
        return;
      }
      // Locking: if the edit session changed wording that other documents link, warn first (09).
      var impact = sourceBaseEditImpact();
      if (impact.affected.length && window.VersoUI && window.VersoUI.Button) { showSourceBaseEditModal(topic, impact, opts); return; }
      finalizeSourceLock(topic, opts);
    }

    // The document-level bar, docked bottom-centre (canvas idiom): lock/unlock + marks show/hide.
    // The block the next insert lands AFTER (spec 2b §6 / handoff C2: "after the currently selected
    // block"): the object-selected node, else the block under the caret/selection, else the doc's last
    // node. Insert targets a whole block, never the text caret.
    function currentSourceBlockKey() {
      if (__sourceObjectSelKey) return __sourceObjectSelKey;
      var art = document.getElementById("source-stage-article");
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.focusNode && art && art.contains(sel.focusNode)) {
        var n = sel.focusNode.nodeType === 3 ? sel.focusNode.parentNode : sel.focusNode;
        var el = n && n.closest ? n.closest("[data-node]") : null;
        if (el) return el.getAttribute("data-node");
      }
      if (__sourceSelAnchor && __sourceSelAnchor.nodeKey) return __sourceSelAnchor.nodeKey;
      var m = __sourceDocModel;
      return (m && m.nodes && m.nodes.length) ? m.nodes[m.nodes.length - 1].key : null;
    }
    // Insert a node after the current block, persist, re-render the article, and select the new object
    // so its alternate/comment actions are one click away. Shared by the image + table inserts.
    function insertSourceNodeAfterCurrent(topic, node) {
      var SD = window.SourceDoc, model = __sourceDocModel; if (!SD || !model) return;
      var inserted = SD.insertNodeAfter(model, currentSourceBlockKey(), node);
      persistSourceDocModel(topic, model);
      renderSourceArticle(); // full clean rebuild (headEl + article + docbar + marks)
      if (inserted && SD.isMarkableObjectNode && SD.isMarkableObjectNode(inserted)) selectSourceObject(topic, inserted.key);
      return inserted;
    }
    // Toolbar image insert: pick a file, store it inline as a data-URI (the Source doc is never
    // exported to SCORM, so the simple storage wins -- handoff C2), insert an image node after the
    // current block. Alt defaults to the file name; caption/alt are editable later via the object.
    function insertSourceImage(topic) {
      if (!__sourceUnlocked) { sourceToast("Unlock the source to insert an image."); return; }
      var inp = h("input"); inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; inp.remove();
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          var alt = String(f.name || "image").replace(/\.[^.]+$/, "");
          insertSourceNodeAfterCurrent(topic, { type: "image", src: rd.result, alt: alt });
          sourceToast("Image inserted.");
        };
        rd.readAsDataURL(f);
      });
      inp.click();
    }
    // Toolbar table insert: a 2x2 starter (header row + one body row) after the current block. Rich
    // in-cell editing is the spec 2b §6 fast-follow; this is the create half -- the table renders and
    // is markable/movable as an object immediately.
    function insertSourceTable(topic) {
      if (!__sourceUnlocked) { sourceToast("Unlock the source to insert a table."); return; }
      insertSourceNodeAfterCurrent(topic, { type: "table", rows: [["Column 1", "Column 2"], ["", ""]] });
      sourceToast("Table inserted.");
    }
    // Document-scope only; glyph-only IconButtons from the DS.
    function buildSourceDocBar(topic) {
      var U = window.VersoUI;
      var bar = h("div", "source-docbar");
      var lockBtn = U && U.IconButton ? U.IconButton({ icon: __sourceUnlocked ? "lock-open" : "lock", label: __sourceUnlocked ? "Lock the source prose" : "Unlock to edit the source prose", active: __sourceUnlocked, onClick: function () { setSourceUnlocked(!__sourceUnlocked); } }) : h("button", null, "Lock");
      lockBtn.classList.add("source-docbar__btn");
      var lockLbl = h("span", "source-docbar__lbl", __sourceUnlocked ? "Source editable" : "Source locked");
      var marksBtn = U && U.IconButton ? U.IconButton({ icon: __sourceShowMarks ? "eye" : "eye-off", label: "Show / hide marks", active: __sourceShowMarks, onClick: function () { __sourceShowMarks = !__sourceShowMarks; repaintSourceMarks(); if (!__sourceShowMarks) closeSourceCommentThread(); renderSourceCommentPins(topic); updateSourceDocBar(); } }) : h("button", null, "Marks");
      marksBtn.classList.add("source-docbar__btn");
      // ONE control for the ONE consolidated right panel (Marks + History + Source + Comments) --
      // replaces the old all-marks-drawer toggle that stacked a second surface over the info aside.
      var panelBtn = U && U.IconButton ? U.IconButton({ icon: "columns-2", label: __sourceInfoOpen ? "Hide the details panel" : "Show the details panel", active: __sourceInfoOpen, onClick: function () { __sourceInfoOpen = !__sourceInfoOpen; applySourceInfoVisibility(); updateSourceDocBar(); } }) : h("button", null, "Panel");
      panelBtn.classList.add("source-docbar__btn");
      bar.appendChild(lockLbl); bar.appendChild(lockBtn);
      // Insert image / table -- base-content mutations, so shown ONLY when unlocked (the same rule as
      // the selection bar's rich-text buttons). Each drops a new node after the current block.
      if (__sourceUnlocked && U && U.IconButton) {
        var imgBtn = U.IconButton({ icon: "image", label: "Insert an image after the current block", onClick: function () { insertSourceImage(topic); } });
        imgBtn.classList.add("source-docbar__btn");
        var tblBtn = U.IconButton({ icon: "table", label: "Insert a table after the current block", onClick: function () { insertSourceTable(topic); } });
        tblBtn.classList.add("source-docbar__btn");
        bar.appendChild(imgBtn); bar.appendChild(tblBtn);
      }
      bar.appendChild(marksBtn); bar.appendChild(panelBtn);
      bar.setAttribute("data-source-docbar", "1");
      return bar;
    }
    function updateSourceDocBar() {
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var old = host.querySelector("[data-source-docbar]"); if (!old) return;
      var topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      var fresh = buildSourceDocBar(topic); old.parentNode.replaceChild(fresh, old);
    }

    // The left TOC / navigator (spec 2.3): heading nodes, clickable to jump, with a scroll-spy
    // highlight on the section in view. Sticky beside the article. Returns null when the doc has
    // no headings (nothing to navigate) so the reading column keeps its full width.
    function buildSourceToc(model, host) {
      var heads = window.SourceDoc.headings(model);
      if (!heads.length) return null;
      var nav = h("nav", "source-doc__toc"); nav.setAttribute("aria-label", "Document outline");
      nav.appendChild(h("div", "source-doc__toc-label", "On this page"));
      heads.forEach(function (hd) {
        var item = h("button", "source-doc__toc-item source-doc__toc-item--l" + (hd.level || 2), hd.text || "Untitled");
        item.type = "button"; item.setAttribute("data-toc-key", hd.key); item.title = hd.text || "";
        item.addEventListener("click", function () {
          var target = host.querySelector('[data-node="' + hd.key + '"]');
          if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
        });
        nav.appendChild(item);
      });
      return nav;
    }
    // Highlights the TOC item whose heading is the last one scrolled above the top of the
    // reading pane -- the section the author is currently reading.
    function updateSourceScrollSpy() {
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var top = host.getBoundingClientRect().top + 12;
      var heads = Array.prototype.slice.call(host.querySelectorAll(".source-doc__h[data-node]"));
      var currentKey = heads.length ? heads[0].getAttribute("data-node") : null;
      heads.forEach(function (el) { if (el.getBoundingClientRect().top <= top) currentKey = el.getAttribute("data-node"); });
      // Highlight the current entry wherever the outline lives: the left-rail unified TOC
      // (VersoUI.TreeItem rows, is-selected) and/or the legacy in-article rail (is-current).
      var rows = [];
      var rail = document.getElementById("source-topic-list");
      if (rail) rows = rows.concat(Array.prototype.slice.call(rail.querySelectorAll(".source-toc__row[data-toc-key]")));
      var toc = host.querySelector(".source-doc__toc");
      if (toc) rows = rows.concat(Array.prototype.slice.call(toc.querySelectorAll(".source-doc__toc-item")));
      rows.forEach(function (it) {
        var on = it.getAttribute("data-toc-key") === currentKey;
        it.classList.toggle("is-current", on);
        it.classList.toggle("is-selected", on);
      });
    }
    function onSourceArticleScroll() {
      updateSourceScrollSpy();
      // the alt panel is absolutely positioned within the scrolling content, so it tracks its
      // span for free on scroll -- no per-scroll reposition needed.
    }

    // The contextual alternate panel (spec 3.2, primary view): selecting a span-with-alternate
    // opens a card pinned in the right gutter, tracking the span like a margin comment. Shows base
    // vs alternate + status; stale alternates offer a "Mark reviewed" re-sync. Annotation-tier, so
    // it works whether or not the base is unlocked.
    function onSourceAltPanelKey(ev) { if (ev.key === "Escape") closeSourceAltPanel(); }
    function closeSourceAltPanel() {
      __sourceAltPanelMarkId = null;
      var ex = document.querySelector("[data-source-altpanel]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceAltPanelKey);
    }
    function syncSourceAltPanel(topic, markId) {
      if (!markId) { closeSourceAltPanel(); return; }
      __sourceAltPanelMarkId = markId;
      renderSourceAltPanel(topic);
    }
    // Pin a gutter card (alternate panel / comment thread) to a mark's span: absolute within the
    // scrolling article, so it tracks the span on scroll for free. Shared by both margin surfaces.
    function pinCardToSpan(el, markId) {
      if (!el || !__sourceMarksEngine) return;
      var model = __sourceDocModel, SD = window.SourceDoc;
      var m = model && SD.markById(model, markId); if (!m) return;
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var rect = __sourceMarksEngine.rectFor(m); if (!rect) return;
      el.style.top = Math.max(8, rect.top - host.getBoundingClientRect().top + host.scrollTop) + "px";
    }
    function positionSourceAltPanel() { pinCardToSpan(document.querySelector("[data-source-altpanel]"), __sourceAltPanelMarkId); }
    // Where-used panel (spec 3.1): selecting a LINKED span opens a read-only card pinned in the
    // right gutter -- "Linked in N" with a breadcrumb pill per destination (Document > Section >
    // Location), clickable to navigate out to the course. Source only DISPLAYS links; creating them
    // is an Edit-stage ticket. Reuses the alt panel's pinned-card chrome (.source-altpanel*) + the
    // shared pinCardToSpan tracker; light-dismisses on Escape like its siblings.
    function onSourceWherePanelKey(ev) { if (ev.key === "Escape") closeSourceWherePanel(); }
    // ---- uio-S-C06: restriction, resolved down uio-F07's ladder ------------------------------
    // Source's rungs are the deployment default, the Product this source document belongs to, the
    // source document itself, and the mark. It is the SAME chain builder and the SAME resolver the
    // inspector uses — Source states the fact, it does not compute a second version of it.
    // Returns null when the classification model is absent (a page that never loaded it) or the
    // mark is not restricted, so every caller can decline to draw rather than draw a blank.
    function sourceRestrictionFor(m) {
      var SD = window.SourceDoc, C = window.VersoClassification;
      if (!SD || !C || !m || m.type !== "restricted") return null;
      var levels = E.classificationLevels ? E.classificationLevels() : [];
      var pid = activeSourceProductId();
      var spec = E.classificationSpec({
        product: (pid && window.ProductsStore) ? window.ProductsStore[pid] : null,
        doc: activeSourceMaster(),
        block: m
      });
      var res = E.resolveScoped(E.classificationChain(spec), C.CLASSIFICATION_PROP,
        { at: "block", choose: C.mostRestrictive(levels) });
      return SD.restrictionView(m, res, levels, C.ruleSet(levels, res.value));
    }
    // A classified figure says so ON the figure — a reader scrolling past an image never opens a
    // panel. Redrawn with the marks, and only while marks are shown, so turning them off gives you
    // the document as it reads.
    function renderSourceClassBadges() {
      var host = document.getElementById("source-stage-article"); if (!host) return;
      Array.prototype.forEach.call(host.querySelectorAll(".source-classbadge"), function (b) { b.remove(); });
      if (!__sourceShowMarks || !__sourceDocModel) return;
      var SD = window.SourceDoc;
      (__sourceDocModel.marks || []).forEach(function (m) {
        if (m.type !== "restricted" || !SD.isObjectMark(m)) return;
        var rv = sourceRestrictionFor(m); if (!rv) return;
        var el = host.querySelector('[data-node="' + m.anchor.nodeKey + '"]'); if (!el) return;
        var badge = h("span", "source-classbadge");
        badge.innerHTML = (window.Icon ? window.Icon("shield") : "") + "<span>" + rv.levelName + "</span>";
        badge.title = rv.inherited ? ("Inherited from " + rv.fromLabel) : "Set on this figure";
        el.appendChild(badge);
      });
    }
    var __sourceRestrictMarkId = null;
    function closeSourceRestrictPanel() {
      __sourceRestrictMarkId = null;
      var ex = document.querySelector("[data-source-restrictpanel]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceRestrictPanelKey);
    }
    function onSourceRestrictPanelKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeSourceRestrictPanel(); } }
    function syncSourceRestrictPanel(topic, markId) {
      if (!markId) { closeSourceRestrictPanel(); return; }
      __sourceRestrictMarkId = markId;
      renderSourceRestrictPanel(topic);
    }
    function positionSourceRestrictPanel() { pinCardToSpan(document.querySelector("[data-source-restrictpanel]"), __sourceRestrictMarkId); }
    // The card. It states what applies and whose decision it was, then the rule set as rows, then
    // two actions. It reuses the alternate/where-used card shell wholesale, so a third card in this
    // stage is not a third card anatomy.
    function renderSourceRestrictPanel(topic) {
      var ex = document.querySelector("[data-source-restrictpanel]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceRestrictPanelKey);
      var model = __sourceDocModel, SD = window.SourceDoc;
      if (!model || !__sourceRestrictMarkId) return;
      var m = SD.markById(model, __sourceRestrictMarkId);
      if (!m || m.type !== "restricted") { __sourceRestrictMarkId = null; return; }
      var rv = sourceRestrictionFor(m);
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var panel = h("aside", "source-altpanel source-restrictpanel"); panel.setAttribute("data-source-restrictpanel", "1");
      panel.setAttribute("aria-label", "Classification");
      var head = h("div", "source-altpanel__head");
      var glyph = h("span", "source-restrictpanel__glyph"); glyph.innerHTML = window.Icon ? window.Icon("shield") : "";
      head.appendChild(glyph);
      head.appendChild(h("div", "source-altpanel__title", rv ? rv.levelName : "Restricted"));
      var close = h("button", "source-altpanel__close"); close.type = "button"; close.title = "Close";
      close.innerHTML = window.Icon ? window.Icon("x") : "close";
      close.addEventListener("click", function () { closeSourceRestrictPanel(); });
      head.appendChild(close);
      panel.appendChild(head);
      if (!rv) {
        panel.appendChild(h("div", "source-altpanel__field insp-hint",
          "No classification resolves for this passage. Set one on the Product, or on this source document."));
      } else {
        // Where it came from, in the spine's words. An inherited value names its scope; one set
        // here says so plainly rather than staying silent, so "who decided this" always has an answer.
        panel.appendChild(h("div", "source-restrictpanel__scope",
          rv.inherited ? ("Inherited from " + rv.fromLabel) : "Set on this passage"));
        var rules = h("div", "source-restrictpanel__rules");
        rv.rows.forEach(function (r) {
          var row = h("div", "source-restrictpanel__rule");
          row.appendChild(h("span", "source-restrictpanel__rule-k", r.label));
          row.appendChild(h("span", "source-restrictpanel__rule-v", r.value));
          rules.appendChild(row);
        });
        panel.appendChild(rules);
        var acts = h("div", "source-restrictpanel__actions");
        if (window.VersoUI && window.VersoUI.Button) {
          // "Classification" ROUTES to where the value is actually set rather than offering a second
          // place to set it — the spine's cross-reference rule: show the value, link to its owner.
          acts.appendChild(window.VersoUI.Button({
            variant: "secondary", size: "sm", label: "Classification",
            title: "Open the Product panel, where this document's classification is set",
            onClick: function () { closeSourceRestrictPanel(); revealSourceProductPanel(); }
          }));
          var pending = !!(rv.signoff && rv.signoff.requestedAt);
          acts.appendChild(window.VersoUI.Button({
            variant: "secondary", size: "sm", label: pending ? "Sign-off requested" : "Request sign-off",
            disabled: pending || !rv.signoffNeeded,
            title: !rv.signoffNeeded ? "This level needs no sign-off"
              : pending ? "Already requested" : "Record that this passage is waiting on an approver",
            onClick: function () {
              SD.requestSignoff(m, currentUserLabel(), new Date().toISOString().slice(0, 10), rv.levelId);
              persistSourceDocModel(topic, model);
              renderSourceRestrictPanel(topic);
              if (topic) renderSourceInfoPanel(topic);
              sourceToast("Recorded. It will show as waiting until an approver signs it off.");
            }
          }));
        }
        panel.appendChild(acts);
        if (rv.signoff && rv.signoff.requestedAt) {
          panel.appendChild(h("div", "source-restrictpanel__pending",
            "Waiting on an approver since " + rv.signoff.requestedAt +
            (rv.signoff.requestedBy ? " (asked by " + rv.signoff.requestedBy + ")" : "") + "."));
        }
      }
      host.appendChild(panel);
      positionSourceRestrictPanel();
      document.addEventListener("keydown", onSourceRestrictPanelKey);
    }
    // Who asked. The identity layer may not be present at all (standalone, offline, signed out),
    // and a blank requester is a truthful answer — the DATE and the fact of the request are what a
    // release gate reads. Same principal the account menu reads, so the two can never disagree.
    function currentUserLabel() {
      var p = window.__versoServerPrincipal;
      return (p && p.kind === "user" && (p.name || p.email)) || "";
    }
    // The Product panel is ALREADY on screen, at the top of the Source rail — so "Classification"
    // takes you to it rather than opening a second place to set the same value. Show the value,
    // link to its owner: the spine's cross-reference rule.
    function revealSourceProductPanel() {
      var el = document.getElementById("source-product-panel"); if (!el) return;
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el.classList.add("is-flash");
      setTimeout(function () { el.classList.remove("is-flash"); }, 900);
    }

    function closeSourceWherePanel() {
      __sourceWhereUsedMarkId = null;
      var ex = document.querySelector("[data-source-wherepanel]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceWherePanelKey);
    }
    function syncSourceWherePanel(topic, markId) {
      if (!markId) { closeSourceWherePanel(); return; }
      __sourceWhereUsedMarkId = markId;
      renderSourceWherePanel(topic);
    }
    function positionSourceWherePanel() { pinCardToSpan(document.querySelector("[data-source-wherepanel]"), __sourceWhereUsedMarkId); }
    function renderSourceWherePanel(topic) {
      var ex = document.querySelector("[data-source-wherepanel]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceWherePanelKey);
      var model = __sourceDocModel, SD = window.SourceDoc;
      if (!model || !__sourceWhereUsedMarkId) return;
      var m = SD.markById(model, __sourceWhereUsedMarkId);
      if (!m || m.type !== "link") { __sourceWhereUsedMarkId = null; return; }
      var host = document.getElementById("source-stage-article"); if (!host) return;
      // 10: the REAL, live where-used -- every block/span in any document that links this passage,
      // walked from the registry (placement links carry no stored crumb list). Each row jumps to the
      // exact block in Edit; an alternate can be pushed to all or a chosen subset of these locations.
      var used = sourceLinkWhereUsed(__sourceActiveTopicId, m.id);
      var panel = h("aside", "source-altpanel source-wherepanel"); panel.setAttribute("data-source-wherepanel", "1");
      panel.setAttribute("aria-label", "Where this is linked");
      var head = h("div", "source-altpanel__head");
      var glyph = h("span", "source-wherepanel__glyph"); glyph.innerHTML = window.Icon ? window.Icon("link") : "";
      head.appendChild(glyph);
      head.appendChild(h("div", "source-altpanel__title", used.length ? ("Linked in " + used.length) : "Where used"));
      var close = h("button", "source-altpanel__close"); close.type = "button"; close.title = "Close";
      close.innerHTML = window.Icon ? window.Icon("x") : "close";
      close.addEventListener("click", function () { closeSourceWherePanel(); });
      head.appendChild(close);
      panel.appendChild(head);
      if (!used.length) {
        // uio-S-C03 (SRC-02): the zero state reads as an INVITATION, not a contradiction of the
        // LINKED mark. A link mark makes the passage linkable; 0 just means it isn't placed yet.
        panel.appendChild(h("div", "source-altpanel__field insp-hint", "Not used in a course yet — place this passage from the Edit stage to reuse it here."));
      } else {
        used.forEach(function (loc) {
          var row = h("button", "source-wherepanel__row"); row.type = "button";
          row.title = "Open " + loc.docTitle + " and select the linked " + (loc.kind === "span" ? "span" : "block");
          row.appendChild(h("span", "source-wherepanel__row-doc", loc.docTitle));
          row.appendChild(h("span", "source-wherepanel__row-tag" + (loc.altId ? " is-alt" : ""), loc.altId ? "alternate" : "base"));
          row.addEventListener("click", function () { jumpToLinkedBlock(loc.docCode, loc.blockId); });
          panel.appendChild(row);
        });
        // Push an alternate out to the linked documents (all, or a picked subset). Never automatic.
        var alts = sourceLinkAlternates(model, m);
        if (alts.length && window.VersoUI && window.VersoUI.Button) {
          var pushWrap = h("div", "source-wherepanel__push");
          pushWrap.appendChild(window.VersoUI.Button({ variant: "secondary", size: "sm", icon: "arrow-up-to-line", label: "Push an alternate…", onClick: function () { openSourceAltPushDialog(m, alts, used); } }));
          panel.appendChild(pushWrap);
        }
      }
      host.appendChild(panel);
      positionSourceWherePanel();
      document.addEventListener("keydown", onSourceWherePanelKey);
    }
    // 10: push a forked wording to the documents that link a passage. Sets altId on each chosen
    // location across whatever documents use it; base stays base until pushed (never automatic).
    function pushSourceAlternate(markId, altId, locations) {
      var reg = registry;
      (locations || []).forEach(function (loc) { applyAltToLocation(reg, loc, altId); });
      saveRegistry(reg); decorateSourceLinks();
      var topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      if (topic) renderSourceWherePanel(topic); // refresh the base/alternate tags
      sourceToast("Pushed to " + locations.length + " place" + (locations.length === 1 ? "" : "s") + ".");
    }
    function openSourceAltPushDialog(link, alts, used) {
      var selectedAlt = alts[0].id, chosen = used.map(function () { return true; });
      var shell = dsModalShell({
        title: "Push an alternate", subtitle: "Send a forked wording to the documents that link this passage.",
        primaryLabel: "Push",
        onPrimary: function () {
          var locs = used.filter(function (loc, i) { return chosen[i]; });
          if (!locs.length || !selectedAlt) return;
          pushSourceAlternate(link.id, selectedAlt, locs); shell.modal.close();
        }
      });
      var altField = modalField(shell.body, "Alternate");
      var altRow = h("div", "prop-toggle-row");
      alts.forEach(function (alt) {
        var b = h("button", "prop-toggle" + (alt.id === selectedAlt ? " is-on" : "")); b.type = "button";
        b.textContent = alt.tag || sourceAltSnippet(alt.alt);
        b.addEventListener("click", function () { selectedAlt = alt.id; Array.prototype.forEach.call(altRow.querySelectorAll(".prop-toggle"), function (x) { x.classList.remove("is-on"); }); b.classList.add("is-on"); });
        altRow.appendChild(b);
      });
      altField.appendChild(altRow);
      var locField = modalField(shell.body, "Apply to");
      used.forEach(function (loc, i) {
        locField.appendChild(window.VersoUI.Checkbox({ label: loc.docTitle + " (" + (loc.altId ? "alternate" : "base") + ")", checked: true, onChange: function (v) { chosen[i] = v; } }));
      });
    }
    function renderSourceAltPanel(topic) {
      var ex = document.querySelector("[data-source-altpanel]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceAltPanelKey);
      var model = __sourceDocModel, SD = window.SourceDoc;
      if (!model || !__sourceAltPanelMarkId) return;
      var m = SD.markById(model, __sourceAltPanelMarkId);
      if (!m || m.type !== "alternate") { __sourceAltPanelMarkId = null; return; }
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var status = SD.markStatus(m);
      var panel = h("aside", "source-altpanel"); panel.setAttribute("data-source-altpanel", "1");
      panel.setAttribute("aria-label", "Alternate rendition");
      var head = h("div", "source-altpanel__head");
      var dot = h("span", "source-drawer__dot source-drawer__dot--" + status.dot); dot.title = status.label;
      head.appendChild(dot);
      head.appendChild(h("div", "source-altpanel__title", "Alternate"));
      var close = h("button", "source-altpanel__close"); close.type = "button"; close.title = "Close";
      close.innerHTML = window.Icon ? window.Icon("x") : "close";
      close.addEventListener("click", function () { closeSourceAltPanel(); });
      head.appendChild(close);
      panel.appendChild(head);
      // tag = the canonical DS Badge (tone accent -- its stated use is "variant tags"), not a one-off pill.
      if (m.tag) {
        var tagWrap = h("div", "source-altpanel__tag");
        tagWrap.appendChild(window.VersoUI && window.VersoUI.Badge ? window.VersoUI.Badge({ tone: "accent", children: "For: " + m.tag }) : document.createTextNode("For: " + m.tag));
        panel.appendChild(tagWrap);
      }
      var baseWrap = h("div", "source-altpanel__field");
      baseWrap.appendChild(h("div", "source-altpanel__label", "Base"));
      // an object mark has no span text -- show the node's label (e.g. "Image — <caption>") instead.
      var baseLine = SD.isObjectMark(m) ? SD.objectNodeLabel(SD.nodeByKey(model, m.anchor.nodeKey)) : (SD.anchorText(model, m.anchor) || "(empty)");
      baseWrap.appendChild(h("div", "source-altpanel__base", baseLine));
      panel.appendChild(baseWrap);
      var altWrap = h("div", "source-altpanel__field");
      altWrap.appendChild(h("div", "source-altpanel__label", "Alternate"));
      altWrap.appendChild(h("div", "source-altpanel__alt", m.alt || ""));
      panel.appendChild(altWrap);
      if (m.stale) panel.appendChild(h("div", "source-altpanel__stale", "Base changed since this alternate was written -- review it."));
      var actions = h("div", "source-altpanel__actions");
      if (m.stale) {
        var reviewed = h("button", "source-altpanel__btn source-altpanel__btn--primary", "Mark reviewed"); reviewed.type = "button";
        reviewed.title = "Re-sync: accept the current base as what this alternate was written against";
        reviewed.addEventListener("click", function () { SD.updateMark(model, m.id, m.anchor); persistSourceDocModel(topic, model); repaintSourceMarks(); renderSourceAltPanel(topic); });
        actions.appendChild(reviewed);
      }
      var edit = h("button", "source-altpanel__btn", "Edit"); edit.type = "button";
      edit.addEventListener("click", function () {
        openSourceComposer("alternate", function (val, tag) { m.alt = val; m.tag = tag || ""; persistSourceDocModel(topic, model); repaintSourceMarks(); renderSourceAltPanel(topic); }, { alt: m.alt, tag: m.tag });
      });
      actions.appendChild(edit);
      var del = h("button", "source-altpanel__btn source-altpanel__btn--danger", "Delete"); del.type = "button";
      del.addEventListener("click", function () {
        var i = model.marks.indexOf(m); if (i >= 0) { SD.pushUndo(model); model.marks.splice(i, 1); }
        persistSourceDocModel(topic, model); repaintSourceMarks(); closeSourceAltPanel();
      });
      actions.appendChild(del);
      panel.appendChild(actions);
      host.appendChild(panel);
      positionSourceAltPanel();
      document.removeEventListener("keydown", onSourceAltPanelKey);
      document.addEventListener("keydown", onSourceAltPanelKey);
    }

    // Comments (spec 3.3): ONE engine shared with the canvas -- makeComment/makeReply, the same
    // comment-reply/comment-row__dot thread UI (buildSourceCommentItem), the same users. The
    // Source-specific adapter is the ANCHOR: a comment is anchored to a range mark ({markId}, where
    // the canvas uses a pixel pin). Comments live on topic.comments (library content, not a course
    // doc), keyed by the mark id. Presentation = canvas-style margin pins in the right gutter,
    // pinned to their span + scrolling with it; clicking a pin opens the thread card in place.
    function sourceCommentsForMark(topic, markId) {
      return (topic.comments || []).filter(function (c) { return c.anchor && c.anchor.markId === markId; });
    }
    // Every comment MARK on the doc that still has a live thread, newest span first is not needed --
    // draw order follows model.marks. A comment mark with no thread (all deleted) draws no pin.
    function renderSourceCommentPins(topic) {
      var host = document.getElementById("source-stage-article"); if (!host) return;
      Array.prototype.forEach.call(host.querySelectorAll(".source-commentpin"), function (n) { n.remove(); });
      var model = __sourceDocModel; if (!model || !__sourceShowMarks) return;
      (model.marks || []).forEach(function (m) {
        if (m.type !== "comment") return;
        var thread = sourceCommentsForMark(topic, m.id); if (!thread.length) return;
        var open = thread.filter(function (c) { return !c.done; }).length;
        var pin = h("button", "source-commentpin" + (open ? "" : " is-done") + (m.id === __sourceOpenCommentMarkId ? " is-open" : ""));
        pin.type = "button"; pin.setAttribute("data-comment-mark", m.id);
        pin.title = thread.length + " comment" + (thread.length === 1 ? "" : "s") + (open ? "" : " (resolved)");
        pin.innerHTML = window.Icon ? window.Icon("message-square") : "";
        var lead = thread[0];
        if (lead && lead.colour) pin.style.setProperty("--pin-colour", lead.colour);
        if (thread.length > 1) pin.appendChild(h("span", "source-commentpin__count", String(thread.length)));
        pin.addEventListener("click", function () { toggleSourceCommentThread(topic, m.id); });
        host.appendChild(pin);
        pinCardToSpan(pin, m.id); // sets top (tracks the span vertically)
        anchorPinToTextMargin(pin, host); // sets left just right of the reading column (pilot feedback)
      });
    }
    // Anchor a comment pin just to the RIGHT of the text margin (the reading column's right edge),
    // not out in the far gutter -- pilot feedback 2026-07-28. Clamped so it never leaves the host.
    function anchorPinToTextMargin(pin, host) {
      var col = host.querySelector(".source-doc__col") || host.querySelector(".source-doc");
      if (!col) return;
      var cr = col.getBoundingClientRect(), hr = host.getBoundingClientRect();
      var left = cr.right - hr.left + host.scrollLeft + 6;
      left = Math.min(left, host.clientWidth - 26); // keep it on-screen on a narrow viewport
      pin.style.left = Math.max(8, left) + "px";
      pin.style.right = "auto";
    }
    function onSourceCommentThreadKey(ev) { if (ev.key === "Escape") closeSourceCommentThread(); }
    // Outside-click light-dismiss, matching the canvas comment popover ("first outside click closes
    // the open note", editor.js ~19632). A click on a pin is left to the pin's own toggle.
    function onSourceCommentThreadOutside(ev) {
      var card = document.querySelector("[data-source-commentthread]"); if (!card) return;
      if (card.contains(ev.target)) return;
      if (ev.target.closest && ev.target.closest(".source-commentpin")) return;
      closeSourceCommentThread();
      var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      renderSourceCommentPins(t);
    }
    function closeSourceCommentThread() {
      __sourceOpenCommentMarkId = null;
      var ex = document.querySelector("[data-source-commentthread]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceCommentThreadKey);
      document.removeEventListener("mousedown", onSourceCommentThreadOutside);
    }
    function toggleSourceCommentThread(topic, markId) {
      if (__sourceOpenCommentMarkId === markId) { closeSourceCommentThread(); renderSourceCommentPins(topic); return; }
      __sourceOpenCommentMarkId = markId;
      renderSourceCommentThread(topic);
      renderSourceCommentPins(topic); // repaint the is-open pin state
    }
    // The in-place thread card for one comment mark: the shared canvas thread items + reply, plus a
    // fresh "Add a comment" field. Open/resolve activity is logged to History (spec 3.3).
    function renderSourceCommentThread(topic) {
      var ex = document.querySelector("[data-source-commentthread]"); if (ex) ex.remove();
      document.removeEventListener("keydown", onSourceCommentThreadKey);
      document.removeEventListener("mousedown", onSourceCommentThreadOutside);
      var model = __sourceDocModel, SD = window.SourceDoc, UI = window.VersoUI;
      if (!model || !__sourceOpenCommentMarkId) return;
      var m = SD.markById(model, __sourceOpenCommentMarkId);
      if (!m || m.type !== "comment") { __sourceOpenCommentMarkId = null; return; }
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var card = h("aside", "source-commentthread comment-thread"); card.setAttribute("data-source-commentthread", "1");
      card.setAttribute("aria-label", "Comment thread");
      var head = h("div", "source-commentthread__head");
      head.appendChild(h("div", "source-commentthread__title", "Comments"));
      var close = h("button", "source-commentthread__close"); close.type = "button"; close.title = "Close";
      close.innerHTML = window.Icon ? window.Icon("x") : "close";
      close.addEventListener("click", function () { closeSourceCommentThread(); renderSourceCommentPins(topic); });
      head.appendChild(close);
      card.appendChild(head);
      var mid = m.id;
      function afterThreadChange(kind, c) {
        if (kind === "resolve") SD.logHistory(model, { type: c && c.done ? "comment-resolved" : "comment-reopened", markId: mid, commentId: c && c.id });
        persistSourceDocModel(topic, model); stampTopicUpdated(topic);
        // if every thread comment was deleted, drop the now-empty comment mark + close.
        if (!sourceCommentsForMark(topic, mid).length) {
          var i = model.marks.indexOf(m); if (i >= 0) { SD.pushUndo(model); model.marks.splice(i, 1); }
          persistSourceDocModel(topic, model); closeSourceCommentThread(); repaintSourceMarks(); renderSourceCommentPins(topic); return;
        }
        repaintSourceMarks(); renderSourceCommentThread(topic); renderSourceCommentPins(topic);
        refreshSourceHistory(topic); // surface comment resolve/reopen in the History timeline (#109)
      }
      sourceCommentsForMark(topic, mid).forEach(function (c) { card.appendChild(buildSourceCommentItem(topic, c, { onChange: afterThreadChange })); });
      if (UI && UI.TextField && UI.Button) {
        var newField = UI.TextField({ multiline: true, rows: 2, value: "", placeholder: "Add a comment..." });
        newField.classList.add("comment-popover__body");
        var addBtn = UI.Button({ variant: "primary", label: "Comment", onClick: function () {
          var v = (newField.input.value || "").trim(); if (!v) return;
          topic.comments = topic.comments || [];
          var cm = makeComment({ markId: mid }, v);
          topic.comments.push(cm);
          SD.logHistory(model, { type: "comment-added", markId: mid, commentId: cm.id });
          stampTopicUpdated(topic); renderSourceCommentThread(topic); renderSourceCommentPins(topic);
          refreshSourceHistory(topic); // surface the new comment in the History timeline (#109)
        } });
        card.appendChild(newField); card.appendChild(addBtn);
      }
      host.appendChild(card);
      pinCardToSpan(card, mid);
      document.addEventListener("keydown", onSourceCommentThreadKey);
      document.addEventListener("mousedown", onSourceCommentThreadOutside);
    }

    // Source v2 (consolidated-panel): the all-marks list is no longer a separate overlay drawer --
    // it is the FIRST section of the one consolidated right panel (see renderSourceMarksSection,
    // built by renderSourceInfoPanel). The filter set is shared. Clicking a row activates + scrolls
    // to that mark in the article, exactly as the drawer did.
    // uio-S-C01 (SRC-06): ONE labelled filter, not four unlabelled glyphs that duplicated it. Each
    // segment states its type and carries a live count, so the filter also reads as the document's
    // mark summary. Counts come from SourceDoc.markCounts, so a segment can never disagree with the
    // list beneath it.
    var SOURCE_MARK_FILTERS = [
      { key: "all", label: "All", title: "Every mark" },
      { key: "alternate", label: "Alt", title: "Alternates" },
      { key: "link", label: "Linked", title: "Linked passages" },
      { key: "comment", label: "Notes", title: "Comments" },
      // uio-S-C06: the fourth segment S-C01 deliberately left out, now that uio-F07 gives it data.
      { key: "restricted", label: "Restricted", title: "Passages whose distribution is controlled" }
    ];
    // Reveal a mark in the consolidated panel: open the panel if hidden, highlight its row, and
    // scroll the article to it (the "selecting a mark opens the panel to that mark" behaviour).
    function revealSourceMark(m) {
      __sourceActiveMarkId = m.id;
      // You clicked a mark (or an alternate) -- if marks are hidden, show them so the highlight
      // you jumped to is actually visible (source-right-panel-consolidation part 4). Flip the flag
      // before repaint (repaintSourceMarks reads it) and refresh pins + doc-bar toggle after.
      var wasHidden = !__sourceShowMarks;
      if (wasHidden) __sourceShowMarks = true;
      if (__sourceMarksEngine) { __sourceMarksEngine.setActive(m.id); repaintSourceMarks(); }
      if (!__sourceInfoOpen) { __sourceInfoOpen = true; applySourceInfoVisibility(); updateSourceDocBar(); }
      var topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      if (wasHidden) { renderSourceCommentPins(topic); updateSourceDocBar(); }
      if (topic) renderSourceInfoPanel(topic);
      var host = document.getElementById("source-stage-article");
      var target = host && host.querySelector('[data-node="' + m.anchor.nodeKey + '"]');
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
      var info = document.getElementById("source-stage-info");
      var rowEl = info && info.querySelector('.source-drawer__row[data-mark-id="' + m.id + '"]');
      if (rowEl) rowEl.scrollIntoView({ block: "nearest" });
    }
    // uio-S-C01 (SRC-01): the count a mark row carries instead of one row per instance. A linked
    // passage used by four documents is ONE row saying "in 4 docs" -- the destination list lives in
    // the mark's own where-used card, which is where you act on it. Also decides the status dot: a
    // comment whose whole thread is resolved goes grey rather than reading as live work.
    function sourceMarkRowState(topic, model, m) {
      var SD = window.SourceDoc, st = SD.markStatus(m);
      var out = { dot: st.dot, dotTitle: st.label, meta: "" };
      if (m.type === "link") {
        var docs = {};
        sourceLinkWhereUsed(__sourceActiveTopicId, m.id).forEach(function (u) { docs[u.docCode] = 1; });
        var n = Object.keys(docs).length;
        out.meta = n ? ("in " + n + " doc" + (n === 1 ? "" : "s")) : "not placed yet";
      } else if (m.type === "alternate") {
        var parts = [];
        if (m.stale) parts.push("base changed");
        if (m.tag) parts.push(String(m.tag));
        out.meta = parts.join(" · ");
      } else if (m.type === "restricted") {
        // The row states the level that RESOLVES, so it agrees with the card that opens from it.
        var rv = sourceRestrictionFor(m);
        out.meta = rv ? (rv.levelName + (rv.inherited ? " · from " + rv.fromLabel : "")) : "";
        if (rv && rv.signoffNeeded && !(rv.signoff && rv.signoff.requestedAt)) { out.dot = "yellow"; out.dotTitle = "Needs sign-off"; }
        else if (rv && rv.signoff && rv.signoff.requestedAt) { out.dot = "yellow"; out.dotTitle = "Awaiting sign-off"; }
      } else if (m.type === "comment") {
        var thread = sourceCommentsForMark(topic, m.id);
        var open = thread.filter(function (c) { return !c.done; }).length;
        out.meta = open ? (open + " open") : (thread.length ? "resolved" : "");
        if (!open && thread.length && !m.broken) { out.dot = "grey"; out.dotTitle = "Resolved"; }
      }
      return out;
    }
    // The Marks section of the consolidated panel: the mark navigator (filter + rows), folded in
    // from the retired drawer. One labelled, counted filter (All / Alt / Linked / Notes) over one row
    // per MARK -- a row jumps to + highlights its mark, and states its own location so it identifies
    // itself without leaning on a truncated snippet (uio-S-C01, SRC-01/06).
    function renderSourceMarksSection(host, model) {
      var SD = window.SourceDoc, U = window.VersoUI;
      var topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      // Marks is the primary section of the consolidated panel -- render it title-less, straight
      // into the panel host (no "Marks" header), above the History/Source/Comments sections.
      var body = h("div", "source-marks__primary"); host.appendChild(body);
      var counts = SD.markCounts(model);
      if (U && U.SegmentedControl) {
        body.appendChild(U.SegmentedControl({
          size: "sm",
          options: SOURCE_MARK_FILTERS.map(function (f) {
            var n = counts[f.key] || 0;
            return { value: f.key, label: f.label + " " + n, title: f.title + " (" + n + ")" };
          }),
          value: __sourceMarksFilter,
          onChange: function (v) { __sourceMarksFilter = v; var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; if (t) renderSourceInfoPanel(t); }
        }));
      }
      var listWrap = h("div", "source-marks__list");
      var marks = (model.marks || []).filter(function (m) { return __sourceMarksFilter === "all" || m.type === __sourceMarksFilter; });
      if (!marks.length) {
        listWrap.appendChild(h("div", "source-drawer__empty", __sourceMarksFilter === "link"
          ? "Nothing linked yet — select a passage and place it from the Edit stage."
          : ("No marks" + (__sourceMarksFilter === "all" ? " yet." : " of this type."))));
      } else {
        marks.forEach(function (m) {
          var meta = SD.markMeta(m), state = sourceMarkRowState(topic, model, m);
          var row = h("button", "source-drawer__row" + (m.id === __sourceActiveMarkId ? " is-active" : "")); row.type = "button";
          row.setAttribute("data-mark-id", m.id);
          var dot = h("span", "source-drawer__dot source-drawer__dot--" + state.dot); dot.title = state.dotTitle;
          var rbody = h("div", "source-drawer__row-body");
          var head = h("div", "source-drawer__row-head");
          head.appendChild(h("span", "source-drawer__row-type " + meta.cls, meta.label));
          if (state.meta) head.appendChild(h("span", "source-drawer__row-count", state.meta));
          rbody.appendChild(head);
          var snip = SD.isObjectMark(m) ? SD.objectNodeLabel(SD.nodeByKey(model, m.anchor.nodeKey)) : (SD.anchorText(model, m.anchor) || "(empty)");
          rbody.appendChild(h("div", "source-drawer__row-snip", snip));
          var path = SD.markPath(model, m);
          if (path) rbody.appendChild(h("div", "source-drawer__row-where", path));
          row.appendChild(dot); row.appendChild(rbody);
          row.addEventListener("click", function () {
            revealSourceMark(m);
            // a linked row opens the card that holds its destination list -- the instances the row
            // deliberately no longer enumerates (SRC-01).
            if (m.type === "link" && topic) syncSourceWherePanel(topic, m.id);
            if (m.type === "restricted") syncSourceRestrictPanel(topic, m.id);
          });
          listWrap.appendChild(row);
        });
      }
      body.appendChild(listWrap);
      // The topic can ALSO be placed whole, as a library component instance -- a DIFFERENT mechanism
      // from a link mark. It closes the list as one plain footnote rather than a fake mark row: it
      // isn't a mark, so it must not wear a mark's row or borrow a mark colour (SRC-07's fixed
      // palette only works if no hue does two jobs).
      if (__sourceMarksFilter === "all" || __sourceMarksFilter === "link") {
        var inst = libraryWhereUsedDetail(__sourceActiveTopicId, getRegistry());
        var idocs = {}; inst.forEach(function (u) { idocs[u.docCode] = 1; });
        var ni = Object.keys(idocs).length;
        if (ni) {
          var irow = h("button", "source-marks__rollup", "Also placed whole, as a component, in " + ni + " document" + (ni === 1 ? "" : "s") + ".");
          irow.type = "button";
          irow.title = "Open " + inst[0].docTitle + " and select the placed component";
          irow.addEventListener("click", function () { jumpToLinkedBlock(inst[0].docCode, inst[0].blockId); });
          body.appendChild(irow);
        }
      }
    }

    // The contextual selection bar, above the highlight (canvas idiom): glyph rich-text
    // (bold/italic/dot-points -- ONLY when unlocked) plus the annotation actions alternate +
    // comment (always, since annotation is ungated). NO create-link here -- linking is Edit-stage.
    // A selection that extends past an existing mark flips the create button to a ⟳ update.
    function buildSourceSelBar(topic) {
      var bar = h("div", "source-selbar"); bar.setAttribute("data-source-selbar", "1"); bar.style.display = "none";
      // glyph-only, from the shared Lucide icon set (Icon()), matching the canvas toolbar idiom --
      // never text letters or emoji.
      function seg(cmd, icon, title, cls) {
        var b = h("button", "source-selbar__btn" + (cls ? " " + cls : "")); b.type = "button"; b.title = title;
        b.innerHTML = window.Icon ? window.Icon(icon) : "";
        b.setAttribute("data-cmd", cmd);
        b.addEventListener("mousedown", function (e) { e.preventDefault(); });
        return b;
      }
      bar.appendChild(seg("bold", "bold", "Bold", "source-selbar__rt"));
      bar.appendChild(seg("italic", "italic", "Italic", "source-selbar__rt"));
      bar.appendChild(seg("list", "list", "Dot points", "source-selbar__rt"));
      // source-selbar-block-formats: block-format actions reassign the selected node's TYPE (H1/H2/Body/
      // Caution box), for operating-manual parity. Base edits -> gated behind the unlock (__rt), grouped
      // after the inline three with a separator. Tight set by design: these four + the inline three only.
      bar.appendChild(h("span", "source-selbar__sep source-selbar__rt"));
      bar.appendChild(seg("fmt-h1", "heading-1", "Heading 1", "source-selbar__rt"));
      bar.appendChild(seg("fmt-h2", "heading-2", "Heading 2", "source-selbar__rt"));
      bar.appendChild(seg("fmt-body", "pilcrow", "Body text", "source-selbar__rt"));
      bar.appendChild(seg("fmt-caution", "triangle-alert", "Caution box", "source-selbar__rt"));
      bar.appendChild(h("span", "source-selbar__sep source-selbar__rt"));
      bar.appendChild(seg("alternate", "square-pen", "Add an alternate rendition"));
      bar.appendChild(seg("comment", "message-square", "Comment"));
      // uio-S-C06: mark a passage restricted. Annotation is ungated like alternate and comment —
      // saying "this is controlled" must not require unlocking the prose to say it.
      bar.appendChild(seg("restricted", "shield", "Mark as restricted"));
      // B1: create-link on a source OBJECT (image/table) -- closes the link gap so an image is a full
      // source-of-truth object. Object-only (hidden for text, where linking stays Edit-stage).
      bar.appendChild(seg("link", "link", "Add a link", "source-selbar__obj"));
      bar.appendChild(seg("update", "refresh-cw", "Update the mark to include the appended text", "source-selbar__update"));
      // A2: align segment -- shown only when an IMAGE object owns the bar (hidden for text + tables).
      bar.appendChild(h("span", "source-selbar__sep source-selbar__img"));
      bar.appendChild(seg("align-left", "align-left", "Align left", "source-selbar__img"));
      bar.appendChild(seg("align-center", "align-center", "Align centre", "source-selbar__img"));
      bar.appendChild(seg("align-right", "align-right", "Align right", "source-selbar__img"));
      bar.appendChild(h("span", "source-selbar__sep source-selbar__img"));
      bar.appendChild(seg("row", "columns-2", "Place beside next image", "source-selbar__img")); // A3
      bar.querySelectorAll(".source-selbar__rt").forEach(function (b) { b.style.display = __sourceUnlocked ? "" : "none"; });
      bar.querySelectorAll(".source-selbar__img, .source-selbar__obj").forEach(function (b) { b.style.display = "none"; });
      bar.querySelector('[data-cmd="update"]').style.display = "none";
      bar.querySelectorAll("[data-cmd]").forEach(function (b) {
        b.addEventListener("click", function () { onSourceSelbarAction(topic, b.getAttribute("data-cmd")); });
      });
      return bar;
    }
    function sourceSelBarEl() { return document.querySelector("[data-source-selbar]"); }
    function refreshSourceSelBar() {
      var bar = sourceSelBarEl(); if (!bar) return;
      bar.querySelectorAll(".source-selbar__rt").forEach(function (b) { b.style.display = __sourceUnlocked ? "" : "none"; });
    }
    var __sourceSelAnchor = null, __sourceUpdateTarget = null, __sourceObjectSelKey = null;
    function onSourceSelectionChange() {
      var bar = sourceSelBarEl(); if (!bar || !__sourceMarksEngine) return;
      var anchor = __sourceMarksEngine.selectionAnchor();
      if (!anchor) {
        if (__sourceObjectSelKey) return; // an object selection owns the bar -- don't clear it
        bar.style.display = "none"; __sourceSelAnchor = null; return;
      }
      if (__sourceObjectSelKey) clearSourceObjectSel(); // a real text selection supersedes the object
      __sourceSelAnchor = anchor;
      // ⟳ update if this selection extends past an existing mark; else offer create. The pure
      // decision (SourceDoc.selbarDecision) keeps update/alt/comment visibility consistent for BOTH
      // single- and multi-paragraph anchors -- a cross-paragraph selection still offers alt + comment.
      __sourceUpdateTarget = window.SourceDoc.markExtendedBy(__sourceDocModel, anchor);
      var d = window.SourceDoc.selbarDecision(anchor, __sourceUpdateTarget, __sourceUnlocked);
      var upd = bar.querySelector('[data-cmd="update"]');
      var altB = bar.querySelector('[data-cmd="alternate"]'), cmtB = bar.querySelector('[data-cmd="comment"]');
      upd.style.display = d.showUpdate ? "" : "none";
      altB.style.display = d.showAlt ? "" : "none"; cmtB.style.display = d.showComment ? "" : "none";
      var sel = window.getSelection(); var r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if (!r || !r.width) { bar.style.display = "none"; return; }
      positionSourceSelBar(bar, r);
    }
    // Pin the selection bar over a viewport rect. The bar is absolutely positioned inside
    // #source-stage-article -- a scrollable container offset from the page by the left rail -- so it
    // must use container-relative coords (same conversion as pinCardToSpan). Feeding it raw
    // viewport/page x pushed it right by the rail's width. left = the selection's CENTRE x; the CSS
    // transform: translate(-50%, -132%) then centres the bar over, and lifts it above, the selection.
    // A cross-paragraph edit changes the block structure, so rebuild the article, persist, and restore
    // the caret at the model position the edit reported (the seam where the merge happened).
    function afterSourceStructuralEdit(topic, model, res) {
      if (!res) return;
      persistSourceDocModel(topic, model);
      renderSourceArticle(); // full rebuild (nodes removed/merged) -> re-mounts the marks engine too
      if (res.caret) placeSourceCaret(res.caret.nodeKey, res.caret.offset);
    }
    // Chars before a DOM point within a block element (the caret's plain-text offset in the block).
    function sourceCaretOffsetIn(block, node, offset) {
      try { var r = document.createRange(); r.selectNodeContents(block); r.setEnd(node, offset); return r.toString().length; }
      catch (e) { return 0; }
    }
    // Place the caret at a plain-text offset within a block (walks the block's text nodes).
    function placeSourceCaret(nodeKey, offset) {
      var host = document.getElementById("source-stage-article"); if (!host) return;
      var esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(nodeKey) : String(nodeKey).replace(/["\\\]]/g, "\\$&");
      var el = host.querySelector('[data-node="' + esc + '"]'); if (!el) return;
      var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, acc = 0, target = null, to = 0;
      while ((n = tw.nextNode())) { if (acc + n.length >= offset) { target = n; to = offset - acc; break; } acc += n.length; }
      if (!target) { target = el; to = 0; }
      try { var rg = document.createRange(); rg.setStart(target, to); rg.collapse(true); var s = window.getSelection(); s.removeAllRanges(); s.addRange(rg); } catch (e) {}
    }
    // A1: drag the L/R grab handles on a selected source image to resize it live. Width is symmetric
    // about the image centre (newWidth = 2 x |pointerX - centreX|), snapped lightly to 25/50/75/100%,
    // and committed to node.imgWidth on release (a base edit -> gated behind the unlock, like prose).
    function wireSourceImageResize(topic, art, model) {
      art.addEventListener("pointerdown", function (e) {
        var handle = e.target && e.target.closest ? e.target.closest(".source-doc__handle") : null;
        if (!handle) return;
        var fig = handle.closest(".source-doc__figure[data-node]"); if (!fig) return;
        e.preventDefault(); e.stopPropagation();
        if (!__sourceUnlocked) { sourceToast("The source is locked -- unlock in the toolbar to resize the image."); return; }
        var nodeKey = fig.getAttribute("data-node");
        var wrap = fig.querySelector(".source-doc__imgwrap"); if (!wrap) return;
        var figRect = fig.getBoundingClientRect();
        var colW = figRect.width, centreX = figRect.left + figRect.width / 2;
        if (!colW) return;
        var guide = h("span", "source-doc__resize-guide"); wrap.appendChild(guide);
        fig.classList.add("is-resizing");
        var lastPct = clampSourceImgWidth(wrap.style.width ? parseFloat(wrap.style.width) : 100);
        function move(ev) {
          var pct = snapSourceImgWidth(clampSourceImgWidth(2 * Math.abs(ev.clientX - centreX) / colW * 100));
          lastPct = pct;
          wrap.style.width = pct >= 100 ? "" : pct + "%";
        }
        function up() {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          if (guide.parentNode) guide.remove();
          fig.classList.remove("is-resizing");
          var node = window.SourceDoc.nodeByKey(model, nodeKey); // descends into a row child (A3)
          if (node) {
            if (lastPct >= 100) delete node.imgWidth; else node.imgWidth = lastPct;
            persistSourceDocModel(topic, model);
          }
        }
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      });
    }
    function positionSourceSelBar(bar, r) {
      var host = document.getElementById("source-stage-article"); if (!host || !bar || !r) return;
      var hr = host.getBoundingClientRect();
      bar.style.display = "flex";
      bar.style.left = (r.left + r.width / 2 - hr.left + host.scrollLeft) + "px";
      bar.style.top = (r.top - hr.top + host.scrollTop) + "px";
    }
    // ---- object selection (spec 6): an image/table is selected as a whole node ----------------
    // Selecting an object shows the SAME selbar (alternate + comment only -- no text formatting, no
    // ⟳ update) anchored over the node, with __sourceSelAnchor set to an object anchor { nodeKey }
    // (no start/len). addMark then produces a node-id mark, stable by construction.
    function clearSourceObjectSel() {
      if (!__sourceObjectSelKey) return;
      var el = document.querySelector('[data-node="' + __sourceObjectSelKey + '"]');
      if (el) el.classList.remove("is-object-selected");
      __sourceObjectSelKey = null;
      var bar = sourceSelBarEl(); // drop the object-only controls (A2 align, B1 link) on deselect
      if (bar) bar.querySelectorAll(".source-selbar__img, .source-selbar__obj").forEach(function (b) { b.style.display = "none"; });
    }
    // A2: light the active align glyph (centre is the default when node.align is unset).
    function syncSourceAlignActive(bar, align) {
      bar.querySelectorAll(".source-selbar__img[data-cmd]").forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-cmd") === "align-" + align);
      });
    }
    function selectSourceObject(topic, nodeKey) {
      var SD = window.SourceDoc;
      clearSourceObjectSel();
      __sourceObjectSelKey = nodeKey;
      var el = document.querySelector('[data-node="' + nodeKey + '"]');
      if (el) el.classList.add("is-object-selected");
      var s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); // the two selection models must not fight
      __sourceSelAnchor = { nodeKey: nodeKey }; // object anchor -- no start/len
      __sourceUpdateTarget = null;
      // any existing object mark on this node becomes the active (tinted) one
      var existing = objectMarksOnNode(nodeKey);
      if (__sourceMarksEngine) { __sourceMarksEngine.setActive(existing.length ? existing[0].id : null); repaintSourceMarks(); }
      // show the selbar over the object: annotation actions only, formatting/update hidden
      var bar = sourceSelBarEl();
      if (bar && el) {
        bar.querySelectorAll(".source-selbar__rt").forEach(function (b) { b.style.display = "none"; });
        var upd = bar.querySelector('[data-cmd="update"]'); if (upd) upd.style.display = "none";
        bar.querySelector('[data-cmd="alternate"]').style.display = "";
        bar.querySelector('[data-cmd="comment"]').style.display = "";
        // B1: every markable object (image/table) also gets create-link; lit if it already has one.
        var linkBtn = bar.querySelector('[data-cmd="link"]');
        if (linkBtn) {
          linkBtn.style.display = "";
          var hasLink = objectMarksOnNode(nodeKey).some(function (mk) { return mk.type === "link"; });
          linkBtn.classList.toggle("is-active", hasLink);
          linkBtn.title = hasLink ? "Show where this is linked" : "Add a link";
        }
        // A2: an IMAGE object also gets the align segment (tables/other objects do not).
        var node = (__sourceDocModel && __sourceDocModel.nodes || []).find(function (n) { return n.key === nodeKey; });
        var isImg = node && node.type === "image";
        bar.querySelectorAll(".source-selbar__img").forEach(function (b) { b.style.display = isImg ? "" : "none"; });
        if (isImg) {
          syncSourceAlignActive(bar, sourceImgAlign(node) || "center");
          // A3: the row button toggles meaning by context (in a row -> take out; else -> place beside).
          var rowBtn = bar.querySelector('[data-cmd="row"]');
          if (rowBtn) { var inRow = !!SD.rowOf(__sourceDocModel, nodeKey); rowBtn.title = inRow ? "Take out of the row" : "Place beside next image"; rowBtn.classList.toggle("is-active", inRow); }
        }
        positionSourceSelBar(bar, el.getBoundingClientRect());
      }
      // if the object already carries an alternate or a link, open the matching contextual panel
      var alts = SD.objectAlternatesFor(__sourceDocModel, nodeKey);
      var links = existing.filter(function (mk) { return mk.type === "link"; });
      syncSourceAltPanel(topic, alts.length ? alts[0].id : null);
      syncSourceWherePanel(topic, links.length ? links[0].id : null);
    }
    function objectMarksOnNode(nodeKey) {
      var SD = window.SourceDoc, model = __sourceDocModel;
      return (model && model.marks || []).filter(function (m) { return SD.isObjectMark(m) && m.anchor.nodeKey === nodeKey; });
    }
    function onSourceSelbarAction(topic, cmd) {
      var SD = window.SourceDoc;
      if (cmd === "bold" || cmd === "italic" || cmd === "list") {
        if (!__sourceUnlocked) return;
        if (cmd === "list") document.execCommand("insertUnorderedList"); else document.execCommand(cmd);
        return;
      }
      // source-selbar-block-formats: reassign the selected node(s)' block type. A base edit, so it is
      // gated behind the unlock; applies across a multi-paragraph selection; rides marks (in-place, the
      // node key is kept) + owned undo (SD.setNodeType). Rebuild the article since the element changes.
      if (cmd === "fmt-h1" || cmd === "fmt-h2" || cmd === "fmt-body" || cmd === "fmt-caution") {
        if (!__sourceUnlocked) { sourceToast("The source is locked -- unlock in the toolbar to change a block's format."); return; }
        if (!__sourceSelAnchor || !__sourceDocModel) return;
        var spec = cmd === "fmt-h1" ? { type: "heading", level: 1 }
          : cmd === "fmt-h2" ? { type: "heading", level: 2 }
          : cmd === "fmt-body" ? { type: "paragraph" }
          : { type: "callout", tag: "Caution" };
        var keys = SD.nodesInAnchor(__sourceDocModel, __sourceSelAnchor);
        var changed = 0;
        keys.forEach(function (k) { if (SD.setNodeType(__sourceDocModel, k, spec)) changed++; });
        if (!changed) return;
        persistSourceDocModel(topic, __sourceDocModel);
        renderSourceArticle(); // the element type changed -> full rebuild + re-mount marks
        return;
      }
      // A2: align an image object. Live (set the figure's text-align, keep the selection), persist
      // node.align (centre = the default, stored as none). A base edit -> gated behind the unlock.
      if (cmd === "align-left" || cmd === "align-center" || cmd === "align-right") {
        if (!__sourceObjectSelKey) return;
        if (!__sourceUnlocked) { sourceToast("The source is locked -- unlock in the toolbar to align the image."); return; }
        var al = cmd.slice("align-".length);
        var anode = window.SourceDoc.nodeByKey(__sourceDocModel, __sourceObjectSelKey); // row child too (A3)
        if (!anode) return;
        if (al === "center") delete anode.align; else anode.align = al;
        var fig = document.querySelector('[data-node="' + __sourceObjectSelKey + '"]');
        if (fig) fig.style.textAlign = (al === "center") ? "" : al;
        persistSourceDocModel(topic, __sourceDocModel);
        var bar = sourceSelBarEl(); if (bar) { syncSourceAlignActive(bar, al); if (fig) positionSourceSelBar(bar, fig.getBoundingClientRect()); }
        return;
      }
      // B1: create-link on the selected object (image/table). If it already carries a link, just open
      // the where-used panel. Annotation is ungated, so link-create stays available even when locked.
      if (cmd === "link") {
        if (!__sourceObjectSelKey) return;
        var existLink = objectMarksOnNode(__sourceObjectSelKey).filter(function (mk) { return mk.type === "link"; });
        var linkId;
        if (existLink.length) { linkId = existLink[0].id; }
        else {
          var lm = SD.addMark(__sourceDocModel, { type: "link", anchor: { nodeKey: __sourceObjectSelKey } });
          persistSourceDocModel(topic, __sourceDocModel); repaintSourceMarks();
          linkId = lm.id;
          var lbtn = sourceSelBarEl() && sourceSelBarEl().querySelector('[data-cmd="link"]');
          if (lbtn) { lbtn.classList.add("is-active"); lbtn.title = "Show where this is linked"; }
          sourceToast("Link added. It will list where it's placed as you use it in courses.");
        }
        syncSourceWherePanel(topic, linkId);
        return;
      }
      // A3: "place beside next" -- combine this image with the adjacent one into a side-by-side row,
      // or, if it's already in a row, take it back out. Structural -> gated behind the unlock.
      if (cmd === "row") {
        if (!__sourceObjectSelKey) return;
        if (!__sourceUnlocked) { sourceToast("The source is locked -- unlock in the toolbar to arrange images."); return; }
        var selKey = __sourceObjectSelKey;
        if (SD.rowOf(__sourceDocModel, selKey)) {
          SD.removeFromRow(__sourceDocModel, selKey);
          sourceToast("Took the image out of the row.");
        } else if (SD.combineIntoRow(__sourceDocModel, selKey)) {
          sourceToast("Placed the images side by side.");
        } else {
          sourceToast("Add another image right after this one to place them side by side.");
          return;
        }
        persistSourceDocModel(topic, __sourceDocModel);
        renderSourceArticle();
        selectSourceObject(topic, selKey); // re-select the same image in its new home
        return;
      }
      if (cmd === "update" && __sourceUpdateTarget && __sourceSelAnchor) {
        SD.updateMark(__sourceDocModel, __sourceUpdateTarget.id, __sourceSelAnchor);
        persistSourceDocModel(topic, __sourceDocModel); repaintSourceMarks();
        sourceToast("Updated the mark to include the appended text."); return;
      }
      // uio-S-C06: restriction takes no composer — there is nothing to write. The mark carries no
      // level of its own; the level RESOLVES down uio-F07's ladder, and the card that opens is
      // where you see what applies and where it came from.
      if (cmd === "restricted") {
        var ranchor = __sourceSelAnchor || (__sourceObjectSelKey ? { nodeKey: __sourceObjectSelKey } : null);
        if (!ranchor) return;
        var existing = (__sourceDocModel.marks || []).filter(function (mk) {
          return mk.type === "restricted" && mk.anchor && mk.anchor.nodeKey === ranchor.nodeKey &&
            (ranchor.len == null ? mk.anchor.len == null : (mk.anchor.start === ranchor.start && mk.anchor.len === ranchor.len));
        })[0];
        var rmk = existing || SD.addMark(__sourceDocModel, { type: "restricted", anchor: ranchor });
        if (!existing) {
          SD.logHistory(__sourceDocModel, { type: "restricted-marked", markId: rmk.id, markType: "restricted" });
          persistSourceDocModel(topic, __sourceDocModel);
          refreshSourceHistory(topic);
        }
        repaintSourceMarks();
        revealSourceMark(rmk);
        syncSourceRestrictPanel(topic, rmk.id);
        return;
      }
      if (cmd === "alternate" || cmd === "comment") {
        if (!__sourceSelAnchor) return;
        var anchor = __sourceSelAnchor;
        // object anchors have no text selection to position under -- pin the composer to the node.
        var objRect = null;
        if (anchor.len == null) { var oe = document.querySelector('[data-node="' + anchor.nodeKey + '"]'); if (oe) objRect = oe.getBoundingClientRect(); }
        openSourceComposer(cmd, function (val, tag) {
          if (cmd === "alternate") {
            var mk = SD.addMark(__sourceDocModel, { type: "alternate", anchor: anchor, alt: val, tag: tag || "" });
            SD.logHistory(__sourceDocModel, { type: "alternate-created", markId: mk.id, markType: "alternate", tag: tag || "" });
            persistSourceDocModel(topic, __sourceDocModel); repaintSourceMarks();
            syncSourceAltPanel(topic, mk.id); // open the contextual panel on the new alternate
            refreshSourceHistory(topic); // surface the new alternate in the History timeline (#109)
          } else {
            // comment = a range mark (the anchor) + a shared-canvas comment thread on topic.comments,
            // keyed by the mark id (spec 3.3). Reuses makeComment; open/add logs to History.
            var cmark = SD.addMark(__sourceDocModel, { type: "comment", anchor: anchor });
            topic.comments = topic.comments || [];
            var cm = makeComment({ markId: cmark.id }, val);
            topic.comments.push(cm);
            SD.logHistory(__sourceDocModel, { type: "comment-added", markId: cmark.id, commentId: cm.id });
            persistSourceDocModel(topic, __sourceDocModel); stampTopicUpdated(topic); repaintSourceMarks();
            renderSourceCommentPins(topic);
            refreshSourceHistory(topic); // surface the new comment in the History timeline (#109)
            toggleSourceCommentThread(topic, cmark.id);
          }
          sourceToast(cmd === "alternate" ? "Alternate added." : "Comment added.");
        }, { rect: objRect });
      }
    }
    // A small inline composer positioned under the selection -- the DS idiom for capturing an
    // alternate rendition or a comment (no raw prompt(); the rich pinned panels are the
    // alternates-staleness + comments-adapter tickets). Annotation stays available even when locked.
    function openSourceComposer(mode, onSave, opts) {
      opts = opts || {};
      var existing = document.querySelector("[data-source-composer]"); if (existing) existing.remove();
      var wrap = h("div", "source-composer"); wrap.setAttribute("data-source-composer", "1");
      wrap.appendChild(h("div", "source-composer__lbl", mode === "alternate" ? "Alternate rendition" : "Comment"));
      var ta = h("textarea", "source-composer__text"); ta.placeholder = mode === "alternate" ? "Another way to say this..." : "Add a comment...";
      if (opts.alt != null) ta.value = opts.alt;
      wrap.appendChild(ta);
      // alternates carry an optional tag -- what this rendition is "appropriate for" (spec 3.2).
      var tagIn = null;
      if (mode === "alternate") {
        tagIn = h("input", "source-composer__tag"); tagIn.type = "text";
        tagIn.placeholder = "Appropriate for (optional) -- e.g. quick-start, plain-language";
        if (opts.tag) tagIn.value = opts.tag;
        wrap.appendChild(tagIn);
      }
      var row = h("div", "source-composer__row");
      var cancel = h("button", "source-composer__btn", "Cancel"); cancel.type = "button";
      var save = h("button", "source-composer__btn source-composer__btn--primary", "Save"); save.type = "button";
      row.appendChild(cancel); row.appendChild(save); wrap.appendChild(row);
      var sel = window.getSelection(); var r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      if ((!r || !r.width) && opts.rect) r = opts.rect; // object selection has no text range -- use the node rect
      if (r) { wrap.style.left = (window.scrollX + r.left + r.width / 2) + "px"; wrap.style.top = (window.scrollY + r.bottom + 8) + "px"; }
      document.body.appendChild(wrap);
      function close() { if (wrap.parentNode) wrap.remove(); }
      cancel.addEventListener("click", close);
      save.addEventListener("click", function () { var v = ta.value.trim(); var t = tagIn ? tagIn.value.trim() : undefined; close(); if (v) onSave(v, t); });
      ta.focus();
    }
    // a light transient reminder for the Source stage (the lock reminder + annotation confirms).
    function sourceToast(msg) {
      var t = h("div", "source-toast", msg); document.body.appendChild(t);
      requestAnimationFrame(function () { t.classList.add("is-on"); });
      setTimeout(function () { t.classList.remove("is-on"); setTimeout(function () { if (t.parentNode) t.remove(); }, 220); }, 2600);
    }
    // browser-verify hook (mirrors window.__productRail's own test hooks): lets the Puppeteer
    // harness open a topic, convert it to the continuous-document model, and drive the lock.
    window.__sourceRw = {
      topicHasDoc: topicHasDoc,
      convertTopicToDoc: convertTopicToDoc,
      revertTopicDoc: revertTopicDoc,
      setActiveTopic: function (id) { __sourceActiveTopicId = id; __sourceDocModel = null; __sourceDocModelTopicId = null; __sourceUnlocked = false; },
      setUnlocked: function (v, opts) { setSourceUnlocked(v, opts || { prompt: false }); },
      isUnlocked: function () { return __sourceUnlocked; },
      getModel: function () { return __sourceDocModel; },
      openAltPanel: function (id) { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; syncSourceAltPanel(t, id); },
      altPanelMarkId: function () { return __sourceAltPanelMarkId; },
      addLinkMark: function (anchor, locations) { var SD = window.SourceDoc, t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; var mk = SD.addMark(__sourceDocModel, { type: "link", anchor: anchor, locations: locations || [] }); persistSourceDocModel(t, __sourceDocModel); repaintSourceMarks(); return mk.id; },
      openWherePanel: function (id) { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; syncSourceWherePanel(t, id); },
      wherePanelMarkId: function () { return __sourceWhereUsedMarkId; },
      editBaseNode: function (nodeKey, text) { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; window.SourceDoc.applyTextEdit(__sourceDocModel, nodeKey, text); persistSourceDocModel(t, __sourceDocModel); repaintSourceMarks(); if (__sourceAltPanelMarkId) renderSourceAltPanel(t); },
      addComment: function (anchor, text) { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null, SD = window.SourceDoc; var cmark = SD.addMark(__sourceDocModel, { type: "comment", anchor: anchor }); t.comments = t.comments || []; var cm = makeComment({ markId: cmark.id }, text); t.comments.push(cm); SD.logHistory(__sourceDocModel, { type: "comment-added", markId: cmark.id, commentId: cm.id }); persistSourceDocModel(t, __sourceDocModel); stampTopicUpdated(t); repaintSourceMarks(); renderSourceCommentPins(t); refreshSourceHistory(t); return cmark.id; },
      selectObject: function (nodeKey) { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; selectSourceObject(t, nodeKey); },
      objectSelKey: function () { return __sourceObjectSelKey; },
      objectMarksOnNode: function (nodeKey) { return objectMarksOnNode(nodeKey); },
      addObjectAlternate: function (nodeKey, alt, tag) { var SD = window.SourceDoc, t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; var mk = SD.addMark(__sourceDocModel, { type: "alternate", anchor: { nodeKey: nodeKey }, alt: alt, tag: tag || "" }); SD.logHistory(__sourceDocModel, { type: "alternate-created", markId: mk.id, markType: "alternate", tag: tag || "" }); persistSourceDocModel(t, __sourceDocModel); repaintSourceMarks(); refreshSourceHistory(t); return mk.id; },
      openCommentThread: function (markId) { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; toggleSourceCommentThread(t, markId); },
      openCommentMarkId: function () { return __sourceOpenCommentMarkId; },
      getComments: function () { var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; return t && t.comments; },
      // consolidated-panel: the one right panel's visibility + Marks filter/active-row
      setInfoOpen: function (v) { __sourceInfoOpen = !!v; applySourceInfoVisibility(); updateSourceDocBar(); },
      infoOpen: function () { return __sourceInfoOpen; },
      setMarksFilter: function (f) { __sourceMarksFilter = f; var t = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null; if (t) renderSourceInfoPanel(t); },
      revealMark: function (id) { var m = __sourceDocModel && window.SourceDoc.markById(__sourceDocModel, id); if (m) revealSourceMark(m); },
      activeMarkId: function () { return __sourceActiveMarkId; }
    };


    // source-stage-comments: a topic-wide overview alongside the per-section thread
    // panels -- Open/Resolved/Orphaned, mirroring renderCommentList's own split
    // (editor.js ~17819) and reusing its exact .comment-row/.comment-row__dot/
    // .comment-row__snip classes.
    // #163: renderSourceCommentsPanel (the standalone Comments accordion) is retired -- comments live
    // only in the Marks section's Comments filter tab now, so the panel never double-renders them.

    // md-topic-import + source-rw-history-timeline: a node-based vertical timeline tracing every
    // change on this topic -- newest first. Two provenance streams are merged (spec 5, hybrid
    // granularity):
    //   * IMPORT events (topic.history) -- creation / re-import reconcile passes, timestamped.
    //   * DOC events (the SourceDoc model.history) -- prose edits collapsed into "commit" entries
    //     plus discrete structural events (alternate added, span broke/stale/restored, comment
    //     opened/resolved). These carry an `at` stamp so both streams interleave by time.
    // A hand-created "New topic" with neither stream shows a single synthetic "Created" node. The
    // synthetic "Last edited" node only fills in for legacy topics that have no doc-commit history.
    function renderHistoryTimeline(host, topic) {
      // uio-S-C04 (SRC-11): History is a collapsed FOOTER section (opens on demand) so it stops
      // competing with the marks above it at equal weight.
      var body = panelSection(host, "History", { collapsible: true, defaultOpen: false });
      if (!window.VersoUI || !window.VersoUI.Timeline) return;
      var SD = window.SourceDoc;

      // Import stream -> a common { ts, date, label, detail } row shape.
      var imports = (topic.history || []).map(function (entry) {
        var label = entry.type === "created" ? (entry.file ? ("Imported " + entry.file + [entry.version, entry.publishDate].filter(Boolean).map(function (x) { return " " + x; }).join("")) : "Created") :
          "Re-imported " + entry.file + [entry.version, entry.publishDate].filter(Boolean).map(function (x) { return " " + x; }).join("");
        var details = [entry.sectionsCreated && (entry.sectionsCreated + " new section(s)"),
          entry.sectionsUpdated && (entry.sectionsUpdated + " updated from source"),
          entry.sectionsFlagged && (entry.sectionsFlagged + " flagged for review")].filter(Boolean);
        return { ts: entry.importedAt || 0, importedAt: entry.importedAt, label: label, detail: details.length ? details.join(", ") : null };
      });

      // Doc stream -> the same row shape via the pure SourceDoc.historyEntryView mapping. Prefer
      // the live model when this is the active topic; else read the persisted doc.
      var liveModel = (__sourceDocModel && __sourceDocModelTopicId === topic.id) ? __sourceDocModel : null;
      var docHistory = liveModel ? (liveModel.history || []) : ((topic.doc && topic.doc.history) || []);
      var hasCommit = false;
      var docRows = (SD && SD.historyEntryView) ? docHistory.map(function (e) {
        if (e.type === "commit") hasCommit = true;
        var v = SD.historyEntryView(e);
        return { ts: e.at || 0, importedAt: e.at, label: v.label, detail: v.detail };
      }) : [];

      var rows = imports.concat(docRows);
      // Legacy fallback: no doc commits AND a plain edit is newer than the last import -> a single
      // synthetic "Last edited" node (superseded by real commit entries once the doc is edited).
      if (!hasCommit) {
        var newestImportAt = (topic.history && topic.history.length) ? topic.history[topic.history.length - 1].importedAt : topic.createdAt;
        if (topic.updatedAt && topic.updatedAt > (newestImportAt || 0)) rows.push({ ts: topic.updatedAt, importedAt: topic.updatedAt, label: "Last edited", detail: null });
      }
      if (!rows.length) rows = [{ ts: topic.createdAt || 0, importedAt: topic.createdAt, label: "Created", detail: null }];

      // Newest first; stable order preserves each stream's own sequence when times tie.
      rows.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      // uio-S-C04 (SRC-11): GROUP BY DAY — the date is stated ONCE at the top of each day's run
      // (rows are newest-first, so same-day rows cluster), instead of repeating on every row.
      var lastDate = null;
      var entries = rows.map(function (r) {
        var d = r.importedAt ? new Date(r.importedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
        var showDate = d !== lastDate; lastDate = d;
        return {
          date: showDate ? d : null,
          label: r.label,
          detail: r.detail
        };
      });
      body.appendChild(window.VersoUI.Timeline({ entries: entries }));
    }

    // Matches the established search-field sibling (.vbrowser__search, also reused as
    // .docs-search) rather than the generic TextField control -- VersoUI has no
    // SearchField factory yet (DSLMS documents one in components/browser/SearchField.d.ts
    // but ui-kit.js never built it), so this converges to the real existing pattern
    // instead of introducing a third near-duplicate search input.
    function mountSourceStageSearch() {
      if (typeof document === "undefined") return;
      var host = document.getElementById("source-stage-search"); if (!host) return;
      host.innerHTML = "";
      var U = window.VersoUI;
      // uio-S-C02 (SRC-05): ONE search field. It carries the search icon + input, and (unified doc)
      // an in-field trailing adornment: the match navigator ("3 / 12" + prev/next) and a replace glyph
      // that reveals the replace row on demand. A div (not a label) so the trailing controls click
      // cleanly without stealing input focus; the input fills the field so click-to-type still works.
      var search = h("div", "vbrowser__search source-stage__search-field");
      search.innerHTML = window.Icon ? window.Icon("search") : "";
      var unified = !!activeSourceMaster();
      var input = h("input", "vbrowser__search-input"); input.type = "text"; input.placeholder = unified ? "find in document" : "search topics + text";
      input.value = __sourceSearchQuery;
      input.addEventListener("input", function () {
        __sourceSearchQuery = input.value;
        renderSourceTopicList(); // recomputes __sourceFindMatches + the TOC + the match nav
        if (unified) {
          __sourceFindIndex = 0;
          if (__sourceFindMatches.length) scrollToSourceFindHit(__sourceFindMatches[0]); else clearSourceFindHighlight();
        }
      });
      // Enter cycles to the next match, Shift+Enter to the previous (find-word-cycling).
      if (unified) input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); cycleSourceFind(e.shiftKey ? -1 : 1); } });
      search.appendChild(input);
      if (unified) {
        // In-field adornment: the match navigator ("3 / 12" + prev/next, populated by
        // renderSourceFindNav) + a replace-toggle glyph. Kept in the field so the frequent half of
        // search (the counter) is always where you look, and the rare half (replace) is one glyph away.
        var adorn = h("div", "source-search__adorn");
        var findNav = h("div", "source-find-nav"); findNav.id = "source-find-nav";
        adorn.appendChild(findNav);
        if (U && U.IconButton) {
          var repToggle = U.IconButton({ icon: "replace", label: "Find and replace", onClick: function () {
            __sourceReplaceOpen = !__sourceReplaceOpen; mountSourceStageSearch();
            if (__sourceReplaceOpen) { var ri = host.querySelector(".source-replace__field input"); if (ri) ri.focus(); }
          } });
          repToggle.classList.add("source-search__replace-toggle");
          repToggle.classList.toggle("is-active", __sourceReplaceOpen);
          adorn.appendChild(repToggle);
        }
        search.appendChild(adorn);
      }
      host.appendChild(search);
      // Source find-AND-replace (unified doc only): revealed on demand by the replace glyph. Replacing
      // edits the base prose, so it is gated behind the unlock -- a LOCKED doc shows the reason + keeps
      // the buttons disabled instead of hiding it. Both paths ride owned undo (replaceRange/replaceAll).
      if (unified && __sourceReplaceOpen) {
        var repRow = h("div", "source-replace");
        var locked = !__sourceUnlocked;
        var repWrap = h("div", "vbrowser__search source-stage__search-field source-replace__field");
        repWrap.innerHTML = window.Icon ? window.Icon("replace") : "";
        var repInput = h("input", "vbrowser__search-input"); repInput.type = "text"; repInput.placeholder = "replace with"; repInput.value = __sourceReplaceQuery; repInput.disabled = locked;
        repInput.addEventListener("input", function () { __sourceReplaceQuery = repInput.value; });
        repWrap.appendChild(repInput);
        repRow.appendChild(repWrap);
        var repBtns = h("div", "source-replace__btns");
        if (U && U.Button) {
          var repOne = U.Button({ variant: "secondary", size: "sm", label: "Replace", title: "Replace the current match", onClick: function () { replaceCurrentSourceMatch(); } });
          var repAll = U.Button({ variant: "secondary", size: "sm", label: "Replace all", title: "Replace every match", onClick: function () { replaceAllSourceMatches(); } });
          if (locked) { [repOne, repAll].forEach(function (b) { b.setAttribute("disabled", "disabled"); b.title = "Unlock the source (toolbar) to replace text"; }); }
          repBtns.appendChild(repOne); repBtns.appendChild(repAll);
        }
        repRow.appendChild(repBtns);
        if (locked) repRow.appendChild(h("div", "source-replace__lockhint insp-hint", "The source is locked — unlock in the toolbar to replace text."));
        host.appendChild(repRow);
      }
      renderSourceFindNav(); // populate the in-field match navigator
    }
    // Replace the current find match (find-word-cycling's highlighted hit) with the replace text. Gated
    // behind the unlock; rides replaceRange -> owned undo + mark-shift. Re-runs the find so the count +
    // highlight track the edited document, staying on the same match index.
    function replaceCurrentSourceMatch() {
      var SD = window.SourceDoc, topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      if (!SD || !topic || !__sourceDocModel) return;
      if (!__sourceUnlocked) { sourceToast("The source is locked -- unlock in the toolbar to replace text."); return; }
      var m = __sourceFindMatches[__sourceFindIndex]; if (!m) { sourceToast("No match selected."); return; }
      SD.replaceRange(__sourceDocModel, { nodeKey: m.nodeKey, start: m.start, len: m.len }, __sourceReplaceQuery);
      persistSourceDocModel(topic, __sourceDocModel);
      renderSourceArticle();
      renderSourceTopicList(); // recomputes __sourceFindMatches against the edited doc
      if (__sourceFindMatches.length) { if (__sourceFindIndex >= __sourceFindMatches.length) __sourceFindIndex = 0; scrollToSourceFindHit(__sourceFindMatches[__sourceFindIndex]); }
    }
    // Replace every match in the document (one owned-undo step). Gated behind the unlock; toasts the count.
    function replaceAllSourceMatches() {
      var SD = window.SourceDoc, topic = __sourceActiveTopicId ? libComponents()[__sourceActiveTopicId] : null;
      if (!SD || !topic || !__sourceDocModel) return;
      if (!__sourceUnlocked) { sourceToast("The source is locked -- unlock in the toolbar to replace text."); return; }
      var q = __sourceSearchQuery; if (!q) { sourceToast("Type something to find first."); return; }
      var n = SD.replaceAll(__sourceDocModel, q, __sourceReplaceQuery);
      persistSourceDocModel(topic, __sourceDocModel);
      renderSourceArticle();
      renderSourceTopicList();
      sourceToast(n ? ("Replaced " + n + " match" + (n === 1 ? "" : "es") + ".") : "Nothing to replace.");
    }

    function newTopicModal() {
      // uio-W01 took away the top-bar picker this used to read. uio-W14 took away the last reason
      // to refuse: a source document no longer needs a Product. With no Product to write into, this
      // makes SHARED material -- which is a legitimate document, not a fallback.
      var productId = activeSourceProductId();
      promptModal("New Topic", "Name", "", function (name) {
        if (!(name || "").trim()) return;
        if (!productId) { createSourceDocument(name, ""); renderSourceStage(); return; }
        var topic = createTopic(name, productId, []); // LibraryStore write, not doc -- no pushHistory
        __sourceActiveTopicId = topic.id;
        // new-product first-run: for an empty Product this is the FIRST chapter, so mint the unified
        // master immediately (renderSourceStage -> ensureUnifiedDocForActiveProduct migrates the new
        // topic into a master) rather than leaving a loose topic until the stage is re-entered. Matches
        // the import path (finishMarkdownImport), so "start writing" and "import" seed the same way.
        renderSourceStage();
      });
    }

    // uio-W14: MINT A SOURCE DOCUMENT, product-optional.
    //
    // This is the mechanism the Files creation actions (uio-W08) call; the Source stage uses it for
    // the shared case above. It writes the reserved master directly rather than going through the
    // loose-topic-then-migrate path, because there is nothing to migrate -- a new document has no
    // prior chapters -- and because a shared document has no Product to run that migration for.
    //
    // A product that has no primary yet gets this one: `groundTruthId` is set only when it is empty,
    // so creating a second source document for a product NEVER silently displaces its primary. That
    // second document is simply an extra a design document can attach.
    function createSourceDocument(name, productId) {
      var pid = (productId && window.ProductsStore[productId]) ? productId : "";
      var master = createTopic(name || "Untitled source", pid, []);
      master.sourceMaster = true;
      if (window.SourceDoc) master.doc = window.SourceDoc.toJSON(window.SourceDoc.create([]));
      master.updatedAt = Date.now();
      var product = pid && window.ProductsStore[pid];
      if (product && !product.groundTruthId) { product.groundTruthId = master.id; saveProducts(); }
      saveLibrary();
      __sourceActiveTopicId = master.id;
      __sourceDocModel = null; __sourceDocModelTopicId = null;
      try { localStorage.setItem(SOURCE_TOPIC_PERSIST_KEY, master.id); } catch (e) {}
      return master;
    }

    // ---- uio-W10: Source's own tab strip -------------------------------------
    //
    // SOURCE HAS NEVER HAD A DOCUMENT SWITCHER. It resolved exactly one master from the global
    // product and showed it, so "have two manuals open and compare them" was not a thing you could
    // do -- and after uio-W14 made source documents product-optional, a shared glossary had no way
    // to sit beside the product manual it explains.
    //
    // The strip holds ONLY source documents. Edit's holds only design documents. They are two
    // strips over two stores rather than one strip filtered two ways, because a design document is
    // a registry entry and a source document is a LibraryStore component, and pretending they are
    // the same kind of thing is what made the old single strip need a Product filter in the first
    // place.
    var OPEN_SOURCE_DOCS_KEY = "authoring.openSourceDocIds";
    var __openSourceDocIds = null;

    function openSourceDocIds() {
      if (__openSourceDocIds) return __openSourceDocIds;
      var saved = [];
      try { saved = JSON.parse(localStorage.getItem(OPEN_SOURCE_DOCS_KEY) || "[]"); } catch (e) { saved = []; }
      // Reconciled on read for the same reason Edit's set is at boot: the open set lives in a
      // separate store from the documents, so deleting one elsewhere leaves the strip holding a key
      // nothing answers to.
      __openSourceDocIds = window.VersoProductRail.visibleSourceTabIds(Array.isArray(saved) ? saved : [], libComponents());
      return __openSourceDocIds;
    }
    function saveOpenSourceDocIds() {
      try { localStorage.setItem(OPEN_SOURCE_DOCS_KEY, JSON.stringify(openSourceDocIds())); } catch (e) {}
    }
    // Opening a document adds it to the strip. Idempotent: opening one that is already open makes
    // it active rather than adding a second tab for it.
    function openSourceDoc(id) {
      if (!window.SourceOwnership.isSourceDocument(libComponents()[id])) return;
      var ids = openSourceDocIds();
      if (ids.indexOf(id) === -1) { ids.push(id); saveOpenSourceDocIds(); }
      if (__sourceActiveTopicId === id) return;
      __sourceActiveTopicId = id;
      __sourceActiveVariants = [];          // a different document may declare a different variant set
      __sourceEditingCell = null;           // never carry an in-progress edit across documents
      __sourceDocModel = null; __sourceDocModelTopicId = null;
      __sourceUnlocked = false;             // every document opens locked (base prose protected)
      try { localStorage.setItem(SOURCE_TOPIC_PERSIST_KEY, id); } catch (e) {}
      renderSourceStage();
    }
    function closeSourceTab(id) {
      var ids = openSourceDocIds();
      var idx = ids.indexOf(id);
      if (idx === -1) return;
      ids.splice(idx, 1);
      saveOpenSourceDocIds();
      if (__sourceActiveTopicId === id) {
        var next = ids[Math.max(0, idx - 1)];
        // Closing the last tab leaves the strip empty rather than refusing. Source resolves what to
        // show on the next render, so an empty strip is a state the stage already knows how to be
        // in -- unlike Edit, where there is always a document on the canvas.
        if (next) { openSourceDoc(next); return; }
        __sourceActiveTopicId = null; __sourceDocModel = null; __sourceDocModelTopicId = null;
        try { localStorage.removeItem(SOURCE_TOPIC_PERSIST_KEY); } catch (e) {}
      }
      renderSourceStage();
    }
    function renderSourceTabs() {
      if (typeof document === "undefined") return;
      var host = document.getElementById("source-tabs"); if (!host) return;
      var U = window.VersoUI; if (!U || !U.DocumentTab) return;
      host.innerHTML = "";
      var comps = libComponents();
      var ids = window.VersoProductRail.visibleSourceTabIds(openSourceDocIds(), comps);
      var open = ids.map(function (id) { return comps[id]; });
      // uio-W11: the same overflow rule Edit's strip follows -- tabs never shrink, the remainder
      // goes into a `+N more`, and the open document is always among the shown.
      var split = window.VersoProductRail.tabOverflow(ids, __sourceActiveTopicId);
      split.shown.map(function (id) { return comps[id]; }).forEach(function (c) {
        // The per-product colour dot survives from the Edit strip as IDENTITY, keyed on the stable
        // productId so a rename never shifts the colour. Shared material carries no dot, which is
        // the honest rendering of "belongs to no product".
        var pid = c.productId || "";
        var prod = pid && window.ProductsStore ? window.ProductsStore[pid] : null;
        host.appendChild(U.DocumentTab({
          label: c.name || c.id,
          active: c.id === __sourceActiveTopicId,
          dot: pid ? colourForName(pid) : null,
          dotTitle: pid ? ("Product: " + ((prod && prod.name) || pid)) : "No product — shared, cross-product material",
          icon: U.DOCUMENT_TYPES.source.icon,
          type: "source",
          typeLabel: U.DOCUMENT_TYPES.source.label,
          onSelect: function () { openSourceDoc(c.id); },
          onClose: function () { closeSourceTab(c.id); }
        }));
      });
      // The strip states what it holds. On Source that is "2 open"; the product count appears only
      // when the strip actually spans more than one, so the mixed-product fact is stated rather
      // than left to be inferred from the dots.
      var tail = h("div", "toolbar-tabs__tail");
      if (split.hidden.length) {
        var more = h("button", "toolbar-tabs__more", "+" + split.hidden.length + " more");
        more.type = "button";
        more.title = split.hidden.length + " more open source document" + (split.hidden.length === 1 ? "" : "s");
        more.addEventListener("click", function (e) {
          var r = e.currentTarget.getBoundingClientRect();
          showContextMenu(r.left, r.bottom + 4, [{ head: "Also open" }].concat(split.hidden.map(function (id) {
            return { label: (comps[id] && comps[id].name) || id, onClick: function () { openSourceDoc(id); } };
          })));
        });
        tail.appendChild(more);
      }
      // The meta counts EVERYTHING open, not just what fits.
      var meta = window.VersoProductRail.stripMeta(open);
      if (meta.open) tail.appendChild(h("span", "source-stage__tabs-meta", meta.label));
      if (tail.childNodes.length) host.appendChild(tail);
    }

    // Called each time Source becomes the active stage (setStage("source")) -- mounts the
    // search field once, then re-renders the toolbar + topic list + article from current
    // state (the toolbar is now state-reactive -- see renderSourceToolbar -- so it's built
    // inside renderSourceTopicList, not mounted separately).
    // platform-pivot 35: a source document's body may not be in the page yet. The bootstrap ships
    // the bodies the first CANVAS render needs; a source document the author navigates to is
    // fetched here, on the click. Returns true when it started a fetch, so the caller can render
    // a waiting state instead of the body it does not have.
    //
    // This is the guard that keeps "deferred" from ever being mistaken for "empty". Without it,
    // opening an unloaded source document would show a blank article -- and blank content does not
    // look like a failure, it looks like a document somebody emptied.
    function hydrateIfDeferred(id, then) {
      if (!id || !window.__versoTopicDeferred || !window.__versoTopicDeferred(id)) return false;
      window.__versoHydrateTopic(id).then(function () { if (then) then(); });
      return true;
    }

    function renderSourceStage() {
      // Source v2: the source is ONE continuous document. Resolve (and materialise on first entry)
      // the master to open, so the stage shows the document, not a topic list.
      var master = ensureUnifiedDocForActiveProduct();
      // Hydrate before rendering. `master` is present either way -- only its BODY is deferred --
      // so this never causes ensureUnifiedDocFor to mistake it for missing and mint a second one.
      if (master && hydrateIfDeferred(master.id, renderSourceStage)) {
        __sourceActiveTopicId = master.id;
        var host = document.getElementById("source-article");
        if (host) host.textContent = "Loading this source document\u2026";
        return;
      }
      if (master) {
        __sourceActiveTopicId = master.id;
        __sourceDocModel = null; __sourceDocModelTopicId = null; // rebind if the document changed
        try { localStorage.setItem(SOURCE_TOPIC_PERSIST_KEY, master.id); } catch (e) {}
        // uio-W10: whatever the stage resolved is, by definition, open. This is what puts the first
        // tab in the strip on a fresh install without a separate seeding path.
        var ids = openSourceDocIds();
        if (ids.indexOf(master.id) === -1) { ids.push(master.id); saveOpenSourceDocIds(); }
      } else if (!__sourceActiveTopicId) {
        // no unified doc yet (no Product / no topics) -> restore the last-open topic on a fresh load
        try { var savedT = localStorage.getItem(SOURCE_TOPIC_PERSIST_KEY); if (savedT && libComponents()[savedT]) __sourceActiveTopicId = savedT; } catch (e) {}
      }
      renderSourceTabs();
      // uio-W12: what this source document belongs to, above the outline. It reads the open
      // document; it never narrows the outline beneath it.
      if (typeof E.renderSourceProductPanel === "function") E.renderSourceProductPanel(activeSourceMaster());
      mountSourceStageSearch();
      renderSourceTopicList();
      renderSourceArticle();
    }

    // Minimal write path other tickets (source-topic-content-authoring) build their
    // authoring UI on top of -- same "ship the mechanism, UI follows" precedent as
    // createProduct(). Not wired to any Source-stage control in this ticket (view-only).
    // extra (md-topic-import): optional { key, source, variantSources, historyEntry } --
    // key is the matching handle a later re-import uses to find this topic again;
    // source/variantSources are plain display metadata (which manual file/version/publish
    // date this came from); historyEntry seeds topic.history (the info panel's node
    // timeline) with this creation event. A blank "New topic" never sets any of these --
    // they're import-only.
    function createTopic(name, productId, sections, extra) {
      var comps = libComponents();
      var id = "topic-" + Math.random().toString(36).slice(2, 8);
      while (comps[id]) id = "topic-" + Math.random().toString(36).slice(2, 8);
      var now = Date.now();
      var topic = { id: id, kind: "topic", name: (String(name || "").trim() || "Untitled topic"),
        productId: productId || undefined, sections: sections || [], createdAt: now, updatedAt: now };
      if (extra && extra.key != null) topic.key = extra.key;
      if (extra && extra.source) topic.source = extra.source;
      if (extra && extra.variantSources) topic.variantSources = extra.variantSources;
      if (extra && extra.historyEntry) topic.history = [extra.historyEntry];
      window.LibraryStore.components[id] = topic;
      saveLibrary();
      return topic;
    }
    window.__productRail.createTopic = createTopic;
    window.__productRail.renderSourceStage = renderSourceStage; // headless/browser-verify hook

    // ---- Source v2: unify a Product's topic docs into ONE continuous document (spec 2c section 1) ----
    // A Product's source becomes ONE document. It is stored as a reserved "source master"
    // component (kind:"topic", sourceMaster:true) pointed to by product.groundTruthId -- the
    // already-reserved seam (:1212). This reuses the whole topic-keyed Source stage (doc
    // round-trip, marks/variants, lock, every __sourceRw hook) with the least churn instead of a
    // new product.sourceDoc content path the topic nav has no slot for. The migration is guarded
    // (idempotent -- re-running returns the existing master) and REVERSIBLE: the old per-topic
    // docs are KEPT, only stamped archivedInto:<masterId>, so a revert restores the pre-migration
    // nav exactly (nothing is ever deleted). The heavy lifting -- concatenating N topic models
    // into one, re-keying on collision, and riding every mark/variant/history reference across --
    // is SourceDoc.concatChapters (a pure, headlessly-tested core).

    // The reserved source-master component for a Product (via product.groundTruthId), or null.
    function sourceMasterFor(productId) {
      var p = productId && window.ProductsStore[productId];
      if (!p || !p.groundTruthId) return null;
      var m = libComponents()[p.groundTruthId];
      return (m && m.sourceMaster) ? m : null;
    }
    // The topics that feed a Product's unified doc, in the author's canonical reading order.
    // Excludes the reserved master itself and any topic already archived into one.
    function unifiableTopicsFor(productId) {
      var comps = libComponents();
      var all = Object.keys(comps).map(function (k) { return comps[k]; })
        .filter(function (t) { return t && t.kind === "topic" && !t.sourceMaster && !t.archivedInto && (t.productId || "") === (productId || ""); });
      canonicalizeTopicOrder(all);
      return all.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    }
    // Build the unified model from a Product's topics without persisting: each topic contributes
    // its live doc model (a legacy section topic is converted on the fly), concatenated to chapters.
    function buildUnifiedModelFor(productId) {
      var SD = window.SourceDoc; if (!SD) return null;
      var chapters = unifiableTopicsFor(productId).map(function (t) {
        var model = topicHasDoc(t) ? SD.fromJSON(t.doc) : SD.fromSections(t, resolveTopicBaseText);
        return { name: t.name, model: model };
      });
      return SD.concatChapters(chapters);
    }
    // Migrate a Product to one unified document. Guarded: returns the existing master untouched if
    // one already exists (unless opts.force rebuilds it from the current topics). Concatenates the
    // Product's topics into a reserved master, points product.groundTruthId at it, and stamps each
    // source topic archivedInto:<masterId> (kept, not deleted). Reversible via revertProductUnifiedDoc.
    function migrateProductToUnifiedDoc(productId, opts) {
      opts = opts || {};
      var SD = window.SourceDoc; if (!SD) return null;
      var product = productId && window.ProductsStore[productId];
      if (!product) return null;
      var existing = sourceMasterFor(productId);
      if (existing && !opts.force) return existing;
      var topics = unifiableTopicsFor(productId);
      var unified = buildUnifiedModelFor(productId);
      var master = existing;
      if (!master) {
        master = createTopic(product.name || "Source", productId, []);
        master.sourceMaster = true;
      }
      master.doc = SD.toJSON(unified);
      master.updatedAt = Date.now();
      // provenance fix: carry the imported source stamp onto the unified master so it reports the real
      // origin, not "Authored in Verso". Take the first constituent that was imported; keep its
      // variantSources too. (Already-migrated masters with no stamp are repaired read-time by
      // resolveTopicSource.)
      if (!master.source) {
        var imported = topics.filter(function (t) { return t && t.source; })[0];
        if (imported) { master.source = imported.source; if (imported.variantSources) master.variantSources = imported.variantSources; }
      }
      product.groundTruthId = master.id;
      topics.forEach(function (t) { t.archivedInto = master.id; });
      saveLibrary();
      saveProducts();
      return master;
    }
    // Reverse the migration: drop the reserved master, clear product.groundTruthId, and un-archive
    // the source topics -> the pre-migration Source nav is restored exactly (nothing was deleted).
    function revertProductUnifiedDoc(productId) {
      var product = productId && window.ProductsStore[productId];
      if (!product) return false;
      var masterId = product.groundTruthId;
      var comps = libComponents();
      Object.keys(comps).forEach(function (k) { if (comps[k] && comps[k].archivedInto === masterId) delete comps[k].archivedInto; });
      if (masterId && comps[masterId] && comps[masterId].sourceMaster) delete comps[masterId];
      delete product.groundTruthId;
      saveLibrary();
      saveProducts();
      return true;
    }
    window.__productRail.applySourceChapterMove = applySourceChapterMove; // browser-verify: chapter drag-reorder
    window.__productRail.sourceMasterFor = sourceMasterFor;
    window.__productRail.unifiableTopicsFor = unifiableTopicsFor;
    window.__productRail.buildUnifiedModelFor = buildUnifiedModelFor;
    window.__productRail.migrateProductToUnifiedDoc = migrateProductToUnifiedDoc;
    window.__productRail.revertProductUnifiedDoc = revertProductUnifiedDoc;

    // Applies one MarkdownImport.reconcileSection() verdict to a REAL section (or creates
    // it, when none existed yet) -- "update"/"track" adopt the fresh text and clear any
    // stale flag; "flag" leaves the author's text untouched and parks the source's version
    // in section.sourceUpdate for review; "noop" touches nothing. Always returns the
    // resolved section object (new or existing) so a caller can chain into its overrides.
    function applySectionReconcile(topic, existingSec, freshSection, decision) {
      if (decision.action === "create") {
        var sec = { id: "sec-" + Math.random().toString(36).slice(2, 8), key: freshSection.key, heading: freshSection.heading, facets: { technical: freshSection.text }, lastImportedText: freshSection.text };
        topic.sections.push(sec);
        return sec;
      }
      if (decision.action === "update" || decision.action === "track") {
        existingSec.facets.technical = freshSection.text;
        existingSec.lastImportedText = freshSection.text;
        delete existingSec.sourceUpdate;
      } else if (decision.action === "flag") {
        existingSec.sourceUpdate = { text: freshSection.text };
      }
      return existingSec; // noop/update/track/flag all keep the same object
    }
    // Same verdict, applied to one variant's override text instead of the section's own
    // Flagship facets -- same three-way safety (only ever auto-applies when nothing of the
    // author's is at risk of being lost).
    function applyVariantReconcile(sec, variant, freshText, decision) {
      if (decision.action === "create" || decision.action === "update" || decision.action === "track") {
        sec.overrides = sec.overrides || {};
        sec.overrides[variant] = { facets: { technical: freshText }, lastImportedText: freshText };
      } else if (decision.action === "flag") {
        sec.overrides = sec.overrides || {};
        sec.overrides[variant] = sec.overrides[variant] || { facets: {} };
        sec.overrides[variant].sourceUpdate = { text: freshText };
      }
    }
    // Product Rail (md-topic-import): turns a MarkdownImport parse's topics (already
    // variant-merged, if any) into real LibraryStore topic components. First import of a
    // given (Product, source file) creates fresh topics via createTopic, stamped with the
    // key/source a later re-import matches on. A re-import of the SAME (Product, file)
    // reconciles instead of duplicating: matches existing topics/sections by key, and lets
    // MarkdownImport.reconcileSection decide create/update/flag/noop per section (and per
    // variant override) so nothing hand-authored is ever silently overwritten.
    // meta (optional): { file, version, publishDate, variantMeta: {variantName: {...}} }.
    function importParsedTopics(parsedTopics, productId, meta) {
      meta = meta || {};
      var topicCount = 0, sectionCount = 0, updatedCount = 0, flaggedCount = 0;
      var comps = libComponents();
      var existingForSource = meta.file ? Object.keys(comps).map(function (k) { return comps[k]; }).filter(function (t) {
        return t.kind === "topic" && t.productId === productId && t.source && t.source.file === meta.file;
      }) : [];
      var sourceStamp = meta.file ? { file: meta.file, version: meta.version, publishDate: meta.publishDate, importedAt: Date.now() } : undefined;

      parsedTopics.forEach(function (t) {
        var existingTopic = existingForSource.filter(function (et) { return et.key === t.key; })[0];
        if (!existingTopic) {
          var sections = t.sections.map(function (s) {
            var sec = { id: "sec-" + Math.random().toString(36).slice(2, 8), key: s.key, heading: s.heading, facets: { technical: s.text }, lastImportedText: s.text };
            if (s.overrides) {
              sec.overrides = {};
              Object.keys(s.overrides).forEach(function (v) { sec.overrides[v] = { facets: { technical: s.overrides[v] }, lastImportedText: s.overrides[v] }; });
            }
            sectionCount++;
            return sec;
          });
          var historyEntry = sourceStamp ? { type: "created", file: sourceStamp.file, version: sourceStamp.version, publishDate: sourceStamp.publishDate, importedAt: sourceStamp.importedAt, sectionsCreated: sections.length } : undefined;
          createTopic(t.name, productId, sections, { key: t.key, source: sourceStamp, variantSources: meta.variantMeta, historyEntry: historyEntry });
          topicCount++;
          return;
        }
        var runCreated = 0, runUpdated = 0, runFlagged = 0;
        t.sections.forEach(function (s) {
          var existingSec = existingTopic.sections.filter(function (es) { return es.key === s.key; })[0];
          var decision = window.MarkdownImport.reconcileSection(existingSec ? { text: existingSec.facets.technical, lastImportedText: existingSec.lastImportedText } : null, s.text);
          var resolvedSec = applySectionReconcile(existingTopic, existingSec, s, decision);
          if (decision.action === "create") { sectionCount++; runCreated++; }
          else if (decision.action === "update" || decision.action === "track") { updatedCount++; runUpdated++; }
          else if (decision.action === "flag") { flaggedCount++; runFlagged++; }
          if (s.overrides) {
            Object.keys(s.overrides).forEach(function (v) {
              var vExisting = resolvedSec.overrides && resolvedSec.overrides[v];
              var vDecision = window.MarkdownImport.reconcileSection(vExisting ? { text: vExisting.facets.technical, lastImportedText: vExisting.lastImportedText } : null, s.overrides[v]);
              applyVariantReconcile(resolvedSec, v, s.overrides[v], vDecision);
              if (vDecision.action === "flag") { flaggedCount++; runFlagged++; }
            });
          }
        });
        // Stamped with sourceStamp.importedAt, NOT a fresh Date.now() -- both must read as
        // the SAME moment, or updatedAt (a few ms later in real time) would always look
        // newer than the history entry it belongs to, wrongly triggering a phantom
        // "Last edited" timeline node on every reconcile even when nothing was hand-edited.
        existingTopic.updatedAt = sourceStamp ? sourceStamp.importedAt : Date.now();
        if (sourceStamp) {
          existingTopic.source = sourceStamp;
          existingTopic.history = existingTopic.history || [];
          existingTopic.history.push({
            type: "reimport", file: sourceStamp.file, version: sourceStamp.version, publishDate: sourceStamp.publishDate,
            importedAt: sourceStamp.importedAt, sectionsCreated: runCreated, sectionsUpdated: runUpdated, sectionsFlagged: runFlagged
          });
        }
        if (meta.variantMeta) existingTopic.variantSources = meta.variantMeta;
      });
      saveLibrary();
      return { topicCount: topicCount, sectionCount: sectionCount, updatedCount: updatedCount, flaggedCount: flaggedCount };
    }
    window.__productRail.importParsedTopics = importParsedTopics; // headless/browser-verify hook

    function readFileAsText(file) {
      return new Promise(function (resolve) {
        var r = new FileReader();
        r.onload = function () { resolve(String(r.result == null ? "" : r.result)); };
        r.onerror = function () { resolve(""); };
        r.readAsText(file);
      });
    }

    // A lightweight version + publish-date prompt per file about to be imported -- optional,
    // but it's what a later re-import shows in the info panel ("what changed and when").
    // One small step regardless of path: neither a native file picker nor the file-input
    // modal has anywhere to type free text, so this always runs right after file(s) are
    // chosen and right before anything is actually parsed/written.
    function promptImportProvenance(fileEntries, onDone) {
      var values = fileEntries.map(function () { return { version: "", publishDate: "" }; });
      var shell = dsModalShell({
        title: "Manual details",
        subtitle: "Optional — lets a later re-import of the same file show what changed and when.",
        primaryLabel: "Import",
        onPrimary: function () {
          shell.modal.close();
          onDone(fileEntries.map(function (f, i) { return { key: f.key, file: f.file, version: values[i].version, publishDate: values[i].publishDate }; }));
        }
      });
      fileEntries.forEach(function (f, i) {
        var vIn = modalText(shell.body, f.label + " version", "", "e.g. v1.4");
        vIn.addEventListener("input", function () { values[i].version = vIn.value; });
        var dIn = modalText(shell.body, f.label + " published", "", "e.g. 2026-06-24");
        dIn.addEventListener("input", function () { values[i].publishDate = dIn.value; });
      });
    }

    // product-rail-rename-tolerant-match: re-import matches by filename (see
    // importParsedTopics), so renaming the source file on disk would otherwise silently
    // start an unrelated second lineage of topics. Before treating an unrecognised
    // filename as brand new, check whether it substantially overlaps with topics already
    // bound to some OTHER file for this Product (MarkdownImport.detectRenamedSource);
    // if so, ask before doing anything -- never auto-applies a guess. Flagship file only
    // (the primary import's own filename); scoped this way so variant-file rename
    // tolerance can follow later without complicating this pass. onDone(meta) always
    // fires eventually, whichever choice is made (or if there was nothing to ask about).
    function checkRenamedSource(productId, meta, parsedTopics, onDone) {
      if (!meta || !meta.file) { onDone(meta); return; }
      var allForProduct = Object.keys(libComponents()).map(function (k) { return libComponents()[k]; }).filter(function (t) {
        return t.kind === "topic" && t.productId === productId && t.source && t.source.file;
      });
      var alreadyBound = allForProduct.some(function (t) { return t.source.file === meta.file; });
      if (alreadyBound || !allForProduct.length) { onDone(meta); return; }
      var filesToKeys = {};
      allForProduct.forEach(function (t) { (filesToKeys[t.source.file] = filesToKeys[t.source.file] || []).push(t.key); });
      var candidate = window.MarkdownImport.detectRenamedSource(filesToKeys, parsedTopics.map(function (t) { return t.key; }));
      if (!candidate) { onDone(meta); return; }
      var shell = dsModalShell({
        title: "Same manual, new filename?",
        subtitle: '"' + meta.file + '" substantially matches topics already imported from "' + candidate.file + '" (' +
          candidate.matched + " of " + candidate.total + " topics). Treat it as an update to that source, or keep them separate?",
        primaryLabel: "Yes, same manual",
        extras: window.VersoUI ? [window.VersoUI.Button({
          variant: "secondary", label: "No, keep separate",
          onClick: function () { shell.modal.close(); onDone(meta); }
        })] : [],
        onPrimary: function () {
          allForProduct.forEach(function (t) { if (t.source.file === candidate.file) t.source.file = meta.file; });
          saveLibrary();
          shell.modal.close();
          onDone(meta);
        }
      });
    }

    // Shared tail end of an import, whether it came from the one-click no-variant path or
    // the multi-file modal: merge any variant parses in, write/reconcile real topics,
    // re-render, and report a short summary through the canonical confirmModal (never a raw
    // window.alert for anything beyond a single-sentence hard failure -- /verso-frontend
    // Tier 2 review).
    function finishMarkdownImport(baseParse, variantParses, productId, meta) {
      var warnings = baseParse.warnings.slice();
      var variantMeta = {};
      (variantParses || []).forEach(function (vp) {
        warnings = warnings.concat(vp.parse.warnings.map(function (w) { return "[" + vp.name + "] " + w; }));
        warnings = warnings.concat(window.MarkdownImport.mergeVariant(baseParse.topics, vp.parse, vp.name));
        if (vp.meta) variantMeta[vp.name] = vp.meta;
      });
      var result = importParsedTopics(baseParse.topics, productId, {
        file: meta && meta.file, version: meta && meta.version, publishDate: meta && meta.publishDate,
        variantMeta: Object.keys(variantMeta).length ? variantMeta : undefined
      });
      // Source v2: the imported topics seed the ONE continuous document. Land in the unified stage so
      // the topics->unified migration fires now (renderSourceStage -> ensureUnifiedDocForActiveProduct),
      // rather than stranding the author in the retired topic/section view -- its second left panel +
      // "Switch to continuous document" button -- until the next stage entry (pilot 2026-07-28).
      renderSourceStage();
      var parts = [];
      if (result.topicCount) parts.push(result.topicCount + " new topic(s)");
      if (result.sectionCount) parts.push(result.sectionCount + " new section(s)");
      if (result.updatedCount) parts.push(result.updatedCount + " section(s) updated from source");
      if (result.flaggedCount) parts.push(result.flaggedCount + " section(s) flagged for review (changed both here and in the source since the last import)");
      var summary = parts.length ? parts.join(", ") + "." : "Nothing changed since the last import.";
      if (warnings.length) summary += " " + warnings.length + " other item(s) may need review.";
      confirmModal("Import from Markdown", summary, function () {});
    }

    // "Import from Markdown…": one primary (Flagship) .md, plus one optional .md per the
    // active Product's already-declared variants (no free-form variant-name entry -- the
    // variant list is fixed by ProductsStore[id].variants, same source buildVariantPillsRow
    // reads). A Product with NO declared variants only ever needs one file, so it matches
    // the established one-click precedent exactly (glossary's importCsv, editor.js -- click
    // the button, the native file picker opens immediately, no intermediate modal at all).
    // The modal only exists for the multi-file case a single click structurally can't do:
    // mapping several files to several variant names at once. Re-running this against the
    // SAME filename for a Product that already has topics from it reconciles instead of
    // duplicating -- see importParsedTopics.
    // ---- Source v2: additive Markdown import into the ONE document (md-import-additive, spec 2c section 4) ----
    // The one surviving left action under the unified-document model. A Markdown file becomes one or
    // more CHAPTERS that either ADD (a new name) or UPDATE an existing chapter; the author previews
    // exactly what will add / change / remove BEFORE it touches the document -- never a silent
    // whole-document overwrite. The reconcile itself is the pure SourceDoc.importPlan/applyImportPlan.

    // A parse's topics -> [{name, nodes}] chapters, reusing fromSections to turn each topic's
    // sections into heading + body nodes (the incoming nodes are matched by TEXT in the reconcile,
    // so their keys don't matter -- applyImportPlan mints fresh keys for whatever it inserts).
    function incomingChaptersFromParse(parse) {
      var SD = window.SourceDoc;
      return (parse && parse.topics || []).map(function (t) {
        var model = SD.fromSections({ sections: t.sections }, function (sec) { return sec.text || ""; });
        return { name: t.name, nodes: model.nodes };
      });
    }
    // A short human line describing one plan op, for the preview list.
    function importOpLine(op) {
      if (op.type === "add") return "Add chapter “" + op.name + "” (" + op.nodes.length + " block" + (op.nodes.length === 1 ? "" : "s") + ")";
      var bits = [];
      if (op.added) bits.push("+" + op.added);
      if (op.removed) bits.push("−" + op.removed);
      var change = bits.length ? bits.join(" ") + " block" + (op.added + op.removed === 1 ? "" : "s") : "no changes";
      return "Update “" + op.name + "”: " + change + ", " + op.kept + " unchanged";
    }
    function importMarkdownAdditive() {
      var master = ensureUnifiedDocForActiveProduct();
      if (!master) { window.alert("Open a Product's source document first."); return; }
      var SD = window.SourceDoc;
      var inp = h("input"); inp.type = "file"; inp.accept = ".md,.markdown,.txt";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        readFileAsText(f).then(function (text) {
          var parse = SD && window.MarkdownImport ? window.MarkdownImport.parse(text) : { topics: [] };
          var incoming = incomingChaptersFromParse(parse);
          if (!incoming.length) { window.alert("No headings found in that file -- nothing to import. (Chapters come from level-1 headings.)"); return; }
          var model = ensureSourceDocModel(master);
          var plan = SD.importPlan(model, incoming);
          // Preview BEFORE anything changes -- add / change / remove, then confirm (spec 2c section 4).
          var shell = dsModalShell({
            title: "Import from Markdown",
            subtitle: f.name + " — " + plan.summary.chaptersAdded + " chapter" + (plan.summary.chaptersAdded === 1 ? "" : "s") + " added, " + plan.summary.chaptersUpdated + " updated. Nothing changes until you apply.",
            primaryLabel: "Apply import",
            onPrimary: function () {
              SD.applyImportPlan(model, plan);
              persistSourceDocModel(master, model);
              SD.logHistory(model, { type: "imported", file: f.name, chaptersAdded: plan.summary.chaptersAdded, chaptersUpdated: plan.summary.chaptersUpdated });
              persistSourceDocModel(master, model);
              shell.modal.close();
              renderSourceArticle();
              renderSourceTopicList();
              refreshSourceHistory(master);
            }
          });
          var list = h("div", "source-import__preview");
          plan.ops.forEach(function (op) {
            var row = h("div", "source-import__op" + (op.type === "add" ? " is-add" : " is-update"));
            row.appendChild(h("span", "source-import__op-dot"));
            row.appendChild(h("span", "source-import__op-text", importOpLine(op)));
            list.appendChild(row);
          });
          shell.body.appendChild(list);
        });
      });
      inp.click();
    }

    // spec 2d: choose what an imported .md updates on a variant-bearing Product -- the Flagship base
    // (additive reconcile) or one variant (an overlay combine). Reuses the modalField + dsSelect
    // pattern (same as Promote to Product / Find & Replace), not a bespoke control.
    function importIntentModal(declared) {
      var FLAG = "__flagship__";
      var choice = FLAG;
      var shell = dsModalShell({
        title: "Import from Markdown",
        subtitle: "Flagship is the base document. A variant overlays only where its manual differs -- the base is never rewritten.",
        primaryLabel: "Choose file…",
        onPrimary: function () {
          shell.modal.close();
          if (choice === FLAG) importMarkdownAdditive();
          else importVariantCombine(choice);
        }
      });
      var row = modalField(shell.body, "Import as");
      var opts = [["Flagship (the base document)", FLAG]].concat(declared.map(function (v) { return [v, v]; }));
      var sel = dsSelect(opts, choice, function (v) { choice = v; });
      sel.classList.add("modal-field__control");
      row.appendChild(sel);
    }

    function shorten(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
    // A short human line describing one variant-combine plan op, for the preview list.
    function variantImportOpLine(op) {
      if (op.type === "diverge") return "Diverge in “" + op.name + "”: “" + shorten(op.text, 60) + "”";
      if (op.type === "absent") return "Not in this variant (“" + op.name + "”): “" + shorten(op.from, 60) + "”";
      if (op.type === "add-node") return "Add (variant only, “" + op.name + "”): “" + shorten(op.text, 60) + "”";
      if (op.type === "add-chapter") return "Add chapter “" + op.name + "” (variant only)";
      return op.type;
    }
    // spec 2d: combine a variant's manual into the ONE document as an overlay. Reconciles the file
    // against the Flagship base per node (SourceDoc.variantImportPlan) and previews exactly what will
    // diverge / go absent / be added for this variant BEFORE anything is written; the base is untouched.
    function importVariantCombine(variant) {
      var master = ensureUnifiedDocForActiveProduct();
      if (!master) { window.alert("Open a Product's source document first."); return; }
      var SD = window.SourceDoc;
      var inp = h("input"); inp.type = "file"; inp.accept = ".md,.markdown,.txt";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        readFileAsText(f).then(function (text) {
          var incoming = incomingChaptersFromParse(window.MarkdownImport.parse(text));
          if (!incoming.length) { window.alert("No headings found in that file -- nothing to combine. (Chapters come from level-1 headings.)"); return; }
          var model = ensureSourceDocModel(master);
          var plan = SD.variantImportPlan(model, variant, incoming);
          var s = plan.summary;
          var shell = dsModalShell({
            title: "Combine variant: " + variant,
            subtitle: f.name + " — " + s.diverged + " diverged, " + s.absent + " absent, " + s.added + " added for " + variant + ". The Flagship base is not changed.",
            primaryLabel: "Apply combine",
            onPrimary: function () {
              SD.applyVariantImportPlan(model, plan);
              persistSourceDocModel(master, model);
              SD.logHistory(model, { type: "imported", file: f.name, variant: variant, diverged: s.diverged, absent: s.absent, added: s.added });
              persistSourceDocModel(master, model);
              shell.modal.close();
              // show the variant's column so the author immediately sees the combine result
              if (__sourceActiveVariants.indexOf(variant) === -1) __sourceActiveVariants.push(variant);
              renderSourceArticle();
              refreshSourceHistory(master);
            }
          });
          var list = h("div", "source-import__preview");
          if (!plan.ops.length) { list.appendChild(h("div", "source-drawer__empty", "This variant matches the Flagship exactly -- nothing to combine.")); }
          plan.ops.forEach(function (op) {
            var row = h("div", "source-import__op" + (op.type === "absent" ? " is-update" : (op.type === "diverge" ? " is-update" : " is-add")));
            row.appendChild(h("span", "source-import__op-dot"));
            row.appendChild(h("span", "source-import__op-text", variantImportOpLine(op)));
            list.appendChild(row);
          });
          shell.body.appendChild(list);
        });
      });
      inp.click();
    }

    function importMarkdownModal() {
      if (!window.MarkdownImport) { window.alert("Markdown import isn't available (markdown-import.js failed to load)."); return; }
      // Source v2: a Product with a unified source document imports ADDITIVELY (add/update a chapter
      // with a preview), not by spawning fresh topics.
      if (activeSourceMaster()) {
        // spec 2d: if the Product declares variants, ask what this file updates first -- Flagship
        // (the base) or one variant (an overlay). This IS the guardrail: you can't reconcile a
        // variant manual into the Flagship base by mistake, because you must choose up front.
        var declaredNow = declaredVariantsForProduct(window.ProductsStore || {}, activeSourceProductId());
        if (declaredNow.length) { importIntentModal(declaredNow); return; }
        importMarkdownAdditive(); return;
      }
      // uio-W01: same as newTopicModal -- resolved from the stage, not from a picker that is gone.
      // uio-W14: and no longer refused when there is no Product. An import with nowhere to land
      // mints SHARED material and lands there additively, which is the same document a glossary or
      // a standard would be. Refusing would leave the one destination that can import telling you
      // to go and use a different one first.
      var productId = activeSourceProductId();
      if (!productId) {
        createSourceDocument("Imported source", "");
        renderSourceStage();
        importMarkdownModal();
        return;
      }
      var declaredVariants = declaredVariantsForProduct(window.ProductsStore || {}, productId);

      if (!declaredVariants.length) {
        var inp = h("input"); inp.type = "file"; inp.accept = ".md,.markdown,.txt";
        inp.addEventListener("change", function () {
          var f = inp.files && inp.files[0]; if (!f) return;
          promptImportProvenance([{ key: "flagship", label: "Manual", file: f.name }], function (metaList) {
            readFileAsText(f).then(function (text) {
              var baseParse = window.MarkdownImport.parse(text);
              checkRenamedSource(productId, metaList[0], baseParse.topics, function (meta) {
                finishMarkdownImport(baseParse, [], productId, meta);
              });
            });
          });
        });
        inp.click();
        return;
      }

      var primaryFile = null;
      var variantFiles = {};
      var shell = dsModalShell({
        title: "Import from Markdown",
        subtitle: "Creates topics from a Markdown manual's headings (numbered headings like \"5.3\" split into topic/section by their number; plain headings use #/##). Only the Technical facet is written -- Digestible/Dot-point stay yours to author.",
        primaryLabel: "Import",
        onPrimary: function () {
          if (!primaryFile) { window.alert("Choose the manual file first."); return; }
          runImport();
        }
      });
      var box = shell.body;

      var pRow = modalField(box, "Manual (Flagship)");
      var pWrap = h("div", "modal-field__control modal-field__file");
      var pInput = h("input"); pInput.type = "file"; pInput.accept = ".md,.markdown,.txt";
      var pLabel = h("span", "modal-field__hint", "No file chosen");
      pInput.addEventListener("change", function () {
        primaryFile = (pInput.files && pInput.files[0]) || null;
        pLabel.textContent = primaryFile ? primaryFile.name : "No file chosen";
      });
      pWrap.appendChild(pInput);
      pWrap.appendChild(pLabel);
      pRow.appendChild(pWrap);

      declaredVariants.forEach(function (v) {
        var vRow = modalField(box, v + " (optional)");
        var vWrap = h("div", "modal-field__control modal-field__file");
        var vInput = h("input"); vInput.type = "file"; vInput.accept = ".md,.markdown,.txt";
        var vLabel = h("span", "modal-field__hint", "No file chosen");
        vInput.addEventListener("change", function () {
          variantFiles[v] = (vInput.files && vInput.files[0]) || null;
          vLabel.textContent = variantFiles[v] ? variantFiles[v].name : "No file chosen";
        });
        vWrap.appendChild(vInput);
        vWrap.appendChild(vLabel);
        vRow.appendChild(vWrap);
      });

      function runImport() {
        var variantNames = Object.keys(variantFiles).filter(function (v) { return variantFiles[v]; });
        var files = [primaryFile].concat(variantNames.map(function (v) { return variantFiles[v]; }));
        shell.modal.close();
        var entries = [{ key: "flagship", label: "Manual (Flagship)", file: primaryFile.name }]
          .concat(variantNames.map(function (v) { return { key: v, label: v, file: variantFiles[v].name }; }));
        promptImportProvenance(entries, function (metaList) {
          Promise.all(files.map(readFileAsText)).then(function (texts) {
            var baseParse = window.MarkdownImport.parse(texts[0]);
            var variantParses = variantNames.map(function (v, i) { return { name: v, parse: window.MarkdownImport.parse(texts[i + 1]), meta: metaList[i + 1] }; });
            checkRenamedSource(productId, metaList[0], baseParse.topics, function (meta) {
              finishMarkdownImport(baseParse, variantParses, productId, meta);
            });
          });
        });
      }
    }
    window.__productRail.importMarkdownModal = importMarkdownModal; // headless/browser-verify hook
    // Source v2 (md-import-additive) verify hook: run the additive pipeline from raw text (no file
    // picker / modal) -- parse -> chapters -> reconcile plan; apply=true commits it. Returns the plan.
    window.__productRail.importMarkdownText = function (text, apply) {
      var master = ensureUnifiedDocForActiveProduct(); if (!master || !window.SourceDoc || !window.MarkdownImport) return null;
      var SD = window.SourceDoc;
      var incoming = incomingChaptersFromParse(window.MarkdownImport.parse(text));
      var model = ensureSourceDocModel(master);
      var plan = SD.importPlan(model, incoming);
      if (apply) { SD.applyImportPlan(model, plan); persistSourceDocModel(master, model); renderSourceArticle(); renderSourceTopicList(); }
      return { summary: plan.summary, ops: plan.ops.map(function (o) { return { type: o.type, name: o.name, added: o.added, removed: o.removed, kept: o.kept }; }) };
    };
    // uio-W03/W04: what the ONE where-am-I line should say while you are in Source. It names the
    // SOURCE document you are reading, not whichever design document Edit happens to have open --
    // opening a source document from Files and still seeing a course's title in the top bar makes
    // the line say something untrue.
    function activeSourceDocName() {
      var comps = libComponents() || {};
      var open = __sourceActiveTopicId && comps[__sourceActiveTopicId];
      if (open && open.name) return open.name;
      var master = activeSourceMaster();
      return (master && master.name) || "";
    }
    function activeSourceProductName() {
      var p = window.ProductsStore ? window.ProductsStore[activeSourceProductId()] : null;
      return (p && p.name) || "";
    }

    kernel.expose({
      activeSourceDocName: activeSourceDocName, activeSourceProductName: activeSourceProductName,
      // editor.js's __sourceLink browser-verify hook still names this one.
      pushSourceAlternate: pushSourceAlternate,
      applySourceLockState: applySourceLockState, flushSourceEditSession: flushSourceEditSession, persistSourceDocModel: persistSourceDocModel,
      refreshSourceSelBar: refreshSourceSelBar, renderSourceArticle: renderSourceArticle, renderSourceDocNode: renderSourceDocNode,
      renderSourceStage: renderSourceStage, renderSourceToolbar: renderSourceToolbar, sourceMasterFor: sourceMasterFor,
      sourceToast: sourceToast, unifiableTopicsFor: unifiableTopicsFor, updateSourceDocBar: updateSourceDocBar,
      // uio-W14: the document-first resolution, and the mechanism that mints a source document with
      // or without a product. Files' creation actions (uio-W08) and the Product panel (uio-W12)
      // call these rather than reaching for a product and hoping it names one.
      activeSourceDocId: activeSourceDocId, activeSourceMaster: activeSourceMaster,
      ensureUnifiedDocFor: ensureUnifiedDocFor, createSourceDocument: createSourceDocument,
      // The base-edit warning and the two-way jump stayed in editor.js when the stage moved, and
      // they read and wrote this file's state by name -- which in a module is a free identifier
      // that throws the moment its path runs. They ask through these now (arch-P3b-07).
      sourceDocModel: function () { return __sourceDocModel; },
      setSourceDocModel: function (model, topicId) { __sourceDocModel = model; __sourceDocModelTopicId = topicId; },
      sourceActiveTopicId: function () { return __sourceActiveTopicId; },
      // Opening a document from elsewhere in the app persists it too, so a refresh returns to it.
      // uio-W10: it also joins Source's strip, so arriving from Files leaves you with a tab you can
      // come back to rather than a document that silently replaced the last one.
      openSourceTopicId: function (id) {
        if (window.SourceOwnership.isSourceDocument(libComponents()[id])) { openSourceDoc(id); return; }
        __sourceActiveTopicId = id;
        try { localStorage.setItem(SOURCE_TOPIC_PERSIST_KEY, id); } catch (e) {}
      },
      // uio-W10: Source's strip, for the destinations that put documents into it.
      openSourceDoc: openSourceDoc, closeSourceTab: closeSourceTab,
      openSourceDocIds: openSourceDocIds, renderSourceTabs: renderSourceTabs,
      lockSourceEditing: function () { __sourceUnlocked = false; },
      clearSourceEditSession: function () { __sourceEditSession = null; }
    });
    return VersoSourceStage;
  }

  var VersoSourceStage = { install: install };
  window.VersoSourceStage = VersoSourceStage;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoSourceStage;
})();
