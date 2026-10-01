/**
 * @module BindingResolverTest
 * @path packages/ai/tests/bindings/binding_resolver_test.ts
 * @description Checks the first binding resolver slice for default and exact flow steps.
 */

import { assertEquals } from "@std/assert";
import { getDefaultModels, type IBindingCatalog, type IBindingLayers, type IBindingStepRef } from "@exaix/schemas";
import { resolveBinding } from "@exaix/ai";

const catalog: IBindingCatalog = {
  models: {
    "mock/alpha": { model_provider: "mock" },
    "mock/beta": { model_provider: "mock" },
  },
  services: {
    alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
    beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
  },
  preferences: {},
};
const ref: IBindingStepRef = {
  flowId: "research",
  stepId: "compose",
  agentRole: "composer",
  kind: "agent",
  nativeTools: false,
};
const probe = { hasKey: (_name: string): boolean => true, hasOptIn: (_name: string): boolean => true };

Deno.test("default and exact step selectors choose service model ids with source provenance", () => {
  const layers: IBindingLayers = {
    entries: [
      { layer: "config", selector: "default", spec: { service: "alpha", model: "mock/alpha" } },
      {
        layer: "config",
        selector: "flow:research/step:compose",
        spec: { service: "beta", model: "mock/beta" },
      },
    ],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  };
  const compose = resolveBinding(ref, {}, layers, probe);
  assertEquals(compose.kind, "bound");
  if (compose.kind !== "bound") return;
  assertEquals(compose.binding.service, "beta");
  assertEquals(compose.binding.service_model_id, "beta");
  assertEquals(compose.binding.sources.service?.selector, "flow:research/step:compose");
  assertEquals(compose.binding.fingerprint.length, 64);

  const explore = resolveBinding({ ...ref, stepId: "explore" }, {}, layers, probe);
  assertEquals(explore.kind, "bound");
  if (explore.kind !== "bound") return;
  assertEquals(explore.binding.service, "alpha");
  assertEquals(explore.binding.sources.model?.selector, "default");
});

Deno.test("an untouched step is unbound and an unknown service is invalid", () => {
  assertEquals(
    resolveBinding(ref, {}, { entries: [], catalog, overlaySha256: [], operatorLayersPresent: false }, probe),
    { kind: "unbound" },
  );
  const result = resolveBinding(ref, {}, {
    entries: [{ layer: "config", selector: "default", spec: { service: "missing", model: "mock/alpha" } }],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  }, probe);
  assertEquals(result.kind, "invalid");
  if (result.kind === "invalid") assertEquals(result.issues[0].code, "unknown_service");
});

Deno.test("requested call features require verified model capability metadata", () => {
  const result = resolveBinding(ref, {}, {
    entries: [{
      layer: "config",
      selector: "default",
      spec: { service: "alpha", model: "mock/alpha", thinking: true },
    }],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  }, probe);
  assertEquals(result.kind, "invalid");
  if (result.kind === "invalid") assertEquals(result.issues[0].code, "capability_missing");
});

Deno.test("an explicit service model id must agree with the service route", () => {
  const result = resolveBinding(ref, {}, {
    entries: [{
      layer: "config",
      selector: "default",
      spec: { service: "alpha", model: "mock/alpha", service_model_id: "beta" },
    }],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  }, probe);
  assertEquals(result.kind, "invalid");
  if (result.kind === "invalid") assertEquals(result.issues[0].code, "service_does_not_serve_model");
});

function layer(entries: IBindingLayers["entries"], catalogFor: IBindingCatalog = catalog): IBindingLayers {
  return { entries, catalog: catalogFor, overlaySha256: [], operatorLayersPresent: true };
}

const roleCatalog: IBindingCatalog = {
  models: {
    "mock/alpha": { model_provider: "mock", capabilities: ["thinking", "effort"] },
    "mock/beta": { model_provider: "mock", capabilities: ["thinking", "effort"] },
  },
  services: {
    alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
    beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
  },
  preferences: { mock: ["alpha", "beta"] },
};

