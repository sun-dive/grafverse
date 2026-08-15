// © BSV Association — Open BSV License v6.
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
 * ── ⚠ ONE COIN, NOT A BALANCE ─────────────────────────────────────────────────────────────────────
 * A covenant spend takes exactly one funding input, so the contributor needs ONE utxo covering the
 * amount plus the fee. Two payments of half do not merge, and a wallet showing plenty across several
 * coins will still fail. The page must say so before it builds, not after.
 */
import { Transaction, P2PKH, TransactionSignature, LockingScript, OP, Utils } from '@bsv/sdk'
import { buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_MAX_FEE } from './depot.ts'

/** Enough to cover the contributor's own input and change at the official rate. Measured, not guessed. */
export const TOPUP_FEE_PAD = 300

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
  /** The contributor's coin. Exactly one, and it must cover `addSats + fee`. */
  funder: { sourceTransaction: Transaction; outputIndex: number }
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
  const funded = p.funder.sourceTransaction.outputs[p.funder.outputIndex]?.satoshis ?? 0
  if (funded < p.addSats + TOPUP_FEE_PAD) {
    throw new Error(`one coin must cover ${(p.addSats + TOPUP_FEE_PAD).toLocaleString()} sat; this one holds ${funded.toLocaleString()}`)
  }

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: p.depot.sourceTransaction, sourceOutputIndex: p.depot.outputIndex,
                sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: p.funder.sourceTransaction, sourceOutputIndex: p.funder.outputIndex,
                sequence: 0xffffffff })                      // ⚠ left BLANK — the contributor fills it

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
  const change = funded - p.addSats - TOPUP_FEE_PAD
  if (change > 0) tx.addOutput({ lockingScript: new P2PKH().lock(p.changeAddress), satoshis: change })

  /* The covenant's half, complete and keyless. Its preimage commits to every output above, so the
     contributor cannot alter one after the fact without invalidating this. */
  const pre = TransactionSignature.format({
    sourceTXID: p.depot.sourceTransaction.id('hex'), sourceOutputIndex: p.depot.outputIndex,
    sourceSatoshis: p.depot.value, transactionVersion: 2, otherInputs: [tx.inputs[1]], inputIndex: 0,
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
