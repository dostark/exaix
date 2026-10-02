/**
 * @module BindingResolverTest
 * @path packages/ai/tests/bindings/binding_resolver_test.ts
 * @description Checks the first binding resolver slice for default and exact flow steps.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  getDefaultModels,
  type IBindingCatalog,
  type IBindingLayers,
  type IBindingStepRef,
  type PinnableBindingField,
} from "@exaix/schemas";
import { resolveBinding, selectorsCanOverlap } from "@exaix/ai";

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

// --- Step 5: flow-file binding and pin ---

const STEP_BINDING = { service: "alpha", model: "mock/alpha" };
const STEP_PIN = { fields: ["service", "model"] as PinnableBindingField[], reason: "capability-gate" as const };

function pinLayers(bindings: Record<string, { service?: string; model?: string }>): IBindingLayers {
  return {
    entries: Object.entries(bindings).map(([selector, spec]) => ({ layer: "config", selector, spec })),
    catalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  };
}

Deno.test("a flow-step binding resolves on its declared service with no config layer", () => {
  const layers: IBindingLayers = {
    entries: [],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: false,
  };
  const outcome = resolveBinding(ref, { binding: STEP_BINDING }, layers, probe);
  assertEquals(outcome.kind, "bound");
  if (outcome.kind === "bound") {
    assertEquals(outcome.binding.service, "alpha");
    assertEquals(outcome.binding.model, "mock/alpha");
    // The flow layer owns the winning fields.
    assertEquals(outcome.binding.sources.service?.layer, "flow");
  }
});

Deno.test("an exact step selector in config that changes a pinned field yields pinned naming selector and reason", () => {
  const outcome = resolveBinding(
    ref,
    { binding: STEP_BINDING, pin: STEP_PIN },
    pinLayers({ "flow:research/step:compose": { service: "beta", model: "mock/beta" } }),
    probe,
  );
  assertEquals(outcome.kind, "invalid");
  if (outcome.kind === "invalid") {
    assertEquals(outcome.issues[0].code, "pinned");
    assertEquals(outcome.issues[0].selector, "flow:research/step:compose");
    // The pin reason is carried on the issue detail or a dedicated field.
    assertStringIncludes(outcome.issues[0].detail, "capability-gate");
  }
});

Deno.test("a broader selector (default) that changes a pinned field keeps the flow value and records pin_kept", () => {
  const outcome = resolveBinding(
    ref,
    { binding: STEP_BINDING, pin: STEP_PIN },
    pinLayers({ default: { service: "beta", model: "mock/beta" } }),
    probe,
  );
  assertEquals(outcome.kind, "bound");
  if (outcome.kind === "bound") {
    // The pinned field stays at the flow value.
    assertEquals(outcome.binding.service, "alpha");
    assertEquals(outcome.binding.model, "mock/alpha");
    // pin_kept records the skipped selector and layer.
    const source = outcome.binding.sources.service;
    assertEquals(source?.layer, "flow");
    assertEquals(source?.pin_kept?.skipped_selector, "default");
    assertEquals(source?.pin_kept?.skipped_layer, "config");
  }
});

Deno.test("an equal value in a higher layer passes silently (no pin_kept)", () => {
  const outcome = resolveBinding(
    ref,
    { binding: STEP_BINDING, pin: STEP_PIN },
    pinLayers({ default: { service: "alpha", model: "mock/alpha" } }),
    probe,
  );
  assertEquals(outcome.kind, "bound");
  if (outcome.kind === "bound") {
    assertEquals(outcome.binding.service, "alpha");
    const source = outcome.binding.sources.service;
    assertEquals(source?.pin_kept, undefined);
  }
});

Deno.test("a flow:/step glob that changes a pinned field keeps the flow value with pin_kept", () => {
  const outcome = resolveBinding(
    ref,
    { binding: STEP_BINDING, pin: STEP_PIN },
    pinLayers({ "flow:research/step:*": { service: "beta", model: "mock/beta" } }),
    probe,
  );
  assertEquals(outcome.kind, "bound");
  if (outcome.kind === "bound") {
    assertEquals(outcome.binding.service, "alpha");
    const source = outcome.binding.sources.service;
    assertEquals(source?.layer, "flow");
    assertEquals(source?.pin_kept?.skipped_selector, "flow:research/step:*");
  }
});

Deno.test("a broader override still changes the step's unpinned fields", () => {
  const outcome = resolveBinding(
    ref,
    {
      binding: { service: "alpha", model: "mock/alpha", transport: "local" },
      pin: { fields: ["transport"], reason: "capability-gate" },
    },
    pinLayers({ default: { service: "beta", model: "mock/beta" } }),
    probe,
  );
  // The default layer's unpinned service is overridden to beta.
  // Transport stays pinned at local, so resolution binds service beta.
  assertEquals(outcome.kind, "bound");
  if (outcome.kind === "bound") {
    assertEquals(outcome.binding.service, "beta");
    assertEquals(outcome.binding.transport, "local");
  }
});

// --- Phase 203 Step 3: the scenario-judge ref kind ---

/** A judge ref. The scenario id is the flowId and the judge step id is the stepId.
 *  A judge binding therefore carries the identity a flow step does. */
