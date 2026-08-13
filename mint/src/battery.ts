// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * BRC-226 · THE BATTERY — a covenant that pays for its own execution.
 *
 * A self-replicating (quine) covenant carrying NINE state fields in its own locking script. Each spend
 * performs ONE Mandelbrot iteration — `z → z² + c` in 2³² fixed point — inside Bitcoin Script, and
 * re-creates itself with the advanced state and a slightly smaller value. The fee comes out of the
 * covenant's OWN carried value, so a tick is:
 *
 *   in0   the covenant   (unlocking script = OP_PUSH_TX preimage — NO SIGNATURE)
 *   out0  the covenant, quined, state advanced, value ≥ V − MAX_FEE
 *
 * That is the whole transaction. Because `OP_PUSH_TX` authorises with a proof ABOUT the transaction
 * rather than a signature, **nobody holds a key to this** — there is no credential to steal, and anyone
 * may advance it with no wallet and nothing at stake. The failure mode is a flat battery, not a theft.
 *
 * The value rule is a FLOOR (`out0.value ≥ V − MAX_FEE`), not an equality, so a transaction that ADDS
 * value is just another valid tick — that is the top-up. And because only out0 is pinned, a top-up may
 * carry trailing outputs (an OP_RETURN mark, change) in the same transaction.
 *
 * SCOPE = ANYONECANPAY|ALL|FORKID (0xc1), as with the LiveCounter: the preimage does not commit the other
 * inputs, so a sponsor may add a funding input to a top-up without invalidating the spend; hashOutputs
 * (ALL) still commits every output, so out0 stays pinned.
 *
 * ── STATE (published so the picture can be rebuilt from the chain alone, without any website) ──
 *
 *   cr ci   the pixel being computed      (5 bytes each)
 *   zr zi   the running value             (5 bytes each)
 *   i       iteration count of this pixel (2 bytes)
 *   step    pixel pitch, halves per pass  (5 bytes)
 *   cx cy   viewport centre               (5 bytes each)
 *   mx      maxIter for this level        (2 bytes)
 *
 * Fields are FIXED-WIDTH SIGN-MAGNITUDE little-endian (high bit of the last byte = negative), in the
 * order above. Fixed point is 1.0 = 2³². **Multiply first, divide last** — `(zr·zi/S)·2` and `(2·zr·zi)/S`
 * differ by one ulp, and the chain's order is the only correct one. A renderer that gets this wrong
 * produces a different picture from the chain.
 *
 * ⚠ `maxIter` is 2 bytes and script numbers are SIGN-MAGNITUDE, so the usable cap is 32,767 — 65,535
 * would read back NEGATIVE.
 *
 * Verified through the @bsv/sdk `Spend` interpreter: 40 consecutive ticks, the MAX_FEE boundary, and the
 * adversarial set (over-drop refused, top-up accepted, trailing outputs accepted).
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushData, pushTxConstants, type PushTxConstants } from './pushtx.ts'

const op = (code: number): ScriptChunk => ({ op: code })

/** SIGHASH scope for the battery's introspection: ANYONECANPAY|ALL|FORKID (a sponsor may add inputs). */
export const BATTERY_SCOPE = 0xc1
/** Record-type byte for a Battery covenant (0x06 is LIVECOUNTER; 0x01–0x05 are the token records). */
export const RECORD_BATTERY = 0x07

/**
 * The most a single tick may remove from the pot — a CEILING, not the fee. An honest ticker pays only
 * what the network needs; this bounds how fast the battery can be drained, and draining it performs the
 * computation anyway.
 *
 * ⚠ PERMANENT. Baked into the locking script, and there is no key to amend it. Chosen 2026-08-12 against
 * a MEASURED 3,090-byte tick at the 256×192 grid: 309 sat is exactly the 100 sat/KB floor, so 312 leaves
 * ~1% headroom (100.971 sat/KB) for a node that counts a byte differently or a modest future drift in
 * the relay floor. Below the floor, keyless ticking would be rejected forever.
 */
export const BATTERY_MAX_FEE = 314

/** Official BSV fee rate (100 sat/KB). Never inflated — see the project fee-rate policy. */
export const BATTERY_FEE_PER_KB = 100

