// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ 4 8 15 16 23 42 — PUT THE SCRIPT ON CHAIN.
 *
 * The LOST numbers are a valid Bitcoin script. This proves it on mainnet rather than by assertion.
 *
 * ⚠⚠ WHY TWO TRANSACTIONS, AND IT IS THE POINT: **an output's script is NOT executed when it is
 * created, only when it is SPENT.** Creating it proves RELAY. Only the spend proves EXECUTION.
 * → the probe rule in `~/Documents/TODO.md`, applied to a joke.
 *
 *   tx1  out0  the 119-byte LOST script, funded            ⇒ proves it RELAYED
 *        out1  OP_RETURN, plain text                       ⇒ an explorer renders it READABLE
 *        out2  change back to the funding address
 *   tx2        spends out0 with an EMPTY unlocking script  ⇒ proves a node RAN it
 *
 * ★ WHY IT IS VALID. Bytes 0x01–0x4b are direct-push opcodes — "push the next N bytes" — and every
 * LOST number is one, each pushing EXACTLY ITS OWN VALUE. Self-describing. The six payloads total 108:
 * the Swan's timer, and the entry count of Bitcoin 0.1's opcode enum. Five OP_CAT fold them into one.
 *
 * ⚠⚠ IT IS A COINCIDENCE WITH A MECHANICAL EXPLANATION. ANY six numbers under 76 do this. Nothing was
 * planted, and any writing about it must say so first and loudest. The finding is not a hidden message
 * — it is that a byte-addressed machine anyone can interrogate will always yield meaning, which is why
 * a pseudonymous founder plus an inspectable artefact produced a myth whether anyone intended one.
 *
 * ⚠ OP_CAT (0x7e) is live in 0.1 and on BSV, DISABLED on Core since 2010. Runs here, not there.
 * ⚠ The bare six pushes fail only the CLEAN-STACK rule, which did not exist in 0.1.
 *
 * ★★★ BROADCAST 23 Aug 2026 — 70 sat all in:
 *   relay     5908372b1d458df0560c4970be5f05d4b91569c7de4c895e15c3471cc39f7ccf
 *   execution fb64ce7accc0e26058686d8c181cdb39615dcace826996770b3699f8178ffb7f
 *   ⇒ `/tx/5908…/0/spent` returns the second txid: **a node RAN the LOST numbers and the script
 *     returned true.** Not a claim any more.
 *
 * ⚠⚠⚠ TWO TRAPS THIS TOOL HANDLES, BOTH PAID FOR ALREADY:
 *  1. `out0` MUST FUND tx2's OWN FEE. At 1 sat, tx2 could never be broadcast and the proof of
 *     EXECUTION — the half that matters — would be impossible. It carries `OUT0_SATS`.
 *  2. `out0` IS ANYONE-CAN-SPEND by construction (an empty unlocking script satisfies it), so it must
 *     not sit holding coin. Both are broadcast BACK TO BACK, tx2 spending tx1 unconfirmed.
 *
 * USAGE — the key never leaves your shell, and nothing is sent without --send:
 *   read -s -x LOST_WIF              # ★ fish: silent, and NEVER enters shell history
 *                                   #   (`set -x LOST_WIF …` would write it to fish_history in clear)
 *   npx tsx tools/lost.ts            # dry run: fetch, build, validate, print. SENDS NOTHING.
 *   npx tsx tools/lost.ts --send     # broadcast tx1 then tx2
 */
import { Transaction, LockingScript, UnlockingScript, Spend, P2PKH, PrivateKey, OP,
         SatoshisPerKilobyte } from '@bsv/sdk'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
const FEE_PER_KB = 100                 // ⚠ the official rate. Never inflated. → fee-rate policy.
const OUT0_SATS = 300                  // funds tx2's fee; see trap 1

/** ★ the six numbers, and what each pushes — sun-dive's copy, 23 Aug 2026 */
export const LOST_NUMBERS = [4, 8, 15, 16, 23, 42] as const
export const LOST_PAYLOAD = [
  'LOST',
  'the Swan',
  'push the button',
  'the timer resets',
  'a covenant nobody reads',
  'so we built a reader. you can read it now.',
] as const

const INSCRIPTION =
  '4 8 15 16 23 42 is a valid Bitcoin script. Each number is a push opcode that pushes exactly its ' +
  'own value in bytes; the six payloads total 108. Any six numbers under 76 would do this - nothing ' +
  'was planted. That is the finding: an inspectable machine always yields meaning.'

