// © BSV Association — Open BSV License v6.
/**
 * THE PROGRAMMABLE SHELL — a covenant that is LOADED rather than rebuilt.
 *
 * The battery is a machine with its program welded in: change MX0 and you mint a different battery.
 * This inverts that. One script, designed once, reproduced per instance, and configured by transactions
 * that write into its own locking script — which is exactly what a tick already is.
 *
 *   locking script   the register file, and the program
 *   one transaction  one clock cycle
 *   `phase`          the program counter
 *   unlocking script the input bus — untrusted, therefore bounded
 *   satoshis         the power supply
 *   the tx chain     the execution trace, pre-validated by miners
 *
 * ⚠ THE CEILING, STATED HONESTLY: data can be loaded, logic cannot. The instruction set is fixed when
 * the shell is designed. This shell accepts an engine, tyres, a finish line and a start time — it
 * cannot accept a different EQUATION. Loading real logic means an interpreter in Script fed with
 * bytecode, which is a different order of build and is not attempted here.
 *
 * ★ Because every instance begins byte-identical, every instance's genesis output has the SAME SCRIPT
 * HASH — so one script-hash query finds every race ever started. That anchor is only worth having if
 * the empty shell is genuinely constant: fixed widths, zeroed. `emptyShell()` is that constant, and
 * `shell-*.ts` asserts it does not drift.
 *
 * THIS FILE IS THE REFERENCE IMPLEMENTATION ONLY — the state machine in TypeScript, with every
 * regulation a named parameter. The Script comes next, and is validated against this. That is the order
 * that caught MX0 = 6 while it was still amendable.
 */
// ── scope ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * SIGHASH_ALL|FORKID (0x41) — NOT ANYONECANPAY, and that is a deliberate reversal of the battery.
 *
 * The battery uses ANYONECANPAY so any sponsor may add inputs and fuel it. A racer must not: under
 * ANYONECANPAY `hashPrevouts` is zeroed and the covenant is BLIND to its own other inputs, which makes
 * it impossible to require the prize pool on the finishing tick. Under SIGHASH_ALL, `hashPrevouts` is a
 * real hash over every input's outpoint, and the preimage separately carries THIS input's outpoint — so
 * the covenant can compute what hashPrevouts must be and demand the pot be present:
 *
 *   expected = SHA256d( ownOutpoint ‖ poolOutpoint )
 *
 * ⇒ a car cannot cross the line without the pot in the same transaction. The price is that you fund
 * your own car, which is more faithful to racing anyway.
 */
export const SHELL_SCOPE = 0x41

/** Fee floor. The official rate — never inflate it, never follow ARC's suggestion. */
export const SHELL_FEE_PER_KB = 100

/**
 * ⚠ HARD RULE — MAX_FEE MUST SIT ~64 SAT ABOVE THE TRUE FEE.
 *
 * A covenant derives its signature in-script and cannot negate a high `s`, and ARC rejects high-S as
 * non-canonical, so a spend is a coin flip that must be GROUND until it lands. The battery grinds
 * `nLockTime`. This shell cannot: `nLockTime` carries the start time and the minimum gap, so it is
 * pinned. The fee becomes the only lever.
 *
 * Measured 2026-08-14: LOW_S base rate 50.1% over 4,000 preimages — a true coin flip. With nLockTime
 * pinned and the fee the only lever, the worst case was 11 tries and 0/500 trials failed within 64 fee
 * values. 16 slack ⇒ ~1.5% chance of a stuck move per 1,000-tick race · 32 ⇒ 2e-7 · 64 ⇒ negligible.
 *
 * The battery's slack is FIVE satoshis (314 vs 309). Safe for it, fatal here.
 *
 * ⚠ PROVISIONAL. The true fee is not known until the script exists and a tick is SERIALIZED — hand
 * counts undercount the output script-length varint, which is precisely how the battery's first
 * MAX_FEE came out below the relay floor with no key to amend it.
 */
export const SHELL_FEE_SLACK = 64

/**
 * ★ THE WORST MOVE — AN UPPER BOUND, MEASURED. `shell-fee` asserts the real thing never exceeds it, so
 * a script that grows fails the suite rather than quietly underpaying on chain.
 *
 * ⚠ NOT an exact figure, and it must not be: a DER signature is 70–73 bytes depending on whether `r`
 * and `s` need a leading zero, so the same race measures 3,738 or 3,739 bytes on different runs with
 * different keys. Pinning it exactly made the suite oscillate between two values, each "correcting"
 * the other. Two bytes of headroom above the observed maximum costs 0.2 satoshi and cannot go under.
 */
export const SHELL_WORST_MOVE_BYTES = 3816

/**
 * ★ THE RATE THE BURN IS DERIVED AT — a tenth of a satoshi above SHELL_FEE_PER_KB, and no more.
 * We never inflate the official rate, not for ARC and not for comfort. That tenth is not margin, it
 * is ROUNDING INSURANCE: it guarantees the derived burn lands strictly ABOVE the floor rather than a
 * hair under it once `ceil` has had its say.
 */
export const SHELL_BURN_RATE_PER_KB = SHELL_FEE_PER_KB + 0.1

/**
 * ★ MAX_FEE — DERIVED FROM THE REGULATIONS, NOT WRITTEN DOWN.
 *
 * The value rule is a floor: `out ≥ V − MAX_FEE`. So it must be at least the largest burn any legal
 * car can produce, plus the LOW_S slack — and computing it from the regs means a bench session that
 * raises BURN_E cannot silently leave it behind.
 *
 * ⚠ AND THE BURN IS THE MINING FEE. Whatever the output holds less than the input is what the miner
 * takes, so the SMALLEST burn must clear the relay floor or those moves are simply never mined.
 * MEASURED by serializing a real spend, 2026-08-14:
 *
 *   worst transaction   ≤3,741 bytes  →  375 sat at the rate we pay
 *   burn at BURN0 = 40   40 sat  =  10.9 sat/KB   ← a tenth of the floor. Unmineable.
 *   burn at BURN0 = 400 400 sat  = 108.7 sat/KB   ← clears it, and overpays by 8.7%
 *   burn at BURN0 = 375 375 sat  = 100.3 sat/KB   ← what the network actually asks for
 *
 * ⚠ 3,679 → 3,741 when the BURN branch was added. At the old figure the burn came to 98.7 sat/KB —
 * UNDER the floor, on every move of every race, silently. The assertion in `shell-fee` caught it the
 * moment the script grew, which is the entire reason that check exists.
 *
 * ⚠ The size and the burn depend on each OTHER — a bigger burn can encode a byte wider, which makes
 * the move it is paying for larger. Treating the constant as a BOUND rather than an equality settles
 * that too: there is nothing to converge, only something to stay under.
 *
 * ⇒ BURN0 is not written down at all. It is `ceil(WORST_MOVE_BYTES × FEE_PER_KB / 1000)`, so the two
 * things that decide it are both named and both checked, and a script that grows re-derives its own
 * fee instead of silently drifting under the floor. The battery's first MAX_FEE was HAND COUNTED,
 * undercounted the output script-length varint, and landed under the floor with no key to amend it.
 * Measure, or do not mint.
 *
 * ⚠ The 64 sat of slack is not decoration either: pinning nLockTime for the Christmas tree took away
 * the lever the battery grinds for LOW_S, so the fee is the only one left.
 */
export const shellMaxFee = (regs: RacerRegs = RACER_REGS): number =>
  regs.BURN0 + regs.ENG_MAX * regs.BURN_E + SHELL_FEE_SLACK
/** The settled value at RACER_REGS — see SHELL_MAX_FEE below, which is the same formula applied once. */

// ── fixed point ──────────────────────────────────────────────────────────────────────────────────────
/** 1.0 = 2^32, as the battery. One convention across covenants is worth more than a tuned one. */
export const SHIFT = 32
export const S = 2 ** SHIFT
const SB = BigInt(S)

/**
 * Exact fixed-point multiply: trunc(a·b / 2^32), computed in BigInt.
 *
 * The battery had to split operands by hand because a double is exact only to 2^53 and `zr²` reaches
 * 2^66 — a subtle trap that produced transactions a node rejected. There is no reason to repeat it:
 * BigInt is exact by construction here, and Script's own integers are arbitrary-precision on BSV, so
 * this is the closer model of what the covenant actually does.
 */
export const fmul = (a: number, b: number): number => Number((BigInt(a) * BigInt(b)) / SB)
/** Exact fixed-point divide: trunc(a·2^32 / b). Truncates toward zero, as Script's OP_DIV does. */
export const fdiv = (a: number, b: number): number => {
  if (b === 0) throw new Error('fdiv: division by zero')
  return Number((BigInt(a) * SB) / BigInt(b))
}

// ── the regulations ──────────────────────────────────────────────────────────────────────────────────
/**
 * Baked into the SHELL, identical for every instance — so these ARE the racing regulations. Every car
 * ever built obeys them, and changing them means a new shell version, not a new race.
 *
 * ⚠⚠ EVERY NUMBER BELOW IS PROVISIONAL AND MUST BE SETTLED IN THE TOY BEFORE ANYTHING IS MINTED.
 * They are here so the machine runs, not because they are right. The battery's MX0 = 6 looked entirely
 * reasonable written down and was visibly wrong the moment it rendered a frame; there is no reason to
 * believe a drag car's drag coefficient is any different. Feel them out, then pin them.
 */
