// © 2026 sun-dive — Apache License 2.0.
// ★★ BASIC → SCRIPT — does the translated program compute what the reference computes?
//
//   node --experimental-strip-types mint/test/basic.ts
//
// Not "does it emit plausible opcodes" but "does a NODE agree with `refTick`'s arithmetic". Every case
// below runs through `Spend`, the interpreter from @bsv/sdk — the same one that decides a real spend.
//
// ⚠ THE FIXTURE IS A REAL LINE OF THE CAR. The point is not that a toy expression compiles; it is that
// the physics already on mainnet can be WRITTEN in BASIC and come out the same. Anything less is a demo.
import { Transaction, Spend, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import { compileBasic } from '../src/basic.ts'
import { RACER_REGS as R, S, fmul, fdiv, SLIP_UNIT, buildShellLock, emptyShell } from '../src/shell.ts'
import { op, PN } from '../src/covenantAsm.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

/**
 * Run a compiled program for real: the unlocking script pushes the inputs, the locking script is the
 * translated ops followed by "does the top equal what we expected".
 *
 * ⚠ THE INPUTS ARE PUSHED BOTTOM-FIRST, in the same order as the env's stack list, because that IS the
 * stack the compiler resolved its names against. Reverse them and every name silently reads a neighbour.
 */
function runs(src: string, env: { stack: string[]; consts?: Record<string, number> },
              inputs: number[], expected: number): { ok: boolean; why?: string; bytes: number } {
  const { ops } = compileBasic(src, env)
  const lock = new LockingScript([...ops, PN(expected), op(OP.OP_NUMEQUAL)])
  const unlock = new UnlockingScript(inputs.map(n => PN(n)))
  const src2 = new Transaction(); src2.addOutput({ lockingScript: lock, satoshis: 1 })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src2, sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: unlock })
  tx.addOutput({ lockingScript: new LockingScript([]), satoshis: 1 })
  try {
    const ok = new Spend({
      sourceTXID: src2.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
    return { ok, bytes: new LockingScript(ops).toBinary().length }
  } catch (e) {
    return { ok: false, why: (e as Error).message.split('\n')[0], bytes: new LockingScript(ops).toBinary().length }
  }
}

console.log('\nBASIC → SCRIPT — the translated program, run by the interpreter\n')

// ── 1. arithmetic, precedence and parentheses ────────────────────────────────────────────────────────
{
  const env = { stack: ['a', 'b'] }
  const cases: Array<[string, number[], number]> = [
    ['x = a + b * 2', [3, 4], 3 + 4 * 2],
    ['x = (a + b) * 2', [3, 4], (3 + 4) * 2],
    ['x = a - b - 1', [10, 3], 10 - 3 - 1],          // left-associative, or this is 8
    ['x = a * b / 2', [7, 6], Math.trunc(7 * 6 / 2)],
    ['x = 0 - a', [5, 0], -5],
    ['x = MIN(a, b) + MAX(a, b)', [4, 9], 13],
    ['x = ABS(0 - a)', [6, 0], 6],
  ]
  let ok = 0
  for (const [src, inp, want] of cases) {
    const r = runs(src, env, inp, want)
    if (r.ok) ok++
    else console.log(`        ⚠ ${src} → expected ${want} · ${r.why ?? 'refused'}`)
  }
  check(`★ ${cases.length} expressions compile and evaluate correctly`, ok === cases.length)
  console.log('        precedence, parentheses, left-associativity, MIN/MAX/ABS')
}

// ── 2. ★★ A REAL LINE OF THE CAR — and it must agree with the reference, not merely run ─────────────
console.log()
{
  /* The tick's own arithmetic, transcribed. `refTick` computes exactly this in TypeScript, and
     `shellPhysicsOps` emits it by hand in Script; this is the third way of saying it. */
  const PROGRAM = `
    REM  one press of the accelerator
    grip   = (tyr * G0 + FMUL(v, GV)) * slip / SLIP
    demand = eng * FE * throttle / TM
    IF demand > grip THEN force = grip ELSE force = demand
    nv = v + FDIV(force, mass) - FMUL(v, DRAG)
  `
  const env = {
    stack: ['v', 'tyr', 'slip', 'eng', 'throttle', 'mass', 'grip', 'demand', 'force'],
    consts: { G0: R.G0, GV: R.GV, FE: R.FE, TM: R.THROTTLE_MAX, DRAG: R.DRAG, SLIP: SLIP_UNIT },
  }

  let agreed = 0, tried = 0, firstBad = ''
  for (const [v, tyr, slip, eng, throttle] of [
    [0, 10, 1000, 14, 8], [Math.round(2 * S), 10, 1000, 14, 8], [Math.round(4 * S), 2, 600, 20, 16],
    [Math.round(1 * S), 6, 1800, 8, 3], [Math.round(3.5 * S), 10, 1000, 24, 12], [0, 1, 400, 1, 0],
  ] as Array<[number, number, number, number, number]>) {
    const mass = Math.round(R.M0 + eng * R.WE + tyr * R.WT)      // ⚠ any positive mass; the divide is what matters
    // the reference, in TypeScript — the same functions the covenant is validated against
    const grip = Math.trunc(((tyr * R.G0 + fmul(v, R.GV)) * slip) / SLIP_UNIT)
    const demand = Math.trunc((eng * R.FE * throttle) / R.THROTTLE_MAX)
    const force = demand > grip ? grip : demand
    const want = v + fdiv(force, mass) - fmul(v, R.DRAG)

    tried++
    const r = runs(PROGRAM, env, [v, tyr, slip, eng, throttle, mass, 0, 0, 0], want)
    if (r.ok) agreed++
    else if (!firstBad) firstBad = `v ${v} tyr ${tyr} slip ${slip} eng ${eng} th ${throttle} → want ${want} · ${r.why ?? 'refused'}`
  }
  check(`★★★ the translated physics agrees with the reference on all ${tried} cases`, agreed === tried)
  if (firstBad) console.log(`        first disagreement: ${firstBad}`)

  const { ops, assigned } = compileBasic(PROGRAM, env)
  console.log(`        ${new LockingScript(ops).toBinary().length} bytes of Script from 4 lines of BASIC`)
  console.log(`        assigned: ${assigned.join(', ')}`)
}

// ── 3. ★★ THE BRANCH BALANCING — the whole reason this is worth building ────────────────────────────
// In hand-written Script both arms of an OP_IF must leave the stack IDENTICAL. Getting it wrong is
// silent: it surfaces hundreds of opcodes later as a split complaining about a size. The compiler takes
// the union of what either arm assigns and makes both arms produce all of it.
console.log()
{
  const env = { stack: ['a', 'b', 'p', 'q'] }
  /* ⚠ `p` is assigned ONLY in the THEN arm and `q` ONLY in the ELSE arm. Hand-written, that is exactly
     the bug — one arm leaves an extra item. Here both arms must come out carrying p and q. */
  /* ⚠ THE `r = …` MUST BE ON ITS OWN LINE. An IF is LINE-SCOPED in BASIC — put it after a colon and it
     belongs to the ELSE arm, which is what this fixture did at first and what the compiler correctly
     complained about. The rule caught the test rather than the other way round. */
  const SRC = 'IF a > b THEN p = 1 ELSE q = 2\n r = p * 10 + q'
  const taken = runs(SRC, env, [5, 3, 7, 9], 1 * 10 + 9)
  const other = runs(SRC, env, [3, 5, 7, 9], 7 * 10 + 2)
  check('★★ a variable assigned in ONE arm only — the THEN path is correct', taken.ok)
  check('★★ …and so is the ELSE path, with the other variable untouched', other.ok)
  console.log('        THEN: p becomes 1, q stays 9   ·   ELSE: p stays 7, q becomes 2')

  /* ⚠ AND THE ARMS REALLY DO BALANCE — if they did not, everything after the ENDIF would read the
     wrong slot. `r` is computed AFTER the branch from both variables, so a stack that came out uneven
     would produce a wrong number rather than an error. That is the failure mode being ruled out. */
  const nested = runs(
    'IF a > b THEN IF a > 100 THEN p = 1 ELSE p = 2\n r = p', env, [5, 3, 0, 0], 2)
  check('★ nested branches balance too', nested.ok)
}

// ── 4. ⚠ AND IT REFUSES WHAT IT CANNOT DO, BY NAME ──────────────────────────────────────────────────
console.log()
{
  const bad = (src: string, env: any): string => {
    try { compileBasic(src, env); return '' } catch (e) { return (e as Error).message }
  }
  const m1 = bad('x = notAThing + 1', { stack: ['a'] })
  check('★ an unknown variable fails at COMPILE time, and names itself', m1.includes('notAThing'))
  console.log(`        ${m1}`)
  const m2 = bad('IF a > 1 THEN zz = 1 ELSE zz = 2', { stack: ['a'] })
  check('★★ a variable that exists only inside a branch is refused', m2.includes('zz'))
  console.log(`        ${m2}`)
  const m3 = bad('x = FMUL(1)', { stack: ['a'] })
  check('  …and a word given the wrong number of arguments', m3.includes('FMUL'))
  const m4 = bad('x = WOBBLE(1, 2)', { stack: ['a'] })
  check('  …and a word that does not exist', m4.includes('WOBBLE'))
}

// ── 5. ★★ FOR … NEXT, UNROLLED AT COMPILE TIME ──────────────────────────────────────────────────────
// Script has no backward jump, so a program's LENGTH is its work. A constant bound does not need one:
// the compiler is the loop. Every case here runs through `Spend` — the arithmetic is what is being
// checked, not the opcode count.
console.log()
{
  const env = { stack: ['s'] }
  const cases: Array<[string, string, number[], number]> = [
    ['a plain count', 'FOR i = 1 TO 5\n s = s + i\n NEXT i', [0], 15],
    ['the counter folds into the body', 'FOR i = 1 TO 4\n s = s + i * i\n NEXT', [0], 30],
    ['STEP', 'FOR i = 0 TO 10 STEP 2\n s = s + i\n NEXT i', [0], 2 + 4 + 6 + 8 + 10],
    ['STEP counts down', 'FOR i = 10 TO 1 STEP -3\n s = s + i\n NEXT i', [0], 10 + 7 + 4 + 1],
    ['nested loops multiply out', 'FOR i = 1 TO 3\n FOR j = 1 TO 3\n s = s + i * j\n NEXT j\n NEXT i', [0], 36],
    ['an IF inside the body', 'FOR i = 1 TO 6\n IF i > 3 THEN s = s + i\n NEXT i', [0], 4 + 5 + 6],
    ['zero trips run the body no times', 'FOR i = 1 TO 0\n s = s + 999\n NEXT i', [7], 7],
    ['a single-line FOR', 'FOR i = 1 TO 3 : s = s + i : NEXT i', [0], 6],
  ]
  let ok = 0
  for (const [name, src, inp, want] of cases) {
    const r = runs(src, env, inp, want)
    if (r.ok) ok++
    else console.log(`        ⚠ ${name} → expected ${want} · ${r.why ?? 'refused'}`)
  }
  check(`★★ ${cases.length} unrolled loops compute the right answer`, ok === cases.length)
  console.log('        count · fold · STEP up · STEP down · nested · IF inside · zero-trip · one-liner')

  /* ⚠⚠ THE FAILURE THIS FEATURE EXISTS TO SURVIVE. `Asm.rename` shadows rather than replaces, so before
     `coalesce` every iteration left a corpse on the stack: the depth grew without bound, every OP_PICK
     offset grew with it, and one-byte pushes turned into two. The proof is that the stack the compiler
     hands back is the SAME SIZE after a hundred iterations as after one — and that the per-iteration
     cost is therefore FLAT rather than creeping upward. */
  const growth = (n: number): { depth: number; bytes: number } => {
    const r = compileBasic(`FOR i = 1 TO ${n}\n s = s + i\n NEXT i`, { stack: ['s'] })
    return { depth: r.stack.length, bytes: new LockingScript(r.ops).toBinary().length }
  }
  const g1 = growth(1), g10 = growth(10), g100 = growth(100)
  check('★★★ the stack does not grow with the trip count', g1.depth === 1 && g10.depth === 1 && g100.depth === 1)
  const per10 = (g100.bytes - g10.bytes) / 90, per1 = (g10.bytes - g1.bytes) / 9
  check('★★ …so the cost per iteration is flat, not creeping', per10 === per1)
  console.log(`        1 trip ${g1.bytes} B · 10 trips ${g10.bytes} B · 100 trips ${g100.bytes} B` +
    `  ⇒ ${per1} B per iteration, stack depth ${g100.depth} throughout`)
}

// ── 6. ⚠ AND THE UNROLL REFUSES WHAT CANNOT BE UNROLLED ─────────────────────────────────────────────
// A trip count that is not known until the script runs cannot be laid down at compile time. Saying so
// by name is the whole difference between a translator and a trap.
console.log()
{
  const bad = (src: string, env: any): string => {
    try { compileBasic(src, env); return '' } catch (e) { return (e as Error).message }
  }
  const m1 = bad('FOR i = 1 TO n\n s = s + i\n NEXT i', { stack: ['s', 'n'] })
  check('★★ a bound that is a stack value is refused, and says why', m1.includes('COMPILE time'))
  console.log(`        ${m1.slice(0, 96)}…`)
  const m2 = bad('FOR i = 1 TO 3\n i = i + 1\n NEXT i', { stack: ['s'] })
  check('★ the counter cannot be assigned — it is a constant in the body', m2.includes('counter'))
  const m3 = bad('FOR i = 1 TO 3\n s = s + 1', { stack: ['s'] })
  check('★ a FOR with no NEXT', m3.includes('NEXT'))
  const m4 = bad('FOR i = 1 TO 3\n s = s + 1\n NEXT j', { stack: ['s'] })
  check('★ a NEXT that closes a different loop', m4.includes('NEXT j'))
  const m5 = bad('FOR i = 1 TO 3 STEP 0\n s = s + 1\n NEXT i', { stack: ['s'] })
  check('★ STEP 0 has no trip count', m5.includes('STEP 0'))
  const m6 = bad('FOR s = 1 TO 3\n x = s\n NEXT s', { stack: ['s'] })
  check('★★ a counter that would shadow a real variable is refused', m6.includes('shadow'))
  const m7 = bad('FOR i = 1 TO 1000000\n s = s + 1\n NEXT i', { stack: ['s'] })
  check('★★ the fuse holds — a million trips refuses instantly', m7.includes('fuse'))
  console.log(`        ${m7.slice(0, 96)}…`)
  const m8 = bad('IF s > 1 THEN FOR i = 1 TO 3\n s = s + 1\n NEXT i', { stack: ['s'] })
  check('★ a FOR inside a line-scoped IF arm is refused rather than mis-parsed', m8.includes('line-scoped'))
  const m9 = bad('s = s + 1\n NEXT i', { stack: ['s'] })
  check('  …and a NEXT with no FOR', m9.includes('no FOR'))
}

// ── 7. ★★★ THE CAR'S OWN PHYSICS, UNROLLED — many ticks in ONE script ───────────────────────────────
// Section 2 proved one tick agrees with the reference. This runs the same four lines N times over, with
// `v` carrying forward, and asks the interpreter for the velocity after all of them. It is the shape a
// whole race in one transaction would take.
console.log()
{
  const BODY = `
    grip   = (tyr * G0 + FMUL(v, GV)) * slip / SLIP
    demand = eng * FE * throttle / TM
    IF demand > grip THEN force = grip ELSE force = demand
    v = v + FDIV(force, mass) - FMUL(v, DRAG)
  `
  const program = (n: number): string => `FOR t = 1 TO ${n}\n${BODY}\n NEXT t`
  const env = {
    stack: ['v', 'tyr', 'slip', 'eng', 'throttle', 'mass', 'grip', 'demand', 'force'],
    consts: { G0: R.G0, GV: R.GV, FE: R.FE, TM: R.THROTTLE_MAX, DRAG: R.DRAG, SLIP: SLIP_UNIT },
  }

  /** The reference, in TypeScript: the same four lines, N times, `v` carried forward. */
  const refRun = (v0: number, tyr: number, slip: number, eng: number, th: number, mass: number, n: number): number => {
    let v = v0
    for (let t = 0; t < n; t++) {
      const grip = Math.trunc(((tyr * R.G0 + fmul(v, R.GV)) * slip) / SLIP_UNIT)
      const demand = Math.trunc((eng * R.FE * th) / R.THROTTLE_MAX)
      const force = demand > grip ? grip : demand
      v = v + fdiv(force, mass) - fmul(v, R.DRAG)
    }
    return v
  }

  let agreed = 0, tried = 0, firstBad = ''
  for (const n of [1, 2, 5, 12]) {
    for (const [v0, tyr, slip, eng, th] of [
      [0, 10, 1000, 14, 8], [Math.round(2 * S), 2, 600, 20, 16], [0, 6, 1800, 8, 3],
    ] as Array<[number, number, number, number, number]>) {
      const mass = Math.round(R.M0 + eng * R.WE + tyr * R.WT)
      const want = refRun(v0, tyr, slip, eng, th, mass, n)
      tried++
      const r = runs(program(n), env, [v0, tyr, slip, eng, th, mass, 0, 0, 0], want)
      if (r.ok) agreed++
      else if (!firstBad) firstBad = `${n} ticks, v0 ${v0} tyr ${tyr} → want ${want} · ${r.why ?? 'refused'}`
    }
  }
  check(`★★★ the unrolled physics agrees with the reference over 1, 2, 5 and 12 ticks (${tried} cases)`, agreed === tried)
  if (firstBad) console.log(`        first disagreement: ${firstBad}`)

  /* ⚠ AND THE STACK IS THE SAME DEPTH AFTER TWELVE TICKS AS AFTER ONE. `v` is reassigned every tick and
     `force` is reassigned inside a branch every tick; without coalescing, twelve ticks would leave
     twenty-four corpses and every OP_PICK after them would be reaching further. */
  const shape = (n: number): { depth: number; bytes: number } => {
    const r = compileBasic(program(n), env)
    return { depth: r.stack.length, bytes: new LockingScript(r.ops).toBinary().length }
  }
  const s1 = shape(1), s12 = shape(12), s45 = shape(45)
  check('★★ the stack depth is unchanged by the trip count', s1.depth === s12.depth && s12.depth === s45.depth)
  const marginal = (s45.bytes - s12.bytes) / 33
  check('★ …and the marginal cost of a tick is flat', marginal === (s12.bytes - s1.bytes) / 11)
  console.log(`        1 tick ${s1.bytes} B · 12 ticks ${s12.bytes} B · 45 ticks ${s45.bytes} B` +
    `  ⇒ ${marginal} B per extra tick, depth ${s45.depth} throughout`)

  /* ── ★★ WHAT THE UNROLL BUYS, IN LOCKING-SCRIPT BYTES ────────────────────────────────────────────
     The saving is amortising the FRAME — verify the preimage, peel the twelve fields, rebuild, hash,
     compare — which every transaction pays whatever its body does. Measured against the real shipped
     shell lock, not an estimate of one.

     ⚠ THIS IS A LOCK-BYTES RATIO AND NOTHING MORE. It is NOT a fee: a fee has to come from serializing
     a real spend, and the unrolled spend cannot be serialized yet because forty-five per-tick throttle
     values need array indexing (`DIM`), which is not built. Quoting a satoshi figure from this line
     would be hand-counting, and this project has been bitten by that five times. */
  const shipped = buildShellLock({ state: emptyShell() }).toBinary().length
  const N = 45
  const many = N * shipped
  const one = shipped + (N - 1) * marginal
  check('★★ the frame dominates the body — which is WHY unrolling pays', marginal * 10 < shipped)
  console.log(`        shipped shell lock ${shipped} B · this body ${marginal} B ` +
    `⇒ frame is ${Math.round(shipped / marginal)}× the body`)
  console.log(`        ${N} ticks: ${many.toLocaleString()} B across ${N} locks  vs  ` +
    `${Math.round(one).toLocaleString()} B in one  ★ ${(many / one).toFixed(1)}× fewer lock bytes`)
  /* ⚠⚠ AND THIS RATIO IS AN UPPER BOUND, NOT THE RACE'S. The body measured here is the FOUR-LINE core,
     not a whole tick — a tick also does drag², the spin collapse, the floor, the blow checks, position
     and the counter, which is about twice this. A bigger body amortises the frame less well, so the
     real figure is LOWER. And it is lock bytes either way: a transaction also carries an unlocking
     script on both sides of the comparison, which pulls the ratio down again. */
  console.log('        ⚠ upper bound: this is the 4-line core, not a whole tick — and lock bytes, not fee')
  console.log('        ⚠ a fee has to come from serializing a real spend, and that needs DIM first')
}

// ── 8. ★★ LINE NUMBERS — because that is how BASIC is written ───────────────────────────────────────
// Reported from the workbench, first time it was used: `10 x = a + 1` came back as "10 cannot start a
// statement". It is how every machine this language was learned on wanted it typed, and the parser
// refused it. There is no GOTO here, so the number labels nothing — but it must PARSE.
console.log()
{
  const env = { stack: ['a', 'b'] }
  const numbered = runs('10 x = a + b\n20 x = x * 2', env, [3, 4], (3 + 4) * 2)
  check('★★ a numbered program compiles, and computes the same thing', numbered.ok)
  const plain = compileBasic('x = a + b\nx = x * 2', env)
  const withNums = compileBasic('10 x = a + b\n20 x = x * 2', env)
  check('★★★ …and emits BYTE-IDENTICAL script — the numbers are labels, not code',
    new LockingScript(plain.ops).toHex() === new LockingScript(withNums.ops).toHex())
  console.log(`        both ${new LockingScript(plain.ops).toBinary().length} bytes`)
  check('★ numbers on some lines and not others', runs('10 x = a + b\n x = x + 1', env, [3, 4], 8).ok)
  check('★ a numbered FOR loop', runs('10 FOR i = 1 TO 3\n20 x = x + i\n30 NEXT i', { stack: ['x'] }, [0], 6).ok)

  /* ⚠ AND IT MUST STILL REFUSE `IF x THEN 100`. That has meant GOTO 100 since 1964 and this compiler
     cannot do it — swallowing the number as a label would silently drop a jump the author wrote. */
  let m = ''
  try { compileBasic('IF a > b THEN 100', env) } catch (e) { m = (e as Error).message }
  check('★★ …but a GOTO target after THEN is still refused, not swallowed', m.length > 0)
  console.log(`        ${m}`)
}


// ── 9. ★★★ THE MACHINE'S OWN WORDS — closing the gap between the two halves of the page ─────────────
// `unbasic` renders these opcodes with exactly these names. Without them the reader printed a dialect
// the compiler could not parse, which is not a missing feature — it is two halves of one page that did
// not speak the same language. Every case runs through the interpreter.
console.log()
{
  const env = { stack: ['a', 'b'] }
  const cases: Array<[string, string, number[], number]> = [
    ['VERIFY passes and leaves nothing behind', 'VERIFY a > 0\nx = a + b', [3, 4], 7],
    ['MOD', 'x = MOD(a, b)', [17, 5], 2],
    ['WITHIN is [lo, hi)', 'x = WITHIN(a, 0, 10) + WITHIN(b, 0, 10)', [5, 20], 1],
    ['NOT, which had never actually worked', 'x = NOT(a) + NOT(b)', [0, 7], 1],
    ['ISTRUE', 'x = ISTRUE(a) + ISTRUE(b)', [0, 9], 1],
    ['NEGATE and ABS', 'x = ABS(NEGATE(a))', [6, 0], 6],
    /* ⚠ SPLIT WANTS A BYTE STRING, NOT A NUMBER — and the first draft of this test fed it one, which
       the interpreter refused exactly as it should. NUM2BIN is how a number becomes bytes. */
    ['SIZE gives back ONE value', 'f = NUM2BIN(a, 4)\nl, r = SPLIT(f, 2)\nx = SIZE(l) + SIZE(r)', [0, 0], 4],
    ['BITAND on equal-width bytes', 'f = NUM2BIN(a, 2)\ng = NUM2BIN(b, 2)\nx = BIN2NUM(BITAND(f, g))', [12, 10], 8],
    ['BITOR and BITXOR', 'f = NUM2BIN(a, 2)\ng = NUM2BIN(b, 2)\nx = BIN2NUM(BITXOR(f, g))', [12, 10], 6],
  ]
  let ok = 0
  for (const [name, src, inp, want] of cases) {
    const r = runs(src, env, inp, want)
    if (r.ok) ok++
    else console.log(`        ⚠ ${name} → expected ${want} · ${r.why ?? 'refused'}`)
  }
  check(`★★ ${cases.length} programs using the machine's words compute correctly`, ok === cases.length)

  /* ⚠⚠ SAMEBYTES IS NOT `=`. OP_EQUAL compares BYTE STRINGS and OP_NUMEQUAL compares NUMBERS, so a
     four-byte zero and a bare zero are ONE number and TWO different byte strings. Giving them one word
     would erase a distinction that has already cost this project a day. */
  const four = runs('x = 0\nf = NUM2BIN(0, 4)\nz = 0\nx = SAMEBYTES(f, z)', { stack: ['a', 'b'] }, [0, 0], 0)
  check('★★★ SAMEBYTES is bytes, and a padded zero is NOT the bare zero', four.ok)
  const asNum = runs('f = NUM2BIN(0, 4)\nx = BIN2NUM(f) = 0', { stack: ['a', 'b'] }, [0, 0], 1)
  check('★★ …while as NUMBERS the same two are equal', asNum.ok)
  console.log('        one is OP_EQUAL, the other OP_NUMEQUAL — and they answer differently')

  /* ★ SPLIT and CAT are inverses — the cheapest true statement about byte surgery, and the one a
     covenant leans on every time it rebuilds itself out of its own scriptCode. */
  const surgery = runs('f = NUM2BIN(a, 6)\nl, r = SPLIT(f, 2)\nx = SAMEBYTES(CAT(l, r), f)',
    { stack: ['a'] }, [123456], 1)
  check('★★ SPLIT then CAT gives back exactly what went in', surgery.ok)

  const hex = compileBasic('x = &Hdeadbeef', { stack: ['a'] })
  check('★ a hex literal is BYTES, and &H is BASIC’s own spelling',
    new LockingScript(hex.ops).toHex() === '04deadbeef')
  let m = ''
  try { compileBasic('x = &Habc', { stack: ['a'] }) } catch (e) { m = (e as Error).message }
  check('★ an odd number of hex digits is refused — a literal is whole BYTES', m.includes('even number'))
  let m2 = ''
  try { compileBasic('x = SPLIT(a, 2)', { stack: ['a'] }) } catch (e) { m2 = (e as Error).message }
  check('★★ SPLIT with one name says what it needs', m2.includes('two names'))
  console.log(`        ${m2.slice(0, 96)}…`)
}

// ── 10. ★★ BLOCK IF — the other spelling, and it must be the SAME language ──────────────────────────
console.log()
{
  const env = { stack: ['a', 'b', 'p'] }
  check('★ a block IF computes', runs('IF a > b THEN\n p = 1\nELSE\n p = 2\nEND IF', env, [5, 3, 0], 1).ok)
  check('★ ENDIF spelled as one word too', runs('IF a > b THEN\n p = 1\nELSE\n p = 2\nENDIF', env, [3, 5, 0], 2).ok)
  const line = compileBasic('IF a > b THEN p = 1 ELSE p = 2', env)
  const block = compileBasic('IF a > b THEN\n p = 1\nELSE\n p = 2\nEND IF', env)
  check('★★★ the two spellings emit BYTE-IDENTICAL script — one language, two ways to write it',
    new LockingScript(line.ops).toHex() === new LockingScript(block.ops).toHex())
  /* ★ AND THE BLOCK FORM LIFTS A REAL RESTRICTION. A FOR could not live inside a line-scoped arm,
     because the arm ends where the line does and a loop does not. In a block it can. */
  check('★★ a FOR inside a block IF, which the line-scoped form cannot hold',
    runs('IF a > b THEN\n FOR i = 1 TO 3\n  p = p + i\n NEXT i\nEND IF', env, [5, 3, 0], 6).ok)
  let m = ''
  try { compileBasic('IF a > b THEN\n p = 1', env) } catch (e) { m = (e as Error).message }
  check('★ a block that is never closed', m.includes('END IF'))
}

/* ══ ⚠⚠⚠ THE HARD RULE, ENFORCED — a comment is not a guard ═══════════════════════════════════════
   THE COMPILED SCRIPT MUST SAY WHAT THE PROGRAM SAYS. A blanket constant fold was added on 17 Aug to
   collapse the substituted FOR counter and was applied to every expression instead; the damage was
   invisible until a racing car's `demand = eng * FE * 8 / TM` was found on chain as `9620726745` —
   the engine, the force and the throttle all erased, so the decompiler could no longer show what the
   car was. Restored 18 Aug. These checks exist so it cannot come back quietly. */
console.log('\n══ THE HARD RULE — the script says what the program says ══\n')
{
  const arith = (src: string, env: Record<string, unknown> = { stack: [] }): number =>
    compileBasic(src, env as never).ops
      .filter(o => [OP.OP_ADD, OP.OP_SUB, OP.OP_MUL, OP.OP_DIV].includes(o.op as number)).length

  check('★★★ `x = 2 * 3 + 4` emits a MULTIPLY and an ADD — not the number 10',
    arith('x = 2 * 3 + 4') === 2)
  check('★★★ a named constant is substituted, but the arithmetic around it still emits',
    arith('x = K * 3 + 4', { stack: [], consts: { K: 2 } }) === 2)
  check('★★ …and through a chain of assignments, every step emits',
    arith('a = 2\nb = a * 2\nc = b * 2\nd = c * 2') === 3)
  check('★★ a comparison of two known values is still CHECKED by the network',
    compileBasic('a = 15\nVERIFY a > 10', { stack: [] }).ops.some(o => o.op === OP.OP_GREATERTHAN))

  /* ⚠ THE ONE FORCED EXCEPTION, and it is forced rather than chosen: Script has no power opcode, so
     for `^` the choice is a literal or no emission at all. Invaders' `2 ^ k` array depends on it. */
  check('⚠ `^` is still worked out at COMPILE time — there is no power opcode to emit',
    arith('x = 2 ^ 8') === 0)
  {
    let m = ''
    try { compileBasic('x = 2 ^ r', { stack: ['r'] }) } catch (e) { m = (e as Error).message }
    check('⚠ …and a runtime exponent is REFUSED, not silently approximated',
      m.includes('no power opcode'))
  }

  /* ★ A FOR counter is SUBSTITUTED, not folded — one copy of the body per trip, the counter a literal
     in each, and the arithmetic around it emitted every time. That is what the unroll means. */
  check('★★★ an unrolled FOR substitutes the counter and EMITS the arithmetic around it',
    arith('x = 0\nFOR i = 1 TO 4\nx = x + i * 3\nNEXT i') === 8)   // 4 trips x (one MUL, one ADD)
  check('★ `2 ^ i` inside an unrolled FOR still folds — it is the array Script has no opcode for',
    arith('x = 0\nFOR i = 0 TO 3\nx = x + 2 ^ i\nNEXT i') === 4)   // 4 ADDs, no MULs

  console.log('        ⇒ fold only what Script CANNOT express. Optimisations go to a BETA version.')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BASIC: FAIL'); process.exit(1) }
console.log('BASIC OK — a line of BASIC and the covenant compute the same number.')
