// © 2026 sun-dive — Apache License 2.0.
//
// ★★★ THE DEPOT THAT MINTS ONE-RACE CARS — and every way of robbing it that I could think of.
//
//   node --experimental-strip-types mint/test/racer-depot.ts
//
// ⚠⚠ THE ONE THAT MATTERS IS THE FAUCET. Take a full draw, hand the car ONE SATOSHI, send the
// difference to yourself. `depot.ts` records that its covenant ACCEPTED exactly that transaction
// before the guarding line existed — measured, not feared. So it is measured here, not reasoned about.
import { Transaction, TransactionSignature, Spend, LockingScript, UnlockingScript, PrivateKey, Hash, OP } from '@bsv/sdk'
import { buildRacerDepotLock, RACER_DRAW, RACER_DEPOT_MAX_FEE, RACER_MAX_CAR_BYTES } from '../src/racerDepot.ts'
import { buildDepotUnlock, DEPOT_SCOPE } from '../src/depot.ts'
import { carBlockOps, buildRacerCar, racerCarFee } from '../src/racerCar.ts'
import { type TickTrace, type RunTrace } from '../src/racerTick.ts'
/* ⚠ THE ONE-RACE CAR'S PHYSICS LIVES IN ITS OWN FILE. `shell.ts` is bundled into BOTH live
   bundles — grafmint.js (six pages) and, via grafbasic.ts, grafbasic.js (basic.html) — so the
   racers must not put anything in it. → src/racerPhysics.ts, and §6j. */
import { S, SLIP_UNIT, PHASE } from '../src/shell.ts'
import { ONE_RACE_REGS as R, racerRefTick as refTick, RACER_PHASE } from '../src/racerPhysics.ts'
import { serializeOutput } from '../src/covenant.ts'
import { P2PKH } from '@bsv/sdk'
import { pushData } from '../src/pushtx.ts'
import { op } from '../src/covenantAsm.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (x: number): number[] => {
  const b: number[] = []; let v = x
  for (let i = 0; i < 8; i++) { b.push(v % 256); v = Math.floor(v / 256) }
  return b
}

const OWNER_KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(OWNER_KEY.toPublicKey().encode(true) as number[])

const PHYS: Record<string, number> = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}

/* ⚠⚠ THE CIRCLE, AND IT IS RESOLVED THE ONLY WAY IT CAN BE. The car's block embeds the DEPOT's script,
   and the depot pins the car's BLOCK — so neither can be built from the other. It is not circular in
   fact, only in appearance: the depot exists FIRST, so a car is built against a depot that is already
   there. Here the depot is built against the block for a placeholder payee, then the real cars are
   built against the real depot. ⇒ On chain this is just "mint the depot, then mint cars". */
const SEED_DEPOT = buildRacerDepotLock({ carBlock: new Array(1436).fill(0), owner: OWNER }).toBinary()
const DEPOT = new LockingScript(buildRacerDepotLock({
  carBlock: new LockingScript(carBlockOps({ depotScript: SEED_DEPOT })).toBinary(), owner: OWNER,
}).chunks)
const depotScript = DEPOT.toBinary()
/* The cars this depot will actually mint pay to `SEED_DEPOT`; that is what its block pins. */
const CAR_BLOCK = new LockingScript(carBlockOps({ depotScript: SEED_DEPOT })).toBinary()

const ST0: Record<string, unknown> = {
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: 14, tyr: 10, finish: 0, slip: 1000, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
}
function simulateTo(finish: number): RunTrace {
  let st = { ...ST0, finish } as Record<string, number>
  let fuel = 40000
  const ticks: TickTrace[] = []
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle: 8, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle: r.throttle, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (st.phase === PHASE.DONE) break
  }
  return { ticks, ending: 'finish' }
}
function car(metres: number): { script: number[]; fee: number } {
  const finish = Math.round(metres * S)
  const run = simulateTo(finish)
  const cfg = { name: 'SUN-DIVE', fuel: 40000, eng: 14, tyr: 10, slip: 1000, finish }
  const fee = racerCarFee({ cfg, run, depotScript: SEED_DEPOT, consts: PHYS }).fee
  return { script: buildRacerCar({ cfg, run, depotScript: SEED_DEPOT, consts: PHYS }).toBinary(), fee }
}

const CAR = car(4)

console.log('THE MINTING DEPOT — and every way of robbing it I could think of\n')
console.log(`        depot ${depotScript.length} B · car block ${CAR_BLOCK.length} B`)
console.log(`        DRAW ${RACER_DRAW} · MAX_FEE ${RACER_DEPOT_MAX_FEE} · MAX_CAR ${RACER_MAX_CAR_BYTES.toLocaleString()}\n`)

/**
 * Build a mint and validate it: depot(tank) → car(paid) + depot(kept) [+ anything else].
 * ⚠ The CAR takes out0 — its own covenant insists on it — so the depot rides in the prefix.
 */
