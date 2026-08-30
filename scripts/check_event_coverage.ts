#!/usr/bin/env -S deno run -A
/**
 * @module CheckEventCoverage
 * @path scripts/check_event_coverage.ts
 * @description Advisory AST audit for ARCHITECTURE.md's "Visibility" guarantee ("every
 *   significant runtime transition emits a typed, versioned, trace-linked domain event")
 *   and the `plan`/`pre-gap-analysis`/`next-steps`/`post-gap-analysis` skills' Traceability
 *   principle. Flags classes wired to an audit logger that never call it, and exported
 *   functions/methods with a state change or cross-component call and no adjacent event.
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-run=git scripts/check_event_coverage.ts
 *   deno run --allow-read --allow-env --allow-run=git scripts/check_event_coverage.ts --staged --fail
 *   deno run --allow-read --allow-env --allow-run=git scripts/check_event_coverage.ts --json
 *
 * @architectural-layer Script
 * @dependencies [typescript, @std/fs, @std/path]
 * @related-files [scripts/check_event_strings.ts, scripts/check_reachability_ledger.ts, packages/core/src/logger/event_logger.ts, packages/core/src/events/event_registry.ts]
 */

// Design notes:
// - Two gap shapes: (1) "wired but silent" — a class accepts an IEventLogger/IEventRegistry
//   constructor dependency but no method anywhere in the class body ever calls it; (2) a
//   state change (this.* mutation, a write-verb call on another field, a direct filesystem/
//   subprocess write) or a cross-component call (a call on another constructor-injected
//   IFoo-typed dependency) with no call to the audit-logger binding anywhere in the same
//   function/method body.
// - Both idioms coexisting in the codebase are covered: class-field injection
//   (constructor(private readonly logger?: IEventLogger) {}, methods call
//   this.logger?.info(...)) and per-call function/static-method parameters
//   (function f(x, logger?: Opt<IEventLogger, Reason.X>) { logger?.info(...); }).
// - Advisory only — like check:reachability-ledger and check:god-objects, a finding means
//   "verify by hand," not "automatically a real gap." Known false-positive sources: an event
//   emitted by a *caller* of the flagged method rather than the method itself, a private
//   helper one level removed from the public method that does the actual write, dynamic
//   dispatch, and non-arrow nested function bodies whose own `this` this scanner does not
//   special-case away from the enclosing class scope. Parsing is syntactic-only
//   (ts.createSourceFile per file, no cross-file type resolution), matching
//   check_magic_values.ts/check_optional_params.ts/check_unused_exports.ts.
// - Two invocation modes: default scans every non-test .ts file under packages/,
//   packages-team/, apps/ and prints a full advisory report (exit 0 unless --fail is
//   passed); --staged scans only `git diff --cached` .ts files under those roots — a
//   file-level ratchet, mirroring check_optional_params.ts --staged. Not yet wired into
//   .git/hooks/pre-commit; the pre-existing corpus has not been triaged, so wiring it as a
//   blocking gate today would fail commits to files unrelated to the change touching them.
//   Intended for a future incremental ratchet once the corpus is cleaned up.

import ts from "typescript";
import { walk } from "@std/fs";
import { relative } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";

// ── Types ──

/** An audit-logger binding: either a class field (`this.<name>`) or a plain parameter
 *  (`<name>`) in scope for the body being scanned. */
export interface IAuditBinding {
  name: string;
  isField: boolean;
}

/** A method or function with a state change or cross-component call and no call to its
 *  own audit-logger binding anywhere in its body. */
export interface IEventCoverageFinding {
  file: string;
  scopeName: string;
  line: number;
  reasons: Array<"state-change" | "cross-component-call">;
  detail: string[];
  /** true when the owning class carries @visible — promotes this finding from advisory to
   *  blocking under --fail-on-tagged. Always false for top-level function findings, since
   *  @visible is a class-level tag. */
  tagged: boolean;
}

