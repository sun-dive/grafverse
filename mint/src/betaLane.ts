// © 2026 sun-dive — Apache License 2.0.
//
// 🛤 THE LANE — a figure-8 slot car lane as ONE covenant, written in Bitcoin BASIC.
//
// Spec: `~/Documents/fuel-depot-spec.md` §7.7–§7.8. ⏳ DRAFT — nothing here has been minted, and the
// constants below are PROVISIONAL and marked as such.
//
// ⚠⚠⚠ THIS FILE IS REACHED ONLY BY `grafbeta.ts` → `vendor/grafbeta.js` → `racebeta.html`.
// It must never be imported by `grafracers.ts`, `grafmint.ts` or `grafbasic.ts`. The live racers page
// is a FLAWED FIRST IMPLEMENTATION that stays exactly as it is until this one is chosen, and a shared
// import is how it would stop being exactly as it is.
//
// ★★ WHAT MAKES THIS DIFFERENT FROM THE RACERS, in one line: the lane is MINTED ONCE and the physics
// lives in its genesis, so there is nothing emitted per race to anchor, compare or reproduce. The old
// design minted a car per race whose physics the PAGE chose — which is the defect §7.8 exists to fix.
//
// ★ AND THE SPECIALISER IS NOT USED. `specialiseRun` / `optimizeCarCompile` exist because the old car
// was compiled for one predicted run. A lane has no trace: the throttle arrives at runtime and the
// state carries forward, so this is a plain BASIC covenant through the untouched compiler.
/* ★ THE BETA'S OWN FRAME — forked so the sighash scope can be chosen without touching the file
   `basic.html`'s bundle is built from. Pinned to the original by `test/beta-frame.ts`. */
import { buildBasicLock, frameMaxFee } from './betaFrame.ts'
import { Hash } from '@bsv/sdk'
import { S, SLIP_UNIT, fmul, fdiv } from './shell.ts'

/** Fixed point: a real number `x` is stored as `round(x * S)`. */
export const f = (x: number): number => Math.round(x * S)

/**
 * ⚠⚠ PROVISIONAL, EVERY ONE OF THEM — and they are permanent once a lane is minted.
 *
 * ★ THE UNITS CHANGED, which is why these are not the racers' numbers. The deployed car steps in TIME
 * with `Δt` pinned at one tick (0.1 s), so its `v` is metres-per-tick. A lane steps in DISTANCE with
 * `Δt = Δs / v` falling out, so `v` is metres per SECOND and every rate constant is per second.
 * ⇒ Copying a number across would be wrong by a factor of ten and would look perfectly plausible.
 *
 * ⚠ CALIBRATION IS A SEPARATE JOB AND IT IS NOT DONE. `~/Documents/fuel-depot-spec.md` §8 requires `K`
 * to be MEASURED, not chosen; `DRAG2`'s real fit was already parked once. Nothing here may be minted
 * until each of these has a measurement behind it. → the five fee near-misses.
 */
export interface LaneRegs {
  M0: number; WE: number; WT: number; WF: number
  /**
   * ★★★ TOP SPEED IS THE MOTOR, NOT THE AIR — his testimony, and the arithmetic agrees: a 20 g car at
   * 2 m/s meets about 0.0012 N of aerodynamic drag, which is 0.06 m/s² of deceleration. Nothing.
   *
   * > *"Yes the limiting speed factor was the motor. And I bet the motor upgrade produced higher RPM.
   * > Drag is practically zero. It was all about the tyres and motor RPM."*
   *
   * ⇒ `VMAX_REF` is the top speed of a REFERENCE car at full throttle. A bigger motor spins faster; a
   * taller tyre covers more track per revolution; a part-open throttle is a lower voltage and therefore
   * a lower free speed. All three scale it.
   */
  VFREE: number
  /** Pull at the axle for the reference car at full throttle, before the wheel divides it. */
  F0: number
  /** ⚠ Rolling resistance, LINEAR in v. The quadratic aero term is gone — it was standing in for the
   *  motor's RPM limit, and doing it backwards: it made a TALLER tyre slower. */
  ROLL: number
  /**
   * ★★★ CONSTANT DRAG — the unpowered motor and gear train, and it is the term that lets a car STOP.
   *
   * > *"There was no brake but the cars stopped pretty fast if you let go of the trigger. Almost no
   * > momentum and probably a lot of drag from the unpowered motor."* (sun-dive, 21 Aug)
   *
   * ⚠⚠ A drag term LINEAR in v approaches zero and never arrives. Measured on the previous model: a
   * released car rolled **19.99 m — four laps — and was still moving after 92 s**. Coulomb friction
   * brings a body to rest in FINITE distance, which is the whole difference.
   * ⇒ Fitted from his answer: a few inches. `DRAGC = v_top² / (2 · coast)`.
   */
  DRAGC: number
  /**
   * ★★★ THE CONTROLLER IS A RHEOSTAT, and this is its resistance relative to the armature's.
   *
   * > *"The coil in the controller had probably about 50 turns. I pulled one apart to see how it
   * > worked."* (sun-dive, 21 Aug)
   *
   * A coil and a wiper is SERIES RESISTANCE, so lifting the trigger cuts the CURRENT — and therefore
   * the torque — while leaving the motor's free speed alone. The previous model had the trigger
   * scaling free speed, which is the wrong job: half trigger made you *slow* where it should make
   * you *weak*.
   * ⚠ Sourced, not guessed: T-Jets are run on **90 Ω** controllers and a stock armature measures
   * **15–21 Ω**, so the ratio is 4.3–6.0. Two independent fits landed on 4.0 and 5.4.
   */
  RC: number
  /** The engine and tyre diameter the two references above are quoted at. */
  ENG_REF: number; DIA_REF: number
  /** ★ THE DESLOT CONSTANT. `v² ≤ K·r` — and for a MAGNETLESS car `K = μ·g`, with the car's mass
   *  cancelling out entirely, so it is a property of TRACK AND TYRES rather than of the car.
   *  ⚠ A traction magnet breaks that (its downforce does not scale with mass), which is one more reason
   *  the T-Jet era is the right blueprint: it is the era where this stays one number. */
  K: number
  THROTTLE_MAX: number; BURN0: number; BURN_E: number
}

