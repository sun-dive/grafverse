// © 2026 sun-dive — Apache License 2.0.
// ★★ DIM — DOES A GENERATED COVENANT READ AND REWRITE ITS OWN STATE?
//
//   node --experimental-strip-types mint/test/basic-state.ts
//
// A covenant carries its state as fixed-width pushes INSIDE ITS OWN LOCKING SCRIPT and reads them back
// by splitting its own scriptCode at constant offsets. `DIM v%5` declares that layout. This asks the
// only question that matters about it: hand the generated script a scriptCode, and does the thing it
// builds come back BYTE FOR BYTE equal to the script that state belongs to?
//
// ⚠ EVERY CASE RUNS THROUGH `Spend`, the interpreter from @bsv/sdk. Nothing here inspects opcodes and
// agrees with itself — the comparison is `OP_EQUAL` on the rebuilt bytes, judged by the same code that
// judges a real spend. A wrong split offset, a swapped pair of fields or a sign bit dropped by NUM2BIN
// all come out as a plain FAIL.
import { Transaction, Spend, LockingScript, UnlockingScript, OP } from '@bsv/sdk'
import { compileState, compileBasic, stateChunks, fieldMax, scriptCodeVarIntSize, type Field } from '../src/basic.ts'
import { fixedField, op, PN } from '../src/covenantAsm.ts'
import { pushData } from '../src/pushtx.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

/* A stand-in for the parts of a locking script that are not state. `PRE` is everything before the FIRST
   field's data — header bytes plus that field's own push opcode — and `SUF` is the code itself. Their
   contents are irrelevant to the layout, which is the point: the compiler never looks inside either. */
const HEADER = [0x01, 0x50, 0x01, 0x01]           // two pushes: "P" and a version, as the shell has
const SUFFIX = [0x51, 0x52, 0x53, 0x93, 0x87]     // pretend code

/** Lay a state out as the bytes it occupies in the script: HEADER ‖ <w>f0 ‖ <w>f1 ‖ … ‖ SUFFIX. */
function scriptCodeOf(layout: Field[], values: Record<string, number | number[]>): number[] {
  const out = [...HEADER]
  for (const f of layout) {
    const v = values[f.name]
    out.push(f.width, ...(f.bytes ? (v as number[]) : fixedField(v as number, f.width)))
  }
  return [...out, ...SUFFIX]
}
/** ⚠ The offset points at the first field's DATA, so it is past that field's own push opcode. */
const offsetOf = (): number => HEADER.length + 1

/**
 * Run the generated script for real: push the scriptCode, peel it, run the program, rebuild — and
 * compare the rebuilt bytes with the script the NEW state belongs to.
 */
function roundTrip(src: string, before: Record<string, number | number[]>,
                   after: Record<string, number | number[]>,
                   consts?: Record<string, number>): { ok: boolean; why?: string; bytes: number; layout: Field[] } {
  const c = compileState(src, { fieldOffset: offsetOf(), consts })
  const want = scriptCodeOf(c.layout, after)
  const lock = new LockingScript([...c.ops, pushData(want), op(OP.OP_EQUAL)])
  const unlock = new UnlockingScript([pushData(scriptCodeOf(c.layout, before))])
  const src2 = new Transaction(); src2.addOutput({ lockingScript: lock, satoshis: 1 })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src2, sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: unlock })
  tx.addOutput({ lockingScript: new LockingScript([]), satoshis: 1 })
  const bytes = new LockingScript(c.ops).toBinary().length
  try {
    const ok = new Spend({
      sourceTXID: src2.id('hex'), sourceOutputIndex: 0, sourceSatoshis: 1, lockingScript: lock,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: unlock, inputSequence: 0xffffffff, lockTime: 0,
    }).validate() === true
    return { ok, bytes, layout: c.layout }
  } catch (e) {
    return { ok: false, why: (e as Error).message.split('\n')[0], bytes, layout: c.layout }
  }
}

console.log('\nDIM — a script that reads and rewrites its own state\n')

