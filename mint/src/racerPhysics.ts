// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ THE ONE-RACE CAR'S OWN PHYSICS — and it is a SEPARATE FILE on purpose.
 *
 * ⚠⚠ THE RULE THIS FILE EXISTS TO OBEY: **every page's script is isolated.** `shell.ts` is bundled
 * into BOTH `vendor/grafmint.js` (depot · battery · brc226 · grafverse · racers) AND, through
 * `grafbasic.ts`, into `vendor/grafbasic.js` (basic.html). Model C was first written INTO `shell.ts`,
 * which made the one-race car's physics a dependency of six live pages and of a bundle basic.html
 * loads. It was reverted for that reason (sun-dive, 20 Aug), not because the physics was wrong.
 *
 * ⇒ This file READS from `shell.ts` and never modifies it. `shell.ts` therefore still describes the
 * DEPLOYED chained shell byte for byte, both live bundles rebuild identically, and the two covenants
 * can no longer break each other.
 *
 * ── WHAT IS DIFFERENT FROM `refTick` ──────────────────────────────────────────────────────────────
 * Exactly three things, and each is switchable so the difference can be PROVED rather than asserted:
 *
 *   AERO_BY_MASS   the aerodynamic term is a FORCE and divides by mass, so a heavy car coasts further
 *   COAST_STOP     a dry car that provably cannot reach the line ends as `stopped` — one multiply
 *   throttle       the EFFECTIVE throttle is reported, because a dry tick applies zero
 *
 * ⚠ Everything else is `refTick`'s logic, copied deliberately. Two implementations CAN drift — which
 * is the failure this project spends its time on — so `test/racer-physics.ts` pins them together:
 * with both switches OFF, `racerRefTick` must agree with `refTick` tick for tick. A drift is then a
 * red test rather than a wrong car.
 *
 * → `~/Documents/racers-where-we-stand.md` §6j
 */
import {
  PHASE, S, fmul, fdiv, RACER_REGS, SLIP_UNIT,
  type RacerRegs, type ShellState, type Move, type TickResult,
} from './shell.ts'

/** ★ The phases a one-race car can leave behind — the shell's, plus the fifth ending. */
export const RACER_PHASE = { ...PHASE, STOPPED: 7 } as const
export const RACER_PHASE_NAMES: Record<number, string> =
  { 0: 'EMPTY', 1: 'CAR', 2: 'TRACK', 3: 'ARMED', 4: 'RACING', 5: 'DONE', 6: 'OUT', 7: 'STOPPED' }

/**
 * The one-race car's regulations: the shell's, plus the two switches model C needs.
 *
 * ⚠ Declared as an EXTENSION rather than a rewrite, so every constant the chained shell races under is
 * literally the same number and cannot drift by being retyped.
 */
export interface OneRaceRegs extends RacerRegs {
  /**
   * ★★ MODEL C — the AERODYNAMIC term divides by mass, so a heavy car coasts further. ZERO disables it.
   *
   * Drag used to be a flat velocity fraction: `mass` divided the FORCE and nothing else, so a 0.93
   * chassis and a 2.35 chassis decelerated identically and MOMENTUM DID NOT EXIST IN THE COAST. Not a
   * tuning choice — a missing `/mass`.
   *
   * ★ AND THE PHYSICS SPLITS, which is why only the quadratic term moves. Rolling resistance force is
   * itself proportional to mass, so its DECELERATION is mass-independent and the linear term stays a
   * velocity fraction. Aerodynamic drag is not, so its deceleration goes as 1/m.
   *
   * Measured (coast from 10 m/tick): eng 1/tyr 1 goes 238 m → 166 m, eng 24/tyr 10 goes 238 m → 264 m.
   * A big engine coasts 1.6× as far as a small one, where the spread used to be exactly zero.
   * ⇒ `burn ∝ eng`, so a big motor drinks faster AND glides further — a gambler's choice.
   */
  AERO_BY_MASS: number
  /**
   * ★★★ THE CLOSED-FORM STOP — a dry car that provably cannot reach the line ends HERE. ZERO disables it.
   *
   * Once the tank is empty there is no further input, so the rest of the run is decided. The whole
   * remaining coast is the geometric sum of a decaying speed:
   *
   *     coast = (1 − DRAG) / DRAG = 49        reach = s + 49·v
   *
   * ★ Ignoring aerodynamic drag OVER-estimates the coast — aero only ever slows it MORE — and an
   * over-estimate that still falls short of the line is a PROOF. One multiply, no coast unrolled.
   * ⇒ Sound in one direction only: `reach < finish` proves it cannot reach; `reach >= finish` proves
   * nothing and the car must go on being simulated.
   *
   * ★★ AND IT TERMINATES ON ITS OWN, measured. `reach` is exactly CONSERVED under linear decay
   * (Δreach = v′ + 49(v′ − v) = 0 at v′ = 0.98v) and strictly falls once aero is in, so it never rises
   * and every non-crossing car eventually proves itself short. 9–17 coast ticks for a clear-cut car.
   *
   * ⚠⚠ A SPEED FLOOR CANNOT DO THIS JOB, and a `STOP_V` reg was built, measured and REMOVED for it
   * (20 Aug). A floor cannot tell "slow but WILL cross" from "slow and will not": a car going dry at
   * 166/175/200 m genuinely crosses but spends its coast under 1 m/tick, and would have been called
   * stopped at tick 62 — three legitimate finishes stolen out of eight tested. Only the closed form
   * asks the right question, because it asks about DISTANCE REMAINING, not speed.
   *
   * ⚠ Near the finish/stop boundary a car can still cost up to 210 coast ticks ≈ 47 KB. That is what
   * the right-shift halvings are for; `RACER_MAX_CAR_BYTES` is a DEPOT PARAMETER and not a rule, so
   * nothing forbids such cars — a bigger depot mints them. What is untested is the ~94 KB mint.
   */
  COAST_STOP: number
}

