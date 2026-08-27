// © 2026 sun-dive — Apache License 2.0.
// ★★★ CAN THIS PROJECT'S OWN COVENANTS BE READ?
//
//   node --experimental-strip-types mint/test/reader-presets.ts
//
// The presets exist so a person can open a page and read their own machine instead of typing sixteen
// names first. That only helps if the names are RIGHT — and a name list is exactly the kind of thing
// that is correct the day it is written and silently wrong the first time a covenant gains a field.
//
// ⚠⚠ SILENTLY WRONG HERE IS THE WORST KIND. One extra push and every name in the listing shifts by one:
// the reading still runs, still looks like a program, and describes a machine that does not exist. So
// this does not check the lists by eye. It runs each covenant through the reader and demands it come
// out the far end.
import { LockingScript } from '@bsv/sdk'
import { READER_PRESETS, COVENANT_IDIOMS } from '../src/readerPresets.ts'
import { unbasic } from '../src/unbasic.ts'

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

console.log('\nTHE PROJECT\'S OWN COVENANTS, READ AS BASIC\n')

for (const p of READER_PRESETS) {
  const lock = p.build()
  const r = unbasic(lock.chunks, { stack: p.stack })
  const bytes = lock.toBinary().length
  check(`★★★ ${p.label} — ${lock.chunks.length} opcodes read to the end`, !r.stoppedAt)
  if (r.stoppedAt) console.log(`        ⚠ ${r.stoppedAt}`)
  console.log(`        ${bytes} B · ${r.lines.length} lines · ${p.stack.length} names · ` +
    `${r.warnings.length} warning(s)`)
  for (const w of r.warnings) console.log(`        ${w}`)
}

// ── ★★ AND THE PREAMBLE EVERY COVENANT SHARES, NAMED RATHER THAN SPELLED OUT ───────────────────────
// Read literally, OP_PUSH_TX is thirty lines of SPLIT(x, 1) — every one true, and together they bury
// the program under the front door that every covenant has. Naming the run is the difference between a
// listing that can be read and one that can only be scrolled.
console.log()
{
  let bareTotal = 0, foldTotal = 0
  for (const p of READER_PRESETS) {
    const lock = p.build()
    const bare = unbasic(lock.chunks, { stack: p.stack })
    const fold = unbasic(lock.chunks, { stack: p.stack, idioms: COVENANT_IDIOMS })
    bareTotal += bare.lines.length; foldTotal += fold.lines.length
    check(`★ ${p.label} still reads to the end with the idioms named`, !fold.stoppedAt)
    console.log(`        ${bare.lines.length} lines → ${fold.lines.length}`)
  }
  check('★★ naming the shared preamble roughly halves every listing', foldTotal * 2 < bareTotal * 1.5)
  console.log(`        ${bareTotal} lines of listing across the four → ${foldTotal}`)
  /* ⚠⚠ AND IT COSTS THE ROUND TRIP, WHICH MUST BE SAID RATHER THAN DISCOVERED. `PUSHTX` is a name this
     reader gives a run of opcodes; the compiler has no such word. Folded, the listing is for a person.
     Unfolded, it still compiles back — and that is the version the other tab of the page can eat. */
  const lc = READER_PRESETS.find(p => p.key === 'livecounter')!
  const folded = unbasic(lc.build().chunks, { stack: lc.stack, idioms: COVENANT_IDIOMS })
  check('★★ a folded listing names PUSHTX — which the COMPILER does not know, by design',
    folded.lines.some(l => l.includes('PUSHTX')))
  console.log('        ⚠ fold to READ · leave it unfolded to compile back')
}

console.log()
// ⚠ A preset with too FEW names does not fail loudly — the script simply reaches past the bottom. That
// is the drift this file exists to catch, so prove the check can actually see it.
{
  const p = READER_PRESETS.find(x => x.key === 'shell')!
  const short = unbasic(p.build().chunks, { stack: p.stack.slice(1) })
  check('★★ …and one name short is DETECTED, not quietly misread', !!short.stoppedAt)
  console.log(`        ${(short.stoppedAt ?? '').slice(0, 108)}…`)
  check('★ every preset names what its own unlocking script pushes, bottom first',
    READER_PRESETS.every(x => x.stack.length > 0 && x.stack[x.stack.length - 1] === 'preimage'))
  console.log('        the preimage is always the top push — that is what OP_PUSH_TX reads')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('READER PRESETS: FAIL'); process.exit(1) }
console.log('READER PRESETS OK — every covenant in this project can be read as a program.')
