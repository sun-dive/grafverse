// © BSV Association — Open BSV License v6.
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

/** Boot the page's script in this realm behind just enough DOM for it to believe it is in a browser. */
function bootPage (html) {
  const body = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  const noop = () => {}
  const ctx2d = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? noop : undefined), set: () => true })
  const cache = {}
  const el = (id) => ({
    id, style: {}, classList: { add: noop, remove: noop }, value: undefined,
    textContent: '', innerHTML: '', disabled: false, width: 900, height: 260,
    getContext: () => ctx2d, addEventListener: noop, appendChild: noop, scrollTop: 0, scrollHeight: 0,
  })
  const document = {
    getElementById: (id) => (cache[id] ||= el(id)),
    createElement: (t) => {
      const e = el('new-' + t)
      // the page asks for /vendor/grafmint.js; hand it the built bundle off disk
      if (t === 'script') queueMicrotask(() => {
        if (!globalThis.window.GrafMint) vm.runInThisContext(readFileSync(BUNDLE, 'utf8'), { filename: 'grafmint.js' })
        e.onload && e.onload()
      })
      return e
    },
    head: { appendChild: noop }, body: { appendChild: noop },
    addEventListener: (_, f) => f(), querySelectorAll: () => [], querySelector: () => null,
  }
  Object.assign(globalThis, {
    document, window: globalThis, self: globalThis, location: { href: '', protocol: 'https:' },
    requestAnimationFrame: (f) => setTimeout(f, 0), addEventListener: noop,
  })
  vm.runInThisContext(body, { filename: 'bitcoin-racers.html' })
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
  await until(() => typeof doc.getElementById('run').onclick === 'function')
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
    })
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
for (const r of await runPage(html)) {
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
}

// ── THE NEGATIVE CONTROL ──────────────────────────────────────────────────────────────────────────
// Ask for the identical retirement without setting the flag the covenant reads. If these still pass,
// the retire branch is not doing anything and every green result above is meaningless.
console.log('\nNEGATIVE CONTROL — the same retirements, with the flag withheld\n')
const FLAG = 'at:at,retire:true,payout:payout'
if (!html.includes(FLAG)) {
  check('the retire flag is where this test expects it', false, '— update FLAG in this file')
} else {
  delete globalThis.window                                   // a fresh page, and a fresh bundle load
  const sabotaged = await runPage(html.replace(FLAG, 'at:at,retire:false,payout:payout'))
  for (const r of sabotaged) {
    const refused = r.verdict.includes('rejected')
    check(`  ${r.label.padEnd(22)}`, r.expect === 'retired' ? refused : !refused,
      r.expect === 'retired' ? (refused ? 'refused, as it must be' : '⚠ ACCEPTED — the branch is a no-op')
                             : 'unaffected — this one never retires')
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) { console.error('PAGE: FAIL — what ships does not match the covenant'); process.exit(1) }
console.log('PAGE OK — every run ends, and every satoshi comes home.')
