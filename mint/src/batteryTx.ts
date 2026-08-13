// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * BRC-226 THE BATTERY — transaction builders: genesis · tick · top-up.
 *
 * The three transactions divide cleanly along the line that matters:
 *
 *   GENESIS   signed, funded by the deployer     out0 = the battery at frame 1  (+ layout mark, change)
 *   TICK      NO KEY, NO SIGNATURE               in0 = the battery              out0 = the battery, advanced
 *   TOP-UP    signed by whoever chooses to pay   in0 = the battery + funding    out0 = the battery, richer
 *
 * The keyless half is the autonomous half; the half that costs money is the half a human chooses. That
 * boundary falls out of the design rather than being bolted on — a tick needs no wallet, no sats and
 * nothing at stake, because `OP_PUSH_TX` authorises with a proof about the transaction, not a signature.
 *
 * A tick has no change output and no funding input: the fee comes out of the battery's own carried value,
 * so `out0.satoshis` must be set EXACTLY, not left to `tx.fee()`. Because every field is fixed-width and
 * the preimage is a constant size, a tick transaction is the SAME SIZE at every state — so the fee is
 * deterministic and is asserted against `MAX_FEE` before the transaction is returned.
 */
import {
  Transaction, P2PKH, SatoshisPerKilobyte, LockingScript, UnlockingScript, TransactionSignature,
  type PrivateKey,
} from '@bsv/sdk'
import { serializeOutput } from './covenant.ts'
import { derivedSigIsLowS } from './pushtx.ts'
import {
  buildBatteryLock, tickUnlockingOps, refState, genesisState, u64le, opReturnScript, ticksRemaining,
  BATTERY_SCOPE, BATTERY_MAX_FEE, BATTERY_FEE_PER_KB, BATTERY_GEOMETRY, BATTERY_STATE_LAYOUT,
  type BatteryState, type BatteryGeometry,
} from './battery.ts'

const enc = (m: string | number[]): number[] =>
  typeof m === 'string' ? Array.from(new TextEncoder().encode(m)) : m

/** Shared shape of the battery UTXO being spent. */
export interface BatteryUtxo {
  sourceTransaction: Transaction
  outputIndex: number
  /** The state carried by THAT output's script (not the next one). */
  state: BatteryState
  /** The satoshis on that output. */
  value: number
}

export interface BatteryOptions {
  geometry?: BatteryGeometry
  maxFee?: number
  feePerKb?: number
  /**
   * Grind until the covenant's DERIVED signature satisfies the LOW_S rule, purely so the transaction
   * also relays through ARC. Free and entirely off-chain — candidates are built in memory and only the
   * passing one is broadcast.
   *
   * **Default OFF.** LOW_S was REMOVED from the BSV protocol by the Chronicle release for transactions
   * with a version field greater than 1, and these are version 2 — so a high-S tick is protocol-correct,
   * and was PROVEN so on 2026-08-12: tick 1 of the rehearsal is high-S, ARC refused it, and it was mined
   * into block 961,975 regardless. ARC enforcing a withdrawn rule is a conformance gap in ARC.
   *
   * Set true only when you specifically need a stubborn ARC endpoint to accept the transaction.
   */
  lowS?: boolean
}

/**
 * Whether to grind for LOW_S when the caller does not say. OFF: Chronicle removed the rule, and bending
 * transactions to satisfy a processor that has not caught up is the wrong default on a chain whose whole
 * premise is restoring the original protocol.
 */
const GRIND_LOW_S_BY_DEFAULT = false

/**
 * `nLockTime` values to grind through. Every one is a block height in the distant past, so the
 * transaction is final regardless of any input's sequence number — varying it changes the preimage
 * (and therefore the derived signature) without changing anything that matters.
 */
const LOCKTIME_CANDIDATES = 64

/** Read back the preimage the unlocking script actually pushed, to test the signature it will derive. */
function preimageOf(tx: Transaction): number[] | null {
  const chunks = tx.inputs[0]?.unlockingScript?.chunks
  return chunks != null && chunks.length === 3 ? (chunks[2].data as number[]) : null
}

/**
 * Unlocking-script template for the battery input. There is no ECDSA signature — the OP_PUSH_TX preimage
 * IS the authorisation — so `estimateLength` is byte-exact once the outputs are known.
 */