export interface RacerRegs {
  /** Chassis mass before engine and fuel. */
  M0: number
  /** Mass added per unit of engine. */
  WE: number
  /**
   * Mass added per unit of tyre — and without this a slip coefficient does nothing.
   *
   * If tyre is free, more of it is always better and every driver pins the slider, so a slippery track
   * simply means "everyone runs maximum". Charging weight for it makes the choice a real one and one
   * that CHANGES BY TRACK: on a grippy surface the extra rubber is dead weight, on a greasy one it is
   * the only thing keeping you on the island.
   */
  WT: number
  /** Mass added per satoshi of fuel — the tank is weight, and it burns off as you race. */
  WF: number
  /** Force per unit of engine at full throttle. */
  FE: number
  /** Grip at a standstill, per unit of tyre. */
  G0: number
  /** Extra grip per unit of velocity — grip rises with speed, so a big engine wastes force off the line. */
  GV: number
  /** Drag, applied to velocity every tick. This is what makes you keep pressing. */
  DRAG: number
  /**
   * ★ QUADRATIC drag — applied as `v² · DRAG2`, alongside the linear term above.
   *
   * ⚠ REAL DRAG GOES AS v², AND LINEAR DRAG CANNOT HOLD A CAR BACK. Measured on the settled
   * regulations: a quarter mile traps 459 mph and half a mile 490, still climbing, because the car
   * gets LIGHTER as it burns fuel — so it accelerates hardest at the finish line, which is backwards.
   * With a quadratic term the speed stops climbing and settles: at 0.0097 both a quarter mile and a
   * half mile trap 310 mph on eng 14, and 355 on eng 24. A real top fuel car traps about 330.
   *
   * ⇒ So a TOP SPEED does not need a rule. It falls out of the drag term being right, and the engine
   * ceiling with it — the biggest engine settles higher than the smallest, which is what makes engine
   * size a trade rather than a slider you push to the right.
   *
   * ZERO = the linear-only model the mainnet cars run, exactly. Tune it on the bench, not here.
   */
  DRAG2: number
  /**
   * Velocity at or above which the engine or gearbox LETS GO. Zero disables it.
   *
   * Distinct from LOOSE_V, which is about losing grip: this one needs no wheelspin at all, and is
   * simply the speed past which the machinery cannot survive. Its natural home is BETWEEN the plateaus
   * that DRAG2 produces — above it a big engine must lift before the line while a mid-size one never
   * has to think about it, and the risk is paid for by the driver rather than imposed by a bound.
   */
  BLOW_V: number
  /** Satoshis burned per tick regardless of throttle. */
  BURN0: number
  /** Extra satoshis burned per unit of engine at full throttle. */
  BURN_E: number
  /**
   * What survives a wheelspin, as a fraction of v (1.0 = 2^32).
   *
   * ★ THIS SINGLE NUMBER IS THE OPEN QUESTION that decides whether this is a sport. At 1.0 exceeding
   * grip merely wastes force — over-engining is inefficient and nothing more, and no sane driver ever
   * takes a risk. At 0 the run is dead. Somewhere between is a launch worth gambling on.
   */
  SPIN_KEEP: number
  /**
   * Velocity above which losing grip is TERMINAL rather than merely slow.
   *
   * Breaking traction off the line is survivable — you smoke the tyres and bog down. Breaking it once
   * the car is moving is not: it steps sideways and the run is over. Grip RISES with speed here (GV),
   * so a spin at speed is rare by construction, which is exactly what "the occasional one" should mean.
   */
  LOOSE_V: number
  /**
   * Throttle at or above which spinning GRENADES the engine.
   *
   * A different failure with a different cause: when the wheels let go the motor loses its load, and an
   * unloaded engine held wide open runs away with itself. So this is not about grip at all — it is about
   * what the driver does in the instant AFTER grip goes. Lift, and you keep the engine.
   */
  BLOW_T: number
  /** Throttle is an integer 0..THROTTLE_MAX. The driver's only freedom. */
  THROTTLE_MAX: number
  /** Bounds the covenant enforces on a loaded car — a car is provably LEGAL even if its lineage is not. */
  ENG_MAX: number
  TYR_MAX: number
}

/**
 * ★ SETTLED ON THE BENCH, 2026-08-14 — no longer guesses.
 *
 * Tuned until the meta stopped having a single answer, and the property the user stopped on is the one
 * worth having:
 *
 *   > "Bigger engine doesn't always win but it might once it's gained enough momentum."
 *
 * ⇒ **THE TRACK DECIDES THE BUILD.** A short strip rewards the light car that gets going quickly; a
 * long one gives a big engine room to use what it has. No car is right for everything, so the entry
 * decision is real every time — and it is how drag racing actually behaves, since big power needs
 * distance to be worth carrying. It also vindicates loading the track PER RACE rather than baking it
 * into the shell: one covenant hosts a meta whose answer changes with the strip.
 *
 * What moved, and why it produced that:
 *   DRAG   0.02 → 0.062   the engine of the whole effect. More drag means speed must be EARNED and
 *                         held, so a big motor needs distance before its advantage shows. Raised from
 *                         0.05 to bring terminal speeds down toward what a real car traps: at 0.05 an
 *                         eng 16 car ran 393 mph against a real dragster's ~330. At 0.062 it runs 360
 *                         in 4.7 s, against a real 4.5 — and the distance ladder survives intact,
 *                         shifted down about two engine sizes (402 m wants eng 18 rather than 20).
 *   BURN_E     6 → 35     big engines are genuinely thirsty now, so they can run dry — the tank
 *                         stopped being free and became a real part of the build.
 *   BURN0    40 → 375    ⚠ NOT a tuning choice and no longer a NUMBER — it is DERIVED from the worst
 *                         move's measured size and the rate we are willing to pay. The burn IS the
 *                         mining fee, and at 40 a small engine paid 11 sat/KB, so its moves would
 *                         never have been mined. It sat at 400 briefly, which cleared the floor by
 *                         8.7% — real money for nothing, 32 sat on every move of every race. Now it
 *                         re-derives itself whenever the script changes size.
 *   FE      0.20 → 0.32   closes the gap to a real Top Fuel car, and gives the top of the engine
 *                         range somewhere to go instead of plateauing.
 *   G0      0.15 → 0.36   more grip to spend, which is what makes the extra force usable at all.
 *   WF    1.0e-4 → 1.3e-4 fuel weighs a little more, so range is paid for.
 *   ENG_MAX   20 → 24     room above the old plateau.
 *
 * The decimals are written plainly here; the values exported from the bench carried slider
 * round-tripping noise (0.05000000004656613 and so on) that rounds to the identical integer — verified
 * field by field before cleaning, because "it looked the same" is not a reason to touch a constant.
 *
 * ⚠ STILL PROVISIONAL: LOOSE_V and BLOW_T. The bench had no sliders for them when these were settled,
 * so the two failure modes were never actually felt out. They want the same treatment before minting.
 */
export const RACER_REGS: RacerRegs = {
  M0: Math.round(0.85 * S),
  WE: Math.round(0.05 * S),
  WT: Math.round(0.03 * S),
  WF: Math.round(0.00011 * S),
  FE: Math.round(0.32 * S),
  G0: Math.round(0.36 * S),
  GV: Math.round(0.30 * S),
  DRAG: Math.round(0.02 * S),
  DRAG2: Math.round(0.005 * S),
  /* ★ 330 mph, WRITTEN AS THE CONVERSION rather than the integer it lands on. `v` is metres per 0.1 s,
     so mph = (v/S)·22.3694 — a constant nobody can read is a constant nobody can check. */
  BLOW_V: Math.round((330 / 22.3694) * S),
  SPIN_KEEP: Math.round(0.43 * S),
  LOOSE_V: Math.round(0.35 * S),
  BLOW_T: 14,
  BURN0: Math.ceil(SHELL_WORST_MOVE_BYTES * SHELL_BURN_RATE_PER_KB / 1000),   // 375 — see the MAX_FEE note
  BURN_E: 35,
  THROTTLE_MAX: 16,
  ENG_MAX: 24,
  TYR_MAX: 10,
}

/** Kept so the bench can offer "back to provisional", and so the diff above stays checkable. */
export const PROVISIONAL_REGS: RacerRegs = RACER_REGS

/* ⚠ This USED to read `400 + 24 * 35 + 64` — the formula above, copied out by hand because RACER_REGS
   is declared further down the file. Two places to change and one of them silent is exactly how a fee
   drifts under the floor, so it is now the function applied to the regulations, declared after them. */
export const SHELL_MAX_FEE = shellMaxFee(RACER_REGS)

// ── phases ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * The sequence IS the anti-cheat. Nobody swaps a bigger engine in after the fuel goes in, and the chain
 * records the order it happened.
 */
/** DONE is across the line. OUT is anything that ended the run without crossing it. */
export const PHASE = { EMPTY: 0, CAR: 1, TRACK: 2, ARMED: 3, RACING: 4, DONE: 5, OUT: 6 } as const
export type Phase = (typeof PHASE)[keyof typeof PHASE]
/** For refusals a human has to read. The covenant knows only the number. */
export const PHASE_NAMES: Record<number, string> =
  { 0: 'EMPTY', 1: 'CAR', 2: 'TRACK', 3: 'ARMED', 4: 'RACING', 5: 'DONE', 6: 'OUT' }

// ── state ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The registers the covenant carries in its own script.
 *
 * ⚠ Every byte here costs ~2.12 bytes PER MOVE, forever — once in the output, and again inside the
 * preimage the unlocking script carries (measured on the battery: lock 1,428 B → unlock 1,600 B). On
 * this machine memory costs power, which is not a constraint any silicon CPU has and is the reason the
 * working set is kept this small.
 *
 * `fuel` is deliberately ABSENT: it is the output's own satoshi value, which the covenant already reads
 * out of the preimage for the fee check. So the tank costs no register at all, and mass can include it
 * for free.
 *
 * v1 uses ONE key for owner, funder and driver — you mint your own car, you configure it, you drive it.
 * Separating owner from driver is what makes "who was driving" interesting (you could lend a good car to
 * a better driver) and is deliberately left to a later shell version rather than guessed at now.
 */
