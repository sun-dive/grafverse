// © 2026 sun-dive — Apache License 2.0.
/**
 * ★ PUTTING SATS IN THE TANK — the transaction builder behind the contribute button.
 *
 * Mirrors `batteryTx.ts`, for the same reason and with the same shape: the page assembles the whole
 * transaction, leaves the contributor's input BLANK, and stops. It holds no key, signs nothing and
 * broadcasts nothing.
 *
 * ── ★ WHY A TOP-UP IS LEGAL AT ALL ────────────────────────────────────────────────────────────────
 * The depot's value rule is a FLOOR — `out0 ≥ V − DRAW − MAX_FEE` — so handing back MORE than was
 * taken was always allowed. And the rule that a car must receive what leaves is gated on fuel actually
 * LEAVING, so on a top-up that branch never runs and `out1` may be the contributor's own change.
 * Both measured through the interpreter in `depot-topup`, not inferred from the comments.
 *
 * ⇒ Which is the battery's property restated: **bounded on the way out, unbounded on the way in.**
 *
 * ── ✗ "ONE COIN, NOT A BALANCE" WAS WRONG, AND IT WAS THE REASON MORE THAN THE RULE ────────────────
 * This used to take exactly one funding coin and explain it as *"a covenant spend takes exactly one
 * funding input"*. That is not true of any covenant here. **The depot never looks at inputs at all** —
 * `hashPrevouts` does not appear in `depot.ts` even once. It checks its own preimage, the value floor,
 * the car rule, and that the outputs rebuild to `hashOutputs`.
 *
 * ⇒ THE REAL CONSTRAINT IS WEAKER: the depot's unlocking script EMBEDS its preimage, and that preimage
 * commits to `hashPrevouts` and `hashSequence` — every input's outpoint. So the input SET must be FINAL
 * before the covenant's input is built. **Known in advance, not singular.** Add every funding coin up
 * front and the covenant's half stays valid; the contributor signs several blanks instead of one.
 *
 * ⚠ Which turned a builder's convenience into a wallet-shaped problem: a contributor holding plenty
 * across several coins was told to go and pay themselves first. sun-dive, 16 Aug: *"it is a bad UX."*
 *
 * ⚠ AND THE PAD MUST SCALE WITH THEM. `TOPUP_FEE_PAD` was measured for ONE input and its change; each
 * extra input is another ~148 bytes of transaction to pay for. A fixed pad with three coins underpays,
 * which is the relay floor all over again — so it is per-input, and `depot-topup-tx` serializes real
 * multi-coin top-ups and checks the rate rather than trusting the arithmetic.
 */
import { Transaction, P2PKH, TransactionSignature, LockingScript, OP, Utils } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_MAX_FEE } from './depot.ts'

/** Enough to cover the contributor's first input and their change, at the official rate. Measured. */
export const TOPUP_FEE_PAD = 300

/**
 * What each ADDITIONAL funding coin adds to the pad. A P2PKH input serializes to ~148 bytes — 32 txid,
 * 4 index, 1 length, ~107 script, 4 sequence — which is ~15 satoshis at 100 sat/KB, rounded up to 20
 * because underpaying is unrelayable and overpaying by five is nothing.
 */
export const TOPUP_INPUT_PAD = 20

/** The fee pad for a top-up funded by `n` coins. One number, so the guard and the change agree. */
export const topUpPad = (n: number): number => TOPUP_FEE_PAD + Math.max(0, n - 1) * TOPUP_INPUT_PAD

const u64 = (n: number): number[] => {
  const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}

export interface TopUpParams {
  /** The depot as it stands: its source transaction, which output, and what it holds. */
  depot: { sourceTransaction: Transaction; outputIndex: number; value: number }
  /** The car script this depot was born knowing — the lock is rebuilt from it, never copied. */
  carScript: number[]
  owner: number[]
  addSats: number
  /**
   * The contributor's coins. One or several — together they must cover `addSats + topUpPad(n)`.
   * ⚠ ALL of them are added before the covenant's input is built, because its preimage commits to
   * every outpoint. A coin added afterwards invalidates the depot's half.
   */
  funder: { sourceTransaction: Transaction; outputIndex: number }
    | Array<{ sourceTransaction: Transaction; outputIndex: number }>
  changeAddress: string
  /** An optional mark, written to an OP_RETURN — the contributor's line on the board. */
  mark?: string | null
}

