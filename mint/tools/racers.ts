// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ THE ONE-RACE RACERS, ON MAINNET — depot → mint → race → the last satoshi home.
 *
 *   node --experimental-strip-types mint/tools/racers.ts --selftest      no key, no network
 *    RACERS_WIF=<wif> node mint/tools/racers.ts --run                    dry: builds, sends nothing
 *    RACERS_WIF=<wif> node mint/tools/racers.ts --run --broadcast        for real
 *
 * ⚠ WIF VIA ENV ONLY, never a flag and never a file. The leading space keeps it out of shell history.
 * In fish: `read -s -P 'WIF: ' w; set -x RACERS_WIF $w`
 *
 * ── ★ ONE KEY, AND ONE DEPOT ──────────────────────────────────────────────────────────────────────
 * The address that mints the depot is the address a finished race pays back to. Because a 25-byte
 * address contains no depot, nothing is self-referential and there is exactly ONE depot — the two-depot
 * arrangement the covenant payee forced is gone. → `racers-where-we-stand.md` §6h.
 *
 * ── ⚠⚠ THREE THINGS THIS TOOL DOES BECAUSE THEY HAVE ALREADY GONE WRONG ───────────────────────────
 * 1. **It refuses to fund a car it has not proved raceable.** `assertRaceable` builds the real spend
 *    and asks the real interpreter. A one-race car has no key, so a car the covenant refuses is
 *    unrecoverable — there is no sweeper, because there is nobody to sweep with.
 * 2. **It grinds for LOW_S.** ARC refuses a high-S signature (error 461) even though it is valid and
 *    minable. The race has a free lever — the car reads no locktime at all, measured. The MINT's lever
 *    is the six hundred nLockTime values inside its own window, which is the bucketing paying for
 *    itself twice.
 * 3. **It mints SERIALLY, waiting for each parent to be seen.** An 880 m race once reached 84 chained
 *    spends and then could not be resumed: both attempts died on `Missing inputs`. Fire-and-forget
 *    orphans everything behind the first failure, and each orphan is a car somebody was promised.
 */
import {
  Transaction, TransactionSignature, Spend, LockingScript, UnlockingScript, PrivateKey, P2PKH, Hash, OP,
  SatoshisPerKilobyte,
} from '@bsv/sdk'
import { buildRacerDepotBasicLock, racerDepotMaxFee, RACER_WINDOW_SECONDS, RACER_MINTS_PER_WINDOW } from '../src/racerDepotFrame.ts'
import { RACER_DRAW, RACER_MAX_CAR_BYTES } from '../src/racerDepot.ts'
import { buildRacerCar, racerCarFee, carBlockOps } from '../src/racerCar.ts'
import { buildRaceTx, assertRaceable, type RaceReport } from '../src/racerTx.ts'
import { buildDepotUnlock, DEPOT_SCOPE } from '../src/depot.ts'
import { derivedSigIsLowS } from '../src/pushtx.ts'
/* ⚠ THE ONE-RACE CAR'S PHYSICS LIVES IN ITS OWN FILE. `shell.ts` is bundled into BOTH live
   bundles — grafmint.js (six pages) and, via grafbasic.ts, grafbasic.js (basic.html) — so the
   racers must not put anything in it. → src/racerPhysics.ts, and §6j. */
import { S, SLIP_UNIT, PHASE } from '../src/shell.ts'
import { ONE_RACE_REGS as R, racerRefTick as refTick, RACER_PHASE } from '../src/racerPhysics.ts'
import { type TickTrace, type RunTrace } from '../src/racerTick.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const getJson = async (p: string): Promise<any> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json()
}
const n = (x: number): string => x.toLocaleString()
const has = (f: string): boolean => process.argv.includes(f)
const arg = (k: string, d: number): number => {
  const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d
}
const argS = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

const TANK = arg('tank', 40_000)
const TRACK = arg('track', 4)
const ENG = arg('eng', 14), TYR = arg('tyr', 10), SLIP = arg('slip', 1000)
const FUEL = arg('fuel', 40_000)
const NAME = argS('name', 'SUN-DIVE')
const HOME = arg('home', 1)          // ★ what comes back: 1 sat, or a spendable amount. The covenant does not care.