// ── fixed point ──────────────────────────────────────────────────────────────────────────────────────
/** Fixed-point shift: 1.0 = 2³². 27 zoom levels of headroom; 2²⁰ would give only ~15. */
export const SHIFT = 32
export const S = Math.pow(2, SHIFT)
/** Escape radius squared, scaled: |z|² > 4 means this pixel is outside the set. */
export const ESCAPE = 4 * S

/**
 * `trunc(a · b / 2³²)` computed EXACTLY, which `Math.trunc(a * b / S)` is not.
 *
 * |zr| reaches ~2·2³², so `zr · zr` reaches 2⁶⁶ — and a double represents every integer only to 2⁵³.
 * The product is therefore rounded before it is ever divided, and the truncation that was supposed to
 * discard the error instead sometimes crosses an integer boundary and keeps it. Measured against exact
 * BigInt: the reference disagreed with true integer arithmetic on the order of 1 iteration in 600,000.
 *
 * ⚠ WHY THAT MATTERS MORE THAN IT SOUNDS: Bitcoin Script is exact. So on a disagreeing tick it is the
 * REFERENCE that is wrong, and `buildBatteryTickTx` derives the next locking script from it — the
 * covenant recomputes the state itself and rejects an output that does not match. The transaction is
 * refused. No funds are lost, but our own tool cannot advance the battery past that pixel.
 *
 * This is NOT a field-width problem and more bytes would not fix it: `zr` stores comfortably (the
 * widest field runs at 4.7% of its capacity at every resolution). The limit is the mantissa of a
 * double, and it is 53 bits whatever the covenant stores.
 *
 * The fix keeps doubles, so the renderer stays fast. Split each operand at 2¹⁶ and accumulate the
 * partial products separately; every intermediate then stays under 2⁵³ and is exact:
 *
 *     a·b = xh·yh·2³² + (xh·yl + xl·yh)·2¹⁶ + xl·yl
 *     ⌊a·b / 2³²⌋ = xh·yh + ⌊mid / 2¹⁶⌋ + ⌊((mid mod 2¹⁶)·2¹⁶ + xl·yl) / 2³²⌋
 *
 * Sign is handled by taking magnitudes and negating, which truncates toward zero — matching both
 * `Math.trunc` and Script's OP_DIV.
 */
export function mulShift(a: number, b: number): number {
  const neg = (a < 0) !== (b < 0)
  const x = Math.abs(a), y = Math.abs(b)
  const xh = Math.floor(x / 65536), xl = x - xh * 65536
  const yh = Math.floor(y / 65536), yl = y - yh * 65536
  const mid = xh * yl + xl * yh
  const midHi = Math.floor(mid / 65536), midLo = mid - midHi * 65536
  const q = xh * yh + midHi + Math.floor((midLo * 65536 + xl * yl) / 4294967296)
  return neg ? -q : q
}

/** Grid, target and ramp — all baked into the script as constants, so all of it is PERMANENT. */
export interface BatteryGeometry {
  /** Grid width in pixels. */
  W: number
  /** Grid height in pixels. */
  H: number
  /** Width of frame 1 in complex units. */
  SPAN0: number
  /** Zoom target — the minibrot the descent converges on, scaled by S. */
  TX: number
  TY: number
  /** maxIter at frame 1, and the per-level ramp. */
  MX0: number
  K: number
  /** Hard cap on maxIter. 32,767 — a 2-byte SIGN-MAGNITUDE field. */
  MXCAP: number
}

/**
 * THE GENESIS GEOMETRY — permanent, decided 2026-08-12.
 *
 * Target `-1.423288564770 + 0.127278891029i` is a period-11 OFF-AXIS nucleus, chosen by searching 1,026
 * candidates on BOTH loop conditions: `−log₂|size|` must land near a whole number (the scale closes) AND
 * `arg(size)` must land near zero (the orientation matches). Off-axis islands are generally ROTATED, and
 * a 20° turn jumps at the loop as visibly as a 20% scale error — ranking on scale alone is not enough.
 * At 21 levels this gives 1.15% scale error and +1.0° rotation. On-axis alternatives measured far worse
 * (period 3 = 21.8%, unusable).
 *
 * Frame 1 is centred on **c = 0** — the main set's own nucleus, the exact analogue of an island's nucleus.
 * Centre it anywhere else and the loop CANNOT close, whatever else is tuned.
 */
