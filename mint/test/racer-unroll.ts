// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
//
// ★★★ A WHOLE QUARTER MILE IN ONE SCRIPT — and does it agree with forty-five chained spends?
//
// The chained race is what mainnet has raced: one transaction per tick, forty-six of them for a quarter
// mile, each carrying the car's whole locking script twice — once in out0 and once again inside the
// preimage. The unrolled race is the same physics laid out in SPACE instead of in TIME: one lock, one
// broadcast, nothing chained.
//
// This is the test that decides whether they are the same race. Every unrolled case below is EXECUTED by
// `Spend`, and the expected values come from `refTick` iterated by hand with the fuel carried, which is
// what the chained covenant does through its outputs.
//
// ⚠ THE FUEL IS THE PART THAT COULD SILENTLY DIVERGE. Chained, `out0.value = V − burn` does it once per
// spend; unrolled there is no output between ticks, so the loop carries it — and mass includes the fuel,
// so a car that fails to lighten as it burns is a DIFFERENT CAR that would still look plausible.
import { Spend, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import { compileBasic } from '../src/basic.ts'
import { tickLoopSrc, TICK_STACK } from '../src/racerTick.ts'
import { RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick } from '../src/shell.ts'
import { op, PN } from '../src/covenantAsm.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean): void => {
  console.log(`${got ? 'PASS' : 'FAIL'}  ${n}`); got ? pass++ : fail++
}

const CONSTS = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, RESERVE: R.RESERVE, SPIN_KEEP: R.SPIN_KEEP,
  LOOSE_V: R.LOOSE_V, BLOW_T: R.BLOW_T, TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E,
  SLIP: SLIP_UNIT, S, P_RACING: PHASE.RACING, P_DONE: PHASE.DONE, P_OUT: PHASE.OUT,
}

const ST0 = {
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: 14, tyr: 10, finish: Math.round(402 * S), slip: 1000, green: 0, gap: 1, last: 100,
  s: 0, v: 0, n: 0,
}
const THROTTLE = 8, FUEL0 = 40000

/** The chained reference: refTick N times, carrying the fuel by what each tick burned. */
function chained(n: number): { v: number; s: number; n: number; fuel: number } {
  let st: typeof ST0 = { ...ST0 }, fuel = FUEL0, live = true
  for (let i = 0; i < n; i++) {
    if (!live) continue
    const r = refTick(st as never, { throttle: THROTTLE, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    st = { ...(r.state as never as typeof ST0), last: st.last + st.gap }
    if (st.phase !== PHASE.RACING) live = false
  }
  return { v: st.v, s: st.s, n: st.n, fuel }
}

/** The unrolled race: compile once, run once, and read one named value off the top. */
function unrolledEquals(ticks: number, name: string, want: number): boolean {
  const { ops } = compileBasic(`${tickLoopSrc(ticks)}\ncheck = ${name}`,
    { stack: [...TICK_STACK], consts: CONSTS })
  const lock = new LockingScript([...ops, PN(want), op(OP.OP_NUMEQUAL)])
  const unlock = new UnlockingScript(
    [ST0.v, ST0.s, ST0.n, ST0.eng, ST0.tyr, ST0.slip, ST0.finish, FUEL0, THROTTLE].map(x => PN(x)))
  const spend = new Spend({
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
    lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
    unlockingScript: unlock, inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}

console.log('RACER UNROLL — one script against forty-five spends\n')

for (const n of [1, 2, 5, 12, 45]) {
  const want = chained(n)
  const ok = (['v', 's', 'n', 'fuel'] as const).every(k => unrolledEquals(n, k, want[k]))
  check(`★${n === 45 ? '★★' : ''} ${String(n).padStart(2)} ticks unrolled == ${String(n).padStart(2)} chained` +
    `  ·  v ${want.v} · s ${want.s} · fuel ${want.fuel}`, ok)
}

/* ── what it costs, so the saving is measured rather than assumed ────────────────────────────────── */
{
  const sizeOf = (n: number): number =>
    new LockingScript(compileBasic(tickLoopSrc(n), { stack: [...TICK_STACK], consts: CONSTS }).ops)
      .toBinary().length
  const one = sizeOf(1), forty5 = sizeOf(45)
  const perTick = Math.round((forty5 - one) / 44)
  // the lock is paid for TWICE in a spend: once in out0, once inside the preimage
  const unrolledFee = Math.round(2 * forty5 * 0.1)
  const chainedFee = 45 * R.BURN0
  console.log(`\n        45 ticks: ${forty5.toLocaleString()} B of lock · ${perTick} B a tick`)
  console.log(`        chained  ${chainedFee.toLocaleString()} sat   ·   unrolled ~${unrolledFee.toLocaleString()} sat` +
    `   ⇒ ${(chainedFee / unrolledFee).toFixed(1)}x`)
  check('★★ one transaction is cheaper than forty-five', unrolledFee < chainedFee)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'RACER UNROLL OK — the loop rotated from time into space, and it is the same race.'
  : 'RACER UNROLL FAILED')
process.exit(fail === 0 ? 0 : 1)
