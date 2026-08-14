// © BSV Association — Open BSV License v6.
// LOADING — a whole race from an EMPTY shell, every move through the real interpreter.
//
//   node --experimental-strip-types mint/test/shell-load.ts
//
// This test exists because the frame test could not have caught what it caught. The frame only ever
// advanced the PHASE, so it proved the sequence and read as though it proved loading — while nothing
// in the script wrote eng, tyr, finish, slip, green, gap or pool at all. A covenant that enforces a
// sequence with nothing flowing into it is a turnstile, not a machine.
//
// Found by trying to run one complete race and failing on transaction one.
import { Transaction, Spend, UnlockingScript, LockingScript, TransactionSignature, PrivateKey, P2PKH, Hash, Utils } from '@bsv/sdk'
import {
  emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps, SHELL_SCOPE,
  RACER_REGS, S, PHASE, PHASE_NAMES, stateFits, SHELL_MAX_FEE_PROVISIONAL as MAXFEE, type ShellState,
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
const GREEN = 1_700_000_000, GAP = 1, FIN = 402, TANK = 40_000
const POT = (() => { const t = new Transaction()
  t.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 20_000 }); return t })()
const POOL = [...Utils.toArray(POT.id('hex'), 'hex').slice().reverse(), 0, 0, 0, 0]

async function move(state: ShellState, next: ShellState, o: {
  fuel: number; out: number; at: number; throttle?: number; pot?: boolean
  load?: Record<string, number | number[]>; signer?: PrivateKey | null
}): Promise<{ ok: boolean; why?: string; bytes: number }> {
  const prev = buildShellLock({ state, maxFee: MAXFEE })
  const src = new Transaction(); src.addOutput({ lockingScript: prev, satoshis: o.fuel })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  if (o.pot) tx.addInput({ sourceTransaction: POT, sourceOutputIndex: 0, sequence: 0xfffffffe,
                           unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: MAXFEE }), satoshis: o.out })
  tx.lockTime = o.at
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.fuel, transactionVersion: 2,
    otherInputs: tx.inputs.slice(1), inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: prev, lockTime: tx.lockTime, scope: SHELL_SCOPE })
  const signer = o.signer === undefined ? KEY : o.signer
  let sig: number[] = [], pubKey: number[] = []
  if (signer != null) { const c = (await new P2PKH().unlock(signer).sign(tx, 0)).chunks
                        sig = c[0].data ?? []; pubKey = c[1].data ?? [] }
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(1).flatMap(x => serializeOutput(x.satoshis ?? 0, x.lockingScript.toBinary())),
    newValue: u64(o.out), preimage: pre, sig, pubKey, throttle: o.throttle ?? 0, load: o.load }))
  const bytes = tx.toHex().length / 2
  try {
    return { ok: new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: o.fuel, lockingScript: prev,
      transactionVersion: 2, otherInputs: tx.inputs.slice(1), outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true, bytes }
  } catch (e) { return { ok: false, why: (e as Error).message.split('\n')[0], bytes } }
}

const CAR = { driver: DRIVER, eng: 16, tyr: 10 }
const TRACK = { finish: FIN * S, slip: 1000, green: GREEN, gap: GAP, pool: POOL }

console.log('LOADING — a whole race, from an empty shell\n')

// ── the three loading transitions ────────────────────────────────────────────────────────────────────
let st = emptyShell()
{
  const withCar = loadCar(st, CAR, RACER_REGS)
  const r1 = await move(st, withCar, { fuel: TANK, out: TANK, at: 0, signer: null, load: CAR })
  check('★ EMPTY → CAR · the engine, tyres and driver are WRITTEN, not merely allowed', r1.ok)
  if (!r1.ok) console.log('   ↳', r1.why)
  st = withCar

  const withTrack = loadTrack(st, TRACK)
  const r2 = await move(st, withTrack, { fuel: TANK, out: TANK, at: 0, load: TRACK })
  check('★ CAR → TRACK · the strip, surface, tree and POT are written', r2.ok)
  if (!r2.ok) console.log('   ↳', r2.why)
  st = withTrack

  const armed = arm(st)
  const r3 = await move(st, armed, { fuel: TANK, out: TANK, at: 0 })
  check('TRACK → ARMED · fuelling loads nothing, and freezes everything', r3.ok)
  st = armed
  console.log(`        ${r1.bytes} + ${r2.bytes} + ${r3.bytes} bytes to build a car`)
}

