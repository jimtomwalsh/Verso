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

  function install(kernel) {
    var E = kernel.need(
      "openDocIds", "registry", "confirmModal", "h", "saveOpenDocIds", "saveRegistry",
      "switchDoc", "getActiveProduct", "modalSection", "modalField", "modalText", "tagDocProductStage",
      "tagDocCell", "clone", "dsModalShell", "bindProjectFolder", "iconBtn", "productSelectOptions",
      "doc", "findRegistryId"
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
        getActiveProduct = E.getActiveProduct,
        modalSection = E.modalSection,
        modalField = E.modalField,
        modalText = E.modalText,
        tagDocProductStage = E.tagDocProductStage,
        tagDocCell = E.tagDocCell,
        clone = E.clone,
        dsModalShell = E.dsModalShell,
        bindProjectFolder = E.bindProjectFolder,
        iconBtn = E.iconBtn,
        productSelectOptions = E.productSelectOptions;

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
    function createBlankDoc(title, code, opts) {
      // Same resolver the import path uses: a code that differs only in case is not a new
      // document, and letting one through is how two rows end up sharing a name.
      var clash = E.findRegistryId(registry, code);
      if (clash) {
        alert("A course with code '" + clash + "' already exists.");
        return;
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
    }

    function importDocToRegistry(importedDoc) {
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
        } catch (e) {
          if (window.console && console.error) console.error("[import] commit failed:", e);
          confirmModal("Import failed", "Could not load the course: " + (e && e.message || e), function () {});
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
      var newDocProduct = (typeof getActiveProduct === "function") ? getActiveProduct() : "";
      var newDocPreset = "elearning";
      var btnImport = window.VersoUI.Button({ variant: "secondary", label: "Import…", onClick: function () {
        pickCourseFile(function (imported) { importDocToRegistry(imported); modal.remove(); });
      } });
      var btnSample = window.VersoUI.Button({ variant: "secondary", label: "Load sample copy", onClick: function () {
        var code = "DEMO-WSE-101-copy-" + Math.floor(Math.random() * 1000);
        var freshSample = clone(window.SAMPLE_DOC || E.doc);
        freshSample.meta.code = code;
        freshSample.meta.title += " (Copy)";
        importDocToRegistry(freshSample);
        modal.remove();
      } });

      var shell = dsModalShell({
        id: "new-doc-modal", keys: false,
        title: "New document",
        subtitle: "Open a saved course, import a document, or start a blank one.",
        extras: [btnImport, btnSample],
        primaryLabel: "Create blank",
        onPrimary: function () {
          var title = titleIn.value.trim();
          var code = codeIn.value.trim();
          if (!title || !code) { alert("Title and Code are required."); return; }
          var cell = (DT && DT.presetToCell(newDocPreset)) || { geo: "reflow", interactive: true };
          createBlankDoc(title, code, { productId: newDocProduct, geo: cell.geo, interactive: cell.interactive });
          modal.remove();
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
        var openBody = modalSection(box, "Open a saved course");
        var list = h("div", "modal-list");
        closedIds.forEach(function (id) {
          var d = registry[id];
          var item = h("div", "modal-list__item");
          var left = h("div", "insp-list__text");
          left.appendChild(h("span", "insp-list__title", d.meta.title || id));
          left.appendChild(h("span", "insp-list__meta", id));
          item.appendChild(left);
          item.addEventListener("click", function () {
            openDocIds.push(id);
            saveOpenDocIds(openDocIds);
            switchDoc(id);
            modal.remove();
          });
          // Delete a saved (closed) course from the registry. Confirm first; permanent
          // local removal (any exported SCORM / on-disk backup folder is left alone).
          var del = iconBtn("trash", "Delete this saved course", true);
          del.addEventListener("click", function (e) {
            e.stopPropagation(); // don't open the course we're deleting
            confirmModal("Delete course?", "Permanently remove “" + (d.meta.title || id) + "” (" + id + ") from this machine. This can't be undone. Any exported SCORM or backup folder on disk is not affected.", function () {
              delete registry[id];
              saveRegistry(registry);
              var oi = openDocIds.indexOf(id); if (oi !== -1) { openDocIds.splice(oi, 1); saveOpenDocIds(openDocIds); }
              modal.remove(); showNewDocDialog(); // re-render the list fresh
            }, { okLabel: "Delete", danger: true });
          });
          item.appendChild(del);
          list.appendChild(item);
        });
        openBody.appendChild(list);
      }

      box = modalSection(box, "New course");
      // Product (defaults to the current scope) -> preset (matrix cell) -> name, per SPEC 7.
      var prodRow = modalField(box, "Product");
      prodRow.appendChild(window.VersoUI.Select({
        options: productSelectOptions(window.ProductsStore),
        value: newDocProduct,
        onChange: function (v) { newDocProduct = v || ""; }
      }));
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
      titleIn = modalText(box, "Course title", "", "e.g. My New Course");
      codeIn = modalText(box, "Course code", "", "e.g. DRO-NEW-101");
    }

    kernel.expose({
      sanitizeHeaderFooterDefault: sanitizeHeaderFooterDefault, headerFooterFromDefault: headerFooterFromDefault, getHeaderFooterDefault: getHeaderFooterDefault,
      saveHeaderFooterDefault: saveHeaderFooterDefault, clearHeaderFooterDefault: clearHeaderFooterDefault, createBlankDoc: createBlankDoc,
      importDocToRegistry: importDocToRegistry, readCourseFile: readCourseFile, pickCourseFile: pickCourseFile,
      showNewDocDialog: showNewDocDialog
    });
  }

  window.VersoDocuments = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDocuments;
})();
