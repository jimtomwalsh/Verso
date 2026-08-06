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

  // PURE -- what loading the shipped sample workspace WOULD do, decided before anything is written.
  //
  // The set ships seeded into empty stores, which is right for a first run and useless for everyone
  // else: an author who already has products and documents -- which is every author who has used
  // the tool for an afternoon -- can never see it. So it is loadable on demand, and this is the
  // half that decides what "loading" means when you already have work.
  //
  // ADDITIVE, NEVER DESTRUCTIVE. An id already in a store is SKIPPED, not overwritten and not
  // duplicated under a new name. Overwriting would destroy real work to install a demo; renaming
  // would leave two of everything after a second load. Skipping makes the action idempotent: load
  // it twice and the second run adds nothing and says so.
  //
  // Returns the plan, so the caller can state what is about to happen BEFORE it happens rather than
  // reporting it afterwards. Nothing here writes.
  function sampleWorkspacePlan(shipped, stores) {
    shipped = shipped || {};
    stores = stores || {};
    var plan = { products: [], sourceDocs: [], designDocs: [], skipped: [], total: 0 };
    function sort(kind, from, existing) {
      Object.keys(from || {}).forEach(function (id) {
        if (existing && Object.prototype.hasOwnProperty.call(existing, id)) plan.skipped.push(id);
        else plan[kind].push(id);
      });
    }
    sort("products", shipped.products, stores.products);
    sort("sourceDocs", shipped.sourceDocs, stores.components);
    sort("designDocs", shipped.designDocs, stores.registry);
    plan.total = plan.products.length + plan.sourceDocs.length + plan.designDocs.length;
    return plan;
  }
  // The sentence the confirm shows. Written from the plan so it can never promise something the
  // plan does not do -- including the case where it would do nothing at all.
  function sampleWorkspaceSummary(plan) {
    if (!plan || !plan.total) return "The sample workspace is already here. Nothing would be added.";
    var parts = [];
    function part(n, one, many) { if (n) parts.push(n + " " + (n === 1 ? one : many)); }
    part(plan.products.length, "product", "products");
    part(plan.sourceDocs.length, "source document", "source documents");
    part(plan.designDocs.length, "design document", "design documents");
    var head = "Adds " + parts.join(", ").replace(/, ([^,]*)$/, " and $1") + " alongside your own work.";
    var tail = " Nothing you already have is changed or replaced.";
    if (plan.skipped.length) {
      tail += " " + plan.skipped.length + (plan.skipped.length === 1 ? " item is" : " items are") +
        " already here and will be left alone.";
    }
    return head + tail;
  }

  function install(kernel) {
    var E = kernel.need(
      "openDocIds", "registry", "confirmModal", "h", "saveOpenDocIds", "saveRegistry",
      "switchDoc", "modalSection", "modalField", "modalText", "tagDocProductStage",
      "tagDocCell", "clone", "dsModalShell", "bindProjectFolder", "iconBtn", "productSelectOptions",
      "doc", "findRegistryId", "colourForName", "formatRelativeTime",
      // uio-W08: the product choice offers "+ New product…" from inside the form that needs it.
      "promptModal", "createProduct",
      // Loading the sample workspace on demand writes to all THREE stores, because that is where a
      // workspace lives: products, source documents (LibraryStore) and design documents (registry).
      "libComponents", "saveLibrary", "saveProducts", "Store", "buildVersoBytes"
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

    // ---- moving a whole working environment ----------------------------------
    // The pure half is src/workspace-transfer.js, which builds the file and PLANS an import
    // without writing anything. This is the half that touches the disk and the stores, and its
    // whole job is to make sure the author sees the plan before any of it happens.
    function liveStores() {
      return {
        registry: registry,
        library: window.LibraryStore || { components: {} },
        products: window.ProductsStore || {},
        classification: window.ClassificationConfig || null
      };
    }
    function workspaceFilename(stamp) { return "verso-workspace-" + stamp + ".versoworkspace"; }
    // A stamp is the only thing here that needs a clock, and it is only ever a filename.
    function stampNow(now) {
      var d = new Date(now);
      function p(n) { return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    }
    function downloadWorkspace(name) {
      var WT = window.VersoWorkspaceTransfer; if (!WT) return null;
      var now = Date.now();
      var file = WT.buildWorkspaceFile(liveStores(), {
        now: now, generator: "Verso", origin: (typeof location !== "undefined" && location.href) || ""
      });
      var blob = new Blob([JSON.stringify(file)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name || workspaceFilename(stampNow(now));
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      return file;
    }
    // EXPORT EVERYTHING, IN ONE GESTURE. James, going through the flow for real: exporting five
    // documents one .verso at a time is "far too much work", and every manual repetition is a
    // chance to miss one and not notice. So the export picks a folder ONCE and writes the whole
    // thing into it -- the workspace file, plus a .verso per design document, which is what
    // carries the media the workspace file cannot.
    //
    // Why a folder and not one file: a .verso is built as a single in-memory byte array, so one
    // package holding 1.2 GB of media is not constructible in a tab. A folder of bounded per-course
    // packages is, and it is also what an author can hand to someone else or drop in OneDrive.
    //
    // FSA only, and it SAYS so rather than quietly doing something smaller. The Mac app's native
    // bridge writes UTF-8 text and cannot carry a binary ZIP, and Safari/Firefox have no directory
    // picker at all -- so those fall back to the one-file download and are told that is what
    // happened, because an export that silently leaves the media behind is the exact failure this
    // whole feature exists to prevent.
    function canWriteFolder() { return typeof window.showDirectoryPicker === "function"; }
    function exportWorkspaceEverything() {
      if (!canWriteFolder()) {
        confirmModal("Export everything",
          "This browser can't write to a folder, so only the workspace file can be saved here — and it does not carry your images. " +
          "Use a Chromium browser (Chrome or Edge) to export everything in one go, or export each document as .verso yourself from its row in Files.\n\n" +
          "Download the workspace file on its own now?",
          function () { exportWorkspaceFile(); }, { okLabel: "Download workspace file" });
        return;
      }
      window.showDirectoryPicker({ mode: "readwrite" }).then(function (dir) {
        runFolderExport(dir);
      }, function () { /* the author cancelled the picker -- not an error, and not worth a modal */ });
    }
    function runFolderExport(dir) {
      var WT = window.VersoWorkspaceTransfer;
      var now = Date.now(), stamp = stampNow(now);
      var wrote = [], failed = [];
      function write(name, data) {
        return dir.getFileHandle(name, { create: true })
          .then(function (fh) { return fh.createWritable(); })
          .then(function (w) { return w.write(data).then(function () { return w.close(); }); })
          .then(function () { wrote.push(name); })
          .catch(function (e) { failed.push({ name: name, why: (e && e.message) || String(e) }); });
      }
      var file = WT.buildWorkspaceFile(liveStores(), {
        now: now, generator: "Verso", origin: (typeof location !== "undefined" && location.href) || ""
      });
      var chain = write(workspaceFilename(stamp), JSON.stringify(file));
      // One document at a time, sequentially: each package is built whole in memory, and building
      // five at once is how a media-heavy workspace runs the tab out of it. A document that fails
      // to pack is RECORDED and the rest continue -- one bad course must not cost you the other four.
      Object.keys(registry).forEach(function (code) {
        chain = chain.then(function () {
          var built;
          try { built = E.buildVersoBytes(registry[code]); }
          catch (e) { failed.push({ name: code + ".verso", why: (e && e.message) || String(e) }); return; }
          return write(built.name, built.bytes);
        });
      });
      chain.then(function () { reportFolderExport(wrote, failed); });
    }
    // The summary NAMES what failed. "4 of 5 exported" is the sentence that gets read as success
    // and leaves one course behind; the whole point of automating this was to stop a document going
    // missing quietly.
    function reportFolderExport(wrote, failed) {
      var lines = ["Wrote " + wrote.length + " file" + (wrote.length === 1 ? "" : "s") + ":", wrote.join(", ")];
      if (failed.length) {
        lines.push("\nFAILED (" + failed.length + ") — these are NOT in the folder:");
        failed.forEach(function (f) { lines.push("  " + f.name + " — " + f.why); });
        lines.push("\nFix these before you rely on the folder as a backup.");
      } else {
        lines.push("\nThat is your whole workspace: every document, source document, product and setting, with each document's images in its own .verso.");
      }
      confirmModal(failed.length ? "Exported, with failures" : "Workspace exported", lines.join("\n"), function () {}, failed.length ? { danger: true } : null);
    }

    function exportWorkspaceFile() {
      var file = downloadWorkspace(null);
      if (!file) return;
      var n = file.media.assetRefs.length;
      // Said on the way OUT, not discovered on the way in. A workspace file that looks complete and
      // silently leaves the images behind is the failure this whole feature is meant to prevent.
      if (n) {
        confirmModal("Workspace exported",
          "The file carries your documents, source documents, products and settings — but not the " +
          n + " image" + (n === 1 ? "" : "s") + " they reference. Media is far too large to travel this way. " +
          "To move a document's images, export that document as .verso as well.", function () {});
      }
    }

    // The import. Four acts, in this order, and the order is the feature: read it, plan it, SAY it,
    // then back up what is here before touching any of it.
    function importWorkspaceFile() {
      var WT = window.VersoWorkspaceTransfer; if (!WT) return;
      var input = document.createElement("input");
      input.type = "file"; input.accept = ".versoworkspace,.json,application/json";
      input.addEventListener("change", function () {
        var f = input.files && input.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          var parsed; try { parsed = JSON.parse(r.result); }
          catch (e) { confirmModal("Import failed", "That file isn't readable as JSON.", function () {}); return; }
          var read = WT.readWorkspaceFile(parsed);
          if (!read.ok) { confirmModal("Import failed", read.errors.join(" "), function () {}); return; }
          chooseImportMode(read.workspace);
        };
        r.readAsText(f);
      });
      input.click();
    }
    // Replace is the DEFAULT and the destructive one, so it is the one that has to be stated
    // hardest. Merge exists for the server case -- a team standing up their own instance while
    // others bring local work in -- and must never be the default, because a merge that was meant
    // to be a replace leaves two of everything and a replace that was meant to be a merge is
    // unrecoverable.
    function chooseImportMode(ws) {
      var WT = window.VersoWorkspaceTransfer;
      var replace = WT.planImport(ws, liveStores(), "replace", E.findRegistryId);
      var merge = WT.planImport(ws, liveStores(), "merge", E.findRegistryId);
      var dropped = WT.droppedCount(replace);
      var body = "This workspace holds " + replace.total + " item" + (replace.total === 1 ? "" : "s") + ".\n\n" +
        "REPLACE — your workspace becomes this file. " +
        (dropped ? dropped + " item" + (dropped === 1 ? "" : "s") + " you have now would be removed." : "Nothing you have now would be removed.") + "\n\n" +
        "MERGE — bring it in alongside your work. Nothing is removed" +
        (merge.documents.collisions.length + merge.library.collisions.length + merge.products.collisions.length
          ? "; anything you already have is kept as it is." : ".");
      // Two named outcomes, so the DS modal shell carries Merge in the footer beside the primary --
      // the same shape the New-document dialog uses for Import / Load sample copy. confirmModal
      // takes one action and would have needed a third button bolted onto a surface every other
      // confirm in the app shares.
      var shell;
      var btnMerge = window.VersoUI.Button({ variant: "secondary", label: "Merge…", onClick: function () {
        shell.modal.close(); confirmImport(ws, "merge", merge);
      } });
      shell = dsModalShell({
        id: "import-workspace-modal", title: "Import a workspace", subtitle: body,
        extras: [btnMerge], primaryLabel: "Replace…", danger: true,
        onPrimary: function () { shell.modal.close(); confirmImport(ws, "replace", replace); }
      });
    }
    // The last screen before anything is written. It names the ids a replace would drop rather than
    // counting them: "12 documents will be removed" is a number, and a number is not enough to
    // agree to losing work by.
    function confirmImport(ws, mode, plan) {
      var WT = window.VersoWorkspaceTransfer;
      var has = (window.AssetStore && window.AssetStore.has) ? function (id) { return window.AssetStore.has(id); } : null;
      var missing = WT.missingMedia(plan, has);
      var lines = [];
      lines.push("Arriving: " + plan.documents.arriving.length + " document(s), " +
        plan.library.arriving.length + " library item(s), " + plan.products.arriving.length + " product(s).");
      var collisions = plan.documents.collisions.concat(plan.library.collisions, plan.products.collisions);
      if (collisions.length) {
        lines.push(mode === "replace"
          ? collisions.length + " already exist here and will be overwritten by the file's version."
          : collisions.length + " already exist here and will be LEFT AS THEY ARE.");
      }
      var dropped = plan.documents.dropped.concat(plan.library.dropped, plan.products.dropped);
      if (dropped.length) {
        lines.push("\nRemoved from this machine (" + dropped.length + "):\n" +
          dropped.slice(0, 12).join(", ") + (dropped.length > 12 ? ", and " + (dropped.length - 12) + " more" : ""));
      }
      if (missing.length) {
        lines.push("\n" + missing.length + " referenced image(s) are not on this machine, so some documents will render with gaps until you import their .verso files.");
      }
      lines.push("\nA backup of your CURRENT workspace downloads first, so this is reversible.");
      confirmModal(mode === "replace" ? "Replace this workspace?" : "Merge into this workspace?",
        lines.join("\n"),
        function () { runImport(ws, mode, plan); },
        { okLabel: mode === "replace" ? "Replace" : "Merge", danger: mode === "replace" });
    }
    // THE BACKUP RUNS FIRST, and if it cannot be written the import does not happen. This is the
    // single most important line in the ticket: an import you cannot undo is a data-loss event
    // wearing a confirm dialog.
    function runImport(ws, mode, plan) {
      var WT = window.VersoWorkspaceTransfer;
      var backup;
      try { backup = downloadWorkspace("verso-workspace-BEFORE-IMPORT-" + stampNow(Date.now()) + ".versoworkspace"); }
      catch (e) { backup = null; }
      if (!backup) {
        confirmModal("Import stopped", "The safety backup of your current workspace could not be written, so nothing was imported. Nothing has changed.", function () {});
        return;
      }
      var next;
      try { next = WT.applyImport(ws, liveStores(), plan, {}); }
      catch (e) { confirmModal("Import failed", "Nothing was changed: " + ((e && e.message) || e), function () {}); return; }
      try {
        Object.keys(registry).forEach(function (k) { delete registry[k]; });
        Object.keys(next.registry).forEach(function (k) { registry[k] = next.registry[k]; });
        saveRegistry(registry);
        window.LibraryStore = next.library; E.saveLibrary();
        window.ProductsStore = next.products; E.saveProducts();
        if (next.classification && E.Store && E.Store.saveClassification) E.Store.saveClassification(next.classification);
      } catch (e) {
        confirmModal("Import failed part-way", "Some of the import was written before it failed: " + ((e && e.message) || e) +
          "\n\nRestore the backup that just downloaded.", function () {});
        return;
      }
      // Reloaded rather than re-rendered: every open tab, the active document pointer and the
      // panels all hold references into the stores that were just replaced wholesale, and the
      // stale-reference class of bug is exactly what a document swap causes here.
      confirmModal("Workspace imported", "Verso will reload to open the imported workspace.", function () {
        try { location.reload(); } catch (e) {}
      });
    }

    // ---- loading the shipped sample workspace on demand -----------------------
    // The set is seeded into EMPTY stores at first boot, which means the people who most need it --
    // anyone already testing, with their own products and documents in the way -- could never see
    // it. This is the door for them. It states what it will add, adds only what is missing, and
    // lands you in Files, because it brings in several documents rather than one and the list is
    // what answers "what did that do".
    function loadSampleWorkspace() {
      var shipped = window.SAMPLE_WORKSPACE;
      if (!shipped) return;
      var comps = E.libComponents();
      var plan = sampleWorkspacePlan(shipped, {
        products: window.ProductsStore || {}, components: comps, registry: registry
      });
      var summary = sampleWorkspaceSummary(plan);
      if (!plan.total) { confirmModal("Sample workspace", summary, function () {}); return; }
      confirmModal("Add the sample workspace?", summary, function () {
        plan.products.forEach(function (id) { window.ProductsStore[id] = clone(shipped.products[id]); });
        plan.sourceDocs.forEach(function (id) { comps[id] = clone(shipped.sourceDocs[id]); });
        plan.designDocs.forEach(function (code) { registry[code] = clone(shipped.designDocs[code]); });
        E.saveProducts(); E.saveLibrary(); saveRegistry(registry);
        if (window.__leftRail) { window.__leftRail.invalidate("files"); window.__leftRail.setStage("files"); }
      }, { okLabel: "Add" });
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
      showNewDocDialog: showNewDocDialog, loadSampleWorkspace: loadSampleWorkspace,
      exportWorkspaceFile: exportWorkspaceFile, importWorkspaceFile: importWorkspaceFile,
      exportWorkspaceEverything: exportWorkspaceEverything, canWriteFolder: canWriteFolder
    });
  }

  window.VersoDocuments = { install: install, _pure: {
    newDocIdentity: newDocIdentity,
    sampleWorkspacePlan: sampleWorkspacePlan,
    sampleWorkspaceSummary: sampleWorkspaceSummary
  } };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoDocuments;
})();
