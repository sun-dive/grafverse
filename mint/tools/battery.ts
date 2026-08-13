// © BSV Association — Open BSV License v6.
// THE BATTERY — build, sign and broadcast the genesis LOCALLY, then advance it with KEYLESS ticks.
//
// ⚠ RUN THE SOURCE, NOT A BUNDLE. There used to be a tools/battery.mjs built by esbuild, and on
// 2026-08-13 it was a day stale: it still carried grid 256x192, MX0 6, MAX_FEE 312 — the covenant this
// one replaces. Running it to mint would have permanently created the wrong battery, silently, because
// a bundle looks identical to its source from the command line. It has been DELETED. Node runs
// TypeScript directly, so there is nothing to keep in sync and no way for the two to disagree.
//
//   self-test:  node --experimental-strip-types tools/battery.ts --selftest        (no key, no network)
//   status:     node --experimental-strip-types tools/battery.ts --status
//   tick:       node --experimental-strip-types tools/battery.ts --tick 20 --broadcast   (NO KEY)
//   top up:     BATTERY_WIF=<wif> node --experimental-strip-types tools/battery.ts --topup 1000000 --mark "…" --broadcast
//   genesis:    BATTERY_WIF=<wif> node --experimental-strip-types tools/battery.ts --genesis --fuel 2100 --broadcast
//
// ★ A NEW GENESIS IS BEING MINTED (2026-08-13). The battery live until now — genesis d9a55ddb6c52bc-
// 51425f3c9e1416033179899e76abd634deda4510eed3790146, block 961,975 — was built at 256x192 with MX0 6,
// which draws the first frame with about 10% of the image painted as solid interior that is not: a
// blob rather than a Mandelbrot. That number is fixed in the covenant and there is no key to amend it,
// so it is being replaced at 3840x2160, MX0 128, K 128, MAX_FEE 314.
//
// ⚠ USE A SEPARATE STATE FILE. --genesis refuses to run if one is already recorded, which is the right
// guard; point BATTERY_STATE at a new path rather than deleting the old record, which is the only
// local trace of the first battery.
//
// The deployer key funds the genesis and receives the change. It has NO authority over the battery
// afterwards — there is no key that can amend, stop or drain it. Ticking needs no key at all: the
// OP_PUSH_TX preimage IS the authorisation, so anyone can advance it with nothing at stake. Only a
// top-up is signed, because only a top-up spends someone's money.
import { PrivateKey, Transaction, P2PKH, Spend } from '@bsv/sdk'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { importWif } from '../src/wallet.ts'
import { buildBatteryGenesisTx, buildBatteryTickTx, buildBatteryTopUpTx, nextBatteryUtxo, type BatteryUtxo } from '../src/batteryTx.ts'
import {
  buildBatteryLock, genesisState, refState, ticksRemaining, S,
  BATTERY_MAX_FEE, BATTERY_GEOMETRY, BATTERY_STATE_LAYOUT,
  type BatteryState, type BatteryGeometry,
} from '../src/battery.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
/** Kept OUTSIDE the repo — the grafverse repo is public, and this is working state, not source. */
const STATE_FILE = process.env.BATTERY_STATE ?? join(homedir(), 'Documents', 'battery-rehearsal.json')

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string): boolean => process.argv.includes(name)
const eq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

const getJson = async (p: string): Promise<any> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json()
}
const getText = async (p: string): Promise<string> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.text()
}

/** Working state of a rehearsal: where the battery is now, and how many ticks it has taken. */
/**
 * A battery's own parameters travel WITH its state record.
 *
 * They used to come from BATTERY_GEOMETRY, so the tool could only operate the battery whose constants
 * happened to be compiled in. The moment the genesis moved to 3840x2160, the 256x192 battery already
 * on chain became untickable: stateAfter() would replay the wrong machine and buildBatteryTickTx would
 * build the wrong lock, producing a transaction that looks fine and that the covenant rejects.
 *
 * A battery IS its constants. Recording them beside its txid is the only arrangement in which
 * "advance the battery in this file" cannot come to mean something else next week.
 */
