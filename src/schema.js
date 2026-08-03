/*
 * schema.js — Phase 3, Feature 2: whole-course schema
 * round-trip. Distinct from csv.js (which binds ONE component grid) — this
 * serialises the ENTIRE course document to a human-readable table and rebuilds
 * a course from an edited table.
 *
 * FORMAT (the tool owns it; it doubles as the copy-review artifact):
 *   one row per scalar VALUE in the document, columns:
 *     Page | Location | Path | Field | Type | Value
 *   - Path  = machine address, e.g. pages.3.blocks.1.text or
 *             pages.0.blocks.1.instances.2.slots.title  (drives rebuild)
 *   - Type  = string|number|boolean|null (so "01" stays a string, heights stay
 *             numbers — lossless round-trip)
 *   - Page / Location / Field = human aids for review; ignored on import.
 *
 * Generic on purpose: it serialises whatever shape the doc has, so composable
 * frames/children and the variant overrides (phase 3) round-trip with
 * no change here. Import rebuilds the tree from Path, so adding pages / reusing
 * components in new orders = adding / duplicating row-groups in the table.
 *
 * Talks to the editor ONLY via window.Editor. Do NOT edit editor.js / render.js /
 * components.js / index.html.
 */
(function () {
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  var HEADER = ["Page", "Location", "Path", "Field", "Type", "Value"];

  // ---- CSV write ------------------------------------------------------------
  function csvCell(v) {
    v = v == null ? "" : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }

  // ---- CSV read (RFC-4180-ish: quotes, "" escape, commas, CRLF, BOM) --------
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    var rows = [], row = [], field = "", i = 0, inQ = false, c;
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ""; }); });
  }

  // ---- export: walk the doc -> value rows -----------------------------------
  function isScalar(v) { return v === null || typeof v !== "object"; }

  function arrayItemLabel(arrayPath, item, i) {
    if (arrayPath === "pages") return (item && (item.name || item.id)) || ("Page " + (i + 1));
    if (/\.blocks$/.test(arrayPath)) return (item && (item.type + (item.component ? " (" + item.component + ")" : ""))) || ("Block " + (i + 1));
    if (/\.instances$/.test(arrayPath)) return (item && item.slots && (item.slots.title || item.slots.number)) || ("Item " + (i + 1));
    return "[" + i + "]";
  }

  function walk(node, path, labels, pageName, rows) {
    if (Array.isArray(node)) {
      node.forEach(function (item, i) {
        var label = arrayItemLabel(path, item, i);
        var pn = path === "pages" ? label : pageName;
        walk(item, path + "." + i, labels.concat(label), pn, rows);
      });
      return;
    }
    if (node && typeof node === "object") {
      Object.keys(node).forEach(function (k) {
        walk(node[k], path ? path + "." + k : k, labels.concat(k), pageName, rows);
      });
      return;
    }
    // scalar leaf
    var field = path.split(".").pop();
    var type = node === null ? "null" : typeof node;
    rows.push([pageName || "", labels.slice(0, -1).join(" › "), path, field, type, node === null ? "" : String(node)]);
  }

  // Pure builder: doc -> the Page/Location/Path/Field/Type/Value CSV text. Exposed so
  // the auto-backup (and the download button) share ONE serialiser (single source).
  function schemaCsvText(d) {
    var rows = [HEADER];
    walk(d || window.Editor.getDoc(), "", [], "", rows);
    return toCSV(rows);
  }
  if (typeof window !== "undefined") window.__schemaCsv = schemaCsvText; // guard: this slice is eval'd window-less in tests
  function exportSchema() {
    var doc = window.Editor.getDoc();
    var code = (doc.meta && doc.meta.code) || "course";
    var blob = new Blob([schemaCsvText(doc)], { type: "text/csv" });
    window.__pipelineDownload(blob, code + "_schema_" + window.__pipelineTs() + ".csv");
  }

  // ---- import: rebuild a doc from Path/Type/Value ---------------------------
  function castValue(type, value) {
    if (type === "number") return value === "" ? 0 : Number(value);
    if (type === "boolean") return value === "true";
    if (type === "null") return null;
    return value; // string
  }

  function setPath(root, path, value) {
    var parts = path.split(".");
    var node = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      var nextIsIndex = /^\d+$/.test(parts[i + 1]);
      if (node[key] == null) node[key] = nextIsIndex ? [] : {};
      node = node[key];
    }
    node[parts[parts.length - 1]] = value;
  }

  function importSchema() {
    var input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,text/csv";
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var rows;
        try { rows = parseCSV(reader.result); }
        catch (e) { alert("Could not parse that CSV.\n\n" + e.message); return; }
        if (!rows.length) { alert("That CSV is empty."); return; }

        // locate columns by header (fall back to fixed order)
        var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
        var pi = head.indexOf("path"), ti = head.indexOf("type"), vi = head.indexOf("value");
        var start = 1;
        if (pi < 0) { pi = 2; ti = 4; vi = 5; start = 0; } // no recognised header — assume our column order

        var root = {};
        for (var r = start; r < rows.length; r++) {
          var path = String(rows[r][pi] == null ? "" : rows[r][pi]).trim();
          if (!path) continue;
          setPath(root, path, castValue(String(rows[r][ti] || "string").trim(), rows[r][vi] == null ? "" : rows[r][vi]));
        }

        if (!root.pages || !root.pages.length) { alert("That schema rebuilt no `pages` — check the Path column."); return; }
        // Keep the house header/footer default: a schema CSV (often authored from
        // Confluence/VersoCSV) carries a blank/other HF that would otherwise overwrite
        // the default set for new courses. If a house default exists, it wins on import.
        var hf = window.__hfDefault && window.__hfDefault.forNewDoc && window.__hfDefault.forNewDoc(root.meta && root.meta.title);
        if (hf) root.headerFooter = hf;
        window.Editor.setDoc(root);
        // #145: a schema CSV rebuilds blocks by TYPE with no style — auto-link each to
        // its theme role style (heading->Heading 1, paragraph->Body 1, ...) so an imported
        // course arrives pre-styled instead of needing a manual pass over every block.
        if (window.Editor.applyTextRolesByType) window.Editor.applyTextRolesByType();
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ---- shared helpers (defined by whichever pipeline module loads first) ----
  window.__pipelineTs = window.__pipelineTs || function () {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  };
  window.__pipelineDownload = window.__pipelineDownload || function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  // Registering the pipeline buttons needs a live editor, so it is skipped when the file is
  // loaded on its own (arch-P2's node test seam). The pure schema logic above is unaffected.
  if (window.Editor && window.Editor.registerPipelineButton) {
    window.Editor.registerPipelineButton("Export Schema", exportSchema);
    window.Editor.registerPipelineButton("Import Schema", importSchema, false, { direction: "import" }); // uio-P-C05: inbound -> the Source stage's Import menu
  }

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
