// © BSV Association — Open BSV License v6.
// THE TANK CEILING — a public car may be filled, but not turned into a barge.
//
//   node --experimental-strip-types mint/test/public-tank.ts
//
// Fuel is MASS and a public car is free to fuel, so without a ceiling one visitor can tap the pump
// until nobody else can move it. There is no way to take fuel out again except by burning it down the
// strip, so the rule has to be on the way IN.
//
// ★ WHAT HAS TO HOLD:
//   1. a top-up up to the cap is accepted — the pump still works
//   2. ⚠ a top-up PAST the cap is refused — the rule does something
//   3. racing is untouched: the value only ever falls, so the ceiling never fires on the way down
//   4. ⚠⚠ A CAR ALREADY OVER THE CAP IS NOT ENTOMBED. It may still race, reset and burn — it simply
//      cannot take on more. This is the `max(V, TANK_MAX)` and it is the whole care in the rule.
//   5. an OWNED car has no ceiling at all — its tank is its owner's own money
import { Transaction, Spend, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  SHELL_MAX_FEE, SHELL_TANK_MAX, RACER_REGS as R, S, PHASE, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])

/** Spend a car worth `value` into a successor worth `out`. A top-up is simply out > value. */
async function spend(o: { state: ShellState; next: ShellState; value: number; out: number
                          isPublic: boolean; reset?: boolean; throttle?: number }): Promise<boolean> {
  const lock = buildShellLock({ state: o.state, maxFee: SHELL_MAX_FEE, public: o.isPublic })
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: o.value })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: o.next, maxFee: SHELL_MAX_FEE, public: o.isPublic }), satoshis: o.out })
  tx.lockTime = 1_700_000_500
  const pre = TransactionSignature.format({ sourceTXID: src.id('hex'), sourceOutputIndex: 0,
    sourceSatoshis: o.value, transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  const ch = (await new P2PKH().unlock(KEY).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [], newValue: u64(o.out), preimage: pre, sig: ch[0].data ?? [], pubKey: ch[1].data ?? [],
    throttle: o.throttle ?? 0, retire: o.reset ?? false,
    load: { driver: o.next.driver, pool: o.next.pool, eng: o.next.eng, tyr: o.next.tyr,
            finish: o.next.finish, slip: o.next.slip, green: o.next.green, gap: o.next.gap } }))
  try {
    return new Spend({ sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.value,
      lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}

console.log(`\nTHE TANK CEILING — SHELL_TANK_MAX = ${SHELL_TANK_MAX.toLocaleString()}\n`)

const FRESH = freshPublicShell(OWNER)
/* A tap is a spend that ADDS value. It arrives at EMPTY and leaves at EMPTY — which is only possible
   at all because the reset is legal from every phase. */
const tap = (from: number, to: number) =>
  spend({ state: FRESH, next: FRESH, value: from, out: to, isPublic: true, reset: true })

// ── 1 + 2. the pump works, up to the cap and not past it ─────────────────────────────────────────
check('a tap up to the cap is accepted', await tap(40_000, SHELL_TANK_MAX))
check('  …and one satoshi under it', await tap(40_000, SHELL_TANK_MAX - 1))
check('⚠ a tap ONE SATOSHI past the cap is REFUSED', await tap(40_000, SHELL_TANK_MAX + 1), false)
check('⚠ …and a fifty-tap barge, emphatically', await tap(40_000, 500_000), false)

// ── 3. racing is untouched — the value only falls ────────────────────────────────────────────────
console.log()
{
  const st: ShellState = { ...arm(loadTrack(loadCar(FRESH, { driver: OWNER, eng: 14, tyr: 10 }, R),
    { finish: Math.round(402 * S), slip: 1000, green: 1_700_000_000, gap: 1, pool: new Array(36).fill(0) })),
    phase: PHASE.RACING, last: 1_700_000_400, s: Math.round(50 * S), v: Math.round(2 * S), n: 20 }
  const w = refTick(st, { throttle: 8, lockTime: 1_700_000_500, fuel: 45_000 }, R)
  check('a racing move is unaffected by the ceiling',
    await spend({ state: st, next: w.state, value: 45_000, out: 45_000 - w.burn, isPublic: true, throttle: 8 }))
}

// ── 4. ⚠⚠ A CAR ALREADY OVER THE CAP IS NOT ENTOMBED ─────────────────────────────────────────────
// The failure a flat ceiling would have created, and the reason for the `max`.
console.log()
const OVER = SHELL_TANK_MAX + 25_000
check('★★ an over-filled car can still RESET', await spend({
  state: { ...FRESH, phase: PHASE.RACING, n: 9 }, next: FRESH, value: OVER, out: OVER - 500, isPublic: true, reset: true }))
check('★★ …and can still spend down normally', await spend({
  state: FRESH, next: FRESH, value: OVER, out: OVER - 1_000, isPublic: true, reset: true }))
check('  …but still may not take on MORE', await spend({
  state: FRESH, next: FRESH, value: OVER, out: OVER + 1, isPublic: true, reset: true }), false)

// ── 5. an owned car has no ceiling ───────────────────────────────────────────────────────────────
console.log()
{
  const owned: ShellState = { ...emptyShell(), driver: OWNER }
  const next = loadCar(owned, { driver: OWNER, eng: 14, tyr: 10 }, R)
  check('★ an OWNED car may hold far more than the cap',
    await spend({ state: owned, next, value: 400_000, out: 399_000, isPublic: false }))
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0 ? 'PUBLIC TANK OK — fillable to a limit, never entombed by it.' : '⚠ PUBLIC TANK FAILED')
process.exit(fail === 0 ? 0 : 1)
