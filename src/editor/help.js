// editor/help.js -- the user guide, read inside the app (arch-P3b-07).
//
// docs/USER-GUIDE.md is the truth for authors, and this renders it in place: a modal with a table
// of contents built from the guide's own headings, a reading pane, and a deep link so a search
// result lands on its section rather than at the top.
//
// The Markdown renderer is deliberately small. It covers exactly what the guide uses -- headings,
// fenced code, pipe tables, blockquotes, lists, rules, paragraphs, inline bold / code / links --
// and escapes HTML on the way through even though the content is bundled and trusted. A general
// CommonMark parser would be a dependency, and this app has none.
//
// Figures get the care they do because a guide with broken images is worse than one with none: a
// missing file falls back to a visible marker rather than a browser's broken-image glyph, and an
// animated figure swaps to its poster frame under prefers-reduced-motion.
//
// It sat under the `active theme` banner, which is where a Markdown renderer ends up when nothing
// says otherwise. Six names from editor.js, one entry point back.
//
// Editor chrome only: it reads a document that ships with the tool, and touches no course.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "modalHead", "popLayer", "pushLayer", "openFindReplace"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        modalHead = E.modalHead,
        popLayer = E.popLayer,
        pushLayer = E.pushLayer,
        openFindReplace = E.openFindReplace;

    // #81 -- the Help (?) button used to open the guide in a new browser tab, which silently
    // no-ops in the WKWebView desktop shell / file:// context (and a raw .md would not render as a
    // page anyway). The guide opens IN-APP instead: fetch the markdown (the same mechanism the
    // SCORM export uses for local src files) and render it into a modal.
    /* @md-start */
    // Minimal Markdown -> HTML for the in-app Help guide. Trusted, bundled content
    // (docs/USER-GUIDE.md) but HTML-escaped defensively. Covers the guide's subset:
    // headings, fenced code, pipe tables, blockquotes, ordered/unordered lists,
    // horizontal rules, paragraphs, and inline bold / code / links. Deliberately small
    // (no bundler, classic script) — not a general CommonMark parser.
    function mdToHtml(md) {
      function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
      function attr(s) { return esc(s).replace(/"/g, "&quot;"); }
      // #25 figure directive: a whole line that is a markdown image, optionally with a
      // CommonMark "caption" title and a {poster=<path>} attribute for the reduced-motion
      // still of a future motion figure (#28). Kept to the mdToHtml subset (one regex, no
      // vendored parser). src/poster are docs/assets/ paths; missing assets degrade to alt
      // text (see openHelpModal's onerror wiring). group order: alt, src, caption, attrs.
      var FIG_RE = /^!\[([^\]]*)\]\(\s*([^)\s"]+)(?:\s+"([^"]*)")?\s*\)(?:\{([^}]*)\})?\s*$/;
      // a line that begins a new block — a list item's lazy continuation stops here.
      function isBlockStart(s) {
        return /^\s*```/.test(s) || /^#{1,6}\s+/.test(s) || /^\s*>\s?/.test(s)
          || /^\s*[-*]\s+/.test(s) || /^\s*\d+\.\s+/.test(s)
          || /^---+\s*$/.test(s) || /^\*\*\*+\s*$/.test(s) || FIG_RE.test(s);
      }
      function figHtml(m) {
        var alt = m[1] || "", srcPath = m[2] || "", caption = m[3] || "", attrs = m[4] || "";
        var pm = attrs.match(/poster\s*=\s*([^\s}]+)/);
        var poster = pm ? pm[1] : "";
        var img = "<img class=\"doc-figure__img\" src=\"" + attr(srcPath) + "\" alt=\"" + attr(alt) + "\" loading=\"lazy\""
          + (poster ? " data-poster=\"" + attr(poster) + "\"" : "") + ">";
        var cap = caption ? "<figcaption class=\"doc-figure__cap\">" + inline(caption) + "</figcaption>" : "";
        return "<figure class=\"doc-figure\">" + img + cap + "</figure>";
      }
      // uio-O-W1 (OVL-23): a keyboard shortcut written in the guide renders as the SAME chip the
      // menus use, instead of bare glyphs floating in a sentence. Pure text pass, run last: a
      // <code> span always wins the alternation, so a shortcut quoted as code stays code.
      function kbdify(html) {
        return String(html).replace(/(<code\b[^>]*>[\s\S]*?<\/code>)|([⌘⌥⇧⌃]+[A-Za-z0-9=\\−-]?)/g,
          function (_m, codeSpan, chip) { return codeSpan ? codeSpan : "<kbd class=\"help-kbd\">" + chip + "</kbd>"; });
      }
      function inline(s) {
        s = esc(s);
        s = s.replace(/`([^`]+)`/g, function (_m, c) { return "<code>" + c + "</code>"; });
        s = s.replace(/\*\*([^*]+)\*\*/g, function (_m, b) { return "<strong>" + b + "</strong>"; });
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, t, u) { return "<a href=\"" + u + "\" target=\"_blank\" rel=\"noopener\">" + t + "</a>"; });
        return kbdify(s);
      }
      // uio-O-W1 (OVL-23): ONE callout with three tones. A guide callout already leads with its
      // own label ("**Note.**", "**Tip.**", "**Caution.**"), so the tone is read from that label:
      // authors keep writing plain markdown and every callout in the app is drawn one way.
      function calloutTone(text) {
        var m = String(text).match(/^\s*\*\*\s*([^*]+?)\s*\.?\s*\*\*/);
        var w = m ? m[1].trim().toLowerCase() : "";
        if (w === "caution" || w === "warning" || w === "important") return "caution";
        if (w === "tip" || w === "reassurance" || w === "remember" || w === "what you build") return "reassure";
        return "note";
      }
      // #8 heading IDs: slugify heading text so the docs reader's TOC nav can deep-link to a
      // section (ADR 0004 — "guide headings are docs anchors"). Deterministic + unique per doc.
      var seenSlugs = {};
      function slugify(s) {
        var base = String(s).toLowerCase().replace(/`[^`]*`/g, "").replace(/[*_]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
        var slug = base, n = 2;
        while (seenSlugs[slug]) { slug = base + "-" + n; n++; }
        seenSlugs[slug] = true;
        return slug;
      }
      function isTableSep(s) { return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(s); }
      function splitRow(s) { return s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); }); }
      var lines = String(md).replace(/\r\n/g, "\n").split("\n");
      var out = [], i = 0;
      while (i < lines.length) {
        var line = lines[i];
        if (/^\s*```/.test(line)) { // fenced code
          var buf = []; i++;
          while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
          i++; // consume closing fence
          out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
          continue;
        }
        if (/\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) { // pipe table
          var head = splitRow(line); i += 2; var rows = [];
          while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") { rows.push(splitRow(lines[i])); i++; }
          var th = head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("");
          var trs = rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("");
          out.push("<table><thead><tr>" + th + "</tr></thead><tbody>" + trs + "</tbody></table>");
          continue;
        }
        var hd = line.match(/^(#{1,6})\s+(.*)$/);
        if (hd) { var lv = hd[1].length, ht = hd[2].trim(); out.push("<h" + lv + " id=\"" + slugify(ht) + "\">" + inline(ht) + "</h" + lv + ">"); i++; continue; }
        if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
        var fig = line.match(FIG_RE);
        if (fig) { out.push(figHtml(fig)); i++; continue; }
        if (/^\s*>\s?/.test(line)) { // blockquote -> the one help callout, toned by its own label
          var qb = [];
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qb.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
          var qtext = qb.join("\n");
          out.push("<blockquote class=\"help-callout help-callout--" + calloutTone(qtext) + "\">" + mdToHtml(qtext) + "</blockquote>");
          continue;
        }
        if (/^\s*[-*]\s+/.test(line)) { // unordered list (with lazy continuation of wrapped lines)
          var ul = [];
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
            var uitem = lines[i].replace(/^\s*[-*]\s+/, ""); i++;
            while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) { uitem += " " + lines[i].trim(); i++; }
            ul.push("<li>" + inline(uitem) + "</li>");
          }
          out.push("<ul>" + ul.join("") + "</ul>");
          continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) { // ordered list (with lazy continuation of wrapped lines)
          var ol = [];
          while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
            var oitem = lines[i].replace(/^\s*\d+\.\s+/, ""); i++;
            while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) { oitem += " " + lines[i].trim(); i++; }
            ol.push("<li>" + inline(oitem) + "</li>");
          }
          out.push("<ol>" + ol.join("") + "</ol>");
          continue;
        }
        if (line.trim() === "") { i++; continue; }
        var pb = []; // paragraph: gather until a blank line or the next block starts
        while (i < lines.length && lines[i].trim() !== "" &&
          !/^\s*```/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) &&
          !/^\s*>\s?/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
          !/^\s*\d+\.\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) &&
          !FIG_RE.test(lines[i]) &&
          !(/\|/.test(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
          pb.push(lines[i]); i++;
        }
        out.push("<p>" + inline(pb.join(" ")) + "</p>");
      }
      return out.join("\n");
    }
    /* @md-end */
    // #8 docs reader: a two-pane guide (sidebar TOC + search on the left, reading pane on the
    // right), modelled on a professional docs site. The TOC is built from the guide's own
    // heading IDs (mdToHtml emits them), so nav + scroll-spy track the content and never drift.
    // uio-F06: `focusId` is a guide heading slug -- the palette passes one so a guide result lands
    // on its section instead of at the top of the guide.
    function openHelpModal(focusId) {
      if (document.getElementById("help-modal")) return;
      var modal = h("div", "modal-overlay"); modal.id = "help-modal";
      var box = h("div", "modal-box modal-box--docs");
      var head = modalHead(box, "User guide", "Verso — how to build and export a course.");
      var x = h("button", "modal-x"); x.type = "button"; x.setAttribute("aria-label", "Close");
      x.innerHTML = window.Icon ? window.Icon("x") : "×";
      head.appendChild(x);

      var split = h("div", "docs-split");
      var nav = h("aside", "docs-nav");
      // uio-F06 (OVL-21): the guide's own "Search the guide" field is GONE. It was a third search
      // box over a third index, next to the document search and the settings the palette now
      // covers -- and the question people actually ask ("where is the disclaimer setting and how
      // does it work?") needed two of them. Guide sections are in the one Cmd-K index; the TOC
      // stays, because a contents list is navigation, not search.
      var toc = h("nav", "docs-toc");
      nav.appendChild(toc);

      var body = h("div", "help-doc"); body.appendChild(h("p", "help-doc__loading", "Loading the guide…"));
      split.appendChild(nav); split.appendChild(body);
      box.appendChild(split);
      modal.appendChild(box);
      document.body.appendChild(modal);
      // uio-F06: the guide joins the ONE layer stack, so Escape over it closes the topmost layer
      // only and focus returns to whatever opened it.
      function close() { if (!modal.parentNode) return; modal.remove(); popLayer("help"); }
      x.addEventListener("click", close);
      modal.addEventListener("mousedown", function (e) { if (e.target === modal) close(); });
      pushLayer("help", close);

      fetch("docs/USER-GUIDE.md", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (md) {
          body.innerHTML = mdToHtml(md);
          postProcessFigures(body);
          buildDocsNav(body, toc);
          if (focusId) {
            var target = body.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId));
            if (target) scrollToHead(body, target);
          }
        })
        .catch(function () {
          body.innerHTML = "";
          body.appendChild(h("p", null, "The guide could not be loaded in this context. Open docs/USER-GUIDE.md from the app folder in a text editor or browser."));
        });
    }

    // #25/#28 figure post-processing (impure, kept out of the pure renderer): reduced-motion
    // swaps a motion figure to its poster still; a broken asset drops to a caption placeholder.
    function postProcessFigures(body) {
      var reduce = false;
      try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
      var figs = body.querySelectorAll("figure.doc-figure > img.doc-figure__img");
      Array.prototype.forEach.call(figs, function (img) {
        if (reduce && img.getAttribute("data-poster")) { img.src = img.getAttribute("data-poster"); }
        img.addEventListener("error", function () { var fig = img.parentNode; if (fig) fig.classList.add("doc-figure--missing"); });
      });
    }

    // Build the sidebar TOC from the rendered guide's h2/h3 headings and wire click-to-scroll +
    // scroll-spy (the active section follows the reading pane).
    // uio-F06: it no longer returns a search function -- searching the guide is Cmd-K's job now.
    function buildDocsNav(body, toc) {
      var heads = Array.prototype.slice.call(body.querySelectorAll("h2[id], h3[id]"));
      var items = []; // { el(nav button), head, id, level, text }
      heads.forEach(function (hEl) {
        var level = hEl.tagName === "H2" ? 2 : 3;
        var text = hEl.textContent.trim();
        var btn = h("button", "docs-toc__item docs-toc__item--h" + level);
        btn.type = "button"; btn.textContent = text; btn.setAttribute("data-target", hEl.id);
        btn.addEventListener("click", function () { scrollToHead(body, hEl); setActive(hEl.id); });
        toc.appendChild(btn);
        items.push({ el: btn, head: hEl, id: hEl.id, level: level, text: text.toLowerCase() });
      });
      function setActive(id) {
        items.forEach(function (it) { it.el.classList.toggle("is-active", it.id === id); });
        var cur = items.filter(function (it) { return it.id === id; })[0];
        if (cur) cur.el.scrollIntoView({ block: "nearest" });
      }
      // scroll-spy: highlight the topmost heading currently at/above the reading-pane top
      var ticking = false;
      body.addEventListener("scroll", function () {
        if (ticking) return; ticking = true;
        window.requestAnimationFrame(function () {
          ticking = false;
          var top = body.getBoundingClientRect().top, active = items[0];
          for (var k = 0; k < items.length; k++) {
            if (items[k].head.getBoundingClientRect().top - top <= 8) active = items[k]; else break;
          }
          if (active) items.forEach(function (it) { it.el.classList.toggle("is-active", it === active); });
        });
      });
      if (items[0]) items[0].el.classList.add("is-active");
    }
    function scrollToHead(body, hEl) {
      var top = hEl.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTo ? body.scrollTo({ top: Math.max(0, top - 8), behavior: "auto" }) : (body.scrollTop = top - 8);
    }
    (function wireHelp() {
      var b = document.getElementById("help-btn");
      if (b) b.addEventListener("click", openHelpModal);
      var fb = document.getElementById("find-btn");
      if (fb) fb.addEventListener("click", function () { openFindReplace(); });
    })();

    kernel.expose({
      openHelpModal: openHelpModal
    });
  }

  window.VersoHelp = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoHelp;
})();
