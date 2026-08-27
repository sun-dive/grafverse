// © 2026 sun-dive — Apache License 2.0.
//
// ★★ THE FORK IS PINNED TO THE ORIGINAL — `betaFrame.ts` against `basicCovenant.ts`.
//
//   node --experimental-strip-types mint/test/beta-frame.ts
//
// ⚠⚠ THE COST OF ISOLATION IS DUPLICATED LOGIC, SO THE COPY MUST NOT BE ABLE TO DRIFT QUIETLY. This is
// the same guard `test/racer-physics.ts` puts on `racerPhysics.ts` after the racers forked the shell:
// sweep the copy against the original and require them to be IDENTICAL with the new switch OFF.
//
// ⇒ Here the switch is `scope`. At the default the fork must be BYTE-FOR-BYTE what the live frame
// emits, on every program it is given. If someone "improves" one file, this goes red.
//
// ⚠ AND IT CARRIES ITS OWN NEGATIVE CONTROL. A test that only ever compares two things which happen to
// agree proves nothing about its own ability to notice — so it also requires that a DIFFERENT scope
// produces a DIFFERENT script. Without that, a comparison that always passed would look the same.
import { buildBasicLock as liveLock } from '../src/basicCovenant.ts'
import { buildBasicLock as betaLock } from '../src/betaFrame.ts'
import { LANE_SRC, laneConsts, laneInputNames, BETA_LANE_REGS, AURORA_FIG8 } from '../src/betaLane.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const hex = (s: { toBinary(): number[] }): string =>
  s.toBinary().map(b => ('0' + b.toString(16)).slice(-2)).join('')

/* ── the programs to sweep. Small ones AND the real lane, because a frame that agrees on a toy and
   diverges on 1,549 opcodes has told you nothing. ────────────────────────────────────────────────── */
interface Case { name: string; src: string; state: Record<string, number | number[]>
                 consts?: Record<string, number>; inputs?: string[]; maxFee: number }

const CASES: Case[] = [
  { name: 'no statements at all — the bare frame',
    src: 'DIM n%1\n', state: { n: 0 }, maxFee: 500 },
  { name: 'one addition',
    src: 'DIM n%1\n n = n + 1\n', state: { n: 3 }, maxFee: 500 },
  { name: 'a branch, both arms balanced',
    src: 'DIM n%1\n DIM v%4\n v = 0\n IF n = 1 THEN\n v = 7\n END IF\n', state: { n: 1, v: 0 }, maxFee: 500 },
  { name: 'an unrolled FOR',
    src: 'DIM n%2\n FOR i = 1 TO 5\n n = n + i\n NEXT\n', state: { n: 0 }, maxFee: 700 },
  { name: 'a $ field, which moves every offset behind it',
    src: 'DIM tag$8\n DIM n%1\n n = n + 1\n', state: { tag: new Array(8).fill(0), n: 0 }, maxFee: 600 },
  { name: 'inputs — a machine somebody plays',
    src: 'DIM n%2\n VERIFY a > 0\n n = n + a + b\n', state: { n: 0 }, inputs: ['a', 'b'], maxFee: 600 },
  { name: '★ THE LANE ITSELF — 1,549 opcodes',
    /* ⚠ DERIVED, not listed. The lane now takes one trigger per SEGMENT, so a hand-written pair
       here silently compiles a different program than the one the lane actually mints. */
    src: LANE_SRC, maxFee: 0, inputs: laneInputNames(AURORA_FIG8),
    consts: laneConsts(BETA_LANE_REGS, AURORA_FIG8),
    /* ⚠⚠ EVERY DIM NEEDS A VALUE, AND raceId AND dia WERE MISSING — so this case THREW, and the two
       cases after it never ran at all. It reported six passes and a stack trace, and was recorded as
       "10/10". The whole point of this file is in its own header: *a frame that agrees on a toy and
       diverges on 1,549 opcodes has told you nothing* — and the 1,549-opcode case is the one that
       never executed. Found 21 Aug while re-deriving the inputs; verified against a clean checkout of
       HEAD before believing it. → the green-test-is-not-evidence rule, again. */
    state: { raceId: new Array(32).fill(0), phase: 1, section: 0, lap: 0, v: 2147483648, fuel: 40000,
             t: 0, eng: 14, tyr: 10, dia: 10, driver: new Array(24).fill(0) } },
]

console.log('★★ THE FORK AT ITS DEFAULT SCOPE MUST BE THE LIVE FRAME, BYTE FOR BYTE\n')
for (const c of CASES) {
  const args = { src: c.src, state: c.state, maxFee: c.maxFee, consts: c.consts, inputs: c.inputs }
  const a = liveLock(args)
  const b = betaLock(args)                      // scope omitted ⇒ the default
  check(`${c.name}  (${a.toBinary().length} B)`, hex(a) === hex(b))
}

console.log('\n⚠ NEGATIVE CONTROL — the comparison must be ABLE to fail')
{
  const c = CASES[1]
  const args = { src: c.src, state: c.state, maxFee: c.maxFee }
  const dflt = betaLock(args)
  const acp = betaLock({ ...args, scope: 0xc1 })
  check('★ ANYONECANPAY produces a DIFFERENT script — so the switch is real', hex(dflt) !== hex(acp))
  check('  and the live frame cannot produce it at all', hex(liveLock(args)) !== hex(acp))
  console.log(`      0x41 ${dflt.toBinary().length} B  ·  0xc1 ${acp.toBinary().length} B`)
}

console.log('\n★ AND THE LANE UNDER ANYONECANPAY — what §7.8 is actually asking for')
{
  const c = CASES[CASES.length - 1]
  const args = { src: c.src, state: c.state, maxFee: c.maxFee, consts: c.consts, inputs: c.inputs }
  const own = betaLock(args)
  const funded = betaLock({ ...args, scope: 0xc1 })
  check('a lane can be built under 0xc1', funded.toBinary().length > 0)
  const spend = (n: number): number => 4 * Math.ceil((2 * n + 400) / 10)
  console.log(`      pays its own fee   ${own.toBinary().length} B  ⇒ a lap ${spend(own.toBinary().length)} sat`)
  console.log(`      funded externally  ${funded.toBinary().length} B  ⇒ a lap ${spend(funded.toBinary().length)} sat`)
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
