// © BSV Association — Open BSV License v6.
// ★★★ SCRIPT → BASIC — does the reading say what the script does?
//
//   node --experimental-strip-types mint/test/unbasic.ts
//
// The spec's recommended end state is that the SCRIPT stays the source and BASIC is a VIEW over it.
// This checks the view against scripts whose meaning is already known by other means: ones the
// compiler produced from BASIC we wrote, and — the real test — the car's own hand-written physics,
// which no BASIC ever generated.
import { OP, LockingScript } from '@bsv/sdk'
import { unbasic, unbasicListing, readScriptNum } from '../src/unbasic.ts'
import { compileBasic } from '../src/basic.ts'
import { op, PN, Asm } from '../src/covenantAsm.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

console.log('\nSCRIPT → BASIC — reading a script as a program\n')

// ── 1. ★★ THE ROUND TRIP OF MEANING — compile it, then read it back ────────────────────────────────
{
  const cases: Array<[string, string[], string]> = [
    ['x = a + b * 2', ['a', 'b'], 'a + b * 2'],
    ['x = (a + b) * 2', ['a', 'b'], '(a + b) * 2'],
    ['x = a - b - 1', ['a', 'b'], 'a - b - 1'],
    ['x = MIN(a, b) + 3', ['a', 'b'], 'MIN(a, b) + 3'],
    ['x = a * (b - 1) / 4', ['a', 'b'], 'a * (b - 1) / 4'],
    ['x = a > b', ['a', 'b'], 'a > b'],
  ]
  let ok = 0
  for (const [src, stack, want] of cases) {
    const { ops } = compileBasic(src, { stack })
    const r = unbasic(ops, { stack })
    const got = r.stack[r.stack.length - 1]
    if (got === want) ok++
    else console.log(`        ⚠ ${src}  →  read back as "${got}", expected "${want}"`)
  }
  check(`★★ ${cases.length} expressions read back as what was written`, ok === cases.length)
  console.log('        precedence and parentheses survive the trip in BOTH directions')
}

// ── 2. ★★ A BRANCH — and the arms reconciled the way the compiler balances them ────────────────────
console.log()
{
  const { ops } = compileBasic('IF a > b THEN p = 1 ELSE q = 2\n r = p + q', { stack: ['a', 'b', 'p', 'q'] })
  const listing = unbasicListing(ops, { stack: ['a', 'b', 'p', 'q'] })
  check('★ the condition is rendered as the comparison it is', listing.includes('IF a > b THEN'))
  check('★ …with an ELSE and an END IF', listing.includes('ELSE') && listing.includes('END IF'))
  check('★★ a value that differs between the arms is NAMED and assigned in both',
    /t\d+ = 1/.test(listing) && /t\d+ = 2/.test(listing))
  console.log(listing.split('\n').map(l => '        ' + l).join('\n'))
}

// ── 3. ★★★ AND NOW A SCRIPT NO BASIC EVER GENERATED ────────────────────────────────────────────────
// Hand-written, in the idiom the covenants actually use: pick by depth, compute, verify. This is the
// case that decides whether the view is a product or a party trick.
console.log()
{
  const a = new Asm(['v', 'mass', 'force'])
  a.pick('force'); a.pick('mass'); a.bin(OP.OP_DIV, 'dv')
  a.pick('v'); a.bin(OP.OP_ADD, 'nv')
  a.num(1000); a.bin(OP.OP_MIN, 'nv')
  a.o(OP.OP_DUP, 0, ['nv', 'nv']); a.num(0); a.bin(OP.OP_GREATERTHANOREQUAL, 'ok')
  a.o(OP.OP_VERIFY, 1, [])
  const r = unbasic(a.ops, { stack: ['v', 'mass', 'force'] })
  check('★★★ a hand-written covenant fragment reads as a program', !r.stoppedAt)
  const listing = unbasicListing(a.ops, { stack: ['v', 'mass', 'force'] })
  console.log(listing.split('\n').map(l => '        ' + l).join('\n'))
  check('★★ the duplicated value is computed ONCE and named, not written out twice',
    listing.includes('= MIN(force / mass + v, 1000)') &&
    listing.split('MIN(force / mass + v, 1000)').length === 2)
  console.log('        ⚠ that naming is a correctness rule: OP_DUP means the script computes it once')
}

// ── 4. ⚠ AND IT REFUSES TO INVENT ───────────────────────────────────────────────────────────────────
console.log()
{
  const r = unbasic([op(OP.OP_CHECKMULTISIG)], { stack: ['a'] })
  check('★★ an opcode it does not model STOPS the listing and says which', !!r.stoppedAt)
  console.log(`        ${r.stoppedAt}`)

  const r2 = unbasic([PN(9), op(OP.OP_PICK)], { stack: ['a', 'b'] })
  check('★ a pick past the bottom of the stack is refused, not faked', !!r2.stoppedAt)

  /* ⚠⚠ THE ONE THE COMPILER EXISTS TO PREVENT — arms that leave different depths. Hand-written, it is
     silent, and it surfaces hundreds of opcodes later as a size complaint. The reading sees it here. */
  const uneven = [op(OP.OP_1), op(OP.OP_IF), op(OP.OP_1), op(OP.OP_ELSE), op(OP.OP_1), op(OP.OP_1), op(OP.OP_ENDIF)]
  const r3 = unbasic([...uneven, op(OP.OP_DROP)], { stack: [] })
  check('★★★ arms that leave DIFFERENT stack depths are reported, at the ENDIF',
    r3.warnings.some(w => w.includes('DIFFERENT stack depths')))
  console.log(`        ${r3.warnings[0]}`)

  /* ⚠⚠ AND IT MUST NOT CRY WOLF. The SHIPPED shell ends on exactly this shape: the burn arm clears the
     whole stack and pushes OP_1 while the ordinary arm leaves fourteen items with a boolean on top —
     correct, because that ENDIF is the last opcode and Script asks only for a truthy top. The first
     version of this reader flagged the live covenant, which is how a real alarm gets ignored later. */
  const r4 = unbasic(uneven, { stack: [] })
  check('★★★ …but NOT when the ENDIF is the last opcode, as the shipped shell\'s is',
    r4.warnings.length === 0)
  console.log('        uneven arms are only a bug when something after the ENDIF reads across them')

  check('★ script numbers read back signed', readScriptNum([0x80]) === 0 - 0 && readScriptNum([0x81]) === -1
    && readScriptNum([0xe8, 0x03]) === 1000)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('UNBASIC: FAIL'); process.exit(1) }
console.log('UNBASIC OK — a script read back as the program it is.')
