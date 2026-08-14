// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * BRC-226 LiveCounter — transaction builders (genesis deploy + tick), mirroring the edition covenant-spend
 * pattern in `editionBuilder.ts`: the covenant input is spent with an unlocking-script TEMPLATE whose
 * preimage is built from the finalised tx at sign time (after `tx.fee()` sets the change output).
 *
 * A tick tx:  in[0] = the counter UTXO (this covenant)   in[1..] = the signer's funding (P2PKH)
 *             out0 = the counter, n+1, funder swapped     out1 = DEPOSIT → old funder
 *             out2 = MARKFEE → author                      out3 = OP_RETURN(mark)   out4 = change
 * The covenant enforces out0..out2 (hashOutputs); out3+ are the signer's trailing outputs (mark + change).
 */
import {
  Transaction, P2PKH, SatoshisPerKilobyte, LockingScript, UnlockingScript, TransactionSignature, Hash,
  type PrivateKey,
} from '@bsv/sdk'
import { serializeOutput, p2pkhScript } from './covenant.ts'
import {
  buildLiveCounterLock, tickUnlockingOps, markOutput,
  LIVECOUNTER_SCOPE, MARK_MAX_BYTES, GENESIS_MARK,
} from './liveCounter.ts'

/** Official BSV fee rate (100 sat/KB). Never inflated. */
export const LIVECOUNTER_FEE_PER_KB = 100
const enc = (m: string | number[]): number[] => (typeof m === 'string' ? Array.from(new TextEncoder().encode(m)) : m)
const p2pkhLock = (hash20: number[]): LockingScript => LockingScript.fromBinary(p2pkhScript(hash20))
/** hash160 of a key's compressed pubkey (its P2PKH address hash). */
export const keyHash160 = (key: PrivateKey): number[] => Hash.hash160(key.toPublicKey().encode(true) as number[])

/** Amounts carried by a counter instance (must be identical across every tick of the same counter). */
export interface CounterAmounts { counterSats?: number; depositSats?: number; markFeeSats?: number }

/**
 * Unlocking-script template for a counter input. No ECDSA signature — the OP_PUSH_TX preimage IS the
 * authorisation — so `estimateLength` is byte-exact once the outputs are known.
 */
export function tickUnlockTemplate(opts: {
  prevLock: LockingScript          // the exact script being spent (n, oldFunder)
  sourceSatoshis: number           // the counter output's value (counterSats)
  newFunderHash: number[]          // this signer's payout hash — embedded in out0, repaid next tick
  enforcedOutputCount?: number     // outputs the covenant pins (default 3: out0..out2)
}) {
  const enforced = opts.enforcedOutputCount ?? 3
  const spenderOutputs = (tx: Transaction): number[] =>
    tx.outputs.slice(enforced).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()))
  const preimage = (tx: Transaction, i: number): number[] | null => {
    const input = tx.inputs[i]
    const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
    if (sourceTXID == null) return null
    return TransactionSignature.format({
      sourceTXID, sourceOutputIndex: input.sourceOutputIndex, sourceSatoshis: opts.sourceSatoshis,
      transactionVersion: tx.version, otherInputs: tx.inputs.filter((_, j) => j !== i), inputIndex: i,
      outputs: tx.outputs, inputSequence: input.sequence ?? 0xffffffff, subscript: opts.prevLock,
      lockTime: tx.lockTime, scope: LIVECOUNTER_SCOPE,
    })
  }
  const build = (tx: Transaction, i: number): UnlockingScript => {
    const p = preimage(tx, i)
    if (p == null) throw new Error('tick unlock: input is missing sourceTXID/sourceTransaction')
    return new UnlockingScript(tickUnlockingOps({ spenderOutputs: spenderOutputs(tx), newFunderHash: opts.newFunderHash, preimage: p }))
  }
  return {
    sign: async (tx: Transaction, i: number): Promise<UnlockingScript> => build(tx, i),
    estimateLength: async (tx: Transaction, i: number): Promise<number> =>
      preimage(tx, i) == null ? 900 : build(tx, i).toBinary().length,
  }
}

export interface TickParams extends CounterAmounts {
  /** The counter UTXO being advanced. */
  covenant: { sourceTransaction: Transaction; outputIndex: number; n: number; lastFunderHash: number[] }
  authorHash: number[]
  /** This signer's payout hash (embedded in the new counter; repaid on the NEXT tick). */
  newFunderHash: number[]
  /** The signer's funding UTXO (covers DEPOSIT + MARKFEE + fee) and its key. */
  funder: { key: PrivateKey; sourceTransaction: Transaction; outputIndex: number }
  /**
   * Hand back the tick with the FUNDER'S INPUT BLANK, for its owner to sign elsewhere.
   *
   * The counter's own input is complete either way — OP_PUSH_TX authorises it with a proof about the
   * transaction, so no key exists for it anywhere. Only the poster's input needs a signature, and this
   * is what lets the page assemble the whole thing while holding no key at all: the poster signs it in
   * a wallet the page never sees. A sighash preimage does not commit to any other input's unlocking
   * script, so the covenant's authorisation stays valid while that blank is filled in later.
   *
   * `funder.key` is still required and used ONLY to size the input for the fee. A P2PKH unlocking
   * script is the same length whoever signs it, so the fee and change computed here are exactly what
   * the real signature will satisfy. Pass any key; a random one is correct.
   */
  unsignedFunder?: boolean
  /** The mark to leave (≤ 111 bytes). String or raw bytes. */
  mark: string | number[]
  /** Where change goes. Send-to-post routes it to the POSTER's address (so the throwaway key ends at zero);
   *  defaults to the funder key's own address. */
  changeAddress?: string
  feePerKb?: number
}

