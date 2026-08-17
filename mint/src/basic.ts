// © BSV Association — Open BSV License v6.
/**
 * ★★ BASIC → BITCOIN SCRIPT — a translator, v0.
 *
 * sun-dive, 16 August 2026, on reading the racer's physics: *"I realised today the BASIC under the hood
 * is something like Bitcoin Script."* He is right, and it is not a metaphor:
 *
 *   BASIC line     110  V = V + F/M - V*D
 *   under the hood      V  F  M  /  +  V  D  *  −          ← postfix, on a stack
 *   Script              OP_DIV OP_ADD … OP_MUL OP_SUB      ← the same sequence, executed by miners
 *
 * Every infix language has a stack machine underneath. Script is what BASIC's expression evaluator
 * looks like with the front end deleted. This puts the front end back.
 *
 * ── ⚠ WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 * It is a TRANSLATOR, not a source of truth. `~/Documents/script-editor-spec.md` §0 holds that the
 * SCRIPT is the source and names are annotation over it — because the bugs this project actually gets
 * (a depth off by one, branch arms that disagree, an altstack out of step) do not exist in a
 * high-level language and are invisible to a tool that only looks there. Nothing here contradicts
 * that: BASIC goes in, script comes out, and the SCRIPT is what you keep, review and ship.
 *
 * ── ★ WHY BASIC FITS WHERE C OR JS WOULD NOT ──────────────────────────────────────────────────────
 * Its limitations are Script's limitations. No recursion, no closures, no dynamic allocation, no scope
 * games. Compiling a modern language means constantly refusing things; compiling BASIC means saying
 * yes. It is also the language a Spectrum stored as ONE TOKEN PER KEYWORD — bytecode you read back as
 * words, which is what a locking script is.
 *
 * ── ★★ AND THE ONE THING IT DOES THAT IS WORTH THE WHOLE EXERCISE ─────────────────────────────────
 * **It balances the branch arms.** In hand-written Script both arms of an `OP_IF` must leave the stack
 * identical, and getting that wrong is silent — it surfaces two hundred opcodes later as `OP_SPLIT`
 * complaining about a size. `shellPhysicsOps` does it by hand, carefully, every time. Here the
 * compiler computes the union of everything either arm assigns and makes both produce all of it.
 * A whole bug class stops being possible rather than becoming less likely.
 *
 * ── ★★ AND THE SECOND ONE: THE COMPILER IS THE LOOP ───────────────────────────────────────────────
 * Script has no backward jump, so a program's LENGTH is its work. `FOR … NEXT` with a constant bound
 * does not need one — the body is laid down once per trip with the counter folded in as a literal, and
 * forty-five ticks that would have been forty-five transactions become one. See `unrollFor`, and see
 * `coalesce` for the thing that had to be fixed before any of it was possible.
 */
import { OP, type ScriptChunk } from '@bsv/sdk'
import { Asm, fixedField, op, PN } from './covenantAsm.ts'

/** 1.0 in this project's fixed point — 2^32, the battery's convention and the shell's. */
export const BASIC_S = 2 ** 32

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────────
type Tok = { k: 'num' | 'name' | 'op' | 'kw' | 'eol'; v: string; n?: number }

const KEYWORDS = new Set([
  'LET', 'IF', 'THEN', 'ELSE', 'REM', 'AND', 'OR', 'NOT',
  'FOR', 'TO', 'STEP', 'NEXT', 'DIM',
])

/**
 * ⚠ CASE-INSENSITIVE KEYWORDS, CASE-SENSITIVE NAMES. `IF`/`if` are the same word; `v` and `V` are not
 * the same variable, because the stack model they resolve against is the covenant's own naming and that
 * is case-sensitive. Mixing those two rules is how a name silently resolves to the wrong slot.
 */
function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    /* ⚠⚠ THE NEWLINE IS A TOKEN, AND LEAVING IT OUT WAS A REAL BUG. In BASIC an `IF … THEN … ELSE …`
       is LINE-SCOPED: the arms end where the line does. Discard newlines and the ELSE arm silently
       swallows every following statement — measured here, where `nv = …` on the next line was parsed
       as part of the ELSE and then reported as "assigned inside an IF". The parser was wrong and the
       error message was right about what it saw. */
    if (c === '\n') {
      if (out.length && out[out.length - 1].k !== 'eol') out.push({ k: 'eol', v: '\n' })
      i++; continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === "'") { while (i < src.length && src[i] !== '\n') i++; continue }        // ' comment
    if (/[0-9]/.test(c)) {
      let j = i; while (j < src.length && /[0-9._]/.test(src[j])) j++
      const raw = src.slice(i, j).replace(/_/g, '')
      out.push({ k: 'num', v: raw, n: Number(raw) }); i = j; continue
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      const w = src.slice(i, j)
      const up = w.toUpperCase()
      if (up === 'REM') { while (i < src.length && src[i] !== '\n') i++; continue }
      out.push(KEYWORDS.has(up) ? { k: 'kw', v: up } : { k: 'name', v: w })
      i = j; continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ k: 'op', v: two }); i += 2; continue }
    /* ⚠ `%` and `$` are BASIC's own sigils and they are NOT operators here — there is no modulo in this
       language yet, and adding one later must not quietly re-read every `DIM v%5` as an expression. */
    if ('+-*/()<>=,:%$'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue }
    throw new Error(`BASIC: what is ${JSON.stringify(c)}? (at ${i})`)
  }
  return out
}

