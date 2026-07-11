/**
 * @module AdapterBreadthIntegrationTest
 * @path packages-team/model-registry-live/tests/adapters/adapter_breadth_integration_test.ts
 * @description Phase 135 Step 4 — five registered adapters (stubbed) each ingest through
 *   one contract via applyRefresh; a model shared across two providers yields 2+ route
 *   rows; capability flags and the capabilities_json blob survive the catalog
 *   write→read; admission bounds still hold across all providers.
 * @architectural-layer Team-ModelRegistry
 */
import { assertEquals } from "@std/assert";
import { initTestDbService, REGISTRY_TABLES_SQL } from "@exaix/testing";
import { createMockEventLogger } from "@exaix/testing/helpers/services/barrel.ts";
import { DefaultModelRegistry } from "@exaix/model-registry";
import type { ICatalogEntry } from "@exaix/model-registry";
import { ModelRegistryService } from "../../src/model_registry_service.ts";
import type { IAdmissionInputs } from "../../src/adapters/admission.ts";

const HEALTHY_CHECKER = { checkProvider: (_p: string) => Promise.resolve(true) };

function nativeInputs(over: Partial<IAdmissionInputs> = {}): IAdmissionInputs {
  return {
    curatedModels: new Set<string>(),
    usedModels: new Set<string>(),
    isAggregator: false,
    keepNativeWhole: true,
    topN: 25,
    benchmarkTopN: new Set(),
    ...over,
  };
}

function svcFor(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
) {
  db.instance.exec(REGISTRY_TABLES_SQL);
  const floor = new DefaultModelRegistry(HEALTHY_CHECKER);
  const svc = new ModelRegistryService(db, createMockEventLogger(), config, floor, HEALTHY_CHECKER);
  return svc;
}

Deno.test("[edge][roundtrip] supports_thinking/supports_effort survive write→read as booleans; capabilities_json blob round-trips", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const entry: ICatalogEntry = {
      model: "claude-x",
      contextWindow: 200000,
      supportsThinking: true,
      supportsEffort: false,
      rawCapabilities: { thinking: true, tools: ["a", "b"] },
    };
    await svc.applyRefresh("anthropic", [entry], nativeInputs());
    const cap = await svc.getModelCapability("anthropic", "claude-x");
    assertEquals(cap.supportsThinking, true);
    assertEquals(cap.supportsEffort, false);
    const row = db.instance.prepare(
      "SELECT capabilities_json FROM model_catalog WHERE provider = 'anthropic' AND model = 'claude-x'",
    ).get() as { capabilities_json: string };
    assertEquals(JSON.parse(row.capabilities_json), { thinking: true, tools: ["a", "b"] });
  } finally {
    await cleanup();
  }
});

Deno.test("applyRefresh over five providers persists admitted rows; a shared model yields 2+ route rows", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    // Native providers persist whole; the aggregator keeps only curated/used.
    await svc.applyRefresh("anthropic", [{ model: "claude-3.5-sonnet" }], nativeInputs());
    await svc.applyRefresh("google", [{ model: "gemini-2.5-flash" }], nativeInputs());
    await svc.applyRefresh("openai", [{ model: "gpt-4o" }], nativeInputs());
    await svc.applyRefresh("ollama", [{ model: "llama3.1:8b" }], nativeInputs());
    await svc.applyRefresh(
      "openrouter",
      [{ model: "anthropic/claude-3.5-sonnet" }, { model: "vendor/junk" }],
      nativeInputs({ isAggregator: true, curatedModels: new Set(["anthropic/claude-3.5-sonnet"]) }),
    );

    // All five providers present.
    assertEquals((await svc.getProviderModels("anthropic")).length, 1);
    assertEquals((await svc.getProviderModels("google")).length, 1);
    assertEquals((await svc.getProviderModels("openai")).length, 1);
    assertEquals((await svc.getProviderModels("ollama")).length, 1);
    // Aggregator bounded: junk dropped, curated shared model kept.
    const orRows = await svc.getProviderModels("openrouter");
    assertEquals(orRows.map((r) => r.model), ["anthropic/claude-3.5-sonnet"]);

    // A shared model identity (claude-3.5-sonnet) has 2 route rows across providers.
    const anthropicRows = await svc.getProviderModels("anthropic");
    const routeCount = anthropicRows.length + orRows.filter((r) => r.model.endsWith("claude-3.5-sonnet")).length;
    assertEquals(routeCount >= 2, true);
  } finally {
    await cleanup();
  }
});

Deno.test("[regression] admission bounds hold across all providers (400-entry aggregator stays tens)", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const svc = svcFor(db, config);
    const big: ICatalogEntry[] = [];
    for (let i = 0; i < 400; i++) big.push({ model: `vendor/m-${i}` });
    await svc.applyRefresh(
      "openrouter",
      big,
      nativeInputs({ isAggregator: true, curatedModels: new Set(["vendor/m-1"]) }),
    );
    assertEquals((await svc.getProviderModels("openrouter")).map((r) => r.model), ["vendor/m-1"]);
  } finally {
    await cleanup();
  }
});
