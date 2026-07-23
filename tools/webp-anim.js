/*
 * #28 Animated-WebP muxer (docs illustration pipeline, ADR 0004).
 *
 * ORIGINAL Verso-authored implementation of the WebP container's animation chunks
 * (VP8X / ANIM / ANMF), written from the public WebP container specification
 * (https://developers.google.com/speed/webp/docs/riff_container). It is a MUXER, not an
 * encoder: Chrome (via the docs capture runner in capture mode) already encodes each frame
 * to a self-contained WebP bitstream, so we only assemble those frames into one animated
 * WebP. A true VP8 encoder was rejected for the same reason the vendored GIF codec
 * (src/gif-codec.js) is unsuitable here — far too heavy for the no-build / air-gap stack.
 *
 * Dependency-free pure Node byte assembly (no npm, no WASM, no network): air-gap safe. Used
 * ONLY by tools/docs-capture.js at capture time; never shipped in the app or a SCORM package.
 * Deterministic: identical frames in -> identical bytes out (backs the no-op-commit promise).
 */
"use strict";

// Parse a WebP file buffer -> { imageBytes, chunks } where imageBytes is the concatenation
// of the frame-image chunks (VP8 / VP8L / ALPH) as whole chunks (fourcc+size+data+pad),
// ready to drop into an ANMF. Container-level chunks (VP8X, ICCP, EXIF, XMP) are discarded —
// the animated container carries its own VP8X, and dropping ICCP keeps frames lean.
var IMAGE_FOURCCS = ["VP8 ", "VP8L", "ALPH"];

function parseWebP(buf) {
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") {
    throw new Error("not a RIFF/WEBP buffer");
  }
  var parts = [];
  var off = 12;
  while (off + 8 <= buf.length) {
    var fourcc = buf.toString("latin1", off, off + 4);
    var size = buf.readUInt32LE(off + 4);
    var dataStart = off + 8;
    var padded = size + (size & 1);
    if (IMAGE_FOURCCS.indexOf(fourcc) !== -1) {
      // re-emit the whole chunk (fourcc + size + data + pad) verbatim
      parts.push(buf.slice(off, dataStart + padded));
    }
    off = dataStart + padded;
  }
  if (!parts.length) throw new Error("no VP8/VP8L/ALPH image chunk found");
  return { imageBytes: Buffer.concat(parts) };
}

function u24le(n) { var b = Buffer.alloc(3); b[0] = n & 0xff; b[1] = (n >> 8) & 0xff; b[2] = (n >> 16) & 0xff; return b; }

function chunk(fourcc, data) {
  var head = Buffer.alloc(8);
  head.write(fourcc, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  if (data.length & 1) return Buffer.concat([head, data, Buffer.from([0])]); // RIFF even-pad
  return Buffer.concat([head, data]);
}

/*
 * muxAnimatedWebP({ width, height, loopCount, bgColor, frames:[{ webp:Buffer, duration:ms }] })
 *   width/height : canvas size in device pixels (the clip size * dpr)
 *   loopCount    : 0 = loop forever (default)
 *   bgColor      : [B,G,R,A] background (default transparent black)
 *   frames       : ordered per-frame WebP buffers + display durations (ms)
 * Returns the animated-WebP file Buffer.
 */
function muxAnimatedWebP(opts) {
  var width = opts.width, height = opts.height;
  var frames = opts.frames || [];
  if (!(width > 0) || !(height > 0)) throw new Error("muxAnimatedWebP: width/height required");
  if (frames.length < 1) throw new Error("muxAnimatedWebP: at least one frame required");
  var loopCount = opts.loopCount || 0;
  var bg = opts.bgColor || [0, 0, 0, 0];

  // VP8X (10 bytes): flags (Animation bit = 0x02), 3 reserved, canvas W-1 (24 LE), H-1 (24 LE)
  var vp8x = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24le(width - 1), u24le(height - 1)]);
  // ANIM (6 bytes): background BGRA + loop count (16 LE)
  var anim = Buffer.alloc(6);
  anim[0] = bg[0] & 0xff; anim[1] = bg[1] & 0xff; anim[2] = bg[2] & 0xff; anim[3] = bg[3] & 0xff;
  anim.writeUInt16LE(loopCount & 0xffff, 4);

  var body = [chunk("VP8X", vp8x), chunk("ANIM", anim)];
  frames.forEach(function (f) {
    var img = parseWebP(f.webp).imageBytes;
    // ANMF header (16 bytes): X/2 (24), Y/2 (24), W-1 (24), H-1 (24), duration (24), flags (1)
    // flags 0x02 = "do not blend" so each full-canvas opaque frame cleanly replaces the last.
    var hdr = Buffer.concat([
      u24le(0), u24le(0), u24le(width - 1), u24le(height - 1),
      u24le(Math.max(0, f.duration | 0)), Buffer.from([0x02])
    ]);
    body.push(chunk("ANMF", Buffer.concat([hdr, img])));
  });

  var payload = Buffer.concat(body);
  var riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(4 + payload.length, 4); // "WEBP" + payload
  riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, payload]);
}

module.exports = { muxAnimatedWebP: muxAnimatedWebP, parseWebP: parseWebP };