/* ── ★ THE CHASSIS, named because the DRAG2 calibration is DERIVED from it ───────────────────────
   ⚠ Read back off `RACER_REGS` rather than retyped, so there is exactly ONE place these numbers live
   and a hand-copied `1.85` cannot drift from them. */
const DEFAULT_DRY_MASS = (RACER_REGS.M0 + 14 * RACER_REGS.WE + 10 * RACER_REGS.WT) / S   // 1.85

/**
 * ★★★ THE ONE-RACE CAR'S REGULATIONS — model C, and the only reg set that carries it.
 *
 * A one-race car is compiled from BASIC (`TICK_SRC` / `specialiseRun`) and minted fresh for a single
 * run, so it CAN receive a physics change. The chained shell cannot: its physics is hand-emitted
 * Script that is already deployed. That is the entire reason these are two sets and not one.
 */
export const ONE_RACE_REGS: OneRaceRegs = {
  ...RACER_REGS,
  /* ★ CALIBRATED, NOT CHOSEN. The linear-only figure (0.005) scaled by the DEFAULT DRY MASS, so under
     model C a default car's coast is UNCHANGED (238.0 m, measured) and the new behaviour appears only
     as a SPREAD across engine sizes — a redistribution rather than a global shift.
     ⚠ PROVISIONAL, deliberately (sun-dive: *"close enough for now, better to get the physics more real
     first"*). What this anchor does NOT hold is race TIME: 6.00 s → 5.40 s at 402 m on 40,000 fuel,
     because mid-race mass is ~6.25 and the aero term is divided by it. The real fit — sweep DRAG2
     across eng × tyr × fuel — is PARKED, not forgotten. → §6j */
  DRAG2: Math.round(0.005 * DEFAULT_DRY_MASS * S),
  AERO_BY_MASS: 1,
  COAST_STOP: 1,
}

/** What a one-race tick produced. The shell's result, plus the throttle that was actually applied. */
export interface RacerTickResult extends Omit<TickResult, 'ended'> {
  /**
   * ★★ THE THROTTLE THAT WAS ACTUALLY APPLIED — which is NOT always the one the driver asked for.
   *
   * With no propellant the throttle is forced shut and the car coasts, so a dry tick applies ZERO
   * however hard the pedal was pressed. Reported rather than left to be re-derived, because a trace
   * that records the REQUEST instead of the EVENT compiles into a car that keeps accelerating where
   * the simulated one coasted — which is exactly what made every dry car unraceable.
   * ⇒ A harness building a `TickTrace` must record THIS.
   */
  throttle: number
  /** ★ `stopped` is not a death: `off`/`blown` are wrecks and leave `OUT`. Only ever set by COAST_STOP. */
  ended: 'off' | 'blown' | 'stopped' | null
}

const need = (ok: boolean, why: string): void => { if (!ok) throw new Error(`racerPhysics: ${why}`) }

/**
 * ★★★ ONE PRESS OF THE ACCELERATOR, for a ONE-RACE car — the reference the BASIC is checked against.
 *
 * ⚠ This is `refTick`'s logic with the two switches above. With both OFF it must agree with `refTick`
 * exactly, and `test/racer-physics.ts` requires it to — that guard is what makes the duplication safe.
 */
