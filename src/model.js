/*
 * The course document — single source of truth. Plain JSON-serialisable data.
 *
 * This is a NEUTRAL DEMO course that ships with the tool: a menu + 4 chapters
 * exercising the core block types (componentGrid chapter cards, courseNav,
 * heading/paragraph/note, a web video embed, and an HTML interaction). It holds
 * NO real/customer content — real courses are authored or imported at runtime
 * and saved to the document store; this seed is only a demo.
 *
 * Classic script — exposes window.SAMPLE_DOC.
 */
(function () {
  "use strict";

  window.SAMPLE_DOC = {
    meta: { title: "Workplace Safety Essentials", code: "DEMO-WSE-101" },
    // global headerFooter: header + footer on every page (per-page opt-out via
    // page.hideHeader / page.hideFooter)
    headerFooter: {
      header: { on: true, title: "Workplace Safety Essentials", subtitle: "Sample Orientation Course", logo: null },
      footer: {
        on: true,
        text: "This is a sample course demonstrating the Verso authoring tool.",
        // Item FF — learner nav bar as a footer child. Sections live on the block
        // (its single owner); the runtime drives prev/next + live progress + the
        // chapter-jump modal identically in demo and the exported package.
        children: [
          {
            type: "courseNav",
            menuLabel: "Course Menu",
            prevLabel: "Back", nextLabel: "Next",
            sections: [
              { id: "s01", label: "01 · Getting Started", pageIds: ["ch01"] },
              { id: "s02", label: "02 · Common Hazards", pageIds: ["ch02"] },
              { id: "s03", label: "03 · Risk Awareness", pageIds: ["ch03"] },
              { id: "s04", label: "04 · Responding to Incidents", pageIds: ["ch04"] }
            ]
          }
        ]
      }
    },
    pages: [
      {
        id: "menu",
        name: "Course Menu",
        blocks: [
          { type: "heading", text: "Workplace Safety Essentials" },
          {
            type: "componentGrid",
            component: "chapter-card",
            className: "card-grid",
            instances: [
              {
                status: "complete",
                action: { goto: "ch01" },
                slots: {
                  number: "01",
                  title: "Getting Started",
                  objective: "I understand what this course covers and how to work through it."
                }
              },
              {
                status: "incomplete",
                action: { goto: "ch02" },
                slots: {
                  number: "02",
                  title: "Common Hazards",
                  objective: "I can recognise the common hazards found in a typical workplace."
                }
              },
              {
                status: "incomplete",
                action: { goto: "ch03" },
                slots: {
                  number: "03",
                  title: "Risk Awareness",
                  objective: "I understand how to assess and prioritise everyday risks."
                }
              },
              {
                status: "incomplete",
                action: { goto: "ch04" },
                slots: {
                  number: "04",
                  title: "Responding to Incidents",
                  objective: "I can identify the core steps of responding to a workplace incident."
                }
              }
            ]
          }
        ]
      },
      {
        id: "ch01",
        name: "01 · Getting Started",
        blocks: [
          { type: "heading", text: "Getting Started" },
          { type: "paragraph", text: "I understand what this course covers and how to work through it." },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Common Hazards", action: { goto: "ch02" } }
        ]
      },
      {
        id: "ch02",
        name: "02 · Common Hazards",
        blocks: [
          { type: "heading", text: "Common Hazards" },
          { type: "paragraph", text: "I can recognise the common hazards found in a typical workplace." },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Risk Awareness", action: { goto: "ch03" } }
        ]
      },
      {
        id: "ch03",
        name: "03 · Risk Awareness",
        blocks: [
          { type: "heading", text: "Risk Awareness" },
          { type: "paragraph", text: "I understand how to assess and prioritise everyday risks." },
          { type: "webEmbed", url: "https://vimeo.com/76979871" },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Responding to Incidents", action: { goto: "ch04" } }
        ]
      },
      {
        id: "ch04",
        name: "04 · Responding to Incidents",
        blocks: [
          { type: "heading", text: "Responding to Incidents" },
          { type: "paragraph", text: "I can identify the core steps of responding to a workplace incident." },
          { type: "htmlEmbed", src: "assets/interactions/sample-interaction.html", fitWidth: 880, height: 560 },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Back to course menu", action: { goto: "menu" } }
        ]
      }
    ]
  };
})();
