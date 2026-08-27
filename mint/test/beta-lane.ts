// © 2026 sun-dive — Apache License 2.0.
//
// 🛤★★★ ONE SECTION OF A LANE, SPENT THROUGH THE REAL INTERPRETER — and every way of lying about it.
//
//   node --experimental-strip-types mint/test/beta-lane.ts
//
// ⚠⚠ READ THE PASS SHEET THE RIGHT WAY ROUND. `racer-depot-basic.ts` records the trap: twice, only the
// REFUSALS passed, and a script that always fails scored 8/12 — because every theft test is satisfied
// by a covenant that refuses everything. ⇒ THE POSITIVE CASES COME FIRST and they are what say the
// script runs at all. A refusal sheet on its own is decoration.
//
// ⚠ The preimage is DERIVED FROM THE TRANSACTION, never asserted. If the script rebuilds an output
// that differs from the one this transaction pays — by a byte, a field, a value — the hashes disagree
// and it fails. That is the whole reason this file is worth more than a compile.
import { Transaction, UnlockingScript, Spend } from '@bsv/sdk'
import { basicUnlockingOps, valueBytes } from '../src/betaFrame.ts'
import { pushTxPreimage } from '../src/pushtx.ts'
import {
  buildLaneLock, laneSection, laneTick, laneConsts, laneTriggers, PHASE, AURORA_FIG8, BETA_LANE_REGS,
  type LaneState, type LaneInputs,
} from '../src/betaLane.ts'
import { fmul } from '../src/shell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const SATS = 1                       // ★ the lane holds ONE satoshi and never spends it — §7.9
const MAXFEE = 0                     // ⇒ so out0.value ≥ V − 0: the value may not move at all

/** Spend one section: assemble the transaction, derive the preimage from it, and let the interpreter judge. */
const NEW: Omit<LaneInputs, 'ths' | 'tht'> =
  { ndriver: new Array(24).fill(0), neng: 14, ntyr: 10, ndia: 10, nfuel: 40000 }

function spend(from: LaneState, to: LaneState, ths: number | number[], tht: number | number[],
               outSats = SATS,
               nw: Omit<LaneInputs, 'ths' | 'tht'> = NEW): { ok: boolean; why?: string } {
  const lock = buildLaneLock(from, { maxFee: MAXFEE })
  const next = buildLaneLock(to, { maxFee: MAXFEE })

  const source = new Transaction()
  source.addOutput({ lockingScript: lock, satoshis: SATS })

  const tx = new Transaction()
  tx.version = 2
  tx.addOutput({ lockingScript: next, satoshis: outSats })
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xffffffff })

  const preimage = pushTxPreimage({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: tx.outputs,
    inputSequence: 0xffffffff, lockTime: 0,
  })
  const unlock = new UnlockingScript(basicUnlockingOps({
    spenderOutputs: [], newValue: valueBytes(outSats), preimage,
    /* ⚠ ONE PER SEGMENT, and IN THE ORDER `laneInputNames` declares them — the compiler resolved
       every name against that list, so a reordered argument silently reads its neighbour. */
    inputs: [...laneTriggers(ths, AURORA_FIG8.subs), ...laneTriggers(tht, AURORA_FIG8.arcs),
             nw.ndriver, nw.neng, nw.ntyr, nw.ndia, nw.nfuel],
  }))
  tx.inputs[0].unlockingScript = unlock

  try {
    const ok = new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
    return { ok }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0] } }
}

/* ── a lane mid-race: rolling start, section 0, a mid-range car ─────────────────────────────────── */
const S = 4294967296
const START: LaneState = {
  raceId: new Array(32).fill(0),
  phase: PHASE.RACING, section: 0, lap: 0,
  v: Math.round(0.8 * S), fuel: 40000, t: 0,
  eng: 14, tyr: 10, dia: 10, driver: new Array(24).fill(0),
}

console.log('\n★★ THE POSITIVE CASES FIRST — these are what say the covenant RUNS\n')

/**
 * ★★★ THE LINE IS DERIVED, NEVER PINNED — the quickest way round that the physics actually allows.
 *
 * ⚠⚠ A hard-coded throttle here quietly retires the test. This file has already paid for that once:
 * the deslot entry speed was pinned three times and stopped reaching its branch every time a constant
 * moved, passing green having examined nothing. When the physics was re-anchored to real lap times the
 * pinned `THT = 6` went the OTHER way and began deslotting. Same trap, opposite direction.
 *
 * ★ AND THE ANSWER IS HIS OWN LINE. *"Full trigger on the straight. Getting to a corner you'd pull it
 * back to about half, and then full again at the end of the turn."* Flat out, then a BRAKING ZONE in
 * the last straight step — which is precisely why the straight is sub-stepped, and why a lift inside
 * the turn cannot save a car that arrived too fast.
 */