export function tickUnlockTemplate(opts: {
  prevLock: LockingScript
  sourceSatoshis: number
  /** Outputs the covenant pins (always 1: out0). Everything after is the spender's. */
  enforcedOutputCount?: number
}) {
  const enforced = opts.enforcedOutputCount ?? 1
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
      lockTime: tx.lockTime, scope: BATTERY_SCOPE,
    })
  }
  const build = (tx: Transaction, i: number): UnlockingScript => {
    const p = preimage(tx, i)
    if (p == null) throw new Error('battery unlock: input is missing sourceTXID/sourceTransaction')
    const newValue = u64le(tx.outputs[0].satoshis ?? 0)
    return new UnlockingScript(tickUnlockingOps({ spenderOutputs: spenderOutputs(tx), newValue, preimage: p }))
  }
  return {
    sign: async (tx: Transaction, i: number): Promise<UnlockingScript> => build(tx, i),
    estimateLength: async (tx: Transaction, i: number): Promise<number> =>
      preimage(tx, i) == null ? 1650 : build(tx, i).toBinary().length,
  }
}

// ── genesis ──────────────────────────────────────────────────────────────────────────────────────────
export interface BatteryGenesisParams extends BatteryOptions {
  /** The deployer's key — funds the battery and receives the change. It has NO power over the battery. */
  key: PrivateKey
  /** The deployer's funding UTXO. */
  funder: { sourceTransaction: Transaction; outputIndex: number }
  /** Satoshis to load into the battery. This is the fuel, and it is all the battery will ever have
   *  until someone tops it up. */
  fuelSats: number
  /** The opening OP_RETURN. Defaults to the published state layout; pass `null` for no mark at all. */
  mark?: string | number[] | null
}

/**
 * Assemble (and sign) the genesis: out0 = the battery at frame 1, out1 = the state layout, out2 = change.
 *
 * ⚠ Everything baked in here is permanent. There is no key that can amend the script afterwards — the
 * deployer key funds it and then has no more authority over it than a stranger.
 */
export async function buildBatteryGenesisTx(p: BatteryGenesisParams): Promise<Transaction> {
  const geometry = p.geometry ?? BATTERY_GEOMETRY
  const maxFee = p.maxFee ?? BATTERY_MAX_FEE
  if (!Number.isInteger(p.fuelSats) || p.fuelSats < 1) throw new Error('genesis: fuelSats must be a positive integer')

  const state = genesisState(geometry)
  const lock = buildBatteryLock({ state, geometry, maxFee })

  const tx = new Transaction()
  tx.version = 2                                    // match the tick — the covenant's OP_PUSH_TX is validated at v2
  tx.addInput({
    sourceTransaction: p.funder.sourceTransaction, sourceOutputIndex: p.funder.outputIndex,
    unlockingScriptTemplate: new P2PKH().unlock(p.key),
  })
  tx.addOutput({ lockingScript: lock, satoshis: p.fuelSats })                       // out0 · the battery
  const mark = p.mark === null ? null : enc(p.mark ?? BATTERY_STATE_LAYOUT)
  if (mark != null) tx.addOutput({ lockingScript: opReturnScript(mark), satoshis: 0 })  // out1 · the layout
  tx.addOutput({ lockingScript: new P2PKH().lock(p.key.toAddress()), change: true })    // out2 · change

  await tx.fee(new SatoshisPerKilobyte(p.feePerKb ?? BATTERY_FEE_PER_KB))
  await tx.sign()
  return tx
}

// ── tick ─────────────────────────────────────────────────────────────────────────────────────────────
export interface BatteryTickParams extends BatteryOptions {
  battery: BatteryUtxo
  /** Override the fee this tick pays. Defaults to exactly what the network needs at `feePerKb`. */
  feeSats?: number
}

/**
 * Assemble a tick: one input, one output, no signature, no key, no change.
 *
 * The fee is derived from the transaction's own measured size rather than assumed, then asserted against
 * `MAX_FEE`. If a future relay floor ever pushes the required fee above `MAX_FEE`, this throws rather
 * than producing a transaction that no node will accept — keyless ticking degrades to sponsor-only, and
 * it should do so loudly.
 */
