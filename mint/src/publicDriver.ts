// © BSV Association — Open BSV License v6.
/**
 * ★ DRIVING A PUBLIC CAR THAT IS ALREADY ON CHAIN.
 *
 * Everything a page or a CLI needs to pick up a real car at a real outpoint and move it: read its
 * state out of its own locking script, and build the next transaction. Both of them use THIS, because
 * a page that reimplements the physics is a page that quietly disagrees with the chain.
 *
 * ── ⚠ NOT ONE SIGNATURE IN HERE ───────────────────────────────────────────────────────────────────
 * A public car asks for a key only to burn. Every move below — configure, arm, tick, reset — is
 * authorised by arithmetic, so a visitor with no wallet, no key and no satoshi can drive.
 *
 * ── ⚠⚠ THE STATE IS NOT A FLAT BLOCK, AND ASSUMING IT IS COSTS AN HOUR ────────────────────────────
 * The 98 bytes live in THIRTEEN SEPARATE PUSHES, each preceded by its own length byte. Read at flat
 * offsets it decodes to nonsense that looks plausible — measured, on a real winning car: `phase 20,
 * n 83,992,084, s 27,264 m`, every field wrong and nothing throwing. So the decoder walks the pushes
 * and VERIFIES each length against FIELD_WIDTHS as it goes.
 */
import { Utils, Transaction, UnlockingScript, TransactionSignature, Spend } from '@bsv/sdk'
import {
  FIELDS, FIELD_WIDTHS, PHASE, RACER_REGS, SHELL_MAX_FEE, SHELL_SCOPE, S, buildShellLock, loadCar,
  loadTrack, arm, refTick, shellUnlockingOps, type ShellState, type RacerRegs,
} from './shell.ts'
import { freshPublicShell, publicReset } from './publicShell.ts'

/** The three-byte header every shell script carries before its fields: "P", version, record type. */
const HEADER_PUSHES = 3

/** Sign-magnitude, little-endian — the encoding published in SHELL_STATE_LAYOUT as `sm LE`. */
export function smDecode(b: number[]): number {
  if (b.length === 0) return 0
  const last = b[b.length - 1]
  let n = 0
  for (let i = b.length - 1; i >= 0; i--) n = n * 256 + (i === b.length - 1 ? (last & 0x7f) : b[i])
  return (last & 0x80) ? -n : n
}

/**
 * ★ READ A CAR OUT OF ITS OWN LOCKING SCRIPT.
 *
 * Returns null if the bytes are not a shell at all — a wrong outpoint, a P2PKH, a depot — rather than
 * throwing, because a page asks this of whatever it was pointed at.
 */
export function shellStateFromScript(script: number[] | string): ShellState | null {
  const b = typeof script === 'string' ? Utils.toArray(script, 'hex') : script
  let p = 0
  try {
    for (let i = 0; i < HEADER_PUSHES; i++) { const n = b[p]; if (n == null || n > 75) return null; p += 1 + n }
    const out: any = {}
    for (const k of FIELDS) {
      const n = b[p]
      if (n !== FIELD_WIDTHS[k]) return null            // ⚠ the length byte must be the field's own width
      const data = b.slice(p + 1, p + 1 + FIELD_WIDTHS[k])
      if (data.length !== FIELD_WIDTHS[k]) return null
      out[k] = (k === 'driver' || k === 'pool') ? data : smDecode(data)
      p += 1 + FIELD_WIDTHS[k]
    }
    return out as ShellState
  } catch { return null }
}

/** Is this script a PUBLIC car belonging to `owner`, in the state it claims? Cheap and total. */
export function isPublicCar(script: number[] | string, owner: number[]): boolean {
  const st = shellStateFromScript(script)
  if (!st) return false
  const hex = typeof script === 'string' ? script : Utils.toHex(script)
  return buildShellLock({ state: st, maxFee: SHELL_MAX_FEE, public: true }).toHex() === hex &&
         st.driver.length === 20 && st.driver.every((x, i) => x === owner[i])
}

/** One step in a plan: the successor state, and the flags the unlocking script needs to get there. */
export interface Step {
  label: string
  next: ShellState
  throttle: number
  reset: boolean
  /** The output's value AFTER this move. Fuel spent is the mining fee — the car pays its own way. */
  out: number
  burn: number
}

export interface RaceConfig {
  eng: number
  tyr: number
  finishM: number
  slip?: number
  /** Unix seconds. ⚠ Must be in the PAST — nLockTime finality is judged against median time past. */
  green: number
  gap?: number
}

/**
 * ★ THE WHOLE RUN, PLANNED BEFORE A BYTE IS SENT.
 *
 * Given the car as it stands and what the driver wants, produce every move in order. Planning it all
 * up front is what lets a page say "this will take 14 transactions and burn 7,800 satoshis" BEFORE it
 * spends anything — and what lets it refuse a run the fuel cannot finish.
 *
 * ⚠ A car that is not at EMPTY is RESET first. That is legal from any phase and costs one move, and
 * it is the only way to reconfigure a car somebody else set up.
 */
