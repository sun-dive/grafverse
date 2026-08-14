// © BSV Association — Open BSV License v6.
// BITCOIN RACERS · GO-LIVE — mint a car, load it, drop the flag and run a whole quarter mile on chain.
//
//   bundle:     node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/racer.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/racer.mjs'}))"
//   self-test:  node tools/racer.mjs --selftest              (no key, no network — runs the whole race locally)
//   dry build:  RACER_WIF=<wif> node tools/racer.mjs         (reads your UTXO, builds every tx, sends nothing)
//   GO LIVE:    RACER_WIF=<wif> node tools/racer.mjs --broadcast
//
// ⚠ WIF VIA ENV ONLY — never a flag, never a file. In fish:  read -s -P 'WIF: ' w; set -x RACER_WIF $w
//
// ── WHAT THIS PUTS ON CHAIN ───────────────────────────────────────────────────────────────────────
// One genesis transaction creates BOTH halves of a race:
//
//     output 0   the car — an EMPTY shell holding the tank
//     output 1   the purse — the pot the winner claims by crossing the line
//
// then a chain of transactions loads the car, loads the track, arms it, and ticks. Every tick is a real
// spend that the network validates against the covenant, so the result is not reported by this tool —
// it is *settled* by miners. This tool only proposes; the script decides.
//
// ── ⚠ THE CLOCK, AND WHY GREEN IS IN THE PAST ─────────────────────────────────────────────────────
// The covenant makes each tick carry an nLockTime of at least `last + gap`, so ticks cannot be
// reordered or replayed. That is a SEQUENCING device, not a wall clock — the physics run at 0.1 s per
// tick regardless. But nLockTime finality is judged against MEDIAN TIME PAST, which lags real time by
// roughly an hour, so a race flagged away at `now` would sit non-final and unmineable until MTP caught
// up. Setting green a few hours back makes every tick final on arrival while the ordering the covenant
// enforces is exactly as strict. The race clock is the covenant's own, and it always was.
//
// ── ⚠ WHY THE POT IS NOT OP_TRUE ──────────────────────────────────────────────────────────────────
// The finishing rule checks only that the pot's OUTPOINT is the second input — it never looks at what
// locks it. The simulation uses OP_TRUE because nothing there is real. On mainnet a bare anyone-can-pay
// output is swept by bots in minutes, and losing the purse mid-race would strand the car one tick from
// home. So the purse is locked to the driver's own key and signed as input 1 on the winning tick.
import { PrivateKey, Transaction, P2PKH, Spend, UnlockingScript, SatoshisPerKilobyte, TransactionSignature, Hash, Utils } from '@bsv/sdk'
import { importWif } from '../src/wallet.ts'
import {
  emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps, stateFits,
  SHELL_SCOPE, SHELL_MAX_FEE, RACER_REGS as R, S, PHASE, type ShellState,
} from '../src/shell.ts'
import { serializeOutput } from '../src/covenant.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
const getJson = async (p: string): Promise<any> => { const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json() }
const getText = async (p: string): Promise<string> => { const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.text() }
const u64 = (n: number): number[] => { const b: number[] = []; let x = n; for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }
const sec = (n: number): string => (n * 0.1).toFixed(2)
const mph = (v: number): number => (v / S) / 0.1 * 2.23694

/** THE CAR, THE TRACK, THE PURSE. The settled regulations, and a build that gets home on 60,000 sat. */
const SPEC = {
  tank: 60_000,          // the car's fuel — every satoshi of it is a mining fee or comes back
  pot: 30_000,           // the purse, claimable only by crossing the line
  eng: 14, tyr: 10,      // a build the bench says finishes a quarter mile
  finishM: 402,          // a quarter mile, to the metre
  slip: 1000, gap: 1,    // dry strip; one second of race clock between ticks
  greenBack: 3 * 3600,   // green light this far in the PAST — see the note on MTP above
}
const RESERVE = R.BURN0 + 1   // hold back enough to get the car home on the trailer
const FEE_PER_KB = 100        // official BSV fee rate; the covenant's own burn is measured against it

type Ctx = { key: PrivateKey; driver: number[]; log: (s: string) => void }

