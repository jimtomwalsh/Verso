// editor/comments.js -- review, without a server (arch-P3b-07).
//
// A reviewer drops a pin on the canvas and types. That is the whole feature, and everything here
// exists to make it survive the two things this app insists on: no network, and no second store.
//
// PINS ARE EDITOR CHROME. They are an overlay on the canvas viewport, outside render.js output, so
// they never reach the export -- the same rule the selection and drag chrome follow. What persists
// is doc.comments, in the document's own .json, stripped on the way to SCORM.
//
// ANCHORING IS THREE-TIER: a pin binds to a block if it can, else to a page, else to a point in the
// world. That ladder is what lets a comment survive an edit -- a block that moves takes its pins
// with it, and a block that is deleted leaves an orphan the panel SURFACES rather than silently
// drops, because a review note nobody can find is worse than one attached to the wrong thing.
//
// TWO SURFACES, ONE STORE. Pins are dropped and read on the authoring canvas AND inside the
// fullscreen preview, so the surface is an abstraction (which root, which layer, which rect) and
// the store is the same either way.
//
// THE TRANSPORT IS A FILE. Comments export as a standalone sidecar and import by merging on id, so
// a review round-trips through email or a shared folder on an air-gapped site. Presence and the
// conflict chrome are the same code path when a server IS present.
//
// Editor chrome only: it annotates the document and never renders it.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "canvas", "view", "pushHistory", "scheduleSave", "panning",
      "demoStageEl", "demoIsOpen", "renderInspector", "walkBlocks", "isTextTarget", "mount",
      "demoDeviceEl", "setInteractMode", "setRightTab", "rightTabNow", "syncRightTabs", "clearSelection", "clearAllMulti",
      "refreshCanvasSelection", "panelSection", "iconBtn", "reapplyStructural", "rebindTourBuilderToLiveDoc",
      "applyView", "cycleGrid", "updateGridBtn", "toggleStyleAudit", "updateStyleAuditBtn",
      "startMarquee", "updateMarquee", "panDrag", "endMarquee", "fitCycle", "addPageAfterCurrent",
      "promptModal", "createChapter", "collapseTreeToChapters", "inspector", "last", "world",
      "spaceHeld", "marquee", "interactMode", "panelFields", "activeDocId", "doc",
      "resetPanelFields",
      "setInspector"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        canvas = E.canvas,
        view = E.view,
        pushHistory = E.pushHistory,
        scheduleSave = E.scheduleSave,
        panning = E.panning,
        demoStageEl = E.demoStageEl,
        demoIsOpen = E.demoIsOpen,
        renderInspector = E.renderInspector,
        walkBlocks = E.walkBlocks,
        isTextTarget = E.isTextTarget,
        mount = E.mount,
        demoDeviceEl = E.demoDeviceEl,
        setInteractMode = E.setInteractMode,
        clearSelection = E.clearSelection,
        clearAllMulti = E.clearAllMulti,
        refreshCanvasSelection = E.refreshCanvasSelection,
        panelSection = E.panelSection,
        iconBtn = E.iconBtn,
        reapplyStructural = E.reapplyStructural,
        rebindTourBuilderToLiveDoc = E.rebindTourBuilderToLiveDoc,
        applyView = E.applyView,
        cycleGrid = E.cycleGrid,
        updateGridBtn = E.updateGridBtn,
        toggleStyleAudit = E.toggleStyleAudit,
        updateStyleAuditBtn = E.updateStyleAuditBtn,
        startMarquee = E.startMarquee,
        updateMarquee = E.updateMarquee,
        panDrag = E.panDrag,
        endMarquee = E.endMarquee,
        fitCycle = E.fitCycle,
        addPageAfterCurrent = E.addPageAfterCurrent,
        promptModal = E.promptModal,
        createChapter = E.createChapter,
        collapseTreeToChapters = E.collapseTreeToChapters;

    // arch-P3b-07z: the comment MODEL, moved in from editor.js. It sat under a banner called
    // "interaction element identity" -- the cid minting is genuinely that -- but the model built
    // on top of it has never had a consumer outside this file and source-stage.js.
    // §12 slice 1: a comment object. `anchor` is one of the 3 tiers (block/page/
    // general — see makeAnchorFromPoint). `author`/`colour`/`replies` are in the
    // schema now so multi-user colours + threading (slice 5) are ADDITIVE — no
    // migration. Build 1 is flat + `done`.
    function makeComment(anchor, body) {
      var id = (typeof commentIdentity === "function") ? commentIdentity() : { name: null, colour: null };
      return { id: "cm_" + Math.random().toString(36).slice(2, 8), anchor: anchor, body: body || "",
        done: false, author: id.name || null, colour: id.colour || null, createdAt: Date.now(), replies: [] };
    }
    window.__makeComment = makeComment;
    // §12 / #196: pin taxonomy. A comment is one of two KINDS:
    // - "task"    (default): a human-authored instruction — appears in the right-panel queue,
    // open|done via `.done`.
    // - "receipt": a nested CHANGE record under its task via `.parentId`, carrying the before/after
    // text (`.original`/`.changed`) so the author can review + revert. Never appears in
    // the queue; it belongs to its task.
    // Additive to the makeComment schema (exactly like author/colour/replies before it) — NO migration:
    // a legacy comment with no `.kind` reads as a task (see commentIsTask). This is the model + the
    // pure classifiers the list/pin UIs consume.
    // Pure classifiers — no Date/Math/identity deps, so they are asserted headlessly. A comment with
    // no `.kind` is a task (back-compat). Receipts are excluded from the queue and grouped by parent.
    function commentIsReceipt(c) { return !!(c && c.kind === "receipt"); }
    function commentIsTask(c) { return !!c && !commentIsReceipt(c); }
    function taskComments(doc) { return ((doc && doc.comments) || []).filter(commentIsTask); }
    function receiptsFor(doc, taskId) { return ((doc && doc.comments) || []).filter(function (c) { return commentIsReceipt(c) && c.parentId === taskId; }); }
    function openTasks(doc) { return taskComments(doc).filter(function (c) { return !c.done; }); }
    function doneTasks(doc) { return taskComments(doc).filter(function (c) { return !!c.done; }); }
    // ticket 26 (review-links round-trip): guest-vs-internal + orphaned-anchor classifiers. Both are
    // pure + additive over the SHIPPED comment object (no new store, no migration) -- a guest comment
    // is an ordinary doc.comments entry with source:"guest-link"; an orphaned one is a block-anchored
    // note whose target block (by stable cid) the author has since deleted. Surfaced, never dropped.
    /* @comment-guest-start */
    function commentIsGuest(c) { return !!(c && (c.source === "guest-link" || c.guest === true)); }
    function docCids(doc, acc) {
      acc = acc || {};
      walkBlocks(doc, function (b) { if (typeof b.cid === "string") acc[b.cid] = true; });
      return acc;
    }
    function commentIsOrphaned(c, doc) {
      var a = c && c.anchor;
      if (!a || !a.blockId) return false; // only block-anchored notes orphan (page/world resolve differently)
      return !docCids(doc)[a.blockId];
    }
    // ticket 26 id-space bridge: the server anchors review comments by the STABLE block id (block.id),
    // but the client comment mode pins by CID (data-cid). Map a server block.id -> its client cid so a
    // guest comment resolves onto the live block. Returns the cid, or null (-> surfaces as orphaned,
    // never mis-anchored). Pure; walks nested containers like docCids.
    function blockCidById(doc, id) {
      if (id == null) return null;
      var found = null;
      walkBlocks(doc, function (b) { if (found == null && b.id === id && typeof b.cid === "string") found = b.cid; });
      return found;
    }
    // inverse of blockCidById: a client cid -> the server STABLE block id, so an author's reply/resolve
    // can be fanned back to the server (which anchors by block.id). Null if unmapped. Pure.
    function blockIdByCid(doc, cid) {
      if (cid == null) return null;
      var found = null;
      walkBlocks(doc, function (b) { if (found == null && b.cid === cid && b.id != null) found = b.id; });
      return found;
    }
    // ticket 26: map a server->client `comment.added` ENVELOPE (blockId + author live on the envelope;
    // {id, threadId, body, kind} in payload -- see server/sync.js) into a client comment shaped like
    // makeComment, anchored by cid so the shipped pins/panel render it. Guest notes carry source. Pure
    // (colourFn injected). -> a client comment, or null if the envelope has no comment id.
    function commentFromEnv(env, doc, colourFn) {
      if (!env) return null;
      var p = env.payload || {};
      if (!p.id) return null;
      var cid = blockCidById(doc, env.blockId);
      return {
        id: p.id,
        anchor: { blockId: cid || env.blockId }, // cid resolves the pin; a raw id falls through to orphaned
        body: p.body || "",
        author: env.author || null,
        colour: env.author ? colourFn(env.author) : null,
        done: false,
        source: (p.kind === "guest") ? "guest-link" : null,
        threadId: p.threadId || p.id,
        createdAt: env.ts || 0,
        replies: []
      };
    }
    /* @comment-guest-end */
    window.__commentModel = { isReceipt: commentIsReceipt, isTask: commentIsTask, tasks: taskComments, receiptsFor: receiptsFor, openTasks: openTasks, doneTasks: doneTasks, isGuest: commentIsGuest, isOrphaned: commentIsOrphaned };

    // ==========================================================================
    // §12 slice 2 — Comment mode: drop review pins on the canvas, 3-tier anchored
    // (block > page > world). Pins are EDITOR CHROME (an overlay on the fixed
    // canvas viewport) — they live OUTSIDE render.js output and never ship in the
    // export (mirrors the selection / drag chrome). The store is `doc.comments`,
    // persisted in the .json, stripped from SCORM.
    // ==========================================================================
    var COMMENT_MODE_KEY = "authoring.commentMode";
    var commentBtn = document.getElementById("comment-toggle");
    // Comment MODE is this file's own state: the canvas hands its clicks to the pin dropper while it
    // is on, and the drill and marquee handlers bail on it. It used to be declared in editor.js so
    // those handlers could see it; they ask now (arch-P3b-07).
    var commentMode = false;
    var commentPinLayer = null; // canvas pin overlay
    var demoPinLayer = null;    // §12 slice 4: preview pin overlay
    var demoCommentMode = false; // §12 slice 4: comment mode inside the demo/preview
    var openCommentId = null;   // the comment whose popover is open
    var editingComment = null;  // the comment currently being edited (for empty-drop cleanup)
    // What the rest of the chrome may ask about a review in progress. Each is a question rather
    // than a variable, so this file stays the only writer.
    function commentModeOn() { return commentMode; }
    function openCommentIdNow() { return openCommentId; }
    function demoCommentModeNow() { return demoCommentMode; }
    function resetDemoCommentMode() { demoCommentMode = false; }   // entering the preview, without the setter's side effects
    function collabChrome() { return CollabChrome; }               // present only when a server is
    function commentPinLayerEl() { return commentPinLayer; }
    function demoPinLayerEl() { return demoPinLayer; }
    function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
    // §12 slice 4: comment pins work on TWO surfaces — the authoring canvas and the
    // demo/preview — sharing ONE store (doc.comments). A surface descriptor abstracts
    // the differences: where to query blocks/pages (`root`), where the pin overlay
    // lives (`layerParent` + `getLayer`), the container the pins position against
    // (`rect`), and whether world/general anchors apply (canvas-only). `activeSurf()`
    // picks the demo while it's open + in comment mode, else the canvas.
    function canvasSurf() {
      return { name: "canvas", root: E.world, layerParent: canvas,
        getLayer: function () { if (!commentPinLayer) commentPinLayer = h("div", "comment-pin-layer"); return commentPinLayer; },
        rect: function () { return canvas.getBoundingClientRect(); }, allowWorld: true,
        worldToPx: function (a) { return { px: view.x + a.worldX * view.zoom, py: view.y + a.worldY * view.zoom }; },
        inMode: function () { return commentMode; } };
    }
    function demoSurf() {
      return { name: "demo", root: demoDeviceEl(), layerParent: demoStageEl(),
        getLayer: function () { if (!demoPinLayer) demoPinLayer = h("div", "comment-pin-layer"); return demoPinLayer; },
        rect: function () { return demoStageEl().getBoundingClientRect(); }, allowWorld: false,
        worldToPx: function () { return null; }, // world/general pins are canvas-only
        inMode: function () { return demoCommentMode; } };
    }
    // Demo is the active surface WHENEVER the preview overlay is open (pins are shown
    // there in read mode too); demoCommentMode only gates DROPPING new pins.
    function activeSurf() { return demoIsOpen() ? demoSurf() : canvasSurf(); }

    function setCommentMode(on) {
      on = !!on;
      if (commentMode === on) return;
      commentMode = on;
      try { localStorage.setItem(COMMENT_MODE_KEY, on ? "1" : "0"); } catch (e) {}
      canvas.classList.toggle("is-comment-mode", commentMode);
      if (commentBtn) commentBtn.classList.toggle("is-active", commentMode);
      if (commentMode) { if (E.interactMode) setInteractMode(false); closeCommentPopover(); clearSelection(); clearAllMulti(); refreshCanvasSelection(); }
      else closeCommentPopover();
      // uio-E-M06 (EDIT-16): the mode no longer evicts the inspector -- it lands the panel on the
      // Comments TAB (and hands it back on the way out), and the tab stays freely switchable while
      // the mode is on, so reviewing and fixing coexist.
      E.setRightTab(commentMode ? "comments" : "design");
      renderCommentPins();
    }
    // §12 slice 3: the right panel becomes the comment LIST while in comment mode.
    var commentFilter = "open"; // "open" | "resolved"
    function renderCommentList() {
      E.inspector.innerHTML = ""; E.resetPanelFields(); // self-clearing: the filter/resolve/row
      // handlers call this directly (not via renderInspector), so it must not double-append.
      var UI = window.VersoUI; // DS canonical control set (re-skin, issue #17)
      // uio-O-W2 (OVL-07): the identity + sidecar controls are a section, not a bold line with no
      // affordance. The filter and the list below are the panel's own rows.
      var _cmtRoot = E.inspector;
      E.setInspector(panelSection(_cmtRoot, "Comments"));
      // §12 slice 5: who am I (author identity) + sidecar transport
      var idn = commentIdentity();
      var idRow = h("div", "comment-identity");
      var idDot = h("span", "comment-row__dot"); idDot.style.background = idn.colour;
      var nameField = UI.TextField({ value: idn.name });
      nameField.classList.add("comment-identity__field");
      nameField.input.title = "Your name (stamped on comments you drop)";
      nameField.input.addEventListener("change", function () { setCommentAuthor(nameField.input.value); renderCommentList(); });
      idRow.appendChild(idDot); idRow.appendChild(nameField);
      E.inspector.appendChild(idRow);
      // sidecar transport — Export / Import (two secondary buttons, 2-up)
      E.inspector.appendChild(UI.TwoUp({ children: [
        UI.Button({ variant: "secondary", full: true, label: "Export…", title: "Save comments as a sidecar JSON", onClick: function () { exportComments(); } }),
        UI.Button({ variant: "secondary", full: true, label: "Import…", title: "Merge a reviewer's comments file", onClick: function () { importComments(); } })
      ] }));
      E.setInspector(_cmtRoot);
      var list = (E.doc.comments || []);
      var openN = list.filter(function (c) { return !c.done; }).length;
      var resN = list.length - openN;
      // Open / Resolved filter — primary = active (2-up)
      E.inspector.appendChild(UI.TwoUp({ children: [
        UI.Button({ variant: commentFilter === "open" ? "primary" : "secondary", full: true, label: "Open (" + openN + ")", onClick: function () { commentFilter = "open"; renderCommentList(); } }),
        UI.Button({ variant: commentFilter === "resolved" ? "primary" : "secondary", full: true, label: "Resolved (" + resN + ")", onClick: function () { commentFilter = "resolved"; renderCommentList(); } })
      ] }));
      var shown = list.filter(function (c) { return commentFilter === "resolved" ? c.done : !c.done; });
      // ticket 26: split off ORPHANED notes (block-anchored, block since deleted) into their own tray
      // so a reviewer's feedback is never silently lost when the author deletes the block it points at.
      var orphaned = shown.filter(function (c) { return commentIsOrphaned(c, E.doc); });
      var anchored = shown.filter(function (c) { return !commentIsOrphaned(c, E.doc); });
      if (!shown.length) {
        E.inspector.appendChild(h("div", "insp-hint", commentFilter === "resolved" ? "No resolved comments yet." : "No open comments. Click anywhere on the canvas to drop one."));
        return;
      }
      // one row builder, reused for the anchored list + the orphaned tray (ticket 26).
      function commentRow(c, isOrphan) {
        var row = h("div", "comment-row" + (c.id === openCommentId ? " is-open" : "") + (isOrphan ? " is-orphan" : ""));
        var dot = h("span", "comment-row__dot"); if (c.colour) dot.style.background = c.colour;
        var mid = h("div", "comment-row__mid");
        var top = h("div", "comment-row__meta");
        if (c.author) top.appendChild(h("span", "comment-row__name", c.author));
        if (commentIsGuest(c)) top.appendChild(h("span", "comment-row__tag is-guest", "Guest")); // ticket 26: guest-vs-internal
        if (top.childNodes.length) mid.appendChild(top);
        var text = (c.body || "").trim();
        mid.appendChild(h("span", "comment-row__snip" + (text ? "" : " is-empty"), text || "(empty note)"));
        if (isOrphan) mid.appendChild(h("div", "comment-row__orphan-note", "The block this points at was deleted."));
        row.appendChild(dot); row.appendChild(mid);
        if (isOrphan) {
          var dismiss = iconBtn("trash", "Dismiss this orphaned note", true);
          dismiss.addEventListener("click", function (e) { e.stopPropagation(); pushHistory(); E.doc.comments = (E.doc.comments || []).filter(function (x) { return x.id !== c.id; }); scheduleSave(); renderCommentPins(); renderCommentList(); });
          row.appendChild(dismiss);
        } else {
          var box = UI.Checkbox({ checked: !!c.done, onChange: function (v) { pushHistory(); c.done = v; if (typeof CollabChrome !== "undefined") CollabChrome.fanoutResolve(c, v); scheduleSave(); renderCommentPins(); renderCommentList(); } });
          box.classList.add("comment-row__done"); box.title = "Resolve";
          box.addEventListener("click", function (e) { e.stopPropagation(); });
          row.appendChild(box);
          row.addEventListener("click", function () { jumpToComment(c); renderCommentList(); });
        }
        return row;
      }
      var listWrap = h("div", "comment-list");
      anchored.forEach(function (c) { listWrap.appendChild(commentRow(c, false)); });
      E.inspector.appendChild(listWrap);
      if (orphaned.length) {
        E.inspector.appendChild(h("div", "comment-group__head", "Orphaned — need a home (" + orphaned.length + ")"));
        E.inspector.appendChild(h("div", "insp-hint", "These notes lost the block they pointed at. Kept, never dropped — re-anchor by re-adding the block, or dismiss."));
        var orphanWrap = h("div", "comment-list is-orphan-tray");
        orphaned.forEach(function (c) { orphanWrap.appendChild(commentRow(c, true)); });
        E.inspector.appendChild(orphanWrap);
      }
    }
    // Re-render the panel list after a comment change (only while the Comments TAB is showing —
    // renderInspector clears + routes to renderCommentList; calling it directly would
    // double-append). No-op otherwise so the Design/Interact panels are not churned.
    function refreshCommentPanel() { if (E.rightTabNow() === "comments") renderInspector(); }
    // §12 slice 5: author identity + colour (per reviewer). Stored in localStorage so
    // this machine's drops carry a stable name + a deterministic colour; the schema
    // already reserved author/colour, so this is additive (no migration).
    var COMMENT_AUTHOR_KEY = "authoring.commentAuthor";
    var COMMENT_COLOURS = ["#f5a623", "#4d7cad", "#e0563f", "#2ea36b", "#9b59b6", "#e91e8c", "#0d99ff", "#d4a017"];
    function colourForName(name) { var x = 0; name = name || ""; for (var i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) >>> 0; return COMMENT_COLOURS[x % COMMENT_COLOURS.length]; }
    function commentIdentity() {
      try { var s = JSON.parse(localStorage.getItem(COMMENT_AUTHOR_KEY) || "null"); if (s && s.name) return s; } catch (e) {}
      return { name: "Me", colour: colourForName("Me") };
    }
    function setCommentAuthor(name) {
      name = (name || "").trim() || "Me";
      var id = { name: name, colour: colourForName(name) };
      try { localStorage.setItem(COMMENT_AUTHOR_KEY, JSON.stringify(id)); } catch (e) {}
      return id;
    }
    // §12 slice 5: a reply on a comment (threading). Same author/colour stamp.
    function makeReply(body) {
      var id = commentIdentity();
      return { id: "rp_" + Math.random().toString(36).slice(2, 8), body: body || "", author: id.name || null, colour: id.colour || null, createdAt: Date.now() };
    }
    // §12 slice 5: the air-gapped transport. Comments export as a standalone SIDECAR
    // JSON (never baked into the course / SCORM); a reviewer sends it back and it is
    // MERGED (union by id, replies unioned, resolve adopted) — conflict-free, so two
    // people's notes combine without clobbering.
    function exportComments() {
      var payload = { type: "verso-comments", version: 1, exportedBy: commentIdentity().name, exportedAt: Date.now(), comments: E.doc.comments || [] };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "comments-" + (E.doc.code || E.doc.id || "course") + ".json"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    // ===== Live-collaboration chrome (platform-pivot ticket 11; SERVER-MODE ONLY) =========
    // Presence avatars (this increment) + remote cursors + held-block read-only chrome (11b).
    // ONE controller, INERT unless VersoSync.isCollaborating(): every render path hangs off that
    // single gate, so standalone/solo shows NO presence chrome and takes exactly today's branches.
    // Reuses colourForName (the comment-review palette -> one colour per person everywhere). Nothing
    // here touches render()/course.css -- editor chrome only.
    //
    // PURE model (headless-tested; no DOM, no network): the peers list -> the avatar cluster to draw
    // (editing vs viewing, deterministic initials, "+N" overflow past `max`). The server's
    // presence.state peer carries {name/author, colour, viewingBlockId, editingBlockId, cursor}.
    /* @presence-model-start */
    function presenceInitials(name) {
      var parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return "?";
      return ((parts[0][0] || "?") + (parts.length > 1 ? (parts[parts.length - 1][0] || "") : "")).toUpperCase();
    }
    function presenceModel(peers, max) {
      max = max || 4;
      var list = (peers || []).map(function (p) {
        var nm = p.name || p.author || "?";
        return { name: nm, initials: presenceInitials(nm), colour: p.colour || null,
          editing: p.state === "editing" || !!p.editingBlockId,
          blockId: p.editingBlockId || p.viewingBlockId || p.blockId || null };
      });
      return { shown: list.slice(0, max), overflow: Math.max(0, list.length - max), total: list.length };
    }
    // ticket 11b: locate a top-level block's page/index by stable id (the remote block.change
    // target). Pure; returns {pi, bi} or null. The server's block.change is keyed by stable id.
    function findBlockLocation(pages, id) {
      for (var p = 0; p < (pages || []).length; p++) {
        var bs = (pages[p] && pages[p].blocks) || [];
        for (var b = 0; b < bs.length; b++) if (bs[b] && bs[b].id === id) return { pi: p, bi: b };
      }
      return null;
    }
    // ticket 11b: which locks earn read-only chrome -- CONTENT locks held by SOMEONE ELSE (never my
    // own; structure locks are momentary and not shown). Pure; -> [{blockId, holder}].
    function peerHeldBlocks(locks, meName) {
      return (locks || []).filter(function (lk) {
        var cls = lk.class || lk.klass || "content";
        var who = lk.author || lk.holder;
        return cls === "content" && !!(lk.resourceId || lk.blockId) && !!who && who !== meName;
      }).map(function (lk) { return { blockId: lk.resourceId || lk.blockId, holder: lk.author || lk.holder }; });
    }
    // ticket 13-UI: the soft-conflict prompt rows. Joins VersoSync.conflictView() (WHICH block +
    // MY buffered edit) with the server's CURRENT block from the reduced doc, so the modal can show
    // "my edits vs current/restored" side by side. Pure; never drops a conflict (a row with no
    // server block still surfaces). -> [{blockId, mine, theirs, hasMine, serverSeq}].
    function conflictRows(view, d) {
      var pages = (d && d.pages) || [];
      return (view || []).map(function (c) {
        var loc = findBlockLocation(pages, c.blockId);
        var theirs = loc ? pages[loc.pi].blocks[loc.bi] : null;
        return { blockId: c.blockId, mine: c.mine || null, theirs: theirs, hasMine: !!c.hasMine, serverSeq: c.serverSeq };
      });
    }
    // ticket 13-UI: a compact text preview of a block for the two conflict panes (headline text /
    // body / first string field). Pure; falls back to a short JSON snippet so nothing renders blank.
    function blockPreview(b) {
      if (!b) return "(deleted)";
      var f = b.text || b.body || b.html || b.title || b.caption;
      if (typeof f === "string") return f.replace(/<[^>]+>/g, "").trim() || "(empty)";
      try { var s = JSON.stringify(b); return s.length > 160 ? s.slice(0, 157) + "…" : s; } catch (e) { return "(block)"; }
    }
    // ticket 11 (RemoteCaret): which peers show a live cursor/gaze flag on a block -- those VIEWING a
    // block (an EDITING peer already shows via the held-block chip, so skip them to avoid doubling).
    // Never me. Pure; -> [{blockId, name, colour}].
    function viewerCursors(peers, meName) {
      return (peers || []).filter(function (p) {
        var nm = p.name || p.author;
        return !!nm && nm !== meName && !p.editingBlockId && !!p.viewingBlockId;
      }).map(function (p) {
        var cur = p.cursor || null;
        var offset = cur ? (cur.offset != null ? cur.offset : (cur.selection && cur.selection.offset)) : null;
        return { blockId: p.viewingBlockId, name: p.name || p.author, colour: p.colour || null, offset: (typeof offset === "number" ? offset : null) };
      });
    }
    /* @presence-model-end */

    var CollabChrome = (function () {
      var wired = false, session = null, peers = [], locks = [], pending = [];
      var resolvedConflicts = [], notifyArmed = {};
      // send-side (drives the pipe from the local author's edit lifecycle); all no-op in standalone.
      var HEARTBEAT_MS = 12000, EDIT_DEBOUNCE_MS = 400, CURSOR_THROTTLE_MS = 120, IDLE_RELEASE_MS = 30000;
      var editingBlockId = null, viewingBlockId = null, beatTimer = null, editTimer = null, pendingBlock = null;
      var caretPending = false, lastCaret = null, idleTimer = null;
      function enabled() { return !!(window.VersoSync && window.VersoSync.enabled); }
      function live() { return !!(window.VersoSync && window.VersoSync.isCollaborating()); }
      // find a top-level canvas block by its stable id (data-id), escaping the selector. Shared by
      // the lock chrome + the remote cursors (both address blocks by the same stable id).
      function blockElById(id) {
        var esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
        return canvas.querySelector('.canvas-block[data-id="' + esc + '"]');
      }

      function clusterEl() {
        var host = document.querySelector(".toolbar__group--right");
        if (!host) return null;
        var el = host.querySelector(".collab-presence");
        if (!el) { el = h("div", "collab-presence"); host.insertBefore(el, host.firstChild); }
        return el;
      }
      // ticket 11: the presence avatar cluster (avatars of who is here, editing vs viewing).
      function renderPresence() {
        var el = clusterEl(); if (!el) return;
        if (!live() || !peers.length) { el.innerHTML = ""; el.style.display = "none"; return; }
        el.style.display = "";
        el.innerHTML = "";
        var m = presenceModel(peers, 4);
        m.shown.forEach(function (p) {
          var av = h("div", "collab-av" + (p.editing ? " is-editing" : " is-viewing"));
          av.style.setProperty("--acol", p.colour || "#888");
          av.setAttribute("title", p.name + (p.editing ? " — editing" : " — viewing"));
          av.textContent = p.initials;
          el.appendChild(av);
        });
        if (m.overflow) { var more = h("div", "collab-av collab-av--more"); more.textContent = "+" + m.overflow; el.appendChild(more); }
      }
      // ticket 11b: a fanned-out remote block.change -> patch the ONE changed block on the live
      // canvas by stable id. Caret-safe: while the local author is typing, DEFER (queue) and flush
      // on the next blur, so a peer's edit never yanks a caret. (Block-locking already prevents a
      // peer editing the block I hold, so the deferred window only affects my own in-flight typing.)
      function applyRemote(env) {
        if (!env || env.type !== "block.change" || !env.blockId) return;
        var patch = env.payload && env.payload.patch;
        if (typeof patch === "string") { try { patch = JSON.parse(patch); } catch (e) { return; } }
        if (!patch) return;
        if (typeof isTextTarget === "function" && isTextTarget(document.activeElement)) { pending.push(env); return; }
        var loc = findBlockLocation((E.doc && E.doc.pages) || [], env.blockId);
        if (!loc) return;
        E.doc.pages[loc.pi].blocks[loc.bi] = patch;
        try { reapplyStructural(loc.pi); } catch (e) { try { mount(); } catch (e2) {} } // re-render just that page (mount() if previewing)
        // a remote block.change swaps the block OBJECT -> if the tour builder is open on that same
        // block, its captured reference just went stale; re-bind it to the live doc (same guard as undo/setDoc).
        try { rebindTourBuilderToLiveDoc(); } catch (e) {}
        reproject();
      }
      function flushPending() {
        if (!pending.length) return;
        var q = pending; pending = [];
        q.forEach(applyRemote);
      }
      // ticket 11b: held-block read-only chrome. A block a PEER holds a content lock on gets an
      // author-colour inset outline + an "editing…" holder chip and goes contenteditable=false
      // (the visible face of ticket 15's read-only gate). My own locks show no chrome.
      function renderLocks() {
        Array.prototype.forEach.call(canvas.querySelectorAll(".collab-held"), function (el) {
          el.classList.remove("collab-held"); el.style.removeProperty("--hcol"); el.removeAttribute("data-collab-holder");
          el.removeAttribute("aria-readonly");
          var c = el.querySelector(".collab-held__chip"); if (c) c.remove();
        });
        if (!live()) return;
        var me = commentIdentity().name;
        peerHeldBlocks(locks, me).forEach(function (hb) {
          var el = blockElById(hb.blockId);
          if (!el) return;
          var colour = colourForName(hb.holder);
          el.classList.add("collab-held"); el.style.setProperty("--hcol", colour);
          el.setAttribute("data-collab-holder", hb.holder); el.setAttribute("aria-readonly", "true");
          var chip = h("div", "collab-held__chip"); chip.style.setProperty("--hcol", colour);
          var av = h("span", "collab-held__av"); av.textContent = presenceInitials(hb.holder); chip.appendChild(av);
          chip.appendChild(h("span", "collab-held__lbl", hb.holder + " editing…"));
          chip.setAttribute("role", "button"); chip.setAttribute("title", "Ask " + hb.holder + " for this block");
          chip.onclick = function (e) { e.stopPropagation(); openHeldMenu(e, hb); };
          el.appendChild(chip);
        });
      }
      // ticket 13-UI: the human path out of a stuck lock -- a ContextMenu off the held-block chip.
      // Request handoff nudges the holder; notify-when-free arms a ping on release. Both go over the
      // presence channel (server relays them). Light-dismiss (click-out / Escape).
      function closeHeldMenu() { var m = document.querySelector(".collab-menu"); if (m) m.remove(); }
      function openHeldMenu(e, hb) {
        closeHeldMenu();
        var armed = !!notifyArmed[hb.blockId];
        var menu = h("div", "collab-menu");
        var bh = h("button", "collab-menu__item", "Request handoff");
        bh.onclick = function (ev) { ev.stopPropagation(); closeHeldMenu(); if (session && session.requestHandoff) session.requestHandoff(hb.blockId); toast(hb.holder + " nudged for this block"); };
        var bn = h("button", "collab-menu__item" + (armed ? " is-armed" : ""), armed ? "Notifying when free" : "Notify me when free");
        bn.onclick = function (ev) { ev.stopPropagation(); closeHeldMenu(); notifyArmed[hb.blockId] = !armed; if (session && session.notifyWhenFree) session.notifyWhenFree(hb.blockId, !armed); toast(!armed ? "You’ll be told when this block frees" : "Notify-when-free off"); };
        menu.appendChild(bh); menu.appendChild(bn);
        document.body.appendChild(menu);
        var r = e.currentTarget.getBoundingClientRect();
        var MENU_W = 200; // the menu's min-width (190) + a small viewport margin; keep it on-screen
        menu.style.left = Math.min(r.left, window.innerWidth - MENU_W) + "px";
        menu.style.top = (r.bottom + 6) + "px";
      }
      // a tiny transient toast (reused for handoff/notify confirmation; light, non-blocking)
      function toast(msg) {
        var t = h("div", "collab-toast", msg); document.body.appendChild(t);
        requestAnimationFrame(function () { t.classList.add("is-on"); });
        setTimeout(function () { t.classList.remove("is-on"); setTimeout(function () { if (t.parentNode) t.remove(); }, 220); }, 3000);
      }
      // ---- ticket 13-UI: the soft-conflict prompt (reconnect-collision + restore-collision) ----
      // Driven by VersoSync.conflictView() joined with the current doc. Two panes -- my buffered
      // edits vs the current/restored block -- and a deliberate Keep mine / Use theirs. NEVER auto-
      // dismisses and NEVER silently drops. `variant` = "server" (reconnect) | "restored" (restore).
      function showConflicts(variant) {
        if (!live() || !window.VersoSync || !window.VersoSync.conflictView) return;
        var rows = conflictRows(window.VersoSync.conflictView(), window.VersoSync._state ? window.VersoSync._state().doc : (E.doc || null))
          .filter(function (r) { return resolvedConflicts.indexOf(r.blockId) === -1; });
        if (!rows.length) { closeConflict(); return; }
        var r = rows[0]; // resolve one block at a time; the modal reopens for the next
        var theirsLabel = variant === "restored" ? "Restored version" : "Current on server";
        var desc = variant === "restored"
          ? "An admin restored this course while you had unsaved edits."
          : "This block moved on while you were disconnected.";
        closeConflict();
        var scrim = h("div", "collab-scrim"); scrim.setAttribute("data-collab-conflict", "1");
        var modal = h("div", "collab-modal");
        modal.appendChild(h("div", "collab-modal__title", "Resolve your unsaved edits"));
        modal.appendChild(h("div", "collab-modal__desc", desc + " Nothing is lost — choose which to keep. (" + rows.length + " to resolve)"));
        var panes = h("div", "collab-panes");
        var pMine = h("div", "collab-pane is-mine"); pMine.appendChild(h("div", "collab-pane__h", "Your edits")); pMine.appendChild(h("div", "collab-pane__b", blockPreview(r.mine)));
        var pTheirs = h("div", "collab-pane"); pTheirs.appendChild(h("div", "collab-pane__h", theirsLabel)); pTheirs.appendChild(h("div", "collab-pane__b", blockPreview(r.theirs)));
        panes.appendChild(pMine); panes.appendChild(pTheirs);
        modal.appendChild(panes);
        var foot = h("div", "collab-modal__foot");
        var useTheirs = h("button", "collab-btn", "Use " + (variant === "restored" ? "restored" : "theirs"));
        var keepMine = h("button", "collab-btn is-primary", "Keep mine");
        useTheirs.onclick = function () { resolveConflict(r, "theirs", variant); };
        keepMine.onclick = function () { resolveConflict(r, "mine", variant); };
        foot.appendChild(useTheirs); foot.appendChild(keepMine);
        modal.appendChild(foot);
        scrim.appendChild(modal); document.body.appendChild(scrim);
      }
      function closeConflict() {
        var s = document.querySelector(".collab-scrim[data-collab-conflict]"); if (s) s.remove();
      }
      function resolveConflict(r, which, variant) {
        resolvedConflicts.push(r.blockId);
        try {
          if (which === "mine" && r.hasMine && session && session.sendChange) {
            session.sendChange(r.blockId, r.mine, r.serverSeq); // re-assert my edit on top of the new server seq
          } else if (which === "theirs") {
            if (window.VersoSync && window.VersoSync._buffer) window.VersoSync._buffer.ack(r.blockId); // drop my buffered edit
            if (r.theirs) applyRemote({ type: "block.change", blockId: r.blockId, payload: { patch: r.theirs } });
          }
        } catch (e) {}
        showConflicts(variant); // reopen for the next unresolved block, or close when none remain
      }

      // ticket 11 (RemoteCaret): a live cursor/gaze flag for each VIEWING peer, anchored to the block
      // they're looking at (so it tracks pan/zoom with the block, like the held chip). Author-colour,
      // ephemeral, pointer-events:none -- it can never intercept a click. Editors show via the chip.
      function renderCursors() {
        Array.prototype.forEach.call(canvas.querySelectorAll(".collab-cursor"), function (n) { n.remove(); });
        if (!live()) return;
        var me = commentIdentity().name;
        viewerCursors(peers, me).forEach(function (vc) {
          var el = blockElById(vc.blockId);
          if (!el) return;
          var colour = vc.colour || colourForName(vc.name);
          var caret = h("div", "collab-cursor"); caret.style.setProperty("--ccol", colour);
          caret.appendChild(h("span", "collab-cursor__flag", vc.name));
          positionCaret(caret, el, vc.offset); // ticket 11 AC2: place it at the offset WITHIN the block (corner fallback)
          el.appendChild(caret);
        });
      }
      // place a remote caret at a character offset inside a block's editable field. Best-effort +
      // guarded: on any failure it leaves the CSS default (a block-corner flag), never throws.
      function positionCaret(caret, blockEl, offset) {
        if (offset == null) return;
        try {
          var field = blockEl.querySelector("[data-edit]") || blockEl;
          var remaining = offset, node, rect = null;
          var walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT, null, false);
          while ((node = walker.nextNode())) {
            var len = node.nodeValue.length;
            if (remaining <= len) {
              var r = document.createRange(); r.setStart(node, remaining); r.collapse(true);
              rect = (r.getClientRects()[0]) || r.getBoundingClientRect(); break;
            }
            remaining -= len;
          }
          if (!rect) return;
          var br = blockEl.getBoundingClientRect();
          caret.style.top = (rect.top - br.top) + "px";
          caret.style.left = (rect.left - br.left) + "px";
          if (rect.height) caret.style.height = rect.height + "px";
        } catch (e) {}
      }
      // ticket 11 AC2: share the local caret with peers (throttled -> one send per window, latest wins).
      function onCaret(block, offset) {
        if (!live() || !block || !block.id || !session || !session.cursorUpdate || typeof offset !== "number") return;
        touchIdle(); // caret movement is activity -> keep the lock alive
        lastCaret = { blockId: block.id, offset: offset };
        if (caretPending) return;
        caretPending = true;
        setTimeout(function () {
          caretPending = false;
          if (lastCaret && live() && session && session.cursorUpdate) session.cursorUpdate(lastCaret.blockId, { offset: lastCaret.offset });
        }, CURSOR_THROTTLE_MS);
      }
      // ---- send-side: drive the pipe from the local author's edit lifecycle (tickets 11 + 13) ----
      // Nothing here runs in standalone (every method gates on live()+session). edit-intent (focus)
      // implicitly acquires the block's content lock + heartbeats; edit-commit fans the block out
      // (debounced, and recorded in the durable unacked buffer); blur/idle releases the lock.
      function beat() { if (live() && session && session.heartbeat) session.heartbeat(viewingBlockId, editingBlockId); }
      // spec story 9: auto-release a held block on IDLE (blur is handled in onEditBlur; this closes the
      // "focused but idle" gap so a walked-away author doesn't hold the lock indefinitely). Reset on any
      // edit/caret activity. In an autosave app there is no manual "save" trigger -- blur + idle cover it.
      function touchIdle() {
        if (!live()) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
          idleTimer = null;
          if (live() && session && session.releaseLock && editingBlockId) { session.releaseLock(editingBlockId); editingBlockId = null; beat(); }
        }, IDLE_RELEASE_MS);
      }
      function onEditFocus(block) {
        if (!live() || !block || !block.id || !session) return;
        viewingBlockId = editingBlockId = block.id;
        if (session.acquireLock) session.acquireLock(block.id); // implicit acquire on edit-intent (spec stories 8-9)
        beat(); touchIdle();
      }
      function onEditCommit(block) {
        if (!live() || !block || !block.id) return;
        editingBlockId = viewingBlockId = block.id; // (re)engage on edit activity (e.g. typing after an idle release)
        touchIdle();
        pendingBlock = block; // coalesce rapid keystrokes; the server coalesces again downstream
        if (editTimer) clearTimeout(editTimer);
        editTimer = setTimeout(flushEdit, EDIT_DEBOUNCE_MS);
      }
      function flushEdit() {
        editTimer = null;
        if (!live() || !pendingBlock || !session || !session.sendChange) { pendingBlock = null; return; }
        var b = pendingBlock; pendingBlock = null;
        var content; try { content = JSON.parse(JSON.stringify(b)); } catch (e) { return; } // plain, serialisable
        var baseSeq = (window.VersoSync && window.VersoSync._state) ? window.VersoSync._state().seq : 0;
        session.sendChange(b.id, content, baseSeq); // fans out + records in the durable unacked buffer
      }
      function onEditBlur(block) {
        if (!live() || !block || !block.id) return;
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } // blur supersedes the idle timer
        if (editTimer) { clearTimeout(editTimer); flushEdit(); } // commit any pending edit before releasing
        if (session && session.releaseLock) session.releaseLock(block.id); // auto-release on blur (spec story 9)
        if (editingBlockId === block.id) editingBlockId = null;
        beat();
      }
      // ticket 26: fan an author's reply/resolve back to the reviewer + peers (shared BOTH ways --
      // spec 4 stories 12/23). A reply is comment.add on the parent thread; the hub echoes it to the
      // origin, so ingestComment adds it locally (send-only avoids a duplicate). Translate the client
      // cid anchor -> the server stable block id. Returns true when it fanned out (server mode).
      function fanoutReply(comment, body) {
        if (!live() || !session || !session.comment || !comment) return false;
        var cid = comment.anchor && comment.anchor.blockId;
        session.comment(blockIdByCid(E.doc, cid) || cid, body, comment.threadId || comment.id);
        return true;
      }
      function fanoutResolve(comment, resolved) {
        if (!live() || !session || !session.resolveComment || !comment) return false;
        var cid = comment.anchor && comment.anchor.blockId;
        session.resolveComment(blockIdByCid(E.doc, cid) || cid, comment.threadId || comment.id, resolved);
        return true;
      }

      function onEvent(env, state) {
        if (!env) return;
        if (env.type === "presence.state") { peers = (state && state.peers) || []; reproject(); }
        else if (env.type === "lock.state") { locks = (state && state.locks) || []; reproject(); }
        else if (env.type === "block.change") { applyRemote(env); }
        else if (env.type === "block.conflict") { showConflicts("server"); }           // reconnect-collision
        else if (env.type === "sync.resnapshot") {                                       // restore-collision if I had unacked edits
          if (window.VersoSync && window.VersoSync._buffer && window.VersoSync._buffer.pending().length) showConflicts("restored");
        }
        else if (env.type === "comment.added") { ingestComment(env); }    // ticket 26: guest/author comment round-trip
        else if (env.type === "comment.resolved") { resolveThread(env); }
      }
      function afterCommentChange() { try { renderCommentPins(); if (typeof refreshCommentPanel === "function") refreshCommentPanel(); } catch (e) {} }
      // ticket 26: a comment fanned out over the sync channel (a guest reviewer's note, or another
      // author's) is mapped from the server envelope into a client comment (anchored by CID, so the
      // SHIPPED pins/panel resolve it) and upserted into doc.comments -- a delta, not a parallel comment
      // system. A reply (threadId != id) attaches to its parent's replies; else it's a top-level note.
      function ingestComment(env) {
        var c = commentFromEnv(env, E.doc, colourForName); if (!c) return;
        E.doc.comments = E.doc.comments || [];
        if (c.threadId && c.threadId !== c.id) {
          var parent = null;
          for (var j = 0; j < E.doc.comments.length; j++) if (E.doc.comments[j].id === c.threadId) { parent = E.doc.comments[j]; break; }
          if (parent) {
            var replies = parent.replies = parent.replies || [];
            // Reconcile the ORIGIN echo of my own optimistic reply. A local optimistic reply carries an
            // "rp_" id (makeReply); the server mints a fresh "cm_" id + resolves the author server-side.
            // So match my unconfirmed reply by body + the rp_ marker (NOT by author, which can differ)
            // and adopt the server id -- never a duplicate, and never collapsing two people's replies
            // (theirs arrive with cm_ ids, so they only match by exact id).
            var slot = null;
            for (var q = 0; q < replies.length; q++) {
              if (replies[q].id === c.id) { slot = replies[q]; break; } // exact echo already present
              if (slot == null && String(replies[q].id).indexOf("rp_") === 0 && replies[q].body === c.body) slot = replies[q];
            }
            if (slot) { slot.id = c.id; } // adopt the server id (reconcile the optimistic reply)
            else replies.push({ id: c.id, body: c.body, author: c.author, colour: c.colour, createdAt: c.createdAt });
            afterCommentChange(); return;
          }
        }
        var i = -1; for (var k = 0; k < E.doc.comments.length; k++) if (E.doc.comments[k].id === c.id) { i = k; break; }
        if (i >= 0) E.doc.comments[i] = c; else E.doc.comments.push(c);
        afterCommentChange();
      }
      // ticket 26: an author reply/resolve (or a guest's) marks the whole thread done, both ways.
      function resolveThread(env) {
        var p = (env && env.payload) || {};
        var threadId = p.threadId; if (!threadId) return;
        var resolved = p.resolved !== false;
        (E.doc.comments || []).forEach(function (c) { if (c.id === threadId || c.threadId === threadId) c.done = resolved; });
        afterCommentChange();
      }
      // Idempotent: subscribe + connect once, only in server mode. No-op in standalone.
      function ensure() {
        if (wired || !enabled()) return;
        wired = true;
        try {
          window.VersoSync.onEvent(onEvent);
          document.addEventListener("blur", flushPending, true); // flush deferred remote edits when a field loses focus
          // light-dismiss for the handoff menu (NOT the conflict modal). Wired here (server mode only)
          // -- the menu can only open while collaborating, so it never needs these in standalone.
          document.addEventListener("click", closeHeldMenu);
          document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeHeldMenu(); });
          beatTimer = setInterval(beat, HEARTBEAT_MS); // ticket 11 AC4: heartbeat drives presence TTL
          session = window.VersoSync.connect(E.activeDocId);
        } catch (e) {}
      }
      // Re-draw the collab overlays after a mount() (canvas.innerHTML was cleared). Cheap + gated.
      function reproject() { try { renderPresence(); renderLocks(); renderCursors(); } catch (e) {} }
      return { ensure: ensure, reproject: reproject, live: live, _model: presenceModel,
        // send-side (called from the editor's edit lifecycle)
        onEditFocus: onEditFocus, onEditCommit: onEditCommit, onEditBlur: onEditBlur, onCaret: onCaret,
        fanoutReply: fanoutReply, fanoutResolve: fanoutResolve,
        _peers: function (p) { peers = p || []; }, _locks: function (l) { locks = l || []; },
        _applyRemote: applyRemote, _flush: flushPending, _pending: function () { return pending.slice(); },
        _showConflicts: showConflicts, _openHeldMenu: openHeldMenu, _resolved: function () { return resolvedConflicts.slice(); },
        _ingestComment: ingestComment, _resolveThread: resolveThread,
        _beat: beat, _editing: function () { return editingBlockId; }, _setSession: function (s) { session = s; },
        _session: function () { return session; } };
    })();
    window.__CollabChrome = CollabChrome;

    function mergeComments(incoming) {
      E.doc.comments = E.doc.comments || [];
      var byId = {}; E.doc.comments.forEach(function (c) { byId[c.id] = c; });
      var added = 0, updated = 0;
      (incoming || []).forEach(function (inc) {
        if (!inc || !inc.id) return;
        var ex = byId[inc.id];
        if (!ex) { E.doc.comments.push(inc); byId[inc.id] = inc; added++; return; }
        var have = {}; (ex.replies || []).forEach(function (r) { if (r && r.id) have[r.id] = 1; });
        (inc.replies || []).forEach(function (r) { if (r && r.id && !have[r.id]) { ex.replies = ex.replies || []; ex.replies.push(r); have[r.id] = 1; updated++; } });
        if (inc.done && !ex.done) { ex.done = true; updated++; } // resolve wins (someone closed it)
      });
      return { added: added, updated: updated };
    }
    window.__mergeComments = mergeComments; // test hook (Viewer round-trip)
    function importComments() {
      var input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
      input.addEventListener("change", function () {
        var file = input.files && input.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = JSON.parse(reader.result);
            var list = Array.isArray(parsed) ? parsed : (parsed && parsed.comments);
            if (!Array.isArray(list)) { alert("Not a Verso comments file (expected a comments array)."); return; }
            pushHistory();
            var r = mergeComments(list);
            scheduleSave(); renderCommentPins(); refreshCommentPanel();
            alert("Merged comments: " + r.added + " new, " + r.updated + " updated.");
          } catch (e) { alert("Invalid comments JSON: " + e.message); }
        };
        reader.readAsText(file);
      });
      input.click();
    }
    // Pan (keep zoom) so the comment's pin lands at the canvas centre, then open it.
    function jumpToComment(c) {
      var pos = anchorToScreen(c.anchor);
      if (pos) {
        var cr = canvas.getBoundingClientRect();
        view.x += (cr.width / 2 - pos.px); view.y += (cr.height / 2 - pos.py);
        applyView();
      }
      openCommentPopover(c);
    }
    if (commentBtn) commentBtn.addEventListener("click", function () { setCommentMode(!commentMode); });
    var gridBtn = document.getElementById("grid-toggle");
    if (gridBtn) gridBtn.addEventListener("click", cycleGrid);
    updateGridBtn(); // reflect the persisted mode on boot (overlay itself is seeded by the mount loop)
    var styleAuditBtn = document.getElementById("style-audit-toggle");
    if (styleAuditBtn) styleAuditBtn.addEventListener("click", toggleStyleAudit);
    updateStyleAuditBtn(); // reflect the persisted audit state on boot

    // Resolve a click to the MOST SPECIFIC anchor: block (cid + normalised offset) >
    // page (pageId + normalised) > world (absolute infinite-canvas coords).
    function makeAnchorFromPoint(clientX, clientY, target) {
      var s = activeSurf();
      var blockEl = target && target.closest ? target.closest(".canvas-block[data-cid]") : null;
      if (blockEl && s.root && s.root.contains(blockEl)) {
        var r = blockEl.getBoundingClientRect();
        return { blockId: blockEl.getAttribute("data-cid"),
          dx: clamp01((clientX - r.left) / (r.width || 1)), dy: clamp01((clientY - r.top) / (r.height || 1)) };
      }
      var pageEl = target && target.closest ? target.closest(".page[data-page-id]") : null;
      if (pageEl) {
        var pr = pageEl.getBoundingClientRect();
        return { pageId: pageEl.getAttribute("data-page-id"),
          x: clamp01((clientX - pr.left) / (pr.width || 1)), y: clamp01((clientY - pr.top) / (pr.height || 1)) };
      }
      // world/general = canvas-only; in the preview a drop outside a page is ignored.
      if (!s.allowWorld) return null;
      var cr = canvas.getBoundingClientRect();
      return { worldX: (clientX - cr.left - view.x) / view.zoom, worldY: (clientY - cr.top - view.y) / view.zoom };
    }
    // Anchor -> canvas-relative screen px for THIS view (null if the anchored block/
    // page isn't in the current DOM — e.g. a variant preview drops the block).
    // #181: pins anchor to a block/page node's live getBoundingClientRect(). #150 put
    // content-visibility:auto on offscreen frames ('frame--cull'), which SKIPS layout of
    // the frame's subtree while scrolled away -> a descendant .page / .canvas-block rect
    // collapses to the reserved-box origin and the pin re-projects to the wrong place or
    // page. Force the culled ancestor frame to render for the duration of the measure, then
    // restore, so the rect is always the node's real position regardless of cull state.
    function rectUnculled(n) {
      var culled = n.closest ? n.closest(".frame--cull") : null;
      if (!culled) return n.getBoundingClientRect();
      var prev = culled.style.contentVisibility;
      culled.style.contentVisibility = "visible";
      var r = n.getBoundingClientRect();
      culled.style.contentVisibility = prev;
      return r;
    }
    // ---- #197 proximity capture: resolve a pin point -> nearby blocks --------
    // The tooling needs to know WHERE a pin lives without the author spelling it out. A pin
    // dropped BESIDE a block (a non-expert drop) must still capture it — so this is proximity, not a
    // single direct hit. Pure + identifier-agnostic: items carry { cid, blockId, pageId, rect }; the
    // DOM reader below feeds real canvas rects. Distance is point-to-rect (0 when the point is inside),
    // results are nearest-first, filtered to `radius` px. Fed to the Course index (#137) via block ids
    // downstream; cid is always present, blockId only when render stamped one (block.id is lazy).
    function rectPointDistance(r, p) {
      var dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width));
      var dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height));
      return Math.sqrt(dx * dx + dy * dy);
    }
    function resolveProximity(items, point, radius) {
      radius = (radius == null) ? 0 : radius;
      return (items || [])
        .filter(function (it) { return it && it.rect; })
        .map(function (it) { return { cid: it.cid, blockId: it.blockId, pageId: it.pageId, d: rectPointDistance(it.rect, point) }; })
        .filter(function (h) { return h.d <= radius; })
        .sort(function (a, b) { return a.d - b.d; });
    }
    window.__resolveProximity = resolveProximity; // pure, test hook
    // DOM reader (wiring): collect the active surface's block boxes and resolve a client point to the
    // nearby blocks + the page the pin sits in. Default radius ~120px = "beside". pageId falls back to
    // the page directly under the point when no block is near, so a pin in whitespace still routes.
    function resolvePinContext(clientX, clientY, radius) {
      var s = activeSurf();
      if (!s || !s.root) return { pageId: null, blockIds: [], cids: [] };
      var items = [];
      var nodes = s.root.querySelectorAll(".canvas-block[data-cid]");
      Array.prototype.forEach.call(nodes, function (n) {
        var pageEl = n.closest ? n.closest(".page[data-page-id]") : null;
        var r = rectUnculled(n);
        items.push({ cid: n.getAttribute("data-cid"), blockId: n.getAttribute("data-id") || null,
          pageId: pageEl ? pageEl.getAttribute("data-page-id") : null,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
      });
      var hits = resolveProximity(items, { x: clientX, y: clientY }, radius == null ? 120 : radius);
      var pageId = hits.length ? hits[0].pageId : null;
      if (!pageId) {
        var pe = document.elementFromPoint(clientX, clientY);
        pe = (pe && pe.closest) ? pe.closest(".page[data-page-id]") : null;
        if (pe) pageId = pe.getAttribute("data-page-id");
      }
      return { pageId: pageId,
        blockIds: hits.map(function (h) { return h.blockId; }).filter(Boolean),
        cids: hits.map(function (h) { return h.cid; }).filter(Boolean) };
    }
    window.__resolvePinContext = resolvePinContext;
    function anchorToScreen(a) {
      if (!a) return null;
      var s = activeSurf();
      if (!s.root) return null;
      var cr = s.rect();
      if (a.blockId) {
        var n = s.root.querySelector('.canvas-block[data-cid="' + a.blockId + '"]');
        if (!n) return null;
        var r = rectUnculled(n);
        return { px: r.left - cr.left + (a.dx || 0) * r.width, py: r.top - cr.top + (a.dy || 0) * r.height };
      }
      if (a.pageId) {
        var pe = s.root.querySelector('.page[data-page-id="' + a.pageId + '"]');
        if (!pe) return null;
        var pr = rectUnculled(pe);
        return { px: pr.left - cr.left + (a.x || 0) * pr.width, py: pr.top - cr.top + (a.y || 0) * pr.height };
      }
      if (a.worldX != null) return s.allowWorld ? s.worldToPx(a) : null; // world pins don't exist in preview
      return null;
    }
    // Place the note popover next to its pin but CLAMPED into the surface viewport so
    // an edge-of-canvas drop never leaves the note off-screen (#212). Default is to the
    // right of the pin (pos.px + 16); if that overflows the right edge it flips to the
    // left, and the top is lifted so the bottom fits. Without this, focus({preventScroll})
    // keeps the canvas still but the note renders past the fold and looks like nothing
    // was placed. Must be called AFTER the popover is in the DOM (needs its measured size).
    // Pure clamp math (regression-guarded in tests/run.js): given the pin position, the
    // surface viewport size and the popover size, return the clamped {left, top}. A zero
    // viewport dimension (host not laid out) disables clamping on that axis.
    function clampPopover(pos, vw, vh, pw, ph, m) {
      var left = pos.px + 16;
      if (vw) {
        if (left + pw > vw - m) left = pos.px - pw - 16;          // flip to the left of the pin
        if (left < m) left = m;
        if (left + pw > vw - m) left = Math.max(m, vw - pw - m);  // still too wide -> pin to edge
      }
      var top = pos.py;
      if (vh) {
        if (top + ph > vh - m) top = Math.max(m, vh - ph - m);    // lift so the bottom fits
        if (top < m) top = m;
      }
      return { left: left, top: top };
    }
    function placePopover(pop, pos) {
      var host = activeSurf().layerParent;
      var vw = host ? host.clientWidth : 0, vh = host ? host.clientHeight : 0;
      var xy = clampPopover(pos, vw, vh, pop.offsetWidth || 240, pop.offsetHeight || 0, 8);
      pop.style.left = xy.left + "px"; pop.style.top = xy.top + "px";
    }
    // uio-E-M06: the Comments tab's open-count badge follows the pins -- every path that changes
    // a comment already re-renders them (mount, doc switch, add/resolve/delete/import). This runs
    // per pan/zoom frame too, so it only calls the tab sync when the count actually moved.
    var __lastBadgeCount = -1;
    function syncCommentsBadge() {
      var openN = ((E.doc && E.doc.comments) || []).filter(function (c) { return !c.done; }).length;
      if (openN !== __lastBadgeCount) { __lastBadgeCount = openN; E.syncRightTabs(); }
    }
    // Re-project + redraw every pin. Pins are ALWAYS shown (Design mode too), so this
    // runs from mount() + applyView() (pan/zoom) as well as on any comment change.
    function renderCommentPins() {
      syncCommentsBadge();
      var s = activeSurf();
      if (!s.layerParent) return;
      // Fast path (#150): applyView() calls this on EVERY pan/zoom frame. When the course
      // has no comments there is nothing to project -- skip the layer attach + full pin
      // rebuild entirely (a big chunk of the pan/zoom cost on comment-free courses). Still
      // strip any stale pins if a layer already exists (e.g. the last comment was deleted).
      if (!(E.doc.comments && E.doc.comments.length)) {
        var lyr = (s.name === "demo") ? demoPinLayer : commentPinLayer;
        if (lyr) Array.prototype.forEach.call(lyr.querySelectorAll(".comment-pin"), function (n) { n.remove(); });
        return;
      }
      var layer = s.getLayer();
      if (layer.parentNode !== s.layerParent) s.layerParent.appendChild(layer);
      // The pin layer is `position:absolute; inset:0` INSIDE the layer parent. When that
      // parent is a scroll container -- native-scroll pan (#151) on the canvas, or the demo
      // preview's scrollable stage -- the layer scrolls WITH the content, but anchorToScreen
      // returns VIEWPORT-relative coords. Left uncompensated, every pin drifts up/left by the
      // scroll offset and clips out of view (#212 follow-up: pins never appeared once
      // native-scroll pan was enabled). Cancel the parent's scroll on the layer so its origin
      // stays glued to the viewport; a no-op (translate 0,0) in transform-pan mode.
      var _sx = s.layerParent.scrollLeft || 0, _sy = s.layerParent.scrollTop || 0;
      layer.style.transform = (_sx || _sy) ? ("translate(" + _sx + "px," + _sy + "px)") : "";
      layer.classList.toggle("is-mode", s.inMode());
      // preserve an open popover across a re-render
      var pop = layer.querySelector(".comment-popover");
      Array.prototype.forEach.call(layer.querySelectorAll(".comment-pin"), function (n) { n.remove(); });
      var commentPinLayer = layer; // local alias so the rest of the body is unchanged
      (E.doc.comments || []).forEach(function (c) {
        var pos = anchorToScreen(c.anchor);
        if (!pos) return;
        var pin = h("div", "comment-pin" + (c.done ? " is-done" : "") + (c.id === openCommentId ? " is-open" : ""));
        pin.style.left = pos.px + "px"; pin.style.top = pos.py + "px";
        if (c.colour && !c.done) pin.style.background = c.colour; // §12 slice 5: tint by author
        var nReplies = (c.replies || []).length;
        pin.title = (c.author ? c.author + ": " : "") + (c.body ? c.body.slice(0, 80) : "(empty note)") + (nReplies ? " (+" + nReplies + ")" : "");
        pin.textContent = c.done ? "✓" : "";
        pin.addEventListener("mousedown", function (e) { e.stopPropagation(); e.preventDefault(); openCommentPopover(c); });
        commentPinLayer.insertBefore(pin, pop || null);
      });
      if (pop) { // reposition the open popover to its pin
        var oc = (E.doc.comments || []).filter(function (c) { return c.id === openCommentId; })[0];
        var p2 = oc && anchorToScreen(oc.anchor);
        if (p2) { placePopover(pop, p2); } else closeCommentPopover();
      }
    }
    window.__renderCommentPins = renderCommentPins; // browser-test hook

    function closeCommentPopover() {
      // a popover may live in either surface's layer — clear both
      [commentPinLayer, demoPinLayer].forEach(function (l) { var p = l && l.querySelector(".comment-popover"); if (p) p.remove(); });
      // discard an empty note (a stray drop that was never written) — but keep it if
      // it has replies (§12 slice 5: a thread with no root body is still real).
      if (editingComment && !(editingComment.body || "").trim() && !(editingComment.replies || []).length && E.doc.comments) {
        var i = E.doc.comments.indexOf(editingComment);
        if (i !== -1) { E.doc.comments.splice(i, 1); scheduleSave(); }
      }
      editingComment = null;
      openCommentId = null;
      refreshCommentPanel(); // finalise the list snippet / drop the discarded row
    }
    function openCommentPopover(c) {
      closeCommentPopover();
      var UI = window.VersoUI; // DS canonical control set (re-skin, issue #17)
      var layer = activeSurf().getLayer();
      if (!layer.parentNode) renderCommentPins();
      openCommentId = c.id; editingComment = c;
      var pos = anchorToScreen(c.anchor); if (!pos) { renderCommentPins(); return; }
      var pop = h("div", "comment-popover");
      pop.style.left = (pos.px + 16) + "px"; pop.style.top = pos.py + "px";
      pop.addEventListener("mousedown", function (e) { e.stopPropagation(); }); // clicks inside stay inside
      var bodyField = UI.TextField({ multiline: true, rows: 3, value: c.body || "", placeholder: "Write a note…" });
      bodyField.classList.add("comment-popover__body");
      var ta = bodyField.input;
      var pushed = false;
      ta.addEventListener("input", function () {
        if (!pushed) { pushHistory(); pushed = true; }
        c.body = ta.value; scheduleSave(); refreshCommentPanel(); // live snippet (popover keeps focus — separate DOM)
      });
      ta.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ta.blur(); closeCommentPopover(); renderCommentPins(); } });
      var row = h("div", "comment-popover__row");
      var doneCheck = UI.Checkbox({ checked: !!c.done, label: "Resolved", onChange: function (v) { pushHistory(); c.done = v; if (typeof CollabChrome !== "undefined") CollabChrome.fanoutResolve(c, v); scheduleSave(); renderCommentPins(); refreshCommentPanel(); } });
      doneCheck.classList.add("comment-popover__done");
      var del = h("button", "comment-popover__del", "Delete");
      del.addEventListener("click", function () {
        pushHistory();
        var i = E.doc.comments.indexOf(c); if (i !== -1) E.doc.comments.splice(i, 1);
        editingComment = null; scheduleSave(); closeCommentPopover(); renderCommentPins();
      });
      row.appendChild(doneCheck); row.appendChild(del);
      // §12 slice 5: author label on the note
      if (c.author) { var au = h("div", "comment-popover__author"); var ad = h("span", "comment-row__dot"); ad.style.background = c.colour || ""; au.appendChild(ad); au.appendChild(document.createTextNode(c.author)); pop.appendChild(au); }
      pop.appendChild(bodyField); pop.appendChild(row);
      // §12 slice 5: threaded replies
      var thread = h("div", "comment-thread");
      (c.replies || []).forEach(function (rp) {
        var line = h("div", "comment-reply");
        var rd = h("span", "comment-row__dot"); rd.style.background = rp.colour || "";
        var rb = h("span", "comment-reply__body"); rb.textContent = (rp.author ? rp.author + ": " : "") + (rp.body || "");
        line.appendChild(rd); line.appendChild(rb); thread.appendChild(line);
      });
      var replyField = UI.TextField({ value: "", placeholder: "Reply…" });
      replyField.classList.add("comment-reply__input");
      replyField.input.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      var replyBtn = UI.Button({ variant: "secondary", full: true, label: "Reply", onClick: function () {
        var v = (replyField.input.value || "").trim(); if (!v) return;
        pushHistory(); c.replies = c.replies || []; c.replies.push(makeReply(v)); // optimistic local add (instant)
        if (typeof CollabChrome !== "undefined") CollabChrome.fanoutReply(c, v); // collab: fan out; the echo is deduped by content
        scheduleSave();
        openCommentPopover(c); renderCommentPins(); // rebuild the popover with the new reply
      } });
      thread.appendChild(replyField); thread.appendChild(replyBtn);
      pop.appendChild(thread);
      layer.appendChild(pop);
      placePopover(pop, pos); // clamp into the viewport now it is measurable (#212)
      renderCommentPins(); // reflect is-open on the pin
      // preventScroll: focusing an absolutely-positioned popover near the viewport
      // edge would otherwise auto-scroll the canvas container to bring the textarea
      // into view, panning the canvas away from the drop point (#212).
      setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 0);
    }
    // Drop a pin: capture-phase so it beats the drill / marquee / pan handlers.
    canvas.addEventListener("mousedown", function (e) {
      if (!commentMode) return;
      if (e.button !== 0 || E.spaceHeld) return;                 // middle / space still pan
      if (e.target.closest(".comment-pin, .comment-popover")) return; // handled by their own listeners
      e.preventDefault(); e.stopPropagation();
      // Positive exit: while a note is open, the first click OUTSIDE it just closes it
      // (back to the crosshair) — the NEXT click drops a new pin.
      if (openCommentId) { closeCommentPopover(); renderCommentPins(); return; }
      var anchor = makeAnchorFromPoint(e.clientX, e.clientY, e.target);
      pushHistory();
      var c = makeComment(anchor, "");
      E.doc.comments = E.doc.comments || []; E.doc.comments.push(c);
      scheduleSave();
      openCommentPopover(c);
    }, true);

    // §12 slice 4: demo/preview comment mode — same store, block/page anchors only.
    var demoCommentBtn = document.getElementById("demo-comment");
    function setDemoCommentMode(on) {
      on = !!on;
      if (demoCommentMode === on) return;
      demoCommentMode = on;
      demoStageEl().classList.toggle("is-comment-mode", demoCommentMode);
      if (demoCommentBtn) demoCommentBtn.classList.toggle("is-active", demoCommentMode);
      if (!demoCommentMode) closeCommentPopover();
      renderCommentPins();
    }
    if (demoCommentBtn) demoCommentBtn.addEventListener("click", function () { setDemoCommentMode(!demoCommentMode); });
    // NB: attach via getElementById, NOT the demoDevice/demoStage vars — those are
    // assigned further down the IIFE, so they're still undefined at this line.
    var _demoDeviceEl = document.getElementById("demo-device");
    var _demoStageEl = document.getElementById("demo-stage");
    // Drop a pin in the preview (capture-phase, ahead of the runtime's nav clicks).
    if (_demoDeviceEl) _demoDeviceEl.addEventListener("mousedown", function (e) {
      if (!demoCommentMode || e.button !== 0) return;
      if (e.target.closest(".comment-pin, .comment-popover")) return;
      // Positive exit (same as the canvas): a first outside click closes the open note.
      if (openCommentId) { e.preventDefault(); e.stopPropagation(); closeCommentPopover(); renderCommentPins(); return; }
      var anchor = makeAnchorFromPoint(e.clientX, e.clientY, e.target);
      if (!anchor) return; // outside a page — no world anchor in preview
      e.preventDefault(); e.stopPropagation();
      pushHistory();
      var c = makeComment(anchor, "");
      E.doc.comments = E.doc.comments || []; E.doc.comments.push(c);
      scheduleSave();
      openCommentPopover(c);
    }, true);
    // While commenting, swallow preview clicks so a note-drop never triggers nav.
    if (_demoDeviceEl) _demoDeviceEl.addEventListener("click", function (e) { if (demoCommentMode) { e.preventDefault(); e.stopPropagation(); } }, true);
    // Content scrolls inside the device -> re-project pins to follow it.
    if (_demoStageEl) _demoStageEl.addEventListener("scroll", function () { if (demoIsOpen()) renderCommentPins(); }, true);

    // The preview reads both of these as it opens and as pins are drawn; they are reassigned as the
    // author works, so they cross as live getters rather than values.
    // The preview's own comment button lives in this file, and demo.js clears its active state as
    // the preview opens.
    kernel.provide({ demoCommentBtn: demoCommentBtn });
    kernel.provideLive({
      commentMode: commentModeOn,
      demoCommentMode: demoCommentModeNow,
      openCommentId: openCommentIdNow
    });
    kernel.expose({
      setCommentMode: setCommentMode, commentModeOn: commentModeOn, renderCommentList: renderCommentList,
      // arch-P3b-07z: the comment MODEL, which lives here now. editor.js and source-stage.js
      // reach it through the kernel exactly as they did when it was a local declaration.
      makeComment: makeComment, commentIsReceipt: commentIsReceipt, commentIsTask: commentIsTask,
      taskComments: taskComments, receiptsFor: receiptsFor, openTasks: openTasks, doneTasks: doneTasks,
      commentIsGuest: commentIsGuest, commentIsOrphaned: commentIsOrphaned, commentFromEnv: commentFromEnv,
      docCids: docCids, blockCidById: blockCidById, blockIdByCid: blockIdByCid,
      refreshCommentPanel: refreshCommentPanel, commentIdentity: commentIdentity, colourForName: colourForName,
      makeReply: makeReply, mergeComments: mergeComments, makeAnchorFromPoint: makeAnchorFromPoint,
      rectUnculled: rectUnculled, activeSurf: activeSurf, renderCommentPins: renderCommentPins,
      closeCommentPopover: closeCommentPopover, openCommentPopover: openCommentPopover, openCommentIdNow: openCommentIdNow,
      setDemoCommentMode: setDemoCommentMode, resetDemoCommentMode: resetDemoCommentMode, demoCommentModeNow: demoCommentModeNow,
      collabChrome: collabChrome, anchorToScreen: anchorToScreen, resolvePinContext: resolvePinContext
    });
  }

  window.VersoComments = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoComments;
})();
