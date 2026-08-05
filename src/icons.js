// icons.js — the single Icon accessor for editor CHROME.
//
// Adopts Lucide (lucide.dev, ISC-licensed), bundled OFFLINE: the exact
// Lucide v0.454.0 glyph geometry is inlined below as a name -> inner-SVG map.
// No remote fetch, no npm, no runtime icon library — the SVGs are stroke paths
// copied verbatim from the Lucide static build and normalised (whitespace
// collapsed). This mirrors the vendored design-system Icon component but resolves
// entirely from the local map below (the DS mockup used a runtime lib; we do not).
//
// Icon(name) returns a full <svg> string on the 24-grid with Lucide's canonical
// 2px round-cap stroke. Keyed by Lucide kebab-case name. Unknown names return a
// neutral placeholder box so chrome never breaks or throws.
//
// CHROME ONLY. This file is NOT loaded by render(doc,theme) / course.css / the
// SCORM export — course runtime icons stay hand-inlined in render.js and are
// unaffected. Do not import Icon into the ship path.
(function () {
  "use strict";

  // --- Lucide v0.454.0 (ISC) — exact glyph geometry, inlined offline ---------
  var LUCIDE = {
    "align-center": "<path d=\"M17 12H7\" /><path d=\"M19 18H5\" /><path d=\"M21 6H3\" />",
    "align-center-horizontal": "<path d=\"M2 12h20\" /><path d=\"M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4\" /><path d=\"M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4\" /><path d=\"M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1\" /><path d=\"M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1\" />",
    "align-end-horizontal": "<rect width=\"6\" height=\"16\" x=\"4\" y=\"2\" rx=\"2\" /><rect width=\"6\" height=\"9\" x=\"14\" y=\"9\" rx=\"2\" /><path d=\"M22 22H2\" />",
    "align-horizontal-space-between": "<rect width=\"6\" height=\"14\" x=\"3\" y=\"5\" rx=\"2\" /><rect width=\"6\" height=\"10\" x=\"15\" y=\"7\" rx=\"2\" /><path d=\"M3 2v20\" /><path d=\"M21 2v20\" />",
    "align-justify": "<path d=\"M3 12h18\" /><path d=\"M3 18h18\" /><path d=\"M3 6h18\" />",
    "align-left": "<path d=\"M15 12H3\" /><path d=\"M17 18H3\" /><path d=\"M21 6H3\" />",
    "align-right": "<path d=\"M21 12H9\" /><path d=\"M21 18H7\" /><path d=\"M21 6H3\" />",
    "align-start-horizontal": "<rect width=\"6\" height=\"16\" x=\"4\" y=\"6\" rx=\"2\" /><rect width=\"6\" height=\"9\" x=\"14\" y=\"6\" rx=\"2\" /><path d=\"M22 2H2\" />",
    "arrow-down": "<path d=\"M12 5v14\" /><path d=\"m19 12-7 7-7-7\" />",
    "arrow-down-to-line": "<path d=\"M12 17V3\" /><path d=\"m6 11 6 6 6-6\" /><path d=\"M19 21H5\" />",
    "arrow-up": "<path d=\"m5 12 7-7 7 7\" /><path d=\"M12 19V5\" />",
    "arrow-up-to-line": "<path d=\"M5 3h14\" /><path d=\"m18 13-6-6-6 6\" /><path d=\"M12 7v14\" />",
    "arrow-left-right": "<path d=\"M8 3 4 7l4 4\" /><path d=\"M4 7h16\" /><path d=\"m16 21 4-4-4-4\" /><path d=\"M20 17H4\" />",
    "chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
    "chevron-up": "<path d=\"m18 15-6-6-6 6\" />",
    "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
    "history": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" /><path d=\"M12 7v5l4 2\" />",
    "columns-2": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M12 3v18\" />",
    "contrast": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 18a6 6 0 0 0 0-12v12z\" />",
    "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
    "eraser": "<path d=\"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21\" /><path d=\"m5.082 11.09 8.828 8.828\" />",
    "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
    "eye-off": "<path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\" /><path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\" /><path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\" /><path d=\"m2 2 20 20\" />",
    "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
    "folder-plus": "<path d=\"M12 10v6\" /><path d=\"M9 13h6\" /><path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
    "fold-vertical": "<path d=\"M12 22v-6\" /><path d=\"M12 8V2\" /><path d=\"M4 12H2\" /><path d=\"M10 12H8\" /><path d=\"M16 12h-2\" /><path d=\"M22 12h-2\" /><path d=\"m15 19-3-3-3 3\" /><path d=\"m15 5-3 3-3-3\" />",
    "grid-2x2": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M3 12h18\" /><path d=\"M12 3v18\" />",
    "grip-vertical": "<circle cx=\"9\" cy=\"12\" r=\"1\" /><circle cx=\"9\" cy=\"5\" r=\"1\" /><circle cx=\"9\" cy=\"19\" r=\"1\" /><circle cx=\"15\" cy=\"12\" r=\"1\" /><circle cx=\"15\" cy=\"5\" r=\"1\" /><circle cx=\"15\" cy=\"19\" r=\"1\" />",
    "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /><circle cx=\"9\" cy=\"9\" r=\"2\" /><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
    "indent-increase": "<path d=\"M21 12H11\" /><path d=\"M21 18H11\" /><path d=\"M21 6H11\" /><path d=\"m3 8 4 4-4 4\" />",
    "list-collapse": "<path d=\"m3 10 2.5-2.5L3 5\" /><path d=\"m3 19 2.5-2.5L3 14\" /><path d=\"M10 6h11\" /><path d=\"M10 12h11\" /><path d=\"M10 18h11\" />",
    "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />",
    "shield": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />",
    "lock-open": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 9.9-1\" />",
    "minus": "<path d=\"M5 12h14\" />",
    "monitor": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\" /><line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\" /><line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\" />",
    "plus": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
    "bold": "<path d=\"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8\" />",
    "italic": "<line x1=\"19\" x2=\"10\" y1=\"4\" y2=\"4\" /><line x1=\"14\" x2=\"5\" y1=\"20\" y2=\"20\" /><line x1=\"15\" x2=\"9\" y1=\"4\" y2=\"20\" />",
    "square-pen": "<path d=\"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\" /><path d=\"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z\" />",
    "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /><path d=\"M21 3v5h-5\" /><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /><path d=\"M8 16H3v5\" />",
    "scissors": "<circle cx=\"6\" cy=\"6\" r=\"3\" /><path d=\"M8.12 8.12 12 12\" /><path d=\"M20 4 8.12 15.88\" /><circle cx=\"6\" cy=\"18\" r=\"3\" /><path d=\"M14.8 14.8 20 20\" />",
    "smartphone": "<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\" /><path d=\"M12 18h.01\" />",
    "sparkles": "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\" /><path d=\"M20 3v4\" /><path d=\"M22 5h-4\" /><path d=\"M4 17v2\" /><path d=\"M5 18H3\" />",
    "tablet": "<rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" ry=\"2\" /><line x1=\"12\" x2=\"12.01\" y1=\"18\" y2=\"18\" />",
    "trash-2": "<path d=\"M3 6h18\" /><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" />",
    "unfold-horizontal": "<path d=\"M16 12h6\" /><path d=\"M8 12H2\" /><path d=\"M12 2v2\" /><path d=\"M12 8v2\" /><path d=\"M12 14v2\" /><path d=\"M12 20v2\" /><path d=\"m19 15 3-3-3-3\" /><path d=\"m5 9-3 3 3 3\" />",
    "link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" /><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />",
    "unlink": "<path d=\"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71\" /><path d=\"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71\" /><line x1=\"8\" x2=\"8\" y1=\"2\" y2=\"5\" /><line x1=\"2\" x2=\"5\" y1=\"8\" y2=\"8\" /><line x1=\"16\" x2=\"16\" y1=\"19\" y2=\"22\" /><line x1=\"19\" x2=\"22\" y1=\"16\" y2=\"16\" />",
    "upload": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><polyline points=\"17 8 12 3 7 8\" /><line x1=\"12\" x2=\"12\" y1=\"3\" y2=\"15\" />",
    "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
    "pipette": "<path d=\"m2 22 1-1h3l9-9\" /><path d=\"M3 21v-3l9-9\" /><path d=\"m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z\" />",
    "play": "<path d=\"M6 3 20 12 6 21Z\" />",
    "pause": "<rect x=\"14\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\" /><rect x=\"6\" y=\"4\" width=\"4\" height=\"16\" rx=\"1\" />",
    "crop": "<path d=\"M6 2v14a2 2 0 0 0 2 2h14\" /><path d=\"M18 22V8a2 2 0 0 0-2-2H2\" />",
    "undo-2": "<path d=\"M9 14 4 9l5-5\" /><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11\" />",
    "redo-2": "<path d=\"m15 14 5-5-5-5\" /><path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13\" />",
    "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" /><path d=\"m21 21-4.3-4.3\" />",
    "help-circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /><path d=\"M12 17h.01\" />",
    "moon": "<path d=\"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z\" />",
    "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\" /><path d=\"M12 2v2\" /><path d=\"M12 20v2\" /><path d=\"m4.93 4.93 1.41 1.41\" /><path d=\"m17.66 17.66 1.41 1.41\" /><path d=\"M2 12h2\" /><path d=\"M20 12h2\" /><path d=\"m6.34 17.66-1.41 1.41\" /><path d=\"m19.07 4.93-1.41 1.41\" />",
    "message-square": "<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\" />",
    "more-horizontal": "<circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"19\" cy=\"12\" r=\"1\" /><circle cx=\"5\" cy=\"12\" r=\"1\" />",
    // Structure outliner + Blocks palette (issue #13) — the DS LeftPanel iconography.
    "file-text": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z\" /><path d=\"M14 2v4a2 2 0 0 0 2 2h4\" /><path d=\"M10 9H8\" /><path d=\"M16 13H8\" /><path d=\"M16 17H8\" />",
    "heading": "<path d=\"M6 12h12\" /><path d=\"M6 20V4\" /><path d=\"M18 20V4\" />",
    "underline": "<path d=\"M6 4v6a6 6 0 0 0 12 0V4\" /><line x1=\"4\" x2=\"20\" y1=\"20\" y2=\"20\" />",
    "replace": "<path d=\"M14 4a2 2 0 0 1 2-2\" /><path d=\"M16 10a2 2 0 0 1-2-2\" /><path d=\"M20 2a2 2 0 0 1 2 2\" /><path d=\"M22 8a2 2 0 0 1-2 2\" /><path d=\"m3 7 3 3 3-3\" /><path d=\"M6 10V5a3 3 0 0 1 3-3h1\" /><rect width=\"8\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" />",
    "heading-1": "<path d=\"M4 12h8\" /><path d=\"M4 18V6\" /><path d=\"M12 18V6\" /><path d=\"m17 12 3-2v8\" />",
    "heading-2": "<path d=\"M4 12h8\" /><path d=\"M4 18V6\" /><path d=\"M12 18V6\" /><path d=\"M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1\" />",
    "pilcrow": "<path d=\"M13 4v16\" /><path d=\"M17 4v16\" /><path d=\"M19 4H9.5a4.5 4.5 0 0 0 0 9H13\" />",
    "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /><path d=\"M12 9v4\" /><path d=\"M12 17h.01\" />",
    "type": "<polyline points=\"4 7 4 4 20 4 20 7\" /><line x1=\"9\" x2=\"15\" y1=\"20\" y2=\"20\" /><line x1=\"12\" x2=\"12\" y1=\"4\" y2=\"20\" />",
    "quote": "<path d=\"M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 3-1 4-4 5\" /><path d=\"M20 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 3-1 4-4 5\" />",
    "list": "<line x1=\"8\" x2=\"21\" y1=\"6\" y2=\"6\" /><line x1=\"8\" x2=\"21\" y1=\"12\" y2=\"12\" /><line x1=\"8\" x2=\"21\" y1=\"18\" y2=\"18\" /><line x1=\"3\" x2=\"3.01\" y1=\"6\" y2=\"6\" /><line x1=\"3\" x2=\"3.01\" y1=\"12\" y2=\"12\" /><line x1=\"3\" x2=\"3.01\" y1=\"18\" y2=\"18\" />",
    "message-square-warning": "<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\" /><path d=\"M12 7v2\" /><path d=\"M12 13h.01\" />",
    "code-xml": "<path d=\"m18 16 4-4-4-4\" /><path d=\"m6 8-4 4 4 4\" /><path d=\"m14.5 4-5 16\" />",
    "square-play": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"m9 8 6 4-6 4Z\" />",
    "target": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><circle cx=\"12\" cy=\"12\" r=\"6\" /><circle cx=\"12\" cy=\"12\" r=\"2\" />",
    "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />",
    "move-vertical": "<path d=\"M12 2v20\" /><path d=\"m8 18 4 4 4-4\" /><path d=\"m8 6 4-4 4 4\" />",
    "panels-top-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M3 9h18\" /><path d=\"M9 21V9\" />",
    "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\" /><path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\" /><path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\" />",
    "settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
    // uio-F05-fb1: the DOCUMENT-scope settings trigger, so it is not the same gear as the
    // app-scope one. Sliders read as "the parameters of this thing", which is what it opens.
    "sliders-horizontal": "<line x1=\"21\" x2=\"14\" y1=\"4\" y2=\"4\" /><line x1=\"10\" x2=\"3\" y1=\"4\" y2=\"4\" /><line x1=\"21\" x2=\"12\" y1=\"12\" y2=\"12\" /><line x1=\"8\" x2=\"3\" y1=\"12\" y2=\"12\" /><line x1=\"21\" x2=\"16\" y1=\"20\" y2=\"20\" /><line x1=\"12\" x2=\"3\" y1=\"20\" y2=\"20\" /><line x1=\"14\" x2=\"14\" y1=\"2\" y2=\"6\" /><line x1=\"8\" x2=\"8\" y1=\"10\" y2=\"14\" /><line x1=\"16\" x2=\"16\" y1=\"18\" y2=\"22\" />",
    "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M9 3v18\" />",
    "workflow": "<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M7 11v4a2 2 0 0 0 2 2h4\" /><rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\" />",
    "navigation": "<path d=\"M3 11 22 2 13 21 11 13Z\" />",
    "check-square": "<path d=\"M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5\" /><path d=\"m9 11 3 3L22 4\" />",
    "list-checks": "<path d=\"m3 17 2 2 4-4\" /><path d=\"m3 7 2 2 4-4\" /><path d=\"M13 6h8\" /><path d=\"M13 12h8\" /><path d=\"M13 18h8\" />",
    "layout-grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" />",
    "table": "<path d=\"M12 3v18\" /><rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><path d=\"M3 9h18\" /><path d=\"M3 15h18\" />",
    "languages": "<path d=\"m5 8 6 6\" /><path d=\"m4 14 6-6 2-3\" /><path d=\"M2 5h12\" /><path d=\"M7 2h1\" /><path d=\"m22 22-5-10-5 10\" /><path d=\"M14 18h6\" />",
    "component": "<path d=\"M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0Z\" />",
    "group": "<path d=\"M3 7V5c0-1.1.9-2 2-2h2\" /><path d=\"M17 3h2c1.1 0 2 .9 2 2v2\" /><path d=\"M21 17v2c0 1.1-.9 2-2 2h-2\" /><path d=\"M7 21H5c-1.1 0-2-.9-2-2v-2\" /><rect width=\"7\" height=\"5\" x=\"7\" y=\"7\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"10\" y=\"12\" rx=\"1\" />",
    "menu": "<line x1=\"4\" x2=\"20\" y1=\"12\" y2=\"12\" /><line x1=\"4\" x2=\"20\" y1=\"6\" y2=\"6\" /><line x1=\"4\" x2=\"20\" y1=\"18\" y2=\"18\" />",
    // glyph-vocabulary-pass — distinct meanings that the single "upload" glyph used to overload:
    // reading (Source rail), authoring (Edit rail), inbound import, queue/send, asset add/replace.
    "book-open": "<path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\" /><path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\" />",
    "pen": "<path d=\"M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z\" /><path d=\"m15 5 4 4\" />",
    "download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><polyline points=\"7 10 12 15 17 10\" /><line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />",
    "send": "<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\" /><path d=\"m21.854 2.147-10.94 10.939\" />",
    "image-plus": "<path d=\"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7\" /><line x1=\"16\" x2=\"22\" y1=\"5\" y2=\"5\" /><line x1=\"19\" x2=\"19\" y1=\"2\" y2=\"8\" /><circle cx=\"9\" cy=\"9\" r=\"2\" /><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />"
  };

  // --- Verso-custom glyphs — FLAGGED: no clean Lucide equivalent -------------
  // These CSS-property field markers (padding / radius / border-weight / blur /
  // per-axis spacing / typographic tracking + leading) have no canonical Lucide
  // icon. They are re-authored here on Lucide's 24-grid in the same 2px round
  // stroke so they read as one set. Kept minimal and deliberately isolated; swap
  // for real Lucide names if the set ever grows them.
  var VERSO_CUSTOM = {
    "padding": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /><rect width=\"9\" height=\"9\" x=\"7.5\" y=\"7.5\" rx=\"1.5\" opacity=\"0.5\" />",
    "pad-x": "<path d=\"M4 4v16\" /><path d=\"M20 4v16\" /><rect width=\"8\" height=\"11\" x=\"8\" y=\"6.5\" rx=\"1.5\" opacity=\"0.55\" />",
    "pad-y": "<path d=\"M4 4h16\" /><path d=\"M4 20h16\" /><rect width=\"11\" height=\"8\" x=\"6.5\" y=\"8\" rx=\"1.5\" opacity=\"0.55\" />",
    "radius": "<path d=\"M5 19V9a4 4 0 0 1 4-4h10\" />",
    "border-weight": "<path d=\"M4 8h16\" stroke-width=\"3.2\" /><path d=\"M4 16h16\" stroke-width=\"1.4\" />",
    "blur": "<circle cx=\"12\" cy=\"12\" r=\"8\" /><path d=\"M4 9h16\" opacity=\"0.5\" /><path d=\"M4 15h16\" opacity=\"0.5\" />",
    "line-height": "<path d=\"M10 6h10\" /><path d=\"M10 12h10\" /><path d=\"M10 18h10\" /><path d=\"M4 7v10\" /><path d=\"m2.5 8.5 1.5-1.5 1.5 1.5\" /><path d=\"m2.5 15.5 1.5 1.5 1.5-1.5\" />",
    "letter-spacing": "<path d=\"M4 5v14\" /><path d=\"M20 5v14\" /><path d=\"M8 12h8\" /><path d=\"m10 9.5-2.5 2.5 2.5 2.5\" /><path d=\"m14 9.5 2.5 2.5-2.5 2.5\" />",
    "word-spacing": "<rect width=\"6\" height=\"6\" x=\"3\" y=\"9\" rx=\"1\" /><rect width=\"6\" height=\"6\" x=\"15\" y=\"9\" rx=\"1\" /><path d=\"M10.5 12h3\" /><path d=\"m12 10.5-1.5 1.5 1.5 1.5\" /><path d=\"m12 10.5 1.5 1.5-1.5 1.5\" />"
  };

  var REG = {};
  var k;
  for (k in LUCIDE) { if (Object.prototype.hasOwnProperty.call(LUCIDE, k)) REG[k] = LUCIDE[k]; }
  for (k in VERSO_CUSTOM) { if (Object.prototype.hasOwnProperty.call(VERSO_CUSTOM, k)) REG[k] = VERSO_CUSTOM[k]; }

  var OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var CLOSE = "</svg>";
  // Neutral placeholder so an unknown name never throws or collapses layout.
  var FALLBACK = '<rect x="4" y="4" width="16" height="16" rx="3" opacity="0.35" />';

  // Icon(name) -> full inline <svg> string for the given Lucide (or flagged
  // Verso-custom) kebab-case name. Unknown -> placeholder box (never throws).
  function Icon(name) {
    var inner = Object.prototype.hasOwnProperty.call(REG, name) ? REG[name] : FALLBACK;
    return OPEN + inner + CLOSE;
  }
  Icon.has = function (name) { return Object.prototype.hasOwnProperty.call(REG, name); };
  Icon.names = function () { return Object.keys(REG); };
  Icon.LUCIDE = LUCIDE;
  Icon.CUSTOM = VERSO_CUSTOM;

  if (typeof window !== "undefined") window.Icon = Icon;
  if (typeof module !== "undefined" && module.exports) module.exports = Icon;
})();
