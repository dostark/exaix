#!/usr/bin/env -S deno run -A
/**
 * @module GenerateModelSettings
 * @path scripts/generate_model_settings.ts
 * @description Rewrites the generated table blocks of docs/Model_Settings.md. The tables come from the binding catalog, the rows of tests/configs/model_presets.toml and the scenario files, so they cannot drift from the code. The text around the blocks is written by hand.
 *
 * Usage:
 *   deno task docs:models
 * @architectural-layer Tooling
 * @dependencies [@exaix/model-registry, @std/fs, @std/path]
 * @related-files ["tests/configs/model_presets.toml", "tests/helpers/live_presets.ts", "tests/docs/model_settings_drift_test.ts"]
 */

import { join, relative } from "@std/path";
import { walk } from "@std/fs";
import type { Opt, Reason } from "@exaix/core/types";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
import type { IBindingSpec, ICatalogService } from "@exaix/schemas";
import { type ICatalogPreset, loadCellCatalog } from "../tests/scenario_framework/runner/cell_catalog.ts";

/** A variable that no catalog row or preset declares. The drift test checks that its reader file names it. */
export interface IOtherVariable {
  name: string;
  scope: string;
  purpose: string;
  readBy: string;
}

const REPO_ROOT = join(import.meta.dirname ?? ".", "..");
export const MODEL_SETTINGS_DOC = join(REPO_ROOT, "docs", "Model_Settings.md");
const PRESETS_PATH = join(REPO_ROOT, "tests", "configs", "model_presets.toml");
const SCENARIOS_DIR = join(REPO_ROOT, "tests", "scenario_framework", "scenarios");
const LIVE_PREFIX = "live-";
const NONE = "-";

/** The variables that no catalog row or preset declares. The drift test checks that each `readBy` file still names its variable. */
export const OTHER_VARIABLES: readonly IOtherVariable[] = [
  {
    name: "EXA_LLM_PROVIDER",
    scope: "production",
    purpose: "Overrides the AI provider of the daemon and exactl. An unknown name falls back to `mock`.",
    readBy: "packages/ai/src/provider_factory.ts",
  },
  {
    name: "EXA_LLM_MODEL",
    scope: "production",
    purpose: "Overrides the model name. The value goes to the provider unchanged.",
    readBy: "packages/ai/src/provider_factory.ts",
  },
  {
    name: "EXA_LLM_BASE_URL",
    scope: "production",
    purpose: "Overrides the provider endpoint. `EXA_LLM_ENDPOINT` is the older name.",
    readBy: "packages/ai/src/provider_factory.ts",
  },
  {
    name: "EXA_LLM_TIMEOUT_MS",
    scope: "production",
    purpose: "Overrides the request timeout in milliseconds.",
    readBy: "packages/ai/src/provider_factory.ts",
  },
  {
    name: "EXA_MODEL_PRESET_OVERRIDE",
    scope: "production, tests",
    purpose: "Pins every model size to `mock:mock-model` for a registered preset name such as `test`.",
    readBy: "packages/ai/src/model_resolver.ts",
  },
  {
    name: "CLAUDE_CODE_OAUTH_TOKEN",
    scope: "production",
    purpose: "Subscription login of the Claude CLI delegate, used instead of a metered API key.",
    readBy: "packages/execution/src/strategies/cli_delegate_strategy.ts",
  },
  {
    name: "EXA_TEST_BIND",
    scope: "tests",
    purpose:
      "Binds the provider, service, transport and model of an in-process live test, in the `--bind` syntax `selector=field=value,field=value`.",
    readBy: "tests/helpers/llm_bindings.ts",
  },
  {
    name: "EXA_TEST_LLM_MODEL",
    scope: "tests",
    purpose: "Model ID of the provider tests of `packages/ai`. The default is `gpt-5-mini`.",
    readBy: "packages/ai/tests/helpers/test_model.ts",
  },
  {
    name: "OLLAMA_BASE_URL",
    scope: "tests",
    purpose: "Host of the Ollama server for `ollama_json_plan_test.ts`. The default is `http://localhost:11434`.",
    readBy: "tests/integration/ollama_json_plan_test.ts",
  },
  {
    name: "EXA_EVAL_LLM_PROVIDER",
    scope: "evaluation",
    purpose: "Provider of the judge of a scenario or a live test. The project default is `claude-cli`.",
    readBy: "tests/scenario_framework/runner/assertions.ts",
  },
  {
    name: "EXA_EVAL_LLM_MODEL",
    scope: "evaluation",
    purpose: "Model of the judge.",
    readBy: "tests/scenario_framework/runner/assertions.ts",
  },
  {
    name: "EXA_TEST_MODE",
    scope: "tests",
    purpose: "Marks a test run. The daemon then refuses a billable provider unless the paid opt-in is set.",
    readBy: "packages/core/src/config/env_schema.ts",
  },
  {
    name: "EXA_CI_MODE",
    scope: "tests",
    purpose: "Marks a CI run. When it is unset, `CI` does the same.",
    readBy: "packages/core/src/config/env_schema.ts",
  },
];

