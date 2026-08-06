// editor/fonts.js -- type that survives being taken offline (arch-P3b-07).
//
// A course is exported as a folder and opened on a machine that may have no network at all, so a
// font it uses cannot be a link. Everything here exists to make that true: an uploaded file is
// stored in the asset store like an image and base64-inlined as an @font-face in BOTH the editor
// and the export, and a Google Font picked from the curated list is FETCHED at author-time and
// embedded the same way. No runtime CDN reference ever ships.
//
// The curated list is deliberately a hand-written set of the popular families rather than the full
// API, because the API is a network call and the whole point is not needing one.
//
// The picker flags a font it cannot vouch for. A family read from the system through Local Font
// Access will render for the author and may render as nothing on an air-gapped target, so the
// control says so rather than letting the course find out at delivery.
//
// render.js falls back to the raw family name when it is not in FONT_STACKS, which is why an
// uploaded family simply works everywhere the tokens are read.
//
// This is what the `custom (uploaded) fonts` banner actually held, once the header/footer editor
// (P3b-07e) and the glossary, motion and backup panel bodies are taken out of it.
//
// Editor chrome only: it decides what render() and the export are handed, and never renders.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "pushHistory", "renderInspector", "scheduleSave", "assetRef", "iconBtn",
      "promptModal", "panelSection", "dsSelect", "doc"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        pushHistory = E.pushHistory,
        renderInspector = E.renderInspector,
        scheduleSave = E.scheduleSave,
        assetRef = E.assetRef,
        iconBtn = E.iconBtn,
        promptModal = E.promptModal,
        panelSection = E.panelSection,
        dsSelect = E.dsSelect;

    // ---- KKK: custom (uploaded) fonts ----------------------------------------
    // doc.fonts = [{ family, src:"asset:<id>", format }]. The font file is stored in
    // the asset store (like an image) and base64-inlined as an @font-face in BOTH the
    // editor (a <style> below) AND the export (theme.css), so a course using an
    // uploaded font renders offline / air-gapped. render.js already falls back to the
    // raw family name when it isn't in FONT_STACKS, so a custom family "just works".
    function fontFormatFor(file) {
      var n = ((file && file.name) || "").toLowerCase();
      if (/\.woff2$/.test(n)) return "woff2";
      if (/\.woff$/.test(n)) return "woff";
      if (/\.otf$/.test(n)) return "opentype";
      return "truetype";
    }
    function resolveFontDataUrl(src) {
      if (!src) return null;
      if (src.indexOf("data:") === 0) return src;
      var m = /^asset:(.+)$/.exec(src);
      if (m && window.AssetStore) { var a = window.AssetStore.get(m[1]); return a ? a.dataUrl : null; }
      return null;
    }
    // Shared (editor + export): build the @font-face CSS for a doc's custom fonts.
    window.buildFontFaceCss = function (d) {
      return (((d && d.fonts) || []).map(function (f) {
        var url = resolveFontDataUrl(f.src);
        if (!url || url.indexOf("data:") !== 0) return "";
        var wt = f.weight ? "font-weight:" + f.weight + ";" : ""; // multi-weight embeds (e.g. Google 400 + 700)
        return "@font-face{font-family:'" + String(f.family).replace(/['\\]/g, "") + "';src:url('" + url + "') format('" + (f.format || "truetype") + "');" + wt + "font-display:swap;}";
      }).filter(Boolean)).join("\n");
    };
    function registerDocFontNames() {
      (E.doc.fonts || []).forEach(function (f) {
        if (!f.family) return;
        if (window.FONT_LIST && window.FONT_LIST.indexOf(f.family) === -1) window.FONT_LIST.push(f.family);
        if (window.EMBEDDABLE_FONTS && window.EMBEDDABLE_FONTS.indexOf(f.family) === -1) window.EMBEDDABLE_FONTS.push(f.family); // uploaded => embedded => never flagged
      });
    }
    function applyDocFonts() {
      var st = document.getElementById("doc-font-faces");
      if (!st) { st = document.createElement("style"); st.id = "doc-font-faces"; document.head.appendChild(st); }
      st.textContent = window.buildFontFaceCss(E.doc);
      registerDocFontNames();
    }
    window.__applyDocFonts = applyDocFonts; // headless/browser test hook
    window.__resolveAssetDataUrl = resolveFontDataUrl; // shared asset->dataURL (fonts, glossary, …)

    // A MODEST curated set of the most popular Google Fonts (James 2026-07-08: "most popular
    // as long as they include Exo 2 and Arial"). Exo 2 is bundled + already pickable; Arial is
    // a system font (in FONT_STACKS). Picking one here FETCHES the woff2 at author-time and
    // EMBEDS it (air-gap: no runtime CDN link ever ships). A hand list, not the full API.
    var CURATED_GOOGLE_FONTS = [
      "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Oswald", "Raleway",
      "Nunito", "Nunito Sans", "Merriweather", "Playfair Display", "Source Sans 3", "PT Sans",
      "Work Sans", "Rubik", "Noto Sans", "Ubuntu", "Mulish", "DM Sans", "Karla", "Fira Sans",
      "Barlow", "Josefin Sans", "Quicksand", "Libre Franklin", "Archivo", "Space Grotesk",
      "Manrope", "Cabin", "Bebas Neue", "Titillium Web", "Roboto Slab", "Roboto Condensed",
      "Kanit", "Heebo", "Assistant"
    ];
    window.CURATED_GOOGLE_FONTS = CURATED_GOOGLE_FONTS; // headless test hook
    // Fetch a Google Font's woff2 at AUTHOR time and embed it via the existing doc.fonts
    // pipeline (base64 @font-face → editor + export). Needs an internet connection while
    // authoring; the SHIPPED course stays self-contained. Overridable window.__fontFetch for
    // tests. Returns a Promise.
    function fetchAndEmbedGoogleFont(family) {
      if (!family) return Promise.resolve();
      if ((E.doc.fonts || []).some(function (f) { return f.family === family; })) { window.alert(family + " is already added."); return Promise.resolve(); }
      var doFetch = window.__fontFetch || window.fetch.bind(window);
      var api = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family) + ":wght@400;700&display=swap";
      function blobToDataUrl(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
      return doFetch(api).then(function (r) { if (!r.ok) throw new Error("CSS " + r.status); return r.text(); })
        .then(function (css) {
          // The CSS2 API returns one @font-face per weight/subset. Pick ONE woff2 per weight
          // (400 + 700) so bold is a REAL cut, not synthetic. Falls back to any single woff2.
          var byWeight = {};
          css.split("@font-face").forEach(function (blk) {
            var u = /url\((https:\/\/[^)]+\.woff2)\)/i.exec(blk); if (!u) return;
            var w = (/font-weight:\s*(\d+)/i.exec(blk) || [])[1] || "400";
            if (!byWeight[w]) byWeight[w] = u[1];
          });
          var weights = Object.keys(byWeight);
          if (!weights.length) throw new Error("no woff2 found");
          var wanted = weights.filter(function (w) { return w === "400" || w === "700"; });
          if (!wanted.length) wanted = [weights[0]];
          return Promise.all(wanted.map(function (w) {
            return doFetch(byWeight[w]).then(function (r) { if (!r.ok) throw new Error("woff2 " + r.status); return r.blob(); })
              .then(blobToDataUrl).then(function (dataUrl) { return { weight: w, dataUrl: dataUrl }; });
          }));
        })
        .then(function (faces) {
          pushHistory();
          E.doc.fonts = E.doc.fonts || [];
          faces.forEach(function (f) {
            E.doc.fonts.push({ family: family, src: assetRef(f.dataUrl, { name: family + "-" + f.weight + ".woff2", type: "font/woff2" }), format: "woff2", weight: parseInt(f.weight, 10), source: "google" });
          });
          applyDocFonts(); renderInspector(); scheduleSave();
        })
        .catch(function (e) { window.alert("Couldn't fetch " + family + " from Google Fonts (needs internet while authoring): " + (e && e.message || e)); });
    }
    window.__fetchGoogleFont = fetchAndEmbedGoogleFont; // headless test hook

    function buildFontsBody(c) {
      c.appendChild(h("div", "insp-hint", "Upload a font file (.ttf / .otf / .woff / .woff2) to embed it in the course — it renders offline. Then pick it as a font on any text."));
      E.doc.fonts = E.doc.fonts || [];
      // One row per FAMILY (a multi-weight embed is several entries but shows as one row;
      // the count hints at how many weights are embedded). Delete removes all of the family.
      var seen = {};
      E.doc.fonts.forEach(function (f) { if (!seen[f.family]) seen[f.family] = 0; seen[f.family]++; });
      Object.keys(seen).forEach(function (fam) {
        var row = h("div", "insp-row");
        var lbl = h("span", "insp-row__label", fam + (seen[fam] > 1 ? "  ·  " + seen[fam] + " weights" : "")); lbl.style.flex = "1 1 auto"; lbl.style.fontFamily = "'" + fam + "'";
        row.appendChild(lbl);
        var del = iconBtn("trash", "Remove font", true);
        del.addEventListener("click", function () { pushHistory(); E.doc.fonts = E.doc.fonts.filter(function (f) { return f.family !== fam; }); applyDocFonts(); renderInspector(); scheduleSave(); });
        row.appendChild(del);
        c.appendChild(row);
      });
      var up = h("button", "prop-btn", "Upload font…");
      up.addEventListener("click", function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".ttf,.otf,.woff,.woff2,font/*";
        inp.addEventListener("change", function () {
          var file = inp.files && inp.files[0]; if (!file) return;
          var r = new FileReader();
          r.onload = function () {
            promptModal("Name this font", "Name (as it appears in the picker)", file.name.replace(/\.(ttf|otf|woff2?)$/i, ""), function (family) {
              family = (family || "").trim();
              if (!family) return;
              pushHistory();
              E.doc.fonts = E.doc.fonts || [];
              E.doc.fonts.push({ family: family, src: assetRef(r.result, file), format: fontFormatFor(file) });
              applyDocFonts(); renderInspector(); scheduleSave();
            });
          };
          r.readAsDataURL(file);
        });
        inp.click();
      });
      c.appendChild(up);

      // Google Fonts source: pick a popular family -> fetched + embedded at author-time.
      var gf = panelSection(c, "Google Fonts");
      gf.appendChild(h("div", "insp-hint", "Pick a popular Google Font — it's downloaded and EMBEDDED now (needs internet), so the exported course stays offline-safe. Exo 2 is bundled; Arial is a system font — both already in the picker."));
      var added = {}; (E.doc.fonts || []).forEach(function (f) { added[f.family] = true; });
      var opts = CURATED_GOOGLE_FONTS.filter(function (fam) { return !added[fam]; }).map(function (fam) { return [fam, fam]; });
      gf.appendChild(h("div", "insp-row__label insp-row__label--stacked", "Google Font"));
      var gsel = dsSelect(opts, "", function (v) { if (!v) return; gsel.value = ""; fetchAndEmbedGoogleFont(v); }, { placeholder: "Add a Google Font…" });
      gf.appendChild(gsel);
    }

    // Item I: is a chosen font in the safe/embeddable set (web-loaded + bundled)?
    // Empty = theme default = safe. Anything else (a system font picked from the
    // fuller Local-Font-Access list) may not render on an offline/air-gapped target
    // unless embedded at export -- so we flag it.
    function isEmbeddableFont(name) {
      if (!name) return true;
      var emb = window.EMBEDDABLE_FONTS || [];
      return emb.indexOf(name) !== -1;
    }
    // font picker: a button + popup listbox where each font name is rendered IN
    // that font. Drop-in for the plain <select> font pickers — exposes `.value` (get/set) and
    // fires a 'change' event on pick, so attachFontWarn works against it unchanged. Options =
    // "" (Default) + window.FONT_LIST; only loaded families appear here, so previews render.
    // uio-E-C03: opts.inherited names the font that will actually apply when nothing is picked
    // here, so the empty state reads "Exo 2" in tertiary ink instead of the word "Default" —
    // which told an author the setting was blank and nothing about the page.
    function buildFontPicker(current, onPick, opts) {
      opts = opts || {};
      var wrap = h("div", "font-picker");
      var btn = h("button", "font-picker__btn prop-select"); btn.type = "button";
      var pop = h("div", "font-picker__pop"); pop.hidden = true;
      var val = current || "";
      function labelFor(v) { return v ? v : (opts.inherited || "Default"); }
      function stackFor(v) { return window.fontStackFor ? window.fontStackFor(v) : (v ? "'" + v + "'" : ""); }
      function paintBtn() {
        btn.textContent = labelFor(val);
        btn.style.fontFamily = stackFor(val || (opts.inherited || ""));
        btn.classList.toggle("is-inherited", !val && !!opts.inherited);
        if (!val && opts.inheritedTitle) btn.title = opts.inheritedTitle; else btn.removeAttribute("title");
      }
      (([""]).concat(window.FONT_LIST || [])).forEach(function (v) {
        var row = h("div", "font-picker__opt" + (v === val ? " is-active" : ""), labelFor(v));
        row.style.fontFamily = stackFor(v);
        row.addEventListener("click", function () {
          val = v; paintBtn();
          Array.prototype.forEach.call(pop.children, function (c) { c.classList.remove("is-active"); });
          row.classList.add("is-active");
          close(); onPick(v);
          try { wrap.dispatchEvent(new Event("change")); } catch (_) {}
        });
        pop.appendChild(row);
      });
      function onDoc(e) { if (!wrap.contains(e.target)) close(); }
      function onEsc(e) { if (e.key === "Escape") { close(); } }
      function open() { pop.hidden = false; btn.classList.add("is-open"); setTimeout(function () { document.addEventListener("mousedown", onDoc); }, 0); document.addEventListener("keydown", onEsc); }
      function close() { pop.hidden = true; btn.classList.remove("is-open"); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); }
      btn.addEventListener("click", function () { pop.hidden ? open() : close(); });
      wrap.appendChild(btn); wrap.appendChild(pop);
      paintBtn();
      Object.defineProperty(wrap, "value", { get: function () { return val; }, set: function (v) { val = v || ""; paintBtn(); } });
      return wrap;
    }
    window.__buildFontPicker = buildFontPicker; // headless test hook

    kernel.expose({
      fontFormatFor: fontFormatFor, resolveFontDataUrl: resolveFontDataUrl, registerDocFontNames: registerDocFontNames,
      applyDocFonts: applyDocFonts, fetchAndEmbedGoogleFont: fetchAndEmbedGoogleFont, buildFontsBody: buildFontsBody,
      isEmbeddableFont: isEmbeddableFont, buildFontPicker: buildFontPicker
    });
  }

  window.VersoFonts = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoFonts;
})();
