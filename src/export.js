/*
 * export.js — M9: SCORM 1.2 export. Serialises the SAME
 * render() output the canvas shows into a lean SCORM 1.2 package Moodle accepts.
 *
 * Talks to the editor ONLY via window.Editor (getDoc / renderPage / getThemes).
 *
 * What it produces (a .zip with imsmanifest.xml at the root):
 *   imsmanifest.xml          generated, one SCO -> index.html, all files listed
 *   index.html               the runtime shell (SCORM init/commit + page nav +
 *                            dark/light toggle + responsive breakpoint by width)
 *   scorm-api.js             spike 1's proven content-side SCORM 1.2 wrapper
 *   course.css               fetched live from src/course.css (single source)
 *   theme.css                generated: Exo 2 @font-face + always-visible
 *                            scrollbar + BOTH dark & light token sets (folds in
 *                            what scripts/scorm-publish.sh does today)
 *   fonts/Exo2-*.ttf         embedded so it renders offline / air-gapped
 *   assets/interactions/*    bundled local HTML interactions (htmlEmbed src)
 *
 * Leaves behind Captivate bloat (no scormdriver.js, no unused xsd, no empty dirs).
 *
 * REQUIRES running over http:// (the serve.command origin): the browser cannot
 * read the local font / css / interaction files over file://. If opened as
 * file://, export explains how to switch.
 *
 * KNOWN LIMIT (flagged, not faked): true Vimeo self-hosting as <video> needs to
 * fetch the media file, which a pure browser tool cannot do (CORS + no
 * progressive URL without the Vimeo API / a backend). So a webEmbed with only a
 * URL ships as a live iframe (network dependency, reported at export). The
 * offline path is a locally-uploaded file on `block.localVideo` (a data: URL):
 * render.js already emits that as a self-contained <video>, so it bundles inline
 * and is air-gap safe with no special export handling.
 *
 * Do NOT edit editor.js / render.js / index.html.
 */
