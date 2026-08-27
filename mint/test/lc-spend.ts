// © 2026 sun-dive — Apache License 2.0.
// BRC-226 LiveCounter — Spend-interpreter proof: a real tick validates, tampered ticks are rejected.
import { LockingScript, UnlockingScript, Spend, OP } from '@bsv/sdk'
import { buildLiveCounterLock, tickUnlockingOps, LIVECOUNTER_SCOPE } from '../src/liveCounter.ts'
import { serializeOutput, p2pkhScript } from '../src/covenant.ts'
import { pushTxPreimage } from '../src/pushtx.ts'

const fill = (b: number): number[] => new Array(20).fill(b)
const AUTHOR = fill(0xa1), GEN_FUNDER = fill(0x6f), NEW_FUNDER = fill(0x9e), CHANGE = fill(0xc4)
const V = 1, DEPOSIT = 1000, MARKFEE = 1, CHANGEVAL = 5000
const SEQ = 0xffffffff

type Out = { satoshis: number; lockingScript: LockingScript }
const p2pkhOut = (sats: number, h: number[]): Out => ({ satoshis: sats, lockingScript: LockingScript.fromBinary(p2pkhScript(h)) })
const markScriptBytes = (mark: number[]): number[] => [OP.OP_FALSE, OP.OP_RETURN, mark.length, ...mark]

/** Build a tick spend of `prevLock`@(n) and run it through the Spend interpreter. Returns true if valid. */
function runTick(opts: {
  n: number
  oldFunder: number[]          // lastFunder embedded in prevLock (repaid)
  newFunder: number[]          // this signer (embedded in nextLock + pushed in unlock)
  mark: number[]
  // tamper hooks (for negative tests) — mutate the OUTPUTS the tx actually carries:
  badNextN?: number            // build out0's next-lock with this n instead of n+1
  dropDeposit?: boolean        // omit out1 (skip the repayment)
  badCrumbAuthor?: number[]    // pay the crumb to someone else
}): boolean {
  const prevLock = buildLiveCounterLock({ n: opts.n, lastFunderHash: opts.oldFunder, authorHash: AUTHOR })
  const nextLock = buildLiveCounterLock({ n: opts.badNextN ?? opts.n + 1, lastFunderHash: opts.newFunder, authorHash: AUTHOR })

  const out0: Out = { satoshis: V, lockingScript: nextLock }
  const out1: Out = p2pkhOut(DEPOSIT, opts.oldFunder)
  const out2: Out = p2pkhOut(MARKFEE, opts.badCrumbAuthor ?? AUTHOR)
  const out3: Out = { satoshis: 0, lockingScript: LockingScript.fromBinary(markScriptBytes(opts.mark)) }
  const out4: Out = p2pkhOut(CHANGEVAL, CHANGE)
  const outputs: Out[] = opts.dropDeposit ? [out0, out2, out3, out4] : [out0, out1, out2, out3, out4]

  const genesisTxid = 'ab'.repeat(32)
  const otherInputs = [{ sourceTXID: 'cd'.repeat(32), sourceOutputIndex: 0, sequence: SEQ }]

  const preimage = pushTxPreimage({
    sourceTXID: genesisTxid, sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    inputIndex: 0, subscript: prevLock, outputs, inputSequence: SEQ, lockTime: 0,
    otherInputs, scope: LIVECOUNTER_SCOPE,
  })
  // spenderOutputs = the signer's trailing outputs (mark ‖ change), verbatim, as the covenant appends them
  const spenderOutputs = [
    ...serializeOutput(0, markScriptBytes(opts.mark)),
    ...serializeOutput(CHANGEVAL, p2pkhScript(CHANGE)),
  ]
  const unlock = new UnlockingScript(tickUnlockingOps({ spenderOutputs, newFunderHash: opts.newFunder, preimage }))

  const spend = new Spend({
    sourceTXID: genesisTxid, sourceOutputIndex: 0, sourceSatoshis: V, lockingScript: prevLock,
    transactionVersion: 2, otherInputs, outputs, inputIndex: 0, unlockingScript: unlock,
    inputSequence: SEQ, lockTime: 0,
  })
  try { return spend.validate() === true } catch { return false }
}

const enc = (s: string): number[] => Array.from(new TextEncoder().encode(s))
let pass = 0, fail = 0
const check = (name: string, got: boolean, want: boolean) => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, want ${want})`)
  ok ? pass++ : fail++
}

// ── positive: mint→tick→tick ───────────────────────────────────────────────
check('tick 0→1 validates',           runTick({ n: 0, oldFunder: GEN_FUNDER, newFunder: NEW_FUNDER, mark: enc('gm 888') }), true)
check('tick 1→2 validates',           runTick({ n: 1, oldFunder: NEW_FUNDER, newFunder: fill(0x33), mark: enc('wagmi') }), true)
check('tick 41→42 validates',         runTick({ n: 41, oldFunder: GEN_FUNDER, newFunder: NEW_FUNDER, mark: enc('') }), true)

// ── negative: tampered ticks must be REJECTED ──────────────────────────────
check('wrong next n (skip to 2)',     runTick({ n: 0, oldFunder: GEN_FUNDER, newFunder: NEW_FUNDER, mark: enc('x'), badNextN: 2 }), false)
check('no increment (n stays 0)',     runTick({ n: 0, oldFunder: GEN_FUNDER, newFunder: NEW_FUNDER, mark: enc('x'), badNextN: 0 }), false)
check('skipped repayment (no out1)',  runTick({ n: 0, oldFunder: GEN_FUNDER, newFunder: NEW_FUNDER, mark: enc('x'), dropDeposit: true }), false)
check('crumb to wrong author',        runTick({ n: 0, oldFunder: GEN_FUNDER, newFunder: NEW_FUNDER, mark: enc('x'), badCrumbAuthor: fill(0xff) }), false)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('LC SPEND: FAIL'); process.exit(1) }
console.log('LC SPEND OK')
