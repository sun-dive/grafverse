// © 2026 sun-dive — Apache License 2.0.
// DEPOT_MAX_FEE — MEASURED, and asserted against transactions that were actually serialized.
//
//   node --experimental-strip-types mint/test/depot-fee.ts
//
// ⚠ THE CONSTANT THIS FILE EXISTS FOR IS PERMANENT. A depot is minted with MAX_FEE baked into its
// script and there is no key to raise it. Set below what a real spend costs at the 100 sat/KB floor,
// the depot cannot be spent AT ALL — every draw would be refused by the covenant, and every satoshi
// donated to it is locked away forever.
//
// ★ It has been under the floor three times elsewhere in this project, each time with a green suite,
// and each time because somebody counted bytes instead of serializing a transaction. So: serialize.
import { Transaction, PrivateKey, P2PKH, Hash, TransactionSignature, UnlockingScript } from '@bsv/sdk'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK,
} from '../src/depot.ts'
import {
  buildShellLock, shellUnlockingOps, shellMaxFee, SHELL_SCOPE, SHELL_FEE_PER_KB, PUBLIC_CAR_REGS,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
/* ⚠⚠ THE CAR THE DEPOT IS ACTUALLY BUILT TO FUEL, AND MEASURING THE WRONG ONE IS FATAL HERE.
   This built a DEFAULT car while the depot's genesis pins the car being RACED — which carries the
   reserve, so its script is 24 bytes longer. A refuel carries that script THREE times over (inside the
   car's own preimage, inside the depot's prefixOutputs, and as output 0), so 24 bytes of car is ~72
   bytes of transaction, and the fee that was "measured" came out 7 satoshis short of the relay floor.
   Under the floor, permanently, with no key to raise it: the exact failure this file exists to stop,
   and the fifth time this project has stood on it.
   ⇒ THE CAR IS AN INPUT TO THE FEE. Measure the one the depot will be minted against, never a
   convenient stand-in. */
const REGS = PUBLIC_CAR_REGS
const CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: shellMaxFee(REGS),
                             public: true, regs: REGS })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })

console.log('DEPOT_MAX_FEE — measured, not counted\n')
console.log(`        depot ${DEPOT.toBinary().length} bytes · car ${CAR.toBinary().length} bytes\n`)

/** Serialize a real draw: depot(tank) → depot(kept) + car(fuel). Returns the transaction's size. */
async function drawBytes(tank: number, draw: number, carHas: number): Promise<number> {
  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  const kept = tank - draw
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  tx.addOutput({ lockingScript: CAR, satoshis: carHas + draw })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(kept), preimage: pre })
  return tx.toHex().length / 2
}

/** And the BURN, which is a different shape: one input, no outputs the covenant rebuilds. */
async function burnBytes(tank: number): Promise<number> {
  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: Math.max(1, tank - 400) })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE })
  const c = (await new P2PKH().unlock(KEY).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    spenderOutputs: [], newValue: u64(0), preimage: pre, burn: true,
    sig: c[0].data ?? [], pubKey: c[1].data ?? [] })
  return tx.toHex().length / 2
}

/**
 * ★★ AND THE REFUEL — the spend the depot actually exists for, and the one that costs the most.
 *
 * Two covenants, two inputs, two outputs. It is very nearly TWICE the size of a draw, because the car
 * is not merely an output here: it is an INPUT, so its 1,744-byte script is paid for again inside its
 * own preimage. Measuring the depot against a draw alone is how the old constant came to be 516 —
 * correct for a transaction the depot was never supposed to be making.
 *
 * ⚠ THE DEPOT MUST BE ABLE TO FUND THIS BY ITSELF. The car's value rule is a floor, so a driver COULD
 * burn extra fuel to cover the fee — but fuel is mass and the driver just paid for it. The depot is
 * the party that should carry the cost of pumping, which is exactly what MAX_FEE is: the allowance for
 * satoshis that leave the tank and do not arrive in the car.
 */
