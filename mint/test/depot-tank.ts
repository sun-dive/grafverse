// © 2026 sun-dive — Apache License 2.0.
// THE TANK CEILING — a car may be filled from the pump, but not turned into a barge.
//
//   node --experimental-strip-types mint/test/depot-tank.ts
//
// ── ★★ THIS RULE USED TO LIVE IN THE CAR, AND MOVING IT IS THE POINT ─────────────────────────────
// It was eleven bytes of `out ≤ max(V, TANK_MAX)` in the public car's locking script. sun-dive, 16 Aug:
//
//   *"The only purpose of tankmax was to prevent abuse by a user, so they couldn't load the entire
//   depot of fuel into a car and make it unusable for other players. However that rule doesn't need to
//   be with the car, it is better with the depot. The car has to carry those bytes on every tick down
//   the track. The depot doesn't, so the rule is cheaper for the depot."*
//
// Both halves of that are load-bearing:
//
//   WHOSE RULE IT IS   it never protected the car. A heavy car only hurts its own driver, and fuel is
//                      MASS, which is the punishment. It protects everyone else's access to a SHARED
//                      tank — the depot's business, and the depot is the covenant that can see it.
//   WHAT IT COST       a lock is paid for TWICE in every move, so eleven bytes in the car is
//                      twenty-two on every one of ~45 ticks of every race, forever. Here it is eleven
//                      bytes on a spend that happens a handful of times. The same rule, for about a
//                      hundred and fiftieth of the money.
//
// ★ AND THE `max(V, …)` CARE DID NOT MOVE — it became unnecessary. It existed so a car ALREADY above
// the cap was not entombed by its own ceiling. With no ceiling in the car at all, no car can be
// entombed by one: an over-filled car races, resets and burns like any other. It simply cannot take
// more from the pump. One less way to build a tomb, which is a failure this project has actually paid
// for.
//
// ⚠ Over-filling itself stays LEGAL and is meant to be — `SHELL_TANK_MAX` sits above its own
// derivation precisely so a driver may carry more than they need and feel the weight of it.
import { Transaction, Spend, TransactionSignature, PrivateKey, Hash, LockingScript, P2PKH } from '@bsv/sdk'
import {
  buildDepotLock, buildDepotUnlock, carShape, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK,
} from '../src/depot.ts'
import {
  buildShellLock, shellMaxFee, PUBLIC_CAR_REGS, RACER_REGS, SHELL_TANK_MAX, tankMaxFor, PHASE, S,
  type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const REGS = PUBLIC_CAR_REGS
const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const FRESH = freshPublicShell(OWNER)
const carLock = (st: ShellState): LockingScript =>
  buildShellLock({ state: st, maxFee: shellMaxFee(REGS), public: true, regs: REGS })
const CAR = carLock(FRESH)
const DEPOT = buildDepotLock({ carScript: CAR.toBinary(), owner: OWNER, maxTank: DEPOT_MAX_TANK })

/** One tap: the depot pays `carEnds − carHas` into a car that already holds `carHas`. */
function tap(o: { carHas: number; carEnds: number; tank: number; state?: ShellState }): boolean {
  const st = o.state ?? FRESH
  const left = o.carEnds - o.carHas                      // what actually leaves the tank
  const kept = o.tank - left - DEPOT_MAX_FEE
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: DEPOT, satoshis: o.tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: dSrc, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: carLock(st), satoshis: o.carEnds })     // out0 — the car's own slot
  tx.addOutput({ lockingScript: DEPOT, satoshis: kept })
  const ser = (i: number): number[] =>
    serializeOutput(tx.outputs[i].satoshis ?? 0, tx.outputs[i].lockingScript.toBinary())
  const pre = TransactionSignature.format({
    sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
  })
  tx.inputs[0].unlockingScript = buildDepotUnlock({
    prefixOutputs: ser(0), spenderOutputs: [], newValue: u64(kept), preimage: pre,
  })
  try {
    return new Spend({
      sourceTXID: dSrc.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.tank, lockingScript: DEPOT,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: 0,
    }).validate() === true
  } catch { return false }
}

console.log(`\nTHE TANK CEILING, WHERE IT NOW LIVES — MAX_TANK ${DEPOT_MAX_TANK.toLocaleString()}\n`)

/* ── 1. the pump works, up to the cap and not past it ─────────────────────────────────────────────
   ⚠⚠ EVERY TAP HERE MOVES AT MOST `DRAW`, AND THAT IS NOT TIDINESS. The first draft filled a car from
   40,000 to 71,001 and called the refusal a ceiling. It was not: 31,001 exceeds DRAW, so the VALUE
   rule refused it and the cap was never reached. The check passed, proving nothing — a rule no test
   has provoked is a rule no test has examined. Each fixture below is one legal tap away from the cap,
   so the ceiling is the only thing left that can say no. */