// ── the parser: precedence climbing, which IS the shunting yard in recursive form ────────────────────
type Expr =
  | { t: 'num'; v: number }
  | { t: 'var'; v: string }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'call'; f: string; a: Expr[] }
  | { t: 'neg'; e: Expr }

/** Binding power. Comparisons bind loosest, then + −, then * /, exactly as BASIC has always had it. */
const BP: Record<string, number> = {
  'OR': 1, 'AND': 2,
  '=': 3, '<>': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5,
}

/* ⚠ Plain fields, not a parameter property — this repo runs TypeScript through node's strip-only mode,
   which erases types and refuses anything that would need CODE generated for it. */
class Parser {
  private p = 0
  private t: Tok[]
  constructor(t: Tok[]) { this.t = t }
  peek(): Tok | undefined { return this.t[this.p] }
  /** One token further on — needed only to tell `NEXT i` from `NEXT` followed by `i = …`. */
  peekAt(k: number): Tok | undefined { return this.t[this.p + k] }
  next(): Tok | undefined { return this.t[this.p++] }
  eat(v: string): boolean {
    const t = this.peek()
    if (t && (t.v === v)) { this.p++; return true }
    return false
  }
  expect(v: string): void { if (!this.eat(v)) throw new Error(`BASIC: expected ${v}, found ${this.peek()?.v ?? 'end'}`) }
  atEnd(): boolean { return this.p >= this.t.length }

  expr(min = 0): Expr {
    let left = this.atom()
    for (;;) {
      const t = this.peek()
      if (!t || (t.k !== 'op' && t.k !== 'kw')) break
      const bp = BP[t.v]
      if (bp === undefined || bp < min) break
      this.next()
      const right = this.expr(bp + 1)                    // left-associative
      left = { t: 'bin', op: t.v, l: left, r: right }
    }
    return left
  }

  atom(): Expr {
    const t = this.next()
    if (!t) throw new Error('BASIC: expression ended early')
    if (t.k === 'num') return { t: 'num', v: t.n! }
    if (t.v === '-') return { t: 'neg', e: this.atom() }
    if (t.v === '(') { const e = this.expr(); this.expect(')'); return e }
    if (t.k === 'name') {
      if (this.eat('(')) {
        const args: Expr[] = []
        if (!this.eat(')')) {
          do { args.push(this.expr()) } while (this.eat(','))
          this.expect(')')
        }
        return { t: 'call', f: t.v.toUpperCase(), a: args }
      }
      return { t: 'var', v: t.v }
    }
    throw new Error(`BASIC: ${t.v} cannot start an expression`)
  }
}