export const BETA_LANE_REGS: LaneRegs = {
  M0: f(0.85), WE: f(0.05), WT: f(0.03),
  /* ⚠⚠ WF = 0 — A SLOT CAR DOES NOT CARRY ITS POWER. At the drag-racing scaling the tank was ~90% of
     the car's mass, so power barely mattered and the whole field lapped within 0.08 s. Fuel here is how
     LONG you may race, not how heavy you are. ⇒ It also retires the under-fuelling strategy the drag
     racers had, which is right: the drama moved to the corners. */
  WF: 0,
  /* ★ ANCHORED TO REAL LAP TIMES, 21 Aug — sourced, not invented. A decent boxstock T-Jet turns a
     51 ft track in 9.0 s (5.67 ft/s = 1.727 m/s AVERAGE) and a good one in 6.0 s (2.591 m/s).
     ⚠⚠ THOSE ARE LAP AVERAGES, NOT TOP SPEEDS, and the layout is unknown. Top = average / EFF with
     EFF swept; EFF 0.80 puts the reference car's top at 2.16 m/s, and VFREE sits 10% above it because
     a loaded DC motor never reaches its own free speed.
     ⇒ The old numbers were ~22x too small in force: F0 2.6 gave a peak of 1.41 m/s², where holding
     2.16 m/s against the real drag needs 57.5 force units before the car has accelerated at all. */
  VFREE: f(2.375), F0: f(311.4), ROLL: f(0.08),
  /* ⚠ PROVISIONAL, and the most tunable number here — it sets the BRAKING ZONE. 15.3 m/s² is a 6"
     coast from top speed; his memory says "a few inches", which at 3" is 30.6 and makes the track
     very nearly undriveable. Swept 3"–18"; the ranking of every design choice held across all of it,
     the absolute lap times did not. ⇒ TUNE THIS BY DRIVING. */
  DRAGC: f(15.3),
  /* ⚠ 90 Ω controller ÷ ~16 Ω armature. Range 4.3–6.0 from the real parts. */
  RC: f(5.6),
  ENG_REF: 14, DIA_REF: 10,
  /* ⚠ PROVISIONAL. μ ≈ 0.7 for rubber on plastic × g 9.81 ⇒ 6.9 m/s². On a 9" (0.229 m) curve that is
     1.25 m/s and on a 6" (0.152 m) curve 1.02 m/s, against 1.7–2.6 m/s on the straight — so a driver
     genuinely has to lift, and the tight corner is ~18% slower. ★ ONE real measurement fixes it for
     every radius, because K = v²/r: film a car letting go on a known curve. */
  /* ⚠ RAISED 6.9 → 16.8 on 21 Aug, measured. At 6.9 the inner ceiling was 1.025 m/s against a
     straight-line potential of 1.11 — the car was CORNER-LIMITED THE WHOLE LAP, the straights were
     wasted and an eng 24 lapped no faster than an eng 14 (4.680 vs 4.679 s). 16.8 puts the inner
     ceiling at ~1.6 and the outer at ~1.96, BELOW what the straights can reach, so you accelerate and
     then brake — which is the skill. ⚠ That is μ ≈ 1.7: above 1, but silicone slot tyres genuinely
     exceed it and a T-Jet's motor magnets pull it to the rails. ⚠ STILL NOT FITTED. */
  /* ★★ 16.8 → 10.6, AND IT IS DERIVED FROM HIS LINE RATHER THAN CHOSEN (21 Aug):
     > *"On the straight it was full trigger, flat out. Getting to a corner, you'd pull it back to
     >  about half and then full again at the end of the turn."*
     ⇒ HALF TRIGGER IS WHAT HOLDS THE CORNER. So `K = steady(TM/2)² / RAD_OUT` — the wide curve is
     exactly what half a trigger will carry, and the tight one then demands rather less than half.
     That is the game he describes, stated as a constant.
     ⚠ 16.8 implied µ 1.71, which was always a stretch. 10.6 is µ 1.08 — still above 1, which silicone
     on plastic track genuinely reaches, and no longer embarrassing.
     ⚠⚠ STILL NOT MEASURED, and it CANNOT be got from those 51 ft lap times: holding 1.73 m/s needs
     µ 2.00 on a 6" curve but µ 0.80 on a 15" one, and nobody knows that layout's radii. The one real
     measurement is still the one this file has always asked for — a car letting go on a known
     radius gives K = v²/r. */
  K: f(10.6),
  THROTTLE_MAX: 16, BURN0: 392, BURN_E: 35,
}

