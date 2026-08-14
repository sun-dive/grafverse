// © BSV Association — Open BSV License v6.
// THE PHYSICS, IN SCRIPT — does the covenant compute what the reference computes?
//
//   node --experimental-strip-types mint/test/shell-physics.ts
//
// Not "does it validate" but "does it agree". The covenant is fed a state and a throttle, and the
// output it will accept is the one `refTick` produced — so a script that is merely self-consistent
// fails here. Every case runs through `Spend`, the interpreter a node uses.
import { Transaction, Spend, UnlockingScript, LockingScript, TransactionSignature, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  RACER_REGS, S, PHASE, stateFits, type ShellState,
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

/* THE POT. A real output, whose outpoint is baked into every racing fixture — because from here on a
   car cannot cross the line without spending it in the same transaction. An outpoint serializes as the
   txid in LITTLE-ENDIAN followed by a 4-byte index, which is also how the preimage carries it. */
const POOL_TX = (() => { const t = new Transaction(); t.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 25_000 }); return t })()
const POOL_VOUT = 0
const POOL_OUTPOINT = [
  ...[...Utils.toArray(POOL_TX.id('hex'), 'hex')].reverse(),
  POOL_VOUT & 255, (POOL_VOUT >> 8) & 255, (POOL_VOUT >> 16) & 255, (POOL_VOUT >> 24) & 255,
]

const KEY = PrivateKey.fromRandom()
const DRIVER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const GREEN = 1_700_000_000, GAP = 1, FUEL = 40_000

/** Offer the covenant `next` as the result of applying `throttle` to `state`. */
async function offer(state: ShellState, next: ShellState, throttle: number, at: number,
                     fuel = FUEL, withPot = next.phase === PHASE.DONE,
                     out?: number): Promise<{ ok: boolean; why?: string }> {
  const outValue = out ?? fuel
  const prev = buildShellLock({ state })
  const src = new Transaction(); src.addOutput({ lockingScript: prev, satoshis: fuel })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  /* ★ THE POT, IN THE SAME TRANSACTION. The covenant computes what hashPrevouts must be for a spend of
     exactly these two outpoints and refuses anything else — so winning and being paid are one act. */
  if (withPot) tx.addInput({ sourceTransaction: POOL_TX, sourceOutputIndex: POOL_VOUT, sequence: 0xfffffffe,
                             unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ lockingScript: buildShellLock({ state: next }), satoshis: outValue })
  // whatever the record does not keep goes to the driver, in this same transaction
  if (outValue < fuel) tx.addOutput({ lockingScript: new P2PKH().lock(KEY.toAddress()), satoshis: fuel - outValue })
  tx.lockTime = at
  const preimage = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: fuel,
    transactionVersion: tx.version, otherInputs: tx.inputs.slice(1), inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: prev, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const chunks = (await new P2PKH().unlock(KEY).sign(tx, 0)).chunks
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64le(outValue), preimage, sig: chunks[0].data ?? [], pubKey: chunks[1].data ?? [], throttle,
  }))
  try {
    return { ok: new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: fuel, lockingScript: prev,
      transactionVersion: tx.version, otherInputs: tx.inputs.slice(1), outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0] } }
}

const racing = (eng: number, tyr: number, slip: number, v: number, s: number, n: number): ShellState => ({
  ...arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng, tyr }, RACER_REGS),
    { finish: 5_000 * S, slip, green: GREEN, gap: GAP, pool: POOL_OUTPOINT })),
  phase: PHASE.RACING, last: GREEN, s, v, n,
})

console.log('THE PHYSICS IN SCRIPT — measured against the reference, not against itself\n')

