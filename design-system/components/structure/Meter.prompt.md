**Meter** — labelled, banded percentage: a name, a 4px track whose fill carries the band tone,
and the value in the same tone as ink. It exists for the one place a banded number must be
*explained* rather than merely stated — Publish's alignment % (PUB-01). Everywhere else a
cross-stage fact stays a quiet `Badge`; reach for the Meter only where the number decides an
action.

The band scale is the caller's (one scale app-wide: success at the top band, warning in the
middle, neutral at the bottom — red stays reserved for something actually wrong). The band is
never colour alone: the value text and the `aria-label` speak it.

`pct: null` is the honest **not-indexed** state — a dashed empty track and "Not indexed" in
words. A measurement that could not be taken must never render as a 0% that reads as a failing
score.

```jsx
<Meter label="Alignment" pct={92} tone="success" bandLabel="Verified" />
<Meter label="Alignment" pct={78} tone="warning" bandLabel="Mixed" />
<Meter label="Alignment" pct={31} tone="neutral" bandLabel="Mostly novel" />
<Meter label="Alignment" pct={null} />  {/* Not indexed */}
```
