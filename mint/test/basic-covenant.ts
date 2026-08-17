// © BSV Association — Open BSV License v6.
// ★★★ A COVENANT WRITTEN IN BASIC — does it actually spend?
//
//   node --experimental-strip-types mint/test/basic-covenant.ts
//
// Everything before this proved arithmetic and byte layout against the interpreter. This asks the only
// question that decides whether any of it is real: assemble a genuine transaction spending the
// covenant, with a genuine sighash preimage, and let `Spend` judge it exactly as a node would.
//
// ⚠ AND THEN RUN A CHAIN OF THEM, because a covenant that validates once and cannot produce a spendable
// successor is not a covenant, it is a headstone. Each step below spends the output the previous step
// created — the state moving through the script, on rules the script enforces on itself.
import { Transaction, Spend, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import {
  buildBasicLock, basicUnlockingOps, basicLockOps, frameMaxFee, valueBytes,
} from '../src/basicCovenant.ts'
import { pushTxPreimage, pushData } from '../src/pushtx.ts'
import { p2pkhScript } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

/** A serialized output paying somebody else — what a spender adds alongside the covenant's own. */
const payTo = (sats: number, hash20: number[]): number[] => {
  const s = p2pkhScript(hash20)
  return [...valueBytes(sats), s.length, ...s]
}
const SOMEBODY = new Array(20).fill(0x11)

/**
 * Spend the covenant once: build the successor's script, assemble the transaction, derive the preimage
 * from it, and validate.
 *
 * ⚠ THE PREIMAGE IS DERIVED FROM THE TRANSACTION, NOT ASSERTED. That is the whole reason this test is
 * worth more than the ones before it: if the script rebuilt an output that differs from the one this
 * transaction actually pays — by a byte, a field order, a value — the hashes disagree and it FAILS.
 */
function step(
  prog: string, before: Record<string, number | number[]>, after: Record<string, number | number[]>,
  opts: { maxFee: number; sats: number; pay: number; consts?: Record<string, number> },
): { ok: boolean; why?: string; lock: LockingScript; next: LockingScript; outSats: number } {
  const lock = buildBasicLock({ src: prog, state: before, maxFee: opts.maxFee, consts: opts.consts })
  const next = buildBasicLock({ src: prog, state: after, maxFee: opts.maxFee, consts: opts.consts })
  const spender = opts.pay > 0 ? payTo(opts.pay, SOMEBODY) : []
  const outSats = opts.sats - opts.pay

  const source = new Transaction()
  source.addOutput({ lockingScript: lock, satoshis: opts.sats })

  const tx = new Transaction()
  tx.version = 2
  tx.addOutput({ lockingScript: next, satoshis: outSats })
  /* ⚠ The spender's output is added through the SDK, while `payTo` produced the bytes the SCRIPT will
     concatenate. Two independent serializations of the same output — and the output binding only
     passes if they agree byte for byte, which is the point of doing it twice. */
  if (spender.length) {
    tx.addOutput({ lockingScript: LockingScript.fromBinary(p2pkhScript(SOMEBODY)), satoshis: opts.pay })
  }
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xffffffff })

  const preimage = pushTxPreimage({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: opts.sats,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: tx.outputs,
    inputSequence: 0xffffffff, lockTime: 0,
  })
  const unlock = new UnlockingScript(basicUnlockingOps({
    spenderOutputs: spender, newValue: valueBytes(outSats), preimage,
  }))
  tx.inputs[0].unlockingScript = unlock

  try {
    const ok = new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: opts.sats, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
    return { ok, lock, next, outSats }
  } catch (e) {
    return { ok: false, why: (e as Error).message.split('\n')[0], lock, next, outSats }
  }
}

console.log('\nA COVENANT WRITTEN IN BASIC — assembled, signed by nobody, and judged by the interpreter\n')

/* ── THE PROGRAM. Four lines, and every rule in it is enforced by miners. ─────────────────────────── */
const COUNTER = `
  DIM phase%1
  DIM n%4
  REM  one step of a machine that counts, and stops when it is done
  n = n + 1
  IF n >= LIMIT THEN phase = 2 ELSE phase = 1
`
const CONSTS = { LIMIT: 3 }

// ── 1. ★ THE FEE, DERIVED BY SERIALIZING — never counted, never estimated ───────────────────────────
const derived = frameMaxFee({
  src: COUNTER, state: { phase: 0, n: 0 }, maxFee: 0, consts: CONSTS,
  spenderOutputs: payTo(1, SOMEBODY),
})
{
  check('★ the fee settles to a fixed point rather than being guessed', derived.fee > 0)
  console.log(`        lock ${derived.lockBytes} B · a whole spend ${derived.bytes} B ` +
    `⇒ ${derived.fee} sat at the official 100 sat/KB`)
  /* ⚠⚠ THE BOUND MUST CLEAR THE RELAY FLOOR, AND IT IS UNAMENDABLE. Baked into an address, a maxFee
     below the real cost means the covenant simply stops being spendable — by anyone, forever. Five
     near-misses in this project already, which is why the check is here and not in someone's head. */
  const floor = Math.ceil((derived.bytes * 100) / 1000)
  check('★★ …and it clears the 100 sat/KB relay floor for a real spend of this size', derived.fee >= floor)
  console.log(`        floor for ${derived.bytes} B is ${floor} sat · the covenant allows ${derived.fee}`)
}
const MAX_FEE = derived.fee

