# Verso server-of-one (platform pivot · Foundation)

One minimal Node backend. It does **storage + transport** (and, in later phases, auth +
presence/locking) **only** — it never renders. `render()` stays a pure client-side
library in both postures. This is the on-prem substrate for multi-user Verso; it stays
**inert for today's single-user app** (nothing points at it until a guarded cutover).

## What it is

- **One artifact, two postures** — the `mode` flag is the only difference:
  - `local` — bundled inside the desktop shell, binds `127.0.0.1`, auth dormant.
  - `server` — the same file on-prem (Windows Service behind IIS+ARR), binds a host,
    auth hooks live.
- **Store** — SQLite/WAL on **local disk** (`data/verso.sqlite`). The server process is
  the **sole writer** — never point `dataDir` at an SMB/NFS share (silent oplock
  corruption). SMB is for backups/exports only.
- **Dependency-free** — `node:` builtins only (incl. built-in `node:sqlite`). No npm
  install, no external network calls.

## Run

```
node server/index.js
```

Copy `verso-server.config.example.json` → `verso-server.config.json` (gitignored) to set
`mode`, `host`, `port`, `dataDir`, and any secrets. Env overlay: `VERSO_MODE`,
`VERSO_PORT`, `VERSO_HOST`, `VERSO_DATA_DIR`.

## HTTP storage API (the StorageBackend contract)

The client's `StorageBackend` seam (ticket 01) can point at this instead of browser
storage. v1 is **blob-level** (the registry is one JSON blob); ticket 03 swaps the
registry for block-addressable rows + an append-only change log **under the same API**.

| Method            | Route                | Purpose                                  |
|-------------------|----------------------|------------------------------------------|
| `GET`             | `/api/health`        | `{ ok, mode, renders:false }`            |
| `GET` / `PUT`     | `/api/registry`      | read / write the registry blob           |
| `GET`/`PUT`/`DELETE` | `/api/kv/:key`    | doc-session keys (active doc, open docs) |
| `GET`/`PUT`/`HEAD`| `/api/media/:id`     | media get / put / has                    |
| `POST`            | `/api/media/sweep`   | mark-sweep (`{ keep: [...ids] }`)        |

Every route flows through one `authorize()` choke point (default-allow until identity
lands). No route serves the app HTML or renders — a non-`/api/` path 404s by design.

## Scope (Foundation ticket 02)

Blob-level round-trip + the API + the store + the mode flag. **Out of scope here:**
block rows + change log (03), migration round-trip (05), sync/presence/locking (Phase 2),
identity/SSO (Phase 3), review links (Phase 4), packaging/ops (Phase 5).
