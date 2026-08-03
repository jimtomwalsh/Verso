/*
 * src/spellcheck.js -- editor-chrome spellchecker (P0).
 *
 * Flags misspelled words across EVERY text box, on the canvas AND in the copy editor,
 * whether or not a box is selected. The marking is done with the CSS Custom Highlight
 * API (see editor.js runSpellcheck) so NOTHING is written to the DOM or the document --
 * it can never leak into render() or a SCORM export. This file owns only the dictionary
 * lookup + the pure tokenizer/checker; editor.js owns the visual pass.
 *
 * Dictionary: a Bloom filter over ~234k English words (src/spellcheck-dict.js, built by
 * scripts/build-dict.js). Membership is O(1); the filter's only error is a rare false
 * POSITIVE (a real typo occasionally not flagged) -- it never flags a word that IS in the
 * dictionary, so correct words are never wrongly squiggled. Classic script, no deps,
 * file:// friendly. Loads before editor.js; absent dict -> the checker no-ops (flags
 * nothing) so the app is unaffected.
 */
(function () {
  // arch-P2 (the test seam): in the browser this binds to the REAL window, so every
  // `window.X = ...` below publishes globally exactly as it did before -- no behaviour change.
  // Under `require` in node there is no window, so it binds to a local stand-in and the footer
  // hands that same namespace to module.exports. The file's interface becomes the test surface,
  // instead of the suite string-slicing its source text back into life.
  // The node stand-in inherits its no-op listeners from a prototype, so `module.exports` carries
  // this file's OWN published names and nothing else.
  var window = (typeof globalThis !== "undefined" && globalThis.window)
    || Object.create({ addEventListener: function () {}, removeEventListener: function () {} });

  "use strict";

  // ---- hash contract (MUST match scripts/build-dict.js) ------------------
  function fnv1a(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  var M = 0, K = 0, BITS = null, READY = false;
  (function loadDict() {
    var d = window.VersoSpellDict;
    if (!d || !d.bits) return;
    try {
      var bin = atob(d.bits);
      BITS = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) BITS[i] = bin.charCodeAt(i);
      M = d.m; K = d.k; READY = true;
    } catch (e) { READY = false; }
  })();
  function bloomHas(word) {
    if (!READY) return true; // no dictionary -> treat everything as correct (flag nothing)
    var h1 = fnv1a(word, 0x811c9dc5);
    var h2 = fnv1a(word, 0xdeadbeef) | 1;
    for (var i = 0; i < K; i++) {
      var b = ((h1 + Math.imul(i, h2)) >>> 0) % M;
      if (!(BITS[b >>> 3] & (1 << (b & 7)))) return false;
    }
    return true;
  }

  // Common contractions the raw word list omits (checked as whole words, apostrophe kept).
  var CONTRACTIONS = ("i'm you're we're they're he's she's it's that's there's here's what's " +
    "let's who's don't can't won't isn't aren't wasn't weren't hasn't haven't hadn't didn't " +
    "doesn't wouldn't couldn't shouldn't mustn't i've you've we've they've i'll you'll we'll " +
    "they'll he'll she'll i'd you'd he'd she'd we'd they'd o'clock").split(" ");
  var CONTRACT = {};
  CONTRACTIONS.forEach(function (w) { CONTRACT[w] = 1; });

  // User + seed allow-list ("add to dictionary"), persisted per machine.
  var IGNORE_KEY = "verso.spellIgnore";
  var ignore = {};
  (function seedIgnore() {
    try {
      var saved = JSON.parse(localStorage.getItem(IGNORE_KEY) || "[]");
      if (Array.isArray(saved)) saved.forEach(function (w) { ignore[String(w).toLowerCase()] = 1; });
    } catch (e) {}
  })();
  function addWord(w) {
    w = String(w || "").toLowerCase().replace(/[^a-z'’-]/g, "");
    if (!w) return;
    ignore[w] = 1;
    try {
      var list = Object.keys(ignore);
      localStorage.setItem(IGNORE_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  // ---- PURE core (tokenize + decide); injected `has`/`allow` so it is unit-testable.
  /* @spell-core-start */
  // Morphology: the bundled word list is root-words + American spellings only, so a plain
  // membership test wrongly flags inflected forms ("hazards", "demonstrating") and British
  // spellings ("recognise", "colour"). dictKnows tries the word, then a set of de-inflection
  // + British->American rewrites -- each candidate STILL has to be a real dictionary root,
  // so this only ever ACCEPTS more correct words (kills false positives); it can never turn a
  // genuine typo into a hit ("recieve"/"teh" reduce to nothing real). Lenient by design:
  // missing a rare typo beats squiggling correct copy.
  function dictKnows(w, has) {
    if (has(w)) return true;
    var cand = {};
    function add(x) { if (x && x.length >= 2 && x !== w) cand[x] = 1; }
    // British -> American
    add(w.replace(/isation$/, "ization")); add(w.replace(/ise$/, "ize"));
    add(w.replace(/ised$/, "ized")); add(w.replace(/ising$/, "izing"));
    add(w.replace(/yse$/, "yze")); add(w.replace(/our$/, "or"));
    if (/[bcdfghjklmnpqrstvwxz]re$/.test(w)) add(w.slice(0, -2) + "er"); // centre->center
    // plural / 3rd-person
    if (/ies$/.test(w)) add(w.slice(0, -3) + "y");
    if (/es$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w)) add(w.slice(0, -1));
    // past tense (-ed, dropped-e, doubled consonant)
    if (/ied$/.test(w)) add(w.slice(0, -3) + "y");
    if (/ed$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); add(w.slice(0, -3)); }
    // gerund (-ing, restored-e, doubled consonant)
    if (/ing$/.test(w)) { var b = w.slice(0, -3); add(b); add(b + "e"); add(b.replace(/(.)\1$/, "$1")); }
    // adverb / comparative / superlative
    if (/ily$/.test(w)) add(w.slice(0, -3) + "y");
    if (/ly$/.test(w)) add(w.slice(0, -2));
    if (/iest$/.test(w)) add(w.slice(0, -4) + "y");
    if (/est$/.test(w)) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
    if (/ier$/.test(w)) add(w.slice(0, -3) + "y");
    if (/er$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    for (var k in cand) if (has(k)) return true;
    return false;
  }
  // A single token is a typo when: it is long enough, not an ACRONYM (all-caps), carries
  // no digit, is not an allow-listed/contraction word, and -- after stripping a possessive
  // and checking each hyphen part via dictKnows -- is absent from the dictionary. `has(word)`
  // is the lowercase dictionary test; `allow(lowerWord)` covers contractions + the user list.
  function isMisspelled(token, has, allow) {
    if (!token || /\d|_/.test(token)) return false;         // has a digit/underscore -> skip (codes, ids)
    var core = token.replace(/^['’-]+|['’-]+$/g, "");        // trim edge punctuation
    if (core.length < 3) return false;                       // too short to judge
    if (/^[A-Z][A-Z'’]*[A-Z]$/.test(core)) return false;     // ALL-CAPS acronym (SCORM, LMS)
    var lower = core.toLowerCase();
    if (allow && allow(lower)) return false;
    var base = lower.replace(/['’]s$/, "");                  // possessive: dog's -> dog
    if (base.indexOf("-") !== -1) {                          // hyphenated: every part must pass
      var parts = base.split("-").filter(function (p) { return p.length; });
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].replace(/['’]/g, "").replace(/[^a-z]/g, "");
        if (p.length >= 3 && !dictKnows(p, has)) return true;
      }
      return false;
    }
    var w = base.replace(/['’]/g, "");                       // drop internal apostrophes for lookup
    if (w.length < 3) return false;
    return !dictKnows(w, has);
  }
  // Word tokens (letters + internal apostrophes/hyphens) with their offsets in `text`.
  function tokenize(text) {
    var out = [], re = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g, m;
    while ((m = re.exec(String(text || ""))) !== null) out.push({ word: m[0], start: m.index, len: m[0].length });
    return out;
  }
  function check(text, has, allow) {
    var res = [], toks = tokenize(text);
    for (var i = 0; i < toks.length; i++) if (isMisspelled(toks[i].word, has, allow)) res.push(toks[i]);
    return res;
  }
  /* @spell-core-end */

  function allow(lower) { return !!(CONTRACT[lower] || ignore[lower]); }
  function checkText(text) { return check(text, bloomHas, allow); }

  window.VersoSpell = {
    ready: READY,
    has: bloomHas,               // lowercase dictionary membership
    check: checkText,            // (text) -> [{word,start,len}] misspellings
    addWord: addWord,            // "add to dictionary" (persists)
    isIgnored: function (w) { return !!ignore[String(w || "").toLowerCase()]; },
    _core: { isMisspelled: isMisspelled, tokenize: tokenize, check: check } // unit-test hook
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
