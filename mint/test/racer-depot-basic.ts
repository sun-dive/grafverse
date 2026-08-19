// © BSV Association — Open BSV License v6.
//
// ★★★ THE MINTING DEPOT, COMPILED FROM BITCOIN BASIC — and every way of robbing it I could think of.
//
//   node --experimental-strip-types mint/test/racer-depot-basic.ts
//
// ⚠ THE BAR IS NOT "IT WORKS". It is: everything `racer-depot.ts` proves about the hand-written depot,
// proved again here, PLUS the rate limit. A replacement that is only tested on its new features is a
// replacement that quietly drops the old ones.
//
// ⚠⚠ AND READ A PASS SHEET THE RIGHT WAY ROUND. Twice while building this, only the REFUSALS passed —
// once from one OP_NIP too many, once from comparing the varint marker against a two-byte number. Both
// times a script that ALWAYS FAILS scored 8/12 and 10/14, because every theft test is satisfied by a
// covenant that refuses everything. ⇒ A negative-only pass sheet is not partial success. The positive
// checks are the ones that tell you the script runs at all, and they come first here for that reason.
import { Transaction, TransactionSignature, Spend, LockingScript, UnlockingScript, PrivateKey, Hash, P2PKH, OP } from '@bsv/sdk'
import { buildRacerDepotBasicLock, RACER_WINDOW_SECONDS, RACER_MINTS_PER_WINDOW } from '../src/racerDepotFrame.ts'
import { RACER_DRAW, RACER_DEPOT_MAX_FEE, RACER_MAX_CAR_BYTES } from '../src/racerDepot.ts'
import { buildRacerCar, racerCarFee, carBlockOps } from '../src/racerCar.ts'
import { buildDepotUnlock, DEPOT_SCOPE } from '../src/depot.ts'
import { RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick } from '../src/shell.ts'
import { type TickTrace, type RunTrace } from '../src/racerTick.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const PHYS: Record<string, number> = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}

/* ★ ONE KEY. The address that mints the depot is the address a finished race pays back to — and
   because a 25-byte address contains no depot, there is no circularity and no second depot. */
const OWNER_KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(OWNER_KEY.toPublicKey().encode(true) as number[])
const PAYEE = new P2PKH().lock(OWNER_KEY.toPublicKey().toAddress()).toBinary()
const BLOCK = new LockingScript(carBlockOps({ depotScript: PAYEE })).toBinary()

const u64 = (v: number): number[] => {
  const b: number[] = []; let x = BigInt(v); for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n }; return b
}
const varint = (n: number): number[] =>
  n < 0xfd ? [n] : n <= 0xffff ? [0xfd, n & 0xff, n >> 8] : [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
const serOut = (v: number, s: number[]): number[] => [...u64(v), ...varint(s.length), ...s]

/**
 * ⚠ THE ENDING IS REPORTED, NOT ASSUMED. The first version of this hard-coded `ending: 'finish'`
 * whatever happened, so a 600 m run on a 40,000 tank — which goes dry — was described to the compiler
 * as a car that crossed the line. `optimizeCarCompile` caught it and refused to certify the
 * optimisation, which is exactly what that self-proof is for: *"refusing to mint a car whose
 * optimisation has not been checked."* A test helper that lies is a test that proves the wrong thing.
 */
function simulate(metres: number, tank: number): { run: RunTrace; finish: number; dry: boolean } {
  const finish = Math.round(metres * S)
  let st: Record<string, number> = {
    phase: PHASE.RACING, driver: new Array(20).fill(0) as never, pool: new Array(36).fill(0) as never,
    eng: 14, tyr: 10, finish, slip: 1000, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
  } as never
  let fuel = tank
  const ticks: TickTrace[] = []
  let done = false
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle: 8, fuel, lockTime: st.last + st.gap }, R)
    /* ⚠⚠ CLAMP AT EMPTY — DO NOT STOP. A dry car COASTS: with no propellant the throttle is forced
       shut and it rolls on, slowing on drag. `shell.ts` says so, and since the fee left the loop the
       fuel is a GAME quantity rather than a balance.
       ⚠ Breaking out here is a rule from the CHAINED design, where a tick really was bought, and it
       forbids the best strategy in this one: 30,000 fuel finishes 402 m in 5.40 s where 40,000 takes
       6.00 s, because less fuel is less mass. Under-fuelling is a DECISION. */
    fuel = Math.max(0, fuel - r.burn)
    ticks.push({ throttle: 8, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (st.phase === PHASE.DONE) { done = true; break }
  }
  return { run: { ticks, ending: 'finish' }, finish, dry: !done }
}
function carFor(metres: number, payee = PAYEE, tank = 40000): { script: number[]; fee: number; dry: boolean } {
  const { run, finish, dry } = simulate(metres, tank)
  const cfg = { name: 'SUN-DIVE', fuel: tank, eng: 14, tyr: 10, slip: 1000, finish }
  return {
    script: buildRacerCar({ cfg, run, depotScript: payee, consts: PHYS, optimise: true }).toBinary(),
    fee: racerCarFee({ cfg, run, depotScript: payee, consts: PHYS, optimise: true }).fee,
    dry,
  }
}