const judgeRef: IBindingStepRef = {
  flowId: "persona-eval",
  stepId: "judge-response",
  agentRole: "judge",
  kind: "judge",
  judgeId: "response",
  nativeTools: false,
};

/** A gate ref, as the shipped flow gate judges carry it. */
const gateRef: IBindingStepRef = {
  flowId: "research",
  stepId: "compose",
  agentRole: "gate-judge",
  kind: "gate",
  nativeTools: false,
};

const judgeCatalog: IBindingCatalog = {
  models: { "mock/alpha": { model_provider: "mock" }, "mock/beta": { model_provider: "mock" } },
  services: {
    alpha: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/alpha": "alpha" } },
    beta: { adapter: "mock", transport: "local", interface: "api", serves: { "mock/beta": "beta" } },
    "alpha-cli": { adapter: "mock", transport: "local", interface: "cli", serves: { "mock/alpha": "alpha" } },
  },
  preferences: {},
};

Deno.test("[resolver] a judge ref matches judge and judge:<id> only, and judge:<id> outranks judge", () => {
  // A scenario judge must not inherit a binding written for the subject under test.
  // So default, role: and flow: entries never reach it.
  const broadOnly = layer([
    { layer: "config", selector: "default", spec: { service: "alpha", model: "mock/alpha" } },
    { layer: "config", selector: "role:judge", spec: { service: "alpha", model: "mock/alpha" } },
    { layer: "config", selector: "flow:persona-eval", spec: { service: "alpha", model: "mock/alpha" } },
    {
      layer: "config",
      selector: "flow:persona-eval/step:judge-response",
      spec: { service: "alpha", model: "mock/alpha" },
    },
  ]);
  assertEquals(
    resolveBinding(judgeRef, {}, broadOnly, probe),
    { kind: "unbound" },
    "no judge selector is present, so the judge stays unbound",
  );

  const bareJudge = resolveBinding(
    judgeRef,
    {},
    layer([{ layer: "config", selector: "judge", spec: { service: "alpha", model: "mock/alpha" } }]),
    probe,
  );
  assertEquals(bareJudge.kind, "bound");
  if (bareJudge.kind === "bound") {
    assertEquals(bareJudge.binding.service, "alpha");
    assertEquals(bareJudge.binding.sources.service?.selector, "judge");
  }

  const bothJudgeSelectors = layer([
    { layer: "config", selector: "judge", spec: { service: "alpha", model: "mock/alpha" } },
    { layer: "config", selector: "judge:response", spec: { service: "beta", model: "mock/beta" } },
  ]);
  const specific = resolveBinding(judgeRef, {}, bothJudgeSelectors, probe);
  assertEquals(specific.kind, "bound");
  if (specific.kind === "bound") {
    assertEquals(specific.binding.service, "beta", "judge:<id> must outrank the bare judge selector");
    assertEquals(specific.binding.sources.service?.selector, "judge:response");
  }

  // Another judge's selector is a different binding, not a broader one.
  const otherJudge = resolveBinding(
    judgeRef,
    {},
    layer([
      { layer: "config", selector: "judge", spec: { service: "alpha", model: "mock/alpha" } },
      { layer: "config", selector: "judge:other", spec: { service: "beta", model: "mock/beta" } },
    ]),
    probe,
  );
  assertEquals(otherJudge.kind, "bound");
  if (otherJudge.kind === "bound") assertEquals(otherJudge.binding.service, "alpha");
});

Deno.test('[resolver][regression] a kind:"gate" ref still matches default, role: and flow: and never a judge selector', () => {
  const byDefault = resolveBinding(
    gateRef,
    {},
    layer([{ layer: "config", selector: "default", spec: { service: "alpha", model: "mock/alpha" } }]),
    probe,
  );
  assertEquals(byDefault.kind, "bound");

  const byRole = resolveBinding(
    gateRef,
    {},
    layer([{ layer: "config", selector: "role:gate-judge", spec: { service: "beta", model: "mock/beta" } }]),
    probe,
  );
  assertEquals(byRole.kind, "bound");
  if (byRole.kind === "bound") assertEquals(byRole.binding.service, "beta");

  const byFlow = resolveBinding(
    gateRef,
    {},
    layer([{
      layer: "config",
      selector: "flow:research/step:compose",
      spec: { service: "beta", model: "mock/beta" },
    }]),
    probe,
  );
  assertEquals(byFlow.kind, "bound");
  if (byFlow.kind === "bound") assertEquals(byFlow.binding.service, "beta");

  const judgeSelectorsOnly = layer([
    { layer: "config", selector: "judge", spec: { service: "alpha", model: "mock/alpha" } },
    { layer: "config", selector: "judge:response", spec: { service: "beta", model: "mock/beta" } },
  ]);
  assertEquals(resolveBinding(gateRef, {}, judgeSelectorsOnly, probe), { kind: "unbound" });
});

