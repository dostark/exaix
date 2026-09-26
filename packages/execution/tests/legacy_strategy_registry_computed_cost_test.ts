/**
 * @module LegacyStrategyRegistryComputedCostTest
 * @path packages/execution/tests/legacy_strategy_registry_computed_cost_test.ts
 * @description Phase 140a Step 7 — RED-first test. LegacyAgentStrategy's cost_usd was always
 * calculateCost()'s flat, per-provider blended-rate estimate. Verifies LegacyAgentStrategy now
 * re-prices its real, already-measured result.usage token counts via
 * computeRegistryPredictedCost's per-model split price (static_overlay.ts), falling back to
 * result.cost_usd unchanged when the model has no overlay entry. cost_source stays "predicted".
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/legacy_strategy.ts, packages/execution/src/registry_computed_cost.ts]
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { LegacyAgentStrategy } from "@exaix/execution";
import type { AgentComposer, IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import type { IAgentExecutionOptions, IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

const testBlueprint = {
  name: "test-agent",
  model: "claude-sonnet-5",
  provider: "anthropic",
  capabilities: [ExecutionStrategyName.MCP],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

const testContext = {
  trace_id: "trace-88888888-8888-4888-8888-888888888888",
  request_id: "request-1",
  request: "test",
  plan: "test plan",
  portal: "test",
} satisfies IExecutionContext;

function createOptions(portal: string): IAgentExecutionOptions {
  return {
    agent_role: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

function makeMockExecutor(capture: { costUsd?: number }) {
  return {
    buildExecutionPrompt: async () => {
      await Promise.resolve();
      return "test prompt";
    },
    logGeneration: async (
      _traceId: string,
      _agentRole: string,
      _model: string,
      _provider: string,
      usage: { costUsd: number },
    ) => {
      await Promise.resolve();
      capture.costUsd = usage.costUsd;
    },
    parseAgentResponse: (
      _response: string,
      context: IExecutionContext,
      startTime: number,
    ): IChangesetResult => ({
      branch: `feat/${context.portal}`,
      commit_sha: "0000000000000000000000000000000000000000",
      files_changed: [],
      description: context.plan,
      tool_calls: 0,
      execution_time_ms: Date.now() - startTime,
    }),
    validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
    toolRegistry: {
      execute: async () => {
        await Promise.resolve();
        return { success: true };
      },
      getTools: () => [],
      getBaseDir: () => "/nonexistent-test-basedir",
    },
    getPortalConfig: () => undefined,
  };
}

Deno.test("[LegacyStrategyRegistryComputedCost] cost_usd for a known model is re-priced from the real per-model split rate, not the old flat rate", async () => {
  const capture: { costUsd?: number } = {};
  const mockExecutor = makeMockExecutor(capture);

  const provider: IModelProvider = {
    id: "legacy-registry-cost-mock-provider",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: "no TOML actions here",
        usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
        model: "claude-sonnet-5",
        provider: "anthropic",
        cost_usd: 10, // the OLD flat-rate figure
      };
    },
  };

  const strategy = new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider);
  const result = await strategy.execute(testBlueprint, testContext, createOptions("test"));

  assertAlmostEquals(capture.costUsd!, 18);
  assertAlmostEquals(result.usage!.cost_usd, 18);
  assertEquals(result.usage!.cost_source, "predicted");
});

Deno.test("[LegacyStrategyRegistryComputedCost] an unknown model falls back to result.cost_usd unchanged (no overlay entry)", async () => {
  const capture: { costUsd?: number } = {};
  const mockExecutor = makeMockExecutor(capture);

  const provider: IModelProvider = {
    id: "legacy-registry-cost-mock-provider-unknown",
    async generate(): Promise<IGenerateResult> {
      await Promise.resolve();
      return {
        content: "no TOML actions here",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: "some-unlisted-future-model",
        provider: "anthropic",
        cost_usd: 0.042,
      };
    },
  };

  const strategy = new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider);
  const result = await strategy.execute(
    { ...testBlueprint, model: "some-unlisted-future-model" },
    testContext,
    createOptions("test"),
  );

  assertEquals(capture.costUsd, 0.042);
  assertEquals(result.usage!.cost_usd, 0.042);
});

function makeAliasExecutor(portalRoot: string, captured: Array<{ tool: string; params: Record<string, string> }>) {
  return {
    ...makeMockExecutor({}),
    toolRegistry: {
      execute: (tool: string, params: Record<string, string>) => {
        captured.push({ tool, params });
        return Promise.resolve({ success: true, data: { path: `${portalRoot}/src/a.ts` } });
      },
      getTools: () => [{
        name: "write_file",
        description: "write",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
      }],
      getBaseDir: () => portalRoot,
    },
    getPortalConfig: () => ({ alias: "test", target_path: portalRoot }),
  };
}

function makeAliasProvider(tomlContent: string): IModelProvider {
  return {
    id: "legacy-alias-provider",
    generate(): Promise<IGenerateResult> {
      return Promise.resolve({
        content: tomlContent,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "unknown-model",
        provider: "mock",
        cost_usd: 0,
      });
    },
  };
}

Deno.test("[legacy_strategy][integration] aliased writes persist their original provenance through the real registry", async () => {
  const root = await Deno.makeTempDir();
  const { db, cleanup } = await initTestDbService();
  try {
    const config = createMockConfig(root);
    config.portals[0].alias = "test";
    const registry = new ToolRegistry({ config, logger: new EventLogger({ db }), traceId: testContext.trace_id });
    const executor = { ...makeAliasExecutor(root, []), toolRegistry: registry };
    const provider = makeAliasProvider(
      '```toml\n[[actions]]\ntool = "Write"\n[actions.params]\npath = "a.ts"\nfilePath = "outside.ts"\ncontent = "saved"\n```',
    );
    const result = await new LegacyAgentStrategy(executor as Partial<AgentComposer> as AgentComposer, provider)
      .execute(testBlueprint, testContext, createOptions("test"));
    assertEquals(await Deno.readTextFile(`${root}/a.ts`), "saved");
    assertEquals(result.files_changed, ["a.ts"]);
    await db.getRecentActivity();
    const events = db.getActivitiesByTrace(testContext.trace_id).filter((row) =>
      row.action_type === "tool.alias.rewritten"
    );
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(events[0].payload), {
      requestedName: "Write",
      canonicalName: "write_file",
      renamedParams: [],
      droppedParams: ["filePath"],
      entryPoint: "registry",
    });
    const aliasedPathProvider = makeAliasProvider(
      '```toml\n[[actions]]\ntool = "Write"\n[actions.params]\nfilePath = "b.ts"\ncontent = "second"\n```',
    );
    const second = await new LegacyAgentStrategy(
      executor as Partial<AgentComposer> as AgentComposer,
      aliasedPathProvider,
    )
      .execute(testBlueprint, testContext, createOptions("test"));
    assertEquals(await Deno.readTextFile(`${root}/b.ts`), "second");
    assertEquals(second.files_changed, ["b.ts"]);
    await db.getRecentActivity();
    const allEvents = db.getActivitiesByTrace(testContext.trace_id).filter((row) =>
      row.action_type === "tool.alias.rewritten"
    );
    assertEquals(allEvents.length, 2);
    assertEquals(JSON.parse(allEvents[1].payload), {
      requestedName: "Write",
      canonicalName: "write_file",
      renamedParams: [{ from: "filePath", to: "path" }],
      droppedParams: [],
      entryPoint: "registry",
    });
  } finally {
    await cleanup();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[security][legacy_strategy] a canonical write_file is portal-prefixed and write-tracked", async () => {
  const captured: Array<{ tool: string; params: Record<string, string> }> = [];
  const mockExecutor = makeAliasExecutor("/workspace/portal", captured);
  const provider = makeAliasProvider(
    '```toml\n[[actions]]\ntool = "write_file"\n[actions.params]\nfile_path = "src/a.ts"\ncontent = "x"\n```',
  );
  const result = await new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider)
    .execute(
      testBlueprint,
      testContext,
      createOptions("test"),
    );
  assertEquals(captured[0], { tool: "write_file", params: { file_path: "@test/src/a.ts", content: "x" } });
  assertEquals(result.files_changed, ["src/a.ts"]);
});

Deno.test("[security][legacy_strategy] an aliased tool name (write) is portal-prefixed and write-tracked as the canonical write_file", async () => {
  const captured: Array<{ tool: string; params: Record<string, string> }> = [];
  const mockExecutor = makeAliasExecutor("/workspace/portal", captured);
  const provider = makeAliasProvider(
    '```toml\n[[actions]]\ntool = "write"\n[actions.params]\nfile_path = "src/a.ts"\ncontent = "x"\n```',
  );
  const result = await new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider)
    .execute(
      testBlueprint,
      testContext,
      createOptions("test"),
    );
  // Dispatch keeps the ORIGINAL requested name ("write") and raw keys.
  // ToolRegistry.execute performs the real canonicalization and journals the rewrite.
  assertEquals(captured[0], { tool: "write", params: { file_path: "@test/src/a.ts", content: "x" } });
  assertEquals(result.files_changed, ["src/a.ts"]);
});

Deno.test("[security][legacy_strategy] conflicting path/file_path values retain canonical precedence and cannot change the confined destination", async () => {
  const captured: Array<{ tool: string; params: Record<string, string> }> = [];
  const mockExecutor = makeAliasExecutor("/workspace/portal", captured);
  const provider = makeAliasProvider(
    '```toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "src/a.ts"\nfile_path = "../../etc/passwd"\ncontent = "x"\n```',
  );
  await new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider).execute(
    testBlueprint,
    testContext,
    createOptions("test"),
  );
  // The canonical key `path` wins and is the one prefixed. The dropped alias `file_path`
  // stays raw and unprefixed, so it can never redirect the confined destination.
  assertEquals(captured[0], {
    tool: "write_file",
    params: { path: "@test/src/a.ts", file_path: "../../etc/passwd", content: "x" },
  });
});

Deno.test("[legacy_strategy] an already-prefixed path is not prefixed again", async () => {
  const captured: Array<{ tool: string; params: Record<string, string> }> = [];
  const mockExecutor = makeAliasExecutor("/workspace/portal", captured);
  const provider = makeAliasProvider(
    '```toml\n[[actions]]\ntool = "write_file"\n[actions.params]\npath = "@test/src/a.ts"\ncontent = "x"\n```',
  );
  await new LegacyAgentStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider).execute(
    testBlueprint,
    testContext,
    createOptions("test"),
  );
  assertEquals(captured[0], { tool: "write_file", params: { path: "@test/src/a.ts", content: "x" } });
});

Deno.test("[naming][legacy_strategy] canonical native calls retain their names and portal prefix", async () => {
  for (const tool of ["find_dependents", "run_deno_task"]) {
    const captured: Array<{ tool: string; params: Record<string, string> }> = [];
    const executor = makeAliasExecutor("/workspace/portal", captured);
    const provider = makeAliasProvider(
      `\`\`\`toml\n[[actions]]\ntool = "${tool}"\n[actions.params]\npath = "a.ts"\n\`\`\``,
    );
    await new LegacyAgentStrategy(executor as Partial<AgentComposer> as AgentComposer, provider)
      .execute(testBlueprint, testContext, createOptions("test"));
    assertEquals(captured, [{ tool, params: { path: "@test/a.ts" } }]);
  }
});
