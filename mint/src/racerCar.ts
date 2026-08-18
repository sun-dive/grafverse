// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ A CAR THAT IS ONE RACE — minted knowing its own result, and proving it on chain.
 *
 * `specialiseRun` compiles a simulated run into straight-line BASIC: every branch the simulation
 * resolved becomes an assertion, so the script IS the run that happens. This is the covenant around it —
 * the part that makes the run a transaction rather than an argument.
 *
 * ```
 *   HEAD      name$12 · fuel · eng · tyr · slip · finish     the RECORD: pushed, then dropped unread
 *   FRAME     OP_PUSH_TX · hashOutputs · the value V it holds
 *   RACE      the trace-specialised run, every branch already resolved into an assertion
 *   VALUE     out0 = V − FEE, exactly — the script knows its own size, so it knows its own fee
 *   BIND      out0 pays THE DEPOT · HASH256(out0) = hashOutputs
 * ```
 *
 * ── ★★ EVERYTHING IS KNOWN, AND THE SCRIPT IS COMPILED THAT WAY ───────────────────────────────────
 * The driver chooses the engine, the tyres, the surface, the track and the tank, and the run is then
 * simulated to the last tick BEFORE anything is minted. So there is no unknown anywhere in this car and
 * no room for error: the configuration goes to the compiler as CONSTANTS.
 *
 * ⚠ That is not the same as the network checking nothing, which is what it sounds like. MEASURED on the
 * reference sixty-tick race: folded, the script still carries **240 OP_VERIFY and 1,320 arithmetic
 * opcodes** — identical assertion count to the same race compiled with the values read back at runtime.
 * The compiler does constant FOLDING, not constant PROPAGATION, so `fuel = 40000` stays a stack value
 * and every tick below it genuinely executes. ⇒ A wrong prediction still produces NO race.
 *
 * ⇒ What folding does cost is that the HEAD is an index rather than a binding: the literals the physics
 * runs on and the values written into the head are set by the same function here, but nothing on chain
 * ties them together. The head is how a leaderboard FINDS the setup; the reference physics is how it
 * CHECKS one, because the time is a function of the configuration and anyone can re-derive it.
 *
 * ── ★ THE CAR IS A BATTERY, AND MORE COMPLETELY THAN THE CHAINED ONE WAS ──────────────────────────
 * There is no key, no owner, no burn branch and no choice for the spender: the unlocking script is the
 * preimage and nothing else. The only thing this covenant can do is run one predetermined race and pay
 * what is left to the depot. ⇒ An abandoned car needs no sweeper with a key — anybody may race it, and
 * racing it is what brings the fuel home.
 *
 * ⚠ The cost of that, and it is the retired battery's lesson: a car that cannot be spent AT ALL is a
 * car nobody can rescue. `raceValidates()` exists to be run BEFORE the mint is broadcast.
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { op, PN, fixedField } from './covenantAsm.ts'
import { compileBasic, scriptCodeVarIntSize, type Field } from './basic.ts'
import { extractHashOutputsOps } from './covenant.ts'
import { pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants } from './pushtx.ts'
import { type RunTrace } from './racerTick.ts'
import { carPrograms, optimizeCarCompile } from './optimizeCarCompile.ts'

/** SIGHASH_ALL | FORKID — the scope every covenant in this repo signs under. */
export const CAR_SCOPE = 0x41

/**
 * How many characters of leaderboard name a car carries.
 *
 * ⚠ PINNED DEPOT-SIDE, so it is fixed once a depot genesis exists: the depot recognises a car partly by
 * the push opcode in front of this field, and a push opcode encodes its own length.
 */
export const NAME_BYTES = 12

/**
 * The declared configuration, in the order it is laid out in the script.
 *
 * ⚠ `fuel` is FOUR bytes and it is the tank, not a balance. Since the fee left the loop it is a game
 * quantity: it drives `mass`, so a car lightens as it burns, and it decides whether a run goes dry. The
 * satoshis are a separate matter entirely — see `FEE` below.
 *
 * ★ The widths are the SHELL's, not new ones: `finish` is six bytes there because a distance is scaled
 * by S = 2³², and a reader that already knows the racing layout should not have to learn a second one.
 */
export const CAR_LAYOUT: ReadonlyArray<{ name: keyof CarConfig; width: number }> = [
  { name: 'name', width: NAME_BYTES },
  { name: 'fuel', width: 4 },
  { name: 'eng', width: 2 },
  { name: 'tyr', width: 2 },
  { name: 'slip', width: 2 },
  { name: 'finish', width: 6 },
]

/** The head as BRC-X would describe it — the same widths, for a reader that already knows the shell. */
export const CAR_LAYOUT_STRING = CAR_LAYOUT
  .map(f => `${f.name}${f.name === 'name' ? '$' : '%'}${f.width}`).join(' ')

export interface CarConfig {
  /** Up to NAME_BYTES characters. Decorative by design — nothing computes from it. */
  name: string
  /** The tank, in fuel units. */
  fuel: number
  eng: number
  tyr: number
  /** Surface, in SLIP_UNIT-ths. */
  slip: number
  /** Track length, already scaled by S. */
  finish: number
}

