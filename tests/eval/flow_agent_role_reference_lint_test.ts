/**
 * @module FlowAgentRoleReferenceLintTest
 * @path tests/eval/flow_agent_role_reference_lint_test.ts
 * @description Asserts every agent_role: reference in every Blueprints/Flows/*.flow.yaml
 *   resolves against Blueprints/Agents/.
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { resolve } from "@std/path";

const FLOWS_DIR = resolve(Deno.cwd(), "Blueprints", "Flows");
const AGENTS_DIR = resolve(Deno.cwd(), "Blueprints", "Agents");

function loadAgentRoleNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of Deno.readDirSync(AGENTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
      names.add(entry.name.replace(/\.md$/, ""));
    }
  }
  return names;
}

function extractAgentRoleRefs(content: string): string[] {
  const refs: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s+agent_role:\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/);
    if (match) {
      refs.push(match[1]);
    }
  }
  return refs;
}

Deno.test("flow_agent_role_reference_lint — all flow-step agent roles resolve", async () => {
  const knownAgentRoles = loadAgentRoleNames();

  const failures: string[] = [];
  for await (const entry of walk(FLOWS_DIR, { includeDirs: false })) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;

    const content = await Deno.readTextFile(entry.path);
    const refs = extractAgentRoleRefs(content);

    for (const ref of refs) {
      if (!knownAgentRoles.has(ref)) {
        failures.push(`${entry.name}: references unknown agent role "${ref}"`);
      }
    }
  }

  assertEquals(failures, [], `Agent role reference failures:\n  ${failures.join("\n  ")}`);
});
