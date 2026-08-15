// © BSV Association — Open BSV License v6.
// THE SEAM — the depot and the public car, in one chain of transactions.
//
//   node --experimental-strip-types mint/test/depot-car-integration.ts
//
// Every other suite tests ONE covenant with a stand-in for the other: the depot has only ever met a
// 26-byte fake car, and the public car has never met a depot. This is the first time the real
// `FRESH_PUBLIC_CAR` hash is wired in and the two are asked to agree — which is where the bugs will be,
// because a seam is the one place neither side's tests were looking.
//
//   depot ──mints──▶ public car ──taps──▶ fuelled ──races, keyless──▶ home
//
// ⚠ NOT YET THE FINISHED STORY. Without the reset (parked), a raced car cannot go back to EMPTY, so
// every race here mints a NEW car rather than reusing one. That is the only part of the loop this file
// cannot close.
import { Transaction, Spend, UnlockingScript, LockingScript, TransactionSignature, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import {
  loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps,
  SHELL_SCOPE, SHELL_MAX_FEE, RACER_REGS as R, S, PHASE, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE,
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

console.log('THE SEAM — a real depot minting a real car\n')
console.log(`        car   ${CAR_SCRIPT.toBinary().length} bytes · hash ${Utils.toHex(Hash.sha256(CAR_SCRIPT.toBinary())).slice(0, 16)}…`)
console.log(`        depot ${DEPOT.toBinary().length} bytes\n`)

/** The depot mints a car: one tap of the pump, out of a tank holding `tank`. */
function mint(tank: number, carValue = DEPOT_DRAW): { ok: boolean; tx: Transaction } {
  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: DEPOT, satoshis: tank - carValue - DEPOT_MAX_FEE })
  tx.addOutput({ lockingScript: CAR_SCRIPT, satoshis: carValue })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(tank - carValue - DEPOT_MAX_FEE), preimage: pre,
  })
  try {
    const ok = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, lockingScript: DEPOT,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
    return { ok, tx }
  } catch { return { ok: false, tx } }
}

// ── ★★ THE SEAM ITSELF ────────────────────────────────────────────────────────────────────────────
{
  const r = mint(500_000)
  check('★★ the depot mints a REAL public car — the two covenants agree', r.ok)
  console.log(`        ${r.tx.toHex().length / 2} bytes · car funded with ${DEPOT_DRAW.toLocaleString()} sat`)

  // and the hash really is doing the work: a car of the OWNED variant is a different script
  const owned = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE })
  check('★ …and an OWNED shell is not a public car — the depot refuses it', (() => {
    const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: 500_000 })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: DEPOT, satoshis: 500_000 - DRAIN })
    tx.addOutput({ lockingScript: owned, satoshis: DEPOT_DRAW })
    tx.lockTime = 0
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 500_000, transactionVersion: 2,
      otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
      subscript: DEPOT, lockTime: tx.lockTime, scope: DEPOT_SCOPE,
    })
    tx.inputs[0].unlockingScript = buildDepotUnlock({
      spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
      newValue: u64(500_000 - DRAIN), preimage: pre,
    })
    try {
      return new Spend({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 500_000, lockingScript: DEPOT,
        transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
        unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  })(), false)
}

// ── ★ AND THE MINTED CAR RACES, WITH NO KEY ANYWHERE ──────────────────────────────────────────────
// The whole point: a visitor drives it, and nothing anywhere is signed.
{
  const minted = mint(500_000, 12_000)
  let st: ShellState = FRESH
  let prev = { tx: minted.tx, vout: 1, value: 12_000 }
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

  /* ⚠ A CAR STILL NEEDS A FINISH LINE. Crossing means SPENDING the pot outpoint, so a pool of zero
     bytes is a line nothing can cross — the car runs to within a tick of it and stops. Supplied here
     as an ordinary 1-sat coin; who supplies it for a KEYLESS visitor is the open question this test
     exists to raise. */
  const POT = new Transaction()
  POT.addOutput({ lockingScript: new P2PKH().lock(GAME.toAddress()), satoshis: 1 })
  const POOL = [...Utils.toArray(POT.id('hex'), 'hex').slice().reverse(), 0, 0, 0, 0]

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
    if (!(await move(want.state, fuel - want.burn, at, 8, ending ? POT : undefined))) break
    fuel -= want.burn
  }
  check('★★ …and races it to the line, with no key anywhere in the chain', st.phase === PHASE.DONE)
  if (refused) console.log('   ↳', refused)
  console.log(`        ${moves} moves · ${(st.s / S).toFixed(0)} m · ${fuel.toLocaleString()} sat left of 12,000`)
}

// ── ⚠ THE QUESTION THE SEAM RAISES: CAN A CAR BE TAPPED TWICE? ────────────────────────────────────
// A second tap must spend the car as well as the depot, to raise its value. But every spend of a car
// ADVANCES ITS PHASE — the machine is min(phase + 1, RACING) — so a car cannot sit at EMPTY and be
// filled repeatedly. Whether "tap five times to fuel" is even expressible is worth knowing NOW rather
// than after a page is built around it.
{
  const minted = mint(500_000, DEPOT_DRAW)
  const stayPut = FRESH                       // ask the car to remain exactly where it is
  const lock = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: minted.tx, sourceOutputIndex: 1, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: lock, satoshis: DEPOT_DRAW * 2 })     // twice the fuel, same state
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: minted.tx.id('hex'), sourceOutputIndex: 1, sourceSatoshis: DEPOT_DRAW,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [], newValue: u64(DEPOT_DRAW * 2), preimage: pre, sig: [], pubKey: [], throttle: 0,
    load: { driver: stayPut.driver, pool: stayPut.pool, eng: stayPut.eng, tyr: stayPut.tyr,
            finish: stayPut.finish, slip: stayPut.slip, green: stayPut.green, gap: stayPut.gap },
  }))
  let ok = false
  try {
    ok = new Spend({
      sourceTXID: minted.tx.id('hex'), sourceOutputIndex: 1, sourceSatoshis: DEPOT_DRAW,
      lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { /* expected */ }
  check('⚠ a car CANNOT be topped up while staying at EMPTY — every spend advances the phase', ok, false)
  console.log('        ⇒ pre-race taps are bounded by the phases available: CAR, TRACK, ARMED.')
  console.log('        ⇒ beyond that, fuel can only be added DURING the race — the splash and dash.')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SEAM: FAIL — the two covenants do not agree'); process.exit(1) }
console.log('SEAM OK — a real depot mints a real car, and a stranger races it home.')
