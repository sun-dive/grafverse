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
  /* ⚠ FE RAISED 0.069 → 0.17 on 21 Aug, and the reason is worth keeping: at 0.069 the terminal
     velocity was (F/m)/DRAG = 0.77 m/s against a deslot limit of 1.25 m/s on a 9" curve — SO THE CAR
     COULD NEVER GO OFF, and `test/beta-lane.ts` proved the deslot rule was unreachable. A rule no test
     can provoke is a rule no test has examined. ⇒ 0.17 gives ~1.7 m/s loaded and ~3.4 m/s light, so
     full throttle through a corner deslots and lifting to ~6 does not. ⚠ STILL NOT A FIT — it makes the
     branch REACHABLE so it can be tested. The calibration sweep is §8 and it is not done. */
  FE: f(0.17), DRAG: f(0.20), DRAG2: f(0.09),
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
DIM raceId$32
DIM phase%1
DIM section%1
DIM lap%1
DIM v%5
DIM fuel%4
DIM t%5
DIM eng%1
DIM tyr%1
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
demand = 0
aero = 0
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
  raceId = HASH256(CAT(CAT(CAT(CAT(raceId, ndriver), NUM2BIN(neng, 1)), NUM2BIN(ntyr, 1)), NUM2BIN(nfuel, 4)))
  driver = ndriver
  eng = neng
  tyr = ntyr
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
demand = eng * FE * ths / TM
aero = FMUL(FMUL(v, v), DRAG2)
accel = FDIV(demand - aero, mass) - FMUL(v, DRAG)
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
  demand = eng * FE * tht / TM
  aero = FMUL(FMUL(v, v), DRAG2)
  accel = FDIV(demand - aero, mass) - FMUL(v, DRAG)
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
IF section = 4 THEN
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
    inputs: ['ths', 'tht', 'ndriver', 'neng', 'ntyr', 'nfuel'],
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
  ndriver: number[]; neng: number; ntyr: number; nfuel: number
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
      ...st.raceId, ...inp.ndriver, ...le(inp.neng, 1), ...le(inp.ntyr, 1), ...le(inp.nfuel, 4),
    ])
    return {
      raceId, phase: PHASE.RACING, section: 0, lap: 0,
      v: C.V0, fuel: inp.nfuel, t: 0,
      eng: inp.neng, tyr: inp.ntyr, driver: inp.ndriver, deslot: false,
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
    const demand = t0(st.eng * C.FE * th / C.TM)
    const aero = fmul(fmul(v, v), C.DRAG2)
    const accel = fdiv(demand - aero, mass) - fmul(v, C.DRAG)
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
  if (section === 4) { section = 0; lap = lap + 1 }
  if (lap === track.laps) phase = PHASE.FINISHED
  /* ⚠ LAST, and the order is load-bearing — see the note in LANE_SRC. */
  if (deslot) phase = PHASE.DESLOTTED

  return { ...st, v, fuel, t, section, lap, phase, deslot }
}
