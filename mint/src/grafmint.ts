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

// ── mint / editions / gift-voucher free units ──
export {
  createEdition, createEditionV2, replicateEdition, replicateEditionV2,
  transferEdition, burnEdition,
  createGiftVouchers, claimGiftEdition, scanGiftVouchers, scanVoucherHashes, sweepGiftVouchers, deriveVoucherKey,
  toFundingInputs, wocScriptHash, resolveHolderEdition,
  scanIncomingEditions, scanMySales, scanCollectionBuyers,
} from './editionBuilder.ts'
