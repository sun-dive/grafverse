// © BSV Association — Open BSV License v6.
// ★★ RUNNING DRY — what actually happens, now that the pump will not come to you.
//
//   node --experimental-strip-types mint/test/depot-dry.ts
//
// ── ✗ THIS FILE USED TO PROVE THE OPPOSITE, AND THAT IS WORTH KEEPING IN VIEW ─────────────────────
// It was `depot-splash.ts`, and its headline was "a dead run tapped the pump mid-race and crossed the
// line". Every transaction below is the same shape; only the verdict changed, and it changed because
// of a measurement rather than a change of heart (sun-dive, 16 Aug):
//
//   best single fill        49,000 sat  →  3.9 s
//   28,000 + one 20,000 tap at tick 9   →  3.3 s on 48,000 sat    ★ faster AND cheaper
//
// Fuel is MASS. Starting light and topping up once you are already moving is not a rescue, it is the
// OPTIMUM — and a line that dominates every other line is not a strategy, it is a bug with manners.
//
// ⇒ THE RULE IS ONE COMPARISON IN THE DEPOT: it will not pump into a car whose `s` is not zero. About
// five bytes, on a spend that happens a few times a race. The car that used to price this carried a
// `PIT` rule costing 27 bytes of locking script — paid for TWICE, on every one of ~45 ticks, forever.
//
// ★ AND IT IS THE HONEST RULE. There is no pit lane on a quarter mile.
//
// ── WHAT IS LEFT WHEN A CAR RUNS SHORT ────────────────────────────────────────────────────────────
//   1. it COASTS on its reserve — satoshis that pay the miner and weigh nothing — and may still get home
//   2. or it stops where the money ran out, and that is a result, not an error
//   3. the pump is not an option at any point after the lights
import { Transaction, PrivateKey, Hash } from '@bsv/sdk'
import { buildDepotLock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK } from '../src/depot.ts'
import {
  buildShellLock, shellMaxFee, refTick, PUBLIC_CAR_REGS, PHASE, S, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import {
  planRace, raceFrom, buildPublicMove, buildRefuelMove, lockTimeFor, type Step,
} from '../src/publicDriver.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const sat = (n: number): string => Math.round(n).toLocaleString()
const m = (x: number): string => (x / S).toFixed(0)

const REGS = PUBLIC_CAR_REGS
const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const FRESH = freshPublicShell(OWNER)
const CAR = buildShellLock({ state: FRESH, maxFee: shellMaxFee(REGS), public: true, regs: REGS })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER, maxTank: DEPOT_MAX_TANK })

const GREEN = 1_700_000_000
const CFG = { eng: 14, tyr: 10, finishM: 402, green: GREEN }
const SEED = 26_000          // ⚠ deliberately short for a quarter mile
const TANK = 200_000

console.log('\nRUNNING DRY — the pump does not come to you\n')

const carGenesis = new Transaction()
carGenesis.addOutput({ lockingScript: CAR, satoshis: SEED })
const depotGenesis = new Transaction()
depotGenesis.addOutput({ lockingScript: DEPOT, satoshis: TANK })

let st: ShellState = FRESH
let val = SEED
let prev = carGenesis
let vout = 0
let sent = 0

/** Run a list of steps as real chained transactions, stopping if the covenant ever refuses. */
function drive(steps: Step[]): boolean {
  for (const step of steps) {
    const mv = buildPublicMove({ prevTx: prev, vout, state: st, value: val, step,
                                 lockTime: lockTimeFor(st), regs: REGS })
    if (!mv.ok) { console.log(`        ⚠ the covenant refused: ${step.label}`); return false }
    prev = mv.tx; vout = 0; st = step.next; val = step.out; sent++
  }
  return true
}

// ── 1. a car that is genuinely short, driven until it is out on the strip ─────────────────────────
const plan = planRace(FRESH, SEED, CFG, REGS)
check('★ this car is genuinely short of fuel for the distance', plan.outcome !== 'home')
console.log(`        ${plan.why} · ${plan.steps.length} moves planned on ${sat(SEED)} sat`)

check('  …and it is driven to its LAST AFFORDABLE tick', drive(plan.steps.slice(0, -1)))
console.log(`        at ${m(st.s)} m · tick ${st.n} · ${sat(val)} sat left · phase ${st.phase}`)
check('  the car is out on the strip, not finished', st.phase === PHASE.RACING && st.s > 0)

