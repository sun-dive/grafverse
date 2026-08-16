// © BSV Association — Open BSV License v6.
// THE FUEL DEPOT — a tank that FUELS cars. It does not make them.
//
//   bundle:    node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/depot.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/depot.mjs'}))"
//   self-test: node tools/depot.mjs --selftest                 (no key, no network)
//   the tank:  DEPOT_WIF=<wif> node tools/depot.mjs --genesis --fuel 42000 --broadcast
//   a car:     DEPOT_WIF=<wif> node tools/depot.mjs --car --broadcast
//   fuel it:   node tools/depot.mjs --refuel --depot <txid> --car <txid>:<vout> --broadcast
//   status:    DEPOT_WIF=<wif> node tools/depot.mjs --status --depot <txid>
//
// ⚠ WIF VIA ENV ONLY — never a flag, never a file. In fish:  read -s -P 'WIF: ' w; set -x DEPOT_WIF $w
//
// ── ⚠⚠ THE DEPOT DOES NOT MINT CARS, AND NEVER WAS SUPPOSED TO ────────────────────────────────────
// This tool used to have a `--draw` that made a car out of the tank, and a self-test that signed off
// with "the depot mints a real car". That was never the design. **The depot and the car are two
// different covenants**: the depot's job is FUEL, and a car comes into existence the way any output
// does — by being paid for. `--car` is an ORDINARY PAYMENT from the owner's key to the public car
// script. No covenant is being satisfied there, because none is running yet.
//
// ⇒ Minting got built into the depot only because a REFUEL did not work: both covenants rebuilt
// themselves at output 0, so a transaction spending both could not satisfy either. Rather than fix it,
// the depot was redescribed as a car factory. The fix was a PREFIX — see `src/depot.ts`.
//
// ⚠ AND THE COVENANT CANNOT ENFORCE THIS. A depot sees OUTPUTS, never inputs, so it cannot tell a car
// it filled from a car it created. "The depot does not mint" is a fact about this tool and the page,
// not a rule in Script. Stated plainly rather than implied, because the difference is invisible on
// chain.
//
// ── ★ WHAT THIS IS ACTUALLY DEMONSTRATING ─────────────────────────────────────────────────────────
// Two covenants that cannot read each other, agreeing inside one transaction. The depot rebuilds
// itself and insists that what leaves the tank arrives in a car whose SHAPE it was born knowing. The
// car, independently, refuses to hold more than its own ceiling. Neither trusts the other, and neither
// had to — it is all dressed up as a drag race.
//
// ── ⚠ THE KEY IS PERMANENT ────────────────────────────────────────────────────────────────────────
// The depot bakes in `carScript`, which is the PUBLIC CAR'S LOCK FOR ONE OWNER. Change the key and it
// is a different car script, a different shape, and a depot that can never fuel a car again. The same
// key is also the only one that can ever retire a depot or burn a car.
//
// ── ⚠ AND THE TANK HAS NO RESCUE HATCH ────────────────────────────────────────────────────────────
// The owner may burn a depot only BELOW `DEPOT_BURN_BELOW` (1,234 = BURN0 + MAX_FEE) — a husk, never a
// funded tank. ⚠ It moves whenever MAX_FEE does; never hard-code it. So:
//
//   retiring it for a better one   ✓  deploy the successor, let this one drain through racing, clear the husk
//   a bug that strands the fuel    ✗  the burn refuses for the same reason it refuses a funded tank
//
// ⇒ Fund it small until the path is proven. That is not caution, it is the only mitigation there is.
import {
  PrivateKey, Transaction, P2PKH, Spend, TransactionSignature, SatoshisPerKilobyte, Hash, Utils,
  LockingScript, UnlockingScript,
} from '@bsv/sdk'
import { importWif } from '../src/wallet.ts'
import {
  buildDepotLock, buildDepotUnlock, DEPOT_SCOPE, DEPOT_DRAW, DEPOT_MAX_FEE, DEPOT_MAX_TANK,
  DEPOT_BURN_BELOW,
} from '../src/depot.ts'
import {
  buildShellLock, shellUnlockingOps, shellMaxFee, PUBLIC_CAR_REGS,
  SHELL_SCOPE, SHELL_MAX_FEE, SHELL_FEE_PER_KB, SHELL_TANK_MAX,
} from '../src/shell.ts'
import { freshPublicShell } from '../src/publicShell.ts'
import { serializeOutput } from '../src/covenant.ts'

