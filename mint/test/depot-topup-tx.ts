// © BSV Association — Open BSV License v6.
// THE CONTRIBUTE BUTTON'S BUILDER — the page assembles it, the contributor signs one blank.
import { Transaction, Spend, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import { buildDepotTopUpTx, TOPUP_FEE_PAD, topUpPad } from '../src/depotTx.ts'
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

/* ── ★★ AND FROM A DEPOT MINTED EMPTY — one satoshi, filled only by this flow ─────────────────────
   sun-dive, 16 Aug: *"the depot should be minted empty too."* The tool used to refuse a genesis below
   one tap plus its fee, which confuses "cannot pump yet" with "invalid" — an empty depot filled by
   contributions is a better first deployment, because the top-up becomes the ONLY way fuel ever gets
   in and every satoshi in the tank has a donor.

   ⚠ NOTHING IS BRICKED BY IT, and this is where that is proved rather than asserted: the value rule
   is a FLOOR, so a spend that hands back MORE is legal at any balance, and the FUNDER's input pays
   this transaction's fee rather than the tank. A husk can always be woken up.
   ⚠ One satoshi and not zero — a 0-value output is refused as dust before a script is evaluated. */
{
  const hSrc = new Transaction(); hSrc.addOutput({ lockingScript: DEPOT, satoshis: 1 })
  const gSrc = new Transaction(); gSrc.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: 60_000 })
  const wake = buildDepotTopUpTx({
    depot: { sourceTransaction: hSrc, outputIndex: 0, value: 1 },
    carScript: CAR.toBinary(), owner: OWNER, addSats: 41_682,
    funder: { sourceTransaction: gSrc, outputIndex: 0 },
    changeAddress: KEY.toAddress(), mark: 'first fuel 🏁',
  })
  wake.inputs[1].unlockingScriptTemplate = new P2PKH().unlock(KEY)
  await wake.sign()
  check('★★ a depot minted EMPTY — one satoshi — accepts its first contribution', (() => {
    try {
      return new Spend({ sourceTXID: hSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1,
        lockingScript: DEPOT, transactionVersion: 2, otherInputs: [wake.inputs[1]], outputs: wake.outputs,
        inputIndex: 0, unlockingScript: wake.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: 0,
      }).validate() === true
    } catch { return false }
  })())
  check('  …and the tank is exactly the contribution plus the husk', wake.outputs[0].satoshis === 1 + 41_682)
  console.log(`        1 → ${(1 + 41_682).toLocaleString()} sat · the whole tank has a donor`)
}

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

/* ── ★★ SEVERAL COINS, BECAUSE A WALLET HOLDS A BALANCE AND NOT A COIN ────────────────────────────
   This builder used to take exactly ONE funding coin and explain it as "a covenant spend takes exactly
   one funding input". Not true of any covenant here — `hashPrevouts` does not appear in `depot.ts`
   even once. The real constraint is that the input SET must be FINAL before the covenant's unlocking
   script is built, because its preimage commits to every outpoint: known in advance, not singular.

   ⇒ A contributor holding 582 satoshis across four coins was told to go and pay themselves first.
   sun-dive, 16 Aug: *"it is a bad UX."*

   ⚠ AND THE FEE IS WHERE THIS GOES WRONG QUIETLY. Each extra input is ~148 bytes to pay for, so a
   FIXED pad with three coins underpays and the transaction is simply never relayed — the relay floor
   again, in a new costume. The rate is therefore MEASURED here on real serialized transactions at one,
   two, three and four coins, not asserted from the pad arithmetic that produced it. */
console.log()
{
  const dust = (n: number): Transaction => {
    const t = new Transaction()
    t.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: n })
    return t
  }
  for (const parts of [[6_000], [3_000, 3_000], [2_500, 2_000, 1_500], [2_000, 1_600, 1_400, 1_200]]) {
    const dSrc2 = new Transaction(); dSrc2.addOutput({ lockingScript: DEPOT, satoshis: 1 })
    const coins = parts.map(v => ({ sourceTransaction: dust(v), outputIndex: 0 }))
    const total = parts.reduce((a, b) => a + b, 0)
    const add = total - topUpPad(coins.length)
    const t = buildDepotTopUpTx({
      depot: { sourceTransaction: dSrc2, outputIndex: 0, value: 1 },
      carScript: CAR.toBinary(), owner: OWNER, addSats: add,
      funder: coins, changeAddress: KEY.toAddress(), mark: null,
    })
    for (let i = 1; i < t.inputs.length; i++) t.inputs[i].unlockingScriptTemplate = new P2PKH().unlock(KEY)
    await t.sign()
    const ok = (() => { try {
      return new Spend({ sourceTXID: dSrc2.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1,
        lockingScript: DEPOT, transactionVersion: 2, otherInputs: t.inputs.slice(1), outputs: t.outputs,
        inputIndex: 0, unlockingScript: t.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: 0,
      }).validate() === true
    } catch { return false } })()
    const size = t.toHex().length / 2
    const fee = (1 + total) - t.outputs.reduce((a, o) => a + (o.satoshis ?? 0), 0)
    const rate = fee * 1000 / size
    check(`★★ ${coins.length} coin(s): the covenant accepts it, and the tank gets ${add.toLocaleString()}`,
      ok && t.outputs[0].satoshis === 1 + add)
    check(`  …and it clears the relay floor — ${rate.toFixed(1)} sat/KB over ${size} B`,
      rate >= SHELL_FEE_PER_KB)
  }
  console.log(`        pad ${TOPUP_FEE_PAD} for one coin, +20 each after — ` +
    `${[1, 2, 3, 4].map(n => topUpPad(n)).join(' · ')}`)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0 ? 'TOPUP TX OK — one blank, and it is the contributor\'s.' : '⚠ TOPUP TX FAILED')
process.exit(fail === 0 ? 0 : 1)
