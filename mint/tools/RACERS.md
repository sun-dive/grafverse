# Bitcoin Racers — the settled regulations, and how to run one 🏁

Physics executed **in Bitcoin Script**. Every move is a real spend the network validates against the
covenant, so a result is not reported by a tool — it is *settled* by miners. The tool only proposes.

> ⚠ **A covenant cannot be amended.** Every number below is minted permanently into a car that has no
> key to change it. They are DERIVED and MEASURED, never chosen — and where one was chosen, it says so.

---

## The regulations

Tuned on `racers.html`, which runs the exact code the covenant is validated against (`mint/src/shell.ts`
through `vendor/grafmint.js`). A bench that reimplements the physics is a bench that quietly disagrees
with the chain.

```
M0    0.85     chassis mass          DRAG   0.02    drag per tick, LINEAR
WE    0.05     mass per engine       DRAG2  0.005   ★ drag per tick, QUADRATIC (v²)
WT    0.03     mass per tyre         SPIN_KEEP 0.43 what survives a wheelspin
WF    0.00011  mass per satoshi      LOOSE_V 0.35   spin above this ⇒ off the track
FE    0.32     force per engine      BLOW_T  14     spin at this throttle ⇒ grenaded
G0    0.36     grip per tyre         BLOW_V  330mph ★ too fast for the machinery
GV    0.30     grip per unit speed   THROTTLE_MAX 16 · ENG_MAX 24 · TYR_MAX 10
```

### What they produce

```
  fastest quarter mile     3.9 s at 330 mph   (eng 15 / tyr 10 on 34,000)
  builds that can race it  211 of 240
  longest raceable track   590 m
```

★ **Real Top Fuel numbers on both axes.** Drag alone cannot deliver them — at the `DRAG2` that yields
3.9 s the cars trap 397 mph, and at the `DRAG2` that yields 330 mph they take 4.7 s. Only a speed
ceiling decouples elapsed time from top speed.

⚠ It does **not** flatten the field. Quick builds trap 423–435 mph with the ceiling switched off
entirely, because they all reach terminal velocity — real Top Fuel cars cluster for the same reason.
Trap spread comes from the slow builds, and is untouched.

---

## The derived constants — do not hand-edit any of these

| | | |
|---|---|---|
| `SHELL_WORST_MOVE_BYTES` | **3909** | measured by SERIALIZING a real spend, every variant |
| `BURN0` | **392** | `ceil(worst × 100.1 / 1000)` — the burn IS the mining fee |
| `SHELL_MAX_FEE` | **1296** | the most a move may take from the tank |
| `SHELL_TANK_MAX` | **50,000** | the propellant tank · the RESERVE rides on top of it |
| `PUBLIC_CAR_REGS` | reserve 21,000 | ★ the car actually being raced · `BURN0` 397 · lock 1744 B |
| `DEPOT_MAX_TANK` | **71,000** | 50,000 + the reserve · FOUR taps · **the depot's rule, not the car's** |
| `DEPOT_MAX_FEE` | **844** | measured on a refuel OF THE CAR IT FUELS — 8,414 B |
| lock, owned / public | 1674 / 1720 B | the public car carries the reset, and nothing that pays anybody |

★★ **THE PUBLIC CAR IS A BATTERY** (sun-dive, 16 Aug). A battery has one branch — advance the state,
pay the miner — and no output that can pay a person, which is why it needs no key and has nothing worth
stealing. The public car is the same thing: *the only output it can produce is a car running down a
track spending satoshis.* Two exceptions were found and closed in one session — the tank ceiling moved
to the depot, and the run-ending value relaxation, which handed an unsigned stranger the whole tank.
The owner's burn is the last one left, and it stays only while the code is being proved.

⚠⚠ **THE FEE BOUND CAME DOWN ON 16 AUG, AND THAT MATTERS AS MUCH AS IT GOING UP.** The public car lost
its tank ceiling (12 B, moved to the depot) and its pit rule (27 B, deleted), so every move shrank. A
bound left sitting 27 bytes high means every race quietly OVERPAYS its miner on every tick, forever —
`shell-fee` fails on drift in that direction too, deliberately, and that is what caught it. The cost is
that a default car is no longer byte-identical to the ones on mainnet, because `MAX_FEE` is baked into
the lock. Cars already minted are unaffected: a car is self-contained and races under the constants it
was born with.

⚠⚠ **`BURN0` IS PERMANENT AND THERE IS NO KEY TO AMEND IT.** Below the 100 sat/KB floor, ticking is
rejected by every node FOREVER. It has been under the floor twice during development and both times
every test was green — see *What has gone wrong* below. `shell-fee` re-derives it; when it says
`RAISE SHELL_WORST_MOVE_BYTES TO n`, do exactly that and re-run everything.

