// © 2026 sun-dive — Apache License 2.0.
/**
 * ★★★ THE FRAME AROUND THE DEPOT'S BASIC — the things a program cannot say about itself.
 *
 * `racerDepotSrc.ts` holds the RULES; `compileState` turns them into a peel, a body and a rebuild.
 * This is the rest: reading the preimage, the owner's escape hatch, and binding the output. The split
 * is the one `basicCovenant.ts` names — *"the shell, the depot and the battery each answer 'what must
 * my output be?' differently. A frame generated inside the compiler would be a fourth opinion, and it
 * would be wrong for all three."*
 *
 * ── ⚠⚠⚠ THE SEQUENCE GUARD IS THE ONE LINE THE RATE LIMIT RESTS ON ────────────────────────────────
 * nLockTime is enforced by consensus ONLY while an input is non-final. A transaction whose inputs all
 * carry `nSequence = 0xffffffff` ignores nLockTime completely — so without the guard below a spender
 * names any window they please, the counter is satisfied, and the clock never binds at all.
 *
 * ⚠ `shell.ts:1101` writes this rule down — *"a tree that can be ignored is not a tree"* — and never
 * enforces it. MEASURED 19 Aug: `nSequence` is extracted nowhere in that file, which is why the
 * deployed chained car's false-start and move-spacing rules can both be walked past. **A rule written
 * in a comment is not a rule.**
 */
import { OP, LockingScript, type ScriptChunk } from '@bsv/sdk'
import { op, PN } from './covenantAsm.ts'
import { compileState, stateChunks, scriptCodeVarIntSize, type Field } from './basic.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushTxConstants, pushData, type PushTxConstants } from './pushtx.ts'
import { DEPOT_SCOPE } from './depot.ts'
import { DEPOT_SRC, DEPOT_STACK } from './racerDepotSrc.ts'
import { RACER_DRAW, RACER_DEPOT_MAX_FEE, RACER_MAX_CAR_BYTES } from './racerDepot.ts'

/** ★★ How wide one minting window is, in seconds of nLockTime. → `racers-where-we-stand.md` §6i. */
export const RACER_WINDOW_SECONDS = 600
/** ★★ How many cars one window may mint. The WIDTH is the rate limit; this is only the burst. */
export const RACER_MINTS_PER_WINDOW = 10

/**
 * ★★★ THE MOST ONE SPEND MAY COST THE TANK — **DERIVED, never written down.**
 *
 * ⚠ The runbook's standing rule is *"measure fees by SERIALIZING a real spend, never hand-count"*, and
 * that rule is for a fee which is a BOUND — a number the covenant allows and cannot check. This one is
 * not that. The script COMPUTES its fee from the car's own length, and the car's length is bounded by
 * `maxCarBytes`, so the worst case is the same expression evaluated at the bound (sun-dive, 19 Aug).
 * There is nothing to serialize: the answer is arithmetic on a rule already in the script.
 *
 * ⇒ AND THE DEPENDENCY DIRECTION IS THE POINT. `maxCarBytes` is CHOSEN — the depot decides what it is
 * willing to mint. `maxFee` follows from it. Two chosen numbers is how they came to disagree: measured
 * 19 Aug, `MAX_FEE` 3,500 allowed only a 15,601-byte car while `MAX_CAR_BYTES` claimed 16,000, so the
 * larger bound was unreachable and the smaller one bound silently.
 *
 * ⚠ Circular, because `maxFee` is a constant INSIDE the script and the script's length feeds the fee.
 * It settles in one round; this refuses rather than guessing if it ever does not.
 */
export function racerDepotMaxFee(p: { carBlock: number[]; owner: number[]; maxCarBytes?: number }): number {
  const maxCarBytes = p.maxCarBytes ?? RACER_MAX_CAR_BYTES
  let fee = RACER_DEPOT_MAX_FEE
  for (let round = 0; round < 8; round++) {
    const bytes = new LockingScript(racerDepotBasicOps({ ...p, maxFee: fee }).ops).toBinary().length
    /* The same expression the BASIC evaluates: scsize is the scriptCode FIELD, script + its varint,
       and OP_DIV TRUNCATES — the +9 folded into 267 is what rounds the fee up. */
    const next = Math.floor((2 * maxCarBytes + 2 * (bytes + 3) + 267) / 10)
    if (next === fee) return fee
    fee = next
  }
  throw new Error('racerDepotFrame: MAX_FEE did not settle — it must, in one or two rounds')
}

