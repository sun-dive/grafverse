# Bitcoin BASIC — the runbook ⌨

**Read this before touching `mint/src/basic.ts`.** It is the compiler every covenant in this repo is
built with, and its output is what gets minted. BRC-Z (`scripts/BRC-Z-bitcoin-basic.md`) says what the
language *is*; this says how to use it, and where it has bitten.

---

## ⚠⚠⚠ THE HARD RULE

```
1  THE COMPILED SCRIPT MUST SAY WHAT THE PROGRAM SAYS.
   `x = 2 * 3 + 4` emits a multiply and an add. NOT the number 10.

2  FOLD ONLY WHAT SCRIPT CANNOT EXPRESS.
   Exactly one case: `^`, because there is no power opcode — a literal or no emission at all.
   A FOR counter is SUBSTITUTED, not folded. The arithmetic around it still emits.

3  NEVER "IMPROVE" THIS FILE IN PLACE.
   An optimisation goes to a NEW BETA VERSION under a written, narrow scope, proved against the
   live one. Bump `BASIC_VERSION`. Never as a tidy-up alongside another change.
```

**Why, measured 18 Aug.** v0 (`ceecb88`) was faithful. `c89dea7` added `FOR…NEXT` unrolling and, to
collapse the substituted counter, put a blanket `constEval` at the top of `emit()`. Written for the
counter, applied to everything:

```
written    demand = eng * FE * 8 / TM
emitted    9620726745          ← the engine, the force and the throttle, gone
```

⇒ The decompiler could no longer show a car's setup, and the round trip stopped closing. **The reader
is how this project checks its own work, so a compiler that erases the program defeats the thing it was
built to serve.** Scope creep from a real need is still scope creep. Enforced by 8 checks in
`test/basic.ts` and 10 in `test/basic-bundle.mjs`.

---

## What it does, and does not

| | |
|---|---|
| constant **folding** of a literal expression | ⚠ only `^` |
| constant **propagation** through a variable | ❌ never — **an assignment is a hard barrier** |
| `FOR … NEXT` with constant bounds | ✅ unrolled at compile time, one body per trip |
| branch-arm balancing | ✅ the whole reason this exists — both arms leave the same stack |
| `DIM x%4` / `x$12` state layout | ✅ generates the peel and the rebuild (BRC-X) |
| arrays | ❌ Script has none. See the four demos for four ways round it |

★ **The barrier is load-bearing, not a limitation.** Every value in a specialised race passes through a
name, which is why 242 assertions and 2,046 arithmetic opcodes end up on chain in a car whose outcome
was known before it was minted. If someone ever adds propagation, `racer-car.ts` fails loudly — it
counts assertions per tick. That guard is the rule's teeth.

---

## Doing things

```ts
import { compileBasic, compileState, BASIC_VERSION } from './src/basic.ts'
import { unbasic, unbasicListing } from './src/unbasic.ts'
import { COVENANT_IDIOMS, READER_PRESETS } from './src/readerPresets.ts'
import { buildBasicLock, frameMaxFee } from './src/basicCovenant.ts'

compileBasic(src, { stack: ['a','b'], consts: { K: 2 } })   // → { ops, stack, assigned, unrolled }
compileState(src, { fieldOffset, consts, stack })            // → { peel, body, rebuild, ops, stack, layout }
unbasicListing(chunks, { stack: ['preimage'], idioms: COVENANT_IDIOMS })
```

**Reading a covenant back.** Name what the unlocking script pushes, or the listing stops at the first
`OP_DUP` on an empty stack. `READER_PRESETS` has the stacks for the shipped covenants.

---

## ⚠ What has gone wrong

Every one of these was green at the time.

- **⚠⚠ THE ALTSTACK IS WHERE YOU LOSE TRACK OF WHAT YOU PUT THERE.** Twice in one day. (a) A covenant
  loaded `hashOutputs` and `V` onto the altstack at the START of a script and read them at the END —
  with attacker-controlled bytes in between, who pop the real values and push their own. **That is a
  drain, not a burn.** (b) A depot stashed its own script size on top of the `V` already there, so the
  read meant to fetch the BALANCE fetched the size — every comparison below ran on nonsense **and
  passed**, including the value floor.
  ⇒ **Security state must not cross bytes you do not control**, and if the value is on the main stack
  already, leave it there. Put verification and binding ADJACENT, as one unbroken run.

