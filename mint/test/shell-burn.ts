// © 2026 sun-dive — Apache License 2.0.
// THE BURN — how a car is finally cleared away, and why nothing is locked forever.
//
//   node --experimental-strip-types mint/test/shell-burn.ts
//
// Every other path out of a race leaves ONE SATOSHI in a shell that can never be spent again. The
// phase machine verifies `phase < DONE` on every move, so a DONE or OUT shell is terminal in the
// strongest possible sense: not merely finished, but permanently unspendable. That satoshi is a
// forever-entry in the UTXO set that every node on the network must carry, and a busy track would mint
// one per car, per race.
//
// Retirement stopped the TANK being stranded. This stops the headstone being stranded too.
//
// ★ THE RULE ENFORCES NOTHING, AND THAT IS THE POINT.
//
// The driver's signature is SIGHASH_ALL — it already commits to every output of the transaction. By
// signing, they have said where the money goes. There is nothing left for a covenant to check and no
// output of its own to re-create: the car simply ceases to exist. It is the rule PharLap's editions
// already use for an owner-signed burn, and the same reasoning carries over unchanged.
//
// ⚠ WHAT THIS FILE IS REALLY FOR: proving the branch is REACHED and GUARDED. A burn branch that exists
// but can never execute looks exactly like one that works, and a burn branch that skips the driver
// check is a free car for whoever finds it first. So the refusals matter more than the acceptances.
import { Transaction, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Spend, Hash } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, buildShellLock, shellUnlockingOps, shellMaxFee,
  PUBLIC_CAR_REGS, RACER_REGS as R, S, PHASE, SHELL_SCOPE, SHELL_MAX_FEE,
  type ShellState, type RacerRegs,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const DRIVER_KEY = PrivateKey.fromRandom()
const STRANGER = PrivateKey.fromRandom()
const DRIVER = Hash.hash160(DRIVER_KEY.toPublicKey().encode(true) as number[])
const POOL = new Array(36).fill(7)

/** A shell parked in any phase, as if it were a real tip. */
function shellAt (phase: number): ShellState {
  let st = emptyShell()
  if (phase === PHASE.EMPTY) return st
  st = loadCar(st, { driver: DRIVER, eng: 14, tyr: 10 }, R)
  if (phase === PHASE.CAR) return st
  st = loadTrack(st, { finish: Math.round(402 * S), slip: 1000, green: 1_700_000_000, gap: 1, pool: POOL })
  if (phase === PHASE.TRACK) return st
  st = arm(st)
  if (phase === PHASE.ARMED) return st
  return { ...st, phase, n: 42, s: Math.round(410 * S), v: 1234, last: 1_700_000_055 }
}

/**
 * Try to burn a shell, sweeping everything it holds to `sweepTo`. There is NO covenant output — that
 * is the whole point, so the shell's value simply leaves. `signer` is not always the driver.
 */
async function burn (st: ShellState, value: number, signer: PrivateKey, sweepTo: PrivateKey,
                     opts: { burn?: boolean; retire?: boolean; public?: boolean; regs?: RacerRegs } = {}):
                     Promise<{ ok: boolean; why: string; swept: number }> {
  const regs = opts.regs ?? R
  const lock = buildShellLock({ state: st, maxFee: shellMaxFee(regs), public: opts.public, regs })
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: value })

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  const swept = Math.max(1, value - 300)
  tx.addOutput({ lockingScript: new P2PKH().lock(sweepTo.toAddress()), satoshis: swept })
  tx.lockTime = 0

  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const chunks = (await new P2PKH().unlock(signer).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(swept), preimage: pre, sig: chunks[0].data ?? [], pubKey: chunks[1].data ?? [],
    throttle: 0, burn: opts.burn ?? true, retire: opts.retire ?? false,
    load: { driver: st.driver, pool: st.pool, eng: st.eng, tyr: st.tyr,
            finish: st.finish, slip: st.slip, green: st.green, gap: st.gap },
  }))
  try {
    const ok = new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate()
    return { ok: ok === true, why: '', swept }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0], swept } }
}

console.log('THE BURN — a finished car can be cleared away, and only by its driver\n')

// ── ★ THE HEADSTONE COMES HOME ────────────────────────────────────────────────────────────────────
// A DONE shell holds exactly one satoshi and is refused by every ordinary path. This is the only way
// it can ever move again.
{
  const done = shellAt(PHASE.DONE)
  const r = await burn(done, 1, DRIVER_KEY, DRIVER_KEY)
  check('★ a DONE shell can be burned by its driver', r.ok)
  if (!r.ok) console.log('   ↳', r.why)

  const out = shellAt(PHASE.OUT)
  check('★ an OUT shell can be burned too — a wreck is not a grave', (await burn(out, 1, DRIVER_KEY, DRIVER_KEY)).ok)
}

// ── AND WITHOUT THE FLAG IT IS STILL A GRAVE ──────────────────────────────────────────────────────
// The control that gives the two above their meaning: the same transaction, the same key, the same
// signature — only the burn flag withheld. If this passed, the branch would be doing nothing.
{
  const done = shellAt(PHASE.DONE)
  const r = await burn(done, 1, DRIVER_KEY, DRIVER_KEY, { burn: false })
  check('★ …and WITHOUT the burn flag, a DONE shell is still unspendable', r.ok, false)
  console.log(`        refused: ${r.why.replace('Script evaluation error: ', '').slice(0, 68)}`)
}

// ── ONLY THE DRIVER ───────────────────────────────────────────────────────────────────────────────
// The burn branch sits BELOW the driver check, so a stranger's signature never reaches it.
{
  const done = shellAt(PHASE.DONE)
  check('★ a STRANGER cannot burn someone else\'s car', (await burn(done, 1, STRANGER, STRANGER)).ok, false)
  check('  …not even to sweep it to the real driver', (await burn(done, 1, STRANGER, DRIVER_KEY)).ok, false)
}

