// © 2026 sun-dive — Apache License 2.0.
// ★ PUTTING SATS IN — the button the page needs.
//
//   node --experimental-strip-types mint/test/depot-topup.ts
//
// A top-up spends the depot and hands back MORE than it took. The covenant's value rule is a FLOOR,
// so nothing forbids it — but the car rule is gated on "did fuel leave", and in Script ANY non-zero
// is true, including a negative. So this asks the interpreter rather than the comments.
import { Transaction, Spend, PrivateKey, P2PKH, TransactionSignature, Hash } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE } from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++ }
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: SHELL_MAX_FEE, public: true })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })

console.log('\nTOPPING UP THE TANK\n')

/** A contributor pays IN: input 0 the depot, input 1 their coin, out0 the depot holding more. */
async function topUp(o: { tank: number; add: number; change?: number }): Promise<{ ok: boolean; bytes: number }> {
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: o.tank })
  const fSrc = new Transaction()
  fSrc.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: o.add + (o.change ?? 0) + 300 })

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: fSrc, sourceOutputIndex: 0,
                unlockingScriptTemplate: new P2PKH().unlock(KEY), sequence: 0xffffffff })
  tx.addOutput({ lockingScript: DEPOT, satoshis: o.tank + o.add })      // out0 — the tank, FULLER
  if (o.change) tx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: o.change })
  tx.lockTime = 0

  const pre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, transactionVersion: 2,
    otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(o.tank + o.add), preimage: pre })
  await tx.sign()                                    // ⚠ signs ONLY input 1 — the contributor's own coin
  try {
    const ok = new Spend({
      sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, lockingScript: DEPOT,
      transactionVersion: 2, otherInputs: [tx.inputs[1]], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0,
    }).validate() === true
    return { ok, bytes: tx.toHex().length / 2 }
  } catch { return { ok: false, bytes: tx.toHex().length / 2 } }
}

{
  const r = await topUp({ tank: 984, add: 50_000 })
  check('★★ a contributor may pay INTO the tank', r.ok)
  console.log(`        ${r.bytes} B · 984 → ${(984 + 50_000).toLocaleString()} sat`)
}
{
  const r = await topUp({ tank: 984, add: 50_000, change: 4_000 })
  check('★ …and may take change back in the same transaction', r.ok)
  console.log('        ⇒ out1 is the contributor\'s change, NOT a car — the car rule is gated on fuel LEAVING')
}
{
  const r = await topUp({ tank: 11_500, add: 1 })
  check('  a single satoshi is a legal top-up', r.ok)
}
/* ⚠⚠ THE CONTROL, AND IT IS THE POINT OF THE FILE. Every check above passes just as well against a
   depot that agrees to anything, so the opposite must be demanded: fuel LEAVING with no car to
   receive it. The first version of this test tried to express it as a negative top-up and crashed
   building the transaction — proving nothing while looking like a fourth passing case. */
{
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: 60_000 })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: DEPOT, satoshis: 60_000 - DEPOT_DRAW })            // took a tap…
  tx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: DEPOT_DRAW - 400 }) // …to a POCKET
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 60_000, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(60_000 - DEPOT_DRAW), preimage: pre })
  let ok = false
  try { ok = new Spend({ sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 60_000,
    lockingScript: DEPOT, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
    unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0 }).validate() === true
  } catch {}
  check('⚠⚠ …but a tap into somebody\'s POCKET is still refused', ok, false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0 ? 'DEPOT TOPUP OK — the tank is unbounded on the way in.' : '⚠ DEPOT TOPUP FAILED')
process.exit(fail === 0 ? 0 : 1)
