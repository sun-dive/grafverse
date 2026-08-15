// © BSV Association — Open BSV License v6.
// THE FUEL DEPOT — mint it, fill it, and tap it for a car anyone can drive.
//
//   bundle:    node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/depot.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/depot.mjs'}))"
//   self-test: node tools/depot.mjs --selftest                 (no key, no network)
//   mint:      DEPOT_WIF=<wif> node tools/depot.mjs --genesis --fuel 11500 --broadcast
//   status:    DEPOT_WIF=<wif> node tools/depot.mjs --status
//   a car:     DEPOT_WIF=<wif> node tools/depot.mjs --draw --broadcast
//
// ⚠ WIF VIA ENV ONLY — never a flag, never a file. In fish:  read -s -P 'WIF: ' w; set -x DEPOT_WIF $w
//
// ── ★ WHAT THIS IS ACTUALLY DEMONSTRATING ─────────────────────────────────────────────────────────
// Two covenants that cannot read each other, agreeing inside one transaction. The depot rebuilds
// itself and insists that what leaves the tank arrives in a car whose script hashes to a constant it
// was born knowing. The car, independently, refuses to hold more than its own ceiling. Neither trusts
// the other, and neither had to — it is all dressed up as a drag race.
//
// ── ⚠ THE KEY IS PERMANENT ────────────────────────────────────────────────────────────────────────
// The depot bakes in `carScript`, which is the PUBLIC CAR'S LOCK FOR ONE OWNER. Change the key and it
// is a different car script, a different hash, and a depot that can never mint a car again. The same
// key is also the only one that can ever retire a depot or burn a car.
//
// ── ⚠ AND THE TANK HAS NO RESCUE HATCH ────────────────────────────────────────────────────────────
// The owner may burn a depot only BELOW `DEPOT_BURN_BELOW` (913) — a husk, never a funded tank. So:
//
//   retiring it for a better one   ✓  deploy the successor, let this one drain through racing, clear the husk
//   a bug that strands the fuel    ✗  the burn refuses for the same reason it refuses a funded tank
//
// ⇒ Fund it small until the path is proven. That is not caution, it is the only mitigation there is.
import { PrivateKey, Transaction, P2PKH, Spend, TransactionSignature, SatoshisPerKilobyte, Hash, Utils } from '@bsv/sdk'
import { importWif } from '../src/wallet.ts'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK,
  DEPOT_BURN_BELOW,
} from '../src/depot.ts'
import { buildShellLock, SHELL_MAX_FEE, SHELL_FEE_PER_KB, SHELL_TANK_MAX } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
const getJson = async (p: string): Promise<any> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json()
}
const getText = async (p: string): Promise<string> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.text()
}
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const has = (n: string): boolean => process.argv.includes(n)
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined
}
const u64 = (n: number): number[] => {
  const b: number[] = []; let x = n; for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b
}
const sat = (n: number): string => n.toLocaleString()

/** The two scripts, derived from one key. The car's script is what the depot is born knowing. */
function scripts(ownerHash: number[]) {
  const car = buildShellLock({ state: freshPublicShell(ownerHash), maxFee: SHELL_MAX_FEE, public: true })
  const depot = buildDepotLock({ carScript: car.toBinary(), owner: ownerHash })
  return { car, depot }
}

/**
 * ★ ONE TAP OF THE PUMP — the depot spends itself into a smaller depot and a car.
 *
 * ⚠ NO SIGNATURE ANYWHERE. The depot asks for a key only to burn, and a public car never asks at all,
 * so this whole transaction is authorised by arithmetic. That is the point: a visitor with no wallet,
 * no key and no satoshi can be handed a fuelled car.
 */
