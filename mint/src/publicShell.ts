// © BSV Association — Open BSV License v6.
/**
 * ★ THE PUBLIC CAR — step 1: the reference implementation.
 *
 * A car anyone may drive and nobody may claim, so a visitor can race with no wallet, no key and no
 * satoshi. It is the racing shell with the *driving* half of ownership removed:
 *
 *                             owned shell              PUBLIC car
 *   driver / owner            loaded, then required    fixed at genesis, never loadable
 *   signature on a move       required from phase 1    NEVER — anyone may drive
 *   retire                    pays the driver, → OUT   RESETS: → EMPTY, fuel kept
 *   burn                      owner-signed sweep       owner-signed sweep (the upgrade path)
 *   any output paying a person on an ordinary move     IMPOSSIBLE — no rule creates one
 *
 * ★ FUEL ENTERS BY GIFT AND LEAVES BY RACING. The only branch that can pay anybody is the owner's
 * burn, and that exists because a covenant cannot be amended: replacing a design means burning what
 * exists and minting its successor, so a car with no owner would freeze v1 forever, its fuel with it.
 * Permanence is right when it IS the demonstration; here the demonstration is the racing, and a car is
 * equipment. Equipment should be replaceable.
 *
 * ── ⚠ WHY `driver` HOLDS THE OWNER ────────────────────────────────────────────────────────────────
 * The obvious design gives the public variant no driver at all and bakes the owner into the script as
 * a build parameter. That costs a second state layout, a second frame, a second physics stack model —
 * duplication of the exact machinery whose bugs cost the most to find.
 *
 * Instead the field stays where it is and changes JOB. In a public car `driver` is the OWNER: never
 * loaded, never checked on a move, and checked only by the burn. So the state layout, the frame, the
 * peel-and-rebuild and the physics are all literally the same code, and the divergence is confined to
 * which branches exist.
 *
 * ⇒ And a reset therefore preserves `driver` and zeroes everything else, which is still exactly ONE
 * constant state for a given owner — which is what lets the depot check a car with a single hash
 * instead of parsing one.
 *
 * ── ⚠ THE HOLE THIS CLOSES ────────────────────────────────────────────────────────────────────────
 * An EMPTY shell with a zero driver is CLAIMABLE BY ANYONE — that is what makes claiming work at all.
 * So a public car full of donated fuel, if it were merely "keyless", could be claimed by a passer-by
 * who then owns it, burns it, and walks off with the tank. Gating the signature on `driver ≠ 0` does
 * not help: nothing distinguishes a public car from a fresh owned one. Giving the field an owner from
 * birth, and never making it loadable, is what shuts that door.
 */
import {
  emptyShell, loadCar, PHASE, PHASE_NAMES, FIELDS, ShellRefused, stateFits,
  RACER_REGS, type ShellState, type RacerRegs,
} from './shell.ts'

const need = (ok: boolean, why: string): void => { if (!ok) throw new ShellRefused(why) }

/**
 * A public car at rest: everything zero except the owner.
 *
 * ★ This is THE constant. A public car sitting between races is byte-identical to one freshly minted,
 * so the depot pins a single script hash and never has to parse an output — whether it is creating a
 * car or refuelling one.
 */
export function freshPublicShell(owner: number[]): ShellState {
  need(owner.length === 20, 'the owner must be a 20-byte hash160')
  need(owner.some(b => b !== 0), 'the owner cannot be twenty zero bytes — that is an UNCLAIMED shell, which anybody may take')
  return { ...emptyShell(), driver: [...owner] }
}

/** Is this state a public car at rest? The predicate the depot's one-hash check stands for. */
export function isAtRest(st: ShellState, owner: number[]): boolean {
  const fresh = freshPublicShell(owner)
  return FIELDS.every(k => {
    const a = st[k], b = fresh[k]
    return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b
  })
}

/**
 * PHASE 0 → 1 · load the car. The engine and tyres, and NOTHING ELSE.
 *
 * ⚠ The difference from `loadCar` that carries all the weight: no driver argument exists, so the owner
 * cannot be replaced by whoever configures the car. The next driver rebuilds it; they never own it.
 */
export function publicLoadCar(
  st: ShellState, p: { eng: number; tyr: number }, regs: RacerRegs = RACER_REGS,
): ShellState {
  need(st.driver.some(b => b !== 0), 'a public car must have an owner before it can be configured')
  // every other bound — phase, engine and tyre ranges — is the owned rule, reused rather than restated
  const next = loadCar(st, { driver: st.driver, eng: p.eng, tyr: p.tyr }, regs)
  return next
}

/**
 * ★ THE RESET · DONE or OUT → EMPTY, with the fuel untouched.
 *
 * The owned shell verifies `phase < DONE` on every move, so a finished car is terminal and its
 * remaining satoshis are reachable only by burning it. A public car instead goes back to the start:
 * what one race did not burn, the next race runs on. **The car is the tank.**
 *
 * ⇒ Which makes the life cycle the battery's, already settled as the right one — it ticks forward, or
 * it waits for a recharge. There is no state in which it is finished and holding money.
 */
export function publicReset(st: ShellState): ShellState {
  need(st.phase === PHASE.DONE || st.phase === PHASE.OUT,
    `only a finished car can be reset (this one is ${PHASE_NAMES[st.phase]})`)
  return freshPublicShell(st.driver)
}

/**
 * Can the owner burn this? The upgrade path, and the ONLY branch that can pay a person.
 *
 * ⚠ Deliberately unconditional on phase: a car mid-race must be retirable to its replacement too, or
 * an upgrade waits on a driver who has wandered off. It enforces no outputs, exactly as PharLap's
 * editions do — the owner's SIGHASH_ALL signature already commits to every one of them.
 */
export function ownerMayBurn(st: ShellState, signerHash160: number[]): boolean {
  return st.driver.length === 20 && signerHash160.length === 20 &&
         st.driver.every((b, i) => b === signerHash160[i])
}

/** Every way a public car can legally leave a phase. Stated once so Script and reference cannot drift. */
export const PUBLIC_TRANSITIONS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  [PHASE.EMPTY]:  ['load the car', 'owner burn'],
  [PHASE.CAR]:    ['load the track', 'owner burn'],
  [PHASE.TRACK]:  ['arm', 'owner burn'],
  [PHASE.ARMED]:  ['tick', 'owner burn'],
  [PHASE.RACING]: ['tick', 'owner burn'],
  [PHASE.DONE]:   ['reset', 'owner burn'],
  [PHASE.OUT]:    ['reset', 'owner burn'],
})

/** ⚠ A public car must never be able to encode a state it cannot carry. Same trap, same check. */
export const publicStateFits = stateFits
