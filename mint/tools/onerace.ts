// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ ONE RACE, END TO END — no key, no network, no wallet.
 *
 *   node --experimental-strip-types mint/tools/onerace.ts
 *   node --experimental-strip-types mint/tools/onerace.ts --eng 20 --tyr 8 --th 10 --name FLASH
 *
 * The driver picks a setup. The run is simulated to the last tick. A car is compiled FOR THAT RUN and
 * for no other, funded, and raced — one transaction, the whole quarter mile — and the satoshis come
 * back to the depot. The outcome was determined before the car existed; watching it is the fun.
 *
 * ⚠ Nothing here touches the network. It builds real transactions and validates the race through the
 * REAL interpreter, which is the only claim worth making offline: the spend the miners would judge is
 * the spend judged here.
 */
import { Transaction, TransactionSignature, Spend, LockingScript, UnlockingScript, PrivateKey, Hash } from '@bsv/sdk'
import {
  buildRacerCar, racerCarFee, racerCarUnlock, carBlockOps, CAR_SCOPE, CAR_LAYOUT_STRING,
} from '../src/racerCar.ts'
import { optimizeCarCompile } from '../src/optimizeCarCompile.ts'
import { type TickTrace, type Ending, type RunTrace } from '../src/racerTick.ts'
import {
  RACER_REGS as R, S, SLIP_UNIT, PHASE, refTick, buildShellLock, shellMaxFee, PUBLIC_CAR_REGS,
  SHELL_WORST_MOVE_BYTES,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { buildDepotLock } from '../src/depot.ts'
import { unbasicListing } from '../src/unbasic.ts'

/* ── the driver's choices ─────────────────────────────────────────────────────────────────────────── */
const arg = (k: string, d: number): number => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d
}
const argS = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const ENG = arg('eng', 14), TYR = arg('tyr', 10), SLIP = arg('slip', 1000)
const THROTTLE = arg('th', 8), TANK = arg('tank', 40000)
const METRES = arg('track', 402), NAME = argS('name', 'SUN-DIVE')
const OPTIMISE = !process.argv.includes('--plain')

const FINISH = Math.round(METRES * S)
const PHYS: Record<string, number> = {
  M0: R.M0, WE: R.WE, WT: R.WT, WF: R.WF, FE: R.FE, G0: R.G0, GV: R.GV,
  DRAG: R.DRAG, DRAG2: R.DRAG2, BLOW_V: R.BLOW_V, SPIN_KEEP: R.SPIN_KEEP, LOOSE_V: R.LOOSE_V,
  TM: R.THROTTLE_MAX, BURN0: R.BURN0, BURN_E: R.BURN_E, SLIP: SLIP_UNIT, S,
}

const bar = (s: string): void => console.log(`\n\x1b[1m${s}\x1b[0m`)
const n = (x: number): string => x.toLocaleString()

/* ── 1. THE SIMULATION — everything is known before anything is minted ───────────────────────────── */
bar('1 · THE DRIVER CHOOSES')
console.log(`     engine ${ENG} · tyres ${TYR} · surface ${SLIP}/1000 · throttle ${THROTTLE}`)
console.log(`     tank ${n(TANK)} · track ${METRES} m · name "${NAME}"`)

let st: Record<string, number> = {
  phase: PHASE.RACING, driver: new Array(20).fill(0) as never, pool: new Array(36).fill(0) as never,
  eng: ENG, tyr: TYR, finish: FINISH, slip: SLIP, green: 0, gap: 1, last: 100, s: 0, v: 0, n: 0,
} as never
let fuel = TANK
const ticks: TickTrace[] = []
let ending: Ending = 'finish'
for (let i = 0; i < 400; i++) {
  const r = refTick(st as never, { throttle: THROTTLE, fuel, lockTime: st.last + st.gap }, R)
  fuel -= r.burn
  ticks.push({ throttle: THROTTLE, spun: r.spun })
  st = { ...(r.state as never as Record<string, number>), last: st.last + st.gap }
  if (r.ended === 'off') { ending = 'off'; break }
  if (r.ended === 'blown') { ending = r.spun ? 'blown-throttle' : 'blown-speed'; break }
  if (st.phase === PHASE.DONE) { ending = 'finish'; break }
}
const run: RunTrace = { ticks, ending }
const seconds = ticks.length / 10
const mph = (st.v / S) * 2.23694 * 10

bar('2 · THE SIMULATION — and the driver is not shown this')
console.log(`     ${ticks.length} ticks · \x1b[1m${seconds.toFixed(2)} s\x1b[0m · ends '${ending}'` +
  (ending === 'finish' ? ` · trap ${mph.toFixed(0)} mph` : ''))
console.log(`     fuel ${n(TANK)} → ${n(fuel)} · spins ${ticks.filter(t => t.spun).length}`)

/* ── 2. THE CAR — compiled for THAT run and no other ─────────────────────────────────────────────── */
const KEY = PrivateKey.fromRandom()
const OWNER = Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const OLD = buildShellLock({ state: freshPublicShell(OWNER), maxFee: shellMaxFee(PUBLIC_CAR_REGS), public: true, regs: PUBLIC_CAR_REGS })
const DEPOT = buildDepotLock({ carScript: OLD.toBinary(), owner: OWNER })
const depotScript = DEPOT.toBinary()