export interface RacerDepotBasicParams {
  /** The bytes a car must END with — `carBlockOps` from `racerCar.ts`. */
  carBlock: number[]
  /** hash160 of the owner's public key. The escape hatch, and the only key in this design. */
  owner: number[]
  /** The window this depot is minting in. **0 at genesis** — every real window is later. */
  mark?: number
  /** Mints used in that window. **0 at genesis.** */
  count?: number
  draw?: number
  maxFee?: number
  maxCarBytes?: number
  window?: number
  perWindow?: number
  c?: PushTxConstants
}

/**
 * The locking script, as ops.
 *
 * Stack the unlocking script must leave — IDENTICAL to `racerDepot.ts`, so the same `buildDepotUnlock`
 * builds it and nothing downstream has to learn a second shape.
 */
export function racerDepotBasicOps(p: RacerDepotBasicParams): { ops: ScriptChunk[]; layout: Field[] } {
  const draw = p.draw ?? RACER_DRAW
  const maxFee = p.maxFee ?? RACER_DEPOT_MAX_FEE
  const maxCarBytes = p.maxCarBytes ?? RACER_MAX_CAR_BYTES
  const windowSeconds = p.window ?? RACER_WINDOW_SECONDS
  const perWindow = p.perWindow ?? RACER_MINTS_PER_WINDOW
  const c = p.c ?? pushTxConstants(DEPOT_SCOPE)
  if (p.owner.length !== 20) throw new Error(`the owner must be a 20-byte hash160, got ${p.owner.length}`)
  if (p.carBlock.length < 32) throw new Error(`a ${p.carBlock.length}-byte tail is too little to pin`)

  const prog = compileState(DEPOT_SRC, {
    fieldOffset: 4,
    consts: {
      PERWINDOW: perWindow,
      DRAIN: draw + maxFee,
      DRAW: draw,
      MAXCAR: maxCarBytes,
      TAILLEN: p.carBlock.length,
    },
    stack: [...DEPOT_STACK],
  })

  /* Depths are read from the compiler's own model BY NAME. Counting them by hand is what this file's
     predecessor did, and it cost three bugs in one sitting. */
  const model = prog.stack.slice()
  const depth = (name: string): number => {
    const i = model.lastIndexOf(name)
    if (i < 0) throw new Error(`racerDepotFrame: the compiler's model has no '${name}' — the stack contract drifted`)
    return model.length - 1 - i
  }

  const head: ScriptChunk[] = [
    /* The state, as literal pushes — the only part of this script that differs between two instances.
       Then dropped: the script does not READ its own literals, it reads its scriptCode out of the
       preimage, which is the only copy a miner has verified. */
    ...stateChunks(prog.layout, { mark: p.mark ?? 0, n: p.count ?? 0 }),
    op(OP.OP_2DROP),
  ]

  const ops: ScriptChunk[] = [
    ...head,

    /* ── ★★ THE ESCAPE HATCH, AND IT IS FIRST ────────────────────────────────────────────────────
       Everything below constrains where satoshis may go; the owner is the one party allowed to ignore
       all of it, so the branch sits outside those rules rather than inside them. NO VALUE GATE — an
       escape hatch that only opens once there is nothing left to escape with is not an escape hatch. */
    PN(5), op(OP.OP_PICK), op(OP.OP_IF),
      PN(3), op(OP.OP_PICK), op(OP.OP_HASH160),
      pushData(p.owner), op(OP.OP_EQUALVERIFY),
      PN(4), op(OP.OP_PICK), PN(4), op(OP.OP_PICK),
      op(OP.OP_CHECKSIG), op(OP.OP_VERIFY),
      op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_2DROP), op(OP.OP_DROP),
      op(OP.OP_1),
    op(OP.OP_ELSE),

    ...pushTxVerifyOps(c),          // [ prefix, burn, sig, pub, SO, newValue, preimage ]

    /* newValue is wanted twice — RAW for the output serialization, and as a NUMBER for the arithmetic.
       Converting once and keeping both beats converting twice and hoping they agree. */
    op(OP.OP_SWAP),                                              // [ .., preimage, newValue ]
    op(OP.OP_DUP), op(OP.OP_BIN2NUM),                            // [ .., preimage, newValue, newv ]
    pushData(p.carBlock),                                        // [ .., newValue, newv, carblock ]
    /* ⚠ The varint marker as a one-BYTE literal. As a numeric constant it would be `fd 00`, because
       253 has its high bit set — and SAMEBYTES compares byte strings, so it would never match the
       single `fd` a real output carries. Measured 19 Aug: it refused every mint while every theft
       test still passed, which is what a broken happy path looks like from the outside. */
    pushData([0xfd]),                                            // [ .., newv, carblock, fdmark ]
    PN(4), op(OP.OP_ROLL),                                       // [ .., carblock, fdmark, preimage ]

    /* hashOutputs goes to the ALTSTACK, underneath everything the program will put there. The BASIC
       balances its own altstack use, so this is still the bottom entry when the binding wants it. */
    op(OP.OP_DUP), ...extractHashOutputsOps(), op(OP.OP_TOALTSTACK),          // alt:[ HO ]

    /* ── ⚠⚠⚠ THE SEQUENCE GUARD ─────────────────────────────────────────────────────────────────
       nSequence sits 44 bytes from the end of the preimage: value(8) ‖ nSequence(4) ‖ hashOutputs(32)
       ‖ nLocktime(4) ‖ sighashType(4).
       ★ Compared as RAW BYTES, never through OP_BIN2NUM: `ff ff ff ff` read as a number is
       sign-magnitude −2147483647, and a comparison that has to be reasoned about is one that will
       eventually be reasoned about wrongly.
       ★ Only OUR input needs to be non-final — a transaction is final only when EVERY input is. */
    op(OP.OP_DUP),
    op(OP.OP_SIZE), PN(44), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    PN(4), op(OP.OP_SPLIT), op(OP.OP_DROP),
    pushData([0xff, 0xff, 0xff, 0xff]), op(OP.OP_EQUAL), op(OP.OP_NOT), op(OP.OP_VERIFY),

    /* ── THE CLOCK, DIVIDED INTO A WINDOW INDEX AT ONCE ──────────────────────────────────────────
       nLockTime sits 8 bytes from the end. Dividing here means the raw stamp is never handled again,
       and every second inside a window maps to one index — which is what leaves mints 2…10 six hundred
       nLockTime values to grind LOW_S with. */
    op(OP.OP_DUP),
    op(OP.OP_SIZE), PN(8), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    PN(4), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM),
    PN(windowSeconds), op(OP.OP_DIV),                            // [ .., carblock, preimage, window ]
    op(OP.OP_SWAP),                                              // [ .., carblock, window, preimage ]

    /* Its own balance — 52 bytes from the end, the only place it can be read honestly. */
    op(OP.OP_DUP),
    op(OP.OP_SIZE), PN(52), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    PN(8), op(OP.OP_SPLIT), op(OP.OP_DROP), op(OP.OP_BIN2NUM),   // [ .., window, preimage, V ]
    op(OP.OP_SWAP),                                              // [ .., window, V, preimage ]

    ...extractScriptCodeFieldOps(),                              // [ .., window, V, scriptCodeField ]
    op(OP.OP_DUP), op(OP.OP_SIZE), op(OP.OP_NIP),                // [ .., V, scField, scsize ]
    op(OP.OP_SWAP),                                              // [ .., V, scsize, scField ]

    /* ── ★★★ THE RULES, FROM BITCOIN BASIC ──────────────────────────────────────────────────────*/
    ...prog.ops,
  ]

  /* ── AND BIND IT ────────────────────────────────────────────────────────────────────────────────
     out_depot = value(8) ‖ varint ‖ script — and the rebuilt scriptCode FIELD already carries its own
     varint, which is exactly why `extractScriptCodeFieldOps` hands back the field rather than the
     script. Then the CAR in front (it takes out0, its own covenant insists on it), then the spender's
     own outputs, then the hash the miner committed to. */
  ops.push(
    PN(depth('newValue')), op(OP.OP_PICK), op(OP.OP_SWAP), op(OP.OP_CAT),
    PN(depth('prefixOutputs')), op(OP.OP_PICK), op(OP.OP_SWAP), op(OP.OP_CAT),
    PN(depth('spenderOutputs')), op(OP.OP_PICK), op(OP.OP_CAT),
    op(OP.OP_HASH256), op(OP.OP_FROMALTSTACK), op(OP.OP_EQUAL),
  )

  /* A standard spend finishes with ONE true value and nothing else. The program's temporaries are all
     still sitting there, so they come off — counted from the compiler's model, never by hand.
     ⚠⚠ `model.length − 1`, and the −1 is the whole lesson. Every PICK adds one and every CAT takes it
     back, so the binding leaves the stack EXACTLY as long as the model, with the boolean on top. The
     first version emitted `model.length` NIPs, which is one more than there is stack, and `OP_NIP` on a
     one-item stack fails — so every legitimate mint was refused while every theft test still passed.
     ⇒ A suite where only the NEGATIVE checks pass is not eight-out-of-twelve; it is a script that
     always fails, wearing a costume. */
  for (let i = 0; i < model.length - 1; i++) ops.push(op(OP.OP_NIP))
  ops.push(op(OP.OP_ENDIF))
  return { ops, layout: prog.layout }
}

