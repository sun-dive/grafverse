// © BSV Association — Open BSV License v6.
/**
 * ★★★ SPACE INVADERS — and the claim it exists to test.
 *
 * sun-dive, 17 August 2026: *"That's the game machine that was in the fish n chip shops you could play
 * to 10 cents while waiting for the food."*
 *
 * ── ★★ THE 1978 ACCIDENT ───────────────────────────────────────────────────────────────────────────
 * The arcade original speeds up as you kill aliens, and every player who ever fed it a coin read that
 * as rising difficulty. **Nobody designed it.** The 8080 moved ONE alien per frame, so a sweep of the
 * fleet took as many frames as there were aliens left. Kill half of them and the fleet moves twice as
 * fast — not because the game decided to, but because there was less to do.
 *
 * ── ★★★ AND THE CLAIM IS THAT THE SAME RAMP COMES BACK, FOR THE SAME REASON ────────────────────────
 * One transaction moves one alien, exactly as one frame did. So a sweep costs as many TRANSACTIONS as
 * there are aliens alive, and the fleet advances faster — and cheaper — as it thins.
 *
 * ```
 *   1978    one alien per FRAME        fewer aliens ⇒ fewer frames ⇒ a faster sweep
 *   here    one alien per TRANSACTION  fewer aliens ⇒ fewer spends ⇒ a faster, cheaper sweep
 * ```
 *
 * ⚠⚠ **THAT IS A CLAIM, AND `test/invaders.ts` MEASURES IT RATHER THAN ASSERTING IT.** It is not
 * automatic and it very nearly did not happen: the per-transaction SCRIPT cost is FLAT, because the
 * script does the same work whether one alien is alive or twenty-four. What falls is the number of
 * transactions. Had the design put a whole sweep in one spend, the ramp would not exist at all. The
 * economics reproduce the accident only because the granularity matches.
 *
 * ── ⚠ NO ARRAYS, AGAIN, AND THIS TIME AT TWENTY-FOUR SLOTS ─────────────────────────────────────────
 * The fleet is a bitmap in one number, and the shot names a slot. Testing "is slot n alive" needs bit
 * `n`, and `n` is not known until the script runs — so the bit is selected the way it has to be:
 *
 * ```
 *   FOR k = 0 TO 23 : IF shot = k + 1 THEN bit = 2 ^ k : NEXT k
 * ```
 *
 * Twenty-four comparisons, each carrying a constant the compiler folded. **That unrolled loop IS the
 * array**, and it is what a lookup table was before anyone could afford one.
 */

/**
 * ★★ THE FULL ARCADE FLEET — 5 rows of 11, exactly as 1978.
 *
 * It was 3 × 8 for one sitting, because the comparison table that stands in for an array costs about
 * fifty bytes a slot. sun-dive asked two questions that removed the ceiling entirely:
 *
 *   *"I wonder if bit shift is what stands in for an exponential"*  — and it is, for base two.
 *   *"And script can extremely large integers."*                    — so the fleet need not fit a word.
 *
 * ```
 *   55 aliens by TABLE   1269 B at 2^52 …and REFUSED past 2^53, where a double stops being exact
 *   55 aliens by SHIFT     34 B, flat, and the width of the fleet stops mattering at all
 * ```
 * ⇒ The table was not merely expensive. **It could not reach the real fleet at all.**
 */
export const INV_COLS = 11
export const INV_ROWS = 5
export const INV_SLOTS = INV_COLS * INV_ROWS

/** How far the fleet may descend before it is over the player. */
export const INV_FLOOR = 5
/** The fleet lives in 7 bytes — 56 bits for 55 aliens, with one spare. */
export const INV_BYTES = 7
const ZERO7 = '&H00000000000000'
const ONE7 = '&H00000000000001'

