/**
 * @module ScenarioCatalogDockerTagExcludedTest
 * @path tests/scenario_framework/tests/unit/scenario_catalog_docker_tag_excluded_test.ts
 * @description RED-first test, Phase 144 post-gap remediation (GAP-6 / Step 12). The plan's own
 *   Codebase Grounding Summary claimed `docker`-tagged scenarios are excluded from CI via
 *   `CI_EXCLUDED_TAGS`, but the array only ever held `["manual-only", "provider-live", "live"]` —
 *   the claim was only INCIDENTALLY true because every `external_bench_task`-rendered scenario
 *   also happens to carry `provider-live`. A scenario tagged `docker` alone (no `provider-live`)
 *   was never actually excluded. This proves the real mechanism directly against an on-disk
 *   catalog, not the incidental co-occurrence.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_catalog.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CI_EXCLUDED_TAGS, listCiSafeScenarios, loadScenarioCatalog } from "../../runner/scenario_catalog.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";

function scenarioYaml(id: string, tags: string[], requestFixturePath: string): string {
  return [
    `schema_version: "${SCHEMA_VERSION}"`,
    `id: "${id}"`,
    `title: "${id}"`,
    `pack: "docker-tag-probe"`,
    `tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
    `request_fixture: "${requestFixturePath}"`,
    `mode_support: ["auto"]`,
    "portals: []",
    "steps:",
    '  - id: "only-step"',
    '    type: "shell"',
    '    command: "echo"',
    '    args: ["ok"]',
    "    input_criteria: []",
    "    output_criteria: []",
    "",
  ].join("\n");
}

async function withCatalogFixture(
  fn: (frameworkHome: string) => Promise<void>,
): Promise<void> {
  const frameworkHome = await Deno.makeTempDir({ prefix: "scenario-framework-docker-tag-" });
  try {
    const fixtureRelativePath = "fixtures/requests/shared/request.md";
    await Deno.mkdir(join(frameworkHome, "fixtures/requests/shared"), { recursive: true });
    await Deno.writeTextFile(join(frameworkHome, fixtureRelativePath), "# Request\n\nDo it.\n");

    await Deno.mkdir(join(frameworkHome, "scenarios"), { recursive: true });
    await Deno.writeTextFile(
      join(frameworkHome, "scenarios", "docker-only.yaml"),
      scenarioYaml("docker-only", ["docker"], fixtureRelativePath),
    );
    await Deno.writeTextFile(
      join(frameworkHome, "scenarios", "provider-live-only.yaml"),
      scenarioYaml("provider-live-only", ["provider-live"], fixtureRelativePath),
    );
    await Deno.writeTextFile(
      join(frameworkHome, "scenarios", "plain.yaml"),
      scenarioYaml("plain", ["smoke"], fixtureRelativePath),
    );

    await fn(frameworkHome);
  } finally {
    await Deno.remove(frameworkHome, { recursive: true });
  }
}

Deno.test("[ScenarioCatalogDockerTagExcluded] CI_EXCLUDED_TAGS contains docker directly, not merely incidentally via provider-live co-occurrence", () => {
  assertEquals(
    (CI_EXCLUDED_TAGS as readonly string[]).includes("docker"),
    true,
    "docker must be its own CI_EXCLUDED_TAGS entry (GAP-6) — a docker-tagged scenario without " +
      "provider-live must still be excluded from CI",
  );
});

Deno.test("[ScenarioCatalogDockerTagExcluded] a scenario tagged docker alone (no provider-live) is excluded from loadScenarioCatalog's default CI-safe result", async () => {
  await withCatalogFixture(async (frameworkHome) => {
    const catalog = await loadScenarioCatalog({ frameworkHome });
    const ciSafeIds = listCiSafeScenarios(catalog).map((scenario) => scenario.id).sort();

    assertEquals(
      ciSafeIds,
      ["plain"],
      "only the untagged (plain) scenario may run in the default CI-safe set — both docker-only " +
        "and provider-live-only must be excluded",
    );
  });
});
