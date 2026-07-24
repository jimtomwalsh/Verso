# Security Policy

## Reporting a vulnerability

Please report suspected security vulnerabilities **privately** — do not open a public
issue for them.

- Preferred: use GitHub's **private vulnerability reporting** (the "Report a
  vulnerability" button under this repository's **Security** tab).
- Alternatively, contact the maintainer privately.

Please include steps to reproduce, affected version/commit, and impact. We aim to
acknowledge reports within a reasonable time and will keep you updated on remediation.

## Two postures — two threat models

Verso runs in one of two postures. Assess whichever you deploy.

- **Local / standalone** — the shipping product: a self-hosted, offline, client-side app,
  not a hosted SaaS.
- **Server-of-one** — an optional on-prem multi-user backend, **in development** (dormant;
  no local install points at it). Its security model is in *Server mode* below and in
  [`server/README.md`](server/README.md).

## Local / standalone posture

- **No server / no backend / no cloud.** The app runs from a local file, a local static
  server, or an optional macOS WKWebView shell. There is no hosted component to attack and
  no account system.
- **Data stays local.** Course content lives in browser storage (`localStorage` /
  IndexedDB) or local files (File System Access API). Nothing is transmitted to the
  maintainer or any third party.
- **No telemetry / analytics / tracking.**
- **Zero third-party runtime dependencies.** Dependency-free vanilla JS (no `npm install`,
  no `node_modules`, no framework). This removes the usual supply-chain attack surface.
- **Self-contained exports.** SCORM packages inline fonts and assets; a delivered course
  makes no external calls of its own.

### Optional, author-initiated external touchpoints

- **Custom Google Font:** downloading a public font at authoring time (font only — no
  content is sent); the font is embedded so the course stays self-contained.
- **External media embeds** (Vimeo / YouTube / Web Embed): contacted at learner runtime
  when a course keeps such an embed. Use self-hosted / local media for air-gapped courses.

## Server mode (on-prem, in development)

The optional `server/` backend lets a small team work in the same master courses on an
**on-prem** server. It is a distinct posture with its own model; the deployment-facing
detail lives in [`server/README.md`](server/README.md). In brief:

- **On-prem only, never cloud.** One minimal self-hostable Node backend. It does storage +
  transport + auth + presence/locking **only** — it never renders (`render()` stays a pure
  client-side library), and it never serves the app or makes external network calls.
- **Sole writer, local disk.** The store is SQLite/WAL on **local disk**; the server
  process is the only writer (never SMB/NFS). SMB is for backups/exports only.
- **One identity boundary.** Every request resolves to `{principal, role}` or is rejected
  before any storage call runs. Roles are a fixed set `{admin, author, reviewer, viewer}`
  with a capability matrix; permission is decided independently of block locks.
- **Authentication ladder (per-deployment):** OIDC (Entra ID / AD FS) → IIS Integrated
  Windows Auth → built-in local accounts. Passwords are scrypt-hashed; OIDC tokens are
  validated server-side and exchanged for an `HttpOnly; Secure; SameSite` session cookie
  (the browser never holds raw IdP tokens). An always-on, hashed **break-glass local
  admin** prevents lock-out if the IdP is unreachable.
- **Guest review links** are signed (HMAC), revocable, and scoped to one file + a pinned
  snapshot, **view + comment only** — no account, no edit, no lock. The signing secret is
  **required from config** (the server refuses to start without it); there is no default.
- **Secrets from config only**, never in code. No external network calls / CDN loads.
- **Backups** are transactionally-consistent whole-store snapshots to a separate on-prem
  volume; restore is a documented, tested drill. Store migrations are forward-only.
- **Deployment `[UNKNOWN]` (flagged for IT):** behind IIS + ARR, both `wss://` and the
  long-poll endpoints must be proxied (ARR WebSocket proxying is off by default), and TLS +
  the service account / firewall are per-environment.

**Standalone is unaffected by any of this** — server mode is dormant unless a deployment
explicitly runs the backend; the `file://` app takes exactly the same code paths it does today.

## Supported versions

This project is developed on `main`. Security fixes are applied to the latest `main`.

## Scope

In scope: the application source in this repository. Out of scope: third-party LMS
platforms that host exported courses, and any downstream fork's own deployment/operational
controls.
