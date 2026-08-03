// editor/color.js -- every way an author picks a colour (arch-P3b-07).
//
// Three layers, oldest at the bottom of the file's history and newest on top:
//
//   1. The colour MATHS -- hex <-> RGB <-> HSV. Pure, and the only part of this file that was
//      already unit-tested on its own (window.__colourMath is that test hook).
//   2. colourControl -- the original swatch + hex row and the anchored HSV popover behind it,
//      still what the THEME TOKEN editors use, because those store the raw hex a token resolves
//      TO and so must not be able to reference a token.
//   3. colorField / colorFieldFlat -- the Panel System v2 control that supersedes it everywhere
//      else. One normalized value (null | {token} | {hex} | {light,dark}) behind a tabbed
//      popover, so a colour can track light/dark instead of being frozen at one hex.
//
// They ship together because they share the eyedropper, the theme swatches and the
// once-per-open history push, and splitting them would leave two files reaching into each other
// for those. Thirty-five call sites across editor.js and the hotspots editor read
// colorFieldFlat, so its three entry points cross back through the namespace.
//
// WHY THE HISTORY PUSH LOOKS ODD. A drag across the SV square fires a colour change per frame.
// Both controls push undo ONCE per interaction -- ensurePush/resetPush on the old one, the
// `pushed` latch on the new -- so an author's colour edit is a single Ctrl+Z, not two hundred.
//
// Editor chrome only: it writes colours onto the document, but nothing here renders or exports.
// window.resolveColorField is the read side and is deliberately a plain global, because
// render.js resolves a stored colour without knowing this file exists.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  // install(kernel) is called once, by editor.js, after it has provided its host surface.
  function install(kernel) {
    var E = kernel.need("h", "isHex", "activeTheme", "pushHistory", "inspector", "activeMode");
    // The stable half: function declarations editor.js never reassigns, aliased once so the
    // moved body reads exactly as it did. `inspector` and `activeMode` are NOT in this list --
    // editor.js swaps `inspector` for a section body while a panel builds, and `activeMode` is
    // the light/dark toggle, so both are read through E at the moment they are used.
    var h = E.h, isHex = E.isHex, activeTheme = E.activeTheme, pushHistory = E.pushHistory;

    // Pure colour math (HSV <-> RGB <-> hex) -- unit-testable headlessly.
    function hexToRgb(hex) {
      var m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(hex == null ? "" : hex).trim());
      if (!m) return null;
      var s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
    }
    function rgbToHex(r, g, b) {
      function p(n) { n = Math.max(0, Math.min(255, Math.round(n))).toString(16); return n.length < 2 ? "0" + n : n; }
      return "#" + p(r) + p(g) + p(b);
    }
    function rgbToHsv(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
      if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
      return { h: h, s: mx ? d / mx : 0, v: mx };
    }
    function hsvToRgb(h, s, v) {
      var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c, r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
      return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
    }
    function hsvToHex(h, s, v) { var c = hsvToRgb(h, s, v); return rgbToHex(c.r, c.g, c.b); }
    window.__colourMath = { hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb, hsvToHex: hsvToHex };

    var __colourPop = null;
    function closeColourPop() {
      if (!__colourPop) return;
      document.removeEventListener("mousedown", __colourPopDown, true);
      if (__colourPop.parentNode) __colourPop.parentNode.removeChild(__colourPop);
      __colourPop = null;
    }
    function __colourPopDown(e) {
      if (__colourPop && !__colourPop.contains(e.target) && !(e.target.classList && e.target.classList.contains("prop-swatch"))) closeColourPop();
    }
    // Anchored picker. onPick(hex|null) applies LIVE; ensure/reset gate the single
    // history push (matches colourControl's no-history-drag). syncSwatch updates the
    // row swatch + hex field as the user drags.
    // Screen colour picker: the web EyeDropper API (Chromium only) OR the native macOS
    // NSColorSampler bridged from the Verso Swift shell (webkit.messageHandlers.pickColor
    // -> window.__nativeColorResolve). So the eyedropper works in the browser AND in Verso.
    function eyeDropperAvailable() { return !!(window.EyeDropper || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pickColor)); }
    function pickScreenColor() {
      if (window.EyeDropper) return new window.EyeDropper().open().then(function (r) { return (r && r.sRGBHex) || null; });
      return new Promise(function (resolve) {
        window.__nativeColorResolve = function (hex) { window.__nativeColorResolve = null; resolve(hex || null); };
        try { window.webkit.messageHandlers.pickColor.postMessage(""); } catch (e) { resolve(null); }
      });
    }
    function openColourPop(swatchEl, getCurrent, onPick, ensurePush, resetPush, syncSwatch) {
      closeColourPop();
      var pop = h("div", "colour-pop");
      var rgb = hexToRgb(getCurrent()) || { r: 136, g: 136, b: 136 };
      var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      var sv = h("div", "colour-pop__sv"); var svThumb = h("div", "colour-pop__thumb"); sv.appendChild(svThumb);
      var hue = h("div", "colour-pop__hue"); var hueThumb = h("div", "colour-pop__hue-thumb"); hue.appendChild(hueThumb);
      var mid = h("div", "colour-pop__mid"); mid.appendChild(sv); mid.appendChild(hue); pop.appendChild(mid);
      var row = h("div", "colour-pop__row");
      var hexIn = h("input", "colour-pop__hex"); hexIn.type = "text"; hexIn.spellcheck = false; row.appendChild(hexIn);
      if (eyeDropperAvailable()) {
        var ed = h("button", "colour-pop__btn", "◉"); ed.type = "button"; ed.title = "Pick from screen";
        ed.addEventListener("click", function () {
          pickScreenColor().then(function (hex) { if (hex) { setFromHex(hex, true); resetPush(); } }).catch(function () {});
        });
        row.appendChild(ed);
      }
      var clr = h("button", "colour-pop__btn", "Clear"); clr.type = "button"; clr.title = "Reset to default";
      clr.addEventListener("click", function () { ensurePush(); onPick(null); if (syncSwatch) syncSwatch(null); resetPush(); closeColourPop(); });
      row.appendChild(clr); pop.appendChild(row);
      var toks = h("div", "colour-pop__tokens");
      var theme = (typeof activeTheme === "function" && activeTheme()) || null;
      if (theme && theme.color) Object.keys(theme.color).forEach(function (k) {
        var val = theme.color[k]; if (!isHex(val)) return;
        var t = h("button", "colour-pop__tok"); t.type = "button"; t.title = k; t.style.background = val;
        t.addEventListener("click", function () { setFromHex(val, true); resetPush(); });
        toks.appendChild(t);
      });
      pop.appendChild(toks);
      function paint() {
        var hx = hsvToHex(hsv.h, hsv.s, hsv.v);
        sv.style.background = "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, " + hsvToHex(hsv.h, 1, 1) + ")";
        svThumb.style.left = (hsv.s * 100) + "%"; svThumb.style.top = ((1 - hsv.v) * 100) + "%"; svThumb.style.background = hx;
        hueThumb.style.top = (hsv.h / 360 * 100) + "%"; hexIn.value = hx;
        if (syncSwatch) syncSwatch(hx);
      }
      function commit() { ensurePush(); onPick(hsvToHex(hsv.h, hsv.s, hsv.v)); }
      function setFromHex(v, doCommit) { var c = hexToRgb(v); if (!c) return; var hh = rgbToHsv(c.r, c.g, c.b); hsv.h = hh.h; hsv.s = hh.s; hsv.v = hh.v; paint(); if (doCommit) commit(); }
      hexIn.addEventListener("input", function () { var v = hexIn.value.trim(); if (isHex(v)) setFromHex(v.charAt(0) === "#" ? v : "#" + v, true); });
      function drag(el, move) {
        el.addEventListener("mousedown", function (e) {
          e.preventDefault(); move(e);
          function mv(ev) { move(ev); }
          function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); resetPush(); }
          document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
        });
      }
      drag(sv, function (e) { var r = sv.getBoundingClientRect(); hsv.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); paint(); commit(); });
      drag(hue, function (e) { var r = hue.getBoundingClientRect(); hsv.h = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 360; paint(); commit(); });
      document.body.appendChild(pop);
      var ar = swatchEl.getBoundingClientRect();
      var left = Math.max(8, Math.min(ar.left, window.innerWidth - pop.offsetWidth - 8));
      var top = ar.bottom + 6; if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, ar.top - pop.offsetHeight - 6);
      pop.style.left = left + "px"; pop.style.top = top + "px";
      paint(); __colourPop = pop;
      setTimeout(function () { document.addEventListener("mousedown", __colourPopDown, true); }, 0);
    }

    // A unified colour control: native swatch + hex field, applied LIVE (no panel
    // rebuild, so selection is kept). onPick(value) on edit, onPick(null) when the
    // field is cleared (revert to default). Used for fill / text / stroke colours.
    // target defaults to the global inspector; pass a disclosure body for the
    // headerFooter/theme sections. noHistory skips pushHistory for state that lives
    // outside doc (canvas bg, theme tokens) and so is not on the undo stack.
    function colourControl(labelText, current, onPick, target, noHistory) {
      var host = target || E.inspector;
      if (labelText) host.appendChild(h("div", "insp-row__label insp-row__label--stacked", labelText)); // omit an empty label so a swatch can sit on one line under its section header
      var crow = h("div", "prop-color-row");
      var sw = h("button", "prop-swatch"); sw.type = "button"; sw.title = "Open colour picker";
      function paintSwatch(v) { sw.style.background = isHex(v) ? v : ""; sw.classList.toggle("prop-swatch--empty", !isHex(v)); }
      paintSwatch(current);
      var hex = h("input", "prop-hex"); hex.type = "text"; hex.spellcheck = false; hex.value = current == null ? "" : String(current); hex.placeholder = "default";
      var pushed = false;
      function ensurePush() { if (noHistory) return; if (!pushed) { pushHistory(); pushed = true; } }
      function resetPush() { pushed = false; }
      function syncSwatch(v) { paintSwatch(v); hex.value = v == null ? "" : v; }
      sw.addEventListener("click", function () { openColourPop(sw, function () { return isHex(hex.value.trim()) ? hex.value.trim() : (isHex(current) ? current : "#888888"); }, onPick, ensurePush, resetPush, syncSwatch); });
      hex.addEventListener("input", function () { ensurePush(); var v = hex.value.trim(); if (!v) { paintSwatch(null); onPick(null); return; } if (isHex(v)) paintSwatch(v); onPick(v); });
      hex.addEventListener("blur", resetPush);
      crow.appendChild(sw); crow.appendChild(hex); host.appendChild(crow);
    }

    // Panel System v2 (D5) — the ONE unified colour control. Value is normalized:
    // null | {token:"accent"} | {hex:"#.."} | {light:"#..",dark:"#.."}
    // A swatch (resolved for the current preview mode) opens a tabbed popover:
    // Token (theme swatches, shown FIRST — the nudged mode-aware path) · Custom (native pick +
    // hex + eyedropper + recents) · Per-mode (light + dark). Reused at every colour site;
    // supersedes colourControl / colorToken / per-mode fills. resolveColorField(v,mode) -> CSS.
    var COLOR_FIELD_TOKENS = [["Ink", "ink"], ["Ink soft", "ink-soft"], ["Muted", "muted"], ["Accent", "accent"], ["Success", "success"], ["Danger", "danger"], ["Surface", "surface"], ["Background", "bg"]];
    function normColorField(v) {
      if (v == null || v === "") return null;
      if (typeof v === "string") return isHex(v) ? { hex: v } : null; // legacy flat hex
      if (v.token) return { token: v.token };
      if (v.light || v.dark) return { light: v.light || v.dark, dark: v.dark || v.light };
      if (v.hex) return { hex: v.hex };
      return null;
    }
    window.resolveColorField = function (v, mode) {
      v = normColorField(v); if (!v) return "";
      if (v.token) return "var(--color-" + v.token + ")";
      if (v.light || v.dark) return (mode === "dark" ? v.dark : v.light) || v.light || v.dark;
      return v.hex || "";
    };
    function kebabColorKey(k) { return String(k).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }
    function tokenHex(token) {
      var t = (typeof activeTheme === "function" && activeTheme()) || null; if (!t || !t.color) return "#888888";
      var keys = Object.keys(t.color);
      for (var i = 0; i < keys.length; i++) { if (kebabColorKey(keys[i]) === token) return t.color[keys[i]]; }
      return "#888888";
    }
    function colorRecents(add) {
      var KEY = "verso.colorRecents", arr = [];
      try { arr = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) {}
      if (add && isHex(add)) { arr = [add].concat(arr.filter(function (x) { return x !== add; })).slice(0, 8); try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {} }
      return arr;
    }
    function colorField(labelText, value, onPick, target, opts) {
      opts = opts || {};
      var host = target || E.inspector;
      if (labelText) host.appendChild(h("div", "insp-row__label insp-row__label--stacked", labelText));
      var wrap = h("div", "color-field");
      var sw = h("button", "color-field__swatch"); sw.type = "button"; sw.title = "Colour";
      var lbl = h("span", "color-field__val");
      var val = normColorField(value);
      function curMode() { var m = E.activeMode; return (typeof m !== "undefined") ? m : "dark"; }
      function summary(v) {
        if (!v) return "Default";
        if (v.token) { var m = COLOR_FIELD_TOKENS.filter(function (t) { return t[1] === v.token; })[0]; return m ? m[0] : v.token; }
        if (v.light || v.dark) return "Per-mode";
        return v.hex;
      }
      function paint() {
        // Resolve to a real HEX for the swatch — the inspector chrome has no --color-* vars,
        // so painting `var(--color-accent)` would render gray. tokenHex gives the live colour.
        var bg = "";
        if (val) {
          if (val.token) bg = tokenHex(val.token);
          else if (val.light || val.dark) bg = (curMode() === "dark" ? val.dark : val.light) || val.light || val.dark;
          else bg = val.hex || "";
        }
        sw.style.background = bg;
        sw.classList.toggle("color-field__swatch--empty", !val);
        lbl.textContent = summary(val);
      }
      function set(v) { val = normColorField(v); paint(); onPick(val); }
      sw.addEventListener("click", function () { openColorFieldPop(sw, val, set, opts); });
      wrap.appendChild(sw); wrap.appendChild(lbl); host.appendChild(wrap);
      paint();
      return wrap;
    }
    // Flat adapter (Phase 3) — a drop-in for colourControl at every ELEMENT colour site (fills,
    // borders, cover, texture…). Reads/writes a CSS STRING the render sets directly, so a TOKEN
    // becomes `var(--color-x)` (tracks light/dark) and a custom stays hex. No per-mode tab (a
    // flat single-value consumer can't switch modes; token already gives mode-awareness).
    // NOT for theme-token editors (those store the raw hex the tokens resolve TO).
    function colorFieldFlat(labelText, cssVal, onPick, target, fopts) {
      var norm = null;
      if (typeof cssVal === "string") { var m = /^var\(--color-(.+)\)$/.exec(cssVal.trim()); if (m) norm = { token: m[1] }; else if (isHex(cssVal)) norm = { hex: cssVal }; }
      var o = { noPerMode: true }; if (fopts && fopts.noHistory) o.noHistory = true; // theme sites: no doc-undo entry
      return colorField(labelText, norm, function (v) {
        if (!v) return onPick(null);
        if (v.token) return onPick("var(--color-" + v.token + ")");
        if (v.hex) return onPick(v.hex);
        if (v.light || v.dark) return onPick(v.dark || v.light); // per-mode omitted here; belt-and-braces
      }, target, o);
    }
    var _colorFieldPop = null;
    function closeColorFieldPop() { if (_colorFieldPop && _colorFieldPop.parentNode) _colorFieldPop.parentNode.removeChild(_colorFieldPop); _colorFieldPop = null; document.removeEventListener("mousedown", _cfOutside, true); document.removeEventListener("keydown", _cfEsc); }
    function _cfOutside(e) { if (_colorFieldPop && !_colorFieldPop.contains(e.target) && !(e.target.classList && e.target.classList.contains("color-field__swatch"))) closeColorFieldPop(); }
    function _cfEsc(e) { if (e.key === "Escape") closeColorFieldPop(); }
    function openColorFieldPop(anchor, value, onPick, opts) {
      opts = opts || {};
      closeColorFieldPop();
      var pop = h("div", "color-field-pop"); _colorFieldPop = pop;
      var tabs = h("div", "color-field-pop__tabs");
      var panes = h("div", "color-field-pop__panes");
      var val = normColorField(value);
      // Push undo history ONCE per open (mirrors colourControl's ensurePush) so a colour edit
      // is one undo step, not one per keystroke.
      var pushed = false;
      function doPick(v) { if (!pushed) { if (!opts.noHistory) { try { pushHistory(); } catch (e) {} } pushed = true; } onPick(v); }
      var TABS = opts.noPerMode ? [["Token", "token"], ["Custom", "custom"]] : [["Token", "token"], ["Custom", "custom"], ["Per-mode", "per"]];
      var active = val && val.hex ? "custom" : (val && (val.light || val.dark)) ? "per" : "token";
      function showTab(id) {
        active = id;
        Array.prototype.forEach.call(tabs.children, function (b) { b.classList.toggle("is-on", b.getAttribute("data-tab") === id); });
        panes.innerHTML = "";
        if (id === "token") panes.appendChild(tokenPane());
        else if (id === "custom") panes.appendChild(customPane());
        else panes.appendChild(perPane());
      }
      TABS.forEach(function (t) { var b = h("button", "color-field-pop__tab", t[0]); b.type = "button"; b.setAttribute("data-tab", t[1]); b.addEventListener("click", function () { showTab(t[1]); }); tabs.appendChild(b); });
      function tokenPane() {
        var g = h("div", "color-field-pop__tokens");
        COLOR_FIELD_TOKENS.forEach(function (t) {
          var b = h("button", "color-field-pop__tok"); b.type = "button"; b.title = t[0]; b.style.background = tokenHex(t[1]);
          if (val && val.token === t[1]) b.classList.add("is-on");
          b.addEventListener("click", function () { doPick({ token: t[1] }); closeColorFieldPop(); });
          g.appendChild(b);
        });
        return g;
      }
      function hexPickerRow(initial, cb) {
        var row = h("div", "color-field-pop__row");
        var native = h("input", "color-field-pop__native"); native.type = "color"; native.value = isHex(initial) ? initial : "#888888";
        var hex = h("input", "color-field-pop__hex"); hex.type = "text"; hex.spellcheck = false; hex.value = isHex(initial) ? initial : "";
        native.addEventListener("input", function () { hex.value = native.value; cb(native.value); });
        hex.addEventListener("input", function () { var v = hex.value.trim(); if (v && v.charAt(0) !== "#") v = "#" + v; if (isHex(v)) { native.value = v; cb(v); } });
        row.appendChild(native); row.appendChild(hex);
        if (eyeDropperAvailable()) { var ed = h("button", "color-field-pop__btn", "◉"); ed.type = "button"; ed.title = "Pick from screen"; ed.addEventListener("click", function () { pickScreenColor().then(function (hx) { if (hx) { native.value = hx; hex.value = hx; cb(hx); } }).catch(function () {}); }); row.appendChild(ed); }
        return row;
      }
      function customPane() {
        var pane = h("div", null);
        pane.appendChild(hexPickerRow(val && val.hex, function (hx) { doPick({ hex: hx }); colorRecents(hx); }));
        var rec = colorRecents();
        if (rec.length) { var r = h("div", "color-field-pop__recents"); rec.forEach(function (hx) { var b = h("button", "color-field-pop__tok"); b.type = "button"; b.title = hx; b.style.background = hx; b.addEventListener("click", function () { doPick({ hex: hx }); closeColorFieldPop(); }); r.appendChild(b); }); pane.appendChild(r); }
        return pane;
      }
      function perPane() {
        var pane = h("div", null);
        var lightV = (val && val.light) || "#ffffff", darkV = (val && val.dark) || "#000000";
        pane.appendChild(h("div", "color-field-pop__sub", "Light mode"));
        pane.appendChild(hexPickerRow(lightV, function (hx) { lightV = hx; doPick({ light: lightV, dark: darkV }); }));
        pane.appendChild(h("div", "color-field-pop__sub", "Dark mode"));
        pane.appendChild(hexPickerRow(darkV, function (hx) { darkV = hx; doPick({ light: lightV, dark: darkV }); }));
        return pane;
      }
      var clear = h("button", "color-field-pop__clear", "Clear"); clear.type = "button";
      clear.addEventListener("click", function () { doPick(null); closeColorFieldPop(); });
      pop.appendChild(tabs); pop.appendChild(panes); pop.appendChild(clear);
      document.body.appendChild(pop);
      var r = anchor.getBoundingClientRect();
      pop.style.left = Math.min(r.left, window.innerWidth - 260) + "px";
      pop.style.top = (r.bottom + 6) + "px";
      showTab(active);
      setTimeout(function () { document.addEventListener("mousedown", _cfOutside, true); document.addEventListener("keydown", _cfEsc); }, 0);
    }
    window.__colorField = { colorField: colorField, colorFieldFlat: colorFieldFlat, normColorField: normColorField, resolveColorField: window.resolveColorField, recents: colorRecents }; // test hook

    // What editor.js still calls. Everything else above -- the maths, both popovers, the token
    // and recents helpers -- has no caller outside this file and stays private.
    kernel.expose({
      colourControl: colourControl,
      colorField: colorField,
      colorFieldFlat: colorFieldFlat
    });
  }

  window.VersoColor = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoColor;
})();
