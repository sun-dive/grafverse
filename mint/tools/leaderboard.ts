// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ THE LEADERBOARD — read from the chain, with no index anywhere.
 *
 *   node --experimental-strip-types mint/tools/leaderboard.ts [--depot <genesis txid>]
 *
 * ── ★★ WHY THIS NEEDS NO INDEXER ──────────────────────────────────────────────────────────────────
 * Nothing indexes covenants — that is the standing problem, and beacons in OP_RETURN were measured NOT
 * to be indexed either. But a leaderboard does not need one: **every mint is a hop in the depot's own
 * chain.** Walk the depot from its genesis and you have enumerated every car it ever made, in order,
 * from one starting txid. The chain is the index.
 *
 * ── ★★ AND THE TIME IS NOT STORED ANYWHERE ────────────────────────────────────────────────────────
 * A one-race car's head carries the SETUP — driver, fuel, engine, tyres, surface, distance — at fixed
 * offsets, pushed and then dropped unread. It does not carry the RESULT, and it does not need to:
 * **the time is a function of the configuration**, so anyone re-derives it with the reference physics.
 * ⇒ The chain proves the car existed, was funded, and was raced. The physics says how fast.
 * ⚠ Which means a leaderboard cannot be lied to about a time without lying about the physics, and the
 * physics is the thing the covenant enforced when the race validated.
 *
 * ── ⚠ WHAT COUNTS AS A RACE ───────────────────────────────────────────────────────────────────────
 * A minted car that was never spent never raced. So a row requires the car output to be SPENT — that
 * spend IS the race, and the network validating it is what makes the time real.
 *
 * ── ⚠ WHAT IS SHOWN, AND WHAT IS NOT (sun-dive, 20 Aug) ───────────────────────────────────────────
 * Surface and distance ARE shown: they are the CATEGORY, because a time is only comparable against
 * another run at the same distance on the same grip. The car's configuration is NOT shown — engine,
 * tyres and fuel stay the driver's business, or the board becomes a copy of whatever won last.
 *
 * ⚠ SCALING, said plainly: this is 2–3 WoC calls per race and they are spaced to stay inside the rate
 * limit. It is right for tens of races and wrong for thousands — at that point the honest fix is a
 * cache that remembers the walk, not a different design.
 */
import { Transaction } from '@bsv/sdk'
import { readDepotState } from '../src/racerDepotFrame.ts'
import { CAR_LAYOUT } from '../src/racerCar.ts'
import { racerRefTick, ONE_RACE_REGS as R } from '../src/racerPhysics.ts'
import { S, PHASE, type ShellState } from '../src/shell.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const GENESIS = '607272d1b35d6f0c4f1179fef2e4556d41f9bfb4bbed394de1f83e300ee0d1d7'
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

/**
 * ⚠⚠ BACK OFF, DO NOT GIVE UP. The first version aborted the whole walk on one 429 and then printed the
 * GENESIS as the tip — a wrong answer wearing the shape of an answer. WoC throttles at around eighty
 * calls in two minutes (measured 19 Aug), and a leaderboard walks the chain every time it loads, so
 * being throttled is the NORMAL case and not the exceptional one.
 * ⇒ Retry with a widening gap; only after that give up, and when we give up SAY SO rather than report
 * a short board as if it were complete.
 */
async function get(path: string, tries = 5): Promise<Response | null> {
  let wait = 500
  for (let i = 0; i < tries; i++) {
    const r = await fetch(WOC + path)
    if (r.ok || r.status === 404) { await sleep(350); return r }
    await sleep(wait); wait *= 2                       // 0.5s → 1 → 2 → 4 → 8
  }
  return null
}
/** ⚠ 404 means UNSPENT. A failure after backing off means WE DO NOT KNOW, and must not be guessed. */
async function spentStatus(txid: string, vout: number): Promise<'spent' | 'unspent' | 'unknown'> {
  const r = await get(`/tx/${txid}/${vout}/spent`)
  if (!r) return 'unknown'
  return r.status === 404 ? 'unspent' : 'spent'
}
async function txOf(txid: string): Promise<Transaction | null> {
  const r = await get(`/tx/${txid}/hex`)
  if (!r || !r.ok) return null
  return Transaction.fromHex((await r.text()).trim())
}

const isDepot = (script: number[]): { mark: number; count: number } | null => {
  try { return readDepotState(script) } catch { return null }
}