/** A class that accepts an audit-logger dependency but never calls it in any method. */
export interface IWiredUnusedFinding {
  file: string;
  className: string;
  fieldName: string;
  line: number;
  /** true when the class carries @visible — promotes this finding from advisory to
   *  blocking under --fail-on-tagged. */
  tagged: boolean;
}

/** A @visible-tagged exported class with no audit-logger constructor dependency at all;
 *  untagged classes are never checked for this since absence of a logger is only a gap
 *  when the class explicitly declared it must be covered. */
export interface IMissingLoggerFinding {
  file: string;
  className: string;
  line: number;
}

/** Result of analyzing one class declaration. */
export interface IAnalyzeClassResult {
  findings: IEventCoverageFinding[];
  wiredUnused: IWiredUnusedFinding | null;
}

/** Result of analyzing every exported class/function at the top level of a source file. */
export interface IAnalyzeSourceFileResult {
  findings: IEventCoverageFinding[];
  wiredUnused: IWiredUnusedFinding[];
  missingLogger: IMissingLoggerFinding[];
}

// ── Type-name classification ──

const AUDIT_LOGGER_TYPE_NAMES = new Set(["IEventLogger", "EventLogger", "IEventRegistry", "EventRegistry"]);

/** True when `name` is one of the four audit-logger binding type names. */
export function isAuditLoggerTypeName(name: string): boolean {
  return AUDIT_LOGGER_TYPE_NAMES.has(name);
}

/** True when `name` follows Exaix's `IFoo` component-interface naming convention and is not
 *  itself an audit-logger type. */
export function isComponentTypeName(name: string): boolean {
  return /^I[A-Z]/.test(name) && !isAuditLoggerTypeName(name);
}

/** Returns the bare type name for a TypeNode, unwrapping `Opt<X, Reason>` to `X`'s name.
 *  Returns null for type shapes with no single resolvable name (unions, literals, etc.). */
export function unwrapOptTypeName(typeNode: ts.TypeNode): string | null {
  if (!ts.isTypeReferenceNode(typeNode)) return null;
  const name = typeNode.typeName.getText();
  if (name === "Opt" && typeNode.typeArguments && typeNode.typeArguments.length > 0) {
    const inner = typeNode.typeArguments[0];
    return ts.isTypeReferenceNode(inner) ? inner.typeName.getText() : null;
  }
  return name;
}

// ── Visibility tag (@visible) ──

const VISIBLE_TAG_PATTERN = /@visible\b/;

/** True when `cls`'s own leading JSDoc comment carries the `@visible` tag, escalating its
 *  coverage findings from advisory to blocking under `--fail-on-tagged`. Scoped to the
 *  class's own leading comment range, not the whole file header. */
export function hasVisibleTag(cls: ts.ClassDeclaration, sourceText: string): boolean {
  const ranges = ts.getLeadingCommentRanges(sourceText, cls.getFullStart());
  if (!ranges) return false;
  return ranges.some((r) => VISIBLE_TAG_PATTERN.test(sourceText.slice(r.pos, r.end)));
}

const LOG_METHOD_FAMILY_DECORATOR_NAMES = new Set(["LogMethod", "LogSyncMethod", "LogGeneratorMethod"]);

/** True when `expr` is a literal `DomainEventType.X` property access, or an object literal
 *  (an `ILifecycleActions`/`IGeneratorLifecycleActions` value) whose every property is
 *  itself a literal `DomainEventType.X`. */
function isRegisteredActionExpression(expr: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text === "DomainEventType";
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.length > 0 &&
      expr.properties.every((property) =>
        ts.isPropertyAssignment(property) && isRegisteredActionExpression(property.initializer)
      );
  }
  return false;
}

/** True when a decorator carries a registered DomainEventType action. */
export function isDecoratorCovered(method: ts.MethodDeclaration): boolean {
  if (!ts.canHaveDecorators(method)) return false;
  const decorators = ts.getDecorators(method);
  if (!decorators) return false;
  return decorators.some((decorator) => {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return false;
    if (!LOG_METHOD_FAMILY_DECORATOR_NAMES.has(expression.expression.text)) return false;
    return expression.arguments.some((argument) => {
      if (!ts.isObjectLiteralExpression(argument)) return false;
      return argument.properties.some((property) =>
        ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "action" &&
        isRegisteredActionExpression(property.initializer)
      );
    });
  });
}

function hasModifierKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods ? mods.some((m) => m.kind === kind) : false;
}

function isParameterProperty(p: ts.ParameterDeclaration): boolean {
  return (
    hasModifierKind(p, ts.SyntaxKind.PublicKeyword) ||
    hasModifierKind(p, ts.SyntaxKind.PrivateKeyword) ||
    hasModifierKind(p, ts.SyntaxKind.ProtectedKeyword) ||
    hasModifierKind(p, ts.SyntaxKind.ReadonlyKeyword)
  );
}

function isExported(node: ts.Node): boolean {
  return hasModifierKind(node, ts.SyntaxKind.ExportKeyword);
}

function isThisExpr(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.ThisKeyword;
}

const ASSIGNMENT_OPERATOR_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** True for `=` and every compound assignment operator token (`+=`, `??=`, etc.) — the
 *  public `typescript` package does not export its internal `isAssignmentOperator` helper. */
function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return ASSIGNMENT_OPERATOR_KINDS.has(kind);
}
// ── Parameter / field discovery ──

/** Finds the first parameter (of a function, method, or constructor) whose type resolves to
 *  an audit-logger type name; returns its binding name, or null if none. */
export function findAuditParam(params: readonly ts.ParameterDeclaration[]): string | null {
  for (const p of params) {
    if (!p.type) continue;
    const typeName = unwrapOptTypeName(p.type);
    if (typeName && isAuditLoggerTypeName(typeName)) return p.name.getText();
  }
  return null;
}

/** Finds the class's audit-logger field, covering three idioms: a parameter-property (`constructor(private readonly logger?: IEventLogger)`), a plain constructor parameter assigned to a field in the constructor body (`this.audit = audit;`), and a single deps-bag parameter whose same-file-declared interface/type-alias exposes a logger-typed member, assigned as `this.audit = deps.eventLogger;` — a widespread Exaix DI convention the first two idioms can't see through. `sf` is optional and only needed for the third idiom; omit it to keep the first two working without a SourceFile in scope (e.g. a bare test fixture). Same-file only for the deps-bag idiom — a deliberate, documented limitation consistent with this script's advisory nature (a cross-file deps interface is a rarer shape; verify by hand). */
export function findClassAuditField(
  cls: ts.ClassDeclaration,
  sf?: Opt<ts.SourceFile, Reason.OptionalContext>,
): string | null {
  const ctor = cls.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
  if (!ctor) return null;

  for (const p of ctor.parameters) {
    if (!p.type || !isParameterProperty(p)) continue;
    const typeName = unwrapOptTypeName(p.type);
    if (typeName && isAuditLoggerTypeName(typeName)) return p.name.getText();
  }

  const loggerParamNames = new Set<string>();
  const depsLoggerMembers = new Map<string, Set<string>>();
  for (const p of ctor.parameters) {
    if (!p.type || isParameterProperty(p)) continue;
    const typeName = unwrapOptTypeName(p.type);
    if (!typeName) continue;
    if (isAuditLoggerTypeName(typeName)) {
      loggerParamNames.add(p.name.getText());
      continue;
    }
    if (sf) {
      const members = findLoggerMembersOfSameFileType(sf, typeName);
      if (members.size > 0) depsLoggerMembers.set(p.name.getText(), members);
    }
  }
  if ((loggerParamNames.size === 0 && depsLoggerMembers.size === 0) || !ctor.body) return null;

  let foundField: string | null = null;
  const visit = (node: ts.Node) => {
    if (foundField) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isThisExpr(node.left.expression)
    ) {
      if (ts.isIdentifier(node.right) && loggerParamNames.has(node.right.text)) {
        foundField = node.left.name.text;
        return;
      }
      if (
        ts.isPropertyAccessExpression(node.right) &&
        ts.isIdentifier(node.right.expression) &&
        depsLoggerMembers.get(node.right.expression.text)?.has(node.right.name.text)
      ) {
        foundField = node.left.name.text;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctor.body);
  return foundField;
}

/** Resolves a same-file interface (or type-alias-to-object-literal) declaration's member
 *  names whose own type is an audit-logger type — e.g. for `interface IXDeps { eventLogger:
 *  IEventLogger }`, returns `{"eventLogger"}`. The deps-bag half of `findClassAuditField`. */
function findLoggerMembersOfSameFileType(sf: ts.SourceFile, typeName: string): Set<string> {
  const members = new Set<string>();
  for (const stmt of sf.statements) {
    let body: ts.NodeArray<ts.TypeElement> | undefined;
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      body = stmt.members;
    } else if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName && ts.isTypeLiteralNode(stmt.type)) {
      body = stmt.type.members;
    }
    if (!body) continue;
    for (const m of body) {
      if (ts.isPropertySignature(m) && m.type && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) {
        const memberTypeName = unwrapOptTypeName(m.type);
        if (memberTypeName && isAuditLoggerTypeName(memberTypeName)) members.add(m.name.getText());
      }
    }
  }
  return members;
}

