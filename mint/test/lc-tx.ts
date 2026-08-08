// © BSV Association — Open BSV License v6.
// BRC-226 LiveCounter — end-to-end: assemble REAL genesis + tick + tick txs (fee + signing + change)
// and validate every input through the @bsv/sdk Spend interpreter.
import { Transaction, P2PKH, PrivateKey, Spend, LockingScript } from '@bsv/sdk'
import { buildGenesisTx, buildTickTx, keyHash160 } from '../src/liveCounterTx.ts'
import { buildLiveCounterLock } from '../src/liveCounter.ts'
import { p2pkhScript } from '../src/covenant.ts'

const V = 1, DEPOSIT = 1000, MARKFEE = 1, FUND = 100_000
const arrEq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

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
  try { return spend.validate() === true } catch (e) { console.log('   ↳', (e as Error).message); return false }
}

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true) => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); ok ? pass++ : fail++
}

const deployer = PrivateKey.fromRandom(), signer1 = PrivateKey.fromRandom(), signer2 = PrivateKey.fromRandom()
const dH = keyHash160(deployer), s1H = keyHash160(signer1), s2H = keyHash160(signer2)

// ── genesis (n=0, "Follow the white 🐇") ───────────────────────────────────
const genesis = await buildGenesisTx({ key: deployer, funder: { sourceTransaction: fundingTx(deployer, FUND), outputIndex: 0 } })
check('genesis funder input validates', validateInput(genesis, 0, new P2PKH().lock(deployer.toAddress()), FUND))
const lock0 = buildLiveCounterLock({ n: 0, lastFunderHash: dH, authorHash: dH })
check('genesis out0 = counter lock @ n=0', arrEq(genesis.outputs[0].lockingScript.toBinary(), lock0.toBinary()))

// ── tick 0 → 1 (signer1) ───────────────────────────────────────────────────
const tick1 = await buildTickTx({
  covenant: { sourceTransaction: genesis, outputIndex: 0, n: 0, lastFunderHash: dH },
  authorHash: dH, newFunderHash: s1H,
  funder: { key: signer1, sourceTransaction: fundingTx(signer1, FUND), outputIndex: 0 },
  mark: 'wagmi 🐇',
})
const lock1 = buildLiveCounterLock({ n: 1, lastFunderHash: s1H, authorHash: dH })
check('tick1 covenant input validates', validateInput(tick1, 0, lock0, V))
check('tick1 funder input validates',   validateInput(tick1, 1, new P2PKH().lock(signer1.toAddress()), FUND))
check('tick1 out0 = counter lock @ n=1', arrEq(tick1.outputs[0].lockingScript.toBinary(), lock1.toBinary()))
check('tick1 out1 repays deployer DEPOSIT', tick1.outputs[1].satoshis === DEPOSIT && arrEq(tick1.outputs[1].lockingScript.toBinary(), p2pkhScript(dH)))
check('tick1 out2 = author crumb MARKFEE',  tick1.outputs[2].satoshis === MARKFEE && arrEq(tick1.outputs[2].lockingScript.toBinary(), p2pkhScript(dH)))

// ── tick 1 → 2 (signer2, spends tick1's counter) ───────────────────────────
const tick2 = await buildTickTx({
  covenant: { sourceTransaction: tick1, outputIndex: 0, n: 1, lastFunderHash: s1H },
  authorHash: dH, newFunderHash: s2H,
  funder: { key: signer2, sourceTransaction: fundingTx(signer2, FUND), outputIndex: 0 },
  mark: 'Follow the white 🐇',
})
const lock2 = buildLiveCounterLock({ n: 2, lastFunderHash: s2H, authorHash: dH })
check('tick2 covenant input validates', validateInput(tick2, 0, lock1, V))
check('tick2 out0 = counter lock @ n=2', arrEq(tick2.outputs[0].lockingScript.toBinary(), lock2.toBinary()))
check('tick2 out1 repays signer1 DEPOSIT', tick2.outputs[1].satoshis === DEPOSIT && arrEq(tick2.outputs[1].lockingScript.toBinary(), p2pkhScript(s1H)))

// ── send-to-post: a throwaway key funds the tick, but change + the refund both go to the POSTER ──
const throwaway = PrivateKey.fromRandom(), poster = PrivateKey.fromRandom()
const posterHash = keyHash160(poster), posterAddr = poster.toAddress()
const stp = await buildTickTx({
  covenant: { sourceTransaction: tick2, outputIndex: 0, n: 2, lastFunderHash: s2H },
  authorHash: dH, newFunderHash: posterHash,                       // refund (out0.newFunder) → poster's wallet
  funder: { key: throwaway, sourceTransaction: fundingTx(throwaway, FUND), outputIndex: 0 },
  changeAddress: posterAddr,                                       // change (out4) → poster, not the throwaway
  mark: 'gm from a walled garden 🐇',
})
const lock3 = buildLiveCounterLock({ n: 3, lastFunderHash: posterHash, authorHash: dH })
check('send-to-post covenant input validates', validateInput(stp, 0, lock2, V))
check('send-to-post out0 refund routed to poster', arrEq(stp.outputs[0].lockingScript.toBinary(), lock3.toBinary()))
check('send-to-post change → poster (not throwaway)',
  arrEq(stp.outputs[4].lockingScript.toBinary(), p2pkhScript(posterHash)) &&
  !arrEq(stp.outputs[4].lockingScript.toBinary(), p2pkhScript(keyHash160(throwaway))))

// dumps for the tip.php byte-parser cross-check (tick1: n should read as 1, mark 'wagmi 🐇')
console.log('DUMP_COUNTER ' + tick1.outputs[0].lockingScript.toHex())
console.log('DUMP_MARK ' + tick1.outputs[3].lockingScript.toHex())
console.log('DUMP_FUNDER ' + Buffer.from(s1H).toString('hex'))

console.log(`\n${pass}/${pass + fail} checks passed  ·  genesis fee≈${FUND - (genesis.outputs.at(-1)?.satoshis ?? 0)} sat`)
if (fail > 0) { console.error('LC TX: FAIL'); process.exit(1) }
console.log('LC TX OK — real genesis→tick→tick assembled + interpreter-valid')
