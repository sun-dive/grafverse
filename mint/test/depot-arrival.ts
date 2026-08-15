// © BSV Association — Open BSV License v6.
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
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const CAR = LockingScript.fromASM('OP_DUP OP_HASH160 ' + '11'.repeat(20) + ' OP_EQUALVERIFY OP_CHECKSIG OP_NOP')
const LOCK = buildDepotLock({ carScript: CAR.toBinary() })
const DRAIN = DEPOT_DRAW + DEPOT_MAX_FEE
const V = 500_000
const THIEF = PrivateKey.fromRandom().toAddress()

function spend(keep: number, rest: { lockingScript: LockingScript; satoshis: number }[]): boolean {
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: V })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: LOCK, satoshis: keep })
  for (const o of rest) tx.addOutput(o)
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(keep), preimage: pre,
  })
  try {
    return new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: LOCK,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}
const car = (s: number) => ({ lockingScript: CAR, satoshis: s })
const thief = (s: number) => ({ lockingScript: new P2PKH().lock(THIEF), satoshis: s })

console.log('WHAT LEAVES THE DEPOT MUST ARRIVE\n')

// ── ★★ THE DRAIN, WHICH USED TO WORK ──────────────────────────────────────────────────────────────
check('★★ a full draw with ONE SATOSHI to the car and the rest to a stranger',
  spend(V - DRAIN, [car(1), thief(DRAIN - 201)]), false)
check('★ …skimming just 500 of it is refused too',
  spend(V - DRAIN, [car(DRAIN - 700), thief(500)]), false)
check('  …and skimming a single satoshi',
  spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE - 1), thief(1)]), false)

// ── AN HONEST DRAW STILL WORKS ────────────────────────────────────────────────────────────────────
// The rule has to let the ordinary case through, or it is not a rule but a wall.
check('★ an honest draw — everything arrives', spend(V - DRAIN, [car(DEPOT_DRAW)]))
check('  a partial tap arrives in full', spend(V - 2_000, [car(2_000)]))
check('  the miner may still take MAX_FEE and no more', spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE)]))
check('  …one satoshi beyond that is refused', spend(V - DRAIN, [car(DRAIN - DEPOT_MAX_FEE - 1)]), false)

// ── ★ TEN TAPS AND THE PUMP STOPS ─────────────────────────────────────────────────────────────────
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
  const BIG = buildDepotLock({ carScript: CAR.toBinary(), draw: 300_000, maxTank: DEPOT_MAX_TANK })
  const bigSpend = (keep: number, rest: { lockingScript: LockingScript; satoshis: number }[]): boolean => {
    const src = new Transaction(); src.addOutput({ lockingScript: BIG, satoshis: V })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: BIG, satoshis: keep })
    for (const o of rest) tx.addOutput(o)
    tx.lockTime = 0
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
      otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
      subscript: BIG, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
    })
    tx.inputs[0].unlockingScript = buildDepotUnlock({
      spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
      newValue: u64(keep), preimage: pre,
    })
    try {
      return new Spend({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: BIG,
        transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
        unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  }
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
