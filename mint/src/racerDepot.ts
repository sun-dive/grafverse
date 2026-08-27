// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
/**
 * ★★★ THE DEPOT THAT MINTS ONE-RACE CARS.
 *
 * A sibling to `depot.ts`, not a replacement for it: that one fuels a CHAINED car that persists and is
 * refuelled, and it is deployed. This one serves a car that is born, races once and dies — so "fuel a
 * car" and "mint a car" are the same act, and the depot does both. (`racers-where-we-stand.md` §5
 * records why that retires a rule written down two days earlier, and why it is not the failure
 * RACERS.md warns about: the design premise changed, rather than a spec being bent to fit a build.)
 *
 * ```
 *   MINT    depot(V) → depot(V − paid) + car(paid)      the car gets out0, the depot follows
 *   RACE    car → depot(V − fee)                        keyless, the car's own business
 *   BURN    the owner, with no gate                     the escape hatch
 * ```
 *
 * ── ★ WHAT IT ASKS OF A CAR, AND IT IS ONLY ONE QUESTION ──────────────────────────────────────────
 * **"Will these satoshis come back to me?"** A one-race car has no shape to pin — its script IS the
 * race, so its length is its time and no two are alike — and it does not need one. The answer lives
 * entirely in the car's last bytes, and `carTailRecognitionOps` compares them by splitting from the
 * RIGHT. See there for why free bytes in front are safe HERE and are not safe for a chained car.
 *
 * ── ⚠⚠ THE OWNER BURN IS UNGATED, AND THAT IS DELIBERATE ──────────────────────────────────────────
 * `depot.ts` gates its burn below `DEPOT_BURN_BELOW` (1,241 sat), so a funded depot cannot be swept by
 * its own owner. That bought a promise to donors — and its own note is honest that "there are no donors
 * yet… if donors never arrive it is paying for nothing".
 *
 * ⇒ It also blocks the exact case that has already cost this project real money: **15,000 satoshis
 * stranded when a key existed in neither hand, because of a bug.** An escape hatch that only opens once
 * there is nothing left to escape with is not an escape hatch. **Things go wrong, and when they do
 * there has to be a way out** (sun-dive, 18 Aug).
 *
 * ⇒ The cost is stated plainly rather than hidden: **the owner can sweep this tank at any time.** A page
 * that ever asks for donations must say so. Re-gate it in a later depot if donors arrive — a depot is
 * equipment, and equipment is meant to be replaceable.
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { op, PN } from './covenantAsm.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants } from './pushtx.ts'
import { extractValueOps, carTailRecognitionOps, DEPOT_SCOPE } from './depot.ts'

/**
 * ★★ THE LONGEST CAR THIS DEPOT WILL MINT — a CHOSEN parameter, not a measurement.
 *
 * The depot mints, so it decides what it is willing to mint, and that is what makes `MAX_FEE`
 * derivable: the mint carries the car's script, so the mint's size scales with it.
 *
 * ⇒ It does NOT have to cover every extreme configuration — only normal play, because extremes never
 * get raced. And the design self-selects: a slower car is a longer script and a bigger fee, so the
 * bound only ever binds on cars nobody wants. 16,000 B is 67 ticks — 6.7 s against a 6.00 s reference
 * quarter mile and a 3.9 s theoretical best.
 */
export const RACER_MAX_CAR_BYTES = 16_000

/**
 * The most one mint may hand a car.
 *
 * ★ MUCH SMALLER THAN THE CHAINED DEPOT'S 20,000, and the reason is the whole redesign: fuel stopped
 * being satoshis when the fee left the loop. A car needs its own race fee and one satoshi — nothing
 * more — and the largest car this depot will mint pays about 1,711.
 */
export const RACER_DRAW = 2_000

/**
 * ⚠⚠ THE MOST ONE SPEND MAY COST THE TANK — permanent, and there is no key to raise it.
 *
 * ⚠ DERIVE IT WITH `racerDepotFee`, WHICH SERIALIZES A WORST-CASE MINT. Never hand-count: this project
 * has stood on an unmineable bound five times, and once on a fee measured against the wrong
 * transaction entirely (`DEPOT_MAX_FEE` 516, derived from a draw when the real spend was a refuel).
 *
 * ★ AND IT IS THE GRIEFING SURFACE. Anyone may mint, so anyone may force the worst case — see
 * `racers-where-we-stand.md` §6f. Size the tank against this number, not against a typical mint.
 */
