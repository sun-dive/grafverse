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
  M0: Math.round(1 * S),
  WE: Math.round(0.05 * S),
  WT: Math.round(0.03 * S),
  WF: Math.round(0.00013 * S),
  FE: Math.round(0.32 * S),
  G0: Math.round(0.36 * S),
  GV: Math.round(0.30 * S),
  DRAG: Math.round(0.062 * S),
  SPIN_KEEP: Math.round(0.5 * S),
  LOOSE_V: Math.round(0.35 * S),        // ⚠ untuned — no slider existed
  BLOW_T: 14,                           // ⚠ untuned — no slider existed
  BURN0: 40,
  BURN_E: 35,
  THROTTLE_MAX: 15,
  ENG_MAX: 24,
  TYR_MAX: 10,
}

/** Kept so the bench can offer "back to provisional", and so the diff above stays checkable. */
export const PROVISIONAL_REGS: RacerRegs = RACER_REGS

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
export const FIELDS = ['phase', 'driver', 'eng', 'tyr', 'finish', 'slip', 'green', 'gap', 'last', 's', 'v', 'n'] as const
/** Fixed byte-widths, by field. PUBLISHED alongside FIELDS. */
export const FIELD_WIDTHS: Record<(typeof FIELDS)[number], number> = {
  phase: 1, driver: 20, eng: 2, tyr: 2, finish: 6, slip: 2, green: 5, gap: 4, last: 5, s: 6, v: 5, n: 4,
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
    driver: new Array(20).fill(0),
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
export function stateFits(st: ShellState): string | null {
  for (const k of FIELDS) {
    if (k === 'driver') { if (st.driver.length !== 20) return 'driver'; continue }
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
  st: ShellState, p: { finish: number; green: number; gap: number; slip?: number },
): ShellState {
  need(st.phase === PHASE.CAR, `a track can only be loaded onto a shell holding a car (this one is ${PHASE_NAMES[st.phase]})`)
  need(p.finish > 0, 'the finish line must be beyond the start')
  need(p.green > 0, 'a race needs a start time')
  need(p.gap >= 0, 'the minimum gap cannot be negative')
  const slip = p.slip ?? SLIP_UNIT
  need(slip > 0, 'a surface with no grip at all is not a race track')
  return { ...st, phase: PHASE.TRACK, finish: p.finish, slip, green: p.green, gap: p.gap }
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

  let v = st.v + a - fmul(st.v, regs.DRAG)
  if (spun) v = fmul(v, regs.SPIN_KEEP)
  if (v < 0) v = 0                                   // a car does not roll backwards down a drag strip

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
  'BITCOIN RACER SHELL v1|' + FIELDS.join(',') + '|w' + FIELDS.map(k => FIELD_WIDTHS[k]).join(',') + '|' +
  'sm LE|1=2^32|slip/1e3|m=M0+eng*WE+tyr*WT+fuel*WF|g=(tyr*G0+v*GV)*slip|' +
  'F=min(eng*FE*t/TM,g)|v+=F/m-v*DRAG|s+=v'

// ═══ THE SCRIPT ══════════════════════════════════════════════════════════════════════════════════════
// Everything above is the reference implementation. Everything below is the covenant that must agree
// with it, opcode for opcode, and is validated against it through the real interpreter.
import { OP, LockingScript, UnlockingScript, type ScriptChunk } from '@bsv/sdk'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushData, pushTxConstants, type PushTxConstants } from './pushtx.ts'
import { op, PN, fixedField } from './covenantAsm.ts'

/** Record type, in the same family as the battery's 0x07. */
export const RECORD_SHELL = 0x08

/** `driver` is a 20-byte HASH. Everything else is a number. That distinction runs through the script. */
const isNum = (k: (typeof FIELDS)[number]): boolean => k !== 'driver'

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
    ...FIELDS.map(k => pushData(isNum(k) ? fixedField(s[k] as number, FIELD_WIDTHS[k]) : s.driver)),
  ]
}

export interface ShellLockParams {
  state: ShellState
  /** Offset of the first field's DATA within the scriptCode FIELD. `buildShellLock` computes it. */
  fieldOffset: number
  regs?: RacerRegs
  maxFee?: number
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
  const maxFee = p.maxFee ?? 0
  const c = p.c ?? pushTxConstants(SHELL_SCOPE)
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

       Stack here, bottom to top: sig · pubkey · SO · newV · preimage · [15 literal pushes]. */
    PN(11), op(OP.OP_PICK), op(OP.OP_BIN2NUM),   // the OLD phase
    op(OP.OP_0NOTEQUAL),                          // …is this shell claimed?
    op(OP.OP_IF),
      PN(10), op(OP.OP_PICK),                     // the driver hash, from the script's own bytes
      PN(19), op(OP.OP_PICK),                     // the public key offered
      op(OP.OP_HASH160), op(OP.OP_EQUALVERIFY),   // it must be THE driver's
      PN(19), op(OP.OP_PICK),                     // the signature
      PN(19), op(OP.OP_PICK),                     // and the key again, for CHECKSIG
      op(OP.OP_CHECKSIG), op(OP.OP_VERIFY),
    op(OP.OP_ENDIF),

    // 3 header + 12 fields = 15 pushes: seven pairs and a single
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP),
    ...pushTxVerifyOps(c),                                   // [SO, newV, preimage]
    op(OP.OP_DUP), op(OP.OP_DUP),
    ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),        // alt:[hashOutputs]
    // the spent output's value sits 52 bytes from the end of the preimage
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK), // alt:[HO, V]
    ...extractScriptCodeFieldOps(),                          // [SO, newV, field]
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
  ops.push(
    op(OP.OP_DUP), PN(PHASE.DONE), op(OP.OP_LESSTHAN), op(OP.OP_VERIFY),   // phase < DONE, or nothing
    op(OP.OP_1ADD), PN(PHASE.RACING), op(OP.OP_MIN),                        // min(phase + 1, RACING)
  )

  for (let i = 1; i < FIELDS.length; i++) ops.push(op(OP.OP_FROMALTSTACK))

  // ── THE REST OF THE STATE MACHINE GOES HERE. ──

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
    op(OP.OP_FROMALTSTACK), PN(maxFee), op(OP.OP_SUB), op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),
    op(OP.OP_SWAP), op(OP.OP_CAT), op(OP.OP_SWAP), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )
  return ops
}

/**
 * Two-pass, like the battery: the offset push is the same byte-width whether probing or final, so the
 * length used to size the scriptCode varint is stable.
 * Before the first field: three 2-byte header pushes = 6, then phase's 1-byte push opcode → O = 7.
 */
export function buildShellLock(p: Omit<ShellLockParams, 'fieldOffset'>): LockingScript {
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
  p: { spenderOutputs: number[]; newValue: number[]; preimage: number[]; sig?: number[]; pubKey?: number[] },
): ScriptChunk[] {
  return [
    pushData(p.sig ?? []), pushData(p.pubKey ?? []),
    pushData(p.spenderOutputs), pushData(p.newValue), pushData(p.preimage),
  ]
}
