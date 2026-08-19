// © BSV Association — Open BSV License v6.
/**
 * ★★★ THE MINTING DEPOT, WRITTEN IN BITCOIN BASIC.
 *
 * The rules `racerDepot.ts` emits by hand, said once in a language a person can read — and read BACK
 * through `unbasic`, which is the whole reason the reader was built. Bootcamp rule 11: creating or
 * editing a covenant starts here, not at hand-emitted Script.
 *
 * ⚠ The frame that wraps this is `racerDepotFrame` — the preimage fields, the owner burn and the
 * output binding are not things BASIC can say, and `basicCovenant.ts` is explicit that its own frame is
 * a default rather than a law: *"the shell, the depot and the battery each answer 'what must my output
 * be?' differently."* The depot's answer is its own. The STATE and the ARITHMETIC are the compiler's.
 *
 * ── THE STACK THE FRAME PROVIDES, bottom first ────────────────────────────────────────────────────
 * ```
 *   prefixOutputs   the outputs before the depot's own — the car on a mint, empty on a top-up
 *   carblock        the bytes a car must END with. Pushed as a LITERAL by the lock, so it is the
 *                   depot's own constant and never something a spender chooses
 *   spenderOutputs  the outputs after the depot's
 *   newv            what the depot's successor will carry
 *   window          nLockTime / WINDOW — already divided, so the arithmetic below is all in windows
 *   V               what the depot holds now
 *   scsize          the size of its own scriptCode field, for the fee it is about to compute
 * ```
 */

/**
 * The names the frame must leave on the stack, bottom first. ⚠ ORDER IS THE INTERFACE — the compiler
 * measures every depth against this list, so a name in the wrong place is a script that builds, runs,
 * and compares the wrong bytes hundreds of opcodes later.
 *
 * ★ `burn`, `sig` and `pub` are declared even though the program never reads them. They are the owner
 * branch's arguments and they sit on the stack throughout, so the model has to know they are there.
 * ★ `newValue` is the RAW eight bytes, kept because the output serialization needs them; `newv` is the
 * same thing as a number, because the arithmetic needs that. Both, rather than converting twice.
 */
export const DEPOT_STACK = [
  'prefixOutputs', 'burn', 'sig', 'pub', 'spenderOutputs',
  'newValue', 'newv', 'carblock', 'fdmark', 'window', 'V', 'scsize',
] as const

export const DEPOT_SRC = `
REM ═══ THE DEPOT'S STATE ══════════════════════════════════════════════════
REM  mark — the window this depot is minting in.  n — mints used in it.
DIM mark%4
DIM n%1

REM ═══ THE WINDOW ═════════════════════════════════════════════════════════
REM  Time only moves forward. A window is a DIVIDED stamp, so bumping
REM  nLockTime by a second buys nothing until the window itself is crossed —
REM  and crossing it needs median time past to move, which needs a block.
VERIFY window >= mark
same = 0
IF window = mark THEN same = 1

REM ═══ DID ANYTHING LEAVE THE TANK? ═══════════════════════════════════════
REM  The difference between "every spend must mint a car" — which would force
REM  a plain donation to mint one, absurdly — and the rule that is wanted:
REM  whatever LEAVES must land in a car.
left   = V - newv
minted = 0
IF left > 0 THEN minted = 1

REM ═══ THE VALUE FLOOR ════════════════════════════════════════════════════
REM  A FLOOR and not an equality, which is what makes a top-up free: anyone
REM  may hand back MORE than they took and the covenant is satisfied.
VERIFY newv >= V - DRAIN

REM ═══ THE COUNTER ════════════════════════════════════════════════════════
REM  A mint spends a slot; a donation must not, or ten one-satoshi gifts
REM  close the window to everybody.
REM  newn <= PERWINDOW is one comparison covering both cases: on a repeat
REM  window it means n <= 9, on a fresh one it is trivially true.
newn    = n
newmark = mark
IF minted = 1 THEN newn = same * n + 1
IF minted = 1 THEN newmark = window
VERIFY newn <= PERWINDOW

REM ═══ AND IF VALUE LEFT, IT LANDED IN A CAR ══════════════════════════════
REM  Every name below exists before the branch: both arms of an OP_IF must
REM  leave the stack identical, so a name born in one is a name the other
REM  cannot account for.
head     = prefixOutputs
rest     = prefixOutputs
marker   = prefixOutputs
lenbytes = prefixOutputs
carscr   = prefixOutputs
front    = prefixOutputs
tail     = prefixOutputs
carvalue = 0
carbytes = 0
fee      = 0

IF minted = 1 THEN
  REM ── nothing else may be paid. Without this the fee allowance is
  REM    EXTRACTABLE: keep V - MAX_FEE, hand the car one satoshi, and put the
  REM    difference in a third output to yourself. A mint has exactly two
  REM    outputs, so anything unaccounted for went to a MINER — and paying a
  REM    miner is not extraction, because you do not get it.
  VERIFY SIZE(spenderOutputs) = 0

  REM ── prefixOutputs IS the car's output: value(8) | fd | len(2) | script
  head, rest = SPLIT(prefixOutputs, 8)
  carvalue = BIN2NUM(head)

  REM ── the length varint, pinned to its 3-byte form. A car is thousands of
  REM    bytes, so its length always serializes as fd | uint16; pinning the
  REM    marker means the two bytes after it ARE the length and nothing has
  REM    to be parsed.
  REM    ⚠⚠ fdmark is a one-byte LITERAL pushed by the frame, not a constant.
  REM    SAMEBYTES compares BYTE STRINGS, and the number 253 has its high bit
  REM    set, so a minimal script number for it is TWO bytes: fd 00. Compared
  REM    against the one byte fd that a real output carries, it never matches
  REM    and every mint fails. BIN2NUM is no better — fd read as a number is
  REM    sign-magnitude -125. ⇒ Compare a byte to a byte, and let the frame
  REM    supply it the same way it supplies carblock.
  marker, rest = SPLIT(rest, 1)
  VERIFY SAMEBYTES(marker, fdmark)
  lenbytes, carscr = SPLIT(rest, 2)
  carbytes = BIN2NUM(lenbytes)

  REM ── the declared length must be the real one, or the bound below is
  REM    checked against a number the spender wrote rather than the script
  REM    they supplied.
  VERIFY carbytes = SIZE(carscr)
  VERIFY carbytes <= MAXCAR

  REM ── and it ENDS with the block this depot pins. Split from the RIGHT,
  REM    so a car's length is irrelevant — which is what lets one depot mint
  REM    cars of every length, since a car's script IS its race.
  front, tail = SPLIT(carscr, carbytes - TAILLEN)
  VERIFY SAMEBYTES(tail, carblock)

  REM ── a ceiling on what one car may hold. A car needs its own race fee and
  REM    one satoshi; beyond that is satoshis walking out in a shape the
  REM    depot cannot follow.
  VERIFY carvalue <= DRAW

  REM ── IT WORKS OUT WHAT THE MINT COSTS AND DEMANDS THE REST BACK.
  REM    mint bytes = 2*carbytes + 2*depotbytes + 264, measured, exactly
  REM    linear; fee = ceil(bytes / 10) at the 100 sat/KB floor.
  REM    An extraction attempt should not even pay a miner; it should repay
  REM    the depot. Anything above the true cost has nowhere to go but out0.
  REM    scsize is depotbytes + 3, so 2*scsize carries a surplus 6, and +9
  REM    rounds the division up — hence 267 rather than 264.
  fee = (2 * carbytes + 2 * scsize + 267) / 10
  VERIFY left <= carvalue + fee
END IF

n    = newn
mark = newmark
`
