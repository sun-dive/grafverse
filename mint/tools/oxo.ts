// © BSV Association — Open BSV License v6.
/**
 * ★★★ NOUGHTS AND CROSSES, ON CHAIN, WITH NO KEYS AT ALL.
 *
 *   npx tsx tools/oxo.ts mint            build the empty board   (add --broadcast to send it)
 *   npx tsx tools/oxo.ts board           read the current board off the chain
 *   npx tsx tools/oxo.ts move 4          take a square           (add --broadcast to send it)
 *
 * ⚠⚠ A MOVE NEEDS NO SIGNATURE, NO WALLET AND NO FUNDING INPUT. The board holds its own satoshis and
 *    pays its own fee, and `src/oxo.ts` contains no CHECKSIG — the rules are the whole of the
 *    authorisation. ⇒ **Anyone with an internet connection can move.** Nobody can cheat, and nobody
 *    can be stopped.
 *
 * ⚠ Only the MINT needs a key, because something has to put the first satoshis in. After that the
 *   board is on its own. `OXO_WIF` comes from the environment and is never printed.
 *
 * ⚠ This is a TOOL. It adds no logic to any page's sources and rebuilds no bundle.
 */
import { Transaction, P2PKH, PrivateKey, UnlockingScript, SatoshisPerKilobyte, Spend } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import { pushTxPreimage } from '../src/pushtx.ts'
import { OXO_SRC, OXO_INPUTS, oxoNew, oxoRef, oxoShow, type OxoState } from '../src/oxo.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const LIVE = process.argv.includes('--broadcast')
const cmd = process.argv[2] ?? 'board'
const SATS = Number(process.env.SATS ?? 20_000)
const die = (m: string): never => { console.error('\n  ⚠ ' + m + '\n'); process.exit(1) }

const rec = (s: OxoState) => ({ ...s }) as unknown as Record<string, number>
const MAX_FEE = frameMaxFee({
  src: OXO_SRC, state: rec(oxoNew()), maxFee: 0, inputs: OXO_INPUTS, spenderOutputs: [],
}).fee
const lockFor = (s: OxoState) =>
  buildBasicLock({ src: OXO_SRC, state: rec(s), maxFee: MAX_FEE, inputs: OXO_INPUTS })

const woc = async (p: string) => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${r.status} on ${p}`); return r.json()
}
const rawTx = async (t: string) => Transaction.fromHex(await (await fetch(`${WOC}/tx/${t}/hex`)).text())
const broadcast = async (raw: string) => {
  const r = await fetch(`${WOC}/tx/raw`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }) })
  const b = await r.text(); if (!r.ok) die(`broadcast refused: ${b}`); return b.trim().replace(/"/g, '')
}

/**
 * ★ WALK TO THE CURRENT BOARD. Every move spends the last one, so the UNSPENT output is the game as
 * it stands. ⇒ No index, no server, no database — the chain is the board.
 */
async function walk(genesis: string) {
  let txid = genesis, hops = 0
  for (;;) {
    const r = await fetch(`${WOC}/tx/${txid}/out/0/spent`)
    if (r.status === 404) break
    if (!r.ok) die(`WhatsOnChain ${r.status} while walking from ${txid}`)
    txid = (await r.json()).txid; hops++
    if (hops > 200) die('walk did not terminate')
  }
  return { txid, hops }
}

/** ⚠ Replay the moves to know the state — the same rules the SCRIPT enforced, checked independently. */
function replay(hops: number, moves: number[]): OxoState {
  let st = oxoNew()
  for (const m of moves) st = oxoRef(st, m)
  return st
}

if (cmd === 'mint') {
  const wif = process.env.OXO_WIF
  if (LIVE && !wif) die('--broadcast needs OXO_WIF set in your own shell. It is never asked for.')
  const priv = wif ? PrivateKey.fromWif(wif) : PrivateKey.fromRandom()
  const addr = priv.toPublicKey().toAddress()
  const lock = lockFor(oxoNew())

  let src: Transaction
  if (LIVE) {
    const u: any[] = await woc(`/address/${addr}/unspent`)
    if (!u.length) die(`no funds at ${addr} — the board needs ${SATS} sat plus a fee`)
    src = await rawTx(u.sort((a, b) => b.value - a.value)[0].tx_hash)
  } else {
    src = new Transaction()
    src.addOutput({ lockingScript: new P2PKH().lock(priv.toPublicKey().toHash()), satoshis: SATS * 3 })
  }
  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0,
                unlockingScriptTemplate: new P2PKH().unlock(priv), sequence: 0xffffffff })
  tx.addOutput({ lockingScript: lock, satoshis: SATS })
  tx.addOutput({ lockingScript: new P2PKH().lock(priv.toPublicKey().toHash()), change: true })
  await tx.fee(new SatoshisPerKilobyte(100))
  await tx.sign()
  if (process.env.OUT) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.OUT, tx.toHex())
  }

  console.log(`\n  ═══ MINT THE BOARD ═══${LIVE ? '  ⚠ LIVE' : '  · dry run'}\n`)
  console.log(oxoShow(oxoNew()))
  console.log(`\n  lock        ${lock.toBinary().length} B`)
  console.log(`  board holds ${SATS.toLocaleString()} sat   ⇒ it pays its own fees, about ` +
              `${MAX_FEE} sat a move`)
  console.log(`  txid        ${tx.id('hex')}`)
  if (!LIVE) { console.log('\n  ⇒ DRY RUN. Add --broadcast with OXO_WIF set.\n'); process.exit(0) }
  await broadcast(tx.toHex())
  console.log(`\n  ★★★ THE BOARD IS ON CHAIN. From here nobody needs a key.`)
  console.log(`     https://whatsonchain.com/tx/${tx.id('hex')}`)
  console.log(`\n     OXO_GENESIS=${tx.id('hex')}\n`)
  process.exit(0)
}

