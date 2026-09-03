/**
 * @module DogfoodIdentityDefaultSkillsTest
 * @path packages/core/tests/blueprints/dogfood_identity_default_skills_test.ts
 * @description Phase 150 Step 4 — verifies the dogfood-coder identity carries the
 *   rigor default_skills the meta-workflow relies on.
 */
import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { IBlueprintLoader } from "@exaix/core/blueprint";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const IDENTITIES_PATH = join(REPO_ROOT, "Blueprints", "Agents");

const DOGFOOD_CODER_REQUIRED_SKILLS = [
  "response-contract",
  "exaix-conventions",
  "tdd-methodology",
];

Deno.test("[dogfood-identity-skills] dogfood-coder carries the skills its role requires", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  const blueprint = await loader.load("dogfood-coder");

  assertExists(blueprint);
  const skills = blueprint.frontmatter.default_skills ?? [];

  const missing = DOGFOOD_CODER_REQUIRED_SKILLS.filter((skill) => !skills.includes(skill));
  assertEquals(missing, [], `dogfood-coder is missing role-required default_skills: ${missing.join(", ")}`);
});
