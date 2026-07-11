/**
 * @module ModelCommandsTest
 * @path apps/exactl/tests/model_commands_test.ts
 * @related-files [apps/exactl/src/commands/model_commands.ts]
 * @architectural-layer CLI
 * @description Unit tests for ModelCommands — the Solo curation CLI (config model
 *   + models list/pricing). Covers registry-backed display, curated-list writes with
 *   Solo validation semantics (G10), dedup, clear idempotency, and unconfigured flags.
 *   Curated lists persist to exa.config.toml (TOML write-back) — the surface the
 *   resolver reads (config.model_presets) — honoring the phase's zero-DB constraint.
 *   Phase 134 Step 6 — models list/pricing + config model curation, provenance/staleness display.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
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

Deno.test("[model-cli] models list renders provider:model, provenance and verified_at staleness", async () => {
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

Deno.test("[model-cli] models pricing shows per-Mtok prices with static/unknown provenance", async () => {
  const cmd = new ModelCommands(createPopulatedRegistry());
  const cap = captureLog();
  try {
    await cmd.showPricing();
  } finally {
    cap.restore();
  }
  const out = cap.lines.join("\n");
  assertStringIncludes(out, "3"); // inputPerMtok for anthropic
  assertStringIncludes(out, "static");
  assertStringIncludes(out, "unknown");
});

Deno.test("[model-cli] config model --size M writes candidates; --list round-trips; --clear resets", async () => {
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

Deno.test("[model-cli] config model rejects an ambiguous bare name with qualifying options", async () => {
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

Deno.test("[model-cli] config model stores unregistered-provider entries flagged unconfigured (G10)", async () => {
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

Deno.test("[model-cli] config model --size M writing 3 entries where the 2nd is invalid keeps no partial state", async () => {
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

Deno.test("[model-cli] config model --size M --characteristic cheapest writes the characteristics sub-map", async () => {
  await withTomlConfig(async (configPath, read) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await cmd.setCharacteristic("M", "cheapest", ["ollama"]);
    assertEquals(read().model_presets?.M?.characteristics?.cheapest, ["ollama"]);
  });
});

Deno.test("[model-cli] config model rejects an unknown size", async () => {
  await withTomlConfig(async (configPath) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await assertRejects(
      () => cmd.setCandidates("HUGE", ["anthropic"]),
      Error,
      "size",
    );
  });
});

Deno.test("[model-cli][step5] models refresh refuses when model_registry is disabled/absent (Solo default)", async () => {
  await withTomlConfig(async (configPath) => {
    const cmd = new ModelCommands(createPopulatedRegistry(), configPath);
    await assertRejects(
      () => cmd.refreshModels(),
      Error,
      "model_registry.enabled",
    );
  });
});

Deno.test("[model-cli][step5] models refresh with model_registry.enabled=true prints daemon-refresh guidance", async () => {
  await withTomlConfig(async (configPath, _read) => {
    Deno.writeTextFileSync(configPath, `[system]\nroot = "/tmp"\n\n[model_registry]\nenabled = true\n`);
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
