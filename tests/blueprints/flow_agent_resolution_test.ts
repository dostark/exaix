/**
 * @module FlowAgentResolutionTest
 * @path tests/blueprints/flow_agent_resolution_test.ts
 * @description Verifies that all agents referenced in flow definitions correctly
 * resolve to valid system identities or project blueprints.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const BLUEPRINTS_DIR = "./Blueprints/Agents";
const FLOWS_DIR = "./Blueprints/Flows";

interface BlueprintFrontmatter {
  agent_role: string;
}

/**
 * Parse YAML frontmatter from a markdown file
 */
function parseFrontmatter(content: string): BlueprintFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYaml(match[1]) as BlueprintFrontmatter;
}

/**
 * Get all agent IDs from blueprints
 */
async function getAllAgentIds(): Promise<Set<string>> {
  const agentRoles = new Set<string>();

  const dirs = [BLUEPRINTS_DIR];

  for (const dir of dirs) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
          const content = await Deno.readTextFile(join(dir, entry.name));
          const frontmatter = parseFrontmatter(content);
          if (frontmatter?.agent_role) {
            agentRoles.add(frontmatter.agent_role);
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return agentRoles;
}

/**
 * Extract agent references from a flow file
 */
async function getFlowAgentRefs(flowPath: string): Promise<string[]> {
  const content = await Deno.readTextFile(flowPath);

  // Match agent_role: "agent-name" patterns
  const agentRefs: string[] = [];
  const regex = /agent_role:\s*["']([^"']+)["']/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    agentRefs.push(match[1]);
  }

  return agentRefs;
}

// Flow Agent Resolution Tests

// Catalog-wide Flow Tests: enumerate Blueprints/Flows/ rather than naming files one per
// Deno.test, so a renamed or newly added flow file is covered automatically.

/** Flows that have never declared `defaultSkills`. Listed rather than fixed because whether
 * every flow REQUIRES defaultSkills is unconfirmed; this list must shrink, never grow. */
const FLOWS_WITHOUT_DEFAULT_SKILLS = new Set(["analyze-codebase.flow.yaml", "api-documentation.flow.yaml"]);

Deno.test("Flow validation: no flow loses its defaultSkills", async () => {
  const missing: string[] = [];
  const staleExemptions: string[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    const content = await Deno.readTextFile(join(FLOWS_DIR, entry.name));
    const has = content.includes("defaultSkills:");
    if (!has && !FLOWS_WITHOUT_DEFAULT_SKILLS.has(entry.name)) missing.push(entry.name);
    if (has && FLOWS_WITHOUT_DEFAULT_SKILLS.has(entry.name)) staleExemptions.push(entry.name);
  }
  assertEquals(missing.sort(), [], `flow blueprints that lost defaultSkills: ${missing.join(", ")}`);
  assertEquals(
    staleExemptions.sort(),
    [],
    `these now declare defaultSkills — remove them from FLOWS_WITHOUT_DEFAULT_SKILLS: ${staleExemptions.join(", ")}`,
  );
});

// Comprehensive Agent Coverage Test

Deno.test("Flow validation: all flow-referenced agents exist", async () => {
  const agentRoles = await getAllAgentIds();

  const flowFiles = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".flow.yaml")) {
      flowFiles.push(join(FLOWS_DIR, entry.name));
    }
  }

  const missingAgents: { flow: string; agent_role: string }[] = [];

  for (const flowPath of flowFiles) {
    const flowAgents = await getFlowAgentRefs(flowPath);
    for (const agent of flowAgents) {
      if (!agentRoles.has(agent)) {
        missingAgents.push({ flow: flowPath, agent_role: agent });
      }
    }
  }

  assertEquals(
    missingAgents.length,
    0,
    `Missing agents: ${JSON.stringify(missingAgents, null, 2)}`,
  );
});