/** A section of the figure 8: a straight, then a turn. Four of them make a lap. */
export interface LaneTrack {
  /** Straight length, metres. */
  straight: number
  /** ★ The figure 8 alternates: even sections take the tight radius, odd ones the wide. */
  radiusInner: number
  radiusOuter: number
  /** Surface grip, `SLIP_UNIT` = normal. ★ This is the drop of oil, as a track property. */
  slipInner: number
  slipOuter: number
  /** 45° pieces per turn. ⚠ THE SAME FOR EVERY SECTION — an unrolled FOR needs a compile-time bound. */
  arcs: number
  /**
   * ★★★ STRAIGHT SUB-STEPS — and this is the number that makes the straight a BRAKING ZONE.
   *
   * With one evaluation the straight is integrated from its ENTRY speed, which is wrong two ways at
   * once: measured against a fine integration, a 15" straight entered at 0.92 m/s was **13% slow in
   * time and 6% fast in exit speed**, and at 0.40 m/s it was **69% and 59%**. The exit speed is what
   * the deslot test reads, so the error lands exactly where it does most damage.
   *
   * ⚠⚠ AND IT IS A STABILITY QUESTION, NOT AN ACCURACY ONE. At real slot-car forces the car reaches
   * equilibrium in 2–3 cm, so a 15" straight is 5–15 equilibrium lengths. At ×2 and ×3 a car entering
   * at 1.40 m/s came out at **8.7 m/s** — past its own free speed. Not an error, nonsense, and it
   * would be permanent. Backward and trapezoidal steps were both tried: stable, but they converge
   * more slowly and buy nothing here.
   * ⇒ ×4 is the working figure; ×6 is where the error goes to zero. **The chosen number must be swept
   *   across every legal car and throttle and proved outside the blow-up region before minting.**
   *
   * ★ Measured cost, compiled: ×2 = 3,695 B · ×4 = 4,209 B · ×6 = 4,729 B, against 3,438 B at ×1.
   *   ~257 B a sub-step. AND per-segment throttle costs NOTHING on top — the body is unrolled either
   *   way, so the extra triggers ride in the unlocking script at a byte each.
   */
  subs: number
  /** Sections in a lap. ⚠ PERMANENT: it is a literal in the compiled program. */
  sections: number
  /** ★ Turn direction per section. PRESENTATION ONLY — the physics reads |radius| and never the sign,
   *  so this never reaches the covenant. It is what makes an 8 an 8 rather than an oval. */
  dirs: number[]
  /** Laps in a race. */
  laps: number
}

/** ★ The Aurora blueprint: 9" straights, 1/8 (45°) curves at 6" and 9". → spec §7.7. */
export const AURORA_FIG8: LaneTrack = {
  /* ★★ 15 INCHES, AND IT IS SOLVED RATHER THAN CHOSEN. Four sections of (straight + 6×45°) with the
     turn direction alternating close EXACTLY — to 0.0000 m and 0° net turn — when the straights are
     15.0". Any other length leaves a gap, so this is the figure 8 those parts actually make.
     ★ And 15" is a real AFX straight: it is in Tuckaway 25's own parts list. Buildable, not drawn. */
  straight: 0.381,                        // 15 inches — solved for closure
  radiusInner: 0.1524, radiusOuter: 0.2286,   // 6" and 9"
  slipInner: SLIP_UNIT, slipOuter: SLIP_UNIT,
  arcs: 6,                                 // 6 × 45° = 270°, past 180° to close the 8
  subs: 4,                                 // ★ the braking zone — see LaneTrack.subs
  sections: 4, dirs: [1, -1, 1, -1],
  laps: 1,
}

/**
 * ★★★ THE 88 — *"88 was just a warm up."* (sun-dive, 21 Aug)
 *
 * Eight sections, and it does NOT retrace: the alternating pattern simply drives the single 8 twice —
 * it returns to the origin halfway — so this direction pattern was SEARCHED FOR rather than chosen. It
 * closes exactly, net turn 0°, and reaches 18" out before coming back.
 * ⚠ Twice the sections is twice the transactions a lap. The cost dial, made visible.
 */
