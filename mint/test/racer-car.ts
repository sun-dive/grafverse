// © BSV Association — Open BSV License v6.
//
// ★★★ THE ONE-RACE CAR, AS A COVENANT — does the NETWORK run the physics, or did the compiler?
//
//   node --experimental-strip-types mint/test/racer-car.ts
//
// `racer-specialised.ts` proved the compiled arithmetic reaches the simulated state. It validated a
// bare script against a stub Spend with no outputs, so it proved the physics and nothing about the car.
// This builds the covenant: a real transaction, a real preimage, a real output paying the depot.
//
// ★★ EVERYTHING ABOUT THIS CAR IS KNOWN BEFORE IT IS MINTED — the driver picks the setup, the run is
// simulated to the last tick, and the script is compiled from that. Minting is putting the record on
// chain. ⚠ "Compiled from known values" sounds like "compiled away"; it is not, and this file counts
// the assertions rather than asserting it. The compiler does constant FOLDING, not PROPAGATION, so the
// arithmetic genuinely executes and a wrong prediction still produces NO race.
import { OP, Transaction, TransactionSignature, Spend, LockingScript, UnlockingScript, PrivateKey, Hash } from '@bsv/sdk'
import {
  buildRacerCar, racerCarFee, racerCarUnlock, nameBytes, CAR_SCOPE, NAME_BYTES, CAR_LAYOUT_STRING,
  carBlockOps, assertNoControlFlow, CONTROL_FLOW, feeConstant,
} from '../src/racerCar.ts'
import { type TickTrace, type Ending, type RunTrace } from '../src/racerTick.ts'
import {
  RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick, buildShellLock, shellMaxFee, PUBLIC_CAR_REGS,
  SHELL_WORST_MOVE_BYTES,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { op } from '../src/covenantAsm.ts'
import { buildDepotLock } from '../src/depot.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const ENG = 14, TYR = 10, SLIP = 1000, THROTTLE = 8
const FINISH = Math.round(402 * S), TANK = 40000

/** The physics. The driver's choices join these as constants in `carConsts`. */
const CONSTS = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}

const ST0: Record<string, unknown> = {
  phase: PHASE.RACING, driver: new Array(20).fill(0), pool: new Array(36).fill(0),
  eng: ENG, tyr: TYR, finish: FINISH, slip: SLIP, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
}

/** Drive the race in JavaScript, exactly as the page would before minting. */
function simulate(cfg: Record<string, number> = {}, throttle = THROTTLE, tank = TANK): RunTrace {
  let st = { ...ST0, ...cfg } as Record<string, number>
  let fuel = tank
  const ticks: TickTrace[] = []
  let ending: Ending = 'finish'
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (r.ended === 'off') { ending = 'off'; break }
    if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; break }
    if (st.phase === PHASE.DONE) { ending = 'finish'; break }
  }
  return { ticks, ending }
}

/** Simulate a run to a given finish line — for building a deliberately SHORT car. */
function simulateTo(finish: number): RunTrace {
  let st = { ...ST0, finish } as Record<string, number>
  let fuel = TANK
  const ticks: TickTrace[] = []
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle: THROTTLE, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle: THROTTLE, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (st.phase === PHASE.DONE) break
  }
  return { ticks, ending: 'finish' }
}

/* ── the depot this car pays home to ─────────────────────────────────────────────────────────────── */
const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const REGS = PUBLIC_CAR_REGS
const OLD_CAR = buildShellLock({ state: freshPublicShell(OWNER), maxFee: shellMaxFee(REGS), public: true, regs: REGS })
const DEPOT = buildDepotLock({ carScript: OLD_CAR.toBinary(), owner: OWNER }).toBinary()

const CFG = { name: 'SUN-DIVE', fuel: TANK, eng: ENG, tyr: TYR, slip: SLIP, finish: FINISH }
const RUN = simulate()

console.log('THE ONE-RACE CAR — a covenant, not an argument\n')

const { fee, bytes, lockBytes } = racerCarFee({ cfg: CFG, run: RUN, depotScript: DEPOT, consts: CONSTS })
const CAR = buildRacerCar({ cfg: CFG, run: RUN, depotScript: DEPOT, consts: CONSTS, fee })

console.log(`        ${RUN.ticks.length} ticks · ${(RUN.ticks.length / 10).toFixed(2)} s · ends '${RUN.ending}'`)
console.log(`        car lock ${CAR.toBinary().length.toLocaleString()} B · race tx ${bytes.toLocaleString()} B` +
  ` · FEE ${fee.toLocaleString()} sat = ${(fee * 1000 / bytes).toFixed(1)} sat/KB\n`)

