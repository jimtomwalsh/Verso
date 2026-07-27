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

  var ORDERED_RE = /^(\d+)\.\s+(.*)$/;

  // Splits raw text into blocks: consecutive "- " lines become one <ul>;
  // consecutive "N. " lines become one <ol start="N"> (N = the run's first
  // number, so a manual's list that doesn't start at 1 stays correct); a
  // header+separator pipe-row run becomes one <table>; other non-blank lines
  // separated by a blank line become one <p> (internal single newlines
  // collapse to a space, matching common markdown-lite feel). A bullet run
  // and a numbered run never merge into each other -- switching marker style
  // flushes the current list first.
  function render(text) {
    if (text == null || text === "") return "";
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var para = [];
    var list = [];
    var listType = null; // "ul" | "ol" | null
    var listStart = null;
    var tableRows = [];
    var inTable = false;

    function flushPara() {
      if (!para.length) return;
      html.push("<p>" + renderInline(para.join(" ")) + "</p>");
      para = [];
    }
    function flushList() {
      if (!list.length) return;
      var items = list.map(function (item) {
        return "<li>" + renderInline(item) + "</li>";
      }).join("");
      if (listType === "ol") {
        html.push('<ol start="' + listStart + '">' + items + "</ol>");
      } else {
        html.push("<ul>" + items + "</ul>");
      }
      list = [];
      listType = null;
      listStart = null;
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
      var ordered = bullet ? null : ORDERED_RE.exec(line);
      if (bullet) {
        if (listType !== "ul") flushList();
        flushPara();
        listType = "ul";
        list.push(bullet[1]);
      } else if (ordered) {
        if (listType !== "ol") flushList();
        flushPara();
        if (listType !== "ol") listStart = parseInt(ordered[1], 10);
        listType = "ol";
        list.push(ordered[2]);
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

  // serialize(rootNode): the reverse of render() -- a real DOM element (the Source-stage
  // contentEditable an author just typed into) in, a markdown-lite string out, so edit
  // mode never stores raw HTML, only the same plain-string dialect render() consumes.
  // Walks children TOLERANTLY: a browser's execCommand output doesn't have to match
  // render()'s own tag choices exactly, so <div> is treated the same as <p> for block
  // boundaries and <b> the same as <strong> for bold. Formatting markdown-lite has no
  // syntax for (italic, underline, links, spans, ...) is dropped to its plain text --
  // the dialect is deliberately minimal (bold/code/lists/tables/br only), matching the
  // same graceful-degradation spirit render() already documents for unmatched markers.
  function serializeInlineNode(node) {
    if (node.nodeType === 3) return node.nodeValue; // Text
    if (node.nodeType !== 1) return "";
    var tag = node.tagName;
    if (tag === "BR") return "<br>";
    if (tag === "STRONG" || tag === "B") return "**" + serializeInline(node) + "**";
    if (tag === "CODE") return "`" + serializeInline(node) + "`";
    return serializeInline(node); // unsupported inline formatting -- keep just the text
  }
  function serializeInline(parent) {
    var out = "";
    Array.prototype.forEach.call(parent.childNodes || [], function (child) { out += serializeInlineNode(child); });
    return out;
  }
  function serializeListItems(listEl) {
    var items = [];
    Array.prototype.forEach.call(listEl.children || [], function (li) {
      if (li.tagName === "LI") items.push(serializeInline(li).trim());
    });
    return items;
  }
  function serializeTable(tableEl) {
    var rows = [];
    Array.prototype.forEach.call(tableEl.querySelectorAll("tr"), function (tr) {
      var cells = [];
      Array.prototype.forEach.call(tr.children, function (cell) { cells.push(serializeInline(cell).trim()); });
      rows.push(cells);
    });
    if (!rows.length) return "";
    var header = "| " + rows[0].join(" | ") + " |";
    var sep = "|" + rows[0].map(function () { return "---"; }).join("|") + "|";
    var body = rows.slice(1).map(function (r) { return "| " + r.join(" | ") + " |"; });
    return [header, sep].concat(body).join("\n");
  }
  function serialize(rootNode) {
    if (!rootNode) return "";
    var blocks = [];
    var run = null; // accumulates stray top-level text/inline nodes into one paragraph
    function flushRun() {
      if (run == null) return;
      var t = run.trim();
      if (t) blocks.push(t);
      run = null;
    }
    Array.prototype.forEach.call(rootNode.childNodes, function (child) {
      if (child.nodeType === 3) { run = (run || "") + child.nodeValue; return; }
      if (child.nodeType !== 1) return;
      var tag = child.tagName;
      if (tag === "UL" || tag === "OL") {
        flushRun();
        var items = serializeListItems(child);
        if (!items.length) return;
        if (tag === "OL") {
          var start = parseInt(child.getAttribute("start") || "1", 10) || 1;
          blocks.push(items.map(function (it, i) { return (start + i) + ". " + it; }).join("\n"));
        } else {
          blocks.push(items.map(function (it) { return "- " + it; }).join("\n"));
        }
        return;
      }
      if (tag === "TABLE") {
        flushRun();
        var t = serializeTable(child);
        if (t) blocks.push(t);
        return;
      }
      if (tag === "P" || tag === "DIV") {
        flushRun();
        var text = serializeInline(child).trim();
        if (text) blocks.push(text);
        return;
      }
      run = (run || "") + serializeInlineNode(child); // stray top-level inline element
    });
    flushRun();
    return blocks.join("\n\n");
  }

  var _pure = {
    escapeHtml: escapeHtml, renderInline: renderInline, render: render,
    isTableRow: isTableRow, isTableSeparatorRow: isTableSeparatorRow, splitTableRow: splitTableRow
  };
  var MarkdownLite = { render: render, serialize: serialize, _pure: _pure };

  if (typeof window !== "undefined") window.MarkdownLite = MarkdownLite;
  if (typeof module !== "undefined" && module.exports) module.exports = MarkdownLite;
})();
