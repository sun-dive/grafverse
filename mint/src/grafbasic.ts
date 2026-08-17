// © BSV Association — Open BSV License v6.
/**
 * The browser entry for the BASIC workbench — bundled to ../vendor/grafbasic.js as `GrafBasic`.
 *
 * ⚠ SEPARATE FROM `grafmint.js` ON PURPOSE. grafmint is loaded by the game; this is a developer tool,
 * and a tool has no business adding bytes to a page a player downloads.
 */
export { compileBasic, compileState, stateChunks, fieldMax, scriptCodeVarIntSize, BASIC_S } from './basic.ts'
export { unbasic, unbasicListing, readScriptNum } from './unbasic.ts'
export { buildBasicLock, basicLockOps, basicUnlockingOps, frameMaxFee, valueBytes } from './basicCovenant.ts'
export { Asm, op, PN, snum, fixedField } from './covenantAsm.ts'
export { LockingScript, Script, OP } from '@bsv/sdk'
/* ★ The real shipped shell, so the page's flagship example is the ACTUAL mainnet covenant rather than a
   fragment standing in for one. A tool that reads a stranger's covenant should demonstrate on a real
   one — and this one is 1108 opcodes of hand-written Script that no BASIC ever generated. */
export { buildShellLock, emptyShell } from './shell.ts'
