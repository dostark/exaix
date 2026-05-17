/**
 * @module ToolResultSchemaDescriptorTest
 * @path packages/schemas/tests/tool_result_schema_descriptor_test.ts
 * @description Verifies ToolResultSchemaDescriptorSchema correctly validates
 * the API discovery response structure for tool result schema introspection.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { TOOL_RESULT_SCHEMA_VERSION } from "@exaix/core";
import { ZodError } from "zod";
import { ToolResultRemediationPolicySchema, ToolResultSchemaDescriptorSchema } from "@exaix/schemas/tool_result.ts";

// ============================================================================
// ToolResultSchemaDescriptorSchema
// ============================================================================

Deno.test("ToolResultSchemaDescriptorSchema: accepts minimal valid descriptor", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "read_file",
    mode: "normalize_then_validate",
  });

  const descriptor = ToolResultSchemaDescriptorSchema.parse({
    tool: "read_file",
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    envelopeSchema: { type: "object" },
    remediationPolicy: policy,
  });

  assertEquals(descriptor.tool, "read_file");
  assertEquals(descriptor.schemaVersion, TOOL_RESULT_SCHEMA_VERSION);
  assertEquals(descriptor.experimental, true);
});

Deno.test("ToolResultSchemaDescriptorSchema: experimental defaults to true", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "write_file",
    mode: "fail_closed",
  });

  const descriptor = ToolResultSchemaDescriptorSchema.parse({
    tool: "write_file",
    schemaVersion: "1.0.0",
    envelopeSchema: {},
    remediationPolicy: policy,
  });

  assertEquals(descriptor.experimental, true);
});

Deno.test("ToolResultSchemaDescriptorSchema: accepts optional resultDataSchema", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "run_command",
    mode: "fail_closed",
  });

  const descriptor = ToolResultSchemaDescriptorSchema.parse({
    tool: "run_command",
    schemaVersion: "1.0.0",
    envelopeSchema: { type: "object" },
    resultDataSchema: {
      type: "object",
      properties: {
        stdout: { type: "string" },
        exitCode: { type: "number" },
      },
    },
    remediationPolicy: policy,
    experimental: false,
  });

  assertEquals(descriptor.experimental, false);
  assertEquals(descriptor.resultDataSchema, {
    type: "object",
    properties: {
      stdout: { type: "string" },
      exitCode: { type: "number" },
    },
  });
});

Deno.test("ToolResultSchemaDescriptorSchema: rejects missing tool", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "read_file",
    mode: "normalize_then_validate",
  });

  assertThrows(
    () =>
      ToolResultSchemaDescriptorSchema.parse({
        schemaVersion: "1.0.0",
        envelopeSchema: {},
        remediationPolicy: policy,
      }),
    ZodError,
  );
});

Deno.test("ToolResultSchemaDescriptorSchema: rejects missing schemaVersion", () => {
  const policy = ToolResultRemediationPolicySchema.parse({
    tool: "read_file",
    mode: "normalize_then_validate",
  });

  assertThrows(
    () =>
      ToolResultSchemaDescriptorSchema.parse({
        tool: "read_file",
        envelopeSchema: {},
        remediationPolicy: policy,
      }),
    ZodError,
  );
});

Deno.test("ToolResultSchemaDescriptorSchema: rejects missing remediationPolicy", () => {
  assertThrows(
    () =>
      ToolResultSchemaDescriptorSchema.parse({
        tool: "read_file",
        schemaVersion: "1.0.0",
        envelopeSchema: {},
      }),
    ZodError,
  );
});
