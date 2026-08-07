// src/doc-ops.js -- every change to a document as data, addressed by block cid.
//
// THE FAULT THIS EXISTS TO KILL. An editor surface takes a block OBJECT, holds it in a closure,
// and writes to it later. Between the two moments something replaces the document -- undo, redo,
// setDoc, a tab switch, a variant preview, a store refresh -- and the object the closure holds is
// no longer in the tree. The write lands on an orphan. No error, no warning, the author's edit is
// simply gone. That is one cause behind four separate incidents in this codebase: the tour builder
// losing a session's work, doc/registry divergence (#266), a version clone mutating `node.__block`
// instead of the base, and close-active-tab destroying a course on one Ctrl+Z.
//
// The rule this module makes enforceable: DO NOT KEEP A BLOCK. Keep its `cid` and re-address on
// every write. `block.cid` is already the right handle -- stable, minted for every block in
// normalizeDoc, persisted in the .json, and deliberately separate from the lazy `block.id` that
// render stamps as `data-id` (so nothing here can move a byte in a SCORM package).
//
//   var next = DocOps.apply(doc, { op: "set", cid: c, key: "text", value: "..." });
//
// apply() NEVER mutates its input and ALWAYS returns a new document. A cid that is no longer in
// the tree throws DocOps.StaleRefError instead of writing nowhere. That is the whole point: the
// silent class of fault becomes a loud one, at the moment of the write, naming the cid.
//
// Pure, DOM-free, dependency-free -- so the addressing, the ops and the stale-ref rule are all
// exercised headlessly (tests/run.js section DO). It knows nothing about the editor, the canvas,
// history or the store; callers own the repaint and the pair-write exactly as they do today.
(function () {
  "use strict";

  // --- errors ---------------------------------------------------------------
  // Distinct types so a caller can tell "the author's target vanished" (recoverable: re-read the
  // document and tell them) from "this op is malformed" (a defect in the calling code).
  function StaleRefError(cid) {
    var e = new Error("doc-ops: no block with cid " + JSON.stringify(cid) + " in this document");
    e.name = "StaleRefError";
    e.cid = cid;
    return e;
  }
  function OpError(msg) {
    var e = new Error("doc-ops: " + msg);
    e.name = "OpError";
    return e;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function isBlock(o) { return isObj(o) && typeof o.type === "string"; }

  // --- addressing -----------------------------------------------------------
  // Find a cid ANYWHERE in the tree, without a hard-coded list of container keys.
  //
  // The alternative -- ["children","columns","items","blocks","cells"] -- is what editor.js's
  // walkBlocks does, and it is why hotspot popover cards (screens[].markers[].blocks) needed a
  // hand-inlined special case there. A new container shape must not be able to make a block
  // unaddressable, because an unaddressable block is exactly the silent-write fault again. So:
  // descend every array and every plain object, and match on cid.
  //
  // Returns { block, parent, index, page, pageIndex } or null. `parent` is the ARRAY the block
  // sits in and `index` its position, which is what remove / move / insert need.
  function locateIn(root, cid, page, pageIndex) {
    var found = null;
    function scanArray(arr) {
      for (var i = 0; i < arr.length && !found; i++) {
        var e = arr[i];
        if (Array.isArray(e)) { scanArray(e); continue; }      // columns: array of block arrays
        if (!isObj(e)) continue;
        if (e.cid === cid) { found = { block: e, parent: arr, index: i, page: page, pageIndex: pageIndex }; return; }
        scanObject(e);
      }
    }
    function scanObject(node) {
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && !found; k++) {
        var v = node[keys[k]];
        if (Array.isArray(v)) scanArray(v);
        else if (isObj(v)) scanObject(v);
      }
    }
    if (Array.isArray(root)) scanArray(root); else if (isObj(root)) scanObject(root);
    return found;
  }

  // Locate a cid in a whole document, carrying the page it was found on. The page index is the
  // repaint hint history.js already speaks (isolatedPageChanges): a caller that knows only one
  // page changed can rebuild that page instead of re-mounting the course.
  function locate(doc, cid) {
    if (cid == null || cid === "") throw OpError("locate needs a cid");
    var pages = (doc && doc.pages) || [];
    for (var i = 0; i < pages.length; i++) {
      var hit = locateIn(pages[i], cid, pages[i], i);
      if (hit) return hit;
    }
    // Blocks also live outside pages -- doc.components (library masters), doc.headerFooter.
    // They are addressable too, with no page.
    var rest = {};
    Object.keys(doc || {}).forEach(function (k) { if (k !== "pages") rest[k] = doc[k]; });
    return locateIn(rest, cid, null, -1);
  }

  function mustLocate(doc, cid) {
    var hit = locate(doc, cid);
    if (!hit) throw StaleRefError(cid);
    return hit;
  }

  function has(doc, cid) { return !!locate(doc, cid); }

  // Every cid in the document, in tree order. The scan behind "is this reference still live?"
  // checks and the duplicate-cid assertion below.
  function cids(doc) {
    var out = [];
    function scanArray(arr) {
      arr.forEach(function (e) {
        if (Array.isArray(e)) return scanArray(e);
        if (!isObj(e)) return;
        if (typeof e.cid === "string") out.push(e.cid);
        scanObject(e);
      });
    }
    function scanObject(node) {
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (Array.isArray(v)) scanArray(v);
        else if (isObj(v)) scanObject(v);
      });
    }
    if (isObj(doc)) scanObject(doc);
    return out;
  }

  // A cid that appears twice makes locate() ambiguous and an override key wrong. Remint-on-clone
  // is meant to prevent it (editor.js remintIds); this is the assertion that says so out loud.
  function duplicateCids(doc) {
    var seen = {}, dupes = [];
    cids(doc).forEach(function (c) {
      if (seen[c]) { if (seen[c] === 1) dupes.push(c); seen[c]++; } else seen[c] = 1;
    });
    return dupes;
  }

  // --- the ops --------------------------------------------------------------
  // Each takes the CLONED document and edits it in place. apply() owns the clone, so an op that
  // throws half way leaves the caller's document untouched -- the failed edit changes nothing.
  var OPS = {
    // Set one field. `value === undefined` deletes the key, which is how an inspector clears a
    // setting back to its default rather than writing an undefined the exporter has to skip.
    set: function (next, op) {
      if (!op.key) throw OpError("set needs a key");
      var hit = mustLocate(next, op.cid);
      if (op.value === undefined) delete hit.block[op.key]; else hit.block[op.key] = op.value;
      return hit;
    },

    // Set several fields at once -- one undo step, one repaint, for an inspector control that
    // writes a pair (width + unit, src + alt).
    merge: function (next, op) {
      if (!isObj(op.patch)) throw OpError("merge needs a patch object");
      var hit = mustLocate(next, op.cid);
      Object.keys(op.patch).forEach(function (k) {
        if (op.patch[k] === undefined) delete hit.block[k]; else hit.block[k] = op.patch[k];
      });
      return hit;
    },

    // Swap a block for another one, keeping its place AND its cid. Convert-type is this op: the
    // block becomes a heading, but comments anchored to it and any override keyed on it survive
    // because the address did not move.
    replace: function (next, op) {
      if (!isBlock(op.block)) throw OpError("replace needs a block with a type");
      var hit = mustLocate(next, op.cid);
      var repl = clone(op.block);
      repl.cid = op.cid;
      hit.parent[hit.index] = repl;
      hit.block = repl;
      return hit;
    },

    remove: function (next, op) {
      var hit = mustLocate(next, op.cid);
      hit.parent.splice(hit.index, 1);
      return hit;
    },

    // Insert into the array named by `into`. `into` is either { cid, key } (a container block) or
    // { pageId, key } (a page, key defaulting to "blocks"). An index past the end appends, which
    // is what "add at the bottom" means and saves every caller a length lookup.
    insert: function (next, op) {
      if (!isBlock(op.block)) throw OpError("insert needs a block with a type");
      var target = resolveTarget(next, op.into);
      var at = op.index == null ? target.arr.length : Math.max(0, Math.min(op.index | 0, target.arr.length));
      var added = clone(op.block);
      if (added.cid != null && has(next, added.cid)) throw OpError("insert would duplicate cid " + JSON.stringify(added.cid));
      target.arr.splice(at, 0, added);
      return { block: added, parent: target.arr, index: at, page: target.page, pageIndex: target.pageIndex };
    },

    // Move an existing block to another place. Remove first, THEN resolve the destination index,
    // so moving a block down inside its own array lands where the author dropped it rather than
    // one slot early.
    move: function (next, op) {
      var hit = mustLocate(next, op.cid);
      var block = hit.parent[hit.index];
      hit.parent.splice(hit.index, 1);
      var target;
      try { target = resolveTarget(next, op.into); }
      catch (e) { hit.parent.splice(hit.index, 0, block); throw e; }  // put it back: a failed move moves nothing
      var at = op.index == null ? target.arr.length : Math.max(0, Math.min(op.index | 0, target.arr.length));
      target.arr.splice(at, 0, block);
      return { block: block, parent: target.arr, index: at, page: target.page, pageIndex: target.pageIndex };
    }
  };

  // Resolve an insert/move destination to a real array in the cloned document.
  function resolveTarget(next, into) {
    if (!isObj(into)) throw OpError("insert/move needs an `into` of { cid, key } or { pageId, key }");
    var key = into.key || "blocks";
    if (into.pageId != null) {
      var pages = (next && next.pages) || [];
      for (var i = 0; i < pages.length; i++) {
        if (pages[i] && pages[i].id === into.pageId) {
          if (!Array.isArray(pages[i][key])) pages[i][key] = [];
          return { arr: pages[i][key], page: pages[i], pageIndex: i };
        }
      }
      throw OpError("no page with id " + JSON.stringify(into.pageId));
    }
    if (into.cid != null) {
      var hit = mustLocate(next, into.cid);
      var arr = hit.block[key];
      // columns is an array of block ARRAYS; a caller targeting one says { cid, key: "columns",
      // column: n }. Anything else with a nested array is a defect, not a guess we should make.
      if (into.column != null) {
        if (!Array.isArray(arr)) throw OpError("block " + into.cid + " has no " + key + " to index a column into");
        var c = into.column | 0;
        if (!Array.isArray(arr[c])) throw OpError("block " + into.cid + " has no column " + c);
        return { arr: arr[c], page: hit.page, pageIndex: hit.pageIndex };
      }
      if (!Array.isArray(arr)) { hit.block[key] = []; arr = hit.block[key]; }
      return { arr: arr, page: hit.page, pageIndex: hit.pageIndex };
    }
    throw OpError("`into` needs a cid or a pageId");
  }

  // --- apply ----------------------------------------------------------------
  // The one way a change reaches a document. Returns { doc, hit } -- the NEW document and where
  // the change landed (block, page, pageIndex) so the caller can repaint one page and reselect
  // the block it just wrote, without re-scanning.
  function applyWithResult(doc, change) {
    if (!isObj(doc)) throw OpError("apply needs a document");
    if (!isObj(change)) throw OpError("apply needs a change object");
    var fn = OPS[change.op];
    if (!fn) throw OpError("unknown op " + JSON.stringify(change.op));
    var next = clone(doc);
    var hit = fn(next, change);
    return { doc: next, hit: hit };
  }

  // The common shape: give me the new document.
  function apply(doc, change) { return applyWithResult(doc, change).doc; }

  // Several changes as ONE step -- one clone, one undo entry, all-or-nothing. If change 3 of 5
  // throws, the caller's document is unchanged and no partial edit is left behind.
  function applyAll(doc, changes) {
    if (!Array.isArray(changes)) throw OpError("applyAll needs an array of changes");
    if (!isObj(doc)) throw OpError("applyAll needs a document");
    var next = clone(doc);
    changes.forEach(function (change) {
      if (!isObj(change)) throw OpError("applyAll needs change objects");
      var fn = OPS[change.op];
      if (!fn) throw OpError("unknown op " + JSON.stringify(change.op));
      fn(next, change);
    });
    return next;
  }

  var DocOps = {
    apply: apply,
    applyWithResult: applyWithResult,
    applyAll: applyAll,
    locate: locate,
    has: has,
    cids: cids,
    duplicateCids: duplicateCids,
    StaleRefError: StaleRefError,
    OpError: OpError,
    OPS: Object.keys(OPS)
  };

  if (typeof window !== "undefined") window.DocOps = DocOps;
  if (typeof module !== "undefined" && module.exports) module.exports = DocOps;
})();
