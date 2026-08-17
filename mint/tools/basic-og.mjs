// © BSV Association — Open BSV License v6.
// Render basic-og.png — the social card for basic.html, drawn from the REAL automaton.
//
//   node mint/tools/basic-og.mjs            # writes ../basic-og.png
//
// ★ The picture is Rule 110, computed by the same reference the covenant is checked against, so the
// card cannot drift from what the page actually does. It is the triangles, and they are the thing
// worth showing: a Turing-complete automaton whose every generation is one enforced transaction.
//
// ⚠ A FILE, NOT AN ENDPOINT — the same reasoning as battery-og.mjs. Social scrapers cache the first
// fetch whatever you do, so "live" is largely an illusion, and a committed file cannot break the page.
//
// ⚠ AND A PNG, WHICH IS NOT THE USUAL RULE HERE. SVG is this project's default and PNG is normally the
// corporate reflex — but social scrapers do not render SVG, so a share card is the one place a raster
// is the only thing that works. Stated so nobody "corrects" it later.
//
// Zero dependencies: node's own zlib, through the encoder battery-og.mjs already exports.
/* ⚠ THE ENCODER IS COPIED, NOT IMPORTED, AND THAT IS DELIBERATE. `battery-og.mjs` exports exactly the
   function wanted — but it also does its work at the TOP LEVEL, so importing it fetches the live
   battery, rewrites battery-og.png and edits battery.html's cache-busting tags. Importing it once did
   all three by accident. A module with side effects at import time is not a library, and forty lines
   of zlib is a cheaper fix than making it one. */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { r110New, r110Ref } from '../src/rule110.ts'

// ── minimal PNG encoder (zlib only) ────────────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const CARD_W = 1200, CARD_H = 630
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'basic-og.png')

// the page's own palette, so the card and the page are recognisably one thing
const BG = [0x08, 0x0e, 0x1a], INK = [0xf3, 0xf7, 0xff], CYAN = [0x38, 0xe1, 0xff]
const DIM = [0x7d, 0x92, 0xb8], LIME = [0xb4, 0xff, 0x3a]

const buf = Buffer.alloc(CARD_W * CARD_H * 3)
const px = (x, y, c) => {
  if (x < 0 || y < 0 || x >= CARD_W || y >= CARD_H) return
  const o = (y * CARD_W + x) * 3
  buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]
}
const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c) }
const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t))

// ── the ground: the page's radial wash, flattened ──────────────────────────────────────────────────
for (let y = 0; y < CARD_H; y++) {
  const t = Math.min(1, Math.hypot((y + 90) / CARD_H, 0) * 0.9)
  const row = mix([0x13, 0x25, 0x42], [0x05, 0x07, 0x0d], t)
  for (let x = 0; x < CARD_W; x++) buf.set(row, (y * CARD_W + x) * 3)
}

/* ── RULE 110 ITSELF, from the reference the covenant is tested against ────────────────────────────
   Wide enough to show the structure: the triangles only become obvious after a few dozen rows. */
const ROWS = 46, CELL = 12, GRID_W = 31 * CELL, GRID_H = ROWS * CELL
const GX = CARD_W - GRID_W - 64, GY = Math.round((CARD_H - GRID_H) / 2)
let st = r110New()
for (let r = 0; r < ROWS; r++) {
  for (let i = 0; i < 31; i++) {
    const on = (st.cells >> (30 - i)) & 1
    if (on) {
      /* Fading down the rows so the eye follows the growth, and it reads as a picture rather than a
         QR code. The colour is the page's own cyan → lime. */
      const c = mix(CYAN, LIME, r / ROWS)
      rect(GX + i * CELL, GY + r * CELL, CELL - 1, CELL - 1, c)
    }
  }
  st = r110Ref(st)
}

// ── the words ──────────────────────────────────────────────────────────────────────────────────────
/* A five-by-seven bitmap alphabet — enough for a card, and it keeps the file dependency-free.
   ⚠⚠ AND A MISSING GLYPH THROWS. The first run of this had no M, no V and no full stop, so the card
   came out reading "AS A PROGRA" and "GRAF ERSE CO" — silently, because an unknown character simply
   advanced the cursor and drew nothing. A renderer that quietly omits a letter produces a plausible
   word that is not the word, which is the same failure as a listing that skips an opcode. */
const FONT = {
  A: '01110100011000110001111111000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '11111001000010000100001000010011111', K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111', N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  R: '11110100011000111110101001001010001', S: '01111100001000001110000011000101110',
  T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  W: '10001100011000110101101011010101010', Y: '10001100010101000100001000010000100',
  M: '10001110111010110001100011000110001', V: '10001100011000110001100010101000100',
  J: '00111000100001000010000110010011000', Q: '01110100011000110001101011001001101',
  X: '10001100010101000100010101000110001', Z: '11111000010001000100010001000011111',
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11111000100010000010000110001011100',
  4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  '.': '00000000000000000000000000000000100', '-': '00000000000000011111000000000000000',
  ' ': '00000000000000000000000000000000000',
}
function text(str, x, y, scale, c) {
  let cx = x
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch]
    /* ⚠ LOUD, NOT BLANK. See the note on FONT — this is the whole reason it is a throw. */
    if (!g) throw new Error(`basic-og: no glyph for ${JSON.stringify(ch)} — the card would have ` +
      `rendered ${JSON.stringify(str)} with a hole in it and said nothing`)
    if (g.length !== 35) throw new Error(`basic-og: the glyph for ${ch} is ${g.length} cells, not 35`)
    for (let r = 0; r < 7; r++) for (let i = 0; i < 5; i++) {
      if (g[r * 5 + i] === '1') rect(cx + i * scale, y + r * scale, scale, scale, c)
    }
    cx += 6 * scale
  }
  return cx
}

/* Every glyph checked for width before a pixel is drawn, so a typo in the table above is a startup
   error rather than a letter that comes out looking almost right. */
for (const [ch, g] of Object.entries(FONT)) {
  if (g.length !== 35) throw new Error(`basic-og: glyph ${ch} is ${g.length} cells, not 35`)
}

const LX = 64
text('BITCOIN', LX, 200, 9, INK)
text('BASIC', LX, 275, 9, CYAN)
rect(LX, 360, 300, 2, [0x4a, 0x6a, 0x9a])
text('READ ANY SCRIPT', LX, 392, 4, DIM)
text('AS A PROGRAM', LX, 424, 4, DIM)
text('AND WRITE ONE BACK', LX, 456, 4, DIM)
text('GRAFVERSE.COM', LX, 530, 3, [0x4a, 0x6a, 0x9a])

writeFileSync(OUT, encodePNG(buf, CARD_W, CARD_H))
console.log(`wrote ${OUT}  ${CARD_W}×${CARD_H}  · Rule 110, ${ROWS} generations, from the reference`)