export interface ShellState {
  phase: Phase
  /** hash160 of the one key that may configure, fund and drive this instance. */
  driver: number[]
  /**
   * The prize pool's outpoint — 32-byte txid then 4-byte index, exactly as a transaction serializes it.
   *
   * Baked when the track is loaded, because the covenant must know WHICH pot before the flag drops. It
   * is 36 bytes it carries for the whole race to be spent in a single instant, which is the price of
   * the finish line being the money rather than a signal about it.
   */
  pool: number[]
  eng: number      // engine size, 0..ENG_MAX
  tyr: number      // tyre grade, 0..TYR_MAX
  finish: number   // the line — for a drag race this IS the track
  /**
   * The surface, in thousandths: 1000 is a prepared strip, lower is greasy, higher is glued.
   *
   * Scales ALL grip, the speed-dependent part included, because a slippery surface does not care why
   * you wanted the traction. Held as a small integer rather than fixed-point — two bytes buys three
   * decimal places, which is more than any tyre wall can tell the difference between.
   */
  slip: number
  green: number    // nLockTime the launch may not precede. A false start cannot be MINED.
  gap: number      // K: the minimum nLockTime step between moves. The human-vs-machine dial.
  last: number     // the previous move's nLockTime
  s: number        // position
  v: number        // velocity
  n: number        // tick count — and therefore the ELAPSED TIME
}

/** Field order as laid out in the script. PUBLISHED — a rebuilder needs this exact order. */
export const FIELDS = ['phase', 'driver', 'pool', 'eng', 'tyr', 'finish', 'slip', 'green', 'gap', 'last', 's', 'v', 'n'] as const
/** Fixed byte-widths, by field. PUBLISHED alongside FIELDS. */
export const FIELD_WIDTHS: Record<(typeof FIELDS)[number], number> = {
  phase: 1, driver: 20, pool: 36, eng: 2, tyr: 2, finish: 6, slip: 2, green: 5, gap: 4, last: 5, s: 6, v: 5, n: 4,
}
/**
 * ⚠ `green` and `last` are FIVE bytes, not four, and that is not tidiness.
 *
 * They hold `nLockTime`. Sign-magnitude in four bytes caps at 2,147,483,647 — which as a Unix timestamp
 * is 19 January 2038. A shell minted today would simply stop accepting valid start times on that date,
 * permanently, with no key anywhere able to widen the field. Five bytes carries it to the year 10,000.
 *
 * The cost of the insurance is two bytes, about 0.4 sat per move. The cost of discovering it later is a
 * dead standard and every instance ever built.
 */
export const FIXED_POINT_FIELDS = ['finish', 's', 'v'] as const
/** `slip` is held in thousandths: SLIP_UNIT is a prepared strip. */
export const SLIP_UNIT = 1000
/** Total register file, in bytes. */
export const STATE_BYTES = FIELDS.reduce((a, k) => a + FIELD_WIDTHS[k], 0)

/**
 * ★ THE CONSTANT GENESIS — every instance starts here, byte for byte.
 *
 * That is what makes one script-hash query find every race ever started. Any drift in this function and
 * the discovery anchor is silently lost, so `shell-genesis.ts` pins its exact bytes.
 */
export function emptyShell(): ShellState {
  return {
    phase: PHASE.EMPTY,
    driver: new Array(20).fill(0), pool: new Array(36).fill(0),
    eng: 0, tyr: 0, finish: 0, slip: 0, green: 0, gap: 0, last: 0, s: 0, v: 0, n: 0,
  }
}

/**
 * The largest magnitude a field can hold. Sign-magnitude in `n` bytes spends one bit on the sign, so
 * the usable range is ±(2^(8n−1) − 1) — NOT 2^(8n).
 */
export const fieldMax = (bytes: number): number => 2 ** (8 * bytes - 1) - 1

/**
 * ⚠ DOES THIS STATE ACTUALLY FIT? Returns the first field that does not, or null.
 *
 * The battery learned this the expensive way: `fixedField` truncates silently, so a value too large for
 * its field produces a perfectly well-formed script carrying the wrong number, and the covenant then
 * rejects a spend nobody can explain. Regulations that feel wonderful on a bench are worthless if the
 * velocities they produce cannot be encoded — and at extreme settings that is easy to arrange:
 * `FE` 1.5 against `M0` 0.2 yields 300 units of velocity in one tick, and `v` holds 128.
 *
 * Check this while TUNING, not after minting.
 */
const isNumField = (k: (typeof FIELDS)[number]): boolean => k !== 'driver' && k !== 'pool'
export function stateFits(st: ShellState): string | null {
  for (const k of FIELDS) {
    if (!isNumField(k)) { if ((st[k] as number[]).length !== FIELD_WIDTHS[k]) return k; continue }
    const v = st[k] as number
    if (!Number.isFinite(v)) return k
    if (Math.abs(v) > fieldMax(FIELD_WIDTHS[k])) return k
  }
  return null
}

// ── the loading phases ───────────────────────────────────────────────────────────────────────────────
/** What a load may not do, expressed once so the Script and the reference cannot disagree. */
export class ShellRefused extends Error {}

const need = (ok: boolean, why: string): void => { if (!ok) throw new ShellRefused(why) }

/** PHASE 0 → 1 · claim the shell and load the car. Bounds are enforced; provenance is not (it cannot be). */
export function loadCar(
  st: ShellState, p: { driver: number[]; eng: number; tyr: number }, regs: RacerRegs = PROVISIONAL_REGS,
): ShellState {
  need(st.phase === PHASE.EMPTY, `a car can only be loaded into an EMPTY shell (this one is ${PHASE_NAMES[st.phase]})`)
  need(p.driver.length === 20, 'driver must be a 20-byte hash160')
  need(p.eng >= 1 && p.eng <= regs.ENG_MAX, `engine must be 1..${regs.ENG_MAX}`)
  need(p.tyr >= 1 && p.tyr <= regs.TYR_MAX, `tyres must be 1..${regs.TYR_MAX}`)
  return { ...st, phase: PHASE.CAR, driver: [...p.driver], eng: p.eng, tyr: p.tyr }
}

/** PHASE 1 → 2 · load the track and the start. For a drag race the track is one number: the line. */
export function loadTrack(
  st: ShellState, p: { finish: number; green: number; gap: number; slip?: number; pool?: number[] },
): ShellState {
  need(st.phase === PHASE.CAR, `a track can only be loaded onto a shell holding a car (this one is ${PHASE_NAMES[st.phase]})`)
  need(p.finish > 0, 'the finish line must be beyond the start')
  need(p.green > 0, 'a race needs a start time')
  need(p.gap >= 0, 'the minimum gap cannot be negative')
  const slip = p.slip ?? SLIP_UNIT
  need(slip > 0, 'a surface with no grip at all is not a race track')
  const pool = p.pool ?? new Array(36).fill(0)
  need(pool.length === 36, 'the pool outpoint must be 36 bytes — a 32-byte txid then a 4-byte index')
  return { ...st, phase: PHASE.TRACK, finish: p.finish, slip, green: p.green, gap: p.gap, pool }
}

/**
 * PHASE 2 → 3 · fuel it, and the specs FREEZE.
 *
 * The fuel is not a field — it is the satoshis on the output. This transition carries no data at all; it
 * exists so that everything loaded before it becomes immutable, which is the whole anti-cheat.
 */
export function arm(st: ShellState): ShellState {
  need(st.phase === PHASE.TRACK, `only a fuelled, tracked shell can be armed (this one is ${PHASE_NAMES[st.phase]})`)
  return { ...st, phase: PHASE.ARMED }
}

// ── the race ─────────────────────────────────────────────────────────────────────────────────────────
/** What one press of the accelerator does. `fuel` is the output's satoshi value BEFORE the move. */
export interface Move {
  /** 0..THROTTLE_MAX — the driver's only freedom. */
  throttle: number
  /** This move's nLockTime. Enforced ≥ green on the launch, and ≥ last + gap thereafter. */
  lockTime: number
  /** The satoshis currently on the output. Read from the preimage; never a stored field. */
  fuel: number
}

export interface TickResult {
  state: ShellState
  /** Satoshis this move consumes — and this IS the mining fee. The engine burns real money. */
  burn: number
  /** True when the demanded force exceeded grip. */
  spun: boolean
  /** What ended the run, if anything did. `null` while the car is still racing or once it has finished. */
  ended: 'off' | 'blown' | null
}

/**
 * ONE PRESS OF THE ACCELERATOR — the reference implementation, and the normative operation order.
 *
 * ★ Not ticking is not moving. There is no decay-over-time and no way to write one: the covenant can
 * force a minimum gap but can never detect a pause, because a driver can always claim the minimum and
 * be believed. That is fine — the penalty for slowness is the other car, which needs no enforcement at
 * all. The stall is the absence of a transaction.
 *
 * ★ ET is the chain length. Your time is how many transactions it took, countable by anyone walking
 * back. So a slow run costs more satoshis because it costs more transactions — being bad is directly,
 * proportionally expensive, and nobody had to design a penalty.
 */
