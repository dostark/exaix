/**
 * @module ToolRuntimeOutputContractTest
 * @path packages/mcp/tests/tool_runtime_output_contract_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Verifies that live MCP handlers return runtime payloads consistent with the manifest-declared output contract.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { ExaPathDefaults, PortalOperation } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import type { Config } from "@exaix/schemas/config.ts";
import { ApprovePlanTool, CreateRequestTool, ListPlansTool, QueryJournalTool } from "@exaix/mcp/server";
import { GitCommitTool } from "@exaix/mcp/server";
import { ListDirectoryTool } from "@exaix/mcp/server";
import { DatabaseService } from "@exaix/storage-sqlite";
import type { IApplicationContext } from "@exaix/core/types";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "@exaix/testing";
import { initActivityTableSchema } from "@exaix/testing";
import { readFixtureTextSync } from "@exaix/testing";
import {
  createPermissionsService,
  createToolContext,
  getFirstStructuredDataContent,
  getFirstTextContent,
  withToolPermissionTest,
} from "@exaix/mcp/testing";

function createMockConfig(rootDir: string): Config {
  return {
    system: {
      root: rootDir,
      log_level: "info",
      version: "1.0.0",
    },
    paths: {
      ...ExaPathDefaults,
    },
    database: {
      batch_flush_ms: 100,
      batch_max_size: 10,
      sqlite: {
        journal_mode: "WAL",
        foreign_keys: true,
        busy_timeout_ms: 1000,
      },
    },
  } as Partial<Config> as Config;
}

async function withDomainToolContext(
  run: (context: IApplicationContext, tempDir: string, config: Config, db: DatabaseService) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  const config = createMockConfig(tempDir);
  await ensureDir(join(tempDir, config.paths.runtime));
  const db = new DatabaseService(config);
  initActivityTableSchema(db);

  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    git: createStubGit(),
    provider: createStubProvider(),
    display: createStubDisplay(),
  };

  try {
    await run(context, tempDir, config, db);
  } finally {
    await db.close();
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("runtime_contract: ListDirectoryTool returns structured array data", async () => {
  await withToolPermissionTest({
    operations: [PortalOperation.READ],
    fileContent: {
      "alpha.txt": "a",
      "nested/bravo.txt": "b",
    },
  }, async (env) => {
    const handler = new ListDirectoryTool(createToolContext(env), createPermissionsService(env));
    const response = await handler.execute({
      portal: "TestPortal",
      identity_id: "test-agent",
    });

    const entries = getFirstStructuredDataContent<string[]>(response);
    assertEquals(Array.isArray(entries), true);
    assertEquals(entries.includes("alpha.txt"), true);
    assertEquals(entries.includes("nested/"), true);
  });
});

Deno.test("runtime_contract: GitCommitTool returns commit hash text", async () => {
  await withToolPermissionTest({ operations: [PortalOperation.GIT], initGit: true }, async (env) => {
    await Deno.writeTextFile(join(env.portalPath, "runtime-contract.txt"), "content");
    const handler = new GitCommitTool(createToolContext(env), createPermissionsService(env));
    const response = await handler.execute({
      portal: "TestPortal",
      message: "runtime contract commit",
      identity_id: "test-agent",
    });

    assertMatch(getFirstTextContent(response), /^[0-9a-f]{40}$/);
  });
});

Deno.test("runtime_contract: domain tools include structured data matching manifest intent", async () => {
  await withDomainToolContext(async (context, tempDir, config, db) => {
    const createRequest = new CreateRequestTool(context);
    const createRequestResponse = await createRequest.execute({
      description: "Runtime contract request",
      identity: "test-agent",
      identity_id: "user-1",
    });
    const createdRequest = getFirstStructuredDataContent<{
      id: string;
      title: string;
      status: string;
    }>(createRequestResponse);
    assertEquals(typeof createdRequest.id, "string");
    assertEquals(createdRequest.status, "pending");

    const plansDir = join(tempDir, config.paths.workspace, config.paths.plans);
    await ensureDir(plansDir);
    const planId = "runtime-contract-plan";
    const planContent = readFixtureTextSync(import.meta.url, "mcp", "domain_tools_test", "planContent.md");
    await Deno.writeTextFile(join(plansDir, `${planId}.md`), planContent);

    const listPlans = new ListPlansTool(context);
    const listPlansResponse = await listPlans.execute({
      status: "pending",
      identity_id: "user-1",
    });
    const listedPlans = getFirstStructuredDataContent<Array<{ id: string; status: string }>>(listPlansResponse);
    assertEquals(Array.isArray(listedPlans), true);
    assertEquals(listedPlans[0].id, planId);

    const approvePlanId = "runtime-approve-plan";
    const approvePlanContent = readFixtureTextSync(import.meta.url, "mcp", "domain_tools_test", "planContent_1.md");
    await Deno.writeTextFile(join(plansDir, `${approvePlanId}.md`), approvePlanContent);

    const approvePlan = new ApprovePlanTool(context);
    const approveResponse = await approvePlan.execute({
      plan_id: approvePlanId,
      identity_id: "user-1",
    });
    const approvedPlan = getFirstStructuredDataContent<{ id: string; status: string }>(approveResponse);
    assertEquals(approvedPlan.id, approvePlanId);
    assertEquals(approvedPlan.status, PlanStatus.APPROVED);

    db.logActivity("actor", "test.action", "target", { ok: true });
    const queryJournal = new QueryJournalTool(context);
    const journalResponse = await queryJournal.execute({
      identity_id: "user-1",
      limit: 10,
    });
    const journalEntries = getFirstStructuredDataContent<Array<{ action_type?: string }>>(journalResponse);
    assertEquals(Array.isArray(journalEntries), true);
    assertEquals(journalEntries.length > 0, true);
  });
});
