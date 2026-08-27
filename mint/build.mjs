// © 2026 sun-dive — Apache License 2.0 (see LICENSE).
// Bundle grafspace's wallet+mint core into ../vendor/grafmint.js as the global `GrafMint`.
// grafverse.html vendors it exactly like three.min.js and lazy-loads it only on "Make immortal".
import { build } from 'esbuild'

await build({
  entryPoints: ['src/grafmint.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'GrafMint',
  platform: 'browser',
  target: 'es2020',
  outfile: '../vendor/grafmint.js',
  minify: true,
  legalComments: 'none',
  banner: { js: '/* grafspace mint core — © 2026 sun-dive · Apache License 2.0 (see LICENSE). Bundles @bsv/sdk (BRC-100 wallet SDK) © BSV Association, Open BSV License — see NOTICE. Not our code; bundled + called, not ported. */' },
})
console.log('built ../vendor/grafmint.js')
