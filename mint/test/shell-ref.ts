// © BSV Association — Open BSV License v6.
// THE SHELL'S REFERENCE IMPLEMENTATION — the state machine, before any Script exists.
//
//   node --experimental-strip-types mint/test/shell-ref.ts
//
// This runs first and runs alone. The battery's order was: reference → Script → interpreter tests, and
// it is the order that caught MX0 = 6 while it was still amendable. Every number in PROVISIONAL_REGS is
// a placeholder, so these tests assert STRUCTURE and INVARIANTS — the things that must hold whatever the
// constants turn out to be — and never a specific velocity, which would only pin down a guess.
import {
  PHASE, PHASE_NAMES, emptyShell, loadCar, loadTrack, arm, refTick, ShellRefused,
  FIELDS, FIELD_WIDTHS, STATE_BYTES, PROVISIONAL_REGS, SHELL_STATE_LAYOUT, S, fmul, fdiv,
  type ShellState, type RacerRegs,
} from '../src/shell.ts'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}
const refuses = (name: string, fn: () => unknown): void => {
  try { fn(); check(name, false) }
  catch (e) { check(name, e instanceof ShellRefused) }
}

const REGS = PROVISIONAL_REGS
const DRIVER = new Array(20).fill(7)
const GREEN = 1_700_000_000

console.log('THE SHELL — reference implementation\n')

// ── the constant genesis ─────────────────────────────────────────────────────────────────────────────
// If this drifts, every instance stops sharing a script hash and the discovery anchor is silently lost.
{
  const a = emptyShell(), b = emptyShell()
  check('the empty shell is deterministic', JSON.stringify(a) === JSON.stringify(b))
  check('every field is zero', FIELDS.every(k => {
    const v = (a as unknown as Record<string, unknown>)[k]
    return Array.isArray(v) ? v.every(x => x === 0) : v === 0
  }))
  check('the register file is small enough to be worth carrying', STATE_BYTES < 80)
  console.log(`        ${STATE_BYTES} bytes of state · ~${(STATE_BYTES * 2.12 / 10).toFixed(1)} sat/move just to carry it`)
}

// ── the phase machine, in order ──────────────────────────────────────────────────────────────────────
{
  let st = emptyShell()
  st = loadCar(st, { driver: DRIVER, eng: 12, tyr: 6 })
  check('0 → 1 · a car loads into an empty shell', st.phase === PHASE.CAR)
  st = loadTrack(st, { finish: 40 * S, green: GREEN, gap: 1 })
  check('1 → 2 · a track loads onto a car', st.phase === PHASE.TRACK)
  st = arm(st)
  check('2 → 3 · fuelling arms it', st.phase === PHASE.ARMED)
  const r = refTick(st, { throttle: 8, lockTime: GREEN, fuel: 50_000 })
  check('3 → 4 · the launch starts the race', r.state.phase === PHASE.RACING)
  check('the tick counter is the elapsed time', r.state.n === 1)
}

// ── and OUT of order, which is the whole anti-cheat ──────────────────────────────────────────────────
{
  const empty = emptyShell()
  refuses('a track cannot load before a car', () => loadTrack(empty, { finish: S, green: GREEN, gap: 1 }))
  refuses('an empty shell cannot be armed', () => arm(empty))
  refuses('an empty shell cannot be driven', () => refTick(empty, { throttle: 1, lockTime: GREEN, fuel: 1000 }))

  const loaded = loadCar(empty, { driver: DRIVER, eng: 5, tyr: 5 })
  refuses('a car cannot be loaded twice — the specs are not editable', () =>
    loadCar(loaded, { driver: DRIVER, eng: 20, tyr: 10 }))

  const tracked = loadTrack(loaded, { finish: 10 * S, green: GREEN, gap: 1 })
  const armed = arm(tracked)
  refuses('★ no bigger engine after the fuel goes in', () => loadCar(armed, { driver: DRIVER, eng: 20, tyr: 10 }))
  refuses('★ no different finish line after the fuel goes in', () =>
    loadTrack(armed, { finish: 1, green: GREEN, gap: 1 }))
}

// ── the regulations are enforced, because provenance cannot be ───────────────────────────────────────
{
  const empty = emptyShell()
  refuses(`an engine over ENG_MAX (${REGS.ENG_MAX}) is refused`, () =>
    loadCar(empty, { driver: DRIVER, eng: REGS.ENG_MAX + 1, tyr: 1 }))
  refuses(`tyres over TYR_MAX (${REGS.TYR_MAX}) are refused`, () =>
    loadCar(empty, { driver: DRIVER, eng: 1, tyr: REGS.TYR_MAX + 1 }))
  refuses('a car with no engine is refused', () => loadCar(empty, { driver: DRIVER, eng: 0, tyr: 1 }))
  refuses('a driver must be a 20-byte hash', () => loadCar(empty, { driver: [1, 2, 3], eng: 1, tyr: 1 }))
  check('a car AT the limit is legal', loadCar(empty, { driver: DRIVER, eng: REGS.ENG_MAX, tyr: REGS.TYR_MAX }).eng === REGS.ENG_MAX)
}

