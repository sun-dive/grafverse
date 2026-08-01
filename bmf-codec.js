// BMF codec — the canonical THRIFTY JSON→packed-byte format for the art apps (grafspace and the others).
// ONE shared design, vendored per app (like three.min.js) so it never drifts. Two layers:
//   • BMF.*          — the reusable toolkit: Writer/Reader (LE ints + varint), SoA dab codec, quantisers.
//   • BMF.scene.*    — grafspace's schema on top of the toolkit (ground strokes + shape atoms).
// Other apps reuse BMF.* and add their own schema module next to BMF.scene.
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

  // ── grafspace scene schema (layered on the toolkit) ─────────────────
  var SCENE_VERSION = 1;
  var TYPES = ['box', 'wall', 'plane', 'cylinder', 'cone', 'pyramid', 'sphere'];

  function packScene(world) {
    var w = new Writer();
    w.u8(SCENE_VERSION);
    var g = world.ground || [], i;
    w.varint(g.length);
    for (i = 0; i < g.length; i++) { w.u8(g[i].c & 255); w.u32(g[i].seed >>> 0); writeDabs(w, g[i].dabs, false); }
    var sh = world.shapes || [], k;
    w.varint(sh.length);
    for (k = 0; k < sh.length; k++) {
      var m = sh[k], t = TYPES.indexOf(m.t); if (t < 0) t = 0;
      w.u8(t);
      w.i32(q(m.p[0], 1000)); w.i32(q(m.p[1], 1000)); w.i32(q(m.p[2], 1000));
      w.i16(q(normAngle(m.r[0]), 10000)); w.i16(q(normAngle(m.r[1]), 10000)); w.i16(q(normAngle(m.r[2]), 10000));
      w.u16(clamp(q(m.s[0], 1000), 0, 65535)); w.u16(clamp(q(m.s[1], 1000), 0, 65535)); w.u16(clamp(q(m.s[2], 1000), 0, 65535));
      w.u8(m.paid ? 1 : 0);
      var st = m.st || [], a;
      w.varint(st.length);
      for (a = 0; a < st.length; a++) { w.u8(st[a].si & 255); w.u8(st[a].c & 255); w.u32(st[a].seed >>> 0); writeDabs(w, st[a].dabs, true); }
    }
    return w.b; // number[] (0..255)
  }

  function unpackScene(bytes) {
    var r = new Reader(bytes);
    var ver = r.u8();
    if (ver !== SCENE_VERSION) throw new Error('unsupported scene version ' + ver);
    var ground = [], gn = r.varint(), i;
    for (i = 0; i < gn; i++) { var gc = r.u8(), gseed = r.u32(); ground.push({ c: gc, seed: gseed, dabs: readDabs(r, false) }); }
    var shapes = [], sn = r.varint(), k;
    for (k = 0; k < sn; k++) {
      var t = TYPES[r.u8()] || 'box';
      var p = [r.i32() / 1000, r.i32() / 1000, r.i32() / 1000];
      var rot = [r.i16() / 10000, r.i16() / 10000, r.i16() / 10000];
      var sc = [r.u16() / 1000, r.u16() / 1000, r.u16() / 1000];
      var paid = !!r.u8();
      var st = [], stn = r.varint(), a;
      for (a = 0; a < stn; a++) { var si = r.u8(), scol = r.u8(), sseed = r.u32(); st.push({ si: si, c: scol, seed: sseed, dabs: readDabs(r, true) }); }
      shapes.push({ t: t, p: p, r: rot, s: sc, paid: paid, st: st });
    }
    return { v: 1, ground: ground, shapes: shapes };
  }

  var BMF = {
    Writer: Writer, Reader: Reader, writeDabs: writeDabs, readDabs: readDabs, b8: b8, q: q, normAngle: normAngle,
    scene: { VERSION: SCENE_VERSION, TYPES: TYPES, pack: packScene, unpack: unpackScene },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BMF;
  else (typeof window !== 'undefined' ? window : globalThis).BMF = BMF;
})();