export function racerRefTick(st: ShellState, m: Move, regs: OneRaceRegs = ONE_RACE_REGS): RacerTickResult {
  need(st.phase === PHASE.ARMED || st.phase === PHASE.RACING,
    `only an armed or racing shell may be driven (this one is phase ${st.phase})`)
  need(m.throttle >= 0 && m.throttle <= regs.THROTTLE_MAX, `throttle must be 0..${regs.THROTTLE_MAX}`)
  if (st.phase === PHASE.ARMED) need(m.lockTime >= st.green, 'a false start: this move precedes the green')
  else need(m.lockTime >= st.last + st.gap, `moves must be at least ${st.gap} apart`)

  const propellant = regs.RESERVE === 0 ? m.fuel : Math.max(0, m.fuel - regs.RESERVE)
  const mass = regs.M0 + st.eng * regs.WE + st.tyr * regs.WT + fmul(propellant * S, regs.WF)
  need(mass > 0, 'a car cannot be massless')

  /* ★★ WITH NO PROPELLANT THERE IS NO POWER — the car COASTS, throttle forced shut. */
  const throttle = propellant > 0 ? m.throttle : 0

  const grip = Math.trunc(((st.tyr * regs.G0 + fmul(st.v, regs.GV)) * st.slip) / SLIP_UNIT)
  const demand = Math.trunc((st.eng * regs.FE * throttle) / regs.THROTTLE_MAX)
  const spun = demand > grip
  const burn = regs.BURN0 + Math.trunc((st.eng * regs.BURN_E * throttle) / regs.THROTTLE_MAX)

  /* SPEED IS CHECKED FIRST — a moving car that loses grip steps sideways; a standing one runs the
     motor away with itself. Same lost grip, two endings, decided by whether it was going anywhere. */
  if (spun && st.v >= regs.LOOSE_V) {
    return { state: { ...st, phase: PHASE.OUT, last: m.lockTime, n: st.n + 1, v: 0 }, burn, spun, throttle, ended: 'off' }
  }
  if (spun && throttle >= regs.BLOW_T) {
    return { state: { ...st, phase: PHASE.OUT, last: m.lockTime, n: st.n + 1, v: 0 }, burn, spun, throttle, ended: 'blown' }
  }

  const force = spun ? grip : demand

  /* ★★ MODEL C. The aero term is a force and divides by mass; rolling resistance stays a fraction.
     ⚠ `force - aero` GOES NEGATIVE on every coasting tick, so this division is the one place the
     reference and the script could round apart. Both truncate toward zero — `fdiv` here and `OP_DIV`
     there — checked across all four sign combinations through the real interpreter.
     ⚠⚠ But that is the `@bsv/sdk` interpreter agreeing with the reference, NOT a node: every division
     deployed so far has a positive numerator, so this is the first negative-operand OP_MUL and OP_DIV
     this project would broadcast. It is in the opcode probe for that reason. */
  const aero = fmul(fmul(st.v, st.v), regs.DRAG2)
  let v = regs.AERO_BY_MASS !== 0
    ? st.v + fdiv(force - aero, mass) - fmul(st.v, regs.DRAG)
    : st.v + fdiv(force, mass) - fmul(st.v, regs.DRAG) - aero
  if (spun) v = fmul(v, regs.SPIN_KEEP)
  if (v < 0) v = 0                                   // a car does not roll backwards down a drag strip

  if (regs.BLOW_V > 0 && v >= regs.BLOW_V) {
    return { state: { ...st, phase: PHASE.OUT, last: m.lockTime, n: st.n + 1, v: 0 }, burn, spun, throttle, ended: 'blown' }
  }

  const s = st.s + v
  const done = s >= st.finish

  /* ★★★ THE CLOSED FORM — a dry car that PROVABLY cannot reach the line ends here, no coast simulated.
     `coast` is the geometric sum of a decaying speed, `(1 − DRAG)/DRAG`, written as the arithmetic
     rather than as the number 49 so the script says what the rule is.
     ⚠ CHECKED AFTER THE FINISH, and the order is load-bearing exactly as it is for the two deaths: a
     car crawling over the line has FINISHED, and testing this first would take away a real result. */
  const coast = fdiv(S - regs.DRAG, regs.DRAG)
  const provablyShort = regs.COAST_STOP !== 0 && propellant <= 0 && s + fmul(v, coast) < st.finish
  if (!done && provablyShort) {
    return {
      state: { ...st, phase: RACER_PHASE.STOPPED, last: m.lockTime, s, v, n: st.n + 1 },
      burn, spun, throttle, ended: 'stopped',
    }
  }

  return {
    state: { ...st, phase: done ? PHASE.DONE : PHASE.RACING, last: m.lockTime, s, v, n: st.n + 1 },
    burn, spun, throttle, ended: null,
  }
}
