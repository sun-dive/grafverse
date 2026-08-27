// © 2026 sun-dive — Apache License 2.0.
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
import {
  Utils, Transaction, UnlockingScript, LockingScript, TransactionSignature, Spend,
} from '@bsv/sdk'
import {
  /* ⚠ `SHELL_MAX_FEE` is deliberately NOT imported here any more. It is the DEFAULT car's ceiling, and
     every builder below takes regulations — reaching for the constant is how a variant car gets built
     against the wrong number. `shellMaxFee(regs)` is the same value for a default car. */
  FIELDS, FIELD_WIDTHS, PHASE, RACER_REGS, SHELL_SCOPE, S, buildShellLock, loadCar,
  loadTrack, arm, refTick, shellUnlockingOps, shellMaxFee, type ShellState, type RacerRegs,
} from './shell.ts'
import { freshPublicShell, publicReset } from './publicShell.ts'
import { buildDepotUnlock } from './depot.ts'
import { serializeOutput } from './covenant.ts'

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

/**
 * Is this script a PUBLIC car belonging to `owner`, in the state it claims? Cheap and total.
 *
 * ⚠ IT ANSWERS FOR ONE VARIANT AT A TIME. A pit-and-reserve car is a different script from a default
 * one, so a page that recognises only the regulations it was compiled with will look straight past a
 * car that is perfectly real. Pass the regulations the car was minted under.
 */
export function isPublicCar(
  script: number[] | string, owner: number[], regs: RacerRegs = RACER_REGS,
): boolean {
  const st = shellStateFromScript(script)
  if (!st) return false
  const hex = typeof script === 'string' ? script : Utils.toHex(script)
  return buildShellLock({ state: st, maxFee: shellMaxFee(regs), public: true, regs }).toHex() === hex &&
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
 * spends anything.
 *
 * ★ IT DOES NOT REFUSE A RUN THE FUEL CANNOT FINISH. It plans as far as the fuel goes and reports
 * where the car stops. Under-fuelling is the driver's mistake to make, and stopping short of the line
 * is a racing outcome — and now a final one, since the pump will not come out to a moving car.
 *
 * ⚠ A car that is not at EMPTY is RESET first. That is legal from any phase and costs one move, and
 * it is the only way to reconfigure a car somebody else set up.
 */
export function planRace(
  car: ShellState, fuel: number, cfg: RaceConfig, regs: RacerRegs = RACER_REGS,
): { steps: Step[]; feasible: boolean; outcome: 'home' | 'dry' | 'out' | 'stalled'; reached: number; why?: string } {
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
  if (f < regs.BURN0 * 4) return { steps, feasible: false, outcome: 'stalled', reached: 0, why: 'not enough fuel even to configure the car' }

  push('configure — engine and tyres',
    loadCar(st, { driver: st.driver, eng: cfg.eng, tyr: cfg.tyr }, regs), { burn: regs.BURN0 })
  push('the track — distance, surface, the tree',
    loadTrack(st, { finish: Math.round(cfg.finishM * S), slip: cfg.slip ?? 1000,
                    green: cfg.green, gap: cfg.gap ?? 1, pool: new Array(36).fill(0) }), { burn: regs.BURN0 })
  push('arm it — the specs freeze here', arm(st), { burn: regs.BURN0 })

  const raced = raceFrom(st, f, regs)
  steps.push(...raced.steps)
  return { ...raced, steps }
}

/**
 * ★★ THE RACE ITSELF, FROM WHEREVER THE CAR IS — and the reason it is a function of its own.
 *
 * `planRace` RESETS any car that is not at EMPTY, which is right when a driver is setting a car up and
 * wrong for one already on the strip — it would throw the run away and hand back a fresh car. So the
 * racing loop lives here, and anything continuing a run in progress uses it:
 *
 *   planRace       reset → configure → track → arm → raceFrom
 *   raceFrom       carry on from exactly where a car stands, on the fuel it holds
 *
 * ⚠ ONE IMPLEMENTATION, deliberately. A continuation that reimplemented the tick would be a second
 * opinion about the physics, and this project has already learned what a scratch model that disagrees
 * with the reference costs.
 */
/**
 * The largest throttle that does not break traction — which is also the one that will not over-rev,
 * because both end the run and both are refused.
 *
 * ⚠ Module-level and shared, so every caller picks its throttle the same way. A second implementation
 * of "how hard may I press" is a second opinion about the physics.
 */
function safeThrottle(s: ShellState, fuelNow: number, regs: RacerRegs): number {
  let lo = 0, hi = regs.THROTTLE_MAX, best = 0
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    let r; try { r = refTick(s, { throttle: m, lockTime: Math.max(s.green, s.last + s.gap), fuel: fuelNow }, regs) } catch { break }
    if (r.spun || r.ended) hi = m - 1; else { best = m; lo = m + 1 }
  }
  return best
}

