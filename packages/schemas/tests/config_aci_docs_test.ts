/**
 * @module ConfigAciDocsTest
 * @path packages/schemas/tests/config_aci_docs_test.ts
 * @description Tests for the agents.inject_aci_docs / agents.aci_doc_prompt_max_chars
 *   configuration fields introduced by Phase 112 Step 1: schema defaults, explicit
 *   overrides, invalid-type rejection, numeric bounds, a real TOML round trip through
 *   ConfigService, and DirectConfigAdapter override/provenance for both keys.
 *
 *   Named config_aci_docs_test.ts rather than the plan's literal "config_test.ts" to match
 *   this directory's established per-concern naming (config_convergence_test.ts,
 *   config_hitl_test.ts, config_quality_gate_test.ts, ...) — there is no monolithic
 *   config_test.ts anywhere in this package.
 * @architectural-layer Config
 * @related-files ["packages/schemas/src/config.ts", "packages/core/src/types/constants.ts", "packages/core/src/config/service.ts", "packages/core/src/config/adapter.ts"]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas";
import { ExaPathDefaults, LogLevel } from "@exaix/core";
import { DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS, DEFAULT_AGENT_INJECT_ACI_DOCS } from "@exaix/core";
import { ConfigService } from "@exaix/core/config";
import { DirectConfigAdapter } from "@exaix/core/config";
import { ConfigProvenanceSource } from "@exaix/core";
import { ensureConfigDb } from "@exaix/core/config";
import { join } from "@std/path";

interface IBaseConfig {
  system: { root: string; log_level: string };
  paths: typeof ExaPathDefaults;
}

function baseConfig(): IBaseConfig {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}

Deno.test("[ConfigSchema] agents.inject_aci_docs defaults to false", () => {
  const result = ConfigSchema.parse(baseConfig());
  assertEquals(result.agents.inject_aci_docs, false);
  assertEquals(DEFAULT_AGENT_INJECT_ACI_DOCS, false);
});

Deno.test("[ConfigSchema] agents.aci_doc_prompt_max_chars defaults to 12000", () => {
  const result = ConfigSchema.parse(baseConfig());
  assertEquals(result.agents.aci_doc_prompt_max_chars, 12000);
  assertEquals(DEFAULT_AGENT_ACI_DOC_PROMPT_MAX_CHARS, 12000);
});

Deno.test("[ConfigSchema] agents.inject_aci_docs accepts an explicit true override", () => {
  const result = ConfigSchema.parse({
    ...baseConfig(),
    agents: { inject_aci_docs: true },
  });
  assertEquals(result.agents.inject_aci_docs, true);
});

Deno.test("[ConfigSchema] agents.inject_aci_docs rejects a non-boolean value", () => {
  assertThrows(() =>
    ConfigSchema.parse({
      ...baseConfig(),
      agents: { inject_aci_docs: "yes" },
    })
  );
});

Deno.test("[ConfigSchema] agents.aci_doc_prompt_max_chars accepts a value within bounds", () => {
  const result = ConfigSchema.parse({
    ...baseConfig(),
    agents: { aci_doc_prompt_max_chars: 20000 },
  });
  assertEquals(result.agents.aci_doc_prompt_max_chars, 20000);
});

Deno.test("[ConfigSchema] agents.aci_doc_prompt_max_chars rejects a value below the registered minimum", () => {
  assertThrows(() =>
    ConfigSchema.parse({
      ...baseConfig(),
      agents: { aci_doc_prompt_max_chars: 999 },
    })
  );
});

Deno.test("[ConfigSchema] agents.aci_doc_prompt_max_chars rejects a value above the registered maximum", () => {
  assertThrows(() =>
    ConfigSchema.parse({
      ...baseConfig(),
      agents: { aci_doc_prompt_max_chars: 50001 },
    })
  );
});

Deno.test("[ConfigService] agents.inject_aci_docs round-trips through a real TOML file", () => {
  const dir = Deno.makeTempDirSync({ prefix: "aci-docs-toml-" });
  try {
    const configPath = join(dir, "exa.config.toml");
    Deno.writeTextFileSync(
      configPath,
      `[system]\nroot = "${dir}"\n\n[agents]\ninject_aci_docs = true\naci_doc_prompt_max_chars = 8000\n`,
    );
    const service = new ConfigService(configPath);
    const config = service.get();
    assertEquals(config.agents.inject_aci_docs, true);
    assertEquals(config.agents.aci_doc_prompt_max_chars, 8000);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

function setupAdapter(): { adapter: DirectConfigAdapter; dir: string } {
  const dir = Deno.makeTempDirSync({ prefix: "aci-docs-adapter-" });
  const dbPath = ensureConfigDb(dir);
  const adapter = new DirectConfigAdapter(dbPath);
  return { adapter, dir };
}

Deno.test("[DirectConfigAdapter] agent.inject_aci_docs provenance is registry-sourced by default", () => {
  const { adapter, dir } = setupAdapter();
  try {
    const provenance = adapter.getProvenance("agent.inject_aci_docs");
    assertEquals(provenance.source, ConfigProvenanceSource.REGISTRY);
    assertEquals(provenance.value, false);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[DirectConfigAdapter] agent.inject_aci_docs override is db-sourced after set", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("agent.inject_aci_docs", true);
    const provenance = adapter.getProvenance("agent.inject_aci_docs");
    assertEquals(provenance.source, ConfigProvenanceSource.DB);
    assertEquals(provenance.value, true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[DirectConfigAdapter] agent.aci_doc_prompt_max_chars provenance is registry-sourced by default", () => {
  const { adapter, dir } = setupAdapter();
  try {
    const provenance = adapter.getProvenance("agent.aci_doc_prompt_max_chars");
    assertEquals(provenance.source, ConfigProvenanceSource.REGISTRY);
    assertEquals(provenance.value, 12000);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("[DirectConfigAdapter] agent.aci_doc_prompt_max_chars override is db-sourced after set", async () => {
  const { adapter, dir } = setupAdapter();
  try {
    await adapter.set("agent.aci_doc_prompt_max_chars", 30000);
    const provenance = adapter.getProvenance("agent.aci_doc_prompt_max_chars");
    assertEquals(provenance.source, ConfigProvenanceSource.DB);
    assertEquals(provenance.value, 30000);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