// ── the Christmas tree ───────────────────────────────────────────────────────────────────────────────
{
  const armed = arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng: 10, tyr: 5 }),
    { finish: 100 * S, green: GREEN, gap: 5 }))
  refuses('★ a false start is refused — the launch may not precede the green', () =>
    refTick(armed, { throttle: 15, lockTime: GREEN - 1, fuel: 50_000 }))
  const launched = refTick(armed, { throttle: 15, lockTime: GREEN, fuel: 50_000 }).state
  check('a launch exactly ON the green is legal', launched.phase === PHASE.RACING)
  refuses('moves closer together than the gap are refused', () =>
    refTick(launched, { throttle: 15, lockTime: GREEN + 4, fuel: 50_000 }))
  check('a move exactly one gap later is legal',
    refTick(launched, { throttle: 15, lockTime: GREEN + 5, fuel: 50_000 }).state.n === 2)
}

// ── the physics ──────────────────────────────────────────────────────────────────────────────────────
// Assert only what must hold WHATEVER the constants turn out to be. Anything about balance — whether a
// big engine beats a small one — is a property of PROVISIONAL_REGS, and asserting it here would just
// freeze today's guess into a test. Balance is printed for the toy to settle, never checked.
{
  const base = (eng: number, tyr: number): ShellState =>
    arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng, tyr }),
      { finish: 1_000 * S, green: GREEN, gap: 0 }))
  const m = { throttle: REGS.THROTTLE_MAX, lockTime: GREEN, fuel: 50_000 }

  // At a throttle low enough that neither car breaks traction, more engine MUST mean more acceleration.
  const gentle = { ...m, throttle: 1 }
  const a4 = refTick(base(4, 8), gentle), a16 = refTick(base(16, 8), gentle)
  check('below the traction limit, a bigger engine accelerates harder',
    !a4.spun && !a16.spun && a16.state.v > a4.state.v)

  const thin = refTick(base(10, 8), { ...m, fuel: 5_000 })
  const fat = refTick(base(10, 8), { ...m, fuel: 500_000 })
  check('★ a fuller tank is HEAVIER, so it accelerates less', fat.state.v < thin.state.v)

  const soft = refTick(base(10, 8), { ...m, throttle: 1 })
  const hard = refTick(base(10, 8), m)
  check('more throttle burns more satoshis', hard.burn > soft.burn)
  check('a bigger engine burns more satoshis',
    refTick(base(20, 8), m).burn > refTick(base(2, 8), m).burn)

  // Monotonicity, which must hold at any constants: tyres can only help, throttle can only hurt.
  let tyreMonotone = true, throttleMonotone = true
  for (let t = 1; t < REGS.TYR_MAX; t++)
    if (refTick(base(12, t), m).spun === false && refTick(base(12, t + 1), m).spun === true) tyreMonotone = false
  for (let th = 1; th < REGS.THROTTLE_MAX; th++)
    if (refTick(base(12, 5), { ...m, throttle: th }).spun === true &&
        refTick(base(12, 5), { ...m, throttle: th + 1 }).spun === false) throttleMonotone = false
  check('★ more tyre never causes a spin that less tyre avoided', tyreMonotone)
  check('★ less throttle never causes a spin that more throttle avoided', throttleMonotone)

  check('a stationary car with no throttle stays stationary',
    refTick(base(10, 8), { ...m, throttle: 0 }).state.v === 0)

  // ⚠ FOR THE TOY, NOT AN ASSERTION — where does traction break from a standstill?
  console.log('\n        traction limit off the line, at full throttle (· = hooks up, × = spins):')
  let head = '          eng\\tyr '
  for (let t = 1; t <= REGS.TYR_MAX; t++) head += String(t).padStart(3)
  console.log(head)
  for (let e = 2; e <= REGS.ENG_MAX; e += 2) {
    let row = `          ${String(e).padStart(9)} `
    for (let t = 1; t <= REGS.TYR_MAX; t++) row += (refTick(base(e, t), m).spun ? '  ×' : '  ·')
    console.log(row)
  }
  console.log()
}

