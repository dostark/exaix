/**
 * @module SafeExpression
 * @path packages/flow/src/safe_expression.ts
 * @description Sandboxed expression parser + evaluator for flow step conditions.
 * Conditions are DATA, not code: this module parses a restricted boolean-expression
 * grammar to an AST and evaluates it against an allowlisted context. Unlike
 * `new Function`/`eval`, it can never reach host globals (Deno, globalThis, fetch,
 * import), call arbitrary functions, perform assignments, or trigger side effects.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/condition_evaluator.ts]
 */

/** Root identifiers a condition may reference. Everything else is rejected. */
const ALLOWED_ROOTS = new Set(["results", "request", "flow"]);

/** Array methods a condition may call. No other call expressions are permitted. */
const ALLOWED_METHODS = new Set(["every", "some", "includes"]);

/** Member keys that are never readable (prototype-pollution / constructor escape). */
const FORBIDDEN_KEYS = new Set(["constructor", "__proto__", "prototype"]);

/** Upper bound on AST nodes evaluated, guarding against pathological inputs. */
const MAX_EVAL_OPERATIONS = 10_000;

const LENGTH_PROPERTY = "length";

/** JSON-compatible value (with `undefined` for optional/missing reads) accepted as context input. */
export type ExpressionInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | ExpressionInput[]
  | { readonly [key: string]: ExpressionInput };

/** Context object exposed to a condition: `{ results, request, flow }`. */
export type ExpressionContext = { readonly [key: string]: ExpressionInput };

/** Value produced during evaluation. Arrow functions evaluate to a closure. */
type EvalValue = ExpressionInput | EvalFunction;
type EvalFunction = (arg: EvalValue) => EvalValue;

/** Lexical scope mapping arrow-function parameter names to bound values. */
type Scope = Record<string, EvalValue>;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// ============================================================================
// AST
// ============================================================================

enum NodeKind {
  Literal = "literal",
  Identifier = "identifier",
  ArrayLiteral = "array",
  Arrow = "arrow",
  Unary = "unary",
  Binary = "binary",
  Logical = "logical",
  Conditional = "conditional",
  Member = "member",
  Call = "call",
}

type Node =
  | { kind: NodeKind.Literal; value: ExpressionInput }
  | { kind: NodeKind.Identifier; name: string }
  | { kind: NodeKind.ArrayLiteral; elements: Node[] }
  | { kind: NodeKind.Arrow; params: string[]; body: Node }
  | { kind: NodeKind.Unary; op: string; arg: Node }
  | { kind: NodeKind.Binary; op: string; left: Node; right: Node }
  | { kind: NodeKind.Logical; op: string; left: Node; right: Node }
  | { kind: NodeKind.Conditional; test: Node; consequent: Node; alternate: Node }
  | { kind: NodeKind.Member; object: Node; property: Node; computed: boolean; optional: boolean }
  | { kind: NodeKind.Call; callee: Node; args: Node[] };

// ============================================================================
// Tokenizer
// ============================================================================

enum TokenType {
  Num = "num",
  Str = "str",
  Ident = "ident",
  Punct = "punct",
  Eof = "eof",
}

interface Token {
  type: TokenType;
  value: string;
}

// Multi-character punctuators, longest-first so prefixes never shadow them.
const PUNCTUATORS = [
  "?.[",
  "===",
  "!==",
  "?.",
  "==",
  "!=",
  ">=",
  "<=",
  "&&",
  "||",
  "=>",
  "?",
  ":",
  ".",
  "[",
  "]",
  "(",
  ")",
  ",",
  "!",
  ">",
  "<",
  "+",
  "-",
  "*",
  "/",
  "%",
];

interface ScanResult {
  value: string;
  end: number;
}

const isWhitespace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isIdentStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);

function scanString(input: string, start: number): ScanResult {
  const quote = input[start];
  let str = "";
  let i = start + 1;
  while (i < input.length && input[i] !== quote) {
    if (input[i] === "\\" && i + 1 < input.length) {
      const next = input[i + 1];
      str += next === "n" ? "\n" : next === "t" ? "\t" : next;
      i += 2;
    } else {
      str += input[i];
      i++;
    }
  }
  if (i >= input.length) throw new ExpressionError("Unterminated string literal");
  return { value: str, end: i + 1 };
}

