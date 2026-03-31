/**
 * @module OutputValidatorTest
 * @path tests/services/output_validator_test.ts
 * @description Verifies the logic for parsing and validating agent-produced XML/Markdown outputs,
 * ensuring structural tags like <thought> and <content> are correctly extracted.
 */

import { assert, assertEquals, assertExists, assertFalse } from "@std/assert";
import { CritiqueSeverity, EvaluationVerdict, McpToolName } from "../../../src/shared/enums.ts";
import { z } from "zod";
import {
  createOutputValidator,
  createPlanValidator,
  OutputValidator,
} from "../../../src/services/tool/output_validator.ts";

// ============================================================================
// XML Tag Parsing Tests
// ============================================================================

Deno.test("[OutputValidator] parses XML tags correctly", () => {
  const validator = new OutputValidator();

  const result = validator.parseXMLTags(
    "<thought>Analyzing the request</thought><content>Here is the answer</content>",
  );

  assertEquals(result.thought, "Analyzing the request");
  assertEquals(result.content, "Here is the answer");
});

Deno.test("[OutputValidator] handles missing thought tag", () => {
  const validator = new OutputValidator();

  const result = validator.parseXMLTags("<content>Only content here</content>");

  assertEquals(result.thought, "");
  assertEquals(result.content, "Only content here");
});

Deno.test("[OutputValidator] handles missing content tag", () => {
  const validator = new OutputValidator();

  const result = validator.parseXMLTags(
    "<thought>Just thinking</thought>",
  );

  assertEquals(result.thought, "Just thinking");
  assertEquals(result.content, "");
});

Deno.test("[OutputValidator] treats untagged response as content", () => {
  const validator = new OutputValidator();

  const result = validator.parseXMLTags("Plain text response");

  assertEquals(result.thought, "");
  assertEquals(result.content, "Plain text response");
});

Deno.test("[OutputValidator] handles null input", () => {
  const validator = new OutputValidator();

  const result = validator.parseXMLTags("");

  assertEquals(result.thought, "");
  assertEquals(result.content, "");
  assertEquals(result.raw, "");
});

Deno.test("[OutputValidator] preserves multiline content", () => {
  const validator = new OutputValidator();

  const content =
    "<thought>\nStep 1: Parse input\nStep 2: Process\nStep 3: Output\n</thought>\n<content>\nLine 1\nLine 2\nLine 3\n</content>";

  const result = validator.parseXMLTags(content);

  assert(result.thought.includes("Step 1"));
  assert(result.thought.includes("Step 3"));
  assert(result.content.includes("Line 1"));
  assert(result.content.includes("Line 3"));
});

// ============================================================================
// JSON Validation Tests
// ============================================================================

Deno.test("[OutputValidator] validates valid JSON against schema", () => {
  const validator = new OutputValidator();
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  const result = validator.validate('{"name": "Test", "age": 25}', schema);

  assert(result.success);
  assertExists(result.value);
  assertEquals(result.value.name, "Test");
  assertEquals(result.value.age, 25);
});

Deno.test("[OutputValidator] fails on invalid JSON", () => {
  const validator = new OutputValidator({ autoRepair: false });
  const schema = z.object({ name: z.string() });

  const result = validator.validate("not valid json {", schema);

  assertFalse(result.success);
  assertExists(result.errors);
  assertEquals(result.errors[0].code, "invalid_json");
});

Deno.test("[OutputValidator] fails on schema mismatch", () => {
  const validator = new OutputValidator();
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  const result = validator.validate('{"name": "Test"}', schema);

  assertFalse(result.success);
  assertExists(result.errors);
  assert(result.errors.some((e) => e.path.includes("age")));
});

// ============================================================================
// JSON Repair Tests
// ============================================================================

Deno.test("[OutputValidator] repairs markdown code blocks", () => {
  const validator = new OutputValidator({ autoRepair: true });
  const schema = z.object({ value: z.string() });

  const result = validator.validate(
    '\`\`\`json\n{"value": "test"}\n\`\`\`',
    schema,
  );

  assert(result.success);
  assert(result.repairAttempted);
  assert(result.repairSucceeded);
  assertEquals(result.value?.value, "test");
});

Deno.test("[OutputValidator] repairs trailing commas in objects", () => {
  const validator = new OutputValidator({ autoRepair: true });
  const schema = z.object({ a: z.string(), b: z.string() });

  const result = validator.validate('{"a": "1", "b": "2",}', schema);

  assert(result.success);
  assert(result.repairSucceeded);
});

