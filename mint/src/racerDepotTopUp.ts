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
import {
  Transaction, TransactionSignature, LockingScript, UnlockingScript, P2PKH, PrivateKey,
  SatoshisPerKilobyte, Utils, OP,
} from '@bsv/sdk'
import { buildRacerDepotBasicLock, readDepotState, RACER_WINDOW_SECONDS } from './racerDepotFrame.ts'
import { buildDepotUnlock, DEPOT_SCOPE } from './depot.ts'

/**
 * ★★ THE DEPOT'S HALF, AS AN UNLOCKING TEMPLATE — the shape `batteryTx.ts` uses, and for its reason.
 *
 * ⚠⚠ THE ORDER IS THE WHOLE POINT. The covenant's preimage commits to every output, and the CHANGE is
 * an output whose size is not known until the fee is. So the unlock cannot be built first: it has to be
 * built by `tx.sign()`, after `tx.fee()` has settled the change. A template is how the SDK expresses
 * "build this once everything else is final", and building it by hand beforehand produces a preimage
 * that commits to a change output which then moves.
 */
export function racerDepotUnlockTemplate(opts: { lock: LockingScript; sourceSatoshis: number }) {
  const spenderOutputs = (tx: Transaction): number[] =>
    tx.outputs.slice(1).flatMap(o => serializeOut(o.satoshis ?? 0, o.lockingScript.toBinary()))
  const preimage = (tx: Transaction, i: number): number[] | null => {
    const input = tx.inputs[i]
    const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
    if (sourceTXID == null) return null
    return TransactionSignature.format({
      sourceTXID, sourceOutputIndex: input.sourceOutputIndex, sourceSatoshis: opts.sourceSatoshis,
      transactionVersion: tx.version, otherInputs: tx.inputs.filter((_, j) => j !== i), inputIndex: i,
      outputs: tx.outputs, inputSequence: input.sequence ?? 0xfffffffe, subscript: opts.lock,
      lockTime: tx.lockTime, scope: DEPOT_SCOPE,
    })
  }
  const build = (tx: Transaction, i: number): UnlockingScript => {
    const p = preimage(tx, i)
    if (p == null) throw new Error('racerDepot unlock: the input has no sourceTXID or sourceTransaction')
    return buildDepotUnlock({
      prefixOutputs: [],                                  // nothing before the depot's own output
      /* ⚠ EVERY output after ours, change and mark alike. The depot's VALUE rules do not constrain
         them on a top-up, but the BINDING hashes all of them — those are not the same sentence. */
      spenderOutputs: spenderOutputs(tx),
      newValue: u64(tx.outputs[0].satoshis ?? 0),
      preimage: p,
    } as never)
  }
  return {
    sign: async (tx: Transaction, i: number): Promise<UnlockingScript> => build(tx, i),
    estimateLength: async (tx: Transaction, i: number): Promise<number> =>
      preimage(tx, i) == null ? 3600 : build(tx, i).toBinary().length,
  }
}

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
  /** ⚠ SIZING ONLY. A P2PKH unlocking script is the same length whoever signs it, so a random key
      gives the real fee and the real change. The signature it makes is stripped and thrown away. */
  key?: PrivateKey
  /** Leave the sponsor's inputs BLANK for their owner to fill. Default true — that is the whole point. */
  unsignedFunder?: boolean
  feePerKb?: number
}

/**
 * The transaction, with the covenant's input COMPLETE and the contributor's BLANK.
 *
 * ⚠ It is deliberately not signable here and deliberately not broadcastable here. The page that builds
 * it never holds a key.
 */
export async function buildRacerTopUpTx(p: RacerTopUpParams): Promise<Transaction> {
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

  /* ⚠ THE STAMP. `window >= mark` is checked before the mint/top-up branch, so a top-up needs one too —
     and far enough back that median time past has already passed it (measured 19 Aug: MTP runs about
     92 minutes behind, so `now` is non-final and unmineable). */
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000)
  const lockTime = Math.max(
    Math.floor((now - 3 * 3600) / RACER_WINDOW_SECONDS) * RACER_WINDOW_SECONDS,
    mark * RACER_WINDOW_SECONDS,
  )
  /* ★ A THROWAWAY KEY, FOR SIZING ONLY. A P2PKH unlocking script is the same length whoever signs it,
     so the fee and the change computed here are the ones the eventual real signature will satisfy.
     The signature this makes is stripped below and never leaves the machine. */
  const sizingKey = p.key ?? PrivateKey.fromRandom()

  const tx = new Transaction()
  tx.version = 2
  tx.lockTime = lockTime
  /* ⚠⚠ NON-FINAL. With 0xffffffff consensus ignores nLockTime entirely and the covenant refuses the
     spend outright — the sequence guard is the line the whole rate limit rests on. */
  tx.addInput({
    sourceTransaction: p.depot.sourceTransaction, sourceOutputIndex: p.depot.outputIndex,
    sequence: 0xfffffffe,
    unlockingScriptTemplate: racerDepotUnlockTemplate({ lock: depotLock, sourceSatoshis: p.depot.value }),
  })
  for (const c of p.funder) {
    tx.addInput({
      sourceTransaction: c.sourceTransaction, sourceOutputIndex: c.outputIndex,
      sequence: 0xffffffff,
      unlockingScriptTemplate: new P2PKH().unlock(sizingKey),
    })
  }

  /* out0 — THE TANK, FULLER, CARRYING THE SAME STATE. Rebuilt from the state rather than copied, so a
     mismatch is an error here rather than a refusal on chain. ★ A gift buys no minting slot. */
  tx.addOutput({
    lockingScript: buildRacerDepotBasicLock({ carBlock: p.carBlock, owner: p.owner, mark, count }),
    satoshis: p.depot.value + p.addSats,
  })
  if (p.mark) {
    const m = Utils.toArray(p.mark, 'utf8')
    if (m.length > 75) throw new Error(`the mark is ${m.length} bytes; keep it under 76`)
    tx.addOutput({ lockingScript: new LockingScript([
      { op: OP.OP_FALSE }, { op: OP.OP_RETURN }, { op: m.length, data: m },
    ]), satoshis: 0 })
  }
  tx.addOutput({ lockingScript: new P2PKH().lock(p.changeAddress), change: true })

  await tx.fee(new SatoshisPerKilobyte(p.feePerKb ?? 100))
  await tx.sign()

  /* ★★ SIGNED FOR SIZING, THEN STRIPPED — the shape `batteryTx.ts` uses and the reason it works.
     What is handed on is a transaction with the COVENANT input complete (OP_PUSH_TX needs no key) and
     the sponsor's input blank, waiting for its owner.
     ⚠⚠ AN EMPTY UnlockingScript SERIALIZES; `undefined` THROWS. Leaving the input with no script at
     all makes `toHex()` fail with "unlockingScript is undefined" — which is exactly why an earlier
     version of this could not be handed to a wallet at all. */
  if (p.unsignedFunder !== false) {
    for (let i = 1; i < tx.inputs.length; i++) {
      tx.inputs[i].unlockingScript = new UnlockingScript([])
      tx.inputs[i].unlockingScriptTemplate = undefined
    }
  }
  return tx
}

/** Eight bytes, little-endian — a satoshi value as the chain writes it. */
function u64(v: number): number[] {
  const b: number[] = []
  let x = BigInt(v)
  for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n }
  return b
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
