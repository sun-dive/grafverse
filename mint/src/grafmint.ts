// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
// grafmint — grafspace's own BSV wallet + mint core. Bundled by build.mjs into ../vendor/grafmint.js as the
// global `GrafMint`, which grafverse.html lazy-loads only when the user chooses to mint. Ported from PharLap's
// tested edition/covenant code (grafspace owns this copy; PharLap is untouched).

// ── wallet + identity (self-custody) ──
export {
  keyFromMnemonic, newSeedWallet, importWif, identityFromKey, watchIdentity,
  loadOrCreateWallet, saveKey, saveWatch, savedMnemonic, markBackedUp, needsSeedBackup,
} from './wallet.ts'

// ── Buy-BSV on-ramp + referral ──
export {
  buyBsvUrl, withAff, extractRefCode, setIncomingAff, rememberGifter, saveMyRefCode,
} from './onramp.ts'

// ── network (dual-relay WoC + BananaBlocks; broadcast + awaitInMempool gate) ──
export { WalletProvider } from './walletProvider.ts'

// ── high-level mint (grafspace-friendly wrapper) ──
export { mintAtom } from './mintApi.ts'

// ── plain BSV payment (ordinary P2PKH send to any address; change back to self; signing stays local) ──
export {
  sendPayment, buildPaymentTx, gatherPaymentFunding, assertValidAddress, type PaymentTxResult,
} from './payment.ts'

// ── read-only chain import (no key): txid → embedded payload bytes (gunzipped) + licence gate ──
export { loadAtomBytes, readCollection, isOpenLicense } from './sceneRead.ts'

// ── seller/listing note (heading + description + tags) → publish on-chain for the curator to read (NFT.sale listing) ──
export { publishSellerNote } from './sellerNote.ts'

// ── pre-mint cost estimate (matches createEdition's own funding math) + compression for accurate file sizing ──
export { estimateEditionFunding, fundingMargin, type MintCostEstimate } from './editionBuilder.ts'
export { compressIfSmaller } from './compress.ts'

// ── BRC-226 LiveCounter — the immortal, ownerless counter's tx builders + helpers (send-to-post board) ──
export {
  buildTickTx, buildGenesisTx, tickUnlockTemplate, keyHash160, LIVECOUNTER_FEE_PER_KB,
  type TickParams, type GenesisParams,
} from './liveCounterTx.ts'
export {
  buildLiveCounterLock, markByteLength, nField,
  MARK_MAX_BYTES, GENESIS_MARK, LIVECOUNTER_SCOPE, RECORD_LIVECOUNTER,
} from './liveCounter.ts'

// ── BRC-226 THE BATTERY — demo two's tx builders, so battery.html can build a top-up in the browser ──
// A tick needs no key and no wallet; only a TOP-UP is signed, because only a top-up spends someone's money.
export {
  buildBatteryTopUpTx, buildBatteryTickTx, buildBatteryGenesisTx, nextBatteryUtxo,
  tickUnlockTemplate as batteryTickUnlockTemplate,   // liveCounterTx exports the same name
  type BatteryUtxo, type BatteryTopUpParams, type BatteryTickParams,
} from './batteryTx.ts'
export {
  buildBatteryLock, genesisState, refState, ticksRemaining, opReturnScript, fixedField, u64le,
  BATTERY_MAX_FEE, BATTERY_FEE_PER_KB, BATTERY_SCOPE, BATTERY_GEOMETRY, BATTERY_STATE_LAYOUT,
  FIELDS, FIELD_WIDTHS, step0, S, SHIFT, ESCAPE, RECORD_BATTERY,
  type BatteryState, type BatteryGeometry,
} from './battery.ts'
// ── PURE SPV — Merkle proofs + block headers, no network, no trust ──────────────────────────────────
// This layer existed and shipped to nobody: `tokenProtocol` was imported ONLY as `import type` by
// walletProvider, so every verification function was dead code and every page that read the chain simply
// believed an API. Exporting it is what lets a page check the chain itself instead of trusting a server
// — including ours. `verifyProofChain` is generic: it proves each tx is in a block AND that the oldest
// entry is the genesis, which is the only real answer to a look-alike chain.
export {
  verifyMerkleProof, verifyProofChain, verifyProofChainAsync,
  createProofChain, extendProofChain, verifyToken, computeTokenId, computeFungibleTokenId,
  doubleSha256, hexToBytes, bytesToHex,
  type MerkleProofEntry, type MerklePathNode, type ProofChain, type BlockHeader, type VerificationResult,
} from './tokenProtocol.ts'

