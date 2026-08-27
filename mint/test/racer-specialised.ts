// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
//
// ★★★ A RUN COMPILED FROM ITS OWN SIMULATION — is it still the same race?
//
// `racer-unroll.ts` proved that forty-five ticks laid out in space equal forty-five chained spends. This
// goes further: the run is simulated in advance, and every branch the simulation resolved is emitted as
// an ASSERTION instead of two arms. The script that results is the run that actually happens.
//
// ⚠⚠ THE ONLY THING THAT MAKES THAT HONEST is that an assertion refuses rather than assumes. If the
// prediction is wrong the spend is INVALID — so a mis-specialised car produces no race, never a wrong
// one. The last two checks below are the ones that prove it, by lying to the compiler on purpose.
import { Spend, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import { compileBasic } from '../src/basic.ts'
import { specialiseRun, type TickTrace, type Ending, type RunTrace } from '../src/racerTick.ts'
/* ⚠ THE ONE-RACE CAR'S PHYSICS LIVES IN ITS OWN FILE. `shell.ts` is bundled into BOTH live
   bundles — grafmint.js (six pages) and, via grafbasic.ts, grafbasic.js (basic.html) — so the
   racers must not put anything in it. → src/racerPhysics.ts, and §6j. */
import { S, SLIP_UNIT, PHASE } from '../src/shell.ts'
import { ONE_RACE_REGS as R, racerRefTick as refTick, RACER_PHASE } from '../src/racerPhysics.ts'
import { op, PN } from '../src/covenantAsm.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean): void => {
  console.log(`${got ? 'PASS' : 'FAIL'}  ${n}`); got ? pass++ : fail++
}

const ENG = 14, TYR = 10, SLIP = 1000, THROTTLE = 8
const FINISH = Math.round(402 * S), FUEL0 = 40000

const CONSTS = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
  eng: ENG, tyr: TYR, slip: SLIP, finish: FINISH,
}

const ST0 = {
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: ENG, tyr: TYR, finish: FINISH, slip: SLIP, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
}

/** Drive the race in JavaScript, exactly as the page would before minting. */
function simulate(cfg: Partial<typeof ST0> = {}, throttle = THROTTLE):
    { run: RunTrace; v: number; s: number; fuel: number } {
  let st: typeof ST0 = { ...ST0, ...cfg }, fuel = FUEL0
  const ticks: TickTrace[] = []
  let ending: Ending = 'finish'
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle: r.throttle, spun: r.spun })
    st = { ...(r.state as never as typeof ST0), last: st.last + st.gap }
    /* ★ the fifth ending — dry and provably short of the line. Legal; no time, no leaderboard row. */
    if (r.ended === 'stopped') { ending = 'stopped'; break }
    if (r.ended === 'off') { ending = 'off'; break }
    if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; break }
    if (st.phase === PHASE.DONE) { ending = 'finish'; break }
  }
  return { run: { ticks, ending }, v: st.v, s: st.s, fuel }
}

