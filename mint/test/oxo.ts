// © BSV Association — Open BSV License v6.
// ★★★ NOUGHTS AND CROSSES, PLAYED ON CHAIN RULES
//
//   node --experimental-strip-types mint/test/oxo.ts
//
// A racing car is a machine that advances itself. This is a machine two strangers PLAY — and the point
// of it is what the racer cannot show: the covenant enforcing WHOSE TURN IT IS. Every move below is a
// real transaction with a real sighash preimage, judged by `Spend`, spending the output the last move
// created. Nothing is simulated.
//
// ⚠ A covenant is worth exactly what it REFUSES, so the cheats are tested as carefully as the game.
import { Transaction, Spend, LockingScript, UnlockingScript } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import { OXO_SRC, OXO_INPUTS, oxoNew, oxoRef, oxoShow, type OxoState } from '../src/oxo.ts'
import { pushTxPreimage } from '../src/pushtx.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const SATS = 20000
const MAX_FEE = frameMaxFee({
  src: OXO_SRC, state: oxoNew() as unknown as Record<string, number>, maxFee: 0,
  inputs: OXO_INPUTS, spenderOutputs: [],
}).fee

/** Play one move for real: build the successor, assemble the transaction, derive the preimage, judge. */
function play(from: OxoState, move: number, to: OxoState, sats = SATS): boolean {
  const asRec = (s: OxoState): Record<string, number> => ({ ...s })
  const lock = buildBasicLock({ src: OXO_SRC, state: asRec(from), maxFee: MAX_FEE, inputs: OXO_INPUTS })
  const next = buildBasicLock({ src: OXO_SRC, state: asRec(to), maxFee: MAX_FEE, inputs: OXO_INPUTS })

  const source = new Transaction()
  source.addOutput({ lockingScript: lock, satoshis: sats })
  const tx = new Transaction()
  tx.version = 2
  tx.addOutput({ lockingScript: next, satoshis: sats })
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xffffffff })

  const preimage = pushTxPreimage({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: tx.outputs,
    inputSequence: 0xffffffff, lockTime: 0,
  })
  const unlock = new UnlockingScript(basicUnlockingOps({
    inputs: [move], spenderOutputs: [], newValue: valueBytes(sats), preimage,
  }))
  try {
    return new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
  } catch { return false }
}

console.log('\nNOUGHTS AND CROSSES — every rule enforced by the script, not by a page\n')

{
  const lock = buildBasicLock({
    src: OXO_SRC, state: oxoNew() as unknown as Record<string, number>, maxFee: MAX_FEE, inputs: OXO_INPUTS,
  })
  console.log(`        the whole game: ${lock.toBinary().length} B of Script · ${lock.chunks.length} opcodes`)
  console.log(`        five bytes of state · MAX_FEE ${MAX_FEE} sat, derived by serializing a spend`)
}

// ── 1. ★★★ A REAL GAME — X takes the top row ────────────────────────────────────────────────────────
console.log()
{
  //  X O .        X O .        X O .
  //  X O .   →    X O .   →    X O .        X wins down the left
  //  . . .        . . .        X . .
  const moves = [0, 1, 3, 4, 6]
  let st = oxoNew()
  let ok = 0
  for (const m of moves) {
    const want = oxoRef(st, m)
    if (play(st, m, want)) ok++
    st = want
  }
  check(`★★★ ${moves.length} moves, each a real spend of the last one's output`, ok === moves.length)
  console.log(oxoShow(st).split('\n').map(l => '        ' + l).join('\n'))
  check('★★ …and the script worked out that X won', st.winner === 1)
  console.log(`        winner ${st.winner} · ${st.moves} moves played · next turn ${st.turn}`)
}

// ── 2. ★★★ THE CHEATS, WHICH ARE WHAT A COVENANT IS FOR ─────────────────────────────────────────────
console.log()
{
  let st = oxoNew()
  //  X O .
  //  X . .     three played, so it is O's turn
  //  . . .
  for (const m of [0, 1, 3]) st = oxoRef(st, m)

  /* ⚠ A TAKEN SQUARE. The successor is exactly what the rules WOULD give if the square were empty, so
     nothing about the shape of the transaction is wrong — only the rule is, and only the script knows. */
  const taken = play(st, 0, { ...st, board: st.board + 1, moves: st.moves + 1, turn: 3 - st.turn })
  check('★★ you cannot take a square that is already taken', taken, false)

  const off = play(st, 9, { ...st, moves: st.moves + 1, turn: 3 - st.turn })
  check('★★ …nor play a square that does not exist', off, false)

  /* ★★★ THE ONE THE RACER CANNOT SHOW. Whose move it is lives in the STATE, so playing out of turn is
     not something the script has to detect — it is something nobody can express. The nearest a cheat
     can come is claiming a successor where the mark is the WRONG PLAYER'S, and the script computes the
     mark itself, so the rebuilt output simply does not match.
     ⚠ IT IS O'S TURN HERE, so the cheat is X's mark — and the first draft of this test wrote O's,
     which is the CORRECT value. The check passed on a cheat that was not a cheat. Getting the position
     wrong is the easiest way to write a security test that tests nothing. */
  const wrongMark = play(st, 4, { ...oxoRef(st, 4), board: st.board + 1 * 81 })
  check('★★★ you cannot play as the other player — the turn is in the state', wrongMark, false)

  const noFlip = play(st, 4, { ...oxoRef(st, 4), turn: st.turn })
  check('★★ …nor keep the turn for yourself', noFlip, false)

  /* ⚠ AND THE GAME STOPS WHEN IT IS WON. Without this a loser could play on forever. */
  let won = oxoNew()
  for (const m of [0, 1, 3, 4, 6]) won = oxoRef(won, m)
  const after = play(won, 2, { ...won, board: won.board + 2 * 9, moves: won.moves + 1, turn: 3 - won.turn })
  check('★★★ you cannot play on after somebody has won', after, false)

  /* ★ …and a move that IS legal still works from the same position, so the refusals above are the
     rules biting rather than the harness being broken. */
  check('★ …while a legal move from the same board is accepted', play(st, 4, oxoRef(st, 4)))
}

// ── 3. ★★ A DRAWN GAME — all nine squares, and the covenant calls it ────────────────────────────────
console.log()
{
  //  X X O
  //  O O X      nobody wins
  //  X X O
  const moves = [0, 2, 1, 3, 5, 4, 6, 8, 7]
  let st = oxoNew()
  let ok = 0
  for (const m of moves) {
    const want = oxoRef(st, m)
    if (play(st, m, want)) ok++
    st = want
  }
  check(`★★ all ${moves.length} squares filled, every move a real spend`, ok === moves.length)
  console.log(oxoShow(st).split('\n').map(l => '        ' + l).join('\n'))
  check('★★★ the script called it a draw with nobody having won', st.winner === 3 && st.moves === 9)
  console.log(`        winner ${st.winner} (3 = drawn) after ${st.moves} moves`)

  const over = play(st, 0, { ...st, moves: 10 })
  check('★ and a drawn game is over too', over, false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('OXO: FAIL'); process.exit(1) }
console.log('OXO OK — two strangers can play, and neither of them can cheat.')