/** Collects constructor parameter-property field names whose type is `IFoo`-shaped
 *  (Exaix's component-interface convention), excluding the audit-logger field itself. */
export function findComponentFields(cls: ts.ClassDeclaration): string[] {
  const ctor = cls.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m));
  if (!ctor) return [];
  const fields: string[] = [];
  for (const p of ctor.parameters) {
    if (!p.type || !isParameterProperty(p)) continue;
    const typeName = unwrapOptTypeName(p.type);
    if (typeName && isComponentTypeName(typeName)) fields.push(p.name.getText());
  }
  return fields;
}

// ── Body scanning ──

const WRITE_VERB_PATTERN =
  /^(save|persist|write|insert|update|delete|remove|upsert|create|append|mkdir|rename|clear|push|flush)/i;
const DENO_WRITE_PATTERN =
  /^(writeTextFile|writeTextFileSync|writeFile|writeFileSync|mkdir|mkdirSync|remove|removeSync|rename|renameSync|truncate|truncateSync|symlink|symlinkSync)$/;
const LOG_METHOD_PATTERN = /^(info|warn|error|fatal|debug|log|emit)$/;

/** Finds `this.<field> = ...` assignments (any assignment operator), write-verb calls on another `this.<field>`, and direct Deno filesystem/subprocess writes within `body`. `excludeFieldNames` skips the audit-logger field itself (calling it is coverage, not a state change). Returns human-readable evidence strings, one per finding site. */
export function findStateChangeOperations(body: ts.Node, excludeFieldNames: Set<string>): string[] {
  const findings: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperatorKind(node.operatorToken.kind) &&
      ts.isPropertyAccessExpression(node.left) &&
      isThisExpr(node.left.expression) &&
      !excludeFieldNames.has(node.left.name.text)
    ) {
      findings.push(`this.${node.left.name.text} ${node.operatorToken.getText()} ...`);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      isThisExpr(node.expression.expression.expression) &&
      !excludeFieldNames.has(node.expression.expression.name.text) &&
      WRITE_VERB_PATTERN.test(node.expression.name.text)
    ) {
      findings.push(`this.${node.expression.expression.name.text}.${node.expression.name.text}(...)`);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Deno" &&
      DENO_WRITE_PATTERN.test(node.expression.name.text)
    ) {
      findings.push(`Deno.${node.expression.name.text}(...)`);
    }

    if (
      ts.isNewExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Deno" &&
      node.expression.name.text === "Command"
    ) {
      findings.push(`new Deno.Command(...)`);
    }

    ts.forEachChild(node, visit);
  };
  visit(body);
  return findings;
}

/** Finds calls to another constructor-injected `IFoo`-typed field within `body` — the
 *  "communication between components" category. `componentFieldNames` is the class's
 *  non-logger component-field list from `findComponentFields`. */