/** One move: spend the shell (and the purse, if this is the winning tick) into the next state. */
async function buildMove (
  ctx: Ctx,
  prev: { tx: Transaction; vout: number; state: ShellState; value: number },
  next: ShellState,
  o: { out: number; at: number; throttle?: number; retire?: boolean; payout?: number; pot?: { tx: Transaction; vout: number } },
): Promise<Transaction> {
  const lock = buildShellLock({ state: prev.state, maxFee: SHELL_MAX_FEE })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.vout, sequence: 0xfffffffe })
  if (o.pot) tx.addInput({ sourceTransaction: o.pot.tx, sourceOutputIndex: o.pot.vout, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: SHELL_MAX_FEE }), satoshis: o.out })
  if ((o.payout ?? 0) > 0) tx.addOutput({ lockingScript: new P2PKH().lock(ctx.key.toAddress()), satoshis: o.payout })
  tx.lockTime = o.at

  const pre = TransactionSignature.format({
    sourceTXID: prev.tx.id('hex'), sourceOutputIndex: prev.vout, sourceSatoshis: prev.value,
    transactionVersion: 2, otherInputs: tx.inputs.slice(1), inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const chunks = (await new P2PKH().unlock(ctx.key).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(o.out), preimage: pre, sig: chunks[0].data ?? [], pubKey: chunks[1].data ?? [],
    throttle: o.throttle ?? 0, retire: !!o.retire,
    load: { driver: next.driver, pool: next.pool, eng: next.eng, tyr: next.tyr,
            finish: next.finish, slip: next.slip, green: next.green, gap: next.gap },
  }))
  // the purse is an ordinary P2PKH the driver owns; sign it AFTER, since input 0 never commits to it
  if (o.pot) tx.inputs[1].unlockingScript = await new P2PKH().unlock(ctx.key).sign(tx, 1)

  const ok = new Spend({
    sourceTXID: prev.tx.id('hex'), sourceOutputIndex: prev.vout, sourceSatoshis: prev.value, lockingScript: lock,
    transactionVersion: 2, otherInputs: tx.inputs.slice(1), outputs: tx.outputs, inputIndex: 0,
    unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
  }).validate()
  if (ok !== true) throw new Error('the covenant refused this move before it was ever sent')
  return tx
}

/** The largest throttle that does not break traction — asked of the reference, never of the chain. */
function safeThrottle (st: ShellState, fuel: number): number {
  let lo = 0, hi = R.THROTTLE_MAX, best = 0
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    let r; try { r = refTick(st, { throttle: m, lockTime: Math.max(st.green, st.last + st.gap), fuel }, R) } catch { break }
    if (r.spun || r.ended) hi = m - 1; else { best = m; lo = m + 1 }
  }
  return best
}

/** Build the genesis transaction: the car and the purse, out of one funding coin. */
async function buildGenesis (ctx: Ctx, funder: { tx: Transaction; vout: number; value: number }, green: number) {
  const car = emptyShell()
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: funder.tx, sourceOutputIndex: funder.vout,
                unlockingScriptTemplate: new P2PKH().unlock(ctx.key), sequence: 0xffffffff })
  tx.addOutput({ lockingScript: buildShellLock({ state: car, maxFee: SHELL_MAX_FEE }), satoshis: SPEC.tank })
  tx.addOutput({ lockingScript: new P2PKH().lock(ctx.key.toAddress()), satoshis: SPEC.pot })
  tx.addOutput({ lockingScript: new P2PKH().lock(ctx.key.toAddress()), change: true })
  await tx.fee(new SatoshisPerKilobyte(FEE_PER_KB))   // the official rate — never inflated
  await tx.sign()
  return { tx, car, green }
}