/** Assemble (and sign) a real tick transaction: n → n+1, relay refund, author crumb, the signer's mark + change. */
export async function buildTickTx(p: TickParams): Promise<Transaction> {
  const mark = enc(p.mark)                                // already UTF-8 bytes
  if (mark.length > MARK_MAX_BYTES) throw new Error(`mark exceeds ${MARK_MAX_BYTES} bytes`)
  const amounts: CounterAmounts = { counterSats: p.counterSats, depositSats: p.depositSats, markFeeSats: p.markFeeSats }
  const V = p.counterSats ?? 1, DEPOSIT = p.depositSats ?? 1000, MARKFEE = p.markFeeSats ?? 1

  const prevLock = buildLiveCounterLock({ n: p.covenant.n, lastFunderHash: p.covenant.lastFunderHash, authorHash: p.authorHash, ...amounts })
  const nextLock = buildLiveCounterLock({ n: p.covenant.n + 1, lastFunderHash: p.newFunderHash, authorHash: p.authorHash, ...amounts })

  const tx = new Transaction()
  tx.version = 2                                          // Chronicle rules — the covenant's OP_PUSH_TX is validated at v2
  tx.addInput({
    sourceTransaction: p.covenant.sourceTransaction, sourceOutputIndex: p.covenant.outputIndex, sequence: 0xffffffff,
    unlockingScriptTemplate: tickUnlockTemplate({ prevLock, sourceSatoshis: V, newFunderHash: p.newFunderHash }),
  })
  tx.addInput({
    sourceTransaction: p.funder.sourceTransaction, sourceOutputIndex: p.funder.outputIndex,
    unlockingScriptTemplate: new P2PKH().unlock(p.funder.key),
  })
  tx.addOutput({ lockingScript: nextLock, satoshis: V })                                   // out0 · the tick
  tx.addOutput({ lockingScript: p2pkhLock(p.covenant.lastFunderHash), satoshis: DEPOSIT }) // out1 · repay old funder
  tx.addOutput({ lockingScript: p2pkhLock(p.authorHash), satoshis: MARKFEE })              // out2 · author crumb
  tx.addOutput({ lockingScript: LockingScript.fromBinary(markOutputScript(mark)), satoshis: 0 }) // out3 · the mark
  tx.addOutput({ lockingScript: new P2PKH().lock(p.changeAddress ?? p.funder.key.toAddress()), change: true }) // out4 · change → poster (send-to-post) or funder

  await tx.fee(new SatoshisPerKilobyte(p.feePerKb ?? LIVECOUNTER_FEE_PER_KB))
  await tx.sign()
  if (p.unsignedFunder) {
    /* Signed for sizing, then stripped. The fee and change above come from the real script length, so
       they are the ones the eventual signature will satisfy. What is handed on is a transaction with
       the counter's input COMPLETE and the poster's input blank, waiting for its owner.
       An EMPTY script, not an absent one: an input with no unlockingScript cannot be serialized. */
    tx.inputs[1].unlockingScript = new UnlockingScript([])
    tx.inputs[1].unlockingScriptTemplate = undefined
  }
  return tx
}

export interface GenesisParams extends CounterAmounts {
  /** The deployer's key — funds the genesis and receives change; its hash160 is the genesis lastFunder (repaid at tick 1). */
  key: PrivateKey
  /** The deployer's funding UTXO. */
  funder: { sourceTransaction: Transaction; outputIndex: number }
  /** 20-byte author hash for the crumb. Defaults to the deployer. */
  authorHash?: number[]
  /** Opening mark. Defaults to GENESIS_MARK ("Follow the white 🐇"). */
  mark?: string | number[]
  feePerKb?: number
}

/** Assemble (and sign) the genesis deploy tx: the counter output at n=0 + the opening OP_RETURN mark + change. */
export async function buildGenesisTx(p: GenesisParams): Promise<Transaction> {
  const authorHash = p.authorHash ?? keyHash160(p.key)
  const lastFunderHash = keyHash160(p.key)                       // tick 1 repays the deployer
  const V = p.counterSats ?? 1
  const mark = enc(p.mark ?? GENESIS_MARK)
  const lock = buildLiveCounterLock({ n: 0, lastFunderHash, authorHash, counterSats: p.counterSats, depositSats: p.depositSats, markFeeSats: p.markFeeSats })

  const tx = new Transaction()
  tx.version = 2                                          // Chronicle rules (match the tick + the covenant)
  tx.addInput({
    sourceTransaction: p.funder.sourceTransaction, sourceOutputIndex: p.funder.outputIndex,
    unlockingScriptTemplate: new P2PKH().unlock(p.key),
  })
  tx.addOutput({ lockingScript: lock, satoshis: V })                                        // the counter, n=0
  tx.addOutput({ lockingScript: LockingScript.fromBinary(markOutputScript(mark)), satoshis: 0 }) // the opening mark
  tx.addOutput({ lockingScript: new P2PKH().lock(p.key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(p.feePerKb ?? LIVECOUNTER_FEE_PER_KB))
  await tx.sign()
  return tx
}

/** Raw OP_RETURN script bytes for a mark (OP_FALSE OP_RETURN <push mark>). Matches liveCounter.markOutput. */
function markOutputScript(mark: number[]): number[] {
  // markOutput() serializes value+len+script; here we need just the script for a LockingScript.
  const full = markOutput(mark)          // [value(8) ‖ varint(len) ‖ script]
  const scriptStart = 8 + (full[8] < 0xfd ? 1 : 3)
  return full.slice(scriptStart)
}