function scanWhile(input: string, start: number, predicate: (ch: string) => boolean): ScanResult {
  let i = start;
  while (i < input.length && predicate(input[i])) i++;
  return { value: input.slice(start, i), end: i };
}

/** A bare "=" (assignment) is rejected; "==" and "=>" are valid operators. */
function isAssignment(input: string, i: number): boolean {
  return input[i] === "=" && input[i + 1] !== "=" && input[i + 1] !== ">";
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (isWhitespace(ch)) {
      i++;
    } else if (ch === "'" || ch === '"') {
      const r = scanString(input, i);
      tokens.push({ type: TokenType.Str, value: r.value });
      i = r.end;
    } else if (isDigit(ch)) {
      const r = scanWhile(input, i, (c) => isDigit(c) || c === ".");
      tokens.push({ type: TokenType.Num, value: r.value });
      i = r.end;
    } else if (isIdentStart(ch)) {
      const r = scanWhile(input, i, isIdentPart);
      tokens.push({ type: TokenType.Ident, value: r.value });
      i = r.end;
    } else if (isAssignment(input, i)) {
      throw new ExpressionError("Assignment is not allowed in conditions");
    } else {
      const matched = PUNCTUATORS.find((p) => input.startsWith(p, i));
      if (!matched) throw new ExpressionError(`Unexpected character: '${ch}'`);
      tokens.push({ type: TokenType.Punct, value: matched });
      i += matched.length;
    }
  }

  tokens.push({ type: TokenType.Eof, value: "" });
  return tokens;
}

