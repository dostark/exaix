/**
 * @module UnslopCheckRunnerTest
 * @path packages/execution/tests/unslop_check_runner_test.ts
 * @description Real-package tests of the portal unslop adapter: selection, changed-line filtering,
 *   budgets, host-result guards, events and cleanup.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/execution, @exaix/git/testing, @exaix/schemas]
 * @related-files [packages/execution/src/unslop_check_runner.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { ExaPathDefaults } from "@exaix/shared";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { IUnslopSettings } from "@exaix/schemas";
import { EventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { PathResolver } from "@exaix/portal";
import { createGitTestContext, type IGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { readHeadSha } from "@exaix/git";
import {
  type IUnslopCheckContext,
  normalizeHostRange,
  parseUnslopHostOutput,
  UnslopCheckRunner,
} from "@exaix/execution";
import { buildUnslopPortalAssets } from "../../../scripts/build_unslop_portal_bundle.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const SEED_CAST = "export const seed = 1 as unknown as string;\n";
const CLEAN_LINE = "export const clean = 1;\n";

interface IScope {
  readonly ctx: IGitTestContext;
  readonly settings: IUnslopSettings;
  readonly runner: UnslopCheckRunner;
}

async function makeScope(): Promise<IScope> {
  const ctx = await createGitTestContext("unslop-adapter-");
  await buildUnslopPortalAssets({ root: REPO_ROOT, out: join(ctx.tempDir, "lint") });
  await Deno.mkdir(join(ctx.tempDir, ctx.config.paths.runtime), { recursive: true });
  const settings = ConfigSchema.parse({
    system: { log_level: "info", root: ctx.tempDir },
    paths: { ...ExaPathDefaults },
  }).verification.unslop;
  const logger = new EventLogger({ db: ctx.db });
  const runner = new UnslopCheckRunner(logger, {
    settings,
    systemRoot: ctx.tempDir,
    logger,
    pathResolver: new PathResolver(ctx.config),
    knownSecrets: [],
  });
  return { ctx, settings, runner };
}

async function commitAll(scope: IScope, message: string): Promise<string> {
  await scope.ctx.git.runGitCommand(["add", "-A"]);
  await scope.ctx.git.runGitCommand(["commit", "-m", message]);
  return await readHeadSha(scope.ctx.git);
}

function contextFor(
  scope: IScope,
  baseSha: string,
  targetSha: string,
  overrides: Partial<IUnslopCheckContext> = {},
): IUnslopCheckContext {
  return {
    requestId: "request-229",
    traceId: "trace-229",
    attempt: 1,
    executionRoot: scope.ctx.repoDir,
    runId: crypto.randomUUID(),
    baseSha,
    targetSha,
    git: scope.ctx.git,
    checkIndex: 0,
    check: { kind: "unslop" },
    timeoutMs: 120_000,
    outputMaxChars: 4_000,
    ...overrides,
  };
}

async function seedBase(scope: IScope, files: Record<string, string>): Promise<string> {
  await setupGitRepo(scope.ctx.repoDir, { initialCommit: true });
  for (const [path, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(scope.ctx.repoDir, path), content);
  }
  return await commitAll(scope, "seed");
}

async function applyTarget(scope: IScope, files: Record<string, string>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(scope.ctx.repoDir, path), content);
  }
  return await commitAll(scope, "change");
}

Deno.test("adapter-pass-fail-filter", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });

    const unchanged = await scope.runner.run(contextFor(scope, base, base));
    assertEquals(unchanged.kind, "passed");
    assertEquals(unchanged.total, 0);

    const target = await applyTarget(scope, { "seed.ts": `${CLEAN_LINE}${SEED_CAST}` });
    const failed = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(failed.kind, "failed");
    assert((failed.total ?? 0) > 0);
    const finding = failed.kind === "failed" ? failed.findings[0] : undefined;
    assert(finding !== undefined, "a retained finding is reported");
    assertEquals(finding.file, "seed.ts");
    assertEquals(finding.start_line, 2);
    assert(finding.rule.startsWith("unslop/"), finding.rule);

    const noAssetRoot = await makeScope();
    try {
      const empty = await seedBase(noAssetRoot, { "seed.ts": CLEAN_LINE });
      await Deno.remove(join(noAssetRoot.ctx.tempDir, "lint"), { recursive: true });
      const passed = await noAssetRoot.runner.run(contextFor(noAssetRoot, empty, empty));
      assertEquals(passed.kind, "passed", "no changed lines needs no assets");
    } finally {
      await noAssetRoot.ctx.cleanup();
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("adapter-untouched-findings-do-not-fail", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": `${SEED_CAST}${CLEAN_LINE}` });
    const target = await applyTarget(scope, { "seed.ts": `${SEED_CAST}${CLEAN_LINE}export const extra = 2;\n` });

    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "passed", "a host exit 1 with only untouched-line findings passes");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("adapter-normalizes-host-ranges", () => {
  assertEquals(normalizeHostRange({ line: 3, column: 1 }, { line: 3, column: 5 }), {
    startLine: 3,
    endLine: 3,
  });
  assertEquals(normalizeHostRange({ line: 2, column: 4 }, { line: 4, column: 0 }), {
    startLine: 2,
    endLine: 3,
  });
  assertEquals(normalizeHostRange({ line: 2, column: 1 }, { line: 2, column: 1 }), {
    startLine: 2,
    endLine: 2,
  });
  assertEquals(normalizeHostRange({ line: 0, column: 1 }, { line: 1, column: 1 }), null);
  assertEquals(normalizeHostRange({ line: 4, column: 1 }, { line: 3, column: 1 }), null);
});

Deno.test("adapter-host-matrix", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const casts = Array.from({ length: 300 }, (_, index) => `export const v${index} = ${index} as unknown as string;`);
    const target = await applyTarget(scope, { "seed.ts": `${CLEAN_LINE}${casts.join("\n")}\n` });

    const result = await scope.runner.run(contextFor(scope, base, target, { outputMaxChars: 100 }));
    assertEquals(result.kind, "failed");
    assert((result.total ?? 0) >= 300, `expected at least 300 retained findings, got ${result.total}`);
    assertEquals(result.kind === "failed" ? result.findings.length : 0, scope.settings.findings_limit);
    assert(result.kind === "failed" && result.output.length <= 100, "repair text respects the cap");

    await Deno.remove(join(scope.ctx.tempDir, "lint", "unslop_engine.js"));
    const missing = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(missing.kind, "error");
    assertEquals(missing.kind === "error" ? missing.error_class : "", "UnslopEngineMissing");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("adapter-host-json-guards", () => {
  assertEquals(parseUnslopHostOutput("not json"), null);
  assertEquals(parseUnslopHostOutput("{}"), null);
  assertEquals(
    parseUnslopHostOutput(JSON.stringify({
      diagnostics: [{
        filename: "file:///a.ts",
        code: "unslop/x",
        message: "m",
        range: { start: { line: 0, col: 1 }, end: { line: 1, col: 1 } },
      }],
      errors: [],
    })),
    null,
  );
  const valid = parseUnslopHostOutput(JSON.stringify({
    diagnostics: [{
      filename: "file:///a.ts",
      code: "unslop/x",
      message: "m",
      hint: "h",
      range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
    }],
    errors: [],
  }));
  assert(valid !== null);
  assertEquals(valid?.diagnostics.length, 1);
});

Deno.test("adapter-resource-cleanup", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": `${CLEAN_LINE}${SEED_CAST}` });

    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "failed");

    const runtimeDir = join(scope.ctx.tempDir, ctxRuntime(scope), "unslop");
    const entries: string[] = [];
    for await (const entry of Deno.readDir(runtimeDir)) entries.push(entry.name);
    assertEquals(entries, [], "no private runtime directory survives");

    const status = await scope.ctx.git.runGitCommand(["status", "--porcelain"]);
    assertEquals(status.output.trim(), "", "the worktree has no adapter writes");
  } finally {
    await scope.ctx.cleanup();
  }
});

function ctxRuntime(scope: IScope): string {
  return scope.ctx.config.paths.runtime;
}

Deno.test("adapter-events-and-options", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": `${CLEAN_LINE}${SEED_CAST}` });
    const context = contextFor(scope, base, target);

    await scope.runner.run(context);
    await scope.ctx.db.waitForFlush();

    const started = scope.ctx.db.getActivitiesByActionType(DomainEventType.ExecutionVerificationLintCheckStarted);
    const completed = scope.ctx.db.getActivitiesByActionType(DomainEventType.ExecutionVerificationLintCheckCompleted);
    assert(started.length > 0, "the started event is journaled");
    assert(completed.length > 0, "the completed event is journaled");
    for (const row of [...started, ...completed]) {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      assertEquals(payload.run_id, context.runId);
      assertEquals(payload.check_index, 0);
      assertEquals(payload.target_sha, target);
    }
    const last = JSON.parse(completed.at(-1)!.payload) as Record<string, unknown>;
    assertEquals(last.outcome, "failed");
    assert(typeof last.total === "number" && last.total > 0);
    assertEquals(last.error_class, null);
    assertFalse(JSON.stringify(last).includes(SEED_CAST), "the event carries no source text");
  } finally {
    await scope.ctx.cleanup();
  }
});

/** The packaged engine bundle surface this test needs. */
interface IEngineBundle {
  readonly createDenoPlugin: (
    name: string,
    catalog: unknown,
    options: { rulePacks: readonly unknown[]; selection?: string },
  ) => Deno.lint.Plugin;
  readonly parseCatalog: (input: unknown, options: { scriptRuleSchemas: null; registry: unknown }) => unknown;
  readonly createRuleRegistry: (name: string, packs: readonly unknown[]) => unknown;
  readonly TYPESCRIPT_RULE_PACK: unknown;
  readonly DENO_RULE_PACK: unknown;
}

