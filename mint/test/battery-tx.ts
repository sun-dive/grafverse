// © 2026 sun-dive — Apache License 2.0.
// THE BATTERY — end to end: assemble REAL genesis → tick → tick → top-up → tick transactions and validate
// every input through the @bsv/sdk `Spend` interpreter. This is the last gate before a mainnet rehearsal.
//
// What it has to prove, beyond "the script runs":
//   · a tick carries NO signature and NO funding input — one input, one output, fee from its own value
//   · the fee a tick pays clears the 100 sat/KB floor (the thing MAX_FEE 312 exists for)
//   · a top-up ADDS value in the same transaction that advances the state, and may carry a board mark
//   · the state the chain produces matches the reference renderer exactly, tick after tick
import { Transaction, P2PKH, PrivateKey, Spend, LockingScript } from '@bsv/sdk'
import {
  buildBatteryGenesisTx, buildBatteryTickTx, buildBatteryTopUpTx, nextBatteryUtxo, type BatteryUtxo,
} from '../src/batteryTx.ts'
import {
  buildBatteryLock, genesisState, refState, ticksRemaining,
  BATTERY_MAX_FEE, BATTERY_FEE_PER_KB, BATTERY_STATE_LAYOUT, type BatteryState,
} from '../src/battery.ts'

const FUND = 100_000, FUEL = 20_000
const arrEq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const stateEq = (a: BatteryState, b: BatteryState): boolean =>
  (Object.keys(a) as Array<keyof BatteryState>).every(k => a[k] === b[k])

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}

function fundingTx(key: PrivateKey, sats: number): Transaction {
  const t = new Transaction()
  t.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return t
}
function validateInput(tx: Transaction, idx: number, lockingScript: LockingScript, sourceSats: number): boolean {
  const input = tx.inputs[idx]
  const spend = new Spend({
    sourceTXID: input.sourceTransaction!.id('hex'), sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sourceSats, lockingScript, transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== idx), outputs: tx.outputs, inputIndex: idx,
    unlockingScript: input.unlockingScript!, inputSequence: input.sequence ?? 0xffffffff, lockTime: tx.lockTime,
  })
  try { return spend.validate() === true } catch (e) { console.log('   ↳', (e as Error).message.split('\n')[0]); return false }
}

console.log('THE BATTERY — real transactions, interpreter-validated\n')

const deployer = PrivateKey.fromRandom(), sponsor = PrivateKey.fromRandom()

// ── genesis ──────────────────────────────────────────────────────────────────────
const s0 = genesisState()
const genesis = await buildBatteryGenesisTx({
  key: deployer, funder: { sourceTransaction: fundingTx(deployer, FUND), outputIndex: 0 }, fuelSats: FUEL,
})
check('genesis funder input validates', validateInput(genesis, 0, new P2PKH().lock(deployer.toAddress()), FUND))
check('genesis out0 = the battery at frame 1',
  arrEq(genesis.outputs[0].lockingScript.toBinary(), buildBatteryLock({ state: s0 }).toBinary()))
check('genesis out0 carries the fuel', genesis.outputs[0].satoshis === FUEL)
check('genesis out1 publishes the state layout',
  genesis.outputs[1].lockingScript.toASM().includes(Buffer.from(BATTERY_STATE_LAYOUT, 'utf8').toString('hex')))
console.log(`  fuel ${FUEL.toLocaleString()} sat → ${ticksRemaining(FUEL).toLocaleString()} ticks of headroom`)

// ── tick 1 · keyless ─────────────────────────────────────────────────────────────
let utxo: BatteryUtxo = { sourceTransaction: genesis, outputIndex: 0, state: s0, value: FUEL }
const tick1 = await buildBatteryTickTx({ battery: utxo })
const lock1 = buildBatteryLock({ state: refState(s0) })

check('tick1 covenant input validates', validateInput(tick1, 0, buildBatteryLock({ state: s0 }), FUEL))
check('tick1 has exactly ONE input', tick1.inputs.length === 1)
check('tick1 has exactly ONE output (no change)', tick1.outputs.length === 1)
check('tick1 out0 = the battery, advanced', arrEq(tick1.outputs[0].lockingScript.toBinary(), lock1.toBinary()))

