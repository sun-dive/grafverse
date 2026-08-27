// © 2026 sun-dive — Apache License 2.0.
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
  refTick, RACER_REGS as R, S, PHASE, type ShellState,
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

// ── ★★ AND THE OWNER CANNOT BE OVERWRITTEN ────────────────────────────────────────────────────────
// MEASURED, before the fix existed: a passer-by loaded THEIR OWN key as the driver of a public car,
// became its owner, and could then burn it and take the tank. Load, own, burn — the car was free to
// anybody who read the script.
//
// ★ The fix keeps the loadable's SLOT and changes only its transition to a phase that can never
// happen, so the layout, the depths and the unlocking script are all exactly as they were. One
// constant differs, and the value carried in the script survives every move.
{
  const fresh = freshPublicShell(OWNER)
  const THIEF_H = Hash.hash160(STRANGER.toPublicKey().encode(true) as number[])
  const proper = loadCar(fresh, { driver: OWNER, eng: 14, tyr: 10 }, R)
  const stolen = { ...proper, driver: THIEF_H }

  check('★★ a passer-by may NOT load their own key as the driver',
    await move({ state: fresh, next: stolen, isPublic: true, signer: null }), false)
  check('★ …nor may the owner change it, which is the same rule',
    await move({ state: fresh, next: stolen, isPublic: true, signer: KEY }), false)
  check('  configuring the car normally is untouched',
    await move({ state: fresh, next: proper, isPublic: true, signer: null }))

  // ⚠ and the OWNED variant must still be claimable, which is what makes claiming work at all
  const ownedClaim = loadCar(emptyShell(), { driver: THIEF_H, eng: 14, tyr: 10 }, R)
  check('★ an OWNED shell at phase 0 is still claimable by anyone — unchanged',
    await move({ state: emptyShell(), next: ownedClaim, isPublic: false, signer: null }))
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

/* ── ★★★ AND THE OTHER DOOR: A RUN-ENDING MOVE MUST NOT PAY ANYBODY EITHER ────────────────────────
   This is the one that was OPEN, and it is the reason this section exists at all.

   A move that ends a run relaxes the value floor to ONE SATOSHI so the tank is not stranded in a
   shell nobody can spend. The source says why that is safe — *"which only they can build, because
   only they can sign the move"* — and a PUBLIC car has no signature on a move at all. So the branch
   that hands an owner their own tank back handed a public car's tank to whoever wrecked it first.

     tap the pump · configure · track · arm     ~1,200 sat of fees, no key, no coin
     one tick at full throttle, eng 24 / tyr 1  the engine lets go — phase OUT
     sweep                                      ★ 39,999 of 40,000 sat, unsigned, to a stranger

   ⚠ IT FALSIFIED A MEASURED CLAIM. `depot-drain` reports "griefing, not theft — 0 to the attacker",
   which is true of TAPPING and was never driven through a run-ending move. A rule tested in one
   variant and asserted for both, for the third time in this project.

   ★★ THE PRINCIPLE IS THE BATTERY'S (sun-dive): the car IS a battery. A battery has exactly one
   branch — advance the state, pay the miner — and no output that can pay a person, which is why it
   needs no key and has nothing worth stealing. **The only output a public car may produce is a car
   running down a track spending satoshis.** Nothing is stranded by that: a public car RESETS from
   DONE and OUT, so a wrecked car's fuel is simply the next driver's. */
console.log()
{
  const FUEL = 40_000
  /* ⚠ A REAL WRECK, not a hand-written OUT state — the covenant would refuse anything else, and the
     check would then pass for the wrong reason. Full throttle on a big engine with no tyres. */
  const armed: ShellState = { ...freshPublicShell(OWNER), phase: PHASE.ARMED, eng: 24, tyr: 1,
    green: 1_700_000_000, gap: 1, finish: Math.round(402 * S), slip: 1000 }
  const w = refTick(armed, { throttle: R.THROTTLE_MAX, lockTime: 1_700_000_200, fuel: FUEL }, R)
  check('the fixture really does wreck the car on move one', w.ended === 'blown')

  /** An ending move that keeps `keep` satoshis in the car and pays the rest to `to`. */
  const ending = async (isPublic: boolean, keep: number, signer: PrivateKey | null): Promise<boolean> => {
    const lock = buildShellLock({ state: armed, maxFee: SHELL_MAX_FEE, public: isPublic })
    const src = new Transaction(); src.addOutput({ lockingScript: lock, satoshis: FUEL })
    const tx = new Transaction(); tx.version = 2
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
    tx.addOutput({ lockingScript: buildShellLock({ state: w.state, maxFee: SHELL_MAX_FEE, public: isPublic }),
                   satoshis: keep })
    tx.addOutput({ lockingScript: new P2PKH().lock(STRANGER.toAddress()), satoshis: FUEL - keep - 400 })
    tx.lockTime = 1_700_000_200
    const pre = TransactionSignature.format({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: FUEL, transactionVersion: 2,
      otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
      subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
    })
    let sig: number[] = [], pubKey: number[] = []
    if (signer) { const ch = (await new P2PKH().unlock(signer).sign(tx, 0)).chunks
                  sig = ch[0].data ?? []; pubKey = ch[1].data ?? [] }
    tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
      spenderOutputs: serializeOutput(tx.outputs[1].satoshis ?? 0, tx.outputs[1].lockingScript.toBinary()),
      newValue: u64(keep), preimage: pre, sig, pubKey, throttle: R.THROTTLE_MAX,
      load: { driver: w.state.driver, pool: w.state.pool, eng: w.state.eng, tyr: w.state.tyr,
              finish: w.state.finish, slip: w.state.slip, green: w.state.green, gap: w.state.gap },
    }))
    try {
      return new Spend({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: FUEL, lockingScript: lock,
        transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
        unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  }

  check('★★★ a STRANGER cannot sweep a wrecked PUBLIC car — unsigned, one satoshi kept',
    await ending(true, 1, null), false)
  check('★★ …nor with their own signature on it', await ending(true, 1, STRANGER), false)
  check('★★ …nor can the OWNER, through this branch — the burn is the owner\'s door, not this',
    await ending(true, 1, KEY), false)
  check('  …and an ordinary ending move, keeping the tank, is fine',
    await ending(true, FUEL - 400, null))

  /* ⚠ AND THE OWNED CAR MUST KEEP IT. Deleting a rule everywhere is not the fix — an owned car's
     driver signs every move, which is exactly what makes the relaxation safe there, and without it
     every owned race would strand its own tank. */
  check('★★ an OWNED car still recovers its tank on the ending move — signed by its driver',
    await ending(false, 1, KEY))
  check('  …and not by a stranger', await ending(false, 1, STRANGER), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('PUBLIC GATE: FAIL — do not build on it'); process.exit(1) }
console.log('PUBLIC GATE OK — driven by anyone, retired by one, and paying nobody.')
