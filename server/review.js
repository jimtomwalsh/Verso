/*
 * server/review.js -- the review COMMENTS subsystem (platform-pivot 23/31, Review-links).
 * SERVER-MODE ONLY. Comments are anchored to STABLE BLOCK IDS (Foundation ticket 03), so
 * a guest's comment against a pinned-snapshot block B resolves onto the LIVE master's
 * block B and surfaces to authors in the editor -- and author replies/resolves flow back
 * to the reviewer. Threads + resolve state are shared BOTH WAYS over the sync layer.
 *
 * Orphan rule (CONFIRMED by James 2026-07-24): a comment whose anchor stable-id no longer
 * exists in the live master degrades to a SURFACED orphaned anchor -- never mis-anchored,
 * never silently dropped. `commentsFor` marks each comment orphaned:true when its blockId
 * is absent from the live master (checked against the block store).
 *
 * The in-EDITOR surfacing + the reviewer comment UI reuse the already-shipped comment mode
 * (client-side chrome, ticket 22/16). This module is the server-side store + anchoring +
 * orphan detection + the fan-out the sync hub relays.
 *
 * Dependency-free: node:crypto + node:sqlite. Never renders.
 */
"use strict";

var crypto = require("node:crypto");
var DatabaseSync = require("node:sqlite").DatabaseSync;

function createReview(opts) {
  opts = opts || {};
  var now = opts.now || function () { return 0; };
  var db = opts.db || new DatabaseSync(opts.dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS comments (" +
    "  id TEXT PRIMARY KEY, doc_id TEXT, block_id TEXT, thread_id TEXT," +
    "  author TEXT, author_kind TEXT, body TEXT, resolved INTEGER DEFAULT 0," +
    "  created_at INTEGER, updated_at INTEGER" +
    ");"
  );
  var qIns     = db.prepare("INSERT INTO comments (id, doc_id, block_id, thread_id, author, author_kind, body, resolved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)");
  var qGet     = db.prepare("SELECT * FROM comments WHERE id = ?");
  var qForDoc  = db.prepare("SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at");
  var qResolve = db.prepare("UPDATE comments SET resolved = ?, updated_at = ? WHERE id = ? OR thread_id = ?");

  function cid() { return "cm_" + crypto.randomBytes(8).toString("hex"); }

  // Add a comment (or a reply, when threadId is given) anchored to a stable block id. Works
  // for both an author (in the editor) and a guest (via a review link) -- author_kind
  // records which. A guest comment attributes to the link's display name.
  function addComment(docId, blockId, principal, body, threadId) {
    var id = cid();
    var kind = (principal && principal.kind === "guest") ? "guest" : "user";
    var author = (principal && principal.name) || (principal && principal.author) || "Anon";
    qIns.run(id, docId, blockId, threadId || id, author, kind, String(body == null ? "" : body), now(), now());
    return { ok: true, id: id, threadId: threadId || id, blockId: blockId, author: author, kind: kind };
  }
  // Resolve/unresolve a whole thread (author reply/resolve shows on the reviewer's link,
  // and vice-versa -- the same rows both sides read).
  function resolveThread(threadId, resolved) {
    qResolve.run(resolved ? 1 : 0, now(), threadId, threadId);
    return { ok: true, threadId: threadId, resolved: !!resolved };
  }
  function getComment(id) { return qGet.get(id) || null; }

  // Comments for a doc, each marked orphaned:true when its anchor stable-id no longer
  // exists in the LIVE master. `blockExists(blockId) -> bool` is injected (the block
  // store's blockContent !== null). Never drops an orphan; surfaces it.
  function commentsFor(docId, blockExists) {
    return qForDoc.all(docId).map(function (c) {
      return {
        id: c.id, docId: c.doc_id, blockId: c.block_id, threadId: c.thread_id,
        author: c.author, kind: c.author_kind, body: c.body, resolved: !!c.resolved,
        orphaned: blockExists ? !blockExists(c.block_id) : false,
        createdAt: c.created_at
      };
    });
  }

  return {
    addComment: addComment, resolveThread: resolveThread, getComment: getComment,
    commentsFor: commentsFor,
    close: function () { if (!opts.db) db.close(); }, _db: db
  };
}

module.exports = { createReview: createReview };
