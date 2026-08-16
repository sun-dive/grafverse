// © BSV Association — Open BSV License v6.
// ★★ THE RESERVE — satoshis that pay the miner, weigh nothing, and let a dry car COAST.
//
//   node --experimental-strip-types mint/test/shell-reserve.ts
//
// A car that runs out of fuel should still roll across the line, slowing on drag. It could not, and the
// reason is the one thing a simulator would never have shown:
//
//   ⚠⚠ COASTING IS NOT FREE ON A CHAIN. BURN0 is charged every tick whatever the throttle, because the
//   burn IS the mining fee and a tick IS a transaction. Time itself costs satoshis here.
//
// BURN0 cannot be lowered — it is the relay floor for a 3,957-byte move, not a game parameter. So the
// fix is a RESERVE: value that buys ticks and carries no weight. A reserve of R buys R/BURN0 ticks.
//
//   value > RESERVE   racing
//   value ≤ RESERVE   no propulsion — the car coasts, drag bleeding it off
//   value < BURN0     it cannot buy a tick. THAT is where a run truly ends.
import {
  refTick, RACER_REGS, SHELL_TANK_MAX, tankMaxFor, buildShellLock, SHELL_MAX_FEE, S, PHASE,
  SHELL_STATE_LAYOUT, shellStateLayout, reserveRegs,
  type ShellState, type RacerRegs,
} from '../src/shell.ts'
import { shellUnlockingOps, SHELL_SCOPE } from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { planRace } from '../src/publicDriver.ts'
import { serializeOutput } from '../src/covenant.ts'
import {
  Hash, PrivateKey, Transaction, Spend, UnlockingScript, TransactionSignature,
} from '@bsv/sdk'

const u64 = (n: number): number[] => { const b: number[] = []; let x = n
  for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b }

/**
 * Offer a successor to the COVENANT and report whether it accepts — the only judge that counts.
 * ⚠ A public car needs no signature, which is what lets this be a pure arithmetic question.
 */
async function offer(state: ShellState, next: ShellState, throttle: number, at: number,
                     fuel: number, regs: RacerRegs, out: number): Promise<boolean> {
  const prev = buildShellLock({ state, maxFee: SHELL_MAX_FEE, public: true, regs })
  const src = new Transaction(); src.addOutput({ lockingScript: prev, satoshis: fuel })
  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: buildShellLock({ state: next, maxFee: SHELL_MAX_FEE, public: true, regs }),
                 satoshis: out })
  tx.lockTime = at
  const preimage = TransactionSignature.format({
    sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: fuel, transactionVersion: 2,
    otherInputs: [], inputIndex: 0, outputs: tx.outputs, inputSequence: 0xfffffffe,
    subscript: prev, lockTime: at, scope: SHELL_SCOPE,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: tx.outputs.slice(1).flatMap(o => serializeOutput(o.satoshis ?? 0, o.lockingScript.toBinary())),
    newValue: u64(out), preimage, sig: [], pubKey: [], throttle,
    load: { driver: next.driver, pool: next.pool, eng: next.eng, tyr: next.tyr,
            finish: next.finish, slip: next.slip, green: next.green, gap: next.gap },
  }))
  try {
    return new Spend({
      sourceTXID: src.id('hex'), sourceOutputIndex: 0, sourceSatoshis: fuel, lockingScript: prev,
      transactionVersion: 2, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: 0xfffffffe, lockTime: at,
    }).validate() === true
  } catch { return false }
}

let pass = 0, fail = 0
const check = (n: string, got: boolean, want = true): void => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const OWNER = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
const FRESH = freshPublicShell(OWNER)
/* ⚠ `reserveRegs`, NEVER a raw spread — it re-derives BURN0. `{ ...RACER_REGS, RESERVE: n }` compiles,
   races in the reference, passes every physics test, and mints a car no node will relay. */
const R21: RacerRegs = reserveRegs(21_000)
const m = (x: number): string => (x / S).toFixed(0)
const mph = (v: number): string => ((v / S) * 22.3694).toFixed(0)

console.log('\nTHE RESERVE — sats for the miner that weigh nothing\n')

// ── 1. ⚠ OFF IS INVISIBLE, which is what makes it safe to add to a live design ────────────────────
{
  check('★★ RESERVE is OFF by default — the mainnet setting', RACER_REGS.RESERVE === 0)
  check('  …and the ceiling is then exactly SHELL_TANK_MAX', tankMaxFor(RACER_REGS) === SHELL_TANK_MAX)
  const a = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
  const b = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true, regs: RACER_REGS })
  check('  …and a car built with it is byte-identical to the default', a.toHex() === b.toHex())

  const racing: ShellState = { ...FRESH, phase: PHASE.RACING, eng: 14, tyr: 10, last: 1_700_000_123,
    n: 12, s: Math.round(86 * S), v: Math.round(3 * S), green: 1_700_000_000, gap: 1,
    finish: Math.round(402 * S), slip: 1000 }
  const x = refTick(racing, { throttle: 8, lockTime: 1_700_000_200, fuel: 30_000 }, RACER_REGS)
  const y = refTick(racing, { throttle: 8, lockTime: 1_700_000_200, fuel: 30_000 },
    { ...RACER_REGS, RESERVE: 0 })
  check('  …and the tick computes the identical number', x.state.v === y.state.v && x.burn === y.burn)
}

