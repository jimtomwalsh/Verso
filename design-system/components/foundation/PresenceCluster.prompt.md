**PresenceCluster** — the live-collaboration presence avatars. Overlapping author circles pinned to the right of the toolbar: who is in this file right now. Server-mode only — renders nothing when not collaborating (solo/standalone has no presence chrome).

```jsx
<PresenceCluster
  peers={[
    { name: "Priya", colour: colourForName("Priya"), state: "editing", blockId: "b2", blockLabel: "Range, bearing, elevation" },
    { name: "Marcus", colour: colourForName("Marcus"), state: "viewing", blockId: "b3", blockLabel: "Why clutter is hard" },
    { name: "Lena", colour: colourForName("Lena"), state: "viewing", blockId: null }
  ]}
  max={4}
/>
```

- **Two states, one glance.** EDITING = solid author-colour fill + ring (this peer holds the block's content lock). VIEWING = a 40%/hollow ring with a tinted centre (watching, no lock). Never make the viewer look like a holder.
- **Colour is shared, not invented.** Every peer's colour comes from `colourForName` (the `COMMENT_COLOURS` palette) so a person is the SAME colour in presence, cursors, and comments. The server already emits the matching colour.
- **Sizing/shape:** `--control-sm` (20px), `--radius-full`, overlap `-6px`, 1.5px ring in the peer colour, a `--surface-app` gap ring so avatars separate on the toolbar; initials at `--text-2xs`. Tail beyond `max` collapses to a "+N" chip (same size, `--surface-raised`).
- **Hover = identity.** A `Tooltip` gives name + "editing/viewing *block label*" (or "— idle"). No click target here; per-block actions (handoff/notify) live on the block chip, never on the avatar.
- **Ambient (the-tool-recedes).** Presence is status, not a control surface — it must not compete with authoring. Join/leave/flip animates opacity+colour only, 150–200ms. "Me" renders separately, pinned after a hairline divider, so you always see yourself last.