export function findCrossComponentCalls(body: ts.Node, componentFieldNames: readonly string[]): string[] {
  const fieldSet = new Set(componentFieldNames);
  const findings: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      isThisExpr(node.expression.expression.expression) &&
      fieldSet.has(node.expression.expression.name.text)
    ) {
      findings.push(`this.${node.expression.expression.name.text}.${node.expression.name.text}(...)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return findings;
}

/** True when `typeNode` is a type reference to `TDomainEventType`, the registered taxonomy union. */
function isDomainEventTypeRef(typeNode: Opt<ts.TypeNode, Reason.OptionalContext>): boolean {
  return typeNode !== undefined && ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === "TDomainEventType";
}

/** True when `action` resolves to a registered `DomainEventType` value: a literal `DomainEventType.X` property access, a bare parameter of the enclosing function/method typed `TDomainEventType` (e.g. `emitEvent(action: TDomainEventType, ...)`), or a property access into an object parameter whose matching member is typed `TDomainEventType` (e.g. `logActivity(event: { event_type: TDomainEventType, ... })` then `event.event_type`). One level of parameter indirection only, mirroring `callsLoggingPrivateHelper`'s own "one level only" design — the actual call-site argument isn't traced through. */
function resolvesToRegisteredAction(
  action: Opt<ts.Expression, Reason.OptionalContext>,
  enclosingParams: readonly ts.ParameterDeclaration[],
): boolean {
  if (!action) return false;
  if (ts.isPropertyAccessExpression(action) && ts.isIdentifier(action.expression)) {
    if (action.expression.text === "DomainEventType") return true;
    const objectParam = enclosingParams.find((p) =>
      ts.isIdentifier(p.name) && p.name.text === action.expression.getText()
    );
    if (!objectParam?.type || !ts.isTypeLiteralNode(objectParam.type)) return false;
    const member = objectParam.type.members.find((m): m is ts.PropertySignature =>
      ts.isPropertySignature(m) && !!m.name && ts.isIdentifier(m.name) && m.name.text === action.name.text
    );
    return isDomainEventTypeRef(member?.type);
  }
  if (ts.isIdentifier(action)) {
    const param = enclosingParams.find((p) => ts.isIdentifier(p.name) && p.name.text === action.text);
    return isDomainEventTypeRef(param?.type);
  }
  return false;
}

/** True when `body` calls the logger binding. Tagged callers may require a registered taxonomy action, resolved directly or through one level of parameter-typed indirection (see `resolvesToRegisteredAction`) — `enclosingParams` is `body`'s own owning function/method's parameter list, needed to resolve that indirection. */
export function bodyCallsAuditBinding(
  body: ts.Node,
  binding: IAuditBinding,
  requireRegisteredAction = false,
  enclosingParams: readonly ts.ParameterDeclaration[] = [],
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      const action = node.arguments[0];
      const registeredAction = resolvesToRegisteredAction(action, enclosingParams);
      if (LOG_METHOD_PATTERN.test(methodName) && (!requireRegisteredAction || registeredAction)) {
        const receiver = node.expression.expression;
        if (
          binding.isField && ts.isPropertyAccessExpression(receiver) && isThisExpr(receiver.expression) &&
          receiver.name.text === binding.name
        ) found = true;
        if (!binding.isField && ts.isIdentifier(receiver) && receiver.text === binding.name) found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** True when `body` calls a private/protected method of `cls` whose own body calls the audit binding — the "one level of indirection through a same-class helper" pattern (e.g. `processAmendment()` calling `this.emitAmendmentEvent(...)`, a private method that itself calls `this.logger.info(...)`) — confirmed real and recurring across multiple classes (RequestAnalyzer, PlanAmendmentGate, MemoryBankService, MissionReporter all centralize their actual `.info()` call in exactly this shape). Deliberately one level only: chasing arbitrarily deep call chains would make "is this method covered" unboundedly expensive and hard to reason about; a helper-of-a-helper is a smell this checker doesn't try to untangle — verify by hand. */
function callsLoggingPrivateHelper(
  body: ts.Node,
  cls: ts.ClassDeclaration,
  binding: IAuditBinding,
  requireRegisteredAction = false,
): boolean {
  const privateHelpers = new Map<string, ts.MethodDeclaration>();
  for (const member of cls.members) {
    if (
      ts.isMethodDeclaration(member) && member.body &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
      (hasModifierKind(member, ts.SyntaxKind.PrivateKeyword) || hasModifierKind(member, ts.SyntaxKind.ProtectedKeyword))
    ) {
      privateHelpers.set(member.name.getText(), member);
    }
  }
  if (privateHelpers.size === 0) return false;

  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      isThisExpr(node.expression.expression)
    ) {
      const helper = privateHelpers.get(node.expression.name.text);
      if (helper?.body && bodyCallsAuditBinding(helper.body, binding, requireRegisteredAction, helper.parameters)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** Analyzes one class declaration. Returns per-method findings for methods with a state change or cross-component call and no logger call in their own body, plus a class-level "wired but silent" finding when NO method anywhere in the class ever calls the logger (in which case per-method findings are suppressed as redundant with the class-level one). */
export function analyzeClass(cls: ts.ClassDeclaration, sf: ts.SourceFile): IAnalyzeClassResult {
  const auditField = findClassAuditField(cls, sf);
  if (!auditField) return { findings: [], wiredUnused: null };

  const className = cls.name?.getText() ?? "<anonymous>";
  const componentFields = findComponentFields(cls);
  const excludeForStateChange = new Set([auditField]);
  const tagged = hasVisibleTag(cls, sf.getFullText());

  // Class-level "is the logger used ANYWHERE" check must see every method, including private/protected helpers that centralize the actual .info()/.warn() call — a common, idiomatic pattern (e.g. a private logActivity() helper called by several public methods). Deliberately broader than the per-method loop below, which intentionally skips private/protected methods when deciding whether an INDIVIDUAL method needs its own adjacent event — a private helper isn't an independently-callable public API.
  const anyMethodCallsLogger = cls.members.some((member) =>
    ts.isMethodDeclaration(member) && member.body !== undefined &&
    (bodyCallsAuditBinding(member.body, { name: auditField, isField: true }, tagged, member.parameters) ||
      isDecoratorCovered(member))
  );
  const findings: IEventCoverageFinding[] = [];

  for (const member of cls.members) {
    if (
      !ts.isMethodDeclaration(member) || !member.body ||
      !ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)
    ) {
      continue;
    }
    if (
      hasModifierKind(member, ts.SyntaxKind.PrivateKeyword) || hasModifierKind(member, ts.SyntaxKind.ProtectedKeyword)
    ) {
      continue;
    }
    const methodName = member.name.getText();

    const covered =
      bodyCallsAuditBinding(member.body, { name: auditField, isField: true }, tagged, member.parameters) ||
      isDecoratorCovered(member) ||
      callsLoggingPrivateHelper(member.body, cls, { name: auditField, isField: true }, tagged);
    if (covered) {
      continue;
    }

    const stateOps = findStateChangeOperations(member.body, excludeForStateChange);
    const crossCalls = findCrossComponentCalls(member.body, componentFields);
    const reasons: Array<"state-change" | "cross-component-call"> = [];
    if (stateOps.length > 0) reasons.push("state-change");
    if (crossCalls.length > 0) reasons.push("cross-component-call");
    if (reasons.length === 0) continue;

    findings.push({
      file: sf.fileName,
      scopeName: `${className}.${methodName}`,
      line: lineOf(member, sf),
      reasons,
      detail: [...stateOps, ...crossCalls],
      tagged,
    });
  }

  const wiredUnused: IWiredUnusedFinding | null = anyMethodCallsLogger
    ? null
    : { file: sf.fileName, className, fieldName: auditField, line: lineOf(cls, sf), tagged };

  return { findings: wiredUnused ? [] : findings, wiredUnused };
}

/** For every `@visible`-tagged exported class with no audit-logger dependency at all (`findClassAuditField` returns null), emits an `IMissingLoggerFinding` — this is the population the tool could not see before `@visible` existed; untagged classes are never checked for this (absence of a logger is only a gap when the class explicitly declared it must be covered). */
export function findMissingLoggerFindings(
  sf: ts.SourceFile,
  fileName?: Opt<string, Reason.OptionalContext>,
): IMissingLoggerFinding[] {
  const path = fileName ?? sf.fileName;
  const sourceText = sf.getFullText();
  const findings: IMissingLoggerFinding[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt) || !isExported(stmt) || !stmt.name) continue;
    if (!hasVisibleTag(stmt, sourceText)) continue;
    if (findClassAuditField(stmt, sf) !== null) continue;
    findings.push({ file: path, className: stmt.name.getText(), line: lineOf(stmt, sf) });
  }

  return findings;
}

/** Analyzes every exported class and function at the top level of `sf`. Module-private
 *  (non-exported) declarations are out of scope — they cannot be a component's public
 *  audit-relevant surface. */
export function analyzeSourceFile(
  sf: ts.SourceFile,
  fileName?: Opt<string, Reason.OptionalContext>,
): IAnalyzeSourceFileResult {
  const path = fileName ?? sf.fileName;
  const findings: IEventCoverageFinding[] = [];
  const wiredUnused: IWiredUnusedFinding[] = [];

  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt) && isExported(stmt)) {
      const result = analyzeClass(stmt, sf);
      for (const f of result.findings) findings.push({ ...f, file: path });
      if (result.wiredUnused) wiredUnused.push({ ...result.wiredUnused, file: path });
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && isExported(stmt) && stmt.body && stmt.name) {
      const auditParam = findAuditParam(stmt.parameters);
      if (!auditParam) continue;
      if (bodyCallsAuditBinding(stmt.body, { name: auditParam, isField: false })) continue;

      const stateOps = findStateChangeOperations(stmt.body, new Set([auditParam]));
      const crossCalls = findCrossComponentCalls(stmt.body, []);
      const reasons: Array<"state-change" | "cross-component-call"> = [];
      if (stateOps.length > 0) reasons.push("state-change");
      if (crossCalls.length > 0) reasons.push("cross-component-call");
      if (reasons.length === 0) continue;

      findings.push({
        file: path,
        scopeName: stmt.name.getText(),
        line: lineOf(stmt, sf),
        reasons,
        detail: [...stateOps, ...crossCalls],
        // A top-level exported function cannot carry @visible — the tag is class-scoped.
        tagged: false,
      });
    }
  }

  const missingLogger = findMissingLoggerFindings(sf, path);

  return { findings, wiredUnused, missingLogger };
}

/** Computes whether `--fail-on-tagged` should exit the CLI with code 1 for a given result set: true when at least one `tagged: true` finding or `wiredUnused` entry exists, or any missing-logger finding exists at all — regardless of how many untagged findings are also present. Untagged findings never fail the build under this flag. */
export function shouldFailOnTagged(
  findings: readonly IEventCoverageFinding[],
  wiredUnused: readonly IWiredUnusedFinding[],
  missingLogger: readonly IMissingLoggerFinding[],
): boolean {
  return findings.some((f) => f.tagged) || wiredUnused.some((w) => w.tagged) || missingLogger.length > 0;
}

// ── CLI ──

const SCAN_ROOTS = ["packages", "packages-team", "apps"];
const TEST_PATH_PATTERNS = [/_test\.ts$/, /(^|\/)tests\//];

function isTestPath(path: string): boolean {
  return TEST_PATH_PATTERNS.some((p) => p.test(path));
}

async function collectFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    try {
      for await (const entry of walk(root, { exts: [".ts"], skip: [/node_modules/] })) {
        if (!entry.isFile) continue;
        const rel = relative(Deno.cwd(), entry.path);
        if (isTestPath(rel)) continue;
        files.push(rel);
      }
    } catch {
      // root doesn't exist in this checkout (e.g. packages-team in a Solo-only clone) — skip.
    }
  }
  return files;
}

async function collectStagedFiles(): Promise<string[]> {
  // See scripts/check_edition_graph.ts for why LD_LIBRARY_PATH is scrubbed here.
  const cmd = new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    env: { LD_LIBRARY_PATH: "" },
  });
  const { stdout } = await cmd.output();
  const paths = new TextDecoder().decode(stdout).split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return paths.filter((p) => p.endsWith(".ts") && !isTestPath(p) && SCAN_ROOTS.some((r) => p.startsWith(`${r}/`)));
}

async function main(): Promise<void> {
  const args = new Set(Deno.args);
  const staged = args.has("--staged");
  const shouldFail = args.has("--fail");
  const failOnTagged = args.has("--fail-on-tagged");
  const useJson = args.has("--json");

  const files = staged ? await collectStagedFiles() : await collectFiles(SCAN_ROOTS);

  const allFindings: IEventCoverageFinding[] = [];
  const allWiredUnused: IWiredUnusedFinding[] = [];
  const allMissingLogger: IMissingLoggerFinding[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = await Deno.readTextFile(file);
    } catch {
      continue; // staged-but-deleted file
    }
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const result = analyzeSourceFile(sf, file);
    allFindings.push(...result.findings);
    allWiredUnused.push(...result.wiredUnused);
    allMissingLogger.push(...result.missingLogger);
  }

  const total = allFindings.length + allWiredUnused.length + allMissingLogger.length;
  const taggedFailure = failOnTagged && shouldFailOnTagged(allFindings, allWiredUnused, allMissingLogger);

  if (useJson) {
    console.log(
      JSON.stringify({ findings: allFindings, wiredUnused: allWiredUnused, missingLogger: allMissingLogger }, null, 2),
    );
    if ((shouldFail && total > 0) || taggedFailure) Deno.exit(1);
    return;
  }

  if (total === 0) {
    console.log(`✅ Event coverage audit: no candidate gaps found (${files.length} file(s) scanned).`);
    return;
  }

  console.error(
    `\n⚠️  Event coverage audit: ${allWiredUnused.length} wired-but-silent class(es), ` +
      `${allFindings.length} method/function-level candidate(s), ${allMissingLogger.length} missing-logger ` +
      `@visible class(es) across ${files.length} file(s) scanned. This is advisory — verify by hand before ` +
      `treating a finding as a real gap. Known false-positive sources: an event emitted by a caller instead ` +
      `of the flagged method itself, a private helper one level removed from the flagged method that does ` +
      `the actual emission, and dynamic dispatch.\n`,
  );

  if (allMissingLogger.length > 0) {
    console.error("@visible classes with no logger dependency at all:");
    for (const m of allMissingLogger) {
      console.error(`  [${m.file}:${m.line}] class ${m.className} is @visible but accepts no audit-logger`);
    }
  }

  if (allWiredUnused.length > 0) {
    console.error("\nWired but never used:");
    for (const w of allWiredUnused) {
      const tag = w.tagged ? " [@visible]" : "";
      console.error(`  [${w.file}:${w.line}] class ${w.className} accepts '${w.fieldName}' but never calls it${tag}`);
    }
  }

  if (allFindings.length > 0) {
    console.error("\nState change / cross-component call with no adjacent event:");
    for (const f of allFindings) {
      const tag = f.tagged ? " [@visible]" : "";
      console.error(`  [${f.file}:${f.line}] ${f.scopeName} (${f.reasons.join(", ")}) — ${f.detail.join("; ")}${tag}`);
    }
  }

  console.error(
    "\nSee ARCHITECTURE.md#execution-semantics (Visibility guarantee) and docs/Reference_Data.md#event-taxonomy.",
  );
  if ((shouldFail && total > 0) || taggedFailure) Deno.exit(1);
}

if (import.meta.main) {
  await main();
}
