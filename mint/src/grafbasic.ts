// © 2026 sun-dive — Apache License 2.0.
/**
 * The browser entry for the BASIC workbench — bundled to ../vendor/grafbasic.js as `GrafBasic`.
 *
 * ⚠ SEPARATE FROM `grafmint.js` ON PURPOSE. grafmint is loaded by the game; this is a developer tool,
 * and a tool has no business adding bytes to a page a player downloads.
 */
export {
  compileBasic, compileState, stateChunks, fieldMax, scriptCodeVarIntSize, BASIC_S,
  /* ⚠ EXPORTED SO THE LIVE PAGE CAN SAY WHICH COMPILER IT IS. A bundle is a build artefact and goes
     stale silently: on 18 Aug the live one still folded `2 * 3 + 4` into `10` for a day after the
     source was fixed, and nothing on the page could have told you. */
  BASIC_VERSION,
} from './basic.ts'
export { unbasic, unbasicListing, readScriptNum } from './unbasic.ts'
export { buildBasicLock, basicLockOps, basicUnlockingOps, frameMaxFee, valueBytes } from './basicCovenant.ts'
export { Asm, op, PN, snum, fixedField } from './covenantAsm.ts'
export { LockingScript, Script, OP } from '@bsv/sdk'
/* ★ The real shipped shell, so the page's flagship example is the ACTUAL mainnet covenant rather than a
   fragment standing in for one. A tool that reads a stranger's covenant should demonstrate on a real
   one — and this one is 1108 opcodes of hand-written Script that no BASIC ever generated. */
export { buildShellLock, emptyShell } from './shell.ts'
/* ★ The presets — every covenant in this project, with its stack already named. Derived from each
   covenant's own unlocking builder, and checked by `test/reader-presets.ts` so a name list cannot
   silently drift out of step with the machine it describes. */
export { READER_PRESETS, COVENANT_IDIOMS, type ReaderPreset } from './readerPresets.ts'
/* ★ Noughts and crosses — the whole game in BASIC, and the demo that shows what a racing car cannot:
   turn-taking enforced by the covenant. */
export { OXO_SRC, OXO_INPUTS, oxoNew, oxoRef, oxoShow } from './oxo.ts'
/* ★ Space Invaders — and the 1978 difficulty ramp arriving a second time, through the fee model. */
export { INV_SRC, INV_INPUTS, invNew, invRef, invShow } from './invaders.ts'
/* ★ The same game packed base 4 — one value wasted a square, and every access becomes a shift. */
export { OXO4_SRC, OXO4_INPUTS, oxo4New, oxo4Ref, oxo4Show } from './oxo4.ts'
/* ★ Rule 110 — Turing complete, one generation per transaction, no input at all. */
export { R110_SRC, r110Src, R110_INPUTS, r110New, r110Ref, r110Show } from './rule110.ts'