export interface CarParams {
  cfg: CarConfig
  /** The simulated run this car is compiled for — ending and all. */
  run: RunTrace
  /** The depot's locking script, as bytes. The only place this car's satoshis can go. */
  depotScript: number[]
  /**
   * The exact fee this race pays, in satoshis. ⚠ NO DEFAULT — derive it with `racerCarFee`, which
   * serializes the spend. A car whose FEE is below what its own transaction costs cannot be raced by
   * anybody, ever, and there is no key to amend it.
   */
  fee: number
  /** The physics constants the specialised source refers to. */
  consts: Record<string, number>
  /**
   * ★ Compile the race through `optimizeCarCompile` — loop-invariant hoisting, ~18% smaller, and it
   * PROVES itself against the faithful build before returning anything. Default OFF: a car is
   * permanent, so the cheaper build is a decision, never a default that happened.
   *
   * ⚠ An optimised car reads back as the OPTIMISED program. Still a program, still legible — the
   * engine and the throttle are right there — but it is not the same listing as a plain car.
   */
  optimise?: boolean
  c?: PushTxConstants
}

/** The name, padded to NAME_BYTES with zeros. ⚠ Refuses rather than truncating. */
export function nameBytes(name: string): number[] {
  const b = [...new TextEncoder().encode(name)]
  if (b.length > NAME_BYTES) {
    throw new Error(`racerCar: "${name}" is ${b.length} bytes and the name field is ${NAME_BYTES} — ` +
      'refusing to truncate, because a car that disagrees with its own leaderboard entry is worse ' +
      'than a rejected name')
  }
  return [...b, ...new Array(NAME_BYTES - b.length).fill(0)]
}

/**
 * The whole program: a car at rest, then the run compiled from its own simulation.
 *
 * ★ IT COMES FROM `optimizeCarCompile`, WHICH IS WHERE CAR COMPILATION LIVES. This file used to carry
 * its own copy of the preamble, which is how two files come to disagree about what a car is — so it
 * asks for the program instead of writing one. `basic.ts`, the general compiler, knows nothing about
 * either of them.
 */
export function carSrc(run: RunTrace): string {
  return carPrograms(run).faithful
}

/** The physics constants plus the driver's choices — everything this car was compiled knowing. */
export function carConsts(cfg: CarConfig, physics: Record<string, number>): Record<string, number> {
  return { ...physics, TANK: cfg.fuel, eng: cfg.eng, tyr: cfg.tyr, slip: cfg.slip, finish: cfg.finish }
}

/** The car's locking script, as ops. */
export function racerCarOps(p: CarParams): { ops: ScriptChunk[]; layout: Field[]; depth: number } {
  const c = p.c ?? pushTxConstants(CAR_SCOPE)
  const consts = carConsts(p.cfg, p.consts)
  /* ⚠ The optimised path is not a different compiler — it is a different PROGRAM, compiled by the same
     faithful one, and checked against the plain build before it comes back. See THE HARD RULE. */
  const probe = p.optimise
    ? optimizeCarCompile(p.run, consts)          // ⚠ carries the compiler's own stack model with it
    : compileBasic(carSrc(p.run), { stack: [], consts })

  /* ★ THE HEAD IS AN INDEX — pushed, then dropped unread, and never touched again.
     The physics does not consult it: everything the run needs was known before the car existed and is
     compiled in. These bytes are here so that a leaderboard, a reader or a decompiler can find the
     setup at a fixed offset without executing anything, and so `unbasic` has something to name. */
  const head: ScriptChunk[] = CAR_LAYOUT.map(f =>
    pushData(f.name === 'name' ? nameBytes(p.cfg.name) : fixedField(p.cfg[f.name] as number, f.width)))
  const pairs = Math.floor(CAR_LAYOUT.length / 2)
  for (let i = 0; i < pairs; i++) head.push(op(OP.OP_2DROP))
  if (CAR_LAYOUT.length % 2) head.push(op(OP.OP_DROP))

  const ops: ScriptChunk[] = [
    ...head,
    ...pushTxVerifyOps(c),                                        // [preimage], now genuine

    op(OP.OP_DUP), ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),          // alt: [HO]
    /* The value of the output being spent sits 52 bytes from the end of the preimage — the car's own
       balance, and the only place it can be read from honestly. */
    op(OP.OP_DUP),
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK),  // alt: [HO, V]
    /* ⚠ AND THE PREIMAGE IS DONE WITH. Both things this car needs from it are on the altstack, and
       unlike every other covenant here it never reads its own scriptCode — everything it needs was
       known before it existed. Leaving it would strand it under the whole program and under the
       result: measured at two items on the stack where one is correct. */
    op(OP.OP_DROP),                                               // []

    ...probe.ops,                                                 // ← THE RACE
  ]

  /* ── the race left its working on the stack, and none of it is needed again ──────────────────────
     ⚠ The depth comes from the compiler's own model, never from counting. `coalesce` moves a
     re-assigned name to the top, so the stack after the body is not in any order a human would guess. */
  const depth = probe.stack.length
  for (let i = 0; i < Math.floor(depth / 2); i++) ops.push(op(OP.OP_2DROP))
  if (depth % 2) ops.push(op(OP.OP_DROP))

  /* ── THE VALUE, AND THE SPENDER GETS NO SAY IN IT ────────────────────────────────────────────────
     A chained car had to be told what its successor would carry, because only the spender knew how big
     the next transaction was. This race is one transaction of a size fixed at compile time, so the
     script computes the output value itself: V − FEE, exactly. There is nothing to claim and therefore
     nothing to claim wrongly. */
  ops.push(
    op(OP.OP_FROMALTSTACK),                                       // V
    PN(p.fee), op(OP.OP_SUB),                                     // V − FEE
    /* ⚠ Never zero: a 0-value output is refused as dust before the script is evaluated at all. */
    op(OP.OP_DUP), PN(0), op(OP.OP_GREATERTHAN), op(OP.OP_VERIFY),
    PN(8), op(OP.OP_NUM2BIN),                                     // 8-byte little-endian value
    /* ── AND BIND IT TO THE DEPOT ────────────────────────────────────────────────────────────────
       out0 = value(8) ‖ varint(len) ‖ depotScript. One output and no others: hashOutputs is the hash
       of the whole outputs list, so anything appended would change it. */
    pushData([...varIntBytes(p.depotScript.length), ...p.depotScript]), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )
  return { ops, layout: CAR_LAYOUT as unknown as Field[], depth }
}

