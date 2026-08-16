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
// ── ★★ THE CAR IS A SHAPE, NOT A SNAPSHOT ────────────────────────────────────────────────────────
// This rule used to compare ONE HASH of the whole car script, which recognises a car AT REST and
// nothing else. It made refuelling and RESETTING the same act: a driver at 300 m could only take fuel
// by abandoning the run. The depot now walks the script instead — constant head, twelve pinned push
// opcodes, constant tail — so the thirteen fields' DATA may be anything and a car is a car in any
// phase. Both halves are tested below, because each is a way of getting it wrong:
//
//   a car MID-RACE          must be ACCEPTED   ← the splash-and-dash the spec promises
//   a SPLICED script        must be REFUSED    ← head and tail alike, opcodes tampered with
//
// ⚠ And the car sits at OUTPUT 0 now, not out1. Its own covenant rebuilds itself there and cannot be
// argued with, so the depot yields the slot and carries a PREFIX instead.
import { Transaction, Spend, LockingScript, TransactionSignature, PrivateKey, P2PKH, Utils } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE } from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE, PHASE, S, type ShellState } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const OWNER = Array.from({ length: 20 }, (_, i) => i + 1)
const FRESH = freshPublicShell(OWNER)
const carLock = (st: ShellState): LockingScript =>
  buildShellLock({ state: st, maxFee: SHELL_MAX_FEE, public: true })
const CAR = carLock(FRESH)
const LOCK = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })
const DRAIN = DEPOT_DRAW + DEPOT_MAX_FEE
const V = 500_000
const SOMEONE = PrivateKey.fromRandom().toAddress()

type Out = { lockingScript: LockingScript; satoshis: number }

/**
 * Spend a depot into [ ...prefix, depot(keep), ...rest ].
 *
 * `prefix` is what sits BEFORE the depot — where a car has to be, because the car's own covenant will
 * only rebuild itself at out0. Everything a caller can get wrong is a parameter.
 */
function spend(from: number, keep: number, prefix: Out[], rest: Out[] = []): boolean {
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: from })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  for (const o of prefix) tx.addOutput(o)
  tx.addOutput({ lockingScript: LOCK, satoshis: keep })
  for (const o of rest) tx.addOutput(o)
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: from, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  const ser = (o: Out): number[] => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    prefixOutputs: prefix.flatMap(ser),
    spenderOutputs: rest.flatMap(ser),
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

const car = (sats: number): Out => ({ lockingScript: CAR, satoshis: sats })
const notCar = (sats: number): Out => ({ lockingScript: new P2PKH().lock(SOMEONE), satoshis: sats })
const mark = (t: string): Out =>
  ({ lockingScript: LockingScript.fromASM('OP_FALSE OP_RETURN ' + Utils.toHex(Utils.toArray(t, 'utf8'))), satoshis: 0 })

console.log('FUEL ONLY EVER GOES INTO A CAR\n')
console.log(`        car: ${CAR.toBinary().length} bytes · depot: ${LOCK.toBinary().length} bytes\n`)

// ── ★ THE LOOP CLOSES ─────────────────────────────────────────────────────────────────────────────
check('★ a draw into a car is allowed', spend(V, V - DRAIN, [car(DEPOT_DRAW)]))
check('★★ …into an ORDINARY ADDRESS is refused — this is the whole rule',
  spend(V, V - DRAIN, [notCar(DEPOT_DRAW)]), false)
check('  …into nothing at all is refused', spend(V, V - DRAIN, []), false)

// ── ★★ ANY PHASE — the rule this rewrite exists for ───────────────────────────────────────────────
console.log()
{
  const raced: ShellState = { ...FRESH, phase: PHASE.RACING, eng: 14, tyr: 10,
    last: 1_700_000_123, n: 24, s: Math.round(300 * S), v: Math.round(4 * S) }
  const midRace: Out = { lockingScript: carLock(raced), satoshis: DEPOT_DRAW }
  check('★★ a car MID-RACE is a car — the splash-and-dash', spend(V, V - DRAIN, [midRace]))
  check('  …and it is a DIFFERENT script from a car at rest',
    carLock(raced).toHex() !== CAR.toHex())

  const done: ShellState = { ...FRESH, phase: PHASE.DONE, n: 45, s: Math.round(402 * S) }
  check('  a car that has FINISHED is still a car',
    spend(V, V - DRAIN, [{ lockingScript: carLock(done), satoshis: DEPOT_DRAW }]))
}

// ── ★★ AND WHAT MUST STILL BE REFUSED ─────────────────────────────────────────────────────────────
// The state DATA is free, so the danger is a script that keeps the ends and rewrites the middle.
console.log()
{
  const tailBent = CAR.toBinary(); tailBent[tailBent.length - 1] ^= 0x01
  check('★ a car whose TAIL differs by one byte is refused',
    spend(V, V - DRAIN, [{ lockingScript: LockingScript.fromBinary(tailBent), satoshis: DEPOT_DRAW }]), false)

  const headBent = CAR.toBinary(); headBent[1] ^= 0x01
  check('★ a car whose HEAD differs by one byte is refused',
    spend(V, V - DRAIN, [{ lockingScript: LockingScript.fromBinary(headBent), satoshis: DEPOT_DRAW }]), false)

  /* ★★ THE SPLICE. Same length, same head, same tail — but `driver`'s push opcode replaced by OP_IF,
     which is what an attacker needs to make the skipped bytes EXECUTABLE and swallow the covenant's
     own verifications. Pinning the twelve opcodes is the only thing standing here. */
  const spliced = CAR.toBinary()
  spliced[7] = 0x00          // OP_0, in the phase field's data
  spliced[8] = 0x63          // OP_IF, where driver's push opcode belongs
  check('★★ a SPLICED script — same head, same tail, executable middle — is refused',
    spend(V, V - DRAIN, [{ lockingScript: LockingScript.fromBinary(spliced), satoshis: DEPOT_DRAW }]), false)

  const short = CAR.toBinary().slice(0, CAR.toBinary().length - 1)
  check('  …and a TRUNCATED car is refused', spend(V, V - DRAIN,
    [{ lockingScript: LockingScript.fromBinary(short), satoshis: DEPOT_DRAW }]), false)
}

// ── AND THE GATE: NOTHING LEFT, NOTHING REQUIRED ──────────────────────────────────────────────────
// Without this a donor would have to mint a car to make a donation.
console.log()
check('★★ a pure TOP-UP needs no car', spend(V, V + 250_000, []))
check('  taking nothing needs no car', spend(V, V, []))
check('  …but taking ONE satoshi does', spend(V, V - 1, []), false)
check('  one satoshi into a car is fine', spend(V, V - 1, [car(1)]))

// ── the car must be OUT0, where its own covenant needs it ─────────────────────────────────────────
console.log()
check('a car behind another output is refused',
  spend(V, V - DRAIN, [notCar(100), car(DEPOT_DRAW - 100)]), false)
check('  …and a car in the SUFFIX is refused — that is the old slot',
  spend(V, V - DRAIN, [], [car(DEPOT_DRAW)]), false)
check('  …first, with a mark behind the depot, is fine',
  spend(V, V - DRAIN, [car(DEPOT_DRAW)], [mark('filled the tank')]))

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT CAR: FAIL — fuel can escape; do not build on it'); process.exit(1) }
console.log('DEPOT CAR OK — what leaves the tank goes into a car, in any phase, and nothing else does.')
