// © BSV Association — Open BSV License v6.
//
// ★★★ THE GATE — does `raceValidates` actually REFUSE, or has it only ever agreed?
//
//   node --experimental-strip-types mint/test/racer-validates.ts
//
// ⚠ A gate nobody has seen refuse is a gate nobody has examined. This repo has shipped a `shell-blow`
// that passed having proved nothing — full throttle ended the run by GRIP at tick 0, so the speed rule
// under test was never reached — and a "no signature anywhere" check that was a substring search.
// ⇒ Every check that CAN be provoked from outside is provoked here. Where one cannot be — §1, because
// both fees derive from the same payee — the test says so plainly and provokes the REAL failure
// instead, rather than staging a sabotage that proves nothing.
import { LockingScript, PrivateKey, Hash, P2PKH } from '@bsv/sdk'
import { raceValidates, assertRaceable, buildRaceTx } from '../src/racerTx.ts'
import { buildRacerCar, racerCarFee, carBlockOps, feeConstant, CAR_BYTES_MIN } from '../src/racerCar.ts'
import { type TickTrace, type RunTrace } from '../src/racerTick.ts'
import { RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick } from '../src/shell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const CONSTS = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}

/** The address that mints the depot is the address the last satoshi returns to. */
const KEY = PrivateKey.fromRandom()
const PAYEE = new P2PKH().lock(KEY.toPublicKey().toAddress()).toBinary()

function simulate(metres: number, eng = 14, tyr = 10, tank = 40000): { run: RunTrace; finish: number } {
  const finish = Math.round(metres * S)
  let st: Record<string, number> = {
    phase: PHASE.RACING, driver: new Array(20).fill(0) as never, pool: new Array(36).fill(0) as never,
    eng, tyr, finish, slip: 1000, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
  } as never
  let fuel = tank
  const ticks: TickTrace[] = []
  let ending: RunTrace['ending'] = 'finish'
  for (let i = 0; i < 400; i++) {
    const r = refTick(st as never, { throttle: 8, fuel, lockTime: st.last + st.gap }, R)
    fuel -= r.burn
    ticks.push({ throttle: 8, spun: r.spun })
    st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
    if (r.ended === 'off') { ending = 'off'; break }
    if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; break }
    if (st.phase === PHASE.DONE) break
  }
  return { run: { ticks, ending }, finish }
}

const { run: RUN, finish: FINISH } = simulate(402)
const CFG = { name: 'SUN-DIVE', fuel: 40000, eng: 14, tyr: 10, slip: 1000, finish: FINISH }
const CAR = { cfg: CFG, run: RUN, depotScript: PAYEE, consts: CONSTS, optimise: true }

console.log('THE GATE — every check provoked, because a gate that has only ever agreed proves nothing\n')

/* ── ★★★ IT PASSES A CAR THAT IS ACTUALLY RACEABLE ───────────────────────────────────────────────── */
{
  const r = raceValidates(CAR)
  console.log(`        ${r.ticks} ticks · ${r.seconds.toFixed(2)} s · car ${r.lockBytes.toLocaleString()} B` +
    ` · race tx ${r.txBytes.toLocaleString()} B`)
  console.log(`        fee ${r.fee} sat = ${(r.fee * 1000 / r.txBytes).toFixed(1)} sat/KB · ` +
    `funded ${r.funded} · home ${r.home}\n`)
  check('★★★ a real quarter-mile car is RACEABLE', r.raceable)
  check('★★ …and it says so with no problems listed', r.problems.length === 0)
  check('★★★ the fee the script demands IS the fee racerCarFee funds it with', r.scriptFee === r.fee)
  check('★★ …and that fee clears the 100 sat/KB floor', r.fee * 1000 / r.txBytes >= 100)
  check('★★ assertRaceable lets a good car through', (() => {
    try { assertRaceable(CAR); return true } catch { return false }
  })())
}

