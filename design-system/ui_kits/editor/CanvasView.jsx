// Verso editor — the canvas (infinite board) with the open page rendered.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const { Badge, Icon } = V;

  function BlockWrap({ block, selected, onSelect, children }) {
    const [hover, setHover] = React.useState(false);
    return (
      <div
        onClick={(e) => { e.stopPropagation(); onSelect({ type: "block", id: block.id }); }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "relative",
          borderRadius: 4,
          outline: selected ? "2px solid var(--accent)" : hover ? "1px solid var(--accent)" : "1px solid transparent",
          outlineOffset: 2,
          cursor: "default",
        }}
      >
        {children}
      </div>
    );
  }

  function CanvasView({ selected, onSelect }) {
    const page = window.VERSO_COURSE.page;
    const sel = (id) => selected.type === "block" && selected.id === id;

    return (
      <div
        onClick={() => onSelect({ type: "page", id: page.id })}
        style={{
          flex: 1,
          background: "var(--surface-canvas)",
          overflow: "auto",
          display: "flex",
          justifyContent: "center",
          padding: "56px 40px",
        }}
      >
        <div style={{ width: 720, alignSelf: "flex-start" }}>
          {/* Frame label */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--accent)", font: "var(--type-label)" }}>
            <Icon name="file-text" size={12} />
            <span>{page.label}</span>
          </div>
          {/* Page surface (learner render, Exo 2 content) */}
          <div style={{ background: "#212121", borderRadius: 8, padding: "44px 52px", fontFamily: "var(--font-brand)", boxShadow: "0 1px 0 rgba(255,255,255,0.04)" }}>
            {page.blocks.map((b) => (
              <div key={b.id} style={{ marginBottom: 24 }}>
                <BlockWrap block={b} selected={sel(b.id)} onSelect={onSelect}>
                  {b.type === "Heading" && (
                    <h1 style={{ margin: 0, font: "600 30px/1.2 var(--font-brand)", color: "#fff" }}>{b.text}</h1>
                  )}
                  {b.type === "Paragraph" && (
                    <p style={{ margin: 0, font: "400 15px/1.6 var(--font-brand)", color: "#c9c9c9" }}>{b.text}</p>
                  )}
                  {b.type === "Image hotspots" && <Hotspots block={b} />}
                </BlockWrap>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function Hotspots({ block }) {
    // Placeholder base image with pin markers (matches the screenshot's hotspot block).
    const pins = [
      { x: "18%", y: "62%" }, { x: "38%", y: "40%" }, { x: "55%", y: "70%" },
      { x: "72%", y: "48%" }, { x: "86%", y: "30%" },
    ];
    return (
      <div style={{ position: "relative", height: 300, borderRadius: 6, overflow: "hidden",
        background: "linear-gradient(160deg,#2b3540,#1a2028 70%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.28)", font: "500 12px var(--font-ui)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Operational environments — base image
        </div>
        {pins.map((p, i) => (
          <span key={i} style={{ position: "absolute", left: p.x, top: p.y, transform: "translate(-50%,-50%)",
            width: 26, height: 26, borderRadius: 999, background: "rgba(255,138,0,0.92)",
            boxShadow: "0 0 0 4px rgba(255,138,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", font: "700 12px var(--font-ui)" }}>{i + 1}</span>
        ))}
      </div>
    );
  }

  window.CanvasView = CanvasView;
})();