const PHYS: Record<string, number> = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}

const u64 = (v: number): number[] => {
  const b: number[] = []; let x = BigInt(v); for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n }; return b
}
const varint = (v: number): number[] =>
  v < 0xfd ? [v] : v <= 0xffff ? [0xfd, v & 0xff, v >> 8] : [0xfe, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
const serOut = (v: number, s: number[]): number[] => [...u64(v), ...varint(s.length), ...s]
const bar = (s: string): void => console.log(`\n\x1b[1m${s}\x1b[0m`)

/* ── THE RUN, SIMULATED BEFORE ANYTHING EXISTS ───────────────────────────────────────────────────
   ⚠ The ending is REPORTED, never assumed. The script IS the run, so a trace that says `finish` and
   does not reach the line compiles into a car the covenant will refuse — and there is no key to
   rescue it with.

   ⚠⚠ "DRY" MEANT THREE THINGS IN THIS FILE AND THAT COST AN HOUR. They are separated now:
     · a dry RUN   — the fuel reaches zero and the car COASTS. Common, legal, often the fast setup,
                     and the only thing `optimizeCarCompile` refuses (see the fallback in `buildMint`).
     · UNFINISHED  — the field below: neither crossed nor wrecked before the tick fuse. Still rolling.
     · a dry BUILD — the CLI sense: `--run` without `--broadcast`, which sends nothing. */
const TICK_FUSE = 400

function simulate(metres: number, tank: number):
  { run: RunTrace; finish: number; unfinished: boolean; secs: number } {
  const finish = Math.round(metres * S)
  let st: Record<string, number> = {
    phase: PHASE.RACING, driver: new Array(20).fill(0) as never, pool: new Array(36).fill(0) as never,
    eng: ENG, tyr: TYR, finish, slip: SLIP, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
  } as never
  let fuel = tank
  const ticks: TickTrace[] = []
  let ending: RunTrace['ending'] = 'finish'
  let done = false
  for (let i = 0; i < TICK_FUSE; i++) {
    const r = refTick(st as never, { throttle: 8, fuel, lockTime: st.last + st.gap }, R)
    /* ⚠⚠ CLAMP AT EMPTY — DO NOT STOP. A dry car COASTS: with no propellant the throttle is forced
       shut and it rolls on, slowing on drag. `shell.ts` says so, and since the fee left the loop the
       fuel is a GAME quantity rather than a balance.
       ⚠ Breaking out here is a rule from the CHAINED design, where a tick really was bought, and it
       forbids the best strategy in this one: 30,000 fuel finishes 402 m in 5.40 s where 40,000 takes
       6.00 s, because less fuel is less mass. Under-fuelling is a DECISION. */
    fuel = Math.max(0, fuel - r.burn)
    ticks.push({ throttle: r.throttle, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    /* ★ the fifth ending — dry and provably short of the line. Legal; no time, no leaderboard row. */
    if (r.ended === 'stopped') { ending = 'stopped'; done = true; break }
    if (r.ended === 'off') { ending = 'off'; done = true; break }
    if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; done = true; break }
    if (st.phase === PHASE.DONE) { done = true; break }
  }
  /* ⚠ `unfinished` is the fuse blowing, not the tank emptying. Drag is proportional to v and v², so a
     coasting car approaches zero and never reaches it — it is STILL ROLLING when the fuse blows. */
  return { run: { ticks, ending }, finish, unfinished: !done, secs: ticks.length / 10 }
}

/** The scripts a depot and its cars are built from — all of them from ONE key. */
function scriptsFor(key: PrivateKey): { owner: number[]; payee: number[]; block: number[]; address: string } {
  const address = key.toPublicKey().toAddress()
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const payee = new P2PKH().lock(address).toBinary()
  const block = new LockingScript(carBlockOps({ depotScript: payee })).toBinary()
  return { owner, payee, block, address }
}

/**
 * ★★ THE DEPOT'S STATE, READ OFF ITS OWN SCRIPT.
 * The head is `04 mark(4) 01 n(1)`, fixed width, so this is two slices and no parsing.
 */
export function readDepotState(script: number[]): { mark: number; count: number } {
  if (script[0] !== 0x04 || script[5] !== 0x01) {
    throw new Error('racers: that output does not look like a one-race depot (state head not found)')
  }
  const mark = script[1] | (script[2] << 8) | (script[3] << 16) | (script[4] << 24)
  return { mark, count: script[6] }
}

/**
 * ★★ THE WINDOW TO MINT IN — and it must be in the PAST.
 *
 * ⚠ nLockTime is judged against MEDIAN TIME PAST, which lags real time by roughly an hour and a half
 * (measured 19 Aug: 92m 47s). A transaction stamped `now` sits non-final and unmineable. Three hours
 * back costs nothing — the window is a rate limit, not a clock the racer reads.
 */
function pastWindow(nowSecs: number): number {
  return Math.floor((nowSecs - 3 * 3600) / RACER_WINDOW_SECONDS)
}

/* ── THE MINT ─────────────────────────────────────────────────────────────────────────────────── */
interface MintBuild {
  tx: Transaction; spend: Spend; car: number[]; carFee: number; ground: number
  /** ★ Which build was minted. A dry run falls back to the faithful one, and that must be VISIBLE. */
  optimised: boolean
}

function buildMint(o: {
  key: PrivateKey; depotTx: Transaction; depotVout: number; depotValue: number
  window: number; lowS: boolean
}): MintBuild {
  const { owner, payee, block } = scriptsFor(o.key)
  const sim = simulate(TRACK, FUEL)
  if (sim.unfinished) {
    throw new Error(`racers: a ${TRACK} m run on ${n(FUEL)} fuel is still rolling after ${TICK_FUSE} ` +
      'ticks — it neither crosses the line nor wrecks, and there is no `stopped` ending to compile it ' +
      'as. Raise --fuel.')
  }
  const cfg = { name: NAME, fuel: FUEL, eng: ENG, tyr: TYR, slip: SLIP, finish: sim.finish }
  const carParams = { cfg, run: sim.run, depotScript: payee, consts: PHYS }

  /* ⚠⚠ THE GATE. A car the covenant refuses is unrecoverable, because there is no key to rescue it
     with. This throws rather than returning, so it cannot be ignored by accident.

     ★★ A REFUSAL FROM THE OPTIMISER MEANS "DO NOT OPTIMISE", NOT "DO NOT RACE."
     `optimizeCarCompile` proves its hoisting against the faithful build before emitting anything, and
     on a run whose fuel reaches zero it cannot read `v` back out — so it refuses rather than certify
     an optimisation nobody has checked. That is the self-proof doing exactly its job, and the honest
     response is to try the FAITHFUL build rather than give up on the car.
     ⚠⚠ THE FALLBACK DOES NOT WEAKEN THE GATE. The faithful car goes through the SAME `assertRaceable`
     — interpreter and all — and a car that fails BOTH builds still throws, carrying both refusals so
     neither is hidden behind the other.

     ⚠⚠⚠ AND TODAY IT FAILS BOTH, WHICH IS WHY THE DOUBLE REFUSAL IS WORTH PRINTING. MEASURED
     20 Aug by sweeping fuel at 402 m (eng 14 · tyr 10 · slip 1000): EVERY car whose tank reaches zero
     is refused on BOTH builds — optimised throws, faithful is refused by the interpreter with
     `OP_VERIFY requires the top stack value to be truthy`. Every car that never goes dry races on
     both. The boundary is the DRY TICK, not the optimiser.
     ⇒ The cause is structural and is in `specialiseRun` (`racerTick.ts:158`), which was written for a
     run whose fuel never reaches zero and encodes that in three places:
       · `VERIFY fuel > 0` on EVERY tick — a rule from the CHAINED design, where a tick was bought
       · `demand`/`burn` use the trace's LITERAL throttle, where the reference forces `th = 0` when
         `prop <= 0` (`TICK_SRC` lines 30/39) — so the compiled car keeps accelerating where the
         simulated one coasts
       · `fuel = fuel - burn` unclamped, where the harness clamps at `MAX(0, …)`
     ⇒ So the fallback is the right SHAPE and is not yet the fix. Until the specialiser can express a
     dry tick, this turns one misleading refusal into two honest ones. → `~/Documents/TODO.md`. */
  let optimised = true
  let report: RaceReport
  try {
    report = assertRaceable({ ...carParams, optimise: true }, HOME)
  } catch (eOpt) {
    optimised = false
    try {
      report = assertRaceable({ ...carParams, optimise: false }, HOME)
    } catch (eFaithful) {
      throw new Error('racers: NEITHER BUILD OF THIS CAR CAN BE RACED — nothing was funded.\n' +
        `  · optimised: ${(eOpt as Error).message}\n` +
        `  · faithful:  ${(eFaithful as Error).message}`)
    }
  }
  const car = buildRacerCar({ ...carParams, optimise: optimised, fee: report.fee }).toBinary()
  const paid = report.fee + HOME
  if (paid > RACER_DRAW) throw new Error(`racers: a car needs ${n(paid)} sat, over DRAW ${n(RACER_DRAW)}`)
  if (car.length > RACER_MAX_CAR_BYTES) {
    throw new Error(`racers: the car is ${n(car.length)} B, over MAX_CAR ${n(RACER_MAX_CAR_BYTES)}`)
  }

  const prev = readDepotState(o.depotTx.outputs[o.depotVout].lockingScript.toBinary())
  const DEPOT = buildRacerDepotBasicLock({ carBlock: block, owner, mark: prev.mark, count: prev.count })
  const nextCount = o.window === prev.mark ? prev.count + 1 : 1
  if (nextCount > RACER_MINTS_PER_WINDOW) {
    throw new Error(`racers: window ${o.window} is full (${prev.count}/${RACER_MINTS_PER_WINDOW}) — ` +
      'wait for median time past to cross into the next one, which takes a block')
  }
  const NEXT = buildRacerDepotBasicLock({ carBlock: block, owner, mark: o.window, count: nextCount })

  /* The fee the depot's own script will compute — the same expression, so there is one rule not two. */
  const scsize = DEPOT.toBinary().length + 3
  const fee = Math.floor((2 * car.length + 2 * scsize + 267) / 10)
  const kept = o.depotValue - paid - fee
  if (kept < 1) throw new Error(`racers: the tank cannot cover a ${n(paid)} sat car and a ${n(fee)} sat fee`)

  /* ★ THE GRIND. nLockTime may be any second inside the window, so there are six hundred candidates
     and the schedule does not move. Without it ARC returns 461 and refuses a perfectly valid spend. */
  const base = o.window * RACER_WINDOW_SECONDS
  let ground = 0
  for (let i = 0; i < (o.lowS ? RACER_WINDOW_SECONDS : 1); i++) {
    const lockTime = base + i
    const src = o.depotTx
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: o.depotVout, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(car).chunks), satoshis: paid })
    tx.addOutput({ lockingScript: NEXT, satoshis: kept })
    tx.lockTime = lockTime
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: o.depotVout, sourceSatoshis: o.depotValue,
      transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
      inputSequence: 0xfffffffe, subscript: DEPOT, lockTime, scope: DEPOT_SCOPE,
    })
    if (o.lowS && !derivedSigIsLowS(pre)) { ground++; continue }
    const unlock = buildDepotUnlock({
      prefixOutputs: serOut(paid, car), spenderOutputs: [], newValue: u64(kept), preimage: pre,
    } as never)
    tx.inputs[0].unlockingScript = unlock
    const spend = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: o.depotVout, sourceSatoshis: o.depotValue,
      lockingScript: DEPOT, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
      unlockingScript: unlock, inputSequence: 0xfffffffe, inputIndex: 0, lockTime,
    })
    return { tx, spend, car, carFee: report.fee, ground, optimised }
  }
  throw new Error(`racers: no canonical signature in ${RACER_WINDOW_SECONDS} nLockTime candidates — ` +
    'that should be impossible at a 50% base rate, so something is wrong with the grind')
}

