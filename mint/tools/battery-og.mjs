// © BSV Association — Open BSV License v6.
// Render battery-og.png — the social card for battery.html, showing the REAL picture the chain has paid
// for, exactly as the page draws it: solid where the covenant has computed, ghosted where it has not.
//
//   node mint/tools/battery-og.mjs            # reads the live battery, writes ../battery-og.png
//
// Re-run whenever the picture has moved enough to be worth re-sharing. Deliberately a FILE and not a
// live endpoint: social scrapers cache the first fetch regardless, so "live" is largely an illusion —
// and a committed file cannot break the page. (GD IS available on the host, so a rendering endpoint is
// possible later; a cron running this script gets the same result with less that can go wrong.)
//
// Zero dependencies — the PNG is encoded here with node's own zlib. The arithmetic is the same
// multiply-first-divide-last order the covenant uses, so this card cannot drift from the chain.
import { deflateSync } from 'node:zlib'
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const W = 256, H = 192, S = Math.pow(2, 32), ESC = 4 * S
const SCALE = 3                                  // integer scale keeps every pixel crisp
const CARD_W = 1200, CARD_H = 630                // the standard OG card
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'battery-og.png')

// ── the battery's own arithmetic ───────────────────────────────────────────────────────────────────
function escapeCount(cr, ci, mx) {
  let zr = 0, zi = 0, i = 0
  while (i < mx) {
    const zr2 = Math.trunc(zr * zr / S), zi2 = Math.trunc(zi * zi / S)
    if (zr2 + zi2 > ESC) break
    const nzi = Math.trunc(2 * zr * zi / S) + ci   // multiply first, divide last
    zr = zr2 - zi2 + cr; zi = nzi; i++
  }
  return i
}

// ── a 5x7 pixel font, just enough for the mark. Pixel type on a pixel picture. ──────────────────────
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
}

export function renderCard(state) {
  const { step, cx, cy, mx, cr: sCr, ci: sCi } = state
  const cr0 = cx - (W / 2) * step, ci0 = cy - (H / 2) * step
  const col = Math.round((sCr - cr0) / step), row = Math.round((sCi - ci0) / step)
  const done = row * W + col

  const px = Buffer.alloc(CARD_W * CARD_H * 3)
  const bg = [5, 7, 13]
  for (let i = 0; i < CARD_W * CARD_H; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2] }

  const imgW = W * SCALE, imgH = H * SCALE
  const ox = ((CARD_W - imgW) / 2) | 0, oy = ((CARD_H - imgH) / 2) | 0
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= CARD_W || y >= CARD_H) return
    const o = (y * CARD_W + x) * 3; px[o] = r | 0; px[o + 1] = g | 0; px[o + 2] = b | 0
  }

  for (let p = 0; p < W * H; p++) {
    const x = p % W, y = (p - x) / W
    const i = escapeCount(cr0 + x * step, ci0 + y * step, mx)
    const inside = i >= mx
    let r, g, b
    if (inside) { r = 8; g = 12; b = 22 }
    else {
      const t = i / mx
      if (t < 0.5) { const u = t / 0.5; r = 180 + 75 * u; g = 255 - 93 * u; b = 58 - 12 * u }
      else { const v = (t - 0.5) / 0.5; r = 255; g = 162 - 85 * v; b = 46 + 111 * v }
    }
    const lit = p < done
    if (!lit) {
      /* The ghost has to READ as a Mandelbrot at preview size while still being obviously unpaid-for.
         Too faint and a shared link looks like a smudge; too bright and it claims work nobody did.
         0.42 is the point where the shape is unmistakable and the solid pixels still clearly lead. */
      const a = 0.42
      r = bg[0] + (r - bg[0]) * a; g = bg[1] + (g - bg[1]) * a; b = bg[2] + (b - bg[2]) * a
      if (inside) { r = 16; g = 22; b = 40 }      // lifted off the card background so the SET shape shows
    }
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) put(ox + x * SCALE + dx, oy + y * SCALE + dy, r, g, b)
  }

  // The frontier — where the paid-for work stops. A single pixel vanishes at preview size, so draw a
  // short cursor above and below the scan point: the eye needs to find "it got to here".
  if (done > 0 && done < W * H) {
    const fx = done % W, fy = (done - (done % W)) / W
    for (let k = -4; k <= 4; k++) for (let dx = 0; dx < SCALE; dx++) for (let dy = 0; dy < SCALE; dy++)
      put(ox + fx * SCALE + dx, oy + (fy + k) * SCALE + dy, 56, 225, 255)
  }

  // GRAFVERSE.COM, bottom right
  const text = 'GRAFVERSE.COM', ts = 4, cw = 6 * ts
  let tx = CARD_W - 34 - text.length * cw, ty = CARD_H - 34 - 7 * ts
  for (const ch of text) {
    const gl = FONT[ch]
    if (gl) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (gl[r][c] === '1') for (let dy = 0; dy < ts; dy++) for (let dx = 0; dx < ts; dx++) put(tx + c * ts + dx, ty + r * ts + dy, 56, 225, 255)
    }
    tx += cw
  }
  return px
}

// ── minimal PNG encoder (zlib only) ────────────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
export function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const d = await (await fetch('https://grafverse.com/battery.php')).json()
if (!d.state) { console.error('could not read the battery state'); process.exit(1) }
const png = encodePNG(renderCard(d.state), CARD_W, CARD_H)
writeFileSync(OUT, png)
const doneP = (d.progress * 100).toFixed(4)
console.log(`  tick ${d.ticks} · frame ${d.level} · ${doneP}% drawn · ${d.fuel.toLocaleString()} sat`)
console.log(`  wrote ${OUT}  (${CARD_W}x${CARD_H}, ${(png.length / 1024).toFixed(1)} KB)`)

/* Stamp the tick into the og:image URL. Without this the card is cached FOREVER by every platform that
   has ever unfurled the page — regenerating the PNG changes nothing they will ever look at again. And
   the page URL cannot be used to bust it, because og:url declares a canonical address without a query,
   which well-behaved unfurlers key their cache on. So the IMAGE url has to carry the version. */
const HTML = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'battery.html')
const before = readFileSync(HTML, 'utf8')
const after = before.replace(/battery-og\.png(\?v=\d+)?/g, `battery-og.png?v=${d.ticks}`)
if (after !== before) {
  writeFileSync(HTML, after)
  const n = (after.match(/battery-og\.png\?v=/g) || []).length
  console.log(`  battery.html: ${n} image refs → battery-og.png?v=${d.ticks}`)
} else {
  console.log(`  battery.html already at ?v=${d.ticks}`)
}