/** Compile a specialised run and require one named value to come out equal. */
function runEquals(src: string, name: string, want: number): boolean {
  let ops
  try { ops = compileBasic(`${src}\ncheck = ${name}`, { stack: ['v', 's', 'fuel'], consts: CONSTS }).ops }
  catch { return false }
  const lock = new LockingScript([...ops, PN(want), op(OP.OP_NUMEQUAL)])
  const unlock = new UnlockingScript([0, 0, FUEL0].map(x => PN(x)))
  const spend = new Spend({
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
    lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
    unlockingScript: unlock, inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}

console.log('RACER SPECIALISED — the run compiled from its own simulation\n')

const sim = simulate()
const src = specialiseRun(sim.run)
const bytes = new LockingScript(compileBasic(src, { stack: ['v', 's', 'fuel'], consts: CONSTS }).ops)
  .toBinary().length

console.log(`        the simulation says: ${sim.run.ticks.length} ticks · ${(sim.run.ticks.length / 10).toFixed(2)} s · ends: ${sim.run.ending}`)
console.log(`        compiled: ${bytes.toLocaleString()} B · ${Math.round(bytes / sim.run.ticks.length)} B a tick\n`)

check('★★★ the specialised run reaches the simulated speed', runEquals(src, 'v', sim.v))
check('★★★ …and the simulated distance', runEquals(src, 's', sim.s))
check('★★★ …and the simulated fuel', runEquals(src, 'fuel', sim.fuel))
check('★★ it crossed the line', sim.s >= FINISH)

/* ── ★★ LYING TO THE COMPILER — a wrong prediction must produce NO race ─────────────────────────── */
{
  // claim the car spun on a tick where it did not: `VERIFY demand > grip` cannot hold
  const lie = { ...sim.run, ticks: sim.run.ticks.map((t, i) => i === 5 ? { ...t, spun: !t.spun } : t) }
  check('★★★ a run that lies about a spin does not validate', !runEquals(specialiseRun(lie), 'v', sim.v))

  // claim the race is one tick shorter: the last tick's `VERIFY ns >= finish` cannot hold
  const short = { ...sim.run, ticks: sim.run.ticks.slice(0, -1) }
  check('★★★ a run that claims a shorter race does not validate',
    !runEquals(specialiseRun(short), 'v', sim.v))
}

/* ── what it saves ───────────────────────────────────────────────────────────────────────────────── */
{
  const chainedFee = sim.run.ticks.length * R.BURN0
  const specFee = Math.round(2 * bytes * 0.1)
  console.log(`\n        chained ${chainedFee.toLocaleString()} sat  ·  specialised ~${specFee.toLocaleString()} sat` +
    `  ⇒ ${(chainedFee / specFee).toFixed(1)}x`)
  check('★★ one specialised transaction is cheaper than the chained race', specFee < chainedFee)
}

/* ── ★★★ THE WRECKS — a run that ends badly must be COMPILED to end badly ───────────────────────────
   "Predestiny written to chain" (sun-dive, 18 Aug): the crash is not an exception path, it is the last
   line of the program. A car is minted already knowing how it dies, and the chain accepts no other death. */
{
  const wreck = (label: string, cfg: Record<string, number>, throttle: number, want: Ending): void => {
    const consts = { ...CONSTS, eng: cfg.eng ?? ENG, tyr: cfg.tyr ?? TYR, slip: cfg.slip ?? SLIP,
      LOOSE_V: R.LOOSE_V }
    let st: Record<string, number> = { ...ST0, ...cfg } as never, fuel = FUEL0
    const ticks: TickTrace[] = []
    let ending: Ending = 'finish'
    for (let i = 0; i < 400; i++) {
      const r = refTick(st as never, { throttle, fuel, lockTime: st.last + st.gap }, R)
      fuel -= r.burn
      ticks.push({ throttle: r.throttle, spun: r.spun })
      st = { ...(r.state as never as typeof st), last: st.last + st.gap }
      if (r.ended === 'off') { ending = 'off'; break }
      if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; break }
      if (st.phase === PHASE.DONE) break
    }
    const run: RunTrace = { ticks, ending }
    const src = specialiseRun(run)
    const runs = (name: string, w: number): boolean => {
      let ops
      try { ops = compileBasic(`${src}\ncheck = ${name}`, { stack: ['v', 's', 'fuel'], consts }).ops }
      catch { return false }
      const lock = new LockingScript([...ops, PN(w), op(OP.OP_NUMEQUAL)])
      const sp = new Spend({
        sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
        lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
        unlockingScript: new UnlockingScript([0, 0, FUEL0].map(x => PN(x))),
        inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
      })
      try { return sp.validate() } catch { return false }
    }
    check(`★★★ ${label} — ends '${ending}' at tick ${ticks.length}, and the script says so`,
      ending === want && runs('v', 0) && runs('fuel', fuel))
  }

  wreck('a standing car at full throttle', { tyr: 1, slip: 400, eng: 24 }, 16, 'blown-throttle')
  wreck('a big engine that gets away at speed', { tyr: 10, slip: 1000, eng: 24 }, 8, 'off')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'RACER SPECIALISED OK — the branches are gone and the enforcement is not.'
  : 'RACER SPECIALISED FAILED')
process.exit(fail === 0 ? 0 : 1)