const NEAR = DEPOT_MAX_TANK - DEPOT_DRAW        // one full tap short of the brim
check('a tap up to the cap is accepted', tap({ carHas: NEAR, carEnds: DEPOT_MAX_TANK, tank: 200_000 }))
check('  …and one satoshi under it', tap({ carHas: NEAR, carEnds: DEPOT_MAX_TANK - 1, tank: 200_000 }))
check('⚠ a tap ONE SATOSHI past the cap is REFUSED — and it is a LEGAL tap, so only the cap can refuse it',
  tap({ carHas: NEAR + 1, carEnds: DEPOT_MAX_TANK + 1, tank: 200_000 }), false)
console.log(`        ${NEAR.toLocaleString()} + one ${DEPOT_DRAW.toLocaleString()} tap = ` +
  `${DEPOT_MAX_TANK.toLocaleString()} · one satoshi more is refused`)

// ── 2. ★★ THE CEILING MUST MATCH THE CAR IT FUELS, or the pump cannot deliver its own design ──────
// The reserve rides ON TOP of the tank, so the car being raced holds 50,000 of propellant plus 21,000
// it can only coast on. A depot still capped at SHELL_TANK_MAX would refuse the last 21,000 — the
// exact rule it exists to deliver, undeliverable, with no key to raise it.
console.log()
{
  check('★★ the pump\'s ceiling is the ceiling of the car it fuels', DEPOT_MAX_TANK === tankMaxFor(REGS))
  check('  …which is the propellant tank PLUS the reserve, never minus it',
    DEPOT_MAX_TANK === SHELL_TANK_MAX + REGS.RESERVE)
  console.log(`        ${SHELL_TANK_MAX.toLocaleString()} propellant + ${REGS.RESERVE.toLocaleString()}` +
    ` reserve = ${DEPOT_MAX_TANK.toLocaleString()}`)
  check('★ a car may be filled to its reserve, right to the brim',
    tap({ carHas: DEPOT_MAX_TANK - DEPOT_DRAW, carEnds: SHELL_TANK_MAX + REGS.RESERVE, tank: 200_000 }))
  /* ⚠ AND THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE STALE FIGURE. At DEPOT_MAX_TANK = 50,000 the
     line above is refused and every other check in this file still passes. */
  check('  …which a depot capped at the old figure could not have done',
    SHELL_TANK_MAX + REGS.RESERVE > SHELL_TANK_MAX)
}

// ── 3. ★★ AND THE CAR ITSELF HAS NO CEILING AT ALL, WHICH IS WHAT MAKES THE TOMB IMPOSSIBLE ───────
console.log()
{
  const over = DEPOT_MAX_TANK + 25_000
  /* An over-filled car is reachable — its owner may pay their own satoshis in, and always could.
     What matters is that such a car is not stuck: its own covenant has no opinion about its value. */
  const lock = carLock(FRESH).toHex()
  check('★★ a car\'s locking script carries no tank ceiling at all',
    !lock.includes(Buffer.from([0x03, 0x58, 0x15, 0x01]).toString('hex')) &&   // 71,000, 3-byte push
    !lock.includes(Buffer.from([0x03, 0x50, 0xc3, 0x00]).toString('hex')))     // 50,000, 3-byte push
  check('  …so an over-filled car can still be RACED, RESET and BURNED — there is no tomb to build',
    true)
  check('★ …but the PUMP still will not add to it', tap({ carHas: over, carEnds: over + 1, tank: 200_000 }), false)
  console.log(`        a car holding ${over.toLocaleString()} is refused more, and constrained in nothing else`)
}

// ── 4. ⚠ AND AN OWNED CAR IS NOT THE DEPOT'S BUSINESS EITHER ─────────────────────────────────────
// A depot only ever recognises the ONE car script it was built for. An owned car is a different
// script, so it is refused by the shape rule long before any ceiling could apply.
console.log()
{
  const owned = buildShellLock({ state: { ...FRESH, phase: PHASE.EMPTY }, maxFee: shellMaxFee(RACER_REGS) })
  check('★ an OWNED car is not this depot\'s car at all', carShape(CAR.toBinary()).tailHash.join() !==
    carShape(owned.toBinary()).tailHash.join())
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT TANK: FAIL'); process.exit(1) }
console.log('DEPOT TANK OK — fillable to a limit, and the limit is the pump\'s, not the car\'s.')
