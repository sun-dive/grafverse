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
} from '../src/shell.ts'
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
async function bytesOf(st: ShellState, next: ShellState, throttle: number, pot = false): Promise<number> {
  const prev = buildShellLock({ state: st, maxFee: SHELL_MAX_FEE })
  const src = new Transaction(); src.addOutput({ lockingScript: prev, satoshis: 60_000 })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  if (pot) tx.addInput({ sourceTransaction: POT, sourceOutputIndex: 0, sequence: 0xfffffffe,
                         unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: SHELL_MAX_FEE }), satoshis: 59_000 })
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
  for (const [eng, tyr, th, pot] of [
    [1, 1, 0, false], [1, RACER_REGS.TYR_MAX, 6, false],
    [RACER_REGS.ENG_MAX, RACER_REGS.TYR_MAX, 12, false],
    [RACER_REGS.ENG_MAX, RACER_REGS.TYR_MAX, 12, true],
  ] as const) {
    const st = racing(eng, tyr)
    const want = refTick(st, { throttle: th, lockTime: st.last + st.gap, fuel: 60_000 }, RACER_REGS)
    worst = Math.max(worst, await bytesOf(st, want.state, th, pot))
    biggest = Math.max(biggest, want.burn); smallest = Math.min(smallest, want.burn)
  }
  const trueFee = Math.ceil(worst * SHELL_FEE_PER_KB / 1000)
  console.log(`        worst move serializes to ${worst} bytes → ${trueFee} sat at ${SHELL_FEE_PER_KB} sat/KB`)
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
