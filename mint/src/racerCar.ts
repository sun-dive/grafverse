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
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
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
   * ⚠ NO LONGER AN INPUT. The car COMPUTES its fee from its own scriptCode's size — see `carBlockOps`
   * — which is what lets one pinned block recognise cars of every length. Kept optional so callers
   * that used to pass it still type-check; it is ignored. `racerCarFee` remains the way to know what a
   * given car will pay, and the test requires the two to agree.
   */
  fee?: number
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

  /* ── ★★★ THE RACE RUNS FIRST, AND THAT ORDER IS THE SECURITY ────────────────────────────────────
     It reads no `hashOutputs` and no `V` — everything it needs was known before the car existed — so
     it has no reason to sit after them, and every reason to sit before. In front of the block its
     bytes are free space where NO security state exists yet; behind it, they are free space between
     a verified preimage and the output it binds, which is where a drain lives. See `carBlockOps`. */
  const ops: ScriptChunk[] = [
    ...head,
    ...probe.ops,                                                 // ← THE RACE
  ]

  /* ── the race left its working on the stack, and none of it is needed again ──────────────────────
     ⚠ The depth comes from the compiler's own model, never from counting. `coalesce` moves a
     re-assigned name to the top, so the stack after the body is not in any order a human would guess.
     ⚠⚠ AND IT MUST REACH ZERO. The block that follows is pinned by the depot and pushes nothing it
     does not consume, so anything the race leaves behind is still there at the end — and a locking
     script must finish with exactly one true value. */
  const depth = probe.stack.length
  for (let i = 0; i < Math.floor(depth / 2); i++) ops.push(op(OP.OP_2DROP))
  if (depth % 2) ops.push(op(OP.OP_DROP))

  /* ── THE PINNED BLOCK — verification and binding, one unbroken constant run ──────────────────────
     One definition, because the DEPOT pins these exact bytes. A second copy written out here is how a
     depot comes to pin bytes no car actually carries, so there isn't one. */
  ops.push(...carBlockOps(p))

  /* ⚠⚠ AND THE PROPERTY THE DEPOT'S SAFETY RESTS ON, checked on every car this function produces. */
  assertNoControlFlow(ops)
  return { ops, layout: CAR_LAYOUT as unknown as Field[], depth }
}

/**
 * ★★★ THE PINNED BLOCK — verification and binding, adjacent, and IDENTICAL IN EVERY CAR.
 *
 * This is what the depot pins, and it is the whole of the car's security. Three properties, and the
 * design went through two wrong versions before it had all three:
 *
 *   1. IT IS ONE UNBROKEN RUN. Nothing attacker-controlled executes between the preimage being proved
 *      genuine and the output being bound.
 *   2. IT USES NO ALTSTACK. It does not need one — everything stays on the main stack — and that is
 *      not tidiness: an altstack carries security state ACROSS whatever sits between the two halves.
 *   3. IT IS CONSTANT. It contains no per-car number at all, because it COMPUTES the fee from its own
 *      scriptCode's size. So one pinned block recognises a 2 KB car and a 16 KB car alike.
 *
 * ── ⚠⚠ THE TWO VERSIONS THAT WERE WRONG, so neither is rebuilt ────────────────────────────────────
 * **v1 — frame at the start, binding at the end, values carried on the altstack.** MEASURED: the four
 * cars below have four DIFFERENT tails, because the fee is a literal and the fee scales with the car.
 * A depot pinning one tail would recognise exactly one size.
 *
 *     4 m · 2,752 B · fee 386      120 m · 9,016 B · fee 1,012
 *    40 m · 5,623 B · fee 673      220 m · 12,451 B · fee 1,356
 *
 * **v2 — pin only the constant suffix, leave the fee free.** Worse, and the reason is the altstack.
 * The binding ends `HASH256, FROMALTSTACK, EQUAL`, and that `FROMALTSTACK` is supposed to yield the
 * REAL `hashOutputs` the frame put there. With attacker code in between, they pop it and push a hash
 * they computed themselves — and `EQUAL` then compares a hash they chose against a hash they supplied,
 * with no relation to this transaction's outputs. ⇒ **That is a drain, not a burn.** The depot would
 * fund an output paying whoever they like.
 *
 * ⇒ Which is why the RACE now runs FIRST. It reads no `hashOutputs` and no `V`, so it has no reason to
 * sit after them, and in front of them its bytes are free space where no security state exists yet.
 *
 * ── ★ COMPUTING ITS OWN FEE, which is what makes it constant ──────────────────────────────────────
 * The race transaction is the simplest shape here: one input whose unlocking script is the preimage,
 * one output paying the depot. So its size is the car's own length plus a constant, and the car can
 * read that length out of the scriptCode the miner has already verified.
 * ⚠ `OP_DIV` truncates toward zero, so the rounding is done by ADDING 9 before dividing by 10. A fee
 * that rounds DOWN sits under the relay floor, permanently, with no key to raise it.
 */
