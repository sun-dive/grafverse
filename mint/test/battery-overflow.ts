// © 2026 sun-dive — Apache License 2.0.
// CAN THE STATE OVERFLOW ITS FIELDS AT HIGH RESOLUTION?
//
//   node --experimental-strip-types mint/test/battery-overflow.ts
//
// This exists because `fixedField` FAILS SILENTLY. It writes n bytes and discards anything above them,
// and then ORs the sign bit into the top byte — so a value one past the limit does not throw, it comes
// back as a different number and the covenant computes a different picture forever. There is no key to
// amend a genesis, so "it looked fine at 4K" is not a standard worth minting against.
//
// Two independent hazards, and they fail in different ways:
//
//   1. FIELD WIDTH. cr/ci/zr/zi/step/cx/cy are 5 bytes sign-magnitude (|v| < 2^39) and i/mx are 2
//      (|v| < 2^15). Exceeding either is silent corruption.
//
//   2. DOUBLE PRECISION. The reference implementation is written in doubles, and `2 * zr * zi` reaches
//      2^67 — far past the 2^53 where a double stops representing every integer. The claim is that
//      dividing by 2^32 and truncating discards the error before it can matter. That is a claim about
//      the low bits of a product that is not exactly representable, so it is checked here against exact
//      BigInt arithmetic rather than assumed.
import {
  genesisState, refState, fixedField, buildBatteryLock, mulShift, BATTERY_GEOMETRY,
  FIELDS, FIELD_WIDTHS, S, ESCAPE, step0,
  type BatteryState, type BatteryGeometry,
} from '../src/battery.ts'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}

/** Decode a fixed-width sign-magnitude field — the inverse of `fixedField`. */
function readField(b: number[], n: number): number {
  let x = 0
  for (let k = n - 1; k >= 0; k--) x = x * 256 + (k === n - 1 ? (b[k] & 0x7f) : b[k])
  return (b[n - 1] & 0x80) ? -x : x
}

/** The limit for an n-byte sign-magnitude field: the 0x80 bit of the top byte is the SIGN. */
const limitFor = (n: number): number => Math.pow(2, 8 * n - 1)

// ── 0. the serialiser really does fail silently, so the rest of this test is warranted ────────────
{
  const w = 5, lim = limitFor(w)
  check('a value inside the field round-trips', readField(fixedField(lim - 1, w), w) === lim - 1)
  check('a value one PAST the limit does NOT round-trip (silent corruption)',
    readField(fixedField(lim, w), w) === lim, false)
  check('...and it does not throw either — nothing would warn us',
    (() => { try { fixedField(lim * 4, w); return true } catch { return false } })())
}

const BASE = {
  SPAN0: 4.0,
  TX: Math.round(-1.423288564770 * S), TY: Math.round(0.127278891029 * S),
  MXCAP: 32767,
}
// 4:3 and 16:9 both — nothing in the script requires an aspect, so both are candidates, and a result
// proved at 4:3 says nothing about 16:9 on its own.
const GRIDS: Array<[number, number]> = [
  [BATTERY_GEOMETRY.W, BATTERY_GEOMETRY.H],                 // ← THE ONE BEING MINTED, first
  [256, 192], [1024, 768], [2048, 1536], [4096, 3072],      // 4:3
  [1280, 720], [1920, 1080], [2560, 1440],                  // 16:9
]
/* THE ACTUAL GENESIS PARAMETERS. This ran at K = 16 while the genesis moved to K = 128, so level 21
   reached maxIter 448 here and 2,688 in reality — the test was proving the wrong covenant safe. Taken
   from BATTERY_GEOMETRY now, so it cannot drift from what is being minted. */
const MX0 = BATTERY_GEOMETRY.MX0, K = BATTERY_GEOMETRY.K, LEVELS = 21

/** Geometry of level L: step halves, the centre quarters its residual toward the target. */
function levelGeom(g: BatteryGeometry, L: number): { step: number; cx: number; cy: number; mx: number } {
  let step = step0(g), cx = 0, cy = 0, mx = g.MX0
  for (let i = 1; i < L; i++) {
    step = Math.trunc(step / 2)
    mx = Math.min(g.MXCAP, mx + g.K)
    cx = cx + Math.trunc((g.TX - cx) * 3 / 4)
    cy = cy + Math.trunc((g.TY - cy) * 3 / 4)
  }
  return { step, cx, cy, mx }
}

