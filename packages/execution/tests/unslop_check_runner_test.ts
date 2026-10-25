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
import { stub } from "@std/testing/mock";
import { dirname, join } from "@std/path";
import { ExaPathDefaults } from "@exaix/shared";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { IUnslopSettings } from "@exaix/schemas";
import { EventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { SafeSubprocess } from "@exaix/core";
import { PathResolver } from "@exaix/portal";
import { createGitTestContext, type IGitTestContext, setupGitRepo } from "@exaix/git/testing";
import { readHeadSha } from "@exaix/git";
import {
  type IUnslopCheckContext,
  normalizeHostRange,
  parseUnslopHostOutput,
  runUnslopLintBatch,
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

Deno.test("snapshot-drift-before-host", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const context = contextFor(scope, base, target);
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), CLEAN_LINE);
    const dirty = await scope.runner.run(context);
    assertEquals(dirty.kind, "error");
    assertEquals(dirty.kind === "error" ? dirty.error_class : null, "UnslopSnapshotInvalid");

    await Deno.remove(join(scope.ctx.repoDir, "seed.ts"));
    const outside = join(scope.ctx.tempDir, "outside.ts");
    await Deno.writeTextFile(outside, CLEAN_LINE);
    await Deno.symlink(outside, join(scope.ctx.repoDir, "seed.ts"));
    const linked = await scope.runner.run(context);
    assertEquals(linked.kind, "error");
    await Deno.remove(join(scope.ctx.repoDir, "seed.ts"));
    await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), SEED_CAST);

    await applyTarget(scope, { "other.txt": "new head\n" });
    const moved = await scope.runner.run(context);
    assertEquals(moved.kind, "error");
    assertEquals(moved.kind === "error" ? moved.error_class : null, "UnslopSnapshotInvalid");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("snapshot-drift-during-host", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const original = SafeSubprocess.spawn.bind(SafeSubprocess);
    const spawn = stub(SafeSubprocess, "spawn", (command, args, options) => {
      const child = original(command, args, options);
      Deno.writeTextFileSync(join(scope.ctx.repoDir, "seed.ts"), CLEAN_LINE);
      return child;
    });
    try {
      const result = await scope.runner.run(contextFor(scope, base, target));
      assertEquals(spawn.calls.length, 1);
      assertEquals(result.kind, "error");
      assertEquals(result.kind === "error" ? result.error_class : null, "UnslopSnapshotInvalid");
    } finally {
      spawn.restore();
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("adapter-both-packs-real-host", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    for (const packs of [["typescript", "deno"], ["deno", "typescript"]]) {
      const result = await scope.runner.run(contextFor(scope, base, target, { check: { kind: "unslop", packs } }));
      assertEquals(result.kind, "failed");
      assert(
        result.kind === "failed" &&
          result.findings.some((finding) => finding.rule === "unslop/no-chained-type-assertions"),
      );
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("adapter-selected-pack-policy", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const original = SafeSubprocess.spawn.bind(SafeSubprocess);
    let entry = "";
    const spawn = stub(SafeSubprocess, "spawn", (command, args, options) => {
      const configPath = args[args.indexOf("--config") + 1];
      entry = Deno.readTextFileSync(join(dirname(configPath), "plugin.ts"));
      return original(command, args, options);
    });
    try {
      const result = await scope.runner.run(contextFor(scope, base, target, {
        check: { kind: "unslop", packs: ["typescript", "deno"] },
      }));
      assertEquals(result.kind, "failed");
      assert(entry.includes("DENO_RULE_PACK"), entry);
    } finally {
      spawn.restore();
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("adapter-pack-catalog-consistency", async () => {
  const scope = await makeScope();
  try {
    const catalog = await Deno.readTextFile(join(scope.ctx.tempDir, "lint", "unslop_portal_deno_catalog.json"));
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE, "catalog.json": catalog });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const unselected = await scope.runner.run(contextFor(scope, base, target, {
      check: { kind: "unslop", catalog: "catalog.json" },
    }));
    assertEquals(unselected.kind, "error");
    assertEquals(unselected.kind === "error" ? unselected.error_class : null, "UnslopCatalogInvalid");
    const selected = await scope.runner.run(contextFor(scope, base, target, {
      check: { kind: "unslop", packs: ["typescript", "deno"], catalog: "catalog.json" },
    }));
    assertEquals(selected.kind, "failed");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("host-position-exact-projection", () => {
  const host = (start: number, end: number) =>
    JSON.stringify({
      diagnostics: [{
        filename: "file:///seed.ts",
        code: "unslop/no-chained-type-assertions",
        message: "cast",
        range: { start: { line: 1, col: start }, end: { line: 1, col: end } },
      }],
      errors: [],
    });
  const valid = parseUnslopHostOutput(host(2, 5));
  assertEquals(valid?.diagnostics[0].start, { line: 1, column: 2 });
  assertEquals(valid?.diagnostics[0].end, { line: 1, column: 5 });
  assertEquals(parseUnslopHostOutput(host(9, 2)), null);
});

Deno.test("exclusive-end-changed-line-filter", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": CLEAN_LINE + "export const other = 2;\n" });
    const host = {
      diagnostics: [{
        filename: new URL(`file://${join(scope.ctx.repoDir, "seed.ts")}`).href,
        code: "unslop/no-chained-type-assertions",
        message: "fixture",
        range: { start: { line: 1, col: 0 }, end: { line: 2, col: 0 } },
      }],
      errors: [],
    };
    const original = SafeSubprocess.spawn.bind(SafeSubprocess);
    const spawn = stub(
      SafeSubprocess,
      "spawn",
      (_command, _args, options) =>
        original(
          Deno.execPath(),
          ["eval", `console.log(${JSON.stringify(JSON.stringify(host))}); Deno.exit(1);`],
          options,
        ),
    );
    try {
      assertEquals((await scope.runner.run(contextFor(scope, base, target))).kind, "passed");
      host.diagnostics[0].range.end.col = 9999;
      const invalid = await scope.runner.run(contextFor(scope, base, target));
      assertEquals(invalid.kind, "error");
      assertEquals(invalid.kind === "error" ? invalid.error_class : null, "UnslopHostProtocolInvalid");
    } finally {
      spawn.restore();
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("same-line-distinct-diagnostics", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, {
      "seed.ts": "export const first = 1 as unknown as string; export const second = 2 as unknown as string;\n",
    });
    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "failed");
    assertEquals(
      result.kind === "failed"
        ? result.findings.filter((finding) => finding.rule === "unslop/no-chained-type-assertions").length
        : 0,
      2,
    );
    assert(result.kind === "failed" && result.findings.every((finding) => Number.isInteger(finding.start_column)));
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("whole-check-setup-deadline", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const original = scope.ctx.git.runGitCommand.bind(scope.ctx.git);
    const now = Date.now.bind(Date);
    const budgetMs = 1000;
    let elapsed = 0;
    const clock = stub(Date, "now", () => now() + elapsed);
    const query = stub(scope.ctx.git, "runGitCommand", async (args, options) => {
      const result = await original(args, options);
      elapsed = budgetMs + 1;
      return result;
    });
    const spawn = stub(SafeSubprocess, "spawn", () => {
      throw new Error("host must not start");
    });
    try {
      const result = await scope.runner.run(contextFor(scope, base, target, { timeoutMs: budgetMs }));
      assertEquals(result.kind, "error");
      assertEquals(result.kind === "error" ? result.error_class : null, "UnslopTimeout");
      assertEquals(spawn.calls.length, 0);
    } finally {
      spawn.restore();
      query.restore();
      clock.restore();
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("aggregate-input-budget", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const source = "// " + "a".repeat(40000) + "\n" + CLEAN_LINE;
    const target = await applyTarget(scope, { "seed.ts": source, "other.ts": source });
    const logger = new EventLogger({ db: scope.ctx.db });
    const runner = new UnslopCheckRunner(logger, {
      settings: { ...scope.settings, git_max_bytes: 65536 },
      systemRoot: scope.ctx.tempDir,
      logger,
      pathResolver: new PathResolver(scope.ctx.config),
    });
    const result = await runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "error");
    assertEquals(result.kind === "error" ? result.error_class : null, "UnslopLimitExceeded");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("all-resource-boundaries", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const logger = new EventLogger({ db: scope.ctx.db });
    for (
      const settings of [{ ...scope.settings, file_max_bytes: 4 }, { ...scope.settings, catalog_max_bytes: 4 }, {
        ...scope.settings,
        argv_max_bytes: 4,
      }]
    ) {
      const runner = new UnslopCheckRunner(logger, {
        settings,
        systemRoot: scope.ctx.tempDir,
        logger,
        pathResolver: new PathResolver(scope.ctx.config),
      });
      const result = await runner.run(contextFor(scope, base, target));
      assertEquals(result.kind, "error");
      assertEquals(result.kind === "error" ? result.error_class : null, "UnslopLimitExceeded");
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("bounded-findings-exact-total", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "a.ts": SEED_CAST, "b.ts": SEED_CAST, "c.ts": SEED_CAST });
    const logger = new EventLogger({ db: scope.ctx.db });
    const runner = new UnslopCheckRunner(logger, {
      settings: { ...scope.settings, findings_limit: 1, batch_max_files: 1 },
      systemRoot: scope.ctx.tempDir,
      logger,
      pathResolver: new PathResolver(scope.ctx.config),
    });
    const result = await runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "failed");
    assertEquals(result.total, 12);
    assertEquals(result.findings.length, 1);
    assertEquals(result.findings[0].file, "a.ts");
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("lint-batch-stream-resource-boundaries", async (test) => {
  const root = await Deno.makeTempDir({ prefix: "unslop-batch-limits-" });
  const original = SafeSubprocess.spawn.bind(SafeSubprocess);
  const fixtures = [
    { name: "stdout overflow", source: 'console.log("x".repeat(2048));', expected: "limit" },
    { name: "stderr overflow", source: 'console.error("x".repeat(2048));', expected: "limit" },
    {
      name: "host deadline",
      source: "await new Promise((resolve) => setTimeout(resolve, 10000));",
      expected: "deadline_exceeded",
    },
    { name: "unexpected exit", source: "Deno.exit(2);", expected: "protocol_invalid" },
    { name: "malformed JSON", source: 'console.log("invalid");', expected: "protocol_invalid" },
  ];
  try {
    for (const fixture of fixtures) {
      await test.step(fixture.name, async () => {
        const spawn = stub(
          SafeSubprocess,
          "spawn",
          (_command, _args, options) => original(Deno.execPath(), ["eval", fixture.source], options),
        );
        try {
          const result = await runUnslopLintBatch({
            configPath: join(root, "deno.json"),
            files: ["./seed.ts"],
            cwd: root,
            env: {},
            clearEnv: true,
            timeoutMs: 300,
            jsonMaxBytes: 1024,
            stderrMaxBytes: 1024,
          });
          assertEquals(result.kind, fixture.expected);
        } finally {
          spawn.restore();
        }
      });
    }
    await test.step("spawn failure", async () => {
      const spawn = stub(SafeSubprocess, "spawn", () => {
        throw new Error("spawn denied");
      });
      try {
        const result = await runUnslopLintBatch({
          configPath: join(root, "deno.json"),
          files: ["./seed.ts"],
          cwd: root,
          env: {},
          clearEnv: true,
          timeoutMs: 300,
          jsonMaxBytes: 1024,
          stderrMaxBytes: 1024,
        });
        assertEquals(result.kind, "spawn_failed");
      } finally {
        spawn.restore();
      }
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("real-host-source-error-category", async () => {
  const scope = await makeScope();
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": "export const PRIVATE_SOURCE_SECRET = ;\n" });
    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "error");
    assertEquals(result.kind === "error" ? result.error_class : null, "UnslopSourceInvalid");
    assert(result.output.length > 0, "categorical errors include a safe explanation");
    assertFalse(JSON.stringify(result).includes("PRIVATE_SOURCE_SECRET"));
    assertFalse(JSON.stringify(result).includes(scope.ctx.repoDir));
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("complete-legacy-catalog-validation", async (test) => {
  for (
    const name of ["severity", "options", "schema", "empty", "missing", "oversized", "nonblob", "timeout"] as const
  ) {
    await test.step(name, async () => {
      const scope = await makeScope();
      try {
        await setupGitRepo(scope.ctx.repoDir, { initialCommit: true });
        const policy: Record<string, unknown> = JSON.parse(
          await Deno.readTextFile(join(scope.ctx.tempDir, "lint", "unslop_portal_catalog.json")),
        );
        const rules = policy.rules as Record<string, Record<string, unknown>>;
        const entry = rules["unslop/no-chained-type-assertions"]!;
        if (name === "severity") entry.severity = "bogus";
        if (name === "options") entry.options = { invalid_option: true };
        if (name === "schema") delete policy.scopes;
        if (name === "empty") {
          policy.rules = {};
          policy.tagVocabulary = {};
        }
        const path = join(scope.ctx.repoDir, "catalog.json");
        if (name === "nonblob") await Deno.symlink("seed.ts", path);
        else if (name !== "missing") {
          await Deno.writeTextFile(
            path,
            name === "oversized" ? " ".repeat(scope.settings.catalog_max_bytes + 1) : JSON.stringify(policy),
          );
        }
        await Deno.writeTextFile(join(scope.ctx.repoDir, "seed.ts"), CLEAN_LINE);
        const base = await commitAll(scope, "policy base");
        const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
        const result = await scope.runner.run(contextFor(scope, base, target, {
          check: { kind: "unslop", catalog: "catalog.json" },
          ...(name === "timeout" ? { timeoutMs: 0 } : {}),
        }));
        if (name === "empty") {
          assertEquals(result.kind, "passed");
          assertEquals(result.total, 0);
        } else {
          assertEquals(result.kind, "error");
          assertEquals(
            result.kind === "error" ? result.error_class : null,
            name === "oversized"
              ? "UnslopLimitExceeded"
              : name === "timeout"
              ? "UnslopTimeout"
              : "UnslopCatalogInvalid",
          );
          assert(result.output.length > 0);
          assertFalse(result.output.includes(scope.ctx.repoDir));
        }
      } finally {
        await scope.ctx.cleanup();
      }
    });
  }
});

Deno.test("complete-adapter-and-repair-matrix: untrusted host diagnostics", async (test) => {
  const scope = await makeScope();
  const original = SafeSubprocess.spawn.bind(SafeSubprocess);
  try {
    const base = await seedBase(scope, { "seed.ts": CLEAN_LINE, "other.ts": CLEAN_LINE });
    const target = await applyTarget(scope, { "seed.ts": SEED_CAST });
    const normal = {
      filename: new URL(`file://${join(scope.ctx.repoDir, "seed.ts")}`).href,
      code: "unslop/no-chained-type-assertions",
      message: "PRIVATE_SOURCE_SECRET",
      hint: "PRIVATE_SOURCE_SECRET",
      range: { start: { line: 1, col: 0 }, end: { line: 1, col: 1 } },
    };
    for (
      const changes of [
        { filename: "file:///tmp/outside.ts" },
        { filename: new URL(`file://${join(scope.ctx.repoDir, "other.ts")}`).href },
        { code: "foreign/no-chained-type-assertions" },
        { code: "unslop/unregistered-rule" },
        { range: { start: { line: 99, col: 0 }, end: { line: 99, col: 1 } } },
      ]
    ) {
      await test.step(JSON.stringify(changes), async () => {
        const host = JSON.stringify({ diagnostics: [{ ...normal, ...changes }], errors: [] });
        const spawn = stub(
          SafeSubprocess,
          "spawn",
          (_command, _args, options) =>
            original(Deno.execPath(), ["eval", `console.log(${JSON.stringify(host)});Deno.exit(1);`], options),
        );
        try {
          const result = await scope.runner.run(contextFor(scope, base, target));
          assertEquals(result.kind, "error");
          assertEquals(result.kind === "error" ? result.error_class : null, "UnslopHostProtocolInvalid");
          assertFalse(JSON.stringify(result).includes("PRIVATE_SOURCE_SECRET"));
        } finally {
          spawn.restore();
        }
      });
    }
  } finally {
    await scope.ctx.cleanup();
  }
});

Deno.test("complete-adapter-and-repair-matrix: real spanning function intersects an edited body line", async () => {
  const scope = await makeScope();
  try {
    const source = "export function choose(value: number): number {\n" +
      Array.from({ length: 16 }, (_, index) => `  if (value === ${index}) return ${index};`).join("\n") +
      "\n  return 0;\n}\n";
    const base = await seedBase(scope, { "seed.ts": source });
    const target = await applyTarget(scope, { "seed.ts": source.replace("  return 0;\n}", "  return 99;\n}") });
    const result = await scope.runner.run(contextFor(scope, base, target));
    assertEquals(result.kind, "failed");
    assert(
      result.findings.some((finding) =>
        finding.rule === "unslop/max-cyclomatic-complexity" && finding.start_line === 1 && finding.end_line >= 18
      ),
    );
  } finally {
    await scope.ctx.cleanup();
  }
});