// ── 2. ★★★ AND THE PUMP WILL NOT COME TO IT ───────────────────────────────────────────────────────
console.log()
{
  /* ⚠ A REAL TICK, NOT A FABRICATED ONE. The first draft offered the car its own state back, and the
     car refused it — correctly, since every move must advance the tick. That would have made the check
     below prove nothing about the depot: the car has to be WILLING, or the refusal is not the pump's. */
  const tick = refTick(st, { throttle: 0, lockTime: lockTimeFor(st), fuel: val }, REGS)
  const step: Step = { label: 'a tap that will not happen', next: tick.state, throttle: 0,
                       reset: false, out: val - tick.burn, burn: tick.burn }
  const r = buildRefuelMove({
    prevTx: prev, vout, state: st, value: val, step, lockTime: lockTimeFor(st),
    depot: { sourceTransaction: depotGenesis, outputIndex: 0, value: TANK }, depotLock: DEPOT,
    draw: DEPOT_DRAW, depotMaxFee: DEPOT_MAX_FEE, depotScope: DEPOT_SCOPE, regs: REGS,
  })
  check('★★★ THE DEPOT REFUSES — a car that has left the line cannot be fuelled', r.depotOk, false)
  console.log(`        the car is at ${m(st.s)} m, so its \`s\` is not zero, and that is the whole rule`)
  /* ★ The car has no opinion and carries no byte on the subject — the refusal is one covenant
     declining to pay, not two covenants arguing. That is what makes it cheap. */
  check('  …while the CAR would have accepted the very same move', r.carOk)
}

// ── 3. ★★ WHAT RESCUES IT INSTEAD: THE RESERVE, AND IT IS THE ONLY RESCUE THERE IS ────────────────
// Satoshis that pay the miner and weigh nothing. A dry car keeps buying ticks and coasts, drag
// bleeding the speed off, and may still reach the line — which is what a real one does.
console.log()
{
  const short = planRace(FRESH, 26_000, CFG, REGS)
  const rescued = planRace(FRESH, 26_000 + REGS.RESERVE, CFG, REGS)
  check('★★ the same car, carrying its reserve, gets home', short.outcome !== 'home' && rescued.outcome === 'home')
  const last = rescued.steps[rescued.steps.length - 1]
  let coasting = 0
  for (const s of rescued.steps) if (s.burn === REGS.BURN0 && s.next.phase === PHASE.RACING) coasting++
  console.log(`        ${sat(26_000)} propellant: ${m(short.steps[short.steps.length - 1].next.s)} m of 402` +
    `   ·   + ${sat(REGS.RESERVE)} reserve: ★ HOME in ${(last.next.n * 0.1).toFixed(1)} s` +
    ` (${coasting} ticks coasting)`)

  /* ⚠ AND IT IS NOT A FREE PASS — it has a measured limit, and below it a car still dies short.
     The rescue that always worked was the splash, and the splash is exactly what was deleted. */
  let boundary = 0
  for (let prop = 6_000; prop <= 30_000; prop += 2_000) {
    if (planRace(FRESH, prop + REGS.RESERVE, CFG, REGS).outcome === 'home') { boundary = prop; break }
  }
  check('★ the reserve has a limit — under it, a run simply ends short', boundary > 6_000)
  console.log(`        least propellant that still gets home on a ${sat(REGS.RESERVE)} reserve: ${sat(boundary)}`)
}

// ── 4. ★ AND THE PUMP STILL WORKS WHERE IT SHOULD — at the line, and after a reset ────────────────
console.log()
{
  // the same stranded car, RESET back to the line in the same transaction that fuels it
  const resetStep: Step = { label: 'reset and fill', next: { ...FRESH }, throttle: 0, reset: true,
                            out: val - REGS.BURN0, burn: REGS.BURN0 }
  const r = buildRefuelMove({
    prevTx: prev, vout, state: st, value: val, step: resetStep, lockTime: lockTimeFor(st),
    depot: { sourceTransaction: depotGenesis, outputIndex: 0, value: TANK }, depotLock: DEPOT,
    draw: DEPOT_DRAW, depotMaxFee: DEPOT_MAX_FEE, depotScope: DEPOT_SCOPE, regs: REGS,
  })
  check('★★ give up the run and the pump fills you — the reset zeroes `s`', r.depotOk && r.carOk)
  console.log(`        ${sat(val)} → ${sat(r.carOut)} sat · back at the line, tick 0 · ` +
    `${r.tx.toHex().length / 2} B`)
  console.log('        ⇒ the choice a short car has: coast and hope, or start again. Never both.')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DRY: FAIL'); process.exit(1) }
console.log('DRY OK — no pit lane on a quarter mile; the reserve is the only rescue.')
