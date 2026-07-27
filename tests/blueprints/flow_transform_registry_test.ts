/**
 * @module FlowTransformRegistryTest
 * @path tests/blueprints/flow_transform_registry_test.ts
 * @description Phase 142 Step 13 — every `transform:` a flow blueprint names must exist in
 *   StepOutputFormatter's registry.
 *
 *   `applyTransform` throws `Unknown transform: <name>` for anything it does not implement, so
 *   a step naming a transform that was never written fails at runtime and takes its dependents
 *   with it — a conditional final step guarded by `results.every(r => r.status === "success")`
 *   is then skipped, the flow aggregates nothing, and the request dies on
 *   `Invalid JSON: Unexpected end of JSON input` several layers from the cause.
 *
 *   Five flows referenced fifteen invented names — `extract-security-focus`,
 *   `combine-reviews`, `analyze-architecture` and the like — none of which the registry has.
 *   It went unnoticed because flows had never executed: Step 13 found the request pipeline
 *   rejected every flow request long before any transform ran.
 * @architectural-layer Test
 * @related-files [packages/flow/src/step_output_formatter.ts, packages/flow/src/flow_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FLOWS_DIR = join(REPO_ROOT, "Blueprints", "Flows");
const FORMATTER = join(REPO_ROOT, "packages", "flow", "src", "step_output_formatter.ts");

/** Read the registry's keys from source, so the test cannot drift from the implementation. */
async function readImplementedTransforms(): Promise<Set<string>> {
  const source = await Deno.readTextFile(FORMATTER);
  const block = source.match(/const BUILT_IN_TRANSFORM_HANDLERS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("BUILT_IN_TRANSFORM_HANDLERS not found — update this test's reader");
  return new Set([...block[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]));
}

interface ITransformRef {
  flow: string;
  transform: string;
}

async function readReferencedTransforms(): Promise<ITransformRef[]> {
  const refs: ITransformRef[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    const text = await Deno.readTextFile(join(FLOWS_DIR, entry.name));
    for (const match of text.matchAll(/^\s*transform:\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/gm)) {
      refs.push({ flow: entry.name.replace(/\.flow\.yaml$/, ""), transform: match[1] });
    }
  }
  return refs;
}

Deno.test("[flow-transforms] every transform a flow names is implemented", async () => {
  const implemented = await readImplementedTransforms();
  const unknown = (await readReferencedTransforms())
    .filter((ref) => !implemented.has(ref.transform))
    .map((ref) => `${ref.flow}: ${ref.transform}`)
    .sort();

  assertEquals(
    [...new Set(unknown)],
    [],
    `applyTransform throws "Unknown transform" for each of these, failing the step and every ` +
      `step that depends on it:\n${[...new Set(unknown)].join("\n")}\n\n` +
      `Implemented: ${[...implemented].sort().join(", ")}`,
  );
});

Deno.test("[flow-transforms] the registry reader still finds the registry", async () => {
  // Guards the test itself: if BUILT_IN_TRANSFORM_HANDLERS is renamed or restructured, the
  // reader above would silently return an empty set and the test would pass by reporting
  // every transform as unknown — or, worse, a future reader bug could make it pass vacuously.
  const implemented = await readImplementedTransforms();
  assertEquals(implemented.has("passthrough"), true, "expected the known-good transform to be found");
  assertEquals(implemented.has("mergeAsContext"), true);
});
