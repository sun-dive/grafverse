// © BSV Association — Open BSV License v6.
/**
 * ★ THE FUEL DEPOT — step 2: the FRAME.
 *
 * A tank anyone may fill, feeding cars anyone may drive. It exists for OPERATIONS, not security: one
 * place to donate, one balance to show, one contributor leaderboard, and cars that refill themselves
 * instead of being hand-filled between races.
 *
 *   donations ──▶ DEPOT ──▶ PUBLIC CAR ──▶ mining fees
 *                             ↑    ↓
 *                             reset, race again
 *
 * ── WHAT IS IN THIS FILE, AND WHAT IS DELIBERATELY NOT ────────────────────────────────────────────
 * The frame ONLY. It proves the depot can rebuild itself exactly and refuses anything else. No value
 * rule, no car check, no burn — those are step 3, each with its own test, added one at a time.
 *
 * ★ This is the step people skip, and the one where the hardest bugs live. The battery's worst bugs
 * were all in this layer rather than in its arithmetic, and met later they every one of them look like
 * logic bugs. Prove the plumbing first or debug it disguised as physics later.
 *
 * ── ⚠ STATELESS, AND WHY THAT IS THE WHOLE TRICK ──────────────────────────────────────────────────
 * The depot carries NO state. Its script is therefore the same bytes forever, which means:
 *
 *   · one constant script hash — so a car can name "a depot" without carrying a copy of one
 *   · no fields to peel and rebuild, so no `fieldOffset`, so no two-pass build
 *   · its balance lives in the OUTPUT VALUE, where a covenant can read it from its own preimage
 *
 * A stateless covenant cannot hold its own hash (a script containing its own hash is a quine problem
 * with no solution), so it derives itself from the preimage's `scriptCode` — the same trick the shell
 * and `selfReplicateCovenantOps` already use.
 */
import { OP, Hash, LockingScript, UnlockingScript, type ScriptChunk } from '@bsv/sdk'
import {
  pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants,
} from './pushtx.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { RACER_REGS, PUBLIC_CAR_REGS, SHELL_TANK_MAX, tankMaxFor, FIELDS, FIELD_WIDTHS } from './shell.ts'
import { op, PN } from './covenantAsm.ts'

/** A byte-count for OP_SPLIT — always small, and never a script NUMBER. Kept apart from `PN` on purpose. */
const AT = (n: number): ScriptChunk => pushData([n])

/**
 * Op fragment: consumes a verified preimage and leaves this input's own VALUE (8 bytes, little-endian).
 *
 * ⚠ The value sits 52 bytes from the end: the trailing 52 are
 * value(8) ‖ nSequence(4) ‖ hashOutputs(32) ‖ nLocktime(4) ‖ sighashType(4). A fixed offset from the
 * END, because the scriptCode in front of it is not a fixed length.
 *
 * ★ This is how a covenant knows its own balance. It is not told — it reads it out of the transaction
 * it is being asked to authorise, which is the only figure it can trust.
 */
export function extractValueOps(): ScriptChunk[] {
  return [
    op(OP.OP_SIZE), AT(52), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),   // tail 52 bytes
    AT(8), op(OP.OP_SPLIT), op(OP.OP_DROP),                                   // first 8 = value
  ]
}

/** SIGHASH_ALL | FORKID. hashOutputs must be REAL, so ANYONECANPAY is not available to this covenant. */
export const DEPOT_SCOPE = 0x41