function buildDraw(o: {
  depotTx: Transaction; vout: number; tank: number; carValue: number
  car: { toBinary(): number[] }; depot: { toBinary(): number[] }
}): { tx: Transaction; ok: boolean; kept: number; fee: number } {
  const kept = o.tank - o.carValue - DEPOT_MAX_FEE
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.depotTx, sourceOutputIndex: o.vout, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: o.depot as any, satoshis: kept })
  tx.addOutput({ lockingScript: o.car as any, satoshis: o.carValue })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: o.depotTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.tank,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: o.depot as any, lockTime: 0, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(kept), preimage: pre,
  })
  let ok = false
  try {
    ok = new Spend({
      sourceTXID: o.depotTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.tank,
      lockingScript: o.depot as any, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
      inputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0,
    }).validate() === true
  } catch { /* refused */ }
  return { tx, ok, kept, fee: o.tank - kept - o.carValue }
}

async function broadcast(raw: string): Promise<void> {
  const w = await fetch(`${WOC}/tx/raw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }),
  })
  const t = (await w.text()).trim()
  console.log('   WoC          :', w.status, t)
  if (!w.ok) throw new Error(`broadcast rejected: ${t}`)
  try {
    const b = await fetch(`${BB}/tx/broadcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }),
    })
    console.log('   BananaBlocks :', b.status, (await b.text()).trim())
  } catch { console.log('   BananaBlocks : (skipped)') }
}

// ── SELF-TEST — the whole thing with a throwaway key and no network ───────────────────────────────
async function selftest(): Promise<never> {
  const key = PrivateKey.fromRandom()
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)
  let pass = 0, fail = 0
  const check = (n: string, got: boolean, want = true): void => {
    const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
  }

  console.log('THE FUEL DEPOT — self-test\n')
  console.log(`        depot ${depot.toBinary().length} B · car ${car.toBinary().length} B`)
  console.log(`        hash  ${Utils.toHex(Hash.sha256(car.toBinary())).slice(0, 16)}…  ← what the depot was born knowing`)
  console.log(`        DRAW ${sat(DEPOT_DRAW)} · MAX_TANK ${sat(DEPOT_MAX_TANK)} · MAX_FEE ${DEPOT_MAX_FEE} · BURN_BELOW ${DEPOT_BURN_BELOW}\n`)

  const TANK = 11_500
  const src = new Transaction(); src.addOutput({ lockingScript: depot, satoshis: TANK })
  const d = buildDraw({ depotTx: src, vout: 0, tank: TANK, carValue: DEPOT_DRAW, car, depot })
  check('★★ the depot mints a car — two covenants, one transaction, no signature', d.ok)
  const size = d.tx.toHex().length / 2
  const rate = d.fee * 1000 / size
  console.log(`        ${size} B · fee ${d.fee} sat = ${rate.toFixed(1)} sat/KB · depot keeps ${sat(d.kept)}`)
  check('  …and the fee clears the relay floor', rate >= SHELL_FEE_PER_KB)

  /* ⚠ PROVOKE THE GUARDS. Every check above passes just as well against a depot that agrees to
     anything, so each refusal it is supposed to make is demanded here. */
  const over = buildDraw({ depotTx: src, vout: 0, tank: TANK, carValue: DEPOT_DRAW + 1, car, depot })
  check('★ a draw of MORE than one tap is REFUSED', over.ok, false)
  const wrongCar = buildDraw({
    depotTx: src, vout: 0, tank: TANK, carValue: DEPOT_DRAW, depot,
    car: buildShellLock({ state: freshPublicShell(owner), maxFee: SHELL_MAX_FEE }),   // the OWNED variant
  })
  check('★★ fuel into the WRONG car script is REFUSED — the hash is doing the work', wrongCar.ok, false)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  console.log(fail === 0
    ? 'SELFTEST OK — the depot mints a real car. Safe to use with your real key.'
    : '⚠ SELFTEST FAILED')
  process.exit(fail === 0 ? 0 : 1)
}

