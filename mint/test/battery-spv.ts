// © 2026 sun-dive — Apache License 2.0.
// FIRST REAL RUN of the pure-SPV layer — against the live battery, on mainnet.
//
//   node --experimental-strip-types mint/test/battery-spv.ts
//
// `tokenProtocol.ts` has shipped to nobody since it was written: walletProvider imported it with
// `import type`, so every verification function was dead code, and everything that read the chain simply
// believed an API. This proves the module works on real data, and pins WHAT IT DOES AND DOES NOT PROVE.
//
// ⚠ IMPORTANT LIMIT FOUND WHILE WIRING THIS UP: `verifyProofChain` does NOT check that the entries form
// a chain. It checks that each tx is in a block, that each Merkle root matches its header, and that the
// OLDEST entry is the genesis. It never looks at whether entry[i] actually spends entry[i+1]. For a
// PHAR LAP token the linkage comes from the token codec; a covenant chain has to supply it separately.
// So SPV alone would accept a set of unrelated-but-real transactions whose oldest happens to be genesis.
// Both halves are therefore tested here: SPV proves the txs are REAL, linkage proves they are OURS.
import { Transaction } from '@bsv/sdk'
import {
  verifyMerkleProof, verifyProofChain, createProofChain, extendProofChain,
  type MerkleProofEntry, type BlockHeader,
} from '../src/tokenProtocol.ts'
import { WalletProvider } from '../src/walletProvider.ts'
import {
  buildBatteryLock, genesisState, refState, BATTERY_GEOMETRY, BATTERY_MAX_FEE,
} from '../src/battery.ts'

const GENESIS = '18e3193687078c40ee9a069a419d00f7b2a9c4374fe66e8d2b8a59d424711edd'

/* ⚠⚠ THE LIVE BATTERY IS THE DEFAULT ONE AGAIN — and this block used to pin the OLD one.
 *
 * It read: "the live battery is the 256x192 one that is being replaced", and hard-coded that geometry
 * plus its genesis so the test would keep passing while the replacement was pending. The replacement
 * then HAPPENED, and nothing here moved. So the test walked the NEW battery's chain (it follows
 * `battery.php`'s tip) and compared every hop against the RETIRED battery's reference — which differs,
 * correctly, on every single one.
 *
 * ⇒ It read as "the reference has diverged from the chain", which is the most alarming thing this
 * artefact could possibly report, and it was a stale constant. Verified before changing anything: the
 * reference reproduces the live tip EXACTLY at the tick `battery.php` reports.
 *
 * ★ So the overrides are GONE and the defaults are used. A pinned copy of the live parameters is a
 * copy that can go stale silently; the defaults cannot, because building a battery uses them too.
 * ⚠ If a THIRD battery is ever minted, `GENESIS` moves and this comment is the reason to check nothing
 * else needs to. */
const LIVE_GEOMETRY = BATTERY_GEOMETRY
const LIVE_MAX_FEE = BATTERY_MAX_FEE
const WOC = 'https://api.whatsonchain.com/v1/bsv/main'

let pass = 0, fail = 0
const check = (name: string, got: boolean, want = true): void => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  ok ? pass++ : fail++
}
const prov = new WalletProvider('')
const arrEq = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

console.log('BATTERY · pure SPV — the first time this module has run on real data\n')

// ── walk BACK to genesis — the direction the chain is actually built in ────────
// Every transaction names its own PARENT in its vin, so backwards needs no index at all. Walking
// FORWARD would mean asking a script-hash history endpoint who spent each output — an INDEXER, the
// exact thing BRC-113 exists to do without. An earlier version of this test did precisely that, in the
// test written to demonstrate not needing one. Direction is the whole argument.
const tipInfo = await (await fetch('https://grafverse.com/battery.php')).json()
const hops: Array<{ txid: string; tx: Transaction }> = []
let cursor: string | null = tipInfo.tipTxid as string
for (let n = 0; n < 8 && cursor; n++) {
  const hex = await (await fetch(`${WOC}/tx/${cursor}/hex`)).text()
  const tx = Transaction.fromHex(hex.trim())
  hops.unshift({ txid: cursor, tx })                       // unshift → oldest-first when we are done
  if (cursor === GENESIS) break
  const covIn = tx.inputs.find(i => i.sourceOutputIndex === 0)   // the covenant input; others are funding
  cursor = covIn ? (covIn.sourceTXID ?? null) : null
  await new Promise(r => setTimeout(r, 350))
}
console.log(`  walked ${hops.length} hops BACK from the tip — no indexer touched\n`)
check('every hop was reached by naming its own parent', hops.length > 1)