export function refTick(st: ShellState, m: Move, regs: RacerRegs = PROVISIONAL_REGS): TickResult {
  need(st.phase === PHASE.ARMED || st.phase === PHASE.RACING,
    `only an armed or racing shell may be driven (this one is ${PHASE_NAMES[st.phase]})`)
  need(m.throttle >= 0 && m.throttle <= regs.THROTTLE_MAX, `throttle must be 0..${regs.THROTTLE_MAX}`)

  // The tree. A launch may not precede the green — and because nLockTime is enforced by consensus, a
  // false start cannot be MINED. That is stronger than a real tree, which only catches the foul after.
  if (st.phase === PHASE.ARMED) need(m.lockTime >= st.green, 'a false start: this move precedes the green')
  else need(m.lockTime >= st.last + st.gap, `moves must be at least ${st.gap} apart`)

  // Mass includes the fuel, so the car gets lighter as it burns. Free, because the satoshis ARE the tank.
  const mass = regs.M0 + st.eng * regs.WE + st.tyr * regs.WT + fmul(m.fuel * S, regs.WF)
  need(mass > 0, 'a car cannot be massless')

  // Grip rises with speed, which is why a big engine wastes force off the line and rewards good tyres.
  // The surface scales everything the tyres and the speed were going to give you.
  const grip = Math.trunc(((st.tyr * regs.G0 + fmul(st.v, regs.GV)) * st.slip) / SLIP_UNIT)
  const demand = Math.trunc((st.eng * regs.FE * m.throttle) / regs.THROTTLE_MAX)

  const spun = demand > grip
  const burn = regs.BURN0 + Math.trunc((st.eng * regs.BURN_E * m.throttle) / regs.THROTTLE_MAX)

  /* ── WHAT HAPPENS WHEN GRIP GOES ────────────────────────────────────────────────────────────────
     Three outcomes, and they are not degrees of one event — they have different causes.

     SPEED IS CHECKED FIRST, and the order is load-bearing rather than stylistic. A MOVING car that
     loses grip steps sideways and is gone — the engine stays loaded right up until the wheels break
     away. A STATIONARY one has no load at all, so the motor runs away with itself instead. Same lost
     grip, two different endings, decided by whether the car was going anywhere at the time.

     Checked the other way round the track case is UNREACHABLE, and silently so. Grip rises with speed,
     so at pace the only way to break it is near-max throttle — which is also the blow condition, and
     the engine check swallows it whole. Measured: 40 gentle presses reach v 4.82 against grip 2.35, and
     throttle 13 is clean while 14 grenades. Nobody would ever have seen the wall.

     Everything else is smoke: force is capped at what the tyres can take and the car loses momentum.
     Survivable, and the moment the driver has to decide something — lift, and you keep the engine. */
  if (spun && st.v >= regs.LOOSE_V) {
    return { state: { ...st, phase: PHASE.OUT, last: m.lockTime, n: st.n + 1, v: 0 }, burn, spun, ended: 'off' }
  }
  if (spun && m.throttle >= regs.BLOW_T) {
    return { state: { ...st, phase: PHASE.OUT, last: m.lockTime, n: st.n + 1, v: 0 }, burn, spun, ended: 'blown' }
  }

  const force = spun ? grip : demand
  const a = fdiv(force, mass)

  /* ⚠ DRAG IS THE LINEAR TERM PLUS THE QUADRATIC ONE, and the quadratic one is the honest one — real
     drag goes as v². With DRAG2 at zero this is exactly the linear model the mainnet cars run. */
  let v = st.v + a - fmul(st.v, regs.DRAG) - fmul(fmul(st.v, st.v), regs.DRAG2)
  if (spun) v = fmul(v, regs.SPIN_KEEP)
  if (v < 0) v = 0                                   // a car does not roll backwards down a drag strip

  /* ★ TOO FAST FOR THE MACHINERY. Checked on the speed this move PRODUCES, so the driver who presses
     on past the plateau is the one who pays — lifting a tick early keeps the engine. Zero disables it,
     and the run then ends only by grip, fuel or the finish line. */
  if (regs.BLOW_V > 0 && v >= regs.BLOW_V) {
    return { state: { ...st, phase: PHASE.OUT, last: m.lockTime, n: st.n + 1, v: 0 }, burn, spun, ended: 'blown' }
  }

  const s = st.s + v
  const done = s >= st.finish
  return {
    state: { ...st, phase: done ? PHASE.DONE : PHASE.RACING, last: m.lockTime, s, v, n: st.n + 1 },
    burn, spun, ended: null,
  }
}

/** Could this car still finish on the fuel it holds? Optimistically — at best burn, ignoring physics. */
export function canFinish(st: ShellState, fuel: number, regs: RacerRegs = PROVISIONAL_REGS): boolean {
  return st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && fuel > regs.BURN0
}

/**
 * The layout, as one line, written into the genesis OP_RETURN so an instance can be rebuilt from the
 * chain by anyone WITHOUT this repo. A shell is a standard, and its reference implementation is a txid —
 * which cannot rot the way a GitHub link can.
 */
/* The genesis writes this ALONE, unlike the battery's layout+mark, and it is close to the ceiling.
   ⚠ The BURN formula was dropped to fit, and only because it is the one thing here a rebuilder can
   MEASURE rather than be told: every tick's fuel consumption is the output's value delta, visible on
   chain. Everything that remains is something that cannot be recovered by looking — the field order
   and widths needed to parse the state at all, the encodings, and the equations governing moves that
   have not happened yet.
   Original note: 209 bytes of 220, leaving room for nothing — the battery's
   layout+mark. Written tersely because the full prose ran to 291: `w` for widths, single letters for
   the intermediates, and the phase names dropped because the numbers are self-evident once the field
   order is published. Everything that survives is something a rebuilder CANNOT derive from a tip —
   the field layout to parse the state at all, the encoding, and the equations governing moves that
   have not happened yet. The regulation VALUES are deliberately absent: they live in the script, which
   a rebuilder already has. */
export const SHELL_STATE_LAYOUT =
  'BITCOIN RACER v2|' + FIELDS.join(',') + '|w' + FIELDS.map(k => FIELD_WIDTHS[k]).join(',') + '|' +
  'sm LE|1=2^32|slip/1e3|m=M0+eng*WE+tyr*WT+fuel*WF|g=(tyr*G0+v*GV)*slip|' +
  /* ⚠⚠ THE VERSION HAD TO MOVE, AND THAT IS THE POINT OF HAVING ONE. The equations are part of the
     published contract, so a car whose drag term is linear+quadratic cannot go on calling itself v1 —
     a rebuilder reading `v1` and applying these equations computes the wrong race, and one reading
     `v1` on a car already mined and applying the OLD equations must keep getting the right one. The
     cars on mainnet stay v1 and stay correct; these are v2.

     ⚠ AND THE BLOW RULE IS DELIBERATELY NOT HERE. First attempt added `out if v>=BV` and blew the
     budget at 237 of 220 — but the fix is not to squeeze it in, because the ENDING rules were never
     published in the first place: `LOOSE_V` and `BLOW_T` govern moves that have not happened yet too,
     and neither appears. This string publishes what a rebuilder cannot derive without the script —
     the layout, the encoding, and the equations of MOTION. How a run ends is enforced by the covenant
     a verifier already has. Following that precedent rather than the budget.

     `D`/`D2` for the two drag terms, as `TM` already stands for THROTTLE_MAX — the values live in the
     script, so these are labels for the equation, not names to resolve. */
  'F=min(eng*FE*t/TM,g)|v+=F/m-v*D-v*v*D2|s+=v'

// ═══ THE SCRIPT ══════════════════════════════════════════════════════════════════════════════════════
// Everything above is the reference implementation. Everything below is the covenant that must agree
// with it, opcode for opcode, and is validated against it through the real interpreter.
import { OP, LockingScript, UnlockingScript, type ScriptChunk } from '@bsv/sdk'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushData, pushTxConstants, type PushTxConstants } from './pushtx.ts'
import { Asm, op, PN, fixedField } from './covenantAsm.ts'

/** Record type, in the same family as the battery's 0x07. */
export const RECORD_SHELL = 0x08

/**
 * Values read out of the preimage and carried on the MAIN stack beneath PRE, deepest first:
 *
 *   nLockTime · hashPrevouts · this input's outpoint
 *
 * Named as a constant because every depth computed against them is derived from it. When it was two
 * and the code assumed one, the timing rule picked a 36-byte outpoint where it wanted a timestamp and
 * wrote it into `last` — surfacing a hundred opcodes later as NUM2BIN refusing a 36-byte value in a
 * 5-byte field, with nothing pointing back at the cause.
 */
export const CARRIED = ['nLockTime', 'hashPrev', 'outpoint'] as const

/**
 * ★ WHAT THE UNLOCKING SCRIPT MAY LOAD, and the phase that owns each.
 *
 * The shell enforces a SEQUENCE — that was step 1 — but a sequence with nothing flowing into it is a
 * turnstile, not a machine. This is what makes it programmable: values arrive from outside and are
 * written into the covenant's own script, once, in the transition that owns them, and are immutable
 * after. Nobody swaps a bigger engine in at phase 3 because phase 3 does not accept engines.
 *
 * ⚠ ORDER IS THE INTERFACE. These are pushed DEEPEST in the unlocking script, in exactly this order,
 * because adding items below leaves every depth measured from the top unchanged — so the signature
 * check and the physics did not have to move to make room. Reorder this and the covenant reads the
 * wrong argument, silently.
 *
 * `at` is the NEW phase, not the old one: 0→1 and 1→2 are unambiguous, so the phase the covenant has
 * just computed is enough to say which transition this is.
 *
 * The bounds are the ones §5 of the spec promised — **the shell's constants ARE the racing
 * regulations**. A car is provably legal even though its lineage is only publicly checkable, because
 * an illegal one cannot be written into a shell at all.
 */
export interface Loadable { k: (typeof FIELDS)[number]; at: number; bytes?: number; min?: number; max?: number }
/**
 * ★ A PHASE THAT CAN NEVER HAPPEN. Phases run 0…6, so a loadable whose transition is this one is never
 * loaded at all: the `OP_NUMEQUAL` guarding it can never be true, and the value carried in the script
 * survives untouched. That is how a field is made READ-ONLY without removing its slot — the layout,
 * the depths, and the unlocking script all stay exactly as they were, and one constant differs.
 */
export const PHASE_NEVER = 99

/**
 * ⚠ IN A PUBLIC CAR THE DRIVER IS NOT LOADABLE, and this is not a nicety.
 *
 * MEASURED, before the fix existed: a passer-by loaded THEIR OWN key as the driver of a public car,
 * became its owner, and could then burn it and walk off with the tank. Load, own, burn. The car was
 * free to anybody who read the script.
 *
 * In a public car `driver` holds the OWNER and is written once, at genesis, by whoever mints it.
 * Nothing may ever write it again.
 */
export const loadables = (regs: RacerRegs, isPublic = false): Loadable[] => [
  { k: 'driver', at: isPublic ? PHASE_NEVER : PHASE.CAR, bytes: 20 },
  { k: 'pool', at: PHASE.TRACK, bytes: 36 },
  { k: 'eng', at: PHASE.CAR, min: 1, max: regs.ENG_MAX },
  { k: 'tyr', at: PHASE.CAR, min: 1, max: regs.TYR_MAX },
  { k: 'finish', at: PHASE.TRACK, min: 1 },
  { k: 'slip', at: PHASE.TRACK, min: 1 },
  { k: 'green', at: PHASE.TRACK, min: 1 },
  { k: 'gap', at: PHASE.TRACK, min: 0 },
]

