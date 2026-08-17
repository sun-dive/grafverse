// © BSV Association — Open BSV License v6.
// Bundle the BASIC ⇄ Script workbench into ../vendor/grafbasic.js as the global `GrafBasic`.
// ⚠ Deliberately NOT part of grafmint.js: that one is loaded by the game, this one by a tool page.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/grafbasic.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'GrafBasic',
  platform: 'browser',
  target: 'es2020',
  outfile: '../vendor/grafbasic.js',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* grafverse BASIC workbench — © 2026 sun-dive · Open BSV License v6 (see LICENSE). Bundles @bsv/sdk © BSV Association, Open BSV License — see NOTICE. */' },
})
console.log('built ../vendor/grafbasic.js')
