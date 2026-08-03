/*
 * src/verso-format.js -- the .verso portable package (wayfinder #64 / #67).
 *
 * A .verso is a store-method (no compression) ZIP:
 *     manifest.json          { formatVersion, code, title, generator, scormMeta }
 *     doc.json               the course doc, media left as asset:<id> refs (NOT inlined)
 *     assets/<id>            one media blob per ref
 *     assets/<id>.meta       { mime, enc:"base64"|"raw" }
 *
 * The codec is PURE (bytes in / bytes out) so it is headless round-trip + `unzip -t`
 * testable. Classic-script global, no deps, opens from file://.
 *
 * Content-hash discipline: AssetStore ids are a hash of the EXACT dataURL string, and
 * import re-hashes on AssetStore.put -- so a dataURL MUST round-trip byte-identical or
 * refs break. base64 media is stored as raw bytes and re-encoded (btoa(atob(x))===x for
 * canonical base64 -> stable id, smaller file); anything else is stored verbatim.
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
  var FORMAT_VERSION = 1;

  // ---- CRC32 (IEEE, table-based) -------------------------------------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---- byte helpers --------------------------------------------------------
  var enc = new TextEncoder(), dec = new TextDecoder();
  function strBytes(s) { return enc.encode(s); }
  function b64ToBytes(b64) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function bytesToB64(bytes) { var s = "", CH = 0x8000; for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
  var DATAURL_RE = /^data:([^;,]*)(;base64)?,([\s\S]*)$/;

  // ---- minimal store-method ZIP -------------------------------------------
  function zip(entries) {
    var chunks = [], offset = 0, central = [];
    function u16(v) { return new Uint8Array([v & 255, (v >>> 8) & 255]); }
    function u32(v) { return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]); }
    function push(a) { chunks.push(a); offset += a.length; }
    entries.forEach(function (e) {
      var nameB = strBytes(e.name), data = e.bytes, crc = crc32(data), localOff = offset;
      push(u32(0x04034b50)); push(u16(20)); push(u16(0)); push(u16(0)); // sig, ver, flags, method=store
      push(u16(0)); push(u16(0));                                       // mod time, date
      push(u32(crc)); push(u32(data.length)); push(u32(data.length));   // crc, comp, uncomp
      push(u16(nameB.length)); push(u16(0));                            // name len, extra len
      push(nameB); push(data);
      central.push({ nameB: nameB, crc: crc, size: data.length, off: localOff });
    });
    var cdStart = offset;
    central.forEach(function (c) {
      push(u32(0x02014b50)); push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0)); // sig, made, need, flags, method
      push(u16(0)); push(u16(0));                                       // time, date
      push(u32(c.crc)); push(u32(c.size)); push(u32(c.size));           // crc, comp, uncomp
      push(u16(c.nameB.length)); push(u16(0)); push(u16(0));            // name, extra, comment len
      push(u16(0)); push(u16(0)); push(u32(0));                         // disk, internal, external attrs
      push(u32(c.off)); push(c.nameB);                                  // local offset, name
    });
    var cdSize = offset - cdStart;
    push(u32(0x06054b50)); push(u16(0)); push(u16(0));                  // sig, disk, cd-start-disk
    push(u16(central.length)); push(u16(central.length));              // entries this disk, total
    push(u32(cdSize)); push(u32(cdStart)); push(u16(0));               // cd size, cd offset, comment len
    var out = new Uint8Array(offset), p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  function unzip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), eocd = -1;
    for (var i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error("not a zip (no end-of-central-directory)");
    var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true), out = {}, p = cdOff;
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory");
      var nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error("bad local header");
      var lNameLen = dv.getUint16(localOff + 26, true), lExtraLen = dv.getUint16(localOff + 28, true);
      var size = dv.getUint32(localOff + 18, true), dataStart = localOff + 30 + lNameLen + lExtraLen;
      out[name] = bytes.subarray(dataStart, dataStart + size);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // ---- .verso package ------------------------------------------------------
  // doc: course doc WITH asset:<id> refs. assets: { id: { dataUrl, mime } }.
  function buildPackage(doc, assets, meta) {
    meta = meta || {};
    var m = doc && doc.meta || {};
    var manifest = { formatVersion: FORMAT_VERSION, code: m.code || meta.code || null, title: m.title || meta.title || null, generator: "Verso", scormMeta: meta.scormMeta || null };
    var entries = [
      { name: "manifest.json", bytes: strBytes(JSON.stringify(manifest)) },
      { name: "doc.json", bytes: strBytes(JSON.stringify(doc)) }
    ];
    Object.keys(assets || {}).forEach(function (id) {
      var a = assets[id]; if (!a || !a.dataUrl) return;
      var dm = DATAURL_RE.exec(a.dataUrl);
      if (dm && dm[2]) { // base64 -> raw bytes (lossless canonical re-encode -> stable id)
        entries.push({ name: "assets/" + id, bytes: b64ToBytes(dm[3]) });
        entries.push({ name: "assets/" + id + ".meta", bytes: strBytes(JSON.stringify({ mime: dm[1] || a.mime || "", enc: "base64" })) });
      } else { // non-base64 (e.g. SVG utf8) -> store the dataURL verbatim
        entries.push({ name: "assets/" + id, bytes: strBytes(a.dataUrl) });
        entries.push({ name: "assets/" + id + ".meta", bytes: strBytes(JSON.stringify({ mime: (dm && dm[1]) || a.mime || "", enc: "raw" })) });
      }
    });
    return zip(entries);
  }

  function readPackage(bytes) {
    var files = unzip(bytes);
    if (!files["manifest.json"] || !files["doc.json"]) throw new Error("Not a .verso package (missing manifest/doc).");
    var manifest = JSON.parse(dec.decode(files["manifest.json"]));
    if (manifest.formatVersion > FORMAT_VERSION) throw new Error("This .verso was made by a newer Verso (format v" + manifest.formatVersion + "). Update Verso to open it.");
    var doc = JSON.parse(dec.decode(files["doc.json"])), assets = {};
    Object.keys(files).forEach(function (name) {
      var mm = /^assets\/(.+)\.meta$/.exec(name); if (!mm) return;
      var id = mm[1], dataName = "assets/" + id; if (!files[dataName]) return;
      var mt = {}; try { mt = JSON.parse(dec.decode(files[name])); } catch (e) {}
      var dataUrl = (mt.enc === "base64") ? "data:" + (mt.mime || "") + ";base64," + bytesToB64(files[dataName]) : dec.decode(files[dataName]);
      assets[id] = { dataUrl: dataUrl, mime: mt.mime || "" };
    });
    return { manifest: manifest, doc: doc, assets: assets };
  }

  window.VersoFormat = {
    FORMAT_VERSION: FORMAT_VERSION,
    buildPackage: buildPackage,
    readPackage: readPackage,
    _zip: zip, _unzip: unzip, _crc32: crc32   // low-level, exposed for headless tests
  };

  // arch-P2 (the test seam): under `require`, the `window` above is this file's OWN namespace --
  // exactly what it publishes and nothing else. In the browser `module` is undefined, so this
  // line does nothing at all.
  if (typeof module !== "undefined" && module.exports) module.exports = window;
})();