export const DOUBLE_FIG8: LaneTrack = {
  straight: 0.381,
  radiusInner: 0.1524, radiusOuter: 0.2286,
  slipInner: SLIP_UNIT, slipOuter: SLIP_UNIT,
  arcs: 6,
  subs: 4,
  sections: 8, dirs: [1, 1, -1, 1, 1, -1, -1, -1],
  laps: 1,
}

export const PHASE = { RACING: 1, FINISHED: 2, DESLOTTED: 3 } as const

/**
 * ★★★ THE PROGRAM. One section per spend: one straight, then `arcs` × 45°.
 *
 * ⚠ ROLLING START, and it is a design decision rather than a convenience. Stepping in distance makes
 * `Δt = Δs / v`, which is singular at `v = 0` — the standing start would need `Δt = √(2Δs/a)` and
 * Script has no square root. A circuit race starts rolling, so the singularity simply never arises.
 * ⇒ `VERIFY v > 0` states it rather than assuming it.
 *
 * ⚠ `Δt` uses the speed at the START of each step — explicit Euler in distance. Measured against the
 * deployed physics at this resolution: within ±0.5% for mid-range cars (spec §7.1).
 *
 * ⚠⚠ NOTHING IS FOLDED. `K * rad` emits a multiply and `FMUL(rad, ARCK)` emits its own, so the deslot
 * rule and the arc length can be READ BACK through `unbasic`. A car carrying `1234567` where the rule
 * should be would be a car nobody can check. → THE HARD RULE.
 */
/**
 * ★★ ONE PHYSICS STEP, and the same eight lines wherever it appears — straight or arc.
 *
 * ⚠⚠ THE PULL IS A RHEOSTAT NOW, not a voltage. `LaneRegs.RC` explains why; the shape is what
 * matters here: **free speed does not mention the trigger**. Lifting divides the pull by a bigger
 * series resistance, so half a trigger makes the car WEAK, and it stays weak until the drag has taken
 * the speed off it. That is the sensation the old model could not produce.
 *
 * ⚠ `ONE - FDIV(v, vfree)` GOES NEGATIVE above free speed, so `pull` becomes a retarding force — the
 * motor generating against itself. That is real, and it is also why the trigger must be tested for
 * zero: a RELEASED trigger is an OPEN CIRCUIT and generates nothing, so it may not brake at all.
 * ⇒ `pull = 0` first, then a one-armed IF. Letting go and lifting are different acts.
 * ★ The negative numerator is not a worry: `OP_DIV` with one was answered on mainnet by the racers.
 */
/**
 * ★★ ONE PHYSICS STEP, and the same lines wherever it appears — straight or arc.
 *
 * ⚠⚠ THE ACCELERATION IS LINEAR IN v, AND THE STEP IS IMPLICIT. Write `accel = α − β·v`; then
 *      forward   v' = v + (α − β v)·dt         ← what the first draft did
 *      backward  v' = (v + α·dt) / (1 + β·dt)  ← this
 * The forward form OVERSHOOTS once `β·dt > 2`, and at real slot-car forces it does. MEASURED across
 * every legal car, trigger and entry speed: it reached **1,130 times free speed**, and ×24 sub-steps
 * did not save it — because `dt = Δs/v` grows without bound as v falls, so no affordable Δs is small
 * enough. A car at 0.3 m/s with 557 m/s² of reserve would need Δs < 0.16 mm.
 * ⇒ The backward form is a CONTRACTION toward equilibrium: it cannot pass free speed, at any step
 *   size, ever. Cost is one divide, and the step was already dividing.
 * ★ Sub-stepping the FORWARD form was recommended first and it was wrong — the two were compared on
 *   ACCURACY at a fixed step count, where backward looks worse, when the requirement was STABILITY.
 *
 * ⚠ THE TRIGGER IS A RHEOSTAT — `LaneRegs.RC`. `acc0` is the reserve acceleration at a standstill, and
 * lifting divides it by a larger series resistance. **Free speed never mentions the trigger.** Half a
 * trigger makes the car WEAK, not slow, and the drag is what then takes the speed off it.
 * ⇒ A RELEASED trigger is an OPEN CIRCUIT: `acc0 = 0`, so it does not even brake. Letting go and
 *   lifting are different acts, and the one-armed IF is where they differ.
 */
