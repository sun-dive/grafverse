// © BSV Association — Open BSV License v6.
// THE PUBLIC CAR · increment 1 — THE SIGNATURE GATE.
//
//   node --experimental-strip-types mint/test/public-gate.ts
//
// A public car is driven by anyone and owned by the game, and both facts come from swapping ONE
// condition. The body of the check is identical in either variant, because "prove you hold the key
// this shell names" is the same question whether it is asked of a driver or of an owner:
//
//   owned    IF (phase ≠ 0)   a signature on every move from phase 1 · your car, your key
//   public   IF (burn)        a signature ONLY to burn · anyone may drive, one party may retire
//
// ★ So `driver` is not repurposed by a convention held in a comment. In a public car nothing ever asks
// it to authorise a move, and the only branch that consults it is the burn.
//
// ⚠ WHAT THIS FILE HAS TO CATCH: that the OWNED variant did not quietly lose its signature. The gate
// is one shared block, so a mistake there opens every racer's car to anybody — the two halves are
// asserted side by side, in the same run, for that reason.
import { Transaction, Spend, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, buildShellLock, shellUnlockingOps, SHELL_SCOPE, SHELL_MAX_FEE,
  RACER_REGS as R, S, PHASE, type ShellState,
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
const STRANGER = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])

/* ⚠ SUCCESSORS COME FROM THE REFERENCE, NEVER FROM HAND. The covenant recomputes the next state and
   compares it exactly, so a hand-bumped phase is refused for reasons that have nothing to do with the
   signature — and a refusal test built on one passes while proving nothing at all. */
const TRACK = (st: ShellState): ShellState =>
  loadTrack(st, { finish: Math.round(402 * S), slip: 1000, green: 1_700_000_000, gap: 1, pool: new Array(36).fill(0) })

/** Attempt a move. `signer` may be nobody at all — which is the whole question. */
async function move(o: {
  state: ShellState; next: ShellState; isPublic: boolean; value?: number
  signer?: PrivateKey | null; burn?: boolean; sweep?: boolean
}): Promise<boolean> {
  const value = o.value ?? 40_000
  const lock = buildShellLock({ state: o.state, maxFee: SHELL_MAX_FEE, public: o.isPublic })
  const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: value })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  if (o.sweep) {
    tx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: value - 400 })
  } else {
    tx.addOutput({ lockingScript: buildShellLock({ state: o.next, maxFee: SHELL_MAX_FEE, public: o.isPublic }), satoshis: value })
  }
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  let sig: number[] = [], pubKey: number[] = []
  if (o.signer) {
    const ch = (await new P2PKH().unlock(o.signer).sign(tx, 0)).chunks
    sig = ch[0].data ?? []; pubKey = ch[1].data ?? []
  }
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(o.sweep ? 0 : 1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(o.sweep ? 0 : value), preimage: pre, sig, pubKey, throttle: 0, burn: !!o.burn,
    load: { driver: o.next.driver, pool: o.next.pool, eng: o.next.eng, tyr: o.next.tyr,
            finish: o.next.finish, slip: o.next.slip, green: o.next.green, gap: o.next.gap },
  }))
  try {
    return new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { return false }
}

console.log('THE SIGNATURE GATE — anyone may drive a public car, and only its owner may retire it\n')
{
  const o = buildShellLock({ state: emptyShell(), maxFee: SHELL_MAX_FEE }).toBinary().length
  const p = buildShellLock({ state: emptyShell(), maxFee: SHELL_MAX_FEE, public: true }).toBinary().length
  console.log(`        owned ${o} bytes · public ${p} bytes — the shell MINUS machinery, not plus a flag\n`)
}

// ── ★ THE OWNED VARIANT MUST NOT HAVE LOST ITS SIGNATURE ──────────────────────────────────────────
// Asserted first and in the same run, because the gate is one shared block: a mistake there opens
// every racer's car to anybody.
{
  const car = loadCar(emptyShell(), { driver: OWNER, eng: 14, tyr: 10 }, R)
  const track = TRACK(car)
  check('★★ an OWNED car still refuses an unsigned move',
    await move({ state: car, next: track, isPublic: false, signer: null }), false)
  check('★ …and refuses a STRANGER',
    await move({ state: car, next: track, isPublic: false, signer: STRANGER }), false)
  check('  …and accepts its driver', await move({ state: car, next: track, isPublic: false, signer: KEY }))
}

// ── ★ AND A PUBLIC CAR ASKS FOR NOTHING ───────────────────────────────────────────────────────────
{
  const fresh = freshPublicShell(OWNER)
  const built = loadCar(fresh, { driver: OWNER, eng: 14, tyr: 10 }, R)
  check('★★ a PUBLIC car accepts a move with NO SIGNATURE AT ALL',
    await move({ state: fresh, next: built, isPublic: true, signer: null }))
  check('  …and from a stranger, which is the same thing',
    await move({ state: fresh, next: built, isPublic: true, signer: STRANGER }))

  check('  …at a later phase too, where an owned car would demand one',
    await move({ state: built, next: TRACK(built), isPublic: true, signer: null }))
}

// ── ★ BUT THE BURN STILL BELONGS TO THE OWNER ─────────────────────────────────────────────────────
// The one branch that consults `driver` at all. If this were open, a public car would be free money
// for whoever noticed — every other check above would still pass.
{
  const fresh = freshPublicShell(OWNER)
  check('★★ a STRANGER cannot burn a public car',
    await move({ state: fresh, next: fresh, isPublic: true, signer: STRANGER, burn: true, sweep: true }), false)
  check('★ …nor can an unsigned burn',
    await move({ state: fresh, next: fresh, isPublic: true, signer: null, burn: true, sweep: true }), false)
  check('★ the OWNER may burn it — even at phase 0, where an owned shell is unclaimed',
    await move({ state: fresh, next: fresh, isPublic: true, signer: KEY, burn: true, sweep: true }))
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('PUBLIC GATE: FAIL — do not build on it'); process.exit(1) }
console.log('PUBLIC GATE OK — driven by anyone, retired by one.')