Deno.test("[OutputValidator] repairs trailing commas in arrays", () => {
  const validator = new OutputValidator({ autoRepair: true });
  const schema = z.object({ items: z.array(z.number()) });

  const result = validator.validate('{"items": [1, 2, 3,]}', schema);

  assert(result.success);
  assert(result.repairSucceeded);
});

Deno.test("[OutputValidator] extracts JSON from surrounding text", () => {
  const validator = new OutputValidator({ autoRepair: true });
  const schema = z.object({ answer: z.string() });

  const result = validator.validate(
    'Here is the response: {"answer": "42"} Hope this helps!',
    schema,
  );

  assert(result.success);
  assert(result.repairSucceeded);
  assertEquals(result.value?.answer, "42");
});

Deno.test("[OutputValidator] removes line comments", () => {
  const validator = new OutputValidator({ autoRepair: true });
  const schema = z.object({ value: z.number() });

  const result = validator.validate(
    '{\n  "value": 42 // this is a comment\n}',
    schema,
  );

  assert(result.success);
  assert(result.repairSucceeded);
});

// ============================================================================
// Named Schema Tests
// ============================================================================

Deno.test("[OutputValidator] validates evaluation schema", () => {
  const validator = new OutputValidator();

  const validEvaluation = JSON.stringify({
    score: 8,
    verdict: EvaluationVerdict.PASS,
    reasoning: "Good implementation with minor issues",
    suggestions: ["Add more tests", "Improve error handling"],
  });

  const result = validator.validateWithSchema(validEvaluation, "evaluation");

  assert(result.success);
  assertEquals(result.value?.score, 8);
  assertEquals(result.value?.verdict, EvaluationVerdict.PASS);
});

Deno.test("[OutputValidator] validates analysis schema", () => {
  const validator = new OutputValidator();

  const validAnalysis = JSON.stringify({
    summary: "Code analysis complete",
    findings: [
      {
        type: "issue",
        severity: "medium",
        message: "Potential memory leak",
        location: "src/main.ts:42",
      },
    ],
  });

  const result = validator.validateWithSchema(validAnalysis, "analysis");

  assert(result.success);
  assertEquals(result.value?.findings.length, 1);
});

Deno.test("[OutputValidator] validates plan schema", () => {
  const validator = new OutputValidator();

  const validPlan = JSON.stringify({
    subject: "Test Plan",
    description: "A test plan for validation",
    steps: [
      {
        step: 1,
        title: "First step",
        description: "Do the first thing",
      },
    ],
  });

  const result = validator.validateWithSchema(validPlan, "plan");

  assert(result.success);
  assertEquals(result.value?.subject, "Test Plan");
});

Deno.test("[OutputValidator] validates simpleResponse schema", () => {
  const validator = new OutputValidator();

  const validResponse = JSON.stringify({
    answer: "The answer is 42",
    confidence: 0.95,
    sources: ["source1.txt", "source2.txt"],
  });

  const result = validator.validateWithSchema(validResponse, "simpleResponse");

  assert(result.success);
  assertEquals(result.value?.confidence, 0.95);
});

Deno.test("[OutputValidator] validates toolCall schema", () => {
  const validator = new OutputValidator();

  const validToolCall = JSON.stringify({
    tool: McpToolName.READ_FILE,
    arguments: { path: "/src/main.ts" },
    reasoning: "Need to read the file to understand the code",
  });

  const result = validator.validateWithSchema(validToolCall, "toolCall");

  assert(result.success);
  assertEquals(result.value?.tool, McpToolName.READ_FILE);
});

// ============================================================================
// Combined Parse and Validate Tests
// ============================================================================

Deno.test("[OutputValidator] parseAndValidate extracts and validates", () => {
  const validator = new OutputValidator();

  const raw = '<thought>Analyzing request</thought>\n<content>{"answer": "Hello", "confidence": 0.9}</content>';

  const result = validator.parseAndValidateWithSchema(raw, "simpleResponse");

  assert(result.success);
  assertExists(result.parsed);
  assertEquals(result.parsed.thought, "Analyzing request");
  assertEquals(result.value?.answer, "Hello");
});

Deno.test("[OutputValidator] parseAndValidate handles validation failure", () => {
  const validator = new OutputValidator();

  const raw = '<thought>Processing</thought>\n<content>{"answer": ""}</content>';

  const result = validator.parseAndValidateWithSchema(raw, "simpleResponse");

  assertFalse(result.success);
  assertExists(result.parsed);
  assertEquals(result.parsed.thought, "Processing");
});

// ============================================================================
// Metrics Tests
// ============================================================================

