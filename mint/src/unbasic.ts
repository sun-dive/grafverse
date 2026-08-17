// © BSV Association — Open BSV License v6.
/**
 * ★★★ SCRIPT → BASIC — the direction that matters more.
 *
 * There are three ways to resolve a BASIC front end against the rule that the SCRIPT is the source, and
 * only one of them survives the rule: **the script stays the source and BASIC is a VIEW over it.**
 * This is that view. It reads opcodes and renders what they compute.
 *
 *   ★ It works on a STRANGER'S covenant — one pulled off the chain, that no BASIC ever generated.
 *   ★ A BRC stops being a hex blob and becomes a listing.
 *   ★ And it is the only direction that can catch the bug the compiler is meant to prevent, because
 *     it reads what the interpreter will read rather than what the author meant.
 *
 * ── ⚠ WHAT IT CANNOT DO, SAID PLAINLY ──────────────────────────────────────────────────────────────
 * There is no general decompiler from Script to BASIC and there never will be. Script does things BASIC
 * has no words for — byte surgery with CAT and SPLIT, an altstack, a preimage checked against a derived
 * signature — and a language that could express all of it would not be BASIC.
 *
 * So this renders what it can and NAMES what it cannot: an opcode with no BASIC word comes out as a
 * pseudo-function (`SPLIT`, `HASH256`, `NUM2BIN`) which is honest, and an opcode it does not model at
 * all stops the reading and says where. **It never guesses.** A listing that quietly skipped an opcode
 * would be worse than no listing, because it would be believed.
 *
 * ⚠⚠ AND THE OUTPUT IS NOT A SOURCE. Feeding this listing back through the compiler will not reproduce
 * the same bytes — the compiler has its own idioms, and a hand-written script has the author's. It is a
 * READING. Treat it as one.
 */
import { OP, type ScriptChunk } from '@bsv/sdk'

/**
 * An expression: its text, the binding power of its outermost operator, and whether it is SIMPLE.
 *
 * ⚠ THOSE LAST TWO ARE NOT THE SAME QUESTION, and conflating them was a real bug here. `MIN(a, b)`
 * needs no parentheses in any context, so its binding power is the highest there is — but it is a
 * COMPUTATION, and when the script duplicates it, writing it out twice would claim the work happens
 * twice. Only a name or a literal is simple.
 */
interface Val { txt: string; bp: number; simple: boolean }
const atom = (txt: string): Val => ({ txt, bp: 99, simple: true })
const wrap = (v: Val, need: number): string => (v.bp < need ? `(${v.txt})` : v.txt)

/** The same binding powers the compiler parses with, so a round trip reads the way it was written. */
const BPOF: Record<string, number> = {
  'OR': 1, 'AND': 2,
  '=': 3, '<>': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4, '*': 5, '/': 5,
}
const bin = (l: Val, o: string, r: Val): Val => {
  const bp = BPOF[o]
  return { txt: `${wrap(l, bp)} ${o} ${wrap(r, bp + 1)}`, bp, simple: false }
}
const call = (f: string, ...a: Val[]): Val =>
  ({ txt: `${f}(${a.map(v => v.txt).join(', ')})`, bp: 99, simple: false })

/** Script's own number encoding, read back: sign-magnitude, little-endian. */
export function readScriptNum(d: number[]): number {
  if (!d.length) return 0
  let x = 0
  for (let i = d.length - 1; i >= 0; i--) x = x * 256 + (i === d.length - 1 ? d[i] & 0x7f : d[i])
  return (d[d.length - 1] & 0x80) ? -x : x
}

const HEX = (d: number[]): string => d.map(b => b.toString(16).padStart(2, '0')).join('')

/** Opcode number → name, built once from the SDK's own table so it can never drift from it. */
const NAMES: Record<number, string> = (() => {
  const m: Record<number, string> = {}
  for (const [k, v] of Object.entries(OP)) if (typeof v === 'number' && !(v in m)) m[v] = k
  return m
})()

export interface UnbasicOptions {
  /**
   * What the stack already holds when this script starts, bottom first. ★ THIS IS THE WHOLE PRODUCT.
   * The script is the source and these names are annotation over it — give the slots their real names
   * and a covenant reads as a program; leave them out and it reads as `in0`, `in1`, which is still a
   * correct listing and considerably less use.
   */
  stack?: string[]
}