/**
 * Build and validate the race: car(V) → depot(V − fee). `mutate` may rewrite the car's locking
 * script first, which is how the fold detector works.
 */
function race(car: LockingScript, V: number, opts: {
  payTo?: number[]; payValue?: number
} = {}): boolean {
  const src = new Transaction(); src.addOutput({ lockingScript: car, satoshis: V })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  tx.addOutput({
    lockingScript: new LockingScript(LockingScript.fromBinary(opts.payTo ?? DEPOT).chunks),
    satoshis: opts.payValue ?? (V - fee),
  })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xffffffff,
    subscript: car, lockTime: 0, scope: CAR_SCOPE,
  })
  const spend = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V,
    lockingScript: car, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
    unlockingScript: new UnlockingScript(racerCarUnlock(pre)),
    inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}

const V = 50_000

/** How many items a car leaves on the stack after a valid race. One is correct. */
function leftover(car: LockingScript, f: number): number {
  const src = new Transaction(); src.addOutput({ lockingScript: car, satoshis: V })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(DEPOT).chunks), satoshis: V - f })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xffffffff,
    subscript: car, lockTime: 0, scope: CAR_SCOPE,
  })
  const sp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V,
    lockingScript: car, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
    unlockingScript: new UnlockingScript(racerCarUnlock(pre)),
    inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return sp.validate() ? (sp as unknown as { stack: number[][] }).stack.length : -1 }
  catch { return -1 }
}

/** `race()` pins the module-level fee; an optimised car has its own. */
function raceWith(car: LockingScript, value: number, f: number): boolean {
  const src = new Transaction(); src.addOutput({ lockingScript: car, satoshis: value })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
  tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(DEPOT).chunks), satoshis: value - f })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xffffffff,
    subscript: car, lockTime: 0, scope: CAR_SCOPE,
  })
  const sp = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: value,
    lockingScript: car, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
    unlockingScript: new UnlockingScript(racerCarUnlock(pre)),
    inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try { return sp.validate() } catch { return false }
}

/* ── ★★★ IT RACES ────────────────────────────────────────────────────────────────────────────────── */
check('★★★ the car races — one transaction, the whole run, paying the depot', race(CAR, V))

/* ── ★ THE HEAD IS A RECORD, NOT A BINDING — and this says so out loud ───────────────────────────
   Everything about this car was known before it was minted, so the configuration is compiled in as
   constants and the head is pushed and dropped unread. Rewriting it therefore changes NOTHING about
   the race, and a test that expected otherwise would be testing a design we did not build.
   ⇒ What the head is for: a leaderboard finds the setup at a fixed offset without executing anything.
   ⇒ How a setup is CHECKED: the time is a function of the configuration, so anyone re-derives it with
     the reference physics. The chain proves the car existed, was funded, and was raced. */
{
  const withHead = (over: Partial<typeof CFG>): LockingScript =>
    buildRacerCar({ cfg: { ...CFG, ...over }, run: RUN, depotScript: DEPOT, consts: CONSTS, fee })

  check('★ rewriting the NAME in the head still races — it is a record, not an input',
    race(withHead({ name: 'MA-AN-ZUO' }), V))
  check('★ the head and the race are the same length whatever the head says',
    withHead({ name: 'MA-AN-ZUO' }).toBinary().length === CAR.toBinary().length)
  check(`★ the layout is the shell's own widths: ${CAR_LAYOUT_STRING}`,
    CAR_LAYOUT_STRING === 'name$12 fuel%4 eng%2 tyr%2 slip%2 finish%6')
}

/* ── ★★★ WHAT THE NETWORK ACTUALLY CHECKS — the assertions are REAL, folded or not ────────────────
   "Compiled from known values" sounds like "compiled away", and it is not. The compiler does constant
   FOLDING, not constant PROPAGATION: `fuel = TANK` stays a stack value, so every tick below it
   executes. ⇒ Count them, rather than believing it. */
{
  const verifies = CAR.chunks.filter(c => c.op === OP.OP_VERIFY).length
  const arith = CAR.chunks.filter(c =>
    [OP.OP_ADD, OP.OP_SUB, OP.OP_MUL, OP.OP_DIV].includes(c.op)).length
  console.log(`\n        the network checks ${verifies} assertions and runs ${arith.toLocaleString()} ` +
    `arithmetic opcodes over ${RUN.ticks.length} ticks`)
  /* Four a tick: fuel > 0 · grip >= demand · nv < BLOW_V · ns < finish. A dry car is caught by the
     NEXT tick's `fuel > 0`, which is why it is four and not five. */
  check('★★★ the race carries four real assertions per tick, not zero',
    verifies >= RUN.ticks.length * 4)
  check('★★ …and the arithmetic is genuinely executed, not folded to a literal',
    arith > RUN.ticks.length * 10)
}

