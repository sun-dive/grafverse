// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ ONE TICK OF A BITCOIN RACER, WRITTEN IN BITCOIN BASIC.
 *
 * `shellPhysicsOps` emits this by hand in Script and `refTick` computes it in TypeScript. This is the
 * third way of saying it, and the point of saying it a third time is that this one can be **unrolled**:
 * a whole quarter mile compiles into one locking script instead of forty-five chained spends.
 *
 * ⚠ THERE IS NO EARLY RETURN IN SCRIPT. `refTick` returns the moment a run ends badly, so the drag
 * arithmetic below it never executes. Here every line runs and the ending is carried as a flag, with the
 * speed and the distance corrected at the bottom. The FINAL STATE is identical; the route to it is not,
 * and it could not be — a covenant computes one successor, it does not jump out of itself.
 *
 * ⚠ AND EVERY VARIABLE ASSIGNED INSIDE AN `IF` EXISTS BEFORE IT. The compiler refuses otherwise, and it
 * is right to: both arms of an OP_IF must leave the stack identical, so a name born inside one arm is a
 * name the other arm cannot account for.
 */

/** The stack this program expects, bottom first — the state, then the move. */
export const TICK_STACK = ['v', 's', 'n', 'eng', 'tyr', 'slip', 'finish', 'fuel', 'throttle'] as const

/** What it leaves, top last. `out` is 1 when the run ended badly. */
export const TICK_RESULT = ['nv', 'ns', 'nn', 'nphase', 'burn', 'spun', 'out'] as const

export const TICK_SRC = `
REM  ── one tick of a drag car ─────────────────────────────────────────
REM  Every name assigned inside an IF is given a value first: both arms of
REM  an OP_IF must leave the stack identical, so a name cannot be born in one.
prop  = fuel
th    = 0
spun  = 0
out   = 0
force = 0

REM  ── the propellant, and with none of it the throttle is forced shut ──
REM  A dry car COASTS. It rolls for as long as it can buy ticks, which is
REM  exactly what the reserve is: how far it can coast.
IF RESERVE > 0 THEN prop = MAX(0, fuel - RESERVE)
IF prop > 0 THEN th = throttle

REM  ── mass carries the fuel, so the car lightens as it burns ──
mass = M0 + eng * WE + tyr * WT + FMUL(prop * S, WF)

REM  ── grip rises with speed, which is why a big engine wastes force off
REM  the line and rewards good tyres. The surface scales the lot.
grip   = (tyr * G0 + FMUL(v, GV)) * slip / SLIP
demand = eng * FE * th / TM
IF demand > grip THEN spun = 1

REM  ── what a tick costs, and it rises with what you asked of the engine ──
burn = BURN0 + eng * BURN_E * th / TM

REM  ── the two ways lost grip ends a run, and SPEED IS CHECKED FIRST.
REM  A moving car that loses grip steps sideways and is gone. A stationary
REM  one has no load at all, so the motor runs away with itself instead.
REM  Same lost grip, two endings, decided by whether it was going anywhere.
IF spun = 1 AND v >= LOOSE_V THEN out = 1
IF spun = 1 AND th >= BLOW_T THEN out = 1

REM  ── force is what the tyres will take, drag is linear plus quadratic ──
force = demand
IF spun = 1 THEN force = grip
nv = v + FDIV(force, mass) - FMUL(v, DRAG) - FMUL(FMUL(v, v), DRAG2)
IF spun = 1 THEN nv = FMUL(nv, SPIN_KEEP)
IF nv < 0 THEN nv = 0

REM  ── too fast for the machinery, judged on the speed THIS move produced,
REM  so the driver who presses on past the plateau is the one who pays.
IF nv >= BLOW_V THEN out = 1

REM  ── distance, then the corrections a bad ending forces ──
ns = s + nv
IF out = 1 THEN nv = 0
IF out = 1 THEN ns = s

REM  ── the phase this move leaves behind ──
nn = n + 1
nphase = P_RACING
IF ns >= finish THEN nphase = P_DONE
IF out = 1 THEN nphase = P_OUT
`

/**
 * ★★★ THE WHOLE RUN, UNROLLED — a quarter mile as ONE locking script.
 *
 * Two things a single tick does not have to do, and both are forced by there being no way out of a
 * script early:
 *
 * ⚠ **FUEL IS CARRIED.** Chained, the transaction does this — `out0.value = V − burn`, once per spend.
 * Unrolled there is no output between ticks, so the loop carries it, and it matters: mass includes the
 * fuel, so a car that does not lighten as it burns is a different car.
 *
 * ⚠⚠ **A FINISHED RUN MUST BE MASKED.** Chained, the covenant simply refuses a move once `phase` is not
 * RACING. Unrolled, the remaining iterations are already in the script and WILL execute — so every tick
 * is guarded, and a dead one leaves the state exactly as it found it. This is the "unroll to the worst
 * case and mask the rest" that BRC-Z §4.2 describes, arriving in the first program that needed it.
 *
 * ⇒ The cost is that a race always pays for its longest permitted run. A car compiled for 45 ticks pays
 * for 45 whether it finishes in 42 or spins at 3.
 */
