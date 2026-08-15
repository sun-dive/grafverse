// © BSV Association — Open BSV License v6.
// THE CONTRIBUTE BUTTON'S BUILDER — the page assembles it, the contributor signs one blank.
import { Transaction, Spend, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import { buildDepotTopUpTx, TOPUP_FEE_PAD } from '../src/depotTx.ts'
import { buildDepotLock, DEPOT_SCOPE } from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE, SHELL_FEE_PER_KB } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++ }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: SHELL_MAX_FEE, public: true })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })

console.log('\nTHE CONTRIBUTE BUTTON\n')

const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: 984 })
const fSrc = new Transaction(); fSrc.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: 60_000 })

const tx = buildDepotTopUpTx({
  depot: { sourceTransaction: dSrc, outputIndex: 0, value: 984 },
  carScript: CAR.toBinary(), owner: OWNER, addSats: 50_000,
  funder: { sourceTransaction: fSrc, outputIndex: 0 },
  changeAddress: KEY.toAddress(), mark: 'first fuel 🏁',
})

check('★ the contributor\'s input is left BLANK', (tx.inputs[1].unlockingScript?.toBinary().length ?? 0) === 0)
check('★ …and the covenant\'s input is already COMPLETE', (tx.inputs[0].unlockingScript?.toBinary().length ?? 0) > 0)
check('  the tank grows by exactly what was given', tx.outputs[0].satoshis === 984 + 50_000)

/* ⚠ THE BUILDER LEAVES INPUT 1 WITH NO TEMPLATE ON PURPOSE, so `tx.sign()` alone cannot complete it —
   which is exactly the property being claimed. The wallet is what supplies the template, so the test
   has to stand in for one rather than pretending the page could. */
tx.inputs[1].unlockingScriptTemplate = new P2PKH().unlock(KEY)
await tx.sign()
check('★★ once the contributor signs, the covenant accepts it', (() => {
  try {
    return new Spend({ sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 984,
      lockingScript: DEPOT, transactionVersion: 2, otherInputs: [tx.inputs[1]], outputs: tx.outputs,
      inputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: 0,
    }).validate() === true
  } catch { return false }
})())

const size = tx.toHex().length / 2
const fee = (984 + 60_000) - tx.outputs.reduce((a, o) => a + (o.satoshis ?? 0), 0)
console.log(`        ${size} B · fee ${fee} sat = ${(fee * 1000 / size).toFixed(1)} sat/KB · tank 984 → ${(984 + 50_000).toLocaleString()}`)
check('  and it clears the relay floor', fee * 1000 / size >= SHELL_FEE_PER_KB)

/* ⚠ THE REFUSALS. A builder that never says no is a builder nobody has tested. */
const shouldThrow = (what: string, f: () => unknown): void => {
  try { f(); check(what, false) } catch { check(what, true) } }
shouldThrow('⚠ a coin too small for the amount plus the fee is REFUSED', () => buildDepotTopUpTx({
  depot: { sourceTransaction: dSrc, outputIndex: 0, value: 984 }, carScript: CAR.toBinary(), owner: OWNER,
  addSats: 60_000, funder: { sourceTransaction: fSrc, outputIndex: 0 }, changeAddress: KEY.toAddress() }))
shouldThrow('⚠⚠ an outpoint that is NOT this depot is REFUSED', () => buildDepotTopUpTx({
  depot: { sourceTransaction: fSrc, outputIndex: 0, value: 60_000 }, carScript: CAR.toBinary(), owner: OWNER,
  addSats: 1_000, funder: { sourceTransaction: fSrc, outputIndex: 0 }, changeAddress: KEY.toAddress() }))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0 ? 'TOPUP TX OK — one blank, and it is the contributor\'s.' : '⚠ TOPUP TX FAILED')
process.exit(fail === 0 ? 0 : 1)