const WOC = 'https://api.whatsonchain.com/v1/bsv/main'
const BB = 'https://bananablocks.com/api/v1/bsv/main'
const getJson = async (p: string): Promise<any> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.json()
}
const getText = async (p: string): Promise<string> => {
  const r = await fetch(WOC + p); if (!r.ok) throw new Error(`WoC ${p} → ${r.status}`); return r.text()
}
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const has = (n: string): boolean => process.argv.includes(n)
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined
}
const u64 = (n: number): number[] => {
  const b: number[] = []; let x = n; for (let i = 0; i < 8; i++) { b.push(x % 256); x = Math.floor(x / 256) } return b
}
const sat = (n: number): string => n.toLocaleString()

/**
 * ⚠⚠ IS ANY PUSH IN THIS SCRIPT A DER SIGNATURE? Chunk-wise, and NEVER a substring scan of the hex.
 *
 * This started life as `/3044|3045/.test(toHex(script))`, which is not a signature test at all — it is
 * a search for four hex characters in a blob that is mostly PREIMAGE, i.e. hashes and txids. Those
 * bytes are effectively random, so the pattern turns up by chance: **measured at ~1.6% of runs across
 * two inputs**, which is exactly often enough to fail once, be dismissed as a fluke, and send somebody
 * hunting a signature bug that was never there.
 *
 * ⇒ A DER push is `0x30 <len> …` with the sighash byte after it, 68–73 bytes long. Read the CHUNK
 * boundaries the script parser already gives us, and the preimage cannot impersonate one.
 */
function hasSignature(script: UnlockingScript): boolean {
  return script.chunks.some(c => {
    const d = c.data
    return !!d && d.length >= 68 && d.length <= 73 && d[0] === 0x30 && d[1] === d.length - 3
  })
}

/**
 * The two scripts, derived from one key. The car's script is what the depot is born knowing.
 *
 * ⚠⚠ `PUBLIC_CAR_REGS`, AND A GENESIS BUILT WITH ANY OTHER CAR IS A DEPOT THAT FUELS NOBODY. The depot
 * pins ONE car — head, twelve push opcodes, tail hash — so the regulations chosen here are permanent
 * and unamendable from the moment `--genesis` broadcasts. The car being raced carries the RESERVE; a
 * depot minted against the default car would recognise nothing anybody drives.
 * ⚠ And its FEE depends on this too: the car's script rides three times over inside a refuel, so
 * `DEPOT_MAX_FEE` is measured against this exact variant in `depot-fee`. Change one, re-measure both.
 */
function scripts(ownerHash: number[]) {
  const car = buildShellLock({ state: freshPublicShell(ownerHash), maxFee: shellMaxFee(PUBLIC_CAR_REGS),
                               public: true, regs: PUBLIC_CAR_REGS })
  const depot = buildDepotLock({ carScript: car.toBinary(), owner: ownerHash })
  return { car, depot }
}

/**
 * ★★ ONE TAP OF THE PUMP — the depot and an EXISTING car, spent together.
 *
 *   IN    car (V_car)          +  depot (tank)
 *   OUT   car (V_car + draw)   +  depot (tank − draw − MAX_FEE)
 *
 * ⚠ THE CAR IS OUTPUT 0. Its covenant rebuilds itself there and nowhere else, so the depot yields the
 * slot and names the car as its PREFIX. Getting this backwards is the bug that made a refuel look
 * impossible for two days.
 *
 * ⚠ NO SIGNATURE ANYWHERE. The depot asks for a key only to burn, and a public car never asks at all,
 * so this whole transaction is authorised by arithmetic. That is the point: a visitor with no wallet,
 * no key and no satoshi can fuel a car and drive it.
 *
 * ⚠ The car is RESET by this move — back to a fresh car, keeping its fuel. That is the only move the
 * pump makes now: it refuses any car whose `s` is not zero, so fuel goes in at the line or not at all.
 *
 * ★ THE DEPOT PAYS THE WHOLE FEE. Total in − total out = MAX_FEE exactly, so the driver's fuel is not
 * touched by the cost of pumping it. That is what MAX_FEE is for.
 */