function stepSrc(th: string, len: string, isArc: boolean): string[] {
  const o = [
    `mass = M0 + eng * WE + tyr * WT + FMUL(fuel * S, WF)`,
    `acc0 = 0`,
    `IF ${th} > 0 THEN acc0 = FDIV(FDIV(FDIV(F0, ONE + RC * (TM - ${th}) / TM), wheel), mass)`,
    `alpha = acc0 - DRAGC`,
    `beta = FDIV(acc0, vfree) + ROLL`,
    `dt = FDIV(${len}, v)`,
    `v = FDIV(v + FMUL(alpha, dt), ONE + FMUL(beta, dt))`,
    `VERIFY v > 0`,
    `t = t + dt`,
    `fuel = MAX(0, fuel - BURN0 - eng * BURN_E * ${th} / TM)`,
  ]
  /* ⚠⚠ over EXISTS BEFORE THE STEPS and a deslot is an OUTCOME, not a refusal. VERIFY would make a
     car that went off UNSPENDABLE — the run could never be recorded and the lane would sit stuck
     mid-race. "Deslot and out of the race" means the race ENDS, and ending is a state we write. */
  if (isArc) o.push(`IF FMUL(v, v) > vmax2 THEN over = 1`)
  return o
}

/** The driver's inputs, in the order the frame reads them. ⚠ ONE PER SEGMENT. */
export function laneInputNames(track: LaneTrack = AURORA_FIG8): string[] {
  const o: string[] = []
  for (let i = 1; i <= track.subs; i++) o.push(`ths${i}`)
  for (let i = 1; i <= track.arcs; i++) o.push(`tht${i}`)
  return [...o, 'ndriver', 'neng', 'ntyr', 'ndia', 'nfuel']
}

/**
 * ★★★ THE PROGRAM. One section per spend: one straight in `subs` steps, then `arcs` × 45°.
 *
 * ⚠ ROLLING START, and it is a design decision rather than a convenience. Stepping in distance makes
 * `Δt = Δs / v`, which is singular at `v = 0` — the standing start would need `Δt = √(2Δs/a)` and
 * Script has no square root. A circuit race starts rolling, so the singularity never arises.
 * ⇒ `VERIFY v > 0` states it rather than assuming it.
 *
 * ⚠⚠ NOTHING IS FOLDED. `K * rad` emits a multiply and `FMUL(rad, ARCK)` emits its own, so the deslot
 * rule and the arc length can be READ BACK through `unbasic`. A car carrying `1234567` where the rule
 * should be would be a car nobody can check. → THE HARD RULE.
 *
 * ★ `wheel` and `vfree` are hoisted out of the steps because they are GENUINELY invariant across a
 * section — neither mentions the trigger any more, which is exactly the change the rheostat made.
 * That is a source-level choice, not a compiler one: the compiler still emits what this says.
 */
