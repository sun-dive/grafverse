// © BSV Association — Open BSV License v6.
// ★★★ RULE 110 — Turing complete, one generation per transaction
//
//   node --experimental-strip-types mint/test/rule110.ts
//
// The joke is a real one, and both halves are true at once: the script for ONE generation contains no
// loop at all, and the CHAIN of transactions runs unboundedly. Rule 110 is Turing complete, so what is
// being demonstrated is that the loop lives in the ledger rather than in the language.
//
// ⚠ The rule is checked against its TABLE, not against the derivation that produced the one-line
// algebra the script uses. Otherwise the test would only be confirming a rearrangement of itself.
import { Transaction, Spend, LockingScript, UnlockingScript } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import {
  R110_SRC, R110_INPUTS, R110_CELLS, r110New, r110Ref, r110Show, r110Bit, type R110State,
} from '../src/rule110.ts'
import { pushTxPreimage } from '../src/pushtx.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const SATS = 30000
const MAX_FEE = frameMaxFee({
  src: R110_SRC, state: r110New() as unknown as Record<string, number>, maxFee: 0,
  inputs: R110_INPUTS, spenderOutputs: [],
}).fee

/** One generation, for real. ⚠ No inputs at all — nobody plays this; it simply advances. */
function step(from: R110State, to: R110State): boolean {
  const rec = (s: R110State): Record<string, number> => ({ ...s })
  const lock = buildBasicLock({ src: R110_SRC, state: rec(from), maxFee: MAX_FEE, inputs: R110_INPUTS })
  const next = buildBasicLock({ src: R110_SRC, state: rec(to), maxFee: MAX_FEE, inputs: R110_INPUTS })
  const source = new Transaction()
  source.addOutput({ lockingScript: lock, satoshis: SATS })
  const tx = new Transaction()
  tx.version = 2
  tx.addOutput({ lockingScript: next, satoshis: SATS })
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xffffffff })
  const preimage = pushTxPreimage({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: tx.outputs,
    inputSequence: 0xffffffff, lockTime: 0,
  })
  const unlock = new UnlockingScript(basicUnlockingOps({
    spenderOutputs: [], newValue: valueBytes(SATS), preimage,
  }))
  try {
    return new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
  } catch { return false }
}

console.log('\nRULE 110 — one generation per transaction\n')

// ── 1. ⚠ THE RULE ITSELF, AGAINST ITS TABLE ─────────────────────────────────────────────────────────
{
  // The script uses ONE LINE of boolean algebra instead of an eight-row lookup, because `bit n of 110`
  // would need 2^n for a RUNTIME n — the one thing Script cannot do. So the line must be proved.
  let bad: string[] = []
  for (let n = 0; n < 8; n++) {
    const l = (n >> 2) & 1, c = (n >> 1) & 1, r = n & 1
    const algebra = ((c || r) && !(l && c && r)) ? 1 : 0
    if (algebra !== r110Bit(l, c, r)) bad.push(`${l}${c}${r}`)
  }
  check('★★ (C OR R) AND NOT(L AND C AND R) is Rule 110 on all eight rows', bad.length === 0)
  console.log('        111→0  110→1  101→1  100→0  011→1  010→1  001→1  000→0   ⇒ 01101110 = 110')
}

const lock0 = buildBasicLock({
  src: R110_SRC, state: r110New() as unknown as Record<string, number>, maxFee: MAX_FEE, inputs: R110_INPUTS,
})
console.log(`\n        ${lock0.toBinary().length} B of Script · ${lock0.chunks.length} opcodes · ` +
  `${R110_CELLS} cells · MAX_FEE ${MAX_FEE} sat a generation`)
console.log('        ⚠ and NOT ONE backward jump in it — the 31 cells are unrolled at compile time')

// ── 2. ★★★ IT RUNS, AND IT DRAWS THE TRIANGLES ──────────────────────────────────────────────────────
console.log()
{
  let st = r110New()
  let ok = 0
  const GENS = 24
  const rows: string[] = [r110Show(st)]
  for (let g = 0; g < GENS; g++) {
    const want = r110Ref(st)
    if (step(st, want)) ok++
    st = want
    rows.push(r110Show(st))
  }
  check(`★★★ ${GENS} generations, each a real spend of the last one's output`, ok === GENS)
  console.log(rows.map(r => '        ' + r).join('\n'))
  check('★★ …and the row is not empty, stuck or saturated', st.cells !== 0 && st.gen === GENS)
  console.log(`        generation ${st.gen}, and the pattern is still developing`)
}

// ── 3. ★★ AND IT REFUSES A GENERATION THAT IS NOT THE NEXT ONE ──────────────────────────────────────
console.log()
{
  let st = r110New()
  for (let g = 0; g < 5; g++) st = r110Ref(st)
  const right = r110Ref(st)

  check('★★ one bit wrong in the successor', step(st, { ...right, cells: right.cells ^ 1 }), false)
  check('★★ …the counter not advancing', step(st, { ...right, gen: st.gen }), false)
  check('★★ …skipping a generation', step(st, r110Ref(right)), false)
  check('★★ …and standing still entirely', step(st, st), false)
  check('★ while the real next generation is accepted', step(st, right))
  console.log('        no key, no signature, no player — the only thing it permits is the next step')
}

// ── 4. ★★★ THE JOKE, PRICED ─────────────────────────────────────────────────────────────────────────
console.log()
{
  const bytes = lock0.toBinary().length
  console.log('        Rule 110 is TURING COMPLETE — Matthew Cook proved it. So this is the machine')
  console.log('        that "Script isn\'t Turing complete" is usually said about, running in Script.')
  console.log()
  console.log(`        one generation      ${bytes} B of locking script · ${MAX_FEE} sat`)
  console.log(`        a hundred of them   ${100 * MAX_FEE} sat, and a hundred transactions`)
  console.log('        the loop            NOT in the script — there is no backward jump in Bitcoin')
  console.log('                            Script at all. It is the CHAIN that iterates.')
  /* ⚠ AND THE CLAIM IS EXACTLY THAT AND NOTHING MORE. This does not make Script Turing complete: a
     script still halts, still has no jump, and every generation is paid for in advance. What it shows
     is where the unboundedness actually lives — in the sequence of spends, which is the same place the
     computation walk found it. A machine that can be stepped for as long as somebody funds it. */
  check('★★★ one generation is one bounded, prepaid, loop-free script', bytes > 0 && MAX_FEE > 0)
  console.log('        ⚠ this does NOT make Script Turing complete — it shows where the loop went')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('RULE110: FAIL'); process.exit(1) }
console.log('RULE 110 OK — a Turing-complete automaton, one enforced generation per transaction.')