function buildRefuel(o: {
  depotTx: Transaction; depotVout: number; tank: number
  carTx: Transaction; carVout: number; carHas: number
  draw: number; owner: number[]
  car: LockingScript; depot: LockingScript
}): { tx: Transaction; carOk: boolean; depotOk: boolean; kept: number; carOut: number; fee: number } {
  const kept = o.tank - o.draw - DEPOT_MAX_FEE
  const carOut = o.carHas + o.draw
  const fresh = freshPublicShell(o.owner)

  const tx = new Transaction(); tx.version = 2
  tx.addInput({ sourceTransaction: o.carTx, sourceOutputIndex: o.carVout, sequence: 0xfffffffe })
  tx.addInput({ sourceTransaction: o.depotTx, sourceOutputIndex: o.depotVout, sequence: 0xfffffffe })
  tx.addOutput({ lockingScript: o.car, satoshis: carOut })      // out0 — the car's own slot
  tx.addOutput({ lockingScript: o.depot, satoshis: kept })
  tx.lockTime = 0
  const ser = (i: number): number[] =>
    serializeOutput(tx.outputs[i].satoshis ?? 0, tx.outputs[i].lockingScript.toBinary())

  // ── the car's half: a reset, which keeps the fuel and lands on a fresh car
  const cPre = TransactionSignature.format({
    sourceTXID: o.carTx.id('hex'), sourceOutputIndex: o.carVout, sourceSatoshis: o.carHas,
    transactionVersion: 2, otherInputs: [tx.inputs[1]], inputIndex: 0, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: o.car, lockTime: 0, scope: SHELL_SCOPE,
  })
  tx.inputs[0].unlockingScript = new UnlockingScript(shellUnlockingOps({
    spenderOutputs: ser(1), newValue: u64(carOut), preimage: cPre,
    sig: [], pubKey: [], throttle: 0, retire: true,
    load: { driver: fresh.driver, pool: fresh.pool, eng: fresh.eng, tyr: fresh.tyr,
            finish: fresh.finish, slip: fresh.slip, green: fresh.green, gap: fresh.gap },
  }))

  // ── the depot's half: the car is its prefix
  const dPre = TransactionSignature.format({
    sourceTXID: o.depotTx.id('hex'), sourceOutputIndex: o.depotVout, sourceSatoshis: o.tank,
    transactionVersion: 2, otherInputs: [tx.inputs[0]], inputIndex: 1, outputs: tx.outputs,
    inputSequence: 0xfffffffe, subscript: o.depot, lockTime: 0, scope: DEPOT_SCOPE,
  })
  tx.inputs[1].unlockingScript = buildDepotUnlock({
    prefixOutputs: ser(0), spenderOutputs: [], newValue: u64(kept), preimage: dPre,
  })

  const val = (i: number, txid: string, vout: number, sats: number, lock: LockingScript): boolean => {
    try {
      return new Spend({
        sourceTXID: txid, sourceOutputIndex: vout, sourceSatoshis: sats, lockingScript: lock,
        transactionVersion: 2, otherInputs: tx.inputs.filter((_, k) => k !== i), outputs: tx.outputs,
        inputIndex: i, unlockingScript: tx.inputs[i].unlockingScript, inputSequence: 0xfffffffe,
        lockTime: 0,
      }).validate() === true
    } catch { return false }
  }
  return {
    tx, kept, carOut,
    carOk: val(0, o.carTx.id('hex'), o.carVout, o.carHas, o.car),
    depotOk: val(1, o.depotTx.id('hex'), o.depotVout, o.tank, o.depot),
    fee: (o.carHas + o.tank) - (carOut + kept),
  }
}

