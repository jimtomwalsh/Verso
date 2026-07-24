**RemoteCaret** — a remote collaborator's live cursor + selection on the canvas. Server-mode only, ephemeral, non-interactive. Shows where a colleague's caret is and what they have selected, in their author colour.

```jsx
<RemoteCaret
  name="Priya"
  colour={colourForName("Priya")}
  x={caretX} y={caretY} height={20}
  selection={[{ x, y, w, h }]}   /* omit for a bare caret */
/>
```

- **Ephemeral + inert.** Cursor/selection traffic is never seq-stamped, never logged, and the element is `pointer-events: none` — it can never intercept a click or block the local author. If it would ever swallow input, it is wrong.
- **Reuse the comment layer.** Project onto the existing `.comment-pin-layer`, so it inherits the exact pan/zoom reprojection comment pins already use. Do NOT introduce a parallel overlay layer (consistency-over-novelty; one projection path).
- **Look:** a 2px caret in the peer's author colour; a small name flag above-left at `--text-2xs` on the author colour with a notched bottom-left corner (echoing a comment pin). A selection = a 1.5px author-colour outline + ~12% author-colour wash, `--radius-sm`.
- **Colour is shared.** The colour is the peer's `colourForName` colour — identical to their presence avatar and their comments. One person, one colour, everywhere.
- **Motion:** position eases 150–200ms so a moving cursor glides, not teleports; opacity fades in/out on focus/blur. Nothing bounces.