// ── @bsv/sdk primitives the browser modal needs directly (throwaway key gen, tip-tx parse, P2PKH) ──
export { PrivateKey, Transaction, P2PKH, SatoshisPerKilobyte } from '@bsv/sdk'
// Spend = the script interpreter. With it a PAGE can validate a covenant spend the way a node does,
// rather than taking anyone's word that the transaction it was handed is a legitimate advance.
export { Spend, LockingScript, UnlockingScript } from '@bsv/sdk'

// ── mint / editions / gift-voucher free units (low-level) ──
export {
  createEdition, createEditionV2, replicateEdition, replicateEditionV2,
  transferEdition, burnEdition,
  createGiftVouchers, claimGiftEdition, scanGiftVouchers, scanVoucherHashes, sweepGiftVouchers, deriveVoucherKey,
  toFundingInputs, wocScriptHash, resolveHolderEdition,
  scanIncomingEditions, scanMySales, scanCollectionBuyers,
} from './editionBuilder.ts'

// ── the programmable shell (BRC-226 demo three — Bitcoin Racers) ──
// Exported so the tuning bench runs the EXACT code the covenant will be validated against. A toy that
// reimplements the physics is a toy that quietly disagrees with the chain, which is the one thing it
// must never do — the battery's preview is bit-identical to its covenant for the same reason.
export {
  PHASE, PHASE_NAMES, FIELDS as SHELL_FIELDS, FIELD_WIDTHS as SHELL_FIELD_WIDTHS, STATE_BYTES,
  PROVISIONAL_REGS, SHELL_STATE_LAYOUT, SHELL_SCOPE, SHELL_FEE_SLACK, S as SHELL_S,
  emptyShell, loadCar, loadTrack, arm, refTick, canFinish, ShellRefused, fmul, fdiv,
} from './shell.ts'
export type { ShellState, RacerRegs, Move, TickResult, Phase } from './shell.ts'
// the SCRIPT itself, so a page can run the covenant rather than a description of it
export { RACER_REGS, buildShellLock, shellLockOps, shellUnlockingOps, RECORD_SHELL, SLIP_UNIT,
         SHELL_MAX_FEE, shellMaxFee, loadables } from './shell.ts'
export { serializeOutput } from './covenant.ts'
export { TransactionSignature, Hash, Utils } from '@bsv/sdk'
export { stateFits, fieldMax } from './shell.ts'

// ── driving a PUBLIC car that is already on chain (the depot demo) ──
// ★ The page uses THESE. A page that reimplements the physics is a page that quietly disagrees with
// the chain — and the decoder in particular must never be rewritten by hand: the state is thirteen
// separate pushes, and read at flat offsets it yields plausible nonsense rather than an error.
export {
  shellStateFromScript, isPublicCar, planRace, raceFrom,
  buildPublicMove, buildRefuelMove, lockTimeFor, smDecode, restingCar,
} from './publicDriver.ts'
export type { Step, RaceConfig } from './publicDriver.ts'
export { freshPublicShell, publicReset, isAtRest } from './publicShell.ts'
export {
  buildDepotLock, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK, DEPOT_BURN_BELOW, DEPOT_SCOPE,
} from './depot.ts'
export { buildDepotTopUpTx, TOPUP_FEE_PAD, TOPUP_INPUT_PAD, topUpPad } from './depotTx.ts'
export type { TopUpParams, TopUpRequest } from './depotTx.ts'
export { SHELL_TANK_MAX, PUBLIC_CAR_REGS, racerRegs, reserveRegs, tankMaxFor,
         SHELL_SCOPE as SHELL_SIGHASH_SCOPE } from './shell.ts'