function mint(o: {
  tank: number; kept: number; paid: number
  carScript?: number[]
  extra?: Array<{ script: number[]; value: number }>
}): boolean {
  const carScript = o.carScript ?? CAR.script
  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: o.tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(carScript).chunks), satoshis: o.paid })
  tx.addOutput({ lockingScript: DEPOT, satoshis: o.kept })
  for (const e of o.extra ?? []) {
    tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(e.script).chunks), satoshis: e.value })
  }
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
  })
  const unlock = buildDepotUnlock({
    prefixOutputs: serializeOutput(o.paid, carScript),
    spenderOutputs: (o.extra ?? []).flatMap(e => serializeOutput(e.value, e.script)),
    newValue: u64(o.kept), preimage: pre,
  } as never)
  const spend = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank,
    lockingScript: DEPOT, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
    unlockingScript: unlock, inputSequence: 0xfffffffe, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}

const TANK = 100_000
const PAID = CAR.fee + 1

/* ── ★★★ IT MINTS ───────────────────────────────────────────────────────────────────────────────── */
check('★★★ the depot mints a car and keeps the rest',
  mint({ tank: TANK, paid: PAID, kept: TANK - PAID }))
check('★★ …paying the mint fee out of the tank, within MAX_FEE',
  mint({ tank: TANK, paid: PAID, kept: TANK - PAID - 900 }))

/* ── ⚠⚠ THE FAUCET — and the honest answer is that it is bounded, not closed ────────────────────
   The rule is `carValue >= (V - out_depot) - MAX_FEE`. It stops the big version of the attack: take a
   DRAW and hand the car a satoshi. It CANNOT stop the small version, and no covenant can —
   `depot.ts` says why in its own words: *"whether a satoshi left as fuel or as a miner's fee is not
   the depot's business."* A covenant cannot tell a payment from a fee.

   ⇒ **MAX_FEE IS ALWAYS EXTRACTABLE, ONCE PER SPEND, BY ANYONE.** That is true of the deployed depot
   too (844 there). What is new here is that MAX_FEE is LARGER THAN DRAW, because a 16 KB car makes a
   34 KB mint — so the fee allowance, not the draw, is the drain. ⇒ MAX_CAR_BYTES sets the theft per
   spend, and that is the reason to keep it tight. */
{
  const thief = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const theirs = [0x76, 0xa9, 0x14, ...thief, 0x88, 0xac]

  check('★★★ THE BIG FAUCET is closed: a full draw taken, one satoshi to the car',
    mint({
      tank: TANK, paid: 1, kept: TANK - RACER_DRAW - RACER_DEPOT_MAX_FEE,
      extra: [{ script: theirs, value: RACER_DRAW + RACER_DEPOT_MAX_FEE - 1 }],
    }), false)

  check('★★★ …and so is taking a draw the car never receives',
    mint({
      tank: TANK, paid: 1, kept: TANK - RACER_DRAW - RACER_DEPOT_MAX_FEE + 1,
      extra: [{ script: theirs, value: RACER_DRAW + RACER_DEPOT_MAX_FEE - 2 }],
    }), false)

  /* ★★★ AND THE SMALL ONE IS CLOSED TOO, by forbidding a third output when value leaves. Without
     that line this passed — 3,500 sat per spend to anyone — and the deployed depot has the same hole
     at 844. ⇒ "The only spend operation is running down the track." */
  check('★★★ MAX_FEE IS NOT EXTRACTABLE — a third output is refused when value leaves',
    mint({
      tank: TANK, paid: 1, kept: TANK - RACER_DEPOT_MAX_FEE,
      extra: [{ script: theirs, value: RACER_DEPOT_MAX_FEE - 1 }],
    }), false)
  check('★★ …at ANY size, even one satoshi to a stranger',
    mint({ tank: TANK, paid: PAID, kept: TANK - PAID - 1, extra: [{ script: theirs, value: 1 }] }), false)
  console.log('        ⇒ a mint has exactly two outputs: the car and the depot. Anything unaccounted')
  console.log('          for goes to a MINER, and paying a miner is not extraction.')
}

/* ── ⚠ THE FLOOR ─────────────────────────────────────────────────────────────────────────────────── */
check('★★★ taking more than DRAW + MAX_FEE is refused',
  mint({ tank: TANK, paid: PAID, kept: TANK - RACER_DRAW - RACER_DEPOT_MAX_FEE - 1 }), false)