// ── 1. ★★★ THE ROUND TRIP — the state survives, and so does everything that is not the state ────────
{
  const DECL = 'DIM phase%1\n DIM v%5\n DIM pos%5\n DIM driver$4\n'
  const s0 = { phase: 2, v: 1234567, pos: -98765, driver: [0xde, 0xad, 0xbe, 0xef] }

  const cases: Array<[string, string, Record<string, number | number[]>]> = [
    /* ★ THE PUREST ONE, AND THE FIRST THAT MUST PASS. A program with no statements at all still peels
       every field apart and puts every one of them back. If a script cannot read its own state and
       write it back UNCHANGED, nothing built on top of that is worth debugging — which is exactly why
       the shell was proved as a frame before it was given any arithmetic. */
    ['IDENTITY — an empty program, and the script comes back byte-identical', DECL, s0],
    ['identity through an assignment that changes nothing', DECL + 'phase = phase', s0],
    ['one field advances',
      DECL + 'phase = phase + 1', { ...s0, phase: 3 }],
    ['arithmetic on a wide field',
      DECL + 'v = v * 2 - 7', { ...s0, v: 1234567 * 2 - 7 }],
    ['★ a NEGATIVE value survives NUM2BIN and the sign bit',
      DECL + 'pos = pos - 1000', { ...s0, pos: -99765 }],
    ['★ a value crossing zero',
      DECL + 'pos = pos + 98765', { ...s0, pos: 0 }],
    ['a branch decides the new state',
      DECL + 'IF v > 1000 THEN phase = 9 ELSE phase = 1', { ...s0, phase: 9 }],
    ['★ a FOR loop writes the state',
      DECL + 'FOR i = 1 TO 5\n v = v + i\n NEXT i', { ...s0, v: 1234567 + 15 }],
    ['the $ field is carried through untouched while numbers change',
      DECL + 'phase = 7\n v = 1', { ...s0, phase: 7, v: 1 }],
  ]
  let ok = 0
  for (const [name, src, after] of cases) {
    const r = roundTrip(src, s0, after)
    if (r.ok) ok++
    else console.log(`        ⚠ ${name} · ${r.why ?? 'the rebuilt script did not match'}`)
  }
  check(`★★★ ${cases.length} programs rebuild their own script exactly`, ok === cases.length)
  console.log('        identity · advance · arithmetic · negative · zero · branch · FOR · $ passthrough')

  /* ⚠⚠ THE ONE THAT WOULD CATCH A POSITIONAL REBUILD. `coalesce` moves a re-assigned variable to the TOP
     of the stack, so after writing `pos` and then `phase` the fields are no longer in layout order at
     all. A rebuild that emitted them by position would produce a perfectly valid script with two fields
     swapped — and it would fail only at the output comparison, hundreds of opcodes later, looking like
     a hashing bug. Writing them in REVERSE layout order is the sharpest version of that. */
  const shuffled = roundTrip('DIM phase%1\n DIM v%5\n DIM pos%5\n DIM driver$4\n' +
    'pos = pos + 1\n v = v + 1\n phase = phase + 1', s0,
    { ...s0, phase: 3, v: 1234568, pos: -98764 })
  check('★★★ fields written in REVERSE order still rebuild in LAYOUT order', shuffled.ok)
  console.log('        …because the rebuild gathers them by NAME, not by where they ended up')
}

// ── 2. ⚠ THE WIDTH IS A LAYOUT, AND A LAYOUT THAT LIES IS THE WORST KIND OF BUG ─────────────────────
// `fixedField` truncates silently — a perfectly well-formed script carrying the wrong number. So the
// refusals below are not politeness; they are the difference between a covenant and a trap.
console.log()
{
  const L: Field[] = [{ name: 'v', width: 2, bytes: false }, { name: 'tag', width: 3, bytes: true }]
  const bad = (fn: () => unknown): string => { try { fn(); return '' } catch (e) { return (e as Error).message } }

  check('★ a two-byte field holds ±32767', fieldMax(2) === 32767)
  const m1 = bad(() => stateChunks(L, { v: 40000, tag: [1, 2, 3] }))
  check('★★ an oversized value is REFUSED, not truncated', m1.includes('does not fit'))
  console.log(`        ${m1.slice(0, 100)}…`)
  const m2 = bad(() => stateChunks(L, { v: 1, tag: [1, 2] }))
  check('★ a $ field of the wrong length is refused', m2.includes('DIM says 3'))
  const m3 = bad(() => stateChunks(L, { v: 1 }))
  check('  …and a missing field', m3.includes('tag'))
  check('  …while a value that fits is accepted', stateChunks(L, { v: 32767, tag: [1, 2, 3] }).length === 2)

  /* ⚠ THE VARINT, WHICH IS WHY THE OFFSET CANNOT SIMPLY BE COUNTED. BIP143 puts the scriptCode's own
     length in front of it, so the offset of field zero depends on how long the finished script is —
     and the script is not finished while you are computing it. `buildShellLock` breaks the circle by
     building once, measuring, and building again. */
  check('★ the varint grows at 253 and at 65536',
    scriptCodeVarIntSize(252) === 1 && scriptCodeVarIntSize(253) === 3 && scriptCodeVarIntSize(70000) === 5)
}

