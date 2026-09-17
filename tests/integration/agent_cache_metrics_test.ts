/**
 * @module AgentCacheMetricsIntegrationTest
 * @path tests/integration/agent_cache_metrics_test.ts
 * @description Real agent event producers persist cache columns and scenario metrics
 * count execution summaries once while retaining generation-only measurements.
 * @architectural-layer Integration
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/react_loop_adapter.ts, tests/scenario_framework/runner/step_llm_metrics.ts]
 */

import { assertEquals } from "@std/assert";
import { AGENT_EVENT_EXECUTION_COMPLETED, AGENT_GENERATION_COMPLETED } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import type { IGenerateResult } from "@exaix/ai/providers";
import { AgentComposer, ExecutionContextService } from "@exaix/execution";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import { initTestDbService } from "@exaix/testing";
import { ReActLoopAdapter } from "../../packages/execution/src/react_loop_adapter.ts";
import { OutputParser } from "../../packages/execution/src/output_parser.ts";
import { readStepLlmMetrics } from "../scenario_framework/runner/step_llm_metrics.ts";

const CACHE_READ: number = 11136;
const CACHE_CREATION: number = 19773;
const GENERATIONS: number = 2;

for (const useAdapter of [false, true]) {
  for (const cacheCreationTokens of [undefined, CACHE_CREATION]) {
    Deno.test(`[agent cache metrics] ${useAdapter ? "ReActLoopAdapter" : "AgentComposer"} preserves ${cacheCreationTokens === undefined ? "Codex reads without creation" : "Claude reads and creation"} without duplicate totals`, async () => {
      const { db, config, tempDir, cleanup } = await initTestDbService();
      const logger: EventLogger = new EventLogger({ db });
      const composer: AgentComposer = new AgentComposer({
        config,
        db,
        logger,
        pathResolver: new PathResolver(config),
        permissions: new PortalPermissionsService([]),
      });
      try {
        const adapter: ReActLoopAdapter = new ReActLoopAdapter(
          new OutputParser(),
          new ExecutionContextService(config, logger, {}),
          logger,
        );
        const generator: AgentComposer | ReActLoopAdapter = useAdapter ? adapter : composer;
        const traceId: string = crypto.randomUUID();
        const usage: IGenerateResult["usage"] & { costUsd: number } = {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          cacheReadTokens: CACHE_READ,
          cacheCreationTokens,
          costUsd: 0,
        };
        await generator.logGeneration(traceId, "test-role", "fixture-model", "fixture-provider", usage);
        await db.waitForFlush();
        const generationOnly = await readStepLlmMetrics(tempDir, 0, 1000);
        assertEquals(generationOnly.tokens?.cacheRead, CACHE_READ);
        assertEquals(generationOnly.tokens?.cacheCreation, cacheCreationTokens);

        await generator.logGeneration(traceId, "test-role", "fixture-model", "fixture-provider", usage);
        await composer.logExecutionComplete(traceId, "test-role", {
          branch: "cache-metrics",
          commit_sha: "fixture",
          files_changed: [],
          description: "fixture",
          tool_calls: 0,
          execution_time_ms: 0,
        }, {
          tokens: GENERATIONS * usage.totalTokens,
          prompt_tokens: GENERATIONS * usage.promptTokens,
          completion_tokens: GENERATIONS * usage.completionTokens,
          cost_usd_estimate: 0,
          cache_read_tokens: GENERATIONS * CACHE_READ,
          cache_creation_tokens: cacheCreationTokens === undefined ? undefined : GENERATIONS * cacheCreationTokens,
        });
        await db.waitForFlush();
        const activities = db.getActivitiesByTrace(traceId);
        const generations = activities.filter((row) => row.action_type === AGENT_GENERATION_COMPLETED);
        assertEquals(generations.map((row) => row.cache_read_tokens), [CACHE_READ, CACHE_READ]);
        assertEquals(generations.map((row) => row.cache_creation_tokens), [
          cacheCreationTokens ?? null,
          cacheCreationTokens ?? null,
        ]);
        const complete = activities.find((row) => row.action_type === AGENT_EVENT_EXECUTION_COMPLETED);
        assertEquals(complete?.cache_read_tokens, GENERATIONS * CACHE_READ);
        assertEquals(
          complete?.cache_creation_tokens,
          cacheCreationTokens === undefined ? null : GENERATIONS * cacheCreationTokens,
        );

        const metrics = await readStepLlmMetrics(tempDir, 0, 1000);
        assertEquals(metrics.tokens, {
          prompt: GENERATIONS * usage.promptTokens,
          completion: GENERATIONS * usage.completionTokens,
          total: GENERATIONS * usage.totalTokens,
          cacheRead: GENERATIONS * CACHE_READ,
          cacheCreation: cacheCreationTokens === undefined ? undefined : GENERATIONS * cacheCreationTokens,
        });
      } finally {
        composer.dispose();
        await cleanup();
      }
    });
  }
}
