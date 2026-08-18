// © BSV Association — Licensed under the Open BSV License Version 6 (see LICENSE).
/**
 * ★★★ THE CAR MINT'S OWN OPTIMISER — and it does not touch the BASIC compiler.
 *
 * `mint/src/basic.ts` is LIVE at `BASIC_VERSION` and governed by THE HARD RULE at the top of that
 * file: the compiled script must say what the program says, and an optimisation goes to a separate,
 * narrowly scoped thing rather than being edited in. **This is that thing.** Everything the car mint
 * wants compilation to do differently belongs here, and `basic.ts` never learns this file exists.
 *
 * ── ★★ WHY IT IS A BASIC → BASIC TRANSFORM, WHICH IS THE WHOLE DESIGN ─────────────────────────────
 * The obvious optimiser rewrites the emitted opcodes. This one rewrites the PROGRAM and hands the
 * result to the same faithful compiler everything else uses. The difference matters:
 *
 *   opcode rewriter   the script no longer says what any program says   ⇒ the reader shows you soup
 *   ★ source rewriter the script says exactly what the OPTIMISED program says
 *
 * ⇒ So faithfulness survives end to end. `carPrograms()` hands back BOTH programs — the one a person
 * wrote and the one that was minted — and the chain matches the second one literally, line for line.
 * Nothing is hidden; there is simply a second, tighter program to read.
 *
 * ── ★ THE SCOPE, WRITTEN DOWN, AND IT IS NARROW ON PURPOSE ────────────────────────────────────────
 * **LOOP-INVARIANT HOISTING OF A SPECIALISED RACE BODY. Nothing else.**
 *
 * Unrolling copies the body once per tick, so anything that does not change between ticks is paid for
 * sixty times. `demand = eng * FE * 8 / TM` is the same arithmetic on every tick of a constant-throttle
 * run; `M0 + eng * WE + tyr * WT` is the part of `mass` the fuel does not touch. Computing them once is
 * worth N−1 copies and costs nothing in legibility — the expression is still there, still readable,
 * still saying why the number is what it is. It is simply written once instead of sixty times.
 *
 * ⚠ It is NOT a constant folder. `demand` stays an expression over `eng`, `FE` and the throttle, so a
 * reader can still see the engine and the throttle in the script. That was the whole reason the blanket
 * fold came out of the compiler on 18 August, and it is not coming back in through a side door.
 *
 * ── ★★★ AND IT PROVES ITSELF AGAINST THE FAITHFUL BUILD, EVERY TIME IT EMITS ──────────────────────
 * This is available here and almost nowhere else, because **everything about a car is known before it
 * is minted**. So both programs are compiled, both are RUN through the real interpreter, and the three
 * values that carry — `v`, `s`, `fuel` — must come out identical. They do not agree, it does not emit.
 * ⇒ An optimiser that cannot be checked is a rumour. This one refuses rather than shipping a car
 * nobody can verify.
 */
import { LockingScript, UnlockingScript, Spend, OP } from '@bsv/sdk'
import { compileBasic } from './basic.ts'
import { op, PN } from './covenantAsm.ts'
import { specialiseRun, type RunTrace } from './racerTick.ts'

/**
 * What this optimiser is allowed to lift out of the tick body, and what it becomes.
 *
 * ⚠ The patterns are the EXACT text `specialiseRun` emits. That is deliberate: if the physics is ever
 * rewritten, these stop matching and `carPrograms` THROWS rather than quietly optimising nothing. A
 * hoist that silently stops working is a 20% cost increase nobody notices.
 *
 * ★ `$T` stands for the tick's throttle, which is a literal in a specialised run. A run that changes
 * throttle gets one hoisted binding per distinct value — still N−1 copies saved on each.
 */
const HOISTS: ReadonlyArray<{ name: string; pattern: (t: string) => string; def: (t: string) => string }> = [
  /* the chassis: everything in `mass` that the burning fuel does not change */
  { name: 'chassis', pattern: () => 'M0 + eng * WE + tyr * WT', def: () => 'M0 + eng * WE + tyr * WT' },
  /* the tyres' share of grip — the speed-dependent half stays in the body */
  { name: 'grip0', pattern: () => 'tyr * G0', def: () => 'tyr * G0' },
  /* what the driver asked of the engine, and what that costs — constant for a given throttle */
  { name: 'demand$T', pattern: t => `eng * FE * ${t} / TM`, def: t => `eng * FE * ${t} / TM` },
  { name: 'burn$T', pattern: t => `BURN0 + eng * BURN_E * ${t} / TM`, def: t => `BURN0 + eng * BURN_E * ${t} / TM` },
]

