# Course Schema — Agent Fill Guide

You are given: (1) this guide, (2) `course_schema_template.csv` (a worked reference course), and
(3) a semi-formatted Confluence export of a course. **Task:** produce ONE CSV, in exactly the
template's format, that the authoring tool's **Import Schema** button rebuilds into the course.

Do not invent columns, block types, or fields not listed here. When Confluence content does not
map to a listed block, use the closest listed block (usually `paragraph` or `note`) — never a new type.

---

## 1. Output contract (non-negotiable)

- **Header row, verbatim:** `Page,Location,Path,Field,Type,Value`
- **One row per scalar value** in the course (a leaf: a string/number/boolean/null). Objects and
  arrays are NOT rows — they are implied by the `Path` of their leaves.
- **Line endings:** CRLF (`\r\n`). **Encoding:** UTF-8.
- **Quoting (RFC-4180):** wrap a cell in double quotes if its value contains a comma, a double
  quote, or a newline; escape an inner `"` by doubling it (`""`). Values without those chars are bare.
- Import reads **only `Path`, `Type`, `Value`.** `Page`, `Location`, `Field` are human-review aids and
  are ignored on import — but **fill them anyway** (they make the sheet reviewable; see the reference).

## 2. Path grammar (this is what builds the tree)

`Path` is a dot-separated absolute address from the document root.

- A segment that is an **integer** is an **array index**, **0-based**. e.g. `pages.0`, `pages.1`.
- A segment that is a **word** is an **object key**. e.g. `meta.title`, `pages.0.blocks.2.text`.
- **Indices must be contiguous from 0 with no gaps.** `pages.0`, `pages.1`, `pages.2` — never skip to
  `pages.3`. Same for `blocks.N` and `instances.N`. A gap creates a hole and breaks the build.
- A block/page/instance is defined **purely by the rows that address into it.** There is no
  "length" or "count" row. To add a page, add its row-group; to remove one, delete its rows and
  renumber the rest so indices stay contiguous.
- Row **order does not affect import** (paths are absolute) — but keep rows grouped by page/block for
  human review, exactly like the reference.

## 3. `Type` column

One of: `string` | `number` | `boolean` | `null`.

- Get this right — it is applied on import. `"01"` must be `string` (leading zero), a pixel height
  must be `number`, an on/off flag must be `boolean`.
- `null` rows carry an empty `Value`.
- If unsure, use `string`.

## 4. Required document skeleton (always present, once)

| Path | Type | Notes |
|---|---|---|
| `meta.title` | string | Course title |
| `meta.code` | string | Course code, e.g. `ORG-101` |
| `chrome.header.on` | boolean | Show global header |
| `chrome.header.title` | string | |
| `chrome.header.subtitle` | string | |
| `chrome.header.logo` | null | Leave null (no logo path) |
| `chrome.footer.on` | boolean | |
| `chrome.footer.text` | string | Export-control / footer line |

Then `pages` is an array. Each page:

| Path | Type | Notes |
|---|---|---|
| `pages.N.id` | string | **Unique** page id (e.g. `menu`, `ch01`). This is the link target. |
| `pages.N.name` | string | Human label shown in the editor outliner |
| `pages.N.blocks.M.*` | — | The page's content blocks (see catalog) |

## 5. Block catalog (the ONLY valid block types)

Every block has `pages.N.blocks.M.type` = one of the names below, plus the fields listed. Emit one
row per field. Fields marked *(opt)* may be omitted.