- **⚠ `compileState` reports the stack AFTER the rebuild, and only then.** Emit `peel ‖ body` without
  the rebuild and there is no supported depth to clean up with: the true depth after the body was 16
  and the only number on offer was 9. It was harmless until something reached into the main stack, and
  then it would have failed hundreds of opcodes from the cause.
  ⇒ **Derive the depth from the model, or emit the ops the model describes. Never split them.**

- **⚠ The reader matched idioms on SHAPE and mislabelled.** Opcodes and push *lengths*, ignoring values —
  fine for the hundred-opcode `PUSHTX` preamble, false for an eight-opcode one:
  ```
  the spent output's VALUE   SIZE push[52] SUB SPLIT NIP push[8]  SPLIT DROP
  HASHOUTPUTS                SIZE push[40] SUB SPLIT NIP push[32] SPLIT DROP
  ```
  It said a script read `hashOutputs` where it read the value, in a listing whose whole purpose is
  letting a person check the script. **A wrong name is worse than a stop, because a stop is visible.**
  ⇒ Fixed bytes now set `exact`. Only genuinely scope-varying idioms stay shape-matched.

- **⚠ The round trip is a reading, not a source.** 15/15 compile back; **9/15 byte-identical**. Branches
  come back as the balancing the compiler performed; an unrolled FOR comes back as the copies that are
  actually in the script, because the loop is not. Both compute the same thing. Neither is a round trip
  of BYTES, and a race car is always in the 6.

- **⚠ THE BUNDLE GOES STALE IN SILENCE.** Every test imports `src/`. `basic.html` loads
  `vendor/grafbasic.js`. On 18 Aug the fold was removed, 47 test files went green, and the compiler on
  the live page went on folding — nothing had rebuilt it and nothing could have said so.
  ⇒ `node mint/build-basic.mjs`, then `test/basic-bundle.mjs` runs THE ARTEFACT.
  ⇒ ⚠ **And a rebuild is not a deploy.** Push ≠ live; cPanel needs *Deploy HEAD Commit*. `curl` the URL
  and check `BASIC_VERSION`, because a fold-free bundle is only ~400 bytes bigger.

- **Small refusals that cost minutes.** Identifiers take letters — `__probe` is refused, correctly.
  `FOR` bounds must be known at compile time. `^` with a runtime exponent is refused rather than
  approximated. `DIM` widths are 1–75 (76 makes `OP_PUSHDATA1` shift every offset).

---

## ★ Optimising WITHOUT touching the compiler

`src/optimizeCarCompile.ts` is the worked example, and the pattern generalises.

```
✔  a BASIC → BASIC transform     rewrite the PROGRAM, hand it to the untouched faithful compiler
✘  an opcode rewriter            the script then says what no program says, and the reader shows soup
```

⇒ Faithfulness survives end to end: hand back BOTH programs, so a reader sees what was written **and**
what was minted, and the chain matches the second one line for line.

**Prove it against the faithful build on every emit.** Compile both, RUN both through the interpreter,
require the carried values identical, and throw rather than return. An optimiser that cannot be checked
is a rumour. ⚠ And provoke the guard — `test/optimize-car.ts` sabotages three ways, and two of them die
by refusing to validate rather than by disagreeing, which is the stronger outcome.

---

## The demos, and what each one is for

| | | |
|---|---|---|
| `oxo.ts` | 1,330 B · 5 B state | turn-taking enforced by the covenant. Board packed base 3 |
| `oxo4.ts` | 762 B program | +1 byte of state buys −105 B — the shift wins with the index space |
| `invaders.ts` | 1,082 B · 55 aliens | `2 ^ k` in an unrolled FOR **is** the array |
| `rule110.ts` | 2,974 B · no runtime index | Turing complete, and it shows WHERE THE LOOP WENT |
| `racerTick.ts` | trace specialisation | branches → assertions; a wrong prediction produces NO race |

⚠ Their byte counts are published in BRC-Z. Removing the blanket fold did **not** move any of them —
they take runtime inputs, so nothing folded in them anyway. Re-measure before editing that PR.

---

## ★★ The one idea worth carrying to the next covenant

**Script has no backward jump, so a program's LENGTH is its work** — and where the loop lives is an
ECONOMIC question whose answer differs per program.

```
rule110    unrolling buys 1.21x     the body dominates (frame 566 B, body 2,408 B)
the racer  unrolling buys ~10x      the frame is 13x its body
```

⇒ Measure both before choosing. And when everything about a run is known before it is minted, the
branches can become assertions — smaller, and it enforces the same thing by refusing instead of
choosing. **A wrong prediction then produces no race at all, rather than a wrong one.**