/* ── ★★★ 1 · THE 19 AUG FAILURE, REPLAYED ────────────────────────────────────────────────────────
   `feeConstant` wrote the payee output's length varint as a constant 3 — true only for a payee of
   253 B or more. Against a 25-byte address it over-counted by two, the +9 round-up tipped the
   division, and the car demanded ONE SATOSHI MORE than it was funded with. Unspendable, no key.

   ⚠ NOTE WHAT CANNOT BE FAKED HERE. Inside `raceValidates` both fees derive from the SAME payee, so
   they cannot be made to disagree from outside — they disagree only when `feeConstant` is itself
   wrong, which is precisely what happened. ⇒ So the provocation is the real one: fund the car the way
   the OLD constant would have, and require the network to refuse it. The gate's arithmetic check
   EXPLAINS a refusal; the interpreter is what enforces it. The sweep that guards `feeConstant` against
   drift lives in `racer-car.ts`, over both payee shapes and 22 car sizes. */
{
  const OLD_CONSTANT = 64 + 3 + 156 + PAYEE.length + 9        // what it used to compute: 257
  const NEW_CONSTANT = feeConstant(PAYEE.length)              // what it computes now:    255
  const fee = racerCarFee(CAR).fee
  const car = buildRacerCar({ ...CAR, fee }).toBinary()
  const oldFee = Math.floor((3 + car.length + OLD_CONSTANT) / 10)
  const newFee = Math.floor((3 + car.length + NEW_CONSTANT) / 10)

  console.log(`\n        feeConstant was ${OLD_CONSTANT}, is now ${NEW_CONSTANT} for a ${PAYEE.length} B payee`)
  console.log(`        ⇒ the car would have demanded ${oldFee}; it is funded ${newFee}`)
  check('★★★ the two constants really do disagree by one satoshi', oldFee === newFee + 1)
  check('★★★ a car funded the OLD way is REFUSED BY THE NETWORK — unspendable, no key to rescue it',
    (() => {
      try {
        return buildRaceTx({ car, payeeScript: PAYEE, sourceSatoshis: oldFee + 1, fee: oldFee }).spend.validate()
      } catch { return false }
    })(), false)
  check('★★ …and funded the way the gate says, the same car races', raceValidates(CAR).raceable)
  check('★★★ the gate agrees with a spend it SERIALIZED, not with a number it assumed',
    raceValidates(CAR).scriptFee === racerCarFee(CAR).fee)
}

/* ── ⚠ 2 · THE SIZE RANGE — AND THIS ONE IS NOT PROVOKED, WHICH IS SAID RATHER THAN HIDDEN ───────
   `feeConstant`'s varint arithmetic holds for CAR_BYTES_MIN–CAR_BYTES_MAX, and NO REAL CAR CAN LEAVE
   THAT RANGE. Measured: a one-tick car is 881 B — already well over the 253 B floor, because the
   pushtx block alone costs ~582 B — and the longest raceable track (590 m, from the regulations) tops
   out near 22,000 B against a 65,000 B ceiling. ⇒ The check is DEFENCE IN DEPTH against a future
   change to the frame or the payee, not a path anything reaches today.
   ⚠ It is therefore the one check here with no negative control. Saying so is the point: a reader who
   assumes every guard below has been seen to fire would be wrong about this one. */
{
  const tiny = simulate(0.1)
  const small = buildRacerCar({ ...CAR, cfg: { ...CFG, finish: tiny.finish }, run: tiny.run, fee: 0 })
  const r = raceValidates({ ...CAR, cfg: { ...CFG, finish: tiny.finish }, run: tiny.run })
  console.log(`\n        shortest car the physics can produce: ${small.toBinary().length} B ` +
    `· floor ${CAR_BYTES_MIN} B ⇒ the range guard is unreachable, and unprovoked`)
  check('★★ the shortest car the physics can produce is still raceable', r.raceable)
}

/* ── ★★★ 3 · NOTHING COMES HOME ──────────────────────────────────────────────────────────────────*/
{
  const r = raceValidates(CAR, 0)
  check('★★★ funding a car with exactly its fee — 0 sat home — is REFUSED', r.raceable, false)
  check('★★ …and it says WHY: dust, before the script ever runs',
    r.problems.some(s => s.includes('dust')))
  check('★★ …while 1 satoshi home is accepted', raceValidates(CAR, 1).raceable)
  check('★★★ …and so is a spendable amount, because the covenant does not care',
    raceValidates(CAR, 600).raceable)
}

/* ── ★★★ 4 · A CAR THAT DOES NOT END WITH THE DEPOT'S BLOCK ──────────────────────────────────────
   Spendable but unmintable — a different failure, and cheaper to find here than in a refused mint. */
{
  const OTHER = new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toAddress()).toBinary()
  const r = raceValidates({ ...CAR, depotScript: OTHER })
  const carForUs = buildRacerCar({ ...CAR, fee: racerCarFee(CAR).fee }).toBinary()
  const blockForOther = new LockingScript(carBlockOps({ depotScript: OTHER })).toBinary()
  const endsWithOther = blockForOther.every((b, i) => carForUs.slice(-blockForOther.length)[i] === b)
  check('★★★ a car built for OUR payee does not carry ANOTHER payee\'s block', endsWithOther, false)
  check('★★ …and a car built for the other payee is internally consistent, so it passes', r.raceable)
  console.log('        ⇒ the check is real: it compares the car to the payee it was ASKED about')
}