Deno.test("[OutputValidator] tracks validation metrics", () => {
  const validator = new OutputValidator();
  const schema = z.object({ value: z.string() });

  // Successful validation
  validator.validate('{"value": "test"}', schema);

  // Failed validation
  validator.validate('{"value": 123}', schema);

  // Repaired validation
  validator.validate('\`\`\`json\n{"value": "fixed"}\n\`\`\`', schema);

  const metrics = validator.getMetrics();

  assertEquals(metrics.totalAttempts, 3);
  assertEquals(metrics.successfulValidations, 2);
  assert(metrics.repairAttempts >= 1);
});

Deno.test("[OutputValidator] resets metrics", () => {
  const validator = new OutputValidator();
  const schema = z.object({ value: z.string() });

  validator.validate('{"value": "test"}', schema);

  let metrics = validator.getMetrics();
  assertEquals(metrics.totalAttempts, 1);

  validator.resetMetrics();

  metrics = validator.getMetrics();
  assertEquals(metrics.totalAttempts, 0);
});

// ============================================================================
// Factory Function Tests
// ============================================================================

Deno.test("[createOutputValidator] creates validator with defaults", () => {
  const validator = createOutputValidator();

  const result = validator.validate(
    '{"value": "test",}', // Has trailing comma
    z.object({ value: z.string() }),
  );

  // Should auto-repair by default
  assert(result.success);
});

Deno.test("[createPlanValidator] creates plan-specific validator", () => {
  const validator = createPlanValidator();

  const plan = JSON.stringify({
    subject: "Test",
    description: "Test plan",
    steps: [{ step: 1, title: "Step 1", description: "Do stuff" }],
  });

  const result = validator.validateWithSchema(plan, "plan");
  assert(result.success);
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("[OutputValidator] handles empty content", () => {
  const validator = new OutputValidator();
  const schema = z.object({ value: z.string() });

  const result = validator.validate("", schema);

  assertFalse(result.success);
});

Deno.test("[OutputValidator] handles whitespace-only content", () => {
  const validator = new OutputValidator();
  const schema = z.object({ value: z.string() });

  const result = validator.validate("   \n\t  ", schema);

  assertFalse(result.success);
});

Deno.test("[OutputValidator] handles deeply nested JSON", () => {
  const validator = new OutputValidator();
  const schema = z.object({
    level1: z.object({
      level2: z.object({
        level3: z.object({
          value: z.string(),
        }),
      }),
    }),
  });

  const json = JSON.stringify({
    level1: {
      level2: {
        level3: {
          value: "deep",
        },
      },
    },
  });

  const result = validator.validate(json, schema);

  assert(result.success);
  assertEquals(result.value?.level1.level2.level3.value, "deep");
});

Deno.test("[OutputValidator] provides detailed error paths", () => {
  const validator = new OutputValidator();
  const schema = z.object({
    user: z.object({
      profile: z.object({
        email: z.string().email(),
      }),
    }),
  });

  const json = JSON.stringify({
    user: {
      profile: {
        email: "not-an-email",
      },
    },
  });

  const result = validator.validate(json, schema);

  assertFalse(result.success);
  assertExists(result.errors);
  // Should include path to the failing field
  const errorPath = result.errors[0].path.join(".");
  assert(errorPath.includes("email") || errorPath.includes("profile"));
});

// ============================================================================
// Output Schema Registry Tests
// ============================================================================

Deno.test("[OutputSchemas] evaluation schema rejects invalid verdict", () => {
  const validator = new OutputValidator();

  const invalid = JSON.stringify({
    score: 5,
    verdict: "maybe", // Invalid enum value
    reasoning: "test",
  });

  const result = validator.validateWithSchema(invalid, "evaluation");

  assertFalse(result.success);
});

Deno.test("[OutputSchemas] evaluation schema rejects score out of range", () => {
  const validator = new OutputValidator();

  const invalid = JSON.stringify({
    score: 15, // Out of range (0-10)
    verdict: EvaluationVerdict.PASS,
    reasoning: "test",
  });

  const result = validator.validateWithSchema(invalid, "evaluation");

  assertFalse(result.success);
});

Deno.test("[OutputSchemas] analysis schema validates finding types", () => {
  const validator = new OutputValidator();

  const validTypes = ["issue", CritiqueSeverity.SUGGESTION, "note", "warning", "error"];

  for (const type of validTypes) {
    const analysis = JSON.stringify({
      summary: "Test",
      findings: [{ type, message: "Test finding" }],
    });

    const result = validator.validateWithSchema(analysis, "analysis");
    assert(result.success, 'Type "' + type + '" should be valid');
  }
});

Deno.test("[OutputSchemas] actionSequence requires at least one action", () => {
  const validator = new OutputValidator();

  const empty = JSON.stringify({
    actions: [],
  });

  const result = validator.validateWithSchema(empty, "actionSequence");

  assertFalse(result.success);
});
