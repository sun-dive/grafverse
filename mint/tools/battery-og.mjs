// © 2026 sun-dive — Apache License 2.0.
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
const SCALE = 2                                  // integer scale keeps every pixel crisp
const PANEL_W = W * 2, PANEL_H = H * 2           // the fractal panel; the card is composed around it
const CARD_W = 1200, CARD_H = 630                // the standard OG card
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'battery-og.png')
const PANEL = join(ROOT, '.battery-panel.png')

// ── the battery's own arithmetic ───────────────────────────────────────────────────────────────────
/** Exact trunc(a·b / 2³²) — see mulShift() in ../src/battery.ts. A double is exact only to 2^53 and
 *  zr·zr reaches 2^66, so Math.trunc(a*b/S) is not reliable here. */
function mulShift(a, b) {
  const neg = (a < 0) !== (b < 0), x = Math.abs(a), y = Math.abs(b)
  const xh = Math.floor(x / 65536), xl = x - xh * 65536
  const yh = Math.floor(y / 65536), yl = y - yh * 65536
  const mid = xh * yl + xl * yh, midHi = Math.floor(mid / 65536), midLo = mid - midHi * 65536
  const q = xh * yh + midHi + Math.floor((midLo * 65536 + xl * yl) / 4294967296)
  return neg ? -q : q
}

/** Escape count AND |z|² at escape — the magnitude is what smooth shading needs. */
function escapeCount(cr, ci, mx) {
  let zr = 0, zi = 0, i = 0, emag = 0
  while (i < mx) {
    const zr2 = mulShift(zr, zr), zi2 = mulShift(zi, zi)
    if (zr2 + zi2 > ESC) { emag = zr2 + zi2; break }
    const nzi = mulShift(2 * zr, zi) + ci          // trunc(2·zr·zi/S), as Script computes it
    zr = zr2 - zi2 + cr; zi = nzi; i++
  }
  return { i, emag }
}