// ── 2. ★★ THE CEILING RISES WITH THE RESERVE — it is never carved out of the tank ─────────────────
console.log()
{
  check('★★ the ceiling is SHELL_TANK_MAX + RESERVE', tankMaxFor(R21) === SHELL_TANK_MAX + 21_000)
  console.log(`        ${SHELL_TANK_MAX.toLocaleString()} + 21,000 = ${tankMaxFor(R21).toLocaleString()}`)
  console.log('        ⇒ propellant headroom is INVARIANT: ~34,000 wanted against 50,000 available')
  /* ⚠ THE POINT OF THE HEADROOM. `SHELL_TANK_MAX` was chosen ABOVE its own derivation so a driver can
     over-fill and FEEL it. Carving the reserve out was measured to delete that for EVERY build — the
     cap became the optimum and the heavy-tank mistake became unmakeable. */
  check('  …so a brim-full car is still heavier than the best fill', tankMaxFor(R21) > 34_000 + 21_000)
}

// ── 3. ★★ AND THE SCRIPT DOES IT TOO — the only claim that matters ────────────────────────────────
console.log()
{
  const lock = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true, regs: R21 })
  const plain = buildShellLock({ state: FRESH, maxFee: SHELL_MAX_FEE, public: true })
  check('★ a RESERVE lock builds — the opcodes exist now', lock.toBinary().length > 0)
  console.log(`        ${plain.toBinary().length} B → ${lock.toBinary().length} B  ` +
    `· the reserve costs ${lock.toBinary().length - plain.toBinary().length} bytes`)

  /* ⚠⚠ THE AGREEMENT, THROUGH THE REAL INTERPRETER. A reference that coasts and a script that does not
     is the worst outcome available — the page would predict a car the chain refuses to produce, and
     only on the move a driver most needs. So the successor the reference computes is offered to the
     COVENANT, and the covenant must accept exactly that one and refuse its neighbours. */
  const racing: ShellState = { ...FRESH, phase: PHASE.RACING, eng: 14, tyr: 10, last: 1_700_000_123,
    n: 12, s: Math.round(300 * S), v: Math.round(4 * S), green: 1_700_000_000, gap: 1,
    finish: Math.round(402 * S), slip: 1000 }
  const AT = 1_700_000_200

  for (const [fuel, label] of [[20_000, 'COASTING (below the reserve)'], [40_000, 'under power']] as const) {
    const want = refTick(racing, { throttle: 16, lockTime: AT, fuel }, R21)
    const ok = await offer(racing, want.state, 16, AT, fuel, R21, fuel - want.burn)
    check(`★★ the covenant accepts the reference's successor — ${label}`, ok)
    // …and refuses a car that kept its speed instead of coasting
    const cheat = { ...want.state, v: racing.v }
    const bad = await offer(racing, cheat, 16, AT, fuel, R21, fuel - want.burn)
    check(`  …and REFUSES a different one`, bad, false)
  }
}

// ── 3a. ★★ AND IT MUST NOT CALL ITSELF v2 — the published contract ───────────────────────────────
// A rebuilder reading `v2` and applying the v2 equations to a reserve car computes the WRONG RACE.
// That is exactly what forced v1 → v2 when quadratic drag arrived, and it is not optional.
console.log()
{
  const v2 = shellStateLayout(RACER_REGS), v3 = shellStateLayout(R21)
  check('★★ with the reserve OFF the layout is the published v2 string, byte for byte',
    v2 === SHELL_STATE_LAYOUT)
  check('★★ …and a reserve car publishes v3 instead', v3.startsWith('BITCOIN RACER v3'))
  check('  …saying the mass uses the PROPELLANT', v3.includes('p=max(0,val-R)') && v3.includes('+p*WF'))
  check('  …and that the throttle is gated', v3.includes('t=0 if p=0'))
  check('  …and the v2 equations it no longer obeys are GONE', !v3.includes('+fuel*WF'))
  /* ⚠ 220 was Bitcoin Core's old OP_RETURN RELAY POLICY, never a BSV limit — this project puts whole
     WebP images on chain. The real boundary is 255: the largest push OP_PUSHDATA1 carries with a
     single length byte. v2 still fits the old number; v3 has room to say what it does. */
  const b2 = Buffer.byteLength(v2, 'utf8'), b3 = Buffer.byteLength(v3, 'utf8')
  check('  v2 still fits the old 220 budget', b2 <= 220)
  check('★ v3 fits ONE OP_PUSHDATA1 push', b3 <= 255)
  console.log(`        v2 ${b2} B  ·  v3 ${b3} B  of 255`)
}

