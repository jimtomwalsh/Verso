// markdown-lite.js -- shared render primitive for Product Rail topic content.
//
// product-rail-markdown-lite-content-render. Turns a topic section's stored
// text (bold **like this**, `inline code`, and "- " bullet lists) into HTML,
// so one render path can be reused across every surface that displays topic
// content (Source stage article, Edit stage's Source-panel excerpts, a linked
// instance on a document canvas) instead of each surface re-parsing the text.
//
// DOM-free by design: string in, HTML string out. No editor/render coupling,
// so it's safe to call from chrome (editor.js/ui-kit.js) or from render.js
// once a surface there needs it.
//
// window.MarkdownLite.render(text) -> HTML string
// window.MarkdownLite._pure.*      -> DOM-free logic, guarded in tests/run.js.
(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Bold and inline-code only -- no nesting. Unmatched/unclosed markers (an
  // odd "**" or "`" with no partner) simply never match and pass through as
  // literal escaped text, which is the graceful-degradation behaviour.
  var INLINE_RE = /\*\*([^*]+?)\*\*|`([^`]+?)`/g;
  // A literal <br> (as authors sometimes carry over from a manual-to-markdown
  // conversion, e.g. multi-line table cells) survives escapeHtml as text --
  // recognise the escaped form and turn it back into a real line break. Matches
  // ONLY this one fixed tag, so it can't reopen any other HTML-injection path.
  var ESCAPED_BR_RE = /&lt;br\s*\/?&gt;/gi;

  function renderInline(text) {
    var escaped = escapeHtml(text).replace(ESCAPED_BR_RE, "<br>");
    return escaped.replace(INLINE_RE, function (m, bold, code) {
      if (bold != null) return "<strong>" + bold + "</strong>";
      return '<code class="md-lite-code">' + code + "</code>";
    });
  }

  // GFM-style pipe tables: a header row + a "|---|---|" separator row, then
  // any number of data rows, each "|"-delimited. Cell text renders through the
  // same renderInline as everything else (bold/code/<br> all work in cells).
  function isTableRow(line) {
    return /^\s*\|.*\|\s*$/.test(line);
  }
  function isTableSeparatorRow(line) {
    return /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line);
  }
  function splitTableRow(line) {
    var t = line.trim();
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    return t.split("|").map(function (c) { return c.trim(); });
  }
  function renderTableRows(rows) {
    var thead = "<thead><tr>" + rows[0].map(function (c) { return "<th>" + renderInline(c) + "</th>"; }).join("") + "</tr></thead>";
    var tbody = "<tbody>" + rows.slice(1).map(function (row) {
      return "<tr>" + row.map(function (c) { return "<td>" + renderInline(c) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    return '<table class="md-lite-table">' + thead + tbody + "</table>";
  }

  // Splits raw text into blocks: consecutive "- " lines become one <ul>; a
  // header+separator pipe-row run becomes one <table>; other non-blank lines
  // separated by a blank line become one <p> (internal single newlines
  // collapse to a space, matching common markdown-lite feel).
  function render(text) {
    if (text == null || text === "") return "";
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var para = [];
    var list = [];
    var tableRows = [];
    var inTable = false;

    function flushPara() {
      if (!para.length) return;
      html.push("<p>" + renderInline(para.join(" ")) + "</p>");
      para = [];
    }
    function flushList() {
      if (!list.length) return;
      html.push("<ul>" + list.map(function (item) {
        return "<li>" + renderInline(item) + "</li>";
      }).join("") + "</ul>");
      list = [];
    }
    function flushTable() {
      if (!tableRows.length) return;
      html.push(renderTableRows(tableRows));
      tableRows = [];
      inTable = false;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (inTable) {
        if (isTableRow(line)) { tableRows.push(splitTableRow(line)); continue; }
        flushTable(); // falls through to re-process this (non-table) line below
      }
      if (!inTable && isTableRow(line) && isTableSeparatorRow(lines[i + 1] || "")) {
        flushPara();
        flushList();
        inTable = true;
        tableRows.push(splitTableRow(line));
        i++; // the separator row is structure, not a data row -- consume it
        continue;
      }
      var bullet = /^-\s+(.*)$/.exec(line);
      if (bullet) {
        flushPara();
        list.push(bullet[1]);
      } else if (line.trim() === "") {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
    flushTable();

    return html.join("");
  }

  var _pure = {
    escapeHtml: escapeHtml, renderInline: renderInline, render: render,
    isTableRow: isTableRow, isTableSeparatorRow: isTableSeparatorRow, splitTableRow: splitTableRow
  };
  var MarkdownLite = { render: render, _pure: _pure };

  if (typeof window !== "undefined") window.MarkdownLite = MarkdownLite;
  if (typeof module !== "undefined" && module.exports) module.exports = MarkdownLite;
})();