// ============================================================================
// Parser (recursive descent, lowest precedence first)
// ============================================================================

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseExpression();
    if (this.peek().type !== TokenType.Eof) {
      throw new ExpressionError(`Unexpected token: '${this.peek().value}'`);
    }
    return node;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private isPunct(value: string): boolean {
    const t = this.peek();
    return t.type === TokenType.Punct && t.value === value;
  }

  private expectPunct(value: string): void {
    if (!this.isPunct(value)) throw new ExpressionError(`Expected '${value}'`);
    this.pos++;
  }

  private parseExpression(): Node {
    return this.parseConditional();
  }

  private parseConditional(): Node {
    const test = this.parseLogicalOr();
    if (this.isPunct("?")) {
      this.pos++;
      const consequent = this.parseExpression();
      this.expectPunct(":");
      const alternate = this.parseExpression();
      return { kind: NodeKind.Conditional, test, consequent, alternate };
    }
    return test;
  }

  private parseBinaryLevel(operators: string[], next: () => Node, logical: boolean): Node {
    let left = next();
    while (this.peek().type === TokenType.Punct && operators.includes(this.peek().value)) {
      const op = this.next().value;
      const right = next();
      left = logical ? { kind: NodeKind.Logical, op, left, right } : { kind: NodeKind.Binary, op, left, right };
    }
    return left;
  }

  private parseLogicalOr(): Node {
    return this.parseBinaryLevel(["||"], () => this.parseLogicalAnd(), true);
  }
  private parseLogicalAnd(): Node {
    return this.parseBinaryLevel(["&&"], () => this.parseEquality(), true);
  }
  private parseEquality(): Node {
    return this.parseBinaryLevel(["===", "!==", "==", "!="], () => this.parseRelational(), false);
  }
  private parseRelational(): Node {
    return this.parseBinaryLevel(["<", ">", "<=", ">="], () => this.parseAdditive(), false);
  }
  private parseAdditive(): Node {
    return this.parseBinaryLevel(["+", "-"], () => this.parseMultiplicative(), false);
  }
  private parseMultiplicative(): Node {
    return this.parseBinaryLevel(["*", "/", "%"], () => this.parseUnary(), false);
  }

  private parseUnary(): Node {
    if (this.isPunct("!") || this.isPunct("-")) {
      const op = this.next().value;
      return { kind: NodeKind.Unary, op, arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isPunct(".") || this.isPunct("?.")) {
        const optional = this.next().value === "?.";
        const prop = this.next();
        if (prop.type !== TokenType.Ident) throw new ExpressionError("Expected property name after '.'");
        node = {
          kind: NodeKind.Member,
          object: node,
          property: { kind: NodeKind.Literal, value: prop.value },
          computed: false,
          optional,
        };
      } else if (this.isPunct("[") || this.isPunct("?.[")) {
        const optional = this.next().value === "?.[";
        const index = this.parseExpression();
        this.expectPunct("]");
        node = { kind: NodeKind.Member, object: node, property: index, computed: true, optional };
      } else if (this.isPunct("(")) {
        this.pos++;
        const args = this.parseArgumentList();
        this.expectPunct(")");
        node = { kind: NodeKind.Call, callee: node, args };
      } else {
        return node;
      }
    }
  }

  private parseArgumentList(): Node[] {
    const args: Node[] = [];
    if (this.isPunct(")")) return args;
    args.push(this.parseExpression());
    while (this.isPunct(",")) {
      this.pos++;
      args.push(this.parseExpression());
    }
    return args;
  }

  private parsePrimary(): Node {
    const t = this.peek();

    if (t.type === TokenType.Num) {
      this.pos++;
      return { kind: NodeKind.Literal, value: Number(t.value) };
    }
    if (t.type === TokenType.Str) {
      this.pos++;
      return { kind: NodeKind.Literal, value: t.value };
    }
    if (t.type === TokenType.Ident) {
      // Single-parameter arrow: `id => body`
      if (this.peek(1).type === TokenType.Punct && this.peek(1).value === "=>") {
        this.pos += 2;
        return { kind: NodeKind.Arrow, params: [t.value], body: this.parseExpression() };
      }
      this.pos++;
      if (t.value === "true") return { kind: NodeKind.Literal, value: true };
      if (t.value === "false") return { kind: NodeKind.Literal, value: false };
      if (t.value === "null") return { kind: NodeKind.Literal, value: null };
      return { kind: NodeKind.Identifier, name: t.value };
    }
    if (this.isPunct("[")) {
      this.pos++;
      const elements: Node[] = [];
      if (!this.isPunct("]")) {
        elements.push(this.parseExpression());
        while (this.isPunct(",")) {
          this.pos++;
          elements.push(this.parseExpression());
        }
      }
      this.expectPunct("]");
      return { kind: NodeKind.ArrayLiteral, elements };
    }
    if (this.isPunct("(")) {
      return this.parseParenOrArrow();
    }

    throw new ExpressionError(`Unexpected token: '${t.value}'`);
  }

  /** Disambiguate `( … )` grouping from `( params ) => body` by checking for `=>`. */
  private parseParenOrArrow(): Node {
    const closeIndex = this.matchingParenIndex();
    const afterClose = this.tokens[closeIndex + 1];
    const isArrow = afterClose?.type === TokenType.Punct && afterClose.value === "=>";

    if (isArrow) {
      this.pos++; // consume "("
      const params: string[] = [];
      if (!this.isPunct(")")) {
        params.push(this.expectIdentifier());
        while (this.isPunct(",")) {
          this.pos++;
          params.push(this.expectIdentifier());
        }
      }
      this.expectPunct(")");
      this.expectPunct("=>");
      return { kind: NodeKind.Arrow, params, body: this.parseExpression() };
    }

    this.pos++; // consume "("
    const expr = this.parseExpression();
    this.expectPunct(")");
    return expr;
  }

  private expectIdentifier(): string {
    const t = this.next();
    if (t.type !== TokenType.Ident) throw new ExpressionError("Expected parameter name");
    return t.value;
  }

  private matchingParenIndex(): number {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const tk = this.tokens[i];
      if (tk.type === TokenType.Punct && (tk.value === "(" || tk.value === "[")) depth++;
      else if (tk.type === TokenType.Punct && (tk.value === ")" || tk.value === "]")) {
        depth--;
        if (depth === 0) return i;
      }
    }
    throw new ExpressionError("Unbalanced parentheses");
  }
}

// ============================================================================
// Static analysis — reject host globals / disallowed constructs before eval
// ============================================================================

/** Static name of a non-computed member access, if it is a string literal key. */
function staticMemberKey(node: Extract<Node, { kind: NodeKind.Member }>): string | undefined {
  if (!node.computed && node.property.kind === NodeKind.Literal && typeof node.property.value === "string") {
    return node.property.value;
  }
  return undefined;
}