async function broadcast(raw: string): Promise<void> {
  const w = await fetch(`${WOC}/tx/raw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: raw }),
  })
  const t = (await w.text()).trim()
  console.log('   WoC          :', w.status, t)
  if (!w.ok) throw new Error(`broadcast rejected: ${t}`)
  try {
    const b = await fetch(`${BB}/tx/broadcast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: raw }),
    })
    console.log('   BananaBlocks :', b.status, (await b.text()).trim())
  } catch { console.log('   BananaBlocks : (skipped)') }
}

// ── SELF-TEST — the whole thing with a throwaway key and no network ───────────────────────────────
async function selftest(): Promise<never> {
  const key = PrivateKey.fromRandom()
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)
  let pass = 0, fail = 0
  const check = (n: string, got: boolean, want = true): void => {
    const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
  }

  console.log('THE FUEL DEPOT — self-test\n')
  console.log(`        depot ${depot.toBinary().length} B · car ${car.toBinary().length} B`)
  console.log(`        hash  ${Utils.toHex(Hash.sha256(car.toBinary())).slice(0, 16)}…  ← what the depot was born knowing`)
  console.log(`        DRAW ${sat(DEPOT_DRAW)} · MAX_TANK ${sat(DEPOT_MAX_TANK)} · MAX_FEE ${DEPOT_MAX_FEE} · BURN_BELOW ${DEPOT_BURN_BELOW}\n`)

  /* ⚠ DERIVED FROM DRAW. A flat 20,000 here went NEGATIVE the moment DRAW was raised to 20,000 — the
     tank could not cover one tap plus its fee, and the tool died on "satoshis must be positive" rather
     than on anything to do with the covenant. Two taps' worth, so a self-test always has a remainder. */
  const TANK = 2 * (DEPOT_DRAW + DEPOT_MAX_FEE)
  const CAR_HAS = 2_200
  const dSrc = new Transaction(); dSrc.addOutput({ lockingScript: depot, satoshis: TANK })
  const cSrc = new Transaction(); cSrc.addOutput({ lockingScript: car, satoshis: CAR_HAS })
  const mk = (o: Partial<Parameters<typeof buildRefuel>[0]> = {}) => buildRefuel({
    depotTx: dSrc, depotVout: 0, tank: TANK, carTx: cSrc, carVout: 0, carHas: CAR_HAS,
    draw: DEPOT_DRAW, owner, car, depot, ...o,
  })

  const r = mk()
  check('★★ the depot FUELS an existing car — two covenants, one transaction', r.depotOk && r.carOk)
  const size = r.tx.toHex().length / 2
  const rate = r.fee * 1000 / size
  console.log(`        ${size} B · fee ${r.fee} sat = ${rate.toFixed(1)} sat/KB · ` +
    `car ${sat(CAR_HAS)} → ${sat(r.carOut)} · depot keeps ${sat(r.kept)}`)
  check('  …and the fee clears the relay floor', rate >= SHELL_FEE_PER_KB)
  check('  …with no signature in either input',
    !hasSignature(r.tx.inputs[0].unlockingScript!) && !hasSignature(r.tx.inputs[1].unlockingScript!))

  /* ⚠ AND PROVOKE THE DETECTOR, or the line above is worth nothing. A check that only ever reports
     "no signature found" is indistinguishable from one that cannot find a signature at all — this
     project has shipped exactly that mistake before (`shell-blow` passed having proved nothing).
     So: sign something real, and require the detector to say so. */
  {
    const signed = new Transaction(); signed.version = 2
    const src = new Transaction(); src.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 5_000 })
    signed.addInput({ sourceTransaction: src, sourceOutputIndex: 0, sequence: 0xffffffff })
    signed.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 4_500 })
    signed.inputs[0].unlockingScript = await new P2PKH().unlock(key).sign(signed, 0)
    check('★ …and the signature detector DOES fire on a real one', hasSignature(signed.inputs[0].unlockingScript!))
  }

  /* ⚠ PROVOKE THE GUARDS. Every check above passes just as well against a depot that agrees to
     anything, so each refusal it is supposed to make is demanded here. */
  check('★ a draw of MORE than one tap is REFUSED', mk({ draw: DEPOT_DRAW + 1 }).depotOk, false)
  check('★★ fuel into the WRONG car script is REFUSED — the shape is doing the work',
    mk({ car: buildShellLock({ state: freshPublicShell(owner), maxFee: SHELL_MAX_FEE }) }).depotOk, false)
  check('★ filling a car past MAX_TANK is REFUSED',
    mk({ carHas: DEPOT_MAX_TANK, tank: 200_000 }).depotOk, false)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  console.log(fail === 0
    ? 'SELFTEST OK — the depot fuels a real car. Safe to use with your real key.'
    : '⚠ SELFTEST FAILED')
  process.exit(fail === 0 ? 0 : 1)
}

