/*
 * render — THE shared render path. The editor mounts this output into canvas
 * frames; the SCORM export (M9) serialises the SAME output per page. Editor and
 * shipped course are literally the same markup (DOM-based, no WYSIWYG mismatch).
 * Pure function of (page/doc, theme): no editor chrome, no side effects.
 *
 * Public entry points:
 *   window.renderPage(page, theme) -> a themed .course-root for ONE page
 *   window.render(doc, theme)      -> convenience: renders doc.pages[0]
 * The editor uses renderPage per page to build the multi-frame canvas (M4); the
 * export loops every page through renderPage the same way.
 *
 * Blocks:
 *   { type:"heading", text }
 *   { type:"paragraph", text }              editable body copy
 *   { type:"note", text }                   muted callout (DIV) with a left accent line
 *   { type:"componentGrid", component, className, instances:[...] }
 *
 * Classic script — exposes window.render + window.renderPage.
 */
(function () {
  "use strict";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // YY: resolve an "asset:<id>" ref to a real src via the host's resolver hook
  // (editor -> objectURL / data: URL; export -> inlined base64). Non-asset
  // strings (http/data/blob URLs, empty) pass straight through. This is the
  // SINGLE seam so EVERY render path resolves uniformly -- unlike wrapping
  // individual call sites, no path (e.g. a single-block re-render) can miss it
  // and emit a raw "asset:<id>" as an <img src> (which renders blank).
  function assetSrc(v) {
    if (typeof v === "string" && v.slice(0, 6) === "asset:" && typeof window.__assetResolver === "function") {
      var r = window.__assetResolver(v.slice(6), v);
      return (r == null) ? v : r;
    }
    return v;
  }
  window.assetSrc = assetSrc;

  // htmlEmbed.html may hold RAW markup (legacy / mid-edit), an "asset:<id>" ref
  // (the heavy interaction lives in AssetStore/IndexedDB, so the doc JSON stays
  // small and localStorage never overflows -- the data-loss bug), or an inlined
  // "data:text/html,<...>" URL (what export bakes in). Normalise all three back to
  // the raw HTML the srcdoc iframe needs. PURE: asset:<id> resolves through the
  // sanctioned assetSrc hook, and the data: decode is a plain string transform.
  function resolveEmbedHtml(v) {
    if (typeof v !== "string" || !v) return "";
    if (v.slice(0, 6) === "asset:") v = assetSrc(v);       // -> data:text/html,... (assetUrl keeps html as data:)
    var m = /^data:text\/html([^,]*),([\s\S]*)$/i.exec(v);
    if (m) {
      try { return /base64/i.test(m[1]) ? decodeURIComponent(escape(atob(m[2]))) : decodeURIComponent(m[2]); }
      catch (_) { try { return atob(m[2]); } catch (_2) { return ""; } }
    }
    // A leftover URL scheme in block.html (a session blob: from old code, an
    // unresolved asset:, an http(s) URL) is NOT recoverable markup -> return ""
    // so the block shows its "paste your HTML" placeholder instead of rendering
    // the URL string as text. Genuine raw HTML never starts with these schemes.
    if (/^(blob:|https?:|asset:|data:)/i.test(v)) return "";
    return v;                                                // genuine raw HTML (legacy inline)
  }
  window.resolveEmbedHtml = resolveEmbedHtml;

  // [MOJIBAKE-REPAIR-START]
  // ---- Mojibake repair: ftfy-style legacy-decode round-trip -----------------------
  // When UTF-8 bytes are decoded through a legacy 1-byte charset the text garbles:
  // an em dash (U+2014 = UTF-8 E2 80 94) shows as `‚Äî` (Mac-Roman) or
  // `â€”` (Windows-1252). Instead of a fixed lookup table (which only
  // covers the handful of sequences we happened to see), we REVERSE the bad decode:
  // re-encode each run of non-ASCII chars back to the bytes that legacy charset would
  // have produced, then decode THOSE bytes as UTF-8. Ships in render.js so both the
  // live editor and the baked SCORM export repair identically (pure-render invariant).
  //
  // Can-never-corrupt-legit-text guarantee: a run is only replaced when (a) EVERY char
  // maps back to a byte in that charset, (b) the bytes form STRICTLY valid UTF-8, and
  // (c) every decoded char is a "sensible" letter/punctuation codepoint (no combining
  // marks / control / CJK). A lone accented letter (e.g. `é`) reverses to a single
  // high byte = invalid UTF-8 -> rejected, so correctly-encoded text is left untouched.
  var MACROMAN = [ // byte 0x80..0xFF -> Unicode codepoint (Apple "Mac OS Roman")
    0x00C4,0x00C5,0x00C7,0x00C9,0x00D1,0x00D6,0x00DC,0x00E1,0x00E0,0x00E2,0x00E4,0x00E3,0x00E5,0x00E7,0x00E9,0x00E8,
    0x00EA,0x00EB,0x00ED,0x00EC,0x00EE,0x00EF,0x00F1,0x00F3,0x00F2,0x00F4,0x00F6,0x00F5,0x00FA,0x00F9,0x00FB,0x00FC,
    0x2020,0x00B0,0x00A2,0x00A3,0x00A7,0x2022,0x00B6,0x00DF,0x00AE,0x00A9,0x2122,0x00B4,0x00A8,0x2260,0x00C6,0x00D8,
    0x221E,0x00B1,0x2264,0x2265,0x00A5,0x00B5,0x2202,0x2211,0x220F,0x03C0,0x222B,0x00AA,0x00BA,0x03A9,0x00E6,0x00F8,
    0x00BF,0x00A1,0x00AC,0x221A,0x0192,0x2248,0x2206,0x00AB,0x00BB,0x2026,0x00A0,0x00C0,0x00C3,0x00D5,0x0152,0x0153,
    0x2013,0x2014,0x201C,0x201D,0x2018,0x2019,0x00F7,0x25CA,0x00FF,0x0178,0x2044,0x20AC,0x2039,0x203A,0xFB01,0xFB02,
    0x2021,0x00B7,0x201A,0x201E,0x2030,0x00C2,0x00CA,0x00C1,0x00CB,0x00C8,0x00CD,0x00CE,0x00CF,0x00CC,0x00D3,0x00D4,
    0xF8FF,0x00D2,0x00DA,0x00DB,0x00D9,0x0131,0x02C6,0x02DC,0x00AF,0x02D8,0x02D9,0x02DA,0x00B8,0x02DD,0x02DB,0x02C7
  ];
  var WIN1252 = [ // 0x80..0x9F special; 0xA0..0xFF = Latin-1 (identity), appended below
    0x20AC,null,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,null,0x017D,null,
    null,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,null,0x017E,0x0178
  ];
  for (var __b = 0xA0; __b <= 0xFF; __b++) WIN1252.push(__b);
  function buildReverse(map) { var r = {}; for (var i = 0; i < map.length; i++) if (map[i] != null) r[map[i]] = 0x80 + i; return r; }
  var REV_MACROMAN = buildReverse(MACROMAN);
  var REV_WIN1252 = buildReverse(WIN1252);
  // A decoded char we accept as a genuine repair (letters + text punctuation only).
  function isSensibleCp(cp) {
    if (cp < 0x80) return true;
    if (cp >= 0x00A0 && cp <= 0x024F) return true; // Latin-1 + Latin Extended-A/B
    if (cp >= 0x2010 && cp <= 0x2027) return true; // dashes, quotes, bullet, ellipsis
    if (cp >= 0x2030 && cp <= 0x205F) return true; // per-mille, primes, fractions
    if (cp >= 0x20A0 && cp <= 0x20CF) return true; // currency (euro)
    if (cp >= 0x2100 && cp <= 0x214F) return true; // letterlike (trademark)
    if (cp >= 0x2190 && cp <= 0x21FF) return true; // arrows
    return false;
  }
  function allSensible(s) { for (var i = 0; i < s.length; i++) if (!isSensibleCp(s.charCodeAt(i))) return false; return true; }
  // Strict UTF-8 decode of a byte array; returns null on ANY invalid/overlong/surrogate.
  function utf8Decode(bytes) {
    var out = "", i = 0, n = bytes.length;
    while (i < n) {
      var b = bytes[i], cp, len;
      if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
      else if ((b & 0xE0) === 0xC0) { cp = b & 0x1F; len = 2; }
      else if ((b & 0xF0) === 0xE0) { cp = b & 0x0F; len = 3; }
      else if ((b & 0xF8) === 0xF0) { cp = b & 0x07; len = 4; }
      else return null;
      if (i + len > n) return null;
      for (var j = 1; j < len; j++) { var c = bytes[i + j]; if ((c & 0xC0) !== 0x80) return null; cp = (cp << 6) | (c & 0x3F); }
      if ((len === 2 && cp < 0x80) || (len === 3 && cp < 0x800) || (len === 4 && cp < 0x10000)) return null; // overlong
      if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return null;
      if (cp > 0xFFFF) { cp -= 0x10000; out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
      else out += String.fromCharCode(cp);
      i += len;
    }
    return out;
  }
  // Re-encode one run of non-ASCII chars through `rev`, decode as UTF-8, accept if valid.
  function undoRun(run, rev) {
    var bytes = [];
    for (var i = 0; i < run.length; i++) { var by = rev[run.charCodeAt(i)]; if (by == null) return run; bytes.push(by); }
    var dec = utf8Decode(bytes);
    return (dec != null && dec !== run && allSensible(dec)) ? dec : run;
  }
  function undoLegacy(s, rev) {
    var out = "", i = 0, n = s.length;
    while (i < n) {
      if (s.charCodeAt(i) < 0x80) { out += s.charAt(i); i++; continue; }
      var j = i; while (j < n && s.charCodeAt(j) >= 0x80) j++;
      out += undoRun(s.slice(i, j), rev); i = j;
    }
    return out;
  }
  function repairMojibake(s) {
    if (typeof s !== "string" || !s || !/[\u0080-\uFFFF]/.test(s)) return s;
    return undoLegacy(undoLegacy(s, REV_MACROMAN), REV_WIN1252); // Mac-Roman first, then Win-1252
  }
  // [MOJIBAKE-REPAIR-END]
  window.__repairMojibake = repairMojibake;

  // Chevron glyph for the footer nav arrows (currentColor -> tracks button text).
  function navArrow(dir) {
    var span = el("span", "course-nav__arrow");
    var d = dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6";
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
    return span;
  }

  // Guided-tour coach-marks (footer nav). Default copy per marker key; an author
  // override lives on block.tour.items[key] ({title,desc}). Pure data -> baked into
  // the emitted DOM, so demo == exported SCORM. See courseNav for the emit site and
  // course.css/.runtime.js for the (learner-only) reveal + interaction.
  var TOUR_DEFAULTS = {
    prev:     { title: "Back",         desc: "Return to the previous page." },
    mode:     { title: "Display",      desc: "Switch between light and dark, and change language where available." },
    menu:     { title: "Menu & tools", desc: "Track your progress and jump between unlocked chapters." },
    glossary: { title: "Dictionary",   desc: "Look up key terms in the course glossary." },
    next:     { title: "Next",         desc: "Continue to the next page." }
  };
  window.VERSO_TOUR_DEFAULTS = TOUR_DEFAULTS; // editor reads these for inspector placeholders
  function tourItemCopy(tour, key) {
    var d = TOUR_DEFAULTS[key] || { title: "", desc: "" };
    var o = (tour && tour.items && tour.items[key]) || {};
    return {
      title: (o.title != null && o.title !== "") ? o.title : d.title,
      desc: (o.desc != null && o.desc !== "") ? o.desc : d.desc
    };
  }
  // One coach-mark: a pulsing dot, a connector, and a title/desc label. Appended as a
  // child of its target footer control so CSS anchors it above that control.
  function tourMarker(block, key) {
    var copy = tourItemCopy(block.tour, key);
    var m = el("span", "course-tour");
    m.setAttribute("data-tour-key", key);
    m.appendChild(el("span", "course-tour__conn"));
    var dot = el("span", "course-tour__dot");
    dot.appendChild(el("span", "course-tour__ring"));
    dot.appendChild(el("span", "course-tour__core"));
    m.appendChild(dot);
    var label = el("span", "course-tour__label");
    var inner = el("span", "course-tour__inner");
    inner.appendChild(stampChrome(el("span", "course-tour__title", copy.title), copy.title));
    inner.appendChild(stampChrome(el("span", "course-tour__desc", copy.desc), copy.desc));
    label.appendChild(inner);
    m.appendChild(label);
    return m;
  }

  // ---- course-completion / exit splash (#111) ------------------------------
  // A branded, theme-styled terminal screen shipped INSIDE the SCORM package so the
  // learner sees OUR farewell on Exit, not the LMS default "you may navigate away"
  // page. Pure render from doc.endScreen (data on the doc) -> editor == export; the
  // learner-only reveal + meta fill live in the export boot script (runtime side).
  // Standard for every course: ON unless the author explicitly turns it off.
  var ENDSCREEN_DEFAULTS = {
    eyebrow:  "Course complete",
    title:    "You're all done",
    body:     "You've reached the end of the course and your progress has been recorded. It's safe to close this window now.",
    footnote: "Your progress has been saved to your learning record."
  };
  window.VERSO_ENDSCREEN_DEFAULTS = ENDSCREEN_DEFAULTS; // editor reads these for inspector placeholders
  function endCopy(es, key) {
    var v = es && es[key];
    return (v != null && String(v).trim() !== "") ? String(v) : ENDSCREEN_DEFAULTS[key];
  }
  // Author opt-out is the ONLY off switch (default on for all courses).
  function endScreenOn(doc) { return !(doc && doc.endScreen && doc.endScreen.on === false); }
  window.endScreenOn = endScreenOn;
  // Pure DOM for the splash. Meta values (modules completed, completed date) are
  // runtime state, so render emits labelled slots (data-end-meta) the boot script
  // fills on show; the structure + copy are identical in the editor demo and export.
  function renderEndScreen(doc) {
    var es = (doc && doc.endScreen) || {};
    // Wrap in a .course-root so theme.css tokens (--color-*, per data-mode) resolve and
    // the runtime's applyMode/applyBp (which stamp every .course-root) theme it too.
    var host = el("div", "course-root course-end-host");
    host.setAttribute("data-course-end", "1");
    // total "modules" = chapters when the course has real chapters, else page count;
    // baked here (pure, from the doc) so the boot script can show "completed / total".
    var chapters = (doc && doc.chapters && doc.chapters.length) || 0;
    var total = chapters > 1 ? chapters : ((doc && doc.pages && doc.pages.length) || 0);
    host.setAttribute("data-modules-total", String(total));
    // Honest "completed" count at runtime: bake a module -> page-id map (order-independent;
    // the boot script counts a module done when every page-id in it was visited). Only when
    // the course has real chapters; a chapterless course falls back to pages-visited.
    if (chapters > 1) {
      var byId = {};
      (doc.pages || []).forEach(function (p) { if (p && p.chapterId != null) { (byId[p.chapterId] = byId[p.chapterId] || []).push(p.id); } });
      var modmap = doc.chapters.map(function (ch) { return byId[ch.id] || []; });
      host.setAttribute("data-modules-map", JSON.stringify(modmap));
    }
    var root = el("div", "course-end");
    var panel = el("div", "course-end__panel");
    var badge = el("div", "course-end__badge");
    badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle class="course-end__badge-ring" cx="12" cy="12" r="10"/><path class="course-end__badge-check" d="M7 12.5l3.2 3.2L17 8.5"/></svg>';
    panel.appendChild(badge);
    panel.appendChild(stampChrome(el("div", "course-end__eyebrow", endCopy(es, "eyebrow")), endCopy(es, "eyebrow")));
    panel.appendChild(stampChrome(el("h1", "course-end__title", endCopy(es, "title")), endCopy(es, "title")));
    panel.appendChild(stampChrome(el("p", "course-end__body", endCopy(es, "body")), endCopy(es, "body")));
    if (es.showMeta === true) { // meta chips OFF by default (James: no dark boxes); author opt-in
      var meta = el("div", "course-end__meta");
      meta.setAttribute("data-end-meta-row", "1");
      function chip(key, label) {
        var c = el("div", "course-end__chip"); c.setAttribute("data-end-chip", key);
        c.appendChild(stampChrome(el("span", "course-end__chip-label", label), label));
        c.appendChild(el("span", "course-end__chip-val", "")); // runtime fills
        return c;
      }
      meta.appendChild(chip("modules", "Modules completed"));
      meta.appendChild(chip("date", "Completed"));
      panel.appendChild(meta);
    }
    panel.appendChild(stampChrome(el("div", "course-end__foot", endCopy(es, "footnote")), endCopy(es, "footnote")));
    root.appendChild(panel);
    host.appendChild(root);
    return host;
  }
  window.renderEndScreen = renderEndScreen;

  // Is this image source vector art (SVG) rather than a raster photo? Drives the
  // AUTO light/dark contrast default: vectors tint, rasters don't. Handles both an
  // uploaded data URL (data:image/svg+xml...) and a plain path/URL ending in .svg.
  function isVectorSrc(src) {
    if (!src || typeof src !== "string") return false;
    if (/^data:image\/svg\+xml/i.test(src)) return true;
    return /\.svg(\?|#|$)/i.test(src);
  }
  window.isVectorSrc = isVectorSrc;

  // ---- SVG palette recolouring (Phase 1 of the dynamic-palette feature) -------
  // An <img src=…svg> is opaque, so a theme token can't reach its colours. When
  // the SVG is an uploaded data URL we INLINE its markup into the DOM instead;
  // inlined, it inherits the course-root's per-mode CSS vars, so mapping a source
  // colour -> a theme token (block.colorMap: { "<sourceColour>": "<tokenKey>" })
  // recolours it in BOTH modes automatically, with NO per-mode upload and no blunt
  // invert. Same detect->map model will drive HTML interactions in Phase 2.
  function decodeSvgDataUrl(src) {
    var m = /^data:image\/svg\+xml([^,]*),([\s\S]*)$/i.exec(src || "");
    if (!m) return null;
    var meta = m[1], data = m[2];
    try {
      if (/base64/i.test(meta)) {
        var bin = atob(data);
        // UTF-8 aware decode so non-ASCII in the SVG survives
        try { return decodeURIComponent(bin.split("").map(function (c) { return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2); }).join("")); }
        catch (_) { return bin; }
      }
      return decodeURIComponent(data);
    } catch (e) { return null; }
  }
  function normColor(c) {
    c = (c == null ? "" : String(c)).trim().toLowerCase();
    if (!c || c === "none" || c === "currentcolor" || c === "transparent" || c === "inherit") return "";
    // ignore url()/gradient refs and var()s — only literal colours are mappable
    if (/^(url\(|var\()/.test(c)) return "";
    return c;
  }
  // distinct literal fill/stroke colours in an SVG markup string (for the mapping UI)
  function detectSvgColors(markup) {
    if (!markup || typeof document === "undefined") return [];
    var box = document.createElement("div");
    box.innerHTML = markup;
    var svg = box.querySelector("svg");
    if (!svg) return [];
    var set = {}, order = [];
    function take(v) { v = normColor(v); if (v && !set[v]) { set[v] = 1; order.push(v); } }
    var nodes = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*")));
    nodes.forEach(function (n) {
      take(n.getAttribute("fill"));
      take(n.getAttribute("stroke"));
      var st = n.getAttribute("style");
      if (st) (st.match(/(?:fill|stroke)\s*:\s*([^;]+)/gi) || []).forEach(function (d) { take(d.split(":")[1]); });
    });
    return order;
  }
  window.detectSvgColors = detectSvgColors;
  // Parse a literal colour to [r,g,b] 0-255 (hex 3/6, rgb(), a few names) or null.
  function parseColor(c) {
    c = normColor(c); if (!c) return null;
    var m;
    if ((m = /^#([0-9a-f]{3})$/.exec(c))) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    if ((m = /^#([0-9a-f]{6})$/.exec(c))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    if ((m = /^rgba?\(([^)]+)\)/.exec(c))) { var p = m[1].split(",").map(parseFloat); return [p[0], p[1], p[2]]; }
    var named = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192] };
    return named[c] || null;
  }
  // Classify a colour by ROLE so the palette can suggest a sensible default token:
  //   near-neutral + light  -> background  -> "surface" (switches per mode)
  //   near-neutral + dark   -> text        -> "ink"     (switches per mode)
  //   near-neutral + mid    -> soft text   -> "inkSoft"
  //   saturated             -> accent      -> KEEP (null): intentional colour that
  //                            already contrasts in both modes (James's exception).
  function colorLum(c) {
    var rgb = parseColor(c); if (!rgb) return null;
    return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  }
  function classifySvgColor(c, bgLum) {
    var rgb = parseColor(c); if (!rgb) return null;
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    var s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
    if (s < 0.18) {
      // POLARITY-AWARE: when the art's own background luminance is known, map by ROLE
      // relative to it -- the background colour -> "surface" (so it tracks the page bg
      // per mode), foreground -> "ink"/"inkSoft" by contrast. This makes a DARK-authored
      // graphic follow light/dark correctly instead of INVERTING (its dark bg used to be
      // read as "ink" by absolute luminance -> light in dark mode / dark in light mode).
      // Falls back to the absolute heuristic when there is no clear background (e.g.
      // transparent art / no full-canvas rect), preserving prior behaviour.
      if (bgLum != null) {
        if (Math.abs(l - bgLum) < 0.15) return { role: "background", token: "bg" };
        return { role: "text", token: Math.abs(l - bgLum) > 0.45 ? "ink" : "inkSoft" };
      }
      if (l > 0.65) return { role: "background", token: "bg" };
      if (l < 0.35) return { role: "text", token: "ink" };
      return { role: "text", token: "inkSoft" };
    }
    return { role: "colour", token: null }; // saturated -> keep
  }
  window.classifySvgColor = classifySvgColor;
  // Resolve a colour to the token it should render as, or null = keep as authored.
  // Explicit block.colorMap wins (a token key, or "keep"); otherwise auto-suggest
  // by role — but ONLY for multi-colour art, so a single-colour logo/icon is left
  // alone (its mono contrast is handled by the Y auto-tint path, not remapped).
  function resolveSvgToken(raw, colorMap, multi, bgLum) {
    var col = normColor(raw); if (!col) return null;
    if (colorMap && Object.prototype.hasOwnProperty.call(colorMap, col)) {
      var v = colorMap[col];
      return (v && v !== "keep") ? v : null;
    }
    if (!multi) return null;
    var c = classifySvgColor(col, bgLum);
    return c ? c.token : null;
  }
  window.resolveSvgToken = resolveSvgToken;
  // convenience for the editor: distinct colours straight from a data-URL SVG src
  window.detectSvgColorsFromSrc = function (src) {
    if (!/^data:image\/svg\+xml/i.test(src || "")) return [];
    var m = decodeSvgDataUrl(src);
    return m ? detectSvgColors(m) : [];
  };
  // theme colour token keys the author can map to (the "palette")
  window.paletteTokens = function () {
    return Object.keys((window.THEME && window.THEME.color) || {});
  };
  // set/replace one declaration in a style-attribute string (no node.style — that
  // path trips SVG-property support gaps; a plain string edit works everywhere).
  function setStyleProp(style, prop, val) {
    var re = new RegExp("(^|;)\\s*" + prop + "\\s*:[^;]*", "i");
    if (re.test(style)) return style.replace(re, "$1" + prop + ":" + val);
    return (style && !/;\s*$/.test(style) ? style + ";" : style) + prop + ":" + val;
  }
  // A colorMap value can be a theme TOKEN key (tracks light/dark) OR a literal colour
  // (#hex / rgb() / hsl()) — the author "switching" a detected SVG colour to a specific
  // fixed colour. A token becomes var(--color-…); a literal is applied as-is.
  function isColorLiteral(v) { return typeof v === "string" && /^(#[0-9a-f]{3}([0-9a-f]{3})?|rgba?\(|hsla?\()/i.test(v.trim()); }
  function toCssColor(tok) { return isColorLiteral(tok) ? tok.trim() : "var(--color-" + kebabToken(tok) + ")"; }
  window.isSvgColorLiteral = isColorLiteral; // headless test hook
  // `resolve(colour)` -> a token key OR a literal colour to map to, or null/"" to keep.
  function recolorNode(node, resolve) {
    if (!node.getAttribute) return;
    var style = node.getAttribute("style") || "";
    // presentation attribute form (fill="#f00") -> move to inline style as token/literal
    ["fill", "stroke"].forEach(function (attr) {
      var tok = resolve(node.getAttribute(attr));
      if (tok) { style = setStyleProp(style, attr, toCssColor(tok)); node.removeAttribute(attr); }
    });
    // inline style form (style="fill:#f00") -> remap literal colours (var()s skipped)
    style = style.replace(/(fill|stroke)\s*:\s*([^;]+)/gi, function (all, prop, val) {
      var tok = resolve(val); return tok ? prop + ":" + toCssColor(tok) : all;
    });
    if (style) node.setAttribute("style", style);
  }
  // The art's OWN background colour = fill of the largest full-canvas rect (a near
  // universal pattern in authored infographics). Its luminance lets the colour->token
  // mapper tell a dark-authored graphic from a light one and map either background to
  // "surface". null = no clear background (fall back to the absolute heuristic).
  // The art's OWN full-canvas background FILL (largest full-canvas rect), or null.
  function svgBgFill(svg) {
    // Canvas size: viewBox first, else the svg's own width/height attributes. Having a
    // non-viewBox fallback is what lets a `<rect width="100%" height="100%">` on a
    // viewBox-less svg resolve to full-bleed (previously it measured 0 -> undetected ->
    // the neutral background wrongly fell through to the ink token = inverted in dark).
    var vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(parseFloat);
    var W = vb.length === 4 ? vb[2] : (parseFloat(svg.getAttribute("width")) || 0);
    var H = vb.length === 4 ? vb[3] : (parseFloat(svg.getAttribute("height")) || 0);
    var canvasArea = W * H;
    function fillOf(el) {
      var f = el.getAttribute("fill");
      if (!f) { var m = /fill\s*:\s*([^;]+)/i.exec(el.getAttribute("style") || ""); if (m) f = m[1].trim(); }
      return f;
    }
    function pct(v, full) { if (v == null) return 0; return /%\s*$/.test(v) ? parseFloat(v) / 100 * full : parseFloat(v); }
    function nums(s) { return (String(s).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(parseFloat); }
    var best = null, bestArea = 0;
    // A full-canvas background = a neutral/coloured shape that covers >=50% of the
    // canvas AND is anchored at/near the origin (so a big CENTRED chart element is not
    // mistaken for the background). Colour-agnostic + shape-agnostic: rect via its
    // attributes, path/polygon via the bbox of their coordinate numbers.
    function consider(fill, x, y, w, h) {
      if (!normColor(fill)) return;
      if (!(w > 0 && h > 0)) return;
      if (canvasArea) { if (w * h < canvasArea * 0.5) return; if (x > W * 0.1 || y > H * 0.1) return; }
      var area = w * h;
      if (area > bestArea) { bestArea = area; best = fill; }
    }
    Array.prototype.forEach.call(svg.querySelectorAll("rect"), function (r) {
      var wRaw = r.getAttribute("width"), hRaw = r.getAttribute("height");
      if (wRaw == null || hRaw == null) return;
      var w = pct(wRaw, W), h = pct(hRaw, H);
      // width/height="100%" on a canvas of unknown size is still a full-bleed bg.
      if (!(w > 0) && /%/.test(wRaw)) w = W || 1;
      if (!(h > 0) && /%/.test(hRaw)) h = H || 1;
      consider(fillOf(r), pct(r.getAttribute("x") || "0", W), pct(r.getAttribute("y") || "0", H), w, h);
    });
    // path / polygon backgrounds: bound by their coordinate numbers. Exact for absolute
    // coords (the usual full-canvas rectangle-as-path); approximate for relative paths,
    // but a full-bleed bg still spans ~0..W / 0..H so it is still caught.
    Array.prototype.forEach.call(svg.querySelectorAll("path,polygon,polyline"), function (p) {
      var d = p.getAttribute("d") || p.getAttribute("points"); if (!d) return;
      var ns = nums(d); if (ns.length < 4) return;
      var xs = [], ys = [];
      for (var i = 0; i + 1 < ns.length; i += 2) { xs.push(ns[i]); ys.push(ns[i + 1]); }
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      consider(fillOf(p), minX, minY, maxX - minX, maxY - minY);
    });
    return best;
  }
  function svgBgLum(svg) { var f = svgBgFill(svg); return f != null ? colorLum(f) : null; }
  // Is a colour a NEUTRAL (near-greyscale) that should track the ink/bg tokens? A saturated
  // brand colour returns false (keep it as authored).
  function isNeutralColor(c) {
    var rgb = parseColor(c); if (!rgb) return false;
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    var s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
    return s < 0.18;
  }
  // The full-canvas BACKGROUND element(s) of an SVG, found GEOMETRICALLY (getBBox)
  // rather than by parsing width/height attributes -- so it works no matter how the
  // background is declared (a rect sized via CSS/style, a transformed shape, a path or
  // polygon, %-dims, no viewBox). getBBox measures the real rendered geometry; we only
  // require a REMAPPABLE inline literal fill (recolour can't touch class/gradient fills
  // anyway). This is what mono uses so a glossary background can NEVER be mistaken for
  // ink content -> it stops the "opposing background per mode" inversion at the source.
  // Falls back to attribute geometry when getBBox is unavailable (headless/detached).
  function fullCanvasBgEls(svg) {
    var vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(parseFloat);
    var W = vb.length === 4 ? vb[2] : (parseFloat(svg.getAttribute("width")) || 0);
    var H = vb.length === 4 ? vb[3] : (parseFloat(svg.getAttribute("height")) || 0);
    function rawFill(el) {
      var f = el.getAttribute("fill");
      if (!f) { var m = /fill\s*:\s*([^;]+)/i.exec(el.getAttribute("style") || ""); if (m) f = m[1].trim(); }
      return f;
    }
    function pct(v, full) { if (v == null) return 0; return /%\s*$/.test(v) ? parseFloat(v) / 100 * full : parseFloat(v); }
    function nums(s) { return (String(s).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(parseFloat); }
    // measure via getBBox when we can (attach offscreen if the svg isn't in the DOM yet)
    var canMeasure = typeof document !== "undefined" && document.body && typeof svg.getBBox === "function";
    var host = null;
    if (canMeasure && !svg.isConnected) {
      host = document.createElement("div");
      host.setAttribute("style", "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;opacity:0");
      if (W > 0 && H > 0) { if (!svg.getAttribute("width")) svg.setAttribute("width", W); if (!svg.getAttribute("height")) svg.setAttribute("height", H); }
      document.body.appendChild(host); host.appendChild(svg);
    }
    // canvas area: viewBox/attrs, or (measured) the svg's own content bbox as a proxy
    var canvasArea = W * H;
    if (!canvasArea && canMeasure) { try { var rb = svg.getBBox(); if (rb.width > 0 && rb.height > 0) { W = rb.width; H = rb.height; canvasArea = W * H; } } catch (e) {} }
    var out = [];
    Array.prototype.forEach.call(svg.querySelectorAll("rect,path,polygon,polyline,circle,ellipse"), function (el) {
      if (!normColor(rawFill(el))) return; // only remappable inline literal fills
      var x = 0, y = 0, w = 0, h = 0, ok = false;
      if (canMeasure) { try { var bb = el.getBBox(); x = bb.x; y = bb.y; w = bb.width; h = bb.height; ok = (w > 0 && h > 0); } catch (e) {} }
      if (!ok) { // attribute-geometry fallback
        if (el.tagName === "rect") {
          var wRaw = el.getAttribute("width"), hRaw = el.getAttribute("height");
          if (wRaw == null || hRaw == null) return;
          w = pct(wRaw, W); h = pct(hRaw, H);
          if (!(w > 0) && /%/.test(wRaw)) w = W || 1;
          if (!(h > 0) && /%/.test(hRaw)) h = H || 1;
          x = pct(el.getAttribute("x") || "0", W); y = pct(el.getAttribute("y") || "0", H);
        } else {
          var d = el.getAttribute("d") || el.getAttribute("points"); if (!d) return;
          var ns = nums(d); if (ns.length < 4) return;
          var xs = [], ys = []; for (var i = 0; i + 1 < ns.length; i += 2) { xs.push(ns[i]); ys.push(ns[i + 1]); }
          x = Math.min.apply(null, xs); y = Math.min.apply(null, ys);
          w = Math.max.apply(null, xs) - x; h = Math.max.apply(null, ys) - y;
        }
        ok = (w > 0 && h > 0);
      }
      if (!ok) return;
      // full-canvas = covers >=50% of the canvas AND anchored near the origin (so a big
      // CENTRED graphic is not mistaken for the background).
      if (canvasArea) { if (w * h < canvasArea * 0.5) return; if (x > W * 0.1 + 1 || y > H * 0.1 + 1) return; }
      out.push(el);
    });
    if (host) { host.removeChild(svg); document.body.removeChild(host); }
    return out;
  }

  // Memoised SVG-inline cache. Big inline SVGs are thousands of live vector nodes, and
  // re-parsing + re-sanitising + re-recolouring one on EVERY render/reapplyPage is what
  // makes an SVG-heavy course sluggish (#150). We decode+detect each asset once, then
  // build one recoloured <svg> "template" per (mono, colorMap) variant and hand callers
  // a cloneNode(true) of it (clone is O(nodes) DOM copy, far cheaper than a full parse
  // + two descendant walks + a second detectSvgColors pass). Keyed on block.src: for the
  // common "asset:<id>" ref the id IS a content hash (immutable), and for a legacy inline
  // data: URL the key is the content itself, so the key already captures identity -- no
  // stale-content risk. SVG bases are NOT hot-swapped by the #148 version cycle (only the
  // raster <img> is), so a variant preview never invalidates this. Output is theme-
  // independent (recolorNode emits var(--color-*)), so the cache survives light/dark too.
  var _svgMemo = new Map();
  function svgMemoFor(block) {
    var src = assetSrc(block.src);
    if (!/^data:image\/svg\+xml/i.test(src || "")) return null;
    var key = block.src;
    var rec = _svgMemo.get(key);
    if (!rec) {
      var markup = decodeSvgDataUrl(src);
      if (!markup) return null;
      rec = { markup: markup, colors: detectSvgColors(markup), entries: Object.create(null) };
      _svgMemo.set(key, rec);
      if (_svgMemo.size > 96) { var oldest = _svgMemo.keys().next().value; if (oldest !== key) _svgMemo.delete(oldest); }
    }
    return rec;
  }
  // Distinct-colour count for a block's SVG, from the shared memo (no extra parse). Lets
  // the image path decide "recoloured?" without a redundant detectSvgColorsFromSrc decode.
  window.__svgColorCount = function (block) { var rec = svgMemoFor(block); return rec ? rec.colors.length : 0; };

  // Inline an uploaded data-URL SVG as a live <svg>, applying the colour->token map.
  // Returns the <svg> element, or null if the source isn't an inlinable data-URL SVG.
  function inlineSvg(block) {
    var rec = svgMemoFor(block);
    if (!rec) return null;
    var vkey = (block.mono ? "m" : "-") + "|" + JSON.stringify(block.colorMap || {});
    var tmpl = rec.entries[vkey];
    if (tmpl === undefined) { tmpl = buildInlineSvg(block, rec.markup, rec.colors); rec.entries[vkey] = tmpl; }
    return tmpl ? tmpl.cloneNode(true) : null;
  }
  window.inlineSvg = inlineSvg;

  // Build the recoloured <svg> template for a block from pre-decoded markup + the
  // already-detected colour list (both from svgMemoFor). This is the expensive part
  // that the memo runs at most once per (asset, mono, colorMap) variant.
  function buildInlineSvg(block, markup, colors) {
    var box = document.createElement("div");
    box.innerHTML = markup;
    var svg = box.querySelector("svg");
    if (!svg) return null;
    // defensive: drop any <script>/on* from author-supplied SVG markup before it
    // enters the editor DOM and the exported package.
    Array.prototype.forEach.call(svg.querySelectorAll("script"), function (s) { s.parentNode && s.parentNode.removeChild(s); });
    Array.prototype.forEach.call([svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*"))), function (n) {
      if (!n.attributes) return;
      Array.prototype.slice.call(n.attributes).forEach(function (a) { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
    });
    // Multi-colour art auto-suggests role tokens (bg->surface, text->ink, saturated
    // ->keep); a single-colour asset is left to the auto-tint path. Explicit
    // block.colorMap entries override the suggestion (a token, or "keep").
    var map = block.colorMap || {};
    var multi = colors.length > 1;               // pre-detected in svgMemoFor (no 2nd parse)
    var bgLum = svgBgLum(svg);
    var resolve;
    if (block.mono) {
      // Deterministic mono recolour (glossary): FORCE every neutral colour to the ink
      // token and the detected full-canvas background to the bg token, IGNORING the
      // asset's own polarity. This can't invert against the mode the way the absolute-
      // luminance guess can -- ink is always white in dark / dark in light, on the bg
      // card -- so mono line-art tracks light/dark regardless of how it was authored.
      // Saturated brand colours are kept; an explicit colorMap entry still wins.
      // Paint the GEOMETRICALLY-detected full-canvas background element(s) with the bg
      // token DIRECTLY (not by colour-matching, which repeatedly missed real assets and
      // let the background fall through to ink = the "opposing background per mode" bug).
      // Once painted with var(--color-bg) their fill is a var() so the generic recolour
      // loop below skips them; everything else neutral -> ink, saturated -> kept.
      fullCanvasBgEls(svg).forEach(function (el) {
        if (map) { var rf = normColor(el.getAttribute("fill") || (/fill\s*:\s*([^;]+)/i.exec(el.getAttribute("style") || "") || [])[1]); if (rf && Object.prototype.hasOwnProperty.call(map, rf)) return; } // explicit colorMap wins
        el.removeAttribute("fill");
        el.setAttribute("style", setStyleProp(el.getAttribute("style") || "", "fill", toCssColor("bg")));
      });
      resolve = function (raw) {
        var col = normColor(raw); if (!col) return null;
        if (map && Object.prototype.hasOwnProperty.call(map, col)) { var v = map[col]; return (v && v !== "keep") ? v : null; }
        return isNeutralColor(col) ? "ink" : null;     // neutral -> ink (tracks mode); saturated -> keep
      };
    } else {
      resolve = function (raw) { return resolveSvgToken(raw, map, multi, bgLum); };
    }
    [svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*"))).forEach(function (n) { recolorNode(n, resolve); });
    return svg;
  }

  // Custom hotspot marker: inline an uploaded SVG (incl. animated SMIL/CSS SVG)
  // AS-AUTHORED — no theme-token recolour, so the animation keeps its own colours.
  // The "green when viewed" recolour is CSS-only (.hotspot-marker--custom.is-viewed),
  // so render stays PURE + unviewed-first. Sanitised like inlineSvg (drop script/on*).
  function markerPaintOf(n, prop) {
    var v = n.getAttribute && n.getAttribute(prop);
    if (!v) { var st = (n.getAttribute && n.getAttribute("style")) || ""; var m = new RegExp(prop + "\\s*:\\s*([^;]+)").exec(st); if (m) v = m[1].trim(); }
    return v;
  }
  function markerAddClass(n, c) {
    if (!n.getAttribute) return;
    var cur = n.getAttribute("class") || "";
    if ((" " + cur + " ").indexOf(" " + c + " ") === -1) n.setAttribute("class", (cur ? cur + " " : "") + c);
  }
  function markerSvgNode(ref) {
    var src = assetSrc(ref);
    if (!/^data:image\/svg\+xml/i.test(src || "")) return null;
    var markup = decodeSvgDataUrl(src);
    if (!markup) return null;
    var box = document.createElement("div");
    box.innerHTML = markup;
    var svg = box.querySelector("svg");
    if (!svg) return null;
    Array.prototype.forEach.call(svg.querySelectorAll("script"), function (s) { s.parentNode && s.parentNode.removeChild(s); });
    // Marker artwork must sit TRANSPARENT over the course image: many exported "animated
    // SVG" icons bake a full-canvas backplate rect (usually white) behind the art, which
    // paints a solid box around the marker (a painted <rect> is not a CSS background, so
    // no stylesheet reset can touch it). Geometrically detect the full-canvas background
    // element(s) and, when the fill is NEUTRAL (white/grey/black backplate), drop the paint
    // so the page shows through. A SATURATED full-bleed shape (e.g. the coloured disc that
    // IS the marker) is left intact — isNeutralColor excludes it.
    fullCanvasBgEls(svg).forEach(function (el) {
      var f = markerPaintOf(el, "fill");
      if (!f || !isNeutralColor(f)) return;
      el.setAttribute("fill", "none");
      var st = el.getAttribute("style");
      if (st && /fill\s*:/i.test(st)) el.setAttribute("style", st.replace(/fill\s*:[^;]*;?/gi, "").trim());
    });
    Array.prototype.forEach.call([svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*"))), function (n) {
      if (!n.attributes) return;
      Array.prototype.slice.call(n.attributes).forEach(function (a) { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
      // Tag only the KEY (saturated) paints so the viewed recolour turns those green
      // while white/grey/black stay -> matches the HTML-marker behaviour. Unparseable
      // paints (e.g. var(...)) default to "key" so var-driven accents still recolour.
      var f = markerPaintOf(n, "fill");
      if (f && f !== "none" && f !== "transparent" && !isNeutralColor(f)) markerAddClass(n, "hs-key-fill");
      var s = markerPaintOf(n, "stroke");
      if (s && s !== "none" && s !== "transparent" && !isNeutralColor(s)) markerAddClass(n, "hs-key-stroke");
    });
    return svg;
  }
  window.markerSvgNode = markerSvgNode;

  // Strip active/external content from an HTML-animation marker before it enters a
  // srcdoc iframe: no <script> (incl. the React "tweaks" dev-panel authors leave in),
  // no external <link>, no on* handlers. Pure string transform (runs in node tests);
  // the sandbox="allow-same-origin" (NO allow-scripts) is the belt to this braces, and
  // keeps the exported SCORM air-gap + CSP safe (no network fetch, no JS execution).
  function sanitizeMarkerHtml(html) {
    if (typeof html !== "string") return "";
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<script\b[^>]*\/>/gi, "")
      .replace(/<link\b[^>]*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
      .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  }
  window.sanitizeMarkerHtml = sanitizeMarkerHtml;

  // Build the final srcdoc for an HTML-animation marker: sanitise, then force the
  // frame transparent. Authored animations (esp. tool-exported animated SVGs) often
  // ship an opaque html/body/svg background, which paints a white box behind the icon
  // over the course art. A reset stylesheet APPENDED last wins the cascade (last
  // !important of equal specificity wins), neutralising author background without
  // touching the icon's own paints. Pure string transform (runs in node tests).
  function markerSrcdoc(html) {
    var clean = sanitizeMarkerHtml(html);
    if (!clean) return "";
    return clean + '<style>html,body{background:transparent !important;margin:0 !important;padding:0 !important}'
      + 'svg{background:transparent !important}</style>';
  }
  window.markerSrcdoc = markerSrcdoc;

  // Build ONE hotspot marker element exactly as the learner sees it (colour, box/point, glyph/
  // SVG/animation, size). Shared by the course renderer (renderMarkers) AND the editor's tour
  // board, so the design-phase marker is pixel-identical to the final (WYSIWYG). Returns the
  // <button.hotspot-marker> positioned at its x/y%; the caller owns append + popover + gating.
  function hotspotMarkerEl(block, hs, i, loopById) {
    loopById = loopById || {};
    var mk = el("button", "hotspot-marker");
    mk.type = "button";
    mk.setAttribute("data-hotspot", hs.id);
    mk.setAttribute("data-action", hs.action === "navigate" ? "navigate" : "card");
    if (hs.action === "navigate" && hs.target) mk.setAttribute("data-target", hs.target);
    mk.setAttribute("aria-label", hs.label || ((hs.action === "navigate" ? "Go to screen " : "Open hotspot ") + (i + 1)));
    if (hs.label) mk.title = hs.label;
    mk.style.left = (hs.x == null ? 50 : hs.x) + "%";
    mk.style.top = (hs.y == null ? 50 : hs.y) + "%";
    if (block.markerColor) mk.style.setProperty("--hotspot-color", block.markerColor);
    if (block.markerSize) mk.style.setProperty("--hotspot-size", block.markerSize + "px");
    if (block.viewedColor) mk.style.setProperty("--hotspot-viewed", block.viewedColor);
    if (hs.shape === "box") {
      mk.classList.add("hotspot-marker--box");
      mk.style.width = (hs.w == null ? 20 : hs.w) + "%";
      mk.style.height = (hs.h == null ? 12 : hs.h) + "%";
    } else if (block.markerHtml) {
      mk.classList.add("hotspot-marker--custom", "hotspot-marker--embed");
      var fr = document.createElement("iframe");
      fr.className = "hotspot-marker__frame";
      fr.setAttribute("sandbox", "allow-same-origin");
      fr.setAttribute("scrolling", "no");
      fr.setAttribute("tabindex", "-1");
      fr.setAttribute("aria-hidden", "true");
      fr.setAttribute("title", hs.label || "marker animation");
      fr.setAttribute("srcdoc", markerSrcdoc(block.markerHtml));
      mk.appendChild(fr);
    } else {
      var mSvg = block.markerSvg ? markerSvgNode(block.markerSvg) : null;
      if (mSvg) {
        mk.classList.add("hotspot-marker--custom");
        mSvg.setAttribute("class", "hotspot-marker__svg");
        mk.appendChild(mSvg);
      } else if (hs.action === "navigate" && hs.target && loopById[hs.target]) {
        mk.classList.add("hotspot-marker--loop");
        var lg = el("span", "hotspot-marker__glyph hotspot-marker__glyph--loop");
        lg.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>';
        mk.appendChild(lg);
      } else {
        mk.appendChild(el("span", "hotspot-marker__glyph", "i"));
      }
    }
    return mk;
  }
  window.hotspotMarkerEl = hotspotMarkerEl;

  // Editable text bound to obj[field]. data-edit = queryable marker; live __bind
  // = write path into the model. Neither serialises into shipped HTML.
  // Font choices (Exo 2 + Inter are web-loaded; rest are system).
  var FONT_STACKS = {
    "Exo 2": "'Exo 2', sans-serif",
    "Inter": "'Inter', sans-serif",
    "System": "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    "Arial": "Arial, Helvetica, sans-serif",
    "Georgia": "Georgia, 'Times New Roman', serif",
    "Courier": "'Courier New', ui-monospace, monospace"
  };
  window.FONT_LIST = Object.keys(FONT_STACKS);
  // The safe/embeddable set: the web-loaded + bundled families that render.js has
  // a stack for and that export can bundle. The editor pins these atop the fuller
  // system-font list and flags any picked font that is NOT one of them (may not
  // render on an offline/air-gapped target unless embedded at export). Does not
  // affect render output -- pure metadata for the picker.
  // KKK: the AIR-GAP-SAFE set = fonts that will actually render in an offline
  // Moodle. Exo 2 is BUNDLED + embedded at export; System/Georgia/Courier are
  // ubiquitous system fonts (no embedding needed). Inter is a web font that is
  // NOT bundled, so a course using it falls back offline -- exclude it so the
  // picker + the export check correctly flag it.
  window.EMBEDDABLE_FONTS = ["Exo 2", "System", "Arial", "Georgia", "Courier"];
  // The CSS font stack for a family name (a known stack, or the family quoted as-is so an
  // embedded/system/added font renders by name). Used by the editor's preview font picker.
  window.fontStackFor = function (name) { return name ? (FONT_STACKS[name] || ("'" + name + "', sans-serif")) : ""; };
  // Reverse of fontStackFor: a stored CSS stack (as lives on doc.theme.font.*) -> the
  // FONT_LIST name to preselect in the picker (#125 full-token theme editing). Matches an
  // exact known stack, else the first quoted family, else passes a custom/uploaded family
  // name through as-is. "" when nothing resolves (picker shows Default). Pure + unit-guarded.
  window.fontNameFromStack = function (stack) {
    if (!stack) return "";
    var s = String(stack).trim();
    var names = Object.keys(FONT_STACKS);
    for (var i = 0; i < names.length; i++) { if (FONT_STACKS[names[i]] === s) return names[i]; }
    var first = s.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    for (var j = 0; j < names.length; j++) { if (names[j] === first) return names[j]; }
    return FONT_STACKS[first] == null ? first : "";
  };

  // Block-level text style (inline), applied as inline styles on the editable
  // element. Empty/absent props fall back to the component CSS. Clears-then-sets
  // so removing a prop reverts to the default.
  function applyTextStyle(node, s) {
    s = s || {};
    node.style.fontFamily = s.font ? (FONT_STACKS[s.font] || s.font) : "";
    node.style.fontSize = s.size ? s.size + "px" : "";
    node.style.fontWeight = s.weight || "";
    node.style.fontStyle = s.italic ? "italic" : "";
    node.style.textAlign = s.align || "";
    // colour: a theme TOKEN (s.colorToken, e.g. "ink"/"accent") emits var(--color-<t>) so it
    // flips with the learner's light/dark mode automatically; PER-MODE (s.colorLight/colorDark)
    // sets both as node vars + color:var(--tc-c), which course.css switches by data-mode; a raw
    // hex (s.color) stays fixed in both. Priority: token > per-mode > hex. Clears-then-sets.
    if (node.style.removeProperty) { node.style.removeProperty("--tc-light"); node.style.removeProperty("--tc-dark"); }
    if (s.colorToken) node.style.color = "var(--color-" + s.colorToken + ")";
    else if (s.colorLight || s.colorDark) {
      if (node.style.setProperty) {
        node.style.setProperty("--tc-light", s.colorLight || s.colorDark);
        node.style.setProperty("--tc-dark", s.colorDark || s.colorLight);
      }
      node.style.color = "var(--tc-c)";
    } else node.style.color = s.color || "";
    node.style.lineHeight = s.lineHeight || "";
    node.style.letterSpacing = (s.letterSpacing != null && s.letterSpacing !== "") ? s.letterSpacing + "px" : "";
    node.style.wordSpacing = (s.wordSpacing != null && s.wordSpacing !== "") ? s.wordSpacing + "px" : "";
    // MM: InDesign-level options. Case = text-transform; Indent = first-line text-indent (px).
    node.style.textTransform = s.textTransform || "";
    node.style.textIndent = (s.textIndent != null && s.textIndent !== "") ? s.textIndent + "px" : "";
  }
  window.applyTextStyle = applyTextStyle;
  // LLL: a text block can REFERENCE a named style (obj.styleRef) instead of copying
  // it. The named style resolves at render from window.__docStyles (set per pass by
  // the consumer, like __navSections), with per-block obj.style as OVERRIDES that
  // win. So editing the named style live-updates every referencing block on re-mount
  // (reference, not copy). No styleRef -> unchanged (obj.style path).
  function resolveBlockStyle(obj) {
    var named = obj && obj.styleRef && window.__docStyles && window.__docStyles[obj.styleRef];
    if (!named) return (obj && obj.style) || null;
    var merged = Object.assign({}, named, (obj && obj.style) || {});
    // colour precedence: a per-block override of ONE colour form beats the named style's
    // OTHER form (a raw-hex override wins over the style's token, and vice versa) so the
    // two forms never both apply on the same block.
    var ov = (obj && obj.style) || {};
    if (ov.color != null && ov.color !== "") delete merged.colorToken;
    else if (ov.colorToken) delete merged.color;
    return merged;
  }
  window.resolveBlockStyle = resolveBlockStyle;

  // #120 inline styles (1/4): apply a named style to an INLINE host (a span). Unlike
  // the block-level applyTextStyle this uses the TEXT-ONLY subset -- colour, font,
  // weight, size, italic, letter/word-spacing, transform, decoration -- and DROPS
  // every layout prop (align / line-height / indent / margin / padding / display),
  // which only make sense on the whole block. Clears-then-sets each prop it owns so an
  // empty value INHERITS from the block-level style (the cascade #120 requires: a span
  // overrides only what it specifies, inheriting the rest from the block styleRef).
  /* @inline-style-start */
  function applyInlineTextStyle(node, s) {
    s = s || {};
    node.style.fontFamily = s.font ? (FONT_STACKS[s.font] || s.font) : "";
    node.style.fontSize = s.size ? s.size + "px" : "";
    node.style.fontWeight = s.weight || "";
    node.style.fontStyle = s.italic ? "italic" : "";
    // colour: identical precedence to applyTextStyle (token > per-mode > hex), so an
    // inline span flips light/dark exactly like a block does.
    if (node.style.removeProperty) { node.style.removeProperty("--tc-light"); node.style.removeProperty("--tc-dark"); }
    if (s.colorToken) node.style.color = "var(--color-" + s.colorToken + ")";
    else if (s.colorLight || s.colorDark) {
      if (node.style.setProperty) {
        node.style.setProperty("--tc-light", s.colorLight || s.colorDark);
        node.style.setProperty("--tc-dark", s.colorDark || s.colorLight);
      }
      node.style.color = "var(--tc-c)";
    } else node.style.color = s.color || "";
    node.style.letterSpacing = (s.letterSpacing != null && s.letterSpacing !== "") ? s.letterSpacing + "px" : "";
    node.style.wordSpacing = (s.wordSpacing != null && s.wordSpacing !== "") ? s.wordSpacing + "px" : "";
    node.style.textTransform = s.textTransform || "";
    node.style.textDecoration = s.textDecoration || "";
    // Deliberately NOT set: textAlign, lineHeight, textIndent, margin, padding, display.
  }
  // #120: resolve every `<span data-style-ref="Name">` inside a rendered rich field to
  // its named style (from __docStyles, the same per-pass hook block styleRef uses -> so
  // editor == export). BY REFERENCE: editing the named style repaints the span on the
  // next mount. Unknown / empty ref -> left untouched (inherits the block style). Pure:
  // reads only the doc's HTML string + __docStyles, never editor state.
  function resolveInlineStyles(node) {
    if (!node || !node.querySelectorAll) return;
    var styles = window.__docStyles;
    if (!styles) return;
    var spans = node.querySelectorAll("span[data-style-ref]");
    for (var i = 0; i < spans.length; i++) {
      var ref = spans[i].getAttribute("data-style-ref");
      var named = ref && styles[ref];
      if (named) applyInlineTextStyle(spans[i], named);
    }
  }
  /* @inline-style-end */
  window.applyInlineTextStyle = applyInlineTextStyle;
  window.resolveInlineStyles = resolveInlineStyles;

  // ---- learner light/dark: HTML-interaction theme shim (Item Z) -------------
  // HTML-interaction iframes (htmlEmbed) are same-origin (srcdoc / bundled local)
  // but don't follow the course theme on a mode flip. This shim is baked into each
  // srcdoc interaction (and injected by the parent into bundled-file ones). On a
  // {type:"theme"} postMessage it:
  //   1. sets the course --color-* custom properties on its own :root, so an
  //      interaction that OPTS IN (reads those vars) recolours automatically;
  //   2. stamps data-mode on <html>/<body>;
  //   3. applies a per-interaction visual FALLBACK for interactions that don't opt
  //      in. The mode is author-chosen per block via data-theme-fallback ->
  //      message.fallback:
  //        "tokens" (DEFAULT, conservative): nudge html/body bg+text to the mode
  //                 tokens — never wrecks an interaction that colours itself.
  //        "invert" (OPT-IN, aggressive): filter:invert the whole doc in dark,
  //                 re-inverting media so photos/video stay right. OFF by default
  //                 (mirrors image autoTint defaulting off — never auto-mangle an
  //                 arbitrary interaction).
  //        "none"   (OPT-OUT): vars + data-mode only, no visual fallback (the
  //                 interaction fully themes itself).
  var EMBED_THEME_SHIM = [
    "(function(){",
    "if(window.__themeShim)return; window.__themeShim=1;",
    "function styleEl(css){var s=document.getElementById('__theme_fb');if(!s){s=document.createElement('style');s.id='__theme_fb';(document.head||document.documentElement).appendChild(s);}s.textContent=css;}",
    "function apply(m){var de=document.documentElement,b=document.body;if(!de)return;", // bail if the doc isn't parsed yet (a transient reload state) -> avoids null .style/.setAttribute/.appendChild
    "if(m.vars){for(var k in m.vars){try{de.style.setProperty(k,m.vars[k]);}catch(_){}}}",
    // map the interaction's OWN palette vars onto theme tokens (Phase 2). --color-* were
    // just set above, so var(--color-…) resolves here and follows the mode.
    "if(m.map){for(var mk in m.map){try{de.style.setProperty(mk,m.map[mk]);}catch(_){}}}",
    "if(de)de.setAttribute('data-mode',m.mode);if(b)b.setAttribute('data-mode',m.mode);",
    "var fb=m.fallback||'tokens';",
    "if(fb==='none'){styleEl('');return;}",
    "if(fb==='invert'){styleEl(m.mode==='dark'?'html{filter:invert(1) hue-rotate(180deg);background:#fff;}img,video,picture,svg image,canvas,iframe,[data-no-invert]{filter:invert(1) hue-rotate(180deg);}':'');return;}",
    "var bg=m.vars&&(m.vars['--color-bg']||m.vars['--color-surface']);var ink=m.vars&&m.vars['--color-ink'];",
    // ease the interaction's own bg/color over the SAME --motion-mode-fade duration the
    // page uses, so it doesn't snap while the surrounding page fades (skip on reduced-motion)
    "var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;",
    "var tr=(m.fadeMs>0&&!rm)?('transition:background-color '+m.fadeMs+'ms ease,color '+m.fadeMs+'ms ease;'):'';",
    "styleEl('html,body{'+(bg?'background:'+bg+';':'')+(ink?'color:'+ink+';':'')+tr+'}');}",
    "window.addEventListener('message',function(e){var d=e.data;if(typeof d==='string'){try{d=JSON.parse(d);}catch(_){return;}}if(d&&d.type==='theme')apply(d);});",
    "try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:'theme-shim-ready'},'*');}catch(_){}",
    "})();"
  ].join("");
  window.__EMBED_THEME_SHIM = EMBED_THEME_SHIM;

  function kebabToken(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }
  // colour token object -> { "--color-<kebab>": value } (same var names applyTheme emits)
  function varsFromColors(colors) {
    var out = {};
    if (colors) Object.keys(colors).forEach(function (k) { out["--color-" + kebabToken(k)] = colors[k]; });
    return out;
  }
  window.varsFromColors = varsFromColors;

  // ---- HTML-interaction palette linking (Phase 2 of the dynamic palette) --------
  // An interaction declares its own palette as CSS custom properties (e.g.
  // :root{ --bg:#212121; --orange:#FFA726 }). We can't introspect an opaque iframe,
  // but we CAN detect those declared vars in block.html and let the author map each to
  // a theme token / custom colour (block.embedColorMap). At theme-push time the shim
  // sets the interaction's var to `var(--color-<token>)` — and since the parent already
  // pushes --color-* INTO the iframe, it resolves + tracks light/dark for free.
  // Detect declared colour custom-properties (name + literal value); fonts/non-colours skipped.
  function detectEmbedColorVars(html) {
    if (!html || typeof html !== "string") return [];
    var out = [], seen = {}, re = /(--[A-Za-z0-9-]+)\s*:\s*([^;}{]+?)\s*[;}]/g, m;
    while ((m = re.exec(html))) {
      var name = m[1], val = (m[2] || "").trim();
      if (seen[name] || !isColorLiteral(val)) continue;
      seen[name] = 1; out.push({ name: name, value: val });
    }
    return out;
  }
  window.detectEmbedColorVars = detectEmbedColorVars;
  // Resolve block.embedColorMap -> { "--interactionVar": "<css value>" }: a token key
  // becomes var(--color-<kebab>) (tracks theme in-iframe); a literal is used as-is;
  // "keep"/empty is omitted (the interaction keeps its own colour).
  function resolveEmbedColorMap(block) {
    var map = (block && block.embedColorMap) || {}, out = {};
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      if (!v || v === "keep") return;
      out[k] = isColorLiteral(v) ? v.trim() : "var(--color-" + kebabToken(v) + ")";
    });
    return out;
  }
  window.resolveEmbedColorMap = resolveEmbedColorMap;

  // Parent-side push (Item Z): send the active theme to every HTML-interaction
  // iframe under `root`. Same-origin (srcdoc / bundled local) -> BOTH postMessage
  // (the opt-in contract the shim listens on) AND a direct same-origin apply +
  // shim-injection for bundled files that weren't baked with the shim. Called by
  // the editor's reapplyTheme; the exported runtime re-implements it inline
  // (render.js does not ship in the SCORM package).
  function pushEmbedTheme(root, mode, colors) {
    if (!root || !root.querySelectorAll) return;
    var vars = varsFromColors(colors);
    // The mode-fade duration (doc.motion.modeMs -> --motion-mode-fade). Read it off a
    // themed root so the iframe shim can ease its own bg/color over the SAME time as the
    // page fade, instead of snapping. 0/absent -> no transition (matches instant swap).
    var fadeMs = 300; // match the CSS default `var(--motion-mode-fade, 300ms)` when unset
    try {
      var themed = (root.classList && root.classList.contains("course-root")) ? root : (root.querySelector && root.querySelector(".course-root"));
      var raw = themed && typeof getComputedStyle === "function" ? getComputedStyle(themed).getPropertyValue("--motion-mode-fade") : "";
      // Defined (even "0ms" = author-disabled the fade) -> honour it; undefined -> keep 300.
      if (raw && raw.trim()) { var m = /([\d.]+)\s*(ms|s)?/.exec(raw.trim()); fadeMs = m ? Math.round(parseFloat(m[1]) * (m[2] === "s" ? 1000 : 1)) : 300; }
    } catch (_) {}
    Array.prototype.forEach.call(root.querySelectorAll(".embed--html"), function (wrap) {
      var frame = wrap.querySelector(".embed__iframe");
      if (!frame) return;
      var fb = wrap.getAttribute("data-theme-fallback") || "tokens";
      var map = null; var emAttr = wrap.getAttribute("data-embed-colormap");
      if (emAttr) { try { map = JSON.parse(emAttr); } catch (_) {} }
      var msg = { type: "theme", mode: mode, vars: vars, fallback: fb, map: map, fadeMs: fadeMs };
      function deliver() {
        try { if (frame.contentWindow) frame.contentWindow.postMessage(msg, "*"); } catch (_) {}
        try {
          var idoc = frame.contentDocument;
          if (idoc && idoc.documentElement) {
            if (!idoc.getElementById("__theme_shim")) {
              var s = idoc.createElement("script"); s.id = "__theme_shim"; s.textContent = EMBED_THEME_SHIM;
              (idoc.body || idoc.documentElement).appendChild(s);
            }
            var de = idoc.documentElement, b = idoc.body;
            Object.keys(vars).forEach(function (k) { try { de.style.setProperty(k, vars[k]); } catch (_) {} });
            if (map) Object.keys(map).forEach(function (k) { try { de.style.setProperty(k, map[k]); } catch (_) {} });
            de.setAttribute("data-mode", mode); if (b) b.setAttribute("data-mode", mode);
          }
        } catch (_) {}
      }
      deliver();
      if (!frame.__themeBound) { frame.__themeBound = true; frame.addEventListener("load", deliver); }
    });
  }
  window.pushEmbedTheme = pushEmbedTheme;

  // `rich` = the field holds inline HTML (bold/italic/etc.) rather than plain
  // text; bound via innerHTML and marked data-rich so the editor shows text
  // properties. The bind object's `style` (block-level type settings) is applied
  // here. Plain fields (e.g. card slots) stay textContent-bound.
  // styleKey (optional): when several rich fields share ONE obj (e.g. a quiz's
  // done.title + done.body, or a question's prompt + feedbackCorrect + feedbackIncorrect),
  // a plain obj.style would be shared -> formatting one bleeds onto the sibling. Pass a
  // per-field styleKey so each field's style lives at obj[styleKey] independently. Absent
  // (standalone text blocks: one rich field per obj) -> style stays on obj itself.
  // Wrapper retained so chrome text elements share one construction path.
  function stampChrome(node) { return node; }
  function editable(tag, className, obj, field, rich, styleKey) {
    var node = el(tag, className);
    var value = obj[field] == null ? "" : String(obj[field]);
    if (rich) node.innerHTML = value; else node.textContent = value;
    node.setAttribute("data-edit", field);
    if (rich) {
      node.setAttribute("data-rich", "1");
      var host = styleKey ? obj[styleKey] : obj; // per-field style host or the obj itself
      var st = host ? resolveBlockStyle(host) : null;
      if (st) applyTextStyle(node, st);
      // #120 inline styles (1/4): resolve any inline `<span data-style-ref>` AFTER the
      // block style, so each span cascades over (and overrides only its own props of)
      // the block-level style. Pure -> the same spans style identically in the export.
      resolveInlineStyles(node);
      // Universal list styling: ANY rich text field can hold an inline <ul>/<ol> (made
      // from the shared Text panel, like bold). The author's marker style/colour/size +
      // custom glyph live on obj.listMarker* and are stamped here, so lists look identical
      // everywhere text is typed. data-list-marker keys the course.css marker rules.
      if (obj.listMarker) node.setAttribute("data-list-marker", obj.listMarker);
      if (obj.listMarkerColor) node.style.setProperty("--li-marker-color", obj.listMarkerColor);
      if (obj.listMarkerSize != null && obj.listMarkerSize !== "") node.style.setProperty("--li-marker-size", obj.listMarkerSize + "em");
      if (obj.listMarker === "custom" && obj.listMarkerChar) node.style.setProperty("--li-marker", JSON.stringify(obj.listMarkerChar + " "));
    }
    node.__bind = { obj: obj, field: field, styleKey: styleKey || null };
    return node;
  }

  var CTX = {
    el: el,
    slot: function (tag, className, instance, key) {
      return editable(tag, className, instance.slots, key);
    }
  };

  // Absorbs the /vimeo skill's URL parsing: recognise Vimeo/YouTube ids so the
  // export can self-host Vimeo as <video> (air-gap safe); anything else is a
  // generic live-iframe embed.
  function parseVideo(url) {
    url = (url || "").trim();
    // A pasted embed CODE is a full <iframe ... src="..."></iframe> snippet, not a
    // bare URL. Microsoft Forms (and most providers' "Embed" buttons) hand you the
    // whole tag. Pull the src out so the block renders the real target; a bare URL
    // has no <iframe and falls straight through unchanged. Decode &amp; since some
    // copy sources HTML-encode the query separators. Runs BEFORE the vimeo/youtube
    // regexes so an iframe-wrapped Vimeo/YouTube embed still classifies correctly.
    if (/^<iframe[\s>]/i.test(url)) {
      var srcm = url.match(/\ssrc\s*=\s*["']([^"']+)["']/i);
      if (srcm) url = srcm[1].replace(/&amp;/gi, "&").trim();
    }
    // Vimeo: vimeo.com/ID, vimeo.com/ID/HASH (unlisted), or player.vimeo.com/video/ID?h=HASH.
    // The HASH is the UNLISTED/private privacy token — REQUIRED or the player shows
    // "Because of its privacy settings, this video cannot be played here" for EVERY video.
    // Capture it from the /HASH path segment OR the ?h= query (mirrors vimeo2captivate).
    var v = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-z0-9]+))?/i);
    if (v) {
      var hash = v[2] || (url.match(/[?&]h=([a-z0-9]+)/i) || [])[1] || "";
      return { provider: "vimeo", id: v[1], hash: hash, url: url };
    }
    var y = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
    if (y) return { provider: "youtube", id: y[1], url: url };
    return { provider: url ? "generic" : "empty", id: null, url: url };
  }
  window.parseVideo = parseVideo;

  // Per-button styling. All optional overrides on the block; absent (empty
  // string) falls through to the theme buttonStyle bundle (--button-* on
  // .nav-button, KK), so an unstyled button tracks the theme live and a set prop
  // wins per block. Colours accept a raw value or a theme token ref (e.g.
  // "var(--color-accent)") — same convention as frame fill. Ships in the SCORM
  // output (plain inline styles, no editor chrome).
  var BTN_SIZES = { s: ["13px", "9px 16px"], m: ["", ""], l: ["17px", "15px 28px"] };
  function applyButtonStyle(node, b) {
    node.style.background = b.bg || "";
    node.style.color = b.fg || "";
    node.style.fontFamily = b.font ? (FONT_STACKS[b.font] || b.font) : "";
    // size preset (falls back to the .nav-button CSS defaults for medium/unset)
    var sz = BTN_SIZES[b.size] || BTN_SIZES.m;
    node.style.fontSize = sz[0];
    node.style.padding = sz[1];
    // shape
    if (b.shape === "pill") node.style.borderRadius = "999px";
    else if (b.shape === "square") node.style.borderRadius = "0";
    else if (b.radius != null && b.radius !== "") node.style.borderRadius = b.radius + "px";
    else node.style.borderRadius = "";
    // stroke / outline
    if (b.stroke) node.style.border = (b.strokeWidth || 1) + "px solid " + (b.strokeColor || "currentColor");
    else node.style.border = "";
    // per-block hover-state colour (KK): set the --button-hover-* var on the node
    // so the .nav-button:hover rule uses it; unset -> remove so it falls back to
    // the theme bundle / base. Pure data on the block, ships in the SCORM output.
    if (b.hoverBg) node.style.setProperty("--button-hover-bg", b.hoverBg); else node.style.removeProperty("--button-hover-bg");
    if (b.hoverFg) node.style.setProperty("--button-hover-fg", b.hoverFg); else node.style.removeProperty("--button-hover-fg");
    node.classList.toggle("nav-button--block", !!b.fullWidth);
  }
  window.applyButtonStyle = applyButtonStyle;

  // optional per-embed appearance params (default: none — render as authored)
  function applyEmbedStyle(node, block) {
    node.style.border = block.border ? "1px solid var(--color-hair)" : "0";
    node.style.borderRadius = (block.radius ? block.radius : 0) + "px";
    // Author-settable letterbox/background colour (#176). Absent -> the theme
    // var(--color-bg) from .embed--filled CSS wins (tracks light/dark). A value
    // (raw hex or a "var(--color-*)" token ref) paints the media's own
    // object-fit letterbox; the wrapper background is set alongside in webEmbed.
    // Only webEmbed carries embedBg, so htmlEmbed's iframe is untouched.
    if (block.embedBg) node.style.background = block.embedBg;
  }

  // Hotspot overlay-card (popover) visual style — block-level, applied to every
  // popover in the block. Absent props fall back to the token-driven .hotspot-popover
  // CSS. --pop-bg / --pop-border are also set so the pointer arrow (::after) tracks
  // the custom fill/border. Pure data on the block -> ships in the SCORM output.
  function applyPopoverStyle(node, card) {
    if (!card) return;
    if (card.fill) { node.style.background = card.fill; node.style.setProperty("--pop-bg", card.fill); }
    if (card.textColor) node.style.color = card.textColor;
    if (card.border === false) node.style.border = "none";
    else if (card.border === true) {
      var bc = card.borderColor || "var(--color-hair)";
      node.style.border = (card.borderWidth || 1) + "px solid " + bc;
      node.style.setProperty("--pop-border", bc);
    }
    if (card.radius != null && card.radius !== "") node.style.borderRadius = card.radius + "px";
    if (card.width) node.style.width = card.width + "px";
    if (card.padding != null && card.padding !== "") node.style.padding = card.padding + "px";
  }
  window.applyPopoverStyle = applyPopoverStyle;

  // per-quiz colour override keys -> the theme CSS var they set on the quiz root.
  // Shared with the editor's Colours inspector (window.QUIZ_COLOR_VARS).
  var QUIZ_COLOR_VARS = {
    accent: "--color-accent",
    panel: "--color-surface",
    option: "--color-surface-alt",
    text: "--color-ink",
    textSoft: "--color-ink-soft",
    border: "--color-hair",
    error: "--color-danger"
  };
  window.QUIZ_COLOR_VARS = QUIZ_COLOR_VARS;

  var BLOCKS = {
    heading: function (block) {
      return editable("h1", "page-title", block, "text", true);
    },
    paragraph: function (block) {
      return editable("p", "body-copy", block, "text", true);
    },
    note: function (block) {
      // Callout: a DIV, not a <p>, so the left-accent border legally wraps multi-paragraph
      // / list content and spans the full height. A <p> auto-closes at the first block-level
      // child, collapsing the accent to a 1-line stub with the copy escaping outside it.
      return editable("div", "body-note", block, "text", true);
    },
    subheading: function (block) {
      return editable("h2", "page-subtitle", block, "text", true);
    },
    quote: function (block) {
      return editable("blockquote", "body-quote", block, "text", true);
    },
    list: function (block) {
      // rich field holding <li> items; a contentEditable <ul> lets Enter add rows,
      // Tab/Shift+Tab nest (editor). Marker style/colour/size + custom glyph are pure
      // block data -> data-marker + --li-marker* on the <ul>, resolved in course.css so
      // the exact look ships in SCORM. decimal/lower-alpha/lower-roman on a <ul> still
      // render numbers (list-style-type is tag-agnostic), so one editable tag stays stable.
      // The list block is now just a rich field that IS a <ul>; marker styling comes
      // from the SAME editable() path as every other field (obj.listMarker*), so a list
      // block and an inline list look identical.
      return editable("ul", "body-list", block, "text", true);
    },
    // #90: native table block. Data = block.rows (array of rows; each row an array of
    // cell objects { t: richHTML }), block.header (first row is a header), block.borders
    // ("all"|"rows"|"none"), block.zebra, block.cellPad (px), block.align (per-column
    // "left"|"center"|"right"). Each cell is an editable() rich field so it edits on the
    // canvas AND its copy is identical in editor + export.
    // A horizontal-scroll wrapper keeps a wide table from breaking the page width (#79).
    table: function (block) {
      var wrap = el("div", "table-block");
      var scroll = el("div", "table-block__scroll");
      var t = el("table", "table-block__table");
      if (block.borders) t.setAttribute("data-borders", block.borders);
      if (block.zebra) t.setAttribute("data-zebra", "1");
      if (block.cellPad != null) t.style.setProperty("--table-cell-pad", block.cellPad + "px");
      var align = block.align || [];
      (block.rows || []).forEach(function (row, ri) {
        var tr = el("tr", "table-block__row");
        (row || []).forEach(function (cell, ci) {
          if (!cell || typeof cell !== "object") return;
          var isHead = !!block.header && ri === 0;
          var td = editable(isHead ? "th" : "td", "table-block__cell", cell, "t", true);
          if (isHead) td.setAttribute("scope", "col");
          var a = align[ci];
          if (a === "center" || a === "right") td.style.textAlign = a;
          tr.appendChild(td);
        });
        t.appendChild(tr);
      });
      scroll.appendChild(t);
      wrap.appendChild(scroll);
      return wrap;
    },
    divider: function () {
      var w = el("div", "block-divider");
      w.appendChild(el("hr", "block-divider__line"));
      return w;
    },
    // A vertical gap. Fixed height by default; `auto` makes it a flex spring that
    // eats the page's leftover height (see .page--fill), so an auto spacer above
    // AND below a block vertically centres that block in the viewport.
    spacer: function (block) {
      var s = el("div", "block-spacer");
      if (block.auto) s.classList.add("block-spacer--auto");
      else s.style.height = (block.height || 40) + "px";
      return s;
    },
    // Acknowledge / Checkbox: a labelled real <input type=checkbox>. Ships as
    // course content; the runtime engine binds `change` -> emits `checked` state
    // (read by gate conditions). Token-styled via .block-checkbox in course.css.
    // The label is editable; `block.checked` is an optional author default.
    checkbox: function (block) {
      var wrap = el("label", "block-checkbox");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.className = "block-checkbox__input";
      if (block.checked) input.checked = true;
      wrap.appendChild(input);
      wrap.appendChild(editable("span", "block-checkbox__label", block, "label", false));
      return wrap;
    },
    image: function (block) {
      // Item Y — per-asset light/dark contrast (a SEPARATE dimension from the
      // CSV/product variant system; nothing here touches resolveVariant):
      //   - srcLight/srcDark: per-mode raster sources, swapped purely by
      //     .course-root[data-mode] CSS (no runtime). Missing side falls back to src.
      //   - autoTint: recolour the asset to contrast the bg in dark (mirrors the
      //     header logo's filter:invert), via a CSS class. Tri-state:
      //       true  -> always tint;  false -> never tint;
      //       unset -> AUTO (default): tint VECTOR art (SVG), skip RASTER photos,
      //       so vector assets adapt to light/dark out of the box while a
      //       photograph is never mangled (James 2026-07-06).
      var hasModeSrc = !!(block.srcLight || block.srcDark);
      if (block.src || hasModeSrc) {
        var fig = el("figure", "block-image");
        if (block.padding != null) fig.style.padding = block.padding + "px"; // VVV: inner padding around the asset
        // Author corner radius on the image itself (0 = square). Unset -> the CSS
        // default (--radius-card). Applied via a var on the figure so it reaches both
        // the <img> and an inlined <svg> (both .block-image__img).
        if (block.radius != null && block.radius !== "") fig.style.setProperty("--img-radius", block.radius + "px");
        // Blend mode (#152): blend the asset against whatever sits behind it, so a
        // dark-background image/GIF melts into a dark page (Lighten/Screen) instead of
        // regenerating the asset. Applied via a var on the figure so it reaches both the
        // <img> and an inlined <svg> (both .block-image__img). Unset -> normal (no blend).
        if (block.blendMode && block.blendMode !== "normal") fig.style.setProperty("--img-blend", block.blendMode);
        // Image lightbox (learner aid): every image is click-to-zoom by default; the
        // runtime (export + demo) builds a shared overlay + stamps .is-lightbox-bound
        // (so the zoom cursor only shows where it's actually clickable, not on the
        // authoring canvas). Opt OUT per image with block.noZoom. Caption = the block's
        // caption, falling back to alt; carried on the figure for the runtime to read.
        if (block.noZoom !== true) {
          fig.classList.add("block-image--zoomable");
          var capText = block.caption || block.alt || "";
          if (capText) fig.setAttribute("data-caption", capText);
        }
        var tintOn = block.autoTint === true ||
          (block.autoTint == null && isVectorSrc(assetSrc(block.src)));
        var autoCls = tintOn ? " block-image__img--auto" : "";
        function makeImg(src, modeCls) {
          var img = document.createElement("img");
          // per-mode sources handle contrast themselves, so autoTint only applies to
          // the single-source case (a mono asset the author flagged).
          img.className = "block-image__img" + modeCls + (hasModeSrc ? "" : autoCls);
          img.src = assetSrc(src); img.alt = block.alt || "";
          if (block.maxWidth) img.style.maxWidth = block.maxWidth + "px";
          // VVV: fit into a fixed height box (crop = cover / letterbox = contain / stretch = fill)
          if (block.fitH) { img.style.height = block.fitH + "px"; img.style.width = "100%"; img.style.objectFit = block.fit || "cover"; }
          return img;
        }
        if (hasModeSrc) {
          fig.appendChild(makeImg(block.srcLight || block.src || block.srcDark, " block-image__img--light"));
          fig.appendChild(makeImg(block.srcDark || block.src || block.srcLight, " block-image__img--dark"));
        } else {
          // Inline an uploaded data-URL SVG so a mapped palette (block.colorMap)
          // can recolour it from theme tokens (recolours per mode with no filter).
          // With no map it still inlines and falls back to the auto-tint filter.
          var svg = inlineSvg(block);
          if (svg) {
            // Multi-colour art (or an explicit map) recolours from tokens -> no blunt
            // auto-tint. A single-colour SVG isn't remapped, so it keeps the auto-tint
            // (silhouette) fallback for mono contrast.
            var recoloured = (block.colorMap && Object.keys(block.colorMap).length) ||
              window.__svgColorCount(block) > 1;   // from the shared memo (no 3rd decode/parse)
            svg.setAttribute("class", "block-image__img block-image__svg" + (recoloured ? "" : autoCls));
            if (block.maxWidth) svg.style.maxWidth = block.maxWidth + "px";
            // VVV: fit an inline SVG into a fixed height. object-fit doesn't apply to
            // inline svg, so scale via a fixed height + preserveAspectRatio
            // (meet=contain / slice=cover / none=stretch), mirroring the raster fit.
            if (block.fitH) { svg.style.height = block.fitH + "px"; svg.style.width = "100%"; svg.setAttribute("preserveAspectRatio", block.fit === "cover" ? "xMidYMid slice" : block.fit === "fill" ? "none" : "xMidYMid meet"); }
            if (block.alt) svg.setAttribute("role", "img"), svg.setAttribute("aria-label", block.alt);
            fig.appendChild(svg);
          } else {
            fig.appendChild(makeImg(block.src, ""));
          }
        }
        return fig;
      }
      var ph = el("div", "block-image block-image--empty");
      ph.appendChild(el("div", "embed__empty-title", "Image"));
      ph.appendChild(el("div", "embed__empty-sub", "Select this block, then add a URL or upload in the panel"));
      return ph;
    },

    // Frame: a generic container that holds child blocks (a "card" is a styled
    // frame). Children are ordinary blocks, so a frame composed from primitives
    // can be saved as a reusable component. Same child-rendering pattern as
    // `columns`, and each child keeps its __block back-ref so it stays editable.
    frame: function (block) {
      var f = el("div", "block-frame" + (block.className ? " " + block.className : ""));
      if (block.padding != null) f.style.padding = block.padding + "px";
      if (block.background) f.style.background = block.background;
      if (block.radius != null) f.style.borderRadius = block.radius + "px";
      if (block.border) f.style.border = "1px solid var(--color-hair)";
      if (block.gap != null) f.style.gap = block.gap + "px";
      (block.children || []).forEach(function (child) {
        var node = renderBlock(child);
        node.__block = child;
        f.appendChild(node);
      });
      if (!(block.children || []).length) {
        f.appendChild(el("div", "block-frame__empty", "Empty frame — add blocks inside from the panel"));
      }
      return f;
    },

    // Group: an INVISIBLE container (display:contents) that only captures the
    // relationship between its children for reuse — it must NOT change how they
    // look. Created by multi-select -> group. A visible container is a Card
    // (`frame`) instead. Children render straight into the page flow.
    group: function (block) {
      var g = el("div", "block-group" + (block.className ? " " + block.className : ""));
      (block.children || []).forEach(function (child) {
        var node = renderBlock(child);
        node.__block = child;
        g.appendChild(node);
      });
      if (!(block.children || []).length) g.appendChild(el("div", "block-group__empty", "Empty group"));
      return g;
    },

    columns: function (block) {
      var row = el("div", "layout-columns");
      row.style.display = "flex";
      row.style.gap = block.gap == null ? "24px" : (block.gap + "px");
      row.style.alignItems = "stretch";
      
      // Per-column width: block.colWidths is an array of flex-grow ratios (one per
      // column). Absent/short -> that column falls back to "1" (equal split), so a
      // doc with no colWidths renders exactly as before (zero regression). The
      // ratios are plain doc data and ship in the SCORM export unchanged; the
      // editor's drag handles only mutate this array (editor chrome stays out of
      // render). flex:1 == "1 1 0" so rendered width is proportional to the ratio.
      var colWidths = block.colWidths;
      (block.columns || []).forEach(function (colBlocks, ci) {
        var col = el("div", "layout-column");
        var w = (colWidths && colWidths[ci] != null) ? colWidths[ci] : 1;
        col.style.flex = String(w);
        col.style.minWidth = "0";
        col.style.display = "flex";
        col.style.flexDirection = "column";
        // GG: vertical gap between stacked blocks in a column. Defaults to 0 so
        // per-block Space top/bottom margins are the single spacing lever (same as
        // plain page flow) instead of a fixed flex gap that shadowed them. An
        // optional block.rowGap re-adds a uniform gap on top when the author wants it.
        col.style.gap = (block.rowGap == null ? 0 : block.rowGap) + "px";

        colBlocks.forEach(function (subBlock) {
          var node = renderBlock(subBlock);
          node.__block = subBlock;
          col.appendChild(node);
        });
        // #94: an empty column (a fresh palette Columns block, or one whose blocks
        // were all removed) needs a visible, targetable slot — mirrors the empty
        // frame/group placeholders. Pure: shows in the editor AND the export, and a
        // finished course fills its columns so a learner never sees it.
        if (!colBlocks.length) col.appendChild(el("div", "layout-column__empty", "Empty column"));
        row.appendChild(col);
      });
      return row;
    },

    // Nav button (flagship "Actions" system): a real navigation control in the
    // shipped course. Its target lives in block.action.goto (a page id) and is
    // emitted as data-goto — plain, serialisable navigation data (NOT editor
    // headerFooter), so it ships in the SCORM output and the export runtime / demo mode
    // read it identically. The label is editable; the "›" affordance is CSS.
    navButton: function (block) {
      var a = editable("a", "nav-button", block, "text", false);
      var act = block.action || {};
      // "Exit course" DO-action: ends the SCORM session (LMSFinish) rather than
      // navigating a page. Routed through the engine like prev/next via
      // data-nav-action, so it stays PURE data that ships in SCORM + demo alike.
      if (act.exit) {
        a.setAttribute("href", "#");
        a.setAttribute("data-nav-action", "exit");
      } else {
        var goto = act.goto;
        a.setAttribute("href", goto ? "#" + goto : "#");
        if (goto) a.setAttribute("data-goto", goto);
      }
      applyButtonStyle(a, block);
      return a;
    },

    // Item X — learner light/dark toggle. A real control the AUTHOR opts to place
    // in the header/footer; the LEARNER clicks it to flip .course-root[data-mode].
    // render stays PURE: it emits only the button + a [data-mode-toggle] hook. The
    // click is bound by SELECTOR (not id) in BOTH the exported runtime (export.js
    // reuses its #scorm-theme toggleTheme) and the editor demo (setMode) -- headerFooter
    // is global so this button renders once per page (N copies); an id could not
    // bind them all. The label is editable inline like any text.
    // Learner light/dark toggle. Shows a single glyph = the mode you'd switch TO
    // (moon in light mode, sun in dark mode). Both glyphs render; course.css shows
    // only the opposing one via .course-root[data-mode] (stamped by the export
    // runtime, the editor demo, and the no-JS OS fallback). render stays pure — the
    // click flip is bound by [data-mode-toggle] selector in runtime/editor as before.
    modeToggle: function (block) {
      var b = el("button", "mode-toggle mode-toggle--icon");
      b.type = "button";
      b.setAttribute("data-mode-toggle", "1");
      var lbl = block.label || "Switch light / dark mode";
      b.setAttribute("aria-label", lbl);
      b.setAttribute("title", lbl);
      var moon = el("span", "mode-toggle__glyph mode-toggle__to-dark");
      moon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8z"/></svg>';
      var sun = el("span", "mode-toggle__glyph mode-toggle__to-light");
      sun.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
      b.appendChild(moon); b.appendChild(sun);
      return b;
    },

    // Accordion / Tabs block. render is PURE and emits the AUTHOR view: ALL panels
    // shown (no [hidden]) so the editor canvas (which does not run runtime.js) shows
    // every section open for editing its child blocks, and a JS-off shipped course
    // degrades to everything-visible. runtime.js bindAccordion collapses + wires it
    // in demo + export -> same markup both places, no WYSIWYG mismatch. Titles are
    // editable; sections hold ordinary blocks (renderBlock) so the block composes.
    // TTTT: Card Reveal grid. A responsive grid of cards; each card holds nested
    // blocks under a frosted "Hold to reveal" cover. render is PURE + emits ALL
    // content (like accordion) so the editor canvas shows/edits every card; the
    // cover reveals on hover / focus (pure CSS, air-gap clean) and an optional
    // runtime tap-toggle (`.is-revealed`) is a follow-up. Colours are theme tokens.
    cardReveal: function (block) {
      var items = block.items || [];
      var root = el("div", "card-reveal");
      root.setAttribute("data-card-reveal", "1");
      // NOTE: grid count is `cols` NOT `columns` — `block.columns` is reserved for the
      // columns block type (an array of column arrays) that walkBlocks/resolveVariant iterate.
      if (block.cols) root.style.setProperty("--cr-cols", block.cols);
      if (block.gap != null) root.style.setProperty("--cr-gap", block.gap + "px");
      if (block.cardH != null) root.style.setProperty("--cr-card-h", block.cardH + "px");
      // cover glass: author-tunable colour / opacity / blur (uniform across the grid).
      if (block.coverColor) root.style.setProperty("--cr-cover-color", block.coverColor);
      if (block.coverOpacity != null) root.style.setProperty("--cr-cover-opacity", block.coverOpacity + "%");
      if (block.coverBlur != null) root.style.setProperty("--cr-cover-blur", block.coverBlur + "px");
      // per-mode card fill (author override) — the CSS picks by data-mode so it still
      // switches light/dark; absent -> the default (dark #2a2a2a / light #fff).
      var __cb = block.cardBox || {};
      if (__cb.fillDark) root.style.setProperty("--cr-fill-dark", __cb.fillDark);
      if (__cb.fillLight) root.style.setProperty("--cr-fill-light", __cb.fillLight);
      // surface texture: grid (default) | dots | none, with an optional custom colour.
      root.setAttribute("data-pattern", block.pattern === "dots" || block.pattern === "none" ? block.pattern : "grid");
      if (block.patternColor) root.style.setProperty("--tex-color", block.patternColor);
      // Reveal style (one mode per block): reveal (default frosted cover) | flip (3D card
      // flip) | off (static, no second face). Both interactive modes reuse the same
      // .is-revealed toggle; the CSS keys the visual off data-reveal-style.
      var revealStyle = block.revealStyle === "flip" ? "flip" : block.revealStyle === "off" ? "off" : "reveal";
      root.setAttribute("data-reveal-style", revealStyle);
      if (!items.length) { root.appendChild(el("div", "card-reveal__empty", "Empty — add cards from the panel.")); return root; }
      items.forEach(function (item, i) {
        var card = el("div", "card-reveal__card");
        card.setAttribute("data-cr-index", String(i));
        card.setAttribute("tabindex", "0"); // focusable -> keyboard/tap reveal
        // Per-card border/radius via the shared appearance engine (fill is handled
        // per-mode above via --cr-fill-* so it still switches light/dark — NOT a fixed
        // background here). Uniform across the grid.
        applyBlockAppearance(card, { box: { border: __cb.border, borderColor: __cb.borderColor, borderWidth: __cb.borderWidth, radius: __cb.radius, textColor: __cb.textColor } });
        var content = el("div", "card-reveal__content");
        (item.children || []).forEach(function (child) { var n = renderBlock(child); n.__block = child; content.appendChild(n); });
        if (!(item.children || []).length) content.appendChild(el("div", "card-reveal__card-empty", "Empty card"));
        card.appendChild(content);
        // The "face" is the frosted cover (reveal) OR the flip front (flip). "off" has no
        // face and no second state. noCover only suppresses the reveal frost.
        var showFace = revealStyle === "off" ? false : (revealStyle === "flip" ? true : !block.noCover);
        if (showFace) {
          var cover = el("div", "card-reveal__cover");
          // Flip Side 1: the front face holds its OWN authored child blocks (item.front),
          // mirroring the back (item.children) — both faces are fully authorable. A flip
          // card with no front array (legacy doc / library template not yet migrated)
          // falls back to the block-level hint label, so old exports render unchanged.
          if (revealStyle === "flip" && Array.isArray(item.front)) {
            var front = el("div", "card-reveal__front");
            item.front.forEach(function (child) { var n = renderBlock(child); n.__block = child; front.appendChild(n); });
            if (!item.front.length) front.appendChild(el("div", "card-reveal__card-empty", "Empty front"));
            cover.appendChild(front);
          } else {
            cover.appendChild(el("span", "card-reveal__hint", block.hint || (revealStyle === "flip" ? "Flip" : "Hold to reveal")));
          }
          card.appendChild(cover);
        }
        // Auto-numbered index (01, 02, …), top-left, always above the frost so the
        // learner sees the card number before revealing. Opt out with block.noIndex.
        if (!block.noIndex) {
          card.appendChild(el("span", "card-reveal__index", ("0" + (i + 1)).slice(-2)));
        }
        root.appendChild(card);
      });
      return root;
    },
    // Card Deck — a paged "carousel" of full-frame cards. ONE card shown at a time at
    // runtime (‹ › paging + counter); the editor shows every card stacked so each body
    // is a drop target (identical items[].children pattern to card-reveal / accordion,
    // so nested delete / drag-move / drop-insert / traversal are inherited). Card
    // numbers are DERIVED at render (renumber free on reorder/add/delete). Each card's
    // body holds ANY authored blocks; the section label is an optional per-card field.
    cardDeck: function (block) {
      var items = block.items || [];
      var root = el("div", "card-deck");
      root.setAttribute("data-card-deck", "1");
      // surface texture (shared shape with card-reveal / accordion): grid (default) | dots | none.
      root.setAttribute("data-pattern", block.pattern === "dots" || block.pattern === "none" ? block.pattern : "grid");
      if (block.patternColor) root.style.setProperty("--tex-color", block.patternColor);
      // per-mode card fill (author override) — CSS picks by data-mode so it still
      // switches light/dark; absent -> default (dark #1c1c1c / light #fff).
      var __cb = block.cardBox || {};
      if (__cb.fillDark) root.style.setProperty("--cd-fill-dark", __cb.fillDark);
      if (__cb.fillLight) root.style.setProperty("--cd-fill-light", __cb.fillLight);
      if (!items.length) { root.appendChild(el("div", "card-deck__empty", "Empty — add cards from the panel.")); return root; }
      var total = items.length;
      var pad2 = function (n) { return ("0" + n).slice(-2); };
      items.forEach(function (item, i) {
        var card = el("div", "card-deck__card");
        card.setAttribute("data-cd-index", String(i));
        // per-card border/radius/text via the shared appearance engine (fill handled
        // per-mode above via --cd-fill-* so it still switches light/dark). Uniform deck.
        applyBlockAppearance(card, { box: { border: __cb.border, borderColor: __cb.borderColor, borderWidth: __cb.borderWidth, radius: __cb.radius, textColor: __cb.textColor } });
        // meta line: CARD NN / TT (numbers DERIVED) + optional per-card author label.
        var meta = el("div", "card-deck__meta");
        meta.appendChild(el("span", "card-deck__meta-card", "CARD"));
        meta.appendChild(el("span", "card-deck__meta-num", pad2(i + 1)));
        meta.appendChild(el("span", "card-deck__meta-sep", "/"));
        meta.appendChild(el("span", "card-deck__meta-total", pad2(total)));
        if (item.label != null && String(item.label).trim() !== "") meta.appendChild(el("span", "card-deck__meta-label", String(item.label)));
        card.appendChild(meta);
        // droppable body — ordinary nested blocks (items[].children).
        var content = el("div", "card-deck__content");
        (item.children || []).forEach(function (child) { var n = renderBlock(child); n.__block = child; content.appendChild(n); });
        if (!(item.children || []).length) content.appendChild(el("div", "card-deck__card-empty", "Empty card"));
        card.appendChild(content);
        // footer: counter (NN / TT) + ‹ › paging. Emitted static; inert until runtime.js
        // binds paging (demo/export). The editor never runs the runtime, so on the canvas
        // every card stays shown (all drop targets) and the arrows sit inert.
        var footer = el("div", "card-deck__footer");
        footer.appendChild(el("span", "card-deck__count", pad2(i + 1) + " / " + pad2(total)));
        var nav = el("div", "card-deck__nav");
        var prev = el("button", "card-deck__nav-btn card-deck__prev"); prev.type = "button"; prev.setAttribute("aria-label", "Previous card"); prev.appendChild(navArrow("left"));
        var next = el("button", "card-deck__nav-btn card-deck__next"); next.type = "button"; next.setAttribute("aria-label", "Next card"); next.appendChild(navArrow("right"));
        nav.appendChild(prev); nav.appendChild(next);
        footer.appendChild(nav);
        card.appendChild(footer);
        root.appendChild(card);
      });
      return root;
    },
    accordion: function (block) {
      var mode = block.mode === "tabs" ? "tabs" : "accordion";
      var items = block.items || [];
      var root = el("div", "acc" + (mode === "tabs" ? " acc--tabs" : ""));
      root.setAttribute("data-accordion", "1");
      root.setAttribute("data-acc-mode", mode);
      if (mode === "accordion") root.setAttribute("data-acc-multi", block.multi ? "1" : "0");
      // surface texture (matches card-reveal): grid (default) | dots | none + optional colour.
      root.setAttribute("data-pattern", block.pattern === "dots" || block.pattern === "none" ? block.pattern : "grid");
      if (block.patternColor) root.style.setProperty("--tex-color", block.patternColor);
      // per-mode fill (author override), mirroring card-reveal: the CSS picks by data-mode
      // (--acc-fill-dark / --acc-fill-light) so it still switches light/dark; absent -> the
      // default (dark #2a2a2a / light #fff). Applies to both accordion items and the tabs card.
      var __ab = block.cardBox || {};
      if (__ab.fillDark) root.style.setProperty("--acc-fill-dark", __ab.fillDark);
      if (__ab.fillLight) root.style.setProperty("--acc-fill-light", __ab.fillLight);
      if (!items.length) { root.appendChild(el("div", "acc__empty", "Empty — add sections from the panel.")); return root; }
      var addChildren = function (panel, item) {
        (item.children || []).forEach(function (child) { var n = renderBlock(child); n.__block = child; panel.appendChild(n); });
        if (!(item.children || []).length) panel.appendChild(el("div", "acc__panel-empty", "Empty section"));
      };
      if (mode === "tabs") {
        var tabs = el("div", "acc__tabs"); tabs.setAttribute("role", "tablist");
        var body = el("div", "acc__body");
        items.forEach(function (item, i) {
          var tab = editable("button", "acc__tab", item, "title", false);
          tab.setAttribute("type", "button");
          tab.setAttribute("data-acc-tab", String(i));
          tabs.appendChild(tab);
          var panel = el("div", "acc__panel");
          panel.setAttribute("data-acc-index", String(i));
          addChildren(panel, item);
          body.appendChild(panel);
        });
        root.appendChild(tabs); root.appendChild(body);
      } else {
        items.forEach(function (item) {
          var it = el("div", "acc__item");
          var header = el("button", "acc__header");
          header.type = "button";
          header.setAttribute("data-acc-header", "1");
          header.setAttribute("aria-expanded", "true");
          header.appendChild(editable("span", "acc__title", item, "title", false));
          var chev = el("span", "acc__chev");
          chev.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
          header.appendChild(chev);
          it.appendChild(header);
          var panel = el("div", "acc__panel");
          addChildren(panel, item);
          it.appendChild(panel);
          root.appendChild(it);
        });
      }
      return root;
    },

    // FLAGSHIP "Sequence" block — one block that is a process diagram AND a timeline,
    // toggled by a spine mode. Structurally an accordion (items[].children) + a spine +
    // two toggles, so it inherits the whole nested-children traversal/data-loss fix set
    // (walkBlocks/findBlockParent/walkPageBlocks are already generic on items[].children).
    // SLICE 1 (tracer): renders Numbered · Vertical · Static. spine/orient/reveal are read
    // + stamped as data-* hooks now so the editor toggles (slice 2), reveal engine (slice 3)
    // and appearance (slice 4) wire onto a stable DOM. Numbering is DERIVED at render from
    // the item index (never stored) so it renumbers free on reorder/insert/delete.
    sequence: function (block) {
      var items = block.items || [];
      var spine = block.spine === "dated" || block.spine === "plain" ? block.spine : "numbered";
      var orient = block.orient === "horizontal" ? "horizontal" : "vertical";
      var reveal = block.reveal === "click" || block.reveal === "static" ? block.reveal : "scroll";
      var root = el("div", "seq");
      root.setAttribute("data-sequence", "1");
      root.setAttribute("data-seq-spine", spine);
      root.setAttribute("data-seq-orient", orient);
      root.setAttribute("data-seq-reveal", reveal);
      // surface texture (shared shape with accordion / card-reveal): grid (default) | dots | none.
      root.setAttribute("data-pattern", block.pattern === "dots" || block.pattern === "none" ? block.pattern : "grid");
      if (block.patternColor) root.style.setProperty("--tex-color", block.patternColor);
      if (!items.length) { root.appendChild(el("div", "seq__empty", "Empty — add steps from the panel.")); return root; }
      items.forEach(function (item, i) {
        var step = el("div", "seq__step");
        step.setAttribute("data-seq-index", String(i));
        var hasDate = item.date != null && String(item.date).trim() !== "";
        // node marker: an item.icon REPLACES the number/dot in every spine (recoloured to a
        // theme token via inlineSvg when it's an SVG data-URL; raster falls back to an <img>).
        // Otherwise Numbered = index+1 (DERIVED, never stored); Dated = per-step free-text
        // item.date (empty -> falls back to the number); Plain = no label, CSS renders a dot.
        var marker = el("div", "seq__marker");
        if (item.icon) {
          marker.classList.add("seq__marker--icon");
          var svg = (typeof inlineSvg === "function") ? inlineSvg({ src: item.icon, mono: true }) : null;
          if (svg) marker.appendChild(svg);
          else { var iimg = el("img", "seq__icon-img"); iimg.src = assetSrc(item.icon); iimg.alt = ""; marker.appendChild(iimg); }
        } else if (spine === "numbered") marker.textContent = String(i + 1);
        else if (spine === "dated") marker.textContent = hasDate ? String(item.date) : String(i + 1);
        step.appendChild(marker);
        var body = el("div", "seq__body");
        // Dated + icon: the icon has taken the marker, so the date label moves beside it as a
        // caption above the title (Dated without an icon keeps the date IN the marker).
        if (item.icon && spine === "dated" && hasDate) body.appendChild(el("div", "seq__date", String(item.date)));
        // Title is ALWAYS rendered (even when empty) so an empty-title step stays clickable
        // for on-canvas editing — matching the accordion precedent (acc__title is unconditional).
        body.appendChild(editable("div", "seq__title", item, "title", false));
        var content = el("div", "seq__content");
        (item.children || []).forEach(function (child) { var n = renderBlock(child); n.__block = child; content.appendChild(n); });
        if (!(item.children || []).length) content.appendChild(el("div", "seq__step-empty", "Empty step"));
        body.appendChild(content);
        step.appendChild(body);
        root.appendChild(step);
      });
      // Click-reveal wizard controls (‹ counter ›). Emitted ONLY for reveal="click" so
      // editor == export; inert until runtime.js binds them (demo/export). The editor never
      // runs the runtime, so on the canvas every step stays shown (the wizard sits inert).
      if (reveal === "click") {
        var wiz = el("div", "seq__wizard");
        var prev = el("button", "seq__wizard-btn seq__wizard-prev"); prev.type = "button"; prev.setAttribute("aria-label", "Previous step"); prev.appendChild(navArrow("left"));
        var counter = el("span", "seq__counter", "1 / " + items.length);
        var next = el("button", "seq__wizard-btn seq__wizard-next"); next.type = "button"; next.setAttribute("aria-label", "Next step"); next.appendChild(navArrow("right"));
        wiz.appendChild(prev); wiz.appendChild(counter); wiz.appendChild(next);
        root.appendChild(wiz);
      }
      return root;
    },

    // Item FF — learner footer navigation bar. A single block (prev arrow / centre
    // progress bar / next arrow) authored as a footer child. render is PURE: it
    // emits static DOM + the section map as a data-* attribute; ALL behaviour
    // (prev/next, live progress fill, chapter-jump modal) is DOM-bound in the
    // shared runtime.js (bindCourseNav), so demo == exported SCORM with zero
    // export.js change. Arrows carry data-nav-action (routed through the engine so
    // page-visited/gates stay reactive); jump buttons reuse the existing [data-goto]
    // nav path. Sections live ON the block (block.sections = [{id,label,pageIds}])
    // -- the block is their single owner (nothing else reads them), keeping render
    // pure with no doc access. Each part is independently toggleable.
    courseNav: function (block) {
      // #169b: pinning prev/next to the bottom gutters is now the GLOBAL DEFAULT — the
      // expression is consistent across every course (fixed-px gutters, viewport-anchored,
      // independent of page side padding). Per-course OPT-OUT only, via pinButtons === false.
      var pinned = block.pinButtons !== false;
      var wrap = el("div", "course-nav" + (block.iconsOnly ? " course-nav--icons" : "") + (pinned ? " course-nav--pin" : "")); // iconsOnly: chevrons only; pinned: prev/next pinned to bottom gutters at runtime
      // author-overridable nav-button appearance (course.css .course-nav__btn reads these
      // vars; absent -> the white-outline default). Ships in SCORM via the inline vars.
      if (block.btnFill) wrap.style.setProperty("--nav-btn-fill", block.btnFill);
      if (block.btnBorder) wrap.style.setProperty("--nav-btn-border", block.btnBorder);
      if (block.btnText) wrap.style.setProperty("--nav-btn-text", block.btnText);
      if (block.btnHover) wrap.style.setProperty("--nav-btn-hover", block.btnHover);
      // JJJJ: prefer chapter-derived sections (set per render pass via
      // window.__navSections by the editor/export, which have the whole doc), so
      // the nav selector + progress reflect real chapters; fall back to the
      // block's manually-authored sections when not provided.
      var secs = (window.__navSections && window.__navSections.length)
        ? window.__navSections.map(function (s) { return { id: s.id, label: s.label || "", pages: (s.pages || []).slice() }; })
        : (block.sections || []).map(function (s) { return { id: s.id, label: s.label || "", pages: (s.pageIds || []).slice() }; });
      wrap.setAttribute("data-nav-map", JSON.stringify(secs));
      wrap.setAttribute("data-nav-menu-label", block.menuLabel || "Menu");
      if (block.showPrev !== false) {
        var prev = el("button", "course-nav__btn course-nav__prev");
        prev.type = "button";
        prev.setAttribute("data-nav-action", "prev");
        prev.setAttribute("aria-label", block.prevLabel || "Previous");
        prev.appendChild(navArrow("left"));
        prev.appendChild(el("span", "course-nav__btn-label", block.prevLabel || "Back"));
        wrap.appendChild(prev);
      }
      // author-styleable pill surface (runtime): fill / border / radius CSS vars.
      if (block.pillFill) wrap.style.setProperty("--nav-pill-fill", block.pillFill);
      if (block.pillBorder) wrap.style.setProperty("--nav-pill-border", block.pillBorder);
      if (block.pillRadius != null) wrap.style.setProperty("--nav-pill-radius", block.pillRadius + "px");
      // author drop shadow: off -> none; else compose offset/blur/spread/colour+opacity into one
      // box-shadow. Untouched (no fields) leaves --nav-pill-shadow unset -> the CSS default shadow.
      if (block.pillShadow === false) wrap.style.setProperty("--nav-pill-shadow", "none");
      else if (block.pillShadowX != null || block.pillShadowY != null || block.pillShadowBlur != null || block.pillShadowSpread != null || block.pillShadowColor || block.pillShadowOpacity != null) {
        var _sx = block.pillShadowX != null ? block.pillShadowX : 0;
        var _sy = block.pillShadowY != null ? block.pillShadowY : 10;
        var _sb = block.pillShadowBlur != null ? block.pillShadowBlur : 30;
        var _ss = block.pillShadowSpread != null ? block.pillShadowSpread : 0;
        var _scol = block.pillShadowColor || "#000000";
        var _sop = block.pillShadowOpacity != null ? block.pillShadowOpacity : 35;
        wrap.style.setProperty("--nav-pill-shadow", _sx + "px " + _sy + "px " + _sb + "px " + _ss + "px color-mix(in srgb, " + _scol + " " + _sop + "%, transparent)");
      }
      // author pill size: width caps the pill (max-width), height sets a min-height (contents
      // stay vertically centred); blank = the CSS defaults (max-width 460px / content height).
      if (block.pillWidth != null) wrap.style.setProperty("--nav-pill-width", block.pillWidth + "px");
      if (block.pillHeight != null) {
        wrap.style.setProperty("--nav-pill-height", block.pillHeight + "px");
        // --pill-scale drives the height-contributing dimensions (icons, title, bar height,
        // gaps, vertical padding) so the pill CONTENTS shrink to fit + stay centred as it slims.
        // Ref 46px = the natural pill height; capped at 1 so a TALLER pill keeps natural sizing.
        wrap.style.setProperty("--pill-scale", Math.max(0.2, Math.min(1, block.pillHeight / 46)).toFixed(3));
      }
      // §1: push the light/dark + glossary glyphs toward the pill edges (0 = centred in
      // their side slots). One value nudges both symmetrically (left glyph left, right right).
      if (block.pillGlyphNudge != null) wrap.style.setProperty("--pill-glyph-nudge", block.pillGlyphNudge + "px");
      // stroke: off -> width 0 (border vanishes); on -> author width (default 1px).
      if (block.pillStroke === false) wrap.style.setProperty("--nav-pill-border-width", "0");
      else if (block.pillStrokeWidth != null) wrap.style.setProperty("--nav-pill-border-width", block.pillStrokeWidth + "px");
      // pill surface opacity (0-100 -> a % into the color-mix; 100/absent = fully opaque).
      if (block.pillOpacity != null) wrap.style.setProperty("--nav-pill-opacity", block.pillOpacity + "%");
      // pill layer blur (px backdrop-filter behind the pill; 0/absent = no blur).
      if (block.pillBlur != null) wrap.style.setProperty("--nav-pill-blur", block.pillBlur + "px");
      // progress bar colours: fill (the advancing bar) + track (its groove).
      if (block.barFill) wrap.style.setProperty("--nav-bar-fill", block.barFill);
      if (block.barTrack) wrap.style.setProperty("--nav-bar-track", block.barTrack);
      if (block.showBar !== false) {
        var prog = el("div", "course-nav__progress");
        prog.setAttribute("role", "button");
        prog.setAttribute("tabindex", "0");
        prog.setAttribute("aria-label", "Course progress — open chapter list");
        // light/dark toggle glyph in the pill's LEFT slot (opt-in, default on). Reuses
        // the [data-mode-toggle] binding, so the runtime/export flips light/dark.
        var mt = null;
        if (block.showModeToggle !== false) {
          mt = el("button", "course-nav__mode mode-toggle mode-toggle--icon");
          mt.type = "button"; mt.setAttribute("data-mode-toggle", "1");
          mt.setAttribute("aria-label", "Switch light / dark mode"); mt.title = "Switch light / dark mode";
          mt.innerHTML = '<span class="mode-toggle__glyph mode-toggle__to-dark"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8z"/></svg></span>'
            + '<span class="mode-toggle__glyph mode-toggle__to-light"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg></span>';
          prog.appendChild(mt);
        }
        var main = el("div", "course-nav__progress-main");
        var track = el("div", "course-nav__bar");
        track.appendChild(el("div", "course-nav__fill"));
        // §1 P2: title on TOP, bar below — the two form a group centred on the pill midline.
        // toggle swaps them too (content-addressed, same as block text).
        main.appendChild(stampChrome(el("span", "course-nav__label", block.menuLabel || "Menu"), block.menuLabel || "Menu"));
        main.appendChild(track);
        prog.appendChild(main);
        var modal = el("div", "course-nav__modal");
        modal.hidden = true;
        modal.appendChild(stampChrome(el("div", "course-nav__modal-title", block.jumpTitle || "Jump to chapter"), block.jumpTitle || "Jump to chapter"));
        // explicit close affordance in the top-right (mirrors the outside-click dismiss).
        var mclose = el("button", "course-nav__modal-close");
        mclose.type = "button";
        mclose.setAttribute("aria-label", "Close");
        mclose.setAttribute("data-modal-close", "1");
        mclose.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
        modal.appendChild(mclose);
        var list = el("div", "course-nav__modal-list");
        secs.forEach(function (s) {
          var j = el("button", "course-nav__jump");
          j.type = "button";
          if (s.pages[0]) j.setAttribute("data-goto", s.pages[0]);
          j.appendChild(el("span", "course-nav__jump-dot"));
          // stamp the chapter label for the learner language swap (content-addressed,
          // same as menuLabel/jumpTitle). In the demo/export __navSections is built from
          // the English doc so the hash matches the baked index; on the author canvas it
          // is built from the resolved doc.
          j.appendChild(stampChrome(el("span", "course-nav__jump-label", s.label), s.label));
          list.appendChild(j);
        });
        modal.appendChild(list);
        prog.appendChild(modal);
        wrap.appendChild(prog);
      }
      if (block.showNext !== false) {
        var next = el("button", "course-nav__btn course-nav__next");
        next.type = "button";
        next.setAttribute("data-nav-action", "next");
        next.setAttribute("aria-label", block.nextLabel || "Next");
        next.appendChild(el("span", "course-nav__btn-label", block.nextLabel || "Next"));
        next.appendChild(navArrow("right"));
        wrap.appendChild(next);
        // Interaction-gate reminder: rendered HIDDEN + floated above the pill; the runtime
        // reveals it (and flashes it on a gated Next click) while the current page's
        // interactions aren't complete. Default copy, author-overridable via the
        // __gateMessage per-pass hook (doc.gateMessage). Pure: render only emits the element.
        var gh = el("div", "course-nav__gate-hint");
        gh.setAttribute("data-gate-hint", "1");
        gh.hidden = true;
        gh.appendChild(el("span", "course-nav__gate-hint-icon", "!"));
        gh.appendChild(el("span", "course-nav__gate-hint-text", window.__gateMessage || "Complete the interactions on this page to continue."));
        wrap.appendChild(gh);
      }
      // §1 glossary: a doc-wide term/definition list, opened from a button IN the
      // footer pill. Rendered only when the author added glossary terms
      // (window.__glossaryTerms, an array of {term,def} set per render pass). The
      // list + live filter input are emitted as STATIC DOM; runtime.js owns the
      // open/close + case-insensitive filter (the pure-render invariant holds — no
      // behaviour here). Ships self-contained (plain text) in the air-gapped package.
      var gterms = window.__glossaryTerms;
      if (gterms && gterms.length) {
        var gbtn = el("button", "course-nav__glossary course-nav__glossary--icon");
        gbtn.type = "button";
        gbtn.setAttribute("data-nav-action", "glossary");
        gbtn.setAttribute("aria-label", block.glossaryLabel || "Glossary");
        gbtn.title = block.glossaryLabel || "Glossary";
        // an open-book glyph in the pill's RIGHT slot — mirrors the mode-toggle glyph
        // on the LEFT so the pill reads symmetric (icon · progress · icon).
        gbtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10.4 5.1 7.9 4.6 5.5 5.4V19c2.4-.8 4.9-.3 6.5 1.1 1.6-1.4 4.1-1.9 6.5-1.1V5.4C16.1 4.6 13.6 5.1 12 6.5z"/><path d="M12 6.5V20"/></svg>';
        var gpill = wrap.querySelector(".course-nav__progress");
        (gpill || wrap).appendChild(gbtn);
        // anchored popover ABOVE the pill, right-aligned (mirrors the chapter modal +
        // the redesign's glossary card). Same surface/border/motion as the chapter modal.
        var gpop = el("div", "glossary-pop");
        gpop.hidden = true;
        gpop.setAttribute("data-glossary-pop", "1");
        gpop.appendChild(stampChrome(el("div", "glossary-pop__title", block.glossaryLabel || "Glossary"), block.glossaryLabel || "Glossary"));
        var gsearch = el("div", "glossary-pop__search");
        gsearch.innerHTML = '<svg class="glossary-pop__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
        var ginput = el("input", "glossary-pop__input");
        ginput.type = "text";
        ginput.setAttribute("data-glossary-filter", "1");
        ginput.setAttribute("placeholder", "Filter terms");
        ginput.setAttribute("aria-label", "Filter glossary terms");
        gsearch.appendChild(ginput);
        gpop.appendChild(gsearch);
        var glist = el("div", "glossary-pop__list");
        gterms.forEach(function (t) {
          var trm = (t && t.term != null) ? String(t.term) : "";
          var def = (t && t.def != null) ? String(t.def) : "";
          var grow = el("div", "glossary-pop__row");
          // lower-cased haystack (term + def) so the runtime filter is a plain substring
          // test with no per-keystroke re-lowercasing of the source text.
          grow.setAttribute("data-term", (trm + " " + def).toLowerCase());
          grow.appendChild(stampChrome(el("div", "glossary-pop__term", trm), trm));
          grow.appendChild(stampChrome(el("div", "glossary-pop__def", def), def));
          glist.appendChild(grow);
        });
        gpop.appendChild(glist);
        // shown by runtime.js only when the filter matches nothing.
        var gempty = el("div", "glossary-pop__empty", "No matching terms.");
        gempty.hidden = true;
        gpop.appendChild(gempty);
        (gpill || wrap).appendChild(gpop);
      }
      // Guided tour (opt-in). Pure render emits one coach-mark as a child of each
      // PRESENT footer control (absent controls are skipped). Markers stay hidden
      // (course.css) until runtime.js adds .is-tour-live on the trigger page, so the
      // author canvas is untouched and demo == export. data-tour-page carries the
      // trigger ("" = every page); runtime reads it.
      if (block.tour && block.tour.on) {
        wrap.setAttribute("data-tour-page", block.tour.page || "");
        [["prev", ".course-nav__prev"], ["mode", ".course-nav__mode"],
         ["menu", ".course-nav__progress-main"], ["glossary", ".course-nav__glossary"],
         ["next", ".course-nav__next"]].forEach(function (t) {
          var btn = wrap.querySelector(t[1]);
          if (btn) btn.appendChild(tourMarker(block, t[0]));
        });
      }
      return wrap;
    },

    // Quiz: a multi-question assessment that runs as one block. render() is PURE
    // and emits the whole thing as static, editable DOM with the answer keys /
    // settings as data-* attributes and [data-correct] on options. On the editor
    // canvas this is the AUTHOR view (everything visible, correct answers badged
    // by editor.css, text editable in place). In demo + the shipped SCORM course
    // quiz-runtime.js reads this DOM and drives the stepped play experience. No
    // runtime behaviour lives here, so the invariant holds.
    quiz: function (block) {
      var root = el("div", "quiz kc");
      root.setAttribute("data-quiz", "1");
      var s = block.settings || {};
      block.done = block.done || {};
      // per-quiz colour overrides: set the theme CSS vars inline on the quiz root
      // so they cascade to every component inside it (pills, chips, cards,
      // progress, feedback, buttons). Absent = inherit the course theme. Pure data
      // on the block, so it ships in the export unchanged.
      if (block.colors) Object.keys(block.colors).forEach(function (k) {
        var v = block.colors[k], cssVar = QUIZ_COLOR_VARS[k];
        if (v && cssVar) root.style.setProperty(cssVar, v);
      });
      root.setAttribute("data-intro", block.intro && block.intro.on ? "1" : "0");
      root.setAttribute("data-retry", block.done.retry && block.done.retry.on ? "1" : "0");
      root.setAttribute("data-shuffle-q", s.shuffleQuestions ? "1" : "0");
      root.setAttribute("data-shuffle-o", s.shuffleOptions ? "1" : "0");
      root.setAttribute("data-confetti", s.confetti ? "1" : "0"); // celebrate on pass (author opt-in)

      // persistent header: kicker + live counter, then the title + progress bar
      var head = el("div", "kc-head");
      head.appendChild(editable("span", "kc-kicker", block, "kicker", false));
      head.appendChild(el("span", "kc-counter", "Question 1 of " + ((block.questions || []).length || 1)));
      root.appendChild(head);
      root.appendChild(editable("h1", "kc-title", block, "title", true));
      var prog = el("div", "kc-progress");
      (block.questions || []).forEach(function () { var seg = el("div", "kc-seg"); seg.appendChild(el("i")); prog.appendChild(seg); });
      root.appendChild(prog);

      if (block.intro && block.intro.on) {
        var introP = el("div", "kc-panel kc-intro");
        introP.appendChild(editable("p", "kc-intro__body", block.intro, "body", true));
        var startBtn = editable("button", "kc-start", block.intro, "startLabel", false);
        startBtn.setAttribute("type", "button");
        introP.appendChild(startBtn);
        root.appendChild(introP);
      }

      var qwrap = el("div", "kc-questions");
      (block.questions || []).forEach(function (q, qi) {
        var type = q.type || "multipleChoice";
        var qEl = el("div", "kc-panel kc-q");
        qEl.setAttribute("data-qid", q.id || ("q" + qi));
        qEl.setAttribute("data-qtype", type);
        qEl.appendChild(editable("div", "kc-method", q, "methodLabel", false));
        if (type === "fillBlank") {
          var sent = el("p", "kc-sentence");
          sent.appendChild(editable("span", "kc-stem", q, "stemBefore", false));
          sent.appendChild(document.createTextNode(" "));
          sent.appendChild(el("span", "kc-blank", "select below"));
          sent.appendChild(document.createTextNode(" "));
          sent.appendChild(editable("span", "kc-stem", q, "stemAfter", false));
          qEl.appendChild(sent);
          var chips = el("div", "kc-chips");
          (q.options || []).forEach(function (opt, oi) {
            var chip = editable("button", "kc-chip", opt, "text", false);
            chip.setAttribute("type", "button");
            chip.setAttribute("data-correct", opt.correct ? "true" : "false");
            chip.setAttribute("data-oi", oi);
            chips.appendChild(chip);
          });
          qEl.appendChild(chips);
        } else if (type === "cardSort") {
          var sort = el("div", "kc-sort");
          var pool = el("div", "kc-sort__pool");
          (q.cards || []).forEach(function (card, ci) {
            var c = editable("button", "kc-card", card, "text", false);
            c.setAttribute("type", "button");
            c.setAttribute("data-cat", card.categoryId || "");
            c.setAttribute("data-ci", ci);
            pool.appendChild(c);
          });
          if (!(q.cards || []).length) pool.appendChild(el("div", "quiz-empty", "No cards yet"));
          sort.appendChild(pool);
          var cats = el("div", "kc-sort__cats");
          (q.categories || []).forEach(function (cat) {
            var col = el("div", "kc-cat");
            col.setAttribute("data-cat", cat.id);
            col.appendChild(editable("div", "kc-cat__label", cat, "label", false));
            col.appendChild(el("div", "kc-cat__drop"));
            cats.appendChild(col);
          });
          sort.appendChild(cats);
          qEl.appendChild(sort);
        } else {
          qEl.appendChild(editable("p", "kc-qtext", q, "prompt", true, "promptStyle"));
          var pills = el("div", "kc-pills");
          (q.options || []).forEach(function (opt, oi) {
            var pill = el("button", "kc-pill");
            pill.setAttribute("type", "button");
            pill.setAttribute("data-correct", opt.correct ? "true" : "false");
            pill.setAttribute("data-oi", oi);
            pill.appendChild(el("span", "kc-pill__letter", String.fromCharCode(65 + oi)));
            pill.appendChild(editable("span", "kc-pill__text", opt, "text", false));
            pills.appendChild(pill);
          });
          qEl.appendChild(pills);
        }
        // author-editable feedback text (runtime reads these, then fills .kc-feedback)
        var holder = el("div", "kc-fb-holder");
        holder.appendChild(editable("div", "kc-fb kc-fb--good", q, "feedbackCorrect", true, "feedbackCorrectStyle"));
        holder.appendChild(editable("div", "kc-fb kc-fb--bad", q, "feedbackIncorrect", true, "feedbackIncorrectStyle"));
        qEl.appendChild(holder);
        qEl.appendChild(el("div", "kc-feedback"));
        var actions = el("div", "kc-actions");
        var next = el("button", "kc-next", "Next Question");
        next.setAttribute("type", "button");
        actions.appendChild(next);
        qEl.appendChild(actions);
        qwrap.appendChild(qEl);
      });
      if (!(block.questions || []).length) qwrap.appendChild(el("div", "quiz-empty", "No questions yet — add one from the panel."));
      root.appendChild(qwrap);

      var done = el("div", "kc-panel kc-done");
      var badge = el("div", "kc-done__badge");
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      done.appendChild(badge);
      done.appendChild(editable("h2", "kc-done__title", block.done, "title", true, "titleStyle"));
      done.appendChild(editable("p", "kc-done__body", block.done, "body", true, "bodyStyle"));
      // §64 chapter summary: a purpose-built bulleted list ON the completion panel —
      // the author pastes the chapter's dot-point summary here and it shows ONLY after
      // the knowledge check is passed (the kc-done panel is itself pass-gated at
      // runtime). It IS the list block's editable <ul> primitive (bare <li> items as
      // innerHTML, Enter adds rows). An empty summary still needs one clickable bullet
      // so the author has a caret target to start typing (an empty <ul> has none, and
      // Enter can't clone a row); the runtime hides an all-empty summary via CSS so this
      // seed never shows to a learner. Replaces the retired per-block recap flag.
      var sumWrap = el("div", "kc-done__summary-wrap");
      sumWrap.appendChild(el("div", "kc-done__summary-label", "Chapter summary"));
      var sum = editable("ul", "kc-done__summary", block.done, "summary", true, "summaryStyle");
      if (!/<li/i.test(sum.innerHTML)) sum.innerHTML = "<li></li>";
      sumWrap.appendChild(sum);
      done.appendChild(sumWrap);
      if (block.done.retry && block.done.retry.on) {
        var retry = editable("button", "kc-retry", block.done.retry, "label", false);
        retry.setAttribute("type", "button");
        done.appendChild(retry);
      }
      root.appendChild(done);
      return root;
    },

    // HTML Interaction: a self-built interaction, either pasted inline (srcdoc)
    // or a bundled local file (src), shown in a sandboxed iframe (Captivate Web
    // Object pattern). Empty -> a selectable placeholder (no iframe, so it can be
    // clicked to select and told to paste code). Title is optional.
    htmlEmbed: function (block) {
      var wrap = el("div", "embed embed--html");
      wrap.setAttribute("data-embed", "html");
      // Item Z: how this interaction reacts to a learner mode flip (parent reads
      // this off the DOM and passes it in the theme message — serialisation-safe).
      wrap.setAttribute("data-theme-fallback", block.themeFallback || "tokens");
      // Phase 2: bake the resolved interaction-var -> theme mapping so the shim can
      // re-theme the interaction's own palette (see resolveEmbedColorMap).
      var __em = resolveEmbedColorMap(block);
      if (Object.keys(__em).length) wrap.setAttribute("data-embed-colormap", JSON.stringify(__em));
      wrap.__block = block;
      if (block.title) wrap.appendChild(el("div", "embed__cap", block.title));
      // block.html may be an asset ref / data: URL / raw markup -> resolve to raw.
      // A bundled-file interaction (block.src) is likewise decoded to raw markup so
      // BOTH paths get mojibake-repaired and rendered via srcdoc (with the theme shim).
      // Only when block.src can't be decoded to markup (an opaque blob:/http path) do
      // we fall back to a plain src= load, which we can't repair or theme.
      var __embedHtml = repairMojibake(resolveEmbedHtml(block.html));
      var __srcHtml = block.src ? repairMojibake(resolveEmbedHtml(block.src)) : "";
      var __html = __embedHtml || __srcHtml;
      if (__html || block.src) {
        // fit wrapper: a fixed-size interaction (many are, e.g. 860px) is scaled
        // by the editor/export to the available width so it never overflows.
        var fit = el("div", "embed__fit");
        var frame = document.createElement("iframe");
        frame.className = "embed__iframe";
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin"); // our own bundled files
        frame.setAttribute("loading", "lazy");
        frame.style.width = "100%"; // fitEmbeds() overrides to the design width + scale
        frame.style.height = (block.height || 500) + "px";
        applyEmbedStyle(frame, block);
        // srcdoc interactions get the theme-listener shim baked in (Item Z), so
        // they follow the learner light/dark toggle. Bundled-file (src) ones can't
        // be modified here; the parent injects the shim into them on first push.
        if (__html) frame.setAttribute("srcdoc", __html + "\n<script>" + EMBED_THEME_SHIM + "</scr" + "ipt>");
        else frame.setAttribute("src", assetSrc(block.src));
        fit.appendChild(frame);
        wrap.appendChild(fit);
      } else {
        wrap.classList.add("embed--empty");
        var ph = el("div", "embed__empty-hint");
        ph.style.minHeight = (block.height || 200) + "px";
        ph.appendChild(el("div", "embed__empty-title", "HTML Interaction"));
        ph.appendChild(el("div", "embed__empty-sub", "Select this block and paste your HTML code in the panel"));
        wrap.appendChild(ph);
      }
      return wrap;
    },

    // Web Embed: external URL, rendered as a LIVE player in the editor (Vimeo /
    // YouTube get their player iframe; anything else is a generic iframe). Export
    // will self-host Vimeo as <video> for air-gap safety; the editor shows the
    // real thing so you can see what you're placing.
    webEmbed: function (block) {
      var info = parseVideo(block.url);
      var wrap = el("div", "embed embed--web embed--filled");
      wrap.setAttribute("data-embed", "web");
      wrap.__block = block;
      if (block.embedBg) wrap.style.background = block.embedBg; // #176: author-settable letterbox fill (else CSS var(--color-bg) wins)
      if (block.localVideo) {
        wrap.classList.add("embed--video"); // theme-bg wrapper (no black bars) — same as Vimeo
        var vid = document.createElement("video");
        vid.className = "embed__iframe embed__video";
        vid.setAttribute("controls", "");
        vid.setAttribute("preload", "metadata");
        vid.style.height = (block.height || 360) + "px";
        vid.style.aspectRatio = "16 / 9";
        vid.style.width = "auto";
        vid.style.maxWidth = "100%";
        applyEmbedStyle(vid, block);
        vid.src = assetSrc(block.localVideo);
        wrap.appendChild(vid);
        return wrap;
      }
      if (info.provider === "empty") {
        wrap.classList.add("embed--empty");
        var ph = el("div", "embed__empty-hint");
        ph.style.minHeight = "160px";
        ph.appendChild(el("div", "embed__empty-title", "Web Embed"));
        ph.appendChild(el("div", "embed__empty-sub", "Select this block and paste a Vimeo / YouTube / embed URL"));
        wrap.appendChild(ph);
        return wrap;
      }
      var src = info.provider === "vimeo" ? "https://player.vimeo.com/video/" + info.id + "?" + (info.hash ? "h=" + info.hash + "&" : "") + "badge=0&autopause=0&title=0&byline=0&portrait=0&player_id=0&app_id=58479"
        : info.provider === "youtube" ? "https://www.youtube.com/embed/" + info.id
          : info.url;
      var frame = document.createElement("iframe");
      frame.className = "embed__iframe embed__video";
      frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      frame.setAttribute("allowfullscreen", "");
      frame.setAttribute("loading", "lazy");
      frame.style.height = (block.height || 360) + "px";
      // Managed letterbox fill (#176) is on EVERY web embed via .embed--filled
      // (set on wrap above): it paints any space around the media with the
      // letterbox colour (author's embedBg, else theme var(--color-bg), tracks
      // light/dark) — no unmanaged white bands on ANY provider. #180: ONLY real
      // media (Vimeo/YouTube here, self-hosted above) additionally gets
      // .embed--video, which centres the player and forces a 16:9 iframe so the
      // video FILLS it (killing the player's own black letterbox). Generic
      // (non-video) URLs keep their full-width iframe + authored height — the
      // filled background still supplies the managed surround. Bundling the two
      // concerns collapsed generic (e.g. Microsoft Forms) embeds to width:auto.
      if (info.provider === "vimeo" || info.provider === "youtube") {
        wrap.classList.add("embed--video");
        frame.style.aspectRatio = "16 / 9";
        frame.style.width = "auto";
        frame.style.maxWidth = "100%";
      }
      applyEmbedStyle(frame, block);
      frame.setAttribute("src", src);
      wrap.appendChild(frame);
      return wrap;
    },

    // Image hotspots: a base image/SVG with clickable "i" markers overlaid at
    // per-cent positions. Each marker owns a hidden anchored popover whose content
    // is composed of ORDINARY child blocks (subheading + paragraph + optional
    // image) rendered by the same renderBlock — so the popover copy is rich-text
    // editable, styleable and image-capable through the existing machinery, with
    // zero new content pipeline. render() stays PURE: markers/popovers are static
    // DOM; the open/close + positioning behaviour lives in runtime.js (shared by
    // demo + the exported SCORM package, like the quiz author-view pattern).
    hotspot: function (block) {
      // Unified screen-graph model (#215/#216, ADR-0003): block.screens[] are
      // first-class Screen nodes ({ id, visual, kind, playback, replay, alt,
      // markers[] }); a Marker action is "card" (anchored popover of child blocks)
      // or "navigate" (target screen id); block.entry names the entry screen. A
      // marker can target ANY screen and every screen carries its OWN markers, so
      // screens form a directed graph the learner walks to arbitrary depth (#216):
      // each non-entry screen renders as a hidden PANEL (its visual + its markers)
      // that the runtime swaps in on navigate, with a back-stack Back + an optional
      // Home. Popover-only and one-level hub-and-spoke are special cases of this one
      // model — legacy blocks reach it via migrateHotspotBlock at doc load, so this
      // is the SINGLE render path (parity guarded in tests/run.js). render stays
      // PURE; screen swap + back-stack + Home + open/close live in runtime.js.
      var screens = Array.isArray(block.screens) ? block.screens : [];
      var byId = {};
      screens.forEach(function (s) { if (s && s.id) byId[s.id] = s; });
      var entry = byId[block.entry] || screens[0] || { id: "scr-entry", markers: [] };
      // screen chrome is derived from marker ACTIONS, not a stored mode: any
      // navigate marker anywhere => a tour (Back + panels); "deep" (a navigate
      // marker on a NON-entry screen) => the graph can exceed one level, which is
      // the only case that needs Home (Back from depth 1 already lands on entry).
      var screenMode = false, deep = false;
      screens.forEach(function (s) {
        if (!s) return;
        (s.markers || []).forEach(function (m) {
          if (m && m.action === "navigate") { screenMode = true; if (s !== entry) deep = true; }
        });
      });
      var homeOn = screenMode && deep && block.home !== false;
      // #224 T6: a LOOP is an ordered set of member screens a single navigate marker drops
      // the learner into as a forward/back carousel (showcase one UI across its states with
      // one link). Membership + order + wrap drive the output; the loop's editor-only board
      // coords (bx/by/bw/bh) are NOT read, so render stays a pure fn of the doc. Members are
      // ordinary screens (already emitted as hidden panels below), so a loop only adds hidden
      // metadata + the shared carousel control -- both GATED on a loop actually being targeted
      // so a tour with no loops renders byte-identically (the frozen render-parity contract).
      var loops = Array.isArray(block.loops) ? block.loops : [];
      var loopById = {}; loops.forEach(function (l) { if (l && l.id) loopById[l.id] = l; });
      var hasLoopTarget = false;
      screens.forEach(function (s) { (s && s.markers || []).forEach(function (m) { if (m && m.action === "navigate" && m.target && loopById[m.target] && (loopById[m.target].screens || []).length) hasLoopTarget = true; }); });
      var wrap = el("div", "block-hotspot");
      wrap.setAttribute("data-hotspot-block", "1");
      wrap.setAttribute("data-mode", screenMode ? "screen" : "popover");
      // learner progress: markers gain .is-viewed once opened (runtime-driven, so
      // render stays unviewed-first). Opt-out via block.trackViewed === false.
      wrap.setAttribute("data-track-viewed", block.trackViewed === false ? "0" : "1");
      // #218 completion/gating: default rule = every screen visited (runtime tracks it +
      // emits the existing `hotspot-complete` auto-gate signal); an optional
      // completion screen finishes the tour on arrival. Labels ride the DOM so the
      // learner Navigation trail (below) can name each crumb without re-reading the doc.
      function scrLabel(s, i) { return (s && s.name) || (s === entry ? "Home" : "Screen " + i); }
      var stage = el("div", "hotspot-stage");
      stage.setAttribute("data-popover-place", block.popoverPlace || "auto"); // author popover placement (positionPopover reads it)
      stage.setAttribute("data-hotspot-entry", entry.id || ""); // runtime "Home"/base target
      stage.setAttribute("data-hotspot-entry-name", scrLabel(entry, screens.indexOf(entry)));
      if (entry.caption) stage.setAttribute("data-hotspot-entry-caption", entry.caption); // caption sync (entry has no panel)
      if (block.completionScreen && byId[block.completionScreen]) stage.setAttribute("data-hotspot-complete-screen", block.completionScreen);
      // #146: the STAGE spans the full page width (popover space); the IMAGE + its
      // markers live in an inner .hotspot-frame that is sized (block.imgWidth %, default
      // 100) and CENTRED within the stage. So a narrower product SVG stays centred with
      // empty margin to the sides, and a popover (a child of the stage, not the frame)
      // can open into that margin instead of covering the image. Marker %-coords stay
      // relative to the FRAME (= the image), so alignment is unchanged at 100%.
      var frame = el("div", "hotspot-frame");
      var imgW = (block.imgWidth == null ? 100 : block.imgWidth);
      if (imgW !== 100) frame.style.setProperty("--hotspot-img-width", imgW + "%");
      // Blend mode (#178): blend the base image against the page behind it, same as the
      // image block. --img-blend on the frame -> .hotspot-image reads it (course.css); the
      // opaque screen-mode swap panels (.hotspot-screen) are left un-blended. Unset ->
      // normal. .hotspot-frame is a plain position:relative box (no stacking context), so
      // the blend reaches the page (unlike inside a card — see #178 card content fix).
      if (block.blendMode && block.blendMode !== "normal") frame.style.setProperty("--img-blend", block.blendMode);
      // Top band ABOVE the screen: the "screens visited" counter anchors here (top-right).
      var topbar = el("div", "hotspot-topbar");
      stage.appendChild(topbar);
      // 1px playback progress bar along the BOTTOM of the screen, for video screens; the runtime
      // sets its width from the current screen's video (data-hotspot-vprogress).
      if (screens.some(function (s) { return s && s.kind === "video"; })) {
        var vprog = el("div", "hotspot-video-progress");
        vprog.setAttribute("data-hotspot-vprogress", "1");
        frame.appendChild(vprog);
      }
      stage.appendChild(frame);
      // Chrome band BELOW the screen: nav buttons (author-toggleable) + the updating caption.
      // Empty band collapses (CSS :empty).
      var chrome = el("div", "hotspot-chrome");
      stage.appendChild(chrome);

      // Shared marker + card renderer: overlays each marker on its screen at %-coords,
      // and (for a card marker) appends its hidden anchored popover to the STAGE (the
      // runtime positions it against the live marker). A navigate marker carries
      // data-target = its destination screen id. Used for the entry base AND every
      // panel, so a marker renders identically no matter which screen it lives on.
      function renderMarkers(scr, container) {
        (scr && scr.markers || []).forEach(function (hs, i) {
          if (!hs) return;
          // WYSIWYG: the exact learner marker (also reused by the editor's tour board). A box is a
          // resizable transparent region (w x h % of the frame) highlighting UI without obscuring
          // it; a point is the badge/SVG/animation. x/y is the CENTRE so popover anchoring holds.
          var mk = hotspotMarkerEl(block, hs, i, loopById);
          // #53: on a play-once video screen set to reveal-after-end, markers start hidden and
          // are unhidden by the runtime once the video finishes (setupHotspotVideo "ended").
          if (scr && scr.kind === "video" && scr.playback === "once" && scr.revealAfterEnd) {
            mk.classList.add("hotspot-marker--gated");
            mk.setAttribute("data-reveal-after-end", "1");
          }
          container.appendChild(mk); // marker overlays its screen (the frame or a panel)

          if (hs.action !== "navigate") {
            var pop = el("div", "hotspot-popover");
            pop.setAttribute("data-hotspot-panel", hs.id);
            pop.hidden = true;
            var close = el("button", "hotspot-popover__close");
            close.type = "button";
            close.setAttribute("aria-label", "Close");
            close.innerHTML = "&times;";
            pop.appendChild(close);
            var content = el("div", "hotspot-popover__content");
            (hs.blocks || []).forEach(function (child) {
              var node = renderBlock(child);
              node.__block = child;
              content.appendChild(node);
            });
            pop.appendChild(content);
            applyPopoverStyle(pop, block.cardStyle);
            // Per-hotspot card size overrides the block-level cardStyle width. Width
            // wins over the shared value; height is a min-height so the card can grow
            // without clipping the pointer arrow (::after sits outside the box).
            if (hs.cardW) pop.style.width = hs.cardW + "px";
            if (hs.cardH) pop.style.minHeight = hs.cardH + "px";
            stage.appendChild(pop);
          }
        });
      }

      // Screen visual (#217): a video (screen recording) when kind==="video", else an
      // image/gif (<img>, or inlined SVG for vector art so a mono/line-art base recolours
      // to theme tokens per light/dark -- block-level mono/colorMap apply to the ENTRY
      // base only). render emits a STATIC, non-autoplaying <video> (muted, playsinline,
      // preload=metadata; loop mode carries the loop attr; play-once carries
      // data-hotspot-video="once"); runtime.js owns play-on-enter / freeze / replay /
      // reduced-motion. The video asset hoists + externalizes through the generic media
      // path (eachMediaSlot), so SCORM stays self-contained with no new mechanism.
      function visualNode(scr, cls, recolor) {
        if (scr.kind === "video" && scr.visual) {
          var v = document.createElement("video");
          v.className = cls + " hotspot-video";
          v.src = assetSrc(scr.visual);
          v.muted = true;
          v.setAttribute("muted", "");
          v.setAttribute("playsinline", "");
          v.setAttribute("preload", "metadata");
          v.setAttribute("data-hotspot-video", scr.playback === "once" ? "once" : "loop");
          if (scr.playback !== "once") v.setAttribute("loop", "");
          if (scr.playback === "once" && scr.replay === false) v.setAttribute("data-noreplay", "1");
          if (scr.alt) { v.setAttribute("role", "img"); v.setAttribute("aria-label", scr.alt); }
          return v;
        }
        var svg = recolor
          ? inlineSvg({ src: scr.visual, mono: block.mono, colorMap: block.colorMap })
          : inlineSvg({ src: scr.visual });
        if (svg) {
          svg.setAttribute("class", cls);
          if (scr.alt) svg.setAttribute("role", "img"), svg.setAttribute("aria-label", scr.alt);
          return svg;
        }
        var img = document.createElement("img");
        img.className = cls;
        img.src = assetSrc(scr.visual); img.alt = scr.alt || "";
        return img;
      }

      if (entry.visual) {
        frame.appendChild(visualNode(entry, "hotspot-image", true));
      } else {
        var ph = el("div", "hotspot-stage__empty");
        ph.appendChild(el("div", "embed__empty-title", "Image hotspots"));
        ph.appendChild(el("div", "embed__empty-sub", "Select this block, then upload an image or SVG in the panel"));
        frame.appendChild(ph);
      }

      // Non-entry screens: each a hidden PANEL keyed by SCREEN id, holding its own
      // visual + its own markers. The runtime shows one at a time as the learner
      // navigates (screen swap), so a marker on any screen can reach any other.
      screens.forEach(function (s, si) {
        if (!s || s === entry || !s.id) return;
        var panel = el("div", "hotspot-screen");
        panel.setAttribute("data-screen-id", s.id);
        panel.setAttribute("data-screen-name", scrLabel(s, si));
        if (s.caption) panel.setAttribute("data-screen-caption", s.caption); // caption sync
        panel.hidden = true;
        if (s.visual) panel.appendChild(visualNode(s, "hotspot-screen__img", false));
        renderMarkers(s, panel);
        frame.appendChild(panel);
      });

      // entry markers overlay the base image (frame)
      renderMarkers(entry, frame);

      // screen-mode chrome: Back retraces the learner's path one step; Home (deep
      // tours only, author-optional) jumps to the entry screen. Both hidden until a
      // destination screen is open. Wrapped in .hotspot-nav so they sit together.
      if (screenMode && !block.hideNav) {
        var nav = el("div", "hotspot-nav");
        var back = el("button", "hotspot-back", block.backLabel || "Back");
        back.type = "button";
        back.setAttribute("data-hotspot-back", "1");
        back.hidden = true;
        nav.appendChild(back);
        if (homeOn) {
          var home = el("button", "hotspot-home", block.homeLabel || "Home");
          home.type = "button";
          home.setAttribute("data-hotspot-home", "1");
          home.hidden = true;
          nav.appendChild(home);
        }
        chrome.appendChild(nav); // #52: below the screen frame, not over the image
      }
      // #224 T6b + QA: loop MODAL. Emit each targeted loop's membership/order/wrap as a hidden
      // metadata node (runtime reads it to know a data-target is a loop), plus ONE shared modal
      // dialog: entering a loop opens a contained card over a dimmed backdrop that isolates the
      // loop's screens + Prev/Next from the rest of the tour (a distinct sub-mode, so the nav
      // order stays legible). The runtime RELOCATES the current member's .hotspot-screen panel
      // into the modal stage (reusing the real rendered visual, no duplication) and returns it
      // on exit. All gated on hasLoopTarget so a no-loop tour is byte-unchanged.
      if (hasLoopTarget) {
        loops.forEach(function (l) {
          if (!l || !l.id || !(l.screens || []).length) return;
          var meta = el("div", "hotspot-loop");
          meta.setAttribute("data-loop-id", l.id);
          meta.setAttribute("data-loop-screens", (l.screens || []).join(","));
          if (l.wrap) meta.setAttribute("data-loop-wrap", "1");
          if (l.name) meta.setAttribute("data-loop-name", l.name);
          meta.hidden = true;
          stage.appendChild(meta);
        });
        var modal = el("div", "hotspot-loop-modal");
        modal.setAttribute("data-hotspot-loop-modal", "1");
        modal.hidden = true; // shown only while inside a loop
        var backdrop = el("div", "hotspot-loop-modal__backdrop"); backdrop.setAttribute("data-loop-close", "1");
        modal.appendChild(backdrop);
        var mcard = el("div", "hotspot-loop-modal__card");
        mcard.setAttribute("role", "dialog"); mcard.setAttribute("aria-modal", "true"); mcard.setAttribute("aria-label", "Screen states");
        var mhead = el("div", "hotspot-loop-modal__head");
        mhead.appendChild(el("span", "hotspot-loop-modal__title", "")).setAttribute("data-loop-title", "1");
        var mpos = el("span", "hotspot-loop-modal__pos"); mpos.setAttribute("data-loop-pos", "1"); mpos.setAttribute("aria-live", "polite"); mhead.appendChild(mpos);
        var mclose = el("button", "hotspot-loop-modal__close"); mclose.type = "button"; mclose.setAttribute("data-loop-close", "1"); mclose.setAttribute("aria-label", "Exit"); mclose.innerHTML = "&times;"; mhead.appendChild(mclose);
        mcard.appendChild(mhead);
        var mstage = el("div", "hotspot-loop-modal__stage"); mstage.setAttribute("data-loop-stage", "1"); mcard.appendChild(mstage);
        var mnav = el("div", "hotspot-loop-modal__nav");
        var mprev = el("button", "hotspot-loop-modal__btn hotspot-loop-modal__prev"); mprev.type = "button"; mprev.setAttribute("data-loop-prev", "1"); mprev.setAttribute("aria-label", "Previous");
        mprev.innerHTML = '<span class="hotspot-loop-modal__arrow">&lsaquo;</span> Prev';
        var mnext = el("button", "hotspot-loop-modal__btn hotspot-loop-modal__next"); mnext.type = "button"; mnext.setAttribute("data-loop-next", "1"); mnext.setAttribute("aria-label", "Next");
        mnext.innerHTML = 'Next <span class="hotspot-loop-modal__arrow">&rsaquo;</span>';
        mnav.appendChild(mprev); mnav.appendChild(mnext); mcard.appendChild(mnav);
        modal.appendChild(mcard);
        stage.appendChild(modal);
      }
      // Progress counter (when tracking is on): screen-mode counts SCREENS VISITED (the
      // #218 completion signal), popover-mode counts MARKERS VIEWED (unchanged). render
      // seeds it at 0; runtime bumps it (bindHotspots) and emits `hotspot-complete`.
      var totalMarkers = 0;
      screens.forEach(function (s) { if (s) totalMarkers += (s.markers || []).length; });
      if (block.trackViewed !== false) {
        var counterText = screenMode ? ("0 of " + screens.length + " screens visited")
          : (totalMarkers ? "0 of " + totalMarkers + " viewed" : "");
        if (counterText) {
          var counter = el("div", "hotspot-counter");
          counter.setAttribute("data-hotspot-counter", "1");
          counter.setAttribute("aria-live", "polite");
          counter.textContent = counterText;
          topbar.appendChild(counter); // anchor top-right ABOVE the screen
        }
      }
      // #218 Navigation trail (author-optional, off by default): a breadcrumb of the
      // screens the learner has walked, populated + wired by runtime.js. render emits an
      // empty, static <nav> landmark (below the image) so it stays PURE. Distinct from
      // the editor Inspector Breadcrumb -- this one ships in the course.
      if (block.trail && screenMode) {
        var trail = el("nav", "hotspot-trail");
        trail.setAttribute("data-hotspot-trail", "1");
        trail.setAttribute("aria-label", "Tour path");
        trail.hidden = true; // shown once the learner steps off the entry screen
        stage.appendChild(trail);
      }
      // Caption beneath the screen: a single line that updates to the CURRENT screen's caption as
      // the learner navigates (screen mode); in popover mode it shows the entry caption. Emitted
      // only when at least one screen has a caption. Runtime keeps its text in sync on nav.
      if (screens.some(function (s) { return s && s.caption; })) {
        var cap = el("div", "hotspot-caption", entry.caption || "");
        cap.setAttribute("data-hotspot-caption", "1");
        cap.setAttribute("aria-live", "polite");
        chrome.appendChild(cap);
      }
      // Restart glyph (centred over the screen, hidden): the runtime reveals it when the interaction
      // FINISHES -- a completed tour, or a play-once video ending -- so the learner can replay. Only
      // emitted where there's a natural finish (a screen tour, or a play-once video screen).
      if (screenMode || screens.some(function (s) { return s && s.kind === "video" && s.playback === "once"; })) {
        var rstb = el("button", "hotspot-restart");
        rstb.type = "button";
        rstb.setAttribute("data-hotspot-restart", "1");
        rstb.setAttribute("aria-label", "Restart");
        rstb.hidden = true;
        rstb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
        frame.appendChild(rstb);
      }
      wrap.appendChild(stage);
      return wrap;
    },

    componentGrid: function (block) {
      var wrap = el("div", block.className || "");
      // Columns / Gap are data on the block; .card-grid consumes them via CSS vars
      // (responsive rules still override at tablet/mobile).
      if (block.columns) wrap.style.setProperty("--grid-cols", block.columns);
      if (block.gap != null) wrap.style.setProperty("--grid-gap", block.gap + "px");
      var docComps = (window.Editor && window.Editor.getDoc && window.Editor.getDoc().components);
      // resolve doc override -> SHARED LIBRARY (cross-course single-source) -> built-in.
      var libComps = (window.LibraryStore && window.LibraryStore.components) || {};
      var def = (docComps && docComps[block.component]) || libComps[block.component] || (window.COMPONENTS || {})[block.component];
      if (!def) return el("div", "block-unknown", "[unknown component: " + block.component + "]");
      
      if (!def.render) {
        def.render = function (instance, ctx) {
          var card = ctx.el("article", "chapter-card generic-card");
          card.style.display = "flex";
          card.style.flexDirection = "column";
          card.style.gap = "8px";
          card.style.border = "1px solid var(--ui-line)";
          card.style.borderRadius = "12px";
          card.style.padding = "16px";
          card.style.background = "var(--ui-chrome)";
          
          if (def.slots.length > 0) {
            var badge = ctx.slot("div", "generic-card__badge", instance, def.slots[0].key);
            badge.style.alignSelf = "flex-start";
            badge.style.fontSize = "10px";
            badge.style.fontWeight = "bold";
            badge.style.textTransform = "uppercase";
            badge.style.background = "var(--ui-raise)";
            badge.style.padding = "4px 8px";
            badge.style.borderRadius = "4px";
            badge.style.color = "var(--ui-text-dim)";
            card.appendChild(badge);
          }
          def.slots.slice(1).forEach(function (slot, idx) {
            var tag = idx === 0 ? "h2" : "p";
            var className = idx === 0 ? "chapter-card__title" : "chapter-card__obj";
            var itemNode = ctx.slot(tag, className, instance, slot.key);
            if (idx === 0) {
              itemNode.style.margin = "4px 0";
              itemNode.style.fontSize = "16px";
            } else {
              itemNode.style.margin = "4px 0";
              itemNode.style.fontSize = "12px";
            }
            card.appendChild(itemNode);
          });
          return card;
        };
      }

      (block.instances || []).forEach(function (instance, i) {
        var node = def.render(instance, CTX);
        node.setAttribute("data-instance", block.component);
        if (instance.hidden) node.setAttribute("data-hidden", "true");
        if (instance.detached) node.setAttribute("data-detached", "true");
        if (instance.action && instance.action.goto) node.setAttribute("data-goto", instance.action.goto);
        node.__instance = instance;
        node.__block = block;
        node.__index = i;
        node.__def = def;
        wrap.appendChild(node);
      });
      return wrap;
    }
  };

  function renderBlock(block) {
    var fn = BLOCKS[block.type];
    var node;
    if (!fn) node = el("div", "block-unknown", "[unknown block: " + block.type + "]");
    else node = fn(block);
    node.classList.add("canvas-block");
    // hidden = visibility override (course.css drops it from the shipped page /
    // demo; editor.css re-shows it dimmed on the canvas so it stays reachable).
    if (block.hidden) node.setAttribute("data-hidden", "true");
    if (block.spaceTop != null) node.style.marginTop = block.spaceTop + "px";
    if (block.spaceBottom != null) node.style.marginBottom = block.spaceBottom + "px";
    applyBlockAppearance(node, block); // universal fill / border(colour+weight) / radius / text colour
    // A group is `display:contents` by default (an invisible pass-through whose
    // children flow into the parent) — which generates NO box, so alignSelf and
    // auto margins on it are silently ignored. When the author aligns a group
    // (horizontally OR vertically), promote it to a real flex-column item so the
    // alignment has a box to act on; its children still stack as before. Only when
    // an alignment is set -> plain groups keep display:contents (zero regression).
    if (block.type === "group" && (block.align || (block.valign && block.valign !== "top"))) {
      node.style.display = "flex";
      node.style.flexDirection = "column";
    }
    // Item D — universal per-element alignment. `block.align` (start|center|end)
    // maps to alignSelf, the cross-axis in any flex parent (headerFooter __extra region,
    // columns, frame). A no-op in the plain block-flow page column, so it is purely
    // additive and pure data -> ships in the export unchanged. data-align is the
    // stable hook (editor/tests/CSS) independent of the inline style.
    if (block.align) {
      node.setAttribute("data-align", block.align);
      // HTML interactions align via their INTERNAL fit offset (the wrap stays full-width);
      // a wrap-level alignSelf would shrink the wrap in the flex-column page and double-
      // shift it. Skip alignSelf for embeds — data-align still drives the fit runtime.
      if (block.type !== "htmlEmbed") node.style.alignSelf = block.align === "center" ? "center" : (block.align === "end" ? "flex-end" : "flex-start");
    }
    // Universal per-element VERTICAL alignment. `block.valign` (center|bottom;
    // top/absent = default) positions the block on the MAIN axis of its flex-column
    // parent (a columns column, a frame, the page) via AUTO MARGINS — the native
    // form of the manual "auto spacer above + below" trick: center -> top+bottom
    // auto, bottom -> top auto. Inert in plain page flow (no free vertical space),
    // so it's purely additive + pure data -> ships in the export. Unlike HORIZONTAL
    // align (alignSelf), htmlEmbed is NOT excluded here: the fit runtime owns the
    // embed's SCALE + HORIZONTAL offset (marginLeft on the inner iframe) but never
    // touches the outer .embed--html wrap's vertical margins, so auto-margins on the
    // wrap (a different axis) vertically position the whole interaction without
    // fighting the fit — bottom-align / centre an interaction in a taller column.
    if (block.valign && block.valign !== "top") {
      node.setAttribute("data-valign", block.valign);
      if (block.valign === "center") { node.style.marginTop = "auto"; node.style.marginBottom = "auto"; }
      else if (block.valign === "bottom") { node.style.marginTop = "auto"; }
    }
    // Interaction identity: a block that participates in an interaction (has an
    // interactions list, a gate, or was minted an id because it's referenced)
    // carries data-id so the runtime engine can bind + target it. render stays
    // PURE — behaviour lives in runtime.js; this is only the hook.
    if (block.id) node.setAttribute("data-id", block.id);
    // §64: the per-block "chapter recap" flag was RETIRED — the chapter summary now
    // lives in the native quiz's completion panel (kc-done__summary), which is itself
    // pass-gated, so there is no separate data-recap reveal path any more.
    applyGateState(node, block); // reflect INITIAL gate visual state (engine drives it live)
    return node;
  }

  // Reflect a gate's INITIAL visual state only (locked-first). The runtime engine
  // re-evaluates and unlocks/reveals when the condition holds; render never runs
  // the condition itself. disable -> greyed + .is-locked + aria-disabled; hide ->
  // native `hidden`. Optional `hint` renders as a caption the engine leaves alone.
  function applyGateState(node, block) {
    var g = block.gate; if (!g) return;
    var mode = g.mode === "hide" ? "hide" : "disable";
    node.setAttribute("data-gate", mode);
    if (mode === "hide") { node.hidden = true; }
    else { node.classList.add("is-locked"); node.setAttribute("aria-disabled", "true"); }
    if (g.hint) node.appendChild(el("div", "block-gate-hint", g.hint));
  }

  // Universal per-block appearance. `block.box` is a dedicated namespace so it
  // never collides with type-specific styling (frame fill, button stroke, embed
  // border, quiz colours). Only sets a property when present, so it is purely
  // additive and works on EVERY block, including the quiz. Pure data -> ships in
  // the export unchanged.
  // #127: per-TYPE default appearance (theme.blockStyles[type], reached via the
  // __blockStyles per-pass hook — set by the editor + export, never editor state) is
  // the BASELINE; the block's own `block.box` overrides it key-by-key. Pure merge,
  // extracted for the regression guard. Returns null when neither layer contributes.
  function resolveBlockBox(typeDef, box) {
    if (!typeDef && !box) return null;
    var eff = {};
    if (typeDef) for (var k in typeDef) if (Object.prototype.hasOwnProperty.call(typeDef, k)) eff[k] = typeDef[k];
    if (box) for (var k2 in box) if (Object.prototype.hasOwnProperty.call(box, k2)) eff[k2] = box[k2];
    return eff;
  }
  window.resolveBlockBox = resolveBlockBox; // headless guard hook
  function applyBlockAppearance(node, block) {
    var typeDef = (block && block.type && window.__blockStyles && window.__blockStyles[block.type]) || null;
    var b = resolveBlockBox(typeDef, block && block.box);
    if (!b) return;
    if (b.fill) node.style.background = b.fill;
    if (b.textColor) node.style.color = b.textColor;
    if (b.border) node.style.border = (b.borderWidth || 1) + "px solid " + (b.borderColor || "var(--color-hair)");
    if (b.radius != null && b.radius !== "") node.style.borderRadius = b.radius + "px";
  }

  function pageHasAutoSpacer(page) {
    return (page.blocks || []).some(function (b) { return b.type === "spacer" && b.auto; });
  }

  function buildPageSection(page) {
    var section = el("section", "page");
    // Auto vertical spacing is the DEFAULT: every page fills the viewport and
    // centres its content vertically (page.vAlign can opt out to "top"). A manual
    // auto-spacer still overrides by springing to take the free space.
    if (page.vAlign !== "top") section.classList.add("page--fill");
    if (page.vAlign) section.setAttribute("data-valign", page.vAlign);
    section.setAttribute("data-page-id", page.id);
    // Per-page interaction gate: hold this page's Next until its interactions are complete.
    // Tri-state: page.gateInteractions true/false is an explicit override; undefined inherits
    // the course default (doc.gateAllInteractions via the __gateAllInteractions per-pass hook).
    // Pure: render only stamps the flag; runtime observes completion + disables Next.
    var __gp = page.gateInteractions;
    if (__gp === true || (__gp == null && window.__gateAllInteractions)) section.setAttribute("data-gate-page", "1");
    (page.blocks || []).forEach(function (block) {
      var node = renderBlock(block);
      node.__block = block; // back-ref so the editor/outliner can map DOM <-> model
      section.appendChild(node);
    });
    return section;
  }

  // render a single block's DOM (used by the editor to re-render one block in
  // place, e.g. after pasting HTML code into an embed)
  window.renderOneBlock = function (block) {
    var node = renderBlock(block);
    node.__block = block;
    return node;
  };

  // Global headerFooter (header/footer) — document-level furniture rendered around the
  // page content on every page (unless a page opts out). Editable text binds to
  // the shared config object, so an edit updates it everywhere.
  function applyHeaderFooterBox(root, config, edge) {
    if (config.border === false) root.style[edge === "top" ? "borderTop" : "borderBottom"] = "none";
    else if (config.borderColor) root.style[edge === "top" ? "borderTopColor" : "borderBottomColor"] = config.borderColor;
    if (config.padX != null) { root.style.paddingLeft = config.padX + "px"; root.style.paddingRight = config.padX + "px"; }
    if (config.padY != null) { root.style.paddingTop = config.padY + "px"; root.style.paddingBottom = config.padY + "px"; }
  }
  function renderHeader(config) {
    var root = el("header", "course-header");
    // JJJ: opt-in pin-to-top. Pure CSS sticky in course.css -> ships in SCORM and
    // behaves identically in editor/demo/export (in the editor canvas there is no
    // scroll container so sticky degrades to normal flow -> invariant preserved).
    if (config.pinned) root.classList.add("course-header--pinned");
    applyHeaderFooterBox(root, config, "bottom");
    if (config.align === "between") root.style.justifyContent = "space-between";
    else if (config.align === "center") root.style.justifyContent = "center";
    var brand = el("div", "course-header__brand");
    if (config.logo) {
      // logoTint "auto" (default) recolours a mono logo to contrast the bg (see
      // course.css .course-header__img--auto + data-mode); "original" shows as-is
      var auto = (config.logoTint || "auto") !== "original";
      var img = document.createElement("img");
      img.className = "course-header__img" + (auto ? " course-header__img--auto" : "");
      img.src = assetSrc(config.logo); img.alt = "logo";
      img.style.height = (config.logoSize || 30) + "px";
      brand.appendChild(img);
    } else {
      brand.innerHTML =
        '<svg class="course-header__logo" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
        '<path d="M8.5 12l2.3 2.3L15.5 9.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>' +
        '<span class="course-header__word"><b>DRONE</b>SHIELD</span>';
    }
    root.appendChild(brand);
    var crumb = el("div", "course-header__crumb");
    crumb.appendChild(editable("span", "course-header__title", config, "title", true, "titleStyle"));
    crumb.appendChild(el("span", "course-header__sep", "|"));
    crumb.appendChild(editable("span", "course-header__sub", config, "subtitle", true, "subtitleStyle"));
    root.appendChild(crumb);
    appendHeaderFooterChildren(root, config, "course-header__extra");
    return root;
  }
  function renderFooter(config) {
    var root = el("footer", "course-footer");
    applyHeaderFooterBox(root, config, "top");
    var p = editable("p", "course-footer__text", config, "text", true);
    if (config.align) p.style.textAlign = config.align;
    if (config.textGap != null) p.style.marginTop = config.textGap + "px"; // HHHH: author control of the disclaimer<->nav gap
    // MMM: nav bar first, disclaimer BELOW it (was text-then-nav).
    appendHeaderFooterChildren(root, config, "course-footer__extra");
    // VVVV(3): global toggle to remove the footer disclaimer text (e.g. for the
    // clean floating-pill footer). Pure data on the doc; ships in export.
    if (!config.hideText) root.appendChild(p);
    return root;
  }
  // Item X — headerFooter child/slot model. Header/footer keep their built-in pieces
  // (logo + title/subtitle / footer text) and gain an OPTIONAL trailing region of
  // ADDED child blocks (doc.headerFooter.header.children / .footer.children). Children
  // are ordinary blocks rendered by the SAME renderBlock used for the page (proven
  // context-free by frame/group/columns), so every block type -- text, image, and
  // the modeToggle -- works in headerFooter for free, keeps its __block back-ref for
  // editing, and ships in the SCORM export automatically (renderPage -> renderHeader).
  // Absent/empty children == today's fixed-slot headerFooter, so nothing changes for
  // existing docs. Global-edit + per-page hide are untouched (resolveHeaderFooter still
  // gates the WHOLE header/footer).
  function appendHeaderFooterChildren(root, config, extraClass) {
    var kids = config.children || [];
    if (!kids.length) return;
    var extra = el("div", extraClass);
    kids.forEach(function (child) {
      var node = renderBlock(child);
      node.__block = child;
      extra.appendChild(node);
    });
    root.appendChild(extra);
  }

  // Render ONE page as a themed course root — the unit of a canvas frame and of
  // an exported SCORM page. `headerFooter` = { header:config|null, footer:config|null }
  // is resolved by the caller (global config minus per-page opt-outs).
  // Per-page padding override (data on the page). Sets the same CSS vars the
  // global layout uses, inline on the course-root, so it wins over the course.css
  // defaults and ships in the export automatically (pure — no editor state).
  function applyPagePadding(root, page) {
    // Per-breakpoint side padding: page.padX = desktop/base; padXTablet/padXMobile
    // are optional overrides that FALL BACK to the desktop value when unset (so a
    // page that only sets padX still pads every breakpoint the same, unchanged from
    // before). course.css keys .page padding off these vars per [data-bp].
    if (page.padX != null) root.style.setProperty("--page-pad-x", page.padX + "%");
    var xt = (page.padXTablet != null ? page.padXTablet : page.padX);
    var xm = (page.padXMobile != null ? page.padXMobile : page.padX);
    if (xt != null) root.style.setProperty("--page-pad-x-tablet", xt + "%");
    if (xm != null) root.style.setProperty("--page-pad-x-mobile", xm + "%");
    if (page.padY != null) root.style.setProperty("--page-pad-y", page.padY + "px");
  }
  window.applyPagePadding = applyPagePadding;
  window.renderPage = function (page, theme, headerFooter) {
    var root = el("div", "course-root");
    // Auto vertical spacing DEFAULT: the course-root fills the viewport (--vp-h,
    // or 100vh in the shipped course) and flexes so the page area takes the
    // remainder and centres its content. Header/footer keep their natural height.
    // Opt out per page with page.vAlign="top".
    if (page.vAlign !== "top") root.classList.add("course-root--fill");
    applyPagePadding(root, page);
    // master content-width cap (doc.contentMaxWidth via the __contentMaxWidth per-pass
    // hook, set by editor/export/demo like __navSections). Inherits to .page.
    if (window.__contentMaxWidth) root.style.setProperty("--page-max-width", window.__contentMaxWidth + "px");
    // master image corner radius (doc.imageRadius via the __imageRadius per-pass hook):
    // sets --img-radius on the root so every image rounds from one control; a per-image
    // block.radius sets --img-radius on its own figure and WINS (more specific). 0 = square.
    if (window.__imageRadius != null) root.style.setProperty("--img-radius", window.__imageRadius + "px");
    // §2 chapter progression (foundation): opt-in gated-progression flag, stamped via a
    // per-pass hook so the runtime can key linear KC-unlock off it. Ungated = no attr.
    if (window.__gatedProgression) root.setAttribute("data-gated-progression", "1");
    // auto-gate ALL interactions: a single course-level flag (doc.gateAllInteractions via the
    // per-pass hook). When set, the runtime requires every DETECTABLE interaction on a page
    // (quiz pass / all hotspots viewed / video watched / checkbox / all cards revealed) before
    // Next enables. Pure: render only stamps the flag; the runtime observes completion.
    if (window.__gateAllInteractions) root.setAttribute("data-gate-all", "1");
    // global motion (doc.motion via the __motion per-pass hook): author fade durations for the
    // light/dark transition + chapter-change fade. Overrides the CSS defaults; prefers-reduced-
    // motion always wins (the CSS gates the transition/animation behind it). data-chapter-id lets
    // the runtime detect a chapter boundary to fade the incoming page.
    if (window.__motion) {
      if (window.__motion.modeMs != null) root.style.setProperty("--motion-mode-fade", window.__motion.modeMs + "ms");
      if (window.__motion.chapterMs != null) root.style.setProperty("--motion-chapter-fade", window.__motion.chapterMs + "ms");
    }
    if (page.chapterId) root.setAttribute("data-chapter-id", page.chapterId);
    window.applyTheme(root, theme);
    if (headerFooter && headerFooter.header) root.appendChild(renderHeader(headerFooter.header));
    root.appendChild(buildPageSection(page));
    if (headerFooter && headerFooter.footer) root.appendChild(renderFooter(headerFooter.footer));
    return root;
  };

  // resolve global headerFooter for a page (respecting on/off + per-page hide flags)
  window.resolveHeaderFooter = function (doc, page) {
    var c = doc.headerFooter || {};
    return {
      header: (c.header && c.header.on && !page.hideHeader) ? c.header : null,
      footer: (c.footer && c.footer.on && !page.hideFooter) ? c.footer : null
    };
  };

  window.render = function (doc, theme) {
    return window.renderPage(doc.pages[0], theme, window.resolveHeaderFooter(doc, doc.pages[0]));
  };
  // #223 (tour builder T5c): render ONE block in isolation, so the editor's
  // "Cards face-up" board can re-host a marker's popover child blocks (its live
  // __bind text nodes) for inline editing WITHOUT a second content pipeline. This
  // is the same per-block renderer render() uses internally; render stays pure
  // (the export exposes it, it does not change what render emits). Callers set
  // node.__block themselves, exactly as renderMarkers does.
  window.renderBlockNode = function (block) { return renderBlock(block); };

  // ---- axis resolution
  // An AXIS is an orthogonal override dimension over the node tree. Every axis reads the
  // SAME node surface — a per-node visibility tag (visKey -> {only|hide}) and per-key field
  // overrides (ovKey[key]) — and bakes ONE key's content while dropping that key's hidden
  // nodes. `resolveAxis(doc, key, axis)` returns the SAME refs where nothing changed, so
  // IDENTITY-key editing on the canvas still binds to the real model objects (only tagged /
  // excluded nodes get cloned). PURE — the editor preview and the SCORM export both call it,
  // so a previewed key and an exported key are the same markup.
  //
  // Two orthogonal axes, never sharing a namespace, nest by composing passes (product
  // build-splits first via resolveVariant, then version resolves on top via resolveVersion):
  //   VARIANT axis: visKey "variantVis",  ovKey "overrides",         identity = doc.heroVariant||"hero"
  //   VERSION axis: visKey "versionVis",  ovKey "versionOverrides",  identity = base = doc.versions[0]
  //
  // Data shapes (all optional, additive — absent = "shown everywhere / base / identity"):
  //   node[visKey] = { only:[k,...] }  visible ONLY in those keys
  //                | { hide:[k,...] }  visible everywhere EXCEPT those
  //   node[ovKey]  = { <key>: { <field>:value, slots:{<slot>:value} } }
  var VARIANT_AXIS = { visKey: "variantVis", ovKey: "overrides", identity: function (doc) { return (doc && doc.heroVariant) || "hero"; } };
  var VERSION_AXIS = { visKey: "versionVis", ovKey: "versionOverrides", identity: function (doc) { return (doc && doc.versions && doc.versions[0]) || null; } };

  function axisVisible(node, key, axis) {
    var vv = node && node[axis.visKey];
    if (!vv) return true;
    if (vv.only && vv.only.length) return vv.only.indexOf(key) !== -1;
    if (vv.hide && vv.hide.length) return vv.hide.indexOf(key) === -1;
    return true;
  }
  function cloneData(o) { return JSON.parse(JSON.stringify(o)); }
  function shallow(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }
  // #207 editor-support: a NON-ENUMERABLE back-link from a display clone to its base node,
  // so the editor can capture an in-place version edit into the RIGHT base node's
  // versionOverrides. Non-enumerable => never serialises (storage/export stay clean).
  function stampBase(clone, base) {
    try { Object.defineProperty(clone, "__vbase", { value: base, enumerable: false, configurable: true, writable: true }); }
    catch (e) { clone.__vbase = base; }
    return clone;
  }
  // apply overrides[key] onto a node; returns the SAME ref if nothing changes
  // (so identity-key editing is preserved), or an overridden clone.
  function applyAxisOverride(node, key, axis) {
    var ov = node[axis.ovKey] && node[axis.ovKey][key];
    if (!ov) return node;
    var copy = cloneData(node);
    Object.keys(ov).forEach(function (k) {
      if (k === "slots") copy.slots = Object.assign({}, node.slots || {}, ov.slots);
      else copy[k] = ov[k];
    });
    return copy;
  }
  // Resolve one node + its NESTED children (a text override on a block inside a
  // columns / frame / group / cardReveal-accordion-sequence item, or a componentGrid
  // instance, must apply too — top-level-only resolution silently dropped them).
  // Returns the SAME ref when nothing in the subtree changed (identity-key editing stays
  // bound to the real objects); otherwise a shallow clone with the changed child arrays
  // swapped. `block.columns` is an array-of-arrays for a LAYOUT columns block but a
  // NUMBER for a componentGrid grid-count, so the columns branch guards the shape.
  function resolveAxisChildArray(arr, key, axis, forEdit) {
    var kept = arr.filter(function (c) { return axisVisible(c, key, axis); });
    var mapped = kept.map(function (c) { return resolveAxisNode(c, key, axis, forEdit); });
    var changed = kept.length !== arr.length || mapped.some(function (c, i) { return c !== kept[i]; });
    return (changed || forEdit) ? mapped : null; // forEdit => always rebuild (all-clone edit tree); else null = unchanged
  }
  // `forEdit` (editor-support only): force a display CLONE for every node + stamp __vbase, so
  // an in-place version edit captures into the base node — never mutating base by same-ref.
  function resolveAxisNode(node, key, axis, forEdit) {
    var out = applyAxisOverride(node, key, axis); // clone iff this node itself is overridden
    if (forEdit && out === node) out = shallow(node); // force a display clone (edits must never touch base)
    if (forEdit) stampBase(out, node);
    if (out.children && out.children.length) {
      var rc = resolveAxisChildArray(out.children, key, axis, forEdit);
      if (rc) { if (out === node) out = shallow(node); out.children = rc; }
    }
    if (Array.isArray(out.columns) && out.columns.length && Array.isArray(out.columns[0])) {
      var colsChanged = false;
      var newCols = out.columns.map(function (col) { var r = resolveAxisChildArray(col, key, axis, forEdit); if (r) { colsChanged = true; return r; } return col; });
      if (colsChanged) { if (out === node) out = shallow(node); out.columns = newCols; }
    }
    if (out.items && out.items.length) {
      var itemsChanged = false;
      var newItems = out.items.map(function (it) {
        if (it && it.children && it.children.length) {
          var r = resolveAxisChildArray(it.children, key, axis, forEdit);
          if (r) { itemsChanged = true; var ic = shallow(it); if (forEdit) stampBase(ic, it); ic.children = r; return ic; }
        }
        return it;
      });
      if (itemsChanged) { if (out === node) out = shallow(node); out.items = newItems; }
    }
    if (out.type === "componentGrid" && out.instances) {
      var insKept = out.instances.filter(function (ins) { return axisVisible(ins, key, axis); });
      var newIns = insKept.map(function (ins) { return resolveAxisNode(ins, key, axis, forEdit); });
      var insDiff = insKept.length !== out.instances.length || newIns.some(function (ins, i) { return ins !== insKept[i]; });
      if (insDiff) { if (out === node) out = shallow(node); out.instances = newIns; }
    }
    // Hotspot screen-graph (#215): screens are first-class nodes, so a per-key
    // override ON a Screen node (e.g. the per-variant entry visual — the migrated
    // #148 channel) applies here, and card content nested in a Marker's `blocks`
    // resolves like the legacy hotspots[].blocks did. Mirrors the items branch.
    if (Array.isArray(out.screens) && out.screens.length) {
      var scChanged = false;
      var newScreens = out.screens.map(function (s) {
        if (!s) return s;
        var rs = applyAxisOverride(s, key, axis); // per-screen override (clone iff overridden)
        if (Array.isArray(rs.markers) && rs.markers.length) {
          var mkChanged = false;
          var newMks = rs.markers.map(function (m) {
            if (m && Array.isArray(m.blocks) && m.blocks.length) {
              var r = resolveAxisChildArray(m.blocks, key, axis, forEdit);
              if (r) { mkChanged = true; var mc = shallow(m); mc.blocks = r; return mc; }
            }
            return m;
          });
          if (mkChanged) { if (rs === s) rs = shallow(s); rs.markers = newMks; }
        }
        if (rs !== s) scChanged = true;
        return rs;
      });
      if (scChanged) { if (out === node) out = shallow(node); out.screens = newScreens; }
    }
    return out;
  }
  // The shared engine: bake `key` for `axis` across pages/blocks/nested nodes. `isIdentity`
  // short-circuits per-node override baking (the identity key — hero / base — has no override
  // layer OF ITS OWN), but still FILTERS `only:[other]`-tagged nodes out of the identity view.
  function resolveAxis(doc, key, axis, forEdit) {
    var idKey = axis.identity(doc);
    if (key == null) key = idKey;
    var isIdentity = key === idKey;
    var out = {};
    Object.keys(doc).forEach(function (k) { out[k] = doc[k]; });
    out.pages = (doc.pages || []).filter(function (p) { return axisVisible(p, key, axis); }).map(function (page) {
      var kept = (page.blocks || []).filter(function (b) { return axisVisible(b, key, axis); });
      var pageChanged = kept.length !== (page.blocks || []).length;
      var blocks = kept.map(function (b) {
        var nb = (isIdentity && !forEdit) ? b : resolveAxisNode(b, key, axis, forEdit); // recurses into nested containers
        if (nb !== b) pageChanged = true;
        return nb;
      });
      if (isIdentity && !pageChanged && !forEdit) return page; // identity -> stays editable (forEdit always clones)
      var pcopy = {};
      Object.keys(page).forEach(function (k) { pcopy[k] = page[k]; });
      pcopy.blocks = blocks;
      if (forEdit) stampBase(pcopy, page);
      return pcopy;
    });
    return out;
  }

  // Product-variant axis: build-time split (N packages). resolveVariant(doc, v) returns the
  // doc as it renders/exports for variant `v`. Hero is identity where nothing is tagged.
  window.resolveVariant = function (doc, variant) {
    return resolveAxis(doc, variant || VARIANT_AXIS.identity(doc), VARIANT_AXIS);
  };
  window.getVariants = function (doc) { return (doc && doc.variants || []).slice(); };

  // Software-version axis: a THIRD orthogonal dimension, parallel
  // to the variant axis and independent of it. resolveVersion runs on an ALREADY-product-resolved
  // doc so the two axes nest (product build-splits, version resolves on top). Base = first-created
  // version (doc.versions[0]) is the data anchor + identity (base editing stays bound); default =
  // latest = last-created is a SELECTION concern owned by callers (editor view / export boot), not
  // this resolver. A doc with no version axis resolves to identity (no-op) — full backward compat.
  window.resolveVersion = function (doc, version) {
    return resolveAxis(doc, version || VERSION_AXIS.identity(doc), VERSION_AXIS);
  };
  // #207 editor-support: the "dynamic flagship" edit tree. Same rendered VALUES as
  // resolveVersion (so editor == export holds), but EVERY node is a display clone carrying a
  // non-enumerable __vbase back-link to its base node — so an in-place canvas edit is captured
  // into base.versionOverrides[version] instead of mutating base by same-ref. Editor-only;
  // export never calls this (it uses the pure resolveVersion).
  window.resolveVersionForEdit = function (doc, version) {
    return resolveAxis(doc, version || VERSION_AXIS.identity(doc), VERSION_AXIS, true);
  };
  // Author-ordered list; getVersionBase = anchor (first), getVersionDefault = latest (last).
  window.getVersions = function (doc) { return (doc && doc.versions || []).slice(); };
  window.getVersionBase = function (doc) { var v = window.getVersions(doc); return v.length ? v[0] : null; };
  window.getVersionDefault = function (doc) { var v = window.getVersions(doc); return v.length ? v[v.length - 1] : null; };

  // ---- interaction model normalisation ------------
  // ONE read path: a block's effective interactions. Modern blocks carry
  // `block.interactions`; legacy blocks (SAMPLE_DOC nav buttons, menu cards)
  // carry `block.action = {goto:X}` — normalised here into the interactions shape
  // so the engine, editor and export all consume the same structure. PURE — never
  // mutates the block, so exported output semantics (the data-goto path) are
  // untouched; this only *derives* the canonical form on read.
  window.normalizeInteractions = function (block) {
    if (!block) return [];
    if (block.interactions && block.interactions.length) return block.interactions;
    var legacy = block.action && block.action.goto;
    if (legacy != null) return [{ trigger: { type: "click" }, action: { type: "goto", target: legacy } }];
    return [];
  };

  // Walk a page's block tree (children / columns) so nested interactive blocks
  // are reached. componentGrid instances keep the data-goto path (they are not
  // id-bearing blocks in v1), so they are not walked here.
  function walkBlocks(blocks, fn) {
    (blocks || []).forEach(function (b) {
      fn(b);
      if (b.children) walkBlocks(b.children, fn);
      if (Array.isArray(b.columns)) b.columns.forEach(function (col) { walkBlocks(col, fn); }); // guard: only the columns block uses an array here
      if (Array.isArray(b.items)) b.items.forEach(function (item) { if (!item) return; if (Array.isArray(item.children)) walkBlocks(item.children, fn); if (Array.isArray(item.front)) walkBlocks(item.front, fn); }); // accordion / cardReveal items[].children + flip fronts (items[].front)
      if (Array.isArray(b.screens)) b.screens.forEach(function (s) { if (s && Array.isArray(s.markers)) s.markers.forEach(function (m) { if (m && Array.isArray(m.blocks)) walkBlocks(m.blocks, fn); }); }); // hotspot popover-card blocks (#215 screens[].markers[].blocks)
    });
  }

  // Build the compact interaction map the runtime consumes:
  //   { "<blockId>": { interactions:[...], gate:{...} }, ... }
  // Only id-bearing blocks that actually participate (have interactions or a gate)
  // are included. export.js serialises this into index.html; the editor preview
  // passes it straight to CourseRuntime.create.
  window.buildInteractionMap = function (doc) {
    var map = {};
    (doc && doc.pages || []).forEach(function (page) {
      walkBlocks(page.blocks, function (b) {
        var ix = window.normalizeInteractions(b);
        if (b.id && (ix.length || b.gate)) map[b.id] = { interactions: ix, gate: b.gate };
      });
    });
    return map;
  };

  // ---- Chapters (JJJJ) -------------------------------------------------------
  // First-class chapter layer: pages are grouped into chapters. Model shape is a
  // FLAT doc.pages[] + page.chapterId, plus an ordered doc.chapters[] (id/name/
  // order). Group here into ordered chapters, each carrying its pages IN
  // doc.pages order (the canvas stacks these vertically per chapter column).
  // A doc with no chapter model yet -> one implicit chapter holding every page.
  window.groupPagesByChapter = function (doc) {
    var pages = (doc && doc.pages) || [];
    var chapters = (doc && doc.chapters) || [];
    if (!chapters.length) return [{ id: null, name: "Chapter 1", order: 0, pages: pages.slice() }];
    var byId = {};
    chapters.forEach(function (c) { byId[c.id] = { id: c.id, name: c.name, order: c.order || 0, pages: [] }; });
    var fallback = byId[chapters[0].id];
    pages.forEach(function (p) { (byId[p.chapterId] || fallback).pages.push(p); });
    return chapters.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).map(function (c) { return byId[c.id]; });
  };

  // Re-sort a pages array COLUMN-MAJOR: grouped by chapter (in doc.chapters
  // order), relative order within each chapter preserved. Used after a page
  // changes chapter so the "chapter's pages are contiguous, chapters in order"
  // invariant always holds (play-order + integer currentPage stay valid).
  window.resortColumnMajor = function (pages, chapters) {
    // MUST rank chapters by c.order (the SAME key groupPagesByChapter/​the outline
    // uses), NOT the raw array index — else the export/nav play-order disagrees with
    // the outline when the chapters array drifts out of c.order sync (reorderChapter
    // swaps order values, not array position) → Next skips a chapter. (Bug 2026-07-08.)
    var order = {}; (chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (c, i) { order[c.id] = i; });
    var tagged = (pages || []).map(function (p, i) { return { p: p, i: i, c: (order[p.chapterId] != null ? order[p.chapterId] : 1e9) }; });
    tagged.sort(function (a, b) { return (a.c - b.c) || (a.i - b.i); });
    return tagged.map(function (t) { return t.p; });
  };

  // Where to splice a page so it lands at the END of a chapter's contiguous block
  // (addition order: newest goes last). `pages` must NOT contain the page being
  // moved. Returns an insertion index into `pages` that keeps chapters contiguous.
  window.chapterInsertIndex = function (pages, chapterId, chapters) {
    // rank by c.order (matches groupPagesByChapter/resortColumnMajor), not array index
    var order = {}; (chapters || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (c, i) { order[c.id] = i; });
    var targetOrder = order[chapterId] != null ? order[chapterId] : 1e9;
    var lastOfTarget = -1, firstAfter = -1;
    for (var i = 0; i < (pages || []).length; i++) {
      var co = order[pages[i].chapterId] != null ? order[pages[i].chapterId] : 1e9;
      if (co === targetOrder) lastOfTarget = i;
      if (co > targetOrder && firstAfter === -1) firstAfter = i;
    }
    if (lastOfTarget >= 0) return lastOfTarget + 1;   // after the last page already in this chapter
    if (firstAfter >= 0) return firstAfter;            // before the first later-chapter page
    return (pages || []).length;                       // this chapter is last -> append at the end
  };

  // Nav sections derived from the chapter model (JJJJ): one section per chapter,
  // in order, carrying its page ids. Feeds the learner nav bar's chapter selector
  // + chapter-scoped progress -- and because a page's chapter is explicit
  // (page.chapterId), a split-out page lands in the RIGHT chapter (fixes IIII).
  window.chaptersToNavSections = function (doc) {
    return (window.groupPagesByChapter ? window.groupPagesByChapter(doc) : []).map(function (ch) {
      return { id: ch.id, label: ch.name || "Chapter", pages: (ch.pages || []).map(function (p) { return p.id; }) };
    });
  };

  // KKKK / deep module E: migrate a LEGACY course (Course Menu landing page +
  // "01…/02…"-named chapter pages) to the explicit chapter model, then REMOVE the
  // menu page (nav now lives in the footer bar). Pure aside from mutating `doc`;
  // idempotent (a doc that already has chapters is left alone). Returns a report
  // { changed, removedMenuId, chapters, flags } so the caller can surface anything
  // that needs author review rather than silently dropping content.
  //
  // Detection order:
  //  1. A menu page = the first page carrying a `componentGrid` whose instances
  //     link (`action.goto`) to other pages. Each instance -> a chapter; its goto
  //     target is that chapter's FIRST page; pages that follow (in doc order) fall
  //     into the same chapter until the next chapter's first page.
  //  2. Fallback (no menu grid): "01…/02…" numeric name prefixes — a new leading
  //     number starts a new chapter.
  window.migrateToChapters = function (doc) {
    var report = { changed: false, removedMenuId: null, chapters: [], flags: [] };
    if (!doc || !Array.isArray(doc.pages)) return report;
    if (Array.isArray(doc.chapters) && doc.chapters.length) return report; // already chaptered
    var pages = doc.pages;
    var pageIds = {}; pages.forEach(function (p) { if (p && p.id) pageIds[p.id] = true; });

    // 1. locate the menu grid (a componentGrid whose instances goto real pages)
    var menuIdx = -1, grid = null;
    for (var i = 0; i < pages.length; i++) {
      var blocks = pages[i].blocks || [];
      for (var b = 0; b < blocks.length; b++) {
        if (blocks[b].type === "componentGrid" && (blocks[b].instances || []).some(function (inst) {
          return inst.action && inst.action.goto && pageIds[inst.action.goto];
        })) { menuIdx = i; grid = blocks[b]; break; }
      }
      if (grid) break;
    }

    var chapters = [], startFor = {}; // pageId -> chapterId for chapter-start pages
    if (grid) {
      (grid.instances || []).forEach(function (inst, idx) {
        var goto = inst.action && inst.action.goto;
        if (!goto || !pageIds[goto]) return;
        var slots = inst.slots || {};
        var name = slots.title
          ? (slots.number ? (slots.number + " · " + slots.title) : slots.title)
          : ((pages.filter(function (p) { return p.id === goto; })[0] || {}).name || "Chapter " + (idx + 1));
        var cid = "chap-" + goto;
        chapters.push({ id: cid, name: name, order: chapters.length });
        startFor[goto] = cid;
      });
    } else {
      // 2. naming-implied: a new leading number prefix starts a new chapter
      var lastNum = null;
      pages.forEach(function (p) {
        var m = (p.name || "").match(/^\s*(\d+)/);
        if (m && m[1] !== lastNum) {
          lastNum = m[1];
          var cid = "chap-" + p.id;
          chapters.push({ id: cid, name: p.name || ("Chapter " + chapters.length), order: chapters.length });
          startFor[p.id] = cid;
        }
      });
    }
    if (!chapters.length) return report; // nothing recognisable -> leave for the default-chapter path

    // remove the menu page, flagging any unique content it carried (not just the
    // heading + the menu grid) so the author can recover it.
    if (menuIdx >= 0) {
      var menu = pages[menuIdx];
      report.removedMenuId = menu.id;
      var extra = (menu.blocks || []).filter(function (bl) {
        return bl !== grid && bl.type !== "heading";
      });
      if (extra.length) report.flags.push("Course Menu page (\"" + (menu.name || menu.id) + "\") had " + extra.length + " non-menu block(s); review before it is discarded.");
      pages.splice(menuIdx, 1);
    }

    // assign chapterId across pages in doc order: a chapter-start page opens its
    // chapter; following pages inherit it until the next start. Pages before the
    // first start fall into the first chapter.
    var cur = chapters[0].id;
    pages.forEach(function (p) {
      if (startFor[p.id]) cur = startFor[p.id];
      p.chapterId = cur;
    });

    // flag dangling links to the now-removed menu page (e.g. a "Back to menu" button)
    if (report.removedMenuId) {
      var dangling = 0;
      pages.forEach(function (p) {
        (p.blocks || []).forEach(function (bl) {
          if (bl.action && bl.action.goto === report.removedMenuId) dangling++;
          (bl.instances || []).forEach(function (inst) { if (inst.action && inst.action.goto === report.removedMenuId) dangling++; });
        });
      });
      if (dangling) report.flags.push(dangling + " link(s) still point to the removed Course Menu page; the footer nav bar replaces them.");
    }

    doc.chapters = chapters;
    report.changed = true;
    report.chapters = chapters;
    return report;
  };

  // ---- Asset-reference resolution (YY / SPEC-production-hardening §4) --------
  // Media lives in an id-keyed store (persist.js); the doc carries lean string
  // refs "asset:<id>". render() stays PURE and never touches the store. Instead
  // the editor (mount) and export SWAP refs -> real srcs on the doc IN PLACE
  // around the render call, then restore -- so node.__block identity (which
  // editing depends on) is preserved AND the doc keeps its refs on disk. A
  // generic deep-walk over every string value covers all media fields
  // (src / srcLight / srcDark / localVideo / hotspot screen / logo /
  // component-slot images) and any future one, with no field enumeration.
  var ASSET_RE = /^asset:(.+)$/;

  function eachMediaSlot(node, visit, seen) {
    if (!node || typeof node !== "object") return;
    seen = seen || [];
    if (seen.indexOf(node) !== -1) return; // JSON docs are acyclic; guard anyway
    seen.push(node);
    Object.keys(node).forEach(function (k) {
      var val = node[k];
      if (typeof val === "string") visit(node, k, val);
      else if (val && typeof val === "object") eachMediaSlot(val, visit, seen);
    });
  }

  // Swap every "asset:<id>" -> resolveFn(id, ref) in place; return restore().
  // resolveFn returns a real src string (objectURL / data: URL / inlined
  // base64); returning null/undefined leaves the ref untouched. Never throws.
  window.resolveMedia = function (doc, resolveFn) {
    var undo = [];
    eachMediaSlot(doc, function (container, key, val) {
      var m = ASSET_RE.exec(val);
      if (!m) return;
      var replaced;
      try { replaced = resolveFn(m[1], val); } catch (e) { replaced = null; }
      if (replaced == null || replaced === val) return;
      undo.push([container, key, val]);
      container[key] = replaced;
    });
    return function restore() {
      for (var i = undo.length - 1; i >= 0; i--) undo[i][0][undo[i][1]] = undo[i][2];
    };
  };

  // Hoist every inline "data:" media string into the store via putFn(dataUrl) ->
  // id (or null on failure), rewriting it to "asset:<id>". NON-DESTRUCTIVE: a
  // field whose put fails is LEFT as the data: URL, so media is never lost.
  window.migrateDocMedia = function (doc, putFn) {
    var migrated = 0, failed = 0;
    eachMediaSlot(doc, function (container, key, val) {
      if (val.slice(0, 5) !== "data:") return;
      var id = null;
      try { id = putFn(val); } catch (e) { id = null; }
      if (id) { container[key] = "asset:" + id; migrated++; }
      else failed++;
    });
    return { migrated: migrated, failed: failed };
  };

  // Hoist legacy INLINE htmlEmbed markup into the store. migrateDocMedia only
  // moves "data:" strings; a pasted interaction lives as RAW HTML on block.html,
  // so it never escaped the doc JSON and eventually overflowed localStorage (the
  // data-loss bug). Wrap each raw html as a data:text/html URL, put it via putFn
  // (-> id), and rewrite block.html to "asset:<id>". NON-DESTRUCTIVE: a block whose
  // put fails is LEFT as raw markup, so nothing is lost.
  window.migrateDocEmbedHtml = function (doc, putFn) {
    var migrated = 0, failed = 0, seen = [];
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      if (seen.indexOf(node) !== -1) return;
      seen.push(node);
      if (node.type === "htmlEmbed" && typeof node.html === "string" && node.html &&
          !/^(asset:|blob:|https?:|data:)/i.test(node.html)) { // only hoist genuine raw markup, never a leftover URL/ref
        var id = null, dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(node.html);
        try { id = putFn(dataUrl); } catch (e) { id = null; }
        if (id) { node.html = "asset:" + id; migrated++; } else failed++;
      }
      Object.keys(node).forEach(function (k) { var v = node[k]; if (v && typeof v === "object") walk(v); });
    })(doc);
    return { migrated: migrated, failed: failed };
  };

  // #215 / ADR-0003: migrate a legacy hotspot block to the unified screen-graph
  // model IN PLACE. PURE data mutation (no DOM, no store, no editor state) so the
  // doc-load migration pass and tests/run.js drive the same function.
  //
  //   legacy popover block  { src, alt, hotspots:[{id,x,y,label,cardW,cardH,blocks[]}] }
  //     -> one entry screen, every marker action "card", child blocks intact.
  //   legacy screen block   { mode:"screen", src, hotspots:[{id,..,screen,screenAlt}] }
  //     -> entry screen + one synthesized screen per hs.screen, markers "navigate".
  //
  // Unified shape: block.entry = <screen id>; block.screens = [{ id, visual, kind,
  // playback, replay, alt, markers:[{ id, x, y, label, action:"card"|"navigate",
  // blocks[], target, cardW, cardH }] }]. A marker keeps BOTH blocks and target so
  // the editor's popover<->screen mode flip stays lossless (legacy behaviour).
  // block.mode survives as an AUTHORING hint only (render derives screen chrome
  // from marker actions). Per-variant/version base-image overrides (the #148
  // overrides[V].src channel) move onto the entry screen as overrides[V].visual.
  // Idempotent: a block that already has screens[] is returned untouched.
  window.migrateHotspotBlock = function (block) {
    if (!block || block.type !== "hotspot") return block;
    if (Array.isArray(block.screens)) {
      if (!block.entry && block.screens.length && block.screens[0]) block.entry = block.screens[0].id;
      window.normalizeHotspotLoops(block);
      return block;
    }
    var screenMode = block.mode === "screen";
    var entry = { id: "scr-entry", visual: block.src || "", kind: "image", alt: block.alt || "", markers: [] };
    var screens = [entry];
    (block.hotspots || []).forEach(function (hs, i) {
      if (!hs) return;
      var mk = { id: hs.id || ("hs_m" + i), action: screenMode ? "navigate" : "card" };
      if (hs.x != null) mk.x = hs.x;
      if (hs.y != null) mk.y = hs.y;
      if (hs.label) mk.label = hs.label;
      if (hs.cardW != null) mk.cardW = hs.cardW;
      if (hs.cardH != null) mk.cardH = hs.cardH;
      mk.blocks = Array.isArray(hs.blocks) ? hs.blocks : [];
      if (hs.screen) {
        var tid = "scr-" + mk.id;
        while (screens.some(function (s) { return s.id === tid; })) tid += "x"; // never collide (e.g. a marker literally named "entry")
        screens.push({ id: tid, visual: hs.screen, kind: "image", alt: hs.screenAlt || "", markers: [] });
        mk.target = tid;
      }
      entry.markers.push(mk);
    });
    block.screens = screens;
    block.entry = entry.id;
    // #148 channels: the base image now lives at entry.visual, so a per-variant /
    // per-version src override must follow it (else authored variant images are
    // silently dropped). Only the src key moves; any other override fields stay.
    ["overrides", "versionOverrides"].forEach(function (ch) {
      var ov = block[ch];
      if (!ov) return;
      Object.keys(ov).forEach(function (k) {
        if (ov[k] && ov[k].src != null) {
          entry[ch] = entry[ch] || {};
          entry[ch][k] = entry[ch][k] || {};
          entry[ch][k].visual = ov[k].src;
          delete ov[k].src;
          if (!Object.keys(ov[k]).length) delete ov[k];
        }
      });
      if (!Object.keys(ov).length) delete block[ch];
    });
    delete block.hotspots;
    delete block.src;
    delete block.alt;
    window.normalizeHotspotLoops(block);
    return block;
  };

  // #224 T6: normalize the loop (screen-carousel) collection on a hotspot block. A loop is
  // { id, name?, screens:[screenId], bx,by,bw,bh (editor coords render IGNORES), wrap? }.
  // Membership is by screen id, deduped and pruned to screens that still exist; a screen
  // belongs to at most one loop (first wins). Editor-only board geometry; render() never
  // reads block.loops, so it stays a pure function of the doc. Idempotent.
  window.normalizeHotspotLoops = function (block) {
    if (!block || block.type !== "hotspot") return block;
    if (block.loops == null) return block;
    if (!Array.isArray(block.loops)) { delete block.loops; return block; }
    var valid = {}; (block.screens || []).forEach(function (s) { if (s && s.id) valid[s.id] = true; });
    var claimed = {};
    block.loops = block.loops.filter(Boolean).map(function (loop) {
      if (!loop.id) loop.id = "loop-" + Math.random().toString(36).slice(2, 8);
      var ids = Array.isArray(loop.screens) ? loop.screens : [];
      loop.screens = ids.filter(function (sid) {
        if (!valid[sid] || claimed[sid]) return false; claimed[sid] = true; return true;
      });
      return loop;
    });
    return block;
  };

  // Every distinct asset id referenced by a doc (for mark-sweep GC).
  window.collectAssetRefs = function (doc) {
    var ids = {};
    eachMediaSlot(doc, function (container, key, val) {
      var m = ASSET_RE.exec(val);
      if (m) ids[m[1]] = true;
    });
    return Object.keys(ids);
  };
})();
