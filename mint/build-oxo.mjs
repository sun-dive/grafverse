// © BSV Association — Open BSV License v6.
// Bundle on-chain noughts and crosses into ../vendor/grafoxo.js as the global `GrafOxo`.
// ⚠⚠ ITS OWN BUNDLE, DELIBERATELY. grafmint.js is loaded by the depot, the battery, brc226,
//    grafverse and the racers — adding a game to it would push all of those visitors onto a new
//    bundle for a page they never opened. Nothing else is rebuilt by this script.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/grafoxo.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'GrafOxo',
  platform: 'browser',
  target: 'es2020',
  outfile: '../vendor/grafoxo.js',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* grafverse on-chain noughts and crosses — © 2026 sun-dive · Open BSV License v6 (see LICENSE). Bundles @bsv/sdk © BSV Association, Open BSV License — see NOTICE. */' },
})
console.log('built ../vendor/grafoxo.js')
