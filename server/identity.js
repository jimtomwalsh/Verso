/*
 * server/identity.js -- the server-mode identity spine (platform-pivot 17/18/20,
 * Identity). SERVER-MODE ONLY; fully dormant in local mode (a single implicit owner).
 * Covers three tickets as one cohesive layer (the specs share the model):
 *   17 -- fixed global role set + capability matrix, sessions, a PLUGGABLE IdP-rung
 *         adapter interface, and the built-in local-accounts adapter.
 *   18 -- JIT provisioning at least privilege, first-ever-login bootstrap admin, and an
 *         always-on break-glass local admin (never-locked-out floor).
 *   20 -- guest identity = signed, revocable, link-scoped tokens (view+comment only),
 *         bypassing SSO entirely. This is the guest the Review-links epic pins to a snapshot.
 *
 * The Verso USER RECORD (not the IdP) is the source of truth for authorization. SSO
 * asserts identity only; Verso derives no authorization from IdP claims.
 *
 * Dependency-free: node:crypto (scrypt password hashing, hmac link signatures, random
 * session tokens) + node:sqlite. No external network. Never renders.
 */
"use strict";

var crypto = require("node:crypto");
var DatabaseSync = require("node:sqlite").DatabaseSync;

// ---- Role model (ticket 17, AMENDED by platform-pivot 37) ------------------
// Spec: verso-platform-pivot/specs/3-identity.spec.md -> "Role model (from 02, amended
// 2026-08-05)". That section is the single place the role model is defined; this file is
// reconciled TO it, not the reverse. Do not re-derive the argument from here.
//
// WHAT CHANGED AND WHY. This file used to hold `var ROLES = ["admin","author","reviewer",
// "viewer"]` and a hard-coded matrix. James settled the model the other way: future process
// gates need approver types Verso cannot name in advance, and each organisation should
// describe approval authority in its own vocabulary ("Technical Authority", not "admin").
// So the TITLES became data and the CAPABILITIES stayed code.
//
// THE CONSEQUENCE THAT MATTERS. Once a title is renameable, any guard that counts "admins"
// by name protects nothing -- rename the admin role and the never-locked-out floor
// evaporates silently. Every invariant below is therefore stated in capabilities.

// The fixed vocabulary, owned by the code. Admins compose roles from exactly this list and
// never invent entries; a future process gate adds a capability HERE, in a code change, and
// then becomes an admin's choice about who holds it.
var CAPABILITIES = ["view", "comment", "edit", "publish", "promote", "manageUsers", "serverConfig", "issueLinks"];

// The two capabilities that together make someone able to run the server. The floor is
// "at least one user holds BOTH", checked before any change that could take them away.
var FLOOR_CAPS = ["manageUsers", "serverConfig"];

// Seeded on a fresh server, holding exactly the capability sets this model previously fixed,
// so an untouched deployment behaves identically to the pre-amendment one. The NAMES carry no
// meaning to the code: renaming "Admin" to "Technical Authority" changes nothing but the label.
var SEED_ROLES = [
  { id: "role_admin",    name: "Admin",    capabilities: ["view", "comment", "edit", "publish", "promote", "manageUsers", "serverConfig", "issueLinks"] },
  { id: "role_author",   name: "Author",   capabilities: ["view", "comment", "edit", "publish", "issueLinks"] },
  { id: "role_reviewer", name: "Reviewer", capabilities: ["view", "comment"] },
  { id: "role_viewer",   name: "Viewer",   capabilities: ["view"] }
];
var DEFAULT_ROLE_ID = "role_viewer";   // least privilege for a just-in-time provisioned user
var BOOTSTRAP_ROLE_ID = "role_admin";  // the first-ever sign-in

