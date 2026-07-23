// Sample course model for the Verso editor UI kit — a neutral demo course used to
// populate the reference gallery. Not production data.
window.VERSO_COURSE = {
  title: "Sample Course",
  chapters: [
    {
      id: "intro",
      name: "INTRODUCTION",
      pages: [
        { id: "p11", name: "1.1 Welcome" },
        { id: "p12", name: "1.2 Page" },
        { id: "p13", name: "1.3 Learning Objectives" },
        { id: "p14", name: "1.4 Notes" },
      ],
    },
    {
      id: "concepts",
      name: "CORE CONCEPTS",
      pages: [
        { id: "p21", name: "2.1 Key Terms and Ideas" },
        { id: "p22", name: "2.2 Overview" },
        { id: "p23", name: "2.3 How It Fits Together" },
        { id: "p24", name: "2.4 Concepts Interactive" },
        { id: "p25", name: "2.5 Common Misconceptions" },
        { id: "p26", name: "2.6 Core Concepts (cont.)" },
      ],
    },
    {
      id: "practice",
      name: "PUTTING IT INTO PRACTICE",
      pages: [{ id: "p31", name: "3.1 Practice Scenarios" }],
    },
  ],
  // The blocks on the currently-open page (2.4 — the hotspots page).
  page: {
    id: "p24",
    label: "2.4 Applying the Concepts",
    blocks: [
      { id: "b1", type: "Heading", icon: "heading", text: "Applying the Concepts" },
      {
        id: "b2",
        type: "Paragraph",
        icon: "align-left",
        text:
          "Different situations call for a different approach. Planning, execution and review considerations come together when you put the ideas into practice.",
      },
      { id: "b3", type: "Image hotspots", icon: "target", hotspots: ["Plan", "Prepare", "Execute", "Review", "Improve"] },
    ],
  },
};

// Blocks palette catalogue (from the User Guide).
window.VERSO_PALETTE = [
  {
    group: "Text",
    items: [
      { icon: "heading", label: "Heading" },
      { icon: "type", label: "Subheading" },
      { icon: "align-left", label: "Paragraph" },
      { icon: "quote", label: "Quote" },
      { icon: "list", label: "Bulleted list" },
      { icon: "message-square-warning", label: "Note / callout" },
    ],
  },
  {
    group: "Media",
    items: [
      { icon: "image", label: "Image" },
      { icon: "code-xml", label: "HTML Interaction" },
      { icon: "square-play", label: "Web Embed" },
      { icon: "target", label: "Image hotspots" },
    ],
  },
  {
    group: "Layout",
    items: [
      { icon: "square", label: "Card (container)" },
      { icon: "minus", label: "Divider" },
      { icon: "move-vertical", label: "Spacer" },
      { icon: "panels-top-left", label: "Accordion / Tabs" },
      { icon: "layers", label: "Card Reveal" },
      { icon: "workflow", label: "Sequence (process)" },
    ],
  },
  {
    group: "Interactive",
    items: [
      { icon: "navigation", label: "Navigation button" },
      { icon: "check-square", label: "Acknowledge / Checkbox" },
      { icon: "list-checks", label: "Quiz (knowledge check)" },
    ],
  },
];
