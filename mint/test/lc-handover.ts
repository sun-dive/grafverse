// © 2026 sun-dive — Apache License 2.0.
// THE COUNTER'S HANDOVER — brc226.html assembles a tick with ONE BLANK and holds no key.
//
//   node --experimental-strip-types mint/test/lc-handover.ts
//
// The same arrangement the battery page uses, applied to demo one. It replaces a flow that minted a
// THROWAWAY KEY in the visitor's browser, asked them to send it sats by QR, and spent that key on
// their behalf — which put their coins on a key that existed only in one browser's localStorage,
// between two transactions, with the page itself warning them not to clear their history.
//
// Now the page assembles the whole tick and stops. The counter's input needs no key (OP_PUSH_TX), the
// poster's input is left blank, and the poster fills it in wherever they keep their coins.
//
// The property it rests on, same as the battery: a sighash preimage commits to the outpoints, the
// values, the outputs and the scriptCode of the input BEING signed — never to another input's
// unlocking script. So the covenant's authorisation survives a signature added later, elsewhere.
import { Transaction, P2PKH, PrivateKey, Spend, LockingScript } from '@bsv/sdk'
import { buildGenesisTx, buildTickTx, keyHash160 } from '../src/liveCounterTx.ts'
import { buildLiveCounterLock } from '../src/liveCounter.ts'

const V = 1, DEPOSIT = 1000, MARKFEE = 1, FUND = 100_000
const MARK = 'posted from a wallet this page never saw 🐇'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); ok ? pass++ : fail++
}
const arrEq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

function fundingTx(key: PrivateKey, sats: number): Transaction {
  const t = new Transaction()
  t.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: sats })
  return t
}
function validateInput(tx: Transaction, idx: number, lock: LockingScript, sats: number): boolean {
  const input = tx.inputs[idx]
  const txidOf = (x: typeof input): string => x.sourceTXID ?? x.sourceTransaction!.id('hex')
  try {
    return new Spend({
      sourceTXID: txidOf(input), sourceOutputIndex: input.sourceOutputIndex,
      sourceSatoshis: sats, lockingScript: lock, transactionVersion: tx.version,
      otherInputs: tx.inputs.filter((_, i) => i !== idx).map(x => ({
        sourceTXID: txidOf(x), sourceOutputIndex: x.sourceOutputIndex, sequence: x.sequence ?? 0xffffffff,
      })),
      outputs: tx.outputs, inputIndex: idx, unlockingScript: input.unlockingScript!,
      inputSequence: input.sequence ?? 0xffffffff, lockTime: tx.lockTime,
    }).validate() === true
  } catch (e) { console.log('   ↳', (e as Error).message.split('\n')[0]); return false }
}

console.log('THE COUNTER\'S HANDOVER — a tick the page cannot sign and does not need to\n')

const deployer = PrivateKey.fromRandom(), poster = PrivateKey.fromRandom()
const dH = keyHash160(deployer), pH = keyHash160(poster)
const genesis = await buildGenesisTx({ key: deployer, funder: { sourceTransaction: fundingTx(deployer, FUND), outputIndex: 0 } })
const lock0 = buildLiveCounterLock({ n: 0, lastFunderHash: dH, authorHash: dH })

const params = {
  covenant: { sourceTransaction: genesis, outputIndex: 0, n: 0, lastFunderHash: dH },
  authorHash: dH, newFunderHash: pH,
  funder: { sourceTransaction: fundingTx(poster, FUND), outputIndex: 0 },
  mark: MARK, changeAddress: poster.toAddress(),
}

// ── WHAT THE PAGE PRODUCES ────────────────────────────────────────────────────────────────────────
// The key is a random one, present only so the builder can size the input for the fee. That is the
// honest choice: a page that holds no key should not be handed a real one to "not use".
const handover = await buildTickTx({ ...params, funder: { ...params.funder, key: PrivateKey.fromRandom() }, unsignedFunder: true })