/* ── THE RACE ─────────────────────────────────────────────────────────────────────────────────── */
function buildRace(o: { key: PrivateKey; carTx: Transaction; carVout: number; carValue: number; fee: number; lowS: boolean }) {
  const { payee } = scriptsFor(o.key)
  const car = o.carTx.outputs[o.carVout].lockingScript.toBinary()
  /* ★ nLockTime is ENTIRELY free here — measured: the car reads hashOutputs, its own scriptCode and
     its own value, and never hashPrevouts, nSequence or nLocktime. So the grind costs nothing. */
  for (let lockTime = 0; lockTime < (o.lowS ? 512 : 1); lockTime++) {
    const built = buildRaceTx({
      car, payeeScript: payee, sourceSatoshis: o.carValue, fee: o.fee,
      sourceTXID: o.carTx.id('hex'), sourceOutputIndex: o.carVout, lockTime,
    })
    const pre = (built.tx.inputs[0].unlockingScript as UnlockingScript).chunks[0].data as number[]
    if (o.lowS && !derivedSigIsLowS(pre)) continue
    return { ...built, ground: lockTime }
  }
  throw new Error('racers: no canonical signature in 512 nLockTime candidates')
}

/* ── BROADCAST ────────────────────────────────────────────────────────────────────────────────── */
async function alreadyOnChain(id: string): Promise<boolean> {
  try { return (await fetch(`${WOC}/tx/hash/${id}`)).ok } catch { return false }
}
async function broadcast(tx: Transaction, label: string): Promise<void> {
  const raw = tx.toHex()
  const w = await fetch(`${WOC}/tx/raw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }),
  })
  const t = (await w.text()).trim()
  console.log(`   WoC          : ${w.status} ${t.slice(0, 120)}`)
  if (!w.ok) {
    /* ⚠ A failed broadcast is not a failure until our own txid has been checked. On a resume the
       transactions already sent come back as duplicates, which means it WORKED the first time. */
    if (await alreadyOnChain(tx.id('hex'))) { console.log(`        ${label} was already there ✓`); return }
    throw new Error(`broadcast rejected: ${t}`)
  }
  try {
    const b = await fetch(`${BB}/tx/broadcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }),
    })
    console.log(`   BananaBlocks : ${b.status} ${(await b.text()).trim().slice(0, 90)}`)
  } catch { console.log('   BananaBlocks : (skipped)') }
}
/** ⚠ WAIT FOR THE PARENT TO BE SEEN before spending it. Fire-and-forget is what orphans a chain. */
async function awaitSeen(id: string, tries = 20): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await alreadyOnChain(id)) { console.log(`        seen on the network ✓`); return }
    await sleep(1500)
  }
  throw new Error(`racers: ${id.slice(0, 16)}… was broadcast but never appeared — refusing to spend it`)
}

