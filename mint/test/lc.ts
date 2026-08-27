// © 2026 sun-dive — Apache License 2.0. Structural smoke for the LiveCounter covenant (assembles + fixed width).
import { buildLiveCounterLock } from '../src/liveCounter.ts'

const authorHash = new Array(20).fill(0xab)
const funderHash = new Array(20).fill(0xcd)

const l0 = buildLiveCounterLock({ n: 0, lastFunderHash: funderHash, authorHash }).toBinary()
const l1 = buildLiveCounterLock({ n: 1, lastFunderHash: funderHash, authorHash }).toBinary()
const lBig = buildLiveCounterLock({ n: 1_000_000, lastFunderHash: funderHash, authorHash }).toBinary()

console.log('lock bytes @n=0      :', l0.length)
console.log('lock bytes @n=1      :', l1.length)
console.log('lock bytes @n=1e6    :', lBig.length)
const fixed = l0.length === l1.length && l1.length === lBig.length
console.log('fixed-width state    :', fixed)

if (!fixed) { console.error('FAIL: script length varies with n'); process.exit(1) }
console.log('LC STRUCTURAL OK')
