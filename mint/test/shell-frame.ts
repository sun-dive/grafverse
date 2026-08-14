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
import { Transaction, Spend, LockingScript, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  FIELDS, FIELD_WIDTHS, RACER_REGS, S, PHASE, PHASE_NAMES, type ShellState,
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

/* A real key, because the covenant now demands a real signature. `driver` is its hash160 — the same
   twenty bytes a P2PKH address is built from, which is what lets an ordinary wallet drive a car. */
const DRIVER_KEY = PrivateKey.fromRandom()
const DRIVER = Hash.hash160(DRIVER_KEY.toPublicKey().encode(true) as number[])
const STRANGER = PrivateKey.fromRandom()
const VALUE = 50_000
const GREEN = 1_700_000_123, LAST = 1_700_000_456, GAP = 7
/** Comfortably past max(green, last + gap) — the default clock for moves that are not about timing. */
const LATE = LAST + GAP + 60

/**
 * Spend a shell whose output carries `next`. The only difference the script now makes is the phase, so
 * `next` must be the input state with its phase advanced — anything else must be rejected, which is
 * what makes this a test of the comparison as well as of the transition.
 */
async function spend(state: ShellState, next: ShellState, outValue = VALUE,
               signer: PrivateKey | null = DRIVER_KEY,
               lockTime = LATE): Promise<{ ok: boolean; why?: string }> {
  const prev = buildShellLock({ state })
  const source = new Transaction()
  source.addOutput({ lockingScript: prev, satoshis: VALUE })

  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: next }), satoshis: outValue })
  tx.lockTime = lockTime

  const preimage = TransactionSignature.format({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: VALUE,
    transactionVersion: tx.version, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: tx.inputs[0].sequence ?? 0xffffffff, subscript: prev,
    lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const spenderOutputs = tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary()))

  /* The signature is an ORDINARY one over this input — P2PKH's own template produces it, using the
     source output's locking script as the subscript, which here is the covenant. That is the whole
     point: a car is driven by a normal wallet key doing a normal thing. */
  let sig: number[] = [], pubKey: number[] = []
  if (signer != null) {
    const chunks = (await new P2PKH().unlock(signer).sign(tx, 0)).chunks
    sig = chunks[0].data ?? []
    pubKey = chunks[1].data ?? []
  }
  tx.inputs[0].unlockingScript = new UnlockingScript(
    shellUnlockingOps({ spenderOutputs, newValue: u64le(outValue), preimage, sig, pubKey }))

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
    { finish: 402 * S, slip: 1150, green: GREEN, gap: GAP })),
  last: LAST, s: Math.round(123.5 * S), v: Math.round(4.25 * S), n: 41,
}

// ── the frame ────────────────────────────────────────────────────────────────────────────────────────
{
  const lock = buildShellLock({ state: LOADED })
  console.log(`        locking script ${lock.toBinary().length} bytes · state ${FIELDS.length} fields`)

  /** What the script does now: advance the phase, and — once racing — stamp `last` with the clock. */
  const advanced = (st: ShellState, at = LATE): ShellState => {
    const phase = Math.min(st.phase + 1, PHASE.RACING) as ShellState['phase']
    return { ...st, phase, last: phase === PHASE.RACING ? at : st.last }
  }

  const r = (await spend(LOADED, advanced(LOADED)))
  check('★ a shell reads its own twelve fields and writes back eleven unchanged', r.ok)
  if (!r.ok) console.log('   ↳', r.why)

  const empty = (await spend(emptyShell(), advanced(emptyShell())))
  check('the EMPTY shell round-trips too — every field zero', empty.ok)
  if (!empty.ok) console.log('   ↳', empty.why)
}

