// © BSV Association — Open BSV License v6.
/**
 * ⭕🔋 THE SEATED BOARD'S FRAME — a fork of `basicCovenant.ts`, and deliberately its own file.
 *
 * ⚠⚠⚠ WHY THIS IS NOT AN EDIT TO `basicCovenant.ts`. That file is imported by `src/grafbasic.ts`,
 * which builds `vendor/grafbasic.js` — **the bundle `basic.html` loads**. Adding lock-time extraction
 * there would push every visitor to the BASIC workbench onto a new bundle for a game they never
 * opened, and would put a game's needs inside a file five other pages are built from.
 * ⇒ Precedent: `racerDepotFrame.ts`, `betaFrame.ts`. The cost of isolation is duplicated logic, so
 *   **`test/oxo-seat-frame.ts` pins the copy**: with every switch OFF this MUST emit bytes identical
 *   to `buildBasicLock`. Same guard as `test/racer-physics.ts`.
 *
 * ── ★★★ WHAT THIS FRAME ADDS, AND THE PRINCIPLE BEHIND IT ────────────────────────────────────────
 * **The frame supplies verified FACTS; the BASIC expresses the RULES.**
 *
 * The sighash preimage already carries the transaction's lock time and its input's sequence, and
 * `pushTxVerifyOps` has just proved that preimage is the one the miner validated. ⇒ So the frame lifts
 * those two fields out and NAMES them to the compiler. The rules that use them —
 *
 * ```basic
 *   VERIFY sequence < 4294967295      REM  non-final, or consensus ignores the lock time entirely
 *   VERIFY locktime >= stamp          REM  the clock may only ever move forward
 * ```
 *
 * — are then ordinary BASIC, which means **`unbasic` can read them back off the chain.** A rule
 * hand-emitted into a frame can only be re-derived; a rule compiled from BASIC can be CHECKED, and
 * that is the whole reason the reader was built.
 *
 * ── ⚠⚠ TWO TRAPS THIS LAYOUT EXISTS TO AVOID ─────────────────────────────────────────────────────
 * **1 · `extractScriptCodeFieldOps` CONSUMES the preimage.** It is not a peek. Anything else that needs
 * the preimage must take its copy FIRST and hand the original back to the top of the stack.
 *
 * **2 · THE ALTSTACK IS WHERE YOU LOSE TRACK OF WHAT YOU PUT THERE** (`tools/BASIC.md`, twice in one
 * day). The obvious way to hold two extracted fields while the program runs is to park them on the
 * altstack — which is exactly the shape that turned into a drain. ⇒ These stay on the MAIN stack,
 * named in the compiler's model, where the depth arithmetic is derived rather than counted.
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { op, PN } from './covenantAsm.ts'
import { compileState, scriptCodeVarIntSize, stateChunks, type Field, type StateResult } from './basic.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants } from './pushtx.ts'
import type { FrameParams } from './basicCovenant.ts'

/** ⚠ The same scope the rest of the repo signs under. Under ANYONECANPAY hashPrevouts is zeroes. */
const SCOPE = 0x41                                          // SIGHASH_ALL | FORKID

export interface OxoFrameParams extends FrameParams {
  /**
   * Name `locktime` and `sequence` to the program, taken from the verified preimage.
   * ⚠ OFF by default: with it off this frame MUST be byte-identical to `buildBasicLock`, and
   * `test/oxo-seat-frame.ts` is what keeps that true.
   */
  clock?: boolean
}

/**
 * ⚠⚠ BIP143 PUTS THESE AT FIXED DISTANCES FROM THE **END** of the preimage, which is the only stable
 * place to measure from — everything before the scriptCode moves when the script's length changes.
 *
 * ```
 *   … ‖ value(8) ‖ nSequence(4) ‖ hashOutputs(32) ‖ nLockTime(4) ‖ sighashType(4)
 *                 └─ 44 from end                   └─ 8 from end
 * ```
 * ★ Both are LITTLE-ENDIAN on the wire, and `OP_BIN2NUM` reads little-endian, so no reversal is
 *   needed — unlike a txid, which is why `reverseBytesOps` exists elsewhere and is absent here.
 */
