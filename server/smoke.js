/*
 * server/smoke.js -- the server-only smoke test, and the go-live gate around it
 * (platform-pivot 30, Ops).
 *
 * WHY THIS EXISTS AT ALL. Four of Verso's behaviours cannot be exercised in local mode, by
 * construction: sync fan-out, block-lock contention, an SSO round trip, and a review link.
 * `tests/run.js` covers each of them against in-process fakes and a real SQLite store, which
 * proves the LOGIC and cannot prove the DEPLOYMENT -- whether IIS actually proxies the websocket
 * upgrade, whether the on-prem box can reach the identity provider, whether the reverse proxy
 * passes the session cookie through. Those fail at the site, not on a laptop.
 *
 * So this drives all four end to end against a REAL RUNNING SERVER over HTTP, asserting only
 * externally observable behaviour: what a second client sees, what status a request gets back.
 * It knows nothing about Verso's internals and must stay that way -- a smoke test that reaches
 * into the process is a second unit-test suite that happens to be slower.
 *
 * IT HARD-BLOCKS PROMOTION. A green local run can never ship on its own: that is the point of
 * the accepted "local is staging" gap (platform-pivot 29) and this is the operational half of
 * closing it. The gate below also carries the two deploy [UNKNOWN]s that no amount of code can
 * settle -- IdP reachability, and IIS+ARR proxying BOTH wss:// and long-poll -- as checklist
 * items an operator confirms, because a checklist item nobody can automate is still better
 * recorded than forgotten.
 *
 * Dependency-free: node: builtins + global fetch. Runs against prod-in-the-window or an
 * ephemeral throwaway instance; it does not care which.
 */
"use strict";

// ---- the checks ------------------------------------------------------------
// Each returns { id, ok, detail }. They never throw: a smoke test that dies on the first
// problem tells an operator about one failure when there might be four, and they will run it
// again anyway. Collect everything, then decide.
async function step(id, fn) {
  try {
    var r = await fn();
    return { id: id, ok: !!(r && r.ok), detail: (r && r.detail) || "" };
  } catch (e) {
    return { id: id, ok: false, detail: "threw: " + ((e && e.message) || e) };
  }
}

function makeClient(base) {
  var cookie = "";
  async function req(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (cookie) headers.cookie = cookie;
    var r = await fetch(base.replace(/\/+$/, "") + path, Object.assign({}, opts, { headers: headers, redirect: "manual" }));
    var sc = r.headers.get("set-cookie");
    if (sc && /verso_session=/.test(sc)) cookie = sc.split(";")[0];
    return r;
  }
  return {
    req: req,
    json: async function (p, o) { var r = await req(p, o); try { return await r.json(); } catch (e) { return null; } },
    cookie: function () { return cookie; }
  };
}

// (1) TWO SYNC CLIENTS SEE A BLOCK CHANGE. The long-poll path is used deliberately: it is the
// fallback IIS+ARR is most likely to get right, so a failure here means the proxy is broken
// rather than merely websocket-unaware.
async function checkSyncFanOut(base, a, b, docId) {
  await a.json("/api/doc/" + docId + "/import", { method: "POST", body: JSON.stringify({ doc: { meta: { code: docId }, pages: [{ id: "p1", blocks: [{ id: "b1", type: "heading", text: "before" }] }] }, author: "smoke" }) });
  // BOTH clients say hello first. That is what puts them in the doc's fan-out set -- a client
  // that never subscribed is not a client the server has anything to send to, and testing
  // fan-out without it would fail for a reason that has nothing to do with the proxy.
  await b.json("/sync/send", { method: "POST", body: JSON.stringify({ clientId: "smoke-b", envelope: { type: "sync.hello", docId: docId, payload: { sinceSeq: 0 } } }) });
  await a.json("/sync/send", { method: "POST", body: JSON.stringify({ clientId: "smoke-a", envelope: { type: "sync.hello", docId: docId, payload: { sinceSeq: 0 } } }) });
  var sent = await a.json("/sync/send", { method: "POST", body: JSON.stringify({
    clientId: "smoke-a",
    envelope: { type: "block.change", docId: docId, blockId: "b1", author: "smoke", payload: { patch: { id: "b1", type: "heading", text: "after" } } }
  }) });
  if (!sent || sent.ok !== true) return { ok: false, detail: "the server refused the block.change: " + JSON.stringify(sent) };
  var got = await b.json("/sync/poll?clientId=smoke-b");
  var sawIt = !!(got && got.events && got.events.some(function (e) { return e && e.type === "block.change" && e.blockId === "b1"; }));
  // Persistence is the second half: fan-out without a durable write is a chat room.
  var doc = await a.json("/api/doc/" + docId);
  var persisted = JSON.stringify(doc || {}).indexOf("after") >= 0;
  return {
    ok: sawIt && persisted,
    detail: sawIt ? (persisted ? "peer saw the change and it persisted" : "peer saw it but it did NOT persist")
                  : "the second client never received the change (check the ARR proxy)"
  };
}