export function planRace(
  car: ShellState, fuel: number, cfg: RaceConfig, regs: RacerRegs = RACER_REGS,
): { steps: Step[]; feasible: boolean; why?: string } {
  const steps: Step[] = []
  let st = car
  let f = fuel

  const push = (label: string, next: ShellState, o: { throttle?: number; reset?: boolean; burn: number }): void => {
    f -= o.burn
    steps.push({ label, next, throttle: o.throttle ?? 0, reset: o.reset ?? false, out: f, burn: o.burn })
    st = next
  }

  if (st.phase !== PHASE.EMPTY) {
    push('reset — back to an empty car', publicReset(st), { reset: true, burn: regs.BURN0 })
  }
  if (f < regs.BURN0 * 4) return { steps, feasible: false, why: 'not enough fuel to even configure the car' }

  push('configure — engine and tyres',
    loadCar(st, { driver: st.driver, eng: cfg.eng, tyr: cfg.tyr }, regs), { burn: regs.BURN0 })
  push('the track — distance, surface, the tree',
    loadTrack(st, { finish: Math.round(cfg.finishM * S), slip: cfg.slip ?? 1000,
                    green: cfg.green, gap: cfg.gap ?? 1, pool: new Array(36).fill(0) }), { burn: regs.BURN0 })
  push('arm it — the specs freeze here', arm(st), { burn: regs.BURN0 })

  /* The race. The strategy is the reference's own: the largest throttle that does not break traction,
     which is also the one that will not over-rev, because both end the run and both are refused. */
  const safeThrottle = (s: ShellState, fuelNow: number): number => {
    let lo = 0, hi = regs.THROTTLE_MAX, best = 0
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      let r; try { r = refTick(s, { throttle: m, lockTime: Math.max(s.green, s.last + s.gap), fuel: fuelNow }, regs) } catch { break }
      if (r.spun || r.ended) hi = m - 1; else { best = m; lo = m + 1 }
    }
    return best
  }

  while (st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && st.n < 900) {
    const throttle = safeThrottle(st, f)
    const at = Math.max(st.green, st.last + st.gap)
    const want = refTick(st, { throttle, lockTime: at, fuel: f }, regs)
    if (f - want.burn < 1) return { steps, feasible: false, why: `runs dry at ${(st.s / S).toFixed(0)} m of ${cfg.finishM}` }
    push(`move ${want.state.n} · ${(want.state.n * 0.1).toFixed(1)} s`, want.state, { throttle, burn: want.burn })
  }
  return { steps, feasible: st.phase === PHASE.DONE, why: st.phase === PHASE.DONE ? undefined : 'the run ended before the line' }
}

/** A fresh public car for this owner — what a car at rest looks like, and what the depot recognises. */
export const restingCar = freshPublicShell

/**
 * ★ ONE MOVE, AS A TRANSACTION. Spends the car, produces the car.
 *
 * ⚠ NO SIGNATURE AND NO FUNDING INPUT. The move pays its own fee out of the fuel it does not carry
 * forward, which is why the car gets lighter as it races and why a page needs no wallet at all.
 *
 * ⚠ The interpreter is run before the transaction is returned. A move the covenant would refuse never
 * reaches the network, so a page cannot spend a fee discovering what the reference already knew.
 */
export function buildPublicMove(o: {
  prevTx: Transaction
  vout: number
  state: ShellState
  value: number
  step: Step
  lockTime: number
}): { tx: Transaction; ok: boolean } {
  const lock = buildShellLock({ state: o.state, maxFee: SHELL_MAX_FEE, public: true })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.prevTx, sourceOutputIndex: o.vout, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: o.step.next, maxFee: SHELL_MAX_FEE, public: true }), satoshis: o.step.out })
  tx.lockTime = o.lockTime

  const pre = TransactionSignature.format({
    sourceTXID: o.prevTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.value,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const n = o.step.next
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [], newValue: u64le(o.step.out), preimage: pre,
    sig: [], pubKey: [], throttle: o.step.throttle, retire: o.step.reset,
    load: { driver: n.driver, pool: n.pool, eng: n.eng, tyr: n.tyr,
            finish: n.finish, slip: n.slip, green: n.green, gap: n.gap },
  }))

  let ok = false
  try {
    ok = new Spend({
      sourceTXID: o.prevTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.value,
      lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript, inputSequence: 0xfffffffe, lockTime: tx.lockTime,
    }).validate() === true
  } catch { /* the covenant refused it — ok stays false */ }
  return { tx, ok }
}

/** The nLockTime a step must carry: the covenant's own clock, never the wall clock. */
export const lockTimeFor = (st: ShellState): number => Math.max(st.green, st.last + st.gap)

const u64le = (n: number): number[] => {
  const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}
