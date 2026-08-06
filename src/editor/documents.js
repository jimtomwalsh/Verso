// editor/documents.js -- bringing a course into existence (arch-P3b-07doc).
//
// Three ways in, one destination. A blank course from the New dialog, a .json dropped or picked
// from disk, or a file read through the browser's picker -- all of them end at the same place: a
// normalized document in the registry, with an id, a tab, and the active document switched to it.
//
// THE HEADER/FOOTER DEFAULT IS PART OF THIS, which is why the two shared a banner and why this is
// the one banner in the phase that was right. An author who has built their course chrome once
// should not rebuild it for course two, so the last header and footer are saved outside any
// document and a new blank course inherits them. That default has no other consumer: it exists
// solely for the moment a course is created.
//
// IMPORT IS THE CAREFUL PATH. An imported document arrives with whatever id it was saved under,
// which may already be in the registry -- so it is normalized, given a fresh code if it collides,
// and only then written. Losing an existing course to an import that happened to share an id
// would be silent and total, so the collision check is not optional and the confirm before an
// overwrite is real.
//
// Editor chrome only: it writes documents into the registry and hands the rest to switchDoc().
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // PURE -- what the New-document form's values mean for the document about to be created.
  //
  // GH #327: "Load sample copy" read NOTHING from the dialog it sits in. It minted a random code,
  // appended " (Copy)" to the sample's own title, and left the sample's demo product and its
  // (absent) type untouched -- so the product, type, title and code the author had just chosen
  // were all discarded. A TYPED VALUE WINS here, which is the whole of the fix. A blank one falls
  // back, because the button is also the one-click "just give me sample content" route and making
  // it refuse to run without a title would trade one broken button for another.
  //
  // `suffix` is passed in rather than generated so this stays pure and testable; the caller
  // supplies the random part, and a code collision is caught by findRegistryId downstream either
  // way.
  function newDocIdentity(sampleMeta, form, suffix) {
    sampleMeta = sampleMeta || {};
    form = form || {};
    var title = String(form.title || "").trim();
    var code = String(form.code || "").trim();
    return {
      title: title || ((sampleMeta.title || "Sample document") + " (Copy)"),
      code: code || ((sampleMeta.code || "SAMPLE") + "-copy-" + suffix)
    };
  }

  function install(kernel) {
    var E = kernel.need(
      "openDocIds", "registry", "confirmModal", "h", "saveOpenDocIds", "saveRegistry",
      "switchDoc", "modalSection", "modalField", "modalText", "tagDocProductStage",
      "tagDocCell", "clone", "dsModalShell", "bindProjectFolder", "iconBtn", "productSelectOptions",
      "doc", "findRegistryId", "colourForName", "formatRelativeTime",
      // uio-W08: the product choice offers "+ New product…" from inside the form that needs it.
      "promptModal", "createProduct"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var openDocIds = E.openDocIds,
        registry = E.registry,
        confirmModal = E.confirmModal,
        h = E.h,
        saveOpenDocIds = E.saveOpenDocIds,
        saveRegistry = E.saveRegistry,
        switchDoc = E.switchDoc,
        modalSection = E.modalSection,
        modalField = E.modalField,
        modalText = E.modalText,
        tagDocProductStage = E.tagDocProductStage,
        tagDocCell = E.tagDocCell,
        clone = E.clone,
        dsModalShell = E.dsModalShell,
        bindProjectFolder = E.bindProjectFolder,
        iconBtn = E.iconBtn,
        productSelectOptions = E.productSelectOptions,
        colourForName = E.colourForName,
        formatRelativeTime = E.formatRelativeTime;

    // ---- Shared "header & footer default for new courses" ---------------------
    // A machine-level default (localStorage, cross-project) captured from any course's
    // Header & Footer, applied as the starting header/footer of every NEW course. The
    // pure core sanitises what carries: the per-course header TITLE is dropped (each
    // new course uses its own name) and any courseNav SECTIONS are cleared (nav is
    // chapter-derived at render, so styling carries but not the source course's page
    // bindings). The logo asset ref is baked to an inline data URI by the caller so the
    // default is self-contained (survives asset GC + isn't tied to the source course).
    var HF_DEFAULT_KEY = "authoring.defaultHeaderFooter";
    /* @hfdefault-start */
    function sanitizeHeaderFooterDefault(hf) {
      if (!hf || typeof hf !== "object") return null;
      var out = JSON.parse(JSON.stringify(hf));
      if (out.header && typeof out.header === "object") delete out.header.title;
      if (out.footer && Array.isArray(out.footer.children)) {
        out.footer.children.forEach(function (ch) { if (ch && ch.type === "courseNav") ch.sections = []; });
      }
      return out;
    }
    function headerFooterFromDefault(savedDefault, title) {
      if (!savedDefault || typeof savedDefault !== "object") return null;
      var out = JSON.parse(JSON.stringify(savedDefault));
      out.header = out.header || {};
      out.header.title = title; // always the NEW course's own name, never the source course's
      return out;
    }
    /* @hfdefault-end */
    window.__hfDefault = { sanitize: sanitizeHeaderFooterDefault, fromDefault: headerFooterFromDefault };
    function getHeaderFooterDefault() {
      try { var s = localStorage.getItem(HF_DEFAULT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    }
    // Schema-CSV import rebuilds the whole doc from the CSV, which would overwrite the
    // house header/footer default with whatever (often blank) HF the CSV carries. Expose
    // the machine default so importSchema can keep it: returns the default HF for `title`,
    // or null when no house default has been set (then the CSV's own HF is left alone).
    window.__hfDefault.forNewDoc = function (title) {
      var saved = getHeaderFooterDefault();
      return saved ? headerFooterFromDefault(saved, title) : null;
    };
    function saveHeaderFooterDefault() {
      var clean = sanitizeHeaderFooterDefault(E.doc.headerFooter);
      if (!clean) return false;
      if (clean.header && typeof clean.header.logo === "string") { // bake the logo -> portable data URI
        var m = /^asset:(.+)$/.exec(clean.header.logo);
        if (m && window.AssetStore) { var a = window.AssetStore.get(m[1]); if (a && a.dataUrl) clean.header.logo = a.dataUrl; }
      }
      try { localStorage.setItem(HF_DEFAULT_KEY, JSON.stringify(clean)); return true; } catch (e) { return false; }
    }
    function clearHeaderFooterDefault() { try { localStorage.removeItem(HF_DEFAULT_KEY); } catch (e) {} }

    // SPEC 7: `opts` (optional) = { productId, geo, interactive } from the product-first create
    // flow. When present, the new doc is stamped with its Product (doc.meta.productId) and its
    // matrix cell (doc.meta.geo/interactive) at birth. Omitted -> an untagged doc = today's
    // {reflow, interactive} default, so the old callers are unchanged.
    // WHERE A NEW DOCUMENT PUTS YOU (GH #327). Every route out of the New dialog wrote the
    // registry and stopped there, so from Files -- where the dialog is opened -- the modal closed
    // and the list in front of you was unchanged. The document existed; nothing showed it. That is
    // worse than a button that fails, because a second press makes a second orphan.
    //
    // So creating a document lands you IN it -- the same shape as creating a source document,
    // which lands Source and marks Files stale. The document is already active (switchDoc has run),
    // the rail moves to Edit, and Files is INVALIDATED rather than re-rendered: a destination is
    // built once and re-entering shows what is already there (uio-W03 §3.2), which is precisely why
    // leaving and coming back did not reveal the new row either.
    function landInNewDoc() {
      if (!window.__leftRail) return;
      window.__leftRail.invalidate("files");
      window.__leftRail.setStage("edit");
    }

    function createBlankDoc(title, code, opts) {
      // Same resolver the import path uses: a code that differs only in case is not a new
      // document, and letting one through is how two rows end up sharing a name.
      var clash = E.findRegistryId(registry, code);
      if (clash) {
        alert("A document with code '" + clash + "' already exists.");
        return null;
      }
      var newDoc = {
        meta: { title: title, code: code },
        backupRequired: true, // Slice 2: a new course MUST bind a backup folder (nagged until it does)
        headerFooter: headerFooterFromDefault(getHeaderFooterDefault(), title) || {
          header: { on: true, title: title, subtitle: "Course Orientation", logo: null },
          footer: { on: true, text: "WARNING: This document may contain technical data subject to export control laws." }
        },
        pages: [
          {
            id: "intro",
            name: "Introduction",
            blocks: [
              { type: "heading", text: title },
              { type: "paragraph", text: "Welcome to the " + title + " course." }
            ]
          }
        ]
      };
      opts = opts || {};
      if (opts.productId) tagDocProductStage(newDoc, opts.productId, null);
      if (opts.geo) tagDocCell(newDoc, opts.geo, opts.interactive); // preset {geo, interactive}
      registry[code] = newDoc;
      saveRegistry(registry);
      openDocIds.push(code);
      saveOpenDocIds(openDocIds);
      switchDoc(code);
      return code; // null on a clash -- the caller only lands you in a document that was made
    }

    // `onDone` (optional) runs after the document is actually committed, which for a replace is
    // after the author answers the confirm rather than when this returns. The New dialog uses it to
    // land you in what you imported; the callers that have their own surface to refresh pass
    // nothing and are unchanged.
    function importDocToRegistry(importedDoc, onDone) {
      if (!importedDoc.meta || typeof importedDoc.meta !== "object") importedDoc.meta = {};
      var code = importedDoc.meta.code || ("IMPORTED-" + Math.floor(Math.random() * 1000));
      // WHICH ENTRY IS THIS A BACKUP OF? Not necessarily registry[code]. The registry key is a
      // document's real name and meta.code is a copy of it, and a pair that drifted apart used to
      // make this check answer "new document" for a file that was plainly a backup of an existing
      // one -- so the import wrote a second entry, silently, with no prompt. Two rows, one title,
      // the new tab on one and the file picker on the other. findRegistryId matches the key first,
      // then the code, then either without case, and only a null means genuinely new.
      var existingId = E.findRegistryId(registry, code);
      var targetId = existingId || code;
      importedDoc.meta.code = targetId; // key and code leave here as one name
      // Commit + load. Wrapped so any failure is VISIBLE: native alert()/confirm()
      // are swallowed by the Verso WKWebView host (no WKUIDelegate panels), so the
      // old raw confirm()/alert() here failed silently -> "picked a file, nothing
      // happened". Route the overwrite prompt through the DOM confirmModal and log
      // every step so a failed import self-reports in the Web Inspector console.
      function commit() {
        try {
          registry[targetId] = importedDoc;
          saveRegistry(registry);
          if (openDocIds.indexOf(targetId) === -1) {
            openDocIds.push(targetId);
            saveOpenDocIds(openDocIds);
          }
          switchDoc(targetId);
          if (window.console && console.log) console.log("[import] loaded course '" + targetId + "'");
          if (typeof onDone === "function") onDone(targetId);
        } catch (e) {
          if (window.console && console.error) console.error("[import] commit failed:", e);
          confirmModal("Import failed", "Could not load the document: " + (e && e.message || e), function () {});
        }
      }
      if (existingId) {
        var existing = registry[existingId];
        var name = (existing && existing.meta && existing.meta.title) || existingId;
        confirmModal("Replace this document?",
          "“" + name + "” (" + existingId + ") is already on this machine. Importing replaces it with the version in this file. The copy you have now is not recovered afterwards.",
          commit, { danger: true, okLabel: "Replace" });
        return;
      }
      commit();
    }

    // Read a picked .verso/.json course file and hand the parsed doc to onDoc.
    // Factored out of showNewDocDialog so the file browser (#74) reuses the exact
    // same read/parse/error path. Native alert() is swallowed by the WKWebView host,
    // so every failure routes through the DOM confirmModal.
    function readCourseFile(file, onDoc) {
      if (!file) return;
      var isVerso = /\.verso$/i.test(file.name || "");
      var reader = new FileReader();
      reader.onerror = function () {
        var err = reader.error;
        if (window.console && console.error) console.error("[import] FileReader error:", err);
        confirmModal("Import failed",
          "Could not read the file" + (err && err.name ? " (" + err.name + ")" : "") + ". It may be too large for this app's memory.",
          function () {});
      };
      reader.onload = function () {
        try {
          var imported;
          if (isVerso) {
            var pkg = window.VersoFormat.readPackage(new Uint8Array(reader.result));
            if (window.AssetStore) Object.keys(pkg.assets).forEach(function (id) {
              window.AssetStore.put(pkg.assets[id].dataUrl, { mime: pkg.assets[id].mime });
            });
            imported = pkg.doc;
          } else {
            imported = JSON.parse(reader.result);
          }
          if (!imported || !imported.pages) {
            confirmModal("Import failed", "That file isn't a valid course document (no pages found).", function () {});
            return;
          }
          if (window.console && console.log) console.log("[import] parsed OK: " + (imported.pages || []).length + " pages from " + file.name);
          onDoc(imported);
        } catch (e) {
          if (window.console && console.error) console.error("[import] parse/import failed:", e);
          confirmModal("Import failed", (isVerso ? "Invalid .verso: " : "Invalid JSON: ") + (e && e.message || e), function () {});
        }
      };
      if (isVerso) reader.readAsArrayBuffer(file); else reader.readAsText(file);
    }
    function pickCourseFile(onDoc) {
      var input = document.createElement("input");
      input.type = "file"; input.accept = ".json,application/json,.verso";
      input.addEventListener("change", function () { readCourseFile(input.files && input.files[0], onDoc); });
      input.click();
    }

    function showNewDocDialog() {
      var existing = document.getElementById("new-doc-modal");
      if (existing) return;

      // Import / sample sit in the footer beside Cancel + Create blank; the whole
      // dialog routes through the DS modal shell (VersoUI.Modal) — issue #19. modal
      // + box are assigned from the shell below.
      var modal, box, titleIn, codeIn;
      // SPEC 7 product-first creation: the new doc is born in a Product (defaults to the current
      // picker scope) and a matrix-cell preset (defaults to eLearning). Resolved to
      // {geo, interactive} via the doc-type model at create time.
      var DT = window.__docType;
      // uio-W01: this used to inherit the global Product scope, so a new document was silently
      // stamped with whatever the top bar happened to be showing. There is no scope now; the author
      // picks the Product here, or leaves it unset. uio-W08 reshapes creation properly.
      var newDocProduct = "";
      var newDocPreset = "elearning";
      var btnImport = window.VersoUI.Button({ variant: "secondary", label: "Import…", onClick: function () {
        pickCourseFile(function (imported) { importDocToRegistry(imported, landInNewDoc); modal.remove(); });
      } });
      // GH #327. The sample copy is created FROM THIS FORM, like every other route out of this
      // dialog: the title and code you typed, the Product you picked, the preset you chose. What it
      // borrows from the sample is the CONTENT.
      //
      // Two of those need saying. The sample carries `productId: "prod-demo"` and `stage`, so
      // leaving the Product unset has to CLEAR them rather than pass them through -- otherwise
      // "None (shared)" silently files your copy under the demo product. And the sample has no
      // geo/interactive at all, which is why a copy always landed as a Course whatever type you
      // picked; the preset is stamped on here. Picking a static type keeps the sample's interactive
      // blocks (the matrix model never drops content) -- they render statically, and switching the
      // cell back restores them.
      var btnSample = window.VersoUI.Button({ variant: "secondary", label: "Load sample copy", onClick: function () {
        var freshSample = clone(window.SAMPLE_DOC || E.doc);
        var id = newDocIdentity((freshSample && freshSample.meta) || {},
          { title: titleIn.value, code: codeIn.value }, Math.floor(Math.random() * 1000));
        var cell = (DT && DT.presetToCell(newDocPreset)) || { geo: "reflow", interactive: true };
        freshSample.meta.title = id.title;
        freshSample.meta.code = id.code;
        tagDocProductStage(freshSample, newDocProduct, null);
        tagDocCell(freshSample, cell.geo, cell.interactive);
        importDocToRegistry(freshSample, landInNewDoc);
        modal.remove();
      } });

      var shell = dsModalShell({
        id: "new-doc-modal", keys: false,
        title: "New document",
        subtitle: "Open a saved document, import one, or start a blank one.",
        extras: [btnImport, btnSample],
        primaryLabel: "Create blank",
        onPrimary: function () {
          var title = titleIn.value.trim();
          var code = codeIn.value.trim();
          if (!title || !code) { alert("Title and Code are required."); return; }
          var cell = (DT && DT.presetToCell(newDocPreset)) || { geo: "reflow", interactive: true };
          // GH #327 found this route was equally invisible: a blank document recorded its title,
          // code, product and type correctly and then left you on the same unchanged Files list.
          // A clash returns null and the dialog stays put, so a failed create never lands anywhere.
          var made = createBlankDoc(title, code, { productId: newDocProduct, geo: cell.geo, interactive: cell.interactive });
          if (!made) return;
          modal.remove();
          landInNewDoc();
          // Slice 2: MANDATORY backup-folder setup — prompt the picker immediately (still
          // within this click gesture, required for the native/FSA folder pickers). If the
          // author cancels, the loud "no backup folder" banner nags until they bind.
          bindProjectFolder();
        }
      });
      modal = shell.modal; box = shell.body;

      var closedIds = Object.keys(registry).filter(function (id) {
        return openDocIds.indexOf(id) === -1;
      });
      if (closedIds.length > 0) {
        // uio-W02: this list is built from the ONE document row (VersoUI.DocumentRow), the same
        // component Files and Publish use, so a document reads identically wherever it is listed.
        // It used to be a hand-rolled title/meta pair that resembled nothing else in the app.
        var openBody = modalSection(box, "Open a saved document");
        var list = h("div", "modal-list");
        var nowTs = Date.now();
        closedIds.forEach(function (id) {
          var d = registry[id];
          var cell = (window.__docType && window.__docType.docCell) ? window.__docType.docCell(d) : { geo: "reflow" };
          var pid = d.meta && d.meta.productId;
          var prod = pid && window.ProductsStore ? window.ProductsStore[pid] : null;
          var ts = (d.meta && typeof d.meta.updatedAt === "number") ? d.meta.updatedAt : null;
          // Delete a saved (closed) document from the registry. Confirm first; permanent
          // local removal (any exported SCORM / on-disk backup folder is left alone). It rides in
          // the row's `trailing` slot rather than being bolted on after it, so it sits inside the
          // row's anatomy like Publish's own affordances will (uio-W16).
          var del = iconBtn("trash", "Delete this saved document", true);
          del.addEventListener("click", function (e) {
            e.stopPropagation(); // don't open the document we're deleting
            confirmModal("Delete document?", "Permanently remove “" + (d.meta.title || id) + "” (" + id + ") from this machine. This can't be undone. Any exported SCORM or backup folder on disk is not affected.", function () {
              delete registry[id];
              saveRegistry(registry);
              var oi = openDocIds.indexOf(id); if (oi !== -1) { openDocIds.splice(oi, 1); saveOpenDocIds(openDocIds); }
              modal.remove(); showNewDocDialog(); // re-render the list fresh
            }, { okLabel: "Delete", danger: true });
          });
          list.appendChild(window.VersoUI.DocumentRow({
            title: d.meta.title || id,
            type: cell.geo,
            typeChip: true, // a mixed, ungrouped list of types -- the chip earns its place here
            dot: pid ? colourForName(pid) : null,
            dotTitle: pid ? ("Product: " + ((prod && prod.name) || pid)) : null,
            updated: window.VersoUI._pure.compactRelativeTime(ts, nowTs),
            updatedTitle: ts ? formatRelativeTime(ts, nowTs) : null,
            trailing: del,
            onOpen: function () {
              openDocIds.push(id);
              saveOpenDocIds(openDocIds);
              switchDoc(id);
              modal.remove();
            }
          }));
        });
        openBody.appendChild(list);
      }

      box = modalSection(box, "New document");
      // Product (defaults to the current scope) -> preset (matrix cell) -> name, per SPEC 7.
      // uio-W08: the SAME product choice the source-document form offers, from the same builder.
      // The empty option reads "None (shared)", never "All products" -- they look alike and mean
      // opposite things, one a filter declining to narrow and the other a deliberate choice that
      // this document belongs to no product.
      var prodRow = modalField(box, "Product");
      var prodSel = null;
      function rebuildProductSelect() {
        var next = window.VersoUI.Select({
          options: window.VersoFiles._pure.productChoices(window.ProductsStore),
          value: newDocProduct,
          onChange: function (v) {
            if (v === window.VersoFiles._pure.NEW_PRODUCT_VALUE) {
              E.promptModal("New product", "Name", "", function (name) {
                if ((name || "").trim()) newDocProduct = E.createProduct(name).id;
                rebuildProductSelect();
              });
              return;
            }
            newDocProduct = v || "";
          }
        });
        if (prodSel) prodRow.replaceChild(next, prodSel); else prodRow.appendChild(next);
        prodSel = next;
      }
      rebuildProductSelect();
      if (DT && window.VersoUI.ChoiceCards) {
        modalField(box, "Start from a preset");
        box.appendChild(window.VersoUI.ChoiceCards({
          options: DT.PRESETS.map(function (p) {
            return { value: p.key, title: p.name, desc: (p.geo.charAt(0).toUpperCase() + p.geo.slice(1)) + " · " + (p.interactive ? "interactive" : "static") };
          }),
          value: newDocPreset,
          onChange: function (v) { newDocPreset = v; }
        }));
      }
      // uio-W02: these fields create ANY of the four types -- the preset picker above offers a
      // presentation and a guide -- so they name a document, not a course. The code is the name the
      // document is filed under (see storage.js, "document identity").
      titleIn = modalText(box, "Document title", "", "e.g. My new document");
      codeIn = modalText(box, "Document code", "", "e.g. ACME-101-E");
    }

    kernel.expose({
      sanitizeHeaderFooterDefault: sanitizeHeaderFooterDefault, headerFooterFromDefault: headerFooterFromDefault, getHeaderFooterDefault: getHeaderFooterDefault,
      saveHeaderFooterDefault: saveHeaderFooterDefault, clearHeaderFooterDefault: clearHeaderFooterDefault, createBlankDoc: createBlankDoc,
      importDocToRegistry: importDocToRegistry, readCourseFile: readCourseFile, pickCourseFile: pickCourseFile,
      showNewDocDialog: showNewDocDialog
    });
  }

  window.VersoDocuments = { install: install, _pure: { newDocIdentity: newDocIdentity } };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDocuments;
})();
