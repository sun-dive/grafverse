// © 2026 sun-dive — Apache License 2.0.
/**
 * ⚠⚠⚠ THE ISOLATION GUARD. `src/oxoSeatFrame.ts` is a FORK of `src/basicCovenant.ts`, made because the
 * shared frame is imported by `grafbasic.ts` and therefore lives in the bundle `basic.html` loads.
 *
 * ★ The cost of a fork is that the two can drift apart in silence. This is what stops that:
 *
 *   **with every switch OFF, the fork MUST emit bytes identical to `buildBasicLock`.**
 *
 * ⇒ Same shape as `test/racer-physics.ts`, which sweeps 480 states and requires the copied physics to
 *   equal the original with its new switches off. A byte comparison is the only version of this claim
 *   that cannot rot: it does not care WHY they differ, only that they do not.
 *
 * ⚠ And it runs against several different programs and states, not one — a single sample would pass
 *   for a fork that had broken only the multi-field or the odd-field path.
 */
import { Spend, Transaction, UnlockingScript, OP, type ScriptChunk } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import { buildOxoSeatLock, extractLockTimeOps, extractSequenceBytesOps,
         requireNonFinalOps } from '../src/oxoSeatFrame.ts'
import { pushTxPreimage } from '../src/pushtx.ts'
import { OXOLOOP_SRC, OXOLOOP_INPUTS, loopNew, loopRef, type LoopState } from '../src/oxoLoop.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n═══ the fork must be indistinguishable while its switches are off ═══\n')

/* ── 1 · byte-identity across several programs and several states ──────────────────────────────── */
const rec = (s: LoopState) => ({ ...s }) as unknown as Record<string, number>

/**
 * a two-field program (even layout) and a three-field one (odd) — the DROP pairing differs.
 * ⚠⚠ A `%n` FIELD IS SIGNED AND SYMMETRIC: ±(2^(8n−1) − 1). So `%1` is ±127, not 0..255, and `%2` is
 * ±32767 with NO −32768 — Script numbers are sign-magnitude, not two's complement. Three separate
 * attempts to seed this table were refused by the compiler for exactly that, which is the guard doing
 * its job: **truncating silently is how a covenant comes to disagree with itself.**
 */
const TINY_EVEN = `
DIM a%2
DIM b%1
a = a + n
b = 3 - b
`
const TINY_ODD = `
DIM a%2
DIM b%1
DIM c%1
a = a + n
b = 3 - b
c = c + 1
`

const cases: { name: string; src: string; inputs: string[]; states: Record<string, number>[] }[] = [
  { name: 'oxoLoop · fresh board', src: OXOLOOP_SRC, inputs: OXOLOOP_INPUTS, states: [rec(loopNew())] },
  { name: 'oxoLoop · mid game', src: OXOLOOP_SRC, inputs: OXOLOOP_INPUTS,
    states: [rec(loopRef(loopRef(loopNew(), 4), 0))] },
  { name: 'oxoLoop · a finished game', src: OXOLOOP_SRC, inputs: OXOLOOP_INPUTS,
    states: [rec([0, 1, 2, 3, 4, 5, 6].reduce((s, i) => { try { return loopRef(s, i) } catch { return s } }, loopNew()))] },
  { name: 'two fields (even layout)', src: TINY_EVEN, inputs: ['n'],
    states: [{ a: 0, b: 1 }, { a: 32_767, b: 2 }, { a: -32_767, b: 2 }] },
  { name: 'three fields (odd layout)', src: TINY_ODD, inputs: ['n'],
    states: [{ a: 0, b: 1, c: 0 }, { a: 1234, b: 2, c: 127 }, { a: -1, b: 1, c: -127 }] },
]

for (const c of cases) {
  for (const state of c.states) {
    const maxFee = frameMaxFee({ src: c.src, state, maxFee: 0, inputs: c.inputs, spenderOutputs: [] }).fee
    const original = buildBasicLock({ src: c.src, state, maxFee, inputs: c.inputs }).toHex()
    const fork = buildOxoSeatLock({ src: c.src, state, maxFee, inputs: c.inputs }).toHex()
    ok(`${c.name} — identical (${original.length / 2} B)`, original === fork,
       original.length !== fork.length
         ? `lengths differ: ${original.length / 2} vs ${fork.length / 2}`
         : `first difference at byte ${[...original].findIndex((ch, i) => ch !== fork[i]) >> 1}`)
  }
}

