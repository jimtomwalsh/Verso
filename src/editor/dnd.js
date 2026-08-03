// editor/dnd.js -- where a dropped block actually lands (arch-P3-08).
//
// A drop is model surgery. The DOM part (the four-zone hover bands, the drop marks, the drag
// image) decides only WHERE the pointer is; everything after that is splicing arrays in the
// document, and it is the part that has drawn bug after bug, each fixed and each fix invisible
// unless you read the function:
//
//   · a non-duplicate self-drop would splice the block out and then fail to re-find it -- silent
//     data loss, so it bails before touching history or the model;
//   · dropping a container into itself or its own descendant would nest a block inside itself;
//   · a drop lands on the page the TARGET lives on, not whichever page is selected -- assuming
//     the active page silently no-ops every cross-page drop (#141);
//   · a side-by-side drop on a group's child means "beside the whole group", because a group is
//     one content chunk and its children are full-width (#95);
//   · wrapping a block in a new two-column row keys off its REAL parent array, not the page's
//     block list, or the wrap silently no-ops for anything inside a card, accordion, group or
//     hotspot (#55);
//   · history is pushed only once the drop is known to be real, so a no-op never dirties undo.
//
// Six rules, each one a bug that shipped, none of them reachable by a test while they lived
// inside a drag handler. They are here now, with the array surgery they depend on, and the suite
// drives a drop end to end on a plain document object.
//
// resolveDrop MUTATES the document it is given -- a drop is a mutation, and pretending otherwise
// would mean rebuilding the tree. What it does not do is touch the DOM, the undo stack or the
// selection: it calls beginEdit() at the one moment history should be pushed, and returns which
// pages changed so the caller can repaint exactly those.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // ---- the array surgery -------------------------------------------------
  // Lifted verbatim: these are load-bearing in ways their shape does not advertise. findBlockParent
  // sets ownerBlock ONLY for a columns row and overwrites it on the way up, so an outer columns row
  // wins over an inner one; every other container (group, card items, flip faces, hotspot cards)
  // leaves it null, which is what makes a left/right drop wrap the block IN PLACE through its own
  // parent array rather than trying to splice a column that is not there (#55).
  // hotspotCardArrays is the one dependency, and it belongs to the hotspots module. It is wired
  // EXPLICITLY rather than looked up on window: under `require` each module gets its own window
  // stand-in, so a cross-module global resolves to undefined and findBlockParent would quietly
  // stop resolving blocks inside hotspot cards -- in the tests only, which is the worst place for
  // a difference to live. In the browser the load order does the wiring for free.
  var hotspots = (typeof window !== "undefined" && window.VersoHotspots) || null;
  function use(mod) { hotspots = mod || hotspots; return VersoDnd; }
  function hotspotCardArrays(b) {
    return hotspots ? hotspots.cardArrays(b) : [];
  }
  function findBlockParent(blocks, targetBlock) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b === targetBlock) {
        return { parentArray: blocks, index: i, ownerBlock: null };
      }
      if (b.type === "columns" && b.columns) {
        for (var c = 0; c < b.columns.length; c++) {
          var res = findBlockParent(b.columns[c], targetBlock);
          if (res) {
            res.ownerBlock = b;
            res.columnIndex = c;
            return res;
          }
        }
      }
      // Group children render as real .canvas-block nodes and get drag handles +
      // drop targets wired, so they must be resolvable too. parentArray = the
      // group's children (ownerBlock stays null: a group is not a columns row, so
      // vertical reorder within the group works and a left/right drop wraps the
      // child into a columns row IN PLACE via parentArray/index -- issue #55).
      if (b.type === "group" && b.children) {
        var gres = findBlockParent(b.children, targetBlock);
        if (gres) return gres;
      }
      // Accordion / Card-Reveal children live under items[].children and render as
      // real .canvas-block nodes (drag handles + drop targets wired), so delete +
      // drag-move + drop-insert must resolve them too — otherwise deleteBlockByRef
      // no-ops (loc null) and handleDrop drops nothing (destLoc null) after minting
      // the block, so a newly-added block silently disappears. ownerBlock stays null
      // (not a columns row): reorder within the container works, and a left/right
      // drop wraps the child into a columns row IN PLACE (parentArray/index) so a
      // card body / accordion panel / card-reveal face can hold columns -- issue #55.
      if (Array.isArray(b.items)) {
        for (var it = 0; it < b.items.length; it++) {
          var kids = b.items[it] && b.items[it].children;
          if (Array.isArray(kids)) {
            var ires = findBlockParent(kids, targetBlock);
            if (ires) return ires;
          }
          // flip cards: Side 1 (items[].front) is a first-class block list too, so
          // delete / drag-move / drop-insert resolve front-face blocks as well.
          var fkids = b.items[it] && b.items[it].front;
          if (Array.isArray(fkids)) {
            var fres = findBlockParent(fkids, targetBlock);
            if (fres) return fres;
          }
        }
      }
      // Hotspot popover-card blocks live under hotspots[].blocks and render as real
      // .canvas-block nodes (in the revealed popover) — so delete + drag-move +
      // drop-insert + paste-location must resolve them too, else the block is
      // undeletable and a drop/paste onto it silently no-ops. ownerBlock stays null
      // (not a columns row): before/after reorder within the card works, and a
      // left/right drop wraps the block into a columns row IN PLACE (parentArray/
      // index) so a hotspot card can hold columns too -- issue #55.
      var hArrs = hotspotCardArrays(b); // #215: screens[].markers[].blocks (src/editor/hotspots.js)
      for (var hz = 0; hz < hArrs.length; hz++) {
        var hres = findBlockParent(hArrs[hz], targetBlock);
        if (hres) return hres;
      }
    }
    return null;
  }

  function groupParentOf(blocks, target) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === "group" && Array.isArray(b.children)) {
        var deep = groupParentOf(b.children, target); // nested group wins
        if (deep) return deep;
        if (b.children.indexOf(target) !== -1) return b;
      } else if (Array.isArray(b.children)) {
        var rc = groupParentOf(b.children, target); if (rc) return rc; // frame children
      }
      if (b.type === "columns" && b.columns) {
        for (var c = 0; c < b.columns.length; c++) { var r = groupParentOf(b.columns[c], target); if (r) return r; }
      }
      if (Array.isArray(b.items)) {
        for (var it = 0; it < b.items.length; it++) {
          var item = b.items[it]; if (!item) continue;
          if (Array.isArray(item.children)) { var ri = groupParentOf(item.children, target); if (ri) return ri; }
          if (Array.isArray(item.front)) { var rf = groupParentOf(item.front, target); if (rf) return rf; }
        }
      }
      // #215: hotspot card blocks live at screens[].markers[].blocks. Inlined (not the
      // hotspotCardArrays helper) so the @groupparent test fence stays self-contained.
      if (Array.isArray(b.screens)) {
        for (var sz = 0; sz < b.screens.length; sz++) {
          var mks = b.screens[sz] && b.screens[sz].markers;
          if (!Array.isArray(mks)) continue;
          for (var mz = 0; mz < mks.length; mz++) {
            var hb = mks[mz] && mks[mz].blocks;
            if (Array.isArray(hb)) { var rh = groupParentOf(hb, target); if (rh) return rh; }
          }
        }
      }
    }
    return null;
  }

  function cleanupColumns(blocks) {
    for (var i = blocks.length - 1; i >= 0; i--) {
      var b = blocks[i];
      if (b.type === "columns" && b.columns) {
        for (var c = 0; c < b.columns.length; c++) {
          cleanupColumns(b.columns[c]);
        }
        // #94: an EXPLICIT palette Columns block keeps its author-defined column
        // structure — an emptied column shows a drop slot instead of collapsing, and
        // the block is never auto-unwrapped. Only the implicit side-by-side-wrap
        // columns auto-prune empty columns / unwrap to one child (unchanged).
        if (b.explicit) continue;
        b.columns = b.columns.filter(function (col) { return col.length > 0; });
        // Dropping an empty column changes the count; stale per-column widths would
        // misalign -> revert to equal (render falls back to flex:1 when absent).
        if (b.colWidths && b.colWidths.length !== b.columns.length) delete b.colWidths;
        if (b.columns.length === 0) {
          blocks.splice(i, 1);
        } else if (b.columns.length === 1) {
          var children = b.columns[0];
          blocks.splice.apply(blocks, [i, 1].concat(children));
        }
      }
    }
  }

  function appendIntoContainer(cont, blk) {
    if (cont.type === "columns") {
      cont.columns = (cont.columns && cont.columns.length) ? cont.columns : [[]];
      (cont.columns[0] = cont.columns[0] || []).push(blk);
    } else {
      cont.children = cont.children || [];
      cont.children.push(blk);
    }
  }

  function appendIntoColumn(cont, ci, blk) {
    if (!cont || cont.type !== "columns") return;
    cont.columns = cont.columns || [];
    cont.columns[ci] = cont.columns[ci] || [];
    cont.columns[ci].push(blk);
  }

  // ---- the drop itself ----------------------------------------------------
  // ctx = {
  //   doc, payload, target, zone, currentPage,
  //   make(index)          build a fresh block from the palette
  //   beginEdit()          push history -- called ONCE, only for a drop that will really happen
  //   findPageOfBlock(b)   page index of a block, by identity
  //   walkBlocks(list, fn) the shared deep walk
  //   clone(o), cleanupColumns(blocks)
  // }
  // Returns { ok:false, reason } or { ok:true, block, currentPage, affected:[pageIndex...] }.
  function resolveDrop(ctx) {
    var doc = ctx.doc, payload = ctx.payload, target = ctx.target, zone = ctx.zone;
    var currentPage = ctx.currentPage;
    if (!payload || !target) return { ok: false, reason: "nothing-dragged" };

    // A non-duplicate self-drop is a no-op that would otherwise splice the block out and fail to
    // re-find it. Bail before history or the model.
    if (payload.kind === "move" && !payload.duplicate &&
        target.targetBlock && target.targetBlock === payload.block) {
      return { ok: false, reason: "self-drop" };
    }
    // A container dropped into itself or its own descendant would nest a block inside itself.
    var intoCont = target.intoContainer || (target.intoColumn && target.intoColumn.block) ||
                   (target.intoBlocks && target.intoBlocks.ownerBlock);
    if (payload.kind === "move" && !payload.duplicate && intoCont) {
      var cyc = false;
      ctx.walkBlocks([payload.block], function (b) { if (b === intoCont) cyc = true; });
      if (cyc) return { ok: false, reason: "cycle" };
    }

    // Resolve WHAT is being dropped before pushing history, so a drop whose source has vanished
    // never dirties the undo stack.
    var block = null;
    if (payload.kind === "move") {
      var srcLoc = findBlockParent(doc.pages[payload.page].blocks, payload.block);
      if (srcLoc) {
        ctx.beginEdit();
        if (payload.duplicate) {
          block = ctx.clone(payload.block);              // Alt-drag leaves the original
        } else {
          block = payload.block;
          srcLoc.parentArray.splice(srcLoc.index, 1);
        }
      }
    } else if (payload.kind === "insert") {
      ctx.beginEdit();
      block = ctx.make(payload.makeIndex);
    }
    if (!block) return { ok: false, reason: "source-gone" };

    if (target.append) {
      doc.pages[target.pageIndex].blocks.push(block);
      currentPage = target.pageIndex;
    } else if (target.targetBlock) {
      // #141: land on the page the TARGET lives on. Assuming the active page silently no-ops
      // every cross-page drop, because findBlockParent would not find the target there.
      var destPi = ctx.findPageOfBlock(target.targetBlock);
      var activePage = destPi >= 0 ? doc.pages[destPi] : doc.pages[currentPage];
      var destLoc = findBlockParent(activePage.blocks, target.targetBlock);
      if (destLoc) {
        if (destPi >= 0) currentPage = destPi;           // follow the drop to its page
        // #95: a group is one content chunk with full-width children, so a side-by-side drop on
        // one of its children means "beside the whole group". before/after (an in-group reorder)
        // and non-group container children are untouched.
        if (zone === "left" || zone === "right") {
          var grp = groupParentOf(activePage.blocks, target.targetBlock);
          if (grp && grp !== block) {
            var gLoc = findBlockParent(activePage.blocks, grp);
            if (gLoc) { destLoc = gLoc; target = { targetBlock: grp }; }
          }
        }
        if (zone === "before") {
          destLoc.parentArray.splice(destLoc.index, 0, block);
        } else if (zone === "after") {
          destLoc.parentArray.splice(destLoc.index + 1, 0, block);
        } else if (zone === "left" || zone === "right") {
          var leftSide = zone === "left";
          if (destLoc.ownerBlock === null) {
            // #55: wrap IN PLACE through the block's REAL parent array. Keying off the page's
            // block list returns -1 for anything inside a card, accordion, group or hotspot,
            // which is a silent no-op.
            destLoc.parentArray[destLoc.index] = {
              type: "columns",
              columns: leftSide ? [[block], [target.targetBlock]] : [[target.targetBlock], [block]]
            };
          } else {
            destLoc.ownerBlock.columns.splice(destLoc.columnIndex + (leftSide ? 0 : 1), 0, [block]);
            delete destLoc.ownerBlock.colWidths;         // a new column -> back to equal widths
          }
        }
      }
    } else if (target.intoColumn) {
      appendIntoColumn(target.intoColumn.block, target.intoColumn.index, block);   // #94
    } else if (target.intoContainer) {
      appendIntoContainer(target.intoContainer, block);
    } else if (target.intoBlocks && target.intoBlocks.arrayRef) {
      target.intoBlocks.arrayRef.push(block);            // #134: a specific card / side body
    } else if (target.page !== undefined && target.index !== undefined) {
      doc.pages[target.page].blocks.splice(target.index, 0, block);
      currentPage = target.page;
    }

    (doc.pages || []).forEach(function (page) { ctx.cleanupColumns(page.blocks); });

    // A drop touches at most the SOURCE page (block removed) and the DEST page (block landed), so
    // the caller can rebuild just those rather than the whole world and every iframe in it.
    var srcPi = (payload.kind === "move" && !payload.duplicate) ? payload.page : -1;
    var landedPi = ctx.findPageOfBlock(block);
    var affected = [];
    [landedPi, srcPi].forEach(function (i) {
      if (i != null && i >= 0 && i < doc.pages.length && affected.indexOf(i) === -1) affected.push(i);
    });
    return { ok: true, block: block, currentPage: currentPage, affected: affected };
  }

  var VersoDnd = {
    findBlockParent: findBlockParent,
    groupParentOf: groupParentOf,
    cleanupColumns: cleanupColumns,
    appendIntoContainer: appendIntoContainer,
    appendIntoColumn: appendIntoColumn,
    resolveDrop: resolveDrop,
    use: use
  };

  window.VersoDnd = VersoDnd;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoDnd;
})();
