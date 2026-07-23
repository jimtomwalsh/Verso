# Security Policy

## Reporting a vulnerability

Please report suspected security vulnerabilities **privately** — do not open a public
issue for them.

- Preferred: use GitHub's **private vulnerability reporting** (the "Report a
  vulnerability" button under this repository's **Security** tab).
- Alternatively, contact the maintainer privately. *(Maintainer: set a security contact
  address here before publishing.)*

Please include steps to reproduce, affected version/commit, and impact. We aim to
acknowledge reports within a reasonable time and will keep you updated on remediation.

## Security posture (what to know before assessing Verso)

Verso is a **self-hosted, offline, client-side application**, not a hosted SaaS. This
shapes its threat model:

- **No server / no backend / no cloud.** The app runs from a local file, a local static
  server, or an optional macOS WKWebView shell. There is no hosted component to attack and
  no account system.
- **Data stays local.** Course content lives in browser storage (`localStorage` /
  IndexedDB) or local files (File System Access API). Nothing is transmitted to the
  maintainer or any third party.
- **No telemetry / analytics / tracking**, and **no AI/ML** components (no data is sent to
  any AI service).
- **Zero third-party runtime dependencies.** Dependency-free vanilla JS (no `npm install`,
  no `node_modules`, no framework). This removes the usual supply-chain attack surface.
- **Self-contained exports.** SCORM packages inline fonts and assets; a delivered course
  makes no external calls of its own.

### Optional, author-initiated external touchpoints

- **Custom Google Font:** downloading a public font at authoring time (font only — no
  content is sent); the font is embedded so the course stays self-contained.
- **External media embeds** (Vimeo / YouTube / Web Embed): contacted at learner runtime
  when a course keeps such an embed. Use self-hosted / local media for air-gapped courses.

## Supported versions

This project is developed on `main`. Security fixes are applied to the latest `main`.

## Scope

In scope: the application source in this repository. Out of scope: third-party LMS
platforms that host exported courses, and any downstream fork's own deployment/operational
controls.
