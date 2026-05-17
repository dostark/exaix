/**
 * @module ToolDescriptionQualityTest
 * @path packages/mcp/tests/tool_description_quality_test.ts
 * @description Validates that every live MCP tool description in the canonical manifest
 * meets the agent-quality bar: descriptive enough to allow an LLM to select the right
 * tool, includes guidance on when to prefer it, and describes what it returns.
 * Fails when a new tool description is a bare one-liner that omits disambiguation or
 * output shape, preventing regressions in tool selection accuracy.
 */

import { assert, assertEquals } from "@std/assert";
import { TOOL_MANIFEST } from "@exaix/mcp";
import { ToolKind } from "@exaix/core";

const MIN_DESCRIPTION_LENGTH = 60;

/** Live MCP tools exposed to agents — descriptions must meet the full quality bar. */
function liveTools() {
  return TOOL_MANIFEST.filter(
    (e) => e.kind === ToolKind.MCP_HANDLER || e.kind === ToolKind.MCP_DOMAIN,
  );
}

// ── Description quality tests ─────────────────────────────────────────────────

Deno.test("tool_quality: every live tool description meets minimum length", () => {
  const tooShort = liveTools().filter((e) => e.description.length < MIN_DESCRIPTION_LENGTH);

  assertEquals(
    tooShort.map((e) => e.name),
    [],
    `The following tools have descriptions shorter than ${MIN_DESCRIPTION_LENGTH} chars: ` +
      `[${tooShort.map((e) => `${e.name} (${e.description.length})`).join(", ")}]. ` +
      `Descriptions must explain what the tool does, when to use it, and what it returns.`,
  );
});

Deno.test("tool_quality: every live tool description contains usage guidance ('Use')", () => {
  const missingGuidance = liveTools().filter((e) => !e.description.includes("Use"));

  assertEquals(
    missingGuidance.map((e) => e.name),
    [],
    `The following tools lack 'Use' guidance: [${missingGuidance.map((e) => e.name).join(", ")}]. ` +
      `Descriptions must explain when to prefer this tool over alternatives.`,
  );
});

Deno.test("tool_quality: every live tool description contains output information", () => {
  const missingOutput = liveTools().filter(
    (e) => !e.description.includes("Returns") && !e.description.includes("return"),
  );

  assertEquals(
    missingOutput.map((e) => e.name),
    [],
    `The following tools lack output description: [${missingOutput.map((e) => e.name).join(", ")}]. ` +
      `Descriptions must state what the tool returns so the LLM can parse the result.`,
  );
});

Deno.test("tool_quality: live tool descriptions do not contain internal-only boilerplate", () => {
  const hasBoilerplate = liveTools().filter((e) =>
    e.description.includes("Internal") && e.description.includes("only")
  );

  assertEquals(
    hasBoilerplate.map((e) => e.name),
    [],
    `The following live tools have internal-only boilerplate: [${hasBoilerplate.map((e) => e.name).join(", ")}]. ` +
      `Live tools must have agent-facing descriptions, not internal notes.`,
  );
});

Deno.test("tool_quality: live tool count is non-zero", () => {
  assert(liveTools().length > 0, "manifest must contain at least one live MCP tool");
});