// ── GENESIS — put the tank on chain ───────────────────────────────────────────────────────────────
async function genesis(): Promise<void> {
  const wif = process.env.DEPOT_WIF
  if (!wif) { console.error('Set DEPOT_WIF=<owner WIF>  (or run --selftest first — it needs no key).'); process.exit(1) }
  /* ⚠ DERIVED, not a round number. The old default of 11,500 was two taps at DRAW 10,000; at DRAW
     20,000 it is BELOW the tool's own minimum, so the default would have refused itself. Two taps and
     their fees — enough to prove the pump works, and small enough to be an acceptable griefing loss
     (see `depot-drain`: a tank is `balance / (DRAW + MAX_FEE)` taps from empty). */
  /* ⚠⚠ AND THE MINIMUM IS ONE SATOSHI, NOT ONE TAP. This refused anything below `DRAW + MAX_FEE`, on
     the reasoning that a tank too small to fund a tap is useless — which confuses "cannot pump yet"
     with "invalid". A depot minted EMPTY and filled by the top-up flow is a perfectly good
     deployment, and a better first test, because the top-up becomes the only way fuel ever gets in.
     Nothing is bricked by it: the value rule is a floor, so a top-up (which hands back MORE) is legal
     at any balance, and the funder's own input pays that transaction's fee rather than the tank.
     ⚠ One satoshi and not zero — a 0-value output is refused as dust before the script is evaluated
     at all, measured on both providers. */
  const fuel = Number(arg('--fuel') ?? 2 * (DEPOT_DRAW + DEPOT_MAX_FEE))
  if (!Number.isInteger(fuel) || fuel < 1) {
    console.error('--fuel must be an integer of at least 1 satoshi (0 is refused as dust)'); process.exit(1)
  }
  if (fuel < DEPOT_DRAW + DEPOT_MAX_FEE) {
    console.log(`\n⚠ ${sat(fuel)} sat is below one tap plus its fee (${sat(DEPOT_DRAW + DEPOT_MAX_FEE)}),`
      + ' so the pump cannot fuel a car until it is topped up.')
    /* ⚠ AND SAY THE OTHER HALF, because it is the one that surprises: the owner may clear away a husk,
       and a depot this small IS a husk by the covenant's own definition. */
    if (fuel < DEPOT_BURN_BELOW) {
      console.log(`  …and below ${sat(DEPOT_BURN_BELOW)} the owner may burn it, which is what that`
        + ' threshold is for — an empty depot is a husk, not a tank.\n')
    } else console.log('')
  }
  const key = importWif(wif), addr = key.toAddress()
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)

  console.log('owner address :', addr)
  console.log('car script    :', car.toBinary().length, 'B · hash',
    Utils.toHex(Hash.sha256(car.toBinary())).slice(0, 16) + '…')
  console.log('depot script  :', depot.toBinary().length, 'B')

  /* ⚠ GATHERS COINS, RATHER THAN DEMANDING ONE BIG ONE. The battery's tool takes the smallest single
     UTXO that covers the job, which is right for a covenant SPEND — one input is all a covenant can
     use. A genesis is an ordinary payment though, and insisting on one coin means a wallet holding
     plenty across several is told it has none. Largest first, so it takes as few as it can. */
  const utxos = await getJson(`/address/${addr}/unspent`)
  const all = (Array.isArray(utxos) ? utxos : []).sort((a: any, b: any) => b.value - a.value)
  const need = fuel + 500
  const picked: any[] = []
  let have = 0
  for (const u of all) { if (have >= need) break; picked.push(u); have += u.value }
  if (have < need) {
    console.error(`Only ${sat(have)} sat spendable at ${addr}, and the depot needs ${sat(need)}.`)
    console.error(`Send a little BSV there, or lower --fuel (minimum ${sat(DEPOT_DRAW + DEPOT_MAX_FEE)}).`)
    process.exit(1)
  }
  console.log('funding       :', `${picked.length} utxo(s), ${sat(have)} sat`)
  for (const u of picked) console.log('               ', `${u.tx_hash.slice(0, 16)}…:${u.tx_pos}  ${sat(u.value)}`)

  const tx = new Transaction(); tx.version = 2
  for (const u of picked) {
    const srcTx = Transaction.fromHex(await getText(`/tx/${u.tx_hash}/hex`))
    tx.addInput({ sourceTransaction: srcTx, sourceOutputIndex: u.tx_pos,
                  unlockingScriptTemplate: new P2PKH().unlock(key), sequence: 0xffffffff })
    await sleep(250)                                    // ⚠ pace it — WoC throttles a burst of these
  }
  tx.addOutput({ lockingScript: depot, satoshis: fuel })
  tx.addOutput({ lockingScript: new P2PKH().lock(addr), change: true })
  await tx.fee(new SatoshisPerKilobyte(SHELL_FEE_PER_KB))
  await tx.sign()

  console.log(`\n── THE DEPOT ──`)
  console.log('txid   :', tx.id('hex'))
  console.log('tank   :', sat(fuel), 'sat   (output 0)')
  console.log('change :', sat(tx.outputs[1].satoshis ?? 0), 'sat →', addr)
  console.log('taps   :', Math.floor((fuel - DEPOT_MAX_FEE) / DEPOT_DRAW), 'car(s) it can fuel before it needs topping up')
  if (has('--broadcast')) { await broadcast(tx.toHex()); console.log('        BROADCAST ✓') }
  else console.log('\n(dry build — nothing was sent. Re-run with --broadcast.)')
  console.log('\n⚠ KEEP THIS TXID. Everything else refers to it, and there is no index that will find it for you.')
}

