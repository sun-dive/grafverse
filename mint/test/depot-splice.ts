// © BSV Association — Open BSV License v6.
//
// ★★★ RECOGNISING A CAR THAT HAS NO SHAPE — and the attack the depot's own comment warns about.
//
//   node --experimental-strip-types mint/test/depot-splice.ts
//
// A one-race car's script IS the race, so its length is its time and no two are alike. There is
// nothing constant to pin but the ENDING — the value rule and the binding to this depot. That is all
// the depot ever needed, because its only question is "will these sats come back to me?".
//
// ⚠⚠ BUT `carRecognitionOps` PINS THE CHAINED CAR'S HEAD FOR A REASON, and it says so: free bytes
// before the tail are EXECUTABLE positions, and a spliced `OP_0 OP_IF` swallows the covenant's own
// checks up to a matching `OP_ENDIF`. *"Without this the depot is not a tank but a faucet."*
//
// ⇒ So this file does not argue that tail-only recognition is safe. It ATTACKS it: the splice, an
// oversized car, a lied-about length, a truncated tail, and a car that pays somebody else. The same
// standard `depot-drain` set — measure the threat, do not reason about it.
import { LockingScript, UnlockingScript, Spend, OP, PrivateKey, Hash } from '@bsv/sdk'
import { carTailRecognitionOps, varint } from '../src/depot.ts'
import { carTail, buildRacerCar, racerCarFee, CONTROL_FLOW } from '../src/racerCar.ts'
import { type TickTrace, type RunTrace } from '../src/racerTick.ts'
import { RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick, buildShellLock, shellMaxFee, PUBLIC_CAR_REGS } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { buildDepotLock } from '../src/depot.ts'
import { op, PN } from '../src/covenantAsm.ts'
import { pushData } from '../src/pushtx.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

/** ★ The bound is CHOSEN, not measured — see `carTailRecognitionOps`. 67 ticks, 6.7 s. */
const MAX_CAR_BYTES = 16_000

const ENG = 14, TYR = 10, SLIP = 1000, TANK = 40000
const PHYS: Record<string, number> = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}
const ST0: Record<string, unknown> = {
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: ENG, tyr: TYR, finish: 0, slip: SLIP, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
}

function simulateTo(finish: number): RunTrace {
  let st = { ...ST0, finish } as Record<string, number>
  let fuel = TANK
  const ticks: TickTrace[] = []
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle: 8, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle: 8, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (st.phase === PHASE.DONE) break
  }
  return { ticks, ending: 'finish' }
}

const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const OLD = buildShellLock({ state: freshPublicShell(OWNER), maxFee: shellMaxFee(PUBLIC_CAR_REGS), public: true, regs: PUBLIC_CAR_REGS })
const DEPOT = buildDepotLock({ carScript: OLD.toBinary(), owner: OWNER }).toBinary()

/** Build a real car for a given track length. */
function car(metres: number): { script: number[]; fee: number } {
  const finish = Math.round(metres * S)
  const run = simulateTo(finish)
  const cfg = { name: 'SUN-DIVE', fuel: TANK, eng: ENG, tyr: TYR, slip: SLIP, finish }
  const fee = racerCarFee({ cfg, run, depotScript: DEPOT, consts: PHYS }).fee
  return { script: buildRacerCar({ cfg, run, depotScript: DEPOT, consts: PHYS, fee }).toBinary(), fee }
}

const SHORT = car(4), LONG = car(220)
const TAIL = new LockingScript(carTail({ fee: SHORT.fee, depotScript: DEPOT })).toBinary()

console.log('RECOGNISING A CAR BY ITS ENDING — and trying to get past it\n')
console.log(`        tail ${TAIL.length} B · MAX_CAR_BYTES ${MAX_CAR_BYTES.toLocaleString()}`)
console.log(`        short car ${SHORT.script.length.toLocaleString()} B · long car ${LONG.script.length.toLocaleString()} B\n`)