const moves = (process.env.OXO_MOVES ?? '').split(',').filter(s => s !== '').map(Number)

/* ⚠ OXO_TIP_HEX is the OFFLINE path — hand the tip transaction straight in, so the whole sequence can
   be rehearsed with no chain and no satoshis. ⇒ Written so a bug is found here rather than live. */
let txid: string, hops: number, tip: Transaction
if (process.env.OXO_TIP_HEX) {
  const { readFileSync, existsSync } = await import('node:fs')
  const h = existsSync(process.env.OXO_TIP_HEX)
    ? readFileSync(process.env.OXO_TIP_HEX, 'utf8').trim() : process.env.OXO_TIP_HEX.trim()
  tip = Transaction.fromHex(h); txid = tip.id('hex'); hops = moves.length
} else {
  const genesis = process.env.OXO_GENESIS ?? die('OXO_GENESIS=<the mint txid> is required')
  const w = await walk(genesis); txid = w.txid; hops = w.hops
  tip = await rawTx(txid)
}
const st = replay(hops, moves)
const held = (tip.outputs[0] as any).satoshis

if (cmd === 'board') {
  console.log(`\n  ═══ THE BOARD, READ OFF THE CHAIN ═══\n`)
  console.log(oxoShow(st))
  console.log(`\n  ${hops} move${hops === 1 ? '' : 's'} played · ${held.toLocaleString()} sat left` +
              ` ⇒ about ${Math.floor((held - 1) / MAX_FEE)} more`)
  console.log(`  tip  ${txid}\n`)
  process.exit(0)
}

if (cmd === 'move') {
  const sq = Number(process.argv[3])
  if (!Number.isInteger(sq) || sq < 0 || sq > 8) die('a square is 0..8, top-left to bottom-right')
  let to: OxoState
  try { to = oxoRef(st, sq) } catch (e: any) { die(`${e.message} — the SCRIPT would refuse this too`) }

  const next = lockFor(to)
  const newSats = held - MAX_FEE
  if (newSats < 1) die('the board is out of satoshis')
  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTransaction: tip, sourceOutputIndex: 0, sequence: 0xffffffff })
  tx.addOutput({ lockingScript: next, satoshis: newSats })
  const preimage = pushTxPreimage({
    sourceTXID: txid, sourceOutputIndex: 0, sourceSatoshis: held,
    transactionVersion: 2, inputIndex: 0, subscript: (tip.outputs[0] as any).lockingScript,
    outputs: tx.outputs, inputSequence: 0xffffffff, lockTime: 0,
  })
  /* ⚠⚠ NO SIGNATURE ANYWHERE IN THIS UNLOCKING SCRIPT. The move, the value and the preimage — that is
     all the covenant asks for, because the RULES are the authorisation. */
  tx.inputs[0].unlockingScript = new UnlockingScript(basicUnlockingOps({
    inputs: [sq], spenderOutputs: [], newValue: valueBytes(newSats), preimage,
  }))

  /* ⚠⚠ RUN THE COVENANT BEFORE ASKING A NODE TO. "It builds" is not "it works", and this one gets
     broadcast in front of an audience. ⇒ If the script refuses it, nothing leaves this machine. */
  let ok = false, why = ''
  try {
    ok = new Spend({
      sourceTXID: txid, sourceOutputIndex: 0, sourceSatoshis: held,
      lockingScript: (tip.outputs[0] as any).lockingScript, transactionVersion: 2,
      otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
  } catch (e: any) { why = (e.message ?? String(e)).slice(0, 100) }

  console.log(`\n  ═══ MOVE ${sq} ═══${LIVE ? '  ⚠ LIVE' : '  · dry run'}\n`)
  console.log(oxoShow(to))
  console.log(`\n  ⚠ no key, no signature, no wallet — the unlocking script is a move and a preimage`)
  console.log(`  size ${tx.toHex().length / 2} B · fee ${held - newSats} sat, from the board itself`)
  console.log(`  txid ${tx.id('hex')}`)
  console.log(`  the covenant ${ok ? '✓ ACCEPTS this move' : '⚠ REFUSES it — ' + why}`)
  if (!ok) die('the script refused this move locally. Nothing was broadcast.')
  if (to.winner) console.log(`\n  ★★★ ${['', 'X WINS', 'O WINS', 'A DRAW'][to.winner]}`)
  if (process.env.OUT) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.OUT, tx.toHex())
  }
  if (!LIVE) {
    console.log(`\n  ⇒ DRY RUN. Add --broadcast to send it.`)
    console.log(`     ⚠ then keep the move list: OXO_MOVES=${[...moves, sq].join(',')}\n`)
    process.exit(0)
  }
  await broadcast(tx.toHex())
  console.log(`\n  ★★★ PLAYED. https://whatsonchain.com/tx/${tx.id('hex')}`)
  console.log(`     OXO_MOVES=${[...moves, sq].join(',')}\n`)
  process.exit(0)
}
die(`unknown command "${cmd}" — mint | board | move <0..8>`)