/**
 * ★★ THE HEAD, AT FIXED OFFSETS — AND IN EVERY LAYOUT THAT HAS EVER BEEN MINTED.
 *
 * ⚠⚠ THIS IS WHERE THE FIRST VERSION LOST ITS OWN HISTORY. `NAME_BYTES` went 12 → 24 on 20 Aug, and a
 * reader that only knew the current `CAR_LAYOUT` found exactly ONE car — the newest — and silently
 * skipped every earlier race as if it had never happened. **A leaderboard that cannot read old cars
 * does not have a short memory; it has a wrong answer.**
 *
 * ★ The fix falls out of the format itself: the first byte of a car is the PUSH LENGTH of its name, so
 * the head announces its own layout. 0x0c is the 12-byte era, 0x18 the 24-byte one. No version flag was
 * needed because a push opcode already encodes its own length.
 * ⇒ Add a row here whenever the layout changes. Never remove one — a minted car is permanent, and the
 * only thing that can stop it being readable is us forgetting how.
 */
const LAYOUTS: Array<{ name: string; fields: Array<{ name: string; width: number }> }> = [
  { name: 'name$24 (20 Aug →)', fields: CAR_LAYOUT.map(f => ({ name: f.name, width: f.width })) },
  { name: 'name$12 (→ 20 Aug)',
    fields: CAR_LAYOUT.map(f => ({ name: f.name, width: f.name === 'name' ? 12 : f.width })) },
]
function readHead(car: number[]): { head: Record<string, number[]>; layout: string } | null {
  for (const L of LAYOUTS) {
    let i = 0, ok = true
    const out: Record<string, number[]> = {}
    for (const f of L.fields) {
      if (car[i] !== f.width) { ok = false; break }
      out[f.name] = car.slice(i + 1, i + 1 + f.width)
      i += 1 + f.width
    }
    if (ok) return { head: out, layout: L.name }
  }
  return null
}
const num = (b: number[]): number => b.reduce((a, x, k) => a + x * 2 ** (8 * k), 0)
const text = (b: number[]): string => new TextDecoder().decode(new Uint8Array(b.filter(x => x !== 0)))

/**
 * ★★ RE-DERIVE THE RACE from the setup the chain carries. This is the whole trick: the result is not
 * stored, it is RECOMPUTED, and it can only come out one way.
 */
function derive(h: Record<string, number[]>): { secs: number; mph: number; ending: string; got: number } {
  const finish = num(h.finish)
  let st: ShellState = {
    phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
    eng: num(h.eng), tyr: num(h.tyr), finish, slip: num(h.slip), green: 0, gap: 1, last: 100,
    s: 0, v: 0, n: 0,
  } as never
  let fuel = num(h.fuel), t = 0
  for (let i = 0; i < 400; i++) {
    let r
    try { r = racerRefTick(st, { throttle: 8, fuel, lockTime: st.last + st.gap }, R) }
    catch { return { secs: 0, mph: 0, ending: 'refused', got: 0 } }
    fuel = Math.max(0, fuel - r.burn); t++
    st = { ...(r.state as ShellState), last: st.last + st.gap }
    if (r.ended !== null) return { secs: t / 10, mph: 0, ending: r.ended, got: st.s / S }
    if (st.phase === PHASE.DONE) return { secs: t / 10, mph: (st.v / S) * 2.23694 * 10, ending: 'finish', got: st.s / S }
  }
  return { secs: t / 10, mph: 0, ending: 'unresolved', got: st.s / S }
}

interface Row {
  driver: string; secs: number; mph: number; metres: number; slip: number
  ending: string; got: number; mint: string; raced: boolean; layout: string
}

