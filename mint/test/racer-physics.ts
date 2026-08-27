// © 2026 sun-dive — Apache License 2.0.
//
// ★★★ THE DRIFT GUARD — does the racers' own tick still agree with the shell's?
//
//   node --experimental-strip-types mint/test/racer-physics.ts
//
// ⚠⚠ WHY THIS FILE EXISTS. `racerPhysics.ts` holds a COPY of `refTick`'s logic, because the one-race
// car's physics must not live in `shell.ts` — that file is bundled into BOTH live bundles, grafmint.js
// (six pages) and, through `grafbasic.ts`, grafbasic.js (basic.html). Isolation was the right call and
// it was sun-dive's; the price is two implementations, and two implementations DRIFT.
//
// ⇒ So the price is paid here instead. With both switches OFF, `racerRefTick` must equal `refTick`
// field for field, over a sweep. A drift then shows up as a red test rather than as a wrong car with
// no key to rescue it.
import { refTick, RACER_REGS, S, PHASE, type ShellState } from '../src/shell.ts'
import { racerRefTick, ONE_RACE_REGS, RACER_PHASE, type OneRaceRegs } from '../src/racerPhysics.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean): void => {
  console.log(`${got ? 'PASS' : 'FAIL'}  ${n}`); got ? pass++ : fail++
}

/** The racers' regs with model C switched OFF — which should be the shell's physics exactly. */
const OFF: OneRaceRegs = { ...ONE_RACE_REGS, DRAG2: RACER_REGS.DRAG2, AERO_BY_MASS: 0, COAST_STOP: 0 }

const st = (o: Partial<ShellState>): ShellState => ({
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: 14, tyr: 10, finish: Math.round(402 * S), slip: 1000, green: 0, gap: 1, last: 100,
  s: 0, v: 0, n: 0, ...o,
} as ShellState)

console.log('THE DRIFT GUARD — the racers\' own tick against the shell\'s\n')

/* ── ★★★ 1 · WITH THE SWITCHES OFF THEY MUST BE THE SAME TICK ─────────────────────────────────────
   Swept rather than sampled: speed × fuel × throttle × engine × tyre, including the cases that end a
   run, because an ending is where two implementations most easily part company. */
{
  let compared = 0, differed = 0, first = ''
  for (const v of [0, 0.4, 2, 6, 10, 14]) {
    for (const fuel of [0, 1, 5_000, 40_000]) {
      for (const throttle of [0, 4, 8, 14, 16]) {
        for (const [eng, tyr] of [[1, 1], [14, 10], [24, 10], [24, 1]] as Array<[number, number]>) {
          const state = st({ v: Math.round(v * S), eng, tyr, s: Math.round(100 * S) })
          const move = { throttle, fuel, lockTime: state.last + state.gap }
          let a, b
          try { a = JSON.stringify(refTick(state, move, RACER_REGS)) } catch (e) { a = 'THREW ' + (e as Error).message }
          try {
            const r = racerRefTick(state, move, OFF)
            /* ⚠ `throttle` is the racers' addition and the shell has no such field — compare what the
               shell actually reports, or this passes for the wrong reason. */
            const { throttle: _t, ...rest } = r
            b = JSON.stringify(rest)
          } catch (e) { b = 'THREW ' + (e as Error).message }
          compared++
          if (a !== b) { differed++; if (!first) first = `v ${v} fuel ${fuel} th ${throttle} eng ${eng} tyr ${tyr}\n    shell: ${a}\n    racer: ${b}` }
        }
      }
    }
  }
  console.log(`        swept ${compared} states — speed × fuel × throttle × engine × tyre`)
  if (differed) console.log(`        first divergence: ${first}`)
  check(`★★★ with both switches OFF, racerRefTick IS refTick on all ${compared} states`, differed === 0)
}

/* ── ⚠ 2 · AND THE GUARD MUST BE ABLE TO FAIL ─────────────────────────────────────────────────────
   A checker nobody has watched fail is indistinguishable from one that always says yes. This repo has
   shipped one of those before — a "no signature anywhere" test that was a substring search. */
{
  const state = st({ v: Math.round(6 * S), s: Math.round(100 * S) })
  const move = { throttle: 8, fuel: 40_000, lockTime: state.last + state.gap }
  const sabotaged: OneRaceRegs = { ...OFF, DRAG: RACER_REGS.DRAG + 1 }
  const a = JSON.stringify(refTick(state, move, RACER_REGS).state)
  const b = JSON.stringify(racerRefTick(state, move, sabotaged).state)
  check('⚠ …and one satoshi of DRAG apart makes them differ — the guard can fail', a !== b)
}

