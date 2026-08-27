// © 2026 sun-dive — Apache License 2.0.
// EVERY ARM OF THE STATE MACHINE, THROUGH THE REAL SCRIPT INTERPRETER.
//
//   node --experimental-strip-types mint/test/battery-branches.ts
//
// PRE-MINT SAFETY CHECK. battery-tx walks the covenant forward from genesis and validates every hop,
// which proves the common path. But the common path is one arm of four, and at 3840x2160 the others
// are unreachable by ticking: the row wrap is 3,840 ticks away, the frame end 8.3 MILLION, the
// precision-floor restart twenty-one frames after that. Nobody will be watching when those first
// execute. If any of them fails, the battery stops dead with no key to rescue it.
//
// So the states are CONSTRUCTED at each boundary and spent through `Spend`, the same interpreter a
// node runs. Each case also checks the reference implementation agrees about the resulting state —
// a branch that validates but computes something different is just as fatal, and quieter.
import { Transaction, P2PKH, PrivateKey, Spend, LockingScript } from '@bsv/sdk'
import { buildBatteryTickTx, nextBatteryUtxo, type BatteryUtxo } from '../src/batteryTx.ts'
import {
  buildBatteryLock, genesisState, refState, step0,
  BATTERY_GEOMETRY, BATTERY_MAX_FEE, type BatteryState,
} from '../src/battery.ts'

const G = BATTERY_GEOMETRY
const ST0 = step0(G)
const HW = Math.floor(G.W / 2), HH = Math.floor(G.H / 2)
const FUEL = 5_000_000

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}
const eq = (a: BatteryState, b: BatteryState): boolean =>
  (Object.keys(a) as Array<keyof BatteryState>).every(k => a[k] === b[k])

function validate(tx: Transaction, lock: LockingScript, sats: number): boolean {
  const input = tx.inputs[0]
  const spend = new Spend({
    sourceTXID: input.sourceTransaction!.id('hex'), sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sats, lockingScript: lock, transactionVersion: tx.version,
    otherInputs: [], outputs: tx.outputs, inputIndex: 0,
    unlockingScript: input.unlockingScript!, inputSequence: input.sequence ?? 0xffffffff, lockTime: tx.lockTime,
  })
  try { return spend.validate() === true } catch (e) { console.log('   ↳', (e as Error).message.split('\n')[0]); return false }
}

/** Spend `state` through the real interpreter and return the state the covenant produced. */
async function spendOnce(state: BatteryState): Promise<{ ok: boolean; produced: BatteryState | null }> {
  const prev = buildBatteryLock({ state })
  const source = new Transaction()
  source.addOutput({ lockingScript: prev, satoshis: FUEL })
  const utxo: BatteryUtxo = { sourceTransaction: source, outputIndex: 0, state, value: FUEL }
  const tx = await buildBatteryTickTx({ battery: utxo })
  const ok = validate(tx, prev, FUEL)
  // the covenant's own answer is the output script; compare it to the reference's
  const want = buildBatteryLock({ state: refState(state) }).toBinary()
  const got = tx.outputs[0].lockingScript.toBinary()
  const same = got.length === want.length && got.every((v, i) => v === want[i])
  return { ok: ok && same, produced: same ? refState(state) : null }
}

/** A state parked on pixel (x, y) of the frame whose geometry is (step, cx, cy), z = 0, i = 0. */
function at(x: number, y: number, step: number, cx = 0, cy = 0, mx = G.MX0): BatteryState {
  const cr0 = cx - HW * step, ci0 = cy - HH * step
  return { cr: cr0 + x * step, ci: ci0 + y * step, zr: 0, zi: 0, i: 0, step, cx, cy, mx }
}

console.log('THE BATTERY — every branch of the state machine, interpreter-validated')
console.log(`  grid ${G.W}x${G.H} · MX0 ${G.MX0} · K ${G.K} · MXCAP ${G.MXCAP} · MAX_FEE ${BATTERY_MAX_FEE}\n`)

