// © BSV Association — Open BSV License v6.
// ★★ CAN SOMEBODY DRAIN THE DEPOT? — the question the "no minting" limit raises, answered by doing it.
//
//   node --experimental-strip-types mint/test/depot-drain.ts
//
// The depot sees OUTPUTS, never inputs, so it cannot tell a car it FILLED from a car it CREATED. That
// is not a fixable oversight — a covenant has no way to read the other inputs of its own transaction.
// So the honest question is not "can minting be blocked" (it cannot) but:
//
//   1. can a stranger empty the tank?              ← and the answer is YES, at ZERO cost to them
//   2. can a stranger TAKE any of it?              ← NO. Not one satoshi reaches a person
//   3. what does the owner actually lose?          ← the mining fees, and nothing else
//
// ⚠ NONE OF THIS IS NEW. The old depot minted keylessly too; this file simply measures what has always
// been true rather than leaving it to reasoning. The one thing the refuel work DID change is the price
// of the griefing: MAX_FEE went 516 → 837, so each forced tap now burns 837 sat instead of 516.
//
// ★ The distinction that matters: this is GRIEFING, not THEFT. An attacker converts the tank into fuel
// sitting in public cars — a form nobody but the owner can ever get value out of. They pay nothing and
// they gain nothing. It is vandalism with a mining fee attached.
import { Transaction, Spend, PrivateKey, P2PKH, TransactionSignature, Hash, Utils, UnlockingScript } from '@bsv/sdk'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_BURN_BELOW,
} from '../src/depot.ts'
import {
  buildShellLock, shellUnlockingOps, SHELL_SCOPE, SHELL_MAX_FEE,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }
const sat = (n: number): string => n.toLocaleString()

const GAME = PrivateKey.fromRandom()
const OWNER = Hash.hash160(GAME.toPublicKey().encode(true) as number[])
const ATTACKER = PrivateKey.fromRandom()
const FRESH = freshPublicShell(OWNER)
const CAR = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER })

console.log('CAN SOMEBODY DRAIN THE DEPOT?\n')

/**
 * One forced tap. NO car input, NO funding input, NO key — a stranger creating a fresh car out of the
 * tank. This is exactly the "mint" the covenant cannot distinguish from a refuel.
 *
 * `payTo` lets the attacker try to send the fuel somewhere they control instead of into a car.
 */
function forcedTap(o: { depotTx: Transaction; vout: number; tank: number; payTo?: 'me' })
  : { ok: boolean; tx: Transaction; kept: number; moved: number } {
  const moved = Math.min(DEPOT_DRAW, o.tank - DEPOT_MAX_FEE)
  const kept = o.tank - moved - DEPOT_MAX_FEE
  const out0 = o.payTo === 'me'
    ? { lockingScript: new P2PKH().lock(ATTACKER.toAddress()), satoshis: moved }
    : { lockingScript: CAR, satoshis: moved }

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.depotTx, sourceOutputIndex: o.vout, sequence: 0xfffffffe })
  tx.addOutput(out0)
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: o.depotTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.tank,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    prefixOutputs: serializeOutput(tx.outputs[0].satoshis ?? 0, tx.outputs[0].lockingScript.toBinary()),
    spenderOutputs: [], newValue: u64(kept), preimage: pre,
  })
  let ok = false
  try {
    ok = new Spend({
      sourceTXID: o.depotTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.tank,
      lockingScript: DEPOT, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0,
    }).validate() === true
  } catch { /* refused */ }
  return { ok, tx, kept, moved }
}

/** Sweep a public car to `who` — the owner-signed burn. The only branch in a public car that pays. */
async function sweep(carTx: Transaction, vout: number, value: number, who: PrivateKey): Promise<boolean> {
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: carTx, sourceOutputIndex: vout, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: new P2PKH().lock(who.toAddress()), satoshis: value - 400 })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: carTx.id('hex'), sourceOutputIndex: vout, sourceSatoshis: value, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: CAR, lockTime: 0, scope: SHELL_SCOPE,
  })
  const ch = (await new P2PKH().unlock(who).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: serializeOutput(tx.outputs[0].satoshis ?? 0, tx.outputs[0].lockingScript.toBinary()),
    newValue: u64(0), preimage: pre, sig: ch[0].data ?? [], pubKey: ch[1].data ?? [],
    throttle: 0, burn: true,
    load: { driver: FRESH.driver, pool: FRESH.pool, eng: FRESH.eng, tyr: FRESH.tyr,
            finish: FRESH.finish, slip: FRESH.slip, green: FRESH.green, gap: FRESH.gap },
  }))
  try {
    return new Spend({
      sourceTXID: carTx.id('hex'), sourceOutputIndex: vout, sourceSatoshis: value, lockingScript: CAR,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0,
    }).validate() === true
  } catch { return false }
}

