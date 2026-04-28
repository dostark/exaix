/**
 * @module InterStepTransformTest
 * @path tests/flows/inter_step_test.ts
 * @description Verifies the logic for data transformation and context passing
 * between sequential steps in an agentic workflow.
 */

import { assertEquals } from "@std/assert";
import {
  appendToRequest,
  extractSection,
  mergeAsContext,
  passthrough,
  templateFill,
} from "../../src/flows/transforms.ts";
import { jsonExtract } from "@exaix/core/types/json.ts";

/**
 * Integration tests for inter-step communication transforms
 *
 * Tests the transform functions that enable data flow between flow steps
 */

Deno.test("Transform Functions", async (t) => {
  await t.step("passthrough should return input unchanged", () => {
    const input = "test input";
    const result = passthrough(input);
    assertEquals(result, "test input");
  });

  await t.step("mergeAsContext should format multiple inputs as context", () => {
    const inputs = ["Input 1", "Input 2", "Input 3"];
    const result = mergeAsContext(inputs);
    assertEquals(result, "## Step 1\nInput 1\n\n## Step 2\nInput 2\n\n## Step 3\nInput 3");
  });

  await t.step("extractSection should extract content between headers", () => {
    const input = "## Summary\nThis is the summary\n\n## Details\nThese are the details";
    const result = extractSection(input, "Summary");
    assertEquals(result, "This is the summary");
  });

  await t.step("extractSection should handle case insensitive matching", () => {
    const input = "## SUMMARY\nThis is the summary\n\n## Details\nThese are the details";
    const result = extractSection(input, "SUMMARY");
    assertEquals(result, "This is the summary");
  });

  await t.step("appendToRequest should combine request and step output", () => {
    const request = "Original request";
    const stepOutput = "Step output";
    const result = appendToRequest(request, stepOutput);
    assertEquals(result, "Original: Original request\n\nStep Output: Step output");
  });

  await t.step("jsonExtract should extract values from JSON", () => {
    const input = '{"name": "John", "age": 30, "findings": "Important data"}';
    const result = jsonExtract(input, "findings");
    assertEquals(result, "Important data");
  });

  await t.step("jsonExtract should handle nested paths", () => {
    const input = '{"data": {"results": ["item1", "item2"]}}';
    const result = jsonExtract(input, "data.results.0");
    assertEquals(result, "item1");
  });

  await t.step("templateFill should replace placeholders", () => {
    const input = "Hello {{name}}, your score is {{score}}";
    const result = templateFill(input, {
      name: "Alice",
      score: "95",
    });
    assertEquals(result, "Hello Alice, your score is 95");
  });

  await t.step("templateFill should handle missing placeholders", () => {
    const input = "Hello {{name}}";
    const result = templateFill(input, {
      name: "Bob",
      extra: "ignored",
    });
    assertEquals(result, "Hello Bob");
  });
});