const cfg = { name: NAME, fuel: TANK, eng: ENG, tyr: TYR, slip: SLIP, finish: FINISH }
const car = buildRacerCar({ cfg, run, depotScript, consts: PHYS, optimise: OPTIMISE })
const { fee, bytes } = racerCarFee({ cfg, run, depotScript, consts: PHYS, optimise: OPTIMISE })
const block = new LockingScript(carBlockOps({ depotScript })).toBinary()

bar('3 · THE CAR — minted knowing its own result')
console.log(`     lock ${n(car.toBinary().length)} B  ·  ${Math.round(car.toBinary().length / ticks.length)} B a tick` +
  `  ·  ${OPTIMISE ? 'optimised' : 'plain'}`)
console.log(`     head    ${CAR_LAYOUT_STRING}`)
console.log(`     block   ${n(block.length)} B, identical in every car — the depot pins this`)
if (OPTIMISE) {
  const o = optimizeCarCompile(run, { ...PHYS, TANK, eng: ENG, tyr: TYR, slip: SLIP, finish: FINISH })
  console.log(`     hoisted ${o.programs.hoisted.map(h => h.name).join(' · ')}` +
    `  (${((1 - o.optimisedBytes / o.faithfulBytes) * 100).toFixed(1)}% off the race body)`)
}

/* ── 3. THE MINT — the depot pays for the car's existence ────────────────────────────────────────── */
const V = fee + 1                                    // the least a car can be raced on
bar('4 · THE MINT — the depot builds the car and funds it')
console.log(`     the car is funded with ${n(V)} sat  (its own fee, plus one)`)

/* ── 4. THE RACE — one transaction, the whole run ────────────────────────────────────────────────── */
const src = new Transaction()
src.addOutput({ lockingScript: car, satoshis: V })
const tx = new Transaction()
tx.version = 2
tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
tx.addOutput({ lockingScript: DEPOT, satoshis: V - fee })
tx.lockTime = 0
const pre = TransactionSignature.format({
  sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V, transactionVersion: 2,
  otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xffffffff,
  subscript: car, lockTime: 0, scope: CAR_SCOPE,
})
tx.inputs[0].unlockingScript = new UnlockingScript(racerCarUnlock(pre))
const spend = new Spend({
  sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: V,
  lockingScript: car, transactionVersion: 2, otherInputs: [], outputs: tx.outputs,
  unlockingScript: new UnlockingScript(racerCarUnlock(pre)),
  inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
})
let valid = false, err = ''
try { valid = spend.validate() } catch (e) { err = (e as Error).message.split('\n')[0] }

bar('5 · THE RACE — one transaction, the whole run')
console.log(`     transaction ${n(bytes)} B · fee \x1b[1m${n(fee)} sat\x1b[0m = ${(fee * 1000 / bytes).toFixed(1)} sat/KB`)
console.log(`     unlocking script: the preimage, and nothing else (${n(pre.length)} B)`)
console.log(`     ${valid ? '\x1b[32m★ THE NETWORK ACCEPTS IT\x1b[0m' : '\x1b[31mREFUSED: ' + err + '\x1b[0m'}`)
console.log(`     assertions checked on chain: ${car.chunks.filter(c => c.op === 0x69).length}` +
  ` · arithmetic opcodes: ${n(car.chunks.filter(c => [0x93, 0x94, 0x95, 0x96].includes(c.op)).length)}`)

/* ── 5. THE MONEY ────────────────────────────────────────────────────────────────────────────────── */
const chained = ticks.length * Math.ceil(SHELL_WORST_MOVE_BYTES * 100 / 1000)
bar('6 · THE MONEY — and it all comes home')
console.log(`     depot out  ${n(V)} sat`)
console.log(`     miner      ${n(fee)} sat`)
console.log(`     depot in   ${n(V - fee)} sat`)
console.log(`     ⇒ the visitor never held a satoshi, and there is no key anywhere in this`)
console.log(`\n     the same race CHAINED: ${ticks.length} transactions, ${n(chained)} sat` +
  `  ⇒ \x1b[1m${(chained / fee).toFixed(1)}x\x1b[0m`)

/* ── 6. AND YOU CAN READ IT ──────────────────────────────────────────────────────────────────────── */
bar('7 · THE LEADERBOARD ROW, read off the chain')
console.log(`     ${NAME.padEnd(12)} ${seconds.toFixed(2)} s   eng ${ENG} · tyr ${TYR} · ${METRES} m · ${ending}`)
if (process.argv.includes('--listing')) {
  bar('8 · ONE TICK, AS THE SCRIPT SAYS IT')
  const lines = unbasicListing(car.chunks, { stack: ['preimage'] }).split('\n')
  console.log(lines.slice(0, 24).map(l => '     ' + l).join('\n'))
}
console.log()
process.exit(valid ? 0 : 1)
