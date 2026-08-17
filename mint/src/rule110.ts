// © BSV Association — Open BSV License v6.
/**
 * ★★★ RULE 110 — and the joke, which is a real one.
 *
 * A row of cells, each on or off. Every generation, each cell looks at itself and its two neighbours
 * and decides what to be next. Three cells means eight possible patterns, and the rule is just eight
 * answers:
 *
 * ```
 *   neighbourhood   111 110 101 100 011 010 001 000
 *   next state       0   1   1   0   1   1   1   0     ← 01101110 binary = 110
 * ```
 *
 * That is the whole thing, and it draws the famous nested triangles.
 *
 * ── ★★★ WHY IT IS WORTH BUILDING ──────────────────────────────────────────────────────────────────
 * **Rule 110 is Turing complete** — proved by Matthew Cook. Anything computable can be computed by it.
 * So it is a wink at *"Bitcoin Script isn't Turing complete"*, and the wink lands because both halves
 * are true at once: ONE generation is a few thousand bytes with no backward jump in it, and the CHAIN
 * OF TRANSACTIONS runs unboundedly.
 *
 * ⚠ AND SAY THAT EXACTLY. The script DOES iterate — thirty-one cells, unrolled, every generation. What
 * it cannot do is run an UNKNOWN number of times, and that is the only thing Rule 110 needs the chain
 * for. **The chain does not supply the looping. It supplies the not knowing when to stop.**
 * → the same shape as the computation walk: each spend is one enforced step, and the trace is the proof.
 *
 * ── ★★ AND IT IS THE CASE WHERE UNROLLING GIVES YOU EVERYTHING ────────────────────────────────────
 * Noughts and crosses needed a table of nine comparisons and Space Invaders needed a shift, both
 * because the thing being indexed was chosen by a PLAYER and so unknown until the script ran. Rule 110
 * has **no runtime index at all**: every neighbour of cell `i` is at a position the compiler knows.
 * So `FOR i = 0 TO 30` unrolls into thirty-one copies with every mask already folded, and the array
 * problem does not arise. It is the cleanest thing this compiler does.
 *
 * ── ⚠ THE RULE AS ARITHMETIC, NOT AS A LOOKUP ─────────────────────────────────────────────────────
 * The obvious way to write it is `bit n of 110`, which needs `2^n` for a RUNTIME n — the very thing
 * Script cannot do. But the table collapses to one line of boolean algebra:
 *
 * ```
 *   new = (C OR R) AND NOT(L AND C AND R)
 * ```
 *
 * `rule110.ts`'s test checks that against all eight rows rather than trusting the derivation.
 */

/** 31 cells, so the whole row fits a 4-byte sign-magnitude field: bits 0..30, max 2^31 − 1. */
export const R110_CELLS = 31

/**
 * The row is a CYLINDER — cell 0's right neighbour is cell 30. With every index known at compile time
 * the wrap costs nothing: it is `MOD(i + 30, 31)`, folded before a single opcode is emitted.
 */
export const R110_SRC = `
REM  ── rule 110 ──────────────────────────────────────────────────────
REM  One transaction is one generation. There is no input: nobody plays
REM  this, it simply runs. The 31 cells below DO loop — unrolled, laid out
REM  in space instead of repeated in time. What the chain adds is not the
REM  looping but the not knowing when to stop.
DIM cells%4      REM  31 cells, one bit each, wrapped into a ring
DIM gen%2        REM  which generation this is

new = 0
FOR i = 0 TO 30
  REM  every neighbour is at a position the COMPILER knows, so each of these
  REM  divisors is a folded constant and no lookup is needed at all.
  l = MOD(cells / 2 ^ MOD(i + 1, 31), 2)
  c = MOD(cells / 2 ^ i, 2)
  r = MOD(cells / 2 ^ MOD(i + 30, 31), 2)
  REM  the eight-row table, collapsed into one line of boolean algebra
  new = new + ((c OR r) AND NOT(l AND c AND r)) * 2 ^ i
NEXT i

cells = new
gen = gen + 1
`

/** Nothing. Rule 110 takes no input — that is part of the point. */
export const R110_INPUTS: string[] = []

export interface R110State { cells: number; gen: number }

/** The classic seed: one cell alight, at the right-hand end. */
export const r110New = (): R110State => ({ cells: 1, gen: 0 })

/** Rule 110 as its eight-row TABLE — the definition, used to check the algebra rather than the reverse. */
export const R110_TABLE = 110
export const r110Bit = (l: number, c: number, r: number): number =>
  (R110_TABLE >> (4 * l + 2 * c + r)) & 1

/**
 * One generation, in TypeScript. ⚠ Written from the TABLE, not from the boolean line the script uses,
 * so that agreement between them is evidence rather than a copy.
 */
export function r110Ref(st: R110State): R110State {
  const bit = (k: number): number => (st.cells >> (((k % R110_CELLS) + R110_CELLS) % R110_CELLS)) & 1
  let cells = 0
  for (let i = 0; i < R110_CELLS; i++) {
    if (r110Bit(bit(i + 1), bit(i), bit(i - 1))) cells += 2 ** i
  }
  return { cells, gen: st.gen + 1 }
}

/** One row of the picture — the left-hand end first, so the triangles fall the way they are drawn. */
export function r110Show(st: R110State): string {
  let out = ''
  for (let i = R110_CELLS - 1; i >= 0; i--) out += ((st.cells >> i) & 1) ? '█' : '·'
  return out
}