/**
 * ★ DRAW — the most fuel one spend may move out of the tank. ONE TAP OF THE PUMP.
 *
 * ⚠ A CEILING PER SPEND, NOT A FIXED INCREMENT. The value rule is a floor (`out ≥ V − DRAW − MAX_FEE`),
 * so a spend may always take LESS. A driver who wants 6,000 takes 6,000 in one tap. That is why raising
 * this number costs nothing in granularity — it only lowers the number of transactions a big fill needs.
 *
 * ── ⚠⚠ AND THE "BOTH WANT IT SMALL" ARGUMENT WAS HALF WRONG ───────────────────────────────────────
 * This was 10,000, justified by two jobs said to pull the same way: bounding how fast a depot can be
 * emptied, and being the increment a driver fuels in. **The first job is nearly illusory, and
 * `depot-drain` measures it.** A small DRAW does not stop a tank being emptied — a griefer with no key
 * and no coin simply taps more often, and pays nothing either way. All it changes is the number of
 * transactions, and since every one of them burns MAX_FEE out of the tank, a SMALLER draw makes the
 * griefing COST THE OWNER MORE:
 *
 *   DRAW 10,000   a 100,000 tank is 10 forced taps from empty   8,370 sat to miners
 *   DRAW 20,000   …5 forced taps                                4,185 sat to miners
 *
 * ⇒ The anti-drain half wanted it small and bought almost nothing; the fee half wants it large and
 * buys real satoshis. The skim bound is MAX_FEE and is untouched by this — whatever leaves must still
 * arrive in the car, to within one fee. So the number is set by FUELLING, and nothing else.
 *
 * ── ★ WHY FUELLING IS A DECISION, NOT A FORMALITY ─────────────────────────────────────────────────
 * Fuel is MASS. Carrying more of it costs acceleration, and the extra weight burns extra fuel to move,
 * so overfilling is punished twice. Measured on the bench, without anyone looking for it:
 *
 *   50,000 tank   HOME in 4.80 s · 48 ticks · burned 43,395
 *   60,000 tank   HOME in 5.40 s · 54 ticks · burned 48,669
 *
 * Ten thousand satoshis of insurance cost six tenths of a second. Tap too few times and you stop short
 * of the line with nothing to show; tap too many and a slower car beats you home.
 *
 * ⇒ At 20,000 a full tank is FOUR taps (20k · 20k · 20k · 11k) and a quarter mile is TWO. Each tap is
 * a transaction, so the ceiling is also what fuelling COSTS — which is the right shape: pumping is not
 * free, it is just no longer charged five times for one fill.
 * ⚠ It was THREE until the RESERVE was added ON TOP of the tank, taking the cap 50,000 → 71,000. A
 * number derived from two constants has to be re-derived when either of them moves.
 *
 *   fill to the 50,000 ceiling    5 taps → 3     4,185 → 2,511 sat of fees
 *   a quarter mile (~40,000)      4 taps → 2     3,348 → 1,674 sat
 *
 * ★ sun-dive's call, 16 Aug, and the reasoning holds: a race burns ~28,000 sat, so 1,674 saved on the
 * fuelling is about 6% off the cost of running one.
 *
 * ★ AND IT ONLY GOES ONE WAY. Not by rule but by construction: a public car has no branch that pays
 * anybody, so fuel that goes in can only ever leave as mining fees. Easy to put in, impossible to get
 * out — the physical intuition and the cryptographic property turn out to be the same sentence.
 *
 * ⚠ A top-up is legal in any phase the car has not MOVED in — `s` must be zero, which covers EMPTY,
 * CAR, TRACK and ARMED. A driver about to run dry at 300 m cannot tap: fuel is mass, so a mid-race
 * splash was measured as the dominant line rather than a rescue, and there is no pit lane on a quarter
 * mile. → `carRecognitionOps`, and `depot-dry.ts` drives what is left instead.
 */
export const DEPOT_DRAW = 20_000

/**
 * ★ MAX_TANK — FOUR taps at DRAW 20,000 (20k · 20k · 20k · 11k), and the pump stops filling that car.
 *
 * A cap on how much fuel one car may hold, enforced where it cannot be argued with. Overfilling is
 * already punished by the physics — fuel is mass — but a cap makes the pump's behaviour a property of
 * the system rather than a courtesy of the page, and it bounds how much of the tank one car can be
 * holding at any moment.
 */
/* ── ★★ AND IT IS NOW THE ONLY COPY OF THIS RULE (sun-dive, 16 Aug) ──────────────────────────────
   The public car carried the same ceiling — `out ≤ max(V, TANK_MAX)`, eleven bytes — and it has been
   deleted from the car and left here. Two reasons, and the first is why the second is worth having:

     WHOSE RULE IT IS   it never protected the car. A heavy car only hurts its own driver, and fuel is
                        MASS, which is the punishment. It protects everyone ELSE'S access to a shared
                        tank — this covenant's business, and this is the covenant that can see it.
     WHAT IT COST       a lock is paid for TWICE in every move, so eleven bytes in the car was
                        twenty-two on every one of ~45 ticks, forever. Here it is eleven bytes on a
                        spend that happens a handful of times a race.

   ⇒ The earlier note said the duplication was the demonstration — "two covenants arriving at the same
   bound by their own reasoning". It was not. When the two agreed, this copy could never bind, because
   the car is an output of the same transaction and refused the same fill by itself; when they drifted
   apart, the tighter one won in silence. Redundant when right, harmful when stale.

   ⚠⚠ IT MUST STILL MATCH THE CAR IT FUELS, and that is a different claim from being duplicated. This
   was `SHELL_TANK_MAX` while the car being raced holds `SHELL_TANK_MAX + RESERVE` — so the pump would
   have refused the last 21,000 satoshis, which are the reserve, which is the rule it exists to
   deliver. Derived from the car's own ceiling now, so the two cannot part company. */
export const DEPOT_MAX_TANK = tankMaxFor(PUBLIC_CAR_REGS)