Deno.test("deno-policy-enabled", async () => {
  const root = await Deno.makeTempDir({ prefix: "unslop-deno-policy-" });
  try {
    await buildUnslopPortalAssets({ root: REPO_ROOT, out: root });
    // deno-lint-ignore exaix/dynamic-import exaix/import-inside-statement -- Generated bundle path is known only after the build.
    const engine = await import(`file://${join(root, "unslop_engine.js")}`) as IEngineBundle;
    const catalog = engine.parseCatalog(
      JSON.parse(await Deno.readTextFile(join(root, "unslop_portal_deno_catalog.json"))),
      {
        scriptRuleSchemas: null,
        registry: engine.createRuleRegistry("unslop", [engine.TYPESCRIPT_RULE_PACK, engine.DENO_RULE_PACK]),
      },
    );
    const plugin = engine.createDenoPlugin("unslop", catalog, {
      rulePacks: [engine.TYPESCRIPT_RULE_PACK, engine.DENO_RULE_PACK],
      selection: "",
    });
    const source = "// deno-lint-ignore no-explicit-any\nexport const value: any = 1;\n";
    const ids = Deno.lint.runPlugin(plugin, "seed.ts", source).map((diagnostic) =>
      (diagnostic as Deno.lint.Diagnostic & { readonly id: string }).id
    );
    assert(ids.includes("unslop/no-forbidden-lint-ignore"), ids.join(","));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("base-catalog-replacement", async () => {
  const scope = await makeScope();
  try {
    await setupGitRepo(scope.ctx.repoDir, { initialCommit: true });
    const packagedPath = join(scope.ctx.tempDir, "lint", "unslop_portal_catalog.json");
    const packaged = JSON.parse(await Deno.readTextFile(packagedPath)) as {
      rules: Record<string, { severity: string; reason?: string }>;
    };
    for (const entry of Object.values(packaged.rules)) {
      entry.severity = "off";
      entry.reason = "Disabled by the test catalog.";
    }
    await Deno.writeTextFile(join(scope.ctx.repoDir, "catalog.json"), JSON.stringify(packaged));
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), CLEAN_LINE);
    const base = await commitAll(scope, "seed");

    for (const entry of Object.values(packaged.rules)) entry.severity = "error";
    await Deno.writeTextFile(join(scope.ctx.repoDir, "catalog.json"), JSON.stringify(packaged));
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), SEED_CAST);
    const target = await commitAll(scope, "change");

    const withCatalog = await scope.runner.run(contextFor(scope, base, target, {
      check: { kind: "unslop", catalog: "catalog.json" },
    }));
    assertEquals(withCatalog.kind, "passed", "the base catalog, not the edited target catalog, applies");

    const withoutCatalog = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(withoutCatalog.kind, "failed");

    const invalid = [
      { ...packaged, rules: { "unslop/not-a-rule": { engine: "plugin", severity: "off", scope: "all", tags: [] } } },
      {
        ...packaged,
        rules: { "unslop/no-chained-type-assertions": { engine: "script", severity: "off", scope: "all", tags: [] } },
      },
      { ...packaged, layout: { src: ["packages"] } },
    ];
    for (const document of invalid) {
      await Deno.writeTextFile(join(scope.ctx.repoDir, "catalog.json"), JSON.stringify(document));
      await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), CLEAN_LINE);
      const badBase = await commitAll(scope, "invalid catalog");
      await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), SEED_CAST);
      const badTarget = await commitAll(scope, "cast");
      const result = await scope.runner.run(contextFor(scope, badBase, badTarget, {
        check: { kind: "unslop", catalog: "catalog.json" },
      }));
      assertEquals(result.kind, "error");
      assertEquals(result.kind === "error" ? result.error_class : "", "UnslopCatalogInvalid");
    }
  } finally {
    await scope.ctx.cleanup();
  }
});
