// © BSV Association — Open BSV License v6.
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
import { buildBatteryLock, genesisState, refState } from '../src/battery.ts'

const GENESIS = 'd9a55ddb6c52bc51425f3c9e1416033179899e76abd634deda4510eed3790146'
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

// ── walk the chain forward from genesis, collecting the confirmed hops ──────────
const hops: Array<{ txid: string; tx: Transaction }> = []
let txid = GENESIS
for (let n = 0; n < 8; n++) {
  const hex = await (await fetch(`${WOC}/tx/${txid}/hex`)).text()
  hops.push({ txid, tx: Transaction.fromHex(hex.trim()) })
  const info = await (await fetch(`${WOC}/tx/hash/${txid}`)).json()
  const script = info.vout[0].scriptPubKey.hex as string
  const sh = Buffer.from(
    await import('node:crypto').then(c => c.createHash('sha256').update(Buffer.from(script, 'hex')).digest()),
  ).reverse().toString('hex')
  const hist = await (await fetch(`${WOC}/script/${sh}/history`)).json().catch(() => [])
  let next: string | null = null
  for (const h of Array.isArray(hist) ? hist : []) {
    if (h.tx_hash === txid) continue
    const c = await (await fetch(`${WOC}/tx/hash/${h.tx_hash}`)).json()
    if ((c.vin ?? []).some((i: any) => i.txid === txid && i.vout === 0)) { next = h.tx_hash; break }
  }
  if (!next) break
  txid = next
  await new Promise(r => setTimeout(r, 350))
}
console.log(`  walked ${hops.length} hops from genesis\n`)
check('the walk starts at the canonical genesis', hops[0].txid === GENESIS)

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

// entries are newest-first for verifyProofChain; genesis must be the OLDEST
const genesisEntry = entries.find(e => e.txId === GENESIS)!
let chain = createProofChain(GENESIS, genesisEntry)
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
let ref = genesisState()
let stateOk = true
for (let i = 0; i < hops.length; i++) {
  const want = buildBatteryLock({ state: ref }).toBinary()
  if (!arrEq(hops[i].tx.outputs[0].lockingScript.toBinary(), want)) { stateOk = false; console.log(`   ↳ hop ${i} script differs`) }
  ref = refState(ref)
}
check('every hop carries the state the covenant computes', stateOk)

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('BATTERY SPV: FAIL'); process.exit(1) }
console.log('BATTERY SPV OK — proved in a block, linked to genesis, and computing what it claims.')
