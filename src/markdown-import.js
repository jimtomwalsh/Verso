// src/markdown-import.js -- parses a Markdown manual into Source-stage topics/sections
// (product-rail-md-topic-import). DOM-free (string in, data out), same shape as
// markdown-lite.js -- editor.js owns turning the result into real LibraryStore writes.
//
// Real manual-to-markdown conversions are inconsistent about literal heading level (a
// numbered subsection can come out as # instead of ##), but the NUMBER itself is usually
// reliable, so heading depth is read from a leading "N" / "N.M" / "N.M.K" prefix when one
// is present; only a non-numbered heading falls back to its literal #/##/### count.
// Depth 1 = a topic (chapter); depth 2 = one of that topic's sections; depth 3+ folds into
// the CURRENT section's body as a bold sub-heading line (the section data shape is flat,
// no nested sub-sections).
//
// window.MarkdownImport.parse(text)      -> { topics, warnings }
// window.MarkdownImport.mergeVariant(...) -> merges a second parse's content into the
//   first's topics as per-section variant overrides (creating a blank-Flagship section
//   when a variant-only heading has no match, since a variant can't own a section the
//   Flagship topic doesn't also have -- see section.overrides in editor.js).
(function () {
  "use strict";

  var HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
  var NUMBERED_RE = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/; // "5.3 Title" or "5.3. Title"

  function headingInfo(hashes, rawTitle) {
    var m = NUMBERED_RE.exec(rawTitle);
    if (m) return { key: m[1], depth: m[1].split(".").length, title: rawTitle };
    return { key: rawTitle.trim().toLowerCase(), depth: hashes.length, title: rawTitle };
  }

  function parse(text) {
    var lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").split("\n");
    var topics = [];
    var warnings = [];
    var curTopic = null, curSection = null, buf = [];

    function flush() {
      var body = buf.join("\n").replace(/^\n+|\n+$/g, "");
      buf = [];
      if (!curSection) {
        if (body.trim()) {
          var snippet = body.trim().slice(0, 60);
          warnings.push('Text before any heading was ignored (not attached to any topic): "' +
            snippet + (body.trim().length > 60 ? "..." : "") + '"');
        }
        return;
      }
      curSection.text = curSection.text ? (curSection.text + "\n\n" + body) : body;
    }
    function openTopic(name, key) {
      flush();
      curTopic = { key: key, name: name.trim() || "Untitled topic", sections: [] };
      topics.push(curTopic);
      curSection = null;
    }
    function openSection(heading, key) {
      flush();
      if (!curTopic) openTopic("Untitled topic", "untitled");
      curSection = { key: key || ("sec" + (curTopic.sections.length + 1)), heading: heading, text: "" };
      curTopic.sections.push(curSection);
    }

    lines.forEach(function (line) {
      var m = HEADING_RE.exec(line);
      if (!m) { buf.push(line); return; }
      var info = headingInfo(m[1], m[2]);
      if (info.depth === 1) {
        openTopic(info.title, info.key);
      } else if (info.depth === 2) {
        openSection(info.title, info.key);
      } else {
        if (!curSection) openSection("", "");
        buf.push(""); buf.push("**" + info.title + "**"); buf.push("");
      }
    });
    flush();

    if (!topics.length) warnings.push("No headings found -- nothing to import.");
    topics.forEach(function (t) {
      if (!t.sections.length) warnings.push('Topic "' + t.name + '" has no sections (no heading found underneath it).');
    });

    return { topics: topics, warnings: warnings };
  }

  // Folds a variant parse's content into baseTopics (Flagship) as section.overrides,
  // matching by the same key algorithm parse() used. A topic/section key present ONLY in
  // the variant creates a new Flagship entry with blank base text (rather than dropping
  // the variant's content) -- Flagship structurally owns every section that exists.
  function mergeVariant(baseTopics, variantParse, variantName) {
    var warnings = [];
    variantParse.topics.forEach(function (vTopic) {
      var bTopic = baseTopics.filter(function (t) { return t.key === vTopic.key; })[0];
      if (!bTopic) {
        bTopic = { key: vTopic.key, name: vTopic.name, sections: [] };
        baseTopics.push(bTopic);
        warnings.push('Topic "' + vTopic.name + '" only exists in the "' + variantName + '" file -- added with blank Flagship content.');
      }
      vTopic.sections.forEach(function (vSec) {
        var bSec = bTopic.sections.filter(function (s) { return s.key === vSec.key; })[0];
        if (!bSec) {
          bSec = { key: vSec.key, heading: vSec.heading, text: "" };
          bTopic.sections.push(bSec);
          warnings.push('Section "' + vSec.heading + '" only exists in the "' + variantName + '" file -- added with blank Flagship content.');
        }
        bSec.overrides = bSec.overrides || {};
        bSec.overrides[variantName] = vSec.text;
      });
    });
    return warnings;
  }

  var MarkdownImport = { parse: parse, mergeVariant: mergeVariant, _pure: { headingInfo: headingInfo } };

  if (typeof window !== "undefined") window.MarkdownImport = MarkdownImport;
  if (typeof module !== "undefined" && module.exports) module.exports = MarkdownImport;
})();