Deno.test("a role binding applies to every step of that role across flows", () => {
  const layers = layer(
    [{ layer: "config", selector: "role:composer", spec: { model: "mock/alpha" } }],
    roleCatalog,
  );
  const first = resolveBinding({ ...ref, flowId: "research", stepId: "compose" }, {}, layers, probe);
  assertEquals(first.kind, "bound");
  if (first.kind !== "bound") return;
  assertEquals(first.binding.service, "alpha");
  assertEquals(first.binding.sources.service?.selector, "role:composer");

  const second = resolveBinding({ ...ref, flowId: "docs", stepId: "write", agentRole: "composer" }, {}, layers, probe);
  assertEquals(second.kind, "bound");
  if (second.kind !== "bound") return;
  assertEquals(second.binding.service, "alpha");

  const explorer = resolveBinding({ ...ref, agentRole: "explorer" }, {}, layers, probe);
  assertEquals(explorer.kind, "unbound");
});

Deno.test("within one layer step exact > step glob > role > flow > default, per field", () => {
  const layers = layer([
    { layer: "config", selector: "default", spec: { service: "alpha", model: "mock/alpha" } },
    { layer: "config", selector: "flow:research", spec: { service: "beta", model: "mock/beta" } },
    { layer: "config", selector: "role:composer", spec: { service: "alpha", model: "mock/beta" } },
    { layer: "config", selector: "flow:research/step:com*", spec: { service: "beta", model: "mock/alpha" } },
    {
      layer: "config",
      selector: "flow:research/step:compose",
      spec: { service: "beta", model: "mock/beta", effort: "high" },
    },
  ], roleCatalog);
  const result = resolveBinding(ref, {}, layers, probe);
  assertEquals(result.kind, "bound");
  if (result.kind !== "bound") return;
  assertEquals(result.binding.service, "beta");
  assertEquals(result.binding.model, "mock/beta");
  assertEquals(result.binding.effort, "high");
  assertEquals(result.binding.sources.service?.selector, "flow:research/step:compose");
  assertEquals(result.binding.sources.model?.selector, "flow:research/step:compose");
});

Deno.test("two equal-specificity globs setting a field differently are ambiguous; a longer literal prefix wins", () => {
  const ambiguous = resolveBinding(
    { ...ref, stepId: "cax" },
    {},
    layer([
      { layer: "config", selector: "flow:research/step:c*", spec: { service: "alpha" } },
      { layer: "config", selector: "flow:research/step:c*x", spec: { service: "beta" } },
    ], roleCatalog),
    probe,
  );
  assertEquals(ambiguous.kind, "invalid");
  if (ambiguous.kind === "invalid") assertEquals(ambiguous.issues[0].code, "ambiguous_selector");

  const longerWins = resolveBinding(
    { ...ref, stepId: "cax" },
    {},
    layer([
      { layer: "config", selector: "flow:research/step:ca*", spec: { service: "alpha", model: "mock/alpha" } },
      { layer: "config", selector: "flow:research/step:c*", spec: { service: "beta", model: "mock/alpha" } },
    ], roleCatalog),
    probe,
  );
  assertEquals(longerWins.kind, "bound");
  if (longerWins.kind !== "bound") return;
  assertEquals(longerWins.binding.service, "alpha");
});

Deno.test("a model-only binding picks the first preferred service with a key that matches", () => {
  const keyedCatalog: IBindingCatalog = {
    models: { "openai/gpt-6-luna": { model_provider: "openai" } },
    services: {
      locked: {
        adapter: "openai-chat",
        transport: "cloud",
        interface: "api",
        key_env: "OPENAI_API_KEY",
        serves: { "openai/gpt-6-luna": "gpt-6-luna" },
      },
      open: {
        adapter: "openai-chat",
        transport: "cloud",
        interface: "api",
        serves: { "openai/gpt-6-luna": "gpt-6-luna" },
      },
    },
    preferences: { openai: ["locked", "open"] },
  };
  const noKey = {
    hasKey: (name: string): boolean => name !== "OPENAI_API_KEY",
    hasOptIn: (_name: string): boolean => true,
  };
  const result = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { model: "openai/gpt-6-luna", transport: "cloud", interface: "api" },
    }], keyedCatalog),
    noKey,
  );
  assertEquals(result.kind, "bound");
  if (result.kind !== "bound") return;
  assertEquals(result.binding.service, "open");
  assertEquals(result.binding.service_model_id, "gpt-6-luna");
});