// (2) A BLOCK LOCK SHOWS CONTENTION TO THE OTHER CLIENT. The denial comes back on the DENIED
// client's own poll, not in its send response -- it is a reply envelope, like everything else
// on this wire.
async function checkLockContention(base, a, b, docId) {
  await a.json("/sync/send", { method: "POST", body: JSON.stringify({ clientId: "smoke-a", envelope: { type: "lock.acquire", docId: docId, blockId: "b1", payload: { class: "content" } } }) });
  await b.json("/sync/send", { method: "POST", body: JSON.stringify({ clientId: "smoke-b", envelope: { type: "lock.acquire", docId: docId, blockId: "b1", payload: { class: "content" } } }) });
  var got = await b.json("/sync/poll?clientId=smoke-b");
  var denied = !!(got && got.events && got.events.some(function (e) { return e && e.type === "lock.denied" && e.blockId === "b1"; }));
  return {
    ok: denied,
    detail: denied ? "the second client was refused the held block"
                   : "BOTH clients were granted the same block -- locking is not reaching the server"
  };
}

// (3) AN SSO ROUND TRIP YIELDS A SESSION. On a local-accounts deployment this degrades to the
// local rung and says so rather than failing: a site that chose local accounts has not got a
// broken SSO, it has no SSO, and reporting that as a failure would train people to ignore the gate.
async function checkAuthRoundTrip(base, creds) {
  var cfg = await (await fetch(base.replace(/\/+$/, "") + "/auth/config")).json();
  var c = makeClient(base);
  if (cfg && cfg.sso) {
    var start = await c.req("/auth/sso/start");
    var located = start.status === 302 && !!start.headers.get("location");
    if (!located) return { ok: false, detail: "the SSO redirect did not happen (rung " + cfg.rung + "); can this server reach the IdP?" };
    // A full browser round trip cannot be driven headlessly without the IdP; what IS provable
    // from here is that the redirect is issued and reachable. The interactive half is the
    // gate's [UNKNOWN] below, deliberately.
    return { ok: true, detail: "SSO redirect issued to " + new URL(start.headers.get("location")).host + " (interactive completion is a gate item)" };
  }
  if (!creds) return { ok: false, detail: "no SSO configured and no local credentials supplied to prove the local rung" };
  var r = await c.json("/auth/login", { method: "POST", body: JSON.stringify(creds) });
  var me = await c.json("/auth/me");
  var ok = !!(r && r.ok && me && me.principal && me.principal.kind === "user");
  return { ok: ok, detail: ok ? "local rung signed in and the session resolved" : "the local rung did not yield a session (is the proxy passing the cookie?)" };
}

// (4) A REVIEW LINK OPENS READ-ONLY AND COMMENTS.
async function checkReviewLink(base, admin, docId) {
  var cps = await admin.json("/api/doc/" + docId + "/checkpoints");
  var cpId = cps && cps.checkpoints && cps.checkpoints[0] && cps.checkpoints[0].id;
  if (!cpId) return { ok: false, detail: "no checkpoint to pin a review link to" };
  var link = await admin.json("/api/doc/" + docId + "/links", { method: "POST", body: JSON.stringify({ checkpointId: cpId, displayName: "Smoke guest", mode: "guest" }) });
  if (!link || !link.token) return { ok: false, detail: "the link was not issued: " + ((link && link.error) || "unknown") };
  var read = await fetch(base.replace(/\/+$/, "") + "/api/doc/" + docId, { headers: { "x-verso-guest": link.token } });
  var wrote = await fetch(base.replace(/\/+$/, "") + "/api/doc/" + docId + "/change", { method: "POST", headers: { "x-verso-guest": link.token }, body: JSON.stringify({ blockId: "b1", patch: { text: "guest edit" } }) });
  var commented = await fetch(base.replace(/\/+$/, "") + "/api/doc/" + docId + "/comments", { method: "POST", headers: { "x-verso-guest": link.token }, body: JSON.stringify({ blockId: "b1", body: "a guest note" }) });
  // Read AND comment must work, edit must NOT. A guest who can edit is the whole risk of
  // handing a link to somebody outside the organisation.
  var ok = read.status === 200 && wrote.status === 403 && commented.status < 400;
  return { ok: ok, detail: "read " + read.status + ", edit " + wrote.status + " (must be 403), comment " + commented.status };
}

