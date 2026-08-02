// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
// grafspace wallet — self-custody BSV key management, ported DOM-free from PharLap's app.ts.
// Pure crypto (seed / key / address) has no storage or DOM deps; persistence is a thin, guarded layer
// that no-ops when localStorage is unavailable (so this also runs in Node).
import { PrivateKey, PublicKey, Mnemonic, HD } from '@bsv/sdk'

// localStorage keys (namespaced to grafspace).
const WIF_KEY = 'gs:wallet:wif'
const MNEMONIC_KEY = 'gs:wallet:mnemonic'
const BACKED_UP_KEY = 'gs:wallet:backedUp' // set once the user confirms they've written the seed down
const WATCH_KEY = 'gs:wallet:watch'         // present → watch-only: pubkey hex, no private key on this box

// Fixed BIP-44 path (236 = BSV coin type). MUST never change — restores derive the same key from it.
const DERIVATION_PATH = "m/44'/236'/0'/0/0"

export interface WalletIdentity {
  key: PrivateKey | null // null in watch-only mode
  pubKeyHex: string
  address: string
  watchOnly: boolean
}

// ─── pure crypto (no storage, no DOM) ───────────────────────────────
/** Derive the wallet private key from a BIP-39 phrase (BIP-32 at the fixed path). Throws on an invalid phrase. */
export function keyFromMnemonic(phrase: string, passphrase = ''): PrivateKey {
  const m = phrase.trim().replace(/\s+/g, ' ')
  if (!Mnemonic.isValid(m)) throw new Error('invalid seed phrase')
  return HD.fromSeed(Mnemonic.fromString(m).toSeed(passphrase)).derive(DERIVATION_PATH).privKey
}

/** Make a fresh seed wallet: a 12-word phrase + the key it derives. */
export function newSeedWallet(): { mnemonic: string; key: PrivateKey } {
  const mnemonic = Mnemonic.fromRandom(128).toString() // 128 bits = 12 words
  return { mnemonic, key: keyFromMnemonic(mnemonic) }
}

export function importWif(wif: string): PrivateKey { return PrivateKey.fromWif(wif) }

export function identityFromKey(key: PrivateKey): WalletIdentity {
  return { key, pubKeyHex: key.toPublicKey().toString(), address: key.toAddress(), watchOnly: false }
}

/** A watch-only identity: holdings/balance/broadcast by public key alone — no private key on this box. */
export function watchIdentity(pubKeyHex: string): WalletIdentity {
  const pub = PublicKey.fromString(pubKeyHex)
  return { key: null, pubKeyHex: pub.toString(), address: pub.toAddress(), watchOnly: true }
}

// ─── guarded persistence (no-op when localStorage is unavailable) ────
const LS: Storage | null = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } })()
function lsGet(k: string): string | null { try { return LS?.getItem(k) ?? null } catch { return null } }
function lsSet(k: string, v: string): void { try { LS?.setItem(k, v) } catch { /* ignore */ } }
function lsDel(k: string): void { try { LS?.removeItem(k) } catch { /* ignore */ } }

/** Load the saved wallet, or — on first run — create + persist a fresh seed wallet (recoverable phrase). */
export function loadOrCreateWallet(): WalletIdentity {
  const watch = lsGet(WATCH_KEY)
  if (watch) { try { return watchIdentity(watch) } catch { /* fall through */ } }
  const wif = lsGet(WIF_KEY)
  if (wif) { try { return identityFromKey(importWif(wif)) } catch { /* fall through to new */ } }
  const { mnemonic, key } = newSeedWallet()
  lsSet(WIF_KEY, key.toWif()); lsSet(MNEMONIC_KEY, mnemonic)
  return identityFromKey(key)
}

/** Persist a real key (WIF + optional seed). A raw-WIF import has no phrase, so clear any stale one. */
export function saveKey(key: PrivateKey, mnemonic?: string): void {
  lsDel(WATCH_KEY)
  lsSet(WIF_KEY, key.toWif())
  if (mnemonic != null && mnemonic !== '') lsSet(MNEMONIC_KEY, mnemonic); else lsDel(MNEMONIC_KEY)
}

/** Enter watch-only mode: store only a pubkey; no private key lives on this box. */
export function saveWatch(pubKeyHex: string): void {
  const pub = PublicKey.fromString(pubKeyHex) // throws on bad input
  lsSet(WATCH_KEY, pub.toString()); lsDel(WIF_KEY); lsDel(MNEMONIC_KEY)
}

export function savedMnemonic(): string | null { return lsGet(MNEMONIC_KEY) }
export function markBackedUp(): void { lsSet(BACKED_UP_KEY, '1') }
/** A fresh seed wallet the user hasn't confirmed backing up yet (WIF-only wallets have no seed → false). */
export function needsSeedBackup(): boolean { return !!lsGet(MNEMONIC_KEY) && !lsGet(BACKED_UP_KEY) }
