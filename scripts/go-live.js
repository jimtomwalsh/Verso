#!/usr/bin/env node
/*
 * scripts/go-live.js -- the go-live gate, as a command (platform-pivot 30).
 *
 * Run it against a REAL running server before promoting anything:
 *
 *   node scripts/go-live.js --base https://verso.example.internal \
 *     --admin root@local:<password> --confirm backup,dryRun,rollback,idp-reach,arr-proxy
 *
 * Exit 0 only when every gate item passes. Non-zero blocks the promotion, which is the point:
 * a green local suite can never ship on its own. The two [UNKNOWN] items are confirmations a
 * person makes about the site's network -- they cannot be automated from here, and leaving them
 * out would let a deploy read as "all clear" while the two most likely failures went unchecked.
 *
 * Works against prod-in-the-window or an ephemeral throwaway instance; it asserts only
 * externally observable behaviour and knows nothing about Verso's internals.
 */
"use strict";

var smoke = require("../server/smoke.js");

function arg(name, fallback) {
  var i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.indexOf("--" + name) > -1; }

(async function () {
  var base = arg("base");
  if (!base) {
    console.error("usage: node scripts/go-live.js --base <url> [--admin email:password] [--confirm a,b,c]");
    process.exit(2);
  }
  var adminArg = arg("admin");
  var admin = null;
  if (adminArg) {
    var at = adminArg.indexOf(":");
    admin = { email: adminArg.slice(0, at), password: adminArg.slice(at + 1) };
  }
  var confirmed = {};
  String(arg("confirm", "")).split(",").filter(Boolean).forEach(function (k) { confirmed[k.trim()] = true; });

  console.log("go-live gate -> " + base);
  var result = await smoke.run({ base: base, admin: admin, stamp: String(Date.now()) });
  result.results.forEach(function (r) {
    console.log("  " + (r.ok ? "PASS" : "FAIL") + "  " + r.id + "  " + r.detail);
  });

  var gate = smoke.evaluateGate(result, confirmed);
  console.log("");
  gate.items.forEach(function (i) {
    var mark = i.pass ? "[x]" : "[ ]";
    console.log("  " + mark + " " + i.label + (i.automated ? "" : "   (confirm with --confirm " + i.id + ")"));
  });
  console.log("");
  console.log(gate.ok ? "GO-LIVE GATE: PASS" : "GO-LIVE GATE: BLOCKED -- " + gate.reason);
  if (has("json")) console.log(JSON.stringify({ smoke: result, gate: gate }, null, 2));
  process.exit(gate.ok ? 0 : 1);
})().catch(function (e) {
  console.error("go-live gate could not run: " + ((e && e.message) || e));
  process.exit(2);
});
