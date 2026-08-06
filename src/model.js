/*
 * The course document — single source of truth. Plain JSON-serialisable data.
 *
 * This is a NEUTRAL DEMO course that ships with the tool: a menu + 6 chapters
 * exercising every block type the authoring tool supports (text, media, layout,
 * interactive, and the shared-component / Product Rail system), plus a plain,
 * generic doc.theme override so the demo doesn't inherit any one visual identity.
 * It holds NO real/customer content — real courses are authored or imported at
 * runtime and saved to the document store; this seed is only a demo.
 *
 * Classic script — exposes window.SAMPLE_DOC.
 */
(function () {
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  var CHART_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 260'>" +
    "<rect width='400' height='260' fill='%23f2f2f3'/>" +
    "<rect x='40' y='140' width='50' height='90' fill='%234a6fa5'/>" +
    "<rect x='120' y='90' width='50' height='140' fill='%234a6fa5'/>" +
    "<rect x='200' y='150' width='50' height='80' fill='%234a6fa5'/>" +
    "<rect x='280' y='60' width='50' height='170' fill='%234a6fa5'/>" +
    "<text x='200' y='30' font-family='sans-serif' font-size='18' text-anchor='middle' fill='%23333'>Sample Chart</text>" +
    "</svg>";
  var FLOORPLAN_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 450'>" +
    "<rect width='800' height='450' fill='%23e9edf1'/>" +
    "<rect x='40' y='40' width='320' height='170' fill='%23cfd8e3' stroke='%238a97a8'/>" +
    "<rect x='420' y='40' width='340' height='170' fill='%23cfd8e3' stroke='%238a97a8'/>" +
    "<rect x='40' y='250' width='720' height='160' fill='%23cfd8e3' stroke='%238a97a8'/>" +
    "<text x='200' y='130' font-family='sans-serif' font-size='20' text-anchor='middle' fill='%23334'>Work Area</text>" +
    "<text x='590' y='130' font-family='sans-serif' font-size='20' text-anchor='middle' fill='%23334'>Storage</text>" +
    "<text x='400' y='335' font-family='sans-serif' font-size='20' text-anchor='middle' fill='%23334'>Assembly Floor</text>" +
    "</svg>";
  var DIAGRAM_STANDARD_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'>" +
    "<rect width='400' height='200' fill='%23eef1f4'/><circle cx='200' cy='100' r='60' fill='%23a8b6c6'/>" +
    "<text x='200' y='105' font-family='sans-serif' font-size='16' text-anchor='middle' fill='%23222'>Standard</text></svg>";
  var DIAGRAM_PRO_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'>" +
    "<rect width='400' height='200' fill='%23eef1f4'/><circle cx='140' cy='100' r='60' fill='%234a6fa5'/><circle cx='260' cy='100' r='60' fill='%234a6fa5' opacity='0.6'/>" +
    "<text x='200' y='105' font-family='sans-serif' font-size='16' text-anchor='middle' fill='%23fff'>Pro</text></svg>";

  window.SAMPLE_DOC = {
    meta: {
      title: "Workplace Safety Essentials",
      code: "DEMO-WSE-101",
      // Product Rail demo tag — shows this doc filed under the seeded demo Product
      // (see loadProducts()'s seedDemoProducts in editor.js). Neutral/invented only.
      productId: "prod-demo",
      stage: "elearning"
    },
    // Build-time variant axis (#148): a demo course ships two invented package
    // variants so the per-variant image override (below, ch06) has something to
    // resolve against. Purely illustrative — no real product line.
    variants: ["Standard", "Pro"],
    // Explicit chapter model (schema v2+) + schemaVersion: 4 (current). Declaring
    // both up front means normalizeDoc's one-shot "legacy Course Menu -> chapters"
    // migration never fires (it only runs when doc.chapters is empty) — so the
    // menu page's componentGrid survives untouched instead of being auto-removed
    // on first load. Chapter order mirrors the footer courseNav sections below.
    schemaVersion: 4,
    chapters: [
      { id: "chap-01", name: "01 · Getting Started", order: 0 },
      { id: "chap-02", name: "02 · Common Hazards", order: 1 },
      { id: "chap-03", name: "03 · Risk Awareness", order: 2 },
      { id: "chap-04", name: "04 · Responding to Incidents", order: 3 },
      { id: "chap-05", name: "05 · Block Gallery", order: 4 },
      { id: "chap-06", name: "06 · Products & Variants", order: 5 }
    ],
    // A plain, generic per-course theme override: neutral greys + one muted
    // slate-blue accent, system UI fonts. Any group left out (radius/size/button)
    // backfills from the built-in base, so this only overrides colour + font.
    theme: {
      color: {
        dark: {
          bg: "#1c1c1e", surface: "#2a2a2c", surfaceAlt: "#333335",
          ink: "#f2f2f3", inkSoft: "#b8b8ba", muted: "#8a8a8c",
          hair: "#3a3a3c", rule: "#4a6fa5", accent: "#4a6fa5",
          success: "#4caf50", danger: "#b3453b"
        },
        light: {
          bg: "#f7f7f8", surface: "#ffffff", surfaceAlt: "#eeeeef",
          ink: "#1c1c1e", inkSoft: "#48484a", muted: "#6d6d70",
          hair: "#dcdcde", rule: "#3f6090", accent: "#3f6090",
          success: "#3f8f43", danger: "#a13f36"
        }
      },
      font: {
        heading: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        body: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      }
    },
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
              { id: "s04", label: "04 · Responding to Incidents", pageIds: ["ch04"] },
              { id: "s05", label: "05 · Block Gallery", pageIds: ["ch05"] },
              { id: "s06", label: "06 · Products & Variants", pageIds: ["ch06"] }
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
              },
              {
                status: "incomplete",
                action: { goto: "ch05" },
                slots: {
                  number: "05",
                  title: "Block Gallery",
                  objective: "A reference page showing every layout and interactive block type."
                }
              },
              {
                status: "incomplete",
                action: { goto: "ch06" },
                slots: {
                  number: "06",
                  title: "Products & Variants",
                  objective: "A worked example of the shared-component and product-variant system."
                }
              }
            ]
          }
        ]
      },
      {
        id: "ch01",
        name: "01 · Getting Started",
        chapterId: "chap-01",
        blocks: [
          { type: "heading", text: "Getting Started" },
          { type: "paragraph", text: "I understand what this course covers and how to work through it." },
          { type: "subheading", text: "How this course is structured" },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Common Hazards", action: { goto: "ch02" } }
        ]
      },
      {
        id: "ch02",
        name: "02 · Common Hazards",
        chapterId: "chap-02",
        blocks: [
          { type: "heading", text: "Common Hazards" },
          { type: "paragraph", text: "I can recognise the common hazards found in a typical workplace." },
          { type: "list", text: "<li>Slips, trips and falls</li><li>Manual handling injuries</li><li>Electrical hazards</li><li>Fire and evacuation</li>" },
          { type: "quote", text: "“The safest workplace is the one where everyone notices the small things.”" },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Risk Awareness", action: { goto: "ch03" } }
        ]
      },
      {
        id: "ch03",
        name: "03 · Risk Awareness",
        chapterId: "chap-03",
        blocks: [
          { type: "heading", text: "Risk Awareness" },
          { type: "paragraph", text: "I understand how to assess and prioritise everyday risks." },
          { type: "webEmbed", url: "https://vimeo.com/76979871" },
          {
            type: "table",
            header: true, borders: "all", zebra: true, cellPad: 10,
            rows: [
              [{ t: "Likelihood" }, { t: "Impact" }, { t: "Priority" }],
              [{ t: "Low" }, { t: "High" }, { t: "Review" }],
              [{ t: "High" }, { t: "Low" }, { t: "Monitor" }]
            ]
          },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Responding to Incidents", action: { goto: "ch04" } }
        ]
      },
      {
        id: "ch04",
        name: "04 · Responding to Incidents",
        chapterId: "chap-04",
        blocks: [
          { type: "heading", text: "Responding to Incidents" },
          { type: "paragraph", text: "I can identify the core steps of responding to a workplace incident." },
          { type: "htmlEmbed", src: "assets/interactions/sample-interaction.html", fitWidth: 880, height: 560 },
          { type: "checkbox", label: "I acknowledge I have read and understood this chapter." },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Next: Block Gallery", action: { goto: "ch05" } }
        ]
      },
      {
        id: "ch05",
        name: "05 · Block Gallery",
        chapterId: "chap-05",
        blocks: [
          { type: "heading", text: "Block Gallery" },
          { type: "paragraph", text: "A reference page exercising the remaining block types: layout, media and interactive." },
          { type: "divider" },
          { type: "image", src: CHART_SVG, alt: "Sample chart" },
          { type: "spacer", height: 40 },
          {
            type: "frame", padding: 20, radius: 12, border: true,
            children: [
              { type: "subheading", text: "Card (frame)" },
              { type: "paragraph", text: "A frame is a styled container that holds child blocks." }
            ]
          },
          {
            type: "group",
            children: [
              { type: "paragraph", text: "A group has no visual style of its own." },
              { type: "paragraph", text: "It only keeps a set of blocks together for reuse." }
            ]
          },
          {
            type: "columns", explicit: true, gap: 24,
            columns: [
              [{ type: "paragraph", text: "Left column content." }],
              [{ type: "paragraph", text: "Right column content." }]
            ]
          },
          { type: "modeToggle", label: "Light / Dark" },
          {
            type: "cardReveal", cols: 4, gap: 24, hint: "Hold to reveal",
            items: [
              { children: [{ type: "heading", text: "Slips & trips" }, { type: "paragraph", text: "Keep walkways clear and dry." }] },
              { children: [{ type: "heading", text: "Manual handling" }, { type: "paragraph", text: "Bend at the knees, not the back." }] },
              { children: [{ type: "heading", text: "Electrical" }, { type: "paragraph", text: "Report damaged cords immediately." }] },
              { children: [{ type: "heading", text: "Fire" }, { type: "paragraph", text: "Know your nearest exit and muster point." }] }
            ]
          },
          {
            type: "accordion", mode: "accordion",
            items: [
              { title: "Before you start", children: [{ type: "paragraph", text: "Check your work area for hazards." }] },
              { title: "During the task", children: [{ type: "paragraph", text: "Follow the procedure and use the right equipment." }] },
              { title: "If something goes wrong", children: [{ type: "paragraph", text: "Stop, make safe, and report it." }] }
            ]
          },
          {
            type: "sequence", spine: "numbered", orient: "vertical", reveal: "scroll",
            items: [
              { title: "Identify", children: [{ type: "paragraph", text: "Spot the hazard." }] },
              { title: "Assess", children: [{ type: "paragraph", text: "Work out how serious it is." }] },
              { title: "Control", children: [{ type: "paragraph", text: "Remove it or reduce the risk." }] },
              { title: "Review", children: [{ type: "paragraph", text: "Check the control worked." }] }
            ]
          },
          {
            type: "cardDeck",
            items: [
              { label: "", children: [{ type: "heading", text: "Report" }, { type: "paragraph", text: "Tell your supervisor what happened." }] },
              { label: "", children: [{ type: "heading", text: "Support" }, { type: "paragraph", text: "Check on anyone involved." }] }
            ]
          },
          {
            type: "hotspot", entry: "scr-entry",
            screens: [
              {
                id: "scr-entry", visual: FLOORPLAN_SVG, kind: "image", alt: "Sample floor plan",
                markers: [
                  { id: "hs_1", x: 25, y: 29, action: "card", blocks: [{ type: "subheading", text: "Work Area" }, { type: "paragraph", text: "Keep aisles clear at all times." }] },
                  { id: "hs_2", x: 74, y: 29, action: "card", blocks: [{ type: "subheading", text: "Storage" }, { type: "paragraph", text: "Stack loads securely and within limits." }] }
                ]
              }
            ]
          },
          {
            type: "quiz",
            kicker: "Knowledge Check",
            title: "Chapter knowledge check",
            intro: { on: false, body: "Answer the questions to check your understanding.", startLabel: "Start" },
            settings: { shuffleQuestions: false, shuffleOptions: false },
            questions: [
              {
                id: "q1", type: "multipleChoice", methodLabel: "Select the answer",
                prompt: "What should you do first if you notice a hazard?",
                options: [
                  { text: "Report it and make the area safe", correct: true },
                  { text: "Ignore it if you're in a hurry", correct: false },
                  { text: "Wait for someone else to notice", correct: false }
                ],
                feedbackCorrect: "<strong>Correct.</strong> Reporting early keeps everyone safe.",
                feedbackIncorrect: "Think about who else could be affected if the hazard is left."
              },
              {
                id: "q2", type: "fillBlank", methodLabel: "Complete the sentence",
                stemBefore: "Personal protective equipment is provided to", stemAfter: "",
                options: [
                  { text: "look professional", correct: false },
                  { text: "reduce your exposure to a known risk", correct: true },
                  { text: "replace other safety controls", correct: false }
                ],
                feedbackCorrect: "<strong>Correct.</strong> PPE is the last line of defence, not the first.",
                feedbackIncorrect: "Think about where PPE sits in the hierarchy of controls."
              }
            ],
            done: { title: "Knowledge Check Complete", body: "All questions answered correctly. Continue to the next section.", retry: { on: false, label: "Try again" } }
          },
          { type: "navButton", text: "Next: Products & Variants", action: { goto: "ch06" } }
        ]
      },
      {
        id: "ch06",
        name: "06 · Products & Variants",
        chapterId: "chap-06",
        blocks: [
          { type: "heading", text: "Products & Variants" },
          { type: "paragraph", text: "This course is tagged to a demo Product; the two panels below are placements of the SAME shared component, each showing a different facet of it." },
          { type: "libraryInstance", ref: "comp-demo-feature" },
          { type: "libraryInstance", ref: "comp-demo-feature", facet: "pro" },
          { type: "paragraph", text: "This image is a per-variant override: the Standard and Pro builds of this course each ship a different version of the same asset (switch build variant in the editor to preview it)." },
          {
            type: "image", src: DIAGRAM_STANDARD_SVG, alt: "Product diagram (Standard)",
            overrides: { "Standard": { src: DIAGRAM_STANDARD_SVG }, "Pro": { src: DIAGRAM_PRO_SVG } }
          },
          { type: "note", text: "This is a sample chapter. Replace this placeholder with your own content." },
          { type: "navButton", text: "Back to course menu", action: { goto: "menu" } }
        ]
      }
    ]
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
