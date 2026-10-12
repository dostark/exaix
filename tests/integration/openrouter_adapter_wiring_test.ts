/**
 * @module OpenRouterAdapterWiringTest
 * @path tests/integration/openrouter_adapter_wiring_test.ts
 * @description Drives the OpenRouter provider through the production path: ProviderFactory builds it
 * from a parsed config, wraps it in TracedProvider with a real EventLogger, and the failure lands in
 * the real activity journal with the typed error class.
 * @architectural-layer Integration
 * @dependencies [@exaix/ai, @exaix/ai-openrouter, @exaix/core, @exaix/testing]
 * @related-files [packages/ai-openrouter/src/openrouter_provider.ts, packages/ai/src/provider_factory.ts, packages/ai/src/traced_provider.ts]
 */

import { assertEquals } from "@std/assert";
import { PricingTier } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { type Config, ConfigSchema } from "@exaix/schemas";
import { createMockConfig, initTestDbService, withEnv } from "@exaix/testing";
import { createOutputValidator } from "@exaix/tool-runtime";
import { LlmAnalyzer } from "@exaix/request";
import { RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { OPENROUTER_PROVIDER_METADATA, OpenRouterProviderFactory, PROVIDER_OPENROUTER } from "@exaix/ai-openrouter";
import { ProviderFactory, setProviderRegistryBootstrap } from "@exaix/ai/provider_factory.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";

const OPENROUTER_MODEL = "qwen/qwen3.7-flash";

function registerOpenRouter(): void {
  ProviderRegistry.clear();
  setProviderRegistryBootstrap(() => {
    if (ProviderRegistry.getSupportedProviders().includes(PROVIDER_OPENROUTER)) return;
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENROUTER, new OpenRouterProviderFactory(), {
      ...OPENROUTER_PROVIDER_METADATA,
      capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
      strengths: [...OPENROUTER_PROVIDER_METADATA.strengths],
      pricingTier: PricingTier.MEDIUM,
    });
  });
}

function openRouterConfig(root: string): Config {
  return createMockConfig(root, { ai: { provider: PROVIDER_OPENROUTER, model: OPENROUTER_MODEL } } as Partial<Config>);
}

interface IFailedPayload {
  error_type?: string;
  error?: string;
}

Deno.test({
  name:
    "[integration] a ProviderFactory-built OpenRouter provider journals llm.call.failed with error_type OpenRouterRoutingError for a stubbed routing 404",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, tempDir, cleanup } = await initTestDbService();
    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: "No endpoints found that can handle the requested parameters.",
              metadata: { provider_name: "Alibaba" },
            },
          }),
          { status: 404 },
        ),
      );
    }) as typeof fetch;
    registerOpenRouter();
    try {
      await withEnv(
        {
          OPENROUTER_API_KEY: "sk-or-test",
          EXA_TEST_ENABLE_PAID_LLM: "1",
          EXA_LLM_PROVIDER: null,
          EXA_LLM_MODEL: null,
          EXA_LLM_BASE_URL: null,
          EXA_LLM_ENDPOINT: null,
        },
        async () => {
          const logger = new EventLogger({ db });
          const provider = await ProviderFactory.create(openRouterConfig(tempDir), db, logger);
          const traceId = crypto.randomUUID();
          let thrown: Error | undefined;
          try {
            await provider.generate("hi", { traceId });
          } catch (error) {
            thrown = error as Error;
          }
          assertEquals(thrown?.name, "OpenRouterRoutingError");
          assertEquals(fetchCalls, 1);

          await db.waitForFlush();
          const events = await db.getActivitiesByTraceSafe(traceId);
          const failed = events.find((event) => event.action_type === DomainEventType.LlmCallFailed);
          if (!failed) throw new Error("llm.call.failed was not journaled");
          const payload = JSON.parse(failed.payload ?? "{}") as IFailedPayload;
          assertEquals(payload.error_type, "OpenRouterRoutingError");
          assertEquals(payload.error?.includes("provider=Alibaba"), true);
        },
      );
    } finally {
      setProviderRegistryBootstrap(undefined);
      ProviderRegistry.clear();
      globalThis.fetch = origFetch;
      await cleanup();
    }
  },
});

interface IWireProvider {
  require_parameters?: boolean;
}