/**
 * ★ MEASURED — `depot-fee` serializes a real spend and derives this. Was 500, then 516, and BOTH were
 * fatal for the transaction this depot exists to make.
 *
 * ⚠⚠ THE MOST DANGEROUS CONSTANT IN THIS FILE. The value rule lets a spend take at most
 * `DRAW + MAX_FEE` out of the tank, so MAX_FEE is a ceiling on the fee any spend can pay. There is no
 * key to raise it: set below what a real spend costs at the 100 sat/KB floor and the depot is
 * UNSPENDABLE FROM BIRTH, with every satoshi ever donated to it locked away forever.
 *
 * ── ⚠⚠ AND 516 WAS MEASURED ON THE WRONG TRANSACTION, WITH EVERY TEST GREEN ────────────────────────
 * It was derived from a DRAW — one input, the depot creating a fresh car — because that is what the
 * depot had been built to do. The spend it is actually for is a REFUEL, where the car is an INPUT as
 * well, so its 1,744-byte script is paid for again inside its own preimage:
 *
 *   draw     5,452 B   →  546 sat
 *   refuel   8,344 B   →  835 sat      ◀ at 516 that is 61.8 sat/KB. Not relayed. Ever.
 *
 * ── ⚠⚠ AND THEN 837 WAS MEASURED ON THE WRONG CAR — the FIFTH time, 16 Aug ─────────────────────────
 * It was derived from a refuel of the DEFAULT public car. The depot's genesis pins the car actually
 * being RACED, which carries the RESERVE and is 24 bytes longer — and a refuel carries that script
 * THREE times over: inside the car's own preimage, inside this depot's `prefixOutputs`, and as output
 * zero. So 24 bytes of car is 72 bytes of transaction:
 *
 *   refuel · default car   8,317 B  →  832 sat
 *   refuel · the car it fuels   8,389 B  →  839 sat      ◀ at 837 that is 99.8 sat/KB. Never relayed.
 *
 * ⇒ Same lesson, fifth time, and the first time it was caught BEFORE the mint rather than after: **a
 * bound must cover the worst spend the covenant can legally be asked to make, and the CAR IS AN INPUT
 * TO THAT.** Re-run `depot-fee` after any change to EITHER script, and make sure it is measuring the
 * car this depot will actually be minted against.
 *
 * ⚠ 841 → 844 when the owner pin and the `s = 0` rule were added: 25 bytes of depot script, and a
 * depot's own script appears twice in a refuel too — once inside its preimage and once as output 1.
 * Every rule in either covenant moves this number. It is measured, never reasoned about.
 */
export const DEPOT_MAX_FEE = 844

/**
 * ★★ EMPTY FOR THE RACE IS NOT EMPTY FOR FUNCTIONALITY.
 *
 * The burn threshold was DRAW, which is wrong: a tank holding one satoshi under a draw is not empty at
 * all — it can still fuel a short run. Burning it destroys usable fuel AND hands the owner ten thousand
 * satoshis for nothing. Those are two different questions:
 *
 *   empty for the RACE           cannot fund a full race          → a short race, not a dead tank
 *   empty for FUNCTIONALITY      cannot buy a single move         → nothing left to do. Clear it.
 *
 * ⇒ DERIVED, not chosen: the least a depot must hold to deliver even one tick of racing is one move's
 * fuel plus the cost of delivering it. Below that it can buy nothing, for anybody, ever.
 *
 * The practical effect is that the owner's maximum possible take falls from 9,999 satoshis to under
 * 900 — a hundredth of a cent — which is the difference between "you can take a bit" and "there is
 * nothing there to take".
 */
export const DEPOT_BURN_BELOW = PUBLIC_CAR_REGS.BURN0 + DEPOT_MAX_FEE

/**
 * The car script's constant HEAD: three 2-byte header pushes, then the push opcode of the first field.
 * After it comes the first field's DATA, which is where a car stops being constant.
 */
export const CAR_HEAD_BYTES = 3 * 2 + 1

/**
 * ★★ A CAR IN ANY PHASE IT HAS NOT MOVED IN — the shape the depot recognises.
 *
 * The depot used to pin ONE hash of the whole car script. That recognises a car in ONE state and
 * nothing else, because any change of state is a change of script bytes and so of hash. It made
 * fuelling and RESETTING the same act: a driver could not top up a car they had already configured
 * without throwing the configuration away.
 *
 * ⇒ So pin what does not vary and skip what does. Measured, not assumed — across phases the ONLY bytes
 * that differ are the thirteen fields' DATA. A car at EMPTY, CAR, TRACK or ARMED is fuelled by the
 * same walk, which is what this rewrite bought.
 *
 * ⚠ ONE FIELD IS NOT SKIPPED: `s` must be zero — see the note inside. The shape work says "this is a
 * car"; that one comparison says "and it has not left the line yet".
 *
 *   lock 1756 B  =  HEAD [0,7)  ‖  state region [7,117)  ‖  TAIL [117,1756)
 *   state region =  13 data slices (98 B) interleaved with 12 push opcodes
 *
 * ── ⚠⚠ AND WHY THE TWELVE OPCODES ARE PINNED TOO, WHICH LOOKS LIKE FUSSINESS AND IS NOT ─────────────
 * The obvious version pins HEAD and TAIL only and lets the 110 bytes between them be anything. That
 * hands an attacker 110 free bytes AT THE START OF A SCRIPT — executable positions, not payload. A
 * spliced `OP_0 OP_IF` there swallows the covenant's own VERIFYs up to a matching ENDIF in the tail,
 * and what the depot pays out is then not a car but a script somebody else can spend. The depot's whole
 * job is refusing that: "without this the depot is not a tank but a faucet".
 *
 * ⇒ Pinning the twelve inter-field push opcodes leaves every free byte inside a PUSH — payload, which
 * is never executed. That is the difference between a rule that is probably safe and one that is safe
 * by construction, and it is the only version worth having here.
 *
 * ★ It costs ~140 bytes, and those bytes are nearly free: the depot's script is paid for on a TAP, not
 * on a tick. The CAR is what appears on every move of every race, and the car does not change.
 */
