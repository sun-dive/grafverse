// © 2026 sun-dive — Apache License 2.0.
// THE HANDOVER — the page assembles a transaction with ONE BLANK, and a stranger's wallet fills it in.
//
//   node --experimental-strip-types mint/test/battery-handover.ts
//
// battery.html holds no key, signs nothing and broadcasts nothing. It reads the funder's coins from the
// chain, assembles the whole top-up, and hands it over. That is only honest if the thing it hands over
// can actually be completed by someone else — so this proves it, rather than asserting it in a comment.
//
// The property the entire flow rests on:
//
//   ★ SIGNING INPUT #2 DOES NOT DISTURB INPUT #1.
//
// A sighash preimage commits to the outpoints, the values, the outputs and the scriptCode of the input
// being signed — it does NOT commit to any other input's unlocking script. So the covenant's OP_PUSH_TX
// authorisation can be built FIRST and stay valid while a wallet, minutes later and on another machine,
// adds a signature beside it. If that were false there would be no handover at all: the page would have
// to sign, which means holding a key, which is the thing being removed.
//
// And the scope is ANYONECANPAY|ALL|FORKID (0xc1), which divides the transaction exactly where the
// trust does:
//
//   INPUTS   not committed — the funder may sign the coin the page chose, a different one, or several.
//            The page's coin selection is a convenience, not an instruction.
//   OUTPUTS  committed — the fuel, the mark and the change address cannot be altered by anyone,
//            including the page that wrote them. Money cannot be redirected after the fact.
//
// ⚠ The one sharp edge of that freedom: the change output holds a FIXED number of satoshis. A wallet
// that swaps in a larger coin without being able to adjust change donates the difference to miners.
// So "sign exactly this" remains the right instruction to a funder, even though the covenant would
// tolerate more.
import { Transaction, P2PKH, PrivateKey, Spend, LockingScript } from '@bsv/sdk'
import { buildBatteryTopUpTx, type BatteryUtxo } from '../src/batteryTx.ts'
import { buildBatteryLock, genesisState, refState, BATTERY_GEOMETRY, BATTERY_MAX_FEE } from '../src/battery.ts'

const FUEL = 20_000, FUND = 100_000, ADD = 30_000
const MARK = 'A Bitcoin battery can power a Mandelbrot generator, or an AI agent.'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}
const arrEq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

function validateInput(tx: Transaction, i: number, lock: LockingScript, sats: number): boolean {
  const input = tx.inputs[i]
  try {
    return new Spend({
      sourceTXID: input.sourceTransaction!.id('hex'), sourceOutputIndex: input.sourceOutputIndex,
      sourceSatoshis: sats, lockingScript: lock, transactionVersion: tx.version,
      otherInputs: tx.inputs.filter((_, k) => k !== i), outputs: tx.outputs, inputIndex: i,
      unlockingScript: input.unlockingScript!, inputSequence: input.sequence ?? 0xffffffff, lockTime: tx.lockTime,
    }).validate() === true
  } catch (e) { console.log('   ↳', (e as Error).message.split('\n')[0]); return false }
}

/** A battery parked at genesis, as if it were the live tip. */
function batteryUtxo(): BatteryUtxo {
  const state = genesisState()
  const source = new Transaction()
  source.addOutput({ lockingScript: buildBatteryLock({ state }), satoshis: FUEL })
  return { sourceTransaction: source, outputIndex: 0, state, value: FUEL }
}
function fundingTx(key: PrivateKey, sats: number): Transaction {
  const t = new Transaction()
  t.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return t
}

console.log('THE HANDOVER — a page-built transaction, completed by a wallet that never met the page\n')

const funder = PrivateKey.fromRandom()
const addr = funder.toAddress()
const battery = batteryUtxo()
const params = {
  battery, addSats: ADD, mark: MARK, changeAddress: addr,
  funder: { sourceTransaction: fundingTx(funder, FUND), outputIndex: 0 },
}

// ── WHAT THE PAGE PRODUCES ────────────────────────────────────────────────────────────────────────
// `key` is present only so the builder can SIZE the funder's input; unsignedFunder throws its
// signature away afterwards. A random key is the honest choice — using a real one would imply the
// page had something to sign with.
const handover = await buildBatteryTopUpTx({ ...params, key: PrivateKey.fromRandom(), unsignedFunder: true })

check('the page produces two inputs', handover.inputs.length === 2)
check('input #2 (the funder\'s) is BLANK', handover.inputs[1].unlockingScript!.toBinary().length === 0)
check('input #1 (the covenant\'s) is already complete', handover.inputs[0].unlockingScript!.toBinary().length > 0)
check('nothing is left that would try to sign later', handover.inputs[1].unlockingScriptTemplate === undefined)

const covLock = buildBatteryLock({ state: battery.state })
check('★ the covenant input validates BEFORE the funder signs', validateInput(handover, 0, covLock, FUEL))

// ── WHAT THE WALLET DOES — nothing but fill in the blank ──────────────────────────────────────────
// This is a stranger's signer: it has the transaction and its own key, and no knowledge of the page.
const completed = Transaction.fromHex(handover.toHex())          // as if copied out and pasted in
completed.inputs[0].sourceTransaction = handover.inputs[0].sourceTransaction
completed.inputs[1].sourceTransaction = handover.inputs[1].sourceTransaction
completed.inputs[1].unlockingScript = await new P2PKH().unlock(funder).sign(completed, 1)