// ── 1. ⚠ YES — A STRANGER CAN EMPTY THE TANK, AND IT COSTS THEM NOTHING ───────────────────────────
const TANK = 100_000
const cars: { tx: Transaction; value: number }[] = []
{
  let depotTx = new Transaction()
  depotTx.addOutput({ lockingScript: DEPOT, satoshis: TANK })
  let held = TANK, taps = 0, allOk = true

  while (held > DEPOT_MAX_FEE) {
    const r = forcedTap({ depotTx, vout: 0, tank: held })
    if (!r.ok) { allOk = false; break }
    cars.push({ tx: r.tx, value: r.moved })
    depotTx = r.tx; held = r.kept; taps++
    if (taps > 50) break
  }
  check('⚠⚠ a stranger CAN empty the tank — no key, no coin, no car of their own', allOk && held <= DEPOT_MAX_FEE)
  const intoCars = cars.reduce((a, c) => a + c.value, 0)
  console.log(`        ${taps} forced taps · ${sat(intoCars)} sat into cars · ` +
    `${sat(TANK - intoCars - held)} sat to miners · ${sat(held)} left`)
  console.log(`        the attacker funded NOTHING and signed NOTHING`)

  // ⚠ and the husk it leaves is below the burn threshold, so the owner can at least clear it
  check('  …and the husk it leaves is burnable by the owner', held < DEPOT_BURN_BELOW)
}

// ── 2. ★★ BUT NOT ONE SATOSHI REACHES THE ATTACKER ────────────────────────────────────────────────
// This is the whole difference between griefing and theft, and it is the rule that actually protects
// the money: whatever leaves the tank must land in a CAR.
console.log()
{
  const depotTx = new Transaction()
  depotTx.addOutput({ lockingScript: DEPOT, satoshis: TANK })
  check('★★ …but paying it to THEMSELVES is refused — every satoshi must land in a car',
    forcedTap({ depotTx, vout: 0, tank: TANK, payTo: 'me' }).ok, false)

  check('★★ and a stranger cannot sweep the cars either — the burn is the owner\'s alone',
    await sweep(cars[0].tx, 0, cars[0].value, ATTACKER), false)
  console.log('        ⇒ the fuel is in a form the attacker can never get value out of')
}

// ── 3. ★ SO WHAT DOES THE OWNER ACTUALLY LOSE? THE MINING FEES ────────────────────────────────────
// The scattered fuel is not gone: every public car is owner-burnable, so the owner sweeps them back.
console.log()
{
  let recovered = 0, swept = 0
  for (const c of cars) {
    if (await sweep(c.tx, 0, c.value, GAME)) { recovered += c.value - 400; swept++ }
  }
  check('★★ the OWNER can sweep every scattered car back', swept === cars.length)
  const lost = TANK - recovered
  console.log(`        ${swept} cars swept · ${sat(recovered)} of ${sat(TANK)} recovered`)
  console.log(`        ⇒ the attack costs the owner ${sat(lost)} sat (${(lost * 100 / TANK).toFixed(1)}%) — ` +
    `mining fees, both ways`)
  check('  …so the loss is fees, not the balance', recovered > TANK * 0.8)
}

// ── 4. ⚠ AND THE ONE THING THAT WOULD MAKE IT WORSE ───────────────────────────────────────────────
// MAX_FEE is what each forced tap burns. It had to rise 516 → 837 for the refuel to be relayable at
// all, so the griefing got ~62% more expensive to the owner. Worth stating rather than discovering.
console.log()
console.log(`        each forced tap burns MAX_FEE = ${DEPOT_MAX_FEE} sat (was 516 before the refuel fix)`)
console.log(`        ⇒ the cheapest defence is the one already in the spec: DO NOT FUND THE TANK HEAVILY.`)
console.log(`        ⇒ a tank of ${sat(TANK)} is ${Math.ceil(TANK / (DEPOT_DRAW + DEPOT_MAX_FEE))} taps of griefing away from empty.`)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT DRAIN: FAIL — the threat model is not what this file says'); process.exit(1) }
console.log('DEPOT DRAIN OK — the tank can be emptied by anyone, and taken by nobody.')
