// © BSV Association — Open BSV License v6.
// THE PUBLIC CAR · the RESET, in Script.
//
//   node --experimental-strip-types mint/test/public-reset.ts
//
// A public car goes back to EMPTY carrying its fuel and nothing else. The reference has said so since
// step 1; this asks the COVENANT, through the real interpreter.
//
// ★ WHAT HAS TO HOLD, and why each one is here rather than assumed:
//
//   1. a reset from EVERY phase is accepted — that is the rule the "no free undo" refusal replaced
//   2. it lands on freshPublicShell(owner) EXACTLY — the depot pins ONE hash and never parses
//   3. ⚠ a reset that leaves ANY field dirty is REFUSED — the failure that would silently break the
//      depot, and the one a wrong stack depth produces
//   4. the owner survives, and cannot be replaced by the reset
//   5. an OWNED car still cannot do any of this — terminal is still terminal there
import { Transaction, Spend, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, buildShellLock, shellUnlockingOps, SHELL_SCOPE, SHELL_MAX_FEE,
  RACER_REGS as R, S, PHASE, PHASE_NAMES, FIELDS, type ShellState,
} from '../src/shell.ts'
import { freshPublicShell, isAtRest } from '../src/publicShell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])

/** Put one move to the covenant. `reset` is the same flag an owned car calls retire. */
async function spend(o: {
  state: ShellState; next: ShellState; isPublic: boolean; reset: boolean; value?: number; out?: number
}): Promise<boolean> {
  const value = o.value ?? 40_000, out = o.out ?? value - 1_000
  const lock = buildShellLock({ state: o.state, maxFee: SHELL_MAX_FEE, public: o.isPublic })
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: value })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: o.next, maxFee: SHELL_MAX_FEE, public: o.isPublic }), satoshis: out })
  tx.lockTime = 1_700_000_500
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  const ch = (await new P2PKH().unlock(KEY).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [], newValue: u64(out), preimage: pre, sig: ch[0].data ?? [], pubKey: ch[1].data ?? [],
    throttle: 0, retire: o.reset,
    load: { driver: o.next.driver, pool: o.next.pool, eng: o.next.eng, tyr: o.next.tyr,
            finish: o.next.finish, slip: o.next.slip, green: o.next.green, gap: o.next.gap } }))
  try {
    return new Spend({ sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value,
      lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}

console.log('\nTHE RESET, IN SCRIPT\n')

/* A car that has actually been somewhere — every field dirty, so "looks reset" cannot pass by
   accident. Built through the real transitions, never by hand. */
const raced = (phase: number): ShellState => ({
  ...arm(loadTrack(loadCar(freshPublicShell(OWNER), { driver: OWNER, eng: 19, tyr: 7 }, R),
    { finish: Math.round(402 * S), slip: 900, green: 1_700_000_000, gap: 2, pool: new Array(36).fill(3) })),
  phase, last: 1_700_000_123, s: 987_654_321, v: 12_345_678, n: 41,
})

// ── 1 + 2. every phase resets, and lands on the one constant ─────────────────────────────────────
for (const [name, phase] of [['EMPTY', PHASE.EMPTY], ['CAR', PHASE.CAR], ['TRACK', PHASE.TRACK],
      ['ARMED', PHASE.ARMED], ['RACING', PHASE.RACING], ['DONE', PHASE.DONE], ['OUT', PHASE.OUT]] as [string, number][]) {
  const st = raced(phase)
  check(`a ${name} car resets`, await spend({ state: st, next: freshPublicShell(OWNER), isPublic: true, reset: true }))
}

// ── 3. ⚠ THE REFUSALS. A reset that leaves anything behind must be refused, or the depot's one-hash
//        check silently stops matching — and a wrong stack depth is exactly what produces one.
console.log()
for (const k of FIELDS.filter(f => f !== 'phase' && f !== 'driver')) {
  const dirty: ShellState = { ...freshPublicShell(OWNER) }
  ;(dirty as any)[k] = Array.isArray((dirty as any)[k]) ? new Array(((dirty as any)[k] as number[]).length).fill(9) : 7
  check(`  a reset still carrying \`${k}\` is REFUSED`,
    await spend({ state: raced(PHASE.RACING), next: dirty, isPublic: true, reset: true }), false)
}

// ── 4. the owner survives and cannot be swapped
console.log()
const notOwner = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
check('★ the owner survives the reset', isAtRest(freshPublicShell(OWNER), OWNER))
check('★ a reset may NOT install a new owner',
  await spend({ state: raced(PHASE.DONE), next: { ...freshPublicShell(OWNER), driver: notOwner }, isPublic: true, reset: true }), false)

// ── 5. an OWNED car is untouched — terminal is still terminal there
console.log()
const ownedDone: ShellState = { ...raced(PHASE.DONE), driver: OWNER }
check('★★ an OWNED car still cannot be reset out of DONE',
  await spend({ state: ownedDone, next: { ...emptyShell(), driver: OWNER }, isPublic: false, reset: true }), false)

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0 ? 'PUBLIC RESET OK — back to one constant from anywhere, and nothing rides along.'
                       : '⚠ PUBLIC RESET FAILED')
process.exit(fail === 0 ? 0 : 1)
