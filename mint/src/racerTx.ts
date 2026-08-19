// © BSV Association — Open BSV License v6.
/**
 * ★★★ THE RACE TRANSACTION, AND THE GATE EVERY CAR MUST PASS BEFORE IT IS MINTED.
 *
 * Mirrors `batteryTx.ts` and `depotTx.ts` in shape: the covenant lives in `racerCar.ts`, and this
 * builds the one transaction that covenant exists to authorise.
 *
 * ── ⚠⚠ WHY THE GATE IS NOT OPTIONAL ───────────────────────────────────────────────────────────────
 * A one-race car has **no key, no owner and no burn branch**. Its unlocking script is the preimage and
 * nothing else, so the only thing that can ever move its satoshis is a race the covenant accepts. That
 * is what makes an abandoned car harmless — anybody may race it, and racing it brings the fuel home.
 *
 * ⇒ And it is exactly what makes a car that cannot be spent **unrecoverable**. There is no sweeper with
 * a key, because there is no key. Mint a car the covenant refuses and its satoshis are gone for good.
 * `racerCar.ts` has named this function as the answer since the day it was written; this is it.
 *
 * ── ★ AND IT CAN RUN BEFORE THE MINT EXISTS, WHICH IS THE WHOLE POINT ─────────────────────────────
 * MEASURED, not assumed: the car reads **`hashOutputs`, its own `scriptCode`, and its own value** out of
 * the preimage, and nothing else. `hashPrevouts` does not appear in `racerCar.ts` once. So the outpoint
 * a car will one day be spent from does not affect whether it CAN be spent — a placeholder validates
 * identically to the real thing, and the gate can run while the mint is still a plan.
 *
 * ⚠ The same measurement is why `nLockTime` is free for a LOW_S grind: the car does not read it.
 * ⚠ It also means the checks here are about SPENDABILITY, not relay policy. A car can pass this gate
 * and still be refused by a broadcaster on LOW_S. Those are different questions with different fixes.
 */
import { Transaction, TransactionSignature, Spend, LockingScript, UnlockingScript } from '@bsv/sdk'
import { scriptCodeVarIntSize } from './basic.ts'
import {
  buildRacerCar, racerCarFee, racerCarUnlock, carBlockOps, feeConstant, CONTROL_FLOW,
  CAR_BYTES_MIN, CAR_BYTES_MAX, CAR_SCOPE, type CarParams,
} from './racerCar.ts'

/** A placeholder outpoint for a car that has not been minted yet. The covenant never reads it. */
const UNMINTED = '0'.repeat(64)

export interface RaceTxParams {
  /** The car's locking script. */
  car: number[]
  /** The script the last satoshis go to — the address that minted the depot. */
  payeeScript: number[]
  /** What the car holds. */
  sourceSatoshis: number
  /** The mining fee, which the covenant computes for itself and will not accept a different one. */
  fee: number
  /** The outpoint the car sits at. Omit before the mint exists — the covenant does not read it. */
  sourceTXID?: string
  sourceOutputIndex?: number
  /**
   * ★ FREE — the car reads no locktime, so this is the lever a LOW_S grind walks. Varying it changes
   * the preimage, and therefore the signature OP_PUSH_TX derives, without changing anything that matters.
   */
  lockTime?: number
}

/**
 * The race: one input whose unlocking script is the preimage, one output paying the payee.
 *
 * ★ The simplest transaction shape in this repo, and deliberately so — nothing about it varies at spend
 * time, which is why the car's fee can be EXACT rather than a bound.
 */
export function buildRaceTx(p: RaceTxParams): { tx: Transaction; spend: Spend } {
  const car = new LockingScript(LockingScript.fromBinary(p.car).chunks)
  const payee = new LockingScript(LockingScript.fromBinary(p.payeeScript).chunks)
  const sourceTXID = p.sourceTXID ?? UNMINTED
  const sourceOutputIndex = p.sourceOutputIndex ?? 0
  const lockTime = p.lockTime ?? 0
  const home = p.sourceSatoshis - p.fee

  const src = new Transaction()
  for (let i = 0; i < sourceOutputIndex; i++) src.addOutput({ lockingScript: payee, satoshis: 1 })
  src.addOutput({ lockingScript: car, satoshis: p.sourceSatoshis })

  const tx = new Transaction()
  tx.version = 2
  tx.addInput({ sourceTXID, sourceOutputIndex, sequence: 0xffffffff })
  tx.addOutput({ lockingScript: payee, satoshis: home })
  tx.lockTime = lockTime

  const preimage = TransactionSignature.format({
    sourceTXID, sourceOutputIndex, sourceSatoshis: p.sourceSatoshis, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xffffffff,
    subscript: car, lockTime, scope: CAR_SCOPE,
  })
  const unlockingScript = new UnlockingScript(racerCarUnlock(preimage))
  tx.inputs[0].unlockingScript = unlockingScript

  const spend = new Spend({
    sourceTXID, sourceOutputIndex, sourceSatoshis: p.sourceSatoshis, lockingScript: car,
    transactionVersion: 2, otherInputs: [], outputs: tx.outputs, unlockingScript,
    inputSequence: 0xffffffff, inputIndex: 0, lockTime,
  })
  return { tx, spend }
}

export interface RaceReport {
  /** ⚠ FALSE means DO NOT MINT. There is no key that can undo it afterwards. */
  raceable: boolean
  /** One line per reason, empty when raceable. Written to be read by a person, not parsed. */
  problems: string[]
  lockBytes: number
  txBytes: number
  /** What `racerCarFee` says the race costs — derived by serializing the spend. */
  fee: number
  /** What the CAR'S OWN SCRIPT will demand. These must be equal, and today they were not. */
  scriptFee: number
  /** What the mint must fund the car with. */
  funded: number
  /** What comes back to the payee. */
  home: number
  ticks: number
  seconds: number
}

