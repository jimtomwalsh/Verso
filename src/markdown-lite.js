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

  function renderInline(text) {
    var escaped = escapeHtml(text);
    return escaped.replace(INLINE_RE, function (m, bold, code) {
      if (bold != null) return "<strong>" + bold + "</strong>";
      return '<code class="md-lite-code">' + code + "</code>";
    });
  }

  // Splits raw text into blocks: consecutive "- " lines become one <ul>;
  // other non-blank lines separated by a blank line become one <p> (internal
  // single newlines collapse to a space, matching common markdown-lite feel).
  function render(text) {
    if (text == null || text === "") return "";
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var para = [];
    var list = [];

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

    lines.forEach(function (line) {
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
    });
    flushPara();
    flushList();

    return html.join("");
  }

  var _pure = { escapeHtml: escapeHtml, renderInline: renderInline, render: render };
  var MarkdownLite = { render: render, _pure: _pure };

  if (typeof window !== "undefined") window.MarkdownLite = MarkdownLite;
  if (typeof module !== "undefined" && module.exports) module.exports = MarkdownLite;
})();