const tailBytesOps = (fromEnd: number, width: number): ScriptChunk[] => [
  op(OP.OP_SIZE), pushData([fromEnd]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
  pushData([width]), op(OP.OP_SPLIT), op(OP.OP_DROP),
]

/**
 * ⚠⚠⚠ THE LOCK TIME IS WIDENED TO FIVE BYTES BEFORE IT BECOMES A NUMBER, AND THAT IS NOT TIDINESS.
 *
 * Script numbers are **sign-magnitude**: the high bit of the last byte is the sign. A unix time reads
 * correctly only while its top byte is under `0x80` — and `0x80000000` is **19 January 2038**. On that
 * day every 4-byte numeric lock time in every covenant built this way **turns negative**, and every
 * comparison against it silently inverts.
 *
 * ⇒ Appending a zero byte keeps the sign bit clear forever. ★ This is exactly why Bitcoin's own
 *   `CHECKLOCKTIMEVERIFY` takes a 5-byte operand; the reason is old, and it is still the reason.
 */
export const extractLockTimeOps = (): ScriptChunk[] => [
  ...tailBytesOps(8, 4),
  pushData([0]), op(OP.OP_CAT), op(OP.OP_BIN2NUM),
]

/**
 * ⚠⚠⚠ THE SEQUENCE IS COMPARED AS BYTES AND NEVER AS A NUMBER — MEASURED, NOT ASSUMED.
 *
 * ```
 *   ffffffff  (final)      → −2,147,483,647
 *   fffffffe  (non-final)  → −2,147,483,646
 * ```
 * ⇒ Both are NEGATIVE, and **`ffffffff < fffffffe` is TRUE**. So the obvious rule —
 * `VERIFY sequence < 4294967295` — **passes for exactly the value it exists to refuse**, and reads
 * perfectly well while doing it. Every ordering comparison on this field is inverted from the
 * intuition its hex spelling gives you.
 *
 * ⇒ Therefore: raw bytes, and an equality test against `ffffffff`. No arithmetic anywhere near it.
 */
export const extractSequenceBytesOps = (): ScriptChunk[] => tailBytesOps(44, 4)

/**
 * ⏱ The precondition that makes the clock mean anything, asserted in the frame rather than in BASIC.
 *
 * ★ This is not a rule about the game — it is part of SUPPLYING a trustworthy fact. With
 * `nSequence = ffffffff` consensus **ignores nLockTime entirely**, so a mover could stamp any time they
 * liked, be mined immediately, and push the opponent's deadline out of reach. ⇒ The frame guarantees
 * *"the lock time is meaningful"*; the program then uses it without having to know why it can.
 */
export const requireNonFinalOps = (): ScriptChunk[] => [
  ...tailBytesOps(44, 4),
  pushData([0xff, 0xff, 0xff, 0xff]), op(OP.OP_EQUAL), op(OP.OP_NOT), op(OP.OP_VERIFY),
]

/**
 * The locking script, as ops.
 *
 * Stack the unlocking script must leave, bottom first — unchanged from `basicCovenant`:
 * ```
 *   …inputs          whatever the program declares
 *   spenderOutputs   the serialized outputs that follow ours
 *   newValue         8 bytes, little-endian: what our own output will carry
 *   preimage         the sighash preimage
 * ```
 */
export function oxoSeatLockOps(
  p: OxoFrameParams,
): { ops: ScriptChunk[]; state: StateResult; layout: Field[] } {
  const c = p.c ?? pushTxConstants(SCOPE)
  const fieldOffset = p.fieldOffset ?? 1

  /* ★ The names the program can reach, in the order the runtime actually leaves them. ⚠ A name in the
     wrong place here does not fail loudly — it silently reads its neighbour. */
  /* ★ Only `locktime` is named. `sequence` is NOT a value the program reasons about — the frame refuses
     a final one outright, because a program that could see it could also forget to check it, and the
     lock time is worthless until that check has passed. ⇒ Supply the fact, not the caveat. */
  const stack = [...(p.inputs ?? []), 'spenderOutputs', 'newValue',
                 ...(p.clock ? ['locktime'] : [])]

  const head: ScriptChunk[] = []
  const probe = compileState(p.src, { fieldOffset, consts: p.consts, stack })
  head.push(...stateChunks(probe.layout, p.state))
  /* …and then dropped. The script never reads its own literals; it reads its scriptCode out of the
     preimage, which is the only copy a miner has verified. Two at a time. */
  const pairs = Math.floor(probe.layout.length / 2)
  for (let i = 0; i < pairs; i++) head.push(op(OP.OP_2DROP))
  if (probe.layout.length % 2) head.push(op(OP.OP_DROP))

  const ops: ScriptChunk[] = [
    ...head,
    ...pushTxVerifyOps(c),                                   // [SO, newV, preimage] — now genuine

    op(OP.OP_DUP), ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),          // alt: [HO]
    /* The value of the output being SPENT sits 52 bytes from the end — the covenant's balance, and the
       only place it can be read from honestly. */
    op(OP.OP_DUP),
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK),   // alt: [HO, V]
  ]

  /* ── ⏱ THE CLOCK ────────────────────────────────────────────────────────────────────────────────
     Copy, extract, and SWAP THE PREIMAGE BACK TO THE TOP — because `extractScriptCodeFieldOps` below
     consumes whatever is there, and it must be the preimage. Everything stays on the main stack. */
  if (p.clock) {
    ops.push(
      /* ⚠ FIRST, and on a copy: refuse a final sequence. Until this passes the lock time below is not
         a fact about anything — consensus would not have enforced it. Verification and the thing it
         authorises stay ADJACENT, which is the altstack lesson stated the other way round. */
      op(OP.OP_DUP), ...requireNonFinalOps(),
      op(OP.OP_DUP), ...extractLockTimeOps(), op(OP.OP_SWAP),   // [.., locktime, preimage]
    )
  }

  ops.push(
    ...extractScriptCodeFieldOps(),                          // [.., scriptCodeField] — preimage consumed
    ...probe.ops,                                            // ← the BASIC: peel, run, rebuild
  )

  /* ── THE VALUE RULE ───────────────────────────────────────────────────────────────────────────────
     `newValue` is the spender's claim about what our output will carry; the binding below is what makes
     the claim true or fatal. ⚠ A FLOOR, not an equality — which is what lets the board be recharged. */
  const a = probe.stack.slice()
  const dNewV = a.length - 1 - a.lastIndexOf('newValue')
  ops.push(
    PN(dNewV), op(OP.OP_PICK), op(OP.OP_BIN2NUM),
    op(OP.OP_FROMALTSTACK),                                  // V, what it holds now
    PN(p.maxFee), op(OP.OP_SUB),
    op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),

    /* ── AND BIND IT ──────────────────────────────────────────────────────────────────────────────
       output0 = value(8) ‖ varint(len) ‖ script — and the rebuilt scriptCode FIELD already carries its
       own varint, which is why the extractor hands back the field and not the script. */
    PN(dNewV), op(OP.OP_PICK), op(OP.OP_SWAP), op(OP.OP_CAT),
  )
  const dSO = a.length - 1 - a.lastIndexOf('spenderOutputs')
  ops.push(
    PN(dSO), op(OP.OP_PICK), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )
  return { ops, state: probe, layout: probe.layout }
}

/**
 * ⚠⚠ THE CIRCULAR OFFSET, resolved the only way it can be: build once with a probe, measure, build
 * again. `fieldOffset` is where field zero's DATA begins inside the scriptCode, and BIP143 puts the
 * scriptCode's own varint LENGTH in front of it — so the offset depends on the finished script's
 * length, and the script is not finished while you are computing it.
 */
export function buildOxoSeatLock(p: OxoFrameParams): LockingScript {
  const probeLen = new LockingScript(oxoSeatLockOps({ ...p, fieldOffset: 1 }).ops).toBinary().length
  const varInt = scriptCodeVarIntSize(probeLen)
  return new LockingScript(oxoSeatLockOps({ ...p, fieldOffset: varInt + 1 }).ops)
}
