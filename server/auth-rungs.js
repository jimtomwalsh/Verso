/*
 * server/auth-rungs.js -- the corporate authentication rungs (platform-pivot 19, Identity).
 * SERVER-MODE ONLY; never loaded, never reachable in local mode (Law 4).
 *
 * Spec: verso-platform-pivot/specs/3-identity.spec.md -> "Authentication ladder". The ladder,
 * in preference order and chosen PER DEPLOYMENT rather than per build:
 *
 *   1. OIDC auth-code flow against Entra ID or AD FS   <- this file, the everyday path
 *   2. IIS Integrated Windows Auth (identity IIS -> Node)  <- this file, AD-only shops
 *   3. Built-in local accounts (hashed, on-prem)       <- identity.js, the always-works floor
 *
 * ONE CODE PATH FOR ENTRA AND AD FS. Both publish an OIDC discovery document, so the only
 * thing that differs between them is three config values (issuer, client id, client secret).
 * There is no Entra branch and no AD FS branch here, and there must never be one: the moment
 * the two diverge, only whichever a developer can reach gets tested.
 *
 * SSO PROVES IDENTITY, NOTHING ELSE. Nothing in this file reads a groups claim, a roles claim
 * or an app-role assignment. Verso owns authorization (identity.js), so a deployment does not
 * wait on IT configuring directory groups, and a change in the directory cannot silently
 * change who can publish. The adapters return { email, name } and stop there.
 *
 * VALIDATION HAPPENS ON-PREM. The id_token's signature is checked here against the IdP's
 * published JWKS, along with issuer, audience, expiry and the nonce this server minted. Only
 * the IdP's own endpoints are remote; no session decision leaves the server boundary.
 *
 * Dependency-free: node:crypto for the RSA verify (a JWK converts straight to a KeyObject)
 * and the global fetch for the three IdP endpoints. Every one of those is INJECTABLE, which
 * is what lets tests/run.js drive a complete auth-code round trip -- discovery, redirect,
 * code exchange, signature verification, claim checks and every failure mode -- against a
 * locally generated keypair, with no live tenant and no network. The live-IdP check is the
 * deploy-time [UNKNOWN] that platform-pivot-30 carries.
 */
"use strict";

var crypto = require("node:crypto");

