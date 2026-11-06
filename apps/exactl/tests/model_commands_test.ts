/**
 * @module ModelCommandsTest
 * @path apps/exactl/tests/model_commands_test.ts
 * @related-files [apps/exactl/src/commands/model_commands.ts]
 * @architectural-layer CLI
 * @description Unit tests for ModelCommands — the Solo curation CLI (model candidates
 *   + model list). Covers registry-backed display, curated-list writes with
 *   Solo validation semantics (G10), dedup, clear idempotency, and unconfigured flags.
 *   Curated lists persist to exa.config.toml (TOML write-back) — the surface the
 *   resolver reads (config.model_presets) — honoring the phase's zero-DB constraint.
 *   Phase 134 Step 6 — model list + model candidates curation, provenance/staleness display.
 */

import { assertEquals, assertFalse, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import type {
  ICapabilityProfile,
  IModelEntry,
  IModelPricing,
  IModelRegistry,
  IRateLimitStatus,
} from "@exaix/core/types";
import { HealthStatus } from "@exaix/core/types";
import { ModelCommands } from "../src/commands/model_commands.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";
import { readConfigFixture } from "../../../tests/integration/helpers/config_fixture.ts";

/** A minimal in-memory registry stub covering the methods ModelCommands reads. */
function createStubRegistry(overrides?: Partial<IModelRegistry>): IModelRegistry {
  const base: IModelRegistry = {
    getModelsByCapability: () => Promise.resolve([]),
    getModelCapability: () => Promise.resolve({} as ICapabilityProfile),
    getProviderModels: () => Promise.resolve([]),
    getAllProviders: () => Promise.resolve(["anthropic", "ollama"]),
    getModelCost: () => Promise.resolve(0),
    getContextWindow: () => Promise.resolve(0),
    recordLatency: () => Promise.resolve(),
    getLatencyStats: () => Promise.reject(new Error("nope")),
    rankByLatency: () => Promise.reject(new Error("nope")),
    recordCall: () => Promise.resolve(),
    getRateLimit: () => Promise.resolve({} as IRateLimitStatus),
    getProviderHealth: () => Promise.resolve(HealthStatus.HEALTHY),
    getModelPricing: () => Promise.resolve({ provider: "", model: "", provenance: "unknown" }),
  };
  return { ...base, ...overrides };
}

/** Registry that knows anthropic:claude-sonnet-4 (static) and ollama:llama3.2 (unknown). */
function createPopulatedRegistry(): IModelRegistry {
  const entries: Record<string, IModelEntry[]> = {
    anthropic: [{
      provider: "anthropic",
      model: "claude-sonnet-4",
      capabilities: {},
      contextWindow: 200_000,
      costPer1kTokens: 0.003,
    }],
    ollama: [{
      provider: "ollama",
      model: "llama3.2",
      capabilities: {},
      contextWindow: 128_000,
      costPer1kTokens: 0,
    }],
  };
  const pricing: Record<string, IModelPricing> = {
    "anthropic:claude-sonnet-4": {
      provider: "anthropic",
      model: "claude-sonnet-4",
      inputPerMtok: 3,
      outputPerMtok: 15,
      provenance: "static",
      verifiedAt: Date.UTC(2026, 6, 5),
      sourceUrl: "https://example.test/anthropic",
    },
    "ollama:llama3.2": { provider: "ollama", model: "llama3.2", provenance: "unknown" },
  };
  return createStubRegistry({
    getAllProviders: () => Promise.resolve(["anthropic", "ollama"]),
    getProviderModels: (p: string) => Promise.resolve(entries[p] ?? []),
    getModelPricing: (p: string, m: string) =>
      Promise.resolve(pricing[`${p}:${m}`] ?? { provider: p, model: m, provenance: "unknown" }),
  });
}

/** Config shape used for reading back written TOML in assertions. */
interface IModelPresetsToml {
  model_presets?: Record<string, { candidates?: string[]; characteristics?: Record<string, string[]> }>;
}

/** Run `fn` with a fresh exa.config.toml path; returns a reader for its parsed content. */
async function withTomlConfig(
  fn: (configPath: string, read: () => IModelPresetsToml) => Promise<void>,
): Promise<void> {
  const dir = Deno.makeTempDirSync({ prefix: "model-cmd-toml-" });
  try {
    const configPath = `${dir}/exa.config.toml`;
    Deno.writeTextFileSync(configPath, `[system]\nroot = "${dir}"\n`);
    const read = (): IModelPresetsToml => parse(Deno.readTextFileSync(configPath)) as IModelPresetsToml;
    await fn(configPath, read);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: string[]) => lines.push(args.map(String).join(" "));
  return { lines, restore: () => (console.log = original) };
}

Deno.test("[model-cli] model list renders provider:model, provenance and verified_at staleness", async () => {
  const cmd = new ModelCommands(createPopulatedRegistry());
  const cap = captureLog();
  try {
    await cmd.listModels();
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assertStringIncludes(out, "anthropic:claude-sonnet-4");
  assertStringIncludes(out, "static");
  assertStringIncludes(out, "ollama:llama3.2");
  assertStringIncludes(out, "unknown");
});

Deno.test("[step135.8] model list --benchmark <name> shows the advisory score column", async () => {
  const cmd = new ModelCommands(createPopulatedRegistry(), undefined, {
    getBenchmark: (p: string, m: string, benchmark: string) =>
      Promise.resolve(
        p === "anthropic" && m === "claude-sonnet-4" && benchmark === "swe_bench_verified" ? 0.727 : undefined,
      ),
  });
  const cap = captureLog();
  try {
    await cmd.listModels({ benchmark: "swe_bench_verified" });
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assertStringIncludes(out, "0.727");
  assertStringIncludes(out, "swe_bench_verified");
});

Deno.test("[step135.8] model list --benchmark with no reader wired shows '-' for every row (Solo/CLI-without-Team degrades gracefully)", async () => {
  const cmd = new ModelCommands(createPopulatedRegistry());
  const cap = captureLog();
  try {
    await cmd.listModels({ benchmark: "swe_bench_verified" });
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assertStringIncludes(out, "anthropic:claude-sonnet-4");
  assertStringIncludes(out, "-");
});

Deno.test("[step135.8] model list without --benchmark omits the benchmark column entirely (no behavior change)", async () => {
  const cmd = new ModelCommands(createPopulatedRegistry());
  const cap = captureLog();
  try {
    await cmd.listModels();
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assertFalse(out.includes("Benchmark"));
});

Deno.test("model list shows the models list columns and the models pricing columns in one table", async () => {
  const cmd = new ModelCommands(createPopulatedRegistry());
  const cap = captureLog();
  try {
    await cmd.listModels();
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  for (const header of ["Model", "Provenance", "Verified", "Input $/Mtok", "Output $/Mtok"]) {
    assertStringIncludes(out, header);
  }
  assertStringIncludes(out, "$3"); // inputPerMtok for anthropic
  assertStringIncludes(out, "static");
  assertStringIncludes(out, "unknown");
});

const MS_PER_DAY = 86_400_000;

interface IPricedModel {
  provider: string;
  model: string;
  daysSinceVerified?: number;
  sourceUrl?: string;
}

/** Registry whose rows are priced and verified the given number of days before now. */
function createPricedRegistry(rows: IPricedModel[]): IModelRegistry {
  const key = (provider: string, model: string) => `${provider}:${model}`;
  const byKey = new Map(rows.map((row) => [key(row.provider, row.model), row]));
  return createStubRegistry({
    getAllProviders: () => Promise.resolve([...new Set(rows.map((row) => row.provider))]),
    getProviderModels: (provider: string) =>
      Promise.resolve(
        rows.filter((row) => row.provider === provider).map((row): IModelEntry => ({
          provider: row.provider,
          model: row.model,
          capabilities: {},
          contextWindow: 1,
          costPer1kTokens: 0,
        })),
      ),
    getModelPricing: (provider: string, model: string) => {
      const row = byKey.get(key(provider, model));
      const daysSinceVerified = row?.daysSinceVerified;
      return Promise.resolve({
        provider,
        model,
        inputPerMtok: 1.5,
        outputPerMtok: 7.5,
        provenance: "static",
        verifiedAt: daysSinceVerified === undefined ? undefined : Date.now() - daysSinceVerified * MS_PER_DAY,
        sourceUrl: row?.sourceUrl,
      });
    },
  });
}

async function renderList(cmd: ModelCommands, options?: { model?: string; benchmark?: string }): Promise<string[]> {
  const cap = captureLog();
  try {
    await cmd.listModels(options);
  } finally {
    cap.restore();
  }
  return cap.lines.join("\n").split("\n");
}

function lineOf(lines: string[], text: string): string {
  const line = lines.find((candidate) => candidate.includes(text));
  if (line === undefined) throw new Error(`no line contains ${text}`);
  return line;
}

Deno.test("model list shows each model's author, service, route, input and output price, source, source URL, verified date and stale flag", async () => {
  const registry = createPricedRegistry([
    { provider: "anthropic", model: "claude-sonnet-4", daysSinceVerified: 1, sourceUrl: "https://example.test/prices" },
  ]);
  const lines = await renderList(new ModelCommands(registry));
  const header = lineOf(lines, "Provenance");
  for (const column of ["Model", "Author", "Service", "Route", "Provenance", "Source URL", "Verified", "Stale"]) {
    assertStringIncludes(header, column);
  }
  assertStringIncludes(header, "Input $/Mtok");
  assertStringIncludes(header, "Output $/Mtok");
  const row = lineOf(lines, "anthropic:claude-sonnet-4");
  for (const value of ["anthropic", "native", "static", "https://example.test/prices", "$1.5", "$7.5", "no"]) {
    assertStringIncludes(row, value);
  }
  assertStringIncludes(row, new Date(Date.now() - MS_PER_DAY).toISOString().slice(0, 10));
});

Deno.test("model list marks an entry older than the staleness threshold as stale", async () => {
  const registry = createPricedRegistry([
    { provider: "anthropic", model: "claude-old", daysSinceVerified: 100 },
    { provider: "anthropic", model: "claude-new", daysSinceVerified: 10 },
  ]);
  const lines = await renderList(new ModelCommands(registry));
  assertMatch(lineOf(lines, "claude-old"), /\byes\b/);
  assertMatch(lineOf(lines, "claude-new"), /\bno\b/);
});

Deno.test("model list reads model_registry.price_staleness_max_days", async () => {
  const registry = createPricedRegistry([{ provider: "anthropic", model: "claude-two-days", daysSinceVerified: 2 }]);
  const defaultLines = await renderList(new ModelCommands(registry));
  assertMatch(lineOf(defaultLines, "claude-two-days"), /\bno\b/);
  const oneDayLines = await renderList(new ModelCommands(registry, undefined, undefined, 1));
  assertMatch(lineOf(oneDayLines, "claude-two-days"), /\byes\b/);
});

Deno.test("model list derives the route column from the service adapter", async () => {
  const registry = createPricedRegistry([
    { provider: "anthropic", model: "m-native", daysSinceVerified: 1 },
    { provider: "claude-cli", model: "m-subscription", daysSinceVerified: 1 },
    { provider: "ollama", model: "m-local", daysSinceVerified: 1 },
    { provider: "openrouter", model: "m-aggregator", daysSinceVerified: 1 },
  ]);
  const lines = await renderList(new ModelCommands(registry));
  assertMatch(lineOf(lines, "m-native"), /\bnative\b/);
  assertMatch(lineOf(lines, "m-subscription"), /\bsubscription\b/);
  assertMatch(lineOf(lines, "m-local"), /\blocal\b/);
  assertMatch(lineOf(lines, "m-aggregator"), /\baggregator\b/);
});

Deno.test("model list --model <author/model> lists every serving edge of that model", async () => {
  const registry = createPricedRegistry([
    { provider: "anthropic", model: "claude-sonnet-4", daysSinceVerified: 1 },
    { provider: "openrouter", model: "anthropic/claude-sonnet-4", daysSinceVerified: 1 },
    { provider: "ollama", model: "llama3.2", daysSinceVerified: 1 },
  ]);
  const lines = await renderList(new ModelCommands(registry), { model: "anthropic/claude-sonnet-4" });
  const out = lines.join("\n");
  assertStringIncludes(out, "anthropic:claude-sonnet-4");
  assertStringIncludes(out, "openrouter:anthropic/claude-sonnet-4");
  assertFalse(out.includes("ollama:llama3.2"));
});

Deno.test("model list --model says so when no service serves the model", async () => {
  const registry = createPricedRegistry([{ provider: "ollama", model: "llama3.2", daysSinceVerified: 1 }]);
  const out = (await renderList(new ModelCommands(registry), { model: "anthropic/none" })).join("\n");
  assertStringIncludes(out, "No service serves anthropic/none");
});

Deno.test("model list --model without an author is a usage error", async () => {
  const registry = createPricedRegistry([{ provider: "ollama", model: "llama3.2", daysSinceVerified: 1 }]);
  const error = await assertRejects(() => renderList(new ModelCommands(registry), { model: "llama3.2" }), ExaCtlError);
  assertEquals(error.code, ExaCtlExitCode.USAGE);
});

Deno.test("[model-cli] model candidates --size M writes candidates; --list round-trips; --clear resets", async () => {
  await withTomlConfig(async (configPath, read) => {
    // Entries are provider names — the form the resolver's tryResolveCurated reads
    // (it looks each entry up via ProviderRegistry.getProviderMetadata).
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await cmd.setCandidates("M", ["anthropic", "ollama"]);
    assertEquals(read().model_presets?.M?.candidates, ["anthropic", "ollama"]);

    const listed = await cmd.listCandidates();
    assertEquals(listed["M"]?.entries.map((e) => e.entry), ["anthropic", "ollama"]);

    await cmd.clearCandidates("M");
    assertEquals(read().model_presets?.M?.candidates, []);
  });
});

Deno.test("[model-cli] model candidates rejects an ambiguous bare name with qualifying options", async () => {
  await withTomlConfig(async (configPath) => {
    // A bare entry that is not a known provider but matches a model owned by >1
    // provider is ambiguous — the user likely typed a model name; reject and hint.
    const registry = createStubRegistry({
      getAllProviders: () => Promise.resolve(["anthropic", "bedrock"]),
      getProviderModels: (p: string) =>
        Promise.resolve([{
          provider: p,
          model: "shared-model",
          capabilities: {},
          contextWindow: 1,
          costPer1kTokens: 0,
        }]),
    });
    const cmd = new ModelCommands(registry, configPath);
    await assertRejects(
      () => cmd.setCandidates("M", ["shared-model"]),
      Error,
      "Ambiguous",
    );
  });
});

Deno.test("[model-cli] model candidates stores unregistered-provider entries flagged unconfigured (G10)", async () => {
  await withTomlConfig(async (configPath, read) => {
    // "madeup" is not a registered provider and matches no model → stored but flagged
    // unconfigured (Solo pre-curation allowance).
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await cmd.setCandidates("M", ["madeup"]);
    assertEquals(read().model_presets?.M?.candidates, ["madeup"]);

    const listed = await cmd.listCandidates();
    const entry = listed["M"]?.entries.find((e) => e.entry === "madeup");
    assertEquals(entry?.unconfigured, true);
  });
});

Deno.test("[model-cli] model candidates --size M writing 3 entries where the 2nd is invalid keeps no partial state", async () => {
  await withTomlConfig(async (configPath, read) => {
    // Entry 2 is an ambiguous bare model name → whole write rejected atomically.
    const registry = createStubRegistry({
      getAllProviders: () => Promise.resolve(["anthropic", "bedrock"]),
      getProviderModels: (p: string) =>
        Promise.resolve([{
          provider: p,
          model: "ambi",
          capabilities: {},
          contextWindow: 1,
          costPer1kTokens: 0,
        }]),
    });
    const cmd = new ModelCommands(registry, configPath);
    await assertRejects(
      () => cmd.setCandidates("M", ["anthropic", "ambi", "bedrock"]),
      Error,
      "Ambiguous",
    );
    // No partial state: candidates key never written.
    assertEquals(read().model_presets?.M?.candidates, undefined);
  });
});

Deno.test("[model-cli] --clear on an already-empty candidates list succeeds (idempotent)", async () => {
  await withTomlConfig(async (configPath, read) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await cmd.clearCandidates("M");
    await cmd.clearCandidates("M");
    assertEquals(read().model_presets?.M?.candidates, []);
  });
});

Deno.test("[model-cli] --size M writing the same entry twice produces a single entry (dedup)", async () => {
  await withTomlConfig(async (configPath, read) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await cmd.setCandidates("M", ["anthropic", "anthropic"]);
    assertEquals(read().model_presets?.M?.candidates, ["anthropic"]);
  });
});

Deno.test("[model-cli] model candidates --size M --characteristic cheapest writes the characteristics sub-map", async () => {
  await withTomlConfig(async (configPath, read) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await cmd.setCharacteristic("M", "cheapest", ["ollama"]);
    assertEquals(read().model_presets?.M?.characteristics?.cheapest, ["ollama"]);
  });
});

Deno.test("[model-cli] model candidates rejects an unknown size", async () => {
  await withTomlConfig(async (configPath) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await assertRejects(
      () => cmd.setCandidates("HUGE", ["anthropic"]),
      Error,
      "size",
    );
  });
});

Deno.test("[model-cli][step5] model refresh refuses when model_registry is disabled/absent (Solo default)", async () => {
  await withTomlConfig(async (configPath) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await assertRejects(
      () => cmd.refreshModels(),
      Error,
      "model_registry.enabled",
    );
  });
});

Deno.test("[model-cli][step5] model refresh with model_registry.enabled=true prints daemon-refresh guidance", async () => {
  await withTomlConfig(async (configPath, _read) => {
    Deno.writeTextFileSync(configPath, readConfigFixture("exactl-model-refresh-guidance"));
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    const cap = captureLog();
    try {
      await cmd.refreshModels();
    } finally {
      cap.restore();
    }
    const out = cap.lines.join("\n");
    assertStringIncludes(out, "daemon");
  });
});