// ── 1. every field, at every level, over the whole descent ────────────────────────────────────────
// The extremes of cr/ci live at the frame corners, so those are tested exactly rather than sampled.
// zr/zi are bounded by the escape test, but the bound is asserted from observation, not trusted.
console.log('BATTERY · overflow — can any field exceed its width at high resolution?\n')

for (const [W, H] of GRIDS) {
  const g: BatteryGeometry = { ...BASE, W, H, MX0, K } as BatteryGeometry
  const worst: Record<string, number> = {}
  const note = (k: string, v: number): void => { if (Math.abs(v) > (worst[k] ?? 0)) worst[k] = Math.abs(v) }

  for (let L = 1; L <= LEVELS; L++) {
    const { step, cx, cy, mx } = levelGeom(g, L)
    const HW = Math.floor(W / 2), HH = Math.floor(H / 2)
    const cr0 = cx - HW * step, ci0 = cy - HH * step
    const crMax = cr0 + (W - 1) * step, ciMax = ci0 + (H - 1) * step
    note('cr', cr0); note('cr', crMax); note('ci', ci0); note('ci', ciMax)
    note('cx', cx); note('cy', cy); note('step', step); note('mx', mx)

    // Sample the frame — corners, edges and interior. The corners carry the largest |c|, which is what
    // drives |zr| after an update, so they are always included.
    const XS = [0, 1, HW, W - 2, W - 1], YS = [0, 1, HH, H - 2, H - 1]
    const xs = new Set<number>(XS), ys = new Set<number>(YS)
    for (let n = 0; n < 40; n++) { xs.add(Math.floor(n * (W - 1) / 39)); ys.add(Math.floor(n * (H - 1) / 39)) }
    for (const y of ys) for (const x of xs) {
      const cr = cr0 + x * step, ci = ci0 + y * step
      let zr = 0, zi = 0, i = 0
      while (i < mx) {
        const zr2 = mulShift(zr, zr), zi2 = mulShift(zi, zi)
        if (zr2 + zi2 > ESCAPE) break
        const nzi = mulShift(2 * zr, zi) + ci
        zr = zr2 - zi2 + cr; zi = nzi; i++
        note('zr', zr); note('zi', zi); note('i', i)
      }
    }
  }

  const over = FIELDS.filter(k => worst[k] !== undefined && worst[k] >= limitFor(FIELD_WIDTHS[k]))
  const head = FIELDS.map(k => `${k}=${((worst[k] ?? 0) / limitFor(FIELD_WIDTHS[k]) * 100).toFixed(3)}%`)
  console.log(`  ${String(W + 'x' + H).padEnd(11)} worst field use: ${head.join(' ')}`)
  check(`${W}x${H}: no field reaches its width`, over.length === 0)
  // and prove it through the real serialiser, not just by comparing numbers
  const rt = FIELDS.every(k => {
    const v = Math.round(worst[k] ?? 0), w = FIELD_WIDTHS[k]
    return readField(fixedField(v, w), w) === v && readField(fixedField(-v, w), w) === -v
  })
  check(`${W}x${H}: every worst-case value round-trips through fixedField`, rt)
}

