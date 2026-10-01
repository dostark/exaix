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
import { ConfigSchema, PinReasonSchema } from "@exaix/schemas";
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
