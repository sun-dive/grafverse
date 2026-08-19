// © BSV Association — Open BSV License v6.
// Bundle Bitcoin Racers into ../vendor/grafracers.js as the global `GrafRacers`.
//
// ⚠⚠ DELIBERATELY NOT PART OF grafmint.js. That bundle is loaded by depot · battery · brc226 ·
// grafverse · racers, and `shell.ts` reaches grafbasic.js too — so before this file existed, a change
// to the racers' physics meant rebuilding bundles that six other live pages depend on.
// ⇒ THE RULE: every page's script is isolated. A page owns its own sources and its own bundle, and
// working on one must never rebuild a bundle another page loads. Two reasons:
//   · BLAST RADIUS — one page's change must not be able to break five others.
//   · BLOAT — a browser should download THIS page's code, not everything the repo can do.
import { build } from 'esbuild'

const out = await build({
  entryPoints: ['src/grafracers.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'GrafRacers',
  platform: 'browser',
  target: 'es2020',
  outfile: '../vendor/grafracers.js',
  minify: true,
  legalComments: 'none',
  metafile: true,
  banner: { js: '/* Bitcoin Racers — © 2026 sun-dive · Open BSV License v6 (see LICENSE). Bundles @bsv/sdk (BRC-100 wallet SDK) © BSV Association, Open BSV License — see NOTICE. Not our code; bundled + called, not ported. */' },
})

/* ★ Say what it cost. The whole point of a per-page bundle is that a browser downloads THIS page's
   code and not everything the repo can do — so the size is the feature, and it should be visible. */
const bytes = Object.values(out.metafile.outputs)[0].bytes
console.log(`built ../vendor/grafracers.js  ${(bytes / 1024).toFixed(0)} KB`)
