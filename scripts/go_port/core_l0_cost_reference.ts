#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0CostReference
 * @path scripts/go_port/core_l0_cost_reference.ts
 * @description Builds differential cost cases from the real CostTracker, run against an in-memory database, for the Go reference fixtures.
 * Usage: imported by scripts/go_port/core_l0_reference.ts.
 */
import { CostTracker } from "@exaix/core/cost";
import { DomainEventType } from "@exaix/core/events";
import type { CostSource, IModelPricing, IModelPricingLookup, Opt, Reason } from "@exaix/core/types";
import { CostGroupBy } from "@exaix/core/types";
import { createMockEventLogger, initTestDbService } from "@exaix/testing";
import { ConfigSchema } from "@exaix/schemas";

const SAMPLE_ROOT = "/tmp";
const GROUP_BASE_MS = Date.UTC(2020, 0, 1);
const FIXED_NOW_MS = Date.UTC(2026, 5, 1);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SAMPLE_TRANSPORT_CLOUD = "cloud";
const SAMPLE_TRANSPORT_LOCAL = "local";

interface IRateConfig {
  rates?: { [key: string]: number };
  tolerancePct?: number;
  stalenessMaxDays?: number;
}

interface IPriceInput {
  inputPerMtok?: number;
  outputPerMtok?: number;
  provenance: IModelPricing["provenance"];
  verifiedDaysAgo?: number;
}

interface IGenerationCase {
  name: string;
  config: IRateConfig;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd?: number;
    costSource?: CostSource;
  };
  pricing?: IPriceInput;
}

const GENERATION_CASES: IGenerationCase[] = [
  { name: "anthropic blended", config: {}, provider: "anthropic", model: "m", usage: u(400, 600) },
  { name: "openai blended", config: {}, provider: "openai", model: "m", usage: u(1000, 1500) },
  { name: "google input rate", config: {}, provider: "google", model: "m", usage: u(600, 400) },
  { name: "google prompt above total", config: {}, provider: "google", model: "m", usage: u(800, 0, 500) },
  { name: "ollama free", config: {}, provider: "ollama", model: "m", usage: u(5000, 5000) },
  { name: "unknown provider", config: {}, provider: "other", model: "m", usage: u(10, 10) },
  {
    name: "provider rate override",
    config: { rates: { anthropic: 0.005 } },
    provider: "anthropic",
    model: "m",
    usage: u(500, 500),
  },
  {
    name: "model rate override",
    config: { rates: { anthropic: 0.005, "anthropic:claude": 0.01 } },
    provider: "anthropic",
    model: "claude",
    usage: u(500, 500),
  },
  {
    name: "google model rate override",
    config: { rates: { "google:gem": 0.002 } },
    provider: "google",
    model: "gem",
    usage: u(300, 700),
  },
  {
    name: "registry computed",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: u(100000, 50000),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "endpoint" },
  },
  {
    name: "registry computed small",
    config: {},
    provider: "openai",
    model: "m",
    usage: u(12345, 6789),
    pricing: { inputPerMtok: 0.15, outputPerMtok: 0.6, provenance: "endpoint" },
  },
  {
    name: "registry input only",
    config: {},
    provider: "openai",
    model: "m",
    usage: u(1000, 1000),
    pricing: { inputPerMtok: 2, provenance: "endpoint" },
  },
  {
    name: "registry without price falls back",
    config: {},
    provider: "openai",
    model: "m",
    usage: u(1000, 1000),
    pricing: { provenance: "unknown" },
  },
  {
    name: "reported wins",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(100, 100), costUsd: 0.42 },
  },
  {
    name: "reported source kept",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(100, 100), costUsd: 0.42, costSource: "registry_computed" },
  },
  {
    name: "reported zero",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(100, 100), costUsd: 0 },
  },
  {
    name: "reported negative ignored",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(100, 100), costUsd: -1 },
  },
  {
    name: "divergence above tolerance",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(100000, 50000), costUsd: 1.2 },
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "endpoint" },
  },
  {
    name: "divergence within tolerance",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(100000, 50000), costUsd: 1.0501 },
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "endpoint" },
  },
  {
    name: "divergence custom tolerance",
    config: { tolerancePct: 50 },
    provider: "anthropic",
    model: "m",
    usage: { ...u(100000, 50000), costUsd: 1.2 },
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "endpoint" },
  },
  {
    name: "divergence computed zero",
    config: {},
    provider: "anthropic",
    model: "m",
    usage: { ...u(0, 0), costUsd: 1 },
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "endpoint" },
  },
  {
    name: "stale static price",
    config: { stalenessMaxDays: 30 },
    provider: "anthropic",
    model: "m",
    usage: u(100, 100),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "static", verifiedDaysAgo: 45.6 },
  },
  {
    name: "fresh static price",
    config: { stalenessMaxDays: 30 },
    provider: "anthropic",
    model: "m",
    usage: u(100, 100),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "static", verifiedDaysAgo: 10 },
  },
  {
    name: "stale endpoint price is not reported",
    config: { stalenessMaxDays: 30 },
    provider: "anthropic",
    model: "m",
    usage: u(100, 100),
    pricing: { inputPerMtok: 3, outputPerMtok: 15, provenance: "endpoint", verifiedDaysAgo: 90 },
  },
];