/**
 * ★ A car starts from rest with the tank the driver filled. It lives HERE rather than in `racerCar.ts`
 * because this file is where car compilation is centred: the mint asks this module for a program, and
 * `basic.ts` — the general compiler — is never asked to know anything about racing.
 */
export const RACE_PREAMBLE = `
REM  ── the run starts from rest, with the tank the driver filled ──
fuel = TANK
v = 0
s = 0
`

export interface CarPrograms {
  /** The program as `specialiseRun` writes it — one full tick after another. */
  faithful: string
  /** The same race with its invariants computed once. This is what gets compiled and minted. */
  optimised: string
  /** The bindings that were lifted, in the order they are computed. */
  hoisted: Array<{ name: string; expr: string }>
}

/**
 * Rewrite a specialised race so that nothing invariant is computed twice.
 *
 * ⚠ THROWS if a pattern it expects to find is absent — see `HOISTS`. Optimising nothing successfully
 * is the failure mode this project has to be loudest about, because it looks exactly like working.
 */
export function carPrograms(
  run: RunTrace, opts: { preamble?: string; body?: string } = {},
): CarPrograms {
  const preamble = opts.preamble ?? RACE_PREAMBLE
  const body = opts.body ?? specialiseRun(run)
  const throttles = [...new Set(run.ticks.map(t => String(t.throttle)))]
  const hoisted: Array<{ name: string; expr: string }> = []
  let out = body

  for (const h of HOISTS) {
    const perThrottle = h.name.includes('$T') ? throttles : ['']
    for (const t of perThrottle) {
      const name = h.name.replace('$T', t)
      const pat = h.pattern(t)
      if (!out.includes(pat)) {
        throw new Error(`optimizeCarCompile: expected to hoist \`${pat}\` and it is not in the race. ` +
          'The physics has been rewritten and this optimiser has not — refusing to emit a car that ' +
          'is silently paying for the invariants it was built to lift.')
      }
      /* ⚠ Longest patterns first within a family: `BURN0 + eng * BURN_E * 8 / TM` contains no other
         pattern, but `eng * FE * 8 / TM` must not be substituted inside a longer match. The HOISTS
         order handles it — chassis and grip0 share no text with the throttle pair. */
      out = out.split(pat).join(name)
      hoisted.push({ name, expr: h.def(t) })
    }
  }

  /* ⚠ The hoists go FIRST, above the preamble, and that is safe by construction: every expression in
     `HOISTS` is built from the driver's configuration and the physics constants, and none of them
     reads `fuel`, `v` or `s`. A hoist that ever needed a carried value would not be invariant. */
  const lifted = [
    'REM  ── computed ONCE, because an unrolled race pays for everything it repeats ──',
    ...hoisted.map(h => `${h.name} = ${h.expr}`),
  ].join('\n')

  return {
    faithful: `${preamble}${body}`,
    optimised: `${lifted}\n${preamble}${out}`,
    hoisted,
  }
}

/**
 * A name the probe appends to read a value back. ⚠ No leading underscore — the parser takes letters,
 * and `__probe` was refused with "what is \"_\"?", which is the compiler being right.
 */
const PROBE = 'zzprobe'

/** Run a program and read back one named value, using the real interpreter. */
function valueOf(src: string, name: string, consts: Record<string, number>): bigint | undefined {
  let ops
  try { ops = compileBasic(`${src}\n${PROBE} = ${name}`, { stack: [], consts }).ops }
  catch { return undefined }
  const lock = new LockingScript([...ops, op(OP.OP_16), op(OP.OP_DROP), op(OP.OP_1)])
  const spend = new Spend({
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sourceSatoshis: 1,
    lockingScript: lock, transactionVersion: 2, otherInputs: [], outputs: [],
    unlockingScript: new UnlockingScript([]), inputSequence: 0xffffffff, inputIndex: 0, lockTime: 0,
  })
  try {
    if (!spend.validate()) return undefined
    /* `PROBE` is the last thing the program named, so it sits under the two opcodes above. */
    const st = (spend as unknown as { stack: number[][] }).stack
    return readNum(st[st.length - 2] ?? [])
  } catch { return undefined }
}