★ `SHELL_TANK_MAX` is the one number here that was **chosen above its derivation**. The biggest engine
needs 37,000 for a quarter mile, so the rule gives 40,000 (four taps). 50,000 was taken deliberately:
*the room to over-fill is what makes fuel-as-mass a decision.* A driver may carry more than they need
and pay for it in acceleration.

⚠ And the error is fatal in only one direction — it is a cliff, not a slope:

```
cap 30,000    0 of 240 builds can finish a quarter mile   ← unraceable, forever
cap 50,000  211 of 240
```

---

## Running a race

```sh
cd mint
node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/racer.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/racer.mjs'}))"

node tools/racer.mjs --selftest                 # no key, no network — the whole race locally
 RACER_WIF=<wif> node tools/racer.mjs           # dry build: reads your UTXO, sends nothing
 RACER_WIF=<wif> node tools/racer.mjs --broadcast
```

⚠ **WIF via env only**, never a flag and never a file. The leading space keeps it out of shell history.
In fish: `read -s -P 'WIF: ' w; set -x RACER_WIF $w`

Knobs: `RACER_TANK` (40,000) · `RACER_POT` (30,000) · `RACER_ENG` (14) · `RACER_TYR` (10) ·
`RACER_FINISH` (402) · `RACER_SLIP` (1000)

### Resuming a stalled race

A stall leaves fuel sitting in a car mid-track. Burning it recovers the satoshis and throws away the
run; resuming recovers both. It works because the build is deterministic — RFC 6979 signing and a LOW_S
grind that walks nLockTime in a fixed order rebuild BYTE-IDENTICAL transactions.

```sh
 RACER_WIF=<wif> RACER_RESUME=<genesis txid> RACER_GREEN=<unix seconds> node tools/racer.mjs --broadcast
```

⚠ `RACER_GREEN` **must** be the value printed by the original run. Defaulted, it produces a different
track, a different state, and a chain that forks off the one already on chain.

---

## ⚠ Three things mainnet needs that a simulator does not

1. **Green goes in the PAST (~3 h).** nLockTime finality is judged against MEDIAN TIME PAST, which lags
   about an hour. A race flagged at `now` sits non-final and unmineable. Costs nothing: the lockTime
   rule is SEQUENCING, and the physics run at 0.1 s a tick regardless.
2. **The purse must not be `OP_TRUE`.** The finishing rule checks only that the pot's OUTPOINT is input
   1, never what locks it. A bare anyone-can-spend output is swept by bots in minutes.
3. **Every move must pay for its own bytes.** `out = fuel` is a ZERO-FEE transaction: perfectly valid to
   the interpreter and unrelayable by any node. `Spend` validates the script, not the economics.

⚠ **API throttling, not the protocol, is what actually stops a race.** An 880 m run got 84 chained
unconfirmed spends deep and then met `429` from WhatsOnChain. The network never objected — a miner took
a 14-transaction chain and mined the lot in one block.

---

## The tests, and what each one is for

```sh
for t in shell-ref shell-frame shell-physics shell-load shell-fee shell-burn shell-blow \
         public-ref public-gate public-reset \
         depot-frame depot-value depot-arrival depot-car depot-burn depot-fee depot-tank \
         depot-topup depot-topup-tx depot-refuel depot-dry depot-drain depot-car-integration; do
  node --experimental-strip-types test/$t.ts
done
```

| | |
|---|---|
| `shell-ref` `shell-physics` | the covenant computes what the reference computes |
| `shell-fee` | **⚠ measures BOTH variants** and re-derives `BURN0`. The one that fails first |
| `shell-blow` | the rev limit is enforced by the SCRIPT, not only the reference |
| `public-reset` | resets from all 7 phases; a reset carrying ANY field is refused |
| `depot-tank` | the ceiling binds on the way in — **and it is the PUMP's rule now, not the car's** |
| `depot-car` | a car is a SHAPE, in any phase, at `s = 0` — **and owned by this depot's owner**. Two cars of one owner are byte-identical: a car is its GENESIS, not its script |
| `depot-dry` | ★ a short run coasts on its reserve or stops. **The pump does not come to a moving car** |
| `depot-*` | the depot FUELS cars — it does not make them — and pays nobody |
| `depot-refuel` | **★★ the one the depot exists for**: two covenants, two inputs, one transaction |
| `depot-drain` | **⚠ the threat model, measured**: anyone can EMPTY the tank; nobody can TAKE it — it taps AND drives, because tapping alone once concluded that falsely |
| `public-gate` | the signature gate both ways, **and that no branch of a public car pays a person** |
| `depot-fee` | **⚠ measures a REFUEL OF THE CAR IT FUELS.** The car's script rides three times over inside one, so the CAR's size sets the DEPOT's fee |
| `test/racers-page.mjs` | runs the SHIPPED simulator page in a fresh `vm` with NO node globals |
| `test/depot-page.mjs` | **★ the page that spends REAL MONEY** — it boots, it found its covenants, and `DEPOT_TXID` · `CAR_SEED` · `REGS` agree with them |

