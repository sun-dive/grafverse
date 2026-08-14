// © BSV Association — Open BSV License v6.
// THE SHELL'S FRAME — can a script read its own twelve fields and write them back unchanged?
//
//   node --experimental-strip-types mint/test/shell-frame.ts
//
// Deliberately before any physics and any phase rules. The battery's hardest bugs were all in this
// layer rather than in its arithmetic — an offset out by one, a field peeled at the wrong width, a
// branch whose two arms disagreed about the stack. If the frame does not hold, nothing built on it is
// worth debugging, and every failure above it will look like a physics bug instead of a plumbing one.
//
// Everything runs through `Spend`, the same interpreter a node uses. Nothing is asserted about bytes we
// merely believe are correct.
import { Transaction, Spend, LockingScript, UnlockingScript, TransactionSignature } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  FIELDS, FIELD_WIDTHS, RACER_REGS, S, type ShellState,
} from '../src/shell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}

const u64le = (n: number): number[] => {
  const b: number[] = []
  let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}

const DRIVER = new Array(20).fill(0x9c)
const VALUE = 50_000

/**
 * Spend a shell whose output carries `next`. With an identity state machine `next` must equal the
 * state that went in — so this doubles as the test that ANY other output is rejected.
 */
function spend(state: ShellState, next: ShellState, outValue = VALUE): { ok: boolean; why?: string } {
  const prev = buildShellLock({ state })
  const source = new Transaction()
  source.addOutput({ lockingScript: prev, satoshis: VALUE })

  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: next }), satoshis: outValue })
  tx.lockTime = 0

  const preimage = TransactionSignature.format({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: VALUE,
    transactionVersion: tx.version, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: tx.inputs[0].sequence ?? 0xffffffff, subscript: prev,
    lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const spenderOutputs = tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()))
  tx.inputs[0].unlockingScript = new UnlockingScript(
    shellUnlockingOps({ spenderOutputs, newValue: u64le(outValue), preimage }))

  try {
    const ok = new Spend({
      sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: VALUE,
      lockingScript: prev, transactionVersion: tx.version, otherInputs: [], outputs: tx.outputs,
      inputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript!,
      inputSequence: tx.inputs[0].sequence ?? 0xffffffff, lockTime: tx.lockTime,
    }).validate()
    return { ok: ok === true }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0] } }
}

console.log('THE SHELL\'S FRAME — reading twelve fields and writing them back\n')

// A state with every field non-zero and distinguishable, so a field peeled at the wrong offset or
// width cannot coincidentally still validate.
const LOADED: ShellState = {
  ...arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng: 17, tyr: 6 }, RACER_REGS),
    { finish: 402 * S, slip: 1150, green: 1_700_000_123, gap: 7 })),
  last: 1_700_000_456, s: Math.round(123.5 * S), v: Math.round(4.25 * S), n: 41,
}

// ── the frame ────────────────────────────────────────────────────────────────────────────────────────
{
  const lock = buildShellLock({ state: LOADED })
  console.log(`        locking script ${lock.toBinary().length} bytes · state ${FIELDS.length} fields`)

  const r = spend(LOADED, LOADED)
  check('★ a shell reads its own twelve fields and writes them back', r.ok)
  if (!r.ok) console.log('   ↳', r.why)

  const empty = spend(emptyShell(), emptyShell())
  check('the EMPTY shell round-trips too — every field zero', empty.ok)
  if (!empty.ok) console.log('   ↳', empty.why)
}

// ── the frame is doing real work, not merely passing ─────────────────────────────────────────────────
// With an identity state machine, ANY different output must be rejected. If these pass, the comparison
// at the end of the script is not actually comparing anything.
{
  const bump = (k: keyof ShellState, by: number): ShellState =>
    ({ ...LOADED, [k]: (LOADED[k] as number) + by })

  check('a changed `s` is rejected', spend(LOADED, bump('s', 1)).ok, false)
  check('a changed `v` is rejected', spend(LOADED, bump('v', 1)).ok, false)
  check('a changed `n` is rejected', spend(LOADED, bump('n', 1)).ok, false)
  check('a changed `phase` is rejected', spend(LOADED, bump('phase', 1)).ok, false)
  check('a changed `eng` is rejected', spend(LOADED, bump('eng', 1)).ok, false)
  check('a changed `slip` is rejected', spend(LOADED, bump('slip', 1)).ok, false)
  check('a changed `finish` is rejected', spend(LOADED, bump('finish', 1)).ok, false)
  check('a changed `green` is rejected', spend(LOADED, bump('green', 1)).ok, false)
  check('★ a changed DRIVER is rejected — the 20-byte hash survives as bytes',
    spend(LOADED, { ...LOADED, driver: DRIVER.map((b, i) => i === 0 ? b ^ 1 : b) }).ok, false)
}

// ── the value floor ──────────────────────────────────────────────────────────────────────────────────
// maxFee is 0 in the skeleton, so the output may not lose a satoshi. The rule itself is what is being
// tested; the number it enforces arrives with the fee model.
{
  check('the output may hold MORE than it started with — a top-up is just a spend',
    spend(LOADED, LOADED, VALUE + 1_000).ok)
  check('the output may not hold LESS while maxFee is zero',
    spend(LOADED, LOADED, VALUE - 1).ok, false)
}

// ── every field is genuinely distinguishable in the fixture ──────────────────────────────────────────
// A frame test whose fixture has repeated values can pass with fields transposed.
{
  const nums = FIELDS.filter(k => k !== 'driver').map(k => LOADED[k] as number)
  check('the fixture uses a distinct value for every numeric field', new Set(nums).size === nums.length)
  check('and every one fits its field',
    FIELDS.filter(k => k !== 'driver').every(k =>
      Math.abs(LOADED[k] as number) <= 2 ** (8 * FIELD_WIDTHS[k] - 1) - 1))
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL FRAME: FAIL — the frame does not hold; do not build on it'); process.exit(1) }
console.log('SHELL FRAME OK — the state survives a round trip, and nothing else does.')
