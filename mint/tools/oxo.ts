// © 2026 sun-dive — Apache License 2.0.
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
import { Transaction, P2PKH, PrivateKey, UnlockingScript, LockingScript, SatoshisPerKilobyte, Spend } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import { pushTxPreimage } from '../src/pushtx.ts'
/* ★ THE LOOPING BOARD — resets after a win and plays on, so a permanent public page never needs
   re-minting and no satoshis are stranded behind a finished game. `oxo.ts` is the monument variant
   and is left untouched; its byte count is published in BRC-Z. */
import { OXOLOOP_SRC as OXO_SRC, OXOLOOP_INPUTS as OXO_INPUTS, loopNew as oxoNew,
         loopRef as oxoRef, loopShow as oxoShow, type LoopState as OxoState } from '../src/oxoLoop.ts'

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

/**
 * ⏱⚠⚠ 350 ms BETWEEN CALLS, AND NEVER SWALLOW A 429.
 *
 * `woc.php` paces every server-side call at `WOC_MIN_INTERVAL = 0.35` — 250 ms is the real threshold
 * and 350 leaves headroom. **This tool goes nowhere near that queue**, so it had no pacing at all and
 * burst straight into a rate limit.
 *
 * ⇒ AND THE RATE LIMIT WAS NOT THE BUG. The bug was what happened next: `catch { continue }` turned a
 * 429 into "no history", which the walk read as *"nothing spent this, so it is the tip"* — and it
 * reported a SEVEN-MOVE GAME AS TWO MOVES, with every transaction mined and nothing wrong on chain.
 * ⚠⚠ **A failed lookup must never be reported as an answer.** Retry, and then fail out loud.
 */
const WOC_MIN_INTERVAL = 350
let lastCall = 0
const pace = async () => {
  const wait = lastCall + WOC_MIN_INTERVAL - Date.now()
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastCall = Date.now()
}
/** One request, paced, retrying a 429 with backoff. ⚠ Throws rather than returning a plausible lie. */
const hit = async (url: string, tries = 6): Promise<Response> => {
  for (let i = 0; i < tries; i++) {
    await pace()
    const r = await fetch(url)
    if (r.status !== 429) return r
    /* ⚠ a 429 is not an answer about the chain — it is the absence of one */
    await new Promise(res => setTimeout(res, WOC_MIN_INTERVAL * (i + 2)))
  }
  throw new Error(`WoC kept refusing (429 after ${tries} tries): ${url}\n` +
    `  ⚠ This is a RATE LIMIT, not an empty result — the board was NOT read.`)
}

const woc = async (p: string) => {
  const r = await hit(WOC + p); if (!r.ok) throw new Error(`WoC ${r.status} on ${p}`); return r.json()
}
/** ⚠ TRIM IT. The endpoint returns a trailing newline and `fromHex` refuses the whole string for it. */
const rawTx = async (t: string) => {
  const r = await hit(`${WOC}/tx/${t}/hex`)
  if (!r.ok) throw new Error(`WoC ${r.status} fetching ${t}`)
  const h = (await r.text()).trim()
  if (!/^[0-9a-fA-F]+$/.test(h)) throw new Error(`not hex for ${t}: ${h.slice(0, 40)}`)
  return Transaction.fromHex(h)
}
const broadcast = async (raw: string) => {
  const r = await fetch(`${WOC}/tx/raw`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }) })
  const b = await r.text(); if (!r.ok) die(`broadcast refused: ${b}`); return b.trim().replace(/"/g, '')
}

/**
 * ★ FIND WHAT SPENT THE TIP — the method `battery.php` arrived at, and the traps it records.
 *
 * ⚠⚠ `/out/0/spent` CANNOT SEE AN UNCONFIRMED TRANSACTION. Measured live on 26 Aug: the first real
 *    move was broadcast and accepted, and this walk still reported an empty board because it was
 *    asking `/spent`. ⇒ `/script/{h}/unconfirmed/history` carries mempool transactions;
 *    `/script/{h}/history` does not.
 * ⚠ The script hash is SHA-256(script) BYTE-REVERSED — the non-reversed form 404s SILENTLY.
 * ⚠ AND A NON-EMPTY LIST IS NOT AN ANSWER: it contains the transaction that CREATED this tip, so each
 *   list must be SCANNED for something that actually spends it.
 */
async function scriptHashOf(scriptHex: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(Buffer.from(scriptHex, 'hex')).digest().reverse().toString('hex')
}
function spendsTip(tx: Transaction, tipTxid: string, vout: number): boolean {
  return tx.inputs.some((i: any) =>
    (i.sourceTXID ?? i.sourceTransaction?.id('hex')) === tipTxid && i.sourceOutputIndex === vout)
}
async function spenderOf(tipTxid: string, vout: number): Promise<string | null> {
  const tip = await rawTx(tipTxid)
  const sh = await scriptHashOf((tip.outputs[vout] as any).lockingScript.toHex())
  for (const path of ['unconfirmed/history', 'history']) {
/* ⚠⚠ WHATSONCHAIN RETURNS `{ script, result: [...] }`, NOT A BARE ARRAY — measured 26 Aug against
   the first real board. Code that tests `Array.isArray(response)` skips the whole reply and reports
   an empty board while the move sits in the mempool. ⇒ Accept both shapes; the older one is a bare
   array and some endpoints still answer that way. */
    let hist: any
    /* ⚠⚠ NO `catch { continue }` HERE. A 404 means "no history of that kind", which IS an answer.
       Anything else means the question was not asked, and the walk must not carry on as though it
       had been — that is how a seven-move game got reported as two. */
    try { hist = await woc(`/script/${sh}/${path}`) }
    catch (e) {
      if (/\b404\b/.test(String((e as Error).message))) continue
      throw new Error(`could not read the history of ${tipTxid.slice(0, 12)}… — ` +
        `refusing to guess that nothing spent it.\n  ${(e as Error).message}`)
    }
    const list = Array.isArray(hist) ? hist : (Array.isArray(hist?.result) ? hist.result : null)
    if (!list) continue
    for (const h of list) {
      const id = h.tx_hash
      if (!id || id === tipTxid) continue
      /* ⚠ same rule one level down: a transaction we could not FETCH is not a transaction that
         fails to spend the tip. Only a genuine parse failure is safe to skip. */
      let cand: Transaction
      try { cand = await rawTx(id) }
      catch (e) {
        throw new Error(`could not fetch ${id.slice(0, 12)}… while walking — ` +
          `refusing to guess.\n  ${(e as Error).message}`)
      }
      if (spendsTip(cand, tipTxid, vout)) return id
    }
  }
  return null
}