// The legacy names, still what `principal.role` reports for a seeded role and what older
// call sites (sync.js / lock-manager.js edit gates, fixtures) pass around. Kept as a lookup
// so nothing that predates this ticket has to change to keep working.
var ROLES = SEED_ROLES.map(function (r) { return r.id.slice("role_".length); });
// capability -> the seeded roles that hold it, DERIVED from SEED_ROLES so the two can never
// drift apart. Guest is handled separately (link-scoped).
var CAPS = {};
CAPABILITIES.forEach(function (c) {
  CAPS[c] = {};
  SEED_ROLES.forEach(function (r) { if (r.capabilities.indexOf(c) >= 0) CAPS[c][r.id.slice("role_".length)] = 1; });
});
// The seeded-default lookup by NAME. Still exported, still correct for a deployment that has
// not composed its own roles -- but it is not the authorization path any more. A live decision
// reads the principal's resolved capabilities (principalCan below).
function can(role, capability) { var m = CAPS[capability]; return !!(m && m[role]); }
function isCapability(c) { return CAPABILITIES.indexOf(c) >= 0; }
// A role may hold view and optionally comment and still be safe to hand an unknown identity.
// Anything above that means reaching the server URL grants write access.
function isSafeDefault(caps) {
  return (caps || []).every(function (c) { return c === "view" || c === "comment"; });
}
// Guest (link) capabilities are fixed: view + comment within scope, nothing else.
function guestCan(capability) { return capability === "view" || capability === "comment"; }

