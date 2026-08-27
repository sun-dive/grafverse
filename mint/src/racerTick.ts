// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
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

REM  ── force is what the tyres will take. Drag is linear plus quadratic, and
REM  MODEL C splits them: the aerodynamic term is a FORCE, so it divides by
REM  mass and a heavy car coasts further. Rolling resistance is itself
REM  proportional to mass, so its deceleration is not — it stays a fraction.
REM  ⚠ force - aero GOES NEGATIVE on every coasting tick. OP_DIV truncates
REM  toward zero and so does the reference; checked all four sign cases.
aero  = FMUL(FMUL(v, v), DRAG2)
force = demand
IF spun = 1 THEN force = grip
nv = v + FDIV(force - aero, mass) - FMUL(v, DRAG)
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
REM  ── the fifth ending: rolled to a halt. Legal, but no time and no row.
REM  ⚠ AFTER the finish test, so a car crawling over the line still finishes,
REM  and BEFORE the wreck test, so a wreck still wins. The order is the rule.

REM  ★★★ THE CLOSED FORM. Once the tank is empty the rest of the run is
REM  decided, and the whole remaining coast is the geometric sum of a decaying
REM  speed. Ignoring aero OVER-estimates it — aero only ever slows the car
REM  more — so falling short under the over-estimate is a PROOF, and the run
REM  ends with no coast simulated at all.
REM  ⚠ reach >= ns always, so reach < finish already implies ns < finish.
coast = FDIV(S - DRAG, DRAG)
reach = ns + FMUL(nv, coast)
IF COAST_STOP > 0 AND prop <= 0 AND reach < finish THEN nphase = P_STOPPED

REM  ⚠ There is deliberately NO speed floor here. One was built and removed:
REM  a floor cannot tell a car that is slow but WILL cross from one that is
REM  slow and will not, and it stole three legitimate finishes in eight.
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
REM  ⚠ CLAMP AT EMPTY. The reference harness does MAX(0, ...) and an unclamped
REM  fuel goes NEGATIVE once the tank empties — taking mass with it, since mass
REM  carries the fuel. A car lighter than its own chassis is not a car.
fuel = MAX(0, fuel - burn)
IF out = 1 THEN live = 0
IF ns >= finish THEN live = 0
NEXT i
`

/** What a simulated tick did — enough to compile the run that actually happens. */
export interface TickTrace {
  /**
   * ★ THE THROTTLE THAT WAS APPLIED — not the one the driver asked for.
   * A dry tick applies ZERO however hard the pedal was pressed, so this is `TickResult.throttle`,
   * never the request. A trace that records the request compiles a car that keeps accelerating where
   * the simulated one coasted — which is what made every dry car unraceable. → §6j
   */
  throttle: number
  /** did the tyres let go? */
  spun: boolean
}

/**
 * How a run finishes. ⚠ A specialised script must know its own ending, because an ending is not an
 * exception here — it is the last line of the program.
 *
 * ★ THE FIFTH ONE WAS A CASUALTY, NOT A DECISION. The chained car answered "what if it runs out?" with
 * the RESERVE — satoshis that bought ticks but carried no weight, so a dry car had a defined coast.
 * When the fee left the loop the reserve went to zero and the defined coast went with it, leaving a car
 * that could roll for ever and never end. `stopped` is that ending, restored.
 */
export type Ending =
  | 'finish'         // crossed the line
  | 'off'            // moving, lost grip, and gone
  | 'blown-throttle' // standing, lost grip, and the motor ran away with itself
  | 'blown-speed'    // too fast for the machinery
  | 'stopped'        // ★ dry, and provably short of the line. Legal — but no time and no leaderboard row

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
    /* ★★ A DRY TICK IS A REAL TICK, and this is where that was denied. `t.throttle` is the EFFECTIVE
       throttle the reference applied — zero once the propellant is gone — so a dry tick's `demand` and
       `burn` come out right as literals, with NO BRANCH. That matters twice over: a car may not carry
       one opcode of control flow, or the depot's tail-only recognition stops being safe. */
    const dry = t.throttle === 0
    out.push(
      ``,
      `REM  ── tick ${i + 1}${dry ? ' · dry, coasting' : ''}${last ? `  ← ${ending}` : ''} ──`,
      /* ⚠⚠ THE FUEL ASSERTION FLIPS, IT DOES NOT DISAPPEAR. `VERIFY fuel > 0` on every tick is what
         made a dry car unmintable — but simply deleting it would let a trace compile a dry tick with
         the throttle held OPEN, producing a car faster than the one that was simulated. One of the two
         must hold on every tick, and which one is a fact about the trace, not a choice. */
      dry ? `VERIFY fuel = 0` : `VERIFY fuel > 0`,
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
      out.push(`VERIFY v >= LOOSE_V`, `v = 0`, `fuel = MAX(0, fuel - burn)`)
      return
    }
    if (last && ending === 'blown-throttle') {
      // the throttle is a literal, so `throttle >= BLOW_T` was settled at compile time
      out.push(`VERIFY v < LOOSE_V`, `v = 0`, `fuel = MAX(0, fuel - burn)`)
      return
    }

    /* ★ MODEL C — the aero term is a force and divides by mass, so a heavy car coasts further.
       ⚠ `force - aero` goes NEGATIVE on every coasting tick; OP_DIV and the reference both truncate
       toward zero, checked across all four sign combinations. */
    out.push(
      `aero = FMUL(FMUL(v, v), DRAG2)`,
      `nv = v + FDIV(${t.spun ? 'grip' : 'demand'} - aero, mass) - FMUL(v, DRAG)`,
    )
    if (t.spun) out.push(`nv = FMUL(nv, SPIN_KEEP)`)

    /* ── too fast for the machinery, judged on the speed THIS tick produced ─────────────────────── */
    if (last && ending === 'blown-speed') {
      out.push(`VERIFY nv >= BLOW_V`, `v = 0`, `fuel = MAX(0, fuel - burn)`)
      return
    }

    out.push(`VERIFY nv < BLOW_V`, `ns = s + nv`)

    /* ── ★★★ THE ENDING'S OWN ASSERTION ─────────────────────────────────────────────────────────────
       A run may not finish early and may not fail to finish: both are asserted, every tick.

       ★★ AND A STOPPED CAR PROVES ITSELF IN ONE MULTIPLY. Once the tank is empty the rest of the run
       is decided, so the whole remaining coast is the geometric sum of a decaying speed — and it
       replaces every coast tick that would otherwise have to be unrolled to show the car halting.
       ⚠ Written as `FDIV(S - DRAG, DRAG)`, NEVER as the number 49. THE HARD RULE: the compiled script
       must say what the program says, and a reader must see the coast RULE rather than a constant
       nobody can check.
       ⚠ Sound in one direction only — ignoring aero OVER-estimates the coast, so falling short under
       the over-estimate is a proof. It is not a way to prove a car WILL finish.
       ⚠⚠ And `VERIFY fuel = 0` was already emitted at the top of this tick, because a stopped run's
       last tick is by definition dry. That is what stops `stopped` being claimed with fuel in hand. */
    if (last && ending === 'stopped') {
      out.push(
        `coast = FDIV(S - DRAG, DRAG)`,
        `VERIFY ns + FMUL(nv, coast) < finish`,
      )
    } else {
      out.push(last ? `VERIFY ns >= finish` : `VERIFY ns < finish`)
    }

    out.push(`v = nv`, `s = ns`, `fuel = MAX(0, fuel - burn)`)
  })
  return out.join('\n') + '\n'
}