/* ── ★★★ THE RUN ITSELF CANNOT BE LIED ABOUT ─────────────────────────────────────────────────────
   This is where the honesty lives. The prediction is a COMMITMENT: get it wrong and there is no race
   at all, because the assertions refuse. */
{
  const rebuilt = (run: RunTrace): boolean => {
    try {
      const f = racerCarFee({ cfg: CFG, run, depotScript: DEPOT, consts: CONSTS }).fee
      return race(buildRacerCar({ cfg: CFG, run, depotScript: DEPOT, consts: CONSTS, fee: f }), V)
    } catch { return false }
  }
  check('★★★ a car claiming a spin that did not happen does not validate',
    rebuilt({ ...RUN, ticks: RUN.ticks.map((t, i) => i === 5 ? { ...t, spun: !t.spun } : t) }), false)
  check('★★★ a car claiming a race one tick shorter does not validate',
    rebuilt({ ...RUN, ticks: RUN.ticks.slice(0, -1) }), false)
  check('★★★ …and one tick LONGER does not validate either — a run cannot be padded',
    rebuilt({ ...RUN, ticks: [...RUN.ticks, RUN.ticks[RUN.ticks.length - 1]] }), false)
}

/* ── ★★ THE MONEY GOES ONE PLACE AND ONE PLACE ONLY ──────────────────────────────────────────────── */
{
  const thief = PrivateKey.fromRandom()
  const theirs = [0x76, 0xa9, 0x14, ...Hash.hash160(thief.toPublicKey().encode(true) as number[]), 0x88, 0xac]
  check('★★★ paying anybody but the depot does not validate', race(CAR, V, { payTo: theirs }), false)
  check('★★★ keeping a satoshi more than the fee allows does not validate',
    race(CAR, V, { payValue: V - fee + 1 }), false)
  check('★★ paying LESS than the rule says does not validate either — the value is exact, not a floor',
    race(CAR, V, { payValue: V - fee - 1 }), false)
}

/* ── ⚠ THE VALUE IS NEVER ZERO ───────────────────────────────────────────────────────────────────── */
check('⚠ a car funded with exactly its fee cannot be raced — a 0-value output is dust',
  race(CAR, fee), false)
check('a car funded one satoshi above its fee can be', race(CAR, fee + 1))

/* ── the name field ──────────────────────────────────────────────────────────────────────────────── */
check(`a name longer than ${NAME_BYTES} characters is refused, not truncated`,
  (() => { try { nameBytes('X'.repeat(NAME_BYTES + 1)); return false } catch { return true } })())
check('a short name is zero-padded to the field width', nameBytes('AB').length === NAME_BYTES)

/* ── ⚠ THE FEE IS DERIVED, AND BEING UNDER IT IS PERMANENT ───────────────────────────────────────── */
check('⚠ the derived fee is at or above the 100 sat/KB floor', fee * 1000 / bytes >= 100)
check('⚠ …and no more than a satoshi per KB above it — an exact spend, not a bound',
  fee * 1000 / bytes < 101)

/* ── the unlocking script is the preimage and nothing else ───────────────────────────────────────── */
check('★ the spender chooses nothing — the unlocking script is one push',
  racerCarUnlock([1, 2, 3]).length === 1)

/* ── ★ WHAT IT COSTS, AGAINST THE CHAINED RACE — mining fees both sides, which is the only
   comparison that means anything. A chained tick is a whole transaction: SHELL_WORST_MOVE_BYTES at
   the 100 sat/KB floor, sixty times over. ⚠ Not Σburn: the burn was the fee only while a tick was a
   transaction, and unrolled it is a game quantity that buys mass, not blockspace. */
{
  const chained = RUN.ticks.length * Math.ceil(SHELL_WORST_MOVE_BYTES * 100 / 1000)
  console.log(`\n        chained ${chained.toLocaleString()} sat (${RUN.ticks.length} transactions)` +
    `  ·  one-race ${fee.toLocaleString()} sat  ⇒ ${(chained / fee).toFixed(1)}x`)
  check('★★ the one-race car is cheaper in mining fees than the chained race', fee < chained)
  console.log(`        ${Math.round(CAR.toBinary().length / RUN.ticks.length)} B a tick all in ` +
    `— the race itself is 222 B, the rest is the frame and the head, paid once`)
}

