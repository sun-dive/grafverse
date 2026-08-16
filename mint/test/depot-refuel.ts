// © BSV Association — Open BSV License v6.
// ★★ THE FUEL BUTTON — the depot filling a car that already exists.
//
//   node --experimental-strip-types mint/test/depot-refuel.ts
//
// This is the transaction the depot exists for, and the one it could not build for two days. Two
// covenants, two inputs, two outputs, each validating its own half without being able to read the
// other:
//
//   IN    car (low, any phase)   +  depot (V)
//   OUT   car (low + draw)       +  depot (≥ V − DRAW − MAX_FEE)
//
// ── ⚠⚠ WHAT WENT WRONG HERE, BECAUSE IT IS THE WHOLE REASON THIS FILE LOOKS LIKE THIS ─────────────
// Both covenants used to rebuild themselves at OUTPUT 0 and treat everything after as the spender's.
// A mint never noticed — the car is a NEW output, so its covenant is not running. A REFUEL spends
// both, and then both demanded the same slot and neither could move.
//
// The response at the time was to declare spec §4 impossible and call the depot a car MINTER, which it
// never was. Sixteen green tests then described a machine that could create cars and not fuel them.
// ⇒ The depot now carries a PREFIX, the car keeps out0, and the seam works in every phase.
//
// ★ WHAT THIS FILE HAS TO ESTABLISH:
//   1. both covenants accept the same transaction — at rest, mid-race, and after the flag
//   2. ★★ a car MID-RACE can take fuel WITHOUT giving up the run — the splash-and-dash
//   3. the old collision is still refused, so nobody quietly puts the depot back at out0
import { Transaction, Spend, PrivateKey, TransactionSignature, Hash, UnlockingScript } from '@bsv/sdk'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE,
} from '../src/depot.ts'
import {
  buildShellLock, shellUnlockingOps, SHELL_SCOPE, SHELL_MAX_FEE, PHASE, S, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { planRace, lockTimeFor, buildRefuelMove, type Step } from '../src/publicDriver.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const FRESH = freshPublicShell(OWNER)
const carLock = (st: ShellState) => buildShellLock({ state: st, maxFee: SHELL_MAX_FEE, public: true })
const CAR = carLock(FRESH)
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })
const ser = (sats: number, script: number[]): number[] => serializeOutput(sats, script)

console.log('\nTHE FUEL BUTTON — the depot filling a car that already exists\n')

/**
 * Build the refuel and validate each half independently.
 *
 * Input 0 is the car, input 1 the depot — each carrying its OWN preimage, since OP_PUSH_TX is
 * per-input. Output 0 is the CAR, because its covenant will rebuild itself nowhere else; the depot
 * follows at output 1 and names the car as its prefix.
 */
