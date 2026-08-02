// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
// High-level mint wrapper for grafspace — turns a packed BMF/BMC atom + metadata into an on-chain edition,
// hiding the covenant/terms plumbing from the wallet UI. The publisher (fee payee) is the minter's own key.
import { Hash, Utils } from '@bsv/sdk'
import { WalletProvider } from './walletProvider.ts'
import { createEdition, type CreateEditionResult } from './editionBuilder.ts'
import type { WalletIdentity } from './wallet.ts'

export interface MintAtomOpts {
  tokenName: string
  bytes: number[]                 // the packed binary BMF/BMC atom
  mimeType?: string               // default 'application/bmf'
  fileName?: string               // default 'atom.bmf'
  description?: string
  /** Immutable licence code, fixed at mint (travels with the coin). e.g. 'OPEN-BSV', 'CC0', 'PD', 'ARR'. */
  license?: string
  /** Optional 64-hex txid pointing at the full licence text on-chain. */
  licenseRef?: string
  cover?: { mimeType: string; fileName: string; bytes: number[] }
  /** Publisher royalty per resale (sats). MINIMUM 1 — the 1-sat covenant outputs are the basis of the
   *  messaging system, and 0 is invalid. "Free" comes from an open LICENCE (public, unencrypted chain-pull),
   *  NOT from zero fees. */
  publisherFeeSats?: number
  /** Reseller/holder award per resale (sats). MINIMUM 1 (same reason). */
  holderFeeSats?: number
  mintCount?: number
  /** Encrypt the content. FALSE for free/public atoms so anyone can pull them from chain (default false). */
  encrypt?: boolean
  feePerKb?: number
  /** Spend gate: called with the EXACT total sats before broadcast. Return false to abort. */
  confirmSpend?: (totalSats: number) => boolean | Promise<boolean>
}

/** Mint a packed atom as a replicable edition owned by (and paying royalties to) the wallet's own key. */
export async function mintAtom(provider: WalletProvider, wallet: WalletIdentity, o: MintAtomOpts): Promise<CreateEditionResult> {
  if (wallet.key == null) throw new Error('This is a watch-only wallet — it cannot mint. Load your key first.')
  const publisherPubKeyHash = Hash.hash160(Utils.toArray(wallet.pubKeyHex, 'hex'))
  return createEdition(provider, wallet.key, {
    tokenName: o.tokenName,
    // fees + bond are ≥1 (messaging basis + burnability). tokenSats (the bond) defaults to 1 inside createEdition.
    terms: { publisherPubKeyHash, publisherFeeSats: Math.max(1, o.publisherFeeSats ?? 1), holderFeeSats: Math.max(1, o.holderFeeSats ?? 1) },
    mintCount: o.mintCount ?? 1,
    file: { mimeType: o.mimeType ?? 'application/bmf', fileName: o.fileName ?? 'atom.bmf', bytes: o.bytes },
    encrypt: o.encrypt === true,
    description: o.description,
    cover: o.cover,
    license: o.license,
    licenseRef: o.licenseRef,
    feePerKb: o.feePerKb,
    confirmSpend: o.confirmSpend,
  })
}