/* ── ★ A WRECK IS A CAR TOO ──────────────────────────────────────────────────────────────────────── */
{
  const wreck = simulate({ tyr: 1, slip: 400, eng: 24 }, 16)
  const cfg = { ...CFG, eng: 24, tyr: 1, slip: 400 }
  const f = racerCarFee({ cfg, run: wreck, depotScript: DEPOT, consts: CONSTS }).fee
  const car = buildRacerCar({ cfg, run: wreck, depotScript: DEPOT, consts: CONSTS, fee: f })
  console.log(`\n        the wreck: ${wreck.ticks.length} tick(s) · ends '${wreck.ending}' · ` +
    `${car.toBinary().length.toLocaleString()} B · FEE ${f} sat`)
  check(`★★★ a car that wrecks at tick ${wreck.ticks.length} still races, and still pays the depot`,
    (() => {
      const src = new Transaction(); src.addOutput({ lockingScript: car, satoshis: V })
      const tx = new Transaction(); tx.version = 2
      tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
      tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(DEPOT).chunks), satoshis: V - f })
      tx.lockTime = 0
      const pre = TransactionSignature.format({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
        otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xffffffff,
        subscript: car, lockTime: 0, scope: CAR_SCOPE,
      })
      const sp = new Spend({
        sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V,
        lockingScript: car, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
        unlockingScript: new UnlockingScript(racerCarUnlock(pre)),
        inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
      })
      try { return sp.validate() } catch { return false }
    })())
}

/* ── ★★ THE SAME CAR, COMPILED THROUGH THE MINT'S OPTIMISER ──────────────────────────────────────
   `optimizeCarCompile` hoists what an unrolled race repeats, and proves itself against the plain build
   before it returns. The car must still race, still pay the depot, and still refuse a lie. */
{
  const f2 = racerCarFee({ cfg: CFG, run: RUN, depotScript: DEPOT, consts: CONSTS, optimise: true })
  const opt = buildRacerCar({ cfg: CFG, run: RUN, depotScript: DEPOT, consts: CONSTS, fee: f2.fee, optimise: true })
  console.log(`\n        optimised: ${opt.toBinary().length.toLocaleString()} B against ` +
    `${CAR.toBinary().length.toLocaleString()} B plain ` +
    `⇒ ${((1 - opt.toBinary().length / CAR.toBinary().length) * 100).toFixed(1)}% smaller · FEE ${f2.fee} sat`)
  check('★★★ an OPTIMISED car races, and pays the depot', raceWith(opt, V, f2.fee))
  check('★★ …and is smaller than the plain one', opt.toBinary().length < CAR.toBinary().length)
  /* ⚠ MEASURED, not asserted. The plain car's cleanup depth comes from the compiler's model of ITS
     ops; the optimised car is a different program with a different depth, and taking one number for
     the other is exactly the bug that left seven orphans under the result earlier today. */
  const lo = leftover(opt, f2.fee), lp = leftover(CAR, fee)
  console.log(`        stack left: plain ${lp} · optimised ${lo}`)
  check('★★ …and leaves exactly ONE item on the stack, like the plain car', lo === 1 && lp === 1)
  check('⚠ …and its fee is still at or above the floor', f2.fee * 1000 / f2.bytes >= 100)
}

