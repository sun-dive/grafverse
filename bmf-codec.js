// grafspace BMF codec — © 2026 sun-dive — Licensed under the MIT License (see LICENSE).
// BMF codec — the canonical PACKED-byte format for the whole BMF family (BMF-FAMILY.md). ONE shared design,
// vendored per app (like three.min.js) so it never drifts. On-chain payloads are PACKED BYTES, never JSON.
//   • BMF.*          — reusable toolkit: Writer/Reader (LE ints + varint), SoA dab codec, quantisers, txid/str.
//   • BMF.ref        — the UNIVERSAL reference { tx, name? } (the pointer every atom/manifest uses).
//   • BMF.scene      — grafverse's geometry scene (the BMF-SOLID record; ground strokes + solid atoms).
//                      v3 per-shape: id·res·[class params: fractal seed u16 / model u16 / mesh txid / n log-ratios]
//                      ·pos·rot·size·color·tex·matFlags·paint(strokes carry an fx byte).
//   • BMF.timeline   — the media manifest (binary .bmf; scene = time-cue + ref) — replaces the JSON/cue form.
//   • BMF.container  — the packed .bmc index (member map) — replaces bmc.json.
// Each app uses the modules it needs; all read this one file.
//
// Thrift — atoms can feed massive multi-MB BMCs, so the dab stream is squeezed hard and left gzip-friendly
// (the mint pipeline compresses before embedding):
//   • u,v,dn are u8. Dabs are decimated ≥0.006 apart; u8 resolution (0.0039) is finer, so nothing is lost
//     and it's visually identical (~2px on a 1024 texture). Half the size of u16.
//   • Dabs are stored STRUCTURE-OF-ARRAYS per stroke (all u's, then all v's, then all dn's) so gzip crushes
//     smooth spray paths. Shape headers stay exact (i32 mm) — there are only dozens; the megabytes are dabs.
(function () {
  'use strict';

  // ── reusable toolkit ────────────────────────────────────────────────
  function Writer() { this.b = []; }
  Writer.prototype.u8 = function (v) { this.b.push(v & 255); };
  Writer.prototype.u16 = function (v) { v &= 0xffff; this.b.push(v & 255, v >>> 8); };
  Writer.prototype.i16 = function (v) { this.u16(v < 0 ? v + 0x10000 : v); };
  Writer.prototype.u32 = function (v) { v >>>= 0; this.b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };
  Writer.prototype.i32 = function (v) { this.u32(v >>> 0); };
  Writer.prototype.varint = function (v) { v >>>= 0; while (v >= 0x80) { this.b.push((v & 0x7f) | 0x80); v >>>= 7; } this.b.push(v); };

  function Reader(bytes) { this.d = bytes; this.i = 0; }
  Reader.prototype.u8 = function () { return this.d[this.i++]; };
  Reader.prototype.u16 = function () { var v = this.d[this.i] | (this.d[this.i + 1] << 8); this.i += 2; return v >>> 0; };
  Reader.prototype.i16 = function () { var v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; };
  Reader.prototype.u32 = function () { var v = (this.d[this.i] | (this.d[this.i + 1] << 8) | (this.d[this.i + 2] << 16) | (this.d[this.i + 3] << 24)) >>> 0; this.i += 4; return v; };
  Reader.prototype.i32 = function () { return this.u32() | 0; };
  Reader.prototype.varint = function () { var v = 0, s = 0, b; do { b = this.d[this.i++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; };

  var TAU = Math.PI * 2;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function q(x, scale) { return Math.round(x * scale); }
  function b8(x) { return clamp(Math.round(x * 255), 0, 255); }          // [0,1] → u8
  function normAngle(a) { a = a % TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; } // → [-π,π]

  /** Structure-of-arrays dab writer: dabCount, then all u's, all v's, (optionally) all dn's — all u8. */
  function writeDabs(w, dabs, withDn) {
    var n = dabs.length, i;
    w.varint(n);
    for (i = 0; i < n; i++) w.u8(b8(dabs[i][0]));
    for (i = 0; i < n; i++) w.u8(b8(dabs[i][1]));
    if (withDn) for (i = 0; i < n; i++) w.u8(b8(dabs[i][2]));
  }
  function readDabs(r, withDn) {
    var n = r.varint(), us = new Array(n), vs = new Array(n), out = new Array(n), i;
    for (i = 0; i < n; i++) us[i] = r.u8();
    for (i = 0; i < n; i++) vs[i] = r.u8();
    if (withDn) { var dn = new Array(n); for (i = 0; i < n; i++) dn[i] = r.u8(); for (i = 0; i < n; i++) out[i] = [us[i] / 255, vs[i] / 255, dn[i] / 255]; }
    else for (i = 0; i < n; i++) out[i] = [us[i] / 255, vs[i] / 255, 0];
    return out;
  }

  // ── grafverse scene schema v2 — the BMF-SOLID record (docs/BMF-SOLID-SPEC.md) ──
  // A scene = a ground paint-atom + a list of SOLID records. Each shape record is the frozen wire:
  //   id u8 · resolution u8 · ratios u8[n] · pos i32×3 (mm) · rot i16×3 (Euler) · scale u16 (log mm) · paint.
  // Callers pass SEMANTIC values (metres, radians, plain ratios); the codec owns the frozen quantisation.
  // n (ratio count) is derived from the base solid, never stored. One shape = one owned paint unit.
  var SCENE_VERSION = 3;
  var RATIO_N = { 119: 1, 120: 1, 121: 0, 122: 2, 123: 1, 124: 1, 125: 1, 126: 2 };  // ratios per base solid (§4)
  function ratioN(id) { return RATIO_N[id] != null ? RATIO_N[id] : 0; }

  // ── id class ranges (§4 LOCKED map) — decide how the per-shape PARAM bytes after `res` are read ──
  var FRACTAL_LO = 160, FRACTAL_HI = 207, ID_COMPLEX = 254, ID_MESH = 255;
  function isFractal(id) { return id >= FRACTAL_LO && id <= FRACTAL_HI; }             // 160–207: seed u16
  // 254 complex model: model index u16 · 255 mesh: 32-byte txid · 119–159 primitive: n log-ratios · else: no params

  // ── material-flags byte — grain rotation (2b) · tiled|scaled (1b) · BOB (1b) · ROTATE (1b) · 3b reserved ──
  var MAT = { GRAIN: 3, TILED: 4, BOB: 8, SPIN: 16 };                                 // matFlags bit masks
  function encMat(m) { if (typeof m === 'number') return m & 255; if (!m) return 0; return ((m.grain || 0) & 3) | (m.tiled ? 4 : 0) | (m.bob ? 8 : 0) | (m.spin ? 16 : 0); }
  function decMat(b) { return { grain: b & 3, tiled: !!(b & 4), bob: !!(b & 8), spin: !!(b & 16) }; }   // grain 0–3 = 0°/90°/180°/270°; bob/spin = owned draw-time motion

  // ── paint-fx byte — per-stroke STACKABLE bitfield (aligned to nft.gift wig/twk; seed-driven, deterministic) ──
  var FX = { WIGGLE: 1, TWINKLE: 2, SPARKLE: 4, CRYSTAL: 8 };                          // bits 4–7 reserved

  // frozen encodings (§3): ratio & size are LOGARITHMIC; rotation is Euler XYZ.
  function log2(x) { return Math.log(x) / Math.LN2; }
  function encRatio(r) { return clamp(Math.round(128 + 25.6 * log2(r > 1e-6 ? r : 1e-6)), 0, 255); }   // 2^((raw-128)/25.6)
  function decRatio(raw) { return Math.pow(2, (raw - 128) / 25.6); }
  function encSize(mm) { return clamp(Math.round(65535 * log2(mm > 1 ? mm : 1) / 22), 0, 65535); }       // 2^(22·raw/65535)
  function decSize(raw) { return Math.pow(2, 22 * raw / 65535); }
  function encAngle(rad) { return clamp(Math.round(normAngle(rad) * 65536 / TAU), -32768, 32767); }       // deg = raw·360/65536
  function decAngle(raw) { return raw * TAU / 65536; }

  function packScene(scene) {
    var w = new Writer();
    w.u8(SCENE_VERSION);
    var g = scene.ground || [], i;
    w.varint(g.length);
    for (i = 0; i < g.length; i++) { w.u8(g[i].c & 255); w.u32(g[i].seed >>> 0); writeDabs(w, g[i].dabs, false); }
    var sh = scene.shapes || [], k, a;
    w.varint(sh.length);
    for (k = 0; k < sh.length; k++) {
      var m = sh[k], id = m.id & 255, n = ratioN(id), rat = m.ratios || [];
      w.u8(id);
      w.u8((m.res || 0) & 255);
      if (isFractal(id)) w.u16((m.seed >>> 0) & 0xffff);                              // 160–207 fractal: seed
      else if (id === ID_COMPLEX) w.u16((m.model >>> 0) & 0xffff);                    // 254 complex model: pack index
      else if (id === ID_MESH) writeTxid(w, m.mesh || (m.ref && m.ref.tx) || '');     // 255 mesh: geometry txid
      else for (a = 0; a < n; a++) w.u8(encRatio(rat[a] != null ? rat[a] : 1));       // 119–159 primitive: n log-ratios
      w.i32(q(m.pos[0], 1000)); w.i32(q(m.pos[1], 1000)); w.i32(q(m.pos[2], 1000));   // metres → mm
      w.i16(encAngle(m.rot[0])); w.i16(encAngle(m.rot[1])); w.i16(encAngle(m.rot[2]));
      w.u16(encSize(m.scale * 1000));                                                 // uniform size: m → mm → log
      w.u8(m.color & 255);                                                            // base colour — palette index (gem tint for a crystal)
      w.u8(m.tex & 255);                                                              // surface texture — library index (0 plain · 1 crystal · …)
      w.u8(encMat(m.matFlags != null ? m.matFlags : m.mat));                          // material flags — grain rotation · tiled/scaled
      var p = m.paint || { kind: 0 };
      w.u8(p.kind & 255);                                                             // owned paint layer: 0 none · 1 strokes · (2+ reserved: txid, per-surface)
      if (p.kind === 1) {                                                             // inline strokes
        var st = p.strokes || [];
        w.varint(st.length);
        for (a = 0; a < st.length; a++) { w.u8(st[a].si & 255); w.u8(st[a].c & 255); w.u8(st[a].fx & 255); w.u32(st[a].seed >>> 0); writeDabs(w, st[a].dabs, true); }
      }
    }
    return w.b; // number[] (0..255)
  }

  function unpackScene(bytes) {
    var r = new Reader(bytes);
    var ver = r.u8();
    if (ver !== SCENE_VERSION) throw new Error('unsupported scene version ' + ver);
    var ground = [], gn = r.varint(), i;
    for (i = 0; i < gn; i++) { var gc = r.u8(), gseed = r.u32(); ground.push({ c: gc, seed: gseed, dabs: readDabs(r, false) }); }
    var shapes = [], sn = r.varint(), k, a;
    for (k = 0; k < sn; k++) {
      var id = r.u8(), res = r.u8(), ratios = [], seed = null, model = null, mesh = null, n;
      if (isFractal(id)) seed = r.u16();                                              // 160–207 fractal
      else if (id === ID_COMPLEX) model = r.u16();                                    // 254 complex model
      else if (id === ID_MESH) mesh = readTxid(r);                                    // 255 mesh
      else { n = ratioN(id); for (a = 0; a < n; a++) ratios.push(decRatio(r.u8())); } // 119–159 primitive
      var pos = [r.i32() / 1000, r.i32() / 1000, r.i32() / 1000];
      var rot = [decAngle(r.i16()), decAngle(r.i16()), decAngle(r.i16())];
      var scale = decSize(r.u16()) / 1000;                                            // → metres
      var color = r.u8(), tex = r.u8();                                               // base colour index · surface texture index
      var matFlags = r.u8();                                                          // material flags — grain rotation · tiled/scaled
      var kind = r.u8(), paint;
      if (kind === 1) {
        var st = [], stn = r.varint(), b;
        for (b = 0; b < stn; b++) { var si = r.u8(), c = r.u8(), fx = r.u8(), sd = r.u32(); st.push({ si: si, c: c, fx: fx, seed: sd, dabs: readDabs(r, true) }); }
        paint = { kind: 1, strokes: st };
      } else paint = { kind: kind };                                                  // 0 none · 2+ reserved (a crystal is tex, not a paint kind)
      shapes.push({ id: id, res: res, ratios: ratios, seed: seed, model: model, mesh: mesh, pos: pos, rot: rot, scale: scale, color: color, tex: tex, matFlags: matFlags, mat: decMat(matFlags), paint: paint });
    }
    return { v: SCENE_VERSION, ground: ground, shapes: shapes };
  }

  // ── the UNIFORM REFERENCE — { tx, name? } — the universal pointer (BMF-FAMILY.md). Packed, never JSON. ──
  function writeTxid(w, tx) { tx = (tx || '').replace(/[^0-9a-fA-F]/g, ''); for (var i = 0; i < 32; i++) { var h = tx.substr(i * 2, 2); w.u8(h.length ? parseInt(h, 16) : 0); } }   // 64-hex → 32 bytes
  function readTxid(r) { var s = ''; for (var i = 0; i < 32; i++) { var b = r.u8(); s += (b < 16 ? '0' : '') + b.toString(16); } return s; }
  function writeStr(w, s) { s = s || ''; var e = (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(s) : null; if (e) { w.varint(e.length); for (var i = 0; i < e.length; i++) w.u8(e[i]); } else { w.varint(s.length); for (var j = 0; j < s.length; j++) w.u8(s.charCodeAt(j) & 255); } }   // varint len + UTF-8
  function readStr(r) { var n = r.varint(), a = new Uint8Array(n), i; for (i = 0; i < n; i++) a[i] = r.u8(); if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(a); var s = ''; for (i = 0; i < n; i++) s += String.fromCharCode(a[i]); return s; }
  function writeRef(w, ref) { if (!ref || !ref.tx) { w.u8(0); return; } if (ref.name) { w.u8(2); writeTxid(w, ref.tx); writeStr(w, ref.name); } else { w.u8(1); writeTxid(w, ref.tx); } }   // 0 none · 1 txid · 2 txid+member
  function readRef(r) { var tag = r.u8(); if (tag === 0) return null; var tx = readTxid(r), name = tag === 2 ? readStr(r) : null; return name != null ? { tx: tx, name: name } : { tx: tx }; }

  // ── BMF.timeline — the packed media manifest (binary .bmf) — PACKED replacement for the JSON/cue authoring forms ──
  var TIMELINE_VERSION = 1;
  function packTimeline(tl) {
    var w = new Writer(); w.u8(TIMELINE_VERSION);
    w.u16((tl.tempo || 0) & 0xffff);
    writeStr(w, tl.license || ''); writeStr(w, tl.attribution || '');
    writeRef(w, tl.audio || null);
    var sc = tl.scenes || [], i; w.varint(sc.length);
    for (i = 0; i < sc.length; i++) { var s = sc[i]; w.u32(q(s.t || 0, 1000)); writeRef(w, s.ref || (s.tx ? { tx: s.tx, name: s.name } : null)); }   // t = ms · ref = the component
    return w.b;
  }
  function unpackTimeline(bytes) {
    var r = new Reader(bytes), ver = r.u8();
    if (ver !== TIMELINE_VERSION) throw new Error('unsupported timeline version ' + ver);
    var tempo = r.u16(), license = readStr(r), attribution = readStr(r), audio = readRef(r);
    var n = r.varint(), scenes = [], i;
    for (i = 0; i < n; i++) { var t = r.u32() / 1000, ref = readRef(r); scenes.push({ t: t, ref: ref, tx: ref && ref.tx, name: ref && ref.name }); }
    return { v: ver, tempo: tempo, license: license, attribution: attribution, audio: audio, scenes: scenes };
  }

  // ── BMF.container — the packed .bmc INDEX (replaces the JSON bmc.json; the store-only ZIP still holds member bytes by file) ──
  var CONTAINER_VERSION = 1;
  function packIndex(idx) {
    var w = new Writer(); w.u8(CONTAINER_VERSION);
    writeStr(w, idx.name || 'set');
    var mem = idx.members || [], i; w.varint(mem.length);
    for (i = 0; i < mem.length; i++) { var m = mem[i]; writeStr(w, m.name || ''); writeStr(w, m.file || m.name || ''); writeStr(w, m.mime || ''); }
    return w.b;
  }
  function unpackIndex(bytes) {
    var r = new Reader(bytes), ver = r.u8();
    if (ver !== CONTAINER_VERSION) throw new Error('unsupported container-index version ' + ver);
    var name = readStr(r), n = r.varint(), members = [], i;
    for (i = 0; i < n; i++) members.push({ name: readStr(r), file: readStr(r), mime: readStr(r) });
    return { v: ver, name: name, members: members };
  }

  var BMF = {
    Writer: Writer, Reader: Reader, writeDabs: writeDabs, readDabs: readDabs, b8: b8, q: q, normAngle: normAngle,
    writeTxid: writeTxid, readTxid: readTxid, writeStr: writeStr, readStr: readStr,
    ref: { write: writeRef, read: readRef },
    scene: { VERSION: SCENE_VERSION, ratioN: ratioN, pack: packScene, unpack: unpackScene,
             encRatio: encRatio, decRatio: decRatio, encSize: encSize, decSize: decSize, encAngle: encAngle, decAngle: decAngle,
             isFractal: isFractal, ID_COMPLEX: ID_COMPLEX, ID_MESH: ID_MESH, encMat: encMat, decMat: decMat, MAT: MAT, FX: FX },
    timeline: { VERSION: TIMELINE_VERSION, pack: packTimeline, unpack: unpackTimeline },
    container: { VERSION: CONTAINER_VERSION, pack: packIndex, unpack: unpackIndex },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BMF;
  else (typeof window !== 'undefined' ? window : globalThis).BMF = BMF;
})();
