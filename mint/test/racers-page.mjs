// © 2026 sun-dive — Apache License 2.0.
// THE PAGE ITSELF — bitcoin-racers.html, driven in node behind a stub DOM.
//
//   node mint/test/racers-page.mjs
//
// Every other suite here tests the covenant. This one tests the thing a visitor actually runs: it
// reads the shipped HTML, executes its real <script>, loads the real bundle, clicks the real button
// and reads the real result table. Nothing is reimplemented, so the page cannot drift away from the
// covenant without this going red — which is exactly what happened while retirement was being built.
//
// ★ WHAT IT IS REALLY CHECKING: that no run can strand its tank.
//
// A shell holds satoshis. Every path out of a race — crossing the line, wrecking, or simply getting
// too low to continue — has to end in a transaction the covenant will accept, or those satoshis are
// locked in an output nobody can ever spend. So each case asserts the money BALANCES:
//
//     tank + pot (if won)  =  burned as fees  +  recovered by the driver  +  1 sat headstone
//
// ⚠ AND IT CARRIES ITS OWN NEGATIVE CONTROL. A green run proves nothing on its own: if the covenant
// ignored the retire flag entirely, every case above would still pass. So the same page is re-run
// with `retire:true` flipped to `retire:false` and the retiring cases are REQUIRED to be refused.
// Without that, this file would be testing that the code does not crash, not that the script works.
import { readFileSync } from 'fs'
import vm from 'vm'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const PAGE = `${ROOT}/bitcoin-racers.html`
const BUNDLE = `${ROOT}/vendor/grafmint.js`

const CASES = [
  ['a clean quarter mile',     { eng: 14, tyr: 10, tank: 60000, fin: 402, slip: 1000, gap: 1 }, 'won'],
  ['a tank that runs dry',     { eng: 20, tyr: 10, tank: 12000, fin: 402, slip: 1000, gap: 1 }, 'retired'],
  ['greasy strip, big engine', { eng: 22, tyr: 3,  tank: 40000, fin: 402, slip: 500,  gap: 1 }, 'retired'],
  ['barely any fuel at all',   { eng: 10, tyr: 10, tank: 2000,  fin: 402, slip: 1000, gap: 1 }, 'retired'],
]

/* ⚠⚠ THE SANDBOX HAS NO NODE GLOBALS, AND THAT IS THE POINT.
   This suite once ran the page in node's own realm, where `process` happens to exist — so it passed
   green while the live page threw "process is not defined" on load and did nothing at all. The bug
   was one unguarded `process.env.SHELL_DEBUG` deep in the covenant builder, and no amount of racing
   would have found it, because the harness was standing in the one place the bug could not be seen.
   ⇒ the page now runs in a FRESH vm context holding only what a browser gives it. `process`,
   `Buffer`, `require` and `__dirname` are absent, so anything reaching for them fails HERE. */
const BROWSER_ONLY = ['process', 'Buffer', 'require', '__dirname', 'module', 'global']

