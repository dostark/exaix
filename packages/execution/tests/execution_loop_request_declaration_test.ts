/**
 * @module ExecutionLoopRequestDeclarationTest
 * @path packages/execution/tests/execution_loop_request_declaration_test.ts
 * @description Phase-197 Step 9 (GAP-1): the plan frontmatter's request_effort_declaration
 *   passthrough is an on-disk, editable parse boundary. ExecutionLoop validates each field
 *   against the declaration schemas: an injected invalid effort is DROPPED — journaled as
 *   execution.declaration_invalid and never reaching _resolvedCallOptions or
 *   agent.effort_resolved — while a valid `effort: auto` is kept and resolved to a concrete
 *   tier on the execution path.
 * @architectural-layer Execution
 * @related-files [packages/execution/src/execution_loop.ts, packages/core/src/events/domain_event_types.ts]
 */

import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs/ensure-dir";
import { join } from "@std/path";
import { ExecutionLoop } from "@exaix/execution";
import { EXECUTION_REPORT_FILENAME } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { GitService } from "@exaix/git";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { MemoryBankService } from "@exaix/memory";
import { getMemoryExecutionDir, getWorkspaceActiveDir, initTestDbService } from "@exaix/testing";
import { ToolRegistry } from "@exaix/tool-runtime";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { Config } from "@exaix/schemas";
import { createMockConfig } from "@exaix/testing";
import type { ActivityRecord } from "@exaix/storage-sqlite";

const WELL_FORMED_STEP_RESPONSE = `\`\`\`toml
[[actions]]
tool = "read_file"
[actions.params]
path = "analysis-target.txt"
\`\`\``;

/** Read-only Structured Plan reply: for the report prompt returns the report summary,
 *  otherwise a TOML action block the legacy strategy can execute. */
class ReadOnlyReportProvider implements IModelProvider {
  id = "declaration-test-provider";

  generate(prompt: string): Promise<IGenerateResult> {
    let content = "";
    if (prompt.includes("EXECUTION REPORT")) {
      content = "## Summary\n\nRead-only analysis report.";
    } else {
      content = WELL_FORMED_STEP_RESPONSE;
    }
    return Promise.resolve({
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "declaration-test-mock",
      provider: "mock",
      cost_usd: 0,
    });
  }
}

interface IRunPlanOptions {
  config: Config;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  traceId: string;
  requestId: string;
  declarationYaml: string;
}

/** Sets up a read-only structured plan (code-analyst role) with the given
 *  request_effort_declaration frontmatter and drives it through a real ExecutionLoop
 *  → PlanExecutor → AgentComposer before returning the captured activity rows. */
async function runPlanWithDeclaration(
  opts: IRunPlanOptions,
): Promise<{ rows: ActivityRecord[]; loop: ExecutionLoop }> {
  const { config, db, traceId, requestId, declarationYaml } = opts;
  const tempDir = config.system.root;
  const activeDir = getWorkspaceActiveDir(tempDir);
  await ensureDir(activeDir);
  await ensureDir(join(tempDir, "Memory", "Execution", traceId));

  const logger = new EventLogger({ db });
  const loop = new ExecutionLoop({
    config,
    db,
    logger,
    agentRole: "daemon",
    llmProvider: new ReadOnlyReportProvider(),
    gitServiceFactory: {
      createGitService(repoPath: string, eventTraceId: string) {
        return new GitService({ config, traceId: eventTraceId, agentRole: "daemon", repoPath });
      },
    },
    toolRegistryFactory: {
      createToolRegistry(eventTraceId: string, baseDir: string) {
        return new ToolRegistry({ config, traceId: eventTraceId, agentRole: "daemon", baseDir });
      },
    },
    memoryBank: new MemoryBankService(config, logger),
  });

  const planContent = `---
trace_id: "${traceId}"
request_id: ${requestId}
status: active
agent_role: code-analyst
${declarationYaml}
---

# Read-only Structured Plan

## Execution Steps

## Step 1: Analyze code

Read files and produce an analysis report.
`;
  const planPath = join(activeDir, `${requestId}.md`);
  await Deno.writeTextFile(planPath, planContent);

  await loop.processTask(planPath);
  await db.waitForFlush();
  const rows = db.getActivitiesByTrace(traceId);
  return { rows, loop };
}