interface Rehearsal {
  genesisTxid: string; tipTxid: string; ticks: number; fuel: number
  geometry?: BatteryGeometry; maxFee?: number
}

/** The battery minted before geometry was recorded. An absent field means this one. */
const LEGACY_GEOMETRY: BatteryGeometry = {
  W: 256, H: 192, SPAN0: 4.0,
  TX: Math.round(-1.423288564770 * S), TY: Math.round(0.127278891029 * S),
  MX0: 6, K: 4, MXCAP: 32767,
}
const LEGACY_MAX_FEE = 312
/** The constants of the battery a record describes — its own, not whatever is compiled in today. */
function paramsOf(st: Rehearsal): { geometry: BatteryGeometry; maxFee: number } {
  return { geometry: st.geometry ?? LEGACY_GEOMETRY, maxFee: st.maxFee ?? LEGACY_MAX_FEE }
}
const loadState = (): Rehearsal | null =>
  existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Rehearsal : null
const saveState = (s: Rehearsal): void => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n')

/** The state after `n` ticks — derived, never stored. Anyone can recompute this from the genesis alone. */
function stateAfter(n: number, g: BatteryGeometry = BATTERY_GEOMETRY): BatteryState {
  let s = genesisState(g)
  for (let k = 0; k < n; k++) s = refState(s, g)
  return s
}

async function broadcast(raw: string): Promise<void> {
  const w = await fetch(`${WOC}/tx/raw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }),
  })
  const wText = (await w.text()).trim()
  console.log('   WoC          :', w.status, wText)
  if (!w.ok) throw new Error(`broadcast rejected: ${wText}`)
  try {
    const b = await fetch(`${BB}/tx/broadcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }),
    })
    console.log('   BananaBlocks :', b.status, (await b.text()).trim())
  } catch { console.log('   BananaBlocks : (skipped)') }
}

