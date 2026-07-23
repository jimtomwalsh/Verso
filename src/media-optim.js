// ============================================================================
// media-optim.js  (§286) — Auto-optimise media on EXPORT.
//
// Web-canvas route (no native dep, air-gap safe): downscale oversized raster
// images to a max longest-edge and recompress via canvas.toDataURL, producing
// EXPORT-ONLY optimised data URLs. NON-DESTRUCTIVE: the author's stored asset
// (AssetStore) and the live doc are never mutated — the optimised bytes are fed
// into the export's inline step as an override map and discarded after.
//
// Scope: raster images (png / jpeg / webp / static gif). SVG (vector) is left
// untouched. GIF is handled carefully: a STATIC (single-frame) gif is safe to
// re-encode, but an ANIMATED gif would be FLATTENED to one frame by canvas (no
// GIF encoder is available in-browser), so animated gifs are detected and
// skipped. VIDEO/AUDIO need ffmpeg which the browser can't run, so they're
// skipped here (managed outside the app; the oversize WARN still flags them).
//
// The pure helpers (parseDataUrl / dataUrlBytes / fitWithin / isOptimisableMime /
// targetFormat) are extracted so tests/run.js can guard the decision logic
// headlessly; the actual encode (optimiseImage / buildOptimMap) needs a DOM.
// ============================================================================
(function () {
  "use strict";

  // Raster mimes we will consider re-encoding. Everything else is left as-is.
  // (gif is in the family but an ANIMATED gif is skipped at encode time — see
  // isAnimatedGif / optimiseImage — so its frames are never flattened.)
  var OPTIMISABLE = { "image/png": 1, "image/jpeg": 1, "image/jpg": 1, "image/webp": 1, "image/gif": 1 };

  // Parse a "data:<mime>[;base64],<payload>" URL. Returns {mime, base64, comma}
  // or null for a non-data string.
  function parseDataUrl(s) {
    if (typeof s !== "string" || s.slice(0, 5) !== "data:") return null;
    var comma = s.indexOf(",");
    if (comma < 0) return null;
    var header = s.slice(5, comma);              // e.g. "image/png;base64"
    var semi = header.indexOf(";");
    var mime = (semi >= 0 ? header.slice(0, semi) : header).toLowerCase();
    var base64 = /;base64/i.test(header);
    return { mime: mime, base64: base64, comma: comma };
  }

  // Decoded byte length of a data URL (base64 payload -> ~0.75x), matching the
  // export oversize estimator so the two agree.
  function dataUrlBytes(s) {
    var p = parseDataUrl(s);
    if (!p) return s ? s.length : 0;
    var payload = s.length - (p.comma + 1);
    return p.base64 ? Math.floor(payload * 0.75) : payload;
  }

  function isOptimisableMime(mime) { return !!OPTIMISABLE[String(mime || "").toLowerCase()]; }

  // Decode a base64 data URL's payload to a Uint8Array (browser atob or node
  // Buffer). null for a non-base64 / non-data string. Used only for GIF sniffing.
  function dataUrlToBytes(s) {
    var p = parseDataUrl(s);
    if (!p || !p.base64) return null;
    var b64 = s.slice(p.comma + 1);
    try {
      if (typeof atob !== "undefined") {
        var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
        for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    } catch (e) {}
    return null;
  }

  // Count image frames in a GIF by walking its block structure (header + logical
  // screen descriptor + optional global colour table, then extension / image-
  // descriptor / trailer blocks). Returns early once a 2nd frame is seen. 0 for a
  // non-GIF or malformed data. This is the reliable animated-vs-static test —
  // byte-scanning for 0x2C alone false-positives on pixel data.
  function gifFrameCount(bytes) {
    if (!bytes || bytes.length < 13) return 0;
    if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return 0; // "GIF"
    var p = 13, packed = bytes[10];
    if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1)); // global colour table
    var frames = 0;
    while (p < bytes.length) {
      var b = bytes[p];
      if (b === 0x3B) break;                                  // trailer
      if (b === 0x21) {                                       // extension
        p += 2;                                               // 0x21 + label
        while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1; // sub-blocks
        p += 1;                                               // block terminator
      } else if (b === 0x2C) {                                // image descriptor = 1 frame
        frames++;
        if (frames > 1) return frames;                        // animated — early out
        var lp = bytes[p + 9];
        p += 10;                                              // descriptor
        if (lp & 0x80) p += 3 * (1 << ((lp & 0x07) + 1));     // local colour table
        p += 1;                                               // LZW min code size
        while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1; // image data sub-blocks
        p += 1;                                               // block terminator
      } else break;                                           // malformed — stop
    }
    return frames;
  }
  function isAnimatedGif(bytes) { return gifFrameCount(bytes) > 1; }

  // Cap the LONGEST edge at maxDim, preserving aspect, NEVER upscaling. Returns
  // integer {w,h} (unchanged when already within the cap or maxDim falsy).
  function fitWithin(w, h, maxDim) {
    w = w | 0; h = h | 0;
    if (!maxDim || maxDim <= 0 || w <= 0 || h <= 0) return { w: w, h: h };
    var longest = Math.max(w, h);
    if (longest <= maxDim) return { w: w, h: h };
    var scale = maxDim / longest;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  // Re-encode format: JPEG stays JPEG; PNG/WebP -> WebP (keeps alpha, big
  // savings on photos, widely supported in modern LMS browsers + WKWebView).
  function targetFormat(mime) {
    mime = String(mime || "").toLowerCase();
    if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
    return "image/webp";
  }

  // A re-encode is only WORTH taking if it saves a meaningful amount — else keep
  // the original (avoids needless quality loss and re-encodes that barely help or
  // even inflate). Threshold: >= 5% AND >= 10 KB.
  function worthTaking(before, after) {
    return after < before && (before - after) >= Math.max(before * 0.05, 10 * 1024);
  }

  // ---- animated-GIF re-encode helpers (pure; DOM-free so tests can guard them) ----
  // An animated GIF can't be re-encoded through <canvas> (that flattens it to one
  // frame), so the raster path SKIPS it — which is why a heavy course of screen-
  // recording GIFs ignored the quality/size sliders entirely. These helpers drive a
  // real GIF->GIF re-encode (see optimiseAnimatedGif): downscale + palette-quantise
  // (+ optional frame decimation) while preserving the frame count, per-frame delays
  // and loop. GIF stays GIF, so it plays everywhere (no WebM/Safari gap).

  // The three quality stops map to a shrinking palette (and, at the smallest, a
  // halved frame rate) so the slider produces a MONOTONIC size drop even on a GIF
  // already within the max-dimension cap — colours are the only lever left there.
  //   High (>=0.9): 256 colours, every frame.  Balanced (>=0.8): 128, every frame.
  //   Small (else): 64 colours, every OTHER frame (delays merged, duration kept).
  function gifParamsForQuality(quality) {
    var q = (quality == null ? 0.85 : quality);
    if (q >= 0.9) return { colors: 256, frameStep: 1 };
    if (q >= 0.8) return { colors: 128, frameStep: 1 };
    return { colors: 64, frameStep: 2 };
  }

  // Median-cut colour quantiser. `rgb` is a flat [r,g,b, r,g,b, ...] sample buffer;
  // recursively splits colour boxes along their widest axis at the median and averages
  // each final box. Returns EXACTLY maxColors packed 0xRRGGBB entries (padded so the
  // palette length is a power of 2, as the GIF writer requires). Deterministic.
  function medianCutPalette(rgb, maxColors) {
    var n = (rgb.length / 3) | 0;
    if (n === 0) { var z = []; while (z.length < maxColors) z.push(0); return z; }
    var idx = new Int32Array(n);
    for (var i = 0; i < n; i++) idx[i] = i;
    function boxRange(lo, hi) {
      var rmn = 255, gmn = 255, bmn = 255, rmx = 0, gmx = 0, bmx = 0;
      for (var i = lo; i < hi; i++) {
        var p = idx[i] * 3, r = rgb[p], g = rgb[p + 1], b = rgb[p + 2];
        if (r < rmn) rmn = r; if (r > rmx) rmx = r;
        if (g < gmn) gmn = g; if (g > gmx) gmx = g;
        if (b < bmn) bmn = b; if (b > bmx) bmx = b;
      }
      return { lo: lo, hi: hi, rmn: rmn, rmx: rmx, gmn: gmn, gmx: gmx, bmn: bmn, bmx: bmx };
    }
    var boxes = [boxRange(0, n)];
    while (boxes.length < maxColors) {
      var bi = -1, best = -1;
      for (var i = 0; i < boxes.length; i++) {
        var bx = boxes[i]; if (bx.hi - bx.lo < 2) continue;
        var mr = Math.max(bx.rmx - bx.rmn, bx.gmx - bx.gmn, bx.bmx - bx.bmn);
        if (mr > best) { best = mr; bi = i; }
      }
      if (bi < 0) break; // every box is a single colour -> can't split further
      var bx = boxes[bi];
      var rr = bx.rmx - bx.rmn, gr = bx.gmx - bx.gmn, br = bx.bmx - bx.bmn;
      var ch = (rr >= gr && rr >= br) ? 0 : (gr >= br ? 1 : 2);
      var slice = Array.prototype.slice.call(idx.subarray(bx.lo, bx.hi));
      slice.sort(function (a, b) { return rgb[a * 3 + ch] - rgb[b * 3 + ch]; });
      for (var i = 0; i < slice.length; i++) idx[bx.lo + i] = slice[i];
      var mid = (bx.lo + bx.hi) >> 1;
      boxes.splice(bi, 1, boxRange(bx.lo, mid), boxRange(mid, bx.hi));
    }
    var palette = [];
    for (var i = 0; i < boxes.length; i++) {
      var bx = boxes[i], sr = 0, sg = 0, sb = 0, c = bx.hi - bx.lo;
      for (var j = bx.lo; j < bx.hi; j++) { var p = idx[j] * 3; sr += rgb[p]; sg += rgb[p + 1]; sb += rgb[p + 2]; }
      if (c < 1) c = 1;
      palette.push(((Math.round(sr / c) & 255) << 16) | ((Math.round(sg / c) & 255) << 8) | (Math.round(sb / c) & 255));
    }
    while (palette.length < maxColors) palette.push(palette.length ? palette[palette.length - 1] : 0);
    return palette;
  }

  // Precompute a 15-bit (5-bit/channel) RGB->palette-index lookup so per-pixel mapping
  // is O(1) instead of a 256-colour scan per pixel (a screen-recording GIF is millions
  // of pixels x dozens of frames — the scan would freeze the tab).
  function buildPaletteLut(palette) {
    var lut = new Uint8Array(32768);
    for (var c = 0; c < 32768; c++) {
      var r = ((c >> 10) & 31) << 3, g = ((c >> 5) & 31) << 3, b = (c & 31) << 3;
      var bd = 0x7fffffff, bi = 0;
      for (var i = 0; i < palette.length; i++) {
        var pr = (palette[i] >> 16) & 255, pg = (palette[i] >> 8) & 255, pb = palette[i] & 255;
        var dr = r - pr, dg = g - pg, db = b - pb, d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; bi = i; }
      }
      lut[c] = bi;
    }
    return lut;
  }
  function lutIndex(lut, r, g, b) { return lut[(((r >> 3) & 31) << 10) | (((g >> 3) & 31) << 5) | ((b >> 3) & 31)]; }

  // Which source frames survive decimation, and the delay each kept frame carries
  // (its own + every dropped frame after it, so total playback duration is unchanged).
  // delays are in GIF centiseconds. Returns [{ index, delay }].
  function decimatedFrames(delays, frameStep) {
    var step = frameStep > 1 ? frameStep : 1, out = [];
    for (var i = 0; i < delays.length; i += step) {
      var d = 0;
      for (var j = i; j < Math.min(i + step, delays.length); j++) d += (delays[j] || 0);
      out.push({ index: i, delay: d });
    }
    return out;
  }

  // ---- browser-only (DOM/canvas) -------------------------------------------
  var HAS_DOM = typeof document !== "undefined" && typeof Image !== "undefined";

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("image decode failed")); };
      img.src = dataUrl;
    });
  }

  // Optimise ONE image data URL. Resolves {dataUrl, bytes, before} on a real
  // saving, or null to leave the original (not raster, decode failed, format
  // unsupported, or no worthwhile saving). Never throws.
  function optimiseImage(dataUrl, opts) {
    opts = opts || {};
    var p = parseDataUrl(dataUrl);
    if (!HAS_DOM || !p || !isOptimisableMime(p.mime)) return Promise.resolve(null);
    // An animated GIF can't go through <canvas> (that flattens it to one frame), so
    // route it to the dedicated GIF->GIF re-encoder (downscale + quantise + preserve
    // frames/timing). If the codec isn't present, fall back to leaving it untouched.
    if (p.mime === "image/gif") {
      var gb = dataUrlToBytes(dataUrl);
      if (gb && isAnimatedGif(gb)) {
        return (typeof window !== "undefined" && window.GifCodec)
          ? optimiseAnimatedGif(dataUrl, opts)
          : Promise.resolve(null);
      }
    }
    var before = dataUrlBytes(dataUrl);
    var maxDim = opts.maxDim || 0;
    var quality = (opts.quality != null ? opts.quality : 0.85);
    return loadImage(dataUrl).then(function (img) {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) return null;
      var fit = fitWithin(w, h, maxDim);
      var canvas = document.createElement("canvas");
      canvas.width = fit.w; canvas.height = fit.h;
      var cx = canvas.getContext("2d");
      if (!cx) return null;
      cx.drawImage(img, 0, 0, fit.w, fit.h);
      var fmt = targetFormat(p.mime);
      var out;
      try { out = canvas.toDataURL(fmt, quality); } catch (e) { return null; }
      // toDataURL silently falls back to PNG when a format is unsupported; the
      // byte check below rejects any result that isn't a genuine win, so a
      // fallback that inflates is discarded and the original kept.
      if (!parseDataUrl(out)) return null;
      var after = dataUrlBytes(out);
      if (!worthTaking(before, after)) return null;
      return { dataUrl: out, bytes: after, before: before };
    }).catch(function () { return null; });
  }

  // Base64-encode a Uint8Array into a data URL, chunked so a tens-of-MB GIF doesn't
  // blow the argument limit of String.fromCharCode / btoa in one call.
  function bytesToGifDataUrl(u8, len) {
    var CH = 0x8000, bin = "";
    for (var i = 0; i < len; i += CH) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, len)));
    }
    var b64 = (typeof btoa !== "undefined") ? btoa(bin)
      : (typeof Buffer !== "undefined" ? Buffer.from(bin, "binary").toString("base64") : null);
    return b64 == null ? null : ("data:image/gif;base64," + b64);
  }

  // Re-encode ONE animated GIF: decode + composite every frame (honouring GIF
  // disposal), downscale to the max edge, build ONE global median-cut palette, then
  // re-emit each kept frame as indexed pixels — preserving frame order, per-frame
  // delays (merged across dropped frames) and the loop count. Resolves { dataUrl,
  // bytes, before } on a real, structurally-verified saving, else null (keep the
  // original). Never throws. Full-frame opaque output (no interframe transparency):
  // simpler + always visually correct; screen recordings are opaque anyway.
  function optimiseAnimatedGif(dataUrl, opts) {
    opts = opts || {};
    var GC = (typeof window !== "undefined" && window.GifCodec) || null;
    if (!HAS_DOM || !GC || !GC.GifReader || !GC.GifWriter) return Promise.resolve(null);
    var bytes = dataUrlToBytes(dataUrl);
    if (!bytes) return Promise.resolve(null);
    var before = dataUrlBytes(dataUrl);
    return new Promise(function (resolve) {
      try {
        var reader = new GC.GifReader(bytes);
        var W = reader.width, H = reader.height, nf = reader.numFrames();
        if (nf < 2 || !W || !H) { resolve(null); return; }
        var params = gifParamsForQuality(opts.quality != null ? opts.quality : 0.85);
        var fit = fitWithin(W, H, opts.maxDim || 0);
        var tw = fit.w, th = fit.h;

        // Iterate composited full-canvas RGBA frames, applying the previous frame's
        // disposal (2 = clear its rect; 3 = restore the pre-frame canvas) so each
        // callback sees the true on-screen image for that frame.
        function eachComposited(cb) {
          var comp = new Uint8Array(W * H * 4), saved = null, prevDisp = 0, prevRect = null;
          for (var i = 0; i < nf; i++) {
            var fi = reader.frameInfo(i);
            if (prevDisp === 2 && prevRect) {
              for (var yy = prevRect.y; yy < prevRect.y + prevRect.h; yy++) {
                var base = (yy * W + prevRect.x) * 4;
                for (var k = 0; k < prevRect.w * 4; k++) comp[base + k] = 0;
              }
            } else if (prevDisp === 3 && saved) { comp.set(saved); }
            if (fi.disposal === 3) saved = comp.slice();
            reader.decodeAndBlitFrameRGBA(i, comp);
            cb(comp, fi, i);
            prevDisp = fi.disposal; prevRect = { x: fi.x, y: fi.y, w: fi.width, h: fi.height };
          }
        }

        // Per-frame delays (frameInfo only -> no decode needed).
        var delays = new Array(nf);
        for (var i = 0; i < nf; i++) delays[i] = reader.frameInfo(i).delay || 0;
        // Pass 1: composite + subsample colours for ONE global palette (subsampled so
        // a huge course stays responsive; every frame contributes some pixels).
        var samples = [], TARGET = 120000, perFrame = Math.max(1, Math.floor(TARGET / nf));
        eachComposited(function (comp) {
          var total = W * H, stride = Math.max(1, Math.floor(total / perFrame));
          for (var pI = 0; pI < total; pI += stride) {
            var q = pI * 4; samples.push(comp[q], comp[q + 1], comp[q + 2]);
          }
        });
        var palette = medianCutPalette(samples, params.colors);
        var lut = buildPaletteLut(palette);
        var kept = decimatedFrames(delays, params.frameStep);
        var keptDelay = {}; for (var i = 0; i < kept.length; i++) keptDelay[kept[i].index] = kept[i].delay;

        // Output buffer upper bound: header + global palette + per kept frame
        // (indices + generous LZW/overhead), 1.5x safety. Sliced to real length.
        var cap = 2048 + params.colors * 3 + kept.length * (tw * th + 512);
        var outBuf = new Uint8Array(Math.ceil(cap * 1.5));
        var lc = reader.loopCount(); if (lc == null) lc = 0;
        var gw = new GC.GifWriter(outBuf, tw, th, { loop: lc, palette: palette });

        // Pass 2: composite -> downscale -> map to palette indices -> write kept frames.
        var srcC = document.createElement("canvas"); srcC.width = W; srcC.height = H;
        var sctx = srcC.getContext("2d");
        var dstC = document.createElement("canvas"); dstC.width = tw; dstC.height = th;
        var dctx = dstC.getContext("2d");
        if (!sctx || !dctx) { resolve(null); return; }
        var srcImg = sctx.createImageData(W, H);
        eachComposited(function (comp, fi, i) {
          if (!(i in keptDelay)) return;
          srcImg.data.set(comp); sctx.putImageData(srcImg, 0, 0);
          dctx.drawImage(srcC, 0, 0, tw, th);
          var d = dctx.getImageData(0, 0, tw, th).data;
          var indices = new Uint8Array(tw * th);
          for (var pI = 0, q = 0; pI < indices.length; pI++, q += 4) {
            indices[pI] = lutIndex(lut, d[q], d[q + 1], d[q + 2]);
          }
          gw.addFrame(0, 0, tw, th, indices, { delay: keptDelay[i], disposal: 1 });
        });
        var len = gw.end();
        var outUrl = bytesToGifDataUrl(outBuf, len);
        if (!outUrl) { resolve(null); return; }
        var after = dataUrlBytes(outUrl);
        // Structural correctness gate (bytes alone can't catch a broken animation):
        // the re-encode must still decode and carry exactly the kept frame count.
        try {
          var check = new GC.GifReader(dataUrlToBytes(outUrl));
          if (check.numFrames() !== kept.length) { resolve(null); return; }
        } catch (e) { resolve(null); return; }
        if (!worthTaking(before, after)) { resolve(null); return; }
        resolve({ dataUrl: outUrl, bytes: after, before: before });
      } catch (e) { resolve(null); }
    });
  }

  // Build an EXPORT-ONLY override map {assetId: optimisedDataUrl} for a doc.
  // getAsset(id) -> {dataUrl} from the live store (NEVER mutated). Serialised
  // (one decode at a time) to avoid spiking memory on a heavy course. Returns
  // { map, report } where report = {images, count, before, after, saved}.
  function buildOptimMap(doc, opts, getAsset) {
    var ids = (typeof window !== "undefined" && window.collectAssetRefs) ? window.collectAssetRefs(doc) : [];
    var map = {}, report = { images: 0, count: 0, before: 0, after: 0, saved: 0 };
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var a = getAsset(id);
        if (!a || !a.dataUrl) return;
        var pp = parseDataUrl(a.dataUrl);
        if (!pp || !isOptimisableMime(pp.mime)) return;
        report.images++;
        return optimiseImage(a.dataUrl, opts).then(function (r) {
          if (!r) return;
          map[id] = r.dataUrl;
          report.count++; report.before += r.before; report.after += r.bytes;
        });
      });
    });
    return chain.then(function () { report.saved = report.before - report.after; return { map: map, report: report }; });
  }

  var api = {
    parseDataUrl: parseDataUrl,
    dataUrlBytes: dataUrlBytes,
    dataUrlToBytes: dataUrlToBytes,
    isOptimisableMime: isOptimisableMime,
    fitWithin: fitWithin,
    targetFormat: targetFormat,
    worthTaking: worthTaking,
    gifFrameCount: gifFrameCount,
    isAnimatedGif: isAnimatedGif,
    gifParamsForQuality: gifParamsForQuality,
    medianCutPalette: medianCutPalette,
    buildPaletteLut: buildPaletteLut,
    lutIndex: lutIndex,
    decimatedFrames: decimatedFrames,
    optimiseImage: optimiseImage,
    optimiseAnimatedGif: optimiseAnimatedGif,
    buildOptimMap: buildOptimMap
  };
  if (typeof window !== "undefined") window.MediaOptim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
