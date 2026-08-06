// editor/hotspots.js -- reading the unified screen-graph (arch-P3-08).
//
// ADR-0003 (#215/#216) made a hotspot block a GRAPH: `block.screens[]` are first-class nodes, each
// with its own visual and its own markers, and `block.entry` names the one you land on. Legacy
// blocks -- a single image with a flat `hotspots[]` list -- reach that shape through
// migrateHotspotBlock at document load, which lives in render.js because the SHIPPED course needs
// it too. So the model and its migration are already single-source and already tested.
//
// What was not extracted is the reading. Four accessors answer every "where is that marker / which
// screen is the entry / what block arrays live in here" question the editor asks, and they were
// closure-local -- which meant the drag-and-drop resolver reached into the graph's shape by hand,
// spelling out screens[].markers[].blocks inline, in more than one place. Two spellings of one
// traversal is exactly how a graph model drifts.
//
// These are READS. Nothing here migrates, normalises or writes: that is render.js's
// migrateHotspotBlock and normalizeHotspotLoops, and it stays there so the editor and the export
// can never disagree about what a hotspot block IS.
//
// Pure: plain objects in, plain answers out. The arrays returned are LIVE, so a walk can splice.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function findHotspot(block, id) {
    var found = null;
    if (block && Array.isArray(block.screens)) block.screens.forEach(function (s) {
      if (found || !s) return;
      (s.markers || []).forEach(function (m) { if (!found && m && m.id === id) found = m; });
    });
    return found;
  }

  function hotspotEntryScreen(block) {
    if (!block || !Array.isArray(block.screens) || !block.screens.length) return null;
    for (var i = 0; i < block.screens.length; i++) if (block.screens[i] && block.screens[i].id === block.entry) return block.screens[i];
    return block.screens[0] || null;
  }

  function hotspotCardArrays(b) {
    var out = [];
    if (b && Array.isArray(b.screens)) b.screens.forEach(function (s) {
      if (s && Array.isArray(s.markers)) s.markers.forEach(function (m) {
        if (m && Array.isArray(m.blocks)) out.push(m.blocks);
      });
    });
    return out;
  }

  // Which hotspot block and marker own a given block, searching every page. Returns
  // { block, hs } -- hs is the owning MARKER (#215) -- or null. `walk` is the shared deep
  // block walk, injected so this stays free of the editor's closure.
  function ownerOf(pages, target, walk) {
    if (!target) return null;
    var found = null;
    for (var pi = 0; pi < (pages || []).length; pi++) {
      walk((pages[pi] && pages[pi].blocks) || [], function (b) {
        if (found || !b || b.type !== "hotspot" || !Array.isArray(b.screens)) return;
        b.screens.forEach(function (s) {
          if (found || !s || !Array.isArray(s.markers)) return;
          s.markers.forEach(function (m) {
            if (found || !m || !Array.isArray(m.blocks)) return;
            var hit = false;
            walk(m.blocks, function (x) { if (x === target) hit = true; });
            if (hit) found = { block: b, hs: m };
          });
        });
      });
      if (found) break;
    }
    return found;
  }

  var VersoHotspots = {
    findMarker: findHotspot,
    entryScreen: hotspotEntryScreen,
    cardArrays: hotspotCardArrays,
    ownerOf: ownerOf
  };

  window.VersoHotspots = VersoHotspots;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoHotspots;
})();
