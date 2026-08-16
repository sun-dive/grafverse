// © BSV Association — Open BSV License v6.
// ★★ THE SPLASH AND DASH — a run that would have died of thirst, rescued mid-race and brought home.
//
//   node --experimental-strip-types mint/test/depot-splash.ts
//
// This is the DEMO's acceptance test, not a unit test. Everything below is a real chained transaction
// validated by the interpreter, in the order a browser would send them:
//
//   under-fuel a car  →  race it until the plan says it dies short of the line
//                     →  TAP THE PUMP without giving up the run
//                     →  carry on from exactly where it was
//                     →  cross the line
//
// ⚠ WHAT MAKES IT A TEST RATHER THAN A DEMONSTRATION: the run must genuinely be unwinnable first. A
// car with enough fuel would reach the line whether or not the pit stop worked, and the check would
// pass having proved nothing — the `shell-blow` mistake. So the plan is asserted 'dry' BEFORE the
// rescue, and the distance it died at is printed.
import { Transaction, Spend, PrivateKey, TransactionSignature, Hash, UnlockingScript } from '@bsv/sdk'
import { buildDepotLock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE } from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE, PHASE, S, type ShellState } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import {
  planRace, raceFrom, pitStep, buildPublicMove, buildRefuelMove, lockTimeFor, type Step,
} from '../src/publicDriver.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const sat = (n: number): string => Math.round(n).toLocaleString()

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const FRESH = freshPublicShell(OWNER)
const CAR = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })

const GREEN = 1_700_000_000
const CFG = { eng: 14, tyr: 10, finishM: 402, green: GREEN }
const SEED = 12_000          // ⚠ deliberately far too little for a quarter mile
const TANK = 200_000

console.log('\nTHE SPLASH AND DASH — a dry run, rescued and brought home\n')

// the car, born by ordinary payment; the depot, funded
const carGenesis = new Transaction()
carGenesis.addOutput({ lockingScript: CAR, satoshis: SEED })
const depotGenesis = new Transaction()
depotGenesis.addOutput({ lockingScript: DEPOT, satoshis: TANK })

let st: ShellState = FRESH
let val = SEED
let prev = carGenesis
let vout = 0
let depotTx = depotGenesis
let depotVal = TANK
let sent = 0

/** Run a list of steps as real chained transactions, stopping if the covenant ever refuses. */
function drive(steps: Step[]): boolean {
  for (const step of steps) {
    const m = buildPublicMove({ prevTx: prev, vout, state: st, value: val, step, lockTime: lockTimeFor(st) })
    if (!m.ok) { console.log(`        ⚠ the covenant refused: ${step.label}`); return false }
    prev = m.tx; vout = 0; st = step.next; val = step.out; sent++
  }
  return true
}

// ── 1. the plan, and it is NOT a winnable one ─────────────────────────────────────────────────────
const plan = planRace(FRESH, SEED, CFG)
check('★ the run is genuinely unwinnable on this fuel', plan.outcome === 'dry')
console.log(`        ${plan.why} · ${plan.steps.length} moves planned on ${sat(SEED)} sat`)

/* ── ⚠⚠ AND THE PIT MUST COME BEFORE THE LAST DROP, NOT AFTER IT ─────────────────────────────────
   Measured here, and it is a REGULATION rather than a defect. The depot's arrival rule is
   `carOut ≥ (what left the tank) − MAX_FEE`, and a splash-and-dash burns the car's own tick in the
   same transaction, so:

       carOut = old − burn + draw  ≥  draw     ⇒     old ≥ burn

   **The car must be able to pay for the tick it is making.** The depot cannot cover a burn it cannot
   see — it has no way to read the car's state, and relaxing the rule so it could is precisely the hole
   that turns a tank into a faucet (`depot-arrival`).

   ⇒ So a driver pits on the LAST AFFORDABLE tick, not one tick later. Run the plan to its final move
   and you are stranded with 443 sat, which is 229 short of the tick that would have saved you. That is
   a racing rule, and a real one: you pit before the tank is dry, not after. */
check('  …and it is driven to its LAST AFFORDABLE tick', drive(plan.steps.slice(0, -1)))
console.log(`        at ${(st.s / S).toFixed(0)} m · tick ${st.n} · ${sat(val)} sat left · phase ${st.phase}`)
check('  the car is stranded MID-RACE, not finished', st.phase === PHASE.RACING)

// ── 2. ★★ THE PIT STOP — one transaction, two covenants, and the run is not given up ──────────────
console.log()
const step = pitStep(st, val)
check('★ there is a tick to take while the pump runs', step !== null)
check('★★ …and the car can still afford it — pit BEFORE the last drop', val >= step!.burn)

const beforeM = st.s / S, beforeN = st.n
const refuel = buildRefuelMove({
  prevTx: prev, vout, state: st, value: val, step: step!, lockTime: lockTimeFor(st),
  depot: { sourceTransaction: depotTx, outputIndex: 0, value: depotVal }, depotLock: DEPOT,
  draw: DEPOT_DRAW, depotMaxFee: DEPOT_MAX_FEE, depotScope: DEPOT_SCOPE,
})
check('★★ the CAR accepts the tick that takes fuel', refuel.carOk)
check('★★ …and the DEPOT accepts paying for it, in the same transaction', refuel.depotOk)
check('  …and the car did NOT reset — the run continues', refuel.carOk && step!.next.phase === PHASE.RACING)
console.log(`        ${refuel.tx.toHex().length / 2} B · 2 in, 2 out · ` +
  `car ${sat(val)} → ${sat(refuel.carOut)} · tank ${sat(depotVal)} → ${sat(refuel.kept)}`)

prev = refuel.tx; vout = 0; st = step!.next; val = refuel.carOut; sent++
depotTx = refuel.tx; depotVal = refuel.kept

// ── 3. …and it gets home ──────────────────────────────────────────────────────────────────────────
console.log()
const rest = raceFrom(st, val)
check('★ the continuation reaches the line', rest.outcome === 'home')
check('★★ …and every remaining move is accepted by the covenant', drive(rest.steps))
check('★★★ THE CAR IS HOME — a run that was dead at ' + beforeM.toFixed(0) + ' m', st.phase === PHASE.DONE)
console.log(`        HOME in ${(st.n * 0.1).toFixed(1)} s · ${(st.s / S).toFixed(0)} m · ` +
  `${((st.v / S) * 22.3694).toFixed(0)} mph · ${sent} transactions · ${sat(val)} sat left`)
console.log(`        rescued at ${beforeM.toFixed(0)} m on tick ${beforeN}, ` +
  `carried on for ${st.n - beforeN} more ticks`)

// ── 4. ⚠ AND THE PIT STOP COSTS SOMETHING — it is a trade, not a free undo ────────────────────────
console.log()
{
  const clean = planRace(FRESH, 45_000, CFG)
  check('  a car fuelled properly from the start also gets home', clean.outcome === 'home')
  const cleanN = clean.steps[clean.steps.length - 1].next.n
  console.log(`        properly fuelled: ${(cleanN * 0.1).toFixed(1)} s   ` +
    `· rescued: ${(st.n * 0.1).toFixed(1)} s`)
  console.log('        ⇒ the tap costs a tick and the extra fuel is MASS — exactly the trade a real one makes')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SPLASH: FAIL — the demo cannot rescue a dry run'); process.exit(1) }
console.log('SPLASH OK — a dead run tapped the pump mid-race and crossed the line.')