// ── ARM 1 · iterate ───────────────────────────────────────────────────────────────────────────────
// The overwhelmingly common case: z is not escaped and i < mx, so z = z² + c and the pixel stays put.
{
  const s = genesisState()
  const r = await spendOnce(s)
  check('ARM 1 · iterate: a mid-pixel step validates', r.ok)
  check('ARM 1 · the pixel does NOT move', r.produced !== null && r.produced.cr === s.cr && r.produced.ci === s.ci)
  check('ARM 1 · i advances by one', r.produced?.i === 1)
}

// ── ARM 2 · advance along the row ─────────────────────────────────────────────────────────────────
{
  const s = { ...at(0, 0, ST0), i: G.MX0 }        // budget exhausted → this pixel is finished
  const r = await spendOnce(s)
  check('ARM 2 · advance: a finished pixel validates', r.ok)
  check('ARM 2 · cr advances exactly one step', r.produced?.cr === s.cr + ST0)
  check('ARM 2 · ci is unchanged, z and i reset',
    r.produced?.ci === s.ci && r.produced?.zr === 0 && r.produced?.i === 0)
}

// ── ARM 3 · WRAP THE ROW ──────────────────────────────────────────────────────────────────────────
// 3,840 ticks from genesis at this grid, and the first place an off-by-one in crMax would show.
{
  const s = { ...at(G.W - 1, 0, ST0), i: G.MX0 }   // the LAST pixel of row 0
  const r = await spendOnce(s)
  const cr0 = -HW * ST0
  check('ARM 3 · wrap: the last pixel of a row validates', r.ok)
  check('ARM 3 · cr returns to the row start', r.produced?.cr === cr0)
  check('ARM 3 · ci drops exactly one row', r.produced?.ci === s.ci + ST0)
  // and the pixel BEFORE it must not wrap — that is the off-by-one
  const before = { ...at(G.W - 2, 0, ST0), i: G.MX0 }
  const rb = await spendOnce(before)
  check('ARM 3 · the second-to-last pixel does NOT wrap', rb.ok && rb.produced?.ci === before.ci)
}

// ── ARM 4 · END OF FRAME → ZOOM ───────────────────────────────────────────────────────────────────
// 8,294,400 ticks away. Halves the step, adds K to mx, and quarters the pan residual.
{
  const s = { ...at(G.W - 1, G.H - 1, ST0), i: G.MX0 }
  const r = await spendOnce(s)
  check('ARM 4 · zoom: the last pixel of the last row validates', r.ok)
  check('ARM 4 · step halves', r.produced?.step === Math.trunc(ST0 / 2))
  check('ARM 4 · mx rises by K', r.produced?.mx === G.MX0 + G.K)
  check('ARM 4 · the centre pans toward the target',
    r.produced != null && r.produced.cx === Math.trunc((G.TX - 0) * 3 / 4))
}

// ── ARM 5 · MXCAP ─────────────────────────────────────────────────────────────────────────────────
// Never reached at these parameters (level 21 tops out at 2,688), but it is IN the script, so a bug
// there is permanent. Constructed directly at the cap.
{
  const near = G.MXCAP - Math.trunc(G.K / 2)      // one zoom would exceed the cap
  const s = { ...at(G.W - 1, G.H - 1, ST0, 0, 0, near), i: near }
  const r = await spendOnce(s)
  check('ARM 5 · MXCAP: a zoom at the cap validates', r.ok)
  check('ARM 5 · mx clamps to MXCAP rather than overflowing', r.produced?.mx === G.MXCAP)
}

// ── ARM 6 · PRECISION FLOOR → RESTART ─────────────────────────────────────────────────────────────
// The end of the whole journey: step can no longer halve, so the descent restarts at frame 1. This is
// what makes a perpetually funded battery loop instead of idling forever on an unresolvable frame.
{
  const deep = 1                                   // step = 1: one more halving would be 0
  const s = { ...at(G.W - 1, G.H - 1, deep, G.TX, G.TY, 2000), i: 2000 }
  const r = await spendOnce(s)
  check('ARM 6 · restart: the precision floor validates', r.ok)
  check('ARM 6 · step returns to step0', r.produced?.step === ST0)
  check('ARM 6 · mx returns to MX0', r.produced?.mx === G.MX0)
  check('ARM 6 · the centre returns to c = 0', r.produced?.cx === 0 && r.produced?.cy === 0)
}