/** Walk the whole race, building (and optionally sending) every transaction in order. */
async function runRace (ctx: Ctx, genesis: Transaction, green: number, send: null | ((tx: Transaction) => Promise<void>)) {
  const pool = [...Utils.toArray(genesis.id('hex'), 'hex').slice().reverse(), 1, 0, 0, 0]   // txid‖vout=1, LE
  const potRef = { tx: genesis, vout: 1 }
  let prev = { tx: genesis, vout: 0, state: emptyShell(), value: SPEC.tank }
  let fuel = SPEC.tank, txs = 0, bytes = 0, burned = 0, took = 0, rate = Infinity

  /* ⚠ EVERY MOVE MUST PAY FOR ITS OWN BYTES. A move's miner fee is exactly the value it does not carry
     forward, so `out = fuel` is a ZERO-FEE transaction — perfectly valid to the interpreter and
     unrelayable by any node. The racing ticks fund themselves out of the burn; the three loading moves
     have no burn of their own, so they are charged the same BURN0 floor. Checked, not assumed. */
  const step = async (next: ShellState, o: any): Promise<void> => {
    const tx = await buildMove(ctx, prev, next, o)
    const size = tx.toHex().length / 2, paid = prev.value + (o.pot ? SPEC.pot : 0) - tx.outputs.reduce((a, x) => a + (x.satoshis ?? 0), 0)
    const floor = Math.ceil(size * FEE_PER_KB / 1000)
    if (paid < floor) throw new Error(`move ${txs + 1} pays ${paid} sat for ${size} bytes — below the ${floor} sat relay floor`)
    txs++; bytes += size; rate = Math.min(rate, paid * 1000 / size)
    if (send) await send(tx)
    prev = { tx, vout: 0, state: next, value: o.out }
  }

  // ── load the car, load the track, arm it ────────────────────────────────────────────────────────
  const car = loadCar(prev.state, { driver: ctx.driver, eng: SPEC.eng, tyr: SPEC.tyr }, R)
  const track = loadTrack(car, { finish: Math.round(SPEC.finishM * S), slip: SPEC.slip, green, gap: SPEC.gap, pool })
  const unfit = stateFits(track)
  if (unfit) throw new Error(`${unfit} does not fit its field — this car cannot be minted`)

  for (const [label, st] of [['claim it and load the car', car], ['load the track and the tree', track],
                             ['fuel it — the specs freeze here', arm(track)]] as [string, ShellState][]) {
    await step(st, { out: fuel - R.BURN0, at: 0 })
    fuel -= R.BURN0; burned += R.BURN0
    ctx.log(`  tx ${String(txs).padStart(3)}  ${label}`)
  }

  // ── the race ────────────────────────────────────────────────────────────────────────────────────
  let st = prev.state
  while (st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && st.n < 900) {
    const throttle = safeThrottle(st, fuel)
    const at = Math.max(st.green, st.last + st.gap)
    const want = refTick(st, { throttle, lockTime: at, fuel }, R)
    const crossing = want.state.phase === PHASE.DONE
    const ending = crossing || want.state.phase === PHASE.OUT

    if (!ending && fuel - want.burn < RESERVE) {          // can't tick AND still afford to stop → stop
      const payout = fuel - R.BURN0 - 1
      await step({ ...st, phase: PHASE.OUT }, { out: 1, at, retire: true, payout })
      burned += R.BURN0; took = payout; fuel = 1
      ctx.log(`  tx ${String(txs).padStart(3)}  RETIRED at ${(st.s / S).toFixed(0)} m — ${payout.toLocaleString()} sat recovered`)
      st = { ...st, phase: PHASE.OUT }
      break
    }

    const payout = ending ? (fuel - want.burn - 1) + (crossing ? SPEC.pot : 0) : 0
    await step(want.state, { out: ending ? 1 : fuel - want.burn, at, throttle, payout,
                             pot: crossing ? potRef : undefined })
    burned += want.burn; fuel -= want.burn; st = want.state
    if (ending) took = payout
    if (st.n <= 3 || st.n % 10 === 0 || ending) {
      ctx.log(`  tx ${String(txs).padStart(3)}  move ${String(st.n).padStart(3)}  ${sec(st.n)} s  ` +
        `${String(Math.round(mph(st.v))).padStart(3)} mph  ${(st.s / S).toFixed(0).padStart(4)} m` +
        (want.ended === 'off' ? '   OFF THE TRACK' : want.ended === 'blown' ? '   ENGINE LET GO'
          : crossing ? '   ◀ CROSSED THE LINE, with the purse' : want.spun ? '   smoke' : ''))
    }
  }
  return { st, txs, bytes, burned, took, rate }
}

