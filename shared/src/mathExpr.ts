/**
 * A small, safe arithmetic expression evaluator.
 *
 * Intuition specs come from a language model, which means `expr` strings are
 * untrusted input that arrives at runtime. `eval()` / `new Function()` are
 * therefore not options at any price — a model that emits
 * `fetch('/api/...')` inside an expression must get a parse error, not a
 * network request.
 *
 * This lives in `shared/` rather than the client on purpose: the server
 * validates a generated spec by compiling every expression in it, and the
 * client renders by evaluating those same compiled expressions. One
 * implementation, so a spec that passed validation cannot fail to render.
 *
 * Pipeline: tokenize → shunting-yard to RPN → evaluate RPN per sample point.
 * Compilation happens once; evaluation runs a few hundred times per frame, so
 * the hot path is a flat loop over a number/opcode array with no re-parsing.
 *
 * Supported: + - * / ^ (right-assoc), unary minus, parentheses, the functions
 * below, the constants pi/e, and the free variables the caller declares.
 * Deliberately NOT supported: assignment, comparison, comma-sequencing outside
 * a call, or any identifier not in the tables below.
 */

/** Single-argument functions. */
const FN1: Record<string, (a: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};

/** Two-argument functions. */
const FN2: Record<string, (a: number, b: number) => number> = {
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  atan2: Math.atan2,
  mod: (a, b) => a % b,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

/**
 * Own-property test. NOT `name in TABLE`.
 *
 * `in` walks the prototype chain, so `'constructor' in FN1` is true, as are
 * `toString`, `valueOf`, `__proto__` and friends. With `in`, the input
 * `constructor(2)` tokenized as a legitimate 1-arg function call and then
 * invoked `Object.prototype.constructor` — a caller-supplied string reaching a
 * live function object. Own-property lookups only.
 */
function hasOwn(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/** Guards against a pathological generated string eating the render loop. */
const MAX_EXPR_LENGTH = 240;
const MAX_TOKENS = 200;

type Token =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'const'; v: number }
  | { k: 'fn'; name: string; arity: 1 | 2 }
  | { k: 'op'; op: string }
  | { k: 'lparen' }
  | { k: 'rparen' }
  | { k: 'comma' };

/**
 * RPN instruction.
 *
 * Function instructions carry the resolved implementation rather than its name:
 * the name is looked up once at compile time, so the evaluator never does a
 * property access on a string-keyed table in its hot loop. That is both faster
 * and impossible to get wrong — there is no path where a name reaches
 * evaluation without having already resolved to a real function.
 */
type Instr =
  | { k: 'num'; v: number }
  | { k: 'var'; slot: number }
  | { k: 'op'; op: string }
  | { k: 'fn1'; fn: (a: number) => number }
  | { k: 'fn2'; fn: (a: number, b: number) => number };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4, 'u-': 3 };
const RIGHT_ASSOC = new Set(['^', 'u-']);

// These accept `undefined` because every caller is indexing into the source
// string, and reading one past the end while scanning ahead is normal. Treating
// "off the end of the string" as "not a digit" is exactly the right answer, and
// keeps the scan loops free of bounds noise.
function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

function isIdentStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');
}

function isIdentChar(c: string | undefined): boolean {
  return isIdentStart(c) || isDigit(c);
}

/**
 * `variables` is the ordered list of free variable names the caller will supply
 * at evaluation time (for Intuition: `['x','t']`). Anything else that looks like
 * an identifier and isn't a known function or constant is a parse error, which
 * is what makes an unexpected identifier fail loudly at validation rather than
 * silently evaluate to NaN on screen.
 */
