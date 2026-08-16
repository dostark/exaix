/**
 * @module CheckEventCoverageTest
 * @path tests/scripts/check_event_coverage_test.ts
 * @description Tests for scripts/check_event_coverage.ts — the advisory gate that AST-scans
 *   exported functions, methods, and classes for state-changing operations or cross-component
 *   calls that occur with no adjacent `IEventLogger`/`IEventRegistry` emission, and flags
 *   classes that accept a logger but never call it ("wired but silent"). Exists because
 *   ARCHITECTURE.md's "Visibility" guarantee ("every significant runtime transition emits a
 *   typed, versioned, trace-linked domain event") and the `plan`/`pre-gap-analysis`/
 *   `next-steps`/`post-gap-analysis` skills' Traceability principle had no mechanized check —
 *   only prose review could catch a missing event.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, typescript]
 * @related-files [scripts/check_event_coverage.ts]
 */

import { assertEquals } from "@std/assert";
import ts from "typescript";
import {
  analyzeClass,
  analyzeSourceFile,
  bodyCallsAuditBinding,
  findAuditParam,
  findClassAuditField,
  findComponentFields,
  findCrossComponentCalls,
  findMissingLoggerFindings,
  findStateChangeOperations,
  hasVisibleTag,
  type IEventCoverageFinding,
  type IMissingLoggerFinding,
  isAuditLoggerTypeName,
  isComponentTypeName,
  isDecoratorCovered,
  type IWiredUnusedFinding,
  shouldFailOnTagged,
  unwrapOptTypeName,
} from "../../scripts/check_event_coverage.ts";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
}

function firstFunction(sf: ts.SourceFile): ts.FunctionDeclaration {
  const found = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s));
  if (!found) throw new Error("no function declaration found in fixture");
  return found;
}

function firstClass(sf: ts.SourceFile): ts.ClassDeclaration {
  const found = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s));
  if (!found) throw new Error("no class declaration found in fixture");
  return found;
}

function allClasses(sf: ts.SourceFile): ts.ClassDeclaration[] {
  return sf.statements.filter((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s));
}

