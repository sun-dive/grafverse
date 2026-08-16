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
 */
import { OP, type ScriptChunk } from '@bsv/sdk'
import { Asm, op, PN } from './covenantAsm.ts'

/** 1.0 in this project's fixed point — 2^32, the battery's convention and the shell's. */
export const BASIC_S = 2 ** 32

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────────
type Tok = { k: 'num' | 'name' | 'op' | 'kw' | 'eol'; v: string; n?: number }

const KEYWORDS = new Set(['LET', 'IF', 'THEN', 'ELSE', 'REM', 'AND', 'OR', 'NOT'])

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
    if ('+-*/()<>=,:'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue }
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
    if (t.k === 'kw' && t.v === 'LET') { p.next(); out.push(letStmt(p)); continue }
    if (t.k === 'kw' && t.v === 'IF') { p.next(); out.push(ifStmt(p)); continue }
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

// ── emission ─────────────────────────────────────────────────────────────────────────────────────────
export interface BasicEnv {
  /** The stack as it stands when this program starts — bottom first, the same list `Asm` takes. */
  stack: string[]
  /** Named constants, substituted at compile time. Regulations belong here. */
  consts?: Record<string, number>
}

export interface BasicResult {
  ops: ScriptChunk[]
  /** The stack model afterwards, so a caller can carry on emitting by hand. */
  stack: string[]
  /** Every variable the program assigned, in first-assignment order. */
  assigned: string[]
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
export function compileBasic(src: string, env: BasicEnv): BasicResult {
  const a = new Asm(env.stack.slice())
  const consts = env.consts ?? {}
  const assigned: string[] = []

  /** trunc(x·y / 2^32) — the project's fixed-point multiply, as one word. */
  const fmul = (): void => { a.o(OP.OP_MUL, 2, ['_p']); a.num(BASIC_S); a.o(OP.OP_DIV, 2, ['_q']) }
  /** trunc(x·2^32 / y) — scaled BEFORE dividing, or the precision is gone before the division happens. */
  const fdiv = (): void => { a.num(BASIC_S); a.o(OP.OP_MUL, 2, ['_p']); a.o(OP.OP_DIV, 2, ['_q']) }

  function emit(e: Expr): void {
    switch (e.t) {
      case 'num': a.num(Math.round(e.v)); return
      case 'var': {
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
      else { assignedBy(s.then, into); assignedBy(s.else, into) }
    }
  }

  function run(ss: Stmt[]): void {
    for (const s of ss) {
      if (s.t === 'let') {
        emit(s.e)
        a.rename(s.name)                                   // the value on top now answers to this name
        if (!assigned.includes(s.name)) assigned.push(s.name)
        continue
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
      run(s.then)
      if (list.length) a.armReturn(list)
      a.elseArm()
      run(s.else)
      if (list.length) a.armReturn(list)
      a.endIf()
      for (const n of list) if (!assigned.includes(n)) assigned.push(n)
    }
  }

  const p = new Parser(lex(src))
  const prog = parseStmts(p, [])
  if (!p.atEnd()) throw new Error(`BASIC: stopped making sense at ${p.peek()?.v}`)
  run(prog)
  return { ops: a.ops, stack: a.st, assigned }
}