export function carBlockOps(p: { depotScript: number[]; c?: PushTxConstants }): ScriptChunk[] {
  const c = p.c ?? pushTxConstants(CAR_SCOPE)
  const depotField = [...varIntBytes(p.depotScript.length), ...p.depotScript]
  return [
    ...pushTxVerifyOps(c),                                        // [pre]            ← proved genuine
    op(OP.OP_DUP), ...extractHashOutputsOps(),                    // [pre, HO]
    op(OP.OP_SWAP),                                               // [HO, pre]

    /* ── THE FEE, FROM ITS OWN SIZE ───────────────────────────────────────────────────────────── */
    op(OP.OP_DUP), ...extractScriptCodeFieldOps(),                // [HO, pre, varint‖script]
    op(OP.OP_SIZE), op(OP.OP_NIP),                                // [HO, pre, size]
    PN(feeConstant(p.depotScript.length)), op(OP.OP_ADD),
    PN(10), op(OP.OP_DIV),                                        // [HO, pre, fee]
    op(OP.OP_SWAP),                                               // [HO, fee, pre]

    /* ── THE BALANCE, 52 bytes from the end of the preimage ───────────────────────────────────── */
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM),   // [HO, fee, V]
    op(OP.OP_SWAP), op(OP.OP_SUB),                                // [HO, V − fee]

    /* ⚠ Never zero: a 0-value output is refused as dust before the script is evaluated at all. */
    op(OP.OP_DUP), PN(0), op(OP.OP_GREATERTHAN), op(OP.OP_VERIFY),
    PN(8), op(OP.OP_NUM2BIN),                                     // [HO, valueBytes]

    /* ── AND BIND IT. One output and no others: `hashOutputs` covers the whole list. ───────────── */
    pushData(depotField), op(OP.OP_CAT),                          // [HO, out0]
    op(OP.OP_HASH256), op(OP.OP_EQUAL),                           // [bool]
  ]
}

/**
 * The constant added before dividing by 10 — everything in the race transaction that is NOT the car's
 * own script, plus 9 to round the fee UP and 3 for the scriptCode's own length varint.
 *
 * ⚠ DERIVED, not chosen. `racerCarFee` serializes a real spend and this must agree with it; the test
 * requires them equal across the whole range of car sizes, because a car whose script computes a fee
 * its own transaction cannot pay is a car nobody can ever race.
 */
export function feeConstant(depotBytes: number): number {
  /* Everything in the race transaction that is NOT the scriptCode field the block measures:
       transaction   version 4 · in-count 1 · outpoint 36 · unlock varint 3 · sequence 4
                     · out-count 1 · value 8 · script varint 3 · locktime 4          =  64
       unlocking     the push opcode in front of the preimage (OP_PUSHDATA2)          =   3
       preimage      4+32+32+36 + 8+4+32+4+4, i.e. everything but the scriptCode      = 156
       output        the depot's own script                                           = depotBytes
     …and +9, because `OP_DIV` truncates and the fee must round UP.

     ⚠⚠ THE FIRST VERSION OF THIS ASSEMBLED THE SAME NUMBER OUT OF PARTS AND DOUBLE-COUNTED TWO OF
     THEM, landing ONE SATOSHI UNDER on two car sizes out of five. Under the relay floor is permanent
     and unamendable, and this project has stood on that five times. ⇒ The test requires the in-script
     fee to EQUAL `racerCarFee`'s serialized answer across the whole range of car sizes, because
     agreeing on three sizes out of five is exactly what this looked like. */
  return 64 + 3 + 156 + depotBytes + 9
}

/**
 * ⚠ The range `feeConstant` is arithmetic for. Outside it the varints change width and the constant is
 * silently wrong — so a car outside it is refused rather than mispriced.
 */
export const CAR_BYTES_MIN = 253
export const CAR_BYTES_MAX = 65_000

/** Opcodes that would let a spliced branch swallow the tail. A car must contain none of them. */
export const CONTROL_FLOW = [OP.OP_IF, OP.OP_NOTIF, OP.OP_ELSE, OP.OP_ENDIF, OP.OP_RETURN] as const

/**
 * ⚠⚠ THE PROPERTY THE DEPOT'S SAFETY RESTS ON, CHECKED WHERE IT IS PRODUCED.
 *
 * Tail-only recognition is sound only while a car has no way to close a spliced `OP_IF`. That is true
 * today because a specialised run has no branches at all — and it is a MEASURED fact about the emitted
 * script, not a structural one, so it must be re-checked every time a car is built rather than believed.
 */
export function assertNoControlFlow(ops: ScriptChunk[]): void {
  for (const code of CONTROL_FLOW) {
    const n = ops.filter(o => o.op === code).length
    if (n !== 0) {
      throw new Error(`racerCar: this car carries ${n} control-flow opcode(s) (${code}). Tail-only ` +
        'recognition depends on a car having none — with one present, a spliced OP_IF can be closed ' +
        'and the depot\'s binding skipped. Refusing to build a car that would make the depot a faucet.')
    }
  }
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
