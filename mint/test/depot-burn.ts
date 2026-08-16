// © BSV Association — Open BSV License v6.
// THE DEPOT · the OWNER BURN — clearing a husk, and nothing more.
//
//   node --experimental-strip-types mint/test/depot-burn.ts
//
// A covenant cannot be amended, so replacing a design means burning what exists and minting its
// successor. A depot is equipment, not a monument, and equipment should be replaceable.
//
// ★★ BUT ONLY WHEN THE TANK IS EMPTY — below one DRAW, so it can no longer fill a car even once. That
// single condition deletes the trust ask rather than shrinking it: a donor is NOT trusting the owner
// not to sweep the depot, because the owner cannot. The most anyone can ever take is one satoshi under
// a DRAW.
//
// ⇒ The upgrade path survives because it never needed the balance to MOVE. Deploy the successor
// alongside, point the page at it, let the old one drain through actual racing, then clear the husk.
//
// ⚠ THE COST, STATED: no rescue hatch. If the car path has a bug, a funded depot's balance can only
// leave through cars and no owner override exists. Do not put much in the tank until it is proven.
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
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_BURN_BELOW } from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
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
const CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: SHELL_MAX_FEE, public: true })
const LOCK = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })
/* ⚠ A BURN IS ONLY LEGAL ON AN EMPTY TANK — less than one DRAW, so the depot can no longer fill a
   car even once. These cases therefore run on a husk; the full-tank refusals are asserted below. */
const V = DEPOT_BURN_BELOW - 1
const FULL = 500_000

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

console.log('THE OWNER BURN — only a husk, and only its owner\n')
console.log(`        a tank may be burnt below ${DEPOT_BURN_BELOW.toLocaleString()} sat — one move's fuel plus its delivery\n`)

// ── ★★ NOT EVEN THE OWNER MAY BURN A FUNDED TANK ──────────────────────────────────────────────────
// The rule that deletes the trust ask rather than shrinking it. Without it a donor is trusting the
// owner not to sweep the depot; with it, the most an owner can ever take is one satoshi under a DRAW.
{
  const bigLock = LOCK
  const burnAt = async (value: number): Promise<boolean> => {
    const src = new Transaction(); src.addOutput({ lockingScript: bigLock, satoshis: value })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: new P2PKH().lock(OWNER_KEY.toAddress()), satoshis: Math.max(1, value - 400) })
    tx.lockTime = 0
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, transactionVersion: 2,
      otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
      subscript: bigLock, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
    })
    const ch = (await new P2PKH().unlock(OWNER_KEY).sign(tx, 0)).chunks
    tx.inputs[0].unlockingScript = buildDepotUnlock({
      spenderOutputs: tx.outputs.flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
      newValue: u64(0), preimage: pre, burn: true, sig: ch[0].data ?? [], pubKey: ch[1].data ?? [],
    })
    try {
      return new Spend({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, lockingScript: bigLock,
        transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
        unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  }
  check('★★ the OWNER may NOT burn a funded tank', await burnAt(FULL), false)
  check('★★ …nor one that can still fund a short run — EMPTY FOR THE RACE IS NOT EMPTY',
    await burnAt(DEPOT_DRAW - 1), false)
  check('★ …nor one holding exactly the functional floor', await burnAt(DEPOT_BURN_BELOW), false)
  check('★ …but may clear a husk one satoshi under it', await burnAt(DEPOT_BURN_BELOW - 1))
  check('  and a husk of one satoshi', await burnAt(1))
}


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
  const src = new Transaction(); src.addOutput({ lockingScript: LOCK, satoshis: FULL })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: CAR, satoshis: DEPOT_DRAW })          // out0 — the car's slot
  tx.addOutput({ lockingScript: LOCK, satoshis: FULL - DEPOT_DRAW - DEPOT_MAX_FEE })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: FULL, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: LOCK, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    prefixOutputs: serializeOutput(tx.outputs[0].satoshis ?? 0, tx.outputs[0].lockingScript.toBinary()),
    spenderOutputs: [],
    newValue: u64(FULL - DEPOT_DRAW - DEPOT_MAX_FEE), preimage: pre,   // burn omitted entirely
  })
  let ok = false
  try {
    ok = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: FULL, lockingScript: LOCK,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { /* reported below */ }
  check('★ an ordinary draw still works, and ends with a clean stack', ok)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT BURN: FAIL — do not mint'); process.exit(1) }
console.log('DEPOT BURN OK — the depot is equipment, and its owner can retire it.')