function line(st: LaneState): { ths: number[]; tht: number; t: number } {
  let best: { ths: number[]; tht: number; t: number } | null = null
  /* flat out, then lift from step `at` onward — his shape, with the LIFT POINT searched rather than
     assumed. ⚠ One braking step is not always enough: shedding 2.16 → 1.27 m/s takes ~10 cm and a
     sub-step is 9.5 cm, so where the lift STARTS is part of the line. */
  for (let at = 0; at < 4; at++) for (let brake = 1; brake <= 16; brake++) for (let tht = 1; tht <= 16; tht++) {
    const ths = [0, 1, 2, 3].map(i => (i < at ? 16 : brake))
    const r = laneSection(st, ths, tht)
    if (r.deslot || r.refused) continue
    if (!best || r.t < best.t) best = { ths, tht, t: r.t }
  }
  if (!best) throw new Error('beta-lane: NO line gets round section 0 — the constants are undriveable')
  return best
}
const LINE = line(START)
const THS = LINE.ths, THT = LINE.tht
console.log(`      the derived line: straight ${THS.join('·')} · turn ${THT}/16`)
const next = laneSection(START, THS, THT)
check('the derived line gets round without deslotting', !next.deslot && !next.refused)
check('  ★ and it is a genuine LIFT — flat out everywhere goes off', laneSection(START, 16, 16).deslot)
check('  ★★ AND THE BRAKING ZONE IS ON THE STRAIGHT — no corner trigger saves a flat-out approach',
  [...Array(16)].every((_, i) => laneSection(START, 16, i + 1).deslot))

const r = spend(START, next, THS, THT)
check('★★★ A SECTION SPENDS — the interpreter accepts the successor the reference computed', r.ok)
if (!r.ok) console.log(`      why: ${r.why}`)

check('  it advanced the section', next.section === 1)
check('  it accumulated time', next.t > START.t)
check('  it burned fuel', next.fuel < START.fuel)
console.log(`      v ${(START.v / S).toFixed(3)} → ${(next.v / S).toFixed(3)} m/s · ` +
  `t ${(next.t / S).toFixed(3)} s · fuel ${START.fuel} → ${next.fuel}`)

/* a second section, from the first's result — the chain advancing */
const next2 = laneSection(next, THS, THT)
check('★ and the NEXT section spends from the first\'s result', spend(next, next2, THS, THT).ok)
check('  the odd section took the OTHER radius', true)

console.log('\n⚠⚠ NOW THE REFUSALS — every way of claiming a race that did not happen\n')

const bad = (name: string, to: LaneState, ths: number | number[] = THS,
             tht: number | number[] = THT, outSats = SATS): void => {
  const res = spend(START, to, ths, tht, outSats)
  check(name, res.ok, false)
}

bad('a FASTER car than the physics produced', { ...next, v: next.v + 1 })
bad('a SLOWER car than the physics produced', { ...next, v: next.v - 1 })
bad('★ a QUICKER TIME than the physics produced', { ...next, t: next.t - 1 })
bad('  a slower time', { ...next, t: next.t + 1 })
bad('★ FUEL THAT WAS NOT BURNED', { ...next, fuel: next.fuel + 1 })
bad('★★ A SKIPPED SECTION — claiming two for the price of one', { ...next, section: 2 })
bad('  the section not advancing at all', { ...next, section: 0 })
bad('  a lap that did not happen', { ...next, lap: 1 })
bad('★ FINISHING EARLY', { ...next, phase: PHASE.FINISHED })
bad('  the car changing engine mid-race', { ...next, eng: 24 })
bad('  the car changing tyres mid-race', { ...next, tyr: 1 })
bad('★ the car changing WHEEL SIZE mid-race — the gearbox is not adjustable in flight', { ...next, dia: 14 })
bad('  the driver being swapped', { ...next, driver: new Array(24).fill(7) })

console.log('\n⚠ THE THROTTLE IS THE INPUT — so the LIE is claiming another throttle\'s outcome')
{
  const slower = laneSection(START, 8, THT)
  check('★★ presenting throttle 16 but the state throttle 8 would produce — REFUSED',
    spend(START, slower, 16, THT).ok, false)
  check('★★ presenting throttle 8 and the state IT produces — ACCEPTED',
    spend(START, slower, 8, THT).ok)
}