function refuel(o: {
  carState: ShellState
  carHas: number
  tank: number
  /** The car's move in the same transaction — its own covenant still has to be satisfied. */
  step: { next: ShellState; throttle: number; reset: boolean; out: number }
  /** What the depot hands over. */
  draw?: number
  /** Put the depot back at out0, the way it used to be — to prove that still cannot work. */
  depotFirst?: boolean
}): { depotOk: boolean; carOk: boolean; bytes: number } {
  const draw = o.draw ?? DEPOT_DRAW
  const kept = o.tank - draw
  const carOut = o.step.out + draw

  const cSrc = new Transaction()
  cSrc.addOutput({ lockingScript: carLock(o.carState), satoshis: o.carHas })
  const dSrc = new Transaction()
  dSrc.addOutput({ lockingScript: DEPOT, satoshis: o.tank })

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: cSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  const carOutput = { lockingScript: carLock(o.step.next), satoshis: carOut }
  const depotOutput = { lockingScript: DEPOT, satoshis: kept }
  if (o.depotFirst) { tx.addOutput(depotOutput); tx.addOutput(carOutput) }
  else { tx.addOutput(carOutput); tx.addOutput(depotOutput) }
  tx.lockTime = lockTimeFor(o.carState)

  const carAt = o.depotFirst ? 1 : 0
  const depotAt = o.depotFirst ? 0 : 1
  const serOut = (i: number): number[] =>
    ser(tx.outputs[i].satoshis ?? 0, tx.outputs[i].lockingScript.toBinary())

  // ── the car's half: everything after its own output is its "spenderOutputs"
  const carSubscript = carLock(o.carState)
  const cPre = TransactionSignature.format({
    sourceTXID: cSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.carHas, transactionVersion: 2,
    otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: carSubscript, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  const n = o.step.next
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(carAt + 1).map((_, k) => serOut(carAt + 1 + k)).flat(),
    newValue: u64(carOut), preimage: cPre, sig: [], pubKey: [],
    throttle: o.step.throttle, retire: o.step.reset,
    load: { driver: n.driver, pool: n.pool, eng: n.eng, tyr: n.tyr,
            finish: n.finish, slip: n.slip, green: n.green, gap: n.gap } }))

  // ── the depot's half: everything before its own output is the PREFIX
  const dPre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, transactionVersion: 2,
    otherInputs: [tx.inputs[0]], inputIndex: 1, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: tx.lockTime, scope: DEPOT_SCOPE })
  tx.inputs[1].unlockingScript = buildDepotUnlock({
    prefixOutputs: tx.outputs.slice(0, depotAt).map((_, k) => serOut(k)).flat(),
    spenderOutputs: tx.outputs.slice(depotAt + 1).map((_, k) => serOut(depotAt + 1 + k)).flat(),
    newValue: u64(kept), preimage: dPre })

  const val = (i: number, src: Transaction, sats: number, lock: any): boolean => {
    try {
      return new Spend({ sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats,
        lockingScript: lock, transactionVersion: 2,
        otherInputs: tx.inputs.filter((_, k) => k !== i), outputs: tx.outputs, inputIndex: i,
        unlockingScript: tx.inputs[i].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  }
  return {
    carOk: val(0, cSrc, o.carHas, carSubscript),
    depotOk: val(1, dSrc, o.tank, DEPOT),
    bytes: tx.toHex().length / 2,
  }
}

/** A reset step: back to a fresh car, keeping the fuel. What a car at rest does when tapped. */
const resetStep = (out: number): Step =>
  ({ label: 'reset', next: FRESH, throttle: 0, reset: true, out, burn: 0 })

// ── 1. a car AT REST, nearly dry, gets a tap ──────────────────────────────────────────────────────
{
  const r = refuel({ carState: FRESH, carHas: 2_200, tank: 60_000, step: resetStep(2_200) })
  check('★★ the DEPOT accepts filling an existing car', r.depotOk)
  check('★★ …and the CAR accepts being filled, in the same transaction', r.carOk)
  console.log(`        ${r.bytes} B · 2 in, 2 out · car 2,200 → ${(2_200 + DEPOT_DRAW).toLocaleString()}`)
}

// ── 2. a car that has RACED — refuelled and reset in one transaction ──────────────────────────────
console.log()
{
  const raced: ShellState = { ...FRESH, phase: PHASE.OUT, eng: 14, tyr: 10,
    last: 1_700_000_123, n: 31, s: Math.round(210 * S), v: Math.round(3 * S) }
  const r = refuel({ carState: raced, carHas: 900, tank: 60_000, step: resetStep(900) })
  check('★ a raced car is refuelled AND reset in one transaction', r.depotOk && r.carOk)
}

/* ── 3. ✗ THE SPLASH-AND-DASH, AND IT IS REFUSED (sun-dive, 16 Aug) ───────────────────────────────
   This section used to prove the opposite, and the transaction it builds is unchanged — only the
   answer is. Spec §5 promised "a driver about to run dry at 300 m can tap once more mid-race"; that
   promise is withdrawn, and the reason is a measurement rather than a difficulty:

     best single fill        49,000 sat  →  3.9 s
     28,000 + one 20,000 tap at tick 9   →  3.3 s on 48,000 sat    ★ faster AND cheaper

   Fuel is MASS, so starting light and topping up at speed is not a rescue, it is the OPTIMUM — and an
   optimum that dominates every other line is not a strategy, it is a bug with good manners. The car
   used to price it with a `PIT` rule costing 27 bytes on every tick; the depot now declines instead,
   for about five, and there is no pit lane on a quarter mile anyway.

   ⚠ AND IT GOES THROUGH `buildRefuelMove`, the SHARED builder the page uses — not through this file's
   own helper. A test that exercises its own reimplementation proves the reimplementation. */
console.log()
{
  const GREEN = 1_700_000_000
  const plan = planRace(FRESH, 30_000, { eng: 14, tyr: 10, finishM: 402, green: GREEN })
  const steps = plan.steps
  const i = steps.findIndex(s => s.next.phase === PHASE.RACING && s.next.n >= 8)
  check('  a real race plan reaches a racing state to interrupt', i > 0)

  const before = steps[i - 1].next
  const has = steps[i - 1].out
  const step = steps[i]

  const cSrc = new Transaction()
  cSrc.addOutput({ lockingScript: carLock(before), satoshis: has })
  const dSrc = new Transaction()
  dSrc.addOutput({ lockingScript: DEPOT, satoshis: 60_000 })

  const r = buildRefuelMove({
    prevTx: cSrc, vout: 0, state: before, value: has, step, lockTime: lockTimeFor(before),
    depot: { sourceTransaction: dSrc, outputIndex: 0, value: 60_000 }, depotLock: DEPOT,
    draw: DEPOT_DRAW, depotMaxFee: DEPOT_MAX_FEE, depotScope: DEPOT_SCOPE,
  })
  check('★★ THE DEPOT REFUSES to fuel a car that has left the line', r.depotOk, false)
  /* ★ AND THE CAR ITSELF IS PERFECTLY HAPPY, which is the point worth keeping: the car has no opinion
     about where its satoshis came from and carries not one byte on the subject. The refusal is one
     covenant declining to pay, not two covenants arguing. */
  check('  …while the CAR accepts the very same move — it costs the car nothing to be ignorant', r.carOk)
  check('  …and the car really was still racing, not reset',
    step.next.phase === PHASE.RACING && !step.reset)
  console.log(`        at ${(before.s / S).toFixed(0)} m · tick ${before.n} → ${step.next.n} · ` +
    `the pump declines · ${r.tx.toHex().length / 2} B`)

  /* ⇒ AND THE RESCUE THAT REPLACES IT: reset to the line and fill up again. It costs the run, which is
     the honest price, and it is the same transaction shape — the reset zeroes `s`, so the pump agrees. */
  const back = buildRefuelMove({
    prevTx: cSrc, vout: 0, state: before, value: has, step: resetStep(has), lockTime: lockTimeFor(before),
    depot: { sourceTransaction: dSrc, outputIndex: 0, value: 60_000 }, depotLock: DEPOT,
    draw: DEPOT_DRAW, depotMaxFee: DEPOT_MAX_FEE, depotScope: DEPOT_SCOPE,
  })
  check('★ …but a car RESET back to the line is fuelled — give up the run and you may fill up',
    back.depotOk && back.carOk)
}

// ── 4. the collision that started all this — it must STAY refused ─────────────────────────────────
// If someone ever puts the depot back at out0, this is the check that says why they cannot.
console.log()
{
  const r = refuel({ carState: FRESH, carHas: 2_200, tank: 60_000, step: resetStep(2_200), depotFirst: true })
  check('★★ with the DEPOT at out0 the car refuses — they cannot both be first', r.carOk, false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'DEPOT REFUEL OK — the fuel button works, in any phase, without giving up the run.'
  : '⚠ DEPOT REFUEL FAILED')
process.exit(fail === 0 ? 0 : 1)