// ---- the harness -----------------------------------------------------------
// opts = { base, admin: {email,password}, docId }
async function run(opts) {
  opts = opts || {};
  var base = opts.base;
  var docId = opts.docId || "SMOKE-" + (opts.stamp || "run");
  var results = [];
  results.push(await step("health", async function () {
    var h = await (await fetch(base.replace(/\/+$/, "") + "/api/health?deep=1")).json();
    return { ok: !!(h && h.ok), detail: "level " + (h && h.level) + ", version " + (h && h.version) };
  }));
  var a = makeClient(base), b = makeClient(base);
  if (opts.admin) { await a.json("/auth/login", { method: "POST", body: JSON.stringify(opts.admin) }); await b.json("/auth/login", { method: "POST", body: JSON.stringify(opts.admin) }); }
  results.push(await step("sync", function () { return checkSyncFanOut(base, a, b, docId); }));
  results.push(await step("locks", function () { return checkLockContention(base, a, b, docId); }));
  results.push(await step("auth", function () { return checkAuthRoundTrip(base, opts.admin); }));
  results.push(await step("review-link", function () { return checkReviewLink(base, a, docId); }));
  return { ok: results.every(function (r) { return r.ok; }), base: base, results: results };
}

// ---- the go-live gate ------------------------------------------------------
// The smoke result is the CENTRAL item, and the rest are the things a person confirms. Two of
// them can never be automated from here -- they are properties of the site's network -- and
// naming them as unknowns is the honest form. A gate that quietly omitted them would read as
// "all clear" while the two most likely deployment failures went unchecked.
var GATE_ITEMS = [
  { id: "smoke", label: "Server-only smoke test passes against the running server", automated: true },
  { id: "backup", label: "A pre-migration backup has been taken and verified", automated: false },
  { id: "dryRun", label: "The migration dry run completed without error", automated: false },
  { id: "health", label: "Health is green after deploy", automated: true },
  { id: "rollback", label: "The rollback plan is written down and someone has read it", automated: false },
  // The two carried [UNKNOWN]s. Both are properties of the site's network, not of the code.
  { id: "idp-reach", label: "[UNKNOWN] Entra / AD FS endpoint is reachable from the on-prem server", automated: false, unknown: true },
  { id: "arr-proxy", label: "[UNKNOWN] IIS+ARR proxies BOTH wss:// AND the long-poll fallback", automated: false, unknown: true }
];

// PURE: the smoke result + whatever the operator has confirmed -> may this promotion proceed.
// Separated from the network so the gate's arithmetic is testable, and so "a green local run can
// never ship on its own" is one function rather than a habit.
function evaluateGate(smoke, confirmed) {
  confirmed = confirmed || {};
  var items = GATE_ITEMS.map(function (it) {
    var pass;
    if (it.id === "smoke") pass = !!(smoke && smoke.ok);
    else if (it.id === "health") pass = !!(smoke && smoke.results && smoke.results.some(function (r) { return r.id === "health" && r.ok; }));
    else pass = confirmed[it.id] === true;
    return { id: it.id, label: it.label, automated: !!it.automated, unknown: !!it.unknown, pass: pass };
  });
  var blocking = items.filter(function (i) { return !i.pass; });
  return {
    ok: blocking.length === 0,
    items: items,
    blocking: blocking.map(function (i) { return i.id; }),
    // Said plainly, because the whole purpose is to stop a green local run shipping on its own.
    reason: blocking.length ? "promotion is blocked: " + blocking.map(function (i) { return i.label; }).join("; ") : "all gate items pass"
  };
}

module.exports = {
  run: run, evaluateGate: evaluateGate, GATE_ITEMS: GATE_ITEMS,
  makeClient: makeClient, checkSyncFanOut: checkSyncFanOut, checkLockContention: checkLockContention,
  checkAuthRoundTrip: checkAuthRoundTrip, checkReviewLink: checkReviewLink
};
