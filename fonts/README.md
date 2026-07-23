# Editor chrome fonts (vendored, air-gap)

These `.woff2` files are the **editor chrome** faces. They are `@font-face`'d in
`editor.css` (chrome-only) with `font-display: swap` so the editor renders in
its intended typefaces on an air-gapped machine with no CDN access.

They are NOT shipped in SCORM exports. Course content uses Exo 2, which the
SCORM exporter embeds separately from `export/fonts/` (`src/export.js`).

| File                      | Family          | Weight | License |
|---------------------------|-----------------|--------|---------|
| `Inter-400.woff2`         | Inter           | 400    | OFL 1.1 |
| `Inter-500.woff2`         | Inter           | 500    | OFL 1.1 |
| `Inter-600.woff2`         | Inter           | 600    | OFL 1.1 |
| `JetBrainsMono-400.woff2` | JetBrains Mono  | 400    | OFL 1.1 |

## Source (to re-fetch)

Fetched as latin-subset `.woff2` from the Fontsource CDN:

- Inter 400: https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff2
- Inter 500: https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-500-normal.woff2
- Inter 600: https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-600-normal.woff2
- JetBrains Mono 400: https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-400-normal.woff2

Upstream projects: Inter (rsms/inter), JetBrains Mono (JetBrains/JetBrainsMono).
Both are licensed under the SIL Open Font License 1.1.
