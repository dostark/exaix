/**
 * @module CostCommandsTest
 * @path apps/exactl/tests/cost_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Unit tests for CostCommands to improve CLI coverage and verify output formatting.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { CostCommands, costTotals } from "../src/commands/cost_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import type { ICostTracker, IProviderCostRecord } from "@exaix/core/types";
import type { ICommandContext } from "@exaix/cli/base.ts";
import { CostTracker } from "@exaix/core/cost";

describe("CostCommands", () => {
  let cleanup: () => Promise<void>;
  let context: ICommandContext;

  beforeEach(async () => {
    const result = await createCliTestContext();
    cleanup = result.cleanup;
    context = result.context as ICommandContext;
  });

  /** A command context whose cost tracker returns `records` for every query. */
  const contextReturning = (records: IProviderCostRecord[]): ICommandContext =>
    ({
      ...context,
      cost: {
        queryByCriteria: () => Promise.resolve(records),
        trackGeneration: () => Promise.resolve(0),
        persistEntry: () => Promise.resolve(),
        getTotalCost: () => 0,
        getDailyCost: () => Promise.resolve(0),
        flush: () => Promise.resolve(),
        isWithinBudget: () => Promise.resolve(true),
      } as ICostTracker,
    }) as ICommandContext;

  afterEach(async () => {
    await cleanup();
  });

  it("reports persisted unpriced usage as unknown in detailed and grouped views", async () => {
    const cost = new CostTracker(context.db);
    await cost.recordUnpricedGeneration("openai-chat", "fixture", {
      promptTokens: 30,
      completionTokens: 4,
      totalTokens: 34,
    }, "unknown-trace");
    const command = new CostCommands({ ...context, cost });
    const { records } = await command.report({ trace: "unknown-trace" });
    const totals = costTotals(records).join("\n");
    assertStringIncludes(totals, "Total Cost:");
    assertStringIncludes(totals, "unknown (known subtotal $0.000000)");
    assertStringIncludes(totals, "Total Tokens:  34");
    const { groups } = await command.report({ groupBy: "model" });
    assertEquals(groups?.map((group) => [group.group, group.estimatedCostUsd, group.unpricedCalls]), [[
      "fixture",
      null,
      1,
    ]]);
  });

  it("returns no records when none match the criteria", async () => {
    const commandContext = contextReturning([]);

    assertEquals((await new CostCommands(commandContext).report({})).records, []);
  });

  it("totals the cost and the tokens of a record report", async () => {
    const commandContext = contextReturning([
      {
        id: "1",
        provider: "openai",
        model: "gpt-4",
        tokens: 10,
        promptTokens: 1,
        completionTokens: 9,
        estimatedCostUsd: 0.012345,
        traceId: "trace1234",
        portal: "test-portal",
        timestamp: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "2",
        provider: "openai",
        model: "gpt-4",
        tokens: 20,
        promptTokens: 2,
        completionTokens: 18,
        estimatedCostUsd: 0.06789,
        timestamp: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const { records } = await new CostCommands(commandContext).report({});
    const rendered = costTotals(records).join("\n");
    assertStringIncludes(rendered, "Total Cost:");
    assertStringIncludes(rendered, "$0.080235");
    assertStringIncludes(rendered, "Total Tokens:");
  });

  it("totals the cache tokens when records carry them", async () => {
    const commandContext = contextReturning([
      {
        id: "1",
        provider: "claude-cli",
        model: "claude-sonnet-5",
        tokens: 2436,
        promptTokens: 8,
        completionTokens: 2428,
        estimatedCostUsd: 0.1366,
        traceId: "trace-cache",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        cacheReadTokens: 134127,
        cacheCreationTokens: 19773,
      },
    ]);

    const { records } = await new CostCommands(commandContext).report({});
    const rendered = costTotals(records).join("\n");
    assertStringIncludes(rendered, "134127");
    assertStringIncludes(rendered, "19773");
    assertStringIncludes(rendered, "Total Cache Tokens:");
  });
});