/** The varint an output serialization puts in front of a script of this length. */
export function varIntBytes(len: number): number[] {
  if (len < 253) return [len]
  if (len < 65536) return [0xfd, len & 0xff, (len >> 8) & 0xff]
  return [0xfe, len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff]
}

/**
 * The car's locking script.
 *
 * ★ There is no circular scriptCode offset to resolve here, and that is worth noticing: the frames in
 * this repo all need a probe-measure-rebuild dance because they READ their own scriptCode out of the
 * preimage, and BIP143 puts the script's own length in front of it. This car reads nothing of itself.
 * Everything it needs was known before it existed.
 */
export function buildRacerCar(p: CarParams): LockingScript {
  return new LockingScript(racerCarOps(p).ops)
}

/**
 * ★★ THE FEE, DERIVED BY SERIALIZING THE SPEND — never counted, never estimated, never ARC's suggestion.
 *
 * ⚠⚠ AND IT IS CIRCULAR, which is the part that has caught this project five times: `fee` is PUSHED BY
 * THE SCRIPT, so a bigger fee is a longer script is a bigger transaction is a bigger fee. Deriving it
 * once from a script built with `fee = 0` lands under the true cost, permanently, with no key to raise
 * it. So iterate to a fixed point.
 *
 * ★ The race transaction is the simplest shape this project has: ONE input whose unlocking script is
 * just the preimage, and ONE output paying the depot. Nothing about it varies at spend time, which is
 * why the fee can be exact rather than a bound.
 *
 * @param feeRateSatPerKB 100 sat/KB — the official rate. ⚠ Do not inflate it.
 */
export function racerCarFee(
  p: Omit<CarParams, 'fee'>, feeRateSatPerKB = 100,
): { bytes: number; fee: number; lockBytes: number } {
  let fee = 0
  for (let round = 0; round < 12; round++) {
    const lockBytes = new LockingScript(racerCarOps({ ...p, fee }).ops).toBinary().length
    /* The preimage's only variable part is the scriptCode — which is this very script. */
    const preimageLen = 4 + 32 + 32 + 36 + (scriptCodeVarIntSize(lockBytes) + lockBytes) + 8 + 4 + 32 + 4 + 4
    const unlock = pushLen(preimageLen) + preimageLen
    const bytes =
      4 + 1 +                                                      // version, input count
      (36 + varIntBytes(unlock).length + unlock + 4) +             // the one input
      1 +                                                          // output count
      (8 + varIntBytes(p.depotScript.length).length + p.depotScript.length) +
      4                                                            // locktime
    const next = Math.ceil((bytes * feeRateSatPerKB) / 1000)
    if (next === fee) return { bytes, fee, lockBytes }
    fee = next
  }
  throw new Error('racerCar: the fee did not settle — it should converge in two or three rounds')
}

/** How many bytes the push opcode for `n` bytes of data occupies. */
function pushLen(n: number): number {
  if (n <= 75) return 1
  if (n <= 255) return 2
  if (n <= 65535) return 3
  return 5
}

/**
 * The unlocking script: the preimage, and nothing else.
 *
 * ★ That is the whole interface. A covenant with inputs is a machine somebody plays; this one has none,
 * because the driver made every choice before it was minted.
 */
export function racerCarUnlock(preimage: number[]): ScriptChunk[] {
  return [pushData(preimage)]
}