function checkMember(node: Extract<Node, { kind: NodeKind.Member }>, bound: Set<string>): void {
  const key = staticMemberKey(node);
  if (key !== undefined && FORBIDDEN_KEYS.has(key)) {
    throw new ExpressionError(`Access to '${key}' is not allowed`);
  }
  staticCheck(node.object, bound);
  if (node.computed) staticCheck(node.property, bound);
}

function checkCall(node: Extract<Node, { kind: NodeKind.Call }>, bound: Set<string>): void {
  const callee = node.callee;
  const method = callee.kind === NodeKind.Member && !callee.computed ? staticMemberKey(callee) : undefined;
  if (method === undefined || !ALLOWED_METHODS.has(method)) {
    throw new ExpressionError("Only allowlisted array method calls are permitted");
  }
  staticCheck((callee as Extract<Node, { kind: NodeKind.Member }>).object, bound);
  node.args.forEach((a) => staticCheck(a, bound));
}

function checkArrow(node: Extract<Node, { kind: NodeKind.Arrow }>, bound: Set<string>): void {
  const inner = new Set(bound);
  node.params.forEach((p) => inner.add(p));
  staticCheck(node.body, inner);
}

function staticCheck(node: Node, bound: Set<string>): void {
  switch (node.kind) {
    case NodeKind.Literal:
      return;
    case NodeKind.Identifier:
      if (!bound.has(node.name) && !ALLOWED_ROOTS.has(node.name)) {
        throw new ExpressionError(`Unknown identifier: '${node.name}'`);
      }
      return;
    case NodeKind.ArrayLiteral:
      node.elements.forEach((el) => staticCheck(el, bound));
      return;
    case NodeKind.Arrow:
      return checkArrow(node, bound);
    case NodeKind.Unary:
      return staticCheck(node.arg, bound);
    case NodeKind.Binary:
    case NodeKind.Logical:
      staticCheck(node.left, bound);
      staticCheck(node.right, bound);
      return;
    case NodeKind.Conditional:
      staticCheck(node.test, bound);
      staticCheck(node.consequent, bound);
      staticCheck(node.alternate, bound);
      return;
    case NodeKind.Member:
      return checkMember(node, bound);
    case NodeKind.Call:
      return checkCall(node, bound);
  }
}

// ============================================================================
// Evaluator
// ============================================================================

function readMember(object: EvalValue, key: string | number): EvalValue {
  if (object === null || object === undefined) {
    throw new ExpressionError(`Cannot read '${key}' of ${object === null ? "null" : "undefined"}`);
  }
  if (typeof key === "string" && FORBIDDEN_KEYS.has(key)) {
    throw new ExpressionError(`Access to '${key}' is not allowed`);
  }
  if (typeof object === "string") {
    if (key === LENGTH_PROPERTY) return object.length;
    if (typeof key === "number") return object[key];
    return undefined;
  }
  if (Array.isArray(object)) {
    if (key === LENGTH_PROPERTY) return object.length;
    if (typeof key === "number") return object[key] as EvalValue;
    return undefined;
  }
  if (typeof object === "object") {
    return (object as { [key: string]: ExpressionInput })[String(key)];
  }
  return undefined;
}

class Evaluator {
  private operations = 0;
  constructor(private readonly context: ExpressionContext) {}

  run(node: Node): EvalValue {
    return this.evalNode(node, {});
  }

  private evalNode(node: Node, scope: Scope): EvalValue {
    if (++this.operations > MAX_EVAL_OPERATIONS) {
      throw new ExpressionError("Condition evaluation exceeded operation budget");
    }

    switch (node.kind) {
      case NodeKind.Literal:
        return node.value;
      case NodeKind.Identifier: {
        if (node.name in scope) return scope[node.name];
        if (ALLOWED_ROOTS.has(node.name)) return this.context[node.name];
        throw new ExpressionError(`Unknown identifier: '${node.name}'`);
      }
      case NodeKind.ArrayLiteral:
        return node.elements.map((el) => this.evalNode(el, scope)) as ExpressionInput;
      case NodeKind.Arrow:
        return this.makeClosure(node, scope);
      case NodeKind.Unary:
        return this.evalUnary(node.op, this.evalNode(node.arg, scope));
      case NodeKind.Logical:
        return this.evalLogical(node, scope);
      case NodeKind.Binary:
        return this.evalBinary(node.op, this.evalNode(node.left, scope), this.evalNode(node.right, scope));
      case NodeKind.Conditional:
        return this.evalNode(node.test, scope)
          ? this.evalNode(node.consequent, scope)
          : this.evalNode(node.alternate, scope);
      case NodeKind.Member:
        return this.evalMember(node, scope);
      case NodeKind.Call:
        return this.evalCall(node, scope);
    }
  }

