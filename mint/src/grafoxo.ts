// © 2026 sun-dive — Apache License 2.0.
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
import { Transaction, UnlockingScript, LockingScript, Script, P2PKH } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from './basicCovenant.ts'
import { pushTxPreimage } from './pushtx.ts'
/* ★ THE LOOPING BOARD — it resets after a win and plays again, so a permanent public page never has
   to be re-minted and no satoshis are ever stranded behind a finished game. `oxo.ts` is the monument
   variant and is left alone; its byte count is published in BRC-Z. */
import { OXOLOOP_SRC as OXO_SRC, OXOLOOP_INPUTS as OXO_INPUTS, loopNew as oxoNew,
         loopRef as oxoRef, type LoopState as OxoState } from './oxoLoop.ts'

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
  /* DIM board%2 · turn%1 · winner%1 · moves%1 · games%2 — little-endian, as `fixedField` writes. */
  if (head.length < 5) return null
  const le = (b: number[]) => b.reduceRight((v, x) => v * 256 + x, 0)
  const st: OxoState = {
    board: le(head[0]), turn: le(head[1]), winner: le(head[2]), moves: le(head[3]),
    games: le(head[4]),
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

/**
 * ⚠⚠ THE WHATSONCHAIN SCRIPT HASH IS SHA-256(script) **BYTE-REVERSED** — the Electrum convention.
 * ⇒ The non-reversed form 404s SILENTLY, which makes discovery impossible rather than noisy.
 *   (`battery.php` records that `tip.php` has exactly that bug.)
 */
export async function scriptHash(lockHex: string): Promise<string> {
  const bytes = new Uint8Array((lockHex.match(/../g) ?? []).map(h => parseInt(h, 16)))
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...d].reverse().map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Does this transaction spend `tipTxid:vout`? ⚠ A history entry is not an answer until this says so. */
export function spendsTip(rawHex: string, tipTxid: string, vout = 0): boolean {
  try {
    return Transaction.fromHex(rawHex).inputs.some((i: any) =>
      (i.sourceTXID ?? i.sourceTransaction?.id('hex')) === tipTxid && i.sourceOutputIndex === vout)
  } catch { return false }
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

/* ══ 🔋 THE RECHARGE ═══════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ THE BOARD IS A BATTERY, and this is the half that puts something back. The frame's value rule
 * is a FLOOR — `out ≥ V − MAX_FEE` — so handing the covenant MORE than was taken was always legal.
 * **Bounded on the way out, unbounded on the way in.** Proved against the live board before this was
 * written: a two-input spend raising it from 3,708 to 53,385 sat validates.
 *
 * ⚠⚠ A TOP-UP IS A MOVE. This covenant has no idle branch — every spend plays a square. That is not
 * a limitation to apologise for: **you put money in while you take your turn**, and since the board
 * cares which MARK is next and never who is playing it, anybody can do both at once.
 *
 * ⚠⚠ THE PAGE HOLDS NO KEY. What comes back has the covenant's own input COMPLETE (OP_PUSH_TX needs
 * no key) and every funding input BLANK. It is a REQUEST, not a transaction — Phar Lap signs the
 * blanks. Nothing here signs or broadcasts anything.
 *
 * ⚠ NO MINIMUM, NO REFUSAL. If the coins cannot cover what was asked, it contributes what they can
 * rather than blocking. The covenant accepts a single satoshi; every refusal beyond that would be
 * this file's invention. (Earned on the depot, twice.)
 */

/** The official rate — 100 sat/KB. ⚠ Never inflated, never ARC's suggestion. */
const FEE_PER_KB = 100
const feeFor = (bytes: number) => Math.ceil((bytes * FEE_PER_KB) / 1000)
/** What a P2PKH input's unlocking script WILL weigh once signed: `<sig ≤72+1> <pubkey 33+1>`. */
const P2PKH_UNLOCK = 107

export interface Funder { sourceTransaction: Transaction; outputIndex: number }

/** value(8) ‖ varint(len) ‖ script — the serialization every covenant here hashes outputs with. */
function serializeOut(sats: number, script: number[]): number[] {
  const v: number[] = []; let n = BigInt(sats)
  for (let i = 0; i < 8; i++) { v.push(Number(n & 0xffn)); n >>= 8n }
  const L = script.length
  const len = L < 0xfd ? [L] : L <= 0xffff ? [0xfd, L & 255, L >> 8]
    : [0xfe, L & 255, (L >> 8) & 255, (L >> 16) & 255, (L >>> 24) & 255]
  return [...v, ...len, ...script]
}

/**
 * Build a move that also carries satoshis in.
 * @returns the raw transaction with input 0 finished and the funding inputs blank, plus what it did.
 */
export function buildTopUpMove(p: {
  tipRawHex: string
  square: number
  addSats: number
  funders: Funder[]
  changeLock: LockingScript
}) {
  const tip = Transaction.fromHex(p.tipRawHex)
  const out0: any = tip.outputs[0]
  const held: number = out0.satoshis
  const from = decodeBoard(out0.lockingScript.toHex())
  if (!from) throw new Error('that board could not be read')
  if (!p.funders.length) throw new Error('no coins to spend')
  const to = applyMove(from, p.square)            // ⚠ throws on an illegal square before anything is built

  const funded = p.funders.reduce((n, f) =>
    n + ((f.sourceTransaction.outputs[f.outputIndex] as any).satoshis as number), 0)

  /* ★ Assemble at a given pair of values. SIZE does not depend on the values, only on the shape —
     which is what lets one measured pass settle the fee. */
  const assemble = (boardValue: number, change: number) => {
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: tip, sourceOutputIndex: 0, sequence: 0xffffffff })
    for (const f of p.funders)
      tx.addInput({ sourceTransaction: f.sourceTransaction, sourceOutputIndex: f.outputIndex,
                    sequence: 0xffffffff, unlockingScript: new UnlockingScript([]) })
    tx.addOutput({ lockingScript: lockFor(to), satoshis: boardValue })
    if (change > 0) tx.addOutput({ lockingScript: p.changeLock, satoshis: change })
    const preimage = pushTxPreimage({
      sourceTXID: tip.id('hex'), sourceOutputIndex: 0, sourceSatoshis: held,
      transactionVersion: 2, inputIndex: 0, subscript: out0.lockingScript,
      outputs: tx.outputs, otherInputs: tx.inputs.slice(1), inputSequence: 0xffffffff, lockTime: 0,
    })
    tx.inputs[0].unlockingScript = new UnlockingScript(basicUnlockingOps({
      inputs: [p.square],
      spenderOutputs: tx.outputs.slice(1).flatMap((o: any) =>
        serializeOut(o.satoshis, o.lockingScript.toBinary())),
      newValue: valueBytes(boardValue), preimage,
    }))
    /* ⚠ MEASURED, never hand-counted — plus what the funding signatures will weigh once Phar Lap
       fills them in. A bound guessed low here is a transaction nobody will relay. */
    const bytes = tx.toHex().length / 2 + p.funders.length * P2PKH_UNLOCK
    return { tx, bytes }
  }

  /* pass 1 — shape it with a placeholder change to learn what it weighs */
  const fee = feeFor(assemble(held + p.addSats, 1).bytes)

  /* ★★ NO REFUSAL. If the coins fall short, put in what they cover. */
  let add = p.addSats
  let change = funded - add - fee
  if (change < 1) { add = funded - fee - 1; change = 1 }
  if (add < 1) throw new Error(
    `those coins hold ${funded} sat and the fee alone is ${fee} — nothing left to contribute`)

  const { tx } = assemble(held + add, change)
  return {
    rawHex: tx.toHex(), txid: tx.id('hex'), state: to,
    boardValue: held + add, added: add, change, fee, funded,
    blanks: p.funders.map((_, i) => i + 1),          // the inputs Phar Lap must sign
  }
}

/* ★ The page needs these two to assemble a top-up: it reads the funder's coins as transactions, and
   it has to say where the change goes. Neither involves a key. */
export { Transaction }
/** Where the change goes back to — the funder's own address, never anything of ours. */
export const p2pkhLock = (address: string): LockingScript => new P2PKH().lock(address)