export interface CarShape {
  /** varint(len) ‖ the head — an output's script-length prefix and the constant bytes before field 1. */
  headField: number[]
  /** The thirteen field widths, in `FIELDS` order. Each is also the push opcode that precedes it. */
  widths: number[]
  /**
   * ★★ THE OWNER'S HASH, PINNED — the one field's DATA that may not vary.
   *
   * ⚠⚠ WITHOUT IT THE DEPOT FUELS ANYBODY'S CAR, WHICH IS THEFT AND NOT GRIEFING. The walk skips
   * every field's data so a car may be fuelled in any phase, on any track, with any engine — and
   * `driver` is a field, holding the OWNER in a public car. Measured, before this existed:
   *
   *     a SECOND car, same owner (identical script, different outpoint)   FUELLED ✔  ← wanted
   *     a car owned by SOMEBODY ELSE                                      FUELLED ⚠⚠ ← paid for
   *
   * ⇒ mint your own public car for one satoshi, tap the pump keylessly, then BURN it with your own
   * key and keep the fuel. The burn is owner-only, and the thief is the owner — of their own car.
   *
   * ★ IT EXISTS ONLY BECAUSE THE BURN DOES. A car with no owner key has no branch that pays a person,
   * so "any car of this shape" and "the car" become the same sentence and this pin is unnecessary.
   * It is here for exactly as long as the burn is.
   */
  owner: number[]
  /** SHA256 of everything after the last field's data — the whole covenant body. */
  tailHash: number[]
  /** Offset of the first byte of the tail, for tests and tools that want to check the arithmetic. */
  stateEnd: number
}

/**
 * Derive the shape from a real car script — and REFUSE if the script does not have it.
 *
 * ⚠ The guard is the point. A layout change in the shell (a field added, a width widened, the header
 * moved) would otherwise produce a depot that pins the wrong offsets and recognises nothing, or worse
 * recognises the wrong thing — discovered on mainnet, with no key to fix it. Here it is a build-time
 * throw. → the same reason `carShape` is called by the lock builder rather than trusted from a caller.
 */
export function carShape(carScript: number[]): CarShape {
  const widths = FIELDS.map(k => FIELD_WIDTHS[k])
  if (carScript.length <= CAR_HEAD_BYTES) throw new Error(`car script too short: ${carScript.length} B`)
  if (carScript[CAR_HEAD_BYTES - 1] !== widths[0]) {
    throw new Error(`car layout: field 1 push opcode is ${carScript[CAR_HEAD_BYTES - 1]}, expected ${widths[0]}`)
  }
  let off = CAR_HEAD_BYTES
  let owner: number[] = []
  widths.forEach((w, i) => {
    if (FIELDS[i] === 'driver') owner = carScript.slice(off, off + w)
    off += w
    if (i === widths.length - 1) return
    if (carScript[off] !== widths[i + 1]) {
      throw new Error(`car layout: push opcode for ${FIELDS[i + 1]} is ${carScript[off]} at ${off}, expected ${widths[i + 1]}`)
    }
    off += 1
  })
  if (off >= carScript.length) throw new Error('car layout: no tail after the state region')
  /* ⚠ AN ALL-ZERO OWNER PINS NOTHING AND LOOKS EXACTLY LIKE PINNING SOMETHING. `freshPublicShell`
     always carries a real hash160; all zeros means the caller handed in an unclaimed OWNED shell by
     mistake, and a depot built from it would fuel every car in the world. */
  if (owner.length !== FIELD_WIDTHS.driver || owner.every(b => b === 0)) {
    throw new Error('car layout: the owner field is missing or all zero — that depot would fuel anybody')
  }
  return {
    headField: [...varint(carScript.length), ...carScript.slice(0, CAR_HEAD_BYTES)],
    widths,
    owner,
    tailHash: Hash.sha256(carScript.slice(off)),
    stateEnd: off,
  }
}

/**
 * Op fragment: consumes ONE serialized output and leaves its value, having proved the output is a car.
 *
 * In:  [ .., out ]        an output as value(8) ‖ varint ‖ script
 * Out: [ .., carValue ]   …and the script was a car, in whatever phase
 *
 * Nothing is parsed and nothing is trusted. It walks the script at constant offsets, and if the output
 * is shorter than a car OP_SPLIT fails and the spend dies.
 */
