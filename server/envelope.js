/*
 * server/envelope.js -- the ONE collaboration message envelope shape (platform-pivot,
 * Collaboration). Shared by the sync hub and the lock manager so the wire contract can
 * never drift between them. The server stamps `seq` on anything it fans out from the log;
 * ephemeral traffic (presence/cursor) carries no seq.
 *
 * Envelope: { type, docId, blockId|null, seq|null, author|null, ts, payload }
 * Dependency-free. Never renders.
 */
"use strict";

function envelope(type, docId, blockId, seq, author, ts, payload) {
  return {
    type: type,
    docId: docId,
    blockId: blockId != null ? blockId : null,
    seq: seq != null ? seq : null,
    author: author != null ? author : null,
    ts: ts != null ? ts : 0,
    payload: payload || {}
  };
}

module.exports = { envelope: envelope };
