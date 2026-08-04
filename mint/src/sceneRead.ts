// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
// Read-only chain import: fetch a minted atom by txid → its embedded payload bytes (gunzipped if gzip).
// NO wallet/key required — this is the open, unencrypted path (an open-licence atom imports free, per the
// grafspace design). Encrypted content stays as ciphertext here (no gzip magic, no BMF header) and the caller
// reports it as unreadable without the holder key. Reuses the tested FILE-record parsers + native decompress.
import type { WalletProvider } from './walletProvider.ts'
import { parseFileScript, parseLegacyFileScript, type FileFields } from './tokenCodec.ts'
import { decompress } from './compress.ts'

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