// ── statements ───────────────────────────────────────────────────────────────────────────────────────
type Stmt =
  | { t: 'let'; name: string; e: Expr }
  | { t: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] }
  | { t: 'for'; name: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
  | { t: 'dim'; fields: Field[] }

/**
 * ★★ A FIELD IS A LAYOUT, NOT A TYPE — which is the whole idea behind `DIM`.
 *
 * `DIM v%5` does not say "v is an integer". It says **v occupies five bytes of this script**, because a
 * covenant carries its state as fixed-width pushes inside its own locking script and reads them back by
 * splitting its own scriptCode at CONSTANT offsets. The width is what sets those offsets. Get one wrong
 * and every field after it moves — silently, because the split still succeeds on the wrong boundary.
 */
export interface Field {
  name: string
  /** Bytes in the script. */
  width: number
  /** `name$n` — raw bytes, never converted. `name%n` — a number, BIN2NUM in and NUM2BIN out. */
  bytes: boolean
}

/**
 * `lineScoped` is what makes an IF behave like BASIC's: its arms end at the end of the line. At the top
 * level newlines are just separators and parsing carries on.
 */
function parseStmts(p: Parser, stopAt: string[], lineScoped = false): Stmt[] {
  const out: Stmt[] = []
  for (;;) {
    p.eat(':')
    let t = p.peek()
    if (t && t.k === 'eol') {
      if (lineScoped) break                              // ← the IF's arm ends here
      while (p.peek()?.k === 'eol') p.next()
      t = p.peek()
    }
    if (!t) break
    if (t.k === 'kw' && stopAt.includes(t.v)) break
    /* ★★ A LEADING NUMBER IS A LINE NUMBER, and refusing it was refusing BASIC.
       Every machine this language was learned on wanted `10 LET V = 5`, and typing it that way is
       muscle memory rather than a mistake — the first person to use this hit it immediately. There is
       no GOTO here, so the number labels nothing and is discarded.
       ⚠ NOT inside an IF arm. `IF x THEN 100` has meant GOTO 100 since 1964, and this compiler cannot
       do that — so there it must stay an error rather than being silently swallowed. */
    if (!lineScoped && t.k === 'num') { p.next(); continue }
    if (t.k === 'kw' && t.v === 'LET') { p.next(); out.push(letStmt(p)); continue }
    if (t.k === 'kw' && t.v === 'IF') { p.next(); out.push(ifStmt(p)); continue }
    if (t.k === 'kw' && t.v === 'FOR') {
      /* ⚠ A FOR SPANS LINES AND AN IF ARM DOES NOT — so a FOR opened inside one would have to end
         somewhere its own arm has already closed. Refusing says so; letting it through would parse
         something nobody wrote. Put the FOR on its own line, with the IF inside it. */
      if (lineScoped) {
        throw new Error('BASIC: a FOR cannot open inside an IF arm — an IF is line-scoped, so its arms ' +
          'end where the line does, and a FOR does not. Put the FOR on its own line.')
      }
      p.next(); out.push(forStmt(p)); continue
    }
    if (t.k === 'kw' && t.v === 'NEXT') throw new Error('BASIC: a NEXT with no FOR to close')
    if (t.k === 'kw' && t.v === 'DIM') {
      if (lineScoped) throw new Error('BASIC: DIM declares the script\'s layout — it cannot sit inside an IF')
      p.next(); out.push(dimStmt(p)); continue
    }
    if (t.k === 'name') { out.push(letStmt(p)); continue }       // LET is optional, as it always was
    throw new Error(`BASIC: ${t.v} cannot start a statement`)
  }
  return out
}

function letStmt(p: Parser): Stmt {
  const n = p.next()
  if (!n || n.k !== 'name') throw new Error('BASIC: LET wants a variable name')
  p.expect('=')
  return { t: 'let', name: n.v, e: p.expr() }
}

function ifStmt(p: Parser): Stmt {
  const cond = p.expr()
  p.expect('THEN')
  const thn = parseStmts(p, ['ELSE'], true)
  const els = p.eat('ELSE') ? parseStmts(p, [], true) : []
  return { t: 'if', cond, then: thn, else: els }
}

/**
 * `DIM v%5, tag$20` — declare the state layout, in order, widths in BYTES.
 *
 * ⚠ 1 TO 75. A field is pushed with a one-byte length prefix, and the peel drops exactly one byte
 * before each field while the rebuild writes exactly one back. At 76 the push becomes OP_PUSHDATA1,
 * that arithmetic silently changes, and every offset after it moves — so it is refused here instead.
 */
function dimStmt(p: Parser): Stmt {
  const fields: Field[] = []
  do {
    const n = p.next()
    if (!n || n.k !== 'name') throw new Error('BASIC: DIM wants a name — DIM v%5')
    const sig = p.next()
    if (!sig || (sig.v !== '%' && sig.v !== '$')) {
      throw new Error(`BASIC: DIM ${n.v} needs a WIDTH — ${n.v}%5 for a five-byte number, ${n.v}$20 for ` +
        'twenty raw bytes. A field is a layout, and a layout has a size.')
    }
    const w = p.next()
    if (!w || w.k !== 'num' || !Number.isInteger(w.n) || w.n! < 1 || w.n! > 75) {
      throw new Error(`BASIC: DIM ${n.v} — the width must be a whole number of bytes from 1 to 75 ` +
        '(above 75 a push needs OP_PUSHDATA1, which moves every offset after it)')
    }
    fields.push({ name: n.v, width: w.n!, bytes: sig.v === '$' })
  } while (p.eat(','))
  return { t: 'dim', fields }
}

/**
 * `FOR i = <from> TO <to> [STEP <s>] … NEXT [i]` — a loop that exists only at compile time.
 *
 * Unlike an IF, the body runs to `NEXT` however many lines that takes: a FOR is the one construct here
 * that is NOT line-scoped, because BASIC's never was.
 */
function forStmt(p: Parser): Stmt {
  const n = p.next()
  if (!n || n.k !== 'name') throw new Error('BASIC: FOR wants a counter name — FOR i = 0 TO 9')
  p.expect('=')
  const from = p.expr()
  p.expect('TO')
  const to = p.expr()
  const step = p.eat('STEP') ? p.expr() : null
  const body = parseStmts(p, ['NEXT'])
  if (!p.eat('NEXT')) throw new Error(`BASIC: FOR ${n.v} is never closed by a NEXT`)
  /* `NEXT i` names the loop it closes, and BASIC always allowed a bare `NEXT` too. ⚠ Only swallow the
     name when it cannot be the start of the next statement — `NEXT` then `i = 1` on one line is legal. */
  const after = p.peek()
  if (after && after.k === 'name' && p.peekAt(1)?.v !== '=') {
    p.next()
    if (after.v !== n.v) throw new Error(`BASIC: NEXT ${after.v} closes a FOR ${after.v}, but the open loop is ${n.v}`)
  }
  return { t: 'for', name: n.v, from, to, step, body }
}

// ── emission ─────────────────────────────────────────────────────────────────────────────────────────
export interface BasicEnv {
  /** The stack as it stands when this program starts — bottom first, the same list `Asm` takes. */
  stack: string[]
  /** Named constants, substituted at compile time. Regulations belong here. */
  consts?: Record<string, number>
  /**
   * ⚠ THE UNROLL FUSE. A `FOR` emits its body once per trip, so one wrong bound is not a slow program —
   * it is gigabytes of script, or a hang. This refuses long before either. Raise it deliberately.
   */
  maxOps?: number
}

export interface BasicResult {
  ops: ScriptChunk[]
  /** The stack model afterwards, so a caller can carry on emitting by hand. */
  stack: string[]
  /** Every variable the program assigned, in first-assignment order. */
  assigned: string[]
  /** How many loop bodies were laid down — 0 if the program has no FOR. The unroll, made countable. */
  unrolled: number
}

/* The comparison words, and OP_NUMEQUAL rather than OP_EQUAL — these are NUMBERS, and OP_EQUAL compares
   byte strings, so `0` and `-0` and a padded `0` would answer differently. That distinction has cost
   this project a day before. */
const CMP: Record<string, number> = {
  '=': OP.OP_NUMEQUAL, '<>': OP.OP_NUMNOTEQUAL,
  '<': OP.OP_LESSTHAN, '>': OP.OP_GREATERTHAN,
  '<=': OP.OP_LESSTHANOREQUAL, '>=': OP.OP_GREATERTHANOREQUAL,
}
const ARITH: Record<string, number> = {
  '+': OP.OP_ADD, '-': OP.OP_SUB, '*': OP.OP_MUL, '/': OP.OP_DIV,
  'AND': OP.OP_BOOLAND, 'OR': OP.OP_BOOLOR,
}

/**
 * ★ Compile a BASIC program against a stack that already exists.
 *
 * ⚠ `env.stack` is not decoration — a covenant's variables ARE stack slots, and the compiler resolves a
 * name to a depth through `Asm`, which computes it rather than trusting anyone's count.
 */
function emitProgram(
  prog: Stmt[], a: Asm, consts: Record<string, number>, maxOps: number,
): { assigned: string[]; unrolled: number } {
  const assigned: string[] = []
  /** FOR counters. Inside their body a counter is a COMPILE-TIME CONSTANT, never a stack slot. */
  const loopVars = new Map<string, bigint>()
  let unrolled = 0
  /** How many OP_IFs deep we are — `coalesce` is only safe at zero. See its note. */
  let branchDepth = 0

  /** trunc(x·y / 2^32) — the project's fixed-point multiply, as one word. */
  const fmul = (): void => { a.o(OP.OP_MUL, 2, ['_p']); a.num(BASIC_S); a.o(OP.OP_DIV, 2, ['_q']) }
  /** trunc(x·2^32 / y) — scaled BEFORE dividing, or the precision is gone before the division happens. */
  const fdiv = (): void => { a.num(BASIC_S); a.o(OP.OP_MUL, 2, ['_p']); a.o(OP.OP_DIV, 2, ['_q']) }

  /**
   * ⚠ FOLDED IN BigInt, AND THAT IS THE WHOLE REASON IT IS ALLOWED. BigInt division truncates toward
   * zero and so does `OP_DIV`; a double does neither past 2^53. Folding in doubles would put a constant
   * in the script that quietly disagrees with the chain — the one bug this file must never introduce.
   */
  const divz = (l: bigint, r: bigint): bigint => {
    if (r === 0n) throw new Error('BASIC: a division by zero the compiler can already see — the spend would fail')
    return l / r
  }
  const SAFE = BigInt(Number.MAX_SAFE_INTEGER)
  const SB = BigInt(BASIC_S)

  /** The value of an expression if it is knowable NOW, or undefined if any leaf is on the stack. */
  function constEval(e: Expr): bigint | undefined {
    switch (e.t) {
      case 'num': return BigInt(Math.round(e.v))
      case 'var': {
        const lv = loopVars.get(e.v)
        if (lv !== undefined) return lv
        if (Object.prototype.hasOwnProperty.call(consts, e.v)) return BigInt(Math.round(consts[e.v]))
        return undefined
      }
      case 'neg': { const x = constEval(e.e); return x === undefined ? undefined : -x }
      case 'bin': {
        const l = constEval(e.l), r = constEval(e.r)
        if (l === undefined || r === undefined) return undefined
        switch (e.op) {
          case '+': return l + r
          case '-': return l - r
          case '*': return l * r
          case '/': return divz(l, r)
          /* ⚠ These must answer exactly what the opcode answers: OP_BOOLAND is "both non-zero", not a
             bitwise and, and a comparison yields 1 or 0 — not the operands. */
          case 'AND': return (l !== 0n && r !== 0n) ? 1n : 0n
          case 'OR': return (l !== 0n || r !== 0n) ? 1n : 0n
          case '=': return l === r ? 1n : 0n
          case '<>': return l !== r ? 1n : 0n
          case '<': return l < r ? 1n : 0n
          case '>': return l > r ? 1n : 0n
          case '<=': return l <= r ? 1n : 0n
          case '>=': return l >= r ? 1n : 0n
        }
        return undefined
      }
      case 'call': {
        const vs = e.a.map(constEval)
        if (vs.some(v => v === undefined)) return undefined
        const v = vs as bigint[]
        switch (e.f) {
          case 'MIN': return v.length === 2 ? (v[0] < v[1] ? v[0] : v[1]) : undefined
          case 'MAX': return v.length === 2 ? (v[0] > v[1] ? v[0] : v[1]) : undefined
          case 'ABS': return v.length === 1 ? (v[0] < 0n ? -v[0] : v[0]) : undefined
          case 'NOT': return v.length === 1 ? (v[0] === 0n ? 1n : 0n) : undefined
          case 'FMUL': return v.length === 2 ? divz(v[0] * v[1], SB) : undefined
          case 'FDIV': return v.length === 2 ? divz(v[0] * SB, v[1]) : undefined
        }
        return undefined
      }
    }
  }

  function emit(e: Expr): void {
    /* ★ CONSTANT FOLDING, and in an unrolled loop it is not decoration. The counter is substituted into
       every copy of the body, so `i * 3 + 1` is a whole subtree that is known at compile time on each of
       the forty-five copies — three opcodes each, or one push. ⚠ Only inside the safe-integer range:
       past it `snum` counts in doubles, so beyond that the ops are emitted and Script does it exactly. */
    const k = constEval(e)
    if (k !== undefined && k <= SAFE && k >= -SAFE) { a.num(Number(k)); return }
    switch (e.t) {
      case 'num': a.num(Math.round(e.v)); return
      case 'var': {
        if (loopVars.has(e.v)) {
          throw new Error(`BASIC: the FOR counter ${e.v} has reached ${loopVars.get(e.v)}, which is past ` +
            'what this compiler will push as a literal')
        }
        if (Object.prototype.hasOwnProperty.call(consts, e.v)) { a.num(Math.round(consts[e.v])); return }
        a.pick(e.v, '_t')                                  // ⚠ throws by NAME if it is not on the stack
        return
      }
      case 'neg': a.num(0); emit(e.e); a.bin(OP.OP_SUB, '_t'); return
      case 'bin': {
        emit(e.l); emit(e.r)
        if (ARITH[e.op] !== undefined) { a.bin(ARITH[e.op], '_t'); return }
        if (CMP[e.op] !== undefined) { a.bin(CMP[e.op], '_t'); return }
        throw new Error(`BASIC: no opcode for ${e.op}`)
      }
      case 'call': {
        const f = e.f
        const need = (n: number): void => {
          if (e.a.length !== n) throw new Error(`BASIC: ${f} takes ${n} argument(s), got ${e.a.length}`)
        }
        if (f === 'MIN' || f === 'MAX') {
          need(2); emit(e.a[0]); emit(e.a[1])
          a.bin(f === 'MIN' ? OP.OP_MIN : OP.OP_MAX, '_t'); return
        }
        if (f === 'ABS') { need(1); emit(e.a[0]); a.o(OP.OP_ABS, 1, ['_t']); return }
        if (f === 'NOT') { need(1); emit(e.a[0]); a.o(OP.OP_NOT, 1, ['_t']); return }
        if (f === 'FMUL') { need(2); emit(e.a[0]); emit(e.a[1]); fmul(); a.rename('_t'); return }
        if (f === 'FDIV') { need(2); emit(e.a[0]); fdiv0(e.a[1]); return }
        throw new Error(`BASIC: no such word — ${f}`)
      }
    }
  }
  /* FDIV(x, y) = trunc(x·2^32 / y): x must be scaled BEFORE y arrives, so the argument order on the
     stack is x · 2^32 · MUL · y · DIV rather than the plain left-then-right of the others. */
  function fdiv0(divisor: Expr): void {
    a.num(BASIC_S); a.o(OP.OP_MUL, 2, ['_p'])
    emit(divisor)
    a.o(OP.OP_DIV, 2, ['_t'])
  }

  /** Which variables a block assigns — needed BEFORE emitting either arm, to balance them. */
  function assignedBy(ss: Stmt[], into: Set<string>): void {
    for (const s of ss) {
      if (s.t === 'let') into.add(s.name)
      else if (s.t === 'for') assignedBy(s.body, into)
      else if (s.t === 'dim') continue
      else { assignedBy(s.then, into); assignedBy(s.else, into) }
    }
  }

  /**
   * ★★ RE-ASSIGNMENT THAT DOES NOT GROW THE STACK — and unrolling is impossible without it.
   *
   * `Asm.rename` renames the TOP of the model. It does not remove the older slot of the same name, it
   * SHADOWS it — `depth()` uses `lastIndexOf`, so reads stay correct and nothing looks wrong. Assign each
   * variable once, as the car's physics does, and nobody ever notices. Unroll forty-five ticks and every
   * variable leaves a corpse per tick: the stack grows without bound, every OP_PICK offset grows with it,
   * one-byte pushes become two, and the stack handed back to the caller is unusable.
   *
   * So the stale slot is rolled out and dropped — about three bytes, and the depth is constant forever.
   *
   * ⚠ ONLY OUTSIDE A BRANCH. `armReturn` drops everything above the arm's entry baseline, measured by
   * length; pulling a value out from UNDER that baseline would make it drop one item too many, into the
   * caller's own stack. Inside a branch the leak is bounded by the arm and the ENDIF collects it anyway.
   */
  function coalesce(name: string): void {
    if (branchDepth > 0) return
    for (;;) {
      const stale = a.st.indexOf(name)
      if (stale < 0 || stale === a.st.lastIndexOf(name)) return
      /* ★ The hot case is one byte. `s = s + 1` leaves the new value directly on top of the old one, so
         the stale slot is at depth 1 — which is the entire job of OP_NIP, against four bytes to roll. In
         a loop unrolled forty-five times that difference is the loop's own overhead. */
      if (a.st.length - 1 - stale === 1) { a.raw(op(OP.OP_NIP), 0, []); a.st.splice(stale, 1); continue }
      a.raw(PN(a.st.length - 1 - stale), 0, ['_d'])
      a.raw(op(OP.OP_ROLL), 1, [])
      a.st.splice(stale, 1); a.st.push('_stale')
      a.o(OP.OP_DROP, 1, [])
    }
  }

  function run(ss: Stmt[]): void {
    for (const s of ss) {
      if (s.t === 'let') {
        /* ⚠ Assigning over a compile-time constant would be silent and wrong: the write lands on the
           stack, every later read still resolves to the constant, and the two never meet. */
        if (Object.prototype.hasOwnProperty.call(consts, s.name)) {
          throw new Error(`BASIC: ${s.name} is a compile-time constant and cannot be assigned`)
        }
        if (loopVars.has(s.name)) {
          throw new Error(`BASIC: ${s.name} is a FOR counter — it is a constant inside the loop body, ` +
            'because the loop is laid down at compile time and there is nothing left to increment')
        }
        emit(s.e)
        a.rename(s.name)                                   // the value on top now answers to this name
        coalesce(s.name)                                   // …and the previous value of that name is gone
        if (!assigned.includes(s.name)) assigned.push(s.name)
        continue
      }
      if (s.t === 'for') { unrollFor(s); continue }
      if (s.t === 'dim') {
        throw new Error('BASIC: every DIM must come before the first statement that runs — the layout is ' +
          'fixed before anything can read it, because the offsets it sets are baked into the script')
      }
      /* ── ★★ THE BRANCH, AND THE BALANCING THAT IS THE POINT OF THIS COMPILER ──────────────────────
         Both arms must leave the stack identical or every depth after the ENDIF is wrong — silently.
         So: take the UNION of what either arm assigns, run each arm, and make both `armReturn` that
         same list in the same order. A variable assigned in only one arm still gets produced by the
         other, from its existing value. Hand-written Script has to do this by eye, every time. */
      const names = new Set<string>()
      assignedBy(s.then, names); assignedBy(s.else, names)
      const list = [...names]
      for (const n of list) {
        if (!a.st.includes(n)) {
          throw new Error(`BASIC: ${n} is assigned inside an IF but does not exist before it — ` +
            'give it a value first, or both arms have nothing to agree about')
        }
      }
      emit(s.cond)
      a.ifBegin()
      branchDepth++
      run(s.then)
      if (list.length) a.armReturn(list)
      a.elseArm()
      run(s.else)
      if (list.length) a.armReturn(list)
      branchDepth--
      a.endIf()
      for (const n of list) if (!assigned.includes(n)) assigned.push(n)
      /* The arms left their results ABOVE the entry baseline, so the pre-branch value of each is now a
         stale slot underneath. Outside a branch, that is exactly what `coalesce` is for. */
      for (const n of list) coalesce(n)
    }
  }

  /**
   * ── ★★ FOR … NEXT, UNROLLED AT COMPILE TIME ────────────────────────────────────────────────────────
   *
   * Script has no loop and never will: there is no backward jump, so a program's length IS its work.
   * A loop with a CONSTANT bound does not need one — the compiler is the loop, and lays the body down
   * once per trip with the counter substituted in as a literal.
   *
   * ⚠⚠ AND IT ONLY PAYS FOR A FIXED-COST BODY. A data-dependent trip count cannot be unrolled at all;
   * you emit the WORST case and mask the rest, so an early-exit loop (a Mandelbrot escape, say — 2.8
   * iterations on average against a bound of 128) can come out worse than not unrolling. What unrolling
   * buys is amortising the frame — verify the preimage, peel the fields, rebuild, hash, compare — which
   * every transaction pays whatever its body does. Forty-five ticks in one transaction pay it once.
   */
  function unrollFor(s: Extract<Stmt, { t: 'for' }>): void {
    const what = `FOR ${s.name}`
    if (loopVars.has(s.name)) throw new Error(`BASIC: ${what} is already open — a nested loop needs its own counter`)
    const clash = Object.prototype.hasOwnProperty.call(consts, s.name) ? 'constant'
      : a.st.includes(s.name) ? 'variable' : ''
    if (clash) {
      throw new Error(`BASIC: ${what} would shadow the ${clash} ${s.name} that already exists — a counter ` +
        'quietly hiding a real value is how a name comes to read the wrong thing. Pick another letter.')
    }
    const bound = (e: Expr, which: string): bigint => {
      const v = constEval(e)
      if (v === undefined) {
        throw new Error(`BASIC: ${what} — the ${which} has to be known at COMPILE time. Script has no ` +
          'runtime loop, so the body is laid down trip by trip and the count must be a number now, not ' +
          'a value that will only exist while the script runs.')
      }
      return v
    }
    const from = bound(s.from, 'start'), to = bound(s.to, 'end')
    const step = s.step ? bound(s.step, 'STEP') : 1n
    if (step === 0n) throw new Error(`BASIC: ${what} STEP 0 — a counter that never advances has no trip count`)

    const inner = new Set<string>()
    assignedBy(s.body, inner)
    if (inner.has(s.name)) {
      throw new Error(`BASIC: ${s.name} is the ${what} counter and the loop is unrolled, so inside the ` +
        'body it is a constant. Assigning it would change nothing at all — use another variable.')
    }

    /* ⚠ COUNT THE TRIPS, DO NOT WALK THEM. `FOR i = 0 TO 1000000000` must be refused in a microsecond,
       not discovered after an hour of emitting. The fuse is checked before a single opcode is laid. */
    const span = to - from
    const trips = (step > 0n ? span >= 0n : span <= 0n) ? span / step + 1n : 0n
    if (trips > BigInt(maxOps)) {
      throw new Error(`BASIC: ${what} unrolls ${trips} times, past the fuse of ${maxOps}. Script grows ` +
        'linearly with the work — raise env.maxOps only once you have priced what comes out.')
    }
    /* BASIC has always tested at the top: `FOR i = 1 TO 0` runs the body no times, and here that means
       it emits nothing whatsoever. */
    for (let i = from; step > 0n ? i <= to : i >= to; i += step) {
      loopVars.set(s.name, i)
      run(s.body)
      unrolled++
      if (a.ops.length > maxOps) {
        loopVars.delete(s.name)
        throw new Error(`BASIC: ${what} has laid down ${a.ops.length} opcodes, past the fuse of ${maxOps}`)
      }
    }
    loopVars.delete(s.name)
  }

  run(prog)
  return { assigned, unrolled }
}

function parseProgram(src: string): Stmt[] {
  const p = new Parser(lex(src))
  const prog = parseStmts(p, [])
  if (!p.atEnd()) throw new Error(`BASIC: stopped making sense at ${p.peek()?.v}`)
  return prog
}

export function compileBasic(src: string, env: BasicEnv): BasicResult {
  const prog = parseProgram(src)
  if (prog.some(s => s.t === 'dim')) {
    throw new Error('BASIC: DIM declares a state LAYOUT inside a covenant\'s own script, which needs ' +
      'the field offset and the peel and rebuild around it — compile it with compileState, not compileBasic')
  }
  const a = new Asm(env.stack.slice())
  const r = emitProgram(prog, a, env.consts ?? {}, env.maxOps ?? 500_000)
  return { ops: a.ops, stack: a.st, assigned: r.assigned, unrolled: r.unrolled }
}

// ── ★★ DIM — THE STATE LAYER ─────────────────────────────────────────────────────────────────────────
/**
 * A covenant carries its state in its OWN LOCKING SCRIPT, as fixed-width data pushes, and reads them
 * back by splitting its own scriptCode at constant offsets. That is the whole trick, and `DIM` is how
 * you say it:
 *
 * ```
 *      the script            PRE ‖ <w0>f0 ‖ <w1>f1 ‖ … ‖ <wN>fN ‖ SUF
 *      DIM phase%1           one byte  — the program counter
 *      DIM v%5               five      — velocity in fixed point
 *      DIM driver$20         twenty raw bytes, never converted
 * ```
 *
 * ⚠ `PRE` is everything before the first field's DATA — the header pushes AND the first field's own
 * one-byte push opcode. `SUF` is the entire rest of the script: the code itself, which is why a covenant
 * can rebuild a copy of itself without ever containing a copy of itself.
 *
 * ── ★ WHAT THIS GENERATES, AND WHAT IT DOES NOT ───────────────────────────────────────────────────
 * It generates the PEEL and the REBUILD around your program. It does NOT verify the preimage, compare
 * against `hashOutputs`, or enforce a value rule — those are the covenant's own decisions, they differ
 * between the shell, the depot and the battery, and inventing one here would be a fourth opinion nobody
 * asked for. Hand it a scriptCode and it hands you back the rebuilt script; what you bind that to is
 * yours. See `shellLockOps` for a frame that does all of it by hand.
 */
export interface StateEnv {
  /**
   * Where the FIRST field's DATA begins inside the scriptCode, in bytes.
   *
   * ⚠⚠ IT DEPENDS ON THE SCRIPT'S OWN LENGTH, because BIP143 prefixes the scriptCode with its varint
   * size — so it cannot be known until the script exists. `buildShellLock` resolves the circularity by
   * building once with a probe offset, measuring, and rebuilding; `scriptCodeVarIntSize` is that step.
   * Get this wrong and the split lands mid-field: the script still runs, and every value is nonsense.
   */
  fieldOffset: number
  /** What the unlocking script has already pushed, bottom first — everything BELOW the scriptCode. */
  stack?: string[]
  consts?: Record<string, number>
  maxOps?: number
}

export interface StateResult {
  layout: Field[]
  /** scriptCode on top ⇒ [.., PRE, f0 … fN, SUF], every field a named slot. */
  peel: ScriptChunk[]
  /** Your program. */
  body: ScriptChunk[]
  /** ⇒ the rebuilt script, alone on top. */
  rebuild: ScriptChunk[]
  /** peel ‖ body ‖ rebuild — the whole thing, which is what a caller normally wants. */
  ops: ScriptChunk[]
  stack: string[]
  assigned: string[]
  unrolled: number
}

/** The varint that BIP143 puts in front of a scriptCode of this length. */
export const scriptCodeVarIntSize = (len: number): number => (len < 253 ? 1 : len < 65536 ? 3 : 5)

/**
 * The largest magnitude a `%width` field can hold — sign-magnitude, so one bit goes to the sign.
 *
 * ⚠ THIS MATTERS BECAUSE THE FAILURE IS SILENT AT THE EDGE. `fixedField` truncates without complaint,
 * producing a perfectly well-formed script carrying the wrong number; on the way back out `OP_NUM2BIN`
 * refuses instead, so the covenant rejects a spend nobody can account for. Check before you build.
 */
export const fieldMax = (width: number): number => 2 ** (8 * width - 1) - 1

const pushBytes = (d: number[]): ScriptChunk => ({ op: d.length, data: d })

/**
 * Lay a state out as the literal pushes that go at the top of the locking script.
 *
 * ⚠ It REFUSES an oversized value rather than truncating it. That is the one behaviour worth arguing
 * about, and the argument is settled: a truncated field is a covenant that disagrees with itself.
 */
export function stateChunks(layout: Field[], values: Record<string, number | number[]>): ScriptChunk[] {
  return layout.map(f => {
    const v = values[f.name]
    if (v === undefined) throw new Error(`BASIC: no value for the field ${f.name}`)
    if (f.bytes) {
      if (!Array.isArray(v)) throw new Error(`BASIC: ${f.name} is a $ field — it wants ${f.width} raw bytes`)
      if (v.length !== f.width) throw new Error(`BASIC: ${f.name} is ${v.length} bytes, but DIM says ${f.width}`)
      return pushBytes(v)
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`BASIC: ${f.name} wants a whole number`)
    if (Math.abs(v) > fieldMax(f.width)) {
      throw new Error(`BASIC: ${f.name} = ${v} does not fit in ${f.width} bytes (max ±${fieldMax(f.width)}) — ` +
        'widen the DIM, because truncating it silently is how a covenant comes to disagree with itself')
    }
    return pushBytes(fixedField(v, f.width))
  })
}

/**
 * ★★ Compile a program that reads and writes the script's own state.
 *
 * The generated peel leaves every field as a NAMED STACK SLOT, and the rebuild gathers them BY NAME
 * rather than by position — which is not a stylistic choice. `coalesce` moves a re-assigned variable to
 * the top of the stack, so after `phase = phase + 1` the fields are no longer in layout order at all.
 * A rebuild that trusted position would emit them shuffled, produce a valid script with the fields
 * swapped, and fail only at the output comparison, hundreds of opcodes later.
 */
export function compileState(src: string, env: StateEnv): StateResult {
  const prog = parseProgram(src)
  const layout: Field[] = []
  const body: Stmt[] = []
  let running = false
  for (const s of prog) {
    if (s.t !== 'dim') { running = true; body.push(s); continue }
    if (running) {
      throw new Error('BASIC: every DIM must come before the first statement that runs — the layout is ' +
        'fixed before anything can read it')
    }
    for (const f of s.fields) {
      if (f.name === 'PRE' || f.name === 'SUF') {
        throw new Error(`BASIC: PRE and SUF are the script either side of the fields — ${f.name} is taken`)
      }
      if (layout.some(g => g.name === f.name)) throw new Error(`BASIC: ${f.name} is DIMmed twice`)
      layout.push(f)
    }
  }
  if (!layout.length) throw new Error('BASIC: compileState needs at least one DIM — that is what it compiles')

  const a = new Asm([...(env.stack ?? []), 'scriptCode'])
  /* Two model-only helpers. OP_SWAP and OP_NIP move items the assembler has no word for, and the model
     has to move with them or every depth after this point is computed against a stack that never was. */
  const swap = (): void => {
    a.raw(op(OP.OP_SWAP), 0, [])
    const n = a.st.length
    const t = a.st[n - 1]; a.st[n - 1] = a.st[n - 2]; a.st[n - 2] = t
  }
  const nip = (): void => { a.raw(op(OP.OP_NIP), 0, []); a.st.splice(a.st.length - 2, 1) }
  /** OP_ROLL, except that rolling the top of the stack onto itself is two bytes for nothing. */
  const rollUp = (name: string): void => { if (a.depth(name) !== 0) a.roll(name) }

  // ── THE PEEL ───────────────────────────────────────────────────────────────────────────────────────
  a.num(env.fieldOffset)
  a.o(OP.OP_SPLIT, 2, ['PRE', '_rest'])
  layout.forEach((f, i) => {
    /* ⚠ Every field but the first is preceded by its own one-byte push opcode, and it has to go. The
       first field's opcode is already inside PRE — that is what `fieldOffset` pointing at the DATA
       means, and it is the asymmetry that makes the rebuild loop start at 1. */
    if (i > 0) { a.o(OP.OP_1, 0, ['_1']); a.o(OP.OP_SPLIT, 2, ['_pfx', '_rest']); nip() }
    a.num(f.width)
    a.o(OP.OP_SPLIT, 2, [f.name, '_rest'])
    if (!f.bytes) { swap(); a.o(OP.OP_BIN2NUM, 1, [f.name]); swap() }
  })
  a.rename('SUF')                                          // whatever is left is the code itself
  const peel = a.ops.slice()

  // ── THE BODY ───────────────────────────────────────────────────────────────────────────────────────
  const r = emitProgram(body, a, env.consts ?? {}, env.maxOps ?? 500_000)
  for (const n of ['PRE', 'SUF']) {
    if (r.assigned.includes(n)) throw new Error(`BASIC: ${n} is the script itself — assigning it would ` +
      'rewrite the covenant rather than its state')
  }
  const bodyOps = a.ops.slice(peel.length)

  // ── THE REBUILD ────────────────────────────────────────────────────────────────────────────────────
  /* ⚠ A $ field is only checked for width if the program ASSIGNED it. One that came off the split is
     that many bytes by construction, and paying four bytes per move to re-establish a fact the split
     already guarantees is the kind of cost a covenant carries forever. */
  const seal = (f: Field): void => {
    if (!f.bytes) { a.num(f.width); a.o(OP.OP_NUM2BIN, 2, [f.name]); return }
    if (r.assigned.includes(f.name)) {
      a.o(OP.OP_SIZE, 0, ['_sz']); a.num(f.width); a.o(OP.OP_EQUALVERIFY, 2, [])
    }
  }
  for (let i = layout.length - 1; i > 0; i--) {
    rollUp(layout[i].name); seal(layout[i]); a.o(OP.OP_TOALTSTACK, 1, [])
  }
  rollUp('PRE')                                            // …so that PRE and f0 are adjacent, whatever
  rollUp(layout[0].name)                                   //    the body left lying between them
  seal(layout[0])
  a.o(OP.OP_CAT, 2, ['_s'])                                // PRE ‖ f0
  for (let i = 1; i < layout.length; i++) {
    a.raw(pushBytes([layout[i].width]), 0, ['_w'])         // the push opcode this field is written with
    a.o(OP.OP_CAT, 2, ['_s'])
    a.o(OP.OP_FROMALTSTACK, 0, ['_f'])
    a.o(OP.OP_CAT, 2, ['_s'])
  }
  rollUp('SUF')
  a.o(OP.OP_CAT, 2, ['script'])

  return {
    layout, peel, body: bodyOps, rebuild: a.ops.slice(peel.length + bodyOps.length),
    ops: a.ops, stack: a.st, assigned: r.assigned, unrolled: r.unrolled,
  }
}