Deno.test("no_service_for_constraints lists why each candidate was dropped", () => {
  const droppedCatalog: IBindingCatalog = {
    models: { "openai/gpt-6-luna": { model_provider: "openai" } },
    services: {
      locked: {
        adapter: "openai-chat",
        transport: "cloud",
        interface: "api",
        key_env: "OPENAI_API_KEY",
        serves: { "openai/gpt-6-luna": "gpt-6-luna" },
      },
    },
    preferences: { openai: ["locked"] },
  };
  const noKey = { hasKey: (): boolean => false, hasOptIn: (): boolean => true };
  const result = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { model: "openai/gpt-6-luna" },
    }], droppedCatalog),
    noKey,
  );
  assertEquals(result.kind, "invalid");
  if (result.kind === "invalid") {
    assertEquals(result.issues[0].code, "no_service_for_constraints");
    assertEquals(result.issues[0].detail.includes("locked"), true);
  }
});

Deno.test('"*" serves template substitutes {model} and {name}; service_model_id bypasses serves', () => {
  const templateCatalog: IBindingCatalog = {
    models: { "openai/gpt-6-luna": { model_provider: "openai" } },
    services: {
      modelRoute: { adapter: "openrouter", transport: "cloud", interface: "api", serves: { "*": "{model}" } },
      nameRoute: { adapter: "openrouter", transport: "cloud", interface: "api", serves: { "*": "{name}" } },
      alpha: { adapter: "mock", transport: "local", interface: "api", serves: {} },
    },
    preferences: { openai: ["modelRoute", "nameRoute"], mock: ["alpha"] },
  };
  const byModel = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { service: "modelRoute", model: "openai/gpt-6-luna" },
    }], templateCatalog),
    probe,
  );
  assertEquals(byModel.kind, "bound");
  if (byModel.kind !== "bound") return;
  assertEquals(byModel.binding.service_model_id, "openai/gpt-6-luna");

  const byName = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { service: "nameRoute", model: "openai/gpt-6-luna" },
    }], templateCatalog),
    probe,
  );
  assertEquals(byName.kind, "bound");
  if (byName.kind !== "bound") return;
  assertEquals(byName.binding.service_model_id, "gpt-6-luna");

  const escape = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { service: "alpha", service_model_id: "custom-id" },
    }], templateCatalog),
    probe,
  );
  assertEquals(escape.kind, "bound");
  if (escape.kind !== "bound") return;
  assertEquals(escape.binding.service_model_id, "custom-id");
  assertEquals(escape.binding.model, "alpha/custom-id");
});

Deno.test("provider-only, transport-only, interface-only and service-model-id-only follow the deterministic table", () => {
  const mockDefault = `mock/${getDefaultModels().mock}`;
  const partialCatalog: IBindingCatalog = {
    models: {
      [mockDefault]: { model_provider: "mock" },
      "mock/alpha": { model_provider: "mock" },
    },
    services: {
      alpha: {
        adapter: "mock",
        transport: "local",
        interface: "api",
        serves: { [mockDefault]: "alpha", "mock/alpha": "alpha" },
      },
    },
    preferences: { mock: ["alpha"] },
  };
  const providerOnly = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { model_provider: "mock" },
    }], partialCatalog),
    probe,
  );
  assertEquals(providerOnly.kind, "bound");
  if (providerOnly.kind !== "bound") return;
  assertEquals(providerOnly.binding.model, mockDefault);

  const withConfigDefault: IBindingLayers = {
    entries: [{ layer: "config", selector: "default", spec: { transport: "local" } }],
    catalog: partialCatalog,
    overlaySha256: [],
    operatorLayersPresent: true,
    configDefaultModel: mockDefault,
  };
  const transportOnly = resolveBinding(ref, {}, withConfigDefault, probe);
  assertEquals(transportOnly.kind, "bound");
  if (transportOnly.kind !== "bound") return;
  assertEquals(transportOnly.binding.model, mockDefault);

  const interfaceOnly = resolveBinding(ref, {}, {
    ...withConfigDefault,
    entries: [{ layer: "config", selector: "default", spec: { interface: "api" } }],
  }, probe);
  assertEquals(interfaceOnly.kind, "bound");
  if (interfaceOnly.kind !== "bound") return;
  assertEquals(interfaceOnly.binding.model, mockDefault);

  const smidOnly = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "default",
      spec: { service_model_id: "x" },
    }], partialCatalog),
    probe,
  );
  assertEquals(smidOnly.kind, "invalid");
  if (smidOnly.kind === "invalid") assertEquals(smidOnly.issues[0].code, "unknown_service");

  const emptyLayers: IBindingLayers = {
    entries: [{ layer: "config", selector: "default", spec: {} }],
    catalog: partialCatalog,
    overlaySha256: [],
    operatorLayersPresent: false,
  };
  assertEquals(resolveBinding(ref, {}, emptyLayers, probe).kind, "unbound");
});

