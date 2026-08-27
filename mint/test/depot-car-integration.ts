// © 2026 sun-dive — Apache License 2.0.
// THE SEAM — the depot and the public car, in one chain of transactions.
//
//   node --experimental-strip-types mint/test/depot-car-integration.ts
//
// Every other suite tests ONE covenant with a stand-in for the other. This is where the two are asked
// to agree — which is where the bugs are, because a seam is the one place neither side's tests were
// looking.
//
//   owner pays ──▶ public car ──depot fuels it──▶ races, keyless ──▶ home
//
// ── ⚠⚠ AND THE ARROW USED TO POINT THE WRONG WAY ──────────────────────────────────────────────────
// This file used to open "the depot mints a REAL public car" and pass, 7/7. The depot was never a car
// factory: **the depot and the car are two different covenants**, and the depot's job is FUEL. Minting
// got built into it because a REFUEL did not work — both covenants rebuilt themselves at output 0 — and
// the response was to redescribe the machine instead of fixing it.
//
// ⇒ So a car is born the way any output is: SOMEBODY PAYS FOR IT. No covenant runs, nothing is
// authorised. The depot arrives afterwards, and that transaction — two covenants, two inputs — is the
// seam this file now tests.
import { Transaction, Spend, UnlockingScript, LockingScript, TransactionSignature, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import {
  loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps,
  SHELL_SCOPE, SHELL_MAX_FEE, RACER_REGS as R, S, PHASE, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK,
} from '../src/depot.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const GAME = PrivateKey.fromRandom()
const OWNER = Hash.hash160(GAME.toPublicKey().encode(true) as number[])

// ★ THE REAL THING, at last: the depot is told what an actual public car at rest looks like.
const FRESH = freshPublicShell(OWNER)
const CAR_SCRIPT = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
const DEPOT = buildDepotLock({ carScript: CAR_SCRIPT.toBinary(), owner: OWNER })
const DRAIN = DEPOT_DRAW + DEPOT_MAX_FEE

console.log('THE SEAM — a car is paid for, and a depot fuels it\n')
console.log(`        car   ${CAR_SCRIPT.toBinary().length} bytes · hash ${Utils.toHex(Hash.sha256(CAR_SCRIPT.toBinary())).slice(0, 16)}…`)
console.log(`        depot ${DEPOT.toBinary().length} bytes\n`)

/**
 * A car is BORN by ordinary payment. No covenant, no seam, nothing authorised — which is exactly the
 * point: making a car was never the depot's job.
 */
function bornCar(value: number): Transaction {
  const tx = new Transaction(); tx.version = 2
  tx.addOutput({ lockingScript: CAR_SCRIPT, satoshis: value })
  return tx
}

/**
 * ★★ THE TAP — the depot and an existing car, spent together. Car at out0 (its covenant will rebuild
 * itself nowhere else), depot at out1, named as the depot's prefix.
 */
function tap(o: { carTx: Transaction; carVout: number; carHas: number; tank: number
                   draw?: number; carScript?: LockingScript }):
  { carOk: boolean; depotOk: boolean; tx: Transaction; carOut: number } {
  const draw = o.draw ?? DEPOT_DRAW
  const carScript = o.carScript ?? CAR_SCRIPT
  const kept = o.tank - draw - DEPOT_MAX_FEE
  const carOut = o.carHas + draw
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: o.tank })

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.carTx, sourceOutputIndex: o.carVout, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: carScript, satoshis: carOut })
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  tx.lockTime = 0
  const ser = (i: number): number[] =>
    serializeOutput(tx.outputs[i].satoshis ?? 0, tx.outputs[i].lockingScript.toBinary())

  const cPre = TransactionSignature.format({
    sourceTXID: o.carTx.id('hex'), sourceOutputIndex: o.carVout, sourceSatoshis: o.carHas,
    transactionVersion: 2, otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: carScript, lockTime: 0, scope: SHELL_SCOPE,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: ser(1), newValue: u64(carOut), preimage: cPre,
    sig: [], pubKey: [], throttle: 0, retire: true,
    load: { driver: FRESH.driver, pool: FRESH.pool, eng: FRESH.eng, tyr: FRESH.tyr,
            finish: FRESH.finish, slip: FRESH.slip, green: FRESH.green, gap: FRESH.gap },
  }))
  const dPre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, transactionVersion: 2,
    otherInputs: [tx.inputs[0]], inputIndex: 1, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
  })
  tx.inputs[1].unlockingScript = buildDepotUnlock({
    prefixOutputs: ser(0), spenderOutputs: [], newValue: u64(kept), preimage: dPre,
  })
  const val = (i: number, txid: string, vout: number, sats: number, lock: LockingScript): boolean => {
    try {
      return new Spend({ sourceTXID: txid, sourceOutputIndex: vout, sourceSatoshis: sats,
        lockingScript: lock, transactionVersion: 2,
        otherInputs: tx.inputs.filter((_, k) => k !== i), outputs: tx.outputs, inputIndex: i,
        unlockingScript: tx.inputs[i].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0,
      }).validate() === true
    } catch { return false }
  }
  return {
    tx, carOut,
    carOk: val(0, o.carTx.id('hex'), o.carVout, o.carHas, carScript),
    depotOk: val(1, dSrc.id('hex'), 0, o.tank, DEPOT),
  }
}