/** Wait until a node acknowledges the tx, so the next tick does not race its own parent. */
async function awaitInMempool(txid: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${WOC}/tx/hash/${txid}`); if (r.ok) return true } catch { /* keep waiting */ }
    await sleep(1500)
  }
  return false
}

// ── self-test: prove the whole tool with a throwaway key and a mock funder ───────────────────────────
async function selftest(): Promise<never> {
  const key = PrivateKey.fromRandom()
  const src = new Transaction()
  src.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 100_000 })

  const FUEL = 8_000
  const tx = await buildBatteryGenesisTx({ key, funder: { sourceTransaction: src, outputIndex: 0 }, fuelSats: FUEL })
  const input = tx.inputs[0]
  const spend = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 100_000,
    lockingScript: new P2PKH().lock(key.toAddress()), transactionVersion: tx.version, otherInputs: [],
    outputs: tx.outputs, inputIndex: 0, unlockingScript: input.unlockingScript!,
    inputSequence: input.sequence ?? 0xffffffff, lockTime: tx.lockTime,
  })
  const funderOk = spend.validate() === true
  const s0 = genesisState()
  const batteryOk = eq(tx.outputs[0].lockingScript.toBinary(), buildBatteryLock({ state: s0 }).toBinary())

  // and a keyless tick off it, validated through the interpreter
  const tick = await buildBatteryTickTx({ battery: { sourceTransaction: tx, outputIndex: 0, state: s0, value: FUEL } })
  const ti = tick.inputs[0]
  const tickSpend = new Spend({
    sourceTXID: tx.id('hex'), sourceOutputIndex: 0, sourceSatoshis: FUEL,
    lockingScript: buildBatteryLock({ state: s0 }), transactionVersion: tick.version, otherInputs: [],
    outputs: tick.outputs, inputIndex: 0, unlockingScript: ti.unlockingScript!,
    inputSequence: ti.sequence ?? 0xffffffff, lockTime: tick.lockTime,
  })
  const tickOk = tickSpend.validate() === true
  const size = tick.toBinary().length, fee = FUEL - (tick.outputs[0].satoshis ?? 0)

  console.log('self-test · funder input valid   :', funderOk)
  console.log('self-test · battery @ frame 1    :', batteryOk)
  console.log('self-test · KEYLESS tick valid   :', tickOk)
  console.log('self-test · tick has no signature:', ti.unlockingScript!.chunks.length === 3)
  console.log('self-test · tick tx              :', size, 'bytes · fee', fee, 'sat ·', (fee / size * 1000).toFixed(3), 'sat/KB')
  console.log('self-test · MAX_FEE              :', BATTERY_MAX_FEE, '· grid', `${BATTERY_GEOMETRY.W}×${BATTERY_GEOMETRY.H}`)
  const ok = funderOk && batteryOk && tickOk && fee <= BATTERY_MAX_FEE && fee / size * 1000 >= 100
  console.log(ok ? '\nSELFTEST OK — builds a valid genesis and a valid keyless tick.' : '\nSELFTEST FAIL')
  process.exit(ok ? 0 : 1)
}

// ── genesis ─────────────────────────────────────────────────────────────────────────────────────────
async function genesis(): Promise<void> {
  const wif = process.env.BATTERY_WIF
  if (!wif) { console.error('Set BATTERY_WIF=<deployer WIF>  (or run --selftest first).'); process.exit(1) }
  const fuel = Number(arg('--fuel') ?? 8000)
  if (!Number.isInteger(fuel) || fuel < 1000) { console.error('--fuel must be an integer ≥ 1000 sat'); process.exit(1) }

  const existing = loadState()
  if (existing && !has('--force')) {
    console.error(`A battery is already recorded in ${STATE_FILE}:\n  genesis ${existing.genesisTxid} · ${existing.ticks} ticks`)
    console.error('Use --force to start a new one (the old one keeps running — it has no off switch).')
    process.exit(1)
  }

  const key = importWif(wif), addr = key.toAddress()
  console.log('deployer address :', addr)

  const utxos = await getJson(`/address/${addr}/unspent`)
  const pick = (Array.isArray(utxos) ? utxos : [])
    .filter((u: any) => u.value >= fuel + 1000).sort((a: any, b: any) => a.value - b.value)[0]
  if (!pick) { console.error(`No UTXO ≥ ${fuel + 1000} sat at ${addr} — send a little BSV there first.`); process.exit(1) }
  console.log('funding utxo     :', `${pick.tx_hash}:${pick.tx_pos} (${pick.value} sat)`)

  /* The opening mark. The genesis OP_RETURN is LAYOUT|MARK — the spec a rebuilder needs, then the
     first thing the battery says. Without --mark it carries the layout alone, which is correct but
     silent; there is exactly one genesis and no way to add a word to it afterwards. */
  const mark = arg('--mark')
  const opReturn = mark ? `${BATTERY_STATE_LAYOUT}|${mark}` : BATTERY_STATE_LAYOUT
  const marklen = Buffer.byteLength(opReturn, 'utf8')
  if (marklen > 220) {
    console.error(`the OP_RETURN would be ${marklen} bytes; the limit is 220. Shorten the mark.`)
    process.exit(1)
  }

  const src = Transaction.fromHex(await getText(`/tx/${pick.tx_hash}/hex`))
  const tx = await buildBatteryGenesisTx({
    key, funder: { sourceTransaction: src, outputIndex: pick.tx_pos }, fuelSats: fuel, mark: opReturn,
  })
  const raw = tx.toHex(), txid = tx.id('hex')

  console.log('\n── GENESIS · built + signed LOCALLY ──')
  console.log('grid     :', `${BATTERY_GEOMETRY.W}×${BATTERY_GEOMETRY.H}`, '· MAX_FEE', BATTERY_MAX_FEE, '· fixed point 2^32')
  console.log('txid     :', txid)
  console.log('fuel     :', tx.outputs[0].satoshis, `sat  (≈ ${ticksRemaining(fuel)} ticks)`)
  console.log('op_return:', marklen, 'bytes of 220')
  console.log('           ', opReturn)
  console.log('change   :', tx.outputs[tx.outputs.length - 1].satoshis, 'sat →', addr)
  console.log('size     :', raw.length / 2, 'bytes\n')

  if (!has('--broadcast')) {
    console.log('(dry build — inspect it. Re-run with --broadcast to send.)')
    console.log('raw hex  :\n' + raw)
    return
  }
  await broadcast(raw)
  saveState({ genesisTxid: txid, tipTxid: txid, ticks: 0, fuel,
              geometry: BATTERY_GEOMETRY, maxFee: BATTERY_MAX_FEE })
  console.log(`\n🔋 The battery is on-chain. State recorded in ${STATE_FILE}`)
  console.log(`   Advance it with:  node --experimental-strip-types tools/battery.ts --tick 20 --broadcast`)
    console.log('   (no key needed — that is the point)')
}

/**
 * Re-derive the local record from the chain.
 *
 * The state file is a convenience, not a source of truth, and it goes stale the moment the battery is
 * ticked from anywhere else — the page, another machine, a stranger. It was 14 ticks and 896,000 sat
 * behind when this was written, which would have made the next --tick spend an output that no longer
 * existed.
 *
 * THE TIP IS THE ONE THING THAT CANNOT BE DERIVED. Finding it means asking who spent an output, which
 * is an index; everything else this tool does deliberately avoids one. So the tip is supplied, and
 * then VERIFIED the direction that needs nobody: every transaction names its own parent, so walking
 * back from the tip to the genesis proves the lineage and counts the ticks at the same time.
 */
async function resync(): Promise<void> {
  const st = loadState()
  if (!st) { console.error(`No battery recorded in ${STATE_FILE}.`); process.exit(1) }
  const tip = arg('--tip')
  if (!tip || !/^[0-9a-f]{64}$/i.test(tip)) {
    console.error('--resync --tip <txid>   (the current tip; take it from the page or an explorer)')
    process.exit(1)
  }
  const { geometry, maxFee } = paramsOf(st)
  console.log(`walking back from ${tip}`)
  console.log(`params   : ${geometry.W}x${geometry.H} · MX0 ${geometry.MX0} · MAX_FEE ${maxFee}\n`)

  let cursor: string | null = tip, hops = 0, tipValue = 0
  const seen = new Set<string>()
  while (cursor && hops < 100_000) {
    if (seen.has(cursor)) { console.error('   ↳ a cycle — this is not a battery chain'); process.exit(1) }
    seen.add(cursor)
    const tx = Transaction.fromHex(await getText(`/tx/${cursor}/hex`))
    if (hops === 0) tipValue = tx.outputs[0].satoshis ?? 0
    if (cursor === st.genesisTxid) break
    const covIn = tx.inputs.find(i => i.sourceOutputIndex === 0)   // input 0 is the covenant; others fund
    if (!covIn?.sourceTXID) { console.error('   ↳ this chain does not reach the genesis'); process.exit(1) }
    cursor = covIn.sourceTXID
    hops++
    if (hops % 10 === 0) process.stdout.write(`   …${hops} hops\r`)
  }
  if (cursor !== st.genesisTxid) { console.error('   ↳ never reached the genesis — wrong battery?'); process.exit(1) }

  console.log(`   ${hops} ticks back to the genesis — lineage proved by vin, no indexer`)
  console.log(`   tip holds ${tipValue.toLocaleString()} sat (≈ ${ticksRemaining(tipValue, maxFee)} ticks left)`)
  saveState({ ...st, tipTxid: tip, ticks: hops, fuel: tipValue })
  console.log(`\n   recorded in ${STATE_FILE}`)
}

// ── keyless ticking ─────────────────────────────────────────────────────────────────────────────────
async function tick(): Promise<void> {
  const st = loadState()
  if (!st) { console.error(`No battery recorded in ${STATE_FILE}. Run --genesis first.`); process.exit(1) }
  const count = Number(arg('--tick') ?? 1)
  if (!Number.isInteger(count) || count < 1) { console.error('--tick must be a positive integer'); process.exit(1) }

  console.log(`battery  : genesis ${st.genesisTxid}`)
  console.log(`tip      : ${st.tipTxid} · ${st.ticks} ticks · ${st.fuel} sat (≈ ${ticksRemaining(st.fuel)} left)\n`)

  const { geometry, maxFee } = paramsOf(st)
  console.log(`params   : ${geometry.W}x${geometry.H} · MX0 ${geometry.MX0} · K ${geometry.K} · ` +
    `MAX_FEE ${maxFee}${st.geometry ? '' : '   ← no geometry recorded, assuming the legacy battery'}`)

  let source = Transaction.fromHex(await getText(`/tx/${st.tipTxid}/hex`))
  let utxo: BatteryUtxo = {
    sourceTransaction: source, outputIndex: 0, state: stateAfter(st.ticks, geometry), value: st.fuel,
  }

  for (let k = 0; k < count; k++) {
    const tx = await buildBatteryTickTx({ battery: utxo, geometry, maxFee })
    const raw = tx.toHex(), txid = tx.id('hex')
    const fee = utxo.value - (tx.outputs[0].satoshis ?? 0)
    console.log(`tick ${st.ticks + 1}  : ${txid}  ${raw.length / 2} B · fee ${fee} sat`)

    if (!has('--broadcast')) {
      console.log('   (dry — re-run with --broadcast to send)')
      if (count === 1) console.log('raw hex :\n' + raw)
      utxo = nextBatteryUtxo(tx, utxo, geometry)
      st.ticks += 1; st.fuel = utxo.value
      continue
    }
    await broadcast(raw)
    if (!await awaitInMempool(txid)) {
      console.error('   ↳ the node has not acknowledged this tick; stopping so the next one cannot race it.')
      break
    }
    utxo = nextBatteryUtxo(tx, utxo, geometry)
    st.tipTxid = txid; st.ticks += 1; st.fuel = utxo.value
    saveState(st)
    console.log(`   ✓ accepted · ${st.fuel} sat left (≈ ${ticksRemaining(st.fuel)} ticks)`)
  }
  if (has('--broadcast')) console.log(`\n${st.ticks} ticks total. A real node agrees with the interpreter.`)
}

// ── top-up ──────────────────────────────────────────────────────────────────────────────────────────
// The half that costs money and is therefore deliberate and signed. One transaction adds fuel, advances
// the state, and carries the contributor's mark for the board — atomic by construction, so the board is
// a VIEW over the chain (find the ticks where out0's value rose, read the mark) with nothing to administer.
async function topup(): Promise<void> {
  const st = loadState()
  if (!st) { console.error(`No battery recorded in ${STATE_FILE}. Run --genesis first.`); process.exit(1) }
  const wif = process.env.BATTERY_WIF
  if (!wif) { console.error('Set BATTERY_WIF=<sponsor WIF> — a top-up is signed, unlike a tick.'); process.exit(1) }
  const add = Number(arg('--topup') ?? 0)
  if (!Number.isInteger(add) || add < 1000) { console.error('--topup must be an integer ≥ 1000 sat'); process.exit(1) }
  const mark = arg('--mark') ?? null
  if (mark != null && new TextEncoder().encode(mark).length > 220) { console.error('--mark exceeds 220 bytes'); process.exit(1) }

  const key = importWif(wif), addr = key.toAddress()
  console.log('battery  :', st.genesisTxid)
  console.log('tip      :', `${st.tipTxid} · ${st.ticks} ticks · ${st.fuel} sat (≈ ${ticksRemaining(st.fuel)} left)`)
  console.log('sponsor  :', addr)

  const utxos = await getJson(`/address/${addr}/unspent`)
  const pick = (Array.isArray(utxos) ? utxos : [])
    .filter((u: any) => u.value >= add + 1000).sort((a: any, b: any) => a.value - b.value)[0]
  if (!pick) { console.error(`No UTXO ≥ ${add + 1000} sat at ${addr} — fund it first.`); process.exit(1) }
  console.log('funding  :', `${pick.tx_hash}:${pick.tx_pos} (${pick.value} sat)`)

  const tipTx = Transaction.fromHex(await getText(`/tx/${st.tipTxid}/hex`))
  const src = Transaction.fromHex(await getText(`/tx/${pick.tx_hash}/hex`))
  const tx = await buildBatteryTopUpTx({
    battery: { sourceTransaction: tipTx, outputIndex: 0, state: stateAfter(st.ticks, paramsOf(st).geometry), value: st.fuel },
    addSats: add, key, funder: { sourceTransaction: src, outputIndex: pick.tx_pos },
    mark,
  })
  const raw = tx.toHex(), txid = tx.id('hex'), newFuel = tx.outputs[0].satoshis ?? 0

  console.log('\n── TOP-UP · built + signed LOCALLY ──')
  console.log('txid     :', txid)
  console.log('adds     :', add.toLocaleString(), 'sat →', newFuel.toLocaleString(), 'sat', `(≈ ${ticksRemaining(newFuel).toLocaleString()} ticks)`)
  if (mark != null) console.log('mark     :', JSON.stringify(mark))
  console.log('change   :', tx.outputs[tx.outputs.length - 1].satoshis, 'sat →', addr)
  console.log('size     :', raw.length / 2, 'bytes\n')

  if (!has('--broadcast')) {
    console.log('(dry build — re-run with --broadcast to send.)')
    console.log('raw hex  :\n' + raw)
    return
  }
  await broadcast(raw)
  if (!await awaitInMempool(txid)) console.error('   ↳ not acknowledged yet; check before ticking again.')
  st.tipTxid = txid; st.ticks += 1; st.fuel = newFuel
  saveState(st)
  console.log(`\n🔋 Fuelled. ${newFuel.toLocaleString()} sat ≈ ${ticksRemaining(newFuel).toLocaleString()} ticks.`)
}

// ── status ──────────────────────────────────────────────────────────────────────────────────────────
async function status(): Promise<void> {
  const st = loadState()
  if (!st) { console.log(`No battery recorded in ${STATE_FILE}.`); return }
  const s = stateAfter(st.ticks, paramsOf(st).geometry)
  console.log('genesis :', st.genesisTxid)
  console.log('tip     :', st.tipTxid)
  console.log('ticks   :', st.ticks)
  console.log('fuel    :', st.fuel, `sat  (≈ ${ticksRemaining(st.fuel)} ticks left)`)
  console.log('state   :', JSON.stringify(s))
  console.log('viewer  :', `https://whatsonchain.com/tx/${st.tipTxid}`)
}

async function main(): Promise<void> {
  if (has('--selftest')) return void await selftest()
  if (has('--genesis')) return await genesis()
  if (has('--topup')) return await topup()
  if (has('--resync')) return await resync()
  if (has('--tick')) return await tick()
  if (has('--status')) return await status()
  console.log('usage:')
  console.log('  --selftest                                       no key, no network')
  console.log('  --genesis --fuel <sat> [--mark "…"] [--broadcast] BATTERY_WIF · once, permanent')
  console.log('  --topup <sat> [--mark "…"] [--broadcast]         BATTERY_WIF · signed, adds fuel + a board mark')
  console.log('  --resync --tip <txid>                            re-derive the record from the chain')
  console.log('  --tick <n> [--broadcast]                         NO KEY — the autonomous half')
  console.log('  --status                                         where the battery is now')
}
main().catch(e => { console.error('ERROR:', (e as Error).message); process.exit(1) })
