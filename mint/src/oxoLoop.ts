// © BSV Association — Open BSV License v6.
/**
 * ★★★ NOUGHTS AND CROSSES THAT NEVER STOPS — a board that resets itself and plays again, forever.
 *
 * ⚠⚠ WHY THIS IS A SEPARATE FILE. `oxo.ts` refuses every spend once somebody has won
 * (`VERIFY winner = 0`), so a finished game is a MONUMENT: the tip stops and whatever satoshis are
 * left are locked behind it for good. ⇒ That is a real design, and its byte count is PUBLISHED IN
 * BRC-Z — so it is left exactly as it is, and the variant lives here.
 *
 * ★ His description, 26 Aug: *"once the game is complete, it's fresh waiting for a new game. Just like
 *   a Mandelbrot, it just keeps moving the tip forward on every tick."* ⇒ That is this file. The
 *   battery and the live counter behave the same way, and for the same reason: **an object that stops
 *   is an object that has to be re-minted.**
 *
 * ⇒ THE ONLY CHANGE IS AT THE TOP. Instead of refusing a spend after a win, the FIRST MOVE OF THE NEXT
 * GAME clears the board and plays into it. Everything below that is `oxo.ts` unaltered, because the
 * rules of the game did not change — only what happens when one ends.
 */

/** ⚠ One more field than `oxo.ts`: `games`, so a board can say how many it has seen. */
export const OXOLOOP_SRC = `
REM  ── noughts and crosses, played forever ──────────────────────────
REM  Seven bytes of state, and every rule below is a comparison.
DIM board%2      REM  nine squares packed base 3: 0 empty, 1 X, 2 O
DIM turn%1       REM  whose move it is — 1 or 2
DIM winner%1     REM  0 none, 1 X, 2 O, 3 drawn
DIM moves%1      REM  how many have been played in THIS game
DIM games%2      REM  how many games this board has finished

REM  ★★★ A FINISHED GAME RESETS. The tip never stops: the first move of the next
REM  game clears the board and plays into it, so nobody has to mint a new one and
REM  no satoshis are ever stranded behind a win.
done = 0
IF winner > 0 THEN done = 1
IF done = 1 THEN games = games + 1
IF done = 1 THEN board = 0
IF done = 1 THEN turn = 1
IF done = 1 THEN moves = 0
IF done = 1 THEN winner = 0

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

REM  and it has to be empty. ⚠ AFTER the reset, so the first move of a new game
REM  may take a square the last game had filled.
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
export const OXOLOOP_INPUTS = ['move']

export interface LoopState { board: number; turn: number; winner: number; moves: number; games: number }

export const loopNew = (): LoopState => ({ board: 0, turn: 1, winner: 0, moves: 0, games: 0 })

/**
 * The same rules in TypeScript — the reference the covenant is checked AGAINST, never the other way
 * round. ⚠ If the two disagree the SCRIPT is not automatically wrong; whichever one departs from the
 * game is. Both are written from the rules, not from each other.
 */
export function loopRef(st: LoopState, move: number): LoopState {
  if (!Number.isInteger(move) || move < 0 || move > 8) throw new Error('no such square')
  let { board, turn, winner, moves, games } = st
  /* ★ a finished game resets before the move is played */
  if (winner > 0) { games += 1; board = 0; turn = 1; moves = 0; winner = 0 }
  const place = 3 ** move
  if (Math.floor(board / place) % 3 !== 0) throw new Error('that square is taken')
  const p = turn
  board += p * place
  moves += 1
  turn = 3 - p
  const s = (i: number) => Math.floor(board / 3 ** i) % 3
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
  for (const [a, b, c] of lines) if (s(a) === p && s(b) === p && s(c) === p) winner = p
  if (winner === 0 && moves === 9) winner = 3
  return { board, turn, winner, moves, games }
}

/** The board as three lines of text. */
export function loopShow(st: LoopState): string {
  const c = ['.', 'X', 'O']
  const s = (i: number) => c[Math.floor(st.board / 3 ** i) % 3]
  return [0, 3, 6].map(r => '  ' + [0, 1, 2].map(k => s(r + k)).join(' ')).join('\n')
}