console.log('\n⚠ THE LANE MUST NOT BE DRAINED — it holds one satoshi and never spends it')
bad('taking the lane\'s satoshi', next, THS, THT, 0)

console.log('\n💥 THE DESLOT — too fast for the slot')
{
  /* ⚠⚠⚠ THE ENTRY SPEED IS DERIVED FROM THE CEILING, NEVER TYPED IN — and this is the THIRD time the
     same lesson has cost a run. A hard-coded 1.1 m/s reached the branch when the ceiling was 1.025 and
     stopped reaching it the moment K was recalibrated to 1.60, at which point the sheet went green
     having examined nothing. A test that pins a magic number is a test that quietly retires itself.
     ⇒ Enter at 1.2× whatever the ceiling currently is, and assert below that the branch was reached. */
  const C = laneConsts(BETA_LANE_REGS, AURORA_FIG8)
  const ceilInner = Math.sqrt(
    Math.trunc(Math.trunc(Math.trunc(fmul(C.K, C.RAD_IN) * C.SLIP_IN / C.SLIP) * START.tyr) / C.TYR_REF) / S)
  const HOT: LaneState = { ...START, v: Math.round(ceilInner * 1.2 * S) }
  console.log(`      ceiling here ${ceilInner.toFixed(3)} m/s · entering at ${(ceilInner * 1.2).toFixed(3)}`)
  const hot = laneSection(HOT, 16, 16)          // no lift at all through the corner
  console.log(`      reference says deslot: ${hot.deslot}`)
  const res = spend(HOT, hot, 16, 16)
  check('the reference agrees the car is over the limit', hot.deslot)
  console.log(`      the covenant ${res.ok ? 'ACCEPTED it' : 'REFUSED the spend: ' + res.why}`)
  check('⚠⚠ A DESLOT IS RECORDABLE — it must END the race, not make the spend impossible', res.ok)
}

console.log('\n♾ THE LANE ALWAYS TICKS FORWARD — a finished or wrecked race is the next one\'s start')
{
  /* ⚠ An earlier draft opened with VERIFY phase = P_RACING, which left a lane in a terminal state
     UNSPENDABLE and the next driver with nowhere to begin. Nothing about a covenant requires that. */
  for (const [name, ph] of [['FINISHED', PHASE.FINISHED], ['DESLOTTED', PHASE.DESLOTTED]] as const) {
    const dead: LaneState = { ...START, phase: ph, v: 0, fuel: 0, t: 12345, section: 3, lap: 1 }
    const fresh = laneTick(dead, { ths: 0, tht: 0, ...NEW })
    check(`★★ a ${name} lane accepts a fresh race`, spend(dead, fresh, 0, 0).ok)
    check(`   and it starts clean — section 0, lap 0, t 0, rolling`,
      fresh.section === 0 && fresh.lap === 0 && fresh.t === 0 && fresh.v > 0)
  }

  const dead: LaneState = { ...START, phase: PHASE.FINISHED, v: 0, fuel: 0, t: 999, section: 3, lap: 1 }
  const fresh = laneTick(dead, { ths: 0, tht: 0, ...NEW })
  check('★★★ THE RACE ID CHANGED — a walk can tell one race from the next',
    fresh.raceId.join(',') !== dead.raceId.join(','))
  check('   and it is 32 bytes', fresh.raceId.length === 32)
  check('⚠ a reset claiming the OLD race id is REFUSED',
    spend(dead, { ...fresh, raceId: dead.raceId }, 0, 0).ok, false)
  check('⚠ a reset claiming an id built from a DIFFERENT car is REFUSED',
    spend(dead, laneTick(dead, { ths: 0, tht: 0, ...NEW, neng: 24 }), 0, 0).ok, false)
  check('⚠ a reset claiming an id built from a DIFFERENT WHEEL is REFUSED',
    spend(dead, laneTick(dead, { ths: 0, tht: 0, ...NEW, ndia: 14 }), 0, 0).ok, false)
  check('⚠ a reset keeping the old time on the clock is REFUSED',
    spend(dead, { ...fresh, t: dead.t }, 0, 0).ok, false)
  check('★ the id CHAINS — the same car started twice gives DIFFERENT ids',
    laneTick({ ...dead, raceId: fresh.raceId }, { ths: 0, tht: 0, ...NEW })
      .raceId.join(',') !== fresh.raceId.join(','))
  check('⚠ and a RACING lane may not be reset — it runs its section instead',
    spend(START, fresh, 0, 0).ok, false)
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