---

## ★ What has gone wrong, so it does not go wrong again

Every one of these was **green at the time**.

- **A fee that would have been unmineable — twice.** 11 sat/KB against a 100 floor, then 98.3, then
  97.2. ⇒ Measure by SERIALIZING a real spend. Hand-counts undercount the output script-length varint.
- **⚠ The fee test measuring the wrong car.** `bytesOf()` only ever built OWNED locks, so when the reset
  made the PUBLIC lock the bigger of the two, a public tick sat at 97.2 sat/KB with every test green.
  ⇒ A bound must cover the worst move ANY legal car can produce, not the variant you happened to measure.
- **A page dead on arrival.** One unguarded `process.env` in the lock builder; the suite ran the shipped
  page in node, where `process` exists. ⇒ Test where the code RUNS, not where it is convenient.
- **A rule that never fired.** The first `shell-blow` passed having proved nothing — full throttle spins
  an eng 18 car off the line, so the run ended by GRIP at tick 0 and the speed rule was never reached.
  ⇒ A rule no test has provoked is a rule no test has examined.
- **A slider that clamped in silence.** `BURN0`'s bench slider maxed at 300 while `BURN0` was 375, and
  the reader reads every slider on every drag — so every tuning session ran 20% cheap.
- **Depths counted by hand.** Three bugs in one sitting. ⇒ Derive them from the assembler's own model;
  `SHELL_DEBUG=1` prints the stack the rebuild inherits.
- **⚠⚠ THE WORST ONE: THE SPEC WAS DECLARED IMPOSSIBLE TO FIT WHAT HAD BEEN BUILT.** A refuel needs both
  covenants in one transaction, and both rebuilt themselves at OUTPUT 0 — so neither could move and the
  transaction could not exist. Instead of fixing it, the depot was **redescribed as a car MINTER**,
  which it never was, and spec §4 was written off as describing a transaction that cannot exist.
  Sixteen depot tests then went green against a machine that could create cars and not fuel them, and
  `depot-refuel.ts` was left failing as the evidence that the SPEC was wrong.
  ⇒ The fix was ~150 bytes: the depot carries a **prefix** so the car keeps out0, and recognises a car
  by its **shape** (head, twelve pinned push opcodes, tail) instead of one hash of a car at rest.
  ⇒ **When the build cannot do what the spec says, that is a bug in the build.** A failing test is a
  result; rewriting the requirement around it is how a suite comes to describe the wrong machine.
  ★ **18 Aug — AND NOW THE DEPOT DOES MINT CARS, which is not this failure repeating.** A one-race car
  is born, races once and dies, so there is no refuelling and "fuel a car" and "mint a car" became the
  same act. The rule above was about a car that PERSISTS; the lifecycle changed, so the constraint it
  produced is retired. ⇒ The difference worth keeping: back then the SPEC was rewritten to fit a build
  that could not do what it said. Here the design premise changed and the spec followed. One is a
  bug being hidden; the other is a decision being made.
- **⚠ A "no signature anywhere" check that was a SUBSTRING SEARCH.** `/3044|3045/.test(toHex(script))`
  is not a signature test — it looks for four hex characters in a blob that is mostly PREIMAGE, i.e.
  hashes and txids. Those bytes are effectively random, so the pattern turns up by chance: **measured
  at ~1.6% of runs.** It failed once in sixty, which is exactly often enough to be dismissed as a fluke
  and to send somebody hunting a signature bug that was never there.
  ⇒ Read the CHUNK boundaries the parser already gives you (`0x30 <len> …`, 68–73 bytes), never the hex.
  ⇒ And **provoke the detector in the same test** — sign something real and require it to say so, or
  "no signature found" is indistinguishable from "cannot find signatures".
- **⚠ Constants hard-coded against other constants.** Raising `DEPOT_DRAW` 10,000 → 20,000 broke four
  things that were not about DRAW: `taps === 4` in a fill test, the tool's self-test tank (which went
  NEGATIVE), the genesis default `--fuel 11500` (below its own minimum), and `CAP/DRAW` printing
  "2.5 taps" on the page. Earlier the same trap: `thief(500)` in `depot-arrival`, tuned to a MAX_FEE
  that later moved. ⇒ **Derive it, or the test is about the constant instead of the rule.**
- **And its fee constant was measured on the wrong transaction.** `DEPOT_MAX_FEE` 516 was derived from a
  DRAW (5,452 B). The real spend is a REFUEL (8,344 B), where the car is an input too and its 1,744-byte
  script is paid for again inside its own preimage — 61.8 sat/KB, never relayable. Now 837.
  ⇒ Measure the spend the covenant EXISTS for, not the one it happens to be making.

★ And the shape they share: **a passing check is a hypothesis wearing a costume.** In a language where a
refusal looks identical whether it came from the rule under test or from something else entirely, treat
anything that stays green after a change with suspicion rather than relief.
