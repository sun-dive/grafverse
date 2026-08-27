// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
/**
 * BRC-226 — the LiveCounter covenant. A single shared on-chain number that ANYONE can push forward,
 * one transaction per tick, with no operator. Built on the same OP_PUSH_TX machinery as the PHAR LAP
 * edition covenants (`./covenant`, `./pushtx`) — no sCrypt, no new cryptography.
 *
 * The counter is a self-replicating ("quine") covenant carrying two state fields in its own script:
 *   n           — a FIXED-WIDTH 4-byte little-endian counter
 *   lastFunder  — the 20-byte hash160 of whoever advanced it last (for the relay refund)
 *
 * On a tick the covenant verifies the spend's sighash preimage, reads `hashOutputs`, and forces the
 * spending tx to begin with exactly three outputs — then lets the signer append their own trailing
 * outputs (a mark + change), which they supply in the unlocking script:
 *
 *   out0  the covenant re-created — SAME script, but  n → n+1  and  lastFunder → newFunder   (the tick)
 *   out1  DEPOSIT sats  → P2PKH(old lastFunder)                                              (the relay refund)
 *   out2  MARKFEE sats  → P2PKH(author)               (constant, non-refundable)              (self-monetizing crumb)
 *   out3+ signer-supplied: OP_RETURN(mark) + change   (unenforced trailing outputs)           (the wall)
 *
 * Determinism ("not forkable"): out0..out2 are pinned byte-for-byte, so n can only ever become n+1 and
 * the old funder is always repaid. FREE (the permission): who signs (newFunder) and what the mark says
 * — neither can bend the counter's path. Pay-to-sign is self-moderating: the crumb makes spam cost real
 * sats, so there is no rate-limit, no gatekeeper.
 *
 * SCOPE = ANYONECANPAY|ALL|FORKID (0xc1): the covenant's preimage does not commit the other inputs, so
 * any funder can add their funding input to cover DEPOSIT + MARKFEE + fee without invalidating the spend;
 * hashOutputs (ALL) still commits every output, so the three enforced outputs are still pinned.
 *
 * ⚠ STATUS: written against the covenant.ts pattern; MUST pass the @bsv/sdk `Spend` interpreter
 * (test/liveCounter.mjs — mint→tick→tick, plus rejection of tampered outputs) BEFORE any mainnet genesis.
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import {
  u64le, numLE, varInt, serializeOutput, p2pkhScript,
  extractHashOutputsOps, extractScriptCodeFieldOps,
} from './covenant.ts'
import { pushTxVerifyOps, pushData, type PushTxConstants, pushTxConstants } from './pushtx.ts'

const op = (code: number): ScriptChunk => ({ op: code })

/** SIGHASH scope for the counter's introspection: ANYONECANPAY|ALL|FORKID (any funder may add inputs). */
export const LIVECOUNTER_SCOPE = 0xc1
/** Record-type byte for a LiveCounter covenant (0x01–0x05 are TEMPLATE/TOKEN/FILE/MESSAGE/EDITION). */
export const RECORD_LIVECOUNTER = 0x06
/** Fixed byte-width of the on-chain counter field (uint32 LE → ~4.29e9 ticks; never touches the sign bit). */
export const N_BYTES = 4

/**
 * UI/policy cap on a mark's byte length — NOT covenant-enforced (the mark is a free trailing OP_RETURN),
 * so this is the board's rule, not a consensus one. 111 = the 1·1·1 / 111-sat nod, and enough bytes to
 * write in any language (≈37 CJK chars · ≈27 emoji · a full Latin sentence).
 */
export const MARK_MAX_BYTES = 111

/** The genesis mark — the counter's opening line. "Follow the white 🐇" is exactly 21 bytes (the hidden 21 nod). */
export const GENESIS_MARK = 'Follow the white \u{1F407}'