// ── the frame is doing real work, not merely passing ─────────────────────────────────────────────────
// With an identity state machine, ANY different output must be rejected. If these pass, the comparison
// at the end of the script is not actually comparing anything.
{
  const adv = { ...LOADED, phase: PHASE.RACING as ShellState['phase'], last: LATE }
  const bump = (k: keyof ShellState, by: number): ShellState =>
    ({ ...adv, [k]: (adv[k] as number) + by })

  check('a changed `s` is rejected', (await spend(LOADED, bump('s', 1))).ok, false)
  check('a changed `v` is rejected', (await spend(LOADED, bump('v', 1))).ok, false)
  check('a changed `n` is rejected', (await spend(LOADED, bump('n', 1))).ok, false)
  check('a changed `eng` is rejected', (await spend(LOADED, bump('eng', 1))).ok, false)
  check('a changed `slip` is rejected', (await spend(LOADED, bump('slip', 1))).ok, false)
  check('a changed `finish` is rejected', (await spend(LOADED, bump('finish', 1))).ok, false)
  check('a changed `green` is rejected', (await spend(LOADED, bump('green', 1))).ok, false)
  check('★ a changed DRIVER is rejected — the 20-byte hash survives as bytes',
    (await spend(LOADED, { ...adv, driver: DRIVER.map((b, i) => i === 0 ? b ^ 1 : b) })).ok, false)
}

// ── THE PHASE MACHINE ────────────────────────────────────────────────────────────────────────────────
// The sequence is the anti-cheat: nobody swaps a bigger engine in after the fuel goes in, and the chain
// records the order it happened. Here the script — not the reference — is what enforces it.
{
  const at = (phase: number): ShellState => ({ ...LOADED, phase: phase as ShellState['phase'] })
  const to = (from: number, phase: number): ShellState =>
    ({ ...LOADED, phase: phase as ShellState['phase'], last: phase === PHASE.RACING ? LATE : LOADED.last })

  for (const [from, want] of [[0, 1], [1, 2], [2, 3], [3, 4]] as const) {
    check(`${PHASE_NAMES[from]} → ${PHASE_NAMES[want]}`, (await spend(at(from), to(from, want))).ok)
  }
  check('RACING → RACING · a race continues until the physics end it',
    (await spend(at(PHASE.RACING), to(PHASE.RACING, PHASE.RACING))).ok)

  // Skipping and standing still are the two ways to cheat the sequence, and both are refused.
  check('EMPTY cannot skip straight to TRACK', (await spend(at(0), to(0, 2))).ok, false)
  check('CAR cannot skip straight to ARMED', (await spend(at(1), to(1, 3))).ok, false)
  check('★ a phase cannot stand still — you cannot re-load a car', (await spend(at(0), to(0, 0))).ok, false)
  check('and it cannot go backwards', (await spend(at(2), to(2, 1))).ok, false)

  // ★ Terminal means terminal. The run is over, the chain stops, and the final state stands as the
  // record — there is no key anywhere that can restart a car that blew up or crossed the line.
  check('★ a DONE shell cannot be spent AT ALL', (await spend(at(PHASE.DONE), to(5, 5))).ok, false)
  check('★ an OUT shell cannot be spent AT ALL', (await spend(at(PHASE.OUT), to(6, 6))).ok, false)
  check('  …not even to advance it', (await spend(at(PHASE.DONE), to(5, 6))).ok, false)
}

