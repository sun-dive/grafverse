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
// ── @bsv/sdk primitives the browser modal needs directly (throwaway key gen, tip-tx parse, P2PKH) ──
export { PrivateKey, Transaction, P2PKH, SatoshisPerKilobyte } from '@bsv/sdk'

// ── mint / editions / gift-voucher free units (low-level) ──
export {
  createEdition, createEditionV2, replicateEdition, replicateEditionV2,
  transferEdition, burnEdition,
  createGiftVouchers, claimGiftEdition, scanGiftVouchers, scanVoucherHashes, sweepGiftVouchers, deriveVoucherKey,
  toFundingInputs, wocScriptHash, resolveHolderEdition,
  scanIncomingEditions, scanMySales, scanCollectionBuyers,
} from './editionBuilder.ts'
