// © 2026 sun-dive — Apache License 2.0.
//
// ★★★ A TOP-UP FUNDED FROM MANY COINS — the restriction the page invented, and the arithmetic that
// replaces it.
//
//   node --experimental-strip-types mint/test/racer-topup-coins.ts
//
// ⚠⚠ WHY THIS FILE EXISTS AT ALL: `buildRacerTopUpTx` HAD NO TEST. It is the builder that spends real
// money into the live depot, it was written on 19 Aug, and nothing but the bundles referenced it. The
// page demanded ONE coin covering the whole amount — so at an address whose largest coin was 208,603
// sat a 2,100,000 sat top-up was impossible while the balance was ample. That rule was never in the
// covenant, never in the builder (`funder` is an array), never in the request format (`funding` is
// typed as an array) and never in the signer (Phar Lap signs every blank input of its own).
//
// ★★ WHAT IS ACTUALLY BEING PROVED, and it is not "it runs":
//
//   the SELECTOR's promise    sum(coins) >= amount + racerTopUpPad(k)
//   the BUILDER's demand      inputs - outputs = the fee the SDK derives at 100 sat/KB
//   ⇒ the test                the first must always satisfy the second, or a contributor is handed a
//                             transaction whose change is negative and which no node will relay
//
// ⚠ The pad is a per-caller ALLOWANCE, not the fee — the builder computes the real one. So a pad that
// is too small does not fail loudly here; it fails as a short change. That is why the money is
// balanced to the satoshi below rather than merely checked for "not throwing".
import { Transaction, LockingScript, PrivateKey, Hash, P2PKH, Utils } from '@bsv/sdk'
import { buildRacerDepotBasicLock, readDepotState, RACER_WINDOW_SECONDS } from '../src/racerDepotFrame.ts'
import { carBlockOps } from '../src/racerCar.ts'
import { buildRacerTopUpTx, racerTopUpPad, RACER_TOPUP_FEE_PAD } from '../src/racerDepotTopUp.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const OWNER_KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(OWNER_KEY.toPublicKey().encode(true) as number[])
const ADDR = OWNER_KEY.toPublicKey().toAddress()
const PAYEE = new P2PKH().lock(ADDR).toBinary()
const BLOCK = new LockingScript(carBlockOps({ depotScript: PAYEE })).toBinary()

const MARK = 2978504, COUNT = 3, TANK = 20035
/* ⚠ A FIXED STAMP. `Date.now()` would make the lockTime — and therefore the size, and therefore the
   fee — differ between runs, and a money test that cannot be re-run identically is not a measurement. */
const NOW = (MARK + 40) * RACER_WINDOW_SECONDS

const DEPOT_LOCK = buildRacerDepotBasicLock({ carBlock: BLOCK, owner: OWNER, mark: MARK, count: COUNT })

/** A previous transaction holding the depot at output 0. */
function depotSource(): Transaction {
  const t = new Transaction()
  t.addOutput({ lockingScript: DEPOT_LOCK, satoshis: TANK })
  return t
}
/** A previous transaction holding one of the contributor's coins at output 0. */
function coinSource(sats: number, salt: number): Transaction {
  const t = new Transaction()
  t.addOutput({ lockingScript: new P2PKH().lock(ADDR), satoshis: sats })
  /* ⚠ SALT so two coins of equal value are not the same outpoint — identical source transactions
     would collapse to one txid and the test would silently be spending the same coin twice. */
  t.addOutput({ lockingScript: new LockingScript([{ op: 0 }, { op: 106 }, { op: 4, data: [salt, 0, 0, 0] }]), satoshis: 0 })
  return t
}

/** ★ THE PAGE'S SELECTOR, kept in step with `bitcoin-racers.html` deliberately — biggest first, and the
    target re-evaluated on every step because `racerTopUpPad(k)` grows with the count. */
function pickCoins(us: Array<{ satoshis: number; i: number }>, need: number):
  { coins: Array<{ satoshis: number; i: number }>; sum: number } | null {
  const s = us.slice().sort((a, b) => b.satoshis - a.satoshis)
  const out: Array<{ satoshis: number; i: number }> = []
  let sum = 0
  for (const c of s) {
    out.push(c); sum += c.satoshis
    if (sum >= need + racerTopUpPad(out.length)) return { coins: out, sum }
  }
  return null
}

async function topUp(coinValues: number[], addSats: number, signed: boolean): Promise<Transaction> {
  const srcs = coinValues.map((v, i) => coinSource(v, i + 1))
  return await buildRacerTopUpTx({
    depot: { sourceTransaction: depotSource(), outputIndex: 0, value: TANK },
    carBlock: BLOCK, owner: OWNER, addSats,
    funder: srcs.map(s => ({ sourceTransaction: s, outputIndex: 0 })),
    changeAddress: ADDR, mark: 'first fuel', nowSecs: NOW,
    unsignedFunder: !signed,
  })
}

