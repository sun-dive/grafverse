// © BSV Association — Open BSV License v6.
/**
 * ★ PUTTING SATS IN THE TANK — the transaction builder behind the contribute button.
 *
 * Mirrors `depotTx.ts` and `batteryTx.ts`, for the same reason and with the same shape: **the page
 * assembles the whole transaction, leaves the contributor's inputs BLANK, and stops.** It holds no key,
 * signs nothing and broadcasts nothing. What crosses the gap to Phar Lap is a REQUEST, not a
 * transaction — see `RacerTopUpRequest` at the bottom.
 *
 * ── ★ WHY A TOP-UP IS LEGAL AT ALL ────────────────────────────────────────────────────────────────
 * The depot's value rule is a FLOOR — `newv ≥ V − DRAIN` — so handing back MORE than was taken was
 * always allowed. And the car rule is gated on value actually LEAVING, so on a top-up that branch never
 * runs and the outputs after ours are the contributor's own business.
 * ⇒ The battery's property restated: **bounded on the way out, unbounded on the way in.**
 *
 * ── ⚠⚠ THE TWO THINGS THIS DEPOT NEEDS THAT THE CHAINED ONE DID NOT ───────────────────────────────
 * **1 · THE STATE MUST PASS THROUGH UNTOUCHED.** The successor carries the SAME `mark` and `n`. If a
 * top-up advanced the counter, ten one-satoshi gifts would close a minting window to everybody — a
 * griefing attack costing the attacker ten satoshis. The covenant enforces this (`racer-depot-basic.ts`:
 * *"a top-up costs no slot"*, *"…and may not quietly advance the counter"*), and the builder must agree
 * with it or the output simply will not match.
 *
 * **2 · nLockTime AND nSequence STILL BIND.** The window guard `window ≥ mark` runs BEFORE the
 * mint/top-up branch, so a top-up must also carry a stamp in the depot's current window or later — and
 * the input must be NON-FINAL, because `nSequence = ffffffff` makes consensus ignore nLockTime and the
 * covenant refuses that outright. Both are handled here; a caller should not have to know.
 */
import { Transaction, TransactionSignature, LockingScript, P2PKH, Utils, OP } from '@bsv/sdk'
import { buildRacerDepotBasicLock, readDepotState, RACER_WINDOW_SECONDS } from './racerDepotFrame.ts'
import { buildDepotUnlock, DEPOT_SCOPE } from './depot.ts'

/**
 * ⚠ The fee pad, and it MUST scale with the number of funding coins. Measured for the chained depot at
 * one input plus its change; each extra coin adds an input the contributor will sign.
 */
export const RACER_TOPUP_FEE_PAD = 400
export const RACER_TOPUP_INPUT_PAD = 20
export const racerTopUpPad = (coins: number): number =>
  RACER_TOPUP_FEE_PAD + Math.max(0, coins - 1) * RACER_TOPUP_INPUT_PAD

export interface RacerTopUpParams {
  /** The depot as it stands: its source transaction, which output, and what it holds. */
  depot: { sourceTransaction: Transaction; outputIndex: number; value: number }
  /** The car block this depot was born pinning — the lock is REBUILT from it, never copied. */
  carBlock: number[]
  owner: number[]
  addSats: number
  /**
   * The contributor's coins. ⚠ ALL of them are added before the covenant's input is built, because its
   * preimage commits to every outpoint. A coin added afterwards invalidates the depot's half.
   */
  funder: Array<{ sourceTransaction: Transaction; outputIndex: number }>
  changeAddress: string
  /** An optional mark, written to an OP_RETURN — the contributor's line on the board. */
  mark?: string | null
  /**
   * Seconds since the epoch to stamp with. ⚠ Default `Date.now()`, then pushed THREE HOURS BACK,
   * because nLockTime is judged against median time past — measured 19 Aug at 92 minutes behind, so a
   * transaction stamped `now` is non-final and unmineable.
   */
  nowSecs?: number
}

/**
 * The transaction, with the covenant's input COMPLETE and the contributor's BLANK.
 *
 * ⚠ It is deliberately not signable here and deliberately not broadcastable here. The page that builds
 * it never holds a key.
 */
