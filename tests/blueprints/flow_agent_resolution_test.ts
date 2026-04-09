/**
 * @module FlowAgentResolutionTest
 * @path tests/blueprints/flow_agent_resolution_test.ts
 * @description Verifies that all agents referenced in flow definitions correctly
 * resolve to valid system identities or project blueprints.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

const BLUEPRINTS_DIR = "./Blueprints/Identities";
const EXAMPLES_DIR = "./Blueprints/Identities/examples";
const FLOWS_DIR = "./Blueprints/Flows";

interface BlueprintFrontmatter {
  identity_id: string;
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
  const identityIds = new Set<string>();

  const dirs = [BLUEPRINTS_DIR, EXAMPLES_DIR];

  for (const dir of dirs) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
          const content = await Deno.readTextFile(join(dir, entry.name));
          const frontmatter = parseFrontmatter(content);
          if (frontmatter?.identity_id) {
            identityIds.add(frontmatter.identity_id);
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return identityIds;
}

/**
 * Extract agent references from a flow file
 */
async function getFlowAgentRefs(flowPath: string): Promise<string[]> {
  const content = await Deno.readTextFile(flowPath);

  // Match identity: "agent-name" patterns
  const agentRefs: string[] = [];
  const regex = /identity:\s*["']([^"']+)["']/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    agentRefs.push(match[1]);
  }

  return agentRefs;
}

// ============================================================================
// Flow Agent Resolution Tests
// ============================================================================

Deno.test("Flow validation: code_review.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "code_review.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `code_review.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: feature_development.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "feature_development.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `feature_development.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: documentation.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "documentation.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `documentation.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: bug_investigation.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "bug_investigation.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `bug_investigation.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: refactoring.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "refactoring.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `refactoring.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: security_audit.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "security_audit.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `security_audit.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: api_design.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "api_design.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `api_design.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: test_generation.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "test_generation.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `test_generation.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: pr_review.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "pr_review.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `pr_review.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: migration_planning.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "migration_planning.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `migration_planning.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

Deno.test("Flow validation: onboarding_docs.flow.yaml resolves all agents", async () => {
  const identityIds = await getAllAgentIds();
  const flowPath = join(FLOWS_DIR, "onboarding_docs.flow.yaml");
  const flowAgents = await getFlowAgentRefs(flowPath);

  for (const agent of flowAgents) {
    assertEquals(
      identityIds.has(agent),
      true,
      `onboarding_docs.flow.yaml references "${agent}" but no blueprint exists`,
    );
  }
});

// ============================================================================
// Flow defaultSkills Tests
// ============================================================================

Deno.test("Flow validation: code_review.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "code_review.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "code_review.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: feature_development.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "feature_development.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "feature_development.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: documentation.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "documentation.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "documentation.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: bug_investigation.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "bug_investigation.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "bug_investigation.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: refactoring.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "refactoring.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "refactoring.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: security_audit.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "security_audit.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "security_audit.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: api_design.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "api_design.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "api_design.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: test_generation.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "test_generation.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "test_generation.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: pr_review.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "pr_review.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "pr_review.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: migration_planning.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "migration_planning.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "migration_planning.flow.yaml should have defaultSkills defined",
  );
});

Deno.test("Flow validation: onboarding_docs.flow.yaml has defaultSkills", async () => {
  const flowPath = join(FLOWS_DIR, "onboarding_docs.flow.yaml");
  const content = await Deno.readTextFile(flowPath);

  const hasDefaultSkills = content.includes("defaultSkills:");
  assertEquals(
    hasDefaultSkills,
    true,
    "onboarding_docs.flow.yaml should have defaultSkills defined",
  );
});

// ============================================================================
// Comprehensive Agent Coverage Test
// ============================================================================

Deno.test("Flow validation: all flow-referenced agents exist", async () => {
  const identityIds = await getAllAgentIds();

  const flowFiles = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".flow.yaml")) {
      flowFiles.push(join(FLOWS_DIR, entry.name));
    }
  }

  const missingAgents: { flow: string; identity: string }[] = [];

  for (const flowPath of flowFiles) {
    const flowAgents = await getFlowAgentRefs(flowPath);
    for (const agent of flowAgents) {
      if (!identityIds.has(agent)) {
        missingAgents.push({ flow: flowPath, identity: agent });
      }
    }
  }

  assertEquals(
    missingAgents.length,
    0,
    `Missing agents: ${JSON.stringify(missingAgents, null, 2)}`,
  );
});