/* ⚠ THE FIXTURE MUST FIT ITS FIELDS, and this test learned that the hard way. It first used a finish
   of 100,000 units against a six-byte field that holds 32,768 — so fixedField truncated it SILENTLY,
   every one of the 374 cases failed, and the script looked wrong when the test was. stateFits exists
   for exactly this and was written this morning; not using it here was the whole bug. */
{
  const bad = stateFits(racing(20, 10, 1800, Math.round(3 * S), Math.round(50 * S), 12))
  check('the fixture fits its fields', bad === null)
  if (bad !== null) console.log(`        '${bad}' does not fit — every case below is meaningless`)
}

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
            else if (firstBad === '') firstBad = `eng ${eng} tyr ${tyr} slip ${slip} th ${th} v ${(v/S).toFixed(2)} — ${r.why}\n        want phase ${want.state.phase} s ${(want.state.s/S).toFixed(3)} v ${(want.state.v/S).toFixed(4)} n ${want.state.n} · spun ${want.spun}`
          }
        }
      }
    }
  }
  check(`★ the script agrees with the reference on all ${tried} cases`, agreed === tried)
  if (agreed !== tried) console.log(`        ${agreed}/${tried} · first disagreement: ${firstBad}`)
}
// ── THE TERMINAL BRANCHES ────────────────────────────────────────────────────────────────────────────
// The 374 above deliberately SKIP every case that ends a run, because those are the ones where the
// script and the reference could most easily agree on a number while disagreeing on an outcome.
{
  let off = 0, blown = 0, home = 0, agreed = 0, tried = 0, firstBad = ''
  for (const eng of [4, 12, 20]) {
    for (const tyr of [2, 6, 10]) {
      for (const th of [0, 6, 13, RACER_REGS.BLOW_T, RACER_REGS.THROTTLE_MAX]) {
        for (const v of [0, Math.round(0.5 * S), Math.round(4 * S)]) {
          // a strip short enough that a good run crosses it, so DONE is reachable too
          const st = { ...racing(eng, tyr, 1000, v, Math.round(30 * S), 7), finish: Math.round(34 * S) }
          const want = refTick(st, { throttle: th, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
          if (want.ended == null && want.state.phase !== PHASE.DONE) continue
          tried++
          if (want.ended === 'off') off++
          else if (want.ended === 'blown') blown++
          else home++
          const r = await offer(st, want.state, th, GREEN + GAP)
          if (r.ok) agreed++
          else if (firstBad === '') firstBad = `eng ${eng} tyr ${tyr} th ${th} v ${(v/S).toFixed(2)} → ${want.ended ?? 'DONE'} · ${r.why}`
        }
      }
    }
  }
  check(`★ every run-ending case agrees — ${tried} of them`, agreed === tried)
  if (agreed !== tried) console.log(`        ${agreed}/${tried} · ${firstBad}`)
  console.log(`        ${off} off the track · ${blown} engines let go · ${home} crossed the line`)

  // ★ And the branches must be REACHED, not merely present. A test that exercised none of them would
  // pass silently while the script did nothing at all.
  check('the wall is reachable', off > 0)
  check('the engine failure is reachable', blown > 0)
  check('the finish line is reachable', home > 0)
}

// ── and a run that ends cannot be argued with ────────────────────────────────────────────────────────
{
  const st = { ...racing(20, 2, 1000, Math.round(4 * S), Math.round(30 * S), 7), finish: Math.round(34 * S) }
  const want = refTick(st, { throttle: RACER_REGS.THROTTLE_MAX, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
  check('this fixture really does end the run', want.ended != null)
  // offering RACING instead of OUT is the obvious cheat: pretend nothing happened and drive on
  const pretend = { ...want.state, phase: PHASE.RACING as ShellState['phase'] }
  check('★ a car that went out cannot pretend it is still racing',
    (await offer(st, pretend, RACER_REGS.THROTTLE_MAX, GREEN + GAP)).ok, false)
}

// ── ★ YOU CANNOT CROSS THE LINE WITHOUT THE POT ──────────────────────────────────────────────────────
// The finish line is not a signal about the money, it IS the money. hashPrevouts is a hash over every
// input's outpoint, so the covenant computes what it must be for a spend of exactly two things — this
// shell and the pool it was told about at load time — and refuses anything else.
{
  const st = { ...racing(16, 9, 1000, Math.round(3 * S), Math.round(30 * S), 7), finish: Math.round(31 * S) }
  const want = refTick(st, { throttle: 8, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
  check('this fixture really does cross the line', want.state.phase === PHASE.DONE && want.ended == null)

  check('★ crossing WITH the pot is accepted',
    (await offer(st, want.state, 8, GREEN + GAP, FUEL, true)).ok)
  check('★ crossing WITHOUT it is refused — no pot, no finish',
    (await offer(st, want.state, 8, GREEN + GAP, FUEL, false)).ok, false)

  // …and the pot named at load time is the only one that will do.
  /* ⚠ A DIFFERENT VALUE, or it is not a different pot. Built exactly like the real one — same script,
     same amount, no inputs — it serializes identically and therefore has the SAME txid, so the test
     passed while comparing a thing to itself. */
  const decoy = new Transaction()
  decoy.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 25_001 })
  const wrong = { ...st, pool: [...[...Utils.toArray(decoy.id('hex'), 'hex')].reverse(), 0, 0, 0, 0] }
  const wantW = refTick(wrong, { throttle: 8, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
  check('★ and a DIFFERENT pot is refused — the race names its own',
    (await offer(wrong, wantW.state, 8, GREEN + GAP, FUEL, true)).ok, false)

  // A move that does NOT finish must not demand the pot, or every tick would need it.
  const mid = { ...racing(16, 9, 1000, Math.round(1 * S), Math.round(5 * S), 7), finish: Math.round(500 * S) }
  const wantM = refTick(mid, { throttle: 8, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
  check('an ordinary move needs no pot at all',
    (await offer(mid, wantM.state, 8, GREEN + GAP, FUEL, false)).ok)
}

// ── ★ THE MOVE THAT ENDS THE RUN RECOVERS THE TANK ───────────────────────────────────────────────────
// Otherwise every race strands its own fuel: a car that goes off at move five leaves the whole tank in
// an output nobody can ever spend. The final move drops the value floor to ONE satoshi, so the driver
// takes the rest in that same transaction — and one satoshi stays behind holding the final state,
// unspendable forever. The chain of moves that led to it was always the real record.
{
  const st = { ...racing(20, 2, 1000, Math.round(4 * S), Math.round(30 * S), 7), finish: Math.round(300 * S) }
  const want = refTick(st, { throttle: RACER_REGS.THROTTLE_MAX, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
  check('this fixture wrecks the car', want.ended != null)

  check('★ the ending move may keep just ONE satoshi — the rest goes to the driver',
    (await offer(st, want.state, RACER_REGS.THROTTLE_MAX, GREEN + GAP, FUEL, false, 1)).ok)
  check('  …and the record output cannot be emptied entirely',
    (await offer(st, want.state, RACER_REGS.THROTTLE_MAX, GREEN + GAP, FUEL, false, 0)).ok, false)

  // ⚠ and an ORDINARY move may not do it — that would be quitting with the money mid-race
  const mid = { ...racing(16, 9, 1000, Math.round(1 * S), Math.round(5 * S), 7), finish: Math.round(900 * S) }
  const wantM = refTick(mid, { throttle: 8, lockTime: GREEN + GAP, fuel: FUEL }, RACER_REGS)
  check('★ a car still RACING cannot strip its own tank', wantM.ended === null &&
    !(await offer(mid, wantM.state, 8, GREEN + GAP, FUEL, false, 1)).ok)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL PHYSICS: FAIL'); process.exit(1) }
console.log('SHELL PHYSICS OK — the covenant computes what the reference computes.')