/* ── 2 · and the fork's script still actually RUNS ──────────────────────────────────────────────── */
console.log('\n═══ and it is a working covenant, not merely matching bytes ═══\n')
{
  const SATS = 200_000
  const from = loopNew()
  const maxFee = frameMaxFee({
    src: OXOLOOP_SRC, state: rec(from), maxFee: 0, inputs: OXOLOOP_INPUTS, spenderOutputs: [],
  }).fee
  const lock = (s: LoopState) =>
    buildOxoSeatLock({ src: OXOLOOP_SRC, state: rec(s), maxFee, inputs: OXOLOOP_INPUTS })

  const parent = new Transaction(); parent.version = 2
  parent.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0,
                    unlockingScript: new UnlockingScript([]), sequence: 0xffffffff })
  parent.addOutput({ lockingScript: lock(from), satoshis: SATS })

  const to = loopRef(from, 4)
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, sequence: 0xffffffff })
  tx.addOutput({ lockingScript: lock(to), satoshis: SATS - maxFee })
  const preimage = pushTxPreimage({
    sourceTXID: parent.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS,
    transactionVersion: 2, inputIndex: 0, subscript: parent.outputs[0].lockingScript,
    outputs: tx.outputs, inputSequence: 0xffffffff, lockTime: 0,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(basicUnlockingOps({
    inputs: [4], spenderOutputs: [], newValue: valueBytes(SATS - maxFee), preimage,
  }))
  let verdict = 'threw'
  try {
    verdict = new Spend({
      sourceTXID: parent.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS,
      lockingScript: parent.outputs[0].lockingScript, transactionVersion: 2, otherInputs: [],
      outputs: tx.outputs, inputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript,
      inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true ? 'valid' : 'invalid'
  } catch (e) { verdict = (e as Error).message.slice(0, 70) }
  ok('a move through the forked frame validates', verdict === 'valid', verdict)
}

/* ── 3 · the extractors read the right distance from the end ────────────────────────────────────── */
console.log('\n═══ the clock fields come from where BIP143 puts them ═══\n')
{
  /* ⚠ Asserting the SHAPE, because a wrong offset reads a neighbouring field and every downstream
     comparison then runs on nonsense AND PASSES — the depot's exact failure. */
  const at = (ops: ScriptChunk[], i: number) => (ops[i] as { data?: number[] }).data?.[0]
  const lt = extractLockTimeOps(), sq = extractSequenceBytesOps(), nf = requireNonFinalOps()
  ok('nLockTime is 8 from the end', at(lt, 1) === 8, String(at(lt, 1)))
  ok('nSequence is 44 from the end', at(sq, 1) === 44, String(at(sq, 1)))
  ok('both are 4 bytes wide', at(lt, 5) === 4 && at(sq, 5) === 4)
  ok('the tail layout makes 44 true', 44 === 4 + 32 + 4 + 4)

  /* ★★ THE 2038 GUARD. A 4-byte lock time turns NEGATIVE once its top byte reaches 0x80, so the frame
     widens it to five before BIN2NUM. Assert the widening is actually there. */
  const widened = lt.some((c, i) =>
    (c as { data?: number[] }).data?.length === 1 && (c as { data?: number[] }).data?.[0] === 0 &&
    (lt[i + 1] as { op?: number }).op === OP.OP_CAT)
  ok('★ the lock time is widened to 5 bytes before BIN2NUM (the 2038 guard)', widened)
  ok('and BIN2NUM comes after the widening',
     (lt[lt.length - 1] as { op?: number }).op === OP.OP_BIN2NUM)

  /* ⚠⚠ THE SEQUENCE IS NEVER TURNED INTO A NUMBER. Measured: ffffffff → −2147483647 and
     fffffffe → −2147483646, so `ffffffff < fffffffe` is TRUE and every ordering test inverts. */
  ok('⚠ the sequence extractor does NOT call BIN2NUM',
     !sq.some(c => (c as { op?: number }).op === OP.OP_BIN2NUM))
  ok('and non-final is an EQUALity test against ffffffff, then NOT',
     nf.some(c => { const d = (c as { data?: number[] }).data
                    return d?.length === 4 && d.every(x => x === 0xff) }) &&
     nf.some(c => (c as { op?: number }).op === OP.OP_EQUAL) &&
     nf.some(c => (c as { op?: number }).op === OP.OP_NOT))

  /* the sign-magnitude reading itself, so the claim above is checked and not just asserted in prose */
  const dec = (b: number[]) => {
    let r = 0n
    for (let i = 0; i < b.length; i++) r |= BigInt(b[i]) << BigInt(8 * i)
    const sign = 1n << BigInt(8 * b.length - 1)
    return (r & sign) ? -Number(r & (sign - 1n)) : Number(r)
  }
  ok('ffffffff reads as −2147483647', dec([0xff, 0xff, 0xff, 0xff]) === -2147483647)
  ok('⚠ and so ffffffff < fffffffe is TRUE — why bytes, not numbers',
     dec([0xff, 0xff, 0xff, 0xff]) < dec([0xfe, 0xff, 0xff, 0xff]))
  ok('★ widened to 5 bytes, a 2038-era time stays positive',
     dec([0x00, 0x00, 0x00, 0x80, 0x00]) === 2147483648)
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
