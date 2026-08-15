// © BSV Association — Open BSV License v6.
// ★★ THE FUEL BUTTON — the depot filling a car that already exists.
//
//   node --experimental-strip-types mint/test/depot-refuel.ts
//
// Every other depot test either MINTS a fresh car or tops up the DEPOT. This is the one the page
// actually needs: two covenants, two inputs, two outputs, and each one validating its own half
// without being able to read the other.
//
//   IN    depot (V)                   +  car (low)
//   OUT   depot (V − DRAW − MAX_FEE)  +  car (low + DRAW)
//
// ★ WHAT IT HAS TO ESTABLISH:
//   1. it works at all — both covenants accept the same transaction
//   2. ⚠ the car must be AT REST, because the depot pins the hash of a car at rest. So a refuel is
//      also a RESET, which is the property that made reset-from-any-phase worth having.
//   3. ⚠⚠ a car MID-RACE cannot be topped up from the depot — the spec says a splash-and-dash is
//      legal "in any phase" and for the CAR's own value rule that is true, but the DEPOT's hash check
//      forbids it. Worth knowing before a page offers a button that cannot work.
import { Transaction, Spend, PrivateKey, TransactionSignature, Hash } from '@bsv/sdk'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE,
} from '../src/depot.ts'
import {
  buildShellLock, shellUnlockingOps, SHELL_SCOPE, SHELL_MAX_FEE, PHASE, S, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'
import { UnlockingScript } from '@bsv/sdk'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const FRESH = freshPublicShell(OWNER)
const CAR = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })

console.log('\nTHE FUEL BUTTON — the depot filling a car that already exists\n')

/**
 * Build the refuel. Input 0 is the depot, input 1 is the car — each carrying its OWN preimage, since
 * OP_PUSH_TX is per-input. Returns whether each covenant accepted its own half.
 */
