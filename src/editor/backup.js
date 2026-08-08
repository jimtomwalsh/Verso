// editor/backup.js -- the durable copy on disk (arch-P3b-07d).
//
// THE PROBLEM IT EXISTS FOR. The live course lives only in opaque browser storage: an OPFS or
// IndexedDB blob an author cannot see, copy, email, or restore from if the origin is cleared. This
// writes a real, portable file to a real folder on every debounced autosave -- a self-contained
// JSON with the images inlined, a schema CSV beside it, and a timestamped snapshot every fifteen
// minutes so a bad edit is recoverable rather than merely saved.
//
// It is a P0 data-safety surface, which is why it is not clever. Two backends behind one interface:
// the File System Access API in a browser, and a native bridge in the Verso desktop shell. Neither
// is assumed present -- `backupMode()` returns "none" and everything degrades to a no-op rather
// than throwing on a platform that cannot do it.
//
// FIVE things it reads from editor.js, the smallest dependency set of any region in this phase --
// which is what made it a clean move despite sitting inside a banner that also held the top bar,
// the three-stage model and the cell chip. Those are separate concerns and stayed.
//
// Editor chrome only: it serialises the document, but nothing here renders or exports to a
// learner.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "saveRegistry", "registry", "doc", "activeDocId", "dirPermission"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        saveRegistry = E.saveRegistry,
        registry = E.registry,
        // dirPermission stayed in editor.js (three regions ask the same question of a File System
        // Access handle). The move shipped without it in this list, so every FSA path here threw
        // `dirPermission is not defined` the moment a handle existed: no browser backup was ever
        // written, the boot reconnect died before it could clear the banner, and the banner's own
        // button died before it could reach the picker. A free identifier throws only when its
        // path runs, and no path here runs until a folder is bound -- the same class the 07
        // publish-run bug taught, one file later.
        dirPermission = E.dirPermission;

    // ---- Project auto-backup (P0 data-safety) --------
    // The live course exists ONLY in opaque WebKit storage; this writes durable,
    // portable copies to a real per-project folder on every debounced autosave.
    // Backup .json is SELF-CONTAINED (assets baked to data-URIs, like the Viewer
    // snapshot) so a single file fully restores structure + media. Handle in IDB
    // (verso-backup, keyed per docId); doc.backup carries serialisable metadata.
    var backupHandle = null, backupDebounceT = null, backupLastText = null, backupLastSnapshot = 0;
    var BACKUP_SNAPSHOT_MS = 15 * 60 * 1000;
    // Transport: the Verso Mac app (WKWebView) has NO File System Access API, so it uses a
    // NATIVE bridge (webkit.messageHandlers.versoBackup -> NSOpenPanel + FileManager, path
    // string, no re-grant); a Chromium browser uses FSA (directory handle). See the Swift
    // handler.
    function nativeBackupBridge() { return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.versoBackup) || null; }
    function backupMode() { if (nativeBackupBridge()) return "native"; if (window.showDirectoryPicker) return "fsa"; return "none"; }
    var __bkReqId = 0, __bkPending = {};
    // Swift calls this for EVERY versoBackup reply. store-native.js (loaded before editor.js)
    // also owns replies for its own reqIds -> CHAIN its handler instead of clobbering it, else
    // the #69 migration's bridge replies are lost and it hangs. Fall through on an unknown id.
    var __prevBackupReply = window.__versoBackupReply;
    window.__versoBackupReply = function (id, result) {
      var p = __bkPending[id];
      if (p) { delete __bkPending[id]; p(result); return; }
      if (typeof __prevBackupReply === "function") __prevBackupReply(id, result);
    };
    function nativeBackupCall(op, extra) {
      var br = nativeBackupBridge(); if (!br) return Promise.resolve(null);
      var id = "bk_" + (++__bkReqId);
      return new Promise(function (resolve) {
        __bkPending[id] = resolve;
        var msg = { op: op, reqId: id }; if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
        try { br.postMessage(msg); } catch (e) { delete __bkPending[id]; resolve(null); return; }
        setTimeout(function () { if (__bkPending[id]) { delete __bkPending[id]; resolve(null); } }, 20000); // watchdog
      });
    }
    function backupIdb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open("verso-backup", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("h"); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
    }
    async function saveBackupHandle(id, h) { try { var db = await backupIdb(); await new Promise(function (res, rej) { var tx = db.transaction("h", "readwrite"); tx.objectStore("h").put(h, id); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); } catch (e) {} }
    async function loadBackupHandle(id) { try { var db = await backupIdb(); return await new Promise(function (res) { var tx = db.transaction("h", "readonly"); var g = tx.objectStore("h").get(id); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }); } catch (e) { return null; } }
    function backupSlug() { return String((E.doc && (E.doc.code || E.doc.id)) || "course").replace(/[^\w.-]+/g, "_"); }
    // SELF-CONTAINED doc text: bake every asset:<id> -> data-URI on a throwaway clone so
    // one .json restores the course fully (structure + media), re-importable as-is.
    function selfContainedDocText() {
      var frozen = JSON.parse(JSON.stringify(E.doc));
      if (window.resolveMedia && window.AssetStore) {
        window.resolveMedia(frozen, function (id) { var a = window.AssetStore.get(id); return a ? a.dataUrl : window.AssetStore.placeholder; });
      }
      return JSON.stringify(frozen, null, 2);
    }
    async function writeBackupFile(dir, name, text) { var fh = await dir.getFileHandle(name, { create: true }); var w = await fh.createWritable(); await w.write(text); await w.close(); }
    function backupTs() { var d = new Date(); function p(n) { return (n < 10 ? "0" : "") + n; } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
    // Compose the files to write this pass (shared by both transports): live <slug>.json
    // (self-contained) + <slug>.schema.csv when changed; a snapshot on interval/force.
    function backupFilesFor(force) {
      var slug = backupSlug(), jsonText = selfContainedDocText(), unchanged = (jsonText === backupLastText), didSnap = false, files = [];
      if (!unchanged) { files.push({ name: slug + ".json", text: jsonText }); if (window.__schemaCsv) files.push({ name: slug + ".schema.csv", text: window.__schemaCsv(E.doc) }); }
      if (force || (Date.now() - backupLastSnapshot) > BACKUP_SNAPSHOT_MS) { files.push({ name: slug + "-backup-" + backupTs() + ".json", text: jsonText }); didSnap = true; }
      return { files: files, jsonText: jsonText, unchanged: unchanged, didSnap: didSnap };
    }
    // Write the backup now via the active transport (native app bridge or browser FSA).
    async function writeBackupNow(force) {
      var mode = backupMode();
      if (mode === "native") {
        if (!(E.doc && E.doc.backup && E.doc.backup.folderPath)) return { skipped: "no-folder" };
        var b = backupFilesFor(force);
        if (!b.files.length) return { skipped: "unchanged" };
        var r = await nativeBackupCall("write", { folder: E.doc.backup.folderPath, files: b.files });
        if (r && r.ok) { if (!b.unchanged) backupLastText = b.jsonText; if (b.didSnap) backupLastSnapshot = Date.now(); showBackupBanner(false); return { wrote: !b.unchanged, snapshot: b.didSnap, native: true }; }
        var nerr = (r && r.error) || "native write failed";
        reportBackupFault(nerr); return { error: nerr };
      }
      // browser FSA
      if (!backupHandle) return { skipped: "no-folder" };
      if ((await dirPermission(backupHandle, true)) !== "granted") { showBackupBanner(true); return { skipped: "no-permission" }; }
      var bb = backupFilesFor(force);
      if (!bb.files.length) return { skipped: "unchanged" };
      try {
        for (var i = 0; i < bb.files.length; i++) await writeBackupFile(backupHandle, bb.files[i].name, bb.files[i].text);
        if (!bb.unchanged) backupLastText = bb.jsonText;
        if (bb.didSnap) backupLastSnapshot = Date.now();
        showBackupBanner(false);
        return { wrote: !bb.unchanged, snapshot: bb.didSnap };
      } catch (e) { reportBackupFault(e); return { error: String((e && e.message) || e) }; }
    }
    function scheduleBackup() {
      if (!(E.doc && E.doc.backup) && !backupHandle) return;
      if (backupDebounceT) clearTimeout(backupDebounceT);
      backupDebounceT = setTimeout(function () { backupDebounceT = null; writeBackupNow(false); }, 2000);
    }
    // Bind (or re-bind) the active doc to a project folder — must run under a user gesture.
    async function bindProjectFolder() {
      var mode = backupMode();
      if (mode === "native") {
        var r = await nativeBackupCall("pickFolder");
        if (!r || !r.ok) return null;
        backupHandle = null; backupLastText = null; backupLastSnapshot = 0;
        E.doc.backup = { folderPath: r.path, folderName: r.name || "folder", boundAt: Date.now() };
        saveRegistry(registry);
        await writeBackupNow(true);
        return r;
      }
      if (mode === "fsa") {
        // One catch used to cover the picker AND everything after it, so a fault in the write
        // returned null exactly like a cancel: the author picked a folder, saw the banner stay,
        // and had nothing to report but "the button does nothing". Cancel is quiet; a real fault
        // is not.
        var h;
        try { h = await window.showDirectoryPicker({ mode: "readwrite" }); }
        catch (e) { return null; } // AbortError: the author closed the picker
        try {
          backupHandle = h; backupLastText = null; backupLastSnapshot = 0;
          E.doc.backup = { folderName: h.name || "folder", boundAt: Date.now() };
          await saveBackupHandle(E.activeDocId, h);
          saveRegistry(registry);
          await writeBackupNow(true);
          return h;
        } catch (e) { reportBackupFault(e); return null; }
      }
      window.alert("Can't pick a folder here. In the Verso app this uses a native picker; in a browser use Chrome or Edge, opened locally.");
      return null;
    }
    // On boot / doc switch: reconnect. NATIVE (non-sandboxed app) can always write, so a
    // stored folderPath = connected. FSA needs the persisted handle to still be granted;
    // if bound-but-not-writable -> LOUD banner (never silently drop).
    async function connectBackupFolder() {
      backupHandle = null; backupLastText = null; backupLastSnapshot = 0;
      if (!(E.doc && E.doc.backup)) { showBackupBanner(!!(E.doc && E.doc.backupRequired)); return; } // unbound + required (new course) -> nag
      if (backupMode() === "native") { showBackupBanner(!E.doc.backup.folderPath); return; }
      // Boot must always END in a banner decision. A throw here left the last banner state on
      // screen unchanged and no handle bound, which reads to an author as a banner that survives
      // a hard refresh for no reason.
      try {
        var saved = await loadBackupHandle(E.activeDocId);
        if (saved && (await dirPermission(saved, true)) === "granted") { backupHandle = saved; showBackupBanner(false); }
        else showBackupBanner(true);
      } catch (e) { reportBackupFault(e); }
    }
    async function reconnectBackupFolder() { // user gesture (banner / settings button)
      if (backupMode() === "native") { // path-based; just try a write, else re-pick
        if (E.doc && E.doc.backup && E.doc.backup.folderPath) { var r = await writeBackupNow(true); if (r && !r.error) { showBackupBanner(false); return true; } }
        return !!(await bindProjectFolder());
      }
      var saved = await loadBackupHandle(E.activeDocId);
      if (saved && (await dirPermission(saved, false)) === "granted") { backupHandle = saved; showBackupBanner(false); await writeBackupNow(true); return true; }
      return !!(await bindProjectFolder()); // permission lost / folder moved -> re-pick
    }
    // LOUD "backup OFF" banner (mirrors the save-fail banner) — decision 4.
    var backupBannerEl = null, backupFault = "";
    // A throw on a data-safety path must reach the author, not just the console. The banner is
    // already on screen when these paths run, so it carries the reason.
    function reportBackupFault(e) {
      backupFault = String((e && e.message) || e);
      if (window.console && console.error) console.error("[backup]", e);
      showBackupBanner(true);
    }
    function showBackupBanner(off) {
      if (!off) { if (backupBannerEl) backupBannerEl.hidden = true; return; }
      if (!backupBannerEl) {
        backupBannerEl = document.createElement("div");
        backupBannerEl.id = "backup-off-banner"; backupBannerEl.setAttribute("role", "alert");
        var m = document.createElement("span"); m.className = "backup-off-banner__msg"; backupBannerEl.appendChild(m);
        var b = document.createElement("button"); b.className = "backup-off-banner__btn"; b.type = "button";
        // reconnect if bound, else picks a folder. The rejection handler is the point: this button
        // is the author's only way back from backup-off, and a throw inside it used to be an
        // unhandled rejection nobody saw.
        b.addEventListener("click", function () {
          backupFault = "";
          Promise.resolve().then(reconnectBackupFolder).catch(reportBackupFault);
        });
        backupBannerEl.appendChild(b);
        document.body.appendChild(backupBannerEl);
      }
      // Two states: BOUND-but-not-writable (reconnect) vs never bound (choose a folder — new courses).
      var bound = !!(E.doc && E.doc.backup);
      backupBannerEl.querySelector(".backup-off-banner__msg").textContent = (bound
        ? "Backup OFF — this course is NOT being saved to " + (E.doc.backup.folderName || "your project folder") + ". Reconnect to resume auto-backup."
        : "No backup folder — this course is NOT being saved anywhere. Choose a project folder to protect your work.")
        + (backupFault ? " (Last attempt failed: " + backupFault + ")" : "");
      backupBannerEl.querySelector(".backup-off-banner__btn").textContent = bound ? "Reconnect folder" : "Choose folder";
      backupBannerEl.hidden = false;
    }
    window.__setBackupHandle = function (h) { backupHandle = h; backupLastText = null; backupLastSnapshot = 0; }; // test hook
    window.__writeBackupNow = function (force) { return writeBackupNow(force); }; // test hook
    window.__bindProjectFolder = bindProjectFolder; window.__connectBackupFolder = connectBackupFolder;
    window.__publishSnapshot = function () { var f = JSON.parse(JSON.stringify(E.doc)); delete f.comments; return { type: "verso-pub", schema: 1, course: E.doc.code || E.doc.id || "course", version: E.doc.version || "dev", publishedAt: Date.now(), doc: f }; }; // test hook

    kernel.expose({
      scheduleBackup: scheduleBackup, backupSlug: backupSlug, backupMode: backupMode,
      connectBackupFolder: connectBackupFolder,
      // The IndexedDB handle store is this file's, and the publish destinations key into the SAME
      // store -- one place remembers which folders the author has granted. The settings sheet and
      // the off-banner drive the two folder buttons. All five were still called by name from
      // editor.js after the region moved, which no boot and no unit test can see: a free identifier
      // throws only when its path runs (arch-P3b-07, found by an end-to-end publish run).
      loadBackupHandle: loadBackupHandle, saveBackupHandle: saveBackupHandle,
      bindProjectFolder: bindProjectFolder, reconnectBackupFolder: reconnectBackupFolder,
      backupHandleSet: function () { return !!backupHandle; }
    });
  }

  window.VersoBackup = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoBackup;
})();
