/**
 * @module ToolRegistryDescriptionQualityTest
 * @path tests/services/tool/tool_registry_description_quality_test.ts
 * @description Validates that every tool registered in ToolRegistry meets the same
 * agent-quality bar enforced for MCP manifest tools: minimum length, disambiguation
 * guidance ("Use"), and output description ("Returns"/"return"). Prevents regressions
 * when new internal tools are added without agent-facing descriptions.
 */

import { assert, assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "../../helpers/config.ts";

const MIN_DESCRIPTION_LENGTH = 60;

function registryTools() {
  const config = createMockConfig("/tmp/quality-test");
  const registry = new ToolRegistry({ config });
  return registry.getTools();
}

// ── Description quality tests ─────────────────────────────────────────────────

Deno.test("tool_registry_quality: every tool description meets minimum length", () => {
  const tooShort = registryTools().filter((t) => t.description.length < MIN_DESCRIPTION_LENGTH);

  assertEquals(
    tooShort.map((t) => t.name),
    [],
    `The following ToolRegistry tools have descriptions shorter than ${MIN_DESCRIPTION_LENGTH} chars: ` +
      `[${tooShort.map((t) => `${t.name} (${t.description.length})`).join(", ")}]. ` +
      `Descriptions must explain what the tool does, when to use it, and what it returns.`,
  );
});

Deno.test("tool_registry_quality: every tool description contains usage guidance ('Use')", () => {
  const missingGuidance = registryTools().filter((t) => !t.description.includes("Use"));

  assertEquals(
    missingGuidance.map((t) => t.name),
    [],
    `The following ToolRegistry tools lack 'Use' guidance: [${missingGuidance.map((t) => t.name).join(", ")}]. ` +
      `Descriptions must explain when to prefer this tool over alternatives.`,
  );
});

Deno.test("tool_registry_quality: every tool description contains output information", () => {
  const missingOutput = registryTools().filter(
    (t) => !t.description.includes("Returns") && !t.description.includes("return"),
  );

  assertEquals(
    missingOutput.map((t) => t.name),
    [],
    `The following ToolRegistry tools lack output description: [${missingOutput.map((t) => t.name).join(", ")}]. ` +
      `Descriptions must state what the tool returns so the LLM can parse the result.`,
  );
});

Deno.test("tool_registry_quality: tool count is non-zero", () => {
  const tools = registryTools();
  assert(tools.length > 0, "ToolRegistry must register at least one tool");
});