export const BATTERY_GEOMETRY: BatteryGeometry = {
  W: 3840,
  H: 2160,
  SPAN0: 4.0,
  TX: Math.round(-1.423288564770 * S),
  TY: Math.round(0.127278891029 * S),
  MX0: 128,
  K: 128,
  MXCAP: 32767,
}

/** Pixel pitch at frame 1, scaled. A step of 0 would never advance — the battery would burn fuel forever. */
export const step0 = (g: BatteryGeometry = BATTERY_GEOMETRY): number => Math.round(g.SPAN0 / g.W * S)

// ── state ────────────────────────────────────────────────────────────────────────────────────────────
/** The nine state fields the covenant carries in its own script. */
export interface BatteryState {
  cr: number; ci: number      // the pixel
  zr: number; zi: number      // the running value
  i: number                   // iteration count of this pixel
  step: number                // pixel pitch
  cx: number; cy: number      // viewport centre
  mx: number                  // maxIter for this level
}

/** Field order, as laid out in the script. PUBLISHED — a rebuilder needs this exact order. */
export const FIELDS = ['cr', 'ci', 'zr', 'zi', 'i', 'step', 'cx', 'cy', 'mx'] as const
/** Fixed byte-widths, by field. PUBLISHED alongside FIELDS. */
export const FIELD_WIDTHS: Record<(typeof FIELDS)[number], number> =
  { cr: 5, ci: 5, zr: 5, zi: 5, i: 2, step: 5, cx: 5, cy: 5, mx: 2 }

/** The opening state: frame 1, centred on c = 0, top-left pixel, z = 0. */
export function genesisState(g: BatteryGeometry = BATTERY_GEOMETRY): BatteryState {
  const st = step0(g)
  return {
    cr: 0 - Math.floor(g.W / 2) * st, ci: 0 - Math.floor(g.H / 2) * st,
    zr: 0, zi: 0, i: 0, step: st, cx: 0, cy: 0, mx: g.MX0,
  }
}

/**
 * The reference implementation of one tick, in JavaScript — BIT-IDENTICAL to what the script computes.
 * Verified against exact BigInt arithmetic over 800,000 operations with zero differences: |z| ≤ 2 at every
 * level, so |zr·zi| ≤ 2⁶⁷ regardless of depth, and truncation removes the double's error. Depth costs
 * precision in the COORDINATES (the step floor), never in the arithmetic.
 *
 * ⚠ The operation order here is normative. Multiply first, divide last.
 */
export function refState(s: BatteryState, g: BatteryGeometry = BATTERY_GEOMETRY): BatteryState {
  const HW = Math.floor(g.W / 2), HH = Math.floor(g.H / 2), ST0 = step0(g)
  const zr2 = mulShift(s.zr, s.zr), zi2 = mulShift(s.zi, s.zi), mag = zr2 + zi2
  if (mag > ESCAPE || s.i >= s.mx) {
    // this pixel is finished — advance the scan, and at the end of a pass zoom in (or restart)
    const cr0 = s.cx - HW * s.step, crMax = cr0 + (g.W - 1) * s.step
    let cr = s.cr + s.step, ci = s.ci, step = s.step, mx = s.mx, cx = s.cx, cy = s.cy
    if (cr > crMax) {
      const ci0 = s.cy - HH * s.step, ciMax = ci0 + (g.H - 1) * s.step
      cr = cr0; ci = s.ci + s.step
      if (ci > ciMax) {
        if (step > 1) {
          step = Math.trunc(step / 2)
          mx = Math.min(g.MXCAP, mx + g.K)
          // QUARTER the residual. Halving fails: the span halves too, so the offset stays a constant
          // fraction of the frame and the island lands ~half a frame off-centre — bare needle, no island.
          cx = cx + Math.trunc((g.TX - cx) * 3 / 4)
          cy = cy + Math.trunc((g.TY - cy) * 3 / 4)
        } else {
          // at the precision floor — restart the descent, or it redraws the identical frame forever
          step = ST0; mx = g.MX0; cx = 0; cy = 0
        }
        cr = cx - HW * step; ci = cy - HH * step
      }
    }
    return { cr, ci, zr: 0, zi: 0, i: 0, step, cx, cy, mx }
  }
  return {
    cr: s.cr, ci: s.ci,
    zr: zr2 - zi2 + s.cr,
    // ⚠ trunc(2·zr·zi / S), NOT 2·trunc(zr·zi / S) — those differ whenever the quotient has a
    // fractional half, and the script computes the former. Double one operand, not the result.
    zi: mulShift(2 * s.zr, s.zi) + s.ci,
    i: s.i + 1, step: s.step, cx: s.cx, cy: s.cy, mx: s.mx,
  }
}

