# Verso server-of-one

One minimal, self-hostable Node backend that turns Verso from a single-user local app into
an **optional on-prem multi-user tool**. It does **storage + transport + auth +
presence/locking** only — it **never renders** (`render()` stays a pure client-side library
in both postures), never serves the app HTML, and makes no external network calls.

> **Status: in development.** The backend + the client sync pipe are built and tested; the
> in-editor collaboration UX (presence chrome, lock indicators, soft-conflict prompts) is
> the remaining phase. The backend is **dormant** for the shipping single-user app —
> nothing points at it unless a deployment explicitly runs in server mode.

## One artifact, two postures

The `mode` flag is the only behavioural difference:

- `local` — bundled inside the desktop shell, binds `127.0.0.1`, collaboration/auth dormant
  (a single implicit owner). The standalone experience is unchanged.
- `server` — the same file on-prem (e.g. a Windows Service behind IIS+ARR), binds a host,
  auth + collaboration live.

## Run

```
node server/index.js
```

Copy `verso-server.config.example.json` → `verso-server.config.json` (gitignored) and set
`mode`, `host`, `port`, `dataDir`, and secrets. Env overlay: `VERSO_MODE`, `VERSO_PORT`,
`VERSO_HOST`, `VERSO_DATA_DIR`.

**In server mode a `linkSecret` is required** (it signs guest review-link tokens) — the
server refuses to start without it. There is no default.

## Security model (server mode)

- **On-prem only, never cloud. Sole writer, local disk.** The store is SQLite/WAL on
  **local disk** (`data/verso.sqlite`); the process is the only writer. Never point
  `dataDir` at SMB/NFS (silent oplock corruption) — SMB is for backups/exports only.
- **One identity boundary.** Every request resolves to `{principal, role}` or is rejected
  (401) before any storage call. Roles = `{admin, author, reviewer, viewer}` with a fixed
  capability matrix (reads = `view`, writes = `edit`, comment routes = `comment`, links =
  `issueLinks`, restore = admin). Permission is decided independently of block locks.
- **Auth ladder (per-deployment config, not a build fork):** OIDC (Entra ID / AD FS) → IIS
  Integrated Windows Auth → built-in local accounts, behind one pluggable adapter
  interface. Passwords scrypt-hashed; sessions are an `HttpOnly; Secure; SameSite=Strict`
  cookie (never raw IdP tokens). JIT provisions an unknown identity at `viewer`; the
  first-ever sign-in is the bootstrap admin. An always-on **break-glass local admin**
  (hashed) prevents lock-out when the IdP is unreachable.
- **Guest review links** are HMAC-signed, revocable, scoped to one file + a **pinned
  snapshot**, **view + comment only** (no account, no edit, no lock). Revoke cuts access
  immediately; an SSO-gated link routes the reviewer through OIDC instead.
- **Config-file secrets only; no external network / CDN.** Dependency-free — `node:`
  builtins only (`node:sqlite`, `node:crypto`, `node:http`) plus the bundled Node runtime.

## HTTP API

Storage (the client `StorageBackend` contract), block-addressable docs, sync, auth, and
review — all under one authenticated boundary. A non-served path (`/`, the app) 404s by
design. Selected routes:

| Area | Routes |
|------|--------|
| Health | `GET /api/health` → `{ ok, mode, version, renders:false }` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| Storage | `GET/PUT /api/registry` · `GET/PUT/DELETE /api/kv/:key` · `GET/PUT/HEAD /api/media/:id` |
| Docs | `GET /api/doc/:id` (guest → pinned snapshot) · `POST …/import` · `…/change` · `GET …/changes?since=N` · `…/snapshot` |
| Rollback | `POST …/checkpoint` · `GET …/checkpoints` · `POST …/restore` · `GET …/block/:id/history` · `POST …/block/:id/revert` |
| Review | `GET/POST …/comments` · `POST …/comments/:thread/resolve` · `GET/POST …/links` · `DELETE …/links/:id` |
| Sync | `wss:// /sync` (primary) · `POST /sync/send` + `GET /sync/poll` (long-poll fallback) — all authenticated |

## Collaboration

- One authoritative sequencer stamps a monotonic `seq` and fans out `block.change`;
  **persist-before-fan-out** (the append log *is* the autosave). The sync stream and the
  storage change log are one event model.
- Block-level locking (model B): content locks per leaf block acquired on edit-intent,
  auto-released on blur/idle/save; a coarse structure lock per container for structural
  ops. A heartbeat-lease reaper reclaims a vanished holder's lock; a `baseSeq` guard
  rejects stale writes. The one real conflict (structure op vs a held content lock) is
  refused, never an eviction.
- Reconnect is transport-invisible: a recent client gets a bounded catchup delta, a fresh /
  far-behind client a resnapshot; replay is idempotent.

## Ops

- Backups: transactionally-consistent whole-store snapshots (`VACUUM INTO`) to a separate
  volume, with retention; restore + verify is a tested drill.
- Releases are a single versioned artifact (reported on `/api/health`); store migrations
  are forward-only (rollback = redeploy the previous artifact + restore the pre-migration
  backup). Synthetic fixtures seed local-is-staging validation; a content-isolation
  invariant keeps prod content out of local.

## Deployment `[UNKNOWN]`s (for IT, per environment)

- IIS + ARR must proxy **both** `wss://` and the long-poll endpoints (ARR WebSocket
  proxying is off by default).
- TLS cert issuance, the Windows Service account, and firewall ports are per-environment.
