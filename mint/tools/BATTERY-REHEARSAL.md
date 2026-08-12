# The Battery · Rehearsal Runbook 🔋

Proving that **a real node agrees with the interpreter** before the permanent genesis.

Everything about this covenant is immutable once broadcast and **there is no key that can amend it** —
so the rehearsal is not ceremony, it is the only chance to be wrong cheaply. It runs the *real* script at
the *real* parameters, with a small tank of fuel.

## ✅ SETTLED — rehearsal run 2026-08-12

Genesis `d9a55ddb6c52bc51…d3790146`, 10,000 sat, then **20 keyless ticks**. All findings below are
measured, not projected.

1. **A covenant-only transaction relays AND confirms.** One input, one output, **no signature**, fee paid
   out of the input's own value. All 20 accepted by WhatsOnChain; confirmed in **block 961,975**.
2. **`MAX_FEE 312` clears the real miner floor.** A tick is 3,086 bytes paying 309 sat = **100.13 sat/KB**,
   mined within about an hour. The official 100 sat/KB is sufficient — no inflation needed.
3. **Unconfirmed chaining works.** All 20 ticks chained through the mempool before any confirmed.
4. **The chain agrees with the interpreter exactly.** Tick 20's on-chain locking script is
   **byte-identical** to the reference renderer replayed 20 times.
5. **★ Chronicle is real and high-S is fine.** ARC refused 7 of the 20 with
   `461: Non-canonical signature: S value is unnecessarily high`. It was wrong — the Chronicle release
   withdrew that rule for transactions with a version field greater than 1, and these are version 2.
   Tick 1 is high-S, ARC refused it, and it was **mined regardless**. The builders therefore default to
   Chronicle rules; `{ lowS: true }` grinds for a canonical signature only if some endpoint insists.

## 0 · Fund a throwaway key

A few thousand sats. This key funds the genesis and takes the change; **it has no authority over the
battery afterwards**, so it does not need to be a key you keep.

## 1 · Bundle + self-test (no key, no network)

```sh
cd mint
node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/battery.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/battery.mjs'}))"
node tools/battery.mjs --selftest      # expect: SELFTEST OK
```

Also run the two gates behind it:

```sh
node --experimental-strip-types test/battery-parity.ts   # 15/15 — the port IS the verified covenant
node --experimental-strip-types test/battery-tx.ts       # 24/24 — genesis→tick→tick→top-up→tick
```

## 2 · Dry build (nothing is sent)

```sh
 BATTERY_WIF=<wif> node tools/battery.mjs --genesis --fuel 10000
```

*(note the leading space — it keeps the WIF out of shell history)*

10,000 sat ≈ **32 ticks**. Inspect the printed txid, sizes and raw hex.

## 3 · Broadcast the rehearsal genesis

```sh
 BATTERY_WIF=<wif> node tools/battery.mjs --genesis --fuel 10000 --broadcast
```

Records the genesis txid in `~/Documents/battery-rehearsal.json` — **outside the repo**, which is public.

## 4 · Tick it — with no key at all

```sh
node tools/battery.mjs --tick 20 --broadcast
```

No WIF. No wallet. Nothing at stake. Each tick waits for the node to acknowledge the previous one before
building the next, so a tick can never race its own parent.

**Watch for:** a rejection mentioning fee or `min relay fee`. That is finding #2 above, and it means
`MAX_FEE` must rise before the real genesis.

## 5 · Verify

```sh
node tools/battery.mjs --status
```

- Every tick should appear on `https://whatsonchain.com/tx/<txid>`
- Tick *n*'s output 0 script must equal the reference state after *n* ticks — the tool derives the state
  by replaying `refState` from genesis, so if a tick built successfully, the chain and the renderer agree.

## Then, and only then

The rehearsal battery keeps running until its fuel is gone — it has no off switch, which is the point.
Before the real genesis, decide the two permanent things one more time:

- [ ] **`MAX_FEE`** — 312, unless the rehearsal says otherwise
- [ ] **fuel** — the real one is funded forward by the board, so genesis fuel only needs to start it
- [ ] `battery.html` must be listed in `.cpanel.yml`, or the page will never deploy

---

_Security: WIF via env only — never a flag, never committed. The deployer key is disposable; the battery
outlives it either way._