function u(
  promptTokens: number,
  completionTokens: number,
  totalTokens?: Opt<number, Reason.OptionalInput>,
): IGenerationCase["usage"] {
  return { promptTokens, completionTokens, totalTokens: totalTokens ?? promptTokens + completionTokens };
}

function lookupFor(
  provider: string,
  model: string,
  price: Opt<IPriceInput, Reason.OptionalInput>,
): Opt<IModelPricingLookup, Reason.OptionalInput> {
  if (price === undefined) return undefined;
  const pricing: IModelPricing = {
    provider,
    model,
    inputPerMtok: price.inputPerMtok,
    outputPerMtok: price.outputPerMtok,
    provenance: price.provenance,
    verifiedAt: price.verifiedDaysAgo === undefined
      ? undefined
      : Math.round(FIXED_NOW_MS - price.verifiedDaysAgo * MS_PER_DAY),
  };
  return { getModelPricing: () => Promise.resolve(pricing) };
}

function configFor(rate: IRateConfig) {
  return ConfigSchema.parse({
    system: { root: SAMPLE_ROOT, log_level: "info" },
    paths: {},
    cost_tracking: rate.rates === undefined ? {} : { rates: rate.rates },
    model_registry: {
      ...(rate.tolerancePct === undefined ? {} : { cost_divergence_tolerance_pct: rate.tolerancePct }),
      ...(rate.stalenessMaxDays === undefined ? {} : { price_staleness_max_days: rate.stalenessMaxDays }),
    },
  });
}

async function runGenerationCase(tc: IGenerationCase): Promise<object> {
  const { db, cleanup } = await initTestDbService();
  const realNow = Date.now;
  try {
    Date.now = () => FIXED_NOW_MS;
    const logger = createMockEventLogger();
    const tracker = new CostTracker(db, configFor(tc.config), logger);
    const lookup = lookupFor(tc.provider, tc.model, tc.pricing);
    if (lookup) tracker.setPricingLookup(lookup);
    const cost = await tracker.trackGeneration(tc.provider, tc.model, tc.usage, "trace-cost");
    await tracker.flush();
    const [record] = await tracker.queryByCriteria({ traceId: "trace-cost" });
    const payloadOf = (action: string) =>
      logger.events.filter((event) => event.action === action).map((event) => event.payload);
    return {
      ...tc,
      cost_usd: cost,
      cost_source: record.costSource ?? null,
      divergence: payloadOf(DomainEventType.ModelCostDivergence),
      stale: payloadOf(DomainEventType.ModelPricingStale),
    };
  } finally {
    Date.now = realNow;
    await db.close();
    await cleanup();
  }
}