/** `driver` and `pool` are raw BYTES; everything else is a number. That distinction runs through the
 *  whole script — BIN2NUM on a hash or an outpoint is nonsense, and NUM2BIN would not put it back. */
const isNum = (k: (typeof FIELDS)[number]): boolean => k !== 'driver' && k !== 'pool'

/**
 * The state, as pushes: a three-byte header then the twelve fixed-width fields.
 *
 * The header is what makes the field offset a CONSTANT the script can split at — and the fixed widths
 * are what let it split the rest at constant offsets after that. Nothing here is decorative.
 */
function fieldChunks(s: ShellState): ScriptChunk[] {
  return [
    pushData([0x50]),            // protocol prefix "P"
    pushData([0x01]),            // format version
    pushData([RECORD_SHELL]),    // record type
    ...FIELDS.map(k => pushData(isNum(k) ? fixedField(s[k] as number, FIELD_WIDTHS[k]) : (s[k] as number[]))),
  ]
}

export interface ShellLockParams {
  state: ShellState
  /** Offset of the first field's DATA within the scriptCode FIELD. `buildShellLock` computes it. */
  fieldOffset: number
  regs?: RacerRegs
  maxFee?: number
  /**
   * ★ Build the PUBLIC variant: a car anyone may drive and nobody may claim.
   *
   * It is the same covenant with one condition swapped. No signature is asked for on a move, and
   * `driver` holds the OWNER — consulted by the burn and by nothing else. See the note on the
   * signature gate for why that is a change of gate rather than a change of meaning.
   */
  public?: boolean
  c?: PushTxConstants
}

/**
 * ★ THE SKELETON — the frame every phase and every equation will hang on.
 *
 *   <15 data pushes> cleared        the state, carried in the script itself
 *   <verify preimage>               OP_PUSH_TX — authorisation with no signature
 *   <stash hashOutputs and value>   read out of the preimage
 *   <split scriptCode>              PRE ‖ the twelve fields ‖ SUF
 *   <THE STATE MACHINE>             ← nothing yet. Identity.
 *   <rebuild and compare>           assert the output is this script with the new state
 *
 * Built and proved as a frame FIRST, deliberately. If a script cannot read its own twelve fields and
 * write them back unchanged, nothing built on top of that is worth debugging — and the battery's
 * hardest bugs were all in this layer rather than in its arithmetic.
 */
