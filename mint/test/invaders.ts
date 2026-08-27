// © 2026 sun-dive — Apache License 2.0.
// ★★★ SPACE INVADERS — and whether the 1978 accident really comes back
//
//   node --experimental-strip-types mint/test/invaders.ts
//
// The arcade original speeds up as you kill aliens. Nobody designed that: the 8080 moved ONE alien per
// frame, so a sweep took as many frames as there were aliens left. The claim this file exists to test
// is that the SAME ramp reappears here for a structurally identical reason — one alien per TRANSACTION.
//
// ⚠⚠ IT IS A CLAIM, SO IT IS MEASURED. Nothing below asserts the ramp from the design; it counts real
// spends at three fleet sizes and reports what came back. A prediction that is only ever restated is
// not evidence — and this one very nearly fails, because the per-transaction SCRIPT cost is FLAT.
import { Transaction, Spend, UnlockingScript } from '@bsv/sdk'
import { buildBasicLock, basicUnlockingOps, frameMaxFee, valueBytes } from '../src/basicCovenant.ts'
import {
  INV_SRC, INV_INPUTS, INV_SLOTS, invNew, invRef, invShow, invSweepCost, type InvState,
} from '../src/invaders.ts'
import { pushTxPreimage } from '../src/pushtx.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const SATS = 50000
const MAX_FEE = frameMaxFee({
  src: INV_SRC, state: invNew() as unknown as Record<string, number>, maxFee: 0,
  inputs: INV_INPUTS, spenderOutputs: [],
}).fee

/** One frame, for real: build the successor, assemble, derive the preimage, and let `Spend` judge. */
function frame(from: InvState, shot: number, to: InvState): boolean {
  const rec = (s: InvState): Record<string, number> => ({ ...s })
  const lock = buildBasicLock({ src: INV_SRC, state: rec(from), maxFee: MAX_FEE, inputs: INV_INPUTS })
  const next = buildBasicLock({ src: INV_SRC, state: rec(to), maxFee: MAX_FEE, inputs: INV_INPUTS })

  const source = new Transaction()
  source.addOutput({ lockingScript: lock, satoshis: SATS })
  const tx = new Transaction()
  tx.version = 2
  tx.addOutput({ lockingScript: next, satoshis: SATS })
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xffffffff })

  const preimage = pushTxPreimage({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS,
    transactionVersion: 2, inputIndex: 0, subscript: lock, outputs: tx.outputs,
    inputSequence: 0xffffffff, lockTime: 0,
  })
  const unlock = new UnlockingScript(basicUnlockingOps({
    inputs: [shot], spenderOutputs: [], newValue: valueBytes(SATS), preimage,
  }))
  try {
    return new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: SATS, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
  } catch { return false }
}

console.log('\nSPACE INVADERS — one alien per transaction, as one alien per frame\n')

const lock0 = buildBasicLock({
  src: INV_SRC, state: invNew() as unknown as Record<string, number>, maxFee: MAX_FEE, inputs: INV_INPUTS,
})
console.log(`        ${lock0.toBinary().length} B of Script · ${lock0.chunks.length} opcodes · ` +
  `${INV_SLOTS} aliens · MAX_FEE ${MAX_FEE} sat`)
console.log(invShow(invNew()).split('\n').map(l => '        ' + l).join('\n'))

// ── 1. ★★ IT PLAYS — real spends, chained ───────────────────────────────────────────────────────────
console.log()
{
  let st = invNew()
  let ok = 0, tried = 0
  for (const shot of [1, 2, 3, 0, 9, 0, 17, 0]) {
    const want = invRef(st, shot)
    tried++
    if (frame(st, shot, want)) ok++
    st = want
  }
  check(`★★★ ${tried} frames, each a real spend of the last one's output`, ok === tried)
  console.log(invShow(st).split('\n').map(l => '        ' + l).join('\n'))
  console.log(`        score ${st.score} · ${st.count} left · fleet at x ${st.x}, y ${st.y}`)
  check('★ five shots, five hits, fifty points', st.score === 50 && st.count === INV_SLOTS - 5)
}

// ── 2. ★★ AND IT REFUSES ────────────────────────────────────────────────────────────────────────────
console.log()
{
  let st = invNew()
  st = invRef(st, 1)                                   // slot 1 is now empty

  /* ⚠ Shooting a dead alien must not score. The successor claims a hit; the script knows the bit is
     already clear, and rebuilds a different state. */
  const twice = frame(st, 1, { ...invRef(st, 0), count: st.count - 1, score: st.score + 10 })
  check('★★ you cannot shoot the same alien twice', twice, false)

  const freeScore = frame(st, 0, { ...invRef(st, 0), score: st.score + 100 })
  check('★★ …nor award yourself points for nothing', freeScore, false)

  const noAdvance = frame(st, 0, { ...st })
  check('★★ …nor hold the fleet still — a frame always advances', noAdvance, false)

  check('★ …while an honest frame from the same board is accepted', frame(st, 2, invRef(st, 2)))

  /* ⚠ AND IT ENDS. A fleet that reaches the floor is over, and an over game cannot be spent again. */
  let landed = invNew()
  let guard = 0
  while (landed.over === 0 && guard++ < 4000) landed = invRef(landed, 0)
  check('★★ left alone, the fleet lands and the game stops', landed.over === 1)
  console.log(`        it took ${guard} frames for a full fleet to come down ${landed.y} rows`)
  const afterEnd = frame(landed, 0, { ...landed, cur: landed.cur + 1 })
  check('★★★ …and a finished game cannot be spent at all', afterEnd, false)
}