// ── SELF-TEST — the whole race, locally, with a throwaway key and no network ───────────────────────
async function selftest (): Promise<never> {
  const key = PrivateKey.fromRandom()
  const ctx: Ctx = { key, driver: Hash.hash160(key.toPublicKey().encode(true) as number[]), log: console.log }
  const funder = new Transaction()
  funder.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: SPEC.tank + SPEC.pot + 50_000 })

  const green = Math.floor(Date.now() / 1000) - SPEC.greenBack
  const { tx: genesis } = await buildGenesis(ctx, { tx: funder, vout: 0, value: SPEC.tank + SPEC.pot + 50_000 }, green)
  const fundOk = new Spend({
    sourceTXID: funder.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SPEC.tank + SPEC.pot + 50_000,
    lockingScript: new P2PKH().lock(key.toAddress()), transactionVersion: genesis.version, otherInputs: [],
    outputs: genesis.outputs, inputIndex: 0, unlockingScript: genesis.inputs[0].unlockingScript!,
    inputSequence: genesis.inputs[0].sequence ?? 0xffffffff, lockTime: genesis.lockTime,
  }).validate() === true

  console.log('self-test · funding input valid :', fundOk)
  console.log('self-test · car @ EMPTY holds   :', genesis.outputs[0].satoshis, 'sat')
  console.log('self-test · purse               :', genesis.outputs[1].satoshis, 'sat')
  console.log('self-test · genesis bytes       :', genesis.toHex().length / 2, '\n')

  const r = await runRace(ctx, genesis, green, null)
  const won = r.st.phase === PHASE.DONE
  const inSats = SPEC.tank + (won ? SPEC.pot : 0)
  const balanced = inSats === r.burned + r.took + 1
  console.log(`\nself-test · ${won ? 'HOME in ' + sec(r.st.n) + ' s' : 'did not finish'} · ${r.txs} txs · ${(r.bytes / 1024).toFixed(1)} KB`)
  console.log(`self-test · burned ${r.burned.toLocaleString()} + recovered ${r.took.toLocaleString()} + 1 left = ${inSats.toLocaleString()} in`)
  console.log(`self-test · thinnest fee paid  : ${r.rate.toFixed(0)} sat/KB  (relay floor is ${FEE_PER_KB})`)

  /* ★ WHAT A RACE ACTUALLY COSTS. The tank is not the cost — most of it comes home. The cost is the
     part that stays with miners, and it divides cleanly into building the car and running it. */
  const genFee = (SPEC.tank + SPEC.pot + 50_000) - genesis.outputs.reduce((a, x) => a + (x.satoshis ?? 0), 0)
  const build = genFee + R.BURN0 * 3, run = r.burned - R.BURN0 * 3
  console.log(`\n── COST OF ONE RACE ──`)
  console.log(`  car shell + configuration : ${build.toLocaleString().padStart(7)} sat   (genesis ${genFee} + 3 loading moves)`)
  console.log(`  fuel to the finish line   : ${run.toLocaleString().padStart(7)} sat   (${r.st.n} ticks)`)
  console.log(`  headstone left in the shell:${String(1).padStart(7)} sat`)
  console.log(`  ────────────────────────────────────────`)
  console.log(`  TOTAL CONSUMED            : ${(build + run + 1).toLocaleString().padStart(7)} sat`)
  console.log(`  put in ${SPEC.tank.toLocaleString()} tank + ${SPEC.pot.toLocaleString()} purse → ${r.took.toLocaleString()} sat came back`)
  const ok = fundOk && won && balanced
  console.log(ok ? '\nSELFTEST OK — the whole race is interpreter-valid. Safe to use with your real key.'
                 : `\nSELFTEST FAIL — funding ${fundOk}, finished ${won}, balanced ${balanced}`)
  process.exit(ok ? 0 : 1)
}

