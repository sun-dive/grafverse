// © BSV Association — Open BSV License v6.
// THE DEPOT · step 3b — FUEL ONLY EVER GOES INTO A CAR.
//
//   node --experimental-strip-types mint/test/depot-car.ts
//
// The rule that closes the loop:
//
//   ★ whatever leaves the depot must go to a car. If nothing leaves, nothing is required.
//
// The second half of that sentence matters as much as the first. Requiring a car unconditionally would
// force a plain DONATION to mint one, which is absurd — so the check is gated on fuel actually having
// left, and a top-up stays exactly what step 3a made it.
//
// ★ AND THE CAR IS ONE HASH, which is what step 1's reset was arranged to make possible. An output
// serializes as value(8) ‖ varint(len) ‖ script, so everything after the value is a fixed blob for a
// script of known length — and a public car AT REST is of known length and known content, whether it
// was minted a moment ago or has run forty races. The depot never parses an output. It splits at two
// fixed offsets and compares one hash.
//
// ⚠ The car here is a STAND-IN, deliberately. The depot does not care what a car is — only that out1
// matches the constant it was built with. Testing that with an arbitrary script proves the rule
// without waiting on the public shell variant, and the real hash drops in unchanged when it exists.
import { Transaction, Spend, LockingScript, TransactionSignature, PrivateKey, P2PKH, Utils } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE } from '../src/depot.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

/** A stand-in for the public car: any script of known bytes will prove the rule. */
const CAR = LockingScript.fromASM('OP_DUP OP_HASH160 ' + '11'.repeat(20) + ' OP_EQUALVERIFY OP_CHECKSIG OP_NOP')
const LOCK = buildDepotLock({ carScript: CAR.toBinary() })
const DRAIN = DEPOT_DRAW + DEPOT_MAX_FEE
const V = 500_000
const SOMEONE = PrivateKey.fromRandom().toAddress()

function spend(from: number, keep: number, rest: { lockingScript: LockingScript; satoshis: number }[]): boolean {
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: from })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: LOCK, satoshis: keep })
  for (const o of rest) tx.addOutput(o)
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

const car = (sats: number) => ({ lockingScript: CAR, satoshis: sats })
const notCar = (sats: number) => ({ lockingScript: new P2PKH().lock(SOMEONE), satoshis: sats })

console.log('FUEL ONLY EVER GOES INTO A CAR\n')
console.log(`        car: ${CAR.toBinary().length} bytes · depot: ${LOCK.toBinary().length} bytes\n`)

// ── ★ THE LOOP CLOSES ─────────────────────────────────────────────────────────────────────────────
check('★ a draw into a car is allowed', spend(V, V - DRAIN, [car(DEPOT_DRAW)]))
check('★★ …into an ORDINARY ADDRESS is refused — this is the whole rule',
  spend(V, V - DRAIN, [notCar(DEPOT_DRAW)]), false)
check('  …into nothing at all is refused', spend(V, V - DRAIN, []), false)

// one byte different: everything still looks like a car, and it must still fail
{
  const bent = CAR.toBinary(); bent[bent.length - 1] ^= 0x01
  check('★ a car differing by ONE BYTE is refused',
    spend(V, V - DRAIN, [{ lockingScript: LockingScript.fromBinary(bent), satoshis: DEPOT_DRAW }]), false)
}

// ── AND THE GATE: NOTHING LEFT, NOTHING REQUIRED ──────────────────────────────────────────────────
// Without this a donor would have to mint a car to make a donation.
check('★★ a pure TOP-UP needs no car', spend(V, V + 250_000, []))
check('  taking nothing needs no car', spend(V, V, []))
check('  …but taking ONE satoshi does', spend(V, V - 1, []), false)
check('  one satoshi into a car is fine', spend(V, V - 1, [car(1)]))

// ── the car must come FIRST, where the covenant looks ─────────────────────────────────────────────
// out1 is the first entry of spenderOutputs. A car buried behind something else is not out1.
check('a car hidden behind another output is refused',
  spend(V, V - DRAIN, [notCar(100), car(DEPOT_DRAW - 100)]), false)
check('  …and in front, with a mark behind it, is fine',
  spend(V, V - DRAIN, [car(DEPOT_DRAW),
    { lockingScript: LockingScript.fromASM('OP_FALSE OP_RETURN ' + Utils.toHex(Utils.toArray('filled the tank', 'utf8'))), satoshis: 0 }]))

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT CAR: FAIL — fuel can escape; do not build on it'); process.exit(1) }
console.log('DEPOT CAR OK — what leaves the tank goes into a car, and nothing else does.')
