// © BSV Association — Open BSV License v6.
/* AUDIT: find every place a parsed transaction is MUTATED, across every app.
 *
 *   node mint/tools/audit-serialization-cache.mjs
 *
 * THE TRAP: Transaction.fromHex/fromBinary fill rawBytesCache (and fromHex also hexCache), and
   toHex/toBinary/id return those caches. So MUTATING a parsed transaction and re-serializing hands back
   the PRE-mutation bytes — silently, with a valid-looking txid.
   Dangerous only when a parse is followed by a WRITE to that object. Find those. */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/* Sibling repos, resolved from THIS file rather than from the shell's working directory — the first
   version used bare relative names and silently scanned nothing when run from inside the repo, which
   is the worst possible failure for an audit: a clean report that looked like good news. */
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] ?? resolve(HERE, '../../..')
const roots = ['nft-gift', 'grafverse', 'PolePosition', 'PharLap', 'BigRed', 'popstoria', 'block-media-format']
  .map(r => resolve(BASE, r)).filter(existsSync)
if (roots.length === 0) { console.error(`no repos found under ${BASE}`); process.exit(1) }
console.log(`scanning ${roots.length} repos under ${BASE}\n`)
const PARSE = /\b(?:Transaction|GM\.Transaction)\.(?:fromHex|fromBinary|fromBEEF)\s*\(/
// writes to a transaction object's mutable innards
const WRITE = /\.(?:inputs|outputs)\s*\[[^\]]*\]\s*\.\s*\w+\s*=|\.lockTime\s*=|\.version\s*=|\.inputs\s*=|\.outputs\s*=/
const GUARD = /invalidateSerializationCaches/

let flagged = 0, scanned = 0
for (const root of roots) {
  let files = []
  try {
    files = execSync(
      `grep -rl "Transaction\\.fromHex\\|Transaction\\.fromBinary\\|fromBEEF" ${root} ` +
      `--include="*.ts" --include="*.js" --include="*.mjs" --include="*.html" 2>/dev/null ` +
      `| grep -v node_modules | grep -v "\\.min\\." | grep -v "/dist/"`, { encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean)
  } catch { continue }

  for (const f of files) {
    scanned++
    const lines = readFileSync(f, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!PARSE.test(lines[i])) continue
      // does anything write to a transaction within the next 40 lines, before a guard?
      const window = lines.slice(i, i + 40)
      const w = window.findIndex(l => WRITE.test(l))
      if (w < 0) continue
      const guarded = window.some(l => GUARD.test(l))   // anywhere in the window, not just near the write
      flagged++
      console.log(`${guarded ? '  ok ' : '⚠ RISK'}  ${f}:${i + 1}`)
      console.log(`         parse: ${lines[i].trim().slice(0, 92)}`)
      console.log(`         write: ${window[w].trim().slice(0, 92)}  (+${w} lines)`)
    }
  }
}
console.log(`\n${scanned} files scanned · ${flagged} parse-then-write sites found`)
console.log('⚠ RISK is a HINT, not a verdict — check whether the write targets the PARSED object and')
console.log('  whether anything serializes it afterwards. Most hits are a parse read for its data while')
console.log('  a NEW transaction is built beside it, which is perfectly safe.')
