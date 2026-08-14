// © BSV Association — Open BSV License v6.
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
  emptyShell, loadCar, loadTrack, arm, buildShellLock, shellUnlockingOps,
  RACER_REGS as R, S, PHASE, SHELL_SCOPE, SHELL_MAX_FEE, type ShellState,
} from '../src/shell.ts'
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
                     opts: { burn?: boolean; retire?: boolean } = {}): Promise<{ ok: boolean; why: string; swept: number }> {
  const lock = buildShellLock({ state: st, maxFee: SHELL_MAX_FEE })
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

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL BURN: FAIL — do not mint'); process.exit(1) }
console.log('SHELL BURN OK — every car has a way out, and only its driver has the key to it.')
