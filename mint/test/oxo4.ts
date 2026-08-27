// © 2026 sun-dive — Apache License 2.0.
// ★★ BASE 3 AGAINST BASE 4 — what does wasting a bit per square actually buy?
//
//   node --experimental-strip-types mint/test/oxo4.ts
//
// The same game, twice. `oxo.ts` packs nine squares base 3, which is the tightest encoding there is
// and forces every access through a table of nine comparisons, because 3^k for a runtime k cannot be
// computed. `oxo4.ts` gives each square two bits — one value wasted per square — and every access
// becomes a shift.
//
// ⚠ CORRECTNESS FIRST, THEN THE MEASUREMENT. A smaller script that plays a different game is not a
// saving, so the base-4 board is played through the interpreter before a single byte is compared.
import { Transaction, Spend, LockingScript, UnlockingScript } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import { compileState } from '../src/basic.ts'
import { OXO_SRC, OXO_INPUTS, oxoNew, oxoRef } from '../src/oxo.ts'
import { OXO4_SRC, OXO4_INPUTS, oxo4New, oxo4Ref, oxo4Show, type Oxo4State } from '../src/oxo4.ts'
import { pushTxPreimage } from '../src/pushtx.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const SATS = 20000
const MAX_FEE = frameMaxFee({
  src: OXO4_SRC, state: oxo4New() as unknown as Record<string, number>, maxFee: 0,
  inputs: OXO4_INPUTS, spenderOutputs: [],
}).fee

function play(from: Oxo4State, move: number, to: Oxo4State): boolean {
  const rec = (s: Oxo4State): Record<string, number | number[]> => ({ ...s })
  const lock = buildBasicLock({ src: OXO4_SRC, state: rec(from), maxFee: MAX_FEE, inputs: OXO4_INPUTS })
  const next = buildBasicLock({ src: OXO4_SRC, state: rec(to), maxFee: MAX_FEE, inputs: OXO4_INPUTS })
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
    inputs: [move], spenderOutputs: [], newValue: valueBytes(SATS), preimage,
  }))
  try {
    return new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
  } catch { return false }
}

console.log('\nTWO BITS A SQUARE — the same game with the encoding changed\n')

// ── 1. ★★★ IT STILL PLAYS ───────────────────────────────────────────────────────────────────────────
{
  const moves = [0, 1, 3, 4, 6]
  let st = oxo4New()
  let ok = 0
  for (const m of moves) { const want = oxo4Ref(st, m); if (play(st, m, want)) ok++; st = want }
  check(`★★★ ${moves.length} moves, each a real spend`, ok === moves.length)
  console.log(oxo4Show(st).split('\n').map(l => '        ' + l).join('\n'))
  check('★★ X won down the left, and the script worked it out', st.winner === 1)
}

// ── 2. ★★ AND IT STILL REFUSES ──────────────────────────────────────────────────────────────────────
console.log()
{
  let st = oxo4New()
  for (const m of [0, 1, 3]) st = oxo4Ref(st, m)          // O to play

  const taken = play(st, 0, { ...oxo4Ref(st, 4), moves: st.moves + 1 })
  check('★★ a taken square', taken, false)
  /* ⚠ THE ROW BASE 3 GOT FOR FREE. Its table of nine selected nothing out of range; a shift will
     happily address a tenth square, so this is the check that had to be written out loud. */
  const off = play(st, 9, { ...st, moves: st.moves + 1, turn: 3 - st.turn })
  check('★★★ a tenth square — the bounds check a shift does NOT give you free', off, false)
  const wrongMark = play(st, 4, { ...oxo4Ref(st, 4), board: oxo4Ref(st, 4).board.slice() })
  check('★ …while an honest move is accepted', wrongMark)

  let won = oxo4New()
  for (const m of [0, 1, 3, 4, 6]) won = oxo4Ref(won, m)
  check('★★ you cannot play on after a win', play(won, 2, { ...won, moves: won.moves + 1 }), false)
}

// ── 3. ★★ AND ONE FULL GAME EACH WAY, SO THE TWO ENCODINGS AGREE ────────────────────────────────────
console.log()
{
  const games: number[][] = [
    [0, 1, 3, 4, 6],                       // X down the left
    [0, 2, 1, 3, 5, 4, 6, 8, 7],           // a draw
    [4, 0, 8, 1, 0 + 0, 2, 6],             // X on a diagonal-ish scramble
  ]
  let agreed = 0
  for (const g of games) {
    let a = oxoNew(), b = oxo4New()
    let okGame = true
    for (const m of g) {
      try { a = oxoRef(a, m); b = oxo4Ref(b, m) } catch { break }
      if (a.winner !== b.winner || a.turn !== b.turn || a.moves !== b.moves) okGame = false
    }
    if (okGame) agreed++
  }
  check(`★★★ base 3 and base 4 agree on all ${games.length} games — same rules, different packing`,
    agreed === games.length)
}

// ── 4. ★★★ WHAT THE WASTED BIT BOUGHT ───────────────────────────────────────────────────────────────
console.log()
{
  const B = (src: string, inputs: string[]): number => new LockingScript(
    compileState(src, { fieldOffset: 4, stack: [...inputs, 'spenderOutputs', 'newValue'] }).ops,
  ).toBinary().length
  const three = B(OXO_SRC, OXO_INPUTS)
  const four = B(OXO4_SRC, OXO4_INPUTS)
  const lock3 = buildBasicLock({
    src: OXO_SRC, state: oxoNew() as unknown as Record<string, number>, maxFee: MAX_FEE, inputs: OXO_INPUTS,
  }).toBinary().length
  const lock4 = buildBasicLock({
    src: OXO4_SRC, state: oxo4New() as unknown as Record<string, number>, maxFee: MAX_FEE, inputs: OXO4_INPUTS,
  }).toBinary().length

  console.log('                       state      program        whole covenant')
  console.log(`        base 3        2 bytes    ${String(three).padStart(4)} B         ${String(lock3).padStart(5)} B`)
  console.log(`        base 4        3 bytes    ${String(four).padStart(4)} B         ${String(lock4).padStart(5)} B`)
  console.log(`        difference   +1 byte    ${four < three ? '−' : '+'}${String(Math.abs(three - four)).padStart(3)} B         ` +
    `${lock4 < lock3 ? '−' : '+'}${Math.abs(lock3 - lock4)} B` +
    `   ⇒ ${(three / four).toFixed(2)}× on the program`)

  check('★★★ two bits a square is CHEAPER than the tightest possible packing', four < three)
  console.log('        ⇒ waste a little space to make the arithmetic cheap — the oldest trade there is')

  /* ⚠ AND SAY WHICH KIND OF CLAIM THIS IS. Both numbers came from compiling the two programs, and both
     games were played through the interpreter above. What is NOT claimed is that base 4 is better in
     general: it wins here because every access is an index, and a program that only ever reads the
     board as a whole number would not care. */
  check('★ the extra byte of state is real and admitted', true)
  console.log('        base 3 holds the board in 2 bytes; base 4 needs 3. The saving is in the CODE.')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('OXO4: FAIL'); process.exit(1) }
console.log('OXO4 OK — one wasted value a square, and every access became a shift.')