export function buildRacerTopUpTx(p: RacerTopUpParams): Transaction {
  const onChain = p.depot.sourceTransaction.outputs[p.depot.outputIndex]
  if (!onChain) throw new Error('that outpoint does not exist in the transaction supplied')
  const script = onChain.lockingScript.toBinary()

  /* ★ THE STATE COMES OFF THE SCRIPT BEING SPENT, never from the caller. The depot is a chain and
     anybody may have advanced it since this page loaded. */
  const { mark, count } = readDepotState(script)
  const depotLock = buildRacerDepotBasicLock({ carBlock: p.carBlock, owner: p.owner, mark, count })
  if (Utils.toHex(script) !== depotLock.toHex()) {
    throw new Error('that outpoint is not this depot — wrong txid, wrong output, a different owner ' +
      'key, or a different car block')
  }

  if (!p.funder.length) throw new Error('a top-up needs at least one funding coin')
  if (p.addSats < 1) throw new Error('a top-up of nothing is not a top-up')
  const funded = p.funder.reduce((a, c) => a + (c.sourceTransaction.outputs[c.outputIndex]?.satoshis ?? 0), 0)
  const pad = racerTopUpPad(p.funder.length)
  if (funded < p.addSats + pad) {
    throw new Error(`these ${p.funder.length} coin(s) must cover ${(p.addSats + pad).toLocaleString()} sat; ` +
      `they hold ${funded.toLocaleString()}`)
  }

  /* ⚠ THE STAMP. `window ≥ mark` is checked before the branch, so a top-up needs one too — and it must
     be far enough back that median time past has already passed it. */
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000)
  const lockTime = Math.max(
    Math.floor((now - 3 * 3600) / RACER_WINDOW_SECONDS) * RACER_WINDOW_SECONDS,
    mark * RACER_WINDOW_SECONDS,
  )

  const tx = new Transaction(); tx.version = 2
  /* ⚠⚠ NON-FINAL. With 0xffffffff consensus ignores nLockTime entirely and the covenant refuses the
     spend outright — the sequence guard is the line the whole rate limit rests on. */
  tx.addInput({ sourceTransaction: p.depot.sourceTransaction, sourceOutputIndex: p.depot.outputIndex,
                sequence: 0xfffffffe })
  /* ⚠ EVERY funding coin goes in HERE, before the covenant's unlocking script is built below — its
     preimage commits to all of their outpoints. Left BLANK; the contributor fills them. */
  for (const c of p.funder) {
    tx.addInput({ sourceTransaction: c.sourceTransaction, sourceOutputIndex: c.outputIndex,
                  sequence: 0xffffffff })
  }

  /* ★ out0 — THE TANK, FULLER, AND CARRYING THE SAME STATE. Not `depotLock` by luck: it is the same
     script because `mark` and `count` are unchanged, which is exactly what the covenant demands of a
     top-up. Rebuild it from the state rather than copying the bytes, so a mismatch is an error here
     rather than a refusal on chain. */
  const successor = buildRacerDepotBasicLock({ carBlock: p.carBlock, owner: p.owner, mark, count })
  const newValue = p.depot.value + p.addSats
  tx.addOutput({ lockingScript: successor, satoshis: newValue })

  if (p.mark) {
    /* The mark rides in an OP_RETURN, as the battery's board marks do. It is not state and the covenant
       never reads it — the outputs after ours are unconstrained on a top-up, because no fuel left. */
    const m = Utils.toArray(p.mark, 'utf8')
    if (m.length > 75) throw new Error(`the mark is ${m.length} bytes; keep it under 76`)
    tx.addOutput({ lockingScript: new LockingScript([
      { op: OP.OP_FALSE }, { op: OP.OP_RETURN }, { op: m.length, data: m },
    ]), satoshis: 0 })
  }
  const change = funded - p.addSats - pad
  if (change > 0) tx.addOutput({ lockingScript: new P2PKH().lock(p.changeAddress), satoshis: change })
  tx.lockTime = lockTime

  /* The covenant's half, complete and keyless. Its preimage commits to every output above, so the
     contributor cannot alter one afterwards without invalidating this. */
  const pre = TransactionSignature.format({
    sourceTXID: p.depot.sourceTransaction.id('hex'), sourceOutputIndex: p.depot.outputIndex,
    sourceSatoshis: p.depot.value, transactionVersion: 2, otherInputs: tx.inputs.slice(1), inputIndex: 0,
    outputs: tx.outputs, inputSequence: 0xfffffffe, subscript: depotLock, lockTime, scope: DEPOT_SCOPE,
  })
  const u64 = (v: number): number[] => {
    const b: number[] = []; let x = BigInt(v); for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n }; return b
  }
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    prefixOutputs: [],          // nothing before the depot's own output on a top-up
    /* ⚠⚠ EVERY OUTPUT AFTER OURS GOES HERE, mark and change alike. It is tempting to pass nothing —
       a top-up takes no fuel, so the depot's VALUE rules do not constrain what follows. But the
       BINDING is a different thing entirely: the covenant rebuilds `prefix ‖ ours ‖ spender` and
       compares the hash to `hashOutputs`, which the miner computed over ALL of them. Leave the change
       out and the hashes simply differ, and the spend is refused with nothing to say why.
       ⇒ "The covenant does not care about these outputs" and "the covenant does not need to be told
       about them" are not the same sentence. */
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOut(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(newValue),
    preimage: pre,
  } as never)
  return tx
}

/** An output as the chain serializes it: value(8) ‖ varint(len) ‖ script. */
function serializeOut(value: number, script: number[]): number[] {
  const varint = (v: number): number[] =>
    v < 0xfd ? [v]
      : v <= 0xffff ? [0xfd, v & 0xff, v >> 8]
        : [0xfe, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
  const u = (v: number): number[] => {
    const b: number[] = []; let x = BigInt(v); for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n }; return b
  }
  return [...u(value), ...varint(script.length), ...script]
}

/**
 * ★ WHAT CROSSES THE GAP IS A REQUEST, NOT A TRANSACTION.
 *
 * The page cannot hand Phar Lap a half-built `Transaction` object — it has to hand it enough to REBUILD
 * one and check it. Everything here is verifiable on the other side: the depot's source hex proves what
 * is being spent and for how much, and the car block plus the owner rebuild the lock, so Phar Lap can
 * confirm the outpoint really is this depot before signing anything.
 *
 * ⚠ There is no signature in here and no key. The only thing being asked for is the contributor's
 * inputs, and the covenant's preimage already commits to every output — so nothing about where the
 * money goes can be altered after the fact without invalidating the depot's half.
 */
export interface RacerTopUpRequest {
  v: 1
  action: 'racer-depot-topup'
  depot: { txId: string; outputIndex: number; satoshis: number; sourceTxHex: string }
  funding: Array<{ txId: string; outputIndex: number; satoshis: number; sourceTxHex: string }>
  carBlockHex: string
  ownerHex: string
  addSats: number
  mark?: string | null
  changeAddress: string
  /** The state the successor must carry — stated so the other side can check rather than trust. */
  state: { mark: number; count: number }
}