// ── ARM 7 · ESCAPE ────────────────────────────────────────────────────────────────────────────────
// A point that leaves the disc mid-budget: |z|² > 4 finishes the pixel early, without reaching mx.
{
  // the top-left corner of frame 1 escapes almost immediately
  const s = at(0, 0, ST0)
  let cur: BatteryState = s, escaped = false
  for (let n = 0; n < 6; n++) {
    const nx = refState(cur)
    if (nx.cr !== cur.cr && cur.i < G.MX0) { escaped = true; break }   // moved on before exhausting mx
    cur = nx
  }
  check('ARM 7 · a corner pixel escapes before mx is spent', escaped)
  const r = await spendOnce(cur)
  check('ARM 7 · escape: the escaping step validates', r.ok)
}

// ── ARM 8 · CHAINING A NON-DEFAULT GEOMETRY ───────────────────────────────────────────────────────
// The bug this catches cost 647 good ticks and one rejected one on 2026-08-13. A drain of a battery
// with a DIFFERENT grid built every tick correctly and chained the state with nextBatteryUtxo's
// DEFAULT geometry. z² + c does not depend on the grid, so it ran perfectly until the scan reached the
// end of a row — where W is the only thing that matters. The chained state advanced, the covenant
// wrapped, and the next tick was rejected with mandatory-script-verify-flag-failed.
{
  const OTHER: BatteryGeometry = { ...G, W: 64, H: 48 }        // deliberately not BATTERY_GEOMETRY
  const OHW = Math.floor(OTHER.W / 2), OHH = Math.floor(OTHER.H / 2)
  const ost0 = step0(OTHER)
  const cr0 = -OHW * ost0, ci0 = -OHH * ost0
  // parked on the LAST pixel of row 0, budget spent — the next tick must wrap
  const s: BatteryState = {
    cr: cr0 + (OTHER.W - 1) * ost0, ci: ci0, zr: 0, zi: 0, i: OTHER.MX0,
    step: ost0, cx: 0, cy: 0, mx: OTHER.MX0,
  }
  const prev = buildBatteryLock({ state: s, geometry: OTHER })
  const source = new Transaction()
  source.addOutput({ lockingScript: prev, satoshis: FUEL })
  const utxo: BatteryUtxo = { sourceTransaction: source, outputIndex: 0, state: s, value: FUEL }
  const tx = await buildBatteryTickTx({ battery: utxo, geometry: OTHER })

  check('ARM 8 · the wrap tick validates at a non-default grid', validate(tx, prev, FUEL))

  const right = nextBatteryUtxo(tx, utxo, OTHER).state       // told which battery it is
  const wrong = nextBatteryUtxo(tx, utxo).state              // left to assume
  check('ARM 8 · chaining WITH the geometry matches the reference', eq(right, refState(s, OTHER)))
  check('ARM 8 · chaining WITHOUT it silently produces a different state', eq(wrong, right), false)
  console.log(`        with: cr ${right.cr} ci ${right.ci}   without: cr ${wrong.cr} ci ${wrong.ci}`)
  // and the covenant would reject a tick built from the wrong one — the failure seen on mainnet
  const bad = buildBatteryLock({ state: wrong, geometry: OTHER }).toBinary()
  const good = buildBatteryLock({ state: right, geometry: OTHER }).toBinary()
  check('ARM 8 · the two produce different locks — hence the rejected spend',
    bad.length === good.length && bad.every((v, i) => v === good[i]), false)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY BRANCHES: FAIL — do not mint'); process.exit(1) }
console.log('BATTERY BRANCHES OK — every arm executes and computes what the reference says.')
