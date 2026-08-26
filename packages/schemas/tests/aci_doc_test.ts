/**
 * @module AciDocSchemaTest
 * @path packages/schemas/tests/aci_doc_test.ts
 * @description RED-first tests for Phase 112 Step 1's bounded ACI (Agent-Computer Interface)
 *   documentation schema: field bounds, required sub-objects, JSON-only example inputs, and
 *   the property-count/serialized-size caps that keep a single ACI block from exhausting the
 *   prompt-injection budget before it ever reaches the renderer (Step 2).
 * @architectural-layer Test
 * @related-files ["packages/schemas/src/aci_doc.ts", "packages/core/src/types/constants.ts"]
 */

import { assertEquals, assertFalse } from "@std/assert";
import { AciDocSchema } from "@exaix/schemas";
import {
  ACI_DOC_GUIDANCE_MAX_CHARS,
  ACI_DOC_INPUT_MAX_CHARS,
  ACI_DOC_INPUT_MAX_PROPERTIES,
  ACI_DOC_OUTPUT_MAX_CHARS,
  ACI_DOC_RATIONALE_MAX_CHARS,
  ACI_DOC_SUMMARY_MAX_CHARS,
} from "@exaix/core";

function validAciDoc() {
  return {
    summary: "Return the full text content of a file at the given path.",
    when_to_use: "Use when you need to read or analyze the contents of a known file path.",
    when_not_to_use: "Do not use for searching within many files; use grep_search instead.",
    example: {
      input: { path: "src/example.ts" },
      output: "export function example() {}\n",
      rationale: "A direct, single-file read is the intended use of this tool.",
    },
    anti_example: {
      input: { path: "src/**/*.ts" },
      why_wrong: "read_file takes exactly one path; a glob pattern must go through search_files.",
    },
  };
}

Deno.test("[AciDocSchema] accepts a well-formed ACI block", () => {
  const result = AciDocSchema.safeParse(validAciDoc());
  assertEquals(result.success, true);
});

Deno.test("[AciDocSchema] rejects a summary below the minimum length", () => {
  const doc = validAciDoc();
  doc.summary = "short";
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] rejects a summary above ACI_DOC_SUMMARY_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.summary = "x".repeat(ACI_DOC_SUMMARY_MAX_CHARS + 1);
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] accepts a summary at exactly ACI_DOC_SUMMARY_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.summary = "x".repeat(ACI_DOC_SUMMARY_MAX_CHARS);
  assertEquals(AciDocSchema.safeParse(doc).success, true);
});

Deno.test("[AciDocSchema] rejects when_to_use above ACI_DOC_GUIDANCE_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.when_to_use = "x".repeat(ACI_DOC_GUIDANCE_MAX_CHARS + 1);
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] rejects when_not_to_use above ACI_DOC_GUIDANCE_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.when_not_to_use = "x".repeat(ACI_DOC_GUIDANCE_MAX_CHARS + 1);
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] rejects example.output above ACI_DOC_OUTPUT_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.example.output = "x".repeat(ACI_DOC_OUTPUT_MAX_CHARS + 1);
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] rejects example.rationale above ACI_DOC_RATIONALE_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.example.rationale = "x".repeat(ACI_DOC_RATIONALE_MAX_CHARS + 1);
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] rejects anti_example.why_wrong above ACI_DOC_RATIONALE_MAX_CHARS", () => {
  const doc = validAciDoc();
  doc.anti_example.why_wrong = "x".repeat(ACI_DOC_RATIONALE_MAX_CHARS + 1);
  assertFalse(AciDocSchema.safeParse(doc).success);
});

Deno.test("[AciDocSchema] rejects a block missing the example sub-object", () => {
  const { example: _example, ...withoutExample } = validAciDoc();
  assertFalse(AciDocSchema.safeParse(withoutExample).success);
});

Deno.test("[AciDocSchema] rejects a block missing the anti_example sub-object", () => {
  const { anti_example: _antiExample, ...withoutAntiExample } = validAciDoc();
  assertFalse(AciDocSchema.safeParse(withoutAntiExample).success);
});

Deno.test("[security] rejects a non-JSON example input value (e.g. a function)", () => {
  const doc = validAciDoc();
  const invalidInput = { handler: () => "not json" };
  assertFalse(
    AciDocSchema.safeParse({ ...doc, example: { ...doc.example, input: invalidInput } }).success,
  );
});

Deno.test("[security] rejects example input exceeding ACI_DOC_INPUT_MAX_PROPERTIES", () => {
  const doc = validAciDoc();
  const tooManyProps: Record<string, number> = {};
  for (let i = 0; i <= ACI_DOC_INPUT_MAX_PROPERTIES; i++) {
    tooManyProps[`key_${i}`] = i;
  }
  assertFalse(
    AciDocSchema.safeParse({ ...doc, example: { ...doc.example, input: tooManyProps } }).success,
  );
});

Deno.test("[security] rejects example input whose serialized size exceeds ACI_DOC_INPUT_MAX_CHARS", () => {
  const doc = validAciDoc();
  const oversizedInput = { path: "x".repeat(ACI_DOC_INPUT_MAX_CHARS) };
  assertFalse(
    AciDocSchema.safeParse({ ...doc, example: { ...doc.example, input: oversizedInput } }).success,
  );
});