interface ILoadedSettings {
  services: Record<string, ICatalogService>;
  presets: Record<string, ICatalogPreset>;
  scenarios: ScenarioGate[];
}

type ScenarioGate = { id: string; file: string; optins: string[]; keys: string[] };

/** The variable names of one kind that a scenario file gates on, with the scenario id. */
async function readScenarioGates(): Promise<ScenarioGate[]> {
  const gates: ScenarioGate[] = [];
  for await (const entry of walk(SCENARIOS_DIR, { exts: [".yaml"], includeDirs: false })) {
    const text = await Deno.readTextFile(entry.path);
    const optins = [...text.matchAll(/requires_optin:\s*["']?([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
    const keys = [...text.matchAll(/requires_key:\s*["']?([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
    if (optins.length === 0 && keys.length === 0) continue;
    const id = text.match(/^id:\s*["']?([^"'\n]+)/m)?.[1]?.trim() ?? entry.name;
    gates.push({ id, file: relative(REPO_ROOT, entry.path), optins, keys });
  }
  return gates.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadSettings(): Promise<ILoadedSettings> {
  const { presets } = await loadCellCatalog(PRESETS_PATH);
  const overlay: Record<string, ICatalogService> = {};
  for (const [name, preset] of Object.entries(presets)) {
    if (name.startsWith(LIVE_PREFIX)) Object.assign(overlay, preset.catalog?.services);
  }
  const catalog = mergeCatalogs(buildBuiltInCatalog(), { services: overlay });
  return { services: catalog.services, presets, scenarios: await readScenarioGates() };
}

/** A GitHub table whose columns are padded, so that `deno fmt` leaves the file as written. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const cells = (row: readonly string[]) => row.map((cell) => cell.replaceAll("|", "\\|"));
  const all = [header, ...rows].map(cells);
  const widths = header.map((_, column) => Math.max(...all.map((row) => row[column].length)));
  const line = (row: readonly string[]) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`;
  const rule = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [line(all[0]), rule, ...all.slice(1).map(line)].join("\n");
}

const code = (value: Opt<string, Reason.OptionalInput>): string =>
  value === undefined || value === "" ? NONE : `\`${value}\``;

function servicesTable(services: Record<string, ICatalogService>): string {
  const rows = Object.entries(services).sort(([left], [right]) => left.localeCompare(right)).map(([id, service]) => [
    code(id),
    code(service.adapter),
    code(service.transport),
    code(service.interface),
    code(service.key_env),
    code(service.requires_optin),
    code(service.endpoint),
  ]);
  return table(["Service", "Adapter", "Transport", "Interface", "Key variable", "Opt-in variable", "Endpoint"], rows);
}

type Usage = { kind: string; services: Set<string>; presets: Set<string>; scenarios: Set<string> };

function usageOf(settings: ILoadedSettings): Map<string, Usage> {
  const usage = new Map<string, Usage>();
  const entry = (name: string, kind: string): Usage => {
    const found = usage.get(name) ?? { kind, services: new Set(), presets: new Set(), scenarios: new Set() };
    usage.set(name, found);
    return found;
  };
  for (const [id, service] of Object.entries(settings.services)) {
    if (service.key_env) entry(service.key_env, "key").services.add(id);
    if (service.requires_optin) entry(service.requires_optin, "opt-in").services.add(id);
  }
  for (const [name, preset] of Object.entries(settings.presets)) {
    if (preset.requires_key) entry(preset.requires_key, "key").presets.add(name);
    if (preset.requires_optin) entry(preset.requires_optin, "opt-in").presets.add(name);
  }
  for (const gate of settings.scenarios) {
    for (const name of gate.keys) entry(name, "key").scenarios.add(gate.id);
    for (const name of gate.optins) entry(name, "opt-in").scenarios.add(gate.id);
  }
  return usage;
}

const list = (values: Set<string>): string =>
  values.size === 0 ? NONE : [...values].sort().map((value) => `\`${value}\``).join(", ");

function keysTable(settings: ILoadedSettings): string {
  const rows = [...usageOf(settings)].sort(([left], [right]) => left.localeCompare(right)).map(([name, use]) => [
    code(name),
    use.kind,
    list(use.services),
    list(use.presets),
    list(use.scenarios),
  ]);
  return table(["Variable", "Kind", "Services", "Preset rows", "Scenarios"], rows);
}

function bindingOf(spec: Opt<IBindingSpec, Reason.OptionalInput>): string {
  if (spec === undefined) return NONE;
  const fields = Object.entries(spec).filter(([, value]) => value !== undefined).map(([field, value]) =>
    `${field}=${value}`
  );
  return fields.length === 0 ? NONE : `\`${fields.join(",")}\``;
}

function liveTable(presets: Record<string, ICatalogPreset>): string {
  const rows = Object.entries(presets).filter(([name]) => name.startsWith(LIVE_PREFIX)).sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([name, preset]) => [
    code(name),
    code(preset.provider),
    bindingOf(preset.bindings?.default),
    code(preset.requires_bin === "true" ? undefined : preset.requires_bin),
    code(preset.requires_key),
    code(preset.requires_optin),
  ]);
  return table(["Row", "Provider", "Binding", "Binary on PATH", "Key variable", "Opt-in variable"], rows);
}

function cellsTable(presets: Record<string, ICatalogPreset>): string {
  const rows = Object.entries(presets).filter(([name]) => !name.startsWith(LIVE_PREFIX)).sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([name, preset]) => [
    code(name),
    code(preset.tool),
    code(preset.provider),
    code(preset.model),
    code(preset.requires_bin === "true" ? undefined : preset.requires_bin),
    code(preset.requires_key),
    code(preset.requires_optin),
  ]);
  return table(["Cell", "Tool", "Provider", "Model", "Binary on PATH", "Key variable", "Opt-in variable"], rows);
}

function otherTable(): string {
  const rows = OTHER_VARIABLES.map((variable) => [
    code(variable.name),
    variable.scope,
    variable.purpose,
    code(variable.readBy),
  ]);
  return table(["Variable", "Scope", "Purpose", "Read by"], rows);
}

const BLOCK_NAMES = ["services", "keys", "live", "cells", "other"] as const;

/** The text of `existing` with each generated block rewritten from the catalog, the preset rows and the scenario files. */
export async function renderModelSettings(existing: string): Promise<string> {
  const settings = await loadSettings();
  const tables: Record<(typeof BLOCK_NAMES)[number], string> = {
    services: servicesTable(settings.services),
    keys: keysTable(settings),
    live: liveTable(settings.presets),
    cells: cellsTable(settings.presets),
    other: otherTable(),
  };
  let text = existing;
  for (const name of BLOCK_NAMES) {
    const start = `<!-- model-settings:${name}:start -->`;
    const end = `<!-- model-settings:${name}:end -->`;
    const from = text.indexOf(start);
    const to = text.indexOf(end);
    if (from === -1 || to === -1 || to < from) throw new Error(`${MODEL_SETTINGS_DOC} has no ${name} block`);
    text = `${text.slice(0, from + start.length)}\n\n${tables[name]}\n\n${text.slice(to)}`;
  }
  return text;
}

if (import.meta.main) {
  await Deno.writeTextFile(MODEL_SETTINGS_DOC, await renderModelSettings(await Deno.readTextFile(MODEL_SETTINGS_DOC)));
  console.log(`wrote ${relative(REPO_ROOT, MODEL_SETTINGS_DOC)}`);
}