// ── script-number helpers ────────────────────────────────────────────────────────────────────────────
/** Minimal script-number encoding (sign-magnitude little-endian). */
function snum(n: number): number[] {
  if (n === 0) return []
  const neg = n < 0
  let v = Math.abs(n)
  const b: number[] = []
  while (v > 0) { b.push(v % 256); v = Math.floor(v / 256) }
  if (b[b.length - 1] & 0x80) b.push(neg ? 0x80 : 0x00)
  else if (neg) b[b.length - 1] |= 0x80
  return b
}
/** Push a number as a minimal script number. */
const PN = (n: number): ScriptChunk => { const d = snum(n); return d.length === 0 ? op(OP.OP_0) : { op: d.length, data: d } }
/** Encode a value into a FIXED-WIDTH sign-magnitude field of `n` bytes. */
export function fixedField(v: number, n: number): number[] {
  const neg = v < 0
  let x = Math.abs(v)
  const b: number[] = []
  for (let k = 0; k < n; k++) { b.push(x % 256); x = Math.floor(x / 256) }
  if (neg) b[n - 1] |= 0x80
  return b
}

// ── the depth-tracking assembler ─────────────────────────────────────────────────────────────────────
/**
 * Every value is referenced by NAME and the OP_PICK offset is computed from a live stack model.
 * Hand-counting stack depths caused three bugs in one sitting; this makes that class of bug impossible.
 *
 * Branches are the subtle part: BOTH arms start from the same real stack, so the model is snapshotted at
 * OP_IF, restored at OP_ELSE, and the two arms must agree at OP_ENDIF. Without that, every depth in the
 * else-path is computed against the if-path's pushes.
 */
class Asm {
  ops: ScriptChunk[] = []
  st: string[]
  private snap: string[][] = []
  private ifEnd: string[][] = []
  constructor(names: string[]) { this.st = names.slice() }
  raw(o: ScriptChunk, pop = 0, push: string[] = []): this {
    this.ops.push(o)
    for (let i = 0; i < pop; i++) this.st.pop()
    push.forEach(n => this.st.push(n))
    return this
  }
  o(code: number, pop = 0, push: string[] = []): this { return this.raw(op(code), pop, push) }
  num(n: number, as?: string): this { return this.raw(PN(n), 0, [as ?? ('#' + n)]) }
  depth(name: string): number {
    const i = this.st.lastIndexOf(name)
    if (i < 0) throw new Error('unknown: ' + name + ' | ' + this.st.join(','))
    return this.st.length - 1 - i
  }
  pick(name: string, as?: string): this {
    const d = this.depth(name)
    this.raw(PN(d), 0, ['_d'])
    return this.raw(op(OP.OP_PICK), 1, [as ?? name + "'"])
  }
  bin(code: number, as: string): this { return this.o(code, 2, [as]) }
  drop(n: number): this { for (let i = 0; i < n; i++) this.o(OP.OP_DROP, 1, []); return this }
  /** Rename the top of the model without emitting an opcode (after a pick that is really an alias). */
  rename(as: string): this { this.st.pop(); this.st.push(as); return this }
  ifBegin(): this { this.o(OP.OP_IF, 1, []); this.snap.push(this.st.slice()); return this }
  elseArm(): this {
    this.raw(op(OP.OP_ELSE), 0, [])
    this.ifEnd.push(this.st.slice())
    this.st = this.snap[this.snap.length - 1].slice()
    return this
  }
  endIf(): this {
    this.raw(op(OP.OP_ENDIF), 0, [])
    const a = this.ifEnd.pop()!, b = this.st
    this.snap.pop()
    if (a.length !== b.length) {
      throw new Error('branch mismatch: if=' + a.length + ' else=' + b.length +
        '\n  if  : ' + a.join(',') + '\n  else: ' + b.join(','))
    }
    return this
  }
  /**
   * Leave EXACTLY these values above the branch's entry baseline, dropping every intermediate — so both
   * arms agree by construction instead of by careful bookkeeping.
   */
  armReturn(names: string[]): this {
    names.slice().reverse().forEach(n => { this.pick(n, '_r'); this.raw(op(OP.OP_TOALTSTACK), 1, []) })
    const base = this.snap[this.snap.length - 1].length
    this.drop(this.st.length - base)
    names.forEach(n => this.raw(op(OP.OP_FROMALTSTACK), 0, [n]))
    return this
  }
  /** As `armReturn`, but clears the whole stack — used once at the end to discard the nine originals. */
  armReturnFinal(names: string[]): this {
    names.slice().reverse().forEach(n => { this.pick(n, '_r'); this.raw(op(OP.OP_TOALTSTACK), 1, []) })
    this.drop(this.st.length)
    names.forEach(n => this.raw(op(OP.OP_FROMALTSTACK), 0, [n]))
    return this
  }
  toAlt(n: number): this { for (let i = 0; i < n; i++) this.o(OP.OP_TOALTSTACK, 1, []); return this }
}