interface IReserveStep {
  op: "reserve";
  service: string;
  transport: string;
  estimatedUsd: number;
  globalCapUsd?: number;
  serviceCapUsd?: number;
}

interface ISpendStep {
  op: "spend";
  service: string;
  transport: string;
  costUsd: number;
}

type BudgetStep = IReserveStep | ISpendStep;

const BUDGET_SCENARIOS: Array<{ name: string; steps: BudgetStep[] }> = [
  {
    name: "global cap counts spend and reservations",
    steps: [
      { op: "spend", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, costUsd: 1 },
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 2, globalCapUsd: 5 },
      { op: "reserve", service: "b", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 2, globalCapUsd: 5 },
      { op: "reserve", service: "b", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 0.5, globalCapUsd: 5 },
    ],
  },
  {
    name: "service cap isolates a service",
    steps: [
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 3, serviceCapUsd: 4 },
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 2, serviceCapUsd: 4 },
      { op: "reserve", service: "b", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 2, serviceCapUsd: 4 },
    ],
  },
  {
    name: "local transport never blocks cloud",
    steps: [
      { op: "spend", service: "a", transport: SAMPLE_TRANSPORT_LOCAL, costUsd: 100 },
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 1, globalCapUsd: 2 },
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_LOCAL, estimatedUsd: 50, globalCapUsd: 2 },
    ],
  },
  {
    name: "no cap admits",
    steps: [{ op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 1000 }],
  },
  {
    name: "exactly at the cap is admitted",
    steps: [
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 5, globalCapUsd: 5 },
      { op: "reserve", service: "a", transport: SAMPLE_TRANSPORT_CLOUD, estimatedUsd: 0.01, globalCapUsd: 5 },
    ],
  },
];

async function runBudgetScenario(scenario: { name: string; steps: BudgetStep[] }): Promise<object> {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, configFor({}));
    const reserved: Array<{ service: string; transport: string; estimatedUsd: number }> = [];
    const steps: object[] = [];
    for (const step of scenario.steps) {
      if (step.op === "spend") {
        await tracker.trackGeneration(
          "anthropic",
          "m",
          {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            costUsd: step.costUsd,
          },
          "trace-budget",
          undefined,
          { service: step.service, transport: step.transport },
        );
        steps.push({ ...step });
        continue;
      }
      await tracker.flush();
      const persistedCloud = await tracker.getDailyBudgetCost({ transport: SAMPLE_TRANSPORT_CLOUD });
      const persistedService = await tracker.getDailyBudgetCost({
        service: step.service,
        transport: SAMPLE_TRANSPORT_CLOUD,
      });
      const sum = (service: Opt<string, Reason.QueryFilter>) =>
        reserved.filter((r) => r.transport === SAMPLE_TRANSPORT_CLOUD && (!service || r.service === service))
          .reduce((total, r) => total + r.estimatedUsd, 0);
      const state = {
        persistedCloud,
        reservedCloud: sum(undefined),
        persistedService,
        reservedService: sum(step.service),
      };
      const allowance = await tracker.reserveDailyBudget({ ...step, provider: "anthropic" });
      if (allowance.allowed) {
        reserved.push({ service: step.service, transport: step.transport, estimatedUsd: step.estimatedUsd });
      }
      steps.push({
        ...step,
        state,
        allowed: allowance.allowed,
        reason: allowance.reason ?? null,
      });
    }
    return { name: scenario.name, steps };
  } finally {
    await db.close();
    await cleanup();
  }
}

interface IGroupRow {
  provider: string;
  model: string;
  requests: number | null;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costSource: string | null;
  portal: string | null;
  service: string | null;
  cacheRead: number | null;
  cacheCreation: number | null;
}