export const INV_SRC = `
REM  ── space invaders ────────────────────────────────────────────────
REM  One transaction moves ONE alien, exactly as one frame did in 1978.
DIM alive$7      REM  55 slots, one BIT each — and never read as a number
DIM count%1      REM  how many are left, and therefore how long a sweep is
DIM cur%1        REM  how far through this sweep
DIM x%1          REM  the fleet's column offset
DIM y%1          REM  how far down it has come
DIM dx%1         REM  which way it is going: 1 or -1
DIM score%2      REM  ten a head
DIM over%1       REM  0 running · 1 they landed · 2 the board is clear

VERIFY over = 0

REM  ── the shot. 0 is no shot; 1..55 names a slot. ──
REM  A SHIFT is what stands in for a power of two, and it does not care how wide
REM  the fleet is. A shift past the end quietly gives nothing, which is the
REM  bounds check for free.
mask = ${ZERO7}
IF shot > 0 THEN mask = LSHIFT(${ONE7}, shot - 1)

REM  ⚠ SAMEBYTES, NOT "=". This is a BYTE comparison, and it has to be: read as a
REM  number, a mask landing on the top bit of the last byte is NEGATIVE ZERO, and
REM  one alien in fifty-five would quietly refuse to die.
IF NOT(SAMEBYTES(BITAND(alive, mask), ${ZERO7})) THEN
  alive = BITXOR(alive, mask)
  count = count - 1
  score = score + 10
END IF

REM  ── one alien moves. That is the whole of a frame. ──
REM  nx has to exist BEFORE the branch: a variable that lives only inside one
REM  arm is exactly what the compiler refuses, and it is right to.
nx = x
cur = cur + 1
IF cur >= count THEN
  REM  the sweep is done, so the fleet steps sideways
  cur = 0
  nx = x + dx
  IF nx > 4 OR nx < 0 THEN
    REM  it reached the edge: turn round and come down a row
    dx = 0 - dx
    y = y + 1
  ELSE
    x = nx
  END IF
END IF

REM  ── how it ends ──
IF y >= 5 THEN over = 1
IF count = 0 THEN over = 2
`

/** The only thing a player supplies: which slot to fire at, or 0 to let the fleet move. */
export const INV_INPUTS = ['shot']

export interface InvState {
  /** ★ RAW BYTES, never a number — see the note on SAMEBYTES in the program. */
  alive: number[]; count: number; cur: number
  x: number; y: number; dx: number; score: number; over: number
}

/** Bit `k` lives in byte `6 - k/8`, because a shift walks a byte string from its END. */
const byteOf = (k: number): number => INV_BYTES - 1 - Math.floor(k / 8)
export const invAlive = (alive: number[], k: number): boolean =>
  k >= 0 && k < INV_SLOTS && ((alive[byteOf(k)] >> (k % 8)) & 1) === 1

/** A full fleet: all 55 bits set — 0x7f then six 0xff. */
export const invNew = (): InvState => ({
  alive: [0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
  count: INV_SLOTS, cur: 0, x: 0, y: 0, dx: 1, score: 0, over: 0,
})

/**
 * The same rules in TypeScript — written from the rules, not from the script, so that a disagreement
 * means one of them departed from the game rather than that one copied the other's mistake.
 */
export function invRef(st: InvState, shot: number): InvState {
  if (st.over !== 0) throw new Error('the game is over')
  let { count, cur, x, y, dx, score } = st
  const alive = st.alive.slice()
  const k = shot - 1
  if (invAlive(alive, k)) { alive[byteOf(k)] ^= 1 << (k % 8); count -= 1; score += 10 }
  cur += 1
  if (cur >= count) {
    cur = 0
    const nx = x + dx
    if (nx > 4 || nx < 0) { dx = -dx; y += 1 } else { x = nx }
  }
  let over = 0
  if (y >= INV_FLOOR) over = 1
  if (count === 0) over = 2
  return { alive, count, cur, x, y, dx, score, over }
}

/** The fleet as rows of text — for a person, and for a test somebody has to be able to read. */
export function invShow(st: InvState): string {
  const rows: string[] = []
  for (let r = 0; r < INV_ROWS; r++) {
    let line = ''
    for (let c = 0; c < INV_COLS; c++) {
      const k = r * INV_COLS + c
      line += (invAlive(st.alive, k) ? 'W' : '.') + ' '
    }
    rows.push(' '.repeat(st.x * 2) + line.trimEnd())
  }
  return rows.join('\n')
}

/**
 * ★ How many transactions one sweep of the fleet costs, at a given number of aliens.
 *
 * This is the 1978 ramp stated as arithmetic: a sweep advances `cur` once per spend and completes when
 * `cur` reaches `count`, so it is exactly `count` spends. ⚠ `test/invaders.ts` does NOT trust this —
 * it counts real spends and checks they agree.
 */
export const invSweepCost = (aliveCount: number): number => Math.max(aliveCount, 1)
