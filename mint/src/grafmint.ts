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
  shellStateFromScript, isPublicCar, planRace, buildPublicMove, lockTimeFor, smDecode, restingCar,
} from './publicDriver.ts'
export type { Step, RaceConfig } from './publicDriver.ts'
export { freshPublicShell, publicReset, isAtRest } from './publicShell.ts'
export { buildDepotLock, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK, DEPOT_BURN_BELOW } from './depot.ts'
export { buildDepotTopUpTx, TOPUP_FEE_PAD } from './depotTx.ts'
export type { TopUpParams, TopUpRequest } from './depotTx.ts'
export { SHELL_TANK_MAX, SHELL_SCOPE as SHELL_SIGHASH_SCOPE } from './shell.ts'