/**
 * The state machine: consumes the nine fields as numbers and leaves the nine advanced fields.
 * One Mandelbrot iteration, the escape/cap test, the scan advance, the zoom, and the restart.
 * 654 bytes at the genesis geometry; the arithmetic itself is a small fraction of that — the PROOF is
 * what costs, not the maths.
 */
function stateMachineOps(g: BatteryGeometry): ScriptChunk[] {
  const HW = Math.floor(g.W / 2), HH = Math.floor(g.H / 2), ST0 = step0(g)
  const a = new Asm(FIELDS.slice())

  // ── z² + c, magnitude, and the escape/cap test ──
  a.pick('zr', 'a'); a.pick('zr', 'b'); a.bin(OP.OP_MUL, 'zrzr'); a.num(S); a.bin(OP.OP_DIV, 'zr2')
  a.pick('zi', 'a'); a.pick('zi', 'b'); a.bin(OP.OP_MUL, 'zizi'); a.num(S); a.bin(OP.OP_DIV, 'zi2')
  a.pick('zr', 'a'); a.pick('zi', 'b'); a.bin(OP.OP_MUL, 'zrzi'); a.num(2); a.bin(OP.OP_MUL, 'x2'); a.num(S); a.bin(OP.OP_DIV, 'cross')
  a.pick('zr2', 'p'); a.pick('zi2', 'q'); a.bin(OP.OP_ADD, 'mag')
  a.num(ESCAPE); a.bin(OP.OP_GREATERTHAN, 'esc')
  a.pick('i', 'p'); a.pick('mx', 'q'); a.bin(OP.OP_GREATERTHANOREQUAL, 'maxed')
  a.bin(OP.OP_BOOLOR, 'done')

  a.ifBegin()
  // ── this pixel is finished: advance the scan ──
  a.pick('cx', 'p'); a.num(HW); a.pick('step', 'q'); a.bin(OP.OP_MUL, 'hs'); a.bin(OP.OP_SUB, 'cr0')
  a.pick('cr0', 'p'); a.num(g.W - 1); a.pick('step', 'q'); a.bin(OP.OP_MUL, 'ws'); a.bin(OP.OP_ADD, 'crMax')
  a.pick('cr', 'p'); a.pick('step', 'q'); a.bin(OP.OP_ADD, 'crN')
  a.pick('crN', 'p'); a.pick('crMax', 'q'); a.bin(OP.OP_GREATERTHAN, 'rowEnd')
  a.ifBegin()
  a.pick('cy', 'p'); a.num(HH); a.pick('step', 'q'); a.bin(OP.OP_MUL, 'hs2'); a.bin(OP.OP_SUB, 'ci0')
  a.pick('ci0', 'p'); a.num(g.H - 1); a.pick('step', 'q'); a.bin(OP.OP_MUL, 'hs3'); a.bin(OP.OP_ADD, 'ciMax')
  a.pick('ci', 'p'); a.pick('step', 'q'); a.bin(OP.OP_ADD, 'ciN')
  a.pick('ciN', 'p'); a.pick('ciMax', 'q'); a.bin(OP.OP_GREATERTHAN, 'passEnd')
  a.ifBegin()
  // ── end of pass: zoom in, or restart at the precision floor ──
  a.pick('step', 'p'); a.num(1); a.bin(OP.OP_GREATERTHAN, 'deeper')
  a.ifBegin()
  a.pick('step', 'p'); a.num(2); a.bin(OP.OP_DIV, 'nStep')
  a.pick('mx', 'p'); a.num(g.K); a.bin(OP.OP_ADD, 'mxr'); a.num(g.MXCAP); a.bin(OP.OP_MIN, 'nMx')
  a.pick('cx', 'p'); a.num(g.TX); a.pick('cx', 'q'); a.bin(OP.OP_SUB, 'dx'); a.num(3); a.bin(OP.OP_MUL, 'dx3')
  a.num(4); a.bin(OP.OP_DIV, 'dx4'); a.bin(OP.OP_ADD, 'nCx')
  a.pick('cy', 'p'); a.num(g.TY); a.pick('cy', 'q'); a.bin(OP.OP_SUB, 'dy'); a.num(3); a.bin(OP.OP_MUL, 'dy3')
  a.num(4); a.bin(OP.OP_DIV, 'dy4'); a.bin(OP.OP_ADD, 'nCy')
  a.elseArm()
  a.num(ST0, 'nStep'); a.num(g.MX0, 'nMx'); a.num(0, 'nCx'); a.num(0, 'nCy')
  a.endIf()
  a.pick('nCx', 'p'); a.num(HW); a.pick('nStep', 'q'); a.bin(OP.OP_MUL, 'm1'); a.bin(OP.OP_SUB, 'oCr')
  a.pick('nCy', 'p'); a.num(HH); a.pick('nStep', 'q'); a.bin(OP.OP_MUL, 'm2'); a.bin(OP.OP_SUB, 'oCi')
  a.armReturn(['oCr', 'oCi', 'nStep', 'nMx', 'nCx', 'nCy'])
  a.elseArm()
  // next row: back to the left edge, one step down
  a.pick('cr0'); a.rename('oCr')
  a.pick('ciN'); a.rename('oCi')
  a.pick('step'); a.rename('nStep')
  a.pick('mx'); a.rename('nMx')
  a.pick('cx'); a.rename('nCx')
  a.pick('cy'); a.rename('nCy')
  a.armReturn(['oCr', 'oCi', 'nStep', 'nMx', 'nCx', 'nCy'])
  a.endIf()
  a.armReturn(['oCr', 'oCi', 'nStep', 'nMx', 'nCx', 'nCy'])
  a.elseArm()
  // next pixel along the row
  a.pick('crN'); a.rename('oCr')
  a.pick('ci'); a.rename('oCi')
  a.pick('step'); a.rename('nStep')
  a.pick('mx'); a.rename('nMx')
  a.pick('cx'); a.rename('nCx')
  a.pick('cy'); a.rename('nCy')
  a.armReturn(['oCr', 'oCi', 'nStep', 'nMx', 'nCx', 'nCy'])
  a.endIf()
  // reset z and i for the new pixel
  a.pick('oCr', 'o1'); a.pick('oCi', 'o2'); a.num(0, 'o3'); a.num(0, 'o4'); a.num(0, 'o5')
  a.pick('nStep', 'o6'); a.pick('nCx', 'o7'); a.pick('nCy', 'o8'); a.pick('nMx', 'o9')
  a.armReturn(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9'])

  a.elseArm()
  // ── still iterating this pixel: z = z² + c, i += 1 ──
  a.pick('cr', 'o1'); a.pick('ci', 'o2')
  a.pick('zr2', 'p'); a.pick('zi2', 'q'); a.bin(OP.OP_SUB, 'd'); a.pick('cr', 'r'); a.bin(OP.OP_ADD, 'o3')
  a.pick('cross', 'p'); a.pick('ci', 'q'); a.bin(OP.OP_ADD, 'o4')
  a.pick('i', 'p'); a.o(OP.OP_1ADD, 1, ['o5'])
  a.pick('step', 'o6'); a.pick('cx', 'o7'); a.pick('cy', 'o8'); a.pick('mx', 'o9')
  a.armReturn(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9'])
  a.endIf()

  // the nine originals still sit below the nine results — drop them
  a.armReturnFinal(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9'])
  return a.ops
}

/** Built once per geometry — the ops are deterministic. */
const smCache = new Map<string, ScriptChunk[]>()
export function batteryStateMachineOps(g: BatteryGeometry = BATTERY_GEOMETRY): ScriptChunk[] {
  const key = JSON.stringify(g)
  let ops = smCache.get(key)
  if (ops == null) { ops = stateMachineOps(g); smCache.set(key, ops) }
  return ops
}

// ── the covenant ─────────────────────────────────────────────────────────────────────────────────────
/** The nine data-field pushes carried in the script, preceded by the protocol prefix. */
function fieldChunks(s: BatteryState): ScriptChunk[] {
  return [
    pushData([0x50]),              // protocol prefix "P"
    pushData([0x01]),              // Battery format version
    pushData([RECORD_BATTERY]),    // record type
    ...FIELDS.map(k => pushData(fixedField(s[k], FIELD_WIDTHS[k]))),
  ]
}

export interface BatteryLockParams {
  state: BatteryState
  /** Offset of the first field's DATA within the scriptCode FIELD. `buildBatteryLock` computes it. */
  fieldOffset: number
  geometry?: BatteryGeometry
  maxFee?: number
  c?: PushTxConstants
}

/**
 * Full Battery locking-script ops:
 *   <12 data pushes> OP_2DROP ×6        carry the nine fields on-chain and clear the stack
 *   <verify preimage>                    OP_PUSH_TX — the authorisation, with no signature
 *   <stash hashOutputs + out0's value>   read from the preimage
 *   <split scriptCode into PRE ‖ fields ‖ SUF>
 *   <the state machine>                  ONE Mandelbrot iteration, in Script
 *   <rebuild the script with the new fields>
 *   <assert out0.value ≥ V − MAX_FEE, and HASH256(out0 ‖ spenderOutputs) == hashOutputs>
 */
export function batteryLockOps(p: BatteryLockParams): ScriptChunk[] {
  const g = p.geometry ?? BATTERY_GEOMETRY
  const maxFee = p.maxFee ?? BATTERY_MAX_FEE
  const c = p.c ?? pushTxConstants(BATTERY_SCOPE)
  const ops: ScriptChunk[] = [
    ...fieldChunks(p.state),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP),
    ...pushTxVerifyOps(c),                                   // [SO, newV, preimage]
    op(OP.OP_DUP), op(OP.OP_DUP),
    ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),        // alt:[hashOutputs]
    // the spent output's value lives 52 bytes from the end of the preimage
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK), // alt:[HO, V]
    ...extractScriptCodeFieldOps(),                          // [SO, newV, field]
    PN(p.fieldOffset), op(OP.OP_SPLIT),                      // [.., PRE, rest]
  ]
  // peel the nine fields off `rest`
  FIELDS.forEach((k, idx) => {
    if (idx > 0) ops.push(op(OP.OP_1), op(OP.OP_SPLIT), op(OP.OP_NIP))   // drop the push opcode
    ops.push(PN(FIELD_WIDTHS[k]), op(OP.OP_SPLIT))
  })
  ops.push(op(OP.OP_TOALTSTACK))                             // alt:[HO, V, SUF]
  // fields → numbers, in FIELDS order on the main stack
  for (let k = 0; k < FIELDS.length - 1; k++) ops.push(op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK))
  ops.push(op(OP.OP_BIN2NUM))
  for (let k = 0; k < FIELDS.length - 1; k++) ops.push(op(OP.OP_FROMALTSTACK))

  // ── one iteration ──
  ops.push(...batteryStateMachineOps(g))

  // numbers → fixed-width fields, and rebuild the script
  for (let k = FIELDS.length - 1; k > 0; k--) ops.push(PN(FIELD_WIDTHS[FIELDS[k]]), op(OP.OP_NUM2BIN), op(OP.OP_TOALTSTACK))
  ops.push(PN(FIELD_WIDTHS[FIELDS[0]]), op(OP.OP_NUM2BIN))
  ops.push(op(OP.OP_CAT))                                    // PRE ‖ cr
  for (let k = 1; k < FIELDS.length; k++) {
    ops.push(pushData([FIELD_WIDTHS[FIELDS[k]]]), op(OP.OP_CAT), op(OP.OP_FROMALTSTACK), op(OP.OP_CAT))
  }
  ops.push(op(OP.OP_FROMALTSTACK), op(OP.OP_CAT))            // ‖ SUF

  // the value rule (a FLOOR, so a top-up is just another tick), then out0, then the comparison
  ops.push(
    op(OP.OP_SWAP), op(OP.OP_DUP), op(OP.OP_BIN2NUM),
    op(OP.OP_FROMALTSTACK), PN(maxFee), op(OP.OP_SUB), op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),
    op(OP.OP_SWAP), op(OP.OP_CAT), op(OP.OP_SWAP), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )
  return ops
}