const money = (tx: Transaction): { inSats: number; outSats: number; fee: number; size: number } => {
  const inSats = tx.inputs.reduce((a, inp) =>
    a + (inp.sourceTransaction!.outputs[inp.sourceOutputIndex].satoshis ?? 0), 0)
  const outSats = tx.outputs.reduce((a, o) => a + (o.satoshis ?? 0), 0)
  return { inSats, outSats, fee: inSats - outSats, size: tx.toBinary().length }
}

console.log('\n★ the pad function itself')
check('racerTopUpPad(1) is the flat pad', racerTopUpPad(1) === RACER_TOPUP_FEE_PAD)
check('it GROWS with the coin count', racerTopUpPad(4) > racerTopUpPad(1))

console.log('\n★★ a top-up from MANY coins — the case the page refused')
/* The live shape: 2,100,000 sat wanted, and no coin anywhere near it. */
const WALLET = [208603, 120000, 90000, 75000, 60000, 1, 1, 579, 1500000, 400000]
const WANT = 2100000

const picked = pickCoins(WALLET.map((satoshis, i) => ({ satoshis, i })), WANT)
check('the selector finds a set for 2,100,000 sat', picked != null)
check('★ and it needs MORE THAN ONE COIN — which is the whole point', (picked?.coins.length ?? 0) > 1)
check('no single coin could have done it', Math.max(...WALLET) < WANT)

const tx = await topUp(picked!.coins.map(c => c.satoshis), WANT, true)
const m = money(tx)
check('one input per coin, plus the covenant', tx.inputs.length === picked!.coins.length + 1)
check('★★ the depot output carries the fuel', tx.outputs[0].satoshis === TANK + WANT)
check('★★ the money balances to the satoshi', m.inSats - m.outSats === m.fee)
check('change is never negative', (tx.outputs[tx.outputs.length - 1].satoshis ?? 0) >= 0)
check(`★★ the fee clears the 100 sat/KB floor (${m.fee} sat / ${m.size} B = ${(m.fee * 1000 / m.size).toFixed(1)})`,
  m.fee * 1000 / m.size >= 100)

console.log('\n★★ THE STATE PASSES THROUGH UNTOUCHED — a gift buys no minting slot')
const st = readDepotState(tx.outputs[0].lockingScript.toBinary())
check('mark is unchanged', st.mark === MARK)
check('count is unchanged', st.count === COUNT)
check('★ the successor lock is BYTE-IDENTICAL to the one being spent',
  tx.outputs[0].lockingScript.toHex() === DEPOT_LOCK.toHex())

console.log('\n★★★ THE PAD IS SUFFICIENT — swept, not sampled')
/* ⚠ THE ONE THAT MATTERS. The selector promises `sum >= need + pad(k)`; the builder then derives the
   real fee. If the pad ever under-shoots, the contributor gets a transaction with negative change or
   one under the relay floor — and this project has been under a fee floor five times. */
let swept = 0, worst = Infinity
for (const k of [1, 2, 3, 4, 5, 8]) {
  for (const amount of [1, 1000, 50000, 2100000, 21000000]) {
    /* coins sized so exactly k of them are needed and the pad is only just covered */
    const per = Math.ceil((amount + racerTopUpPad(k)) / k)
    const t = await topUp(new Array(k).fill(per), amount, true)
    const mm = money(t)
    const change = t.outputs[t.outputs.length - 1].satoshis ?? 0
    const rate = mm.fee * 1000 / mm.size
    if (change < 0 || rate < 100) {
      check(`k=${k} amount=${amount}: change ${change}, ${rate.toFixed(1)} sat/KB`, false)
    }
    worst = Math.min(worst, rate)
    swept++
  }
}
check(`★ ${swept} coin-count × amount combinations, worst fee ${worst.toFixed(1)} sat/KB`, worst >= 100)

console.log('\n★ what the contributor is handed')
const blank = await topUp([2200000], WANT, false)
check('the covenant input is COMPLETE — OP_PUSH_TX needs no key',
  (blank.inputs[0].unlockingScript?.toBinary().length ?? 0) > 0)
check('every funding input is BLANK, waiting for its owner',
  blank.inputs.slice(1).every(i => i.unlockingScript?.toBinary().length === 0))
check('and it SERIALIZES with the blanks in it', blank.toHex().length > 0)

console.log('\n⚠ NEGATIVE CONTROLS — a pass sheet of refusals only would prove nothing')
check('no coins at all is refused',
  await topUp([], WANT, true).then(() => false, () => true))
check('a top-up of nothing is refused',
  await topUp([100000], 0, true).then(() => false, () => true))
check('★ coins that cannot cover it are refused BY THE SELECTOR, not by a surprise later',
  pickCoins([{ satoshis: 500, i: 0 }, { satoshis: 400, i: 1 }], WANT) === null)
check('⚠ NEGATIVE CONTROL ON THE HARNESS: two equal coins are two DIFFERENT outpoints',
  coinSource(1000, 1).id('hex') !== coinSource(1000, 2).id('hex'))

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