/**
 * ⚠⚠ THE CIRCULAR OFFSET, RESOLVED THE ONLY WAY IT CAN BE. `fieldOffset` is where field zero's DATA
 * begins inside the scriptCode, and BIP143 puts the scriptCode's own varint LENGTH in front of it — so
 * the offset depends on how long the finished script is, and the script is not finished while you are
 * computing it. Build once with a probe, measure, build again, and REFUSE if it does not settle.
 */
export function buildRacerDepotBasicLock(p: RacerDepotBasicParams): LockingScript {
  /* ★ MAX_FEE is DERIVED from maxCarBytes unless the caller pins it, so the two can never drift apart
     the way they did when both were written down. */
  const withFee = { ...p, maxFee: p.maxFee ?? racerDepotMaxFee(p) }
  let ops = racerDepotBasicOps(withFee).ops
  for (let round = 0; round < 6; round++) {
    const len = new LockingScript(ops).toBinary().length
    const next = racerDepotBasicOps(withFee).ops
    if (new LockingScript(next).toBinary().length === len) return new LockingScript(next)
    ops = next
  }
  throw new Error('racerDepotFrame: the script length did not settle')
}

/** What `scriptCodeVarIntSize` says about a script of this length — exported so tests can pin it. */
export const depotVarIntSize = scriptCodeVarIntSize

