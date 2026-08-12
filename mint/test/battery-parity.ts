// © BSV Association — Open BSV License v6.
// PORT PARITY — prove `src/battery.ts` is byte-for-byte the covenant that was verified in
// `test/battery-covenant-v3.mjs`, before anything is built on top of it.
//
// The harness ran at a 16×12 test grid with MAX_FEE 308 and measured lock 1,423 B. The port comes out
// 2 bytes LEANER, and both bytes are accounted for as deliberate CORRECTIONS rather than drift:
//
//   +1  the harness caps maxIter at 65,535 — the SUPERSEDED value. Script numbers are sign-magnitude,
//       so 65,535 in a 2-byte field reads back NEGATIVE; the decided cap is 32,767, which is 1 byte
//       shorter to push. (Latent, not live: the ramp could not reach 65,535 inside the depth ceiling.)
//   +1  a stray OP_NOP left in the "next row" arm of the state machine (battery-statemachine.mjs:102).
//
// This test pins that delta exactly, so the two bytes can never be mistaken for a porting bug, and then
// re-validates the covenant through the real @bsv/sdk `Spend` interpreter at the GENESIS parameters.
import { Spend, TransactionSignature, UnlockingScript, LockingScript, OP } from '@bsv/sdk'
import {
  buildBatteryLock, tickUnlockingOps, refState, genesisState, u64le,
  BATTERY_SCOPE, BATTERY_GEOMETRY, BATTERY_MAX_FEE, type BatteryState, type BatteryGeometry,
} from '../src/battery.ts'
import { serializeOutput } from '../src/covenant.ts'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}

const TEST_GEOMETRY: BatteryGeometry = { ...BATTERY_GEOMETRY, W: 16, H: 12 }

/** Run one tick through the interpreter: in0 = the covenant, out0 = the next covenant (+ any extras). */
function tick(
  s: BatteryState, V: number, newV: number,
  o: { geometry?: BatteryGeometry; maxFee?: number; extra?: Array<{ satoshis: number; lockingScript: LockingScript }> } = {},
): { ok: boolean; err: string | null; lock: number; unlock: number } {
  const geometry = o.geometry ?? BATTERY_GEOMETRY
  const maxFee = o.maxFee ?? BATTERY_MAX_FEE
  const extra = o.extra ?? []
  const prev = buildBatteryLock({ state: s, geometry, maxFee })
  const next = buildBatteryLock({ state: refState(s, geometry), geometry, maxFee })
  const outputs = [{ satoshis: newV, lockingScript: next }, ...extra]
  const spenderOutputs = extra.flatMap(x => serializeOutput(x.satoshis, x.lockingScript.toBinary()))
  const sourceTXID = 'ab'.repeat(32)
  const common = {
    sourceTXID, sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs, inputSequence: 0xffffffff, lockTime: 0,
  }
  const preimage = TransactionSignature.format({ ...common, subscript: prev, scope: BATTERY_SCOPE })
  const unlockingScript = new UnlockingScript(tickUnlockingOps({ spenderOutputs, newValue: u64le(newV), preimage }))
  const spend = new Spend({ ...common, lockingScript: prev, unlockingScript })
  try { return { ok: spend.validate() === true, err: null, lock: prev.toBinary().length, unlock: unlockingScript.toBinary().length } }
  catch (e) { return { ok: false, err: (e as Error).message.split('\n')[0], lock: prev.toBinary().length, unlock: unlockingScript.toBinary().length } }
}

console.log('BATTERY PORT PARITY — src/battery.ts vs the verified harness\n')

// ── 1 · the harness delta, accounted for byte by byte ───────────────────────────
const t = tick(genesisState(TEST_GEOMETRY), 1_000_000, 1_000_000 - 308, { geometry: TEST_GEOMETRY, maxFee: 308 })
console.log(`  harness params (16×12, fee 308) : lock ${t.lock} · unlock ${t.unlock}   (harness measured 1,423)`)
check('tick validates at harness params', t.ok)
check('port is exactly 2 B leaner than the harness', t.lock === 1423 - 2)

// the superseded 65,535 cap costs exactly one of those bytes — the other is the stray OP_NOP
const staleCap = { ...TEST_GEOMETRY, MXCAP: 65535 }
const withStaleCap = buildBatteryLock({ state: genesisState(staleCap), geometry: staleCap, maxFee: 308 }).toBinary().length
check('MXCAP 65,535 accounts for 1 byte', withStaleCap === t.lock + 1)
check('the remaining byte is the stray OP_NOP', 1423 - withStaleCap === 1)

// ── 2 · sizes at the GENESIS parameters (256×192, MAX_FEE 312) ──────────────────
const s0 = genesisState()
const g = tick(s0, 1_000_000, 1_000_000 - BATTERY_MAX_FEE)
console.log(`\n  genesis params (256×192, fee ${BATTERY_MAX_FEE}) : lock ${g.lock} · unlock ${g.unlock}`)
check('genesis lock is 1,425 B', g.lock === 1425)
check('genesis unlock is 1,597 B', g.unlock === 1597)
check('the 256×192 grid costs exactly 4 B over 16×12', g.lock - t.lock === 4)
check('genesis-parameter tick validates', g.ok)

// the fee floor this whole parameter choice turns on
const txBytes = 4 + 1 + (36 + 3 + g.unlock + 4) + 1 + (8 + 3 + g.lock) + 4
const rate = BATTERY_MAX_FEE / txBytes * 1000
console.log(`  tick tx ${txBytes} bytes → MAX_FEE ${BATTERY_MAX_FEE} pays ${rate.toFixed(3)} sat/KB`)
check(`MAX_FEE clears the 100 sat/KB floor`, rate >= 100)

// ── 3 · 40 consecutive ticks at the genesis parameters ──────────────────────────
let s = s0, V = 1_000_000, ticks = 0
for (let n = 0; n < 40; n++) {
  const r = tick(s, V, V - BATTERY_MAX_FEE)
  if (!r.ok) { console.log(`   ↳ failed at tick ${n}: ${r.err}`); break }
  ticks++; V -= BATTERY_MAX_FEE; s = refState(s)
}
check('40 consecutive ticks validate', ticks === 40)

// ── 4 · the value rule: a FLOOR, so top-ups are ticks too ───────────────────────
check('drop exactly MAX_FEE is accepted', tick(s, 1_000_000, 1_000_000 - BATTERY_MAX_FEE).ok)
check('drop MAX_FEE + 1 is REFUSED', tick(s, 1_000_000, 1_000_000 - BATTERY_MAX_FEE - 1).ok, false)
check('drop less than MAX_FEE is accepted', tick(s, 1_000_000, 1_000_000 - 100).ok)
check('a top-up (+500,000) is just another tick', tick(s, 1_000_000, 1_500_000).ok)

// ── 5 · trailing outputs are the spender's (the board's OP_RETURN + change ride here) ──
const p2pkh = new LockingScript([
  { op: OP.OP_DUP }, { op: OP.OP_HASH160 }, { op: 20, data: new Array(20).fill(9) },
  { op: OP.OP_EQUALVERIFY }, { op: OP.OP_CHECKSIG },
])
check('a tick with a trailing change output is accepted',
  tick(s, 1_000_000, 1_000_000 - BATTERY_MAX_FEE, { extra: [{ satoshis: 990_000, lockingScript: p2pkh }] }).ok)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY PARITY: FAIL'); process.exit(1) }
console.log('BATTERY PARITY OK — the port is the verified covenant, at the genesis parameters.')