/* ── ★★ 3 · WITH THE SWITCHES ON, THEY MUST *NOT* AGREE — or model C is not doing anything ────────*/
{
  const state = st({ v: Math.round(10 * S), s: Math.round(100 * S) })
  const move = { throttle: 8, fuel: 0, lockTime: state.last + state.gap }
  const shell = refTick(state, move, RACER_REGS)
  const racer = racerRefTick(state, move, ONE_RACE_REGS)
  check('★★ with model C ON the two differ — the switch is doing real work',
    shell.state.v !== racer.state.v)
}

/* ── ★★★ 4 · THE THINGS ONLY THE RACERS HAVE ─────────────────────────────────────────────────────*/
{
  const dry = st({ v: Math.round(10 * S), s: Math.round(10 * S) })
  const r = racerRefTick(dry, { throttle: 8, fuel: 0, lockTime: dry.last + dry.gap }, ONE_RACE_REGS)
  check('★★ a dry tick reports the EFFECTIVE throttle, which is zero', r.throttle === 0)
  check('★★ a fuelled tick reports the throttle that was asked for',
    racerRefTick(dry, { throttle: 8, fuel: 40_000, lockTime: dry.last + dry.gap }, ONE_RACE_REGS).throttle === 8)
  /* ⚠ NOT from (s 10, v 10): at 10 m/tick `reach` is still ~485 against a 402 m line, so the car is
     NOT yet provably short and the ending correctly does not fire. The first version of this check
     asserted it did, and was wrong about the physics rather than finding a bug. ⇒ Two checks instead:
     one state that IS provably short in a single tick, and the run that gets there. */
  const slow = st({ v: Math.round(2 * S), s: Math.round(100 * S) })
  const one = racerRefTick(slow, { throttle: 8, fuel: 0, lockTime: slow.last + slow.gap }, ONE_RACE_REGS)
  check('★★★ a dry car already provably short ends STOPPED in ONE tick — no coast simulated',
    one.ended === 'stopped' && one.state.phase === RACER_PHASE.STOPPED)

  /* ★ and a faster dry car is not short YET — it coasts until `reach` falls under the line, which it
     always does, because `reach` never rises. Measured: 9–17 ticks for a clear-cut car. */
  check('★ …while a dry car at 10 m/tick is NOT yet provably short', r.ended === null)
  {
    let cur = dry, t = 0, ending: string | null = null
    for (; t < 5000; t++) {
      const k = racerRefTick(cur, { throttle: 8, fuel: 0, lockTime: cur.last + cur.gap }, ONE_RACE_REGS)
      cur = k.state as ShellState
      if (k.ended !== null) { ending = k.ended; break }
      if (cur.phase === PHASE.DONE) { ending = 'finish'; break }
    }
    console.log(`        the 10 m/tick car resolved after ${t + 1} ticks as '${ending}'`)
    check('★★★ …and it does reach an ending — `reach` never rises, so the run always terminates',
      ending === 'stopped')
  }

  /* ⚠ NEGATIVE CONTROL — crawling ACROSS the line is a FINISH, because the finish is tested first. */
  const crawl = st({ v: Math.round(0.5 * S), s: Math.round(401.7 * S) })
  const c = racerRefTick(crawl, { throttle: 8, fuel: 0, lockTime: crawl.last + crawl.gap }, ONE_RACE_REGS)
  check('⚠ …but a car crawling ACROSS the line still FINISHES, not stopped',
    c.ended === null && c.state.phase === PHASE.DONE)

  /* ⚠ and with COAST_STOP off, the same dry car simply keeps rolling — the switch is real. */
  const off = racerRefTick(dry, { throttle: 8, fuel: 0, lockTime: dry.last + dry.gap }, OFF)
  check('⚠ with COAST_STOP OFF the same car has no ending at all — the switch is real',
    off.ended === null)
}

/* ── ⚠⚠ 5 · AND `shell.ts` MUST NOT HAVE LEARNED ABOUT ANY OF THIS ───────────────────────────────
   The whole point of the split: `shell.ts` is bundled into both live bundles, so a racers field
   appearing there means the isolation has quietly broken again. */
{
  const shellKeys = Object.keys(RACER_REGS)
  check('⚠⚠ RACER_REGS carries NO racers-only field — the isolation holds',
    !shellKeys.includes('AERO_BY_MASS') && !shellKeys.includes('COAST_STOP') && !shellKeys.includes('STOP_V'))
  check('⚠⚠ the shell\'s PHASE has no STOPPED — that phase is the racers\' own',
    (PHASE as Record<string, number>).STOPPED === undefined && RACER_PHASE.STOPPED === 7)
  check('⚠ and the shell\'s tick reports no throttle — that field is the racers\' own',
    (refTick(st({ v: 0 }), { throttle: 8, fuel: 40_000, lockTime: 101 }, RACER_REGS) as Record<string, unknown>).throttle === undefined)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'RACER PHYSICS OK — the racers\' tick is the shell\'s, plus exactly two switches, and shell.ts is clean.'
  : '⚠ THE TWO HAVE DRIFTED — do not mint anything.')
process.exit(fail === 0 ? 0 : 1)