const fee1 = FUEL - (tick1.outputs[0].satoshis ?? 0)
const size1 = tick1.toBinary().length
console.log(`  tick tx ${size1} bytes · fee ${fee1} sat · ${(fee1 / size1 * 1000).toFixed(3)} sat/KB`)
check(`tick fee is within MAX_FEE (${BATTERY_MAX_FEE})`, fee1 <= BATTERY_MAX_FEE)
check('tick fee clears the 100 sat/KB floor', fee1 / size1 * 1000 >= BATTERY_FEE_PER_KB)
check('tick carries NO signature — the unlocking script is pure OP_PUSH_TX data',
  tick1.inputs[0].unlockingScript!.chunks.length === 3)

// ── tick 2 · spend what tick 1 produced ──────────────────────────────────────────
utxo = nextBatteryUtxo(tick1, utxo)
const tick2 = await buildBatteryTickTx({ battery: utxo })
check('tick2 covenant input validates', validateInput(tick2, 0, lock1, utxo.value))
check('tick2 out0 = the battery, advanced twice',
  arrEq(tick2.outputs[0].lockingScript.toBinary(), buildBatteryLock({ state: refState(refState(s0)) }).toBinary()))

// ── top-up · adds value AND advances, with a board mark ──────────────────────────
utxo = nextBatteryUtxo(tick2, utxo)
const ADD = 50_000
const topup = await buildBatteryTopUpTx({
  battery: utxo, addSats: ADD,
  key: sponsor, funder: { sourceTransaction: fundingTx(sponsor, FUND), outputIndex: 0 },
  mark: 'this arc ran on my sats',
})
check('top-up covenant input validates',
  validateInput(topup, 0, buildBatteryLock({ state: utxo.state }), utxo.value))
check('top-up funder input validates', validateInput(topup, 1, new P2PKH().lock(sponsor.toAddress()), FUND))
check('top-up RAISES out0 value', (topup.outputs[0].satoshis ?? 0) === utxo.value + ADD)
check('top-up still advances the state',
  arrEq(topup.outputs[0].lockingScript.toBinary(), buildBatteryLock({ state: refState(utxo.state) }).toBinary()))
check('top-up carries the mark as a trailing OP_RETURN',
  topup.outputs[1].lockingScript.toASM().includes(Buffer.from('this arc ran on my sats', 'utf8').toString('hex')))
check('the sponsor pays the fee, not the battery', (topup.outputs[0].satoshis ?? 0) > utxo.value)

// ── tick again after the top-up — the battery just keeps going ───────────────────
utxo = nextBatteryUtxo(topup, utxo)
const tick3 = await buildBatteryTickTx({ battery: utxo })
check('tick after top-up validates', validateInput(tick3, 0, buildBatteryLock({ state: utxo.state }), utxo.value))
check('the top-up is visible as fuel', ticksRemaining(utxo.value) > ticksRemaining(FUEL))

// ── the chain's state matches the reference renderer, tick after tick ────────────
let ref = s0, ok = true
let walk: BatteryUtxo = { sourceTransaction: genesis, outputIndex: 0, state: s0, value: FUEL }
for (let n = 0; n < 12; n++) {
  const t = await buildBatteryTickTx({ battery: walk })
  ref = refState(ref)
  if (!arrEq(t.outputs[0].lockingScript.toBinary(), buildBatteryLock({ state: ref }).toBinary())) { ok = false; break }
  walk = nextBatteryUtxo(t, walk)
}
check('12 chained ticks match the reference renderer exactly', ok)
check('state advanced as expected', stateEq(walk.state, ref))

// ── a flat battery fails loudly, not silently ────────────────────────────────────
let flatThrew = false
try { await buildBatteryTickTx({ battery: { ...walk, value: 10 } }) } catch { flatThrew = true }
check('a battery too flat to pay its fee throws', flatThrew)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY TX: FAIL'); process.exit(1) }
console.log('BATTERY TX OK — genesis → tick → tick → top-up → tick, all interpreter-valid.')