check('the page produces two inputs', handover.inputs.length === 2)
check('the poster\'s input is BLANK', handover.inputs[1].unlockingScript!.toBinary().length === 0)
check('the counter\'s input is already complete', handover.inputs[0].unlockingScript!.toBinary().length > 0)
check('nothing is left that would try to sign later', handover.inputs[1].unlockingScriptTemplate === undefined)
check('★ the counter input validates BEFORE the poster signs', validateInput(handover, 0, lock0, V))

// ── WHAT THE POSTER'S WALLET DOES — fill in the blank, nothing else ───────────────────────────────
const completed = Transaction.fromHex(handover.toHex())
completed.inputs[0].sourceTransaction = handover.inputs[0].sourceTransaction
completed.inputs[1].sourceTransaction = handover.inputs[1].sourceTransaction
completed.inputs[1].unlockingScript = await new P2PKH().unlock(poster).sign(completed, 1)
completed.invalidateSerializationCaches()          // see docs/SDK_SERIALIZATION_CACHE_BUG.md in PharLap

check('the poster\'s own input validates', validateInput(completed, 1, new P2PKH().lock(poster.toAddress()), FUND))
check('★ the counter input STILL validates after the poster signed', validateInput(completed, 0, lock0, V))

// ── AND IT IS THE SAME TICK THE OLD FLOW WOULD HAVE BROADCAST ─────────────────────────────────────
const inHouse = await buildTickTx({ ...params, funder: { ...params.funder, key: poster } })
check('outputs are identical to a normally-built tick',
  arrEq(inHouse.outputs.flatMap(o => o.lockingScript.toBinary()), completed.outputs.flatMap(o => o.lockingScript.toBinary())))
check('output values are identical',
  arrEq(inHouse.outputs.map(o => o.satoshis ?? 0), completed.outputs.map(o => o.satoshis ?? 0)))

// ── WHAT THE POSTER IS AGREEING TO ────────────────────────────────────────────────────────────────
const outs = completed.outputs.map(o => o.satoshis ?? 0)
const fee = (V + FUND) - outs.reduce((a, b) => a + b, 0)
const lock1 = buildLiveCounterLock({ n: 1, lastFunderHash: pH, authorHash: dH })
check('the counter advances to n=1 with the poster as next funder',
  arrEq(completed.outputs[0].lockingScript.toBinary(), lock1.toBinary()))
check('the previous funder is repaid the deposit', outs[1] === DEPOSIT)
check('the author gets the crumb', outs[2] === MARKFEE)
check('the mark rides along as an OP_RETURN',
  completed.outputs[3].lockingScript.toASM().includes(Buffer.from(MARK, 'utf8').toString('hex')))
check('the change comes back to the poster',
  arrEq(completed.outputs[4].lockingScript.toBinary(), new P2PKH().lock(poster.toAddress()).toBinary()))
console.log(`        deposit ${DEPOSIT} · crumb ${MARKFEE} · fee ${fee} sat · change ${outs[4].toLocaleString()} · ${completed.toHex().length / 2} bytes`)
console.log(`        true cost to the poster: ${(FUND - outs[4]).toLocaleString()} sat, of which ${DEPOSIT} comes back on the next tick`)

// ── AND NOBODY CAN REDIRECT IT ────────────────────────────────────────────────────────────────────
// The scope is ANYONECANPAY|ALL, so the poster may fund it however they like — but hashOutputs is in
// the covenant's preimage, so the deposit, the crumb, the mark and the change cannot be moved.
{
  const thief = PrivateKey.fromRandom().toAddress()
  const tampered = Transaction.fromHex(handover.toHex())
  tampered.inputs[0].sourceTransaction = handover.inputs[0].sourceTransaction
  tampered.inputs[1].sourceTransaction = handover.inputs[1].sourceTransaction
  tampered.outputs[4].lockingScript = new P2PKH().lock(thief)
  tampered.inputs[1].unlockingScript = await new P2PKH().unlock(poster).sign(tampered, 1)
  tampered.invalidateSerializationCaches()
  check('★ redirecting the change BREAKS the counter input', validateInput(tampered, 0, lock0, V), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('LC HANDOVER: FAIL — the page is handing over something that cannot be completed'); process.exit(1) }
console.log('LC HANDOVER OK — the page can hold no key, and the tick it hands over still works.')