export function shellLockOps(p: ShellLockParams): ScriptChunk[] {
  const regs = p.regs ?? RACER_REGS
  const maxFee = p.maxFee ?? 0
  const c = p.c ?? pushTxConstants(SHELL_SCOPE)

  /* ⚠ DERIVED, because the burn branch reads its flag while the state's own literals are still on the
     stack — the deepest reach in the whole script, and the one most exposed to a field being added.
     Bottom to top at that moment: burn · retire · loadables · throttle · sig · pubkey · SO · newV ·
     preimage · the 16 literal pushes. */
  const isPublic = p.public ?? false
  const LITERALS = 3 + FIELDS.length
  const UNLOCK_ABOVE = 5 + 1 + loadables(regs).length          // preimage…sig, throttle, the loadables
  const dBurn = LITERALS + UNLOCK_ABOVE + 1                    // …then retire, then burn
  const BURN_DROPS = (dBurn + 1) / 2                           // clear the lot in pairs
  if (!Number.isInteger(BURN_DROPS)) throw new Error(`burn leaves an odd stack (${dBurn + 1}) — add an OP_DROP`)
  const ops: ScriptChunk[] = [
    ...fieldChunks(p.state),

    /* ── ONLY THE DRIVER MAY MOVE THIS CAR ──────────────────────────────────────────────────────────
       Checked HERE, at the very top, against the state's own LITERAL pushes — which are still on the
       stack and have not been dropped yet. Two reasons, and neither is convenience.

       First, the OLD phase is needed and only exists here. By the time the fields are extracted the
       phase machine has already advanced it, and the question being asked is about the phase this
       shell is IN, not the one it is going to.

       Second, an EMPTY shell has a driver of twenty zero bytes, and no public key hashes to that. So a
       shell in phase 0 is UNCLAIMED and anyone may take it — which is right, because that transition
       is what sets the driver. From phase 1 onward the signature is compulsory: your car, your key.

       Stack here, bottom to top: throttle · sig · pubkey · SO · newV · preimage · [16 literal pushes].

       ── ★ AND IN A PUBLIC CAR, ONLY THE CONDITION CHANGES ──────────────────────────────────────────
       A public car is driven by anyone and owned by the game. Both facts come from swapping what gates
       this block — the body below is identical, because "prove you hold the key this shell names" is
       the same question whether the answer is required of a driver or of an owner:

         owned    IF (phase ≠ 0)   a signature on every move from phase 1 · your car, your key
         public   IF (burn)        a signature ONLY to burn · anyone may drive, one party may retire

       ⇒ So `driver` is not repurposed by some convention held in a comment. In a public car nothing
       ever asks it to authorise a MOVE, and the only branch that consults it is the burn. It holds the
       owner because that is the only thing it is ever used for. */
    ...(isPublic
      ? [PN(dBurn), op(OP.OP_PICK)]                        // public: a signature only for a burn
      : [PN(12), op(OP.OP_PICK), op(OP.OP_BIN2NUM),        // owned:  the OLD phase…
         op(OP.OP_0NOTEQUAL)]),                            //         …is this shell claimed?
    op(OP.OP_IF),
      PN(11), op(OP.OP_PICK),                     // the driver hash, from the script's own bytes
      PN(20), op(OP.OP_PICK),                     // the public key offered
      op(OP.OP_HASH160), op(OP.OP_EQUALVERIFY),   // it must be THE driver's
      PN(20), op(OP.OP_PICK),                     // the signature
      PN(20), op(OP.OP_PICK),                     // and the key again, for CHECKSIG
      op(OP.OP_CHECKSIG), op(OP.OP_VERIFY),
    op(OP.OP_ENDIF),

    /* ── ★ BURN — HOW A CAR IS FINALLY CLEARED AWAY ─────────────────────────────────────────────────
       Every other path out of a race leaves ONE SATOSHI in a shell that can never be spent again: the
       phase machine verifies `phase < DONE` on every move, so a DONE or OUT shell is terminal in the
       strongest sense. That satoshi is not merely dust — it is a permanent entry in the UTXO set that
       every node must carry forever, and a track running races would mint one per car. Retirement
       stopped the TANK being stranded. This is what stops the headstone being stranded too.

       The rule is the one PharLap's editions already use, and it enforces NOTHING: the driver's
       signature is SIGHASH_ALL, so it already commits to every output of this transaction. They have
       said where the money goes by signing. There is nothing left for a covenant to check, and no
       output of its own to re-create — the car simply ceases to exist.

       ⚠ Which is exactly why it must sit BELOW the driver check and not above it. The signature is
       verified before this branch is even read, so a burn is unforgeable for any claimed shell.
       ⚠ And why it re-verifies that the shell IS claimed: at phase 0 the driver is twenty zero bytes
       and the signature check above is skipped, so an unguarded burn here would let a passer-by sweep
       an unclaimed car in one transaction. Claiming it first is still open to anyone — that is the
       design — but it costs them a transaction and puts their key on the record. */
    PN(dBurn), op(OP.OP_PICK), op(OP.OP_IF),
      /* ⚠ The claimed-check is an OWNED rule and a public car must not carry it: a public car is owned
         from birth but starts at phase 0, so this would refuse to burn a fresh one. It is unnecessary
         there anyway — the block above already demanded the owner's signature for this very branch,
         and a public car with a zero owner is one nobody can burn, which is its minter's problem. */
      ...(isPublic ? [] : [PN(12), op(OP.OP_PICK), op(OP.OP_BIN2NUM), op(OP.OP_0NOTEQUAL), op(OP.OP_VERIFY)]),
      ...Array.from({ length: BURN_DROPS }, () => op(OP.OP_2DROP)),
      op(OP.OP_1),
    op(OP.OP_ELSE),

    // 3 header + 13 fields = 16 pushes: eight pairs
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP),
    ...pushTxVerifyOps(c),                                   // [SO, newV, preimage]
    op(OP.OP_DUP), op(OP.OP_DUP), op(OP.OP_DUP),
    ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),        // alt:[hashOutputs]
    // the spent output's value sits 52 bytes from the end of the preimage
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK), // alt:[HO, V]

    /* ── THE CLOCK ──────────────────────────────────────────────────────────────────────────────────
       nLockTime sits 8 bytes from the end of the preimage: sighash type (4), then nLocktime (4). It
       stays on the MAIN stack, beneath PRE, because the timing rule needs it at the same moment `last`
       is reachable — and by then the altstack is holding the other eleven fields.
       ⚠ It only BINDS if an input's sequence is below 0xffffffff. A transaction whose inputs are all
       final ignores nLockTime entirely, and a tree that can be ignored is not a tree. */
    op(OP.OP_SIZE), pushData([8]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([4]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM),   // [.., preimage, nLockTime]
    op(OP.OP_SWAP),                                          // preimage back on top

    /* ── THE POT ────────────────────────────────────────────────────────────────────────────────────
       Two more fields out of the preimage, at the offsets BIP143 fixes:
         hashPrevouts  4 bytes in, 32 long — a hash over EVERY input's outpoint
         this outpoint 68 bytes in, 36 long — nVersion(4) + hashPrevouts(32) + hashSequence(32)
       Both ride the main stack beneath PRE until the physics know whether this move crossed the line.
       ⚠ hashPrevouts is only real because the scope is SIGHASH_ALL. Under ANYONECANPAY it is thirty-two
       zero bytes and none of this is possible — which is why funding your own car was the price. */
    op(OP.OP_DUP), op(OP.OP_DUP),
    pushData([4]), op(OP.OP_SPLIT), op(OP.OP_NIP), pushData([32]), op(OP.OP_SPLIT), op(OP.OP_DROP),
    op(OP.OP_TOALTSTACK),                                    // hashPrevouts → alt, briefly
    pushData([68]), op(OP.OP_SPLIT), op(OP.OP_NIP), pushData([36]), op(OP.OP_SPLIT), op(OP.OP_DROP),
    op(OP.OP_FROMALTSTACK), op(OP.OP_SWAP),                  // [.., nLockTime, preimage, hashPrev, outpoint]
    PN(2), op(OP.OP_ROLL),                                   // preimage back on top — it is TWO deep
    ...extractScriptCodeFieldOps(),                          // [.., nLockTime, hashPrev, outpoint, field]
    PN(p.fieldOffset), op(OP.OP_SPLIT),                      // [.., PRE, rest]
  ]
  // peel the twelve fields off `rest`
  FIELDS.forEach((k, idx) => {
    if (idx > 0) ops.push(op(OP.OP_1), op(OP.OP_SPLIT), op(OP.OP_NIP))   // drop the push opcode
    ops.push(PN(FIELD_WIDTHS[k]), op(OP.OP_SPLIT))
  })
  ops.push(op(OP.OP_TOALTSTACK))                             // alt:[HO, V, SUF]

  // fields → values, in FIELDS order. `driver` stays BYTES: BIN2NUM on a 20-byte hash is nonsense.
  for (let i = FIELDS.length - 1; i > 0; i--) {
    if (isNum(FIELDS[i])) ops.push(op(OP.OP_BIN2NUM))
    ops.push(op(OP.OP_TOALTSTACK))
  }
  if (isNum(FIELDS[0])) ops.push(op(OP.OP_BIN2NUM))

  /* ── THE PROGRAM COUNTER ────────────────────────────────────────────────────────────────────────
     `phase` is alone on top of the stack at exactly this moment — converted, with the other eleven
     fields still on the altstack. That is the one place in the script where it can be transformed
     without rolling it up from eleven deep and putting it back, so the phase machine lives here.

     TERMINAL MEANS TERMINAL. A shell that is DONE or OUT cannot be spent at all: the run is over, the
     chain stops, and its final state stands as the record. Everything from EMPTY to RACING advances by
     one, and RACING stays where it is — a race continues until the physics end it, which is the only
     transition the sequence alone cannot decide. */
  ops.push(op(OP.OP_DUP), PN(PHASE.DONE), op(OP.OP_LESSTHAN), op(OP.OP_VERIFY))   // terminal stays terminal

  /* ★ RETIRING IS A PHASE DECISION, and deciding it here makes everything downstream fall into place
     for free: the loads key on the NEW phase, so an OUT shell loads nothing and cannot trip the track
     bounds; the timing rule keys on RACING, so `last` is left alone; and the physics key on RACING too,
     so the car stops exactly where it stood. One branch instead of ten gates.

     Why it has to exist at all: a car whose fuel has fallen below BURN0 cannot afford another move, so
     without a way to stop it would sit in RACING FOREVER with its tank locked in an output nothing can
     spend. That is the COMMONEST way to strand satoshis — commoner than wrecking, commoner than
     winning. The value rule below then drops the floor to one satoshi, and the driver takes the rest. */
  {
    const dRetire = loadables(regs).length + 5 + CARRIED.length + 2
    ops.push(
      PN(dRetire), op(OP.OP_PICK),
      op(OP.OP_IF),
        op(OP.OP_DROP), PN(PHASE.OUT),                                      // the run ends here
      op(OP.OP_ELSE),
        op(OP.OP_1ADD), PN(PHASE.RACING), op(OP.OP_MIN),                    // min(phase + 1, RACING)
      op(OP.OP_ENDIF),
    )
  }

  for (let i = 1; i < FIELDS.length; i++) {
    ops.push(op(OP.OP_FROMALTSTACK))

    /* ── THE CHRISTMAS TREE ────────────────────────────────────────────────────────────────────────
       Applied at the one instant `last` is on top of the stack, with `gap` and `green` directly under
       it — the same trick the phase machine uses, and for the same reason: reaching a field otherwise
       means rolling it up from nine deep and putting it back.

       ★ ONE RULE COVERS BOTH THE LAUNCH AND EVERY MOVE AFTER IT:

           nLockTime ≥ max(green, last + gap)

       On a launch `last` is zero, so `last + gap` is a handful of seconds and `green` — a Unix
       timestamp — wins outright. On every move after, `last` is a recent timestamp so `last + gap`
       wins. No branch, no separate launch case, and nothing to get out of step.

       ★ AND IT MAKES A FALSE START IMPOSSIBLE RATHER THAN PUNISHED. A transaction whose nLockTime has
       not arrived is not merely against the rules — it is non-final, so no node will mine it. Stronger
       than a real tree, which only catches the foul after you have committed it.

       `last` then becomes this move's nLockTime, so the next one is measured from here. */
    /* ── LOADING ────────────────────────────────────────────────────────────────────────────────────
       A field is reachable for exactly one instant — right now, alone on top of the stack. So the
       transition that owns it swaps the carried value for the one supplied in the unlocking script,
       checks it against the regulations, and every other transition leaves it exactly as it was.
       ⚠ Depths derived, never written: the supplied values sit under everything, so their distance
       from the top grows with each field restored. */
    const LD = loadables(regs, isPublic).findIndex(l => l.k === FIELDS[i])
    if (LD >= 0) {
      const all = loadables(regs, isPublic), l = all[LD]
      const above = (all.length - 1 - LD) + 5 + CARRIED.length + 1 + (i + 1)
      ops.push(
        PN(i), op(OP.OP_PICK), PN(l.at), op(OP.OP_NUMEQUAL),   // is this the transition that loads it?
        op(OP.OP_IF),
          op(OP.OP_DROP),                                       // the value carried in is not wanted
          PN(above - 1), op(OP.OP_PICK),                        // …this one is
      )
      if (l.bytes != null) {
        // a hash or an outpoint: only its LENGTH can be checked, but a wrong one would misalign every
        // future split of this script, so it is worth the four opcodes
        ops.push(op(OP.OP_SIZE), PN(l.bytes), op(OP.OP_NUMEQUALVERIFY))
      } else {
        if (l.min != null) ops.push(op(OP.OP_DUP), PN(l.min), op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY))
        if (l.max != null) ops.push(op(OP.OP_DUP), PN(l.max), op(OP.OP_LESSTHANOREQUAL), op(OP.OP_VERIFY))
      }
      ops.push(op(OP.OP_ENDIF))
    }

    if (FIELDS[i] === 'last') {
      /* ⚠ DEPTHS DERIVED, NOT WRITTEN DOWN. When field `i` has just been restored, f0…fi sit above PRE
         — so f0 is at depth i, PRE at i+1 and nLockTime at i+2, whatever the field list happens to be.
         These were hardcoded once, and adding `pool` to FIELDS silently shifted every one of them: the
         rule then compared the wrong stack slots and every racing move failed. */
      const dPhase = i, dGreen = i - FIELDS.indexOf('green')
      const dLock = i + 1 + CARRIED.length          // …fields, then PRE, then the carried values
      ops.push(
        PN(dPhase), op(OP.OP_PICK), PN(PHASE.RACING), op(OP.OP_NUMEQUAL),   // only while racing
        op(OP.OP_IF),
          op(OP.OP_OVER), op(OP.OP_ADD),                        // last + gap
          PN(dGreen), op(OP.OP_PICK), op(OP.OP_MAX),            // max(green, last + gap)
          PN(dLock), op(OP.OP_PICK),                            // nLockTime
          op(OP.OP_LESSTHANOREQUAL), op(OP.OP_VERIFY),          // the gate
          PN(dLock - 1), op(OP.OP_PICK),                        // `last` := this move's nLockTime
        op(OP.OP_ENDIF),
      )
    }
  }

  /* nLockTime has done its work — the tree is passed and `last` is stamped. It sits under PRE and the
     twelve fields, and the rebuild below assumes it is not there, so it is rolled out now rather than
     worked around. It is the deepest of the three carried values, under hashPrevouts and the outpoint. */
  ops.push(PN(FIELDS.length + CARRIED.length), op(OP.OP_ROLL), op(OP.OP_DROP))

  // ── THE PHYSICS ──
  ops.push(...shellPhysicsOps(p.regs ?? RACER_REGS, isPublic))

  // values → fixed-width fields, and rebuild the script
  for (let i = FIELDS.length - 1; i > 0; i--) {
    if (isNum(FIELDS[i])) ops.push(PN(FIELD_WIDTHS[FIELDS[i]]), op(OP.OP_NUM2BIN))
    ops.push(op(OP.OP_TOALTSTACK))
  }
  if (isNum(FIELDS[0])) ops.push(PN(FIELD_WIDTHS[FIELDS[0]]), op(OP.OP_NUM2BIN))
  ops.push(op(OP.OP_CAT))                                    // PRE ‖ phase
  for (let i = 1; i < FIELDS.length; i++) {
    ops.push(pushData([FIELD_WIDTHS[FIELDS[i]]]), op(OP.OP_CAT), op(OP.OP_FROMALTSTACK), op(OP.OP_CAT))
  }
  ops.push(op(OP.OP_FROMALTSTACK), op(OP.OP_CAT))            // ‖ SUF

  // the value floor, then out0, then the comparison
  ops.push(
    op(OP.OP_SWAP), op(OP.OP_DUP), op(OP.OP_BIN2NUM),
    op(OP.OP_FROMALTSTACK), PN(maxFee), op(OP.OP_SUB),        // the ordinary floor: V − MAX_FEE
    /* …unless this move ended the run, when it drops to ONE SATOSHI so the driver can recover the
       tank in the same transaction. The record stays: one sat, holding the final state, unspendable
       forever — and the chain of moves that led to it was always the real record anyway. */
    op(OP.OP_FROMALTSTACK), op(OP.OP_IF), op(OP.OP_DROP), op(OP.OP_1), op(OP.OP_ENDIF),
    op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),
    op(OP.OP_SWAP), op(OP.OP_CAT), op(OP.OP_SWAP), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )
  /* …and close the burn branch opened right after the driver check. The ordinary path IS the else
     arm, so this is the last opcode in the whole script — both arms leave one truthy value.
     ⚠ This belongs to shellLockOps and nothing else. Appended to shellPhysicsOps by mistake it landed
     mid-script, silently closing the burn IF early: the counts still balanced, the script still
     parsed, and every burn ran on into the ordinary path until OP_NUM2BIN found an empty stack. */
  return [...ops, op(OP.OP_ENDIF)]
}

