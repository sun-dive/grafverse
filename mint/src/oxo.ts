// © BSV Association — Open BSV License v6.
/**
 * ★★★ NOUGHTS AND CROSSES — a whole game, in BASIC, enforced by the covenant itself.
 *
 * This is the demo the spec asked for first, and it earns the place by showing what the racer cannot:
 * **TURN-TAKING ENFORCED BY THE SCRIPT.** A racing car is a machine that advances itself; this is a
 * machine two strangers PLAY, and neither of them can cheat, because none of the rules live in a page.
 *
 * ```
 *   you cannot play out of turn      whose move it is lives in the STATE, not in the move
 *   you cannot take a taken square   the square must read empty before it can be written
 *   you cannot play on after a win   the game refuses to advance once someone has won
 *   you cannot play square 9         out of range fails the same test that picks the square
 * ```
 *
 * ── ★ FIVE BYTES, AND NOT ONE OF THEM DECORATIVE ──────────────────────────────────────────────────
 * ```
 *   board%2   nine squares packed BASE 3 — 0 empty, 1 X, 2 O. Max 2·9841 = 19682, inside two bytes.
 *   turn%1    whose move it is: 1 or 2
 *   winner%1  0 none · 1 X · 2 O · 3 drawn
 *   moves%1   how many have been played, which is the only way to know a draw
 * ```
 *
 * ── ⚠ THE INTERESTING PROBLEM, AND WHY IT IS A GOOD TEACHING PROGRAM ──────────────────────────────
 * **Script has no arrays and no indexing.** `board[move] = player` cannot be written, because there is
 * no way to compute a location. So the square is chosen the way a 1980s BASIC program would choose it —
 * nine comparisons, each selecting a constant — and the board is packed into ONE number so that reading
 * a square is arithmetic rather than a lookup:
 *
 * ```
 *   the square at k     MOD(board / 3^k, 3)
 *   playing it          board = board + player · 3^k
 * ```
 *
 * Every rule below is a comparison, exactly as the spec promised. Nothing here needs machinery that the
 * shell, the depot and the battery did not already need.
 */

/** The program. Written to be READ — it is the example the workbench opens with. */
export const OXO_SRC = `
REM  ── noughts and crosses ──────────────────────────────────────────
REM  Five bytes of state, and every rule below is a comparison.
DIM board%2      REM  nine squares packed base 3: 0 empty, 1 X, 2 O
DIM turn%1       REM  whose move it is — 1 or 2
DIM winner%1     REM  0 none, 1 X, 2 O, 3 drawn
DIM moves%1      REM  how many have been played

REM  the game has to still be running
VERIFY winner = 0

REM  WHICH SQUARE? Script has no arrays, so the choice is nine comparisons —
REM  and each one selects a constant, which is what a lookup table was in 1982.
place = 0
IF move = 0 THEN place = 1
IF move = 1 THEN place = 3
IF move = 2 THEN place = 9
IF move = 3 THEN place = 27
IF move = 4 THEN place = 81
IF move = 5 THEN place = 243
IF move = 6 THEN place = 729
IF move = 7 THEN place = 2187
IF move = 8 THEN place = 6561
REM  no square selected means the move was not 0..8 — the bounds check is free
VERIFY place > 0

REM  and it has to be empty
VERIFY MOD(board / place, 3) = 0

REM  play it. Whose turn it is came from the STATE, so nobody can play out of turn.
p = turn
board = board + p * place
moves = moves + 1
turn = 3 - p

REM  read the nine squares back out
s0 = MOD(board, 3)
s1 = MOD(board / 3, 3)
s2 = MOD(board / 9, 3)
s3 = MOD(board / 27, 3)
s4 = MOD(board / 81, 3)
s5 = MOD(board / 243, 3)
s6 = MOD(board / 729, 3)
s7 = MOD(board / 2187, 3)
s8 = MOD(board / 6561, 3)

REM  eight ways to win, and every one of them is a comparison
IF s0 = p AND s1 = p AND s2 = p THEN winner = p
IF s3 = p AND s4 = p AND s5 = p THEN winner = p
IF s6 = p AND s7 = p AND s8 = p THEN winner = p
IF s0 = p AND s3 = p AND s6 = p THEN winner = p
IF s1 = p AND s4 = p AND s7 = p THEN winner = p
IF s2 = p AND s5 = p AND s8 = p THEN winner = p
IF s0 = p AND s4 = p AND s8 = p THEN winner = p
IF s2 = p AND s4 = p AND s6 = p THEN winner = p

REM  a full board with nobody winning is a draw
IF winner = 0 AND moves = 9 THEN winner = 3
`

/** The only thing a player supplies: which square. */
export const OXO_INPUTS = ['move']

export interface OxoState { board: number; turn: number; winner: number; moves: number }

/** A fresh game. X moves first, by the oldest convention there is. */
export const oxoNew = (): OxoState => ({ board: 0, turn: 1, winner: 0, moves: 0 })

/**
 * The same rules in TypeScript — the reference the covenant is checked AGAINST, never the other way
 * round. ⚠ If the two disagree the SCRIPT is not automatically wrong; whichever one departs from the
 * game is. Both are written from the rules, not from each other.
 */
export function oxoRef(st: OxoState, move: number): OxoState {
  if (st.winner !== 0) throw new Error('the game is over')
  if (!Number.isInteger(move) || move < 0 || move > 8) throw new Error('no such square')
  const place = 3 ** move
  if (Math.floor(st.board / place) % 3 !== 0) throw new Error('that square is taken')

  const p = st.turn
  const board = st.board + p * place
  const moves = st.moves + 1
  const sq = (k: number): number => Math.floor(board / 3 ** k) % 3
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]
  let winner = 0
  for (const [a, b, c] of LINES) if (sq(a) === p && sq(b) === p && sq(c) === p) winner = p
  if (winner === 0 && moves === 9) winner = 3
  return { board, turn: 3 - p, winner, moves }
}

/** The board as three lines of text — for a person, and for a test that has to be read. */
export function oxoShow(st: OxoState): string {
  const c = '.XO'
  const sq = (k: number): string => c[Math.floor(st.board / 3 ** k) % 3]
  return [0, 3, 6].map(r => [0, 1, 2].map(i => sq(r + i)).join(' ')).join('\n')
}