/* ── ★★★ 5 · THE INTERPRETER IS THE LAST WORD ────────────────────────────────────────────────────
   Every check above is arithmetic ABOUT the car. This one runs it. */
{
  const fee = racerCarFee(CAR).fee
  const car = buildRacerCar({ ...CAR, fee }).toBinary()
  const funded = fee + 1
  const good = buildRaceTx({ car, payeeScript: PAYEE, sourceSatoshis: funded, fee })
  check('★★★ the race the gate builds is the race the network accepts', good.spend.validate())

  const short = buildRaceTx({ car, payeeScript: PAYEE, sourceSatoshis: funded, fee: fee - 1 })
  check('★★★ …paying the miner ONE SATOSHI LESS is refused', (() => {
    try { return short.spend.validate() } catch { return false }
  })(), false)

  const over = buildRaceTx({ car, payeeScript: PAYEE, sourceSatoshis: funded, fee: fee + 1 })
  check('★★★ …and so is keeping one back', (() => {
    try { return over.spend.validate() } catch { return false }
  })(), false)

  const thief = new P2PKH().lock(PrivateKey.fromRandom().toPublicKey().toAddress()).toBinary()
  check('★★★ …and paying somebody else entirely', (() => {
    try { return buildRaceTx({ car, payeeScript: thief, sourceSatoshis: funded, fee }).spend.validate() }
    catch { return false }
  })(), false)
}

/* ── ★★ THE GATE RUNS BEFORE THE MINT EXISTS, and that is the property it is FOR ─────────────────
   MEASURED: the car reads hashOutputs, its own scriptCode and its own value — never hashPrevouts. So
   the outpoint cannot change the answer, and the gate is sound while the mint is still a plan. */
{
  const fee = racerCarFee(CAR).fee
  const car = buildRacerCar({ ...CAR, fee }).toBinary()
  const funded = fee + 1
  const unminted = buildRaceTx({ car, payeeScript: PAYEE, sourceSatoshis: funded, fee })
  const real = buildRaceTx({
    car, payeeScript: PAYEE, sourceSatoshis: funded, fee,
    sourceTXID: Hash.sha256(car).map(b => b.toString(16).padStart(2, '0')).join(''),
    sourceOutputIndex: 3,
  })
  check('★★★ a placeholder outpoint validates', unminted.spend.validate())
  check('★★★ …and so does a real one, at a different index — the covenant never reads it',
    real.spend.validate())
}

/* ── ★★ AND nLockTime IS FREE, which is what a LOW_S grind needs ─────────────────────────────────*/
{
  const fee = racerCarFee(CAR).fee
  const car = buildRacerCar({ ...CAR, fee }).toBinary()
  const funded = fee + 1
  let accepted = 0
  const sizes = new Set<number>()
  for (const lockTime of [0, 1, 500_000, 812_345]) {
    const r = buildRaceTx({ car, payeeScript: PAYEE, sourceSatoshis: funded, fee, lockTime })
    try { if (r.spend.validate()) accepted++ } catch { /* counted as a refusal */ }
    sizes.add(r.tx.toBinary().length)
  }
  check('★★★ every nLockTime is accepted — the grind lever is free', accepted === 4)
  check('★★ …and the transaction size never moves, so the fee never moves either', sizes.size === 1)
}

/* ── ★★ assertRaceable REFUSES, and says why ─────────────────────────────────────────────────────*/
{
  let msg = ''
  try { assertRaceable(CAR, 0) } catch (e) { msg = (e as Error).message }
  check('★★★ assertRaceable THROWS on a car that cannot be raced', msg.includes('REFUSING TO MINT'))
  check('★★ …and names the reason rather than just failing', msg.includes('dust'))
}

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail === 0
  ? 'THE GATE HOLDS — it passes a raceable car and refuses every unraceable one it was shown.'
  : '⚠ THE GATE IS NOT SOUND — do not mint anything.')
process.exit(fail === 0 ? 0 : 1)