const CAR = carFor(4)
const W = RACER_WINDOW_SECONDS
const T0 = 1786800000
const WIN0 = Math.floor(T0 / W)
const depotAt = (mark: number, count: number): LockingScript =>
  buildRacerDepotBasicLock({ carBlock: BLOCK, owner: OWNER, mark, count })
const DEPOT_BYTES = depotAt(0, 0).toBinary().length

console.log('THE MINTING DEPOT, COMPILED FROM BASIC\n')
console.log(`        depot ${DEPOT_BYTES} B · car block ${BLOCK.length} B · payee ${PAYEE.length} B (an address)`)
console.log(`        DRAW ${RACER_DRAW} · MAX_FEE ${RACER_DEPOT_MAX_FEE} · MAX_CAR ${RACER_MAX_CAR_BYTES.toLocaleString()}`)
console.log(`        window ${W}s · burst ${RACER_MINTS_PER_WINDOW}\n`)

/**
 * Build a mint and validate it through the real interpreter.
 * ⚠ The unlocking script is attached BEFORE anything is serialized — leaving it off and calling
 * toBinary() throws `unlockingScript is undefined`, which cost two probe rounds while writing this.
 */
interface MintOpts {
  mark?: number; count?: number; lockTime?: number; seq?: number
  tank?: number; paid?: number; kept?: number
  car?: number[]; extra?: Array<{ script: number[]; value: number }>
  nextMark?: number; nextCount?: number
  topUp?: boolean
}
function mintTx(o: MintOpts): { spend: Spend; tx: Transaction } {
  const mark = o.mark ?? 0, count = o.count ?? 0, lockTime = o.lockTime ?? T0
  const seq = o.seq ?? 0xfffffffe, tank = o.tank ?? 1_000_000
  const car = o.car ?? CAR.script, paid = o.paid ?? CAR.fee + 1
  const w = Math.floor(lockTime / W)
  const DEPOT = depotAt(mark, count)
  const NEXT = depotAt(
    o.nextMark ?? (o.topUp ? mark : w),
    o.nextCount ?? (o.topUp ? count : (w === mark ? count + 1 : 1)),
  )
  const extra = o.extra ?? []
  const kept = o.kept ?? (o.topUp
    ? tank + 5000
    : tank - paid - 1 - extra.reduce((a, e) => a + e.value, 0))

  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: seq })
  if (!o.topUp) tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(car).chunks), satoshis: paid })
  tx.addOutput({ lockingScript: NEXT, satoshis: kept })
  for (const e of extra) {
    tx.addOutput({ lockingScript: new LockingScript(LockingScript.fromBinary(e.script).chunks), satoshis: e.value })
  }
  tx.lockTime = lockTime
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: seq,
    subscript: DEPOT, lockTime, scope: DEPOT_SCOPE,
  })
  const unlock = buildDepotUnlock({
    prefixOutputs: o.topUp ? [] : serOut(paid, car),
    spenderOutputs: extra.flatMap(e => serOut(e.value, e.script)),
    newValue: u64(kept), preimage: pre,
  } as never)
  tx.inputs[0].unlockingScript = unlock
  const spend = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, lockingScript: DEPOT,
    transactionVersion: 2, otherInputs: [], outputs: tx.outputs, unlockingScript: unlock,
    inputSequence: seq, inputIndex: 0, lockTime,
  })
  return { spend, tx }
}
const mint = (o: MintOpts = {}): boolean => {
  try { return mintTx(o).spend.validate() } catch { return false }
}

/* ── ★★★ FIRST, THE POSITIVE CHECKS — a covenant that refuses everything passes every theft test ──*/
console.log('── it works at all ────────────────────────────────────────────────────────────────────')
check('★★★ THE COMPILED DEPOT MINTS A CAR', mint())
check('★★★ …and the successor carries the advanced state', mint({ mark: WIN0, count: 1, lockTime: T0 + 5 }))
check('★★ handing the depot MORE than it had needs no car at all', mint({ topUp: true }))