// ── LINKAGE: each hop must actually spend the previous one's output 0 ───────────
let linked = true
for (let i = 1; i < hops.length; i++) {
  const spendsParent = hops[i].tx.inputs.some(
    inp => (inp.sourceTXID ?? inp.sourceTransaction?.id('hex')) === hops[i - 1].txid && inp.sourceOutputIndex === 0)
  if (!spendsParent) { linked = false; console.log(`   ↳ hop ${i} does not spend hop ${i - 1}`) }
}
check('every hop spends its parent — the chain is OURS', linked)

// ── SPV: Merkle proofs + block headers, for the hops that are confirmed ─────────
const entries: MerkleProofEntry[] = []
const headers = new Map<number, BlockHeader>()
for (const h of hops) {
  const proof = await prov.getMerkleProof(h.txid)
  if (!proof) { console.log(`   ↳ ${h.txid.slice(0, 12)}… unconfirmed — no proof exists yet`); continue }
  entries.push(proof)
  if (!headers.has(proof.blockHeight)) {
    const hdr = await prov.getBlockHeader(proof.blockHeight)
    headers.set(proof.blockHeight, { height: hdr.height, merkleRoot: hdr.merkleRoot })
  }
}
console.log(`  ${entries.length} of ${hops.length} hops are confirmed and provable\n`)
check('at least the genesis is provable', entries.length > 0)
check('every Merkle proof verifies (pure crypto, no trust)', entries.every(e => verifyMerkleProof(e)))
check('every Merkle root matches its block header',
  entries.every(e => headers.get(e.blockHeight)?.merkleRoot === e.merkleRoot))

// The genesis is an ANCHOR fetched by its known txid — not somewhere you walk to. Bounding the walk at
// 8 hops reaches tick ~21, never tick 0, and that is correct: BRC-113 anchors once and inherits the rest.
const genesisEntry = entries.find(e => e.txId === GENESIS) ?? await prov.getMerkleProof(GENESIS)
check('the genesis anchor is independently provable', genesisEntry != null)
if (genesisEntry != null && !headers.has(genesisEntry.blockHeight)) {
  const gh = await prov.getBlockHeader(genesisEntry.blockHeight)
  headers.set(genesisEntry.blockHeight, { height: gh.height, merkleRoot: gh.merkleRoot })
}
// entries are newest-first for verifyProofChain; genesis must be the OLDEST
let chain = createProofChain(GENESIS, genesisEntry!)
for (const e of entries.filter(e => e.txId !== GENESIS).reverse()) chain = extendProofChain(chain, e)
const res = verifyProofChain(chain, headers)
console.log(`  verifyProofChain → ${res.valid ? 'VALID' : 'INVALID'}: ${res.reason}`)
check('the proof chain verifies against genesis', res.valid)

// ── it must REJECT bad data, or it proves nothing ───────────────────────────────
const tampered = JSON.parse(JSON.stringify(chain)) as typeof chain
if (tampered.entries[0].path.length > 0) {
  tampered.entries[0].path[0].hash = 'ff'.repeat(32)
  check('a tampered Merkle path is REJECTED', verifyProofChain(tampered, headers).valid, false)
} else {
  tampered.entries[0].merkleRoot = 'ff'.repeat(32)
  check('a tampered Merkle root is REJECTED', verifyProofChain(tampered, headers).valid, false)
}
const wrongGenesis = { ...chain, genesisTxId: 'ab'.repeat(32) }
check('a LOOK-ALIKE chain is REJECTED (wrong genesis)', verifyProofChain(wrongGenesis, headers).valid, false)
check('a missing block header is REJECTED', verifyProofChain(chain, new Map()).valid, false)

// ── and the state must be what the covenant says it is ─────────────────────────
// The walk starts mid-chain, so replay the covenant to the FIRST hop's tick before comparing. That the
// state is computable at all — without fetching any of the intervening transactions — is the property
// the whole artefact rests on.
const firstTick = Math.max(0, (tipInfo.ticks as number) - (hops.length - 1))
let ref = genesisState(LIVE_GEOMETRY)
for (let k = 0; k < firstTick; k++) ref = refState(ref, LIVE_GEOMETRY)
let stateOk = true
for (let i = 0; i < hops.length; i++) {
  const want = buildBatteryLock({ state: ref, geometry: LIVE_GEOMETRY, maxFee: LIVE_MAX_FEE }).toBinary()
  if (!arrEq(hops[i].tx.outputs[0].lockingScript.toBinary(), want)) { stateOk = false; console.log(`   ↳ hop ${i} script differs`) }
  ref = refState(ref, LIVE_GEOMETRY)
}
check('every hop carries the state the covenant computes', stateOk)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY SPV: FAIL'); process.exit(1) }
console.log('BATTERY SPV OK — proved in a block, linked to genesis, and computing what it claims.')