function tokenize(src: string, variables: readonly string[]): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  // Tracks whether the previous meaningful token was a value, so a leading or
  // post-operator '-' can be distinguished from subtraction.
  let prevWasValue = false;

  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n') {
      i += 1;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      // Implicit multiplication, e.g. `x 2`.
      if (prevWasValue) tokens.push({ k: 'op', op: '*' });
      let j = i;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j += 1;
      // Scientific notation: 1e-3, 2.5E+7
      if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1] ?? '') || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2] ?? '')))) {
        j += 2;
        while (j < src.length && isDigit(src[j])) j += 1;
      }
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) return null;
      tokens.push({ k: 'num', v });
      i = j;
      prevWasValue = true;
      continue;
    }

    if (isIdentStart(c)) {
      // Implicit multiplication, e.g. `2pi`, `3x`, `sin(x)cos(x)`.
      if (prevWasValue) tokens.push({ k: 'op', op: '*' });

      let j = i;
      while (j < src.length && isIdentChar(src[j])) j += 1;
      const name = src.slice(i, j);
      const lower = name.toLowerCase();

      // Skip whitespace to see whether this identifier is being called.
      let k = j;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k += 1;
      const isCall = src[k] === '(';

      if (isCall && hasOwn(FN1, lower)) {
        tokens.push({ k: 'fn', name: lower, arity: 1 });
        prevWasValue = false;
      } else if (isCall && hasOwn(FN2, lower)) {
        tokens.push({ k: 'fn', name: lower, arity: 2 });
        prevWasValue = false;
      } else if (variables.includes(name)) {
        tokens.push({ k: 'var', name });
        prevWasValue = true;
      } else if (variables.includes(lower)) {
        tokens.push({ k: 'var', name: lower });
        prevWasValue = true;
      } else if (hasOwn(CONSTANTS, lower)) {
        tokens.push({ k: 'const', v: CONSTANTS[lower] as number });
        prevWasValue = true;
      } else {
        // Unknown identifier — a function used without parens, a stray symbol,
        // or a variable the caller never declared. All are errors.
        return null;
      }
      i = j;
      continue;
    }

    if (c === '(') {
      // Implicit multiplication: 2(x+1) and t(x) both mean a product here.
      if (prevWasValue) tokens.push({ k: 'op', op: '*' });
      tokens.push({ k: 'lparen' });
      i += 1;
      prevWasValue = false;
      continue;
    }

    if (c === ')') {
      tokens.push({ k: 'rparen' });
      i += 1;
      prevWasValue = true;
      continue;
    }

    if (c === ',') {
      tokens.push({ k: 'comma' });
      i += 1;
      prevWasValue = false;
      continue;
    }

    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      if (c === '-' && !prevWasValue) {
        tokens.push({ k: 'op', op: 'u-' });
      } else if (c === '+' && !prevWasValue) {
        // Unary plus is a no-op; drop it.
      } else {
        tokens.push({ k: 'op', op: c });
      }
      i += 1;
      prevWasValue = false;
      continue;
    }

    // Anything else (=, <, ;, quotes, brackets, backticks…) is rejected.
    return null;
  }

  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return null;
  return tokens;
}

/** Shunting-yard: infix tokens → RPN instructions. */
function toRpn(tokens: Token[], variables: readonly string[]): Instr[] | null {
  const out: Instr[] = [];
  const stack: Token[] = [];

  for (const tok of tokens) {
    switch (tok.k) {
      case 'num':
        out.push({ k: 'num', v: tok.v });
        break;
      case 'const':
        out.push({ k: 'num', v: tok.v });
        break;
      case 'var': {
        const slot = variables.indexOf(tok.name);
        if (slot < 0) return null;
        out.push({ k: 'var', slot });
        break;
      }
      case 'fn':
        stack.push(tok);
        break;
      case 'comma':
        while (stack.length && (stack[stack.length - 1] as Token).k !== 'lparen') {
          const top = stack.pop() as Token;
          if (top.k === 'op') out.push({ k: 'op', op: top.op });
          else return null;
        }
        if (!stack.length) return null; // comma outside any call
        break;
      case 'op': {
        // Every op token comes from the tokenizer, which only ever emits keys
        // present in PRECEDENCE — but default to 0 rather than assert, so an
        // unknown operator degrades to "lowest precedence" instead of NaN
        // comparisons that silently reorder the expression.
        const prec = PRECEDENCE[tok.op] ?? 0;
        while (stack.length) {
          const top = stack[stack.length - 1] as Token;
          if (top.k !== 'op') break;
          const topPrec = PRECEDENCE[top.op] ?? 0;
          if (topPrec > prec || (topPrec === prec && !RIGHT_ASSOC.has(tok.op))) {
            stack.pop();
            out.push({ k: 'op', op: top.op });
          } else break;
        }
        stack.push(tok);
        break;
      }
      case 'lparen':
        stack.push(tok);
        break;
      case 'rparen': {
        let matched = false;
        while (stack.length) {
          const top = stack.pop() as Token;
          if (top.k === 'lparen') {
            matched = true;
            break;
          }
          if (top.k === 'op') out.push({ k: 'op', op: top.op });
          else return null;
        }
        if (!matched) return null; // unbalanced
        // A function immediately below the matched paren is now applied.
        const below = stack[stack.length - 1];
        if (below && below.k === 'fn') {
          stack.pop();
          if (below.arity === 1) {
            const fn = hasOwn(FN1, below.name) ? FN1[below.name] : undefined;
            if (!fn) return null;
            out.push({ k: 'fn1', fn });
          } else {
            const fn = hasOwn(FN2, below.name) ? FN2[below.name] : undefined;
            if (!fn) return null;
            out.push({ k: 'fn2', fn });
          }
        }
        break;
      }
    }
  }

  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.k === 'lparen') return null; // unbalanced
    if (top.k === 'op') out.push({ k: 'op', op: top.op });
    else return null;
  }

  return out.length ? out : null;
}