export function laneSrc(track: LaneTrack = AURORA_FIG8): string {
  const straight: string[] = []
  for (let i = 1; i <= track.subs; i++) {
    straight.push(`REM ── straight ${i} of ${track.subs} — the last of these is the BRAKING ZONE ──`)
    straight.push(...stepSrc(`ths${i}`, 'SUBLEN', false))
  }
  const turn: string[] = []
  for (let i = 1; i <= track.arcs; i++) {
    turn.push(`REM ── 45° arc ${i} of ${track.arcs} ──`)
    turn.push(...stepSrc(`tht${i}`, 'arclen', true))
  }
  return `
DIM raceId$32
DIM phase%1
DIM section%1
DIM lap%1
DIM v%5
DIM fuel%4
DIM t%5
DIM eng%1
DIM tyr%1
REM ★ TYRE DIAMETER IS THE GEARBOX — see LaneRegs. Separate from tyr, which is the COMPOUND.
DIM dia%1
DIM driver$24

REM ⚠ EVERY WORKING VARIABLE IS GIVEN A VALUE BEFORE THE BRANCH. The compiler refuses an IF whose
REM   arms have nothing to agree about — BRC-Z §4.1's stack-shape rule — and it is right to: two arms
REM   that leave the stack different shapes fail hundreds of opcodes from the cause.
rad = RAD_IN
slip = SLIP_IN
vmax2 = 0
arclen = 0
over = 0
mass = 0
wheel = 0
vfree = 0
acc0 = 0
alpha = 0
beta = 0
dt = 0

REM ⚠⚠ THE PHASE CHOOSES WHAT THE TICK DOES, NEVER WHETHER IT MAY HAPPEN.
REM    An earlier draft opened with VERIFY phase = P_RACING, which left a finished or wrecked lane
REM    UNSPENDABLE and the next driver with nowhere to start. That was an invented restriction: nothing
REM    about a covenant makes a terminal state terminal. A lane always ticks forward. Bootcamp #4.
IF phase <> P_RACING THEN
  REM ── A FRESH RACE. The id CHAINS from the last one, so it is unique with no entropy and needs no
  REM    outpoint — which matters, because ANYONECANPAY zeroes hashPrevouts and the covenant cannot see
  REM    the outpoint it spends. 32 bytes, not 8: this structure is meant to be reusable for science,
  REM    engineering and safety work, and those readers would demand a full hash. (sun-dive, 21 Aug)
  REM ⚠ CAT, NOT +. In this dialect + is OP_ADD — it would read two byte strings as NUMBERS and add
  REM   them, which compiles perfectly and hashes something nobody intended.
  raceId = HASH256(CAT(CAT(CAT(CAT(CAT(raceId, ndriver), NUM2BIN(neng, 1)), NUM2BIN(ntyr, 1)), NUM2BIN(ndia, 1)), NUM2BIN(nfuel, 4)))
  driver = ndriver
  eng = neng
  tyr = ntyr
  dia = ndia
  fuel = nfuel
  v = V0
  t = 0
  section = 0
  lap = 0
  phase = P_RACING
ELSE

REM ── the rolling start: distance-stepping divides by v, so v is never zero ──
VERIFY v > 0

REM ── THE TRACK, BY SECTION. Script has no arrays; the figure 8 alternates, so ONE test does it. ──
IF MOD(section, 2) = 1 THEN
  rad = RAD_OUT
  slip = SLIP_OUT
END IF

REM ── the deslot ceiling for THIS turn: v² <= K·r, scaled by the surface ──
REM ⚠⚠ TYRES ARE IN THE GRIP RULE, and that is faithful rather than invented: silicone, urethane,
REM    rubber and foam were all sold for these cars, graded by compound — "S1 softer, for lower
REM    down-force cars and plastic sectional track". Compound is chosen AGAINST the surface, so tyr and
REM    slip belong multiplied. ⇒ Without this term tyr 4 and tyr 10 lapped within 0.04 s and one of the
REM    car's two parameters was decorative.
vmax2 = FMUL(K, rad) * slip / SLIP * tyr / TYR_REF

REM ── invariant for the whole section: the wheel is the gearbox, and free speed is the MOTOR through
REM    it. ★ Neither mentions the trigger — that is the rheostat, and it is why these hoist. ──
wheel = DIA * dia / DIA_REF
vfree = FMUL(VFREE * eng / ENG_REF, wheel)
arclen = FMUL(rad, ARCK)

REM ══ THE STRAIGHT — ${track.subs} STEPS, so there is somewhere to brake ═══════════════════════════
${straight.join('\n')}

REM ══ THE TURN — ${track.arcs} × 45°, ONE TRIGGER EACH ═══════════════════════════════════════════
REM ★ His line: *"full trigger on the straight; getting to a corner pull it back to about half; then
REM   full again at the end of the turn."* The last clause is why every arc reads its own trigger —
REM   one value for the whole 270° cannot say it.
${turn.join('\n')}

REM ── advance the lap ──
section = section + 1
IF section = SECTIONS THEN
  section = 0
  lap = lap + 1
END IF
IF lap = LAPS THEN phase = P_FINISHED
REM ⚠⚠ THE DESLOT IS TESTED LAST, AND THE ORDER IS LOAD-BEARING. Go off in the final corner and you
REM    did NOT finish — so this must overwrite the finish, never the other way round. Same lesson the
REM    racers learned twice: two endings decided by ordering, and getting it backwards files a wreck
REM    as a result.
IF over = 1 THEN phase = P_DESLOTTED
END IF
`.trim()
}

/** ★ The figure 8's program, which is what everything here compiles unless told otherwise. */
export const LANE_SRC = laneSrc(AURORA_FIG8)

/** The compile-time constants the program above resolves by name. */
export function laneConsts(regs: LaneRegs, track: LaneTrack): Record<string, number> {
  return {
    M0: regs.M0, WE: regs.WE, WT: regs.WT, WF: regs.WF,
    VFREE: regs.VFREE, F0: regs.F0, ROLL: regs.ROLL, K: regs.K,
    DRAGC: regs.DRAGC, RC: regs.RC,
    ENG_REF: regs.ENG_REF, DIA_REF: regs.DIA_REF,
    /* the reference wheel, as a fixed-point 1.0 — `dia` scales it */
    DIA: S, ONE: S,
    TM: regs.THROTTLE_MAX, BURN0: regs.BURN0, BURN_E: regs.BURN_E,
    S, SLIP: SLIP_UNIT,
    STRAIGHT: f(track.straight),
    /* ★ ONE STRAIGHT SUB-STEP. ⚠ `subs × SUBLEN` is what the car actually drives, and rounding can
       leave it a hair under `STRAIGHT` — so anything measuring the track must use this, not the
       nominal length, or the page and the chain disagree about how long the straight is. */
    SUBLEN: Math.round(f(track.straight) / track.subs),
    SUBS: track.subs,
    RAD_IN: f(track.radiusInner), RAD_OUT: f(track.radiusOuter),
    SLIP_IN: track.slipInner, SLIP_OUT: track.slipOuter,
    /* ★ A 45° arc is `2πr/8`. Written as a constant times the radius so the ARC LENGTH is visible in
       the decompiled script rather than baked into a number nobody can account for. */
    ARCK: f((2 * Math.PI) / 8),
    ARCS: track.arcs, LAPS: track.laps, SECTIONS: track.sections,
    /* ★ The tyre the deslot ceiling is quoted at. tyr 10 is the reference compound; lower
       grades hold less. PERMANENT. */
    TYR_REF: 10,
    P_RACING: PHASE.RACING, P_FINISHED: PHASE.FINISHED, P_DESLOTTED: PHASE.DESLOTTED,
    /* ★ THE ROLLING START — see LANE_SRC. Permanent, and it is why v is never zero. */
    V0: f(0.8),
  }
}

