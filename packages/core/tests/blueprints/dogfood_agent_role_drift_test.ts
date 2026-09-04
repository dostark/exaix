/**
 * @module DogfoodAgentRoleDriftTest
 * @path packages/core/tests/blueprints/dogfood_agent_role_drift_test.ts
 * @description Phase 150 Step 4 / Step 16 — verifies every agent role referenced in the
 *   meta-workflow queue (Exaix_Dogfooding_Analysis.md §7.5) and in the meta-workflow flow
 *   blueprint resolves to a real Blueprints/Agents/*.md file. The reference list is
 *   EXTRACTED from those documents, not hardcoded — a hardcoded list cannot detect drift,
 *   which is the failure this test exists to prevent (GAP-K).
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { IBlueprintLoader } from "@exaix/core/blueprint";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const AGENTS_PATH = join(REPO_ROOT, "Blueprints", "Agents");
const ANALYSIS_DOC = join(REPO_ROOT, "exaix-dev-docs", "dev", "Exaix_Dogfooding_Analysis.md");
const FLOW_BLUEPRINT = join(REPO_ROOT, "Blueprints", "Flows", "dogfood-meta-workflow.flow.yaml");

/** The analysis doc lives in a submodule that may not be checked out. */
function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

const ANALYSIS_DOC_PRESENT = fileExists(ANALYSIS_DOC);

/** Slices a section by its heading through the next same-or-higher heading; returns "" when absent — callers must treat that as a failure, never an empty-and-passing set. */
function sliceSection(doc: string, sectionNumber: string): string {
  const escaped = sectionNumber.replace(".", "\\.");
  const start = doc.search(new RegExp(`^#{2,4}\\s+${escaped}\\s`, "m"));
  if (start < 0) return "";
  // Search for the terminating heading from AFTER this section's own heading line —
  // otherwise the heading terminates its own section and the slice is one character long.
  const headingEnd = doc.indexOf("\n", start);
  if (headingEnd < 0) return doc.slice(start);
  const next = doc.slice(headingEnd).search(/^#{2,3}\s+\d/m);
  return next < 0 ? doc.slice(start) : doc.slice(start, headingEnd + next);
}

/** Extract every `identity:`/`identity_id:`/`agent_role:` reference, tolerating quotes and backticks. */
function extractAgentRoleRefs(text: string): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(/(?:identity(?:_id)?|agent_role):\s*["'`]?([a-z][a-z0-9-]*)["'`]?/g)) {
    refs.add(match[1]);
  }
  return refs;
}

Deno.test({
  name: "[dogfood-agent-role-drift] every agent role referenced in Analysis §7.5 resolves",
  ignore: !ANALYSIS_DOC_PRESENT,
  fn: async () => {
    const doc = Deno.readTextFileSync(ANALYSIS_DOC);
    const section = sliceSection(doc, "7.5");
    assert(
      section.length > 0,
      "§7.5 not found in Exaix_Dogfooding_Analysis.md — the section was renamed or removed, " +
        "so this drift test is no longer reading what it claims to read",
    );

    const refs = extractAgentRoleRefs(section);
    assert(
      refs.size > 0,
      "extracted zero agent role references from §7.5 — an empty extraction must fail, not pass vacuously",
    );

    const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
    for (const id of refs) {
      const blueprint = await loader.load(id);
      assertExists(
        blueprint,
        `§7.5 references agent role '${id}', which has no Blueprints/Agents/${id}.md`,
      );
      assertEquals(blueprint.agentRole, id, `agent_role must match the referenced name '${id}'`);
    }
  },
});

Deno.test("[dogfood-agent-role-drift] every agent role in the meta-workflow flow blueprint resolves", async () => {
  const flow = Deno.readTextFileSync(FLOW_BLUEPRINT);
  const refs = extractAgentRoleRefs(flow);
  assert(refs.size > 0, `extracted zero agent role references from ${FLOW_BLUEPRINT}`);

  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  for (const id of refs) {
    const blueprint = await loader.load(id);
    assertExists(
      blueprint,
      `dogfood-meta-workflow.flow.yaml references agent role '${id}', which has no blueprint`,
    );
  }
});

Deno.test("[dogfood-agent-role-drift] an unresolvable agent role reference fails", async () => {
  const synthetic = "### 7.5 What's missing\n\n| step | `agent_role: no-such-identity` |\n";
  const section = sliceSection(synthetic, "7.5");
  const refs = extractAgentRoleRefs(section);
  assertEquals([...refs], ["no-such-identity"], "extraction must find the dangling reference");

  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("no-such-identity");
  assertEquals(blueprint, null, "a dangling agent role reference must not resolve");
});

Deno.test("[dogfood-agent-role-drift] a missing or renamed §7.5 yields an empty slice", () => {
  assertEquals(sliceSection("# Doc\n\n### 7.4 Something\n\ntext\n", "7.5"), "");
  assertEquals(extractAgentRoleRefs("").size, 0);
});
