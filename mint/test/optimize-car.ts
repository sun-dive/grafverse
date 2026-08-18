// © BSV Association — Open BSV License v6.
//
// ★★★ THE CAR MINT'S OWN OPTIMISER — is it the same race, and does the checker actually catch one?
//
//   node --experimental-strip-types mint/test/optimize-car.ts
//
// `basic.ts` is LIVE and governed by THE HARD RULE: it says what the program says and is never
// "improved" in place. `optimizeCarCompile.ts` is where the car mint is allowed to be clever instead,
// under one written scope — LOOP-INVARIANT HOISTING OF A SPECIALISED RACE BODY, and nothing else.
//
// ⚠⚠ THE CHECKS THAT MATTER HERE ARE THE ONES THAT FAIL. An optimiser that has never been watched
// refuse a wrong answer is indistinguishable from one that always says yes — this project shipped
// exactly that once already, a "no signature anywhere" test that was a substring search and passed
// by accident 98.4% of the time. So the guard is provoked, not assumed.
import { LockingScript } from '@bsv/sdk'
import {
  carPrograms, optimizeCarCompile, proveAgrees, RACE_PREAMBLE, CARRIED,
} from '../src/optimizeCarCompile.ts'
import { specialiseRun, type TickTrace, type Ending, type RunTrace } from '../src/racerTick.ts'
import { RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick } from '../src/shell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const throws = (f: () => unknown): string => {
  try { f(); return '' } catch (e) { return (e as Error).message }
}

const ENG = 14, TYR = 10, SLIP = 1000, FINISH = Math.round(402 * S), TANK = 40000
const CONSTS: Record<string, number> = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
  eng: ENG, tyr: TYR, slip: SLIP, finish: FINISH, TANK,
}
const ST0: Record<string, unknown> = {
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: ENG, tyr: TYR, finish: FINISH, slip: SLIP, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
}