/* ── ✗ `pitStep` LIVED HERE, AND THE MOVE IT PLANNED CANNOT HAPPEN (sun-dive, 16 Aug) ─────────────
   It returned the tick a driver would take WHILE THE PUMP RAN — the one the car could not afford
   alone, with the depot covering the shortfall in the same transaction. The depot now refuses to fuel
   any car whose `s` is not zero, so there is no such move to plan.

   ⇒ A short run has two ends now, and a planner that offered a third would be lying to the page:
     · COAST on the reserve and hope the line comes up before the money does
     · RESET back to the line, fill, and start the run again
   → `depot-dry.ts` drives both. */

export function raceFrom(
  car: ShellState, fuel: number, regs: RacerRegs = RACER_REGS,
): { steps: Step[]; feasible: boolean; outcome: 'home' | 'dry' | 'out'; reached: number; why?: string } {
  const steps: Step[] = []
  let st = car
  let f = fuel
  const push = (label: string, next: ShellState, o: { throttle: number; burn: number }): void => {
    f -= o.burn
    steps.push({ label, next, throttle: o.throttle, reset: false, out: f, burn: o.burn })
    st = next
  }

  while (st.phase !== PHASE.DONE && st.phase !== PHASE.OUT && st.n < 900) {
    const throttle = safeThrottle(st, f, regs)
    const at = Math.max(st.green, st.last + st.gap)
    const want = refTick(st, { throttle, lockTime: at, fuel: f }, regs)
    /* ★★ RUNNING DRY IS A RESULT, NOT AN ERROR — and this used to REFUSE the run.
       A page that only lets you attempt races you are certain to win is not a race, it is a menu. If
       the driver puts in too little fuel the car stops short of the line, which is the outcome every
       real strip has. So the plan simply ends where the fuel does, and says where that is. Nothing
       here judges the driver — and nothing rescues them either: the pump will not come out to a car
       that has left the line. */
    if (f - want.burn < 1) {
      return { steps, feasible: false, outcome: 'dry',
               why: `stops at ${(st.s / S).toFixed(0)} m of ${(st.finish / S).toFixed(0)} — out of fuel`,
               reached: st.s / S }
    }
    push(`move ${want.state.n} · ${(want.state.n * 0.1).toFixed(1)} s`, want.state, { throttle, burn: want.burn })
  }
  const home = st.phase === PHASE.DONE
  return {
    steps, feasible: home, reached: st.s / S,
    outcome: home ? 'home' : 'out',
    why: home ? undefined : 'the run ended before the line — grip or the engine, not the fuel',
  }
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
  /** ⚠ THE CAR'S OWN REGULATIONS, and `MAX_FEE` is DERIVED from them — see below. */
  regs?: RacerRegs
}): { tx: Transaction; ok: boolean } {
  /* ⚠⚠ `shellMaxFee(regs)`, NEVER the module constant. MAX_FEE is derived from BURN0 and BURN0 is
     per-variant, so a pit or reserve car built against the DEFAULT ceiling is a different script from
     the one that was minted — the rebuild then hashes to something the covenant does not recognise and
     every move fails, for a reason nothing in the error points at. */
  const regs = o.regs ?? RACER_REGS
  const lock = buildShellLock({ state: o.state, maxFee: shellMaxFee(regs), public: true, regs })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.prevTx, sourceOutputIndex: o.vout, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: o.step.next, maxFee: shellMaxFee(regs), public: true, regs }), satoshis: o.step.out })
  tx.lockTime = o.lockTime

  const pre = TransactionSignature.format({
    sourceTXID: o.prevTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.value,
    transactionVersion: 2, otherInputs: [], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: lock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  const n = o.step.next
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: [], newValue: u64le(o.step.out), preimage: pre,
    sig: [], pubKey: [], throttle: o.step.throttle, retire: o.step.reset, regs,
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

/**
 * ★★ THE SPLASH-AND-DASH — one move, and a tap of the pump, in the same transaction.
 *
 *   IN    car (V, any phase)     +  depot (tank)
 *   OUT   car (step.out + draw)  +  depot (tank − draw − depotMaxFee)
 *
 * ⚠ THE CAR IS OUTPUT 0 AND THE DEPOT IS OUTPUT 1, and that order is not a preference. Both covenants
 * rebuild themselves relative to their own slot; the car's is hard-coded to out0 and cannot move, so
 * the depot yields it and names the car as its PREFIX. Swap them and the car refuses — which is
 * exactly the collision that made a refuel look impossible until the depot learned to carry a prefix.
 *
 * ★ It works in ANY phase, because the depot recognises a car by its SHAPE — constant head, twelve
 * pinned push opcodes, constant tail — rather than by one hash of a car at rest. A driver at 300 m can
 * take fuel and keep the run.
 *
 * ⚠ NO SIGNATURE AND NO FUNDING INPUT, exactly as an ordinary move. The pump costs the driver a tick
 * and the extra weight of the fuel it delivers, which is the trade a real fill makes too.
 *
 * ⇒ Pass the step you would have made anyway. This does not choose racing strategy; it only adds fuel
 * to the move you were already making.
 */
export function buildRefuelMove(o: {
  prevTx: Transaction
  vout: number
  state: ShellState
  value: number
  step: Step
  lockTime: number
  depot: { sourceTransaction: Transaction; outputIndex: number; value: number }
  depotLock: LockingScript
  /** What leaves the tank. The depot bounds this itself; passing more simply gets refused. */
  draw: number
  depotMaxFee: number
  depotScope: number
  /** ⚠ The car's own regulations — the same ones the depot was built to recognise. */
  regs?: RacerRegs
}): { tx: Transaction; carOk: boolean; depotOk: boolean; carOut: number; kept: number } {
  const regs = o.regs ?? RACER_REGS
  const carLock = buildShellLock({ state: o.state, maxFee: shellMaxFee(regs), public: true, regs })
  /* ⚠ THE DEPOT WILL REFUSE THIS UNLESS THE CAR'S NEW `s` IS ZERO — at the line, or resetting back to
     it. Built anyway rather than pre-checked here, because the covenant is the thing that decides and
     both halves are run through the interpreter below before this returns. */
  const carOut = o.step.out + o.draw
  const kept = o.depot.value - o.draw - o.depotMaxFee

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.prevTx, sourceOutputIndex: o.vout, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: o.depot.sourceTransaction, sourceOutputIndex: o.depot.outputIndex,
                sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: o.step.next, maxFee: shellMaxFee(regs), public: true, regs }),
                 satoshis: carOut })                                   // out0 — the car's own slot
  tx.addOutput({ lockingScript: o.depotLock, satoshis: kept })
  tx.lockTime = o.lockTime
  const ser = (i: number): number[] =>
    serializeOutput(tx.outputs[i].satoshis ?? 0, tx.outputs[i].lockingScript.toBinary())

  const n = o.step.next
  const cPre = TransactionSignature.format({
    sourceTXID: o.prevTx.id('hex'), sourceOutputIndex: o.vout, sourceSatoshis: o.value,
    transactionVersion: 2, otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: carLock, lockTime: tx.lockTime, scope: SHELL_SCOPE,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: ser(1), newValue: u64le(carOut), preimage: cPre,
    sig: [], pubKey: [], throttle: o.step.throttle, retire: o.step.reset, regs,
    load: { driver: n.driver, pool: n.pool, eng: n.eng, tyr: n.tyr,
            finish: n.finish, slip: n.slip, green: n.green, gap: n.gap },
  }))

  const dPre = TransactionSignature.format({
    sourceTXID: o.depot.sourceTransaction.id('hex'), sourceOutputIndex: o.depot.outputIndex,
    sourceSatoshis: o.depot.value, transactionVersion: 2, otherInputs: [tx.inputs[0]], inputIndex: 1,
    outputs: tx.outputs, inputSequence: 0xfffffffe, subscript: o.depotLock, lockTime: tx.lockTime,
    scope: o.depotScope,
  })
  tx.inputs[1].unlockingScript = buildDepotUnlock({
    prefixOutputs: ser(0), spenderOutputs: [], newValue: u64le(kept), preimage: dPre,
  })

  /* ⚠ BOTH HALVES ARE RUN THROUGH THE INTERPRETER BEFORE THIS RETURNS. A refuel the covenants would
     refuse never reaches the network, so a page cannot spend a fee discovering what the reference
     already knew — and with two covenants there are two ways to be wrong, reported separately. */
  const val = (i: number, txid: string, vout: number, sats: number, lock: LockingScript): boolean => {
    try {
      return new Spend({
        sourceTXID: txid, sourceOutputIndex: vout, sourceSatoshis: sats, lockingScript: lock,
        transactionVersion: 2, otherInputs: tx.inputs.filter((_, k) => k !== i), outputs: tx.outputs,
        inputIndex: i, unlockingScript: tx.inputs[i].unlockingScript, inputSequence: 0xfffffffe,
        lockTime: tx.lockTime,
      }).validate() === true
    } catch { return false }
  }
  return {
    tx, carOut, kept,
    carOk: val(0, o.prevTx.id('hex'), o.vout, o.value, carLock),
    depotOk: val(1, o.depot.sourceTransaction.id('hex'), o.depot.outputIndex, o.depot.value, o.depotLock),
  }
}

/** The nLockTime a step must carry: the covenant's own clock, never the wall clock. */
export const lockTimeFor = (st: ShellState): number => Math.max(st.green, st.last + st.gap)

const u64le = (n: number): number[] => {
  const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) }
  return b
}