export async function buildBatteryTickTx(p: BatteryTickParams): Promise<Transaction> {
  const geometry = p.geometry ?? BATTERY_GEOMETRY
  const maxFee = p.maxFee ?? BATTERY_MAX_FEE
  const feePerKb = p.feePerKb ?? BATTERY_FEE_PER_KB
  const { state, value } = p.battery

  /* FLAT CHECK FIRST. There is a friendly guard further down, but it was unreachable: `assemble()`
     runs before it and hands a negative value to addOutput, so @bsv/sdk throws "satoshis must be a
     positive integer or zero" — which tells a visitor pressing Tick it nothing at all. A battery is
     MEANT to go flat and wait; that is the whole design, so it has to say so in those words. */
  if (value < maxFee) {
    throw new Error(`the battery is flat — ${value} sat left, a tick needs up to ${maxFee}. Top it up.`)
  }

  const prevLock = buildBatteryLock({ state, geometry, maxFee })
  const nextLock = buildBatteryLock({ state: refState(state, geometry), geometry, maxFee })

  const assemble = async (feeSats: number, lockTime: number): Promise<Transaction> => {
    const tx = new Transaction()
    tx.version = 2
    tx.lockTime = lockTime
    tx.addInput({
      sourceTransaction: p.battery.sourceTransaction, sourceOutputIndex: p.battery.outputIndex,
      sequence: 0xffffffff,
      unlockingScriptTemplate: tickUnlockTemplate({ prevLock, sourceSatoshis: value }),
    })
    tx.addOutput({ lockingScript: nextLock, satoshis: value - feeSats })
    await tx.sign()
    return tx
  }

  // A tick is the same size at every state, so one measure-then-rebuild converges exactly.
  let tx = await assemble(p.feeSats ?? maxFee, 0)
  const needed = Math.ceil(tx.toBinary().length * feePerKb / 1000)
  let fee = p.feeSats ?? needed
  if (fee !== (p.feeSats ?? maxFee)) tx = await assemble(fee, 0)

  // ── optional: grind for a canonical (LOW_S) signature ──────────────────────────────────────────────
  // Off by default — Chronicle withdrew the rule for version > 1, and these are version 2. When asked
  // for, the lever is the preimage: the covenant DERIVES its signature and cannot negate a high `s` the
  // way a key-holding signer would, so vary the fee (anything up to MAX_FEE is valid) and then
  // `nLockTime`. Candidates are built in memory; only the passing one is broadcast — about two tries.
  if (p.lowS ?? GRIND_LOW_S_BY_DEFAULT) {
    const fees = p.feeSats != null ? [p.feeSats] : Array.from({ length: maxFee - fee + 1 }, (_, i) => fee + i)
    let found = false
    outer:
    for (let lockTime = 0; lockTime < LOCKTIME_CANDIDATES && !found; lockTime++) {
      for (const candidateFee of fees) {
        const candidate = await assemble(candidateFee, lockTime)
        const preimage = preimageOf(candidate)
        if (preimage != null && derivedSigIsLowS(preimage)) { tx = candidate; fee = candidateFee; found = true; break outer }
      }
    }
    if (!found) {
      throw new Error(
        `could not find a LOW_S tick in ${LOCKTIME_CANDIDATES} lockTimes × ${fees.length} fees — ` +
        `pass { lowS: false } to broadcast a high-S tick anyway (valid and minable, but ARC will refuse it)`)
    }
  }

  const size = tx.toBinary().length
  const required = Math.ceil(size * feePerKb / 1000)
  if (fee > maxFee) {
    throw new Error(
      `tick needs ${required} sat for ${size} bytes but MAX_FEE is ${maxFee} — keyless ticking is no longer ` +
      `possible at ${feePerKb} sat/KB; this battery can only be advanced by a sponsor adding a funding input`)
  }
  if (fee < required) throw new Error(`tick fee ${fee} is below the ${required} sat needed for ${size} bytes`)
  if (value - fee < 0) throw new Error('tick: the battery is flat — top it up')
  return tx
}