/* ── SELF-TEST — the whole run with a throwaway key and no network ────────────────────────────── */
async function selftest(): Promise<never> {
  const key = PrivateKey.fromRandom()
  const { owner, payee, block, address } = scriptsFor(key)
  const maxFee = racerDepotMaxFee({ carBlock: block, owner })
  const DEPOT = buildRacerDepotBasicLock({ carBlock: block, owner })
  const win = pastWindow(1786800000)

  bar('1 · THE DEPOT')
  console.log(`     address ${address}`)
  console.log(`     lock ${n(DEPOT.toBinary().length)} B · MAX_FEE ${n(maxFee)} (derived) · window ` +
    `${RACER_WINDOW_SECONDS}s × ${RACER_MINTS_PER_WINDOW}`)

  /* ── ⚠⚠ THE FUNDED GENESIS — the path that used to be untested ────────────────────────────────
     This step exists because it was missing. The self-test built a genesis as a bare output with no
     input, so reading a coin, signing a real P2PKH input and computing change never ran offline — and
     the first live dry run died instantly on `unlockingScript is undefined`, from pricing an unsigned
     transaction by serializing it. Everything that runs against a real wallet is built HERE now, with
     a synthetic coin, so a WIF is never needed to find out whether it works. */
  bar('2 · A FUNDED GENESIS, FROM A SYNTHETIC COIN')
  const coin = new Transaction()
  coin.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: 210_000 })
  const genesis = new Transaction()
  genesis.version = 2
  genesis.addInput({ sourceTransaction: coin, sourceOutputIndex: 0,
    unlockingScriptTemplate: new P2PKH().unlock(key), sequence: 0xffffffff })
  genesis.addOutput({ lockingScript: DEPOT, satoshis: TANK })
  genesis.addOutput({ lockingScript: new P2PKH().lock(address), change: true })
  await genesis.fee(new SatoshisPerKilobyte(100))
  await genesis.sign()
  const gBytes = genesis.toBinary().length
  const gFee = 210_000 - genesis.outputs.reduce((a, o) => a + (o.satoshis ?? 0), 0)
  console.log(`     ${gBytes} B · fee ${gFee} sat = ${(gFee * 1000 / gBytes).toFixed(1)} sat/KB · ` +
    `change ${n(genesis.outputs[1].satoshis ?? 0)} sat`)
  let gOK = false
  try {
    gOK = new Spend({
      sourceTXID: coin.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 210_000,
      lockingScript: coin.outputs[0].lockingScript, transactionVersion: 2, otherInputs: [],
      outputs: genesis.outputs, unlockingScript: genesis.inputs[0].unlockingScript!,
      inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
    }).validate()
  } catch { gOK = false }
  console.log(`     ${gOK ? '\x1b[32m★ the funding signature validates\x1b[0m' : '\x1b[31mthe funding input is REFUSED\x1b[0m'}`)
  if (gFee * 1000 / gBytes < 100) console.log('     \x1b[31m⚠ under the 100 sat/KB floor\x1b[0m')

  bar('3 · THE MINT')
  const m = buildMint({ key, depotTx: genesis, depotVout: 0, depotValue: TANK, window: win, lowS: true })
  console.log(`     car ${n(m.car.length)} B${m.optimised ? '' : ' · UNOPTIMISED (the run goes dry, so ' +
    'the optimiser will not certify it — built faithfully: bigger and dearer, and it races)'} · ` +
    `funded ${n(m.carFee + HOME)} sat · mint tx ${n(m.tx.toBinary().length)} B`)
  console.log(`     LOW_S grind: ${m.ground} nLockTime candidates skipped`)
  let ok = false, err = ''
  try { ok = m.spend.validate() } catch (e) { err = (e as Error).message.split('\n')[0] }
  console.log(`     ${ok ? '\x1b[32m★ the depot accepts the mint\x1b[0m' : '\x1b[31mREFUSED: ' + err + '\x1b[0m'}`)

  bar('4 · THE RACE')
  const r = buildRace({ key, carTx: m.tx, carVout: 0, carValue: m.carFee + HOME, fee: m.carFee, lowS: true })
  let ok2 = false, err2 = ''
  try { ok2 = r.spend.validate() } catch (e) { err2 = (e as Error).message.split('\n')[0] }
  console.log(`     race tx ${n(r.tx.toBinary().length)} B · fee ${n(m.carFee)} sat · grind ${r.ground}`)
  console.log(`     ${ok2 ? '\x1b[32m★ THE NETWORK ACCEPTS THE RACE\x1b[0m' : '\x1b[31mREFUSED: ' + err2 + '\x1b[0m'}`)
  console.log(`     ${n(HOME)} sat home to ${address}`)

  /* ⚠⚠ AND THE SIGNATURES MUST ACTUALLY BE CANONICAL. A grind that quietly gave up looks exactly
     like a grind that worked, and the difference only shows when ARC returns 461 on the first real
     broadcast — with a car already funded and a depot already spent. So it is CHECKED, not counted. */
  bar('5 · IS THE GRIND REAL?')
  const mintPre = (m.tx.inputs[0].unlockingScript as UnlockingScript).chunks.slice(-1)[0].data as number[]
  const racePre = (r.tx.inputs[0].unlockingScript as UnlockingScript).chunks[0].data as number[]
  const mLow = derivedSigIsLowS(mintPre), rLow = derivedSigIsLowS(racePre)
  console.log(`     the mint's derived signature is ${mLow ? 'LOW_S ✓' : '\x1b[31mHIGH-S — ARC will refuse it\x1b[0m'}`)
  console.log(`     the race's derived signature is ${rLow ? 'LOW_S ✓' : '\x1b[31mHIGH-S — ARC will refuse it\x1b[0m'}`)

  /* ★ And provoke it: with the grind OFF, a high-S spend must be reachable, or "always low-S" would
     be indistinguishable from "the check never runs". */
  let sawHigh = false
  for (let i = 0; i < 12 && !sawHigh; i++) {
    const k = PrivateKey.fromRandom()
    const sc = scriptsFor(k)
    const gtx = new Transaction()
    gtx.addOutput({ lockingScript: buildRacerDepotBasicLock({ carBlock: sc.block, owner: sc.owner }), satoshis: TANK })
    try {
      const raw = buildMint({ key: k, depotTx: gtx, depotVout: 0, depotValue: TANK, window: win, lowS: false })
      const pre = (raw.tx.inputs[0].unlockingScript as UnlockingScript).chunks.slice(-1)[0].data as number[]
      if (!derivedSigIsLowS(pre)) sawHigh = true
    } catch { /* keep trying */ }
  }
  console.log(`     with the grind OFF, a high-S spend ${sawHigh ? 'IS reachable ✓ — so the check is live' : '⚠ was not reached in 12 tries'}`)

  const good = gOK && ok && ok2 && mLow && rLow && sawHigh
  console.log(`\n${good ? 'SELFTEST OK — depot mints, car races, satoshis come home, signatures are canonical.' : '⚠ SELFTEST FAILED'}`)
  process.exit(good ? 0 : 1)
}