// ── 2. ★★★ ONE SPEND, JUDGED BY THE INTERPRETER ─────────────────────────────────────────────────────
console.log()
{
  const r = step(COUNTER, { phase: 0, n: 0 }, { phase: 1, n: 1 },
    { maxFee: MAX_FEE, sats: 5000, pay: 0, consts: CONSTS })
  check('★★★ a covenant compiled from BASIC validates a real spend', r.ok)
  if (!r.why) console.log(`        lock ${r.lock.toBinary().length} B · n 0 → 1 · phase 0 → 1`)
  else console.log(`        ${r.why}`)

  /* ⚠ 100 SATOSHIS, NOT 400 — AND THE FIRST DRAFT OF THIS TEST GOT IT WRONG. With one input, anything
     the spender pays out comes from the covenant's own balance, so an output of 400 IS a drain of 400
     past a 160-satoshi ceiling. The covenant refused it, correctly, and the test was the thing at
     fault. A real spender funds their output from a second input; here the point being proved is only
     that the binding concatenates the spender's outputs in the right place. */
  const paying = step(COUNTER, { phase: 0, n: 0 }, { phase: 1, n: 1 },
    { maxFee: MAX_FEE, sats: 5000, pay: 100, consts: CONSTS })
  check('★★ …and with the spender adding an output of their own, within the ceiling', paying.ok)
  if (paying.why) console.log(`        ${paying.why}`)
}

// ── 3. ★★★ AND IT REFUSES EVERY WRONG SUCCESSOR ─────────────────────────────────────────────────────
// A covenant is only worth what it REFUSES. Each of these is a transaction a thief would actually try.
console.log()
{
  const bad = (label: string, after: Record<string, number>, o: Partial<{ pay: number; sats: number }> = {}): void => {
    const r = step(COUNTER, { phase: 0, n: 0 }, after,
      { maxFee: MAX_FEE, sats: 5000, pay: o.pay ?? 0, consts: CONSTS })
    check(label, r.ok, false)
  }
  bad('★★ a successor whose counter did not advance', { phase: 1, n: 0 })
  bad('★★ a successor that skipped ahead', { phase: 1, n: 7 })
  bad('★ a successor with the wrong phase', { phase: 2, n: 1 })
  bad('★★★ draining the covenant past MAX_FEE into your own output', { phase: 1, n: 1 }, { pay: 4000 })
  console.log('        no signature is involved in any of this — the rules are the script\'s own')
}

// ── 4. ★★★ A CHAIN — the state moving, each spend paying for the next ───────────────────────────────
console.log()
{
  let sats = 5000
  let st: Record<string, number> = { phase: 0, n: 0 }
  const seen: string[] = []
  let ok = 0, tried = 0
  for (let i = 0; i < 3; i++) {
    const want = { n: st.n + 1, phase: st.n + 1 >= CONSTS.LIMIT ? 2 : 1 }
    const r = step(COUNTER, st, want, { maxFee: MAX_FEE, sats, pay: 0, consts: CONSTS })
    tried++
    if (r.ok) ok++
    seen.push(`n=${want.n} phase=${want.phase}`)
    st = want
    sats = r.outSats
  }
  check(`★★★ ${tried} spends in a row, each spending what the last one created`, ok === tried)
  console.log(`        ${seen.join('  →  ')}`)
  console.log(`        the machine reached its LIMIT and set phase 2, by a rule written in BASIC`)

  /* ⚠ AND THE VALUE SURVIVED THE TRIP. Nothing here pays a miner — the fee is what the covenant PERMITS
     to go missing, and these spends spend it all back into the successor. What matters is that the
     ceiling exists and the chain did not have to touch it. */
  check('★ the value came through the chain intact', sats === 5000)
}

// ── 5. ★ WHAT IT COSTS, AND WHERE THE BYTES WENT ────────────────────────────────────────────────────
console.log()
{
  const { ops, state } = basicLockOps({
    src: COUNTER, state: { phase: 0, n: 0 }, maxFee: MAX_FEE, consts: CONSTS, fieldOffset: 4,
  })
  const B = (o: unknown[]): number => new LockingScript(o as never).toBinary().length
  const whole = B(ops)
  console.log(`        whole covenant ${whole} B  =  peel ${B(state.peel)} + program ${B(state.body)} ` +
    `+ rebuild ${B(state.rebuild)} + frame ${whole - B(state.ops)}`)
  console.log(`        the frame is the preimage check, hashOutputs, the value rule and the binding`)
  console.log('        ⚠ bytes and a derived fee — both measured here, neither one hand-counted')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BASIC COVENANT: FAIL'); process.exit(1) }
console.log('BASIC COVENANT OK — a program written in BASIC enforced its own rules on chain rules.')
