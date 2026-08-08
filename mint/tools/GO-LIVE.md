# BRC-226 · Go-Live Runbook — releasing the white rabbit 🐇

Broadcasting the **canonical** LiveCounter genesis. The counter is immortal + ownerless; the deployer key
is your **real, kept author key** (it collects the 1-sat crumbs and is repaid at tick 1 — do not throw it away).

> **Mint locally first.** Build + sign offline, inspect, then broadcast on your own signal. The canonical
> counter is *our* genesis txid — publish it, and a copycat genesis is just a different, irrelevant chain.

## 0 · Fund the author key
Send a little BSV (a few thousand sats is plenty) to the address of the key you'll deploy with.
That key stays yours forever — it's the author identity that accrues the crumbs.

## 1 · Self-test the tool (no key, no network)
```sh
cd mint
node -e "import('esbuild').then(e=>e.build({entryPoints:['tools/genesis.ts'],bundle:true,format:'esm',platform:'node',target:'esnext',outfile:'tools/genesis.mjs'}))"
node tools/genesis.mjs --selftest        # expect: SELFTEST OK
```

## 2 · Dry build with your key (nothing is sent)
```sh
 GENESIS_WIF=<your-wif> node tools/genesis.mjs      # note the leading space → keeps the WIF out of shell history
```
Reads a funding UTXO from your address, builds + signs the genesis, prints the **txid** + **raw hex**.
Inspect it. Output 0 is the immortal counter (1 sat); the mark is `Follow the white 🐇` at `n=0`.

## 3 · Broadcast — the rabbit sprints
```sh
 GENESIS_WIF=<your-wif> node tools/genesis.mjs --broadcast
```
Sends via WhatsOnChain + BananaBlocks. **Copy the printed txid** — that is the canonical counter.

## 4 · Point the board at it
In `tip.php`, set:
```php
$GENESIS_TXID = '<the-txid-from-step-3>';
```

## 5 · Deploy
Commit + push, then in cPanel → Git Version Control: **Update from Remote** → **Deploy HEAD Commit**.
This ships `tip.php`, `brc226.html`, and `.cpanel.yml`.

## 6 · Verify
- `https://grafverse.com/tip.php` → `{"genesis":"…","n":0,"tipTxid":"…","last21":[{"n":0,"mark":"Follow the white 🐇",…}]}`
- `https://grafverse.com/brc226.html` → the live board shows **n = 0** and the rabbit at **#0**.

## 7 · Announce
Post `https://grafverse.com/brc226.html`. The immortal, ownerless counter is live — and pay-to-sign (⑤b)
comes next so anyone can push it forward.

---
_Security: WIF via env only (never a flag, never committed). The deployer key is kept, not throwaway._