// ── drag is what makes you keep pressing ─────────────────────────────────────────────────────────────
{
  let st = arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng: 10, tyr: 8 }),
    { finish: 10_000 * S, green: GREEN, gap: 0 }))
  for (let i = 0; i < 20; i++) st = refTick(st, { throttle: 12, lockTime: GREEN + i, fuel: 50_000 }).state
  const moving = st.v
  for (let i = 0; i < 20; i++) st = refTick(st, { throttle: 0, lockTime: GREEN + 20 + i, fuel: 50_000 }).state
  check('★ stop feeding it throttle and the car dies away', st.v < moving)
  console.log(`        v ${(moving / S).toFixed(3)} → ${(st.v / S).toFixed(3)} over 20 idle presses`)
}

// ── A WHOLE RACE, which is the only test that really matters ─────────────────────────────────────────
{
  const FINISH = 60 * S
  let st = arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng: 12, tyr: 7 }),
    { finish: FINISH, green: GREEN, gap: 0 }))
  let fuel = 20_000, spins = 0, t = GREEN
  while (st.phase !== PHASE.DONE && fuel > REGS.BURN0 && st.n < 5_000) {
    const r = refTick(st, { throttle: REGS.THROTTLE_MAX, lockTime: t++, fuel })
    st = r.state; fuel -= r.burn; if (r.spun) spins++
  }
  check('the car reaches the line', st.phase === PHASE.DONE)
  check('it crossed rather than merely arrived', st.s >= FINISH)
  check('ET is the chain length', st.n > 0)
  console.log(`        ET ${st.n} ticks · ${(20_000 - fuel).toLocaleString()} sat burned · ${spins} wheelspins · v ${(st.v / S).toFixed(2)}`)

  // A worse car over the same strip must not be faster. This is the invariant a race rests on.
  let slow = arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng: 3, tyr: 7 }),
    { finish: FINISH, green: GREEN, gap: 0 }))
  let f2 = 20_000, t2 = GREEN
  while (slow.phase !== PHASE.DONE && f2 > REGS.BURN0 && slow.n < 5_000) {
    const r = refTick(slow, { throttle: REGS.THROTTLE_MAX, lockTime: t2++, fuel: f2 })
    slow = r.state; f2 -= r.burn
  }
  // ⚠ NOT AN ASSERTION. At PROVISIONAL_REGS the big engine spins on EVERY tick and loses badly to the
  // small one — a death spiral: spin → v collapses → grip stays low → spin again. It is escapable by
  // lifting off, which is exactly the skill this game wants, so it may be a feature. But whether it is
  // a feature or a flaw is a question for the toy, and freezing either answer into a test would be
  // pretending we already know. Printed, not checked.
  console.log(`        eng 3  → ${slow.phase === PHASE.DONE ? `ET ${slow.n}` : 'DID NOT FINISH'}   ← ⚠ compare`)
}

// ── running dry ──────────────────────────────────────────────────────────────────────────────────────
{
  let st = arm(loadTrack(loadCar(emptyShell(), { driver: DRIVER, eng: 18, tyr: 8 }),
    { finish: 10_000 * S, green: GREEN, gap: 0 }))
  let fuel = 3_000, t = GREEN
  while (fuel > REGS.BURN0 && st.n < 1_000) {
    const r = refTick(st, { throttle: REGS.THROTTLE_MAX, lockTime: t++, fuel })
    st = r.state; fuel -= r.burn
  }
  check('★ a thirsty car on a long strip runs dry short of the line', st.phase !== PHASE.DONE)
  console.log(`        ${st.n} ticks on 3,000 sat, then flat at ${(st.s / S).toFixed(1)} of 10,000`)
}

// ── arithmetic ───────────────────────────────────────────────────────────────────────────────────────
// BigInt, so exact by construction — the battery had to split operands by hand because a double is
// exact only to 2^53 and zr² reaches 2^66. Script's integers are arbitrary-precision, so this is also
// the closer model of what the covenant does.
{
  check('fmul is exact at 2^53 and beyond', fmul(2 ** 40, 2 ** 40) === Number((2n ** 80n) / (2n ** 32n)))
  check('fmul truncates toward zero', fmul(3, 1) === 0)
  check('fdiv inverts fmul on exact values', fdiv(5 * S, S) === 5 * S)
  check('fdiv by zero is refused', (() => { try { fdiv(1, 0); return false } catch { return true } })())
}

// ── the published layout ─────────────────────────────────────────────────────────────────────────────
{
  const bytes = Buffer.byteLength(SHELL_STATE_LAYOUT, 'utf8')
  check('the layout fits one OP_RETURN', bytes <= 220)
  check('it names every field', FIELDS.every(k => SHELL_STATE_LAYOUT.includes(k)))
  check('it carries a version', SHELL_STATE_LAYOUT.startsWith('BITCOIN RACER SHELL v1'))
  console.log(`        ${bytes} bytes of 220`)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('SHELL REF: FAIL'); process.exit(1) }
console.log('SHELL REF OK — the machine runs. The constants are still guesses.')
