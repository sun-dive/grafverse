// © BSV Association — Open BSV License v6.
/**
 * ★ THE FUEL DEPOT — step 2: the FRAME.
 *
 * A tank anyone may fill, feeding cars anyone may drive. It exists for OPERATIONS, not security: one
 * place to donate, one balance to show, one contributor leaderboard, and cars that refill themselves
 * instead of being hand-filled between races.
 *
 *   donations ──▶ DEPOT ──▶ PUBLIC CAR ──▶ mining fees
 *                             ↑    ↓
 *                             reset, race again
 *
 * ── WHAT IS IN THIS FILE, AND WHAT IS DELIBERATELY NOT ────────────────────────────────────────────
 * The frame ONLY. It proves the depot can rebuild itself exactly and refuses anything else. No value
 * rule, no car check, no burn — those are step 3, each with its own test, added one at a time.
 *
 * ★ This is the step people skip, and the one where the hardest bugs live. The battery's worst bugs
 * were all in this layer rather than in its arithmetic, and met later they every one of them look like
 * logic bugs. Prove the plumbing first or debug it disguised as physics later.
 *
 * ── ⚠ STATELESS, AND WHY THAT IS THE WHOLE TRICK ──────────────────────────────────────────────────
 * The depot carries NO state. Its script is therefore the same bytes forever, which means:
 *
 *   · one constant script hash — so a car can name "a depot" without carrying a copy of one
 *   · no fields to peel and rebuild, so no `fieldOffset`, so no two-pass build
 *   · its balance lives in the OUTPUT VALUE, where a covenant can read it from its own preimage
 *
 * A stateless covenant cannot hold its own hash (a script containing its own hash is a quine problem
 * with no solution), so it derives itself from the preimage's `scriptCode` — the same trick the shell
 * and `selfReplicateCovenantOps` already use.
 */
import { OP, LockingScript, UnlockingScript, type ScriptChunk } from '@bsv/sdk'
import {
  pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants,
} from './pushtx.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'

const op = (o: number): ScriptChunk => ({ op: o })
const PN = (n: number): ScriptChunk => pushData([n])

/** SIGHASH_ALL | FORKID. hashOutputs must be REAL, so ANYONECANPAY is not available to this covenant. */
export const DEPOT_SCOPE = 0x41

/**
 * ★ THE FRAME. Stack on entry, bottom to top: [ spenderOutputs, newValue, preimage ].
 *
 *   spenderOutputs   every output of this transaction AFTER out0, serialized as value(8) ‖ varint ‖ script
 *   newValue         the 8-byte little-endian value of out0 — the depot's successor
 *   preimage         the BIP143 sighash preimage, which OP_PUSH_TX proves is this transaction's own
 *
 * What it enforces, and nothing more:
 *
 *   HASH256( newValue ‖ myOwnScriptCode ‖ spenderOutputs ) == hashOutputs
 *
 * ⇒ out0 must pay a script byte-identical to the one now executing. The value is whatever the spender
 * claims — the frame does not judge it, because judging it is step 3 and mixing the two is how a frame
 * comes out green while proving nothing.
 *
 * ⚠ AND IT BINDS EVERY OTHER OUTPUT TOO. `spenderOutputs` is concatenated into the same hash, so a
 * transaction cannot quietly add an output the covenant never saw. That property is what will later
 * let the depot say "whatever I do not keep goes to the car" instead of merely "out0 is me".
 */
export function depotLockOps(c: PushTxConstants = pushTxConstants(DEPOT_SCOPE)): ScriptChunk[] {
  return [
    ...pushTxVerifyOps(c),                  // [ SO, newV, preimage ]           ← the preimage is real
    op(OP.OP_DUP),                          // [ SO, newV, pre, pre ]
    ...extractHashOutputsOps(),             // [ SO, newV, pre, hashOutputs ]
    op(OP.OP_SWAP),                         // [ SO, newV, hashOutputs, pre ]
    ...extractScriptCodeFieldOps(),         // [ SO, newV, hashOutputs, scriptCodeField ]

    /* Rebuild out0 as an output serialization: value(8) ‖ varint(len) ‖ script. `scriptCodeField`
       already carries its own length varint, which is exactly what an output needs after its value —
       so no length has to be computed, and none can be got wrong. */
    PN(2), op(OP.OP_ROLL),                  // [ SO, hashOutputs, scField, newV ]
    op(OP.OP_SWAP), op(OP.OP_CAT),          // [ SO, hashOutputs, out0 ]

    PN(2), op(OP.OP_ROLL),                  // [ hashOutputs, out0, SO ]
    op(OP.OP_CAT),                          // [ hashOutputs, out0 ‖ SO ]
    op(OP.OP_HASH256),                      // [ hashOutputs, HASH256(all outputs) ]
    op(OP.OP_EQUAL),                        // [ bool ]
  ]
}

/**
 * The depot's locking script. ONE PASS — unlike the shell, which needs a two-pass build to size the
 * scriptCode varint around its own state. A stateless script has no such dependency on its length.
 */
export function buildDepotLock(c?: PushTxConstants): LockingScript {
  return new LockingScript(depotLockOps(c))
}

/**
 * The unlocking half, in the order the covenant reads it — deepest first.
 *
 * ⚠ Every value is pushed on every spend, even when a later rule will not look at it, because the
 * covenant counts POSITIONS and not arguments. A missing push shifts every depth above it, and a
 * shifted depth never reports itself: it surfaces as OP_SPLIT complaining about a size, a hundred
 * opcodes from the cause.
 */
export function depotUnlockingOps(p: {
  spenderOutputs: number[]
  newValue: number[]
  preimage: number[]
}): ScriptChunk[] {
  if (p.newValue.length !== 8) throw new Error(`newValue must be 8 bytes little-endian, got ${p.newValue.length}`)
  return [pushData(p.spenderOutputs), pushData(p.newValue), pushData(p.preimage)]
}

/** Convenience: the unlocking script itself. */
export function buildDepotUnlock(p: Parameters<typeof depotUnlockingOps>[0]): UnlockingScript {
  return new UnlockingScript(depotUnlockingOps(p))
}