// ── GENESIS — put the tank on chain ───────────────────────────────────────────────────────────────
async function genesis(): Promise<void> {
  const wif = process.env.DEPOT_WIF
  if (!wif) { console.error('Set DEPOT_WIF=<owner WIF>  (or run --selftest first — it needs no key).'); process.exit(1) }
  const fuel = Number(arg('--fuel') ?? 11_500)
  if (!Number.isInteger(fuel) || fuel < DEPOT_DRAW + DEPOT_MAX_FEE) {
    console.error(`--fuel must be an integer ≥ ${sat(DEPOT_DRAW + DEPOT_MAX_FEE)} (one tap plus its fee)`); process.exit(1)
  }
  const key = importWif(wif), addr = key.toAddress()
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)

  console.log('owner address :', addr)
  console.log('car script    :', car.toBinary().length, 'B · hash',
    Utils.toHex(Hash.sha256(car.toBinary())).slice(0, 16) + '…')
  console.log('depot script  :', depot.toBinary().length, 'B')

  /* ⚠ GATHERS COINS, RATHER THAN DEMANDING ONE BIG ONE. The battery's tool takes the smallest single
     UTXO that covers the job, which is right for a covenant SPEND — one input is all a covenant can
     use. A genesis is an ordinary payment though, and insisting on one coin means a wallet holding
     plenty across several is told it has none. Largest first, so it takes as few as it can. */
  const utxos = await getJson(`/address/${addr}/unspent`)
  const all = (Array.isArray(utxos) ? utxos : []).sort((a: any, b: any) => b.value - a.value)
  const need = fuel + 500
  const picked: any[] = []
  let have = 0
  for (const u of all) { if (have >= need) break; picked.push(u); have += u.value }
  if (have < need) {
    console.error(`Only ${sat(have)} sat spendable at ${addr}, and the depot needs ${sat(need)}.`)
    console.error(`Send a little BSV there, or lower --fuel (minimum ${sat(DEPOT_DRAW + DEPOT_MAX_FEE)}).`)
    process.exit(1)
  }
  console.log('funding       :', `${picked.length} utxo(s), ${sat(have)} sat`)
  for (const u of picked) console.log('               ', `${u.tx_hash.slice(0, 16)}…:${u.tx_pos}  ${sat(u.value)}`)

  const tx = new Transaction(); tx.version = 2
  for (const u of picked) {
    const srcTx = Transaction.fromHex(await getText(`/tx/${u.tx_hash}/hex`))
    tx.addInput({ sourceTransaction: srcTx, sourceOutputIndex: u.tx_pos,
                  unlockingScriptTemplate: new P2PKH().unlock(key), sequence: 0xffffffff })
    await sleep(250)                                    // ⚠ pace it — WoC throttles a burst of these
  }
  tx.addOutput({ lockingScript: depot, satoshis: fuel })
  tx.addOutput({ lockingScript: new P2PKH().lock(addr), change: true })
  await tx.fee(new SatoshisPerKilobyte(SHELL_FEE_PER_KB))
  await tx.sign()

  console.log(`\n── THE DEPOT ──`)
  console.log('txid   :', tx.id('hex'))
  console.log('tank   :', sat(fuel), 'sat   (output 0)')
  console.log('change :', sat(tx.outputs[1].satoshis ?? 0), 'sat →', addr)
  console.log('taps   :', Math.floor((fuel - DEPOT_MAX_FEE) / DEPOT_DRAW), 'car(s) it can fuel before it needs topping up')
  if (has('--broadcast')) { await broadcast(tx.toHex()); console.log('        BROADCAST ✓') }
  else console.log('\n(dry build — nothing was sent. Re-run with --broadcast.)')
  console.log('\n⚠ KEEP THIS TXID. Everything else refers to it, and there is no index that will find it for you.')
}

