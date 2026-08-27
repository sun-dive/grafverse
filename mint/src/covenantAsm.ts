// © 2026 sun-dive — Apache License 2.0.
/**
 * THE DEPTH-TRACKING ASSEMBLER — shared by every covenant in this repo.
 *
 * Every value is referenced by NAME, and the OP_PICK offset is computed from a live stack model rather
 * than counted by hand. Hand-counting caused three bugs in one sitting while the battery was being
 * written; this makes that class of bug impossible rather than unlikely.
 *
 * Extracted from battery.ts verbatim so the Bitcoin Racers shell can be built on the same tool. The
 * battery is LIVE and unamendable, so the extraction is proved by byte-identity: `battery-parity.ts`
 * rebuilds its locking script and compares. If a single opcode moved, that test fails.
 *
 * ⚠ Branches are the subtle part. BOTH arms start from the same real stack, so the model is snapshotted
 * at OP_IF, restored at OP_ELSE, and the two arms must agree at OP_ENDIF. Without that, every depth in
 * the else-path is computed against the if-path's pushes — which is silent, and wrong.
 */
import { OP, type ScriptChunk } from '@bsv/sdk'

export const op = (code: number): ScriptChunk => ({ op: code })

/** Script's own minimal number encoding: sign-magnitude, little-endian, no leading zero byte. */
export function snum(n: number): number[] {
  if (n === 0) return []
  const neg = n < 0
  let x = Math.abs(n)
  const out: number[] = []
  while (x > 0) { out.push(x & 0xff); x = Math.floor(x / 256) }
  if (out[out.length - 1] & 0x80) out.push(neg ? 0x80 : 0x00)
  else if (neg) out[out.length - 1] |= 0x80
  return out
}

/** Push a number as Script would. */
export const PN = (n: number): ScriptChunk => {
  const d = snum(n)
  return d.length === 0 ? op(OP.OP_0) : { op: d.length, data: d }
}

export class Asm {
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
  /**
   * OP_ROLL — like pick, but the value MOVES rather than being copied, so the model must remove it
   * from where it was. Used to put things back on the altstack in the right order, which pick cannot
   * do because it would leave a duplicate behind.
   */
  roll(name: string, as?: string): this {
    const d = this.depth(name)
    this.raw(PN(d), 0, ['_d'])
    this.raw(op(OP.OP_ROLL), 1, [])
    const i = this.st.lastIndexOf(name)
    this.st.splice(i, 1)
    this.st.push(as ?? name)
    return this
  }
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
  /** As `armReturn`, but clears the whole stack — used at the end to discard the originals. */
  armReturnFinal(names: string[]): this {
    names.slice().reverse().forEach(n => { this.pick(n, '_r'); this.raw(op(OP.OP_TOALTSTACK), 1, []) })
    this.drop(this.st.length)
    names.forEach(n => this.raw(op(OP.OP_FROMALTSTACK), 0, [n]))
    return this
  }
  toAlt(n: number): this { for (let i = 0; i < n; i++) this.o(OP.OP_TOALTSTACK, 1, []); return this }
}

/**
 * A signed value in EXACTLY `n` bytes, sign-magnitude little-endian — the encoding every covenant in
 * this repo carries its state in, because a fixed width is what lets a script split its own scriptCode
 * at constant offsets.
 *
 * ⚠ IT TRUNCATES SILENTLY. A value too large for its field produces a perfectly well-formed script
 * carrying the wrong number, and the covenant then rejects a spend nobody can account for. Check the
 * value fits BEFORE calling this — see `stateFits` in shell.ts.
 */
export function fixedField(v: number, n: number): number[] {
  const neg = v < 0
  let x = Math.abs(v)
  const b: number[] = []
  for (let k = 0; k < n; k++) { b.push(x % 256); x = Math.floor(x / 256) }
  if (neg) b[n - 1] |= 0x80
  return b
}
