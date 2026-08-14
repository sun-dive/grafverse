// © BSV Association — Open BSV License v6.
// THE PHYSICS, IN SCRIPT — does the covenant compute what the reference computes?
//
//   node --experimental-strip-types mint/test/shell-physics.ts
//
// Not "does it validate" but "does it agree". The covenant is fed a state and a throttle, and the
// output it will accept is the one `refTick` produced — so a script that is merely self-consistent
// fails here. Every case runs through `Spend`, the interpreter a node uses.
import { Transaction, Spend, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  RACER_REGS, S, PHASE, type ShellState,
} from '../src/shell.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const u64le = (n: number): number[] => {
  const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}

const KEY = PrivateKey.fromRandom()
const DRIVER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const GREEN = 1_700_000_000, GAP = 1, FUEL = 40_000

/** Offer the covenant `next` as the result of applying `throttle` to `state`. */
async function offer(state: ShellState, next: ShellState, throttle: number, at: number,
                     fuel = FUEL): Promise<{ ok: boolean; why?: string }> {
  const prev = buildShellLock({ state })
  const src = new Transaction(); src.addOutput({ lockingScript: prev, satoshis: fuel })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: next }), satoshis: fuel })
  tx.lockTime = at
  const preimage = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: fuel,
    transactionVersion: tx.version, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: prev, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const chunks = (await new P2PKH().unlock(KEY).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64le(fuel), preimage, sig: chunks[0].data ?? [], pubKey: chunks[1].data ?? [], throttle,
  }))
  try {
    return { ok: new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: fuel, lockingScript: prev,
      transactionVersion: tx.version, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0] } }
}

const racing = (eng: number, tyr: number, slip: number, v: number, s: number, n: number): ShellState => ({
  ...arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng, tyr }, RACER_REGS),
    { finish: 100_000 * S, slip, green: GREEN, gap: GAP })),
  phase: PHASE.RACING, last: GREEN, s, v, n,
})

console.log('THE PHYSICS IN SCRIPT — measured against the reference, not against itself\n')

// ── the covenant agrees with refTick, across the space ───────────────────────────────────────────────
{
  let agreed = 0, tried = 0, firstBad = ''
  for (const eng of [2, 8, 14, 20]) {
    for (const tyr of [2, 6, 10]) {
      for (const slip of [600, 1000, 1800]) {
        for (const th of [0, 1, 7, 13]) {
          for (const v of [0, Math.round(0.4 * S), Math.round(3 * S)]) {
            const st = racing(eng, tyr, slip, v, Math.round(50 * S), 12)
            const want = refTick(st, { throttle: th, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
            if (want.ended != null) continue          // terminal branches are step 4b
            tried++
            const r = await offer(st, want.state, th, GREEN + GAP)
            if (r.ok) agreed++
            else if (firstBad === '') firstBad = `eng ${eng} tyr ${tyr} slip ${slip} th ${th} v ${(v/S).toFixed(2)} — ${r.why}`
          }
        }
      }
    }
  }
  check(`★ the script agrees with the reference on all ${tried} cases`, agreed === tried)
  if (agreed !== tried) console.log(`        ${agreed}/${tried} · first disagreement: ${firstBad}`)
}
console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL PHYSICS: FAIL'); process.exit(1) }
console.log('SHELL PHYSICS OK — the covenant computes what the reference computes.')
