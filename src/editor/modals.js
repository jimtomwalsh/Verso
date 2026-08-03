// editor/modals.js -- the canonical dialog (arch-P3b-07c).
//
// Every editor dialog composes from these, which is the whole point: a composed head (title plus a
// one-line sub), aligned label-to-control rows, and an action bar with the primary on the right.
// Build one by hand and it will not match the others, and the mismatch is exactly the piecemeal
// divergence `design-system/readme.md` exists to stop.
//
// promptModal and confirmModal sit on top as the two shapes worth having a shortcut for: ask for
// one value, and confirm a destructive thing. The spine allows a modal ONLY for a destructive
// confirm or a blocking run -- settings never live in one -- so these two are the sanctioned uses
// and the rest of the file is what a genuine dialog is built from.
//
// Like every dismissable surface it pushes and pops the overlay LAYER STACK rather than binding
// its own Escape and racing the others.
//
// FOUR names from editor.js, and eighty-eight call sites across the chrome read the eight it
// exposes. The banner it came from claimed 453 lines; the builders are 101, and the field
// inspector, the instance inspector and the block-reselect helpers that shared that banner are
// separate concerns that stayed.
//
// Editor chrome only.
(function () {
  "use strict";
  var window = (typeof globalThis !== "undefined" && globalThis.window) || Object.create(null);

  function install(kernel) {
    var E = kernel.need(
      "h", "panelSection", "popLayer", "pushLayer"
    );
    // The stable half: declarations editor.js never reassigns, aliased once so the moved body
    // reads exactly as it did. Anything LIVE is deliberately absent and read through E.
    var h = E.h,
        panelSection = E.panelSection,
        popLayer = E.popLayer,
        pushLayer = E.pushLayer;

    // ---- shared modal builders (the canonical .modal-* dialog pattern) -------
    // Every editor dialog composes from THESE so menus/dialogs match each other and
    // the export modal: composed head (title + one-line sub), aligned label->control
    // rows, sentence-case section headers, and a right-aligned solid-primary /
    // quiet ghost-cancel action bar.
    function modalHead(box, title, subtitle) {
      var head = h("div", "modal-head");
      head.appendChild(h("h3", null, title));
      if (subtitle) head.appendChild(h("p", "modal-sub", subtitle));
      box.appendChild(head);
      return head;
    }
    // A modal groups its rows with the same section as every other surface (OVL-07). Returns the
    // body so the caller's rows land inside it rather than beside it.
    function modalSection(box, title) { return panelSection(box, title); }
    // one aligned label -> control row; returns the row so the caller appends a control
    function modalField(box, labelText) {
      var r = h("div", "modal-field");
      r.appendChild(h("span", "modal-field__label", labelText));
      box.appendChild(r);
      return r;
    }
    // text input inside a modal-field; returns the input element
    function modalText(box, labelText, value, placeholder) {
      var r = modalField(box, labelText);
      var i = h("input", "prop-text modal-field__control"); i.type = "text"; i.spellcheck = false;
      i.placeholder = placeholder || ""; i.value = value == null ? "" : value;
      r.appendChild(i);
      return i;
    }
    // right-aligned action bar: quiet ghost cancel + solid primary, with any quiet
    // extra buttons placed left of cancel. Returns the primary button.
    function modalActions(box, modal, primaryLabel, onPrimary, extras) {
      var actions = h("div", "modal-actions");
      (extras || []).forEach(function (b) { actions.appendChild(b); });
      var cancel = h("button", "prop-btn prop-btn--danger", "Cancel");
      cancel.addEventListener("click", function () { modal.remove(); });
      actions.appendChild(cancel);
      var primary = h("button", "prop-btn prop-btn--accent", primaryLabel);
      primary.addEventListener("click", onPrimary);
      actions.appendChild(primary);
      box.appendChild(actions);
      return primary;
    }
    // DS-canonical dialog shell (issue #19) — the whole in-scope modal family (prompt,
    // confirm, new-doc here + the SCORM export dialog in export.js) routes through the
    // vendored VersoUI.Modal (design-system/components/overlays/Modal) so every dialog
    // shares ONE style: a composed head (title + close + optional one-line sub), a body
    // filled with the existing modal-field/section builders, and a right-aligned
    // ghost-cancel + primary/danger action bar built from VersoUI.Button. Returns
    // { modal, body, primary }; modal.close() / scrim / x dismiss it.
    function dsModalShell(opts) {
      opts = opts || {};
      var body = h("div");
      var footer = [];
      (opts.extras || []).forEach(function (b) { footer.push(b); });
      var cancel = window.VersoUI.Button({ variant: "ghost", label: opts.cancelLabel || "Cancel", onClick: function () { modal.close(); } }); // spine-ok: confirm/decision modal primitive (destructive confirm + blocking run)
      footer.push(cancel);
      var primary = window.VersoUI.Button({ variant: opts.danger ? "danger" : "primary", label: opts.primaryLabel || "OK", onClick: function () { if (opts.onPrimary) opts.onPrimary(); } });
      footer.push(primary);
      var modal = window.VersoUI.Modal({ title: opts.title, description: opts.subtitle || null, width: opts.width || null, children: body, footer: footer, onClose: opts.onClose || null });
      if (opts.id) modal.id = opts.id;
      document.body.appendChild(modal);
      // uio-F05: the modal joins the ONE layer stack, so a confirm raised over the settings sheet
      // takes the next Escape and leaves the sheet standing. Enter stays on the element (it is the
      // modal's own submit, not a layer concern). `close` is wrapped once so every dismissal path
      // — Cancel, the x, the scrim, Escape — pops the layer exactly once.
      var _close = modal.close;
      modal.close = function () { popLayer("modal"); modal.close = _close; if (_close) _close.call(modal); };
      pushLayer("modal", function () { modal.close(); });
      if (opts.keys !== false) {
        modal.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); primary.click(); }
        });
      }
      return { modal: modal, body: body, primary: primary };
    }
    // Panel System v2 (D7) — consistent in-app replacements for window.prompt / window.confirm,
    // now composed on the DS modal shell (issue #19). Async (callback), Cancel = no-op, Esc
    // closes, Enter submits. onOk(value) for a prompt; onOk() for a confirm.
    function promptModal(title, label, initial, onOk, subtitle) {
      var input;
      var shell = dsModalShell({
        title: title, subtitle: subtitle || null, primaryLabel: "OK",
        onPrimary: function () { var v = input.value; shell.modal.close(); onOk(v); }
      });
      input = modalText(shell.body, label, initial == null ? "" : initial, "");
      input.focus(); if (input.select) input.select();
    }
    function confirmModal(title, message, onOk, opts) {
      opts = opts || {};
      var shell = dsModalShell({
        title: title, subtitle: message || null, danger: !!opts.danger,
        primaryLabel: opts.okLabel || "OK",
        onPrimary: function () { shell.modal.close(); onOk(); }
      });
    }
    window.__modals = { promptModal: promptModal, confirmModal: confirmModal }; // test hook

    kernel.expose({
      modalHead: modalHead, modalSection: modalSection, modalField: modalField,
      modalText: modalText, modalActions: modalActions, dsModalShell: dsModalShell,
      promptModal: promptModal, confirmModal: confirmModal
    });
  }

  window.VersoModals = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = window.VersoModals;
})();
