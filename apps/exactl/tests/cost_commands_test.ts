/**
 * @module CostCommandsTest
 * @path apps/exactl/tests/cost_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Unit tests for CostCommands to improve CLI coverage and verify output formatting.
 */

import { assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { CostCommands } from "../src/commands/cost_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import type { ICostTracker } from "@exaix/core/types";
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
    const output: string[] = [];
    const original = console.log;
    console.log = (...args) => {
      output.push(args.join(" "));
    };
    try {
      await command.show({ traceId: "unknown-trace" });
      // Color wrapping puts an ANSI code between the label and its value, so assert each side.
      assertStringIncludes(output.join("\n"), "Total Cost:");
      assertStringIncludes(output.join("\n"), "unknown (known subtotal $0.000000)");
      assertStringIncludes(output.join("\n"), "Total Tokens:  34");
      output.length = 0;
      await command.show({ groupBy: "model" });
      assertStringIncludes(output.join("\n"), "unknown");
      assertStringIncludes(output.join("\n"), "fixture");
    } finally {
      console.log = original;
    }
  });

  it("prints a friendly message when no cost records are found", async () => {
    const commandContext = {
      ...context,
      cost: {
        queryByCriteria: () => Promise.resolve([]),
        trackGeneration: () => Promise.resolve(0),
        persistEntry: () => Promise.resolve(),
        getTotalCost: () => 0,
        getDailyCost: () => Promise.resolve(0),
        flush: () => Promise.resolve(),
        isWithinBudget: () => Promise.resolve(true),
      } as ICostTracker,
    } as ICommandContext;

    const costCommands = new CostCommands(commandContext);
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      output.push(args.join(" "));
    };

    try {
      await costCommands.show({});
    } finally {
      console.log = originalLog;
    }

    assertStringIncludes(output.join("\n"), "No cost records found matching the criteria.");
  });

  it("renders a cost report table and includes totals", async () => {
    const commandContext = {
      ...context,
      cost: {
        queryByCriteria: () =>
          Promise.resolve([
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
          ]),
        trackGeneration: () => Promise.resolve(0),
        persistEntry: () => Promise.resolve(),
        getTotalCost: () => 0,
        getDailyCost: () => Promise.resolve(0),
        flush: () => Promise.resolve(),
        isWithinBudget: () => Promise.resolve(true),
      } as ICostTracker,
    } as ICommandContext;

    const costCommands = new CostCommands(commandContext);
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      output.push(args.join(" "));
    };

    try {
      await costCommands.show({});
    } finally {
      console.log = originalLog;
    }

    const rendered = output.join("\n");
    assertStringIncludes(rendered, "LLM Cost & Token Usage Report");
    assertStringIncludes(rendered, "Total Cost:");
    assertStringIncludes(rendered, "$0.080235");
    assertStringIncludes(rendered, "Total Tokens:");
  });

  it("renders cache-read/cache-creation token totals when records carry them", async () => {
    const commandContext = {
      ...context,
      cost: {
        queryByCriteria: () =>
          Promise.resolve([
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
          ]),
        trackGeneration: () => Promise.resolve(0),
        persistEntry: () => Promise.resolve(),
        getTotalCost: () => 0,
        getDailyCost: () => Promise.resolve(0),
        flush: () => Promise.resolve(),
        isWithinBudget: () => Promise.resolve(true),
      } as ICostTracker,
    } as ICommandContext;

    const costCommands = new CostCommands(commandContext);
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      output.push(args.join(" "));
    };

    try {
      await costCommands.show({});
    } finally {
      console.log = originalLog;
    }

    const rendered = output.join("\n");
    assertStringIncludes(rendered, "134127");
    assertStringIncludes(rendered, "19773");
    assertStringIncludes(rendered, "Total Cache Tokens:");
  });
});
