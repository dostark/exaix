/**
 * @module DogfoodIdentityCodeReviewerStructureTest
 * @path packages/core/tests/blueprints/dogfood_identity_code_reviewer_structure_test.ts
 * @description Phase 150 Step 4 — verifies the code-reviewer identity permits no
 *   write tools, carries review default_skills, and has no HITL requirement.
 */
import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { IBlueprintLoader } from "@exaix/core/blueprint";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const AGENTS_PATH = join(REPO_ROOT, "Blueprints", "Agents");

const READ_ONLY_TOOLS = [
  "read_file",
  "list_directory",
  "search_files",
  "git_status",
  "git_log",
];

const WRITE_TOOLS = [
  "write_file",
  "patch_file",
  "run_command",
  "create_directory",
  "delete_file",
  "move_file",
  "git_create_branch",
  "git_commit",
  "git_worktree",
];

const REQUIRED_SKILLS = [
  "code-review",
  "security-first",
  "exaix-conventions",
];

Deno.test("[dogfood-identity-reviewer] code-reviewer loads successfully", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("code-reviewer");
  assertExists(blueprint);
  assertEquals(blueprint.identityId, "code-reviewer");
});

Deno.test("[dogfood-identity-reviewer] code-reviewer carries review default_skills", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("code-reviewer");
  assertExists(blueprint);
  const skills = blueprint.frontmatter.default_skills ?? [];
  const missing = REQUIRED_SKILLS.filter((skill) => !skills.includes(skill));
  assertEquals(missing, [], `code-reviewer missing required default_skills: ${missing.join(", ")}`);
});

Deno.test("[dogfood-identity-reviewer] code-reviewer has no write tools in permitted_tools", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("code-reviewer");
  assertExists(blueprint);
  const tools = (blueprint.frontmatter.permitted_tools ?? []) as string[];
  const writeToolsPresent = WRITE_TOOLS.filter((tool) => tools.includes(tool));
  assertEquals(writeToolsPresent, [], `code-reviewer must not permit write tools: ${writeToolsPresent.join(", ")}`);
});

Deno.test("[dogfood-identity-reviewer] code-reviewer has all read-only tools", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("code-reviewer");
  assertExists(blueprint);
  const tools = (blueprint.frontmatter.permitted_tools ?? []) as string[];
  const missing = READ_ONLY_TOOLS.filter((tool) => !tools.includes(tool));
  assertEquals(missing, [], `code-reviewer missing read-only tools: ${missing.join(", ")}`);
});

Deno.test("[dogfood-identity-reviewer] code-reviewer has no HITL requirement", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("code-reviewer");
  assertExists(blueprint);
  assertEquals(blueprint.frontmatter.hitl, undefined, "code-reviewer must not have a hitl section");
});

Deno.test("[dogfood-identity-reviewer] code-reviewer has no session_delegate", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: AGENTS_PATH });
  const blueprint = await loader.load("code-reviewer");
  assertExists(blueprint);
  assertEquals(
    blueprint.frontmatter.session_delegate,
    undefined,
    "code-reviewer must not have a session_delegate section",
  );
});
