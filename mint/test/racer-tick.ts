// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
//
// ★★★ DOES THE TICK WRITTEN IN BASIC AGREE WITH THE ONE THE CARS ALREADY RUN?
//
// Not "does it compile" and not "does it look right" — every case below is executed by `Spend`, the
// interpreter from @bsv/sdk, the same one that decides a real spend. The expected value comes from
// `refTick`, which is what `shellPhysicsOps` was built against and what mainnet cars race under.
//
// ⚠ A run that ends badly is the interesting case, not the happy one: `refTick` RETURNS at a lost-grip
// check, so its drag arithmetic never executes, while the BASIC has no early exit and computes the lot
// before correcting it. If those two agree on the final state, the translation is honest.
import { Transaction, Spend, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import { compileBasic } from '../src/basic.ts'
import { TICK_SRC, TICK_STACK } from '../src/racerTick.ts'
import { RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick, type ShellState, type Move } from '../src/shell.ts'
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

/** Compile the tick, leave ONE named value on top, and run it for real. */
function readsBack(name: string, inputs: number[], want: number): boolean {
  const { ops } = compileBasic(`${TICK_SRC}\ncheck = ${name}`, { stack: [...TICK_STACK], consts: CONSTS })
  const lock = new LockingScript([...ops, PN(want), op(OP.OP_NUMEQUAL)])
  const unlock = new UnlockingScript(inputs.map(n => PN(n)))
  const spend = new Spend({
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
    lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
    unlockingScript: unlock, inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}

const state = (o: Partial<ShellState>): ShellState => ({
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: 14, tyr: 10, finish: Math.round(402 * S), slip: 1000, green: 0, gap: 1, last: 100,
  s: 0, v: 0, n: 0, ...o,
} as ShellState)

// v · s · n · eng · tyr · slip · finish · fuel · throttle
const inputsOf = (st: ShellState, m: Move): number[] =>
  [st.v, st.s, st.n, st.eng, st.tyr, st.slip, st.finish, m.fuel, m.throttle]

console.log('RACER TICK — the BASIC against refTick, through the interpreter\n')

/* ── 1. the ordinary cases: the six configurations test/basic.ts already uses ───────────────────── */
{
  const cases: Array<[number, number, number, number, number]> = [
    [0, 10, 1000, 14, 8], [Math.round(2 * S), 10, 1000, 14, 8], [Math.round(4 * S), 2, 600, 20, 16],
    [Math.round(1 * S), 6, 1800, 8, 3], [Math.round(3.5 * S), 10, 1000, 24, 12], [0, 1, 400, 1, 0],
  ]
  let agreed = 0, firstBad = ''
  for (const [v, tyr, slip, eng, throttle] of cases) {
    const st = state({ v, tyr, slip, eng })
    const m: Move = { throttle, fuel: 40000, lockTime: st.last + st.gap }
    const want = refTick(st, m, R)
    const ok = readsBack('nv', inputsOf(st, m), want.state.v)
      && readsBack('ns', inputsOf(st, m), want.state.s)
      && readsBack('burn', inputsOf(st, m), want.burn)
      && readsBack('spun', inputsOf(st, m), want.spun ? 1 : 0)
      && readsBack('nphase', inputsOf(st, m), want.state.phase)
    if (ok) agreed++
    else if (!firstBad) firstBad = `v ${v} tyr ${tyr} slip ${slip} eng ${eng} th ${throttle}`
  }
  check(`★★★ the BASIC tick agrees with refTick on all ${cases.length} configurations`, agreed === cases.length)
  if (firstBad) console.log(`        first disagreement: ${firstBad}`)
}

/* ── 2. ★ THE ENDINGS — where refTick returns early and the BASIC cannot ────────────────────────── */
{
  // a moving car that loses grip: steps sideways and is gone
  const off = state({ v: Math.round(4 * S), tyr: 1, slip: 400, eng: 24 })
  const mOff: Move = { throttle: 16, fuel: 40000, lockTime: off.last + off.gap }
  const wOff = refTick(off, mOff, R)
  check(`★★ a moving car that loses grip ends OUT (${wOff.ended})`,
    wOff.state.phase === PHASE.OUT
    && readsBack('out', inputsOf(off, mOff), 1)
    && readsBack('nv', inputsOf(off, mOff), 0)
    && readsBack('ns', inputsOf(off, mOff), off.s)
    && readsBack('nphase', inputsOf(off, mOff), PHASE.OUT))

  // a stationary car with the motor running away with itself
  const blown = state({ v: 0, tyr: 1, slip: 400, eng: 24 })
  const mBlown: Move = { throttle: R.BLOW_T, fuel: 40000, lockTime: blown.last + blown.gap }
  const wBlown = refTick(blown, mBlown, R)
  check(`★★ a standing car at full throttle ends OUT (${wBlown.ended})`,
    wBlown.state.phase === PHASE.OUT && readsBack('out', inputsOf(blown, mBlown), 1))
}

/* ── 3. ★ the dry car COASTS — no propellant, so the throttle is forced shut ─────────────────────── */
{
  const dry = state({ v: Math.round(3 * S) })
  const m: Move = { throttle: 16, fuel: 0, lockTime: dry.last + dry.gap }
  const want = refTick(dry, m, R)
  check('★★ a dry car coasts — throttle forced shut, and it still rolls',
    readsBack('nv', inputsOf(dry, m), want.state.v) && want.state.v > 0 && want.state.v < dry.v)
}

/* ── 4. the finish line ──────────────────────────────────────────────────────────────────────────── */
{
  const nearly = state({ v: Math.round(5 * S), s: Math.round(400 * S) })
  const m: Move = { throttle: 8, fuel: 40000, lockTime: nearly.last + nearly.gap }
  const want = refTick(nearly, m, R)
  check(`★★★ crossing the line leaves phase DONE`,
    want.state.phase === PHASE.DONE && readsBack('nphase', inputsOf(nearly, m), PHASE.DONE))
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'RACER TICK OK — the physics on mainnet, written in BASIC, agreeing through the interpreter.'
  : 'RACER TICK FAILED')
process.exit(fail === 0 ? 0 : 1)
