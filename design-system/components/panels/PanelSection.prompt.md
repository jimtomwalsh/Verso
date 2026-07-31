**PanelSection** — the collapsible titled group (`sectionGroup`) every inspector is built from. One section per taxonomy type: Content, Type, Appearance, Layout, Spacing, Behaviour, Light/Dark, Actions.

```jsx
<PanelSection title="Appearance" actions={<IconButton icon="plus" label="Add fill" size="sm" />}>
  <FieldRow label="Fill"><ColorField value="#262626" /></FieldRow>
  <FieldRow label="Radius"><IconField prefix="R" value="6" suffix="px" /></FieldRow>
</PanelSection>
```

- Pass `divider={false}` on the first section in a panel.
- Header chevron collapses the body; put quick actions in `actions`.
- Pass `overrideCount` to roll up how many rows in the section are set here rather than
  inherited — it reads "3 overridden" beside the title, in accent ink. 0 shows nothing.