async function setupShared(): Promise<{
  config: Config;
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-loop-decl-" });
  const { db, cleanup: dbCleanup } = await initTestDbService();
  const config = createMockConfig(tempDir, {
    portals: [{
      alias: "workspace",
      target_path: tempDir,
      default_branch: TEST_DEFAULT_BRANCH,
      agents_allowed: ["*"],
      operations: [],
    }],
  } as never);

  await ensureDir(join(tempDir, "Blueprints", "Agents"));
  await Deno.writeTextFile(
    join(tempDir, "Blueprints", "Agents", "code-analyst.md"),
    `---\nagent_role: "code-analyst"\nname: "Code Analyst"\nmodel: "mock:test"\ncapabilities: ["read_file", "list_directory", "grep_search"]\ncreated: "2026-02-04T00:00:00Z"\ncreated_by: "test"\nversion: "1.0.0"\n---\n\n# Code Analyst\n`,
  );
  await Deno.writeTextFile(join(tempDir, "analysis-target.txt"), "analysis source");

  return {
    config,
    db,
    cleanup: async () => {
      await dbCleanup();
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("ExecutionLoop: an injected plan-frontmatter effort is dropped and never journals agent.effort_resolved", async () => {
  const { config, db, cleanup } = await setupShared();
  try {
    const traceId = crypto.randomUUID();
    const { rows } = await runPlanWithDeclaration({
      config,
      db,
      traceId,
      requestId: "declaration-invalid",
      declarationYaml: "request_effort_declaration:\n  effort: 'x\"; y'",
    });

    const dropped = rows.filter((r) => r.action_type === "execution.declaration_invalid");
    assertEquals(dropped.length, 1, "the dropped declaration must be journaled");
    const droppedPayload = JSON.parse(dropped[0].payload) as {
      field: string;
      plan_path: string;
      value: string;
    };
    assertEquals(droppedPayload.field, "effort");
    assertEquals(dropped[0].trace_id, traceId);

    const effortResolved = rows.filter((r) => r.action_type === "agent.effort_resolved");
    assertEquals(effortResolved.length >= 1, true, "the execution path still resolves");
    const payload = JSON.parse(effortResolved[0].payload) as { effort?: string; effort_basis: string };
    assertEquals(payload.effort, undefined, "the injected value must never be resolved or journaled");
    assertEquals(payload.effort_basis, "unset");
  } finally {
    await cleanup();
  }
});

Deno.test("ExecutionLoop: a valid plan-frontmatter effort auto is kept and resolves to a concrete tier", async () => {
  const { config, db, cleanup } = await setupShared();
  try {
    const traceId = crypto.randomUUID();
    const { rows } = await runPlanWithDeclaration({
      config,
      db,
      traceId,
      requestId: "declaration-valid-auto",
      declarationYaml: "request_effort_declaration:\n  effort: auto",
    });

    const dropped = rows.filter((r) => r.action_type === "execution.declaration_invalid");
    assertEquals(dropped.length, 0, "a valid auto declaration must not be dropped");

    const effortResolved = rows.filter((r) => r.action_type === "agent.effort_resolved");
    assertEquals(effortResolved.length >= 1, true);
    const payload = JSON.parse(effortResolved[0].payload) as { effort?: string; effort_basis: string };
    assertEquals(payload.effort !== undefined, true, "auto must resolve to a concrete tier");
    assertEquals(payload.effort_basis, "heuristic");

    const reportPath = join(getMemoryExecutionDir(config.system.root), traceId, EXECUTION_REPORT_FILENAME);
    const reportExists = await Deno.stat(reportPath).then(() => true).catch(() => false);
    assertEquals(reportExists, true, "the read-only plan must still complete");
  } finally {
    await cleanup();
  }
});
