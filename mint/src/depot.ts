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
import { OP, Hash, LockingScript, UnlockingScript, type ScriptChunk } from '@bsv/sdk'
import {
  pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants,
} from './pushtx.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { op, PN } from './covenantAsm.ts'

/** A byte-count for OP_SPLIT — always small, and never a script NUMBER. Kept apart from `PN` on purpose. */
const AT = (n: number): ScriptChunk => pushData([n])

/**
 * Op fragment: consumes a verified preimage and leaves this input's own VALUE (8 bytes, little-endian).
 *
 * ⚠ The value sits 52 bytes from the end: the trailing 52 are
 * value(8) ‖ nSequence(4) ‖ hashOutputs(32) ‖ nLocktime(4) ‖ sighashType(4). A fixed offset from the
 * END, because the scriptCode in front of it is not a fixed length.
 *
 * ★ This is how a covenant knows its own balance. It is not told — it reads it out of the transaction
 * it is being asked to authorise, which is the only figure it can trust.
 */
export function extractValueOps(): ScriptChunk[] {
  return [
    op(OP.OP_SIZE), AT(52), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),   // tail 52 bytes
    AT(8), op(OP.OP_SPLIT), op(OP.OP_DROP),                                   // first 8 = value
  ]
}

/** SIGHASH_ALL | FORKID. hashOutputs must be REAL, so ANYONECANPAY is not available to this covenant. */
export const DEPOT_SCOPE = 0x41

/**
 * ★ DRAW — the most fuel one spend may move out of the tank.
 *
 * A policy, not a law of the covenant: it bounds how fast a depot can be emptied, and the only place
 * that fuel is allowed to go is a car. Sized from measurement — a quarter mile consumed 43,581 sat on
 * the bench, so one draw is one full race with a little room.
 */
export const DEPOT_DRAW = 50_000

/** ⚠ PROVISIONAL until step 5 measures it by SERIALIZING a real spend. Never counted by hand. */
export const DEPOT_MAX_FEE = 500

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
export function depotLockOps(
  p: { carScript: number[]; draw?: number; maxFee?: number; c?: PushTxConstants },
): ScriptChunk[] {
  const draw = p.draw ?? DEPOT_DRAW
  const maxFee = p.maxFee ?? DEPOT_MAX_FEE
  const c = p.c ?? pushTxConstants(DEPOT_SCOPE)

  /* ★ THE CAR, AS ONE HASH. An output serializes as value(8) ‖ varint(len) ‖ script, so everything
     after the value is a fixed blob for a script of known length — and a public car at rest IS of
     known length and known content. That is what step 1's reset was arranged to make true: a car
     between races is byte-identical to one freshly minted, so the depot never parses an output. It
     splits at two fixed offsets and compares one hash. */
  const carField = [...varint(p.carScript.length), ...p.carScript]
  const carHash = Hash.sha256(carField)

  /* ★ THE MOST A SINGLE SPEND MAY COST THE TANK. One number, so there is one place to be wrong and
     one place to change it — and the covenant never learns them apart, which is the point: whether a
     satoshi left as fuel or as a miner's fee is not the depot's business. */
  const drain = draw + maxFee

  return [
    ...pushTxVerifyOps(c),                  // [ SO, newV, preimage ]           ← the preimage is real

    /* ★ READ ITS OWN BALANCE FIRST, while the preimage is still whole. Stashed on the altstack so the
       frame below is untouched — and there are no branches in this script, so the altstack cannot get
       out of step between arms the way it can in the shell. */
    op(OP.OP_DUP),                          // [ SO, newV, pre, pre ]
    ...extractValueOps(),                   // [ SO, newV, pre, V ]
    op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK), // alt:[V]  ·  [ SO, newV, pre ]

    op(OP.OP_DUP),                          // [ SO, newV, pre, pre ]
    ...extractHashOutputsOps(),             // [ SO, newV, pre, hashOutputs ]
    op(OP.OP_SWAP),                         // [ SO, newV, hashOutputs, pre ]
    ...extractScriptCodeFieldOps(),         // [ SO, newV, hashOutputs, scriptCodeField ]

    /* ── ★ THE VALUE FLOOR ────────────────────────────────────────────────────────────────────────
       out0 ≥ V − (DRAW + MAX_FEE). A FLOOR and not an equality, which is what makes a top-up free:
       anyone may hand back MORE than they took and the covenant is satisfied. The battery's whole
       funding mechanism is this one comparison, and the depot inherits it for nothing. */
    PN(2), op(OP.OP_PICK), op(OP.OP_BIN2NUM),  // [ .., scField, out0value ]
    op(OP.OP_FROMALTSTACK),                    // [ .., out0value, V ]      alt empty

    /* ⚠ DID ANY FUEL ACTUALLY LEAVE? Stashed before the floor consumes both numbers.
       This is the difference between "the depot must always mint a car" — which would force a plain
       DONATION to mint one too, absurdly — and the rule that is actually wanted:

           ★ whatever leaves the depot must go to a car. If nothing leaves, nothing is required.

       A top-up therefore stays what it was in step 3a: a spend that hands back more and is asked for
       nothing else. */
    op(OP.OP_2DUP), op(OP.OP_LESSTHAN), op(OP.OP_TOALTSTACK),   // alt:[fuelLeft]

    PN(drain), op(OP.OP_SUB),                  // [ .., out0value, floor ]
    op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),   // [ SO, newV, hashOutputs, scriptCodeField ]

    /* ── ★ AND IF FUEL LEFT, out1 IS A CAR ────────────────────────────────────────────────────────
       out1 is the first entry of spenderOutputs. Split off its 8-byte value, take the next
       `carField.length` bytes, hash them, and require the constant. Nothing is parsed and nothing is
       trusted: if the output is shorter than a car, OP_SPLIT fails and the spend dies. */
    op(OP.OP_FROMALTSTACK),                    // [ .., scField, fuelLeft ]
    op(OP.OP_IF),
      PN(3), op(OP.OP_PICK),                   // a copy of spenderOutputs
      AT(8), op(OP.OP_SPLIT), op(OP.OP_NIP),   // drop out1's value
      PN(carField.length), op(OP.OP_SPLIT), op(OP.OP_DROP),   // exactly one car's worth
      op(OP.OP_SHA256), pushData(carHash), op(OP.OP_EQUALVERIFY),
    op(OP.OP_ENDIF),

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
export function buildDepotLock(p: Parameters<typeof depotLockOps>[0]): LockingScript {
  return new LockingScript(depotLockOps(p))
}

/** Bitcoin's variable-length integer, for the length prefix an output carries before its script. */
export function varint(n: number): number[] {
  if (n < 0xfd) return [n]
  if (n <= 0xffff) return [0xfd, n & 0xff, (n >> 8) & 0xff]
  return [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
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
