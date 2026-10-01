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
  for (const phrase of ["`releaseRun`", "credential version", "`compareLock`", "`BoundedLruCache`"]) {
    assertStringIncludes(architecture, phrase);
  }
});
