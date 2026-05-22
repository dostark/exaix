/**
 * @module FlowTransformsTest
 * @path tests/flows/transforms_test.ts
 * @description Verifies the core data transformation functions for flows, including
 * section extraction, context merging, and JSON-to-text mapping.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { appendToRequest, extractSection, mergeAsContext, passthrough, templateFill } from "@exaix/core/func";
import { jsonExtract } from "@exaix/core/types";
import { readFixtureTextSync } from "../helpers/fixtures.ts";

/**
 * Test suite for built-in transform functions in flow inter-step communication
 *
 * Following TDD approach: tests define expected behavior before implementation
 */

Deno.test("Transform Functions - passthrough", async (t) => {
  await t.step("should pass data unchanged", () => {
    const input = "Hello, World!";
    const result = passthrough(input);
    assertEquals(result, "Hello, World!");
  });

  await t.step("should handle empty string", () => {
    const input = "";
    const result = passthrough(input);
    assertEquals(result, "");
  });

  await t.step("should handle complex markdown", () => {
    const input = readFixtureTextSync(import.meta.url, "flows", "transforms_test", "input.md");
    const result = passthrough(input);
    assertEquals(result, input);
  });
});

Deno.test("Transform Functions - mergeAsContext", async (t) => {
  await t.step("should merge multiple outputs as markdown sections", () => {
    const inputs = ["First output content", "Second output content"];
    const result = mergeAsContext(inputs);
    const expected = `## Step 1
First output content

## Step 2
Second output content`;
    assertEquals(result, expected);
  });

  await t.step("should handle single input", () => {
    const inputs = ["Single output"];
    const result = mergeAsContext(inputs);
    const expected = `## Step 1
Single output`;
    assertEquals(result, expected);
  });

  await t.step("should handle empty array", () => {
    const inputs: string[] = [];
    const result = mergeAsContext(inputs);
    assertEquals(result, "");
  });

  await t.step("should handle inputs with markdown headers", () => {
    const inputs = ["# Existing Header\nContent", "## Another Header\nMore content"];
    const result = mergeAsContext(inputs);
    const expected = readFixtureTextSync(import.meta.url, "flows", "transforms_test", "expected.md");
    assertEquals(result, expected);
  });
});

Deno.test("Transform Functions - extractSection", async (t) => {
  await t.step("should extract specific markdown section", () => {
    const input = readFixtureTextSync(import.meta.url, "flows", "transforms_test", "input_1.md");
    const result = extractSection(input, "Analysis");
    const expected = `This is the analysis section content.
It has multiple lines.`;
    assertEquals(result, expected);
  });

  await t.step("should handle section not found", () => {
    const input = "# Title\n\n## Section 1\nContent";
    assertThrows(() => extractSection(input, "Missing Section"), Error, "Section 'Missing Section' not found");
  });

  await t.step("should handle empty section content", () => {
    const input = "# Title\n\n## Empty Section\n\n## Next Section\nContent";
    const result = extractSection(input, "Empty Section");
    assertEquals(result, "");
  });

  await t.step("should handle section with code blocks", () => {
    const input = `# Title

## Code Section

\`\`\`typescript
const code = "example";
\`\`\`

End of section.`;

    const result = extractSection(input, "Code Section");
    const expected = `\`\`\`typescript
const code = "example";
\`\`\`

End of section.`;
    assertEquals(result, expected);
  });
});

Deno.test("Transform Functions - appendToRequest", async (t) => {
  await t.step("should prepend request to step output", () => {
    const request = "Please analyze this code.";
    const stepOutput = "Analysis complete. The code looks good.";
    const result = appendToRequest(request, stepOutput);
    const expected = `Original: Please analyze this code.

Step Output: Analysis complete. The code looks good.`;
    assertEquals(result, expected);
  });

  await t.step("should handle empty request", () => {
    const request = "";
    const stepOutput = "Some output";
    const result = appendToRequest(request, stepOutput);
    const expected = `Original:

Step Output: Some output`;
    assertEquals(result, expected);
  });

  await t.step("should handle empty step output", () => {
    const request = "Request content";
    const stepOutput = "";
    const result = appendToRequest(request, stepOutput);
    const expected = `Original: Request content

Step Output:`;
    assertEquals(result, expected);
  });
});

Deno.test("Transform Functions - jsonExtract", async (t) => {
  await t.step("should extract field from JSON string", () => {
    const input = `{"name": "John", "age": 30, "city": "New York"}`;
    const result = jsonExtract(input, "name");
    assertEquals(result, "John");
  });

  await t.step("should extract nested field", () => {
    const input = `{"user": {"name": "Jane", "profile": {"age": 25}}}`;
    const result = jsonExtract(input, "user.profile.age");
    assertEquals(result, 25);
  });

  await t.step("should handle invalid JSON", () => {
    const input = `{"invalid": json}`;
    assertThrows(() => jsonExtract(input, "field"), Error, "Invalid JSON input");
  });

  await t.step("should handle missing field", () => {
    const input = `{"name": "John"}`;
    assertThrows(() => jsonExtract(input, "missing"), Error, "Field 'missing' not found");
  });

  await t.step("should extract array elements", () => {
    const input = `{"items": ["first", "second", "third"]}`;
    const result = jsonExtract(input, "items.1");
    assertEquals(result, "second");
  });
});

Deno.test("Transform Functions - templateFill", async (t) => {
  await t.step("should fill template with context variables", () => {
    const template = "Hello {{name}}, you are {{age}} years old and live in {{city}}.";
    const context = { name: "Alice", age: 28, city: "Boston" };
    const result = templateFill(template, context);
    assertEquals(result, "Hello Alice, you are 28 years old and live in Boston.");
  });

  await t.step("should handle missing context variables", () => {
    const template = "Hello {{name}}, welcome!";
    const context = { other: "value" };
    assertThrows(() => templateFill(template, context), Error, "Missing context variable: name");
  });

  await t.step("should handle empty template", () => {
    const template = "";
    const context = {};
    const result = templateFill(template, context);
    assertEquals(result, "");
  });

  await t.step("should handle multiple occurrences of same variable", () => {
    const template = "{{greeting}} {{name}}! {{greeting}} again!";
    const context = { greeting: "Hello", name: "World" };
    const result = templateFill(template, context);
    assertEquals(result, "Hello World! Hello again!");
  });

  await t.step("should handle complex template with markdown", () => {
    const template = `# Report for {{project}}

## Summary
{{summary}}

## Status: {{status}}`;
    const context = {
      project: "Exaix",
      summary: "Implementation is progressing well.",
      status: "On Track",
    };
    const result = templateFill(template, context);
    const expected = `# Report for Exaix

## Summary
Implementation is progressing well.

## Status: On Track`;
    assertEquals(result, expected);
  });
});