async function refuel(o: {
  carState: ShellState; carHas: number; tank: number; draw?: number
  carNext?: ShellState; reset?: boolean
}): Promise<{ depotOk: boolean; carOk: boolean; bytes: number }> {
  const draw = o.draw ?? DEPOT_DRAW
  const next = o.carNext ?? FRESH
  const kept = o.tank - draw - DEPOT_MAX_FEE
  const carOut = o.carHas + draw

  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: o.tank })
  const cSrc = new Transaction()
  cSrc.addOutput({ lockingScript: buildShellLock({ state: o.carState, maxFee: SHELL_MAX_FEE, public: true }), satoshis: o.carHas })

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: cSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: SHELL_MAX_FEE, public: true }), satoshis: carOut })
  tx.lockTime = 1_700_000_500

  // ── the depot's half
  const dPre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, transactionVersion: 2,
    otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: tx.lockTime, scope: DEPOT_SCOPE })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(kept), preimage: dPre })

  // ── the car's half
  const carLock = buildShellLock({ state: o.carState, maxFee: SHELL_MAX_FEE, public: true })
  const cPre = TransactionSignature.format({
    sourceTXID: cSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.carHas, transactionVersion: 2,
    otherInputs: [tx.inputs[0]], inputIndex: 1, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: carLock, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  tx.inputs[1].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [...serializeOutput(tx.outputs[0].satoshis ?? 0, tx.outputs[0].lockingScript.toBinary())],
    newValue: u64(carOut), preimage: cPre, sig: [], pubKey: [], throttle: 0, retire: o.reset ?? true,
    load: { driver: next.driver, pool: next.pool, eng: next.eng, tyr: next.tyr,
            finish: next.finish, slip: next.slip, green: next.green, gap: next.gap } }))

  const val = (i: number, src: Transaction, sats: number, lock: any, scope: number): boolean => {
    try {
      return new Spend({ sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats,
        lockingScript: lock, transactionVersion: 2,
        otherInputs: tx.inputs.filter((_, k) => k !== i), outputs: tx.outputs, inputIndex: i,
        unlockingScript: tx.inputs[i].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  }
  return {
    depotOk: val(0, dSrc, o.tank, DEPOT, DEPOT_SCOPE),
    carOk: val(1, cSrc, o.carHas, carLock, SHELL_SCOPE),
    bytes: tx.toHex().length / 2,
  }
}

// ── 1. a car at rest, nearly dry, gets a tap ──────────────────────────────────────────────────────
{
  const r = await refuel({ carState: FRESH, carHas: 2_200, tank: 60_000 })
  check('★★ the DEPOT accepts filling an existing car', r.depotOk)
  check('★★ …and the CAR accepts being filled, in the same transaction', r.carOk)
  console.log(`        ${r.bytes} B · 2 in, 2 out · car 2,200 → ${(2_200 + DEPOT_DRAW).toLocaleString()}`)
}

// ── 2. a car that has RACED — the refuel is also a reset ──────────────────────────────────────────
console.log()
{
  const raced: ShellState = { ...FRESH, phase: PHASE.OUT, eng: 14, tyr: 10,
    last: 1_700_000_123, n: 31, s: Math.round(210 * S), v: Math.round(3 * S) }
  const r = await refuel({ carState: raced, carHas: 900, tank: 60_000 })
  check('★ a raced car is refuelled AND reset in one transaction', r.depotOk && r.carOk)
  console.log('        ⇒ this is why the reset had to be legal from every phase')

  // …and the same car WITHOUT the reset lands somewhere that is not a fresh car
  const noReset = await refuel({ carState: raced, carHas: 900, tank: 60_000, reset: false,
    carNext: { ...raced, phase: PHASE.OUT } })
  check('  …and without resetting, the DEPOT refuses it', noReset.depotOk, false)
}

// ── 3. ⚠⚠ MID-RACE: the splash-and-dash the spec promises does not exist ──────────────────────────
console.log()
{
  const mid: ShellState = { ...FRESH, phase: PHASE.RACING, eng: 14, tyr: 10,
    last: 1_700_000_123, n: 24, s: Math.round(300 * S), v: Math.round(4 * S) }
  // keep racing AND take fuel: the car might allow it, but the depot pins a car AT REST
  const r = await refuel({ carState: mid, carHas: 500, tank: 60_000, reset: false, carNext: mid })
  check('⚠⚠ a car MID-RACE cannot be topped up from the depot', r.depotOk, false)
  const withReset = await refuel({ carState: mid, carHas: 500, tank: 60_000 })
  check('  …it can only be refuelled by giving up the run', withReset.depotOk && withReset.carOk)
}


// ── ⚠⚠ THE DIAGNOSIS: BOTH COVENANTS DEMAND OUTPUT 0 ─────────────────────────────────────────────
// Each rebuilds itself at out0 and treats everything after as "the spender's outputs". A mint is fine
// — the car is a NEW output, so its covenant is not running. A REFUEL spends both, so both want the
// same slot. Proof: swap them and the failures swap too.
{
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: 60_000 })
  const cSrc = new Transaction(); cSrc.addOutput({ lockingScript: CAR, satoshis: 2_200 })
  const kept = 60_000 - DEPOT_DRAW - DEPOT_MAX_FEE, carOut = 2_200 + DEPOT_DRAW
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: cSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })   // car FIRST
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: CAR, satoshis: carOut })                                  // car at OUT0
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  tx.lockTime = 1_700_000_500
  const cPre = TransactionSignature.format({ sourceTXID: cSrc.id('hex'), sourceOutputIndex: 0,
    sourceSatoshis: 2_200, transactionVersion: 2, otherInputs: [tx.inputs[1]], inputIndex: 0,
    outputs: tx.outputs, inputSequence: 0xfffffffe, subscript: CAR, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [...serializeOutput(kept, DEPOT.toBinary())],
    newValue: u64(carOut), preimage: cPre, sig: [], pubKey: [], throttle: 0, retire: true,
    load: { driver: FRESH.driver, pool: FRESH.pool, eng: FRESH.eng, tyr: FRESH.tyr,
            finish: FRESH.finish, slip: FRESH.slip, green: FRESH.green, gap: FRESH.gap } }))
  const dPre = TransactionSignature.format({ sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0,
    sourceSatoshis: 60_000, transactionVersion: 2, otherInputs: [tx.inputs[0]], inputIndex: 1,
    outputs: tx.outputs, inputSequence: 0xfffffffe, subscript: DEPOT, lockTime: tx.lockTime, scope: DEPOT_SCOPE })
  tx.inputs[1].unlockingScript = buildDepotUnlock({
    spenderOutputs: [...serializeOutput(kept, DEPOT.toBinary())], newValue: u64(carOut), preimage: dPre })
  const ok = (i: number, src: Transaction, sats: number, lock: any) => {
    try { return new Spend({ sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: sats,
      lockingScript: lock, transactionVersion: 2, otherInputs: tx.inputs.filter((_, k) => k !== i),
      outputs: tx.outputs, inputIndex: i, unlockingScript: tx.inputs[i].unlockingScript,
      inputSequence: 0xfffffffe, lockTime: tx.lockTime }).validate() === true } catch { return false }
  }
  console.log()
  check('★★ with the CAR at out0 the car now ACCEPTS', ok(0, cSrc, 2_200, CAR))
  check('★★ …and the DEPOT now refuses — they cannot both be first', ok(1, dSrc, 60_000, DEPOT), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'DEPOT REFUEL OK — the fuel button works, and only on a car at rest.'
  : '⚠ DEPOT REFUEL FAILED')
process.exit(fail === 0 ? 0 : 1)