// ── DRAW — one tap, into a brand new car ──────────────────────────────────────────────────────────
async function draw(): Promise<void> {
  const wif = process.env.DEPOT_WIF
  if (!wif) { console.error('Set DEPOT_WIF=<owner WIF>.'); process.exit(1) }
  const depotTxid = arg('--depot')
  if (!depotTxid) { console.error('--depot <txid>  (the depot genesis, or its latest spend)'); process.exit(1) }
  const vout = Number(arg('--vout') ?? 0)

  const key = importWif(wif)
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)

  const dTx = Transaction.fromHex(await getText(`/tx/${depotTxid}/hex`))
  const tank = dTx.outputs[vout]?.satoshis ?? 0
  const onChain = Utils.toHex(dTx.outputs[vout]?.lockingScript.toBinary() ?? [])
  if (onChain !== Utils.toHex(depot.toBinary())) {
    console.error(`⚠ ${depotTxid}:${vout} is not this depot's script — wrong txid, wrong vout, or wrong key.`)
    process.exit(1)
  }
  console.log('depot   :', `${depotTxid}:${vout}`, '·', sat(tank), 'sat')

  const carValue = Math.min(DEPOT_DRAW, tank - DEPOT_MAX_FEE)
  if (carValue < 1) { console.error(`the tank holds ${sat(tank)} — not enough for one tap plus its fee.`); process.exit(1) }
  const d = buildDraw({ depotTx: dTx, vout, tank, carValue, car, depot })
  if (!d.ok) { console.error('the depot refused this draw before it was ever sent.'); process.exit(1) }

  const size = d.tx.toHex().length / 2
  console.log(`\n── ONE TAP ──`)
  console.log('txid    :', d.tx.id('hex'))
  console.log('depot   :', sat(d.kept), 'sat   (output 0 — the tank, smaller)')
  console.log('car     :', sat(carValue), 'sat   (output 1 — an EMPTY public car, anyone may drive it)')
  console.log('fee     :', d.fee, `sat · ${size} B · ${(d.fee * 1000 / size).toFixed(1)} sat/KB`)
  console.log('signed  : NOTHING — no key was used to authorise this')
  if (has('--broadcast')) { await broadcast(d.tx.toHex()); console.log('        BROADCAST ✓') }
  else console.log('\n(dry build — nothing was sent. Re-run with --broadcast.)')
  console.log(`\n★ the car is ${d.tx.id('hex')}:1 — configure and race it.`)
}

// ── STATUS ────────────────────────────────────────────────────────────────────────────────────────
async function status(): Promise<void> {
  const wif = process.env.DEPOT_WIF
  if (!wif) { console.error('Set DEPOT_WIF=<owner WIF>.'); process.exit(1) }
  const txid = arg('--depot')
  if (!txid) { console.error('--depot <txid>'); process.exit(1) }
  const vout = Number(arg('--vout') ?? 0)
  const key = importWif(wif)
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)
  const tx = Transaction.fromHex(await getText(`/tx/${txid}/hex`))
  const out = tx.outputs[vout]
  const isDepot = out && Utils.toHex(out.lockingScript.toBinary()) === Utils.toHex(depot.toBinary())
  const tank = out?.satoshis ?? 0
  console.log('depot        :', `${txid}:${vout}`)
  console.log('is our depot :', isDepot ? 'yes' : '⚠ NO — wrong txid/vout, or a different owner key')
  console.log('tank         :', sat(tank), 'sat')
  console.log('taps left    :', Math.max(0, Math.floor((tank - DEPOT_MAX_FEE) / DEPOT_DRAW)))
  console.log('burnable     :', tank < DEPOT_BURN_BELOW
    ? `yes — a husk under ${DEPOT_BURN_BELOW}, the owner may clear it`
    : `no — holds ${sat(tank)}, and the burn refuses anything at or above ${DEPOT_BURN_BELOW}`)
  console.log('car script   :', Utils.toHex(Hash.sha256(car.toBinary())).slice(0, 16) + '…',
    `· a car may hold at most ${sat(SHELL_TANK_MAX)}`)
}

async function main(): Promise<void> {
  if (has('--selftest')) return selftest()
  if (has('--genesis')) return genesis()
  if (has('--draw')) return draw()
  if (has('--status')) return status()
  console.log('usage: --selftest | --genesis [--fuel n] | --draw --depot <txid> [--vout n] | --status --depot <txid>')
  console.log('       add --broadcast to send. WIF via DEPOT_WIF only.')
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
