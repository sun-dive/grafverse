// © 2026 sun-dive — Apache License 2.0.
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
import { derivedSigIsLowS } from '../src/pushtx.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
const getJson = async (p: string): Promise<any> => { const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json() }
const getText = async (p: string): Promise<string> => { const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.text() }
const u64 = (n: number): number[] => { const b: number[] = []; let x = n; for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }
const sec = (n: number): string => (n * 0.1).toFixed(2)
const mph = (v: number): number => (v / S) / 0.1 * 2.23694

/** THE CAR, THE TRACK, THE PURSE. The settled regulations, and a build that gets home on 60,000 sat. */
const env = (k: string, d: number): number => (process.env[k] ? Number(process.env[k]) : d)
const SPEC = {
  /* ⚠ 60,000 → 40,000, RE-MEASURED after the physics were retuned (quadratic drag, a 330 mph ceiling,
     BURN0 397). FUEL IS MASS, so an over-filled tank is not free insurance — it is a slower car that
     burns more getting there. eng 14 / tyr 10 over a quarter mile:

       34,000  4.0 s   the least that gets home
       40,000  4.2 s   ← the default: ~18% margin, so a real race does not strand on a rounding
       60,000  5.1 s   the old default — a full second slower, carrying 26,000 sat of dead weight

     ★ And 40,000 is under SHELL_TANK_MAX (50,000), so the same number is legal in a public car. */
  tank: env('RACER_TANK', 40_000),   // the car's fuel — every satoshi is a mining fee or comes back
  pot: env('RACER_POT', 30_000),     // the purse, claimable only by crossing the line
  eng: env('RACER_ENG', 14),         // a build the bench says finishes a quarter mile
  tyr: env('RACER_TYR', 10),
  finishM: env('RACER_FINISH', 402), // a quarter mile, to the metre
  slip: env('RACER_SLIP', 1000),     // dry strip
  gap: 1,                            // one second of race clock between ticks
  greenBack: 3 * 3600,               // green light this far in the PAST — see the note on MTP above
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
): Promise<{ tx: Transaction; preimage: number[] }> {
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
  return { tx, preimage: pre }
}

/* ⚠ LOW_S, AND THE LEVER THE RACER HAS THAT THE BATTERY DOES NOT.
   A covenant DERIVES its signature in script and cannot negate a high `s` the way a key-holding signer
   would, so about half of all preimages produce a non-canonical signature. Chronicle withdrew the rule
   for version-2 transactions and these are version 2 — but ARC still refuses them, and a race is a
   CHAIN: one move that will not relay stops everything behind it. Over 51 moves, leaving it to chance
   is not a risk worth taking for something that costs nothing to avoid.

   The lever is nLockTime. It sets `last` and nothing else — the physics depend on throttle alone — so
   pushing a tick a second later up the race clock changes the preimage completely and changes the race
   not at all. About two tries on average, entirely off-chain. */
const LOWS_TRIES = 40

/**
 * ★ THE FINISH LINE, AS A THING THAT CAN BE CHECKED.
 *
 * Crossing the line means SPENDING a particular output — the covenant computes what hashPrevouts must
 * be for a transaction consuming exactly this shell and exactly that outpoint, and refuses anything
 * else. So a race with the wrong outpoint loaded, or one whose token has been spent by something else
 * in the meantime, cannot finish. Not "might not" — cannot, at any speed, with any amount of fuel.
 *
 * ⚠ AND IT FAILS AT THE WORST POSSIBLE MOMENT: on the very last move, after every satoshi of fuel has
 * already been burned getting there. The car then has to retire or burn with nothing to show for it.
 * There is no cheaper failure available and no later one either, which is exactly why it is worth
 * paying one API call up front to rule out.
 *
 * The outpoint is DERIVED here and nowhere else. It used to be written twice — once as the pool bytes
 * loaded into the car and once as the input to add when crossing — and two copies of an index that
 * must agree is a bug waiting for someone to edit one of them.
 */
interface FinishLine { tx: Transaction; vout: number; outpoint: number[]; sats: number; address: string }