/**
 * ── A CAR — an ORDINARY PAYMENT, and deliberately nothing more ────────────────────────────────────
 *
 * ⚠ THE DEPOT IS NOT INVOLVED. A car comes into existence the way any output does: somebody pays the
 * script. No covenant is running, nothing is being authorised, there is no seam to get wrong. The
 * depot's job starts afterwards, when the car needs FUEL.
 *
 * ★ It may be minted empty and left for the depot to fill, or funded here and fuelled later. Either
 * way the car and the tank are separate transactions, because they are separate covenants.
 */
async function mintCar(): Promise<void> {
  const wif = process.env.DEPOT_WIF
  if (!wif) { console.error('Set DEPOT_WIF=<owner WIF>.'); process.exit(1) }
  /* ⚠ THE CEILING IS THE PUMP'S, NOT THE CAR'S. A car carries no ceiling of its own any more — an
     owner may pay whatever they like into their own car — so this is a courtesy that keeps a
     hand-minted car inside what the depot would ever fill it to. It was `SHELL_TANK_MAX`, which is now
     the propellant tank ALONE and would have refused a car carrying its own reserve. */
  const fuel = Number(arg('--fuel') ?? 1)
  if (!Number.isInteger(fuel) || fuel < 1 || fuel > DEPOT_MAX_TANK) {
    console.error(`--fuel must be an integer between 1 and ${sat(DEPOT_MAX_TANK)}`); process.exit(1)
  }
  const key = importWif(wif), addr = key.toAddress()
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car } = scripts(owner)

  const utxos = await getJson(`/address/${addr}/unspent`)
  const all = (Array.isArray(utxos) ? utxos : []).sort((a: any, b: any) => b.value - a.value)
  const need = fuel + 500
  const picked: any[] = []
  let have = 0
  for (const u of all) { if (have >= need) break; picked.push(u); have += u.value }
  if (have < need) {
    console.error(`Only ${sat(have)} sat spendable at ${addr}; a car needs ${sat(need)}.`); process.exit(1)
  }

  const tx = new Transaction(); tx.version = 2
  for (const u of picked) {
    const srcTx = Transaction.fromHex(await getText(`/tx/${u.tx_hash}/hex`))
    tx.addInput({ sourceTransaction: srcTx, sourceOutputIndex: u.tx_pos,
                  unlockingScriptTemplate: new P2PKH().unlock(key), sequence: 0xffffffff })
    await sleep(250)
  }
  tx.addOutput({ lockingScript: car, satoshis: fuel })
  tx.addOutput({ lockingScript: new P2PKH().lock(addr), change: true })
  await tx.fee(new SatoshisPerKilobyte(SHELL_FEE_PER_KB))
  await tx.sign()

  console.log(`\n── A PUBLIC CAR ──`)
  console.log('txid   :', tx.id('hex'))
  console.log('car    :', sat(fuel), 'sat   (output 0 — EMPTY, anyone may drive it)')
  console.log('owner  :', addr, '— can burn it, and nothing else')
  if (has('--broadcast')) { await broadcast(tx.toHex()); console.log('        BROADCAST ✓') }
  else console.log('\n(dry build — nothing was sent. Re-run with --broadcast.)')
  console.log(`\n★ fuel it:  node tools/depot.mjs --refuel --depot <txid> --car ${tx.id('hex')}:0 --broadcast`)
}

