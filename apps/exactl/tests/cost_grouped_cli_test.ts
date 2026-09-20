/**
 * @module CostGroupedCliTest
 * @path apps/exactl/tests/cost_grouped_cli_test.ts
 * @description Exercises grouped cost output through the real CLI command tree and persisted costs.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/cost_commands.ts]
 */

import { assertRejects, assertStringIncludes } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { CostCommands } from "../src/commands/cost_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("exactl cost --group-by model renders totals from provider_costs", async () => {
  const { db, cleanup } = await createCliTestContext();
  try {
    const tracker = new CostTracker(db);
    await tracker.trackGeneration("anthropic", "sonnet", {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      costUsd: 0.1,
    });
    await tracker.trackGeneration("anthropic", "sonnet", {
      promptTokens: 20,
      completionTokens: 3,
      totalTokens: 23,
      costUsd: 0.2,
    });
    await tracker.trackGeneration("openai", "gpt", {
      promptTokens: 5,
      completionTokens: 1,
      totalTokens: 6,
      costUsd: 0.05,
    });
    await tracker.flush();
    await withTestMod(async (mod, ctx) => {
      ctx.context.cost = tracker;
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => output.push(args.join(" "));
      try {
        await mod.__test_command.parse(["cost", "--group-by", "model"]);
      } finally {
        console.log = originalLog;
      }
      const rendered = output.join("\n");
      assertStringIncludes(rendered, "sonnet");
      assertStringIncludes(rendered, "gpt");
      assertStringIncludes(rendered, "$0.300000");
      assertStringIncludes(rendered, "$0.050000");
    });
  } finally {
    await cleanup();
  }
});

Deno.test("cost role grouping rejects while role attribution is unavailable", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const command = new CostCommands(context);
    await assertRejects(() => command.show({ groupBy: "role" }), Error, "not available in this build");
  } finally {
    await cleanup();
  }
});

Deno.test("CostCommands.show renders grouped totals directly", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    const tracker = new CostTracker(db);
    context.cost = tracker;
    await tracker.trackGeneration("anthropic", "sonnet", {
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
      costUsd: 0.125,
      cacheReadTokens: 12,
      cacheCreationTokens: 3,
    });
    await tracker.flush();
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => output.push(args.join(" "));
    try {
      await new CostCommands(context).show({ groupBy: "model" });
    } finally {
      console.log = originalLog;
    }
    const rendered = output.join("\n");
    assertStringIncludes(rendered, "sonnet");
    assertStringIncludes(rendered, "12");
    assertStringIncludes(rendered, "$0.125000");
  } finally {
    await cleanup();
  }
});

Deno.test("[security] cost grouping rejects unknown dimensions before querying", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    await assertRejects(
      () => new CostCommands(context).show({ groupBy: "model; DROP TABLE provider_costs" }),
      Error,
      "Invalid cost group",
    );
  } finally {
    await cleanup();
  }
});
