// © 2026 sun-dive — Apache License 2.0.
// THE DEPOT · step 2 — THE FRAME, through the same interpreter a node runs.
//
//   node --experimental-strip-types mint/test/depot-frame.ts
//
// The depot can rebuild itself and refuses everything else. No value rule yet, no car check, no burn —
// those are step 3, each with its own test. Mixing them in here is how a frame comes out green while
// proving nothing.
//
// ★ AND THE FRAME MUST PROVE IT REJECTS. With a self-replicating covenant it is trivially easy to
// write a test that passes because the comparison at the end is comparing nothing. So every acceptance
// below is paired with the same transaction bent by one byte, which must FAIL. If those refusals ever
// go green, this file is decoration.
import { Transaction, Spend, LockingScript, TransactionSignature, PrivateKey, P2PKH, Utils, Hash } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE } from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

/* A real public car, because the depot now recognises a car by its SHAPE and refuses to build against
   a script that has not got one. The frame is still about SELF-REBUILD: every spend below leaves the
   balance alone, so step 3b's car rule never engages and cannot mask a frame bug by refusing for the
   wrong reason. */
const OWNER = Array.from({ length: 20 }, (_, i) => i + 1)
const CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: SHELL_MAX_FEE, public: true })
const LOCK = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })
const V = 500_000
const SOMEONE = PrivateKey.fromRandom().toAddress()

/**
 * Spend a depot into `outputs`, claiming out0 holds `claimValue`.
 * Everything a caller can get wrong is a parameter, so each can be got wrong deliberately.
 */
function spend(opts: {
  outputs: { lockingScript: LockingScript; satoshis: number }[]
  claimValue?: number
  sourceValue?: number
}): { ok: boolean; why: string; bytes: number } {
  const src = new Transaction()
  src.addOutput({ lockingScript: LOCK, satoshis: opts.sourceValue ?? V })

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  for (const o of opts.outputs) tx.addOutput(o)
  tx.lockTime = 0

  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: opts.sourceValue ?? V,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    // everything AFTER out0 — out0 is rebuilt by the covenant from its own scriptCode
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(opts.claimValue ?? opts.outputs[0].satoshis),
    preimage: pre,
  })
  try {
    const ok = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: opts.sourceValue ?? V,
      lockingScript: LOCK, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate()
    return { ok: ok === true, why: '', bytes: tx.toHex().length / 2 }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0], bytes: tx.toHex().length / 2 } }
}

console.log('THE DEPOT FRAME — it rebuilds itself, and nothing else survives\n')
console.log(`        depot lock: ${LOCK.toBinary().length} bytes · stateless, so one script forever`)
// the constant a car will one day name to mean "a depot" — printed so a change to the script is visible
console.log(`        script hash: ${Utils.toHex(Hash.sha256(LOCK.toBinary())).slice(0, 32)}…`)

// ── ★ IT REBUILDS ITSELF ──────────────────────────────────────────────────────────────────────────
{
  const r = spend({ outputs: [{ lockingScript: LOCK, satoshis: V }] })
  check('★ a depot may be spent into a depot', r.ok)
  if (!r.ok) console.log('   ↳', r.why)
  console.log(`        ${r.bytes} bytes`)
}

// ── AND NOTHING ELSE DOES ─────────────────────────────────────────────────────────────────────────
// Each of these is the transaction above, bent in exactly one way.
{
  const notADepot = new P2PKH().lock(SOMEONE)
  check('★ paying an ordinary address instead is REFUSED',
    spend({ outputs: [{ lockingScript: notADepot, satoshis: V }] }).ok, false)

  // one byte different — the nastiest case, because everything about it still looks like a depot
  const bent = LockingScript.fromBinary([...LOCK.toBinary()])
  const bytes = bent.toBinary(); bytes[bytes.length - 1] ^= 0x01
  check('★ a script differing by ONE BYTE is refused',
    spend({ outputs: [{ lockingScript: LockingScript.fromBinary(bytes), satoshis: V }] }).ok, false)

  check('★ claiming a value out0 does not hold is refused',
    spend({ outputs: [{ lockingScript: LOCK, satoshis: V }], claimValue: V - 500 }).ok, false)
}

// ── ⚠ EVERY OTHER OUTPUT IS BOUND TOO ─────────────────────────────────────────────────────────────
// The property step 3 will stand on: without it, a third output could take whatever the depot did not
// keep, and "out0 is me" would be no protection at all.
{
  const withMark = spend({ outputs: [
    { lockingScript: LOCK, satoshis: V },
    { lockingScript: LockingScript.fromASM('OP_FALSE OP_RETURN ' + Utils.toHex(Utils.toArray('a mark', 'utf8'))), satoshis: 0 },
  ] })
  check('a declared second output is fine — marks ride along', withMark.ok)
  if (!withMark.ok) console.log('   ↳', withMark.why)

  // the same transaction, but the covenant is told about only the first output
  const sneak = (() => {
    const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: V })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: LOCK, satoshis: V - 100_500 })
    tx.addOutput({ lockingScript: new P2PKH().lock(SOMEONE), satoshis: 100_000 })   // the theft
    tx.lockTime = 0
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
      otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
      subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
    })
    tx.inputs[0].unlockingScript = buildDepotUnlock({
      spenderOutputs: [],                                   // ← lies: says there are no other outputs
      newValue: u64(V - 100_500), preimage: pre,
    })
    try {
      return new Spend({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: LOCK,
        transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
        unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  })()
  check('★★ an UNDECLARED output cannot be smuggled in', sneak, false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT FRAME: FAIL — the plumbing is wrong; do not build on it'); process.exit(1) }
console.log('DEPOT FRAME OK — it rebuilds itself exactly, and every output is bound.')