// ── 2. the doubles must agree with exact integers, at 4K ──────────────────────────────────────────
// `2 * zr * zi` reaches 2^67. A double holds every integer only to 2^53, so this product is NOT exactly
// representable and the reference implementation depends on the error vanishing under the /2^32 truncate.
// Checked against BigInt, which has no such limit. BigInt division truncates toward zero, matching
// Math.trunc — so the two are directly comparable.
{
  const SB = BigInt(S), ESCB = BigInt(ESCAPE)
  const g: BatteryGeometry = { ...BASE, W: 4096, H: 3072, MX0, K } as BatteryGeometry
  let ops = 0, drift = 0, maxProduct = 0

  for (const L of [1, 2, 3, 8, 14, 20, 21]) {
    const { step, cx, cy, mx } = levelGeom(g, L)
    const cr0 = cx - 2048 * step, ci0 = cy - 1536 * step
    for (let n = 0; n < 900; n++) {
      const x = (n * 1637) % 4096, y = (n * 977) % 3072
      const cr = cr0 + x * step, ci = ci0 + y * step
      let zr = 0, zi = 0, i = 0
      let bzr = 0n, bzi = 0n
      const bcr = BigInt(cr), bci = BigInt(ci)
      while (i < mx) {
        const zr2 = mulShift(zr, zr), zi2 = mulShift(zi, zi)     // the SHIPPED path, not a copy
        const bzr2 = (bzr * bzr) / SB, bzi2 = (bzi * bzi) / SB
        if (BigInt(zr2) !== bzr2 || BigInt(zi2) !== bzi2) drift++
        if (zr2 + zi2 > ESCAPE) { if (!(bzr2 + bzi2 > ESCB)) drift++; break }
        if (bzr2 + bzi2 > ESCB) drift++            // the two must break on the SAME iteration
        maxProduct = Math.max(maxProduct, Math.abs(2 * zr * zi))
        const nzi = mulShift(2 * zr, zi) + ci
        const bnzi = (2n * bzr * bzi) / SB + bci
        if (BigInt(nzi) !== bnzi) drift++
        zr = zr2 - zi2 + cr; zi = nzi; i++
        bzr = bzr2 - bzi2 + bcr; bzi = bnzi
        if (BigInt(zr) !== bzr || BigInt(zi) !== bzi) drift++
        ops++
      }
    }
  }
  console.log(`\n  4096x3072: ${ops.toLocaleString()} iterations cross-checked against exact BigInt`)
  console.log(`  largest intermediate |2·zr·zi| = 2^${Math.log2(maxProduct).toFixed(1)} ` +
    `(a double is exact only to 2^53)`)
  check('mulShift never disagrees with exact integers at 4K', drift === 0)
  // and prove the test would have CAUGHT the old bug, or it proves nothing
  {
    let naive = 0
    const g2: BatteryGeometry = { ...BASE, W: 4096, H: 3072, MX0, K } as BatteryGeometry
    const { step, cx, cy, mx } = levelGeom(g2, 8)
    const cr0 = cx - 2048 * step, ci0 = cy - 1536 * step
    for (let n = 0; n < 900; n++) {
      const x = (n * 1637) % 4096, y = (n * 977) % 3072
      const cr = cr0 + x * step, ci = ci0 + y * step
      let zr = 0, zi = 0, i = 0
      while (i < mx) {
        const oldZr2 = Math.trunc(zr * zr / S)          // what the code used to do
        if (BigInt(oldZr2) !== (BigInt(zr) * BigInt(zr)) / SB) naive++
        const zr2 = mulShift(zr, zr), zi2 = mulShift(zi, zi)
        if (zr2 + zi2 > ESCAPE) break
        const nzi = mulShift(2 * zr, zi) + ci
        zr = zr2 - zi2 + cr; zi = nzi; i++
      }
    }
    check('the old Math.trunc path DOES disagree — this test can detect the bug', naive > 0)
  }
}

// ── 3. and the whole thing still builds a valid lock at 4K ────────────────────────────────────────
{
  const g: BatteryGeometry = { ...BASE, W: 4096, H: 3072, MX0, K } as BatteryGeometry
  const s0 = genesisState(g)
  const lock = buildBatteryLock({ state: s0, geometry: g })
  check('a 4K genesis lock assembles', lock.toBinary().length > 1000)
  // walk a few real ticks through the reference implementation and re-serialise each one
  let st: BatteryState = s0, ok = true
  for (let n = 0; n < 400; n++) {
    st = refState(st, g)
    for (const k of FIELDS) {
      const w = FIELD_WIDTHS[k]
      if (readField(fixedField(st[k], w), w) !== st[k]) { ok = false; break }
    }
    if (!ok) break
  }
  check('400 real ticks at 4K all serialise and round-trip exactly', ok)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY OVERFLOW: FAIL'); process.exit(1) }
console.log('BATTERY OVERFLOW OK — no field approaches its width, and the doubles are exact.')