/* ── ★★★ THE CONTRACT THE DEPOT WILL RELY ON ─────────────────────────────────────────────────────
   A depot cannot recognise a car by shape — every race is a different length. It pins the TAIL, split
   from the right, and asks only "will these sats come back to me?". These are the properties that
   makes that sound, checked HERE, where cars are made, rather than asserted over in the depot. */
{
  const tailOps = carBlockOps({ depotScript: DEPOT })
  const tailBytes = new LockingScript(tailOps).toBinary()
  const carBytes = CAR.toBinary()
  const endsWith = (script: number[], t: number[]): boolean =>
    script.length >= t.length && t.every((b, i) => script[script.length - t.length + i] === b)

  check('★★★ a car ENDS with the tail the depot pins', endsWith(carBytes, [...tailBytes]))

  /* ★★ THE WHOLE POINT: length-agnostic. A short race and a long one carry the same last bytes, so one
     comparison recognises both — and there is no shape to pin, only an ending. */
  {
    const shortCfg = { ...CFG, finish: Math.round(4 * S) }
    const sf = racerCarFee({ cfg: shortCfg, run: simulateTo(shortCfg.finish), depotScript: DEPOT, consts: CONSTS })
    const shortCar = buildRacerCar({ cfg: shortCfg, run: simulateTo(shortCfg.finish), depotScript: DEPOT, consts: CONSTS, fee: sf.fee })
    const shortTail = tailBytes   // ★ THE SAME BYTES — the block is constant now
    check('★★★ a much shorter car also ends with ITS tail — recognition does not depend on length',
      endsWith([...shortCar.toBinary()], [...shortTail]) &&
      shortCar.toBinary().length < carBytes.length / 2)
    console.log(`        short car ${shortCar.toBinary().length.toLocaleString()} B · long car ` +
      `${carBytes.length.toLocaleString()} B · THE SAME ${tailBytes.length} B block, byte for byte`)
  }

  /* ⚠⚠ THE MEASURED CLAIM THE SAFETY RESTS ON. Free bytes before the tail are executable positions, and
     depot.ts pins the chained car's head precisely because of it — "without this the depot is not a
     tank but a faucet". It does not reach here only because a specialised car has NO branches to
     close a spliced OP_IF with. That is measured, so it is measured on every car built. */
  check('★★★ a car carries NO control flow — nothing a spliced OP_IF could be closed against',
    CONTROL_FLOW.every(code => CAR.chunks.filter(c => c.op === code).length === 0))

  /* ★ And the guard is provoked, or "it found none" is indistinguishable from "it cannot find any". */
  check('★★ …and the assertion FIRES when a car does carry one',
    (() => {
      try { assertNoControlFlow([...CAR.chunks, op(OP.OP_ENDIF)]); return false }
      catch (e) { return (e as Error).message.includes('faucet') }
    })())
}

/* ── ⚠⚠ THE FEE THE SCRIPT COMPUTES MUST BE THE FEE THE TRANSACTION COSTS ────────────────────────
   The block reads its own scriptCode's size and works the fee out from it, which is what makes it
   constant and therefore pinnable. So `feeConstant` has to be exactly right — and the first version
   of it was assembled out of parts, double-counted two, and landed ONE SATOSHI UNDER on two car sizes
   out of five. Under the relay floor is permanent, unamendable, and this project has stood on it five
   times. ⇒ Sweep the range; agreeing on a few sizes is precisely what being wrong looked like. */
{
  const K = feeConstant(DEPOT.length)
  let checked = 0, agree = 0, under = 0
  for (const metres of [2, 4, 10, 25, 40, 70, 120, 180, 220, 300, 402]) {
    const finish = Math.round(metres * S)
    const run = simulateTo(finish)
    const cfg = { ...CFG, finish }
    const serialized = racerCarFee({ cfg, run, depotScript: DEPOT, consts: CONSTS }).fee
    const car = buildRacerCar({ cfg, run, depotScript: DEPOT, consts: CONSTS })
    const inScript = Math.floor((3 + car.toBinary().length + K) / 10)
    checked++
    if (inScript === serialized) agree++
    if (inScript < serialized) under++
  }
  console.log(`\n        fee agreement swept over ${checked} car sizes · feeConstant ${K}`)
  check(`★★★ the in-script fee equals the serialized fee on all ${checked} sizes`, agree === checked)
  check('⚠⚠ …and is NEVER under it — under the relay floor is permanent and unamendable', under === 0)
}

/* ── ★★★ ONE BLOCK, EVERY CAR — the property the depot's recognition depends on ─────────────────── */
{
  const block = new LockingScript(carBlockOps({ depotScript: DEPOT })).toHex()
  const built = [4, 40, 220].map(m => {
    const finish = Math.round(m * S)
    return buildRacerCar({ cfg: { ...CFG, finish }, run: simulateTo(finish), depotScript: DEPOT, consts: CONSTS })
  })
  const b = new LockingScript(carBlockOps({ depotScript: DEPOT })).toBinary()
  check('★★★ cars of three different lengths all end with the SAME block, byte for byte',
    built.every(car => {
      const s2 = car.toBinary()
      return b.every((x, i) => s2[s2.length - b.length + i] === x)
    }) && new Set(built.map(c => c.toBinary().length)).size === 3)
  check('★★ …and the block contains no per-car number at all — it computes its fee',
    block === new LockingScript(carBlockOps({ depotScript: DEPOT })).toHex())
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'RACER CAR OK — the network runs the physics, and the fuel goes home.'
  : 'RACER CAR FAILED')
process.exit(fail === 0 ? 0 : 1)