// ── 4. ★★ BELOW THE RESERVE THERE IS NO POWER, AND THE CAR COASTS ─────────────────────────────────
console.log()
{
  const racing: ShellState = { ...FRESH, phase: PHASE.RACING, eng: 14, tyr: 10, last: 1_700_000_123,
    n: 12, s: Math.round(300 * S), v: Math.round(4 * S), green: 1_700_000_000, gap: 1,
    finish: Math.round(402 * S), slip: 1000 }
  // a car holding only its reserve: the throttle is ignored entirely
  const shut = refTick(racing, { throttle: 0, lockTime: 1_700_000_200, fuel: 20_000 }, R21)
  const wide = refTick(racing, { throttle: 16, lockTime: 1_700_000_200, fuel: 20_000 }, R21)
  check('★★ with no propellant, the throttle does NOTHING', shut.state.v === wide.state.v)
  check('  …and the tick costs exactly BURN0', wide.burn === R21.BURN0)
  check('★★ …but the car still MOVES — it is coasting, not stopped', wide.state.s > racing.s)
  check('  …and it is SLOWING, because drag never stops', wide.state.v < racing.v)
  console.log(`        ${m(racing.s)} m at ${mph(racing.v)} mph → ${m(wide.state.s)} m at ${mph(wide.state.v)} mph` +
    `, for ${wide.burn} sat`)
  console.log(`        ⇒ 21,000 of reserve buys ${Math.floor(21_000 / R21.BURN0)} coasting ticks`)

  // and with propellant, the throttle works again
  const powered = refTick(racing, { throttle: 16, lockTime: 1_700_000_200, fuel: 40_000 }, R21)
  check('  …and above the reserve the throttle works again', powered.burn > R21.BURN0)
}

// ── 5. ★★★ THE WHOLE POINT: A DRY RUN THAT ROLLS ON ───────────────────────────────────────────────
console.log()
/** Race to the line and report where it ended and how much of it was coasting. */
function race(value: number, regs: RacerRegs) {
  const p = planRace(FRESH, value, { eng: 14, tyr: 10, finishM: 402, green: 1_700_000_000 }, regs)
  if (p.steps.length < 4) return null
  let st = p.steps[p.steps.length - 1].next
  let coasted = 0
  for (const s of p.steps) if (s.burn === regs.BURN0 && s.next.phase === PHASE.RACING) coasted++
  return { st, home: st.phase === PHASE.DONE, coasted, outcome: p.outcome }
}
for (const value of [20_000, 26_000, 34_000]) {
  const off = race(value, RACER_REGS)!
  const on = race(value + 21_000, R21)!
  console.log(`        ${String(value).padStart(6)} propellant · ` +
    `no reserve: ${off.home ? 'HOME' : m(off.st.s) + ' m'}` +
    `   ·   +21,000 reserve: ${on.home ? `★ HOME ${(on.st.n * 0.1).toFixed(1)} s` : m(on.st.s) + ' m'}` +
    ` (${on.coasted} coasting)`)
}
{
  const off = race(26_000, RACER_REGS)!, on = race(26_000 + 21_000, R21)!
  check('★★★ a run that died short now COASTS HOME', !off.home && on.home)

  /* ⚠ AND IT IS GENEROUS — measured, not assumed. 21,000 rescues a car that had only 20,000 of
     propellant, coasting 25 of its ticks. It is not a free pass though: 4.9 s against 3.9 s for a
     proper fill, on 41,000 total against 55,000. **Cheaper and slower** — a real trade rather than a
     dominant line. The rescue does run out; find where. */
  let boundary = 0
  for (let prop = 6_000; prop <= 26_000; prop += 1_000) {
    const r = race(prop + 21_000, R21)
    if (r?.home) { boundary = prop; break }
  }
  check('★ the rescue has a limit — below it a car still dies short', boundary > 6_000)
  const lost = race(boundary - 1_000 + 21_000, R21)!
  check('  …and it dies coasting, still rolling when the money runs out', lost.coasted > 0 && !lost.home)
  console.log(`        least propellant that still gets home on a 21,000 reserve: ` +
    `${boundary.toLocaleString()}   ·   ${(boundary - 1_000).toLocaleString()} reaches only ` +
    `${m(lost.st.s)} m of 402`)
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('RESERVE: FAIL'); process.exit(1) }
console.log('RESERVE OK — a dry car rolls on, and OFF is invisible.')
