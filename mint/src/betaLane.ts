// © BSV Association — Open BSV License v6.
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
  VMAX_REF: number
  /** Pull at the axle for the reference car at full throttle, before the wheel divides it. */
  F0: number
  /** ⚠ Rolling resistance, LINEAR in v. The quadratic aero term is gone — it was standing in for the
   *  motor's RPM limit, and doing it backwards: it made a TALLER tyre slower. */
  ROLL: number
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
  /* ⚠ PROVISIONAL. Terminal velocity is `(F/m)/DRAG`; a boxstock T-Jet measures 1.73 m/s and a good
     one 2.59 m/s (51 ft in 9 s / under 6 s). These are set to land in that band and NOT fitted. */
  /* ⚠ PROVISIONAL. 2.2 m/s is a good T-Jet at full throttle on stock wheels (measured practice: 1.73
     boxstock, 2.59 for a strong one). ENG_REF 14 and DIA_REF 10 are the middle of each slider. */
  /* ⚠ ROLL 0.08 is LOW ON PURPOSE. It has to be, or rolling resistance becomes the limiter and the
     model stops saying what he said — that top speed is the MOTOR. At 0.35 the car settled at 1.42 m/s
     against a 2.2 free speed; at 0.08 it reaches ~2.0 and the motor governs. */
  VMAX_REF: f(2.2), F0: f(2.6), ROLL: f(0.08),
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
  K: f(16.8),
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
export const LANE_SRC = `
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
vtop = 0
pull = 0
accel = 0
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

REM ══ THE STRAIGHT ══════════════════════════════════════════════════════════
mass = M0 + eng * WE + tyr * WT + FMUL(fuel * S, WF)
REM ── top speed: the MOTOR through the WHEEL, scaled by how far the trigger is pulled ──
REM ⚠ ths is a COUNT (1..16), not a fixed-point value — plain * and /, never FMUL
vtop = FMUL(VMAX_REF * eng / ENG_REF, DIA * dia / DIA_REF) * ths / TM
REM ── a DC motor's pull falls to nothing at its free speed; a TALLER wheel trades pull for speed ──
pull = FMUL(F0 * ths / TM, ONE - FDIV(v, vtop))
accel = FDIV(FDIV(pull, DIA * dia / DIA_REF), mass) - FMUL(v, ROLL)
dt = FDIV(STRAIGHT, v)
v = v + FMUL(accel, dt)
VERIFY v > 0
t = t + dt
fuel = MAX(0, fuel - BURN0 - eng * BURN_E * ths / TM)

REM ══ THE TURN — ARCS × 45°, and the deslot test is the whole game ══════════
REM ⚠⚠ over EXISTS BEFORE THE LOOP for the same reason rad does, and it must: a deslot is an
REM    OUTCOME, not a refusal. VERIFY would make a car that went off UNSPENDABLE — the run could never
REM    be recorded and the lane would sit stuck mid-race. "Deslot and out of the race" means the race
REM    ENDS, and ending is a state the covenant writes.
arclen = FMUL(rad, ARCK)
FOR i = 1 TO ARCS
  mass = M0 + eng * WE + tyr * WT + FMUL(fuel * S, WF)
  vtop = FMUL(VMAX_REF * eng / ENG_REF, DIA * dia / DIA_REF) * tht / TM
  pull = FMUL(F0 * tht / TM, ONE - FDIV(v, vtop))
  accel = FDIV(FDIV(pull, DIA * dia / DIA_REF), mass) - FMUL(v, ROLL)
  dt = FDIV(arclen, v)
  v = v + FMUL(accel, dt)
  VERIFY v > 0
  REM ⚠ TOO FAST FOR THE SLOT: out of the race, and there is no partial credit
  IF FMUL(v, v) > vmax2 THEN over = 1
  t = t + dt
  fuel = MAX(0, fuel - BURN0 - eng * BURN_E * tht / TM)
NEXT

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

/** The compile-time constants the program above resolves by name. */
export function laneConsts(regs: LaneRegs, track: LaneTrack): Record<string, number> {
  return {
    M0: regs.M0, WE: regs.WE, WT: regs.WT, WF: regs.WF,
    VMAX_REF: regs.VMAX_REF, F0: regs.F0, ROLL: regs.ROLL, K: regs.K,
    ENG_REF: regs.ENG_REF, DIA_REF: regs.DIA_REF,
    /* the reference wheel, as a fixed-point 1.0 — `dia` scales it */
    DIA: S, ONE: S,
    TM: regs.THROTTLE_MAX, BURN0: regs.BURN0, BURN_E: regs.BURN_E,
    S, SLIP: SLIP_UNIT,
    STRAIGHT: f(track.straight),
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
    src: LANE_SRC,
    state: state as unknown as Record<string, number | number[]>,
    maxFee: opts.maxFee,
    consts: laneConsts(regs, track),
    /* ★ "A covenant with no inputs can only advance itself; one with inputs is a machine somebody
       plays." Two numbers are the entire driver input: how hard down the straight, how much you lift
       for the corner. */
    inputs: ['ths', 'tht', 'ndriver', 'neng', 'ntyr', 'ndia', 'nfuel'],
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
  /** throttle down the straight, and through the turn — the whole driver input */
  ths: number; tht: number
  /** ⚠ read ONLY when the lane is not racing: the next race's car */
  ndriver: number[]; neng: number; ntyr: number; nfuel: number; ndia: number
}

/** little-endian, `w` bytes — what NUM2BIN(x, w) puts in the script. */
const le = (x: number, w: number): number[] => {
  const o: number[] = []
  for (let i = 0; i < w; i++) { o.push(x & 0xff); x = Math.floor(x / 256) }
  return o
}

/**
 * ★★ ONE TICK, mirroring LANE_SRC exactly — a fresh race if the lane is not racing, a section if it is.
 *
 * ⚠ THE LANE ALWAYS TICKS FORWARD. There is no state it can be left in that blocks the next driver;
 * the phase decides what happens, never whether anything may.
 */
export function laneTick(
  st: LaneState, inp: LaneInputs,
  regs: LaneRegs = BETA_LANE_REGS, track: LaneTrack = AURORA_FIG8,
): LaneState & { deslot: boolean } {
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
      eng: inp.neng, tyr: inp.ntyr, dia: inp.ndia, driver: inp.ndriver, deslot: false,
    }
  }
  return laneSection(st, inp.ths, inp.tht, regs, track)
}

export function laneSection(
  st: LaneState, ths: number, tht: number,
  regs: LaneRegs = BETA_LANE_REGS, track: LaneTrack = AURORA_FIG8,
): LaneState & { deslot: boolean } {
  const C = laneConsts(regs, track)
  const t0 = (x: number): number => Math.trunc(x)
  const rad = st.section % 2 === 0 ? C.RAD_IN : C.RAD_OUT
  const slip = st.section % 2 === 0 ? C.SLIP_IN : C.SLIP_OUT
  const vmax2 = t0(t0(t0(fmul(C.K, rad) * slip / C.SLIP) * st.tyr) / C.TYR_REF)

  let { v, fuel, t, section, lap, phase } = st
  let deslot = false

  const step = (ds: number, th: number, isArc: boolean): void => {
    const mass = C.M0 + st.eng * C.WE + st.tyr * C.WT + fmul(fuel * C.S, C.WF)
    /* ★ mirrors LANE_SRC exactly: top speed is motor × wheel × throttle, and the pull falls to nothing
       as the car approaches it. A taller wheel buys speed and spends pull. */
    const wheel = t0(C.DIA * st.dia / C.DIA_REF)
    const vtop = t0(fmul(t0(C.VMAX_REF * st.eng / C.ENG_REF), wheel) * th / C.TM)
    const pull = fmul(t0(C.F0 * th / C.TM), C.ONE - fdiv(v, vtop))
    const accel = fdiv(fdiv(pull, wheel), mass) - fmul(v, C.ROLL)
    const dt = fdiv(ds, v)
    v = v + fmul(accel, dt)
    t = t + dt
    fuel = Math.max(0, fuel - C.BURN0 - t0(st.eng * C.BURN_E * th / C.TM))
    if (isArc && fmul(v, v) > vmax2) deslot = true
  }

  step(C.STRAIGHT, ths, false)
  const arclen = fmul(rad, C.ARCK)
  for (let i = 0; i < track.arcs; i++) step(arclen, tht, true)

  section = section + 1
  if (section === track.sections) { section = 0; lap = lap + 1 }
  if (lap === track.laps) phase = PHASE.FINISHED
  /* ⚠ LAST, and the order is load-bearing — see the note in LANE_SRC. */
  if (deslot) phase = PHASE.DESLOTTED

  return { ...st, v, fuel, t, section, lap, phase, deslot }
}