export const RACER_DEPOT_MAX_FEE = 3_500

export interface RacerDepotParams {
  /** The bytes a car must END with — `carBlockOps` from `racerCar.ts`, which is constant per depot. */
  carBlock: number[]
  /** hash160 of the owner's public key. The escape hatch, and the only key in this design. */
  owner: number[]
  draw?: number
  maxFee?: number
  maxCarBytes?: number
  c?: PushTxConstants
}

/**
 * The locking script, as ops.
 *
 * Stack the unlocking script must leave, bottom first — IDENTICAL to `depot.ts`, so the same
 * `buildDepotUnlock` builds it:
 * ```
 *   prefixOutputs   the outputs BEFORE the depot's own — the car, on a mint; empty on a top-up
 *   burn            1 to take the owner's branch, 0 otherwise
 *   sig · pubKey    the owner's, on a burn; anything on a mint
 *   spenderOutputs  the outputs after the depot's
 *   newValue        8 bytes LE — what the depot's successor will carry
 *   preimage        the sighash preimage
 * ```
 */
export function racerDepotLockOps(p: RacerDepotParams): ScriptChunk[] {
  const draw = p.draw ?? RACER_DRAW
  const maxFee = p.maxFee ?? RACER_DEPOT_MAX_FEE
  const maxCarBytes = p.maxCarBytes ?? RACER_MAX_CAR_BYTES
  const c = p.c ?? pushTxConstants(DEPOT_SCOPE)
  if (p.owner.length !== 20) throw new Error(`the owner must be a 20-byte hash160, got ${p.owner.length}`)

  /* ★ THE MOST A SINGLE SPEND MAY COST THE TANK — one number, so there is one place to be wrong.
     ⚠ `depot.ts` says of its own version that "whether a satoshi left as fuel or as a miner's fee is
     not the depot's business", and that is why ITS MAX_FEE is extractable — 844 sat per spend, to
     anyone, measured. This depot DOES know the difference, because when value leaves it permits no
     output but the car and itself: anything unaccounted for went to a miner. */
  const drain = draw + maxFee

  return [
    /* ── ★★ THE ESCAPE HATCH, AND IT IS FIRST ────────────────────────────────────────────────────
       Everything below constrains where satoshis may go; the owner is the one party allowed to ignore
       all of it, so the branch sits outside those rules rather than inside them.

       ⚠ NO VALUE GATE. See the note at the top of this file: `depot.ts` refuses to burn a tank holding
       more than 1,241 satoshis, which is exactly the case that has already stranded money here.

       It enforces NO OUTPUTS, as PharLap's editions do: a SIGHASH_ALL signature already commits to
       every one of them, so by signing the owner has said where the money goes and there is nothing
       left for a covenant to check. */
    PN(5), op(OP.OP_PICK), op(OP.OP_IF),
      PN(3), op(OP.OP_PICK), op(OP.OP_HASH160),
      pushData(p.owner), op(OP.OP_EQUALVERIFY),          // the key offered must be THE owner's
      PN(4), op(OP.OP_PICK), PN(4), op(OP.OP_PICK),      // the signature, and the key again
      op(OP.OP_CHECKSIG), op(OP.OP_VERIFY),
      op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP),
      op(OP.OP_1),
    op(OP.OP_ELSE),

    ...pushTxVerifyOps(c),                  // [ PRE, burn, sig, pub, SO, newV, preimage ]

    /* Read its own balance while the preimage is whole, and stash it — there are no branches below
       this point, so the altstack cannot get out of step between arms. */
    op(OP.OP_DUP), ...extractValueOps(), op(OP.OP_BIN2NUM), op(OP.OP_TOALTSTACK),   // alt:[V]

    op(OP.OP_DUP), ...extractHashOutputsOps(), op(OP.OP_SWAP),   // [ .., hashOutputs, preimage ]
    ...extractScriptCodeFieldOps(),                              // [ .., hashOutputs, scriptCodeField ]


    /* ── ★ THE VALUE FLOOR — out0 ≥ V − (DRAW + MAX_FEE) ─────────────────────────────────────────
       A FLOOR and not an equality, which is what makes a top-up free: anyone may hand back MORE than
       they took and the covenant is satisfied. The battery's funding mechanism, inherited for nothing. */
    PN(2), op(OP.OP_PICK), op(OP.OP_BIN2NUM),   // [ .., scField, myNewValue ]
    op(OP.OP_FROMALTSTACK),                     // [ .., myNewValue, V ]     alt empty

    /* ⚠ DID ANYTHING ACTUALLY LEAVE? Stashed before the floor consumes both numbers. This is the
       difference between "every spend must mint a car" — which would force a plain DONATION to mint one,
       absurdly — and the rule that is wanted: whatever LEAVES must land in a car. */
    op(OP.OP_2DUP), op(OP.OP_SWAP), op(OP.OP_SUB), op(OP.OP_TOALTSTACK),   // alt:[left = V − out0]
    op(OP.OP_2DUP), op(OP.OP_LESSTHAN), op(OP.OP_TOALTSTACK),              // alt:[left, anythingLeft]

    PN(drain), op(OP.OP_SUB),
    op(OP.OP_GREATERTHANOREQUAL), op(OP.OP_VERIFY),

    /* ── ★ AND IF IT DID, THE OUTPUT BEFORE THIS ONE IS A CAR ────────────────────────────────────
       The car is the FIRST entry of prefixOutputs — out0, the slot its own covenant insists on. */
    op(OP.OP_FROMALTSTACK),
    op(OP.OP_IF),
      /* ── ★★★ AND NOTHING ELSE MAY BE PAID. THIS IS WHAT MAKES THE FEE A FEE ───────────────────
         Without it the fee allowance is EXTRACTABLE, and measurably so: set out_depot to V − MAX_FEE,
         hand the car one satoshi, and put the difference in a third output to yourself. Both rules
         above pass — the floor is satisfied, and `carValue ≥ left − MAX_FEE` is satisfied trivially
         because `left` IS MAX_FEE. The deployed depot has the same hole, bounded at 844 sat; here it
         would be 3,500, because a 16 KB car makes a 34 KB mint.

         ⇒ A MINT NEEDS EXACTLY TWO OUTPUTS: the car, and the depot. The depot IS the change. So when
         value leaves, forbid everything else — and then the only place an unaccounted satoshi can go
         is a MINER. Paying a miner is not extraction, because you do not get it.

         ★ **The only spend operation is running down the track** (sun-dive, 18 Aug), and this is the
         line that makes that literally true rather than nearly true.

         ⚠ Only on THIS branch. A top-up brings its own funding input and may well want change, and it
         takes nothing from the tank — so it is none of the depot's business. */
      PN(3), op(OP.OP_PICK), op(OP.OP_SIZE), op(OP.OP_NIP),
      PN(0), op(OP.OP_NUMEQUALVERIFY),

      PN(7), op(OP.OP_PICK),                              // a copy of prefixOutputs
      ...carTailRecognitionOps(p.carBlock, maxCarBytes),  // alt:[ left, carValue ]

      /* ★ A CEILING ON WHAT ONE CAR MAY HOLD. A car needs its own race fee and one satoshi; anything
         beyond that is satoshis walking out of the tank in a shape the depot cannot follow. */
      op(OP.OP_FROMALTSTACK),                             // [ .., carBytes ]
      op(OP.OP_FROMALTSTACK),                             // [ .., carBytes, carValue ]
      op(OP.OP_DUP), PN(draw), op(OP.OP_LESSTHANOREQUAL), op(OP.OP_VERIFY),

      /* ── ★★ AND WHAT LEFT THE DEPOT MUST ARRIVE ───────────────────────────────────────────────
         carValue ≥ (V − out_depot) − MAX_FEE. **Without this the depot is not a tank but a faucet**:
         take a full draw, hand the car ONE SATOSHI, and send the difference to yourself. `depot.ts`
         records that as measured rather than feared — its covenant accepted exactly that transaction
         before the line existed — so it is measured here too, in `racer-depot.ts`.

         ⚠ It cannot be enforced at the page. An attacker does not use the page; they build the
         transaction by hand, and the covenant is the only thing standing there. */
      op(OP.OP_FROMALTSTACK),                             // [ .., scField, carBytes, carValue, left ]

      /* ⚠⚠ ITS OWN SIZE IS READ FROM THE MAIN STACK, NOT THE ALTSTACK. The first version stashed it
         with `OP_TOALTSTACK` — on top of the `V` that was already there — so the read meant to fetch
         the depot's BALANCE fetched the script size instead, and every comparison below ran on
         nonsense and passed. `scriptCodeField` is still sitting right here; there was never a reason
         to move it. ⇒ An altstack is a place to lose track of what you put on it. */
      PN(3), op(OP.OP_PICK), op(OP.OP_SIZE), op(OP.OP_NIP),   // [ .., carValue, left, scSize ]

      /* ── ★★★ IT WORKS OUT WHAT THE MINT COSTS AND DEMANDS THE REST BACK ─────────────────────────
         `left ≤ carValue + fee`, where **fee is COMPUTED, not allowed**:

             mint bytes = 2·carBytes + 2·depotBytes + 264     measured, exactly linear
             fee        = ceil(bytes / 10)                    at the 100 sat/KB floor

         ⚠⚠ WHY THIS REPLACED A CONSTANT. With `left ≤ carValue + MAX_FEE`, a spender may burn the
         whole allowance on a miner: keep V − MAX_FEE, hand the car a satoshi, and the difference is
         gone. Forbidding a third output stopped them POCKETING it — it did not stop them DESTROYING
         it. **An extraction attempt should not even pay a miner; it should repay the depot**
         (sun-dive, 18 Aug). Now it does: anything above the true cost has nowhere to go but out0.

         ⚠ `scSize` is depotBytes + 3, so 2·scSize carries a surplus 6, and +9 rounds the division up
         — hence 267 rather than 264. `OP_DIV` truncates toward zero, and a fee that rounds DOWN is a
         mint nobody can broadcast. */
      PN(2), op(OP.OP_MUL), PN(267), op(OP.OP_ADD),       // [ .., carValue, left, 2·scSize + 267 ]
      PN(3), op(OP.OP_ROLL), PN(2), op(OP.OP_MUL),        // [ carValue, left, …, 2·carBytes ]
      op(OP.OP_ADD), PN(10), op(OP.OP_DIV),               // [ carValue, left, fee ]
      PN(2), op(OP.OP_ROLL), op(OP.OP_ADD),               // [ left, carValue + fee ]
      op(OP.OP_LESSTHANOREQUAL), op(OP.OP_VERIFY),
    op(OP.OP_ELSE),
      /* ⚠ THE ALTSTACK MUST COME OUT EVEN. `left` was pushed before the branch, so an arm that does not
         take it back leaves the two paths silently out of step. */
      op(OP.OP_FROMALTSTACK), op(OP.OP_DROP),
    op(OP.OP_ENDIF),

    /* Rebuild out_depot as an output serialization: value(8) ‖ varint(len) ‖ script. `scriptCodeField`
       already carries its own length varint, so no length has to be computed and none can be wrong. */
    PN(2), op(OP.OP_ROLL),
    op(OP.OP_SWAP), op(OP.OP_CAT),

    /* ★ AND THE PREFIX GOES IN FRONT — the one line that lets the CAR have output zero, which its own
       covenant insists on. Empty prefix ⇒ this is a no-op and the depot sits at out0, so a top-up and a
       burn did not change behaviour when the prefix was introduced, only notation. */
    PN(6), op(OP.OP_ROLL),
    op(OP.OP_SWAP), op(OP.OP_CAT),

    PN(2), op(OP.OP_ROLL),
    op(OP.OP_CAT),
    op(OP.OP_HASH256),
    op(OP.OP_EQUAL),

    /* The three burn pushes must not be left lying there — a standard spend finishes with one true
       value and nothing else. */
    op(OP.OP_NIP), op(OP.OP_NIP), op(OP.OP_NIP),
    op(OP.OP_ENDIF),
  ]
}

/** The depot's locking script. ONE PASS — it carries no state, so it has no dependency on its length. */
export function buildRacerDepotLock(p: RacerDepotParams): LockingScript {
  return new LockingScript(racerDepotLockOps(p))
}