/**
 * ★★ THE DEPOT'S STATE, READ OFF ITS OWN SCRIPT — the only honest source.
 *
 * The head is `04 mark(4) 01 n(1)`, all fixed width, so this is two slices and no parsing. A page must
 * read the state from the script it is about to spend, never from something it remembers: the depot is
 * a chain, and anybody may have advanced it since the page loaded.
 *
 * ⚠ Read at flat offsets a state layout yields plausible nonsense rather than an error, which is why
 * the two marker bytes are checked rather than assumed.
 */
export function readDepotState(script: number[]): { mark: number; count: number } {
  if (script[0] !== MARK_BYTES || script[1 + MARK_BYTES] !== COUNT_BYTES) {
    throw new Error('racerDepot: that output does not carry a one-race depot state head ' +
      `(expected ${MARK_BYTES} … ${COUNT_BYTES}, got ${script[0]} … ${script[1 + MARK_BYTES]})`)
  }
  const mark = script[1] | (script[2] << 8) | (script[3] << 16) | (script[4] << 24)
  return { mark, count: script[1 + MARK_BYTES + 1] }
}

/** `mark` is four bytes; `n` is one. Kept here so the reader and the writer cannot drift apart. */
export const MARK_BYTES = 4
export const COUNT_BYTES = 1