function firstMethod(cls: ts.ClassDeclaration, name: string): ts.MethodDeclaration {
  const found = cls.members.find(
    (m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.name.getText() === name,
  );
  if (!found) throw new Error(`no method named ${name} found in fixture class`);
  return found;
}

// ── unwrapOptTypeName ──

Deno.test("[unwrapOptTypeName] unwraps Opt<IEventLogger, Reason.X> to IEventLogger", () => {
  const sf = parse(`function f(logger?: Opt<IEventLogger, Reason.OptionalDependency>) {}`);
  const fn = firstFunction(sf);
  const typeNode = fn.parameters[0].type!;
  assertEquals(unwrapOptTypeName(typeNode), "IEventLogger");
});

Deno.test("[unwrapOptTypeName] returns the plain type name when not Opt-wrapped", () => {
  const sf = parse(`function f(logger?: IEventLogger) {}`);
  const fn = firstFunction(sf);
  const typeNode = fn.parameters[0].type!;
  assertEquals(unwrapOptTypeName(typeNode), "IEventLogger");
});

// ── isAuditLoggerTypeName / isComponentTypeName ──

Deno.test("[isAuditLoggerTypeName] matches IEventLogger, EventLogger, IEventRegistry, EventRegistry", () => {
  assertEquals(isAuditLoggerTypeName("IEventLogger"), true);
  assertEquals(isAuditLoggerTypeName("EventLogger"), true);
  assertEquals(isAuditLoggerTypeName("IEventRegistry"), true);
  assertEquals(isAuditLoggerTypeName("EventRegistry"), true);
});

Deno.test("[isAuditLoggerTypeName] rejects unrelated type names", () => {
  assertEquals(isAuditLoggerTypeName("IModelProvider"), false);
  assertEquals(isAuditLoggerTypeName("string"), false);
  assertEquals(isAuditLoggerTypeName("ILogger"), false);
});

Deno.test("[isComponentTypeName] matches IFoo-shaped names, excludes audit-logger types", () => {
  assertEquals(isComponentTypeName("IModelProvider"), true);
  assertEquals(isComponentTypeName("IEventLogger"), false);
  assertEquals(isComponentTypeName("IEventRegistry"), false);
  assertEquals(isComponentTypeName("Config"), false);
  assertEquals(isComponentTypeName("string"), false);
});

// ── findAuditParam ──

Deno.test("[findAuditParam] finds a bare-optional IEventLogger parameter", () => {
  const sf = parse(`function f(a: string, logger?: IEventLogger) {}`);
  const fn = firstFunction(sf);
  assertEquals(findAuditParam(fn.parameters), "logger");
});

Deno.test("[findAuditParam] finds an Opt<>-wrapped EventRegistry parameter", () => {
  const sf = parse(`function f(registry?: Opt<IEventRegistry, Reason.OptionalDependency>) {}`);
  const fn = firstFunction(sf);
  assertEquals(findAuditParam(fn.parameters), "registry");
});

Deno.test("[findAuditParam] returns null when no parameter is audit-loggable", () => {
  const sf = parse(`function f(a: string, provider: IModelProvider) {}`);
  const fn = firstFunction(sf);
  assertEquals(findAuditParam(fn.parameters), null);
});

// ── findClassAuditField ──

Deno.test("[findClassAuditField] finds a parameter-property logger field", () => {
  const sf = parse(`
    class Svc {
      constructor(private readonly logger?: IEventLogger) {}
    }
  `);
  const cls = firstClass(sf);
  assertEquals(findClassAuditField(cls), "logger");
});

Deno.test("[findClassAuditField] finds a body-assigned logger field", () => {
  const sf = parse(`
    class Svc {
      private audit?: IEventLogger;
      constructor(audit?: IEventLogger) {
        this.audit = audit;
      }
    }
  `);
  const cls = firstClass(sf);
  assertEquals(findClassAuditField(cls), "audit");
});

Deno.test("[findClassAuditField] returns null when the class has no logger dependency", () => {
  const sf = parse(`
    class Svc {
      constructor(private readonly db: IDatabaseService) {}
    }
  `);
  const cls = firstClass(sf);
  assertEquals(findClassAuditField(cls), null);
});

// ── findComponentFields ──

Deno.test("[findComponentFields] collects IFoo-typed constructor parameter properties, excluding the logger", () => {
  const sf = parse(`
    class Svc {
      constructor(
        private readonly provider: IModelProvider,
        private readonly repo: IActivityRepository,
        private readonly logger?: IEventLogger,
      ) {}
    }
  `);
  const cls = firstClass(sf);
  const fields = findComponentFields(cls);
  assertEquals(fields.sort(), ["provider", "repo"]);
});

// ── findStateChangeOperations ──

Deno.test("[findStateChangeOperations] flags a direct this-field assignment", () => {
  const sf = parse(`
    class Svc {
      count = 0;
      bump(): void {
        this.count = this.count + 1;
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "bump");
  const ops = findStateChangeOperations(method.body!, new Set());
  assertEquals(ops.length > 0, true);
});

Deno.test("[findStateChangeOperations] flags a write-verb call on another field", () => {
  const sf = parse(`
    class Svc {
      save(x: string): void {
        this.repo.save(x);
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "save");
  const ops = findStateChangeOperations(method.body!, new Set());
  assertEquals(ops.length > 0, true);
});

Deno.test("[findStateChangeOperations] flags a direct Deno filesystem write", () => {
  const sf = parse(`
    class Svc {
      async persist(path: string): Promise<void> {
        await Deno.writeTextFile(path, "data");
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "persist");
  const ops = findStateChangeOperations(method.body!, new Set());
  assertEquals(ops.length > 0, true);
});

Deno.test("[findStateChangeOperations] does not flag a pure read", () => {
  const sf = parse(`
    class Svc {
      get(): number {
        return this.count;
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "get");
  const ops = findStateChangeOperations(method.body!, new Set());
  assertEquals(ops.length, 0);
});

// ── findCrossComponentCalls ──

Deno.test("[findCrossComponentCalls] flags a call on an injected IFoo-typed field", () => {
  const sf = parse(`
    class Svc {
      run(x: string): void {
        this.provider.generate(x);
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "run");
  const calls = findCrossComponentCalls(method.body!, ["provider"]);
  assertEquals(calls.length > 0, true);
});

Deno.test("[findCrossComponentCalls] does not flag a call when the field is not in the component list", () => {
  const sf = parse(`
    class Svc {
      run(x: string): void {
        this.provider.generate(x);
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "run");
  const calls = findCrossComponentCalls(method.body!, []);
  assertEquals(calls.length, 0);
});

// ── bodyCallsAuditBinding ──

Deno.test("[bodyCallsAuditBinding] detects a class-field logger call (this.logger?.info(...))", () => {
  const sf = parse(`
    class Svc {
      run(): void {
        this.logger?.info("x", null);
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "run");
  assertEquals(bodyCallsAuditBinding(method.body!, { name: "logger", isField: true }), true);
});

Deno.test("[bodyCallsAuditBinding] detects a parameter logger call (logger?.warn(...))", () => {
  const sf = parse(`
    function f(logger?: IEventLogger): void {
      logger?.warn("x", null);
    }
  `);
  const fn = firstFunction(sf);
  assertEquals(bodyCallsAuditBinding(fn.body!, { name: "logger", isField: false }), true);
});

Deno.test("[bodyCallsAuditBinding] returns false when the binding is never called", () => {
  const sf = parse(`
    class Svc {
      run(): void {
        this.count = 1;
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "run");
  assertEquals(bodyCallsAuditBinding(method.body!, { name: "logger", isField: true }), false);
});

Deno.test("[bodyCallsAuditBinding] detects an EventRegistry.emit(...) call", () => {
  const sf = parse(`
    class Svc {
      run(): void {
        this.registry.emit("source", DomainEventType.Something);
      }
    }
  `);
  const cls = firstClass(sf);
  const method = firstMethod(cls, "run");
  assertEquals(bodyCallsAuditBinding(method.body!, { name: "registry", isField: true }), true);
});

// ── analyzeClass ──

Deno.test("[analyzeClass] flags a wired-but-silent class (logger field never called anywhere)", () => {
  const sf = parse(`
    export class Svc {
      constructor(private readonly logger?: IEventLogger) {}
      save(x: string): void {
        this.repo.save(x);
      }
    }
  `);
  const cls = firstClass(sf);
  const result = analyzeClass(cls, sf);
  assertEquals(result.wiredUnused !== null, true);
});

Deno.test("[analyzeClass] does not flag a class whose logger is called somewhere in the body", () => {
  const sf = parse(`
    export class Svc {
      constructor(private readonly logger?: IEventLogger) {}
      save(x: string): void {
        this.count = x.length;
        this.logger?.info("svc.saved", null);
      }
    }
  `);
  const cls = firstClass(sf);
  const result = analyzeClass(cls, sf);
  assertEquals(result.wiredUnused, null);
});

Deno.test("[analyzeClass] flags a specific method with a state change but no logger call, even though the class is not wired-unused overall", () => {
  const sf = parse(`
    export class Svc {
      constructor(private readonly logger?: IEventLogger) {}
      quiet(): void {
        this.count = 1;
      }
      loud(): void {
        this.logger?.info("svc.loud", null);
      }
    }
  `);
  const cls = firstClass(sf);
  const result = analyzeClass(cls, sf);
  assertEquals(result.wiredUnused, null);
  assertEquals(result.findings.some((f) => f.scopeName.endsWith(".quiet")), true);
  assertEquals(result.findings.some((f) => f.scopeName.endsWith(".loud")), false);
});

Deno.test("[analyzeClass] skips a class with no audit-loggable dependency entirely", () => {
  const sf = parse(`
    export class Plain {
      quiet(): void {
        this.count = 1;
      }
    }
  `);
  const cls = firstClass(sf);
  const result = analyzeClass(cls, sf);
  assertEquals(result.wiredUnused, null);
  assertEquals(result.findings.length, 0);
});

// ── analyzeSourceFile (integration) ──

Deno.test("[analyzeSourceFile] finds a top-level exported function with a state change and no logger call", () => {
  const sf = parse(`
    export function persist(path: string, logger?: Opt<IEventLogger, Reason.OptionalDependency>): void {
      Deno.writeTextFileSync(path, "data");
    }
  `);
  const result = analyzeSourceFile(sf, "example.ts");
  assertEquals(result.findings.length, 1);
  assertEquals(result.findings[0].scopeName, "persist");
  assertEquals(result.findings[0].reasons.includes("state-change"), true);
});

Deno.test("[analyzeSourceFile] does not flag a function that logs before its state change", () => {
  const sf = parse(`
    export function persist(path: string, logger?: IEventLogger): void {
      logger?.info("persist.start", path);
      Deno.writeTextFileSync(path, "data");
    }
  `);
  const result = analyzeSourceFile(sf, "example.ts");
  assertEquals(result.findings.length, 0);
});

Deno.test("[analyzeSourceFile] ignores non-exported (module-private) functions", () => {
  const sf = parse(`
    function persist(path: string, logger?: IEventLogger): void {
      Deno.writeTextFileSync(path, "data");
    }
  `);
  const result = analyzeSourceFile(sf, "example.ts");
  assertEquals(result.findings.length, 0);
});

Deno.test("[analyzeSourceFile] reports both a wired-unused class and a method-level finding in one file", () => {
  const sf = parse(`
    export class Svc {
      constructor(private readonly logger?: IEventLogger) {}
      save(x: string): void {
        this.repo.save(x);
      }
    }
  `);
  const result = analyzeSourceFile(sf, "example.ts");
  assertEquals(result.wiredUnused.length, 1);
  assertEquals(result.wiredUnused[0].className, "Svc");
});

// ── hasVisibleTag ──

Deno.test("[hasVisibleTag] returns true when the class's own leading comment carries @visible", () => {
  const sf = parse(`
/** @visible */
export class Foo {}
`);
  const cls = firstClass(sf);
  assertEquals(hasVisibleTag(cls, sf.getFullText()), true);
});

Deno.test("[hasVisibleTag] returns false for a class with no tag", () => {
  const sf = parse(`
/** Just a regular class. */
export class Foo {}
`);
  const cls = firstClass(sf);
  assertEquals(hasVisibleTag(cls, sf.getFullText()), false);
});

Deno.test("[hasVisibleTag] distinguishes between two classes in the same file — only the tagged one matches", () => {
  const sf = parse(`
/** Untagged sibling. */
export class Foo {}

/** @visible */
export class Bar {}
`);
  const [foo, bar] = allClasses(sf);
  assertEquals(hasVisibleTag(foo, sf.getFullText()), false);
  assertEquals(hasVisibleTag(bar, sf.getFullText()), true);
});

// ── isDecoratorCovered ──

Deno.test("[isDecoratorCovered] recognizes @LogMethod(logger, ...) on a method", () => {
  const sf = parse(`
    export class Svc {
      @LogMethod(logger, { action: DomainEventType.Foo })
      async run(): Promise<void> {}
    }
  `);
  const cls = firstClass(sf);
  assertEquals(isDecoratorCovered(firstMethod(cls, "run")), true);
});

Deno.test("[isDecoratorCovered] recognizes @LogSyncMethod and @LogGeneratorMethod", () => {
  const sf = parse(`
    export class Svc {
      @LogSyncMethod(logger)
      syncRun(): void {}

      @LogGeneratorMethod(logger)
      async *streamRun(): AsyncGenerator<string> {}
    }
  `);
  const cls = firstClass(sf);
  assertEquals(isDecoratorCovered(firstMethod(cls, "syncRun")), true);
  assertEquals(isDecoratorCovered(firstMethod(cls, "streamRun")), true);
});

Deno.test("[isDecoratorCovered] returns false for an undecorated method", () => {
  const sf = parse(`
    export class Svc {
      run(): void {}
    }
  `);
  const cls = firstClass(sf);
  assertEquals(isDecoratorCovered(firstMethod(cls, "run")), false);
});

// ── analyzeClass + decorator coverage ──

Deno.test("[analyzeClass] treats a decorator-covered method as covered even with zero direct logger calls", () => {
  const sf = parse(`
    export class Svc {
      constructor(private readonly logger?: IEventLogger) {}

      @LogMethod(logger)
      save(x: string): void {
        this.repo.save(x);
      }
    }
  `);
  const cls = firstClass(sf);
  const result = analyzeClass(cls, sf);
  assertEquals(result.wiredUnused, null);
  assertEquals(result.findings.length, 0);
});

// ── findMissingLoggerFindings ──

Deno.test("[findMissingLoggerFindings] flags a @visible class with no logger dependency at all", () => {
  const sf = parse(`
/** @visible */
export class Svc {
  constructor(private readonly repo: IRepo) {}
}
`);
  const result = findMissingLoggerFindings(sf, "example.ts");
  assertEquals(result.length, 1);
  assertEquals(result[0].className, "Svc");
});

Deno.test("[findMissingLoggerFindings] does not flag an untagged class with no logger dependency", () => {
  const sf = parse(`
export class Svc {
  constructor(private readonly repo: IRepo) {}
}
`);
  const result = findMissingLoggerFindings(sf, "example.ts");
  assertEquals(result.length, 0);
});

// ── shouldFailOnTagged (the --fail-on-tagged CLI flag's decision logic) ──

Deno.test("[shouldFailOnTagged] returns false when only untagged findings exist", () => {
  const findings: IEventCoverageFinding[] = [
    { file: "a.ts", scopeName: "Svc.run", line: 1, reasons: ["state-change"], detail: [], tagged: false },
  ];
  const wiredUnused: IWiredUnusedFinding[] = [
    { file: "a.ts", className: "Svc", fieldName: "logger", line: 1, tagged: false },
  ];
  assertEquals(shouldFailOnTagged(findings, wiredUnused, []), false);
});

Deno.test("[shouldFailOnTagged] returns true when a tagged finding or missing-logger finding exists", () => {
  const taggedFinding: IEventCoverageFinding[] = [
    { file: "a.ts", scopeName: "Svc.run", line: 1, reasons: ["state-change"], detail: [], tagged: true },
  ];
  assertEquals(shouldFailOnTagged(taggedFinding, [], []), true);

  const taggedWired: IWiredUnusedFinding[] = [
    { file: "a.ts", className: "Svc", fieldName: "logger", line: 1, tagged: true },
  ];
  assertEquals(shouldFailOnTagged([], taggedWired, []), true);

  const missingLogger: IMissingLoggerFinding[] = [{ file: "a.ts", className: "Svc", line: 1 }];
  assertEquals(shouldFailOnTagged([], [], missingLogger), true);
});
