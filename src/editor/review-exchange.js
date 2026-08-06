// editor/review-exchange.js -- the round trip out to a reviewer and back (arch-P3b-07review).
//
// A reviewer does not open the authoring tool. They open the standalone Verso Viewer on a FROZEN
// snapshot, leave comments against it, and their notes come back. This file is the whole of that
// exchange: the snapshot it publishes, the folder both ends share, and the ingest that merges what
// comes back into the live document.
//
// THE FOLDER IS THE PROTOCOL. There is no server here. Both directions are files in one directory
// the author picks once, held as a File System Access handle and persisted in IndexedDB -- handles
// are structured-cloneable, so the connection survives a refresh. The browser may still demand one
// gesture to re-authorise after a restart, which is why `dirPermission` has a silent mode: the boot
// and poll paths ask without prompting and stay quiet if refused, and the button in the panel is
// what re-authorises. A connection that nags on every load is a connection an author disconnects.
//
// THE SNAPSHOT IS FROZEN ON PURPOSE. `snapshotBlob` deep-clones the document, strips the comments
// out and keeps every block cid. The cids are what make a returning comment land on the paragraph
// it was written against, even after the author has since edited around it. Publishing a live
// document instead of a copy would make the anchor meaningless.
//
// INGEST IS THE OTHER HALF, AND IT ONLY EVER ADDS. `mergeComments` in comments.js owns what a merge
// means; this file finds the sidecars, reads them and hands them over. It counts what arrived
// before and after so the toast can say something true, and the silent path stays silent when
// nothing came back. The poll is one minute, and it stops while the tab is hidden along with the
// rest of the background governor.
//
// It is not the comment model. comments.js owns pins, anchors and merging; this file owns getting
// them out of the building and back. The seam between them is three names wide.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pushHistory", "scheduleSave", "mergeComments", "renderCommentPins", "refreshCommentPanel",
      "dirPermission",
      "doc", "world"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        pushHistory = E.pushHistory,
        scheduleSave = E.scheduleSave,
        mergeComments = E.mergeComments,
        renderCommentPins = E.renderCommentPins,
        refreshCommentPanel = E.refreshCommentPanel,
        dirPermission = E.dirPermission;

    function buildPipelineBody(c) {
      // Export SCORM / Import CSV / JSON backup now live in the TOP BAR (D6: primary Export +
      // ⋯ overflow) — retired from here. This panel keeps only the review-folder workflow.
      c.appendChild(h("div", "insp-hint", "Export & import moved to the top bar (the Export button + ⋯ menu). This section handles the review-folder workflow."));
      // §12 Viewer V1: publish a FROZEN review snapshot (.versopub.json) — the doc with
      // all block cids, comments stripped — that the standalone Verso Viewer opens so
      // reviewers can drop comments anchored to this exact version.
      c.appendChild(h("div", "insp-hint", "Publish a frozen snapshot into the shared review folder; reviewers comment in the Verso Viewer and their notes return to the same folder. Once connected, new comments auto-ingest on launch + every minute — the button below re-checks now / reconnects the folder."));
      var pubBtn = h("button", "prop-btn", "Publish to Viewer…");
      pubBtn.addEventListener("click", publishToViewer);
      c.appendChild(pubBtn);
      var ingBtn = h("button", "prop-btn", "Check for reviews now…");
      ingBtn.addEventListener("click", ingestReviewsFromFolder);
      c.appendChild(ingBtn);
    }
    // §12 Viewer: a chosen exchange-folder handle (File System Access), remembered for
    // the session so publish + ingest reuse it. Not persisted (a fresh session re-picks).
    // §12 Viewer: the shared exchange-folder handle (File System Access). PERSISTED in
    // IndexedDB (FileSystemHandles are structured-cloneable) so the connection survives
    // a refresh/restart and reviews can auto-ingest on load + on a poll. The browser may
    // still require ONE user gesture to re-authorise after a full restart — handled by
    // degrading to a manual re-pick when silent permission isn't granted.
    var reviewDirHandle = null;
    var reviewPollTimer = null;
    function reviewIdb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open("verso-review", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("h"); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
    }
    async function saveReviewDir(handle) { try { var db = await reviewIdb(); await new Promise(function (res, rej) { var tx = db.transaction("h", "readwrite"); tx.objectStore("h").put(handle, "dir"); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); } catch (e) {} }
    async function loadReviewDir() { try { var db = await reviewIdb(); return await new Promise(function (res) { var tx = db.transaction("h", "readonly"); var g = tx.objectStore("h").get("dir"); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }); } catch (e) { return null; } }
    // Get a usable folder handle: in-memory > persisted (with a gesture-driven re-grant)
    // > pick a new one. Persists the pick so it's remembered next launch.
    async function ensureReviewFolder() {
      if (reviewDirHandle && (await dirPermission(reviewDirHandle, false)) === "granted") return reviewDirHandle;
      var saved = await loadReviewDir();
      if (saved && (await dirPermission(saved, false)) === "granted") { reviewDirHandle = saved; startReviewPoll(); return reviewDirHandle; }
      if (!window.showDirectoryPicker) return null;
      try { reviewDirHandle = await window.showDirectoryPicker({ mode: "readwrite" }); await saveReviewDir(reviewDirHandle); startReviewPoll(); return reviewDirHandle; }
      catch (e) { return null; }
    }
    function snapshotBlob(versionOverride) {
      var frozen = JSON.parse(JSON.stringify(E.doc));
      delete frozen.comments; // reviewers add their own; cids already present (normalizeDoc)
      // §12a: bake every AssetStore "asset:<id>" ref (images, per-mode sources, embeds,
      // header logo, glossary) into a self-contained base64 data-URI so the frozen snapshot
      // renders standalone in the Verso Viewer, which has NO AssetStore. Same base64 path as
      // export (NOT editorAssetResolve, whose blob: URLs don't travel to another machine);
      // the clone is throwaway so there's nothing to restore.
      if (window.resolveMedia && window.AssetStore) {
        window.resolveMedia(frozen, function (id) {
          var a = window.AssetStore.get(id);
          return a ? a.dataUrl : window.AssetStore.placeholder;
        });
      }
      var course = E.doc.code || E.doc.id || "course";
      var version = versionOverride || E.doc.version || (new Date().toISOString().slice(0, 10));
      var snap = { type: "verso-pub", schema: 1, course: course, version: version, publishedAt: Date.now(), doc: frozen };
      var name = "verso-" + String(course).replace(/[^\w.-]+/g, "_") + "-" + String(version).replace(/[^\w.-]+/g, "_") + ".versopub.json";
      return { name: name, text: JSON.stringify(snap) };
    }
    // Freeze the current doc into a review snapshot. Writes straight to the shared
    // review folder (File System Access) when available; falls back to a download.
    // `versionOverride` lets the SCORM export tag the review file with the SAME version.
    async function publishToViewer(versionOverride, quiet) {
      var f = snapshotBlob(versionOverride);
      var dir = await ensureReviewFolder();
      if (dir) {
        try {
          var fh = await dir.getFileHandle(f.name, { create: true });
          var w = await fh.createWritable(); await w.write(f.text); await w.close();
          if (!quiet) window.alert("Published " + f.name + " to the review folder.");
          return { name: f.name, to: "folder" };
        } catch (e) { /* fall through to download */ }
      }
      var blob = new Blob([f.text], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = f.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      return { name: f.name, to: "download" };
    }
    // Scan a folder handle for reviewer sidecars (review-*.json) and merge them all
    // (conflict-free). Returns { added, updated, files }. Pure of UI so both the manual
    // button and the auto/poll path reuse it.
    async function scanAndMerge(dir) {
      var added = 0, updated = 0, files = 0;
      for await (var entry of dir.values()) {
        if (entry.kind !== "file" || !/^review-.*\.json$/i.test(entry.name)) continue;
        try {
          var file = await entry.getFile();
          var parsed = JSON.parse(await file.text());
          var list = Array.isArray(parsed) ? parsed : (parsed && parsed.comments);
          if (!Array.isArray(list)) continue;
          var r = mergeComments(list); added += r.added; updated += r.updated; files++;
        } catch (e) { /* skip a bad file */ }
      }
      return { added: added, updated: updated, files: files };
    }
    // Manual ingest (button): picks/authorises the folder if needed, then reports.
    async function ingestReviewsFromFolder() {
      var dir = await ensureReviewFolder();
      if (!dir) { window.alert("Folder access needs Edge/Chrome opened locally. Use the comment panel's Import… as a fallback."); return; }
      var r;
      try { pushHistory(); r = await scanAndMerge(dir); }
      catch (e) { window.alert("Could not read the folder: " + e.message); return; }
      scheduleSave(); renderCommentPins(); refreshCommentPanel();
      window.alert("Ingested " + r.files + " review file(s): " + r.added + " new comments, " + r.updated + " updated.");
    }
    // Silent auto-ingest (boot + poll): only touches the doc / notifies when something
    // NEW actually arrived, so it never nags. Never prompts for permission.
    async function autoIngestReviews() {
      var dir = reviewDirHandle || await loadReviewDir();
      if (!dir) return;
      if ((await dirPermission(dir, true)) !== "granted") return; // wait for a gesture-driven re-grant
      reviewDirHandle = dir;
      var before = (E.doc.comments || []).length;
      var r;
      try { r = await scanAndMerge(dir); } catch (e) { return; }
      if (r.added > 0 || r.updated > 0) {
        scheduleSave(); renderCommentPins(); refreshCommentPanel();
        if (r.added > 0) reviewToast(r.added + " new review comment" + (r.added > 1 ? "s" : "") + " arrived");
      }
      void before;
    }
    function startReviewPoll() {
      if (reviewPollTimer) return;
      // OneDrive sync + FSA: a 60s poll is plenty; guarded by silent permission.
      reviewPollTimer = setInterval(function () { autoIngestReviews(); }, 60000);
    }
    function stopReviewPoll() { if (reviewPollTimer) { clearInterval(reviewPollTimer); reviewPollTimer = null; } }
    // Power (#179): pause background work when the window is occluded / minimised so macOS App
    // Nap can engage (a laptop energy win in the packaged WKWebView app). WebKit fires
    // visibilitychange on occlusion. We pause the two forever-timers -- autosave (flushed first
    // by its governor) + the review poll -- and drop the world's GPU-layer promotion; all resume
    // on return. `_reviewPollWasOn` remembers whether the poll was actually running so we don't
    // start it on a course that never had folder permission. Editor chrome only.
    var _reviewPollWasOn = false;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        _reviewPollWasOn = !!reviewPollTimer;
        if (window.__autosaveGov) window.__autosaveGov.pause();
        stopReviewPoll();
        if (E.world) E.world.style.willChange = "auto"; // release the compositor layer while unseen
      } else {
        if (window.__autosaveGov) window.__autosaveGov.resume();
        if (_reviewPollWasOn) startReviewPoll();
        if (E.world) E.world.style.willChange = ""; // restore the CSS-driven promotion (transform)
      }
    });
    function reviewToast(msg) {
      var t = h("div", "review-toast", msg);
      document.body.appendChild(t);
      setTimeout(function () { t.classList.add("is-out"); }, 3600);
      setTimeout(function () { if (t.parentNode) t.remove(); }, 4200);
    }
    // Boot: reconnect the saved folder + auto-ingest if the browser still grants it
    // silently; otherwise stay quiet until the next Ingest click re-authorises.
    async function initReviewAutoIngest() {
      if (!window.showDirectoryPicker) return;
      var saved = await loadReviewDir(); if (!saved) return;
      if ((await dirPermission(saved, true)) === "granted") { reviewDirHandle = saved; startReviewPoll(); autoIngestReviews(); }
    }
    window.__setReviewDir = function (d) { reviewDirHandle = d; }; // test hook
    window.__autoIngestReviews = autoIngestReviews; // test hook

    kernel.expose({
      buildPipelineBody: buildPipelineBody, publishToViewer: publishToViewer, ingestReviewsFromFolder: ingestReviewsFromFolder,
      initReviewAutoIngest: initReviewAutoIngest
    });
  }

  window.VersoReviewExchange = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoReviewExchange;
})();
