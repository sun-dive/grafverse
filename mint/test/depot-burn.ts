// © BSV Association — Open BSV License v6.
// THE DEPOT · the OWNER BURN — the upgrade path, and the only branch that pays anybody.
//
//   node --experimental-strip-types mint/test/depot-burn.ts
//
// A covenant cannot be amended. Replacing a design means burning what exists and minting its
// successor — so a depot with no owner would strand its entire balance in v1 the day a better one
// existed. Permanence is right when it IS the demonstration; here the demonstration is the racing, and
// a depot is equipment. Equipment should be replaceable.
//
// ★ THE REFUSALS COME FIRST, AND THEY MATTER MORE THAN THE PERMISSION. Every other property of this
// covenant — the value floor, the car rule, the arrival bound — holds just as well with a burn branch
// standing wide open, and a wide-open burn branch is the whole tank for whoever finds it. So "nobody
// but the owner" is proven before "the owner can".
//
// ⚠ AND THE BRANCH ENFORCES NOTHING, deliberately. The owner's SIGHASH_ALL signature already commits
// to every output: by signing, they have said where the money goes. There is nothing left to check and
// no output to re-create. It is the rule PharLap's editions already use.
import { Transaction, Spend, LockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE } from '../src/depot.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const OWNER_KEY = PrivateKey.fromRandom()
const STRANGER_KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(OWNER_KEY.toPublicKey().encode(true) as number[])
const CAR = LockingScript.fromASM('OP_DUP OP_HASH160 ' + '11'.repeat(20) + ' OP_EQUALVERIFY OP_CHECKSIG OP_NOP')
const LOCK = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })
const V = 500_000

/**
 * Try to burn a depot, sweeping it to `to`. There is NO depot output and no car — that is the point,
 * so every rule the covenant normally applies is deliberately violated at once.
 */
async function burn(opts: {
  signer?: PrivateKey; to?: PrivateKey; flag?: boolean; withSig?: boolean; outputs?: number
} = {}): Promise<boolean> {
  const signer = opts.signer ?? OWNER_KEY
  const to = opts.to ?? OWNER_KEY
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: V })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  for (let i = 0; i < (opts.outputs ?? 1); i++) {
    tx.addOutput({ lockingScript: new P2PKH().lock(to.toAddress()), satoshis: Math.floor((V - 400) / (opts.outputs ?? 1)) })
  }
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  const chunks = (await new P2PKH().unlock(signer).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(0), preimage: pre,
    burn: opts.flag ?? true,
    sig: (opts.withSig ?? true) ? (chunks[0].data ?? []) : [],
    pubKey: (opts.withSig ?? true) ? (chunks[1].data ?? []) : [],
  })
  try {
    return new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: LOCK,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}

console.log('THE OWNER BURN — nobody but the owner, and then anything at all\n')

// ── ★ THE REFUSALS ────────────────────────────────────────────────────────────────────────────────
check('★★ a STRANGER cannot burn the depot', await burn({ signer: STRANGER_KEY, to: STRANGER_KEY }), false)
check('★ …not even to sweep it to the real owner', await burn({ signer: STRANGER_KEY }), false)
check('★ the flag alone, with NO signature, cannot burn', await burn({ withSig: false }), false)
check('  and without the flag, the ordinary rules apply — no depot output, so refused',
  await burn({ flag: false }), false)

// ── ★ AND THEN THE OWNER, WHO IS BOUND BY NOTHING ─────────────────────────────────────────────────
// Every rule this covenant normally applies is violated at once here: no depot output, no car, the
// whole balance leaving. That is what "enforces nothing" means, and it is only safe because the
// signature above is the gate.
check('★ the OWNER may burn it', await burn())
check('  …sweeping it anywhere they like', await burn({ to: PrivateKey.fromRandom() }))
check('  …across as many outputs as they like', await burn({ outputs: 3 }))

// ── the ordinary path is untouched by any of this ─────────────────────────────────────────────────
// The three burn pushes sit DEEPEST so no existing depth moved, and the ordinary arm removes them
// before it finishes so a spend still ends with a clean stack.
{
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: V })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: LOCK, satoshis: V - DEPOT_DRAW - DEPOT_MAX_FEE })
  tx.addOutput({ lockingScript: CAR, satoshis: DEPOT_DRAW })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(V - DEPOT_DRAW - DEPOT_MAX_FEE), preimage: pre,   // burn omitted entirely
  })
  let ok = false
  try {
    ok = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: LOCK,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { /* reported below */ }
  check('★ an ordinary draw still works, and ends with a clean stack', ok)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT BURN: FAIL — do not mint'); process.exit(1) }
console.log('DEPOT BURN OK — the depot is equipment, and its owner can retire it.')