// ── ONLY THE DRIVER MAY MOVE THE CAR ─────────────────────────────────────────────────────────────────
// `driver` stops being twenty bytes the script carries around and becomes the key that must sign.
{
  const at = (phase: number): ShellState => ({ ...LOADED, phase: phase as ShellState['phase'] })
  const to = (phase: number): ShellState =>
    ({ ...LOADED, phase: phase as ShellState['phase'], last: phase === PHASE.RACING ? LATE : LOADED.last })

  check('★ the driver may move it', (await spend(at(3), to(4))).ok)
  check('★ a STRANGER may not — right shape, wrong key',
    (await spend(at(3), to(4), VALUE, STRANGER)).ok, false)
  check('★ nor may nobody — an unsigned move on a claimed shell is refused',
    (await spend(at(3), to(4), VALUE, null)).ok, false)

  // ★ An EMPTY shell is UNCLAIMED. Its driver is twenty zero bytes and no public key hashes to that,
  // so nothing could sign for it — and it does not need to, because claiming it is what SETS the
  // driver. This is the one transition in the whole machine that anybody may make.
  const unclaimed = emptyShell()
  const claimed = { ...unclaimed, phase: PHASE.CAR as ShellState['phase'] }
  check('★ an unclaimed shell can be claimed by anyone, unsigned',
    (await spend(unclaimed, claimed, VALUE, null)).ok)
  check('  …and the moment it is claimed, the signature becomes compulsory',
    (await spend({ ...unclaimed, phase: PHASE.CAR as ShellState['phase'], driver: DRIVER },
                 { ...unclaimed, phase: PHASE.TRACK as ShellState['phase'], driver: DRIVER },
                 VALUE, null)).ok, false)
}

// ── THE CHRISTMAS TREE ───────────────────────────────────────────────────────────────────────────────
// One rule covers the launch and every move after it: nLockTime ≥ max(green, last + gap). On a launch
// `last` is zero so `green` wins outright; afterwards `last + gap` does. No branch, nothing to get out
// of step — and a false start is not punished, it is UNMINEABLE, because a transaction whose nLockTime
// has not arrived is non-final.
{
  const armed = { ...LOADED, phase: PHASE.ARMED as ShellState['phase'], last: 0 }
  const launched = (at: number): ShellState =>
    ({ ...LOADED, phase: PHASE.RACING as ShellState['phase'], last: at })

  check('★ a launch ON the green is legal',
    (await spend(armed, launched(GREEN), VALUE, DRIVER_KEY, GREEN)).ok)
  check('★ a FALSE START is refused — one second before the green',
    (await spend(armed, launched(GREEN - 1), VALUE, DRIVER_KEY, GREEN - 1)).ok, false)
  check('  …and an hour early is no better',
    (await spend(armed, launched(GREEN - 3600), VALUE, DRIVER_KEY, GREEN - 3600)).ok, false)

  const racing = { ...LOADED, phase: PHASE.RACING as ShellState['phase'], last: LAST }
  check('★ a move exactly one gap later is legal',
    (await spend(racing, launched(LAST + GAP), VALUE, DRIVER_KEY, LAST + GAP)).ok)
  check('★ a move INSIDE the gap is refused — the machine cannot be out-clicked',
    (await spend(racing, launched(LAST + GAP - 1), VALUE, DRIVER_KEY, LAST + GAP - 1)).ok, false)

  check('★ `last` is stamped with this move\'s clock, so the next gap is measured from here',
    (await spend(racing, launched(LATE), VALUE, DRIVER_KEY, LATE)).ok)
  check('  …and a shell that lies about it is refused',
    (await spend(racing, launched(LATE - 5), VALUE, DRIVER_KEY, LATE)).ok, false)

  // Loading is not racing: the tree does not gate a car being built, and `last` stays put.
  check('the tree does not gate the loading phases',
    (await spend({ ...LOADED, phase: PHASE.CAR as ShellState['phase'] },
                 { ...LOADED, phase: PHASE.TRACK as ShellState['phase'] }, VALUE, DRIVER_KEY, 0)).ok)
}

// ── the value floor ──────────────────────────────────────────────────────────────────────────────────
// maxFee is 0 in the skeleton, so the output may not lose a satoshi. The rule itself is what is being
// tested; the number it enforces arrives with the fee model.
{
  const adv = { ...LOADED, phase: PHASE.RACING as ShellState['phase'], last: LATE }
  check('the output may hold MORE than it started with — a top-up is just a spend',
    (await spend(LOADED, adv, VALUE + 1_000)).ok)
  check('the output may not hold LESS while maxFee is zero',
    (await spend(LOADED, adv, VALUE - 1)).ok, false)
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