const GROUP_ROWS: IGroupRow[] = [
  {
    provider: "anthropic",
    model: "sonnet",
    requests: 1,
    tokens: 100,
    promptTokens: 60,
    completionTokens: 40,
    costUsd: 0.5,
    costSource: "provider_reported",
    portal: "alpha",
    service: "svc-a",
    cacheRead: 10,
    cacheCreation: 5,
  },
  {
    provider: "anthropic",
    model: "sonnet",
    requests: 3,
    tokens: 300,
    promptTokens: 200,
    completionTokens: 100,
    costUsd: 1.25,
    costSource: "registry_computed",
    portal: "alpha",
    service: "svc-a",
    cacheRead: null,
    cacheCreation: null,
  },
  {
    provider: "openai",
    model: "gpt",
    requests: 2,
    tokens: 50,
    promptTokens: 30,
    completionTokens: 20,
    costUsd: 0.0625,
    costSource: "estimated",
    portal: "beta",
    service: null,
    cacheRead: null,
    cacheCreation: null,
  },
  {
    provider: "openai",
    model: "gpt",
    requests: 1,
    tokens: 20,
    promptTokens: 10,
    completionTokens: 10,
    costUsd: null,
    costSource: null,
    portal: null,
    service: "svc-b",
    cacheRead: null,
    cacheCreation: null,
  },
  {
    provider: "anthropic",
    model: "haiku",
    requests: 1,
    tokens: 10,
    promptTokens: 5,
    completionTokens: 5,
    costUsd: 0.01,
    costSource: null,
    portal: "alpha",
    service: "svc-b",
    cacheRead: 1,
    cacheCreation: 2,
  },
  {
    provider: "ollama",
    model: "llama",
    requests: 4,
    tokens: 400,
    promptTokens: 300,
    completionTokens: 100,
    costUsd: 0,
    costSource: "estimated",
    portal: null,
    service: null,
    cacheRead: null,
    cacheCreation: null,
  },
];

async function runGroupCases(): Promise<object> {
  const { db, cleanup } = await initTestDbService();
  try {
    const tracker = new CostTracker(db, configFor({}));
    for (const [index, r] of GROUP_ROWS.entries()) {
      if (r.costUsd === null) {
        await tracker.recordUnpricedGeneration(
          r.provider,
          r.model,
          { promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens: r.tokens },
          undefined,
          { service: r.service ?? undefined },
        );
        continue;
      }
      await db.preparedRun(
        `INSERT INTO provider_costs (id, provider, model, requests, tokens, prompt_tokens, completion_tokens, estimated_cost_usd, cost_source, trace_id, portal, timestamp, cache_read_tokens, cache_creation_tokens, service, transport)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `row-${index}`,
          r.provider,
          r.model,
          r.requests ?? 1,
          r.tokens,
          r.promptTokens,
          r.completionTokens,
          r.costUsd,
          r.costSource,
          null,
          r.portal,
          new Date(GROUP_BASE_MS + index * 1000).toISOString(),
          r.cacheRead,
          r.cacheCreation,
          r.service,
          null,
        ],
      );
    }
    await db.waitForFlush();
    const records = (await tracker.queryByCriteria({})).map((record, index) => ({
      ...record,
      id: `record-${index}`,
      timestamp: new Date(GROUP_BASE_MS),
      traceId: undefined,
    }));
    const groups: Array<{ group_by: string; groups: object[] }> = [];
    for (const groupBy of [CostGroupBy.MODEL, CostGroupBy.PORTAL, CostGroupBy.SERVICE]) {
      groups.push({ group_by: groupBy, groups: await tracker.queryGroupedByCriteria({}, groupBy) });
    }
    return { records, grouped: groups };
  } finally {
    await db.close();
    await cleanup();
  }
}

/** Builds the fixture of cost arithmetic, divergence, budget admission and grouping cases. */
export async function buildCostFixture(): Promise<object> {
  const generation: object[] = [];
  for (const tc of GENERATION_CASES) generation.push(await runGenerationCase(tc));
  const budget: object[] = [];
  for (const scenario of BUDGET_SCENARIOS) budget.push(await runBudgetScenario(scenario));
  return {
    now_ms: FIXED_NOW_MS,
    generation,
    budget,
    grouping: await runGroupCases(),
  };
}
