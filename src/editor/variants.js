// editor/variants.js -- the two axes a course varies along (arch-P3b-07l).
//
// A Verso course has one document and two ways to say "this bit differs here": a VARIANT (audience,
// product tier, region) and a VERSION (the software release the course describes). Both work the
// same way and neither copies the document. A variant or version holds OVERRIDES against the base,
// so the flagship copy stays the single source and an override is a delta on top of it.
//
// Three things live here, and they are one idea seen at three depths:
//
//   the MODEL -- read an overridden field, write one, prune an override back to inherited. Writing
//   an empty string deletes the override rather than storing a blank, which is what makes "leave it
//   blank to inherit" true rather than a convention.
//
//   the PANEL -- every vary-able field of the selection as a live textarea, typed straight into the
//   override with no prompt and no Save. The textarea grows against a hidden mirror div so it never
//   touches the value, the selection or the caret while the author is typing in it.
//
//   the SWITCHERS -- the two toolbar glyphs that put the canvas into a variant or a version, the
//   badges that say so, and the chip that returns to base. Previewing is not editing: a version is
//   read-only unless the author is editing that version's text, and the badge says which it is.
//
// activeVariant and activeVersion stay in editor.js, because the canvas, the outliner, the export
// and the publish rail all read them. This file reads them through E and writes them through the
// two setters, so a switch still goes through one place.
//
// Find & replace kept the variant override path but is the copy editor's data layer, so it moved
// with the Read view instead of here.
//
// Editor chrome only: it decides what render() is handed, and never renders.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "mount", "pushHistory", "promptModal", "flushSave", "canvas",
      "variantNames", "showContextMenu", "versionNames", "resolveComponentDef", "renderModelView", "panelSection",
      "stripToText", "isPreview", "canvasEditable", "versionEditable", "doc", "activeVersion",
      "activeVariant", "selection", "inspector"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is absent on purpose and read through E.
    var h = E.h,
        mount = E.mount,
        pushHistory = E.pushHistory,
        promptModal = E.promptModal,
        flushSave = E.flushSave,
        canvas = E.canvas,
        variantNames = E.variantNames,
        showContextMenu = E.showContextMenu,
        versionNames = E.versionNames,
        resolveComponentDef = E.resolveComponentDef,
        renderModelView = E.renderModelView,
        panelSection = E.panelSection,
        stripToText = E.stripToText,
        isPreview = E.isPreview,
        canvasEditable = E.canvasEditable,
        versionEditable = E.versionEditable;

    // ---- variant model mutations ----
    function newVariantPrompt(then) {
      promptModal("New variant", "Variant name (e.g. Wideband, Standard, Lite)", "", function (v) {
        var name = (v || "").trim();
        if (!name) return;
        if (!E.doc.variants) E.doc.variants = [];
        if (E.doc.variants.indexOf(name) === -1) { pushHistory(); E.doc.variants.push(name); }
        renderVariantSwitch();
        if (then) then(name);
      });
    }
    // The set of vary-able FIELDS for a right-click. Prefer the exact text the user
    // clicked (fieldNode); else every slot of a card; else a plain block's `text`.
    // A field = { key, label, isSlot }. This is the fix for the "wrong slot / looks
    // mirrored" bug — we no longer guess a single "primary" slot (which was `number`).
    function slotLabel(target, key) {
      var comp = target.block && target.block.component;
      var def = comp && resolveComponentDef(comp); // incl. shared library
      if (def && def.slots) { for (var i = 0; i < def.slots.length; i++) if (def.slots[i].key === key) return def.slots[i].label || key; }
      return key;
    }
    function fieldsFor(target, fieldNode) {
      var out = [];
      if (fieldNode) {
        var k = fieldNode.getAttribute("data-edit");
        var inSlot = !!(target.instance && fieldNode.closest("[data-instance]"));
        out.push({ key: k, label: inSlot ? slotLabel(target, k) : k, isSlot: inSlot });
        return out;
      }
      if (target.instance) {
        Object.keys(target.instance.slots || {}).forEach(function (k) { out.push({ key: k, label: slotLabel(target, k), isSlot: true }); });
        return out;
      }
      if (target.block && typeof target.block.text === "string") out.push({ key: "text", label: "text", isSlot: false });
      return out;
    }
    function baseFieldValue(host, field) {
      if (field.isSlot) return (host.slots && host.slots[field.key] != null) ? host.slots[field.key] : "";
      return host[field.key] != null ? host[field.key] : "";
    }
    function ovFieldValue(host, variant, field) {
      var o = host.overrides && host.overrides[variant];
      if (field.isSlot) { if (o && o.slots && o.slots[field.key] != null) return o.slots[field.key]; }
      else if (o && o[field.key] != null) return o[field.key];
      return baseFieldValue(host, field);
    }
    function isFieldOverridden(host, variant, field) {
      return !!(host.overrides && host.overrides[variant] && ovFieldValue(host, variant, field) !== baseFieldValue(host, field));
    }
    function setVariantCopyField(host, field, variant) {
      promptModal("Variant copy", "“" + variant + "” · " + field.label, ovFieldValue(host, variant, field), function (next) {
        pushHistory();
        host.overrides = host.overrides || {};
        var o = host.overrides[variant] || (host.overrides[variant] = {});
        if (next.trim() === "") {
          if (field.isSlot) { if (o.slots) delete o.slots[field.key]; } else delete o[field.key];
        } else {
          if (field.isSlot) { o.slots = o.slots || {}; o.slots[field.key] = next; } else o[field.key] = next;
        }
        // prune empties so an inherited field carries no override object
        if (o.slots && !Object.keys(o.slots).length) delete o.slots;
        if (!Object.keys(o).length) delete host.overrides[variant];
        if (host.overrides && !Object.keys(host.overrides).length) delete host.overrides;
        mount();
      }, "Leave blank to inherit the flagship.");
    }
    // ---- variant editing in the PROPERTY PANEL (live, no prompt) --------------
    function slotLabelC(block, key) {
      var comp = block && block.component;
      var docComps = window.Editor && window.Editor.getDoc && window.Editor.getDoc().components;
      var def = comp && ((docComps && docComps[comp]) || (window.COMPONENTS || {})[comp]);
      if (def && def.slots) for (var i = 0; i < def.slots.length; i++) if (def.slots[i].key === key) return def.slots[i].label || key;
      return key;
    }
    // the host (base block/instance) + its vary-able fields for the current selection
    function variantTargetForSelection() {
      if (E.selection.type === "instance" && E.selection.instance) {
        var inst = E.selection.instance;
        return { host: inst, fields: Object.keys(inst.slots || {}).map(function (k) { return { key: k, label: slotLabelC(E.selection.block, k), isSlot: true }; }) };
      }
      var b = E.selection.block;
      if (b && b.type && typeof b.text === "string" && (E.selection.type === "field" || E.selection.type === "navButton" || E.selection.type === "block")) {
        return { host: b, fields: [{ key: "text", label: "Text", isSlot: false }] };
      }
      return null;
    }
    function ovRaw(host, variant, field) {
      var o = host.overrides && host.overrides[variant];
      if (!o) return "";
      if (field.isSlot) return (o.slots && o.slots[field.key] != null) ? o.slots[field.key] : "";
      return o[field.key] != null ? o[field.key] : "";
    }
    function writeVariantField(host, variant, field, value) {
      host.overrides = host.overrides || {};
      var o = host.overrides[variant] || (host.overrides[variant] = {});
      if (value === "" || value == null) {
        if (field.isSlot) { if (o.slots) delete o.slots[field.key]; } else delete o[field.key];
      } else {
        if (field.isSlot) { o.slots = o.slots || {}; o.slots[field.key] = value; } else o[field.key] = value;
      }
      if (o.slots && !Object.keys(o.slots).length) delete o.slots;
      if (!Object.keys(o).length) delete host.overrides[variant];
      if (host.overrides && !Object.keys(host.overrides).length) delete host.overrides;
      renderModelView();
    }

    // Size a variant-text textarea to its content (the override value, or the flagship
    // placeholder when the field is empty) so the box scales with the block's copy. Uses
    // a hidden MIRROR div for the measurement — it never touches ta.value/selection/focus,
    // so it can't interfere with typing or highlighting in the live field. Capped at
    // 320px; past that the textarea scrolls (overflow-y:auto in .prop-input--grow).
    function autoGrowVariant(ta) {
      var w = ta.clientWidth;
      if (!w) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 320) + "px"; return; } // not laid out yet
      var m = autoGrowVariant._mirror || (autoGrowVariant._mirror = document.createElement("div"));
      var cs = getComputedStyle(ta), s = m.style;
      s.position = "absolute"; s.visibility = "hidden"; s.left = "-9999px"; s.top = "0";
      s.whiteSpace = "pre-wrap"; s.wordWrap = "break-word"; s.boxSizing = "border-box";
      s.width = w + "px"; s.font = cs.font; s.lineHeight = cs.lineHeight;
      s.paddingTop = cs.paddingTop; s.paddingBottom = cs.paddingBottom;
      s.paddingLeft = cs.paddingLeft; s.paddingRight = cs.paddingRight;
      s.borderTopWidth = cs.borderTopWidth; s.borderBottomWidth = cs.borderBottomWidth;
      m.textContent = (ta.value || ta.placeholder || "") + "\n"; // trailing newline reserves the caret row
      if (!m.parentNode) document.body.appendChild(m);
      ta.style.height = Math.min(Math.max(m.scrollHeight, 32), 320) + "px";
    }
    function renderVariantOverrides() {
      var vs = variantNames();
      if (!vs.length) return;
      var t = variantTargetForSelection();
      if (!t) return;
      var _varRoot = E.inspector;
      E.setInspector(panelSection(_varRoot, "Variant text"));
      if (E.activeVariant) {
        E.inspector.appendChild(h("div", "insp-hint", "Previewing “" + E.activeVariant + "”. Switch to Flagship (top bar) to edit variant text."));
        E.setInspector(_varRoot);
        return;
      }
      E.inspector.appendChild(h("div", "insp-hint", "An alternate for a variant. Blank = inherit the flagship."));
      vs.forEach(function (v) {
        E.inspector.appendChild(h("div", "insp-row__label insp-row__label--stacked", v));
        t.fields.forEach(function (f) {
          var row = h("div", "insp-row");
          row.appendChild(h("span", "insp-row__label", f.label));
          // Text-bearing fields (a block's `text`, or a long content slot) get an
          // auto-growing textarea so the box scales with the block's copy; short slots
          // (title/number) stay single-line.
          var multiline = !f.isSlot || /obj|desc|body|summary|para|text/i.test(f.key);
          var input = multiline ? h("textarea", "prop-input prop-input--grow") : h("input", "prop-text");
          if (!multiline) input.type = "text";
          input.spellcheck = false;
          input.setAttribute("data-variant-field", v + ":" + f.key);
          input.value = ovRaw(t.host, v, f);
          // Placeholder = the flagship copy as a hint, tags stripped (rich text stores
          // <div>…</div>; showing raw markup here read as "must I type HTML?" — no).
          input.placeholder = stripToText(baseFieldValue(t.host, f));
          var pushed = false;
          input.addEventListener("focus", function () { pushed = false; });
          input.addEventListener("input", function () { if (!pushed) { pushHistory(); pushed = true; } writeVariantField(t.host, v, f, input.value); if (multiline) autoGrowVariant(input); });
          row.appendChild(input);
          E.inspector.appendChild(row);
          if (multiline) requestAnimationFrame(function () { autoGrowVariant(input); }); // size to content once in the DOM
        });
      });
      E.setInspector(_varRoot);
    }

    // ---- toolbar variant switcher ----
    var variantSwitchEl = null;
    var variantWrapEl = null;
    // #80 — condensed to a glyph-only trigger (was a labelled VersoUI.Select pill).
    // The dropdown lives BEHIND the "layers" glyph: click opens a context menu of
    // variants (active one marked). Reclaims fixed pixels from the crowded right
    // group (the #79 overflow mitigation) while matching the sibling .tool aesthetic.
    // Selection/override behaviour is unchanged — this is a control swap, not a re-wire.
    function onVariantPick(v) {
      if (v === "__new__") { newVariantPrompt(function (name) { E.setActiveVariant(name); syncVariantSwitch(); mount(); }); syncVariantSwitch(); return; }
      E.setActiveVariant(v || null); mount();
    }
    function openVariantMenu(anchor) {
      var items = [{ head: "Variant" }];
      items.push({ label: "Flagship", active: !E.activeVariant, onClick: function () { onVariantPick(""); } });
      variantNames().forEach(function (v) { items.push({ label: v, active: E.activeVariant === v, onClick: function () { onVariantPick(v); } }); });
      items.push({ sep: true });
      items.push({ label: "New variant…", onClick: function () { onVariantPick("__new__"); } });
      var r = anchor.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 6, items);
    }
    // The route in from elsewhere in the chrome. The trigger element is this file's own state, so
    // the caller asks for the menu rather than holding the element and handing it back.
    function openVariantMenuAtSwitch() { if (variantSwitchEl) openVariantMenu(variantSwitchEl); }
    // SPEC 7: the variant (outer axis) + version (inner axis) glyphs live at the left of the
    // editor-window toolbar row (#editor-doc-axes). Fall back to the global bar's right group
    // if the editor header isn't present (defensive; the header is static in index.html).
    function axisSwitchHost() {
      return document.getElementById("editor-doc-axes") || document.querySelector(".toolbar__group--right");
    }
    // edit-header-ia-v2: face-up NAMED dropdown (was a glyph-only trigger). Shows the active
    // variant name ("Flagship" = base) at a glance; the name truncates with ellipsis (full name
    // in the menu + title tooltip). Same click -> openVariantMenu; a control re-shape, not a re-wire.
    function renderVariantSwitch() {
      var host = axisSwitchHost();
      if (!host) return;
      var Ic = window.Icon;
      if (!variantWrapEl) {
        variantWrapEl = h("button", "tool editor-window__axis-btn variant-glyph"); variantWrapEl.type = "button";
        // uio-E-C04 (EDIT-08): the axis is NAMED in the bar (a muted "Variant" caption) so the two
        // dropdowns aren't unlabelled twins; the value + caret follow.
        variantWrapEl.innerHTML =
          '<span class="axis-btn__axis">Variant</span>' +
          '<span class="axis-btn__label"></span>' +
          '<span class="axis-btn__caret">' + (Ic ? Ic("chevron-down") : "") + '</span>';
        variantWrapEl.addEventListener("click", function () { openVariantMenu(variantWrapEl); });
        host.insertBefore(variantWrapEl, host.firstChild);
      }
      variantSwitchEl = variantWrapEl;
      syncVariantSwitch();
    }
    function syncVariantSwitch() {
      if (!variantWrapEl) return;
      var cur = E.activeVariant || "";
      var lbl = variantWrapEl.querySelector(".axis-btn__label");
      if (lbl) lbl.textContent = cur || "Flagship";
      variantWrapEl.classList.toggle("is-active", !!cur);
      variantWrapEl.setAttribute("aria-label", "Variant");
      variantWrapEl.title = cur
        ? ("Variant: " + cur + " (previewing) — switch or return to Flagship")
        : "Variant: Flagship — preview a variant";
      syncAxisReturnChip();
    }
    // uio-E-C04 (EDIT-08): surface the off-base state in the BAR (not only a canvas badge). A chip
    // appears the moment either axis leaves base; its wording tracks the real mode -- "Read-only"
    // when the canvas is locked (variant preview, or a version preview while collaborating), or
    // "Editing <version>" for the editable dynamic-flagship case (#207). One click returns to base.
    var axisReturnChipEl = null;
    function returnToBase() {
      flushSave(); // commit any in-flight edit before dropping the active version/variant
      E.setActiveVariant(null); E.setActiveVersion(null);
      syncVariantSwitch(); syncVersionSwitch();
      mount();
    }
    function syncAxisReturnChip() {
      var host = axisSwitchHost();
      if (!host) return;
      var off = isPreview();
      if (!off) { if (axisReturnChipEl) { axisReturnChipEl.remove(); axisReturnChipEl = null; } return; }
      if (!axisReturnChipEl) {
        axisReturnChipEl = h("span", "axis-return-chip");
        var txt = h("span", "axis-return-chip__label");
        var btn = h("button", "axis-return-chip__btn", "Return to base"); btn.type = "button";
        btn.addEventListener("click", returnToBase);
        axisReturnChipEl.appendChild(txt); axisReturnChipEl.appendChild(btn);
        host.appendChild(axisReturnChipEl); // after the two axis buttons
      }
      var locked = !canvasEditable();
      axisReturnChipEl.classList.toggle("axis-return-chip--locked", locked);
      var label = axisReturnChipEl.querySelector(".axis-return-chip__label");
      if (locked) { label.textContent = "Read-only"; axisReturnChipEl.title = "Previewing off base — the canvas is read-only. Return to base to edit."; }
      else { label.textContent = "Editing " + (E.activeVersion || "version"); axisReturnChipEl.title = "Editing a software version off base. Return to base to edit the base document."; }
    }
    function previewVariant(v) { E.setActiveVariant(v); syncVariantSwitch(); mount(); }
    // Floating "Previewing variant · X" badge on the canvas — makes it obvious you're
    // looking at a variant (paired with the .is-variant-preview inset ring). Re-created
    // each render (mount clears the canvas), removed on Flagship.
    function updateVariantBadge() {
      var badge = document.getElementById("variant-preview-badge");
      if (!E.activeVariant) { if (badge) badge.remove(); return; } // gate on the variant axis ONLY (a version-only preview keeps this off)
      if (!badge) { badge = h("div", "variant-preview-badge"); badge.id = "variant-preview-badge"; canvas.appendChild(badge); }
      badge.textContent = "Previewing variant · " + E.activeVariant;
    }

    // ==========================================================================
    // #206 Software-version SWITCHER — the twin of the variant switcher, for the
    // THIRD orthogonal axis. A second glyph-only
    // top-bar trigger ("history") opens a menu to add / name / preview versions.
    // Preview is READ-ONLY here (edit-in-place is #207). Base (activeVersion null)
    // is the editable anchor; newest is tagged the shipping default. The two axes
    // nest (product resolves, then version) — see currentDoc().
    // ==========================================================================
    var versionWrapEl = null;
    // add / name a version (mirrors newVariantPrompt). Newest = last-created = the moving default.
    function newVersionPrompt(then) {
      promptModal("New software version", "Version name (e.g. v1.3, v2.0, 2026.1)", "", function (v) {
        var name = (v || "").trim();
        if (!name) return;
        if (!E.doc.versions) E.doc.versions = [];
        if (E.doc.versions.indexOf(name) === -1) { pushHistory(); E.doc.versions.push(name); }
        renderVersionSwitch();
        if (then) then(name);
      });
    }
    // Rename a software version end-to-end: the doc.versions entry PLUS every per-node
    // reference to that key — versionVis only/hide arrays + versionOverrides object keys —
    // across pages, all nested blocks (children / columns / accordion+cardReveal items /
    // hotspot card blocks) and componentGrid instances. PURE (mutates the passed doc, no
    // editor state), so it is regression-guarded in tests/run.js. Returns true on a real
    // rename, false on a no-op / invalid (empty new name, unknown old, or a clash with a
    // DIFFERENT existing version). The base is doc.versions[0]; renaming it is an ordinary
    // key rename (identity stays at index 0).
    function renameVersion(d, oldName, newName) {
      newName = (newName == null ? "" : String(newName)).trim();
      if (!d || !oldName || !newName || oldName === newName) return false;
      var vs = d.versions || [];
      var oi = vs.indexOf(oldName);
      if (oi === -1 || vs.indexOf(newName) !== -1) return false;
      vs[oi] = newName;
      function fixNode(n) {
        if (!n || typeof n !== "object") return;
        var vv = n.versionVis;
        if (vv) ["only", "hide"].forEach(function (k) {
          if (Array.isArray(vv[k])) vv[k] = vv[k].map(function (x) { return x === oldName ? newName : x; });
        });
        var ov = n.versionOverrides;
        if (ov && Object.prototype.hasOwnProperty.call(ov, oldName)) { ov[newName] = ov[oldName]; delete ov[oldName]; }
      }
      function walk(nodes) {
        (nodes || []).forEach(function (b) {
          if (!b) return;
          fixNode(b);
          if (Array.isArray(b.children)) walk(b.children);
          if (Array.isArray(b.columns)) b.columns.forEach(function (col) { if (Array.isArray(col)) walk(col); });
          if (Array.isArray(b.items)) b.items.forEach(function (it) { if (it) { if (Array.isArray(it.children)) walk(it.children); if (Array.isArray(it.front)) walk(it.front); } });
          // #215: screen/marker nodes carry their own versionOverrides (entry visual) —
          // fix THEM as nodes, then recurse the card blocks. Inlined (renameVersion is
          // regex-extracted standalone by tests/run.js, so no outside helper).
          if (Array.isArray(b.screens)) b.screens.forEach(function (s) {
            if (!s) return;
            fixNode(s);
            if (Array.isArray(s.markers)) s.markers.forEach(function (m) { if (m) { fixNode(m); if (Array.isArray(m.blocks)) walk(m.blocks); } });
          });
          if (Array.isArray(b.instances)) walk(b.instances);
        });
      }
      (d.pages || []).forEach(function (p) { fixNode(p); walk(p.blocks); });
      return true;
    }
    window.__renameVersion = renameVersion; // regression-guard hook (tests/run.js)
    // Rename (or first-time NAME) a version so it can be identified. target null/"" => the
    // BASE: rename doc.versions[0], or CREATE it if the axis has no versions yet (naming the
    // base for the first time). Keeps the active view pinned to the renamed version.
    function renameVersionPrompt(target) {
      var isBase = !target;
      var cur = isBase ? ((E.doc.versions && E.doc.versions[0]) || "") : target;
      var title = isBase ? (cur ? "Rename base version" : "Name the base version") : "Rename version";
      promptModal(title, "Version name (e.g. v1.3, v2.0, 2026.1)", cur, function (v) {
        var name = (v || "").trim();
        if (!name || name === cur) return;
        if ((E.doc.versions || []).indexOf(name) !== -1) { window.alert("A version named \"" + name + "\" already exists."); return; }
        pushHistory();
        if (isBase && !cur) { E.doc.versions = E.doc.versions || []; E.doc.versions.unshift(name); } // seed the base identity
        else { renameVersion(E.doc, cur, name); if (E.activeVersion === cur) E.setActiveVersion(name); }
        renderVersionSwitch(); mount();
      });
    }
    function onVersionPick(v) {
      flushSave(); // #207 FIX 3: commit any in-flight edit before switching the active version
      if (v === "__new__") { newVersionPrompt(function (name) { E.setActiveVersion(name); syncVersionSwitch(); mount(); }); syncVersionSwitch(); return; }
      E.setActiveVersion(v || null); syncVersionSwitch(); mount();
    }
    function openVersionMenu(anchor) {
      var vs = versionNames();
      var base = vs.length ? vs[0] : null;               // identity = editable anchor
      var def = vs.length ? vs[vs.length - 1] : null;    // newest = the shipping default
      var items = [{ head: "Software version" }];
      // Base = the editable identity (doc.versions[0]); show its NAME so it is identifiable,
      // and do NOT also list it as a pickable name-row below — picking base-by-name set
      // activeVersion to the identity key, a pseudo-editable state whose overrides the pure
      // resolver ignores (editor != export). "Base (edit)" (activeVersion null) is the one path.
      items.push({ label: base ? ("Base · " + base + (base === def ? "  · default" : "")) : "Base (edit)", active: !E.activeVersion, onClick: function () { onVersionPick(""); } });
      // newest-first so the default sits at the top of the list; base is already shown above.
      vs.slice().reverse().forEach(function (v) {
        if (v === base) return;
        items.push({ label: v + (v === def ? "  · default" : ""), active: E.activeVersion === v, onClick: function () { onVersionPick(v); } });
      });
      items.push({ sep: true });
      // Name / rename the version you are on (base included) so it can be identified.
      items.push({
        label: E.activeVersion ? ("Rename “" + E.activeVersion + "”…")
             : (base ? ("Rename base “" + base + "”…") : "Name the base version…"),
        onClick: function () { renameVersionPrompt(E.activeVersion || null); }
      });
      items.push({ label: "+ New version…", onClick: function () { onVersionPick("__new__"); } });
      var r = anchor.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 6, items);
    }
    // edit-header-ia-v2: face-up NAMED dropdown twin of the variant switch. Shows the active
    // version name, or the base version's name, or "Base" when the axis has none yet.
    function renderVersionSwitch() {
      var host = axisSwitchHost();
      if (!host) return;
      var Ic = window.Icon;
      if (!versionWrapEl) {
        versionWrapEl = h("button", "tool editor-window__axis-btn version-glyph"); versionWrapEl.type = "button";
        // uio-E-C04 (EDIT-08): named axis caption ("Version") + value + caret, twin of the variant switch.
        versionWrapEl.innerHTML =
          '<span class="axis-btn__axis">Version</span>' +
          '<span class="axis-btn__label"></span>' +
          '<span class="axis-btn__caret">' + (Ic ? Ic("chevron-down") : "") + '</span>';
        versionWrapEl.addEventListener("click", function () { openVersionMenu(versionWrapEl); });
        // FIX 4a: order encodes nesting — variant (outer axis) then version (inner axis),
        // left->right. Insert AFTER the variant glyph if present, else at the group head.
        if (variantWrapEl && variantWrapEl.parentNode === host) host.insertBefore(versionWrapEl, variantWrapEl.nextSibling);
        else host.insertBefore(versionWrapEl, host.firstChild);
      }
      syncVersionSwitch();
    }
    function syncVersionSwitch() {
      if (!versionWrapEl) return;
      var cur = E.activeVersion || "";
      var vs = versionNames(); var base = vs.length ? vs[0] : "";
      var lbl = versionWrapEl.querySelector(".axis-btn__label");
      if (lbl) lbl.textContent = cur || base || "Base";
      versionWrapEl.classList.toggle("is-active", !!cur);
      versionWrapEl.setAttribute("aria-label", "Software version");
      versionWrapEl.title = cur
        ? ("Software version: " + cur + " (previewing, read-only) — switch or return to Base to edit")
        : "Software version: Base — preview a version";
      syncAxisReturnChip();
    }
    function previewVersion(v) { flushSave(); E.setActiveVersion(v); syncVersionSwitch(); mount(); } // #207 FIX 3: flush an in-flight edit before switching so nothing is lost mid-caret
    // Floating teal version badge. #207 (FIX 1): the wording signals the MODE, not just the axis —
    // "Editing version · X" (with a pencil glyph) when the version is the sole active axis (the
    // editable flagship), vs "Previewing version · X · read-only" only when composed with a variant
    // preview. Colour = axis; text + glyph = editable vs read-only. FIX 4b: offset below the purple
    // variant pill when composed so both read at once.
    function updateVersionBadge() {
      var badge = document.getElementById("version-preview-badge");
      if (!E.activeVersion) {
        // Base view: once the version axis is in use, badge WHICH version base is (its
        // doc.versions[0] name) so the current version is identifiable on-canvas, parity
        // with the "Editing version" badge below. No axis (no versions) -> no badge.
        var baseName = (E.doc.versions && E.doc.versions[0]) || null;
        if (!baseName) { if (badge) badge.remove(); return; }
        if (!badge) { badge = h("div", "version-preview-badge"); badge.id = "version-preview-badge"; canvas.appendChild(badge); }
        badge.classList.remove("is-composed"); badge.classList.add("is-editing");
        var Icb = window.Icon;
        badge.innerHTML = (Icb ? Icb("type") : "") + "<span>" + ("Editing base · " + baseName).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>";
        return;
      }
      if (!badge) { badge = h("div", "version-preview-badge"); badge.id = "version-preview-badge"; canvas.appendChild(badge); }
      var editable = versionEditable();
      badge.classList.toggle("is-composed", !!E.activeVariant);
      badge.classList.toggle("is-editing", editable);
      var Ic = window.Icon;
      var glyph = (editable && Ic) ? Ic("type") : ""; // "type" (text A-glyph) = you are editing this version's text
      var label = editable ? ("Editing version · " + E.activeVersion) : ("Previewing version · " + E.activeVersion + " · read-only");
      badge.innerHTML = glyph + "<span>" + label.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>";
    }

    kernel.expose({
      newVariantPrompt: newVariantPrompt, renderVariantOverrides: renderVariantOverrides, previewVariant: previewVariant,
      renderVariantSwitch: renderVariantSwitch, syncVariantSwitch: syncVariantSwitch, updateVariantBadge: updateVariantBadge,
      openVariantMenu: openVariantMenu, openVariantMenuAtSwitch: openVariantMenuAtSwitch, renderVersionSwitch: renderVersionSwitch,
      syncVersionSwitch: syncVersionSwitch, updateVersionBadge: updateVersionBadge
    });
  }

  window.VersoVariants = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoVariants;
})();