/** Serialize an output and run it through the recognition ops alone. */
function recognises(value: number, script: number[], tail = TAIL, cap = MAX_CAR_BYTES): boolean {
  const out = [...u64(value), ...varint(script.length), ...script]
  const lock = new LockingScript([
    ...carTailRecognitionOps(tail, cap),
    /* the ops leave the value on the ALTSTACK; bring it back so the script ends truthy */
    op(OP.OP_FROMALTSTACK), PN(0), op(OP.OP_GREATERTHAN),
  ])
  const spend = new Spend({
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
    lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
    unlockingScript: new UnlockingScript([pushData(out)]),
    inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}
function u64(n: number): number[] {
  const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}

/* ── ★★★ IT RECOGNISES CARS OF ANY LENGTH ───────────────────────────────────────────────────────── */
check('★★★ a short car is recognised', recognises(5000, SHORT.script))
{
  const longTail = new LockingScript(carTail({ fee: LONG.fee, depotScript: DEPOT })).toBinary()
  check(`★★★ a car ${(LONG.script.length / SHORT.script.length).toFixed(1)}x longer is recognised by the SAME rule`,
    recognises(5000, LONG.script, longTail))
  console.log('        ⇒ that is the whole point: one comparison, any length')
}

/* ── ⚠⚠ THE SPLICE — the attack `carRecognitionOps` exists to stop ───────────────────────────────
   Free bytes before the tail are executable. If a spliced branch can swallow the car's own checks,
   the depot is funding a script somebody else can spend. */
{
  const splice = (extra: number[]): number[] => [...extra, ...SHORT.script]
  check('★★★ an unbalanced OP_0 OP_IF spliced in front is REFUSED BY THE NETWORK, not by us',
    (() => {
      const lock = new LockingScript(LockingScript.fromBinary(splice([OP.OP_0, OP.OP_IF])).chunks)
      const sp = new Spend({
        sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
        lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
        unlockingScript: new UnlockingScript([]), inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
      })
      try { return sp.validate() } catch { return false }
    })(), false)

  /* ⚠ AND IT STILL PASSES RECOGNITION — which is the honest result, and why the property that saves
     us is the CAR'S, not the depot's. The depot funds it; the script is then unspendable by anyone,
     so the satoshis burn. Burn, never theft — the same conclusion `depot-drain` reached. */
  check('⚠ …though the depot WOULD fund it: recognition sees an ending, not a program',
    recognises(5000, splice([OP.OP_0, OP.OP_IF])))
  console.log('        ⇒ the spliced car is unspendable BY ANYONE, so the satoshis burn to miners')
  console.log('          — that is the depot-drain conclusion again: empty the tank, take nothing')

  check('★★★ a car carries no OP_ENDIF to close a spliced OP_IF against',
    CONTROL_FLOW.every(c => LockingScript.fromBinary(SHORT.script).chunks.filter(x => x.op === c).length === 0))
}

/* ── ⚠ THE BOUND ─────────────────────────────────────────────────────────────────────────────────── */
{
  const tooLong = [...LONG.script, ...new Array(MAX_CAR_BYTES).fill(OP.OP_NOP)]
  const longTail = new LockingScript(carTail({ fee: LONG.fee, depotScript: DEPOT })).toBinary()
  check('★★★ a car over MAX_CAR_BYTES is refused', recognises(5000, tooLong, longTail), false)
  check('★★ a car at exactly the bound is accepted',
    recognises(5000, SHORT.script, TAIL, SHORT.script.length))
  check('★★ …and one byte under the bound is refused',
    recognises(5000, SHORT.script, TAIL, SHORT.script.length - 1), false)
}

/* ── ⚠⚠ LYING ABOUT THE LENGTH — without the cross-check the bound is checked against a number the
   spender wrote rather than the script they supplied. */
{
  const out = [...u64(5000), ...varint(SHORT.script.length + 1000), ...SHORT.script]
  const lock = new LockingScript([
    ...carTailRecognitionOps(TAIL, MAX_CAR_BYTES),
    op(OP.OP_FROMALTSTACK), PN(0), op(OP.OP_GREATERTHAN),
  ])
  const sp = new Spend({
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
    lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
    unlockingScript: new UnlockingScript([pushData(out)]),
    inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  let ok = false
  try { ok = sp.validate() } catch { ok = false }
  check('★★★ a declared length that is not the real one is refused', ok, false)
}

/* ── ⚠ THE TAIL ITSELF ───────────────────────────────────────────────────────────────────────────── */
{
  check('★★★ a car whose last byte differs is refused',
    recognises(5000, [...SHORT.script.slice(0, -1), 0x00]), false)
  /* ⚠ A SCRIPT THAT IS ONLY THE TAIL IS RECOGNISED, and saying so is more useful than pretending
     otherwise. It ends with the tail because it IS the tail, so the ending test passes — and the
     script is then unspendable, because its first opcode is OP_FROMALTSTACK on an empty altstack.
     ⇒ The depot would fund it and the satoshis would burn. That is the SAME outcome as the splice and
     the same as `depot-drain`: a griefer can empty a tank and take none of it. A minimum-length rule
     would stop this exact shape and stop nothing else — an attacker can always write an unspendable
     car — so it would buy tidiness, not safety. */
  check('⚠ a script that is ONLY the tail IS recognised — and is unspendable, so it burns',
    recognises(5000, [...TAIL]))
  /* ⚠ THE ONE THAT MATTERS MOST: a car that pays somebody else has a different tail, because the
     payee is a literal inside it. */
  const thief = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const theirs = [0x76, 0xa9, 0x14, ...thief, 0x88, 0xac]
  const theirTail = new LockingScript(carTail({ fee: SHORT.fee, depotScript: theirs })).toBinary()
  const theirCar = [...SHORT.script.slice(0, SHORT.script.length - TAIL.length), ...theirTail]
  check('★★★ a car that pays A STRANGER instead of the depot is refused',
    recognises(5000, theirCar), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'DEPOT SPLICE OK — an ending is enough, because the car has nothing to jump with.'
  : 'DEPOT SPLICE FAILED')
process.exit(fail === 0 ? 0 : 1)
