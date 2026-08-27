// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
// Phase-A smoke test: prove the wallet crypto + on-ramp work (no DOM / no network).
import { newSeedWallet, keyFromMnemonic, importWif, identityFromKey, watchIdentity } from '../src/wallet.ts'
import { buyBsvUrl } from '../src/onramp.ts'

const { mnemonic, key } = newSeedWallet()
const id = identityFromKey(key)
console.log('seed :', mnemonic)
console.log('wif  :', key.toWif())
console.log('addr :', id.address)
console.log('pub  :', id.pubKeyHex)

const fromWif = identityFromKey(importWif(key.toWif()))
const fromSeed = identityFromKey(keyFromMnemonic(mnemonic))
const watch = watchIdentity(id.pubKeyHex)

const wifOk = fromWif.address === id.address
const seedOk = fromSeed.address === id.address
const watchOk = watch.address === id.address && watch.watchOnly && watch.key === null
console.log('restore-from-wif  :', wifOk)
console.log('restore-from-seed :', seedOk)
console.log('watch-only        :', watchOk)
console.log('onramp            :', buyBsvUrl())

if (!wifOk || !seedOk || !watchOk) { console.error('FAIL: identity mismatch'); process.exit(1) }
console.log('SMOKE OK')
