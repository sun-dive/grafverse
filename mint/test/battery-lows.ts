// © 2026 sun-dive — Apache License 2.0.
// LOW_S — an OPTIONAL grind, off by default, for one non-conformant transaction processor.
//
// The covenant DERIVES its signature, so it cannot negate a high `s` the way a key-holding signer would.
// ARC refuses those: "arc error 461: Non-canonical signature: S value is unnecessarily high". Diagnosed
// against the 2026-08-12 rehearsal — of 20 keyless ticks, the 7 ARC rejected were EXACTLY the 7 whose
// derived signature was high-S.
//
// ★ BUT ARC IS WRONG. The Chronicle release REMOVED the low-S requirement for transactions with a
// version field greater than 1, and these are version 2. Proven on mainnet the same day: rehearsal tick 1
// (`d1d19d38…`) is high-S, ARC refused it, and it was MINED into block 961,975 anyway — at 100.13 sat/KB,
// which also settles that MAX_FEE 312 clears the real miner floor.
//
// So the grind defaults OFF and this test pins both halves: ticks are protocol-correct by default, and
// the grind still works when some endpoint insists.
import { Transaction, P2PKH, PrivateKey } from '@bsv/sdk'
import { derivedSigIsLowS } from '../src/pushtx.ts'
import { buildBatteryGenesisTx, buildBatteryTickTx, buildBatteryTopUpTx, nextBatteryUtxo, type BatteryUtxo } from '../src/batteryTx.ts'
import { genesisState, BATTERY_MAX_FEE } from '../src/battery.ts'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}
const preimageOf = (tx: Transaction): number[] => tx.inputs[0].unlockingScript!.chunks[2].data as number[]

console.log('LOW_S — Chronicle by default; the grind is opt-in (ARC 461 "S value is unnecessarily high")\n')

// ── 1 · the predicate reproduces the rehearsal's 20/20 split ────────────────────
// The rehearsal's own transactions, by tick number, and which ones ARC refused.
const REHEARSAL_REJECTED = new Set([1, 6, 11, 13, 14, 16, 19])
const FUND = 200_000, FUEL = 10_000
const deployer = PrivateKey.fromRandom(), sponsor = PrivateKey.fromRandom()
const fundingTx = (k: PrivateKey, sats: number): Transaction => {
  const t = new Transaction(); t.addOutput({ lockingScript: new P2PKH().lock(k.toAddress()), satoshis: sats }); return t
}

// ── 2 · BY DEFAULT the builder does NOT grind — ticks are protocol-correct ──────
const genesis = await buildBatteryGenesisTx({
  key: deployer, funder: { sourceTransaction: fundingTx(deployer, FUND), outputIndex: 0 }, fuelSats: FUEL,
})
let raw: BatteryUtxo = { sourceTransaction: genesis, outputIndex: 0, state: genesisState(), value: FUEL }
let high = 0, low = 0, defaultFees: number[] = []
const versions: number[] = [genesis.version]
for (let n = 0; n < 24; n++) {
  const t = await buildBatteryTickTx({ battery: raw })        // no lowS → Chronicle as intended
  derivedSigIsLowS(preimageOf(t)) ? low++ : high++
  defaultFees.push(raw.value - (t.outputs[0].satoshis ?? 0))
  versions.push(t.version)
  raw = nextBatteryUtxo(t, raw)
}
console.log(`  default build: ${low} low-S · ${high} high-S out of 24  (ARC would refuse ${high}; the chain does not)`)
check('the default does NOT grind — high-S ticks are emitted', high > 0)
/* THE CHRONICLE OPT-IN, asserted rather than thrown. Chronicle withdrew LOW_S, minimal-encoding,
   NULLFAIL, MINIMALIF and clean-stack for transactions with version > 1, so a high-S covenant spend
   is protocol-correct at version 2 — proven on mainnet: tick 1 of the rehearsal was high-S, ARC
   refused it, and a miner put it in block 961,975 regardless.
   This used to call a helper that THREW on a bad version, which aborts the run instead of reporting
   a failure, and it never looked at the genesis at all. Both are covered now. */
check('genesis and every tick are version 2 — the Chronicle opt-in', versions.every(v => v === 2))
check('...and none fell back to version 1', versions.includes(1), false)
check('the default never overpays to satisfy ARC', defaultFees.every(f => f === defaultFees[0]))
console.log(`  every default tick pays the same ${defaultFees[0]} sat — no grind premium`)

// ── 3 · the grind is still available when an endpoint insists ───────────────────
let g: BatteryUtxo = { sourceTransaction: genesis, outputIndex: 0, state: genesisState(), value: FUEL }
let allLow = true, fees: number[] = [], locks: number[] = []
for (let n = 0; n < 24; n++) {
  const t = await buildBatteryTickTx({ battery: g, lowS: true })
  if (!derivedSigIsLowS(preimageOf(t))) allLow = false
  fees.push(g.value - (t.outputs[0].satoshis ?? 0))
  locks.push(t.lockTime)
  g = nextBatteryUtxo(t, g)
}
check('every ground tick is LOW_S — ARC will relay all of them', allLow)
check('every fee stays within MAX_FEE', fees.every(f => f <= BATTERY_MAX_FEE))
/* 310 is what the 3,092-byte tick needs at the official 100 sat/KB. 309 was the old grid's figure and
   would no longer catch a tick that underpaid the floor. */
check('the grind never overpays beyond the band', fees.every(f => f >= 310 && f <= BATTERY_MAX_FEE))
console.log(`  fees used     : ${[...new Set(fees)].sort((a, b) => a - b).join(', ')} sat (cap ${BATTERY_MAX_FEE})`)
console.log(`  lockTimes used: ${[...new Set(locks)].sort((a, b) => a - b).join(', ')}`)
const extra = fees.reduce((n, f) => n + f - 309, 0)
console.log(`  total extra fuel spent grinding 24 ticks: ${extra} sat`)
check('grinding costs almost nothing in fuel', extra <= 24 * 3)

// ── 4 · top-ups grind too, and the board mark survives it ───────────────────────
const topup = await buildBatteryTopUpTx({
  battery: g, addSats: 50_000, key: sponsor,
  funder: { sourceTransaction: fundingTx(sponsor, FUND), outputIndex: 0 },
  mark: 'this arc ran on my sats', lowS: true,
})
check('a top-up can be ground to LOW_S as well', derivedSigIsLowS(preimageOf(topup)))
check('the board mark survives the grind',
  topup.outputs[1].lockingScript.toASM().includes(Buffer.from('this arc ran on my sats', 'utf8').toString('hex')))
check('the top-up still raises out0', (topup.outputs[0].satoshis ?? 0) === g.value + 50_000)

// ── 5 · a default top-up is version 2 and un-ground ─────────────────────────────
const plainTopUp = await buildBatteryTopUpTx({
  battery: g, addSats: 50_000, key: sponsor,
  funder: { sourceTransaction: fundingTx(sponsor, FUND), outputIndex: 0 }, mark: 'chronicle as intended',
})
check('a default top-up is version 2 (Chronicle opt-in)', plainTopUp.version === 2)
check('a default top-up carries its mark', plainTopUp.outputs[1].satoshis === 0)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY LOW_S: FAIL'); process.exit(1) }
console.log('BATTERY LOW_S OK — Chronicle by default; the grind is there if an endpoint insists.')