// ── ★★★ THE ONE-RACE CAR — a car is born, races once, and dies ──────────────────────────────────
// ⚠ A DIFFERENT DESIGN FROM EVERYTHING ABOVE, not a revision of it. Above, a car persists and is
// refuelled and each tick is its own transaction; here the whole run is simulated first and compiled
// into ONE locking script, so the script length IS the predicted race. The two share the physics
// (`refTick`) and nothing else. → `mint/tools/RACERS.md`, and do not read a constant from one design
// and apply it to the other.
export {
  buildRacerCar, racerCarOps, racerCarFee, racerCarUnlock, carBlockOps, feeConstant,
  nameBytes, assertNoControlFlow, CONTROL_FLOW, varIntBytes,
  CAR_SCOPE, CAR_LAYOUT, CAR_LAYOUT_STRING, NAME_BYTES, CAR_BYTES_MIN, CAR_BYTES_MAX,
} from './racerCar.ts'
export type { CarConfig, CarParams } from './racerCar.ts'

// ⚠⚠ THE GATE. A one-race car has NO KEY — no owner, no burn branch, nothing but the preimage. So a
// car the covenant refuses can never be spent by anybody, and the satoshis in it are gone. Any page
// that funds a car MUST call `assertRaceable` first; it throws rather than returning, because a
// returned boolean can be ignored by accident and this one cannot be un-ignored.
export { buildRaceTx, raceValidates, assertRaceable } from './racerTx.ts'
export type { RaceTxParams, RaceReport } from './racerTx.ts'

// The minting depot, compiled from Bitcoin BASIC, with the window rate limit in it.
// ★ `racerDepotMaxFee` DERIVES the fee ceiling from `maxCarBytes` — never write that number down.
export {
  buildRacerDepotBasicLock, racerDepotBasicOps, racerDepotMaxFee, readDepotState,
  RACER_WINDOW_SECONDS, RACER_MINTS_PER_WINDOW, MARK_BYTES, COUNT_BYTES,
} from './racerDepotFrame.ts'
// the contribute button: the page builds it unsigned, Phar Lap signs it. The page holds no key.
export { buildRacerTopUpTx, racerTopUpPad, RACER_TOPUP_FEE_PAD, RACER_TOPUP_INPUT_PAD } from './racerDepotTopUp.ts'
export type { RacerTopUpParams, RacerTopUpRequest } from './racerDepotTopUp.ts'
export type { RacerDepotBasicParams } from './racerDepotFrame.ts'
export { RACER_DRAW, RACER_MAX_CAR_BYTES } from './racerDepot.ts'
/* ⚠⚠ `buildDepotUnlock` LIVES IN `depot.ts`, and the one-race depot reuses it deliberately — its
   unlocking stack is identical, so nothing downstream has to learn a second shape.
   ⚠ It was first re-exported from `racerDepot.ts`, where it does not exist. **esbuild built that
   without an error** and the symbol came out `undefined` at runtime, which the page would have hit as
   "not a function" while every test still passed. ⇒ A green build is not evidence a bundle is
   complete; load it and read the symbols back. */
export { buildDepotUnlock } from './depot.ts'
export { DEPOT_SRC, DEPOT_STACK } from './racerDepotSrc.ts'
export { specialiseRun } from './racerTick.ts'
export type { TickTrace, RunTrace, Ending } from './racerTick.ts'
export { optimizeCarCompile } from './optimizeCarCompile.ts'

// ⚠ ARC refuses a high-S signature (error 461) even though it is valid and minable, so a page that
// broadcasts must grind. The race's lever is FREE — measured: the car reads hashOutputs, its own
// scriptCode and its own value, and never nSequence or nLocktime. The mint's lever is the six hundred
// nLockTime values inside its own window.
export { derivedSigIsLowS } from './pushtx.ts'