export interface LaneState {
  raceId: number[]
  phase: number; section: number; lap: number
  v: number; fuel: number; t: number
  eng: number; tyr: number
  /** ★ tyre DIAMETER — the gearbox. `DIA_REF` is stock. */
  dia: number
  driver: number[]
}

/**
 * The lane's locking script.
 *
 * ⚠ `maxFee` iterates to a fixed point in `frameMaxFee` because it is pushed BY the script, so it is
 * circular — the frame does that, not this.
 */
export function buildLaneLock(
  state: LaneState, opts: { regs?: LaneRegs; track?: LaneTrack; maxFee: number },
) {
  const regs = opts.regs ?? BETA_LANE_REGS
  const track = opts.track ?? AURORA_FIG8
  return buildBasicLock({
    src: laneSrc(track),
    state: state as unknown as Record<string, number | number[]>,
    maxFee: opts.maxFee,
    consts: laneConsts(regs, track),
    /* ★ "A covenant with no inputs can only advance itself; one with inputs is a machine somebody
       plays." ONE TRIGGER READING PER SEGMENT — which is what a rheostat held in a hand actually is,
       sampled where the physics steps. They cost nothing in the lock: the body is unrolled either
       way, so these ride in the UNLOCKING script at about a byte each. */
    inputs: laneInputNames(track),
  })
}

export { frameMaxFee }

/**
 * ★★ THE REFERENCE — what one section does, in JavaScript, mirroring `LANE_SRC` line for line.
 *
 * ⚠⚠ IT MUST AGREE WITH THE SCRIPT, and `test/beta-lane.ts` requires it through the real interpreter.
 * A reference that quietly disagrees with the covenant is worse than none: the page would predict one
 * race and the chain would settle another, and the page is what a driver sees.
 *
 * ⚠ Integer arithmetic throughout, truncating toward zero exactly as `OP_DIV` does — a double would
 * agree for a while and then part by a unit, which is the hardest kind of divergence to find.
 */
export interface LaneInputs {
  /**
   * ★★★ ONE TRIGGER READING PER SEGMENT — `subs` down the straight, then one per 45° arc.
   *
   * A number instead of an array means "held there for every step", which is what the old two-input
   * model could say and all it could say. The array is what lets a driver BRAKE: the last straight
   * step is the braking zone, and the last arcs are the power coming back on.
   */
  ths: number | number[]; tht: number | number[]
  /** ⚠ read ONLY when the lane is not racing: the next race's car */
  ndriver: number[]; neng: number; ntyr: number; nfuel: number; ndia: number
}

/** ★ Expand a held trigger, or a per-segment one, into exactly `n` readings. */
export const laneTriggers = (x: number | number[], n: number): number[] =>
  Array.isArray(x)
    ? Array.from({ length: n }, (_, i) => (i < x.length ? x[i] : x[x.length - 1] ?? 0))
    : new Array(n).fill(x)

/** little-endian, `w` bytes — what NUM2BIN(x, w) puts in the script. */
const le = (x: number, w: number): number[] => {
  const o: number[] = []
  for (let i = 0; i < w; i++) { o.push(x & 0xff); x = Math.floor(x / 256) }
  return o
}

/**
 * ★★ ONE TICK, mirroring the program exactly — a fresh race if the lane is not racing, else a section.
 *
 * ⚠ THE LANE ALWAYS TICKS FORWARD. There is no state it can be left in that blocks the next driver;
 * the phase decides what happens, never whether anything may.
 */
export function laneTick(
  st: LaneState, inp: LaneInputs,
  regs: LaneRegs = BETA_LANE_REGS, track: LaneTrack = AURORA_FIG8,
): LaneResult {
  const C = laneConsts(regs, track)
  if (st.phase !== PHASE.RACING) {
    /* ★ THE ID CHAINS FROM THE LAST RACE — unique with no entropy, and needing no outpoint, which
       ANYONECANPAY denies us anyway. 32 bytes because the structure is meant to be reused where a
       truncated identifier would not be accepted. */
    const raceId = Hash.hash256([
      ...st.raceId, ...inp.ndriver, ...le(inp.neng, 1), ...le(inp.ntyr, 1), ...le(inp.ndia, 1), ...le(inp.nfuel, 4),
    ])
    return {
      raceId, phase: PHASE.RACING, section: 0, lap: 0,
      v: C.V0, fuel: inp.nfuel, t: 0,
      eng: inp.neng, tyr: inp.ntyr, dia: inp.ndia, driver: inp.ndriver,
      deslot: false, refused: false, marks: [],
      atTurn: { v: C.V0, fuel: inp.nfuel, t: 0 },
    }
  }
  return laneSection(st, inp.ths, inp.tht, regs, track)
}

