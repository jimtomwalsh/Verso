# Third-Party Notices

Verso bundles the following third-party components. Their licenses are reproduced or
referenced below. Verso itself is licensed separately (see `LICENSE`); the notices here
apply only to the corresponding bundled components.

The application has **no third-party runtime package dependencies** (no `npm install`,
no `node_modules`). The items below are individually vendored source files or asset files.

---

## omggif — GIF reader/writer
- Where: `src/gif-codec.js`
- Version: 1.0.10 · Upstream: https://github.com/deanm/omggif
- License: **MIT**

```
Copyright (c) 2013, Dean McNamee <dean@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

## Lucide — icon set
- Where: `src/icons.js` (glyph geometry inlined offline)
- Version: 0.454.0 · Upstream: https://lucide.dev
- License: **ISC**

```
ISC License

Copyright (c) 2020, Lucide Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

*(Lucide is a fork of Feather Icons, © 2013–2022 Cole Bemis, also MIT/ISC-style licensed.)*

---

## Fonts — Inter, JetBrains Mono, Exo 2
All three are licensed under the **SIL Open Font License, Version 1.1** (OFL-1.1).
Full license text: https://openfontlicense.org

| Font | Where | Copyright / Reserved Font Name | Upstream |
|------|-------|--------------------------------|----------|
| **Inter** | `fonts/Inter-*.woff2` | Copyright (c) 2016 The Inter Project Authors ("Inter") | https://github.com/rsms/inter |
| **JetBrains Mono** | `fonts/JetBrainsMono-400.woff2` | Copyright (c) 2020 The JetBrains Mono Project Authors ("JetBrains Mono") | https://github.com/JetBrains/JetBrainsMono |
| **Exo 2** | `export/fonts/Exo2-*.ttf` | Copyright (c) 2013 The Exo 2 Project Authors ("Exo 2"), Natanael Gama | https://github.com/NDISCOVER/Exo-2.0 |

Under OFL-1.1 these fonts may be used, studied, modified and redistributed freely,
provided they are not sold on their own and the reserved font names are respected. The
full OFL-1.1 text accompanies each font upstream and applies to the copies bundled here.

---

## Verso-authored codecs (NOT third-party)

Listed here for audit completeness; these carry no third-party license (they are original
Verso code, released under the project `LICENSE`).

| File | What | Provenance |
|------|------|------------|
| `tools/webp-anim.js` | Animated-WebP **muxer** for the docs illustration pipeline (#28). Assembles Chrome-captured per-frame WebP bitstreams into one animated WebP (VP8X / ANIM / ANMF chunks). | Original implementation from the public [WebP RIFF container spec](https://developers.google.com/speed/webp/docs/riff_container). Not a VP8 encoder — a true encoder was rejected as too heavy for the no-build / air-gap stack (same reason the vendored GIF codec is unsuitable). Dependency-free pure Node; dev tooling only, never shipped in the app or a SCORM package. |
