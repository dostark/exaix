/**
 * @module FlowAgentResolutionTest
 * @path tests/blueprints/flow_agent_resolution_test.ts
 * @description Verifies that all agents referenced in flow definitions correctly
 * resolve to valid system agent roles or project blueprints.
 */

import { DEFAULT_AGENTS_PATH, DEFAULT_BLUEPRINTS_PATH, DEFAULT_FLOWS_DIR } from "@exaix/shared";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { FlowLoader } from "@exaix/flow";

const BLUEPRINTS_DIR = `./${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_AGENTS_PATH}`;
const FLOWS_DIR = `./${DEFAULT_FLOWS_DIR}`;

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

/** Flows that declare no skill at all. A flow may declare skills for every step
 *  (`defaultSkills`) or per step (`skills`). This list may only shrink, never grow. */
const FLOWS_WITHOUT_SKILLS = new Set(["api-documentation.flow.yaml"]);

Deno.test("fix(blueprints): architecture decisions load the shipped architecture review skill", async () => {
  const flow = await new FlowLoader(FLOWS_DIR).loadFlow("architecture-decision");
  assertEquals(flow.defaultSkills, ["architecture-review"]);
});

Deno.test("Flow validation: no flow loses its declared skills", async () => {
  const missing: string[] = [];
  const staleExemptions: string[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    const content = await Deno.readTextFile(join(FLOWS_DIR, entry.name));
    // A flow may declare skills for every step or per step. Both satisfy the contract.
    const has = /^\s*(?:defaultSkills|skills):/m.test(content);
    if (!has && !FLOWS_WITHOUT_SKILLS.has(entry.name)) missing.push(entry.name);
    if (has && FLOWS_WITHOUT_SKILLS.has(entry.name)) staleExemptions.push(entry.name);
  }
  assertEquals(missing.sort(), [], `flow blueprints that declare no skills: ${missing.join(", ")}`);
  assertEquals(
    staleExemptions.sort(),
    [],
    `these now declare skills — remove them from FLOWS_WITHOUT_SKILLS: ${staleExemptions.join(", ")}`,
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
