# The Battery 🔋 — operations

**The canonical battery is live.**

```
genesis   d9a55ddb6c52bc51425f3c9e1416033179899e76abd634deda4510eed3790146
born      2026-08-12 · first 20 ticks confirmed in block 961,975
grid      256×192 · fixed point 2^32 · 21 levels · MAX_FEE 312
state     published on-chain in the genesis OP_RETURN (183 bytes)
```

It has no owner and no off switch. Anyone may advance it with no key, no wallet and nothing at stake;
only topping it up costs money, and only a top-up is signed. It stops when the fuel runs out and resumes
the moment anyone adds more — on the exact iteration it stopped at, because `z` and `i` are state.

> It began as a rehearsal and turned out to be the real thing: built at the real parameters, its genesis
> output is **byte-identical** to one built today. The word "rehearsal" only ever existed in our notes.

## Everyday operation

```sh
cd mint
node tools/battery.mjs --status                       # where it is now
node tools/battery.mjs --tick 20 --broadcast          # advance it — NO KEY
```

Each tick waits for the node to acknowledge the previous one, so a tick can never race its own parent.

## Topping it up

```sh
 BATTERY_WIF=<wif> node tools/battery.mjs --topup 1000000 --mark "your line here"
 BATTERY_WIF=<wif> node tools/battery.mjs --topup 1000000 --mark "your line here" --broadcast
```

*(leading space keeps the WIF out of shell history; without `--broadcast` it only prints the signed hex)*

One transaction adds the fuel, advances the state, and carries the mark — atomic by construction. The
board is then a *view* over the chain: find the ticks where out0's value rose, read the mark, rank by
amount. Nothing to administer. Marks are displayed as **text, never auto-linked** — permanent
unmoderatable live links are an abuse vector.

A top-up costs ~200 sat in fees regardless of size, so contributing under a few thousand sat sends most
of it to miners.

## What fuel buys

Ticks are iterations, not pixels — the black interior is where the energy goes.

| | ticks | |
|---|---|---|
| 1,000,000 sat | 3,236 | 2% of frame 1 |
| 10,000,000 sat | 32,362 | 20% of frame 1 |
| 49,654,137 sat | 160,693 | **frame 1 complete** |
| 6,028,906,416 sat | 19,511,024 | all 21 levels (60.3 BSV) |

Depth is bought. The battery simply stops partway if the board raises less, having drawn whole frames up
to that point. Nothing is ever stranded.

## Proven on chain, 2026-08-12

1. **A covenant-only transaction relays and confirms.** One input, one output, **no signature**, fee paid
   out of the battery's own value. 3,086 bytes.
2. **`MAX_FEE 312` clears the real miner floor.** 309 sat = 100.13 sat/KB, mined within the hour. The
   official 100 sat/KB is sufficient — no inflation needed.
3. **The chain agrees with the interpreter exactly.** Tick 20's on-chain script is byte-identical to the
   reference renderer replayed 20 times, so `battery.html` is the reference renderer, not an approximation.
4. **★ Chronicle is real.** ARC refused 7 of the 20 with `461: Non-canonical signature: S value is
   unnecessarily high`. It was wrong — Chronicle withdrew that rule for transactions with a version field
   greater than 1, and these are version 2. Tick 1 is high-S, ARC refused it, a miner mined it anyway.
   Those seven transactions are permanent evidence, sitting at the battery's own origin.

   The builders therefore default to Chronicle rules. `{ lowS: true }` grinds for a canonical signature
   only if some endpoint insists — about 9 sat per 24 ticks.

## Rebuilding it from the chain alone

The state layout is published in the genesis `OP_RETURN`, so none of this depends on a website:

```
fields cr,ci,zr,zi,i,step,cx,cy,mx | widths 5,5,5,5,2,5,5,5,2
fixed-width sign-magnitude LE | 1.0=2^32 | multiply first, divide last
```

**Multiply first, divide last** is normative — `(zr·zi/S)·2` and `(2·zr·zi)/S` differ by one ulp, and the
chain's order is the only correct one. A renderer that gets it wrong draws a different picture.

The whole image is recoverable from the **tip alone**: the state carries the scan position and the frame,
so every completed pixel and every prior frame can be recomputed locally. The chain is not the
framebuffer — it is the ratchet, proving how far the computation has legitimately got and that every step
was paid for.

## If you ever genesis another one

`--genesis` builds a battery; it does not re-launch this one. A second genesis with identical parameters
is a different, irrelevant chain — the canonical identity is the genesis txid above. Point it at its own
state file (`BATTERY_STATE=…`) so it cannot clobber this one's record, and note that two batteries at the
same tick number have byte-identical locking scripts, so tip discovery must be lineage-aware.

---

_Security: WIF via env only — never a flag, never committed. Working state lives outside this repo,
which is public._