// ---- small helpers (pure) --------------------------------------------------
function b64urlToBuf(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function b64urlJson(s) {
  try { return JSON.parse(b64urlToBuf(s).toString("utf8")); } catch (e) { return null; }
}
function randomToken(n) { return crypto.randomBytes(n || 24).toString("hex"); }
function form(params) {
  return Object.keys(params).filter(function (k) { return params[k] != null; })
    .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
}
// Build the authorization redirect. PURE: config + the values this server minted -> a URL.
// Kept separate from the network so the shape of the redirect is testable on its own.
function authorizeUrl(endpoint, cfg, state, nonce, redirectUri) {
  return endpoint + (endpoint.indexOf("?") >= 0 ? "&" : "?") + form({
    client_id: cfg.clientId,
    response_type: "code",
    response_mode: "query",
    redirect_uri: redirectUri,
    scope: cfg.scope || "openid profile email",
    state: state,
    nonce: nonce
  });
}

// The claim Verso treats as the identity. Entra and AD FS disagree about which one is
// populated, so the order is deliberate: `email` when the tenant publishes it, then the two
// spellings of a Windows account name. `sub` is NOT used -- it is opaque and per-client, so
// the same person arriving through a second registration would become a second Verso user.
function identityFromClaims(claims) {
  if (!claims) return null;
  var email = claims.email || claims.preferred_username || claims.upn || null;
  if (!email) return null;
  return { email: String(email).toLowerCase(), name: claims.name || claims.given_name || String(email) };
}

// ---- id_token validation (pure, given the keys) ----------------------------
// Everything the token must satisfy before it is allowed to name a person. Each failure
// returns a REASON rather than a bare null, because "the clock is off" and "this token was
// minted for another application" are different deployment problems and an admin reading a
// log needs to be able to tell them apart.
function verifyIdToken(idToken, opts) {
  opts = opts || {};
  var parts = String(idToken || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "id_token is not a JWT" };
  var header = b64urlJson(parts[0]), claims = b64urlJson(parts[1]);
  if (!header || !claims) return { ok: false, reason: "id_token header or claims unreadable" };
  if (header.alg !== "RS256") return { ok: false, reason: "unsupported signing algorithm: " + header.alg };
  var jwk = (opts.keys || []).filter(function (k) { return !header.kid || k.kid === header.kid; })[0];
  if (!jwk) return { ok: false, reason: "no published key matches this token's kid" };
  var key;
  try { key = crypto.createPublicKey({ key: jwk, format: "jwk" }); }
  catch (e) { return { ok: false, reason: "published key is unusable: " + (e && e.message || e) }; }
  var signed = Buffer.from(parts[0] + "." + parts[1], "utf8");
  var verified = false;
  try { verified = crypto.verify("RSA-SHA256", signed, key, b64urlToBuf(parts[2])); } catch (e) { verified = false; }
  if (!verified) return { ok: false, reason: "signature does not verify" };
  if (opts.issuer && claims.iss !== opts.issuer) return { ok: false, reason: "issued by " + claims.iss + ", expected " + opts.issuer };
  var aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (opts.clientId && aud.indexOf(opts.clientId) < 0) return { ok: false, reason: "token was minted for another application" };
  var nowSec = Math.floor((opts.now ? opts.now() : 0) / 1000);
  var skew = opts.clockSkewSec != null ? opts.clockSkewSec : 120;
  if (claims.exp != null && nowSec > claims.exp + skew) return { ok: false, reason: "token expired" };
  if (claims.nbf != null && nowSec + skew < claims.nbf) return { ok: false, reason: "token not valid yet" };
  // The nonce is what ties this token to the redirect THIS server started. Without it a
  // token replayed from elsewhere would sign someone in.
  if (opts.nonce && claims.nonce !== opts.nonce) return { ok: false, reason: "nonce does not match this sign-in attempt" };
  var who = identityFromClaims(claims);
  if (!who) return { ok: false, reason: "no email, preferred_username or upn claim -- cannot name the user" };
  return { ok: true, identity: who, claims: claims };
}

// ---- the OIDC rung ---------------------------------------------------------
// cfg = { issuer, clientId, clientSecret, redirectUri, scope?, discoveryUrl? }
// deps = { getJson(url), postForm(url, body), now, stateTtlMs }  -- all injectable.
function createOidcAdapter(cfg, deps) {
  cfg = cfg || {};
  deps = deps || {};
  var getJson = deps.getJson || function (url) { return fetch(url).then(function (r) { return r.ok ? r.json() : null; }); };
  var postForm = deps.postForm || function (url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
      .then(function (r) { return r.json().catch(function () { return null; }); });
  };
  var now = deps.now || function () { return Date.now(); };
  var stateTtlMs = deps.stateTtlMs != null ? deps.stateTtlMs : 10 * 60 * 1000;
  var discovery = null;          // cached; an IdP's endpoints do not move mid-session
  var pending = {};              // state -> { nonce, createdAt, returnTo }

  function discoveryUrl() {
    if (cfg.discoveryUrl) return cfg.discoveryUrl;
    return String(cfg.issuer || "").replace(/\/+$/, "") + "/.well-known/openid-configuration";
  }
  function discover() {
    if (discovery) return Promise.resolve(discovery);
    return Promise.resolve(getJson(discoveryUrl())).then(function (d) {
      if (!d || !d.authorization_endpoint || !d.token_endpoint) return null;
      discovery = d;
      return d;
    }).catch(function () { return null; });
  }
  function keys() {
    if (!discovery || !discovery.jwks_uri) return Promise.resolve([]);
    return Promise.resolve(getJson(discovery.jwks_uri)).then(function (j) { return (j && j.keys) || []; }).catch(function () { return []; });
  }
  // Drop expired attempts whenever a new one starts, so a server that nobody completes a
  // sign-in on does not accumulate state forever.
  function sweep() {
    var t = now();
    Object.keys(pending).forEach(function (s) { if (t - pending[s].createdAt > stateTtlMs) delete pending[s]; });
  }

  return {
    name: "oidc",
    // The rung is NOT a credential check. Returning null here is what makes the break-glass
    // path in identity.login work unchanged: an SSO deployment that hands us an email and a
    // password falls through to the local-accounts adapter, which is the floor.
    authenticate: function () { return null; },
    isRedirectRung: true,
    // Phase 1: where do we send the browser? A null means the IdP could not be reached,
    // which the sign-in surface must show as an outage rather than a wrong password.
    begin: function (returnTo) {
      sweep();
      return discover().then(function (d) {
        if (!d) return null;
        var state = randomToken(24), nonce = randomToken(24);
        pending[state] = { nonce: nonce, createdAt: now(), returnTo: returnTo || "/" };
        return { url: authorizeUrl(d.authorization_endpoint, cfg, state, nonce, cfg.redirectUri), state: state };
      });
    },
    // Phase 2: the browser came back with a code. Exchange it, verify the id_token on-prem,
    // and return the identity -- or a reason. An unknown `state` is rejected before any
    // network call: it means this callback did not come from a sign-in this server started.
    complete: function (code, state) {
      sweep();
      var att = state && pending[state];
      if (!att) return Promise.resolve({ ok: false, reason: "this sign-in did not start here, or it expired" });
      delete pending[state];
      if (!code) return Promise.resolve({ ok: false, reason: "the sign-in service returned no authorization code" });
      return discover().then(function (d) {
        if (!d) return { ok: false, reason: "cannot reach the sign-in service" };
        return Promise.resolve(postForm(d.token_endpoint, form({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: cfg.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret
        }))).then(function (tok) {
          if (!tok || !tok.id_token) return { ok: false, reason: (tok && tok.error_description) || "the sign-in service returned no id_token" };
          return keys().then(function (ks) {
            var v = verifyIdToken(tok.id_token, {
              keys: ks, issuer: d.issuer || cfg.issuer, clientId: cfg.clientId,
              nonce: att.nonce, now: now, clockSkewSec: cfg.clockSkewSec
            });
            if (!v.ok) return { ok: false, reason: v.reason };
            return { ok: true, identity: v.identity, returnTo: att.returnTo };
          });
        });
      }).catch(function (e) { return { ok: false, reason: "sign-in failed: " + (e && e.message || e) }; });
    },
    // Reachability, for the sign-in surface's outage state and for the ops health check.
    probe: function () { return discover().then(function (d) { return { ok: !!d, issuer: d && d.issuer }; }); },
    _pendingCount: function () { return Object.keys(pending).length }
  };
}

// ---- the IIS Integrated Windows Auth rung ----------------------------------
// IIS performs Kerberos/NTLM and passes the authenticated account to Node in a header.
// cfg = { header?, domainSuffix?, trustedProxies? }
//
// THE ONLY THING THAT MAKES THIS SAFE IS THAT THE HEADER CANNOT BE FORGED. A header is
// trivially set by any client, so trusting one unconditionally would turn this rung into an
// "sign in as anyone" route. The adapter therefore refuses unless the request arrived from a
// configured upstream address. A deployment that does not list its IIS host gets no IWA
// identity at all, which is the safe direction to fail.
function createIwaAdapter(cfg) {
  cfg = cfg || {};
  var headerName = String(cfg.header || "x-iis-windowsauth-user").toLowerCase();
  var trusted = (cfg.trustedProxies || []).map(String);

  function remoteAddr(req) {
    var s = req && (req.socket || req.connection);
    var a = (s && s.remoteAddress) || "";
    return String(a).replace(/^::ffff:/, ""); // an IPv4 address seen through an IPv6 socket
  }
  function fromRequest(req) {
    if (!req || !req.headers) return null;
    if (!trusted.length) return null;               // unconfigured upstream -> no identity
    if (trusted.indexOf(remoteAddr(req)) < 0) return null;
    var raw = req.headers[headerName];
    if (!raw || Array.isArray(raw)) return null;
    // IIS presents DOMAIN\user; a UPN arrives already in email shape.
    var v = String(raw).trim();
    if (!v) return null;
    if (v.indexOf("@") > 0) return { email: v.toLowerCase(), name: v.split("@")[0] };
    var user = v.indexOf("\\") >= 0 ? v.slice(v.indexOf("\\") + 1) : v;
    if (!user) return null;
    var suffix = cfg.domainSuffix ? String(cfg.domainSuffix).replace(/^@/, "") : null;
    return { email: (suffix ? user + "@" + suffix : user).toLowerCase(), name: user };
  }
  return {
    name: "iwa",
    authenticate: function () { return null; }, // not a credential rung either
    isRequestRung: true,
    fromRequest: fromRequest,
    _trusted: trusted.slice()
  };
}

// ---- choosing the rung -----------------------------------------------------
// PURE: a config object -> which rung this deployment runs, with the reason. There is no
// build-time fork; the same artifact serves Entra, AD FS, IWA and local accounts. A config
// that names a rung but omits what the rung needs falls back to local accounts rather than
// half-starting one, and says so, because a half-configured SSO that silently accepts local
// passwords is worse than one that never claimed to be configured.
function chooseRung(config) {
  var a = (config && config.auth) || {};
  var want = a.rung || (a.oidc ? "oidc" : (a.iwa ? "iwa" : "local"));
  if (want === "oidc") {
    var o = a.oidc || {};
    if (!o.issuer || !o.clientId || !o.clientSecret || !o.redirectUri) {
      return { rung: "local", requested: "oidc", reason: "the OIDC rung needs issuer, clientId, clientSecret and redirectUri" };
    }
    return { rung: "oidc", config: o };
  }
  if (want === "iwa") {
    var w = a.iwa || {};
    if (!w.trustedProxies || !w.trustedProxies.length) {
      return { rung: "local", requested: "iwa", reason: "the IWA rung needs trustedProxies -- the address IIS forwards from" };
    }
    return { rung: "iwa", config: w };
  }
  return { rung: "local" };
}

// Build whichever rung the config asks for. Returns null for "local", which means
// identity.js's built-in local-accounts adapter is the whole ladder.
function createRung(config, deps) {
  var chosen = chooseRung(config);
  if (chosen.rung === "oidc") return createOidcAdapter(chosen.config, deps);
  if (chosen.rung === "iwa") return createIwaAdapter(chosen.config);
  return null;
}

module.exports = {
  createOidcAdapter: createOidcAdapter,
  createIwaAdapter: createIwaAdapter,
  chooseRung: chooseRung,
  createRung: createRung,
  verifyIdToken: verifyIdToken,
  authorizeUrl: authorizeUrl,
  identityFromClaims: identityFromClaims
};
