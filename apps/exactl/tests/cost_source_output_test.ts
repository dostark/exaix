/**
 * @module CostSourceOutputTest
 * @path apps/exactl/tests/cost_source_output_test.ts
 * @description Runs `log cost` over persisted costs of each source and checks the source column, the source shares and the grouping by service.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core/cost, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/command_builders/log_command.ts, apps/exactl/src/commands/cost_commands.ts]
 */

import "./helpers/set_test_mode.ts";
import { assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { CostTracker } from "@exaix/core/cost";
import { COST_SOURCE_ESTIMATE } from "@exaix/core/types";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { withTestMod } from "./helpers/test_utils.ts";

const TOKENS = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
const REGISTRY_INPUT_PRICE = 1;
const REGISTRY_OUTPUT_PRICE = 2;

interface ICostRow {
  model: string;
  service: string | null;
  cost_source: string;
  estimated_cost_usd: number;
}

interface IGroupRow {
  group: string;
  unpricedCalls: number;
  cost_by_source: Record<string, number>;
  share_by_source: Record<string, number> | null;
}

/** Seeds one record of each source: reported by the provider, computed from the registry and a blended estimate. */
async function seedSources(tracker: CostTracker): Promise<void> {
  await tracker.trackGeneration("openai", "reported", { ...TOKENS, costUsd: 5 }, "t-1", "portal", { service: "svc-a" });
  tracker.setPricingLookup({
    getModelPricing: (provider: string, model: string) =>
      Promise.resolve(
        model === "computed"
          ? {
            provider,
            model,
            provenance: "endpoint" as const,
            inputPerMtok: REGISTRY_INPUT_PRICE,
            outputPerMtok: REGISTRY_OUTPUT_PRICE,
          }
          : { provider, model, provenance: "endpoint" as const },
      ),
  });
  await tracker.trackGeneration("openai", "computed", TOKENS, "t-2", "portal", { service: "svc-a" });
  await tracker.trackGeneration(
    "anthropic",
    "blended",
    {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    "t-3",
    "portal",
    { service: "svc-b" },
  );
  await tracker.flush();
}

async function runCost(args: string[]): Promise<string> {
  const { db, cleanup } = await createCliTestContext();
  try {
    const tracker = new CostTracker(db);
    await seedSources(tracker);
    let out = "";
    await withTestMod(async (mod, ctx) => {
      ctx.context.cost = tracker;
      out = (await withCapturedSink(ctx.outputSink, async () => {
        await mod.__test_command.parse(["log", "cost", ...args]);
      })).out;
    });
    return out;
  } finally {
    await cleanup();
  }
}

Deno.test("log cost shows provider_reported, registry_computed and estimated for seeded records of each kind", async () => {
  const rows = JSON.parse(await runCost(["-o", "json"])) as ICostRow[];
  const sourceOf = (model: string) => rows.find((row) => row.model === model)?.cost_source;
  assertEquals(sourceOf("reported"), "provider_reported");
  assertEquals(sourceOf("computed"), "registry_computed");
  assertEquals(sourceOf("blended"), COST_SOURCE_ESTIMATE);
  assertEquals(rows.every((row) => row.cost_source.length > 0), true);
});

Deno.test("log cost shows the source column in the table", async () => {
  const table = await runCost([]);
  assertStringIncludes(table, "Source");
  assertStringIncludes(table, "provider_reported");
  assertStringIncludes(table, "registry_computed");
  assertStringIncludes(table, "Total Cost:");
});

Deno.test("a grouped log cost report shows the share of cost per source", async () => {
  const groups = JSON.parse(await runCost(["--group-by", "service", "-o", "json"])) as IGroupRow[];
  const svcA = groups.find((group) => group.group === "svc-a");
  assertAlmostEquals(svcA?.cost_by_source.provider_reported ?? 0, 5);
  assertAlmostEquals(svcA?.cost_by_source.registry_computed ?? 0, 3);
  assertAlmostEquals(svcA?.share_by_source?.provider_reported ?? 0, 62.5);
  assertAlmostEquals(svcA?.share_by_source?.registry_computed ?? 0, 37.5);
  assertEquals(svcA?.unpricedCalls, 0);
  const svcB = groups.find((group) => group.group === "svc-b");
  assertEquals(svcB?.share_by_source?.[COST_SOURCE_ESTIMATE], 100);
});

Deno.test("log cost --group-by service sums cost per service", async () => {
  const groups = JSON.parse(await runCost(["--group-by", "service", "-o", "json"])) as {
    group: string;
    estimatedCostUsd: number;
  }[];
  assertEquals(groups.map((group) => group.group), ["svc-a", "svc-b"]);
  assertAlmostEquals(groups[0].estimatedCostUsd, 8);
});

Deno.test("log cost --group-by model shares the cost per source too", async () => {
  const groups = JSON.parse(await runCost(["--group-by", "model", "-o", "json"])) as IGroupRow[];
  assertEquals(groups.every((group) => group.share_by_source !== null), true);
});

Deno.test("an all-zero group has no share", async () => {
  const { db, cleanup } = await createCliTestContext();
  try {
    const tracker = new CostTracker(db);
    await tracker.trackGeneration("ollama", "free", TOKENS, "t-free", "portal", { service: "local" });
    await tracker.flush();
    let out = "";
    await withTestMod(async (mod, ctx) => {
      ctx.context.cost = tracker;
      out = (await withCapturedSink(ctx.outputSink, async () => {
        await mod.__test_command.parse(["log", "cost", "--group-by", "service", "-o", "json"]);
      })).out;
    });
    const [group] = JSON.parse(out) as IGroupRow[];
    assertEquals(group.share_by_source, null);
  } finally {
    await cleanup();
  }
});
