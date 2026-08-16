// © BSV Association — Open BSV License v6.
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
import { RACER_REGS as R, S, fmul, fdiv, SLIP_UNIT } from '../src/shell.ts'
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

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BASIC: FAIL'); process.exit(1) }
console.log('BASIC OK — a line of BASIC and the covenant compute the same number.')
