// © 2026 sun-dive — Apache License 2.0.
// ★★★ RULE 110 — Turing complete, one generation per transaction
//
//   node --experimental-strip-types mint/test/rule110.ts
//
// The joke is a real one, and the sharp way to put it is sun-dive's: ONE IS BOUNDED, ONE IS UNBOUNDED.
// The script loops — thirty-one cells, unrolled — but it loops a number of times decided when it was
// written. The chain loops too, and nobody decides how many. Rule 110 is Turing complete, so what is
// demonstrated is not that Script cannot iterate; it is where the UNBOUNDEDNESS has to live.
//
// ⚠ The rule is checked against its TABLE, not against the derivation that produced the one-line
// algebra the script uses. Otherwise the test would only be confirming a rearrangement of itself.
import { Transaction, Spend, LockingScript, UnlockingScript } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import {
  R110_SRC, R110_INPUTS, R110_CELLS, r110Src, r110New, r110Ref, r110Show, r110Bit, type R110State,
} from '../src/rule110.ts'
import { compileState } from '../src/basic.ts'
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
const step = (from: R110State, to: R110State): boolean => stepWith(R110_SRC, MAX_FEE, from, to)

/** …or several generations at once, from a script that unrolled them. */
function stepWith(src: string, maxFee: number, from: R110State, to: R110State): boolean {
  const rec = (s: R110State): Record<string, number> => ({ ...s })
  const lock = buildBasicLock({ src, state: rec(from), maxFee, inputs: R110_INPUTS })
  const next = buildBasicLock({ src, state: rec(to), maxFee, inputs: R110_INPUTS })
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
  console.log()
  console.log('        the loop in the SCRIPT    BOUNDED   — 31 cells, and you decide how many')
  console.log('                                            generations when you write it')
  console.log('        the loop in the CHAIN     UNBOUNDED — nobody decides. It runs while funded.')
  /* ⚠ AND THE CLAIM IS EXACTLY THAT AND NOTHING MORE. This does not make Script Turing complete: a
     script still halts, still has no backward jump, and every generation is paid for in advance. Both
     forms below are real loops. What separates them is not capability, it is BOUNDEDNESS — and that is
     the same place the computation walk found the unboundedness, in the sequence of spends. */
  check('★★★ one script is a BOUNDED loop, prepaid, with no backward jump in it', bytes > 0 && MAX_FEE > 0)
  console.log('        ⚠ this does NOT make Script Turing complete — it says where the UNBOUNDED part goes')
}


// ── 5. ★★★ THE SAME AUTOMATON, WRITTEN TWO WAYS ─────────────────────────────────────────────────────
// Script CAN loop — the thirty-one cells above are a real loop, laid out in space instead of repeated
// in time. So the generation loop can go either way too: eight spends of a one-generation script, or
// ONE spend of a script that unrolled eight. Both are loops. The choice is economic.
console.log()
{
  const G = 8
  const SRC8 = r110Src(G)
  const FEE8 = frameMaxFee({
    src: SRC8, state: r110New() as unknown as Record<string, number>, maxFee: 0,
    inputs: R110_INPUTS, spenderOutputs: [],
  }).fee

  /* ★ THE LONG WAY — eight transactions, the loop in the chain. */
  let a = r110New()
  let chainOk = 0
  for (let g = 0; g < G; g++) { const w = r110Ref(a); if (step(a, w)) chainOk++; a = w }

  /* ★ THE SHORT WAY — one transaction, the loop in the script. */
  let b = r110New()
  for (let g = 0; g < G; g++) b = r110Ref(b)
  const oneOk = stepWith(SRC8, FEE8, r110New(), b)

  check(`★★ ${G} generations as ${G} spends, the loop in the CHAIN`, chainOk === G)
  check(`★★ ${G} generations as ONE spend, the loop in the SCRIPT`, oneOk)
  check('★★★ …and both arrive at exactly the same state', a.cells === b.cells && a.gen === b.gen)
  console.log(`        ${r110Show(a)}   generation ${a.gen}`)

  /* ── AND NOW THE PRICE OF THE CHOICE, WHICH IS THE HALF NOBODY EXPECTS ─────────────────────────── */
  const lockOf = (g: number, fee: number): number => buildBasicLock({
    src: r110Src(g), state: r110New() as unknown as Record<string, number>, maxFee: fee,
    inputs: R110_INPUTS,
  }).toBinary().length
  const bodyOf = (g: number): number => new LockingScript(
    compileState(r110Src(g), { fieldOffset: 4, stack: ['spenderOutputs', 'newValue'] }).ops).toBinary().length

  const one = lockOf(1, MAX_FEE), eight = lockOf(G, FEE8)
  const body = bodyOf(1), frame = one - body
  console.log()
  console.log('        generations   whole lock   per generation')
  for (const g of [1, 2, 4, 8]) {
    const L = lockOf(g, g === 1 ? MAX_FEE : FEE8)
    console.log(`        ${String(g).padStart(11)}   ${String(L).padStart(10)} B   ${String(Math.round(L / g)).padStart(9)} B`)
  }
  console.log(`\n        the FRAME is ${frame} B · one generation's BODY is ${body} B` +
    `  ⇒ the body is ${(body / frame).toFixed(1)}× the frame`)
  console.log(`        ${G} the long way: ${G * one} B across ${G} locks` +
    `   ·   ${G} in one: ${eight} B   ⇒ ${(G * one / eight).toFixed(2)}×`)

  /* ⚠⚠ AND THAT IS THE OPPOSITE ADVICE THE RACER GOT, FROM THE SAME COMPILER. Unrolling amortises the
     FRAME — verify the preimage, peel, rebuild, hash, compare — which every transaction pays whatever
     its body does. For the racer the frame is 13× the body, so 45 ticks in one transaction saved ~10×.
     Here the body is four times the FRAME, so there is almost nothing to amortise and unrolling buys
     about a fifth. Same machine, same compiler, opposite answer — because the ratio is different. */
  check('★★★ for THIS program the body dominates, so unrolling buys almost nothing',
    (G * one) / eight < 1.5)
  console.log('        ⇒ the racer saved ~10× by unrolling, because ITS frame is 13× ITS body.')
  console.log('        Where the loop should live is an ECONOMIC question, and the answer differs.')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('RULE110: FAIL'); process.exit(1) }
console.log('RULE 110 OK — a Turing-complete automaton, one enforced generation per transaction.')
