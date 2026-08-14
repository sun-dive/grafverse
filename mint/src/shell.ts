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

/** ⚠ PROVISIONAL — see RacerRegs. Placeholders, chosen to be self-consistent, not to be right. */
export const PROVISIONAL_REGS: RacerRegs = {
  M0: 1 * S,
  WE: Math.round(0.05 * S),
  WF: Math.round(0.0001 * S),
  FE: Math.round(0.20 * S),
  G0: Math.round(0.15 * S),
  GV: Math.round(0.30 * S),
  DRAG: Math.round(0.02 * S),
  BURN0: 40,
  BURN_E: 6,
  SPIN_KEEP: Math.round(0.5 * S),
  LOOSE_V: Math.round(0.35 * S),
  BLOW_T: 14,
  THROTTLE_MAX: 15,
  ENG_MAX: 20,
  TYR_MAX: 10,
}

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
  green: number    // nLockTime the launch may not precede. A false start cannot be MINED.
  gap: number      // K: the minimum nLockTime step between moves. The human-vs-machine dial.
  last: number     // the previous move's nLockTime
  s: number        // position
  v: number        // velocity
  n: number        // tick count — and therefore the ELAPSED TIME
}

/** Field order as laid out in the script. PUBLISHED — a rebuilder needs this exact order. */
export const FIELDS = ['phase', 'driver', 'eng', 'tyr', 'finish', 'green', 'gap', 'last', 's', 'v', 'n'] as const
/** Fixed byte-widths, by field. PUBLISHED alongside FIELDS. */
export const FIELD_WIDTHS: Record<(typeof FIELDS)[number], number> = {
  phase: 1, driver: 20, eng: 2, tyr: 2, finish: 6, green: 5, gap: 4, last: 5, s: 6, v: 5, n: 4,
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
    eng: 0, tyr: 0, finish: 0, green: 0, gap: 0, last: 0, s: 0, v: 0, n: 0,
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
  st: ShellState, p: { finish: number; green: number; gap: number },
): ShellState {
  need(st.phase === PHASE.CAR, `a track can only be loaded onto a shell holding a car (this one is ${PHASE_NAMES[st.phase]})`)
  need(p.finish > 0, 'the finish line must be beyond the start')
  need(p.green > 0, 'a race needs a start time')
  need(p.gap >= 0, 'the minimum gap cannot be negative')
  return { ...st, phase: PHASE.TRACK, finish: p.finish, green: p.green, gap: p.gap }
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
  const mass = regs.M0 + st.eng * regs.WE + fmul(m.fuel * S, regs.WF)
  need(mass > 0, 'a car cannot be massless')

  // Grip rises with speed, which is why a big engine wastes force off the line and rewards good tyres.
  const grip = st.tyr * regs.G0 + fmul(st.v, regs.GV)
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
/* 209 bytes of 220, leaving room for nothing — the genesis writes this ALONE, unlike the battery's
   layout+mark. Written tersely because the full prose ran to 291: `w` for widths, single letters for
   the intermediates, and the phase names dropped because the numbers are self-evident once the field
   order is published. Everything that survives is something a rebuilder CANNOT derive from a tip —
   the field layout to parse the state at all, the encoding, and the equations governing moves that
   have not happened yet. The regulation VALUES are deliberately absent: they live in the script, which
   a rebuilder already has. */
export const SHELL_STATE_LAYOUT =
  'BITCOIN RACER SHELL v1|' + FIELDS.join(',') + '|w ' + FIELDS.map(k => FIELD_WIDTHS[k]).join(',') + '|' +
  'sign-mag LE|1=2^32|m=M0+eng*WE+fuel*WF|g=tyr*G0+v*GV|F=min(eng*FE*t/TM,g)|' +
  'v+=F/m-v*DRAG|s+=v|burn=B0+eng*BE*t/TM'