/* ⚠ WITHOUT THIS THE SIGNATURE IS DISCARDED, SILENTLY — see PharLap/docs/SDK_SERIALIZATION_CACHE_BUG.md.
   `Transaction.fromHex` stores the bytes it parsed, and `toHex()` returns them however the inputs have
   been mutated since. This test USED to pass without it, because it validated the object it had just
   written to rather than the bytes that object serializes to — which is precisely how the SDK bug hid
   in the first place, and it is a poor model of a wallet, since a real one broadcasts BYTES. */
completed.invalidateSerializationCaches()

check('the wallet\'s own input validates', validateInput(completed, 1, new P2PKH().lock(addr), FUND))

// ★ And the SERIALIZED result really is signed — asserted on what would be broadcast, not on the object.
{
  const asSent = Transaction.fromHex(completed.toHex())
  check('★ the completed transaction is signed IN THE BYTES', (asSent.inputs[1].unlockingScript?.toBinary().length ?? 0) > 100)
  check('  …and is no longer the transaction that was handed over', completed.toHex() !== handover.toHex())
}
check('★ the covenant input STILL validates after the funder signed',
  validateInput(completed, 0, covLock, FUEL))

// ── AND IT IS THE SAME TRANSACTION THE BUILDER WOULD HAVE MADE ────────────────────────────────────
// Handing over an unsigned transaction must lose nothing. Everything except the one blank is identical
// to what a builder holding the funder's key produces in a single pass.
const inHouse = await buildBatteryTopUpTx({ ...params, key: funder })
check('outputs are identical to a normally-built top-up',
  arrEq(inHouse.outputs.flatMap(o => o.lockingScript.toBinary()),
        completed.outputs.flatMap(o => o.lockingScript.toBinary())))
check('output values are identical',
  arrEq(inHouse.outputs.map(o => o.satoshis ?? 0), completed.outputs.map(o => o.satoshis ?? 0)))

// ── WHAT THE FUNDER IS ACTUALLY AGREEING TO ───────────────────────────────────────────────────────
const outs = completed.outputs.map(o => o.satoshis ?? 0)
const fee = (FUEL + FUND) - outs.reduce((a, b) => a + b, 0)
// The battery does not pay for its own top-up: out0 rises by the FULL contribution and the funder
// covers the miner's fee out of their change. A contributor's satoshis all become fuel.
check('the whole contribution becomes fuel', outs[0] === FUEL + ADD)
check('the mark is a trailing OP_RETURN',
  completed.outputs[1].lockingScript.toASM().includes(Buffer.from(MARK, 'utf8').toString('hex')))
check('the change comes back to the funder',
  arrEq(completed.outputs[2].lockingScript.toBinary(), new P2PKH().lock(addr).toBinary()))
check('the funder pays only the fee and the fuel', outs[2] === FUND - ADD - fee)
console.log(`        fuel +${ADD.toLocaleString()} · fee ${fee} sat · change ${outs[2].toLocaleString()} sat · ${completed.toHex().length / 2} bytes`)

// ── WHAT A WALLET MAY CHANGE, AND WHAT IT MAY NOT ─────────────────────────────────────────────────
// The funder is free on the input side. A wallet that re-selects its own coin still produces a
// transaction the covenant accepts — which is what makes this safe to hand to software nobody here
// controls. ANYONECANPAY is doing the work.
{
  const swapped = fundingTx(funder, FUND * 2)
  const other = Transaction.fromHex(handover.toHex())
  other.inputs[0].sourceTransaction = handover.inputs[0].sourceTransaction
  other.inputs[1].sourceTransaction = swapped
  other.inputs[1].sourceTXID = swapped.id('hex')
  other.inputs[1].unlockingScript = await new P2PKH().unlock(funder).sign(other, 1)
  check('a wallet may spend a DIFFERENT coin — the covenant does not mind',
    validateInput(other, 0, covLock, FUEL))
  const paid = (FUEL + FUND * 2) - other.outputs.map(o => o.satoshis ?? 0).reduce((a, b) => a + b, 0)
  check('  …but the change output is FIXED, so the surplus is donated to miners', paid === fee + FUND)
  console.log(`        a coin twice the size turns a ${fee} sat fee into ${paid.toLocaleString()} sat`)
}

// The output side is where the guarantee lives. Nobody — not a wallet, not a man in the middle, not
// this page — can move the money somewhere else, because hashOutputs is inside the covenant's preimage.
{
  const thief = PrivateKey.fromRandom().toAddress()
  const tampered = Transaction.fromHex(handover.toHex())
  tampered.inputs[0].sourceTransaction = handover.inputs[0].sourceTransaction
  tampered.inputs[1].sourceTransaction = handover.inputs[1].sourceTransaction
  tampered.outputs[2].lockingScript = new P2PKH().lock(thief)          // redirect the change
  tampered.inputs[1].unlockingScript = await new P2PKH().unlock(funder).sign(tampered, 1)
  check('★ redirecting an output BREAKS the covenant input', validateInput(tampered, 0, covLock, FUEL), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('HANDOVER: FAIL — the page is handing over something that cannot be completed'); process.exit(1) }
console.log('HANDOVER OK — the page can hold no key, and the transaction it hands over still works.')
