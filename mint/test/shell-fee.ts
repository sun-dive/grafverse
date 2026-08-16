// © BSV Association — Open BSV License v6.
// MAX_FEE — MEASURED, and asserted against transactions that were actually serialized.
//
//   node --experimental-strip-types mint/test/shell-fee.ts
//
// ⚠ THIS IS THE TEST THE BATTERY DID NOT HAVE. Its first MAX_FEE was hand counted, undercounted the
// output script-length varint (a 1,4xx-byte script needs a 3-byte varint, not 1), and landed at 99.68
// sat/KB — under the relay floor, permanently, with no key anywhere able to amend it. Nothing about a
// covenant is more unfixable than its fee.
//
// Two separate rules are checked here and they are easily confused:
//
//   THE BURN IS THE MINING FEE.  Whatever the output holds less than the input is what the miner takes,
//                                so the SMALLEST burn must clear the relay floor or those moves are
//                                never mined at all.
//   MAX_FEE IS A CEILING.        The value rule `out ≥ V − MAX_FEE` must admit the LARGEST burn a legal
//                                car can produce, or that car cannot move.
import { Transaction, UnlockingScript, LockingScript, TransactionSignature, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  RACER_REGS, S, PHASE, SHELL_FEE_PER_KB, SHELL_FEE_SLACK, SHELL_MAX_FEE, shellMaxFee, type ShellState,
  SHELL_BURN_RATE_PER_KB, worstMoveBytes,
  type RacerRegs, SHELL_WORST_MOVE_BYTES, PUBLIC_CAR_REGS } from '../src/shell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

const KEY = PrivateKey.fromRandom()
const DRIVER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const POT = (() => { const t = new Transaction()
  t.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 9 }); return t })()
const POOL = [...Utils.toArray(POT.id('hex'), 'hex').slice().reverse(), 0, 0, 0, 0]
const GREEN = 1_700_000_000

/** ★ SERIALIZED. The number this test rests on is read off the wire, never counted. */
async function bytesOf(st: ShellState, next: ShellState, throttle: number, pot = false, isPublic = false,
                       regs: RacerRegs = RACER_REGS): Promise<number> {
  const prev = buildShellLock({ state: st, maxFee: SHELL_MAX_FEE, public: isPublic, regs })
  const src = new Transaction(); src.addOutput({ lockingScript: prev, satoshis: 60_000 })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  if (pot) tx.addInput({ sourceTransaction: POT, sourceOutputIndex: 0, sequence: 0xfffffffe,
                         unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: SHELL_MAX_FEE, public: isPublic, regs }), satoshis: 59_000 })
  tx.lockTime = Math.max(st.green, st.last + st.gap)
  const pre = TransactionSignature.format({ sourceTXID: src.id('hex'), sourceOutputIndex: 0,
    sourceSatoshis: 60_000, transactionVersion: 2, otherInputs: tx.inputs.slice(1), inputIndex: 0,
    outputs: tx.outputs, inputSequence: 0xfffffffe, subscript: prev, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  const c = (await new P2PKH().unlock(KEY).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(59_000), preimage: pre, sig: c[0].data ?? [], pubKey: c[1].data ?? [], throttle,
    load: { driver: next.driver, pool: next.pool, eng: next.eng, tyr: next.tyr,
            finish: next.finish, slip: next.slip, green: next.green, gap: next.gap } }))
  return tx.toHex().length / 2
}

const racing = (eng: number, tyr: number): ShellState => ({
  ...arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng, tyr }, RACER_REGS),
    { finish: 402 * S, slip: 1000, green: GREEN, gap: 1, pool: POOL })),
  phase: PHASE.RACING, last: GREEN, s: Math.round(50 * S), v: Math.round(2 * S), n: 20,
})

console.log('MAX_FEE — measured, not counted\n')