/* ── ★★★ THE RATE LIMIT ──────────────────────────────────────────────────────────────────────────*/
console.log('\n── the rate limit ─────────────────────────────────────────────────────────────────────')
{
  let minted = 0
  for (let i = 0; i < RACER_MINTS_PER_WINDOW; i++) {
    if (mint({ mark: WIN0, count: i, lockTime: T0 + i })) minted++
  }
  check(`★★★ a window mints exactly ${RACER_MINTS_PER_WINDOW}`, minted === RACER_MINTS_PER_WINDOW)
  check('★★★ …and the next one is REFUSED',
    mint({ mark: WIN0, count: RACER_MINTS_PER_WINDOW, lockTime: T0 + 40 }), false)
  check('★★★ …a one-second bump buys NOTHING — the stamp is DIVIDED into a window',
    mint({ mark: WIN0, count: RACER_MINTS_PER_WINDOW, lockTime: T0 + 1 }), false)
  check('★★★ …but crossing the window opens a fresh burst',
    mint({ mark: WIN0, count: RACER_MINTS_PER_WINDOW, lockTime: T0 + W }))
  check('★★★ going BACKWARDS in time is refused', mint({ mark: WIN0, count: 1, lockTime: T0 - W }), false)
  check('★★★ a successor that does not advance the counter is refused',
    mint({ mark: WIN0, count: 3, lockTime: T0 + 5, nextCount: 3 }), false)
  check('★★★ …one that resets it inside the same window', mint({ mark: WIN0, count: 3, lockTime: T0 + 5, nextCount: 1 }), false)
  check('★★★ …and one claiming a window it is not in',
    mint({ mark: WIN0, count: 3, lockTime: T0 + 5, nextMark: WIN0 + 99 }), false)
}

/* ⚠⚠⚠ THE LINE THE WHOLE THING RESTS ON. nLockTime binds only while an input is non-final. */
console.log('\n── the sequence guard ─────────────────────────────────────────────────────────────────')
check('⚠⚠★★★ nSequence ffffffff IS REFUSED — without this the clock never binds at all',
  mint({ seq: 0xffffffff }), false)
check('★★ …0xfffffffe is accepted', mint({ seq: 0xfffffffe }))
check('★★ …and so is any other non-final value', mint({ seq: 0x00000001 }))

/* ── ★★ A TOP-UP IS NOT A MINT ───────────────────────────────────────────────────────────────────
   If a donation consumed a slot, ten one-satoshi gifts would close a window to everybody. */
console.log('\n── a top-up costs no slot ─────────────────────────────────────────────────────────────')
check('★★★ a top-up is accepted even in a FULL window',
  mint({ mark: WIN0, count: RACER_MINTS_PER_WINDOW, lockTime: T0 + 5, topUp: true }))
check('★★★ …and may not quietly advance the counter',
  mint({ mark: WIN0, count: 5, lockTime: T0 + 5, topUp: true, nextCount: 6 }), false)
check('★★ …nor move the window on', mint({ mark: WIN0, count: 5, lockTime: T0 + W, topUp: true, nextMark: WIN0 + 1 }), false)

/* ── ★★★ EVERYTHING racer-depot.ts PROVES ABOUT THE HAND-WRITTEN ONE ─────────────────────────────*/
console.log('\n── the theft surface, carried over from the hand-written depot ────────────────────────')
check('★★★ THE BIG FAUCET is closed: a full draw taken, one satoshi to the car',
  mint({ paid: 1, kept: 1_000_000 - RACER_DRAW }), false)
check('★★★ …and so is taking a draw the car never receives',
  mint({ paid: CAR.fee + 1, kept: 1_000_000 - RACER_DRAW - RACER_DEPOT_MAX_FEE }), false)
check('★★★ MAX_FEE IS NOT EXTRACTABLE — a third output is refused when value leaves',
  mint({ extra: [{ script: PAYEE, value: 500 }] }), false)
check('★★ …at ANY size, even one satoshi to a stranger',
  mint({ extra: [{ script: PAYEE, value: 1 }] }), false)
check('★★★ taking more than DRAW + MAX_FEE is refused',
  mint({ kept: 1_000_000 - RACER_DRAW - RACER_DEPOT_MAX_FEE - 1 }), false)
