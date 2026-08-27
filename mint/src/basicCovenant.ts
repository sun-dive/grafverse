// © 2026 sun-dive — Apache License 2.0.
/**
 * ★★ A WHOLE COVENANT FROM A BASIC PROGRAM — the small frame around `compileState`.
 *
 * `compileState` reads the script's own state and rebuilds it. That is the interesting half and it is
 * deliberately not a covenant: nothing yet says the rebuilt script has to be where the money GOES. This
 * is the other half, and it is the smallest honest version of it —
 *
 * ```
 *   verify the preimage        OP_PUSH_TX · authorisation with no key to steal
 *   read hashOutputs and V     out of the preimage, where the miner put them
 *   peel · run · rebuild       ← the BASIC program, via compileState
 *   the value rule             out ≥ V − MAX_FEE, so the covenant cannot be drained by a fee
 *   bind the output            HASH256(out0 ‖ the spender's outputs) = hashOutputs
 * ```
 *
 * ── ⚠ WHY THIS IS A SEPARATE FILE AND NOT PART OF THE COMPILER ────────────────────────────────────
 * The shell, the depot and the battery each answer "what must my output be?" differently — the shell
 * drops its floor to one satoshi when a run ends, the depot bounds what leaves the tank, the battery
 * has no spender outputs at all. A frame generated inside the compiler would be a fourth opinion, and
 * it would be wrong for all three. This one is the DEFAULT, not the law: read it, and if your covenant
 * needs a different rule, write that instead. The compiler still does the state.
 *
 * ── ⚠⚠ AND THE FEE IS NOT GUESSED HERE ─────────────────────────────────────────────────────────────
 * `maxFee` is a parameter with NO default, because a bound that sits below the relay floor is baked
 * into an address forever and this project has come within a hair of that five times. Derive it by
 * SERIALIZING a worst-case spend — `frameMaxFee` does exactly that and nothing else.
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { op, PN } from './covenantAsm.ts'
import { compileState, scriptCodeVarIntSize, stateChunks, type Field, type StateResult } from './basic.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants } from './pushtx.ts'

export interface FrameParams {
  /** The BASIC program, DIM declarations and all. */
  src: string
  /** The state this instance starts in — one entry per DIM, by name. */
  state: Record<string, number | number[]>
  /**
   * The most this move may pay a miner, in satoshis. ⚠ NO DEFAULT ON PURPOSE — see `frameMaxFee`.
   * The covenant's output must carry at least `V − maxFee`, so this is the whole drain surface.
   */
  maxFee: number
  consts?: Record<string, number>
  c?: PushTxConstants
  /**
   * ★ WHAT THE SPENDER GETS TO CHOOSE — named, and pushed DEEPEST of all.
   *
   * A covenant with no inputs can only advance itself; one with inputs is a machine somebody plays.
   * They go below everything else so that adding one never moves a depth the frame already measured.
   */
  inputs?: string[]
  /** Internal: `buildBasicLock` resolves the circular offset with a probe. */
  fieldOffset?: number
}

/** The scope every covenant in this repo signs under. ⚠ Under ANYONECANPAY hashPrevouts is zeroes. */
const SCOPE = 0x41                                          // SIGHASH_ALL | FORKID

/**
 * The locking script, as ops.
 *
 * Stack the unlocking script must leave, bottom first:
 * ```
 *   spenderOutputs   the serialized outputs that follow ours — change, a payout, or nothing at all
 *   newValue         8 bytes, little-endian: the satoshis our own output will carry
 *   preimage         the sighash preimage
 * ```
 */
