// Verso editor — right dock: the contextual inspector.
(function () {
  const V = window.VersoDesignSystem_2a48ac;
  const {
    Panel, Tabs, Breadcrumb, PanelSection, FieldRow, TwoUp, IconField,
    SegmentedControl, ColorField, SwitchRow, Select, TextField, IconButton,
  } = V;

  function ActionsRow() {
    return (
      <div style={{ display: "flex", gap: 2, background: "var(--surface-input)", borderRadius: "var(--radius-xs)", padding: 2, width: "fit-content" }}>
        <IconButton icon="arrow-up" label="Move up" />
        <IconButton icon="arrow-down" label="Move down" />
        <IconButton icon="copy" label="Duplicate" />
        <IconButton icon="trash-2" label="Delete" danger />
      </div>
    );
  }

  function AlignRow() {
    const [h, setH] = React.useState("center");
    const [v, setV] = React.useState("top");
    return (
      <>
        <FieldRow label="Horizontal">
          <SegmentedControl value={h} onChange={setH} options={[
            { value: "left", icon: "align-start-vertical" }, { value: "center", icon: "align-center-vertical" }, { value: "right", icon: "align-end-vertical" }]} />
        </FieldRow>
        <FieldRow label="Vertical">
          <SegmentedControl value={v} onChange={setV} options={[
            { value: "top", icon: "align-start-horizontal" }, { value: "middle", icon: "align-center-horizontal" }, { value: "bottom", icon: "align-end-horizontal" }]} />
        </FieldRow>
      </>
    );
  }

  function HotspotInspector() {
    const [marker, setMarker] = React.useState("#FF8A00");
    return (
      <>
        <PanelSection title="Position" divider={false}>
          <AlignRow />
        </PanelSection>
        <PanelSection title="Actions" collapsible={false}>
          <ActionsRow />
        </PanelSection>
        <PanelSection title="Base image">
          <FieldRow label="Source"><IconField icon="image" placeholder="paste a URL" /></FieldRow>
          <FieldRow label="Alt text" align="top"><TextField multiline rows={2} placeholder="Describe the image for screen readers" /></FieldRow>
          <FieldRow label="Interaction"><Select value="Popover on click" options={["Popover on click", "Popover on hover", "Tooltip"]} /></FieldRow>
        </PanelSection>
        <PanelSection title="Markers" actions={<IconButton icon="plus" label="Add colour" size="sm" />}>
          <FieldRow label="Colour"><ColorField value={marker} opacity={100} onChange={setMarker} /></FieldRow>
          <FieldRow label="Size"><IconField prefix="W" value="30" suffix="px" /></FieldRow>
          <SwitchRow label="Mark as viewed" checked={true} onChange={() => {}} />
        </PanelSection>
        <PanelSection title="Overlay card">
          <FieldRow label="Fill"><ColorField value="#262626" opacity={100} /></FieldRow>
          <FieldRow label="Border"><ColorField value="#0D99FF" opacity={100} /></FieldRow>
          <FieldRow label="Radius"><TwoUp><IconField prefix="R" value="4" /><IconField prefix="W" value="20" /></TwoUp></FieldRow>
        </PanelSection>
        <PanelSection title="Hotspots">
          {["Military", "Protecting", "Law Enforcement", "Extended", "Gatherings"].map((h) => (
            <div key={h} style={{ display: "flex", alignItems: "center", gap: 8, height: 26 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: "#FF8A00", flex: "none" }} />
              <span style={{ flex: 1, font: "var(--type-label)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h}</span>
              <IconButton icon="x" label="Remove" size="sm" />
            </div>
          ))}
        </PanelSection>
      </>
    );
  }

  function TextInspector({ kind }) {
    const [font, setFont] = React.useState("Exo 2");
    const [align, setAlign] = React.useState("left");
    const [color, setColor] = React.useState(kind === "Heading" ? "#FFFFFF" : "#C9C9C9");
    const [style, setStyle] = React.useState("B");
    return (
      <>
        <PanelSection title="Type" divider={false}>
          <FieldRow label="Font"><Select value={font} onChange={setFont} options={["Exo 2", "Inter", "Arial"]} /></FieldRow>
          <FieldRow label="Size"><TwoUp>
            <IconField prefix="S" value={kind === "Heading" ? "30" : "15"} suffix="px" />
            <Select value={kind === "Heading" ? "Semibold" : "Regular"} options={["Regular", "Medium", "Semibold", "Bold"]} />
          </TwoUp></FieldRow>
          <FieldRow label="Style">
            <SegmentedControl value={style} onChange={setStyle} options={[
              { value: "B", icon: "bold" }, { value: "I", icon: "italic" }, { value: "U", icon: "underline" }, { value: "L", icon: "link" }]} />
          </FieldRow>
          <FieldRow label="Align">
            <SegmentedControl value={align} onChange={setAlign} options={[
              { value: "left", icon: "align-left" }, { value: "center", icon: "align-center" }, { value: "right", icon: "align-right" }, { value: "justify", icon: "align-justify" }]} />
          </FieldRow>
        </PanelSection>
        <PanelSection title="Appearance">
          <FieldRow label="Colour"><ColorField value={color} opacity={100} onChange={setColor} /></FieldRow>
          <FieldRow label="Style"><Select value="— None —" options={["— None —", "Section title", "Body", "Caption"]} /></FieldRow>
        </PanelSection>
        <PanelSection title="Actions" collapsible={false}>
          <ActionsRow />
        </PanelSection>
      </>
    );
  }

  function PageInspector() {
    const [twoCol, setTwoCol] = React.useState(false);
    return (
      <>
        <PanelSection title="Chapter" divider={false}>
          <FieldRow label="Name"><IconField value="Introduction" /></FieldRow>
          <SwitchRow label="Gated progression" description="Complete this chapter's quiz to advance" checked={twoCol} onChange={setTwoCol} />
        </PanelSection>
        <PanelSection title="Page padding">
          <FieldRow label="Top / Bottom"><TwoUp><IconField prefix="T" value="64" /><IconField prefix="B" value="64" /></TwoUp></FieldRow>
          <FieldRow label="Sides"><TwoUp><IconField prefix="L" value="52" /><IconField prefix="R" value="52" /></TwoUp></FieldRow>
        </PanelSection>
        <PanelSection title="Header & Footer">
          <SwitchRow label="Show header" checked={false} onChange={() => {}} />
          <SwitchRow label="Show footer" checked={true} onChange={() => {}} />
          <SwitchRow label="Learner nav pill" checked={true} onChange={() => {}} />
        </PanelSection>
        <PanelSection title="Theme">
          <FieldRow label="Background"><ColorField value="#212121" tokenName="bg" opacity={100} /></FieldRow>
          <FieldRow label="Ink"><ColorField value="#FFFFFF" tokenName="ink" opacity={100} /></FieldRow>
          <FieldRow label="Accent"><ColorField value="#0D99FF" tokenName="accent" opacity={100} /></FieldRow>
        </PanelSection>
      </>
    );
  }

  function Inspector({ selected }) {
    const [tab, setTab] = React.useState("Design");
    const page = window.VERSO_COURSE.page;
    let crumbs, body;
    if (selected.type === "block") {
      const b = page.blocks.find((x) => x.id === selected.id);
      crumbs = [page.name || "Page", b ? b.type : "Block"];
      body =
        b && b.type === "Image hotspots" ? <HotspotInspector /> :
        b ? <TextInspector kind={b.type} /> : <PageInspector />;
    } else {
      crumbs = ["Document", "Page 2.4"];
      body = <PageInspector />;
    }

    return (
      <Panel side="right"
        header={<>
          <Tabs tabs={["Design", "Interact"]} value={tab} onChange={setTab} />
          <Breadcrumb items={crumbs} />
        </>}>
        {body}
      </Panel>
    );
  }

  window.Inspector = Inspector;
})();
