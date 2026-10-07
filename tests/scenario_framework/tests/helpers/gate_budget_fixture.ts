/**
 * @module GateBudgetFixture
 * @path tests/scenario_framework/tests/helpers/gate_budget_fixture.ts
 * @description Records measured fixture usage on a submitted request before daemon startup.
 * @architectural-layer Test
 * @dependencies [@exaix/core, @exaix/storage-sqlite]
 * @related-files [tests/scenario_framework/tests/integration/advanced_flow_controls_test.ts]
 */
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { PathResolver } from "@exaix/portal";
import { DatabaseService } from "@exaix/storage-sqlite";
import { DomainEventType } from "@exaix/core/events";
export async function recordGateBudgetUsage(workspaceRoot: string): Promise<void> {
  const config = new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll();
  const db = new DatabaseService(config);
  try {
    const requests = (await db.queryActivity({ actionType: "request.created" }))
      .filter((row) => JSON.parse(row.payload).via === "cli");
    if (requests.length !== 1) throw new Error("Budget fixture requires exactly one submitted request");
    for (const flowStepId of ["draft", "gate"]) {
      db.logActivity("phase205-budget-fixture", DomainEventType.LlmUsageRecorded, flowStepId, {
        provider: "mock",
        model: "phase205-fixture",
        cost_usd: 0.005,
        input_tokens: 100,
        output_tokens: 200,
        flowStepId,
        fixture_usage: true,
      }, requests[0].trace_id);
    }
    await db.waitForFlush();
  } finally {
    await db.close();
  }
}

export async function activateGateBudgetRequest(workspaceRoot: string): Promise<void> {
  const config = new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll();
  const resolver = new PathResolver(config);
  const directory = await resolver.resolve("@Workspace/Requests");
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const file = await resolver.resolve(`@Workspace/Requests/${entry.name}`);
    await Deno.writeTextFile(file, await Deno.readTextFile(file));
  }
}