// ── and the regulations are enforced AT THE MOMENT OF LOADING ────────────────────────────────────────
{
  const empty = emptyShell()
  const bad = async (car: Record<string, number | number[]>, claim: Partial<ShellState>) =>
    (await move(empty, { ...empty, phase: PHASE.CAR, driver: DRIVER, eng: 1, tyr: 1, ...claim } as ShellState,
      { fuel: TANK, out: TANK, at: 0, signer: null, load: car })).ok

  check('★ an engine over ENG_MAX cannot be loaded AT ALL',
    await bad({ ...CAR, eng: RACER_REGS.ENG_MAX + 1 }, { eng: RACER_REGS.ENG_MAX + 1 }), false)
  check('★ tyres over TYR_MAX cannot be loaded',
    await bad({ ...CAR, tyr: RACER_REGS.TYR_MAX + 1 }, { tyr: RACER_REGS.TYR_MAX + 1 }), false)
  check('★ an engine of zero cannot be loaded', await bad({ ...CAR, eng: 0 }, { eng: 0 }), false)
  check('a driver hash of the wrong length is refused',
    await bad({ ...CAR, driver: new Array(19).fill(3) }, { driver: new Array(19).fill(3) }), false)
  console.log('        ⇒ the shell\'s constants ARE the racing regulations, enforced on the way in')
}

// ── nothing may be re-loaded once it is in ───────────────────────────────────────────────────────────
{
  const armed = st
  const r = await move(armed, { ...armed, phase: PHASE.RACING, eng: 2 } as ShellState,
    { fuel: TANK, out: TANK, at: GREEN, throttle: 0, load: { ...CAR, eng: 2 } })
  check('★ a smaller engine cannot be slipped in once the shell is ARMED', r.ok, false)
}

// ── THE WHOLE RACE ───────────────────────────────────────────────────────────────────────────────────
{
  const safe = (s: ShellState, fuel: number): number => {
    let lo = 0, hi = RACER_REGS.THROTTLE_MAX, best = 0
    while (lo <= hi) { const m = (lo + hi) >> 1; let r
      try { r = refTick(s, { throttle: m, lockTime: Math.max(s.green, s.last + s.gap), fuel }, RACER_REGS) }
      catch { break }
      if (r.spun || r.ended) hi = m - 1; else { best = m; lo = m + 1 } }
    return best
  }
  let fuel = TANK, txs = 3, bytes = 0, rejected = ''
  while (st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && fuel > RACER_REGS.BURN0 && st.n < 900) {
    const th = safe(st, fuel), at = Math.max(st.green, st.last + st.gap)
    const want = refTick(st, { throttle: th, lockTime: at, fuel }, RACER_REGS)
    const r = await move(st, want.state, { fuel, out: fuel - want.burn, at, throttle: th,
                                           pot: want.state.phase === PHASE.DONE })
    txs++; bytes += r.bytes
    if (!r.ok) { rejected = `move ${st.n + 1}: ${r.why}`; break }
    st = want.state; fuel -= want.burn
  }
  check('★ EVERY MOVE OF A WHOLE RACE WAS ACCEPTED BY THE INTERPRETER', rejected === '')
  if (rejected !== '') console.log('   ↳', rejected)
  check('and the car crossed the line', st.phase === PHASE.DONE)
  console.log(`        ${st.n} moves = ${(st.n * 0.1).toFixed(2)} s · ${txs} transactions · ` +
    `${(bytes / 1024).toFixed(1)} KB · ${(TANK - fuel).toLocaleString()} sat`)
  console.log(`        the covenant is ${buildShellLock({ state: st, maxFee: MAXFEE }).toBinary().length} bytes`)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL LOAD: FAIL'); process.exit(1) }
console.log('SHELL LOAD OK — the shell is loaded, and a whole race runs on chain rules.')
