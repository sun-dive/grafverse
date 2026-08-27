// © 2026 sun-dive — Apache License 2.0.
/**
 * ★★ NOUGHTS AND CROSSES, BASE 4 — the same game with the encoding changed, to find out what it costs.
 *
 * sun-dive, 17 August 2026, on hearing that a shift stands in for a power of two:
 * *"test out two bits a square, one value wasted, and indexing becomes a shift there too"*.
 *
 * `oxo.ts` packs nine squares BASE 3 — 0 empty, 1 X, 2 O — which is the tightest encoding there is:
 * 3^9 = 19,683, so the whole board fits in two bytes. But base 3 is not a power of two, so reading a
 * square needs `MOD(board / 3^k, 3)`, and `3^k` for a runtime `k` cannot be computed at all. It has to
 * come from a table of nine comparisons.
 *
 * Give each square TWO BITS instead and 3 of the 4 values are used, one wasted per square — 18 bits
 * where 15 would do. In exchange, **every access becomes a shift**:
 *
 * ```
 *   the square at k        BITAND(board, LSHIFT(3, 2k))          ← a runtime k, one opcode
 *   playing it             BITOR(board, LSHIFT(player, 2k))
 *   a whole winning line   one constant mask, one comparison
 * ```
 *
 * ★ WASTE A LITTLE SPACE TO MAKE THE ARITHMETIC CHEAP is the oldest trade in this business, and it is
 * exactly what an 8-bit programmer would have done — a nibble per cell rather than a tight base-N pack,
 * because the shift is free and the division is not.
 *
 * ⚠ AND THE BOARD IS RAW BYTES, NEVER A NUMBER. Read as a number, a mask landing on the top bit of the
 * last byte is negative zero — the trap that would have made one alien in fifty-five immortal. Every
 * comparison here is `SAMEBYTES`.
 *
 * ⚠ ONE THING BASE 3 GOT FOR FREE AND THIS DOES NOT: the table of nine comparisons WAS the bounds
 * check, because an out-of-range move selected nothing. A shift happily addresses a tenth square, so
 * the range has to be verified out loud.
 */

/** The eight ways to win, as square indices. */
const LINES: Array<[number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]
const NAMES = ['top row', 'middle row', 'bottom row', 'left column', 'middle column', 'right column',
  'the diagonal', 'the other diagonal']

/** Three bytes, big-endian, as the shifts see them. */
const hex3 = (n: number): string => '&H' + n.toString(16).padStart(6, '0')
/** The mask covering all three squares of a line — both bits of each. */
const lineMask = (l: [number, number, number]): number => l.reduce((m, k) => m | (3 << (2 * k)), 0)

/**
 * The program, GENERATED — because the eight line masks are arithmetic and typing them out by hand is
 * how a wrong constant gets into a covenant. The compiler is the loop, and so is this.
 */
export const OXO4_SRC = `
REM  ── noughts and crosses, two bits a square ────────────────────────
REM  Base 4 wastes one value per square and buys a SHIFT for every access.
DIM board$3      REM  nine squares, TWO BITS each — 00 empty, 01 X, 10 O
DIM turn%1       REM  whose move it is — 1 or 2
DIM winner%1     REM  0 none, 1 X, 2 O, 3 drawn
DIM moves%1      REM  how many have been played

VERIFY winner = 0
REM  ⚠ base 3 got this free — its table of nine selected nothing out of range.
REM  A shift will happily address a tenth square, so the range is checked here.
VERIFY move >= 0
VERIFY move <= 8

p = turn
pb = &H000001
IF p = 2 THEN pb = &H000002

REM  two bits per square, so the shift is twice the index
sh = move + move

REM  the square has to be empty — both of its bits clear
VERIFY SAMEBYTES(BITAND(board, LSHIFT(&H000003, sh)), &H000000)

REM  play it
board = BITOR(board, LSHIFT(pb, sh))
moves = moves + 1
turn = 3 - p

REM  ── eight ways to win. Each is ONE mask and ONE comparison, because the
REM  three squares of a line are now three shifts of the same two bits.
${LINES.map((l, i) =>
  `w = BITOR(BITOR(LSHIFT(pb, ${2 * l[0]}), LSHIFT(pb, ${2 * l[1]})), LSHIFT(pb, ${2 * l[2]}))\n` +
  `IF SAMEBYTES(BITAND(board, ${hex3(lineMask(l))}), w) THEN winner = p   REM  ${NAMES[i]}`
).join('\n')}

REM  a full board with nobody winning is a draw
IF winner = 0 AND moves = 9 THEN winner = 3
`

export const OXO4_INPUTS = ['move']

export interface Oxo4State { board: number[]; turn: number; winner: number; moves: number }

/** Three bytes, big-endian — the same order the shifts walk. */
const toBytes = (n: number): number[] => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const fromBytes = (b: number[]): number => (b[0] << 16) | (b[1] << 8) | b[2]

export const oxo4New = (): Oxo4State => ({ board: [0, 0, 0], turn: 1, winner: 0, moves: 0 })

/** The same rules again, written from the rules. */
export function oxo4Ref(st: Oxo4State, move: number): Oxo4State {
  if (st.winner !== 0) throw new Error('the game is over')
  if (!Number.isInteger(move) || move < 0 || move > 8) throw new Error('no such square')
  let board = fromBytes(st.board)
  if ((board & (3 << (2 * move))) !== 0) throw new Error('that square is taken')

  const p = st.turn
  board |= p << (2 * move)
  const moves = st.moves + 1
  let winner = 0
  for (const l of LINES) {
    const want = l.reduce((w, k) => w | (p << (2 * k)), 0)
    if ((board & lineMask(l)) === want) winner = p
  }
  if (winner === 0 && moves === 9) winner = 3
  return { board: toBytes(board), turn: 3 - p, winner, moves }
}

/** The board as three lines, for a person. */
export function oxo4Show(st: Oxo4State): string {
  const b = fromBytes(st.board)
  const c = '.XO?'
  const sq = (k: number): string => c[(b >> (2 * k)) & 3]
  return [0, 3, 6].map(r => [0, 1, 2].map(i => sq(r + i)).join(' ')).join('\n')
}
