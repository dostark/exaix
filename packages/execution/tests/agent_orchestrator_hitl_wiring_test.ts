/**
 * @module AgentOrchestratorHitlWiringTest
 * @path packages/execution/tests/agent_orchestrator_hitl_wiring_test.ts
 * @description Phase 154 Step 3: `ToolRegistry`'s `hitlBlueprintRules` (the per-blueprint
 *   `hitl.require_secondary_approval` rules, Phase 118) was declared and evaluated by the
 *   HITL middleware but never actually populated by any production construction site —
 *   `IToolRegistryFactory.createToolRegistry(traceId, baseDir)` has no parameter for it, so
 *   a blueprint's own `hitl` rules silently did nothing for tool calls routed through
 *   `ReActLoopStrategy`/`LegacyAgentStrategy`/`McpAgentStrategy` (all of which dispatch via
 *   `AgentOrchestrator.toolRegistry.execute()`), even though the identical mechanism IS
 *   respected by `DynamicStepExecutor`'s Flow path (`agent_role.hitl?.require_secondary_approval`).
 *   `AgentOrchestrator.executeStep()` already loads the blueprint (with its parsed `.hitl`
 *   field) before dispatching to a strategy — this test proves it now forwards
 *   `blueprint.hitl?.require_secondary_approval` to `toolRegistry.setHitlBlueprintRules()`
 *   before the strategy's tool calls can reach the HITL middleware, using a spy strategy
 *   (no subprocess/live-provider dependency, same pattern as strategy_override_test.ts) and
 *   an inspecting evaluator (same pattern as tool_registry_hitl_test.ts) that only needs to
 *   observe which rules the middleware evaluates against, not the full approval flow.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_orchestrator.ts, packages/tool-runtime/src/tool_registry.ts, packages/tool-runtime/tests/tool_registry_hitl_test.ts]
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentOrchestrator, StrategyRegistry } from "@exaix/execution";
import { ToolRegistry } from "@exaix/tool-runtime";
import { initTestDbService } from "@exaix/testing";
import { createMockConfig } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { ExecutionStrategyName } from "@exaix/core";
import type { HitlRule } from "@exaix/schemas/hitl.ts";
import type { HitlRuleSource, IHitlPolicyEvaluator, LogMetadata } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";
import type { IChangesetResult, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";

/** Writes a test blueprint with a `hitl.require_secondary_approval` block in its frontmatter. */
async function writeBlueprintWithHitl(root: string, rules: HitlRule[]): Promise<void> {
  const dir = join(root, "Blueprints", "Agents");
  await Deno.mkdir(dir, { recursive: true });
  const ruleLines = rules.map((r) => `    - tool: "${r.tool}"\n      reason: "${r.reason ?? ""}"`).join("\n");
  await Deno.writeTextFile(
    join(dir, "test-agent.md"),
    `---\nname: test-agent\nmodel: gpt-4o-mini\nprovider: openai\ncapabilities: ["react"]\nhitl:\n  require_secondary_approval:\n${ruleLines}\n---\nYou are a test agent.`,
  );
}

/** Captures the `blueprintRules` array the HITL middleware evaluates against, on every call. */
class InspectingEvaluator implements IHitlPolicyEvaluator {
  received: HitlRule[][] = [];

  evaluate(
    blueprintRules: HitlRule[],
    _toolName: string,
    _toolArgs: LogMetadata,
  ): { rule: HitlRule; source: HitlRuleSource } | null {
    this.received.push(blueprintRules);
    return null;
  }
}

Deno.test("AgentOrchestrator.executeStep: forwards the loaded blueprint's hitl.require_secondary_approval to toolRegistry before the strategy runs", async () => {
  const dbService = await initTestDbService();
  try {
    const config: Config = createMockConfig(dbService.tempDir);
    const portalAlias = config.portals![0].alias;
    const expectedRules: HitlRule[] = [{ tool: "write_file", reason: "test rule" }];
    await writeBlueprintWithHitl(dbService.tempDir, expectedRules);

    const evaluator = new InspectingEvaluator();
    const toolRegistry = new ToolRegistry({ config, hitlPolicyEvaluator: evaluator });

    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.REACT,
      execute: async () => {
        // Closes over the standalone `toolRegistry` variable, the same instance injected
        // into AgentOrchestrator below — equivalent to going through `this.executor`.
        await toolRegistry.execute("write_file", { path: "x.txt", content: "y" });
        const result: IChangesetResult = {
          branch: "feat/spy",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: "spy strategy ran",
          tool_calls: 1,
          execution_time_ms: 1,
        };
        return result;
      },
    });

    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService(config.portals!);
    const executor = new AgentOrchestrator({
      config,
      db: dbService.db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
      toolRegistry,
    });

    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "req-hitl-wiring",
      request: "Write a file",
      plan: "Step 1",
      portal: portalAlias,
    };

    await executor.executeStep(context, {
      portal: portalAlias,
      agent_role: "test-agent",
    });

    assertEquals(evaluator.received.length, 1);
    assertEquals(evaluator.received[0], expectedRules);

    executor.dispose();
  } finally {
    await dbService.cleanup();
  }
});