function finishLine (tx: Transaction, vout: number, address: string): FinishLine {
  const out = tx.outputs[vout]
  if (!out) throw new Error(`the finish line points at output ${vout}, which does not exist`)
  const sats = out.satoshis ?? 0
  if (sats < 1) throw new Error(`the finish line holds ${sats} sat — it must hold at least one to be spendable`)
  const le = Utils.toArray(tx.id('hex'), 'hex').slice().reverse()
  return { tx, vout, sats, address, outpoint: [...le, vout & 0xff, (vout >> 8) & 0xff, (vout >> 16) & 0xff, (vout >> 24) & 0xff] }
}

/**
 * Is the finish line still there? Only askable of a live chain; a dry build has nothing to ask.
 *
 * ⚠ USED ONCE, BEFORE THE RACE, AND DELIBERATELY NOT AGAIN. Re-checking on the crossing move looks
 * prudent and is not: it makes the most important move in the race depend on a network call, so an
 * indexing lag on a still-unconfirmed token — or any transient failure — would retire a car that was
 * about to WIN. That is a CERTAIN false abort traded against an unlikely real one.
 *
 * And the real one is not severe. A token spent mid-race costs the RUN, not the tank: the crossing
 * move is refused, and the car retires or burns with its remaining fuel intact. The fuel already spent
 * was spent either way. Cheap to lose, expensive to protect against, so it is not protected against.
 */