/** ⚠ Throws if any payload is not EXACTLY its own byte count — that constraint IS the finding. */
export function lostScript(): LockingScript {
  const b: number[] = []
  LOST_PAYLOAD.forEach((p, i) => {
    const d = Array.from(Buffer.from(p, 'utf8'))
    const n = LOST_NUMBERS[i]
    if (d.length !== n) throw new Error(`payload ${i}: need exactly ${n} bytes, got ${d.length}`)
    b.push(n, ...d)                    // <n> is BOTH the opcode and the length
  })
  for (let i = 0; i < LOST_NUMBERS.length - 1; i++) b.push(OP.OP_CAT)
  return LockingScript.fromHex(Buffer.from(b).toString('hex'))
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * ⚠⚠ BACK OFF, DO NOT GIVE UP — the lesson already paid for in `tools/racer.ts` and
 * `tools/leaderboard.ts`. A 429 is WoC's CDN saying "not so fast", not the network objecting. The
 * first version of this tool died on one and printed an error that looked like a real failure.
 * ★ It still REFUSES to guess on any other status — see `spendable()`. Backing off and lying are
 *   different things.
 */
const RETRY_BACKOFF_MS = [2000, 5000, 12000, 30000]

async function woc(path: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(WOC + path)
    if (r.status !== 429 || attempt >= RETRY_BACKOFF_MS.length) return r
    const wait = RETRY_BACKOFF_MS[attempt]
    console.log(`  …throttled by WoC, waiting ${wait / 1000}s`)
    await sleep(wait)
  }
}
async function getJson(p: string): Promise<any> {
  const r = await woc(p)
  if (!r.ok) throw new Error(`WoC ${p} -> ${r.status}`)
  return r.json()
}

/**
 * ★★ SPENDABLE COINS — lifted from `tools/depot.ts`, where it was learned the hard way.
 * `/unspent` is an INDEX and it LAGS THE MEMPOOL; `/spent` answers about the outpoint itself.
 * ⚠⚠ ONLY A 404 MEANS UNSPENT. Any other outcome must STOP, never be read as "fine" — a failure that
 * resembles a pass would rebuild the exact bug this function exists to prevent.
 */
async function spendable(addr: string, need: number): Promise<any[]> {
  const all = (await getJson(`/address/${addr}/unspent`) as any[])
    .sort((a, b) => a.value - b.value)              // ★ SMALLEST first: never disturb a big coin
  const picked: any[] = []
  let have = 0
  for (const u of all) {
    if (have >= need) break
    const r = await woc(`/tx/${u.tx_hash}/${u.tx_pos}/spent`)
    await sleep(250)
    if (r.status !== 404 && !r.ok) {
      console.error(`  Cannot tell whether ${u.tx_hash.slice(0, 16)}…:${u.tx_pos} is spent (WoC ${r.status}).`)
      console.error('  Refusing to guess — try again in a moment.')
      process.exit(1)
    }
    if (r.ok) { console.log(`  ⚠ skipping ${u.tx_hash.slice(0, 16)}…:${u.tx_pos} — already spent`); continue }
    picked.push(u); have += u.value
  }
  if (have < need) { console.error(`  Not enough: need ${need} sat, found ${have}.`); process.exit(1) }
  return picked
}

async function broadcast(raw: string, label: string): Promise<string> {
  const w = await fetch(`${WOC}/tx/raw`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }) })
  const wt = (await w.text()).trim().replace(/^"|"$/g, '')
  if (w.ok) { console.log(`  ${label} broadcast via WoC: ${wt}`); return wt }
  console.log(`  WoC refused ${label} (${w.status}): ${wt.slice(0, 160)}`)
  const b = await fetch(`${BB}/tx/broadcast`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }) })
  const bt = (await b.text()).trim()
  if (!b.ok) throw new Error(`both relays refused ${label}: ${bt.slice(0, 200)}`)
  console.log(`  ${label} broadcast via BananaBlocks: ${bt.slice(0, 120)}`)
  return bt
}

