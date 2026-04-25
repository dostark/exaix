/**
 * @module InputValidationSchemaTest
 * @path tests/schemas/input_validation_test.ts
 * @description Verifies core primitive schemas, ensuring robust validation of
 * blueprint names, portal identifiers, and agent slugs.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { SecurityMode } from "@exaix/core";
import { PROVIDER_OPENAI } from "@exaix/ai";

import { AgentExecutionOptionsSchema } from "@exaix/schemas/agent_executor.ts";
import {
  AgentIdSchema,
  BlueprintNameSchema,
  ExecutionContextSchema,
  InputSanitizer,
  InputValidator,
  ModelConfigSchema,
  PlanSchema,
  PortalNameSchema,
  TraceIdSchema,
  UserRequestSchema,
} from "@exaix/schemas/input_validation.ts";
import { TEST_MODEL_OPENAI } from "@exaix/testing";

Deno.test("Input Validation - BlueprintNameSchema", async (t) => {
  await t.step("accepts valid blueprint names", () => {
    const validNames = ["agent-123", "my_agent", "TestAgent", "agent_1"];
    for (const name of validNames) {
      assertEquals(BlueprintNameSchema.parse(name), name);
    }
  });

  await t.step("rejects empty blueprint names", () => {
    assertThrows(() => BlueprintNameSchema.parse(""));
  });

  await t.step("rejects path traversal attempts", () => {
    const invalidNames = ["../../../etc/passwd", "..", "agent/../../../config"];
    for (const name of invalidNames) {
      assertThrows(() => BlueprintNameSchema.parse(name));
    }
  });

  await t.step("rejects special characters", () => {
    const invalidNames = ["agent<script>", "agent|pipe", "agent?query"];
    for (const name of invalidNames) {
      assertThrows(() => BlueprintNameSchema.parse(name));
    }
  });

  await t.step("rejects overly long names", () => {
    const longName = "a".repeat(101);
    assertThrows(() => BlueprintNameSchema.parse(longName));
  });
});

Deno.test("Input Validation - PortalNameSchema", async (t) => {
  await t.step("accepts valid portal names", () => {
    const validNames = ["portal-123", "my_portal", "TestPortal"];
    for (const name of validNames) {
      assertEquals(PortalNameSchema.parse(name), name);
    }
  });

  await t.step("rejects injection attempts", () => {
    const invalidNames = ["portal<script>", "portal'injection"];
    for (const name of invalidNames) {
      assertThrows(() => PortalNameSchema.parse(name));
    }
  });
});

Deno.test("Input Validation - AgentIdSchema", async (t) => {
  await t.step("accepts valid agent IDs", () => {
    const validIds = ["agent-123", "my_agent", "TestAgent"];
    for (const id of validIds) {
      assertEquals(AgentIdSchema.parse(id), id);
    }
  });

  await t.step("rejects path traversal in agent IDs", () => {
    assertThrows(() => AgentIdSchema.parse("../../../evil"));
  });
});

Deno.test("Input Validation - TraceIdSchema", async (t) => {
  await t.step("accepts valid trace IDs", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";
    assertEquals(TraceIdSchema.parse(validId), validId);
  });

  await t.step("rejects invalid trace IDs", () => {
    const invalidIds = ["not-a-uuid", "123", "trace with spaces"];
    for (const id of invalidIds) {
      assertThrows(() => TraceIdSchema.parse(id));
    }
  });
});

Deno.test("Input Validation - UserRequestSchema", async (t) => {
  await t.step("accepts valid user requests", () => {
    const validRequest = "Please help me with this task";
    assertEquals(UserRequestSchema.parse(validRequest), validRequest);
  });

  await t.step("rejects script injection", () => {
    assertThrows(() => UserRequestSchema.parse("<script>alert('xss')</script>"));
  });

  await t.step("rejects iframe injection", () => {
    assertThrows(() => UserRequestSchema.parse("<iframe src='evil.com'></iframe>"));
  });

  await t.step("rejects control characters", () => {
    assertThrows(() => UserRequestSchema.parse("Request\x00with\x01control\x02chars"));
  });

  await t.step("rejects empty requests", () => {
    assertThrows(() => UserRequestSchema.parse(""));
  });

  await t.step("rejects overly long requests", () => {
    const longRequest = "A".repeat(10001);
    assertThrows(() => UserRequestSchema.parse(longRequest));
  });
});

Deno.test("Input Validation - PlanSchema", async (t) => {
  await t.step("accepts valid plans", () => {
    const validPlan = "Analyze the data and provide insights";
    assertEquals(PlanSchema.parse(validPlan), validPlan);
  });

  await t.step("rejects script injection in plans", () => {
    assertThrows(() => PlanSchema.parse("Plan: <script>evil()</script>"));
  });

  await t.step("rejects control characters in plans", () => {
    assertThrows(() => PlanSchema.parse("Plan\x00with\x01control"));
  });

  await t.step("rejects overly long plans", () => {
    const longPlan = "A".repeat(50001);
    assertThrows(() => PlanSchema.parse(longPlan));
  });
});

Deno.test("Input Validation - ModelConfigSchema", async (t) => {
  await t.step("accepts valid model configs", () => {
    const validConfig = {
      provider: PROVIDER_OPENAI,
      model: TEST_MODEL_OPENAI,
      temperature: 0.7,
    };
    assertEquals(ModelConfigSchema.parse(validConfig), validConfig);
  });

  await t.step("rejects invalid providers", () => {
    const invalidConfig = {
      provider: "invalid-provider",
      model: TEST_MODEL_OPENAI,
    };
    assertThrows(() => ModelConfigSchema.parse(invalidConfig));
  });

  await t.step("rejects prototype pollution attempts", () => {
    const maliciousConfig = {
      provider: PROVIDER_OPENAI,
      model: TEST_MODEL_OPENAI,
      __proto__: { polluted: true },
    };
    assertThrows(() => ModelConfigSchema.parse(maliciousConfig));
  });

  await t.step("rejects invalid temperature ranges", () => {
    const invalidConfig = {
      provider: PROVIDER_OPENAI,
      model: TEST_MODEL_OPENAI,
      temperature: 3.0,
    };
    assertThrows(() => ModelConfigSchema.parse(invalidConfig));
  });
});

Deno.test("Input Validation - ExecutionContextSchema", async (t) => {
  await t.step("accepts valid execution contexts", () => {
    const validContext = {
      trace_id: "550e8400-e29b-41d4-a716-446655440000",
      request_id: "req-123",
      request: "Please help me",
      plan: "Analyze the data",
      portal: "default",
      userId: "user-123",
      sessionId: "session-456",
    };
    assertEquals(ExecutionContextSchema.parse(validContext), validContext);
  });

  await t.step("rejects invalid trace IDs", () => {
    const invalidContext = {
      trace_id: "trace with spaces",
      request_id: "req-123",
      request: "test",
      plan: "test plan",
      portal: "default",
    };
    assertThrows(() => ExecutionContextSchema.parse(invalidContext));
  });

  await t.step("rejects malicious requests in context", () => {
    const maliciousContext = {
      trace_id: "550e8400-e29b-41d4-a716-446655440000",
      request_id: "req-123",
      request: "<script>alert('xss')</script>",
      plan: "test plan",
      portal: "default",
    };
    assertThrows(() => ExecutionContextSchema.parse(maliciousContext));
  });
});

Deno.test("Input Validation - AgentExecutionOptionsSchema", async (t) => {
  await t.step("accepts valid execution options", () => {
    const validOptions = {
      identity_id: "test-identity",
      portal: "default",
      security_mode: SecurityMode.SANDBOXED,
      timeout_ms: 300000,
      max_tool_calls: 100,
      audit_enabled: true,
    };
    assertEquals(AgentExecutionOptionsSchema.parse(validOptions), validOptions);
  });

  await t.step("applies default values", () => {
    const minimalOptions = {
      identity_id: "test-agent",
      portal: "default",
    };
    const parsed = AgentExecutionOptionsSchema.parse(minimalOptions);
    assertEquals(parsed.security_mode, SecurityMode.SANDBOXED);
    assertEquals(parsed.timeout_ms, 300000);
    assertEquals(parsed.max_tool_calls, 100);
    assertEquals(parsed.audit_enabled, true);
  });

  await t.step("rejects invalid security modes", () => {
    const invalidOptions = {
      identity_id: "test-agent",
      portal: "default",
      security_mode: "invalid-mode",
    };
    assertThrows(() => AgentExecutionOptionsSchema.parse(invalidOptions));
  });
});

Deno.test("Input Validation - InputValidator utility", async (t) => {
  await t.step("validates execution context", () => {
    const validContext = {
      trace_id: "550e8400-e29b-41d4-a716-446655440000",
      request_id: "req-123",
      request: "test request",
      plan: "test plan",
      portal: "default",
    };

    const result = InputValidator.validateExecutionContext(validContext);
    assertEquals(result.trace_id, validContext.trace_id);
  });

  await t.step("validates agent execution options", () => {
    const validOptions = {
      identity_id: "test-agent",
      portal: "default",
      security_mode: SecurityMode.SANDBOXED,
      timeout_ms: 300000,
    };

    const result = InputValidator.validateAgentExecutionOptions(validOptions);
    assertEquals(result.security_mode, SecurityMode.SANDBOXED);
    assertEquals(result.timeout_ms, 300000);
  });

  await t.step("validates blueprint names", () => {
    const result = InputValidator.validateBlueprintName("valid-agent");
    assertEquals(result, "valid-agent");
  });

  await t.step("validates model configs", () => {
    const validConfig = {
      provider: PROVIDER_OPENAI,
      model: TEST_MODEL_OPENAI,
    };

    const result = InputValidator.validateModelConfig(validConfig);
    assertEquals(result.provider, PROVIDER_OPENAI);
    assertEquals(result.model, TEST_MODEL_OPENAI);
  });
});

Deno.test("Input Validation - InputSanitizer utility", async (t) => {
  await t.step("sanitizes filenames", () => {
    assertEquals(InputSanitizer.sanitizeFilename("valid_file.txt"), "valid_file.txt");
    assertEquals(InputSanitizer.sanitizeFilename("file<script>.txt"), "file_script_.txt");
    assertEquals(InputSanitizer.sanitizeFilename("../../../etc/passwd"), "_.___.___.__etc_passwd");
  });

  await t.step("sanitizes paths", () => {
    assertEquals(InputSanitizer.sanitizePath("valid/path/file.txt"), "valid/path/file.txt");
    assertEquals(InputSanitizer.sanitizePath("../evil/path"), "evil/path");
    assertEquals(InputSanitizer.sanitizePath("/absolute/path"), "absolute/path");
  });

  await t.step("sanitizes user text", () => {
    const cleanText = InputSanitizer.sanitizeUserText("Hello <script>alert('xss')</script> world");
    assertEquals(cleanText, "Hello [SCRIPT REMOVED] world");
  });

  await t.step("sanitizes plan text", () => {
    const cleanPlan = InputSanitizer.sanitizePlanText("Plan <script>evil()</script> here");
    assertEquals(cleanPlan, "Plan [SCRIPT REMOVED] here");
  });

  await t.step("limits text length", () => {
    const longText = "A".repeat(20000);
    const sanitized = InputSanitizer.limitTextLength(longText, 100);
    assertEquals(sanitized.length, 100);
  });
});

Deno.test("Input Validation - Security regression tests", async (t) => {
  await t.step("prevents path traversal in blueprint loading", () => {
    assertThrows(() => BlueprintNameSchema.parse("../../../etc/passwd"));
    assertThrows(() => AgentIdSchema.parse("../../config.json"));
  });

  await t.step("prevents SQL injection in portal names", () => {
    assertThrows(() => PortalNameSchema.parse("portal'; DROP TABLE users; --"));
  });

  await t.step("prevents XSS in user requests", () => {
    assertThrows(() => UserRequestSchema.parse("<img src=x onerror=alert('xss')>"));
    assertThrows(() => PlanSchema.parse("<script>stealCookies()</script>"));
  });

  await t.step("prevents type confusion in model configs", () => {
    const maliciousConfig = {
      provider: PROVIDER_OPENAI,
      model: "gpt-4",
      constructor: { prototype: { polluted: true } },
    };
    assertThrows(() => ModelConfigSchema.parse(maliciousConfig));
  });

  await t.step("prevents DoS through large inputs", () => {
    const largeRequest = "A".repeat(10001);
    assertThrows(() => UserRequestSchema.parse(largeRequest));

    const largePlan = "B".repeat(50001);
    assertThrows(() => PlanSchema.parse(largePlan));
  });
});
