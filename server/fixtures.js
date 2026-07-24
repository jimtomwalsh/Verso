/*
 * server/fixtures.js -- synthetic fixture corpus for local validation (platform-pivot
 * 29/31, Ops). Local mode IS staging: an admin validates a release locally against these
 * fixtures before promoting to prod. NEUTRAL PLACEHOLDER CONTENT ONLY -- no customer,
 * course, or proprietary material ever lives here (the repo-hygiene gate enforces this).
 *
 * Content-isolation invariant (AC): there is NO supported code path that copies PROD
 * master content into staging/local. The only way content crosses into a store is a
 * deliberate author `.verso` import (block-store.importDoc, which takes an explicit doc
 * payload) -- never an ops mirror that pulls from a prod store. This module seeds
 * synthetic data; it never reads another store. The invariant is asserted as a testable
 * property in tests/run.js.
 *
 * Dependency-free. Never renders.
 */
"use strict";

// A representative synthetic course (neutral placeholder): pages + blocks with stable ids.
var SYNTHETIC_COURSE = {
  meta: { code: "SAMPLE-101", title: "Sample Onboarding (synthetic)" },
  headerFooter: { header: { on: true, title: "Sample Onboarding" } },
  pages: [
    { id: "p1", name: "Getting Started", blocks: [
      { id: "sb1", type: "heading", text: "Welcome" },
      { id: "sb2", type: "para", text: "This is neutral placeholder content for local validation." }
    ]},
    { id: "p2", name: "Basics", blocks: [
      { id: "sb3", type: "para", text: "A second synthetic page." }
    ]}
  ]
};

// The four roles, as synthetic local accounts (neutral names).
var SYNTHETIC_USERS = [
  { email: "admin@example.test",    name: "Sample Admin",    password: "changeme", role: "admin" },
  { email: "author@example.test",   name: "Sample Author",   password: "changeme", role: "author" },
  { email: "reviewer@example.test", name: "Sample Reviewer", password: "changeme", role: "reviewer" },
  { email: "viewer@example.test",   name: "Sample Viewer",   password: "changeme", role: "viewer" }
];

// Seed a store with the synthetic corpus: a course (block rows), users across all four
// roles, a named checkpoint, and a seeded change log (a few edits). Takes the SERVER's own
// modules -- it constructs content from literals, it NEVER reads another store.
function seed(deps) {
  var blockStore = deps.blockStore, identity = deps.identity;
  var out = { docId: SYNTHETIC_COURSE.meta.code, users: [], checkpoints: 0, changes: 0 };
  blockStore.importDoc(out.docId, JSON.parse(JSON.stringify(SYNTHETIC_COURSE)), "fixtures"); // seeds an 'imported' checkpoint
  // a seeded change log (a couple of edits) so history/replay have something to chew on
  blockStore.applyChange(out.docId, "sb1", { id: "sb1", type: "heading", text: "Welcome!" }, "author");
  blockStore.applyChange(out.docId, "sb2", { id: "sb2", type: "para", text: "Edited placeholder." }, "author");
  out.changes = blockStore.changesSince(0, out.docId).length;
  blockStore.createCheckpoint(out.docId, "fixtures-baseline", "admin");
  out.checkpoints = blockStore.listCheckpoints(out.docId).length;
  if (identity) {
    SYNTHETIC_USERS.forEach(function (u) { identity.registerLocalAccount(u.email, u.name, u.password, u.role); out.users.push(u.role); });
  }
  return out;
}

// The layers local mode CANNOT exercise (documented for validators -- server-only paths).
var LOCAL_CANNOT_EXERCISE = ["sync", "block-locking", "presence", "SSO/identity", "review-links"];

module.exports = {
  seed: seed, SYNTHETIC_COURSE: SYNTHETIC_COURSE, SYNTHETIC_USERS: SYNTHETIC_USERS,
  LOCAL_CANNOT_EXERCISE: LOCAL_CANNOT_EXERCISE
};