/**
 * ★ WALK TO THE CURRENT BOARD. Every move spends the last one, so the output nothing has spent is the
 * game as it stands. ⇒ No index, no server, no database — the chain is the board.
 */
async function walk(genesis: string) {
  let txid = genesis, hops = 0
  for (;;) {
    const next = await spenderOf(txid, 0)
    if (!next) break
    txid = next; hops++
    if (hops > 200) die('walk did not terminate')
  }
  return { txid, hops }
}

/**
 * ★★ READ THE BOARD OUT OF ITS OWN LOCKING SCRIPT — and PROVE the reading by rebuilding.
 *
 * ⚠ This replaced replaying a move list. A move list is something the CALLER has to remember, and
 *   anyone arriving at a board they did not play has no such list. ⇒ The board is on the chain; read
 *   it from there. If the rebuilt script does not match byte for byte, return null rather than a guess.
 */
function decodeBoard(lock: LockingScript): OxoState | null {
  const head: number[][] = []
  for (const c of lock.chunks as any[]) { if (!c.data?.length) break; head.push([...c.data]) }
  if (head.length < 5) return null
  const le = (b: number[]) => b.reduceRight((v, x) => v * 256 + x, 0)
  const st = { board: le(head[0]), turn: le(head[1]), winner: le(head[2]),
               moves: le(head[3]), games: le(head[4]) } as OxoState
  try { return lockFor(st).toHex() === lock.toHex() ? st : null } catch { return null }
}

if (cmd === 'mint') {
  const wif = process.env.OXO_WIF
  if (LIVE && !wif) die('--broadcast needs OXO_WIF set in your own shell. It is never asked for.')
  const priv = wif ? PrivateKey.fromWif(wif) : PrivateKey.fromRandom()
  const addr = priv.toPublicKey().toAddress()
  const lock = lockFor(oxoNew())

  let src: Transaction, vout = 0, sats = 0
  if (LIVE) {
    const u: any[] = await woc(`/address/${addr}/unspent`)
    if (!u.length) die(`no funds at ${addr} — the board needs ${SATS} sat plus a fee`)
    /* ⚠⚠ WHATSONCHAIN'S UNSPENT LIST GOES STALE. Taking the biggest entry on faith is what produced
       "Missing inputs" — the output had already been spent by an earlier test and the index had not
       caught up. ⇒ Ask about each one before using it, and say what was found either way. */
    const need = SATS + 400
    console.log(`\n  funding address ${addr}`)
    let chosen: any = null
    for (const c of u.sort((a, b) => b.value - a.value)) {
      const r = await fetch(`${WOC}/tx/${c.tx_hash}/out/${c.tx_pos}/spent`)
      const live = r.status === 404
      const big = c.value >= need
      console.log(`    ${c.tx_hash.slice(0, 16)}…:${c.tx_pos}  ${String(c.value).padStart(9)} sat  ` +
        (!live ? '⚠ ALREADY SPENT — the index is stale' : big ? '★ usable' : '⚠ too small'))
      if (live && big && !chosen) chosen = c
    }
    if (!chosen) die(`nothing usable at ${addr}. The board needs ${need.toLocaleString()} sat in ` +
      `ONE output — top it up, or lower it with: set -x SATS 5000`)
    src = await rawTx(chosen.tx_hash); vout = chosen.tx_pos; sats = chosen.value
  } else {
    src = new Transaction()
    src.addOutput({ lockingScript: new P2PKH().lock(priv.toPublicKey().toHash()), satoshis: SATS * 3 })
  }
  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: vout,
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
const st = decodeBoard((tip.outputs[0] as any).lockingScript) ??
  die('that output is not an oxo board — is OXO_GENESIS right?')
const held = (tip.outputs[0] as any).satoshis

if (cmd === 'board') {
  console.log(`\n  ═══ THE BOARD, READ OFF THE CHAIN ═══\n`)
  console.log(oxoShow(st))
  console.log(`\n  ${st.moves} move${st.moves === 1 ? '' : 's'} this game · game ${st.games + 1}` +
              ` · ${held.toLocaleString()} sat left ⇒ about ${Math.floor((held - 1) / MAX_FEE)} more`)
  if (st.winner) console.log(`  ★ ${['', 'X WINS', 'O WINS', 'A DRAW'][st.winner]} — the next move ` +
                             `starts a fresh game`)
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