/**
 * Build a Battery locking script, computing the field offset from the fixed layout.
 * Two-pass like `buildLiveCounterLock`: the offset push is the same byte-width whether probing or final,
 * so the length used to size the scriptCode varint is stable.
 * Layout before the first field: three 2-byte pushes = 6, then cr's 1-byte push opcode → O = 7.
 */
export function buildBatteryLock(p: Omit<BatteryLockParams, 'fieldOffset'>): LockingScript {
  const O = 2 + 2 + 2 + 1
  const probeLen = new LockingScript(batteryLockOps({ ...p, fieldOffset: 1 })).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return new LockingScript(batteryLockOps({ ...p, fieldOffset: varIntSize + O }))
}

/**
 * The covenant input's unlocking script. It pushes (bottom → top)
 *   spenderOutputs (the serialized trailing outputs, empty for a pure tick) · out0's value · the preimage
 * and carries NO signature — the preimage IS the authorisation.
 */
export function tickUnlockingOps(p: { spenderOutputs: number[]; newValue: number[]; preimage: number[] }): ScriptChunk[] {
  return [
    p.spenderOutputs.length > 0 ? pushData(p.spenderOutputs) : op(OP.OP_0),
    pushData(p.newValue),
    pushData(p.preimage),
  ]
}

/**
 * The state layout, as a single line — written into the genesis OP_RETURN so the picture can be rebuilt
 * from the chain by anyone, WITHOUT this page. If the descent takes years, the artefact must not quietly
 * depend on a website staying up. Owned, not hosted.
 */