// ── REFUEL — one tap of the pump, into a car that already exists ──────────────────────────────────
async function refuel(): Promise<void> {
  const depotTxid = arg('--depot')
  const carRef = arg('--car')
  if (!depotTxid || !carRef) {
    console.error('--refuel --depot <txid> [--vout n] --car <txid>:<vout>'); process.exit(1)
  }
  const vout = Number(arg('--vout') ?? 0)
  const [carTxid, carVoutRaw] = carRef.split(':')
  const carVout = Number(carVoutRaw ?? 0)

  /* ⚠ THE OWNER'S KEY IS NOT NEEDED TO PUMP, and that is the whole demonstration — but the scripts
     have to be rebuilt from the owner's HASH, so it is taken as a flag rather than a WIF. Anyone may
     refuel; only the owner may burn. */
  const ownerHex = arg('--owner') ?? (process.env.DEPOT_WIF
    ? Utils.toHex(Hash.hash160(importWif(process.env.DEPOT_WIF).toPublicKey().encode(true) as number[]))
    : undefined)
  if (!ownerHex) { console.error('--owner <hash160 hex>   (or set DEPOT_WIF to derive it)'); process.exit(1) }
  const owner = Utils.toArray(ownerHex, 'hex')
  const { car, depot } = scripts(owner)

  const dTx = Transaction.fromHex(await getText(`/tx/${depotTxid}/hex`))
  const tank = dTx.outputs[vout]?.satoshis ?? 0
  if (Utils.toHex(dTx.outputs[vout]?.lockingScript.toBinary() ?? []) !== Utils.toHex(depot.toBinary())) {
    console.error(`⚠ ${depotTxid}:${vout} is not this depot's script — wrong txid, wrong vout, or wrong owner.`)
    process.exit(1)
  }
  await sleep(250)
  const cTx = Transaction.fromHex(await getText(`/tx/${carTxid}/hex`))
  const carHas = cTx.outputs[carVout]?.satoshis ?? 0
  if (Utils.toHex(cTx.outputs[carVout]?.lockingScript.toBinary() ?? []) !== Utils.toHex(car.toBinary())) {
    console.error(`⚠ ${carTxid}:${carVout} is not a car AT REST for this owner.`)
    console.error('  (a car mid-race can still be fuelled, but that is a racing move — drive it from depot.html)')
    process.exit(1)
  }
  console.log('depot   :', `${depotTxid}:${vout}`, '·', sat(tank), 'sat')
  console.log('car     :', `${carTxid}:${carVout}`, '·', sat(carHas), 'sat')

  const draw = Math.min(DEPOT_DRAW, tank - DEPOT_MAX_FEE, DEPOT_MAX_TANK - carHas)
  if (draw < 1) {
    console.error(tank - DEPOT_MAX_FEE < 1
      ? `the tank holds ${sat(tank)} — not enough for one tap plus its fee.`
      : `the car already holds ${sat(carHas)}, at or above MAX_TANK ${sat(DEPOT_MAX_TANK)}.`)
    process.exit(1)
  }
  const r = buildRefuel({ depotTx: dTx, depotVout: vout, tank, carTx: cTx, carVout, carHas,
                          draw, owner, car, depot })
  if (!r.depotOk || !r.carOk) {
    console.error(`refused before it was ever sent — depot ${r.depotOk ? 'ok' : 'REFUSED'}, car ${r.carOk ? 'ok' : 'REFUSED'}.`)
    process.exit(1)
  }

  const size = r.tx.toHex().length / 2
  console.log(`\n── ONE TAP ──`)
  console.log('txid    :', r.tx.id('hex'))
  console.log('car     :', sat(r.carOut), 'sat   (output 0 — fuelled, at rest, anyone may drive it)')
  console.log('depot   :', sat(r.kept), 'sat   (output 1 — the tank, smaller)')
  console.log('fee     :', r.fee, `sat · ${size} B · ${(r.fee * 1000 / size).toFixed(1)} sat/KB`)
  console.log('signed  : NOTHING — no key was used to authorise this')
  if (has('--broadcast')) { await broadcast(r.tx.toHex()); console.log('        BROADCAST ✓') }
  else console.log('\n(dry build — nothing was sent. Re-run with --broadcast.)')
  console.log(`\n★ the car is ${r.tx.id('hex')}:0 — configure and race it.`)
}