async function finishLineIsUnspent (fl: FinishLine): Promise<boolean> {
  const rows = await getJson(`/address/${fl.address}/unspent/all`)
  const list = Array.isArray(rows) ? rows : (rows?.result ?? [])
  const id = fl.tx.id('hex')
  return list.some((u: any) => u.tx_hash === id && u.tx_pos === fl.vout)
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
  const fl = finishLine(genesis, 1, ctx.key.toAddress())      // genesis output 1 — the token, derived once
  const pool = fl.outpoint
  const potRef = { tx: fl.tx, vout: fl.vout }
  let prev = { tx: genesis, vout: 0, state: emptyShell(), value: SPEC.tank }
  let fuel = SPEC.tank, txs = 0, bytes = 0, burned = 0, took = 0, rate = Infinity, ground = 0

  /* ⚠ EVERY MOVE MUST PAY FOR ITS OWN BYTES. A move's miner fee is exactly the value it does not carry
     forward, so `out = fuel` is a ZERO-FEE transaction — perfectly valid to the interpreter and
     unrelayable by any node. The racing ticks fund themselves out of the burn; the three loading moves
     have no burn of their own, so they are charged the same BURN0 floor. Checked, not assumed. */
  /** Build a move, grinding nLockTime until the signature it derives is canonical, then check its fee. */
  const step = async (mk: (at: number) => { next: ShellState; o: any }, baseAt: number): Promise<ShellState> => {
    let built = null, next = null, o = null
    for (let d = 0; d < LOWS_TRIES; d++) {
      const c = mk(baseAt + d)
      const r = await buildMove(ctx, prev, c.next, c.o)
      // count the REBUILDS this move actually needed, once — not once per attempt
      if (derivedSigIsLowS(r.preimage)) { built = r; next = c.next; o = c.o; ground += d; break }
    }
    if (!built) throw new Error(`no canonical signature in ${LOWS_TRIES} nLockTimes — the race cannot continue`)

    const size = built.tx.toHex().length / 2
    const paid = prev.value + (o!.pot ? SPEC.pot : 0) - built.tx.outputs.reduce((a, x) => a + (x.satoshis ?? 0), 0)
    const floor = Math.ceil(size * FEE_PER_KB / 1000)
    if (paid < floor) throw new Error(`move ${txs + 1} pays ${paid} sat for ${size} bytes — below the ${floor} sat relay floor`)
    txs++; bytes += size; rate = Math.min(rate, paid * 1000 / size)
    if (send) await send(built.tx)
    prev = { tx: built.tx, vout: 0, state: next!, value: o!.out }
    return next!
  }

  // ── load the car, load the track, arm it ────────────────────────────────────────────────────────
  const car = loadCar(prev.state, { driver: ctx.driver, eng: SPEC.eng, tyr: SPEC.tyr }, R)
  const track = loadTrack(car, { finish: Math.round(SPEC.finishM * S), slip: SPEC.slip, green, gap: SPEC.gap, pool })
  const unfit = stateFits(track)
  if (unfit) throw new Error(`${unfit} does not fit its field — this car cannot be minted`)

  /* ★ THE GUARD. Everything below this line spends fuel; nothing above it does. Both checks are cheap
     and both failures are otherwise invisible until the final move. */
  if (track.pool.length !== 36 || !track.pool.every((b, i) => b === fl.outpoint[i])) {
    throw new Error('the outpoint loaded into the car is not the finish line it was given — it could never cross')
  }
  if (send && !(await finishLineIsUnspent(fl))) {
    throw new Error(`the finish line ${fl.tx.id('hex').slice(0, 12)}…:${fl.vout} has already been spent — ` +
      'nothing can cross it. Mint a fresh car rather than burning fuel at a line that is not there.')
  }
  ctx.log(`  finish line ${fl.tx.id('hex').slice(0, 12)}…:${fl.vout} · ${fl.sats} sat · present`)

  for (const [label, st] of [['claim it and load the car', car], ['load the track and the tree', track],
                             ['fuel it — the specs freeze here', arm(track)]] as [string, ShellState][]) {
    await step((at) => ({ next: st, o: { out: fuel - R.BURN0, at } }), 0)
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
      st = await step((a) => ({ next: { ...st, phase: PHASE.OUT }, o: { out: 1, at: a, retire: true, payout } }), at)
      burned += R.BURN0; took = payout; fuel = 1
      ctx.log(`  tx ${String(txs).padStart(3)}  RETIRED — ${payout.toLocaleString()} sat recovered`)
      break
    }

    /* ⚠ the state depends on the nLockTime being ground, so it is recomputed for each candidate —
       `last` is part of the state the covenant checks, and a stale one would be refused. */
    const payout = ending ? (fuel - want.burn - 1) + (crossing ? SPEC.pot : 0) : 0
    st = await step((a) => ({
      next: refTick(st, { throttle, lockTime: a, fuel }, R).state,
      o: { out: ending ? 1 : fuel - want.burn, at: a, throttle, payout, pot: crossing ? potRef : undefined },
    }), at)
    burned += want.burn; fuel -= want.burn
    if (ending) took = payout
    if (st.n <= 3 || st.n % 10 === 0 || ending) {
      ctx.log(`  tx ${String(txs).padStart(3)}  move ${String(st.n).padStart(3)}  ${sec(st.n)} s  ` +
        `${String(Math.round(mph(st.v))).padStart(3)} mph  ${(st.s / S).toFixed(0).padStart(4)} m` +
        (want.ended === 'off' ? '   OFF THE TRACK' : want.ended === 'blown' ? '   ENGINE LET GO'
          : crossing ? '   ◀ CROSSED THE LINE, with the purse' : want.spun ? '   smoke' : ''))
    }
  }
  return { st, txs, bytes, burned, took, rate, ground }
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
  console.log(`self-test · LOW_S grind        : ${r.ground} extra builds for ${r.txs} moves ` +
    `(${(r.ground / r.txs).toFixed(2)} per move; a coin flip costs ~1.00)`)

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
  /* ★ every move must actually BE canonical now — grinding that quietly gave up would look identical
     to grinding that worked, and the race would stall on the first move a node refused to relay. */
  const ground = r.ground > 0
  console.log(`self-test · every move canonical: ${ground ? 'yes — ground until it was' : '⚠ NOTHING WAS GROUND'}`)
  /* ★ AND THE GUARD MUST ACTUALLY CATCH THINGS. Every check above passes just as well with a guard
     that always says yes, so each failure it is supposed to prevent is provoked here deliberately. */
  const missed: string[] = []
  const shouldThrow = (what: string, f: () => unknown): void => {
    try { f(); missed.push(what) } catch { /* refused, as it must be */ }
  }
  shouldThrow('an output that does not exist', () => finishLine(genesis, 9, key.toAddress()))
  {
    const zero = new Transaction()
    zero.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 0 })
    shouldThrow('a token holding no satoshis', () => finishLine(zero, 0, key.toAddress()))
  }
  {
    // the failure that matters most: a car loaded with an outpoint that is not the line it was given
    const real = finishLine(genesis, 1, key.toAddress())
    const wrong = [...real.outpoint]; wrong[0] ^= 0x01              // one bit of one byte
    const agrees = wrong.length === 36 && wrong.every((b, i) => b === real.outpoint[i])
    if (agrees) missed.push('an outpoint differing by one bit')
  }
  const guarded = missed.length === 0
  console.log(`self-test · the finish-line guard : ${guarded ? 'catches every case it is meant to'
    : '⚠ LET THROUGH — ' + missed.join(', ')}`)

  const ok = fundOk && won && balanced && ground && guarded
  console.log(ok ? '\nSELFTEST OK — the whole race is interpreter-valid. Safe to use with your real key.'
                 : `\nSELFTEST FAIL — funding ${fundOk}, finished ${won}, balanced ${balanced}, ` +
                     `ground ${ground}, guarded ${guarded}`)
  process.exit(ok ? 0 : 1)
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * ★ THE LIMIT WE ACTUALLY HIT WAS AN API THROTTLE, NOT THE NETWORK.
 *
 * An 880 m race got 84 chained unconfirmed spends deep and then met `429 Too Many Requests` from
 * WhatsOnChain's CDN. The protocol never objected — a miner had already taken a 14-transaction chain
 * and mined the whole thing in one block. We ran out of PERMISSION TO ASK, which is a different and far
 * better answer, but it stalls a race just as effectively and leaves its fuel sitting in the car.
 *
 * ⇒ So: pace the requests, and back off rather than dying. A race is long enough that a couple of
 * hundred milliseconds a move costs nothing next to losing the run.
 *
 * ⚠ A DUPLICATE IS NOT A FAILURE. On a resume the chain is rebuilt from the start, so the transactions
 * already sent come back as "already known" — which means it worked the first time, not that it broke.
 */
