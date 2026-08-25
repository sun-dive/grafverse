// © BSV Association — Open BSV License v6.
/**
 * ★★★ THE BROWSER SIDE OF ON-CHAIN NOUGHTS AND CROSSES.
 *
 * ⚠⚠ ITS OWN ENTRY POINT AND ITS OWN BUNDLE, deliberately. `grafmint.js` is loaded by the depot, the
 *    battery, brc226, grafverse and the racers; adding this to it would push every one of those
 *    visitors onto a new bundle for a page they never opened. ⇒ `vendor/grafoxo.js`, and nothing else
 *    is rebuilt. (mint/tools/BASIC.md, and the page-script isolation rule.)
 *
 * ★ WHAT THIS EXPOSES IS A GAME, NOT A TOOLKIT. Four calls: read a board, build a move, replay the
 *   rules, and toss for who starts. The covenant does the rest, and it needs no key from anybody.
 */
import { Transaction, UnlockingScript, LockingScript, Script } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from './basicCovenant.ts'
import { pushTxPreimage } from './pushtx.ts'
import { OXO_SRC, OXO_INPUTS, oxoNew, oxoRef, type OxoState } from './oxo.ts'

const rec = (s: OxoState) => ({ ...s }) as unknown as Record<string, number>

/** ⚠ The one fee bound the covenant was minted with. Every board in this game shares it. */
export const MAX_FEE = frameMaxFee({
  src: OXO_SRC, state: rec(oxoNew()), maxFee: 0, inputs: OXO_INPUTS, spenderOutputs: [],
}).fee

export const newBoard = (): OxoState => oxoNew()
export const lockFor = (s: OxoState): LockingScript =>
  buildBasicLock({ src: OXO_SRC, state: rec(s), maxFee: MAX_FEE, inputs: OXO_INPUTS })

/** The rules in TypeScript — the reference the SCRIPT is checked against, never the other way round. */
export const applyMove = (s: OxoState, sq: number): OxoState => oxoRef(s, sq)

/**
 * ★★ READ A BOARD OUT OF ITS OWN LOCKING SCRIPT — and PROVE the reading.
 *
 * ⚠⚠ A decoder that guesses quietly is worse than none. This rebuilds the script from what it decoded
 *    and requires the bytes to match, so a correct reading is correct BY CONSTRUCTION and a wrong one
 *    returns null. ⇒ That matters here because the second player opens the page knowing nothing: they
 *    have no move history, only whatever is on chain.
 */
export function decodeBoard(lockHex: string): OxoState | null {
  let chunks: any[]
  try { chunks = Script.fromHex(lockHex).chunks } catch { return null }
  const head: number[][] = []
  for (const c of chunks) { if (!c.data?.length) break; head.push([...c.data]) }
  if (head.length < 4) return null
  /* DIM board%2 · turn%1 · winner%1 · moves%1 — little-endian, as `fixedField` writes them. */
  const le = (b: number[]) => b.reduceRight((v, x) => v * 256 + x, 0)
  const st: OxoState = {
    board: le(head[0]), turn: le(head[1]), winner: le(head[2]), moves: le(head[3]),
  }
  try {
    if (lockFor(st).toHex() !== lockHex) return null
  } catch { return null }
  return st
}

/** Pull output 0 out of a raw transaction — its locking script, and what it still holds. */
export function parse(rawHex: string): { lockHex: string; sats: number; fee: number } {
  const tx = Transaction.fromHex(rawHex)
  const o: any = tx.outputs[0]
  /* ⚠ The fee is not derivable from this transaction alone — it is the parent's value minus this
     one's, and the parent is not here. Every move costs the same bound, so quote that. */
  return { lockHex: o.lockingScript.toHex(), sats: o.satoshis, fee: MAX_FEE }
}

/** The nine squares as X / O / empty, top-left first. Board is packed base 3. */
export function squares(s: OxoState): (0 | 1 | 2)[] {
  const out: (0 | 1 | 2)[] = []
  let b = s.board
  for (let i = 0; i < 9; i++) { out.push((b % 3) as 0 | 1 | 2); b = Math.floor(b / 3) }
  return out
}

/**
 * ★★★ THE TOSS IS THE TRANSACTION ID — nobody chooses it, and both players compute the same answer
 * from the chain. ⇒ No server, no coordination, and no need to trust the other side's coin.
 */
export const tossFirst = (genesisTxid: string): 1 | 2 =>
  (parseInt(genesisTxid.slice(-2), 16) % 2 === 0 ? 1 : 2)

/**
 * Build a move. ⚠ NO KEY, NO SIGNATURE, NO FUNDING INPUT — the board holds its own satoshis and pays
 * its own fee, and the covenant contains no CHECKSIG. **The rules are the whole of the authorisation.**
 * @returns the raw transaction, or throws with the reason the RULES refuse it
 */
export function buildMove(tipRawHex: string, from: OxoState, square: number) {
  const tip = Transaction.fromHex(tipRawHex)
  const out0: any = tip.outputs[0]
  const held: number = out0.satoshis
  const to = oxoRef(from, square)                       // ⚠ throws before anything is built
  const newSats = held - MAX_FEE
  if (newSats < 1) throw new Error('the board has run out of satoshis')

  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTransaction: tip, sourceOutputIndex: 0, sequence: 0xffffffff })
  tx.addOutput({ lockingScript: lockFor(to), satoshis: newSats })
  const preimage = pushTxPreimage({
    sourceTXID: tip.id('hex'), sourceOutputIndex: 0, sourceSatoshis: held,
    transactionVersion: 2, inputIndex: 0, subscript: out0.lockingScript,
    outputs: tx.outputs, inputSequence: 0xffffffff, lockTime: 0,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(basicUnlockingOps({
    inputs: [square], spenderOutputs: [], newValue: valueBytes(newSats), preimage,
  }))
  return { rawHex: tx.toHex(), txid: tx.id('hex'), state: to, fee: held - newSats, held: newSats }
}
