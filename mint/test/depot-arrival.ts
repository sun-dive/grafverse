// © 2026 sun-dive — Apache License 2.0.
// THE DEPOT · step 3c — WHAT LEAVES THE DEPOT MUST ARRIVE.
//
//   node --experimental-strip-types mint/test/depot-arrival.ts
//
//   out1 ≥ (V − out0) − MAX_FEE
//
// ★ THIS FILE EXISTS BECAUSE THE HOLE WAS MEASURED, NOT FEARED. Before this rule the covenant accepted
// exactly this transaction:
//
//     out0  the depot, keeping its legal minimum
//     out1  a car, holding ONE SATOSHI
//     out2  a stranger's address, holding the other 10,299
//
// A full draw, once per block, for the cost of a transaction. Not a faucet — a drain.
//
// ⚠ AND IT CANNOT BE ENFORCED AT THE PUMP. An attacker does not use the pump: they build the
// transaction by hand, and the covenant is the only thing standing there. A page can decide how many
// taps a driver is offered; it cannot decide what a stranger is allowed to sign.
//
// ⚠ The cost objection is real but does not apply here. The SHELL is spent ~50 times a race, so bytes
// there are expensive. The DEPOT is spent about five times — once per tap — so twenty bytes counted
// twice across five spends is roughly 20 satoshis a race. That is what the difference between a tank
// and a faucet costs.
import { Transaction, Spend, LockingScript, TransactionSignature, PrivateKey, P2PKH } from '@bsv/sdk'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK,
} from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const OWNER = Array.from({ length: 20 }, (_, i) => i + 1)
const CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: SHELL_MAX_FEE, public: true })
const LOCK = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })
const DRAIN = DEPOT_DRAW + DEPOT_MAX_FEE
const V = 500_000
const THIEF = PrivateKey.fromRandom().toAddress()

type Out = { lockingScript: LockingScript; satoshis: number }
const ser = (o: { satoshis?: number; lockingScript: LockingScript }): number[] =>
  serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())

/**
 * Spend the depot, keeping `keep`. `rest[0]` becomes OUT0 — where the car has to be — and anything
 * after it follows the depot.
 *
 * ⚠ The car moved from out1 to out0 when the depot learned to carry a prefix, so the slot a thief has
 * to be caught in moved with it. Every refusal below is still a refusal, and for the same reason.
 */
function spendWith(lock: LockingScript, keep: number, rest: Out[]): boolean {
  const [first, ...after] = rest
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: V })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  if (first) tx.addOutput(first)
  tx.addOutput({ lockingScript: lock, satoshis: keep })
  for (const o of after) tx.addOutput(o)
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: lock, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    prefixOutputs: first ? ser(first) : [],
    spenderOutputs: after.flatMap(ser),
    newValue: u64(keep), preimage: pre,
  })
  try {
    return new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}
const spend = (keep: number, rest: Out[]): boolean => spendWith(LOCK, keep, rest)
const car = (s: number) => ({ lockingScript: CAR, satoshis: s })
const thief = (s: number) => ({ lockingScript: new P2PKH().lock(THIEF), satoshis: s })

console.log('WHAT LEAVES THE DEPOT MUST ARRIVE\n')

// ── ★★ THE DRAIN, WHICH USED TO WORK ──────────────────────────────────────────────────────────────
check('★★ a full draw with ONE SATOSHI to the car and the rest to a stranger',
  spend(V - DRAIN, [car(1), thief(DRAIN - 201)]), false)
/* ⚠ DERIVED FROM MAX_FEE, NEVER A ROUND NUMBER. This read `thief(500)` against a car short by 700,
   which refused only because MAX_FEE happened to be 516 at the time. When MAX_FEE was re-measured for
   the refuel and rose to 837, a 500-satoshi skim became indistinguishable from a fee — and the check
   started failing while the rule it was testing had not changed at all. The honest question is "more
   than the fee allowance", so ask that. */
check('★ …skimming one satoshi more than the fee allowance is refused too',
  spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE - 1), thief(DEPOT_MAX_FEE + 1)]), false)
check('  …and skimming a single satoshi',
  spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE - 1), thief(1)]), false)

// ── AN HONEST DRAW STILL WORKS ────────────────────────────────────────────────────────────────────
// The rule has to let the ordinary case through, or it is not a rule but a wall.
check('★ an honest draw — everything arrives', spend(V - DRAIN, [car(DEPOT_DRAW)]))
check('  a partial tap arrives in full', spend(V - 2_000, [car(2_000)]))
check('  the miner may still take MAX_FEE and no more', spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE)]))
check('  …one satoshi beyond that is refused', spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE - 1)]), false)

// ── ★ THREE TAPS AND THE PUMP STOPS ───────────────────────────────────────────────────────────────
// Overfilling is already punished by the physics — fuel is mass — but the cap makes it a property of
// the system rather than a courtesy of the page.
//
// ⚠ A SINGLE SPEND CAN NEVER REACH THE CAP, because one spend may move only DRAW and the cap is ten of
// them. The cap bites during REFUELLING, where the car is an input as well and arrives already part
// full. Testing it therefore needs a depot whose DRAW is large enough for the cap to be the rule that
// refuses — otherwise the DRAW bound refuses first and the cap is never exercised at all.
//
// ★ That distinction is the whole reason this section exists separately: a test that passed here
// without it would have been reporting on the wrong rule.
{
  const BIG = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER, draw: 300_000, maxTank: DEPOT_MAX_TANK })
  const bigSpend = (keep: number, rest: Out[]): boolean => spendWith(BIG, keep, rest)
  console.log(`\n        MAX_TANK ${DEPOT_MAX_TANK.toLocaleString()} = ${DEPOT_MAX_TANK / DEPOT_DRAW} taps of ${DEPOT_DRAW.toLocaleString()}\n`)
  check('★ a car may be filled to the cap', bigSpend(V - DEPOT_MAX_TANK, [car(DEPOT_MAX_TANK)]))
  check('★ …and ONE SATOSHI past it is refused',
    bigSpend(V - DEPOT_MAX_TANK - 1, [car(DEPOT_MAX_TANK + 1)]), false)
  check('  the DRAW bound still refuses first at the real settings',
    spend(V - DEPOT_MAX_TANK, [car(DEPOT_MAX_TANK)]), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT ARRIVAL: FAIL — fuel can be skimmed; do not build on it'); process.exit(1) }
console.log('DEPOT ARRIVAL OK — a tank, not a faucet.')
