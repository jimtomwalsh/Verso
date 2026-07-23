/*
 * Component registry — the heart of M3.
 *
 * A COMPONENT is defined ONCE here: its bindable slots, its style-swap variants,
 * and a render(instance, ctx) that builds its DOM. INSTANCES live in the document
 * (model.js) and only carry data: per-instance slot values plus overrides. This
 * is the master/instance model — one master definition, many instances, each overridable
 * WITHOUT detaching:
 *
 *   - content override   -> instance.slots[key]        (edited text)
 *   - visibility override -> instance.hidden           (toggle off, reversible)
 *   - style-swap override -> instance.status (variant) (complete <-> incomplete)
 *
 * Structural edits (changing what layers exist) require DETACHING — that UI lands
 * with the structural-editing capability; for now detach is a modelled data flag
 * (instance.detached) so the concept and its isolation exist and are testable.
 *
 * The definition is code and the instance is data on purpose: it matches how
 * James already works (build a good component once, then reuse it by swapping
 * text/status), and keeps render() a pure function. A page/master-slide is the
 * same mechanism at a larger scale — a component whose slots are whole sections;
 * that unification is wired in as multi-page navigation lands (M4).
 *
 * ctx (supplied by render.js) exposes:
 *   ctx.el(tag, className, text)         -> plain element
 *   ctx.slot(tag, className, instance, key) -> editable element bound to instance.slots[key]
 *
 * Classic script — exposes window.COMPONENTS.
 */
(function () {
  "use strict";

  window.COMPONENTS = {
    "chapter-card": {
      name: "Chapter Card",
      // bindable content slots (order defines the properties-panel field order)
      slots: [
        { key: "number", label: "Number" },
        { key: "title", label: "Title" },
        { key: "objective", label: "Objective", multiline: true }
      ],
      // style-swap dimension: which class the card carries for its status variant.
      // The actual colours are theme tokens (course.css .is-complete / .is-incomplete),
      // so the swap is token-driven, not hardcoded.
      variants: {
        status: {
          default: "incomplete",
          options: ["incomplete", "complete"]
        }
      },
      render: function (instance, ctx) {
        var status = instance.status || this.variants.status.default;
        var card = ctx.el("article", "chapter-card");
        card.classList.add(status === "complete" ? "is-complete" : "is-incomplete");
        card.appendChild(ctx.slot("div", "chapter-card__num", instance, "number"));
        card.appendChild(ctx.slot("h2", "chapter-card__title", instance, "title"));
        card.appendChild(ctx.el("div", "chapter-card__rule"));
        card.appendChild(ctx.slot("p", "chapter-card__obj", instance, "objective"));
        return card;
      }
    }
  };
})();