/** UTF-8 byte length of a string (the unit the mark cap is measured in). */
export function markByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/** Encode a counter value as the fixed 4-byte little-endian field the covenant carries and increments. */
export function nField(n: number): number[] {
  if (n < 0 || n >= 0x80000000) throw new Error('nField: counter out of uint32 range')
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

/** Serialized byte length of a minimal-length-prefixed data push (matches `pushData`). */
function serializedPushLen(data: number[]): number {
  if (data.length < 76) return 1 + data.length
  if (data.length < 256) return 2 + data.length
  if (data.length < 65536) return 3 + data.length
  return 5 + data.length
}

export interface LiveCounterParams {
  /** Current counter value (embedded as a fixed 4-byte LE field). */
  n: number
  /** 20-byte hash160 of the last funder — repaid DEPOSIT on the next tick. Genesis: the minter/author. */
  lastFunderHash: number[]
  /** 20-byte hash160 of the immutable author (crumb recipient). */
  authorHash: number[]
  /** Satoshis carried on the counter output itself (constant across ticks). Default 1. */
  counterSats?: number
  /** The rolling relay refund paid to the previous funder. Default 1000. */
  depositSats?: number
  /** The non-refundable per-tick crumb to the author. Default 1. */
  markFeeSats?: number
  /** Offset of the counter's DATA within the scriptCode FIELD. Use `buildLiveCounterLock` to compute it. */
  fieldNOffset: number
  c?: PushTxConstants
}

/** Data-field pushes carried in the script (read back from scriptCode by the quine): [P, ver, REC, n(4), lastFunder(20)]. */
function liveCounterFieldChunks(p: LiveCounterParams): ScriptChunk[] {
  return [
    pushData([0x50]),                 // protocol prefix "P"
    pushData([0x01]),                 // LiveCounter format version
    pushData([RECORD_LIVECOUNTER]),
    pushData(nField(p.n)),            // fixed 4-byte counter
    pushData(p.lastFunderHash),       // 20-byte last-funder hash
  ]
}

/**
 * Shared prefix: verify the preimage, stash hashOutputs on the alt stack, extract the scriptCode field,
 * and split it into the FOUR reusable pieces around the two state fields.
 * Stack on entry: [ ..., preimage ].  On exit: [ ..., PRE, n4, lf20, SUF ], alt = [ hashOutputs ].
 *   PRE  = field bytes up to and including the counter's 1-byte push opcode (0x04)
 *   n4   = the 4 counter bytes           lf20 = the 20 last-funder bytes
 *   SUF  = everything after lastFunder (the entire covenant body)
 * The 1-byte push opcode that precedes lastFunder (0x14) is dropped here and re-added as a constant on rebuild.
 */
export function liveCounterPrefixOps(fieldNOffset: number, c: PushTxConstants): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),
    op(OP.OP_DUP),
    ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),        // alt:[hashOutputs]
    ...extractScriptCodeFieldOps(),                          // [ ..., field ]
    pushData(numLE(fieldNOffset)), op(OP.OP_SPLIT),          // [ ..., PRE, n4‖0x14‖lf20‖SUF ]
    op(OP.OP_4), op(OP.OP_SPLIT),                            // [ ..., PRE, n4, 0x14‖lf20‖SUF ]
    pushData([21]), op(OP.OP_SPLIT),                         // [ ..., PRE, n4, 0x14‖lf20, SUF ]
    op(OP.OP_SWAP),                                          // [ ..., PRE, n4, SUF, 0x14‖lf20 ]
    op(OP.OP_1), op(OP.OP_SPLIT), op(OP.OP_NIP),             // drop the 0x14 → lf20  [ ..., PRE, n4, SUF, lf20 ]
    op(OP.OP_SWAP),                                          // [ ..., PRE, n4, lf20, SUF ]
  ]
}

/**
 * Tick tail. Stack on entry: [ spenderOutputs, newFunder20, PRE, n4, lf20, SUF ], alt = [ hashOutputs ].
 * Reconstructs out0 (quine, n→n+1, funder→newFunder), out1 (repay old funder), out2 (author crumb),
 * appends the signer's trailing outputs, and asserts HASH256(out0‖out1‖out2‖spenderOutputs) == hashOutputs.
 */
export function liveCounterTickTailOps(p: {
  counterSats?: number; depositSats?: number; markFeeSats?: number; authorHash: number[]
}): ScriptChunk[] {
  const V        = u64le(p.counterSats ?? 1)
  const OUT1_PRE = [...u64le(p.depositSats ?? 1000), 0x19, 0x76, 0xa9, 0x14] // value ‖ varint(25) ‖ OP_DUP OP_HASH160 PUSH20
  const OUT1_SUF = [0x88, 0xac]                                              // OP_EQUALVERIFY OP_CHECKSIG
  const OUT2     = serializeOutput(p.markFeeSats ?? 1, p2pkhScript(p.authorHash)) // constant author crumb
  return [
    // newN4 = (n+1) as 4-byte LE, computed from n4 (depth 2)
    pushData([2]), op(OP.OP_PICK), op(OP.OP_BIN2NUM), op(OP.OP_1ADD), op(OP.OP_4), op(OP.OP_NUM2BIN),
    // [ spenderOutputs, newFunder20, PRE, n4, lf20, SUF, newN4 ]
    // out0 = V ‖ PRE ‖ newN4 ‖ 0x14 ‖ newFunder20 ‖ SUF
    pushData(V),
    pushData([5]), op(OP.OP_PICK), op(OP.OP_CAT),           // ‖ PRE
    pushData([1]), op(OP.OP_PICK), op(OP.OP_CAT),           // ‖ newN4
    pushData([0x14]), op(OP.OP_CAT),                        // ‖ lastFunder push opcode (constant)
    pushData([6]), op(OP.OP_PICK), op(OP.OP_CAT),           // ‖ newFunder20
    pushData([2]), op(OP.OP_PICK), op(OP.OP_CAT),           // ‖ SUF   → out0
    // out1 = DEPOSIT ‖ P2PKH(old lastFunder)
    pushData(OUT1_PRE), op(OP.OP_CAT),
    pushData([3]), op(OP.OP_PICK), op(OP.OP_CAT),           // ‖ lf20 (old funder)
    pushData(OUT1_SUF), op(OP.OP_CAT),                      // → out0‖out1
    // out2 = author crumb (constant)
    pushData(OUT2), op(OP.OP_CAT),                          // → out0‖out1‖out2
    // ‖ signer's trailing outputs (mark + change)
    pushData([7]), op(OP.OP_ROLL), op(OP.OP_CAT),          // → expected = out0‖out1‖out2‖spenderOutputs
    // assert HASH256(expected) == hashOutputs; clean up the 6 leftover pieces
    op(OP.OP_TOALTSTACK),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP),      // drop newN4, SUF, lf20, n4, PRE, newFunder20
    op(OP.OP_FROMALTSTACK), op(OP.OP_HASH256),
    op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  ]
}

