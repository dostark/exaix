/**
 * @module GoPortCoreL1LoaderReferenceTest
 * @path tests/scripts/go_port_core_l1_loader_reference_test.ts
 * @description Exercises the recorder of the pinned blueprint and context loads. The Go checkout verifies the committed cases itself.
 * @architectural-layer Test
 */
import { assert, assertArrayIncludes, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  BLUEPRINT_SPECS,
  CONTEXT_SPECS,
  type IBlueprintSpec,
  recordBlueprintCases,
  recordContextCases,
  type TBlueprintRunner,
} from "../../scripts/go_port/core_l1_loader_reference.ts";
import { fakeBlueprintRunner, fakeContextRunner } from "./helpers/go_port_core_l1_loader_fake.ts";

const ROLE_PATTERN = /^[a-z0-9-]+$/;

Deno.test("go-port-core-l1-loader: blueprint cases cover every format the pinned loader distinguishes", () => {
  const ids = BLUEPRINT_SPECS.map((spec) => spec.id);
  assertEquals(new Set(ids).size, ids.length);
  for (
    const required of [
      "blueprint-yaml-optional",
      "blueprint-yaml-explicit",
      "blueprint-plain-markdown",
      "blueprint-retired-toml",
      "blueprint-missing-role",
      "blueprint-crlf-is-plain",
      "blueprint-empty-frontmatter",
    ]
  ) {
    assertArrayIncludes(ids, [required]);
  }
  assert(BLUEPRINT_SPECS.some((spec) => spec.default_model !== null), "a configured default model");
  assert(BLUEPRINT_SPECS.every((spec) => ROLE_PATTERN.test(spec.role)), "every role is a safe file name");
});

Deno.test("go-port-core-l1-loader: context cases cover every strategy, the local agent and the unicode estimate", () => {
  const strategies = new Set(CONTEXT_SPECS.map((spec) => spec.config.truncation_strategy));
  assertEquals([...strategies].sort(), ["drop-largest", "drop-oldest", "smallest-first", "truncate-each"]);
  assert(CONTEXT_SPECS.some((spec) => spec.config.is_local_agent));
  assert(CONTEXT_SPECS.some((spec) => spec.config.per_file_token_cap !== null));
  assert(CONTEXT_SPECS.some((spec) => spec.requested.some((path) => !spec.files.some((file) => file.path === path))));
  assert(CONTEXT_SPECS.some((spec) => spec.files.some((file) => file.content === "")));
  assert(CONTEXT_SPECS.some((spec) => spec.files.some((file) => file.content.includes("😀"))));
  for (const spec of CONTEXT_SPECS) {
    for (const file of spec.files) assert(!file.path.includes("/") && !file.path.startsWith("."), file.path);
  }
});

Deno.test("go-port-core-l1-loader: the recorded input keeps the authored file bytes exactly", async () => {
  const cases = await recordBlueprintCases("snapshot", fakeBlueprintRunner);
  assertEquals(cases.map((entry) => entry.id), BLUEPRINT_SPECS.map((spec) => spec.id));
  for (const [index, entry] of cases.entries()) {
    const input: IBlueprintSpec = JSON.parse(entry.input);
    assertEquals(input, BLUEPRINT_SPECS[index]);
  }
  const crlf = cases.find((entry) => entry.id === "blueprint-crlf-is-plain");
  assertStringIncludes(JSON.parse(crlf?.input ?? "{}").content, "\r\n");
});

Deno.test("go-port-core-l1-loader: the context cases keep their configuration and requested paths", async () => {
  const cases = await recordContextCases("snapshot", fakeContextRunner);
  assertEquals(cases.map((entry) => entry.id), CONTEXT_SPECS.map((spec) => spec.id));
  assertEquals(JSON.parse(cases[0].input), CONTEXT_SPECS[0]);
});

Deno.test("go-port-core-l1-loader: a runner that returns another number of observations is rejected", async () => {
  const short: TBlueprintRunner = async (snapshot, specs) => (await fakeBlueprintRunner(snapshot, specs)).slice(1);
  await assertRejects(() => recordBlueprintCases("snapshot", short), Error, "observations");
});

Deno.test("go-port-core-l1-loader: the same run produces the same bytes", async () => {
  assertEquals(
    await recordBlueprintCases("snapshot", fakeBlueprintRunner),
    await recordBlueprintCases("snapshot", fakeBlueprintRunner),
  );
});
