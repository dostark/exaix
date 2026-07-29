/**
 * @module DogfoodIdentityDriftTest
 * @path packages/core/tests/blueprints/dogfood_identity_drift_test.ts
 * @description Phase 150 Step 4 — verifies every identity referenced in the
 *   meta-workflow queue (Exaix_Dogfooding_Analysis.md §7.5) resolves to a real
 *   Blueprints/Identities/*.md file. A dangling reference fails.
 */
import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { IBlueprintLoader } from "@exaix/core/blueprint";

const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const IDENTITIES_PATH = join(REPO_ROOT, "Blueprints", "Identities");

const META_WORKFLOW_IDENTITIES = [
  "code-analyst",
  "dogfood-coder",
  "code-reviewer",
];

Deno.test("[dogfood-identity-drift] every meta-workflow identity resolves through IBlueprintLoader", async () => {
  const loader = new IBlueprintLoader({ blueprintsPath: IDENTITIES_PATH });
  for (const id of META_WORKFLOW_IDENTITIES) {
    const blueprint = await loader.load(id);
    assertExists(blueprint, `meta-workflow identity '${id}' must resolve to a Blueprints/Identities/*.md file`);
    assertEquals(blueprint.identityId, id, `identity_id must match the requested identity name '${id}'`);
  }
});