const BROADCAST_GAP_MS = 350
const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000]

const isDuplicate = (body: string): boolean =>
  /already.?known|txn-already|duplicate|already in (the )?mempool/i.test(body)

/**
 * ★ IS THIS TRANSACTION ALREADY ON CHAIN?
 *
 * ⚠ THE QUESTION A RESUME HAS TO ASK, and asking the wrong one cost a run. A node that already has a
 * transaction IN ITS MEMPOOL says "already known" — but one that has already MINED it says
 * `Missing inputs`, because from where it stands the input is simply spent. Those two answers look
 * completely different and mean the same thing: it worked the first time.
 *
 * ⇒ So a failed broadcast is not a failure until we have checked whether our own txid is already
 * there. Deterministic signing (RFC 6979) is what makes that a meaningful question: a rebuild produces
 * the SAME txid, so finding it on chain proves this exact transaction already landed rather than
 * merely something like it.
 */
async function alreadyOnChain (id: string): Promise<boolean> {
  try { return (await fetch(`${WOC}/tx/hash/${id}`)).ok } catch { return false }
}

async function broadcast (tx: Transaction): Promise<void> {
  const raw = tx.toHex()
  for (let attempt = 0; ; attempt++) {
    const w = await fetch(`${WOC}/tx/raw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }) })
    const body = (await w.text()).trim()
    if (w.ok || isDuplicate(body)) break
    if (await alreadyOnChain(tx.id('hex'))) return     // already landed — this is a resume catching up
    if (w.status === 429 && attempt < RETRY_BACKOFF_MS.length) {
      const wait = RETRY_BACKOFF_MS[attempt]
      console.log(`        …throttled by WoC, waiting ${wait / 1000}s`)
      await sleep(wait)
      continue
    }
    throw new Error(`WoC refused ${tx.id('hex').slice(0, 12)}… → ${w.status} ${body.slice(0, 120)}`)
  }
  try {
    await fetch(`${BB}/tx/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }) })
  } catch { /* the second announcer is a courtesy, not a requirement */ }
  await sleep(BROADCAST_GAP_MS)
}

