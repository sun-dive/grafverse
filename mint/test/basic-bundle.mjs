// © BSV Association — Open BSV License v6.
//
// ★★★ THE BUILT BUNDLE — is the compiler people actually USE still a compiler?
//
//   node mint/test/basic-bundle.mjs
//
// ⚠⚠ WHY THIS FILE EXISTS. Every other test in this suite imports `src/`. `basic.html` does not — it
// loads `vendor/grafbasic.js`, a build artefact that goes stale in silence. On 18 August the blanket
// constant fold was removed from `src/basic.ts`, forty-seven test files went green, and the compiler
// on the live page went on folding `2 * 3 + 4` into `10`, because nothing had rebuilt it and nothing
// could have told you. A green test on a path the change cannot reach is not evidence.
//
// ⇒ So this runs THE BUNDLE, in a fresh vm with no node globals it should not have, and asks it the
// questions THE HARD RULE answers. ⚠ And a rebuild is still not a deploy: push ≠ live, cPanel needs
// *Deploy HEAD Commit*, and `curl`ing the live URL is the only way to know which one is out there.
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'

let pass = 0, fail = 0
const check = (n, got, want = true) => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}

const BUNDLE = new URL('../../vendor/grafbasic.js', import.meta.url).pathname
const src = readFileSync(BUNDLE, 'utf8')

/* A browser-ish sandbox. ⚠ `fetch` is a STUB THAT THROWS, not a working one: the compiler must not
   touch the network to translate a line of BASIC, and if it ever starts to, this says so loudly. */
const sandbox = {
  console, TextEncoder, TextDecoder, crypto: webcrypto, URL, setTimeout, clearTimeout,
  fetch: () => { throw new Error('the compiler reached for the network') },
  Request: class {}, Response: class {}, Headers: class {},
}
sandbox.globalThis = sandbox; sandbox.self = sandbox; sandbox.window = sandbox
const ctx = vm.createContext(sandbox)
vm.runInContext(src, ctx, { filename: 'grafbasic.js' })
const G = ctx.GrafBasic

console.log('\nTHE BUILT BUNDLE — the compiler the page actually runs\n')
console.log(`        ${BUNDLE}`)
console.log(`        ${src.length.toLocaleString()} bytes · BASIC_VERSION ${G?.BASIC_VERSION ?? '(absent)'}\n`)

check('the bundle loads and exposes GrafBasic', !!G)
check('★ it reports its BASIC_VERSION — a bundle that cannot say what it is cannot be checked',
  typeof G.BASIC_VERSION === 'string' && G.BASIC_VERSION.length > 0)

/* OP_ADD 0x93 · OP_SUB 0x94 · OP_MUL 0x95 · OP_DIV 0x96 */
const ARITH = new Set([0x93, 0x94, 0x95, 0x96])
const arith = (s, env = { stack: [] }) =>
  G.compileBasic(s, env).ops.filter(o => ARITH.has(o.op)).length

console.log()
check('★★★ `x = 2 * 3 + 4` emits a MULTIPLY and an ADD — not the number 10',
  arith('x = 2 * 3 + 4') === 2)
check('★★★ a named constant is substituted, and the arithmetic around it still emits',
  arith('x = K * 3 + 4', { stack: [], consts: { K: 2 } }) === 2)
check('★★ a chain of assignments emits at every step',
  arith('a = 2\nb = a * 2\nc = b * 2\nd = c * 2') === 3)
check('★★ a comparison of two known values is still CHECKED by the network',
  G.compileBasic('a = 15\nVERIFY a > 10', { stack: [] }).ops.some(o => o.op === 0xa0))

/* ⚠ The one forced exception: Script has no power opcode, so `^` is a literal or nothing at all. */
check('⚠ `^` is still worked out at COMPILE time — there is no power opcode to emit',
  arith('x = 2 ^ 8') === 0)
check('★★★ an unrolled FOR substitutes the counter and EMITS the arithmetic around it',
  arith('x = 0\nFOR i = 1 TO 4\nx = x + i * 3\nNEXT i') === 8)

/* ── ★ and it still does the job it shipped for ─────────────────────────────────────────────────── */
console.log()
{
  const { ops } = G.compileBasic('VERIFY a + b > 10', { stack: ['a', 'b'] })
  const listing = G.unbasicListing(ops, { stack: ['a', 'b'] })
  check('★ the reader in the same bundle reads that back', listing.includes('VERIFY a + b > 10'))
  const again = G.compileBasic(listing, { stack: ['a', 'b'] })
  check('★★ …and the reading compiles back to the same bytes',
    new G.LockingScript(again.ops).toHex() === new G.LockingScript(ops).toHex())
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) {
  console.error('BASIC BUNDLE: FAIL — rebuild with `node mint/build-basic.mjs`, then DEPLOY (push ≠ live)')
  process.exit(1)
}
console.log('BASIC BUNDLE OK — the compiler on the page says what the program says.')
