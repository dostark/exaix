/**
 * @module BindingResolverTest
 * @path packages/ai/tests/bindings/binding_resolver_test.ts
 * @description Checks the first binding resolver slice for default and exact flow steps.
 */

import { assertEquals } from "@std/assert";
import type { IBindingCatalog, IBindingLayers, IBindingStepRef } from "@exaix/schemas";
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