// ── 3. ★★★ THE 1978 RAMP — MEASURED, NOT ASSERTED ───────────────────────────────────────────────────
// The claim: a sweep of the fleet costs as many transactions as there are aliens alive, so the game
// speeds up and gets cheaper as it thins — the same shape the 8080 produced by accident.
console.log()
{
  /** Play until the fleet takes one sideways step, COUNTING the spends it really took. */
  const sweep = (from: InvState): { spends: number; ok: boolean } => {
    let st = from, spends = 0, ok = true
    const x0 = st.x, y0 = st.y
    let guard = 0
    while ((st.x === x0 && st.y === y0) && guard++ < 200) {
      const want = invRef(st, 0)
      if (!frame(st, 0, want)) ok = false
      st = want
      spends++
    }
    return { spends, ok }
  }

  /** Thin the fleet to `leave` aliens, off chain — the shooting is not what is being measured. */
  const thinTo = (leave: number): InvState => {
    let st = invNew()
    for (let slot = 1; st.count > leave; slot++) st = invRef(st, slot)
    return { ...st, cur: 0 }
  }

  const rows: Array<[number, number, number]> = []
  let allOk = true
  /* ⚠ 54 AND 27, NOT 55 AND 12. The halving check below has to compare a fleet with exactly half of
     another, and the first version of this kept the sizes from a smaller grid — so it asserted that
     55 spends is twice 12. The claim was right and the arithmetic was not. */
  for (const leave of [INV_SLOTS, 54, 27, 11, 2]) {
    const st = thinTo(leave)
    const r = sweep(st)
    if (!r.ok) allOk = false
    rows.push([leave, r.spends, invSweepCost(leave)])
  }
  check('★★ every frame in every sweep was a valid spend', allOk)

  console.log('        aliens alive   spends per sweep   predicted')
  for (const [alive, spends, want] of rows) {
    console.log(`        ${String(alive).padStart(12)}   ${String(spends).padStart(16)}   ${String(want).padStart(9)}`)
  }
  check('★★★ a sweep costs exactly one transaction per living alien',
    rows.every(([, spends, want]) => spends === want))

  const [full, half] = [rows[1], rows[2]]                       // 54 and 27 — an exact halving
  check('★★★ …so halving the fleet halves the cost of a sweep — the 1978 ramp, from the fee model',
    full[1] === 2 * half[1])
  console.log(`        ${full[0]} aliens: ${full[1]} spends · ${half[0]} aliens: ${half[1]} spends` +
    `  ⇒ exactly ${(full[1] / half[1]).toFixed(1)}× faster at half strength`)
  console.log(`        at ${MAX_FEE} sat a frame: a full sweep ${rows[0][1] * MAX_FEE} sat, ` +
    `a nearly-clear one ${rows[rows.length - 1][1] * MAX_FEE} sat`)

  /* ⚠⚠ AND HERE IS WHY IT IS NOT AUTOMATIC, WHICH IS THE HALF THAT MATTERS. The SCRIPT does the same
     work whether one alien is alive or twenty-four — the twenty-four comparisons that stand in for an
     array are emitted every time, so the lock is the same size in every frame. Nothing about the
     arithmetic gets cheaper. What falls is the NUMBER OF TRANSACTIONS, and only because one spend was
     made to mean one alien. Put a whole sweep in a single spend and the ramp disappears entirely. */
  const bytesAt = (leave: number): number => {
    const st = thinTo(leave)
    return buildBasicLock({
      src: INV_SRC, state: st as unknown as Record<string, number>, maxFee: MAX_FEE, inputs: INV_INPUTS,
    }).toBinary().length
  }
  const full24 = bytesAt(INV_SLOTS), thin2 = bytesAt(2)
  check('★★★ the per-frame SCRIPT cost is FLAT — the ramp is in the transaction count, not the code',
    full24 === thin2)
  console.log(`        a frame's lock: ${full24} B at ${INV_SLOTS} aliens, ${thin2} B at 2 — identical`)
  console.log('        ⇒ the economics reproduce the accident ONLY because one spend means one alien')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('INVADERS: FAIL'); process.exit(1) }
console.log('INVADERS OK — the 1978 difficulty ramp, arriving a second time through the fee model.')