/**
 * ONE PRESS OF THE ACCELERATOR, in Script — and it must agree with `refTick` exactly, which is what
 * `shell-physics.ts` checks tick for tick rather than by reading.
 *
 * Every quantity is named and every OP_PICK depth is computed from a live stack model, because
 * hand-counting cost the battery three bugs in one sitting.
 *
 * ★ Two simplifications fall out of the algebra and are worth stating, because neither is obvious:
 *
 *   mass  — the reference computes `fmul(fuel * S, WF)`, which is trunc(fuel·S·WF / S) = fuel·WF
 *           exactly. The scaling cancels, so the script needs no division at all here.
 *   force — `spun ? grip : demand` IS `min(demand, grip)`. One opcode, no branch, and the spin flag
 *           is then recovered by comparing the two rather than being carried.
 */
function shellPhysicsOps(regs: RacerRegs, isPublic = false): ScriptChunk[] {
  const a = new Asm([
    /* ⚠ THE WHOLE STACK, LOADABLES INCLUDED. Leaving them out cost an evening: everything ABOVE them
       still computed correctly, because model and reality shifted by the same eight, so the model
       looked right and the physics passed. Only `retire`, which sits BELOW them, came out eight too
       shallow — and picked a loadable instead. A partial model is worse than none: it is confident. */
    'burn', 'retire', ...loadables(regs).map(l => 'ld_' + l.k),
    'throttle', 'sig', 'pubkey', 'SO', 'newV', ...CARRIED.filter(k => k !== 'nLockTime'), 'PRE',
    'phase', 'driver', 'pool', 'eng', 'tyr', 'finish', 'slip', 'green', 'gap', 'last', 's', 'v', 'n',
  ])
  /** trunc(x·y / 2^32) — the fixed-point multiply, in Script's arbitrary-precision integers. */
  const fmul = (): void => { a.o(OP.OP_MUL, 2, ['_p']); a.num(S); a.o(OP.OP_DIV, 2, ['_q']) }
  /* trunc(x·2^32 / y) — scaled BEFORE dividing so precision survives. Written as explicit picks rather
     than stack juggling: the first attempt swapped its operands and divided by the NUMERATOR, which
     only showed itself as "divide by zero" the moment a driver lifted off entirely. */

  // the tank is on the altstack under SUF; both come back, and both go back afterwards
  a.raw(op(OP.OP_FROMALTSTACK), 0, ['SUF'])
  a.raw(op(OP.OP_FROMALTSTACK), 0, ['fuel'])

  // mass = M0 + eng·WE + tyr·WT + fuel·WF        (the car gets lighter as it burns)
  a.pick('eng'); a.num(regs.WE); a.bin(OP.OP_MUL, 'engW')
  a.pick('tyr'); a.num(regs.WT); a.bin(OP.OP_MUL, 'tyrW')
  a.bin(OP.OP_ADD, 'w')
  a.pick('fuel'); a.num(regs.WF); a.bin(OP.OP_MUL, 'fuelW')
  a.bin(OP.OP_ADD, 'w')
  a.num(regs.M0); a.bin(OP.OP_ADD, 'mass')

  /* The tank and the script tail go straight back, now that mass is the only thing that wanted them.
     ROLL rather than pick: the altstack must end holding exactly [hashOutputs, value, SUF], and a copy
     left behind would sit in the middle of the physics for no reason. Order matters — value first,
     then SUF on top of it. */
  a.roll('fuel'); a.raw(op(OP.OP_TOALTSTACK), 1, [])
  a.roll('SUF'); a.raw(op(OP.OP_TOALTSTACK), 1, [])

  /* ── AND ONLY WHILE RACING ──────────────────────────────────────────────────────────────────────
     A car being built does not move. The physics are gated on the NEW phase being RACING, which covers
     both the launch (ARMED → RACING) and every move after it, and leaves the loading phases alone.

     ⚠ The altstack work is deliberately OUTSIDE this branch. Asm checks that both arms agree about the
     MAIN stack and cannot see the altstack at all, so a FROMALTSTACK in one arm and not the other would
     leave the two silently out of step — and it would surface a hundred opcodes later as a rebuild that
     hashes to nothing recognisable. Mass is computed unconditionally; it is a few multiplies and it
     costs less than the risk. */
  /* Racing is enough: a retirement already set the phase to OUT above, so this is false and the car
     stands where it stopped. */
  a.pick('phase'); a.num(PHASE.RACING); a.bin(OP.OP_NUMEQUAL, 'racing')
  a.ifBegin()

  // grip = (tyr·G0 + fmul(v, GV)) · slip / SLIP_UNIT      (the surface scales everything)
  a.pick('tyr'); a.num(regs.G0); a.bin(OP.OP_MUL, 'tyrG')
  a.pick('v'); a.num(regs.GV); fmul(); a.rename('vG')
  a.bin(OP.OP_ADD, 'g')
  a.pick('slip'); a.bin(OP.OP_MUL, 'g'); a.num(SLIP_UNIT); a.bin(OP.OP_DIV, 'grip')

  // demand = eng·FE·throttle / THROTTLE_MAX
  a.pick('eng'); a.num(regs.FE); a.bin(OP.OP_MUL, 'engF')
  a.pick('throttle'); a.bin(OP.OP_MUL, 'engFt')
  a.num(regs.THROTTLE_MAX); a.bin(OP.OP_DIV, 'demand')

  // spun = demand > grip · force = min(demand, grip)
  a.pick('demand'); a.pick('grip'); a.bin(OP.OP_GREATERTHAN, 'spun')
  a.pick('demand'); a.pick('grip'); a.bin(OP.OP_MIN, 'force')

  // v' = v + force/mass − fmul(v, DRAG) − fmul(fmul(v,v), DRAG2), collapsed by SPIN_KEEP if the wheels
  // went, floored at zero
  a.pick('force'); a.num(S); a.bin(OP.OP_MUL, 'forceS')
  a.pick('mass'); a.bin(OP.OP_DIV, 'accel')
  a.pick('v'); a.bin(OP.OP_ADD, 'cv')
  a.pick('v'); a.num(regs.DRAG); fmul(); a.rename('drag')
  a.bin(OP.OP_SUB, 'cv')

  /* ── ★ THE QUADRATIC TERM ───────────────────────────────────────────────────────────────────────
     Real drag goes as v², and the linear term alone cannot hold a car back: it was measured trapping
     459 mph at a quarter mile and 490 at half a mile, still climbing, because the car gets LIGHTER as
     it burns fuel and so accelerates hardest at the finish line. With this term the speed settles.

     ★ EMITTED ONLY WHEN IT IS SET. At DRAG2 = 0 the reference subtracts zero, so a script that omits
     the opcodes computes exactly the same number — and a car tuned back to the linear model is then
     BYTE-IDENTICAL to the ones already on mainnet. A term that costs nothing when unused is a term
     nobody has to argue about. */
  if (regs.DRAG2 !== 0) {
    a.pick('v'); a.pick('v'); fmul(); a.rename('vsq')
    a.num(regs.DRAG2); fmul(); a.rename('drag2')
    a.bin(OP.OP_SUB, 'cv')
  }
  a.pick('spun'); a.ifBegin()
  a.num(regs.SPIN_KEEP); fmul(); a.rename('cv')
  a.armReturn(['cv'])
  a.elseArm()
  a.armReturn(['cv'])
  a.endIf()
  a.num(0); a.bin(OP.OP_MAX, 'cv')

  /* ── WHEN GRIP GOES ─────────────────────────────────────────────────────────────────────────────
     Two terminal failures with different causes, and one recoverable one.

       spun AND v ≥ LOOSE_V   a MOVING car steps sideways — off the track
       spun AND t ≥ BLOW_T    a STATIONARY one has no load, and the revs run away
       spun otherwise         smoke: force capped at grip, momentum lost, still in the race

     The reference checks speed first so it can NAME which happened, but both write the identical
     state — OUT, velocity zero, position unchanged, tick counted — so the script needs only their
     OR. What it must not do is get the recoverable case wrong, and that is what the 374-case
     agreement test is for. */
  a.pick('v'); a.num(regs.LOOSE_V); a.bin(OP.OP_GREATERTHANOREQUAL, 'fast')
  a.pick('throttle'); a.num(regs.BLOW_T); a.bin(OP.OP_GREATERTHANOREQUAL, 'wide')
  a.bin(OP.OP_BOOLOR, 'bad')
  a.pick('spun'); a.bin(OP.OP_BOOLAND, 'out')

  /* ── ★ AND TOO FAST FOR THE MACHINERY, WHICH NEEDS NO WHEELSPIN AT ALL ──────────────────────────
     A third way to end a run, and the only one that does not begin with losing grip: past this speed
     the engine or gearbox simply lets go. It is judged on the speed this move PRODUCED (`cv`, after
     spin and the floor), not the speed it started at — so the driver who presses on past the plateau
     is the one who pays, and lifting a tick early keeps the engine.

     ⚠ `LOOSE_V` reads the OLD `v` and this reads the NEW one, which looks inconsistent and is not:
     stepping sideways is caused by the grip you had when the wheels broke away, and over-revving is
     caused by the speed you arrived at. Two different questions about two different instants.

     Zero emits nothing, exactly as DRAG2 does. */
  if (regs.BLOW_V !== 0) {
    a.pick('cv'); a.num(regs.BLOW_V); a.bin(OP.OP_GREATERTHANOREQUAL, 'overrev')
    a.bin(OP.OP_BOOLOR, 'out')
  }

  a.pick('out'); a.ifBegin()
  // the run is over where it stands: no further ground, no speed, but the tick still counted
  a.pick('s', 'ns'); a.num(0, 'nv'); a.pick('n'); a.o(OP.OP_1ADD, 1, ['nn'])
  a.num(PHASE.OUT, 'np')
  a.armReturn(['ns', 'nv', 'nn', 'np'])
  a.elseArm()
  a.pick('s'); a.pick('cv'); a.bin(OP.OP_ADD, 'ns')
  a.pick('n'); a.o(OP.OP_1ADD, 1, ['nn'])
  a.pick('cv', 'nv')
  // crossing the line is just arithmetic — s' ≥ finish, and the chain stops
  a.pick('ns'); a.pick('finish'); a.bin(OP.OP_GREATERTHANOREQUAL, 'home')
  a.ifBegin()
  /* ★ AND YOU CANNOT CROSS THE LINE WITHOUT THE POT IN THE SAME TRANSACTION.
     hashPrevouts is a hash over every input's outpoint, so the covenant computes what it MUST be for a
     transaction spending exactly two things — this shell, and the pool it was told about at load time —
     and refuses anything else. Winning and being paid become one act: there is no separate claim to
     make, nothing to trust, and no second transaction in which something could go wrong.

     ── ⚠ AND A PUBLIC CAR HAS NO POT, BECAUSE IT IS RACING NOBODY ────────────────────────────────
     This rule guards a PAYMENT. In a time trial nobody is paid, so there is nothing to guard — and the
     price of guarding it is fatal to the whole variant: crossing means SPENDING an outpoint, so a
     keyless visitor would need a coin of their own to finish. Found by the integration test, which
     watched a car run to 59 metres of 60 and stop one tick short with fuel to spare.

     ⇒ Removing it costs the multi-car race nothing. A race with a PURSE has entrants with wallets, so
     it is the owned variant, where this stands untouched.
     ⚠ What it does give up is EXCLUSIVITY — the pot is also why only one transaction can win, since
     only one can spend it. Two public cars may both reach DONE. Correct for a time trial, where every
     run stands alone; a real head-to-head would want the pot covenant, not this. */
  if (!isPublic) {
    a.pick('outpoint'); a.pick('pool'); a.bin(OP.OP_CAT, 'both')
    a.o(OP.OP_HASH256, 1, ['want'])
    a.pick('hashPrev'); a.bin(OP.OP_EQUAL, 'gotPot'); a.o(OP.OP_VERIFY, 1, [])
  }
  a.num(PHASE.DONE, 'np'); a.armReturn(['np'])
  a.elseArm(); a.num(PHASE.RACING, 'np'); a.armReturn(['np']); a.endIf()
  a.armReturn(['ns', 'nv', 'nn', 'np'])
  a.endIf()
  // …and the racing arm must return to ITS OWN baseline too, not the inner branch's. The assembler
  // caught this as 30 against 23: every intermediate of the physics was still sitting there.
  a.armReturn(['ns', 'nv', 'nn', 'np'])

  a.elseArm()
  // being built, or stopped: the car stands exactly where it is, and carries the phase already decided
  a.pick('s', 'ns'); a.pick('v', 'nv'); a.pick('n', 'nn'); a.pick('phase', 'np')
  a.armReturn(['ns', 'nv', 'nn', 'np'])
  a.endIf()

  /* Four dead values are now buried under the new ones — the three old fields, plus `mass`, which was
     computed before the branch and therefore survived both arms. Rolled out by NAME, so the model does
     the arithmetic and the order cannot matter. */
  /* ── ★ THE MOVE THAT ENDS THE RUN IS THE MOVE THAT PAYS THE DRIVER ──────────────────────────────
     Without this, every race strands its own tank: a car that goes off at move five leaves its whole
     remaining fuel in an output nobody can ever spend. Satoshis destroyed for no reason.

     The fix is not to make a finished shell spendable — that would let a driver wreck, sweep into a
     fresh shell carrying a better state, and carry on racing, since the pot gate checks hashPrevouts
     and not lineage. TERMINAL STAYS TERMINAL, absolutely.

     Instead the FINAL move relaxes the value floor to a single satoshi, so the driver takes the rest
     as a trailing output of that same transaction — which the covenant already permits, and which only
     they can build, because only they can sign the move. One satoshi stays behind as the permanent
     record. That is the bond, and it is the smallest a record can cost.

     The flag rides the altstack UNDER the value, so it pops in the right order at the end. */
  a.raw(op(OP.OP_FROMALTSTACK), 0, ['SUF'])
  a.raw(op(OP.OP_FROMALTSTACK), 0, ['fuel'])
  a.pick('np'); a.num(PHASE.DONE); a.bin(OP.OP_GREATERTHANOREQUAL, 'over')
  a.raw(op(OP.OP_TOALTSTACK), 1, [])          // alt: [HO, over]
  a.roll('fuel'); a.raw(op(OP.OP_TOALTSTACK), 1, [])   // alt: [HO, over, V]
  a.roll('SUF'); a.raw(op(OP.OP_TOALTSTACK), 1, [])    // alt: [HO, over, V, SUF]

  for (const dead of ['mass', 'hashPrev', 'outpoint', 'phase', 's', 'v', 'n']) { a.roll(dead, '_dead'); a.drop(1) }

  /* ★ AND THE NEW PHASE HAS TO GET BACK TO THE FRONT.
     It was written early — the sequence needs deciding before the fields are even extracted — but only
     the physics know whether this move ended the run, so the physics must be able to overrule it from
     eleven fields away. A stack cannot push something DOWNWARD, so instead every field above it is
     rolled UP over it, in FIELDS order. Eleven rolls, and the order comes out exactly right. */
  for (const k of ['driver', 'pool', 'eng', 'tyr', 'finish', 'slip', 'green', 'gap', 'last', 'ns', 'nv', 'nn']) a.roll(k)
  /* ⚠ `process` DOES NOT EXIST IN A BROWSER, and this file is bundled into one. Unguarded, this line
     threw ReferenceError the instant a page built a lock — which every racers page does on load, so
     nothing ran at all. The SDK guards its own `process.release` check the same way; this did not. */
  if (typeof process !== 'undefined' && process.env.SHELL_DEBUG) console.log('  leaves:', a.st.join(','))
  a.st[a.st.length - (FIELDS.length)] = 'phase'
  a.st[a.st.length - 3] = 's'; a.st[a.st.length - 2] = 'v'; a.st[a.st.length - 1] = 'n'
  return a.ops
}