// ── the worst transaction any legal race can produce ─────────────────────────────────────────────────
let worst = 0, biggest = 0, smallest = Infinity
{
  /* ⚠ BOTH VARIANTS, AND THIS ONE ESCAPED. The sweep only ever built OWNED locks, so when the reset
     branch made the PUBLIC lock the bigger of the two — 1732 against 1674, and the lock is paid for
     TWICE in every move — the bound stopped covering the car it most needed to. Measured after the
     fact: a public tick paid 97.2 sat/KB against a 100 floor, unmineable, and every test was green.
     BURN0 is permanent and there is no key to amend it, so the bound must be the worst move ANY legal
     car can produce, not the worst move the variant we happened to measure produces. */
  /* ⚠⚠ AND THE REGULATIONS ARE A DIMENSION TOO — this escaped a SECOND time, the same way. `bytesOf`
     took `isPublic` but not `regs`, so when `RESERVE` added 24 bytes to the lock — 48 to every move,
     because the lock is paid for twice — the sweep went on measuring the variant WITHOUT it and
     reported healthy headroom for a car that no longer existed.
     ⇒ A bound must cover the worst move ANY LEGAL VARIANT produces. `isPublic` was the first axis;
     the regs are the second.
     ⚠ AND EVERY NEW AXIS IS A NEW WAY FOR THIS SWEEP TO BE MEASURING THE WRONG CAR. There is one
     regulation axis today; add another and it belongs in this list on the same commit, combined with
     the ones already here rather than swept alone — the worst car is the one carrying EVERYTHING. */
  const VARIANTS: Array<{ label: string; regs: RacerRegs }> = [
    { label: 'v2', regs: RACER_REGS },
    { label: 'v3 reserve', regs: PUBLIC_CAR_REGS },
  ]
  const byVariant = new Map<string, number>()
  for (const { label, regs } of VARIANTS) {
   for (const isPublic of [false, true]) {
    for (const [eng, tyr, th, pot] of [
     [1, 1, 0, false], [1, RACER_REGS.TYR_MAX, 6, false],
     [RACER_REGS.ENG_MAX, RACER_REGS.TYR_MAX, 12, false],
     [RACER_REGS.ENG_MAX, RACER_REGS.TYR_MAX, 12, true],
    ] as const) {
     const st = racing(eng, tyr)
     const want = refTick(st, { throttle: th, lockTime: st.last + st.gap, fuel: 60_000 }, regs)
     const b = await bytesOf(st, want.state, th, pot, isPublic, regs)
     byVariant.set(label, Math.max(byVariant.get(label) ?? 0, b))
     if (label === 'v2') {
       worst = Math.max(worst, b)
       biggest = Math.max(biggest, want.burn); smallest = Math.min(smallest, want.burn)
     }
    }
   }
  }
  /* ★★ EVERY VARIANT MUST CLEAR THE FLOOR ON ITS OWN BURN0 — the rule, stated once and applied to all.
     A variant whose script grew but whose BURN0 did not is a car that cannot be mined, and it looks
     exactly like a healthy one until a node refuses it.

     ⚠⚠ AND CLEARING THE FLOOR IS NOT ENOUGH, WHICH COST A REAL SCARE. `PIT`'s byte constant was first
     ESTIMATED at 42 when the truth was 54. The variant then measured 100.0 sat/KB — over the floor by
     five hundredths, PASSING, one byte of drift from being refused by every node forever. A bound that
     only just holds is indistinguishable from one that has already broken.

     ⇒ Two checks instead of one, and the second is the real invariant:
       1. the rate clears SHELL_BURN_RATE_PER_KB — the rate BURN0 is DERIVED at, not the bare floor
       2. the variant's measured worst move fits inside the byte bound its BURN0 was derived FROM
     The second cannot be satisfied by rounding: it compares the script to the constant that prices it. */
  for (const { label, regs } of VARIANTS) {
    const b = byVariant.get(label)!
    const rate = regs.BURN0 * 1000 / b
    const bound = worstMoveBytes(regs)
    check(`★★ ${label}: its cheapest move clears the rate BURN0 is derived at`,
      rate >= SHELL_BURN_RATE_PER_KB)
    check(`  …and its worst move fits the bound that BURN0 was derived FROM`, b <= bound)
    console.log(`        ${label.padEnd(11)} ${b} B of ${bound} · BURN0 ${regs.BURN0} = ` +
      `${rate.toFixed(2)} sat/KB`)
  }
  const trueFee = Math.ceil(worst * SHELL_FEE_PER_KB / 1000)
  console.log(`        worst move serializes to ${worst} bytes → ${trueFee} sat at ${SHELL_FEE_PER_KB} sat/KB`)

  /* ★ AND THE SOURCE MUST AGREE WITH THE SCALES. BURN0 is derived from SHELL_WORST_MOVE_BYTES, so that
     figure is not documentation — it sets what every move pays. If the script grows and the constant
     stays behind, every race quietly underpays and the moves stop being mined, exactly as they did at
     BURN0 = 40. Measuring it here and not comparing it would be measuring for the sake of the log. */
  /* ⚠ A BOUND, NOT AN EQUALITY. DER signatures are 70–73 bytes depending on whether r and s need a
     leading zero, so this measurement moves by a byte between runs. Demanding equality made the suite
     oscillate between 3,738 and 3,739, each run "correcting" the last. What actually matters is that
     the real thing never EXCEEDS what BURN0 was derived from — and that the bound has not rotted so
     far above reality that races are quietly overpaying. */
  const HEADROOM = 16
  check('★ the worst move stays within what BURN0 is derived from', worst <= SHELL_WORST_MOVE_BYTES)
  check('  …and the bound has not drifted far above it', worst > SHELL_WORST_MOVE_BYTES - HEADROOM)
  console.log(`        measured ${worst} B · bound ${SHELL_WORST_MOVE_BYTES} B` +
    (worst <= SHELL_WORST_MOVE_BYTES ? ` · ${SHELL_WORST_MOVE_BYTES - worst} B of headroom`
                                     : `  ⇒ RAISE SHELL_WORST_MOVE_BYTES TO ${worst + 2}`))
  console.log(`        burns range ${smallest} … ${biggest} sat`)

  // ★ RULE ONE: the smallest burn must clear the relay floor, or those moves never get mined.
  check('★ the SMALLEST burn covers the mining fee', smallest >= trueFee)
  console.log(`        ${smallest} sat over ${worst} B = ${(smallest * 1000 / worst).toFixed(1)} sat/KB ` +
    `(floor ${SHELL_FEE_PER_KB})`)

  // ★ RULE TWO: the ceiling must admit the largest burn, or the biggest engine cannot move at all.
  check('★ MAX_FEE admits the LARGEST burn', SHELL_MAX_FEE >= biggest)
  check('  …with the LOW_S slack on top', SHELL_MAX_FEE - biggest >= SHELL_FEE_SLACK)
  console.log(`        MAX_FEE ${SHELL_MAX_FEE} = largest burn ${biggest} + ${SHELL_MAX_FEE - biggest} slack`)
}