// ── the fractal panel ───────────────────────────────────────────────────────────────────────────────
// Just the picture, at its own size. All type is set by ImageMagick with real fonts — a hand-rolled 5x7
// bitmap scaled up was never going to look like anything but a hand-rolled bitmap scaled up.
export function renderPanel(state) {
  const { step, cx, cy, mx, cr: sCr, ci: sCi } = state
  const cr0 = cx - (W / 2) * step, ci0 = cy - (H / 2) * step
  const col = Math.round((sCr - cr0) / step), row = Math.round((sCi - ci0) / step)
  const done = row * W + col

  const px = Buffer.alloc(PANEL_W * PANEL_H * 3)
  const bg = [5, 7, 13]
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= PANEL_W || y >= PANEL_H) return
    const o = (y * PANEL_W + x) * 3; px[o] = r | 0; px[o + 1] = g | 0; px[o + 2] = b | 0
  }

  for (let p = 0; p < W * H; p++) {
    const x = p % W, y = (p - x) / W
    const { i, emag } = escapeCount(cr0 + x * step, ci0 + y * step, mx)
    const inside = i >= mx
    let r, g, b
    // MUST MATCH batteryInk() in battery.html and battery_panel() in battery-og.php.
    if (inside) { r = 6; g = 9; b = 16 }
    else {
      let v = i
      if (emag > 0) {
        const m = Math.sqrt(emag / S)
        if (m > 1.0000001) { const q = i + 1 - Math.log(Math.log(m)) / Math.LN2; if (isFinite(q)) v = q }
      }
      const t = Math.max(0, Math.min(1, (v % 32) / 32))    // BAND = 32, clamped as in battery.html
      r = 255 * Math.min(1, t * 2.1)
      g = 190 * Math.pow(t, 1.5)
      b = 90 + 165 * Math.pow(1 - t, 1.7)
    }
    if (p >= done) {                              // the ghost: what the chain has not yet paid for
      const a = 0.42
      r = bg[0] + (r - bg[0]) * a; g = bg[1] + (g - bg[1]) * a; b = bg[2] + (b - bg[2]) * a
      if (inside) { r = 16; g = 22; b = 40 }
    }
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++)
      put(x * SCALE + dx, y * SCALE + dy, r, g, b)
  }
  if (done > 0 && done < W * H) {                 // the frontier
    const fx = done % W, fy = (done - (done % W)) / W
    for (let k = -3; k <= 3; k++) for (let dx = 0; dx < SCALE; dx++) for (let dy = 0; dy < SCALE; dy++)
      put(fx * SCALE + dx, (fy + k) * SCALE + dy, 56, 225, 255)
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

import { execFileSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'

const d = await (await fetch('https://grafverse.com/battery.php')).json()
if (!d.state) { console.error('could not read the battery state'); process.exit(1) }

// 1) our own renderer draws the picture; nothing else
writeFileSync(PANEL, encodePNG(renderPanel(d.state), PANEL_W, PANEL_H))

// 2) ImageMagick sets the type. execFile with an ARGUMENT ARRAY, never a shell string — the marks are
//    user-supplied bytes from a public chain and must never be able to become part of a command.
//    Marks go through PANGO, which does automatic font fallback, so an emoji in a mark renders as the
//    emoji rather than a tofu box. Pango reads markup, so the text is XML-escaped as well as un-shelled.
const SANS = 'DejaVu-Sans', SANS_B = 'DejaVu-Sans-Bold', MONO = 'DejaVu-Sans-Mono-Bold'
const INK = '#f3f7ff', DIM = '#aebfe0', FAINT = '#7d92b8', CYAN = '#38e1ff', LIME = '#b4ff3a'
const fmt = n => (n || 0).toLocaleString('en-US')
const xml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PX = 44, PY = 104                              // the panel, upper-left
const RX = PX + PANEL_W + 46                         // where the right column starts
const args = ['-size', `${CARD_W}x${CARD_H}`, 'xc:#05070d',
  PANEL, '-geometry', `+${PX}+${PY}`, '-composite',
  // a hairline around the picture so it reads as a framed artefact, not a bleed
  '-fill', 'none', '-stroke', '#1b2740', '-strokewidth', '1',
  '-draw', `rectangle ${PX - 1},${PY - 1} ${PX + PANEL_W},${PY + PANEL_H}`, '-stroke', 'none',
  '-fill', FAINT, '-font', SANS, '-pointsize', '13',
  '-annotate', `+${PX}+${PY + PANEL_H + 26}`, 'solid = computed on chain   ·   faint = not yet paid for',

  '-fill', INK, '-font', SANS_B, '-pointsize', '36',
  '-annotate', `+${RX}+${PY + 30}`, 'The Bitcoin Battery',
  '-fill', DIM, '-font', SANS, '-pointsize', '17',
  '-annotate', `+${RX}+${PY + 60}`, 'a program that pays for its own execution',
  '-fill', FAINT, '-font', SANS, '-pointsize', '15',
  '-annotate', `+${RX}+${PY + 92}`,
    `tick ${fmt(d.ticks)}   ·   frame ${d.level}   ·   ${fmt(d.fuel)} sat of fuel`,
]

// the board — top funders, straight from the chain
const board = (d.board || []).slice(0, 9)
args.push('-fill', FAINT, '-font', SANS_B, '-pointsize', '13',
          '-annotate', `+${RX}+${PY + 136}`, board.length ? 'TOP FUNDERS' : 'NOBODY HAS FUNDED IT YET')
let y = PY + 166
for (const b of board) {
  const mark = (b.mark || '').replace(/\s+/g, ' ').trim().slice(0, 28) || '(no mark)'
  args.push('-fill', LIME, '-font', MONO, '-pointsize', '15',
            '-annotate', `+${RX}+${y}`, `${fmt(b.sats)}`.padStart(9) + ' sat')
  // the mark via Pango, so emoji survive
  args.push('(', '-background', 'none', 'pango:' +
    `<span font="DejaVu Sans 11.5" foreground="${DIM}">${xml(mark)}</span>`, ')',
    '-geometry', `+${RX + 122}+${y - 13}`, '-composite')
  y += 27
}
const more = (d.board || []).length - board.length
if (more > 0) {
  args.push('-fill', FAINT, '-font', SANS, '-pointsize', '13',
            '-annotate', `+${RX}+${y + 6}`, `and ${more} more`)
  y += 26
}

// the claim, which also stops a short board leaving a hole
/* An INDEXED png, not truecolor. The card is flat colour bands and type, not a photograph, so a 256
   colour palette is visually identical (RMSE 0.0007) and drops 91 KB to 18 KB — the same size as
   LOSSLESS WEBP, without WebP's og:image compatibility risk. Support is patchy across platforms and
   the failure mode is no preview image at all, which is the one thing an OG card must never do. */
args.push('-fill', FAINT, '-font', SANS, '-pointsize', '14',
          '-annotate', `+${RX}+${CARD_H - 92}`, 'No toll gate. Every satoshi pays a miner.',
          '-fill', CYAN, '-font', SANS_B, '-pointsize', '22',
          '-annotate', `+${RX}+${CARD_H - 58}`, 'grafverse.com/battery.html',
          '-colors', '256', 'PNG8:' + OUT)

execFileSync('magick', args, { stdio: 'pipe' })
unlinkSync(PANEL)


const doneP = (d.progress * 100).toFixed(4)
console.log(`  tick ${d.ticks} · frame ${d.level} · ${doneP}% drawn · ${d.fuel.toLocaleString()} sat`)
console.log(`  board: ${board.length} funder${board.length === 1 ? '' : 's'} listed`)
console.log(`  wrote ${OUT}  (${CARD_W}x${CARD_H})`)

/* Stamp the tick into the og:image URL. Without this the card is cached FOREVER by every platform that
   has ever unfurled the page — regenerating the PNG changes nothing they will ever look at again. And
   the page URL cannot be used to bust it, because og:url declares a canonical address without a query,
   which well-behaved unfurlers key their cache on. So the IMAGE url has to carry the version. */
const HTML = join(ROOT, 'battery.html')
const before = readFileSync(HTML, 'utf8')
const after = before.replace(/battery-og\.png(\?v=\d+)?/g, `battery-og.png?v=${d.ticks}`)
if (after !== before) {
  writeFileSync(HTML, after)
  console.log(`  battery.html: image refs → battery-og.png?v=${d.ticks}`)
}
