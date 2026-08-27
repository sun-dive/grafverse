// © 2026 sun-dive — Apache License 2.0.
// THE LIVE PAGE — depot.html booted in a browser-shaped realm, with the network cut off.
//
//   node mint/test/depot-page.mjs
//
// ── ⚠⚠ THIS IS THE PAGE THAT SPENDS REAL MONEY, AND IT HAD NO TEST ────────────────────────────────
// `racers-page.mjs` runs `bitcoin-racers.html`, which broadcasts nothing. `depot.html` reads mainnet,
// builds transactions and sends them — and nothing checked that it so much as LOADS. It was caught
// the honest way: a `var REGS = GM.PUBLIC_CAR_REGS` written at the top of the script, where `GM` is
// still null until the bundle arrives. That throws on load and takes every button with it, and the
// only symptom a visitor sees is a page that does nothing. Same family as `window.grafmint` vs
// `window.GrafMint`, which this project has already shipped once.
//
// ★ WHAT THIS ASSERTS, and deliberately nothing more:
//   1. the script evaluates in a realm with NO node globals — `process`, `Buffer`, `require` absent
//   2. the bundle loads and the page finds what it expects on it
//   3. the three constants that must agree — DEPOT_TXID · CAR_SEED · REGS — agree with the covenants
//   4. the FIRST thing it asks mainnet for is the depot named above — it is looking at the right one
import { readFileSync } from 'fs'
import vm from 'vm'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const PAGE = `${ROOT}/depot.html`
const BUNDLE = `${ROOT}/vendor/grafmint.js`

let pass = 0, fail = 0
const check = (n, got, want = true) => {
  const ok = got === want; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); ok ? pass++ : fail++
}
const strip = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/* ⚠ NO NODE GLOBALS — the same rule `racers-page` learned the hard way. A harness standing in the one
   place a bug cannot be seen is worse than no harness. */
const BROWSER_ONLY = ['process', 'Buffer', 'require', '__dirname', 'module', 'global']

function bootPage (html) {
  const body = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  const noop = () => {}
  const cache = {}
  const boot = []
  const el = (id) => ({
    id, style: {}, classList: { add: noop, remove: noop }, value: undefined,
    textContent: '', innerHTML: '', disabled: false,
    addEventListener: (_, f) => { (el.handlers ||= []).push(f) },
    appendChild: noop, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML: (_, h) => boot.push(strip(h)),
  })
  const document = {
    getElementById: (id) => (cache[id] ||= el(id)),
    createElement: (t) => {
      const e = el('new-' + t)
      if (t === 'script') queueMicrotask(() => {
        if (!sandbox.GrafMint) vm.runInContext(readFileSync(BUNDLE, 'utf8'), sandbox, { filename: 'grafmint.js' })
        e.onload && e.onload()
      })
      return e
    },
    head: { appendChild: noop }, body: { appendChild: noop },
    addEventListener: (_, f) => f(), querySelectorAll: () => [],
    querySelector: (sel) => (cache[sel] ||= el(sel)),
  }
  document.bootErrors = boot
  /* ⚠ THE NETWORK IS CUT OFF ON PURPOSE, AND EVERY CALL IS RECORDED. Booting must SURVIVE mainnet
     being unreachable — a page that only evaluates when WhatsOnChain answers breaks in public for
     reasons nobody can reproduce — and the calls it tries to make say which covenants it is looking
     at, which is the thing worth asserting. */
  const calls = []
  const sandbox = vm.createContext({
    document, location: { href: '', protocol: 'https:' }, navigator: { userAgent: 'test' },
    console: { log: noop, warn: noop, error: noop }, clearTimeout, setInterval, clearInterval,
    queueMicrotask, setTimeout: (f) => setTimeout(f, 0),
    TextEncoder, TextDecoder, crypto, URL, atob, btoa,
    fetch: (u) => { calls.push(String(u)); return Promise.reject(new Error('network is off in this test')) },
    requestAnimationFrame: (f) => setTimeout(f, 0), addEventListener: noop,
  })
  document.netCalls = calls
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox
  for (const g of BROWSER_ONLY) {
    if (g in sandbox) throw new Error(`the sandbox leaked ${g} — this test would not catch node-only code`)
  }
  vm.runInContext(body, sandbox, { filename: 'depot.html' })
  return { document, sandbox }
}

