// © BSV Association — Open BSV License v6.
/**
 * ★★★ DOES THE BOARD REALLY PLAY FOREVER? — every move a real spend, judged by `Spend`.
 *
 * ⚠⚠ THE ONE THING THIS EXISTS TO PROVE: that the move AFTER a win is ACCEPTED, and starts a fresh
 *    board. `oxo.ts` refuses it — that is the whole difference — so a test that only plays one game
 *    would pass against either file and prove nothing about this one.
 */
import { Transaction, Spend, UnlockingScript } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import { pushTxPreimage } from '../src/pushtx.ts'
import { OXOLOOP_SRC, OXOLOOP_INPUTS, loopNew, loopRef, loopShow, type LoopState } from '../src/oxoLoop.ts'

const SATS = 200_000
const rec = (s: LoopState) => ({ ...s }) as unknown as Record<string, number>
const MAX_FEE = frameMaxFee({
  src: OXOLOOP_SRC, state: rec(loopNew()), maxFee: 0, inputs: OXOLOOP_INPUTS, spenderOutputs: [],
}).fee
const lockFor = (s: LoopState) =>
  buildBasicLock({ src: OXOLOOP_SRC, state: rec(s), maxFee: MAX_FEE, inputs: OXOLOOP_INPUTS })

let pass = 0, fail = 0
const check = (label: string, ok: boolean, want = true) => {
  console.log(`${ok === want ? 'PASS' : '⚠ FAIL'}  ${label}`); ok === want ? pass++ : fail++
}

/** Play one move for real and let the covenant judge it. */
function play(from: LoopState, move: number, sats = SATS): { ok: boolean; to?: LoopState } {
  let to: LoopState
  try { to = loopRef(from, move) } catch { return { ok: false } }
  const lock = lockFor(from), next = lockFor(to)
  const source = new Transaction()
  source.addOutput({ lockingScript: lock, satoshis: sats })
  const tx = new Transaction(); tx.version = 2
  tx.addOutput({ lockingScript: next, satoshis: sats - MAX_FEE })
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xffffffff })
  const preimage = pushTxPreimage({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: tx.outputs,
    inputSequence: 0xffffffff, lockTime: 0,
  })
  const unlock = new UnlockingScript(basicUnlockingOps({
    inputs: [move], spenderOutputs: [], newValue: valueBytes(sats - MAX_FEE), preimage,
  }))
  try {
    const ok = new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
    return { ok, to }
  } catch { return { ok: false, to } }
}

console.log('\nNOUGHTS AND CROSSES THAT NEVER STOPS\n')

/* ── game one: X takes the top row ─────────────────────────────────────────────────────────── */
let st = loopNew(), played = 0
for (const m of [0, 3, 1, 4, 2]) {
  const r = play(st, m)
  if (r.ok) played++
  st = r.to!
}
check(`★ five moves, each a real spend`, played === 5)
check('★ X won the first game', st.winner === 1)
console.log(loopShow(st) + `\n        winner ${st.winner} · games finished ${st.games}\n`)

/* ── ★★★ AND NOW THE POINT ─────────────────────────────────────────────────────────────────── */
const after = play(st, 4)
check('★★★ the move AFTER a win is ACCEPTED — the board did not stop', after.ok)
check('★★★ …and it started a FRESH game', after.to!.moves === 1 && after.to!.winner === 0)
check('★★ the games counter advanced', after.to!.games === 1)
/* ⚠ square 4 is 3^4 = 81, and after a reset it is X's turn again — so the new board is 1 × 81.
   My first version expected 2 × 81 and the covenant was right: a reset returns the turn to X. */
check('⚠ a square the LAST game had filled is free again, and X leads', after.to!.board === 1 * 81)
console.log(loopShow(after.to!) + `\n        game 2, move 1 · games finished ${after.to!.games}\n`)

/* ⚠ the reset must not weaken anything WITHIN a game */
st = after.to!
check('⚠ a taken square is still refused', play(st, 4).ok, false)
check('⚠ a square that does not exist is still refused', play(st, 9).ok, false)
const before = st.turn
const legal = play(st, 0)
check('★ a legal move is still accepted', legal.ok)
check('⚠ …and the turn still alternates', legal.to!.turn !== before)

/* ── a second full game, to a draw, then a third ────────────────────────────────────────────── */
st = loopNew()
for (const m of [4, 0, 8, 2, 6, 3, 5, 7, 1]) st = play(st, m).to!
check('★ nine moves fill the board', st.moves === 9)
check('★ and the script called it', st.winner !== 0, true)
const third = play(st, 4)
check('★★★ a DRAWN game also resets and plays on', third.ok && third.to!.moves === 1)

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? '⚠ OXO-LOOP FAILED' :
  'OXO-LOOP OK — the board plays a game, finishes it, and is ready for the next one.\n' +
  `  ${lockFor(loopNew()).toBinary().length} B lock · ${MAX_FEE} sat a move`)
if (fail) process.exitCode = 1