export const tickLoopSrc = (ticks: number): string => `
live = 1
FOR i = 1 TO ${ticks}
${TICK_SRC}
REM  ── carry the run forward, and let a finished one lie ──
IF live = 0 THEN nv = v
IF live = 0 THEN ns = s
IF live = 0 THEN nn = n
IF live = 0 THEN burn = 0
v = nv
s = ns
n = nn
fuel = fuel - burn
IF out = 1 THEN live = 0
IF ns >= finish THEN live = 0
NEXT i
`

/** What a simulated tick did — enough to compile the run that actually happens. */
export interface TickTrace {
  /** the throttle the driver asked for on this tick */
  throttle: number
  /** did the tyres let go? */
  spun: boolean
}

/**
 * How a run finishes. ⚠ There is no fifth option: a specialised script must know its own ending, because
 * an ending is not an exception here — it is the last line of the program.
 */
export type Ending =
  | 'finish'         // crossed the line
  | 'off'            // moving, lost grip, and gone
  | 'blown-throttle' // standing, lost grip, and the motor ran away with itself
  | 'blown-speed'    // too fast for the machinery

export interface RunTrace { ticks: TickTrace[]; ending: Ending }

/**
 * ★★★ COMPILE THE RUN THAT ACTUALLY HAPPENS — INCLUDING HOW IT ENDS.
 *
 * The generic tick asks a question at every branch and carries both answers. A simulated run already
 * knows every answer, so each branch becomes an **assertion**: cheaper than two arms, and it enforces the
 * same thing by refusing rather than by choosing.
 *
 * ⚠⚠ THIS IS PROVING, NOT TRUSTING. `VERIFY grip >= demand` does not assume the car kept grip — it makes
 * the spend INVALID if it did not. A wrong prediction therefore produces no race at all rather than a
 * wrong one, which is the only reason a specialised script may be trusted with a leaderboard.
 *
 * ★★ AND THE ENDING IS COMPILED IN. A run that wrecks at tick 9 is a script that wrecks at tick 9 — the
 * crash is not an exception path, it is the last thing the program does. A car is therefore minted
 * already knowing how it dies, and the chain will not accept any other death.
 *
 * ★ `n` never appears: the tick count is the length of the trace, so elapsed time is a literal the
 * compiler already knows. The only values that must still be computed are the ones that carry — `v`, `s`
 * and `fuel` — and those are exactly the ones a leaderboard reads.
 */
export function specialiseRun(run: RunTrace): string {
  const { ticks, ending } = run
  const out: string[] = ['REM  ── a run compiled from its own simulation, ending and all ──']

  ticks.forEach((t, i) => {
    const last = i === ticks.length - 1
    out.push(
      ``,
      `REM  ── tick ${i + 1}${last ? `  ← ${ending}` : ''} ──`,
      `VERIFY fuel > 0`,
      `mass = M0 + eng * WE + tyr * WT + FMUL(fuel * S, WF)`,
      `grip = (tyr * G0 + FMUL(v, GV)) * slip / SLIP`,
      `demand = eng * FE * ${t.throttle} / TM`,
      t.spun ? `VERIFY demand > grip` : `VERIFY grip >= demand`,
      `burn = BURN0 + eng * BURN_E * ${t.throttle} / TM`,
    )

    /* ── the two endings decided BEFORE the car moves ──────────────────────────────────────────────
       Lost grip at speed and lost grip standing still are different deaths, and refTick separates them
       on `v >= LOOSE_V`. Neither computes a new speed: the car is simply gone, and `s` stays where it
       was. So a specialised run stops here — there is no arithmetic left to do. */
    if (last && ending === 'off') {
      out.push(`VERIFY v >= LOOSE_V`, `v = 0`, `fuel = fuel - burn`)
      return
    }
    if (last && ending === 'blown-throttle') {
      // the throttle is a literal, so `throttle >= BLOW_T` was settled at compile time
      out.push(`VERIFY v < LOOSE_V`, `v = 0`, `fuel = fuel - burn`)
      return
    }

    out.push(`nv = v + FDIV(${t.spun ? 'grip' : 'demand'}, mass) - FMUL(v, DRAG) - FMUL(FMUL(v, v), DRAG2)`)
    if (t.spun) out.push(`nv = FMUL(nv, SPIN_KEEP)`)

    /* ── too fast for the machinery, judged on the speed THIS tick produced ─────────────────────── */
    if (last && ending === 'blown-speed') {
      out.push(`VERIFY nv >= BLOW_V`, `v = 0`, `fuel = fuel - burn`)
      return
    }

    out.push(
      `VERIFY nv < BLOW_V`,
      `ns = s + nv`,
      // a run may not finish early and may not fail to finish: both are asserted
      last ? `VERIFY ns >= finish` : `VERIFY ns < finish`,
      `v = nv`,
      `s = ns`,
      `fuel = fuel - burn`,
    )
  })
  return out.join('\n') + '\n'
}