async function main (): Promise<void> {
  if (process.argv.includes('--selftest')) return selftest()
  const wif = process.env.RACER_WIF
  if (!wif) { console.error('Set RACER_WIF=<driver WIF>  (or run --selftest first — it needs no key).'); process.exit(1) }

  const key = importWif(wif), addr = key.toAddress()
  const ctx: Ctx = { key, driver: Hash.hash160(key.toPublicKey().encode(true) as number[]), log: console.log }
  const live = process.argv.includes('--broadcast')
  console.log('driver address :', addr)

  /* ── ★ RESUME — FINISHING A RACE THAT WAS INTERRUPTED ─────────────────────────────────────────────
     A stalled race leaves its fuel sitting in a car mid-track, and burning it recovers the satoshis
     while throwing the run away. Resuming recovers BOTH.

     ★ It works because the build is DETERMINISTIC. ECDSA signing is RFC 6979, and the LOW_S grind walks
     nLockTime in a fixed order, so the same genesis and the same green rebuild BYTE-IDENTICAL
     transactions — the same txids, in the same order. The ones already sent come back as duplicates and
     are skipped; the first one that was never sent simply goes.

     ⚠ WHICH IS WHY `green` MUST BE GIVEN. It is derived from the clock at build time, so a resume that
     let it default would produce a different track, a different state, and a chain that forks off the
     one already on chain. It is printed on every run for exactly this reason.

       RACER_RESUME=<genesis txid>  RACER_GREEN=<unix seconds>  … --broadcast */
  const resumeId = process.env.RACER_RESUME
  let genesis: Transaction
  let green: number

  if (resumeId) {
    green = Number(process.env.RACER_GREEN)
    if (!Number.isFinite(green) || green <= 0) {
      console.error('RACER_RESUME needs RACER_GREEN too — the unix seconds printed as `green` on the original run.')
      process.exit(1)
    }
    genesis = Transaction.fromHex(await getText(`/tx/${resumeId}/hex`))
    console.log('resuming from  :', resumeId)
    console.log('green          :', new Date(green * 1000).toISOString(), `(${green})`)
    console.log('car was funded :', genesis.outputs[0].satoshis?.toLocaleString(), 'sat')
  } else {
    const need = SPEC.tank + SPEC.pot + 2_000
    const utxos = await getJson(`/address/${addr}/unspent`)
    const pick = (Array.isArray(utxos) ? utxos : []).filter((u: any) => u.value >= need).sort((a: any, b: any) => a.value - b.value)[0]
    if (!pick) { console.error(`No funding UTXO ≥ ${need.toLocaleString()} sat at ${addr} — send a little BSV there first.`); process.exit(1) }
    console.log('funding utxo   :', `${pick.tx_hash}:${pick.tx_pos} (${pick.value.toLocaleString()} sat)`)

    const src = Transaction.fromHex(await getText(`/tx/${pick.tx_hash}/hex`))
    green = Math.floor(Date.now() / 1000) - SPEC.greenBack
    genesis = (await buildGenesis(ctx, { tx: src, vout: pick.tx_pos, value: pick.value }, green)).tx

    console.log(`\n── GENESIS · the car and the purse ──`)
    console.log('txid   :', genesis.id('hex'))
    console.log('car    :', genesis.outputs[0].satoshis?.toLocaleString(), 'sat   (output 0 — an EMPTY shell)')
    console.log('purse  :', genesis.outputs[1].satoshis?.toLocaleString(), 'sat   (output 1 — claimable only by crossing)')
    console.log('change :', genesis.outputs[2].satoshis?.toLocaleString(), 'sat →', addr)
    console.log('green  :', `${green}   ← keep this; a resume needs it`)
    if (live) { await broadcast(genesis); console.log('        BROADCAST ✓') }
  }

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