// ── 3. ⚠ AND IT REFUSES WHAT WOULD SILENTLY MOVE AN OFFSET ──────────────────────────────────────────
console.log()
{
  const bad = (src: string): string => {
    try { compileState(src, { fieldOffset: offsetOf() }); return '' } catch (e) { return (e as Error).message }
  }
  const m1 = bad('DIM v%1\n v = v + 1\n DIM w%1')
  check('★★ a DIM after the first real statement is refused', m1.includes('before the first statement'))
  console.log(`        ${m1.slice(0, 100)}…`)
  const m2 = bad('DIM v%1\n DIM v%2\n v = 1')
  check('★ the same field DIMmed twice', m2.includes('twice'))
  const m3 = bad('DIM v%76\n v = 1')
  check('★★ a width past 75 — where the push opcode grows and every offset moves', m3.includes('1 to 75'))
  const m4 = bad('DIM v%0\n v = 1')
  check('★ a zero-width field', m4.includes('1 to 75'))
  const m5 = bad('DIM v\n v = 1')
  check('★ a DIM with no width at all — a layout has a size', m5.includes('WIDTH'))
  const m6 = bad('DIM PRE%2\n PRE = 1')
  check('★ PRE and SUF are the script, not fields', m6.includes('taken'))
  const m7 = bad('DIM v%2\n PRE = 1')
  check('★★ assigning PRE would rewrite the covenant, not its state', m7.includes('rewrite the covenant'))
  const m8 = bad('v = 1')
  check('  …and compileState with no DIM at all', m8.includes('needs at least one DIM'))

  let m9 = ''
  try { compileBasic('DIM v%2\n v = 1', { stack: [] }) } catch (e) { m9 = (e as Error).message }
  check('★ compileBasic sees a DIM and points at the right door', m9.includes('compileState'))
}

// ── 4. ★ WHAT THE STATE LAYER COSTS ─────────────────────────────────────────────────────────────────
// A lock is paid for TWICE on every move — once in the output that creates it and once in the input
// that spends it — so these bytes are the rent on carrying state at all.
console.log()
{
  const decl = (n: number): string =>
    Array.from({ length: n }, (_, i) => `DIM f${i}%4`).join('\n') + '\n f0 = f0 + 1'
  const cost = (n: number): number => {
    const c = compileState(decl(n), { fieldOffset: offsetOf() })
    return new LockingScript([...c.peel, ...c.rebuild]).toBinary().length
  }
  const c1 = cost(1), c4 = cost(4), c12 = cost(12)
  const per = (c12 - c4) / 8
  check('★ the peel and rebuild grow linearly with the field count', per === (c4 - c1) / 3)
  console.log(`        1 field ${c1} B · 4 fields ${c4} B · 12 fields ${c12} B  ⇒ ${per} B per field, ` +
    `${c1 - per} B fixed`)
  const c = compileState('DIM phase%1\n DIM v%5\n DIM pos%5\n DIM driver$4\n phase = phase + 1',
    { fieldOffset: offsetOf() })
  console.log(`        a 4-field state: peel ${new LockingScript(c.peel).toBinary().length} B · ` +
    `body ${new LockingScript(c.body).toBinary().length} B · ` +
    `rebuild ${new LockingScript(c.rebuild).toBinary().length} B`)
  console.log('        ⚠ bytes only — no fee claim here, and none until a real spend is serialized')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DIM: FAIL'); process.exit(1) }
console.log('DIM OK — the script read its own state, changed it, and rebuilt itself byte for byte.')
