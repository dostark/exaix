/**
 * @module ScenarioFrameworkScenarioTemplates
 * @path tests/scenario_framework/runner/scenario_templates.ts
 * @description Implements Step 8 starter-template rendering so new
 * scenario packs can be authored without changing core framework code.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/templates/scenario_template.yaml, tests/scenario_framework/tests/unit/pack_generalization_test.ts]
 */

import { SCHEMA_VERSION } from "../schema/version.ts";

export interface IScenarioTemplateOptions {
  id: string;
  title: string;
  pack: string;
  tags: string[];
  requestFixture: string;
}

export function renderScenarioTemplate(
  options: IScenarioTemplateOptions,
): string {
  return [
    `# Schema version: ${SCHEMA_VERSION}`,
    `schema_version: "${SCHEMA_VERSION}"`,
    `id: "${options.id}"`,
    `title: "${options.title}"`,
    `pack: "${options.pack}"`,
    `tags: [${options.tags.map((tag) => `"${tag}"`).join(", ")}]`,
    `request_fixture: "${options.requestFixture}"`,
    'mode_support: ["auto"]',
    "portals: []",
    "steps:",
    '  - id: "create-request"',
    '    type: "exactl"',
    '    command: "request create"',
    `    args: ["--from-file", "${options.requestFixture}"]`,
    "    input_criteria:",
    '      - id: "request-fixture-exists"',
    '        kind: "file-exists"',
    `        path: "${options.requestFixture}"`,
    "    output_criteria:",
    '      - id: "request-command-succeeded"',
    '        kind: "command-exit-code"',
    "        equals: 0",
    "",
  ].join("\n");
}