export function carRecognitionOps(shape: CarShape): ScriptChunk[] {
  const ops: ScriptChunk[] = [
    AT(8), op(OP.OP_SPLIT),                                        // [ valueBytes, rest ]
    op(OP.OP_SWAP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK),       // alt:[ .., carValue ]  ·  [ rest ]

    /* The length prefix and the head, as one constant — cheaper to compare outright than to hash. */
    AT(shape.headField.length), op(OP.OP_SPLIT),
    op(OP.OP_SWAP), pushData(shape.headField), op(OP.OP_EQUALVERIFY),
  ]

  shape.widths.forEach((w, i) => {
    /* ── ★★ ONE FIELD IS NOT SKIPPED: `s`, AND IT MUST BE ZERO (sun-dive, 16 Aug) ─────────────────
       THE PUMP WILL NOT FILL A CAR THAT HAS LEFT THE LINE. Four opcodes, on a spend that happens a
       few times a race, and they delete a whole rule from the car.

       ⇒ WHAT THIS REPLACES. Fuel arriving mid-race is worth having: fuel is MASS, so starting light
       and topping up once you are already moving beats carrying it off the line. Measured, at the
       regulations being raced —

         best single fill        49,000 sat  →  3.9 s
         28,000 + one 20,000 tap at tick 9   →  3.3 s on 48,000 sat   ★ faster AND cheaper

       — which is a DOMINANT strategy, and a dominant strategy is not a strategy. The car used to
       price it: a `PIT` rule stopped any car that took on fuel, for 27 bytes of locking script paid
       for TWICE on every one of forty-five ticks. This is the same rule for about five bytes, paid a
       handful of times, because the depot is the party that can simply decline.

       ★ AND IT IS THE HONEST RULE, which is why it is not a compromise: there is no pit lane on a
       quarter mile. A run that is going to fall short coasts on its RESERVE and hopes.

       ⚠ IT DOES NOT MAKE MID-RACE FUELLING IMPOSSIBLE, only unfundable from HERE. A driver may still
       pay their own satoshis into their own car at speed — it costs them real money, needs their
       signature, and leaves a funded input sitting in the middle of a race chain forever. That is
       visible to anyone and a leaderboard can decline to rank it, the same standard already accepted
       for car provenance and for the pot.

       ⚠ AND IT COSTS THE SHAPE WORK NOTHING. Recognising a car in ANY phase is still what makes this
       usable: `s` is zero all through EMPTY, CAR, TRACK and ARMED, so a driver can fuel a car that is
       already configured without resetting it. What the old one-hash depot could not do, this still
       does; what it never should have done, it now refuses. */
    /* ── ★★ THE OWNER, PINNED — see `CarShape.owner` for what it costs and what it buys ───────────
       Twenty-two bytes on a spend that happens a few times a race, against a thief minting their own
       car for one satoshi and burning the tank out through it. */
    if (FIELDS[i] === 'driver') {
      ops.push(AT(w), op(OP.OP_SPLIT), op(OP.OP_SWAP), pushData(shape.owner), op(OP.OP_EQUALVERIFY))
      if (i === shape.widths.length - 1) return
      ops.push(AT(1), op(OP.OP_SPLIT), op(OP.OP_SWAP),
        pushData([shape.widths[i + 1]]), op(OP.OP_EQUALVERIFY))
      return
    }
    if (FIELDS[i] === 's') {
      /* BIN2NUM rather than a seven-byte literal comparison — the field is sign-magnitude and its own
         covenant reads it the same way, so the two agree about what zero is. */
      ops.push(AT(w), op(OP.OP_SPLIT), op(OP.OP_SWAP),
        op(OP.OP_BIN2NUM), op(OP.OP_0), op(OP.OP_NUMEQUALVERIFY))
      if (i === shape.widths.length - 1) return
      ops.push(AT(1), op(OP.OP_SPLIT), op(OP.OP_SWAP),
        pushData([shape.widths[i + 1]]), op(OP.OP_EQUALVERIFY))
      return
    }
    /* Skip this field's DATA — the bytes a car is allowed to change. */
    ops.push(AT(w), op(OP.OP_SPLIT), op(OP.OP_NIP))
    if (i === shape.widths.length - 1) return
    /* …and pin the push opcode that introduces the next one, so the skipped bytes stay payload. */
    ops.push(AT(1), op(OP.OP_SPLIT), op(OP.OP_SWAP),
      pushData([shape.widths[i + 1]]), op(OP.OP_EQUALVERIFY))
  })

  /* Whatever is left is the covenant body, and it is the same in every car ever built. */
  ops.push(op(OP.OP_SHA256), pushData(shape.tailHash), op(OP.OP_EQUALVERIFY))
  return ops
}

/**
 * ★ THE FRAME. Stack on entry, bottom to top:
 * [ prefixOutputs, burn, sig, pubKey, spenderOutputs, newValue, preimage ].
 *
 *   prefixOutputs    every output BEFORE the depot's own, serialized as value(8) ‖ varint ‖ script
 *   spenderOutputs   every output AFTER it, the same way
 *   newValue         the 8-byte little-endian value of the depot's successor
 *   preimage         the BIP143 sighash preimage, which OP_PUSH_TX proves is this transaction's own
 *
 * What it enforces, and nothing more:
 *
 *   HASH256( prefixOutputs ‖ newValue ‖ myOwnScriptCode ‖ spenderOutputs ) == hashOutputs
 *
 * ── ★★ WHY A PREFIX EXISTS AT ALL — THE BUG THIS FILE WAS BUILT AROUND ────────────────────────────
 * The depot used to rebuild itself at OUTPUT 0 and treat everything after as the spender's. So does the
 * car: `HASH256( newValue ‖ scriptCode ‖ spenderOutputs )` puts it first too. Each alone is fine. A
 * REFUEL spends BOTH — two covenants, two inputs, one transaction — and then both demand slot zero and
 * neither can move. Measured both ways, which is the only reason it was believed:
 *
 *   depot at out0  →  the car refuses
 *   car   at out0  →  the depot refuses
 *
 * ⇒ The car cannot move: it is on mainnet, its layout is published as BITCOIN RACER v2, and its script
 * is paid for twice on every tick of every race. So the DEPOT moves, and it moves by learning to sit
 * anywhere rather than by swapping one hard-coded slot for another:
 *
 *   a top-up        prefix empty        depot at out0
 *   a refuel        prefix = the car    car at out0, depot at out1   ← the car gets the slot it needs
 *
 * One construction, no second branch, and the old behaviour is the case where the prefix is empty.
 *
 * ⚠ AND IT BINDS EVERY OTHER OUTPUT TOO. Prefix and suffix are concatenated into the same hash, so a
 * transaction cannot quietly add an output the covenant never saw — which is what lets the depot say
 * "whatever I do not keep goes to the car" rather than merely "out0 is me".
 */