/**
 * Full LiveCounter locking-script ops:
 *   <5 data fields> OP_2DROP OP_2DROP OP_DROP   (carry n + lastFunder on-chain, clear the stack)
 *   <prefix>                                     (verify preimage; extract hashOutputs + the 4 field pieces)
 *   <tick tail>                                  (enforce out0..out2, append the signer's outputs)
 * Use `buildLiveCounterLock` — it computes `fieldNOffset` for you.
 */
export function liveCounterLockOps(p: LiveCounterParams): ScriptChunk[] {
  const c = p.c ?? pushTxConstants(LIVECOUNTER_SCOPE)
  return [
    ...liveCounterFieldChunks(p),
    op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP),       // 5 fields
    ...liveCounterPrefixOps(p.fieldNOffset, c),
    ...liveCounterTickTailOps(p),
  ]
}

/**
 * Build a LiveCounter locking script, computing the counter-field offset from the fixed field layout.
 * Two-pass like `buildEditionLock`: the offset push is the same byte-width whether probing or final, so
 * the length used to size the scriptCode varint is stable.
 * Field layout before n: pushData([0x50]) ‖ pushData([0x01]) ‖ pushData([REC]) = 3 × 2 bytes = 6, then the
 * counter's 1-byte push opcode → O = 7; fieldNOffset = varIntSize(scriptLen) + 7.
 */
export function buildLiveCounterLock(p: Omit<LiveCounterParams, 'fieldNOffset'>): LockingScript {
  const O = serializedPushLen([0x50]) + serializedPushLen([0x01]) + serializedPushLen([RECORD_LIVECOUNTER]) + 1
  const probeLen = new LockingScript(liveCounterLockOps({ ...p, fieldNOffset: 1 })).toBinary().length
  const varIntSize = probeLen < 253 ? 1 : probeLen < 65536 ? 3 : 5
  return new LockingScript(liveCounterLockOps({ ...p, fieldNOffset: varIntSize + O }))
}

/**
 * Serialize the three covenant-enforced outputs of a tick, in order, exactly as they appear in the tx
 * (and inside hashOutputs). The tick-tx builder places these as outputs 0–2, then appends the signer's
 * mark (OP_RETURN) and change as outputs 3+. Returned as raw byte arrays for use by the tx builder/test.
 *   out0  next counter (n+1, newFunder)   out1  deposit → old funder   out2  crumb → author
 */
export function tickEnforcedOutputs(p: {
  nextLock: number[]; counterSats?: number
  oldFunderHash: number[]; depositSats?: number
  authorHash: number[]; markFeeSats?: number
}): { out0: number[]; out1: number[]; out2: number[] } {
  return {
    out0: serializeOutput(p.counterSats ?? 1, p.nextLock),
    out1: serializeOutput(p.depositSats ?? 1000, p2pkhScript(p.oldFunderHash)),
    out2: serializeOutput(p.markFeeSats ?? 1, p2pkhScript(p.authorHash)),
  }
}

/** OP_RETURN output carrying a ≤220-byte mark (value 0). Serialized for use as a trailing signer output. */
export function markOutput(mark: number[]): number[] {
  if (mark.length > 220) throw new Error('markOutput: mark too long')
  const script = [OP.OP_FALSE, OP.OP_RETURN, ...pushDataBytes(mark)]
  return serializeOutput(0, script)
}

/** Raw bytes of a minimal data push (opcode + data), for assembling scripts as byte arrays. */
function pushDataBytes(data: number[]): number[] {
  if (data.length < 76) return [data.length, ...data]
  if (data.length < 256) return [OP.OP_PUSHDATA1, data.length, ...data]
  if (data.length < 65536) return [OP.OP_PUSHDATA2, data.length & 0xff, (data.length >> 8) & 0xff, ...data]
  throw new Error('pushDataBytes: too long')
}

/**
 * Build the covenant input's unlocking script for a tick: it pushes (bottom→top)
 *   spenderOutputs (serialized trailing outputs: mark ‖ change) · newFunder20 · preimage
 * so the prefix consumes the preimage first, then the tail reads newFunder and the trailing outputs.
 * `preimage` is produced by `pushTxPreimage` over the tick tx (scope LIVECOUNTER_SCOPE).
 */
export function tickUnlockingOps(p: { spenderOutputs: number[]; newFunderHash: number[]; preimage: number[] }): ScriptChunk[] {
  return [pushData(p.spenderOutputs), pushData(p.newFunderHash), pushData(p.preimage)]
}
