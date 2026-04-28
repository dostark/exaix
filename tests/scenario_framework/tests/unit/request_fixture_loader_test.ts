/**
 * @module ScenarioFrameworkRequestFixtureLoaderTest
 * @path tests/scenario_framework/tests/unit/request_fixture_loader_test.ts
 * @description RED-first tests for Step 2. Verifies request fixture
 * loading, fixture format enforcement, and fixture-only scenario validation
 * before the request fixture loader implementation exists.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/request_fixtures.ts, tests/scenario_framework/schema/scenario_schema.ts]
 */

import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { assertStringIncludes, assertThrows } from "@std/assert";
import { ensureScenarioUsesFixtureOnly, loadRequestFixture } from "../../runner/request_fixtures.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import type { JSONValue } from "@exaix/core/types/json.ts";

interface IScenarioPortalShape extends Record<string, JSONValue> {
  alias: string;
  source_path: string;
}

interface IScenarioCriterionShape extends Record<string, JSONValue> {
  id: string;
  kind: string;
  path?: string;
  path_pattern?: string;
  alias?: string;
  equals?: number;
}

interface IScenarioStepShape extends Record<string, JSONValue> {
  id: string;
  type: string;
  command: string;
  input_criteria: IScenarioCriterionShape[];
  output_criteria: IScenarioCriterionShape[];
}

interface IScenarioDocumentShape extends Record<string, JSONValue> {
  schema_version: string;
  id: string;
  title: string;
  pack: string;
  tags: string[];
  request_fixture: string;
  mode_support: string[];
  portals: IScenarioPortalShape[];
  steps: IScenarioStepShape[];
  request_body?: string;
}

function createValidScenarioDocument(requestFixturePath: string): IScenarioDocumentShape {
  return {
    schema_version: SCHEMA_VERSION,
    id: "step2-fixture-only",
    title: "Fixture-only validation",
    pack: "smoke",
    tags: ["smoke", "fixtures"],
    request_fixture: requestFixturePath,
    mode_support: ["auto"],
    portals: [],
    steps: [
      {
        id: "step-1",
        type: "shell",
        command: "echo ok",
        input_criteria: [],
        output_criteria: [],
      },
    ],
  };
}

Deno.test("[ScenarioFrameworkRequestFixtures] resolves valid text fixtures from framework-relative paths", async () => {
  const frameworkHome = await Deno.makeTempDir({ prefix: "scenario-framework-" });

  try {
    const fixtureRelativePath = "fixtures/requests/shared/request.md";
    const fixtureAbsolutePath = `${frameworkHome}/${fixtureRelativePath}`;

    await Deno.mkdir(`${frameworkHome}/fixtures/requests/shared`, { recursive: true });
    await Deno.writeTextFile(fixtureAbsolutePath, "# Request\n\nValidate fixture loading.\n");

    const fixture = await loadRequestFixture({
      frameworkHome,
      requestFixturePath: fixtureRelativePath,
    });

    assertStrictEquals(fixture.relativePath, fixtureRelativePath);
    assertStrictEquals(fixture.absolutePath, fixtureAbsolutePath);
    assertStringIncludes(fixture.content, "Validate fixture loading");
  } finally {
    await Deno.remove(frameworkHome, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkRequestFixtures] rejects missing, empty, or unsupported request files", async () => {
  const frameworkHome = await Deno.makeTempDir({ prefix: "scenario-framework-" });

  try {
    await Deno.mkdir(`${frameworkHome}/fixtures/requests/shared`, { recursive: true });
    await Deno.writeTextFile(`${frameworkHome}/fixtures/requests/shared/empty.md`, "   \n\n  ");
    await Deno.writeTextFile(`${frameworkHome}/fixtures/requests/shared/request.json`, '{"request":"bad"}');

    await assertRejects(
      async () => {
        await loadRequestFixture({
          frameworkHome,
          requestFixturePath: "fixtures/requests/shared/missing.md",
        });
      },
      Error,
      "not found",
    );

    await assertRejects(
      async () => {
        await loadRequestFixture({
          frameworkHome,
          requestFixturePath: "fixtures/requests/shared/empty.md",
        });
      },
      Error,
      "empty",
    );

    await assertRejects(
      async () => {
        await loadRequestFixture({
          frameworkHome,
          requestFixturePath: "fixtures/requests/shared/request.json",
        });
      },
      Error,
      "unsupported",
    );
  } finally {
    await Deno.remove(frameworkHome, { recursive: true });
  }
});

Deno.test("[ScenarioFrameworkRequestFixtures] rejects embedded prompt bodies when fixture-only mode is enabled", () => {
  const rawScenario = {
    ...createValidScenarioDocument("fixtures/requests/shared/request.md"),
    request_body: "Do not allow prompt bodies inline in scenario metadata.",
  };

  const error = assertThrows(() => {
    ensureScenarioUsesFixtureOnly(rawScenario as JSONValue);
  }, Error);

  assertStringIncludes(error.message, "embedded request content");
});

Deno.test("[ScenarioFrameworkRequestFixtures] shared fixtures can be referenced by multiple scenarios without mutation", async () => {
  const frameworkHome = await Deno.makeTempDir({ prefix: "scenario-framework-" });

  try {
    const fixtureRelativePath = "fixtures/requests/shared/reusable.md";
    const fixtureAbsolutePath = `${frameworkHome}/${fixtureRelativePath}`;

    await Deno.mkdir(`${frameworkHome}/fixtures/requests/shared`, { recursive: true });
    await Deno.writeTextFile(fixtureAbsolutePath, "# Shared Request\n\nThis content should remain stable.\n");

    const scenarioA = ensureScenarioUsesFixtureOnly(createValidScenarioDocument(fixtureRelativePath) as JSONValue);
    const scenarioB = ensureScenarioUsesFixtureOnly({
      ...createValidScenarioDocument(fixtureRelativePath),
      id: "step2-fixture-only-b",
      title: "Fixture-only validation B",
    } as JSONValue);

    const fixtureA = await loadRequestFixture({
      frameworkHome,
      requestFixturePath: scenarioA.request_fixture,
    });
    const fixtureB = await loadRequestFixture({
      frameworkHome,
      requestFixturePath: scenarioB.request_fixture,
    });

    assertEquals(fixtureA.content, fixtureB.content);
    assertEquals(await Deno.readTextFile(fixtureAbsolutePath), fixtureA.content);
  } finally {
    await Deno.remove(frameworkHome, { recursive: true });
  }
});