// ── AN UNCLAIMED SHELL IS NOT FREE MONEY ──────────────────────────────────────────────────────────
// At phase 0 the driver is twenty zero bytes and the signature check is skipped, so without its own
// guard the burn branch would hand a passer-by the whole tank in one transaction.
{
  const fresh = shellAt(PHASE.EMPTY)
  check('★ an UNCLAIMED shell cannot be burned by a passer-by', (await burn(fresh, 60_000, STRANGER, STRANGER)).ok, false)
  check('  …nor by anyone at all, signature or not', (await burn(fresh, 60_000, DRIVER_KEY, DRIVER_KEY)).ok, false)
}

// ── A CAR CAN BE CLEARED AWAY AT ANY POINT IN ITS LIFE ────────────────────────────────────────────
// Burning mid-race is the driver's business: it is their car and their money. What matters is that
// every phase has a way out, so no configuration of a shell is ever a trap.
for (const [name, phase] of [['CAR', PHASE.CAR], ['TRACK', PHASE.TRACK], ['ARMED', PHASE.ARMED],
                             ['RACING', PHASE.RACING]] as [string, number][]) {
  const r = await burn(shellAt(phase), 40_000, DRIVER_KEY, DRIVER_KEY)
  check(`  a ${name} shell can be burned by its driver`, r.ok)
  if (!r.ok) console.log('   ↳', r.why)
}

// ── THE MONEY GOES WHERE THE DRIVER SAID ──────────────────────────────────────────────────────────
// Nothing is enforced about the outputs, because the signature already committed to them. Proving it
// sweeps to an unrelated address is proving the covenant genuinely stepped out of the way.
{
  const elsewhere = PrivateKey.fromRandom()
  const r = await burn(shellAt(PHASE.DONE), 1, DRIVER_KEY, elsewhere)
  check('★ the driver may sweep it ANYWHERE — the covenant enforces no output', r.ok)
}

/* ── ★★★ THE TEST CAR IS BURNABLE AT EVERY POINT — the constraint, walked rather than argued ──────
   sun-dive, 16 Aug, as one of the two rules everything this session was judged against:

     *"The cars need to be burnable at any point because if a car bricks due to a bug, the sats should
     not be stranded in the covenant forever."*

   ★ AND IT IS A PROPERTY OF THE CODE BEING PROVED, NOT OF THE DESIGN. The end state is a car that is
   a BATTERY — one branch, advance the state and pay the miner, no output that can pay a person, no
   key, nothing worth stealing. The burn is the one branch left that pays somebody, and it is here
   ONLY while the code is being trusted. When it goes, `driver` goes with it and the fuel in a bricked
   car can no longer be recovered — only raced. That is the trade being deferred, deliberately.

   ⚠ IT IS ALSO STRUCTURAL, WHICH IS WHY IT IS TESTED ANYWAY. The burn branch sits ABOVE the physics
   and its depth is computed from the field count and the loadables, neither of which the regulations
   move — so no tuning can reach it. Everything in this session was a change to the branches BELOW it.
   A rule whose whole value is that it holds when something else is broken is exactly the rule you do
   not want to hold by argument. */
console.log()
{
  const PUB = freshPublicShell(DRIVER)          // `DRIVER` is already the hash160 in this file
  const REGS = PUBLIC_CAR_REGS
  const racing: ShellState = { ...PUB, eng: 14, tyr: 10, last: 1_700_000_123, n: 12,
    s: Math.round(300 * S), v: Math.round(4 * S), green: 1_700_000_000, gap: 1,
    finish: Math.round(402 * S), slip: 1000 }

  let ok = 0, tried = 0
  for (const [label, st] of [
    ['EMPTY  ', PUB],
    ['ARMED  ', { ...racing, phase: PHASE.ARMED, s: 0, v: 0, n: 0 }],
    ['RACING ', { ...racing, phase: PHASE.RACING }],
    ['DONE   ', { ...racing, phase: PHASE.DONE }],
    ['OUT    ', { ...racing, phase: PHASE.OUT }],
  ] as Array<[string, ShellState]>) {
    /* ⚠ AN EMPTY TANK AND A BRIM-FULL ONE. The value rule is what a burn has to get past, and it is
       the one thing that changes with the amount — a car holding its whole 71,000 ceiling is the
       expensive case to be wrong about. */
    for (const value of [1_000, 71_000]) {
      tried++
      const r = await burn(st, value, DRIVER_KEY, DRIVER_KEY, { burn: true, public: true, regs: REGS })
      if (r.ok) ok++
      else console.log(`        ⚠ ${label} at ${value.toLocaleString()} sat — ${r.why}`)
    }
  }
  check(`★★★ the public car being raced is burnable in all ${tried} cases — every phase, empty and full`,
    ok === tried)
  console.log('        EMPTY · ARMED · RACING · DONE · OUT, at 1,000 and 71,000 sat')
  console.log('        ⇒ a bricked car costs a genesis, never a tank')

  // …and it is still the OWNER's door alone, in the variant that will actually be minted
  const thief = await burn({ ...racing, phase: PHASE.RACING }, 71_000, STRANGER, STRANGER,
    { burn: true, public: true, regs: REGS })   // ⚠ a real signature, by the wrong key
  check('  …and a stranger still cannot open it', thief.ok, false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL BURN: FAIL — do not mint'); process.exit(1) }
console.log('SHELL BURN OK — every car has a way out, and only its driver has the key to it.')