export function basicLockOps(p: FrameParams): { ops: ScriptChunk[]; state: StateResult; layout: Field[] } {
  const c = p.c ?? pushTxConstants(SCOPE)
  const fieldOffset = p.fieldOffset ?? 1

  /* ⚠ THE STATE GOES IN FIRST, as literal pushes, and it is the only part of this script that differs
     between two instances. Everything after it is identical for every instance of the same program —
     which is what makes a genesis address and its successors the SAME covenant. */
  const head: ScriptChunk[] = []
  /* ⚠ The two unlocking pushes are NAMED in the compiler's model, not counted. The value rule and the
     output binding both reach past the state to them, and their depth changes with every field the
     program declares — which is precisely the kind of number this project stopped writing by hand. */
  const probe = compileState(p.src, {
    fieldOffset, consts: p.consts, stack: [...(p.inputs ?? []), 'spenderOutputs', 'newValue'],
  })
  head.push(...stateChunks(probe.layout, p.state))
  /* …and then they are dropped. The script does not READ its own literals; it reads its scriptCode out
     of the preimage, which is the only copy a miner has verified. Two pushes at a time. */
  const pairs = Math.floor(probe.layout.length / 2)
  for (let i = 0; i < pairs; i++) head.push(op(OP.OP_2DROP))
  if (probe.layout.length % 2) head.push(op(OP.OP_DROP))

  const ops: ScriptChunk[] = [
    ...head,
    ...pushTxVerifyOps(c),                                   // [SO, newV, preimage] — preimage now genuine

    op(OP.OP_DUP), ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),          // alt: [HO]
    /* The value of the output being SPENT sits 52 bytes from the end of the preimage — that is the
       covenant's current balance, and the only place it can be read from honestly. */
    op(OP.OP_DUP),
    op(OP.OP_SIZE), pushData([52]), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    pushData([8]), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK),   // alt: [HO, V]

    ...extractScriptCodeFieldOps(),                          // [SO, newV, scriptCodeField]
    ...probe.ops,                                            // ← the BASIC: peel, run, rebuild
  ]

  /* ── THE VALUE RULE ───────────────────────────────────────────────────────────────────────────────
     `newValue` is the spender's claim about what our output will carry, and the output comparison below
     is what makes the claim true or fatal. This is the only thing standing between a covenant and being
     emptied one fee at a time. */
  const a = probe.stack.slice()
  const dNewV = a.length - 1 - a.lastIndexOf('newValue')
  ops.push(
    PN(dNewV), op(OP.OP_PICK), op(OP.OP_BIN2NUM),            // what the spender says it will pay itself
    op(OP.OP_FROMALTSTACK),                                  // V, what it holds now
    PN(p.maxFee), op(OP.OP_SUB),
    op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),

    /* ── AND BIND IT ──────────────────────────────────────────────────────────────────────────────
       output0 = value(8) ‖ varint(len) ‖ script — and the rebuilt scriptCode FIELD already carries its
       own varint, which is exactly why `extractScriptCodeFieldOps` hands back the field rather than the
       script. Then the spender's own outputs, then the hash the miner committed to. */
    PN(dNewV), op(OP.OP_PICK), op(OP.OP_SWAP), op(OP.OP_CAT),
  )
  /* The pick, the swap and the concatenation leave the stack exactly as long as it was — `script` has
     become `out0` in place — so this depth is measured against the same model. */
  const dSO = a.length - 1 - a.lastIndexOf('spenderOutputs')
  ops.push(
    PN(dSO), op(OP.OP_PICK), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )
  return { ops, state: probe, layout: probe.layout }
}

/**
 * ⚠⚠ THE CIRCULAR OFFSET, RESOLVED THE ONLY WAY IT CAN BE.
 *
 * `fieldOffset` is where field zero's DATA begins inside the scriptCode — and BIP143 puts the
 * scriptCode's own varint LENGTH in front of it, so the offset depends on how long the finished script
 * is, and the script is not finished while you are computing it. Build once with a probe, measure,
 * build again. `buildShellLock` does the same, and for the same reason.
 */