/* ── THE LIVE RUN ─────────────────────────────────────────────────────────────────────────────── */
async function run(): Promise<void> {
  const wif = process.env.RACERS_WIF
  if (!wif) { console.error('Set RACERS_WIF=<wif>  (or run --selftest first — it needs no key).'); process.exit(1) }
  const key = PrivateKey.fromWif(wif)
  const { owner, payee, block, address } = scriptsFor(key)
  const live = has('--broadcast')
  const DEPOT = buildRacerDepotBasicLock({ carBlock: block, owner })
  const maxFee = racerDepotMaxFee({ carBlock: block, owner })

  console.log(`address    : ${address}`)
  console.log(`depot lock : ${n(DEPOT.toBinary().length)} B · MAX_FEE ${n(maxFee)} derived · ` +
    `window ${RACER_WINDOW_SECONDS}s × ${RACER_MINTS_PER_WINDOW}`)

  /* ⚠ /unspent is an INDEX and it lags the mempool; only a 404 from /spent means unspent. */
  const utxos = await getJson(`/address/${address}/unspent`)
  const sorted = (Array.isArray(utxos) ? utxos : []).sort((a: any, b: any) => b.value - a.value)
  let coin: any = null
  for (const u of sorted) {
    const r = await fetch(`${WOC}/tx/${u.tx_hash}/${u.tx_pos}/spent`)
    await sleep(250)
    if (r.status !== 404 && !r.ok) { console.error(`Cannot tell whether ${u.tx_hash.slice(0,16)}… is spent (WoC ${r.status}). Refusing to guess.`); process.exit(1) }
    if (r.ok) { console.log(`  ⚠ skipping ${u.tx_hash.slice(0,16)}…:${u.tx_pos} — already spent`); continue }
    if (u.value >= TANK + 500) { coin = u; break }
  }
  if (!coin) { console.error(`No unspent coin of at least ${n(TANK + 500)} sat at ${address}.`); process.exit(1) }
  console.log(`funding    : ${coin.tx_hash.slice(0, 16)}…:${coin.tx_pos} (${n(coin.value)} sat)`)

  const srcHex = await (await fetch(`${WOC}/tx/${coin.tx_hash}/hex`)).text()
  const srcTx = Transaction.fromHex(srcHex.trim())

  bar('1 · THE DEPOT GENESIS')
  const g = new Transaction(); g.version = 2
  g.addInput({ sourceTransaction: srcTx, sourceOutputIndex: coin.tx_pos,
    unlockingScriptTemplate: new P2PKH().unlock(key), sequence: 0xffffffff })
  g.addOutput({ lockingScript: DEPOT, satoshis: TANK })
  g.addOutput({ lockingScript: new P2PKH().lock(address), change: true })
  /* ⚠⚠ NEVER SERIALIZE AN UNSIGNED TRANSACTION TO PRICE IT. `tx.toBinary()` throws
     `unlockingScript is undefined` at fee time, because the input has not been signed yet — and the
     fee is what decides the change, which is what gets signed. The first version of this line did
     exactly that and died on the first real funding input, having passed every offline test because
     `--selftest` built a genesis with NO input at all.
     ⇒ `SatoshisPerKilobyte` asks the unlocking TEMPLATE for its estimated length instead, which is
     the whole reason templates carry one. 100 sat/KB, the official rate — never inflated. */
  await g.fee(new SatoshisPerKilobyte(100))
  await g.sign()
  console.log(`     txid  ${g.id('hex')}`)
  console.log(`     tank  ${n(TANK)} sat  ·  tx ${n(g.toBinary().length)} B`)
  if (live) { await broadcast(g, 'the depot'); await awaitSeen(g.id('hex')) }

  bar('3 · THE MINT')
  const win = pastWindow(Math.floor(Date.now() / 1000))
  const m = buildMint({ key, depotTx: g, depotVout: 0, depotValue: TANK, window: win, lowS: true })
  const sim = simulate(TRACK, FUEL)
  console.log(`     ${TRACK} m · ${sim.run.ticks.length} ticks · ${sim.secs.toFixed(2)} s · ends '${sim.run.ending}'`)
  console.log(`     car ${n(m.car.length)} B · ${m.optimised ? 'optimised' : 'UNOPTIMISED — the run ' +
    'goes dry, so the optimiser will not certify it'} · funded ${n(m.carFee + HOME)} sat`)
  console.log(`     txid  ${m.tx.id('hex')}  ·  ${n(m.tx.toBinary().length)} B · grind ${m.ground}`)
  if (!m.spend.validate()) { console.error('the depot refuses this mint — not sending'); process.exit(1) }
  console.log('     \x1b[32m★ the depot accepts it\x1b[0m')
  if (live) { await broadcast(m.tx, 'the car'); await awaitSeen(m.tx.id('hex')) }

  bar('4 · THE RACE')
  const r = buildRace({ key, carTx: m.tx, carVout: 0, carValue: m.carFee + HOME, fee: m.carFee, lowS: true })
  console.log(`     txid  ${r.tx.id('hex')}  ·  ${n(r.tx.toBinary().length)} B · grind ${r.ground}`)
  if (!r.spend.validate()) { console.error('the car refuses this race — not sending'); process.exit(1) }
  console.log('     \x1b[32m★ THE NETWORK ACCEPTS THE RACE\x1b[0m')
  if (live) await broadcast(r.tx, 'the race')

  bar('4 · THE MONEY')
  console.log(`     tank out   ${n(m.carFee + HOME)} sat to the car`)
  console.log(`     miner      ${n(m.carFee)} sat`)
  console.log(`     home       ${n(HOME)} sat → ${address}`)
  console.log(live
    ? `\n🏁 On chain. Depot ${g.id('hex')}\n   ⚠ KEEP THAT TXID — nothing will find it for you.`
    : '\n(dry build — nothing was sent. Re-run with --broadcast to race for real.)')
}

async function main(): Promise<void> {
  if (has('--selftest')) return selftest()
  if (has('--run')) return run()
  console.log('usage: --selftest  |  --run [--broadcast]')
  console.log('       --track <m> --fuel <sat> --eng <n> --tyr <n> --tank <sat> --home <sat>')
  console.log('       WIF via RACERS_WIF only.')
}
await main()
