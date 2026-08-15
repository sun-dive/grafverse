// © BSV Association — Open BSV License v6.
// THE PUBLIC CAR · step 1 — the reference state machine, before a byte of Script exists.
//
//   node --experimental-strip-types mint/test/public-ref.ts
//
// The build order that has held all week puts the reference first, because a state machine that is
// wrong in TypeScript is wrong in Script too, and infinitely cheaper to fix here. Nothing below touches
// the interpreter; this is the specification, executable.
//
// ★ WHAT IT HAS TO ESTABLISH:
//
//   1. a public car is OWNED FROM BIRTH, so it can never be claimed by a passer-by
//   2. configuring one does not transfer it — the next driver rebuilds it, they never own it
//   3. a finished car RESETS with its fuel intact, so the car is the tank
//   4. a reset lands on exactly ONE constant state, which is what lets the depot check a car by hash
//   5. only the owner may burn — the upgrade path, and the only branch that pays anybody
import {
  freshPublicShell, publicLoadCar, publicReset, isAtRest, ownerMayBurn, PUBLIC_TRANSITIONS,
} from '../src/publicShell.ts'
import {
  emptyShell, loadTrack, arm, refTick, stateFits, FIELDS, PHASE, PHASE_NAMES, ShellRefused,
  RACER_REGS as R, S, type ShellState,
} from '../src/shell.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const refused = (n: string, f: () => unknown): void => {
  try { f(); check(n, false) } catch (e) { check(n, e instanceof ShellRefused) }
}
const OWNER = Array.from({ length: 20 }, (_, i) => i + 1)
const STRANGER = Array.from({ length: 20 }, (_, i) => 200 - i)
const eq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

console.log('THE PUBLIC CAR — the reference state machine\n')

// ── 1. OWNED FROM BIRTH ───────────────────────────────────────────────────────────────────────────
// The hole this closes: an EMPTY shell with a zero driver is claimable by anyone, which is correct for
// an owned car and fatal for a public one holding donated fuel.
{
  const car = freshPublicShell(OWNER)
  check('a fresh public car carries its owner', eq(car.driver, OWNER))
  check('  …and is otherwise empty', FIELDS.filter(k => k !== 'driver')
    .every(k => Array.isArray(car[k]) ? (car[k] as number[]).every(b => b === 0) : car[k] === 0))
  check('  …and it fits its fields', stateFits(car) === null)
  refused('★ an owner of twenty zero bytes is REFUSED — that is an unclaimed shell', () => freshPublicShell(new Array(20).fill(0)))
  refused('  a short owner is refused', () => freshPublicShell([1, 2, 3]))
}

// ── 2. CONFIGURING IS NOT OWNING ──────────────────────────────────────────────────────────────────
// The next driver rebuilds the car. They never acquire it, and there is no argument by which they could.
{
  const car = freshPublicShell(OWNER)
  const built = publicLoadCar(car, { eng: 14, tyr: 10 }, R)
  check('★ loading a car leaves the owner untouched', eq(built.driver, OWNER))
  check('  the engine and tyres are set', built.eng === 14 && built.tyr === 10)
  check('  the phase advanced', built.phase === PHASE.CAR)
  refused('an ownerless shell cannot be configured as a public car',
    () => publicLoadCar(emptyShell(), { eng: 14, tyr: 10 }, R))
}

// ── 3 & 4. A FINISHED CAR RESETS, AND LANDS ON ONE CONSTANT ───────────────────────────────────────
// Run a real race to a real finish, then reset it, and require the result to be indistinguishable from
// a car that has never turned a wheel. That indistinguishability IS the depot's one-hash check.
{
  let st: ShellState = arm(loadTrack(publicLoadCar(freshPublicShell(OWNER), { eng: 14, tyr: 10 }, R),
    { finish: Math.round(60 * S), slip: 1000, green: 1_700_000_000, gap: 1, pool: new Array(36).fill(0) }))

  let ticks = 0
  while (st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && ticks < 200) {
    st = refTick(st, { throttle: 6, lockTime: Math.max(st.green, st.last + st.gap), fuel: 12_000 }, R).state
    ticks++
  }
  check('a public car races to a finish', st.phase === PHASE.DONE, true)
  console.log(`        ${ticks} ticks · ${(st.s / S).toFixed(0)} m · phase ${PHASE_NAMES[st.phase]}`)

  const after = publicReset(st)
  check('★ a finished car RESETS', after.phase === PHASE.EMPTY)
  check('★ …to exactly the constant the depot pins', isAtRest(after, OWNER))
  check('  the owner survives the reset', eq(after.driver, OWNER))

  // every other field must be back to zero — asserted one by one, because "looks reset" is not reset
  const dirty = FIELDS.filter(k => k !== 'driver')
    .filter(k => Array.isArray(after[k]) ? (after[k] as number[]).some(b => b !== 0) : after[k] !== 0)
  check('  and NOTHING else survives it', dirty.length === 0)
  if (dirty.length) console.log('        still carrying:', dirty.join(', '))

  // ★ and it can be rebuilt differently and raced again — the whole point of a reusable car
  const rebuilt = publicLoadCar(after, { eng: 22, tyr: 4 }, R)
  check('★ the next driver rebuilds it to their own spec', rebuilt.eng === 22 && rebuilt.tyr === 4)
  check('  …and still does not own it', eq(rebuilt.driver, OWNER))
}