  private makeClosure(node: Extract<Node, { kind: NodeKind.Arrow }>, scope: Scope): EvalFunction {
    return (arg: EvalValue) => {
      const inner: Scope = { ...scope };
      if (node.params.length > 0) inner[node.params[0]] = arg;
      return this.evalNode(node.body, inner);
    };
  }

  private evalUnary(op: string, value: EvalValue): EvalValue {
    if (op === "!") return !value;
    if (op === "-") return -(value as number);
    throw new ExpressionError(`Unsupported unary operator: '${op}'`);
  }

  private evalLogical(node: Extract<Node, { kind: NodeKind.Logical }>, scope: Scope): EvalValue {
    const left = this.evalNode(node.left, scope);
    if (node.op === "&&") return left ? this.evalNode(node.right, scope) : left;
    if (node.op === "||") return left ? left : this.evalNode(node.right, scope);
    throw new ExpressionError(`Unsupported logical operator: '${node.op}'`);
  }

  private evalBinary(op: string, left: EvalValue, right: EvalValue): EvalValue {
    switch (op) {
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      case "==":
        return left == right;
      case "!=":
        return left != right;
      case "<":
        return (left as number) < (right as number);
      case ">":
        return (left as number) > (right as number);
      case "<=":
        return (left as number) <= (right as number);
      case ">=":
        return (left as number) >= (right as number);
      case "+":
        return (left as number) + (right as number);
      case "-":
        return (left as number) - (right as number);
      case "*":
        return (left as number) * (right as number);
      case "/":
        return (left as number) / (right as number);
      case "%":
        return (left as number) % (right as number);
      default:
        throw new ExpressionError(`Unsupported operator: '${op}'`);
    }
  }

  private evalMember(node: Extract<Node, { kind: NodeKind.Member }>, scope: Scope): EvalValue {
    const object = this.evalNode(node.object, scope);
    if (node.optional && (object === null || object === undefined)) return undefined;
    const key = node.computed
      ? (this.evalNode(node.property, scope) as string | number)
      : (node.property as Extract<Node, { kind: NodeKind.Literal }>).value as string;
    return readMember(object, key);
  }

  private evalCall(node: Extract<Node, { kind: NodeKind.Call }>, scope: Scope): EvalValue {
    if (node.callee.kind !== NodeKind.Member || node.callee.computed) {
      throw new ExpressionError("Only array method calls are allowed");
    }
    const method = (node.callee.property as Extract<Node, { kind: NodeKind.Literal }>).value as string;
    if (!ALLOWED_METHODS.has(method)) {
      throw new ExpressionError(`Method '${method}' is not allowed`);
    }
    const object = this.evalNode(node.callee.object, scope);
    if (!Array.isArray(object)) {
      throw new ExpressionError(`Method '${method}' is only allowed on arrays`);
    }
    const arr = object as EvalValue[];

    if (method === "includes") {
      const target = this.evalNode(node.args[0], scope);
      return arr.includes(target);
    }
    const fn = this.evalNode(node.args[0], scope);
    if (typeof fn !== "function") {
      throw new ExpressionError(`'${method}' requires a function argument`);
    }
    return method === "every" ? arr.every((el) => Boolean(fn(el))) : arr.some((el) => Boolean(fn(el)));
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Parse + statically validate a condition. Throws ExpressionError on any disallowed construct. */
export function parseCondition(condition: string): Node {
  const ast = new Parser(tokenize(condition)).parse();
  staticCheck(ast, new Set());
  return ast;
}

/** Validate a condition without evaluating it. */
export function validateExpression(condition: string): { valid: boolean; error?: string } {
  try {
    parseCondition(condition);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Evaluate a flow condition against an allowlisted context and return its truthiness.
 * Never reaches host globals, performs no I/O, and produces no side effects.
 */
export function evaluateExpression(condition: string, context: ExpressionContext): boolean {
  const ast = parseCondition(condition);
  return Boolean(new Evaluator(context).run(ast));
}
