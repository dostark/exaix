/**
 * @module BlueprintResolverTest
 * @path packages/request/tests/blueprint_resolver_test.ts
 * @architectural-layer Services
 * @description Verifies BlueprintResolver resolves an identity's blueprint from
 * the configured blueprintsPath, falling back to a Blueprints/Identities
 * directory walked upward from the current working directory when the primary
 * path has no match. Direct unit coverage for the extracted resolver (god-object
 * decomposition of RequestProcessor).
 * @related-files [packages/request/src/blueprint_resolver.ts, packages/request/src/processor.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { BlueprintResolver } from "@exaix/request";
import { createMockEventLogger } from "@exaix/testing";

const SAMPLE_BLUEPRINT = await Deno.readTextFile(
  new URL("./fixtures/sample_blueprint.yaml", import.meta.url),
);

async function makeBlueprintsDir(): Promise<{ testDir: string; blueprintsPath: string }> {
  const testDir = await Deno.makeTempDir({ prefix: "exa_blueprint_resolver_test_" });
  const blueprintsPath = join(testDir, "Blueprints", "Identities");
  await Deno.mkdir(blueprintsPath, { recursive: true });
  return { testDir, blueprintsPath };
}

Deno.test("[BlueprintResolver.resolve] loads blueprint directly from configured blueprintsPath", async () => {
  const { testDir, blueprintsPath } = await makeBlueprintsDir();
  const mockLogger = createMockEventLogger();
  try {
    await Deno.writeTextFile(join(blueprintsPath, "test-agent.md"), SAMPLE_BLUEPRINT);
    const resolver = new BlueprintResolver({ blueprintsPath });

    const loaded = await resolver.resolve("test-agent", mockLogger);

    assertExists(loaded);
    assertEquals(loaded.identityId, "test-agent");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[BlueprintResolver.resolve] returns null when identity is not found anywhere", async () => {
  const { testDir, blueprintsPath } = await makeBlueprintsDir();
  const mockLogger = createMockEventLogger();
  try {
    const resolver = new BlueprintResolver({ blueprintsPath });

    const loaded = await resolver.resolve("nonexistent-agent", mockLogger);

    assertEquals(loaded, null);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[BlueprintResolver.resolve] falls back to the repo-root Blueprints/Identities when cwd is outside the repo (e.g. a sandbox)", async () => {
  const { testDir, blueprintsPath } = await makeBlueprintsDir();
  const mockLogger = createMockEventLogger();
  const originalCwd = Deno.cwd();
  // A sibling-of-repo directory (like the scenario framework's auto-deployed
  // sandboxes under <parent-of-repo>/exaix-sandboxes/<run-id>/) has no
  // Blueprints/ in any cwd-upward-walk ancestor, so only the module-relative
  // fallback in findInRepoRoots can locate the repo's real "default" identity.
  const outsideRepoDir = await Deno.makeTempDir({ prefix: "exa_blueprint_resolver_outside_repo_" });
  try {
    Deno.chdir(outsideRepoDir);
    const resolver = new BlueprintResolver({ blueprintsPath });

    const loaded = await resolver.resolve("default", mockLogger);

    assertExists(loaded);
    assertEquals(loaded.identityId, "default");
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(testDir, { recursive: true });
    await Deno.remove(outsideRepoDir, { recursive: true });
  }
});