async function walk(genesis: string): Promise<{ rows: Row[]; tip: string | null; tank: number; unknown: number; other: number; cutShort: boolean }> {
  const rows: Row[] = []
  let other = 0
  let cur = { txid: genesis, vout: 0 }
  /* ⚠ `tip` starts UNKNOWN, not at the genesis. A walk that is cut short must not name a tip it never
     reached — the first version printed the genesis and 0 sat, which reads as a finished answer. */
  let tip: string | null = null, tank = 0, unknown = 0, cutShort = false

  for (let hop = 0; hop < 200; hop++) {
    const status = await spentStatus(cur.txid, cur.vout)
    if (status === 'unknown') { unknown++; cutShort = true; break }
    if (status === 'unspent') {
      const t = await txOf(cur.txid)
      tip = `${cur.txid}:${cur.vout}`
      tank = t?.outputs[cur.vout].satoshis ?? 0
      break
    }
    /* it was spent — the spending transaction IS a mint (or the owner's burn) */
    const spRes = await get(`/tx/${cur.txid}/${cur.vout}/spent`)
    if (!spRes || !spRes.ok) { unknown++; cutShort = true; break }
    const sp = await spRes.json()
    const tx = await txOf(sp.txid)
    if (!tx) { unknown++; cutShort = true; break }

    let depotAt = -1
    tx.outputs.forEach((o, n) => { if (depotAt < 0 && isDepot(o.lockingScript.toBinary())) depotAt = n })

    /* every other output is a candidate car. ⚠ Not every depot spend is a MINT — a top-up spends the
       depot and makes a new depot with no car at all, and the owner's burn ends the chain. An output
       with no readable head is one of those, not a car we failed to understand. */
    let sawCar = false
    for (let n = 0; n < tx.outputs.length; n++) {
      if (n === depotAt) continue
      const parsed = readHead(tx.outputs[n].lockingScript.toBinary())
      if (!parsed) continue
      sawCar = true
      const h = parsed.head
      /* ⚠ A CAR THAT WAS NEVER SPENT NEVER RACED. The spend is the race. */
      const raced = await spentStatus(sp.txid, n)
      if (raced === 'unknown') unknown++
      const d = derive(h)
      rows.push({ driver: text(h.name) || '(no name)', secs: d.secs, mph: d.mph,
        metres: Math.round(num(h.finish) / S), slip: num(h.slip), ending: d.ending, got: d.got,
        mint: sp.txid, raced: raced === 'spent', layout: parsed.layout })
    }
    if (!sawCar) other++
    if (depotAt < 0) break                    // the owner burned it: the chain ends
    cur = { txid: sp.txid, vout: depotAt }
  }
  return { rows, tip, tank, unknown, other, cutShort }
}

/* ── the board ──────────────────────────────────────────────────────────────────────────────────── */
const genesis = arg('depot', GENESIS)
console.log(`\n  walking the depot from ${genesis.slice(0, 16)}…  (2–3 WoC calls a race, spaced)\n`)
const { rows, tip, tank, unknown, other, cutShort } = await walk(genesis)

const raced = rows.filter(r => r.raced)
const byClass = new Map<string, Row[]>()
for (const r of raced) {
  const k = `${r.metres} m · grip ${r.slip}`
  if (!byClass.has(k)) byClass.set(k, [])
  byClass.get(k)!.push(r)
}

const eras = [...new Set(rows.map(r => r.layout))]
console.log(`  ${rows.length} car(s) minted · ${raced.length} raced` +
  (other ? ` · ${other} depot spend(s) that made no car (top-ups, or the owner's burn)` : '') +
  (eras.length > 1 ? `\n  ★ across ${eras.length} car layouts: ${eras.join(' · ')}` : '') + '\n')
for (const [cls, list] of [...byClass].sort((a, b) => b[1].length - a[1].length)) {
  /* ★ THE CATEGORY IS THE DISTANCE AND THE SURFACE — a time means nothing without both. */
  console.log(`  \x1b[1m${cls}\x1b[0m`)
  console.log('     #   driver                      time      speed   result')
  const fin = list.filter(r => r.ending === 'finish').sort((a, b) => a.secs - b.secs || b.mph - a.mph)
  const rest = list.filter(r => r.ending !== 'finish')
  fin.forEach((r, i) => console.log(
    `    ${String(i + 1).padStart(2)}   ${r.driver.padEnd(24)}  ${r.secs.toFixed(2)} s   ${Math.round(r.mph).toString().padStart(4)} mph   🏁`))
  for (const r of rest) console.log(
    `     —   ${r.driver.padEnd(24)}     —          —   ${r.ending === 'stopped'
      ? `⛽ halted at ${r.got.toFixed(0)} m` : r.ending === 'off' ? '💨 off the track' : '💥 engine'}`)
  console.log()
}
/* ⚠ minted but never raced — shown apart, because an unraced car has no time and never will */
const idle = rows.filter(r => !r.raced)
if (idle.length) console.log(`  ⚠ ${idle.length} car(s) minted but never raced — no time, and they are unspendable by anyone else.\n`)
if (cutShort) {
  console.log(`  \x1b[31m⚠⚠ THE WALK WAS CUT SHORT\x1b[0m after ${unknown} lookup(s) that WoC would not answer even`)
  console.log(`     after backing off. THIS BOARD IS INCOMPLETE — races after the break are missing, and`)
  console.log(`     that is a gap in what could be READ, never a claim that nothing else was raced.\n`)
}
console.log(tip
  ? `  depot tip ${tip.slice(0, 16)}…  ${tank.toLocaleString()} sat`
  : '  \x1b[31mdepot tip UNKNOWN — the walk never reached it\x1b[0m')