// ---- password hashing (scrypt) --------------------------------------------
function hashPassword(pw) {
  var salt = crypto.randomBytes(16).toString("hex");
  var dk = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return salt + "$" + dk;
}
function verifyPassword(pw, stored) {
  if (!stored || stored.indexOf("$") < 0) return false;
  var parts = stored.split("$"), salt = parts[0], dk = parts[1];
  var got = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  // constant-time compare
  var a = Buffer.from(got, "hex"), b = Buffer.from(dk, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// base64url helpers for signed link tokens
function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlToBuf(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64"); }

function createIdentity(opts) {
  opts = opts || {};
  var now = opts.now || function () { return 0; };
  var sessionTtlMs = opts.sessionTtlMs != null ? opts.sessionTtlMs : 8 * 60 * 60 * 1000; // ~a workday
  var linkSecret = opts.linkSecret || "verso-dev-link-secret"; // real secret from the config FILE (server mode)
  var db = opts.db || new DatabaseSync(opts.dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT NOT NULL, pw_hash TEXT, break_glass INTEGER DEFAULT 0, created_at INTEGER);" +
    "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER);" +
    "CREATE TABLE IF NOT EXISTS review_links (id TEXT PRIMARY KEY, doc_id TEXT, version TEXT, checkpoint_id INTEGER, mode TEXT DEFAULT 'guest', display_name TEXT, revoked INTEGER DEFAULT 0, expires_at INTEGER, created_at INTEGER);"
  );
  // defensive migration for a store created before checkpoint_id/mode (ticket 22/24)
  try { db.exec("ALTER TABLE review_links ADD COLUMN checkpoint_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE review_links ADD COLUMN mode TEXT DEFAULT 'guest'"); } catch (e) {}

  // ---- roles as data (platform-pivot 37) -----------------------------------
  // ASSIGNMENT CARRIES A SCOPE FROM DAY ONE, and v1 only ever writes NULL. The column and
  // the resolution order exist now precisely so that per-product / per-document-type
  // approvers land later as a FEATURE rather than as a migration of live assignments. The
  // unique index uses IFNULL because SQLite lets NULL repeat inside a primary key, which
  // would let one user collect two global assignments and make resolution order a coin toss.
  db.exec(
    "CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, capabilities TEXT NOT NULL, created_at INTEGER);" +
    "CREATE TABLE IF NOT EXISTS role_assignments (user_id TEXT NOT NULL, role_id TEXT NOT NULL, scope TEXT, created_at INTEGER);" +
    "CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_one_per_scope ON role_assignments (user_id, IFNULL(scope, ''));" +
    "CREATE TABLE IF NOT EXISTS identity_settings (key TEXT PRIMARY KEY, value TEXT);"
  );
  var qAllRoles      = db.prepare("SELECT * FROM roles ORDER BY created_at, id");
  var qGetRole       = db.prepare("SELECT * FROM roles WHERE id = ?");
  var qInsRole       = db.prepare("INSERT INTO roles (id, name, capabilities, created_at) VALUES (?, ?, ?, ?)");
  var qUpdRole       = db.prepare("UPDATE roles SET name = ?, capabilities = ? WHERE id = ?");
  var qDelRole       = db.prepare("DELETE FROM roles WHERE id = ?");
  var qAssignments   = db.prepare("SELECT * FROM role_assignments WHERE user_id = ?");
  var qHoldersOf     = db.prepare("SELECT DISTINCT user_id FROM role_assignments WHERE role_id = ?");
  var qClearGlobal   = db.prepare("DELETE FROM role_assignments WHERE user_id = ? AND scope IS NULL");
  var qInsAssign     = db.prepare("INSERT INTO role_assignments (user_id, role_id, scope, created_at) VALUES (?, ?, ?, ?)");
  var qDelAssignsFor = db.prepare("DELETE FROM role_assignments WHERE user_id = ?");
  var qAllUsers      = db.prepare("SELECT * FROM users ORDER BY created_at, id");
  var qDelUser       = db.prepare("DELETE FROM users WHERE id = ?");
  var qDelSessionsFor= db.prepare("DELETE FROM sessions WHERE user_id = ?");
  var qGetSetting    = db.prepare("SELECT value FROM identity_settings WHERE key = ?");
  var qPutSetting    = db.prepare("INSERT INTO identity_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

  function roleRow(r) { return r ? { id: r.id, name: r.name, capabilities: JSON.parse(r.capabilities) } : null; }
  function allRoles() { return qAllRoles.all().map(roleRow); }

  // Seed once, on a store that has no roles yet. Also backfills assignments from the legacy
  // users.role column, so a server that ran the pre-amendment build keeps every user exactly
  // where it was rather than silently dropping everyone to no role at all.
  (function seedRoles() {
    if (qAllRoles.all().length === 0) {
      SEED_ROLES.forEach(function (r) { qInsRole.run(r.id, r.name, JSON.stringify(r.capabilities), now()); });
    }
    qAllUsers.all().forEach(function (u) {
      if (qAssignments.all(u.id).length) return;
      var legacy = "role_" + String(u.role || "viewer");
      var target = qGetRole.get(legacy) ? legacy : DEFAULT_ROLE_ID;
      qInsAssign.run(u.id, target, null, now());
    });
  })();

  function defaultRoleId() {
    var row = qGetSetting.get("defaultRoleId");
    var id = row && row.value;
    return (id && qGetRole.get(id)) ? id : DEFAULT_ROLE_ID;
  }

  // Resolution order, stated once: the assignment whose scope matches what is being acted on,
  // else the one whose scope is NULL. v1 writes only NULL, so in practice every request lands
  // on the global assignment -- but the order is real and tested, which is what makes scoped
  // approvers addable without touching stored data.
  function assignmentFor(userId, scope) {
    var rows = qAssignments.all(userId);
    var scoped = null, global = null;
    rows.forEach(function (r) {
      if (r.scope == null) global = r;
      else if (scope && r.scope === scope) scoped = r;
    });
    return scoped || global || null;
  }
  function roleOfUser(userId, scope) {
    var a = assignmentFor(userId, scope);
    return a ? roleRow(qGetRole.get(a.role_id)) : null;
  }
  function capabilitiesOf(userId, scope) {
    var r = roleOfUser(userId, scope);
    return r ? r.capabilities.slice() : [];
  }
  // The name reported to the UI and to older name-based call sites. A user whose role was
  // deleted out from under them reports null rather than a stale title.
  function roleNameOf(userId) { var r = roleOfUser(userId, null); return r ? r.name : null; }

  // ---- the never-locked-out floor, in capabilities -------------------------
  // Every user who holds manageUsers AND serverConfig, under a hypothetical world where one
  // role's capabilities, one user's role, or one user's existence is different. Passing the
  // change in as an override is what lets each guarded path ask "would this strand us?"
  // BEFORE writing, so a refusal changes nothing at all.
  function floorHolders(override) {
    override = override || {};
    var roleCaps = {};
    allRoles().forEach(function (r) { roleCaps[r.id] = r.capabilities; });
    if (override.roleId) {
      if (override.deleteRole) delete roleCaps[override.roleId];
      else if (override.capabilities) roleCaps[override.roleId] = override.capabilities;
    }
    var holders = [];
    qAllUsers.all().forEach(function (u) {
      if (override.removeUserId === u.id) return;
      var roleId;
      if (override.assignUserId === u.id) roleId = override.assignRoleId;
      else { var a = assignmentFor(u.id, null); roleId = a && a.role_id; }
      var caps = roleCaps[roleId] || [];
      if (FLOOR_CAPS.every(function (c) { return caps.indexOf(c) >= 0; })) holders.push(u.id);
    });
    return holders;
  }
  // The refusal text is capability-first on purpose. The prototype named "the admin role";
  // once titles are renameable that sentence can be false, so the invariant is described by
  // what it protects rather than by what anyone is currently called.
  var FLOOR_REFUSAL = "at least one person must be able to manage users and server configuration";
  function floorGuard(override) {
    return floorHolders(override).length > 0 ? null : { ok: false, error: FLOOR_REFUSAL, invariant: "lastCapabilityHolder", capabilities: FLOOR_CAPS.slice() };
  }

  // ---- composition guardrails: warnings, never blocks -----------------------
  // Computed on the server and returned with the role, so pp-21 renders a decision it did not
  // have to infer. Both are advisory: an admin may well mean it.
  function warningsFor(role, everyRole) {
    var out = [];
    if (!role.capabilities.length) out.push({ code: "empty", message: "This role can't do anything yet — no one assigned it will be able to view, edit, or comment." });
    if (role.capabilities.indexOf("serverConfig") >= 0) {
      var others = (everyRole || allRoles()).filter(function (r) { return r.id !== role.id && r.capabilities.indexOf("serverConfig") >= 0; });
      if (others.length) out.push({ code: "serverConfigSpread", message: "Server configuration is on for this role. Most organisations keep this for one role only — everyone with it can change sign-in settings for the whole server." });
    }
    return out;
  }

  function actorCan(actor, capability) {
    if (!actor) return false;
    if (actor.kind === "guest") return false;
    if (Array.isArray(actor.capabilities)) return actor.capabilities.indexOf(capability) >= 0;
    if (actor.principal && qGetUserById.get(actor.principal)) return capabilitiesOf(actor.principal, null).indexOf(capability) >= 0;
    return can(actor.role, capability); // an owner/local principal, or a name-only test actor
  }

  function normaliseCaps(caps) {
    if (!Array.isArray(caps)) return { error: "capabilities must be a list" };
    var seen = {}, out = [];
    for (var i = 0; i < caps.length; i++) {
      var c = caps[i];
      if (!isCapability(c)) return { error: "unknown capability: " + String(c) };
      if (!seen[c]) { seen[c] = 1; out.push(c); }
    }
    return { caps: out };
  }
  function roleId() { return "role_" + crypto.randomBytes(6).toString("hex"); }

  function listRoles(actor) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    var every = allRoles();
    var dflt = defaultRoleId();
    return {
      ok: true, capabilities: CAPABILITIES.slice(), defaultRoleId: dflt,
      roles: every.map(function (r) {
        return { id: r.id, name: r.name, capabilities: r.capabilities, holders: qHoldersOf.all(r.id).length,
                 isDefault: r.id === dflt, warnings: warningsFor(r, every) };
      })
    };
  }
  function createRole(actor, spec) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    var name = String((spec && spec.name) || "").trim();
    if (!name) return { ok: false, error: "a role needs a name" };
    var n = normaliseCaps((spec && spec.capabilities) || []);
    if (n.error) return { ok: false, error: n.error };
    var id = roleId();
    qInsRole.run(id, name, JSON.stringify(n.caps), now());
    var role = roleRow(qGetRole.get(id));
    return { ok: true, role: role, warnings: warningsFor(role, allRoles()) };
  }
  // A rename must not be a permissions change, so name and capabilities are independent
  // fields here: passing only `name` leaves the capability list untouched, byte for byte.
  function updateRole(actor, id, patch) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    var row = qGetRole.get(id);
    if (!row) return { ok: false, error: "unknown role" };
    var current = roleRow(row);
    var name = (patch && patch.name != null) ? String(patch.name).trim() : current.name;
    if (!name) return { ok: false, error: "a role needs a name" };
    var caps = current.capabilities;
    if (patch && patch.capabilities != null) {
      var n = normaliseCaps(patch.capabilities);
      if (n.error) return { ok: false, error: n.error };
      caps = n.caps;
      var guard = floorGuard({ roleId: id, capabilities: caps });
      if (guard) return guard;
      if (id === defaultRoleId() && !isSafeDefault(caps)) {
        return { ok: false, error: "the default role for new people may only view and comment" };
      }
    }
    qUpdRole.run(name, JSON.stringify(caps), id);
    var role = roleRow(qGetRole.get(id));
    return { ok: true, role: role, warnings: warningsFor(role, allRoles()) };
  }
  function deleteRole(actor, id) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    if (!qGetRole.get(id)) return { ok: false, error: "unknown role" };
    if (id === defaultRoleId()) return { ok: false, error: "the default role for new people cannot be deleted" };
    var holders = qHoldersOf.all(id);
    if (holders.length) return { ok: false, error: "this role still has " + holders.length + " " + (holders.length === 1 ? "person" : "people") + " in it", holders: holders.length };
    var guard = floorGuard({ roleId: id, deleteRole: true });
    if (guard) return guard;
    qDelRole.run(id);
    return { ok: true, roleId: id };
  }
  // v1 writes scope NULL and nothing else; the parameter exists so the resolution order is
  // exercisable and so the later scoped-approver feature has somewhere to land.
  function assignRole(actor, userId, targetRoleId, scope) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    if (!qGetUserById.get(userId)) return { ok: false, error: "unknown user" };
    if (!qGetRole.get(targetRoleId)) return { ok: false, error: "unknown role" };
    if (scope == null) {
      var guard = floorGuard({ assignUserId: userId, assignRoleId: targetRoleId });
      if (guard) return guard;
      qClearGlobal.run(userId);
      qInsAssign.run(userId, targetRoleId, null, now());
    } else {
      qInsAssign.run(userId, targetRoleId, String(scope), now());
    }
    return { ok: true, userId: userId, roleId: targetRoleId, scope: scope == null ? null : String(scope), role: roleNameOf(userId) };
  }
  // Removing a person takes their assignments and sessions with them, so a deleted user
  // cannot keep working off a live cookie.
  function removeUser(actor, userId) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    var u = qGetUserById.get(userId);
    if (!u) return { ok: false, error: "unknown user" };
    var guard = floorGuard({ removeUserId: userId });
    if (guard) return guard;
    qDelAssignsFor.run(userId); qDelSessionsFor.run(userId); qDelUser.run(userId);
    return { ok: true, userId: userId };
  }
  function setDefaultRole(actor, id) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    var row = qGetRole.get(id);
    if (!row) return { ok: false, error: "unknown role" };
    if (!isSafeDefault(roleRow(row).capabilities)) {
      return { ok: false, error: "the default role for new people may only view and comment", capability: "edit" };
    }
    qPutSetting.run("defaultRoleId", id);
    return { ok: true, defaultRoleId: id };
  }
  function listUsers(actor) {
    if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
    return {
      ok: true, users: qAllUsers.all().map(function (u) {
        var a = assignmentFor(u.id, null);
        var r = a ? roleRow(qGetRole.get(a.role_id)) : null;
        return { id: u.id, email: u.email, name: u.name, roleId: r && r.id, role: r && r.name, breakGlass: !!u.break_glass };
      })
    };
  }
  var qGetUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  var qGetUserById    = db.prepare("SELECT * FROM users WHERE id = ?");
  var qInsUser        = db.prepare("INSERT INTO users (id, email, name, role, pw_hash, break_glass, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  var qSetRole        = db.prepare("UPDATE users SET role = ? WHERE id = ?");
  var qCountUsers     = db.prepare("SELECT COUNT(*) AS n FROM users WHERE break_glass = 0");
  var qInsSession     = db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)");
  var qGetSession     = db.prepare("SELECT * FROM sessions WHERE token = ?");
  var qDelSession     = db.prepare("DELETE FROM sessions WHERE token = ?");
  var qInsLink        = db.prepare("INSERT INTO review_links (id, doc_id, version, checkpoint_id, mode, display_name, revoked, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)");
  var qGetLink        = db.prepare("SELECT * FROM review_links WHERE id = ?");
  var qRevokeLink     = db.prepare("UPDATE review_links SET revoked = 1 WHERE id = ?");
  var qLinksForDoc    = db.prepare("SELECT id, doc_id, version, checkpoint_id, mode, display_name, revoked, expires_at, created_at FROM review_links WHERE doc_id = ? ORDER BY created_at DESC");

  function uid() { return "u_" + crypto.randomBytes(8).toString("hex"); }

  // JIT provisioning (ticket 18): find the user record for an identity, or create it.
  // First-ever real user -> bootstrap ADMIN; every later unknown identity -> VIEWER.
  function findOrCreateUser(email, name) {
    var u = qGetUserByEmail.get(email);
    if (u) return u;
    var first = (qCountUsers.get().n === 0);
    // Which ROLE they land in is data now; the legacy users.role column keeps the seeded
    // name so an older reader of this store still sees something sensible.
    var targetRole = first ? BOOTSTRAP_ROLE_ID : defaultRoleId();
    var id = uid();
    qInsUser.run(id, email, name || email, legacyNameFor(targetRole), null, 0, now());
    qInsAssign.run(id, targetRole, null, now());
    return qGetUserById.get(id);
  }
  // The legacy users.role column is a lowercase seeded name where one applies, and the role
  // id otherwise. Nothing authorizes off it -- assignments do -- but it is what a pre-37
  // reader of this database expects to find, and what the backfill above reads.
  function legacyNameFor(id) { return /^role_(admin|author|reviewer|viewer)$/.test(id) ? id.slice("role_".length) : id; }

  // Register a local-accounts user (also used to seed the break-glass admin).
  // `role` is still accepted as a seeded NAME ("author") so every existing caller -- fixtures,
  // first-run, the tests -- keeps working unchanged. It may equally be a role id.
  function registerLocalAccount(email, name, password, role, breakGlass) {
    var existing = qGetUserByEmail.get(email);
    if (existing) return existing;
    // Explicit role wins; else a break-glass or the first-ever account is admin, others the default.
    var first = (qCountUsers.get().n === 0);
    var target = role ? resolveRoleId(role) : ((breakGlass || first) ? BOOTSTRAP_ROLE_ID : defaultRoleId());
    if (!target) return null;
    var id = uid();
    qInsUser.run(id, email, name || email, legacyNameFor(target), hashPassword(password), breakGlass ? 1 : 0, now());
    qInsAssign.run(id, target, null, now());
    return qGetUserById.get(id);
  }
  // A role reference from an older caller: an id, a seeded lowercase name, or a live role's
  // name as an admin renamed it. Exact id first, so a rename can never shadow one.
  function resolveRoleId(ref) {
    if (!ref) return null;
    if (qGetRole.get(ref)) return ref;
    if (qGetRole.get("role_" + ref)) return "role_" + ref;
    var lowered = String(ref).toLowerCase(), hit = null;
    allRoles().forEach(function (r) { if (!hit && r.name.toLowerCase() === lowered) hit = r.id; });
    return hit;
  }

  // The always-on break-glass local admin (ticket 18): created at first-run, hashed
  // on-prem, persists even when SSO is configured -> the never-locked-out floor.
  // `name` is what first run collected. It used to be hard-coded to "Break-glass admin", which
  // meant the wizard asked an admin for their name and then threw it away -- and the account menu
  // greeted them as "Break-glass admin" forever. The account is still MARKED break-glass by its
  // flag; that was never the name's job.
  function ensureBreakGlass(email, password, name) {
    var u = qGetUserByEmail.get(email);
    if (u) return u;
    var id = uid();
    qInsUser.run(id, email, name || "Break-glass admin", legacyNameFor(BOOTSTRAP_ROLE_ID), hashPassword(password), 1, now());
    qInsAssign.run(id, BOOTSTRAP_ROLE_ID, null, now());
    return qGetUserById.get(id);
  }

  // ---- IdP-rung adapter interface (ticket 17) ------------------------------
  // An adapter is { name, authenticate(credentials) -> { email, name } | null }. The
  // built-in local-accounts adapter checks the hashed password. OIDC/IWA adapters (ticket
  // 19) satisfy the SAME interface and plug in per-deployment -- no build-time fork.
  var localAccountsAdapter = {
    name: "local",
    authenticate: function (creds) {
      var u = qGetUserByEmail.get((creds && creds.email) || "");
      if (!u || !u.pw_hash) return null;
      return verifyPassword(creds.password, u.pw_hash) ? { email: u.email, name: u.name } : null;
    }
  };

  // login: run the chosen adapter, JIT-provision, mint a session. The break-glass account
  // ALWAYS works via the local adapter even if the SSO adapter throws / is unreachable.
  function login(adapter, credentials) {
    var idp = null;
    try { idp = adapter ? adapter.authenticate(credentials) : null; }
    catch (e) { idp = null; } // IdP outage -> fall through; break-glass still works below
    if (!idp && adapter && adapter.name !== "local") {
      // SSO failed/outage -> allow the break-glass (local) path as the floor
      idp = localAccountsAdapter.authenticate(credentials);
    }
    if (!idp && (!adapter || adapter.name === "local")) idp = localAccountsAdapter.authenticate(credentials);
    if (!idp) return null;
    var user = findOrCreateUser(idp.email, idp.name);
    return { token: createSession(user.id), user: publicUser(user) };
  }

  function createSession(userId) {
    var token = crypto.randomBytes(32).toString("hex");
    qInsSession.run(token, userId, now() + sessionTtlMs);
    return token;
  }
  // Resolve a session cookie to { principal, role } or null (expired/unknown -> null).
  // A resolved principal carries its CAPABILITIES, not just a title. That is what makes a
  // rename safe: every downstream decision reads the list, and `role` is left as the display
  // name for the account menu and for older name-based gates.
  function resolveSession(token) {
    var s = token && qGetSession.get(token);
    if (!s) return null;
    if (s.expires_at <= now()) { qDelSession.run(token); return null; }
    var u = qGetUserById.get(s.user_id);
    if (!u) return null;
    var r = roleOfUser(u.id, null);
    return {
      principal: u.id, email: u.email, name: u.name, kind: "user",
      role: r ? r.name : null, roleId: r ? r.id : null,
      capabilities: r ? r.capabilities.slice() : [],
      breakGlass: !!u.break_glass
    };
  }
  function signOut(token) { qDelSession.run(token); }

  // Admin assigns roles (ticket 18 elevate/demote). Capability-checked. Kept on its original
  // signature -- a seeded name still works -- and now routed through assignRole so the
  // never-locked-out floor guards it too.
  function setRole(actor, userId, role) {
    var target = resolveRoleId(role);
    if (!target) {
      // Answer "not permitted" before "unknown role" so an unprivileged caller learns nothing
      // about which roles exist.
      if (!actorCan(actor, "manageUsers")) return { ok: false, error: "not permitted" };
      return { ok: false, error: "unknown role" };
    }
    var res = assignRole(actor, userId, target, null);
    if (res.ok) qSetRole.run(legacyNameFor(target), userId); // keep the legacy column in step
    return res;
  }

  // ---- Guest review-link tokens (ticket 20) --------------------------------
  // Issue a signed, revocable, link-scoped token: view+comment on ONE file+version, no
  // account/IdP/provisioning. issued by an edit-capable role (issueLinks capability).
  // scope: { docId, version?, checkpointId? (pinned snapshot, ticket 22), displayName?,
  //          mode? ('guest'|'sso', ticket 24), expiresAt? }. One link = one snapshot; a
  // link never silently advances -- refreshing a review shares a NEW link (24).
  function issueLink(actor, scope) {
    if (!actorCan(actor, "issueLinks")) return { ok: false, error: "not permitted" };
    var id = "lnk_" + crypto.randomBytes(10).toString("hex");
    var exp = scope.expiresAt != null ? scope.expiresAt : now() + 7 * 24 * 60 * 60 * 1000;
    var mode = scope.mode === "sso" ? "sso" : "guest";
    var cp = scope.checkpointId != null ? scope.checkpointId : null;
    // A guest-mode link MUST pin a checkpoint so the reviewer reads a frozen snapshot, never
    // live churn, and the link never silently advances (22/24). SSO-mode links resolve a
    // real user through OIDC, so they don't require a pin.
    if (mode === "guest" && cp == null) return { ok: false, error: "a guest review link must pin a checkpoint (snapshot)" };
    qInsLink.run(id, scope.docId, scope.version || "", cp, mode, scope.displayName || "Guest", exp, now());
    var payload = { linkId: id, docId: scope.docId, version: scope.version || "", cp: cp, mode: mode, name: scope.displayName || "Guest", exp: exp };
    var body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    var sig = b64url(crypto.createHmac("sha256", linkSecret).update(body).digest());
    return { ok: true, linkId: id, token: body + "." + sig, mode: mode, scope: payload };
  }
  // Authorize a guest token -> { principal:'guest', role:'guest', scope, caps } | null.
  // Rejects a bad signature, an expired token, or a revoked link. An 'sso'-mode link is
  // NOT authorized as a guest here -- the reviewer must go through the OIDC path (24).
  function authorizeGuest(token) {
    if (!token || token.indexOf(".") < 0) return null;
    var parts = token.split("."), body = parts[0], sig = parts[1];
    var expect = b64url(crypto.createHmac("sha256", linkSecret).update(body).digest());
    var a = Buffer.from(sig || ""), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // bad signature
    var payload; try { payload = JSON.parse(b64urlToBuf(body).toString("utf8")); } catch (e) { return null; }
    if (payload.exp && payload.exp <= now()) return null; // expired
    var link = qGetLink.get(payload.linkId);
    if (!link || link.revoked) return null; // revoked / unknown
    if (link.mode === "sso") return null;    // sso-gated link -> not a guest path (24)
    return { principal: "guest:" + payload.linkId, kind: "guest", role: "guest", name: payload.name, scope: { docId: payload.docId, version: payload.version, checkpointId: payload.cp } };
  }
  function revokeLink(actor, linkId) {
    if (!actorCan(actor, "issueLinks")) return { ok: false, error: "not permitted" };
    qRevokeLink.run(linkId);
    return { ok: true, linkId: linkId };
  }
  // Admin/author link-audit list for a course (ticket 24): target snapshot, mode, expiry,
  // display name, revoked. Live = not revoked + not expired.
  function listLinks(actor, docId) {
    if (!actorCan(actor, "issueLinks")) return { ok: false, error: "not permitted" };
    var t = now();
    return {
      ok: true, links: qLinksForDoc.all(docId).map(function (l) {
        return { linkId: l.id, docId: l.doc_id, checkpointId: l.checkpoint_id, mode: l.mode, displayName: l.display_name, expiresAt: l.expires_at, revoked: !!l.revoked, live: !l.revoked && (!l.expires_at || l.expires_at > t) };
      })
    };
  }
  // Does this resolved principal (user OR guest) hold a capability, honouring guest scope?
  // A guest is ALWAYS bounded to its link's file: it may only view/comment, and only on a
  // route that carries a matching doc scope -- any unscoped or cross-file route is DENIED
  // (default-deny), so a guest token can never read the server-wide registry/kv/media.
  function principalCan(principal, capability, scope) {
    if (!principal) return false;
    if (principal.kind === "guest") {
      if (!guestCan(capability)) return false;
      return !!(scope && scope.docId && principal.scope && principal.scope.docId === scope.docId);
    }
    // Capabilities first: a renamed role must decide exactly as it did before the rename.
    if (Array.isArray(principal.capabilities)) return principal.capabilities.indexOf(capability) >= 0;
    // A principal minted outside this module -- the local-mode owner, or a name-only test
    // actor -- still resolves against the seeded matrix.
    return can(principal.role, capability);
  }

  function publicUser(u) {
    var r = roleOfUser(u.id, null);
    return { id: u.id, email: u.email, name: u.name, role: r ? r.name : null, roleId: r ? r.id : null, capabilities: r ? r.capabilities.slice() : [] };
  }

  return {
    // roles + caps
    ROLES: ROLES, can: can, guestCan: guestCan, principalCan: principalCan,
    // composable roles (platform-pivot 37)
    CAPABILITIES: CAPABILITIES.slice(),
    listRoles: listRoles, createRole: createRole, updateRole: updateRole, deleteRole: deleteRole,
    assignRole: assignRole, removeUser: removeUser, listUsers: listUsers,
    setDefaultRole: setDefaultRole, defaultRoleId: defaultRoleId,
    capabilitiesOf: capabilitiesOf, roleOfUser: roleOfUser, roleNameOf: roleNameOf,
    floorHolders: floorHolders,
    // users + provisioning
    findOrCreateUser: findOrCreateUser, registerLocalAccount: registerLocalAccount,
    ensureBreakGlass: ensureBreakGlass, setRole: setRole, getUser: function (id) { var u = qGetUserById.get(id); return u ? publicUser(u) : null; },
    // adapters + sessions
    localAccountsAdapter: localAccountsAdapter, login: login,
    createSession: createSession, resolveSession: resolveSession, signOut: signOut,
    // guest links + review-link management (24)
    issueLink: issueLink, authorizeGuest: authorizeGuest, revokeLink: revokeLink, listLinks: listLinks,
    close: function () { if (!opts.db) db.close(); }, _db: db
  };
}

module.exports = {
  createIdentity: createIdentity, ROLES: ROLES, CAPS: CAPS, can: can,
  // platform-pivot 37: the fixed vocabulary, the seeded defaults, and the floor the
  // never-locked-out invariant is stated in. All three are code, not data.
  CAPABILITIES: CAPABILITIES, SEED_ROLES: SEED_ROLES, FLOOR_CAPS: FLOOR_CAPS,
  DEFAULT_ROLE_ID: DEFAULT_ROLE_ID, BOOTSTRAP_ROLE_ID: BOOTSTRAP_ROLE_ID,
  isCapability: isCapability, isSafeDefault: isSafeDefault,
  hashPassword: hashPassword, verifyPassword: verifyPassword
};
