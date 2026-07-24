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

// ---- Role model + capability matrix (ticket 17; the ONE definition) --------
var ROLES = ["admin", "author", "reviewer", "viewer"];
// capability -> the set of roles that hold it (guest handled separately, link-scoped).
var CAPS = {
  view:          { admin: 1, author: 1, reviewer: 1, viewer: 1 },
  comment:       { admin: 1, author: 1, reviewer: 1 },
  edit:          { admin: 1, author: 1 },   // edit blocks / acquire a block lock
  publish:       { admin: 1, author: 1 },   // publish / export SCORM
  promote:       { admin: 1 },              // staging -> prod
  manageUsers:   { admin: 1 },              // assign roles
  serverConfig:  { admin: 1 },              // backup/restore/config
  issueLinks:    { admin: 1, author: 1 }    // issue/revoke review links
};
function can(role, capability) { var m = CAPS[capability]; return !!(m && m[role]); }
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
    var role = first ? "admin" : "viewer";
    var id = uid();
    qInsUser.run(id, email, name || email, role, null, 0, now());
    return qGetUserById.get(id);
  }

  // Register a local-accounts user (also used to seed the break-glass admin).
  function registerLocalAccount(email, name, password, role, breakGlass) {
    var existing = qGetUserByEmail.get(email);
    if (existing) return existing;
    var first = (qCountUsers.get().n === 0);
    var r = role || (first && !breakGlass ? "admin" : (breakGlass ? "admin" : "viewer"));
    var id = uid();
    qInsUser.run(id, email, name || email, r, hashPassword(password), breakGlass ? 1 : 0, now());
    return qGetUserById.get(id);
  }

  // The always-on break-glass local admin (ticket 18): created at first-run, hashed
  // on-prem, persists even when SSO is configured -> the never-locked-out floor.
  function ensureBreakGlass(email, password) {
    var u = qGetUserByEmail.get(email);
    if (u) return u;
    var id = uid();
    qInsUser.run(id, email, "Break-glass admin", "admin", hashPassword(password), 1, now());
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
  function resolveSession(token) {
    var s = token && qGetSession.get(token);
    if (!s) return null;
    if (s.expires_at <= now()) { qDelSession.run(token); return null; }
    var u = qGetUserById.get(s.user_id);
    if (!u) return null;
    return { principal: u.id, email: u.email, name: u.name, role: u.role, kind: "user" };
  }
  function signOut(token) { qDelSession.run(token); }

  // Admin assigns roles (ticket 18 elevate/demote). Capability-checked.
  function setRole(actor, userId, role) {
    if (!actor || !can(actor.role, "manageUsers")) return { ok: false, error: "not permitted" };
    if (ROLES.indexOf(role) < 0) return { ok: false, error: "unknown role" };
    qSetRole.run(role, userId);
    return { ok: true, userId: userId, role: role };
  }

  // ---- Guest review-link tokens (ticket 20) --------------------------------
  // Issue a signed, revocable, link-scoped token: view+comment on ONE file+version, no
  // account/IdP/provisioning. issued by an edit-capable role (issueLinks capability).
  // scope: { docId, version?, checkpointId? (pinned snapshot, ticket 22), displayName?,
  //          mode? ('guest'|'sso', ticket 24), expiresAt? }. One link = one snapshot; a
  // link never silently advances -- refreshing a review shares a NEW link (24).
  function issueLink(actor, scope) {
    if (!actor || !can(actor.role, "issueLinks")) return { ok: false, error: "not permitted" };
    var id = "lnk_" + crypto.randomBytes(10).toString("hex");
    var exp = scope.expiresAt != null ? scope.expiresAt : now() + 7 * 24 * 60 * 60 * 1000;
    var mode = scope.mode === "sso" ? "sso" : "guest";
    var cp = scope.checkpointId != null ? scope.checkpointId : null;
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
    if (!actor || !can(actor.role, "issueLinks")) return { ok: false, error: "not permitted" };
    qRevokeLink.run(linkId);
    return { ok: true, linkId: linkId };
  }
  // Admin/author link-audit list for a course (ticket 24): target snapshot, mode, expiry,
  // display name, revoked. Live = not revoked + not expired.
  function listLinks(actor, docId) {
    if (!actor || !can(actor.role, "issueLinks")) return { ok: false, error: "not permitted" };
    var t = now();
    return {
      ok: true, links: qLinksForDoc.all(docId).map(function (l) {
        return { linkId: l.id, docId: l.doc_id, checkpointId: l.checkpoint_id, mode: l.mode, displayName: l.display_name, expiresAt: l.expires_at, revoked: !!l.revoked, live: !l.revoked && (!l.expires_at || l.expires_at > t) };
      })
    };
  }
  // Does this resolved principal (user OR guest) hold a capability, honouring guest scope?
  function principalCan(principal, capability, scope) {
    if (!principal) return false;
    if (principal.kind === "guest") {
      if (!guestCan(capability)) return false;
      if (scope && principal.scope) return principal.scope.docId === scope.docId; // scoped to one file
      return true;
    }
    return can(principal.role, capability);
  }

  function publicUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role }; }

  return {
    // roles + caps
    ROLES: ROLES, can: can, guestCan: guestCan, principalCan: principalCan,
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
  hashPassword: hashPassword, verifyPassword: verifyPassword
};