// ── it is DERIVED, so a bench session cannot leave it behind ─────────────────────────────────────────
{
  check('MAX_FEE is computed from the regulations', SHELL_MAX_FEE === shellMaxFee(RACER_REGS))
  const thirstier = { ...RACER_REGS, BURN_E: RACER_REGS.BURN_E * 2 }
  check('★ raising BURN_E raises it automatically', shellMaxFee(thirstier) > SHELL_MAX_FEE)
  console.log(`        double the thirst and MAX_FEE follows: ${SHELL_MAX_FEE} → ${shellMaxFee(thirstier)}`)
}

// ── and the push does not change width, so the two-pass build is stable ──────────────────────────────
// The battery's lesson twice over: the offset push must be the same size whether probing or final, or
// the varint sizing the scriptCode moves under it.
{
  const a = buildShellLock({ state: racing(8, 8), maxFee: SHELL_MAX_FEE }).toBinary().length
  const b = buildShellLock({ state: racing(8, 8), maxFee: SHELL_MAX_FEE + 1000 }).toBinary().length
  check('a bigger MAX_FEE does not change the script length', a === b)
  console.log(`        both ${a} bytes — any value under 32,768 pushes in two`)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL FEE: FAIL — do not mint'); process.exit(1) }
console.log('SHELL FEE OK — the fee was measured, and it clears the floor at both ends.')
