// editor/library.js -- one component, many courses (arch-P3b-07lib).
//
// A shared master lives OUTSIDE any document, in `window.LibraryStore`, and courses reference it.
// That is the whole idea: fix a callout block once and every course carrying it is fixed, instead
// of hunting eleven copies. A course that references a master it cannot resolve falls back rather
// than breaking, which is why the store is loaded eagerly and read defensively everywhere.
//
// THREE PLACES, ONE CONCERN. The store and its accessors sat at the top of editor.js beside the
// Products store; the where-used counters sat 1,800 lines below under a banner about interaction
// identity; the panel that lists, imports, exports, promotes and removes masters sat 2,700 lines
// below that. They are the same feature, and the counters exist only to answer the question the
// panel asks before it lets you delete something: how many courses would this break?
//
// WHERE-USED IS PURE ON PURPOSE. It takes the registry as DATA rather than reading a global, so
// the suite can exercise it against a fixture multi-course registry with no browser. It reuses
// `walkBlocks` rather than growing a fourth near-duplicate walker -- and that walker stays in
// editor.js, because it is substrate four unrelated callers share.
//
// Editor chrome only. render.js resolves a master itself, live, from LibraryStore or
// doc.components; nothing here reaches into render().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "mount", "confirmModal", "pushHistory", "renderInspector", "getRegistry",
      "getComponents", "saveRegistry", "registry", "clone", "panelSection", "modalText",
      "Store", "walkBlocks", "insertPageFromLibrary", "dsSelect", "stampMasterVersion", "stampOwnerProductTag",
      "promptModal", "blockLabel", "remintIds", "getBlockPageIndexAndIndex", "clearSelection", "modalHead",
      "modalActions", "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        mount = E.mount,
        confirmModal = E.confirmModal,
        pushHistory = E.pushHistory,
        renderInspector = E.renderInspector,
        getRegistry = E.getRegistry,
        getComponents = E.getComponents,
        saveRegistry = E.saveRegistry,
        registry = E.registry,
        clone = E.clone,
        panelSection = E.panelSection,
        modalText = E.modalText,
        Store = E.Store,
        walkBlocks = E.walkBlocks,
        insertPageFromLibrary = E.insertPageFromLibrary,
        dsSelect = E.dsSelect,
        stampMasterVersion = E.stampMasterVersion,
        stampOwnerProductTag = E.stampOwnerProductTag,
        promptModal = E.promptModal,
        blockLabel = E.blockLabel,
        remintIds = E.remintIds,
        getBlockPageIndexAndIndex = E.getBlockPageIndexAndIndex,
        clearSelection = E.clearSelection,
        modalHead = E.modalHead,
        modalActions = E.modalActions;

    // ---- SHARED COMPONENT LIBRARY (cross-course single-source) -----------------
    // A machine-level store (separate from the per-doc registry) of component DEFS that
    // ANY course references by key. A componentGrid resolves its def doc -> LIBRARY ->
    // built-in, so a library component is single-source: edit the master and every course
    // using it updates. render resolves defs to static HTML at export time (editor
    // context), so the shipped SCORM is self-contained. Storage routes through
    // libraryAdapter() (#18) -- localStorage on the 'browser' backend, the per-user file
    // store on 'file' -- the same seam/flag the doc registry uses.
    // Neutral demo master (ships with the tool, mirrors SAMPLE_DOC's role): a single
    // reusable component carrying one named facet ("pro"), so the shipped demo course's
    // Products & Variants chapter (model.js) has a real shared component to point its
    // libraryInstance placements at on a fresh install. Only used to seed an EMPTY store —
    // never overwrites real authored components.
    function seedDemoLibrary(lib) {
      lib.components["comp-demo-feature"] = {
        name: "Feature Highlight",
        productId: "prod-demo",
        template: {
          id: "lib-demo-root", type: "frame", padding: 24, radius: 12, border: true,
          children: [
            { id: "lib-demo-h", type: "subheading", text: "Standard" },
            { id: "lib-demo-p", type: "paragraph", text: "The Standard tier covers the core feature set." }
          ]
        },
        facets: {
          pro: {
            name: "Pro",
            template: {
              id: "lib-demo-root-pro", type: "frame", padding: 24, radius: 12, border: true,
              children: [
                { id: "lib-demo-h-pro", type: "subheading", text: "Pro" },
                { id: "lib-demo-p-pro", type: "paragraph", text: "The Pro tier adds advanced options on top of the Standard feature set." }
              ]
            }
          }
        }
      };
    }
    function loadLibrary() { return Store.loadLibrary(seedDemoLibrary); }
    window.LibraryStore = loadLibrary();
    function saveLibrary() { Store.saveLibrary(window.LibraryStore); }
    function libComponents() { return (window.LibraryStore && window.LibraryStore.components) || {}; }

    // #24: where-used for a shared library master -- courses = how many courses in the
    // registry reference it at all, instances = total libraryInstance placements across
    // all of them. Reuses walkBlocks (not a 4th near-duplicate walker) since every
    // libraryInstance placement is an ordinary block, no different from any other #20
    // reference for this purpose. PURE (DOM-free): takes the registry object as data, so
    // tests/run.js can exercise it headlessly against a fixture multi-course registry.
    /* @where-used-start */
    function libraryWhereUsed(ref, registryObj) {
      var courses = 0, instances = 0;
      Object.keys(registryObj || {}).forEach(function (code) {
        var count = 0;
        walkBlocks(registryObj[code], function (b) { if (b.type === "libraryInstance" && b.ref === ref) count++; });
        // #22: a page master's instances are PAGES (page.libraryRef), not blocks -- walkBlocks
        // only reaches doc.pages[].blocks, so count those separately on the same pass.
        ((registryObj[code] && registryObj[code].pages) || []).forEach(function (p) { if (p && p.libraryRef === ref) count++; });
        if (count > 0) { courses++; instances += count; }
      });
      return { courses: courses, instances: instances };
    }
    // Product Rail (source-stage-info-panel): the detailed, per-usage sibling of
    // libraryWhereUsed's counts -- one entry per referencing block, with enough to
    // both label it (document title) and jump to it (docCode + blockId). Generic over
    // any LibraryStore ref (topics included -- a topic is just a kind:"topic" master).
    function libraryWhereUsedDetail(ref, registryObj) {
      var entries = [];
      Object.keys(registryObj || {}).forEach(function (code) {
        var rdoc = registryObj[code];
        walkBlocks(rdoc, function (b) {
          if (b.type === "libraryInstance" && b.ref === ref) {
            entries.push({ docCode: code, docTitle: (rdoc.meta && rdoc.meta.title) || code, blockId: b.id });
          }
        });
      });
      return entries;
    }
    /* @where-used-end */

    // ---- Component Library panel (cross-course shared components) -------------
    function exportLibraryJson() {
      var blob = new Blob([JSON.stringify(window.LibraryStore, null, 2)], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "component-library.json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    function importLibraryJson() {
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          var p; try { p = JSON.parse(r.result); } catch (e) { window.alert("Couldn't read that file as JSON."); return; }
          if (!p || !p.components) { window.alert("That file isn't a component library (no components)."); return; }
          var n = Object.keys(p.components).length;
          var merge = window.confirm("Import " + n + " component(s).\n\nOK = MERGE (imported win on a name clash).\nCancel = keep yours (skip clashes).");
          Object.keys(p.components).forEach(function (k) { if (merge || !window.LibraryStore.components[k]) window.LibraryStore.components[k] = p.components[k]; });
          saveLibrary(); mount(); renderInspector();
        };
        r.readAsText(f);
      });
      inp.click();
    }
    function buildLibraryBody(c) {
      c.appendChild(h("div", "insp-hint", "A shared library used across ALL your courses. A course REFERENCES a library component; edit the master here and every course using it updates. It bakes into the export, so the shipped SCORM stays self-contained (air-gap safe)."));
      var lib = libComponents();
      // #22: PAGE masters get their own list below (different actions -- Insert page, not
      // Copy to course, since a page isn't a doc.components-shaped thing) -- filter/label
      // by type per the ticket's acceptance criteria.
      var keys = Object.keys(lib).filter(function (k) { return lib[k].kind !== "page"; });
      if (keys.length) {
        var list = h("div", "insp-list");
        keys.forEach(function (k) {
          var comp = lib[k];
          var item = h("div", "insp-list__item");
          var left = h("div", "insp-list__text");
          left.appendChild(h("span", "insp-list__title", comp.name || k));
          left.appendChild(h("span", "insp-list__meta", (comp.slots || []).map(function (s) { return s.label; }).join(", ") || comp.kind || "component"));
          // #24: where-used — a live-linked instance (#20) already resolves the CURRENT
          // master on every render, so this is a read-only blast-radius indicator, not a
          // staleness warning. Scanning the full registry per row is fine here: the panel
          // only builds when an author opens Settings > System > Component Library.
          var usage = libraryWhereUsed(k, getRegistry());
          left.appendChild(h("span", "insp-list__meta", usage.instances
            ? "Used in " + usage.courses + " course" + (usage.courses === 1 ? "" : "s") + " / " + usage.instances + " instance" + (usage.instances === 1 ? "" : "s")
            : "Not placed anywhere yet"));
          item.appendChild(left);
          var acts = h("div"); acts.style.cssText = "display:flex;gap:4px;";
          var copyB = h("button", "prop-btn", "Copy to course"); copyB.style.cssText = "padding:2px 6px;font-size:10px;"; copyB.title = "Detach a local copy into this course (edits won't propagate)";
          // #19: deliberately plain clone(), NOT remintIds — the master's ids are its
          // stable identity and must survive a detach untouched (see the contract on remintIds).
          copyB.addEventListener("click", function () { pushHistory(); getComponents()[k] = clone(comp); saveRegistry(registry); mount(); });
          // #24: an explicit, deliberate confirmation that every #20 live instance already
          // reflects the current master (architecture, not a data mutation this button
          // performs) -- and durably persists the master in case an in-memory edit hasn't
          // been saved yet. Detached/copied-to-course snapshots are NOT live references
          // (that's the whole point of detaching, #19/#21) so are intentionally out of
          // scope here; #21's Relink is the targeted way to re-sync one of those.
          var pushB = h("button", "prop-btn", "Push update"); pushB.style.cssText = "padding:2px 6px;font-size:10px;";
          pushB.title = "Confirm every live-linked instance reflects this master's current content, and save it durably.";
          pushB.addEventListener("click", function () {
            saveLibrary();
            var fresh = libraryWhereUsed(k, getRegistry());
            confirmModal("Push update", fresh.instances
              ? "Saved. " + fresh.instances + " live-linked instance" + (fresh.instances === 1 ? "" : "s") + " across " + fresh.courses + " course" + (fresh.courses === 1 ? "" : "s") + " already reflect “" + (comp.name || k) + "”'s current content — instances resolve the master live, so there's nothing further to push."
              : "Saved. “" + (comp.name || k) + "” isn't placed anywhere yet, so there's nothing to push.",
              function () {}, { okLabel: "OK" });
          });
          var delB = h("button", "prop-btn prop-btn--danger", "✕"); delB.style.cssText = "padding:2px 6px;font-size:10px;";
          delB.addEventListener("click", function () {
            var impact = libraryWhereUsed(k, getRegistry());
            var warn = impact.instances ? " Currently used in " + impact.courses + " course" + (impact.courses === 1 ? "" : "s") + " / " + impact.instances + " instance" + (impact.instances === 1 ? "" : "s") + " —" : "";
            confirmModal("Remove component", "Remove “" + (comp.name || k) + "” from the shared library?" + warn + " courses referencing it fall back to a built-in / show unknown.", function () { delete window.LibraryStore.components[k]; saveLibrary(); mount(); renderInspector(); }, { okLabel: "Remove", danger: true });
          });
          acts.appendChild(copyB); acts.appendChild(pushB); acts.appendChild(delB); item.appendChild(acts);
          list.appendChild(item);
        });
        c.appendChild(list);
      } else {
        c.appendChild(h("div", "insp-hint", "No shared components yet. Promote a course component below, or import a library."));
      }

      // #22: PAGE masters -- listed + labelled separately from block masters. "Insert page"
      // (not "Copy to course") since placing one adds a whole page to doc.pages, not a
      // doc.components entry; capture happens from a page's OWN inspector ("Save page to
      // library", above in renderPageInspector), not from here.
      var pageKeys = Object.keys(lib).filter(function (k) { return lib[k].kind === "page"; });
      if (pageKeys.length) {
        var pageSecBody = panelSection(c, "Pages");
        var pageList = h("div", "insp-list");
        pageKeys.forEach(function (k) {
          var comp = lib[k];
          var item = h("div", "insp-list__item");
          var left = h("div", "insp-list__text");
          left.appendChild(h("span", "insp-list__title", comp.name || k));
          left.appendChild(h("span", "insp-list__meta", "page"));
          var usage = libraryWhereUsed(k, getRegistry());
          left.appendChild(h("span", "insp-list__meta", usage.instances
            ? "Used in " + usage.courses + " course" + (usage.courses === 1 ? "" : "s") + " / " + usage.instances + " instance" + (usage.instances === 1 ? "" : "s")
            : "Not placed anywhere yet"));
          item.appendChild(left);
          var pacts = h("div"); pacts.style.cssText = "display:flex;gap:4px;";
          var insertB = h("button", "prop-btn prop-btn--accent", "Insert page"); insertB.style.cssText = "padding:2px 6px;font-size:10px;"; insertB.title = "Insert a live-linked page right after the current one — editing the master updates every placement";
          insertB.addEventListener("click", function () { insertPageFromLibrary(k); });
          var pPushB = h("button", "prop-btn", "Push update"); pPushB.style.cssText = "padding:2px 6px;font-size:10px;";
          pPushB.title = "Confirm every live-linked page reflects this master's current content, and save it durably.";
          pPushB.addEventListener("click", function () {
            saveLibrary();
            var fresh = libraryWhereUsed(k, getRegistry());
            confirmModal("Push update", fresh.instances
              ? "Saved. " + fresh.instances + " live-linked page" + (fresh.instances === 1 ? "" : "s") + " across " + fresh.courses + " course" + (fresh.courses === 1 ? "" : "s") + " already reflect “" + (comp.name || k) + "”'s current content — pages resolve the master live, so there's nothing further to push."
              : "Saved. “" + (comp.name || k) + "” isn't placed anywhere yet, so there's nothing to push.",
              function () {}, { okLabel: "OK" });
          });
          var pDelB = h("button", "prop-btn prop-btn--danger", "✕"); pDelB.style.cssText = "padding:2px 6px;font-size:10px;";
          pDelB.addEventListener("click", function () {
            var impact = libraryWhereUsed(k, getRegistry());
            var warn = impact.instances ? " Currently used in " + impact.courses + " course" + (impact.courses === 1 ? "" : "s") + " / " + impact.instances + " instance" + (impact.instances === 1 ? "" : "s") + " —" : "";
            confirmModal("Remove page", "Remove “" + (comp.name || k) + "” from the shared library?" + warn + " courses referencing it show an empty page.", function () { delete window.LibraryStore.components[k]; saveLibrary(); mount(); renderInspector(); }, { okLabel: "Remove", danger: true });
          });
          pacts.appendChild(insertB); pacts.appendChild(pPushB); pacts.appendChild(pDelB); item.appendChild(pacts);
          pageList.appendChild(item);
        });
        pageSecBody.appendChild(pageList);
      }
      // promote a course-local component to the shared library (single-sources it)
      var docKeys = Object.keys(E.doc.components || {}).filter(function (k) { return !(window.COMPONENTS || {})[k]; });
      if (docKeys.length) {
        var addBody = panelSection(c, "Add to library");
        var selectedKey = docKeys[0];
        addBody.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Course component"));
        var psel = dsSelect(docKeys.map(function (k) { return [E.doc.components[k].name || k, k]; }), selectedKey, function (v) { selectedKey = v; });
        addBody.appendChild(psel);
        var saveB = h("button", "prop-btn prop-btn--accent", "Save to library"); saveB.style.marginTop = "6px";
        saveB.addEventListener("click", function () {
          if (!selectedKey || !E.doc.components[selectedKey]) return;
          function doSave() {
            pushHistory();
            // #19: plain clone(), NOT remintIds — promoting to the shared library keeps the
            // exact ids this course-local component was captured with (see the contract on
            // remintIds); they become the master's permanent cross-course identity.
            var promoted = clone(E.doc.components[selectedKey]);
            stampMasterVersion(promoted, Date.now()); // Product Rail: bump on this content edit
            // Product Rail: stamp the reserved owning-Product tag from THIS course's Product
            // context, if it has one -- birthplace, not ownership; an untagged course simply
            // promotes with no reserved tag (nothing to attribute). Stamped once, here, at
            // the moment of promotion -- never re-stamped on a later overwrite.
            stampOwnerProductTag(promoted, E.doc.meta && E.doc.meta.productId);
            window.LibraryStore.components[selectedKey] = promoted;
            delete E.doc.components[selectedKey]; // single-source: this course now references the library copy
            saveLibrary(); saveRegistry(registry); mount(); renderInspector();
          }
          if (libComponents()[selectedKey]) {
            // #24 IMPACT PREVIEW: the one place a master's content actually changes today
            // (there's no in-place master editor yet, #21) — so this overwrite confirm is
            // where a blast-radius preview belongs.
            var impact = libraryWhereUsed(selectedKey, getRegistry());
            var warn = impact.instances ? " " + impact.instances + " live-linked instance" + (impact.instances === 1 ? "" : "s") + " across " + impact.courses + " course" + (impact.courses === 1 ? "" : "s") + " will pick up this content immediately." : " It isn't placed anywhere yet.";
            confirmModal("Overwrite component", "The library already has “" + selectedKey + "”. Overwrite it?" + warn, doSave, { okLabel: "Overwrite" });
          } else doSave();
        });
        addBody.appendChild(saveB);
      }
      var xfer = panelSection(c, "Transfer");
      xfer.appendChild(h("div", "insp-hint", "Move the library between machines / the on-prem server."));
      var expB = h("button", "prop-btn", "Export library (.json)");
      expB.addEventListener("click", exportLibraryJson); xfer.appendChild(expB);
      var impB = h("button", "prop-btn", "Import library (.json)…"); impB.style.marginTop = "6px";
      impB.addEventListener("click", importLibraryJson); xfer.appendChild(impB);
    }
    function buildComponentsBody(c) {
      c.appendChild(h("div", "insp-hint", "Define component templates and fields. Grids can render any defined template."));
      var comps = getComponents();
      var list = h("div", "insp-list");
      Object.keys(comps).forEach(function (k) {
        var comp = comps[k];
        var item = h("div", "insp-list__item");
        var left = h("div", "insp-list__text");
        left.appendChild(h("span", "insp-list__title", comp.name));
        left.appendChild(h("span", "insp-list__meta", (comp.slots || []).map(function (s) { return s.label; }).join(", ")));
        item.appendChild(left);
        list.appendChild(item);
      });
      c.appendChild(list);

      var btn = h("button", "prop-btn", "Define custom component…");
      btn.style.marginTop = "10px";
      btn.addEventListener("click", showDefineComponentDialog);
      c.appendChild(btn);
    }

    // Capture a built block (typically a Frame composed from primitives) as a
    // reusable component. v1 = a saved preset: inserting drops an independent copy
    // (detached). Stored on doc.components with kind:"composed" so it shows in
    // the Blocks panel under "My Components" and survives save/load + export.
    function saveBlockAsComponent(block) {
      promptModal("Name this reusable component", "Component name", blockLabel(block), function (v) {
        var name = (v || "").trim();
        if (!name) return;
        var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (!id) { alert("Please use a name with some letters or numbers."); return; }
        var comps = getComponents();
        function save() {
          pushHistory();
          comps[id] = { name: name, kind: "composed", template: remintIds(clone(block)) };
          E.doc.components = comps;
          saveRegistry(registry);
          mount();
          alert("Saved “" + name + "”. Find it in the Blocks panel → My Components.");
        }
        if (comps[id]) confirmModal("Overwrite component", "A component named “" + name + "” already exists. Overwrite it?", save, { okLabel: "Overwrite" });
        else save();
      });
    }

    // Dissolve a group/card back into its children in the page (at its position).
    function ungroupContainer(block) {
      var loc = getBlockPageIndexAndIndex(block);
      if (!loc) return;
      pushHistory();
      var args = [loc.blockIndex, 1].concat(block.children || []);
      Array.prototype.splice.apply(E.doc.pages[loc.pageIndex].blocks, args);
      clearSelection();
      mount();
    }

    function showDefineComponentDialog() {
      var existing = document.getElementById("define-comp-modal");
      if (existing) return;
      var modal = h("div", "modal-overlay");
      modal.id = "define-comp-modal";
      var box = h("div", "modal-box");
      modalHead(box, "Define custom component", "Create a reusable template with named fields you can drop onto any page.");

      var nameIn = modalText(box, "Component name", "", "e.g. Product Card");
      var idIn = modalText(box, "Component ID", "", "e.g. product-card");
      var slotsIn = modalText(box, "Fields / slots", "", "e.g. Title, Details, Action text");
      nameIn.addEventListener("input", function () {
        idIn.value = this.value.trim().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
      });

      modalActions(box, modal, "Define template", function () {
        var name = nameIn.value.trim();
        var id = idIn.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
        var slotsRaw = slotsIn.value.trim();
        if (!name || !id || !slotsRaw) { alert("All fields are required."); return; }
        var slots = slotsRaw.split(",").map(function (s) {
          var clean = s.trim();
          var key = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
          return { key: key, label: clean };
        }).filter(function (s) { return s.key !== ""; });
        if (slots.length === 0) { alert("At least one valid field is required."); return; }
        var comps = getComponents();
        if (comps[id]) { alert("A component with ID '" + id + "' already exists."); return; }
        pushHistory();
        comps[id] = { name: name, slots: slots };
        E.doc.components = comps;
        saveRegistry(registry);
        modal.remove();
        mount();
      });
      modal.appendChild(box);
      document.body.appendChild(modal);
    }

    // arch-P3b-07tags: the global technology-tag vocabulary. It is the one tag helper that is
    // NOT pure -- it reads every master in the shared library -- so it came here rather than to
    // product-rail.js with the other five. It has no caller: the tag-editing UI it was written
    // for was specified and never built.
    function collectTagVocabulary() {
      var seen = {}, out = [];
      var comps = libComponents();
      Object.keys(comps).forEach(function (k) {
        ((comps[k] && comps[k].tags) || []).forEach(function (t) {
          if (t && !t.reserved && t.value && !seen[t.value]) { seen[t.value] = true; out.push(t.value); }
        });
      });
      return out;
    }

    kernel.expose({
      seedDemoLibrary: seedDemoLibrary, loadLibrary: loadLibrary, saveLibrary: saveLibrary,
      libComponents: libComponents, libraryWhereUsed: libraryWhereUsed, libraryWhereUsedDetail: libraryWhereUsedDetail,
      exportLibraryJson: exportLibraryJson, importLibraryJson: importLibraryJson, buildLibraryBody: buildLibraryBody,
      buildComponentsBody: buildComponentsBody, saveBlockAsComponent: saveBlockAsComponent, ungroupContainer: ungroupContainer,
      showDefineComponentDialog: showDefineComponentDialog, collectTagVocabulary: collectTagVocabulary
    });
  }

  window.VersoLibrary = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoLibrary;
})();
