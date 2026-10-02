/**
 * @module ModelBindingsDocsTest
 * @path tests/docs/model_bindings_docs_test.ts
 * @description Keeps the flow binding guide aligned with the shipped schema and paths.
 * @architectural-layer Tests
 * @dependencies [@exaix/schemas, @exaix/core, @std/toml]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { BINDING_OVERLAYS_DIR, BINDINGS_DIR, RUN_BINDINGS_DIR } from "@exaix/core";
import {
  BindingOverlaySchema,
  ConfigSchema,
  type IBindingLayers,
  type IBindingStepRef,
  PinReasonSchema,
} from "@exaix/schemas";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
import { resolveBinding } from "@exaix/ai";
import { readUserGuide } from "./helpers.ts";

async function bindingGuide(): Promise<string> {
  const guide = await readUserGuide();
  const heading = "#### Model bindings for flow steps";
  const start = guide.indexOf(heading);
  assert(start >= 0, `Missing ${heading} section`);
  const end = guide.indexOf("\n#### ", start + heading.length);
  return guide.slice(start, end < 0 ? undefined : end);
}

Deno.test("flow binding guide TOML example parses through ConfigSchema", async () => {
  const guide = await bindingGuide();
  const example = guide.match(/```toml\n([\s\S]*?)```/)?.[1];
  assert(example, "Missing flow binding TOML example");
  const config = ConfigSchema.parse(parseToml(example));
  assertEquals(config.catalog?.services?.["compat-fixture"]?.profile, "local-test");
  assertEquals(config.bindings?.["flow:research/step:explore-*"]?.model, "openai/compat-fixture-v1");
});

Deno.test("flow binding guide lists every issue code and pin reason", async () => {
  const guide = await bindingGuide();
  const source = await Deno.readTextFile("packages/schemas/src/model_binding.ts");
  const issueUnion = source.match(/export type BindingIssueCode =([\s\S]*?);/)?.[1];
  assert(issueUnion, "BindingIssueCode union not found");
  const codes = [...issueUnion.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert(codes.length > 0, "No binding issue codes parsed");
  for (const code of codes) assertStringIncludes(guide, `\`${code}\``);
  for (const reason of PinReasonSchema.options) assertStringIncludes(guide, `\`${reason}\``);
});

Deno.test("flow binding guide uses the shipped binding directory names", async () => {
  const guide = await bindingGuide();
  for (const dir of [BINDING_OVERLAYS_DIR, RUN_BINDINGS_DIR, BINDINGS_DIR]) {
    assertStringIncludes(guide, `\`.exa/${dir}/\``);
  }
});

Deno.test("flow binding guide describes run-file activation, replay drift, lock fields and credential refresh", async () => {
  const guide = (await bindingGuide()).replace(/\s+/g, " ");
  for (
    const phrase of [
      "needs no other binding layer",
      "flow content, step pins, catalog and every resolved binding",
      "`env_ignored`",
      "`hosts`",
      "`binding.run.released`",
      "stored or rotated after the daemon started",
      "fails with `key_missing` before any call",
    ]
  ) assertStringIncludes(guide, phrase);
});

Deno.test("architecture describes pool holds, credential versions and replay comparison", async () => {
  const architecture = (await Deno.readTextFile("ARCHITECTURE.md")).replace(/\s+/g, " ");
  for (const phrase of ["`releaseRun`", "credential version", "`compareLock`", "per pooled provider"]) {
    assertStringIncludes(architecture, phrase);
  }
});

const BINDING_PROBE = { hasKey: (): boolean => true, hasOptIn: (): boolean => true };
const BINDING_REF: IBindingStepRef = {
  flowId: "example",
  stepId: "step",
  agentRole: "senior-coder",
  kind: "agent",
  nativeTools: true,
};

Deno.test("[phase203.docs] the vLLM and LiteLLM overlay examples parse and their bindings resolve", async () => {
  for (const [name, supportsToolChoice] of [["vllm", false], ["litellm", true]] as const) {
    const raw = await Deno.readTextFile(`configs/bindings/${name}.example.toml`);
    const overlay = BindingOverlaySchema.parse(parseToml(raw));

    assertEquals(overlay.schema, 1);
    const service = overlay.catalog?.services?.[name];
    assert(service !== undefined, `${name} example must declare its own service`);
    assertEquals(service.adapter, "openai-chat");
    assertEquals(service.profile, "self-hosted");
    assertEquals(service.supports_tool_choice, supportsToolChoice);
    assertEquals(service.transport, "local");

    const spec = overlay.bindings?.default;
    assert(spec !== undefined, `${name} example must declare a default binding`);
    assertEquals(spec.service, name);

    const layers: IBindingLayers = {
      entries: [{ layer: "config", selector: "default", spec }],
      catalog: mergeCatalogs(buildBuiltInCatalog(), overlay.catalog ?? {}),
      overlaySha256: [],
      operatorLayersPresent: false,
    };
    const outcome = resolveBinding(BINDING_REF, {}, layers, BINDING_PROBE);
    assertEquals(outcome.kind, "bound", `${name} example binding must resolve`);
  }
});
