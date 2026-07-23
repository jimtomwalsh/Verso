/*
 * csv.js — M8: CSV-variable-binding overlay. Import a
 * CSV and bind its columns to a component's slots BY NAME across every instance,
 * then regenerate that component grid's instances from the rows.
 *
 * Two CSV shapes are supported, because the proof data comes in both:
 *   - FLAT (spike 2, csv-binding-spike/course_content.csv): header row of field
 *     names, one row per instance.
 *   - TRANSPOSED (chapter_cards.csv style): field names down column 0, one
 *     COLUMN per instance.
 * Orientation is auto-detected by which layout binds more slots.
 *
 * Fields map to slots by name via an alias table (e.g. "ChapterNumber" -> the
 * chapter-card `number` slot). Slot names are read from window.COMPONENTS
 * (read-only). Existing per-instance overrides (status/hidden/detached) are
 * preserved by identity (first slot) so re-importing an edited CSV changes
 * exactly the edited card (the spike-2 single-row-edit test).
 *
 * Talks to the editor ONLY via window.Editor. Do NOT edit editor.js / render.js
 * / components.js / index.html.
 */
(function () {
  "use strict";

  // --- RFC 4180-ish CSV parser (handles quotes, escaped "", commas, CRLF) ----
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, ""); // strip BOM
    var rows = [], row = [], field = "", i = 0, inQ = false, c;
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    // drop wholly-empty trailing rows
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ""; }); });
  }

  // normalise a field/slot name for matching
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function stripChapter(n) { return n.replace(/^chapter/, ""); }

  // per-slot alias sets (normalised). Keyed by slot.key; the slot's own key +
  // label are always included at build time.
  var ALIASES = {
    number: ["number", "num", "no", "index", "order", "chapternumber"],
    title: ["title", "name", "heading", "chaptertitle", "chaptername"],
    objective: ["objective", "description", "desc", "summary", "body", "outcome", "learningobjective", "chapterdescription", "chapterobjective"]
  };
  function aliasSet(slot) {
    var set = {};
    (ALIASES[slot.key] || []).forEach(function (a) { set[a] = true; });
    set[norm(slot.key)] = true;
    if (slot.label) set[norm(slot.label)] = true;
    return set;
  }
  // Match strength so a specific field wins over a generic alias when several
  // fields could bind the same slot. Real transposed data (chapter_cards.csv)
  // has both a generic "Name" row and a specific "ChapterTitle" row — without
  // ranking, "Name" (a `title` alias) would shadow the real title by field order.
  //   3 = field name IS the slot key (bare or chapter-prefixed): ChapterTitle->title
  //   2 = field name IS the slot label
  //   1 = field name is a known alias (name/description/heading/...)
  function matchStrength(field, slot) {
    var set = aliasSet(slot);
    var n = norm(field), sc = stripChapter(n);
    var key = norm(slot.key), label = slot.label ? norm(slot.label) : null;
    if (n === key || sc === key) return 3;
    if (label && (n === label || sc === label)) return 2;
    if (set[n] || set[sc]) return 1;
    return 0;
  }
  function fieldMatchesSlot(field, slot) { return matchStrength(field, slot) > 0; }

  // Build records ({fieldName: value}) from parsed rows, choosing the orientation
  // (flat vs transposed) that binds the most of `slots`.
  function buildRecords(rows, slots) {
    if (!rows.length) return { records: [], fields: [], orientation: "flat" };

    // flat: header = rows[0], instances = rows[1..]
    var flatFields = rows[0].map(function (x) { return String(x).trim(); });
    var flatRecords = rows.slice(1).map(function (r) {
      var rec = {}; flatFields.forEach(function (f, j) { rec[f] = r[j] == null ? "" : r[j]; }); return rec;
    });

    // transposed: field names = column 0, instances = columns 1..N
    var transFields = rows.map(function (r) { return String(r[0]).trim(); });
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var transRecords = [];
    for (var col = 1; col < width; col++) {
      var rec = {}, any = false;
      rows.forEach(function (r) { var v = r[col] == null ? "" : r[col]; rec[String(r[0]).trim()] = v; if (String(v).trim() !== "") any = true; });
      if (any) transRecords.push(rec);
    }

    function bindScore(fields) {
      return slots.reduce(function (n, slot) {
        return n + (fields.some(function (f) { return fieldMatchesSlot(f, slot); }) ? 1 : 0);
      }, 0);
    }
    var flatScore = bindScore(flatFields);
    var transScore = bindScore(transFields);

    if (transScore > flatScore) return { records: transRecords, fields: transFields, orientation: "transposed", score: transScore };
    return { records: flatRecords, fields: flatFields, orientation: "flat", score: flatScore };
  }

  // For a record, resolve each slot's value from the STRONGEST-matching field.
  function recordToSlots(record, slots) {
    var out = {};
    var keys = Object.keys(record);
    slots.forEach(function (slot) {
      var best = null, bestS = 0;
      keys.forEach(function (k) { var s = matchStrength(k, slot); if (s > bestS) { bestS = s; best = k; } });
      out[slot.key] = best != null ? String(record[best]).trim() : "";
    });
    return out;
  }

  // Find the best target componentGrid: the one whose component binds the most
  // slots to the CSV's fields.
  function findTargetGrid(doc, fields) {
    var best = null, bestScore = 0;
    (doc.pages || []).forEach(function (page) {
      (page.blocks || []).forEach(function (block) {
        if (block.type !== "componentGrid") return;
        var def = (window.COMPONENTS || {})[block.component];
        if (!def || !def.slots) return;
        var score = def.slots.reduce(function (n, slot) {
          return n + (fields.some(function (f) { return fieldMatchesSlot(f, slot); }) ? 1 : 0);
        }, 0);
        if (score > bestScore) { bestScore = score; best = { block: block, def: def }; }
      });
    });
    return bestScore > 0 ? best : null;
  }

  function h(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function executeImport(block, def, records, mappings) {
    var doc = window.Editor.getDoc();
    var idKey = def.slots[0].key;
    var byId = {};
    (block.instances || []).forEach(function (inst) {
      var id = inst.slots && inst.slots[idKey];
      if (id != null && id !== "") byId[String(id).trim()] = inst;
    });

    var newInstances = records.map(function (record) {
      var slots = {};
      def.slots.forEach(function (slot) {
        var f = mappings[slot.key];
        slots[slot.key] = f ? String(record[f] || "").trim() : "";
      });
      var prior = byId[String(slots[idKey]).trim()];
      return {
        status: (prior && prior.status) || (def.variants && def.variants.status ? def.variants.status.default : "incomplete"),
        hidden: prior ? !!prior.hidden : false,
        detached: prior ? !!prior.detached : false,
        slots: slots
      };
    });

    block.instances = newInstances;
    window.Editor.setDoc(doc);
    console.info("[csv] bulk imported " + newInstances.length + " " + def.name + " instances via custom mappings.");
  }

  function showMappingDialog(text) {
    var doc = window.Editor.getDoc();
    var rows = parseCSV(text);
    if (rows.length < 2) { alert("That CSV has no data rows."); return; }

    var candidates = [];
    (doc.pages || []).forEach(function (page) {
      (page.blocks || []).forEach(function (block) {
        if (block.type !== "componentGrid") return;
        var def = (window.COMPONENTS || {})[block.component];
        if (!def || !def.slots) return;
        var built = buildRecords(rows, def.slots);
        if (built.score > 0) candidates.push({ block: block, def: def, built: built });
      });
    });

    var target = candidates[0];
    if (!target) {
      var anyGrid = null;
      (doc.pages || []).forEach(function (p) {
        (p.blocks || []).forEach(function (b) {
          if (b.type === "componentGrid") anyGrid = { block: b, def: (window.COMPONENTS || {})[b.component] };
        });
      });
      if (anyGrid && anyGrid.def) {
        target = { block: anyGrid.block, def: anyGrid.def, built: buildRecords(rows, anyGrid.def.slots) };
      }
    }

    if (!target) {
      alert("No component grids found in the active course document to import into.");
      return;
    }

    var block = target.block, def = target.def, built = target.built;
    var csvFields = built.fields;

    var modal = h("div", "modal-overlay");
    modal.id = "csv-mapping-modal";

    var box = h("div", "modal-box");
    box.style.width = "640px";
    box.appendChild(h("h3", null, "Match CSV Fields — " + def.name));

    var desc = h("p", null, "Detected " + csvFields.length + " column(s) in a '" + built.orientation + "' CSV layout. Match them to " + def.name + " component slots, then import:");
    desc.style.margin = "0 0 10px 0";
    desc.style.color = "var(--text-secondary)";
    box.appendChild(desc);

    // Auto-suggest: best-matching CSV column per slot. autoSuggest is frozen so
    // the confidence badges can tell "still on the auto pick" from "user changed
    // it" as the user edits mappings.
    var mappings = {};
    var autoSuggest = {};
    def.slots.forEach(function (slot) {
      var best = "";
      var bestS = 0;
      csvFields.forEach(function (f) {
        var s = matchStrength(f, slot);
        if (s > bestS) { bestS = s; best = f; }
      });
      mappings[slot.key] = best;
      autoSuggest[slot.key] = best;
    });
    var badges = {};

    var listContainer = h("div", null);
    listContainer.style.display = "flex";
    listContainer.style.flexDirection = "column";
    listContainer.style.gap = "10px";
    listContainer.style.maxHeight = "240px";
    listContainer.style.overflowY = "auto";
    listContainer.style.paddingRight = "6px";

    def.slots.forEach(function (slot) {
      var row = h("div", null);
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.padding = "8px 12px";
      row.style.background = "var(--surface-canvas)";
      row.style.border = "1px solid var(--border-strong)";
      row.style.borderRadius = "8px";

      var left = h("div", null);
      left.style.display = "flex";
      left.style.flexDirection = "column";
      left.style.gap = "2px";

      var label = h("span", null, slot.label || slot.key);
      label.style.fontWeight = "600";
      label.style.color = "var(--text-primary)";
      
      var typeInfo = h("span", null, "Slot: " + slot.key);
      typeInfo.style.fontSize = "10px";
      typeInfo.style.color = "var(--text-secondary)";

      // confidence badge: auto-matched / manual / needs review
      var badge = h("span", null, "");
      badge.style.display = "inline-block";
      badge.style.marginTop = "3px";
      badge.style.padding = "1px 7px";
      badge.style.fontSize = "10px";
      badge.style.fontWeight = "600";
      badge.style.lineHeight = "16px";
      badge.style.borderRadius = "999px";
      badge.style.border = "1px solid transparent";
      badge.style.alignSelf = "flex-start";
      badges[slot.key] = badge;

      left.appendChild(label);
      left.appendChild(typeInfo);
      left.appendChild(badge);

      var sel = h("select", "prop-select");
      sel.style.width = "220px";
      sel.style.margin = "0";

      var optNone = h("option", null, "(Do not import)");
      optNone.value = "";
      sel.appendChild(optNone);

      csvFields.forEach(function (f) {
        var op = h("option", null, f);
        op.value = f;
        if (f === mappings[slot.key]) op.selected = true;
        sel.appendChild(op);
      });

      sel.addEventListener("change", function () {
        mappings[slot.key] = sel.value;
        updateBadges();
        updatePreview();
      });

      row.appendChild(left);
      row.appendChild(sel);
      listContainer.appendChild(row);
    });
    box.appendChild(listContainer);

    var prevTitle = h("h4", null, "Data Preview (first 3 records)");
    prevTitle.style.margin = "16px 0 8px 0";
    prevTitle.style.fontSize = "12px";
    prevTitle.style.color = "var(--text-primary)";
    box.appendChild(prevTitle);

    var previewBox = h("div", null);
    previewBox.style.background = "rgba(0,0,0,0.2)";
    previewBox.style.border = "1px solid var(--border-strong)";
    previewBox.style.borderRadius = "8px";
    previewBox.style.padding = "10px";
    previewBox.style.minHeight = "60px";
    previewBox.style.maxHeight = "160px";
    previewBox.style.overflowY = "auto";
    box.appendChild(previewBox);

    // Reflect match confidence per slot so the user can trust the auto-mapping
    // at a glance before committing: green = still on the auto-suggested column,
    // amber = unmapped (won't import), neutral = user overrode the suggestion.
    function updateBadges() {
      def.slots.forEach(function (slot) {
        var b = badges[slot.key];
        if (!b) return;
        var m = mappings[slot.key];
        var auto = autoSuggest[slot.key];
        if (!m) {
          b.textContent = "Needs review";
          b.style.color = "#d08a1e";
          b.style.borderColor = "#d08a1e";
          b.style.background = "rgba(208,138,30,0.12)";
        } else if (auto && m === auto) {
          b.textContent = "Auto-matched";
          b.style.color = "#3fae6b";
          b.style.borderColor = "#3fae6b";
          b.style.background = "rgba(63,174,107,0.12)";
        } else {
          b.textContent = "Manual";
          b.style.color = "var(--text-secondary)";
          b.style.borderColor = "var(--border-strong)";
          b.style.background = "transparent";
        }
      });
    }

    function updatePreview() {
      previewBox.innerHTML = "";
      var previewTable = h("table", null);
      previewTable.style.width = "100%";
      previewTable.style.borderCollapse = "collapse";
      previewTable.style.fontSize = "11px";

      var trh = h("tr", null);
      def.slots.forEach(function (slot) {
        var th = h("th", null, slot.label || slot.key);
        th.style.textAlign = "left";
        th.style.padding = "4px 8px";
        th.style.borderBottom = "1px solid var(--border-strong)";
        th.style.color = "var(--text-secondary)";
        trh.appendChild(th);
      });
      previewTable.appendChild(trh);

      var sampleRecs = built.records.slice(0, 3);
      if (sampleRecs.length === 0) {
        var emptyRow = h("tr", null);
        var td = h("td", null, "No data rows available to preview.");
        td.colSpan = def.slots.length;
        td.style.padding = "12px";
        td.style.color = "var(--text-secondary)";
        emptyRow.appendChild(td);
        previewTable.appendChild(emptyRow);
      } else {
        sampleRecs.forEach(function (rec) {
          var tr = h("tr", null);
          def.slots.forEach(function (slot) {
            var td = h("td", null);
            var f = mappings[slot.key];
            td.textContent = f ? (rec[f] || "") : "";
            td.style.padding = "4px 8px";
            td.style.borderBottom = "1px solid var(--border-strong)";
            td.style.color = "var(--text-primary)";
            tr.appendChild(td);
          });
          previewTable.appendChild(tr);
        });
      }
      previewBox.appendChild(previewTable);
    }
    updateBadges();
    updatePreview();

    var actions = h("div", "modal-actions");
    var btnConfirm = h("button", "prop-btn prop-btn--accent", "Import " + built.records.length + " Records");
    btnConfirm.addEventListener("click", function () {
      executeImport(block, def, built.records, mappings);
      modal.remove();
    });

    var btnCancel = h("button", "prop-btn prop-btn--danger", "Cancel");
    btnCancel.style.marginLeft = "auto";
    btnCancel.addEventListener("click", function () {
      modal.remove();
    });

    actions.appendChild(btnConfirm);
    actions.appendChild(btnCancel);
    box.appendChild(actions);

    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function pick() {
    var input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,text/csv";
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { showMappingDialog(reader.result); }
        catch (e) { alert("CSV import failed: " + e.message); console.error(e); }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // expose the pure pieces + the end-to-end import for headless testing
  window.CSVBind = { parseCSV: parseCSV, buildRecords: buildRecords, recordToSlots: recordToSlots, findTargetGrid: findTargetGrid, fieldMatchesSlot: fieldMatchesSlot, importText: showMappingDialog };

  window.Editor.registerPipelineButton("Import CSV", pick);
})();