async function main(): Promise<void> {
  const send = process.argv.includes('--send')
  const lock = lostScript()

  console.log('\n★ THE SCRIPT')
  console.log('  bytes :', lock.toHex().length / 2, '(6 pushes carrying 108 B, then 5 x OP_CAT)')
  console.log('  hex   :', lock.toHex())
  console.log('  pushes:', LOST_NUMBERS.map(n => '0x' + n.toString(16).padStart(2, '0')).join(' '),
    '=', LOST_NUMBERS.join(' '))
  LOST_PAYLOAD.forEach((p, i) => console.log(`    ${String(LOST_NUMBERS[i]).padStart(2)} B  ${JSON.stringify(p)}`))

  const wif = process.env.LOST_WIF
  if (!wif) { console.log('\n⚠ LOST_WIF not set. Nothing fetched, nothing built, nothing sent.'); return }
  const key = PrivateKey.fromWif(wif)
  const addr = key.toAddress()
  console.log('\n  funding address:', addr)

  const need = OUT0_SATS + 400
  console.log(`  looking for ${need} sat (smallest coins first)…`)
  const utxos = await spendable(addr, need)
  console.log(`  using ${utxos.length} coin(s), ${utxos.reduce((a, u) => a + u.value, 0)} sat`)

  /* ── tx1 ── */
  const tx1 = new Transaction()
  for (const u of utxos) {
    const raw = await woc(`/tx/${u.tx_hash}/hex`).then(r => r.text())
    await sleep(250)
    tx1.addInput({ sourceTransaction: Transaction.fromHex(raw), sourceOutputIndex: u.tx_pos,
                   unlockingScriptTemplate: new P2PKH().unlock(key), sequence: 0xffffffff })
  }
  tx1.addOutput({ satoshis: OUT0_SATS, lockingScript: lock })
  tx1.addOutput({ satoshis: 0, lockingScript: LockingScript.fromASM(
    'OP_FALSE OP_RETURN ' + Buffer.from(INSCRIPTION, 'utf8').toString('hex')) })
  tx1.addOutput({ lockingScript: new P2PKH().lock(addr), change: true })
  /* ⚠ NOT a hand-rolled fee model: mine called `toBinary()` on an input that still only had a
     TEMPLATE, and threw "unlockingScript is undefined". `SatoshisPerKilobyte` knows how to size an
     unsigned input — the same one `batteryTx.ts` uses. Never hand-count a fee. */
  await tx1.fee(new SatoshisPerKilobyte(FEE_PER_KB))
  await tx1.sign()
  const tx1hex = tx1.toHex(); const tx1id = tx1.id('hex')

  /* ── tx2: the half that matters ── */
  const tx2 = new Transaction()
  tx2.addInput({ sourceTransaction: tx1, sourceOutputIndex: 0,
                 unlockingScript: new UnlockingScript([]), sequence: 0xffffffff })
  /* ★ MEASURE, DO NOT GUESS — but ⚠⚠ NEVER MEASURE THEN MUTATE. `toBinary()` CACHES the
     serialization, so assigning `outputs[0].satoshis` afterwards left the cache stale: the tool
     printed "fee 9 sat" while the bytes actually paid 1 — 11.8 sat/KB, an eighth of the floor, and
     it would have been refused. → the @bsv/sdk serialization-cache trap, the same one that silently
     drops a signature after `fromHex` + mutate.
     ⇒ Measure on a THROWAWAY, then build the real transaction once and never touch it again. */
  const probe2 = new Transaction()
  probe2.addInput({ sourceTransaction: tx1, sourceOutputIndex: 0,
                    unlockingScript: new UnlockingScript([]), sequence: 0xffffffff })
  probe2.addOutput({ satoshis: OUT0_SATS - 1, lockingScript: new P2PKH().lock(addr) })
  const fee2 = Math.max(1, Math.ceil(probe2.toBinary().length / 1000 * FEE_PER_KB))
  tx2.addOutput({ satoshis: OUT0_SATS - fee2, lockingScript: new P2PKH().lock(addr) })
  const tx2hex = tx2.toHex(); const tx2id = tx2.id('hex')

  /* ⚠⚠ AND VERIFY THE BYTES, NOT THE VARIABLES. Decode what will actually be broadcast and check the
     fee against the floor. The printed number and the transaction are different objects — that is
     precisely how the bug above got as far as a dry run looking correct. */
  const check = Transaction.fromHex(tx2hex)
  const paid = OUT0_SATS - (check.outputs[0].satoshis as number)
  const rate = paid / (tx2hex.length / 2) * 1000
  if (rate < FEE_PER_KB) {
    throw new Error(`tx2 pays ${paid} sat over ${tx2hex.length / 2} B = ${rate.toFixed(1)} sat/KB, ` +
      `under the ${FEE_PER_KB} floor. Refusing to broadcast.`)
  }
  console.log(`  tx2 fee verified from the bytes: ${paid} sat = ${rate.toFixed(1)} sat/KB`)

  /* ⚠ prove tx2 evaluates BEFORE anything is broadcast */
  const ok = new Spend({
    sourceTXID: tx1id, sourceOutputIndex: 0, sourceSatoshis: OUT0_SATS, lockingScript: lock,
    transactionVersion: tx2.version, otherInputs: [], outputs: tx2.outputs, inputIndex: 0,
    unlockingScript: tx2.inputs[0].unlockingScript!, inputSequence: 0xffffffff, lockTime: tx2.lockTime,
  }).validate()
  console.log('\n★ tx2 against the interpreter (local):', ok ? 'VALID' : 'INVALID')
  if (!ok) throw new Error('refusing to broadcast: the spend does not evaluate')

  console.log('\n  tx1', tx1id, `${tx1hex.length / 2} B, fee ${tx1.getFee()} sat`)
  console.log('  tx2', tx2id, `${tx2hex.length / 2} B, fee ${fee2} sat`)
  if (!send) {
    console.log('\n  DRY RUN — nothing broadcast. Re-run with --send when you are happy.')
    console.log('\n  tx1 hex:\n', tx1hex, '\n\n  tx2 hex:\n', tx2hex)
    return
  }
  console.log('\n  broadcasting back to back (out0 is anyone-can-spend — see trap 2)…')
  await broadcast(tx1hex, 'tx1')
  await broadcast(tx2hex, 'tx2')
  /* ⚠ the EXPLORER host, not the API host — api.whatsonchain.com/tx/… is not browsable */
  console.log(`\n★ DONE\n  relay    : https://whatsonchain.com/tx/${tx1id}`)
  console.log(`  execution: https://whatsonchain.com/tx/${tx2id}`)
  console.log('\n  ⚠ clear the key:  set -e LOST_WIF')
}

main().catch((e: unknown) => { console.error('lost:', (e as Error).message); process.exit(1) })