function simulate(throttle = 8, cap = 400): RunTrace {
  let st = { ...ST0 } as Record<string, number>
  let fuel = TANK
  const ticks: TickTrace[] = []
  let ending: Ending = 'finish'
  for (let i = 0; i < cap; i++) {
    const r = refTick(st as never, { throttle, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (r.ended === 'off') { ending = 'off'; break }
    if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; break }
    if (st.phase === PHASE.DONE) break
  }
  return { ticks, ending }
}

console.log('THE CAR MINT OPTIMISER — a separate thing, proved against the compiler it does not touch\n')

const RUN = simulate()
const o = optimizeCarCompile(RUN, CONSTS)

console.log(`        ${RUN.ticks.length} ticks · faithful ${o.faithfulBytes.toLocaleString()} B` +
  ` · optimised ${o.optimisedBytes.toLocaleString()} B` +
  ` ⇒ ${((1 - o.optimisedBytes / o.faithfulBytes) * 100).toFixed(1)}% smaller`)
console.log(`        hoisted: ${o.programs.hoisted.map(h => h.name).join(' · ')}\n`)

check('★★★ the optimised race agrees with the faithful one on every carried value',
  o.agreed.length === CARRIED.length)
check('★★ …and it is genuinely smaller', o.optimisedBytes < o.faithfulBytes)
check('★ four invariants were lifted out of the tick body', o.programs.hoisted.length === 4)

/* ── ★★ IT IS A SOURCE TRANSFORM, WHICH IS WHY FAITHFULNESS SURVIVES ──────────────────────────────
   The chain gets what the OPTIMISED program says, line for line. An opcode rewriter could not promise
   that, and the reader would show soup. */
{
  const p = o.programs.optimised
  check('★★★ the optimised program is still a PROGRAM — the expressions are there to read',
    p.includes('demand8 = eng * FE * 8 / TM') && p.includes('chassis = M0 + eng * WE + tyr * WT'))
  check('★★ the engine and the throttle are still visible — this is not a constant folder',
    p.includes('eng * FE * 8') && !p.includes('9620726745'))
  check('★ the tick body now uses the lifted names instead of recomputing',
    p.includes('mass = chassis + FMUL(fuel * S, WF)'))
  check('★ both programs are handed back, so a reader can see what was written AND what was minted',
    o.programs.faithful.includes('M0 + eng * WE') && o.programs.faithful !== o.programs.optimised)
}

/* ── ★★★ THE GUARD, PROVOKED — a checker never seen to fail is not a checker ───────────────────── */
{
  const { faithful, optimised } = o.programs

  /* Same program twice must obviously agree — the control, without which "it refused" below could
     just mean "it always refuses". */
  check('★★ the checker passes a pair that IS the same race',
    throws(() => proveAgrees(faithful, faithful, CONSTS)) === '')

  /* ⚠⚠ SABOTAGE WITH split/join, NEVER `replace`. A string pattern replaces the FIRST occurrence
     only, and the first draft of this file pinned tick 1's mass — where the fuel IS the full tank, so
     nothing changed and the guard was declared to have a hole it did not have. A sabotage that does
     not land tests nothing, and it looks exactly like a test that found something. */
  const sabotage = (from: string, to: string): string => optimised.split(from).join(to)

  /* ★★ TWO WAYS A WRONG OPTIMISATION DIES, and the second is stronger than the first.
     A specialised run asserts its own ending, so most wrong arithmetic cannot produce a VALID SCRIPT
     at all — it does not race differently, it does not race. Only a wrong answer that still crosses
     the line survives long enough to disagree. Both are refusals; the guard must accept either. */
  const refused = (o: string): { caught: boolean; how: string } => {
    const m = throws(() => proveAgrees(faithful, o, CONSTS))
    return { caught: m !== '', how: m.includes('disagrees') ? 'disagrees' : m.includes('could not read') ? 'will not validate' : m }
  }

  /* lighter chassis ⇒ a FASTER car, which still crosses the line ⇒ it survives to disagree */
  const tyres = refused(sabotage('chassis = M0 + eng * WE + tyr * WT', 'chassis = M0 + eng * WE + 9 * WT'))
  check('★★★ a hoist computed from the WRONG TYRES is caught', tyres.caught)
  console.log(`        wrong tyres          ${tyres.how}`)

  /* less demand ⇒ a SLOWER car ⇒ `VERIFY ns >= finish` cannot hold ⇒ there is no race to compare */
  const throttle = refused(sabotage('demand8 = eng * FE * 8 / TM', 'demand8 = eng * FE * 7 / TM'))
  check('★★★ a lifted demand at the WRONG THROTTLE is caught', throttle.caught)
  console.log(`        wrong throttle       ${throttle.how}`)

  /* ⚠ THE MISTAKE AN OPTIMISER ACTUALLY MAKES: lifting one line too many. `mass` is NOT invariant —
     it falls as the fuel burns — so pinning it at the full tank is a car that never lightens. */
  const mass = refused(sabotage('mass = chassis + FMUL(fuel * S, WF)', `mass = chassis + FMUL(${TANK} * S, WF)`))
  check('★★★ lifting something NOT invariant — a mass that never lightens — is caught', mass.caught)
  console.log(`        mass never lightens  ${mass.how}`)

  check('★★ …and at least one of them survived far enough to DISAGREE, not merely fail to run',
    [tyres, throttle, mass].some(x => x.how === 'disagrees'))
}

/* ── ⚠ AND IT REFUSES TO OPTIMISE NOTHING SUCCESSFULLY ────────────────────────────────────────────
   A hoist that silently stops matching is a cost increase nobody notices, because the car still
   works. It must be loud. */
{
  const rewritten = specialiseRun(simulate(8, 3)).replace(/M0 \+ eng \* WE \+ tyr \* WT/g, 'M0 + eng * WE')
  const m = throws(() => carPrograms(simulate(8, 3), { body: rewritten }))
  check('★★★ a physics rewrite that breaks a hoist THROWS rather than quietly optimising nothing',
    m.includes('expected to hoist'))
  console.log(`        ${m.split('.')[0].replace('optimizeCarCompile: ', '')}`)
}

/* ── ★ A run that changes throttle gets one lifted binding per distinct value ─────────────────── */
{
  const mixed: RunTrace = {
    ticks: RUN.ticks.map((t, i) => ({ ...t, throttle: i % 2 === 0 ? 8 : 6 })),
    ending: RUN.ending,
  }
  const p = carPrograms(mixed)
  check('★ two throttles ⇒ two lifted demands and two lifted burns, not one of each',
    p.hoisted.filter(h => h.name.startsWith('demand')).length === 2 &&
    p.hoisted.filter(h => h.name.startsWith('burn')).length === 2)
}

/* ── ⚠ THE WRECKS OPTIMISE TOO, or a car that dies cannot be minted cheaply ───────────────────── */
{
  const wreck = simulate(16)
  const w = optimizeCarCompile(wreck, { ...CONSTS, eng: 24, tyr: 1, slip: 400 })
  console.log(`\n        the wreck: ${wreck.ticks.length} tick(s) · ends '${wreck.ending}' · ` +
    `${w.faithfulBytes} → ${w.optimisedBytes} B`)
  check(`★★ a ${wreck.ticks.length}-tick run ending '${wreck.ending}' optimises and still agrees`,
    w.agreed.length === CARRIED.length)
}

/* ── the preamble lives here, because car compilation is centred here ────────────────────────────── */
check('★ the race preamble is owned by the optimiser, not by the general compiler',
  RACE_PREAMBLE.includes('fuel = TANK') && RACE_PREAMBLE.includes('v = 0'))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'OPTIMIZE CAR OK — a separate optimiser, proved against the compiler it never touches.'
  : 'OPTIMIZE CAR FAILED')
process.exit(fail === 0 ? 0 : 1)