/**
 * Two-pass, like the battery: the offset push is the same byte-width whether probing or final, so the
 * length used to size the scriptCode varint is stable.
 * Before the first field: three 2-byte header pushes = 6, then phase's 1-byte push opcode → O = 7.
 */
export function buildShellLock(p: Omit<ShellLockParams, 'fieldOffset'>): LockingScript {
  /* The port guard that lived here is GONE, and deliberately noted rather than silently deleted:
     `shellPhysicsOps` now computes both DRAG2 and BLOW_V, so a lock can no longer promise arithmetic
     it does not do. What replaced it is not another guard but a test — `shell-physics` runs the two
     implementations against each other at the tuned regulations, where a divergence is a failure
     rather than a thing both sides agree about. */
  const O = 2 + 2 + 2 + 1
  const probeLen = new LockingScript(shellLockOps({ ...p, fieldOffset: 1 })).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return new LockingScript(shellLockOps({ ...p, fieldOffset: varIntSize + O }))
}

/**
 * The unlocking half: the driver's signature and key, the trailing outputs, the new value, and the
 * preimage — in that order, because the covenant reads them at fixed depths.
 *
 * The signature and key go DEEPEST so the preimage stays on top for OP_PUSH_TX. Claiming an unclaimed
 * shell needs neither, but both must still be pushed — empty is fine — because the covenant counts
 * positions, not arguments, and a missing push would shift every depth above it.
 */
export function shellUnlockingOps(
  p: { spenderOutputs: number[]; newValue: number[]; preimage: number[]
       sig?: number[]; pubKey?: number[]; throttle?: number; retire?: boolean; burn?: boolean
       load?: Record<string, number | number[]>; regs?: RacerRegs },
): ScriptChunk[] {
  const all = loadables(p.regs ?? RACER_REGS)
  return [
    /* ★ BURN — the driver's decision to CLEAR THE CAR AWAY, and the reason no satoshi is locked forever.
       Deeper even than retire, so every depth measured from the top stayed exactly where it was. */
    PN(p.burn ? 1 : 0),
    /* ★ RETIRE — the driver's decision to stop, and the reason a tank is never lost.
       A car below BURN0 cannot afford another move, so without this it sits in RACING FOREVER with its
       remaining fuel locked in an output nothing can spend. That is the commonest way to strand
       satoshis, not the rarest — commoner than wrecking and commoner than winning.
       Deepest of all, so every depth measured from the top stayed where it was. */
    PN(p.retire ? 1 : 0),
    /* ★ THE LOADABLES GO DEEPEST OF ALL, in `loadables` order. Every one is pushed on every spend even
       though at most five are wanted, because the covenant counts POSITIONS, not arguments — a missing
       push would shift every depth above it. Empty is the honest value for one that is not being used. */
    ...all.map(l => l.bytes != null
      ? pushData((p.load?.[l.k] as number[]) ?? [])
      : PN((p.load?.[l.k] as number) ?? 0)),
    // ★ THROTTLE — the driver's one freedom, and the only thing entering the covenant
    // from outside. Deepest because adding an item BELOW leaves every depth measured from the top
    // unchanged, so the signature check's offsets did not have to move to make room for it.
    PN(p.throttle ?? 0),
    pushData(p.sig ?? []), pushData(p.pubKey ?? []),
    pushData(p.spenderOutputs), pushData(p.newValue), pushData(p.preimage),
  ]
}