async function refuelBytes(tank: number, draw: number, carHas: number): Promise<number> {
  const FRESH = freshPublicShell(OWNER)
  const cSrc = new Transaction(); cSrc.addOutput({ lockingScript: CAR, satoshis: carHas })
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const kept = tank - draw
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: cSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: CAR, satoshis: carHas + draw })   // out0 — the car's slot
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  tx.lockTime = 0
  const ser = (i: number): number[] =>
    serializeOutput(tx.outputs[i].satoshis ?? 0, tx.outputs[i].lockingScript.toBinary())

  const cPre = TransactionSignature.format({
    sourceTXID: cSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: carHas, transactionVersion: 2,
    otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: CAR, lockTime: 0, scope: SHELL_SCOPE })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: ser(1), newValue: u64(carHas + draw), preimage: cPre,
    sig: [], pubKey: [], throttle: 0, retire: true,
    load: { driver: FRESH.driver, pool: FRESH.pool, eng: FRESH.eng, tyr: FRESH.tyr,
            finish: FRESH.finish, slip: FRESH.slip, green: FRESH.green, gap: FRESH.gap } }))

  const dPre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [tx.inputs[0]], inputIndex: 1, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE })
  tx.inputs[1].unlockingScript = buildDepotUnlock({
    prefixOutputs: ser(0), spenderOutputs: [], newValue: u64(kept), preimage: dPre })
  return tx.toHex().length / 2
}

// ── the worst spend the depot can be asked to make ───────────────────────────────────────────────
let worst = 0, which = ''
for (const [tank, draw, carHas, label] of [
  [500_000, DEPOT_DRAW, 0, 'a fresh car, full draw'],
  [500_000, DEPOT_DRAW, DEPOT_MAX_TANK - DEPOT_DRAW, 'topping a car to the ceiling'],
  [DEPOT_DRAW + 1, DEPOT_DRAW, 0, 'an almost-empty depot'],
  [16_777_216, DEPOT_DRAW, 0, 'a big tank — bigger numbers push in more bytes'],
] as const) {
  const b = await drawBytes(tank, draw, carHas)
  if (b > worst) { worst = b; which = label }
  console.log(`        ${String(b).padStart(5)} B   ${label}`)
}
for (const [tank, draw, carHas, label] of [
  [500_000, DEPOT_DRAW, 2_200, '★ A REFUEL — two covenants, two inputs'],
  [500_000, DEPOT_DRAW, DEPOT_MAX_TANK - DEPOT_DRAW, '★ a refuel to the ceiling'],
  [16_777_216, DEPOT_DRAW, DEPOT_MAX_TANK - DEPOT_DRAW, '★ a refuel from a big tank'],
] as const) {
  const b = await refuelBytes(tank, draw, carHas)
  if (b > worst) { worst = b; which = label }
  console.log(`        ${String(b).padStart(5)} B   ${label}`)
}
const burn = await burnBytes(500_000)
console.log(`        ${String(burn).padStart(5)} B   the owner's burn (signed)`)
worst = Math.max(worst, burn); if (burn >= worst) which = "the owner's burn"

const need = Math.ceil(worst * SHELL_FEE_PER_KB / 1000)
console.log(`\n        worst spend serializes to ${worst} bytes (${which})`)
console.log(`        ⇒ needs ${need} sat to clear ${SHELL_FEE_PER_KB} sat/KB\n`)

check('★ DEPOT_MAX_FEE covers the worst spend at the relay floor', DEPOT_MAX_FEE >= need)
check('  …and does not overpay wildly', DEPOT_MAX_FEE <= need * 1.25)
console.log(`        DEPOT_MAX_FEE ${DEPOT_MAX_FEE} · needs ${need}` +
  (DEPOT_MAX_FEE >= need
    ? ` · ${(DEPOT_MAX_FEE * 1000 / worst).toFixed(1)} sat/KB, ${DEPOT_MAX_FEE - need} sat of headroom`
    : `  ⇒ ⚠ RAISE DEPOT_MAX_FEE TO ${need + 2} — BELOW THE FLOOR, THE DEPOT COULD NEVER BE SPENT`))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0 ? 'DEPOT FEE OK — the fee was measured, and it clears the floor.' : '⚠ DEPOT FEE FAILED')
process.exit(fail === 0 ? 0 : 1)
