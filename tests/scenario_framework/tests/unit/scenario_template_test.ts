/**
 * @module ScenarioTemplateTest
 * @path tests/scenario_framework/tests/unit/scenario_template_test.ts
 * @description Keeps the starter scenario template usable: with its placeholders filled it parses
 * through ScenarioSchema, submits through the real `exactl request --file` form, and starts and
 * stops the daemon it depends on.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/templates/scenario_template.yaml, tests/scenario_framework/SCENARIO_DSL.md]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";

const FRAMEWORK_HOME = fromFileUrl(new URL("../../", import.meta.url));
const TEMPLATE_PATH = join(FRAMEWORK_HOME, "templates/scenario_template.yaml");

const PLACEHOLDERS: Record<string, string> = {
  __SCENARIO_ID__: "template-check",
  __SCENARIO_TITLE__: "Template check",
  __SCENARIO_PACK__: "smoke",
  __SCENARIO_TAGS__: '"template"',
  __REQUEST_FIXTURE__: "fixtures/requests/shared/workspace_health_smoke.md",
};

function renderTemplate(): string {
  let text = Deno.readTextFileSync(TEMPLATE_PATH);
  for (const [token, value] of Object.entries(PLACEHOLDERS)) text = text.replaceAll(token, value);
  return text;
}

Deno.test("[scenario_template] the filled template parses and leaves no placeholder", () => {
  const text = renderTemplate();
  assert(!/__[A-Z_]+__/.test(text), "an unfilled placeholder remains");
  const scenario = ScenarioSchema.parse(parseYaml(text));
  assertEquals(scenario.id, "template-check");
});

Deno.test("[scenario_template] the template submits with request --file and brackets it with daemon start and stop", () => {
  const scenario = ScenarioSchema.parse(parseYaml(renderTemplate()));
  const submit = scenario.steps.find((s) => s.id === "submit-request");
  assertEquals(submit?.command, "request");
  assertEquals(submit?.args, ["--file", "$REQUEST_FIXTURE"]);
  assertEquals(scenario.steps[0].args, ["start"]);
  assertEquals(scenario.steps.at(-1)?.args, ["stop"]);
});