/**
 * Build it, and leave the contributor's blank.
 *
 * ⚠ The depot's own input is ALREADY COMPLETE when this returns. OP_PUSH_TX authorises it with a proof
 * about the transaction itself, so there is no key for it anywhere — not held by the page, not held by
 * the contributor, not held by the owner. The only blank in the whole thing is input #2.
 */
export function buildDepotTopUpTx(p: TopUpParams): Transaction {
  const depotLock = buildDepotLock({ carScript: p.carScript, owner: p.owner })
  const onChain = p.depot.sourceTransaction.outputs[p.depot.outputIndex]
  if (!onChain || Utils.toHex(onChain.lockingScript.toBinary()) !== depotLock.toHex()) {
    throw new Error('that outpoint is not this depot — wrong txid, wrong output, or a different owner key')
  }
  const coins = Array.isArray(p.funder) ? p.funder : [p.funder]
  if (coins.length === 0) throw new Error('a top-up needs at least one funding coin')
  const funded = coins.reduce((a, c) => a + (c.sourceTransaction.outputs[c.outputIndex]?.satoshis ?? 0), 0)
  const pad = topUpPad(coins.length)
  if (funded < p.addSats + pad) {
    throw new Error(`these ${coins.length} coin(s) must cover ${(p.addSats + pad).toLocaleString()} sat; ` +
      `they hold ${funded.toLocaleString()}`)
  }

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: p.depot.sourceTransaction, sourceOutputIndex: p.depot.outputIndex,
                sequence: 0xfffffffe })
  /* ⚠ EVERY funding coin goes in HERE, before the covenant's unlocking script is built below — its
     preimage commits to all of their outpoints. Left BLANK; the contributor fills them. */
  for (const c of coins) {
    tx.addInput({ sourceTransaction: c.sourceTransaction, sourceOutputIndex: c.outputIndex,
                  sequence: 0xffffffff })
  }

  tx.addOutput({ lockingScript: depotLock, satoshis: p.depot.value + p.addSats })   // out0 — the tank, fuller
  if (p.mark) {
    /* The mark rides in an OP_RETURN, exactly as the battery's board marks do. It is not state and the
       covenant never reads it — out1 onwards are unconstrained on a top-up, because no fuel left. */
    const m = Utils.toArray(p.mark, 'utf8')
    if (m.length > 75) throw new Error(`the mark is ${m.length} bytes; keep it under 76`)
    tx.addOutput({ lockingScript: new LockingScript([
      { op: OP.OP_FALSE }, { op: OP.OP_RETURN }, { op: m.length, data: m },
    ]), satoshis: 0 })
  }
  const change = funded - p.addSats - pad
  if (change > 0) tx.addOutput({ lockingScript: new P2PKH().lock(p.changeAddress), satoshis: change })

  /* The covenant's half, complete and keyless. Its preimage commits to every output above, so the
     contributor cannot alter one after the fact without invalidating this. */
  const pre = TransactionSignature.format({
    sourceTXID: p.depot.sourceTransaction.id('hex'), sourceOutputIndex: p.depot.outputIndex,
    sourceSatoshis: p.depot.value, transactionVersion: 2, otherInputs: tx.inputs.slice(1), inputIndex: 0,
    outputs: tx.outputs, inputSequence: 0xfffffffe, subscript: depotLock, lockTime: 0, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOut(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(p.depot.value + p.addSats), preimage: pre,
  })
  return tx
}

/** value(8) ‖ varint(len) ‖ script — the serialization every covenant here hashes outputs with. */
function serializeOut(satoshis: number, script: number[]): number[] {
  const n = script.length
  const varint = n < 0xfd ? [n] : n <= 0xffff ? [0xfd, n & 0xff, n >> 8]
    : [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
  return [...u64(satoshis), ...varint, ...script]
}

/**
 * ★ WHAT CROSSES THE GAP IS A REQUEST, NOT A TRANSACTION.
 *
 * A signer that rubber-stamps a page's transaction has to trust the page. One that receives a REQUEST
 * rebuilds it and signs what IT built — so nothing the page produced is used, only the outpoints it
 * names, and every one of those is checkable against the chain. Same shape as PharLap's air-gap, for
 * exactly the same reason.
 */
export interface TopUpRequest {
  v: 1
  action: 'depot-topup'
  depot: { txId: string; outputIndex: number; satoshis: number; sourceTxHex: string }
  funding: { txId: string; outputIndex: number; satoshis: number; sourceTxHex: string }
  carScriptHex: string
  ownerHex: string
  addSats: number
  mark?: string | null
  changeAddress: string
}