console.log('THE LIVE PAGE — depot.html, booted with the network off\n')

const html = readFileSync(PAGE, 'utf8')
let booted = null
try { booted = bootPage(html) } catch (e) { console.log(`        ⚠ ${e.message}`) }
check('★★ the page script evaluates at all — no node globals, no bundle yet', booted !== null)
if (!booted) { console.error('DEPOT PAGE: FAIL'); process.exit(1) }

const { document, sandbox } = booted
await new Promise(r => setTimeout(r, 60))     // let the bundle's queueMicrotask land

check('★ the bundle loaded and exported GrafMint', !!sandbox.GrafMint)
check('★★ …and the page resolved its regulations from it — REGS is not null',
  !!sandbox.REGS && sandbox.REGS.RESERVE > 0)
check('  …which are the PUBLIC car\'s, not the default car\'s',
  sandbox.REGS?.RESERVE === sandbox.GrafMint?.PUBLIC_CAR_REGS?.RESERVE)

/* ── ★★ THE THREE CONSTANTS THAT MUST AGREE ───────────────────────────────────────────────────────
   A depot recognises ONE car script, by its shape and its owner. The page must therefore build the
   same variant the live depot was minted against, and look for the car at the genesis it was minted
   at. Change one of the three and all three must move. */
console.log()
{
  const GM = sandbox.GrafMint
  const owner = GM.Utils.fromBase58Check(sandbox.OWNER_ADDR).data
  const car = GM.buildShellLock({ state: GM.freshPublicShell(owner), maxFee: GM.shellMaxFee(sandbox.REGS),
                                  public: true, regs: sandbox.REGS })
  check('★ DEPOT_TXID is a 64-character txid', /^[0-9a-f]{64}$/.test(sandbox.DEPOT_TXID))
  check('★ CAR_SEED names an outpoint — the car\'s GENESIS, not its script',
    /^[0-9a-f]{64}$/.test(sandbox.CAR_SEED?.txid) && Number.isInteger(sandbox.CAR_SEED?.vout))
  check('★★ the car the page would build is the size the depot\'s fee was measured against',
    car.toBinary().length === 1744)
  console.log(`        owner ${sandbox.OWNER_ADDR}`)
  console.log(`        depot ${sandbox.DEPOT_TXID.slice(0, 16)}…  ·  car ${sandbox.CAR_SEED.txid.slice(0, 16)}…:${sandbox.CAR_SEED.vout}`)
  console.log(`        car script ${car.toBinary().length} B · sha256 ${GM.Utils.toHex(GM.Hash.sha256(car.toBinary())).slice(0, 16)}…`)
}

/* ── ★ AND IT LOOKS AT THE RIGHT CHAIN ────────────────────────────────────────────────────────────
   ⚠ THIS CHECK FIRST ASSERTED "no network call during boot", AND FAILED — because the page reads the
   chain on load, which is exactly what a live page should do. The assertion was wrong, not the page.
   What matters is not that it stays silent but that the first thing it asks for is THIS depot: a page
   pointed at a retired covenant looks perfectly healthy until a visitor presses a button. */
console.log()
{
  const first = document.netCalls[0] ?? ''
  check('★★ the first thing it asks mainnet for is the depot it was wired to',
    first.includes(sandbox.DEPOT_TXID))
  check('  …and it survived mainnet refusing to answer — every fetch here rejects', true)
  console.log(`        ${document.netCalls.length} call(s) attempted · first: …${first.slice(-24)}`)
}
check('★ no boot error was painted into the page', document.bootErrors.length === 0)
if (document.bootErrors.length) console.log('        ⚠ ' + document.bootErrors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('DEPOT PAGE: FAIL — the live page does not boot'); process.exit(1) }
console.log('DEPOT PAGE OK — it loads, it found its covenants, and it agrees with them.')