| type | Fields (Path leaf → Type) | Maps from Confluence |
|---|---|---|
| `heading` | `text` → string | H1 / page title |
| `subheading` | `text` → string | H2 / section title |
| `paragraph` | `text` → string | Body text |
| `note` | `text` → string | Info panel / callout / admonition |
| `quote` | `text` → string | Blockquote / pull-quote |
| `list` | `text` → string | Bulleted list. **Value = the `<li>` items as HTML**, e.g. `<li>a</li><li>b</li>` (quote the cell — it has commas/markup) |
| `divider` | *(type only)* | Horizontal rule / section break |
| `spacer` | `height` → number *(or)* `auto` → boolean | Vertical whitespace |
| `image` | `src` → string; `alt` → string *(opt)*; `maxWidth` → number *(opt)* | Image. `src` is a path/name; unresolved refs become placeholders to fill later |
| `webEmbed` | `url` → string | Video / external embed (Vimeo, YouTube URL) |
| `htmlEmbed` | `src` → string; `fitWidth` → number *(opt)*; `height` → number *(opt)* | Bundled interactive HTML file |
| `checkbox` | `label` → string; `checked` → boolean *(opt)* | Acknowledgement tick |
| `navButton` | `text` → string; `action.goto` → string | "Next"/"Back" button. `action.goto` = a page `id` |
| `componentGrid` | see §6 | The chapter/menu card grid |

**Blocks that exist but you should NOT synthesize** (nested containers, hard to author blind):
`frame`, `group`, `columns`, `quiz`, `hotspot`, `modeToggle`. If the Confluence source clearly needs
one, flag it in your handoff notes rather than guessing the nested Path structure.

## 6. The menu card grid (`componentGrid` + `chapter-card`)

The landing/menu page's chapter index. Structure:

| Path | Type | Value |
|---|---|---|
| `pages.0.blocks.B.type` | string | `componentGrid` |
| `pages.0.blocks.B.component` | string | `chapter-card` |
| `pages.0.blocks.B.className` | string | `card-grid` |
| `pages.0.blocks.B.instances.K.status` | string | `complete` or `incomplete` |
| `pages.0.blocks.B.instances.K.action.goto` | string | the target page `id` |
| `pages.0.blocks.B.instances.K.slots.number` | string | e.g. `01` (string — keep leading zero) |
| `pages.0.blocks.B.instances.K.slots.title` | string | Chapter title |
| `pages.0.blocks.B.instances.K.slots.objective` | string | One-line "I can…" objective |

One instance (`K = 0,1,2,…`) per chapter card. Its `action.goto` must equal the `id` of the chapter
page it links to.

## 7. Integrity rules — check before you output

1. **Header row present and exact.**
2. **Indices contiguous** (`pages.0,1,2…`; `blocks.0,1,2…`; `instances.0,1,2…`) — no gaps, no dupes.
3. **Every page has a unique `id`.**
4. **Every `action.goto` / `slots.*.action.goto` value matches some page `id`** — no dangling links.
5. **Every block has a `type` row.**
6. **`Type` correct** for each value (leading-zero strings stay `string`; heights `number`; flags `boolean`).
7. **`list` values quoted** (they contain `<li>` and commas).
8. Every menu card's `goto` points at a real chapter page.

## 8. Alignment recipe (Confluence → template)

1. Read the Confluence course. Identify the **menu/overview** (becomes `pages.0`, a `heading` +
   `componentGrid`) and the ordered **chapters/sections** (become `pages.1..N`).
2. Assign each page an `id` (`menu`, `ch01`, `ch02`, …) and a `name`.
3. Build the menu grid: one `chapter-card` instance per chapter, `goto` → that chapter's id,
   `number`/`title`/`objective` from the Confluence chapter heading + its one-line objective.
4. For each chapter page, walk its Confluence content top-to-bottom and map each element to a block
   (§5 table): headings→`heading`/`subheading`, body→`paragraph`, panels→`note`, quotes→`quote`,
   bullets→`list`, images→`image`, videos→`webEmbed`, embedded interactions→`htmlEmbed`,
   acknowledgements→`checkbox`. End each chapter with a `navButton` to the next page (last one → back to `menu`).
5. Fill `Page`/`Location`/`Field` for review (copy the reference's style), set `Type` per value.
6. Run the §7 checklist. Output the CSV only.

## 9. Test it

Open the tool (`http://localhost:8123`) → **Import Schema** → pick your CSV. If it errors
("rebuilt no pages" / a page renders wrong), the cause is almost always a bad `Path`, a non-contiguous
index, or a `goto` with no matching page `id`.