Deno.test("judge selectors parse but never match a flow step", () => {
  const judgeLayers: IBindingLayers = {
    entries: [
      { layer: "config", selector: "judge", spec: { service: "alpha", model: "mock/alpha" } },
      { layer: "config", selector: "judge:senior", spec: { service: "beta", model: "mock/beta" } },
    ],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  };
  assertEquals(resolveBinding(ref, {}, judgeLayers, probe).kind, "unbound");
});

const cliCatalog: IBindingCatalog = {
  models: { "mock/alpha": { model_provider: "mock" } },
  services: {
    alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
    opencode: {
      adapter: "cli-delegate",
      transport: "local",
      interface: "cli",
      tool: "opencode",
      serves: { "*": "{name}" },
    },
    "claude-cli": {
      adapter: "claude-cli",
      transport: "local",
      interface: "cli",
      serves: { "*": "{name}" },
    },
  },
  preferences: {},
};

function cliLayers(
  bindings: Record<string, { service: string; model?: string; service_model_id?: string }>,
): IBindingLayers {
  return {
    entries: Object.entries(bindings).map(([selector, spec]) => ({ layer: "config", selector, spec })),
    catalog: cliCatalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  };
}

Deno.test("a gate step bound to a cli-delegate service is rejected with interface_unsupported", () => {
  const outcome = resolveBinding(
    { ...ref, stepId: "gate1", kind: "gate" },
    {},
    cliLayers({ "flow:research/step:gate1": { service: "opencode", service_model_id: "opencode/x" } }),
    probe,
  );
  assertEquals(outcome.kind, "invalid");
  if (outcome.kind === "invalid") assertEquals(outcome.issues[0].code, "interface_unsupported");
});

Deno.test("a gate step bound to a generate-backed cli provider (claude-cli) is allowed", () => {
  const outcome = resolveBinding(
    { ...ref, stepId: "gate1", kind: "gate" },
    {},
    cliLayers({ "flow:research/step:gate1": { service: "claude-cli", service_model_id: "claude-cli/x" } }),
    probe,
  );
  assertEquals(outcome.kind, "bound");
});

Deno.test("a strategy cli_delegate step accepts only a cli-delegate service", () => {
  const ok = resolveBinding(
    { ...ref, strategy: "cli_delegate" },
    {},
    cliLayers({ "flow:research/step:compose": { service: "opencode", service_model_id: "opencode/x" } }),
    probe,
  );
  assertEquals(ok.kind, "bound");
  if (ok.kind === "bound") assertEquals(ok.binding.tool, "opencode");

  const refused = resolveBinding(
    { ...ref, strategy: "cli_delegate" },
    {},
    cliLayers({ "flow:research/step:compose": { service: "alpha", model: "mock/alpha" } }),
    probe,
  );
  assertEquals(refused.kind, "invalid");
  if (refused.kind === "invalid") assertEquals(refused.issues[0].code, "interface_unsupported");
});

Deno.test("a plain (non-cli_delegate) agent step refuses a cli interface service", () => {
  const outcome = resolveBinding(
    { ...ref, strategy: "react" },
    {},
    cliLayers({ "flow:research/step:compose": { service: "claude-cli", service_model_id: "claude-cli/x" } }),
    probe,
  );
  assertEquals(outcome.kind, "invalid");
  if (outcome.kind === "invalid") assertEquals(outcome.issues[0].code, "interface_unsupported");
});
