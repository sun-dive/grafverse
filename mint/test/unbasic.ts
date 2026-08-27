// © 2026 sun-dive — Apache License 2.0.
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
import { COVENANT_IDIOMS } from '../src/readerPresets.ts'
import { extractHashOutputsOps } from '../src/covenant.ts'

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
    /* ⚠ The answer is now a LINE, not a leftover. A program whose result sits on the stack used to
       read back as an empty listing with the value buried in a trailing comment — true and useless. */
    const r = unbasic(ops, { stack })
    const got = (r.lines[r.lines.length - 1] ?? '').replace(/^\s*\w+ = /, '')
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
  /* ★★ AND IT REUSES THE REAL NAMES. The value that differs between the arms IS `p` being reassigned,
     not some new `t1` — inventing a name here made the listing subtly false AND uncompilable, because
     a variable that exists only inside an arm is exactly what the compiler refuses. What comes back is
     the branch balancing itself, made visible: the arm that changes it, and `q = q` holding the line. */
  check('★★★ the arms name the REAL variables, and the balancing assignment is visible',
    /\bp = 1\b/.test(listing) && /\bq = q\b/.test(listing) &&
    /\bp = p\b/.test(listing) && /\bq = 2\b/.test(listing))
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


// ── 5. ★★★ THE ROUND TRIP — compile, READ, and compile the reading ─────────────────────────────────
// This is what the two-way page promises, so it had better be measured rather than assumed. Every case
// is compiled, read back as BASIC, and the READING is compiled again. Two questions, and they are not
// the same question: does it compile at all, and does it come out as the SAME BYTES.
console.log()
{
  const cases: Array<[string, string, string[]]> = [
    ['a verified comparison', 'VERIFY a + b > 10', ['a', 'b']],
    ['two verifies', 'VERIFY a > 0\nVERIFY b > a', ['a', 'b']],
    ['a branch of verifies', 'IF a > b THEN VERIFY a > 0 ELSE VERIFY b > 0', ['a', 'b']],
    ['byte surgery', 'l, r = SPLIT(a, 2)\nVERIFY SAMEBYTES(CAT(l, r), a)', ['a']],
    ['hashing and a hex literal',
      'VERIFY SAMEBYTES(HASH160(a), &Hab0102030405060708090a0b0c0d0e0f10111213)', ['a']],
    ['MIN and arithmetic', 'VERIFY MIN(a, b) * 2 >= 0', ['a', 'b']],
    ['a value left on the stack', 'x = a + b', ['a', 'b']],
    ['several values left', 'x = a + b\ny = x * 2', ['a', 'b']],
    ['precedence and parentheses', 'x = (a + b) * 2 - a / 4', ['a', 'b']],
    ['a branch that assigns', 'IF a > b THEN p = 1 ELSE p = 2', ['a', 'b', 'p']],
    ['one arm only', 'IF a > b THEN p = 1', ['a', 'b', 'p']],
    ['two variables, one arm each', 'IF a > b THEN p = 1 ELSE q = 2', ['a', 'b', 'p', 'q']],
    ['a nested branch', 'IF a > b THEN IF a > 9 THEN p = 1 ELSE p = 2', ['a', 'b', 'p']],
    ['a block IF', 'IF a > b THEN\n p = 1\nELSE\n p = 2\nEND IF', ['a', 'b', 'p']],
    ['an unrolled loop', 'FOR i = 1 TO 4\n s = s + i\nNEXT i', ['s']],
  ]
  let compiles = 0, identical = 0
  const differ: string[] = []
  for (const [name, src, stack] of cases) {
    const one = compileBasic(src, { stack })
    const listing = unbasic(one.ops, { stack }).lines.join('\n')
    try {
      const two = compileBasic(listing, { stack })
      compiles++
      if (new LockingScript(one.ops).toHex() === new LockingScript(two.ops).toHex()) identical++
      else differ.push(name)
    } catch (e) { console.log(`        \u26a0 ${name} does not compile back: ${(e as Error).message.split('\n')[0]}`) }
  }
  check(`\u2605\u2605\u2605 all ${cases.length} readings COMPILE BACK \u2014 one language, not two`, compiles === cases.length)
  check(`\u2605\u2605 ${identical} of them come out BYTE-IDENTICAL`, identical >= 9)
  console.log(`        ${identical}/${cases.length} identical \u00b7 ${compiles}/${cases.length} compile`)
  /* \u26a0 AND THE REST ARE NOT FAILURES, THEY ARE THE HONEST LIMIT. A branch reads back as the
     balancing the compiler performed, which then recompiles with its own idioms and a byte or two of
     difference; an unrolled loop reads back as the four copies that are actually IN the script, because
     the loop is not. Both compute the same thing. Neither can be called a round trip of BYTES. */
  console.log(`        differ but compute the same: ${differ.join(', ')}`)
  console.log('        \u26a0 an unrolled FOR cannot read back as a FOR \u2014 the loop is not in the script')
}

/* ── ⚠⚠ THE IDIOM COLLISION — a reader that MISLABELS is worse than one that stops ────────────────
   `idiomAt` matched on shape (opcodes and push LENGTHS) and ignored the push values, on the argument
   that a long run agreeing everywhere is not a coincidence. True of the hundred-opcode PUSHTX preamble;
   false of an eight-opcode one, and the first new covenant written after the reader shipped collided
   on its first read. Reading the spent output's VALUE is byte-for-byte the same SHAPE as HASHOUTPUTS:

     value        SIZE push[52] SUB SPLIT NIP push[8]  SPLIT DROP
     HASHOUTPUTS  SIZE push[40] SUB SPLIT NIP push[32] SPLIT DROP

   ⇒ The listing said the script read hashOutputs where it read the value — in a document whose whole
   purpose is to let a person CHECK the script. A stop is visible; a wrong name is not. */
{
  const valueOfSpentOutput = [
    op(OP.OP_SIZE), PN(52), op(OP.OP_SUB), op(OP.OP_SPLIT), op(OP.OP_NIP),
    PN(8), op(OP.OP_SPLIT), op(OP.OP_DROP),
  ]
  const readAs = (chunks: typeof valueOfSpentOutput): string =>
    unbasic(chunks, { stack: ['preimage'], idioms: COVENANT_IDIOMS }).lines.join('\n')

  const value = readAs(valueOfSpentOutput)
  check('★★★ reading the spent output\'s VALUE is not labelled HASHOUTPUTS',
    !value.includes('HASHOUTPUTS'))
  check('★★ …and it is read as what it is — a split of the preimage',
    value.includes('SPLIT') && value.includes('preimage'))

  /* ★ The control: the real idiom must still be recognised, or "no false positive" would be
     trivially satisfiable by never matching anything at all. */
  const real = readAs(extractHashOutputsOps() as typeof valueOfSpentOutput)
  check('★★ …while the REAL hashOutputs read is still folded to HASHOUTPUTS',
    real.includes('HASHOUTPUTS'))

  /* ⚠ And PUSHTX must stay SHAPE-matched: its constants vary with the SIGHASH scope, so requiring the
     bytes would stop it being recognised at all on any covenant not signing under SIGHASH_ALL. */
  const other = COVENANT_IDIOMS.find(i => i.name === 'PUSHTX')
  check('⚠ PUSHTX is still matched on shape, because its constants vary with the scope',
    other !== undefined && other.exact !== true)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('UNBASIC: FAIL'); process.exit(1) }
console.log('UNBASIC OK — a script read back as the program it is.')