(function () {
  "use strict";

  var ENC = new TextEncoder();

  // ---- minimal STORE-method ZIP writer (no deps, no compression) -----------
  // SCORM packages do not require compression; a stored zip is valid and keeps
  // this self-contained (no CDN, works air-gapped).
  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    var chunks = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
    var dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);
    files.forEach(function (f) {
      var nameBytes = ENC.encode(f.name), data = f.bytes, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer)); chunks.push(nameBytes); chunks.push(data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      // offset 8 = flags (0), 10 = method (0 = store), 12 = time, 14 = date
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBytes.length, true); ch.setUint32(42, offset, true);
      central.push({ head: new Uint8Array(ch.buffer), name: nameBytes });
      offset += 30 + nameBytes.length + data.length;
    });
    var centralStart = offset, centralSize = 0;
    central.forEach(function (c) { chunks.push(c.head); chunks.push(c.name); centralSize += c.head.length + c.name.length; });
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true); eocd.setUint32(16, centralStart, true);
    chunks.push(new Uint8Array(eocd.buffer));
    return new Blob(chunks, { type: "application/zip" });
  }

  // ---- fetch helpers (need http:// origin) ---------------------------------
  // no-store so an export always bundles the CURRENT files on disk — never a
  // stale course.css / scorm-api.js / font from the browser HTTP cache.
  var NO_STORE = { cache: "no-store" };
  function fetchBytes(url) { return fetch(url, NO_STORE).then(function (r) { if (!r.ok) throw new Error(url + " -> " + r.status); return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); }
  function fetchText(url) { return fetch(url, NO_STORE).then(function (r) { if (!r.ok) throw new Error(url + " -> " + r.status); return r.text(); }); }
  function textFile(name, str) { return { name: name, bytes: ENC.encode(str) }; }

  // ---- externalised media (#193) -------------------------------------------
  // The LMS Start-button freeze was the whole course being base64-inlined into ONE
  // index.html: the boot script that wires nav sits at the END, so it can't run until
  // the entire (100+ MB) file downloads. Moodle serves SCO files slowly (PHP), so that
  // was ~30s. Fix: write heavy binary media (raster images / GIF / video / audio) as
  // SEPARATE FILES inside the SAME zip, referenced by relative URL, so index.html stays
  // tiny (boot runs at once) and media streams lazily. SVG + HTML-embeds stay inline
  // (they have special recolour/srcdoc render paths and are small). Nothing leaves the
  // package -- these are ordinary files in the SCORM zip, listed in the manifest, served
  // by the LMS exactly like Storyline/Captivate asset folders.
  var MEDIA_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "oga", "audio/webm": "weba", "audio/aac": "aac", "audio/mp4": "m4a" };
  function dataUrlMime(u) { if (typeof u !== "string" || u.slice(0, 5) !== "data:") return ""; var c = u.indexOf(","); if (c < 0) return ""; var meta = u.slice(5, c), semi = meta.indexOf(";"); return (semi >= 0 ? meta.slice(0, semi) : meta).toLowerCase(); }
  function mediaExt(mime) { mime = String(mime || "").toLowerCase(); if (MEDIA_EXT[mime]) return MEDIA_EXT[mime]; var s = (mime.split("/")[1] || "bin"); return s.replace(/[^a-z0-9]/g, "") || "bin"; }
  // Externalise only heavy BINARY media. NOT svg (inline recolour) / text/html (srcdoc).
  function isExternalizableMime(mime) { mime = String(mime || "").toLowerCase(); return /^image\/(png|jpe?g|gif|webp|avif)$/.test(mime) || /^video\//.test(mime) || /^audio\//.test(mime); }
  function safeAssetName(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120) || "asset"; }
  // Decode a data: URL's payload to bytes (base64 -> binary; non-base64 -> UTF-8 text).
  // Returns null on a non-data string or decode failure, so callers keep the original inline.
  function dataUrlToBytes(u) {
    if (typeof u !== "string" || u.slice(0, 5) !== "data:") return null;
    var c = u.indexOf(","); if (c < 0) return null;
    var meta = u.slice(5, c), payload = u.slice(c + 1);
    try {
      if (!/;base64/i.test(meta)) return ENC.encode(decodeURIComponent(payload));
      var bin = atob(payload), n = bin.length, out = new Uint8Array(n);
      for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  // ---- theme tokens -> CSS (same var names applyTheme() emits) --------------
  function kebab(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }
  function tokenBody(theme) {
    var out = [];
    Object.keys(theme).forEach(function (group) {
      var vals = theme[group];
      if (vals && typeof vals === "object") Object.keys(vals).forEach(function (key) { out.push("--" + group + "-" + kebab(key) + ":" + vals[key] + ";"); });
    });
    return out.join("");
  }
  // colour token object -> { "--color-<kebab>": value } (Item Z: the exported
  // runtime posts these into HTML-interaction iframes on a mode flip).
  function colorVars(colorObj) {
    var o = {};
    if (colorObj) Object.keys(colorObj).forEach(function (k) { o["--color-" + kebab(k)] = colorObj[k]; });
    return o;
  }
  function themeCss(themes) {
    var dark = tokenBody(themes.dark), light = tokenBody(themes.light);
    return [
      ":root{color-scheme:dark;}",
      // Default DARK regardless of the OS preference. The learner's browser
      // appearance setting must NOT leak into the course: a
      // light-mode Chrome opened a course in light before this. Light only
      // renders when JS explicitly stamps data-mode="light" (future learner
      // toggle). This is the no-JS / pre-JS floor -> no flash-to-light either.
      ".course-root:not([data-mode]){" + dark + "}",
      // explicit (JS stamps the effective mode; manual toggle overrides)
      '.course-root[data-mode="dark"]{' + dark + "}",
      '.course-root[data-mode="light"]{' + light + "}"
    ].join("\n");
  }

  // Exo 2 @font-face (file refs into fonts/) + always-visible scrollbar — the two
  // things scripts/scorm-publish.sh injects today, native here.
  var FONT_FACE_CSS = [
    "@font-face{font-family:'Exo 2';src:url('fonts/Exo2-Regular.ttf') format('truetype');font-weight:400;font-style:normal;font-display:swap;}",
    "@font-face{font-family:'Exo 2';src:url('fonts/Exo2-SemiBold.ttf') format('truetype');font-weight:600;font-style:normal;font-display:swap;}",
    "@font-face{font-family:'Exo 2';src:url('fonts/Exo2-Bold.ttf') format('truetype');font-weight:700;font-style:normal;font-display:swap;}",
    "@font-face{font-family:'Exo 2';src:url('fonts/Exo2-ExtraBold.ttf') format('truetype');font-weight:800;font-style:normal;font-display:swap;}"
  ].join("\n");
  var SCROLLBAR_CSS = [
    "::-webkit-scrollbar{width:12px;height:12px;}",
    "::-webkit-scrollbar-track{background:#2b2b2b;}",
    "::-webkit-scrollbar-thumb{background:#888;border-radius:6px;border:2px solid #2b2b2b;}",
    "::-webkit-scrollbar-thumb:hover{background:#aaa;}",
    "html{scrollbar-color:#888 #2b2b2b;}"
  ].join("");

  // wrapper headerFooter (namespaced .scorm-*, never touches course styles)
  var SHELL_CSS = [
    "html,body{margin:0;padding:0;}",
    "body{background:var(--color-bg,#1b1c1e);}",
    ".scorm-bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:14px;",
    "padding:8px 16px;background:#0e0f11;color:#e9edf0;font:14px/1.2 'Exo 2',system-ui,sans-serif;border-bottom:1px solid #23262a;}",
    ".scorm-bar__title{font-weight:700;letter-spacing:.02em;}",
    ".scorm-bar__spacer{flex:1;}",
    ".scorm-btn{font:inherit;font-size:13px;color:#e9edf0;background:#22262b;border:1px solid #34393f;border-radius:6px;padding:6px 12px;cursor:pointer;}",
    ".scorm-btn:hover{background:#2c3138;}",
    ".scorm-btn:disabled{opacity:.4;cursor:default;}",
    ".scorm-bar__pos{font-variant-numeric:tabular-nums;min-width:46px;text-align:center;}",
    ".scorm-page{display:none;}",
    ".scorm-page.is-current{display:block;}",
    // #208/#209: only the active software version's wrapper is live; the rest ship hidden until
    // the learner picks. (native [hidden] already hides; explicit rule guards a stray display.)
    ".scorm-version[hidden]{display:none;}",
    // #209: the system-injected software-version selector on the (version-neutral) title page.
    // Author never places or styles it; runtime injects it at the top of page 1's content.
    ".scorm-version-select{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 auto 20px;padding:12px 16px;max-width:var(--page-max-width,760px);",
    "background:rgba(14,147,132,.08);border:1px solid rgba(14,147,132,.32);border-radius:10px;font:500 13px/1.2 'Exo 2',system-ui,sans-serif;}",
    ".scorm-version-select__label{font-weight:600;color:var(--color-text,#e9edf0);opacity:.7;margin-right:2px;}",
    ".scorm-version-opt{font:inherit;color:var(--color-text,#e9edf0);background:transparent;border:1px solid rgba(128,128,128,.4);border-radius:999px;padding:5px 14px;cursor:pointer;}",
    ".scorm-version-opt:hover{border-color:#0e9384;}",
    ".scorm-version-opt.is-active{background:#0e9384;border-color:#0e9384;color:#fff;font-weight:600;}",
    ".embed__fit{overflow:hidden;}"
  ].join("");

  // ---- serialise one page's DOM into export-clean markup -------------------
  // ctx = { net: [], dropped: [] } collects web embeds that ship live (network
  // dependency) vs ones dropped because "package locally" was chosen but no local
  // file exists. opts.webVideo = "package" | "link".
  function cleanRoot(root, ctx, opts) {
    // drop inline THEME token custom properties so theme.css (and the runtime toggle)
    // governs colour/type/spacing. KEEP layout vars (--page-pad-*, --page-max-width,
    // --img-radius) AND motion vars (--motion-mode-fade / --motion-chapter-fade): those are
    // per-page padding, master content-width, master image radius, and global-motion author
    // overrides that are MEANT to ship inline and win over the course.css defaults.
    // (--vp-h is still dropped so auto-spacing -> 100vh.)
    //
    // arch-P1 found --img-radius missing from this list: the author's master image radius
    // rounded images on the canvas and then never shipped, because render set it on the root
    // and the export quietly stripped it. Exactly the editor/export divergence the render
    // context exists to make visible.
    var KEEP_ROOT_VARS = ["--page-", "--motion-", "--img-radius"];
    var props = [];
    for (var i = 0; i < root.style.length; i++) {
      var p = root.style[i];
      if (p.indexOf("--") === 0 && !KEEP_ROOT_VARS.some(function (k) { return p.indexOf(k) === 0; })) props.push(p);
    }
    props.forEach(function (p) { root.style.removeProperty(p); });
    if (!root.getAttribute("style")) root.removeAttribute("style");

    // hidden instances must not ship (course.css has no [data-hidden] rule)
    Array.prototype.forEach.call(root.querySelectorAll('[data-hidden="true"]'), function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    // strip editor-only markers
    Array.prototype.forEach.call(root.querySelectorAll("[data-edit]"), function (n) { n.removeAttribute("data-edit"); n.removeAttribute("data-rich"); });
    Array.prototype.forEach.call(root.querySelectorAll("[contenteditable]"), function (n) { n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck"); });

    // annotate / rewrite embeds
    Array.prototype.forEach.call(root.querySelectorAll("[data-embed]"), function (node) {
      var block = node.__block || {};
      if (node.getAttribute("data-embed") === "html") {
        node.setAttribute("data-fit-width", block.fitWidth || 900);
        node.setAttribute("data-height", block.height || 500);
      } else {
        // render.js already emits a self-contained <video src="data:..."> for an
        // uploaded block.localVideo (air-gap safe) — leave it. A URL-only web
        // embed is a live iframe (network dependency): keep it when "link on web"
        // is chosen; when "package locally" is chosen, replace it with an offline
        // placeholder so the package stays genuinely air-gap clean.
        if (!block.localVideo) {
          var info = window.parseVideo(block.url);
          if (info.provider === "vimeo" || info.provider === "youtube" || info.provider === "generic") {
            var label = info.provider + (info.id ? " #" + info.id : "") + " (" + (block.url || "") + ")";
            if (opts && opts.webVideo === "package") {
              ctx.dropped.push(label);
              var ph = document.createElement("div");
              ph.className = "embed__empty-hint";
              ph.style.minHeight = "120px";
              ph.innerHTML = '<div class="embed__empty-title">Video not packaged</div>' +
                '<div class="embed__empty-sub">This ' + info.provider + ' embed is a web link. To include it offline, upload the video file to the block, then re-export.</div>';
              var frame = node.querySelector(".embed__iframe");
              if (frame) frame.parentNode.replaceChild(ph, frame); else node.appendChild(ph);
            } else {
              ctx.net.push(label);
              // Vimeo watched-state via the Player API postMessage protocol needs
              // the iframe opened with api=1 + a player_id; runtime.js listens for
              // the `finish` event. Only the live-embed path needs this (the
              // offline path is a self-hosted <video> firing native `ended`).
              if (info.provider === "vimeo") {
                var vframe = node.querySelector(".embed__iframe");
                if (vframe) {
                  var vsrc = vframe.getAttribute("src") || "";
                  if (vsrc && vsrc.indexOf("api=1") === -1) {
                    var hostEl = node.closest ? node.closest("[data-id]") : null;
                    var pid = (hostEl && hostEl.getAttribute("data-id")) || ("vim_" + (info.id || "0"));
                    vframe.setAttribute("src", vsrc + (vsrc.indexOf("?") === -1 ? "?" : "&") + "api=1&player_id=" + pid);
                    if (!vframe.id) vframe.id = pid;
                  }
                }
              }
            }
          }
        }
      }
    });
    return root;
  }

  function serializePages(doc, ctx, opts) {
    // `doc` is already variant-resolved (overrides baked, excluded pages dropped),
    // so render its pages directly with the pure renderer + current theme/headerFooter.
    var theme = window.Editor.getTheme();
    // arch-P1: one builder, both callers. The shipped package gets exactly the context the
    // canvas renders with -- nav, styles, gates, motion, glossary -- because there is now a
    // single place that derives it. src/render-context.js.
    window.applyRenderContext(window.buildRenderContext(doc));
    // YY: inline every "asset:<id>" ref as base64 (air-gap safe), then restore --
    // the hero `doc` is the LIVE registry object, so we must not leave it mutated.
    // §286: prefer an optimised (downscaled/recompressed) dataUrl when the media
    // pre-pass produced one for this asset; else fall back to the stored original.
    var optimMap = (opts && opts._optimMap) || null;
    // #193: when externalising, heavy binary media is written to media/<id>.<ext> files
    // and the ref becomes that relative URL; otherwise (or for svg/html) it stays inlined
    // as base64 (the legacy behaviour). _mediaFiles/_mediaUrlMap accumulate across pages
    // so a shared asset is written ONCE and reused.
    var externalize = opts && opts.externalizeMedia !== false;
    opts._mediaFiles = opts._mediaFiles || [];
    var mediaUrlMap = opts._mediaUrlMap || (opts._mediaUrlMap = {});
    var restore = (window.resolveMedia && window.AssetStore)
      ? window.resolveMedia(doc, function (id) {
          var dataUrl = (optimMap && optimMap[id]) || (function () { var a = window.AssetStore.get(id); return a ? a.dataUrl : window.AssetStore.placeholder; })();
          if (!externalize || typeof dataUrl !== "string") return dataUrl;
          if (!isExternalizableMime(dataUrlMime(dataUrl))) return dataUrl; // svg / html / placeholder stay inline
          if (mediaUrlMap[id]) return mediaUrlMap[id];                     // dedup: asset reused across pages
          var bytes = dataUrlToBytes(dataUrl);
          if (!bytes) return dataUrl;                                     // decode failed -> keep inline (never lose media)
          var name = "media/" + safeAssetName(id) + "." + mediaExt(dataUrlMime(dataUrl));
          opts._mediaFiles.push({ name: name, bytes: bytes });
          mediaUrlMap[id] = name;
          return name;
        })
      : function () {};
    try {
      // §55 fix: play-order in the shipped SCORM is the runtime's data-index walk
      // (next = cur+1), so the emitted sequence MUST match the Structure outline, not
      // the raw doc.pages[] array (which can drift: legacy/CSV imports, an edit path
      // that skipped resortColumnMajor, a deletion gap). Emit column-major — grouped by
      // chapter in doc.chapters order, page order kept — so export order == outline order
      // even if the stored array drifted. Belt-and-braces with the load-time self-heal
      // in normalizeDoc; the outline itself already regroups so it was never wrong.
      var orderedPages = window.resortColumnMajor
        ? window.resortColumnMajor(doc.pages, doc.chapters)
        : doc.pages;
      return orderedPages.map(function (page, i) {
        var root = cleanRoot(window.renderPage(page, theme, window.resolveHeaderFooter(doc, page)), ctx, opts);
        var sec = '<section class="scorm-page' + (i === 0 ? " is-current" : "") + '" data-index="' + i + '" data-name="' + escapeAttr(page.name || page.id) + '">';
        return sec + root.outerHTML + "</section>";
      }).join("\n");
    } finally { restore(); }
  }
  function escapeAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  // #208 software-version bake: each product package bakes EVERY software version's DOM (one
  // resolveVersion pass per version, on the already-product-resolved `doc` so the two axes nest).
  // The latest (last-created) version is the live/default boot target; the rest ship hidden, ready
  // for the learner title-page selector (#209) to toggle. The SAME `opts` threads through every
  // version's serializePages call, so `_mediaUrlMap`/`_mediaFiles` accumulate and a shared asset is
  // written to media/<id> ONCE — N versions sharing images cost HTML weight only, not N x media
  // (storage invariant intact). A course with 0-1 versions is byte-identical to before (no wrapper).
  function serializeVersionedPages(doc, ctx, opts) {
    var versions = window.getVersions ? window.getVersions(doc) : (doc.versions || []);
    if (!versions || versions.length < 2 || !window.resolveVersion) {
      // #23: even the no-wrapper path has an EFFECTIVE version key (base/first, or none
      // at all) -- keep the library-axis hook accurate here too, so a libraryInstance
      // placement resolves the right version content.
      if (window.__libraryAxisContext) window.__libraryAxisContext.version = (versions && versions[0]) || null;
      return serializePages(doc, ctx, opts);
    }
    var latest = versions[versions.length - 1]; // default = latest = last-created (SPEC §3)
    return versions.map(function (v) {
      if (window.__libraryAxisContext) window.__libraryAxisContext.version = v; // #23: this pass bakes version v
      var markup = serializePages(window.resolveVersion(doc, v), ctx, opts); // per-version nav/interactions bake fresh (serializePages resets the render globals per call)
      var isDefault = v === latest;
      return '<div class="scorm-version' + (isDefault ? " is-version-current" : "") + '" data-version="' + escapeAttr(v) + '"' +
        (isDefault ? ' data-default="1"' : " hidden") + ">" + markup + "</div>";
    }).join("\n");
  }
  function escapeXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // PPP: does the course chrome (header/footer) already carry a given block type
  // (e.g. courseNav / modeToggle)? Used to drop the redundant scorm-bar pieces the
  // chrome now owns. Recurses children + columns so a nav/toggle nested in a
  // frame/group/columns still counts.
  function chromeHasBlockType(doc, type) {
    function scanList(list) {
      if (!list) return false;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (!b) continue;
        if (Array.isArray(b)) { if (scanList(b)) return true; continue; } // columns = array of block-arrays
        if (b.type === type) return true;
        if (scanList(b.children)) return true;
        if (scanList(b.columns)) return true;
      }
      return false;
    }
    var hf = (doc && doc.headerFooter) || {};
    return (hf.header && scanList(hf.header.children)) || (hf.footer && scanList(hf.footer.children)) || false;
  }

  // ---- runtime shell (the exported index.html) -----------------------------
  function shellHtml(doc, pagesMarkup, opts) {
    var title = (doc.meta && doc.meta.title) || "Course";
    // when the learner theme toggle is off, force DARK and omit the toggle
    // button. (Was the author's active mode; forced to "dark" so a course can
    // never ship light while the toggle is disabled. Restore `opts._activeMode
    // || "dark"` here when re-enabling author-pinned mode.)
    var fixed = (opts && !opts.learnerTheme) ? "dark" : null;
    var themeBtn = fixed ? "" : '<button class="scorm-btn" id="scorm-theme" type="button">Light / Dark</button>';
    var fixedScript = fixed ? '<script>window.__SCORM_FIXED_MODE="' + fixed + '";</script>' : "";
    // Compact interaction map for the shared runtime engine (SPEC-interactions §7).
    // Built from the SAME variant-resolved `doc` this shell serialises (§8), so the
    // exported ids/gates match the exported markup. `<` escaped so a hint string
    // can never break out of the inline <script>.
    var interactionMap = (typeof window !== "undefined" && window.buildInteractionMap) ? window.buildInteractionMap(doc) : {};
    var interactionScript = "<script>window.__INTERACTIONS=" + JSON.stringify(interactionMap).replace(/</g, "\\u003c") + ";</script>";
    // Item Z: ship the per-mode token maps + the theme-listener shim so the runtime
    // can re-theme HTML-interaction iframes on the learner toggle (parity with the
    // editor's reapplyTheme -> pushEmbedTheme). srcdoc interactions carry the shim
    // baked in already; the maps drive the postMessage, the shim covers bundled files.
    var themes = (window.Editor && window.Editor.getThemes) ? window.Editor.getThemes() : window.THEMES;
    var themeVars = { dark: colorVars(themes.dark.color), light: colorVars(themes.light.color) };
    var shim = (typeof window !== "undefined" && window.__EMBED_THEME_SHIM) || "";
    var themeVarsScript = "<script>window.__THEME_VARS=" + JSON.stringify(themeVars).replace(/</g, "\\u003c") +
      ";window.__EMBED_THEME_SHIM=" + JSON.stringify(shim).replace(/</g, "\\u003c") + ";</script>";
    // PPP: the header/footer chrome now owns the title (header), the learner nav
    // (footer courseNav) and the mode toggle (chrome modeToggle). Drop the redundant
    // scorm-bar TITLE always; ship prev/pos/next + the Light/Dark button ONLY as a
    // fallback when the chrome doesn't already provide them -- so a course authored
    // with footer nav gets a clean package (no black top bar) while a bare course
    // never loses navigation. RUNTIME_JS null-guards pos/prev/next for the omitted case.
    var hasNav = chromeHasBlockType(doc, "courseNav");
    var hasToggle = chromeHasBlockType(doc, "modeToggle");
    var barParts = [];
    if (themeBtn && !hasToggle) barParts.push(themeBtn);
    if (!hasNav) {
      barParts.push('<button class="scorm-btn" id="scorm-prev" type="button">&lsaquo; Prev</button>');
      barParts.push('<span class="scorm-bar__pos" id="scorm-pos"></span>');
      barParts.push('<button class="scorm-btn" id="scorm-next" type="button">Next &rsaquo;</button>');
    }
    var scormBar = barParts.length
      ? '<div class="scorm-bar"><span class="scorm-bar__spacer"></span>' + barParts.join("") + "</div>"
      : "";
    // #111: ship the course-completion splash inside the package (default ON for every
    // course; author opt-out only). Hidden by CSS until the Exit action reveals it.
    var endMarkup = "";
    if (window.renderEndScreen && (!window.endScreenOn || window.endScreenOn(doc))) {
      try { endMarkup = window.renderEndScreen(doc).outerHTML; } catch (e) { endMarkup = ""; }
    }
    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + escapeXml(title) + "</title>",
      '<link rel="stylesheet" href="theme.css">',
      '<link rel="stylesheet" href="course.css">',
      '<style>' + SHELL_CSS + "</style>",
      fixedScript,
      '<script src="scorm-api.js"></script>',
      '<script src="runtime.js"></script>',
      '<script src="quiz-runtime.js"></script>',
      "</head>",
      "<body>",
      scormBar,
      '<main id="scorm-pages">',
      pagesMarkup,
      endMarkup,
      "</main>",
      interactionScript,
      themeVarsScript,
      "<script>" + RUNTIME_JS + "</script>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  // inlined into the exported index.html
  //
  // The existing page-swap (show()/prev/next/visited/theme/breakpoint/fit) is kept
  // verbatim and exposed to the SHARED interaction engine as a `nav` adapter, so
  // CourseRuntime (runtime.js) owns clicks -> actions, media/checkbox state, and
  // reactive gates ON TOP of the existing navigation without duplicating it. The
  // engine's onComplete (all pages visited AND all `required` gates satisfied)
  // drives markComplete(); with no required gates the completion is byte-identical
  // to the old baseline. If runtime.js is somehow absent, the shell falls back to
  // the previous hand-rolled nav + all-pages-visited completion (guarded by !engine).
  var RUNTIME_JS = [
    "(function(){",
    // #209 software-version layer: each product package bakes every version's DOM (#208); the
    // runtime shows ONE version wrapper at a time, scoping nav + the interaction engine to it, and
    // injects a title-page selector to pick + LOCK a version for the session. A 0-1 version course
    // has no wrapper -> vscope=document and everything below is byte-identical to before.
    "  var __vwraps=[].slice.call(document.querySelectorAll('.scorm-version'));",
    "  var __hasVers=__vwraps.length>1, activeVersion=null, progByVer={};",
    "  function __defWrap(){ for(var i=0;i<__vwraps.length;i++){ if(__vwraps[i].getAttribute('data-default')) return __vwraps[i]; } return __vwraps[__vwraps.length-1]||null; }",
    "  function __wrapFor(v){ for(var i=0;i<__vwraps.length;i++){ if(__vwraps[i].getAttribute('data-version')===v) return __vwraps[i]; } return null; }",
    "  var vscope=__hasVers?(__defWrap()||document):document;",
    "  function __showWrap(w){ __vwraps.forEach(function(x){ var on=(x===w); x.hidden=!on; x.classList.toggle('is-version-current',on); }); vscope=w; activeVersion=w.getAttribute('data-version'); }",
    "  if(__hasVers){ __showWrap(vscope); } // boot to the default (latest) version",
    "  var pages=[].slice.call(vscope.querySelectorAll('.scorm-page'));",
    "  var pos=document.getElementById('scorm-pos');",
    "  var prev=document.getElementById('scorm-prev'), next=document.getElementById('scorm-next');",
    "  var roots=[].slice.call(document.querySelectorAll('.course-root'));",
    "  roots.forEach(function(r){ r.setAttribute('data-env','runtime'); }); // VVVV: footer floats as pills at runtime (canvas stays inline)",
    "  var cur=0, completed=false, engine=null;",
    // Boot profiler (P0 LMS-freeze diagnosis): the Start-button freeze is LMS-specific and
    // cannot be reproduced locally, so bake a cheap phase timer into every export. It logs a
    // single '[verso-boot]' record to the console (invisible to learners) and, when the URL has
    // ?bootprofile=1 (or localStorage 'verso_bootprofile'), paints an on-screen readout so the
    // culprit phase is visible in the LMS iframe without per-frame DevTools. Marks bracket each
    // synchronous startup phase; navigation timing captures the pre-script HTML parse (a large
    // base64 payload parsing in the LMS iframe is a prime suspect). (2026-07-09.)
    "  var __boot=(window.performance&&performance.now)?{t0:performance.now(),m:[]}:null;",
    "  function __mark(n){ if(__boot) __boot.m.push([n, performance.now()]); }",
    // page ids in index order (data-page-id, else a synthetic id) — powers both the
    // [data-goto] jump lookup and the engine nav adapter's pageIds()/currentPageId()
    "  var idIndex={}, pageIdList=[];",
    // recompute the scoped page set + id maps (re-run on a version switch, where vscope changes).
    "  function __rescope(){ pages=[].slice.call(vscope.querySelectorAll('.scorm-page')); idIndex={}; pageIdList=pages.map(function(p,idx){ var sec=p.querySelector('.page'); var id=(sec&&sec.getAttribute('data-page-id'))||('__p'+idx); idIndex[id]=idx; return id; }); }",
    "  __rescope();",
    "  var visited={};",
    // SCORM lifecycle. NOTE: SCORM.init() is DEFERRED to the very end (after nav is wired +
    // page 1 is shown) — see __scormInit below. A slow LMS LMSInitialize (synchronous, some
    // LMSs take many seconds) must NOT sit ahead of the click-handler wiring, or slide 1's
    // Start button renders (static HTML) but is dead until the handshake returns. (Fix 2026-07-08.)
    "  function markComplete(){ if(completed||!window.SCORM)return; completed=true; SCORM.setStatus('completed'); SCORM.save(); }",
    // #111 course-completion splash: fill the meta chips (modules completed / date) from
    // runtime state at show time. Modules total + the module->page map are baked by
    // render.js; 'completed' is counted here from the engine's visited pages.
    "  function fillEndMeta(host){",
    "    var total=parseInt(host.getAttribute('data-modules-total'),10)||0;",
    "    var vis=(engine&&engine.state&&engine.state.visited)||{}; var done=total;",
    "    var mapAttr=host.getAttribute('data-modules-map');",
    "    if(mapAttr){ try{ var mm=JSON.parse(mapAttr); done=mm.filter(function(ids){ return ids.length && ids.every(function(id){ return !!vis[id]; }); }).length; }catch(_){} }",
    "    else { var c=0; for(var k in vis){ if(vis[k]) c++; } done=total?Math.min(c,total):c; }",
    "    var mval=host.querySelector('[data-end-chip=\"modules\"] .course-end__chip-val');",
    "    if(mval){ if(total>0){ mval.textContent=done+' / '+total; } else { var mc=host.querySelector('[data-end-chip=\"modules\"]'); if(mc) mc.setAttribute('data-end-empty','1'); } }",
    "    var dval=host.querySelector('[data-end-chip=\"date\"] .course-end__chip-val');",
    "    if(dval){ try{ dval.textContent=new Date().toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }catch(_){ dval.textContent=''; } }",
    "  }",
    // Exit-course action (#111): show OUR branded splash instead of the LMS default page.
    // Commit completion + keep the SCORM session open (NO LMSFinish) so the learner stays
    // on our terminal screen; they close the window themselves. Falls back to the old
    // quit('logout') path only when no splash shipped (author turned it off).
    "  function exitCourse(){",
    "    var host=document.querySelector('[data-course-end]');",
    "    if(!host){ if(window.SCORM){ try{SCORM.init(); SCORM.quit('logout');}catch(_){} } try{window.close();}catch(_){} return; }",
    // init() is idempotent + guarded: force it here so an Exit clicked BEFORE the deferred
    // requestIdleCallback boot-init has fired still finalizes (otherwise setStatus/save/quit
    // are silent no-ops and the LMS records nothing). This was the "completion not recorded" bug.
    "    if(window.SCORM){ try{ SCORM.init(); SCORM.setStatus('completed'); SCORM.save(); }catch(_){} }",
    "    fillEndMeta(host);",
    "    var bar=document.querySelector('.scorm-bar'); if(bar) bar.style.display='none';",
    "    pages.forEach(function(p){ p.style.display='none'; });",
    "    try{ host.setAttribute('data-mode', effective()); host.setAttribute('data-bp', bpForWidth(window.innerWidth)); }catch(_){}",
    "    var ce=host.querySelector('.course-end')||host; ce.classList.add('is-shown');",
    "    try{ if(window.scrollTo)window.scrollTo(0,0); }catch(_){}",
    // Finalize the attempt so the LMS RECORDS completion. LMSCommit alone doesn't stick
    // on every LMS (some only persist lesson_status on LMSFinish), so we Finish here --
    // but with an EMPTY exit ('', not 'logout'): empty keeps the learner on our SCO (the
    // splash stays visible) while still flushing status; 'logout' would navigate away.
    "    if(window.SCORM){ try{ SCORM.quit(''); }catch(_){} }",
    "  }",
    "  window.addEventListener('beforeunload', function(){ if(window.SCORM) SCORM.quit(); });",
    // theme: JS stamps the effective mode. Default DARK -> the OS/browser appearance
    // preference is deliberately IGNORED (a fixed mode or a saved override wins). When
    // the learner toggle returns, add the OS signal back here as the initial default.
    "  var sid=(window.SCORM&&SCORM.getStudentId)?SCORM.getStudentId():'guest';",
    "  var storageKey='scorm_theme_'+(sid||'guest');",
    "  var override=null; try{ override=localStorage.getItem(storageKey); }catch(_){}",
    "  function effective(){ return window.__SCORM_FIXED_MODE|| override|| 'dark'; }",
    // Item Z: push the active theme INTO every HTML-interaction iframe (same-origin
    // srcdoc/bundled) so it recolours to contrast on the learner toggle. Mirrors the
    // editor's window.pushEmbedTheme; render.js does not ship, so it is inline here.
    "  function pushEmbeds(m){ var v=(window.__THEME_VARS&&window.__THEME_VARS[m])||{};",
    "    [].forEach.call(document.querySelectorAll('.embed--html'), function(wrap){",
    "      var frame=wrap.querySelector('.embed__iframe'); if(!frame)return;",
    "      var fb=wrap.getAttribute('data-theme-fallback')||'tokens'; var mp=null; var ea=wrap.getAttribute('data-embed-colormap'); if(ea){ try{mp=JSON.parse(ea);}catch(_){} } var msg={type:'theme',mode:m,vars:v,fallback:fb,map:mp};",
    "      try{ if(frame.contentWindow) frame.contentWindow.postMessage(msg,'*'); }catch(_){}",
    "      try{ var idoc=frame.contentDocument; if(idoc&&idoc.documentElement){",
    "        if(!idoc.getElementById('__theme_shim')&&window.__EMBED_THEME_SHIM){ var s=idoc.createElement('script'); s.id='__theme_shim'; s.textContent=window.__EMBED_THEME_SHIM; (idoc.body||idoc.documentElement).appendChild(s); }",
    "        var de=idoc.documentElement; for(var k in v){ try{de.style.setProperty(k,v[k]);}catch(_){} } if(mp){ for(var mk in mp){ try{de.style.setProperty(mk,mp[mk]);}catch(_){} } } de.setAttribute('data-mode',m); if(idoc.body) idoc.body.setAttribute('data-mode',m);",
    "      } }catch(_){} }); }",
    "  function applyMode(){ var m=effective(); roots.forEach(function(r){ r.setAttribute('data-mode', m); }); pushEmbeds(m); }",
    "  window.addEventListener('message', function(e){ var d=e.data; if(typeof d==='string'){ try{d=JSON.parse(d);}catch(_){ return; } } if(d&&d.type==='theme-shim-ready') pushEmbeds(effective()); });",
    // Item X: one toggle closure drives BOTH the wrapper's Light/Dark button AND
    // any learner mode-toggle the author placed in the header/footer headerFooter. Bound
    // by [data-mode-toggle] SELECTOR because headerFooter is global -> the control renders
    // once per page (N copies); reuses applyMode() wholesale (no new mechanism).
    "  function toggleTheme(){ override=(effective()==='dark')?'light':'dark'; try{localStorage.setItem(storageKey,override);}catch(_){} applyMode(); }",
    "  var tbtn=document.getElementById('scorm-theme'); if(tbtn) tbtn.addEventListener('click', toggleTheme);",
    "  [].forEach.call(document.querySelectorAll('[data-mode-toggle]'), function(b){ b.addEventListener('click', toggleTheme); });",
    // responsive breakpoint by real width (mirrors the editor's demo Auto mode)
    "  function bpForWidth(w){ return w<600?'mobile':(w<1000?'tablet':'desktop'); }",
    "  function applyBp(){ var bp=bpForWidth(window.innerWidth); roots.forEach(function(r){ r.setAttribute('data-bp', bp); }); }",
    // fit fixed-width HTML interactions down to the available width (mirrors editor fitEmbeds)
    "  function fit(){ [].forEach.call(document.querySelectorAll('.embed--html'), function(wrap){",
    "    var f=wrap.querySelector('.embed__fit'); var frame=wrap.querySelector('.embed__iframe'); if(!f||!frame)return;",
    "    var dw=parseInt(wrap.getAttribute('data-fit-width'),10)||900; var hpx=parseInt(wrap.getAttribute('data-height'),10)||500;",
    "    var avail=f.clientWidth||dw; var s=Math.min(1, avail/dw);",
    "    frame.style.width=dw+'px'; frame.style.height=hpx+'px'; frame.style.transformOrigin='top left'; frame.style.transform='scale('+s+')';",
    "    var vis=dw*s, gap=avail-vis, al=wrap.getAttribute('data-align')||'start'; var off=al==='center'?gap/2:(al==='end'?gap:0); frame.style.marginLeft=(off>0?off:0)+'px';",
    "    f.style.height=(hpx*s)+'px'; }); }",
    // page-swap headerFooter only — page 'visited' + completion are owned by the engine
    // (or the !engine fallback below), never here, so a required gate can withhold it
    "  function show(i){ cur=Math.max(0, Math.min(i, pages.length-1));",
    "    pages.forEach(function(p,idx){ p.classList.toggle('is-current', idx===cur); });",
    // Every page must START AT THE TOP: reset the window/document scroll (the SCORM
    // scroller — content flows in <main>, the footer is fixed) + any inner scroller on
    // the new page, so navigating never lands mid-page. (Fix 2026-07-08.)
    "    try{ if(window.scrollTo)window.scrollTo(0,0); var se=document.scrollingElement||document.documentElement; if(se)se.scrollTop=0; var cp=pages[cur]; if(cp){ cp.scrollTop=0; var cr=cp.querySelector('.course-root'); if(cr)cr.scrollTop=0; } }catch(_){}",
    "    if(pos) pos.textContent=(cur+1)+' / '+pages.length;",
    "    if(prev) prev.disabled=(cur===0); if(next) next.textContent=(cur===pages.length-1)?'Finish':'Next \\u203a';",
    "    if(!engine){ visited[cur]=true; if(Object.keys(visited).length>=pages.length) markComplete(); }",
    // #210: page 'viewed' progress is tracked PER VERSION (each version has its own page-set),
    // persisted to suspend_data for resume. Completion is COURSE-LEVEL: any single version's full
    // pass marks complete (markComplete is guarded, so sampling another version never un-completes).
    "    if(__hasVers){ var __pv=progByVer[activeVersion]||(progByVer[activeVersion]={}); if(pageIdList[cur]!=null) __pv[pageIdList[cur]]=1; __persistState(); if(Object.keys(__pv).length>=pages.length) markComplete(); }",
    "    requestAnimationFrame(fit); }",
    // nav adapter over the existing show()/pages — the engine drives it and marks
    // each landed page visited via currentPageId(), so behaviour == the old runtime
    "  var nav={ count:function(){return pages.length;}, pageIds:function(){return pageIdList.slice();},",
    "    currentPageId:function(){return pageIdList[cur];},",
    "    goto:function(id){ if(idIndex.hasOwnProperty(id)){ show(idIndex[id]); return true; } return false; },",
    "    next:function(){ show(cur+1); }, prev:function(){ show(cur-1); } };",
    // Isolate the interaction engine: if create() throws, it must NOT halt this script
    // before QuizRuntime.init below (else quizzes render static/dead + the learner is
    // stuck). Fallback = the plain show()/nav path (engine stays null). (Bug 2026-07-08.)
    // #209: scope the engine to the active version wrapper (vscope) so nav/interactions/gates run
    // on that version only — duplicate ids across the other (hidden) version DOMs never collide.
    "  function __makeEngine(){ engine=null; if(window.CourseRuntime){ try{ engine=window.CourseRuntime.create({ root:vscope, interactions:(window.__INTERACTIONS||{}), nav:nav, onComplete:markComplete, onExit:exitCourse }); }catch(e){ engine=null; if(window.console&&console.error)console.error('CourseRuntime.create failed; falling back to basic nav:', e); } } }",
    "  __makeEngine();",
    "  __mark('engine');",
    // QQQ: activate native quiz blocks + report a score to SCORM. Each quiz DOM
    // node tallies its own unique-correct count (onResult fires per correct
    // answer); onComplete aggregates across all quizzes and writes cmi score.
    "  if(window.QuizRuntime){",
    "    var qStats={correct:0,total:0};",
    "    QuizRuntime.onResult=function(r){ if(!r||!r.correct||!r.quiz)return; if(!r.quiz.__seen)r.quiz.__seen={}; if(r.qid&&r.quiz.__seen[r.qid])return; if(r.qid)r.quiz.__seen[r.qid]=1; r.quiz.__c=(r.quiz.__c||0)+1; };",
    "    QuizRuntime.onComplete=function(r){ if(!r)return; qStats.correct+=(r.quiz&&r.quiz.__c)||0; qStats.total+=(r.total)||0; if(window.SCORM){ var pct=qStats.total?Math.round(100*qStats.correct/qStats.total):0; SCORM.setScore(pct,0,100); SCORM.save(); } };",
    "    try{ QuizRuntime.init(vscope); }catch(e){ if(window.console&&console.error)console.error('QuizRuntime.init failed:', e); }",
    "  }",
    "  __mark('quiz');",
    "  function goNext(){ if(engine) engine.next(); else show(cur+1); }",
    "  function goPrev(){ if(engine) engine.prev(); else show(cur-1); }",
    "  if(prev) prev.addEventListener('click', function(){ goPrev(); });",
    "  if(next) next.addEventListener('click', function(){ if(engine){ engine.next(); } else if(cur===pages.length-1){ markComplete(); } else show(cur+1); });",
    // [data-goto] menu cards / nav buttons: the engine already intercepts these
    // (runtime.js delegated click); only wire the standalone handler when it is absent
    "  if(!engine){ document.addEventListener('click', function(e){ var t=e.target&&e.target.closest?e.target.closest('[data-goto]'):null; if(!t)return; var id=t.getAttribute('data-goto'); if(idIndex.hasOwnProperty(id)){ e.preventDefault(); show(idIndex[id]); } }); }",
    "  document.addEventListener('keydown', function(e){ if(e.key==='ArrowRight') goNext(); else if(e.key==='ArrowLeft') goPrev(); });",
    "  window.addEventListener('resize', function(){ applyBp(); fit(); });",
    // Persist progress to the LMS when the learner leaves (tab close / navigate away) so a
    // mid-course exit still records status/score — without this, closing the tab can lose
    // the session's progress. LMSCommit only (safe on refresh); an explicit Exit action does
    // the LMSFinish. pagehide fires more reliably than beforeunload on mobile. (Hardening 2026-07-08.)
    "  var __committed=false; function __commit(){ if(__committed)return; try{ if(window.SCORM) SCORM.save(); }catch(_){} }",
    "  window.addEventListener('pagehide', __commit); window.addEventListener('beforeunload', __commit);",
    // Defensive init: theming/breakpoint must never prevent the FIRST page from showing
    // + the course being navigable. Guard each; show(0) is the critical last step.
    "  try{ applyMode(); }catch(e){ if(window.console&&console.error)console.error('applyMode failed:', e); }",
    "  try{ applyBp(); }catch(e){ if(window.console&&console.error)console.error('applyBp failed:', e); }",
    // #209: pick + LOCK a software version for the session. Reveals that version's baked DOM,
    // hides the rest, re-scopes nav + the engine + quizzes to it, resets to its title page. There
    // is NO mid-course version control (the selector lives only on the title page), so once picked
    // the version is fixed until the learner returns to the title — the SPEC's per-session lock.
    "  function selectVersion(v){ var w=__wrapFor(v); if(!w||v===activeVersion) return; __showWrap(w); __rescope(); __makeEngine(); if(window.QuizRuntime){ try{ QuizRuntime.init(vscope); }catch(_){} } cur=0; show(0); __injectSelector(); }",
    // Inject the version selector at the top of the CURRENT title page (page 1) content. Rebuilt on
    // every switch so the active pill reflects the live version. Author never places or styles it.
    "  function __injectSelector(){ if(!__hasVers) return; var title=pages[0]; if(!title) return; var host=title.querySelector('.course-root')||title; var old=host.querySelector(':scope > .scorm-version-select'); if(old) old.remove();",
    "    var box=document.createElement('div'); box.className='scorm-version-select'; var lbl=document.createElement('span'); lbl.className='scorm-version-select__label'; lbl.textContent='Software version'; box.appendChild(lbl);",
    "    __vwraps.forEach(function(w){ var v=w.getAttribute('data-version'); var b=document.createElement('button'); b.type='button'; b.className='scorm-version-opt'+(v===activeVersion?' is-active':''); b.textContent=v; b.setAttribute('data-version-opt',v); b.addEventListener('click', function(){ selectVersion(v); }); box.appendChild(b); });",
    "    host.insertBefore(box, host.firstChild); }",
    // #210 resume state: persist the chosen version + per-version progress into SCORM suspend_data.
    // Cheap set() on each nav (guards until SCORM.init); the existing __commit/save flushes it.
    "  function __persistState(){ if(!__hasVers||!window.SCORM) return; try{ SCORM.set('cmi.suspend_data', JSON.stringify({ v:activeVersion, prog:progByVer })); }catch(_){} }",
    // On relaunch (after the deferred SCORM.init so suspend_data is readable — preserving the
    // LMS-freeze boot fix): restore per-version progress, keep an already-recorded completion, and
    // drop the learner straight back into their chosen version (not re-presenting a forced choice).
    "  function __resumeState(){ if(!__hasVers||!window.SCORM) return; var st=null,raw=null; try{ st=SCORM.get('cmi.core.lesson_status'); }catch(_){} if(st==='completed'||st==='passed') completed=true; try{ raw=SCORM.get('cmi.suspend_data'); }catch(_){} if(!raw) return; try{ var o=JSON.parse(raw); if(o){ if(o.prog&&typeof o.prog==='object') progByVer=o.prog; if(o.v&&__wrapFor(o.v)&&o.v!==activeVersion) selectVersion(o.v); } }catch(_){} }",
    "  show(0);",
    "  __injectSelector();",
    "  __mark('show0');",
    // The LMS handshake (LMSInitialize) is synchronous and slow on some LMSs. Now that the nav
    // handlers are wired + page 1 is shown, run it OFF the critical path so the Start button is
    // live immediately: requestIdleCallback (or rAF->setTimeout fallback) runs it after the first
    // paint / when idle. Any pre-init SCORM call (markComplete/commit) guards on window.SCORM and
    // is a safe no-op until this lands — and it lands long before a learner can complete a page.
    // Boot profiler reporter: emit deltas between phase marks + the pre-script HTML parse
    // (navigation timing) + first paint. Runs once, after SCORM.init so its cost is included.
    "  var __reported=false;",
    "  function __fmt(n){ return (n==null)?null:Math.round(n*10)/10; }",
    "  function __report(){ if(!__boot||__reported)return; __reported=true;",
    "    var m=__boot.m, phases=[], prev=__boot.t0;",
    "    for(var i=0;i<m.length;i++){ phases.push(m[i][0]+'='+__fmt(m[i][1]-prev)+'ms'); prev=m[i][1]; }",
    "    var nav=null; try{ nav=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||null; }catch(_){}",
    "    var parse=nav?__fmt(nav.domInteractive-nav.responseEnd):null;",
    "    var fp=null; try{ var pe=performance.getEntriesByType&&performance.getEntriesByType('paint'); if(pe){ for(var j=0;j<pe.length;j++){ if(pe[j].name==='first-contentful-paint') fp=__fmt(pe[j].startTime); } } }catch(_){}",
    "    var scriptTotal=__fmt((m.length?m[m.length-1][1]:__boot.t0)-__boot.t0);",
    "    var rec={ htmlParseMs:parse, firstPaintMs:fp, scriptTotalMs:scriptTotal, phases:phases };",
    "    try{ if(window.console&&console.log) console.log('[verso-boot]', JSON.stringify(rec)); }catch(_){}",
    "    try{ var flag=(location.search.indexOf('bootprofile')>-1)||(window.localStorage&&localStorage.getItem('verso_bootprofile'));",
    "      if(flag){ var d=document.createElement('div'); d.setAttribute('style','position:fixed;left:8px;bottom:8px;z-index:99999;max-width:360px;background:#111;color:#0f0;font:11px/1.4 monospace;padding:8px 10px;border-radius:6px;white-space:pre-wrap;opacity:.92'); d.textContent='[verso-boot]\\nhtmlParse='+parse+'ms  firstPaint='+fp+'ms\\nscriptTotal='+scriptTotal+'ms\\n'+phases.join('  '); (document.body||document.documentElement).appendChild(d); } }catch(_){}",
    "  }",
    "  function __scormInit(){ try{ if(window.SCORM) SCORM.init(); }catch(e){ if(window.console&&console.error)console.error('SCORM.init failed:', e); } try{ __resumeState(); }catch(e){ if(window.console&&console.error)console.error('resume failed:', e); } __mark('scorm'); __report(); }",
    "  if(window.requestIdleCallback){ requestIdleCallback(__scormInit, { timeout: 2000 }); }",
    "  else if(window.requestAnimationFrame){ requestAnimationFrame(function(){ setTimeout(__scormInit, 0); }); }",
    "  else { setTimeout(__scormInit, 0); }",
    // Fallback: guarantee a boot record even if __scormInit is delayed/never fires (idle starvation).
    "  setTimeout(__report, 4000);",
    "})();"
  ].join("\n");

  // ---- manifest ------------------------------------------------------------
  function manifest(doc, fileNames) {
    var id = ((doc.meta && doc.meta.code) || "Course").replace(/[^A-Za-z0-9_]/g, "_");
    var title = escapeXml((doc.meta && doc.meta.title) || "Course");
    var fileEls = fileNames.map(function (n) { return '\t\t\t<file href="' + escapeXml(n) + '"/>'; }).join("\n");
    return [
      '<?xml version="1.0" encoding="utf-8" ?>',
      '<manifest identifier="' + id + '" version="1.0"',
      '       xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"',
      '       xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"',
      '       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      '       xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd',
      '                           http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">',
      "\t<metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>",
      '\t<organizations default="' + id + '_ORG">',
      '\t\t<organization identifier="' + id + '_ORG">',
      "\t\t\t<title>" + title + "</title>",
      '\t\t\t<item identifier="' + id + '_SCO" isvisible="true" identifierref="' + id + '_RES">',
      "\t\t\t\t<title>" + title + "</title>",
      "\t\t\t</item>",
      "\t\t</organization>",
      "\t</organizations>",
      "\t<resources>",
      '\t\t<resource identifier="' + id + '_RES" type="webcontent" href="index.html" adlcp:scormtype="sco">',
      fileEls,
      "\t\t</resource>",
      "\t</resources>",
      "</manifest>"
    ].join("\n");
  }

  // ---- orchestrate ---------------------------------------------------------
  function collectInteractionSrcs(doc) {
    var srcs = {};
    doc.pages.forEach(function (p) { (p.blocks || []).forEach(function (b) { if (b.type === "htmlEmbed" && b.src) srcs[b.src] = true; }); });
    return Object.keys(srcs);
  }

  var FONT_FILES = ["Exo2-Regular.ttf", "Exo2-SemiBold.ttf", "Exo2-Bold.ttf", "Exo2-ExtraBold.ttf"];

  // ---- export options + versioning -----------------------------------------
  // Only SCORM 1.2 is emitted today; `format` is a seam for future targets
  // (SCORM 2004, xAPI, plain web) selectable in the modal.
  // uio-P-C05 (PUB-13): the "soon" state is DATA (`enabled: false`), not glued into the label, so
  // every surface that lists the formats states availability the same way. formats() is the one
  // published list -- the Publish stage's Format control reads it instead of keeping its own copy.
  var FORMATS = [
    { value: "scorm12", label: "SCORM 1.2", enabled: true },
    { value: "scorm2004", label: "SCORM 2004", enabled: false },
    { value: "xapi", label: "xAPI / Tin Can", enabled: false },
    { value: "web", label: "Standalone web", enabled: false }
  ];
  function formats() { return FORMATS.map(function (f) { return { value: f.value, label: f.label, enabled: f.enabled }; }); }
  function defaultOptions() {
    return { format: "scorm12", version: "V001", embedFonts: true, scrollbar: true, learnerTheme: false, webVideo: "link", variant: null, reviewFile: false, optimiseMedia: true, maxImageDim: 2000, imageQuality: 0.85, externalizeMedia: true };
  }
  function variantList() { var d = window.Editor.getDoc(); return (d.variants || []).slice(); }
  function docCode() { var d = window.Editor.getDoc(); return ((d.meta && d.meta.code) || "course"); }
  function verKey() { return "authoring.exportVersion." + docCode(); }
  // increment the trailing number of a version string ("V001" -> "V002",
  // "V003.2" -> "V003.3"); start at V001 when nothing has been exported yet.
  function suggestVersion(last) {
    if (!last) return "V001";
    var m = String(last).match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return last;
    return m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0") + m[3];
  }
  function loadSuggestedVersion() {
    var last = null; try { last = localStorage.getItem(verKey()); } catch (e) {}
    return suggestVersion(last);
  }
  function saveVersion(v) { try { localStorage.setItem(verKey(), v); } catch (e) {} }
  function fileSafe(s) { return String(s).replace(/[^A-Za-z0-9_.-]/g, "_"); }
  // uio-P-C07 (PUB-05): `opts.code` lets a caller name the package for a document OTHER than the
  // one currently open — the publish queue shows each row its filename before it switches to that
  // document to build it. buildPackage is handed the SAME options object, so the name a row
  // promises and the name that gets written come from one call and cannot disagree.
  function packageName(opts) {
    var parts = [fileSafe((opts && opts.code) || docCode())];
    if (opts.version) parts.push(fileSafe(opts.version));
    if (opts.variant) parts.push(fileSafe(opts.variant)); // flagship omits the tag
    parts.push("SCORM");
    return parts.join("_") + ".zip";
  }

  // which web embeds would ship live vs are already offline-safe (for the modal)
  function scanWebEmbeds(doc) {
    var live = 0, local = 0;
    doc.pages.forEach(function (p) {
      (p.blocks || []).forEach(function (b) {
        if (b.type !== "webEmbed") return;
        if (b.localVideo) local++;
        else if (window.parseVideo(b.url).provider !== "empty") live++;
      });
    });
    return { live: live, local: local };
  }

  // Assemble the whole package. opts defaults keep this callable headlessly.
  // Resolves { blob, files, ctx:{net,dropped}, doc, name }.
  function buildPackage(opts) {
    opts = opts || defaultOptions();
    var baseDoc = window.Editor.getDoc();
    // Resolve for the chosen variant (null/undefined -> flagship/hero). This
    // drops variant-excluded pages/blocks and bakes content overrides, so the
    // exported markup is exactly what this variant ships — one hero course, N
    // clean packages, no forked copies (kills the V002 contamination class).
    var doc = window.resolveVariant ? window.resolveVariant(baseDoc, opts.variant) : baseDoc;
    // #23: this package builds for one EFFECTIVE variant key (never null -- falls back to
    // hero/identity, same as resolveVariant's own default) -- keep the library-axis hook
    // in sync so a libraryInstance placement's master template resolves the SAME variant.
    // version is set per-pass by serializeVersionedPages below.
    window.applyRenderContext({ libraryAxisContext: { variant: opts.variant || (baseDoc.heroVariant || "hero"), version: null } });
    var themes = window.Editor.getThemes();
    opts._activeMode = (window.Editor.getTheme() === themes.light) ? "light" : "dark";
    var ctx = { net: [], dropped: [] };

    // §286: optional async media-optimise pre-pass. Builds an EXPORT-ONLY map of
    // {assetId -> downscaled/recompressed dataUrl} that serializePages feeds into
    // the inline step; the store + doc are never mutated (non-destructive). Video/
    // svg are skipped (see media-optim.js). Falls through to originals when off or
    // unavailable, so the existing oversize WARN stays the fallback.
    var prep = (opts.optimiseMedia !== false && window.MediaOptim && window.AssetStore)
      ? window.MediaOptim.buildOptimMap(doc,
          { maxDim: opts.maxImageDim || 2000, quality: (opts.imageQuality != null ? opts.imageQuality : 0.85) },
          function (id) { return window.AssetStore.get(id); })
      : Promise.resolve({ map: {}, report: null });

    return prep.then(function (res) {
      opts._optimMap = res && res.map || {};
      ctx.optimReport = res && res.report || null;
      return assemblePackage(doc, ctx, opts, themes);
    });
  }

  // Body of the build, run AFTER the optimise pre-pass has resolved so the inline
  // step (serializePages -> resolveMedia) can prefer the optimised bytes.
  function assemblePackage(doc, ctx, opts, themes) {
    var pagesMarkup = serializeVersionedPages(doc, ctx, opts); // #208: bakes every software version (or exactly today's markup when <2 versions)
    var files = [];
    var fetches = [];

    // live single-source assets
    fetches.push(fetchText("src/course.css").then(function (css) { files.push(textFile("course.css", css)); }));
    fetches.push(fetchText("export/scorm-api.js").then(function (js) { files.push(textFile("scorm-api.js", js)); }));
    // the shared interaction engine — bundled live from source (single source of
    // truth, same as course.css) and loaded by the shell before its inline runtime
    fetches.push(fetchText("src/runtime.js").then(function (js) { files.push(textFile("runtime.js", js)); }));
    // QQQ: the quiz engine (window.QuizRuntime) must ship too, or native quiz
    // blocks render inert in the package (all options face-up, no interaction).
    fetches.push(fetchText("src/quiz-runtime.js").then(function (js) { files.push(textFile("quiz-runtime.js", js)); }));
    if (opts.embedFonts) {
      FONT_FILES.forEach(function (f) { fetches.push(fetchBytes("export/fonts/" + f).then(function (b) { files.push({ name: "fonts/" + f, bytes: b }); })); });
    }
    collectInteractionSrcs(doc).forEach(function (src) {
      fetches.push(fetchBytes(src).then(function (b) { files.push({ name: src, bytes: b }); })
        .catch(function (e) { console.warn("[export] interaction asset missing, skipped: " + src, e); }));
    });

    return Promise.all(fetches).then(function () {
      var css = themeCss(themes);
      if (opts.embedFonts) css += "\n" + FONT_FACE_CSS;
      // KKK: uploaded custom fonts, base64-inlined (air-gap safe) — always shipped,
      // independent of the Exo 2 bundle toggle, since they're explicit author uploads.
      var docFontCss = (window.buildFontFaceCss && window.buildFontFaceCss(doc)) || "";
      if (docFontCss) css += "\n" + docFontCss;
      if (opts.scrollbar) css += "\n" + SCROLLBAR_CSS;
      files.push(textFile("theme.css", css));
      files.push(textFile("index.html", shellHtml(doc, pagesMarkup, opts)));
      // #193: externalised media files (media/<id>.<ext>) ride in the SAME zip and are
      // listed in the manifest below like every other packaged file.
      (opts._mediaFiles || []).forEach(function (f) { files.push(f); });
      var names = files.map(function (f) { return f.name; });
      files.unshift(textFile("imsmanifest.xml", manifest(doc, names)));
      return { blob: makeZip(files), files: files, ctx: ctx, doc: doc, name: packageName(opts) };
    });
  }

  function triggerDownload(blob, name) {
    // Do NOT fail silently (OOO): if the download can't even be dispatched,
    // surface it. (The Verso desktop shell also needs a WKDownloadDelegate for
    // the blob <a download> to land a file at all -- see desktop/AuthoringTool.swift.)
    try {
      var a = document.createElement("a");
      var url = URL.createObjectURL(blob);
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      console.error("[export] download dispatch failed for " + name, e);
      alert("Could not start the download for " + name + ":\n" + (e && e.message || e) +
        "\n\nIf you are in the Verso desktop app and no Save dialog appears, export from a browser at http://localhost:8123 instead.");
      return false;
    }
  }

  function withBtn(modalBtn, fn) {
    var restore = null;
    if (modalBtn) { modalBtn.disabled = true; var t = modalBtn.textContent; modalBtn.textContent = "Exporting…"; restore = function () { modalBtn.disabled = false; modalBtn.textContent = t; }; }
    function fail(e) {
      console.error("[export] failed", e);
      alert("Export failed: " + ((e && e.message) || e) + "\n\nNothing was saved. See the console (browser at localhost:8123) for details.");
      if (restore) restore();
    }
    // catch BOTH async rejections and a synchronous throw during assembly, so an
    // export error can never silently no-op (ZZZ).
    try { return fn(restore).catch(fail); }
    catch (e) { fail(e); return Promise.resolve(null); }
  }

  // Estimate the exported course WEIGHT in bytes: base64 asset payloads (decoded ~0.75x)
  // plus the serialised doc. Single source for both the oversize-package guard below and
  // the live toolbar readout (§308) so the two never diverge. Pure of the export pipeline.
  function estimateCourseBytes(doc) {
    var bytes = 0;
    if (window.collectAssetRefs && window.AssetStore && window.AssetStore.get) {
      window.collectAssetRefs(doc).forEach(function (id) {
        var a = window.AssetStore.get(id);
        if (a && a.dataUrl) { var c = a.dataUrl.indexOf(","); bytes += Math.floor((a.dataUrl.length - (c + 1)) * 0.75); }
      });
    }
    try { bytes += ENC.encode(JSON.stringify(doc)).length; } catch (e) {}
    return bytes;
  }
  window.estimateCourseBytes = estimateCourseBytes;

  // EEE: pre-export validation. Catch problems that would ship a BROKEN course
  // to Moodle -- dangling nav targets, unresolved/missing media, empty required
  // fields -- BEFORE the upload, not after. Returns a deduped issue list.
  function validateExport(doc) {
    var seen = {}, issues = [];
    function add(level, msg) { var k = level + "|" + msg; if (seen[k]) return; seen[k] = 1; issues.push({ level: level, msg: msg }); }
    var pageIds = {}, seenPid = {};
    (doc.pages || []).forEach(function (p) {
      if (!p.id) return;
      // Duplicate ids silently break nav: goToSlide + the runtime idIndex resolve
      // to the last page with that id, not the one the author linked.
      if (seenPid[p.id]) add("error", 'Two pages share the id "' + p.id + '" - navigation will be ambiguous and jump to the wrong page.');
      seenPid[p.id] = true; pageIds[p.id] = true;
    });
    function checkGoto(goto, label) {
      if (goto && !pageIds[goto]) add("error", label + ' links to a missing page (id "' + goto + '").');
    }
    function walk(blocks) {
      (blocks || []).forEach(function (b) {
        var goto = b.action && b.action.goto;
        if (b.type === "navButton") {
          if (b.action && b.action.exit) { /* Exit-course DO-action: ends the SCORM session, no page target needed */ }
          else if (!goto) add("warn", 'A nav button ("' + (b.text || b.label || "untitled") + '") has no target page.');
          else checkGoto(goto, "A nav button");
        } else checkGoto(goto, "A block");
        if (b.type === "courseNav") {
          (b.sections || []).forEach(function (s) {
            (s.pageIds || s.pages || []).forEach(function (pid) { checkGoto(pid, 'Menu section "' + (s.label || s.id || "") + '"'); });
          });
        }
        if (b.type === "image" && !b.src && !b.srcLight && !b.srcDark) add("warn", "An image block has no image set (ships empty).");
        if (b.type === "quiz") {
          var qs = b.questions || [];
          if (!qs.length) add("warn", "A quiz has no questions and will ship empty.");
          qs.forEach(function (q) {
            var qtype = q.type || "multipleChoice";
            if (qtype === "cardSort") {
              if (!(q.cards || []).length || !(q.categories || []).length) add("warn", "A card-sort quiz question is missing its cards or categories.");
            } else {
              // multipleChoice / fillBlank: completion requires answering every
              // question correctly, so a question with no correct option can NEVER
              // be completed -- a hard ship blocker.
              var opts = q.options || [];
              if (!opts.length) add("warn", "A quiz question has no answer options.");
              else if (!opts.some(function (o) { return o.correct; })) add("error", "A quiz question has no correct answer marked - learners can never complete it.");
            }
          });
        }
        (b.instances || []).forEach(function (ins) { checkGoto(ins.action && ins.action.goto, "A menu card"); });
        if (b.children) walk(b.children);
        if (b.columns) b.columns.forEach(walk);
        // accordion / cardReveal nested lists (incl. flip fronts) carry gotos/quizzes too
        if (Array.isArray(b.items)) b.items.forEach(function (it) { if (!it) return; if (Array.isArray(it.children)) walk(it.children); if (Array.isArray(it.front)) walk(it.front); });
      });
    }
    (doc.pages || []).forEach(function (p) { walk(p.blocks); });
    // Also validate the CHROME (header/footer children) -- post-PPP the footer
    // courseNav is the course's PRIMARY nav surface, so a stale section pageId (a
    // deleted/renamed chapter page) there ships a broken jump menu to Moodle and
    // must be caught too. Reuses the same walk (courseNav sections, nav buttons, gotos).
    var hf = doc.headerFooter || {};
    if (hf.header && hf.header.children) walk(hf.header.children);
    if (hf.footer && hf.footer.children) walk(hf.footer.children);
    // Empty-course guard: exporting a zero-content course ships a broken package.
    var pages = doc.pages || [], totalBlocks = 0;
    pages.forEach(function (p) { totalBlocks += (p.blocks || []).length; });
    if (!pages.length || !totalBlocks) add("error", "The course has no content to export.");
    if (window.collectAssetRefs && window.AssetStore) {
      window.collectAssetRefs(doc).forEach(function (id) {
        if (!window.AssetStore.has(id)) add("error", "A media asset is missing from the store (id " + id + ") and will ship blank.");
      });
    }
    // KKK: warn on ANY used font that won't render offline -- any non-empty `font`
    // value outside the air-gap-safe/embeddable set. Deliberately NOT gated on the
    // font being "known" (in this session's FONT_LIST): an IMPORTED/shared course
    // can carry a font (e.g. Inter, or a system font picked on another machine)
    // that isn't installed here -- exactly the case that would ship a silent
    // wrong-font failure to air-gapped Moodle -- so it must be flagged too. Deep-walk `font` keys.
    var embeddable = (window.EMBEDDABLE_FONTS || []).slice(), badFonts = {};
    (doc.fonts || []).forEach(function (f) { if (f.family) embeddable.push(f.family); }); // KKK: uploaded fonts ARE embedded -> never flag
    (function scanFonts(node, seen) {
      if (!node || typeof node !== "object") return;
      seen = seen || []; if (seen.indexOf(node) !== -1) return; seen.push(node);
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (k === "font" && typeof v === "string" && v && embeddable.indexOf(v) === -1) badFonts[v] = true;
        else if (v && typeof v === "object") scanFonts(v, seen);
      });
    })(doc);
    Object.keys(badFonts).forEach(function (f) {
      add("warn", 'Font "' + f + '" is used but is not embedded - it will fall back to a default font in offline/air-gapped Moodle. Use Exo 2 or a System font, or embed "' + f + '" at export, for guaranteed rendering.');
    });
    // Oversized-package guard (OO-B): base64 media is the usual culprit -- a few
    // large images or a video can push the zip past Moodle's upload limit and the
    // localStorage cousin of the same problem already bit once. Estimate from the
    // asset byte sizes (base64 -> ~0.75x) plus the serialised doc, warn early.
    if (window.collectAssetRefs && window.AssetStore && window.AssetStore.get) {
      var mb = estimateCourseBytes(doc) / (1024 * 1024);
      if (mb > 100) add("warn", "The exported package is large (about " + Math.round(mb) + " MB) and may exceed Moodle's upload limit (often 100-200 MB). Compress or externally host large images or video.");
    }
    return issues;
  }
  window.__validateExport = validateExport; // headless test hook
  // Show issues; return true to proceed with the export, false to abort.
  function confirmExportIssues(issues) {
    if (!issues.length) return true;
    var errs = issues.filter(function (i) { return i.level === "error"; });
    var warns = issues.filter(function (i) { return i.level === "warn"; });
    var lines = ["Pre-export check found " + issues.length + " issue(s):", ""];
    if (errs.length) { lines.push("ERRORS (" + errs.length + ") - likely to break the course:"); errs.forEach(function (i) { lines.push("  - " + i.msg); }); lines.push(""); }
    if (warns.length) { lines.push("Warnings (" + warns.length + "):"); warns.forEach(function (i) { lines.push("  - " + i.msg); }); lines.push(""); }
    lines.push("Export anyway?");
    return window.confirm(lines.join("\n"));
  }

  // Run pre-export validation but NEVER let it silently kill an export (ZZZ): a
  // validation crash is logged + skipped, and the confirm only aborts on a real
  // user "Cancel" (which now actually shows in Verso via the WKUIDelegate fix).
  function passesExportGate() {
    var issues = [];
    try { issues = validateExport(window.Editor.getDoc()); }
    catch (e) { if (window.console && console.error) console.error("[export] validation error (skipped):", e); }
    return !issues.length || confirmExportIssues(issues);
  }

  function doExport(opts, modalBtn) {
    if (!passesExportGate()) return Promise.resolve(null);
    return withBtn(modalBtn, function (restore) {
      return buildPackage(opts).then(function (pkg) {
        triggerDownload(pkg.blob, pkg.name);
        if (opts.version) saveVersion(opts.version);
        report(pkg);
        if (restore) restore();
        return pkg;
      });
    });
  }

  // #154: multi-select variant export. From the modal's checklist rows, build the
  // ordered set of packages to emit. Only ticked rows survive; each entry carries
  // its variant key (null = flagship), the resolved package filename, and the
  // chosen output-dir handle (null -> download fallback). Pure over packageName so
  // the headless guard can assert "N ticked -> N entries, right variant/name,
  // unticked skipped".
  function buildExportPlan(rows, opts) {
    return (rows || []).filter(function (r) { return r && r.selected; }).map(function (r) {
      var v = r.variant || null;
      return { variant: v, name: packageName(Object.assign({}, opts, { variant: v })), dir: r.dir || null };
    });
  }
  window.__buildExportPlan = buildExportPlan; // headless test hook

  // Build then deliver each planned package in sequence. `build`/`deliver` are
  // injected so the plan iteration is unit-testable headlessly with stubs:
  // build(entry) -> Promise<pkg>; deliver(pkg, entry) -> Promise<res>.
  function runExportPlan(plan, build, deliver) {
    var out = [];
    return (plan || []).reduce(function (chain, entry) {
      return chain.then(function () {
        return Promise.resolve(build(entry)).then(function (pkg) {
          return Promise.resolve(deliver(pkg, entry)).then(function (res) {
            out.push(Object.assign({ name: pkg.name, variant: entry.variant }, res || {}));
          });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }
  window.__runExportPlan = runExportPlan; // headless test hook

  // Check/ask readwrite permission on a File System Access dir handle (same shape
  // as editor.js's review/backup path). Older impls without queryPermission are
  // assumed granted.
  function dirPermission(handle) {
    if (!handle || !handle.queryPermission) return Promise.resolve("granted");
    var o = { mode: "readwrite" };
    return Promise.resolve(handle.queryPermission(o)).then(function (p) {
      if (p === "granted") return "granted";
      return Promise.resolve(handle.requestPermission(o)).catch(function () { return "denied"; });
    });
  }

  // Deliver one built package: write it into the row's chosen folder via a File
  // System Access writable when we hold a granted handle (create:true overwrites
  // an existing package of the same name); otherwise fall back to a browser
  // download (unsupported browser, no folder picked, or permission lost).
  function deliverExport(pkg, entry) {
    var dir = entry && entry.dir;
    if (dir && window.showDirectoryPicker) {
      return dirPermission(dir).then(function (perm) {
        if (perm !== "granted") { triggerDownload(pkg.blob, pkg.name); return { to: "download", path: pkg.name }; }
        return dir.getFileHandle(pkg.name, { create: true })
          .then(function (fh) { return fh.createWritable(); })
          .then(function (w) { return Promise.resolve(w.write(pkg.blob)).then(function () { return w.close(); }); })
          .then(function () { return { to: "folder", path: (dir.name || "folder") + "/" + pkg.name }; })
          .catch(function (e) {
            console.warn("[export] folder write failed, downloading instead: " + pkg.name, e);
            triggerDownload(pkg.blob, pkg.name); return { to: "download", path: pkg.name };
          });
      });
    }
    triggerDownload(pkg.blob, pkg.name);
    return Promise.resolve({ to: "download", path: pkg.name });
  }

  // #154 (replaces doExportAll): build every ticked package and write each to its
  // own chosen folder (or download fallback), behind one gate and one button.
  function doExportSelected(rows, opts, modalBtn) {
    if (!passesExportGate()) return Promise.resolve(null);
    var plan = buildExportPlan(rows, opts);
    if (!plan.length) { alert("Tick at least one package (flagship or a variant) to export."); return Promise.resolve(null); }
    return withBtn(modalBtn, function (restore) {
      return runExportPlan(plan,
        function (entry) {
          return buildPackage(Object.assign({}, opts, { variant: entry.variant })).then(function (pkg) { report(pkg); return pkg; });
        },
        deliverExport
      ).then(function (results) {
        if (opts.version) saveVersion(opts.version);
        if (restore) restore();
        var toFolder = results.filter(function (r) { return r.to === "folder"; }).length;
        console.info("[export] " + results.length + " package(s) delivered (" + toFolder + " to folder, " +
          (results.length - toFolder) + " downloaded):\n  - " + results.map(function (r) { return r.path + " (" + r.to + ")"; }).join("\n  - "));
        alert(results.length + " package(s) exported:\n\n" + results.map(function (r) {
          return "  - " + r.path + (r.to === "download" ? "  (downloaded)" : "");
        }).join("\n"));
        return results;
      });
    });
  }

  function report(pkg) {
    var kb = (pkg.blob.size / 1024).toFixed(0);
    console.info("[export] " + pkg.name + " built: " + pkg.files.length + " files, " + kb + " KB");
    if (console.table) console.table(pkg.files.map(function (f) { return { file: f.name, bytes: f.bytes.length }; }));
    if (pkg.ctx.net.length) console.warn("[export] " + pkg.ctx.net.length + " web embed(s) ship LIVE (network dependency):\n  - " + pkg.ctx.net.join("\n  - "));
    if (pkg.ctx.dropped.length) console.warn("[export] " + pkg.ctx.dropped.length + " web embed(s) NOT packaged (no local file, 'package locally' chosen):\n  - " + pkg.ctx.dropped.join("\n  - "));
    var or = pkg.ctx.optimReport;
    if (or && or.count) console.info("[export] media-optimise: shrank " + or.count + " of " + or.images + " image(s), saved " + (or.saved / (1024 * 1024)).toFixed(1) + " MB (" + (or.before / (1024 * 1024)).toFixed(1) + " -> " + (or.after / (1024 * 1024)).toFixed(1) + " MB).");
  }

  // ---- export options modal ------------------------------------------------
  function elh(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function showExportModal() {
    if (location.protocol === "file:") {
      alert("Export needs the http:// origin so it can bundle the fonts, course.css and interactions.\n\nRun ./serve.command (python3 -m http.server 8123) and open http://localhost:8123, then export again.");
      return;
    }
    var opts = defaultOptions();
    opts.version = loadSuggestedVersion();
    var scan = scanWebEmbeds(window.Editor.getDoc());
    var UI = window.VersoUI;

    // The dialog frame routes through the canonical VersoUI.Modal (issue #19) so it
    // shares one style with the rest of the modal family; box is just the body host
    // the option rows below append into. modal is assigned once the shell is built.
    var box = elh("div");
    var modal;

    // uio-O-W2 (OVL-07): the dialog's groups are the ONE canonical section, same as every
    // other surface — a chevron and a title, not a bold line with no affordance. `host` is
    // whichever section body the rows below are currently landing in.
    var host = box;
    function section(title) {
      var sec = UI.PanelSection({ title: title });
      box.appendChild(sec);
      host = sec.querySelector(".insp-section__body");
    }
    // a label + right-aligned control row
    function row(labelText) {
      var r = elh("div", "modal-field");
      r.appendChild(elh("span", "modal-field__label", labelText));
      host.appendChild(r); return r;
    }
    // segmented control bound to opts[key]; pairs = [[label,value],...]
    function seg(labelText, key, pairs, onChange, isToggle) {
      var r = row(labelText);
      var group = elh("div", "prop-toggle-row modal-field__control" + (isToggle ? " is-toggle" : ""));
      pairs.forEach(function (p) {
        var b = elh("button", "prop-toggle" + (opts[key] === p[1] ? " is-on" : ""), p[0]); b.type = "button";
        b.addEventListener("click", function () {
          opts[key] = p[1];
          Array.prototype.forEach.call(group.children, function (c) { c.classList.remove("is-on"); });
          b.classList.add("is-on");
          if (onChange) onChange();
        });
        group.appendChild(b);
      });
      r.appendChild(group);
    }
    function toggle(labelText, key) { seg(labelText, key, [["On", true], ["Off", false]], null, true); }

    // Format
    section("Format");
    var fmtRow = row("Package type");
    var sel = elh("select", "prop-select modal-field__control");
    FORMATS.forEach(function (f) { var o = elh("option", null, f.label + (f.enabled ? "" : " (soon)")); o.value = f.value; if (!f.enabled) o.disabled = true; if (f.value === opts.format) o.selected = true; sel.appendChild(o); });
    sel.addEventListener("change", function () { opts.format = sel.value; });
    fmtRow.appendChild(sel);

    // Variant (only shown when the course defines variants) — #154: a multi-select
    // checklist (flagship + each variant), each row with its own output-folder
    // picker. One Export button builds every ticked package and writes it to its
    // chosen folder (File System Access), falling back to a download when no folder
    // is picked or FSA is unavailable. exportRows stays null when the course has no
    // variants, so the plain single-flagship path below is unchanged.
    var variants = variantList();
    var exportRows = null;
    if (variants.length) {
      section("Variant");
      host.appendChild(elh("div", "insp-hint", "Tick the packages to export. Choose an output folder for each, or leave it to download to your browser's Downloads folder."));
      exportRows = [{ variant: null, label: "Flagship (base course)" }]
        .concat(variants.map(function (v) { return { variant: v, label: v }; }));
      exportRows.forEach(function (r) {
        r.selected = (r.variant === null); // flagship ticked by default
        r.dir = null;
        var rowEl = elh("div", "modal-field");
        rowEl.appendChild(UI.Checkbox({ checked: r.selected, label: r.label, onChange: function (v) { r.selected = v; updateName(); } }));
        var pick = elh("button", "prop-btn modal-field__control", "Choose folder…"); pick.type = "button";
        if (!window.showDirectoryPicker) {
          pick.disabled = true; pick.textContent = "Downloads";
          pick.title = "This browser can't pick a folder; the package downloads instead.";
        }
        pick.addEventListener("click", function () {
          if (!window.showDirectoryPicker) return;
          window.showDirectoryPicker({ mode: "readwrite" }).then(function (h) {
            r.dir = h; pick.textContent = h.name || "Chosen folder"; pick.title = "Writes to: " + (h.name || "chosen folder");
          }).catch(function () {});
        });
        rowEl.appendChild(pick);
        host.appendChild(rowEl);
      });
    }

    // Version
    section("Version");
    var verRow = row("Version");
    var verIn = elh("input", "prop-text modal-field__control"); verIn.type = "text"; verIn.spellcheck = false; verIn.value = opts.version;
    verIn.addEventListener("input", function () { opts.version = verIn.value.trim(); updateName(); });
    verRow.appendChild(verIn);
    var verHint = elh("div", "insp-hint", "Suggested next version — bumps automatically each export.");
    host.appendChild(verHint);

    // Include toggles
    section("Include");
    toggle("Embed Exo 2 fonts", "embedFonts");
    toggle("Always-visible scrollbar", "scrollbar");
    toggle("Learner dark / light toggle", "learnerTheme");

    // Optimise media (§286) — downscale + recompress oversized raster images so a
    // heavy course ships smaller. Non-destructive: originals are untouched; only the
    // exported copies are optimised. Video/SVG are never touched.
    section("Optimise media");
    toggle("Downscale + recompress images", "optimiseMedia");
    var dimRow = row("Max image size");
    var dimSel = elh("select", "prop-select modal-field__control");
    [["Original (off)", 0], ["1280 px", 1280], ["1600 px", 1600], ["2000 px", 2000], ["2560 px", 2560]].forEach(function (p) {
      var o = elh("option", null, p[0]); o.value = String(p[1]); if (p[1] === opts.maxImageDim) o.selected = true; dimSel.appendChild(o);
    });
    dimSel.addEventListener("change", function () { opts.maxImageDim = parseInt(dimSel.value, 10) || 0; });
    dimRow.appendChild(dimSel);
    seg("Quality", "imageQuality", [["Small", 0.7], ["Balanced", 0.85], ["High", 0.92]], null);
    host.appendChild(elh("div", "insp-hint", "Caps each image's longest edge and re-encodes it (JPEG stays JPEG; PNG/WebP/static GIF become WebP). Animated GIFs are re-encoded as GIFs (downscaled + fewer colours; Small also halves the frame rate) so they finally shrink too - they are usually the heaviest thing in a course. Only applied when it actually shrinks the file; small images and video/SVG are left as-is."));

    // #193: media as separate files vs one inlined index.html. Separate files keep
    // index.html tiny so the LMS can start the course immediately (the ~30s Moodle
    // Start-button freeze was the LMS downloading the whole inlined file first).
    section("Package structure");
    toggle("Package media as separate files (recommended)", "externalizeMedia");
    host.appendChild(elh("div", "insp-hint", "Ships images, GIFs and video as separate files INSIDE this same SCORM zip (referenced by relative path), instead of base64-inlining everything into index.html. Keeps index.html tiny so the course starts at once and media streams in - fixes the ~30s delay before the Start button responds in Moodle on heavy courses. Everything still lives in the one uploaded zip; nothing is hosted elsewhere. Turn off only to reproduce the old single-file behaviour."));

    // Review (Verso Viewer) — also emit the frozen .versopub.json snapshot so this
    // exact version can go out for review alongside the SCORM package.
    section("Review");
    toggle("Also publish review file", "reviewFile");
    host.appendChild(elh("div", "insp-hint", "Emits a Verso Viewer snapshot (.versopub.json) of this version — to the connected review folder, or a download — so reviewers can comment on it."));

    // Web video
    section("Web video embeds");
    seg("Video handling", "webVideo", [["Package locally", "package"], ["Link on web", "link"]], updateVideoNote);
    var vidNote = elh("div", "insp-hint", ""); host.appendChild(vidNote);
    function updateVideoNote() {
      if (scan.live === 0 && scan.local === 0) { vidNote.textContent = "No web video embeds in this course."; return; }
      var msg = [];
      if (scan.local) msg.push(scan.local + " uploaded video(s) will be packaged offline.");
      if (scan.live) msg.push(opts.webVideo === "package"
        ? scan.live + " web-link video(s) can't be packaged (no uploaded file) — they'll show an 'upload to include' placeholder."
        : scan.live + " web-link video(s) will stream live (needs network in the LMS).");
      vidNote.textContent = msg.join(" ");
    }
    updateVideoNote();

    // filename preview
    var nameLine = elh("div", "modal-filename");
    nameLine.appendChild(elh("span", "modal-filename__label", "Saves as"));
    var nameVal = elh("span", "modal-filename__value", "");
    nameLine.appendChild(nameVal);
    box.appendChild(nameLine);
    function updateName() {
      if (exportRows) {
        var n = exportRows.filter(function (r) { return r.selected; }).length;
        nameVal.textContent = n ? (n + " package" + (n === 1 ? "" : "s") + " (each to its chosen folder or Downloads)") : "Nothing selected";
        return;
      }
      nameVal.textContent = packageName(opts);
    }
    updateName();

    // actions — quiet ghost cancel + solid primary, right-aligned in the DS Modal
    // footer (issue #19). Controls come from the canonical VersoUI set.
    var cancel = UI.Button({ variant: "ghost", label: "Cancel", onClick: function () { modal.remove(); } });
    var exportBtn = UI.Button({ variant: "primary", label: "Export" });
    // §12: also emit the review snapshot when the toggle is on (same version).
    function alsoPublishReview() {
      if (!opts.reviewFile || !(window.Editor && window.Editor.publishReviewFile)) return Promise.resolve();
      return Promise.resolve(window.Editor.publishReviewFile(opts.version)).catch(function () {});
    }
    exportBtn.addEventListener("click", function () {
      if (exportRows) {
        doExportSelected(exportRows, opts, exportBtn).then(function (results) { if (results) alsoPublishReview().then(function () { modal.remove(); }); });
      } else {
        opts.variant = null;
        doExport(opts, exportBtn).then(function (pkg) { if (pkg) alsoPublishReview().then(function () { modal.remove(); }); });
      }
    });

    modal = UI.Modal({
      title: "Export package",
      description: "Bundle this course as a SCORM package for your LMS.",
      children: box, footer: [cancel, exportBtn], onClose: null
    });
    modal.id = "export-modal";
    document.body.appendChild(modal);
    verIn.focus(); verIn.select();
  }

  // expose builders + the whole assemble path for headless testing / driving
  window.SCORMExport = { makeZip: makeZip, crc32: crc32, themeCss: themeCss, manifest: manifest, tokenBody: tokenBody, buildPackage: buildPackage, defaultOptions: defaultOptions, formats: formats, suggestVersion: suggestVersion, packageName: packageName, variantList: variantList };

  window.Editor.registerPipelineButton("Export SCORM", showExportModal, true);
})();