/** A script number, little-endian, sign-magnitude — the same reading `OP_BIN2NUM` performs. */
function readNum(d: number[]): bigint {
  if (!d.length) return 0n
  let n = 0n
  for (let i = d.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(i === d.length - 1 ? d[i] & 0x7f : d[i])
  return (d[d.length - 1] & 0x80) ? -n : n
}

/** ⚠ The three values that CARRY. Everything else in a tick is working. */
export const CARRIED = ['v', 's', 'fuel'] as const

export interface OptimisedCar {
  /** The ops to mint — the optimised program, compiled by the untouched faithful compiler. */
  ops: ReturnType<typeof compileBasic>['ops']
  /**
   * ⚠ THE COMPILER'S OWN STACK MODEL AFTERWARDS, and it is not decoration. A caller that emits these
   * ops has to know how deep the stack is to clean up, and a depth taken from anywhere but the model
   * that describes these exact ops is a bug waiting for someone to add an OP_PICK below it.
   */
  stack: string[]
  programs: CarPrograms
  /** Bytes each way, so the saving is a measurement rather than a claim. */
  faithfulBytes: number
  optimisedBytes: number
  /** What the two builds agreed on. */
  agreed: Array<{ name: string; value: bigint }>
}

/**
 * ★★★ COMPILE A CAR'S RACE, OPTIMISED — and prove it against the faithful build before returning it.
 *
 * ⚠ THROWS rather than emitting a car whose optimised race disagrees with the plain one, on any of
 * `v`, `s` or `fuel`. A wrong optimisation would produce a perfectly valid transaction recording a
 * race that did not happen, and there is no key to withdraw a minted car.
 */
/**
 * ★★★ PROVE TWO PROGRAMS ARE THE SAME RACE — by RUNNING both, not by reasoning about them.
 *
 * Exported so it can be pointed at a deliberately wrong pair. ⚠ A checker nobody has watched FAIL is
 * indistinguishable from a checker that always says yes, and this project has shipped one of those
 * before: a "no signature anywhere" test that was a substring search.
 *
 * @throws if either program will not run, or if they disagree on any carried value.
 */
export function proveAgrees(
  faithful: string, optimised: string, consts: Record<string, number>,
): Array<{ name: string; value: bigint }> {
  const agreed: Array<{ name: string; value: bigint }> = []
  for (const name of CARRIED) {
    const a = valueOf(faithful, name, consts)
    const b = valueOf(optimised, name, consts)
    if (a === undefined || b === undefined) {
      throw new Error(`optimizeCarCompile: could not read \`${name}\` back out of ` +
        `${a === undefined ? 'the faithful' : 'the optimised'} race — refusing to mint a car whose ` +
        'optimisation has not been checked')
    }
    if (a !== b) {
      throw new Error(`optimizeCarCompile: the optimised race disagrees with the faithful one on ` +
        `\`${name}\` — ${a} against ${b}. This is not a car; it is a record of a race that did not ` +
        'happen, and a minted car cannot be withdrawn.')
    }
    agreed.push({ name, value: a })
  }
  return agreed
}

/**
 * ★★★ COMPILE A CAR'S RACE, OPTIMISED — and prove it against the faithful build before returning it.
 *
 * ⚠ THROWS rather than emitting a car whose optimised race disagrees with the plain one, on any of
 * `v`, `s` or `fuel`. A wrong optimisation would produce a perfectly valid transaction recording a
 * race that did not happen, and there is no key to withdraw a minted car.
 */
export function optimizeCarCompile(
  run: RunTrace, consts: Record<string, number>, opts: { preamble?: string; body?: string } = {},
): OptimisedCar {
  const programs = carPrograms(run, opts)
  const faithful = compileBasic(programs.faithful, { stack: [], consts })
  const optimised = compileBasic(programs.optimised, { stack: [], consts })
  const agreed = proveAgrees(programs.faithful, programs.optimised, consts)

  return {
    ops: optimised.ops,
    stack: optimised.stack,
    programs,
    faithfulBytes: new LockingScript(faithful.ops).toBinary().length,
    optimisedBytes: new LockingScript(optimised.ops).toBinary().length,
    agreed,
  }
}
