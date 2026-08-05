# Verso server — install and run

For the IT admin standing this up. You do not need to know the codebase. Everything below is
either a command to run or a decision to make, in order.

**Nothing in Verso's backend reaches the internet.** No telemetry, no crash reporting, no update
check, no external log sink. The only outbound connection the server ever makes is to your own
identity provider, and only if you configure OIDC. It is safe on an egress-restricted network.

---

## What you are installing

One Node process. It does storage, transport, authentication and presence — and nothing else. It
never renders a page: the app is static files your web server hosts, and all rendering happens in
the browser. That is why there is no application pool to tune and no template cache to clear.

| Piece | What it is |
|---|---|
| `server/index.js` | the backend, run as a Windows Service |
| `<DataDir>` | SQLite store, media, change log, backups — **local disk only** |
| IIS + ARR | TLS termination and reverse proxy to the backend |
| the static app | this repository's files, served by IIS |

## Before you start

- **Node 22.5 or newer.** Verso uses `node:sqlite`, which arrived in 22.5. The installer refuses
  older versions rather than failing later in a way that looks like a Verso bug.
- **IIS with URL Rewrite and Application Request Routing.** Both are Microsoft components.
- **A TLS certificate** for the hostname you will publish.
- **A local disk** with room for the store. Not a mapped drive, not a UNC path — see below.

### The one rule that is not negotiable

**The store must be on a local disk.** SQLite over SMB corrupts silently under oplocks: no error,
no warning, and the damage shows up later as a course that will not open. The installer refuses a
UNC path and the first-run screen refuses one too. Use a network share for **backups** if you
like — never for the live store.

---

## Install

Elevated PowerShell on the server:

```powershell
cd <repo>\server\install
.\install-windows.ps1 -DataDir D:\Verso\data
```

That registers the service, locks the data folder down to the service account, writes
`server\verso-server.config.json`, and writes a `web.config` with the reverse-proxy rules.

Then, by hand and deliberately:

1. **Point an IIS site at the repository folder** and bind your TLS certificate to it.
2. **Turn on BitLocker** for the volume holding the data folder. Verso does not encrypt at rest
   itself; the volume does, which is the posture your other services already have.
3. **Open the site.** You will land on first run.

### What first run asks you

Four steps, then done.

1. **Local admin account.** This is the break-glass account. It always works, even when your
   identity provider is down, and it is how you get back in when everything else fails. Keep the
   password somewhere your team can reach in an incident.
2. **Sign-in method.** Company sign-in (OIDC against Entra ID or AD FS) or local accounts only.
   The local admin works either way. If you choose OIDC you will need the issuer URL, a client
   ID and a client secret from your identity team.
3. **Data location.** The folder from the installer. It states what lives there and refuses a
   network path.
4. **Review**, then commit.

The first-run route **closes itself** once the first admin exists. It cannot be used again to
mint an administrator.

---

## Verify it worked

```
GET https://<host>/api/health          -> {"ok":true,...}      cheap; poll this from a load balancer
GET https://<host>/api/health?deep=1   -> adds readings + alerts; poll this from monitoring
```

The deep form reports free space on the store volume, the change-log size and how many block
locks are held, and evaluates them against thresholds. `level` is `ok`, `warning` or `critical`.
**`ok` goes false only on `critical`**, so a monitor that watches nothing but the boolean still
catches the conditions that stop writes — and a warning does not page anyone at 3am for a volume
that is 12% free.

| Alert | Means | Do |
|---|---|---|
| `disk` warning | store volume below 15% free | plan space |
| `disk` critical | below 5% free | **act now** — writes will start failing |
| `changeLog` warning | append log past 500k rows | schedule a compaction |
| `locks` warning | 200+ block locks held at once | locks are not releasing; check for stuck clients |

Thresholds are overridable in the config file under `thresholds`.

## Logs

One JSON object per line, in `<DataDir>\verso-server.log`. Three kinds:

- `error` — anything that went wrong
- `auth` — sign-in, failed sign-in, sign-out, first run
- `promotion` — a version promoted to live

**Passwords, tokens, cookies and authorization headers are never written**, by name, at the point
of writing. Point your existing collector at the file; nothing is pushed anywhere.

## Backups

`server/backup.js` takes transactionally-consistent snapshots with SQLite `VACUUM INTO` on three
triggers: nightly, before a promotion, and on demand. Restore is exercised as a test rather than
merely documented. Put the **backup destination** on a different volume — and a network share is
fine for backups, unlike the live store.

## Upgrades

Stop the service, replace the repository files, start it. Forward-only migrations run at start
and the running version is reported by `/api/health`, so you can always tell which artifact is
live. Take a backup first; the promotion path does that for you.

## If you cannot get in

Sign in with the break-glass local admin at the sign-in screen — the quiet
**Use the local admin account** link under the divider. It works even when the identity provider
is unreachable, and the account menu marks it visibly while it is in use so nobody forgets they
are on it.

Verso also refuses any change that would leave nobody able to manage users and server
configuration, so you cannot lock the organisation out by editing a role.

---

## Known unknowns, to confirm at deploy

Two things cannot be settled from a developer machine, and the go-live gate
(`platform-pivot-30`) carries both:

1. **Can this server reach your identity provider's endpoint?** Token validation happens on-prem,
   but the OIDC rung still has to reach the IdP. If that path is blocked, degrade down the ladder
   to IIS Integrated Windows Auth or local accounts.
2. **Does your IIS + ARR configuration proxy BOTH `wss://` and the long-poll fallback?** The
   `web.config` the installer writes enables both. Confirm both actually pass, because proxying
   only the long-poll leaves collaboration working but slow, with no error to explain it.