/**
 * Verifies the RPN program is stack-balanced, so evaluation can skip all
 * arity/underflow checks and stay a tight loop.
 */
function checkStackDepth(program: Instr[]): boolean {
  let depth = 0;
  for (const ins of program) {
    switch (ins.k) {
      case 'num':
      case 'var':
        depth += 1;
        break;
      case 'op':
        if (ins.op === 'u-') {
          if (depth < 1) return false;
        } else {
          if (depth < 2) return false;
          depth -= 1;
        }
        break;
      case 'fn1':
        if (depth < 1) return false;
        break;
      case 'fn2':
        if (depth < 2) return false;
        depth -= 1;
        break;
    }
  }
  return depth === 1;
}

/**
 * A compiled expression. `evaluate` takes the variable values positionally, in
 * the same order as the `variables` array passed to `compileExpression`.
 *
 * Non-finite results (division by zero, sqrt of a negative, overflow) are
 * returned as-is rather than coerced — the renderer needs to see NaN/Infinity
 * so it can break the line there instead of drawing a spurious segment across
 * an asymptote.
 */
export interface CompiledExpression {
  readonly source: string;
  evaluate(...values: number[]): number;
}

/**
 * Compiles `src`, or returns null if it is not a well-formed expression over
 * `variables`. Null is the signal the server uses to reject a generated spec.
 */
export function compileExpression(
  src: string,
  variables: readonly string[] = ['x', 't'],
): CompiledExpression | null {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed || trimmed.length > MAX_EXPR_LENGTH) return null;

  const tokens = tokenize(trimmed, variables);
  if (!tokens) return null;

  const program = toRpn(tokens, variables);
  if (!program || !checkStackDepth(program)) return null;

  // Reused across calls — evaluation is single-threaded and non-reentrant, so a
  // per-compile scratch array avoids an allocation per sample point.
  const stack = new Float64Array(program.length + 1);

  return {
    source: trimmed,
    evaluate(...values: number[]): number {
      let sp = 0;
      for (let i = 0; i < program.length; i += 1) {
        // Safe: `program` is fixed at compile time and index i is in range.
        const ins = program[i] as Instr;
        switch (ins.k) {
          case 'num':
            stack[sp] = ins.v;
            sp += 1;
            break;
          case 'var':
            stack[sp] = values[ins.slot] ?? Number.NaN;
            sp += 1;
            break;
          case 'op': {
            if (ins.op === 'u-') {
              stack[sp - 1] = -(stack[sp - 1] as number);
              break;
            }
            const b = stack[sp - 1] as number;
            const a = stack[sp - 2] as number;
            sp -= 1;
            switch (ins.op) {
              case '+': stack[sp - 1] = a + b; break;
              case '-': stack[sp - 1] = a - b; break;
              case '*': stack[sp - 1] = a * b; break;
              case '/': stack[sp - 1] = a / b; break;
              case '^': stack[sp - 1] = a ** b; break;
              default: return Number.NaN;
            }
            break;
          }
          case 'fn1':
            stack[sp - 1] = ins.fn(stack[sp - 1] as number);
            break;
          case 'fn2': {
            const b = stack[sp - 1] as number;
            const a = stack[sp - 2] as number;
            sp -= 1;
            stack[sp - 1] = ins.fn(a, b);
            break;
          }
        }
      }
      // checkStackDepth proved at compile time that exactly one value remains.
      return stack[0] as number;
    },
  };
}

/** True when `src` is a valid expression over `variables`. */
export function isValidExpression(src: string, variables: readonly string[] = ['x', 't']): boolean {
  return compileExpression(src, variables) !== null;
}