// ── ★★ THE SEAM ITSELF ────────────────────────────────────────────────────────────────────────────
{
  const car = bornCar(1_000)
  const r = tap({ carTx: car, carVout: 0, carHas: 1_000, tank: 500_000 })
  check('★★ the depot FUELS a real public car — the two covenants agree', r.depotOk && r.carOk)
  console.log(`        ${r.tx.toHex().length / 2} bytes · 2 in, 2 out · car 1,000 → ${r.carOut.toLocaleString()} sat`)

  // and the shape really is doing the work: the OWNED variant is a different script
  const owned = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE })
  const ownedTx = new Transaction(); ownedTx.version = 2
  ownedTx.addOutput({ lockingScript: owned, satoshis: 1_000 })
  check('★ …and an OWNED shell is not a public car — the depot refuses it',
    tap({ carTx: ownedTx, carVout: 0, carHas: 1_000, tank: 500_000, carScript: owned }).depotOk, false)
}

// ── ★ AND THE FUELLED CAR RACES, WITH NO KEY ANYWHERE ─────────────────────────────────────────────
// The whole point: a visitor drives it, and nothing anywhere is signed.
{
  const tapped = tap({ carTx: bornCar(2_000), carVout: 0, carHas: 2_000, tank: 500_000, draw: 10_000 })
  let st: ShellState = FRESH
  let prev = { tx: tapped.tx, vout: 0, value: 12_000 }        // the car is out0 now
  let fuel = 12_000, moves = 0, refused = ''

  const move = async (next: ShellState, out: number, at: number, throttle = 0, pot?: Transaction): Promise<boolean> => {
    const lock = buildShellLock({ state: st, maxFee: SHELL_MAX_FEE, public: true })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.vout, sequence: 0xfffffffe })
    if (pot) tx.addInput({ sourceTransaction: pot, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: SHELL_MAX_FEE, public: true }), satoshis: out })
    tx.lockTime = at
    const pre = TransactionSignature.format({
      sourceTXID: prev.tx.id('hex'), sourceOutputIndex: prev.vout, sourceSatoshis: prev.value,
      transactionVersion: 2, otherInputs: tx.inputs.slice(1), inputIndex: 0, outputs: tx.outputs,
      inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
    })
    if (pot) tx.inputs[1].unlockingScript = await new P2PKH().unlock(GAME).sign(tx, 1)
    tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
      spenderOutputs: [], newValue: u64(out), preimage: pre,
      sig: [], pubKey: [], throttle,          // ★ NO SIGNATURE. Anyone may drive.
      load: { driver: next.driver, pool: next.pool, eng: next.eng, tyr: next.tyr,
              finish: next.finish, slip: next.slip, green: next.green, gap: next.gap },
    }))
    try {
      const ok = new Spend({
        sourceTXID: prev.tx.id('hex'), sourceOutputIndex: prev.vout, sourceSatoshis: prev.value,
        lockingScript: lock, transactionVersion: 2, otherInputs: tx.inputs.slice(1), outputs: tx.outputs,
        inputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe,
        lockTime: tx.lockTime,
      }).validate() === true
      if (ok) { st = next; prev = { tx, vout: 0, value: out }; moves++ }
      return ok
    } catch (e) { refused = (e as Error).message.split('\n')[0]; return false }
  }

  /* ★ NO FINISH-LINE TOKEN. A public car is racing nobody, so there is no payment to guard and no
     outpoint to spend — which is what lets a visitor with no coins finish at all. This test is why:
     it watched a car run to 59 metres of 60 and stop one tick short, holding fuel it could not use. */
  const POOL = new Array(36).fill(0)

  const GREEN = 1_700_000_000
  const built = loadCar(FRESH, { driver: OWNER, eng: 10, tyr: 10 }, R)
  const tracked = loadTrack(built, { finish: Math.round(60 * S), slip: 1000, green: GREEN, gap: 1, pool: POOL })

  check('★ a stranger configures it — no signature', await move(built, fuel, 0))
  check('  …loads the track', await move(tracked, fuel, 0))
  check('  …and arms it', await move(arm(tracked), fuel, 0))

  while (st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && moves < 60 && fuel > R.BURN0 + 1) {
    const at = Math.max(st.green, st.last + st.gap)
    const want = refTick(st, { throttle: 8, lockTime: at, fuel }, R)
    const ending = want.state.phase === PHASE.DONE || want.state.phase === PHASE.OUT
    if (!ending && fuel - want.burn < R.BURN0 + 1) break
    if (!(await move(want.state, fuel - want.burn, at, 8))) break
    fuel -= want.burn
  }
  check('★★ …and races it home with NO KEY AND NO COIN anywhere in the chain', st.phase === PHASE.DONE)
  if (refused) console.log('   ↳', refused)
  console.log(`        ${moves} moves · ${(st.s / S).toFixed(0)} m · ${fuel.toLocaleString()} sat left of 12,000`)
}