/** What a section reports back. `marks` is the state after EVERY segment, which is what a bench animates. */
export type LaneResult = LaneState & {
  deslot: boolean
  /**
   * ★★ TRUE WHEN THE COVENANT WOULD REFUSE THE SPEND — `VERIFY v > 0` failed somewhere in the section.
   *
   * ⚠⚠ THE REFERENCE USED TO HAVE NO SUCH FLAG, and the script has always had the rule. Measured on
   * the previous model: eng 6 driven 16/16 · 16/16 · 15/5 · 14/1 came back **v = −1.95 m/s and
   * t = −6.57 s** — time running backwards, because `dt = Δs / v`. The page would have shown that lap;
   * the chain refuses it. And an optimiser looking for a quick time finds it IMMEDIATELY, because
   * negative time is the quickest time there is.
   */
  refused: boolean
  marks: { v: number; t: number; fuel: number }[]
  atTurn: { v: number; fuel: number; t: number }
}

export function laneSection(
  st: LaneState, ths: number | number[], tht: number | number[],
  regs: LaneRegs = BETA_LANE_REGS, track: LaneTrack = AURORA_FIG8,
): LaneResult {
  const C = laneConsts(regs, track)
  const t0 = (x: number): number => Math.trunc(x)
  const rad = st.section % 2 === 0 ? C.RAD_IN : C.RAD_OUT
  const slip = st.section % 2 === 0 ? C.SLIP_IN : C.SLIP_OUT
  const vmax2 = t0(t0(t0(fmul(C.K, rad) * slip / C.SLIP) * st.tyr) / C.TYR_REF)

  let { v, fuel, t, section, lap, phase } = st
  let deslot = false, refused = false
  const marks: { v: number; t: number; fuel: number }[] = []

  /* ★ hoisted because they are invariant across the section — see `laneSrc`. Neither mentions the
     trigger, which is the whole point of the rheostat. */
  const wheel = t0(C.DIA * st.dia / C.DIA_REF)
  const vfree = fmul(t0(C.VFREE * st.eng / C.ENG_REF), wheel)

  const step = (ds: number, th: number, isArc: boolean): void => {
    const mass = C.M0 + st.eng * C.WE + st.tyr * C.WT + fmul(fuel * C.S, C.WF)
    /* ★ mirrors the program line for line — including the BACKWARD step, which is what stops a car
       jumping past its own free speed. A released trigger pulls nothing, not even backwards. */
    let acc0 = 0
    if (th > 0) acc0 = fdiv(fdiv(fdiv(C.F0, C.ONE + t0(C.RC * (C.TM - th) / C.TM)), wheel), mass)
    const alpha = acc0 - C.DRAGC
    const beta = fdiv(acc0, vfree) + C.ROLL
    const dt = fdiv(ds, v)
    v = fdiv(v + fmul(alpha, dt), C.ONE + fmul(beta, dt))
    /* ⚠⚠ THE COVENANT'S OWN RULE, and the reference must carry it or it certifies laps the chain
       refuses. Once refused, everything after it is meaningless, so stop stepping. */
    if (v <= 0) { refused = true; return }
    t = t + dt
    fuel = Math.max(0, fuel - C.BURN0 - t0(st.eng * C.BURN_E * th / C.TM))
    if (isArc && fmul(v, v) > vmax2) deslot = true
    marks.push({ v, t, fuel })
  }

  const S_TH = laneTriggers(ths, track.subs), T_TH = laneTriggers(tht, track.arcs)
  for (let i = 0; i < track.subs && !refused; i++) step(C.SUBLEN, S_TH[i], false)
  /* ★★ THE STATE AS THE CORNER ARRIVES, reported so a driver can be given that moment.
     ⚠ The straight runs BEFORE the turn and reads only `ths`, so nothing above this line depends on
     `tht` — which means every turn trigger may be committed LATER without changing anything that has
     already happened. Not a convenience: it is why a bench can offer live control and still be exactly
     what the covenant computes. ★ And it now holds SEGMENT BY SEGMENT, so the whole lap can be driven
     live rather than committed two numbers at a time. */
  const atTurn = { v, fuel, t }
  const arclen = fmul(rad, C.ARCK)
  for (let i = 0; i < track.arcs && !refused; i++) step(arclen, T_TH[i], true)

  section = section + 1
  if (section === track.sections) { section = 0; lap = lap + 1 }
  if (lap === track.laps) phase = PHASE.FINISHED
  /* ⚠ LAST, and the order is load-bearing — see the note in the program. */
  if (deslot) phase = PHASE.DESLOTTED

  return { ...st, v, fuel, t, section, lap, phase, deslot, refused, marks, atTurn }
}