// ── ★ THE RESET IS AVAILABLE FROM EVERY PHASE ─────────────────────────────────────────────────────
// This block used to assert the OPPOSITE — that only a DONE or OUT car could be reset, on the grounds
// that a mid-race reset is a free undo. That rule was deleted, and the reason it had to go is the
// SECOND thing tested here: engine and tyres load on EMPTY → CAR, so reset is the only road back to
// the start. A reset legal only at the END is a car nobody can set up at the BEGINNING.
//
// It protected nothing in any case: a public car has no pot and no branch that pays a driver, so an
// undo takes money from no one. It spends the owner's satoshis and returns no time for them.
for (const [name, phase] of [['EMPTY', PHASE.EMPTY], ['CAR', PHASE.CAR], ['TRACK', PHASE.TRACK],
                             ['ARMED', PHASE.ARMED], ['RACING', PHASE.RACING], ['DONE', PHASE.DONE],
                             ['OUT', PHASE.OUT]] as [string, ShellState['phase']][]) {
  // dirty in every field a race could have touched, so "reset" cannot pass by accident
  const dirty = { ...freshPublicShell(OWNER), phase, eng: 22, tyr: 4, last: 1_700_000_099, n: 37, s: 999, v: 42 }
  check(`  a ${name} car resets`, publicReset(dirty).phase === PHASE.EMPTY)
  check(`  …to the one constant`, isAtRest(publicReset(dirty), OWNER))
}

// ★ THE ONE THAT PAYS FOR THE RULE'S REMOVAL: a car somebody else configured can be taken back to
// EMPTY and rebuilt to a different spec, WITHOUT ever racing it. That is what "reconfigurable before a
// race" means, and it was impossible while reset was a terminal-only transition.
{
  const theirs = publicLoadCar(freshPublicShell(OWNER), { eng: 3, tyr: 1 }, R)
  const mine = publicLoadCar(publicReset(theirs), { eng: 22, tyr: 10 }, R)
  check('★ a car another driver set up can be reset and rebuilt, without racing it',
    mine.eng === 22 && mine.tyr === 10)
  check('  …and the owner still survives it', eq(mine.driver, OWNER))
}

// ★ AND IT UN-BRICKS A CAR. `gap` has no upper bound, so one transaction can put the next legal move
// sixty-eight years away. Capping it would cost bytes on every move of every race; the reset clears it
// for nothing, because the timing gate keys on the NEW phase and a reset car is no longer RACING.
{
  const bricked = { ...freshPublicShell(OWNER), phase: PHASE.RACING, gap: 2_147_483_647, last: 1_700_000_000 }
  check('★ a car bricked with a 68-year gap resets anyway', isAtRest(publicReset(bricked), OWNER))
}

// ── 5. ONLY THE OWNER MAY BURN ────────────────────────────────────────────────────────────────────
// The refusal matters more than the permission: every other property of a public car holds just as
// well if this branch is wide open.
{
  const car = freshPublicShell(OWNER)
  check('★ a STRANGER may not burn a public car', ownerMayBurn(car, STRANGER), false)
  check('★ the owner may', ownerMayBurn(car, OWNER))
  check('  a truncated hash is not the owner', ownerMayBurn(car, OWNER.slice(0, 19)), false)
  check('  one byte different is not the owner',
    ownerMayBurn(car, OWNER.map((b, i) => (i === 7 ? b ^ 1 : b))), false)
}

// ── every phase has a way out ─────────────────────────────────────────────────────────────────────
// The property that stops any configuration of a car being a trap holding money.
{
  const stuck = Object.entries(PUBLIC_TRANSITIONS).filter(([, ways]) => ways.length === 0)
  check('★ no phase is a dead end', stuck.length === 0)
  const noBurn = Object.entries(PUBLIC_TRANSITIONS).filter(([, w]) => !w.includes('owner burn'))
  check('  and every phase can be retired to a successor', noBurn.length === 0)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('PUBLIC REF: FAIL — the state machine is wrong; do not write Script'); process.exit(1) }
console.log('PUBLIC REF OK — owned from birth, driven by anyone, reset to one constant, burnt only by its owner.')