// ── top-up ───────────────────────────────────────────────────────────────────────────────────────────
export interface BatteryTopUpParams extends BatteryOptions {
  battery: BatteryUtxo
  /** Satoshis to ADD to the battery. The covenant's floor rule makes this just another valid tick. */
  addSats: number
  /** The sponsor's key and funding UTXO — this half is deliberate and signed. */
  key: PrivateKey
  funder: { sourceTransaction: Transaction; outputIndex: number }
  /** The contribution's mark for the board (≤220 bytes). Displayed as TEXT — never auto-linked. */
  mark?: string | number[] | null
  changeAddress?: string
}

/**
 * Assemble (and sign) a top-up: the battery gains value AND advances one tick in the same transaction.
 *
 * Contribution and signature are atomic by construction, so the board is simply a VIEW over the chain:
 * find the ticks where out0's value rose, read the mark, rank by amount. No separate covenant, no
 * registry, nothing to administer.
 */
export async function buildBatteryTopUpTx(p: BatteryTopUpParams): Promise<Transaction> {
  const geometry = p.geometry ?? BATTERY_GEOMETRY
  const maxFee = p.maxFee ?? BATTERY_MAX_FEE
  const { state, value } = p.battery
  if (!Number.isInteger(p.addSats) || p.addSats < 1) throw new Error('top-up: addSats must be a positive integer')

  const prevLock = buildBatteryLock({ state, geometry, maxFee })
  const nextLock = buildBatteryLock({ state: refState(state, geometry), geometry, maxFee })
  const mark = p.mark === null || p.mark === undefined ? null : enc(p.mark)

  const assemble = async (lockTime: number): Promise<Transaction> => {
    const tx = new Transaction()
    tx.version = 2
    tx.lockTime = lockTime
    tx.addInput({
      sourceTransaction: p.battery.sourceTransaction, sourceOutputIndex: p.battery.outputIndex,
      sequence: 0xffffffff,
      unlockingScriptTemplate: tickUnlockTemplate({ prevLock, sourceSatoshis: value }),
    })
    tx.addInput({
      sourceTransaction: p.funder.sourceTransaction, sourceOutputIndex: p.funder.outputIndex,
      sequence: 0xffffffff,
      unlockingScriptTemplate: new P2PKH().unlock(p.key),
    })
    tx.addOutput({ lockingScript: nextLock, satoshis: value + p.addSats })              // out0 · richer battery
    if (mark != null) tx.addOutput({ lockingScript: opReturnScript(mark), satoshis: 0 })// out1 · the mark
    tx.addOutput({ lockingScript: new P2PKH().lock(p.changeAddress ?? p.key.toAddress()), change: true })
    await tx.fee(new SatoshisPerKilobyte(p.feePerKb ?? BATTERY_FEE_PER_KB))
    await tx.sign()
    return tx
  }

  // A top-up spends the covenant too, so it meets the same ARC quirk. Its fee is set by the fee model,
  // so `nLockTime` is the lever here. The mark is unaffected either way: an OP_RETURN is just an output,
  // and the board reads out0's rise plus the mark, never the signature's shape.
  let tx = await assemble(0)
  if (p.lowS ?? GRIND_LOW_S_BY_DEFAULT) {
    let found = false
    for (let lockTime = 0; lockTime < LOCKTIME_CANDIDATES; lockTime++) {
      const candidate = await assemble(lockTime)
      const preimage = preimageOf(candidate)
      if (preimage != null && derivedSigIsLowS(preimage)) { tx = candidate; found = true; break }
    }
    if (!found) {
      throw new Error(
        `could not find a LOW_S top-up in ${LOCKTIME_CANDIDATES} lockTimes — ` +
        `pass { lowS: false } to broadcast anyway (valid and minable, but ARC will refuse it)`)
    }
  }
  return tx
}

/** Read the state + value a tick produced, so the next tick can be built from a broadcast transaction. */
export function nextBatteryUtxo(tx: Transaction, prev: BatteryUtxo, geometry: BatteryGeometry = BATTERY_GEOMETRY): BatteryUtxo {
  return {
    sourceTransaction: tx, outputIndex: 0,
    state: refState(prev.state, geometry),
    value: tx.outputs[0].satoshis ?? 0,
  }
}

export { ticksRemaining }