export interface UnbasicResult {
  /** The listing. */
  lines: string[]
  /** What the stack holds at the end, as expressions. */
  stack: string[]
  /** Opcodes reached that this reader does not model — if any, the listing STOPS there. */
  stoppedAt?: string
  /** Things worth a human's attention: unbalanced arms, a depth that is not a constant. */
  warnings: string[]
}

/**
 * ★ Read a script as BASIC.
 *
 * The method is symbolic execution: run the script on a stack of EXPRESSIONS instead of values. What
 * comes back is not a translation of the opcodes one by one — it is what they compute, which is the
 * thing a reader actually wants and the thing an opcode listing hides.
 */
export function unbasic(chunks: ScriptChunk[], opts: UnbasicOptions = {}): UnbasicResult {
  const st: Val[] = (opts.stack ?? []).map(atom)
  const alt: Val[] = []
  const lines: string[] = []
  const warnings: string[] = []
  let depth = 0                                             // indentation, in IF levels
  let temps = 0
  const emit = (s: string): void => { lines.push('  '.repeat(depth) + s) }
  const nextTemp = (): string => `t${++temps}`

  /**
   * ★★ MATERIALISE — and it is a correctness rule, not tidiness.
   *
   * When a value is DUPLICATED, the script computes it ONCE and uses it twice. Rendering the expression
   * inline in both places would say the opposite: it would read as two computations, and on anything
   * expensive that is a lie about what the script costs. So a duplicated expression is given a name and
   * a line of its own, exactly as the author would have written it.
   */
  const materialise = (v: Val): Val => {
    if (v.simple) return v                                  // already a name or a literal
    const t = nextTemp()
    emit(`${t} = ${v.txt}`)
    return atom(t)
  }

  const pop = (): Val => {
    const v = st.pop()
    if (!v) throw new Error('the script reads below the bottom of the stack')
    return v
  }

  /* Branch bookkeeping: the two arms must be reconciled at ENDIF, and where they disagree the reader
     invents the same names the compiler would have. */
  const ifs: Array<{ before: Val[]; thenEnd?: Val[]; thenMark: number; elseMark?: number }> = []

  const ARITH: Record<number, string> = {
    [OP.OP_ADD]: '+', [OP.OP_SUB]: '-', [OP.OP_MUL]: '*', [OP.OP_DIV]: '/',
    [OP.OP_BOOLAND]: 'AND', [OP.OP_BOOLOR]: 'OR',
    [OP.OP_NUMEQUAL]: '=', [OP.OP_NUMNOTEQUAL]: '<>', [OP.OP_LESSTHAN]: '<', [OP.OP_GREATERTHAN]: '>',
    [OP.OP_LESSTHANOREQUAL]: '<=', [OP.OP_GREATERTHANOREQUAL]: '>=',
  }
  /* No BASIC word exists for these, so they are rendered as functions. That is honest — it says what
     the script does without pretending BASIC could have written it. */
  const FN1: Record<number, string> = {
    [OP.OP_ABS]: 'ABS', [OP.OP_NOT]: 'NOT', [OP.OP_NEGATE]: 'NEGATE', [OP.OP_0NOTEQUAL]: 'ISTRUE',
    [OP.OP_BIN2NUM]: 'BIN2NUM', [OP.OP_HASH256]: 'HASH256', [OP.OP_HASH160]: 'HASH160',
    [OP.OP_SHA256]: 'SHA256', [OP.OP_RIPEMD160]: 'RIPEMD160', [OP.OP_SHA1]: 'SHA1',
    [OP.OP_INVERT]: 'INVERT',
  }
  const FN2: Record<number, string> = {
    [OP.OP_MIN]: 'MIN', [OP.OP_MAX]: 'MAX', [OP.OP_CAT]: 'CAT', [OP.OP_NUM2BIN]: 'NUM2BIN',
    [OP.OP_AND]: 'BITAND', [OP.OP_OR]: 'BITOR', [OP.OP_XOR]: 'BITXOR',
    [OP.OP_LSHIFT]: 'LSHIFT', [OP.OP_RSHIFT]: 'RSHIFT',
    /* ⚠ OP_MOD IS NOT EXOTIC HERE. `deriveSigOps` computes s = k⁻¹(e + r·a) mod n — modular arithmetic
       over the curve order, in Script — so every OP_PUSH_TX covenant in this repo contains one. A
       reader that stopped at OP_MOD could not read a single real covenant past its own front door. */
    [OP.OP_MOD]: 'MOD',
  }

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i]
    const c = ch.op
    const name = NAMES[c] ?? `OP_${c}`
    try {
      // ── literals ──────────────────────────────────────────────────────────────────────────────────
      if (ch.data && ch.data.length) {
        /* A short push is almost always a number in this project's covenants; a long one is a hash, a
           key or a preimage, and rendering thirty-two bytes as a decimal would be unreadable. */
        /* ⚠ `&H`, NOT `$` — because the compiler's `$` is already the DIM width sigil, and a reader
           that printed a literal the writer cannot parse is the whole bug this dialect work exists to
           close. `&H` is BASIC's own hex and it round-trips. */
        st.push(atom(ch.data.length <= 6 ? String(readScriptNum(ch.data)) : `&H${HEX(ch.data)}`))
        continue
      }
      if (c === OP.OP_0) { st.push(atom('0')); continue }
      if (c >= OP.OP_1 && c <= OP.OP_16) { st.push(atom(String(c - OP.OP_1 + 1))); continue }
      if (c === OP.OP_1NEGATE) { st.push(atom('-1')); continue }

      // ── the shuffles, which move expressions rather than compute anything ──────────────────────────
      if (c === OP.OP_DUP) { const v = materialise(pop()); st.push(v, v); continue }
      if (c === OP.OP_DROP) { pop(); continue }
      if (c === OP.OP_2DROP) { pop(); pop(); continue }
      if (c === OP.OP_NIP) { const t = pop(); pop(); st.push(t); continue }
      if (c === OP.OP_SWAP) { const b2 = pop(), a2 = pop(); st.push(b2, a2); continue }
      if (c === OP.OP_OVER) { const b2 = pop(), a2 = materialise(pop()); st.push(a2, b2, a2); continue }
      if (c === OP.OP_TUCK) { const b2 = materialise(pop()), a2 = pop(); st.push(b2, a2, b2); continue }
      if (c === OP.OP_ROT) { const c3 = pop(), b3 = pop(), a3 = pop(); st.push(b3, c3, a3); continue }
      if (c === OP.OP_2DUP) {
        const b2 = materialise(pop()), a2 = materialise(pop()); st.push(a2, b2, a2, b2); continue
      }
      if (c === OP.OP_DEPTH) { st.push(atom(String(st.length))); continue }
      if (c === OP.OP_TOALTSTACK) { alt.push(pop()); continue }
      if (c === OP.OP_FROMALTSTACK) {
        const v = alt.pop()
        if (!v) throw new Error('FROMALTSTACK on an empty altstack')
        st.push(v); continue
      }
      /* ⚠ PICK AND ROLL NEED A CONSTANT DEPTH, and in every covenant in this repo they have one — the
         assembler computes it. A depth that is itself computed cannot be followed symbolically, and
         saying so is better than inventing a slot. */
      if (c === OP.OP_PICK || c === OP.OP_ROLL) {
        const d = pop()
        const n = Number(d.txt)
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`${name} at a depth that is itself computed (${d.txt}) — this reader follows ` +
            'constant depths, which is what the assembler produces; a computed one it cannot')
        }
        /* ⚠ AND THIS IS THE MESSAGE THAT MAKES THE TOOL USABLE. Reaching past the bottom does not mean
           the script is wrong — it means the CALLER has not said what the unlocking script pushed. Say
           exactly how many more names are needed rather than refusing with a number nobody can act on. */
        if (n >= st.length) {
          const named = (opts.stack ?? []).length
          throw new Error(`${name} reaches ${n} deep, but only ${st.length} items are on the stack ` +
            `(${named} named by you, the rest pushed by the script itself). Name ${n + 1 - st.length} ` +
            'more, bottom first — those are what the unlocking script puts there')
        }
        const idx = st.length - 1 - n
        if (c === OP.OP_PICK) { const v = materialise(st[idx]); st[idx] = v; st.push(v) }
        else st.push(st.splice(idx, 1)[0])
        continue
      }

      // ── arithmetic ────────────────────────────────────────────────────────────────────────────────
      if (ARITH[c]) { const r = pop(), l = pop(); st.push(bin(l, ARITH[c], r)); continue }
      if (FN1[c]) { st.push(call(FN1[c], pop())); continue }
      if (FN2[c]) { const r = pop(), l = pop(); st.push(call(FN2[c], l, r)); continue }
      if (c === OP.OP_1ADD) { st.push(bin(pop(), '+', atom('1'))); continue }
      if (c === OP.OP_1SUB) { st.push(bin(pop(), '-', atom('1'))); continue }
      if (c === OP.OP_EQUAL) { const r = pop(), l = pop(); st.push(call('SAMEBYTES', l, r)); continue }
      if (c === OP.OP_SIZE) { const v = st[st.length - 1]; st.push(call('SIZE', v)); continue }
      if (c === OP.OP_CHECKSIG) { const k = pop(), s = pop(); st.push(call('CHECKSIG', s, k)); continue }

      /* OP_SPLIT gives TWO values, so both get names — one expression cannot stand for two results
         without claiming the work happens twice. */
      if (c === OP.OP_SPLIT) {
        const n = pop(), v = pop()
        const l = nextTemp(), r = nextTemp()
        emit(`${l}, ${r} = SPLIT(${v.txt}, ${n.txt})`)
        st.push(atom(l), atom(r)); continue
      }

      // ── the statements ────────────────────────────────────────────────────────────────────────────
      /* ⚠ OP_IFDUP IS DELIBERATELY NOT HANDLED, and it is the clearest case of the rule. It duplicates
         only when the value is non-zero, so the stack DEPTH becomes data-dependent — and a reader that
         works by walking the stack cannot follow a stack whose height depends on a number it does not
         have. It falls through and stops, which is the truthful answer. */
      if (c === OP.OP_3DUP) {
        const c3 = materialise(pop()), b3 = materialise(pop()), a3 = materialise(pop())
        st.push(a3, b3, c3, a3, b3, c3); continue
      }
      if (c === OP.OP_2OVER) {
        const d4 = pop(), c4 = pop(), b4 = materialise(pop()), a4 = materialise(pop())
        st.push(a4, b4, c4, d4, a4, b4); continue
      }
      if (c === OP.OP_2SWAP) {
        const d4 = pop(), c4 = pop(), b4 = pop(), a4 = pop(); st.push(c4, d4, a4, b4); continue
      }
      if (c === OP.OP_2ROT) {
        const f6 = pop(), e6 = pop(), d6 = pop(), c6 = pop(), b6 = pop(), a6 = pop()
        st.push(c6, d6, e6, f6, a6, b6); continue
      }
      if (c === OP.OP_WITHIN) {
        const hi = pop(), lo = pop(), x = pop(); st.push(call('WITHIN', x, lo, hi)); continue
      }
      /* ⚠ THE SDK'S TABLE DOES NOT CARRY OP_REVERSEBYTES, so its number is written here from the BSV
         opcode table. It is READ ONLY — the compiler will not emit a word whose value this file cannot
         check against the interpreter, because a wrong opcode emitted is worse than one not offered. */
      if (c === 0xbc) { st.push(call('REVERSE', pop())); continue }

      if (c === OP.OP_VERIFY) { emit(`VERIFY ${pop().txt}`); continue }
      if (c === OP.OP_EQUALVERIFY) {
        const r = pop(), l = pop(); emit(`VERIFY ${call('SAMEBYTES', l, r).txt}`); continue
      }
      /* ⚠ NUMEQUALVERIFY IS NOT EQUALVERIFY. One compares NUMBERS and the other compares BYTE STRINGS,
         so `0`, `-0` and a zero padded to four bytes answer differently. Rendering them as the same
         word would erase a distinction that has cost this project a day. */
      if (c === OP.OP_NUMEQUALVERIFY) {
        const r = pop(), l = pop(); emit(`VERIFY ${bin(l, '=', r).txt}`); continue
      }
      if (c === OP.OP_CHECKSIGVERIFY) {
        const k = pop(), s = pop(); emit(`VERIFY ${call('CHECKSIG', s, k).txt}`); continue
      }
      if (c === OP.OP_RETURN) { emit('STOP'); continue }
      if (c === OP.OP_NOP) continue

      if (c === OP.OP_IF || c === OP.OP_NOTIF) {
        const cond = pop()
        emit(`IF ${c === OP.OP_NOTIF ? `NOT(${cond.txt})` : cond.txt} THEN`)
        ifs.push({ before: st.slice(), thenMark: lines.length })
        depth++
        continue
      }
      if (c === OP.OP_ELSE) {
        const f = ifs[ifs.length - 1]
        if (!f) throw new Error('ELSE with no IF')
        f.thenEnd = st.slice()
        st.length = 0; st.push(...f.before)
        depth--; emit('ELSE'); depth++
        f.elseMark = lines.length
        continue
      }
      if (c === OP.OP_ENDIF) {
        const f = ifs.pop()
        if (!f) throw new Error('ENDIF with no IF')
        depth--
        const thenArm = f.thenEnd ?? f.before
        /* ⚠⚠ THE CHECK THAT JUSTIFIES READING A SCRIPT THIS WAY. Both arms of an OP_IF must leave the
           stack the same shape, and when they do not, the script is broken in a way that surfaces
           hundreds of opcodes later as a size complaint — the exact bug the compiler's branch balancing
           exists to prevent. Here it is visible at the ENDIF, in the listing, by name. */
        /* ⚠⚠ …BUT ONLY IF SOMETHING COMES AFTER IT, and the first version of this cried wolf on the
           shipped shell. Its burn arm clears the whole stack and pushes OP_1 while the ordinary arm
           leaves fourteen items with a boolean on top — and that is CORRECT, because that ENDIF is the
           last opcode in the script and all Script asks for is a truthy top. Uneven arms are only a bug
           when a later opcode reads a depth across them. A tool that raises a false alarm on working
           mainnet code is worse than no tool, because the next real alarm gets ignored too. */
        if (thenArm.length !== st.length && i !== chunks.length - 1) {
          warnings.push(`⚠ the arms of the IF at line ${f.thenMark} leave DIFFERENT stack depths ` +
            `(then ${thenArm.length}, else ${st.length}), and ${chunks.length - 1 - i} opcode(s) follow ` +
            'this ENDIF — every depth they read is computed against a stack that only one arm produced')
        }
        /* Where the arms agree, keep the expression. Where they differ, they are two values of one
           thing, so give it a name and assign it in both arms — the inverse of what the compiler does
           when it balances them. */
        const merged: Val[] = []
        const pad = '  '.repeat(depth + 1), pad0 = '  '.repeat(depth)
        const thenIns: string[] = [], elseIns: string[] = [], preIns: string[] = []
        const used = new Set<string>()
        const n = Math.min(thenArm.length, st.length)
        for (let k = 0; k < n; k++) {
          const a2 = thenArm[k], b2 = st[k]
          if (a2.txt === b2.txt) { merged.push(a2); continue }
          /* ★★ IF THE SLOT ALREADY HAD A NAME, REUSE IT — it is that variable being reassigned, not a
             new one. Inventing `t1` here made the listing say something subtly false AND made it
             impossible to recompile, because the compiler rightly refuses a variable that exists only
             inside an arm. Reusing the name turns the listing back into what was written:

                 IF a > b THEN        p = 1        ← the arm that changes it
                                      q = q        ← and the balancing assignment, made visible
                 ELSE                 p = p
                                      q = 2 */
          /* ⚠ AND THE NAME IS NOT AT THIS INDEX. Balancing leaves the merged values ABOVE the slots
             they came from, so `f.before[k]` is the wrong place to look — it was, and the reuse never
             fired. The name is in the ARMS: where one arm assigns a constant and the other passes the
             old value through, that pass-through IS the variable's name. */
          const cand = [a2, b2].find(v => v.simple && !/^-?\d+$/.test(v.txt) && !v.txt.startsWith('&H')
            && f.before.some(q => q.txt === v.txt))
          let t: string
          if (cand && !used.has(cand.txt)) t = cand.txt
          else {
            /* Nothing to reuse, so it needs a name BEFORE the branch — a value that exists only inside
               an arm is exactly what the compiler refuses, and it is right to. Both arms assign it, so
               whatever it starts as is never read. */
            t = nextTemp()
            preIns.push(`${t} = ${k < f.before.length ? f.before[k].txt : '0'}`)
          }
          used.add(t)
          thenIns.push(`${pad}${t} = ${a2.txt}`)
          elseIns.push(`${pad}${t} = ${b2.txt}`)
          merged.push(atom(t))
        }
        /* ⚠ THE LATER INSERTION FIRST, or its index is invalidated by the earlier one. The else arm's
           assignments go at the very end of that arm — which is here, before END IF is written — and
           the then arm's go immediately BEFORE the ELSE line, which sits one index below `elseMark`. */
        /* ⚠ HIGHEST INDEX FIRST, or each insertion invalidates the ones below it: the end of the else
           arm, then just above the ELSE line, then just above the IF line. */
        if (thenIns.length) {
          lines.push(...elseIns)
          /* ⚠⚠ A PRE-DECLARATION HOISTS TO THE OUTERMOST IF, not to this one. Declared just inside an
             enclosing arm it would exist only on that path — the same defect one level up, and the
             compiler refuses it with the same message. Nested branches were failing on exactly this. */
          const hoist = (ifs.length ? ifs[0].thenMark : f.thenMark) - 1
          if (f.elseMark !== undefined) {
            lines.splice(f.elseMark - 1, 0, ...thenIns)
            if (preIns.length) lines.splice(hoist, 0, ...preIns)
          } else {
            /* An IF with no ELSE still changed something, so the other arm has to say what it leaves.
               The script did not write an ELSE; the READING needs one to be truthful. */
            lines.splice(lines.length - elseIns.length, 0, ...thenIns, `${pad0}ELSE`)
            if (preIns.length) lines.splice(hoist, 0, ...preIns)
          }
        }
        st.length = 0; st.push(...merged)
        emit('END IF')
        continue
      }

      // ── and anything else stops the reading, by name ───────────────────────────────────────────────
      return {
        lines, stack: st.map(v => v.txt), warnings,
        stoppedAt: `${name} at opcode ${i} — this reader does not model it, and guessing what it leaves ` +
          'on the stack would make every line after it fiction',
      }
    } catch (e) {
      return {
        lines, stack: st.map(v => v.txt), warnings,
        stoppedAt: `${name} at opcode ${i}: ${(e as Error).message}`,
      }
    }
  }
  /* ★★ A PROGRAM WHOSE RESULT IS LEFT ON THE STACK STILL NEEDS A LINE FOR IT.
     Without this, `x = a + b` reads back as an EMPTY listing with the answer buried in a trailing
     comment — true, and useless, and impossible to recompile. Naming what is left is what the author
     would have written, and it is what turns the reading into something that goes back the other way. */
  for (let k = 0; k < st.length; k++) if (!st[k].simple) st[k] = materialise(st[k])
  if (ifs.length) warnings.push(`⚠ ${ifs.length} IF(s) never closed by an ENDIF`)
  for (const v of alt) warnings.push(`⚠ left on the altstack: ${v.txt}`)
  return { lines, stack: st.map(v => v.txt), warnings }
}

/** Render a full listing, numbered the way BASIC always was. */
export function unbasicListing(chunks: ScriptChunk[], opts: UnbasicOptions = {}): string {
  const r = unbasic(chunks, opts)
  const out = r.lines.map((l, i) => `${String((i + 1) * 10).padStart(5)} ${l}`)
  if (r.stack.length) {
    out.push('', 'REM  left on the stack, top last:')
    r.stack.forEach((s, i) => out.push(`REM    [${i}] ${s}`))
  }
  if (r.warnings.length) { out.push(''); r.warnings.forEach(w => out.push(`REM  ${w}`)) }
  if (r.stoppedAt) out.push('', `REM  ⚠ STOPPED: ${r.stoppedAt}`)
  return out.join('\n')
}
