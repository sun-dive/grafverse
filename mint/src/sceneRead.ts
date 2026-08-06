// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
// Read-only chain import: fetch a minted atom by txid → its embedded payload bytes (gunzipped if gzip).
// NO wallet/key required — this is the open, unencrypted path (an open-licence atom imports free, per the
// grafspace design). Encrypted content stays as ciphertext here (no gzip magic, no BMF header) and the caller
// reports it as unreadable without the holder key. Reuses the tested FILE-record parsers + native decompress.
import type { WalletProvider } from './walletProvider.ts'
import { parseFileScript, parseLegacyFileScript, parseTemplateScript, parseStorefrontScript, type FileFields } from './tokenCodec.ts'
import { decompress } from './compress.ts'

// ── licence tiers (see the wallet mint form) — OPEN = free to import (read-only); anything else = rights-reserved (purchase) ──
const OPEN_LICENSES = new Set(['OPEN-BSV', 'CC0', 'CC0-1.0', 'PD', 'CC-BY-4.0'])
/** True if an atom may be imported FREE (read-only). Missing/unknown licence defaults permissive (legacy atoms). */
export function isOpenLicense(code?: string | null): boolean {
  if (code == null || code === '') return true
  return OPEN_LICENSES.has(code.toUpperCase())
}

export interface CollectionInfo {
  txId: string
  tokenName: string
  license: string | null       // immutable licence code minted in the TEMPLATE record (e.g. CC0 · OPEN-BSV · ARR)
  licenseRef: string | null
  publisherPubKeyHex: string   // the creator's key (the fee payee)
  covenantScript: string       // the covenant template (hex) — feeds resolveHolderEdition for a purchase/replicate
  open: boolean                // isOpenLicense(license) → free-read vs purchase-to-import
  cover: { mimeType: string; bytes: number[] } | null   // public (unencrypted) storefront cover image, if any — the wallet thumbnail
  description: string | null   // public storefront blurb, if any
}

/** Read a collection's TEMPLATE record (TX1) → its licence + creator + covenant template. NO key needed.
 *  Lets an importer gate free-read (open) vs purchase-to-import (rights-reserved) before touching the content. */
export async function readCollection(provider: WalletProvider, txId: string): Promise<CollectionInfo | null> {
  const tx = await provider.getSourceTransaction(txId)
  let info: CollectionInfo | null = null
  let cover: { mimeType: string; bytes: number[] } | null = null
  let description: string | null = null
  for (const out of tx.outputs) {
    const t = parseTemplateScript(out.lockingScript)
    if (t != null && info == null) {
      const license = t.fields.license ?? null
      info = {
        txId, tokenName: t.fields.tokenName, license, licenseRef: t.fields.licenseRef ?? null,
        publisherPubKeyHex: t.publisherPubKeyHex, covenantScript: t.fields.covenantScript, open: isOpenLicense(license),
        cover: null, description: null,
      }
      continue
    }
    const sf = parseStorefrontScript(out.lockingScript)   // public storefront output → description + (unencrypted) cover image
    if (sf != null) {
      if (sf.fields.coverBytes != null && sf.fields.coverBytes.length > 0) cover = { mimeType: sf.fields.coverMimeType ?? 'image/webp', bytes: sf.fields.coverBytes }
      if (sf.fields.description != null && sf.fields.description.length > 0) description = sf.fields.description
    }
  }
  if (info != null) { info.cover = cover; info.description = description }
  return info
}

export interface LoadedAtom {
  bytes: number[]        // the raw payload (decompressed if it was gzipped) — e.g. packed BMF scene bytes
  mimeType: string
  fileName: string
  compressed: boolean    // true if the on-chain blob was gzip and we inflated it
}

/**
 * Fetch a minted edition (or legacy provenance) transaction by id and return the embedded FILE payload.
 * Prefers a NON-image record (the content, not its cover). Gunzips if the blob carries the gzip magic.
 * Throws if the tx has no readable file record.
 */
export async function loadAtomBytes(provider: WalletProvider, txId: string): Promise<LoadedAtom> {
  const tx = await provider.getSourceTransaction(txId)
  const files: FileFields[] = []
  for (const out of tx.outputs) {
    const ls = out.lockingScript
    const pd = parseFileScript(ls)
    if (pd != null) { files.push(pd.fields); continue }
    const legacy = parseLegacyFileScript(ls)
    if (legacy != null) files.push(legacy.fields)
  }
  if (files.length === 0) throw new Error('no embedded file record in this transaction')
  const pick = files.find(f => !/^image\//i.test(f.mimeType)) ?? files[0]   // skip the cover image if present
  let bytes = pick.fileBytes
  let compressed = false
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) { bytes = await decompress(bytes); compressed = true }  // gzip → inflate
  return { bytes, mimeType: pick.mimeType, fileName: pick.fileName, compressed }
}
