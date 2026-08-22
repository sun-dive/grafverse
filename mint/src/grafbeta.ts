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

/* ⚠⚠⚠ THE BETA'S OWN ENTRY POINT — and the reason it exists is not tidiness.
   `racebeta.html` is where the DEPOT-ANCHORED design gets built: one fixed car program, emitted and
   pinned by the depot, with the server supplying DATA and never the program. Until that is correct and
   chosen, `bitcoin-racers.html` must not move by one byte.
   ⇒ TODAY this re-exports the same modules as `grafracers.ts`, so the beta behaves identically and the
   copy is a starting point rather than a fork.
   ⚠⚠ THE MOMENT THE COVENANT CHANGES, THE SOURCE FILES MUST FORK TOO. Editing `racerCar.ts`,
   `racerDepot.ts`, `racerTick.ts` or `racerPhysics.ts` edits the LIVE PAGE, because `grafracers.ts`
   reaches all of them and `vendor/grafracers.js` is what bitcoin-racers.html loads. A separate bundle
   with shared sources is not isolation — it is the same code with two names.
   ⇒ Beta covenant work goes in NEW files (`betaCar.ts`, `betaDepot.ts`, …) exported from here. */

/* ── the depot ───────────────────────────────────────────────────────────────────────────────────── */
export { buildRacerDepotBasicLock, readDepotState, RACER_WINDOW_SECONDS, RACER_MINTS_PER_WINDOW }
  from './racerDepotFrame.ts'
/* ⚠ `racerTopUpPad` IS EXPORTED BECAUSE THE FEE ALLOWANCE IS A FUNCTION OF THE COIN COUNT, and the
   page funds from as many coins as the contributor's amount needs. The flat `RACER_TOPUP_FEE_PAD` is
   only `racerTopUpPad(1)`; a page that reaches for it while spending three coins has hard-coded a
   number that is a function of a constant, which is a trap this project has already fallen into. */
export { buildRacerTopUpTx, RACER_TOPUP_FEE_PAD, racerTopUpPad } from './racerDepotTopUp.ts'
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

/* ── 🎮 THE BENCH'S OWN PHYSICS — free of the covenant, and that is the point ────────────────────────
   ⚠⚠ THE GAME FEEL IS TUNED FIRST AND THE COVENANT IS WRITTEN AFTER (sun-dive, 22 Aug). `racebeta.html`
   drives THESE, not `laneSection`: a bench ruled by what Script can express turns Script's limits into
   gameplay, and an evening of "game bugs" turned out to be exactly that, every one.
   ★ `benchPhysics.ts` imports nothing from `betaLane.ts` or `shell.ts`, so tuning cannot reach the
   covenant — and the covenant exports below stay for the day we translate the settled model back. */
export {
  BENCH_REGS, PIECE, IN, STRAIGHT_PIECES, straightPieces, buildableStraights, benchOval, benchLayout, benchClosure, benchHisTrack,
  benchStep, benchStart, benchGeom, benchAt, benchCeiling, benchLoad, benchTurnLen,
  benchPieces, benchRunPiece, TEST_AT,
} from './benchPhysics.ts'
export type { BenchRegs, BenchTrack, BenchSection, BenchState, BenchCar, BenchPiece } from './benchPhysics.ts'

/* ── 🛤 THE LANE — the depot-anchored rebuild (spec §7.7–§7.8) ──────────────────────────────────────
   ⚠⚠ `betaLane.ts` IS THE BETA'S OWN FILE and must stay that way. It is reached only from here, so
   nothing it does can move `vendor/grafracers.js` and nothing can move the live racers page. */
export {
  buildLaneLock, laneConsts, LANE_SRC, BETA_LANE_REGS, AURORA_FIG8, DOUBLE_FIG8,
  PHASE as LANE_PHASE, f as laneFixed,
  /* ★ the bench drives THESE — the same functions the covenant is proved against, never a copy */
  laneSection, laneTick,
  /* ★ the per-segment trigger machinery — the page samples the wheel once per physics step, and
     `laneTriggers` is how a HELD trigger and a driven one become the same list. */
  laneTriggers, laneInputNames, laneSrc,
} from './betaLane.ts'
export type { LaneRegs, LaneTrack, LaneState } from './betaLane.ts'
