/**
 * @module FlowIdentityReferenceLintTest
 * @path tests/eval/flow_identity_reference_lint_test.ts
 * @description Asserts every identity: reference in every Blueprints/Flows/*.flow.yaml
 *   resolves against Blueprints/Identities/.
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { resolve } from "@std/path";

const FLOWS_DIR = resolve(Deno.cwd(), "Blueprints", "Flows");
const IDENTITIES_DIR = resolve(Deno.cwd(), "Blueprints", "Identities");

function loadIdentityNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of Deno.readDirSync(IDENTITIES_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
      names.add(entry.name.replace(/\.md$/, ""));
    }
  }
  return names;
}

function extractIdentityRefs(content: string): string[] {
  const refs: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s+identity:\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/);
    if (match) {
      refs.push(match[1]);
    }
  }
  return refs;
}

Deno.test("flow_identity_reference_lint — all flow-step identities resolve", async () => {
  const knownIdentities = loadIdentityNames();

  const failures: string[] = [];
  for await (const entry of walk(FLOWS_DIR, { includeDirs: false })) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;

    const content = await Deno.readTextFile(entry.path);
    const refs = extractIdentityRefs(content);

    for (const ref of refs) {
      if (!knownIdentities.has(ref)) {
        failures.push(`${entry.name}: references unknown identity "${ref}"`);
      }
    }
  }

  assertEquals(failures, [], `Identity reference failures:\n  ${failures.join("\n  ")}`);
});
