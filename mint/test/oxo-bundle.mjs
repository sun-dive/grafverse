// © 2026 sun-dive — Apache License 2.0.
/**
 * ★★★ THIS TESTS THE BUILT BUNDLE, NOT THE SOURCE.
 *
 * ⚠⚠ `oxo.html` downloads `vendor/grafoxo.js`. Every other test in this directory imports `src/`, and
 *    BASIC.md records what that costs: *"THE BUNDLE GOES STALE IN SILENCE. On 18 Aug the fold was
 *    removed, 47 test files went green, and the compiler on the live page went on folding — nothing
 *    had rebuilt it and nothing could have said so."*
 * ⇒ So this loads the artefact the page actually gets, and nothing else.
 *
 *   node mint/build-oxo.mjs && node mint/test/oxo-bundle.mjs
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../../vendor/grafoxo.js', import.meta.url), 'utf8')
const ctx = { globalThis: null, console, TextEncoder, TextDecoder, crypto, fetch, Buffer,
              setTimeout, clearTimeout, URL, atob, btoa }
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx
vm.createContext(ctx)
vm.runInContext(code, ctx)
const G = ctx.GrafOxo
let pass = 0, fail = 0
const t = (ok, l, n = '') => { console.log(`  ${ok ? '✓' : '⚠⚠⚠'} ${l}${n ? '   ' + n : ''}`); ok ? pass++ : fail++ }

t(!!G, 'the bundle exposes GrafOxo', G ? Object.keys(G).length + ' exports' : 'MISSING')
const b0 = G.newBoard()
t(b0.moves === 0 && b0.turn === 1, 'a fresh board')
const lockHex = G.lockFor(b0).toHex()
t(lockHex.length / 2 === 1495, 'the LOOPING covenant is 1,495 bytes', lockHex.length / 2 + ' B')
const back = G.decodeBoard(lockHex)
t(back && back.turn === 1 && back.moves === 0, '★★ it decodes back out of its own script')
t(G.decodeBoard('76a914' + '11'.repeat(20) + '88ac') === null, '⚠ a non-board is refused')
const toss = G.tossFirst('a'.repeat(63) + '4')
t(toss === 1 || toss === 2, '★ the toss reads the txid', 'got ' + toss)
t(G.squares(b0).every(v => v === 0), 'nine empty squares')
t(G.MAX_FEE === 323, 'the move fee bound', G.MAX_FEE + ' sat')
t(b0.games === 0, '★ it carries a games counter — the board never stops')
console.log(`\n  ${fail === 0 ? '✓' : '⚠'} ${pass} passed, ${fail} failed — THE ARTEFACT, not the source`)