async function broadcast (tx: Transaction): Promise<void> {
  const raw = tx.toHex()
  const w = await fetch(`${WOC}/tx/raw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }) })
  const body = (await w.text()).trim()
  if (!w.ok) throw new Error(`WoC refused ${tx.id('hex').slice(0, 12)}… → ${w.status} ${body}`)
  try {
    await fetch(`${BB}/tx/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }) })
  } catch { /* the second announcer is a courtesy, not a requirement */ }
}

async function main (): Promise<void> {
  if (process.argv.includes('--selftest')) return selftest()
  const wif = process.env.RACER_WIF
  if (!wif) { console.error('Set RACER_WIF=<driver WIF>  (or run --selftest first — it needs no key).'); process.exit(1) }

  const key = importWif(wif), addr = key.toAddress()
  const ctx: Ctx = { key, driver: Hash.hash160(key.toPublicKey().encode(true) as number[]), log: console.log }
  const live = process.argv.includes('--broadcast')
  console.log('driver address :', addr)

  const need = SPEC.tank + SPEC.pot + 2_000
  const utxos = await getJson(`/address/${addr}/unspent`)
  const pick = (Array.isArray(utxos) ? utxos : []).filter((u: any) => u.value >= need).sort((a: any, b: any) => a.value - b.value)[0]
  if (!pick) { console.error(`No funding UTXO ≥ ${need.toLocaleString()} sat at ${addr} — send a little BSV there first.`); process.exit(1) }
  console.log('funding utxo   :', `${pick.tx_hash}:${pick.tx_pos} (${pick.value.toLocaleString()} sat)`)

  const src = Transaction.fromHex(await getText(`/tx/${pick.tx_hash}/hex`))
  const green = Math.floor(Date.now() / 1000) - SPEC.greenBack
  const { tx: genesis } = await buildGenesis(ctx, { tx: src, vout: pick.tx_pos, value: pick.value }, green)

  console.log(`\n── GENESIS · the car and the purse ──`)
  console.log('txid   :', genesis.id('hex'))
  console.log('car    :', genesis.outputs[0].satoshis?.toLocaleString(), 'sat   (output 0 — an EMPTY shell)')
  console.log('purse  :', genesis.outputs[1].satoshis?.toLocaleString(), 'sat   (output 1 — claimable only by crossing)')
  console.log('change :', genesis.outputs[2].satoshis?.toLocaleString(), 'sat →', addr)
  if (live) { await broadcast(genesis); console.log('        BROADCAST ✓') }

  console.log(`\n── THE RACE ── ${SPEC.finishM} m · engine ${SPEC.eng} · tyres ${SPEC.tyr} · green ${new Date(green * 1000).toISOString()}\n`)
  const r = await runRace(ctx, genesis, green, live ? broadcast : null)

  const won = r.st.phase === PHASE.DONE
  const inSats = SPEC.tank + (won ? SPEC.pot : 0)
  console.log(`\n── RESULT ──`)
  console.log('verdict     :', won ? `HOME in ${sec(r.st.n)} s` : r.st.phase === PHASE.OUT ? 'did not finish' : 'still running')
  console.log('reached     :', (r.st.s / S).toFixed(0), 'of', SPEC.finishM, 'm  ·  trap', Math.round(mph(r.st.v)), 'mph')
  console.log('transactions:', r.txs + 1, `(genesis + ${r.txs})  ·  ${(r.bytes / 1024).toFixed(1)} KB`)
  console.log('burned      :', r.burned.toLocaleString(), 'sat as mining fees')
  console.log('recovered   :', r.took.toLocaleString(), 'sat →', addr)
  console.log('balance     :', inSats === r.burned + r.took + 1
    ? `✓ ${inSats.toLocaleString()} in = ${r.burned.toLocaleString()} burned + ${r.took.toLocaleString()} out + 1 sat headstone`
    : `⚠ ${inSats.toLocaleString()} in ≠ ${r.burned.toLocaleString()} + ${r.took.toLocaleString()} + 1`)
  console.log(live ? `\n🏁 On chain. The car's genesis: ${genesis.id('hex')}`
                   : `\n(dry build — nothing was sent. Re-run with --broadcast to race for real.)`)
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
