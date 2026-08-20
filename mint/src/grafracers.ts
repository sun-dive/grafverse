// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ BITCOIN RACERS' OWN BUNDLE — the entry point for `vendor/grafracers.js`.
 *
 * ⚠⚠ THIS FILE EXISTS BECAUSE EVERY PAGE'S SCRIPT IS ISOLATED (sun-dive, 20 Aug). `bitcoin-racers.html`
 * used to load `vendor/grafmint.js`, which is also loaded by depot · battery · brc226 · grafverse ·
 * racers — so a racers change meant rebuilding a bundle five other live pages depend on. It was worse
 * than that: `shell.ts` reaches `vendor/grafbasic.js` too, through `grafbasic.ts`, so racers work could
 * reach `basic.html`.
 *
 * ⇒ Two reasons this is a rule and not a preference:
 *   · BLAST RADIUS — one page's change must not be able to break five others.
 *   · BLOAT — a browser should download THIS page's code, not everything the repo can do.
 *
 * ⚠ SO KEEP THIS LIST EXACTLY WHAT `bitcoin-racers.html` CALLS, and no more. Every symbol added here
 * is bytes every visitor downloads. The list was taken from the page rather than guessed — grep it for
 * `M.` and the two must agree.
 *
 * ★ The physics comes from `racerPhysics.ts`, NOT `shell.ts`: `racerRefTick` and `ONE_RACE_REGS` carry
 * model C and the closed-form `stopped` ending. `shell.ts` still describes the DEPLOYED chained shell
 * and is only READ from here (`PHASE`, `S`, `SLIP_UNIT`).
 *
 * → `racers-where-we-stand.md` §6j
 */

/* ── the physics: the racers' own, never the shell's ─────────────────────────────────────────────── */
export { ONE_RACE_REGS, racerRefTick } from './racerPhysics.ts'
/* ⚠ `RACER_PHASE` is deliberately NOT exported: the page reads endings off `r.ended`, never the phase
   number, so shipping it would be bytes nobody downloads for a reason. Add it the day the page needs
   it — the check below is what keeps this honest. */
export type { OneRaceRegs, RacerTickResult } from './racerPhysics.ts'

/* ── read-only from the shell: constants the page displays and converts with ─────────────────────── */
export { PHASE, S, SLIP_UNIT } from './shell.ts'
export type { ShellState, Move } from './shell.ts'

/* ── the car ─────────────────────────────────────────────────────────────────────────────────────── */
export { buildRacerCar, carBlockOps } from './racerCar.ts'
/* ★ the leaderboard reads a minted car's head at fixed offsets — CAR_LAYOUT is what tells it where. */
export { CAR_LAYOUT, NAME_BYTES } from './racerCar.ts'
export { raceValidates, assertRaceable, buildRaceTx } from './racerTx.ts'
export type { TickTrace, RunTrace, Ending } from './racerTick.ts'

/* ── the depot ───────────────────────────────────────────────────────────────────────────────────── */
export { buildRacerDepotBasicLock, readDepotState, RACER_WINDOW_SECONDS, RACER_MINTS_PER_WINDOW }
  from './racerDepotFrame.ts'
export { buildRacerTopUpTx, RACER_TOPUP_FEE_PAD } from './racerDepotTopUp.ts'
/* ⚠⚠ `RACER_MAX_CAR_BYTES` IS THE DEFAULT A DEPOT IS BUILT WITH, NOT A LAW OF THE SYSTEM.
   `racerDepotLockOps` takes `p.maxCarBytes`, so a depot minted with a different ceiling enforces a
   different one — which is exactly why the page must PROVE its rebuild matches the deployed script
   before it trusts this number for anything. Exported so the page can say WHY a car is refused
   instead of typing 16,000 into a template and inventing a rule. */
export { RACER_MAX_CAR_BYTES, RACER_DRAW } from './racerDepot.ts'
/* ⚠ `buildDepotUnlock` lives in `depot.ts` and the one-race depot reuses it deliberately — the frame
   is the same shape, so a second copy would be a second thing to keep right. */
export { buildDepotUnlock, DEPOT_SCOPE } from './depot.ts'

/* ── signing ─────────────────────────────────────────────────────────────────────────────────────── */
export { derivedSigIsLowS } from './pushtx.ts'
export { WalletProvider } from './walletProvider.ts'
export { wocScriptHash } from './editionBuilder.ts'

/* ── @bsv/sdk primitives the page uses directly ──────────────────────────────────────────────────── */
export { Transaction, TransactionSignature, LockingScript, P2PKH } from '@bsv/sdk'