// ── ★ CAN A CAR BE TAPPED TWICE? YES — BECAUSE THE TAP IS A RESET ─────────────────────────────────
// Every spend of a car advances its phase (min(phase + 1, RACING)), so a car cannot sit still and be
// filled repeatedly. It does not have to: the tap RESETS it, which lands it back on a fresh car with
// the fuel kept. So the old "pre-race fuelling is capped at three taps" limit was deleted by the reset
// rather than argued with, and a car can be filled to the ceiling one tap at a time.
/* ⚠ DERIVED FROM DRAW, NEVER HARD-CODED. This asserted `taps === 4`, which was true only while DRAW
   was 10,000 — raise DRAW and a correct fill starts failing a test that is not about DRAW at all. Same
   trap as depot-arrival's `thief(500)`. Ask the question the section is actually about: does the car
   keep accepting taps until it is full? */
{
  const START = 1_000, TARGET = 41_000
  const expected = Math.floor((TARGET - START) / DEPOT_DRAW)
  let carTx = bornCar(START)
  let vout = 0, held = START, taps = 0, allOk = true
  while (held + DEPOT_DRAW <= TARGET) {
    const r = tap({ carTx, carVout: vout, carHas: held, tank: 500_000 })
    if (!r.depotOk || !r.carOk) { allOk = false; break }
    carTx = r.tx; vout = 0; held = r.carOut; taps++
  }
  check('★★ a car can be tapped again and again — the tap IS a reset',
    allOk && taps === expected && held === START + expected * DEPOT_DRAW)
  console.log(`        ${taps} taps of ${DEPOT_DRAW.toLocaleString()} (expected ${expected}) · ` +
    `car holds ${held.toLocaleString()} sat, still at rest`)

  /* ⚠ AND THE CEILING STILL BITES. The depot refuses to push a car past MAX_TANK however many taps
     it took to get there — otherwise "five taps and the pump stops" would be a courtesy, not a rule. */
  const over = tap({ carTx, carVout: 0, carHas: DEPOT_MAX_TANK, tank: 500_000 })
  check('★ …but never past MAX_TANK', over.depotOk, false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SEAM: FAIL — the two covenants do not agree'); process.exit(1) }
console.log('SEAM OK — a car is paid for, a depot fuels it, and a stranger races it home.')