// ── STATUS ────────────────────────────────────────────────────────────────────────────────────────
async function status(): Promise<void> {
  const wif = process.env.DEPOT_WIF
  if (!wif) { console.error('Set DEPOT_WIF=<owner WIF>.'); process.exit(1) }
  const txid = arg('--depot')
  if (!txid) { console.error('--depot <txid>'); process.exit(1) }
  const vout = Number(arg('--vout') ?? 0)
  const key = importWif(wif)
  const owner = Hash.hash160(key.toPublicKey().encode(true) as number[])
  const { car, depot } = scripts(owner)
  const tx = Transaction.fromHex(await getText(`/tx/${txid}/hex`))
  const out = tx.outputs[vout]
  const isDepot = out && Utils.toHex(out.lockingScript.toBinary()) === Utils.toHex(depot.toBinary())
  const tank = out?.satoshis ?? 0
  console.log('depot        :', `${txid}:${vout}`)
  console.log('is our depot :', isDepot ? 'yes' : '⚠ NO — wrong txid/vout, or a different owner key')
  console.log('tank         :', sat(tank), 'sat')
  console.log('taps left    :', Math.max(0, Math.floor((tank - DEPOT_MAX_FEE) / DEPOT_DRAW)))
  console.log('burnable     :', tank < DEPOT_BURN_BELOW
    ? `yes — a husk under ${DEPOT_BURN_BELOW}, the owner may clear it`
    : `no — holds ${sat(tank)}, and the burn refuses anything at or above ${DEPOT_BURN_BELOW}`)
  console.log('car script   :', Utils.toHex(Hash.sha256(car.toBinary())).slice(0, 16) + '…',
    `· a car may hold at most ${sat(SHELL_TANK_MAX)}`)
}

async function main(): Promise<void> {
  if (has('--selftest')) return selftest()
  if (has('--genesis')) return genesis()
  if (has('--car')) return mintCar()
  if (has('--refuel')) return refuel()
  if (has('--draw')) {
    /* ⚠ NAMED AND REFUSED, rather than quietly absent. `--draw` made a car out of the tank, which the
       depot was never for — see the header. Anyone with it in their shell history deserves to be told
       what replaced it rather than to read "unknown option". */
    console.error('--draw is gone. The depot does not make cars; it fuels them.')
    console.error('  a car   : --car --fuel <n>                       (an ordinary payment, owner key)')
    console.error('  fuel it : --refuel --depot <txid> --car <txid>:<vout>   (no key at all)')
    process.exit(1)
  }
  if (has('--status')) return status()
  console.log('usage: --selftest | --genesis [--fuel n] | --car [--fuel n]')
  console.log('       | --refuel --depot <txid> [--vout n] --car <txid>:<vout> | --status --depot <txid>')
  console.log('       add --broadcast to send. WIF via DEPOT_WIF only.')
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