check('★★★ handing a car MORE than DRAW is refused', mint({ paid: RACER_DRAW + 1 }), false)
check('★★★ minting to a plain address instead of a car is refused', mint({ car: PAYEE }), false)
check('★★★ a car whose block pays somebody else is refused', (() => {
  const other = new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toAddress()).toBinary()
  return mint({ car: carFor(4, other).script })
})(), false)
/* ⚠ 590 m is the longest raceable track, and it needs the bigger tank to reach the line. A car that
   ran DRY would be a lie to the compiler, not an over-long car — see `simulate`. */
{
  const big = carFor(590, PAYEE, 71000)
  console.log(`        the longest raceable car: ${big.script.length.toLocaleString()} B ` +
    `· ${big.dry ? '⚠ RAN DRY' : 'crossed the line'} · bound ${RACER_MAX_CAR_BYTES.toLocaleString()}`)
  check('★★ …and it genuinely finishes, so the bound is tested on a real car', !big.dry)
  check('★★★ a car over MAX_CAR_BYTES is refused',
    big.script.length > RACER_MAX_CAR_BYTES && mint({ car: big.script, paid: RACER_DRAW }), false)
}

/* ── ★★ THE TRUE COST, COMPUTED BY THE SCRIPT ITSELF ─────────────────────────────────────────────*/
console.log('\n── the fee it works out for itself ────────────────────────────────────────────────────')
{
  const probe = mintTx({})
  const size = probe.tx.toBinary().length
  /* ⚠ MIRROR THE SCRIPT EXACTLY, including how it rounds. `OP_DIV` TRUNCATES toward zero, and the +9
     folded into 267 is what rounds the fee UP — so a `Math.ceil` on top of that rounds twice and lands
     one satoshi high, which the covenant then refuses. The first version of this check did exactly
     that and read as a covenant bug rather than a test bug.
     ⇒ scsize is the scriptCode FIELD: the script plus its own 3-byte length varint. */
  const scsize = DEPOT_BYTES + 3
  const trueFee = Math.floor((2 * CAR.script.length + 2 * scsize + 267) / 10)
  const perKB = (trueFee * 1000 / size).toFixed(1)
  console.log(`        a real mint serializes to ${size.toLocaleString()} B · the script computes ` +
    `${trueFee} sat = ${perKB} sat/KB`)
  check('⚠⚠ the computed fee clears the 100 sat/KB floor — under it is permanent and unamendable',
    trueFee * 1000 / size >= 100)
  const paid = CAR.fee + 1
  check('★★★ taking the car\'s funding plus the TRUE cost is allowed',
    mint({ paid, kept: 1_000_000 - paid - trueFee }))
  check('★★★ …and one satoshi more is REFUSED — it would have to go somewhere, and there is nowhere',
    mint({ paid, kept: 1_000_000 - paid - trueFee - 1 }), false)
}

/* ── ★★ THE ESCAPE HATCH ─────────────────────────────────────────────────────────────────────────*/
console.log('\n── the owner burn, ungated on purpose ─────────────────────────────────────────────────')
async function burn(tank: number, key: PrivateKey): Promise<boolean> {
  const DEPOT = depotAt(WIN0, 3)
  const src = new Transaction(); src.addOutput({ lockingScript: DEPOT, satoshis: tank })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: new P2PKH().lock(key.toPublicKey().toAddress()), satoshis: tank - 300 })
  tx.lockTime = 0
  const pre = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: DEPOT, lockTime: 0, scope: DEPOT_SCOPE,
  })
  const sig = key.sign(Hash.sha256(pre))
  const sigDer = [...sig.toDER(), DEPOT_SCOPE]
  const pub = key.toPublicKey().encode(true) as number[]
  const unlock = new UnlockingScript([
    { op: 0, data: [] },                                  // prefixOutputs — empty
    { op: OP.OP_1 },                                      // burn
    { op: sigDer.length, data: sigDer },
    { op: pub.length, data: pub },
    { op: 0, data: [] },                                  // spenderOutputs
    { op: 8, data: u64(0) },                              // newValue
    { op: OP.OP_PUSHDATA2, data: pre },
  ])
  tx.inputs[0].unlockingScript = unlock
  const spend = new Spend({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: tank, lockingScript: DEPOT,
    transactionVersion: 2, otherInputs: [], outputs: tx.outputs, unlockingScript: unlock,
    inputSequence: 0xfffffffe, inputIndex: 0, lockTime: 0,
  })
  try { return spend.validate() } catch { return false }
}
check('★★★ the owner can sweep a FULL tank — ungated, and that is the point', await burn(150_000, OWNER_KEY))
check('★★★ …and nobody else can, at any balance', await burn(150_000, PrivateKey.fromRandom()), false)
check('★★ …and the owner can sweep a nearly-empty one too', await burn(1_000, OWNER_KEY))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'COMPILED DEPOT OK — it mints, it rate-limits, and the owner can always get out.'
  : '⚠ NOT SOUND — do not mint a genesis from this.')
process.exit(fail === 0 ? 0 : 1)