/* ★★★ AND THE REAL LIMIT IS NOW THE COMPUTED FEE, NOT THE CEILING. `MAX_FEE` survives only as a coarse
   floor; what actually binds is `left ≤ carValue + fee` with the fee worked out from the sizes. So the
   most a mint may cost the tank is the car's funding plus what the transaction genuinely costs. */
{
  const MINT_FEE = Math.ceil((2 * CAR.script.length + 2 * depotScript.length + 264) / 10)
  console.log(`        computed mint fee ${MINT_FEE} sat against a ${RACER_DEPOT_MAX_FEE} ceiling` +
    `  ⇒ ${RACER_DEPOT_MAX_FEE - MINT_FEE} sat no longer reachable`)
  check('★★★ taking the car\'s funding plus the TRUE cost is allowed',
    mint({ tank: TANK, paid: RACER_DRAW, kept: TANK - RACER_DRAW - MINT_FEE }))
  check('★★★ …and one satoshi more is REFUSED — it would have to go somewhere, and there is nowhere',
    mint({ tank: TANK, paid: RACER_DRAW, kept: TANK - RACER_DRAW - MINT_FEE - 1 }), false)
}
check('★★★ handing a car MORE than DRAW is refused',
  mint({ tank: TANK, paid: RACER_DRAW + 1, kept: TANK - RACER_DRAW - 1 }), false)

/* ── ⚠ AND IT MUST BE A CAR ──────────────────────────────────────────────────────────────────────── */
{
  const thief = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const theirs = [0x76, 0xa9, 0x14, ...thief, 0x88, 0xac]
  check('★★★ minting to a plain address instead of a car is refused',
    mint({ tank: TANK, paid: PAID, kept: TANK - PAID, carScript: theirs }), false)
  check('★★★ a car whose block pays somebody else is refused',
    mint({
      tank: TANK, paid: PAID, kept: TANK - PAID,
      carScript: [...CAR.script.slice(0, CAR.script.length - CAR_BLOCK.length),
                  ...new LockingScript(carBlockOps({ depotScript: theirs })).toBinary()],
    }), false)
  check('★★★ a car over MAX_CAR_BYTES is refused',
    mint({
      tank: TANK, paid: PAID, kept: TANK - PAID,
      carScript: [...CAR.script, ...new Array(RACER_MAX_CAR_BYTES).fill(OP.OP_NOP)],
    }), false)
}

/* ── ★ A TOP-UP MINTS NOTHING, AND IS ASKED FOR NOTHING ─────────────────────────────────────────── */
check('★★ handing the depot MORE than it had needs no car at all',
  (() => {
    const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: 10_000 })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: DEPOT, satoshis: 60_000 })
    tx.lockTime = 0
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 10_000, transactionVersion: 2,
      otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
      subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
    })
    const unlock = buildDepotUnlock({
      prefixOutputs: [], spenderOutputs: [], newValue: u64(60_000), preimage: pre,
    } as never)
    const sp = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 10_000,
      lockingScript: DEPOT, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
      unlockingScript: unlock, inputSequence: 0xfffffffe, inputIndex: 0, lockTime: 0,
    })
    try { return sp.validate() } catch { return false }
  })())

/* ── ★★ THE ESCAPE HATCH — UNGATED, which is the whole point ─────────────────────────────────────
   `depot.ts` refuses to burn a tank holding more than DEPOT_BURN_BELOW (1,241 sat), which bought a
   promise to donors — and its own note admits "there are no donors yet… if donors never arrive it is
   paying for nothing". It also blocks the case that has already cost this project 15,000 satoshis:
   a key that existed in neither hand, because of a bug. **Things go wrong, and when they do there has
   to be a way out.** ⚠ The cost is stated rather than hidden: the owner CAN sweep this tank. */
async function burn(tank: number, signer: PrivateKey): Promise<boolean> {
  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: new P2PKH().lock(signer.toAddress()), satoshis: tank - 300 })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
  })
  /* ★ Let the SDK build the signature the way the deployed depot's own test does — hand-rolling the
     DER encoding is a way to fail a test for a reason that has nothing to do with the covenant. */
  const chunks = (await new P2PKH().unlock(signer).sign(tx, 0)).chunks
  const unlock = new UnlockingScript([
    pushData([]),                                   // prefixOutputs — a burn enforces no outputs
    op(OP.OP_1),                                    // burn
    chunks[0], chunks[1],                           // signature, public key
    pushData([]),                                   // spenderOutputs
    pushData(u64(tank - 300)),
    pushData(pre),
  ])
  const sp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank,
    lockingScript: DEPOT, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
    unlockingScript: unlock, inputSequence: 0xfffffffe, inputIndex: 0, lockTime: 0,
  })
  try { return sp.validate() } catch { return false }
}
check('★★★ the owner can sweep a FULL tank — this is the escape hatch, and it is ungated',
  await burn(150_000, OWNER_KEY))
console.log('        ⚠ depot.ts refuses this above 1,241 sat. That gate is exactly what strands money.')
check('★★★ …and nobody else can, at any balance', await burn(150_000, PrivateKey.fromRandom()), false)
check('★★ …and the owner can sweep a nearly-empty one too', await burn(1_000, OWNER_KEY))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'RACER DEPOT OK — what leaves the tank lands in a car, and the owner can always get out.'
  : 'RACER DEPOT FAILED')
process.exit(fail === 0 ? 0 : 1)