export function buildBasicLock(p: FrameParams): LockingScript {
  const probeLen = new LockingScript(basicLockOps({ ...p, fieldOffset: 1 }).ops).toBinary().length
  const varInt = scriptCodeVarIntSize(probeLen)
  /* Everything before field zero's data: the varint, then each earlier push in the head, then this
     field's own one-byte push opcode. Field zero is the FIRST push in the script, so there is nothing
     between the varint and it but that one byte. */
  return new LockingScript(basicLockOps({ ...p, fieldOffset: varInt + 1 }).ops)
}

/** The unlocking half, in the order the frame reads it. */
export function basicUnlockingOps(
  p: { spenderOutputs: number[]; newValue: number[]; preimage: number[]; inputs?: number[] },
): ScriptChunk[] {
  if (p.newValue.length !== 8) throw new Error('basicCovenant: newValue is 8 bytes, little-endian')
  /* ⚠ IN THE SAME ORDER AS `inputs` NAMES THEM, deepest first — the compiler resolved every name
     against that list, so a reversed argument silently reads its neighbour. */
  return [
    ...(p.inputs ?? []).map(n => PN(n)),
    pushData(p.spenderOutputs), pushData(p.newValue), pushData(p.preimage),
  ]
}

/** 8-byte little-endian satoshis, as an output serializes them. */
export function valueBytes(sats: number): number[] {
  const b: number[] = []
  let x = sats
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}

/**
 * ★★ DERIVE THE FEE BY SERIALIZING A SPEND, WHICH IS THE ONLY HONEST WAY TO KNOW IT.
 *
 * ⚠ A `maxFee` below what a move actually costs is not a bug you can fix — it is baked into an address
 * and every successor of it, and the covenant simply stops being spendable. This project has come
 * within a hair of that five times, so the rule is absolute: never hand-count, never estimate from a
 * length, never take ARC's suggestion. Build the transaction, serialize it, and read the size.
 *
 * @param feeRateSatPerKB 100 sat/KB — the official rate. ⚠ Do not inflate it.
 */
export function frameMaxFee(
  p: FrameParams & { spenderOutputs: number[] }, feeRateSatPerKB = 100,
): { bytes: number; fee: number; lockBytes: number } {
  /* ⚠⚠ AND THIS IS CIRCULAR TOO, WHICH IS EASY TO MISS. `maxFee` is PUSHED BY THE SCRIPT, so a bigger
     fee is a longer lock is a bigger transaction is a bigger fee. Deriving it once from a script built
     with `maxFee = 0` gives an answer three bytes short of the truth — under the bound, permanently,
     in exactly the way this comment block exists to prevent. So iterate to a fixed point. */
  let fee = 0
  for (let round = 0; round < 8; round++) {
    const lockBytes = new LockingScript(basicLockOps({ ...p, maxFee: fee }).ops).toBinary().length
    /* The preimage's only variable part is the scriptCode — which is this very script. */
    const preimageLen = 4 + 32 + 32 + 36 + (scriptCodeVarIntSize(lockBytes) + lockBytes) + 8 + 4 + 32 + 4 + 4
    const unlock = new LockingScript(basicUnlockingOps({
      spenderOutputs: p.spenderOutputs,
      newValue: valueBytes(0xffffffff),
      preimage: new Array(preimageLen).fill(0),
    })).toBinary().length
    /* One input and the covenant's own output, plus whatever the spender adds:
       version(4) + in-count(1) + [outpoint 36 + varint + unlock + sequence 4] + out-count(1)
       + [value 8 + varint + lock] + spenderOutputs + locktime(4). */
    const bytes = 4 + 1 + (36 + scriptCodeVarIntSize(unlock) + unlock + 4) + 1 +
      (8 + scriptCodeVarIntSize(lockBytes) + lockBytes) + p.spenderOutputs.length + 4
    const next = Math.ceil((bytes * feeRateSatPerKB) / 1000)
    if (next === fee) return { bytes, fee, lockBytes }
    fee = next
  }
  throw new Error('basicCovenant: the fee did not settle — it should converge in two rounds')
}
