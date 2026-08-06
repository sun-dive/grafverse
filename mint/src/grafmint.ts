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

// ── read-only chain import (no key): txid → embedded payload bytes (gunzipped) + licence gate ──
export { loadAtomBytes, readCollection, isOpenLicense } from './sceneRead.ts'

// ── seller/listing note (heading + description + tags) → publish on-chain for the curator to read (NFT.sale listing) ──
export { publishSellerNote } from './sellerNote.ts'

// ── pre-mint cost estimate (matches createEdition's own funding math) + compression for accurate file sizing ──
export { estimateEditionFunding, fundingMargin, type MintCostEstimate } from './editionBuilder.ts'
export { compressIfSmaller } from './compress.ts'

// ── mint / editions / gift-voucher free units (low-level) ──
export {
  createEdition, createEditionV2, replicateEdition, replicateEditionV2,
  transferEdition, burnEdition,
  createGiftVouchers, claimGiftEdition, scanGiftVouchers, scanVoucherHashes, sweepGiftVouchers, deriveVoucherKey,
  toFundingInputs, wocScriptHash, resolveHolderEdition,
  scanIncomingEditions, scanMySales, scanCollectionBuyers,
} from './editionBuilder.ts'