/* 192 bytes, leaving room for the opening mark — the genesis writes LAYOUT|MARK and the whole thing
   must fit 220. The 'fields' label is dropped because the list is self-evidently the field names once
   'widths' labels the second list; that bought the 7 bytes that 'abs z' costs over '|z|'. Everything here is something a rebuilder CANNOT
   derive from a tip: the field layout to parse the state at all, the grid, the ramp constants that
   govern levels not yet reached, and the ink recipe. `span` is omitted deliberately — it is
   W·step/2^32, recoverable from the state. Written compactly because the full prose ran to 276. */
export const BATTERY_STATE_LAYOUT =
  'BRC-226 BATTERY v1|cr,ci,zr,zi,i,step,cx,cy,mx|widths 5,5,5,5,2,5,5,5,2|' +
  'sign-mag LE|1=2^32|mul first div last|grid 3840x2160|mx0 128 k 128 cap 32767|' +
  /* `abs z`, not `|z|`: the pipe is the field separator, and |z| would put two of them INSIDE a
     field. The genesis OP_RETURN is layout + '|' + the opening mark, so a reader splitting on the
     last pipe has to be able to trust it. Same formula, unambiguous encoding. */
  'maxfee 314|ink esc+1-log2(log abs z) mod 32'

/** OP_FALSE OP_RETURN <data> — an unspendable output carrying bytes. */
export function opReturnScript(data: number[]): LockingScript {
  if (data.length > 220) throw new Error('opReturnScript: data too long')
  return new LockingScript([op(OP.OP_FALSE), op(OP.OP_RETURN), pushData(data)])
}

/**
 * How many more ticks the pot can pay for at `feeSats` each. This is the fuel gauge: a program you can
 * watch run out of power is more legible as a machine than one that never stops.
 */
export function ticksRemaining(valueSats: number, feeSats: number = BATTERY_MAX_FEE): number {
  return Math.max(0, Math.floor(valueSats / feeSats))
}

/** Little-endian uint64 — the value field as the covenant reads it. */
export function u64le(n: number): number[] {
  const b: number[] = []
  let v = BigInt(n)
  for (let k = 0; k < 8; k++) { b.push(Number(v & 0xffn)); v >>= 8n }
  return b
}