/**
 * ★★★ CAN THIS CAR BE RACED? Build the real spend and ask the real interpreter.
 *
 * ⚠ Every check below is provoked by a negative control in `test/racer-validates.ts`. A gate nobody has
 * seen refuse is a gate nobody has examined — this repo has shipped a `shell-blow` that passed having
 * proved nothing, and a signature detector that could not detect signatures.
 *
 * @param returnSats what comes home to the payee. ⚠ NEVER 0 — a zero-value output is refused as dust
 *   before the script is evaluated at all, so the covenant's own `V − fee > 0` would never even run.
 *   ★ Whether this is 1 or a spendable amount is a live decision; the covenant does not care, so the
 *   only bound is what the depot is willing to hand a car (`RACER_DRAW`).
 */
export function raceValidates(p: Omit<CarParams, 'fee'>, returnSats = 1): RaceReport {
  const problems: string[] = []
  const { fee, bytes, lockBytes } = racerCarFee(p)
  const funded = fee + returnSats
  const ticks = p.run.ticks.length

  /* ── 1 · THE FEE THE SCRIPT DEMANDS MUST BE THE FEE WE FUND IT WITH ──────────────────────────────
     The car works its fee out from its own size at spend time. If `racerCarFee` disagrees by even one
     satoshi the car is funded wrong and can never be spent — MEASURED 19 Aug, when `feeConstant`
     assumed the payee's length varint was three bytes and a 25-byte address made it demand one more. */
  const scriptFee = Math.floor(
    (scriptCodeVarIntSize(lockBytes) + lockBytes + feeConstant(p.depotScript.length)) / 10)
  if (scriptFee !== fee) {
    problems.push(`the car will demand ${scriptFee} sat but racerCarFee funds it with ${fee} — ` +
      `off by ${scriptFee - fee}. A car funded wrong can never be spent, and there is no key to rescue it.`)
  }

  /* ── 2 · THE SIZE MUST BE INSIDE THE RANGE THE FEE ARITHMETIC IS VALID FOR ───────────────────────
     Outside it the varints change width and `feeConstant` is silently wrong rather than loudly. */
  if (lockBytes < CAR_BYTES_MIN || lockBytes > CAR_BYTES_MAX) {
    problems.push(`the car is ${lockBytes} B, outside the ${CAR_BYTES_MIN}–${CAR_BYTES_MAX} B range ` +
      `feeConstant's varint arithmetic holds for`)
  }

  /* ── 3 · A ZERO-VALUE OUTPUT NEVER REACHES THE SCRIPT ────────────────────────────────────────────*/
  if (returnSats < 1) {
    problems.push(`${returnSats} sat home: a zero-value output is refused as dust before the script ` +
      'is evaluated at all')
  }

  /* ── 4 · NO CONTROL FLOW — the property the DEPOT'S safety rests on ──────────────────────────────
     Tail-only recognition is sound only while a car has no branch a spliced OP_IF could be closed
     against. `racerCarOps` asserts this too; it is re-checked here because the gate must not be a
     thinner test than the builder. */
  const car = buildRacerCar({ ...p, fee })
  for (const code of CONTROL_FLOW) {
    const n = car.chunks.filter(c => c.op === code).length
    if (n !== 0) problems.push(`the car carries ${n} control-flow opcode(s) (${code}) — with one ` +
      'present a spliced OP_IF can be closed and the depot becomes a faucet')
  }

  /* ── 5 · IT MUST END WITH THE BLOCK A DEPOT PINS FOR THIS PAYEE ──────────────────────────────────
     Spendable but unmintable is a different failure from unspendable, and a cheaper one to find here
     than in a refused broadcast. */
  const block = new LockingScript(carBlockOps({ depotScript: p.depotScript })).toBinary()
  const tail = car.toBinary().slice(-block.length)
  if (!block.every((b, i) => tail[i] === b)) {
    problems.push('the car does not end with the block a depot would pin for this payee — no depot ' +
      'built for it will mint this car')
  }

  /* ── 6 · AND THEN ASK THE INTERPRETER, which is the only answer that counts ──────────────────────*/
  const { tx, spend } = buildRaceTx({
    car: car.toBinary(), payeeScript: p.depotScript, sourceSatoshis: funded, fee,
  })
  let accepted = false
  try { accepted = spend.validate() } catch (e) { accepted = false; problems.push(
    `the network REFUSES this race: ${(e as Error).message.split('\n')[0]}`) }
  if (!accepted && problems.length === 0) {
    problems.push('the network refuses this race, and none of the checks above says why — do not mint')
  }

  return {
    raceable: problems.length === 0 && accepted,
    problems, lockBytes, txBytes: tx.toBinary().length, fee, scriptFee,
    funded, home: returnSats, ticks, seconds: ticks / 10,
  }
}

/**
 * The same gate, as a refusal. ⚠ Use this in anything that broadcasts: a returned boolean can be
 * ignored by accident, and the cost of ignoring this one is permanent.
 */
export function assertRaceable(p: Omit<CarParams, 'fee'>, returnSats = 1): RaceReport {
  const r = raceValidates(p, returnSats)
  if (!r.raceable) {
    throw new Error('racerTx: REFUSING TO MINT — this car could not be raced, and a car nobody can ' +
      'race is a car nobody can rescue:\n  · ' + r.problems.join('\n  · '))
  }
  return r
}