export function depotLockOps(
  p: { carScript: number[]; owner: number[]; draw?: number; maxFee?: number; maxTank?: number; burnBelow?: number; c?: PushTxConstants },
): ScriptChunk[] {
  const draw = p.draw ?? DEPOT_DRAW
  const maxFee = p.maxFee ?? DEPOT_MAX_FEE
  const maxTank = p.maxTank ?? DEPOT_MAX_TANK
  const burnBelow = p.burnBelow ?? DEPOT_BURN_BELOW
  const c = p.c ?? pushTxConstants(DEPOT_SCOPE)

  /* ★ THE CAR, AS A SHAPE RATHER THAN A SNAPSHOT — head, twelve pinned push opcodes, tail. A car at
     REST is one constant and would have been one hash; a car at 300 m is not, and fuelling one is the
     whole point of a depot. See `carShape` for why the opcodes are pinned as well as the ends. */
  const car = carShape(p.carScript)
  if (p.owner.length !== 20) throw new Error(`the owner must be a 20-byte hash160, got ${p.owner.length}`)

  /* ★ THE MOST A SINGLE SPEND MAY COST THE TANK. One number, so there is one place to be wrong and
     one place to change it — and the covenant never learns them apart, which is the point: whether a
     satoshi left as fuel or as a miner's fee is not the depot's business. */
  const drain = draw + maxFee

  return [
    /* ── ★ THE OWNER BURN — THE UPGRADE PATH, AND THE ONLY BRANCH THAT PAYS ANYBODY ─────────────────
       A covenant cannot be amended. Replacing a design means burning what exists and minting its
       successor, so a depot with no owner would strand its whole balance in v1 the day a better one
       existed. Permanence is right when it IS the demonstration; here the demonstration is the racing,
       and a depot is equipment. Equipment should be replaceable.

       It enforces NO OUTPUTS, exactly as PharLap's editions do: the owner's SIGHASH_ALL signature
       already commits to every one of them, so by signing they have said where the money goes. There
       is nothing left for a covenant to check.

       ⚠ AND IT IS FIRST, before a single rule below it. Everything else in this script constrains
       where fuel may go; the owner is the one party allowed to ignore all of it, so the branch has to
       sit outside those rules rather than inside them.

       Stack, bottom to top: [ PRE, burn, sig, pubkey, SO, newValue, preimage ]. The three burn pushes go
       DEEPEST so every depth the rest of the script measures from the top stayed exactly where it was —
       and `prefixOutputs` was later slid in BELOW even those, for the same reason and with the same
       result: not one depth in this script changed when the prefix was added. */
    PN(5), op(OP.OP_PICK), op(OP.OP_IF),
      /* ★★ AND ONLY WHEN THE TANK IS EMPTY — which is what makes even the OWNER unable to run off
         with it. "Empty" means empty for FUNCTIONALITY, not empty for the race: below one move's fuel
         plus the cost of delivering it, so the tank can buy nothing for anybody, ever. A tank that can
         still fund a short run is not empty and may not be cleared.

         ⇒ The upgrade path survives untouched, because it never needed the balance to MOVE. Deploy the
         successor alongside, point the page at it, let the old one drain through actual racing, then
         clear the husk. Exactly how the shell's headstone works.

         ⇒ And the honest sentence the page was going to need — "a donor is trusting the owner not to
         sweep this" — is no longer true, so it is no longer needed. The most an owner can ever take is
         one satoshi under a DRAW.

         ⚠ THE COST, STATED: this removes the rescue hatch. If the car path turns out to have a bug, a
         funded depot's balance can only leave through cars, and no owner override exists to retrieve
         it. Mitigation is the sensible thing anyway — do not put much in the tank until it is proven. */
      /* ⚠ AND "NO RESCUE HATCH" IS NOT THE COST OF THIS RULE, which is worth stating because the
         opposite was believed for a while. **A funded depot always has an exit through RACING**:
         anyone may tap the pump, the fuel lands in cars, and a car either burns it down the track or
         is swept by its owner. The balance is never stuck — the path is simply longer.

         ⇒ Which is why the DEPOT can afford a threshold that the CAR could not. A bricked car has no
         other way out, so its burn is unconstrained; a depot has one, so its burn can be gated and buy
         something real: a promise to donors that the tank will not be swept while it is still useful.

         ⚠ A PROMISE TO DONORS is what this is, and how it should be described. Written as "not even
         the OWNER can take it" it reads as a defence against the person paying the bills, which is
         both wrong and insulting to the only party funding the thing. */
      op(OP.OP_DUP), ...extractValueOps(), op(OP.OP_BIN2NUM),
      PN(burnBelow), op(OP.OP_LESSTHAN), op(OP.OP_VERIFY),

      PN(3), op(OP.OP_PICK), op(OP.OP_HASH160),          // the key offered…
      pushData(p.owner), op(OP.OP_EQUALVERIFY),          // …must be THE owner's
      PN(4), op(OP.OP_PICK), PN(4), op(OP.OP_PICK),      // the signature, and the key again
      op(OP.OP_CHECKSIG), op(OP.OP_VERIFY),
      // nothing survives a burn — seven pushes now, since the prefix joined them
      op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP),
      op(OP.OP_1),
    op(OP.OP_ELSE),

    ...pushTxVerifyOps(c),                  // [ SO, newV, preimage ]           ← the preimage is real

    /* ★ READ ITS OWN BALANCE FIRST, while the preimage is still whole. Stashed on the altstack so the
       frame below is untouched — and there are no branches in this script, so the altstack cannot get
       out of step between arms the way it can in the shell. */
    op(OP.OP_DUP),                          // [ SO, newV, pre, pre ]
    ...extractValueOps(),                   // [ SO, newV, pre, V ]
    op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK), // alt:[V]  ·  [ SO, newV, pre ]

    op(OP.OP_DUP),                          // [ SO, newV, pre, pre ]
    ...extractHashOutputsOps(),             // [ SO, newV, pre, hashOutputs ]
    op(OP.OP_SWAP),                         // [ SO, newV, hashOutputs, pre ]
    ...extractScriptCodeFieldOps(),         // [ SO, newV, hashOutputs, scriptCodeField ]

    /* ── ★ THE VALUE FLOOR ────────────────────────────────────────────────────────────────────────
       out0 ≥ V − (DRAW + MAX_FEE). A FLOOR and not an equality, which is what makes a top-up free:
       anyone may hand back MORE than they took and the covenant is satisfied. The battery's whole
       funding mechanism is this one comparison, and the depot inherits it for nothing. */
    PN(2), op(OP.OP_PICK), op(OP.OP_BIN2NUM),  // [ .., scField, out0value ]
    op(OP.OP_FROMALTSTACK),                    // [ .., out0value, V ]      alt empty

    /* ⚠ DID ANY FUEL ACTUALLY LEAVE? Stashed before the floor consumes both numbers.
       This is the difference between "the depot must always mint a car" — which would force a plain
       DONATION to mint one too, absurdly — and the rule that is actually wanted:

           ★ whatever leaves the depot must go to a car. If nothing leaves, nothing is required.

       A top-up therefore stays what it was in step 3a: a spend that hands back more and is asked for
       nothing else. */
    op(OP.OP_2DUP), op(OP.OP_SWAP), op(OP.OP_SUB), op(OP.OP_TOALTSTACK),   // alt:[left = V − out0]
    op(OP.OP_2DUP), op(OP.OP_LESSTHAN), op(OP.OP_TOALTSTACK),              // alt:[left, fuelLeft]

    PN(drain), op(OP.OP_SUB),                  // [ .., out0value, floor ]
    op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),   // [ SO, newV, hashOutputs, scriptCodeField ]

    /* ── ★ AND IF FUEL LEFT, THE OUTPUT BEFORE THIS ONE IS A CAR ──────────────────────────────────
       The car is the FIRST entry of prefixOutputs — out0, the slot its own covenant insists on. The
       depot walks it at constant offsets and never parses anything: if the output is shorter than a
       car, OP_SPLIT fails and the spend dies. See `carRecognitionOps`.

       ⚠ AND IT WORKS IN ANY PHASE, which is the change this whole file exists for. The old rule pinned
       one hash of a car AT REST, so taking fuel meant giving up the run. */
    op(OP.OP_FROMALTSTACK),                    // [ .., scField, fuelLeft ]
    op(OP.OP_IF),
      PN(7), op(OP.OP_PICK),                   // a copy of prefixOutputs
      ...carRecognitionOps(car),               // alt:[ left, carValue ]  ·  [ .., scField ]

      /* ── ★ THREE TAPS AND THE PUMP STOPS ───────────────────────────────────────────────────────
         A cap on what one car may hold. Overfilling is already punished by the physics, but a cap
         makes it a property of the system rather than a courtesy of the page. */
      op(OP.OP_FROMALTSTACK),                  // [ .., carValue ]        alt:[ left ]
      op(OP.OP_DUP), PN(maxTank), op(OP.OP_LESSTHANOREQUAL), op(OP.OP_VERIFY),

      /* ── ★★ AND WHAT LEFT THE DEPOT MUST ARRIVE ───────────────────────────────────────────────
         carValue ≥ (V − out_depot) − MAX_FEE. Without this the depot is not a tank but a faucet: take
         a full DRAW, hand the car ONE SATOSHI, and send the difference to yourself. Measured, not
         feared — the covenant accepted exactly that transaction before this line existed.

         ⚠ And it cannot be enforced at the pump. An attacker does not use the pump; they build the
         transaction by hand, and the covenant is the only thing standing there.

         ⚠⚠ NOTE WHAT THIS IS NOT. On a refuel the car ALREADY HELD fuel, and this rule reads its whole
         new value rather than the increment — so a car arriving with more than the draw satisfies it
         trivially. That is correct here: the depot's question is "did what I gave up land in a car",
         and the CAR's own covenant is what stops a car being drained in the same transaction. Two
         covenants, each answering its own half, neither able to read the other. */
      op(OP.OP_FROMALTSTACK),                  // [ .., carValue, left ]  alt: empty
      PN(maxFee), op(OP.OP_SUB),
      op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),
    op(OP.OP_ELSE),
      /* ⚠ THE ALTSTACK MUST COME OUT EVEN. `left` was pushed before the branch, so an arm that does
         not take it back leaves the two paths silently out of step — a class of bug that surfaces a
         hundred opcodes later wearing someone else's clothes. */
      op(OP.OP_FROMALTSTACK), op(OP.OP_DROP),
    op(OP.OP_ENDIF),

    /* Rebuild out0 as an output serialization: value(8) ‖ varint(len) ‖ script. `scriptCodeField`
       already carries its own length varint, which is exactly what an output needs after its value —
       so no length has to be computed, and none can be got wrong. */
    PN(2), op(OP.OP_ROLL),                  // [ .., SO, hashOutputs, scField, newV ]
    op(OP.OP_SWAP), op(OP.OP_CAT),          // [ .., SO, hashOutputs, mine ]

    /* ★ AND THE PREFIX GOES IN FRONT — the one line that lets the car have output zero. When the
       prefix is empty this concatenation is a no-op and the depot sits at out0 exactly as before, so
       the top-up and burn paths did not change behaviour, only notation. */
    PN(6), op(OP.OP_ROLL),                  // [ burn, sig, pub, SO, hashOutputs, mine, PRE ]
    op(OP.OP_SWAP), op(OP.OP_CAT),          // [ burn, sig, pub, SO, hashOutputs, PRE ‖ mine ]

    PN(2), op(OP.OP_ROLL),                  // [ burn, sig, pub, hashOutputs, PRE ‖ mine, SO ]
    op(OP.OP_CAT),                          // [ .., hashOutputs, PRE ‖ mine ‖ SO ]
    op(OP.OP_HASH256),                      // [ .., hashOutputs, HASH256(all outputs) ]
    op(OP.OP_EQUAL),                        // [ burn, sig, pubkey, bool ]

    /* ⚠ AND THE THREE BURN PUSHES MUST NOT BE LEFT LYING THERE. A standard spend has to finish with a
       clean stack — one true value and nothing else — so the ordinary path removes what it never used.
       OP_NIP three times rather than a trip through the altstack, which keeps both arms free of it. */
    op(OP.OP_NIP), op(OP.OP_NIP), op(OP.OP_NIP),
    op(OP.OP_ENDIF),
  ]
}

