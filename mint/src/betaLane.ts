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
import { buildBasicLock, frameMaxFee } from './basicCovenant.ts'
import { S, SLIP_UNIT } from './shell.ts'

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
  FE: number; DRAG: number; DRAG2: number
  /** ★ THE DESLOT CONSTANT. `v² ≤ K·r` — and for a MAGNETLESS car `K = μ·g`, with the car's mass
   *  cancelling out entirely, so it is a property of TRACK AND TYRES rather than of the car.
   *  ⚠ A traction magnet breaks that (its downforce does not scale with mass), which is one more reason
   *  the T-Jet era is the right blueprint: it is the era where this stays one number. */
  K: number
  THROTTLE_MAX: number; BURN0: number; BURN_E: number
}

export const BETA_LANE_REGS: LaneRegs = {
  M0: f(0.85), WE: f(0.05), WT: f(0.03), WF: f(0.00011),
  /* ⚠ PROVISIONAL. Terminal velocity is `(F/m)/DRAG`; a boxstock T-Jet measures 1.73 m/s and a good
     one 2.59 m/s (51 ft in 9 s / under 6 s). These are set to land in that band and NOT fitted. */
  FE: f(0.069), DRAG: f(0.20), DRAG2: f(0.09),
  /* ⚠ PROVISIONAL. μ ≈ 0.7 for rubber on plastic × g 9.81 ⇒ 6.9 m/s². On a 9" (0.229 m) curve that is
     1.25 m/s and on a 6" (0.152 m) curve 1.02 m/s, against 1.7–2.6 m/s on the straight — so a driver
     genuinely has to lift, and the tight corner is ~18% slower. ★ ONE real measurement fixes it for
     every radius, because K = v²/r: film a car letting go on a known curve. */
  K: f(6.9),
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
  /** Laps in a race. */
  laps: number
}

/** ★ The Aurora blueprint: 9" straights, 1/8 (45°) curves at 6" and 9". → spec §7.7. */
export const AURORA_FIG8: LaneTrack = {
  straight: 0.2286,                       // 9 inches
  radiusInner: 0.1524, radiusOuter: 0.2286,   // 6" and 9"
  slipInner: SLIP_UNIT, slipOuter: SLIP_UNIT,
  arcs: 6,                                 // 6 × 45° = 270°, past 180° to close the 8
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
DIM phase%1
DIM section%1
DIM lap%1
DIM v%5
DIM fuel%4
DIM t%5
DIM eng%1
DIM tyr%1
DIM driver$24

REM ── only a racing lane may be advanced ──
VERIFY phase = P_RACING
REM ── the rolling start: distance-stepping divides by v, so v is never zero ──
VERIFY v > 0

REM ── THE TRACK, BY SECTION. Script has no arrays; the figure 8 alternates, so ONE test does it.
REM ⚠ Both are given a value BEFORE the branch: the compiler refuses an IF whose arms have nothing to
REM   agree about, which is BRC-Z §4.1's stack-shape rule catching a real mistake before it is minted.
rad = RAD_IN
slip = SLIP_IN
IF MOD(section, 2) = 1 THEN
  rad = RAD_OUT
  slip = SLIP_OUT
END IF

REM ── the deslot ceiling for THIS turn: v² <= K·r, scaled by the surface ──
vmax2 = FMUL(K, rad) * slip / SLIP

REM ══ THE STRAIGHT ══════════════════════════════════════════════════════════
mass = M0 + eng * WE + tyr * WT + FMUL(fuel * S, WF)
demand = eng * FE * ths / TM
aero = FMUL(FMUL(v, v), DRAG2)
accel = FDIV(demand - aero, mass) - FMUL(v, DRAG)
dt = FDIV(STRAIGHT, v)
v = v + FMUL(accel, dt)
VERIFY v > 0
t = t + dt
fuel = MAX(0, fuel - BURN0 - eng * BURN_E * ths / TM)

REM ══ THE TURN — ARCS × 45°, and the deslot test is the whole game ══════════
arclen = FMUL(rad, ARCK)
FOR i = 1 TO ARCS
  mass = M0 + eng * WE + tyr * WT + FMUL(fuel * S, WF)
  demand = eng * FE * tht / TM
  aero = FMUL(FMUL(v, v), DRAG2)
  accel = FDIV(demand - aero, mass) - FMUL(v, DRAG)
  dt = FDIV(arclen, v)
  v = v + FMUL(accel, dt)
  VERIFY v > 0
  REM ⚠ TOO FAST FOR THE SLOT: out of the race, and there is no partial credit
  VERIFY FMUL(v, v) <= vmax2
  t = t + dt
  fuel = MAX(0, fuel - BURN0 - eng * BURN_E * tht / TM)
NEXT

REM ── advance the lap ──
section = section + 1
IF section = 4 THEN
  section = 0
  lap = lap + 1
END IF
IF lap = LAPS THEN phase = P_FINISHED
`.trim()

/** The compile-time constants the program above resolves by name. */
export function laneConsts(regs: LaneRegs, track: LaneTrack): Record<string, number> {
  return {
    M0: regs.M0, WE: regs.WE, WT: regs.WT, WF: regs.WF,
    FE: regs.FE, DRAG: regs.DRAG, DRAG2: regs.DRAG2, K: regs.K,
    TM: regs.THROTTLE_MAX, BURN0: regs.BURN0, BURN_E: regs.BURN_E,
    S, SLIP: SLIP_UNIT,
    STRAIGHT: f(track.straight),
    RAD_IN: f(track.radiusInner), RAD_OUT: f(track.radiusOuter),
    SLIP_IN: track.slipInner, SLIP_OUT: track.slipOuter,
    /* ★ A 45° arc is `2πr/8`. Written as a constant times the radius so the ARC LENGTH is visible in
       the decompiled script rather than baked into a number nobody can account for. */
    ARCK: f((2 * Math.PI) / 8),
    ARCS: track.arcs, LAPS: track.laps,
    P_RACING: PHASE.RACING, P_FINISHED: PHASE.FINISHED,
  }
}

export interface LaneState {
  phase: number; section: number; lap: number
  v: number; fuel: number; t: number
  eng: number; tyr: number
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
    inputs: ['ths', 'tht'],
  })
}

export { frameMaxFee }