async function wireProviderBlock(
  operatorRouting: Record<string, boolean> | undefined,
): Promise<IWireProvider | undefined> {
  const { db, tempDir, cleanup } = await initTestDbService();
  const origFetch = globalThis.fetch;
  let sent: { provider?: IWireProvider } = {};
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse((init?.body as string) ?? "{}");
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
  }) as typeof fetch;
  registerOpenRouter();
  try {
    const config = ConfigSchema.parse({
      system: { root: tempDir },
      ai: { provider: PROVIDER_OPENROUTER, model: OPENROUTER_MODEL },
      ai_openrouter: operatorRouting ? { routing: { provider: operatorRouting } } : {},
    });
    await withEnv(
      {
        OPENROUTER_API_KEY: "sk-or-test",
        EXA_TEST_ENABLE_PAID_LLM: "1",
        EXA_LLM_PROVIDER: null,
        EXA_LLM_MODEL: null,
        EXA_LLM_BASE_URL: null,
        EXA_LLM_ENDPOINT: null,
      },
      async () => {
        const provider = await ProviderFactory.create(config, db, new EventLogger({ db }));
        await provider.generate("hi", { tools: [{ name: "read_file", inputSchema: { type: "object" } }] });
      },
    );
    return sent.provider;
  } finally {
    setProviderRegistryBootstrap(undefined);
    ProviderRegistry.clear();
    globalThis.fetch = origFetch;
    await cleanup();
  }
}

Deno.test({
  name: "[integration] a ProviderFactory-built provider sends require_parameters true for a tool request by default",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assertEquals(await wireProviderBlock(undefined), { require_parameters: true });
  },
});

Deno.test({
  name:
    "[integration] a parsed config with routing.provider.require_parameters=false reaches the wire body through ProviderFactory",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    assertEquals(await wireProviderBlock({ require_parameters: false }), { require_parameters: false });
  },
});

const VALID_ANALYSIS = JSON.stringify({
  goals: [{ description: "Add unit tests", explicit: true, priority: 1 }],
  requirements: [{ description: "Cover all public methods", confidence: 0.9, type: "functional", explicit: true }],
  constraints: ["No new dependencies"],
  acceptanceCriteria: ["All tests pass"],
  ambiguities: [],
  actionabilityScore: 80,
  complexity: RequestAnalysisComplexity.MEDIUM,
  taskType: RequestTaskType.TEST,
  tags: ["test"],
  referencedFiles: ["src/user_service.ts"],
});

interface IActivityRow {
  action_type: string;
  payload: string;
}

async function analyzeThroughFactory(
  reply: string,
): Promise<{ firstGoal: string; sentFormats: string[]; failedTypes: string[] }> {
  const { db, tempDir, cleanup } = await initTestDbService();
  const origFetch = globalThis.fetch;
  const sentFormats: string[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const sent = JSON.parse((init?.body as string) ?? "{}") as { response_format?: { type: string } };
    sentFormats.push(sent.response_format?.type ?? "none");
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 }),
    );
  }) as typeof fetch;
  registerOpenRouter();
  try {
    let firstGoal = "";
    await withEnv(
      {
        OPENROUTER_API_KEY: "sk-or-test",
        EXA_TEST_ENABLE_PAID_LLM: "1",
        EXA_LLM_PROVIDER: null,
        EXA_LLM_MODEL: null,
        EXA_LLM_BASE_URL: null,
        EXA_LLM_ENDPOINT: null,
      },
      async () => {
        const provider = await ProviderFactory.create(openRouterConfig(tempDir), db, new EventLogger({ db }));
        const analyzer = new LlmAnalyzer(provider, createOutputValidator({ autoRepair: false }));
        const analysis = await analyzer.analyze("Please tidy the repository", undefined);
        firstGoal = analysis.goals[0]?.description ?? "";
      },
    );
    await db.waitForFlush();
    const rows = await db.preparedAll<IActivityRow>(
      "SELECT action_type, payload FROM activity WHERE action_type = ?",
      [DomainEventType.LlmCallFailed],
    );
    const failedTypes = rows.map((row) => (JSON.parse(row.payload) as { error_type?: string }).error_type ?? "");
    return { firstGoal, sentFormats, failedTypes };
  } finally {
    setProviderRegistryBootstrap(undefined);
    ProviderRegistry.clear();
    globalThis.fetch = origFetch;
    await cleanup();
  }
}

Deno.test({
  name:
    "[integration] LlmAnalyzer.analyze through a factory-built OpenRouter provider sends response_format and returns the LLM analysis for a schema-valid reply",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await analyzeThroughFactory(VALID_ANALYSIS);
    assertEquals(result.firstGoal, "Add unit tests");
    assertEquals(result.sentFormats.length > 0 && result.sentFormats.every((format) => format !== "none"), true);
    assertEquals(result.failedTypes, []);
  },
});

Deno.test({
  name:
    "[integration] a schema-invalid reply makes LlmAnalyzer.analyze fall back and journals llm.call.failed with error_type ProviderProtocolError",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const result = await analyzeThroughFactory("Sure, here is the analysis you asked for.");
    assertEquals(result.firstGoal === "Add unit tests", false);
    assertEquals(result.failedTypes, ["ProviderProtocolError"]);
  },
});
