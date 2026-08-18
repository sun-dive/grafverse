// © BSV Association — Open BSV License v6.
/**
 * ★★★ THE COVENANTS OF THIS PROJECT, READY TO BE READ.
 *
 * sun-dive, 17 August 2026, on seeing `basic.html` read the shell:
 *
 *   *"For months, I've been sitting here like a blind man. Only able to describe what to build but
 *   unable to see it."*
 *
 * The reader's output is only as good as the NAMES it is given — the script is the source and the names
 * are annotation over it, so an unnamed covenant reads correctly and anonymously, and a named one reads
 * as the machine somebody designed. Typing sixteen names by hand before you can read your own car is a
 * barrier between a person and their own work, and this file removes it.
 *
 * ── ⚠ THE NAMES ARE DERIVED, NOT COPIED ────────────────────────────────────────────────────────────
 * Every list below is built from the covenant's OWN unlocking-script builder, in the order that builder
 * pushes. A preset written out by hand would be correct on the day it was written and silently wrong
 * the first time a covenant gained a field — and "silently wrong" here means every name in the listing
 * shifts by one and the reading becomes a plausible fiction. `reader-presets.ts` in the test directory
 * checks that each one still reads its covenant to the end, so a drift fails a test rather than a
 * person's afternoon.
 */
import { LockingScript } from '@bsv/sdk'
import { type Idiom } from './unbasic.ts'
import { extractHashOutputsOps, extractScriptCodeFieldOps } from './covenant.ts'
import { pushTxVerifyOps, pushTxConstants } from './pushtx.ts'
import { buildShellLock, emptyShell, loadables, RACER_REGS } from './shell.ts'
import { buildDepotLock } from './depot.ts'
import { buildBatteryLock, genesisState } from './battery.ts'
import { buildLiveCounterLock } from './liveCounter.ts'

export interface ReaderPreset {
  key: string
  label: string
  /** One line on what the covenant is, for someone meeting it in a listing. */
  note: string
  /** What the unlocking script pushes, BOTTOM FIRST — the reader resolves names against this. */
  stack: string[]
  /** Built here rather than pasted, so the example is always the CURRENT covenant. */
  build: () => LockingScript
}

const H20 = (b: number): number[] => new Array(20).fill(b)

/**
 * ⚠ THE SHELL'S DEEPEST PUSHES ARE THE LOADABLES, and there are eight of them in `loadables` order —
 * every one pushed on every spend, because the covenant counts POSITIONS rather than arguments. Reading
 * that list from the shell itself is the difference between a preset and a guess.
 */
const shellStack = (): string[] => [
  'burn', 'retire',
  ...loadables(RACER_REGS).map(l => `load_${l.k}`),
  'throttle', 'sig', 'pubKey', 'spenderOutputs', 'newValue', 'preimage',
]

export const READER_PRESETS: ReaderPreset[] = [
  {
    key: 'shell',
    label: 'the racer — a car',
    note: 'Bitcoin Racers. The physics run IN SCRIPT: grip, demand, drag, the phase machine, and a ' +
      'fuel tank that pays its own fee. Hand-written, and no BASIC ever generated it.',
    stack: shellStack(),
    build: () => buildShellLock({ state: emptyShell() }),
  },
  {
    key: 'depot',
    label: 'the fuel depot',
    note: 'A shared tank. It refuels a car it recognises by the SHAPE of that car\'s script, bounds ' +
      'what may leave, and lets its owner retire it. Anyone may fill it; nobody may take it.',
    stack: ['prefixOutputs', 'burn', 'sig', 'pubKey', 'spenderOutputs', 'newValue', 'preimage'],
    /* ⚠ A depot is bound to a CAR, so the preset builds a real one to bind to rather than a stand-in —
       the car's shape is what the depot actually checks.
       ⚠ AND THE CAR NEEDS AN OWNER. `carShape` refuses an all-zero owner field, because a depot bound
       to an ownerless car "would fuel anybody" — the covenant's own words, and it is right, so the
       preset has to build a car somebody owns rather than an empty one. */
    build: () => buildDepotLock({
      carScript: buildShellLock({ state: { ...emptyShell(), driver: H20(0x44) }, public: true }).toBinary(),
      owner: H20(0x11),
    }),
  },
  {
    key: 'battery',
    label: 'the battery (BRC-226)',
    note: 'A program that pays for its own execution. One Mandelbrot iteration per transaction, ' +
      'recreating itself slightly lighter each time. No key exists for it — there is nothing to steal.',
    stack: ['spenderOutputs', 'newValue', 'preimage'],
    build: () => buildBatteryLock({ state: genesisState() }),
  },
  {
    key: 'livecounter',
    label: 'the live counter',
    note: 'The smallest complete covenant here: it counts, repays whoever funded the last tick, and ' +
      'pays its author a crumb. A good first listing to read all the way through.',
    stack: ['spenderOutputs', 'newFunderHash', 'preimage'],
    build: () => buildLiveCounterLock({ n: 0, lastFunderHash: H20(0x22), authorHash: H20(0x33) }),
  },
]

/**
 * ★★ THE RUNS WORTH NAMING — supplied to the reader so a covenant opens with its PROGRAM rather than
 * with the hundred opcodes every covenant begins with.
 *
 * ⚠ One instance of each is enough for every covenant here, because the reader matches on opcode shape
 * rather than on bytes: the same primitive built for a different SIGHASH scope carries different
 * constants and the identical opcode sequence.
 */
export const COVENANT_IDIOMS: Idiom[] = [
  {
    name: 'PUSHTX',
    chunks: pushTxVerifyOps(pushTxConstants()),
    pops: 0,
    /* It consumes nothing and leaves the preimage where it was — what it changes is that the preimage
       is now PROVED to be this transaction's, which is the whole of OP_PUSH_TX. No key is involved. */
    say: 'REM  OP_PUSH_TX — the preimage is proved to be THIS transaction\'s, with no key anywhere\n' +
      'VERIFY PUSHTX($0)',
  },
  /* ⚠ BOTH ARE `exact`. Their bytes do not vary with the SIGHASH scope — they are fixed offsets into
     the preimage — and they are short enough that another eight-opcode run of the same shape is not
     merely possible but has already happened: reading the spent output's VALUE is the same shape with
     52 and 8 where these carry 40 and 32. See `idiomAt`. */
  {
    name: 'HASHOUTPUTS',
    chunks: extractHashOutputsOps(),
    pops: 1,
    push: 'HASHOUTPUTS($0)',
    exact: true,
  },
  {
    name: 'SCRIPTCODE',
    chunks: extractScriptCodeFieldOps(),
    pops: 1,
    push: 'SCRIPTCODE($0)',
    exact: true,
  },
]
