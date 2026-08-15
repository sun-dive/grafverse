// © BSV Association — Open BSV License v6.
// THE DEPOT · step 3a — THE VALUE FLOOR.
//
//   node --experimental-strip-types mint/test/depot-value.ts
//
//   out0 ≥ V − (DRAW + MAX_FEE)
//
// A floor, deliberately, and not an equality. Three things fall out of that one choice:
//
//   · a spend may take up to one DRAW and no more, so the tank empties at a bounded rate
//   · a spend may take LESS, or nothing at all
//   · ★ a spend may hand back MORE — which is what makes a top-up free. The battery's entire funding
//     mechanism is this comparison, and the depot inherits it without a line of new code.
//
// ⚠ And the covenant is never TOLD its balance. It reads the value out of the preimage of the very
// transaction it is being asked to authorise, 52 bytes from the end, which is the only figure it has
// any reason to trust.
import { Transaction, Spend, LockingScript, TransactionSignature } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE } from '../src/depot.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

/* ⚠ Fuel that leaves must go into a car (step 3b), so the drawn amount goes to one here. This file is
   about HOW MUCH may leave; where it goes is depot-car's business. */
const CAR = LockingScript.fromASM('OP_DUP OP_HASH160 ' + '11'.repeat(20) + ' OP_EQUALVERIFY OP_CHECKSIG OP_NOP')
const LOCK = buildDepotLock({ carScript: CAR.toBinary() })
const DRAIN = DEPOT_DRAW + DEPOT_MAX_FEE
const V = 500_000

/** Spend a depot holding `from`, leaving `keep` in the successor. Extra outputs take the difference. */
function spend(from: number, keep: number, intoCar = false): boolean {
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: from })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: LOCK, satoshis: keep })
  if (intoCar && from > keep) tx.addOutput({ lockingScript: CAR, satoshis: from - keep })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: from, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(keep), preimage: pre,
  })
  try {
    return new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: from, lockingScript: LOCK,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}

console.log('THE VALUE FLOOR — a tank that empties at a bounded rate, and fills freely\n')
console.log(`        DRAW ${DEPOT_DRAW.toLocaleString()} + MAX_FEE ${DEPOT_MAX_FEE} = ${DRAIN.toLocaleString()} sat per spend\n`)

// ── ★ THE BOUND, AT ITS EXACT EDGE ────────────────────────────────────────────────────────────────
// One satoshi either side of the limit, because a rule tested only in the middle of its range is a
// rule whose edge nobody has looked at.
check('★ a spend may take exactly one DRAW', spend(V, V - DRAIN, true))
check('★ …and ONE SATOSHI more is refused', spend(V, V - DRAIN - 1, true), false)
check('  taking less is fine', spend(V, V - 1_000, true))
check('  taking nothing at all is fine', spend(V, V))

// ── ★ A FLOOR, NOT AN EQUALITY — WHICH IS WHAT MAKES A TOP-UP FREE ────────────────────────────────
// No rule permits this; it is permitted because nothing forbids it. That is the battery's funding
// mechanism, inherited for nothing.
check('★★ handing back MORE than was taken is allowed — this is a top-up', spend(V, V + 250_000))
check('  a very large donation is equally fine', spend(V, V + 10_000_000))

// ── AND THE FLOOR SCALES WITH WHAT THE TANK ACTUALLY HOLDS ────────────────────────────────────────
// The covenant reads its own value from the preimage, so the limit follows the balance rather than
// any figure the spender supplies.
check('a nearly empty tank may still be drawn down', spend(DRAIN + 100, 100, true))
check('  …but not past its own bottom', spend(DRAIN + 100, 99, true), false)
check('a tank smaller than one draw may be emptied to nothing', spend(1_000, 0, true))

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT VALUE: FAIL — do not build on it'); process.exit(1) }
console.log('DEPOT VALUE OK — bounded on the way out, unbounded on the way in.')
