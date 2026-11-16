#!/usr/bin/env -S deno run -A
/**
 * @module GenerateProviderSettings
 * @path scripts/generate_provider_settings.ts
 * @description Writes docs/Exaix_Provider_Settings.md, the one reference of the environment variables and presets that choose a provider, service, transport and model. The tables come from the binding catalog, the rows of tests/configs/model_presets.toml and the scenario files, so they cannot drift from the code.
 *
 * Usage:
 *   deno task docs:providers
 * @architectural-layer Tooling
 * @dependencies [@exaix/model-registry, @std/fs, @std/path]
 * @related-files ["tests/configs/model_presets.toml", "tests/helpers/live_presets.ts", "tests/docs/provider_settings_drift_test.ts"]
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
export const PROVIDER_SETTINGS_DOC = join(REPO_ROOT, "docs", "Exaix_Provider_Settings.md");
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

const SELECTION_ROWS: readonly (readonly string[])[] = [
  [
    "Production (daemon and exactl)",
    "The operator binding layers when they exist, see [Model bindings for flow steps](Exaix_User_Guide.md#model-bindings-for-flow-steps). Otherwise `EXA_LLM_PROVIDER` and `EXA_LLM_MODEL`, then the `[ai]` section of `exa.config.toml`, then the built-in `mock` provider.",
  ],
  [
    "A flow step",
    "The `--bind` and `--overlay` options of `exactl request create`, the step binding of the flow and the catalog. `exactl flow bindings <flow>` previews the result.",
  ],
  [
    "An in-process live test",
    "`EXA_TEST_BIND`, else the `default` binding of the `live-<service>` row of `tests/configs/model_presets.toml`. The row of the bound service also decides whether the test runs.",
  ],
  [
    "A scenario",
    "The preset row that `--cell <tool or provider>` selects. The runner `tests/scenario_framework/runner/main.ts` adds `--overlay <file>` and `--bind <spec>` layers above it.",
  ],
];

function selectionSection(): string {
  return `## How a run chooses its provider, service, transport and model

${table(["Where the run happens", "What chooses the settings, strongest first"], SELECTION_ROWS)}

A key in the environment never starts a billable run. A run starts when its opt-in variable is set and, for a billable service, the key is set. A transport (\`cloud\` or \`local\`) and an interface (\`api\` or \`cli\`) belong to the service, so choosing a service chooses them. No environment variable sets them alone.
`;
}

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

function servicesSection(services: Record<string, ICatalogService>): string {
  const rows = Object.entries(services).sort(([left], [right]) => left.localeCompare(right)).map(([id, service]) => [
    code(id),
    code(service.adapter),
    code(service.transport),
    code(service.interface),
    code(service.key_env),
    code(service.requires_optin),
    code(service.endpoint),
  ]);
  return `## Services

Each service fixes its transport and interface. The built-in services come from \`packages/model-registry/src/binding_catalog.ts\`. The \`live-*\` rows of \`tests/configs/model_presets.toml\` add the others, such as \`opencode-go\`.

${table(["Service", "Adapter", "Transport", "Interface", "Key variable", "Opt-in variable", "Endpoint"], rows)}
`;
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

function credentialsSection(settings: ILoadedSettings): string {
  const rows = [...usageOf(settings)].sort(([left], [right]) => left.localeCompare(right)).map(([name, use]) => [
    code(name),
    use.kind,
    list(use.services),
    list(use.presets),
    list(use.scenarios),
  ]);
  return `## Keys and opt-ins

Every key and opt-in variable that a service, a preset row or a scenario names, with the places that use it. A billable service needs its key and \`EXA_TEST_ENABLE_PAID_LLM\`. A local runtime or a subscription CLI needs its \`EXA_MATRIX_*\` opt-in. An opt-in counts when it is non-empty.

${table(["Variable", "Kind", "Services", "Preset rows", "Scenarios"], rows)}
`;
}

function bindingOf(spec: Opt<IBindingSpec, Reason.OptionalInput>): string {
  if (spec === undefined) return NONE;
  const fields = Object.entries(spec).filter(([, value]) => value !== undefined).map(([field, value]) =>
    `${field}=${value}`
  );
  return fields.length === 0 ? NONE : `\`${fields.join(",")}\``;
}

function liveSection(presets: Record<string, ICatalogPreset>): string {
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
  return `## Live-test rows

An in-process live test reads the row of its service. Select another provider, service or model with \`EXA_TEST_BIND='default=<binding>'\`, where \`<binding>\` is the value of the Binding column or the binding of another service. The gate then follows the bound service.

${table(["Row", "Provider", "Binding", "Binary on PATH", "Key variable", "Opt-in variable"], rows)}
`;
}

function cellsSection(presets: Record<string, ICatalogPreset>): string {
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
  return `## Scenario cells

A scenario selects these rows with \`matrix.from_catalog\`, and \`--cell <tool or provider>\` runs one of them. Each row names the daemon configuration that the cell boots, in \`tests/configs/\`.

${table(["Cell", "Tool", "Provider", "Model", "Binary on PATH", "Key variable", "Opt-in variable"], rows)}
`;
}

function otherSection(): string {
  const rows = OTHER_VARIABLES.map((variable) => [
    code(variable.name),
    variable.scope,
    variable.purpose,
    code(variable.readBy),
  ]);
  return `## Other variables

${table(["Variable", "Scope", "Purpose", "Read by"], rows)}
`;
}

/** The whole page, from the catalog, the preset rows and the scenario files. */
export async function renderProviderSettings(): Promise<string> {
  const settings = await loadSettings();
  return [
    `---
title: "Provider, service, transport and model settings"
description: "The environment variables and presets that choose a provider, service, transport and model"
---

<!-- Generated by \`deno task docs:providers\`. Do not edit. -->

# Provider, service, transport and model settings

One reference of the settings that choose a provider, a service, a transport and a model, for production, for tests and for scenarios. The tables come from the binding catalog, the rows of \`tests/configs/model_presets.toml\` and the scenario files. The [User Guide](Exaix_User_Guide.md#53-environment-variable-reference) explains the variables in prose.
`,
    selectionSection(),
    servicesSection(settings.services),
    credentialsSection(settings),
    liveSection(settings.presets),
    cellsSection(settings.presets),
    otherSection(),
  ].join("\n");
}

if (import.meta.main) {
  await Deno.writeTextFile(PROVIDER_SETTINGS_DOC, await renderProviderSettings());
  console.log(`wrote ${relative(REPO_ROOT, PROVIDER_SETTINGS_DOC)}`);
}