Deno.test("[resolver] a judge may bind a cli-interface service, which a plain flow step may not", () => {
  const judgeOutcome = resolveBinding(
    judgeRef,
    {},
    layer([{ layer: "config", selector: "judge", spec: { service: "alpha-cli", model: "mock/alpha" } }], judgeCatalog),
    probe,
  );
  assertEquals(judgeOutcome.kind, "bound");
  if (judgeOutcome.kind === "bound") assertEquals(judgeOutcome.binding.interface, "cli");

  const agentOutcome = resolveBinding(
    ref,
    {},
    layer([{
      layer: "config",
      selector: "flow:research/step:compose",
      spec: { service: "alpha-cli", model: "mock/alpha" },
    }], judgeCatalog),
    probe,
  );
  assertEquals(agentOutcome.kind, "invalid");
  if (agentOutcome.kind === "invalid") {
    assertEquals(agentOutcome.issues[0].code, "interface_unsupported");
  }
});

Deno.test("[resolver] a judge pin treats judge:<id> as the exact selector", () => {
  const step = {
    binding: { service: "alpha", model: "mock/alpha" },
    pin: { fields: ["model" as PinnableBindingField], reason: "compliance" as const },
  };

  // judge:<id> is this judge's exact selector, so it is an exact override → pinned.
  const exact = resolveBinding(
    judgeRef,
    step,
    layer([{ layer: "config", selector: "judge:response", spec: { model: "mock/beta" } }]),
    probe,
  );
  assertEquals(exact.kind, "invalid");
  if (exact.kind === "invalid") assertEquals(exact.issues[0].code, "pinned");

  // The bare judge selector is broader than this judge, so the pinned value is kept.
  const broader = resolveBinding(
    judgeRef,
    step,
    layer([{ layer: "config", selector: "judge", spec: { model: "mock/beta" } }]),
    probe,
  );
  assertEquals(broader.kind, "bound");
  if (broader.kind === "bound") {
    assertEquals(broader.binding.model, "mock/alpha");
    assertEquals(broader.binding.sources.model?.pin_kept?.skipped_selector, "judge");
  }
});

Deno.test("[phase203.resolver] an explicit ollama-chat binding needs no preference key", () => {
  const ollamaCatalog: IBindingCatalog = {
    models: { "meta/llama3.1:8b": { model_provider: "meta" } },
    services: {
      "ollama-chat": {
        adapter: "openai-chat",
        profile: "self-hosted",
        endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        transport: "local",
        interface: "api",
        supports_tool_choice: false,
        serves: { "*": "{name}" },
      },
    },
    preferences: {},
  };
  const layers: IBindingLayers = {
    entries: [{
      layer: "config",
      selector: "default",
      spec: { service: "ollama-chat", model: "meta/llama3.1:8b" },
    }],
    catalog: ollamaCatalog,
    overlaySha256: [],
    operatorLayersPresent: true,
  };

  const outcome = resolveBinding(ref, {}, layers, probe);

  assertEquals(outcome.kind, "bound");
  if (outcome.kind !== "bound") return;
  assertEquals(outcome.binding.service, "ollama-chat");
  assertEquals(outcome.binding.profile, "self-hosted");
  assertEquals(outcome.binding.service_model_id, "llama3.1:8b");
  assertEquals(outcome.binding.supports_tool_choice, false);
});

Deno.test("[phase203.resolver] selectorsCanOverlap is true only when one step can match both selectors", () => {
  const overlapping: Array<[string, string]> = [
    ["default", "flow:f/step:compose"],
    ["flow:f/step:compose", "flow:f/step:compose"],
    ["flow:f", "flow:f/step:compose"],
    ["flow:f/step:explore-*", "flow:f/step:explore-1"],
    ["role:composer", "flow:f/step:compose"],
    ["judge", "judge:j1"],
  ];
  const disjoint: Array<[string, string]> = [
    ["flow:f/step:compose", "flow:f/step:explore-1"],
    ["flow:f/step:explore-*", "flow:f/step:compose"],
    ["flow:f/step:compose", "flow:g/step:compose"],
    ["role:composer", "role:web-explorer"],
    ["judge:j1", "judge:j2"],
    ["judge", "default"],
    ["judge:j1", "flow:f/step:compose"],
  ];
  for (const [left, right] of overlapping) {
    assertEquals(selectorsCanOverlap(left, right), true, `${left} ~ ${right}`);
    assertEquals(selectorsCanOverlap(right, left), true, `${right} ~ ${left}`);
  }
  for (const [left, right] of disjoint) {
    assertEquals(selectorsCanOverlap(left, right), false, `${left} !~ ${right}`);
    assertEquals(selectorsCanOverlap(right, left), false, `${right} !~ ${left}`);
  }
});