/**
 * The depot's locking script. ONE PASS — unlike the shell, which needs a two-pass build to size the
 * scriptCode varint around its own state. A stateless script has no such dependency on its length.
 */
export function buildDepotLock(p: Parameters<typeof depotLockOps>[0]): LockingScript {
  return new LockingScript(depotLockOps(p))
}

/** Bitcoin's variable-length integer, for the length prefix an output carries before its script. */
export function varint(n: number): number[] {
  if (n < 0xfd) return [n]
  if (n <= 0xffff) return [0xfd, n & 0xff, (n >> 8) & 0xff]
  return [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

/**
 * The unlocking half, in the order the covenant reads it — deepest first.
 *
 * ⚠ Every value is pushed on every spend, even when a later rule will not look at it, because the
 * covenant counts POSITIONS and not arguments. A missing push shifts every depth above it, and a
 * shifted depth never reports itself: it surfaces as OP_SPLIT complaining about a size, a hundred
 * opcodes from the cause.
 */
export function depotUnlockingOps(p: {
  /**
   * Every output BEFORE the depot's own, serialized. Empty for a top-up or a mint — the depot then
   * sits at out0, as it always did. On a REFUEL this is the car's output, because the car's covenant
   * rebuilds itself at out0 and cannot be persuaded otherwise.
   */
  prefixOutputs?: number[]
  spenderOutputs: number[]
  newValue: number[]
  preimage: number[]
  /** The owner's decision to retire this depot into its replacement. */
  burn?: boolean
  sig?: number[]
  pubKey?: number[]
}): ScriptChunk[] {
  if (p.newValue.length !== 8) throw new Error(`newValue must be 8 bytes little-endian, got ${p.newValue.length}`)
  return [
    // deepest first — the prefix below even the burn pushes, so no existing depth moved when it arrived
    pushData(p.prefixOutputs ?? []),
    PN(p.burn ? 1 : 0), pushData(p.sig ?? []), pushData(p.pubKey ?? []),
    pushData(p.spenderOutputs), pushData(p.newValue), pushData(p.preimage),
  ]
}

/** Convenience: the unlocking script itself. */
export function buildDepotUnlock(p: Parameters<typeof depotUnlockingOps>[0]): UnlockingScript {
  return new UnlockingScript(depotUnlockingOps(p))
}
