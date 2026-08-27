// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
// grafspace "Buy BSV" on-ramp — SimpleSwap, ported DOM-free from PharLap's app.ts.
// The Buy-BSV link opens SimpleSwap (swap any crypto — incl. stablecoins — for BSV) tagged with a referral
// chosen by precedence: a share link's ?aff=… → your own saved ref-code → who gifted you → the app default.
const SIMPLESWAP_BASE = 'https://simpleswap.io/'
// Default SimpleSwap ref-code when no other referral is present — sun-dive's AFFILIATE code (partners link,
// NOT the customer refer-a-friend code). Buy-BSV → simpleswap.io/?ref=<code>&from=btc-btc&to=bsv-bsv.
const DEFAULT_REF_CODE = 'efe9f9694b4f'

let incomingAff: string | null = null // ref-code carried in on a share link opened this session

const LS: Storage | null = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } })()
function lsGet(k: string): string | null { try { return LS?.getItem(k) ?? null } catch { return null } }
function lsSet(k: string, v: string): void { try { LS?.setItem(k, v) } catch { /* ignore */ } }

/** Set the ref-code carried in on the current share link (?aff=…), so buyers fund under the sharer's code. */
export function setIncomingAff(code: string | null): void { incomingAff = code }

/** Pull a ref-code out of a SimpleSwap URL (?ref=/?referral=) or a bare code; null if none. */
export function extractRefCode(input: string): string | null {
  const s = input.trim()
  if (s === '') return null
  const m = s.match(/[?&](?:ref|referral)=([^&\s]+)/i)
  if (m) return decodeURIComponent(m[1])
  if (/^[A-Za-z0-9_-]{3,}$/.test(s)) return s // a bare ref-code
  return null
}

function myRefCode(): string | null { return lsGet('gs:affRefCode') }
function refByCode(): string | null { return lsGet('gs:refBy') } // who gifted this wallet

/** On a gift claim, remember the gifter's ref-code so their referral persists for this (often new) wallet. */
export function rememberGifter(): void {
  if (incomingAff == null || incomingAff === '') return
  if (refByCode() == null) lsSet('gs:refBy', incomingAff)
}

/** Save your own ref-code, so the links you share fund buyers under you. */
export function saveMyRefCode(code: string): void { lsSet('gs:affRefCode', code) }

/** The Buy-BSV (SimpleSwap) URL for the active context. Pre-selects a BTC → BSV swap of ~0.001 BTC. */
export function buyBsvUrl(): string {
  const code = incomingAff || myRefCode() || refByCode() || DEFAULT_REF_CODE
  const ref = code ? 'ref=' + encodeURIComponent(code) + '&' : ''
  return SIMPLESWAP_BASE + '?' + ref + 'from=btc-btc&to=bsv-bsv&amount=0.001'
}

/** Append your referral code to a share URL so buyers who open it fund up under YOUR ref-code. */
export function withAff(url: string): string {
  const code = myRefCode()
  return code != null && code !== '' ? `${url}&aff=${encodeURIComponent(code)}` : url
}
