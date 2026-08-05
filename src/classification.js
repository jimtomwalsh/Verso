// classification.js -- what content may leave, and to whom (uio-F07).
//
// A piece of content carries a CLASSIFICATION. The classification resolves a RULE SET: who may read
// it internally, whether it may leave the organisation at all, which capability may edit it, and
// which capability owes it a sign-off. A resolver then answers the only question the stages
// actually ask -- may this audience see this block, and may this document go out.
//
// TITLES ARE DATA, THE SHAPE IS CODE. Exactly the settlement `server/identity.js` reached for roles
// and for the same reason: no two organisations classify content in the same words, and a category
// list Verso invented would be wrong everywhere. So this file owns the RULE KEYS -- the fixed set of
// things a level is allowed to say -- and the levels themselves are data, seeded with a neutral set
// and replaceable by a deployment. Nothing in the code may branch on a level's NAME.
//
// RANK IS THE WHOLE ORDERING. A level's `rank` is the only thing that makes one level more
// restrictive than another, which is what lets a block tighten its inherited classification and
// never loosen it. Two levels may not share a rank; `normalizeLevels` refuses a set that tries.
//
// IT RIDES THE SCOPE LADDER; IT DOES NOT BUILD ONE. Classification inherits System -> Product ->
// Course -> Page -> Block through the SAME resolver every other setting uses
// (`resolveScoped` in src/editor/inspector/primitives.js), by supplying two things and nothing
// else: the property key `CLASSIFICATION_PROP`, and a scope chain whose rungs read this axis's own
// storage. `mostRestrictive` below is the `choose()` that resolver takes. A second, parallel
// inheritance path is a hard fail -- see design-system/readme.md, "Scope and inheritance".
//
// Two builds, deliberately separate. This is THE LABEL: classification on content, inherited, and a
// resolver that can be asked a question. Acting on the answer at distribution time -- withholding a
// restricted block from an external package, gating a release on a missing sign-off -- is the
// Publish withholding ticket, and it consumes this rather than re-deriving it.
//
// PURE: no DOM, no window, no Date.now, no Math.random. Headlessly testable, and the same answers in
// the editor, in the exporter and in a test.
//
// window.VersoClassification.*        -> the model + the resolvers
// window.VersoClassification._pure.*  -> same, for the headless guard in tests/run.js
(function () {
  "use strict";

  // ---- the fixed vocabulary, owned by the code -----------------------------
  // A level may say these four things about content and nothing else. A deployment that needs a
  // fifth adds it HERE, in a code change, and it then becomes a choice an admin makes.
  //
  // THE ORDER IS THE ORDER EVERY SURFACE STATES THEM IN, and `external` leads because it is the
  // consequential one: whether the thing may leave decides what happens at release, and the rest
  // qualify it. uio-S-C06's card and the inspector both read this list, so they cannot disagree.
  var RULE_KEYS = ["external", "internal", "editCapability", "approverCapability"];

  // `external` is a disposition, not a boolean, so "we have not decided" can never masquerade as
  // "cleared to leave". An unrecognised value normalises to `withheld`: the safe direction.
  var EXTERNAL_ALLOWED = "allowed";
  var EXTERNAL_WITHHELD = "withheld";
  var EXTERNAL_DISPOSITIONS = [EXTERNAL_ALLOWED, EXTERNAL_WITHHELD];

  // The audience every internal population contains. A level whose `internal` holds this is
  // readable by anyone signed in; it is not a wildcard over EXTERNAL, which `external` alone
  // decides.
  var AUDIENCE_ANY_INTERNAL = "internal:any";
  // The one audience that is not a population but a direction: outside the organisation.
  var AUDIENCE_EXTERNAL = "external";

  // Seeded on a deployment that has classified nothing yet. Neutral, generic, and true of any
  // organisation -- the names carry no meaning to the code, and renaming them changes nothing.
  // Rank 0 is the least restrictive; `defaultLevelId` is what unclassified content resolves to.
  var SEED_LEVELS = [
    { id: "class_open",       name: "Open",       rank: 0, internal: [AUDIENCE_ANY_INTERNAL], external: EXTERNAL_ALLOWED,  editCapability: "edit",    approverCapability: null },
    { id: "class_internal",   name: "Internal",   rank: 1, internal: [AUDIENCE_ANY_INTERNAL], external: EXTERNAL_WITHHELD, editCapability: "edit",    approverCapability: "publish" },
    { id: "class_restricted", name: "Restricted", rank: 2, internal: [],                      external: EXTERNAL_WITHHELD, editCapability: "promote", approverCapability: "promote" }
  ];
  var DEFAULT_LEVEL_ID = "class_open";

  // The property key this axis resolves under. Deliberately not a word a settings panel would pick
  // for something else, because it shares one namespace with every other resolved property.
  var CLASSIFICATION_PROP = "classificationId";

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function seedLevels() { return clone(SEED_LEVELS); }

  // ---- normalising a stored set --------------------------------------------
  // A level set arrives from a store, which means it may be anything. This repairs what it can and
  // REFUSES what it cannot, because a silently-repaired ordering is worse than no ordering: the
  // "never loosen" guard is built entirely on rank, so two levels sharing a rank would let a block
  // swap between them and call it tightening.
  //
  // Returns { ok, levels, defaultLevelId, errors }. On !ok the caller keeps the seed rather than a
  // guess -- a broken classification set must not quietly become a permissive one.
  function normalizeLevels(raw, defaultId) {
    var errors = [];
    var list = Array.isArray(raw) ? raw : [];
    if (!list.length) return { ok: false, levels: seedLevels(), defaultLevelId: DEFAULT_LEVEL_ID, errors: ["no levels"] };
    var seenId = {}, seenRank = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var l = list[i] || {};
      var id = typeof l.id === "string" ? l.id : "";
      var rank = typeof l.rank === "number" && isFinite(l.rank) ? l.rank : null;
      if (!id) { errors.push("level " + i + " has no id"); continue; }
      if (seenId[id]) { errors.push("duplicate id " + id); continue; }
      if (rank === null) { errors.push(id + " has no rank"); continue; }
      if (seenRank[rank]) { errors.push("rank " + rank + " is claimed by " + seenRank[rank] + " and " + id); continue; }
      seenId[id] = 1; seenRank[rank] = id;
      out.push({
        id: id,
        name: typeof l.name === "string" && l.name ? l.name : id,
        rank: rank,
        internal: Array.isArray(l.internal) ? l.internal.slice() : [],
        // Anything not explicitly cleared is withheld. Never the other way round.
        external: l.external === EXTERNAL_ALLOWED ? EXTERNAL_ALLOWED : EXTERNAL_WITHHELD,
        editCapability: typeof l.editCapability === "string" && l.editCapability ? l.editCapability : "edit",
        approverCapability: typeof l.approverCapability === "string" && l.approverCapability ? l.approverCapability : null
      });
    }
    if (!out.length) return { ok: false, levels: seedLevels(), defaultLevelId: DEFAULT_LEVEL_ID, errors: errors.concat(["nothing usable"]) };
    out.sort(function (a, b) { return a.rank - b.rank; });
    var dflt = defaultId;
    if (!dflt || !out.some(function (l) { return l.id === dflt; })) {
      dflt = out[0].id;   // the least restrictive present, so a missing default cannot over-restrict
      if (defaultId) errors.push("default " + defaultId + " is not in the set");
    }
    return { ok: errors.length === 0, levels: out, defaultLevelId: dflt, errors: errors };
  }

  // ---- reading a set --------------------------------------------------------
  function levelById(levels, id) {
    var list = levels || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function rankOf(levels, id) { var l = levelById(levels, id); return l ? l.rank : null; }
  function levelName(levels, id) { var l = levelById(levels, id); return l ? l.name : (id || ""); }

  // The `choose()` uio-F03's resolver takes. The MORE RESTRICTIVE value wins wherever it sits on the
  // ladder, so a block that tries to loosen what it inherits simply does not apply -- the rule is
  // enforced by resolution itself, not only by a picker that hides the looser options.
  // An id the level set does not know loses to one it does; two unknowns keep the first.
  function mostRestrictive(levels) {
    return function (a, b) {
      var ra = rankOf(levels, a), rb = rankOf(levels, b);
      if (ra === null && rb === null) return a;
      if (ra === null) return b;
      if (rb === null) return a;
      return rb > ra ? b : a;
    };
  }
  // What a picker at one rung may offer: everything at or above what it would otherwise inherit.
  // Same rule as `mostRestrictive`, stated forwards, so the control and the resolver cannot disagree.
  function allowedOverrides(levels, inheritedId) {
    var floor = rankOf(levels, inheritedId);
    return (levels || []).filter(function (l) { return floor === null || l.rank >= floor; });
  }
  function isTightening(levels, inheritedId, candidateId) {
    var floor = rankOf(levels, inheritedId), r = rankOf(levels, candidateId);
    if (r === null) return false;
    return floor === null || r >= floor;
  }

  // ---- the resolver ---------------------------------------------------------
  // May this audience see content classified at this level? One function, so Source, Edit and
  // Publish can never answer it differently.
  //   - the external audience is decided by `external` alone
  //   - an internal audience is in the population, or the population names any-internal
  // An unknown level is NOT readable: content whose classification the deployment no longer
  // defines is withheld until someone reclassifies it.
  function canAudienceSee(levels, levelId, audience) {
    var l = levelById(levels, levelId);
    if (!l) return false;
    if (audience === AUDIENCE_EXTERNAL) return l.external === EXTERNAL_ALLOWED;
    if (!audience) return false;
    var pop = l.internal || [];
    return pop.indexOf(AUDIENCE_ANY_INTERNAL) !== -1 || pop.indexOf(audience) !== -1;
  }
  function ruleSet(levels, levelId) {
    var l = levelById(levels, levelId);
    if (!l) return null;
    var out = {};
    for (var i = 0; i < RULE_KEYS.length; i++) out[RULE_KEYS[i]] = l[RULE_KEYS[i]];
    return out;
  }

  // The same question asked of a whole document. `parts` is whatever the caller wants judged --
  // one entry per page or per block, each carrying the classification that RESOLVED for it (the
  // caller does the resolving, because the ladder lives in the editor and this file stays pure).
  //   parts: [{ id, levelId }]
  // Returns what a distribution decision needs: whether the whole thing may go, what has to be
  // withheld for it to, and the most restrictive level anywhere in it.
  function documentDisposition(levels, parts, audience) {
    var list = parts || [];
    var withheld = [], visible = [], peak = null, peakRank = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var r = rankOf(levels, p.levelId);
      if (r !== null && (peakRank === null || r > peakRank)) { peakRank = r; peak = p.levelId; }
      if (canAudienceSee(levels, p.levelId, audience)) visible.push(p.id);
      else withheld.push(p.id);
    }
    return {
      audience: audience,
      total: list.length,
      visible: visible,
      withheld: withheld,
      // "Whole" means nothing had to be held back. An empty document is releasable, not blocked --
      // there is nothing in it to withhold.
      releasableWhole: withheld.length === 0,
      // A document every part of which is withheld cannot go out at all, which is a different
      // decision from "goes out with holes" and is worth stating separately.
      releasableAtAll: visible.length > 0 || list.length === 0,
      mostRestrictiveLevelId: peak
    };
  }

  var api = {
    RULE_KEYS: RULE_KEYS,
    EXTERNAL_ALLOWED: EXTERNAL_ALLOWED,
    EXTERNAL_WITHHELD: EXTERNAL_WITHHELD,
    EXTERNAL_DISPOSITIONS: EXTERNAL_DISPOSITIONS,
    AUDIENCE_ANY_INTERNAL: AUDIENCE_ANY_INTERNAL,
    AUDIENCE_EXTERNAL: AUDIENCE_EXTERNAL,
    SEED_LEVELS: SEED_LEVELS,
    DEFAULT_LEVEL_ID: DEFAULT_LEVEL_ID,
    CLASSIFICATION_PROP: CLASSIFICATION_PROP,
    seedLevels: seedLevels,
    normalizeLevels: normalizeLevels,
    levelById: levelById,
    levelName: levelName,
    rankOf: rankOf,
    mostRestrictive: mostRestrictive,
    allowedOverrides: allowedOverrides,
    isTightening: isTightening,
    canAudienceSee: canAudienceSee,
    ruleSet: ruleSet,
    documentDisposition: documentDisposition
  };
  var VersoClassification = {};
  for (var k in api) if (api.hasOwnProperty(k)) VersoClassification[k] = api[k];
  VersoClassification._pure = api;

  if (typeof window !== "undefined") window.VersoClassification = VersoClassification;
  if (typeof module !== "undefined" && module.exports) module.exports = VersoClassification;
})();