/** Boot the page's script in a browser-shaped realm — no node globals, so node-only code cannot hide. */
function bootPage (html) {
  const body = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  const noop = () => {}
  const ctx2d = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? noop : undefined), set: () => true })
  const cache = {}
  /* The page paints its own boot failures into .wrap and then simply stops — which is precisely how
     "process is not defined" reached a visitor. Capture that text; it is the most important thing
     this harness can report, and a null stub here would hide it behind a crash in the stub itself. */
  const boot = []
  const el = (id) => ({
    id, style: {}, classList: { add: noop, remove: noop }, value: undefined,
    textContent: '', innerHTML: '', disabled: false, width: 900, height: 260,
    getContext: () => ctx2d, addEventListener: noop, appendChild: noop, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML: (_, h) => boot.push(strip(h)),
  })
  const document = {
    getElementById: (id) => (cache[id] ||= el(id)),
    createElement: (t) => {
      const e = el('new-' + t)
      // the page asks for /vendor/grafmint.js; hand it the built bundle off disk
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
  // exactly what a browser offers, and nothing node adds on top
  /* The page paces itself to the race clock — a tenth of a second per tick, so the strip agrees with
     the seconds counter. That is right for a viewer and wrong for a test, which would then sit through
     several minutes of real waiting. So the sandbox's setTimeout FIRES IMMEDIATELY but RECORDS what was
     asked for, and the pacing is asserted from those numbers rather than by enduring it. */
  const paced = []
  const sandbox = vm.createContext({
    document, location: { href: '', protocol: 'https:' }, navigator: { userAgent: 'test' },
    console, clearTimeout, setInterval, clearInterval, queueMicrotask,
    setTimeout: (f, ms) => { if (ms) paced.push(ms); return setTimeout(f, 0) },
    TextEncoder, TextDecoder, crypto, fetch, URL, atob, btoa,
    requestAnimationFrame: (f) => setTimeout(f, 0), addEventListener: noop,
  })
  document.pacedDelays = paced
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox

  for (const g of BROWSER_ONLY) {
    if (g in sandbox) throw new Error(`the sandbox leaked ${g} — this test would not catch node-only code`)
  }
  vm.runInContext(body, sandbox, { filename: 'bitcoin-racers.html' })
  return document
}

const until = (cond) => new Promise((r) => {
  const t = setInterval(() => { if (cond()) { clearInterval(t); r() } }, 5)
})
const strip = (s) => s.replace(/<[^>]+>/g, '')
const num = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0

/** Run every case through one instance of the page and report what the result table says. */
async function runPage (html) {
  const doc = bootPage(html)
  await until(() => typeof doc.getElementById('run').onclick === 'function' || doc.bootErrors.length > 0)
  if (doc.bootErrors.length) return { bootError: doc.bootErrors[0] }
  const out = []
  for (const [label, cfg, expect] of CASES) {
    for (const [k, v] of Object.entries(cfg)) doc.getElementById(k).value = v
    doc.getElementById('run').onclick()
    await until(() => doc.getElementById('run').disabled === false)
    const rows = [...doc.getElementById('result').innerHTML.matchAll(
      /<td class="k">([^<]*)<\/td><td class="v">(.*?)<\/td>/g)].map((m) => [m[1], strip(m[2])])
    const cell = (k) => (rows.find((r) => r[0].includes(k)) || [, ''])[1]
    out.push({
      label, expect, cfg,
      verdict: strip(doc.getElementById('verdict').innerHTML),
      txs: num(cell('transactions')), kb: cell('total size'),
      burned: num(cell('fuel burned')), took: num(cell('recovered')),
      paced: doc.pacedDelays.slice(),
    })
    doc.pacedDelays.length = 0
  }
  return out
}

let pass = 0, fail = 0
const check = (name, ok, note = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '   ' + note : ''}`)
  ok ? pass++ : fail++
}

console.log('THE PAGE — bitcoin-racers.html run end to end against the real covenant\n')

const html = readFileSync(PAGE, 'utf8')
const results = await runPage(html)

/* ★ DOES IT RUN AT ALL? Everything below assumes the page booted. It once did not — one unguarded
   node global and the whole page died on load, painted the message at the bottom and wired no button.
   That is the cheapest possible failure to catch and the most expensive one to ship. */
if (results.bootError) {
  check('the page boots', false, `— it did not: "${results.bootError}"`)
  console.log(`\n${pass}/${pass + fail} checks passed`)
  console.error('PAGE: FAIL — the page does not run in a browser at all')
  process.exit(1)
}
check('the page boots', true, 'no node globals, no boot error')

for (const r of results) {
  const won = r.verdict.includes('s')&& !r.verdict.includes('retired') && !r.verdict.includes('DNF')
  const ended = won || r.verdict.includes('retired') || r.verdict.includes('DNF')
  check(r.label.padEnd(24), ended && !r.verdict.includes('rejected'),
    `${r.verdict.padEnd(9)} · ${String(r.txs).padStart(3)} txs · ${r.kb.padStart(8)} · ` +
    `burned ${r.burned.toLocaleString().padStart(7)} · recovered ${r.took.toLocaleString().padStart(7)}`)

  // ★ the balance: nothing may go missing, and exactly one satoshi may stay behind
  const pot = won ? Math.round(r.cfg.tank / 2) : 0
  check(`  every satoshi accounted for`, r.cfg.tank + pot === r.burned + r.took + 1,
    `${(r.cfg.tank + pot).toLocaleString()} in · ${r.burned.toLocaleString()} burned + ` +
    `${r.took.toLocaleString()} out + 1 left`)

  /* ★ and it runs at the speed it CLAIMS to. Without this the race is over in a fifth of the time the
     result table reports, and the car appears to teleport to the flag — which reads as a hung page. */
  const ticks = r.paced.filter((ms) => ms === 100).length
  check(`  paced to the race clock`, ticks > 0 && Math.abs(ticks - r.txs) <= 4,
    `${ticks} waits of 100 ms across ${r.txs} transactions`)
}

// ── THE NEGATIVE CONTROL ──────────────────────────────────────────────────────────────────────────
// Ask for the identical retirement without setting the flag the covenant reads. If these still pass,
// the retire branch is not doing anything and every green result above is meaningless.
console.log('\nNEGATIVE CONTROL — the same retirements, with the flag withheld\n')
const FLAG = 'at:at,retire:true,payout:payout'
if (!html.includes(FLAG)) {
  check('the retire flag is where this test expects it', false, '— update FLAG in this file')
} else {
    const sabotaged = await runPage(html.replace(FLAG, 'at:at,retire:false,payout:payout'))
  for (const r of (sabotaged.bootError ? [] : sabotaged)) {
    const refused = r.verdict.includes('rejected')
    check(`  ${r.label.padEnd(22)}`, r.expect === 'retired' ? refused : !refused,
      r.expect === 'retired' ? (refused ? 'refused, as it must be' : '⚠ ACCEPTED — the branch is a no-op')
                             : 'unaffected — this one never retires')
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('PAGE: FAIL — what ships does not match the covenant'); process.exit(1) }
console.log('PAGE OK — every run ends, and every satoshi comes home.')
