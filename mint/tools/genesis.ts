// © 2026 sun-dive — Apache License 2.0.
// BRC-226 GO-LIVE — build + sign the canonical LiveCounter genesis LOCALLY, then broadcast when ready.
//
//   bundle:     node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/genesis.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/genesis.mjs'}))"
//   self-test:  node tools/genesis.mjs --selftest                 (no key, no network — proves the tool)
//   dry build:  GENESIS_WIF=<wif> node tools/genesis.mjs          (reads your UTXO, builds+signs, prints hex — no send)
//   broadcast:  GENESIS_WIF=<wif> node tools/genesis.mjs --broadcast
//
// The author/deployer key is REAL and KEPT (it collects the 1-sat crumbs and is repaid at tick 1). The
// counter it mints is IMMORTAL + OWNERLESS: a 1-sat bond that only ever ticks forward, no burn, no owner.
import { PrivateKey, Transaction, P2PKH, Spend } from '@bsv/sdk'
import { importWif } from '../src/wallet.ts'
import { buildGenesisTx, keyHash160 } from '../src/liveCounterTx.ts'
import { buildLiveCounterLock, GENESIS_MARK } from '../src/liveCounter.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB  = 'https://bananablocks.com/api/v1/bsv/main'
const getJson = async (p: string) => { const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json() }
const getText = async (p: string) => { const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.text() }
const eq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])

// Prove the whole tool with a throwaway key + a mock funder — no key, no network. Run this first.
async function selftest() {
  const key = PrivateKey.fromRandom()
  const src = new Transaction(); src.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 100000 })
  const tx = await buildGenesisTx({ key, funder: { sourceTransaction: src, outputIndex: 0 } })
  const input = tx.inputs[0]
  const spend = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 100000,
    lockingScript: new P2PKH().lock(key.toAddress()), transactionVersion: tx.version, otherInputs: [],
    outputs: tx.outputs, inputIndex: 0, unlockingScript: input.unlockingScript!, inputSequence: input.sequence ?? 0xffffffff, lockTime: tx.lockTime,
  })
  const h = keyHash160(key)
  const lock0 = buildLiveCounterLock({ n: 0, lastFunderHash: h, authorHash: h }).toBinary()
  const funderOk = spend.validate() === true
  const counterOk = eq(tx.outputs[0].lockingScript.toBinary(), lock0)
  console.log('self-test · funder-input valid :', funderOk)
  console.log('self-test · counter @ n=0 exact:', counterOk)
  console.log('self-test · genesis mark        :', GENESIS_MARK)
  console.log('self-test · signed tx bytes     :', tx.toHex().length / 2)
  console.log(funderOk && counterOk ? '\nSELFTEST OK — the tool builds a valid genesis. Safe to use with your real key.' : '\nSELFTEST FAIL')
  process.exit(funderOk && counterOk ? 0 : 1)
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest()

  const wif = process.env.GENESIS_WIF
  if (!wif) { console.error('Set GENESIS_WIF=<deployer WIF>  (or run --selftest first).'); process.exit(1) }
  const key = importWif(wif); const addr = key.toAddress()
  console.log('deployer / author address :', addr)

  const utxos = await getJson(`/address/${addr}/unspent`)
  const pick = (Array.isArray(utxos) ? utxos : []).filter((u: any) => u.value >= 500).sort((a: any, b: any) => a.value - b.value)[0]
  if (!pick) { console.error(`No funding UTXO ≥500 sat at ${addr} — send a little BSV there first.`); process.exit(1) }
  console.log('funding utxo              :', `${pick.tx_hash}:${pick.tx_pos} (${pick.value} sat)`)

  const src = Transaction.fromHex(await getText(`/tx/${pick.tx_hash}/hex`))
  const tx = await buildGenesisTx({ key, funder: { sourceTransaction: src, outputIndex: pick.tx_pos } })
  const raw = tx.toHex(), txid = tx.id('hex')

  console.log('\n── GENESIS · built + signed LOCALLY ──')
  console.log('mark    :', GENESIS_MARK, '  (n = 0)')
  console.log('txid    :', txid)
  console.log('bond    :', tx.outputs[0].satoshis, 'sat   (the immortal counter — output 0)')
  console.log('change  :', tx.outputs[tx.outputs.length - 1].satoshis, 'sat  →', addr)
  console.log('\nraw hex :\n' + raw + '\n')

  if (process.argv.includes('--broadcast')) {
    const w = await fetch(`${WOC}/tx/raw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }) })
    console.log('WoC broadcast   :', w.status, (await w.text()).trim())
    try {
      const b = await fetch(`${BB}/tx/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }) })
      console.log('BananaBlocks    :', b.status, (await b.text()).trim())
    } catch { console.log('BananaBlocks    : (skipped)') }
    console.log(`\n🐇 The white rabbit is on-chain. Now set tip.php:  $GENESIS_TXID = '${txid}'  then deploy.`)
  } else {
    console.log('(dry build — inspect the hex above. Re-run with --broadcast to send it.)')
    console.log(`canonical txid to publish + put in tip.php:  ${txid}`)
  }
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
